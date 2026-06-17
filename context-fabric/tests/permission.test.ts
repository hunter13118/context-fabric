import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDb } from "../src/db/database.js";
import { seed, TENANT_ID } from "../src/fixtures/seed.js";
import { ContextService } from "../src/ai/contextService.js";

const ctx = new ContextService();

beforeAll(async () => {
  getDb();
  resetDb();
  await seed();
});

describe("permission parity — AI view ⊆ source view", () => {
  it("withholds private exec-channel content from a non-member (no leakage)", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
      query: "board walk away from Acme term commitment",
      active_entity_hints: [{ name: "Acme" }],
    });
    const leaked = r.context.some((c) => /walk away|board/i.test(c.content));
    expect(leaked).toBe(false);
    // Something was withheld, but no titles/URLs of denied items are exposed.
    expect(r.denied_count).toBeGreaterThan(0);
    expect(r.denied_summary).not.toMatch(/exec-private/i);
  });

  it("reveals the same private content to a channel member (exec)", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_exec", surface: "test",
      query: "board walk away from Acme term commitment",
      active_entity_hints: [{ name: "Acme" }],
    });
    const sees = r.context.some((c) => /walk away/i.test(c.content));
    expect(sees).toBe(true);
  });
});

describe("field-level security on amount", () => {
  it("redacts amount for a non-finance user", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
      query: "Acme opportunity stage amount close date changes",
      active_entity_hints: [{ name: "Acme" }],
    });
    const sfdc = r.context.find((c) => c.content_type === "salesforce_change");
    expect(sfdc).toBeDefined();
    expect(sfdc!.redacted_fields).toContain("amount");
    expect(sfdc!.content).toMatch(/\[REDACTED\]/);
    // The numeric value must not appear.
    expect(sfdc!.content).not.toMatch(/525000/);
  });

  it("shows amount to a finance user", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_finance", surface: "test",
      query: "Acme opportunity stage amount close date changes",
      active_entity_hints: [{ name: "Acme" }],
    });
    const sfdc = r.context.find((c) => c.content_type === "salesforce_change");
    expect(sfdc).toBeDefined();
    expect(sfdc!.redacted_fields).not.toContain("amount");
    expect(sfdc!.content).toMatch(/525000/);
  });
});

describe("tenant isolation", () => {
  it("returns nothing for an unknown user (default-deny on confidential)", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_nobody", surface: "test",
      query: "Acme opportunity", active_entity_hints: [{ name: "Acme" }],
    });
    // Unknown subject is in no ACLs -> sees no confidential/private content.
    const confidential = r.context.filter((c) => c.sensitivity !== "internal" && c.sensitivity !== "public");
    expect(confidential.length).toBe(0);
  });
});
