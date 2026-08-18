// Compact single-tenant OAuthServerProvider for the MCP SDK's mcpAuthRouter.
// - DCR clients + tokens persisted via oauthStore.
// - The human gate (Google sign-in) runs BEFORE this provider's authorize()
//   ever executes (see googleGate.ts), so by the time authorize() is called
//   the operator has already proven identity.
// - verifyAccessToken also accepts the static MCP_AUTH_TOKEN, so Claude Code
//   (pasted bearer) and claude.ai web (OAuth) both work against one /mcp guard.
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { store } from './oauthStore.js';
import { gateConfig } from './gateConfig.js';

const clientsStore = {
    getClient(clientId: string) {
        return store.getClient(clientId);
    },
    registerClient(client: any) {
        return store.registerClient(client);
    },
};

export const oauthProvider: any = {
    get clientsStore() {
        return clientsStore;
    },

    async authorize(client: any, params: any, res: any) {
        const code = store.putCode({
            clientId: client.client_id,
            codeChallenge: params.codeChallenge,
            redirectUri: params.redirectUri,
            scopes: params.scopes || [],
            resource: params.resource ? params.resource.toString() : undefined,
        });
        const target = new URL(params.redirectUri);
        target.searchParams.set('code', code);
        if (params.state !== undefined) target.searchParams.set('state', params.state);
        res.redirect(302, target.toString());
    },

    async challengeForAuthorizationCode(client: any, authorizationCode: string) {
        const row = store.codes.get(authorizationCode);
        if (!row || row.clientId !== client.client_id || row.expiresAt < Date.now()) {
            throw new InvalidGrantError('Invalid or expired authorization code');
        }
        return row.codeChallenge;
    },

    async exchangeAuthorizationCode(client: any, authorizationCode: string) {
        const row = store.takeCode(authorizationCode);
        if (!row || row.clientId !== client.client_id) {
            throw new InvalidGrantError('Invalid or expired authorization code');
        }
        const { accessToken, refreshToken, expiresIn } = store.issueTokens({
            clientId: client.client_id,
            scopes: row.scopes,
        });
        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: expiresIn,
            refresh_token: refreshToken,
            scope: (row.scopes || []).join(' '),
        };
    },

    async exchangeRefreshToken(client: any, refreshToken: string, scopes?: string[]) {
        const row = store.takeRefresh(refreshToken);
        if (!row || row.clientId !== client.client_id) {
            throw new InvalidGrantError('Invalid refresh token');
        }
        const grantScopes = scopes && scopes.length ? scopes : row.scopes;
        const { accessToken, refreshToken: newRefresh, expiresIn } = store.issueTokens({
            clientId: client.client_id,
            scopes: grantScopes,
        });
        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: expiresIn,
            refresh_token: newRefresh,
            scope: (grantScopes || []).join(' '),
        };
    },

    async verifyAccessToken(token: string) {
        if (gateConfig.mcpAuthToken && token === gateConfig.mcpAuthToken) {
            return {
                token,
                clientId: 'static-bearer',
                scopes: ['mcp'],
                expiresAt: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600,
            };
        }
        const row = store.getToken(token);
        if (!row) throw new InvalidTokenError('Token is invalid or expired');
        return { token, clientId: row.clientId, scopes: row.scopes || [], expiresAt: row.expiresAt };
    },

    async revokeToken(_client: any, request: { token: string }) {
        store.revoke(request.token);
    },
};
