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

## Test host — GitHub Pages

The public repo `pretty-aud/wilson` doubles as the host: a **`gh-pages`**
branch holds the built bundle, served at

    https://pretty-aud.github.io/wilson/

which matches `base: /wilson/` exactly. SPA deep links ride a `404.html`
copy of `index.html` (GitHub Pages serves it for unknown paths; the app
boots and routes client-side). `/wilsonadmin` will be a sibling repo named
`wilsonadmin` when S15 builds the operator console.

**One-time enable (Audrey):** repo → Settings → Pages → "Deploy from a
branch" → `gh-pages` / root.

### Redeploying

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
