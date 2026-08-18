/**
 * Threads the gate-verified email through the MCP SDK's OAuth router, which
 * calls oauthProvider.authorize(client, params, res) with no `req` argument.
 * The googleGate middleware enters this context right before handing off to
 * mcpAuthRouter; AsyncLocalStorage carries it across the intervening async
 * calls so oauthProvider can stamp it onto the issued auth code/token.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
    email: string;
}

const als = new AsyncLocalStorage<RequestStore>();

export function runWithEmail<T>(email: string, fn: () => T): T {
    return als.run({ email }, fn);
}

export function currentEmail(): string | undefined {
    return als.getStore()?.email;
}
