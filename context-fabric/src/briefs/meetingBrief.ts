/**
 * MeetingBriefService — the meeting-prep deliverable (spec UC4 / §16 Workflow C).
 *
 * Given an upcoming meeting, it:
 *   1. resolves the meeting entity and the account it concerns (via the graph),
 *   2. assembles a SECTIONED brief by running targeted, policy-filtered
 *      retrievals across every connected source tied to that account,
 *   3. renders a cited Markdown deliverable and writes it to the output folder.
 *
 * Everything is permission-filtered for the REQUESTING user: two organizers of
 * the same meeting can get different briefs. Field redaction (e.g. the deal
 * amount) and withheld-source counts are surfaced, never leaked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalEntity, RetrievedItem } from "../domain/types.js";
import { entityRepo, relationshipRepo } from "../db/repositories.js";
import { ContextService } from "../ai/contextService.js";
import { resolveSubject } from "../identity/identity.js";
import { audit } from "../audit/auditLog.js";
import { config } from "../config.js";
import { nowIso } from "../util/ids.js";

interface Section {
  title: string;
  items: RetrievedItem[];
  denied: number;
}

export interface MeetingBrief {
  meeting: { id: string; name: string; starts_at?: string };
  account?: { id: string; name: string };
  for_user: string;
  generated_at: string;
  sections: Section[];
  total_withheld: number;
  confidence: "low" | "medium" | "high";
  markdown: string;
  file_path?: string;
}

const SECTION_QUERIES: { title: string; query: string }[] = [
  { title: "Deal status & open opportunities", query: "opportunity stage amount close date deal status changes" },
  { title: "Recent customer email", query: "email from customer requirements concerns pricing" },
  { title: "Engineering & ticket status", query: "ticket implementation SSO SCIM acceptance criteria status blockers" },
  { title: "Incidents & escalations", query: "incident escalation outage impact severity" },
  { title: "Risks & open items", query: "risk concern blocker pending approval next steps" },
];

export class MeetingBriefService {
  private ctx = new ContextService();
  constructor(private tenantId: string) {}

  async generate(meetingName: string, userId: string, surface = "brief", write = true): Promise<MeetingBrief | null> {
    const meeting = this.resolveMeeting(meetingName);
    if (!meeting) return null;
    const account = this.linkedAccount(meeting.id);
    const subject = resolveSubject(this.tenantId, userId);

    // 1) Account snapshot — ACL-banded summary for this reader.
    const snapshot = await this.ctx.entitySummary({
      tenant_id: this.tenantId, user_id: userId, surface, entity_name: account?.name ?? meeting.name, entity_type: "account",
    });

    // 2) Sectioned retrieval, deduped across sections.
    const seen = new Set<string>();
    const hints = [{ name: account?.name ?? meeting.name }, { name: meeting.name }];
    const sections: Section[] = [];
    let totalWithheld = 0;

    for (const sq of SECTION_QUERIES) {
      const r = await this.ctx.search({
        tenant_id: this.tenantId, user_id: userId, surface,
        query: sq.query, active_entity_hints: hints, max_tokens: 1500,
      });
      // Cap each section to its top few items so the first section doesn't
      // vacuum the whole budget and starve later sections.
      const items = r.context.filter((c) => !seen.has(c.chunk_id)).slice(0, 3);
      items.forEach((c) => seen.add(c.chunk_id));
      totalWithheld += r.denied_count;
      if (items.length > 0) sections.push({ title: sq.title, items, denied: r.denied_count });
    }

    const confidence: MeetingBrief["confidence"] =
      sections.length >= 3 ? "high" : sections.length >= 1 ? "medium" : "low";

    const brief: MeetingBrief = {
      meeting: { id: meeting.id, name: meeting.name, starts_at: meeting.attributes.starts_at as string | undefined },
      account: account ? { id: account.id, name: account.name } : undefined,
      for_user: userId,
      generated_at: nowIso(),
      sections,
      total_withheld: totalWithheld,
      confidence,
      markdown: "",
    };
    brief.markdown = this.render(brief, "summary" in snapshot ? snapshot : null);

    if (write) {
      const dir = config.outDir;
      mkdirSync(dir, { recursive: true });
      const fname = `meeting-brief-${meeting.attributes.meeting_id ?? meeting.id}-${userId}.md`;
      const fpath = join(dir, fname);
      writeFileSync(fpath, brief.markdown, "utf8");
      brief.file_path = fpath;
    }

    audit({
      tenant_id: this.tenantId, actor_user_id: userId, action: "brief.meeting",
      resource_type: "meeting", resource_id: meeting.id, decision: "allow",
      reason: surface, metadata: { sections: sections.length, withheld: totalWithheld },
    });
    return brief;
  }

  private resolveMeeting(name: string): CanonicalEntity | null {
    const matches = entityRepo.findByName(this.tenantId, name).filter((e) => e.entity_type === "meeting");
    return matches[0] ?? null;
  }

  private linkedAccount(meetingId: string): CanonicalEntity | null {
    const rels = relationshipRepo.neighbors(this.tenantId, [meetingId]);
    for (const r of rels) {
      const otherId = r.source_entity_id === meetingId ? r.target_entity_id : r.source_entity_id;
      const e = entityRepo.get(this.tenantId, otherId);
      if (e?.entity_type === "account") return e;
    }
    return null;
  }

  private render(brief: MeetingBrief, snapshot: any): string {
    const L: string[] = [];
    L.push(`# Pre-meeting brief: ${brief.meeting.name}`);
    L.push("");
    if (brief.meeting.starts_at) L.push(`**When:** ${brief.meeting.starts_at}  `);
    if (brief.account) L.push(`**Account:** ${brief.account.name}  `);
    L.push(`**Prepared for:** ${brief.for_user}  `);
    L.push(`**Generated:** ${brief.generated_at}  `);
    L.push(`**Confidence:** ${brief.confidence}`);
    L.push("");
    L.push(`> Generated by Context Fabric across connected sources, filtered to what you're permitted to see. ` +
           `${brief.total_withheld} item(s) were withheld by policy and are not shown.`);
    L.push("");

    if (snapshot && "summary" in snapshot && snapshot.summary) {
      L.push(`## Account snapshot (${snapshot.band} band)`);
      L.push("");
      L.push(snapshot.summary);
      L.push("");
    }

    for (const s of brief.sections) {
      L.push(`## ${s.title}`);
      L.push("");
      for (const it of s.items) {
        const redact = it.redacted_fields.length ? ` _(redacted: ${it.redacted_fields.join(", ")})_` : "";
        L.push(`- ${it.summary ?? it.content}${redact}  `);
        L.push(`  — [${it.citation.app}: ${it.citation.title}](${it.citation.url}) · ${it.citation.occurred_at}`);
      }
      if (s.denied > 0) L.push(`- _${s.denied} related item(s) withheld by policy._`);
      L.push("");
    }

    L.push("---");
    L.push(`_Sources: ${[...new Set(brief.sections.flatMap((s) => s.items.map((i) => i.citation.app)))].join(", ") || "none"}._`);
    return L.join("\n");
  }
}
