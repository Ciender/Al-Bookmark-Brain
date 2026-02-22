/**
 * AI Bookmark Brain - Search Engine v2
 * Multi-strategy search with fuzzy, pinyin, and weighted scoring
 * Now with user-configurable priority ordering
 */

import Fuse from 'fuse.js';
import pinyinMatch from 'pinyin-match';
import { logger } from '../../shared/logger';
import { BookmarkRepository, SearchHistoryRepository } from '../database.service';
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
const CATEGORY_PREFIX = /^[@\uFF20]([^\s]+)(?:\s+(.*))?$/;

/**
 * Check if query uses @category prefix
 */
export function isCategorySearch(query: string): boolean {
    return CATEGORY_PREFIX.test(query.trim());
}

/**
 * Parse @category search query
 * Returns { category: string, keyword: string }
 * Example: "@服务�?react" => { category: "服务�?, keyword: "react" }
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
 * Split query into terms by whitespace.
 * Multi-term queries use AND semantics to improve precision.
 */
function splitQueryTerms(query: string): string[] {
    return query
        .trim()
        .split(/\s+/u)
        .map(term => term.trim())
        .filter(Boolean);
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

interface StrategyMatch {
    score: number;
    matchType: MatchType;
    field: SearchField;
}

/**
 * Find best non-fuzzy strategy match for a single term.
 * Returns highest-priority strategy match or null.
 */
function findBestMatchForTerm(
    bookmark: BookmarkWithDetails,
    term: string,
    enabledStrategies: SearchStrategy[],
    searchType: string,
    totalStrategies: number
): StrategyMatch | null {
    for (let i = 0; i < enabledStrategies.length; i++) {
        const strategy = enabledStrategies[i];

        // Skip content field unless in fulltext mode
        if (strategy.field === 'content' && searchType !== 'fulltext') {
            continue;
        }

        // Skip fuzzy strategies here (handled by Fuse.js in phase 2)
        if (strategy.matchType === 'fuzzy') {
            continue;
        }

        const texts = getFieldText(bookmark, strategy.field);
        const matched = texts.some(text => checkMatch(term, text, strategy.matchType));

        if (matched) {
            return {
                score: calculateScore(i, totalStrategies),
                matchType: fieldToMatchType(strategy.field, strategy.matchType),
                field: strategy.field,
            };
        }
    }

    return null;
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
    const { query, searchType = 'default', limit = 20, filters } = options;

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
    const allowedIds = new Set<number>();

    // Apply explicit filters first
    if (filters) {
        filteredIndex = filteredIndex.filter((bookmark) => {
            if (filters.categoryId !== undefined) {
                if (bookmark.userCategoryId !== filters.categoryId) return false;
            }
            if (filters.status !== undefined && bookmark.status !== filters.status) return false;
            if (filters.isPinned !== undefined && bookmark.isPinned !== filters.isPinned) return false;
            if (filters.isArchived !== undefined && bookmark.isArchived !== filters.isArchived) return false;
            if (filters.hasAiSummary !== undefined) {
                const hasSummary = Boolean(bookmark.summary?.summaryText);
                if (hasSummary !== filters.hasAiSummary) return false;
            }
            return true;
        });
    }

    if (isCategorySearch(query)) {
        const parsed = parseCategorySearch(query);
        categoryFilter = parsed.category;
        effectiveQuery = parsed.keyword;

        // Filter category with exact/partial/pinyin matching to align with normal search behavior
        const lowerCategoryFilter = categoryFilter?.toLowerCase() || '';
        filteredIndex = filteredIndex.filter(bookmark => {
            const category = bookmark.category;
            if (!category?.name) return false;

            const catNameLower = category.name.toLowerCase();
            if (catNameLower === lowerCategoryFilter || catNameLower.includes(lowerCategoryFilter)) {
                return true;
            }

            if (category.namePinyin?.toLowerCase().includes(lowerCategoryFilter)) {
                return true;
            }

            try {
                return !!pinyinMatch.match(category.name, categoryFilter || '');
            } catch {
                return false;
            }
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

    const queryTerms = splitQueryTerms(effectiveQuery);

    for (const bookmark of filteredIndex) {
        allowedIds.add(bookmark.id);
    }

    const results: Map<number, SearchResult> = new Map();
    const enabledStrategies = getEnabledStrategies(activeStrategies);
    const totalStrategies = enabledStrategies.length;

    // ========================================
    // Phase 1: Strategy-based matching
    // Multi-term queries use AND semantics across terms.
    // ========================================
    for (const bookmark of filteredIndex) {
        const termMatches: StrategyMatch[] = [];
        let allTermsMatched = true;

        for (const term of queryTerms) {
            const termMatch = findBestMatchForTerm(
                bookmark,
                term,
                enabledStrategies,
                searchType,
                totalStrategies
            );

            if (!termMatch) {
                allTermsMatched = false;
                break;
            }

            termMatches.push(termMatch);
        }

        if (allTermsMatched && termMatches.length > 0) {
            const primaryMatch = termMatches.reduce((best, current) =>
                current.score > best.score ? current : best
            );
            const averageScore = termMatches.reduce((sum, match) => sum + match.score, 0) / termMatches.length;
            const multiTermBonus = Math.min(8, Math.max(0, (termMatches.length - 1) * 2));
            const combinedScore = Math.min(100, averageScore + multiTermBonus);

            results.set(bookmark.id, {
                bookmark,
                score: combinedScore,
                matchType: primaryMatch.matchType,
                matchedField: primaryMatch.field,
            });
        }
    }

    // ========================================
    // Phase 2: Fuzzy search for remaining matches
    // Only runs if we haven't reached the limit yet
    // ========================================
    const hasFuzzyStrategy = enabledStrategies.some(s => s.matchType === 'fuzzy');

    if (fuseInstance && results.size < limit && hasFuzzyStrategy && queryTerms.length > 0) {
        // Find the configured score position for fuzzy matches
        const fuzzyIndex = enabledStrategies.findIndex(s => s.matchType === 'fuzzy');
        const fuzzyBaseScore = fuzzyIndex >= 0
            ? calculateScore(fuzzyIndex, totalStrategies)
            : 35; // Fallback if no fuzzy strategy configured

        const fuzzyCandidates = new Map<number, {
            bookmark: BookmarkWithDetails;
            hits: number;
            qualitySum: number;
        }>();

        // Multi-term fuzzy: search each term and aggregate with AND semantics.
        const perTermLimit = Math.max(limit * 5, 100);
        for (const term of queryTerms) {
            const termFuzzyResults = fuseInstance.search(term, { limit: perTermLimit });
            const seenInTerm = new Set<number>();

            for (const fuzzyResult of termFuzzyResults) {
                const bookmarkId = fuzzyResult.item.id;
                if (seenInTerm.has(bookmarkId)) {
                    continue;
                }
                seenInTerm.add(bookmarkId);

                if (!allowedIds.has(bookmarkId)) {
                    continue;
                }

                const quality = 1 - (fuzzyResult.score || 0);
                const existing = fuzzyCandidates.get(bookmarkId);

                if (existing) {
                    existing.hits += 1;
                    existing.qualitySum += quality;
                } else {
                    fuzzyCandidates.set(bookmarkId, {
                        bookmark: fuzzyResult.item,
                        hits: 1,
                        qualitySum: quality,
                    });
                }
            }
        }

        for (const candidate of fuzzyCandidates.values()) {
            // Require all query terms to be matched by fuzzy to keep precision.
            if (candidate.hits < queryTerms.length) {
                continue;
            }
            if (results.has(candidate.bookmark.id)) {
                continue;
            }

            const avgQuality = candidate.qualitySum / candidate.hits;
            const coverageBoost = Math.min(0.15, Math.max(0, (candidate.hits - 1) * 0.05));
            const adjustedScore = fuzzyBaseScore * Math.min(1, avgQuality + coverageBoost);

            results.set(candidate.bookmark.id, {
                bookmark: candidate.bookmark,
                score: adjustedScore,
                matchType: 'fuzzy',
                matchedField: 'fuzzy',
            });
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

const HISTORY_PREFIX = /^[!\uFF01]/;  // English and full-width exclamation mark
const HISTORY_RECENT_CACHE_TTL = 30_000;
const HISTORY_MIN_DIRECT_RESULTS = 100;
const HISTORY_MAX_FALLBACK_SCAN = 5000;
const HISTORY_SCORE_STEP = 10_000_000_000_000;

let cachedRecentHistory: chrome.history.HistoryItem[] = [];
let cachedRecentHistoryAt = 0;

interface HistoryMatchMeta {
    priority: number;
    matchType: MatchType;
    matchedField: string;
}

const HISTORY_MATCH_PRIORITY = {
    exact: 3,
    pinyin: 2,
    recent: 1,
} as const;

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

function getHistoryItemKey(item: chrome.history.HistoryItem): string {
    if (item.url) return item.url;
    if (item.id !== undefined && item.id !== null) return String(item.id);
    return `${item.title || ''}-${item.lastVisitTime || 0}`;
}

function buildHistoryResult(
    item: chrome.history.HistoryItem,
    meta: HistoryMatchMeta
): HistorySearchResult {
    const lastVisitAt = item.lastVisitTime || Date.now();
    const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url || '')}&size=32`;
    const score = (meta.priority * HISTORY_SCORE_STEP) + lastVisitAt;

    return {
        history: {
            id: item.id || item.url || '',
            title: item.title || item.url || 'No Title',
            url: item.url || '',
            pageDescription: undefined,
            faviconUrl,
            sourceType: 'navigate',
            visitCount: item.visitCount || 1,
            totalTimeSpent: 0,
            firstVisitAt: 0, // Not available from chrome.history.search
            lastVisitAt,
        },
        score,
        matchType: meta.matchType,
        matchedField: meta.matchedField,
    };
}

function inferDirectMatchMeta(item: chrome.history.HistoryItem, queryLower: string): HistoryMatchMeta {
    const titleLower = (item.title || '').toLowerCase();
    const urlLower = (item.url || '').toLowerCase();

    if (titleLower.includes(queryLower)) {
        return {
            priority: HISTORY_MATCH_PRIORITY.exact,
            matchType: 'exact',
            matchedField: 'title',
        };
    }

    if (urlLower.includes(queryLower)) {
        return {
            priority: HISTORY_MATCH_PRIORITY.exact,
            matchType: 'exact',
            matchedField: 'url',
        };
    }

    // Chrome may return tokenized/fuzzy matches even without a strict substring hit.
    return {
        priority: HISTORY_MATCH_PRIORITY.exact,
        matchType: 'exact',
        matchedField: 'title',
    };
}

function evaluateFallbackMatch(
    item: chrome.history.HistoryItem,
    terms: string[],
    termsLower: string[]
): HistoryMatchMeta | null {
    if (terms.length === 0) {
        return null;
    }

    const title = item.title || '';
    const titleLower = title.toLowerCase();
    const urlLower = (item.url || '').toLowerCase();

    let usedPinyin = false;
    let matchedField: string = 'title';

    for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        const termLower = termsLower[i];

        if (!termLower) {
            continue;
        }

        if (titleLower.includes(termLower)) {
            matchedField = 'title';
            continue;
        }

        if (urlLower.includes(termLower)) {
            matchedField = 'url';
            continue;
        }

        let pinyinMatched = false;
        if (title) {
            try {
                pinyinMatched = !!pinyinMatch.match(title, term);
            } catch {
                pinyinMatched = false;
            }
        }

        if (!pinyinMatched) {
            return null;
        }

        usedPinyin = true;
        matchedField = 'title';
    }

    return {
        priority: usedPinyin ? HISTORY_MATCH_PRIORITY.pinyin : HISTORY_MATCH_PRIORITY.exact,
        matchType: usedPinyin ? 'pinyin' : 'exact',
        matchedField,
    };
}

async function getRecentHistoryForFallback(maxResults: number): Promise<chrome.history.HistoryItem[]> {
    const now = Date.now();
    if (
        cachedRecentHistory.length >= maxResults &&
        now - cachedRecentHistoryAt < HISTORY_RECENT_CACHE_TTL
    ) {
        return cachedRecentHistory.slice(0, maxResults);
    }

    const items = await chrome.history.search({
        text: '',
        maxResults,
        startTime: 0,
    });

    items.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));

    cachedRecentHistory = items;
    cachedRecentHistoryAt = now;
    return items;
}

/**
 * Search browser history via Chrome History API.
 * Supports pinyin fallback for ASCII queries (e.g. "!lvbao" -> Chinese titles).
 */
export async function searchHistory(rawQuery: string, limit = 100): Promise<HistorySearchResult[]> {
    const query = extractHistoryQuery(rawQuery);

    try {
        // "!" with no keyword: return recent history directly.
        if (!query) {
            const recentItems = await chrome.history.search({
                text: '',
                maxResults: limit,
                startTime: 0,
            });

            recentItems.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
            return recentItems.map(item => buildHistoryResult(item, {
                priority: HISTORY_MATCH_PRIORITY.recent,
                matchType: 'exact',
                matchedField: 'title',
            }));
        }

        const directMaxResults = Math.max(limit * 3, HISTORY_MIN_DIRECT_RESULTS);
        const directMatches = await chrome.history.search({
            text: query,
            maxResults: directMaxResults,
            startTime: 0,
        });

        const mergedMatches = new Map<string, {
            item: chrome.history.HistoryItem;
            meta: HistoryMatchMeta;
        }>();

        const upsertMatch = (item: chrome.history.HistoryItem, meta: HistoryMatchMeta): void => {
            const key = getHistoryItemKey(item);
            if (!key) return;

            const existing = mergedMatches.get(key);
            if (!existing) {
                mergedMatches.set(key, { item, meta });
                return;
            }

            const existingVisit = existing.item.lastVisitTime || 0;
            const currentVisit = item.lastVisitTime || 0;
            if (meta.priority > existing.meta.priority) {
                mergedMatches.set(key, { item, meta });
                return;
            }
            if (meta.priority === existing.meta.priority && currentVisit > existingVisit) {
                mergedMatches.set(key, { item, meta });
            }
        };

        const queryLower = query.toLowerCase();
        for (const item of directMatches) {
            upsertMatch(item, inferDirectMatchMeta(item, queryLower));
        }

        // For ASCII input, add a pinyin fallback against recent history.
        // This makes queries like "!lvbao" match Chinese titles.
        const normalizedAsciiQuery = query.replace(/\s+/g, '');
        const shouldTryPinyinFallback =
            /^[a-z0-9\s]+$/i.test(query) &&
            normalizedAsciiQuery.length >= 2 &&
            mergedMatches.size < limit;

        if (shouldTryPinyinFallback) {
            const fallbackScanLimit = Math.min(
                Math.max(limit * 25, 800),
                HISTORY_MAX_FALLBACK_SCAN
            );

            const fallbackPool = await getRecentHistoryForFallback(fallbackScanLimit);
            const terms = splitQueryTerms(query);
            const termsLower = terms.map(term => term.toLowerCase());

            for (const item of fallbackPool) {
                const key = getHistoryItemKey(item);
                if (!key || mergedMatches.has(key)) {
                    continue;
                }

                const meta = evaluateFallbackMatch(item, terms, termsLower);
                if (!meta) {
                    continue;
                }

                upsertMatch(item, meta);
            }
        }

        const sorted = Array.from(mergedMatches.values())
            .sort((a, b) => {
                if (a.meta.priority !== b.meta.priority) {
                    return b.meta.priority - a.meta.priority;
                }
                return (b.item.lastVisitTime || 0) - (a.item.lastVisitTime || 0);
            })
            .slice(0, limit);

        return sorted.map(({ item, meta }) => buildHistoryResult(item, meta));
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
