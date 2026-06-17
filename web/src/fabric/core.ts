/**
 * Browser fabric-core — the same algorithms as the Node app, running entirely
 * in-memory with no dependencies. Powers the client-side demo flow.
 *
 * Mirrors: policy engine (source-ACL + RBAC/ABAC + field redaction, deny-overrides,
 * fail-closed), 2-hop graph expansion, hybrid retrieval + ranking, context firewall,
 * ACL-banded summaries, and meeting-brief synthesis.
 */
import {
  SENSITIVITY_ORDER, type AppType, type AuditEntry, type Chunk, type Entity,
  type EntityType, type Policy, type RetrievalResult, type RetrievedItem,
  type Sensitivity, type Subject, type TrustTier, type User,
} from "./types.js";
import { CHUNKS, ENTITIES, POLICIES, RELATIONSHIPS, USERS } from "./fixtures.js";

const rank = (s: Sensitivity) => SENSITIVITY_ORDER.indexOf(s);

// ---------- mock embeddings (deterministic, offline) ----------
const DIM = 256;
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "with", "as", "at", "by", "it", "this", "that", "be", "from"]);
const tokenize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
function hashTok(t: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % DIM;
}
export function mockEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const t of tokenize(text)) v[hashTok(t)] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}
function keywordScore(q: string, content: string): number {
  const qs = new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  if (qs.size === 0) return 0;
  let hits = 0;
  for (const w of content.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) if (qs.has(w)) hits++;
  return Math.min(1, hits / qs.size);
}

const estTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
const estDays = (iso: string) => (Date.parse("2026-06-15T00:00:00Z") - Date.parse(iso)) / 86_400_000;

// ---------- the store ----------
export class Fabric {
  chunks: Chunk[];
  entities = ENTITIES;
  rels = RELATIONSHIPS;
  policies: Policy[] = POLICIES;
  users = USERS;
  audit: AuditEntry[] = [];

  constructor() {
    this.chunks = CHUNKS.map((c) => ({ ...c, embedding: mockEmbed(c.content) }));
  }

  user(id: string): User | undefined { return this.users.find((u) => u.id === id); }
  private subject(id: string): Subject {
    const u = this.user(id);
    return { user_id: id, roles: u?.roles ?? [], groups: u?.groups ?? [] };
  }
  private entity(id: string): Entity | undefined { return this.entities.find((e) => e.id === id); }

  private log(e: AuditEntry) { this.audit.push(e); }

  // ---------- policy (the enforcement boundary) ----------
  evaluate(subject: Subject, chunk: Chunk): { effect: "allow" | "deny"; reason: string; redact: string[] } {
    try {
      const inAcl = (!chunk.source_acl.private && chunk.source_acl.visible_to.includes("public")) ||
        chunk.source_acl.visible_to.includes(subject.user_id);
      if (!inAcl) return { effect: "deny", reason: "not_shared_with_you", redact: [] };

      const redact = new Set<string>();
      const sorted = [...this.policies].sort((a, b) => a.priority - b.priority);
      for (const p of sorted) {
        if (!this.subjectMatch(p.subject, subject)) continue;
        if (!this.resourceMatch(p.resource, chunk)) continue;
        if (p.type === "field" && p.effect === "deny") {
          for (const f of p.resource.fields ?? []) if (chunk.restricted_fields.includes(f)) redact.add(f);
          continue;
        }
        if (p.effect === "deny") return { effect: "deny", reason: "explicit_deny", redact: [] };
      }
      // field grant removes redaction
      const grant = sorted.find((p) => p.type === "field" && p.effect === "allow" && this.subjectMatch(p.subject, subject));
      if (grant) for (const f of grant.resource.fields ?? []) redact.delete(f);

      // confidential+ needs an explicit allow (clearance); internal default-allow
      if (rank(chunk.sensitivity) >= rank("confidential")) {
        const cleared = sorted.some((p) => p.type === "abac" && p.effect === "allow" &&
          this.subjectMatch(p.subject, subject) && (p.resource.sensitivity ?? []).includes(chunk.sensitivity));
        if (!cleared) return { effect: "deny", reason: "insufficient_clearance", redact: [] };
      }
      return { effect: "allow", reason: "allow", redact: [...redact] };
    } catch {
      return { effect: "deny", reason: "fail_closed", redact: [] };
    }
  }
  private subjectMatch(sel: Policy["subject"], s: Subject): boolean {
    if (sel.any) return true;
    if (sel.users?.includes(s.user_id)) return true;
    if (sel.roles?.some((r) => s.roles.includes(r))) return true;
    if (sel.groups?.some((g) => s.groups.includes(g))) return true;
    return false;
  }
  private resourceMatch(sel: Policy["resource"], c: Chunk): boolean {
    if (sel.apps && !sel.apps.includes(c.app)) return false;
    if (sel.sensitivity && !sel.sensitivity.includes(c.sensitivity)) return false;
    return true;
  }

