/**
 * AI Bookmark Brain - History Panel Component
 * Displays detailed info for selected history record (no AI summary)
 */

import React from 'react';
import type { HistoryRecord } from '../../../shared/types';
import { MESSAGE_TYPES } from '../../../shared/constants';

export interface HistoryPanelProps {
    history: HistoryRecord | null;
}

export function HistoryPanel({ history }: HistoryPanelProps) {
    if (!history) {
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
                输入 ! 搜索浏览历史
            </div>
        );
    }

    const handleCopyUrl = async () => {
        await navigator.clipboard.writeText(history.url);
    };

    const handleOpen = () => {
        window.open(history.url, '_blank');
    };

    const handleAddBookmark = () => {
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.ADD_BOOKMARK,
            data: { url: history.url, title: history.title }
        });
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
                {history.title || 'Untitled'}
            </h2>

            {/* URL */}
            <a
                href={history.url}
                target="_blank"
                rel="noopener noreferrer"
                className="
                    text-[var(--accent)] 
                    hover:underline 
                    break-all 
                    block mb-4
                "
                style={{ fontSize: 'var(--font-result-url)' }}
            >
                {history.url}
            </a>

            {/* Page Description */}
            {history.pageDescription && (
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
                        页面描述
                    </h3>
                    <p
                        className="
                            text-[var(--text-primary)] 
                            leading-relaxed
                        "
                        style={{ fontSize: 'var(--font-summary-text)' }}
                    >
                        {history.pageDescription}
                    </p>
                </div>
            )}

            {/* Search Context */}
            {history.searchQuery && (
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
                        搜索关键词
                    </h3>
                    <span
                        className="
                            inline-block
                            px-2 py-1 
                            bg-[var(--accent)] 
                            text-white
                        "
                        style={{ fontSize: 'var(--font-result-badge)' }}
                    >
                        {history.searchQuery}
                    </span>
                </div>
            )}

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
                {!history.bookmarkId && (
                    <button
                        onClick={handleAddBookmark}
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
                        ⭐ 添加书签
                    </button>
                )}
            </div>

            {/* Visit Statistics */}
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
                    访问统计
                </h3>

                {/* Source Type */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">📍</span>
                    <span>来源: {formatSourceType(history.sourceType)}</span>
                </div>

                {/* Visit Count */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">👁️</span>
                    <span>访问次数: {history.visitCount}</span>
                </div>

                {/* Time Spent */}
                {history.totalTimeSpent > 0 && (
                    <div className="flex items-start gap-2">
                        <span className="opacity-60">⏱️</span>
                        <span>停留时间: {formatDuration(history.totalTimeSpent)}</span>
                    </div>
                )}

                {/* First Visit */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">📅</span>
                    <span>首次访问: {formatDate(history.firstVisitAt)}</span>
                </div>

                {/* Last Visit */}
                <div className="flex items-start gap-2">
                    <span className="opacity-60">🕐</span>
                    <span>最后访问: {formatDate(history.lastVisitAt)}</span>
                </div>

                {/* Linked Bookmark */}
                {history.bookmarkId && (
                    <div className="flex items-start gap-2">
                        <span className="opacity-60">⭐</span>
                        <span>已收藏</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatSourceType(source: string): string {
    switch (source) {
        case 'search': return '搜索引擎';
        case 'navigate': return '直接访问';
        case 'bookmark': return '书签';
        default: return source;
    }
}

function formatDate(timestamp: number): string {
    if (!timestamp) return '未知';
    return new Date(timestamp).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}小时${remainingMinutes > 0 ? remainingMinutes + '分钟' : ''}`;
}
