import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDb } from "../src/db/database.js";
import { seed, TENANT_ID } from "../src/fixtures/seed.js";
import { MeetingBriefService } from "../src/briefs/meetingBrief.js";
import { calendarConnector } from "../src/connectors/calendar.js";
import { emailConnector } from "../src/connectors/email.js";

const MEETING = "Acme Q3 Platform Expansion Review";

beforeAll(async () => {
  getDb();
  resetDb();
  await seed();
});

describe("calendar + email connector mapping", () => {
  it("calendar links the meeting to its account", () => {
    const m = calendarConnector.map(calendarConnector.fixtures()[0]);
    expect(m.entities.some((e) => e.entity_type === "meeting")).toBe(true);
    expect(m.relationships.some((r) => r.relationship_type === "about" && r.target_natural_key === "account:acme corp")).toBe(true);
  });
  it("external email is tagged as an external-email trust tier", () => {
    const ext = emailConnector.fixtures().find((e) => e.fromExternal)!;
    const m = emailConnector.map(ext);
    expect(m.chunks[0].trust_tier).toBe("external_email");
    expect(m.chunks[0].content_type).toBe("email");
  });
});

describe("UC4 — meeting-prep brief", () => {
  it("resolves the meeting to its account and builds a multi-section brief", async () => {
    const b = await new MeetingBriefService(TENANT_ID).generate(MEETING, "u_msmith", "test", false);
    expect(b).not.toBeNull();
    expect(b!.account?.name).toMatch(/Acme/);
    expect(b!.sections.length).toBeGreaterThanOrEqual(3);
    // The brief pulls from multiple connectors (email + at least one other).
    const apps = new Set(b!.sections.flatMap((s) => s.items.map((i) => i.citation.app)));
    expect(apps.has("email")).toBe(true);
    expect(apps.size).toBeGreaterThanOrEqual(2);
  });

  it("redacts the deal amount for a non-finance organizer but never leaks the value", async () => {
    const b = await new MeetingBriefService(TENANT_ID).generate(MEETING, "u_msmith", "test", false);
    expect(b!.markdown).not.toMatch(/525000/);
  });

  it("withholds GitHub PRs from the sales organizer (not a repo collaborator)", async () => {
    const b = await new MeetingBriefService(TENANT_ID).generate(MEETING, "u_msmith", "test", false);
    const apps = new Set(b!.sections.flatMap((s) => s.items.map((i) => i.citation.app)));
    expect(apps.has("github")).toBe(false);
    expect(b!.total_withheld).toBeGreaterThan(0);
  });
});
