/**
 * AI Bookmark Brain - Summarization Queue v3
 * Background AI summarization using alarm-based chunked processing
 * 
 * Key changes from v2:
 * - Uses chrome.alarms instead of while(true) loop
 * - Processes small batches (2 bookmarks) per alarm trigger
 * - State persisted to chrome.storage.session for Service Worker restart recovery
 */

import { logger } from '../../shared/logger';
import { MESSAGE_TYPES } from '../../shared/constants';
import { syncStatus } from '../../lib/storage';
import {
    BookmarkRepository,
    AISummaryRepository,
    TagRepository,
    SyncLogRepository
} from '../database.service';
import { getActiveAIService } from '../ai/factory';
import { fetchPageContentSmart } from './content-fetcher.service';
import { needsRefetch, detectGarbledContent } from '../../lib/garbled-content-detector';
import type { Bookmark, SummaryResult } from '../../shared/types';

// =====================================================
// Constants
// =====================================================

const SUMMARIZE_ALARM = 'summarize-next';
const CHUNK_SIZE = 2; // Process 2 bookmarks per alarm
const ALARM_DELAY_MINUTES = 0.083; // ~5 seconds between batches

// =====================================================
// Queue State Management (persisted to session storage)
// =====================================================

/**
 * Check if summarization queue is running
 */
async function isQueueRunning(): Promise<boolean> {
    const { summarizing } = await chrome.storage.session.get('summarizing');
    return !!summarizing;
}

/**
 * Start the summarization queue
 */
export async function startSummarizationQueue(): Promise<void> {
    logger.info('Starting summarization queue (alarm-based)');

    // Mark queue as running
    await chrome.storage.session.set({ summarizing: true });

    // Process first batch immediately
    await processNextBatch();
}

/**
 * Stop the summarization queue
 */
export async function stopSummarizationQueue(): Promise<void> {
    logger.info('Stopping summarization queue');

    // Mark queue as stopped
    await chrome.storage.session.set({ summarizing: false });

    // Clear any pending alarm
    await chrome.alarms.clear(SUMMARIZE_ALARM);
}

/**
 * Process the next batch of bookmarks
 * Called by alarm handler in background.ts
 */
export async function processNextBatch(): Promise<void> {
    // Check if queue should still be running
    const running = await isQueueRunning();
    if (!running) {
        logger.debug('Summarization queue not running, skipping batch');
        return;
    }

    try {
        // Get pending bookmarks
        const pending = await BookmarkRepository.findPending(CHUNK_SIZE);

        if (pending.length === 0) {
            // Queue complete
            logger.info('Summarization queue completed - no more pending bookmarks');
            await chrome.storage.session.set({ summarizing: false });
            await chrome.alarms.clear(SUMMARIZE_ALARM);
            return;
        }

        logger.info(`Processing batch of ${pending.length} bookmarks`);

        // Process each bookmark in this batch
        for (const bookmark of pending) {
            await summarizeBookmark(bookmark);

            // Update sync status counts
            const summarizedCount = await AISummaryRepository.count();
            const currentStatus = await syncStatus.getValue();
            await syncStatus.setValue({
                ...currentStatus,
                summarizedCount,
                pendingCount: await BookmarkRepository.countPending(),
            });
        }

        // Check if there are more to process
        const remainingCount = await BookmarkRepository.countPending();
        if (remainingCount > 0) {
            // Schedule next batch
            logger.debug(`${remainingCount} bookmarks remaining, scheduling next batch`);
            await chrome.alarms.create(SUMMARIZE_ALARM, { delayInMinutes: ALARM_DELAY_MINUTES });
        } else {
            // All done
            logger.info('All bookmarks summarized');
            await chrome.storage.session.set({ summarizing: false });
        }
    } catch (error) {
        logger.error('Batch processing error:', error);
        // Continue with next batch despite errors
        await chrome.alarms.create(SUMMARIZE_ALARM, { delayInMinutes: ALARM_DELAY_MINUTES });
    }
}

// =====================================================
// Bookmark Summarization
// =====================================================

