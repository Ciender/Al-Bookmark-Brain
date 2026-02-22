/**
 * History Search Service
 * Reuses existing Fuse.js + pinyin-match stack to provide
 * DB-first history search with Chrome History API fallback.
 */

import Fuse from 'fuse.js';
import pinyinMatch from 'pinyin-match';
import { extensionSettings } from '../../lib/storage';
import { logger } from '../../shared/logger';
import type { HistoryRecord, HistorySearchResult, MatchType } from '../../shared/types';
import { HistoryRecordRepository } from '../database.service';

const HISTORY_PREFIX = /^[!\uFF01]/;
const DEFAULT_HISTORY_CACHE_LIMIT = 10000;
const MIN_HISTORY_CACHE_LIMIT = 200;
const MAX_HISTORY_CACHE_LIMIT = 200000;
const HISTORY_INDEX_REFRESH_INTERVAL = 30_000;
const HISTORY_INDEX_SCAN_CAP = 5000;
const HISTORY_MIN_CHROME_RESULTS = 100;
const HISTORY_LIMIT_CLEANUP_INTERVAL = 60_000;
const CHROME_FALLBACK_INTERVAL = 20_000;

let historyIndex: HistoryRecord[] = [];
let historyFuse: Fuse<HistoryRecord> | null = null;
let lastHistoryIndexUpdate = 0;
let lastHistoryCleanupAt = 0;
let lastChromeFallbackAt = 0;

export function isHistorySearch(query: string): boolean {
    return HISTORY_PREFIX.test(query.trim());
}

export function extractHistoryQuery(query: string): string {
    return query.replace(HISTORY_PREFIX, '').trim();
}

export function invalidateHistorySearchIndex(): void {
    lastHistoryIndexUpdate = 0;
}

function splitQueryTerms(query: string): string[] {
    return query
        .trim()
        .split(/\s+/u)
        .map(term => term.trim())
        .filter(Boolean);
}

function normalizeHistoryLimit(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_HISTORY_CACHE_LIMIT;
    }
    const rounded = Math.round(value as number);
    return Math.min(MAX_HISTORY_CACHE_LIMIT, Math.max(MIN_HISTORY_CACHE_LIMIT, rounded));
}

function isTrackableUrl(url: string): boolean {
    const blockedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];
    return Boolean(url) && !blockedPrefixes.some(prefix => url.startsWith(prefix));
}

function buildFaviconUrl(url: string): string {
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
}

function historyKey(record: HistoryRecord): string {
    return record.url || String(record.id);
}

function recencyBoost(lastVisitAt: number): number {
    const ageMs = Math.max(0, Date.now() - lastVisitAt);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return Math.max(0, 8 - Math.min(8, ageDays));
}

function toHistorySearchResult(
    record: HistoryRecord,
    score: number,
    matchType: MatchType,
    matchedField: string
): HistorySearchResult {
    return {
        history: {
            ...record,
            faviconUrl: record.faviconUrl || buildFaviconUrl(record.url),
        },
        score,
        matchType,
        matchedField,
    };
}

async function getHistoryCacheLimit(): Promise<number> {
    const settings = await extensionSettings.getValue();
    return normalizeHistoryLimit(settings?.historyCacheLimit);
}

