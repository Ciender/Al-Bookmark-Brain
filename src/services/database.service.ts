/**
 * AI Bookmark Brain - Database Service v2
 * High-level database API with Repository pattern for Schema v2
 */

import { MESSAGE_TYPES } from '../shared/constants';
import { QUERIES } from '../database/schema';
import { logger } from '../shared/logger';
import type {
    Bookmark,
    BookmarkWithDetails,
    BookmarkStatus,
    AISummary,
    Tag,
    TagSource,
    Category,
    SearchHistoryEntry,
    SyncLogEntry,
    SyncAction,
    SyncLogStatus,
    HistoryRecord,
    HistoryRecordInput,
    HistorySourceType,
} from '../shared/types';

// Type for database response
interface DBResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Send message to offscreen document
 */
async function sendToOffscreen<T = unknown>(type: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, (response: DBResponse<T>) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response?.success) {
                reject(new Error(response?.error || 'Database operation failed'));
                return;
            }
            resolve(response.data as T);
        });
    });
}

/**
 * Execute a SQL query and return results
 */
async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return sendToOffscreen<T[]>(MESSAGE_TYPES.DB_QUERY, { sql, params });
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE)
 */
async function execute(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    return sendToOffscreen(MESSAGE_TYPES.DB_EXECUTE, { sql, params });
}

// =====================================================
// Bookmark Repository
// =====================================================

export const BookmarkRepository = {
    async findById(id: number): Promise<Bookmark | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_BOOKMARK_BY_ID, [id]);
        return rows.length > 0 ? mapRowToBookmark(rows[0]) : null;
    },

    async findByChromeId(chromeId: string): Promise<Bookmark | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_BOOKMARK_BY_CHROME_ID, [chromeId]);
        return rows.length > 0 ? mapRowToBookmark(rows[0]) : null;
    },

    async findByUrl(url: string): Promise<Bookmark | null> {
        const rows = await query<Record<string, unknown>>(
            'SELECT * FROM bookmarks WHERE url = ?',
            [url]
        );
        return rows.length > 0 ? mapRowToBookmark(rows[0]) : null;
    },

    async updateChromeId(id: number, chromeId: string): Promise<number> {
        const now = Date.now();
        const result = await execute(
            'UPDATE bookmarks SET chrome_bookmark_id = ?, last_updated = ? WHERE id = ?',
            [chromeId, now, id]
        );
        logger.debug('Bookmark chrome_id updated:', chromeId);
        return result.changes;
    },

    async findPending(limit = 10): Promise<Bookmark[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_BOOKMARKS_PENDING, [limit]);
        return rows.map(mapRowToBookmark);
    },

    async create(bookmark: Omit<Bookmark, 'id'>): Promise<number> {
        const now = Date.now();
        const result = await execute(QUERIES.INSERT_BOOKMARK, [
            bookmark.chromeBookmarkId || null,
            bookmark.chromeFolderPath || null,
            bookmark.url,
            bookmark.originalTitle,
            bookmark.faviconUrl || null,
            now,
            now,
        ]);
        logger.debug('Bookmark created:', bookmark.originalTitle);
        return result.lastInsertRowId;
    },

    async update(chromeId: string, data: Partial<Bookmark>): Promise<number> {
        const now = Date.now();
        const result = await execute(QUERIES.UPDATE_BOOKMARK, [
            data.originalTitle,
            data.url,
            data.faviconUrl || null,
            data.chromeFolderPath || null,
            now,
            chromeId,
        ]);
        logger.debug('Bookmark updated:', data.originalTitle);
        return result.changes;
    },

    async updateContent(id: number, content: string, hash: string): Promise<number> {
        const now = Date.now();
        const result = await execute(QUERIES.UPDATE_BOOKMARK_CONTENT, [
            content,
            hash,
            now,
            now,
            id,
        ]);
        return result.changes;
    },

    async updateStatus(id: number, status: BookmarkStatus, errorMessage?: string): Promise<number> {
        const now = Date.now();
        const analyzedAt = status === 'completed' ? now : null;
        const result = await execute(QUERIES.UPDATE_BOOKMARK_STATUS, [
            status,
            errorMessage || null,
            analyzedAt,
            now,
            id,
        ]);
        return result.changes;
    },

    async delete(chromeId: string): Promise<number> {
        const result = await execute(QUERIES.DELETE_BOOKMARK, [chromeId]);
        logger.debug('Bookmark deleted:', chromeId);
        return result.changes;
    },

    async count(): Promise<number> {
        const result = await query<{ count: number }>(QUERIES.GET_BOOKMARK_COUNT);
        return result[0]?.count || 0;
    },

    async countPending(): Promise<number> {
        const result = await query<{ count: number }>(QUERIES.GET_PENDING_COUNT);
        return result[0]?.count || 0;
    },

    async getAllForIndex(): Promise<BookmarkWithDetails[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_ALL_FOR_INDEX);
        return rows.map(mapRowToBookmarkWithDetails);
    },

    /**
     * Reset bookmarks stuck in 'analyzing' state back to 'pending'
     * Called on Service Worker restart to recover from mid-process termination
     */
    async resetAnalyzingToRetry(): Promise<number> {
        const result = await execute(
            `UPDATE bookmarks 
             SET status = 'pending', 
                 retry_count = retry_count + 1,
                 last_updated = ?
             WHERE status = 'analyzing'`,
            [Date.now()]
        );
        return result.changes;
    },

    /**
     * Mark a bookmark as having a dead/unreachable website
     * These will be skipped in future refetch operations
     */
    async markFetchFailed(id: number, reason: string): Promise<void> {
        const now = Date.now();
        await execute(
            `UPDATE bookmarks 
             SET fetch_failed_at = ?, fetch_fail_reason = ?, last_updated = ?
             WHERE id = ?`,
            [now, reason, now, id]
        );
        logger.debug('Bookmark marked as fetch failed:', id, reason);
    },

    /**
     * Clear the fetch failed status (e.g., for manual retry)
     */
    async clearFetchFailed(id: number): Promise<void> {
        const now = Date.now();
        await execute(
            `UPDATE bookmarks 
             SET fetch_failed_at = NULL, fetch_fail_reason = NULL, last_updated = ?
             WHERE id = ?`,
            [now, id]
        );
        logger.debug('Bookmark fetch failed status cleared:', id);
    },
};

