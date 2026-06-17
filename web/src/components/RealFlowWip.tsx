export function RealFlowWip({ onUseDemo, onBack }: { onUseDemo: () => void; onBack: () => void }) {
  return (
    <>
      <div className="topbar">
        <span className="brand">Context<span className="dot">·</span>Fabric</span>
        <span className="tag">real flow</span>
        <span className="spacer" />
        <button className="ghost" onClick={onBack}>← Back</button>
      </div>
      <div className="container">
        <div className="wip">
          <div className="slide-kicker">Real flow</div>
          <h2>🚧 Work in progress</h2>
          <p style={{ color: "var(--muted)", maxWidth: 620, margin: "8px auto 22px" }}>
            The live flow — real model synthesis behind an auth-gated, budget-capped proxy (and,
            eventually, opt-in live connectors) — is still being built. It's intentionally gated so it
            can't run up costs while it's unfinished.
          </p>
          <p style={{ color: "var(--muted)", maxWidth: 620, margin: "0 auto 26px" }}>
            In the meantime, the <b>demo flow</b> shows the entire engine — retrieval, permission
            enforcement, ACL-banded summaries, the context firewall, and the meeting-brief
            deliverable — running on deterministic mock data, right in your browser.
          </p>
          <div className="cta-row">
            <button className="primary" onClick={onUseDemo}>Go to demo flow →</button>
          </div>
        </div>
      </div>
    </>
  );
}
