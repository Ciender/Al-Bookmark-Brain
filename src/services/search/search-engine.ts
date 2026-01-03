/**
 * AI Bookmark Brain - Search Engine v2
 * Multi-strategy search with fuzzy, pinyin, and weighted scoring
 * Now with user-configurable priority ordering
 */

import Fuse from 'fuse.js';
import pinyinMatch from 'pinyin-match';
import { logger } from '../../shared/logger';
import { BookmarkRepository, SearchHistoryRepository } from '../database.service';
import { SEARCH_WEIGHTS } from '../../database/schema';
import { sortByFrecency } from './frecency.service';
import {
    loadSearchStrategies,
    calculateScore,
    getEnabledStrategies,
    DEFAULT_SEARCH_STRATEGIES,
    type SearchStrategy,
    type MatchMode,
    type SearchField,
} from './search-config';
import { searchStrategyOrder } from '../../lib/storage';
import type {
    BookmarkWithDetails,
    SearchResult,
    SearchOptions,
    MatchType,
    HistoryRecord,
    HistorySearchResult,
} from '../../shared/types';

// Cached search index
let searchIndex: BookmarkWithDetails[] = [];
let fuseInstance: Fuse<BookmarkWithDetails> | null = null;
let lastIndexUpdate = 0;

// Cached search strategies (loaded from user config)
let activeStrategies: SearchStrategy[] = [];
let lastStrategiesUpdate = 0;

const INDEX_REFRESH_INTERVAL = 60000; // 1 minute
const STRATEGIES_REFRESH_INTERVAL = 30000; // 30 seconds

// =====================================================
// @Category Search Prefix
// =====================================================

// Match @category prefix (supports Chinese and English @ symbols)
const CATEGORY_PREFIX = /^[@＠]([^\s]+)(?:\s+(.*))?$/;

/**
 * Check if query uses @category prefix
 */
export function isCategorySearch(query: string): boolean {
    return CATEGORY_PREFIX.test(query.trim());
}

/**
 * Parse @category search query
 * Returns { category: string, keyword: string }
 * Example: "@服务器 react" => { category: "服务器", keyword: "react" }
 */
export function parseCategorySearch(query: string): { category: string; keyword: string } {
    const match = query.trim().match(CATEGORY_PREFIX);
    if (match) {
        return {
            category: match[1] || '',
            keyword: (match[2] || '').trim(),
        };
    }
    return { category: '', keyword: query };
}


/**
 * Refresh user-configured search strategies
 */
async function refreshStrategies(): Promise<void> {
    const now = Date.now();
    if (now - lastStrategiesUpdate < STRATEGIES_REFRESH_INTERVAL && activeStrategies.length > 0) {
        return;
    }

    try {
        const saved = await searchStrategyOrder.getValue();
        activeStrategies = loadSearchStrategies(saved);
        lastStrategiesUpdate = now;
        logger.debug('Search strategies refreshed:', activeStrategies.length, 'strategies');
    } catch (error) {
        logger.error('Failed to refresh search strategies:', error);
        // Fallback to defaults
        activeStrategies = [...DEFAULT_SEARCH_STRATEGIES];
    }
}

/**
 * Refresh search index from database
 */
async function refreshIndex(): Promise<void> {
    const now = Date.now();

    // Refresh strategies first
    await refreshStrategies();

    if (now - lastIndexUpdate < INDEX_REFRESH_INTERVAL && searchIndex.length > 0) {
        return;
    }

    try {
        searchIndex = await BookmarkRepository.getAllForIndex();

        // Initialize Fuse.js for fuzzy search
        fuseInstance = new Fuse(searchIndex, {
            keys: [
                { name: 'originalTitle', weight: 0.3 },
                { name: 'url', weight: 0.2 },
                { name: 'summary.summaryText', weight: 0.25 },
                { name: 'userNotes', weight: 0.15 },
                { name: 'category.name', weight: 0.1 },
            ],
            threshold: 0.4,
            includeScore: true,
            ignoreLocation: true,
        });

        lastIndexUpdate = now;
        logger.debug('Search index refreshed:', searchIndex.length, 'bookmarks');
    } catch (error) {
        logger.error('Failed to refresh search index:', error);
    }
}


/**
 * Check if a text matches using the specified match mode
 * Returns true if matched, false otherwise
 */
function checkMatch(query: string, text: string | undefined, matchMode: MatchMode): boolean {
    if (!text) return false;

    switch (matchMode) {
        case 'exact_case':
            // Case-sensitive exact match
            return text.includes(query);
        case 'exact':
            // Case-insensitive exact match
            return text.toLowerCase().includes(query.toLowerCase());
        case 'pinyin':
            // Pinyin match (Chinese)
            try {
                return !!pinyinMatch.match(text, query);
            } catch {
                return false;
            }
        case 'fuzzy':
            // Fuzzy is handled separately by Fuse.js
            return false;
        default:
            return false;
    }
}

