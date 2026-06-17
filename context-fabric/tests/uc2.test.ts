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

describe("UC2 — developer brief stitches Jira + GitHub", () => {
  it("links the Jira ticket to its GitHub PR(s) across connectors", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_dev1", surface: "test",
      query: "what do I need to know to implement ACME-481 SSO SCIM",
      active_entity_hints: [{ name: "ACME-481" }], max_tokens: 3000,
    });
    const apps = new Set(r.context.map((c) => c.citation.app));
    expect(apps.has("jira")).toBe(true);
    expect(apps.has("github")).toBe(true);
  });

  it("withholds the confidential Salesforce opportunity from the developer (not in its ACL)", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_dev1", surface: "test",
      query: "ACME-481 SSO SCIM opportunity amount deal value",
      active_entity_hints: [{ name: "ACME-481" }], max_tokens: 3000,
    });
    // dev1 must never receive the Salesforce amount.
    const leaked = r.context.some((c) => /525000|480000/.test(c.content));
    expect(leaked).toBe(false);
    expect(r.context.some((c) => c.citation.app === "salesforce")).toBe(false);
  });
});
