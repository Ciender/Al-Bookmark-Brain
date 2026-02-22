/**
 * AI Bookmark Brain - Options Page Script
 * Handles API key configuration, sync status, and testing
 */

import 'bootstrap/dist/css/bootstrap.min.css';
import '../styles/options.css';
import { apiKeys, activeProvider, syncStatus, extensionSettings, uiSettings, DEFAULT_FONT_SIZES, type FontSettings, searchStrategyOrder } from '../lib/storage';
import { AI_PROVIDERS, MESSAGE_TYPES } from '../shared/constants';
import { logger } from '../shared/logger';
import { DEFAULT_SEARCH_STRATEGIES, loadSearchStrategies, type SearchStrategy } from '../services/search/search-config';
import { createAIService } from '../services/ai/factory';
import type { AIProviderType } from '../shared/types';

// DOM Elements
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const deepseekKeyInput = document.getElementById('deepseek-key') as HTMLInputElement;
const geminiKeyInput = document.getElementById('gemini-key') as HTMLInputElement;
const openaiKeyInput = document.getElementById('openai-key') as HTMLInputElement;
const deepseekUrlInput = document.getElementById('deepseek-url') as HTMLInputElement | null;
const geminiUrlInput = document.getElementById('gemini-url') as HTMLInputElement | null;
const openaiUrlInput = document.getElementById('openai-url') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
const testResult = document.getElementById('test-result') as HTMLDivElement;
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const summarizeBtn = document.getElementById('summarize-btn') as HTMLButtonElement;
const syncLog = document.getElementById('sync-log') as HTMLDivElement;
const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
const testQueryInput = document.getElementById('test-query') as HTMLInputElement;
const searchResults = document.getElementById('search-results') as HTMLDivElement;
const totalBookmarksEl = document.getElementById('total-bookmarks') as HTMLDivElement;
const summarizedCountEl = document.getElementById('summarized-count') as HTMLDivElement;
const lastSyncEl = document.getElementById('last-sync') as HTMLDivElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;
const historyCacheLimitInput = document.getElementById('history-cache-limit') as HTMLInputElement | null;
const saveHistorySettingsBtn = document.getElementById('save-history-settings-btn') as HTMLButtonElement | null;
const historySettingsStatus = document.getElementById('history-settings-status') as HTMLDivElement | null;

// Font settings DOM elements
const fontSearchInputEl = document.getElementById('font-search-input') as HTMLInputElement;
const fontResultTitleEl = document.getElementById('font-result-title') as HTMLInputElement;
const fontResultUrlEl = document.getElementById('font-result-url') as HTMLInputElement;
const fontResultBadgeEl = document.getElementById('font-result-badge') as HTMLInputElement;
const fontSummaryTitleEl = document.getElementById('font-summary-title') as HTMLInputElement;
const fontSummaryTextEl = document.getElementById('font-summary-text') as HTMLInputElement;
const fontSummaryLabelEl = document.getElementById('font-summary-label') as HTMLInputElement;
const fontMetadataTextEl = document.getElementById('font-metadata-text') as HTMLInputElement;
const saveUiBtn = document.getElementById('save-ui-btn') as HTMLButtonElement;
const resetFontsBtn = document.getElementById('reset-fonts-btn') as HTMLButtonElement;
const uiStatus = document.getElementById('ui-status') as HTMLDivElement;

type ThemeMode = 'auto' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'options-theme-mode';
const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
let currentThemeMode: ThemeMode = 'auto';
const MIN_HISTORY_CACHE_LIMIT = 200;
const MAX_HISTORY_CACHE_LIMIT = 200000;

function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'light' || mode === 'dark') {
        return mode;
    }
    return prefersDarkMedia.matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode): void {
    currentThemeMode = mode;
    document.documentElement.setAttribute('data-bs-theme', getResolvedTheme(mode));
    if (themeSelect) {
        themeSelect.value = mode;
    }
}

function loadThemePreference(): void {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const mode: ThemeMode = (saved === 'light' || saved === 'dark' || saved === 'auto')
        ? saved
        : 'auto';
    applyTheme(mode);
}

function saveThemePreference(mode: ThemeMode): void {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    applyTheme(mode);
}

/**
 * Log to status box
 */
function log(element: HTMLDivElement, message: string, type: 'info' | 'success' | 'error' = 'info') {
    const time = new Date().toLocaleTimeString();
    element.style.display = 'block';
    const line = document.createElement('span');
    line.className = type;
    line.textContent = `[${time}] ${message}`;
    element.appendChild(line);
    element.appendChild(document.createTextNode('\n'));
    element.scrollTop = element.scrollHeight;
}