/**
 * Fetch page content from URL using smart strategy
 */
async function fetchPageContent(url: string): Promise<string | null> {
    return fetchPageContentSmart(url);
}

/**
 * Summarize a single bookmark and save tags
 */
async function summarizeBookmark(bookmark: Bookmark): Promise<boolean> {
    try {
        // Update status to analyzing
        await BookmarkRepository.updateStatus(bookmark.id, 'analyzing');

        // Get AI service
        const aiService = await getActiveAIService();
        if (!aiService) {
            throw new Error('No AI service configured');
        }

        // Fetch page content if not already stored
        let content = bookmark.pageContent;
        if (!content) {
            content = await fetchPageContent(bookmark.url);
            if (content) {
                const hash = await hashContent(content);
                await BookmarkRepository.updateContent(bookmark.id, content, hash);
            }
        }

        // Generate summary and tags
        const result: SummaryResult = await aiService.summarize({
            title: bookmark.originalTitle,
            url: bookmark.url,
            content: content || undefined,
        });

        // Save AI summary
        await AISummaryRepository.create({
            bookmarkId: bookmark.id,
            aiProvider: aiService.provider,
            summaryText: result.summaryZh,
            summaryOriginal: result.summaryOriginal,
            confidenceScore: result.confidence,
            language: result.language,
            createdAt: Date.now(),
        });

        // Save Chinese tags
        const totalTagCount = (result.tagsZh?.length || 0) + (result.tagsOriginal?.length || 0);
        if (result.tagsZh && result.tagsZh.length > 0) {
            for (const tagName of result.tagsZh) {
                const tagId = await TagRepository.findOrCreate(tagName, 'ai');
                await TagRepository.addToBookmark(bookmark.id, tagId, 'ai', result.confidence);
            }
        }

        // Save original language tags
        if (result.tagsOriginal && result.tagsOriginal.length > 0) {
            for (const tagName of result.tagsOriginal) {
                if (!result.tagsZh?.includes(tagName)) {
                    const tagId = await TagRepository.findOrCreate(tagName, 'ai');
                    await TagRepository.addToBookmark(bookmark.id, tagId, 'ai', result.confidence);
                }
            }
        }

        // Update bookmark status to completed
        await BookmarkRepository.updateStatus(bookmark.id, 'completed');

        // Log success
        await SyncLogRepository.create({
            action: 'analyze',
            bookmarkId: bookmark.id,
            status: 'success',
            message: `${totalTagCount} tags generated (${result.language || 'unknown'} content)`,
            timestamp: Date.now(),
        });

        // Notify UI that bookmark data has been updated
        try {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.UI_BOOKMARK_UPDATED,
                data: { bookmarkId: bookmark.id }
            }).catch(() => {
                // Ignore errors if no listeners
            });
        } catch {
            // Ignore message sending errors
        }

        logger.info('Summarized:', bookmark.originalTitle);
        return true;
    } catch (error) {
        logger.error('Summarization failed for:', bookmark.originalTitle, error);

        // Increment retry count and update status
        const newRetryCount = (bookmark.retryCount || 0) + 1;
        await BookmarkRepository.updateStatus(
            bookmark.id,
            newRetryCount >= 3 ? 'failed' : 'pending',
            String(error)
        );

        await SyncLogRepository.create({
            action: 'analyze',
            bookmarkId: bookmark.id,
            status: 'failed',
            message: String(error),
            timestamp: Date.now(),
        });

        return false;
    }
}

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

// =====================================================
// Manual Summarization (unchanged)
// =====================================================

/**
 * Manually summarize a specific page (from context menu)
 */
