/**
 * AI Bookmark Brain - Cosine Similarity
 * Reserved interface for embedding-based semantic search
 */

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-k most similar items by cosine similarity
 */
export function findTopKSimilar<T>(
    queryEmbedding: number[],
    items: Array<{ item: T; embedding: number[] }>,
    k: number = 10
): Array<{ item: T; similarity: number }> {
    const scored = items.map(({ item, embedding }) => ({
        item,
        similarity: cosineSimilarity(queryEmbedding, embedding),
    }));

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, k);
}

/**
 * Reserved: Semantic search interface
 * This will be implemented when embedding support is added
 */
export interface SemanticSearchOptions {
    queryEmbedding: number[];
    threshold?: number;
    limit?: number;
}

/**
 * Reserved: Perform semantic search using embeddings
 * TODO: Implement when database stores embeddings
 */
export async function semanticSearch(
    _options: SemanticSearchOptions
): Promise<Array<{ bookmarkId: number; similarity: number }>> {
    // Placeholder for future implementation
    return [];
}