async function refreshHistoryIndex(force = false): Promise<void> {
    const now = Date.now();
    if (!force && historyIndex.length > 0 && now - lastHistoryIndexUpdate < HISTORY_INDEX_REFRESH_INTERVAL) {
        return;
    }

    const indexLimit = Math.min(await getHistoryCacheLimit(), HISTORY_INDEX_SCAN_CAP);
    historyIndex = await HistoryRecordRepository.getAllForIndex(indexLimit);
    historyFuse = new Fuse(historyIndex, {
        keys: [
            { name: 'title', weight: 0.6 },
            { name: 'url', weight: 0.3 },
            { name: 'pageDescription', weight: 0.1 },
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
    });
    lastHistoryIndexUpdate = now;
}

function addIfBetter(
    target: Map<string, HistorySearchResult>,
    result: HistorySearchResult
): void {
    const key = historyKey(result.history);
    const existing = target.get(key);
    if (!existing) {
        target.set(key, result);
        return;
    }

    if (result.score > existing.score) {
        target.set(key, result);
        return;
    }

    if (result.score === existing.score && result.history.lastVisitAt > existing.history.lastVisitAt) {
        target.set(key, result);
    }
}

function evaluateTermsMatch(record: HistoryRecord, terms: string[], termsLower: string[]): {
    score: number;
    matchType: MatchType;
    matchedField: string;
} | null {
    if (terms.length === 0) {
        return null;
    }

    const title = record.title || '';
    const titleLower = title.toLowerCase();
    const urlLower = (record.url || '').toLowerCase();
    const descLower = (record.pageDescription || '').toLowerCase();

    let usedPinyin = false;
    let matchedField = 'title';
    let accumulatedScore = 0;

    for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        const termLower = termsLower[i];

        if (!termLower) {
            continue;
        }

        if (titleLower.includes(termLower)) {
            accumulatedScore += 95;
            matchedField = 'title';
            continue;
        }

        if (urlLower.includes(termLower)) {
            accumulatedScore += 90;
            matchedField = 'url';
            continue;
        }

        if (descLower.includes(termLower)) {
            accumulatedScore += 84;
            matchedField = 'description';
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
        accumulatedScore += 74;
    }

    const avgScore = accumulatedScore / Math.max(1, terms.length);
    const boost = recencyBoost(record.lastVisitAt);
    return {
        score: avgScore + boost,
        matchType: usedPinyin ? 'pinyin' : 'exact',
        matchedField,
    };
}

function toHistoryRecord(item: chrome.history.HistoryItem): HistoryRecord | null {
    if (!item.url || !isTrackableUrl(item.url)) {
        return null;
    }
    const lastVisitAt = item.lastVisitTime || Date.now();
    return {
        id: item.id || item.url,
        title: item.title || item.url || 'No Title',
        url: item.url,
        pageDescription: undefined,
        faviconUrl: buildFaviconUrl(item.url),
        sourceType: 'navigate',
        searchQuery: undefined,
        bookmarkId: undefined,
        visitCount: item.visitCount || 1,
        totalTimeSpent: 0,
        firstVisitAt: lastVisitAt,
        lastVisitAt,
    };
}

async function upsertChromeItems(items: chrome.history.HistoryItem[]): Promise<number> {
    let processed = 0;

    for (const item of items) {
        if (!item.url || !isTrackableUrl(item.url)) {
            continue;
        }

        await HistoryRecordRepository.upsertFromBrowser({
            title: item.title || item.url || 'No Title',
            url: item.url,
            faviconUrl: buildFaviconUrl(item.url),
            visitCount: item.visitCount || 1,
            firstVisitAt: item.lastVisitTime || Date.now(),
            lastVisitAt: item.lastVisitTime || Date.now(),
        });
        processed += 1;
    }

    if (processed > 0) {
        invalidateHistorySearchIndex();
    }
    return processed;
}

export async function enforceHistoryCacheLimit(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - lastHistoryCleanupAt < HISTORY_LIMIT_CLEANUP_INTERVAL) {
        return;
    }
    lastHistoryCleanupAt = now;

    const limit = await getHistoryCacheLimit();
    const count = await HistoryRecordRepository.count();
    if (count <= limit) {
        return;
    }

    const removed = await HistoryRecordRepository.cleanup(limit);
    if (removed > 0) {
        logger.info(`History cache capped to ${limit} (trimmed ${removed} rows)`);
        invalidateHistorySearchIndex();
    }
}

export async function warmupHistoryCache(): Promise<void> {
    try {
        const currentCount = await HistoryRecordRepository.count();
        if (currentCount > 0) {
            return;
        }

        const limit = Math.min(await getHistoryCacheLimit(), 800);
        const recentItems = await chrome.history.search({
            text: '',
            maxResults: limit,
            startTime: 0,
        });

        await upsertChromeItems(recentItems);
        await enforceHistoryCacheLimit(true);
    } catch (error) {
        logger.warn('History warmup skipped:', error);
    }
}

