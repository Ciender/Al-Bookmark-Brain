/**
 * AI Bookmark Brain - Bookmark Sync Service v2
 * Synchronizes Chrome bookmarks with local database using new schema
 */

import { logger } from '../../shared/logger';
import { syncStatus } from '../../lib/storage';
import {
    BookmarkRepository,
    AISummaryRepository,
    SyncLogRepository
} from '../database.service';
import { fetchFromCurrentTab } from './content-fetcher.service';
import { summarizeBookmarkById } from './summarization-queue';
import type { Bookmark, BookmarkStatus } from '../../shared/types';

/**
 * Hash content for deduplication
 */
async function hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get favicon URL for a given page URL
 */
function getFaviconUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    } catch {
        return '';
    }
}

/**
 * Extract folder path from Chrome bookmark tree
 */
function getFolderPath(node: chrome.bookmarks.BookmarkTreeNode, path: string[] = []): string {
    return path.join(' > ');
}

/**
 * Flatten Chrome bookmark tree to array of bookmarks
 */
function flattenBookmarks(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    path: string[] = []
): chrome.bookmarks.BookmarkTreeNode[] {
    const result: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (const node of nodes) {
        if (node.url) {
            // It's a bookmark
            (node as any)._folderPath = path.join(' > ');
            result.push(node);
        } else if (node.children) {
            // It's a folder
            const newPath = node.title ? [...path, node.title] : path;
            result.push(...flattenBookmarks(node.children, newPath));
        }
    }

    return result;
}

/**
 * Sync a single bookmark to database
 * Handles imported database where chrome_bookmark_id may differ
 */
async function syncBookmark(
    chromeBookmark: chrome.bookmarks.BookmarkTreeNode,
    folderPath: string = ''
): Promise<'added' | 'updated' | 'skipped'> {
    if (!chromeBookmark.url) return 'skipped';

    // First, check by Chrome ID (normal case)
    let existing = await BookmarkRepository.findByChromeId(chromeBookmark.id);

    // If not found by Chrome ID, check by URL (imported database case)
    if (!existing && chromeBookmark.url) {
        existing = await BookmarkRepository.findByUrl(chromeBookmark.url);

        if (existing) {
            // URL exists but chrome ID is different - update the chrome ID
            logger.info('Bookmark found by URL (imported DB), updating chrome ID:', chromeBookmark.title);
            await BookmarkRepository.updateChromeId(existing.id, chromeBookmark.id);

            // Also update other fields if changed
            if (existing.originalTitle !== chromeBookmark.title) {
                await BookmarkRepository.update(chromeBookmark.id, {
                    originalTitle: chromeBookmark.title || '',
                    url: chromeBookmark.url,
                    chromeFolderPath: folderPath,
                    faviconUrl: getFaviconUrl(chromeBookmark.url),
                });
                return 'updated';
            }
            return 'skipped';
        }
    }

    if (existing) {
        // Update if title or URL changed
        if (existing.originalTitle !== chromeBookmark.title || existing.url !== chromeBookmark.url) {
            await BookmarkRepository.update(chromeBookmark.id, {
                originalTitle: chromeBookmark.title || '',
                url: chromeBookmark.url,
                chromeFolderPath: folderPath,
                faviconUrl: getFaviconUrl(chromeBookmark.url),
            });
            return 'updated';
        }
        return 'skipped';
    }

    // Create new bookmark
    const now = Date.now();
    await BookmarkRepository.create({
        chromeBookmarkId: chromeBookmark.id,
        chromeFolderPath: folderPath,
        url: chromeBookmark.url,
        originalTitle: chromeBookmark.title || '',
        faviconUrl: getFaviconUrl(chromeBookmark.url),
        status: 'pending' as BookmarkStatus,
        retryCount: 0,
        isArchived: false,
        isPinned: false,
        visitCount: 0,
        createdAt: chromeBookmark.dateAdded || now,
        lastUpdated: now,
    });

    return 'added';
}

/**
 * Perform full synchronization
 */
export async function fullSync(): Promise<{ added: number; updated: number; errors: number }> {
    const result = { added: 0, updated: 0, errors: 0 };

    try {
        await syncStatus.setValue({
            lastSync: Date.now(),
            inProgress: true,
            totalBookmarks: 0,
            summarizedCount: 0,
            pendingCount: 0,
            errorCount: 0,
        });

        logger.info('Starting FULL_SYNC...');

        // Get all Chrome bookmarks
        const tree = await chrome.bookmarks.getTree();
        const bookmarks = flattenBookmarks(tree);

        logger.info(`Found ${bookmarks.length} bookmarks in Chrome`);

        // Sync each bookmark
        for (const bookmark of bookmarks) {
            try {
                const folderPath = (bookmark as any)._folderPath || '';
                const status = await syncBookmark(bookmark, folderPath);

                if (status === 'added') result.added++;
                else if (status === 'updated') result.updated++;

                // Log sync action
                await SyncLogRepository.create({
                    action: status === 'added' ? 'add' : 'update',
                    bookmarkId: undefined,
                    status: 'success',
                    message: bookmark.title,
                    timestamp: Date.now(),
                });
            } catch (error) {
                result.errors++;
                logger.error(`Failed to sync bookmark: ${bookmark.title}`, error);

                await SyncLogRepository.create({
                    action: 'add',
                    bookmarkId: undefined,
                    status: 'failed',
                    message: String(error),
                    timestamp: Date.now(),
                });
            }
        }

        // Update sync status with counts
        const totalBookmarks = await BookmarkRepository.count();
        const summarizedCount = await AISummaryRepository.count();
        const pendingCount = await BookmarkRepository.countPending();

        await syncStatus.setValue({
            lastSync: Date.now(),
            inProgress: false,
            totalBookmarks,
            summarizedCount,
            pendingCount,
            errorCount: result.errors,
        });

        logger.info('FULL_SYNC completed:', result);
        return result;
    } catch (error) {
        logger.error('FULL_SYNC failed:', error);

        await syncStatus.setValue({
            lastSync: Date.now(),
            inProgress: false,
            totalBookmarks: 0,
            summarizedCount: 0,
            pendingCount: 0,
            errorCount: result.errors + 1,
        });

        throw error;
    }
}

