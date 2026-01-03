/**
 * AI Bookmark Brain - Gemini AI Service v2
 * Google Gemini API adapter for summarization with tags
 */

import { API_ENDPOINTS } from '../../shared/constants';
import { logger } from '../../shared/logger';
import type { SummaryResult, SummarizeRequest } from '../../shared/types';
import type { AIServiceConfig } from './base';
import { AIService, formatPrompt, parseAIResponse, fetchWithTimeout } from './base';

export class GeminiService implements AIService {
    readonly provider = 'gemini';
    private apiKey: string;
    private model: string;

    constructor(config: AIServiceConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'gemini-pro';
    }

    async summarize(request: SummarizeRequest): Promise<SummaryResult> {
        const prompt = formatPrompt(request);
        const url = `${API_ENDPOINTS.GEMINI}/${this.model}:generateContent?key=${this.apiKey}`;

        try {
            const response = await fetchWithTimeout(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [{ text: prompt }],
                            },
                        ],
                        generationConfig: {
                            temperature: 0.3,
                            maxOutputTokens: 500,
                        },
                    }),
                },
                30000
            );

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Gemini API error: ${response.status} - ${error}`);
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            logger.debug('Gemini response:', content.substring(0, 100));

            return parseAIResponse(content);
        } catch (error) {
            logger.error('Gemini summarization failed:', error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const url = `${API_ENDPOINTS.GEMINI}/${this.model}:generateContent?key=${this.apiKey}`;
            const response = await fetchWithTimeout(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [{ text: 'Hello' }],
                            },
                        ],
                        generationConfig: {
                            maxOutputTokens: 5,
                        },
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
