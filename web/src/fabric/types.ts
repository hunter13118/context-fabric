/** Browser fabric-core types (mirrors the Node app's domain model, trimmed). */

export const SENSITIVITY_ORDER = ["public", "internal", "confidential", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITY_ORDER)[number];
export type TrustTier = "official_doc" | "ticket" | "chat" | "external_email";

export type EntityType =
  | "account" | "opportunity" | "ticket" | "pull_request" | "repository"
  | "incident" | "meeting" | "person" | "team" | "decision" | "task";

export type AppType =
  | "salesforce" | "slack" | "jira" | "github" | "servicenow" | "calendar" | "email";

export interface User {
  id: string;
  display_name: string;
  title: string;
  roles: string[];
  groups: string[];
}

export interface Entity {
  id: string;
  entity_type: EntityType;
  name: string;
}

export interface Relationship {
  source: string;
  target: string;
  type: string;
}

export interface SourceAcl {
  visible_to: string[];
  private: boolean;
}

export interface Chunk {
  id: string;
  entity_id: string;
  app: AppType;
  content_type: string;
  content: string;
  sensitivity: Sensitivity;
  restricted_fields: string[];
  source_acl: SourceAcl;
  trust_tier: TrustTier;
  occurred_at: string;
  citation_title: string;
  citation_url: string;
  embedding?: number[];
  deleted?: boolean;
}

export type PolicyEffect = "allow" | "deny";

export interface Policy {
  name: string;
  type: "abac" | "field";
  priority: number;
  subject: { roles?: string[]; groups?: string[]; users?: string[]; any?: boolean };
  resource: { sensitivity?: Sensitivity[]; apps?: AppType[]; fields?: string[] };
  effect: PolicyEffect;
}

export interface Subject {
  user_id: string;
  roles: string[];
  groups: string[];
}

export interface Citation {
  app: AppType;
  title: string;
  url: string;
  occurred_at: string;
}

export interface RetrievedItem {
  chunk_id: string;
  content_type: string;
  content: string;
  summary: string;
  sensitivity: Sensitivity;
  score: number;
  citation: Citation;
  redacted_fields: string[];
}

export interface RetrievalResult {
  entity_focus: { id: string; type: EntityType; name: string }[];
  items: RetrievedItem[];
  denied_count: number;
  denied_summary: string;
  used_tokens: number;
  max_tokens: number;
  confidence: "low" | "medium" | "high";
  sources: AppType[];
}

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  decision?: string;
  reason?: string;
  resource?: string;
}
