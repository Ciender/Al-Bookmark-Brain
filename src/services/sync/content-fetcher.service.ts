/**
 * AI Bookmark Brain - Content Fetcher Service
 * Two-tier content fetching with foreground tab for CF challenges
 */

import { Readability } from '@mozilla/readability';
import { convert } from 'html-to-text';
import { logger } from '../../shared/logger';

// Configuration
const INITIAL_WAIT_MS = 5000;  // Initial wait after page load (increased)
const CF_CHECK_INTERVAL_MS = 2000;  // Interval to check if CF passed
const CF_MAX_WAIT_MS = 120000;  // Max 2 minutes for user to solve CF
const MAX_CONCURRENT_TABS = 2;  // Maximum concurrent tabs
const MIN_CONTENT_LENGTH = 500;  // Minimum text length to consider valid

// Track active tabs
let activeTabCount = 0;

// CF detection in page title (tight patterns only)
const CF_TITLE_PATTERNS = [
    'just a moment',
    'attention required',
    'checking your browser',
];

/**
 * Check if tab has Cloudflare challenge DOM elements
 * This is more accurate than text content matching
 */
async function hasCFChallengeDOM(tabId: number): Promise<boolean> {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                // CF verification page specific elements
                const cfElements = [
                    '#challenge-form',
                    '#challenge-running',
                    '#challenge-stage',
                    '.cf-turnstile',
                    '.cf-browser-verification',
                    '[data-cf-turnstile-response]',
                    '#cf-please-wait',
                    '.cf-im-under-attack',
                    '#trk_jschal_js',  // CF JS challenge script
                    'form[action*="/cdn-cgi/"]',  // CF form action
                ];

                for (const selector of cfElements) {
                    if (document.querySelector(selector)) {
                        return true;
                    }
                }

                // Check for CF meta tags
                const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
                if (metaRefresh?.getAttribute('content')?.includes('cdn-cgi')) {
                    return true;
                }

                return false;
            }
        });
        return result?.result ?? false;
    } catch {
        return false;
    }
}

/**
 * Quick check if HTML looks like CF challenge (for HTTP response)
 * Uses stricter patterns to avoid false positives
 */
function isCFChallengeHTML(html: string, title?: string): boolean {
    const lowerHtml = html.toLowerCase();
    const lowerTitle = (title || '').toLowerCase();

    // Must have CF-specific title
    const hasCFTitle = CF_TITLE_PATTERNS.some(p => lowerTitle.includes(p));

    // Must have CF-specific HTML structure
    const hasCFStructure =
        lowerHtml.includes('challenge-form') ||
        lowerHtml.includes('cf-turnstile') ||
        lowerHtml.includes('cf-browser-verification') ||
        lowerHtml.includes('/cdn-cgi/challenge-platform');

    // Very short page with CF elements (real CF pages are minimal)
    const textContent = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const isVeryShort = textContent.length < 300;

    // Need multiple signals to confirm CF
    if (hasCFTitle && hasCFStructure) {
        logger.debug('CF detected: title + structure match');
        return true;
    }

    if (hasCFStructure && isVeryShort) {
        logger.debug('CF detected: short page with CF structure');
        return true;
    }

    return false;
}

/**
 * Check if content is valid (has meaningful content)
 * No longer checks for CF patterns to avoid false positives
 */
function isValidContent(html: string): boolean {
    // Check if we have enough text content (not just empty shell)
    const textLength = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
    return textLength > MIN_CONTENT_LENGTH;
}

// =====================================================
// Frameset Detection and Handling
// =====================================================

/**
 * Check if HTML is a frameset page
 */
function isFramesetPage(html: string): boolean {
    return /<frameset\b/i.test(html);
}

/**
 * Extract frame URLs from frameset HTML
 */