/**
 * Get the text value to search for a given field from a bookmark
 */
function getFieldText(bookmark: BookmarkWithDetails, field: SearchField): string[] {
    switch (field) {
        case 'url':
            return bookmark.url ? [bookmark.url] : [];
        case 'title':
            return bookmark.originalTitle ? [bookmark.originalTitle] : [];
        case 'tag':
            if (!bookmark.tags) return [];
            return bookmark.tags.flatMap(t => [
                t.name,
                t.nameZh,
                t.nameEn,
                t.namePinyin,
            ].filter(Boolean) as string[]);
        case 'summary':
            return bookmark.summary?.summaryText ? [bookmark.summary.summaryText] : [];
        case 'category':
            const cat = bookmark.category;
            return cat ? [cat.name, cat.namePinyin].filter(Boolean) as string[] : [];
        case 'notes':
            return bookmark.userNotes ? [bookmark.userNotes] : [];
        case 'content':
            return bookmark.pageContent ? [bookmark.pageContent] : [];
        default:
            return [];
    }
}

/**
 * Map SearchField to MatchType for result
 */
function fieldToMatchType(field: SearchField, matchMode: MatchMode): MatchType {
    // For exact_case, return 'exact_case', for others map based on field
    if (matchMode === 'exact_case') return 'exact_case';
    if (matchMode === 'exact') return 'exact';
    if (matchMode === 'pinyin') return 'pinyin';
    if (matchMode === 'fuzzy') return 'fuzzy';

    // Fallback based on field type for legacy compatibility
    switch (field) {
        case 'url': return 'url';
        case 'tag': return 'tag';
        case 'summary': return 'summary';
        case 'category': return 'category';
        case 'notes': return 'notes';
        case 'content': return 'content';
        default: return 'exact';
    }
}

/**
 * Search bookmarks with configurable strategy priorities
 * Supports @category prefix for category filtering
 */
export async function search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, searchType = 'default', limit = 20 } = options;

    if (!query || query.trim().length === 0) {
        return [];
    }

    await refreshIndex();

    // ========================================
    // Handle @category prefix filtering
    // ========================================
    let effectiveQuery = query;
    let categoryFilter: string | null = null;
    let filteredIndex = searchIndex;

    if (isCategorySearch(query)) {
        const parsed = parseCategorySearch(query);
        categoryFilter = parsed.category;
        effectiveQuery = parsed.keyword;

        // Filter by exact category name match (case-insensitive)
        filteredIndex = searchIndex.filter(bookmark => {
            const catName = bookmark.category?.name?.toLowerCase();
            return catName === categoryFilter?.toLowerCase();
        });

        logger.debug(`Category filter: "${categoryFilter}", keyword: "${effectiveQuery}", matching: ${filteredIndex.length}`);

        // If no keyword provided, return all in category sorted by update time
        if (!effectiveQuery) {
            return filteredIndex
                .sort((a, b) => {
                    if (a.isPinned && !b.isPinned) return -1;
                    if (!a.isPinned && b.isPinned) return 1;
                    return b.lastUpdated - a.lastUpdated;
                })
                .slice(0, limit)
                .map(bookmark => ({
                    bookmark,
                    score: 100,
                    matchType: 'category' as MatchType,
                    matchedField: 'category',
                }));
        }
    }

    const results: Map<number, SearchResult> = new Map();
    const enabledStrategies = getEnabledStrategies(activeStrategies);
    const totalStrategies = enabledStrategies.length;

    // ========================================
    // Phase 1: Strategy-based matching
    // For each bookmark, find the highest-priority strategy that matches
    // ========================================
    for (const bookmark of filteredIndex) {

        let bestMatch: { score: number; matchType: MatchType; field: string } | null = null;

        // Iterate through strategies in priority order (index 0 = highest priority)
        for (let i = 0; i < enabledStrategies.length; i++) {
            const strategy = enabledStrategies[i];

            // Skip content field unless in fulltext mode
            if (strategy.field === 'content' && searchType !== 'fulltext') {
                continue;
            }

            // Skip fuzzy strategies in this phase (handled by Fuse.js later)
            if (strategy.matchType === 'fuzzy') {
                continue;
            }

            // Get all text values for this field
            const texts = getFieldText(bookmark, strategy.field);

            // Check if any text matches (use effectiveQuery for @category searches)
            const matched = texts.some(text => checkMatch(effectiveQuery, text, strategy.matchType));

            if (matched) {
                // Calculate score based on position in strategy list
                const score = calculateScore(i, totalStrategies);
                const matchType = fieldToMatchType(strategy.field, strategy.matchType);

                // First match wins (because strategies are sorted by priority)
                if (!bestMatch) {
                    bestMatch = {
                        score,
                        matchType,
                        field: strategy.field,
                    };
                    break; // Stop at first match - it's the highest priority
                }
            }
        }

        if (bestMatch) {
            results.set(bookmark.id, {
                bookmark,
                score: bestMatch.score,
                matchType: bestMatch.matchType,
                matchedField: bestMatch.field,
            });
        }
    }

    // ========================================
    // Phase 2: Fuzzy search for remaining matches
    // Only runs if we haven't reached the limit yet
    // ========================================
    const hasFuzzyStrategy = enabledStrategies.some(s => s.matchType === 'fuzzy');

    if (fuseInstance && results.size < limit && hasFuzzyStrategy && effectiveQuery) {
        const fuseResults = fuseInstance.search(effectiveQuery, { limit: limit - results.size });

        // Find the lowest score position for fuzzy matches (bottom of strategies)
        const fuzzyIndex = enabledStrategies.findIndex(s => s.matchType === 'fuzzy');
        const fuzzyBaseScore = fuzzyIndex >= 0
            ? calculateScore(fuzzyIndex, totalStrategies)
            : 35; // Fallback if no fuzzy strategy configured

        for (const result of fuseResults) {
            if (!results.has(result.item.id)) {
                // Adjust score based on Fuse.js match quality (0 = perfect, 1 = poor)
                const fuseQuality = 1 - (result.score || 0);
                const adjustedScore = fuzzyBaseScore * fuseQuality;

                results.set(result.item.id, {
                    bookmark: result.item,
                    score: adjustedScore,
                    matchType: 'fuzzy',
                    matchedField: 'fuzzy',
                });
            }
        }
    }


    // Sort by score (descending), then by pinned status
    const sortedResults = Array.from(results.values())
        .sort((a, b) => {
            // Pinned items first
            if (a.bookmark.isPinned && !b.bookmark.isPinned) return -1;
            if (!a.bookmark.isPinned && b.bookmark.isPinned) return 1;
            // Then by score
            return b.score - a.score;
        })
        .slice(0, limit);

    // Apply frecency re-ranking (preserves pinned-first order)
    const pinnedResults = sortedResults.filter(r => r.bookmark.isPinned);
    const normalResults = sortedResults.filter(r => !r.bookmark.isPinned);
    const frecencySortedNormal = sortByFrecency(effectiveQuery || query, normalResults);
    const finalResults = [...pinnedResults, ...frecencySortedNormal];

    // Save search to history
    try {
        await SearchHistoryRepository.add(query, searchType, finalResults.length);
    } catch (error) {
        logger.debug('Failed to save search history:', error);
    }

    logger.debug(`Search for "${query}" returned ${finalResults.length} results`);
    return finalResults;
}

