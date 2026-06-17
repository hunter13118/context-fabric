/**
 * ACL-banded summary cache — the S-1 hardening from the spec (§22.1).
 *
 * Problem (S-1): a cached summary built from chunks of MIXED sensitivity can
 * leak higher-classified content to a reader cleared only for lower bands,
 * because the summary is a reusable derived artifact.
 *
 * Fix: generate and cache ONE summary PER ACCESS BAND. A band-B summary is built
 * only from chunks at or below band B. A reader is mapped to the highest band B
 * for which policy permits EVERY source chunk of that band (per-source
 * re-check) — so the summary they receive never contains content they couldn't
 * read directly. Summaries are cached per (entity, band) and reused across all
 * readers in that band (cost optimization §19), keyed on the exact source-chunk
 * set so they invalidate when the underlying content changes.
 *
 * Tradeoff (interview point): banding trades granularity for cacheability +
 * safety. A reader denied a single confidential chunk drops to the internal
 * band and loses ALL confidential context, even chunks they could see. The
 * alternative (per-reader re-filtering) is more granular but defeats caching.
 */
import type { ContextChunk, Sensitivity, Subject } from "../domain/types.js";
import { SENSITIVITY_ORDER } from "../domain/types.js";
import { chunkRepo, entityRepo, summaryRepo } from "../db/repositories.js";
import { PolicyEngine } from "../policy/policyEngine.js";
import { AIGateway } from "./aiGateway.js";
import { contentHash, nowIso } from "../util/ids.js";

export interface BandedSummary {
  entity_id: string;
  entity_name: string;
  band: Sensitivity;
  summary: string;
  citations: { app: string; title: string; url: string; occurred_at: string }[];
  source_chunk_count: number;
  cache_hit: boolean;
}

const rank = (s: Sensitivity) => SENSITIVITY_ORDER.indexOf(s);

export class SummarizationService {
  private ai = new AIGateway();
  constructor(private tenantId: string) {}

  /**
   * Return the banded summary appropriate for `subject`, or null if the reader
   * is permitted to see nothing about the entity.
   */
  async getEntitySummary(entityId: string, subject: Subject, surface: string): Promise<BandedSummary | null> {
    const entity = entityRepo.get(this.tenantId, entityId);
    if (!entity) return null;
    const policy = new PolicyEngine(this.tenantId);
    // Field-restricted chunks (e.g. a Salesforce record with a finance-only
    // `amount`) are EXCLUDED from banded summaries: field redaction is
    // reader-specific and can't be applied safely inside a cached free-text
    // summary, so that content is served only via per-field-redacted retrieval.
    const allChunks = chunkRepo
      .liveBy(this.tenantId, { entityId })
      .filter((c) => c.restricted_fields.length === 0);

    // Candidate bands = the sensitivities actually present among the entity's
    // chunks, highest first. (Iterating all four would mislabel a reader who can
    // see everything as "restricted" even when nothing is restricted-level.)
    const presentBands = [...new Set(allChunks.map((c) => c.sensitivity_label))]
      .sort((a, b) => rank(b) - rank(a));

    for (const band of presentBands) {
      const bandChunks = allChunks.filter((c) => rank(c.sensitivity_label) <= rank(band));
      if (bandChunks.length === 0) continue;

      // The reader must be permitted on EVERY chunk in this band (no leakage).
      const permitted = bandChunks.every(
        (c) => policy.evaluate(subject, PolicyEngine.resourceFromChunk(c, entity.entity_type), "read").effect === "allow"
      );
      if (!permitted) continue;

      const { text, cacheHit } = await this.getOrGenerate(entity.id, band, bandChunks, subject, surface);
      return {
        entity_id: entity.id,
        entity_name: entity.name,
        band,
        summary: text,
        citations: bandChunks.map((c) => ({
          app: c.citation_app, title: c.citation_title, url: c.citation_url, occurred_at: c.occurred_at,
        })),
        source_chunk_count: bandChunks.length,
        cache_hit: cacheHit,
      };
    }
    return null;
  }

  /** Cache per (entity, band), keyed on the exact source-chunk set. */
  private async getOrGenerate(
    entityId: string, band: Sensitivity, chunks: ContextChunk[], subject: Subject, surface: string
  ): Promise<{ text: string; cacheHit: boolean }> {
    const type = `entity_band_${band}`;
    const currentKey = this.chunkSetKey(chunks);
    const cached = summaryRepo.get(this.tenantId, entityId, type);
    if (cached && this.chunkSetKey(undefined, cached.source_chunk_ids) === currentKey) {
      return { text: cached.summary_text, cacheHit: true };
    }
    const { text, model } = await this.ai.summarize({
      tenant_id: this.tenantId, user_id: subject.user_id, surface,
      entity_id: entityId, band,
      parts: chunks.map((c) => ({ content: c.content, summary: c.summary })),
    });
    summaryRepo.upsert({
      id: `sum_${entityId}_${band}`,
      tenant_id: this.tenantId,
      canonical_entity_id: entityId,
      summary_type: type as any,
      summary_text: text,
      source_chunk_ids: chunks.map((c) => c.id),
      model_used: model,
      token_count: text.length,
      sensitivity_label: band,
      generated_at: nowIso(),
    });
    return { text, cacheHit: false };
  }

  /** Order-independent key over a set of chunk ids (so reordering isn't a miss). */
  private chunkSetKey(chunks?: ContextChunk[], ids?: string[]): string {
    const list = (chunks ? chunks.map((c) => c.id) : ids ?? []).slice().sort();
    return contentHash(list.join("|"));
  }
}
