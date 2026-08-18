/**
 * Central org-wide domain registry consumer, ported from the
 * remine-property / remine-docs pattern (see status-dashboard's
 * authorized-domains.json on the VPS, the single source of truth ~12
 * other services already read from).
 *
 * This ONLY widens who may pass the identity gate (i.e. sign in at all).
 * It grants no location access by itself -- see locationScope.ts for the
 * separate, fail-closed "which GBP listing can this identity touch" layer.
 */
import { logger } from '../utils/logger.js';

// Mirrors the live status-dashboard registry as of 2026-08-18, so a cold-boot
// fetch failure never leaves the gate relying on stale hardcoded values.
const BAKED_DEFAULT_DOMAINS = [
    'aristidemanagement.com',
    'fidumcompany.com',
    'hvacfrontroyal.com',
    'mattmirus.com',
    'nextlevelmanagementadvisors.com',
    'nlma.io',
    'propmanageplus.com',
    'tra-lawfirm.com',
    'turboclaim.ai',
    'zipadeeservices.com',
];

const FETCH_TIMEOUT_MS = 4000;
const DEFAULT_URL = 'https://status.nlma.io/domains.json';
const DEFAULT_TTL_SECONDS = 300;

let currentDomains: Set<string> = new Set(BAKED_DEFAULT_DOMAINS);
let everFetchedOk = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const registryUrl = process.env.AUTHORIZED_DOMAINS_URL || DEFAULT_URL;
const ttlSeconds = Number(process.env.AUTHORIZED_DOMAINS_TTL || DEFAULT_TTL_SECONDS);

async function fetchDomains(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(registryUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { domains?: unknown };
        if (!Array.isArray(body.domains)) throw new Error('malformed response: missing domains[]');
        currentDomains = new Set(body.domains.map((d) => String(d).toLowerCase()));
        everFetchedOk = true;
    } catch (err) {
        if (!everFetchedOk) {
            currentDomains = new Set(BAKED_DEFAULT_DOMAINS);
            logger.warn(`authorized-domains: cold fetch failed (${(err as Error).message}), using baked defaults`);
        } else {
            logger.warn(`authorized-domains: refresh failed (${(err as Error).message}), keeping last-known-good list`);
        }
    } finally {
        clearTimeout(timer);
    }
}

/** One fetch before the server starts listening, then a TTL-interval refresh in the background. */
export async function initAuthorizedDomains(): Promise<void> {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    await fetchDomains();
    refreshTimer = setInterval(() => void fetchDomains(), ttlSeconds * 1000);
    refreshTimer.unref();
}

export function isDomainAuthorized(domain: string): boolean {
    return currentDomains.has(domain.toLowerCase());
}
