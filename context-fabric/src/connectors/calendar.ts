import type { Connector, MappedPayload } from "./types.js";

/** Fixture calendar event. The upcoming meeting is the trigger for a brief. */
export interface CalendarRaw {
  eventId: string;
  meetingId: string;            // "MTG-501"
  title: string;
  startsAt: string;             // ISO; the meeting time
  /** Account this meeting concerns (real impl matches attendee email domains). */
  linkedAccountName: string;
  agenda: string;
  attendees: { email: string; name: string; external: boolean }[];
  organizerExternalId: string;
  occurredAt: string;           // when the event was created/updated
  /** Internal attendees who can read the event. */
  visibleTo: string[];
}

const meetingKey = (r: CalendarRaw) => `meeting:${r.meetingId.toLowerCase()}`;
const accountKey = (r: CalendarRaw) => `account:${r.linkedAccountName.toLowerCase()}`;

export const calendarConnector: Connector<CalendarRaw> = {
  meta: {
    appType: "calendar",
    displayName: "Calendar",
    version: "0.1.0",
    entityTypes: ["meeting", "account"],
  },

  map(raw: CalendarRaw): MappedPayload {
    const acl = { visible_to: raw.visibleTo, private: false, sensitivity_hint: "internal" as const };
    const externals = raw.attendees.filter((a) => a.external).map((a) => `${a.name} <${a.email}>`).join(", ");
    const internals = raw.attendees.filter((a) => !a.external).map((a) => a.name).join(", ");

    return {
      object: {
        external_id: raw.meetingId,
        external_url: `https://calendar.example/event/${raw.meetingId}`,
        object_type: "meeting",
        title: raw.title,
        raw_metadata: { startsAt: raw.startsAt, attendees: raw.attendees },
        source_acl: acl,
      },
      entities: [
        {
          natural_key: meetingKey(raw),
          entity_type: "meeting",
          name: raw.title,
          description: `Meeting on ${raw.startsAt} regarding ${raw.linkedAccountName}.`,
          attributes: { starts_at: raw.startsAt, meeting_id: raw.meetingId },
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
          content_type: "calendar_event",
          content:
            `Meeting "${raw.title}" starts ${raw.startsAt}. Agenda: ${raw.agenda} ` +
            `External attendees: ${externals || "none"}. Internal: ${internals || "none"}.`,
          sensitivity_label: "internal",
          trust_tier: "ticket",
          occurred_at: raw.occurredAt,
          citation_title: raw.title,
          citation_url: `https://calendar.example/event/${raw.meetingId}`,
          entity_natural_key: meetingKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: "meeting.scheduled",
        actor_external_id: raw.organizerExternalId,
        occurred_at: raw.occurredAt,
        normalized_payload: { meeting_id: raw.meetingId, title: raw.title, starts_at: raw.startsAt },
        entity_natural_keys: [meetingKey(raw), accountKey(raw)],
      },
      relationships: [
        { source_natural_key: meetingKey(raw), target_natural_key: accountKey(raw), relationship_type: "about", weight: 1.0 },
      ],
    };
  },

  fixtures(): CalendarRaw[] {
    return [
      {
        eventId: "CAL-9100",
        meetingId: "MTG-501",
        title: "Acme Q3 Platform Expansion Review",
        startsAt: "2026-06-16T15:00:00Z",
        linkedAccountName: "Acme Corp",
        agenda: "Confirm SSO/SCIM readiness, address pricing concern, align on the close plan and timeline.",
        attendees: [
          { email: "msmith@acme.example", name: "Morgan Smith", external: false },
          { email: "jdoe@acme.example", name: "Jane Doe", external: false },
          { email: "procurement@acme.com", name: "Acme Procurement", external: true },
          { email: "cto@acme.com", name: "Acme CTO", external: true },
        ],
        organizerExternalId: "cal_msmith",
        occurredAt: "2026-06-14T17:00:00Z",
        visibleTo: ["u_msmith", "u_jdoe"],
      },
    ];
  },
};
