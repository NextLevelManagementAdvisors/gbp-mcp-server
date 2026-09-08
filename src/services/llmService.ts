/**
 * LLM Service for generating review responses.
 * Precedence: direct Anthropic-compatible HTTP call (if ANTHROPIC_API_KEY is set)
 * -> registered sampling callback -> MCP sampling -> template fallback.
 */

import { logger } from '../utils/logger.js';
import { DEFAULTS } from '../utils/constants.js';
import { 
    analyzeSentiment, 
    extractEmotions, 
    extractKeywords, 
    calculateSentimentConfidence,
    calculateResponseConfidence,
    determineToneFromRating 
} from '../utils/sentimentAnalysis.js';
import { generateTemplateResponse, createReplyPrompt } from '../utils/templateGenerator.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { 
    GenerateReplyResponse, 
    ServiceResponse,
    ReviewResponseContext
} from '../types/index.js';
import { CreateMessageRequest, CreateMessageRequestSchema, ServerNotification, ServerRequest, ToolResultContent } from '@modelcontextprotocol/sdk/types.js';

const DIRECT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

interface DirectAnthropicConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

const getDirectAnthropicConfig = (): DirectAnthropicConfig | null => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return null;
    }
    return {
        apiKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
        model: process.env.GBP_REPLY_MODEL || DEFAULT_ANTHROPIC_MODEL
    };
};

/**
 * Call an Anthropic-compatible /v1/messages endpoint directly via fetch.
 * Aborts after DIRECT_HTTP_TIMEOUT_MS so a slow endpoint can never re-create
 * the 60s sampling hang this replaces.
 */
const requestDirectAnthropic = async (prompt: string, config: DirectAnthropicConfig): Promise<string> => {
    logger.debug('Calling direct Anthropic-compatible endpoint', { baseUrl: config.baseUrl, model: config.model });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIRECT_HTTP_TIMEOUT_MS);

    try {
        const response = await fetch(`${config.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'x-api-key': config.apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                max_tokens: DEFAULTS.MAX_PROMPT_LENGTH,
                messages: [{ role: 'user', content: prompt }]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Anthropic endpoint responded with HTTP ${response.status}`);
        }

        const data: any = await response.json();
        const textBlock = Array.isArray(data.content)
            ? data.content.find((block: any) => block?.type === 'text')
            : undefined;

        if (!textBlock?.text) {
            throw new Error('Anthropic response contained no text content block');
        }

        return textBlock.text;
    } finally {
        clearTimeout(timeout);
    }
};

type SendRequest = RequestHandlerExtra<ServerRequest, ServerNotification>['sendRequest'];
const requestSampling = async (prompt: string, sendRequest: SendRequest) => {
    const request: CreateMessageRequest = {
        method: "sampling/createMessage",
        params: {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: prompt
                    }
                }
            ],
            systemPrompt: "Generate a professional and appropriate response to the customer review provided.",
            maxTokens: DEFAULTS.MAX_PROMPT_LENGTH,
            temperature: 0.7,
            includeContext: "thisServer"
        }
    };

    const response: any = await sendRequest(request, CreateMessageRequestSchema);
    return response.content.text;
}; 

export class LLMService {
    private samplingCallback?: (prompt: string) => Promise<string>;
    
    constructor(samplingCallback?: (prompt: string) => Promise<string>) {
        this.samplingCallback = samplingCallback;
        logger.debug('LLM Service initialized', { hasSampling: !!samplingCallback });
    }
    
    /**
     * Set the sampling callback for LLM requests
     */
    setSamplingCallback(callback: (prompt: string) => Promise<string>): void {
        this.samplingCallback = callback;
        logger.debug('Sampling callback registered');
    }
    
