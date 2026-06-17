/**
 * Canonical domain model for Context Fabric.
 * Mirrors the entities in the architecture spec (§8) adapted for the
 * zero-infra TypeScript/SQLite prototype.
 */

export type EntityType =
  | "account"
  | "client"
  | "opportunity"
  | "project"
  | "ticket"
  | "document"
  | "repository"
  | "pull_request"
  | "incident"
  | "meeting"
  | "person"
  | "team"
  | "decision"
  | "task"
  | "metric";

export type AppType =
  | "salesforce"
  | "slack"
  | "jira"
  | "github"
  | "gdrive"
  | "sharepoint"
  | "servicenow"
  | "notion"
  | "email"
  | "calendar";

/** Ordered from least to most sensitive. Index is used for ceiling comparisons. */
export const SENSITIVITY_ORDER = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type Sensitivity = (typeof SENSITIVITY_ORDER)[number];

/** Trust tier for the Context Firewall (§12): higher = more trustworthy source. */
export type TrustTier = "official_doc" | "ticket" | "chat" | "external_email";

export interface Tenant {
  id: string;
  name: string;
  domain: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  roles: string[];
  groups: string[];
  /** Arbitrary ABAC attributes (department, region, clearance, …). */
  attributes: Record<string, unknown>;
  status: "active" | "suspended" | "deprovisioned";
}

export interface AppConnection {
  id: string;
  tenant_id: string;
  user_id: string | null;
  app_type: AppType;
  auth_type: "oauth" | "service_account" | "pat";
  scopes: string[];
  status: "active" | "degraded" | "revoked" | "error";
  token_reference: string;
}

/** Normalized source permission fingerprint produced by a connector's PermissionMapper. */
export interface SourceAcl {
  /** Principals (user ids, group ids, "public") allowed to read the source object. */
  visible_to: string[];
  /** Whether the source object is private/DM-like. */
  private: boolean;
  /** Connector-suggested sensitivity hint. */
  sensitivity_hint: Sensitivity;
}

export interface ExternalObject {
  id: string;
  tenant_id: string;
  app_connection_id: string;
  app_type: AppType;
  external_id: string;
  external_url: string;
  object_type: string;
  title: string;
  raw_metadata: Record<string, unknown>;
  source_acl: SourceAcl;
  canonical_entity_id: string | null;
  content_hash: string;
  deleted_at: string | null;
}

export interface CanonicalEntity {
  id: string;
  tenant_id: string;
  entity_type: EntityType;
  name: string;
  description: string;
  attributes: Record<string, unknown>;
  confidence_score: number;
  source_count: number;
}

export interface ContextRelationship {
  id: string;
  tenant_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence_score: number;
  weight: number;
  evidence: Record<string, unknown>;
}

export interface CanonicalEvent {
  id: string;
  tenant_id: string;
  app_type: AppType;
  external_event_id: string | null;
  event_type: string;
  actor_user_id: string | null;
  external_object_id: string | null;
  canonical_entity_ids: string[];
  normalized_payload: Record<string, unknown>;
  occurred_at: string;
  received_at: string;
  status: "received" | "normalized" | "resolved" | "indexed" | "failed";
}

export interface ContextChunk {
  id: string;
  tenant_id: string;
  canonical_entity_id: string | null;
  source_object_id: string | null;
  app_type: AppType;
  content_type: string;
  content: string;
  summary: string | null;
  embedding: number[];
  embedding_model: string;
  sensitivity_label: Sensitivity;
  /** Optional explicit per-field restriction list (field-level security demo). */
  restricted_fields: string[];
  source_acl: SourceAcl;
  trust_tier: TrustTier;
  freshness_score: number;
  importance_score: number;
  content_hash: string;
  occurred_at: string;
  deleted_at: string | null;
  /** Citation metadata. */
  citation_app: AppType;
  citation_title: string;
  citation_url: string;
}

export interface ContextSummary {
  id: string;
  tenant_id: string;
  canonical_entity_id: string | null;
  summary_type: "short" | "entity" | "timeline" | "decision" | "task" | "executive";
  summary_text: string;
  source_chunk_ids: string[];
  model_used: string;
  token_count: number;
  sensitivity_label: Sensitivity;
  generated_at: string;
}

export type PolicyEffect = "allow" | "deny";
export type PolicyAction = "read" | "share" | "export" | "ai_use" | "write";

export interface AccessPolicy {
  id: string;
  tenant_id: string;
  name: string;
  policy_type: "rbac" | "abac" | "sharing" | "field" | "retention" | "legal_hold" | "consent";
  subject_selector: {
    roles?: string[];
    groups?: string[];
    users?: string[];
    attrs?: Record<string, unknown>;
    any?: boolean;
  };
  resource_selector: {
    entity_types?: EntityType[];
    sensitivity?: Sensitivity[];
    apps?: AppType[];
    fields?: string[];
    entity_ids?: string[];
  };
  action: PolicyAction;
  conditions: Record<string, unknown>;
  effect: PolicyEffect;
  priority: number;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  app_type: string | null;
  decision: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  prev_hash: string | null;
  row_hash: string;
  created_at: string;
}

export interface AiRequestRecord {
  id: string;
  tenant_id: string;
  user_id: string | null;
  surface: string;
  provider: string;
  model: string;
  request_type: string;
  context_chunk_ids: string[];
  prompt_token_count: number;
  completion_token_count: number;
  estimated_cost: number;
  cache_hit: boolean;
  created_at: string;
}

/** A subject (caller) resolved for policy evaluation. */
export interface Subject {
  user_id: string;
  tenant_id: string;
  roles: string[];
  groups: string[];
  attributes: Record<string, unknown>;
}

/** A citation surfaced with retrieved context. */
export interface Citation {
  app: AppType;
  title: string;
  url: string;
  occurred_at: string;
}

/** A single permitted, ranked context item returned by retrieval. */
export interface RetrievedItem {
  chunk_id: string;
  content_type: string;
  content: string;
  summary: string | null;
  sensitivity: Sensitivity;
  freshness_score: number;
  importance_score: number;
  score: number;
  citation: Citation;
  /** Fields that were redacted by policy obligations. */
  redacted_fields: string[];
}

export interface RetrievalRequest {
  tenant_id: string;
  user_id: string;
  query: string;
  surface: string;
  active_entity_hints?: { type?: EntityType; name: string }[];
  allowed_apps?: AppType[];
  denied_apps?: AppType[];
  time_window?: { from?: string; to?: string };
  max_tokens?: number;
  sensitivity_ceiling?: Sensitivity;
}

export interface RetrievalResponse {
  query_id: string;
  tenant_id: string;
  user_id: string;
  entity_focus: { id: string; type: EntityType; name: string }[];
  budget: { max_tokens: number; used_tokens: number };
  context: RetrievedItem[];
  denied_count: number;
  denied_summary: string;
  provenance: { sources: AppType[]; as_of: string };
  confidence: "low" | "medium" | "high";
}
