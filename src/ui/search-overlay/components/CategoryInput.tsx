/**
 * AI Bookmark Brain - CategoryInput Component
 * Autocomplete input for selecting or creating bookmark categories
 * Uses Zustand store for centralized state management
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import pinyinMatch from 'pinyin-match';
import { useCategoryStore } from '../stores';
import { useShallow } from 'zustand/shallow';
import type { Category } from '../../../shared/types';

interface CategoryInputProps {
    bookmarkId: number;
    currentCategory?: Category;
    onCategoryChange: (category: Category | null) => void;
}

export function CategoryInput({ bookmarkId, currentCategory, onCategoryChange }: CategoryInputProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState(currentCategory?.name || '');
    const [filteredCategories, setFilteredCategories] = useState<Category[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [isLoading, setIsLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isSelectingRef = useRef(false); // Track if user is selecting

    // Use single Zustand subscription with useShallow for stability (Zustand 5.x)
    const { categories, createCategory, deleteCategory, setBookmarkCategory } = useCategoryStore(
        useShallow(state => ({
            categories: state.categories,
            createCategory: state.createCategory,
            deleteCategory: state.deleteCategory,
            setBookmarkCategory: state.setBookmarkCategory,
        }))
    );

    // Filter categories when input changes
    useEffect(() => {
        if (!inputValue.trim()) {
            setFilteredCategories(categories);
        } else {
            const query = inputValue.toLowerCase();
            const filtered = categories.filter(cat => {
                if (cat.name.toLowerCase().includes(query)) return true;
                if (cat.namePinyin?.toLowerCase().includes(query)) return true;
                try {
                    if (pinyinMatch.match(cat.name, inputValue)) return true;
                } catch { /* ignore */ }
                return false;
            });
            setFilteredCategories(filtered);
        }
        setSelectedIndex(-1);
    }, [inputValue, categories]);

    // Sync with external changes (when selecting different bookmark)
    useEffect(() => {
        setInputValue(currentCategory?.name || '');
    }, [currentCategory]);

    // Handle selection of existing category
    const handleSelect = useCallback(async (category: Category) => {
        isSelectingRef.current = true;
        setInputValue(category.name);
        setIsOpen(false);

        const success = await setBookmarkCategory(bookmarkId, category.id);
        if (success) {
            onCategoryChange(category);
        }
        isSelectingRef.current = false;
    }, [bookmarkId, onCategoryChange, setBookmarkCategory]);

    // Handle creation of new category
    const handleCreate = useCallback(async (name: string) => {
        if (!name.trim()) return;

        isSelectingRef.current = true;
        setIsLoading(true);
        try {
            const newCategory = await createCategory(name.trim());
            if (newCategory) {
                const success = await setBookmarkCategory(bookmarkId, newCategory.id);
                if (success) {
                    setInputValue(newCategory.name);
                    onCategoryChange(newCategory);
                }
            }
        } finally {
            setIsLoading(false);
            setIsOpen(false);
            isSelectingRef.current = false;
        }
    }, [bookmarkId, onCategoryChange, createCategory, setBookmarkCategory]);

    // Handle clearing category from bookmark
    const handleClear = useCallback(async () => {
        isSelectingRef.current = true;
        const success = await setBookmarkCategory(bookmarkId, null);
        if (success) {
            setInputValue('');
            onCategoryChange(null);
        }
        setIsOpen(false);
        isSelectingRef.current = false;
    }, [bookmarkId, onCategoryChange, setBookmarkCategory]);

    // Handle deleting a category entirely
    const handleDeleteCategory = useCallback(async (categoryId: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        isSelectingRef.current = true;
        const success = await deleteCategory(categoryId);
        if (success) {
            if (currentCategory?.id === categoryId) {
                setInputValue('');
                onCategoryChange(null);
            }
        }
        isSelectingRef.current = false;
        // Keep dropdown open after delete
    }, [deleteCategory, currentCategory, onCategoryChange]);

    // Handle blur - only close if not selecting
    const handleBlur = useCallback(() => {
        // Delay to allow click events to process first
        setTimeout(() => {
            if (!isSelectingRef.current) {
                setIsOpen(false);
                // Reset to current category name if user didn't complete selection
                setInputValue(currentCategory?.name || '');
            }
        }, 200);
    }, [currentCategory]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        const totalItems = filteredCategories.length + (showCreateOption ? 1 : 0);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    setSelectedIndex(prev => prev < totalItems - 1 ? prev + 1 : prev);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredCategories.length) {
                    handleSelect(filteredCategories[selectedIndex]);
                } else if (selectedIndex === filteredCategories.length && showCreateOption) {
                    handleCreate(inputValue.trim());
                } else if (inputValue.trim()) {
                    // If Enter pressed with text but no selection, try to match or create
                    const existing = categories.find(c =>
                        c.name.toLowerCase() === inputValue.trim().toLowerCase()
                    );
                    if (existing) {
                        handleSelect(existing);
                    } else {
                        handleCreate(inputValue.trim());
                    }
                }
                break;
            // Escape is handled by Radix Popover's onEscapeKeyDown
            // to properly stop propagation and prevent closing SearchOverlay
        }
    }, [isOpen, filteredCategories, selectedIndex, inputValue, categories, currentCategory, handleSelect, handleCreate]);

    // Compute if we should show create option
    const showCreateOption = inputValue.trim() &&
        !categories.some(c => c.name.toLowerCase() === inputValue.trim().toLowerCase());

    return (
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
            <Popover.Anchor asChild>
                <div className="relative flex items-center">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            if (!isOpen) setIsOpen(true);
                        }}
                        onFocus={() => setIsOpen(true)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        placeholder="Type to search or create..."
                        disabled={isLoading}
                        className="
                            w-full px-3 py-1.5 pr-14
                            bg-[var(--bg-primary)]
                            border border-[var(--border)]
                            text-[var(--text-primary)]
                            text-sm
                            placeholder:text-[var(--text-secondary)]
                            focus:outline-none focus:border-[var(--accent)]
                            disabled:opacity-50
                        "
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        {currentCategory && (
                            <>
                                <span
                                    className="w-2 h-2"
                                    style={{ backgroundColor: currentCategory.color || '#808080' }}
                                />
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleClear();
                                    }}
                                    className="
                                        w-4 h-4 flex items-center justify-center
                                        text-[var(--text-secondary)] hover:text-red-500
                                        text-xs font-bold
                                    "
                                    title="Remove category from bookmark"
                                >
                                    ✕
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </Popover.Anchor>

            {/* Render directly without Portal to stay inside Shadow DOM */}
            <Popover.Content
                className="
                    bg-[var(--bg-primary)]
                    border border-[var(--border)]
                    shadow-lg
                    min-w-[200px]
                    max-h-[200px]
                    overflow-y-auto
                    z-[2147483647]
                    font-[var(--font-family-segoe)]
                "
                sideOffset={4}
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => {
                    // Allow propagation so SearchOverlay can close too
                    // Reset input value when closing
                    setInputValue(currentCategory?.name || '');
                }}
                onInteractOutside={(e) => {
                    // Prevent closing when clicking inside the input area
                    if (inputRef.current?.contains(e.target as Node)) {
                        e.preventDefault();
                    }
                }}
            >
                {/* Header hint */}
                <div className="px-3 py-1.5 text-[10px] text-[var(--text-secondary)] border-b border-[var(--border)]">
                    {categories.length > 0 ? 'Select or type to create' : 'Type to create first category'}
                </div>

                {/* Category list */}
                {filteredCategories.map((category, index) => (
                    <div
                        key={category.id}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelect(category);
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`
                            flex items-center justify-between gap-2
                            px-3 py-2
                            cursor-pointer
                            text-sm
                            ${index === selectedIndex
                                ? 'bg-[var(--accent)] text-white'
                                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}
                        `}
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className="w-2 h-2 flex-shrink-0"
                                style={{ backgroundColor: category.color || '#808080' }}
                            />
                            <span>{category.name}</span>
                        </div>
                        <button
                            type="button"
                            onMouseDown={(e) => handleDeleteCategory(category.id, e)}
                            className={`
                                w-5 h-5 flex items-center justify-center
                                text-xs opacity-40 hover:opacity-100
                                ${index === selectedIndex ? 'text-white hover:text-red-200' : 'text-red-500'}
                            `}
                            title="Delete this category"
                        >
                            ×
                        </button>
                    </div>
                ))}

                {/* Create option */}
                {showCreateOption && (
                    <div
                        onMouseDown={(e) => {
                            e.preventDefault();
                            handleCreate(inputValue.trim());
                        }}
                        onMouseEnter={() => setSelectedIndex(filteredCategories.length)}
                        className={`
                            flex items-center gap-2
                            px-3 py-2
                            cursor-pointer
                            text-sm
                            border-t border-t-[var(--border)]
                            ${selectedIndex === filteredCategories.length
                                ? 'bg-[var(--accent)] text-white'
                                : 'text-[var(--accent)] hover:bg-[var(--bg-hover)]'}
                        `}
                    >
                        <span className="font-medium">+</span>
                        <span>Create "{inputValue.trim()}"</span>
                    </div>
                )}

                {/* Empty state */}
                {filteredCategories.length === 0 && !showCreateOption && (
                    <div className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">
                        No matching categories
                    </div>
                )}
            </Popover.Content>
        </Popover.Root>
    );
}
