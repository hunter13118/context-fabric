import { useMemo, useState } from "react";
import { Fabric } from "../fabric/core.ts";
import type { RetrievalResult } from "../fabric/types.ts";

const EXAMPLES = [
  "What is the current state of the Acme opportunity and what changed recently?",
  "What do I need to know to implement ACME-481?",
  "Give me the context on incident INC-7781",
  "What did the board say about the Acme deal?",
];

function hintsFor(q: string): string[] {
  const out: string[] = [];
  for (const m of ["ACME-481", "INC-7781", "Acme Q3 Platform Expansion Review", "Platform Expansion", "Acme"]) {
    if (q.toLowerCase().includes(m.toLowerCase())) out.push(m);
  }
  return out.length ? out : ["Acme"];
}

function Badges({ app, sensitivity, redacted }: { app: string; sensitivity: string; redacted: string[] }) {
  return (
    <div className="badges">
      <span className="badge app">{app}</span>
      <span className={`badge ${sensitivity}`}>{sensitivity}</span>
      {redacted.length > 0 && <span className="badge redact">redacted: {redacted.join(", ")}</span>}
    </div>
  );
}

export function DemoApp({ tier, onBack }: { tier: string; onBack: () => void }) {
  const fab = useMemo(() => new Fabric(), []);
  const [userId, setUserId] = useState("u_msmith");
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [tab, setTab] = useState<"search" | "brief" | "summary" | "audit">("search");
  const [result, setResult] = useState<RetrievalResult | null>(null);
  const [slackRevoked, setSlackRevoked] = useState(false);
  const [, force] = useState(0);

  const runSearch = () => { setResult(fab.retrieve(userId, query, { hints: hintsFor(query) })); setTab("search"); };

  const brief = tab === "brief" ? fab.meetingBrief(userId, "Acme Q3 Platform Expansion Review") : null;
  const summary = tab === "summary" ? fab.bandedSummary(userId, "Acme Corp", "account") : null;

  const toggleSlack = () => {
    if (slackRevoked) { fab.resetDeletions(); setSlackRevoked(false); }
    else { fab.revokeApp(userId, "slack"); setSlackRevoked(true); }
    if (result) setResult(fab.retrieve(userId, query, { hints: hintsFor(query) }));
    force((n) => n + 1);
  };

  return (
    <>
      <div className="topbar">
        <span className="brand">Context<span className="dot">·</span>Fabric</span>
        <span className="tag">demo flow · in-browser · mock data</span>
        <span className="spacer" />
        <span className="badge tier">{tier}</span>
        <button className="ghost" onClick={onBack}>← Back</button>
      </div>

      <div className="container appwrap">
        <div className="toolbar">
          <div className="who">
            <span className="meta" style={{ margin: 0 }}>Acting as</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {fab.users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name} — {u.title}</option>
              ))}
            </select>
          </div>
          <input
            className="q" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Ask about Acme, ACME-481, INC-7781…"
          />
          <button className="primary" onClick={runSearch}>Search</button>
        </div>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ghost" onClick={() => { setQuery(ex); setResult(fab.retrieve(userId, ex, { hints: hintsFor(ex) })); setTab("search"); }}>{ex.length > 42 ? ex.slice(0, 40) + "…" : ex}</button>
          ))}
        </div>
        <div className="hint">
          Switch the acting user and re-run the same query — watch permissions, field redaction, and
          withheld counts change. Everything runs in your browser; nothing is sent anywhere.
        </div>

        <div className="tabs">
          {(["search", "brief", "summary", "audit"] as const).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "search" ? "Search" : t === "brief" ? "Meeting brief" : t === "summary" ? "Banded summary" : "Audit log"}
            </button>
          ))}
          <span className="spacer" />
          <button className="ghost" onClick={toggleSlack} title="Demonstrate deletion/revocation propagation">
            {slackRevoked ? "↩ Restore Slack" : "⊘ Revoke Slack connection"}
          </button>
        </div>

        {/* SEARCH */}
        {tab === "search" && (
          <div>
            {!result && <div className="meta">Run a query to see governed, cited context.</div>}
            {result && (
              <>
                <div className="meta">
                  focus: {result.entity_focus.map((e) => `${e.name} (${e.type})`).join(", ") || "—"} ·
                  returned {result.items.length} · <span className="denied">withheld {result.denied_count}</span> ·
                  confidence {result.confidence} · {result.used_tokens}/{result.max_tokens} tokens
                </div>
                {result.denied_count > 0 && <div className="meta denied">{result.denied_summary}</div>}
                {result.items.map((it) => (
                  <div className="card" key={it.chunk_id}>
                    <h3>{it.summary}</h3>
                    <div className="body">{it.content}</div>
                    <Badges app={it.citation.app} sensitivity={it.sensitivity} redacted={it.redacted_fields} />
                    <div className="hint"><a href={it.citation.url} target="_blank" rel="noreferrer">{it.citation.title} ↗</a> · {it.citation.occurred_at}</div>
                  </div>
                ))}
                {result.items.length === 0 && <div className="card">Nothing you're permitted to see answers this.</div>}
              </>
            )}
          </div>
        )}

        {/* MEETING BRIEF */}
        {tab === "brief" && brief && (
          <div>
            <div className="meta">
              Pre-meeting brief · <b>{brief.meeting}</b> · account {brief.account} · confidence {brief.confidence} ·
              <span className="denied"> {brief.withheld} withheld by policy</span>
            </div>
            {brief.sections.map((s) => (
              <div key={s.title}>
                <div className="section-title">{s.title}</div>
                {s.items.map((it) => (
                  <div className="card" key={it.chunk_id}>
                    <div className="body">{it.content}</div>
                    <Badges app={it.citation.app} sensitivity={it.sensitivity} redacted={it.redacted_fields} />
                    <div className="hint"><a href={it.citation.url} target="_blank" rel="noreferrer">{it.citation.title} ↗</a></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {tab === "brief" && !brief && <div className="card">No meeting found for this user.</div>}

        {/* BANDED SUMMARY */}
        {tab === "summary" && (
          <div>
            <div className="hint" style={{ marginBottom: 10 }}>
              ACL-banded summary of the Acme account. The band — and what's in it — depends on the
              acting user's clearance; a lower-cleared reader never receives content above their band.
            </div>
            {summary && "band" in summary ? (
              <div className="card">
                <h3>Acme Corp <span className={`badge ${summary.band}`}>{summary.band} band</span> {summary.cache_hit && <span className="badge">cache hit ✓</span>}</h3>
                <div className="body" style={{ marginTop: 8 }}>{summary.summary}</div>
                <div className="hint">{summary.source_count} source chunks · {summary.cache_hit ? "served from cache (reused across this band)" : "freshly generated"}</div>
              </div>
            ) : (
              <div className="card">No content you're permitted to see for this entity.</div>
            )}
          </div>
        )}

        {/* AUDIT */}
        {tab === "audit" && (
          <div>
            <div className="hint" style={{ marginBottom: 10 }}>Every access decision is logged. Most recent first.</div>
            <pre>{fab.audit.slice(-40).reverse().map((a) => `${a.action.padEnd(22)} ${(a.decision ?? "").padEnd(7)} ${a.reason ?? ""}`).join("\n") || "No activity yet — run a query."}</pre>
          </div>
        )}
      </div>
    </>
  );
}
