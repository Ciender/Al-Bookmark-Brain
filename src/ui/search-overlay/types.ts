/**
 * AI Bookmark Brain - Search Overlay Types
 * Type definitions specific to the search overlay UI
 */

import type { BookmarkWithDetails, SearchResult, Category } from '../../shared/types';

export interface SearchOverlayProps {
    onClose: () => void;
}

export interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    placeholder?: string;
}

export interface FilterDropdownProps {
    selectedCategoryIds: number[];
    onToggleCategory: (categoryId: number) => void;
}

export interface ResultsListProps {
    results: SearchResult[];
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
    onOpenResult: (result: SearchResult) => void;
}

export interface ResultItemProps {
    result: SearchResult;
    index: number;
    isSelected: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
}

export interface SummaryPanelProps {
    bookmark: BookmarkWithDetails | null;
    onBookmarkUpdate?: (bookmark: BookmarkWithDetails) => void;
}

export type { BookmarkWithDetails, SearchResult, Category };
