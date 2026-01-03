/**
 * AI Bookmark Brain - OpenAI Compatible Service v2
 * Supports OpenAI, Ollama, LMStudio, and other compatible APIs
 */

import { API_ENDPOINTS } from '../../shared/constants';
import { logger } from '../../shared/logger';
import type { SummaryResult, SummarizeRequest } from '../../shared/types';
import type { AIServiceConfig } from './base';
import { AIService, formatPrompt, parseAIResponse, fetchWithTimeout } from './base';

export class OpenAICompatibleService implements AIService {
    readonly provider = 'openai';
    private apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(config: AIServiceConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || API_ENDPOINTS.OPENAI;
        this.model = config.model || 'gpt-3.5-turbo';
    }

    async summarize(request: SummarizeRequest): Promise<SummaryResult> {
        const prompt = formatPrompt(request);

        try {
            const response = await fetchWithTimeout(
                `${this.baseUrl}/chat/completions`,
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
                throw new Error(`OpenAI API error: ${response.status} - ${error}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            logger.debug('OpenAI response:', content.substring(0, 100));

            return parseAIResponse(content);
        } catch (error) {
            logger.error('OpenAI summarization failed:', error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetchWithTimeout(
                `${this.baseUrl}/chat/completions`,
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

    /**
     * Generate embedding vector (for future semantic search)
     */
    async generateEmbedding(text: string): Promise<number[] | null> {
        try {
            const response = await fetchWithTimeout(
                `${this.baseUrl}/embeddings`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'text-embedding-ada-002',
                        input: text,
                    }),
                },
                30000
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            return data.data?.[0]?.embedding || null;
        } catch {
            return null;
        }
    }
}