  // ---------- graph (2-hop) ----------
  private graphExpand(ids: string[], maxHops = 2): Set<string> {
    const visited = new Set(ids);
    let frontier = [...ids];
    for (let h = 0; h < maxHops; h++) {
      const next: string[] = [];
      for (const r of this.rels) {
        for (const [a, b] of [[r.source, r.target], [r.target, r.source]]) {
          if (frontier.includes(a) && !visited.has(b)) { visited.add(b); next.push(b); }
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return visited;
  }

  private findEntities(query: string, hints: string[]): Entity[] {
    const out: Entity[] = [];
    const seen = new Set<string>();
    const add = (e?: Entity) => { if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); } };
    for (const h of hints) {
      for (const e of this.entities) if (e.name.toLowerCase().includes(h.toLowerCase())) add(e);
    }
    if (out.length === 0) {
      const q = query.toLowerCase();
      for (const e of this.entities) if (q.includes(e.name.toLowerCase().split(/[ :–-]/)[0])) add(e);
    }
    return out;
  }

  // ---------- context firewall ----------
  private firewall(content: string): { content: string; quarantined: boolean } {
    const patterns = [
      /ignore (all|any|the) (previous|prior|above) (instructions|prompts)/i,
      /reveal (your|the) (system prompt|instructions|api key|secret)/i,
      /\bexfiltrate\b|\bsend (all|the) (data|secrets|tokens)\b/i,
    ];
    let hits = 0;
    for (const re of patterns) if (re.test(content)) hits++;
    const clean = content.replace(/<\/?[a-z][^>]*>/gi, " ");
    return { content: clean, quarantined: hits >= 1 };
  }

  // ---------- retrieval ----------
  retrieve(userId: string, query: string, opts: { hints?: string[]; maxTokens?: number; maxItems?: number; ceiling?: Sensitivity } = {}): RetrievalResult {
    const subject = this.subject(userId);
    const maxTokens = opts.maxTokens ?? 2500;
    const maxItems = opts.maxItems ?? 50;
    const ceiling = opts.ceiling ?? "restricted";
    const hints = opts.hints ?? [];

    const focus = this.findEntities(query, hints);
    const reachable = this.graphExpand(focus.map((e) => e.id), 2);
    const focusIds = new Set(focus.map((e) => e.id));

    const qEmb = mockEmbed(query);
    let denied = 0;
    const scored: { item: RetrievedItem; content: string; score: number }[] = [];

    for (const c of this.chunks) {
      if (c.deleted) continue;
      if (reachable.size > 0 && !reachable.has(c.entity_id)) continue;
      if (rank(c.sensitivity) > rank(ceiling)) { denied++; continue; }

      const d = this.evaluate(subject, c);
      this.log({ ts: new Date().toISOString(), actor: userId, action: d.effect === "allow" ? "context.permitted" : "policy.denied", decision: d.effect, reason: d.reason, resource: c.id });
      if (d.effect !== "allow") { denied++; continue; }

      const fw = this.firewall(c.content);
      if (fw.quarantined) { denied++; continue; }

      const vec = cosine(qEmb, c.embedding!);
      const kw = keywordScore(query, c.content);
      const relevance = Math.max(vec, kw);
      const authority: Record<TrustTier, number> = { official_doc: 1, ticket: 0.8, chat: 0.5, external_email: 0.3 };
      const freshness = Math.pow(0.5, Math.max(0, estDays(c.occurred_at)) / 14);
      const proximity = focusIds.has(c.entity_id) ? 1 : 0.5;
      const score = 0.45 * relevance + 0.15 * freshness + 0.12 * authority[c.trust_tier] + 0.15 * proximity + 0.13 * (c.sensitivity === "confidential" ? 0.9 : 0.6);

      const display = this.applyRedaction(fw.content, d.redact);
      scored.push({
        content: c.content, score,
        item: {
          chunk_id: c.id, content_type: c.content_type, content: display,
          summary: display.length <= 160 ? display : display.slice(0, 157) + "...",
          sensitivity: c.sensitivity, score: Number(score.toFixed(3)),
          citation: { app: c.app, title: c.citation_title, url: c.citation_url, occurred_at: c.occurred_at },
          redacted_fields: d.redact,
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const items: RetrievedItem[] = [];
    const picked: string[] = [];
    let used = 0;
    for (const s of scored) {
      if (items.length >= maxItems) break;
      if (picked.some((p) => this.jaccard(p, s.content) > 0.8)) continue;
      const cost = estTokens(s.item.content);
      if (used + cost > maxTokens && items.length > 0) break;
      used += cost; picked.push(s.content); items.push(s.item);
    }

    const sources = [...new Set(items.map((i) => i.citation.app))] as AppType[];
    const confidence = items.length === 0 ? "low" : items.length >= 3 && sources.length >= 2 ? "high" : "medium";
    this.log({ ts: new Date().toISOString(), actor: userId, action: "context.retrieved", reason: `${items.length} returned, ${denied} withheld` });

    return {
      entity_focus: focus.map((e) => ({ id: e.id, type: e.entity_type, name: e.name })),
      items, denied_count: denied,
      denied_summary: denied > 0 ? `${denied} item(s) withheld by policy (not shown).` : "No items withheld.",
      used_tokens: used, max_tokens: maxTokens, confidence, sources,
    };
  }

  private applyRedaction(content: string, fields: string[]): string {
    let out = content;
    for (const f of fields) out = out.replace(new RegExp(`(${f}\\s*[:=]?\\s*)("?[^",;.]+"?)`, "gi"), `$1[REDACTED]`);
    return out;
  }
  private jaccard(a: string, b: string): number {
    const sa = new Set(a.toLowerCase().split(/\s+/)), sb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sa].filter((x) => sb.has(x)).length;
    const uni = new Set([...sa, ...sb]).size;
    return uni === 0 ? 0 : inter / uni;
  }

  // ---------- ACL-banded summary (S-1) ----------
  bandedSummary(userId: string, entityName: string, entityType?: EntityType):
    { band: Sensitivity; summary: string; source_count: number; cache_hit: boolean } | { denied: true } {
    const subject = this.subject(userId);
    const entity = this.entities.find((e) => e.name.toLowerCase().includes(entityName.toLowerCase()) && (!entityType || e.entity_type === entityType));
    if (!entity) return { denied: true };
    const all = this.chunks.filter((c) => !c.deleted && c.entity_id === entity.id && c.restricted_fields.length === 0);
    const present = [...new Set(all.map((c) => c.sensitivity))].sort((a, b) => rank(b) - rank(a));

    for (const band of present) {
      const bandChunks = all.filter((c) => rank(c.sensitivity) <= rank(band));
      if (bandChunks.length === 0) continue;
      const ok = bandChunks.every((c) => this.evaluate(subject, c).effect === "allow");
      if (!ok) continue;
      const key = `${entity.id}:${band}:` + bandChunks.map((c) => c.id).sort().join(",");
      const cacheHit = this.summaryCache.has(key);
      let text = this.summaryCache.get(key);
      if (!text) {
        text = `[${band} band] ` + bandChunks.map((c) => c.content).join(" ");
        this.summaryCache.set(key, text);
      }
      this.log({ ts: new Date().toISOString(), actor: userId, action: "summary.banded", reason: `band:${band} cache:${cacheHit}`, resource: entity.id });
      return { band, summary: text, source_count: bandChunks.length, cache_hit: cacheHit };
    }
    return { denied: true };
  }
  private summaryCache = new Map<string, string>();

  // ---------- meeting brief (UC4) ----------
  meetingBrief(userId: string, meetingName: string):
    { meeting: string; account?: string; sections: { title: string; items: RetrievedItem[] }[]; withheld: number; confidence: string } | null {
    const meeting = this.entities.find((e) => e.entity_type === "meeting" && e.name.toLowerCase().includes(meetingName.toLowerCase()));
    if (!meeting) return null;
    let account: Entity | undefined;
    for (const r of this.rels) {
      const other = r.source === meeting.id ? r.target : r.target === meeting.id ? r.source : null;
      if (other) { const e = this.entity(other); if (e?.entity_type === "account") account = e; }
    }
    const hints = [account?.name ?? meeting.name, meeting.name];
    const queries: { title: string; q: string }[] = [
      { title: "Deal status & open opportunities", q: "opportunity stage amount close date deal status" },
      { title: "Recent customer email", q: "email customer requirements concerns pricing" },
      { title: "Engineering & ticket status", q: "ticket implementation SSO SCIM acceptance criteria status" },
      { title: "Incidents & escalations", q: "incident escalation outage impact severity" },
      { title: "Risks & open items", q: "risk concern blocker pending approval next steps" },
    ];
    const seen = new Set<string>();
    let withheld = 0;
    const sections: { title: string; items: RetrievedItem[] }[] = [];
    for (const sq of queries) {
      const r = this.retrieve(userId, sq.q, { hints, maxItems: 3 });
      withheld += r.denied_count;
      const items = r.items.filter((i) => !seen.has(i.chunk_id)).slice(0, 3);
      items.forEach((i) => seen.add(i.chunk_id));
      if (items.length) sections.push({ title: sq.title, items });
    }
    this.log({ ts: new Date().toISOString(), actor: userId, action: "brief.meeting", reason: `${sections.length} sections`, resource: meeting.id });
    return {
      meeting: meeting.name, account: account?.name, sections, withheld,
      confidence: sections.length >= 3 ? "high" : sections.length >= 1 ? "medium" : "low",
    };
  }

  // ---------- deletion / revocation (Workflow E) ----------
  revokeApp(userId: string, app: AppType): number {
    let n = 0;
    for (const c of this.chunks) if (c.app === app && !c.deleted) { c.deleted = true; n++; }
    this.summaryCache.clear();
    this.log({ ts: new Date().toISOString(), actor: userId, action: "deletion.propagated", reason: `app:${app} tombstoned ${n}`, resource: `app:${app}` });
    return n;
  }
  resetDeletions() { for (const c of this.chunks) c.deleted = false; this.summaryCache.clear(); }
}
