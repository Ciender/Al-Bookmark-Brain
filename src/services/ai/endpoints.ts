/**
 * AI Bookmark Brain - AI Endpoint Builders
 * Centralized URL assembly to avoid double-path bugs
 */

import { API_ENDPOINTS } from '../../shared/constants';

function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Accept both base URL forms:
 * - https://api.openai.com/v1
 * - https://api.openai.com/v1/chat/completions (legacy input from old UI placeholder)
 */
export function normalizeOpenAIBaseUrl(baseUrl?: string): string {
    const fallback = API_ENDPOINTS.OPENAI;
    const normalized = trimTrailingSlash((baseUrl || fallback).trim());
    return normalized.replace(/\/chat\/completions$/i, '');
}

export function buildOpenAIChatCompletionsUrl(baseUrl?: string): string {
    return `${normalizeOpenAIBaseUrl(baseUrl)}/chat/completions`;
}

export function buildOpenAIEmbeddingsUrl(baseUrl?: string): string {
    return `${normalizeOpenAIBaseUrl(baseUrl)}/embeddings`;
}

export function buildDeepSeekChatCompletionsUrl(baseUrl: string = API_ENDPOINTS.DEEPSEEK): string {
    return `${trimTrailingSlash(baseUrl)}/chat/completions`;
}

export function buildGeminiGenerateContentUrl(
    model: string,
    baseUrl: string = API_ENDPOINTS.GEMINI
): string {
    return `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`;
}
