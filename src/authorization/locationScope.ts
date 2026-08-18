/**
 * Domain/email -> GBP location scoping.
 *
 * The identity gate (googleGate.ts + authorizedDomains.ts) only answers "may
 * this person connect at all". Every connecting identity shares ONE stored
 * Google token (see googleAuth.ts), so without this layer anyone who passes
 * the gate can read/write all locations in the account. This layer answers
 * the separate question: "which of those locations may THIS identity touch".
 *
 * Fail closed: an identity with no matching entry gets zero locations, not
 * all of them. Seeded operators get FULL_ACCESS; every other authorized
 * domain starts with an empty scope until someone explicitly maps it here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';

export const FULL_ACCESS = '__ALL__' as const;
export const OPERATOR_IDENTITY = '__operator__';

type Scope = string[] | typeof FULL_ACCESS;

interface ScopeFile {
    emails?: Record<string, Scope>;
    domains?: Record<string, Scope>;
}

// Seeded full-access identities, per explicit request: internal team +
// Forrest's personal account. Everyone else (including the wider,
// registry-sourced domain allowlist) defaults to zero locations.
const DEFAULT_EMAILS: Record<string, Scope> = {
    'forrest@nlma.io': FULL_ACCESS,
    'admin@fidumcompany.com': FULL_ACCESS,
    'forrest.surprenant@gmail.com': FULL_ACCESS,
    [OPERATOR_IDENTITY]: FULL_ACCESS,
};

const SCOPE_PATH = process.env.LOCATION_SCOPE_PATH || './location-scopes.json';

function loadScopes(): { emails: Record<string, Scope>; domains: Record<string, Scope> } {
    let fromFile: ScopeFile = {};
    try {
        if (existsSync(SCOPE_PATH)) {
            fromFile = JSON.parse(readFileSync(SCOPE_PATH, 'utf8'));
        }
    } catch (err) {
        logger.warn(`location-scopes: failed to read ${SCOPE_PATH} (${(err as Error).message}), using defaults only`);
    }
    return {
        emails: { ...DEFAULT_EMAILS, ...(fromFile.emails || {}) },
        domains: { ...(fromFile.domains || {}) },
    };
}

let cached = loadScopes();

/** Re-read location-scopes.json without restarting the process. */
export function reloadLocationScopes(): void {
    cached = loadScopes();
}

// Callers pass full ("accounts/123/locations/456") or short
// ("locations/456") resource names interchangeably, and several tools
// identify their target via a resource name that only EMBEDS the location
// rather than exposing it as its own field -- e.g. questionName
// "locations/456/questions/789", postName "accounts/1/locations/456/localPosts/2".
// Match the locations/{id} segment wherever it occurs, not just at the end,
// so every one of those shapes normalizes to the same scope-comparable key.
function normalizeLocation(name: string): string {
    const match = name.match(/locations\/[^/]+/);
    return match ? match[0] : name;
}

// Chokepoint for tools whose input has no dedicated `locationName` field:
// scan every string arg for one that contains a locations/{id} segment.
// Generic on purpose -- new tools/fields need no per-name allowlisting here,
// only a resource-name string containing "locations/" to be caught.
export function extractLocationRef(args: unknown): string | undefined {
    if (!args || typeof args !== 'object') return undefined;
    for (const value of Object.values(args as Record<string, unknown>)) {
        if (typeof value === 'string' && value.includes('locations/')) return value;
    }
    return undefined;
}

function scopeFor(email: string | undefined): Scope {
    if (!email) return [];
    const e = email.toLowerCase();
    if (cached.emails[e]) return cached.emails[e];
    const domain = e.split('@')[1] || '';
    if (cached.domains[domain]) return cached.domains[domain];
    return [];
}

export function isLocationAllowed(email: string | undefined, locationName: string | undefined): boolean {
    if (!locationName) return true; // nothing to scope against (e.g. category lookups)
    const scope = scopeFor(email);
    if (scope === FULL_ACCESS) return true;
    return scope.includes(normalizeLocation(locationName));
}

export function filterAllowedLocations<T extends { name: string }>(email: string | undefined, locations: T[]): T[] {
    const scope = scopeFor(email);
    if (scope === FULL_ACCESS) return locations;
    return locations.filter((l) => scope.includes(normalizeLocation(l.name)));
}

export class LocationNotAuthorizedError extends Error {
    constructor(locationName: string) {
        super(`Not authorized to access ${locationName}. This identity's location scope does not include it.`);
        this.name = 'LocationNotAuthorizedError';
    }
}
