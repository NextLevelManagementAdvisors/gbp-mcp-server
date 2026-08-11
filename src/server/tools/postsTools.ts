/**
 * Local Posts tools — InsightfulPipe parity:
 *   get_local_posts, create_local_post, update_local_post, delete_local_post
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PostService, LocalPost, LocalPostType } from '../../services/postService.js';

const postTopicTypeSchema = z.enum(['STANDARD', 'EVENT', 'OFFER', 'ALERT']);

export function createGetLocalPostsTool(postService: PostService) {
    return {
        schema: {
            title: 'Get Local Posts',
            description: 'Retrieve local posts (updates, events, offers, alerts) created for a Google Business Profile location.',
            inputSchema: {
                locationName: z.string().describe('Full resource name (accounts/{a}/locations/{l})'),
                pageSize: z.number().optional().default(100),
                pageToken: z.string().optional()
            },
            outputSchema: { localPosts: z.array(z.any()), nextPageToken: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('get_local_posts', { locationName: args.locationName });
                const result = await postService.list(args.locationName, args.pageSize, args.pageToken);
                return {
                    content: [{ type: 'text', text: `Found ${result.localPosts?.length || 0} local posts.` }],
                    structuredContent: result as any
                };
            } catch (e) {
                return errorResult('get_local_posts', e);
            }
        }
    };
}

export function createCreateLocalPostTool(postService: PostService) {
    return {
        schema: {
            title: 'Create Local Post',
            description: 'Create a STANDARD update, EVENT, OFFER, or ALERT post on a Google Business Profile location.',
            inputSchema: {
                locationName: z.string().describe('Full resource name (accounts/{a}/locations/{l})'),
                summary: z.string().min(1).max(1500).describe('Post body text (max 1500 chars)'),
                topicType: postTopicTypeSchema.default('STANDARD').describe('Post type'),
                languageCode: z.string().optional().default('en'),
                callToAction: z.object({
                    actionType: z.enum(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']),
                    url: z.string().url().optional()
                }).optional(),
                media: z.array(z.object({
                    mediaFormat: z.enum(['PHOTO', 'VIDEO']),
                    sourceUrl: z.string().url()
                })).optional(),
                event: z.object({
                    title: z.string(),
                    schedule: z.object({ startDate: z.any(), endDate: z.any() })
                }).optional(),
                offer: z.object({
                    couponCode: z.string().optional(),
                    redeemOnlineUrl: z.string().url().optional(),
                    termsConditions: z.string().optional()
                }).optional()
            },
            outputSchema: { name: z.string().optional(), state: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('create_local_post', { locationName: args.locationName, topicType: args.topicType });
                const post: Partial<LocalPost> = {
                    summary: args.summary,
                    topicType: args.topicType as LocalPostType,
                    languageCode: args.languageCode,
                    callToAction: args.callToAction,
                    media: args.media,
                    event: args.event,
                    offer: args.offer
                };
                const result = await postService.create(args.locationName, post);
                return {
                    content: [{ type: 'text', text: `Post created: ${result.name || '(pending)'}` }],
                    structuredContent: result as any
                };
            } catch (e) {
                return errorResult('create_local_post', e);
            }
        }
    };
}

export function createUpdateLocalPostTool(postService: PostService) {
    return {
        schema: {
            title: 'Update Local Post',
            description: 'Edit an existing local post. Pass updateMask listing fields to overwrite (comma-separated, e.g. "summary,callToAction").',
            inputSchema: {
                postName: z.string().describe('Full post resource name (accounts/{a}/locations/{l}/localPosts/{p})'),
                updateMask: z.string().describe('Comma-separated list of fields to update'),
                summary: z.string().optional(),
                callToAction: z.any().optional(),
                media: z.array(z.any()).optional(),
                event: z.any().optional(),
                offer: z.any().optional()
            },
            outputSchema: { name: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('update_local_post', { postName: args.postName, updateMask: args.updateMask });
                const { postName, updateMask, ...patch } = args;
                const result = await postService.update(postName, patch as Partial<LocalPost>, updateMask);
                return {
                    content: [{ type: 'text', text: `Post updated: ${result.name}` }],
                    structuredContent: result as any
                };
            } catch (e) {
                return errorResult('update_local_post', e);
            }
        }
    };
}

export function createDeleteLocalPostTool(postService: PostService) {
    return {
        schema: {
            title: 'Delete Local Post',
            description: 'Delete a local post by name.',
            inputSchema: { postName: z.string().describe('Full post resource name') },
            outputSchema: { ok: z.boolean() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('delete_local_post', { postName: args.postName });
                await postService.delete(args.postName);
                return { content: [{ type: 'text', text: `Post deleted: ${args.postName}` }], structuredContent: { ok: true } };
            } catch (e) {
                return errorResult('delete_local_post', e);
            }
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
