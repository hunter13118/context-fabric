/**
 * Seeded demo dataset — the exact data the Node connectors (Salesforce, Slack,
 * Jira, GitHub, ServiceNow, Calendar, Email) produce, authored directly so the
 * browser demo needs no ingestion pipeline. Embeddings are computed at load.
 */
import type { Chunk, Entity, Policy, Relationship, User } from "./types.js";

export const USERS: User[] = [
  { id: "u_msmith", display_name: "Morgan Smith", title: "Sales Manager", roles: ["sales_manager"], groups: ["sales", "acme-team"] },
  { id: "u_jdoe", display_name: "Jane Doe", title: "Account Executive", roles: ["account_exec"], groups: ["sales", "acme-team"] },
  { id: "u_dev1", display_name: "Dev One", title: "Engineer", roles: ["engineer"], groups: ["eng", "acme-team"] },
  { id: "u_dev2", display_name: "Dev Two", title: "Engineer", roles: ["engineer"], groups: ["eng"] },
  { id: "u_finance", display_name: "Fin Ops", title: "Finance", roles: ["finance"], groups: ["finance"] },
  { id: "u_exec", display_name: "Exec Person", title: "Executive", roles: ["executive"], groups: ["exec"] },
  { id: "u_support", display_name: "Support Engineer", title: "Support", roles: ["support_engineer"], groups: ["support", "acme-team"] },
];

export const ENTITIES: Entity[] = [
  { id: "ce_account", entity_type: "account", name: "Acme Corp" },
  { id: "ce_opp", entity_type: "opportunity", name: "Acme – Platform Expansion" },
  { id: "ce_ticket", entity_type: "ticket", name: "ACME-481: Implement SSO + SCIM provisioning for Acme" },
  { id: "ce_pr128", entity_type: "pull_request", name: "acme-platform#128: ACME-481: add SSO/SCIM provisioning" },
  { id: "ce_pr119", entity_type: "pull_request", name: "acme-platform#119: SCIM groundwork" },
  { id: "ce_repo", entity_type: "repository", name: "acme-platform" },
  { id: "ce_inc1", entity_type: "incident", name: "INC-7781: Acme SSO login failures after deploy" },
  { id: "ce_inc2", entity_type: "incident", name: "INC-7702: SSO intermittent errors" },
  { id: "ce_mtg", entity_type: "meeting", name: "Acme Q3 Platform Expansion Review" },
];

export const RELATIONSHIPS: Relationship[] = [
  { source: "ce_opp", target: "ce_account", type: "belongs_to" },
  { source: "ce_ticket", target: "ce_account", type: "belongs_to" },
  { source: "ce_pr128", target: "ce_ticket", type: "implements" },
  { source: "ce_pr128", target: "ce_repo", type: "in_repository" },
  { source: "ce_pr128", target: "ce_pr119", type: "builds_on" },
  { source: "ce_pr119", target: "ce_repo", type: "in_repository" },
  { source: "ce_inc1", target: "ce_account", type: "affects" },
  { source: "ce_inc1", target: "ce_ticket", type: "related_to" },
  { source: "ce_inc1", target: "ce_inc2", type: "similar_to" },
  { source: "ce_inc2", target: "ce_account", type: "affects" },
  { source: "ce_mtg", target: "ce_account", type: "about" },
];

const acl = (visible: string[], priv = false) => ({ visible_to: visible, private: priv });

