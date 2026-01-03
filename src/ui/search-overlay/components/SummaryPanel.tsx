/**
 * AI Bookmark Brain - Summary Panel Component
 * Displays AI summary and database metadata for the selected bookmark
 */

import React, { useState, useEffect } from 'react';
import type { SummaryPanelProps } from '../types';
import { CategoryInput } from './CategoryInput';
import type { Category } from '../../../shared/types';

export function SummaryPanel({ bookmark, onBookmarkUpdate }: SummaryPanelProps) {
    if (!bookmark) {
        return (
            <div
                className="
        h-full 
        flex items-center justify-center 
        text-[var(--text-secondary)] 
        leading-normal
        p-4
        font-[var(--font-family-segoe)]
      "
                style={{ fontSize: 'var(--font-summary-text)' }}
            >
                Select a bookmark to view details
            </div>
        );
    }

    const summary = bookmark.summary;
    const hasAiSummary = summary && summary.summaryText;

    const handleCopyUrl = async () => {
        await navigator.clipboard.writeText(bookmark.url);
    };

    const handleOpen = () => {
        window.open(bookmark.url, '_blank');
    };

    return (
        <div className="
      h-full 
      overflow-y-auto 
      p-4 
      bg-[var(--bg-secondary)]
      font-[var(--font-family-segoe)]
    ">
            {/* Title */}
            <h2
                className="
        font-semibold 
        text-[var(--text-primary)] 
        mb-2
        leading-tight
      "
                style={{ fontSize: 'var(--font-summary-title)' }}
            >
                {bookmark.originalTitle || 'Untitled'}
            </h2>

            {/* Quick Actions */}
            <div className="mb-4 flex gap-2 flex-wrap">
                <button
                    onClick={handleOpen}
                    className="
                        px-3 py-1.5 
                        bg-[var(--accent)] 
                        text-white 
                        hover:opacity-90
                        transition-opacity
                    "
                    style={{ fontSize: 'var(--font-result-badge)' }}
                >
                    🔗 打开
                </button>
                <button
                    onClick={handleCopyUrl}
                    className="
                        px-3 py-1.5 
                        bg-[var(--bg-hover)] 
                        text-[var(--text-primary)]
                        border border-[var(--border)]
                        hover:bg-[var(--bg-secondary)]
                        transition-colors
                    "
                    style={{ fontSize: 'var(--font-result-badge)' }}
                >
                    📋 复制URL
                </button>
            </div>

            {/* AI Summary */}
            {hasAiSummary ? (
                <div className="mb-4">
                    <h3
                        className="
            font-medium 
            text-[var(--text-secondary)] 
            mb-1.5
            uppercase tracking-wide
            leading-normal
          "
                        style={{ fontSize: 'var(--font-summary-label)' }}
                    >
                        AI Summary
                    </h3>
                    {/* Chinese Summary */}
                    <p
                        className="
            text-[var(--text-primary)] 
            leading-relaxed
          "
                        style={{ fontSize: 'var(--font-summary-text)' }}
                    >
                        {summary.summaryText}
                    </p>
                    {/* Original Language Summary */}
                    {summary.summaryOriginal && (
                        <p
                            className="
              text-[var(--text-secondary)] 
              leading-relaxed
              mt-2
              pt-2
              border-t border-t-[var(--border)]
              italic
            "
                            style={{ fontSize: 'var(--font-summary-text)' }}
                        >
                            {summary.summaryOriginal}
                        </p>
                    )}
                </div>
            ) : (
                <div
                    className="
          mb-4 
          px-3 py-4 
          bg-[var(--bg-hover)] 
          text-[var(--text-secondary)] 
          leading-normal
          text-center
        "
                    style={{ fontSize: 'var(--font-summary-text)' }}
                >
                    No AI summary available.
                    <br />
                    <span style={{ fontSize: 'var(--font-metadata-text)' }}>Run summarization in Options.</span>
                </div>
            )}

            {/* Tags */}
            {bookmark.tags && bookmark.tags.length > 0 && (
                <div className="mb-4">
                    <h3
                        className="
            font-medium 
            text-[var(--text-secondary)] 
            mb-1.5
            uppercase tracking-wide
            leading-normal
          "
                        style={{ fontSize: 'var(--font-summary-label)' }}
                    >
                        Tags
                    </h3>
                    <div className="flex flex-wrap gap-1">
                        {bookmark.tags.map((tag) => (
                            <span
                                key={tag.id}
                                className="
                  px-2 py-0.5 
                  text-white
                  leading-normal
                "
                                style={{
                                    fontSize: 'var(--font-result-badge)',
                                    backgroundColor: tag.color || 'var(--accent)'
                                }}
                            >
                                {tag.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Metadata */}
            <div
                className="
        pt-3 
        border-t border-t-[var(--border)]
        text-[var(--text-secondary)]
        space-y-1.5
        leading-normal
      "
                style={{ fontSize: 'var(--font-metadata-text)' }}
            >
                <h3
                    className="font-medium uppercase tracking-wide mb-2"
                    style={{ fontSize: 'var(--font-summary-label)' }}
                >
                    Metadata
                </h3>

                {/* URL */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">🔗</span>
                    <span className="break-all">{bookmark.url}</span>
                </div>

                {/* Folder Path */}
                {bookmark.chromeFolderPath && (
                    <div className="flex items-start gap-2">
                        <span className="opacity-60">📁</span>
                        <span>{bookmark.chromeFolderPath}</span>
                    </div>
                )}

                {/* Category - Editable */}
                <div className="flex items-start gap-2 mb-3">
                    <span className="opacity-60 mt-1">🏷️</span>
                    <div className="flex-1">
                        <CategoryInput
                            bookmarkId={bookmark.id}
                            currentCategory={bookmark.category}
                            onCategoryChange={(newCategory) => {
                                if (onBookmarkUpdate) {
                                    onBookmarkUpdate({
                                        ...bookmark,
                                        category: newCategory || undefined,
                                    });
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Created date */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">📅</span>
                    <span>Added: {formatDate(bookmark.createdAt)}</span>
                </div>

                {/* AI Provider */}
                {summary?.aiProvider && (
                    <div className="flex items-start gap-2">
                        <span className="opacity-60">🤖</span>
                        <span>AI: {summary.aiProvider}</span>
                        {summary.aiModel && <span className="opacity-60">({summary.aiModel})</span>}
                    </div>
                )}

                {/* Status */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">📊</span>
                    <span>Status: {bookmark.status}</span>
                </div>

                {/* Visit count */}
                {bookmark.visitCount > 0 && (
                    <div className="flex items-start gap-2">
                        <span className="opacity-60">👁️</span>
                        <span>Visits: {bookmark.visitCount}</span>
                    </div>
                )}

                {/* User notes */}
                {bookmark.userNotes && (
                    <div className="mt-3 pt-3 border-t border-t-[var(--border)]">
                        <h4 className="font-medium mb-1">📝 Notes</h4>
                        <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                            {bookmark.userNotes}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatDate(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

