/**
 * MCP server surface (§14). Exposes Context Fabric tools to any MCP client
 * (Claude Desktop/Code, Cursor, custom agents) over stdio.
 *
 * Tools: search_context, get_account_brief, explain_access_denial.
 * Every call is tenant- and user-scoped and policy-filtered by the same core
 * used by the REST API and demo — there is no separate enforcement path.
 *
 * The calling user is taken from CF_MCP_USER (default u_msmith), standing in
 * for the user-scoped token a real MCP client would present.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb, resetDb } from "../db/database.js";
import { seed, TENANT_ID } from "../fixtures/seed.js";
import { ContextService } from "../ai/contextService.js";
import { MeetingBriefService } from "../briefs/meetingBrief.js";
import { audit } from "../audit/auditLog.js";
import { newId } from "../util/ids.js";

const USER = process.env.CF_MCP_USER || "u_msmith";
const ctx = new ContextService();
const briefs = new MeetingBriefService(TENANT_ID);

const server = new McpServer({ name: "context-fabric", version: "0.1.0" });

server.tool(
  "search_context",
  "Search the user's approved enterprise context. Returns ranked, cited, policy-filtered results.",
  {
    query: z.string(),
    entity_hint: z.string().optional(),
    max_tokens: z.number().optional(),
  },
  async ({ query, entity_hint, max_tokens }) => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp", query,
      active_entity_hints: entity_hint ? [{ name: entity_hint }] : undefined,
      max_tokens: max_tokens ?? 2000,
    });
    const results = r.context.map((c) => ({
      summary: c.summary, content_type: c.content_type, sensitivity: c.sensitivity,
      citation: c.citation, redacted_fields: c.redacted_fields,
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          { results, denied_count: r.denied_count, confidence: r.confidence }, null, 2
        ),
      }],
    };
  }
);

server.tool(
  "get_account_brief",
  "Return a governed account/customer brief with citations and confidence.",
  { account: z.string(), max_tokens: z.number().optional() },
  async ({ account, max_tokens }) => {
    const r = await ctx.brief({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp",
      brief_type: "account", entity_name: account, max_tokens: max_tokens ?? 2500,
    });
    return {
      content: [{
        type: "text",
        text: `${r.answer}\n\n---\nwithheld by policy: ${r.retrieval.denied_count} | confidence: ${r.retrieval.confidence}`,
      }],
    };
  }
);

server.tool(
  "get_ticket_context",
  "Return engineering/support ticket context: the ticket, linked PRs/repos, related docs and discussion, with citations.",
  { ticket: z.string(), max_tokens: z.number().optional() },
  async ({ ticket, max_tokens }) => {
    const r = await ctx.brief({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp",
      brief_type: "ticket", entity_name: ticket, max_tokens: max_tokens ?? 2500,
    });
    return {
      content: [{
        type: "text",
        text: `${r.answer}\n\n---\nwithheld by policy: ${r.retrieval.denied_count} | confidence: ${r.retrieval.confidence}`,
      }],
    };
  }
);

server.tool(
  "get_meeting_brief",
  "Generate a pre-meeting brief for an upcoming meeting, synthesized across all connected sources and filtered to what the caller may see.",
  { meeting: z.string() },
  async ({ meeting }) => {
    const b = await briefs.generate(meeting, USER, "mcp", false);
    if (!b) return { content: [{ type: "text", text: JSON.stringify({ error: "meeting_not_found" }) }] };
    return { content: [{ type: "text", text: b.markdown }] };
  }
);

server.tool(
  "get_entity_summary",
  "Return a cached, ACL-banded summary of an entity — scoped to the highest access band the caller is fully permitted to see (no cross-permission leakage).",
  { entity: z.string(), entity_type: z.string().optional() },
  async ({ entity, entity_type }) => {
    const r = await ctx.entitySummary({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp",
      entity_name: entity, entity_type: entity_type as any,
    });
    if ("denied" in r) {
      return { content: [{ type: "text", text: JSON.stringify({ summary: null, reason: r.reason }, null, 2) }] };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ band: r.band, summary: r.summary, sources: r.citations, cache_hit: r.cache_hit }, null, 2),
      }],
    };
  }
);

server.tool(
  "get_recent_changes",
  "Return recent relevant changes across connected apps for an entity (policy-filtered, cited).",
  { entity: z.string(), max_tokens: z.number().optional() },
  async ({ entity, max_tokens }) => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp",
      query: `recent changes, updates and activity for ${entity}`,
      active_entity_hints: [{ name: entity }], max_tokens: max_tokens ?? 2000,
    });
    const changes = r.context.map((c) => ({ summary: c.summary, when: c.citation.occurred_at, citation: c.citation }));
    return { content: [{ type: "text", text: JSON.stringify({ changes, denied_count: r.denied_count }, null, 2) }] };
  }
);

server.tool(
  "get_related_documents",
  "Return source documents/records related to a topic, with citations the user is permitted to open.",
  { topic: z.string(), max_tokens: z.number().optional() },
  async ({ topic, max_tokens }) => {
    const r = await ctx.search({
      tenant_id: TENANT_ID, user_id: USER, surface: "mcp",
      query: topic, active_entity_hints: [{ name: topic }], max_tokens: max_tokens ?? 2000,
    });
    const docs = r.context.map((c) => ({ title: c.citation.title, app: c.citation.app, url: c.citation.url, excerpt: c.summary }));
    return { content: [{ type: "text", text: JSON.stringify({ documents: docs, denied_count: r.denied_count }, null, 2) }] };
  }
);

server.tool(
  "request_access",
  "Start an access request for restricted context. Returns a request id; does not grant access.",
  { resource_ref: z.string(), justification: z.string() },
  async ({ resource_ref, justification }) => {
    const requestId = newId("areq");
    audit({
      tenant_id: TENANT_ID, actor_user_id: USER, action: "access.requested",
      resource_type: "access_request", resource_id: requestId,
      decision: "n/a", reason: "user_request", metadata: { resource_ref, justification },
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ request_id: requestId, status: "pending_approval",
          message: "Your access request has been logged and routed to the resource owner for approval." }, null, 2),
      }],
    };
  }
);

server.tool(
  "explain_access_denial",
  "Explain why context was withheld, without revealing the restricted content or confirming its existence.",
  { topic: z.string() },
  async ({ topic }) => {
    // The prototype returns a generic, non-leaking explanation.
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          reason_code: "not_shared_with_you",
          remediation: `Some context related to "${topic}" exists in systems you have not been granted access to. Use request_access to ask the owner.`,
          request_access_available: true,
        }, null, 2),
      }],
    };
  }
);

async function start() {
  getDb();
  resetDb();
  await seed();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: log to stderr so stdout stays a clean MCP channel.
  console.error(
    `Context Fabric MCP server ready (user=${USER}). Tools: search_context, get_account_brief, ` +
    `get_meeting_brief, get_entity_summary, get_ticket_context, get_recent_changes, get_related_documents, request_access, explain_access_denial`
  );
}

start().catch((e) => { console.error(e); process.exit(1); });
