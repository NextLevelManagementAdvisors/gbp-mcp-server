// Persistence for the MCP OAuth 2.1 provider.
// Single-tenant server: DCR clients + issued tokens are persisted to a JSON
// file so claude.ai stays connected across restarts; short-lived auth codes
// live in memory only.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { gateConfig } from './gateConfig.js';

const tok = (n = 32) => randomBytes(n).toString('base64url');

interface ClientRecord {
    client_id: string;
    client_id_issued_at: number;
    client_secret?: string;
    client_secret_expires_at?: number;
    token_endpoint_auth_method?: string;
    [key: string]: unknown;
}

interface TokenRecord {
    clientId: string;
    scopes: string[];
    expiresAt: number;
}

interface CodeRecord {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
    resource?: string;
    expiresAt: number;
}

interface StoreState {
    clients: Record<string, ClientRecord>;
    tokens: Record<string, TokenRecord>;
    refresh: Record<string, { clientId: string; scopes: string[] }>;
}

function emptyState(): StoreState {
    return { clients: {}, tokens: {}, refresh: {} };
}

class OAuthStore {
    private path: string;
    private state: StoreState;
    public codes: Map<string, CodeRecord>;

    constructor(path: string) {
        this.path = path;
        this.state = emptyState();
        this.codes = new Map();
        this._load();
    }

    private _load(): void {
        try {
            if (existsSync(this.path)) {
                const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
                this.state = { ...emptyState(), ...parsed };
            }
        } catch {
            this.state = emptyState();
        }
    }

    private _save(): void {
        try {
            writeFileSync(this.path, JSON.stringify(this.state, null, 2), { mode: 0o600 });
        } catch {
            /* best-effort persistence */
        }
    }

    getClient(clientId: string): ClientRecord | undefined {
        return this.state.clients[clientId];
    }

    registerClient(client: Partial<ClientRecord>): ClientRecord {
        const clientId = tok(16);
        const full: ClientRecord = {
            ...client,
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        if (client.token_endpoint_auth_method && client.token_endpoint_auth_method !== 'none') {
            full.client_secret = tok(24);
            full.client_secret_expires_at = 0;
        }
        this.state.clients[clientId] = full;
        this._save();
        return full;
    }

    putCode(data: Omit<CodeRecord, 'expiresAt'>): string {
        const code = tok(24);
        this.codes.set(code, { ...data, expiresAt: Date.now() + 5 * 60 * 1000 });
        return code;
    }

    takeCode(code: string): CodeRecord | null {
        const row = this.codes.get(code);
        if (!row) return null;
        this.codes.delete(code);
        if (row.expiresAt < Date.now()) return null;
        return row;
    }

    issueTokens({ clientId, scopes, ttlSeconds = 30 * 24 * 3600 }: { clientId: string; scopes: string[]; ttlSeconds?: number }) {
        const accessToken = tok(32);
        const refreshToken = tok(32);
        const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
        this.state.tokens[accessToken] = { clientId, scopes, expiresAt };
        this.state.refresh[refreshToken] = { clientId, scopes };
        this._save();
        return { accessToken, refreshToken, expiresIn: ttlSeconds };
    }

    getToken(accessToken: string): TokenRecord | null {
        const row = this.state.tokens[accessToken];
        if (!row) return null;
        if (row.expiresAt && row.expiresAt < Math.floor(Date.now() / 1000)) {
            delete this.state.tokens[accessToken];
            this._save();
            return null;
        }
        return row;
    }

    takeRefresh(refreshToken: string) {
        return this.state.refresh[refreshToken] || null;
    }

    revoke(token: string): void {
        let changed = false;
        if (this.state.tokens[token]) { delete this.state.tokens[token]; changed = true; }
        if (this.state.refresh[token]) { delete this.state.refresh[token]; changed = true; }
        if (changed) this._save();
    }
}

export const store = new OAuthStore(gateConfig.oauthStorePath);
