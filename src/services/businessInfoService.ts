/**
 * Business Information service — location metadata, attributes, services,
 * categories, and verification status.
 *
 * GBP API surface: HOSTS.BUSINESS_INFO (mybusinessbusinessinformation.googleapis.com/v1)
 *   GET    locations/{l}                                  → location details (readMask)
 *   PATCH  locations/{l}                                  → update fields (updateMask)
 *   GET    locations/{l}/attributes                       → current attributes
 *   PATCH  locations/{l}/attributes                       → set attributes (attributeMask)
 *   GET    attributes (?categoryName=, regionCode=, ...)  → available attributes for category/region
 *   GET    categories  (?regionCode=, languageCode=, ...) → list categories with predefined services
 *   POST   categories:batchGet                            → resolve specific category IDs to service items
 *
 * Verifications surface: HOSTS.VERIFICATIONS (mybusinessverifications.googleapis.com/v1)
 *   GET locations/{l}/verifications                       → list verification attempts
 *
 * STATUS: stubbed.
 */

import { GoogleMyBusinessApiClient } from './apiClient.js';
import { GOOGLE_API } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class BusinessInfoService {
    constructor(private apiClient: GoogleMyBusinessApiClient, private mockMode = false) {}

    async getLocation(locationName: string, readMask?: string) {
        if (this.mockMode) return this.mockLocation(locationName, readMask);
        return this.apiClient.get(locationName, readMask ? { readMask } : undefined, GOOGLE_API.HOSTS.BUSINESS_INFO);
    }

    async updateLocation(locationName: string, body: any, updateMask: string, validateOnly?: boolean) {
        if (this.mockMode) {
            logger.info('mock updateLocation', { locationName, updateMask, validateOnly });
            // Persist updates into the per-process mock store so subsequent
            // getLocation calls reflect the change. updateMask gates which
            // top-level fields actually overwrite. validateOnly never writes.
            const state = getMockLocationState(locationName);
            const fields = updateMask.split(',').map(s => s.trim()).filter(Boolean);
            if (validateOnly) {
                const preview = { ...state };
                for (const f of fields) if (f in body) preview[f] = body[f];
                return preview;
            }
            for (const f of fields) {
                if (f in body) state[f] = body[f];
            }
            return { ...state };
        }
        return this.apiClient.patch(locationName, body, { updateMask, validateOnly }, GOOGLE_API.HOSTS.BUSINESS_INFO);
    }

    async getAttributes(locationName: string) {
        if (this.mockMode) {
            const state = getMockLocationState(locationName);
            return { name: `${locationName}/attributes`, attributes: state.attributes ?? [] };
        }
        return this.apiClient.get(`${locationName}/attributes`, undefined, GOOGLE_API.HOSTS.BUSINESS_INFO);
    }

    async setAttributes(locationName: string, attributes: any[]) {
        if (this.mockMode) {
            logger.info('mock setAttributes', { locationName, count: attributes.length });
            const state = getMockLocationState(locationName);
            state.attributes = attributes;
            return { name: `${locationName}/attributes`, attributes };
        }
        // attributeMask must be the fully-qualified attribute names being written
        // (e.g. "attributes/has_onsite_parking"), not the literal field name
        // "attributes" — the API rejects the latter with INVALID_ATTRIBUTE_NAME.
        const attributeMask = attributes.map(a => a.name).join(',');
        return this.apiClient.patch(`${locationName}/attributes`, { attributes }, { attributeMask }, GOOGLE_API.HOSTS.BUSINESS_INFO);
    }

    async availableAttributes(categoryName: string, regionCode = 'US', languageCode = 'en', pageSize = 50) {
        if (this.mockMode) return { attributes: [], nextPageToken: undefined };
        return this.apiClient.get(
            'attributes',
            { categoryName, regionCode, languageCode, pageSize },
            GOOGLE_API.HOSTS.BUSINESS_INFO
        );
    }

    async listCategories(opts: { regionCode?: string; languageCode?: string; filter?: string; view?: string; pageSize?: number } = {}) {
        if (this.mockMode) {
            const filtered = filterMockCategories(MOCK_CATEGORIES, opts.filter);
            const size = opts.pageSize ?? 100;
            return { categories: filtered.slice(0, size), nextPageToken: undefined };
        }
        return this.apiClient.get(
            'categories',
            { regionCode: 'US', languageCode: 'en', view: 'BASIC', pageSize: 100, ...opts },
            GOOGLE_API.HOSTS.BUSINESS_INFO
        );
    }

    async batchCategories(names: string[], opts: { regionCode?: string; languageCode?: string; view?: string } = {}) {
        if (this.mockMode) return { categories: [] };
        return this.apiClient.get(
            'categories:batchGet',
            { names: names.join(','), regionCode: 'US', languageCode: 'en', view: 'FULL', ...opts },
            GOOGLE_API.HOSTS.BUSINESS_INFO
        );
    }

    async verifications(locationName: string) {
        if (this.mockMode) return { verifications: [] };
        return this.apiClient.get(`${locationName}/verifications`, undefined, GOOGLE_API.HOSTS.VERIFICATIONS);
    }

    private mockLocation(locationName: string, readMask?: string) {
        const full = getMockLocationState(locationName);
        if (!readMask) return { ...full };
        const fields = readMask.split(',').map(s => s.trim()).filter(Boolean);
        const projected: Record<string, any> = { name: full.name };
        for (const f of fields) if (f in full) projected[f] = full[f];
        return projected;
    }
}

