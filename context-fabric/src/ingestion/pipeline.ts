/**
 * Ingestion pipeline (§6.1 write path).
 * raw payload -> connector.map -> normalize (Event + ExternalObject)
 *   -> entity resolution -> relationships -> chunk + embed -> persist.
 */
import type { Connector } from "../connectors/types.js";
import type {
  AppType, CanonicalEvent, ContextChunk, ExternalObject,
} from "../domain/types.js";
import {
  chunkRepo, entityRepo, eventRepo, externalObjectRepo, relationshipRepo,
} from "../db/repositories.js";
import { EntityResolver } from "./entityResolution.js";
import { createEmbeddingService } from "../embedding/embeddingService.js";
import { contentHash, newId, nowIso } from "../util/ids.js";

/** Freshness decay (half-life in days varies by content type). */
function freshness(occurredAt: string, contentType: string): number {
  const halfLife: Record<string, number> = {
    slack_message: 3, salesforce_change: 7, ticket_field: 14, doc_section: 90,
  };
  const hl = halfLife[contentType] ?? 14;
  const ageDays = (Date.now() - new Date(occurredAt).getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(0, ageDays) / hl);
}

export class IngestionPipeline {
  private embed = createEmbeddingService();
  /** One resolver shared across ALL connectors so a Jira ticket, its GitHub
   *  PRs, and Slack threads resolve into a single linked entity cluster. */
  private resolver: EntityResolver;

  constructor(
    private tenantId: string,
    private connectionIdByApp: Record<AppType, string>
  ) {
    this.resolver = new EntityResolver(tenantId);
  }

  /** Ingest one connector's full fixture set. Returns count of chunks created. */
  async ingestConnector<Raw>(connector: Connector<Raw>): Promise<number> {
    const resolver = this.resolver;
    let chunkCount = 0;

    for (const raw of connector.fixtures()) {
      const mapped = connector.map(raw);
      const appType = connector.meta.appType;
      const connectionId = this.connectionIdByApp[appType];

      // Resolve entities first so we have ids for objects/chunks/relationships.
      const idByKey = new Map<string, string>();
      for (const e of mapped.entities) idByKey.set(e.natural_key, resolver.resolve(e));

      // External object.
      const primaryEntityId = idByKey.get(mapped.chunks[0]?.entity_natural_key ?? "") ?? null;
      const obj: ExternalObject = {
        id: newId("eo"),
        tenant_id: this.tenantId,
        app_connection_id: connectionId,
        app_type: appType,
        external_id: mapped.object.external_id,
        external_url: mapped.object.external_url,
        object_type: mapped.object.object_type,
        title: mapped.object.title,
        raw_metadata: mapped.object.raw_metadata,
        source_acl: mapped.object.source_acl,
        canonical_entity_id: primaryEntityId,
        content_hash: contentHash(JSON.stringify(mapped.object.raw_metadata)),
        deleted_at: null,
      };
      externalObjectRepo.upsert(obj);

      // Canonical event.
      const evt: CanonicalEvent = {
        id: newId("ev"),
        tenant_id: this.tenantId,
        app_type: appType,
        external_event_id: mapped.event.external_event_id,
        event_type: mapped.event.event_type,
        actor_user_id: mapped.event.actor_external_id,
        external_object_id: obj.id,
        canonical_entity_ids: mapped.event.entity_natural_keys
          .map((k) => idByKey.get(k))
          .filter((x): x is string => !!x),
        normalized_payload: mapped.event.normalized_payload,
        occurred_at: mapped.event.occurred_at,
        received_at: nowIso(),
        status: "indexed",
      };
      eventRepo.insert(evt);

      // Relationships.
      for (const r of mapped.relationships) {
        const src = idByKey.get(r.source_natural_key);
        const tgt = idByKey.get(r.target_natural_key);
        if (!src || !tgt) continue;
        relationshipRepo.upsert({
          id: newId("rel"),
          tenant_id: this.tenantId,
          source_entity_id: src,
          target_entity_id: tgt,
          relationship_type: r.relationship_type,
          confidence_score: 1.0,
          weight: r.weight ?? 1.0,
          evidence: { app: appType, event: evt.external_event_id },
        });
      }

      // Chunks + embeddings.
      for (const cd of mapped.chunks) {
        const entityId = idByKey.get(cd.entity_natural_key) ?? primaryEntityId;
        const embedding = await this.embed.embed(cd.content);
        const chunk: ContextChunk = {
          id: newId("cc"),
          tenant_id: this.tenantId,
          canonical_entity_id: entityId,
          source_object_id: obj.id,
          app_type: appType,
          content_type: cd.content_type,
          content: cd.content,
          summary: null,
          embedding,
          embedding_model: this.embed.model,
          sensitivity_label: cd.sensitivity_label,
          restricted_fields: cd.restricted_fields ?? [],
          source_acl: mapped.object.source_acl,
          trust_tier: cd.trust_tier,
          freshness_score: freshness(cd.occurred_at, cd.content_type),
          importance_score: cd.sensitivity_label === "confidential" ? 0.9 : 0.6,
          content_hash: contentHash(cd.content),
          occurred_at: cd.occurred_at,
          deleted_at: null,
          citation_app: appType,
          citation_title: cd.citation_title,
          citation_url: cd.citation_url,
        };
        chunkRepo.insert(chunk);
        chunkCount++;
      }
    }
    return chunkCount;
  }
}
