/**
 * AI Bookmark Brain - Search Strategy Configuration
 * Configurable search priority with user-defined ordering
 */

// =====================================================
// Types
// =====================================================

/** Searchable fields in bookmarks */
export type SearchField =
    | 'url'
    | 'title'
    | 'tag'
    | 'summary'
    | 'category'
    | 'notes'
    | 'content';

/** Match modes ordered by precision */
export type MatchMode =
    | 'exact_case'      // Case-sensitive exact match
    | 'exact'           // Case-insensitive exact match
    | 'pinyin'          // Pinyin match (Chinese)
    | 'fuzzy';          // Fuzzy/approximate match

/** A single search strategy definition */
export interface SearchStrategy {
    id: string;           // Unique identifier (e.g., 'url_exact_case')
    field: SearchField;   // Which field to search
    matchType: MatchMode; // How to match
    enabled: boolean;     // Whether this strategy is active
    label: string;        // English label
    labelZh: string;      // Chinese label
}

/** User-saved strategy order */
export interface SearchStrategyOrder {
    strategies: Array<{ id: string; enabled: boolean }>;
}

// =====================================================
// Default Strategy Order
// =====================================================

/**
 * Default search strategies in priority order (highest first)
 * 
 * Priority logic:
 * 1. Field order: URL > Title > Tag > Summary > Category > Notes
 * 2. Match order within each field: exact_case > exact > pinyin > fuzzy
 */
export const DEFAULT_SEARCH_STRATEGIES: SearchStrategy[] = [
    // URL - highest priority
    { id: 'url_exact_case', field: 'url', matchType: 'exact_case', enabled: true, label: 'URL (Exact)', labelZh: 'URL（精确）' },
    { id: 'url_exact', field: 'url', matchType: 'exact', enabled: true, label: 'URL (Case-insensitive)', labelZh: 'URL（忽略大小写）' },
    { id: 'url_pinyin', field: 'url', matchType: 'pinyin', enabled: true, label: 'URL (Pinyin)', labelZh: 'URL（拼音）' },
    { id: 'url_fuzzy', field: 'url', matchType: 'fuzzy', enabled: true, label: 'URL (Fuzzy)', labelZh: 'URL（模糊）' },

    // Title - second priority
    { id: 'title_exact_case', field: 'title', matchType: 'exact_case', enabled: true, label: 'Title (Exact)', labelZh: '标题（精确）' },
    { id: 'title_exact', field: 'title', matchType: 'exact', enabled: true, label: 'Title (Case-insensitive)', labelZh: '标题（忽略大小写）' },
    { id: 'title_pinyin', field: 'title', matchType: 'pinyin', enabled: true, label: 'Title (Pinyin)', labelZh: '标题（拼音）' },
    { id: 'title_fuzzy', field: 'title', matchType: 'fuzzy', enabled: true, label: 'Title (Fuzzy)', labelZh: '标题（模糊）' },

    // Tag - third priority
    { id: 'tag_exact_case', field: 'tag', matchType: 'exact_case', enabled: true, label: 'Tag (Exact)', labelZh: '标签（精确）' },
    { id: 'tag_exact', field: 'tag', matchType: 'exact', enabled: true, label: 'Tag (Case-insensitive)', labelZh: '标签（忽略大小写）' },
    { id: 'tag_pinyin', field: 'tag', matchType: 'pinyin', enabled: true, label: 'Tag (Pinyin)', labelZh: '标签（拼音）' },
    { id: 'tag_fuzzy', field: 'tag', matchType: 'fuzzy', enabled: true, label: 'Tag (Fuzzy)', labelZh: '标签（模糊）' },

    // AI Summary - fourth priority (user requested this to be last among main fields)
    { id: 'summary_exact', field: 'summary', matchType: 'exact', enabled: true, label: 'AI Summary', labelZh: 'AI 摘要' },
    { id: 'summary_fuzzy', field: 'summary', matchType: 'fuzzy', enabled: true, label: 'AI Summary (Fuzzy)', labelZh: 'AI 摘要（模糊）' },

    // Lower priority fields
    { id: 'category_exact', field: 'category', matchType: 'exact', enabled: true, label: 'Category', labelZh: '分类' },
    { id: 'category_pinyin', field: 'category', matchType: 'pinyin', enabled: true, label: 'Category (Pinyin)', labelZh: '分类（拼音）' },
    { id: 'notes_exact', field: 'notes', matchType: 'exact', enabled: true, label: 'Notes', labelZh: '笔记' },
    { id: 'notes_fuzzy', field: 'notes', matchType: 'fuzzy', enabled: true, label: 'Notes (Fuzzy)', labelZh: '笔记（模糊）' },
];

// =====================================================
// Helper Functions
// =====================================================

/**
 * Calculate dynamic score based on strategy position
 * Higher position (lower index) = higher score
 * 
 * @param strategyIndex - Position in the strategy list (0 = highest priority)
 * @param totalStrategies - Total number of strategies
 * @returns Score between 40-100 (higher = better match)
 */
export function calculateScore(strategyIndex: number, totalStrategies: number): number {
    // Linear interpolation from 100 (top) to 40 (bottom)
    const maxScore = 100;
    const minScore = 40;
    const ratio = strategyIndex / Math.max(1, totalStrategies - 1);
    return maxScore - ratio * (maxScore - minScore);
}

/**
 * Merge saved user order with default strategies
 * - Preserves user's order and enabled states
 * - Adds any new strategies that weren't in saved config
 * - Removes strategies that no longer exist in defaults
 * 
 * @param savedOrder - User's saved strategy order
 * @returns Merged strategy list
 */
export function loadSearchStrategies(savedOrder: SearchStrategyOrder): SearchStrategy[] {
    if (!savedOrder.strategies || savedOrder.strategies.length === 0) {
        return [...DEFAULT_SEARCH_STRATEGIES];
    }

    // Create a map of default strategies for quick lookup
    const defaultMap = new Map(
        DEFAULT_SEARCH_STRATEGIES.map(s => [s.id, s])
    );

    // Build ordered list from saved order
    const result: SearchStrategy[] = [];
    const usedIds = new Set<string>();

    for (const saved of savedOrder.strategies) {
        const defaultStrategy = defaultMap.get(saved.id);
        if (defaultStrategy) {
            result.push({
                ...defaultStrategy,
                enabled: saved.enabled,
            });
            usedIds.add(saved.id);
        }
    }

    // Add any new strategies that weren't in saved config (at the end)
    for (const defaultStrategy of DEFAULT_SEARCH_STRATEGIES) {
        if (!usedIds.has(defaultStrategy.id)) {
            result.push({ ...defaultStrategy });
        }
    }

    return result;
}

/**
 * Get strategy by ID from active strategies
 */
export function getStrategyById(
    strategies: SearchStrategy[],
    id: string
): SearchStrategy | undefined {
    return strategies.find(s => s.id === id);
}

/**
 * Get all enabled strategies
 */
export function getEnabledStrategies(strategies: SearchStrategy[]): SearchStrategy[] {
    return strategies.filter(s => s.enabled);
}
