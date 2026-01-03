/**
 * AI Bookmark Brain - Search Input Component
 * Text input for search queries with @category autocomplete
 */

import React, { useState, useCallback, useRef } from 'react';
import type { SearchInputProps } from '../types';
import { CategorySuggestions, shouldShowCategorySuggestions, buildCategoryQuery } from './CategorySuggestions';
import type { Category } from '../../../shared/types';

export function SearchInput({
    value,
    onChange,
    onKeyDown,
    placeholder = 'Search bookmarks... (@类别 filter)'
}: SearchInputProps) {
    const [categorySelectedIndex, setCategorySelectedIndex] = useState(-1);
    const [categoryCount, setCategoryCount] = useState(0);
    // Use ref instead of state to avoid stale closures in keyboard handler
    const filteredCategoriesRef = useRef<Category[]>([]);

    const showCategorySuggestions = shouldShowCategorySuggestions(value);

    const handleCategorySelect = useCallback((category: Category) => {
        onChange(buildCategoryQuery(category));
        setCategorySelectedIndex(-1);
        filteredCategoriesRef.current = [];
    }, [onChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Only stop propagation for printable characters to prevent host page interference
        // Let Escape and other control keys propagate
        if (e.key.length === 1) {
            e.stopPropagation();
        }

        // Handle category suggestions navigation when visible
        if (showCategorySuggestions && categoryCount > 0) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setCategorySelectedIndex(prev =>
                        prev < categoryCount - 1 ? prev + 1 : prev
                    );
                    return;
                case 'ArrowUp':
                    e.preventDefault();
                    setCategorySelectedIndex(prev => prev > 0 ? prev - 1 : -1);
                    return;
                case 'Enter':
                    // Use ref for synchronous access to latest filtered categories
                    if (categorySelectedIndex >= 0 && filteredCategoriesRef.current[categorySelectedIndex]) {
                        e.preventDefault();
                        handleCategorySelect(filteredCategoriesRef.current[categorySelectedIndex]);
                        return;
                    }
                    break;
                case 'Escape':
                    // Close category suggestions and stop propagation
                    // so SearchOverlay doesn't close
                    e.preventDefault();
                    e.stopPropagation();
                    setCategorySelectedIndex(-1);
                    // Clear the @ prefix to close suggestions
                    onChange('');
                    return;
            }
        }

        // Always let parent handle other keys (including Escape when no suggestions)
        onKeyDown?.(e);
    }, [showCategorySuggestions, categoryCount, categorySelectedIndex, handleCategorySelect, onKeyDown]);

    return (
        <div className="relative flex-1">
            <input
                type="text"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setCategorySelectedIndex(-1);
                }}
                onKeyDown={handleKeyDown}
                onKeyUp={(e) => e.stopPropagation()}
                onKeyPress={(e) => e.stopPropagation()}
                placeholder={placeholder}
                className="
                    w-full
                    px-4 py-3 
                    border-none 
                    bg-[var(--bg-primary)] 
                    text-[var(--text-primary)] 
                    leading-normal
                    outline-none
                    placeholder:text-[var(--text-secondary)]
                    font-[var(--font-family-segoe)]
                "
                style={{ fontSize: 'var(--font-search-input)' }}
                autoFocus
            />

            <CategorySuggestions
                query={value}
                isOpen={showCategorySuggestions}
                selectedIndex={categorySelectedIndex}
                onSelect={handleCategorySelect}
                onClose={() => setCategorySelectedIndex(-1)}
                onCountChange={setCategoryCount}
                onFilteredChange={(filtered) => { filteredCategoriesRef.current = filtered; }}
            />
        </div>
    );
}

