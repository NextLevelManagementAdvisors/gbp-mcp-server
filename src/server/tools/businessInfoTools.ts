/**
 * Business Information tools — InsightfulPipe parity:
 *   get_location_details, get_location_attributes, get_available_attributes,
 *   get_services, get_categories, get_batch_categories, get_verifications
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { BusinessInfoService } from '../../services/businessInfoService.js';

export function createGetLocationDetailsTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Location Details',
            description: 'Retrieve metadata for a Google Business Profile location (title, phone, hours, categories, address, website).',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                readMask: z.string().optional().describe('Comma-separated list of fields to return')
            },
            outputSchema: { name: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.getLocation(args.locationName, args.readMask);
                return {
                    content: [{ type: 'text', text: `Location ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_location_details', e); }
        }
    };
}

export function createGetLocationAttributesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Location Attributes',
            description: 'Get the current set of attributes (e.g. wheelchair_accessible, lgbtq_friendly) on a location.',
            inputSchema: { locationName: z.string() },
            outputSchema: { attributes: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.getAttributes(args.locationName);
                return {
                    content: [{ type: 'text', text: `Attributes for ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_location_attributes', e); }
        }
    };
}

export function createGetAvailableAttributesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Available Attributes',
            description: 'List attributes that are AVAILABLE for a category in a region — the catalog you can pick from.',
            inputSchema: {
                categoryName: z.string().describe('categories/{categoryId} (e.g. categories/gcid:doctor)'),
                regionCode: z.string().default('US'),
                languageCode: z.string().default('en'),
                pageSize: z.number().optional().default(50)
            },
            outputSchema: { attributes: z.array(z.any()).optional(), nextPageToken: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.availableAttributes(args.categoryName, args.regionCode, args.languageCode, args.pageSize);
                return {
                    content: [{ type: 'text', text: `Available attributes for ${args.categoryName} (${args.regionCode})` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_available_attributes', e); }
        }
    };
}

export function createGetServicesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Services',
            description: 'Retrieve serviceItems for a location. Defaults to readMask=serviceItems; pass a comma-separated readMask to fetch additional fields (name,title,categories,serviceItems,...).',
            inputSchema: {
                locationName: z.string(),
                readMask: z.string().optional().describe('Comma-separated fields. Defaults to "serviceItems".')
            },
            outputSchema: { serviceItems: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const readMask = args.readMask && String(args.readMask).trim().length > 0
                    ? String(args.readMask).trim()
                    : 'serviceItems';
                const result = await svc.getLocation(args.locationName, readMask);
                return {
                    content: [{ type: 'text', text: `Services for ${args.locationName} (readMask=${readMask})` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_services', e); }
        }
    };
}

export function createGetCategoriesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Categories',
            description: 'List Business Profile categories with predefined services. Filter by region/language and free-text filter.',
            inputSchema: {
                regionCode: z.string().default('US'),
                languageCode: z.string().default('en'),
                filter: z.string().optional().describe('e.g. displayName=*doctor*'),
                view: z.enum(['BASIC', 'FULL', 'CATEGORY_VIEW_UNSPECIFIED']).default('BASIC'),
                pageSize: z.number().optional().default(100)
            },
            outputSchema: { categories: z.array(z.any()).optional(), nextPageToken: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.listCategories({
                    regionCode: args.regionCode,
                    languageCode: args.languageCode,
                    filter: args.filter,
                    view: args.view,
                    pageSize: args.pageSize
                });
                return {
                    content: [{ type: 'text', text: `Categories (${args.regionCode}/${args.languageCode})` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_categories', e); }
        }
    };
}

export function createGetBatchCategoriesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Batch Categories',
            description: 'Resolve specific category IDs to their full details (service types, etc.).',
            inputSchema: {
                names: z.array(z.string()).min(1).describe('Array of categories/{categoryId}'),
                regionCode: z.string().default('US'),
                languageCode: z.string().default('en'),
                view: z.enum(['BASIC', 'FULL', 'CATEGORY_VIEW_UNSPECIFIED']).default('FULL')
            },
            outputSchema: { categories: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.batchCategories(args.names, {
                    regionCode: args.regionCode,
                    languageCode: args.languageCode,
                    view: args.view
                });
                return {
                    content: [{ type: 'text', text: `Batch resolved ${args.names.length} categories` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_batch_categories', e); }
        }
    };
}

export function createUpdateLocationTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Update Location',
            description:
                'Update fields on a Google Business Profile location (PATCH with updateMask). ' +
                'Provide only the fields you want to overwrite — mask gates which top-level keys ' +
                'are written. Common use: change title, primary/additional categories, websiteUri, ' +
                'profile.description, regularHours, phoneNumbers. Use update_services for serviceItems.',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                updateMask: z.string().describe('Comma-separated list of top-level fields to overwrite (e.g. "title,categories,websiteUri")'),
                title: z.string().optional(),
                websiteUri: z.string().optional(),
                phoneNumbers: z.any().optional().describe('{primaryPhone, additionalPhones[]}'),
                categories: z.any().optional().describe('{primaryCategory:{name}, additionalCategories:[{name}]}'),
                profile: z.any().optional().describe('{description: string}'),
                regularHours: z.any().optional(),
                specialHours: z.any().optional(),
                storeCode: z.string().optional(),
                labels: z.array(z.string()).optional(),
                openInfo: z.any().optional()
            },
            outputSchema: { name: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                // Strip control args, pass everything else as the PATCH body so
                // the caller doesn't have to construct it explicitly.
                const { locationName, updateMask, ...body } = args;
                const result = await svc.updateLocation(locationName, body, updateMask);
                return {
                    content: [{ type: 'text', text: `Updated ${locationName} (mask: ${updateMask})` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('update_location', e); }
        }
    };
}

export function createUpdateServicesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Update Services',
            description:
                'Replace the serviceItems list on a location. Pass the full new list — ' +
                'GBP does not merge; serviceItems updateMask is a full overwrite. Each item is ' +
                'either {structuredServiceItem:{serviceTypeId}} (predefined) or ' +
                '{freeFormServiceItem:{label:{displayName}}} (custom).',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                serviceItems: z.array(z.any()).describe(
                    'Full new list of service items. Mixing structured + free-form is fine.'
                )
            },
            outputSchema: { serviceItems: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.updateLocation(
                    args.locationName,
                    { serviceItems: args.serviceItems },
                    'serviceItems'
                );
                return {
                    content: [{ type: 'text', text: `Replaced ${args.serviceItems.length} service items on ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('update_services', e); }
        }
    };
}

export function createSetAttributesTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Set Attributes',
            description:
                'Replace the attributes list on a location (e.g. wheelchair_accessible, ' +
                'lgbtq_friendly). Get the catalog of available attribute IDs for the primary ' +
                'category via get_available_attributes first. Full overwrite — pass the complete list.',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                attributes: z.array(z.any()).describe(
                    'Full attributes list. Each attribute: {name: "attributes/<attrId>", values: [<bool|string>]}'
                )
            },
            outputSchema: { attributes: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.setAttributes(args.locationName, args.attributes);
                return {
                    content: [{ type: 'text', text: `Set ${args.attributes.length} attributes on ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('set_attributes', e); }
        }
    };
}

export function createGetVerificationsTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Verifications',
            description: 'List verification attempts (and their states) for a location.',
            inputSchema: { locationName: z.string() },
            outputSchema: { verifications: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.verifications(args.locationName);
                return {
                    content: [{ type: 'text', text: `Verifications for ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_verifications', e); }
        }
    };
}

function errorResult(toolName: string, e: unknown): CallToolResult {
    logger.error(`${toolName} failed`, e);
    return {
        content: [{ type: 'text', text: `${toolName} failed: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true
    };
}
