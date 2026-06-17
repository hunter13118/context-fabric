import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDb } from "../src/db/database.js";
import { seed, TENANT_ID } from "../src/fixtures/seed.js";
import { ContextService } from "../src/ai/contextService.js";
import { verifyChain } from "../src/audit/auditLog.js";

const ctx = new ContextService();

beforeAll(async () => {
  getDb();
  resetDb();
  await seed();
});

describe("retrieval + grounding", () => {
  it("returns cited context within the token budget", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
      query: "Acme opportunity status and recent changes",
      active_entity_hints: [{ name: "Acme" }], max_tokens: 1500,
    });
    expect(r.context.length).toBeGreaterThan(0);
    expect(r.budget.used_tokens).toBeLessThanOrEqual(r.budget.max_tokens);
    for (const item of r.context) {
      expect(item.citation.url).toMatch(/^https?:\/\//);
      expect(item.citation.app).toBeTruthy();
    }
  });

  it("produces a grounded answer that cites sources", async () => {
    const r = await ctx.contextualResponse({
      tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
      query: "What changed on the Acme opportunity?",
      active_entity_hints: [{ name: "Acme" }],
    });
    expect(r.answer).toMatch(/\[#1\]/);
    expect(r.answer.toLowerCase()).toMatch(/sources:/);
    expect(r.cost.provider).toBe("mock");
  });

  it("identifies the Acme entity as focus", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
      query: "Acme", active_entity_hints: [{ name: "Acme" }],
    });
    expect(r.entity_focus.some((e) => /acme/i.test(e.name))).toBe(true);
  });
});

describe("audit", () => {
  it("keeps a tamper-evident hash chain across all activity", () => {
    expect(verifyChain(TENANT_ID)).toBe(true);
  });
});
