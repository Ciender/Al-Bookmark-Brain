/**
 * AI Bookmark Brain - useSearch Hook
 * Handles search state and messaging with background script
 * Supports both bookmark search and history search (! prefix)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { MESSAGE_TYPES, UI } from '../../../shared/constants';
import type { SearchResult, Category, SearchOptions, HistorySearchResult } from '../../../shared/types';
import { logger } from '../../../shared/logger';

// History search prefix: ! or ！ (Chinese)
const HISTORY_PREFIX = /^[!！]/;

export type SearchMode = 'bookmark' | 'history';

export interface UseSearchOptions {
    debounceMs?: number;
    defaultLimit?: number;
}

export interface UseSearchReturn {
    query: string;
    setQuery: (query: string) => void;
    results: SearchResult[];
    setResults: React.Dispatch<React.SetStateAction<SearchResult[]>>;
    historyResults: HistorySearchResult[];
    searchMode: SearchMode;
    isLoading: boolean;
    selectedCategoryIds: number[];
    toggleCategory: (categoryId: number) => void;
    refresh: () => void;
    recordSelection: (bookmarkId: number) => void;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
    const {
        debounceMs = UI.SEARCH_DEBOUNCE_MS,
        defaultLimit = UI.VISIBLE_RESULTS
    } = options;

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [historyResults, setHistoryResults] = useState<HistorySearchResult[]>([]);
    const [searchMode, setSearchMode] = useState<SearchMode>('bookmark');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

    const debounceTimer = useRef<number | null>(null);

    // Perform search when query or filters change
    useEffect(() => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }

        debounceTimer.current = window.setTimeout(() => {
            performSearch();
        }, debounceMs);

        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }
        };
    }, [query, selectedCategoryIds]);

    const performSearch = useCallback(async () => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            setResults([]);
            setHistoryResults([]);
            return;
        }

        // Detect history search mode (! or ！ prefix)
        const isHistory = HISTORY_PREFIX.test(trimmedQuery);
        setSearchMode(isHistory ? 'history' : 'bookmark');

        setIsLoading(true);
        try {
            if (isHistory) {
                // History search mode - send full query with ! prefix, backend handles extraction
                // Use larger limit (100) for history search, independent of bookmark search limit
                const response = await sendMessage<{ results: HistorySearchResult[] }>(
                    MESSAGE_TYPES.SEARCH_HISTORY,
                    { query: trimmedQuery, limit: 100 }
                );
                setHistoryResults(response?.results || []);
                setResults([]); // Clear bookmark results
            } else {
                // Bookmark search mode
                const searchOptions: SearchOptions = {
                    query: trimmedQuery,
                    limit: defaultLimit,
                    filters: selectedCategoryIds.length > 0
                        ? { categoryId: selectedCategoryIds[0] }
                        : undefined
                };

                const response = await sendMessage<{ results: SearchResult[] }>(
                    MESSAGE_TYPES.SEARCH_BOOKMARKS,
                    { options: searchOptions }
                );
                setResults(response?.results || []);
                setHistoryResults([]); // Clear history results
            }
        } catch (error) {
            console.error('Search failed:', error);
            setResults([]);
            setHistoryResults([]);
        } finally {
            setIsLoading(false);
        }
    }, [query, selectedCategoryIds, defaultLimit]);

    const toggleCategory = useCallback((categoryId: number) => {
        setSelectedCategoryIds(prev => {
            if (prev.includes(categoryId)) {
                return prev.filter(id => id !== categoryId);
            } else {
                return [...prev, categoryId];
            }
        });
    }, []);

    const refresh = useCallback(() => {
        performSearch();
    }, [performSearch]);

    // Record user selection for frecency ranking
    const recordSelection = useCallback((bookmarkId: number) => {
        if (!query.trim()) return;
        sendMessage(MESSAGE_TYPES.FRECENCY_RECORD, {
            query: query.trim(),
            bookmarkId
        }).catch((error) => {
            logger.debug('Failed to record frecency selection:', error);
        });
    }, [query]);

    return {
        query,
        setQuery,
        results,
        setResults,
        historyResults,
        searchMode,
        isLoading,
        selectedCategoryIds,
        toggleCategory,
        refresh,
        recordSelection
    };
}

// Helper function to send messages to background script
function sendMessage<T>(type: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response as T);
            }
        });
    });
}
