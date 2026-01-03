/**
 * Type declarations for frecency npm package
 * @see https://github.com/mixmaxhq/frecency
 */

declare module 'frecency' {
    interface FrecencyOptions {
        /** Key for localStorage (will be prefixed with 'frecency_') */
        key: string;
        /** Attribute to use as ID (default: '_id') */
        idAttribute?: string | ((item: unknown) => string | number);
        /** Number of timestamps to save per selection (default: 10) */
        timeStampsLimit?: number;
        /** Maximum number of different IDs to track (default: 100) */
        recentSelectionsLimit?: number;
        /** Weight for exact query matches (default: 1.0) */
        exactQueryMatchWeight?: number;
        /** Weight for substring matches (default: 0.7) */
        subQueryMatchWeight?: number;
        /** Weight for recent selections (default: 0.5) */
        recentSelectionsMatchWeight?: number;
        /** Custom storage provider (default: localStorage) */
        storageProvider?: Storage;
    }

    interface SaveOptions {
        /** The search query */
        searchQuery: string;
        /** The ID of the selected item */
        selectedId: string | number;
    }

    interface SortOptions<T> {
        /** The search query */
        searchQuery: string;
        /** Array of results to sort */
        results: T[];
        /** Keep frecency scores on results (default: false) */
        keepScores?: boolean;
    }

    class Frecency {
        constructor(options: FrecencyOptions);

        /** Record a user selection */
        save(options: SaveOptions): void;

        /** Sort results by frecency */
        sort<T>(options: SortOptions<T>): T[];
    }

    export = Frecency;
}
