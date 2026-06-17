import { describe, it, expect } from "vitest";
import { jiraConnector } from "../src/connectors/jira.js";
import { githubConnector } from "../src/connectors/github.js";

describe("Jira connector mapping", () => {
  it("maps an issue to a ticket entity linked to its account", () => {
    const raw = jiraConnector.fixtures()[0];
    const m = jiraConnector.map(raw);
    const ticket = m.entities.find((e) => e.entity_type === "ticket");
    expect(ticket?.natural_key).toBe("ticket:acme-481");
    expect(m.relationships.some((r) => r.relationship_type === "belongs_to")).toBe(true);
    expect(m.chunks[0].content_type).toBe("jira_issue");
    expect(m.chunks[0].content).toMatch(/SCIM/i);
  });
});

describe("GitHub connector mapping + cross-connector linking", () => {
  it("emits an 'implements' relationship to the referenced Jira ticket with a matching natural key", () => {
    const pr = githubConnector.fixtures().find((f) => f.referencesTicket === "ACME-481")!;
    const m = githubConnector.map(pr);
    // The PR references the SAME ticket natural key the Jira connector produces.
    expect(m.entities.some((e) => e.natural_key === "ticket:acme-481")).toBe(true);
    expect(m.relationships.some((r) => r.relationship_type === "implements" && r.target_natural_key === "ticket:acme-481")).toBe(true);
    expect(m.relationships.some((r) => r.relationship_type === "in_repository")).toBe(true);
    expect(m.chunks[0].content).toMatch(/branch feature\/ACME-481/);
  });

  it("marks PR content as a private (internal) source", () => {
    const pr = githubConnector.fixtures()[0];
    const m = githubConnector.map(pr);
    expect(m.object.source_acl.private).toBe(true);
    expect(m.object.source_acl.sensitivity_hint).toBe("internal");
  });
});
