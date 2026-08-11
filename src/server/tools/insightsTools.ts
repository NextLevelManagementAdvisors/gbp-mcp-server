/**
 * Insights tools — Business Profile Performance API:
 *   get_daily_metrics, get_multi_daily_metrics, get_search_keywords
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { InsightsService, DailyMetric, DateRange } from '../../services/insightsService.js';

const dailyMetricSchema = z.enum([
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_CONVERSATIONS', 'BUSINESS_DIRECTION_REQUESTS',
    'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_BOOKINGS',
    'BUSINESS_FOOD_ORDERS', 'BUSINESS_FOOD_MENU_CLICKS'
]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

function parseRange(start: string, end: string): DateRange {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    return {
        startDate: { year: sy, month: sm, day: sd },
        endDate: { year: ey, month: em, day: ed }
    };
}

export function createGetDailyMetricsTool(insightsService: InsightsService) {
    return {
        schema: {
            title: 'Get Daily Metrics',
            description: 'Daily metric time series for a single Business Profile metric over a date range.',
            inputSchema: {
                locationName: z.string().describe('locations/{locationId}'),
                metric: dailyMetricSchema,
                startDate: isoDateSchema.describe('YYYY-MM-DD inclusive start'),
                endDate: isoDateSchema.describe('YYYY-MM-DD inclusive end')
            },
            outputSchema: { dailyMetric: z.string().optional(), timeSeries: z.any().optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const range = parseRange(args.startDate, args.endDate);
                const result = await insightsService.dailyMetric(args.locationName, args.metric as DailyMetric, range);
                return {
                    content: [{ type: 'text', text: `Daily metric ${args.metric} ${args.startDate} → ${args.endDate}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_daily_metrics', e); }
        }
    };
}

export function createGetMultiDailyMetricsTool(insightsService: InsightsService) {
    return {
        schema: {
            title: 'Get Multi Daily Metrics',
            description: 'Fetch multiple daily metrics for a single location in one call.',
            inputSchema: {
                locationName: z.string(),
                metrics: z.array(dailyMetricSchema).min(1).max(10),
                startDate: isoDateSchema,
                endDate: isoDateSchema
            },
            outputSchema: { multiDailyMetricTimeSeries: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const range = parseRange(args.startDate, args.endDate);
                const result = await insightsService.multiDailyMetrics(args.locationName, args.metrics as DailyMetric[], range);
                return {
                    content: [{ type: 'text', text: `Multi-metric report (${args.metrics.length} metrics) ${args.startDate} → ${args.endDate}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_multi_daily_metrics', e); }
        }
    };
}

export function createGetSearchKeywordsTool(insightsService: InsightsService) {
    return {
        schema: {
            title: 'Get Search Keywords',
            description: 'Monthly search keyword impression counts — what queries surfaced this Business Profile.',
            inputSchema: {
                locationName: z.string(),
                startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
                endMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
            },
            outputSchema: { searchKeywordsCounts: z.array(z.any()).optional() }
        },
        handler: async (args: any): Promise<CallToolResult> => {
            try {
                const [sy, sm] = args.startMonth.split('-').map(Number);
                const [ey, em] = args.endMonth.split('-').map(Number);
                const result = await insightsService.searchKeywords(args.locationName, {
                    startMonth: { year: sy, month: sm },
                    endMonth: { year: ey, month: em }
                });
                return {
                    content: [{ type: 'text', text: `Search keywords ${args.startMonth} → ${args.endMonth}` }],
                    structuredContent: result as any
                };
            } catch (e) { return errorResult('get_search_keywords', e); }
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
