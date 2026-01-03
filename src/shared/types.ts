/**
 * AI Bookmark Brain - TypeScript Type Definitions v2
 * 与新数据库Schema匹配的类型定义
 */

import type { AI_PROVIDERS } from './constants';

// =====================================================
// Bookmark Types
// =====================================================

export type BookmarkStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

export interface Bookmark {
    id: number;

    // Chrome相关
    chromeBookmarkId?: string;
    chromeFolderPath?: string;

    // 基本信息
    url: string;
    originalTitle: string;
    faviconUrl?: string;

    // 页面内容
    pageContent?: string;
    pageContentHash?: string;

    // 用户自定义
    userNotes?: string;
    userCategoryId?: number;

    // 状态
    status: BookmarkStatus;
    errorMessage?: string;
    retryCount: number;

    // 抓取失败标记 (死链)
    fetchFailedAt?: number;
    fetchFailReason?: string;

    // 标记
    isArchived: boolean;
    isPinned: boolean;
    visitCount: number;

    // 时间戳
    createdAt: number;
    analyzedAt?: number;
    contentFetchedAt?: number;
    lastUpdated: number;
}

export interface BookmarkWithDetails extends Bookmark {
    summary?: AISummary;
    tags?: Tag[];
    category?: Category;
}

// =====================================================
// AI Summary Types
// =====================================================

export interface AISummary {
    id: number;
    bookmarkId: number;

    // AI信息
    aiProvider: string;
    aiModel?: string;

    // 生成内容
    summaryText: string;         // 中文摘要
    summaryOriginal?: string;    // 原文摘要（外文时有值）

    // 质量
    confidenceScore?: number;
    language?: string;

    createdAt: number;
}

// =====================================================
// Tag Types (AI生成的标签)
// =====================================================

export type TagSource = 'ai' | 'user';

export interface Tag {
    id: number;

    // 名称 (多语言)
    name: string;       // 规范化名称 (小写)
    nameZh?: string;    // 中文名
    nameEn?: string;    // 英文名
    namePinyin?: string;// 拼音

    // 来源和统计
    source: TagSource;
    usageCount: number;

    // 显示
    color: string;

    createdAt: number;
}

export interface BookmarkTag {
    bookmarkId: number;
    tagId: number;
    source: TagSource;
    confidence?: number;
    createdAt: number;
}

// =====================================================
// Category Types (用户手动分类)
// =====================================================

export interface Category {
    id: number;

    name: string;
    namePinyin?: string;

    // 显示
    icon?: string;
    color: string;

    // 层级
    parentId?: number;
    sortOrder: number;

    createdAt: number;
}

// =====================================================
// Embeddings Types (预留)
// =====================================================

export interface Embedding {
    id: number;
    bookmarkId: number;

    modelName: string;
    modelVersion?: string;

    vector: number[];
    dimension: number;

    createdAt: number;
}

// =====================================================
// Search Types
// =====================================================

export type MatchType =
    | 'exact_case'    // 大小写完全匹配
    | 'exact'         // 精确匹配(大小写不敏感)
    | 'title'         // 标题匹配
    | 'url'           // URL匹配
    | 'summary'       // AI摘要匹配
    | 'tag'           // 标签匹配
    | 'category'      // 分类匹配
    | 'notes'         // 用户笔记匹配
    | 'content'       // 全文匹配
    | 'fuzzy'         // 模糊匹配
    | 'pinyin'        // 拼音匹配
    | 'semantic';     // 语义匹配(向量)

export type SearchType = 'default' | 'fulltext' | 'tag' | 'category';

export interface SearchResult {
    bookmark: BookmarkWithDetails;
    score: number;
    matchType: MatchType;
    matchedField?: string;
    matchedText?: string;
}

export interface SearchOptions {
    query: string;
    searchType?: SearchType;
    limit?: number;
    filters?: {
        categoryId?: number;
        tagIds?: number[];
        status?: BookmarkStatus;
        isPinned?: boolean;
        isArchived?: boolean;
        hasAiSummary?: boolean;
    };
}

// =====================================================
// Search History Types
// =====================================================

export interface SearchHistoryEntry {
    id: number;
    query: string;
    searchType: SearchType;
    resultCount: number;
    selectedBookmarkId?: number;
    searchedAt: number;
}

// =====================================================
// History Records Types (! 历史搜索)
// =====================================================

export type HistorySourceType = 'search' | 'navigate' | 'bookmark';

export interface HistoryRecord {
    id: number | string;
    title: string;
    url: string;
    pageDescription?: string;
    faviconUrl?: string;
    sourceType: HistorySourceType;
    searchQuery?: string;
    bookmarkId?: number;
    visitCount: number;
    totalTimeSpent: number;
    firstVisitAt: number;
    lastVisitAt: number;
}

export interface HistoryRecordInput {
    title: string;
    url: string;
    pageDescription?: string;
    faviconUrl?: string;
    sourceType: HistorySourceType;
    searchQuery?: string;
    bookmarkId?: number;
}

export interface HistorySearchResult {
    history: HistoryRecord;
    score: number;
    matchType: MatchType;
    matchedField?: string;
}

// =====================================================
// AI Service Types
// =====================================================

export type AIProviderType = typeof AI_PROVIDERS[keyof typeof AI_PROVIDERS];

export interface AIConfig {
    provider: AIProviderType;
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

export interface SummarizeRequest {
    title: string;
    url: string;
    content?: string;
}

export interface SummaryResult {
    summaryZh: string;           // 中文摘要（必须）
    summaryOriginal?: string;    // 原文摘要（外文内容时有值）
    tagsZh: string[];            // 中文标签
    tagsOriginal?: string[];     // 原文标签（外文内容时有值）
    confidence?: number;
    language?: string;           // zh | en | mixed
}

// =====================================================
// Sync Types
// =====================================================

export interface SyncStatus {
    lastSync: number;
    inProgress: boolean;
    totalBookmarks: number;
    summarizedCount: number;
    pendingCount: number;
    errorCount: number;
}

export type SyncAction = 'add' | 'update' | 'delete' | 'analyze' | 'fetch_content';
export type SyncLogStatus = 'pending' | 'success' | 'failed';

export interface SyncLogEntry {
    id: number;
    action: SyncAction;
    bookmarkId?: number;
    status: SyncLogStatus;
    message?: string;
    timestamp: number;
}

// =====================================================
// Database Message Types
// =====================================================

export interface DBQueryMessage {
    sql: string;
    params?: unknown[];
}

export interface DBExecuteMessage {
    sql: string;
    params?: unknown[];
}

// =====================================================
// Data Export/Import Types
// =====================================================

export interface ExportMeta {
    version: string;
    exportedAt: number;
    schemaVersion: number;
    bookmarkCount: number;
    summaryCount: number;
}

export interface SettingsExport {
    apiKeys: {
        deepseek: string;
        gemini: string;
        openai: string;
        openaiBaseUrl: string;
    };
    activeProvider: string;
    extensionSettings: {
        autoSummarize: boolean;
        darkMode: boolean;
        searchHotkey: string;
        maxSearchResults: number;
    };
    userCategories: Array<{ id: number; name: string; color: string }>;
}

export interface ImportResult {
    inserted: number;
    updated: number;
    skipped: number;
    errors: string[];
}

export interface ValidationResult {
    valid: boolean;
    schemaVersion?: number;
    bookmarkCount?: number;
    errors: string[];
}
