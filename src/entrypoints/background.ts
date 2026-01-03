/**
 * AI Bookmark Brain - Background Service Worker
 * Main entry point for extension background operations
 * 
 * IMPORTANT: MV3 requires event listeners to be registered synchronously
 * at the top level of the defineBackground callback for proper lifecycle management.
 */

import { logger } from '../shared/logger';
import { MESSAGE_TYPES } from '../shared/constants';
import { isFirstRun } from '../lib/storage';
import { onMessage, initMessageListener } from '../lib/messaging';
import { fullSync, setupBookmarkListeners } from '../services/sync/bookmark-sync.service';
import { startSummarizationQueue, processNextBatch, stopSummarizationQueue, refetchGarbledContent } from '../services/sync/summarization-queue';
import { search, searchHistory, invalidateIndex } from '../services/search/search-engine';
import { recordSelection } from '../services/search/frecency.service';
import { HistoryRecordRepository, BookmarkRepository, CategoryRepository } from '../services/database.service';


// =====================================================
// Constants
// =====================================================

const KEEPALIVE_ALARM = 'sw-keepalive';
const SUMMARIZE_ALARM = 'summarize-next';
const KEEPALIVE_INTERVAL_MINUTES = 0.4; // 24 seconds

// =====================================================
// State (will be lost on Service Worker restart)
// =====================================================

let dbReady = false;
let initPromise: Promise<void> | null = null;

// =====================================================
// Command Handlers
// =====================================================

// Mutex lock and pre-input buffer state for toggle-search command
let isToggling = false;
let pendingToggle = false;  // Pre-input buffer: queue next toggle if one is already in progress
const TOGGLE_DEBOUNCE_MS = 20;  // Minimal debounce for snappy response

/**
 * Handle toggle-search command with dynamic script injection fallback
 * Includes mutex lock and throttling to prevent concurrent/rapid calls
 */
async function handleToggleSearch(): Promise<void> {
  // Keyboard pre-input: if already processing a toggle, queue the next one
  if (isToggling) {
    logger.debug('Toggle in progress, queuing next toggle (pre-input)');
    pendingToggle = true;
    return;
  }

  // Acquire lock
  isToggling = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    // Skip chrome:// and other restricted URLs
    if (tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:')) {
      logger.warn('Cannot inject content script into restricted page:', tab.url);
      return;
    }

    try {
      // Try sending message to existing content script
      await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.UI_TOGGLE_OVERLAY,
      });
      logger.debug('Toggle message sent successfully');
    } catch (error) {
      // Content script not loaded
      // In development mode, WXT handles content script injection via hot reload
      // Dynamic injection would create duplicate instances, so skip it
      if (import.meta.env.DEV) {
        logger.warn('Content script not responding in dev mode - page may need refresh');
        return;
      }

      // In production, inject dynamically
      logger.warn('Content script not responding, injecting dynamically...');
      try {
        await injectContentScript(tab.id);
        // Wait for script to initialize
        await new Promise(resolve => setTimeout(resolve, 150));
        // Try again
        await chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_TYPES.UI_TOGGLE_OVERLAY,
        });
        logger.info('Content script injected and toggle sent');
      } catch (injectError) {
        logger.error('Failed to inject content script:', injectError);
      }
    }
  } finally {
    // Release lock
    isToggling = false;

    // Process pending toggle (keyboard pre-input) after a minimal delay
    if (pendingToggle) {
      pendingToggle = false;
      setTimeout(() => {
        handleToggleSearch();
      }, TOGGLE_DEBOUNCE_MS);
    }
  }
}

// Track tabs where content script has been dynamically injected
const injectedTabs = new Set<number>();

/**
 * Dynamically inject content script and CSS
 * Tracks injected tabs to prevent duplicate injections
 */
async function injectContentScript(tabId: number): Promise<void> {
  // Check if already injected to this tab
  if (injectedTabs.has(tabId)) {
    logger.debug('Content script already injected to tab', tabId);
    return;
  }

  // Mark as injected before actual injection to prevent race conditions
  injectedTabs.add(tabId);

  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content-scripts/content.css'],
    });

    // Then inject JS
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
  } catch (error) {
    // If injection fails, remove from tracking
    injectedTabs.delete(tabId);
    throw error;
  }
}

// Clean up injected tabs tracking when tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Clear tracking when page navigates (content script will be reloaded by WXT)
  if (changeInfo.status === 'loading') {
    injectedTabs.delete(tabId);
  }
});

// =====================================================
// Alarm Handlers
// =====================================================

/**
 * Handle summarize-next alarm for batch processing
 */
async function handleSummarizeAlarm(): Promise<void> {
  await ensureInitialized();
  if (!dbReady) {
    logger.warn('Database not ready, skipping summarization batch');
    return;
  }

  try {
    await processNextBatch();
  } catch (error) {
    logger.error('Summarization batch error:', error);
  }
}

