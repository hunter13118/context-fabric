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

const account = { tenant_id: TENANT_ID, surface: "test", entity_name: "Acme Corp", entity_type: "account" as const };

describe("ACL-banded summaries (S-1) — no cross-permission leakage", () => {
  it("gives a confidential-band summary to a cleared, in-channel reader", async () => {
    const r = await ctx.entitySummary({ ...account, user_id: "u_finance" });
    expect("band" in r && r.band).toBe("confidential");
    if ("summary" in r) expect(r.summary).toMatch(/walk away|3-year|board/i);
  });

  it("gives only the internal band to a reader not in the private channel — no leak", async () => {
    const r = await ctx.entitySummary({ ...account, user_id: "u_dev1" });
    expect("band" in r && r.band).toBe("internal");
    if ("summary" in r) {
      expect(r.summary).not.toMatch(/walk away|3-year/i);
      expect(r.summary).toMatch(/SSO|SCIM|pricing/i); // still gets the internal context
    }
  });

  it("reuses the cached per-band summary across readers in the same band (cost optimization)", async () => {
    await ctx.entitySummary({ ...account, user_id: "u_finance" }); // populate cache
    const second = await ctx.entitySummary({ ...account, user_id: "u_exec" }); // same confidential band
    expect("cache_hit" in second && second.cache_hit).toBe(true);
  });

  it("excludes field-restricted content from banded summaries (no amount leak via summary)", async () => {
    // The opportunity's only chunk is field-restricted (amount) -> excluded ->
    // no banded summary content from it.
    const r = await ctx.entitySummary({
      tenant_id: TENANT_ID, surface: "test", user_id: "u_finance",
      entity_name: "Acme – Platform Expansion", entity_type: "opportunity",
    });
    if ("summary" in r) expect(r.summary).not.toMatch(/525000/);
  });
});