// =====================================================
// AI Summary Repository
// =====================================================

export const AISummaryRepository = {
    async findByBookmarkId(bookmarkId: number): Promise<AISummary | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_SUMMARY_BY_BOOKMARK, [bookmarkId]);
        return rows.length > 0 ? mapRowToAISummary(rows[0]) : null;
    },

    async create(summary: Omit<AISummary, 'id'>): Promise<number> {
        const result = await execute(QUERIES.INSERT_SUMMARY, [
            summary.bookmarkId,
            summary.aiProvider,
            summary.aiModel || null,
            summary.summaryText,
            summary.summaryText, // for summary_text_lower (SQL handles LOWER)
            summary.summaryOriginal || null,
            summary.confidenceScore || null,
            summary.language || null,
            summary.createdAt,
        ]);
        logger.debug('AI Summary created for bookmark:', summary.bookmarkId);
        return result.lastInsertRowId;
    },

    async count(): Promise<number> {
        const result = await query<{ count: number }>(QUERIES.GET_SUMMARY_COUNT);
        return result[0]?.count || 0;
    },
};

// =====================================================
// Tag Repository
// =====================================================

export const TagRepository = {
    async findByName(name: string): Promise<Tag | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_TAG_BY_NAME, [name]);
        return rows.length > 0 ? mapRowToTag(rows[0]) : null;
    },

    async create(tag: Omit<Tag, 'id' | 'usageCount'>): Promise<number> {
        const result = await execute(QUERIES.INSERT_TAG, [
            tag.name,
            tag.nameZh || null,
            tag.nameEn || null,
            tag.namePinyin || null,
            tag.source,
            tag.createdAt,
        ]);
        return result.lastInsertRowId;
    },

    async findOrCreate(name: string, source: TagSource = 'ai'): Promise<number> {
        const existing = await this.findByName(name.toLowerCase());
        if (existing) {
            return existing.id;
        }
        return this.create({
            name: name.toLowerCase(),
            source,
            color: '#808080',
            createdAt: Date.now(),
        });
    },

    async addToBookmark(bookmarkId: number, tagId: number, source: TagSource = 'ai', confidence?: number): Promise<void> {
        await execute(QUERIES.ADD_BOOKMARK_TAG, [
            bookmarkId,
            tagId,
            source,
            confidence || null,
            Date.now(),
        ]);
    },

    async getBookmarkTags(bookmarkId: number): Promise<Tag[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_BOOKMARK_TAGS, [bookmarkId]);
        return rows.map(mapRowToTag);
    },

    async count(): Promise<number> {
        const result = await query<{ count: number }>(QUERIES.GET_TAG_COUNT);
        return result[0]?.count || 0;
    },
};

