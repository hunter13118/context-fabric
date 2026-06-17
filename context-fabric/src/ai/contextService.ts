/**
 * Context service — the application-facing API used by every surface
 * (MCP, REST, demo). Wraps retrieval + the AI Gateway into the two core
 * operations: a grounded contextual response, and a structured brief.
 */
import type { RetrievalRequest, RetrievalResponse, EntityType } from "../domain/types.js";
import { RetrievalOrchestrator } from "../retrieval/orchestrator.js";
import { AIGateway } from "./aiGateway.js";
import { SummarizationService, type BandedSummary } from "./summarization.js";
import { entityRepo } from "../db/repositories.js";
import { resolveSubject } from "../identity/identity.js";
import { audit } from "../audit/auditLog.js";

export interface ContextualAnswer {
  answer: string;
  retrieval: RetrievalResponse;
  cost: { prompt_tokens: number; completion_tokens: number; usd: number; provider: string; model: string };
}

export class ContextService {
  private orchestrator = new RetrievalOrchestrator();
  private ai = new AIGateway();

  /** Retrieve only — no model call. */
  async search(req: RetrievalRequest): Promise<RetrievalResponse> {
    const { response } = await this.orchestrator.retrieve(req);
    return response;
  }

  /** Retrieve + ground + answer. */
  async contextualResponse(req: RetrievalRequest): Promise<ContextualAnswer> {
    const { response } = await this.orchestrator.retrieve(req);
    const gen = await this.ai.generate({
      tenant_id: req.tenant_id,
      user_id: req.user_id,
      surface: req.surface,
      request_type: "contextual_response",
      query: req.query,
      context: response.context,
    });
    return {
      answer: gen.answer,
      retrieval: response,
      cost: {
        prompt_tokens: gen.prompt_tokens,
        completion_tokens: gen.completion_tokens,
        usd: Number(gen.estimated_cost.toFixed(6)),
        provider: gen.provider,
        model: gen.model,
      },
    };
  }

  /**
   * ACL-banded entity summary (S-1 fix). Resolves an entity by name/type, then
   * returns the cached summary for the highest access band the caller is fully
   * permitted to see — never blending content above their clearance.
   */
  async entitySummary(params: {
    tenant_id: string;
    user_id: string;
    surface: string;
    entity_name: string;
    entity_type?: EntityType;
  }): Promise<BandedSummary | { denied: true; reason: string }> {
    const matches = entityRepo.findByName(params.tenant_id, params.entity_name)
      .filter((e) => !params.entity_type || e.entity_type === params.entity_type);
    if (matches.length === 0) return { denied: true, reason: "not_found" };
    // Prefer the requested type, else the most-referenced entity.
    const entity = matches.sort((a, b) => b.source_count - a.source_count)[0];

    const subject = resolveSubject(params.tenant_id, params.user_id);
    const svc = new SummarizationService(params.tenant_id);
    const result = await svc.getEntitySummary(entity.id, subject, params.surface);

    audit({
      tenant_id: params.tenant_id, actor_user_id: params.user_id,
      action: "summary.banded", resource_type: "canonical_entity", resource_id: entity.id,
      decision: result ? "allow" : "deny",
      reason: result ? `band:${result.band}` : "no_permitted_band",
      metadata: { cache_hit: result?.cache_hit ?? false },
    });
    return result ?? { denied: true, reason: "no_permitted_content" };
  }

  /** A structured brief for an entity (account/project/ticket/meeting). */
  async brief(params: {
    tenant_id: string;
    user_id: string;
    surface: string;
    brief_type: EntityType;
    entity_name: string;
    max_tokens?: number;
  }): Promise<ContextualAnswer> {
    const query = `Produce a ${params.brief_type} brief for ${params.entity_name}: current status, recent changes, risks, and open items.`;
    return this.contextualResponse({
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      surface: params.surface,
      query,
      active_entity_hints: [{ type: params.brief_type, name: params.entity_name }],
      max_tokens: params.max_tokens ?? 3000,
    });
  }
}