// Per-process mock store. Initialized lazily from the seed below the first
// time a location is referenced, then mutated in place by updateLocation /
// setAttributes so subsequent reads see the update. Reset by reloading the
// MCP server.
const _MOCK_LOCATION_STATE: Record<string, Record<string, any>> = {};

function getMockLocationState(locationName: string): Record<string, any> {
    if (!_MOCK_LOCATION_STATE[locationName]) {
        _MOCK_LOCATION_STATE[locationName] = seedMockLocation(locationName);
    }
    return _MOCK_LOCATION_STATE[locationName];
}

function seedMockLocation(locationName: string): Record<string, any> {
    return {
        name: locationName,
        languageCode: 'en',
        storeCode: 'CLT-001',
        title: 'Dr. James DuRant — Sexual Health Clinic',
        phoneNumbers: { primaryPhone: '+18432521351' },
        categories: { primaryCategory: { name: 'categories/gcid:sexologist' } },
        websiteUri: 'https://doctordurant.com',
        regularHours: { periods: [] },
        attributes: [],
        serviceItems: [
            {
                structuredServiceItem: { serviceTypeId: 'job_type_id:mens_sexual_health_consultation' },
                freeFormServiceItem: { label: { displayName: 'Men\'s Sexual Health Consultation' } }
            },
            {
                freeFormServiceItem: { label: { displayName: 'Premature Ejaculation Treatment' } }
            },
            {
                freeFormServiceItem: { label: { displayName: 'Erectile Dysfunction Evaluation' } }
            },
            {
                freeFormServiceItem: { label: { displayName: 'Pelvic Floor Therapy' } }
            }
        ]
    };
}

const MOCK_CATEGORIES = [
    { name: 'categories/gcid:sexologist', displayName: 'Sexologist', serviceTypes: [] },
    { name: 'categories/gcid:doctor', displayName: 'Doctor', serviceTypes: [] },
    { name: 'categories/gcid:physician', displayName: 'Physician', serviceTypes: [] },
    { name: 'categories/gcid:internist', displayName: 'Internist', serviceTypes: [] },
    { name: 'categories/gcid:family_practice_physician', displayName: 'Family Practice Physician', serviceTypes: [] },
    { name: 'categories/gcid:pediatrician', displayName: 'Pediatrician', serviceTypes: [] },
    { name: 'categories/gcid:urologist', displayName: 'Urologist', serviceTypes: [] },
    { name: 'categories/gcid:psychologist', displayName: 'Psychologist', serviceTypes: [] },
    { name: 'categories/gcid:psychiatrist', displayName: 'Psychiatrist', serviceTypes: [] },
    { name: 'categories/gcid:mental_health_clinic', displayName: 'Mental Health Clinic', serviceTypes: [] },
    { name: 'categories/gcid:medical_clinic', displayName: 'Medical Clinic', serviceTypes: [] },
    { name: 'categories/gcid:physical_therapist', displayName: 'Physical Therapist', serviceTypes: [] }
];

// Supports Google's filter syntax at a minimum: `displayName=*term*` (case-insensitive
// substring), `displayName=Pediatrician` (exact), or any of those joined with AND.
function filterMockCategories(cats: typeof MOCK_CATEGORIES, filter?: string) {
    if (!filter) return cats;
    const clauses = filter.split(/\s+AND\s+/i).map(c => c.trim()).filter(Boolean);
    return cats.filter(cat =>
        clauses.every(clause => {
            const m = clause.match(/^([A-Za-z_]+)\s*=\s*(.+)$/);
            if (!m) return true;
            const [, field, rawValue] = m;
            const value = rawValue.replace(/^['"]|['"]$/g, '').toLowerCase();
            const target = String((cat as any)[field] ?? '').toLowerCase();
            if (value.startsWith('*') && value.endsWith('*')) return target.includes(value.slice(1, -1));
            if (value.startsWith('*')) return target.endsWith(value.slice(1));
            if (value.endsWith('*')) return target.startsWith(value.slice(0, -1));
            return target === value;
        })
    );
}
