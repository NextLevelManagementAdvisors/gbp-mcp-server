/**
 * Config for the HTTP entry point's identity gate + OAuth 2.1 provider.
 *
 * Deliberately separate from ../utils/config.ts: that file owns the GBP API's
 * own OAuth client (GOOGLE_CLIENT_ID/SECRET, business.manage scope, used by
 * GoogleAuthService to call Google's Business Profile API). This file owns a
 * DIFFERENT Google OAuth client (GOOGLE_WEB_CLIENT_ID/SECRET, openid+email
 * scope only) that gates WHO may connect to this MCP server at all. Sharing
 * one client between the two would leak the business.manage grant into the
 * sign-in flow and vice versa.
 */
import 'dotenv/config';

const ISSUER = process.env.OAUTH_ISSUER || 'https://gbp.nlma.io';

export const gateConfig = {
    port: Number(process.env.PORT || 3123),
    host: process.env.HOST || '127.0.0.1',
    issuer: ISSUER,
    mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',

    // ── Google sign-in gate (optional; enables the MCP OAuth provider) ──
    googleClientId: process.env.GOOGLE_WEB_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_WEB_CLIENT_SECRET || '',
    googleAllowedEmails: (process.env.GOOGLE_ALLOWED_EMAILS || '')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    googleAllowedDomains: (process.env.GOOGLE_ALLOWED_DOMAINS || '')
        .split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
    googleRedirectUri:
        process.env.GOOGLE_OAUTH_REDIRECT_URI || `${ISSUER.replace(/\/$/, '')}/oauth/google/callback`,

    // Operator-password break-glass fallback.
    ownerPassword: process.env.MCP_OWNER_PASSWORD || '',
    allowPasswordFallback: (process.env.ALLOW_PASSWORD_FALLBACK || 'true').toLowerCase() !== 'false',

    // Persisted DCR clients + issued OAuth tokens.
    oauthStorePath: process.env.OAUTH_STORE_PATH || './oauth-store.json',
};