// =====================================================
// Category Repository
// =====================================================

// Import search engine invalidation (lazy to avoid circular deps)
let invalidateSearchIndex: (() => void) | null = null;

export const CategoryRepository = {
    async findAll(): Promise<Category[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_ALL_CATEGORIES);
        return rows.map(mapRowToCategory);
    },

    async findById(id: number): Promise<Category | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_CATEGORY_BY_ID, [id]);
        return rows.length > 0 ? mapRowToCategory(rows[0]) : null;
    },

    async findByName(name: string): Promise<Category | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_CATEGORY_BY_NAME, [name]);
        return rows.length > 0 ? mapRowToCategory(rows[0]) : null;
    },

    async findByPrefix(prefix: string, limit = 20): Promise<Category[]> {
        const pattern = `${prefix}%`;
        const rows = await query<Record<string, unknown>>(QUERIES.FIND_CATEGORIES_BY_PREFIX, [pattern, pattern, limit]);
        return rows.map(mapRowToCategory);
    },

    async create(category: Omit<Category, 'id'>): Promise<number> {
        const result = await execute(QUERIES.INSERT_CATEGORY, [
            category.name,
            category.namePinyin || null,
            category.icon || null,
            category.color || '#808080',
            Date.now(),
        ]);
        // Invalidate search index
        this._invalidateIndex();
        logger.debug('Category created:', category.name);
        return result.lastInsertRowId;
    },

    async update(id: number, name: string, namePinyin?: string): Promise<number> {
        const result = await execute(QUERIES.UPDATE_CATEGORY, [
            name,
            namePinyin || null,
            Date.now(),
            id,
        ]);
        // Invalidate search index
        this._invalidateIndex();
        logger.debug('Category updated:', name);
        return result.changes;
    },

    async delete(id: number): Promise<number> {
        const result = await execute(QUERIES.DELETE_CATEGORY, [id]);
        // Invalidate search index
        this._invalidateIndex();
        logger.debug('Category deleted:', id);
        return result.changes;
    },

    async setBookmarkCategory(bookmarkId: number, categoryId: number | null): Promise<void> {
        if (categoryId === null) {
            await execute(QUERIES.CLEAR_BOOKMARK_CATEGORY, [
                Date.now(),
                bookmarkId,
            ]);
        } else {
            await execute(QUERIES.SET_BOOKMARK_CATEGORY, [
                categoryId,
                Date.now(),
                bookmarkId,
            ]);
        }
        // Invalidate search index
        this._invalidateIndex();
    },

    _invalidateIndex(): void {
        // Lazy load to avoid circular dependency
        if (!invalidateSearchIndex) {
            try {
                // Will be set by search engine on first import
                const searchEngine = require('../services/search/search-engine');
                invalidateSearchIndex = searchEngine.invalidateIndex;
            } catch {
                // Ignore if not available yet
            }
        }
        invalidateSearchIndex?.();
    },
};


// =====================================================
// Search History Repository
// =====================================================

