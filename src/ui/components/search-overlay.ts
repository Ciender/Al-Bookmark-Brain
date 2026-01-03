/**
 * AI Bookmark Brain - Search Overlay Component
 * Main search UI using Lit Web Components with Windows 10/11 flat design
 */

import { LitElement, html, css } from 'lit';
import { MESSAGE_TYPES, UI } from '../../shared/constants';
import type { SearchResult, BookmarkWithDetails } from '../../shared/types';

// Simple component without decorators for better build compatibility
export class SearchOverlay extends LitElement {
  // Properties
  visible = false;
  private query = '';
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private isLoading = false;
  private debounceTimer: number | null = null;

  // Windows 10/11 flat design - no border-radius
  static override styles = css`
    :host {
      display: block;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 13px;
    }

    * {
      box-sizing: border-box;
    }

    .overlay-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 10vh;
    }

    .overlay-container {
      width: 750px;
      max-width: 90vw;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }

    /* Dark/Light mode */
    :host {
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --bg-hover: #e5e5e5;
      --bg-selected: #0078d4;
      --text-primary: #1a1a1a;
      --text-secondary: #666666;
      --text-selected: #ffffff;
      --border-color: #d1d1d1;
      --accent: #0078d4;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --bg-primary: #2d2d2d;
        --bg-secondary: #3d3d3d;
        --bg-hover: #4d4d4d;
        --bg-selected: #0078d4;
        --text-primary: #f0f0f0;
        --text-secondary: #a0a0a0;
        --text-selected: #ffffff;
        --border-color: #4d4d4d;
        --accent: #60cdff;
      }
    }

    .search-header {
      display: flex;
      border-bottom: 1px solid var(--border-color);
    }

    .search-input {
      flex: 1;
      padding: 12px 16px;
      border: none;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 14px;
      outline: none;
    }

    .search-input::placeholder {
      color: var(--text-secondary);
    }

    .filter-button {
      padding: 8px 16px;
      border: none;
      border-left: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
    }

    .filter-button:hover {
      background: var(--bg-hover);
    }

    .main-content {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .results-panel {
      flex: 1;
      overflow-y: auto;
      min-width: 350px;
    }

    .result-item {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
    }

    .result-item:hover {
      background: var(--bg-hover);
    }

    .result-item.selected {
      background: var(--bg-selected);
      color: var(--text-selected);
    }

    .result-item.selected .result-url,
    .result-item.selected .result-category {
      color: var(--text-selected);
      opacity: 0.8;
    }

    .result-favicon {
      width: 16px;
      height: 16px;
      margin-right: 10px;
      flex-shrink: 0;
    }

    .result-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .result-title {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-url {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-category {
      font-size: 11px;
      padding: 2px 6px;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      margin-left: 8px;
      flex-shrink: 0;
    }

    .summary-panel {
      width: 280px;
      border-left: 1px solid var(--border-color);
      padding: 12px;
      overflow-y: auto;
      background: var(--bg-secondary);
      resize: horizontal;
      min-width: 200px;
      max-width: 400px;
    }

    .summary-title {
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-primary);
    }

    .summary-text {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-primary);
      margin-bottom: 12px;
    }

    .summary-keywords {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .keyword-tag {
      font-size: 10px;
      padding: 2px 6px;
      background: var(--accent);
      color: white;
      opacity: 0.9;
    }

    .no-results {
      padding: 24px;
      text-align: center;
      color: var(--text-secondary);
    }

    .empty-summary {
      padding: 12px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 12px;
    }
  `;

