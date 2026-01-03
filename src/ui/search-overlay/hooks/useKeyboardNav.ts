/**
 * AI Bookmark Brain - useKeyboardNav Hook
 * Handles keyboard navigation for search results
 */

import { useCallback, useEffect } from 'react';
import type { SearchResult } from '../../../shared/types';

export interface UseKeyboardNavOptions {
    results: SearchResult[];
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
    onOpenResult: (result: SearchResult) => void;
    onClose: () => void;
    inputRef: React.RefObject<HTMLInputElement>;
    containerRef?: React.RefObject<HTMLElement>;
}

export function useKeyboardNav({
    results,
    selectedIndex,
    onSelectIndex,
    onOpenResult,
    onClose,
    inputRef,
    containerRef
}: UseKeyboardNavOptions) {
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (results.length > 0) {
                    onSelectIndex(Math.min(selectedIndex + 1, results.length - 1));
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (results.length > 0) {
                    onSelectIndex(Math.max(selectedIndex - 1, 0));
                }
                break;

            case 'Enter':
                e.preventDefault();
                if (results[selectedIndex]) {
                    onOpenResult(results[selectedIndex]);
                }
                break;

            case 'Escape':
                e.preventDefault();
                onClose();
                break;

            case 'Tab':
                // Prevent focus from leaving the overlay
                e.preventDefault();
                break;
        }
    }, [results, selectedIndex, onSelectIndex, onOpenResult, onClose]);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, [inputRef]);

    // Scroll selected item into view
    // Use containerRef to query within the Shadow DOM, fallback to document
    useEffect(() => {
        const container = containerRef?.current ?? document;
        const selectedElement = container.querySelector(`[data-result-index="${selectedIndex}"]`);
        selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [selectedIndex, containerRef]);

    return { handleKeyDown };
}
