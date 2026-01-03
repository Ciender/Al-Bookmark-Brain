/**
 * AI Bookmark Brain - Filter Dropdown Component
 * Multi-select category filter using Radix UI Popover and Checkbox
 * Uses Zustand store for centralized state management
 */

import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Checkbox from '@radix-ui/react-checkbox';
import { useCategoryStore } from '../stores';

interface FilterDropdownProps {
    selectedCategoryIds: number[];
    onToggleCategory: (categoryId: number) => void;
}

export function FilterDropdown({
    selectedCategoryIds,
    onToggleCategory
}: FilterDropdownProps) {
    // Use Zustand store - categories initialized by SearchOverlay
    const categories = useCategoryStore(state => state.categories);

    const selectedCount = selectedCategoryIds.length;

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    className="
                        px-4 py-3
                        border-none border-l border-l-[var(--border)]
                        bg-[var(--bg-secondary)]
                        text-[var(--text-secondary)]
                        text-xs
                        cursor-pointer
                        hover:bg-[var(--bg-hover)]
                        font-[var(--font-family-segoe)]
                        flex items-center gap-1
                    "
                >
                    Filter
                    {selectedCount > 0 && (
                        <span className="
                            bg-[var(--accent)] 
                            text-white 
                            text-[10px] 
                            px-1.5 py-0.5 
                            min-w-[18px] 
                            text-center
                        ">
                            {selectedCount}
                        </span>
                    )}
                    <span className="ml-1">▾</span>
                </button>
            </Popover.Trigger>

            {/* Render directly without Portal to stay inside Shadow DOM */}
            <Popover.Content
                className="
                    bg-[var(--bg-primary)]
                    border border-[var(--border)]
                    shadow-lg
                    min-w-[200px]
                    max-h-[300px]
                    overflow-y-auto
                    z-[2147483647]
                    font-[var(--font-family-segoe)]
                "
                sideOffset={4}
                align="end"
                onEscapeKeyDown={(e) => {
                    // Stop propagation to prevent closing the entire SearchOverlay
                    e.stopPropagation();
                }}
            >
                {categories.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-[var(--text-secondary)] text-center">
                        No categories yet.
                        <br />
                        Select a bookmark and add category.
                    </div>
                ) : (
                    <>
                        {/* Clear All button */}
                        {selectedCount > 0 && (
                            <button
                                onClick={() => selectedCategoryIds.forEach(id => onToggleCategory(id))}
                                className="
                                    w-full px-3 py-2
                                    text-xs text-left
                                    text-[var(--accent)]
                                    hover:bg-[var(--bg-hover)]
                                    border-b border-b-[var(--border)]
                                "
                            >
                                Clear all filters
                            </button>
                        )}

                        {/* Category list */}
                        {categories.map((category) => (
                            <label
                                key={category.id}
                                className="
                                    flex items-center gap-2
                                    px-3 py-2
                                    cursor-pointer
                                    hover:bg-[var(--bg-hover)]
                                    text-sm text-[var(--text-primary)]
                                "
                            >
                                <Checkbox.Root
                                    checked={selectedCategoryIds.includes(category.id)}
                                    onCheckedChange={() => onToggleCategory(category.id)}
                                    className="
                                        w-4 h-4
                                        border border-[var(--border)]
                                        bg-[var(--bg-primary)]
                                        flex items-center justify-center
                                        data-[state=checked]:bg-[var(--accent)]
                                        data-[state=checked]:border-[var(--accent)]
                                    "
                                >
                                    <Checkbox.Indicator className="text-white text-xs">
                                        ✓
                                    </Checkbox.Indicator>
                                </Checkbox.Root>

                                {/* Category color dot */}
                                <span
                                    className="w-2 h-2"
                                    style={{ backgroundColor: category.color || '#808080' }}
                                />

                                <span>{category.name}</span>
                            </label>
                        ))}
                    </>
                )}
            </Popover.Content>
        </Popover.Root>
    );
}
