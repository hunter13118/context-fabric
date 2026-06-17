# Context Fabric — hosted showcase + in-browser demo

The public face of [Context Fabric](../context-fabric/): a Vite + React app for
`hunterthemilkman.com/projects/contextfabric`.

- **Signed-out visitors** get a showcase slideshow of what the project does, plus a Clerk sign-in.
- **Signed-in users** get the **demo flow** — the full Context Fabric engine (retrieval, permission
  enforcement, field redaction, ACL-banded summaries, the context firewall, the meeting-prep
  brief, and an audit log) running **entirely in the browser** on deterministic mock data. No
  backend, no API keys, nothing leaves the page.
- **Real flow** (live model behind an auth-gated proxy) is a gated **work-in-progress placeholder**
  for the `personal_friend` tier; it points users to the demo for now.

The demo's engine in `src/fabric/` is a dependency-free port of the Node app's core, so the same
policy/retrieval/summary/firewall logic that's unit-tested in the backend also powers this page.

See **[DEPLOY.md](./DEPLOY.md)** for Cloudflare Pages + Clerk setup, tiers, and routing.

```bash
cd web && cp .env.example .env   # add VITE_CLERK_PUBLISHABLE_KEY (optional for local)
npm install && npm run dev
```
