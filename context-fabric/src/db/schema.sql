-- Context Fabric — SQLite schema (prototype).
-- Mirrors the Postgres DDL in the architecture spec (§8). JSON columns hold
-- arrays/objects (TEXT). Embeddings stored as JSON float arrays; vector search
-- is done in-process (see vectorIndex.ts) to stay zero-infra.
-- Tenant isolation is enforced in the repository layer (every query is
-- tenant-scoped), standing in for Postgres Row-Level Security.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  domain TEXT
);

CREATE TABLE IF NOT EXISTS app_user (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  email        TEXT NOT NULL,
  display_name TEXT,
  roles        TEXT NOT NULL DEFAULT '[]',
  groups       TEXT NOT NULL DEFAULT '[]',
  attributes   TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS app_connection (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT,
  app_type        TEXT NOT NULL,
  auth_type       TEXT NOT NULL,
  scopes          TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'active',
  token_reference TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_object (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  app_connection_id   TEXT NOT NULL,
  app_type            TEXT NOT NULL,
  external_id         TEXT NOT NULL,
  external_url        TEXT,
  object_type         TEXT NOT NULL,
  title               TEXT,
  raw_metadata        TEXT NOT NULL DEFAULT '{}',
  source_acl          TEXT NOT NULL DEFAULT '{}',
  canonical_entity_id TEXT,
  content_hash        TEXT,
  deleted_at          TEXT
);

CREATE TABLE IF NOT EXISTS canonical_entity (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  attributes       TEXT NOT NULL DEFAULT '{}',
  confidence_score REAL NOT NULL DEFAULT 1.0,
  source_count     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS context_relationship (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  source_entity_id  TEXT NOT NULL,
  target_entity_id  TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence_score  REAL NOT NULL DEFAULT 1.0,
  weight            REAL NOT NULL DEFAULT 1.0,
  evidence          TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS event (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  app_type             TEXT NOT NULL,
  external_event_id    TEXT,
  event_type           TEXT NOT NULL,
  actor_user_id        TEXT,
  external_object_id   TEXT,
  canonical_entity_ids TEXT NOT NULL DEFAULT '[]',
  normalized_payload   TEXT NOT NULL DEFAULT '{}',
  occurred_at          TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS context_chunk (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  canonical_entity_id TEXT,
  source_object_id    TEXT,
  app_type            TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  content             TEXT NOT NULL,
  summary             TEXT,
  embedding           TEXT NOT NULL DEFAULT '[]',
  embedding_model     TEXT,
  sensitivity_label   TEXT NOT NULL DEFAULT 'internal',
  restricted_fields   TEXT NOT NULL DEFAULT '[]',
  source_acl          TEXT NOT NULL DEFAULT '{}',
  trust_tier          TEXT NOT NULL DEFAULT 'chat',
  freshness_score     REAL,
  importance_score    REAL,
  content_hash        TEXT,
  occurred_at         TEXT NOT NULL,
  deleted_at          TEXT,
  citation_app        TEXT NOT NULL,
  citation_title      TEXT NOT NULL,
  citation_url        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_summary (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  canonical_entity_id TEXT,
  summary_type        TEXT NOT NULL,
  summary_text        TEXT NOT NULL,
  source_chunk_ids    TEXT NOT NULL DEFAULT '[]',
  model_used          TEXT,
  token_count         INTEGER,
  sensitivity_label   TEXT NOT NULL DEFAULT 'internal',
  generated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_policy (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  policy_type       TEXT NOT NULL,
  subject_selector  TEXT NOT NULL DEFAULT '{}',
  resource_selector TEXT NOT NULL DEFAULT '{}',
  action            TEXT NOT NULL,
  conditions        TEXT NOT NULL DEFAULT '{}',
  effect            TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  app_type      TEXT,
  decision      TEXT,
  reason        TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  prev_hash     TEXT,
  row_hash      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_request (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  user_id                TEXT,
  surface                TEXT NOT NULL,
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  request_type           TEXT NOT NULL,
  context_chunk_ids      TEXT NOT NULL DEFAULT '[]',
  prompt_token_count     INTEGER,
  completion_token_count INTEGER,
  estimated_cost         REAL,
  cache_hit              INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_tenant_type ON canonical_entity (tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_chunk_tenant_entity ON context_chunk (tenant_id, canonical_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_tenant_source ON context_relationship (tenant_id, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_event_tenant_time ON event (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_log (tenant_id, created_at);