  override render() {
    if (!this.visible) return html``;

    const selectedResult = this.results[this.selectedIndex];

    return html`
      <div class="overlay-backdrop" @click=${this.handleBackdropClick}>
        <div class="overlay-container" @click=${(e: Event) => e.stopPropagation()}>
          <div class="search-header">
            <input
              class="search-input"
              type="text"
              placeholder="Search bookmarks..."
              .value=${this.query}
              @input=${this.handleInput}
              @keydown=${this.handleKeydown}
            />
            <button class="filter-button">Filter ▾</button>
          </div>
          
          <div class="main-content">
            <div class="results-panel">
              ${this.results.length === 0 && this.query.length > 0
        ? html`<div class="no-results">No results found</div>`
        : this.results.map((result, index) => this.renderResultItem(result, index))
      }
            </div>
            
            <div class="summary-panel">
              ${selectedResult
        ? this.renderSummary(selectedResult.bookmark)
        : html`<div class="empty-summary">Select a bookmark to view summary</div>`
      }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderResultItem(result: SearchResult, index: number) {
    const { bookmark } = result;
    const isSelected = index === this.selectedIndex;

    return html`
      <div
        class="result-item ${isSelected ? 'selected' : ''}"
        @click=${() => this.selectResult(index)}
        @dblclick=${() => this.openResult(bookmark)}
      >
        <img 
          class="result-favicon" 
          src=${bookmark.faviconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'} 
          alt=""
          @error=${(e: Event) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
        />
        <div class="result-content">
          <div class="result-title">${bookmark.originalTitle}</div>
          <div class="result-url">${bookmark.url}</div>
        </div>
        ${bookmark.category
        ? html`<span class="result-category">${bookmark.category.name}</span>`
        : html``
      }
      </div>
    `;
  }

  private renderSummary(bookmark: BookmarkWithDetails) {
    if (!bookmark.summary) {
      return html`<div class="empty-summary">No AI summary available</div>`;
    }

    return html`
      <div class="summary-title">${bookmark.originalTitle}</div>
      <div class="summary-text">${bookmark.summary.summaryText}</div>
      <div class="summary-keywords">
        ${bookmark.tags?.map(tag => html`<span class="keyword-tag">${tag.name}</span>`) || html``}
      </div>
    `;
  }

  private handleBackdropClick() {
    this.hide();
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.query = input.value;
    this.debouncedSearch();
  }

  private handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.requestUpdate();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.requestUpdate();
        break;
      case 'Enter':
        e.preventDefault();
        const selected = this.results[this.selectedIndex];
        if (selected) {
          this.openResult(selected.bookmark);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
    }
  }

  private debouncedSearch() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.performSearch();
    }, UI.SEARCH_DEBOUNCE_MS);
  }

  private async performSearch() {
    if (!this.query.trim()) {
      this.results = [];
      this.requestUpdate();
      return;
    }

    this.isLoading = true;
    try {
      // Send message to background for search
      const response = await new Promise<{ results: SearchResult[] }>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: MESSAGE_TYPES.SEARCH_BOOKMARKS, data: { options: { query: this.query, limit: UI.VISIBLE_RESULTS } } },
          (resp) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(resp);
            }
          }
        );
      });

      this.results = response.results || [];
      this.selectedIndex = 0;
    } catch (error) {
      console.error('Search failed:', error);
      this.results = [];
    } finally {
      this.isLoading = false;
      this.requestUpdate();
    }
  }

  private selectResult(index: number) {
    this.selectedIndex = index;
    this.requestUpdate();
  }

  private openResult(bookmark: BookmarkWithDetails) {
    // Open in new tab
    window.open(bookmark.url, '_blank');
    this.hide();
  }

  public show() {
    this.visible = true;
    this.query = '';
    this.results = [];
    this.selectedIndex = 0;
    this.requestUpdate();

    // Focus input after render
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.search-input') as HTMLInputElement;
      input?.focus();
    });
  }

  public hide() {
    this.visible = false;
    this.query = '';
    this.results = [];
    this.requestUpdate();
  }
}

// Register custom element
customElements.define('bookmark-search-overlay', SearchOverlay);

declare global {
  interface HTMLElementTagNameMap {
    'bookmark-search-overlay': SearchOverlay;
  }
}