function clearStatus(element: HTMLDivElement) {
    element.textContent = '';
}

/**
 * Load saved configuration
 */
async function loadConfig() {
    try {
        // Load provider
        const provider = await activeProvider.getValue();
        providerSelect.value = provider;

        // Load API keys
        const keys = await apiKeys.getValue();

        deepseekKeyInput.value = keys.deepseek || '';
        geminiKeyInput.value = keys.gemini || '';
        openaiKeyInput.value = keys.openai || '';
        if (deepseekUrlInput) deepseekUrlInput.value = keys.deepseekBaseUrl || '';
        if (geminiUrlInput) geminiUrlInput.value = keys.geminiBaseUrl || '';
        openaiUrlInput.value = keys.openaiBaseUrl || '';

        // Load sync status
        await updateSyncStatus();

        logger.info('Configuration loaded');
    } catch (error) {
        logger.error('Failed to load configuration:', error);
    }
}

function normalizeHistoryCacheLimit(raw: number | null | undefined): number {
    if (!Number.isFinite(raw)) {
        return 10000;
    }
    const rounded = Math.round(raw as number);
    return Math.min(MAX_HISTORY_CACHE_LIMIT, Math.max(MIN_HISTORY_CACHE_LIMIT, rounded));
}

/**
 * Load extension history settings from storage
 */
async function loadHistorySettings() {
    if (!historyCacheLimitInput) return;

    try {
        const settings = await extensionSettings.getValue();
        const value = normalizeHistoryCacheLimit(settings?.historyCacheLimit);
        historyCacheLimitInput.value = String(value);
        logger.info('History settings loaded:', value);
    } catch (error) {
        logger.error('Failed to load history settings:', error);
    }
}

/**
 * Save extension history settings to storage
 */
async function saveHistorySettings() {
    if (!saveHistorySettingsBtn || !historyCacheLimitInput) return;

    try {
        saveHistorySettingsBtn.disabled = true;
        saveHistorySettingsBtn.textContent = 'Saving...';
        if (historySettingsStatus) clearStatus(historySettingsStatus);

        const rawValue = parseInt(historyCacheLimitInput.value, 10);
        const historyCacheLimit = normalizeHistoryCacheLimit(rawValue);
        historyCacheLimitInput.value = String(historyCacheLimit);

        const current = await extensionSettings.getValue();
        await extensionSettings.setValue({
            autoSummarize: current?.autoSummarize ?? true,
            darkMode: current?.darkMode ?? true,
            searchHotkey: current?.searchHotkey ?? 'Ctrl+Q',
            maxSearchResults: current?.maxSearchResults ?? 20,
            historyCacheLimit,
        });

        // Apply new cap immediately in background
        await new Promise<void>((resolve) => {
            chrome.runtime.sendMessage(
                { type: MESSAGE_TYPES.HISTORY_ENFORCE_LIMIT },
                () => resolve()
            );
        });

        if (historySettingsStatus) {
            log(historySettingsStatus, `History cache limit saved: ${historyCacheLimit}`, 'success');
        }
        logger.info('History settings saved:', historyCacheLimit);
    } catch (error) {
        if (historySettingsStatus) {
            log(historySettingsStatus, `Failed to save: ${error}`, 'error');
        }
        logger.error('Failed to save history settings:', error);
    } finally {
        saveHistorySettingsBtn.disabled = false;
        saveHistorySettingsBtn.textContent = 'Save History Settings';
    }
}

/**
 * Update sync status display
 */
async function updateSyncStatus() {
    const status = await syncStatus.getValue();

    totalBookmarksEl.textContent = status.totalBookmarks.toString();
    summarizedCountEl.textContent = status.summarizedCount.toString();

    if (status.lastSync > 0) {
        const date = new Date(status.lastSync);
        lastSyncEl.textContent = date.toLocaleDateString();
    } else {
        lastSyncEl.textContent = 'Never';
    }
}

/**
 * Save configuration
 */
