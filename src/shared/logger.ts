/**
 * AI Bookmark Brain - Console Logger Utility
 * Provides structured logging with timestamps and prefixes
 */

import { LOG_PREFIX } from './constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<LogLevel, string> = {
    debug: 'color: #888',
    info: 'color: #0066cc',
    warn: 'color: #cc6600',
    error: 'color: #cc0000',
};

function formatTime(): string {
    return new Date().toISOString().split('T')[1].slice(0, 12);
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
    const time = formatTime();
    const prefix = `%c${LOG_PREFIX} [${time}] [${level.toUpperCase()}]`;

    console[level === 'debug' ? 'log' : level](
        prefix,
        COLORS[level],
        message,
        ...args
    );
}

export const logger = {
    debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => log('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => log('error', message, ...args),

    // Group logging for related operations
    group: (label: string) => {
        console.group(`${LOG_PREFIX} ${label}`);
    },
    groupEnd: () => {
        console.groupEnd();
    },

    // Table logging for structured data
    table: (data: unknown) => {
        console.log(`${LOG_PREFIX} Data:`);
        console.table(data);
    },
};

export default logger;
