/**
 * Deletion / revocation propagation (spec Workflow E, §16-E).
 *
 * When a connection is revoked or a subject exercises right-to-delete, the
 * derived context must disappear everywhere it was used. This service performs
 * the cascade and records a content-free audit tombstone so deletion can be
 * proven without retaining the data.
 *
 * Cascade: tombstone chunks -> (vectors live on the chunk row, so tombstoning
 * removes them from retrieval) -> invalidate cached summaries -> audit.
 * Legal hold blocks deletion (flagged for admin) — modeled via a hold check.
 */
import { chunkRepo, connectionRepo, summaryRepo } from "../db/repositories.js";
import { audit } from "../audit/auditLog.js";
import { nowIso } from "../util/ids.js";

export interface RevocationResult {
  scope: string;
  chunks_tombstoned: number;
  summaries_invalidated: number;
  blocked_by_legal_hold: number;
}

export class RevocationService {
  constructor(
    private tenantId: string,
    /** Entity ids currently under legal hold (deletion is blocked for these). */
    private legalHoldEntityIds: Set<string> = new Set()
  ) {}

  /** Revoke an app connection and purge its derived context. */
  revokeApp(appType: string, actorUserId: string | null): RevocationResult {
    const targets = chunkRepo.liveBy(this.tenantId, { app: appType });
    return this.purge(targets, `app:${appType}`, actorUserId, () =>
      connectionRepo.setStatusByApp(this.tenantId, appType, "revoked")
    );
  }

  /** Right-to-delete / source-delete for a single entity's context. */
  deleteEntity(entityId: string, actorUserId: string | null): RevocationResult {
    const targets = chunkRepo.liveBy(this.tenantId, { entityId });
    return this.purge(targets, `entity:${entityId}`, actorUserId);
  }

  private purge(
    targets: { id: string; canonical_entity_id: string | null }[],
    scope: string,
    actorUserId: string | null,
    sideEffect?: () => void
  ): RevocationResult {
    const at = nowIso();
    let tombstoned = 0;
    let blocked = 0;
    const tombstonedIds: string[] = [];

    for (const c of targets) {
      if (c.canonical_entity_id && this.legalHoldEntityIds.has(c.canonical_entity_id)) {
        blocked++;
        audit({
          tenant_id: this.tenantId, actor_user_id: actorUserId,
          action: "deletion.blocked_legal_hold", resource_type: "context_chunk",
          resource_id: c.id, decision: "deny", reason: "legal_hold",
        });
        continue;
      }
      chunkRepo.tombstone(this.tenantId, c.id, at);
      tombstonedIds.push(c.id);
      tombstoned++;
    }

    const summaries = summaryRepo.invalidateByChunks(this.tenantId, tombstonedIds);
    sideEffect?.();

    // Content-free tombstone proving the deletion happened.
    audit({
      tenant_id: this.tenantId, actor_user_id: actorUserId,
      action: "deletion.propagated", resource_type: "scope", resource_id: scope,
      decision: "allow", reason: "revocation",
      metadata: { chunks_tombstoned: tombstoned, summaries_invalidated: summaries, blocked_by_legal_hold: blocked },
    });

    return { scope, chunks_tombstoned: tombstoned, summaries_invalidated: summaries, blocked_by_legal_hold: blocked };
  }
}
