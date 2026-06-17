/**
 * REST API surface (§9, subset). Fastify.
 *
 * Auth model for the prototype: pass the caller via `x-cf-user` header (a real
 * deployment would derive this from an OIDC bearer token at the API gateway —
 * NEVER trust a client-supplied tenant id; here tenant is fixed to the demo).
 *
 *   GET  /v1/health
 *   POST /v1/context/search          { query, active_entity_hints?, ... }
 *   POST /v1/ai/contextual-response  { query, ... }
 *   POST /v1/context/brief           { brief_type, entity_name, ... }
 *   GET  /v1/audit                   recent audit events
 *   GET  /v1/cost                    cost telemetry
 */
import Fastify from "fastify";
import { z } from "zod";
import { getDb, resetDb } from "../db/database.js";
import { aiRequestRepo, auditRepo } from "../db/repositories.js";
import { seed, TENANT_ID, USERS } from "../fixtures/seed.js";
import { ContextService } from "../ai/contextService.js";
import { MeetingBriefService } from "../briefs/meetingBrief.js";
import { dashboardHtml } from "./dashboard.js";
import { config } from "../config.js";

const app = Fastify({ logger: false });
const ctx = new ContextService();
const briefs = new MeetingBriefService(TENANT_ID);

app.get("/", async (_req, reply) => {
  reply.header("content-type", "text/html; charset=utf-8");
  return dashboardHtml;
});

function caller(req: { headers: Record<string, unknown> }): string {
  const u = (req.headers["x-cf-user"] as string) || "u_msmith";
  return USERS[u.replace(/^u_/, "") as keyof typeof USERS] ? u : "u_msmith";
}

const searchSchema = z.object({
  query: z.string().min(1),
  active_entity_hints: z.array(z.object({ type: z.string().optional(), name: z.string() })).optional(),
  allowed_apps: z.array(z.string()).optional(),
  denied_apps: z.array(z.string()).optional(),
  max_tokens: z.number().optional(),
  sensitivity_ceiling: z.string().optional(),
});

app.get("/v1/health", async () => ({ ok: true, provider: config.aiProvider }));

app.post("/v1/context/search", async (req, reply) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(422).send({ error: { code: "validation_error", details: parsed.error.issues } });
  const r = await ctx.search({
    tenant_id: TENANT_ID, user_id: caller(req), surface: "api", ...(parsed.data as any),
  });
  return r;
});

app.post("/v1/ai/contextual-response", async (req, reply) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(422).send({ error: { code: "validation_error", details: parsed.error.issues } });
  const r = await ctx.contextualResponse({
    tenant_id: TENANT_ID, user_id: caller(req), surface: "api", ...(parsed.data as any),
  });
  return r;
});

const briefSchema = z.object({
  brief_type: z.string(),
  entity_name: z.string(),
  max_tokens: z.number().optional(),
});
app.post("/v1/context/brief", async (req, reply) => {
  const parsed = briefSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(422).send({ error: { code: "validation_error", details: parsed.error.issues } });
  const r = await ctx.brief({
    tenant_id: TENANT_ID, user_id: caller(req), surface: "api",
    brief_type: parsed.data.brief_type as any, entity_name: parsed.data.entity_name,
    max_tokens: parsed.data.max_tokens,
  });
  return r;
});

const summarySchema = z.object({
  entity_name: z.string(),
  entity_type: z.string().optional(),
});
app.post("/v1/context/entity-summary", async (req, reply) => {
  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(422).send({ error: { code: "validation_error", details: parsed.error.issues } });
  const r = await ctx.entitySummary({
    tenant_id: TENANT_ID, user_id: caller(req), surface: "api",
    entity_name: parsed.data.entity_name, entity_type: parsed.data.entity_type as any,
  });
  if ("denied" in r) return reply.code(404).send({ error: { code: "not_found", message: "No permitted content." } });
  return r;
});

const briefSchema = z.object({ meeting: z.string() });
app.post("/v1/meetings/brief", async (req, reply) => {
  const parsed = briefSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(422).send({ error: { code: "validation_error", details: parsed.error.issues } });
  const b = await briefs.generate(parsed.data.meeting, caller(req), "api", false);
  if (!b) return reply.code(404).send({ error: { code: "not_found", message: "Meeting not found." } });
  return b;
});

app.get("/v1/audit", async () => auditRepo.list(TENANT_ID, 100));
app.get("/v1/cost", async () => aiRequestRepo.totalCost(TENANT_ID));

async function start() {
  getDb();
  resetDb();
  await seed();
  const port = config.apiPort;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Context Fabric API + dashboard: http://localhost:${port}`);
  console.log(`Open that URL in a browser for the interactive console, or use the REST API directly:`);
  console.log(`  curl -s localhost:${port}/v1/context/search -H 'content-type: application/json' \\`);
  console.log(`       -H 'x-cf-user: u_msmith' -d '{"query":"Acme opportunity status","active_entity_hints":[{"name":"Acme"}]}' | jq`);
}

start().catch((e) => { console.error(e); process.exit(1); });
