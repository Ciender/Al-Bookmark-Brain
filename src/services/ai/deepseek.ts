/**
 * AI Bookmark Brain - DeepSeek AI Service v2
 * DeepSeek API adapter for summarization with tags
 */

import { API_ENDPOINTS } from '../../shared/constants';
import { logger } from '../../shared/logger';
import type { SummaryResult, SummarizeRequest } from '../../shared/types';
import type { AIServiceConfig } from './base';
import { AIService, formatPrompt, parseAIResponse, fetchWithTimeout } from './base';

export class DeepSeekService implements AIService {
    readonly provider = 'deepseek';
    private apiKey: string;
    private model: string;

    constructor(config: AIServiceConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'deepseek-chat';
    }

    async summarize(request: SummarizeRequest): Promise<SummaryResult> {
        const prompt = formatPrompt(request);

        try {
            const response = await fetchWithTimeout(
                API_ENDPOINTS.DEEPSEEK,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a helpful assistant that summarizes webpages and generates relevant tags. Always respond with valid JSON.',
                            },
                            {
                                role: 'user',
                                content: prompt,
                            },
                        ],
                        temperature: 0.3,
                        max_tokens: 500,
                    }),
                },
                30000
            );

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            logger.debug('DeepSeek response:', content.substring(0, 100));

            return parseAIResponse(content);
        } catch (error) {
            logger.error('DeepSeek summarization failed:', error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetchWithTimeout(
                API_ENDPOINTS.DEEPSEEK,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: [
                            { role: 'user', content: 'Hello' },
                        ],
                        max_tokens: 5,
                    }),
                },
                10000
            );

            return response.ok;
        } catch {
            return false;
        }
    }
}
