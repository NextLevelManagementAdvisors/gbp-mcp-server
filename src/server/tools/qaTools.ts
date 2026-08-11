/**
 * Q&A tools — beyond InsightfulPipe. Critical for medical practices to
 * own answers to common patient questions before competitors plant them.
 *   get_questions, upsert_answer, delete_answer, delete_question
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { QAService } from '../../services/qaService.js';

export function createGetQuestionsTool(svc: QAService) {
    return {
        schema: {
            title: 'Get Questions',
            description: 'List questions asked about a Google Business Profile location, with the top answer(s) inline.',
            inputSchema: {
                locationName: z.string(),
                pageSize: z.number().optional().default(50),
                pageToken: z.string().optional(),
                answersPerQuestion: z.number().optional().default(10)
            },
            outputSchema: { questions: z.array(z.any()), totalSize: z.number().optional(), nextPageToken: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.listQuestions(args.locationName, args.pageSize, args.pageToken, args.answersPerQuestion);
                return {
                    content: [{ type: 'text', text: `${result.totalSize ?? result.questions?.length ?? 0} questions on ${args.locationName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_questions', e); }
        }
    };
}

export function createUpsertAnswerTool(svc: QAService) {
    return {
        schema: {
            title: 'Upsert Owner Answer',
            description: 'Add or update the OWNER answer to a Google Business Profile question. There can be only one owner answer per question.',
            inputSchema: {
                questionName: z.string().describe('locations/{l}/questions/{q}'),
                text: z.string().min(1).max(4000).describe('Answer text (max 4000 chars)')
            },
            outputSchema: { name: z.string().optional(), text: z.string().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const result = await svc.upsertAnswer(args.questionName, args.text);
                return {
                    content: [{ type: 'text', text: `Owner answer posted on ${args.questionName}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('upsert_answer', e); }
        }
    };
}

export function createDeleteAnswerTool(svc: QAService) {
    return {
        schema: {
            title: 'Delete Answer',
            description: 'Delete an answer.',
            inputSchema: { answerName: z.string() },
            outputSchema: { ok: z.boolean() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                await svc.deleteAnswer(args.answerName);
                return { content: [{ type: 'text', text: `Answer deleted: ${args.answerName}` }], structuredContent: { ok: true } };
            } catch (e) { return errorResult('delete_answer', e); }
        }
    };
}

export function createDeleteQuestionTool(svc: QAService) {
    return {
        schema: {
            title: 'Delete Question',
            description: 'Delete a question (only your own questions can be deleted).',
            inputSchema: { questionName: z.string() },
            outputSchema: { ok: z.boolean() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                await svc.deleteQuestion(args.questionName);
                return { content: [{ type: 'text', text: `Question deleted: ${args.questionName}` }], structuredContent: { ok: true } };
            } catch (e) { return errorResult('delete_question', e); }
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
