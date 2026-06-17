import type { Connector, MappedPayload, RelationshipDraft } from "./types.js";

/** Fixture ServiceNow incident payload. */
export interface ServiceNowRaw {
  eventId: string;
  number: string;              // "INC-7781"
  shortDescription: string;
  description: string;
  severity: "low" | "moderate" | "high" | "critical";
  status: "new" | "in_progress" | "escalated" | "resolved";
  linkedAccountName: string;
  url: string;
  /** Jira ticket this incident relates to (cross-connector link). */
  relatedTicket?: string;      // "ACME-481"
  /** A prior similar incident number, if any. */
  priorIncident?: string;      // "INC-7702"
  occurredAt: string;
  /** Who can read the incident (support + project members). */
  visibleTo: string[];
}

const incKey = (n: string) => `incident:${n.toLowerCase()}`;
const accountKey = (r: ServiceNowRaw) => `account:${r.linkedAccountName.toLowerCase()}`;
const ticketKey = (k: string) => `ticket:${k.toLowerCase()}`;

export const servicenowConnector: Connector<ServiceNowRaw> = {
  meta: {
    appType: "servicenow",
    displayName: "ServiceNow",
    version: "0.1.0",
    entityTypes: ["incident", "account"],
  },

  map(raw: ServiceNowRaw): MappedPayload {
    const acl = { visible_to: raw.visibleTo, private: false, sensitivity_hint: "internal" as const };

    const entities: MappedPayload["entities"] = [
      {
        natural_key: incKey(raw.number),
        entity_type: "incident",
        name: `${raw.number}: ${raw.shortDescription}`,
        description: raw.description,
        attributes: { severity: raw.severity, status: raw.status },
      },
      {
        natural_key: accountKey(raw),
        entity_type: "account",
        name: raw.linkedAccountName,
        description: `Customer account ${raw.linkedAccountName}.`,
      },
    ];
    const relationships: RelationshipDraft[] = [
      { source_natural_key: incKey(raw.number), target_natural_key: accountKey(raw), relationship_type: "affects", weight: 1.0 },
    ];
    const eventKeys: string[] = [incKey(raw.number), accountKey(raw)];

    if (raw.relatedTicket) {
      entities.push({ natural_key: ticketKey(raw.relatedTicket), entity_type: "ticket", name: raw.relatedTicket, description: "", attributes: {} });
      relationships.push({ source_natural_key: incKey(raw.number), target_natural_key: ticketKey(raw.relatedTicket), relationship_type: "related_to", weight: 0.9 });
      eventKeys.push(ticketKey(raw.relatedTicket));
    }
    if (raw.priorIncident) {
      entities.push({ natural_key: incKey(raw.priorIncident), entity_type: "incident", name: raw.priorIncident, description: "", attributes: {} });
      relationships.push({ source_natural_key: incKey(raw.number), target_natural_key: incKey(raw.priorIncident), relationship_type: "similar_to", weight: 0.8 });
    }

    return {
      object: {
        external_id: raw.number,
        external_url: raw.url,
        object_type: "incident",
        title: `${raw.number}: ${raw.shortDescription}`,
        raw_metadata: { severity: raw.severity, status: raw.status, account: raw.linkedAccountName },
        source_acl: acl,
      },
      entities,
      chunks: [
        {
          content_type: "servicenow_incident",
          content:
            `Incident ${raw.number} [${raw.status}, ${raw.severity} severity]: ${raw.shortDescription}. ` +
            `${raw.description}` +
            (raw.relatedTicket ? ` Related work: ${raw.relatedTicket}.` : "") +
            (raw.priorIncident ? ` Similar prior incident: ${raw.priorIncident}.` : ""),
          sensitivity_label: "internal",
          trust_tier: "ticket",
          occurred_at: raw.occurredAt,
          citation_title: `${raw.number}: ${raw.shortDescription}`,
          citation_url: raw.url,
          entity_natural_key: incKey(raw.number),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: raw.status === "escalated" ? "incident.escalated" : "incident.updated",
        actor_external_id: null,
        occurred_at: raw.occurredAt,
        normalized_payload: { number: raw.number, severity: raw.severity, status: raw.status },
        entity_natural_keys: eventKeys,
      },
      relationships,
    };
  },

  fixtures(): ServiceNowRaw[] {
    return [
      {
        eventId: "SNOW-3001",
        number: "INC-7781",
        shortDescription: "Acme SSO login failures after deploy",
        description:
          "Acme users cannot log in via SSO since the 2026-06-13 deploy. Customer impact: ~400 users blocked. " +
          "Suspected cause: the SCIM provisioning change introduced for the SSO work. Escalated by the account team.",
        severity: "high",
        status: "escalated",
        linkedAccountName: "Acme Corp",
        url: "https://acme.service-now.com/incident.do?sys_id=INC-7781",
        relatedTicket: "ACME-481",
        priorIncident: "INC-7702",
        occurredAt: "2026-06-14T08:15:00Z",
        visibleTo: ["u_support", "u_dev1", "u_jdoe", "u_msmith"],
      },
      {
        eventId: "SNOW-3002",
        number: "INC-7702",
        shortDescription: "SSO intermittent errors",
        description: "Intermittent SSO errors reported last month. Resolved by an IdP config rollback; no code change required.",
        severity: "moderate",
        status: "resolved",
        linkedAccountName: "Acme Corp",
        url: "https://acme.service-now.com/incident.do?sys_id=INC-7702",
        occurredAt: "2026-05-20T11:00:00Z",
        visibleTo: ["u_support", "u_dev1", "u_jdoe", "u_msmith"],
      },
    ];
  },
};
