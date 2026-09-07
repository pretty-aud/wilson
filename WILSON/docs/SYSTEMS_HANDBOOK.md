# WILSON — Systems Handbook

**Version 1.0.0 · 2026-07-30 · written from the frozen post-Session-15 tree
(commit `09b4405`) and updated in place for Session 17's changes
(`b726e75`, `6ab10c6`). Branch `feat/multi-user-v1`.**

> The handbook is a **release gate**, which makes it a maintenance
> obligation: anything that changes what it describes changes it in the same
> commit. S17's edits are concentrated in §3.1 (managed-files containment),
> §4.4, §4.6 and §4.9 (migration 0030 and its ordering rule), §13.1, §13.4,
> §15 (test counts), §16 (one of the two open criticals is now closed) and
> §17, which shrank the most.

---

## 0. How to read this document

This is the "how the whole thing works, and what talks to what" document for
WILSON, the Petal Studios creative-production platform. It was written by
reading the code, not by summarising earlier documents, and it is meant to be
trusted verbatim by readers who cannot check.

**Two audiences, deliberately.**

1. **Humans joining the project.** Read §1–§3 for orientation, then whichever
   system section you are about to touch. §14 ("Who talks to whom") is the
   fastest way to build a mental model.
2. **Claude accounts receiving this as seed material** for a Claude project, a
   skill, or a `CLAUDE.md`. Every section is self-contained and excerptable;
   invariants are stated *with the reason they exist*, so an agent acting on
   an excerpt can tell the difference between a convention it may change and a
   load-bearing rule it must not.

**What this document is not.** It is not the project's history — that is
`docs/MASTER_PLAN.md`, which stays the living record of the multi-user
migration (session ledger, locked decisions, carry-forward gaps). The handbook
supersedes nothing; it is the timeless "how it works now". Where the two ever
disagree, the code is the authority and both documents are wrong.

**Secrets.** This repository is **public**. "Private" here means Audrey hands
this document out manually, not that the file is hidden. Nothing in it is a
secret: no keys, no tokens, no passwords, no connection strings. Environment
variables are named, never valued. The Supabase project references and
hostnames below are already public in this repo's other docs and in the shipped
web bundle (see §4.1 on why anon keys are public by design).

**Conventions used below.**

- `path:line` references point into the repo at the commit named above.
- "FROZEN" marks an invariant that cannot be changed without a coordinated
  migration; the reason is always given.
- Version at time of writing: `package.json` `0.6.3`; tool versions
  D.O.G. `0.514`, O.T.T.E.R. `0.3.1`, R.A.B.B.I.T. `0.1.0`. The v1.0.0 in this
  document's header is the *handbook's* version and the release it gates, not
  the current app version — S17 cuts `package.json` to 1.0.0.

---

## 1. What WILSON is

WILSON is a multi-tenant creative-production platform that ships as **one
codebase on two hosts**: a Windows Electron desktop application and a web
build. It contains **three tools** and a set of shared surfaces around them:

| Tool | Name | What it does |
|---|---|---|
| **D.O.G.** | Deck Outline Generator | Turns source documents into structured, layout-tagged slide outlines plus a machine-readable geometry spec. |
| **O.T.T.E.R.** | (learning platform) | Generates, studies, quizzes and fact-checks software/skills courses, with a company-standard tier and a pull-request-style change-request loop. |
| **R.A.B.B.I.T.** | Resource Allocation, Budgeting & Breakdown Intake Tool | Ingests creative source documents and produces a production breakdown — phases, assets, tasks, budgets, timelines, files. |

Around them sit a Home launcher, a personal Dashboard (cross-project tasks +
private notes + profile), a Projects page, a Rate Card, a Team Members roster,
a company **Admin Terminal**, Settings, Help, a pet/agent companion, and — on a
separate surface entirely — a **platform operator console**.

**The tenancy model.** A *workspace* is a company. Every user belongs to one or
more workspaces through a `workspace_members` row that carries their
per-workspace username and app role. Every domain row carries a
`workspace_id`, and **Postgres Row-Level Security is the security boundary** —
not the client, not the Edge Functions. See §4.4.

**The four tiers of authority**, lowest to highest:

1. `user` — ordinary member.
2. `manager` — tool-wide manager tier; bypasses project-level gating, reads
   rate cards, views (but cannot decide) O.T.T.E.R. change requests.
3. `admin` — company admin; Admin Terminal, roster, grants, company-standard
   courses, project delete/restore.
4. **platform operator** — Petal Studios itself. Cross-tenant. Lives on a
   separate web surface (`/wilsonadmin`), can create and destroy companies, and
   **cannot be granted from any user interface anywhere** (§5.3).

A fifth, orthogonal role family exists *inside* R.A.B.B.I.T. at the project
level (`manager` / `reviewer` / `member`) — see §13.3.

---

## 2. The map in one page

**Systems WILSON depends on.**

| System | Role | Section |
|---|---|---|
| Electron + local Express server | Desktop host; local file/data plane | §3.1 |
| Vercel | Web host for `/wilson` and `/wilsonadmin` | §3.2 |
| Supabase (×3 environments) | Auth, Postgres+RLS, Realtime, Edge Functions, Storage, cron | §4 |
| Anthropic | All AI generation, reached **only** through the `ai-proxy` Edge Function | §6 |
| GitHub Actions | CI (pgTAP, smoke, unit, e2e) + nightly backups | §7 |
| Backblaze B2 | Nightly `pg_dump` archives + auto-update installer feed | §8 |
| Resend | Invite / recovery / email-change mail | §9 |
| Sentry | Error reporting, renderer + Electron main, per environment | §10 |
| electron-updater | NSIS auto-update over the B2 feed | §11 |
| Google Drive | Read-only company storage provider (v0.1) | §12.1 |

**The one-sentence trust model.** *Clients are untrusted; the database is the
boundary; Edge Functions exist only for the operations RLS cannot express
(minting users, holding secrets, crossing tenants) and every one of them
re-checks a live database row rather than trusting a token claim.*

---

## 3. The two hosts

WILSON is one React 19 + Vite + Tailwind 4 codebase built three ways: for
Electron, for the web app, and for the operator console (§5.1).

### 3.1 The Electron desktop app

**Main process** — `electron/main.cjs` (~2500 lines), plus `preload.cjs`,
`env.cjs`, `sentry.cjs`, `updater.cjs`.

Boot order (`main.cjs:16-20`, `2473-2490`):

1. `loadEnv(app, REPO_ROOT)` — reads `.env.development` from the repo root in
   development, or `{userData}/env.json` when packaged, and only sets keys not
   already present in `process.env` (`env.cjs:34-64`).
2. `initMainSentry()` — after `loadEnv`, so the DSN exists (`main.cjs:20`).
3. `app.whenReady()` → `cleanupLegacySupabaseConfig()` →
   `cleanupLegacyAuthFile()` → `createWindow()` → `initUpdater()`.
4. `createWindow()` starts the local Express server **first**, then creates the
   `BrowserWindow` and points it at that server (`main.cjs:2094-2121`).

**Window security posture** (`main.cjs:2103-2118`): `nodeIntegration: false`,
`contextIsolation: true`, a preload bridge, `frame: false` (custom title bar in
`src/components/TitleBar.jsx`, Electron-only), `autoHideMenuBar: true`.
`sandbox` is not explicitly set and inherits Electron 33's default.
Ctrl+R/F5 are intercepted and re-mapped to "reset zoom" rather than reloading
(`main.cjs:2124-2131`); `http(s)` links open in the OS browser via
`shell.openExternal` and in-window navigation is denied (`main.cjs:2134-2140`).
Window close is intercepted and handed to the renderer as a `close-requested`
event unless `_forceClose` is set (`main.cjs:2142-2146`) — the updater sets that
flag before `quitAndInstall()`.

There is **no single-instance lock**: `app.requestSingleInstanceLock()` does not
appear anywhere, so two copies can run against the same `userData` directory,
each with its own Express port. (Tracked; see §17.)

#### The local Express server

Created inside `startLocalServer(distPath)` (`main.cjs:140-2086`).

| Property | Value | Where |
|---|---|---|
| Bind | `listen(0, '127.0.0.1')` — **loopback only**, never reachable off-host | `main.cjs:2079` |
| Port | OS-assigned ephemeral; read back and used as the window's own origin, so no port-discovery IPC exists | `main.cjs:2079-2082, 2121` |
| CORS | `app.use(cors())` — no options, fully permissive | `main.cjs:143` |
| Body limit | `express.json({ limit: '50mb' })`; no multipart parser — uploads ride base64 inside JSON | `main.cjs:144` |
| Static | `express.static(dist)` + an Express-5 catch-all `GET /{*splat}` → `index.html` | `main.cjs:2074-2077` |
| Authentication | **None.** See the honesty note below. | — |

**Route families** — 89 literal route registrations; a generic sub-entity
factory (18 entity names × 3 verbs) and a 4-entity thumbnail loop expand that to
roughly 144 endpoints at runtime.

| Family | Representative routes | Consumer |
|---|---|---|
| Pet | `GET/POST /api/pet` only (**Phase 3, 2026-08-12: `POST /api/pet/reset` and `POST /api/pet/new-egg` REMOVED — both verified callerless. `reset` never had one; `new-egg` answered an ACCOUNT-scoped question from the per-device `pet.json`, which was half of Audrey's "Create Egg does nothing" bug. Eligibility now lives in `src/lib/petLifecycle.js`**) | Pet companion (§13.5) |
| O.T.T.E.R. content | `GET/POST /api/software`, `…/:slug/subjects` (**incl. `PUT …/subjects/:sub`, S30**), `…/hotkeys`, `…/functions`, `…/nodes`, `…/progress`, `…/references`, `…/corrections`, `GET /api/export-all` | O.T.T.E.R. local mode |
| O.T.T.E.R. quiz history | `GET/POST /api/otter/quiz-history` (**S30 — not per course, and the one `/api/otter/` route that is NOT cloud-only**) | O.T.T.E.R., both backends |
| O.T.T.E.R. settings | `GET/POST /api/otter-settings`, `GET/POST /api/agent-skills` | Settings, agent |
| Shared utilities | `POST /api/fetch-url`, `POST /api/fetch-raw`, `POST /api/extract-pdf` | O.T.T.E.R. references; RABBIT rate-card import; RABBIT intake |
| R.A.B.B.I.T. projects | `GET/POST /api/rabbit/projects`, `GET/PATCH/DELETE /api/rabbit/projects/:id` | RABBIT local mode |
| R.A.B.B.I.T. sub-entities | factory-generated POST/PATCH/DELETE for phases, tasks, dependencies, task-links, asset-versions, comments, ingestion-runs, team-assignments, budget-versions, expenses, budget-lines, budget-actuals, scenes, shots, levels, experiences, milestones, project-team | RABBIT |
| Files | `POST /api/rabbit/projects/:p/files`, `…/files/:id/download`, PATCH/DELETE, `…/files/:id/events`, `…/file-events`, `…/files/relink-scan`, `…/files/relink-apply` | RABBIT attachments + relink |
| Managed files | `GET/POST /api/rabbit/projects/:p/managed-files`, PATCH/DELETE (`?hard=true`), `…/:id/thumbnail`, `…/import-folder` | RABBIT production media |
| Thumbnails | `…/assets/:id/thumbnail`, and the same for scenes/shots/levels/experiences | RABBIT galleries |
| Workspace-scoped stores | `…/workspaces/:id/rate-cards`, `…/team-members`, `…/task-templates` (+ entry/dept-default routes) | Rate Card, Team, Templates |

> **There is no `/api/auth/*` family, and that is deliberate.** Session 15
> deleted `/api/auth/session`, `/api/auth/verify` and `/api/auth/change`
> together with their hardcoded constants and the orphaned
> `src/components/PasswordScreen.jsx`. A tombstone comment records this at
> `main.cjs:612-637`. Deleting them *together* was load-bearing: removing only
> the routes would have left the screen's `fetch` 404-ing and falling through
> to a hardcoded string comparison — a fail-**open** gate, strictly worse than
> the dead code. A boot-time `cleanupLegacyAuthFile()` (`main.cjs:2176-2181`,
> called at `:2475`) unlinks `{userData}/otter-data/wilson-auth.json`, because
> deleting code does not delete data.

**Honesty note on the local server's security model.** The Express server is
unauthenticated and mounts bare `cors()`. It is loopback-bound, so the exposure
is to *other local processes and to web pages loaded in the user's own browser
that can guess the ephemeral port* — not to the network. This is a known,
tracked posture (TPN-NET-001; `/api/fetch-url` and `/api/fetch-raw` also accept
arbitrary URLs with no allow-list — TPN-NET-002). Two route families do defend
themselves, and the pattern is worth copying:

- `resolveContainedFilePath(baseDir, relPath)` (`electron/pathContainment.cjs`
  since S33, required by `main.cjs`; unit-tested in
  `src/tools/rabbit_v0.1.0/pathContainment.test.js`) resolves and
  case-folds, then refuses anything that is not `baseDir` itself or beneath it.
  Every `files`-family disk path goes through it. S33 also fixed the root-base
  refusal: a drive root or two-component UNC share as the base used to refuse
  everything (doubled separator), which is why a share-shaped storage root
  broke every file operation.
- `isUserAuthorizedRelinkDir(...)` (`main.cjs`, comparison via
  `isPathInside` from the same module) accepts a folder only if
  the user picked it through the OS dialog (`rabbit:pick-directory` records
  every pick into a `userAuthorizedDirs` set, `main.cjs:61, 2262-2273`) or it
  lies inside the project's own roots. A dialog pick *is* the authorization.
  Relink scan and apply both 403 otherwise (`main.cjs:1444-1446, 1507-1509`).
- The `files` PATCH route strips `storage_path`, `storage_provider` and `id`
  from the request body before merging (`main.cjs:1359-1363`) — a
  client-supplied `storage_path` would otherwise turn download/delete into
  arbitrary-path filesystem calls.

The parallel **managed-files** routes did *not* have these guards until
Session 17, which is now the clearest worked example of why they matter.
Four filesystem sinks were reachable through client-writable path fields:
the hard-delete `unlinkSync`, the thumbnail *cache* path (`mf.id` is chosen
by the client at create time, `req.body.id || uuidv4()`), and the thumbnail
*source*, whose asset-folder segment comes from `asset.folder_slug` — which
the asset POST/PATCH write straight from the request body. All four now
resolve through `resolveContainedFilePath`, and the PATCH strips
`folder_path` / `stored_name` / `storage_provider` / `id` the way the `files`
PATCH already did.

Two neighbours of the same shape were fixed with them: the asset rename and
delete routes joined a client-writable `folder_slug` into `renameSync`, which
made them an arbitrary-**directory-move** rather than a single-file unlink;
and `POST …/managed-files/import-folder` read a body-supplied `folderPath`
with only an existence check, where the sibling relink routes require the
folder to have come from an OS dialog pick.

#### On-disk data layout

All under Electron's default `userData` directory (no `app.setPath` override
exists anywhere); product name `WILSON`.

| Path | Contents |
|---|---|
| `{userData}/otter-data/` | O.T.T.E.R. root (`getDataDir()`, `main.cjs:36-40`) |
| `{userData}/otter-data/software/{slug}/` | `_meta.json`, `subjects/{slug}.json`, `_hotkeys.json`, `_functions.json`, `_nodes.json`, `_progress.json`, `_references.json`, `_corrections.json`. **Legacy per-course `_quiz-history.json` files remain on existing installs and are no longer read or created (S30) — all six were empty, because nothing ever wrote one.** |
| `{userData}/otter-data/pet.json`, `otter-settings.json`, `agent-skills.json`, **`_quiz-history.json`** | Single-object stores. Quiz history lives at the ROOT, beside `software/`, because a quiz spans courses and deleting a course must not take somebody's marks with it. |
| `{userData}/rabbit-data/` | R.A.B.B.I.T. root (`getRabbitDataDir()`, `main.cjs:51-55`) |
| `{userData}/rabbit-data/projects/{id}/project.json` | **One denormalised JSON bundle per project** — `project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns, teamAssignments, projectTeam, managedFiles, budgetVersions, expenses, budgetLines, budgetActuals, scenes, shots, levels, experiences, fileEvents` |
| `{userData}/rabbit-data/projects/{id}/files/` | Fallback blob storage when no user-visible project folder is configured |
| `{userData}/rabbit-data/{rate-cards,team-members,task-templates}/{id}.json` | Workspace-scoped flat stores |
| `{userData}/rabbit-data/thumbnails/` | Thumbnail cache |
| `{userData}/rabbit-data/{gdrive-config,gdrive-tokens}.json` | Google Drive OAuth material |
| `{userData}/rabbit-data/archives/` | Snapshot written before "archive + clear local" after a cloud migration |
| `{userData}/session.enc` | safeStorage-encrypted Supabase session |
| `{userData}/env.json` | Packaged-build environment overrides |

A project may additionally have a **user-visible folder** on disk, created and
maintained by `ensureProjectFolders` / `mirrorProjectDatabases`
(`main.cjs:819-891`): `ASSETS/`, `{slug}_DATABASES/` (mirrors of project /
team / tasks / timeline / budget JSON), `{slug}_FILES/`,
`{slug}_RECEIPTS&INVOICES/`, `{slug}_CREWINVOICES/`, `{slug}_TALENTINVOICES/`,
and `.trash/`.

#### The IPC surface

`preload.cjs` exposes exactly two globals: `wilsonSession` and `electronAPI`.

| Bridge | Channels | Purpose |
|---|---|---|
| `wilsonSession.{save,load,clear}` | `wilson:session-{save,load,clear}` | safeStorage-encrypted Supabase session. Fails **closed** when the OS keychain is unavailable — `save` returns `{ok:false, reason:'no_keychain'}`, `load` returns `null`. None of the three ever falls back to plaintext (`main.cjs:2419-2451`). |
| Window | `window-{minimize,maximize,close,force-close}`, `close-requested` | Custom title bar |
| Zoom | `zoom-{in,out,reset,get}`, `zoom-reset-notify` | Zoom control |
| Updates | `wilson:update-{state,check,download,install}`, `wilson:update-status` | §11 |
| Drive | `rabbit:{read,write}-gdrive-{config,tokens}`, `rabbit:clear-gdrive` | Google Drive credentials |
| Files | `rabbit:pick-directory`, `rabbit:pick-files`, `rabbit:pick-image`, `rabbit:copy-file` (+ `rabbit:copy-progress`), `rabbit:get-file-stats`, `rabbit:open-in-explorer`, `rabbit:ensure-project-folder`, `rabbit:{read,write}-files-config` | RABBIT file plane |
| Thumbnails | `rabbit:{generate,clear}-{asset,entity}-thumbnail` | Sharp-based cache |
| Data | `rabbit:archive-local-data` | Post-migration archive + clear |
| Diagnostics | `wilson:sentry-test` | Manual main-process Sentry throw |

`rabbit:pick-directory` is security-relevant: it is the **only** way a folder
enters `userAuthorizedDirs`, which is what the relink routes check.

### 3.2 The web build

The same React app, built with `--base=/wilson/` instead of Electron's `./`.

| Fact | Value |
|---|---|
| Beta host | `https://beta.petalstudios.co/wilson` |
| Vercel project | `petal-studios/wilson`, repo `pretty-aud/wilson`, Root Directory `WILSON` |
| Production branch | `feat/multi-user-v1` — auto-deploys on every push |
| Backing Supabase env | **staging** (`wilson-staging`) |
| DNS | `beta` CNAME → `cname.vercel-dns.com`, managed at Squarespace |
| Build command | `npm run build:vercel && npm run build:vercel:admin` — both surfaces, one deployment |
| Install command | `npm install --ignore-scripts` (see note) |
| GH Pages | `gh-pages` branch → `pretty-aud.github.io/wilson/` — a **dormant, manually-redeployed fallback**; Vercel is primary |

Reference: `docs/WEB_DEPLOY.md`, `vercel.json`.

`installCommand` is `npm install`, not `npm ci`, because Vercel's npm 11
rejects the npm-10 lockfile this repo must keep for CI (§7.3); and
`--ignore-scripts` because the web build needs no postinstall — Electron alone
would download ~100 MB.

`vercel.json` **redirects** `/` → `/wilson` (temporary, `permanent: false` — it
changes the URL bar). Separately it **rewrites** (invisibly)
`/wilson/:path*` → `/wilson/index.html`, and `/wilsonadmin` and
`/wilsonadmin/:path*` → `/wilsonadmin/admin.html`. Security headers (`X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`) are scoped to `/wilsonadmin/:path*` only.

**What degrades on the web, and why.** There is no local Express server, so
anything that needs it is unavailable. The detection primitive is
`hasLocalServer()` — `!!window.electronAPI` (`src/lib/localData.js:28-30`).

| Capability | Web behaviour |
|---|---|
| R.A.B.B.I.T. storage mode | Boot **forces** `supabase`, overriding any carried-over saved preference (`RabbitProvider.jsx:303-311`) |
| O.T.T.E.R. content | Cloud adapter when signed in; a synthetic `401`/`501` with a stated reason when not — never a silent 404 (`otter_v0.3.1/adapters/index.js:99-117`) |
| Pet / O.T.T.E.R. settings / agent skills | `localStorage` keys `wilson.pet`, `wilson.otter-settings`, `wilson.agent-skills` (`src/lib/localData.js`) — but since **S31 (0046) these are a CACHE, not the authority**, for the pet and for the two things that follow the person (the seven edited prompts and the agent prompt overrides). `public.user_pets` / `public.user_settings` are keyed by user with no workspace, and `src/lib/userState.js` fills the cache from the account on sign-in. Machine-specific keys in the same documents (`rabbit.adapterMode`, `rabbit.activeProjectId`, `storageLocation`) deliberately stay per-device — a saved disk path names a *different* folder on another computer |
| PDF extraction, Google-Sheet import, URL scraping | Unavailable; each caller gates on `hasLocalServer()` independently |
| Storage providers | Only Supabase Storage works; the Settings card marks the others unavailable (`SettingsPage.jsx:578-581`) |
| D.O.G. | Runs off the open project's cloud context; attachments are refused at the adapter (§13.1) |
| Sessions | `localStorage`, re-saved on `TOKEN_REFRESHED` — a static host has no server to set an httpOnly cookie |

**URL ↔ page sync without a router.** The shell renders every page at once and
toggles CSS `display` (§13.4). On the web only, `navigateTo()` calls
`history.pushState` with `/wilson/<page>`, and a `popstate` listener maps the
path back to a page id — deep links, back and forward all work with no router
(`src/App.jsx:118-138, 899-991`). Electron always boots `home`; there is
nothing to deep-link to.

---

## 4. Supabase

### 4.1 The three environments

| Environment | Project ref | Used by |
|---|---|---|
| `wilson-dev` | `eqjzmnvkrakroyqxfsvw` | Local development, CI smoke + Playwright lanes; Supabase CLI is linked here |
| `wilson-staging` | `rzkirvkotslbovzbsdfh` | The Vercel beta web deployment |
| `wilson-prod` | `rqyriuyldhovirbuievt` | Production |

