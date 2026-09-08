/**
 * Shared response helpers for MCP tool handlers.
 *
 * Some MCP clients only surface `content` text to the model and never
 * forward `structuredContent` (see PR #4, issue #5). Every tool handler must
 * therefore serialize its fetched payload into the text content itself
 * rather than relying on structuredContent alone. Use `toolSuccess` /
 * `toolError` for every new tool so this can't regress.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../utils/logger.js';

export function toolSuccess(summary: string, data: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: `${summary}:\n${JSON.stringify(data, null, 2)}` }],
        structuredContent: data as any
    };
}

export function toolError(toolName: string, e: unknown): CallToolResult {
    logger.error(`${toolName} failed`, e);
    return {
        content: [{ type: 'text', text: `${toolName} failed: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true
    };
}
