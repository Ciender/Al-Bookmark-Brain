/**
 * AI Bookmark Brain - Results List Component
 * Scrollable list of search results with keyboard navigation
 */

import React from 'react';
import { ResultItem } from './ResultItem';
import type { ResultsListProps } from '../types';

export function ResultsList({
    results,
    selectedIndex,
    onSelectIndex,
    onOpenResult
}: ResultsListProps) {
    if (results.length === 0) {
        return null;
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {results.map((result, index) => (
                <ResultItem
                    key={result.bookmark.id}
                    result={result}
                    index={index}
                    isSelected={index === selectedIndex}
                    onClick={() => onSelectIndex(index)}
                    onDoubleClick={() => onOpenResult(result)}
                />
            ))}
        </div>
    );
}

export function NoResults({ query }: { query: string }) {
    return (
        <div className="
      flex-1 
      flex items-center justify-center 
      text-[var(--text-secondary)] 
      text-sm
      font-[var(--font-family-segoe)]
    ">
            {query ? 'No results found' : 'Type to search bookmarks'}
        </div>
    );
}
