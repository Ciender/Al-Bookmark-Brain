/**
 * AI Bookmark Brain - CategorySuggestions Component
 * Dropdown suggestions for @category search prefix in search box
 * Uses Zustand store for centralized state management
 */

import React, { useState, useEffect, useCallback } from 'react';
import pinyinMatch from 'pinyin-match';
import { useCategoryStore } from '../stores';
import type { Category } from '../../../shared/types';

interface CategorySuggestionsProps {
    query: string;                          // Current search input
    isOpen: boolean;                        // Whether dropdown is visible
    selectedIndex: number;                  // Currently highlighted index
    onSelect: (category: Category) => void; // Called when category is selected
    onClose: () => void;                    // Called to close dropdown
    onCountChange?: (count: number) => void; // Report suggestion count for keyboard nav
    onFilteredChange?: (filtered: Category[]) => void; // Report filtered list for Enter key
}

/**
 * Extract the partial category name after @
 * e.g., "@服务" => "服务", "@" => ""
 */
function extractCategoryPrefix(query: string): string | null {
    const match = query.match(/^[@＠]([^\s]*)$/);
    if (match) {
        return match[1] || '';
    }
    return null;
}

export function CategorySuggestions({
    query,
    isOpen,
    selectedIndex,
    onSelect,
    onClose,
    onCountChange,
    onFilteredChange,
}: CategorySuggestionsProps) {
    const [filtered, setFiltered] = useState<Category[]>([]);

    // Use Zustand store - categories initialized by SearchOverlay
    const categories = useCategoryStore(state => state.categories);

    // Filter when query or categories change
    useEffect(() => {
        const prefix = extractCategoryPrefix(query);

        if (prefix === null) {
            setFiltered([]);
            onCountChange?.(0);
            onFilteredChange?.([]);
            return;
        }

        if (prefix === '') {
            // Show all categories
            setFiltered(categories);
            onCountChange?.(categories.length);
            onFilteredChange?.(categories);
        } else {
            // Filter by prefix
            const lowerPrefix = prefix.toLowerCase();
            const matches = categories.filter(cat => {
                if (cat.name.toLowerCase().startsWith(lowerPrefix)) return true;
                if (cat.namePinyin?.toLowerCase().startsWith(lowerPrefix)) return true;
                if (cat.name.toLowerCase().includes(lowerPrefix)) return true;
                try {
                    if (pinyinMatch.match(cat.name, prefix)) return true;
                } catch { /* ignore */ }
                return false;
            });
            setFiltered(matches);
            onCountChange?.(matches.length);
            onFilteredChange?.(matches);
        }
    }, [query, categories, onCountChange, onFilteredChange]);

    const handleSelect = useCallback((category: Category) => {
        onSelect(category);
        onClose();
    }, [onSelect, onClose]);

    // Don't render if not applicable
    if (!isOpen || filtered.length === 0) {
        return null;
    }

    return (
        <div
            className="
                absolute left-0 right-0 top-full
                bg-[var(--bg-primary)]
                border border-[var(--border)]
                border-t-0
                shadow-lg
                max-h-[200px]
                overflow-y-auto
                z-[2147483647]
            "
        >
            <div className="px-3 py-1.5 text-[10px] text-[var(--text-secondary)] uppercase tracking-wide border-b border-[var(--border)]">
                Select Category
            </div>
            {filtered.map((category, index) => (
                <div
                    key={category.id}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(category);
                    }}
                    className={`
                        flex items-center gap-2
                        px-3 py-2
                        cursor-pointer
                        text-sm
                        ${index === selectedIndex
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}
                    `}
                >
                    <span
                        className="w-2 h-2 flex-shrink-0"
                        style={{ backgroundColor: category.color || '#808080' }}
                    />
                    <span>@{category.name}</span>
                </div>
            ))}
        </div>
    );
}

/**
 * Check if query should trigger category suggestions
 */
export function shouldShowCategorySuggestions(query: string): boolean {
    return extractCategoryPrefix(query) !== null;
}

/**
 * Build the replacement query when category is selected
 */
export function buildCategoryQuery(category: Category): string {
    return `@${category.name} `;
}
