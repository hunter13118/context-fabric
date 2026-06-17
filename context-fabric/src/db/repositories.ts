/**
 * Repository layer. Every read/write is TENANT-SCOPED — this is the prototype's
 * stand-in for Postgres Row-Level Security. A caller can never query across
 * tenants because tenant_id is a required argument on every method.
 */
import { getDb } from "./database.js";
import type {
  AccessPolicy, AiRequestRecord, AppConnection, AuditLog, CanonicalEntity,
  CanonicalEvent, ContextChunk, ContextRelationship, ContextSummary,
  ExternalObject, Tenant, User,
} from "../domain/types.js";

const j = (v: unknown) => JSON.stringify(v);
const p = <T>(v: string | null | undefined, fallback: T): T =>
  v == null ? fallback : (JSON.parse(v) as T);

// ---------- Tenant / User ----------
export const tenantRepo = {
  upsert(t: Tenant) {
    getDb().prepare(
      `INSERT INTO tenant (id,name,domain) VALUES (@id,@name,@domain)
       ON CONFLICT(id) DO UPDATE SET name=@name, domain=@domain`
    ).run(t);
  },
};

export const userRepo = {
  upsert(u: User) {
    getDb().prepare(
      `INSERT INTO app_user (id,tenant_id,email,display_name,roles,groups,attributes,status)
       VALUES (@id,@tenant_id,@email,@display_name,@roles,@groups,@attributes,@status)
       ON CONFLICT(id) DO UPDATE SET email=@email, display_name=@display_name,
         roles=@roles, groups=@groups, attributes=@attributes, status=@status`
    ).run({ ...u, roles: j(u.roles), groups: j(u.groups), attributes: j(u.attributes) });
  },
  get(tenantId: string, userId: string): User | null {
    const r = getDb().prepare(
      `SELECT * FROM app_user WHERE tenant_id=? AND id=?`
    ).get(tenantId, userId) as any;
    if (!r) return null;
    return {
      ...r,
      roles: p(r.roles, []), groups: p(r.groups, []), attributes: p(r.attributes, {}),
    };
  },
};

export const connectionRepo = {
  upsert(c: AppConnection) {
    getDb().prepare(
      `INSERT INTO app_connection (id,tenant_id,user_id,app_type,auth_type,scopes,status,token_reference)
       VALUES (@id,@tenant_id,@user_id,@app_type,@auth_type,@scopes,@status,@token_reference)
       ON CONFLICT(id) DO UPDATE SET status=@status, scopes=@scopes`
    ).run({ ...c, scopes: j(c.scopes) });
  },
  setStatusByApp(tenantId: string, appType: string, status: string): void {
    getDb().prepare(`UPDATE app_connection SET status=? WHERE tenant_id=? AND app_type=?`)
      .run(status, tenantId, appType);
  },
};

// ---------- Entities / Relationships ----------
export const entityRepo = {
  upsert(e: CanonicalEntity) {
    getDb().prepare(
      `INSERT INTO canonical_entity (id,tenant_id,entity_type,name,description,attributes,confidence_score,source_count)
       VALUES (@id,@tenant_id,@entity_type,@name,@description,@attributes,@confidence_score,@source_count)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description,
         attributes=@attributes, confidence_score=@confidence_score, source_count=@source_count`
    ).run({ ...e, attributes: j(e.attributes) });
  },
  get(tenantId: string, id: string): CanonicalEntity | null {
    const r = getDb().prepare(
      `SELECT * FROM canonical_entity WHERE tenant_id=? AND id=?`
    ).get(tenantId, id) as any;
    return r ? { ...r, attributes: p(r.attributes, {}) } : null;
  },
  findByName(tenantId: string, name: string): CanonicalEntity[] {
    const rows = getDb().prepare(
      `SELECT * FROM canonical_entity WHERE tenant_id=? AND lower(name) LIKE ?`
    ).all(tenantId, `%${name.toLowerCase()}%`) as any[];
    return rows.map((r) => ({ ...r, attributes: p(r.attributes, {}) }));
  },
  all(tenantId: string): CanonicalEntity[] {
    const rows = getDb().prepare(`SELECT * FROM canonical_entity WHERE tenant_id=?`).all(tenantId) as any[];
    return rows.map((r) => ({ ...r, attributes: p(r.attributes, {}) }));
  },
};

export const relationshipRepo = {
  upsert(r: ContextRelationship) {
    getDb().prepare(
      `INSERT INTO context_relationship (id,tenant_id,source_entity_id,target_entity_id,relationship_type,confidence_score,weight,evidence)
       VALUES (@id,@tenant_id,@source_entity_id,@target_entity_id,@relationship_type,@confidence_score,@weight,@evidence)
       ON CONFLICT(id) DO UPDATE SET weight=@weight, confidence_score=@confidence_score`
    ).run({ ...r, evidence: j(r.evidence) });
  },
  /** Neighbors of a set of entities (1 hop, both directions). */
  neighbors(tenantId: string, entityIds: string[]): ContextRelationship[] {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => "?").join(",");
    const rows = getDb().prepare(
      `SELECT * FROM context_relationship WHERE tenant_id=?
       AND (source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders}))`
    ).all(tenantId, ...entityIds, ...entityIds) as any[];
    return rows.map((r) => ({ ...r, evidence: p(r.evidence, {}) }));
  },
};

