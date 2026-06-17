/** Resolve a User into a Subject for policy evaluation (§7.2). */
import type { Subject } from "../domain/types.js";
import { userRepo } from "../db/repositories.js";

export function resolveSubject(tenantId: string, userId: string): Subject {
  const u = userRepo.get(tenantId, userId);
  if (!u) {
    // Unknown subject -> empty privileges. Combined with default-deny this
    // means an unknown caller sees nothing.
    return { user_id: userId, tenant_id: tenantId, roles: [], groups: [], attributes: {} };
  }
  return {
    user_id: u.id,
    tenant_id: tenantId,
    roles: u.roles,
    groups: u.groups,
    attributes: u.attributes,
  };
}