export function invalidateIndex(): void {
    lastIndexUpdate = 0;
}

// =====================================================
// History Search (! prefix)
// =====================================================

const HISTORY_PREFIX = /^[!！]/;  // English and Chinese exclamation mark

/**
 * Check if query is a history search
 */
export function isHistorySearch(query: string): boolean {
    return HISTORY_PREFIX.test(query.trim());
}

/**
 * Extract actual query from history search (remove ! prefix)
 */
export function extractHistoryQuery(query: string): string {
    return query.replace(HISTORY_PREFIX, '').trim();
}

// History search index cache removed - using Chrome API directly

/**
 * Search history records via Chrome History API
 * When query is empty (just "!" or "！"), returns recent history
 */
export async function searchHistory(rawQuery: string, limit = 100): Promise<HistorySearchResult[]> {
    const query = extractHistoryQuery(rawQuery);

    try {
        const historyItems = await chrome.history.search({
            text: query,
            maxResults: limit,
            startTime: 0
        });

        // Sort by lastVisitTime descending (most recent first)
        historyItems.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));

        return historyItems.map(item => {
            // Construct favicon URL
            // Use Chrome's _favicon helper
            const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url || '')}&size=32`;

            return {
                history: {
                    id: item.id,
                    title: item.title || item.url || 'No Title',
                    url: item.url || '',
                    pageDescription: undefined,
                    faviconUrl,
                    sourceType: 'navigate',
                    visitCount: item.visitCount || 1,
                    totalTimeSpent: 0,
                    firstVisitAt: 0, // Not available from search
                    lastVisitAt: item.lastVisitTime || Date.now(),
                },
                score: item.lastVisitTime || 0,
                matchType: 'exact', // Chrome api handles matching
                matchedField: 'title',
            };
        });
    } catch (error) {
        logger.error('Chrome history search failed:', error);
        return [];
    }
}

export default {
    search,
    invalidateIndex,
    isHistorySearch,
    extractHistoryQuery,
    searchHistory,
    isCategorySearch,
    parseCategorySearch,
};