function extractFrameUrls(html: string, baseUrl: string): string[] {
    const framePattern = /<frame[^>]+src=["']([^"']+)["']/gi;
    const urls: string[] = [];
    let match;
    while ((match = framePattern.exec(html)) !== null) {
        try {
            // Resolve relative URLs against base URL
            const frameUrl = new URL(match[1], baseUrl).href;
            urls.push(frameUrl);
        } catch {
            // Invalid URL, skip
        }
    }
    return urls;
}

/**
 * Check if extracted content is the "frames not supported" fallback message
 */
function isFramesFallbackContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return (
        lowerContent.includes('this page uses frames') ||
        lowerContent.includes('your browser doesn\'t support') ||
        lowerContent.includes('your browser does not support frames')
    );
}

/**
 * Extract article content from HTML using Mozilla Readability
 * Note: In Service Worker context, DOMParser is not available,
 * so we fall back to regex-based extraction
 */
function extractArticleContent(html: string, url: string): string {
    // Check if DOMParser is available (not in Service Worker)
    if (typeof DOMParser === 'undefined') {
        logger.debug('DOMParser not available (Service Worker), using html-to-text fallback');
        return extractFallbackFromHtml(html);
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Set document URL for relative link resolution
        const base = doc.createElement('base');
        base.href = url;
        doc.head.appendChild(base);

        // Clone document as Readability modifies it
        const docClone = doc.cloneNode(true) as Document;

        // Use Readability to extract main content
        const reader = new Readability(docClone);
        const article = reader.parse();

        if (article?.textContent) {
            logger.debug('Readability extracted content:', article.title);
            return article.textContent.trim();
        }

        // Fallback to basic extraction
        return extractFallback(doc);
    } catch (error) {
        logger.warn('Readability extraction failed, using fallback:', error);
        return extractFallbackFromHtml(html);
    }
}

/**
 * Fallback extraction: remove common framework elements
 */
function extractFallback(doc: Document): string {
    const removeSelectors = [
        'script', 'style', 'noscript', 'iframe',
        'nav', 'header', 'footer', 'aside',
        '.sidebar', '.menu', '.navigation', '.nav',
        '.advertisement', '.ad', '.ads', '.advert',
        '.cookie-banner', '.popup', '.modal',
        '[role="banner"]', '[role="navigation"]',
        '[role="complementary"]', '[role="contentinfo"]',
        '.social-share', '.comments', '.related-posts'
    ];

    removeSelectors.forEach(selector => {
        try {
            doc.querySelectorAll(selector).forEach(el => el.remove());
        } catch {
            // Ignore invalid selectors
        }
    });

    const mainContent = doc.querySelector('article, main, [role="main"], .content, .post, .article, #content, #main');
    const contentElement = mainContent || doc.body;
    const text = contentElement?.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fallback extraction from raw HTML string using html-to-text
 * This properly handles HTML entity decoding without needing DOMParser
 */
function extractFallbackFromHtml(html: string): string {
    try {
        return convert(html, {
            wordwrap: false,
            selectors: [
                { selector: 'script', format: 'skip' },
                { selector: 'style', format: 'skip' },
                { selector: 'noscript', format: 'skip' },
                { selector: 'noframes', format: 'skip' },  // Skip frameset fallback message
                { selector: 'nav', format: 'skip' },
                { selector: 'header', format: 'skip' },
                { selector: 'footer', format: 'skip' },
                { selector: 'aside', format: 'skip' },
                { selector: 'iframe', format: 'skip' },
                { selector: '.sidebar', format: 'skip' },
                { selector: '.menu', format: 'skip' },
                { selector: '.navigation', format: 'skip' },
                { selector: '.advertisement', format: 'skip' },
                { selector: '.ad', format: 'skip' },
                { selector: '.ads', format: 'skip' },
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' },
            ],
        });
    } catch (error) {
        logger.warn('html-to-text conversion failed, using regex fallback:', error);
        // Ultimate fallback: simple regex
        return html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
            .replace(/&#x([0-9A-Fa-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\s+/g, ' ')
            .trim();
    }
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get HTML from tab, with frameset support
 * If the page uses framesets, extracts content from all frames
 */
async function getTabHtml(tabId: number): Promise<string | null> {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                // Check if this is a frameset page
                const frameset = document.querySelector('frameset');
                if (frameset) {
                    // Collect content from all frames
                    const frames = document.querySelectorAll('frame');
                    const contents: string[] = [];

                    frames.forEach((frame: HTMLFrameElement) => {
                        try {
                            // Only access same-origin frames
                            const frameDoc = frame.contentDocument;
                            if (frameDoc && frameDoc.body) {
                                contents.push(frameDoc.documentElement.outerHTML);
                            }
                        } catch {
                            // Cross-origin frame, skip
                        }
                    });

                    if (contents.length > 0) {
                        // Wrap all frame contents in a container
                        return `<html><body>${contents.join('\n')}</body></html>`;
                    }
                }

                // Regular page or no accessible frames
                return document.documentElement.outerHTML;
            }
        });
        return result?.result || null;
    } catch {
        return null;
    }
}

