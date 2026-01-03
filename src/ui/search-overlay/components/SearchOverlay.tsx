/**
 * AI Bookmark Brain - Search Overlay Main Component
 * Main container with resizable panels (left: results, right: summary)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { SearchInput } from './SearchInput';
import { FilterDropdown } from './FilterDropdown';
import { ResultsList, NoResults } from './ResultsList';
import { SummaryPanel } from './SummaryPanel';
import { HistoryPanel } from './HistoryPanel';
import { useSearch } from '../hooks';
import { useCategoryStore } from '../stores';
import { FontSettingsProvider, useFontSettings } from '../context';
import type { SearchResult, HistorySearchResult, BookmarkWithDetails } from '../../../shared/types';

export interface SearchOverlayProps {
    onClose: () => void;
}

/**
 * Inner component that uses font settings context
 */
function SearchOverlayInner({ onClose }: SearchOverlayProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const { cssVariables } = useFontSettings();

    // Initialize category store on mount
    const initializeCategories = useCategoryStore(state => state.initialize);
    useEffect(() => {
        initializeCategories();
    }, [initializeCategories]);

    const {
        query,
        setQuery,
        results,
        setResults,
        historyResults,
        searchMode,
        isLoading,
        selectedCategoryIds,
        toggleCategory,
        recordSelection
    } = useSearch();

    // Handle bookmark update (e.g., when category changes in SummaryPanel)
    const handleBookmarkUpdate = useCallback((updatedBookmark: BookmarkWithDetails) => {
        setResults(prevResults =>
            prevResults.map(result =>
                result.bookmark.id === updatedBookmark.id
                    ? { ...result, bookmark: updatedBookmark }
                    : result
            )
        );
    }, [setResults]);

    // Open result handlers - defined first so handleKeyDown can use them
    const handleOpenResult = useCallback((result: SearchResult) => {
        recordSelection(result.bookmark.id);
        window.open(result.bookmark.url, '_blank');
        onClose();
    }, [recordSelection, onClose]);

    const handleOpenHistoryResult = useCallback((result: HistorySearchResult) => {
        window.open(result.history.url, '_blank');
        onClose();
    }, [onClose]);

    // Custom keyboard handler that supports both bookmark and history modes
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (searchMode === 'history') {
                    if (historyResults.length > 0) {
                        setSelectedIndex(prev => Math.min(prev + 1, historyResults.length - 1));
                    }
                } else {
                    if (results.length > 0) {
                        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
                    }
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;

            case 'Enter':
                e.preventDefault();
                // Use functional update to get latest selectedIndex
                setSelectedIndex(currentIndex => {
                    if (searchMode === 'history') {
                        if (historyResults[currentIndex]) {
                            handleOpenHistoryResult(historyResults[currentIndex]);
                        }
                    } else {
                        if (results[currentIndex]) {
                            handleOpenResult(results[currentIndex]);
                        }
                    }
                    return currentIndex; // Don't change index
                });
                break;

            case 'Escape':
                e.preventDefault();
                onClose();
                break;

            case 'Tab':
                e.preventDefault();
                break;
        }
    }, [searchMode, historyResults, results, onClose, handleOpenResult, handleOpenHistoryResult]);

    // Reset selected index when results change
    React.useEffect(() => {
        setSelectedIndex(0);
    }, [results, historyResults, searchMode]);

    // Scroll selected item into view when selection changes
    useEffect(() => {
        const container = overlayRef.current;
        if (!container) return;

        // Query within the overlay (which contains the shadow DOM content)
        const selectedElement = container.querySelector(`[data-result-index="${selectedIndex}"]`);
        if (selectedElement) {
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }, [selectedIndex]);

    // Get currently selected item based on search mode
    const currentResults = searchMode === 'history' ? historyResults : results;
    const selectedResult = results[selectedIndex];
    const selectedBookmark = selectedResult?.bookmark ?? null;
    const selectedHistory = historyResults[selectedIndex]?.history ?? null;

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        // Close only if clicked directly on backdrop
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    return (
        <div
            ref={overlayRef}
            className="
        fixed inset-0 z-[2147483647]
        flex items-start justify-center
        pt-[10vh]
        bg-black/50
        font-[var(--font-family-segoe)]
      "
            style={cssVariables as React.CSSProperties}
            onClick={handleBackdropClick}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
        >
            {/* Main overlay container - resizable */}
            <div
                className="
          w-[850px] max-w-[90vw]
          h-[60vh] max-h-[600px] min-h-[300px]
          flex flex-col
          bg-[var(--bg-primary)]
          border border-[var(--border)]
          shadow-[0_8px_24px_rgba(0,0,0,0.25)]
          resize
          overflow-hidden
        "
                onClick={(e) => e.stopPropagation()}
            >
                {/* Search header */}
                <div className="flex border-b border-b-[var(--border)] flex-shrink-0">
                    <SearchInput
                        value={query}
                        onChange={setQuery}
                        onKeyDown={handleKeyDown}
                    />
                    <FilterDropdown
                        selectedCategoryIds={selectedCategoryIds}
                        onToggleCategory={toggleCategory}
                    />
                </div>

                {/* Main content - resizable panels */}
                <PanelGroup direction="horizontal" className="flex-1 min-h-0">
                    {/* Left panel: Results */}
                    <Panel defaultSize={60} minSize={30} className="flex flex-col">
                        {isLoading && (
                            <div className="
                px-3 py-2 
                text-xs 
                text-[var(--text-secondary)] 
                bg-[var(--bg-secondary)]
                border-b border-b-[var(--border)]
              ">
                                Searching...
                            </div>
                        )}

                        {searchMode === 'history' ? (
                            // History search results
                            historyResults.length > 0 ? (
                                <div className="flex-1 overflow-y-auto">
                                    {historyResults.map((result, index) => (
                                        <div
                                            key={result.history.id}
                                            data-result-index={index}
                                            className={`
                                                px-3 py-2 cursor-pointer border-b border-b-[var(--border)]
                                                ${index === selectedIndex ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--bg-hover)]'}
                                            `}
                                            onClick={() => setSelectedIndex(index)}
                                            onDoubleClick={() => handleOpenHistoryResult(result)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {result.history.faviconUrl && (
                                                    <img
                                                        src={result.history.faviconUrl}
                                                        alt=""
                                                        className="w-4 h-4 flex-shrink-0"
                                                        onError={(e) => (e.currentTarget.style.display = 'none')}
                                                    />
                                                )}
                                                <span
                                                    className={`truncate font-medium ${index === selectedIndex ? '' : 'text-[var(--text-primary)]'}`}
                                                    style={{ fontSize: 'var(--font-result-title)' }}
                                                >
                                                    {result.history.title || 'Untitled'}
                                                </span>
                                            </div>
                                            <div
                                                className={`truncate mt-0.5 ${index === selectedIndex ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}
                                                style={{ fontSize: 'var(--font-result-url)' }}
                                            >
                                                {result.history.url}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <NoResults query={query} />
                            )
                        ) : (
                            // Bookmark search results
                            results.length > 0 ? (
                                <ResultsList
                                    results={results}
                                    selectedIndex={selectedIndex}
                                    onSelectIndex={setSelectedIndex}
                                    onOpenResult={handleOpenResult}
                                />
                            ) : (
                                <NoResults query={query} />
                            )
                        )}
                    </Panel>

                    {/* Resize handle */}
                    <PanelResizeHandle className="
            w-1 
            bg-[var(--border)] 
            hover:bg-[var(--accent)] 
            cursor-col-resize
            transition-colors duration-150
          " />

                    {/* Right panel: Summary or History Details */}
                    <Panel defaultSize={40} minSize={20}>
                        {searchMode === 'history' ? (
                            <HistoryPanel history={selectedHistory} />
                        ) : (
                            <SummaryPanel bookmark={selectedBookmark} onBookmarkUpdate={handleBookmarkUpdate} />
                        )}
                    </Panel>
                </PanelGroup>

                {/* Footer with keyboard hints */}
                <div className="
          flex-shrink-0
          px-3 py-1.5
          border-t border-t-[var(--border)]
          bg-[var(--bg-secondary)]
          text-[10px] text-[var(--text-secondary)]
          flex items-center gap-4
        ">
                    <span><kbd className="px-1 bg-[var(--bg-hover)]">↑↓</kbd> Navigate</span>
                    <span><kbd className="px-1 bg-[var(--bg-hover)]">Enter</kbd> Open</span>
                    <span><kbd className="px-1 bg-[var(--bg-hover)]">Esc</kbd> Close</span>
                    {currentResults.length > 0 && (
                        <span className="ml-auto">
                            {currentResults.length} {searchMode === 'history' ? '历史记录' : 'results'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Main export with context provider
 */
export function SearchOverlay(props: SearchOverlayProps) {
    return (
        <FontSettingsProvider>
            <SearchOverlayInner {...props} />
        </FontSettingsProvider>
    );
}
