/**
 * AI Bookmark Brain - Messaging Utilities
 * Wrapper for Chrome runtime messaging
 */

import { logger } from '../shared/logger';

type MessageHandler<T = unknown, R = unknown> = (data: T) => Promise<R> | R;

// Registered message handlers
const handlers = new Map<string, MessageHandler>();

/**
 * Register a message handler
 */
export function onMessage<T = unknown, R = unknown>(
    type: string,
    handler: MessageHandler<T, R>
): void {
    handlers.set(type, handler as MessageHandler);
    logger.debug('Registered handler for:', type);
}

/**
 * Send a message to a specific context
 */
export async function sendMessage<T = unknown, R = unknown>(
    type: string,
    data: T,
    target: 'background' | 'offscreen' | 'content' = 'background'
): Promise<R> {
    return new Promise((resolve, reject) => {
        const message = { type, data, target };

        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response as R);
        });
    });
}

/**
 * Initialize message listener
 */
export function initMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const { type, data } = message;
        const handler = handlers.get(type);

        if (handler) {
            // Handle async response properly
            const handleAsync = async () => {
                try {
                    const result = await handler(data);
                    logger.debug('Handler response for', type, ':', result);
                    sendResponse(result);
                } catch (error) {
                    logger.error('Handler error:', type, error);
                    sendResponse({ error: String(error) });
                }
            };

            handleAsync();
            return true; // Keep channel open for async response
        }

        return false;
    });

    logger.info('Message listener initialized');
}

