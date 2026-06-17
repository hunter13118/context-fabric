/**
 * Retrieval Orchestrator (§7.12 + §10 algorithm).
 *
 * Steps:
 *  1. identify active entities (hints + name match)
 *  2. graph-expand related entities (1 hop)
 *  3. hybrid search (vector + keyword) over live chunks
 *  4. timeline / recent events (folded in via chunk recency)
 *  5. POLICY FILTER (inline, point-in-time, fail-closed)  <-- enforcement
 *  6. context firewall sanitize (drop quarantined)
 *  7. rank
 *  8. dedupe
 *  9. compress to token budget
 * 10. citations + provenance + confidence
 * 11. audit
 */
import type {
  AppType, CanonicalEntity, ContextChunk, RetrievalRequest, RetrievalResponse,
  RetrievedItem, Sensitivity, Subject,
} from "../domain/types.js";
import { SENSITIVITY_ORDER } from "../domain/types.js";
import { chunkRepo, entityRepo, relationshipRepo } from "../db/repositories.js";
import { resolveSubject } from "../identity/identity.js";
import { PolicyEngine } from "../policy/policyEngine.js";
import { runFirewall } from "../firewall/contextFirewall.js";
import { createEmbeddingService } from "../embedding/embeddingService.js";
import { hybridSearch } from "../embedding/vectorIndex.js";
import { rankScore, redundancyPenalty } from "./ranking.js";
import { audit } from "../audit/auditLog.js";
import { estimateTokens } from "../util/tokens.js";
import { newId, nowIso } from "../util/ids.js";

export interface OrchestratorResult {
  response: RetrievalResponse;
  /** Quarantined-by-firewall count, surfaced for observability. */
  quarantinedCount: number;
}

export class RetrievalOrchestrator {
  private embed = createEmbeddingService();

  async retrieve(req: RetrievalRequest): Promise<OrchestratorResult> {
    const t0 = Date.now();
    const tenantId = req.tenant_id;
    const subject = resolveSubject(tenantId, req.user_id);
    const policy = new PolicyEngine(tenantId);
    const ceiling: Sensitivity = req.sensitivity_ceiling ?? "restricted";
    const maxTokens = req.max_tokens ?? 3000;

    // 1) Active entities.
    const focus = this.identifyEntities(tenantId, req);

    // 2) Graph expand (2 hops, per spec §10).
    const expandedIds = this.graphExpand(tenantId, focus.map((e) => e.id), 2);
    const focusIds = new Set(focus.map((e) => e.id));
    const allEntityIds = new Set<string>([...focusIds, ...expandedIds]);

    // 3) Hybrid search over live chunks (optionally scoped to apps/time).
    let chunks = chunkRepo.allLive(tenantId);
    if (req.allowed_apps) chunks = chunks.filter((c) => req.allowed_apps!.includes(c.app_type));
    if (req.denied_apps) chunks = chunks.filter((c) => !req.denied_apps!.includes(c.app_type));
    if (req.time_window?.from) chunks = chunks.filter((c) => c.occurred_at >= req.time_window!.from!);
    if (req.time_window?.to) chunks = chunks.filter((c) => c.occurred_at <= req.time_window!.to!);

    const queryEmbedding = await this.embed.embed(req.query);
    const candidates = hybridSearch(chunks, queryEmbedding, req.query, 50);

    // Bias toward chunks tied to focus/expanded entities (graph relevance).
    const scoredCandidates = candidates.filter(
      (sc) => !sc.chunk.canonical_entity_id || allEntityIds.size === 0 || allEntityIds.has(sc.chunk.canonical_entity_id)
    );
    const pool = scoredCandidates.length > 0 ? scoredCandidates : candidates;

    // 5) POLICY FILTER — inline, per chunk. Denied items are counted only.
    let deniedCount = 0;
    const permitted: { chunk: ContextChunk; redact: string[]; score: number }[] = [];

    for (const sc of pool) {
      const c = sc.chunk;
      // Sensitivity ceiling from the request (caller-imposed cap).
      if (SENSITIVITY_ORDER.indexOf(c.sensitivity_label) > SENSITIVITY_ORDER.indexOf(ceiling)) {
        deniedCount++;
        continue;
      }
      const entity = c.canonical_entity_id ? entityRepo.get(tenantId, c.canonical_entity_id) : null;
      const res = PolicyEngine.resourceFromChunk(c, entity?.entity_type);
      const decision = policy.evaluate(subject, res, "read");

      audit({
        tenant_id: tenantId,
        actor_user_id: subject.user_id,
        action: decision.effect === "allow" ? "context.permitted" : "policy.denied",
        resource_type: "context_chunk",
        resource_id: c.id,
        app_type: c.app_type,
        decision: decision.effect,
        reason: decision.reason,
        metadata: { redact: decision.redactFields },
      });

      if (decision.effect !== "allow") {
        deniedCount++;
        continue;
      }
      const proximity = c.canonical_entity_id && focusIds.has(c.canonical_entity_id) ? 1 : 0.5;
      permitted.push({
        chunk: c,
        redact: decision.redactFields,
        score: rankScore({ scored: sc, graphProximity: proximity, subject }),
      });
    }

    // 6) Context firewall — sanitize; drop quarantined.
    const fwResults = runFirewall(permitted.map((p) => p.chunk));
    const quarantinedIds = new Set(fwResults.filter((f) => f.quarantined).map((f) => f.chunk.id));
    const sanitizedById = new Map(fwResults.map((f) => [f.chunk.id, f.chunk]));
    const quarantinedCount = quarantinedIds.size;

    let cleaned = permitted
      .filter((p) => !quarantinedIds.has(p.chunk.id))
      .map((p) => ({ ...p, chunk: sanitizedById.get(p.chunk.id)! }));

    // 7) Rank (desc).
    cleaned.sort((a, b) => b.score - a.score);

    // 8 + 9) Dedupe + compress to budget.
    const selectedContents: string[] = [];
    const items: RetrievedItem[] = [];
    let usedTokens = 0;

    for (const p of cleaned) {
      const c = p.chunk;
      const pen = redundancyPenalty(c.content, selectedContents);
      if (pen > 0) continue; // near-duplicate
      const display = this.applyRedaction(c.content, p.redact);
      const cost = estimateTokens(display);
      if (usedTokens + cost > maxTokens && items.length > 0) break; // budget cutoff
      usedTokens += cost;
      selectedContents.push(c.content);
      items.push({
        chunk_id: c.id,
        content_type: c.content_type,
        content: display,
        summary: c.summary ?? this.shortSummary(display),
        sensitivity: c.sensitivity_label,
        freshness_score: c.freshness_score ?? 0,
        importance_score: c.importance_score ?? 0,
        score: Number(p.score.toFixed(4)),
        citation: {
          app: c.citation_app,
          title: c.citation_title,
          url: c.citation_url,
          occurred_at: c.occurred_at,
        },
        redacted_fields: p.redact,
      });
    }

    // 10) Provenance + confidence.
    const sources = [...new Set(items.map((i) => i.citation.app))] as AppType[];
    const confidence: RetrievalResponse["confidence"] =
      items.length === 0 ? "low" : items.length >= 3 && sources.length >= 2 ? "high" : "medium";

    const response: RetrievalResponse = {
      query_id: newId("q"),
      tenant_id: tenantId,
      user_id: subject.user_id,
      entity_focus: focus.map((e) => ({ id: e.id, type: e.entity_type, name: e.name })),
      budget: { max_tokens: maxTokens, used_tokens: usedTokens },
      context: items,
      denied_count: deniedCount,
      denied_summary:
        deniedCount > 0
          ? `${deniedCount} item(s) withheld by policy (not shown).`
          : "No items withheld.",
      provenance: { sources, as_of: nowIso() },
      confidence,
    };

    // 11) Audit the retrieval event.
    audit({
      tenant_id: tenantId,
      actor_user_id: subject.user_id,
      action: "context.retrieved",
      resource_type: "query",
      resource_id: response.query_id,
      decision: "allow",
      reason: req.surface,
      metadata: {
        returned: items.length,
        denied: deniedCount,
        quarantined: quarantinedCount,
        latency_ms: Date.now() - t0,
        sources,
      },
    });

    return { response, quarantinedCount };
  }

