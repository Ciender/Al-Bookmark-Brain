/**
 * AI Bookmark Brain - Result Item Component
 * Single search result with favicon, title, URL, and category badge
 */

import React from 'react';
import type { ResultItemProps } from '../types';

export function ResultItem({
    result,
    index,
    isSelected,
    onClick,
    onDoubleClick
}: ResultItemProps) {
    const { bookmark, matchType } = result;

    return (
        <div
            data-result-index={index}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            className={`
        flex items-center
        px-3 py-2
        cursor-pointer
        border-b border-b-[var(--border)]
        font-[var(--font-family-segoe)]
        ${isSelected
                    ? 'bg-[var(--bg-selected)] text-[var(--text-selected)]'
                    : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                }
      `}
        >
            {/* Favicon */}
            <img
                src={bookmark.faviconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}
                alt=""
                className="w-4 h-4 mr-2.5 flex-shrink-0"
                onError={(e) => {
                    (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
            />

            {/* Content */}
            <div className="flex-1 min-w-0 overflow-hidden">
                {/* Title */}
                <div
                    className="font-medium leading-normal whitespace-nowrap overflow-hidden text-ellipsis"
                    style={{ fontSize: 'var(--font-result-title)' }}
                >
                    {bookmark.originalTitle || bookmark.url}
                </div>

                {/* URL */}
                <div
                    className={`
          leading-normal whitespace-nowrap overflow-hidden text-ellipsis
          ${isSelected ? 'opacity-80' : 'text-[var(--text-secondary)]'}
        `}
                    style={{ fontSize: 'var(--font-result-url)' }}
                >
                    {bookmark.url}
                </div>
            </div>

            {/* Match type badge */}
            <span
                className={`
        px-1.5 py-0.5 ml-2 flex-shrink-0 leading-normal
        ${isSelected
                        ? 'bg-white/20'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }
      `}
                style={{ fontSize: 'var(--font-result-badge)' }}
            >
                {getMatchTypeLabel(matchType)}
            </span>

            {/* Category badge */}
            {bookmark.category && (
                <span
                    className={`
            px-1.5 py-0.5 ml-1 flex-shrink-0 leading-normal
            ${isSelected ? 'bg-white/20' : ''}
          `}
                    style={{
                        fontSize: 'var(--font-result-badge)',
                        backgroundColor: isSelected ? undefined : (bookmark.category.color || '#808080'),
                        color: isSelected ? undefined : '#fff'
                    }}
                >
                    {bookmark.category.name}
                </span>
            )}
        </div>
    );
}

function getMatchTypeLabel(matchType: string): string {
    switch (matchType) {
        case 'exact_case': return 'exact';
        case 'exact': return 'exact';
        case 'title': return 'title';
        case 'url': return 'url';
        case 'summary': return 'AI';
        case 'tag': return 'tag';
        case 'category': return 'cat';
        case 'fuzzy': return 'fuzzy';
        case 'pinyin': return 'pinyin';
        default: return matchType;
    }
}

