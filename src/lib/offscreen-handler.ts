/**
 * AI Bookmark Brain - Offscreen Document Script
 * Directly handles SQLite operations using sql.js (no separate worker)
 */

import initSqlJs, { Database } from 'sql.js';
import { MESSAGE_TYPES } from '../shared/constants';
import { logger } from '../shared/logger';
import { CREATE_TABLES_SQL } from '../database/schema';
import type { DBQueryMessage, DBExecuteMessage } from '../shared/types';

// Database instance
let db: Database | null = null;
let dbReady = false;
let initPromise: Promise<void> | null = null;

// Storage key for IndexedDB persistence
const DB_STORAGE_KEY = 'ai_bookmark_brain_db';

/**
 * Save database to IndexedDB
 */
async function saveToStorage(): Promise<void> {
    if (!db) return;

    try {
        const data = db.export();
        const blob = new Blob([data], { type: 'application/octet-stream' });

        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AIBookmarkBrain', 1);

            request.onupgradeneeded = (event) => {
                const idb = (event.target as IDBOpenDBRequest).result;
                if (!idb.objectStoreNames.contains('database')) {
                    idb.createObjectStore('database');
                }
            };

            request.onsuccess = (event) => {
                const idb = (event.target as IDBOpenDBRequest).result;
                const tx = idb.transaction('database', 'readwrite');
                const store = tx.objectStore('database');
                const putRequest = store.put(blob, DB_STORAGE_KEY);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        logger.error('Failed to save to IndexedDB:', error);
    }
}

/**
 * Load database from IndexedDB
 */
async function loadFromStorage(): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open('AIBookmarkBrain', 1);

            request.onupgradeneeded = (event) => {
                const idb = (event.target as IDBOpenDBRequest).result;
                if (!idb.objectStoreNames.contains('database')) {
                    idb.createObjectStore('database');
                }
            };

            request.onsuccess = (event) => {
                const idb = (event.target as IDBOpenDBRequest).result;
                const tx = idb.transaction('database', 'readonly');
                const store = tx.objectStore('database');
                const getRequest = store.get(DB_STORAGE_KEY);

                getRequest.onsuccess = async () => {
                    if (getRequest.result) {
                        const blob = getRequest.result as Blob;
                        const buffer = await blob.arrayBuffer();
                        resolve(new Uint8Array(buffer));
                    } else {
                        resolve(null);
                    }
                };

                getRequest.onerror = () => resolve(null);
            };

            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

/**
 * Initialize SQLite database
 */
async function initDatabase(): Promise<void> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            logger.info('Initializing sql.js...');

            // Initialize sql.js with WASM from extension bundle (not CDN, for CSP compliance)
            const SQL = await initSqlJs({
                locateFile: (file: string) => chrome.runtime.getURL(file)
            });

            // Try to load existing database
            const existingData = await loadFromStorage();

            if (existingData) {
                db = new SQL.Database(existingData);
                logger.info('Database loaded from IndexedDB');
            } else {
                db = new SQL.Database();
                logger.info('Created new database');
            }

            // Create tables if they don't exist
            db.run(CREATE_TABLES_SQL);
            logger.info('Database tables initialized');

            // Save after initialization
            await saveToStorage();

            dbReady = true;
            logger.info('Database ready!');
        } catch (error) {
            logger.error('Database init error:', error);
            throw error;
        }
    })();

    return initPromise;
}

/**
 * Execute a query and return results
 */
function executeQuery(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    if (!db) {
        throw new Error('Database not initialized');
    }

    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }

    const results: Record<string, unknown>[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
    }
    stmt.free();

    return results;
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE)
 */
function executeStatement(sql: string, params: unknown[] = [], skipSave = false): { changes: number; lastInsertRowId: number } {
    if (!db) {
        throw new Error('Database not initialized');
    }

    db.run(sql, params);

    // Get changes and last insert ID
    const changes = db.getRowsModified();
    const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowId = lastIdResult.length > 0 && lastIdResult[0].values.length > 0
        ? (lastIdResult[0].values[0][0] as number)
        : 0;

    // Save after modifications (async, don't wait) - unless skipSave is true (for batch operations)
    if (!skipSave) {
        saveToStorage().catch(err => logger.error('Save failed:', err));
    }

    return { changes, lastInsertRowId };
}

