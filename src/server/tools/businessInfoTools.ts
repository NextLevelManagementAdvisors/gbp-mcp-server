/**
 * Business Information tools — InsightfulPipe parity:
 *   get_location_details, get_location_attributes, get_available_attributes,
 *   get_services, get_categories, get_batch_categories, get_verifications
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { BusinessInfoService } from '../../services/businessInfoService.js';
import { toolSuccess, toolError } from './toolResponse.js';

export function createGetLocationDetailsTool(svc: BusinessInfoService) {
    return {
        schema: {
            title: 'Get Location Details',
            description: 'Retrieve metadata for a Google Business Profile location (title, phone, hours, categories, address, website).',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                readMask: z.string()
                    .optional()
                    .default('name,title,storefrontAddress,phoneNumbers,websiteUri,categories,regularHours,latlng,metadata')
                    .describe(
                        'Comma-separated list of fields to return. The upstream API requires this ' +
                        'parameter; if omitted, a sensible default field set is used.'
                    )
            },
            outputSchema: {
                name: z.string().optional(),
                title: z.string().optional(),
                storefrontAddress: z.any().optional(),
                phoneNumbers: z.any().optional(),
                websiteUri: z.string().optional(),
                categories: z.any().optional(),
                regularHours: z.any().optional(),
                specialHours: z.any().optional(),
                latlng: z.any().optional(),
                metadata: z.any().optional(),
                profile: z.any().optional(),
                serviceArea: z.any().optional(),
                labels: z.array(z.string()).optional(),
                openInfo: z.any().optional(),
                relationshipData: z.any().optional(),
                moreHours: z.any().optional(),
                languageCode: z.string().optional(),
                storeCode: z.string().optional()
            }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.getLocation(args.locationName, args.readMask);
                return toolSuccess(`Location ${args.locationName}`, result);
            } catch (e) { return toolError('get_location_details', e); }
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
                return toolSuccess(`Attributes for ${args.locationName}`, result);
            } catch (e) { return toolError('get_location_attributes', e); }
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
                return toolSuccess(`Available attributes for ${args.categoryName} (${args.regionCode})`, result);
            } catch (e) { return toolError('get_available_attributes', e); }
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
                return toolSuccess(`Services for ${args.locationName} (readMask=${readMask})`, result);
            } catch (e) { return toolError('get_services', e); }
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
                return toolSuccess(`Categories (${args.regionCode}/${args.languageCode})`, result);
            } catch (e) { return toolError('get_categories', e); }
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
                return toolSuccess(`Batch resolved ${args.names.length} categories`, result);
            } catch (e) { return toolError('get_batch_categories', e); }
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
                'profile.description, regularHours, phoneNumbers, storefrontAddress. Set validateOnly ' +
                'to preview a normalized result without writing (recommended for address edits, since ' +
                'a bad address on a verified profile can trigger re-verification). ' +
                'Use update_services for serviceItems.',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                updateMask: z.string().describe('Comma-separated list of top-level fields to overwrite (e.g. "title,categories,websiteUri,storefrontAddress")'),
                validateOnly: z.boolean().optional().describe(
                    'If true, validates and returns the normalized request without actually updating ' +
                    'the location. Maps to the API\'s validateOnly query param.'
                ),
                title: z.string().optional(),
                websiteUri: z.string().optional(),
                phoneNumbers: z.any().optional().describe('{primaryPhone, additionalPhones[]}'),
                categories: z.any().optional().describe('{primaryCategory:{name}, additionalCategories:[{name}]}'),
                profile: z.any().optional().describe('{description: string}'),
                regularHours: z.any().optional(),
                specialHours: z.any().optional(),
                storeCode: z.string().optional(),
                labels: z.array(z.string()).optional(),
                openInfo: z.any().optional(),
                storefrontAddress: z.any().optional().describe(
                    'PostalAddress: {regionCode, languageCode, postalCode, administrativeArea, locality, ' +
                    'addressLines[], sublocality?, sortingCode?, organization?, recipients[]?}. Note: after ' +
                    'a successful address change, latlng is expected to come back null — Google discards ' +
                    'the prior pin and re-geocodes asynchronously. That is not data loss.'
                )
            },
            outputSchema: { name: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                // Strip control args, pass everything else as the PATCH body so
                // the caller doesn't have to construct it explicitly.
                const { locationName, updateMask, validateOnly, ...body } = args;
                const result = await svc.updateLocation(locationName, body, updateMask, validateOnly);
                const suffix = validateOnly ? ' [validateOnly — not written]' : '';
                return toolSuccess(`Updated ${locationName} (mask: ${updateMask})${suffix}`, result);
            } catch (e) { return toolError('update_location', e); }
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
                return toolSuccess(`Replaced ${args.serviceItems.length} service items on ${args.locationName}`, result);
            } catch (e) { return toolError('update_services', e); }
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
                return toolSuccess(`Set ${args.attributes.length} attributes on ${args.locationName}`, result);
            } catch (e) { return toolError('set_attributes', e); }
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
                return toolSuccess(`Verifications for ${args.locationName}`, result);
            } catch (e) { return toolError('get_verifications', e); }
        }
    };
}