/**
 * Wait for tab to complete loading
 */
function waitForTabComplete(tabId: number, timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab load timeout'));
        }, timeoutMs);

        const listener = (
            updatedTabId: number,
            changeInfo: { status?: string }
        ) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);

        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }).catch(() => {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab not found'));
        });
    });
}

/**
 * Fetch content from current tab using content script
 * Content extraction happens in the tab context where DOM APIs are available
 */
export async function fetchFromCurrentTab(tabId: number): Promise<string | null> {
    try {
        // Execute content extraction directly in the tab
        // This avoids DOMParser issues in Service Worker
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                // Helper function to extract text from a document
                const extractFromDoc = (doc: Document): string => {
                    const removeSelectors = [
                        'script', 'style', 'noscript', 'noframes', 'iframe',
                        'nav', 'header', 'footer', 'aside',
                        '.sidebar', '.menu', '.navigation', '.nav',
                        '.advertisement', '.ad', '.ads', '.advert',
                        '.cookie-banner', '.popup', '.modal',
                        '[role="banner"]', '[role="navigation"]',
                        '[role="complementary"]', '[role="contentinfo"]',
                        '.social-share', '.comments', '.related-posts'
                    ];

                    // Clone document to avoid modifying the page
                    const docClone = doc.cloneNode(true) as Document;

                    // Remove unwanted elements
                    removeSelectors.forEach(selector => {
                        try {
                            docClone.querySelectorAll(selector).forEach(el => el.remove());
                        } catch {
                            // Ignore invalid selectors
                        }
                    });

                    // Find main content
                    const mainContent = docClone.querySelector(
                        'article, main, [role="main"], .content, .post, .article, #content, #main'
                    );
                    const contentElement = mainContent || docClone.body;

                    // Get text content
                    const text = contentElement?.textContent || '';
                    return text.replace(/\s+/g, ' ').trim();
                };

                // Check if this is a frameset page
                const frameset = document.querySelector('frameset');
                if (frameset) {
                    // Collect content from all frames
                    const frames = document.querySelectorAll('frame');
                    const contents: string[] = [];
                    let hasFrames = false;

                    frames.forEach((frame: HTMLFrameElement) => {
                        hasFrames = true;
                        try {
                            // Only access same-origin frames
                            const frameDoc = frame.contentDocument;
                            if (frameDoc && frameDoc.body) {
                                const frameText = extractFromDoc(frameDoc);
                                if (frameText.length > 50) {
                                    contents.push(frameText);
                                }
                            }
                        } catch {
                            // Cross-origin frame, skip
                        }
                    });

                    if (contents.length > 0) {
                        return { type: 'content', data: contents.join('\n\n') };
                    }

                    // Frameset detected but no accessible frames - return frame URLs for HTTP fallback
                    if (hasFrames && contents.length === 0) {
                        const frameUrls: string[] = [];
                        frames.forEach((frame: HTMLFrameElement) => {
                            const src = frame.getAttribute('src');
                            if (src) {
                                try {
                                    const url = new URL(src, window.location.href).href;
                                    frameUrls.push(url);
                                } catch {
                                    // Invalid URL
                                }
                            }
                        });
                        if (frameUrls.length > 0) {
                            return { type: 'frameUrls', data: frameUrls };
                        }
                    }
                }

                // Regular page
                return { type: 'content', data: extractFromDoc(document) };
            }
        });

        const extractResult = result?.result as { type: string; data: string | string[] } | undefined;

        if (!extractResult) {
            return null;
        }

        // Handle frame URLs - need to use HTTP fetch for cross-origin frames
        if (extractResult.type === 'frameUrls' && Array.isArray(extractResult.data)) {
            logger.info('Tab fetch detected cross-origin frames, fetching via HTTP:', extractResult.data);

            // Fetch each frame via HTTP
            const frameContents: string[] = [];
            for (const frameUrl of extractResult.data) {
                try {
                    const frameContent = await fetchViaHttp(frameUrl);
                    if (frameContent && frameContent.length > 50 && !isFramesFallbackContent(frameContent)) {
                        frameContents.push(frameContent);
                    }
                } catch (error) {
                    logger.debug(`Failed to fetch frame ${frameUrl}:`, error);
                }
            }

            if (frameContents.length > 0) {
                const combinedContent = frameContents.join('\n\n');
                logger.info(`Combined content from ${frameContents.length} cross-origin frames, length: ${combinedContent.length}`);
                return combinedContent;
            }

            return null;
        }

        // Regular content
        const content = extractResult.type === 'content' ? extractResult.data as string : null;
        if (content && typeof content === 'string' && content.length > 50) {
            // Check if content is just the frames fallback message
            if (isFramesFallbackContent(content)) {
                logger.debug('Content extracted from tab is frames fallback message, returning null');
                return null;
            }
            logger.debug('Content extracted from current tab, length:', content.length);
            return content;
        }

        return null;
    } catch (error) {
        logger.warn('Failed to fetch from current tab:', error);
        return null;
    }
}