  // ---- helpers ----

  private identifyEntities(tenantId: string, req: RetrievalRequest): CanonicalEntity[] {
    const found: CanonicalEntity[] = [];
    const seen = new Set<string>();
    const add = (e: CanonicalEntity) => {
      if (!seen.has(e.id)) { seen.add(e.id); found.push(e); }
    };
    for (const hint of req.active_entity_hints ?? []) {
      for (const e of entityRepo.findByName(tenantId, hint.name)) {
        if (!hint.type || e.entity_type === hint.type) add(e);
      }
    }
    // Fallback: match entity names mentioned in the query text.
    if (found.length === 0) {
      for (const e of entityRepo.all(tenantId)) {
        if (req.query.toLowerCase().includes(e.name.toLowerCase().split(" ")[0])) add(e);
      }
    }
    return found;
  }

  private graphExpand(tenantId: string, entityIds: string[], maxHops = 2): string[] {
    const visited = new Set<string>(entityIds);
    let frontier = [...entityIds];
    const cap = 300; // guard against supernodes
    for (let hop = 0; hop < maxHops && visited.size < cap; hop++) {
      const rels = relationshipRepo.neighbors(tenantId, frontier);
      const next: string[] = [];
      for (const r of rels) {
        for (const id of [r.source_entity_id, r.target_entity_id]) {
          if (!visited.has(id)) { visited.add(id); next.push(id); }
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    // Exclude the original focus ids; caller already has them.
    for (const id of entityIds) visited.delete(id);
    return [...visited];
  }

  private applyRedaction(content: string, fields: string[]): string {
    let out = content;
    for (const f of fields) {
      // Redact "field: value" and "field <number>" patterns for the demo.
      const re = new RegExp(`(${f}\\s*[:=]?\\s*)("?[^",;.]+"?)`, "gi");
      out = out.replace(re, `$1[REDACTED]`);
    }
    return out;
  }

  private shortSummary(content: string): string {
    return content.length <= 160 ? content : content.slice(0, 157) + "...";
  }
}
