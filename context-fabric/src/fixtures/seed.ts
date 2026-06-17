/**
 * Seed a tenant with users, connections, access policies, and ingest the
 * Slack + Salesforce fixtures. Used by the demo, API, and tests.
 *
 * Users (Acme tenant):
 *  - u_msmith  (Sales Manager)  groups: [sales, acme-team]   -> demo asker
 *  - u_jdoe    (Account Exec)   groups: [sales, acme-team]
 *  - u_dev1    (Engineer)       groups: [eng, acme-team]
 *  - u_finance (Finance)        groups: [finance]  role: finance
 *  - u_exec    (Executive)      groups: [exec]
 *
 * Policies demonstrate:
 *  - field-level restriction on "amount" (finance only)
 *  - confidential Salesforce records readable by sales + finance
 */
import type { AccessPolicy, AppType, User } from "../domain/types.js";
import {
  connectionRepo, policyRepo, tenantRepo, userRepo,
} from "../db/repositories.js";
import { IngestionPipeline } from "../ingestion/pipeline.js";
import {
  salesforceConnector, slackConnector, jiraConnector, githubConnector, servicenowConnector,
  calendarConnector, emailConnector,
} from "../connectors/index.js";
import { newId } from "../util/ids.js";

export const TENANT_ID = "t_acme";

export const USERS: Record<string, User> = {
  msmith: {
    id: "u_msmith", tenant_id: TENANT_ID, email: "msmith@acme.example",
    display_name: "Morgan Smith", roles: ["sales_manager"],
    groups: ["sales", "acme-team"], attributes: { department: "sales" }, status: "active",
  },
  jdoe: {
    id: "u_jdoe", tenant_id: TENANT_ID, email: "jdoe@acme.example",
    display_name: "Jane Doe", roles: ["account_exec"],
    groups: ["sales", "acme-team"], attributes: { department: "sales" }, status: "active",
  },
  dev1: {
    id: "u_dev1", tenant_id: TENANT_ID, email: "dev1@acme.example",
    display_name: "Dev One", roles: ["engineer"],
    groups: ["eng", "acme-team"], attributes: { department: "engineering" }, status: "active",
  },
  dev2: {
    id: "u_dev2", tenant_id: TENANT_ID, email: "dev2@acme.example",
    display_name: "Dev Two", roles: ["engineer"],
    groups: ["eng"], attributes: { department: "engineering" }, status: "active",
  },
  finance: {
    id: "u_finance", tenant_id: TENANT_ID, email: "finance@acme.example",
    display_name: "Fin Ops", roles: ["finance"],
    groups: ["finance"], attributes: { department: "finance" }, status: "active",
  },
  exec: {
    id: "u_exec", tenant_id: TENANT_ID, email: "exec@acme.example",
    display_name: "Exec Person", roles: ["executive"],
    groups: ["exec"], attributes: { department: "exec" }, status: "active",
  },
  support: {
    id: "u_support", tenant_id: TENANT_ID, email: "support@acme.example",
    display_name: "Support Engineer", roles: ["support_engineer"],
    groups: ["support", "acme-team"], attributes: { department: "support" }, status: "active",
  },
};

function seedPolicies() {
  const policies: AccessPolicy[] = [
    {
      // Who may read CONFIDENTIAL content at all (classification gate). The
      // per-object source ACL still applies on top of this — e.g. a sales user
      // is cleared for confidential content but still cannot read a private
      // channel they are not a member of.
      id: newId("pol"), tenant_id: TENANT_ID, name: "confidential-read-clearance",
      policy_type: "abac", priority: 10,
      subject_selector: { groups: ["sales", "finance", "exec"] },
      resource_selector: { sensitivity: ["confidential"] },
      action: "read", conditions: {}, effect: "allow",
    },
    {
      id: newId("pol"), tenant_id: TENANT_ID, name: "field-restrict-amount-finance-only",
      policy_type: "field", priority: 20,
      subject_selector: { any: true },
      resource_selector: { fields: ["amount"] },
      action: "read", conditions: {}, effect: "deny",
    },
    {
      id: newId("pol"), tenant_id: TENANT_ID, name: "field-grant-amount-to-finance",
      policy_type: "field", priority: 5,
      subject_selector: { roles: ["finance"] },
      resource_selector: { fields: ["amount"] },
      action: "read", conditions: {}, effect: "allow",
    },
  ];
  for (const p of policies) policyRepo.upsert(p);
}

export async function seed(): Promise<{ chunks: number }> {
  tenantRepo.upsert({ id: TENANT_ID, name: "Acme (demo tenant)", domain: "acme.example" });
  for (const u of Object.values(USERS)) userRepo.upsert(u);

  const connectionIdByApp = {} as Record<AppType, string>;
  for (const app of ["salesforce", "slack", "jira", "github", "servicenow", "calendar", "email"] as AppType[]) {
    const id = newId("conn");
    connectionRepo.upsert({
      id, tenant_id: TENANT_ID, user_id: null, app_type: app,
      auth_type: "service_account", scopes: ["read"], status: "active",
      token_reference: `secret://${app}/${id}`,
    });
    connectionIdByApp[app] = id;
  }

  seedPolicies();

  // Order matters: ingest Jira before GitHub so the shared resolver has the
  // ticket entity when GitHub PRs reference it (cross-connector linking).
  const pipeline = new IngestionPipeline(TENANT_ID, connectionIdByApp);
  let chunks = 0;
  chunks += await pipeline.ingestConnector(salesforceConnector);
  chunks += await pipeline.ingestConnector(jiraConnector);
  chunks += await pipeline.ingestConnector(githubConnector);
  chunks += await pipeline.ingestConnector(servicenowConnector);
  chunks += await pipeline.ingestConnector(calendarConnector);
  chunks += await pipeline.ingestConnector(emailConnector);
  chunks += await pipeline.ingestConnector(slackConnector);
  return { chunks };
}