Migrations `0000`–`0033` and every Edge Function are deployed to **all three**.
(Was written as `0000`–`0029` until S22; 0030–0032 landed in S20/S21 and 0033
in S22, each verified **by query** on all three, not by the CLI's success line.)

**Anon keys are public by design and ship inside the web bundle.** This is not
a leak: sign-ups are off, every table carries RLS — all but four with `FORCE`
as well (the exceptions are `auth_attempt_log`, `edit_history`, `file_events`
and `storage_gc_queue`, whose only writer is a service-role function or a
DEFINER trigger; see §4.4) — and the policy set is pinned by 37 pgTAP suites in
CI. The anon key identifies the project; it authorises nothing. The *service-role* key is the secret, and it
exists only inside Edge Function environments.

### 4.2 Authentication

Login is **username-first**: a user types a workspace username, not an email.

| # | Step | Where |
|---|---|---|
| 1 | Client validates the username shape `^[a-z0-9][a-z0-9._-]{1,31}$` before any network call | `LoginScreen.jsx:149` |
| 2 | `POST /functions/v1/resolve-login` with `{username}` (+ optional `workspace_slug`) | `LoginScreen.jsx:36` |
| 3 | Server looks up `workspace_members` joined to `workspaces` on username + `is_active` + not-deleted, `.limit(2)`, and resolves the email via the service-role admin API | `resolve-login/index.ts:135-169` |
| 4 | On a miss, the client still calls `signInWithPassword` against a fabricated `__miss+<uuid>@invalid.local` address, so timing and code path are identical to a real attempt | `LoginScreen.jsx:160` |
| 5 | `supabase.auth.signInWithPassword` — GoTrue itself. The access-token hook fires here and bakes the claims into an **ES256** JWT | `LoginScreen.jsx:162` |
| 6 | If the account has a verified TOTP factor and the session is not already `aal2`, the UI enters the MFA stage: `mfa.challenge` → `mfa.verify` | `LoginScreen.jsx:170-231` |
| 7 | The client lists the user's workspaces (RLS-scoped). More than one → a chooser | `LoginScreen.jsx:68` |
| 8 | `POST /functions/v1/issue-session` with the chosen `workspace_id`, then `refreshSession()` | `LoginScreen.jsx:52, 125` |
| 9 | Session persisted through `src/cloud/auth/sessionStorage.js` (§5.2) | — |

`resolve-login` is deliberately uniform: a constant-time floor of 180 ms wraps
**every** reply path, and the response body is always `{exists, email}` with
the same status, so neither timing nor shape distinguishes a hit from a miss.
Most branches write an `auth_attempt_log` row (`resolved` / `not_found` /
`rate_limited` / `error`), readable only by platform operators — but two
failure paths return a miss with no row at all: a `workspace_members` query
error and an `admin.getUserById` failure (`resolve-login/index.ts:147-149,
170-172`).

**`issue-session` does not mint a token.** Its entire job is to write
`app_metadata.workspace_id` via the admin API so that the client's *next*
`refreshSession()` causes GoTrue to mint a new token in which the hook
re-derives every claim (`issue-session/index.ts:106-121`).

**Why every Edge Function sets `verify_jwt = false`.** The Edge gateway's
built-in verification only supports HS256, and this project's JWTs are ES256 —
the gateway rejects them with `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` before
any function code runs. Every function therefore validates the caller itself
with `admin.auth.getUser(token)`, which routes through GoTrue and handles ES256
correctly. This is stated in `issue-session/index.ts:44-48`, in each guard, and
in `supabase/config.toml:85-91`. **Do not "fix" a function by turning
`verify_jwt` back on** — it will break, not harden.

### 4.3 The frozen JWT claim shape

```
auth.jwt() -> app_metadata -> { workspace_id, workspace_ids, app_role, is_platform_operator }
```

Populated by `public.custom_access_token_hook(jsonb)` — created in
`0001_workspaces_and_users.sql:128-190`, patched (same shape, internal rename
only, fixing a live 500 on sign-in) in `0003_fix_access_token_hook.sql:13-75`.
Execute is granted to `supabase_auth_admin` alone.

| Claim | Derivation | Absent → |
|---|---|---|
| `workspace_id` | Kept if still a valid active membership, else the oldest membership | `NULL` |
| `workspace_ids` | All active memberships, ordered by `created_at` | `[]` |
| `app_role` | The role for the **active** workspace only | `'user'` |
| `is_platform_operator` | `EXISTS` against `platform_operators` | `false` |

**FROZEN — and here is why.** Every RLS policy on a tenant-scoped domain table
starts from `(auth.jwt()->'app_metadata'->>'workspace_id')::uuid`, via
`current_workspace_id()`. Changing the shape means rewriting RLS on every
domain table *and* re-issuing every live token. Treat the four key names as
immutable.

(The identity and bootstrap tables — `workspaces`, `workspace_members`,
`platform_operators`, `auth_attempt_log` — key off `auth.uid()` or a live
`platform_operators` row instead, because they are evaluated when no workspace
claim is meaningful yet.)

**The staleness rule, which every server-side change must respect.** `jwt_expiry`
is 3600 s, so claims can lag reality by up to an hour. The convention is:

- **Reads** may use the claim. `current_workspace_id()` and
  `current_app_role()` read the JWT and touch no table — `current_app_role()`
  deliberately so, to avoid RLS self-recursion on `workspace_members`
  (`0008_fix_rls_recursion.sql:20-42`).
- **Anything that acts** re-checks a live row. `has_active_membership()`
  (SECURITY DEFINER, `0008:48-61`) gates writes; `adminGuard`, `memberGuard`,
  `operatorGuard` and `invite-member` each re-query `workspace_members`;
  `is_platform_operator()` reads the **table**, never the claim, so revocation
  bites on the next statement rather than the next token refresh
  (`0028_operator_console.sql:100-114`).

One registration gotcha: `supabase/config.toml` declares the hook, but its own
comment notes this is documentation only — the hook must **also** be toggled on
in each project's Supabase Dashboard.

### 4.4 Postgres + RLS — the security boundary

#### The tenancy rule

Canonical read predicate (`projects_select`, current form,
`0020_admin_grants_and_alignment.sql:241-243`):

```sql
deleted_at IS NULL
AND workspace_id = public.current_workspace_id()
AND public.has_active_membership(workspace_id)
```

Canonical write predicate (`projects_insert`, current form —
`0013_project_members.sql:209-211` replaces 0004's two-clause version):

```sql
workspace_id = public.current_workspace_id()
AND public.has_active_membership(workspace_id)
AND public.current_app_role() IN ('admin', 'manager')
```

The third clause is specific to `projects` (matrix parity: creating a project
is an admin/manager action). Child tables keep the two-clause form.

Child tables that carry no `workspace_id` of their own inherit it through a
live-parent `EXISTS` join — the "0014 pattern". Hiding a parent transitively
hides its children with **zero propagation writes**, which is why trashing a
project is one `UPDATE` and not a cascade.

**Deliberate deviations, each with a reason:**

| Table | Deviation | Why |
|---|---|---|
| `platform_audit` | Has a `workspace_id` column but **no FK**, and snapshots slug + name as text | A `workspace.teardown` certificate must still name the company after the row is gone. A migration post-condition fails the deploy if an FK ever appears. |
| `workspace_ai_keys`, `edge_rate_limits`, `storage_gc_queue` | **Zero policies at all** | Tenancy is enforced by the absence of any client grant. Service-role only. |
| `notes`, `note_subjects`, `otter_progress`, `otter_quiz_attempts` | Tenancy **plus** `owner_id = auth.uid()` (`user_id = auth.uid()` on the two O.T.T.E.R. tables, which have no `owner_id` column), with **no admin bypass** | Private personal content. A workspace admin cannot read another member's notes, study progress or quiz marks. |
| `otter_quiz_attempts` (again) | **No UPDATE policy at all**, and a 30-day window inside the SELECT policy | An attempt records something that happened, so immutability is enforced by the ABSENCE of a policy (RLS default-denies an unpoliced verb) rather than by a CHECK anyone could forget. 🚨 The window is why `otter_prune_quiz_attempts()` must be SECURITY DEFINER — see §15. |
| `otter_courses` (personal tier) | No `current_app_role()` in the SELECT policy at all | Enforced by a post-condition that fails the migration if any SELECT policy on `otter_courses`/`otter_progress` ever mentions it. |
| `auth_attempt_log` | Operator-read, no membership requirement | Written pre-authentication; no workspace session exists yet. |
| `workspaces` | Keys on `id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND is_active)`, **not** on the JWT claim | It *is* the tenant row, and the Workspace Switcher needs to list every workspace you actively belong to — not only the current one. |

#### App roles vs Postgres roles

`app_role` is **not** a Postgres enum — it is `TEXT` with
`CHECK (app_role IN ('admin','manager','user'))` (`0001:72-73`). Same for
`project_members.project_role` (`'manager' | 'reviewer' | 'member'`). **Both
use the string `'manager'` for different concepts on different axes** — a
workspace-wide tier versus a seat on one project. Migration 0026's header makes
the related distinction between the app tier and the project-level `reviewer`
seat.

| Postgres role | Meaning |
|---|---|
| `authenticated` | Every signed-in client. Subject to RLS. Granted broad table privileges by 0011 as a convenience — **RLS is the real boundary**, with targeted `REVOKE`s layered on sensitive tables. |
| `anon` | Anonymous. Revoked everywhere sensitive. |
| `service_role` | Edge Functions. **Bypasses RLS.** Sole executor of provisioning, purges, `operator_workspace_summary()`, `fn_rate_limit_hit()`, teardown. |
| `supabase_auth_admin` | The *intended* sole grantee of the access-token hook. 0001/0003 grant it and revoke from `anon`/`authenticated`/`public` — but 0011's blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` re-widens it, and 0011 re-locks only `provision_workspace_and_admin` and `workspace_directory()`. **0030 re-locked the hook itself and 0033 (S22) swept the remainder** — seven SECURITY DEFINER functions were still anon-executable, and the revoke had to name `PUBLIC` as well as `anon` because each carried a bare `=X/postgres` aclitem. `35_platform_audit.sql` now asserts that **no** SECURITY DEFINER function in `public` is anon-executable, so this cannot silently re-open. See §17. |
| `postgres` | Owns SECURITY DEFINER objects; runs migrations and pgTAP. |

`ENABLE` **and** `FORCE ROW LEVEL SECURITY` are set on: `workspaces`,
`workspace_members`, `platform_operators`, all 13 RABBIT tables,
`project_members`, `notes`, `note_subjects`, `app_events`, all five O.T.T.E.R.
tables, `workspace_ai_keys`, `platform_audit`, `edge_rate_limits`. Migration
post-conditions assert this.

Four tables are `ENABLE`-only, each deliberately: `auth_attempt_log`,
`edit_history`, `file_events` and `storage_gc_queue` — the first is written
pre-auth by a service-role function, and the other three have a SECURITY
DEFINER trigger as their sole writer and zero client write policies.

#### Table inventory

**Identity and tenancy**

| Table | Migration | Purpose |
|---|---|---|
| `workspaces` | 0000 / 0001 | The company record: name, slug (immutable), storage mode, soft-delete |
| `workspace_members` | 0001 | Membership: per-workspace username, `app_role`, `is_active`, profile fields, rate-card grants, `onboarded_at` |
| `platform_operators` | 0001 | Cross-tenant operator registry. No `workspace_id`. |
| `auth_attempt_log` | 0001 | `resolve-login` attempt trail; operator-read |

**R.A.B.B.I.T. core** (the 14 RLS-locked tables, all forced)

`projects`, `phases`, `assets`, `tasks`, `task_dependencies`,
`phase_dependencies` (0061 — the phase→phase edge sibling; `task_dependencies`
keeps its FKs to `tasks(id)` because `supabaseAdapter.loadProject` resolves a
PostgREST embed by that constraint's NAME), `task_links`,
`files`, `asset_versions`, `comments`, `rate_cards`, `rate_card_entries`,
`ingestion_runs`, `ingestion_chunks` — created in 0000, locked down in 0004,
tightened by 0013 (project roles), 0014 (soft delete), 0015 (rate identity),
0020 (active-membership + grants).

Plus `project_members` (0013), `notes` and `note_subjects` (0017, owner-only,
no admin bypass).

**Edit history** — `edit_history` (0012): append-only diff rows for the 13
RABBIT tables, one SELECT policy and no write policy at all; the DEFINER
capture trigger is the only writer.

**O.T.T.E.R.** (0022, extended 0024/0025/0026/**0045**) — `otter_courses`
(carries the five reference-document JSONB blobs), `otter_subjects`,
`otter_progress`, `otter_course_editors`, `otter_change_requests`, and
**`otter_quiz_attempts`** (0045; one personal quiz history, 30-day retention,
replacing the per-course `otter_progress.quiz_attempts` column that 0045
drops).

> ⚠️ **MEASURED 2026-08-05: every one of these tables is EMPTY on all three
> environments** — `otter_courses` holds 0 rows on dev, staging and prod,
> including trashed. O.T.T.E.R. has never created a course in cloud; the real
> content is six courses on Local Server. `scripts/probes/otter-cloud-e2e.sql`
> is the answer to "does the cloud path work at all": create course → library
> RPC → save subject → read back → apply a validator fix → verify the
> correction → record a quiz attempt → read it back → prune. **9/9 on dev and
> staging.**

**Files and storage** — `file_events` (0027, append-only lifecycle stream),
`storage_gc_queue` (0027, service-role work list).

**Audit streams** — `app_events` (0021, admin-read; the `'admin'` type and
`WIL-41xx` codes are server-reserved so clients cannot forge audit lines) and
`platform_audit` (0028, operator-read, append-only, no workspace FK).

**Operator and platform** — `workspace_ai_keys` (0028, AES-256-GCM ciphertext,
zero policies) and `edge_rate_limits` (0028, durable limiter counters, zero
policies).

#### The helper-function family

Every one of these is the *only* sanctioned way to do what it does. Client code
must not reimplement their logic.

| Function | SD/INV | Gates |
|---|---|---|
| `custom_access_token_hook(jsonb)` | DEFINER | Mints the four JWT claims |
| `current_workspace_id()` | INVOKER | Active workspace from the claim |
| `current_app_role()` | INVOKER | App role from the claim (deliberately claim-based, to avoid RLS recursion) |
| `has_active_membership(uuid)` | DEFINER | The live membership gate used by nearly every policy |
| `project_role_for` / `project_is_staffed` / `can_write_project` / `can_comment_project` / `can_manage_project_roster` | DEFINER | Project-level authority (0013); mirrored client-side by `projectRoleMatrix.js` |
| `has_rate_card_grant(text)` | DEFINER | Live per-user rate-card view/edit grant (0020) |
| `soft_delete_row` / `restore_soft_deleted` / `fn_trash_authz` | DEFINER | The only client path into and out of the trash |
| `can_read_project_topic(uuid)` | **INVOKER, on purpose** | Realtime channel join-authz, identically equivalent to `projects_select` |
| `can_read_workspace_topic(uuid)` | INVOKER | Workspace channel join-authz |
| `otter_can_write_course` / `otter_is_course_owner` / `otter_has_editor_grant` / `otter_course_visibility` | DEFINER | O.T.T.E.R. authority |
| `otter_course_index()` / `otter_trash_index()` | DEFINER | Metadata-only listings. `otter_trash_index()` carries a migration post-condition forbidding a content column (0024); `otter_course_index()` has no equivalent assertion — its contract rests on the declared return type plus pgTAP |
| `otter_fork_course(uuid,text)` | DEFINER | Personal copy of a readable course |
| `otter_has_open_review_access(uuid)` | DEFINER | The consented review window |
| `otter_cr_apply(uuid)` | DEFINER | **The only path to an approved change request** |
| `is_platform_operator()` | DEFINER | Live-row operator check (never the claim) |
| `operator_workspace_summary()` | DEFINER | The single cross-tenant read; service-role only |
| `fn_rate_limit_hit(...)` | DEFINER | The durable fixed-window limiter |
| `provision_workspace_and_admin(...)` | DEFINER | Atomic workspace + first admin |
| `workspace_directory()` | DEFINER | Member directory; email visible to admin/manager/self only |
| `purge_edit_history` / `purge_soft_deleted` / `purge_app_events` / `purge_otter_trash` / `purge_edge_rate_limits` | DEFINER | The five retention sweeps (§4.8) |

#### Triggers

Grouped by job, because the *category* is what a reader needs:

- **Audit stamping** — `fn_audit_touch()` on ~20 tables (created/updated by/at).
- **Populate-workspace** — `fn_populate_workspace_from_project` (assets, tasks,
  files), `fn_populate_workspace_for_comment` (polymorphic parent),
  `fn_populate_workspace_for_project_member`, and — added late, in 0029 —
  `fn_projects_populate_workspace` for the one table that never had one.
- **Identity pins** — `fn_ws_members_prevent_self_role_change` (no self
  promotion, username change or workspace move), `fn_otter_pin_course_identity`
  (also gates visibility transitions; `company_standard` is admin-only in both
  directions and a disallowed change is **silently reverted**, so the UI must
  trust the returned row, never what it sent), `fn_otter_pin_subject_identity`,
  `fn_otter_pin_progress_identity`, `fn_otter_editor_grant_workspace`
  (a validator, not a defaulter — see §17).
- **Guards** — `fn_ws_members_last_admin_guard` (a workspace can never reach
  zero active admins), `fn_workspaces_client_guard` (slug/id/created_at pinned),
  `fn_workspaces_delete_guard` (0029: refuses any DELETE issued as
  `authenticated` or `anon`), `fn_soft_delete_stamp` (projects are admin-only
  to trash).
- **Capture** — `fn_edit_history_capture` (13 tables),
  `fn_file_events_capture` (files lifecycle), `fn_app_events_stamp`
  (server-side actor stamp), `fn_files_gc_enqueue` (blob disposal queue), and
  `fn_ws_members_audit_capture` (0030 — privilege changes on
  `workspace_members` into the reserved `app_events` `'admin'` stream; fires
  only on a real change to `app_role`, `is_active` or a rate-card grant).
- **Realtime broadcast** — `fn_realtime_broadcast` (11 tables → project topic),
  `fn_workspace_realtime_broadcast` (5 tables → workspace topic).
- **Auto-staffing** — `fn_projects_auto_staff` seats the creator and producer as
  project managers on **client** creates only (`auth.uid() IS NULL` skips), so
  fixtures and migrations keep 0013's unstaffed-open contract.
- **State machine** — `fn_otter_cr_review` (§13.2).

Capture triggers share one contract: a catch-all `EXCEPTION WHEN OTHERS →
RAISE WARNING`. **An audit failure must never abort the write it audits** —
including a workspace CASCADE.

### 4.5 Realtime

WILSON uses **broadcast-from-database**, never `postgres_changes`.

> Realtime's `postgres_changes` authorizes each event by evaluating the
> *subscriber's* SELECT policy against the NEW row of every UPDATE. Under the
> soft-delete policies, setting `deleted_at` makes the NEW row invisible — so
> the single event collaborators most need ("this was just trashed") would be
> silently withheld. (`0016_realtime_broadcast.sql:6-8`)

| | Project channel | Workspace channel |
|---|---|---|
| Migration | 0016 | 0018 |
| Topic | `rabbit:project:{project_id}` | `rabbit:workspace:{workspace_id}` |
| Join authz | `can_read_project_topic()` — INVOKER, ≡ `projects_select` | `can_read_workspace_topic()` — workspace match + active membership |
| Feeds | projects, phases, assets, tasks, files, comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members | projects, workspace_members, tasks (only when assignee/reviewer set), assets (only trash/restore or name/phase change), project_members |

Both triggers skip cleanly when `realtime.broadcast_changes` is absent (CI's
database-only stack) and never abort a write. `fn_try_uuid()` guards the
topic-suffix cast so a hand-crafted topic string cannot error a policy.

Deliberately **never broadcast**: `otter_*` (personal content — the workspace
channel hands full row payloads to every subscriber) and `notes` /
`note_subjects` (private).

*Operational gotcha:* on a hosted project whose Realtime tenant has never been
active, `realtime.messages` has no partitions and `realtime.send()` silently
drops rows with only a warning until the first websocket connection activates
the tenant.

**Client merge model — LWW per field.** `state/realtimeMerge.js` is pure (no
React, no adapter). Incoming rows are merged field by field: fields with an
in-flight local write (the *pending-field set*, counted per `table:id`) keep
the local value; everything else takes the incoming row. An `updated_at` stale
guard drops an incoming row older than the local one. On `SUBSCRIBED` the
client always fires a debounced refetch — including the first join — to close
the missed-events window.

**Yjs is used in exactly one place**: note bodies (§13.4). Nowhere else.

### 4.6 Edge Functions

Twelve functions, three shared guards, one shared crypto module and one shared
limiter. All run with `verify_jwt = false` (§4.2).

| Function | Caller | Guard | Job |
|---|---|---|---|
| `resolve-login` | `LoginScreen` (with `workspace_slug` since S43), `ForgotPasswordWizard` (without) | none (public, pre-auth) | Username (+ slug) → email, constant-time, uniform shape |
| `issue-session` | `LoginScreen`, `WorkspaceSwitcher` | inline `getUser` | Seat `app_metadata.workspace_id` for the next refresh |
| `invite-member` | `InviteMemberDialog`, `MultiInviteDialog` | `requireWorkspaceAdmin` (since S17) | Invite by email, create the membership row with `onboarded_at` null |
| `admin-create-user` | Admin Terminal → `adminApi.js` | `requireWorkspaceAdmin` | Create a member with a show-once password; optional synthesized email |
| `admin-reset-password` | Admin Terminal | `requireWorkspaceAdmin` | Rotate a member's password, show-once |
| `admin-set-active` | Admin Terminal, Team Members | `requireWorkspaceAdmin` | Deactivate/reactivate + GoTrue ban + best-effort global sign-out; last-admin guarded |
| `admin-user-security` | Admin Terminal | `requireWorkspaceAdmin` | Read-only posture: email, last sign-in, ban state, MFA factors |
| `ai-proxy` | Every AI feature, both hosts | `requireActiveMember` | §6 |
| `storage-gc` | Admin Terminal → Diagnostics | `requireWorkspaceAdmin` | §12.4 |
| `operator-workspaces` | Operator console | `requirePlatformOperator` | §5.4 |
| `operator-ai-keys` | Operator console | `requirePlatformOperator` | §5.5 |

**`_shared/adminGuard.ts` — `requireWorkspaceAdmin(req)`**, in order:

1. Bearer token present → else `401 unauthorized`.
2. `admin.auth.getUser(token)` → else `401`.
3. Claims from the **token payload** (falling back to the user record):
   `workspace_id` present and `app_role === 'admin'` → else `403 forbidden`.
4. **Live row**: `workspace_members` for that pair must exist, be active, and be
   admin → else `403`. ("Claims can outlive a demotion by the token TTL; the
   membership row cannot.")
5. **MFA step-up — fails CLOSED since Session 15.** A failed or errored
   `listFactors` lookup returns `503 mfa_check_failed`; the `error` channel is
   checked as well as thrown exceptions, because supabase-js reports most
   failures there. If a *verified* factor exists and the token is not `aal2` →
   `403 mfa_required`.
6. **`WILSON_REQUIRE_ADMIN_MFA`** — opt-in, **off by default**. When set to
   `'1'`, an admin with no verified factor at all is refused
   `403 mfa_enrollment_required`. It ships off because whether every existing
   production admin holds a verified factor is not verifiable from a session
   that never signs in, and a default-on gate would lock the owner out of her
   own Admin Terminal. The residue is tracked as TPN-AUTH-003.

Also in that module: `generatePassword()` (20 chars, unambiguous alphabet,
rejection-sampled against `crypto.getRandomValues`) and `logAdminEvent()`
(best-effort `app_events` insert that never blocks the caller).

**`_shared/memberGuard.ts` — `requireActiveMember(req)`**: the same token +
live-row shape with **no role check and no MFA**. Rationale, in the file: any
active member may use AI features, so the live-row check is what stops a
deactivated member spending money, and demanding `aal2` for every AI call would
break ordinary flows.

**`_shared/rateLimit.ts` — `isRateLimited(...)`**: calls
`public.fn_rate_limit_hit(bucket, subject, limit, window_seconds)`, a **fixed**
window backed by `edge_rate_limits`, shared by every isolate and surviving
redeploys. Two properties are stated rather than discovered:

- The window is **fixed**, not sliding — up to 2× the limit can pass across a
  window edge. A sliding window needs per-hit rows; that trade was taken
  deliberately.
- It **fails OPEN**, with a loud `console.error`. *A limiter is an abuse
  control, not an authorization control, and authorization has already run
  above it — a database hiccup must not take every tenant's AI features
  offline.* Compare `operatorGuard`, which fails **closed**: an auth check that
  cannot verify has no such excuse. Both choices were made in the same session,
  on purpose.

Current users: `ai-proxy` (`AI_PROXY_RPM`, default 60, keyed on workspace),
`operator-ai-keys` and `operator-workspaces` (`OPERATOR_WRITE_RPM` 20 /
`OPERATOR_READ_RPM` 120, keyed on caller). `resolve-login` still uses its
original per-isolate in-memory bucket; the remaining functions have no limiter
(§17). (`provision-workspace` was the other per-isolate one and was deleted in
S43 — see §Onboarding.)

**Show-once credentials.** WILSON stores no password anywhere. GoTrue accepts a
plaintext password only to *set* it, so the create/reset response is the one
moment the plaintext exists outside GoTrue's hash. `CredentialsPopup.jsx` holds
it in component state only, has no backdrop-click / Escape / X dismissal, and
requires a second confirmation to close without copying. Admin-created users may
have **no real email** — one is synthesized as
`wilson.<workspace-prefix>.<username>@mail.petalstudios.co` purely to satisfy
GoTrue's shape requirement. Consequence: forgot-password is unavailable for
those accounts and an admin must reset instead; the response carries an
`email_synthesized` flag so the UI can say so.

### 4.7 Storage buckets

| Bucket | Migration | Public | Cap | Path template |
|---|---|---|---|---|
| `user-avatars` | 0009 | **yes** (public read) | 2 MB, image mimes only | `{workspace_id}/{user_id}/{filename}` |
| `rabbit-files` | 0027, raised by **0057** | no (private) | **50 GiB**, any mime | `projects/{project_id}/{entity}/{entity_id}/{ts}-{filename}` |
| `rabbit-thumbnails` | 0053 | no (private) | **256 KB, `image/jpeg` only** | the same key as its source **plus `.jpg`** |

🚨 **THE BUCKET CAP IS NOT THE CEILING THAT BINDS.** Supabase caps every bucket
at a PROJECT-LEVEL global limit set in the dashboard (Project Settings →
Storage), not in the database and not in any migration — "the global limit takes
precedence". A migration can raise `file_size_limit` to 50 GiB, pass every
post-condition, and change nothing until that dashboard figure is raised too, on
each project separately. Raised by hand on dev, staging and prod on 2026-08-10.
Nothing in SQL can observe it, so the only proof is a real large file.

⚠️ **A re-run of 0027 RESETS this cap to 50 MB.** 0027 sets the bucket with
`INSERT ... ON CONFLICT DO UPDATE SET file_size_limit`, so replaying it silently
undoes 0057. A re-run of 0027 must be followed by a re-run of 0057 (same class
as 0028→0031→0055).

`rabbit-thumbnails` exists because **a bucket has exactly one
`file_size_limit`** and `rabbit-files` had to accept multi-GB media once S42
raised its cap — a thumbnail cap and a media cap cannot coexist. Its key layout
is deliberately IDENTICAL to its source's so the first three path segments
match, which is what lets it carry the same eight policies with only
`bucket_id` changed. See §12.7b.

`user-avatars` INSERT requires the path's first folder to be the caller's
workspace and the second to be their own uid; SELECT is unconditional within
the bucket, matching the public-read intent. (That unconditional SELECT is a
tracked finding — TPN-CLOUD-004 — because the public anon key can therefore
enumerate avatar objects.)

`rabbit-files` policies all require the path to start `projects/` and the second
segment to resolve to a real project via `fn_try_uuid` — which fails **closed**
on a garbage segment, where `can_write_project(NULL)` alone would fail open.
INSERT additionally requires active membership and project write access.

🚨 **There are EIGHT of them, and they live in 0042 — not three or four, and not
in 0027.** Corrected 2026-08-08 (S39), because this paragraph and design §5d.1
both described the pre-0042 set and S39's own brief inherited the error:

- **Four base** (`rabbit_files_select` / `_insert` / `_update` / `_delete_own`),
  each carrying `NOT rabbit_money_segment((storage.foldername(name))[3])`.
- **Four money** (`rabbit_files_money_select` / `_insert` / `_update` /
  `_delete`), the same predicate asserted rather than negated, plus
  `can_access_project_money`.

⚠️ **`rabbit_files_invoices_select` NO LONGER EXISTS.** 0038 created the
`rabbit_files_invoices_*` trio, 0039 rewrote them for case, and **0042 dropped
all three explicitly** and replaced them with the money four. Any document still
naming an `invoices` policy is describing a database that has not existed since
0042 — and porting that description to a new bucket ships it with no money gate
at all. **`supabaseProvider.js:19` is the line that had it right all along:**
*"the private bucket whose eight RLS policies (0042) are the money gate."*

⚠️ **And there IS an UPDATE policy — two, in fact.** This paragraph previously
said objects are immutable with no UPDATE arm; 0042 added `rabbit_files_update`
and `rabbit_files_money_update`, both with a `WITH CHECK` arm, because the
project manifest could otherwise only ever be written once (suite 53 probe 6).
`upsert: false` on ordinary uploads is an adapter choice, not a policy absence.

The single DELETE policy, `rabbit_files_delete_own`, is bounded to the
uploader's own objects **created within the last hour**. It exists for exactly
one flow: an upload whose `files` row insert was then refused, cleaning up after
itself. The unbounded version — caught in review — would have let any past
uploader destroy or silently replace live blobs, unaudited. All other blob
deletion goes through the GC function as `service_role`.

### 4.8 Scheduled jobs (pg_cron, all three environments)

| Job | UTC | Sweeps | Retention |
|---|---|---|---|
| `wilson-purge-edit-history` | 04:43 | `edit_history` | 90 days |
| `wilson-purge-soft-deleted` | 04:47 | Soft-deleted rows across 7 tables, cascading each subtree | 30 days |
| `wilson-purge-app-events` | 04:51 | `app_events` | 90 days |
| `wilson-purge-otter-trash` | 04:55 | Trashed O.T.T.E.R. subjects then courses | 30 days |
| `wilson-purge-rate-limits` | 04:59 | `edge_rate_limits` windows | 1 day |

Each is guarded so a missing `pg_cron` never fails the migration (CI's local
stack has none).

**Two streams deliberately have no purge job**, and this is a compliance
position, not an oversight:

- **`file_events`** — audit retention must be ≥ 1 year, and the `'purged'` rows
  *are* the deletion certificates (TPN-CONT-002).
- **`platform_audit`** — same reasoning, plus a `workspace.teardown`
  certificate must outlive the company it describes.

`auth_attempt_log` also has no purge job, but unlike the two above it carries no
stated retention rationale (§17).

`storage_gc_queue` is drained by an Edge Function on an admin's click, not by
cron — see §12.4 for why.

### 4.9 Migration ordering rules

Migrations apply in version order, so every normal path is safe. These rules
only matter if someone **replays a migration by hand**:

| If you re-run… | You must then re-run… | Because |
|---|---|---|
| `0022` | `0025` **and** `0026` | 0022 recreates `fn_otter_cr_review`, `otter_courses_select`, the CR policies and `otter_course_index()` at their Session-10 definitions — and every 0022 post-condition still passes in that half-reverted state. |
| `0002` | `0029` | 0002 recreates `workspaces_write_operator` at its `FOR ALL` definition, re-opening the defect where an operator's ordinary browser session could `DELETE FROM workspaces`. |
| `0011` | `0030` | 0011's blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` re-widens `custom_access_token_hook`, and its `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS` re-arms the same trap for every function a later migration creates. |
| `0011` | `0033` | **(S22)** 0011's `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon` and its `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES` re-open the entire privilege spread 0033 closed — all 25 tables and the seven SECURITY DEFINER functions, plus the default that re-arms it for every table created afterwards. A bare re-run of 0011 silently undoes the whole sweep; every 0011 post-condition still passes, because 0011 has none about `anon`. |
| `0028` | `0031` | 0028 defines `platform_audit.action` as a closed 10-value CHECK. 0031 extends it with the five `model.*` actions, so a bare re-run of 0028 makes every `operator-models` audit write fail with a check violation — and `logPlatformEvent` reports that on the error channel rather than throwing, so the write that triggered it still returns 200. |
| `0028` **or** `0031` | `0055` | **(S41)** 0055 widens the same CHECK a second time, to 19 values, with the four `storage_plan.*` actions. **The rule now goes both ways**: a bare re-run of EITHER earlier file restores a list without them, and every `operator-storage-plans` audit write then fails the same silent way — 200 to the operator, no certificate written. 🚨 **0031's own post-condition does not notice**: it greps the constraint for `%model.approved%`, which a 0031 replay satisfies perfectly. Only 0055's post-condition checks for `storage_plan.set`. |
| `0055` | `0056` | **(S41)** 0055 grants EXECUTE on `workspace_petal_bytes(uuid)` to `authenticated`; 0056 revokes it. That function takes an arbitrary workspace id and does **no** membership check by design, so a re-run of 0055 alone re-opens an RPC returning any company's storage total to any signed-in user. ⚠️ 0055 also creates `operator_storage_plan_summary()` with a column named `suspended` (the company's teardown state) sitting beside `status` (the plan's billing hold); 0056 renames it `company_deleted`. A 0055 replay restores the ambiguous name under a `DROP`-less `CREATE FUNCTION`, which fails loudly — that one is safe. |

0027 and 0028 explicitly state that they overwrite nothing and carry no
ordering rule.

**The general lesson, learned the hard way:** *permissive RLS policies OR
together.* Adding a narrow policy alongside a broad `FOR ALL` one changes
nothing — the old policy must be **dropped**. This cost Session 15 a critical
finding that two independent passes caught.

---

## 5. The operator console (`/wilsonadmin`)

### 5.1 A second build target, not a page

`/wilsonadmin` is its own Vite entry: `admin.html` → `src/admin/mainAdmin.jsx`
→ `src/admin/OperatorApp.jsx`. It does not use `src/App.jsx`. It has no router,
no tools, no pet, and exactly two sections (Companies, Audit).

Selection is by **vite `--mode admin`**. `vite.config.js` is the function form,
and `rollupOptions.input` is a ternary on the mode:

```js
input: mode === 'admin' ? 'admin.html' : 'index.html'
```

The entry is gated rather than always listed because plain `npm run build`
feeds the Electron package — an unconditional second input would ship the
platform operator console inside the desktop installer.

| Script | Output |
|---|---|
| `build` | `dist/` — Electron. Emits **only** `index.html`. |
| `build:vercel` | `dist-vercel/wilson/` |
| `build:vercel:admin` | `dist-vercel/wilsonadmin/` |
| `build:admin` | `dist-web-admin/` |
| `dev:admin` | dev server with both entries |

`package.json`'s `build.files` packages `dist/**/*` only, and Electron's local
server serves `dist/` with an SPA fallback to `index.html`. **The desktop app
therefore has no code path that can reach the operator console** — it is not
blocked at runtime; it is simply never built into that artifact.

**A Vite naming quirk shapes the routing:** Vite names emitted HTML after its
input, not `index.html`. `dist-vercel/wilsonadmin/` contains `admin.html` and
no `index.html`, which is why `vercel.json` rewrites `/wilsonadmin*` to
`/wilsonadmin/admin.html` explicitly.

### 5.2 Session isolation is a key string, and nothing else

**This is the most important fact about the console, and the most fragile.**

`localStorage` is scoped per **origin**, not per path. On
`beta.petalstudios.co`, both bundles read the same store. The only thing
separating an operator session from an ordinary app session is that the two
bundles are compiled with different constants.

- `vite.config.js:47` defines `__WILSON_SURFACE__` as `'admin'` or `'app'` at
  build time — not a runtime branch, a different constant in each build.
- `src/cloud/auth/sessionStorage.js:39-40` picks the key:
  `wilson.operator.session` on the admin surface, `wilson.dev.session`
  otherwise. (The app key kept its historical name deliberately; renaming it
  would sign out every existing session for no gain.)
- `src/cloud/auth/supabaseClient.js:44` gives supabase-js distinct `storageKey`
  values — `sb-wilson-operator` vs `sb-wilson-app`. This is *not* the isolation
  mechanism (`persistSession: false` means the SDK writes no session itself),
  but it namespaces the navigator lock, PKCE verifier slot and JWKS cache so
  the two bundles don't collide.
- `sessionStorage.js:48-51` refuses the **Electron safeStorage bridge** on the
  admin surface entirely, because that bridge is a single unkeyed slot that
  would defeat the key split. Defence in depth — the admin entry is already
  excluded from the Electron build.

> **Invariant:** any future code that reads a session key without going through
> `sessionStorage.js` reintroduces the leak. There is no second mechanism to
> catch it.

### 5.3 The operator tier

`public.platform_operators` has existed since 0001 and the JWT has carried
`is_platform_operator` since then — but until Session 15 **nothing server-side
read either**. One client file did, and no policy or function. 0028 added
`public.is_platform_operator()` (SECURITY DEFINER, live-row) and
`_shared/operatorGuard.ts`.

**Sign-in is email + password + TOTP**, not username-first. An operator has no
company, so there is nothing for `resolve-login` to resolve against — that is
the definition of the tier. Wrong email and wrong password produce an identical
generic error. **Not-an-operator is not unified with it**: it is only reached
*after* a fully successful sign-in and renders as a distinct "Not a platform
operator" screen in `OperatorApp.jsx` — which, like the MFA stage before it,
inevitably discloses that the credentials were valid.

**`operatorGuard` differs from `adminGuard` in three deliberate ways:**

1. **No `workspaceId` in its context.** Every operator action names its target
   workspace in the request body instead.
2. **The JWT claim is not required.** Only the live `platform_operators` row
   gates access. The live row is strictly stronger, and requiring the claim
   would add a lockout mode if the Dashboard's access-token hook toggle were
   ever off.
3. **MFA is hard, both ways.** No verified factor → `403
   mfa_enrollment_required`. A failed factor lookup → `503 mfa_check_failed`.
   Both refuse. This is safe to be strict about where the company Admin
   Terminal cannot be: the surface is brand new so no existing workflow
   breaks, and it can delete a tenant.

**There is no grant-or-revoke-operator endpoint anywhere, on purpose.** A
repo-wide search finds writes to `platform_operators` in exactly three places:
a manual SQL runbook in `docs/OWED_AUDREY.md` §9B and two pgTAP fixtures. No
Edge Function, no component, no API module touches it. 0028 additionally
revokes INSERT/UPDATE/DELETE/TRUNCATE from `anon` and `authenticated`, and RLS
carries only SELECT policies — asserted by a migration post-condition.

**State this as a security property, not an omission.** The console can create
and destroy companies, so the one thing it must not be able to do is mint more
operators. Keeping the grant out of band means the highest privilege in the
system cannot be escalated from a web session *even by someone already holding
it*. The cost is one `INSERT` in the SQL editor when bootstrapping an
environment.

### 5.4 `operator-workspaces`

Actions: `list`, `create`, `rename`, `suspend`, `restore`, `teardown`.

- `list` — paged calls to `operator_workspace_summary()`, the **single**
  cross-tenant read in the system. Returns per-company member/active/admin
  counts, project and file counts, blob count, `has_ai_key` and `ai_key_hint` —
  including suspended companies, which the member-facing policy hides.
- `create` — creates the auth user, calls `provision_workspace_and_admin`, rolls
  the auth user back if provisioning fails, seeds `app_metadata.workspace_id`,
  certificates `workspace.created`, returns a show-once password.
- `rename` — name only; the slug is immutable by trigger.
- `suspend` / `restore` — set and clear `workspaces.deleted_at`, with
  `already_suspended` / `not_suspended` conflict guards.

**Teardown — the ORDER is the design.** Reading it in sequence is the only way
to understand why it cannot be simplified:

1. **Snapshot the workspace row first.** The name and slug are copied as text —
   that snapshot is what keeps the certificate meaningful after the row is gone.
2. **Require the slug typed back** (`confirm_slug`), else `400
   confirmation_mismatch`.
3. **Collect every `rabbit-files` path** from **three** sources: `files`,
   `storage_gc_queue`, and the **reserved objects** (S36). The first two are
   paged with `.range()` in 1000-row chunks — paging is not optional, since
   PostgREST caps un-ranged reads at `max_rows` (1000) **even for
   `service_role`**. The third is the same blind spot as the storage-gc defect
   with the sign reversed: `PROJECT.json` and `FINANCE/RATES.json` have no row,
   so a row-derived sweep could not see them and they **survived their own
   tenant's teardown permanently** — the money-gated rates mirror still sitting
   in the bucket after the company was certifiably destroyed, and unrecoverably
   so, because after the CASCADE nothing can attribute a project folder to a
   workspace. They are built from `reservedProjectObjectPaths()` over the
   project ids the sweep already proved this workspace owns, so they inherit
   its tenancy check, and deduped against the row-derived set.
   **Also in the collect step, since Track C / C2:** (3b) the **avatars** —
   `user-avatars/{workspace_id}/…` LISTED by prefix, because no row names an
   avatar object (`avatar_url` names the current one only) and the prefix is
   the tenancy proof (0009's INSERT policy pins it); bounded at 5000 objects,
   past which the scan stops and `avatars_truncated: true` says so. A listing
   that fails refuses the teardown like any other scan. And (3c) the **open
   upload reservations** — `sweep_open_uploads(workspace_id)` (0074) closes
   every open `upload_reservations` row of the tenant, expired or not
   (`completed` where the object landed, `abandoned` with a certificate
   otherwise), BEFORE the CASCADE would take both that table and the tenant's
   `file_events` away uncertified. The failure flag starts true and only an
   answer clears it: a database without 0074 reads
   `reservation_sweep_failed: true`, never 0/0. And (3d) the abandoned uploads
   are certified AT ONCE — one `WIL-7012` per 40 paths, before any blob is
   touched — because 3c commits its rows immediately and the CASCADE destroys
   `file_events` moments later. **What 3d certifies is the company's WHOLE
   `upload_abandoned` record**, read back from `file_events`: the reservations
   3c just closed, plus any the hourly sweep or a person's own failed upload
   had already certified, all of which the CASCADE is about to destroy. That
   read is also what makes a retried teardown safe — a run that died between
   3c and 3d left rows already closed, so a second attempt's sweep finds
   nothing open, but the records are still there to be read (`truncated: true`
   on the certificate if a company somehow had more than one page of them).
   Nothing is destroyed in 3d (the partials expire at 24 h in Supabase Storage,
   which nothing on the platform can see), so it is "certified abandoned",
   never "purged". ⚠️ **A certificate that cannot be WRITTEN is logged and the
   teardown continues** — `logPlatformEvent` reports an insert failure on
   supabase-js's error channel to `console.error` and never throws, which is
   deliberate (a destruction must not be half-done because its record failed)
   and true of every `WIL-70xx` here, not only this one.
4. **Refuse foreign paths.** Only paths shaped `projects/{project_id}/…` whose
   project id belongs to *this* workspace are accepted. `files.storage_path` is
   client-writable and the sweep runs as service_role, so a member could
   otherwise point a row at another tenant's key and have teardown delete it.
   Rejected paths produce a `blob.purged` refusal certificate, code `WIL-7008`.
5. **Delete blobs in batches of 100, certificate each batch** (`WIL-7006`,
   emitted in 40-path chunks because the audit `context` column has an
   8000-character CHECK). `blobs_removed` counts what the bucket's `remove()`
   actually returned, not the batch size — a certificate must never claim a
   destruction that did not happen.
6. **Delete the reserved objects in their own pass**, *after* step 5's
   certificates rather than before them — that block ends in an `await`, and
   putting a new way to throw ahead of the certificates for blobs already
   deleted would break the "written as we go" guarantee step 5 exists for.
   Counted apart (`reserved_candidates` / `reserved_removed` /
   `reserved_failed`): the inputs are two *candidates* per project, most of
   which will not exist, so folding them into `blobs_missing` would make the
   certificate read as a far larger failed purge than it was.
   **Then, since Track C / C2:** (6b) the **avatars**, in `user-avatars`, own
   pass, own counters (`avatars_found` / `_removed` / `_failed` /
   `_truncated`), certificate per 40 paths (`WIL-7006` with `avatars: true`),
   `avatars_removed` counted from `remove()`'s returned array like every other
   count here. (The abandoned uploads were certified back in 3d.)
7. **Delete the workspace row.** This fires the CASCADE.
8. **Drop the queue rows — *after* the cascade, not before.** The `files`
   CASCADE re-enqueues one `storage_gc_queue` row per file; clearing first
   would leave those undrainable.
9. **Write the final `workspace.teardown` certificate** (`WIL-7005`, severity
   critical) with found/removed/missing/failed/rejected counts, plus the
   reserved-object counts — and, since Track C / C2, the `avatars_*` counts,
   `reservations_abandoned` / `reservations_completed` /
   `reservation_sweep_failed`, and `thumbnails_note`, a sentence stating that
   `blobs_*` and `thumbnails_*` are ROW-DERIVED (an object whose row never
   landed is neither removed nor counted), so that limit is on the certificate
   itself and not only in §17.

The reason the collection must happen *first*: after the CASCADE there is no way
to discover which blobs belonged to the tenant, and `storage-gc`'s orphan scan
fails closed because the rows it resolves through are gone.

**Named limitation.** Teardown removes the tenant, not the people. A user whose
only membership was in that company keeps an `auth.users` row and can still
authenticate; they simply resolve to no workspace. Deleting those identities
would be a destructive act on accounts the operator did not create, and a user
may hold memberships in several companies — so it is out of scope by decision.
What is missing is the *reporting* (§17).

### 5.5 `operator-ai-keys` and the key crypto

Actions: `set` and `clear` only. **There is deliberately no `get`.**

`set` validates the key with a live 1-token call to Anthropic (model
`claude-haiku-4-5-20251001`, `max_tokens: 1`). Only a 401/403 from Anthropic
counts as invalid — a network error or any other status is "inconclusive" and
the key is stored anyway. It then encrypts and upserts, and certificates
`ai_key.set` (`WIL-7010`) carrying **only the hint**. `clear` deletes the row
and certificates `WIL-7011`.

`_shared/aiKeyCrypto.ts`: **AES-256-GCM** via WebCrypto, envelope
`base64(iv[12] ‖ ciphertext ‖ tag[16])`, a fresh random IV per record (so
re-saving the same key yields different ciphertext). The data-encryption key
comes from the Edge secret **`WILSON_AI_KEY_SECRET`**, which must decode to
exactly 32 bytes — a short or malformed value throws rather than being padded.
The console only ever sees `key_hint`, the last four characters.

**Why encrypt at all, when the table is already service-role-only with zero
policies?** Because the nightly `pg_dump` goes **off-platform** to Backblaze B2
with 90-day retention (§8). A plaintext column would copy every tenant's
Anthropic spending credential into a 90-day off-platform archive. The
ciphertext goes into the dump; the key that opens it does not.

**Why not Supabase Vault?** Vault exists on all three hosted projects and would
have been the conventional answer. It was rejected because CI's pgTAP job runs
`supabase start` on a local stack that cannot be run on the development machine
(no Docker), so a Vault dependency inside the migration chain could not be
verified before it either passed or broke every job at once. App-layer AES-GCM
keeps 0028 plain SQL and puts the crypto where an adversarial review can read
it.

> **Consequence to know:** rotating `WILSON_AI_KEY_SECRET` orphans every stored
> company key. The ciphertext becomes undecryptable, `ai-proxy` fails soft to
> the platform key, and the console still shows the old hint. There is a
> `key_version` column but no version-conditional key selection — rotation
> needs a re-encryption pass. Recorded in `docs/OWED_AUDREY.md` §9C.

### 5.6 The two sections

- **Companies** (`CompaniesSection.jsx`) — one table (Company / Slug / Members /
  Projects / Files / AI key) fed entirely by `operator-workspaces` `list`. The
  detail panel drives rename, suspend, restore, teardown, set-key and clear-key.
- **Audit** (`AuditSection.jsx`) — the one place the console reads the database
  **directly** with the operator's own client rather than through an Edge
  Function: the latest 200 `platform_audit` rows, gated purely by the
  `platform_audit_operator_read` RLS policy. Writes are impossible from here —
  the table has exactly one SELECT policy and all write privileges are revoked,
  with a migration post-condition that raises if that ever stops being true.

**The design rule this embodies:** the console reaches every other tenant fact
through service-role Edge Functions rather than widening RLS across tenants.
An operator has no cross-tenant reach today beyond `workspaces` and
`auth_attempt_log`; every other table gates on `current_workspace_id()`, and
the access-token hook refuses to mint a `workspace_id` the caller is not a
member of. The alternative — operator arms on a dozen policies — would put
every company's rows one policy bug away from each other. One crossing, one
guard.

---

## 6. Anthropic — the `ai-proxy` seam

**No Anthropic API key ever reaches a client, on either host.** This is
verifiable, not asserted: `x-api-key` and `ANTHROPIC_API_KEY` appear nowhere
under `src/` or `electron/`; the only `fetch` calls to `api.anthropic.com` are
server-side in `ai-proxy` and `operator-ai-keys`; and `src/App.jsx:227-234`
actively purges the two legacy `localStorage` key slots on every launch. There
is **no direct-to-Anthropic fallback anywhere** — a second code path is
precisely how the pre-proxy divergence bugs happened.

**The contract.** Clients `POST` to `{SUPABASE_URL}/functions/v1/ai-proxy`
through the single helper `callAI()` in `src/cloud/aiProxy.js`. Accepted body
fields: `model`, `max_tokens`, `messages`, `system`, `tools`, `betas`,
`thinking`, `output_config`, and `tool` — WILSON's own attribution tag
(≤40 chars), which is logged and **never forwarded upstream**. The upstream
body is a whitelist reconstruction, not a passthrough, so clients cannot
smuggle extra fields.

> **`thinking` and `output_config` were added in S19, and the whitelist is why
> they had to be.** Anything not on this list is dropped *silently* — no error,
> no log line. Before S19 those two were absent, so every call site's
> `thinking` was discarded on the way upstream and nobody could tell. That
> mattered once the Sonnet 4 retirement forced a move to a model that thinks by
> default, because thinking spends from the same `max_tokens` budget as the
> answer *and* from wall-clock. It also silently invalidated a probe's control
> case: two requests differing only by `thinking` were identical upstream.
>
> Both are shape-checked rather than passed through: `thinking` accepts only
> `{type:"disabled"}` and `{type:"adaptive"}` (plus `display:"summarized"`) —
> the removed `enabled` + `budget_tokens` form is dropped, because it 400s on
> current models — and `output_config` accepts only a valid `effort` level.
>
> **Adding a field to a call site is not enough; it must be added here too.**

**Auth**: `requireActiveMember` — token claims plus a live `workspace_members`
re-check. A deactivated member gets `403 forbidden` even with an unexpired
token, because this is a *spend* endpoint and the row check is what stops them
spending money.

**The key seam**: look up `workspace_ai_keys` for the caller's workspace →
decrypt → on any failure fall through to the platform `ANTHROPIC_API_KEY`. *A
tenant key is a billing preference, not an authorization boundary.* If neither
exists, the function returns **`501 ai_not_configured`** — deliberately 501 and
not 503, because every client retry loop treats 429/503/529 as transient and a
503 would burn roughly 21 seconds of pointless retries before the honest
message surfaced.

**Streaming transport.** The proxy always sets `stream: true` upstream,
regardless of what the client asked for. Supabase Edge Functions must emit a
response within **150 s**; O.T.T.E.R. generations regularly run longer, so a
synchronous proxy would occasionally 504 and lose an entire generation. With
SSE the first byte is immediate, the response deadline never bites, and the
400 s wall clock governs instead. `src/cloud/anthropicStream.js` reassembles
the stream client-side into the classic non-streaming message object, so
O.T.T.E.R.'s single `callAnthropicAPI` wrapper changed internally and none of
its six call sites did.

**The in-stream error trap** — worth internalising, because it generalises:
Anthropic can return HTTP 200 and then emit an SSE `error` event mid-generation
and still close the stream *normally*. There is no non-2xx status to key off.
Both sides trap it: the proxy's usage sniffer sets a flag so telemetry logs
`WIL-6002` (failed) rather than `WIL-6001`, and the client reassembler throws
with a status mapped from the Anthropic error type. **Anything that logs
"completed" on stream close must sniff for in-stream errors.**

**Rate limiting**: the durable limiter, bucket `ai-proxy`, subject = workspace
id, window 60 s, limit `AI_PROXY_RPM` (default 60), fail-open (§4.6).

**Usage telemetry**: fire-and-forget inserts into `app_events` via
`EdgeRuntime.waitUntil`, never blocking the response. `WIL-6001` on success,
`WIL-6002` on failure, with `context` carrying `model`, `tool`, `input_tokens`,
`output_tokens`, `stop_reason` and **`key_source`** (`workspace` | `platform`).
Token counts are sniffed out of the SSE itself. Today these rows are read
through the Admin Terminal's generic Logs section, which renders `context` as
JSON — there is no purpose-built spend dashboard yet (§17).

**Model ids live in exactly one file: `src/lib/aiModels.js`.** (Before S19 they
were string literals at 28 call sites, and 17 of those named
`claude-sonnet-4-20250514` — retired by Anthropic on 2026-06-15, which took
most of WILSON's AI down for 47 days without anyone being able to see why.)

Every call site now asks the registry:

```js
const data = await callAI({ model: modelFor('dog.fullDeck'), ...tuningFor('dog.fullDeck'), … })
```

| Piece | What it is |
|---|---|
| `REGISTRY` | All 28 call sites. Each has a stable `key`, a user-facing `label`/`hint`, and a `tier`. **The key is a persistence contract** — settings are stored against it, so renaming one discards whatever was configured. |
| `BUILTIN` | The floor: `REASONING` → `claude-sonnet-5`, `FAST` → `claude-haiku-4-5-20251001`. |
| `resolveModel()` | Cascade: user → workspace → platform → built-in. A retired or malformed configured model **falls back and returns a warning**, which `ModelWarningBanner` shows (decision D6 — never a silent substitution). |
| `tuningFor()` | Optional per-function `thinking`/`effort`. Only `dog.fullDeck` sets one, and only because it was measured against a hard limit (below). |
| `RETIRED` | Known-dead ids with their dates, so a stale setting recovers with no network round trip. |

**`noHardcodedModels.test.js` fails the build** on a raw `claude-` literal
anywhere in `src/` outside the registry, on a `modelFor()` key that is not in
`REGISTRY`, on a bad `MODEL_KEYS` entry, or if `operator-ai-keys`'
`VALIDATION_MODEL` is ever retired. That test is the reason a retirement cannot
hide again; swapping the string only fixed the day.

**`dog.fullDeck` carries `effort: 'medium'`, and it is load-bearing.** ai-proxy
streams through an Edge Function with a **~150s deadline**, and a call that
overruns loses its stream rather than degrading. Measured S19, same prompt and
16384 budget: unset ran **137.9s / 15194 tokens**, `medium` ran **69.1s / 7642**.
The unset case was both close to the deadline and one long deck from triggering
the continuation loop and paying that four times over. See the REGISTRY entry
for the full four-variant table.

Users can override the model per function in D.O.G.'s prompts tab — the picker
sits directly above the prompt it applies to, because the prompt and the model
are one decision. Choices persist via `userModelPrefs` (localStorage, the
`user` tier) and apply to the next generation without a reload. S20 replaces
that with operator-curated catalogue + workspace/platform tiers.

Retry
policy is deliberately inconsistent by caller — O.T.T.E.R.'s shared wrapper
retries 3× on `429/503/529`/overload text with `[3000, 6000, 12000] ms` delays;
RABBIT's intake retries 3× with linear backoff; the Validator and D.O.G. do
not retry at all (D.O.G.'s only resilience is a max-tokens *continuation* loop,
which is a different mechanism).

---

## 7. GitHub

The repository `pretty-aud/wilson` is **public**. Note the layout: the **git
root is one level above `WILSON/`**, so `.github/workflows/` is a sibling of
the app directory, not inside it.

### 7.1 `rls.yml` — CI

Triggers: push to `feat/**`; pull request to `main` or `feat/**`. Deliberately
not push-to-`main`, where branch protection makes it redundant.

| Job | What it runs | What it proves |
|---|---|---|
| **pgTAP** | A per-table coverage gate, then `supabase start` (excluding realtime, storage-api, imgproxy, edge-runtime, studio, mailpit) and `supabase test db` | Every RLS-allowlisted table has a dedicated suite, and every suite passes against a **fresh** Postgres with all migrations applied from `0000` in order — not just against an already-migrated project |
| **issue-session smoke** | `scripts/probes/issue-session.sh` against real `wilson-dev` | That ES256 tokens validate in-function. The local stack issues HS256, so **only a hosted probe can catch this regression** |
| **Vitest** | `npm test` | Renderer pure-function modules; no secrets |
| **Playwright auth** | `npx playwright test` against `wilson-dev` | The auth, invite and reset flows end to end |

The coverage gate runs **before** Postgres boots and fails fast; its allowlist
currently names **39 tables** (counted from `rls.yml`, 2026-08-04 — it read
"30" for several sessions after the list had grown). On failure the pgTAP job
re-runs **38 named suites** through raw `psql` so the actual SQL error and
SQLSTATE surface as GitHub annotations instead of being hidden behind
pg_prove's TAP summary.

🚨 **Both lists are hardcoded and BOTH must be extended when a table is
added.** The allowlist failing is loud; the replay list failing is **silent** —
S17 recorded suites 33–38 failing invisibly for exactly that reason, with the
annotation cheerfully reporting "replay produced no ERROR lines" for every
file it did replay.

Repository secrets consumed (names only): `DEV_SUPABASE_URL`,
`DEV_SUPABASE_ANON_KEY`, `DEV_PROBE_USERNAME`, `DEV_PROBE_PASSWORD`. The
hosted jobs self-skip when any is missing, so fork PRs do not fail.

### 7.2 `backups.yml` — nightly database backups

Runs at **08:15 UTC** plus manual dispatch, in a `postgres:17` container so the
client major matches the hosted server. Dumps **prod** and **staging** with
`pg_dump -Fc --no-owner | gzip`, uploads to B2 via the S3-compatible API, then
re-lists the object and fails the job if it is absent. Secrets (names only):
`BACKUP_PROD_DB_URL`, `BACKUP_STAGING_DB_URL`, `B2_S3_ENDPOINT`, `B2_KEY_ID`,
`B2_APP_KEY`, `B2_BACKUP_BUCKET`.

> **The rule that makes this file work at all:** GitHub fires `schedule`
> workflows **exclusively from the default branch**, and only shows the
> `workflow_dispatch` button for workflows present there. This file therefore
> lives on `main`, not on the feature branch. When it was first committed to
> `feat/multi-user-v1` only, the nightly job had two independent reasons never
> to execute and the missing secrets were merely the visible one. **Any future
> scheduled workflow must live on the default branch or it is decoration.**
> (`rls.yml` is unaffected: `push` and `pull_request` run from the branch where
> the event happened.)

### 7.3 The npm-10 lockfile rule

CI's `npm ci` rejects a lockfile written by npm 11. If the lockfile must be
regenerated, do it with `npx npm@10 install --package-lock-only`. Vercel, which
runs npm 11, sidesteps this by using `npm install` instead (§3.2).

### 7.4 There is no release pipeline

Only `rls.yml` and `backups.yml` exist. `npm run dist` / `dist:publish` are
local, manual commands that publish the installer straight to the B2 feed —
there is no reviewed workflow building or publishing the artifact that
`electron-updater` distributes (§17).

---

## 8. Backblaze B2

One vendor, two jobs, chosen because it is S3-compatible and works with
`electron-updater`:

1. **Nightly `pg_dump` archives** — `db/{env}/wilson-{env}-{timestamp}.dump.gz`
   for prod and staging. SSE-B2 and Object Lock are on; the lifecycle window is
   **90 days**.
2. **The auto-update installer feed** at `https://updates.petalstudios.co/wilson`.

**B2 never holds customer content.** Database dumps and installers only. This
is a locked decision, and the thing that makes a database-only backup
*sufficient* is the storage model: `files` rows carry a `storage_provider` and a
**relative** `storage_path`, so a database restore plus a reconnected storage
provider resolves. Project files live in the company's own storage and are the
company's backup responsibility; WILSON keeps only the metadata that points at
them.

**Why B2 exists at all, given Supabase Pro already includes daily backups.**
Supabase's own backups have 7-day retention and live on the same platform. The
B2 copy is **off-platform** (a suspended account, billing lapse or compromise
takes the database *and* its platform backups together) and **long-retention**
(7 days catches "we broke something Tuesday"; it does not catch corruption
noticed a month later). A compressed dump is single-digit megabytes, so a year
of dailies across both environments sits inside B2's free tier.

---

## 9. Resend

Transactional email over SMTP, domain `mail.petalstudios.co`, DNS at
Squarespace. Templates are uploaded to all three Supabase projects.

| Mail | Trigger | Lands on |
|---|---|---|
| Invite | `invite-member` | `{SITE_URL}/#/recovery` → `ResetPasswordWizard`, which sets the password, signs the user out, and returns them to a real login |
| Recovery | `ForgotPasswordWizard` → `resetPasswordForEmail` | Same wizard |
| Email change | Supabase Auth | Standard |

The invite template substitutes `SiteURL`, `TokenHash`, and the metadata
`company_name`, `inviter_name` and `username`; the copy states 24-hour link
validity. A newly-invited member's `workspace_members` row is created with
`onboarded_at` null, which is what makes `NewUserWelcome` appear on first
sign-in.

**The link is a `token_hash`, not a `ConfirmationURL` (S18, §6 #73).**
`{{ .ConfirmationURL }}` is a bare `GET /auth/v1/verify?token=…`, so
*following it is the redemption* — and on staging both of the first two real
invites were confirmed 12.0 s and 16.7 s after being sent, by something that
was not the recipient. The templates now carry `{{ .TokenHash }}` to
`{SiteURL}/#/recovery?token_hash=…&type=invite|recovery`; the wizard parks on
a button and calls `verifyOtp({ token_hash, type })` only on the click, so a
GET spends nothing. Both older fragment shapes are still parsed, for links
minted before the change.

`SiteURL` rather than `RedirectTo`: `RedirectTo` is whatever the client asked
for, and the desktop app runs on `http://127.0.0.1:<dynamic port>`, which is
useless in an email. Parsing is in `src/cloud/auth/recoveryLink.js`.

`email_change.html` still uses `ConfirmationURL` — the flow is unreachable
(email is read-only in `ProfileSection`), so it renders no mail. Move it to
`TokenHash` **before** building email change (§6 #75).

> **`supabase config push` is deliberately NOT used** for the
> `site_url` / `additional_redirect_urls` settings. It pushes the whole local
> `[auth]` block, and the local `config.toml` sets `smtp.enabled = false` —
> which would disable hosted Resend email. Those values are changed in the
> Dashboard.

---

## 10. Sentry

| | Renderer | Electron main |
|---|---|---|
| Module | `src/cloud/sentry.js` | `electron/sentry.cjs` |
| Init | `initSentry()` from `src/main.jsx`, fire-and-forget | `initMainSentry()` from `main.cjs:20`, after `loadEnv` so the DSN exists |
| SDK | `@sentry/electron/renderer`, dynamically imported, degrades if absent | `@sentry/electron/main`, same |
| Env var names | `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE` | same names via `process.env` |
| Disabled when | DSN unset, or contains the literal `REPLACE-ME` | same |
| Sampling | `tracesSampleRate` 0.1 in production, 1.0 otherwise | same |
| PII | **`sendDefaultPii: false`** — TPN requires explicit opt-in for anything that could carry customer content | same |

`src/cloud/errorCodes.js` is the other entry point: `reportAppEvent` forwards
`error` and `critical` severities to Sentry as exceptions, and is the same path
the update checker uses for `WIL-5001` / `WIL-5002`.

Sentry is currently the **only** external log sink, and it is errors-only — it
is not a security log and there is no aggregation or alerting anywhere (§16).

---

## 11. electron-updater

- **Channel**: NSIS via electron-builder (`npm run dist`), one-click,
  per-user, `deleteAppDataOnUninstall: false`.
- **Feed**: a `generic` provider pointed at the B2 URL compiled into
  `package.json`, overridable at runtime by **`WILSON_UPDATE_URL`** read from
  the packaged app's `{userData}/env.json`, so an operator can repoint without
  a rebuild.
- **Behaviour**: `autoDownload = false`, `autoInstallOnAppQuit = true` — the
  renderer owns the decision.
- **The login-time flow**: `checkForUpdates()` fires on every sign-in. If an
  update is available *and* its version is not the one stored under
  `localStorage['wilson.update.skipped-version']`, `UpdatePrompt` renders after
  onboarding and MFA-enrolment gates clear. The user picks **Update now**
  (download → progress → Restart & install) or **Skip this version**. Settings
  → General also has a manual check.
- **Status channel**: `wilson:update-status` carries
  `checking | available | not-available | downloading | downloaded | error |
  unsupported | disabled`.
- **Forge/Squirrel degradation**: Forge's only maker is Squirrel, which
  produces no `app-update.yml`. The updater degrades rather than throwing —
  a missing `electron-updater` module reports `unsupported / module-missing`,
  and an error mentioning `app-update.yml` reports
  `unsupported / no-app-update-yml`. Unpackaged runs report
  `disabled / dev` and never even require the module. Forge stays for dev
  packaging; **NSIS is the only auto-updatable artifact.**

*Known posture note:* `WILSON_UPDATE_URL` comes from an operator-writable,
unsigned `env.json` and is passed to the generic provider with no scheme or
host validation (tracked in `TPN_AUDIT`).

---

## 12. Company storage providers and the file lifecycle

### 12.1 The three providers

Locked decision: v1.0 supports local / local-server, Supabase Storage, and
read-only Google Drive. S3-compatible providers (AWS, Hetzner) come post-1.0
through one adapter. The database enum is
`storage_provider ∈ ('supabase','google_drive','local_server')` — "local" and
"local server" are one provider presented as a single card in Settings.

**🚨 There are TWO provider vocabularies and they are different axes (S36,
migration 0050). Do not merge them.**

| | Column | Values | Says |
|---|---|---|---|
| Configuration | `workspace_storage.provider` | `petal`, `network` | what the workspace **chose** |
| Fact | `files.storage_provider` | `supabase`, `google_drive`, `local_server` | where **this body** actually is |

They cannot be one list, because a **financial file is `supabase` whatever the
workspace chose** (§12.1a). The mapping between them is
`fileProviderFor()` in `src/tools/rabbit_v0.1.0/storage/index.js`, and
`storageRegistry.test.js` pins the configuration list against migration 0050's
CHECK by reading the migration as text — the client vocabulary and the schema
have one definition, checked mechanically rather than by comment.

`workspace_storage.mode` is a **third, separate** axis: which storage is
ACTIVE (`central` = Petal cloud, `byos` = the customer's own). Mode is what
every consumer already gates on — `App.jsx` pushes a root only when mode is
`byos`, and `fn_project_folder_root_guard` (0049) refuses a project folder
unless mode is `byos`. That is why `provider` is bound to mode in one
direction only (`mode <> 'byos' OR provider <> 'petal'`): a workspace on Petal
cloud may still carry `provider = 'network'` and a `root_path`, which is
0048's **retyping rule** — the NAS is remembered, and inert, until byos is
re-selected.

### 12.1a Adding a storage provider

A provider is **FIVE functions, never an adapter fork**:
`put(key, body, opts)` / `get(key)` / `del(key)` / `exists(key)` / `describe()`
— the last for the configuration-time reachability probe, and required at
registration like the rest (`REQUIRED` in `storage/index.js`). ⚠️ **This
paragraph said "four functions, plus describe()" until S37, and the shorthand
propagated into the session briefs as a four-function contract.** The registry
is `src/tools/rabbit_v0.1.0/storage/`; `registerStorageProvider()` refuses an
implementation missing any of them, specifically so the `googleDriveAdapter`
shape — **57 `readOnly('…')` stubs** (re-measured 2026-08-08; the figure is
exact) across its own ~68 methods, a v0.1 relic predating workspaces, RLS, the
folder tree and the manifest — cannot arrive by the back door. It is the shape
to avoid, not to finish.

Adding one (S37 = S3-compatible ✅, S38 = Google Drive) means, in ONE session:
1. a registry entry implementing all five functions;
2. `'<provider>'` added to `workspace_storage_provider_chk` — **never ahead of
   the adapter**, because a configurable provider that resolves nowhere is
   precisely the failure the registry exists to prevent (0050 shipped
   `petal`/`network` only, and suites 60/61 assert the not-yet-built values
   are still REFUSED — inverting that probe in the same commit as the adapter
   is the deliberate tripwire, not a test failure).
   🚨 **Widen it by EXPLICIT `DROP CONSTRAINT IF EXISTS` + `ADD`, never a
   wrapped re-ADD.** Every `ADD CONSTRAINT` here is wrapped in `EXCEPTION WHEN
   duplicate_object`, so re-adding an existing name is a SILENT NO-OP: the
   migration reports success and changes nothing. Measured S36, applied S37.
   Add a post-condition that reads `pg_get_constraintdef` back and RAISEs if
   the new value is absent — "applied cleanly and changed nothing" is
   otherwise indistinguishable from success;
3. that provider's OWN required-direction config arm if it needs config
   (0050's `provider_config_chk` PERMITS a config, it does not REQUIRE one —
   `provider='s3'` with a NULL config was legal until 0051 added the arm), named
   so it sorts alphabetically AFTER every constraint whose message a suite
   asserts;
4. one entry in `NEW_BODY_GOES_TO`, and a `files.storage_provider` enum value
   if the body lands somewhere new. 🚨 **`ALTER TYPE … ADD VALUE` cannot USE
   the new value in the same transaction** — which also means the pre-apply
   pgTAP shim cannot run a suite that inserts rows with it. Apply to dev
   first, then run the suites, then run breakers as explicit `DROP`/replace.

🚨 **Nothing already supported may be narrowed.** Audrey, 2026-08-07:
*"nas, gdrive, AWS s3 buckets, etc are all going to be options … dont remove
other options."* Suite 60 re-runs S34's NAS refusals under
`provider = 'network'` for exactly this reason.

🚨 **Money-gated files NEVER leave Supabase**, whatever the workspace chose.
`INVOICES/` and `FINANCE/` are manager-only because the storage path's third
segment says so and Postgres enforces it (`public.rabbit_money_segment`,
0042). Drive has opaque ids and its own sharing model; S3 has bucket policies
— neither binds to a WILSON project role, so moving invoices to either
re-opens the hole 0038 shipped and 0039 closed, somewhere RLS cannot see it.
Enforced in **two** places: `fileProviderFor()` pins the client at the same
branch that picks the `INVOICES` segment (so the row and the path cannot
disagree), and `files_money_provider_chk` (0050) refuses the same rows in the
database on **both** axes — the `is_financial` flag and the reserved path
segment — for any caller that bypasses the client.

| Provider | `storage_path` means | Read | Write | Web |
|---|---|---|---|---|
| `local_server` | A bare disk filename, **relative to whatever the project's files directory resolves to right now** — not portable on its own | Express download route → `sendFile` | Base64 JSON body → `writeFileSync` | ✗ |
| `supabase` | The full object key inside the private `rabbit-files` bucket | `storage.download(path)` | `storage.upload(path, file, {upsert:false})` | ✓ |
| `s3` (S37) | The **row-shaped** key (`projects/{id}/…`) — the workspace's bucket **prefix is deliberately NOT stored**: `files_money_provider_chk` reads the third segment, and a prefix edit must not orphan keys. The presign function prepends the prefix at resolution | presigned GET, direct to the customer's bucket | presigned PUT, direct (`storage-presign` is the authorisation boundary; the secret never reaches any client) | ✓ |
| `google_drive` | **Not a path** — the Drive file's opaque id | `files/{id}?alt=media` | Every write throws `readOnly()` | ✗ |

`local_server` resolution order: the project's `files_dir` override if set
**and still present on disk** → `{project_folder}/{slug}_FILES` → an internal
fallback under `rabbit-data/projects/{id}/files`.

⚠️ **Corrected in S26 — this paragraph used to say none of `files_dir` /
`folder_root` / `folder_slug` were database columns.** Two of the three now
are. 0041 added **`folder_slug`** (the folder tree's anchor, so a project can
be renamed without moving its folder) and **`folder_root`** (the absolute
directory). **S35 made `folder_root` a governed write on both backends**: the
two Change buttons (`pickAndSetProjectFolder`, ProjectSummaryView) are gated
by `canSetProjectFolder`, the local routes and `rabbit:ensure-project-folder`
refuse anything `folderRootRefusal` (main.cjs) rejects, the cloud write —
silently stripped by the adapter allowlist until S35 — now lands and is
guarded by `fn_project_folder_root_guard` (0049): workspace admin/manager
only, strictly inside the workspace drive. **`files_dir` is still
bundle-only, deliberately**: its only writer is the relink flow, and
`relinkScan`/`relinkApply` are `local_server` ONLY, so a cloud column would
be written by nothing. It arrives with relink, if relink ever comes to cloud.

### 12.2 Relink — find, preview, **apply**

Modelled on ShotGrid/Blender: point WILSON at the new folder and it re-finds the
moved files itself. `local_server` only, but the matcher is written
provider-agnostically and unit-tested in isolation
(`components/relinkMatcher.js`, pure).

**Three rungs, in order; each rung only sees what the rungs above left
unclaimed:**

1. **`exact`** — basename equals the old path's basename (case-folded).
   Duplicate disk names tiebreak on size, else become `ambiguous`.
2. **`strong`** — sanitized display name **and** size match. Run as a full pass
   before rung 3, so a size-mismatched row cannot steal a candidate that a
   later row would match strongly.
3. **`name`** — sanitized name only. Zero hits → `unmatched`; more than one →
   `ambiguous`.

Routes: `POST …/files/relink-scan` and `POST …/files/relink-apply`. Both refuse
(403) any folder the user did not pick through the OS dialog, and every path
they touch goes through the containment resolver (§3.1).

**`files_dir` is the base-change semantic.** Applying a relink against a new
folder makes that folder the project's files home — **for future uploads too**,
not just the relinked rows. Four guards surround this:

- The dialog **discloses it before the write**.
- Files & Storage surfaces the override with a Reset control.
- A **409** refuses the change if the currently-recorded home exists but is
  merely *offline* (unplugged drive, dropped share) — better to ask the user to
  reconnect than to silently strand files at the true home.
- A second **409** refuses if the change would strand any file that currently
  resolves under the old directory but not the new one.

Every relink writes a `relinked` event, including a base-folder change itself.

### 12.3 `file_events` — the lifecycle stream

Vocabulary (a CHECK constraint, not a convention): `uploaded`, `downloaded`
(0047), `moved`, `relinked`, `trashed`, `restored`, `purged`, and
`upload_abandoned` (0073). Cloud path changes emit `moved`; local relink emits
`relinked`. `upload_abandoned` is written **only** by
`sweep_abandoned_uploads()` (§12.4): a resumable upload whose
`upload_reservations` row expired unreleased with no object landed. Its
`file_id` is a SURROGATE — the fragment never had a `files` row — so the
per-file audit drawer never shows one; the workspace takeout and the
`WIL-3003` cleanup counts do. 0057 added the term without a writer and 0058
withdrew it; suite 66 probe 27 now asserts the term and the writer land
together.

Written by `trg_files_lifecycle` → `fn_file_events_capture()` (SECURITY
DEFINER) — and, since 0073, by `sweep_abandoned_uploads()` (SECURITY DEFINER)
for `upload_abandoned` only, joined in 0074 (Track C / C2) by
`abandon_upload_reservation()` (the client's failure path: a resumable upload
that FAILED with an error the server answered is certified at once, with the
client's reason in `details.reason`) and `sweep_open_uploads()` (teardown: every
open reservation of the tenant, `details.closed_by = 'teardown'`), both for
`upload_abandoned` only; nothing else writes the table. INSERT → `uploaded`; UPDATE → `trashed`/`restored` on the
`deleted_at` transition and/or `moved` on a `storage_path` change (one UPDATE
can emit both); DELETE → `purged` with a JSONB snapshot whose `mime_type` is
truncated to 256 characters, specifically so a client-writable oversized value
can never trip the `details` CHECK and void the certificate.

Read policy: project readers **plus** a workspace-admin arm, so proof of
deletion stays readable after the project itself is gone — **and, since 0074
(Track C / C2, Audrey's ruling 22), a money arm.** Every row carries
`is_financial`, snapshotted at capture by ONE definition,
`file_event_is_financial()`: the `files` row's `is_financial` flag OR a
row-shaped key under a money segment (`INVOICES/`, `FINANCE/` — 0042's
`rabbit_money_segment`). A non-money reader sees a flagged row **only when
`event = 'purged'`** (deletion records stay visible to everyone who could read
the project); every other event of an invoice — upload, move, trash, restore,
download — is for workspace admins and project managers
(`can_access_project_money`, 0037). One policy, every arm restated (a replay of
0027 would drop the money arm; 0074's post-condition 3 is the tripwire).
Limit: the flag is a snapshot — a file that becomes financial LATER keeps its
earlier events unflagged (§17). Suite 78 pins it; 33 pins the rest. There are
no FKs on `file_id` / `project_id` — deliberately, so the certificate outlives
its subject. Append-only is enforced three ways: zero write policies, revoked
grants, and migration post-conditions.

**The `purged` rows are deletion certificates** (TPN-CONT-002). That is why the
local twin, `bundle.fileEvents`, trims to 2000 events by dropping everything
*except* `purged` rows — the deletion record is the one entry that must outlive
churn.

### 12.4 Blob garbage collection

`trg_files_gc_enqueue` fires `AFTER DELETE ON files WHEN storage_provider =
'supabase'` and inserts a `storage_gc_queue` row. The `storage-gc` Edge
Function (adminGuard, workspace-scoped) then does four jobs:

1. **Queue drain** — up to 500 pending rows, re-checking that no `files` row
   (live *or* trashed) still references the path before removing it, so a
   restorable file's blob is never destroyed.
2. **Orphan scan** — walks `rabbit-files/projects/*` under a run-wide budget of
   5000 objects, batching reference lookups, deleting only unreferenced objects
   older than 24 hours, and failing **closed** on tenancy: a project folder
   whose `projects` row is gone is touched only if a `file_events` row still
   ties it to this workspace.
3. **Avatar sweep** — walks `user-avatars/{workspace_id}/*` with paged member
   reads (max_rows applies to service_role too — the unpaged version deleted
   *current* avatars past the cap), removing anything that is not a member's
   current `avatar_url` and older than 24 hours.
4. **Abandoned-upload certification (0073, Track C)** — calls
   `sweep_abandoned_uploads(workspace_id)`: every `upload_reservations` row
   past its 24 h expiry that was never released is closed as `completed` (its
   object landed, or a `files` row names the path) or `abandoned` (one
   `file_events` `upload_abandoned` row, TPN-CONT-017). The counts land on the
   certificate as `reservations_abandoned` / `reservations_completed`, and
   `reservation_sweep_failed: true` says the sweep did not run to completion
   — the RPC is missing (a database without 0073), it raised, or the run died
   before step 4: the flag STARTS true and is cleared only when the RPC
   answers, so the `WIL-3004` failure certificate, which carries the same
   counts, can never claim a sweep that never ran (review round 1) — rather
   than letting 0/0 claim one. It
   destroys nothing (the partial is reaped by Supabase's own 24 h TUS expiry,
   which nothing here can see), so TS-1.5's dual-authorisation argument does
   not bind it and the same function also runs **hourly under pg_cron**
   (`wilson-sweep-abandoned-uploads`, `39 * * * *`) across all workspaces; the
   per-workspace call here is so an admin's cleanup click certifies now rather
   than within the hour.

🚨 **A row is not the only thing that makes an object wanted — the RESERVED
rule (S36).** R.A.B.B.I.T. writes two objects straight to the bucket with **no
`files` row, on purpose**: `projects/<id>/PROJECT.json` (S26) and
`projects/<id>/FINANCE/RATES.json` (S27). Jobs 1 and 2 both decide by asking a
row, so both classified them as garbage. **Measured 2026-08-07: the orphan scan
would have deleted the manifest and the rates mirror of every project on its
next run** — the rates file being the money-gated one, i.e. exactly the figures
`can_access_project_money` exists to withhold. It had not bitten only because
this function is admin-invoked rather than a cron and had not been clicked
since manifests started being written.

Both jobs now consult `isReservedProjectObject()` — **one definition, in
`supabase/functions/_shared/reservedObjects.ts`**, because 0042's lesson is
that a reserved path with a second definition is how these break silently. The
predicate is anchored to the exact path shape and matches **case-insensitively,
because `rabbit_money_segment()` does**: a GC recognising only one casing would
delete an object RLS still treats as money-gated. The queue drain is guarded
too rather than trusting the orphan scan to be the only route — `storage_path`
is client-writable, so a member can point a row of their own at the rates file
and hard-delete it to enqueue the real object for disposal. Preserved objects
are counted in `skipped_reserved`, so a `WIL-3003` line shows the guard fired.
Pinned by `src/tools/rabbit_v0.1.0/storageGcReserved.test.js` (29 assertions,
including all three call sites and nine breakers).

**S3 queue rows drain by signed DELETE (S37).** 0051 widened the enqueue
trigger — a purged `s3` row lands in the queue with `provider='s3'` and the
marker bucket `byo-s3` — and the drain resolves the workspace's CURRENT
`provider_config` + secret and issues a SigV4 DELETE against the customer's
bucket (`queue_s3_drained` in the WIL-3003 counts is the evidence the branch
fired). Two deliberate asymmetries: S3's DELETE is idempotent-success, so
`deleted` there means "certifiably absent now" rather than distinguishing
already-gone; and the **orphan scan stays Supabase-only** — WILSON does not
enumerate customer buckets, so a stranded s3 upload whose row never landed
is the uploader's compensation delete's job, then the customer's own
lifecycle rules.

**It is admin-invoked, not a cron job**, for two reasons: TPN TS-1.5 wants dual
authorization on destruction and a human clicking a stated confirm *is* the
second factor; and a GitHub Actions cron would hit the default-branch trap
(§7.2). Every run emits queue-row terminal statuses plus one `app_events` line
(`WIL-3003` success / `WIL-3004` failure).

### 12.5 CSV export and workspace takeout

One writer, `src/lib/csvExport.js`, with three safety properties: a UTF-8 BOM
and CRLF endings so Excel opens it correctly; RFC 4180 quoting; and a
**formula-injection guard** that prefixes any string beginning `=`, `+`, `@` or
`-` (and which is not a plain number) with an apostrophe, so a crafted project
name cannot execute in a spreadsheet.

**Per-page exports** — team roster, rate card, and project tasks. Each follows
one rule: *it exports exactly what the viewer sees*, same rows (filters, sort,
liveness) and same columns. The wage column cannot leak through an export if
the screen is not showing it.

**Workspace takeout** (admin-only, in the Admin Terminal → Company): one CSV per
table across 19 tables plus a `manifest.json`, zipped. It is built from **the
requesting admin's own RLS-scoped reads — never a DEFINER sweep** — so it can
only ever contain what that admin already reads. Paginated at 1000 rows with a
200 000-row backstop recorded in the manifest as `truncated` rather than
silently dropped.

**Excluded, with reasons stated in both the UI and the manifest:**

- **O.T.T.E.R. content** — courses may encode internal practice a company does
  not want leaving, *and* personal courses are private even from admins, so a
  takeout that swept them in would become an admin backdoor into exactly the
  content the visibility model makes unreadable. (The per-user
  `/api/export-all` stays: exporting *your own* courses is fine.)
- **Notes** — owner-only personal content with no admin bypass.
- `storage_gc_queue` — service-role plumbing, not company data.
- **File blobs** — metadata only; blobs live in the company's storage provider.

---

### 12.6 The folder tree (S26, migration 0041)

Audrey, 2026-08-03: R.A.B.B.I.T. is also a project file manager, and the tree
must reflect in **whichever storage backend the company selected**.

**`public.folders` is the source of truth and the storage path is DERIVED from
it** (Audrey's decision, 2026-08-04, settled). Supabase Storage has no real
folders — it is object storage with path prefixes, so an *empty* folder cannot
exist as an object, and "toggling a category off must never delete the folders"
requires a folder that outlives its contents.

```
<project folder>            kind='root',     path=''
├── ASSETS/                 kind='category', path='ASSETS'
│   └── Hero-Ship/          kind='entity',   path='ASSETS/Hero-Ship'
├── SCENES/   SHOTS/        revealed by projects.scenes_enabled
├── LEVELS/                 revealed by projects.levels_enabled
├── EXPERIENCES/            revealed by projects.experiences_enabled
└── INVOICES/               always
```

- **`path` is relative to the project folder**, so the same string works on
  every backend: disk resolves it against `folder_root`, Supabase against
  `projects/<id>/` in `rabbit-files`.
- **`path` is computed CLIENT-side** in `folderPaths.js`, never in Postgres —
  Local Server is a JSON bundle with no Postgres in it, so a generated column
  would exist on one backend only. Same reasoning S25 applied to entity names.
- **Five nullable entity FKs**, not a polymorphic `(type, id)` pair: a
  polymorphic id cannot be a foreign key, so nothing would stop a folder
  pointing at a deleted scene.
- **`folders` uses `can_write_project`, NOT the money gate.** A team member has
  to be able to create an asset, and an asset that cannot get a folder has not
  really been created. The INVOICES *folder row* is visible to any project
  reader — a folder is a name, not a payment; the invoice FILES inside stay
  manager-only at both layers (0038/0039).
- **A rename MOVES the folder.** The `label` column exists so a future session
  can switch to a stable slug without a migration, but today the slug follows
  the name — which is what `electron/main.cjs` already did for assets, so no
  existing local project changed behaviour.
- 🚨 **`<slug>_DATABASES` is NOT in the tree and must never be.** On `main`
  that was the DATASTORE, not a files folder. `electron/main.cjs` still creates
  it for existing local projects; nothing extends it.
- 🚨 **`fileSlugify` and the category list exist in TWO copies** — the renderer
  and `electron/main.cjs`, which cannot import from the renderer bundle.
  `folderParity.test.js` reads that file as text and fails when they diverge,
  covering both planners as well as the slug function.

**`PROJECT.json`** sits at the project root: a generated MIRROR of the
project's settings, the database staying authoritative. Written debounced on
every settings change; read only for portability, recovery and handoff. It
**excludes per-member rate overrides** — those are manager-only while the
manifest's path is readable by any project member. See §17.

### 12.7 The workspace drive, the NAS, and remote access (S34/S35)

This is the section to hand a customer who asks "how does my team reach the
files, and what do we need to buy or set up?" The design and its measurements
are `NETWORK_STORAGE_DESIGN.md`; this is the operational summary.

**The drive is set once, by an admin, for the whole workspace.**
`public.workspace_storage` (0048) holds one row per workspace: `mode`
(`central` = Petal cloud, `byos` = the customer's own server/NAS) and a
canonical `root_path`. Admins set it in **Admin Terminal → Storage**; every
member's desktop reads it and resolves files under it. Mapped drive letters
(`Z:`), bare drive/share roots, dot segments and device-namespace paths are
refused at every layer — `Z:` names a different folder on every computer, and
a bare root hands WILSON the entire disk. **Project folders live strictly
inside the drive** (0049, S35): a workspace admin or manager points a
project's folder from the **Project Control Panel**, and both the local API
and the database refuse a folder outside the drive. Audrey's rule, verbatim:
*"admins can set server/drive. managers can set folders within set drive.
this stops anyone from breaking it."*

Two propagation limits, by design (S34), that the setup conversation should
state up front:

- **A changed drive reaches other machines at their next launch or sign-in.**
  There is no live re-broadcast; the Storage section's success notice says so.
- **The web Admin Terminal cannot probe reachability or detect mapped
  drives** — only the desktop app can ask the OS. The web UI says so instead
  of pretending.

**The NAS is the always-on server WILSON deliberately does not have.**
WILSON's local server is loopback-only and dies with the app — there is
nothing to expose (§3.5 of the design measured this). A NAS presents as an
SMB share — `\\nas\projects` — which is exactly the path shape the drive
supports. On the LAN, nothing extra is needed: point the drive at the share
and every desktop in the office resolves the same folders.

**Remote access belongs to the customer, not to WILSON.** Away from the
office, the share is reached however the customer chooses — a corporate VPN,
or the NAS's own built-in remote access (Synology, QNAP and TrueNAS all ship
a VPN server or vendor relay as a tick-box feature, not a project). **WILSON
cannot tell the difference and needs no configuration for it** — it still
resolves the same `\\nas\projects` path.

- **TPN customers:** MPA CSBP **TS-2** names *"Bastion host model only. VPN
  with AES-256"* as **the** remote-access control. A VPN is not the fallback
  here — it is the named control, so the cheapest route is also the compliant
  one. Do not offer a TPN-track customer anything else.
- ⚠️ **The share must keep its UNC form remotely.** A VPN preserves it; some
  vendor sync clients surface the share only as a mapped drive letter, which
  WILSON refuses by design. **Check the customer's chosen remote-access mode
  preserves `\\server\share\...` before promising remote work** — five
  minutes with the real box, much cheaper before rollout than in support.

**Set the performance expectation in the same breath.** "Accessible 24/7" is
true; "usable for multi-GB video over the internet" is a different claim. SMB
is a chatty, LAN-designed protocol, and this is well-trodden post-production
ground (it is why purpose-built transfer tools exist):

- Works well remotely: browsing the tree, metadata, documents, small assets.
- **The workflow that works: copy down → work locally → copy back.**
- Works badly: scrubbing or editing multi-GB media *in place* across a WAN
  link. It is not broken — it is slow in a way that feels broken. Say this
  before the customer discovers it, or WILSON gets blamed for the physics of
  the share. A dead share can also stall the desktop app for the SMB timeout
  on a file operation (S34 stated limit — the fs calls are synchronous).

**State the SMB requirement (TPN-CONT-016).** The share must run **SMB 3.x
with signing and encryption enabled; refuse SMB1.** WILSON cannot enforce the
server's configuration — this belongs in setup guidance because a
default-configured share moves pre-release content unsigned and unencrypted
across the office LAN.

**Say the desktop/browser split once, properly (design §5f).** The browser
build is for review, light edits and anywhere-access; professional formats
and very large files want the desktop app, which talks to the drive
directly. A customer sizing hardware should plan on the desktop app for
every seat that touches media.

### 12.7a The bucket — S3-compatible storage (S37)

The second BYO option, for the customer with no office server: their own
bucket at **AWS S3, Backblaze B2, Wasabi, Hetzner, Cloudflare R2 or MinIO**
— one adapter, because they all speak the same API. Configured by a
workspace admin in **Admin Terminal → Storage → Your own storage →
S3-compatible bucket**: endpoint (empty = AWS), region, bucket, optional
prefix (the folder inside the bucket everything lives under), access key id,
and the path-style checkbox for MinIO-shaped gateways. The **access key
secret is saved separately and stored encrypted** (AES-256-GCM, the 0028
`workspace_ai_keys` precedent; master key `WILSON_STORAGE_KEY_SECRET`, an
Edge-Function secret, never in Postgres) — no client, admin included, ever
reads it back; the console shows its last four characters. Transfers are
**presigned and direct**: the `storage-presign` Edge Function authorises one
request against one key and the bytes travel straight between the app and
the bucket — Petal never proxies them, never pays their egress, and never
holds them.

**What to create at the provider** (five minutes, once):
1. A bucket. Private; no public access.
2. A key **scoped to that bucket** with GetObject / PutObject /
   DeleteObject. Nothing wider — WILSON never lists, and the probe will
   tell you if delete is missing.
3. **The CORS rule below, pasted into the bucket's CORS settings.** Not
   optional, and not browser-only: the desktop renderer is Chromium with
   webSecurity on, so **both surfaces enforce CORS**. Without the rule,
   uploads fail as a bare network error with no status and no server log —
   the single most likely support call this feature generates. `Test
   connection` distinguishes it: server ✓ + "the browser was blocked" =
   this rule is missing.

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedOrigins: ["*"]` is correct here, not lax: the desktop app's origin
carries a random localhost port, so an origin list cannot name it, and the
presigned URL — not CORS — is what authorises access. (B2 and R2 take this
JSON as-is; AWS S3 takes it in the console's CORS editor; MinIO uses
`mc anonymous`/`mc admin` CORS equivalents — consult the gateway's docs.)

**`Test connection` is a real round trip, in two halves.** The server half
PUTs, GETs and DELETEs a probe object under `.wilson-probe/` and names the
failing stage: 403 = credentials, 404 = bucket/region, unreachable = the
endpoint or **the addressing style — a wrong path-style setting presents as
a DNS failure**, which is why the checkbox exists and the sentence says to
flip it. The client half repeats the trip from the app itself, which is the
only place CORS can be tested.

**The rules that don't move:**
- 🚨 **Money never leaves Supabase.** Invoices and the rates mirror stay in
  Petal's RLS-governed storage whatever the workspace chose — a bucket
  policy cannot express "managers of this project only". Enforced three
  deep: the client pin (`fileProviderFor`), the presign function (refuses
  money-segment keys wholesale), and `files_money_provider_chk` (0050/0051).
- **Each file remembers where its body lives** (`files.storage_provider`).
  Switching provider — or back to Petal cloud — never orphans what was
  already written: reads resolve from the row, and the retained config keeps
  serving old bodies. Only NEW files follow the new choice.
- **Purge parity (0051):** a purged s3 row is enqueued for certified
  disposal like a Supabase one; Storage Cleanup drains it by signed DELETE
  against the current config. **The orphan scan does not scan customer
  buckets** — a stranded s3 upload whose row never landed is covered by the
  uploader's own compensation delete, and beyond that is the customer's
  lifecycle rules to keep.
- **Teardown leaves customer buckets alone, deliberately.** Their bucket is
  their property; the WIL-7005 certificate states `byo_bodies_left` rather
  than silently under-reporting.
- **`downloaded` logging is advisory here by construction** (the S33 limit,
  generalised): a presigned GET is served by the customer's provider and
  WILSON never sees it.
- **Size:** WILSON imposes no ceiling of its own on this path. A single
  presigned PUT is capped by the provider (5 GB everywhere that matters);
  multipart for beyond that is future work, not a bug.
- **Propagation matches the drive's rule:** another machine picks up a
  bucket change at its next launch or sign-in; the saving admin's own
  session applies it immediately.

### 12.7b Thumbnails — the derived preview (S39, migration 0053)

**There is nothing for an admin to set up.** Unlike the NAS (§12.7) and the
bucket (§12.7a), this needs no configuration, no credential and no CORS rule.
It is recorded here because two of its properties are surprising, and one of
them is a decision rather than a fact.

**How it works.** When a file is uploaded in cloud mode, the *uploading
machine* renders a 256px JPEG from the copy already in its memory
(`createImageBitmap` → canvas → `toBlob`) and stores it in the private
`rabbit-thumbnails` bucket under **its source's key plus `.jpg`**. The path is
written to `files.thumbnail_url` — the first writer that column has had since
it was declared in 0000. Display URLs are **signed in one batch per file list**,
because the bucket is private and a grid renders dozens of tiles at once.

**Why the key is identical to its source's.** Storage RLS keys on path
segments and the **third** segment is the money gate
(`public.rabbit_money_segment`, 0042). Holding the layout constant is what lets
this bucket carry the same eight policies with only `bucket_id` changed — so an
invoice's thumbnail is manager-only for exactly the same reason the invoice is.
🚨 **A `thumbs/` folder level, or any rewrite of the name, shifts every segment
and silently moves the derived image out of the gate it is supposed to
inherit.** Suite 63 probe 13 is the tripwire.

🚨 **Generation is at upload time and must stay there.** Generating on demand,
or server-side, means downloading the source first — gigabytes of egress at
Petal's expense to produce a postage stamp, on exactly the multi-GB media this
product exists for (design §4a2). That is the one expensive design.

#### 🚨 A thumbnail LIVES where its source lives (decided 2026-08-08, BUILT in S44 / migration 0054)

**Audrey:** *"the image should be kept in the company storage. if the thumbnail
lived in the petal cloud it would break tpn inherently."*

**This decided against what S39 shipped, and S44 implemented it.**
A workspace on its own S3 bucket keeps its media there, and **its thumbnails go
there too** — written beside the source at `<body key>.jpg`, and enqueued for
disposal at the same store. What shipped, and what deliberately did not, is in
**"What S44 actually built"** below.

**The reasoning is a content-security argument, not a cost one, and it is
correct.** A still frame **is** the content. A legible 256px frame of
pre-release footage sitting on Petal's infrastructure makes Petal a
content-bearing party holding that studio's material — which is precisely
what a customer choosing BYO storage is paying to avoid, and what MPA/TPN
controls are written about. The counter-arguments S39 recorded (a preview is
10–30 KB; one code path for every provider; no presign round-trip per tile)
are **operational conveniences, and they do not outweigh a compliance
boundary.** Audrey's earlier instruction in design §5d.1 — *"lets store
thumbnails within the supabase storage that stores database info"* — was
given **before BYO media storage existed** and does not survive it.

**The rule, stated so it cannot drift:**

> **A thumbnail lives where its source lives, and dies with it.**

Both halves are now true.

⚠️ **Two consequences that are easy to get backwards:**
- **Money-gated files are NOT an exception — they are the rule applied.**
  Invoices and rate documents never leave Supabase (§12.1a), so **their**
  thumbnails stay in `rabbit-thumbnails` too. "Thumbnails follow the media"
  must never be read as "move invoice previews to a customer bucket."
  **There is no money branch in the thumbnail path, and there must not be one:**
  `fileProviderFor` pins `financial` to Supabase before the workspace's choice
  is read, so the preview inherits the pin by following its body.
- **`rabbit-thumbnails` does not go away.** It remains correct for every
  `petal`-provider workspace, which is the default and today the only
  configured state.

**Exposure when this was decided and fixed: none.** Measured 2026-08-08 across
**all three** environments: dev and prod all-zero; **staging has one `byos`
workspace, but its provider is `network`, not `s3`**, with no `provider_config`,
zero `files` rows and zero thumbnail objects. (⚠️ The S44 brief said "zero `byos`
workspaces" — that was wrong for staging. The operative claim survived: a
`network` workspace has no cloud upload path at all, so **no customer content
was ever placed on the wrong side of this boundary and no data migration was
required.**) A design defect caught before it could leak, which is the cheapest
moment to have caught it.

#### What S44 actually built (migration 0054)

**Write — `storage/thumbnails.js` `putThumbnailTo(fileProvider, key, blob)`.**
`supabaseAdapter.uploadFile` hands it the **same `storageProvider` variable it
just used for the body**. One decision, used twice: there is no second decision
for the preview to disagree with. Supabase keeps its own arm (rabbit-thumbnails,
`upsert:true`) because the registered `supabase` provider writes to
rabbit-**files** with `upsert:false`; every other provider goes through the
registry's ordinary `put()`, which is why S38's Drive entry needs no thumbnail
work of its own. An unregistered provider throws — fail-closed, costing a
preview and never the file.

**Disposal — `storage_gc_queue.kind` (`body` | `thumbnail`).** 🚨 **This column
exists because the fix would otherwise have caused the bug it was written to
prevent.** `storage-gc` picks its restorability column from the queue row; S39
inferred "this is a thumbnail" from the **bucket**, which stops working the
moment an s3 thumbnail is correctly enqueued under the same `byo-s3` marker as
its body. The drain would then check `files.storage_path` for a key that only
ever appears in `files.thumbnail_url`, get "nothing references this", **delete a
still-restorable preview and stamp it `deleted` in the ledger.** `kind` makes
the object say what it is; the bucket goes back to meaning only what it says.

⚠️ **The thumbnail arm is NOT a copy of the body arm.** The body arm only runs
for `('supabase','s3')`; the thumbnail arm runs for **any** row carrying a
`thumbnail_url`, including `local_server` (0053 widened the trigger for exactly
that case). Writing `OLD.storage_provider` into the provider column would
enqueue a Petal-hosted preview as provider `local_server`, which
`storage_gc_queue_provider_chk` refuses — and the trigger's `EXCEPTION` handler
swallows that into a `WARNING`, so the purge "succeeds" and disposes of
**nothing**. Suite 64 probe 9 drives that row; both breakers were run and failed
for the predicted reason.

**Teardown.** The Petal sweep now **excludes `s3`, and only `s3`**
(`.neq('storage_provider', 's3')`), reversing S39's deliberate absence of any
filter. 🚨 **It mirrors 0054's THUMBNAIL arm, not the body scan's pin, and the
difference is a leak:** the body scan pins to `= 'supabase'` because only a
Supabase *body* is in `rabbit-files`, but a `local_server` or `google_drive` row
can carry a **Petal-hosted preview** (0053 widened the purge trigger for exactly
that case). Copying the body scan's pin would leave those frames in
`rabbit-thumbnails` while WIL-7005 certified the tenant destroyed. S44 made that
mistake and caught it in its own review. WIL-7005 also gained
**`byo_thumbnails_left`** beside `byo_bodies_left`. Since S44 one s3 row leaves
**two** objects in the customer's bucket, so a row count under-reported by one
per preview — and a certificate that under-reports is the failure S39's own
review caught, one bucket over. Both counts are `NULL` on any failed query,
never `0`.

⚠️ **LATENT, RECORDED: 0054's post-conditions text-match `pg_get_functiondef()`,
WHICH RETURNS THE FUNCTION'S OWN COMMENTS.** That is the 0038 trap in SQL, in
the one tier that has no comment-stripper — a future comment containing
`'thumbnail'` or `byo-s3` would satisfy a post-condition the code no longer
does. **Measured on dev 2026-08-08 against a comment-stripped definition: all
four still hold on code alone** (`OLD.storage_provider::text,` appears exactly
once, and all three `LIKE`s match), so it is a hazard, not a live defect. The
real proof is **suite 64**, which drives the enqueue end-to-end (insert →
delete → read the queue) and was verified against two breakers; the text checks
are belt-and-braces. **A future migration editing this function should strip
comments before matching:** `regexp_replace(def, '--[^\n]*', '', 'g')`.

🚨 **DEPLOY ORDER IS LOAD-BEARING: 0054 MUST LAND BEFORE THE EDGE FUNCTIONS.**
`storage-gc` selects `kind` and `operator-workspaces` filters on it, so against
a database without the column PostgREST answers `42703` and:
- `storage-gc` **throws** — fail-closed (nothing is deleted), but Storage
  Cleanup is dead for every workspace until the migration lands;
- `operator-workspaces` is **worse in kind**: supabase-js resolves with
  `{error}` rather than throwing, the guard leaves both `byoLeft` and
  `byoThumbsLeft` `null`, and **teardown proceeds to the CASCADE and stamps
  WIL-7005 with both counts null** — permanently unre-derivable, because after
  the cascade nothing can attribute a project to a workspace again.

The reverse order is unsafe in principle too (0054 applied, old `storage-gc`
still deployed: its bucket-name discriminator reads an s3 thumbnail as a body
and deletes it with a `deleted` stamp) — harmless only while no s3 workspace
exists. **Migration first, then functions, on every environment. Same order on
a rollback, reversed: functions back first.**

**Rate limit.** `STORAGE_PRESIGN_RPM` default **120 → 240**: an s3 image upload
now costs two presigns (body, then preview), so the old ceiling refused a
100-image drag from roughly file 60 — and on the *second* call of each pair, so
the bodies had landed and the user saw a half-illustrated grid with an
unrelated-sounding message.

**Disposal limits, stated in BOTH directions** (the §17 rule):
- **Swept on teardown:** Petal-hosted previews in `rabbit-thumbnails`.
- **Deliberately NOT swept:** previews in a customer's own bucket — same rule as
  the body, their storage and their property. **Counted** on the certificate
  instead of reached into.
- **Never orphan-scanned, on either side.** `storage-gc`'s orphan scan is
  `rabbit-files`-only by design and WILSON never enumerates a customer bucket
  (§12.4). So a preview whose `files`-row insert was refused has **only**
  `uploadFile`'s compensating delete to save it — which is why
  `removeThumbnailFrom` throws rather than resolving, and the caller logs.

#### ⚠️ What S44 deliberately did NOT build: browser display

An s3 workspace's previews are **written and disposed of correctly but are not
displayed** — the grid shows file-type icons. `signedThumbnailUrls` can only
sign objects in Petal's bucket, and `FileManager` filters to
`storage_provider === 'supabase'` so this is a stated behaviour rather than a
lookup that quietly finds nothing.

**Why (Audrey's call, 2026-08-08):** display needs a batch presign that does not
exist — `storage-presign` authorises **one key per call**, and its GET expiry is
**300s** against the Supabase arm's **3600s**, so a grid left open six minutes
goes dead. And **no S3 workspace exists on any environment to verify a new
signing endpoint against**, so the first real customer would be the test.

🚨 **Generation is the one-way door, not display — which is why the write half
shipped anyway.** A preview that exists can be displayed later by a pure client
change: no backfill, no egress. A preview that was never generated can only be
made later by downloading the full source, the one expensive design this section
already refuses.

⚠️ **A `network` workspace gets icons regardless**, and no design fixes that: a
browser cannot read a NAS. So this rule is uniform while its *outcome* is not.

📒 **HISTORICAL — S39-era, RESOLVED BY S44. Kept because it is the argument that
won, not because it describes current state.** The case against what S39 built:
a customer who chose BYO storage specifically so pre-release frames do not sit
on Petal's infrastructure had a **legible 256px frame of every image** doing
exactly that, with no opt-out. **Raised by S39's adversarial review; left as
built and flagged rather than decided unilaterally.** Its own suggested fix —
*"route the preview through the same storage registry the body already uses; the
registry makes that a provider lookup, not a fork"* — **is precisely what S44
implemented.** It was a provider lookup.

#### Limits, stated

- **The desktop's Local Server tier is unchanged and still separate.** Its six
  Express thumbnail routes and its on-disk `rabbit-data/thumbnails/` cache serve
  managed files and entity images, which have no `files` row and no bucket.
  Cloud mode is what gained previews on the web; Local Server keeps `sharp`.
- ⚠️ **The two tiers disagree about size, and did before this session.** The
  managed-file route renders 256px at q80; the asset and entity routes render
  512px at q85. S39 matched the 256/q80 pair rather than inventing a third.
- **TIFF gets no cloud preview.** `sharp` decodes it, browsers do not, so the
  cloud type gate is deliberately narrower than the desktop extension list.
  **SVG is excluded on purpose** — rasterising untrusted vector can pull
  external references, and a vector file gains little from a raster preview.
- **A thumbnail dies with its source**, on the same purge and the same
  certificate (`trg_files_gc_enqueue` enqueues both — TPN-CONT-011). Workspace
  teardown sweeps this bucket too, and WIL-7005 now carries
  `thumbnails_found` / `_removed` / `_failed`.
- 🚨 **There is no orphan sweep over this bucket.** `storage-gc`'s orphan scan
  walks `rabbit-files` only. A thumbnail whose `files` row insert was refused is
  cleaned up by `uploadFile`'s compensating delete, and if the browser dies
  between the two, one 10–30 KB private JPEG is stranded with no certificate.
  Accepted, and the reason the compensating delete now reports its failures
  instead of swallowing them.
- **Signed URLs expire after an hour.** A list open longer than that re-signs
  when its contents change; a tile that loads against an expired URL recovers
  as soon as a fresh one arrives (the component remembers *which* URL failed,
  not merely that one did).

### 12.7c Video — preview and the still frame (S40, no migration)

Audrey, 2026-08-05: *"can we add a way to preview videos on the app?"* and
*"for videos i would want to be able to get a single still frame and make it the
thumbnail automatically."*

**Nothing here touched the schema.** A video still IS a thumbnail: same
`rabbit-thumbnails` rules, same `thumbnailKeyFor`, same
`putThumbnailTo(storageProvider, …)`, same 0054 disposal. Only the decoder is new.

#### The three decoders, and which surface each serves

| Decoder | Reaches | Covers | Costs |
|---|---|---|---|
| **Browser `<video>` + canvas** (`storage/videoThumbnails.js`) | cloud upload, and the desktop fallback | H.264/AAC MP4, VP8/VP9 WebM, AV1 | nothing — the file is already in memory, or on local disk |
| **ffmpeg** (`electron/ffmpeg.cjs`) | desktop managed files only | + ProRes, DNxHD/DNxHR, MXF | one process, input-seeked |
| **`sharp`** (unchanged) | desktop managed files | raster images | unchanged |

🚨 **`canThumbnail()` STILL REFUSES VIDEO AND THAT IS CORRECT.** The video path
is a separate entry point because `generateThumbnail`'s injectable seam is
`createImageBitmap`, which cannot express seek-and-decode on an
`HTMLVideoElement`. Two guard tests pin the refusal; widening it silently
disables every video preview.

#### The serve route

`GET /api/rabbit/projects/:projectId/managed-files/:id/stream` — `res.sendFile`,
so **HTTP Range is automatic** (express 5.2.1 → send 1.2.1). Without ranges a
`<video>` cannot seek and the browser pulls the whole file first; on a 5 GB
master that is a hang, not a slow preview. A hand-rolled `createReadStream` does
**not** do this.

It is the **first WILSON-mediated managed-file read**, so S33's AS-2.9
obligation lands here — and the log is **throttled to one event per file per
minute**, because a `<video>` issues a request per seek and `rabbitLogFileEvent`
evicts the oldest non-`purged` entries at 2000. `?probe=1` suppresses the event
entirely for the thumbnail decode, which is a machine fetch and not a read.

🚨 **`Content-Type` is allowlisted and `nosniff` is set, on this route and on
the sibling files download.** `mime_type` is client-writable and the renderer is
served from `http://127.0.0.1:<port>` by this same Express app, so bytes
returned as `text/html` would execute on WILSON's own origin.

#### ffmpeg

**LGPL build, invoked as a separate executable, never linked.** That combination
creates no obligation to publish any of WILSON's code; the GPL build is the one
with copyleft consequences and you only get it by opting in
(`--enable-gpl`, libx264/x265). Still-frame extraction needs **decode only**,
and both ProRes and DNxHD decoders are in the LGPL build.

- 🚨 **`-ss` BEFORE `-i`.** Input seeking jumps to the timestamp; output seeking
  decodes from frame zero. On a 5 GB file over a NAS that is seconds vs minutes.
- 🚨 **`execFile` with an argument array**, never a command string — NAS
  filenames are outside WILSON's control.
- **Which frame:** ~10% of duration clamped to 1–10 s, never frame 0 (video
  opens on black, a fade-in or a slate). The same three constants live in
  `videoThumbnails.js`; a test asserts they agree.
- **One deadline for the whole call** (45 s), not three independent per-process
  timeouts. The renderer shares this server's origin and Chromium allows six
  concurrent connections per origin, so long thumbnail requests stall the whole
  UI, not just their own tiles.
- **Writes to `<output>.part` and renames.** The GET route serves the cache file
  whenever it EXISTS, and that check runs before the in-flight dedupe.

**The binary is not in git** — the repo is public. `resources/ffmpeg/README.md`
carries the install and which build to download. Packaged by
**electron-builder** (`build.extraResources`), which is the packager that ships;
`forge.config.cjs` does not.

#### Limits, stated

- **s3 playback and s3 still-display are deferred**, matching S44's decision for
  images and for the same measured reasons: no batch presign, `storage-presign`'s
  GET expiry is 300 s, and no S3 workspace exists on any environment to verify
  either against. `getUrl` is therefore **optional** in the registry, not a sixth
  `REQUIRED` function — promoting it would make `registerStorageProvider` refuse
  s3.
- **A `network` workspace has no cloud preview at all**, unchanged and not
  fixable: a browser cannot read a NAS.
- **Professional codecs get no preview until the ffmpeg binary is installed.**
- **A managed video added before that binary arrives keeps its icon** — the
  ffmpeg arm generates on demand, the renderer fallback runs only at add time,
  and `import-folder` never runs the renderer path at all.
- **`.ts` is deliberately NOT a video extension.** MPEG transport streams use
  it and so does every TypeScript file; this tool sees far more of the latter.

### 12.8 Deck attachments (Track C / C3, migration 0075)

D.O.G.'s project attachments are **ordinary project files**, on every backend
that has a file store. There is no second mechanism: the Resources drop zone
and D.O.G.'s new-project modal both call `adapter.uploadFile`, so an
attachment is a row in `public.files` / `bundle.files` with its body in
`rabbit-files` / the project's files directory, and it inherits the quota
meter, the reservation (§12.4), the money gate, `file_events` (§12.3), the
30-day trash and the teardown sweep without any of them being told about it.

**What marks a file as a DECK attachment** (`deckAttachments.js`, one module
for one contract — the reader and its three writers drifted the moment they
lived apart):

- `document_kind` is non-null (0075's column, the ten-value enum 0000
  declared) — whoever uploaded it; **or** the file is an image or a video
  **filed against the project itself**, with no `scene_id` / `shot_id` /
  `asset_id` / `task_id` / `phase_id` / `level_id` / `experience_id`.
- 🚨 RABBIT's own uploads leave `document_kind` NULL, and for DOCUMENTS that
  is the whole separation: a project's scripts and specs are not deck source
  material unless someone gives them a Kind in the Resources table.
- 🚨 **MEDIA HAS NO MARKER OF ITS OWN, SO THE MARKER IS WHERE IT WAS FILED.**
  Review round 1 caught the first version of this rule admitting *every* image
  and video the project had ever held. On a project a month into production
  the twenty NEWEST files are renders, so the brief was pushed out of D.O.G.'s
  budget entirely and 32 MiB of production media went into the generation
  prompt in its place. An entity FileManager stamps the file with the entity it
  was opened on; the Resources drop zone stamps nothing.
- ⚠️ **The residue, stated rather than closed — and review round 2 corrected
  WHERE it is.** Round 1 named "`FileManager` mounted at project level"; there
  is no such mount, since every `<FileManager>` passes an entity. The surfaces
  that really write project-level media are **`ProjectSummaryView`'s
  ProjectFilesSection** (its Add Files calls `uploadFile(file, { type:
  'project' })`, no entity keys) and **`BudgetView`'s expense receipts** (a
  scope `uploadFile` does not read — its own `OUTSTANDING.md` entry). Files
  from either are indistinguishable from a Resources drop and WILL be
  included. Bounded rather than fixed: documents are always taken first
  (below), so nothing can crowd out the brief, and D.O.G.'s File roles list
  names every file it is using. Closing it properly needs a column that says
  "filed as deck source material", which C3 did not take.
- ⚠️ **On Local Server the entity check is weaker than it looks.** The Express
  upload route writes `phase_id`, `asset_id` and `task_id` and drops
  `scene_id`, `shot_id`, `level_id` and `experience_id`, so "no entity" there
  can mean "the route discarded it". Narrow in practice — that backend's entity
  FileManagers write the *managed* store, which `listFiles` never returns — but
  real when the renderer runs without the preload bridge.
- 🚨 A writer that KNOWS it is writing an attachment must therefore leave the
  row recognisable. `documentKindFor()` is total by construction: media →
  NULL, anything else → the detected kind **or `'other'`**. Using
  `detectDocumentKind(name) || null` — which is what all three writers did at
  first — writes NULL for a PDF whose name matches none of its heuristics, and
  the file then uploads, lists in the grid, and is invisible to generation.
  Measured, not reasoned about: `polarityRoundTrip.test.js` caught it on a
  file called `legacy.pdf`.

**What D.O.G. reads back, and the bound.** It lists the rows, filters them,
then DOWNLOADS each body through `adapter.downloadFile` and rehydrates it —
text as text, binary as base64 with the data-URL prefix stripped. Without that
step a cloud attachment uploads perfectly and contributes nothing to
generation, which is worse than the loud refusal it replaced. Bounded at
**20 files and 32 MiB in total**, because `files` holds a project's whole
production tree; anything over the budget is skipped rather than truncated,
and the panel states how many were left out.

🚨 **The budget is spent DOCUMENTS FIRST, then media, each newest-first**
(`orderAttachmentCandidates`). A single date sort spends it on whatever
happens to be newest, which on a working project is media — so what the bound
costs is visual reference material and never the source material the deck is
about.

**The legacy arrays are still read.** `project.documents[]` /
`visualAssets[]` are never written any more but are still merged into both the
Resources list and D.O.G.'s source set on every backend, so nothing an
existing local project had was lost. Moving them is a deliberate one-time
action: **Settings → RABBIT → "Move deck attachments into project files"**,
dry run required first, per-file ceiling **32 MiB**, oversized files named and
left in place, and each entry cleared from the array only after its upload
returns — so a crash mid-run means a re-run moves exactly what is left.

⚠️ The ceiling is 32 MiB because `localServerAdapter.uploadFile` base64-encodes
into a JSON body that `express.json({ limit: '50mb' })` caps — and Local Server
is the only backend whose projects can hold legacy arrays at all, so a ceiling
above ~37 MiB would never bind: those files would fail with a raw HTTP 413,
counted as failures rather than named as oversize.

**Two CORE flags with opposite defaults**, deliberately not unified — see
§17's "Correctness" note. `runAttachmentMigration` is the one place they meet
and it carries `isCore !== false` across explicitly.

🚨 **A NEWLY WRITTEN ATTACHMENT IS CORE** (`NEW_ATTACHMENT_IS_CORE`), because
that is what the legacy writer produced: it never set `isCore`, and D.O.G.
reads a missing flag as CORE. Review round 1 found this bundle's first version
writing `false` there, which turned an identical gesture — drop a brief on
Resources — from "a primary source of truth for what this project IS" into
"supporting reference material only", silently. Both measured polarity diffs
stayed at zero throughout, because both covered the READ path and the
migration and neither covered the WRITE path.

⚠️ **`is_core_definer` is shared with RABBIT's Files views, and that is the
whole of it — it does NOT reach intake.** Review round 1 added a paragraph
here claiming a Resources drop became an intake candidate; review round 2
traced it and found it false. `IntakeWizardView` keeps its files in local
state, populated only by `IntakePrepare` from a picker as staging objects
carrying a `dataUrl`, and `runIngestion` needs that `dataUrl` to extract text.
A `files` row has none, and no code path puts one in that list. Left here as a
correction rather than silently deleted, because "measured" was claimed for it
and it had not been.

## 13. The three tools, the shell, and the agent

### 13.1 D.O.G. — Deck Outline Generator

`src/tools/deck-outline-generator_v0.514/`. One large component
(`DeckOutlineGenerator.jsx`) plus a layout visualiser, a parser, exports, and a
prompt set. **D.O.G. is not part of the agent system.**

**Pipeline**: uploaded files and/or the open RABBIT project's attachments →
assembled into a message array → one of eight `callAI()` calls → a
marker-delimited text response → `parseSlideContent()` extracts TITLE,
SUBTITLE, LAYOUT STRUCTURE, COPY, VISUAL STYLING, REQUIRED ASSETS and
COMPONENT GEOMETRY → `correctGeometryIconOrder()` fixes icon-above-title
stacking on title layouts → held as tabs → exported.

The eight calls: theme colours, single-slide generation, single-slide
regeneration, full-deck generation (with up to 3 **continuations** when
`stop_reason === 'max_tokens'` — a continuation loop, not an error retry),
AI rewrite, rewrite redo, image prompts, and a deck visual description.

**Exports**:

| File | Contents |
|---|---|
| `{deck}_DECKOUTLINE.md` | All slides, `═`-delimited, page-sorted |
| `{deck}_VIS_DECKOUTLINE.md` | Adds a DECK SUMMARY header (title, page count, selected theme colours, visual description) and an ALTERNATE THEME COLORS footer |
| `{deck}_IMG_PROMPTS.md` | Per-asset image-generation prompts grouped by slide, from a dedicated call |
| `{proj}_VIS_ASSETS_{NN}_{name}.{ext}` | The raw placed asset files, decoded from their base64 content |
| `{page}_{title}.md` | The currently-open single slide |

The output format is **locked by default, not immutable**: the format and
system-prompt textareas are editable state gated behind `formatTabLocked` /
`promptsTabLocked`, both defaulting to `true`, with a Lock/Unlock toggle. Treat
the three canonical filenames and their structure as a contract — downstream
tooling consumes them.

**Slide geometry** (`prompts/rules.js`): canvas **720 × 405 pt**; margins 36 pt
left/right, 30 pt top, 35 pt bottom, 15 pt gutters; safe area x ∈ [36, 684],
y ∈ [30, 370] (648 × 340 pt of content). Frame types: `image_placeholder`,
`video_placeholder`, `infograph_placeholder`, `timeline_placeholder` (all
requiring an aspect ratio), `icon_placeholder`, and `background_image` (always
the full 720 × 405). Per-layout coordinate recipes exist for all 15 layouts,
and a boundary rule requires every frame to satisfy
`x ≥ 36, y ≥ 30, x + width ≤ 684, y + height ≤ 370`.

> **The COMPONENT GEOMETRY JSON is generated and exported but has no in-app
> renderer.** Its real consumer is external — a Google Slides automation
> extension that draws placeholder frames on real slides. `LayoutVisualizer.jsx`
> deliberately re-derives its own approximate layout from the layout type and
> asset aspect ratios; it never reads the AI's x/y/width/height values. Do not
> "fix" the visualiser to consume the JSON without knowing that.

**Attachments — today's behaviour, stated precisely because it is a known
gap.** `projectFiles` skips any document or visual asset that lacks an inline
`content` data URL, silently and with no error. In **local** mode every upload
is read via `FileReader.readAsDataURL`, so `content` is always present and
attachments work end to end. In **cloud** mode the Supabase adapter strips
`documents` / `visualAssets` from every project write and **throws** when a
patch actually carries attachment data — so cloud attachments are refused at
the write layer rather than silently lost. `adapter.downloadFile` exists on all
three adapters and has **zero call sites** anywhere in the repo. Re-homing
attachments onto the `files` table was scoped for S17 and **explicitly
re-owned to post-1.0** — it is a migration plus five wiring changes, and the
session that would have done it was reset to consolidation. The traps are
catalogued in `MASTER_PLAN.md` §6 #31 — including the polarity trap that
D.O.G.'s `isCore` defaults **true** while `files.is_core_definer` defaults
**false**, so a naive 1:1 mapping would flip every previously-unmarked file
from CORE to REF and change generation output.

### 13.2 O.T.T.E.R.

`src/tools/otter_v0.3.1/`. A two-sidebar shell over always-mounted views.

**Object model**: course → subject → section → lesson. A subject may be a
**stub** (`is_stub: true`, carrying only `section_outlines`) until its content
is generated on demand. Each course also carries five whole-document JSONB
**reference documents**: `hotkeys`, `functions`, `nodes`, `reference_urls` and
`corrections` (the last being agent memory, with no browsing UI).

**Views** (`currentView`): `library`, `prompt`, `study`, `quiz`, `hotkeys`
(dual-purpose — renders Keyboard Shortcuts for software courses and Functions
Reference for coding-language courses), `nodes`, `sources`, `requests` and
`validator`. `requests` and `validator` are conditionally **mounted** rather
than merely hidden, so that a queue fetch does not fire for every user at
launch. Sidebar 1 collapses with `Ctrl/Cmd + \`, gated on
`currentPage === 'otter'` (§13.4).

**The three visibility tiers** — stored values `personal`, `shared`,
`company_standard`:

| Tier | Read | Write | Set by |
|---|---|---|---|
| `personal` | Owner only. **No admin bypass** | Owner, admin, granted editor | Default; owner or admin |
| `shared` | Every active member | same | Owner or admin |
| `company_standard` | Every active member | same | **Admin only, in both directions**; at most one per topic |

Admins can see that a personal course **exists**, never its contents, via
`otter_course_index()` — a metadata-only RPC whose return type is guarded by a
migration post-condition. The UI renders that state as a "Private" badge and
disables the row.

**Course generation**: an outline call (Sonnet 4, 12 000 tokens, no web search)
produces subject stubs; content generation per subject (Sonnet 4, with
`web_search_20250305`, `max_uses` 1 or 3 depending on whether the user supplied
reference URLs) fills in sections and lessons and merges the reference
documents. The progress UI is time-thresholded — "Sending request…" →
"Searching the web…" → "Reviewing sources…" → "Writing…" → "Finalizing…" —
with a **"Still working…"** state past 45 s.

**Fork and the change-request lifecycle.** Using a company-standard course
**forks a personal copy** (`otter_fork_course`), so the official version stays
pristine and admin edits never change a course underneath someone mid-study.
The user can then submit a change request.

Statuses: `open`, `approved`, `rejected`, `withdrawn`, `changes_requested`.

| Transition | Who | Notes |
|---|---|---|
| `open → approved` | — | **Only** via `otter_cr_apply()`; a bare status PATCH raises |
| `open → rejected` | Reviewer | Note optional |
| `open → changes_requested` | Reviewer | **Note required** — enforced by both the trigger and a CHECK |
| `open → withdrawn` | Proposer | Terminal |
| `changes_requested → open` | Proposer ("resubmit") | `revision += 1`; reviewer stamps cleared |
| `changes_requested → rejected` | Proposer ("accept the decision") | `acknowledged_at` set; the decliner stays reviewer of record |

**Approving APPLIES the change.** `otter_cr_apply()` locks the row,
re-validates every precondition, **archives the target first** to a personal
copy owned by the approver (because O.T.T.E.R. is deliberately not
edit-history captured, so an overwrite would otherwise be unrecoverable), then
applies the proposer's live subjects **additively**: update by slug in place,
insert when absent, **never delete**. One approval must not silently strip
lessons from everyone's official course.

**What apply does not touch: the five reference documents.** Their merge
semantics live in client JavaScript; reimplementing them in plpgsql would
duplicate load-bearing logic and overwriting them would violate the
additive-only rule. So an approval moves lesson content and not hotkey tables —
and the approve dialog says so.

**The consented review window.** Submitting a request grants reviewers **read**
access to the proposer's own source course, opening on submit and closing the
moment the request settles. It is a *consented exception* to "a personal course
is private even from admins", not a bypass. Only the proposer's **own** course
can be a source — refused at INSERT, re-checked in the helper, and re-checked
again inside the apply RPC. Managers get the request row (summary, status,
outcome) but never the fork content.

**The Requests view** (in O.T.T.E.R., cloud-only tab) serves three audiences by
capability, not by role name: **deciders** (admins *and* owners of the targeted
standard course) get the full approve/decline queue with live diff counts;
**managers** get a read-only queue; **proposers** get their own requests with
the reviewer's note verbatim, sorted so `changes_requested` comes first. The
Admin Terminal keeps a parallel review section — admin work in the admin place —
and its "Open their course" button dispatches the one cross-tool event
(§13.4).

**Trash**: soft delete and restore go through RPCs (a plain UPDATE cannot,
because Postgres re-checks the SELECT policy on both sides). "Recently deleted"
is a *filter state*, not a view, served by `otter_trash_index()`. A subject
under an also-trashed course is deliberately omitted from the listing, since
restoring it would immediately be re-hidden. 30-day purge at 04:55 UTC.

**Local vs cloud**: `otterFetch` is the seam that ~90 call sites go through
unchanged. It decides by reading `workspace_id` from the JWT claim. Signed out
in Electron it falls straight through to the local Express server; signed in it
routes to the Supabase adapter; in a browser with no session it returns a
`401`/`501` with a stated reason. **In cloud mode the client-facing course
"slug" is the course UUID** — on disk a slug was `slugify(name)`, unique only
within one user's folder, and two visible courses in a shared workspace can
legitimately share one. This is safe because O.T.T.E.R. looks courses up by
name and treats the slug as an opaque key.

**Validator**: queues lessons, calls Sonnet 4 with web search (`max_uses` 5),
recursing on `stop_reason === 'tool_use'` to let search results resolve, and
produces a grade, an accuracy percentage and findings marked
`accurate` / `inaccurate` / `unverifiable`, with a follow-up "request fixes"
call. **Results are session state and are not persisted anywhere.**

**Quiz**: multiple-choice, code-identification and code-writing questions
generated by Haiku 4.5 with no web search, scored client-side. **Session 30
gave it a writer.** A finished quiz is recorded in `otter_quiz_attempts`
(migration 0045) — one personal history per (workspace, user), kept 30 days —
and the results screen says whether the save succeeded, because "Try Again"
zeroes the score and used to destroy the only copy.

> 🚨 **The old `otter_progress.quiz_attempts` column was PER-COURSE and is
> dropped.** A quiz is assembled from every course the user ticks
> (`quizSelections`), so an attempt has no single `course_id` — which is why
> the pre-existing storage path could never have worked even once it was
> called. Only `codeWrite` challenges go unrecorded: nothing marks them, and
> `quizComplete` is only ever set from the multiple-choice path.

### 13.3 R.A.B.B.I.T.

`src/tools/rabbit_v0.1.0/`. Mounted once near the top of the app by
`RabbitProvider` and kept alive across navigation.

**Object model**: project → phase → asset → task (a task may hang off an asset
*or* directly off a phase). Optional, project-toggleable modules add scenes →
shots, levels, and experiences; milestones sit directly on the project.
**Session 25 (migration 0040) gave scenes, shots, levels and experiences real
cloud tables**, so they now work identically on both adapters — the toggles
that reveal them (`projects.scenes_enabled` / `levels_enabled` /
`experiences_enabled`) became columns in the same migration, because the tabs
gate on them and adding the flags first would have unhidden views whose every
write threw. **`milestones` remains local-only** and its Supabase adapter
methods still throw with a stated reason.

**Views**: Intake, Summary, Team, Tasks, Timeline, Budget, Assets, and the
toggleable Scenes / Levels / Experiences — plus the shared Task Detail popup.
Timeline is a two-pane Gantt with drag-create/move/resize, milestone diamonds,
holidays and zoom levels; Budget is a 13-tab spreadsheet (Summary, by
Phase/Role/Asset/Scene/Shot/Level/Experience, Custom, Crew, Talent, Expenses,
Client View).

**The adapter layer is the rule.** All RABBIT data access goes through one
adapter interface with three implementations — `supabaseAdapter`,
`localServerAdapter`, `googleDriveAdapter` — and nothing may bypass it. Mode is
chosen at boot: if `hasLocalServer()` is false the mode is **forced** to
`supabase` regardless of any saved preference; otherwise the saved mode wins,
defaulting to `local_server`. Google Drive is read-only in v0.1 and its write
methods throw a generic `readOnly()`.

**Realtime and merge** — see §4.5. Presence rides the same channels; the LIVE
pill shows orange LIVE / grey SYNC / red SYNC ERR.

**Edit history** covers the 13 RABBIT tables through one append-only capture
trigger. Members below manager write history but cannot read it. The drawer
offers **revert-to-state** for four of the thirteen entity types (projects,
phases, assets, tasks): a plain update reverts by inverse patch; a
delete-labelled entry calls the restore RPC; a create is soft-deleted; a
hard-delete snapshot is recreated with its original id — impossible for
projects, since a fresh id would orphan the subtree. A revert applies the
inverse of **one** entry as the newest write; it does not rewind later edits.
Retention is 90 days.

**Soft delete, trash and undo**: seven tables soft-delete through SECURITY
DEFINER RPCs. `restore_soft_deleted()` returning `false` means the row was
already live — someone else restored it first — and callers must not treat that
as a fresh restore. Every undoable delete pushes a history entry and shows the
**undo toast** (bottom-centre, 8 s, pausing on hover, targeting its exact entry
so a click and Ctrl+Z cannot double-fire). Projects are admin-only to delete
and restore. Hard purge at 30 days.

**Project roles**:

| Role | Can |
|---|---|
| `manager` | Everything a member can, plus manage the project roster |
| `member` | Create/edit/delete entities; comment |
| `reviewer` | Comment only — reads and comments, no entity writes |

Gating order: app admin/manager bypass everything → an **unstaffed** project is
open to every active member for entity and comment writes (but roster
management always needs an app admin/manager, since the first seat has to come
from somewhere) → once staffed, the seat rules apply. Because `fn_projects_auto_staff`
seats the creator and producer on client creates, projects made in-app are
staffed from birth — so plain members no longer get write access to **new**
projects they are not seated on. That is the intent; legacy projects are
unchanged.

> **LOCKSTEP INVARIANT.** `src/permissions/projectRoleMatrix.js` mirrors the
> SQL helpers `can_write_project()`, `can_comment_project()` and
> `can_manage_project_roster()` from migration 0013. Any change to one must
> ship with the matching change to the other. The migration's
> `COMMENT ON FUNCTION` points back at the JavaScript file by name, closing the
> loop from both ends.

**Intake pipeline**: `is_core_definer` files only → text extraction (`.txt`,
`.md`, `.fountain` direct; `.docx` via mammoth; `.pdf` via the local Express
route, desktop only; `.pptx` via a JSZip slide-XML strip) → document-kind
detection (explicit → extension hint → regex heuristics → a Haiku classifier)
→ one of nine chunkers → a concurrency-3 worker pool calling Claude per chunk
with a persona block (executive / creative / technical) → fuzzy-dedup merge →
review → accept, which writes phases, then assets, then tasks through the
ordinary provider mutators so each gets undo and history treatment.

**Failure behaviour is deliberately asymmetric**: individual chunk failures are
tolerated, but if **every** chunk fails the pool throws. Removing the per-user
key gate had exposed a fake-success path where all chunks failed, produced an
empty breakdown, and reported "Intake complete".

**Budget and rate cards**: a line's subtotal is `rate × days × qty` (or
`cost × days × qty` on the travel sheet); an agency fee may be added from a
project-wide percentage and, on the talent sheet, a per-row representation
percentage — the two **stack additively**. Rate cards are **workspace-scoped**,
with a `general` and an `internal` card auto-created per workspace; an entry's
total is `wage + burden + overhead`, each of which may be a row-level percent or
fixed amount or fall back to a department default. Access is
`rate_card.view`/`rate_card.edit` from the role matrix **OR** a live per-user
grant on the member's own row — fetched fresh rather than carried in the JWT,
so a revoke is immediate, and refreshed over the workspace channel. A view-only
grant renders the card read-only rather than empty, so an RLS-scoped empty table
never masquerades as "no data".

**Files** appear in two independent subsystems: the `files` table (generic
entity attachments, all three adapters, plus the FileAudit drawer) and
**managed files** (a local-disk folder mirror under `ASSETS/`, `SCENES/`,
`SHOTS/`, driven through Electron IPC and available only on
`localServerAdapter`).

### 13.4 The shell and the shared surfaces

**The model: every page rendered, one visible.** `renderAllPages()` mounts all
eleven page components simultaneously and toggles `display`. Page ids: `home`,
`dog`, `otter`, `rabbit`, `settings`, `project-manager`, `rate-card`,
`team-members`, `dashboard`, `admin-terminal`, `help`. Navigation runs a fixed
five-phase ~2.1 s transition before flipping the visible page.

> **Two consequences that have each already caused a bug, and that any
> contributor must internalise:**
>
> 1. **Every page's effects run everywhere.** A `window`-level `keydown`
>    listener registered inside a tool fires while the user is in a different
>    tool. The correct pattern is to gate on `currentPage` — O.T.T.E.R.'s
>    sidebar-collapse shortcut does exactly this, with the reasoning in a
>    comment above it. (One ungated listener remains; see §17.)
> 2. **Every page's data hooks run for every user.** `AdminTerminalPage`
>    renders for everyone at every launch, so a page-level hook would fire a
>    `workspace_directory` RPC for every user. The rule: keep the gated
>    component cheap and push the expensive hook into a child that mounts only
>    *after* the role check — and inside that child, hand each section an
>    `isActive` prop so its own fetch waits for first activation.

(`PageShell.jsx` and `ToolShell.jsx` used to sit here unreferenced — the
shell reimplements the bar inline. Session 17 deleted both, along with eleven
other orphans totalling 1,840 lines. The main bundle was byte-identical
afterwards, which is the proof that Rollup had never reached any of them.)

**The permission framework.** `src/permissions/roleMatrix.js` holds three roles
and thirteen actions, mirrored 1:1 in a unit test that fails on any mismatch in
either direction:

| Action | admin | manager | user |
|---|---|---|---|
| `workspace.settings.read` | ✓ | ✓ | ✓ |
| `rate_card.view`, `rabbit.history.view`, `rabbit.history.revert`, `project.create`, `member.profile.edit_others` | ✓ | ✓ | |
| `admin.terminal.access`, `member.invite`, `member.remove`, `member.role.change`, `member.grants.change`, `project.delete`, `rate_card.edit`, `workspace.settings.write` | ✓ | | |

`usePermissions()` decodes the JWT directly (the claims are already in the
token; there is no need to call `getUser()`) and re-reads on
`onAuthStateChange`, so a workspace switch or token refresh propagates without
a reload. `PermissionGate` takes exactly one of `requires` (an action) or
`requiresPlatformOperator`, and renders its fallback while permissions are not
yet `ready` — so privileged UI never flashes at cold boot.

**Denied controls are SHOWN, greyed, with the reason (Session 29).** Audrey,
2026-08-04: *"keep button gray and explain why."* `GatedAction`
(`src/permissions/GatedAction.jsx`) is the one treatment; `WriteReasonProvider`
carries the sentence to the leaves so it need not be threaded through every
component signature. Before this, six R.A.B.B.I.T. surfaces HID their create
controls off a single flag and the Timeline gated nothing at all, so the same
denial produced three different experiences.

Two traps it exists to avoid, both of which look fine in review:

- 🚨 **A `disabled` `<button>` does not fire mouse events**, so a `title=` on
  the button itself is unreliable — Chrome will not show it. The reason lives
  on an interactive wrapper with the children made `inert` inside it. Native
  `title` is deliberate: there is no Tooltip component in this codebase
  (verified by grep, 2026-08-04) and the rest of the app already uses `title`.
- 🚨 **Grey must never mean "loading."** `canOnProject` returns **true** while
  `ready === false`, on purpose, so a control is never greyed merely because
  the session has not settled. `projectActionDeniedReason()` inherits that and
  returns `null` there.

> 🚨 **`ready` IS THE FIELD THAT GETS FORGOTTEN, AND FORGETTING IT IS SILENT.**
> It defaults to **true** inside `canOnProject`, so omitting it turns "the
> session has not resolved yet" into "denied" — the control disappears for
> someone fully authorised, and if `getSession()` hangs it never comes back.
> S23 fixed exactly this in `ProjectTasksView` and `ProjectAssetsView`; S29
> found the same omission still live in **three more files**
> (`TaskDetailPopup`, `DashboardTasksView`, `TeamView`), each of which passed
> the other three fields and read as correctly gated for five sessions.
> `useProjectAccess()` now assembles the context in one place, and
> `writeGate.test.js` fails on any `canOnProject()` call that omits `ready` —
> resolving both the inline-literal and named-const forms.

> ⚠️ **A GATED CREATE BUTTON DOES NOT MEAN A GATED SCREEN.** S29 found inline
> row editing completely ungated in **both** `ProjectTasksView` and
> `ProjectAssetsView` — every cell, dropdown, date, the phase header's name and
> dates, and kanban drag-drop committed through an unguarded funnel. Both files
> read as "already gated" because their *create* controls were. When auditing a
> surface, enumerate what it WRITES, not what it offers to create.

**The Admin Terminal** (`admin` only) has five sections:

| Section | Does | Calls |
|---|---|---|
| Users | Roster, role dropdown, rate-card grant toggles, MFA/last-sign-in lookup, show-once reset, deactivate/reactivate; Add People → invite or create-with-password | `admin-create-user`, `admin-reset-password`, `admin-set-active`, `admin-user-security`, `invite-member` |
| Company | Workspace name/slug/id, live member counts, departments editor; hosts **Workspace Takeout** | `workspaces` table; `otter-settings` for departments |
| Requests | The O.T.T.E.R. change-request review queue (Open / Decided) with approve and decline | O.T.T.E.R. routes via `otterFetch` |
| Logs | System (`app_events`) and Activity (`edit_history`) tabs, filtered, with expandable JSON context | Direct RLS-scoped reads |
| Diagnostics | Build/env block, live adapter + realtime status, error-code reference, test event, test Sentry exception; hosts **Storage Cleanup** | `reportAppEvent`, `storage-gc` |

**Team Members** reads `workspace_members` through the `workspace_directory`
RPC — not RABBIT's legacy local `team_members` entity. It has roster liveness
over the workspace channel, an assigned-projects column fed by a second
subscription, a Day Rate column shown only to admins with rate access, three
saved views (Admin/Manager/User) each filtered to *your role or below*, and a
roster CSV export mirroring exactly the visible columns. Deactivation prefers
the `admin-set-active` Edge Function (token revocation + last-admin guard) and
falls back to a direct write only on a bare 404 — never on a real business
error.

**Settings** has six tabs: General (workspace switcher, version panel, AI
access notice, companion, project-files root, password notice), Profile
(profile fields + avatar, plus MFA enrolment and management), RABBIT (storage
backend, storage connections, both migration panels, currency, default rate
card, task templates), Teams (departments), Agent (mode, auto-approve level,
scope restrictions, prompt editor), and Agent Skills.

> **What Settings says about passwords, on both hosts:** *"Your password is
> managed by your workspace account. Use 'Forgot password' on the sign-in
> screen to reset it, or ask a workspace admin."* There is no password input
> field anywhere in Settings. The legacy local password panel was deleted in
> Session 15 along with its routes (§3.1). (`HelpPage.jsx` was not updated to
> match — see §17.)

**Dashboard** has three tabs: My Tasks (cross-project assignments, cloud-only,
RABBIT data only in v1 — writes route through the RABBIT provider when the task
belongs to the open project so they get undo and LWW, else straight to the
adapter), Notes, and Profile (the same `ProfileSection` Settings uses). A live
workspace presence strip sits in the header.

**Notes** are the one Yjs surface. Owner-only with **no admin bypass**, not
edit-history captured, never on any realtime topic, hard delete with a confirm
(no trash), and excluded from the workspace takeout. Multi-device safety comes
from **snapshot-merge-write**, not live sync: the save is
`UPDATE … SET ydoc_state, version = v+1 WHERE version = v`; a missed guard
fetches the remote snapshot, applies it locally (Yjs updates are commutative
and idempotent, so a double apply is harmless) and retries with the fresh
version, bounded at five attempts. Snapshots are base64 in a text column via a
chunked codec — deliberately not `String.fromCharCode(...spread)` (call-stack
overflow on large snapshots) and not `Uint8Array.toBase64` (unsupported in
Electron 33's Chromium).

**The migration tools** (Settings → RABBIT) are two independent, dry-runnable,
resumable, idempotent single-user → cloud migrations. RABBIT's reads local
projects from the Express server and writes rows plus Storage blobs; after a
clean run it offers **Archive + Clear Local**, user-initiated and never
automatic. O.T.T.E.R.'s reads local courses with **raw `fetch`, never
`otterFetch`** — because `otterFetch` routes to the cloud once a session
exists, which is exactly when a migration runs, and it would copy the cloud
onto itself and report success. Everything lands as `personal` visibility: a
personal course published company-wide by a migration cannot be un-seen.
Scraped reference-page text is not migrated (url and title only) — it is a
regenerable cache of third-party content that does not belong in a shared
multi-tenant database.

**Cross-tool events.** There is exactly one: **`wilson:open-otter-course`**,
dispatched by the Admin Terminal's change-request section after probing that
the course is readable, and listened to by both `App.jsx` (which navigates the
shell) and `Otter.jsx` (which re-probes, loads and selects the course). The
Otter listener is deliberately *not* gated on `currentPage`, unlike the
keyboard shortcut, because it only ever fires from an explicit admin click and
handling it while hidden is the entire point. All other cross-component
signalling uses props, counters or context.

**Design tokens (S43).** Two shared modules, both with contrast tests that
carry FAILING CONTROLS so a regression fails a test rather than shipping:
`src/cloud/auth/AuthShell.jsx` (auth surfaces) and
`src/components/lightSurface.js` (light pages — Home, Settings, Projects, Rate
Card, Team Members, Dashboard, Admin Terminal, Help).

🚨 **Light pages are text on `#f4a261`, and the whole stone ramp fails there**
— `#a8a29e` 1.42:1, `#78716c` 2.33:1, `#57534e` 3.70:1, and `#d6d3d1`/`#e7e5e4`
are *lighter than the page*. `#1c1917` is 8.49:1. Audrey's rule: on orange,
white or black, never grey. Hierarchy comes from size and weight; emptiness
from italic. **A grey on dark stone (`#1c1917`) is correct and must stay** —
classify by the SURFACE an element sits on, not by the file it lives in. The
Admin Terminal in particular is a LIGHT page whose `#1c1917` occurrences are
mostly dark BUTTONS, not panels.

**Sign-in is COMPANY-FIRST (S43).** `LoginScreen` has four stages: `company`
(one input) → `auth` (username + password) → `mfa` → `workspace`. Step 1
validates the SLUG SHAPE ONLY and makes **no network call** — a "does this
company exist?" endpoint would be a customer-list oracle for anyone holding the
anon key, which is precisely what the rest of this screen's enumeration defence
exists to prevent. The slug rides `resolve-login`'s long-supported (and, until
S43, never-sent) `workspace_slug` field. Side effect worth knowing: that also
**repairs multi-workspace sign-in**, which was impossible before — a bare
username matching two memberships made `resolve-login` reply "miss".
`slugifyWorkspace` in `src/cloud/auth/workspaceSlug.js` is the one definition
of the normalisation (the operator console still has an inline copy).

**Onboarding is INVITE-ONLY and operator-driven (S43).** There is no self-serve
company creation on this surface — no button, no route, and no code in the app
bundle. A company is created by a platform operator in the operator console
(`Companies → New company` → `operator-workspaces` `create`), which returns a
show-once password for the first admin. `NewUserWelcome` appears whenever
`onboarded_at` is null and collects display name, pronouns, title and an
optional avatar, then stamps `onboarded_at`.

### 13.5 The pet companion and the agent

**The pet** is a persistent companion with a breed (otter, bird, octopus, blob,
rabbit, pig, monkey, and a rare demon), a life stage (`egg` → `baby`/`adult` →
`corpse` → `ghost`) and hunger/happiness stats. Two 30-second intervals run:
one applies decay, sleep, evolution and death; the other auto-saves. State
lives at `/api/pet` in Electron and in `localStorage['wilson.pet']` on the web.

> **Known and accepted:** the web stores are full-object overwrites with no
> cross-tab sync, so two open tabs both run the 30 s timers and clobber each
> other. Accepted for v1 as a one-window product — the same class as two
> Electron windows. A `storage`-event merge is the fix if it ever matters.

**The agent** is a chat companion that can propose and apply changes. Its
system prompt is per-tool and user-overridable; the registry holds both tools'
prompts and twelve skill labels.

Four action types are actually executed today, all against O.T.T.E.R.: `edit`
(single-lesson change), `bulk_edit` (a queue of them), `generate_subject` and
`generate_course`.

**The DiffView approval gate** is the load-bearing safety surface. For `edit`
and `bulk_edit`, unless auto-approve is set to `all` (or to `minor` and the
change is under 20 characters), nothing is written until the user presses
**Apply Changes** — that button is the only path that calls the tool's
`applyChange`. Word-level diffs are shown per change, original on the left and
proposed on the right. **Reject** and **Skip** never call the apply path at all,
so no undo is needed — nothing was written. Closing the modal also clears the
whole bulk queue. One control deserves care: **Apply All Remaining** loops the
apply over every queued edit with no further per-item review.

**Agent skills** persist only a `{ [tool]: { systemPromptOverride } }` map
(`agent-skills.json` in Electron, `localStorage` on the web); the per-skill
enable checkboxes live in `otter-settings` and are documentation-only today —
nothing checks them before executing an action.

> R.A.B.B.I.T. is listed as an agent tool and has its own prompt and an
> eight-action tool surface, but neither its `registerTool` call nor its tool
> factory has any call site — its agent integration is prompt-selection only,
> and the DiffView gate is exercised solely by O.T.T.E.R. (§17). D.O.G. has no
> agent integration at all.

---

## 14. Who talks to whom

Every arrow in the system, in prose. Read this section if you read nothing
else.

**Inside the desktop app**

1. **Electron main → renderer**: the main process starts a loopback Express
   server on an ephemeral port and points the `BrowserWindow` at it, so the
   renderer's own origin *is* its API origin. No port is ever passed over IPC.
2. **Renderer → local Express (HTTP, same origin)**: O.T.T.E.R. local content,
   RABBIT local project bundles, files and managed files, thumbnails, rate
   cards, team members, task templates, pet and settings, and the three shared
   utilities (URL fetch, raw fetch, PDF extract).
3. **Renderer ↔ Electron main (IPC)**: window controls, zoom, OS file and
   folder pickers, file copy with progress, thumbnail generation, Google Drive
   credentials, the local-data archive, update check/download/install, and the
   safeStorage-encrypted session slot.
4. **Local Express → disk**: `{userData}/otter-data/` and
   `{userData}/rabbit-data/`, plus the user-visible project folder when one is
   configured.

**Both hosts → Supabase**

5. **Renderer → Supabase Auth (GoTrue)**: `signInWithPassword`, the MFA
   challenge/verify pair, `refreshSession`, `resetPasswordForEmail`,
   `updateUser`. The access-token hook runs inside Auth at issuance and mints
   the four claims.
6. **Renderer → PostgREST (direct table reads and writes)**: this is the main
   data path in cloud mode, and it is safe *because* RLS is the boundary —
   every RABBIT and O.T.T.E.R. read/write, the roster, notes, logs and audit
   views all go straight to Postgres under the caller's own token.
7. **Renderer → Postgres RPCs**: soft delete and restore, the O.T.T.E.R.
   fork/apply/index family, the member directory, the trash index. These exist
   because a plain statement cannot express the check safely.
8. **Renderer → Supabase Storage**: avatar upload to `user-avatars`, project
   file upload and download in `rabbit-files`.
9. **Renderer → Supabase Realtime (websocket)**: joins
   `rabbit:project:{id}` and `rabbit:workspace:{id}`, authorised once at join
   time; receives full old/new row payloads and presence.
10. **Postgres → Realtime**: `AFTER` triggers call `realtime.broadcast_changes`
    on 10 project-scoped and 5 workspace-scoped tables.

**Both hosts → Edge Functions**

11. **Renderer → `resolve-login`** (unauthenticated) and **→ `issue-session`**
    (bearer token) during sign-in and workspace switching.
12. *(was `provision-workspace` from the new-company wizard — removed in S43;
    the app makes no unauthenticated call other than `resolve-login`.)*
13. **Renderer → `invite-member`, `admin-create-user`, `admin-reset-password`,
    `admin-set-active`, `admin-user-security`** from the Admin Terminal and
    Team Members, each with the caller's bearer token.
14. **Renderer → `storage-gc`** from Diagnostics, on an admin's click.
15. **Renderer → `ai-proxy`** for **every** AI feature in all three tools, the
    companion and the agent — the single path to Anthropic.
16. **Operator console → `operator-workspaces` / `operator-ai-keys`**; and,
    uniquely, **operator console → PostgREST directly** for the
    `platform_audit` read, gated by RLS alone.

**Edge Functions outward**

17. **Every Edge Function → Postgres as `service_role`** — bypassing RLS, which
    is why each one re-checks a live row itself.
18. **Edge Functions → GoTrue admin API**: create user, update user, invite by
    email, list MFA factors, ban, sign out.
19. **`ai-proxy` → `api.anthropic.com`** with a per-workspace key (decrypted
    from `workspace_ai_keys`) or the platform key, always streaming.
20. **`operator-ai-keys` → `api.anthropic.com`** for a one-token validation
    call when a company key is set.
21. **`operator-workspaces` → Supabase Storage** to sweep `rabbit-files` during
    teardown.
22. **Supabase Auth → Resend (SMTP)** for invite, recovery and email-change
    mail.

**Scheduled and out-of-band**

23. **pg_cron → Postgres**: the five nightly purge functions.
24. **GitHub Actions → `wilson-dev`**: the issue-session smoke probe and the
    Playwright lanes.
25. **GitHub Actions → Backblaze B2**: nightly `pg_dump` upload, from the
    default branch.
26. **Vercel → GitHub**: builds both surfaces on every push to the production
    branch, with staging's URL and anon key as build-time variables.
27. **electron-updater → Backblaze B2**: checks the generic feed at login and
    downloads the NSIS installer on request.
28. **Renderer and Electron main → Sentry**, independently, per environment.
29. **RABBIT (desktop) → Google Drive API**, read-only, using tokens held in
    `rabbit-data/`.

**Arrows that deliberately do not exist**

- No client → Anthropic. Ever, on either host.
- No desktop app → operator console (it is not in the build).
- No cross-tenant table read except `operator_workspace_summary()`.
- No `postgres_changes` subscriptions.
- No customer content → Backblaze B2.
- No O.T.T.E.R. or Notes content on any realtime topic.
- No O.T.T.E.R. or Notes content in the company takeout.

---

## 15. Testing and verification

**pgTAP** — 55 suites under `supabase/tests/rls/` (Session 20 added 39–42, one
per model control-plane table; **Session 24 added 43–47, one per money table;
Session 25 added 48–51, one per entity table; Session 26 added 52_folders;
Session 27 added 53_money_segments; Session 28 added 54_task_templates;
Session 30 added 55_otter_quiz_attempts; Session 31 added 56_user_pets and
57_user_settings**; the CI coverage guard globs `*_<table>.sql`, so a table
cannot share a suite file with another — and S31 notes the corollary, that the
guard is satisfied by any file whose name ENDS with the table name, so a suite
must be named for its table exactly), **902 assertions** — run in CI against a
fresh local stack.

> 🚨 **53_money_segments is the first suite covering no table of its own** —
> it pins `storage.objects` policies and the `rabbit_money_segment` predicate.
> The coverage guard globs by TABLE name, so a suite like this is invisible to
> it and nothing would have complained had it been left out of the
> failure-replay list in `rls.yml`. It was added there by hand. Any future
> suite that is not named after a table has the same blind spot.
(0038 added four to the existing `05_files` suite rather than a new file: it
adds no table, so the coverage guard's `*_<table>.sql` glob still resolves.)
Coverage spans the 13 RABBIT tables, membership and provisioning, the member
directory, edit history, project members, soft delete, both realtime channels,
admin grants, `app_events`, the five O.T.T.E.R. tables plus trash and
change-request apply, the file lifecycle, the four model control-plane tables,
the five budget tables, and the four
Session-15 suites (AI keys, platform audit, rate limits, workspace write
lockdown).

> These counts were **629 / 42 suites** until 2026-08-03, and 717 for the few
> hours between S24's two commits, and had been stale
> since S22 — this section is a **gate, not an oracle** (S21 corrected its
> suite counts, S22 its migration range and SECURITY DEFINER count, S24 its
> assertion count again, S26, S27 and S28 the suite and assertion counts once
> more, S30 both again, S31 both again). Both figures here are measured,
> 2026-08-05, by `node scripts/tap-all.mjs` against wilson-dev: **57 suites,
> 902 planned, 902 passed, `collected == planned` on every one.**
> **Check the code.**

> 🚨 **A SUITE THAT HAS ONLY EVER PASSED IS A SUITE YOU HAVE NOT TESTED.**
> S27 ran four deliberate breakers against 0042/0043; S28 ran six against 0044
> and **two of them did not fire — both corrected a COMMENT rather than the
> code.** Removing `WITH CHECK` from an UPDATE policy changes nothing, because
> Postgres reuses `USING` as the new-row check; the real hazard is a `WITH
> CHECK` that is merely *weaker* than `USING`, which is the shape most UPDATE
> policies in this schema already have. Write the breakers you expect to pass
> as well as the ones you expect to fail: the first kind is how a confident
> sentence in a migration header gets checked.
>
> 🚨 **S30 went one better: the suite failed on its FIRST run and the
> MIGRATION was wrong, not the test.** 0045 put a 30-day retention window in
> `otter_quiz_attempts_select` so the promise would be a database guarantee.
> Probe pair came back `have: 2 want: 1`, because **PostgreSQL applies SELECT
> policies to an UPDATE or DELETE whenever the statement reads rows for its
> WHERE clause** — so the window hid expired rows from the very statement
> meant to prune them, and "wiped every month" would have shipped meaning
> "hidden every month and kept forever". `otter_prune_quiz_attempts()`
> (SECURITY DEFINER, no arguments, hardcodes `auth.uid()`) exists solely
> because of that, and probe 15 pins the refusal the ordinary path gets so
> nobody deletes the function believing it redundant. **A window in a SELECT
> policy is not free: check what else has to read those rows.**

**Money arithmetic** — `src/components/Budget/budgetMath.js` is the single
definition of the rules that decide what a production is bid at: the
project-default **fallback** (NULL inherits; an explicit `0` does not), margin
and contingency applied **independently to the base** rather than compounded,
and rate resolution as *project override → workspace rate card → blank*. Pinned
by 24 vitest cases, which were proven by breaking the source three ways. Before
Session 24 those rules were duplicated inline across four view files with no
test at any layer.

**Vitest** — **43 files, 909 cases** (measured 2026-08-05; this line read "15
suites, 343 cases" for several sessions), all pure modules: the SSE
reassembler, invite parsing, dashboard task model, note sync, CSV export, both
permission matrices, O.T.T.E.R. route parsing and sharing rules, project
attachments, edit-history formatting and revert, the relink matcher, the
realtime merge layer, money arithmetic, the adapter column allowlist, entity
naming, folder paths and folder parity, the project manifest, Session 27's
project rates mirror and upload scope, Session 28's `taskPayloadKeys`,
Session 29's `writeGate` plus the denial-reason half of the project matrix,
and — Session 30 — `validatorSave`, `quizWiring` and `textFromMessage`.

> 🚨 **NEVER READ `data.content[0].text`. Use `textFromMessage(data)`**
> (`src/cloud/anthropicStream.js`). These models think when nothing asks them
> to (S19 measured `thinking` omitted → `thinking=1`), `ai-proxy` pipes the
> stream through untouched, and the reassembler assigns every block to its own
> index — so `content[0]` is a **thinking** block and `.text` is `undefined`.
> Audrey's first beta course died on *"Failed to parse course outline JSON"*
> while `stop_reason` was a healthy `end_turn` and the answer sat in
> `content[1]`. It was **eight call sites across three tools**; a source scan
> in `textFromMessage.test.js` now fails the build if one returns.
> Position-indexing was only ever right by luck — `server_tool_use` and
> `web_search_tool_result` blocks also precede text.

> 🚨 **ANY CALL CARRYING A SERVER-SIDE TOOL MUST RESUME `pause_turn`.**
> Anthropic pauses a server-side tool run (here `web_search_20250305`) at its
> iteration limit; the turn ends on a `server_tool_use` block, so the last text
> block is a preamble and every JSON parse downstream fails **on a request that
> succeeded**. Resume by re-sending with the ASSISTANT turn appended and no
> trailing user turn — S19 measured a prefill returning 400 — and bound the
> loop. `Validator.jsx` (S19) and `Otter.jsx` (S30) both do; `pauseTurn.test.js`
> keeps them that way. **The diagnostic asymmetry: a no-tool call that works
> beside a web-search call that fails is this, not a prompt problem.**
>
> 🚨 **`src/lib/localData.js`'s THREE SAVERS THROW — changed S30.** Its header
> used to say "every function resolves rather than throws", and that is what
> made the pet's failures invisible: `savePetData` did not check `res.ok` on
> its Express POST and `writeLocal` swallowed every localStorage exception
> (quota exhausted, Safari private mode, enterprise policy), so `App.jsx`'s
> `catch { /* silent */ }` could not fire even in principle — three layers of
> silence over one lost pet. **READERS still resolve to defaults**, so a broken
> store degrades rather than taking a screen down. Callers must handle a
> rejection and SHOW it; `Otter.jsx`'s `saveSettings` needed a catch it did not
> have, because two of its call sites drop the promise.
>
> Every O.T.T.E.R. parse failure carries `describeResponse(data)` —
> `[stop_reason; blocks; chars of text]` — because "Try again" was the same
> sentence for a paused tool run, an empty response, a refusal and malformed
> JSON, and two distinct defects hid behind it in one evening.

> 🚨 **THE LAST TWO ARE CALLER GUARDS, AND THAT IS A DIFFERENT JOB FROM THE
> REST OF THIS LIST.** `otterRoutes.test.js` asserted that the parser maps
> `/api/software/:slug/quiz-history` onto `quiz.put`. It was correct, it
> passed for twenty sessions, and **nothing ever requested that URL** — the
> whole quiz feature was plumbing with no tap. Four features have now shipped
> in that state (the folder tree S27, task templates S28, quiz history S30,
> and `setOtterAdapterMode`, which is still dead). A test that pins a
> MECHANISM cannot tell you the mechanism is reached; `quizWiring.test.js`
> asserts that `nextQuestion` actually calls the writer, and fails if the call
> is removed while every other test stays green.

> ⚠️ **WHAT `writeGate.test.js` CANNOT SEE, stated because a green suite here
> reads like proof.** Nothing in this suite mounts React, so it can assert that
> a surface REFERENCES the gate and passes `ready`, but not that a denied
> control actually renders greyed. Proven, not assumed: deleting `GatedAction`'s
> dimming entirely leaves **803/803 passing**. The appearance needs a signed-in
> session, which nothing here automates.
>
> The other half of that lesson is why the guard requires the gate to be
> **called**: its first draft asserted only that `TimelineView.jsx` mentioned
> `useProjectAccess`, and replacing the call with `const canWrite = true` while
> leaving the import in place kept all five assertions green — the exact defect
> S29 existed to fix, reintroducible in one line.

> 🚨 **AN ALLOWLIST TEST PINS THE MECHANISM, NEVER THE CALL SITE**, and the
> difference is a whole class of bug. `columnAllowlist.test.js` proves
> `toColumns` drops `role_slug` and keeps `assigned_role_slug`. It says nothing
> about which key a caller sends — so the template branch could send the wrong
> one, have it dropped with a console warning, create tasks with **no role**,
> and leave every allowlist test green. `taskPayloadKeys.test.js` is the
> source-level guard for the other half (the shape `noHardcodedModels.test.js`
> established), and it is narrow on purpose: it reads the argument object of
> `addTask()` calls and nothing else, because `role_slug` is a legitimate key
> inside the template jsonb AND a real column on `budget_lines`. A blanket scan
> would be wrong in both directions.

> 🚨 **What this suite CANNOT tell you.** Nothing in it MOUNTS a React
> component; there is no `@testing-library` in this repo. S26 shipped an app
> that rendered a blank page while 658 vitest cases, 52 pgTAP suites and two
> production builds all passed, because a `useCallback` dependency array named
> a `const` declared below it and dependency arrays are evaluated **during
> render**. Playwright is the only job that can see that. See §17.

**Playwright** — two projects. `chromium` covers sign-in → home with an
RLS-scoped directory, the admin invite flow, and forgot-password. `chromium-web`
runs against a real built web bundle and covers deep links, history sync and
signed-out deep links.

**pgTAP without Docker.** The development machine has no Docker, so
`supabase test db` only runs in CI. `scripts/tap-hosted.py` bridges the gap:

```bash
python scripts/tap-hosted.py out.sql [migration.sql] suite.sql
supabase db query --linked --file out.sql
```

It emits one self-contained script that builds a collector schema, redefines
every pgTAP function the suites use, strips the suite's own transaction
control, and always `ROLLBACK`s — nothing is ever committed. Passing a
migration *before* the suite tests an unapplied migration together with its
suite in one rolled-back transaction.

> **The rule that makes it trustworthy: `collected` MUST equal `planned`.** A
> pgTAP function the shim forgot to rewrite still executes and still burns a
> plan slot, but never reaches the collector — so it vanishes from the pass
> count. If the two numbers differ, the run is *lying about coverage*, not
> merely failing.

**pgTAP traps learned the hard way** — worth carrying into any new suite:

- `throws_ok(sql, arg2, arg3)`: a 5-character `arg2` is treated as a SQLSTATE
  and `arg3` becomes the expected *message*. Use the message form.
- The `tests` schema is runner-only. De-authenticate before a mid-file
  `tests.login_as` with a claims reset and `RESET ROLE`; calling
  `tests.logout()` while `authenticated` is a 42501.
- Inside one test transaction `now()` is **frozen**, so retention probes need a
  *negative* interval.
- Hosted `storage.protect_delete()` blocks direct SQL DELETE on
  `storage.objects` — pin storage policies via `pg_policies` and probe writes
  by INSERT only.
- Re-running an edited-but-applied migration on dev needs
  `supabase migration repair --status reverted NNNN` then
  `db push --include-all`.

**Two general lessons the test suite itself taught:**

1. *"The server is done" is only true if a client can reach every state the
   server supports.* A soft delete with no listing RPC is a one-way door, and it
   read as complete because the write path was fully pinned.
2. *Beware fixtures more careful than the client.* 94 passing probes missed a
   non-functional editor grant because every fixture supplied a column by hand
   that the real client correctly omitted.

---

## 16. Security posture

The current position, from the 2026-07-30 TPN re-audit (`TPN_AUDIT/`, MPA
CSBP 5.3/5.3.1):

**Shield tier eligibility: None — but for the first time the blockers are
countable rather than structural.** All three of the April baseline's
immediate-action items are closed. Authentication moved from a single shared
password to Supabase Auth with TOTP, a four-tier role model and RLS-enforced
RBAC pinned by pgTAP in CI. Content lifecycle went from nothing to an
append-only per-file event stream with deletion certificates that outlive the
workspace they belonged to. The Anthropic key is out of client storage
entirely. Six baseline findings are resolved outright and nineteen materially
reduced. Counts: 3 CRITICAL, 43 HIGH, 31 MEDIUM, 7 LOW, 1 INFO, 6 RESOLVED.

**The honest framing for a studio conversation:** the *technical* controls have
improved enormously and are close to defensible; the *organizational* ones —
policies, vendor risk, incident response, supply chain — are essentially
untouched, and those are where a Silver or Gold assessment spends most of its
time.

**One open critical remains, and it is owed to a human:**

1. **A live workspace-admin credential for `wilson-dev` was published in this
   public repository.** Session 15 removed every occurrence from the working
   tree and rewrote the instructions that told operators to rotate the password
   *back* to that literal — which is why it stayed valid for eleven sessions.
   **The value is in git history permanently, so rotation is the only remedy**
   (`docs/OWED_AUDREY.md` §0). No code change can close this one.

**Closed in Session 17** — *Privilege changes are unaudited* (TPN-LOG-005).
Migration 0030 adds `trg_ws_members_audit`, a SECURITY DEFINER capture trigger
writing every role promotion, deactivation and rate-card grant into the
server-reserved `app_events` `'admin'` stream (`WIL-4105` / `WIL-4106` /
`WIL-4107`). It fires only when `app_role`, `is_active` or a rate-card grant
actually changes, so profile edits do not bury the four transitions that
matter. Note the coverage boundary: Edge Functions that change privileges run
as `service_role` with no `auth.uid()`, so the trigger records those with a
NULL actor while `logAdminEvent` records the real one — `context.source` and
`context.db_role` exist to correlate the pair.

Session 17 also closed a defect the S16 handbook review had surfaced but that
no audit pass had: **`custom_access_token_hook` was executable by `anon`**, not
merely by any signed-in caller. Since it takes its target user id from the
caller-supplied argument, the public anon key alone was enough to compute any
user's full claim set. See §4.9's `0011` → `0030` ordering rule for why it had
been silently re-granted.

**Named strong points**: table-layer tenancy (Cloud and Content are the
strongest domains); four append-only RLS-enforced audit streams; per-tenant AI
keys as correctly-implemented AES-256-GCM with a 32-byte key check and a
per-record IV; and the operator tier's SQL-only grant.

**Named weak points**: logging has no aggregation, no alerting, and sign-in and
operator-console access are unlogged; `app_events` and `edit_history` purge at
90 days against a 1-year requirement; the local Express server's bare CORS and
unvalidated URL fetchers; the public `user-avatars` bucket's unconditional
SELECT; Google OAuth material stored in plaintext on disk despite safeStorage
being correctly wired for the session; and Third-Party and Documentation, which
have not moved since April.

---

## 17. Known limits, and where they are tracked

Everything below is *known*, not discovered by a reader. The live list is
`docs/MASTER_PLAN.md` §6; TPN findings live in `TPN_AUDIT/FINDINGS.md`; owed
human actions live in `docs/OWED_AUDREY.md`; **everything currently broken and
unfixed is `docs/OUTSTANDING.md`** (S19), which is the one to read at the start
of a session — this section is limits by design, that file is faults.

**AI generation (S19)**

- **`ai-proxy` streams through a Supabase Edge Function with a ~150s deadline,
  and a call that overruns loses its stream rather than degrading.** It is a
  cliff, not a slope. This became live in S19: the replacement model thinks
  before answering where Sonnet 4 did not, which put D.O.G.'s full-deck call at
  a measured 137.9s until `effort: 'medium'` brought it to 69.1s. Any new call
  site with a large `max_tokens` should be timed, not assumed — and effort is
  the lever, set on the REGISTRY entry (§ ai-proxy).
- **The ai-proxy body whitelist drops unknown fields silently.** Adding a
  parameter at a call site does nothing until it is added to the Edge Function
  too, with no error to say so. This cost S19 a probe control before it was
  spotted.

**Files (S27)**

- **There are still THREE file stores, and only two are live.**
  `public.files` + the `rabbit-files` bucket is the real one on Supabase and
  Local Server. `managedFiles` is **local_server-ONLY** — versioned records
  beside real files on disk, reached through `window.electronAPI.rabbit`.
  `project.documents` / `visualAssets` are base64 data-URLs on the project row,
  written only on Local Server; the cloud adapter **refuses** a create or
  update carrying them (S15's `ATTACHMENTS_MSG`) rather than dropping them
  silently. FileManager picks a store via `ctx.supportsManagedFiles`.
  🚨 **Do not gate on `window.electronAPI` to decide this.** It is true
  whenever WILSON runs as a desktop app, *including when the selected backend
  is Supabase* — which is exactly why files were unreachable from every entity
  surface in cloud until S27.
- **A file has two independent axes.** `folder_id` says where it is FILED (a
  row in the 0041 tree); `scene_id`/`shot_id`/`level_id`/`experience_id`, like
  `phase_id`/`asset_id`/`task_id` before them, say what it is ABOUT. They agree
  by construction because `uploadFile` derives the folder from the container
  entity — one writer. A task attachment legitimately lives in its asset's
  folder, which is why the task does not move it.
- **All file links are `ON DELETE SET NULL`.** Deleting a scene, or a folder,
  must not delete the file ROW: the blob stays in the bucket and the row is the
  only thing that knows where it is.
- **Cloud deletes are SOFT and the blob is deliberately left in place** (0014);
  blob GC remains a documented known gap.

**Video (S40) — §12.7c carries the detail**

- 🚨 **The local Express server has NO authentication**, and since S40 it serves
  **original media bytes** with Range support, not just manifests and 256px
  derivatives. Loopback-bound, `cors()` with `Access-Control-Allow-Origin: *`,
  ~94 routes. Tracked in `OUTSTANDING.md`; the fix is a per-launch bearer token
  and it is its own session.
- **s3 video playback and s3 still-display are deferred**, matching S44's
  decision for images: no batch presign, a 300 s presigned-GET expiry against a
  3600 s Supabase one, and no S3 workspace anywhere to verify either against.
  **Generation ships regardless — it is the one-way door.**
- **Professional codecs need an ffmpeg binary that is deliberately not in git**
  (the repo is public). Browser-native formats work with no binary at all.
- **`canThumbnail()` refuses video on purpose.** The video decoder is a separate
  entry point; widening that gate silently disables every video preview.

**The workspace drive (S34/S35)**

- **A changed drive reaches other machines at next launch/sign-in** — no live
  re-broadcast — and **the web Admin Terminal cannot probe reachability or
  detect mapped drives**; both are stated in the UI rather than papered over.
- **The drive feeds the same synchronous fs calls every root always has**, so
  a NAS that dies after passing its configuration-time probe can stall the
  main process for the SMB timeout. Async resolution is S40/S42-scale work.
- **"Root unknown because the read failed" is not a modelled state** —
  last-known-good stands in for it (a transient Supabase blip must not
  retarget a machine onto its local default; the split-storage failure is
  worse than a visible one).
- **The 0049 folder guard reads the app-role claim only** — a project manager
  holding app role `user` cannot set their project's folder. Deliberate (the
  drive's layout is workspace storage, not project content); if beta shows
  project managers need it, `fn_project_folder_root_guard` and
  `canSetProjectFolder` change together.
- **The folder controls are desktop-only and the client seat is cloud-only.**
  Both Change buttons need the OS directory picker, so they render only in
  the desktop app (§5f); and `canSetProjectFolder` is keyed on `workspaceId`
  — a `local_server` / signed-out solo desktop has no roles, so the Express
  containment check is the only gate there, by design.
- 🚨 **`files_dir` OUTRANKS `folder_root`** in `resolveProjectFilesDir`, so it
  carries the same boundary weight. The generic project routes may only
  CLEAR it (the reset control) or pass it through unchanged; the guarded
  relink-apply route is its one writer. A guard on `folder_root` alone is
  bypassable — that was a confirmed HIGH in S35's own review.
- **Remote access is the customer's VPN or NAS relay, never a WILSON
  service** — §12.7 is the setup guidance, TS-2 is the TPN control, and the
  UNC-form check against a real NAS is owed before this is promised to a
  customer.

**Petal cloud is metered and gated (S41, migrations 0055 + 0056)**

- 🚨 **`petal_storage_quota_insert` is the schema's FIRST `AS RESTRICTIVE`
  policy**, and it had to be: `rabbit-files` INSERT already carries two
  permissive arms, and permissive policies OR together. Measured as a breaker —
  dropped to permissive it does not merely fail to meter, its own money
  exemption becomes a GRANT and admits a write `rabbit_files_money_insert` was
  refusing. **One keyword re-opens what 0038 shipped and 0039 closed.**
- 🚨 **A RESTRICTIVE policy is evaluated for EVERY INSERT into
  `storage.objects`, not just the bucket it is about.** Three buckets share that
  table, so the predicate is written to PASS for everything it is not about
  (`bucket_id <> 'rabbit-files' OR …`). Without that leading arm, a company
  over its media quota stops being able to upload AVATARS.
- 🚨 **NULL-safety INVERTS under a restrictive policy** — a NULL denies rather
  than leaking. `SUM()` over zero rows is NULL, so a dropped `COALESCE` refuses
  the first upload into every new workspace and looks exactly like the quota
  working. Post-condition and suite probe 18 both pin it.
- **The meter reads `storage.objects.metadata->>'size'`, not
  `files.size_bytes`.** Measured on staging: `rabbit-files` held an object while
  `public.files` held ZERO rows, so a files-derived total reads 0 while real
  bytes sit in the bucket. `size_bytes` is also client-supplied and in
  `FILE_COLUMNS`. **This is the first reader of that column in the repo.**
- **`rabbit-files` + `rabbit-thumbnails` are metered; `user-avatars` is not.**
  The gate is on `rabbit-files` INSERT only. Suite 65 pins BOTH directions —
  dropping thumbnails from the bucket list is caught by probe 25, which exists
  because the exclusion had a probe and the inclusion did not.
- **Money paths and the project manifest are EXEMPT from the gate.**
  `FINANCE/RATES.json` is a mirror rewritten on every rates change, invoices are
  how a company pays Petal, and the manifest is WILSON's own bookkeeping.
  ⚠️ The manifest exemption tests the FILENAME as well as the depth: `[3] IS
  NULL` alone would let `projects/<id>/dailies.mov` through, a whole object at a
  time.
- ✅ **The predicate WEIGHS the incoming object: `used + incoming <= quota`
  (0057).** S41 shipped `used < quota` deliberately, and it was right while the
  per-object cap was 50 MB — the overshoot was bounded and trivial. At 50 GiB
  the same shape let a brand-new free-tier workspace land an object fifty times
  its whole allowance on its first upload, so the argument that made it correct
  is the argument that made it wrong. Suite 66 probes 14, 17 and 18 pin the
  refusal, the acceptance and the `<=` boundary.
- 🚨 **The incoming size is read from `metadata->>'size'` OR
  `->>'contentLength'`, and reading only the first breaks every resumable
  upload.** storage-api checks permission twice — a rolled-back trial insert at
  upload creation, then the real write at completion — and the trial carries
  `contentLength` while the committed row carries `size`. A `size`-only read is
  NULL at creation, and **under a RESTRICTIVE policy a NULL DENIES**. Suite 66
  probe 15 is the tripwire; probe 16 pins the converse, that an unknown size
  falls back to `used < quota` rather than refusing.
- 🚨 **The free tier is 5 GiB (0057), raised from 1 GiB.** A 1 GiB trial cannot
  hold one clip next to a 50 GiB per-file cap. The number lives ONLY in
  `storage_free_tier_bytes()`; the client reads the resolved figure back from
  `workspace_storage_usage()`.
- ✅ **CONCURRENT uploads can no longer exceed the quota (0073, Track C).** A
  resumable upload RESERVES its bytes in `public.upload_reservations` before
  `tus.Upload.start()` — `reserve_upload_bytes(path, bytes)`, SECURITY DEFINER,
  evaluating the SAME predicate as the policy under a per-workspace advisory
  lock — and `workspace_petal_bytes()` adds active reservations to the total
  the RESTRICTIVE policy weighs, so the second of two uploads that together
  exceed the quota is refused at START, with the standing over-quota sentence
  (HTTP 402 through PostgREST, SQLSTATE `PT402`). 0057's attempt metered a
  table TUS never writes; suites 66/13 and 77/48 both assert that meter still
  does not move (live on the hosted projects; CI's stack starts without
  storage-api, so there both inserts are skipped and the probes are controls
  only). **Two things that had to be true at once:** the policy now
  passes the object's own key (`rabbit_petal_storage_ok(project, incoming,
  path)`) so an upload's own reservation is never weighed against it, at the
  tus trial insert or at completion; and the reservation arm EXCLUDES any
  reservation whose object has landed, so object and reservation are never both
  in `used` for the same instant, whatever the client does next — suite 77
  probes 23–27 (23–25 failed by breakers B2/B3 before 0073 touched dev; 20,
  26–27 and 30 by the review round's breakers against dev and staging — the second C1
  hand-off has the table). **Limits, both directions:** only the
  resumable path (bodies over 50 MiB) reserves — a standard PUT lands in one
  request and is weighed as it lands; a reservation lasts 24 h (Supabase's own
  TUS URL expiry, past which the upload cannot complete anyway) and a lapsed
  one cannot admit an over-quota object because the policy re-weighs at commit;
  reserved space shows as USED in `workspace_storage_usage()` and the operator
  summary until the upload lands, is released, or expires; a database without
  0073 makes the client upload UNRESERVED (PostgREST `PGRST202`, said in the
  console) with the policy still gating at commit — exactly the pre-0073
  behaviour, never a refusal. An abandoned upload's reservation expires and is
  certified `upload_abandoned` by the sweep (§12.4): the certificate names the
  abandonment, not the disposal of bytes, which SQL cannot see. **How a
  reservation closes (0074, Track C / C2, Audrey's rulings of 2026-09-07):**
  the upload lands → `release_upload_reservation` (`released`; the meter had
  already stopped counting it). The upload FAILS with an error the server
  answered (a 5xx, the session expired mid-way) → the client calls
  `abandon_upload_reservation(path, reason)`, which closes the row `abandoned`
  and writes the `upload_abandoned` certificate AT ONCE with the error text
  (ruling 1; a "failure" reported after the object had in fact landed closes
  `completed` and certifies nothing). The NETWORK dropped → neither RPC can
  cross it; the row expires at 24 h and the hourly sweep certifies it, as does
  a closed tab, a crash or the app quit mid-upload. The person next opens
  Files → `release_stale_upload_reservations(keep)` closes their OWN open rows
  except the keys that tab is still uploading, WITHOUT a certificate (ruling 2:
  those rows lose theirs — so a closed tab no longer holds its bytes for a day
  against the same person's retry). The company is torn down →
  `sweep_open_uploads` closes every open row before the CASCADE and the
  abandoned paths are certified in `platform_audit` as `WIL-7012` (§5). **Two
  stated limits:** a second browser tab cannot see the first tab's in-flight
  keys, so opening Files in tab B while tab A uploads releases A's row early —
  the policy still refuses an over-quota object at commit, so the cost is a
  late refusal, never an over-quota object; and there is NO per-person cap on
  active reservations (ruling 3): a member who can write one project can
  reserve the whole quota under fabricated keys until the 24 h expiry, which
  is the bound. A database with 0073 but not 0074 makes the client fall back
  to release on failure (PostgREST `PGRST202`, said in the console) and answers
  0 to the stale release — the pre-0074 behaviour, never a refusal. And both "landed" tests — the meter's
  exclusion arm and the sweep's classification — key on the object's CURRENT
  name (`storage.objects.name`, then `files.storage_path`): nothing renames a
  Petal object today (a move is a `folder_id` change), but a future rename
  inside a reservation's 24 h would make an unreleased row count again and let
  the sweep certify a completed upload as abandoned; the durable alternative,
  if renames ever ship, is the `uploaded` `file_events` row, which snapshots the
  path at upload time. The client's courtesy check (`classifyUpload`) reads the
  same `usedBytes` and so refuses the second of two concurrent clips FIRST,
  with the same "uploads in progress" sentence — the server's refusal is the
  one a direct REST caller meets. And the reservation is written by the
  CLIENT: an older desktop build, a stale web bundle or a direct call to the
  storage REST API uploads unreserved and is gated only at commit, exactly as
  before — the policy is the enforcement; the reservation is the early answer,
  and it protects everyone else's uploads from the one that wrote it.
- ✅ **Invoice activity is hidden from non-managers (0074, Track C / C2,
  Audrey's ruling 22).** `file_events.is_financial` is snapshotted at capture
  by one definition — the `files` row's flag OR a row-shaped key under
  `INVOICES/` / `FINANCE/` — and `file_events_select` shows a flagged row to a
  non-money reader ONLY as its `purged` certificate; workspace admins and
  project managers (`can_access_project_money`) see every event, and
  `log_file_downloaded` flags an invoice read the same way. Suite 78 (49
  probes, ten breakers, each failing the probes it was built to fail).
  **Limits, both directions:** the flag is a SNAPSHOT — a file that becomes
  financial LATER keeps its earlier events unflagged, and a purged invoice that
  lived outside a money segment before 0042 stays unclassified (its certificate
  is visible to everyone anyway); a plain member simply sees fewer rows — there
  is deliberately NO "hidden rows" indicator, because an indicator is an
  existence oracle for invoices; and a workspace admin's money visibility rides
  the JWT role (0026's read-only rationale), the same basis as the admin arm
  beside it. Replaying 0027 or 0047 after 0074 would revert part of this;
  0074's post-conditions 3–5 are the tripwires.
- 🚨 **DELETING FILES DOES NOT FREE SPACE.** A cloud delete is soft (0014) and
  `storage-gc` refuses a trashed row for 30 days, while the meter reads
  `storage.objects`. Every over-quota message says so, because the obvious
  advice ("remove some files") is a remedy that cannot work.
- **`workspace_petal_bytes(uuid)` is service_role-only (0056).** It takes an
  arbitrary workspace id and does no membership check — deliberately, since the
  policy needs it unfiltered and SECURITY DEFINER is what stops the total
  depending on who asks. Clients read `workspace_storage_usage()`, which
  self-gates. ⚠️ **A RESTRICTIVE denial reports a different Postgres message
  than a permissive one — it NAMES the policy.** Measured at the SQL layer only;
  whether storage-api forwards it to a browser is untested, so nothing parses it.
- ⚠️ **`operator_storage_plan_summary()` calls `workspace_petal_bytes` once per
  company, and that aggregate is an unindexable scan over both buckets.** Fine
  at today's tenant count; it is the operator console's default screen and is
  re-fired after every write, so it is the first thing to watch as companies or
  objects grow. Not addressed.

**The storage provider registry (S36, migration 0050)**

- **S36 built the registry and NO provider.** `workspace_storage_provider_chk`
  lists only `petal` and `network`; suite 60 asserts `gdrive` and `s3` are
  still REFUSED. That is the session's promise, not an omission — see §12.1a.
- 🚨 **Postgres reports a CHECK violation by the ALPHABETICALLY FIRST
  constraint name, not the one declared first** (measured on dev, 2026-08-07),
  and `throws_ok` matches `SQLERRM` exactly. A new constraint can therefore
  steal an existing suite's expected message and the failure reads as
  unrelated. `workspace_storage_root_provider_path_chk` is named for its sort
  position; suites 58/59 also name `provider` in every fixture so each probe
  violates exactly one constraint.
- **The provider is not yet plumbed into the upload decision.**
  `supabaseAdapter.uploadFile` passes `WORKSPACE_PROVIDERS.PETAL` as a
  constant, because that adapter IS Petal cloud. S37 changes that one argument
  to the workspace's configured provider; it does not add a branch.
- **`rabbit:set-workspace-root`'s IPC payload is still `{rootPath, rootKind}`**
  with no provider, and that is currently correct: the only provider that has
  a filesystem root is `network`, and 0050 refuses a `root_path` under any
  other one, so a pathless provider pushes null by construction.
- **A project folder under a non-filesystem provider is refused, not
  modelled.** `fn_project_folder_root_guard` (0049) already fails closed when
  `root_path IS NULL`, which is both staging's live row today (an admin
  mid-setup) and the shape every bucket-backed provider will carry. Suite 60
  probe 31 pins it. No 0049 change was needed.
- **`provider_config` has no reader yet.** It exists so S37 cannot add flat
  per-provider columns, and its CHECK is written as the general rule (petal and
  network take none; anything else must be a JSON object), so widening the
  provider CHECK permits a config with no edit here.
- **`updateFile` still allows `storage_provider` and `storage_path` through
  `FILE_COLUMNS`** while the Express PATCH route strips both — an S14
  hardening applied on one backend only. Since 0050 the money invariant is
  safe regardless (a CHECK re-validates on UPDATE), but the asymmetry stands.

**Thumbnails (S39 migration 0053; ROUTING REVERSED BY S44, migration 0054)**

- **Cloud only, and images only.** The desktop's Local Server tier keeps its
  own `sharp` pipeline and its six Express routes; nothing there changed. TIFF
  has no cloud preview (browsers cannot decode it) and SVG is excluded
  deliberately. **Video has no thumbnail on any tier — that is S40.**
- ✅ **A thumbnail LIVES WHERE ITS SOURCE LIVES** (S44, 0054). This entry
  previously read *"a BYO-storage workspace's previews live on Petal … a
  decision Audrey has not explicitly confirmed"* — **she confirmed it, in the
  opposite direction, on 2026-08-08, and S44 shipped it.** A preview now goes to
  the provider its body went to, and is disposed of there. §12.7b carries it.
- ⚠️ **BUT an `s3` workspace's previews are NOT DISPLAYED in the browser** —
  written and disposed of correctly, shown as file-type icons. Deferred
  deliberately: signing a key in the customer's bucket needs a batch presign
  that does not exist, and no S3 workspace exists on any environment to verify
  one against. In `OUTSTANDING.md`.
- ⚠️ **A `network` workspace gets icons regardless** — a browser cannot read a
  NAS. The rule is uniform; its outcome is not.
- **No orphan sweep over ANY thumbnail location** — neither `rabbit-thumbnails`
  nor a customer bucket (WILSON never enumerates one, §12.4). The queue drain
  and teardown cover the Petal side only. A thumbnail stranded by a browser
  dying between its upload and a refused `files` insert is retained with no
  certificate, on either provider. The compensating delete reports failures
  rather than swallowing them, which is what makes that case visible at all.
- ⚠️ **Teardown sweeps Petal-hosted previews only** (`.neq('storage_provider',
  's3')`), and **counts** the customer-bucket ones on WIL-7005 as
  `byo_thumbnails_left`. Their storage, their property — the same rule as the
  body. Both `byo_*` counts read `NULL`, never `0`, when the count could not be
  taken.
- ⚠️ **`files.thumbnail_url` is client-writable** through `FILE_COLUMNS`, the
  same asymmetry recorded below for `storage_path`. The GC's restorability
  guard and its workspace scoping bound the blast radius, and the guard now
  fails **closed** on a read error, but the column is not validated.
- **Signed display URLs expire after an hour**; a long-lived list re-signs only
  when its contents change.

**The folder tree and the manifest (S26)**

- **Per-member rate overrides are STILL not in `PROJECT.json`, and now that is
  a design boundary rather than a gap (S27).** Audrey asked for "unique margin,
  unique contingency, unique team member rates" in the project folder's file.
  Margin and contingency are in the manifest — `projects_select` admits any
  active workspace member, so they were already readable by anyone who can open
  the project. Rates live in a **separate, money-gated file**,
  `projects/<id>/FINANCE/RATES.json`, because the manifest's own path is
  readable by every project member and `project_rate_overrides_select` is
  manager-only. Putting them in one file would hand the team the figures RLS
  just denied.
- 🚨 **`public.rabbit_money_segment(text)` is the ONE definition of a
  money-gated path segment (0042).** The three base `rabbit-files` storage
  policies negate it; the four money policies assert it. Adding a third
  reserved segment is a one-line change to that function — **never** a
  parallel set of policies, because permissive policies OR together and a base
  policy that forgets the new segment serves the file to everyone regardless of
  how correct the gated policy is. That is exactly how 0038 inverted the
  invoice gate before 0039 fixed it in six places.
  **It is NULL-safe by construction and that is load-bearing:** a path with no
  third segment (`PROJECT.json`) must classify as NOT money-gated, or the
  manifest becomes unreadable and unwritable by everybody.
- **The manifest could only ever be written ONCE per project, until 0042.**
  Supabase Storage implements upsert-over-an-existing-object as an UPDATE on
  `storage.objects`, and that bucket had no UPDATE policy — 0027 created
  SELECT/INSERT/DELETE and nothing since had added one. The first write landed,
  every later one was refused, and `writeManifestSoon` logged a reassurance
  that was false on that backend. Fixed; pgTAP 53 probe 6 is the regression
  test. **Local Server was never affected.**
- **`<slug>_FILES` is still not modelled in the folder tree.** Its name embeds
  the project slug, so it is the one folder whose path is not backend-neutral.
  S27 owned file storage and deliberately did not reconcile it: cloud files are
  addressed by an ID-based object key whose **third segment is the money gate**,
  so making object keys human-readable would move the gate onto a different
  word. The tree provides the readable view, and Local Server's real
  directories are where readable paths actually matter.
- **A category folder is created when its toggle is on or its first entity
  appears — never speculatively**, so a film project gets no `LEVELS/`.
  Turning a toggle back OFF removes nothing: a disabled category is simply
  absent from the plan, and neither implementation has a path that deletes a
  row the plan omits.
- **Renaming an entity MOVES its folder.** The `label` column exists so a
  future session can switch to a stable slug with no migration, but today the
  slug follows the name — matching what `electron/main.cjs` already did for
  assets, so no existing local project changed behaviour. Once S27 puts real
  files under these paths, "rename" becomes "copy every object" on Supabase and
  the decision is worth revisiting.

**Test coverage has a shape, and it has a hole (S26)**

- 🚨 **Nothing in the vitest suite MOUNTS `RabbitProvider`.** The suite is pure
  modules; there is no `@testing-library` in this repo and no eslint config.
  S26 shipped a commit where the provider threw on first render — a temporal
  dead zone in a `useCallback` dependency array — and **658 vitest, 52 pgTAP
  suites and two production builds all went green** while the app rendered a
  blank page. Only the Playwright job caught it.
- **So Playwright's green status is load-bearing in a way the other three jobs'
  is not:** *"the app renders at all"* is a claim only that job makes. A
  Playwright failure is not to be waved off as flaky before checking
  `document.getElementById('root').children.length` against the dev server.

**Money and the budget (S24)**

- **Money is manager-only in the DATABASE, and the UI does not know it yet.**
  `can_access_project_money()` gates all five money tables: a workspace admin
  of the project's own workspace, or a `project_members` row with
  `project_role = 'manager'`. A workspace *manager* holding only a project
  `member` seat gets nothing. It deliberately has **no unstaffed-project
  opening**, unlike `can_write_project()`. `BudgetView.jsx` still renders its
  chrome for everyone — the data is empty and safe, the experience is not
  (`OUTSTANDING.md`).
- **Margin and contingency are each applied to the BASE, never compounded**,
  and per-line percentages are a **fallback**: `NULL` inherits the project
  default, an explicit `0` does not. Both rules live in `budgetMath.js` under
  test. `NOT NULL DEFAULT 0` on `budget_lines.margin_pct` would silently pin
  every line at 0% — a migration post-condition now refuses that.
- **A rate edited inside a project must never reach the rate card.**
  `rate_cards` / `rate_card_entries` are workspace-wide;
  `project_rate_overrides` is the project-scoped layer, resolving
  *project override → rate card → blank*. Writing project rates back to the
  card would rewrite every other project's numbers, silently and
  unreconstructably.
- **Actuals are a line × pay-period grid, entered by hand.** They are NOT
  derived from `tasks.logged_days`. External people are typed in from invoices;
  internal staff will be written by a **timecard system that does not exist**
  and is explicitly out of scope until after the current session plan. Its seam
  is `budget_actuals.source`.
- **`budget_versions.snapshot` stores the percentages as applied.** Reading them
  live would let a later edit to a project default rewrite a closed project's
  history.
- **Invoices are financial documents and are gated as such (0038).** Attaching
  one works on the **web** now — a plain `<input type="file">` plus
  `adapter.uploadFile()`, no desktop bridge. 🚨 The blob and the row are gated
  **independently**: `files.is_financial` guards the record, and a reserved
  `invoices` path segment guards the object, because either alone is a way in.
  The ordinary file rules admit any workspace member who can see the project,
  so the obvious implementation would have served the invoice PDF to exactly
  the people denied the amount on it. 🚨 **Re-running 0027 silently re-opens
  this** — it owns the three base storage policies and would recreate them
  without the exclusion, reporting success. Replay 0038 after it.
- **Invoices live in a folder called `INVOICES`** — a sibling of
  `<slug>_FILES` in the project folder on Local Server, and the reserved
  third path segment in cloud storage. 🚨 **The case of that segment is
  load-bearing.** The six storage policies compare it with `upper()` (0039);
  renaming it in the adapter without that would have INVERTED the gate —
  the object misses the money-gated policy (invisible to managers) and falls
  through to the base ones (visible to every project member). Keep the
  adapter string and the policies in step.
- **The Budget tab is hidden from non-managers** by `canSeeProjectMoney()`,
  the client mirror of the database gate. It fails CLOSED, and the direction
  is deliberate: the tab APPEARS a beat late for a project manager rather than
  being shown to a reviewer and snatched back. Still owed: a route-level gate
  on the project control panel.
- **A bid needs a rate card.** Bids are `role rate × days`, so with no
  rate-card entries every total is legitimately zero. The beta had zero cards
  and zero entries as of 2026-08-03; the budget now says so rather than
  rendering a confident $0.

> **Session 17 closed the four release-gating entries this section opened**
> (privilege-change auditing, the access-token hook grant, the `managed-files`
> traversal and `invite-member`'s missing MFA step-up), plus five smaller
> correctness ones. What remains below is the honest residue at v1.0.0, and
> `docs/MASTER_PLAN.md` §6 now carries a verdict — CLOSED, RE-OWNED or
> ACCEPTED — against every single entry. `docs/RELEASE_TESTING.md` has the
> user-facing subset under "Known not to work".

**Security-adjacent**

- ~~Eight SECURITY DEFINER functions are executable by `anon`.~~ ✅ **CLOSED by
  migration 0033 (S22, 2026-08-03).** The count was **seven**, measured, not
  eight. Five key on `auth.uid()` and leak nothing; `project_is_staffed` and
  `fn_comment_project_id` have no caller gate.

  **This reverses a deliberate decision, so here is exactly why it is now
  safe.** The earlier reasoning was that revoking would turn every anonymous
  table read from an empty result into a 42501, because `has_active_membership`
  backs nearly every policy. Three measurements retire that objection:

  1. **It was already not true that anon reads returned empty.** Probing all 25
     anon-granted tables as `SET ROLE anon` with no JWT: 17 returned empty and
     **8 already raised** `permission denied for function is_platform_operator`
     / `otter_is_course_owner` / `otter_has_editor_grant`. The "empty result"
     premise held for two thirds of the tables, not all of them.
  2. **0033 revokes the table grants in the same migration**, so an anon read
     now stops at the *grant* check with 42501 before any policy is evaluated.
     The function revoke therefore introduces no failure mode the table revoke
     had not already introduced.
  3. **No client code calls any of the seven directly.** All nine `.rpc()` call
     sites in `src/` target other functions; these seven are reached only from
     inside policies, which are evaluated as the *querying* role —
     `authenticated`, which keeps EXECUTE (asserted in 0033's post-condition).
     The one auth-screen read of a revoked table,
     `LoginScreen.fetchUserWorkspaces()` on `public.workspaces`, runs **after**
     sign-in (both call sites are behind a session check) and additionally does
     `if (error) return []`, so it is doubly unaffected.

  The suggested `auth.uid() IS NOT NULL` guard inside the two ungated functions
  is still worth doing as defence in depth, but it is no longer load-bearing.
  `35_platform_audit.sql` now asserts that **zero** SECURITY DEFINER functions
  in `public` are anon-executable — a count, not a named list, so it fails for
  a function nobody has thought of yet.
- ⚠️ **S43 removed `provision-workspace` from the repo but it is STILL DEPLOYED
  on all three projects until `supabase functions delete` is run per env** — so
  the statement below remains true of the live system, not of the source tree.
  See `docs/OUTSTANDING.md`.
- `provision-workspace` can still create an `admin` from a public,
  pre-authentication endpoint. This was by design — it was self-serve company
  creation and the caller became the first admin — but it means "no
  unauthenticated path can mint an admin" is **not** a true statement about
  the system, even after `invite-member` was gated.
- Operator sign-in, sign-out and guard refusals write no audit row anywhere, and
  `platform_audit`'s action CHECK has no value that would let them
  (TPN-LOG-007). The same CHECK reserves `operator.granted` / `operator.revoked`,
  which nothing emits.
- `resolve-login` keys its per-IP throttle on the **first** X-Forwarded-For hop
  (client-supplied, spoofable) where `provision-workspace` correctly uses the
  last (TPN-NET-004); both still use per-isolate in-memory buckets
  (TPN-NET-005), and six other functions have no limiter at all.

**Correctness**

- A username that collides across two workspaces makes sign-in unreachable: the
  resolver treats "two matches" as a miss unless a workspace slug disambiguates,
  and the login screen has no slug field. (The resolver already accepts the
  slug and the client already has the parameter — only the form field is
  missing, and adding one changes the first screen every user sees, which is
  why S17 left it.)
- `logAdminEvent` hardcodes `severity: 'info'`, so `WIL-3004` "Storage cleanup
  **failed**" lands in the log stream indistinguishable from the success line.
  One line to fix — but `adminGuard.ts` is bundled by nine Edge Functions, so
  changing it forces a redeploy of all nine.
- Managed-file thumbnails resolve only under `ASSETS/`, while uploads also
  write `SCENES/` and `SHOTS/` paths, so those thumbnails always 410.
- The Summary view's Budget tile is structurally always zero:
  `ProjectSummaryView` calls the estimate rollup with no role rates.
- `CrewTeamTab` / `TalentTab` do not check `res.ok` on the invoice-folder call,
  so a 400 becomes a swallowed `ERR_INVALID_ARG_TYPE` and the Attach button
  appears to do nothing.
- **Two CORE flags mean opposite things by default, and that is deliberate**
  (Track C, C3; MASTER_PLAN §6 #31 trap (b)). D.O.G.'s legacy attachment
  arrays carry `isCore` and read it as TRUE unless it says otherwise
  (`f.isCore !== false`); `public.files.is_core_definer` is `NOT NULL DEFAULT
  false` and is read strictly (`=== true`). Unifying them would move every
  previously-unmarked file between CORE and REFERENCE, and CORE/REFERENCE is
  injected into the generation prompt as "primary sources of truth" versus
  "supporting reference material only" — so the decks would change with
  nothing failing. Every writer therefore passes the flag EXPLICITLY, and the
  one place the two meet, `runAttachmentMigration`, carries `isCore !== false`
  across at the moment of the move. Migration 0075's post-condition 7 and
  pgTAP 79's probe 17 fail if a later session "fixes" this in the database.
  *~~The two ProjectFilesTable columns a cloud row could not keep~~ — fixed by
  0075 in the same bundle: `document_kind` and `description` were written by
  the Kind select and the Description cell on every gesture, stripped by
  `toColumns` because `files` had neither column, and persisted only on Local
  Server, whose PATCH route spreads `req.body`.*

*Fixed in Session 17 and listed here only so a reader of an older copy is not
misled:* milestones dropped on project load, `addManagedFile` unguarded
outside local mode, Drive-mode rate-card reads throwing, and O.T.T.E.R.'s
global Space shortcut firing from every page.

**Product gaps that read as bugs**

- ~~Quiz scores and Validator findings are never persisted~~ — **quiz scores
  are FIXED (S30, migration 0045): the storage path had existed since Session
  10 and simply had no caller.** Validator **audit reports** are still not
  stored, and that is now a decision rather than a gap — Audrey, 2026-08-05:
  *"just make Accept actually save."* The loss she was reporting was the
  accepted CORRECTION, which used to 404 on Local Server and report success
  anyway; that is fixed at both ends.
- **Signing in on the desktop app empties the O.T.T.E.R. library** and there
  is no control to switch back: `otterFetch` routes to Supabase whenever the
  session carries a `workspace_id`, cloud holds zero courses, and
  `setOtterAdapterMode` — described in two comments as "the Settings
  override" — has **no callers**. Content de-prioritised by Audrey; the
  silence is not. See `OUTSTANDING.md`.
- Settings → Tools "Storage Location" is an editable field that has no effect;
  `getDataDir()` hardcodes the userData path.
- R.A.B.B.I.T.'s agent integration is prompt-selection only — and in fact
  **unreachable**, not merely unwired: `App.jsx` hard-gates the whole agent
  surface to the O.T.T.E.R. page, so the RABBIT prompt can never reach the
  model and no user can hit a silent no-op. Session 17 corrected the Settings
  copy that advertised it; the wiring is post-1.0.
- The Agent Skills checkboxes gate nothing — `isSkillEnabled` has zero call
  sites repo-wide, for O.T.T.E.R. as well as RABBIT. The copy claiming they
  "control which actions are honored at runtime" was corrected in S17; the
  state is still loaded, persisted, rendered and read by nothing.
- ~~D.O.G. cloud attachments: refused at the write layer~~ — **CLOSED, Track C
  bundle C3 (`2a4924f`, migration 0075).** Attachments are ordinary project
  files on every write-capable backend now: a row in `public.files` /
  `bundle.files` and a body in `rabbit-files` / the project's files directory,
  written through `adapter.uploadFile` by the Resources drop zone and by
  D.O.G.'s new-project modal, and read back by D.O.G. through
  `adapter.downloadFile`. The limits that remain, stated in both directions:
  * D.O.G. reads at most **20** attachments per project and **32 MiB** in
    total (`deckAttachments.js`), spending that budget **documents first, then
    media, each newest-first**. `public.files` is every file RABBIT has stored
    for that project, so selecting one must not start a gigabyte download —
    and ordering by date alone spent it on renders, which is why the order is
    by kind first. Anything that does not fit is skipped, never truncated, and
    the panel says how many were left out.
  * A stored row counts as a deck attachment when it has a `document_kind`
    (0075) **or** is an image or video **filed against the project itself**.
    The full rule, its residue and why the second arm needs that qualifier are
    in §12.8; the short version is that `document_kind` is the marker for
    documents and media has none, so for media the marker is where it was
    filed. ⚠️ This bullet read "or is an image or video" flat until review
    round 2 — the very rule that let every plate and render in a project become
    deck source material, corrected in the code by round 1 and left standing
    here, in the section a reader goes to for the limits.
  * The **legacy arrays are still read** on every backend, so no existing
    project lost anything. Moving them is Audrey's own one-time action:
    Settings → RABBIT → "Move deck attachments into project files", dry run
    first, per-file ceiling **32 MiB** (Local Server's JSON body limit is
    50 MB and the migration base64-encodes, so a larger ceiling would refuse
    with a raw HTTP 413 instead of naming the file), oversized files named and
    left in place.
  * `is_core_definer` keeps its `NOT NULL DEFAULT false`. D.O.G.'s legacy
    arrays default `isCore` TRUE and the two are deliberately NOT unified —
    see §17's "Correctness" note and 0075's header. The migration carries
    `isCore !== false` across explicitly, and the round-trip diff in
    `polarityRoundTrip.test.js` is what proves no file changes side.
  * Google Drive is read-only, so the drop zone is disabled there with a
    sentence rather than a thrown stub.
  * **Deleting means two different things** and the panel now says which:
    in cloud mode it is 0014's soft delete (30-day window, still holding
    quota); on Local Server it unlinks the body and certificates it as
    `purged`, because there is no local trash.

**Documentation drift inside the product**

*All five entries this section carried were cleared in Session 17* — the
`HelpPage` password card, `db/README`'s migration range (which was missing
0025/0026 as well as 0028/0029), `env.cjs`'s non-existent `wilsonEnv` bridge,
the intake five-vs-three-step drift, `backups.yml`'s retention comment and the
hardcoded User-Agent strings (now `app.getVersion()`, which closes the drift
class rather than re-hardcoding a version).

The intake drift is worth remembering for its shape rather than its content:
it had **three** sites, and the third was not a comment. The RABBIT knowledge
snippet in `App.jsx` is appended to the companion's context at runtime, so the
agent was actively telling users about wizard steps that no longer existed.
When a fact is duplicated into prompt text, stale documentation stops being
documentation and starts being wrong answers.
- `backups.yml`'s comment illustrates a 30-day B2 lifecycle; the configured
  value is 90 days.

**Accepted for v1.0.0, with reasons**

- **GC orphan-scan starvation** (TPN-CONT-010): the run-wide budget collects
  objects in name order, so a project with more than 5000 *referenced* objects
  sorted ahead of its orphans would never reach them. Accepted — no tenant is
  near that. The sharper edge flagged by the audit is not the cursor but that
  certified disposal only ever runs when a human clicks, with no queue-depth
  signal anywhere.
- **Synchronous `fs` on the Electron main process** during relink census and
  scan: an unreachable network share can freeze the app. Accepted — an
  availability defect on a local, single-user, user-initiated action with no
  confidentiality or integrity component.
- **Web multi-tab last-writer-wins** on the three `localStorage` stores.
  Accepted for a one-window product.
- **Teardown strands identities**: a user whose only membership was in a
  torn-down company keeps an authenticating account with no workspace.
  Deliberate; what is missing is the reporting.
- **Teardown cannot see blobs no row points at**: an object in `rabbit-files`
  referenced by neither `files` nor `storage_gc_queue` survives its tenant's
  teardown permanently. Since S36 the sweep also deletes the **reserved**
  objects — `PROJECT.json` and `FINANCE/RATES.json`, built from the owned
  project ids rather than discovered — so what remains uncovered is only a blob
  no row points at *and* that the product does not write, i.e. a stranded
  upload whose row never landed. Those are storage-gc's job. **Since Track C /
  C2 the certificate says this itself** — `WIL-7005` carries `thumbnails_note`,
  a sentence stating that `blobs_*` and `thumbnails_*` are row-derived — and
  the THIRD bucket, `user-avatars`, which teardown never touched before C2
  (avatars are photographs of identifiable people, so "torn down" with them
  resident was a personal-data statement), is LISTED by prefix rather than
  derived: a stranded avatar IS removed and counted (`avatars_found` /
  `_removed` / `_failed`, with `avatars_truncated: true` if the listing hit its
  5000-object bound and stopped). Read that flag: truncated means objects
  remain, stated, never assumed swept.

  🚨 **This entry used to end "the row-derived sweep covers every blob the
  product itself created", and that sentence had been false since S26 shipped
  the manifest.** It is worth keeping as an example: the limitation was
  recorded accurately as a *coverage gap* and the same blind spot was, in
  `storage-gc`, a *destruction risk* that would have deleted every project's
  manifest and rates mirror (§12.4). **A gap in what a sweep can SEE is also a
  gap in what a collector can KEEP — read every such note in both directions.**
- **No single-instance lock** in Electron; two copies can run against one
  `userData` directory.
- **Realtime probes are lenient in CI** by design — there is no realtime
  service in the CI stack; hosted coverage comes from live probes.
- **WILSON never enumerates a customer's bucket (S37)** — read this one in
  both directions, per the entry above. As a coverage gap: the orphan scan
  does not run against S3-compatible storage, so a stranded s3 upload whose
  row never landed (and whose compensation delete also failed) survives
  until the customer's own lifecycle rules take it. As the deliberate
  non-destruction: **teardown does not reach into customer buckets** —
  their storage, their property — and says so in the certificate
  (`byo_bodies_left`) rather than under-reporting. The queue DRAIN does
  reach in (signed DELETE, §12.4), because those are the workspace's own
  certified disposals.
- **`downloaded` is advisory for every direct-served provider** (S33 stated
  it for cloud; S37 generalises it): a presigned GET is answered by the
  customer's provider and WILSON never observes the read.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Workspace** | A company; the tenant. |
| **App role** | `admin` / `manager` / `user` — workspace-wide authority. |
| **Project role** | `manager` / `reviewer` / `member` — a seat on one R.A.B.B.I.T. project. Different axis from app role. |
| **Platform operator** | Petal Studios itself; cross-tenant; SQL-granted only. |
| **Surface** | A build target with its own entry and session key: `app` (`/wilson`) or `admin` (`/wilsonadmin`). |
| **Adapter** | R.A.B.B.I.T.'s storage abstraction: `supabase`, `local_server`, `google_drive`. |
| **Guard** | A shared Edge Function auth module: `adminGuard`, `memberGuard`, `operatorGuard`. |
| **Certificate** | An audit row that proves a destruction happened: a `purged` `file_events` row, or a `blob.purged` / `workspace.teardown` `platform_audit` row. |
| **Stub** | An O.T.T.E.R. subject with outlines but no generated content yet. |
| **Company standard** | The blessed canonical course for a topic; admin-set; forked on use. |
| **Consented review window** | Time-boxed read access a proposer grants reviewers over their own course by submitting a change request. |
| **Pending-field set** | The per-row set of fields with an in-flight local write, which realtime merges must not overwrite. |
| **Show-once** | A credential displayed exactly once at creation and never retrievable — only resettable. |

## Appendix B — Event and error codes

`src/cloud/errorCodes.js` is the client registry; `WIL-41xx` and the `admin`
event type are **server-reserved** so clients cannot forge audit lines.

| Range | Meaning | Stream |
|---|---|---|
| `WIL-1xxx` | Authentication (sign-in failed, session expired, MFA challenge failed) — declared, largely unwired | `app_events` |
| `WIL-3003` / `WIL-3004` | Storage cleanup completed / failed | `app_events` |
| `WIL-3005` / `WIL-3006` | Workspace bucket secret saved / cleared (S37; hint only, never the secret) | `app_events` |
| `WIL-3007` | Bucket probe ran (stage + status on failure, latencies on success) | `app_events` |
| `WIL-41xx` | Admin actions. `WIL-4101`–`4104` are written by `logAdminEvent` from an Edge Function; `WIL-4105`/`4106`/`4107` (privileges changed / membership created / membership removed) are written by the `trg_ws_members_audit` DEFINER trigger, which is what catches privilege changes made straight from the browser | `app_events` |
| `WIL-5001` / `WIL-5002` | Update check / download failure | `app_events` + Sentry |
| `WIL-6001` / `WIL-6002` | AI request completed / failed, with model, tokens and `key_source` | `app_events` |
| `WIL-7005` | `workspace.teardown` certificate (critical) | `platform_audit` |
| `WIL-7006` | `blob.purged` batch certificate | `platform_audit` |
| `WIL-7007` | Teardown failure | `platform_audit` |
| `WIL-7008` | Teardown refused foreign paths | `platform_audit` |
| `WIL-7010` / `WIL-7011` | Company AI key set / cleared (hint only, never the key) | `platform_audit` |
| `WIL-7012` | Teardown certified abandoned upload(s) (Track C / C2, 0074): every `upload_abandoned` record the company had — the open reservations `sweep_open_uploads()` closed plus any the hourly sweep or a person's own failed upload had already certified — preserved 40 paths per row, straight after the sweep and before any blob is touched, because the CASCADE destroys `file_events` moments later. Certifies the abandonment, not a disposal: the partials expire at 24 h in Supabase Storage. ⚠️ 7009 was NOT free — it is `workspace.invite_sent`, written by `send_setup_link` in the same function (Track A), and this table does not list it. | `platform_audit` |

---

*End of handbook. Written from the code at `09b4405`, updated through
`6ab10c6`. When it disagrees with the code, the code is right — and the
handbook needs a fix. Session 17 proved that runs both ways: this document's
§15 Vitest count was stale where `MASTER_PLAN.md`'s was correct, so "sync the
plan to the handbook" is not a safe mechanical operation either. Check the
code.*