/**
 * Detect charset from HTTP Content-Type header or HTML meta tags
 */
function detectCharset(contentType: string, htmlPreview: string): string {
    // 1. Try HTTP Content-Type header first (highest priority)
    const headerMatch = contentType.match(/charset=["']?([^"';\s]+)/i);
    if (headerMatch) {
        logger.debug('Charset from HTTP header:', headerMatch[1]);
        return headerMatch[1].trim();
    }

    // 2. Try HTML5 meta charset tag: <meta charset="xxx">
    const html5Match = htmlPreview.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i);
    if (html5Match) {
        logger.debug('Charset from HTML5 meta:', html5Match[1]);
        return html5Match[1].trim();
    }

    // 3. Try legacy meta http-equiv: <meta http-equiv="Content-Type" content="text/html; charset=xxx">
    const legacyMatch = htmlPreview.match(/<meta[^>]+http-equiv=["']?Content-Type["']?[^>]+content=["'][^"']*charset=([^"'\s;]+)/i) ||
        htmlPreview.match(/<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)[^>]+http-equiv=["']?Content-Type["']?/i);
    if (legacyMatch) {
        logger.debug('Charset from legacy meta:', legacyMatch[1]);
        return legacyMatch[1].trim();
    }

    // 4. Default to UTF-8
    return 'utf-8';
}

/**
 * Normalize charset name for TextDecoder compatibility
 */
function normalizeCharset(charset: string): string {
    const normalized = charset.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Map common aliases to TextDecoder-compatible names
    const charsetMap: Record<string, string> = {
        'gb2312': 'gbk',      // GB2312 is a subset of GBK
        'gb18030': 'gb18030', // Full Chinese charset
        'gbk': 'gbk',
        'big5': 'big5',
        'utf8': 'utf-8',
        'unicode': 'utf-8',
        'iso88591': 'iso-8859-1',
        'latin1': 'iso-8859-1',
        'shiftjis': 'shift_jis',
        'eucjp': 'euc-jp',
        'euckr': 'euc-kr',
    };

    return charsetMap[normalized] || charset.toLowerCase();
}

/**
 * Fetch content via HTTP request (fast path)
 * Now with smart charset detection to handle GBK/GB2312 Chinese websites
 * Also handles frameset pages by fetching content from each frame
 */
export async function fetchViaHttp(url: string, depth: number = 0): Promise<string | null> {
    // Prevent infinite recursion for nested framesets
    if (depth > 3) {
        logger.debug('Max frameset depth reached, stopping recursion');
        return null;
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',  // Prefer Chinese
            },
        });

        if (!response.ok) {
            logger.debug('HTTP fetch failed with status:', response.status);
            return null;
        }

        // Get raw binary data instead of text (to avoid premature UTF-8 decoding)
        const buffer = await response.arrayBuffer();

        // Get Content-Type header for charset detection
        const contentType = response.headers.get('content-type') || '';

        // Read first 1024 bytes with latin1 (preserves raw bytes) to scan for meta charset
        const previewDecoder = new TextDecoder('iso-8859-1');
        const htmlPreview = previewDecoder.decode(buffer.slice(0, 1024));

        // Detect charset from headers or HTML meta tags
        const detectedCharset = detectCharset(contentType, htmlPreview);
        const normalizedCharset = normalizeCharset(detectedCharset);

        // Decode with correct charset
        let html: string;
        try {
            const decoder = new TextDecoder(normalizedCharset);
            html = decoder.decode(buffer);
            logger.debug(`Decoded with charset: ${normalizedCharset}`);
        } catch (decodeError) {
            // Fallback to UTF-8 if charset is not supported
            logger.warn(`TextDecoder failed for ${normalizedCharset}, falling back to UTF-8:`, decodeError);
            html = new TextDecoder('utf-8').decode(buffer);
        }

        // Check if it's a CF challenge page (use strict HTML check)
        if (isCFChallengeHTML(html)) {
            logger.debug('HTTP fetch returned CF challenge page');
            return null;
        }

        // Handle frameset pages - fetch content from each frame
        if (isFramesetPage(html)) {
            logger.info('Detected frameset page, extracting frame URLs:', url);
            const frameUrls = extractFrameUrls(html, url);

            if (frameUrls.length > 0) {
                logger.debug(`Found ${frameUrls.length} frame URLs:`, frameUrls);

                // Fetch content from each frame
                const frameContents: string[] = [];
                for (const frameUrl of frameUrls) {
                    try {
                        const frameContent = await fetchViaHttp(frameUrl, depth + 1);
                        if (frameContent && frameContent.length > 50 && !isFramesFallbackContent(frameContent)) {
                            frameContents.push(frameContent);
                        }
                    } catch (frameError) {
                        logger.debug(`Failed to fetch frame ${frameUrl}:`, frameError);
                    }
                }

                if (frameContents.length > 0) {
                    const combinedContent = frameContents.join('\n\n');
                    logger.info(`Combined content from ${frameContents.length} frames, length: ${combinedContent.length}`);
                    return combinedContent;
                }
            }

            // No frame content could be fetched - still try to extract any content
            logger.debug('Could not fetch frame contents, falling back to direct extraction');
        }

        // Extract article content from the HTML
        const content = extractArticleContent(html, url);

        // Check if we got the frames fallback message
        if (content && isFramesFallbackContent(content)) {
            logger.debug('Extracted content is frames fallback message, returning null');
            return null;
        }

        return content;
    } catch (error) {
        logger.debug('HTTP fetch failed:', url, error);
        return null;
    }
}


/**
 * Fetch content via tab (with foreground support for CF challenges)
 * If CF is detected, tab becomes visible for user to solve
 */
export async function fetchViaTab(url: string): Promise<string | null> {
    // Rate limit concurrent tabs
    while (activeTabCount >= MAX_CONCURRENT_TABS) {
        await delay(1000);
    }

    activeTabCount++;
    let tab: chrome.tabs.Tab | null = null;

    try {
        logger.info('Opening tab for:', url);

        // Create tab (initially not active to avoid disruption)
        tab = await chrome.tabs.create({
            url,
            active: false,
        });

        if (!tab.id) {
            throw new Error('Failed to create tab');
        }

        // Wait for page to load
        await waitForTabComplete(tab.id);
        await delay(INITIAL_WAIT_MS);

        // Check initial content
        let html = await getTabHtml(tab.id);
        if (!html) {
            throw new Error('Failed to extract HTML');
        }

        // Get tab info
        const tabInfo = await chrome.tabs.get(tab.id);
        logger.debug('Page title:', tabInfo.title);
        logger.debug('HTML length:', html.length);

        // Strategy: Try to extract content first, only wait for CF if content is insufficient
        let content = extractArticleContent(html, url);

        // If we got good content, return immediately (regardless of CF patterns in text)
        if (content && content.length > MIN_CONTENT_LENGTH) {
            logger.info('Content extracted successfully, length:', content.length);
            return content;
        }

        // Check if this is actually a CF challenge page using DOM detection
        const hasCFElements = await hasCFChallengeDOM(tab.id);

        if (hasCFElements) {
            logger.info('CF challenge detected via DOM elements!');
            logger.info('Activating tab for user to solve...');

            // Bring tab to foreground for user to solve
            await chrome.tabs.update(tab.id, { active: true });

            // Focus the window
            if (tab.windowId) {
                await chrome.windows.update(tab.windowId, { focused: true });
            }

            // Wait for user to solve CF (poll for DOM changes)
            const startTime = Date.now();
            while (Date.now() - startTime < CF_MAX_WAIT_MS) {
                await delay(CF_CHECK_INTERVAL_MS);

                // Check if tab still exists
                try {
                    await chrome.tabs.get(tab.id);
                } catch {
                    // Tab was closed by user
                    logger.info('Tab closed by user');
                    return null;
                }

                // Check if CF elements are gone
                const stillHasCF = await hasCFChallengeDOM(tab.id);
                if (!stillHasCF) {
                    logger.info('CF challenge solved! DOM elements gone.');

                    // Wait a moment for page to fully render
                    await delay(2000);

                    // Get new content
                    html = await getTabHtml(tab.id);
                    if (html && isValidContent(html)) {
                        content = extractArticleContent(html, url);
                        logger.info('Content extracted after CF solve, length:', content.length);
                        return content;
                    }
                    break;
                }
            }

            // Timeout - try one last extraction
            html = await getTabHtml(tab.id);
            if (html && isValidContent(html)) {
                content = extractArticleContent(html, url);
                if (content && content.length > MIN_CONTENT_LENGTH) {
                    return content;
                }
            }

            logger.warn('CF challenge not solved within timeout');
            return null;
        }

        // No CF elements but content was insufficient
        logger.debug('No CF detected but content insufficient, length:', content?.length || 0);
        return content && content.length > 50 ? content : null;

        // This block is no longer reached due to early returns above

    } catch (error) {
        logger.error('Tab fetch failed:', error);
        return null;
    } finally {
        // Close the tab
        if (tab?.id) {
            try {
                await chrome.tabs.remove(tab.id);
            } catch {
                // Tab may already be closed
            }
        }
        activeTabCount--;
    }
}

/**
 * Smart content fetcher - tries HTTP first, then tab with CF handling
 */
export async function fetchPageContentSmart(url: string): Promise<string | null> {
    // Skip non-http URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return null;
    }

    // Step 1: Try fast HTTP fetch
    let content = await fetchViaHttp(url);
    if (content && content.length > 100) {
        logger.debug('Content fetched via HTTP');
        return content;
    }

    // Step 2: Fallback to tab (with CF handling)
    logger.info('HTTP fetch unsuccessful, trying tab fetch...');
    content = await fetchViaTab(url);
    return content;
}

export default {
    fetchFromCurrentTab,
    fetchViaHttp,
    fetchViaTab,
    fetchPageContentSmart,
};
