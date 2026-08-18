#!/usr/bin/env node
/**
 * Streamable HTTP entry point for gbp-mcp-server.
 *
 * The upstream package only ships a StdioServerTransport (src/index.ts).
 * This adds an Express front door so the server can sit behind nginx at
 * https://gbp.nlma.io, gated by Google sign-in (or an operator password
 * fallback) in front of the MCP OAuth 2.1 /authorize endpoint — the same
 * pattern used by matterport-mcp, vin-mcp, etc.
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { McpServer } from './server/mcpServer.js';
import { gateConfig } from './http/gateConfig.js';
import { createGoogleGate } from './http/googleGate.js';
import { oauthProvider } from './http/oauthProvider.js';
import { logger } from './utils/logger.js';

const isMockMode = process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    process.env.ENABLE_MOCK_MODE === 'true';

const SPLASH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>GBP MCP</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:64px auto;padding:0 22px;color:#1a1a1a;line-height:1.55}
  h1{font-size:24px;margin-bottom:4px}
  .sub{color:#666;margin-top:0}
  code{background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:13px}
  pre{background:#f4f4f5;padding:14px;border-radius:8px;overflow:auto;font-size:13px}
  h2{font-size:15px;margin-top:28px}
  ul{padding-left:18px}
  li{margin:4px 0}
  .badge{display:inline-block;background:#fff7e6;color:#8a5a00;border:1px solid #f0d999;border-radius:4px;padding:2px 8px;font-size:12px;margin-left:6px;vertical-align:middle}
  .src{color:#666;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:14px}
</style>
</head>
<body>
  <h1>GBP MCP${isMockMode ? ' <span class="badge">mock mode</span>' : ''}</h1>
  <p class="sub">Google Business Profile over the Model Context Protocol &mdash; reviews, posts, Q&amp;A, media, insights, and business info. Single-operator server.</p>

  <h2>Connect</h2>
  <p>Add as a custom connector in Claude or ChatGPT:</p>
  <pre>${gateConfig.issuer}/mcp</pre>
  <p>You will be asked to sign in with Google during the OAuth step.</p>

  <h2>Tools &mdash; 28 across 6 surfaces</h2>
  <ul>
    <li><b>Reviews</b> (5) &mdash; list locations, unreplied reviews, AI-drafted replies, post/delete replies, review stats</li>
    <li><b>Local Posts</b> (4) &mdash; get/create/update/delete STANDARD / EVENT / OFFER / ALERT posts</li>
    <li><b>Q&amp;A</b> (4) &mdash; get questions, upsert/delete answers, delete questions</li>
    <li><b>Media</b> (4) &mdash; get media, create/upload/delete photos and videos</li>
    <li><b>Insights</b> (3) &mdash; daily metrics, multi-location metrics, search keywords</li>
    <li><b>Business Info</b> (7+) &mdash; location details, attributes, services, categories, verifications</li>
  </ul>

  ${isMockMode ? `<h2>Mock mode</h2>
  <p>Every tool currently returns realistic placeholder data. Live mode needs Google Business Profile API access approval (a 60+ day review requiring a verified GBP active 60+ days, a website, and a complete profile) &mdash; see the <a href="https://github.com/jmdurant/gbp-mcp-server#google-business-profile-api-access-requirements">upstream README</a>.</p>` : ''}

  <p class="src">Fork of <a href="https://github.com/jmdurant/gbp-mcp-server">jmdurant/gbp-mcp-server</a>, MIT licensed.</p>
</body>
</html>`;

function mountMcp(app: express.Express, authMw: express.RequestHandler): void {
    const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

    app.post('/mcp', authMw, async (req: Request, res: Response) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        if (sessionId && sessions.has(sessionId)) {
            const entry = sessions.get(sessionId)!;
            return entry.transport.handleRequest(req, res, req.body);
        }
        const isInitialize = req.body?.method === 'initialize';
        if (sessionId && !isInitialize) return res.status(400).json({ error: 'unknown session' });

        const server = new McpServer();
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sid: string): void => {
                sessions.set(sid, { server, transport });
            },
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    const replaySession = async (req: Request, res: Response) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        if (sessionId && sessions.has(sessionId)) {
            return sessions.get(sessionId)!.transport.handleRequest(req, res);
        }
        res.status(400).json({ error: 'unknown session' });
    };
    app.get('/mcp', authMw, replaySession);
    app.delete('/mcp', authMw, async (req: Request, res: Response) => {
        const sessionIdHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        if (sessionId && sessions.has(sessionId)) {
            const entry = sessions.get(sessionId)!;
            await entry.transport.handleRequest(req, res);
            sessions.delete(sessionId);
            return;
        }
        res.status(400).json({ error: 'unknown session' });
    });
}

function runHttp(): void {
    const app = express();
    app.set('trust proxy', 1);

    app.get('/', (_req: Request, res: Response) => res.type('html').send(SPLASH_HTML));
    app.get('/health', (_req: Request, res: Response) => res.json({ ok: true, service: 'gbp-mcp-server', mockMode: isMockMode }));

    // JSON body only on /mcp; the OAuth router + gate parse their own bodies.
    app.use('/mcp', express.json({ limit: '4mb' }));

    const gate = createGoogleGate();

    if (gate.enabled) {
        // Human identity gate -> MCP OAuth 2.1 provider (DCR/PKCE) -> bearer-guarded /mcp.
        app.use(gate.routes); // /login, /oauth/google/start, /oauth/google/callback
        app.use('/authorize', gate.gate); // require sign-in cookie before /authorize
        app.use(
            mcpAuthRouter({
                provider: oauthProvider,
                issuerUrl: new URL(gateConfig.issuer),
                resourceServerUrl: new URL(`${gateConfig.issuer.replace(/\/$/, '')}/mcp`),
                scopesSupported: ['mcp'],
                resourceName: 'GBP MCP',
            })
        );
        const mcpAuth = requireBearerAuth({
            verifier: oauthProvider,
            resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${gateConfig.issuer.replace(/\/$/, '')}/mcp`)),
        });
        mountMcp(app, mcpAuth);
    } else {
        // Legacy bearer-only mode (Claude Code with a pasted MCP_AUTH_TOKEN).
        const bearerAuth = (req: Request, res: Response, next: express.NextFunction) => {
            if (!gateConfig.mcpAuthToken) return next();
            const hdr = req.headers.authorization || '';
            const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
            if (token !== gateConfig.mcpAuthToken) return res.status(401).json({ error: 'unauthorized' });
            next();
        };
        mountMcp(app, bearerAuth);
    }

    app.listen(gateConfig.port, gateConfig.host, () => {
        logger.info(
            `gbp-mcp-server (HTTP) listening on http://${gateConfig.host}:${gateConfig.port} ` +
            `(issuer ${gateConfig.issuer}, oauth_gate=${gate.enabled}, ` +
            `google=${Boolean(gateConfig.googleClientId)}, password_fallback=${Boolean(gateConfig.ownerPassword && gateConfig.allowPasswordFallback)}, mock=${isMockMode})`
        );
    });
}

runHttp();