// =====================================================
// Tab Event Handlers
// =====================================================

/**
 * Handle tab complete event for history recording
 */


// =====================================================
// Offscreen Document & Database Setup
// =====================================================

/**
 * Create offscreen document for database operations
 */
async function setupOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (existingContexts.length > 0) {
    logger.info('Offscreen document already exists');
  } else {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['LOCAL_STORAGE' as chrome.offscreen.Reason],
        justification: 'SQLite database with IndexedDB persistence',
      });
      logger.info('Offscreen document created');
    } catch (error) {
      logger.error('Failed to create offscreen document:', error);
      throw error;
    }
  }

  // Wait for database to be ready
  let retries = 0;
  const maxRetries = 10;

  while (!dbReady && retries < maxRetries) {
    try {
      logger.info(`Attempting to initialize database (attempt ${retries + 1}/${maxRetries})...`);

      const response = await new Promise<{ success: boolean; ready?: boolean }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: false });
        }, 3000);

        chrome.runtime.sendMessage(
          { type: MESSAGE_TYPES.DB_INIT, data: {} },
          (resp) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              logger.warn('DB_INIT message error:', chrome.runtime.lastError.message);
              resolve({ success: false });
            } else {
              resolve(resp || { success: false });
            }
          }
        );
      });

      if (response.success && response.ready) {
        dbReady = true;
        logger.info('Database initialized successfully!');
        break;
      }

      retries++;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.warn('DB init attempt failed:', error);
      retries++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (!dbReady) {
    logger.error('Failed to initialize database after', maxRetries, 'attempts');
    throw new Error('Database initialization failed');
  }
}

// =====================================================
// Message Handlers Setup
// =====================================================

/**
 * Set up message handlers for extension communication
 */
function setupMessageHandlers(): void {
  initMessageListener();

  // Search handler
  onMessage(MESSAGE_TYPES.SEARCH_BOOKMARKS, async (data: { options: { query: string; limit?: number } }) => {
    logger.debug('Search request:', data);
    const results = await search(data.options);
    return { results };
  });

  // Sync handlers
  onMessage(MESSAGE_TYPES.SYNC_FULL, async () => {
    logger.info('Full sync requested');
    if (!dbReady) {
      return { error: 'Database not ready', added: 0, updated: 0, errors: 1 };
    }
    const result = await fullSync();
    return result;
  });

  // Start AI summarization queue handler (now uses alarms)
  onMessage(MESSAGE_TYPES.SYNC_START_SUMMARIZATION, async () => {
    logger.info('Starting AI summarization queue (alarm-based)');
    await startSummarizationQueue();
    return { started: true };
  });

  // Frecency selection tracking handler
  onMessage(MESSAGE_TYPES.FRECENCY_RECORD, async (data: { query: string; bookmarkId: number }) => {
    logger.debug('Recording frecency selection:', data);
    recordSelection(data.query, data.bookmarkId);
    return { success: true };
  });

  // History search handler (! prefix)
  onMessage(MESSAGE_TYPES.SEARCH_HISTORY, async (data: { query: string; limit?: number }) => {
    logger.debug('History search request:', data);
    const results = await searchHistory(data.query, data.limit);
    return { results };
  });

  // Add bookmark from history panel
  onMessage(MESSAGE_TYPES.ADD_BOOKMARK, async (data: { url: string; title: string }) => {
    logger.debug('Add bookmark request:', data);
    try {
      const bookmark = await chrome.bookmarks.create({
        title: data.title,
        url: data.url,
      });
      logger.info('Bookmark created:', bookmark.id);
      return { success: true, bookmarkId: bookmark.id };
    } catch (error) {
      logger.error('Failed to create bookmark:', error);
      return { success: false, error: String(error) };
    }
  });

  // Stop summarization queue
  onMessage('summarization:stop', async () => {
    logger.info('Stopping summarization queue');
    await stopSummarizationQueue();
    return { stopped: true };
  });

  // ========== Category Handlers ==========

  // Create category
  onMessage(MESSAGE_TYPES.CATEGORY_CREATE, async (data: { name: string; namePinyin?: string; color?: string }) => {
    logger.debug('Create category request:', data);
    const id = await CategoryRepository.create({
      name: data.name,
      namePinyin: data.namePinyin,
      color: data.color || '#808080',
      sortOrder: 0,
      createdAt: Date.now(),
    });
    const category = await CategoryRepository.findById(id);
    return { success: true, category };
  });

  // Update category
  onMessage(MESSAGE_TYPES.CATEGORY_UPDATE, async (data: { id: number; name: string; namePinyin?: string }) => {
    logger.debug('Update category request:', data);
    await CategoryRepository.update(data.id, data.name, data.namePinyin);
    const category = await CategoryRepository.findById(data.id);
    return { success: true, category };
  });

  // Delete category
  onMessage(MESSAGE_TYPES.CATEGORY_DELETE, async (data: { id: number }) => {
    logger.debug('Delete category request:', data);
    await CategoryRepository.delete(data.id);
    return { success: true };
  });

  // List all categories
  onMessage(MESSAGE_TYPES.CATEGORY_LIST, async () => {
    logger.debug('List categories request');
    const categories = await CategoryRepository.findAll();
    return { categories };
  });

  // Find categories by prefix (for autocomplete)
  onMessage(MESSAGE_TYPES.CATEGORY_FIND_BY_PREFIX, async (data: { prefix: string; limit?: number }) => {
    logger.debug('Find categories by prefix:', data);
    const categories = await CategoryRepository.findByPrefix(data.prefix, data.limit);
    return { categories };
  });

  // Set bookmark category
  onMessage(MESSAGE_TYPES.SET_BOOKMARK_CATEGORY, async (data: { bookmarkId: number; categoryId: number | null }) => {
    logger.debug('Set bookmark category:', data);
    await CategoryRepository.setBookmarkCategory(data.bookmarkId, data.categoryId);
    // Force search index refresh so @category search returns updated results immediately
    invalidateIndex();
    return { success: true };
  });

  // ========== Content Refetch Handlers ==========

  // Refetch garbled/empty content
  onMessage(MESSAGE_TYPES.REFETCH_GARBLED_CONTENT, async () => {
    logger.info('Refetch garbled content requested');
    if (!dbReady) {
      return { success: false, error: 'Database not ready' };
    }
    const result = await refetchGarbledContent();
    return { success: true, result };
  });

  logger.info('Message handlers initialized');
}

