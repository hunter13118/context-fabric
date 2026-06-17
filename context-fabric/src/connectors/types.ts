/**
 * Connector SDK (prototype subset of the spec's §13 interfaces).
 * A connector turns raw source payloads into canonical drafts that the
 * ingestion pipeline persists. Two fixture connectors implement this:
 * Slack and Salesforce.
 */
import type {
  AppType, EntityType, Sensitivity, SourceAcl, TrustTier,
} from "../domain/types.js";

export interface ConnectorMeta {
  appType: AppType;
  displayName: string;
  version: string;
  entityTypes: EntityType[];
}

export interface ExternalObjectDraft {
  external_id: string;
  external_url: string;
  object_type: string;
  title: string;
  raw_metadata: Record<string, unknown>;
  source_acl: SourceAcl;
}

export interface CanonicalEntityDraft {
  /** Stable natural key the entity-resolution layer can match/merge on. */
  natural_key: string;
  entity_type: EntityType;
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
}

export interface ChunkDraft {
  content_type: string;
  content: string;
  sensitivity_label: Sensitivity;
  /** Field-level restrictions carried into the chunk (e.g., ["amount"]). */
  restricted_fields?: string[];
  trust_tier: TrustTier;
  occurred_at: string;
  citation_title: string;
  citation_url: string;
  /** natural_key of the canonical entity this chunk primarily describes. */
  entity_natural_key: string;
}

export interface CanonicalEventDraft {
  external_event_id: string | null;
  event_type: string;
  actor_external_id: string | null;
  occurred_at: string;
  normalized_payload: Record<string, unknown>;
  /** natural_keys of entities this event touches. */
  entity_natural_keys: string[];
}

/** Relationship hint a connector can emit between two natural keys. */
export interface RelationshipDraft {
  source_natural_key: string;
  target_natural_key: string;
  relationship_type: string;
  weight?: number;
}

/** The result of mapping one raw payload. */
export interface MappedPayload {
  object: ExternalObjectDraft;
  entities: CanonicalEntityDraft[];
  chunks: ChunkDraft[];
  event: CanonicalEventDraft;
  relationships: RelationshipDraft[];
}

export interface Connector<Raw = unknown> {
  meta: ConnectorMeta;
  /** Map one raw source payload into canonical drafts. */
  map(raw: Raw): MappedPayload;
  /** Sample fixtures used by the demo and tests. */
  fixtures(): Raw[];
}
