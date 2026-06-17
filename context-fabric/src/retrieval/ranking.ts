/**
 * Ranking formula (§10.3). Combines relevance, freshness, authority, source
 * quality, role affinity, and graph proximity, minus a redundancy penalty.
 */
import type { Subject, TrustTier } from "../domain/types.js";
import type { ScoredChunk } from "../embedding/vectorIndex.js";

export const WEIGHTS = {
  rel: 0.4,
  fresh: 0.15,
  auth: 0.12,
  qual: 0.1,
  role: 0.1,
  graph: 0.13,
  pen: 0.1,
};

const AUTHORITY: Record<TrustTier, number> = {
  official_doc: 1.0,
  ticket: 0.8,
  chat: 0.5,
  external_email: 0.3,
};

export interface RankInput {
  scored: ScoredChunk;
  /** 1/(1+hops) to the focus entity. */
  graphProximity: number;
  subject: Subject;
}

export function rankScore(input: RankInput): number {
  const { scored, graphProximity, subject } = input;
  const c = scored.chunk;

  const relevance = Math.max(scored.vectorScore, scored.keywordScore);
  const freshness = c.freshness_score ?? 0.5;
  const authority = AUTHORITY[c.trust_tier] ?? 0.5;
  const quality = c.importance_score ?? 0.5;

  // Role affinity: boost if the chunk's source is visible to the subject's
  // groups/role context (cheap proxy: subject is explicitly in the ACL).
  const roleAffinity = c.source_acl.visible_to.includes(subject.user_id) ? 1 : 0.5;

  return (
    WEIGHTS.rel * relevance +
    WEIGHTS.fresh * freshness +
    WEIGHTS.auth * authority +
    WEIGHTS.qual * quality +
    WEIGHTS.role * roleAffinity +
    WEIGHTS.graph * graphProximity
  );
}

/** Redundancy penalty applied greedily as items are selected (§10 step 8). */
export function redundancyPenalty(candidate: string, selectedContents: string[]): number {
  for (const s of selectedContents) {
    if (jaccardSim(candidate, s) > 0.8) return WEIGHTS.pen;
  }
  return 0;
}

function jaccardSim(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}
