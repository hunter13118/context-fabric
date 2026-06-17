/**
 * Entity Resolution (§7.8) — prototype.
 * Deterministic match on natural_key, with a fuzzy fallback on (entity_type,
 * normalized name). Maintains a per-tenant map of natural_key -> entity id so
 * records from different apps (Slack #acme-project, Salesforce "Acme Corp")
 * resolve into ONE canonical entity. Merges never widen access — access is
 * always enforced per source object downstream.
 */
import type { CanonicalEntity, EntityType } from "../domain/types.js";
import type { CanonicalEntityDraft } from "../connectors/types.js";
import { entityRepo } from "../db/repositories.js";
import { newId } from "../util/ids.js";

export class EntityResolver {
  /** natural_key -> entity id, scoped per tenant. */
  private keyMap = new Map<string, string>();

  constructor(private tenantId: string) {}

  private k(naturalKey: string): string {
    return `${this.tenantId}::${naturalKey}`;
  }

  /** Resolve a draft to an existing entity id or create a new one. Returns the id. */
  resolve(draft: CanonicalEntityDraft): string {
    // 1) Deterministic: exact natural key.
    const mapped = this.keyMap.get(this.k(draft.natural_key));
    if (mapped) {
      this.reinforce(mapped, draft);
      return mapped;
    }

    // 2) Fuzzy: same type + normalized name already present.
    const fuzzy = this.fuzzyMatch(draft.entity_type, draft.name);
    if (fuzzy) {
      this.keyMap.set(this.k(draft.natural_key), fuzzy.id);
      this.reinforce(fuzzy.id, draft);
      return fuzzy.id;
    }

    // 3) Create new.
    const id = newId("ce");
    const entity: CanonicalEntity = {
      id,
      tenant_id: this.tenantId,
      entity_type: draft.entity_type,
      name: draft.name,
      description: draft.description ?? "",
      attributes: draft.attributes ?? {},
      confidence_score: 1.0,
      source_count: 1,
    };
    entityRepo.upsert(entity);
    this.keyMap.set(this.k(draft.natural_key), id);
    return id;
  }

  private fuzzyMatch(type: EntityType, name: string): CanonicalEntity | null {
    const norm = name.trim().toLowerCase();
    const candidates = entityRepo.findByName(this.tenantId, norm.split(" ")[0]);
    for (const c of candidates) {
      if (c.entity_type === type && jaccard(norm, c.name.toLowerCase()) >= 0.6) return c;
    }
    return null;
  }

  /** Merge new attributes and bump source_count/confidence on an existing entity. */
  private reinforce(id: string, draft: CanonicalEntityDraft) {
    const e = entityRepo.get(this.tenantId, id);
    if (!e) return;
    e.attributes = { ...e.attributes, ...(draft.attributes ?? {}) };
    e.source_count += 1;
    e.confidence_score = Math.min(1, e.confidence_score + 0.05);
    if (!e.description && draft.description) e.description = draft.description;
    entityRepo.upsert(e);
  }
}

/** Token Jaccard similarity for cheap fuzzy name matching. */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/));
  const sb = new Set(b.split(/\s+/));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}
