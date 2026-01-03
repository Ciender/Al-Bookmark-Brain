/**
 * AI Bookmark Brain - Content Script
 * Injects the React search overlay UI into web pages using WXT createShadowRootUi
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

import { MESSAGE_TYPES, UI } from '../shared/constants';
import { logger } from '../shared/logger';
import { SearchOverlay } from '../ui/search-overlay';
import '../ui/search-overlay/styles/globals.css';

// UI instance and state
let ui: { mount: () => void; remove: () => void } | null = null;
let root: ReactDOM.Root | null = null;
let isVisible = false;

// Pre-input buffer state for toggle operations
let isToggling = false;
let pendingToggle = false;  // Queue next toggle if one is in progress
const TOGGLE_DEBOUNCE_MS = 20;  // Minimal debounce for snappy response

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui', // Inject CSS into Shadow DOM

  async main(ctx) {
    // Check if content script already loaded (prevent duplicate instances)
    // Use a global flag because DOM check may fail if UI isn't mounted yet
    const globalFlag = '__AI_BOOKMARK_BRAIN_LOADED__';
    if ((window as unknown as Record<string, boolean>)[globalFlag]) {
      logger.warn('Content script already loaded, skipping duplicate initialization');
      return;
    }
    // Mark as loaded BEFORE any async operations
    (window as unknown as Record<string, boolean>)[globalFlag] = true;

    logger.info('Content script loaded');

    // Create the UI (but don't mount yet)
    ui = await createShadowRootUi(ctx, {
      name: UI.OVERLAY_ID,
      position: 'overlay',
      zIndex: 2147483647,

      onMount: (container: HTMLElement) => {
        // Create wrapper div for React
        const app = document.createElement('div');
        app.id = 'ai-bookmark-brain-root';

        // Force style isolation to prevent host page styles from affecting UI
        app.style.cssText = `
          all: initial;
          font-size: 16px !important;
          font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          line-height: 1.5;
          zoom: 1 !important;
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        `;

        container.appendChild(app);

        // Create React root and render
        root = ReactDOM.createRoot(app);
        root.render(
          <React.StrictMode>
            <SearchOverlay onClose={hideOverlay} />
          </React.StrictMode>
        );

        logger.debug('React overlay mounted');
        return root;
      },

      onRemove: () => {
        // Cleanup React
        root?.unmount();
        root = null;
        logger.debug('React overlay unmounted');
      },
    });

    // Set up message listener for toggle commands
    setupMessageListener();

    // Set up keyboard shortcut fallback
    setupKeyboardShortcut();

    // Set up keyboard event blocker for when overlay is visible
    setupKeyboardBlocker();
  },
});

/**
 * Show the search overlay
 */
function showOverlay(): void {
  if (!ui) return;

  if (!isVisible) {
    ui.mount();
    isVisible = true;
    logger.debug('Overlay shown');
  }
}

/**
 * Hide the search overlay
 */
function hideOverlay(): void {
  if (!ui) return;

  if (isVisible) {
    ui.remove();
    isVisible = false;
    logger.debug('Overlay hidden');
  }
}

/**
 * Toggle overlay visibility
 * Uses pre-input buffering for snappy response
 */
function toggleOverlay(): void {
  // Keyboard pre-input: if already toggling, queue the next one
  if (isToggling) {
    logger.debug('Toggle in progress, queuing next toggle (pre-input)');
    pendingToggle = true;
    return;
  }

  isToggling = true;

  try {
    if (isVisible) {
      hideOverlay();
    } else {
      showOverlay();
    }
  } finally {
    isToggling = false;

    // Process pending toggle after a minimal delay
    if (pendingToggle) {
      pendingToggle = false;
      setTimeout(() => {
        toggleOverlay();
      }, TOGGLE_DEBOUNCE_MS);
    }
  }
}

/**
 * Set up message listener for commands from background script
 */
function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (message: { type: string }, _sender, sendResponse) => {
      switch (message.type) {
        case MESSAGE_TYPES.UI_TOGGLE_OVERLAY:
          toggleOverlay();
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.UI_SHOW_OVERLAY:
          showOverlay();
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.UI_HIDE_OVERLAY:
          hideOverlay();
          sendResponse({ success: true });
          break;

        case 'get-page-content':
          const content = document.body?.innerText?.slice(0, 10000) || '';
          sendResponse({ content });
          break;

        case 'get-page-meta':
          const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
          sendResponse({ description, title: document.title });
          break;

        default:
          return false;
      }
      return true;
    }
  );
}

/**
 * Set up keyboard shortcut fallback (Ctrl+Q)
 * In case chrome.commands doesn't work
 */
function setupKeyboardShortcut(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Ctrl+Q or Cmd+Q to toggle
    if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    }

    // Escape handling is now fully delegated to React components
    // for proper popover-first closing behavior (CategoryInput, FilterDropdown, etc.)
  });
}

/**
 * Set up keyboard event blocker to prevent host page scripts from 
 * intercepting keys (like z, x, c) when overlay is visible.
 * Uses capture phase to intercept events before page scripts.
 */
function setupKeyboardBlocker(): void {
  const blockEvent = (e: KeyboardEvent) => {
    if (!isVisible) return;

    // Allow browser shortcuts (Ctrl/Cmd+key) to work
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Allow navigation and control keys to reach React components
    const allowedKeys = [
      'Escape', 'Tab',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Enter', 'Backspace', 'Delete',
      'Home', 'End', 'PageUp', 'PageDown'
    ];
    if (allowedKeys.includes(e.key)) return;

    // Block propagation to prevent host page from capturing the event
    e.stopPropagation();
  };

  // Use capture phase to intercept before any page handlers
  document.addEventListener('keydown', blockEvent, true);
  document.addEventListener('keyup', blockEvent, true);
  document.addEventListener('keypress', blockEvent, true);
}
