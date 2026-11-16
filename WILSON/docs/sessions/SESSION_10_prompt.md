# SESSION 10 launch prompt — O.T.T.E.R. Cloud Content Model

> Paste into a new Claude Code conversation from the WILSON repo to start
> Session 10.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> Session 9 handoff detail: this file, below.
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Context recap — where Session 9 left the repo

- Branch **`feat/multi-user-v1`**. Sessions 1–9 committed, pushed, CI green
  (S9 feature: `44d0de8` + docs follow-up). Migrations **0000–0021 deployed
  to dev + staging + prod. NO migration backlog.** pgTAP suites 01–25.
- **Session 9 delivered (see MASTER_PLAN §4 + db/README.md §18):**
  - **Admin Terminal** (`src/components/AdminTerminal/`, page id
    `admin-terminal`, admin-gated, in Home's Resources column): Users
    (roster + detail panel: role, per-user rate-card grant toggles w/
    confirm, show-once password reset, deactivate/reactivate danger zone),
    Add People (multi-invite + create-with-password → CredentialsPopup),
    Company, Logs (app_events + edit-history activity), Diagnostics
    (error-code reference WIL-####, `src/cloud/errorCodes.js`).
  - **Per-user rate-card grants** (0020): `grant_rate_card_view/edit` on
    workspace_members; `has_rate_card_grant()` live-row helper; rce_*
    policies = role OR grant, all active-gated. Client:
    `useRateCardAccess` (live off the workspace channel); view-only grants
    render RateCardTable read-only.
  - **Deactivated-member read ALIGNMENT** (0020 — §6 #15 CLOSED): spine
    SELECTs + ws_members workspace-arm + ws_members_admin_write now require
    `has_active_membership`; channel ≡ table reads (pgTAP 20 probe 20
    flipped). Last-admin guard (FOR UPDATE-locked, GUC escape hatch
    `wilson.bypass_last_admin_guard` for the S12 operator console).
  - **Auto-staffing** (0020): `projects.producer_id/director_id` are now
    CLOUD columns; creator+producer auto-seated as project managers on
    client creates ONLY (`auth.uid() IS NULL` skips — fixtures/scripts stay
    unstaffed-open). TeamMembersPage: assigned-projects column, roster
    liveness (§6 #13 CLOSED), producer/CD row highlight.
  - **Admin Edge Functions** (`_shared/adminGuard.ts` + four functions +
    hardened invite-member/provision-workspace): verify_jwt=false, claims
    from the TOKEN payload (NEVER `getUser().app_metadata` — app_role is
    hook-minted, not persisted), LIVE admin-row check, MFA aal2 step-up.
    provision-workspace `invites[]` = the wizard's Slack-style team step.
  - **MFA** (locked #9): LoginScreen TOTP stage → aal2; admin enroll gate
    at app entry (`MfaEnrollGate`, perms-driven); Settings security section.
  - **Auto-update** (locked #10/#15): electron-updater, generic provider,
    runtime feed `WILSON_UPDATE_URL` (env.json); **NSIS via electron-builder
    (`npm run dist`) is the auto-updatable channel** — Forge/Squirrel builds
    degrade to 'unsupported' gracefully. Login Update/Skip prompt +
    Settings version panel. **Backups** (locked #11):
    `.github/workflows/backups.yml` (git root) — nightly pg_dump →
    B2, needs secrets (see Owed by Audrey).
  - **app_events** (0021): append-only admin log stream; 'admin' stream +
    WIL-41xx codes server-reserved; 90-day purge cron 04:51 UTC.
  - Adversarial review: 16 findings — 15 fixed, 1 documented skip
    (S6: 12/12 · S7: 11 · S8: 9+8 · S9: 15+1 — keep the streak).
  - Vitest 224/224; vite build green.

## Session 10 goal — from MASTER_PLAN §5 (read it; scope confirmed there)

**O.T.T.E.R. cloud content model** — prerequisite for all-three-tools web
parity (locked #16/#17). O.T.T.E.R. content moves from local-disk JSON
(`otter-data/`) to workspace-tenanted cloud tables + storage:

- **Personal content** — courses/subjects a user generated; private to that
  user by default (owner_id scoping like notes, but WITH sharing).
- **Company-shared content** — pages/courses the company owns or a user
  shared to the workspace; visible workspace-wide. **Never cross-company**
  (locked #17 — no global wiki).
- Share / unshare flow (user → workspace); RLS mirroring RABBIT patterns
  (`workspace_id` + `owner_id` + `has_active_membership` from day one —
  the S9 alignment is the new baseline, don't regress it).
- Migration tool for existing `otter-data/` (follow `src/cloud/migrate/`
  patterns; idempotent insertOrSkip).
- D.O.G.: **nothing needed** (locked #17 clarification — web D.O.G. rides
  the open project's cloud files in S11).
- Resolve `public.users` drop + `schema.sql` retirement (§6 #9) while the
  schema is open.
- Deferred-in candidates: roster edit-history capture (§6 #7), legacy
  `useTeamMembers` sweep (§6 #8), storage blob GC design (§6 #6, lands
  w/ S12).

## Expected DB work (migration 0022+, pgTAP 26+)

- O.T.T.E.R. content tables (workspace_id NOT NULL, owner_id, shared flag
  or visibility enum, audit columns via 0004 pattern, soft delete?
  decide against the notes-v1 hard-delete precedent), storage bucket for
  otter assets w/ path-scoped policies (0009 avatar pattern).
- RLS: owner-only + workspace-shared arms; has_active_membership
  everywhere; FORCE RLS; no admin bypass on personal content (follow the
  notes decision) — decide explicitly and pin with pgTAP.
- **rls.yml at the GIT ROOT (`Dev_Work\wilson\.github\workflows\`)**:
  RLS_TABLES + replay list for every new table (S9 review caught a missed
  entry — double-check the array actually contains the new names).
- Broadcast: decide whether shared content rides the workspace channel
  (0018 trigger list) — personal content must NOT (notes precedent).

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- pgTAP: `throws_ok` message-form only; de-auth before every
  `tests.login_as`; role-gated probes build claims manually (login_as sets
  NO app_role); edited-applied migration on dev =
  `supabase migration repair --status reverted NNNN` + `db push
  --include-all` (used again in S9 — works); `supabase db query --linked`
  runs SQL on the linked env. CI stack: NO realtime schema, NO pg_cron
  (guard both), HAS storage.
- **Auto-staff trigger skips auth-less inserts** — pgTAP fixtures that need
  staffed projects must log in as a user before inserting projects (see
  24_admin_grants.sql probes 24-27).
- **Edge Functions: claims come from the token payload, not
  `getUser().app_metadata`** (S9 finding — only workspace_id is persisted).
  New functions: verify_jwt=false + manual getUser + live-row checks +
  config.toml entry.
- StrictMode-safe `mountedRef` (body resets true); seq-guards; 400ms
  debounce + RESYNC on workspace-channel consumers; never depend on a
  hook's whole return object in an effect.
- `window.prompt` does NOT exist in Electron renderers.
- All-pages-rendered pattern: page-level hooks fire for EVERY user — gate
  expensive hooks behind role/adapter checks in an inner component
  (AdminTerminalBody pattern).
- npm on this machine (Node 24): large-tarball installs can fail with
  ERR_SSL_CIPHER_OPERATION_FAILED — `npm install --package-lock-only`
  resolves lockfiles without downloads; electron-updater/electron-builder
  are lockfile-resolved but NOT in local node_modules yet.
- Token discipline: hard cap 15 agents; finders paste excerpts; never
  resume nondeterministic fan-out pipelines; adversarial review before the
  feature commit (3 finders + inline verification worked well in S9).
- The agent NEVER enters credentials — browser eyeballs owed by Audrey
  (see MASTER_PLAN §8 + Session 9 close-out list).

## Non-goals (S10)

> Re-plan (Audrey, 2026-07-28, post-S9): the remainder is now THREE smaller
> sessions for Opus 5 — S10 (this one), S11 web build + hosting/routing,
> S12 operator console + TPN + v1.0.0. Hosting is path-based (locked #18):
> `/wilson`, `/wilson/<tool>`, operator console at `/wilsonadmin` —
> PATH SHAPE locked, domain flexible (S11 ships to a test host; the
> petalstudios.co cutover is post-v1.0). NONE of that is S10 work — but new cloud
> tables you add here will be read from the web build in S11, so keep RLS
> browser-safe (no Electron-only assumptions in policies or RPCs).

- Web build, base-path routing, web sessions, deploy (**S11**).
- Operator console (/wilsonadmin), final TPN hardening, v1.0.0 (**S12**).
- Field-level cell presence (stretch since S8 — earliest S12 now).
- Durable Edge-Function rate limiting (S12 TPN).
- No cloud tables for milestones/scenes/levels/experiences (unchanged).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green → deploy 0022+ to staging + prod (dry-run each) →
deploy any new/edited Edge Functions to staging + prod → re-link CLI to
`wilson-dev` → write `docs/sessions/SESSION_11_prompt.md` → update
`docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps, §7 statuses, §10) →
update the Claude auto-memory → docs commit + push → list Audrey's owed
browser checks.

## Reminder

**No code before the branch is confirmed.** First tool call: `git status`
on `feat/multi-user-v1`, verify clean, read the Session 9 commits
(`44d0de8` + docs), then `docs/MASTER_PLAN.md`, then start.