export async function recordHistoryVisit(item: chrome.history.HistoryItem): Promise<void> {
    if (!item.url || !isTrackableUrl(item.url)) {
        return;
    }

    await HistoryRecordRepository.upsertFromBrowser({
        title: item.title || item.url || 'No Title',
        url: item.url,
        faviconUrl: buildFaviconUrl(item.url),
        visitCount: item.visitCount || 1,
        firstVisitAt: item.lastVisitTime || Date.now(),
        lastVisitAt: item.lastVisitTime || Date.now(),
    });

    invalidateHistorySearchIndex();
    await enforceHistoryCacheLimit();
}

export async function removeHistoryRecords(removed: chrome.history.RemovedResult): Promise<void> {
    if (removed.allHistory) {
        const changes = await HistoryRecordRepository.clear();
        if (changes > 0) {
            invalidateHistorySearchIndex();
        }
        return;
    }

    const urls = (removed.urls || []).filter(isTrackableUrl);
    if (urls.length === 0) {
        return;
    }

    const changes = await HistoryRecordRepository.deleteByUrls(urls);
    if (changes > 0) {
        invalidateHistorySearchIndex();
    }
}

function sortHistoryResults(results: HistorySearchResult[]): HistorySearchResult[] {
    return results.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return b.history.lastVisitAt - a.history.lastVisitAt;
    });
}

export async function searchHistory(rawQuery: string, limit = 100): Promise<HistorySearchResult[]> {
    const query = extractHistoryQuery(rawQuery);
    const safeLimit = Math.max(1, Math.min(limit || 100, 200));

    await refreshHistoryIndex();

    const merged = new Map<string, HistorySearchResult>();

    if (!query) {
        if (historyIndex.length === 0) {
            const recentItems = await chrome.history.search({
                text: '',
                maxResults: Math.max(safeLimit * 2, HISTORY_MIN_CHROME_RESULTS),
                startTime: 0,
            });
            await upsertChromeItems(recentItems);
            await enforceHistoryCacheLimit();
            await refreshHistoryIndex(true);
        }

        for (const record of historyIndex) {
            addIfBetter(merged, toHistorySearchResult(record, 60 + recencyBoost(record.lastVisitAt), 'exact', 'title'));
        }

        return sortHistoryResults(Array.from(merged.values())).slice(0, safeLimit);
    }

    const terms = splitQueryTerms(query);
    const termsLower = terms.map(term => term.toLowerCase());

    for (const record of historyIndex) {
        const matched = evaluateTermsMatch(record, terms, termsLower);
        if (!matched) {
            continue;
        }
        addIfBetter(merged, toHistorySearchResult(record, matched.score, matched.matchType, matched.matchedField));
    }

    if (historyFuse && merged.size < safeLimit && query.length >= 2) {
        const fuzzyResults = historyFuse.search(query, { limit: Math.max(safeLimit * 6, 120) });
        for (const hit of fuzzyResults) {
            const fuzzyScore = 48 * (1 - (hit.score || 0)) + recencyBoost(hit.item.lastVisitAt);
            addIfBetter(merged, toHistorySearchResult(hit.item, fuzzyScore, 'fuzzy', 'fuzzy'));
        }
    }

    const shouldUseChromeFallback =
        merged.size < safeLimit &&
        Date.now() - lastChromeFallbackAt >= CHROME_FALLBACK_INTERVAL;

    if (shouldUseChromeFallback) {
        lastChromeFallbackAt = Date.now();
        const chromeMatches = await chrome.history.search({
            text: query,
            maxResults: Math.max(safeLimit * 3, HISTORY_MIN_CHROME_RESULTS),
            startTime: 0,
        });

        for (const item of chromeMatches) {
            const record = toHistoryRecord(item);
            if (!record) {
                continue;
            }

            const matched = evaluateTermsMatch(record, terms, termsLower);
            if (matched) {
                addIfBetter(merged, toHistorySearchResult(record, matched.score, matched.matchType, matched.matchedField));
            } else {
                const score = 70 + recencyBoost(record.lastVisitAt);
                addIfBetter(merged, toHistorySearchResult(record, score, 'exact', 'title'));
            }
        }

        await upsertChromeItems(chromeMatches);
        await enforceHistoryCacheLimit();
    }

    return sortHistoryResults(Array.from(merged.values())).slice(0, safeLimit);
}