export async function summarizePage(
    title: string,
    url: string,
    content?: string
): Promise<boolean> {
    try {
        // Check if bookmark exists
        let bookmark = await BookmarkRepository.findByChromeId(url);

        if (!bookmark) {
            // Create temporary bookmark entry
            const id = await BookmarkRepository.create({
                url,
                originalTitle: title,
                status: 'pending',
                retryCount: 0,
                isArchived: false,
                isPinned: false,
                visitCount: 0,
                createdAt: Date.now(),
                lastUpdated: Date.now(),
            });

            bookmark = await BookmarkRepository.findById(id);
            if (!bookmark) {
                throw new Error('Failed to create bookmark');
            }
        }

        // Store content if provided
        if (content) {
            const hash = await hashContent(content);
            await BookmarkRepository.updateContent(bookmark.id, content, hash);
            bookmark.pageContent = content;
        }

        return await summarizeBookmark(bookmark);
    } catch (error) {
        logger.error('Manual summarization failed:', error);
        return false;
    }
}

/**
 * Summarize a specific bookmark by its database ID
 */
export async function summarizeBookmarkById(bookmarkId: number): Promise<boolean> {
    try {
        const bookmark = await BookmarkRepository.findById(bookmarkId);
        if (!bookmark) {
            logger.warn('Bookmark not found for summarization:', bookmarkId);
            return false;
        }

        if (bookmark.status === 'completed') {
            logger.info('Bookmark already summarized:', bookmark.originalTitle);
            return true;
        }

        return await summarizeBookmark(bookmark);
    } catch (error) {
        logger.error('Summarize by ID failed:', error);
        return false;
    }
}

// =====================================================
// Legacy Export (for backward compatibility)
// =====================================================

/**
 * @deprecated Use startSummarizationQueue instead
 */
export async function processQueue(): Promise<void> {
    await startSummarizationQueue();
}

// =====================================================
// Garbled Content Refetch
// =====================================================

/**
 * 重新抓取结果类型
 */
export interface RefetchResult {
    totalScanned: number;
    garbledFound: number;
    emptyFound: number;
    refetched: number;
    failed: number;
    errors: string[];
}

/**
 * 进度消息类型
 */
export interface RefetchProgress {
    phase: 'scanning' | 'processing' | 'complete';
    total: number;
    remaining: number;
    success: number;
    failed: number;
    skippedDead: number;
    currentTitle?: string;
}

/**
 * 广播进度到所有监听者 (Options页面)
 */
function broadcastProgress(progress: RefetchProgress): void {
    try {
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.REFETCH_GARBLED_PROGRESS,
            data: progress,
        }).catch(() => {
            // Ignore - no listeners
        });
    } catch {
        // Ignore messaging errors
    }
}

/**
 * 重新抓取乱码/空内容的书签
 * 扫描所有书签，检测需要重新抓取的内容
 */
