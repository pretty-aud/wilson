# WILSON web build & test host (Session 12)

The web build serves all three tools under the locked path shape (#18):
`<host>/wilson` with per-page paths (`/wilson/dog`, `/wilson/otter`,
`/wilson/rabbit`, `/wilson/dashboard`, …). The platform operator console
(`/wilsonadmin`) is a separate S15 surface.

## Builds

| Command | Output | Base | Purpose |
|---|---|---|---|
| `npm run build` | `dist/` | `./` | Electron (unchanged) |
| `npm run build:web` | `dist-web/` | `/wilson/` | The web target |
| `npm run preview:web` | serves `dist-web/` | — | Local test at `http://localhost:4174/wilson` |

`preview:web` runs `scripts/serve-web.mjs` — an Express static server with
the same SPA fallback shape the test host uses. `vite preview` can't serve
this because the web base is set per-build (`--base=/wilson/`), not in
`vite.config.js` (Electron keeps `./`).

The build embeds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the
usual env files — `.env.local` on this machine points at **wilson-dev**, so
the test host talks to dev. The anon key ships in any web bundle by design
(RLS is the security boundary; sign-ups are disabled).

## Primary host — Vercel (Audrey's Pro account)

`WILSON/vercel.json` + `npm run build:vercel` make the repo a ready-made
Vercel project: the build lands in `dist-vercel/wilson/`, so the deployment
serves the locked path shape at `<domain>/wilson`, `/` redirects there, and
a rewrite gives SPA deep links a real 200 (Vercel checks the filesystem
first, so hashed assets always win). When S15 builds the operator console,
`/wilsonadmin` becomes a second output folder in the SAME project — no
second repo needed.

**One-time setup (Audrey, in the Vercel dashboard):**

1. Add New → Project → import `pretty-aud/wilson`.
2. **Root Directory: `WILSON`** (vercel.json supplies build command +
   output dir; framework preset can stay "Other"/Vite).
3. Environment variables (build-time): `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY` for whichever env beta testers should hit
   (values: Supabase dashboard → Settings → API).
4. After the first deploy: **Settings → Git → Production Branch →
   `feat/multi-user-v1`** — the default is `main`, which doesn't have the
   web build. Production deployments have no access protection; *preview*
   deployments default to Vercel Authentication (team-only), which beta
   testers can't pass — so the shareable URL must be a production one.
5. Optional custom domain: Settings → Domains → add
   `beta.petalstudios.co`; add the CNAME record Vercel shows in
   Squarespace DNS (host `beta` → `cname.vercel-dns.com`). App lands at
   `https://beta.petalstudios.co/wilson`.

Every push to the production branch then redeploys automatically.

**After the URL is final:** update the `WILSON_SITE_URL` secret on the
Supabase envs (CLI) and the dashboard `site_url` / `additional_redirect_urls`
so invite/recovery emails land on the web build.

## Fallback host — GitHub Pages

The public repo also carries a **`gh-pages`** branch, served at

    https://pretty-aud.github.io/wilson/

once Pages is enabled (Settings → Pages → "Deploy from a branch" →
`gh-pages` / root). SPA deep links ride a `404.html` copy of `index.html`.
Kept as a zero-dependency fallback; Vercel is the primary.

### Redeploying (GitHub Pages fallback)

```bash
cd WILSON
npm run build:web
cp dist-web/index.html dist-web/404.html
touch dist-web/.nojekyll
cd dist-web
git init -b gh-pages
git add -A
git commit -m "deploy: WILSON web build"
git push --force https://github.com/pretty-aud/wilson.git gh-pages
rm -rf .git
```

(The nested `.git` is deleted afterwards so `dist-web/` stays a plain
build output; the branch is force-pushed history-free on purpose.)

## Auth on the web

- Sessions persist in `localStorage` (`src/cloud/auth/sessionStorage.js`) —
  the standard Supabase SPA pattern; Electron keeps safeStorage. Refresh
  rotation re-saves via the `TOKEN_REFRESHED` hook in `supabaseClient.js`.
- Recovery/invite emails land on `<site>/#/recovery`, which the web build
  handles the same way Electron does (hash-based, path-independent).
- The Supabase **dashboard** auth settings (`site_url`,
  `additional_redirect_urls`) must include the test host — see
  `docs/OWED_AUDREY.md`. `supabase config push` is deliberately NOT used:
  it would overwrite hosted-only settings (SMTP) from the local toml.
- Edge Functions build email links from the `WILSON_SITE_URL` secret
  (set per env via `supabase secrets set`).

## E2E

`tests/e2e/web-path.spec.ts` runs in the `chromium-web` Playwright project
against the real `dist-web` bundle (the config's second `webServer` builds
and serves it). It pins: deep-link sign-in lands on the deep-linked page,
in-app navigation pushes `/wilson/<page>` URLs, browser back navigates, and
signed-out deep links show the login screen.