async function saveConfig() {
    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        // Save provider
        await activeProvider.setValue(providerSelect.value as any);

        // Save API keys
        await apiKeys.setValue({
            deepseek: deepseekKeyInput.value.trim(),
            gemini: geminiKeyInput.value.trim(),
            openai: openaiKeyInput.value.trim(),
            deepseekBaseUrl: deepseekUrlInput?.value.trim() || '',
            geminiBaseUrl: geminiUrlInput?.value.trim() || '',
            openaiBaseUrl: openaiUrlInput.value.trim(),
        });

        log(testResult, 'Configuration saved successfully!', 'success');
        logger.info('Configuration saved');
    } catch (error) {
        log(testResult, `Failed to save: ${error}`, 'error');
        logger.error('Failed to save configuration:', error);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Configuration';
    }
}

/**
 * Test API connection
 */
async function testConnection() {
    try {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        clearStatus(testResult);
        testResult.style.display = 'block';

        const provider = providerSelect.value as AIProviderType;
        log(testResult, `Testing ${provider} connection...`, 'info');

        // Get the API key for selected provider
        let apiKey = '';
        let baseUrl = '';

        switch (provider) {
            case AI_PROVIDERS.DEEPSEEK:
                apiKey = deepseekKeyInput.value.trim();
                baseUrl = deepseekUrlInput?.value.trim() || '';
                break;
            case AI_PROVIDERS.GEMINI:
                apiKey = geminiKeyInput.value.trim();
                baseUrl = geminiUrlInput?.value.trim() || '';
                break;
            case AI_PROVIDERS.OPENAI:
                apiKey = openaiKeyInput.value.trim();
                baseUrl = openaiUrlInput.value.trim();
                break;
        }

        if (!apiKey) {
            log(testResult, 'No API key provided for this provider', 'error');
            return;
        }

        const service = createAIService(provider, {
            apiKey,
            baseUrl: baseUrl || undefined,
        });

        const connected = await service.testConnection();
        if (connected) {
            log(testResult, 'Connection successful.', 'success');
        } else {
            log(testResult, 'Connection failed.', 'error');
        }
    } catch (error) {
        log(testResult, `Connection error: ${error}`, 'error');
    } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
    }
}

/**
 * Trigger full sync
 */
async function triggerSync() {
    try {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Syncing...';
        clearStatus(syncLog);

        log(syncLog, 'Starting full bookmark sync...', 'info');

        // Send message to background script
        chrome.runtime.sendMessage(
            { type: MESSAGE_TYPES.SYNC_FULL },
            (response) => {
                if (chrome.runtime.lastError) {
                    log(syncLog, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response) {
                    log(syncLog, `Sync complete!`, 'success');
                    log(syncLog, `Added: ${response.added}, Updated: ${response.updated}, Errors: ${response.errors}`, 'info');
                    updateSyncStatus();
                }
                syncBtn.disabled = false;
                syncBtn.textContent = 'Full Sync Now';
            }
        );
    } catch (error) {
        log(syncLog, `Sync failed: ${error}`, 'error');
        syncBtn.disabled = false;
        syncBtn.textContent = 'Full Sync Now';
    }
}

/**
 * Start AI Summarization
 */
async function triggerSummarization() {
    try {
        summarizeBtn.disabled = true;
        summarizeBtn.textContent = 'Starting...';

        log(syncLog, 'Starting AI summarization queue...', 'info');

        chrome.runtime.sendMessage(
            { type: MESSAGE_TYPES.SYNC_START_SUMMARIZATION },
            (response) => {
                if (chrome.runtime.lastError) {
                    log(syncLog, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response?.started) {
                    log(syncLog, 'AI summarization queue started!', 'success');
                    log(syncLog, 'Bookmarks will be summarized in the background.', 'info');
                }
                summarizeBtn.disabled = false;
                summarizeBtn.textContent = 'Start AI Summarization';
            }
        );
    } catch (error) {
        log(syncLog, `Failed to start summarization: ${error}`, 'error');
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = 'Start AI Summarization';
    }
}

/**
 * Test search
 */
async function testSearch() {
    const query = testQueryInput.value.trim();
    if (!query) {
        log(searchResults, 'Please enter a search query', 'error');
        return;
    }

    try {
        searchBtn.disabled = true;
        clearStatus(searchResults);
        searchResults.style.display = 'block';

        log(searchResults, `Searching for: "${query}"...`, 'info');

        chrome.runtime.sendMessage(
            {
                type: MESSAGE_TYPES.SEARCH_BOOKMARKS,
                data: { options: { query, limit: 10 } }
            },
            (response) => {
                console.log('[Options] Search response received:', response);
                if (chrome.runtime.lastError) {
                    log(searchResults, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response && response.results && response.results.length > 0) {
                    log(searchResults, `Found ${response.results.length} results:`, 'success');
                    response.results.forEach((r: any, i: number) => {
                        log(searchResults, `${i + 1}. [${r.matchType}] ${r.bookmark.originalTitle || r.bookmark.title}`, 'info');
                        log(searchResults, `   URL: ${r.bookmark.url}`, 'info');
                        if (r.bookmark.summary) {
                            log(searchResults, `   Summary: ${r.bookmark.summary.summaryText.substring(0, 100)}...`, 'info');
                        }
                    });
                } else {
                    log(searchResults, 'No results found', 'info');
                    console.log('[Options] Response structure:', JSON.stringify(response, null, 2));
                }
                searchBtn.disabled = false;
            }
        );
    } catch (error) {
        log(searchResults, `Search failed: ${error}`, 'error');
        searchBtn.disabled = false;
    }
}

// Event listeners
saveBtn.addEventListener('click', saveConfig);
testBtn.addEventListener('click', testConnection);
syncBtn.addEventListener('click', triggerSync);
summarizeBtn.addEventListener('click', triggerSummarization);
searchBtn.addEventListener('click', testSearch);
if (saveHistorySettingsBtn) {
    saveHistorySettingsBtn.addEventListener('click', saveHistorySettings);
}
if (historyCacheLimitInput) {
    historyCacheLimitInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveHistorySettings();
        }
    });
}
if (themeSelect) {
    themeSelect.addEventListener('change', (event) => {
        const mode = (event.target as HTMLSelectElement).value as ThemeMode;
        if (mode === 'auto' || mode === 'light' || mode === 'dark') {
            saveThemePreference(mode);
        }
    });
}
prefersDarkMedia.addEventListener('change', () => {
    if (currentThemeMode === 'auto') {
        applyTheme('auto');
    }
});
testQueryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') testSearch();
});

