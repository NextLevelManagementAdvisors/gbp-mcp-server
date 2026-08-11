/**
 * Media tools — InsightfulPipe parity:
 *   get_media, create_media, start_media_upload, delete_media
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { MediaService, MediaCategory } from '../../services/mediaService.js';

const categorySchema = z.enum([
    'COVER', 'PROFILE', 'LOGO', 'EXTERIOR', 'INTERIOR',
    'PRODUCT', 'AT_WORK', 'FOOD_AND_DRINK', 'MENU', 'COMMON_AREA',
    'ROOMS', 'TEAMS', 'ADDITIONAL'
]);

export function createGetMediaTool(mediaService: MediaService) {
    return {
        schema: {
            title: 'Get Media',
            description: 'List media items (photos and videos) attached to a Google Business Profile location.',
            inputSchema: {
                locationName: z.string(),
                pageSize: z.number().optional().default(100),
                pageToken: z.string().optional()
            },
            outputSchema: { mediaItems: z.array(z.any()), totalMediaItemCount: z.number().optional(), nextPageToken: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await mediaService.list(args.locationName, args.pageSize, args.pageToken);
                return {
                    content: [{ type: 'text', text: `Found ${result.mediaItems?.length || 0} media items.` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_media', e); }
        }
    };
}

export function createCreateMediaTool(mediaService: MediaService) {
    return {
        schema: {
            title: 'Create Media',
            description: 'Upload a photo or video to a location from a public URL. For local file uploads, use start_media_upload first.',
            inputSchema: {
                locationName: z.string(),
                sourceUrl: z.string().url().describe('Publicly accessible URL of the media file'),
                category: categorySchema.default('ADDITIONAL').describe('Where the media appears on the listing'),
                mediaFormat: z.enum(['PHOTO', 'VIDEO']).default('PHOTO'),
                description: z.string().optional()
            },
            outputSchema: { name: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('create_media', { locationName: args.locationName, category: args.category });
                const result = await mediaService.createFromUrl(
                    args.locationName,
                    args.sourceUrl,
                    args.category as MediaCategory,
                    args.mediaFormat,
                    args.description
                );
                return {
                    content: [{ type: 'text', text: `Media uploaded: ${result.name || '(pending)'}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('create_media', e); }
        }
    };
}

export function createStartMediaUploadTool(mediaService: MediaService) {
    return {
        schema: {
            title: 'Start Media Upload',
            description: 'Begin a streamed byte upload. Returns resourceName to use in the subsequent upload PUT.',
            inputSchema: { locationName: z.string() },
            outputSchema: { resourceName: z.string() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await mediaService.startUpload(args.locationName);
                return {
                    content: [{ type: 'text', text: `Upload started. resourceName=${result.resourceName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('start_media_upload', e); }
        }
    };
}

export function createDeleteMediaTool(mediaService: MediaService) {
    return {
        schema: {
            title: 'Delete Media',
            description: 'Delete a media item by name.',
            inputSchema: { mediaName: z.string() },
            outputSchema: { ok: z.boolean() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                await mediaService.delete(args.mediaName);
                return { content: [{ type: 'text', text: `Media deleted: ${args.mediaName}` }], structuredContent: { ok: true } };
            } catch (e) { return errorResult('delete_media', e); }
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
