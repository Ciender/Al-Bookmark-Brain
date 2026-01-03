/**
 * AI Bookmark Brain - Category Store (Zustand)
 * Centralized state management for categories
 * All components subscribe to this store for real-time sync
 * 
 * KEY DESIGN: Database-first updates - always refresh from DB after mutations
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { MESSAGE_TYPES } from '../../../shared/constants';
import type { Category } from '../../../shared/types';

interface CategoryState {
    categories: Category[];
    isLoading: boolean;
    isInitialized: boolean;
    lastUpdated: number;
}

interface CategoryActions {
    /** Initialize store - call once on app start */
    initialize: () => Promise<void>;

    /** Force refresh categories from database */
    refresh: () => Promise<void>;

    /** Create a new category - refreshes from DB after */
    createCategory: (name: string, color?: string) => Promise<Category | null>;

    /** Delete a category - refreshes from DB after */
    deleteCategory: (id: number) => Promise<boolean>;

    /** Set category for a bookmark */
    setBookmarkCategory: (bookmarkId: number, categoryId: number | null) => Promise<boolean>;
}

type CategoryStore = CategoryState & CategoryActions;

// Helper to send messages to background script
async function sendMessage<T>(type: string, data?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response as T);
            }
        });
    });
}

export const useCategoryStore = create<CategoryStore>()(
    subscribeWithSelector((set, get) => ({
        // State
        categories: [],
        isLoading: false,
        isInitialized: false,
        lastUpdated: 0,

        // Initialize - called once by root component
        initialize: async () => {
            if (get().isInitialized) return;
            set({ isInitialized: true });
            await get().refresh();
        },

        // Refresh from database - THE source of truth
        refresh: async () => {
            set({ isLoading: true });
            try {
                const response = await sendMessage<{ categories: Category[] }>(
                    MESSAGE_TYPES.CATEGORY_LIST
                );
                const categories = response?.categories || [];
                console.log('[CategoryStore] Refreshed:', categories.length, 'categories');
                set({
                    categories,
                    isLoading: false,
                    lastUpdated: Date.now(),
                });
            } catch (error) {
                console.error('[CategoryStore] Failed to refresh:', error);
                set({ isLoading: false });
            }
        },

        // Create category - return immediately, don't refresh yet
        // (new category has no bookmarks, so GET_ALL_CATEGORIES would filter it out)
        // setBookmarkCategory will refresh after assigning the bookmark
        createCategory: async (name: string, color?: string) => {
            try {
                console.log('[CategoryStore] Creating category:', name);
                const response = await sendMessage<{ success: boolean; category: Category }>(
                    MESSAGE_TYPES.CATEGORY_CREATE,
                    { name, color }
                );
                if (response?.success && response.category) {
                    console.log('[CategoryStore] Category created:', response.category.name);
                    return response.category;
                }
                return null;
            } catch (error) {
                console.error('[CategoryStore] Failed to create category:', error);
                return null;
            }
        },

        // Delete category - DB first, then refresh
        deleteCategory: async (id: number) => {
            try {
                console.log('[CategoryStore] Deleting category:', id);
                const response = await sendMessage<{ success: boolean }>(
                    MESSAGE_TYPES.CATEGORY_DELETE,
                    { id }
                );
                if (response?.success) {
                    // Refresh from DB to ensure consistency
                    await get().refresh();
                    console.log('[CategoryStore] Category deleted:', id);
                    return true;
                }
                return false;
            } catch (error) {
                console.error('[CategoryStore] Failed to delete category:', error);
                return false;
            }
        },

        // Set bookmark category - refresh to update bookmark counts
        setBookmarkCategory: async (bookmarkId: number, categoryId: number | null) => {
            try {
                console.log('[CategoryStore] Setting bookmark category:', bookmarkId, '->', categoryId);
                const response = await sendMessage<{ success: boolean }>(
                    MESSAGE_TYPES.SET_BOOKMARK_CATEGORY,
                    { bookmarkId, categoryId }
                );
                if (response?.success) {
                    // Refresh to update category list (since we filter by bookmark count)
                    await get().refresh();
                    return true;
                }
                return false;
            } catch (error) {
                console.error('[CategoryStore] Failed to set bookmark category:', error);
                return false;
            }
        },
    }))
);

// Selector hooks for optimized re-renders
export const useCategories = () => useCategoryStore(state => state.categories);

/**
 * Get stable action references without subscribing to state changes.
 * Actions are stored in the Zustand store and are stable across renders.
 * Using getState() avoids unnecessary re-renders when categories change.
 */
export const useCategoryActions = () => {
    // Actions from Zustand store are stable - getState() doesn't create subscriptions
    const store = useCategoryStore.getState();
    return {
        initialize: store.initialize,
        refresh: store.refresh,
        createCategory: store.createCategory,
        deleteCategory: store.deleteCategory,
        setBookmarkCategory: store.setBookmarkCategory,
    };
};

// Individual action hooks for granular subscriptions
export const useRefreshCategories = () => useCategoryStore(state => state.refresh);
export const useCreateCategory = () => useCategoryStore(state => state.createCategory);
export const useDeleteCategory = () => useCategoryStore(state => state.deleteCategory);

// Direct access for non-React code
export const categoryStoreApi = useCategoryStore;