export async function refetchGarbledContent(): Promise<RefetchResult> {
    logger.info('Starting garbled content refetch...');

    const result: RefetchResult = {
        totalScanned: 0,
        garbledFound: 0,
        emptyFound: 0,
        refetched: 0,
        failed: 0,
        errors: [],
    };

    try {
        // 获取所有书签及其内容
        const allBookmarks = await BookmarkRepository.getAllForIndex();
        result.totalScanned = allBookmarks.length;

        logger.info(`Scanning ${allBookmarks.length} bookmarks for garbled content...`);

        // 找出需要重新抓取的书签
        const needsRefetchList: Array<{ bookmark: typeof allBookmarks[0]; reason: string }> = [];
        let skippedDead = 0;

        for (const bookmark of allBookmarks) {
            // Skip websites already marked as dead
            if (bookmark.fetchFailedAt) {
                skippedDead++;
                continue;
            }

            const content = bookmark.pageContent;

            if (!content || content.trim().length === 0) {
                result.emptyFound++;
                needsRefetchList.push({ bookmark, reason: '内容为空' });
            } else {
                const detection = detectGarbledContent(content);
                if (detection.isGarbled) {
                    result.garbledFound++;
                    needsRefetchList.push({
                        bookmark,
                        reason: detection.reason || '检测为乱码',
                    });
                }
            }
        }

        if (skippedDead > 0) {
            logger.info(`Skipped ${skippedDead} dead websites`);
        }
        logger.info(`Found ${needsRefetchList.length} bookmarks needing refetch (${result.emptyFound} empty, ${result.garbledFound} garbled)`);

        // 广播扫描完成，显示需要处理的总数
        broadcastProgress({
            phase: 'scanning',
            total: needsRefetchList.length,
            remaining: needsRefetchList.length,
            success: 0,
            failed: 0,
            skippedDead,
        });

        // 逐个重新抓取
        let processed = 0;
        for (const { bookmark, reason } of needsRefetchList) {
            try {
                logger.debug(`Refetching: ${bookmark.originalTitle} (${reason})`);

                // 广播当前处理的书签
                broadcastProgress({
                    phase: 'processing',
                    total: needsRefetchList.length,
                    remaining: needsRefetchList.length - processed,
                    success: result.refetched,
                    failed: result.failed,
                    skippedDead,
                    currentTitle: bookmark.originalTitle,
                });

                const newContent = await fetchPageContentSmart(bookmark.url);

                if (newContent && newContent.length > 50) {
                    // 检查新内容是否仍然是乱码
                    const newDetection = detectGarbledContent(newContent);
                    if (newDetection.isGarbled) {
                        logger.warn(`Refetched content still garbled: ${bookmark.url}`);
                        result.failed++;
                        result.errors.push(`${bookmark.originalTitle}: 重新抓取后仍为乱码`);
                        processed++;
                        continue;
                    }

                    // 额外安全检查：如果原内容不为空，确保新内容质量更好
                    const oldContent = bookmark.pageContent;
                    if (oldContent && oldContent.length > newContent.length * 2) {
                        // 新内容比旧内容短很多，可能是抓取不完整
                        logger.warn(`New content much shorter than old, skipping: ${bookmark.url}`);
                        result.failed++;
                        result.errors.push(`${bookmark.originalTitle}: 新内容太短，跳过`);
                        processed++;
                        continue;
                    }

                    // 更新数据库
                    const hash = await hashContent(newContent);
                    logger.info(`Updating content for bookmark ${bookmark.id}, old length: ${oldContent?.length || 0}, new length: ${newContent.length}`);
                    await BookmarkRepository.updateContent(bookmark.id, newContent, hash);

                    result.refetched++;
                    logger.info(`Successfully refetched: ${bookmark.originalTitle}`);

                    // 记录到同步日志
                    await SyncLogRepository.create({
                        action: 'fetch_content',
                        bookmarkId: bookmark.id,
                        status: 'success',
                        message: `重新抓取成功 (原因: ${reason})`,
                        timestamp: Date.now(),
                    });
                } else {
                    // Fetch returned null or very short content - mark as dead website
                    result.failed++;
                    const failReason = `无法获取内容 (${newContent?.length || 0} bytes)`;
                    result.errors.push(`${bookmark.originalTitle}: ${failReason}`);
                    logger.warn(`Failed to refetch (content too short or null): ${bookmark.url}, length: ${newContent?.length || 0}`);

                    // Mark as dead website (HTTP fetch and tab fetch both failed)
                    await BookmarkRepository.markFetchFailed(bookmark.id, failReason);
                    logger.info(`Marked as dead website: ${bookmark.url}`);
                }
            } catch (error) {
                result.failed++;
                result.errors.push(`${bookmark.originalTitle}: ${String(error)}`);
                logger.error(`Refetch error for ${bookmark.url}:`, error);
            }

            processed++;

            // 避免请求过于频繁
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 广播完成
        broadcastProgress({
            phase: 'complete',
            total: needsRefetchList.length,
            remaining: 0,
            success: result.refetched,
            failed: result.failed,
            skippedDead,
        });

        logger.info(`Refetch complete: ${result.refetched} success, ${result.failed} failed`);
        return result;
    } catch (error) {
        logger.error('Refetch garbled content failed:', error);
        result.errors.push(`全局错误: ${String(error)}`);
        return result;
    }
}

export default {
    startSummarizationQueue,
    stopSummarizationQueue,
    processNextBatch,
    processQueue,
    summarizePage,
    summarizeBookmarkById,
    refetchGarbledContent,
};
