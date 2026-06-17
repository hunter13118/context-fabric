import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDb } from "../src/db/database.js";
import { seed, TENANT_ID } from "../src/fixtures/seed.js";
import { ContextService } from "../src/ai/contextService.js";
import { servicenowConnector } from "../src/connectors/servicenow.js";

const ctx = new ContextService();

beforeAll(async () => {
  getDb();
  resetDb();
  await seed();
});

describe("ServiceNow connector mapping", () => {
  it("links an incident to its account, related ticket, and prior incident", () => {
    const inc = servicenowConnector.fixtures()[0];
    const m = servicenowConnector.map(inc);
    expect(m.relationships.some((r) => r.relationship_type === "affects")).toBe(true);
    expect(m.relationships.some((r) => r.relationship_type === "related_to" && r.target_natural_key === "ticket:acme-481")).toBe(true);
    expect(m.relationships.some((r) => r.relationship_type === "similar_to" && r.target_natural_key === "incident:inc-7702")).toBe(true);
  });
});

describe("UC3 — incident escalation brief", () => {
  it("stitches the incident with the related Jira ticket across connectors", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_support", surface: "test",
      query: "INC-7781 SSO login failures cause and related work",
      active_entity_hints: [{ name: "INC-7781" }], max_tokens: 3000,
    });
    const apps = new Set(r.context.map((c) => c.citation.app));
    expect(apps.has("servicenow")).toBe(true);
    expect(apps.has("jira")).toBe(true); // support can see the linked SSO ticket
  });

  it("withholds GitHub PRs from support (not a repo collaborator)", async () => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: "u_support", surface: "test",
      query: "INC-7781 SSO SCIM pull request code change",
      active_entity_hints: [{ name: "INC-7781" }], max_tokens: 3000,
    });
    expect(r.context.some((c) => c.citation.app === "github")).toBe(false);
  });
});