export const CHUNKS: Chunk[] = [
  {
    id: "cc_sfdc", entity_id: "ce_opp", app: "salesforce", content_type: "salesforce_change",
    content: `Opportunity "Acme – Platform Expansion" updated. stage: "Negotiation" -> "Proposal"; amount: 480000 -> 525000; close_date: "2026-08-31" -> "2026-09-15".`,
    sensitivity: "confidential", restricted_fields: ["amount"],
    source_acl: acl(["u_jdoe", "u_msmith", "u_finance"]), trust_tier: "ticket",
    occurred_at: "2026-06-12T15:04:22Z", citation_title: "Acme – Platform Expansion",
    citation_url: "https://acme.my.salesforce.com/006Ti000001",
  },
  {
    id: "cc_slack1", entity_id: "ce_account", app: "slack", content_type: "slack_message",
    content: "Jane Doe in #acme-project: Acme asked for SSO + SCIM before they'll sign. I committed to a security review call next week.",
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_msmith", "u_jdoe", "u_dev1", "u_finance", "u_exec", "u_support"]),
    trust_tier: "chat", occurred_at: "2026-06-11T18:20:00Z", citation_title: "#acme-project",
    citation_url: "https://acme.slack.com/archives/C123/p1700000001",
  },
  {
    id: "cc_slack2", entity_id: "ce_account", app: "slack", content_type: "slack_message",
    content: "Dev One in #acme-project: Heads up: Acme also flagged a pricing concern on the expansion. We may need finance to weigh in.",
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_msmith", "u_jdoe", "u_dev1", "u_finance", "u_exec", "u_support"]),
    trust_tier: "chat", occurred_at: "2026-06-11T19:05:00Z", citation_title: "#acme-project",
    citation_url: "https://acme.slack.com/archives/C123/p1700000002",
  },
  {
    id: "cc_slackexec", entity_id: "ce_account", app: "slack", content_type: "slack_message",
    content: "Exec Person in #acme-exec-private: Confidential: board wants to walk away from Acme unless they commit to a 3-year term.",
    sensitivity: "confidential", restricted_fields: [],
    source_acl: acl(["u_exec", "u_finance"], true), trust_tier: "chat",
    occurred_at: "2026-06-12T09:00:00Z", citation_title: "#acme-exec-private",
    citation_url: "https://acme.slack.com/archives/C999/p1700000050",
  },
  {
    id: "cc_jira", entity_id: "ce_ticket", app: "jira", content_type: "jira_issue",
    content: "Ticket ACME-481 (In Progress): Implement SSO + SCIM provisioning for Acme. Acme requires SAML SSO and SCIM user provisioning before signing. Acceptance criteria: 1. SAML login works against Acme's IdP (Okta) 2. SCIM create/update/deprovision syncs within 5 minutes 3. Audit log records all provisioning events. Assignee: Dev One.",
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_dev1", "u_jdoe", "u_msmith", "u_support"]), trust_tier: "ticket",
    occurred_at: "2026-06-12T13:00:00Z", citation_title: "ACME-481: Implement SSO + SCIM provisioning for Acme",
    citation_url: "https://acme.atlassian.net/browse/ACME-481",
  },
  {
    id: "cc_pr128", entity_id: "ce_pr128", app: "github", content_type: "github_pr",
    content: 'PR acme-platform#128 [open] "ACME-481: add SSO/SCIM provisioning" on branch feature/ACME-481 by Dev One. Adds SAML SSO and SCIM endpoints. Reuses the SCIM groundwork from #119. Needs a security review before merge. Implements ACME-481.',
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_dev1", "u_dev2", "u_jdoe"], true), trust_tier: "ticket",
    occurred_at: "2026-06-13T10:30:00Z", citation_title: "acme-platform#128",
    citation_url: "https://github.com/acme/acme-platform/pull/128",
  },
  {
    id: "cc_pr119", entity_id: "ce_pr119", app: "github", content_type: "github_pr",
    content: 'PR acme-platform#119 [merged] "SCIM groundwork: schema + client" by Dev Two. Initial SCIM data model and HTTP client. Provides the base for full provisioning.',
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_dev1", "u_dev2", "u_jdoe"], true), trust_tier: "ticket",
    occurred_at: "2026-06-05T16:45:00Z", citation_title: "acme-platform#119",
    citation_url: "https://github.com/acme/acme-platform/pull/119",
  },
  {
    id: "cc_inc1", entity_id: "ce_inc1", app: "servicenow", content_type: "servicenow_incident",
    content: "Incident INC-7781 [escalated, high severity]: Acme SSO login failures after deploy. Acme users cannot log in via SSO since the 2026-06-13 deploy. Customer impact: ~400 users blocked. Suspected cause: the SCIM provisioning change introduced for the SSO work. Related work: ACME-481. Similar prior incident: INC-7702.",
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_support", "u_dev1", "u_jdoe", "u_msmith"]), trust_tier: "ticket",
    occurred_at: "2026-06-14T08:15:00Z", citation_title: "INC-7781: Acme SSO login failures after deploy",
    citation_url: "https://acme.service-now.com/incident.do?sys_id=INC-7781",
  },
  {
    id: "cc_inc2", entity_id: "ce_inc2", app: "servicenow", content_type: "servicenow_incident",
    content: "Incident INC-7702 [resolved]: SSO intermittent errors. Intermittent SSO errors reported last month. Resolved by an IdP config rollback; no code change required.",
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_support", "u_dev1", "u_jdoe", "u_msmith"]), trust_tier: "ticket",
    occurred_at: "2026-05-20T11:00:00Z", citation_title: "INC-7702: SSO intermittent errors",
    citation_url: "https://acme.service-now.com/incident.do?sys_id=INC-7702",
  },
  {
    id: "cc_cal", entity_id: "ce_mtg", app: "calendar", content_type: "calendar_event",
    content: 'Meeting "Acme Q3 Platform Expansion Review" starts 2026-06-16T15:00:00Z. Agenda: Confirm SSO/SCIM readiness, address pricing concern, align on the close plan and timeline. External attendees: Acme Procurement <procurement@acme.com>, Acme CTO <cto@acme.com>. Internal: Morgan Smith, Jane Doe.',
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_msmith", "u_jdoe"]), trust_tier: "ticket",
    occurred_at: "2026-06-14T17:00:00Z", citation_title: "Acme Q3 Platform Expansion Review",
    citation_url: "https://calendar.example/event/MTG-501",
  },
  {
    id: "cc_eml1", entity_id: "ce_account", app: "email", content_type: "email",
    content: 'Email — "SSO/SCIM requirement before signing" from Acme Procurement (procurement@acme.com): Per our last call, we need SSO and SCIM confirmed in writing before we can sign the expansion. Our security team will want to see an audit-log capability as well.',
    sensitivity: "internal", restricted_fields: [],
    source_acl: acl(["u_msmith", "u_jdoe", "u_dev1", "u_finance", "u_exec", "u_support"], true), trust_tier: "external_email",
    occurred_at: "2026-06-10T14:12:00Z", citation_title: "Email: SSO/SCIM requirement before signing",
    citation_url: "https://mail.example/thread/thr-118#msg-5567",
  },
  {
    id: "cc_eml2", entity_id: "ce_account", app: "email", content_type: "email",
    content: 'Email — "Re: Acme close plan" from Jane Doe (jdoe@acme.example): Legal review is scheduled and the security review call is set for next week. We still need finance sign-off on the revised expansion number before the Q3 review.',
    sensitivity: "confidential", restricted_fields: [],
    source_acl: acl(["u_msmith", "u_jdoe", "u_finance", "u_exec"], true), trust_tier: "chat",
    occurred_at: "2026-06-13T09:40:00Z", citation_title: "Email: Re: Acme close plan",
    citation_url: "https://mail.example/thread/thr-119#msg-5572",
  },
];

export const POLICIES: Policy[] = [
  { name: "confidential-read-clearance", type: "abac", priority: 10,
    subject: { groups: ["sales", "finance", "exec"] }, resource: { sensitivity: ["confidential"] }, effect: "allow" },
  { name: "field-restrict-amount-finance-only", type: "field", priority: 20,
    subject: { any: true }, resource: { fields: ["amount"] }, effect: "deny" },
  { name: "field-grant-amount-to-finance", type: "field", priority: 5,
    subject: { roles: ["finance"] }, resource: { fields: ["amount"] }, effect: "allow" },
];
