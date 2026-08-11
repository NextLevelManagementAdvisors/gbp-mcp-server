/**
 * Delete Review Reply tool — InsightfulPipe parity (delete_review_reply).
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { IReviewService } from '../../types/index.js';
import type { CallToolResult } from "@modelcontextprotocol/server";

export function createDeleteReviewReplyTool(reviewService: IReviewService) {
    return {
        schema: {
            title: 'Delete Review Reply',
            description: 'Delete the owner reply on a specific review. The original review remains; only the response is removed.',
            inputSchema: {
                locationName: z.string().describe('Full resource name of the business location'),
                reviewId: z.string().describe('The ID of the review whose reply should be deleted')
            },
            outputSchema: { success: z.boolean(), message: z.string() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                logger.info('delete_review_reply', { locationName: args.locationName, reviewId: args.reviewId });
                if (!args.locationName?.trim() || !args.reviewId?.trim()) {
                    return { content: [{ type: 'text', text: 'Error: locationName and reviewId are required' }], isError: true };
                }
                const result = await reviewService.deleteReply(args.locationName, args.reviewId);
                if (!result.success) {
                    return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
                }
                return {
                    content: [{ type: 'text', text: `Reply deleted on review ${args.reviewId}.` }],
                    structuredContent: { success: true, message: 'Reply deleted' }
                };
            } catch (e) {
                return {
                    content: [{ type: 'text', text: `delete_review_reply failed: ${e instanceof Error ? e.message : String(e)}` }],
                    isError: true
                };
            }
        }
    };
}