loadThemePreference();

// Initialize on load
document.addEventListener('DOMContentLoaded', loadConfig);
document.addEventListener('DOMContentLoaded', loadHistorySettings);

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
    loadConfig();
    loadHistorySettings();
}

// Listen for storage changes to auto-update UI
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['local:syncStatus']) {
        logger.info('Sync status changed, updating UI...');
        updateSyncStatus();
    }
});

// Auto-refresh stats periodically (every 3 seconds) when page is visible
setInterval(() => {
    if (document.visibilityState === 'visible') {
        updateSyncStatus();
    }
}, 3000);

// =====================================================
// Data Export/Import
// =====================================================

// DOM elements for data management
const exportDbBtn = document.getElementById('export-db-btn') as HTMLButtonElement;
const importDbBtn = document.getElementById('import-db-btn') as HTMLButtonElement;
const importDbFile = document.getElementById('import-db-file') as HTMLInputElement;
const importStatus = document.getElementById('import-status') as HTMLDivElement;

/**
 * Export database as .db file
 */
async function exportDatabase() {
    try {
        exportDbBtn.disabled = true;
        exportDbBtn.textContent = 'Exporting...';
        clearStatus(importStatus);

        log(importStatus, 'Exporting database...', 'info');

        chrome.runtime.sendMessage(
            { type: MESSAGE_TYPES.DATA_EXPORT_DB },
            (response) => {
                if (chrome.runtime.lastError) {
                    log(importStatus, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response?.success && response.data) {
                    // Convert plain Array back to Uint8Array (Chrome sendMessage uses JSON serialization)
                    const uint8Array = new Uint8Array(response.data);
                    const blob = new Blob([uint8Array], { type: 'application/x-sqlite3' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ai-bookmark-brain-backup-${Date.now()}.db`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    log(importStatus, `Database exported successfully! (${(uint8Array.byteLength / 1024).toFixed(1)} KB)`, 'success');
                } else {
                    log(importStatus, `Export failed: ${response?.error || 'Unknown error'}`, 'error');
                }
                exportDbBtn.disabled = false;
                exportDbBtn.textContent = 'Export Database (.db)';
            }
        );
    } catch (error) {
        log(importStatus, `Export failed: ${error}`, 'error');
        exportDbBtn.disabled = false;
        exportDbBtn.textContent = 'Export Database (.db)';
    }
}



/**
 * Import database from .db file
 */
async function handleDatabaseImport(file: File) {
    try {
        importDbBtn.disabled = true;
        importDbBtn.textContent = 'Importing...';
        clearStatus(importStatus);

        log(importStatus, `Importing database from: ${file.name}`, 'info');

        // Validate file extension
        const validExtensions = ['.db', '.sqlite', '.sqlite3'];
        const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
        if (!hasValidExt) {
            log(importStatus, 'Invalid file type. Please select a .db or .sqlite file.', 'error');
            return;
        }

        // Read file as ArrayBuffer
        const buffer = await file.arrayBuffer();
        log(importStatus, `File size: ${(buffer.byteLength / 1024).toFixed(1)} KB`, 'info');

        // Convert ArrayBuffer to plain Array for JSON serialization (Chrome sendMessage limitation)
        const dataArray = Array.from(new Uint8Array(buffer));
        log(importStatus, `Sending ${dataArray.length} bytes to background...`, 'info');

        // Send to background for import
        chrome.runtime.sendMessage(
            {
                type: MESSAGE_TYPES.DATA_IMPORT_DB,
                data: { buffer: dataArray }
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    log(importStatus, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response?.success && response.result) {
                    const result = response.result;
                    log(importStatus, `Import completed!`, 'success');
                    log(importStatus, `  Inserted: ${result.inserted}`, 'info');
                    log(importStatus, `  Updated: ${result.updated}`, 'info');
                    log(importStatus, `  Skipped (duplicates): ${result.skipped}`, 'info');
                    if (result.errors?.length > 0) {
                        log(importStatus, `  Errors: ${result.errors.length}`, 'error');
                    }
                    // Refresh stats
                    updateSyncStatus();
                } else {
                    log(importStatus, `Import failed: ${response?.error || 'Unknown error'}`, 'error');
                }
                importDbBtn.disabled = false;
                importDbBtn.textContent = 'Import Database';
            }
        );
    } catch (error) {
        log(importStatus, `Import failed: ${error}`, 'error');
        importDbBtn.disabled = false;
        importDbBtn.textContent = 'Import Database';
    }
}



// Event listeners for export/import
if (exportDbBtn) {
    exportDbBtn.addEventListener('click', exportDatabase);
}
if (importDbBtn && importDbFile) {
    importDbBtn.addEventListener('click', () => importDbFile.click());
    importDbFile.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) handleDatabaseImport(file);
    });
}

// =====================================================
// Font Settings
// =====================================================

/**
 * Load font settings from storage
 */
async function loadFontSettings() {
    try {
        const settings = await uiSettings.getValue();
        const fontSizes = settings?.fontSizes || DEFAULT_FONT_SIZES;

        if (fontSearchInputEl) fontSearchInputEl.value = fontSizes.searchInput.toString();
        if (fontResultTitleEl) fontResultTitleEl.value = fontSizes.resultTitle.toString();
        if (fontResultUrlEl) fontResultUrlEl.value = fontSizes.resultUrl.toString();
        if (fontResultBadgeEl) fontResultBadgeEl.value = fontSizes.resultBadge.toString();
        if (fontSummaryTitleEl) fontSummaryTitleEl.value = fontSizes.summaryTitle.toString();
        if (fontSummaryTextEl) fontSummaryTextEl.value = fontSizes.summaryText.toString();
        if (fontSummaryLabelEl) fontSummaryLabelEl.value = fontSizes.summaryLabel.toString();
        if (fontMetadataTextEl) fontMetadataTextEl.value = fontSizes.metadataText.toString();

        logger.info('Font settings loaded');
    } catch (error) {
        logger.error('Failed to load font settings:', error);
    }
}

/**
 * Save font settings to storage
 */
async function saveFontSettings() {
    try {
        if (!saveUiBtn) return;

        saveUiBtn.disabled = true;
        saveUiBtn.textContent = 'Saving...';
        if (uiStatus) clearStatus(uiStatus);

        const fontSizes: FontSettings = {
            searchInput: parseInt(fontSearchInputEl?.value) || DEFAULT_FONT_SIZES.searchInput,
            resultTitle: parseInt(fontResultTitleEl?.value) || DEFAULT_FONT_SIZES.resultTitle,
            resultUrl: parseInt(fontResultUrlEl?.value) || DEFAULT_FONT_SIZES.resultUrl,
            resultBadge: parseInt(fontResultBadgeEl?.value) || DEFAULT_FONT_SIZES.resultBadge,
            summaryTitle: parseInt(fontSummaryTitleEl?.value) || DEFAULT_FONT_SIZES.summaryTitle,
            summaryText: parseInt(fontSummaryTextEl?.value) || DEFAULT_FONT_SIZES.summaryText,
            summaryLabel: parseInt(fontSummaryLabelEl?.value) || DEFAULT_FONT_SIZES.summaryLabel,
            metadataText: parseInt(fontMetadataTextEl?.value) || DEFAULT_FONT_SIZES.metadataText,
        };

        await uiSettings.setValue({ fontSizes });
        log(uiStatus, 'UI settings saved successfully!', 'success');
        logger.info('Font settings saved:', fontSizes);
    } catch (error) {
        log(uiStatus, `Failed to save: ${error}`, 'error');
        logger.error('Failed to save font settings:', error);
    } finally {
        if (saveUiBtn) {
            saveUiBtn.disabled = false;
            saveUiBtn.textContent = 'Save UI Settings';
        }
    }
}

/**
 * Reset font settings to defaults
 */
async function resetFontSettings() {
    try {
        if (!resetFontsBtn) return;

        resetFontsBtn.disabled = true;
        resetFontsBtn.textContent = 'Resetting...';
        if (uiStatus) clearStatus(uiStatus);

        await uiSettings.setValue({ fontSizes: { ...DEFAULT_FONT_SIZES } });
        await loadFontSettings();

        log(uiStatus, 'Font settings reset to defaults!', 'success');
        logger.info('Font settings reset to defaults');
    } catch (error) {
        log(uiStatus, `Failed to reset: ${error}`, 'error');
        logger.error('Failed to reset font settings:', error);
    } finally {
        if (resetFontsBtn) {
            resetFontsBtn.disabled = false;
            resetFontsBtn.textContent = 'Reset to Defaults';
        }
    }
}

// Event listeners for font settings
if (saveUiBtn) {
    saveUiBtn.addEventListener('click', saveFontSettings);
}
if (resetFontsBtn) {
    resetFontsBtn.addEventListener('click', resetFontSettings);
}

// Load font settings on page load
if (document.readyState !== 'loading') {
    loadFontSettings();
} else {
    document.addEventListener('DOMContentLoaded', loadFontSettings);
}

// =====================================================
// Search Strategy Priority Configuration
// =====================================================

// Search config and storage imported at top of file

// DOM elements for search strategies
const strategiesList = document.getElementById('search-strategies-list') as HTMLDivElement;
const saveStrategiesBtn = document.getElementById('save-strategies-btn') as HTMLButtonElement;
const resetStrategiesBtn = document.getElementById('reset-strategies-btn') as HTMLButtonElement;
const strategiesStatus = document.getElementById('strategies-status') as HTMLDivElement;

// Current strategies state
let currentStrategies: SearchStrategy[] = [];

/**
 * Load search strategies from storage
 */
async function loadSearchStrategiesUI() {
    try {
        const saved = await searchStrategyOrder.getValue();
        currentStrategies = loadSearchStrategies(saved);
        renderStrategiesList();
        logger.info('Search strategies loaded:', currentStrategies.length);
    } catch (error) {
        logger.error('Failed to load search strategies:', error);
        currentStrategies = [...DEFAULT_SEARCH_STRATEGIES];
        renderStrategiesList();
    }
}

/**
 * Render the sortable strategies list
 */
function renderStrategiesList() {
    if (!strategiesList) return;

    strategiesList.textContent = '';

    currentStrategies.forEach((strategy, index) => {
        const item = document.createElement('div');
        item.className = 'sortable-item';
        item.draggable = true;
        item.dataset.id = strategy.id;
        item.dataset.index = String(index);
        item.setAttribute('role', 'listitem');

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '::';

        const label = document.createElement('span');
        label.className = 'strategy-label';
        label.textContent = strategy.labelZh || strategy.label;

        const type = document.createElement('span');
        type.className = 'strategy-type';
        type.textContent = getMatchTypeLabel(strategy.matchType);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'form-check-input m-0';
        checkbox.checked = strategy.enabled;
        checkbox.dataset.id = strategy.id;
        checkbox.title = 'Enable or disable';

        item.append(handle, label, type, checkbox);
        strategiesList.appendChild(item);
    });

    // Initialize drag and drop
    initDragAndDrop();

    // Add checkbox listeners
    strategiesList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const id = (e.target as HTMLInputElement).dataset.id;
            const checked = (e.target as HTMLInputElement).checked;
            const strategy = currentStrategies.find(s => s.id === id);
            if (strategy) {
                strategy.enabled = checked;
            }
        });
    });
}

/**
 * Get human-readable match type label
 */
function getMatchTypeLabel(matchType: string): string {
    switch (matchType) {
        case 'exact_case': return 'Exact';
        case 'exact': return 'Case-insensitive';
        case 'pinyin': return 'Pinyin';
        case 'fuzzy': return 'Fuzzy';
        default: return matchType;
    }
}

/**
 * Initialize HTML5 drag and drop
 */
function initDragAndDrop() {
    if (!strategiesList) return;

    const items = strategiesList.querySelectorAll('.sortable-item');
    let draggedItem: HTMLElement | null = null;

    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = e.target as HTMLElement;
            draggedItem.classList.add('dragging');
            // Set drag data for Firefox compatibility
            (e as DragEvent).dataTransfer?.setData('text/plain', '');
        });

        item.addEventListener('dragend', () => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                updateStrategiesFromDOM();
            }
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = (e.target as HTMLElement).closest('.sortable-item') as HTMLElement;
            if (target && draggedItem && target !== draggedItem) {
                const box = target.getBoundingClientRect();
                const offset = (e as DragEvent).clientY - box.top - box.height / 2;
                if (offset < 0) {
                    strategiesList.insertBefore(draggedItem, target);
                } else {
                    strategiesList.insertBefore(draggedItem, target.nextSibling);
                }
            }
        });
    });
}

/**
 * Update currentStrategies array from DOM order
 */
function updateStrategiesFromDOM() {
    if (!strategiesList) return;

    const items = strategiesList.querySelectorAll('.sortable-item');
    const newOrder: SearchStrategy[] = [];

    items.forEach(item => {
        const id = (item as HTMLElement).dataset.id;
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        const strategy = currentStrategies.find(s => s.id === id);
        if (strategy) {
            newOrder.push({
                ...strategy,
                enabled: checkbox?.checked ?? true,
            });
        }
    });

    currentStrategies = newOrder;
}

/**
 * Save search strategies to storage
 */
async function saveSearchStrategies() {
    try {
        if (!saveStrategiesBtn) return;

        saveStrategiesBtn.disabled = true;
        saveStrategiesBtn.textContent = 'Saving...';
        if (strategiesStatus) clearStatus(strategiesStatus);

        // Update from DOM first
        updateStrategiesFromDOM();

        // Save to storage
        await searchStrategyOrder.setValue({
            strategies: currentStrategies.map(s => ({ id: s.id, enabled: s.enabled })),
        });

        log(strategiesStatus, 'Search priority saved.', 'success');
        logger.info('Search strategies saved:', currentStrategies.length);
    } catch (error) {
        log(strategiesStatus, `Save failed: ${error}`, 'error');
        logger.error('Failed to save search strategies:', error);
    } finally {
        if (saveStrategiesBtn) {
            saveStrategiesBtn.disabled = false;
            saveStrategiesBtn.textContent = 'Save Priority';
        }
    }
}

/**
 * Reset search strategies to defaults
 */
async function resetSearchStrategies() {
    try {
        if (!resetStrategiesBtn) return;

        resetStrategiesBtn.disabled = true;
        resetStrategiesBtn.textContent = 'Resetting...';
        if (strategiesStatus) clearStatus(strategiesStatus);

        // Clear storage
        await searchStrategyOrder.setValue({ strategies: [] });

        // Reload defaults
        currentStrategies = [...DEFAULT_SEARCH_STRATEGIES];
        renderStrategiesList();

        log(strategiesStatus, 'Search priority reset to defaults.', 'success');
        logger.info('Search strategies reset to defaults');
    } catch (error) {
        log(strategiesStatus, `Reset failed: ${error}`, 'error');
        logger.error('Failed to reset search strategies:', error);
    } finally {
        if (resetStrategiesBtn) {
            resetStrategiesBtn.disabled = false;
            resetStrategiesBtn.textContent = 'Reset';
        }
    }
}

// Event listeners for search strategies
if (saveStrategiesBtn) {
    saveStrategiesBtn.addEventListener('click', saveSearchStrategies);
}
if (resetStrategiesBtn) {
    resetStrategiesBtn.addEventListener('click', resetSearchStrategies);
}

// Load strategies on page load
if (document.readyState !== 'loading') {
    loadSearchStrategiesUI();
} else {
    document.addEventListener('DOMContentLoaded', loadSearchStrategiesUI);
}

// =====================================================
// Refetch Garbled Content
// =====================================================

const refetchGarbledBtn = document.getElementById('refetch-garbled-btn') as HTMLButtonElement;

// Progress listener for real-time updates
let refetchProgressListener: ((message: any) => void) | null = null;

/**
 * Start listening for refetch progress updates
 */
function startRefetchProgressListener() {
    if (refetchProgressListener) return;

    refetchProgressListener = (message: any) => {
        if (message.type !== MESSAGE_TYPES.REFETCH_GARBLED_PROGRESS) return;

        const progress = message.data;
        if (!progress) return;

        // Clear previous content and show progress
        clearStatus(importStatus);

        if (progress.phase === 'scanning') {
            log(importStatus, 'Scan complete.', 'success');
            log(importStatus, `Need to process: ${progress.total} bookmarks`, 'info');
            if (progress.skippedDead > 0) {
                log(importStatus, `Skipped dead websites: ${progress.skippedDead}`, 'info');
            }
            log(importStatus, 'Starting processing...', 'info');
        } else if (progress.phase === 'processing') {
            log(importStatus, 'Processing...', 'info');
            log(importStatus, `Remaining: ${progress.remaining} / ${progress.total}`, 'info');
            log(importStatus, `Success: ${progress.success}`, 'success');
            if (progress.failed > 0) {
                log(importStatus, `Failed: ${progress.failed}`, 'error');
            }
            if (progress.currentTitle) {
                log(importStatus, `Current: ${progress.currentTitle.substring(0, 40)}...`, 'info');
            }
        } else if (progress.phase === 'complete') {
            log(importStatus, 'Complete!', 'success');
            log(importStatus, `Total: ${progress.total} bookmarks`, 'info');
            log(importStatus, `Success: ${progress.success}`, 'success');
            if (progress.failed > 0) {
                log(importStatus, `Failed: ${progress.failed}`, 'error');
            }
            if (progress.skippedDead > 0) {
                log(importStatus, `Skipped dead websites: ${progress.skippedDead}`, 'info');
            }
        }
    };

    chrome.runtime.onMessage.addListener(refetchProgressListener);
}

/**
 * Stop listening for refetch progress updates
 */
function stopRefetchProgressListener() {
    if (refetchProgressListener) {
        chrome.runtime.onMessage.removeListener(refetchProgressListener);
        refetchProgressListener = null;
    }
}

/**
 * Trigger refetch of garbled/empty content
 */
async function triggerRefetchGarbled() {
    if (!refetchGarbledBtn) return;

    try {
        refetchGarbledBtn.disabled = true;
        refetchGarbledBtn.textContent = 'Scanning...';
        clearStatus(importStatus);

        log(importStatus, 'Scanning bookmarks...', 'info');

        // Start listening for progress updates
        startRefetchProgressListener();

        chrome.runtime.sendMessage(
            { type: MESSAGE_TYPES.REFETCH_GARBLED_CONTENT },
            (response) => {
                // Stop listening when done
                stopRefetchProgressListener();

                if (chrome.runtime.lastError) {
                    log(importStatus, `Error: ${chrome.runtime.lastError.message}`, 'error');
                } else if (response?.success && response.result) {
                    const r = response.result;
                    // Final summary (progress listener should have shown intermediate updates)
                    if (r.errors && r.errors.length > 0 && r.errors.length <= 5) {
                        log(importStatus, 'Error details:', 'error');
                        r.errors.forEach((err: string) => {
                            log(importStatus, `  - ${err}`, 'error');
                        });
                    } else if (r.errors && r.errors.length > 5) {
                        log(importStatus, `(${r.errors.length} errors, check console for details)`, 'error');
                        logger.warn('Refetch errors:', r.errors);
                    }
                    // Refresh sync status
                    updateSyncStatus();
                } else {
                    log(importStatus, `Failed: ${response?.error || 'Unknown error'}`, 'error');
                }
                refetchGarbledBtn.disabled = false;
                refetchGarbledBtn.textContent = 'Refetch Garbled Content';
            }
        );
    } catch (error) {
        stopRefetchProgressListener();
        log(importStatus, `Failed: ${error}`, 'error');
        refetchGarbledBtn.disabled = false;
        refetchGarbledBtn.textContent = 'Refetch Garbled Content';
    }
}

// Event listener for refetch button
if (refetchGarbledBtn) {
    refetchGarbledBtn.addEventListener('click', triggerRefetchGarbled);
}

logger.info('Options page script loaded');
