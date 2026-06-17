import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDb } from "../src/db/database.js";
import { seed, TENANT_ID } from "../src/fixtures/seed.js";
import { ContextService } from "../src/ai/contextService.js";
import { RevocationService } from "../src/governance/revocation.js";
import { verifyChain } from "../src/audit/auditLog.js";

const ctx = new ContextService();

beforeAll(async () => {
  getDb();
  resetDb();
  await seed();
});

describe("deletion / revocation propagation (Workflow E)", () => {
  const q = {
    tenant_id: TENANT_ID, user_id: "u_msmith", surface: "test",
    query: "Acme SSO SCIM pricing discussion", active_entity_hints: [{ name: "Acme" }], max_tokens: 2000,
  };

  it("removes revoked-app content from retrieval and logs a content-free tombstone", async () => {
    const before = await ctx.search(q);
    expect(before.context.some((c) => c.citation.app === "slack")).toBe(true);

    const res = new RevocationService(TENANT_ID).revokeApp("slack", "u_admin");
    expect(res.chunks_tombstoned).toBeGreaterThan(0);

    const after = await ctx.search(q);
    expect(after.context.some((c) => c.citation.app === "slack")).toBe(false);
  });

  it("respects legal hold by blocking deletion of held entities", async () => {
    // Re-seed clean for an isolated check.
    resetDb();
    await seed();
    // Find the account entity id (Slack chunks hang off it) and put it on hold.
    const r = await ctx.search({ ...q });
    const held = r.context.find((c) => c.citation.app === "slack");
    expect(held).toBeDefined();
    // Hold ALL entities referenced by slack chunks: simplest is to hold everything,
    // but we only have the chunk's entity via a fresh lookup — use a broad hold.
    const { chunkRepo } = await import("../src/db/repositories.js");
    const slackChunks = chunkRepo.liveBy(TENANT_ID, { app: "slack" });
    const heldIds = new Set(slackChunks.map((c) => c.canonical_entity_id!).filter(Boolean));
    const svc = new RevocationService(TENANT_ID, heldIds);
    const res = svc.revokeApp("slack", "u_admin");
    expect(res.blocked_by_legal_hold).toBeGreaterThan(0);
  });

  it("keeps the audit chain intact through deletions", () => {
    expect(verifyChain(TENANT_ID)).toBe(true);
  });
});