// =====================================================
// Initialization
// =====================================================

/**
 * Ensure initialization is complete before processing
 */
async function ensureInitialized(): Promise<void> {
  if (initPromise) {
    await initPromise;
  }
}

/**
 * Main initialization function (async setup that can wait)
 */
async function initializeAsync(): Promise<void> {
  try {
    // Set up message handlers
    setupMessageHandlers();

    // Set up offscreen document and database
    await setupOffscreenDocument();

    // Set up bookmark listeners
    setupBookmarkListeners();

    // Resume interrupted summarization queue
    const { summarizing } = await chrome.storage.session.get('summarizing');
    if (summarizing) {
      logger.info('Resuming interrupted summarization queue');
      await processNextBatch();
    }

    // Reset any bookmarks stuck in 'analyzing' state
    try {
      const resetCount = await BookmarkRepository.resetAnalyzingToRetry();
      if (resetCount > 0) {
        logger.info(`Reset ${resetCount} bookmarks from 'analyzing' to 'pending'`);
      }
    } catch (error) {
      logger.warn('Failed to reset analyzing bookmarks:', error);
    }

    // Check if first run
    const firstRun = await isFirstRun.getValue();
    if (firstRun) {
      logger.info('First run detected, starting full sync...');
      await isFirstRun.setValue(false);

      // Perform initial sync after a short delay
      setTimeout(async () => {
        try {
          await fullSync();
          logger.info('Initial sync completed');
        } catch (error) {
          logger.error('Initial sync failed:', error);
        }
      }, 1000);
    }

    logger.info('Async initialization complete');
  } catch (error) {
    logger.error('Async initialization failed:', error);
  }
}

// =====================================================
// Entry Point - SYNCHRONOUS EVENT LISTENER REGISTRATION
// All event listeners MUST be registered synchronously here
// =====================================================

export default defineBackground(() => {
  logger.info('Background service worker started');
  logger.group('AI Bookmark Brain - Initialization');

  // ========================================
  // SYNCHRONOUS EVENT LISTENER REGISTRATION
  // These are registered immediately when Service Worker starts
  // ========================================

  // 1. Command listener (Ctrl+Q) - MUST be synchronous
  chrome.commands.onCommand.addListener((command: string) => {
    logger.info('Command received:', command);
    if (command === 'toggle-search') {
      handleToggleSearch();
    }
  });

  // 2. Alarm listener (heartbeat + batch summarization) - MUST be synchronous
  chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      // Heartbeat: call simple API to reset idle timer
      chrome.runtime.getPlatformInfo();
      logger.debug('Keepalive heartbeat');
    }
    if (alarm.name === SUMMARIZE_ALARM) {
      handleSummarizeAlarm();
    }
  });



  // ========================================
  // SYNCHRONOUS SETUP (non-async)
  // ========================================

  // Set up keepalive alarm (24 seconds interval)
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_INTERVAL_MINUTES });
  logger.info('Keepalive alarm set (24s interval)');

  // ========================================
  // ASYNC INITIALIZATION (database, etc.)
  // ========================================

  initPromise = initializeAsync();

  logger.groupEnd();
});
