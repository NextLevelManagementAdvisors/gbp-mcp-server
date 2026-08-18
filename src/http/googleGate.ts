// Human identity gate in front of the MCP OAuth /authorize endpoint.
// Two optional, config-driven methods:
//   1. Google sign-in  (GOOGLE_WEB_CLIENT_ID/SECRET set) — scope "openid email",
//      online access only; the server calls no Google API beyond userinfo.
//   2. Operator password (MCP_OWNER_PASSWORD + ALLOW_PASSWORD_FALLBACK) — break-glass.
// On success it mints a short-lived `gbp_mcp_authed` cookie that the
// /authorize gate trusts. Fail-closed: empty allowlists let nobody in.
import express, { Router, Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { gateConfig } from './gateConfig.js';
import { isDomainAuthorized } from './authorizedDomains.js';
import { runWithEmail } from './requestContext.js';
import { OPERATOR_IDENTITY } from '../authorization/locationScope.js';

const COOKIE_NAME = 'gbp_mcp_authed';
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const STATE_TTL_MS = 5 * 60 * 1000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// Cookie value -> { the identity that signed in, expiry }. Password
// break-glass logins carry the OPERATOR_IDENTITY sentinel instead of a real
// email, so downstream location scoping still has something to key on.
const validCookies = new Map<string, { email: string; exp: number }>();
const states = new Map<string, { return: string; exp: number }>();

const tok = (n = 24) => randomBytes(n).toString('base64url');
const googleEnabled = () => Boolean(gateConfig.googleClientId && gateConfig.googleClientSecret);
const passwordEnabled = () => Boolean(gateConfig.ownerPassword && gateConfig.allowPasswordFallback);

// Constant-time compare so response timing can't leak how many leading
// characters of a guessed password matched (guards the break-glass login).
function passwordMatches(candidate: string): boolean {
    const expected = Buffer.from(gateConfig.ownerPassword, 'utf8');
    const given = Buffer.from(candidate, 'utf8');
    if (expected.length !== given.length) {
        // Still run a same-length comparison so early-return length checks
        // don't themselves become a (much smaller) timing side-channel.
        timingSafeEqual(expected, expected);
        return false;
    }
    return timingSafeEqual(expected, given);
}

// Open-redirect guard: only an in-app, same-host path is a valid `return`
// target. Browsers treat `//evil.com` and `/\evil.com` as protocol-relative
// off-origin URLs, so both are rejected alongside any absolute URL.
function sanitizeReturn(raw: string): string {
    if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) {
        return raw;
    }
    return '/';
}

