import type { Connector, MappedPayload, RelationshipDraft } from "./types.js";

/** Fixture GitHub PR/webhook payload. */
export interface GithubRaw {
  eventId: string;
  repo: string;                 // "acme-platform"
  number: number;               // PR number
  url: string;
  title: string;
  body: string;
  branch: string;               // "feature/ACME-481"
  state: "open" | "merged" | "closed";
  authorExternalId: string;
  authorName: string;
  files: string[];
  /** Jira issue key this PR references, if any (parsed from title/branch). */
  referencesTicket?: string;    // "ACME-481"
  /** Other PRs in the same repo this PR builds on (parsed from the body). */
  buildsOnPrs?: number[];
  occurredAt: string;
  /** Repo collaborators who can read (private repo). */
  visibleTo: string[];
}

const prKey = (r: GithubRaw) => `pull_request:${r.repo.toLowerCase()}#${r.number}`;
const repoKey = (r: GithubRaw) => `repository:${r.repo.toLowerCase()}`;
const ticketKey = (key: string) => `ticket:${key.toLowerCase()}`;
const prRefKey = (repo: string, n: number) => `pull_request:${repo.toLowerCase()}#${n}`;

export const githubConnector: Connector<GithubRaw> = {
  meta: {
    appType: "github",
    displayName: "GitHub",
    version: "0.1.0",
    entityTypes: ["pull_request", "repository", "ticket"],
  },

  map(raw: GithubRaw): MappedPayload {
    const acl = { visible_to: raw.visibleTo, private: true, sensitivity_hint: "internal" as const };

    const entities: MappedPayload["entities"] = [
      {
        natural_key: prKey(raw),
        entity_type: "pull_request",
        name: `${raw.repo}#${raw.number}: ${raw.title}`,
        description: raw.body,
        attributes: { state: raw.state, branch: raw.branch, files: raw.files },
      },
      {
        natural_key: repoKey(raw),
        entity_type: "repository",
        name: raw.repo,
        description: `Source repository ${raw.repo}.`,
      },
    ];
    const relationships: RelationshipDraft[] = [
      { source_natural_key: prKey(raw), target_natural_key: repoKey(raw), relationship_type: "in_repository", weight: 1.0 },
    ];
    const eventEntityKeys: string[] = [prKey(raw), repoKey(raw)];

    // Cross-connector link: if the PR references a Jira ticket, emit a matching
    // ticket entity (same natural_key the Jira connector uses) so the shared
    // resolver links them, plus an "implements" relationship.
    if (raw.referencesTicket) {
      entities.push({
        natural_key: ticketKey(raw.referencesTicket),
        entity_type: "ticket",
        name: raw.referencesTicket,
        description: "",
        attributes: {},
      });
      relationships.push({
        source_natural_key: prKey(raw),
        target_natural_key: ticketKey(raw.referencesTicket),
        relationship_type: "implements",
        weight: 1.0,
      });
      eventEntityKeys.push(ticketKey(raw.referencesTicket));
    }

    // Cross-PR link: this PR builds on prior PR(s) in the same repo.
    for (const n of raw.buildsOnPrs ?? []) {
      const refKey = prRefKey(raw.repo, n);
      entities.push({
        natural_key: refKey,
        entity_type: "pull_request",
        name: `${raw.repo}#${n}`,
        description: "",
        attributes: {},
      });
      relationships.push({
        source_natural_key: prKey(raw),
        target_natural_key: refKey,
        relationship_type: "builds_on",
        weight: 0.9,
      });
    }

    return {
      object: {
        external_id: `${raw.repo}#${raw.number}`,
        external_url: raw.url,
        object_type: "pull_request",
        title: `${raw.repo}#${raw.number}: ${raw.title}`,
        raw_metadata: { state: raw.state, branch: raw.branch, files: raw.files },
        source_acl: acl,
      },
      entities,
      chunks: [
        {
          content_type: "github_pr",
          content:
            `PR ${raw.repo}#${raw.number} [${raw.state}] "${raw.title}" on branch ${raw.branch} by ${raw.authorName}. ` +
            `${raw.body} Files: ${raw.files.join(", ")}.` +
            (raw.referencesTicket ? ` Implements ${raw.referencesTicket}.` : ""),
          sensitivity_label: "internal",
          trust_tier: "ticket",
          occurred_at: raw.occurredAt,
          citation_title: `${raw.repo}#${raw.number}`,
          citation_url: raw.url,
          entity_natural_key: prKey(raw),
        },
      ],
      event: {
        external_event_id: raw.eventId,
        event_type: raw.state === "merged" ? "pull_request.merged" : "pull_request.updated",
        actor_external_id: raw.authorExternalId,
        occurred_at: raw.occurredAt,
        normalized_payload: { repo: raw.repo, number: raw.number, state: raw.state, title: raw.title },
        entity_natural_keys: eventEntityKeys,
      },
      relationships,
    };
  },

  fixtures(): GithubRaw[] {
    return [
      {
        eventId: "GH-7001",
        repo: "acme-platform",
        number: 128,
        url: "https://github.com/acme/acme-platform/pull/128",
        title: "ACME-481: add SSO/SCIM provisioning",
        body: "Adds SAML SSO and SCIM endpoints. Reuses the SCIM groundwork from #119. Needs a security review before merge.",
        branch: "feature/ACME-481",
        state: "open",
        authorExternalId: "gh_dev1",
        authorName: "Dev One",
        files: ["src/auth/saml.ts", "src/auth/scim.ts", "src/auth/__tests__/scim.test.ts"],
        referencesTicket: "ACME-481",
        buildsOnPrs: [119],
        occurredAt: "2026-06-13T10:30:00Z",
        visibleTo: ["u_dev1", "u_dev2", "u_jdoe"],
      },
      {
        eventId: "GH-7002",
        repo: "acme-platform",
        number: 119,
        url: "https://github.com/acme/acme-platform/pull/119",
        title: "SCIM groundwork: schema + client",
        body: "Initial SCIM data model and HTTP client. Merged; provides the base for full provisioning.",
        branch: "feature/scim-base",
        state: "merged",
        authorExternalId: "gh_dev2",
        authorName: "Dev Two",
        files: ["src/auth/scim.ts", "src/auth/types.ts"],
        occurredAt: "2026-06-05T16:45:00Z",
        visibleTo: ["u_dev1", "u_dev2", "u_jdoe"],
      },
    ];
  },
};
