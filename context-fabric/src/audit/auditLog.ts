/**
 * Audit Log (§7.15) — append-only with a per-tenant hash chain for tamper
 * evidence. Every sensitive action (retrieval, policy denial, AI request,
 * deletion) is recorded here.
 */
import { createHash } from "node:crypto";
import type { AuditLog } from "../domain/types.js";
import { auditRepo } from "../db/repositories.js";
import { newId, nowIso } from "../util/ids.js";

export interface AuditEntry {
  tenant_id: string;
  actor_user_id: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  app_type?: string | null;
  decision?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Stable serialization used for hashing in BOTH write and verify paths. */
function canonicalBody(r: Omit<AuditLog, "row_hash">): string {
  return JSON.stringify([
    r.id, r.tenant_id, r.actor_user_id, r.action, r.resource_type,
    r.resource_id, r.app_type, r.decision, r.reason, r.metadata,
    r.created_at, r.prev_hash,
  ]);
}

export function audit(entry: AuditEntry): AuditLog {
  const prev_hash = auditRepo.lastHash(entry.tenant_id);
  const base: Omit<AuditLog, "row_hash"> = {
    id: newId("aud"),
    tenant_id: entry.tenant_id,
    actor_user_id: entry.actor_user_id,
    action: entry.action,
    resource_type: entry.resource_type ?? null,
    resource_id: entry.resource_id ?? null,
    app_type: entry.app_type ?? null,
    decision: entry.decision ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? {},
    prev_hash,
    created_at: nowIso(),
  };
  const row_hash = createHash("sha256").update((prev_hash ?? "") + canonicalBody(base)).digest("hex");
  const row: AuditLog = { ...base, row_hash };
  auditRepo.insert(row);
  return row;
}

/** Verify the per-tenant hash chain. Returns true if intact. */
export function verifyChain(tenantId: string): boolean {
  const rows = auditRepo.list(tenantId, 100_000);
  let prev: string | null = null;
  for (const r of rows) {
    if (r.prev_hash !== prev) return false;
    const { row_hash, ...base } = r;
    const expected = createHash("sha256").update((prev ?? "") + canonicalBody(base)).digest("hex");
    if (expected !== row_hash) return false;
    prev = row_hash;
  }
  return true;
}