/**
 * Handle bookmark created event
 */
async function onBookmarkCreated(
    id: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode
): Promise<void> {
    logger.info('Bookmark created event:', bookmark.title);

    if (bookmark.url) {
        try {
            // Get parent folder path
            let folderPath = '';
            if (bookmark.parentId) {
                const parents = await chrome.bookmarks.get(bookmark.parentId);
                if (parents.length > 0 && parents[0].title) {
                    folderPath = parents[0].title;
                }
            }

            // Sync the bookmark first
            await syncBookmark(bookmark, folderPath);

            // Try to fetch content from current tab if URL matches
            try {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab?.id && activeTab.url === bookmark.url) {
                    logger.info('Fetching content from current tab for new bookmark');
                    const content = await fetchFromCurrentTab(activeTab.id);

                    if (content && content.length > 50) {
                        // Get the bookmark we just created and update its content
                        const dbBookmark = await BookmarkRepository.findByChromeId(bookmark.id);
                        if (dbBookmark) {
                            const hash = await hashContent(content);
                            await BookmarkRepository.updateContent(dbBookmark.id, content, hash);
                            logger.info('Content saved for new bookmark:', bookmark.title);

                            // Auto-trigger AI summarization in background
                            logger.info('Auto-triggering AI summarization for new bookmark');
                            summarizeBookmarkById(dbBookmark.id).catch(error => {
                                logger.warn('Auto-summarization failed:', error);
                            });
                        }
                    } else {
                        // No content from current tab, still try to summarize with title/URL only
                        const dbBookmark = await BookmarkRepository.findByChromeId(bookmark.id);
                        if (dbBookmark) {
                            logger.info('Auto-triggering AI summarization (no content) for new bookmark');
                            summarizeBookmarkById(dbBookmark.id).catch(error => {
                                logger.warn('Auto-summarization failed:', error);
                            });
                        }
                    }
                }
            } catch (contentError) {
                // Content fetching is optional, don't fail the sync
                logger.warn('Failed to fetch content from current tab:', contentError);

                // Still try to summarize even if content fetch failed
                const dbBookmark = await BookmarkRepository.findByChromeId(bookmark.id);
                if (dbBookmark) {
                    logger.info('Auto-triggering AI summarization (fallback) for new bookmark');
                    summarizeBookmarkById(dbBookmark.id).catch(error => {
                        logger.warn('Auto-summarization failed:', error);
                    });
                }
            }
        } catch (error) {
            logger.error('Failed to sync new bookmark:', error);
        }
    }
}

/**
 * Handle bookmark removed event
 */
async function onBookmarkRemoved(
    id: string,
    removeInfo: { parentId: string; index: number; node?: chrome.bookmarks.BookmarkTreeNode }
): Promise<void> {
    logger.info('Bookmark removed event:', id);

    try {
        await BookmarkRepository.delete(id);

        await SyncLogRepository.create({
            action: 'delete',
            bookmarkId: undefined,
            status: 'success',
            message: `Deleted bookmark ${id}`,
            timestamp: Date.now(),
        });
    } catch (error) {
        logger.error('Failed to delete bookmark:', error);
    }
}

/**
 * Handle bookmark changed event
 */
async function onBookmarkChanged(
    id: string,
    changeInfo: { title?: string; url?: string }
): Promise<void> {
    logger.info('Bookmark changed event:', changeInfo.title);

    try {
        await BookmarkRepository.update(id, {
            originalTitle: changeInfo.title,
            url: changeInfo.url,
        });
    } catch (error) {
        logger.error('Failed to update bookmark:', error);
    }
}

/**
 * Set up bookmark event listeners
 */
export function setupBookmarkListeners(): void {
    chrome.bookmarks.onCreated.addListener(onBookmarkCreated);
    chrome.bookmarks.onRemoved.addListener(onBookmarkRemoved);
    chrome.bookmarks.onChanged.addListener(onBookmarkChanged);

    logger.info('Bookmark event listeners initialized');
}

export default {
    fullSync,
    setupBookmarkListeners,
};
