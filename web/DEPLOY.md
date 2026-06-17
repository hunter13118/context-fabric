# Deploying the Context Fabric showcase (Cloudflare Pages + Clerk)

This is a static Vite + React app. The **demo flow runs entirely in the browser** (no backend),
so the whole thing fits the Cloudflare Pages free tier. Clerk handles auth; tiers gate what a
signed-in user can reach.

```
Visitor → hunterthemilkman.com/projects/contextfabric
  ├─ signed out ........ Showcase (slideshow) + "Sign in" (Clerk modal)
  └─ signed in
       ├─ tier = personal_friend/admin → can pick Demo flow OR Real flow (WIP placeholder)
       └─ tier = guest_* / anything else → Demo flow only (client-side, mock data)
```

## 1. Prerequisites
- Node 18+ locally
- A **Clerk** account/application bound to `hunterthemilkman.com`
- A **Cloudflare** account with `hunterthemilkman.com` on Cloudflare DNS

## 2. Clerk setup
1. Create (or reuse) one Clerk application for the domain — using a single instance means sign-in
   is shared across all your `hunterthemilkman.com` projects.
2. Copy the **Publishable key** (`pk_live_…`) from Clerk → **API keys**.
3. Under **Paths / Allowed origins**, add `https://hunterthemilkman.com` (and your Pages preview
   URL) so the modal sign-in is permitted.
4. **Tiers** are stored on each user's *public metadata*. In Clerk → **Users** → pick a user →
   **Metadata → Public**, set:
   ```json
   { "tier": "personal_friend" }
   ```
   Recognized values: `personal_friend` / `admin` / `owner` → real-flow eligible;
   `guest_x`, `guest_y`, `guest`, or anything else → demo only. (You can wire these via Clerk
   invitations later so invited users land on the right tier automatically.)

## 3. Local dev
```bash
cd web
cp .env.example .env          # set VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
npm install
npm run dev                   # http://localhost:5173/projects/contextfabric/
```
Without a Clerk key the app still runs — it shows the showcase and an **open demo** (handy for
first deploys and for screenshots).

## 4. Build
```bash
npm run build                 # outputs static site to web/dist
npm run preview               # optional local check of the production build
```

## 5. Deploy to Cloudflare Pages
1. Cloudflare dashboard → **Workers & Pages → Create → Pages →** connect your repo (or
   `wrangler pages deploy dist` for direct upload).
2. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `web` (if this lives in a monorepo)
3. **Environment variables** (Production *and* Preview): `VITE_CLERK_PUBLISHABLE_KEY = pk_live_…`
4. Deploy.

### Routing it under `/projects/contextfabric`
The app is built with Vite `base: "/projects/contextfabric/"` and ships a `public/_redirects`
SPA fallback. Two ways to serve it at that path:

- **Easiest — subdomain:** point a custom domain like `contextfabric.hunterthemilkman.com` at the
  Pages project and change `base` in `vite.config.ts` to `"/"`. Done.
- **Path under the apex:** keep `base` as-is and have the apex delegate `/projects/contextfabric/*`
  to this Pages project. If your main site is also on Cloudflare, add a **Pages custom domain** of
  `hunterthemilkman.com` to this project scoped to that path, or put a small Worker route in front
  that forwards `/projects/contextfabric/*` here. The `_redirects` file handles the in-app SPA
  routing once requests arrive.

## 6. Security notes (read before adding the real flow)
- The demo flow is **100% client-side over mock data**, so client-side tier gating is fine —
  there is nothing sensitive to protect and no secrets in the bundle.
- When you build the **real flow**, the live-model call must go through a **Cloudflare Pages
  Function** that holds the API key as a secret and **verifies the Clerk session JWT + tier
  server-side before spending** (use `@clerk/backend`). Never let the client decide whether to
  spend your budget. The current build ships the real flow as a gated WIP placeholder — no
  secret, no spend.

## 7. What's where
```
web/
  index.html              app shell
  vite.config.ts          base path = /projects/contextfabric/
  public/_redirects       SPA fallback for Cloudflare Pages
  src/
    main.tsx              ClerkProvider (optional) + mount
    App.tsx               auth + tier routing
    components/
      Showcase.tsx        slideshow of key points + sign-in slot
      DemoApp.tsx         interactive in-browser demo (user switcher, search, brief, summary, audit)
      RealFlowWip.tsx     "work in progress" placeholder → demo
    fabric/               dependency-free in-browser port of the Context Fabric core
      types.ts, fixtures.ts, core.ts
```