export const SearchHistoryRepository = {
    async add(query: string, searchType: string, resultCount: number): Promise<number> {
        const result = await execute(QUERIES.INSERT_SEARCH_HISTORY, [
            query,
            query,
            searchType,
            resultCount,
            Date.now(),
        ]);
        return result.lastInsertRowId;
    },

    async updateSelected(historyId: number, bookmarkId: number): Promise<void> {
        await execute(QUERIES.UPDATE_SEARCH_SELECTED, [bookmarkId, historyId]);
    },

    async getRecent(limit = 10): Promise<SearchHistoryEntry[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_RECENT_SEARCHES, [limit]);
        return rows.map(row => ({
            id: 0,
            query: row.query as string,
            searchType: 'default' as const,
            resultCount: 0,
            searchedAt: row.last_searched as number,
        }));
    },
};

// =====================================================
// Sync Log Repository
// =====================================================

export const SyncLogRepository = {
    async create(entry: Omit<SyncLogEntry, 'id'>): Promise<number> {
        const result = await execute(QUERIES.INSERT_SYNC_LOG, [
            entry.action,
            entry.bookmarkId || null,
            entry.status,
            entry.message || null,
            entry.timestamp,
        ]);
        return result.lastInsertRowId;
    },

    async getRecent(limit = 50): Promise<SyncLogEntry[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_RECENT_LOGS, [limit]);
        return rows.map(mapRowToSyncLog);
    },
};

// =====================================================
// Row Mapping Helpers
// =====================================================

function mapRowToBookmark(row: Record<string, unknown>): Bookmark {
    return {
        id: row.id as number,
        chromeBookmarkId: row.chrome_bookmark_id as string | undefined,
        chromeFolderPath: row.chrome_folder_path as string | undefined,
        url: row.url as string,
        originalTitle: row.original_title as string,
        faviconUrl: row.favicon_url as string | undefined,
        pageContent: row.page_content as string | undefined,
        pageContentHash: row.page_content_hash as string | undefined,
        userNotes: row.user_notes as string | undefined,
        userCategoryId: row.user_category_id as number | undefined,
        status: (row.status as BookmarkStatus) || 'pending',
        errorMessage: row.error_message as string | undefined,
        retryCount: (row.retry_count as number) || 0,
        fetchFailedAt: row.fetch_failed_at as number | undefined,
        fetchFailReason: row.fetch_fail_reason as string | undefined,
        isArchived: Boolean(row.is_archived),
        isPinned: Boolean(row.is_pinned),
        visitCount: (row.visit_count as number) || 0,
        createdAt: row.created_at as number,
        analyzedAt: row.analyzed_at as number | undefined,
        contentFetchedAt: row.content_fetched_at as number | undefined,
        lastUpdated: row.last_updated as number,
    };
}

function mapRowToBookmarkWithDetails(row: Record<string, unknown>): BookmarkWithDetails {
    const bookmark = mapRowToBookmark(row);

    // Parse tags from GROUP_CONCAT result
    const tagNames = row.tag_names as string | null;
    const tags: Tag[] = tagNames
        ? tagNames.split(',').map((name, i) => ({
            id: i,
            name,
            source: 'ai' as TagSource,
            usageCount: 0,
            color: '#808080',
            createdAt: 0,
        }))
        : [];

    // Parse category
    const category: Category | undefined = row.category_name
        ? {
            id: 0,
            name: row.category_name as string,
            namePinyin: row.category_pinyin as string | undefined,
            color: '#808080',
            sortOrder: 0,
            createdAt: 0,
        }
        : undefined;

    // Parse summary
    const summary: AISummary | undefined = row.summary_text
        ? {
            id: 0,
            bookmarkId: bookmark.id,
            aiProvider: (row.ai_provider as string) || 'unknown',
            summaryText: row.summary_text as string,
            createdAt: 0,
        }
        : undefined;

    return {
        ...bookmark,
        summary,
        tags,
        category,
    };
}

function mapRowToAISummary(row: Record<string, unknown>): AISummary {
    return {
        id: row.id as number,
        bookmarkId: row.bookmark_id as number,
        aiProvider: row.ai_provider as string,
        aiModel: row.ai_model as string | undefined,
        summaryText: row.summary_text as string,
        summaryOriginal: row.summary_original as string | undefined,
        confidenceScore: row.confidence_score as number | undefined,
        language: row.language as string | undefined,
        createdAt: row.created_at as number,
    };
}

