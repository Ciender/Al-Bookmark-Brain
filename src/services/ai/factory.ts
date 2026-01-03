/**
 * AI Bookmark Brain - AI Service Factory
 * Creates AI service instances based on configuration
 */

import { AI_PROVIDERS } from '../../shared/constants';
import { logger } from '../../shared/logger';
import type { AIProviderType } from '../../shared/types';
import { apiKeys, activeProvider } from '../../lib/storage';
import type { AIService, AIServiceConfig } from './base';
import { DeepSeekService } from './deepseek';
import { GeminiService } from './gemini';
import { OpenAICompatibleService } from './openai-compatible';

/**
 * Create an AI service instance for the given provider
 */
export function createAIService(
    provider: AIProviderType,
    config: AIServiceConfig
): AIService {
    switch (provider) {
        case AI_PROVIDERS.DEEPSEEK:
            return new DeepSeekService(config);
        case AI_PROVIDERS.GEMINI:
            return new GeminiService(config);
        case AI_PROVIDERS.OPENAI:
            return new OpenAICompatibleService(config);
        default:
            throw new Error(`Unknown AI provider: ${provider}`);
    }
}

/**
 * Get the currently configured AI service
 */
export async function getActiveAIService(): Promise<AIService | null> {
    try {
        const provider = await activeProvider.getValue();
        const keys = await apiKeys.getValue();

        let apiKey: string | undefined;
        let baseUrl: string | undefined;

        switch (provider) {
            case AI_PROVIDERS.DEEPSEEK:
                apiKey = keys.deepseek;
                break;
            case AI_PROVIDERS.GEMINI:
                apiKey = keys.gemini;
                break;
            case AI_PROVIDERS.OPENAI:
                apiKey = keys.openai;
                baseUrl = keys.openaiBaseUrl;
                break;
        }

        if (!apiKey) {
            logger.warn(`No API key configured for provider: ${provider}`);
            return null;
        }

        return createAIService(provider, { apiKey, baseUrl });
    } catch (error) {
        logger.error('Failed to get active AI service:', error);
        return null;
    }
}

/**
 * Test all configured AI providers
 */
export async function testAllProviders(): Promise<Record<AIProviderType, boolean>> {
    const keys = await apiKeys.getValue();
    const results: Record<string, boolean> = {};

    if (keys.deepseek) {
        const service = new DeepSeekService({ apiKey: keys.deepseek });
        results[AI_PROVIDERS.DEEPSEEK] = await service.testConnection();
    } else {
        results[AI_PROVIDERS.DEEPSEEK] = false;
    }

    if (keys.gemini) {
        const service = new GeminiService({ apiKey: keys.gemini });
        results[AI_PROVIDERS.GEMINI] = await service.testConnection();
    } else {
        results[AI_PROVIDERS.GEMINI] = false;
    }

    if (keys.openai) {
        const service = new OpenAICompatibleService({
            apiKey: keys.openai,
            baseUrl: keys.openaiBaseUrl,
        });
        results[AI_PROVIDERS.OPENAI] = await service.testConnection();
    } else {
        results[AI_PROVIDERS.OPENAI] = false;
    }

    return results as Record<AIProviderType, boolean>;
}