// Listen for messages from background script
// Handle db:* and data:* messages, ignore all others
chrome.runtime.onMessage.addListener((
    message: { type: string; data?: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => {
    // Handle database and data export/import messages
    if (!message.type || (!message.type.startsWith('db:') && !message.type.startsWith('data:') && !message.type.startsWith('opfs:'))) {
        return false; // Not our message, let other listeners handle it
    }

    const handleMessage = async () => {
        // Ensure database is initialized for any DB operation
        await initDatabase();

        try {
            switch (message.type) {
                case MESSAGE_TYPES.DB_INIT:
                    logger.info('Received DB init request');
                    await initDatabase();
                    return { success: true, ready: dbReady };

                case MESSAGE_TYPES.DB_QUERY:
                    const queryData = message.data as DBQueryMessage;
                    logger.debug('DB query:', queryData.sql.substring(0, 50));
                    const queryResult = executeQuery(queryData.sql, queryData.params || []);
                    logger.debug('Query returned', queryResult.length, 'rows');
                    return { success: true, data: queryResult };

                case MESSAGE_TYPES.DB_EXECUTE:
                    const execData = message.data as DBExecuteMessage;
                    logger.debug('DB execute:', execData.sql.substring(0, 50));
                    const execResult = executeStatement(execData.sql, execData.params || []);
                    logger.debug('Execute result:', execResult);
                    return { success: true, data: execResult };

                // Database export - return raw SQLite binary as plain Array (JSON-serializable)
                case MESSAGE_TYPES.OPFS_READ_FILE:
                case MESSAGE_TYPES.DATA_EXPORT_DB:
                    logger.info('Exporting database...');
                    if (!db) {
                        return { success: false, error: 'Database not initialized' };
                    }
                    const exportData = db.export();
                    logger.info('Database exported, size:', exportData.byteLength);
                    // IMPORTANT: Convert Uint8Array to plain Array for JSON serialization
                    // Chrome's sendMessage uses JSON which cannot transfer ArrayBuffer/Uint8Array
                    const dataArray = Array.from(exportData);
                    logger.info('Converted to array, length:', dataArray.length);
                    return { success: true, data: dataArray };

                // Database import - incremental merge by URL
                case MESSAGE_TYPES.DATA_IMPORT_DB:
                    logger.info('Importing database...');
                    const importData = message.data as { buffer: ArrayBuffer | number[] };
                    if (!importData?.buffer) {
                        return { success: false, error: 'No data provided' };
                    }
                    // Handle both ArrayBuffer and plain Array (from JSON serialization)
                    let importBuffer: ArrayBuffer;
                    if (Array.isArray(importData.buffer)) {
                        // Convert plain Array back to ArrayBuffer
                        importBuffer = new Uint8Array(importData.buffer).buffer;
                        logger.info('Converted array to buffer, size:', importBuffer.byteLength);
                    } else {
                        importBuffer = importData.buffer;
                    }
                    const importResult = await importDatabaseIncremental(importBuffer);
                    return { success: true, result: importResult };

                default:
                    logger.warn('Unhandled message type:', message.type);
                    return { success: false, error: `Unhandled message type: ${message.type}` };
            }
        } catch (error) {
            logger.error('Message handling failed:', error);
            return { success: false, error: String(error) };
        }
    };

    handleMessage().then(sendResponse);
    return true; // Keep channel open for async response
});

/**
 * Import database incrementally by URL matching
 * Imports ALL tables and fields for complete data migration
 * PERFORMANCE OPTIMIZED: Batch processing with event loop yields
 */
async function importDatabaseIncremental(buffer: ArrayBuffer): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    errors: string[];
}> {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: [] as string[] };
    const BATCH_SIZE = 100; // Yield to event loop every N records

    // Helper to yield to event loop
    const yieldToEventLoop = () => new Promise<void>(r => setTimeout(r, 0));

    try {
        // Load the imported database
        const SQL = await initSqlJs({
            locateFile: (file: string) => chrome.runtime.getURL(file)
        });
        const importedDb = new SQL.Database(new Uint8Array(buffer));

        logger.info('Import database opened successfully');

        // =====================================================
        // PRE-BUILD MAPPINGS to avoid nested queries
        // =====================================================

        // 1. Build imported DB's bookmark id -> url map
        const importedIdToUrl = new Map<number, string>();
        const importedBookmarks = importedDb.exec('SELECT id, url FROM bookmarks');
        if (importedBookmarks.length > 0) {
            for (const row of importedBookmarks[0].values) {
                importedIdToUrl.set(row[0] as number, row[1] as string);
            }
        }
        logger.info(`Built imported ID->URL map: ${importedIdToUrl.size} entries`);

        // 2. Build current DB's url -> id map
        const currentUrlToId = new Map<string, number>();
        const currentBookmarks = executeQuery('SELECT id, url FROM bookmarks', []);
        for (const bm of currentBookmarks) {
            currentUrlToId.set(bm.url as string, bm.id as number);
        }
        logger.info(`Built current URL->ID map: ${currentUrlToId.size} entries`);

        await yieldToEventLoop();

        // =====================================================
        // 1. Import bookmarks (with ALL fields)
        // =====================================================
        const bookmarkIdMap = new Map<number, number>(); // old id -> new id
        const fullBookmarks = importedDb.exec('SELECT * FROM bookmarks');

        if (fullBookmarks.length > 0) {
            const columns = fullBookmarks[0].columns;
            const rows = fullBookmarks[0].values;

            logger.info(`Found ${rows.length} bookmarks to import`);

            for (let i = 0; i < rows.length; i++) {
                try {
                    const row = rows[i];
                    const bookmark: Record<string, unknown> = {};
                    columns.forEach((col, idx) => {
                        bookmark[col] = row[idx];
                    });

                    const url = bookmark.url as string;
                    const oldId = bookmark.id as number;
                    if (!url) continue;

                    // Check using pre-built map (no DB query needed)
                    const existingId = currentUrlToId.get(url);

                    if (existingId !== undefined) {
                        // URL exists - map old ID to existing ID
                        bookmarkIdMap.set(oldId, existingId);

                        // Merge page_content if current is empty but imported has content
                        const importedContent = bookmark.page_content as string | null;
                        if (importedContent && importedContent.length > 50) {
                            // Check if current bookmark has content
                            const current = executeQuery('SELECT page_content FROM bookmarks WHERE id = ?', [existingId]);
                            const currentContent = current[0]?.page_content as string | null;

                            if (!currentContent || currentContent.length < 50) {
                                // Update with imported content
                                executeStatement(`
                                    UPDATE bookmarks SET 
                                        page_content = ?, 
                                        page_content_hash = ?,
                                        content_fetched_at = ?,
                                        last_updated = ?
                                    WHERE id = ?
                                `, [
                                    importedContent,
                                    bookmark.page_content_hash || null,
                                    bookmark.content_fetched_at || Date.now(),
                                    Date.now(),
                                    existingId
                                ], true);
                                result.updated++;
                            } else {
                                result.skipped++;
                            }
                        } else {
                            result.skipped++;
                        }
                    } else {
                        // Insert new bookmark with ALL fields (skipSave=true for batch)
                        const execResult = executeStatement(`
                            INSERT INTO bookmarks (
                                chrome_bookmark_id, chrome_folder_path, url, original_title,
                                favicon_url, page_content, page_content_hash, user_notes, user_category_id,
                                status, error_message, retry_count, is_archived, is_pinned,
                                visit_count, created_at, analyzed_at, content_fetched_at, last_updated
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            bookmark.chrome_bookmark_id || null,
                            bookmark.chrome_folder_path || '',
                            url,
                            bookmark.original_title || '',
                            bookmark.favicon_url || '',
                            bookmark.page_content || null,
                            bookmark.page_content_hash || null,
                            bookmark.user_notes || null,
                            null,  // user_category_id will be mapped later
                            bookmark.status || 'pending',
                            bookmark.error_message || null,
                            bookmark.retry_count || 0,
                            bookmark.is_archived || 0,
                            bookmark.is_pinned || 0,
                            bookmark.visit_count || 0,
                            bookmark.created_at || Date.now(),
                            bookmark.analyzed_at || null,
                            bookmark.content_fetched_at || null,
                            bookmark.last_updated || Date.now()
                        ], true); // skipSave = true!

                        bookmarkIdMap.set(oldId, execResult.lastInsertRowId);
                        currentUrlToId.set(url, execResult.lastInsertRowId); // Update cache
                        result.inserted++;
                    }
                } catch (err) {
                    result.errors.push(String(err));
                }

                // Yield to event loop periodically
                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }
        logger.info(`Bookmark ID mapping created: ${bookmarkIdMap.size} entries`);

        await yieldToEventLoop();

        // =====================================================
        // 2. Import categories
        // =====================================================
        const categoryIdMap = new Map<number, number>();
        const importedCategories = importedDb.exec('SELECT * FROM categories');
        if (importedCategories.length > 0) {
            const catRows = importedCategories[0].values;
            const catCols = importedCategories[0].columns;

            for (let i = 0; i < catRows.length; i++) {
                try {
                    const row = catRows[i];
                    const cat: Record<string, unknown> = {};
                    catCols.forEach((col, idx) => {
                        cat[col] = row[idx];
                    });

                    const catName = cat.name as string;
                    const oldCatId = cat.id as number;
                    if (!catName) continue;

                    const existing = executeQuery('SELECT id FROM categories WHERE name = ?', [catName]);
                    if (existing.length > 0) {
                        categoryIdMap.set(oldCatId, existing[0].id as number);
                    } else {
                        const execResult = executeStatement(`
                            INSERT INTO categories (name, name_pinyin, icon, color, parent_id, sort_order, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [
                            catName,
                            cat.name_pinyin || null,
                            cat.icon || null,
                            cat.color || '#007ACC',
                            cat.parent_id || null,
                            cat.sort_order || 0,
                            cat.created_at || Date.now()
                        ], true); // skipSave = true!
                        categoryIdMap.set(oldCatId, execResult.lastInsertRowId);
                    }
                } catch (err) {
                    // Silently skip category errors
                }

                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }

        // Update bookmark user_category_id with mapped category IDs
        if (categoryIdMap.size > 0 && fullBookmarks.length > 0) {
            const columns = fullBookmarks[0].columns;
            const rows = fullBookmarks[0].values;
            const catIdIndex = columns.indexOf('user_category_id');
            const urlIndex = columns.indexOf('url');

            if (catIdIndex >= 0 && urlIndex >= 0) {
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const oldCatId = row[catIdIndex] as number | null;
                    const url = row[urlIndex] as string;
                    if (oldCatId && categoryIdMap.has(oldCatId)) {
                        const newCatId = categoryIdMap.get(oldCatId);
                        executeStatement(`UPDATE bookmarks SET user_category_id = ? WHERE url = ?`, [newCatId, url], true);
                    }

                    if (i % BATCH_SIZE === 0 && i > 0) {
                        await yieldToEventLoop();
                    }
                }
            }
        }

        await yieldToEventLoop();

        // =====================================================
        // 3. Import tags
        // =====================================================
        const tagIdMap = new Map<number, number>();
        const importedTags = importedDb.exec('SELECT * FROM tags');
        if (importedTags.length > 0) {
            const tagRows = importedTags[0].values;
            const tagCols = importedTags[0].columns;

            for (let i = 0; i < tagRows.length; i++) {
                try {
                    const row = tagRows[i];
                    const tag: Record<string, unknown> = {};
                    tagCols.forEach((col, idx) => {
                        tag[col] = row[idx];
                    });

                    const tagName = tag.name as string;
                    const oldTagId = tag.id as number;
                    if (!tagName) continue;

                    const existing = executeQuery('SELECT id FROM tags WHERE name = ?', [tagName]);
                    if (existing.length > 0) {
                        tagIdMap.set(oldTagId, existing[0].id as number);
                    } else {
                        const execResult = executeStatement(`
                            INSERT INTO tags (name, name_zh, name_en, name_pinyin, source, color, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [
                            tagName,
                            tag.name_zh || null,
                            tag.name_en || null,
                            tag.name_pinyin || null,
                            tag.source || 'ai',
                            tag.color || '#007ACC',
                            tag.created_at || Date.now()
                        ], true); // skipSave = true!
                        tagIdMap.set(oldTagId, execResult.lastInsertRowId);
                    }
                } catch (err) {
                    // Silently skip tag errors
                }

                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }

        await yieldToEventLoop();

        // =====================================================
        // 4. Import bookmark_tags (using pre-built maps)
        // =====================================================
        const importedBookmarkTags = importedDb.exec('SELECT * FROM bookmark_tags');
        if (importedBookmarkTags.length > 0) {
            const btRows = importedBookmarkTags[0].values;
            const btCols = importedBookmarkTags[0].columns;

            for (let i = 0; i < btRows.length; i++) {
                try {
                    const row = btRows[i];
                    const bt: Record<string, unknown> = {};
                    btCols.forEach((col, idx) => {
                        bt[col] = row[idx];
                    });

                    const oldBookmarkId = bt.bookmark_id as number;
                    const oldTagId = bt.tag_id as number;

                    // Use pre-built map instead of querying
                    const url = importedIdToUrl.get(oldBookmarkId);
                    if (!url) continue;

                    // Find new bookmark ID using cache
                    const newBookmarkId = currentUrlToId.get(url);
                    if (!newBookmarkId) continue;

                    // Find new tag ID
                    const newTagId = tagIdMap.get(oldTagId);
                    if (!newTagId) continue;

                    // Check if relationship exists
                    const existingRel = executeQuery(
                        'SELECT 1 FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?',
                        [newBookmarkId, newTagId]
                    );
                    if (existingRel.length === 0) {
                        executeStatement(`
                            INSERT INTO bookmark_tags (bookmark_id, tag_id, source, confidence, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            newBookmarkId,
                            newTagId,
                            bt.source || 'ai',
                            bt.confidence || null,
                            bt.created_at || Date.now()
                        ], true); // skipSave = true!
                    }
                } catch (err) {
                    // Silently skip bookmark_tags errors
                }

                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }

        await yieldToEventLoop();

        // =====================================================
        // 5. Import AI summaries (using pre-built maps)
        // =====================================================
        const importedSummaries = importedDb.exec('SELECT * FROM ai_summaries');
        if (importedSummaries.length > 0) {
            const summaryRows = importedSummaries[0].values;
            const summaryCols = importedSummaries[0].columns;

            for (let i = 0; i < summaryRows.length; i++) {
                try {
                    const row = summaryRows[i];
                    const summary: Record<string, unknown> = {};
                    summaryCols.forEach((col, idx) => {
                        summary[col] = row[idx];
                    });

                    const oldBookmarkId = summary.bookmark_id as number;

                    // Use pre-built map instead of querying
                    const url = importedIdToUrl.get(oldBookmarkId);
                    if (!url) continue;

                    // Find new bookmark ID using cache
                    const newBookmarkId = currentUrlToId.get(url);
                    if (!newBookmarkId) continue;

                    // Check if summary already exists
                    const existingSummary = executeQuery('SELECT id FROM ai_summaries WHERE bookmark_id = ?', [newBookmarkId]);
                    if (existingSummary.length === 0) {
                        executeStatement(`
                            INSERT INTO ai_summaries (
                                bookmark_id, ai_provider, ai_model, summary_text,
                                summary_text_lower, summary_original, confidence_score, language, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            newBookmarkId,
                            summary.ai_provider || 'unknown',
                            summary.ai_model || '',
                            summary.summary_text || '',
                            (summary.summary_text as string || '').toLowerCase(),
                            summary.summary_original || null,
                            summary.confidence_score || null,
                            summary.language || null,
                            summary.created_at || Date.now()
                        ], true); // skipSave = true!
                    }
                } catch (err) {
                    // Silently skip summary errors
                }

                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }

        await yieldToEventLoop();

        // =====================================================
        // 6. Import history_records
        // =====================================================
        const importedHistory = importedDb.exec('SELECT * FROM history_records');
        if (importedHistory.length > 0) {
            const histRows = importedHistory[0].values;
            const histCols = importedHistory[0].columns;

            for (let i = 0; i < histRows.length; i++) {
                try {
                    const row = histRows[i];
                    const hist: Record<string, unknown> = {};
                    histCols.forEach((col, idx) => {
                        hist[col] = row[idx];
                    });

                    const url = hist.url as string;
                    if (!url) continue;

                    executeStatement(`
                        INSERT INTO history_records (
                            title, url, page_description, favicon_url,
                            source_type, search_query, bookmark_id,
                            visit_count, total_time_spent, first_visit_at, last_visit_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(url) DO UPDATE SET
                            title = excluded.title,
                            page_description = COALESCE(excluded.page_description, page_description),
                            favicon_url = COALESCE(excluded.favicon_url, favicon_url),
                            visit_count = visit_count + excluded.visit_count,
                            total_time_spent = total_time_spent + excluded.total_time_spent,
                            last_visit_at = MAX(last_visit_at, excluded.last_visit_at)
                    `, [
                        hist.title || '',
                        url,
                        hist.page_description || null,
                        hist.favicon_url || null,
                        hist.source_type || 'navigate',
                        hist.search_query || null,
                        null,
                        hist.visit_count || 1,
                        hist.total_time_spent || 0,
                        hist.first_visit_at || Date.now(),
                        hist.last_visit_at || Date.now()
                    ], true); // skipSave = true!
                } catch (err) {
                    // Silently skip history errors
                }

                if (i % BATCH_SIZE === 0 && i > 0) {
                    await yieldToEventLoop();
                }
            }
        }

        importedDb.close();
        logger.info('Database import completed:', result);

        // =====================================================
        // SAVE ONLY ONCE AT THE END
        // =====================================================
        await saveToStorage();
        logger.info('Database saved to IndexedDB');

        return result;
    } catch (error) {
        logger.error('Import failed:', error);
        result.errors.push(String(error));
        return result;
    }
}

// Auto-initialize database on script load
logger.info('Offscreen document loading...');
initDatabase().then(() => {
    logger.info('Offscreen document initialized and database ready');
}).catch((error) => {
    logger.error('Offscreen initialization failed:', error);
});
