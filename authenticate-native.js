#!/usr/bin/env node
/**
 * OAuth Authentication Helper (native fetch variant)
 *
 * gaxios (used internally by googleapis/google-auth-library) fails on this
 * Node 24 install with "Invalid response body ... Premature close" when
 * exchanging the code for tokens, even though Node's built-in fetch handles
 * the identical request fine. This script mirrors authenticate.js but does
 * the code->token exchange with native fetch instead of oauth2Client.getToken().
 */

import { config } from 'dotenv';
import express from 'express';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config();

const PORT = 3000;
const TOKENS_FILE = join(__dirname, '.tokens.json');
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

const scopes = [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

const app = express();

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        res.status(400).send('No authorization code received');
        return;
    }

    try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenResp.ok) {
            const errText = await tokenResp.text();
            throw new Error(`Token exchange failed (${tokenResp.status}): ${errText}`);
        }

        const tokens = await tokenResp.json();

        const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope,
            token_type: tokens.token_type || 'Bearer',
            expires_at: Date.now() + (tokens.expires_in * 1000)
        };

        writeFileSync(TOKENS_FILE, JSON.stringify(tokenData, null, 2));

        console.log('\n✅ Authentication successful!');
        console.log(`📁 Tokens saved to: ${TOKENS_FILE}`);
        console.log(`   refresh_token present: ${Boolean(tokens.refresh_token)}`);

        res.send('<h1>Authentication Successful!</h1><p>Tokens saved. You can close this window.</p>');

        setTimeout(() => {
            console.log('\n🚀 Ready to use!');
            process.exit(0);
        }, 1000);

    } catch (error) {
        console.error('❌ Error getting tokens:', error.message);
        res.status(500).send(`Authentication failed: ${error.message}`);
        process.exit(1);
    }
});

const server = app.listen(PORT, () => {
    console.log('\n🔐 Google Business Profile Authentication (native fetch)');
    console.log('==========================================\n');
    console.log(`✓ OAuth server started on http://localhost:${PORT}`);

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        access_type: 'offline',
        scope: scopes.join(' '),
        prompt: 'consent',
        response_type: 'code',
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
    }).toString();

    console.log('Visit this URL to authenticate:\n');
    console.log(`${authUrl}\n`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
    } else {
        console.error('❌ Server error:', error.message);
    }
    process.exit(1);
});
