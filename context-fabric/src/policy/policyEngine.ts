/**
 * Policy Engine v1 (§7.14) — the enforcement boundary.
 *
 * Decision order:
 *   1) Tenant isolation (hard fail-closed if mismatched).
 *   2) Source-ACL check — the CORE INVARIANT: the caller must be in the source
 *      object's visible_to set (or it must be public). This is what guarantees
 *      "AI view ⊆ user's source view".
 *   3) Declarative policies (RBAC/ABAC/field), deny-overrides, priority order.
 *   4) Default-deny.
 *
 * Returns allow/deny + reason code + obligations (e.g., redact fields).
 * Fail-closed: any error or unknown state => deny.
 */
import type {
  AccessPolicy, ContextChunk, PolicyAction, Sensitivity, Subject,
} from "../domain/types.js";
import { SENSITIVITY_ORDER } from "../domain/types.js";
import { policyRepo } from "../db/repositories.js";

export type ReasonCode =
  | "allow"
  | "tenant_mismatch"
  | "not_shared_with_you"
  | "insufficient_role"
  | "sensitivity_ceiling"
  | "field_restricted"
  | "explicit_deny"
  | "default_deny";

export interface PolicyDecision {
  effect: "allow" | "deny";
  reason: ReasonCode;
  /** Fields to redact from the resource if allowed (field-level obligation). */
  redactFields: string[];
  matchedPolicy?: string;
}

export interface ResourceContext {
  tenant_id: string;
  app_type: string;
  entity_type?: string;
  sensitivity: Sensitivity;
  source_visible_to: string[];
  source_public: boolean;
  restricted_fields: string[];
}

function sensitivityRank(s: Sensitivity): number {
  return SENSITIVITY_ORDER.indexOf(s);
}

function subjectMatches(sel: AccessPolicy["subject_selector"], subj: Subject): boolean {
  if (sel.any) return true;
  if (sel.users?.includes(subj.user_id)) return true;
  if (sel.roles?.some((r) => subj.roles.includes(r))) return true;
  if (sel.groups?.some((g) => subj.groups.includes(g))) return true;
  if (sel.attrs) {
    const ok = Object.entries(sel.attrs).every(([k, v]) => subj.attributes[k] === v);
    if (ok && Object.keys(sel.attrs).length > 0) return true;
  }
  return false;
}

function resourceMatches(sel: AccessPolicy["resource_selector"], res: ResourceContext): boolean {
  if (sel.apps && !sel.apps.includes(res.app_type as any)) return false;
  if (sel.entity_types && res.entity_type && !sel.entity_types.includes(res.entity_type as any)) return false;
  if (sel.sensitivity && !sel.sensitivity.includes(res.sensitivity)) return false;
  return true;
}

export class PolicyEngine {
  private policies: AccessPolicy[];

  constructor(private tenantId: string) {
    this.policies = policyRepo.all(tenantId);
  }

  /** Evaluate a single resource for a subject. */
  evaluate(subject: Subject, res: ResourceContext, action: PolicyAction): PolicyDecision {
    try {
      // 1) Tenant isolation.
      if (subject.tenant_id !== this.tenantId || res.tenant_id !== this.tenantId) {
        return { effect: "deny", reason: "tenant_mismatch", redactFields: [] };
      }

      // 2) Source-ACL invariant. The caller must be able to see the source.
      const inAcl = res.source_public || res.source_visible_to.includes(subject.user_id);
      // Admins still cannot bypass source ACLs in this prototype — permission
      // parity is intentional. (A real system might allow audited break-glass.)
      if (!inAcl) {
        return { effect: "deny", reason: "not_shared_with_you", redactFields: [] };
      }

      // 3) Declarative policies, lowest priority number first; deny-overrides.
      let decided: PolicyDecision | null = null;
      const redactFields = new Set<string>();

      for (const pol of this.policies) {
        if (pol.action !== action && pol.action !== "read") continue;
        if (!subjectMatches(pol.subject_selector, subject)) continue;
        if (!resourceMatches(pol.resource_selector, res)) continue;

        if (pol.policy_type === "field" && pol.effect === "deny") {
          // Field-level restriction: allow the record but redact the fields,
          // UNLESS the subject is granted by another allow policy on those fields.
          for (const f of pol.resource_selector.fields ?? []) {
            if (res.restricted_fields.includes(f)) redactFields.add(f);
          }
          continue;
        }
        if (pol.effect === "deny") {
          return { effect: "deny", reason: "explicit_deny", redactFields: [], matchedPolicy: pol.name };
        }
        if (pol.effect === "allow" && !decided) {
          decided = { effect: "allow", reason: "allow", redactFields: [], matchedPolicy: pol.name };
        }
      }

      // Field-grant: a subject with role granting the restricted field keeps it.
      const fieldGrant = this.policies.find(
        (p) => p.policy_type === "field" && p.effect === "allow" && subjectMatches(p.subject_selector, subject)
      );
      if (fieldGrant) {
        for (const f of fieldGrant.resource_selector.fields ?? []) redactFields.delete(f);
      }

      // Sensitivity ceiling is applied by the orchestrator via request; here we
      // only enforce explicit policy + ACL. If an allow matched, grant it.
      if (decided) {
        decided.redactFields = [...redactFields];
        return decided;
      }

      // 4) If the subject is in the ACL and no deny matched, default to allow
      //    at/under "internal"; require an explicit allow for confidential+.
      if (sensitivityRank(res.sensitivity) <= sensitivityRank("internal")) {
        return { effect: "allow", reason: "allow", redactFields: [...redactFields] };
      }
      // Confidential+ needs an explicit allow policy or field grant.
      return { effect: "deny", reason: "insufficient_role", redactFields: [] };
    } catch {
      // Fail-closed.
      return { effect: "deny", reason: "default_deny", redactFields: [] };
    }
  }

  /** Convenience: build a ResourceContext from a chunk. */
  static resourceFromChunk(c: ContextChunk, entityType?: string): ResourceContext {
    return {
      tenant_id: c.tenant_id,
      app_type: c.app_type,
      entity_type: entityType,
      sensitivity: c.sensitivity_label,
      source_visible_to: c.source_acl.visible_to,
      source_public: !c.source_acl.private && c.source_acl.visible_to.includes("public"),
      restricted_fields: c.restricted_fields,
    };
  }
}