function mintCookieValue(email: string): string {
    const v = tok(32);
    validCookies.set(v, { email, exp: Date.now() + COOKIE_MAX_AGE_MS });
    return v;
}
function cookieEmail(v?: string): string | null {
    if (!v) return null;
    const row = validCookies.get(v);
    if (!row) return null;
    if (row.exp < Date.now()) { validCookies.delete(v); return null; }
    return row.email;
}
function parseCookies(header = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const piece of header.split(';')) {
        const p = piece.trim();
        const i = p.indexOf('=');
        if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    }
    return out;
}
function setAuthCookie(res: Response, email: string): void {
    res.cookie(COOKIE_NAME, mintCookieValue(email), {
        maxAge: COOKIE_MAX_AGE_MS, httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    });
}
function putState(returnUrl: string): string {
    const now = Date.now();
    for (const [k, v] of states) if (v.exp < now) states.delete(k);
    const st = tok(24);
    states.set(st, { return: returnUrl || '/', exp: now + STATE_TTL_MS });
    return st;
}
function popState(st: string) {
    const row = states.get(st);
    states.delete(st);
    if (!row || row.exp < Date.now()) return null;
    return row;
}
// Domain compared against the part after the LAST '@' only — never `endswith`,
// which would wrongly admit e.g. x@evilnlma.io or x@nlma.io.evil.com.
function emailAllowed(email: string): boolean {
    const allowEmails = gateConfig.googleAllowedEmails || [];
    const allowDomains = gateConfig.googleAllowedDomains || [];
    const e = String(email).toLowerCase();
    if (allowEmails.includes(e)) return true;
    const domain = e.split('@')[1] || '';
    if (allowDomains.includes(domain)) return true;
    // Central org-wide registry (status.nlma.io) widens WHO may sign in;
    // it grants no location access by itself -- locationScope.ts defaults
    // any identity not explicitly mapped there to zero locations.
    return isDomainAuthorized(domain);
}
function consentUrl(state: string): string {
    const p = new URLSearchParams({
        client_id: gateConfig.googleClientId,
        redirect_uri: gateConfig.googleRedirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        access_type: 'online',
        prompt: 'select_account',
    });
    return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function loginPage(returnUrl: string, error?: string): string {
    const safeReturn = esc(returnUrl);
    const errHtml = error ? `<div class="err">${esc(error)}</div>` : '';
    let googleHtml = '';
    if (googleEnabled()) {
        const start = `/oauth/google/start?return=${encodeURIComponent(returnUrl)}`;
        googleHtml = `<a class="gbtn" href="${esc(start)}"><span class="g">G</span> Sign in with Google</a>`;
    }
    let pwHtml = '';
    if (passwordEnabled()) {
        const sep = googleHtml ? '<div class="sep">or</div>' : '';
        pwHtml = `${sep}<form method="post" action="/login"><input type="hidden" name="return" value="${safeReturn}"><label for="password">Operator password</label><input id="password" type="password" name="password" autocomplete="current-password"><button type="submit">Authorize</button></form>`;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><title>GBP MCP &mdash; sign in</title><style>
body{font-family:system-ui,sans-serif;max-width:380px;margin:80px auto;padding:0 20px;color:#222}
h1{font-size:20px}label{display:block;margin:12px 0 4px;font-size:13px;color:#555}
input[type=password]{width:100%;padding:10px;font-size:14px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{padding:10px 22px;font-size:14px;margin-top:14px;cursor:pointer;border:0;background:#111;color:#fff;border-radius:4px;width:100%}
.gbtn{display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;border:1px solid #ccc;border-radius:4px;text-decoration:none;color:#222;font-size:14px;font-weight:500}
.gbtn .g{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:#4285F4;color:#fff;font-weight:700;font-size:13px}
.sep{text-align:center;color:#999;font-size:12px;margin:16px 0}
.err{background:#fef2f2;color:#b00020;padding:10px 14px;border-radius:4px;margin-bottom:12px;font-size:13px}
.hint{color:#666;font-size:12px;margin-top:18px;line-height:1.5}
</style></head><body><h1>GBP MCP</h1>
<p>A client is requesting authorization to connect. Sign in to continue.</p>
${errHtml}${googleHtml}${pwHtml}
<p class="hint">Single-operator server. Access is limited to authorized accounts.</p>
</body></html>`;
}
function deniedPage(email: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Not authorized</title><style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;color:#222}
.err{background:#fef2f2;color:#b00020;padding:12px 16px;border-radius:6px;font-size:14px}a{color:#111}
</style></head><body><h1>Not authorized</h1>
<div class="err">The Google account <b>${esc(email)}</b> is not on the allow list for this server.</div>
<p><a href="/login">Try a different account</a></p></body></html>`;
}

export interface GoogleGate {
    enabled: boolean;
    routes: Router;
    gate: (req: Request, res: Response, next: NextFunction) => void;
}

/** Build the gate. Returns { enabled, routes, gate }. */
export function createGoogleGate(): GoogleGate {
    const enabled = googleEnabled() || passwordEnabled();
    const routes = express.Router();

    routes.get('/login', (req: Request, res: Response) => {
        res.status(200).type('html').send(loginPage(sanitizeReturn(String(req.query.return || '/'))));
    });

    routes.post('/login', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
        const returnUrl = sanitizeReturn(String(req.body.return || '/'));
        if (!passwordEnabled()) {
            return res.status(401).type('html').send(loginPage(returnUrl, 'Password sign-in is disabled.'));
        }
        if (!passwordMatches(String(req.body.password || ''))) {
            return res.status(401).type('html').send(loginPage(returnUrl, 'Incorrect password.'));
        }
        setAuthCookie(res, OPERATOR_IDENTITY);
        res.redirect(303, returnUrl);
    });

    routes.get('/oauth/google/start', (req: Request, res: Response) => {
        if (!googleEnabled()) return res.redirect(302, '/login');
        const safeReturn = sanitizeReturn(String(req.query.return || '/'));
        const state = putState(safeReturn);
        res.redirect(302, consentUrl(state));
    });

    routes.get('/oauth/google/callback', async (req: Request, res: Response) => {
        try {
            if (!googleEnabled()) return res.redirect(302, '/login');
            const row = popState(String(req.query.state || ''));
            if (!row) return res.status(400).type('html').send(loginPage('/', 'Login session expired. Try again.'));
            const code = String(req.query.code || '');
            if (!code) return res.status(400).type('html').send(loginPage(row.return, 'Google returned no code.'));

            const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: gateConfig.googleClientId,
                    client_secret: gateConfig.googleClientSecret,
                    redirect_uri: gateConfig.googleRedirectUri,
                    grant_type: 'authorization_code',
                }),
            });
            if (!tokenResp.ok) {
                return res.status(502).type('html').send(loginPage(row.return, 'Google token exchange failed.'));
            }
            const { access_token } = await tokenResp.json() as { access_token: string };
            const uiResp = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
            if (!uiResp.ok) {
                return res.status(502).type('html').send(loginPage(row.return, 'Could not read Google profile.'));
            }
            const { email, email_verified } = await uiResp.json() as { email?: string; email_verified?: boolean };
            if (!email || email_verified === false || !emailAllowed(email)) {
                return res.status(403).type('html').send(deniedPage(email || 'unknown'));
            }
            setAuthCookie(res, email.toLowerCase());
            res.redirect(303, row.return || '/authorize');
        } catch {
            res.status(500).type('html').send(loginPage('/', 'Sign-in error. Try again.'));
        }
    });

    // Gate middleware for /authorize: require a valid cookie or bounce to /login.
    // Enters an AsyncLocalStorage context carrying the signed-in identity so
    // oauthProvider.authorize() -- called deeper in this same request by the
    // SDK's mcpAuthRouter, with no `req` of its own -- can stamp it onto the
    // issued auth code/token for later location-scope enforcement.
    const gate = (req: Request, res: Response, next: NextFunction) => {
        const cookies = parseCookies(req.headers.cookie || '');
        const email = cookieEmail(cookies[COOKIE_NAME]);
        if (email) return runWithEmail(email, next);
        res.redirect(302, `/login?return=${encodeURIComponent(req.originalUrl)}`);
    };

    return { enabled, routes, gate };
}
