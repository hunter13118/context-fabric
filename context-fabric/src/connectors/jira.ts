import type { Connector, MappedPayload } from "./types.js";

/** Fixture Jira issue/webhook payload. */
export interface JiraRaw {
  eventId: string;
  issueKey: string;            // e.g. "ACME-481"
  projectKey: string;          // "ACME"
  /** Account this project serves (links Jira to the CRM/Slack cluster). */
  linkedAccountName: string;
  url: string;
  summary: string;
  description: string;
  acceptanceCriteria: string[];
  status: string;              // "In Progress"
  assigneeExternalId: string;
  assigneeName: string;
  occurredAt: string;
  /** Project members who can read the issue (drives source ACL). */
  visibleTo: string[];
}

const ticketKey = (r: JiraRaw) => `ticket:${r.issueKey.toLowerCase()}`;
const accountKey = (r: JiraRaw) => `account:${r.linkedAccountName.toLowerCase()}`;

export const jiraConnector: Connector<JiraRaw> = {
  meta: {
    appType: "jira",
    displayName: "Jira",
    version: "0.1.0",
    entityTypes: ["ticket", "account"],
  },

  map(raw: JiraRaw): MappedPayload {
    const acl = { visible_to: raw.visibleTo, private: false, sensitivity_hint: "internal" as const };
    const ac = raw.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join(" ");

    return {
      object: {
        external_id: raw.issueKey,
        external_url: raw.url,
        object_type: "issue",
        title: `${raw.issueKey}: ${raw.summary}`,
        raw_metadata: { project: raw.projectKey, status: raw.status, assignee: raw.assigneeName },
        source_acl: acl,
      },
      entities: [
        {
          natural_key: ticketKey(raw),
          entity_type: "ticket",
          name: `${raw.issueKey}: ${raw.summary}`,
          description: raw.description,
          attributes: { status: raw.status, project: raw.projectKey, assignee: raw.assigneeExternalId },
        },
        {
          natural_key: accountKey(raw),
          entity_type: "account",
          name: raw.linkedAccountName,
          description: `Customer account ${raw.linkedAccountName}.`,
        },
      ],
      chunks: [
        {
          content_type: "jira_issue",
          content:
            `Ticket ${raw.issueKey} (${raw.status}): ${raw.summary}. ` +
            `${raw.description} Acceptance criteria: ${ac} Assignee: ${raw.assigneeName}.`,
          sensitivity_label: "internal",
          trust_tier: "ticket",
          occurred_at: raw.occurredAt,
          citation_title: `${raw.issueKey}: ${raw.summary}`,
          citation_url: raw.url,
          entity_natural_key: ticketKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: "issue.updated",
        actor_external_id: raw.assigneeExternalId,
        occurred_at: raw.occurredAt,
        normalized_payload: { key: raw.issueKey, status: raw.status, summary: raw.summary },
        entity_natural_keys: [ticketKey(raw), accountKey(raw)],
      },
      relationships: [
        { source_natural_key: ticketKey(raw), target_natural_key: accountKey(raw), relationship_type: "belongs_to", weight: 0.8 },
      ],
    };
  },

  fixtures(): JiraRaw[] {
    return [
      {
        eventId: "JIRA-9001",
        issueKey: "ACME-481",
        projectKey: "ACME",
        linkedAccountName: "Acme Corp",
        url: "https://acme.atlassian.net/browse/ACME-481",
        summary: "Implement SSO + SCIM provisioning for Acme",
        description:
          "Acme requires SAML SSO and SCIM user provisioning before signing the expansion. " +
          "Build on the existing identity service; reuse the SCIM groundwork from the prior PR.",
        acceptanceCriteria: [
          "SAML login works against Acme's IdP (Okta)",
          "SCIM create/update/deprovision syncs within 5 minutes",
          "Audit log records all provisioning events",
        ],
        status: "In Progress",
        assigneeExternalId: "jira_dev1",
        assigneeName: "Dev One",
        occurredAt: "2026-06-12T13:00:00Z",
        visibleTo: ["u_dev1", "u_jdoe", "u_msmith", "u_support"],
      },
    ];
  },
};