// ---------- External objects / Events ----------
export const externalObjectRepo = {
  upsert(o: ExternalObject) {
    getDb().prepare(
      `INSERT INTO external_object (id,tenant_id,app_connection_id,app_type,external_id,external_url,object_type,title,raw_metadata,source_acl,canonical_entity_id,content_hash,deleted_at)
       VALUES (@id,@tenant_id,@app_connection_id,@app_type,@external_id,@external_url,@object_type,@title,@raw_metadata,@source_acl,@canonical_entity_id,@content_hash,@deleted_at)
       ON CONFLICT(id) DO UPDATE SET canonical_entity_id=@canonical_entity_id, deleted_at=@deleted_at`
    ).run({ ...o, raw_metadata: j(o.raw_metadata), source_acl: j(o.source_acl) });
  },
};

export const eventRepo = {
  insert(e: CanonicalEvent) {
    getDb().prepare(
      `INSERT INTO event (id,tenant_id,app_type,external_event_id,event_type,actor_user_id,external_object_id,canonical_entity_ids,normalized_payload,occurred_at,received_at,status)
       VALUES (@id,@tenant_id,@app_type,@external_event_id,@event_type,@actor_user_id,@external_object_id,@canonical_entity_ids,@normalized_payload,@occurred_at,@received_at,@status)`
    ).run({ ...e, canonical_entity_ids: j(e.canonical_entity_ids), normalized_payload: j(e.normalized_payload) });
  },
  /** Timeline: recent events touching any of the given entities, within an optional window. */
  timeline(tenantId: string, entityIds: string[], from?: string, to?: string, limit = 50): CanonicalEvent[] {
    const rows = getDb().prepare(
      `SELECT * FROM event WHERE tenant_id=? ORDER BY occurred_at DESC LIMIT 500`
    ).all(tenantId) as any[];
    const set = new Set(entityIds);
    return rows
      .map((r) => ({ ...r, canonical_entity_ids: p<string[]>(r.canonical_entity_ids, []), normalized_payload: p(r.normalized_payload, {}) }))
      .filter((e) => e.canonical_entity_ids.some((id: string) => set.has(id)))
      .filter((e) => (!from || e.occurred_at >= from) && (!to || e.occurred_at <= to))
      .slice(0, limit);
  },
};

// ---------- Chunks ----------
export const chunkRepo = {
  insert(c: ContextChunk) {
    getDb().prepare(
      `INSERT INTO context_chunk (id,tenant_id,canonical_entity_id,source_object_id,app_type,content_type,content,summary,embedding,embedding_model,sensitivity_label,restricted_fields,source_acl,trust_tier,freshness_score,importance_score,content_hash,occurred_at,deleted_at,citation_app,citation_title,citation_url)
       VALUES (@id,@tenant_id,@canonical_entity_id,@source_object_id,@app_type,@content_type,@content,@summary,@embedding,@embedding_model,@sensitivity_label,@restricted_fields,@source_acl,@trust_tier,@freshness_score,@importance_score,@content_hash,@occurred_at,@deleted_at,@citation_app,@citation_title,@citation_url)`
    ).run({
      ...c,
      embedding: j(c.embedding), restricted_fields: j(c.restricted_fields), source_acl: j(c.source_acl),
    });
  },
  /** All live (non-deleted) chunks for a tenant — vector/keyword search runs over this in-process. */
  allLive(tenantId: string): ContextChunk[] {
    const rows = getDb().prepare(
      `SELECT * FROM context_chunk WHERE tenant_id=? AND deleted_at IS NULL`
    ).all(tenantId) as any[];
    return rows.map(hydrateChunk);
  },
  tombstone(tenantId: string, chunkId: string, at: string) {
    getDb().prepare(`UPDATE context_chunk SET deleted_at=? WHERE tenant_id=? AND id=?`).run(at, tenantId, chunkId);
  },
  /** Live chunks, optionally filtered to one app or one entity. */
  liveBy(tenantId: string, opts: { app?: string; entityId?: string }): ContextChunk[] {
    return this.allLive(tenantId).filter(
      (c) => (!opts.app || c.app_type === opts.app) && (!opts.entityId || c.canonical_entity_id === opts.entityId)
    );
  },
};

function hydrateChunk(r: any): ContextChunk {
  return {
    ...r,
    embedding: p(r.embedding, []),
    restricted_fields: p(r.restricted_fields, []),
    source_acl: p(r.source_acl, { visible_to: [], private: false, sensitivity_hint: "internal" }),
  };
}

