/**
 * AI Bookmark Brain - Storage Definitions v2
 * Type-safe WXT storage with defaults for Schema v2
 */

import { storage } from '#imports';
import type { SyncStatus } from '../shared/types';
import type { SearchStrategyOrder } from '../services/search/search-config';

// API Keys storage
export const apiKeys = storage.defineItem<{
    deepseek: string;
    gemini: string;
    openai: string;
    openaiBaseUrl: string;
}>('local:apiKeys', {
    defaultValue: {
        deepseek: 'sk-4e', // Default API key
        gemini: '',
        openai: '',
        openaiBaseUrl: '',
    },
});

// Active AI provider
export const activeProvider = storage.defineItem<'deepseek' | 'gemini' | 'openai'>('local:activeProvider', {
    defaultValue: 'deepseek',
});

// Sync status (updated for v2)
export const syncStatus = storage.defineItem<SyncStatus>('local:syncStatus', {
    defaultValue: {
        lastSync: 0,
        inProgress: false,
        totalBookmarks: 0,
        summarizedCount: 0,
        pendingCount: 0,
        errorCount: 0,
    },
});

// User categories (cache)
export const userCategories = storage.defineItem<Array<{ id: number; name: string; color: string }>>('local:userCategories', {
    defaultValue: [],
});

// Extension settings
export const extensionSettings = storage.defineItem<{
    autoSummarize: boolean;
    darkMode: boolean;
    searchHotkey: string;
    maxSearchResults: number;
}>('local:extensionSettings', {
    defaultValue: {
        autoSummarize: true,
        darkMode: true,
        searchHotkey: 'Ctrl+Q',
        maxSearchResults: 20,
    },
});

// Font size settings for UI customization
export interface FontSettings {
    searchInput: number;      // Search box text
    resultTitle: number;      // Bookmark title in results
    resultUrl: number;        // URL below title
    resultBadge: number;      // Match type & category badges
    summaryTitle: number;     // Selected bookmark title in panel
    summaryText: number;      // AI summary content
    summaryLabel: number;     // Section labels (Tags, Metadata)
    metadataText: number;     // Metadata items
}

// Default font sizes (in pixels)
export const DEFAULT_FONT_SIZES: FontSettings = {
    searchInput: 14,
    resultTitle: 14,
    resultUrl: 11,
    resultBadge: 10,
    summaryTitle: 16,
    summaryText: 14,
    summaryLabel: 12,
    metadataText: 12,
};

// UI appearance settings
export const uiSettings = storage.defineItem<{
    fontSizes: FontSettings;
}>('local:uiSettings', {
    defaultValue: {
        fontSizes: { ...DEFAULT_FONT_SIZES },
    },
});

// First run flag
export const isFirstRun = storage.defineItem<boolean>('local:isFirstRun', {
    defaultValue: true,
});

// Recent searches (cache)
export const recentSearches = storage.defineItem<string[]>('local:recentSearches', {
    defaultValue: [],
});

// Search strategy priority order (user-configurable)
export const searchStrategyOrder = storage.defineItem<SearchStrategyOrder>('local:searchStrategyOrder', {
    defaultValue: {
        strategies: [], // Empty = use defaults from search-config.ts
    },
});
