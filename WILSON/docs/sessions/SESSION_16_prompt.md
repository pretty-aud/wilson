# SESSION 16 launch prompt — systems documentation & design pack

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE anything.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> **Three-session tail** (locked #19 as amended 2026-07-30, Audrey):
> S15 operator console + TPN (must be DONE before this session — check the
> §4 ledger) · **S16 = this** · S17 release, v1.0.0.
>
> **This is a DOCUMENTATION session — no product code.** The whole point of
> running it after S15 and before S17 is that the codebase is FROZEN: what
> gets documented is what ships. If the documentation pass surfaces a bug,
> a drifted comment, or an inconsistency, it goes into MASTER_PLAN §6 as a
> gap for S17 to fix before the tag — it does NOT get fixed here (the one
> exception: typos in comments/docs may be corrected inline). Audrey's
> sizing expectation: fairly quick relative to a build session — no
> migrations, no deploys, no review-fix loops — but the drift review and
> the diagram set are still real work; do not rush them.

---

## Why this session exists (Audrey, 2026-07-30)

Two deliverables, in order:

1. A **systems handbook** — the in-length, plain-text "how the whole thing
   works, what talks to what" document. Private in the operational sense:
   Audrey hands it to future team members manually. Dual audience by
   design: humans onboarding onto WILSON, AND other Claude accounts that
   will receive this document as seed material for Claude projects,
   skills, and CLAUDE.md files — so it must be fully self-contained,
   factual, and excerptable.
2. A **design-doc source pack** — wireframes/dataflows of how every system
   connects and how each tool and each load-bearing function works, as
   mermaid. Audrey then drives a separate Claude design session that turns
   it into the final infographic/wireframe design document.

**The two are opposites and must stay that way (Audrey, 2026-07-30).** The
handbook is the long one — that is its job, and it should not be trimmed for
brevity. The design pack is **short, succinct and skimmable**: diagrams with
one-line captions, readable in a few minutes end to end. Anything that needs
explaining belongs in the handbook, and the design pack links to it rather
than repeating it. If both documents end up explaining the same thing, the
design pack is the one that is wrong. See Block B.

The handbook is a **v1.0.0 release gate** (S17 checks it exists and is
drift-reviewed before tagging).

---

## Block A — `docs/SYSTEMS_HANDBOOK.md`

**List EVERY system, what it does, and what it talks to.** At minimum:

- **The Electron desktop app** — main process, the ~2000-line Express
  local server on 127.0.0.1 (what route families exist, what data lives in
  `otter-data/` / `rabbit-data/`), the React renderer, IPC surface, and
  which of the three tools uses which path.
- **The web build** — Vercel (`beta.petalstudios.co/wilson`, prod branch
  `feat/multi-user-v1`, STAGING-backed, auto-deploys on push; GH Pages =
  dormant fallback), what degrades on the web and why (no local server).
- **Supabase, per concern**: the three environments and which client
  talks to which; Auth (username-first resolver flow, ES256
  issue-session, the frozen JWT claim shape, MFA); Postgres + RLS as THE
  security boundary (app roles vs project roles, FORCE RLS, the helper
  family); Realtime (broadcast-from-database, the two channel topics,
  why not postgres_changes); every **Edge Function** by name with its
  caller, its guard, and its job (resolve-login, issue-session,
  provision-workspace, invite-member, admin-create-user,
  admin-reset-password, admin-set-active, admin-user-security, ai-proxy,
  storage-gc, + whatever S15 added); Storage (user-avatars + rabbit-files
  buckets, path layouts, policy model); pg_cron jobs (all four purges +
  retention windows).
- **The operator console** (S15) — the /wilsonadmin surface, its session
  isolation from /wilson, the operator tier, workspace lifecycle
  (create/manage/teardown + the storage sweep), per-company API keys
  (workspace_ai_keys → the ai-proxy seam). Check S15's "what S16 must
  document" note at the bottom of this file.
- **Anthropic** — every AI feature rides the `ai-proxy` Edge Function on
  both hosts (locked #21): per-workspace→platform key seam, streaming
  transport, usage telemetry codes. NO client ever holds a key.
- **GitHub** — the public repo, what CI runs on push (`rls.yml` jobs and
  what each proves), `backups.yml` on `main` (why the default branch
  matters), which secrets live in Actions.
- **Backblaze B2** — nightly pg_dump backups (which envs, retention,
  Object Lock) + auto-update installers. NEVER customer content
  (locked #20), and why a database-only backup is sufficient (relative
  storage_path model).
- **Resend** — invite/recovery/email-change mail, `mail.petalstudios.co`,
  DNS at Squarespace.
- **Sentry** — what reports from where, per-env.
- **electron-updater** — NSIS channel, B2 feed, the login-time
  update/skip flow.
- **Company storage providers** — local/local_server, Supabase Storage,
  Google Drive (read-only v0.1): storage_path semantics per provider,
  the relink model, blob GC + the certificate/ledger trail, file_events.
- **The three tools + the agent system** — D.O.G., O.T.T.E.R.,
  R.A.B.B.I.T. at a functional level: what each does, where its data
  lives in each mode, and the cross-tool surfaces (Dashboard, Admin
  Terminal, pet/agent system with per-tool actions and the DiffView
  approval gate).
- A **"who talks to whom" section**: every arrow in the system spelled
  out in prose (renderer → localhost Express; renderer → Supabase
  directly; Electron main ↔ renderer IPC; ai-proxy → Anthropic; CI →
  wilson-dev; Vercel build → staging env vars; GH Actions → B2; …).

**Rules:**

- **Written FROM the code, not from memory** — verify every route name,
  function name, bucket, cron time and claim shape against the repo
  before writing it down; it will be trusted verbatim by people and
  Claudes who cannot check.
- **NO secrets, keys, tokens, or passwords of any kind** — the repo is
  PUBLIC, so the handbook is "private" in the sense that Audrey hands it
  out manually, not that the file is hidden. (Project refs, hostnames and
  architecture are already public in this repo's docs.)
- State facts with their invariants ("the JWT claim shape is FROZEN
  because…") so a Claude reading it can act safely.
- Version-stamp it (v1.0.0, date). It supersedes nothing — MASTER_PLAN
  stays the migration's living history; the handbook is the timeless
  "how it works now".
- **Drift review before commit**: adversarial finders check the handbook
  against the code the same way code gets checked against intent — every
  named route/function/table/cron probed for existence and accuracy.
  Findings = handbook fixes now; CODE findings = §6 gaps for S17.

## Block B — `docs/SYSTEMS_DESIGN_PACK.md`

Produced AFTER and FROM the handbook (it is the source of truth). All
diagrams as **mermaid** (renders natively in artifact/markdown viewers,
unambiguous source for a design tool).

> **This document must be SHORT, and that is a hard requirement, not a
> preference (Audrey, 2026-07-30).**
>
> The two deliverables have different jobs and must not converge. The
> handbook is where something gets *explained* — prose, invariants,
> rationale, "why it is this way". The design pack is where something gets
> *seen*: diagrams first, and only enough words to make each diagram
> legible on its own.
>
> Concretely, for every diagram:
>
> - **A one-line caption above it** saying what it shows. Not a paragraph.
> - **At most ~3 short bullets below it**, and only for things the diagram
>   genuinely cannot express (a non-obvious ordering constraint, a
>   direction of trust). If a bullet is explaining *why*, it belongs in
>   the handbook — link to the section instead of restating it.
> - **No narrative.** No background, no history, no decision rationale, no
>   repetition of anything already in the handbook.
>
> The test: Audrey should be able to **skim the whole pack in a few
> minutes** and know what every diagram is for, then dive into the
> handbook for any one of them. If a reader has to *read* the design pack
> rather than *scan* it, it has failed and needs cutting — the fix is
> always to move words into the handbook, never to add words here.
>
> Prefer more small diagrams over fewer dense ones. A diagram that needs a
> paragraph to interpret should be split.

1. **The system map** — one diagram with every external system as a node
   (Electron app, web build/Vercel, Supabase ×3 envs, Edge Functions,
   Anthropic, GitHub/CI, B2, Resend, Sentry, Google Drive, company local
   storage, /wilsonadmin) and EVERY connection as a labelled arrow (what
   protocol/what data). One overview + one per-environment variant if the
   overview gets crowded.
2. **Per-tool wireframes/flows** — for EACH tool (D.O.G., O.T.T.E.R.,
   R.A.B.B.I.T.) and each shared surface (Dashboard, Admin Terminal,
   Settings, Team Members, Rate Card, operator console): a screen-level
   wireframe sketch (layout blocks, navigation) plus the tool's primary
   dataflow (e.g. D.O.G. brief → generation pipeline → outline → exports;
   O.T.T.E.R. course generation / quiz / validator / change-request
   lifecycle; R.A.B.B.I.T. intake → phases/assets/tasks → views, budget,
   files/relink).
3. **Per-function dataflows** — one small diagram per load-bearing
   function: login (resolve → password → MFA → session), invite +
   onboarding, realtime sync (broadcast path), soft-delete → trash →
   restore → purge → GC certificate, storage relink (scan → match →
   preview → apply), CSV exports + takeout, the ai-proxy call path,
   change-request submit → review → apply, auto-update, backups,
   workspace provision + teardown.
4. An **inventory table** at the top (diagram id → one-line "what it
   shows" → which handbook section it illustrates) so Audrey's design
   session can be driven diagram-by-diagram. This table IS the skim
   surface — someone should be able to read only this and know what is in
   the pack, so keep every cell to one line.

Keep the mermaid semantically honest (real route names, real table
names) — these are engineering wireframes, not decoration; the pretty
pass happens in Audrey's design session afterwards.

**Before committing, re-read the pack as a skim.** If any section reads
like documentation rather than a labelled picture, cut it and move the
substance into the handbook. The handbook is allowed to be long; this one
is not.

## Traps & discipline

- Token discipline: hard cap 15 agents; finders paste excerpts; never
  resume nondeterministic fan-out pipelines. A recon fan-out (one reader
  per subsystem, S14-style) is the right way to gather source material —
  but every fact still gets verified before it lands in the handbook.
- The wilson-app skill and MEMORY.md are SNAPSHOTS — the code is the
  authority. (The skill's API-key rule, for instance, predates S12's
  ai-proxy.)
- No product code changes (see header). No new nav, no refactors, no
  "while I'm here" fixes.

## Close-out ritual

Docs commit + push (handbook + design pack + any prompt/plan updates) →
CI green (docs-only, should be trivial) → **write
`docs/sessions/SESSION_17_prompt.md`** (release: final §6 disposition,
fixes surfaced by this session's read, changelog, package.json → 1.0.0,
tag; scope in MASTER_PLAN §5) → update `docs/MASTER_PLAN.md` (§4 ledger,
§5, §6 for anything the drift review surfaced, §10) → update the Claude
auto-memory → list Audrey's owed items (read the handbook end to end
before sharing it — she is the final reviewer of the hand-out document;
then run her Claude design session off the design pack).

---

## What S16 must document (appended by S15's close-out)

Everything below landed in S15 and does not exist in any earlier prompt or
ledger row. Read the code, not this list — but do not let the handbook ship
without covering these.

### The operator console — a SECOND SURFACE, not a page

- `/wilsonadmin` is its own build target: `admin.html` → `src/admin/mainAdmin.jsx`
  → `src/admin/OperatorApp.jsx`. It does NOT use `src/App.jsx`, has no router,
  no tools, no pet, and two sections (Companies, Audit).
- The build is selected by **vite `--mode admin`** (`vite.config.js` is now the
  function form). `rollupOptions.input` is gated on mode, which is what keeps
  the console OUT of the Electron installer — `npm run build` still emits only
  `index.html`. Worth stating plainly: the desktop app cannot reach the
  operator console at all.
- Scripts: `build:vercel:admin`, `build:admin`, `dev:admin`. `vercel.json` now
  runs BOTH builds and rewrites `/wilsonadmin*` → `/wilsonadmin/admin.html`
  (Vite names output HTML after its input — not `index.html`; that tripped the
  routing design and the handbook should say so).
- **Session isolation** is the load-bearing detail. localStorage is per-ORIGIN,
  not per-path, so on `beta.petalstudios.co` both bundles share one store.
  Isolation comes ENTIRELY from different key strings, chosen at build time by
  the `__WILSON_SURFACE__` define: `wilson.dev.session` (app) vs
  `wilson.operator.session` (console), plus distinct supabase-js `storageKey`
  values. `sessionStorage.js` also refuses the Electron safeStorage bridge on
  the admin surface, because that bridge is a single unkeyed slot.
- Sign-in is **email + password + TOTP**, not username-first. Operators have no
  workspace for `resolve-login` to resolve against — explain the tier, not just
  the flow.

### The operator tier

- `public.platform_operators` has existed since 0001 and the JWT has carried
  `is_platform_operator` since then, but until S15 **nothing server-side read
  either** — one client file did, and no policy or function. 0028 adds
  `public.is_platform_operator()` (SECURITY DEFINER, live-row) and
  `_shared/operatorGuard.ts`.
- The guard deliberately differs from `adminGuard` in three ways, all worth
  documenting: no `workspaceId` in its context; it does NOT require the JWT
  claim (the live row is strictly stronger, and requiring the claim would add a
  lockout mode if the Dashboard hook toggle is ever off); and **MFA is hard** —
  no verified factor means refused, and a failed MFA lookup means refused.
- **There is no grant/revoke-operator endpoint anywhere, on purpose.** Operator
  status is inserted by SQL, out of band, so the platform tier cannot be
  escalated from a web session. Document this as a security property, not an
  omission — and include the SQL (it is in `OWED_AUDREY.md` §9B).

### Migration 0028 — three tables and a helper

- `workspace_ai_keys` — per-company Anthropic keys as **AES-256-GCM
  ciphertext** (`_shared/aiKeyCrypto.ts`), never plaintext. RLS on + forced
  with ZERO policies (service_role only). No client, not even a workspace
  admin, can read a key back; the console sees a four-character hint. Explain
  WHY it is not a plaintext column even though the table is already
  service-role-only: the nightly `pg_dump` goes off-platform to B2, so a
  plaintext column would put every tenant's spending credential in a 90-day
  archive. Also record why NOT Supabase Vault (it exists on all three hosted
  projects, but CI's local stack could not be verified from the dev machine,
  and an unverifiable dependency inside the migration chain is a bad bet).
- `platform_audit` — the operator audit stream, and **the answer to gap #34**.
  It carries NO workspace FK and snapshots slug/name as text, so a
  `workspace.teardown` certificate survives the CASCADE that removes
  `app_events` and `file_events`. No purge job, same TPN-LOG-004 reasoning as
  `file_events`. Operators read it; only service_role writes it.
- `edge_rate_limits` + `fn_rate_limit_hit()` — the durable limiter (§6 #16).
  Explain what it replaces: every previous limiter was an in-memory Map inside
  ONE Deno isolate, so the effective limit was RPM × however many isolates were
  warm, resetting on cold start. Note it is a FIXED window (up to 2× across an
  edge) and that `_shared/rateLimit.ts` fails OPEN by design — with the reason,
  which is that a limiter is an abuse control and authorization already ran
  above it. Contrast operatorGuard, which fails CLOSED.
- `operator_workspace_summary()` — the single cross-tenant read, service_role
  only. Document the design rule it embodies: the console reaches every other
  tenant fact through service-role Edge Functions rather than widening RLS
  across tenants.

### Workspace teardown — the ORDER is the design

`operator-workspaces` action `teardown`. The sequence matters and the handbook
should spell it out: read the workspace row first (the name/slug snapshot is
what keeps the certificate meaningful), require the slug typed back, collect
every `rabbit-files` path from BOTH `files` and `storage_gc_queue` (paged with
`.range()` — PostgREST caps un-ranged reads at 1000 even for service_role),
delete the blobs and certificate each batch, drop the queue rows, and only THEN
delete the workspace row. After the CASCADE there is no way to discover which
blobs belonged to the tenant, and `storage-gc`'s orphan scan fails closed
because the rows it resolves through are gone.

**Named limitation to carry forward:** teardown removes the tenant, not the
people. A user whose only membership was in that company keeps an auth account
with no workspace. Deleting those identities would be a cross-tenant
destructive act, so it is out of scope — see §6.

### Changes to things S16 already planned to document

- `ai-proxy` now decrypts a per-workspace key (was: read a plaintext column
  that never existed) and uses the durable limiter. Its usage telemetry now
  records `key_source` (`workspace` | `platform`) — the operator console's
  spend view depends on that field.
- `adminGuard`'s MFA step-up **fails closed** since S15 (§6 #17 closed). There
  is also an opt-in `WILSON_REQUIRE_ADMIN_MFA=1` env gate that refuses admins
  with no verified factor at all; it ships OFF and why is documented in the
  guard.
- **The legacy local password module is GONE.** `/api/auth/session`,
  `/api/auth/verify`, `/api/auth/change`, the hardcoded constants and
  `src/components/PasswordScreen.jsx` were deleted, and a boot-time
  `cleanupLegacyAuthFile()` unlinks the on-disk credential. Any handbook
  section listing the local Express route families must not include an auth
  family — there isn't one.
- New pgTAP suites **34–36** (53 probes) and three new tables in the CI
  per-table coverage gate at the git root.
- New helper `scripts/tap-hosted.py` — runs a pgTAP suite (optionally with an
  unapplied migration) against a HOSTED project with no Docker. Every session
  through S14 rebuilt this by hand; it is worth a paragraph in the testing
  section, including the rule that `collected` must equal `planned` or the run
  is lying about coverage rather than merely failing.
- The TPN re-audit rewrote `TPN_AUDIT/` — the posture section of the handbook
  should quote the CURRENT summary, not the 2026-04-15 baseline.
