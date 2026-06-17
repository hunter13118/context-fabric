import type { Connector, MappedPayload } from "./types.js";

/** Shape of a fixture Salesforce CDC/Platform-Event payload. */
export interface SalesforceRaw {
  eventId: string;
  objectType: "Opportunity";
  recordId: string;
  url: string;
  name: string;
  accountName: string;
  accountExternalId: string;
  ownerExternalId: string;
  occurredAt: string;
  changes: { field: string; from: unknown; to: unknown }[];
  /** External principals (user ids) with source access to this record. */
  visibleTo: string[];
}

const accountKey = (raw: SalesforceRaw) => `account:${raw.accountName.toLowerCase()}`;
const oppKey = (raw: SalesforceRaw) => `opportunity:${raw.recordId}`;

export const salesforceConnector: Connector<SalesforceRaw> = {
  meta: {
    appType: "salesforce",
    displayName: "Salesforce",
    version: "0.1.0",
    entityTypes: ["account", "opportunity"],
  },

  map(raw: SalesforceRaw): MappedPayload {
    const acl = {
      visible_to: raw.visibleTo,
      private: false,
      sensitivity_hint: "confidential" as const,
    };

    // Amount changes are field-restricted (finance-only) — demonstrates FLS.
    const changeText = raw.changes
      .map((c) => `${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`)
      .join("; ");
    const restricted = raw.changes.some((c) => c.field === "amount") ? ["amount"] : [];

    return {
      object: {
        external_id: raw.recordId,
        external_url: raw.url,
        object_type: "opportunity",
        title: raw.name,
        raw_metadata: { account: raw.accountName, changes: raw.changes },
        source_acl: acl,
      },
      entities: [
        {
          natural_key: oppKey(raw),
          entity_type: "opportunity",
          name: raw.name,
          description: `Salesforce opportunity for ${raw.accountName}.`,
          attributes: Object.fromEntries(raw.changes.map((c) => [c.field, c.to])),
        },
        {
          natural_key: accountKey(raw),
          entity_type: "account",
          name: raw.accountName,
          description: `Customer account ${raw.accountName}.`,
          attributes: { external_id: raw.accountExternalId },
        },
      ],
      chunks: [
        {
          content_type: "salesforce_change",
          content: `Opportunity "${raw.name}" updated. ${changeText}.`,
          sensitivity_label: "confidential",
          restricted_fields: restricted,
          trust_tier: "ticket",
          occurred_at: raw.occurredAt,
          citation_title: raw.name,
          citation_url: raw.url,
          entity_natural_key: oppKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: "opportunity.updated",
        actor_external_id: raw.ownerExternalId,
        occurred_at: raw.occurredAt,
        normalized_payload: { name: raw.name, changes: raw.changes, account: raw.accountName },
        entity_natural_keys: [oppKey(raw), accountKey(raw)],
      },
      relationships: [
        {
          source_natural_key: oppKey(raw),
          target_natural_key: accountKey(raw),
          relationship_type: "belongs_to",
          weight: 1.0,
        },
      ],
    };
  },

  fixtures(): SalesforceRaw[] {
    return [
      {
        eventId: "EVT-558211",
        objectType: "Opportunity",
        recordId: "006Ti000001",
        url: "https://acme.my.salesforce.com/006Ti000001",
        name: "Acme – Platform Expansion",
        accountName: "Acme Corp",
        accountExternalId: "001Ti000002",
        ownerExternalId: "sfdc_jdoe",
        occurredAt: "2026-06-12T15:04:22Z",
        changes: [
          { field: "stage", from: "Negotiation", to: "Proposal" },
          { field: "amount", from: 480000, to: 525000 },
          { field: "close_date", from: "2026-08-31", to: "2026-09-15" },
        ],
        visibleTo: ["u_jdoe", "u_msmith", "u_finance"],
      },
    ];
  },
};
