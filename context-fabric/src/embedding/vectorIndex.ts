/**
 * In-process hybrid search over a tenant's live chunks.
 * Vector search = cosine over stored embeddings.
 * Keyword search = token-overlap (BM25-lite) for exact-term matches.
 * In production these map to pgvector ANN + Postgres FTS / OpenSearch (§7.11).
 */
import type { ContextChunk } from "../domain/types.js";
import { cosine } from "./embeddingService.js";

export interface ScoredChunk {
  chunk: ContextChunk;
  vectorScore: number;
  keywordScore: number;
}

function keywordScore(query: string, content: string): number {
  const q = new Set(
    query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2)
  );
  if (q.size === 0) return 0;
  const words = content.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  let hits = 0;
  for (const w of words) if (q.has(w)) hits++;
  // Normalize by query size; saturate.
  return Math.min(1, hits / q.size);
}

export function hybridSearch(
  chunks: ContextChunk[],
  queryEmbedding: number[],
  queryText: string,
  k: number
): ScoredChunk[] {
  const scored = chunks.map((chunk) => ({
    chunk,
    vectorScore: cosine(queryEmbedding, chunk.embedding),
    keywordScore: keywordScore(queryText, chunk.content),
  }));
  // Combined candidate score for shortlisting; final ranking happens in ranking.ts.
  scored.sort(
    (a, b) =>
      Math.max(b.vectorScore, b.keywordScore) - Math.max(a.vectorScore, a.keywordScore)
  );
  return scored.slice(0, k);
}
