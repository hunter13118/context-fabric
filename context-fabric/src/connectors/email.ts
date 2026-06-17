import type { Connector, MappedPayload } from "./types.js";
import type { Sensitivity } from "../domain/types.js";

/** Fixture email message. */
export interface EmailRaw {
  eventId: string;
  messageId: string;
  threadId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  fromExternal: boolean;
  to: string[];
  linkedAccountName: string;
  body: string;
  sensitivity: Sensitivity;
  occurredAt: string;
  /** Internal recipients who can read the message. */
  visibleTo: string[];
}

const accountKey = (r: EmailRaw) => `account:${r.linkedAccountName.toLowerCase()}`;

export const emailConnector: Connector<EmailRaw> = {
  meta: {
    appType: "email",
    displayName: "Email",
    version: "0.1.0",
    entityTypes: ["account"],
  },

  map(raw: EmailRaw): MappedPayload {
    const acl = { visible_to: raw.visibleTo, private: true, sensitivity_hint: raw.sensitivity };

    return {
      object: {
        external_id: raw.messageId,
        external_url: `https://mail.example/thread/${raw.threadId}#${raw.messageId}`,
        object_type: "email",
        title: raw.subject,
        raw_metadata: { thread: raw.threadId, from: raw.fromEmail, to: raw.to },
        source_acl: acl,
      },
      entities: [
        {
          natural_key: accountKey(raw),
          entity_type: "account",
          name: raw.linkedAccountName,
          description: `Customer account ${raw.linkedAccountName}.`,
        },
      ],
      chunks: [
        {
          content_type: "email",
          content: `Email — "${raw.subject}" from ${raw.fromName} (${raw.fromEmail}): ${raw.body}`,
          sensitivity_label: raw.sensitivity,
          trust_tier: raw.fromExternal ? "external_email" : "chat",
          occurred_at: raw.occurredAt,
          citation_title: `Email: ${raw.subject}`,
          citation_url: `https://mail.example/thread/${raw.threadId}#${raw.messageId}`,
          entity_natural_key: accountKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: "email.received",
        actor_external_id: raw.fromEmail,
        occurred_at: raw.occurredAt,
        normalized_payload: { subject: raw.subject, thread: raw.threadId },
        entity_natural_keys: [accountKey(raw)],
      },
      relationships: [],
    };
  },

  fixtures(): EmailRaw[] {
    return [
      {
        eventId: "EML-9001",
        messageId: "msg-5567",
        threadId: "thr-118",
        subject: "SSO/SCIM requirement before signing",
        fromEmail: "procurement@acme.com",
        fromName: "Acme Procurement",
        fromExternal: true,
        to: ["msmith@acme.example"],
        linkedAccountName: "Acme Corp",
        body:
          "Per our last call, we need SSO and SCIM confirmed in writing before we can sign the expansion. " +
          "Our security team will want to see an audit-log capability as well.",
        sensitivity: "internal",
        occurredAt: "2026-06-10T14:12:00Z",
        // Customer email shared with the whole account team (nested with the
        // internal Slack channel so banded summaries select cleanly).
        visibleTo: ["u_msmith", "u_jdoe", "u_dev1", "u_finance", "u_exec", "u_support"],
      },
      {
        eventId: "EML-9002",
        messageId: "msg-5572",
        threadId: "thr-119",
        subject: "Re: Acme close plan",
        fromEmail: "jdoe@acme.example",
        fromName: "Jane Doe",
        fromExternal: false,
        to: ["msmith@acme.example", "finance@acme.example"],
        linkedAccountName: "Acme Corp",
        body:
          "Legal review is scheduled and the security review call is set for next week. " +
          "We still need finance sign-off on the revised expansion number before the Q3 review.",
        sensitivity: "confidential",
        occurredAt: "2026-06-13T09:40:00Z",
        visibleTo: ["u_msmith", "u_jdoe", "u_finance", "u_exec"],
      },
    ];
  },
};
