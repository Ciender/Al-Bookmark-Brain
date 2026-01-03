/**
 * AI Bookmark Brain - Frecency Service
 * Uses the frecency library for personalized search ranking
 * Based on Slack's Quick Switcher design
 * @see https://slack.engineering/a-faster-smarter-quick-switcher-77cbc193cb60
 */

import Frecency from 'frecency';
import type { SearchResult } from '../../shared/types';
import { logger } from '../../shared/logger';

// Singleton instance
let frecencyInstance: Frecency | null = null;

/**
 * Get or create the frecency instance
 */
function getFrecency(): Frecency {
    if (!frecencyInstance) {
        frecencyInstance = new Frecency({
            key: 'ai-bookmark-brain',
            idAttribute: 'id',
            timeStampsLimit: 20,        // Save last 20 selection timestamps per query
            recentSelectionsLimit: 200, // Track up to 200 different bookmarks
        });
        logger.debug('Frecency instance initialized');
    }
    return frecencyInstance;
}

/**
 * Record a user selection for frecency ranking
 * @param query - The search query
 * @param bookmarkId - The selected bookmark ID
 */
export function recordSelection(query: string, bookmarkId: number): void {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return;

    try {
        getFrecency().save({
            searchQuery: normalizedQuery,
            selectedId: bookmarkId,
        });
        logger.debug(`Frecency: recorded selection for "${normalizedQuery}" -> ${bookmarkId}`);
    } catch (error) {
        logger.error('Failed to record frecency selection:', error);
    }
}

/**
 * Sort search results by frecency (user selection history)
 * This preserves the original search scoring for items without frecency data
 * @param query - The search query
 * @param results - Search results to sort
 * @returns Sorted results with frecency applied
 */
export function sortByFrecency(query: string, results: SearchResult[]): SearchResult[] {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery || results.length === 0) {
        return results;
    }

    try {
        const frecency = getFrecency();

        // Extract bookmarks for frecency sorting
        const bookmarks = results.map(r => ({
            id: r.bookmark.id,
            originalIndex: results.indexOf(r),
        }));

        // Apply frecency sorting
        const sortedBookmarks = frecency.sort({
            searchQuery: normalizedQuery,
            results: bookmarks,
            keepScores: true,
        });

        // Rebuild results array in new order
        const sortedResults = sortedBookmarks.map((item: { id: number; originalIndex: number }) => {
            return results[item.originalIndex];
        });

        logger.debug(`Frecency: sorted ${results.length} results for "${normalizedQuery}"`);
        return sortedResults;
    } catch (error) {
        logger.error('Failed to apply frecency sorting:', error);
        return results; // Fallback to original order
    }
}

export default {
    recordSelection,
    sortByFrecency,
};