function mapRowToTag(row: Record<string, unknown>): Tag {
    return {
        id: row.id as number,
        name: row.name as string,
        nameZh: row.name_zh as string | undefined,
        nameEn: row.name_en as string | undefined,
        namePinyin: row.name_pinyin as string | undefined,
        source: (row.source as TagSource) || 'ai',
        usageCount: (row.usage_count as number) || 0,
        color: (row.color as string) || '#808080',
        createdAt: row.created_at as number,
    };
}

function mapRowToCategory(row: Record<string, unknown>): Category {
    return {
        id: row.id as number,
        name: row.name as string,
        namePinyin: row.name_pinyin as string | undefined,
        icon: row.icon as string | undefined,
        color: (row.color as string) || '#808080',
        parentId: row.parent_id as number | undefined,
        sortOrder: (row.sort_order as number) || 0,
        createdAt: row.created_at as number,
    };
}

function mapRowToSyncLog(row: Record<string, unknown>): SyncLogEntry {
    return {
        id: row.id as number,
        action: row.action as SyncAction,
        bookmarkId: row.bookmark_id as number | undefined,
        status: row.status as SyncLogStatus,
        message: row.message as string | undefined,
        timestamp: row.timestamp as number,
    };
}

// =====================================================
// History Record Repository (! 历史搜索)
// =====================================================

export const HistoryRecordRepository = {
    async upsert(record: HistoryRecordInput): Promise<number> {
        const now = Date.now();
        const result = await execute(QUERIES.UPSERT_HISTORY_RECORD, [
            record.title,
            record.url,
            record.pageDescription || null,
            record.faviconUrl || null,
            record.sourceType,
            record.searchQuery || null,
            record.bookmarkId || null,
            now,
            now,
        ]);
        logger.debug('History record upserted:', record.url);
        return result.lastInsertRowId;
    },

    async getByUrl(url: string): Promise<HistoryRecord | null> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_HISTORY_BY_URL, [url]);
        return rows.length > 0 ? mapRowToHistoryRecord(rows[0]) : null;
    },

    async getAllForIndex(limit = 500): Promise<HistoryRecord[]> {
        const rows = await query<Record<string, unknown>>(QUERIES.GET_ALL_HISTORY_FOR_INDEX, [limit]);
        return rows.map(mapRowToHistoryRecord);
    },

    async updateTimeSpent(id: number, duration: number): Promise<void> {
        await execute(QUERIES.UPDATE_HISTORY_TIME_SPENT, [duration, id]);
    },

    async search(query_text: string, limit = 20): Promise<HistoryRecord[]> {
        const pattern = `%${query_text}%`;
        const rows = await query<Record<string, unknown>>(QUERIES.SEARCH_HISTORY, [
            pattern, pattern, pattern, limit
        ]);
        return rows.map(mapRowToHistoryRecord);
    },

    async cleanup(keepCount = 1000): Promise<number> {
        const result = await execute(QUERIES.DELETE_OLD_HISTORY, [keepCount]);
        if (result.changes > 0) {
            logger.info('Cleaned up old history records:', result.changes);
        }
        return result.changes;
    },
};

function mapRowToHistoryRecord(row: Record<string, unknown>): HistoryRecord {
    return {
        id: row.id as number,
        title: row.title as string,
        url: row.url as string,
        pageDescription: row.page_description as string | undefined,
        faviconUrl: row.favicon_url as string | undefined,
        sourceType: (row.source_type as HistorySourceType) || 'navigate',
        searchQuery: row.search_query as string | undefined,
        bookmarkId: row.bookmark_id as number | undefined,
        visitCount: (row.visit_count as number) || 1,
        totalTimeSpent: (row.total_time_spent as number) || 0,
        firstVisitAt: row.first_visit_at as number,
        lastVisitAt: row.last_visit_at as number,
    };
}

export default {
    BookmarkRepository,
    AISummaryRepository,
    TagRepository,
    CategoryRepository,
    SearchHistoryRepository,
    SyncLogRepository,
    HistoryRecordRepository,
};
