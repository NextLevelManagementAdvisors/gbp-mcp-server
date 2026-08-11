/**
 * Main MCP Server implementation for Google Business Profile Review management
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer as BaseMcpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from 'zod';

import { getConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { GoogleAuthService } from '../services/googleAuth.js';
import { ReviewService } from '../services/reviewService.js';
import { MockReviewService } from '../services/mockReviewService.js';
import { LLMService } from '../services/llmService.js';
import { GoogleMyBusinessApiClient } from '../services/apiClient.js';
import { PostService } from '../services/postService.js';
import { QAService } from '../services/qaService.js';
import { MediaService } from '../services/mediaService.js';
import { InsightsService } from '../services/insightsService.js';
import { BusinessInfoService } from '../services/businessInfoService.js';
import type { IReviewService } from '../types/index.js';

// Import tool implementations
import { createListLocationsTool } from './tools/listLocations.js';
import { createGetUnRepliedReviewsTool } from './tools/getReviews.js';
import { createGenerateReplyTool } from './tools/generateReply.js';
import { createPostReplyTool } from './tools/postReply.js';
import { createDeleteReviewReplyTool } from './tools/deleteReviewReply.js';
import { createGetReviewDayStatsTool } from './tools/getReviewDayStats.js';
import {
    createGetLocalPostsTool, createCreateLocalPostTool,
    createUpdateLocalPostTool, createDeleteLocalPostTool
} from './tools/postsTools.js';
import {
    createGetMediaTool, createCreateMediaTool,
    createStartMediaUploadTool, createDeleteMediaTool
} from './tools/mediaTools.js';
import {
    createGetDailyMetricsTool, createGetMultiDailyMetricsTool, createGetSearchKeywordsTool
} from './tools/insightsTools.js';
import {
    createGetLocationDetailsTool, createGetLocationAttributesTool, createGetAvailableAttributesTool,
    createGetServicesTool, createGetCategoriesTool, createGetBatchCategoriesTool, createGetVerificationsTool,
    createUpdateLocationTool, createUpdateServicesTool, createSetAttributesTool
} from './tools/businessInfoTools.js';
import {
    createGetQuestionsTool, createUpsertAnswerTool,
    createDeleteAnswerTool, createDeleteQuestionTool
} from './tools/qaTools.js';

// Import resource implementations
import { createBusinessProfileResource } from './resources/businessProfile.js';
import { createReviewTemplatesResource } from './resources/reviewTemplates.js';
import { createLocationsResource } from './resources/locations.js';
import { createReviewsResource } from './resources/reviews.js';

// Import prompt implementations
import { createReviewResponsePrompt } from './prompts/reviewResponse.js';
import { createSentimentAnalysisPrompt } from './prompts/sentimentAnalysis.js';
import { createManageReviewsPrompt } from './prompts/manageReviews.js';
import { createAnalyzeReviewStatsPrompt } from './prompts/analyzeReviewStats.js';

export class McpServer {
    private config = getConfig();
    private server: BaseMcpServer;
    
    // Services
    private googleAuthService?: GoogleAuthService;
    private reviewService: IReviewService;
    private llmService: LLMService;
    private postService: PostService;
    private qaService: QAService;
    private mediaService: MediaService;
    private insightsService: InsightsService;
    private businessInfoService: BusinessInfoService;
    private isMockMode: boolean;
    
    constructor() {
        // Check if we're in mock mode
        this.isMockMode = process.env.NODE_ENV === 'test' || 
                         process.env.NODE_ENV === 'development' || 
                         process.env.ENABLE_MOCK_MODE === 'true';
        
        // Initialize MCP server
        this.server = new BaseMcpServer(
            {
                name: this.config.mcpServerName,
                version: this.config.mcpServerVersion
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {},
                    logging: {}
                }
            }
        );
        
        // Initialize services based on mode
        let apiClient: GoogleMyBusinessApiClient | null = null;
        if (this.isMockMode) {
            logger.info('🧪 Starting in MOCK MODE - No Google API required');
            this.reviewService = new MockReviewService();
        } else {
            logger.info('🚀 Starting in PRODUCTION MODE - Google API required');
            this.googleAuthService = new GoogleAuthService();
            this.reviewService = new ReviewService(this.googleAuthService);
            apiClient = new GoogleMyBusinessApiClient(this.googleAuthService);
        }

        // Initialize extended-surface services. They share one apiClient in
        // production mode and run in mock mode otherwise. apiClient is unused
        // in mock mode (each service short-circuits to its mock branch).
        const sharedClient = apiClient ?? new GoogleMyBusinessApiClient(null as any);
        this.postService = new PostService(sharedClient, this.isMockMode);
        this.qaService = new QAService(sharedClient, this.isMockMode);
        this.mediaService = new MediaService(sharedClient, this.isMockMode);
        this.insightsService = new InsightsService(sharedClient, this.isMockMode);
        this.businessInfoService = new BusinessInfoService(sharedClient, this.isMockMode);

        // Initialize LLM service
        // Note: Sampling capability will be added when MCP SDK supports it directly
        this.llmService = new LLMService();
        
        this.setupServer();
    }

    static serve(): void {
        serveStdio(
            () => new McpServer().server,
            { onerror: (error) => logger.error('MCP stdio error:', error) }
        );
    }
    
    private setupServer(): void {
        logger.info('Setting up MCP server tools, resources, and prompts...');
        
        // Register tools
        this.registerTools();
        
        // Register resources
        this.registerResources();
        
        // Register prompts
        this.registerPrompts();
        
        logger.info('MCP server setup completed');
    }
    
    private registerTools(): void {
        logger.debug('Registering MCP tools...');
        
        // List locations tool
        const listLocationsTool = createListLocationsTool(this.reviewService);
        this.server.registerTool(
            'list_locations',
            {
                title: listLocationsTool.schema.title,
                description: listLocationsTool.schema.description,
                inputSchema: z.object({}),
                outputSchema: z.object(listLocationsTool.schema.outputSchema)
            },
            async (args: any) => {
                return await listLocationsTool.handler(args);
            }
        );
        
        // Get reviews tool
        const getUnrepliedReviewsTool = createGetUnRepliedReviewsTool(this.reviewService);
        this.server.registerTool(
            'get_unreplied_reviews',
            {
                title: getUnrepliedReviewsTool.schema.title,
                description: getUnrepliedReviewsTool.schema.description,
                inputSchema: z.object(getUnrepliedReviewsTool.schema.inputSchema),
                outputSchema: z.object(getUnrepliedReviewsTool.schema.outputSchema)
            },
            async (args: any) => {
                return await getUnrepliedReviewsTool.handler(args);
            }
        );
        
        // Generate reply tool
        const generateReplyTool = createGenerateReplyTool(this.llmService);
        this.server.registerTool(
            'generate_reply',
            {
                title: generateReplyTool.schema.title,
                description: generateReplyTool.schema.description,
                inputSchema: z.object(generateReplyTool.schema.inputSchema),
                outputSchema: generateReplyTool.schema.outputSchema
            },
            async (args: any, ctx: ServerContext) => {
                return await generateReplyTool.handler(args, ctx);
            }
        );
        
        // Post reply tool
        const postReplyTool = createPostReplyTool(this.reviewService);
        this.server.registerTool(
            'post_reply',
            {
                title: postReplyTool.schema.title,
                description: postReplyTool.schema.description,
                inputSchema: z.object(postReplyTool.schema.inputSchema),
                outputSchema: z.object(postReplyTool.schema.outputSchema)
            },
            async (args: any) => {
                return await postReplyTool.handler(args);
            }
        );
        
        // Get review day stats tool
        const getReviewDayStatsTool = createGetReviewDayStatsTool(this.reviewService);
        this.server.registerTool(
            'get_review_day_stats',
            {
                title: getReviewDayStatsTool.schema.title,
                description: getReviewDayStatsTool.schema.description,
                inputSchema: z.object(getReviewDayStatsTool.schema.inputSchema),
                outputSchema: z.object(getReviewDayStatsTool.schema.outputSchema)
            },
            async (args: any) => await getReviewDayStatsTool.handler(args)
        );

        // Delete review reply
        this.registerSimpleTool('delete_review_reply', createDeleteReviewReplyTool(this.reviewService));

        // Local Posts (4)
        this.registerSimpleTool('get_local_posts',    createGetLocalPostsTool(this.postService));
        this.registerSimpleTool('create_local_post',  createCreateLocalPostTool(this.postService));
        this.registerSimpleTool('update_local_post',  createUpdateLocalPostTool(this.postService));
        this.registerSimpleTool('delete_local_post',  createDeleteLocalPostTool(this.postService));

        // Media (4)
        this.registerSimpleTool('get_media',          createGetMediaTool(this.mediaService));
        this.registerSimpleTool('create_media',       createCreateMediaTool(this.mediaService));
        this.registerSimpleTool('start_media_upload', createStartMediaUploadTool(this.mediaService));
        this.registerSimpleTool('delete_media',       createDeleteMediaTool(this.mediaService));

        // Insights (3)
        this.registerSimpleTool('get_daily_metrics',       createGetDailyMetricsTool(this.insightsService));
        this.registerSimpleTool('get_multi_daily_metrics', createGetMultiDailyMetricsTool(this.insightsService));
        this.registerSimpleTool('get_search_keywords',     createGetSearchKeywordsTool(this.insightsService));

        // Business Information (10)
        this.registerSimpleTool('get_location_details',    createGetLocationDetailsTool(this.businessInfoService));
        this.registerSimpleTool('get_location_attributes', createGetLocationAttributesTool(this.businessInfoService));
        this.registerSimpleTool('get_available_attributes',createGetAvailableAttributesTool(this.businessInfoService));
        this.registerSimpleTool('get_services',            createGetServicesTool(this.businessInfoService));
        this.registerSimpleTool('get_categories',          createGetCategoriesTool(this.businessInfoService));
        this.registerSimpleTool('get_batch_categories',    createGetBatchCategoriesTool(this.businessInfoService));
        this.registerSimpleTool('get_verifications',       createGetVerificationsTool(this.businessInfoService));
        this.registerSimpleTool('update_location',         createUpdateLocationTool(this.businessInfoService));
        this.registerSimpleTool('update_services',         createUpdateServicesTool(this.businessInfoService));
        this.registerSimpleTool('set_attributes',          createSetAttributesTool(this.businessInfoService));

        // Q&A (4) — beyond InsightfulPipe
        this.registerSimpleTool('get_questions',   createGetQuestionsTool(this.qaService));
        this.registerSimpleTool('upsert_answer',   createUpsertAnswerTool(this.qaService));
        this.registerSimpleTool('delete_answer',   createDeleteAnswerTool(this.qaService));
        this.registerSimpleTool('delete_question', createDeleteQuestionTool(this.qaService));

        logger.debug(`Tools registered successfully (${5 + 1 + 4 + 4 + 3 + 7 + 4} total)`);
    }

    /**
     * Helper for the "extended surface" tools that all expose the same
     * {schema, handler} shape. Cuts ~10 lines of boilerplate per tool.
     */
    private registerSimpleTool(name: string, tool: { schema: { title: string; description: string; inputSchema: any; outputSchema: any }; handler: (args: any) => Promise<any> }): void {
        this.server.registerTool(
            name,
            {
                title: tool.schema.title,
                description: tool.schema.description,
                inputSchema: z.object(tool.schema.inputSchema),
                outputSchema: z.object(tool.schema.outputSchema)
            },
            async (args: any) => await tool.handler(args)
        );
    }
    
    private registerResources(): void {
        logger.debug('Registering MCP resources...');
        
        // Business profile resource
        const businessProfileResource = createBusinessProfileResource(this.reviewService);
        this.server.registerResource(
            'business_profile',
            businessProfileResource.uri,
            { 
                description: businessProfileResource.description,
                mimeType: businessProfileResource.mimeType
            },
            async () => {
                const result = await businessProfileResource.handler();
                return {
                    contents: result.contents
                };
            }
        );
        
        // Review templates resource
        const reviewTemplatesResource = createReviewTemplatesResource();
        this.server.registerResource(
            'review_templates',
            reviewTemplatesResource.uri,
            {
                description: reviewTemplatesResource.description,
                mimeType: reviewTemplatesResource.mimeType
            },
            async () => {
                const result = await reviewTemplatesResource.handler();
                return {
                    contents: result.contents
                };
            }
        );
        
        // Locations resource
        const locationsResource = createLocationsResource(this.reviewService);
        this.server.registerResource(
            'locations',
            locationsResource.uri,
            {
                description: locationsResource.description,
                mimeType: locationsResource.mimeType
            },
            async () => {
                const result = await locationsResource.handler();
                return {
                    contents: result.contents
                };
            }
        );
        
        // Reviews resource with dynamic location support
        const reviewsResource = createReviewsResource(this.reviewService);
        
        // Register template for per-location reviews: reviews://{locationId}
        this.server.registerResource(
            'reviews_by_location',
            'reviews://{locationId}',
            {
                description: 'Reviews for a specific business location. Use the location ID (e.g., locations/123456789)',
                mimeType: reviewsResource.mimeType
            },
            async (uri: URL) => {
                const result = await reviewsResource.handler(uri.href);
                return {
                    contents: result.contents
                };
            }
        );
        
        // Also register reviews://all for convenience
        this.server.registerResource(
            'reviews_all',
            'reviews://all',
            {
                description: 'All unreplied reviews across all business locations',
                mimeType: reviewsResource.mimeType
            },
            async () => {
                const result = await reviewsResource.handler('reviews://all');
                return {
                    contents: result.contents
                };
            }
        );

        logger.debug('Resources registered successfully');
    }
    
    private registerPrompts(): void {
        logger.debug('Registering MCP prompts...');
        
        // Review response prompt
        const reviewResponsePrompt = createReviewResponsePrompt();
        this.server.registerPrompt(
            'review_response',
            {
                title: 'Review Response Generator',
                description: reviewResponsePrompt.description,
                argsSchema: z.object({
                                    reviewText: z.string().describe('The customer review text'),
                                    starRating: z.string().describe('Star rating (1-5)'),
                                    businessName: z.string().describe('Name of the business'),
                                    businessType: z.string().optional().describe('Type of business (restaurant, retail, etc.)'),
                                    customerName: z.string().optional().describe('Customer display name'),
                                    replyTone: z.string().describe('Desired tone for the reply'),
                                    previousReplies: z.string().optional().describe('JSON array of previous replies for consistency')
                                })
            },
            async (args: any) => {
                const context = {
                    reviewText: args.reviewText,
                    starRating: parseInt(args.starRating),
                    businessName: args.businessName,
                    businessType: args.businessType,
                    customerName: args.customerName,
                    replyTone: args.replyTone,
                    previousReplies: args.previousReplies ? JSON.parse(args.previousReplies) : []
                };
                const prompt = await reviewResponsePrompt.handler(context);
                return {
                    description: `Review response prompt for ${args.businessName}`,
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: prompt
                            }
                        }
                    ]
                };
            }
        );
        
        // Sentiment analysis prompt
        const sentimentAnalysisPrompt = createSentimentAnalysisPrompt();
        this.server.registerPrompt(
            'sentiment_analysis',
            {
                title: 'Review Sentiment Analysis',
                description: sentimentAnalysisPrompt.description,
                argsSchema: z.object({
                                    reviewText: z.string().describe('The review text to analyze'),
                                    includeEmotions: z.string().optional().describe('Include emotional analysis (true/false)'),
                                    includeKeywords: z.string().optional().describe('Include keyword extraction (true/false)')
                                })
            },
            async (args: any) => {
                const context = {
                    reviewText: args.reviewText,
                    includeEmotions: args.includeEmotions !== 'false',
                    includeKeywords: args.includeKeywords !== 'false'
                };
                const prompt = await sentimentAnalysisPrompt.handler(context);
                return {
                    description: `Sentiment analysis for review: "${args.reviewText.substring(0, 50)}..."`,
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: prompt
                            }
                        }
                    ]
                };
            }
        );

        // Manage pending reviews prompt
        const manageReviewsPrompt = createManageReviewsPrompt();
        this.server.registerPrompt(
            'manage_pending_reviews',
            {
                title: 'Manage Pending Reviews',
                description: manageReviewsPrompt.description,
                argsSchema: z.object({
                                    // locationName: z.string().optional().describe('Specific location to check (optional)')
                                })
            },
            async (args: any) => {
                const prompt = await manageReviewsPrompt.handler();
                return {
                    description: 'Instructions to manage pending reviews using MCP resources',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: prompt
                            }
                        }
                    ]
                };
            }
        );

        // Analyze review statistics prompt
        const analyzeReviewStatsPrompt = createAnalyzeReviewStatsPrompt();
        this.server.registerPrompt(
            'analyze_review_stats',
            {
                title: 'Analyze Review Statistics',
                description: analyzeReviewStatsPrompt.description,
                argsSchema: z.object({})
            },
            async (args: any) => {
                const prompt = await analyzeReviewStatsPrompt.handler();
                return {
                    description: 'Instructions to analyze review statistics with comprehensive insights',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: prompt
                            }
                        }
                    ]
                };
            }
        );
        
        logger.debug('Prompts registered successfully');
    }
    
    
    async start(): Promise<void> {
        logger.info('Starting MCP server with STDIO transport...');
        McpServer.serve();
        
        logger.info(`MCP server started with STDIO transport`);
        
        // Keep the process alive for STDIO transport
        // The transport will handle stdin/stdout communication
        return new Promise<void>(() => {
            // This promise never resolves, keeping the process alive
            // The process will only exit via signal handlers or errors
        });
    }
    
    async stop(): Promise<void> {
        logger.info('Stopping MCP server...');
        logger.info('MCP server stopped');
    }
}
