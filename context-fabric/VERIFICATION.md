# Verification status

This prototype was authored and partially verified in an isolated build sandbox whose package
registry is **blocked**, so a full `npm install` + `npm run demo` could not be executed there.
The following was verified directly; the remainder runs on your machine after `npm install`.

## Verified in-sandbox (no third-party packages required)

Using Node 22's built-in TypeScript support and `node:sqlite`:

1. **SQL schema validity** — `src/db/schema.sql` loads cleanly, all 12 tables create, and a
   round-trip insert/select succeeds (`node:sqlite`).
2. **Pure retrieval logic (10 assertions):**
   - mock embeddings: related text scores higher cosine than unrelated; self-cosine ≈ 1
   - hybrid search ranks the on-topic chunk first, off-topic last
   - context firewall: prompt-injection message is flagged + quarantined; `<script>`/markdown
     link targets / zero-width chars stripped; benign content untouched
   - field redaction regex: `amount` value replaced with `[REDACTED]`, other fields intact
3. **Policy decision matrix (10 assertions)** against the seeded policies:
   - sales manager allowed on confidential Salesforce, `amount` redacted
   - finance allowed, `amount` **not** redacted (field grant)
   - engineer denied (not in the record's source ACL → `not_shared_with_you`)
   - sales manager allowed on internal Slack
   - sales manager **denied** the private exec channel they're not a member of (parity)
   - exec (member + confidential clearance) **allowed** on that same private channel
   - unknown user denied confidential content
   - cross-tenant subject denied (`tenant_mismatch`)

4. **Audit hash chain (2 assertions)** — replaying the exact `audit()` / `verifyChain()`
   logic against `node:sqlite`: 50 events written in the *same millisecond* still produce an
   intact chain (verifies the `rowid`-ordering fix — `created_at` alone is not a stable key),
   and mutating one row is detected as tampering.

5. **Connector mapping (9 assertions)** — the real `jiraConnector.map` / `githubConnector.map`
   produce the expected canonical entities, chunks, and relationships; the GitHub connector emits
   an `implements` edge to the **same `ticket:acme-481` natural key** the Jira connector uses
   (cross-connector linking), plus `builds_on` and `in_repository` edges.
6. **Cross-connector entity resolution (4 assertions)** — the real `EntityResolver`, shared across
   connectors as the pipeline now does it, resolves the Jira ticket and the GitHub reference to a
   **single entity id**, dedupes the account across apps, keeps distinct entities distinct, and
   bumps `source_count` on re-resolution.
7. **2-hop graph expansion (6 assertions)** — the exact `graphExpand` algorithm reaches PR#128
   (implements, 1 hop), the account (1 hop), PR#119 (builds_on, 2 hops), the repo, and the
   confidential Salesforce opportunity via the account (2 hops); a 1-hop expansion does **not**
   reach PR#119 — confirming the dev brief stitches Jira+GitHub+Slack while the confidential
   opportunity is graph-reachable (and therefore must be, and is, policy-denied for the developer).

8. **ServiceNow connector mapping (5 assertions)** — the real `servicenowConnector.map` links
   an incident to its account (`affects`), the related Jira ticket (`related_to` →
   `ticket:acme-481`, cross-connector), and a prior incident (`similar_to`), with internal
   sensitivity.
9. **ACL-banded summary band selection (6 assertions)** — the band-selection algorithm assigns
   the engineer the **internal** band (confidential chunk excluded — no leak), finance and exec
   the **confidential** band (cache-shareable, identical chunk set), and support the **internal**
   band (in the channel but without confidential clearance).

10. **Calendar + Email connector mapping (10 assertions)** — `calendarConnector.map` creates a
    meeting entity linked to its account (`about`); `emailConnector.map` tags external senders as
    the `external_email` trust tier, internal as `chat`, ties email chunks to the account, marks
    the source private, and preserves the per-message sensitivity label.

All 62 logic assertions + schema check passed. The meeting-brief assembly itself (graph
resolution meeting→account, sectioned retrieval, redaction, withheld counts) is covered by the
`tests/uc4.test.ts` vitest suite, which runs on your machine.

### Bugs found & fixed during verification
1. **Audit chain ordering.** Originally ordered rows by `created_at`; because many audit events
   share a millisecond, insert-order and verify-order could diverge and the chain check would
   fail spuriously. Fixed by ordering on SQLite's monotonic `rowid`.
2. **Banded-summary label overstatement.** The band loop iterated all four sensitivity tiers from
   the top, so a reader who could see everything was labeled `restricted` even when no chunk was
   restricted-level. Fixed to iterate only the sensitivities actually present among the entity's
   chunks (highest first), so the band label reflects real content.
3. **Field-restricted content in summaries.** Caught while wiring S-1: a field-restricted chunk
   (finance-only `amount`) folded into a cached free-text summary would leak the value to a
   reader who should see it redacted. Fixed by excluding field-restricted chunks from banded
   summaries entirely (served only via per-field-redacted retrieval).

## Runs on your machine (needs `npm install`)

- `npm run demo` — full narrated loop incl. UC2 dev brief, UC3 incident brief, **UC4 meeting-prep brief (writes a deliverable to `out/`)**, ACL-banded summaries, and deletion propagation
- `npm run api` — REST API **plus an interactive web dashboard** at `http://localhost:8787`
- `npm test` — the vitest suites in `tests/`: permission parity, retrieval/grounding, firewall,
  connector mapping, **UC2 cross-connector brief**, **UC3 incident brief**, **UC4 meeting-prep
  brief**, **S-1 ACL-banded summaries**, **deletion/legal-hold propagation**, audit chain
- `npm run api` / `npm run mcp` — the REST and MCP surfaces (need `fastify` / `@modelcontextprotocol/sdk`)
- `npm run typecheck` — full TypeScript type check

## Notes / portability

- The app runs via `tsx` (no build step). It uses TypeScript *parameter properties* and `.js`
  import specifiers, which `tsx` and `tsc` handle. (Node's experimental strip-only mode does not,
  which is why the sandbox checks above used desugared copies — the shipped source is unchanged.)
- `better-sqlite3` ships prebuilt binaries for common Node/OS combinations; `npm install` should
  not require a compiler on Windows/macOS/Linux x64 with Node 20–22.
- If you'd rather avoid the native dependency entirely, the storage layer is isolated behind
  `src/db/database.ts` + `repositories.ts` and could be swapped for Node 22's built-in
  `node:sqlite` with a thin adapter.
