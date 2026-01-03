/**
 * AI Bookmark Brain - Global Constants
 * Centralized configuration for the extension
 */

// Database configuration
export const DB_NAME = 'ai_bookmark_brain.db';
export const DB_VERSION = 1;

// Table names
export const TABLES = {
    BOOKMARKS: 'bookmarks',
    SUMMARIES: 'summaries',
    CATEGORIES: 'categories',
    BOOKMARK_CATEGORIES: 'bookmark_categories',
    SYNC_LOG: 'sync_log',
} as const;

// Message types for webext-bridge
export const MESSAGE_TYPES = {
    // Database operations
    DB_QUERY: 'db:query',
    DB_EXECUTE: 'db:execute',
    DB_INIT: 'db:init',

    // Search operations
    SEARCH_BOOKMARKS: 'search:bookmarks',

    // Sync operations
    SYNC_FULL: 'sync:full',
    SYNC_INCREMENTAL: 'sync:incremental',
    SYNC_STATUS: 'sync:status',
    SYNC_START_SUMMARIZATION: 'sync:start-summarization',

    // AI operations
    AI_SUMMARIZE: 'ai:summarize',
    AI_SUMMARIZE_PAGE: 'ai:summarize-page',

    // UI operations
    UI_TOGGLE_OVERLAY: 'ui:toggle-overlay',
    UI_SHOW_OVERLAY: 'ui:show-overlay',
    UI_HIDE_OVERLAY: 'ui:hide-overlay',
    UI_BOOKMARK_UPDATED: 'ui:bookmark-updated',

    // Data export/import operations
    DATA_EXPORT_DB: 'data:export-db',
    DATA_EXPORT_SETTINGS: 'data:export-settings',
    DATA_IMPORT_DB: 'data:import-db',
    DATA_IMPORT_SETTINGS: 'data:import-settings',
    OPFS_READ_FILE: 'opfs:read-file',
    OPFS_WRITE_FILE: 'opfs:write-file',

    // Frecency (selection tracking)
    FRECENCY_RECORD: 'frecency:record',

    // History search (! prefix)
    SEARCH_HISTORY: 'search:history',
    RECORD_HISTORY: 'history:record',

    // Bookmark operations from UI
    ADD_BOOKMARK: 'bookmark:add',

    // Category operations
    CATEGORY_CREATE: 'category:create',
    CATEGORY_UPDATE: 'category:update',
    CATEGORY_DELETE: 'category:delete',
    CATEGORY_LIST: 'category:list',
    CATEGORY_FIND_BY_PREFIX: 'category:find-by-prefix',
    SET_BOOKMARK_CATEGORY: 'bookmark:set-category',

    // Content refetch operations (for garbled/empty content)
    REFETCH_GARBLED_CONTENT: 'refetch:garbled-content',
    REFETCH_GARBLED_PROGRESS: 'refetch:progress',
} as const;


// AI Providers
export const AI_PROVIDERS = {
    DEEPSEEK: 'deepseek',
    GEMINI: 'gemini',
    OPENAI: 'openai',
} as const;

// API Endpoints
export const API_ENDPOINTS = {
    DEEPSEEK: 'https://api.deepseek.com/v1/chat/completions',
    GEMINI: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    OPENAI: 'https://api.openai.com/v1/chat/completions',
} as const;

// UI Constants
export const UI = {
    OVERLAY_ID: 'ai-bookmark-brain-overlay',
    SEARCH_DEBOUNCE_MS: 150,
    MAX_RESULTS: 50,
    VISIBLE_RESULTS: 15,
} as const;

// Console logging prefix
export const LOG_PREFIX = '[AI-Bookmark-Brain]';
