/**
 * Embedding service with a pluggable provider (§7.11 + AI Gateway abstraction).
 *
 * Default "mock" provider produces a DETERMINISTIC bag-of-words hashed
 * embedding so the whole system runs offline with no API key, while still
 * yielding meaningful cosine similarity (shared terms -> higher similarity).
 *
 * Set CF_EMBED_PROVIDER=openai (+ CF_AI_API_KEY) to use real embeddings.
 */
import { config } from "../config.js";

const DIM = config.embedDim;

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "with", "as", "at", "by", "it", "this", "that", "be", "from",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** FNV-1a hash -> bucket index. */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % DIM;
}

export function mockEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) v[hashToken(t)] += 1;
  // L2 normalize so cosine similarity == dot product.
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function openaiEmbed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

export interface EmbeddingService {
  model: string;
  embed(text: string): Promise<number[]>;
}

export function createEmbeddingService(): EmbeddingService {
  if (config.embedProvider === "openai" && config.aiApiKey) {
    return { model: "text-embedding-3-small", embed: openaiEmbed };
  }
  return { model: "mock-hash-256", embed: async (t: string) => mockEmbed(t) };
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}
