import type { Connector, MappedPayload } from "./types.js";

/** Shape of a fixture Slack message event. */
export interface SlackRaw {
  eventId: string;
  channelId: string;
  channelName: string;
  /** Slack channel maps to an account/project entity by naming convention. */
  linkedAccountName: string;
  ts: string;
  permalink: string;
  authorExternalId: string;
  authorName: string;
  text: string;
  isPrivate: boolean;
  /** Members who can read the channel (drives the source ACL). */
  members: string[];
  occurredAt: string;
}

const accountKey = (raw: SlackRaw) => `account:${raw.linkedAccountName.toLowerCase()}`;

export const slackConnector: Connector<SlackRaw> = {
  meta: {
    appType: "slack",
    displayName: "Slack",
    version: "0.1.0",
    entityTypes: ["account", "team", "decision"],
  },

  map(raw: SlackRaw): MappedPayload {
    const acl = {
      visible_to: raw.members,
      private: raw.isPrivate,
      sensitivity_hint: raw.isPrivate ? ("confidential" as const) : ("internal" as const),
    };

    return {
      object: {
        external_id: raw.eventId,
        external_url: raw.permalink,
        object_type: "message",
        title: `#${raw.channelName}`,
        raw_metadata: { channel: raw.channelName, author: raw.authorName },
        source_acl: acl,
      },
      entities: [
        {
          natural_key: accountKey(raw),
          entity_type: "account",
          name: raw.linkedAccountName,
          description: `Customer account ${raw.linkedAccountName}.`,
          attributes: {},
        },
      ],
      chunks: [
        {
          content_type: "slack_message",
          content: `${raw.authorName} in #${raw.channelName}: ${raw.text}`,
          sensitivity_label: acl.sensitivity_hint,
          restricted_fields: [],
          trust_tier: "chat",
          occurred_at: raw.occurredAt,
          citation_title: `#${raw.channelName}`,
          citation_url: raw.permalink,
          entity_natural_key: accountKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: "message.created",
        actor_external_id: raw.authorExternalId,
        occurred_at: raw.occurredAt,
        normalized_payload: { channel: raw.channelName, text: raw.text },
        entity_natural_keys: [accountKey(raw)],
      },
      relationships: [],
    };
  },

  fixtures(): SlackRaw[] {
    const base = {
      channelId: "C123",
      channelName: "acme-project",
      linkedAccountName: "Acme Corp",
      permalink: "https://acme.slack.com/archives/C123/p1700000000",
      isPrivate: false,
      // The shared Acme channel: sales, eng, finance, exec, and support all
      // participate. (Nested clearance for the banded-summary demo: confidential-
      // cleared readers can also see this internal channel.)
      members: ["u_msmith", "u_jdoe", "u_dev1", "u_finance", "u_exec", "u_support"],
    };
    return [
      {
        ...base,
        eventId: "SLK-1001",
        ts: "1700000001",
        permalink: "https://acme.slack.com/archives/C123/p1700000001",
        authorExternalId: "slack_jdoe",
        authorName: "Jane Doe",
        text: "Acme asked for SSO + SCIM before they'll sign. I committed to a security review call next week.",
        occurredAt: "2026-06-11T18:20:00Z",
      },
      {
        ...base,
        eventId: "SLK-1002",
        ts: "1700000002",
        permalink: "https://acme.slack.com/archives/C123/p1700000002",
        authorExternalId: "slack_dev1",
        authorName: "Dev One",
        text: "Heads up: Acme also flagged a pricing concern on the expansion. We may need finance to weigh in.",
        occurredAt: "2026-06-11T19:05:00Z",
      },
      {
        // Private exec channel the demo asker (msmith) is NOT a member of.
        ...base,
        channelId: "C999",
        channelName: "acme-exec-private",
        eventId: "SLK-2001",
        ts: "1700000050",
        permalink: "https://acme.slack.com/archives/C999/p1700000050",
        isPrivate: true,
        members: ["u_exec", "u_finance"],
        authorExternalId: "slack_exec",
        authorName: "Exec Person",
        text: "Confidential: board wants to walk away from Acme unless they commit to a 3-year term.",
        occurredAt: "2026-06-12T09:00:00Z",
      },
    ];
  },
};