// ---------- Summaries ----------
export const summaryRepo = {
  upsert(s: ContextSummary) {
    getDb().prepare(
      `INSERT INTO context_summary (id,tenant_id,canonical_entity_id,summary_type,summary_text,source_chunk_ids,model_used,token_count,sensitivity_label,generated_at)
       VALUES (@id,@tenant_id,@canonical_entity_id,@summary_type,@summary_text,@source_chunk_ids,@model_used,@token_count,@sensitivity_label,@generated_at)
       ON CONFLICT(id) DO UPDATE SET summary_text=@summary_text, source_chunk_ids=@source_chunk_ids, generated_at=@generated_at`
    ).run({ ...s, source_chunk_ids: j(s.source_chunk_ids) });
  },
  get(tenantId: string, entityId: string, type: string): ContextSummary | null {
    const r = getDb().prepare(
      `SELECT * FROM context_summary WHERE tenant_id=? AND canonical_entity_id=? AND summary_type=?`
    ).get(tenantId, entityId, type) as any;
    return r ? { ...r, source_chunk_ids: p(r.source_chunk_ids, []) } : null;
  },
  /** Invalidate cached summaries that reference any of the given chunk ids. */
  invalidateByChunks(tenantId: string, chunkIds: string[]): number {
    if (chunkIds.length === 0) return 0;
    const set = new Set(chunkIds);
    const rows = getDb().prepare(`SELECT id, source_chunk_ids FROM context_summary WHERE tenant_id=?`).all(tenantId) as any[];
    let n = 0;
    for (const r of rows) {
      const ids = p<string[]>(r.source_chunk_ids, []);
      if (ids.some((id) => set.has(id))) {
        getDb().prepare(`DELETE FROM context_summary WHERE id=?`).run(r.id);
        n++;
      }
    }
    return n;
  },
};

// ---------- Policies ----------
export const policyRepo = {
  upsert(pol: AccessPolicy) {
    getDb().prepare(
      `INSERT INTO access_policy (id,tenant_id,name,policy_type,subject_selector,resource_selector,action,conditions,effect,priority)
       VALUES (@id,@tenant_id,@name,@policy_type,@subject_selector,@resource_selector,@action,@conditions,@effect,@priority)
       ON CONFLICT(id) DO UPDATE SET subject_selector=@subject_selector, resource_selector=@resource_selector, effect=@effect, priority=@priority`
    ).run({
      ...pol,
      subject_selector: j(pol.subject_selector), resource_selector: j(pol.resource_selector), conditions: j(pol.conditions),
    });
  },
  all(tenantId: string): AccessPolicy[] {
    const rows = getDb().prepare(`SELECT * FROM access_policy WHERE tenant_id=? ORDER BY priority ASC`).all(tenantId) as any[];
    return rows.map((r) => ({
      ...r,
      subject_selector: p(r.subject_selector, {}), resource_selector: p(r.resource_selector, {}), conditions: p(r.conditions, {}),
    }));
  },
};

// ---------- Audit / AI requests ----------
export const auditRepo = {
  // Order by the monotonic rowid (insertion order), NOT created_at — many audit
  // rows share a millisecond, so created_at is not a stable ordering key and
  // would break the hash chain. rowid guarantees insert order per tenant.
  lastHash(tenantId: string): string | null {
    const r = getDb().prepare(
      `SELECT row_hash FROM audit_log WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1`
    ).get(tenantId) as any;
    return r?.row_hash ?? null;
  },
  insert(a: AuditLog) {
    getDb().prepare(
      `INSERT INTO audit_log (id,tenant_id,actor_user_id,action,resource_type,resource_id,app_type,decision,reason,metadata,prev_hash,row_hash,created_at)
       VALUES (@id,@tenant_id,@actor_user_id,@action,@resource_type,@resource_id,@app_type,@decision,@reason,@metadata,@prev_hash,@row_hash,@created_at)`
    ).run({ ...a, metadata: j(a.metadata) });
  },
  list(tenantId: string, limit = 100): AuditLog[] {
    const rows = getDb().prepare(
      `SELECT * FROM audit_log WHERE tenant_id=? ORDER BY rowid ASC LIMIT ?`
    ).all(tenantId, limit) as any[];
    return rows.map((r) => ({ ...r, metadata: p(r.metadata, {}) }));
  },
};

export const aiRequestRepo = {
  insert(a: AiRequestRecord) {
    getDb().prepare(
      `INSERT INTO ai_request (id,tenant_id,user_id,surface,provider,model,request_type,context_chunk_ids,prompt_token_count,completion_token_count,estimated_cost,cache_hit,created_at)
       VALUES (@id,@tenant_id,@user_id,@surface,@provider,@model,@request_type,@context_chunk_ids,@prompt_token_count,@completion_token_count,@estimated_cost,@cache_hit,@created_at)`
    ).run({ ...a, context_chunk_ids: j(a.context_chunk_ids), cache_hit: a.cache_hit ? 1 : 0 });
  },
  totalCost(tenantId: string): { tokens: number; usd: number; calls: number } {
    const r = getDb().prepare(
      `SELECT COALESCE(SUM(prompt_token_count+completion_token_count),0) AS tokens,
              COALESCE(SUM(estimated_cost),0) AS usd, COUNT(*) AS calls
       FROM ai_request WHERE tenant_id=?`
    ).get(tenantId) as any;
    return { tokens: r.tokens, usd: r.usd, calls: r.calls };
  },
};