    /**
     * Generate a reply to a review using LLM sampling
     * This method will use MCP's sampling capability to generate responses
     */
    async generateReply(
reviewText: string, starRating: number, businessName: string, options: {
    replyTone?: 'professional' | 'friendly' | 'apologetic' | 'grateful';
    includePersonalization?: boolean;
    maxLength?: number;
} = {}, extra: RequestHandlerExtra<ServerRequest, ServerNotification>    ): Promise<ServiceResponse<GenerateReplyResponse>> {
        try {
            logger.debug('Generating reply for review', { starRating, businessName, hasSampling: !!this.samplingCallback });
            
            const {
                replyTone = determineToneFromRating(starRating),
                includePersonalization = true,
                maxLength = DEFAULTS.MAX_PROMPT_LENGTH
            } = options;
            
            // Analyze sentiment
            const sentiment = analyzeSentiment(reviewText, starRating);
            
            // Create prompt for LLM
            const prompt = createReplyPrompt(reviewText, starRating, businessName, replyTone, includePersonalization);
            
            let replyText: string;
            let confidence: number;
            let method: 'direct-http' | 'sampling-callback' | 'mcp-sampling' | 'template';

            const directConfig = getDirectAnthropicConfig();

            if (directConfig) {
                try {
                    logger.info('Using direct Anthropic HTTP call for reply generation');
                    replyText = await requestDirectAnthropic(prompt, directConfig);
                    confidence = 0.9; // High confidence for AI-generated replies
                    method = 'direct-http';
                    logger.info('Direct AI-generated reply received', { length: replyText.length });
                } catch (directError) {
                    // A slow/failed direct call falls straight through to the template —
                    // not to MCP sampling, which can itself hang for up to 60s.
                    logger.warn('Direct Anthropic HTTP call failed, falling back to template', {
                        error: directError instanceof Error ? directError.message : String(directError)
                    });
                    replyText = generateTemplateResponse(reviewText, starRating, businessName, replyTone);
                    confidence = calculateResponseConfidence(reviewText, starRating, replyText);
                    method = 'template';
                }
            } else if (this.samplingCallback) {
                try {
                    logger.info('Using AI sampling callback for reply generation');
                    replyText = await this.samplingCallback(prompt);
                    confidence = 0.9; // High confidence for AI-generated replies
                    method = 'sampling-callback';
                    logger.info('AI-generated reply received', { length: replyText.length });
                } catch (samplingError) {
                    logger.warn('AI sampling failed, falling back to template', { error: samplingError });
                    replyText = generateTemplateResponse(reviewText, starRating, businessName, replyTone);
                    confidence = calculateResponseConfidence(reviewText, starRating, replyText);
                    method = 'template';
                }
            } else {
                try {
                    logger.info('Using MCP sampling for reply generation');
                    replyText = await requestSampling(prompt, extra.sendRequest);
                    confidence = 0.9; // High confidence for AI-generated replies
                    method = 'mcp-sampling';
                } catch (samplingError) {
                    logger.warn('MCP sampling failed, falling back to template', {
                        error: samplingError instanceof Error ? samplingError.message : String(samplingError)
                    });
                    replyText = generateTemplateResponse(reviewText, starRating, businessName, replyTone);
                    confidence = calculateResponseConfidence(reviewText, starRating, replyText);
                    method = 'template';
                }
            }

            logger.info('Reply generated successfully', { sentiment, confidence, method });
            
            return {
                success: true,
                data: {
                    replyText: replyText.substring(0, maxLength),
                    tone: replyTone,
                    sentiment,
                    confidence
                }
            };
            
        } catch (error) {
            logger.error('Error generating reply:', error);
            return {
                success: false,
                error: 'Failed to generate reply',
                errorCode: 'REPLY_GENERATION_ERROR'
            };
        }
    }
    
    /**
     * Analyze review sentiment with detailed breakdown
     */
    async analyzeSentimentDetailed(reviewText: string): Promise<ServiceResponse<{
        sentiment: 'positive' | 'negative' | 'neutral';
        confidence: number;
        emotions: string[];
        keywords: string[];
    }>> {
        try {
            logger.debug('Performing detailed sentiment analysis');
            
            const sentiment = analyzeSentiment(reviewText, 3); // Neutral rating for text-only analysis
            const emotions = extractEmotions(reviewText);
            const keywords = extractKeywords(reviewText);
            const confidence = calculateSentimentConfidence(reviewText, sentiment);
            
            return {
                success: true,
                data: {
                    sentiment,
                    confidence,
                    emotions,
                    keywords
                }
            };
            
        } catch (error) {
            logger.error('Error in sentiment analysis:', error);
            return {
                success: false,
                error: 'Failed to analyze sentiment',
                errorCode: 'SENTIMENT_ANALYSIS_ERROR'
            };
        }
    }
}