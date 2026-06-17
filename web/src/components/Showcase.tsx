import { useState, type ReactNode } from "react";

interface Slide {
  kicker: string;
  title: string;
  body: string;
  points: string[];
}

const SLIDES: Slide[] = [
  {
    kicker: "The problem",
    title: "Your context is scattered across a dozen apps",
    body: "Salesforce knows the deal, Slack knows the conversation, Jira knows the work, ServiceNow knows the incident, email knows the commitments. AI assistants only see the surface they live in — so people re-explain context all day.",
    points: [
      "Every assistant is an island with no shared organizational memory",
      "Answers are weaker because the relevant facts live somewhere else",
      "Copy-pasting context between tools is slow and leaky",
    ],
  },
  {
    kicker: "The product",
    title: "A governed, permission-aware context layer",
    body: "Context Fabric ingests events from your apps, normalizes them into one entity graph, and serves the right context to AI — filtered to exactly what each user is allowed to see, with citations.",
    points: [
      "7 connectors: Salesforce, Slack, Jira, GitHub, ServiceNow, Calendar, Email",
      "Cross-app entity resolution into a single context graph",
      "Delivered via REST, an MCP server, a dashboard — and this demo",
    ],
  },
  {
    kicker: "The hard part — permissions",
    title: "The AI never sees what you couldn't",
    body: "Permission parity is the core invariant: every chunk is checked against the source system's ACL at retrieval time, server-side, fail-closed. A sales rep gets the deal but the amount is redacted; a private exec channel simply isn't there.",
    points: [
      "RBAC + ABAC + field-level redaction, deny-overrides, default-deny",
      "Withheld content is counted, never named — no metadata leakage",
      "ACL-banded summaries so cached summaries can't leak across clearances",
    ],
  },
  {
    kicker: "The AI safety layer",
    title: "Untrusted content can't hijack the assistant",
    body: "A context firewall treats every retrieved document as data, never instructions. Prompt-injection attempts are detected and quarantined before anything reaches a model. Every answer is grounded and cited.",
    points: [
      "Prompt-injection detection + quarantine",
      "Provenance + trust tiers (official doc > ticket > chat > external email)",
      "Tamper-evident, hash-chained audit of every access decision",
    ],
  },
  {
    kicker: "What it produces",
    title: "Decision-ready deliverables, automatically",
    body: "The flagship: a pre-meeting brief that fires off a calendar event and synthesizes the account across every source into one cited page — with redaction and withheld-source handling baked in.",
    points: [
      "Meeting briefs, account snapshots, cross-app developer & incident context",
      "Cost-aware retrieval: rank, compress, cache, reuse — bounded token budgets",
      "Deletion & revocation propagate through summaries, caches, and the index",
    ],
  },
  {
    kicker: "Engineering credibility",
    title: "Built, verified, and honest about its limits",
    body: "From a full architecture spec to a runnable prototype: a pure, storage-agnostic core that runs on Node (SQLite) or entirely in your browser. Bugs found and fixed during verification are documented, not hidden.",
    points: [
      "85+ logic assertions verified; CI on Node 20 & 22",
      "Documented security tradeoffs (e.g. ACL-banded summaries) for real discussion",
      "This very page runs the engine client-side — open devtools and watch it",
    ],
  },
];

export function Showcase({ authSlot, note }: { authSlot: ReactNode; note?: string }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const go = (n: number) => setI((n + SLIDES.length) % SLIDES.length);

  return (
    <div className="container">
      <div className="hero">
        <h1>The secure context layer for enterprise AI</h1>
        <p>
          Context Fabric connects apps, permissions, events, knowledge, and AI assistants into one
          governed context fabric — so AI gets the right information, for the right person, safely.
        </p>
        <div className="cta-row">
          {authSlot}
          <a className="" href="#how" style={{ alignSelf: "center" }}>See how it works ↓</a>
        </div>
        {note && <div className="notice" style={{ maxWidth: 560, margin: "20px auto 0" }}>{note}</div>}
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="n">7</div><div className="l">connectors</div></div>
        <div className="stat"><div className="n">4</div><div className="l">use cases</div></div>
        <div className="stat"><div className="n">9</div><div className="l">MCP tools</div></div>
        <div className="stat"><div className="n">100%</div><div className="l">permission-filtered</div></div>
      </div>

      <div className="slides" id="how">
        <div className="slide-card">
          <div className="slide-kicker">{s.kicker} · {i + 1}/{SLIDES.length}</div>
          <h2>{s.title}</h2>
          <p>{s.body}</p>
          <div className="slide-points">
            {s.points.map((p, k) => (
              <div className="slide-point" key={k}><span className="mk">✓</span><span>{p}</span></div>
            ))}
          </div>
        </div>
        <div className="slide-nav">
          <button className="ghost" onClick={() => go(i - 1)}>← Prev</button>
          <div className="dots">
            {SLIDES.map((_, k) => (
              <button key={k} className={`dot-btn ${k === i ? "on" : ""}`} onClick={() => setI(k)} aria-label={`slide ${k + 1}`} />
            ))}
          </div>
          <button className="ghost" onClick={() => go(i + 1)}>Next →</button>
        </div>
      </div>

      <div className="center" style={{ margin: "10px 0 6px" }}>{authSlot}</div>
      <div className="footer">
        Context Fabric — portfolio project by Hunter Uhr. The hosted demo runs entirely client-side
        on mock data. <a href="https://github.com/" onClick={(e) => e.preventDefault()}>Architecture spec &amp; source</a> available on request.
      </div>
    </div>
  );
}
