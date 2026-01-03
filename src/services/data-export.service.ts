/**
 * AI Bookmark Brain - Data Export/Import Service
 * Handles exporting and importing database
 */

import { MESSAGE_TYPES } from '../shared/constants';
import { logger } from '../shared/logger';
import type {
    ImportResult,
    ValidationResult
} from '../shared/types';

// =====================================================
// Database Export/Import (SQLite .db file)
// =====================================================

/**
 * Export database file from OPFS
 * Sends message to offscreen document to read the raw database file
 */
export async function exportDatabase(): Promise<ArrayBuffer> {
    logger.info('Exporting database...');

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: MESSAGE_TYPES.OPFS_READ_FILE },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (!response?.success) {
                    reject(new Error(response?.error || 'Failed to read database file'));
                    return;
                }

                logger.info('Database exported successfully, size:', response.data?.byteLength);
                resolve(response.data);
            }
        );
    });
}

/**
 * Validate an imported database file
 */
export async function validateDatabaseFile(file: File): Promise<ValidationResult> {
    logger.info('Validating database file:', file.name);

    const errors: string[] = [];

    // Check file extension
    const validExtensions = ['.db', '.sqlite', '.sqlite3'];
    const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt) {
        errors.push('Invalid file extension. Expected .db or .sqlite');
    }

    // Check minimum file size (SQLite header is at least 100 bytes)
    if (file.size < 100) {
        errors.push('File too small to be a valid SQLite database');
    }

    // Check SQLite magic header
    try {
        const headerBuffer = await file.slice(0, 16).arrayBuffer();
        const headerView = new Uint8Array(headerBuffer);
        const sqliteMagic = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];

        const isValidHeader = sqliteMagic.every((byte, i) => headerView[i] === byte);
        if (!isValidHeader) {
            errors.push('Invalid SQLite file header');
        }
    } catch {
        errors.push('Failed to read file header');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Import database file (incremental merge by URL)
 * This reads the imported DB, extracts records, and merges them into the current DB
 */
export async function importDatabase(file: File): Promise<ImportResult> {
    logger.info('Importing database from file:', file.name);

    const result: ImportResult = {
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: []
    };

    try {
        // First validate the file
        const validation = await validateDatabaseFile(file);
        if (!validation.valid) {
            result.errors = validation.errors;
            return result;
        }

        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Send to background/offscreen for processing
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: MESSAGE_TYPES.DATA_IMPORT_DB,
                    data: { buffer: arrayBuffer }
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        result.errors.push(chrome.runtime.lastError.message || 'Unknown error');
                        resolve(result);
                        return;
                    }

                    if (!response?.success) {
                        result.errors.push(response?.error || 'Import failed');
                        resolve(result);
                        return;
                    }

                    logger.info('Database import completed:', response.result);
                    resolve(response.result as ImportResult);
                }
            );
        });
    } catch (error) {
        result.errors.push(String(error));
        return result;
    }
}

/**
 * Download a Blob as a file
 * Uses anchor element click (no chrome.downloads permission needed)
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logger.info('File downloaded:', filename);
}

/**
 * Download ArrayBuffer as a file
 */
export function downloadArrayBuffer(buffer: ArrayBuffer, filename: string, mimeType = 'application/octet-stream'): void {
    const blob = new Blob([buffer], { type: mimeType });
    downloadBlob(blob, filename);
}

export default {
    exportDatabase,
    importDatabase,
    validateDatabaseFile,
    downloadBlob,
    downloadArrayBuffer
};

