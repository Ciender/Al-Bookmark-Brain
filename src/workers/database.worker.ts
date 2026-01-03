/**
 * AI Bookmark Brain - Database Web Worker
 * Runs SQLite operations using sql.js
 */

import initSqlJs, { Database } from 'sql.js';
import { CREATE_TABLES_SQL } from '../database/schema';

// Database instance
let db: Database | null = null;

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

        // Use IndexedDB for persistence
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
            store.put(blob, DB_STORAGE_KEY);
        };
    } catch (error) {
        console.error('[DB Worker] Failed to save to IndexedDB:', error);
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
    try {
        console.log('[DB Worker] Initializing sql.js...');

        // Initialize sql.js with WASM
        const SQL = await initSqlJs({
            locateFile: (file: string) => `https://sql.js.org/dist/${file}`
        });

        // Try to load existing database
        const existingData = await loadFromStorage();

        if (existingData) {
            db = new SQL.Database(existingData);
            console.log('[DB Worker] Database loaded from IndexedDB');
        } else {
            db = new SQL.Database();
            console.log('[DB Worker] Created new database');
        }

        // Create tables if they don't exist
        db.run(CREATE_TABLES_SQL);
        console.log('[DB Worker] Tables initialized');

        // Save after initialization
        await saveToStorage();

        // Notify ready
        self.postMessage({ type: 'ready' });
    } catch (error) {
        console.error('[DB Worker] Init error:', error);
        self.postMessage({ type: 'error', error: String(error) });
    }
}

/**
 * Execute a query and return results
 */
function executeQuery(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    if (!db) {
        throw new Error('Database not initialized');
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);

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
function executeStatement(sql: string, params: unknown[] = []): { changes: number; lastInsertRowId: number } {
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

    // Save after modifications
    saveToStorage();

    return { changes, lastInsertRowId };
}

// Message handler
self.onmessage = async (event: MessageEvent) => {
    const { id, type, sql, params } = event.data;

    console.log('[DB Worker] Received message:', type, sql?.substring(0, 50));

    try {
        switch (type) {
            case 'init':
                await initDatabase();
                break;

            case 'query':
                const queryResult = executeQuery(sql, params || []);
                console.log('[DB Worker] Query result:', queryResult.length, 'rows');
                self.postMessage({ id, type: 'result', data: queryResult });
                break;

            case 'execute':
                const execResult = executeStatement(sql, params || []);
                console.log('[DB Worker] Execute result:', execResult);
                self.postMessage({ id, type: 'result', data: execResult });
                break;

            default:
                self.postMessage({ id, type: 'error', error: `Unknown type: ${type}` });
        }
    } catch (error) {
        console.error('[DB Worker] Error:', error);
        self.postMessage({ id, type: 'error', error: String(error) });
    }
};

console.log('[DB Worker] Worker script loaded');
