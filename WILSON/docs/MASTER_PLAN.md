# WILSON Multi-User v1 — Master Plan (v2)

> **Status: LIVING DOCUMENT — the single source of truth for the multi-user migration.**
> Reconstructed 2026-07-28 after the original plan file
> (`C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`) was lost when the
> `.claude\plans\` folder was removed. Rebuilt from four surviving sources that
> cross-confirm each other: (1) the Claude auto-memory file (per-session status,
> updated through Session 7), (2) `docs/sessions/SESSION_02–08_prompt.md`,
> (3) git history on `feat/multi-user-v1`, (4) the original product brief —
> now preserved at `docs/ORIGINAL_BRIEF_multiuser.md`.
>
> **Standing rule so this never happens again:** this file lives in the repo, is
> updated at every session close-out, and goes into the session's docs commit.
> Never keep the only copy of a plan outside version control.

---

## 1. What we are building

WILSON v0.6.3 — an offline-first, single-user Electron app (D.O.G. + O.T.T.E.R.
+ R.A.B.B.I.T.) — becomes **v1.0.0: a cloud-first, multi-user, real-time
collaborative platform**, deployable to multiple companies, TPN/MPA-aligned.

Vocabulary (from the brief, used consistently in code and docs):

- **Company-wide** = global app level. In code the tenant is a **workspace**
  (`workspace_id` on every domain table).
- **Project-wide** = scoped to a single RABBIT project (`project_members` roles).

Core capabilities of v1.0.0:

1. Supabase backend (Auth + Postgres + RLS + Realtime + Edge Functions), three
   hosted environments, all users on the central system.
2. Username-first login, invite/forgot/reset flows, onboarding wizards for new
   companies and new users.
3. Two permission tiers: **app roles** (admin / manager / user) and **project
   roles** (manager / reviewer / member).
4. Real-time collaborative RABBIT editing: live sync, presence, per-field LWW
   merge, edit history with revert, soft-delete with undo.
5. Personal Dashboard with cross-tool task views and rich-text Notes.
6. Company Admin Terminal (user/team management, logs, error reporting, debug),
   MFA, auto-update, backups.
7. O.T.T.E.R. cloud content model: personal vs company-shared ownership,
   never shared across companies. (D.O.G. needs no content model — web
   D.O.G. works off the open project's cloud files.)
8. Platform Operator Console (create/manage companies, per-company Claude API
   keys), web build of ALL THREE tools, final TPN hardening.
9. Hybrid storage: central Supabase for metadata/auth/realtime; companies can
   bring their own blob storage for artwork/files (v1.0: local, Supabase
   Storage, Google Drive).

---

## 2. Architecture (as built through Session 17)

> **The authoritative description of how the system works is
> `docs/SYSTEMS_HANDBOOK.md`,** written from the code in S16 and kept current
> as a release gate. This section is the plan's *summary* of it — deliberately
> shorter, and it defers to the handbook wherever the two differ.
>
> **The handbook describes what is meant to happen. `docs/OUTSTANDING.md` lists
> what currently does not** — everything known broken and unfixed, tagged
> MEASURED / REPORTED / INFERRED. Read it at the start of every session
> (rule 1) and update it at the end (rule 2). The two are complements: taking
> the handbook as a description of live behaviour, without the outstanding
> list, is how a session ends up building on something already broken.
>
> One caveat learned in S17: the handbook is not automatically right either.
> Its §15 Vitest count was stale where this plan's was correct. Where they
> disagree, **check the code** — do not sync one to the other mechanically.

### Backend

- **Supabase** (Auth, Postgres 17, Realtime, Edge Functions, Storage).
- **Three environments** (Sentry wired since Session 1):

| Env | Project ref |
|---|---|
| `wilson-dev` | `eqjzmnvkrakroyqxfsvw` |
| `wilson-staging` | `rzkirvkotslbovzbsdfh` |
| `wilson-prod` | `rqyriuyldhovirbuievt` |

- **Frozen JWT shape** (Session 1 — changing it means re-issuing every token):
  `auth.jwt().app_metadata.{workspace_id, workspace_ids, app_role, is_platform_operator}`
- **Tenancy rule:** every domain table has `workspace_id UUID NOT NULL`; every
  RLS policy starts from `workspace_id = public.current_workspace_id()`
  **AND `public.has_active_membership(workspace_id)`** — the helper reads the
  claim, and the membership check is what makes a write re-verify a live row
  rather than trusting a token that can lag reality by an hour. Child tables
  with no `workspace_id` of their own inherit it through a live-parent
  `EXISTS` join (the "0014 pattern"). Indexes on `workspace_id` are mandatory.
  Handbook §4.4 carries the canonical predicates and every deliberate
  deviation.
- **Migrations `0000`–`0030`** in `supabase/migrations/` — all deployed to
  dev + staging + prod as of Session 17 close-out. No backlog.
  **Ordering rules** — these matter ONLY when a migration is replayed BY HAND;
  every normal path applies in version order and is safe:

  | Re-run this by hand… | …then re-run | Because |
  |---|---|---|
  | `0022` | `0025` **and** `0026` | 0022 recreates `fn_otter_cr_review`, `otter_courses_select`, the CR policies and `otter_course_index()` at their Session-10 definitions — and every 0022 post-condition still passes in that half-reverted state. |
  | `0002` | `0029` | 0002 recreates `workspaces_write_operator` as `FOR ALL`, re-opening the defect where an operator's ordinary aal1 browser session could `DELETE FROM workspaces`. |
  | `0011` | `0030` | 0011's blanket `GRANT EXECUTE ON ALL FUNCTIONS` re-widens `custom_access_token_hook`; its `ALTER DEFAULT PRIVILEGES` also re-arms the same trap for every function a later migration creates. |

  0027 and 0028 explicitly state that they overwrite nothing.
- **Edge Functions — twelve, three shared guards.** Full table in handbook
  §4.6. **Every one runs `verify_jwt = false`, and that is not a weakening:**
  the Edge gateway's built-in verification only supports HS256 and this
  project's JWTs are ES256, so the gateway rejects them before any function
  code runs. Each function validates the caller itself via
  `admin.auth.getUser(token)`. Do not "fix" one by turning `verify_jwt` back
  on — it breaks, it does not harden.
  - Public / pre-auth: `resolve-login`, `provision-workspace`
    (+ initial-team `invites[]`, S9).
  - `_shared/adminGuard.ts` (`requireWorkspaceAdmin`): claims from the TOKEN
    payload → **live `workspace_members` row** → **MFA aal2 step-up, failing
    CLOSED since S15**. Used by `admin-create-user`, `admin-reset-password`,
    `admin-set-active`, `admin-user-security`, `storage-gc` (S14) and — since
    **S17** — `invite-member`, which previously reimplemented the check inline
    with no MFA while being able to mint an admin (§6 #46).
  - `_shared/memberGuard.ts` (`requireActiveMember`): same token + live-row
    shape, **no role check and no MFA** — any active member may use AI, and
    the live-row check is what stops a deactivated one spending money. Used by
    `ai-proxy` (S12).
  - `_shared/operatorGuard.ts` (S15): no `workspaceId` in context, the JWT
    claim is **not** required (the live `platform_operators` row is strictly
    stronger), and **MFA is hard both ways**. Used by `operator-workspaces`,
    `operator-ai-keys`.
  - `issue-session` uses an inline `getUser` and mints nothing — it writes
    `app_metadata.workspace_id` so the client's *next* `refreshSession()`
    causes GoTrue to re-derive every claim.
  - Also shared: `_shared/rateLimit.ts` (durable fixed-window limiter, fails
    OPEN by design) and `_shared/aiKeyCrypto.ts` (AES-256-GCM).
- **Storage buckets (two):** `user-avatars` (0009, public read, 2 MB, image
  mimes, path `{workspace_id}/{user_id}/{file}`) and `rabbit-files` (0027,
  **private**, 50 MB, path `projects/{project_id}/{entity}/{entity_id}/…`).
  `rabbit-files` has **no UPDATE policy** — objects are immutable, uploaded
  with `upsert:false` — and its single DELETE policy is bounded to the
  uploader's own objects under one hour old, which exists for exactly one
  flow: cleaning up an upload whose `files` row insert was then refused.
- **Email:** Resend SMTP via `mail.petalstudios.co` (DNS at Squarespace);
  invite / recovery / email-change templates uploaded to all three envs.

### The big architectural decisions (see §3 for the full locked list)

- **Realtime rides on `realtime.broadcast_changes` (broadcast-from-database),
  NOT `postgres_changes`.** postgres_changes evaluates the subscriber's SELECT
  policy against the NEW row of every UPDATE — soft-delete transitions would be
  withheld from collaborators. Broadcast authorizes once at channel join
  (`can_read_project_topic()`, SECURITY INVOKER ≡ `projects_select`), private
  topic `rabbit:project:{id}`, full old/new rows. Session 8 added the
  workspace topic `rabbit:workspace:{id}` (0018: projects / workspace_members
  / assigned-tasks / assets transitive-hide / project_members;
  `can_read_workspace_topic()` = membership + active — deliberately stricter
  than table reads for deactivated members until S9 aligns those).
  Reference: `src/tools/rabbit_v0.1.0/db/README.md` §14 + §17.
- **Merge model: LWW per field** (pending-field sets + `updated_at` stale
  guard, `state/realtimeMerge.js`); **Yjs lives ONLY in Notes** (Session 8):
  note bodies are Yjs snapshots (base64 + optimistic `version` column,
  merge-on-conflict retry — multi-device safe with no Yjs server; db/README
  §16).
- **Postgres lesson that shaped 0014/0016:** SELECT policies apply to BOTH
  sides of an UPDATE that reads the table — soft delete/restore must go through
  SECURITY DEFINER RPCs, and realtime must not re-evaluate per-row.

### Client

- `src/cloud/` — auth, migrate, onboarding, sentry. `src/permissions/` —
  `roleMatrix.js`, `projectRoleMatrix.js` (kept in LOCKSTEP with the 0013 SQL
  helpers), `PermissionGate.jsx`, `usePermissions`.
- `src/admin/` (S15) — the operator console's own React root
  (`admin.html` → `mainAdmin.jsx` → `OperatorApp.jsx`). It does NOT use
  `src/App.jsx`, has no router, no tools and no pet. Selected by
  `vite --mode admin`, which is what keeps it out of the Electron installer.
  **Session isolation from `/wilson` is a build-time key string and nothing
  else** — `localStorage` is per-ORIGIN, not per-path (handbook §5.2).
- RABBIT talks through the **adapter layer** (`supabaseAdapter` for cloud,
  local / Google Drive adapters preserved). Never bypass it.
- Presence + LIVE pill (`RealtimePresenceStrip`), undo toast, EditHistoryDrawer
  with revert — all landed.

### Test & CI gates

- **pgTAP RLS suite** `supabase/tests/rls/01–47`, **721 assertions** (runs in
  CI against a FRESH local stack with every migration applied from 0000 in
  order — not just against an already-migrated project; realtime probes are
  environment-tolerant by design, there being no realtime service in the CI
  stack). Suites 01–13 = 58, 14–25 = 220, the seven O.T.T.E.R. suites 26–32 =
  184, suite 33 (S14 file lifecycle) = 26, suites 34–37 (S15 operator tier,
  AI keys, rate limiter, workspace write lockdown) = 67, suite 38 (S17
  privilege audit + hook lockdown) = 14.
- **Vitest** 343/343 green end of S17 (15 suites, all pure modules).
  **Playwright**, two projects: `chromium` (sign-in → home with an RLS-scoped
  directory, admin invite, forgot-password) and `chromium-web` (a real built
  web bundle — deep links, history sync, signed-out deep links).
- **No Docker on this machine** — `scripts/tap-hosted.py` (S15) wraps a suite
  (optionally with an unapplied migration) so it runs against a HOSTED project
  in one rolled-back transaction:

  ```bash
  python scripts/tap-hosted.py out.sql [migration.sql] suite.sql
  supabase db query --linked --file out.sql
  ```

  `collected` MUST equal `planned`, or the shim is missing a pgTAP function
  and the run is **lying about coverage** rather than merely failing — a
  missed rewrite (`has_table` bit S11) still executes and still burns a plan
  slot but never reaches the collector.
- **S17 lesson: the hosted harness runs ONE suite; CI runs all of them against
  one database.** Migration 0030's audit trigger writes `app_events` rows
  during every suite's fixture setup, which broke `25_app_events`' unfiltered
  count — invisible when suite 38 was verified alone. Run the whole set
  against a new migration before pushing, not just its own suite.
- CI workflow at the **git root**: `.github/workflows/rls.yml` (git root is
  `Dev_Work\wilson\`, one level ABOVE `WILSON/`). Failure-only psql replay
  surfaces real SQL errors as annotations.
- GitHub repo secrets: `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`,
  `DEV_PROBE_USERNAME`, `DEV_PROBE_PASSWORD`.

### Scheduled jobs (pg_cron, all three envs)

| Job | Time (UTC) | Purpose |
|---|---|---|
| `wilson-purge-edit-history` | 04:43 | 90-day edit-history retention |
| `wilson-purge-soft-deleted` | 04:47 | 30-day trash sweep |
| `wilson-purge-app-events` | 04:51 | 90-day admin-log retention (S9) |
| `wilson-purge-otter-trash` | 04:55 | 30-day O.T.T.E.R. trash sweep (S10) |
| `wilson-purge-rate-limits` | 04:59 | 1-day `edge_rate_limits` window sweep (S15, 0028) |

**Two streams deliberately have NO purge job** — a compliance position, not an
oversight: `file_events` (audit retention ≥ 1 year, and its `'purged'` rows
*are* the deletion certificates — TPN-CONT-002) and `platform_audit` (same,
plus a `workspace.teardown` certificate must outlive the company it names).
`auth_attempt_log` also has none, but carries no stated rationale (§6 #60).

---

## 3. Locked decisions — do NOT relitigate

1. **Supabase Auth** (not express-session/connect-pg-simple — the brief's
   suggestion was superseded in Session 1).
2. **Username-first login** — server-side resolver, constant-time, rate-limited.
   Creator username: `Audrey`.
3. **Electron + web in parallel from v1.** *(Reality diverged: the web build
   landed in **S12**, not S10 — the plan text was never updated. Decision
   itself unchanged and upheld.)*
4. **Hybrid storage** — central Supabase core + bring-your-own storage for
   company files/artwork.
5. **Two-tier admin** — company admin (terminal, S9) vs platform operator
   (console). *(Reality diverged: the console landed in **S15**, not S10.
   Decision unchanged and upheld — and strengthened beyond what was written
   here: the operator tier is **SQL-grant-only, with no UI on any surface**,
   so the highest privilege in the system cannot be escalated from a web
   session even by someone already holding it.)*
6. **LWW per field** everywhere; **Yjs only for long-form text**.
7. **Edit history is RABBIT-only, 90-day retention**, with revert-to-state.
8. **Passwords are show-once at creation, never visible afterward** — admins
   reset, never read. (Deliberate change from the brief's "admin can see
   passwords" — that is not securable.)
9. **MFA for all admin tiers** (S9).
10. **electron-updater + S3-compatible hosting** for auto-update (S9).
11. **PITR permanently deferred** ($100/mo). **Refined 2026-07-29:** the
    backup story is two layers, not one. Supabase **Pro already includes daily
    backups with 7-day retention** on-platform — the S9 note that pg_dump
    "replaces PITR" understated what was already there. The nightly `pg_dump`
    to Backblaze B2 exists for the two things Supabase's own backups cannot do:
    it is **off-platform** (a suspended account, billing lapse or compromise
    takes the database *and* its backups together) and it holds **long
    retention** (7 days catches "we broke something Tuesday"; it does not catch
    corruption noticed a month later). B2 lifecycle window is therefore 90 days,
    not 30 — a compressed dump is single-digit MB, so even a year of dailies
    across both envs sits inside B2's free tier.
12. **Frozen JWT claim shape** (§2).
13. **Realtime = broadcast-from-database** (§2 — never postgres_changes).
14. **BYO storage v1.0 = local / local server + Supabase Storage + Google
    Drive** (AWS S3 + Hetzner via one S3-compatible adapter, post-1.0).
    — decided 2026-07-28
15. **Backblaze B2 hosts BOTH update builds and pg_dump backups** (one vendor,
    S3-compatible, works with electron-updater). — decided 2026-07-28
16. **The web build covers all three tools** (RABBIT, O.T.T.E.R., D.O.G.).
    — decided 2026-07-28
17. **O.T.T.E.R. cloud content is owned per-workspace or per-user (personal
    vs company-shared); NEVER visible across companies** — no global shared
    wiki. **D.O.G. needs NO content model or local-file access:** web D.O.G.
    generates off the open project's cloud files. — decided/clarified
    2026-07-28
18. **Web hosting is PATH-BASED on the apex domain** (Audrey, 2026-07-28):
    the app lives at `petalstudios.co/wilson`, every page/tool gets a path
    under it (`/wilson/dog`, `/wilson/otter`, `/wilson/rabbit`,
    `/wilson/dashboard`, `/wilson/admin-terminal`, …), and the PLATFORM
    OPERATOR console is a separate surface at `petalstudios.co/wilsonadmin`
    (interpretation flagged in §10 — company Admin Terminal stays an
    in-app page under /wilson). Implications owned by S11/S12: web vite
    build with `base: '/wilson/'` (Electron keeps `./`), URL ↔ page sync
    over the existing all-pages-rendered shell (no router rewrite), SPA
    fallback rewrites for `/wilson/*` and `/wilsonadmin/*`, Supabase auth
    `site_url`/`additional_redirect_urls` + `WILSON_SITE_URL` move to
    `https://petalstudios.co/wilson` (recovery/invite links become
    `/wilson/#/recovery`), per-surface session isolation between /wilson
    and /wilsonadmin, and a host/proxy that can route apex-domain paths
    (DNS sits at Squarespace, which cannot serve an SPA under a path —
    needs Cloudflare-or-similar in front, or moving the domain's hosting;
    Audrey decision owed before S11 deploy).

    > **REALITY AS OF S17 — the path shape shipped, the domain did not.**
    > Both surfaces are live at **`https://beta.petalstudios.co/wilson`** and
    > `…/wilsonadmin`, on the Vercel project `petal-studios/wilson` (production
    > branch `feat/multi-user-v1`, STAGING-backed, auto-deploys on push).
    > `vercel.json` already builds both and rewrites `/wilsonadmin*` →
    > `/wilsonadmin/admin.html`, so **the path shape this decision asked for
    > works today** — only the *domain* differs (`beta.` subdomain vs apex).
    > The apex is still Squarespace, exactly as this decision flagged, and
    > moving it is a DNS migration of a live marketing site, not a setting.
    > **The production-domain cutover is explicitly post-v1.0**; the open
    > choice and its three options live in `docs/OWED_AUDREY.md` §11C, which
    > recommends keeping a subdomain for v1.0. Nothing in the codebase cares
    > which is chosen. One security note worth carrying into that decision:
    > `/wilson` and `/wilsonadmin` sharing an origin is precisely what makes
    > session isolation depend on a build-time key string, so a separate
    > subdomain would buy browser-enforced separation for free.
19. **Session plan (revised 2026-07-29, Audrey — a session was ADDED so S12 does
    not get bloated):** S11 O.T.T.E.R. UI ✅ · **S12 `ai-proxy` + web build** ·
    **S13 change-request approval (NEW)** · S14 file lifecycle & data
    stewardship · S15 operator console + TPN + v1.0.0. See §5 and §10.
    The change-request work was briefly specced as an S12 Block C; Audrey pulled
    it into its own session rather than triple-book S12 — the same correction
    that split the old S11 after S10 overran.
    **Amended 2026-07-30 (Audrey, post-S14): the tail splits into THREE** —
    **S15 operator console + TPN hardening** (last build session) ·
    **S16 systems documentation & design pack** (docs-only, frozen code) ·
    **S17 release** (final §6 disposition, fixes surfaced by S16's read,
    v1.0.0 cut). Docs deliberately precede the release: writing the
    handbook forces an end-to-end read of the whole system, so S16 doubles
    as the final audit and S17 absorbs anything it surfaces BEFORE the
    tag. Fourth proactive session split; the pattern holds.
20. **B2 never holds customer content** — database dumps and update installers
    only. Project files live in the company's own storage (locked #14) and are
    their backup responsibility; WILSON keeps only the metadata that points at
    them. **O.T.T.E.R. content is excluded from any company-wide export**
    (§10, 2026-07-29). — decided 2026-07-29
21. **NO Anthropic API key ever reaches a client, on EITHER host.** All AI calls
    go through one authenticated Edge Function proxy (`ai-proxy`); Electron uses
    it too, so there is a single code path and no desktop/web divergence. The
    proxy resolves a **per-workspace key with a platform fallback**, which is
    what makes admin-portal key management (S15 operator console) a config
    change rather than a rewrite. The per-user `wilson-api-key` in
    `localStorage` is deleted on upgrade and the Settings key field removed.
    Design detail + the 150s/400s streaming workaround in §10.
    — decided 2026-07-29 (Audrey)
22. **Approving an O.T.T.E.R. change request APPLIES it.** Approval is not a
    decision record: it copies the proposer's subjects into the company-standard
    course. **Additive only** — it adds and updates, never deletes (Audrey's
    call: one approval must not silently strip lessons from everyone's official
    course). **Every approval auto-archives the target first** to a private
    snapshot owned by the approving admin, because O.T.T.E.R. is deliberately
    not edit-history captured and an overwrite would otherwise be
    unrecoverable. Declining requires a note, and the proposer can either
    accept the decision or revise and resubmit. Submitting a request grants
    reviewers **read** access to the proposer's copy for the review window
    only. — decided 2026-07-29 (Audrey)

---

## 4. Session ledger — where we are

Branch: **`feat/multi-user-v1`** (created Session 1 from
`feature/finder-column-resources`). One session ≈ one feature commit + a docs
close-out commit. All sessions 1–7 are **committed, pushed, CI green, and
deployed to all three envs**.

| # | Date | Scope | Key commits |
|---|---|---|---|
| 1 | 2026-04-17 | Auth & schema foundation (vertical slice): scaffolding, JWT hook, envs, Sentry | `d4c256f`, `c0fc59f`, `a741de6` |
| 2 | 2026-04-18 | RLS lockdown of 13 RABBIT tables + pgTAP + CI; AuthShell + LoginScreen; provision-workspace; NewCompanyWizard + NewUserWelcome; single-user→cloud migration tool | `59181df` … `ce4487e` |
| 3 | 2026-04-18 | issue-session ES256 fix; permissions framework; migration 0009; invite flow; forgot/reset wizards; Resend SMTP; Playwright skeleton | `4ed1d9c`, `3344889`, `99a74a1` |
| 4 | 2026-07-28 | Team Members on `workspace_members` (0010) + role grants hotfix (0011); role dropdown, rate columns, Settings→Profile (`ProfileSection`, built for S8 reuse); Vitest + 2 CI jobs | `76536e8`, `163892d` |
| 5 | 2026-07-28 | Edit history (0012): append-only capture triggers on 13 tables, RLS, 90-day purge cron; EditHistoryDrawer; `listEditHistory` on adapters | `51403d3` |
| 6 | 2026-07-28 | Project roles (0013: manager/reviewer/member + helper family gating writes), soft-delete + undo (0014), rate-entry identity (0015); undo toast; roster UI; 12/12 review findings fixed | `324a44c`, `848d225` |
| 7 | 2026-07-28 | Realtime live sync (0016 broadcast) + presence + LWW merge layer + revert-to-state; 11 review findings fixed | `338c90e`, `4375872` |
| 8 | 2026-07-28 | Dashboard (cross-project task table/kanban/gallery + TaskDetailPopup reuse) + Notes (TipTap v3 + Yjs snapshot-merge-write, owner-only, no admin bypass) + workspace channel (0018: projects/members/assigned-tasks/assets/project_members) + avatar remove + avatars in presence chips + task UI/DB parity (0019: tasks.notes, 'urgent'); 9/9 review findings + 8 minors fixed; CI green on `0567581` (npm-10 lockfile + top-level DML-CTE fixes); 0017–0019 deployed dev+staging+prod | `1ef4d10`, `156a74e`, `0567581` |
| 10 | 2026-07-29 | **O.T.T.E.R. cloud content SERVER model** (0022): otter_courses/subjects/progress/course_editors/change_requests, three visibility tiers (personal/shared/company_standard), live-row DEFINER helpers, identity-pin triggers, OTTER-specific trash RPCs + 30-day purge, otter_fork_course, otter_course_index (metadata-only admin view); `public.users` dropped + schema.sql/seed.sql deleted (0023 — **gap #9 CLOSED**); client adapter seam (`adapters/otterFetch`, 85 call sites); runOtterMigration. pgTAP 26–30 (94 probes) verified against real Postgres on wilson-dev; Vitest 256/256. Review 15/15 fixed. **O.T.T.E.R. UI NOT started → S11 Block A.** | `31586d5` |
| 9 | 2026-07-28 | Admin Terminal (users/company/logs/diagnostics + show-once credentials + multi-invite) + per-user rate-card grants (0020) + deactivated-member read alignment + last-admin guard + auto-staffing (producer/creator) + MFA (TOTP challenge + admin enroll gate) + auto-update (electron-updater/NSIS/B2) + nightly pg_dump backups + app_events log/error codes (0021) + roster polish; review 15/16 fixed (1 documented skip) | `44d0de8`, `6182aa5`, `f942e1e` |
| 12 | 2026-07-29 | **`ai-proxy` + the web build.** Block A (locked #21): the `ai-proxy` Edge Function is now the ONLY path to Anthropic on both hosts — token claims + live `workspace_members` check (`_shared/memberGuard.ts`), per-workspace→platform key seam (`workspace_ai_keys` read fails soft until S15), always-streaming upstream (150s Edge deadline vs long generations) with a pure client SSE reassembler (`anthropicStream.js`, 14 vitest cases), per-workspace in-memory rate limit, WIL-6001/6002 usage telemetry to app_events. All 14 direct call sites rewired; the Settings key field, `apiKey` prop plumbing and the localStorage credential are gone (purged on upgrade); stale help/prompt copy corrected. Block B (locked #18): `build:web` (`--base=/wilson/` → dist-web) + `serve-web.mjs`; URL ↔ page sync over the all-pages shell (deep links, pushState, popstate — no router); **gap #21 CLOSED** (Otter's library loads independent of the local-server settings fetch; `src/lib/localData.js` gives pet/otter-settings/agent-skills an Express-or-localStorage home); RABBIT forces the supabase adapter in browsers; web D.O.G. generates off uploads + cloud project context (attachments degrade visibly — no content model per locked #17); web sessions persist in localStorage with TOKEN_REFRESHED re-save; Playwright `chromium-web` lane (3/3) against the real bundle; **test host = GitHub Pages** (`gh-pages` branch → pretty-aud.github.io/wilson, Pages toggle owed). Review: 4 finders, 15 findings, 14 fixed, 1 accepted+documented. Vitest 304/304. | `41c7356` |
| 13b | 2026-07-30 | **Requests live IN O.T.T.E.R.** (Audrey: the company-library admin controls belong in the tool; the brief's three APP tiers map admin = decide, manager = view, user = own requests). `RequestsView.jsx` behind a cloud-only nav tab ('Admin' for admins, 'Requests' otherwise): deciders (admins + targeted-standard owners — **gap #33 CLOSED**) get the full approve/decline queue with the same confirms as the Admin Terminal (which stays); managers get a read-only queue (**migration 0026**: `otter_cr_select` manager READ arm — decide/window/apply still refuse them, 4 new pgTAP probes, suite 32 = 67); proposers get their requests + feedback with the ChangeRequestDialog as sole actuator and fork-less accept/withdraw fallbacks. Compact review: 7 findings → 6 fixed, 1 documented. 0026 deployed to all three envs. | `54d5225` |
| 13 | 2026-07-29 | **Change-request approval that APPLIES** (locked #22, migration 0025). Status machine grows `changes_requested` + the revise-and-resubmit loop (revision counter, required decline note, `acknowledged_at`, decliner stays reviewer of record, settled rows frozen); `otter_cr_apply()` — the ONLY path to `approved` (transaction-local GUC) — archives the target to a personal copy owned by the approver then applies the proposer's live subjects **additively** (update by slug in place, insert when absent, never delete; reference docs untouched per #29); consented review window `otter_has_open_review_access()` (live-row role, proposer-owned sources only, opens on submit / closes on settle) as an OR arm on `otter_courses_select` + `otter_course_index`. UI: Admin Terminal Approve (real diff counts + archive-kept confirm, Peak-End summary) / Decline (required note) / working "Open their course" jump (`wilson:open-otter-course`); O.T.T.E.R. dialog decision state (accept / resubmit, round badges), share checkbox removed. pgTAP 32 (63 probes) + suites 26–32 (180) green on real PG17; Vitest 304/304. Review: 15 findings, 10 confirmed → fixed (incl. reviewer-stamp forgery on withdraw + the 0022-re-run ordering rule), 1 refuted, 4 triaged inline. | `89b84bc` |
| 14 | 2026-07-30 | **File lifecycle & data stewardship** (migration 0027). Block A — storage relink, the ShotGrid model (Audrey, find+preview+APPLY): provider-agnostic 3-rung matcher (`components/relinkMatcher.js`, pure, 14 vitest cases) + recursive symlink-safe walk + relink-scan/apply Express routes (containment-guarded, user-authorized-folder gating, offline-home 409, all-or-nothing) + RelinkDialog (old→new per row, counts in the confirm) + the `files_dir` override surfaced/resettable in Files & Storage. Block B — CSV export both tiers: `src/lib/csvExport.js` (BOM, RFC 4180, formula-injection guard) + per-page buttons (tasks / rate card / roster — each exports exactly what the viewer sees) + admin-only WorkspaceTakeout zip on RLS-scoped reads (O.T.T.E.R. + Notes excluded per locked #20, stated in UI and manifest). Block C — `file_events` trigger-fed lifecycle stream (uploaded/moved/relinked/trashed/restored/purged; project readers + admin arm; 'purged' rows are TPN-CONT-002 deletion certificates; NO purge job — TPN-LOG-004 ≥1yr) + `bundle.fileEvents` local twin + FileAuditDrawer. Block D DECIDED: **create `rabbit-files`** (private, 50MB, path-scoped policies; delete-own = 1-hour failed-insert cleanup window only) — gap #31 UNBLOCKED. Block E — `storage_gc_queue` + enqueue trigger + `storage-gc` Edge Function (adminGuard, workspace-scoped, run-wide budget, batched ref-checks, paged members read, fail-closed tenancy) + Diagnostics cleanup card; **gap #6 CLOSED**. Review: 5 finders, 20 findings → 18 fixed (3 criticals: unbounded delete-own policy, body-supplied relink baseDir, takeout aborting on composite-pk order), 2 documented (→ #34/#35). pgTAP 33 (26 probes) on real PG17; Vitest 329/329. | `b109bd2` |
| 11 | 2026-07-29 | **The O.T.T.E.R. UI.** Tier picker in the existing create flow; filter chips above the existing Sidebar 1 list (subjects INHERIT — they have no visibility of their own); share + editor-grant dialog off the course row; admin-only company-standard set/clear; inline fork offer; change-request **submit** in O.T.T.E.R. + **review queue in the Admin Terminal**; trash/restore as a filter state; `can_write` gating; collapsible Sidebar 1 (Ctrl/Cmd+`\`, localStorage, default expanded); OtterMigrationPanel mounted. **Migration 0024 `otter_trash_index()`** — the brief's claim that trash was "server-complete" was wrong; every read path filters `deleted_at IS NULL`, so `otter_restore_row` had no obtainable argument (**gap #20 CLOSED**). Also wired the dead `renderDeleteConfirm` (course delete was unreachable). Review: 17 findings, 10 refuted, 7 fixed — incl. a **non-functional editor grant** (`otter_course_editors.workspace_id` has no DEFAULT; the trigger validates rather than defaults) and error banners rendering into a `hidden` pane. pgTAP 117/117 on real PG17; Vitest 290/290. | `5707895` |

| 15 | 2026-07-30 | **Platform Operator Console + final TPN hardening** (migration 0028). Block A — `/wilsonadmin` as a genuinely separate surface: `admin.html` → `src/admin/` (own React root, no router, two sections), selected by vite `--mode admin` so the console can never ship inside the Electron installer; **session isolation is build-time** (`__WILSON_SURFACE__` → `wilson.operator.session` vs `wilson.dev.session`, distinct supabase-js `storageKey`, and the admin surface refuses the single-slot Electron safeStorage bridge) because localStorage is per-ORIGIN, not per-path; sign-in is email+password+TOTP (operators have no company for `resolve-login`). Server side: `is_platform_operator()` (live-row — the JWT claim had existed since 0001 and **nothing server-side had ever read it**), `_shared/operatorGuard.ts` (no workspaceId, claim NOT required, **MFA hard both ways**), `workspace_ai_keys` (AES-256-GCM ciphertext via `_shared/aiKeyCrypto.ts`, zero policies — not Vault, because CI's local stack was unverifiable from this machine), `platform_audit` (**no workspace FK** → teardown certificates outlive the tenant, closing gap #34's cascade half), `operator_workspace_summary()` (the single cross-tenant read, service_role only), and two Edge Functions (`operator-workspaces` list/create/rename/suspend/restore/**teardown**, `operator-ai-keys` set/clear with a live Anthropic validation call). Teardown's ORDER is the design: snapshot → typed-slug confirm → page both blob sources with `.range()` → delete + certificate each batch → drop queue rows → only then the row. Block B — **gap #16 CLOSED** (`edge_rate_limits` + `fn_rate_limit_hit`, durable and cross-isolate, replacing per-isolate Maps whose real limit was RPM × warm isolates) and **gap #17 CLOSED** (adminGuard MFA fails CLOSED; opt-in `WILSON_REQUIRE_ADMIN_MFA` for the stronger no-enrolment gate, off by default and why). Block C — **gap #32 CLOSED**: the entire dead local password module deleted (3 routes, the hardcoded constants, the orphaned `PasswordScreen.jsx`) plus a boot-time unlink of the on-disk credential; **#31 partial** (the mixed-patch silent data loss fixed + 10 tests; re-homing deferred with a plan). Also `scripts/tap-hosted.py` — the no-Docker pgTAP harness every session had been rebuilding, validated against suites 17/24/25/33 before use. **Adversarial review: 5 finders → 23 findings → 11 confirmed / 12 refuted, ALL 11 fixed (migration 0029 + suite 37).** The critical, found independently by the TPN cloud pass as TPN-CLOUD-003: `workspaces_write_operator` (0002) is `FOR ALL` and 0011 grants ALL to `authenticated`, so an operator's ordinary **aal1** browser session could `DELETE FROM workspaces` — skipping operatorGuard's hard MFA, the typed confirm, the blob sweep AND the certificate, and reopening gap #34 by the back door. 0029 drops the FOR ALL policy for read+update arms, revokes INSERT/DELETE/TRUNCATE, and adds `trg_workspaces_delete_guard`. The review also surfaced a **pre-existing release blocker**: `RabbitProvider.createProject` stamps every draft with the pre-multi-tenant `DEFAULT_WORKSPACE_ID`, which `projects_insert` refuses — so cloud project creation was broken for **every tenant except the seed fixture**; proven against wilson-dev (seed value 42501, real workspace succeeds, same statement) and fixed by dropping the column in the adapter + `trg_projects_populate_workspace`. Other fixes: the audit-certificate `context` was the one unbounded field and could bust its 8000-char CHECK silently (supabase-js reports CHECKs on the error channel, so the try/catch was dead) — now bounded and logged; `blobs_removed` counted the batch instead of `remove()`'s returned array, so a certificate could claim a destruction that never happened; teardown deleted queue rows *before* the CASCADE that recreates them; the sweep now refuses paths outside the workspace's own projects (`files.storage_path` is client-writable, and the sweep runs as service_role); console sign-out was global and dropped the same user's /wilson session. pgTAP 34–37 (67 probes) on real PG17; Vitest 339/339. **CI green all four jobs.** | `09b4405` |

| 16 | 2026-07-30 | **Systems documentation & design pack** (docs-only, frozen code). `docs/SYSTEMS_HANDBOOK.md` — the v1.0.0 release gate: every system, what it does and what it talks to, written FROM the code via an 11-reader recon fan-out (Electron/Express, auth + admin Edge Functions, Postgres/RLS/cron, operator console, ai-proxy, storage & file lifecycle, each of the three tools, web/CI/infra, shell & shared surfaces). 17 sections + 2 appendices, dual-audience (team onboarding AND Claude-account seed material), secrets-free. Includes the full local Express route inventory, the frozen JWT claim shape with its staleness rule, the RLS tenancy rule with every deliberate deviation, all 12 Edge Functions with guard + caller, the teardown ORDER, the fail-open/fail-closed asymmetry, a "who talks to whom" section enumerating all 29 arrows plus the seven that deliberately do not exist, and a §17 consolidating every known limit. `docs/SYSTEMS_DESIGN_PACK.md` — 24 mermaid diagrams (system map, 3 architecture, 7 wireframes, 3 tool flows, 10 function dataflows, 2 state machines) with an inventory table, one-line captions and ≤3 bullets each; short by requirement, links to the handbook rather than repeating it. **Drift review (3 finders, cut short at Audrey's direction — a docs pass did not need a build-session review): 13 findings, all 13 fixed in the handbook.** The keeper is a CODE finding the review surfaced independently: **`custom_access_token_hook` is executable by `authenticated` and `anon`** — 0001/0003 revoke it, but 0011's blanket `GRANT EXECUTE ON ALL FUNCTIONS` re-grants it and only re-locks two other functions; the hook reads its target user id from the caller-supplied `event` argument, so any signed-in caller can compute another user's claim set (→ #44). Other handbook fixes: `projects_insert` gained an admin/manager arm in 0013 (0004's predicate was stale), `workspaces_select` keys on the membership IN-list not the JWT claim, four tables are ENABLE-only not FORCE, two `resolve-login` branches write no `auth_attempt_log` row, `/` → `/wilson` is a redirect not a rewrite, and not-an-operator is NOT unified with the generic sign-in error. **15 new §6 gaps filed (#44–#58); no product code touched.** | `8b381ec` |

| 17 | 2026-07-30 | **Consolidate, trim, prepare the release** (migration 0030 + suite 38). Scope was reset by Audrey after reading S16's output: absorb what the handbook taught, trim fat, fix what is genuinely broken, write the test plan — then STOP for her review. Hard constraint all session: **no behaviour, layout or visual change**. Block B — the four release-gating defects. **#42/TPN-LOG-005** (open CRITICAL): privilege changes on `workspace_members` went from the browser straight into the table with nothing capturing them; a DEFINER capture trigger now writes the reserved `app_events` admin stream (WIL-4105/4106/4107), firing only when `app_role`/`is_active`/a rate-card grant actually changes — a profile edit must not write an audit line. **#44**: `custom_access_token_hook` re-revoked; verified live that it was callable by **anon**, i.e. reachable with nothing but the public anon key — worse than the gap recorded. The wider 0011 sweep found 8 anon-executable DEFINER functions; 6 leak nothing and the other 2 leak one bit about an already-known UUID, and revoking them was **proven** to be a behaviour change (every anon table read becomes a 42501, because `has_active_membership` backs nearly every policy), so they were filed (#59) rather than shipped blind. **#45**: four fs sinks contained, not the two filed — `mf.id` and `asset.folder_slug` are client-writable too — plus the asset rename/delete pair, which was an arbitrary-*directory-move*, and the unguarded `import-folder`. **#46**: `invite-member` routed through `adminGuard`; not a role change, the only new refusal is the MFA gate, and both dialogs learned the error copy so it is not a dead-end 403. Plus #47 (milestones were dropped on every load — real data loss, now with a test pinning the whole class), #48, #49 (needed BOTH halves — the adapter stub alone leaves the banner up), #50, #51. Block C — **1,840 lines of dead code across 13 files**, proven by a module-reachability BFS from every real entry point and confirmed by an unchanged bundle (3,849.67 kB before and after); six were not on the briefed list. "Leave it and document it" won both Tier-2 judgement calls, and the third **corrected the brief**: `last_updated_at` IS written by a live trigger on four tables, so the recommended drop would have broken every RABBIT UPDATE → `COMMENT ON COLUMN` instead. WIL-1001/1002/1003 kept, not deleted and not wired: both options are barred here (deleting removes visible Diagnostics rows, wiring adds log rows) and two of the three **cannot** be wired client-side at all, because at sign-in failure there is no session for `app_events`' INSERT policy to accept. Tier 3 cleared #58 plus two sites it did not name. **CI blind spot fixed:** the pgTAP failure-replay list stopped at 32, so suites 33–38 failed invisibly — which is exactly how 0030's trigger silently broke `25_app_events`' unfiltered count. All 38 suites (605 assertions) now verified against a new migration before pushing, not just its own suite. Vitest 343/343. **`package.json` → 1.0.0, CHANGELOG.md written, `docs/RELEASE_TESTING.md` written. NOT tagged, NOT merged to `main` — Audrey reviews first.** | `b726e75`, `6ab10c6` |

| 18 | 2026-07-31 | **The invite path** (client + templates only; no migration, no Edge Function, no deploy). Two independent defects, either of which alone made an emailed invite unusable. **#73** — `{{ .ConfirmationURL }}` is a bare `GET /auth/v1/verify?token=…`, so following the link IS the redemption; staging's own rows show both real invites confirmed **12.0 s and 16.7 s** after sending, to a corporate domain and to Gmail, with `email_confirmed_at`/`last_sign_in_at` set and both tokens cleared, before either recipient opened the mail. Templates now carry `{{ .TokenHash }}` to `{SiteURL}/#/recovery?token_hash=…&type=…`, and `verifyOtp` runs only from a button's onClick — verified on the production bundle with the resource-timing buffer confirmed open (2/250): **zero** cross-origin requests on load, **exactly one** (`/auth/v1/verify`) on click. **#74** — found by running the *existing* parser against the fragment GoTrue v2.194.0 actually emits, before writing any replacement: it required `type === 'recovery'`, but `verify.go` echoes the requested type, so an invite arrives as `type=invite` and every **live** invite link was rejected as "already used". Nobody had ever seen it because no invite had survived long enough to be clicked; fixing #73 alone would have shipped a still-broken flow. Parsing extracted to `src/cloud/auth/recoveryLink.js` (pure, 27 cases, one pinning the OLD predicate); both legacy fragment shapes still accepted for links in flight. `{{ .SiteURL }}` not `{{ .RedirectTo }}` — the desktop app's origin is `http://127.0.0.1:<dynamic port>`. #75 (`email_change.html`, unreachable flow) ACCEPTED; #76 (comment expansion) investigated and **dismissed** — GoTrue uses `html/template`, which elides comments. Vitest 353 → 380. **Templates must be re-uploaded by hand to all three projects before any invite works.** | `28dec64` |
| 19 | 2026-08-02 | **End the AI outage, and make the next one impossible to hide** (client + ai-proxy; no migration). Anthropic retired `claude-sonnet-4-20250514` on 2026-06-15; WILSON hardcoded it at 17 of 28 call sites, so most of its AI had been failing for 47 days behind a generic "try again". **Confirmed by measurement, not inference** — that id returns `404 not_found_error` while `claude-haiku-4-5-20251001` returns 200 on the same call. All 28 sites now resolve through `modelFor()` against `src/lib/aiModels.js`; RABBIT's `MODEL_MATRIX` (live ids) became `MODEL_KEYS` (registry keys). `noHardcodedModels.test.js` fails the build on a raw `claude-` literal in `src/`, an unknown `modelFor()` key, a bad `MODEL_KEYS` entry, or a retired `VALIDATION_MODEL` — **proven by breaking it three ways, not by watching it pass**. `ModelWarningBanner` surfaces D6 loud fallback. **The plan's "close to a find-and-replace" framing was wrong and a probe caught it before any of it was acted on:** O.T.T.E.R.'s `web_search_20250305` + old beta header are **fine** on sonnet-5 (five working call sites nearly rewritten for nothing); the Validator's `tool_use` recursion ended on an assistant turn and **400s** as a prefill (fixed, now `pause_turn`, bounded at 3); and adaptive thinking costs **latency, not truncation**. **ai-proxy's body whitelist silently dropped `thinking`/`output_config`** — which also invalidated a probe's own control — now forwarded (shape-checked) and deployed to all three envs. ai-proxy's **~150s Edge deadline is a cliff**: the deck ran 137.9s/15194 tokens unset, so `effort: medium` (measured against low/disabled/unset) sits on the REGISTRY entry → 69.1s/7642, and one call instead of up to four continuations. **Block E: 4/4 full-size generations parse.** D.O.G. prompts tab gained a per-function model picker (`userModelPrefs`, user tier, live without reload); a label bug found by rendering it, not reading it. Three re-runnable probes under `scripts/probes/`. New `docs/OUTSTANDING.md` — broken-and-unfixed only — wired into the session-start and close-out rituals. Vitest 416 → 454. | `b52beb3`, `56152f3`, `6da7b74` |
| 20 | 2026-08-02 | **The model control plane** (migration 0031, Edge Function `operator-models`, three consoles). S19 made every call site resolve through one registry and left the three override tiers empty; S20 fills them, so Audrey approves a model once and every company can use it. **Four tables, not the three the plan listed** — Block E's "migrate `userModelPrefs` into the user tier" had nowhere to land without `user_model_overrides`. **D4 has teeth in the database**: both override tables FK `platform_approved_models`, so an unapproved model cannot be *stored* by any client — MEASURED, the insert fails on the FK. **D5 is unbypassable**: neither operator-owned table has a write policy or write privilege, so `operator-models` under service_role is the only writer — MEASURED, even a platform operator gets `permission denied`, matching the rule suite 35 already pins for `platform_audit`. Four plan errors caught by reading rather than trusting: the migration number (there was no 0031), the table count, "pgTAP suite 39" singular (CI's guard globs `*_<table>.sql`, so four tables need four files — and `rls.yml`'s hardcoded replay list needed extending, the same blind spot S17 fixed at 32), and "reuses the proven `validateKey` call shape" — the body is the same but the **status handling is inverted**, because `validateKey` validates a KEY and returns ok on a 404. Review also caught two silent-failure classes testing would not have: `setModelSources` replaced all three tiers (a workspace loader would blank a user's choices, with no warning because an *absent* tier is not a *misconfigured* one), and effort had no delivery path — `tuningFor` is spread at exactly ONE call site, so a control for all 28 would have been 27 settings that save, display and do nothing. `SELECTABLE_MODELS` deleted, its ids seeded into the catalogue. **42 pgTAP suites / 624 assertions** (was 38/569), **472 vitest** (was 454), both vite entries clean. 0031's post-conditions proven non-vacuous by injecting four defects. **0031 applied to dev + staging and verified on both; prod pending.** | `6e422d2`, `818b358` |
| 21 | 2026-08-02 | **Data correctness and the reliability sweep** (migration 0032; two panels; no Edge Function change). **0031 and `operator-models` finally reached prod** — dry-run first, then verified by query rather than by the CLI's success line: four tables, RLS enabled *and* forced on all four, both D4 foreign keys, catalogue seeded, `anon` grants 0. **A — `rate_cards.type`**, the column the whole internal-vs-general feature keys on and which no migration ever added; `supabaseAdapter.js:861` upserts through a pure DENYLIST, so it reached PostgREST and every card create died with PGRST204. One root cause, both of Audrey's reports. `NOT NULL DEFAULT 'general'` **is** the backfill — DDL, catalog-only on PG11+, fires **no** row triggers; the nullable-plus-`UPDATE` alternative both investigators recommended would have fired `fn_audit_touch`, NULLing `updated_by` on every existing card under the CLI and writing an `edit_history` row each. No unique index on `(workspace_id, type)`: every row backfills to `'general'`, so any workspace with two cards would abort the migration — and suite 07's own fixtures are that shape. **The REVOKE was unplanned and is the session's real find:** the suite grew the standing `ok(NOT has_table_privilege('anon', …))` probe and it FAILED — `anon` holds ALL on `rate_cards` and on **26 of 36 public tables**, 0011's blanket grant still in force. Two independent investigators had each reasoned, correctly from the migration text, that ADD COLUMN needs no REVOKE; neither queried the existing grant state. 0032 closes one table, 25 filed. **0032 also removes an accidental brake:** eight `useRateCard()` consumers, no provider between them, all auto-create on seeing zero cards — invisible in cloud only because the insert failed. The local store banked four `Internal Rate Card` rows created inside 53 ms. A shared in-flight promise fixes it; **proven by removing it — eight mounts then create sixteen cards.** **B — the planned "bound 22 `getSession()` sites" was deliberately NOT done**: measured against auth-js 2.101.1, supabase-js awaits `getSession()` inside `_getAccessToken()` for every PostgREST call, and `withTimeout` races without aborting, so an abandoned call keeps the global per-`storageKey` lock while everything else queues in `pendingInLock` with no acquire timeout. A sweep would have gone green and left the app equally stuck. Fixed the two reachable places instead — `ProfileSection`'s loader got `try/catch/finally` (its *other* `Promise.all` leg is unbounded too), and `aiProxy` got its own timeout code rather than telling a stalled-but-signed-in user to sign in. **C — avatar**: four hypotheses falsified by measurement (column, bucket, policies, render guard all correct; the guard trigger RAISES, and permits `avatar_url` on self-update), and proven *independent* of B. Fixed the success-masking — a zero-row UPDATE raises nothing and was merged into local state anyway, and the `catch` never cleared the preview, so every failure looked like a save until reload. Root cause still open, and said so. **D — `PasswordSection`** on `updateUser({ password })`; no current-password field, because the only client-side way to verify one is `signInWithPassword`, which re-issues at aal1 and would silently break every operator Edge Function (`OperatorLogin.jsx:69`). **42 suites / 629 assertions**, `collected == planned` in all 42; **482 vitest** (was 475); both vite entries clean; all four CI jobs green. 0032 applied and verified on dev, staging **and** prod. | `10fcd29` |

| 22–23 | 2026-08-03 | **One conversation, two units of work** — rows kept short here because the evidence lives in `OUTSTANDING.md`'s session log and `MASTER_PLAN_S19_ONWARD.md`. **S22**: migration 0033, the `anon` privilege sweep — 25 tables to 0, plus seven anon-executable SECURITY DEFINER functions (a live pre-auth RLS bypass, served at `/rest/v1/rpc/`) and 0011's still-armed `ALTER DEFAULT PRIVILEGES`, neither of which was in the plan. The lesson is **grantees, not grants**: those functions were granted to PUBLIC, so `REVOKE … FROM anon` would have been a silent no-op reporting success. **S23**: migrations 0034 + 0035 unblocked R.A.B.B.I.T. item creation (`tasks.asset_id` nullable + `phase_id`, `tasks_select` relaxed, `assets.start_date`/`due_date`), and established that `sanitize()` is a DENYLIST while `toColumns()` is the allowlist. | `494a13d`, `8709b1e`, `2727328`, `c21e47d` |
| 24 | 2026-08-03 | **The budget system gets a database** (migrations 0036 + 0037; no Edge Function change). Audrey: *"the default contingency and margin come up as 0% and updating the percentage doesn't save."* Not a save bug — MEASURED against a full census of all 36 public tables on dev **and** staging, there were **no budget tables at all** and none of the nine budget settings the UI reads existed as columns. **The finding that reframed the session: the React was already complete.** `useBudgetLines`, `CrewTeamTab`, `TalentTab`, `ClientViewTab` and `BudgetView` already implemented the bid, the line × pay-period actuals grid, versions with an immutable snapshot, per-line margin/contingency inheriting from the project default, and the role-priced bid Audrey specified independently. It had simply never been able to persist anything, so the work was migrations and adapter, not React. 🚨 **The plan documents named the wrong columns** — they said `margin`/`contingency`; the UI reads `budget_margin_pct`/`budget_contingency_pct` and seven more, so adding `projects.margin` would have closed the documented gap and left the reported bug 100% intact. Every column shipped came from a grep of the views. **0036** added the nine settings plus `project_members.project_title` — a NEW column, confirmed with Audrey first, because `project_role` is the permission column behind every RLS gate and a job title written there would make controls silently vanish. **0037** added `budget_lines`, `budget_actuals` (a line × period GRID, UNIQUE per cell, with a `source` seam for the timecard system that does not exist yet), `budget_versions`, `expenses` and **`project_rate_overrides`** — the one genuinely new idea, because rate cards are workspace-wide and without it a manager negotiating one project's rate would silently rewrite every other project's numbers. All five are **manager-only at the RLS layer** via `can_access_project_money()`: a workspace admin of the project's own workspace, or a project manager. Confirmed with Audrey because her live data was ambiguous — `derek` is a workspace manager but only a project *member*, and does not qualify. Deliberately **no unstaffed-project opening**, unlike `can_write_project()`; money fails closed. `supabaseAdapter` gained the fifteen budget methods it never had (every consumer feature-detects, and `useBudgetLines.js:60` returns *before* `setLoading`, so cloud rendered an empty budget with no error at all), plus `listTeamMembers` over the existing `workspace_directory()` RPC and `teamAssignments` in `loadProject`. **`projects` had no COLUMN_ALLOWLIST entry and `toColumns()` returns the object untouched when a table has none** — that is the actual mechanism behind "doesn't save". **pgTAP 42 → 47 suites, 655 → 721 assertions**, `collected == planned` on every run; suite 43 proves the gate end to end and suite 47 proves a project override leaves the company rate card untouched. `budgetMath.js` + **24 vitest (488 → 512)**, proven by breaking the source three ways. Both vite entries clean, all four CI jobs green. 0036 + 0037 applied and verified **by query** on dev, staging **and** prod. **Follow-up the same session (`dfdf386`), from Audrey's three replies:** the Budget tab is now HIDDEN from non-managers via `canSeeProjectMoney()` — deliberately not a `PROJECT_ACTIONS` entry, because `canOnProject()` would be wrong three ways (it bypasses for app_role manager, opens on unstaffed projects, and fails OPEN while loading); it fails CLOSED, so the tab APPEARS late for a project manager rather than vanishing late for a reviewer. And **invoice attachment works on the web**: both tabs called `window.rabbitDesktop.pickFiles` and a `localhost:19854` route, so on the beta the first line returned and the button silently did nothing. `InvoiceAttachment` replaces both copies with one adapter-backed path (a plain `<input type="file">` — Electron's renderer is Chromium, so the bridge was never needed to pick a file). 🚨 **Migration 0038 exists because the obvious version would have leaked:** MEASURED first, `files_select` (0014) and `rabbit_files_select` (0027) both admit any workspace member who can see the project, so an invoice uploaded the ordinary way would have been readable — as the PDF — by the very people 0037 had just denied the amount. Gated at BOTH layers independently: `files.is_financial` (all four policies DROP+CREATE’d, the clause in UPDATE’s USING *and* WITH CHECK so the flag cannot be cleared to reach the row) and a reserved `invoices` path segment (`IS DISTINCT FROM`, not `<>`, or a short path yields NULL and breaks every ordinary upload). 🚨 **0027 → 0038, and replaying 0027 silently re-opens invoices** while its own post-condition reports success — same trap shape as 0011 → 0033. pgTAP `05_files` 5 → 9; vitest **512 → 521**; 0038 applied and verified by query on all three envs. | `b07b6c9`, `dfdf386` |

| 25 | 2026-08-04 | **Scenes, shots, levels and experiences exist on both adapters** (migration 0040; no Edge Function change). Audrey: *"it shouldn't only be cloud. it should be able to live in a local server as well."* So the goal was PARITY, not a cloud port. They were **doubly** dead in cloud: `supabaseAdapter` threw "table not yet created" for all eight write methods and implemented none of the four list methods, **and** `Rabbit.jsx:85-87` hides the three TABS on `projects.scenes_enabled`/`levels_enabled`/`experiences_enabled`, which were not columns either — so nobody had ever reached the views to discover the adapter threw. Both halves had to land together, which is exactly why the flags arrive **with** the entities and not before: a toggle that reveals a view whose every write throws is worse than a hidden one. **0040** creates all four tables with RLS enabled *and* forced, 16 policies, no `FOR ALL` arm, workspace-stamp and touch triggers, and **zero privileges held by `anon` OR `PUBLIC`** — scanned across all four rather than checked against the list written, per the S22 grantee lesson. They gate on `can_write_project`, **not** `can_access_project_money`: scenes are ordinary project content and a team member must be able to create one, so borrowing the money gate would have locked the whole feature to managers with no symptom until someone tried. Suite 48 asserts a member CAN write and a reviewer can read but not. 🚨 **THE PLAN DOCUMENTS NAMED THE WRONG COLUMN FOR THE THIRD SESSION RUNNING.** Both said to add `code`, citing `ClientViewTab.jsx:129` reading `project?.code`. MEASURED: nothing in `src/` or `electron/` has ever *written* a bare `code` key — the writer is `ProjectSummaryView.jsx:605`, `update('project_code', v)`. `code` was a **wrong read**, exactly like `project.name` (the column is `title`), not a missing column; adding it would have closed the documented gap, passed review, and left the client topsheet printing `--` forever. The habit that catches this class — **grep for the WRITER, not the reader** — also turned up thirteen further drifted columns no plan had listed (`scene_separator`, `fps`, `uses_realtime_engine`, five `engine_*`, `project_type`, `project_tier`), all written by the Project Control Panel and all silently discarded; `projects` went **31 → 48 columns**. Suite 48 probe 18 now asserts `projects.code` does NOT exist, so the documented-but-wrong fix fails loudly if attempted later. 🚨 **The S23 trap, deliberately not repeated:** `shots.scene_id` is nullable and `shots_select` hops to the **project**, never the scene — `ScenesView` renders unparented shots under "Unlinked shots", a real displayed state, and 0014's `tasks_select` EXISTS-on-assets arm is precisely what made relaxing `tasks.asset_id` *move* the failure instead of removing it (write lands, read denies, no error anywhere). Suite 49 inserts an unparented shot and reads it back, so tightening that policy fails loudly. Auto-naming extracted to `entityNaming.js` — it had **five** copies in `ScenesView` and a sixth, subtly different, preview in `ProjectSummaryView`, which is how a settings preview drifts from what the buttons actually produce; it is computed client-side and the result is PERSISTED, so two implementations would mean two naming schemes for one project the moment anyone switched backend. Also: the client topsheet prints the real title and code, and the **Budget Variables block is manager/admin-only** (Audrey: *"the producer manager should be the only one to see the budget section, the rest is fine"*), with the grid collapsing to one column rather than leaving a blank half. **Coverage, which S23 named as the reason a total failure of the app's primary action shipped unnoticed: pgTAP 47 → 51 suites, 721 → 768 assertions** (`collected == planned` on every suite, whole set re-run green against dev), **vitest 521 → 556**. Three new test files, each **proven by breaking the source** — removing the `levels` allowlist entry fails 3, omitting `scenes` from the cloud bundle fails 3, swapping `??` for `\|\|` in the naming fails 3. `columnAllowlist.test.js` imports the REAL allowlist instead of mirroring it (the older adapter tests mirror, and say so as a limitation), and `supabaseLoadProject.test.js` closes a gap that had shipped twice: the existing bundle-key guard only ever covered the **local** adapter, which is why S24's permanently-empty `budgetVersions` was found by reading rather than by a test. The cloud `loadProject` absorbs 42P01 on the four new lists only, because `feat/multi-user-v1` auto-deploys the staging-backed beta on push and a missing feature must not become every project failing to open — a genuine RLS refusal still throws. Both vite entries clean, all four CI jobs green. 0040 applied and verified **by query** on dev, staging **and** prod. **Not delivered and recorded as such:** task templates (a fifth table and suite, not a method — deferred to S26) and runtime confirmation of the two assignee dropdowns (needs a signed-in staging session nothing automates). | `183b4c2` |
| 26 | 2026-08-04 | **The backend-agnostic folder tree, and the project manifest** (migration 0041; no Edge Function change). Audrey: R.A.B.B.I.T. is also a project file manager and the tree must reflect in *whichever storage backend the company selected* — not local disk only, which is all `fs.mkdirSync` in `electron/main.cjs` could ever do. `FileManager.jsx:84` has computed `parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' : 'ASSETS'` since it was written, against two folders **nothing has ever created**; levels and experiences were not in that switch at all. **A TABLE, not a path convention** (Audrey's decision, 2026-08-04, settled): Supabase Storage has no real folders — it is object storage with prefixes, so an *empty* folder cannot exist as an object, and "toggling a category off must never delete the folders" needs a folder that outlives its contents. **0041** creates `public.folders` with RLS enabled *and* forced, four policies, no `FOR ALL` arm, nine CHECK constraints, eight FKs and **zero privileges held by `anon` OR `PUBLIC`** — verified by scanning every grantee rather than trusting the REVOKE (the S22 lesson). It gates on `can_write_project`, **not** the money gate: a team member has to be able to create an asset, and an asset that cannot get a folder has not really been created. **Paths are computed CLIENT-side** in `folderPaths.js` and stored, following S25's naming decision for the same stated reason — Local Server is a JSON bundle with no Postgres in it, so a generated column would exist on one backend only. Five nullable entity FKs rather than a polymorphic `(type,id)` pair, because a polymorphic id cannot be a foreign key. 🚨 **THE FOURTH CONSECUTIVE PLAN-VS-CODE MISS, and the first where the right answer was to add NOTHING.** Both plan documents said to add `projects.files_dir`, **with a correct citation to a real writer** (`ProjectSummaryView.jsx:1010`). Grepping for the writer — the habit that caught S24's `margin` and S25's `code` — would have *confirmed* the plan and produced a dead column. MEASURED: the block renders only inside `{project?.files_dir && …}`, i.e. when the value is already non-null, and only the local relink route ever sets one — `relinkScan`/`relinkApply` are `local_server` ONLY, zero occurrences in the other two adapters. **So the question is now two questions: who writes this field, and can that writer RUN on the backend the column would live on.** Note the distinction that had to be drawn: `code` is a wrong NAME that must never exist and pgTAP asserts its absence; `files_dir` is the RIGHT name for a feature with no cloud implementation, so nothing asserts its absence — it arrives WITH relink. `folder_slug` and `folder_root` were checked the same way and both have real writers; `folder_root` is reachable **today** from the desktop app in EITHER backend and was being dropped with a console warning. `projects` 48 → **50**. **The double-folder hazard is closed at three layers**, because it is the named risk of the whole session: `folderParity.test.js` reads `electron/main.cjs` as TEXT and compares `fileSlugify`, the category list AND both planners against the renderer's (the duplicate is unavoidable — the main process cannot import from the renderer bundle, which is why S25 removed the third copy first); 0041 carries `folders_project_path_uniq` plus a partial unique index per entity FK; and both `ensure*` implementations find the existing row by **entity FK, never by path**, because a rename CHANGES the path and a path lookup would create the second folder itself. **Proven by breaking it three ways.** **A unit test caught a real defect before it shipped:** `fileSlugify` strips everything non-alphanumeric, so an entity named `..` is TRUTHY and slugifies to `''`, giving a path of `SCENES/` — an empty final segment. The idiom every existing caller uses (`name || 'Untitled-Thing'`) does not catch it; the guard has to be on the OUTPUT, in both copies. **`PROJECT.json`** is written into the project folder — a generated MIRROR, the database staying authoritative (Audrey, 2026-08-03), stating that fact *in the file* for whoever finds it on a drive. 🚨 **It deliberately EXCLUDES per-member rate overrides, which is the one part of Audrey's request this session did not deliver.** MEASURED: `project_rate_overrides_select` is manager-only via `can_access_project_money`, while `rabbit_files_select` admits any project member to any object under `projects/<id>/` whose third path segment is not `INVOICES` — and the manifest has no third segment. Including rates would hand every team member the figures RLS had just denied them: the S24 invoice defect in a new file. Margin and contingency ARE included, checked separately — `projects_select` admits any active workspace member, so they were already readable. 🚨 **The feature commit turned the whole app into a blank page and THREE OF FOUR CI JOBS WENT GREEN.** `ensureProjectFoldersFor` listed `writeManifestSoon` in its `useCallback` dependency array while the `const` was declared fifty lines below; a dependency array is evaluated **during render**, so `RabbitProvider` hit the temporal dead zone on first render and `#root` had zero children. 658 vitest, 52 pgTAP suites and both production builds all passed — **nothing in the vitest suite MOUNTS the provider** (no `@testing-library` in this repo), a TDZ error is valid JavaScript to bundle, and there is no eslint config so `no-use-before-define` never ran. Only Playwright saw it. Fixed in `ca27d47`, reproduced and re-verified against the dev server before and after (`#root` 0 children → 1, "LOGIN USERNAME PASSWORD SIGN IN"). **Playwright's green is load-bearing in a way the other three are not.** Also: `rls.yml` gains `folders` in `RLS_TABLES` **and** 52_folders in the failure-replay list — and adding it exposed that the replay list had **never** been exhaustive (thirteen original Session-2 suites missing, so a failure in any of them produced the misleading "no ERROR lines" annotation S17 was burned by); all 52 are now listed. `scripts/tap-all.mjs` runs the whole set in one command and fails on `planned != collected` as loudly as on an assertion. **pgTAP 51 → 52 suites, 768 → 790 assertions** (`collected == planned` on every one), **vitest 583 → 658**. All four CI jobs green. 0041 applied and verified **by query** on dev, staging **and** prod. **Not delivered and recorded as such:** rates in the manifest (needs a money-gated path — Audrey's call, sized with S27), task templates (deferred a second time), and runtime confirmation of the two assignee dropdowns. | `071682b`, `ca27d47` |

| 27 | 2026-08-04 | **Files reach every backend, and the manifest can be rewritten** (migrations 0042 + 0043; no Edge Function change). 🚨 **THE PROJECT MANIFEST COULD ONLY EVER BE WRITTEN ONCE PER PROJECT, and a comment asserted the opposite.** S26 shipped `PROJECT.json` as a mirror "rewritten whenever settings change"; Supabase Storage implements upsert-over-an-existing-object as an **UPDATE on `storage.objects`**, and that bucket has never had an UPDATE policy — 0027 created SELECT/INSERT/DELETE, 0038 and 0039 rewrote those and added three more for invoices, all SELECT/INSERT/DELETE. So the first write landed and every later one was refused, silently, for the life of the project: `writeManifestSoon` caught the throw and logged *"the manifest is a mirror and is rewritten on the next change."* Found by reading the policy catalogue and **measured before anything was written** — INSERT succeeds, UPDATE affects **zero** rows, and the same UPDATE against `user-avatars` succeeds, so the probe could see a presence rather than merely fail to see an absence (standing rule 2). Local Server was never affected. **0042** adds the UPDATE arm with **both** `USING` and `WITH CHECK` pinning the same side of the gate, so an object cannot cross the boundary in either direction. 🚨 **It also reduces the reserved-segment list to ONE definition.** Audrey chose (2026-08-04) to have project rates travel with the project folder, which needs a money-gated path beside `INVOICES`; adding it the existing way would have written the segment name into **eight** policies that all had to agree, and the base three had to exclude **both** — permissive policies OR together, so a base policy that forgot `FINANCE` serves the rates to every project member however correct the gated policy is. That is precisely how 0038 inverted the invoice gate before 0039 fixed it in six places. `public.rabbit_money_segment(text)` is now the only definition: the three base policies negate it, the four money policies (renamed from `rabbit_files_invoices_*`) assert it, and a third segment is a one-line change that cannot desynchronise. **It is NULL-safe by construction and that is load-bearing** — `projects/<id>/PROJECT.json` has no third path segment, so a bare `upper(seg) IN (...)` returns NULL, `NOT NULL` is NULL, and a NULL policy expression FAILS, making the manifest unreadable **and** unwritable by everybody; removing the coalesce fails pgTAP 53 probes 1, 5 and 11 together. **0043** gives `files` the four entity links `FileManager.jsx:88-92` has always filtered on plus `folder_id` (24 → **29** columns) — **not** the `files_dir` mistake, because the test is who writes it, whether that writer can run here, **and whether anything calls it**, and all five are written by `uploadFile` on both writable backends. All `ON DELETE SET NULL`, matching `phase_id`/`asset_id`/`task_id` since 0000: a CASCADE would delete file ROWS when a scene is deleted and strand their blobs. 🚨 **THE FOLDER TREE HAD NEVER PRODUCED A ROW ON ANY ENVIRONMENT** — `public.folders` held **0 rows** on dev (3 live projects), staging (1) and prod (0). 0041 was correct, verified by query, covered by 22 pgTAP assertions and green in CI; `ensureProjectFoldersFor` simply had **one caller**, `createProject`, and every project in existence predates it, so a tree only appeared if someone happened to create an entity. **A feature with no caller has no symptom, and only a census distinguishes "built" from "working".** It now reconciles on load, idempotently, skipping read-only backends. **The file layer was three disconnected stores:** `public.files` + `rabbit-files` (real, but the only surface using it was a read-mostly table); `managedFiles` (local_server-ONLY, and `FileManager` gated it on `window.electronAPI` — true whenever WILSON runs as a desktop app **including when the selected backend is Supabase** — so files were unreachable from every entity surface in cloud, and dead on the web twice over); and `project.documents`/`visualAssets` (base64 data-URLs the cloud adapter **refuses**). The third is worth stating precisely because it was nearly written up wrong: those uploads are **not** silent data loss — S15 made create and update throw deliberately. The defect was that the honest error was a **dead end**, and completing §6 #31 (routing that UI through `uploadFile`) is the fix; Local Server keeps the legacy arrays, where they work and D.O.G. reads them. `FileManager` now picks a store via `ctx.supportsManagedFiles`, and Resources gained a folder + manifest panel. **Rates ship as `FINANCE/RATES.json`** on both writable backends, stating its own confidentiality in the file. **A storage-path change was FREE this session and will not be again** — 0 files, 0 folders, 0 storage objects, 0 manifests measured on all three envs; the ID-based object key was KEPT deliberately, because its third segment *is* the money gate. **pgTAP 52 → 53 suites, 790 → 808 assertions** (`collected == planned` on every one), **vitest 658 → 680**. All four CI jobs green, Playwright included; the app was re-confirmed to mount (`#root` 17 descendants, login renders — and `RabbitProvider` wraps the whole tree *including* the unauthenticated branch, so that is real evidence it did not throw). **Every new probe proven by BREAKING it**: drop the UPDATE policy (probe 6, have 0 want 1); gate `INVOICES` but forget `FINANCE` (a plain member reads the rates mirror); drop the coalesce (the manifest becomes unreachable); CASCADE instead of SET NULL (the file row dies with its scene). 0042 and 0043 applied and verified **by query** on dev, staging **and** prod. **Not delivered and recorded as such:** task templates (deferred a third time — this time by Audrey's explicit choice, asked directly), and **runtime confirmation of any new file surface**, which is the same gap that has kept the two assignee dropdowns open since S24. | `5384d4e` |

| 28 | 2026-08-04 | **Task templates reach the cloud, and their roles survive the trip** (migration 0044; no Edge Function change). The **oldest open item on `OUTSTANDING.md`**, deferred by S25 and S26 for room and by S27 by Audrey's explicit choice. Not a missing adapter method: Local Server stores one JSON document per template in its own directory (`electron/main.cjs:2610-2656`), workspace-scoped with a project-scoped read, so cloud parity needed a table, RLS, a suite and five methods. 🚨 **THE FEATURE HAD NEVER PRODUCED A ROW ON ANY BACKEND, AND THIS WAS MEASURED BEFORE A LINE WAS WRITTEN.** `%APPDATA%\wilson\rabbit-data\task-templates\` exists and is **empty** — zero templates on Local Server too, where it has worked the whole time, not merely in cloud where it was structurally impossible. That is S27's "a feature with no caller has no symptom" applied *before* the fact for the first time: creating the table would have made 54 pgTAP suites and 698 unit tests pass and changed nothing on screen, so the exit criterion was **"a template can be created and APPLIED"**, not "the table exists". `scripts/probes/task-templates-e2e.sql` walks create → project read → asset stamped → template applied → **roles present** → template deleted without taking the asset, as an authenticated user against real rows, and rolls back: **6/6 on dev AND staging**. ✅ **Audrey settled the one question that genuinely gated the SQL** (2026-08-04): *workspace admins and managers globally; project managers additionally for templates pinned to their own project.* Asked because the local server has no roles at all, so its wide-open routes say nothing about intent — and because the two nearest precedents **disagree with each other** (money admits a project manager but not a workspace manager; the control panel admits reviewers but not members). A draft of the S28 brief had asserted a different answer as a finding and it was struck out before the session began; that removal is why this is right. `can_write_task_template(uuid)` is the one definition, mirrored on the client by `canWriteTaskTemplate()`. 🚨 **A DEAD BRANCH WAS HIDING A LIVE BUG, IN TWO PLACES.** `ProjectAssetsView` applied a template by sending `role_slug` — not a column; `tasks` has `assigned_role_slug` — and because `tasks` **has** an allowlist entry, `toColumns` dropped the key with a console warning instead of rejecting the request. Tasks were created successfully **with no role**, and every bid built from them priced at nothing. The probe's breaker reproduces it exactly: omit the key, as `toColumns` did, and step 5 reports `roles were [<NULL>, <NULL>]`. ⚠️ **The allowlist tests could not have caught it** — they pin `toColumns`, the *mechanism*, and say nothing about which key a CALL SITE sends, so reverting the view leaves them all green; `taskPayloadKeys.test.js` closes that half and was proven by reverting one site (it named `ProjectAssetsView.jsx:1731`). It is narrow on purpose — the argument object of an `addTask()` call and nothing else — because `role_slug` is legitimate inside the template jsonb **and** a real column on `budget_lines`. **`tasks` is JSONB, not a child table, and the reasoning is written into 0044's header** so the next session need not re-derive it: the editor's only write path is whole-array replacement (`saveTasks → onUpdate({tasks})`), `depends_on` holds sibling ids scoped inside one template, and duplicate remaps every id at once — with the cost (template tasks are not joinable in SQL) stated rather than glossed. **The tenancy leak was NOT ported:** the local project read filters on `project_id` alone and would hand one workspace another's global templates; the cloud adapter runs the same filter and RLS supplies the missing workspace scope, pinned by suite 54 probes 8-9 **with a presence control**, so "sees nothing" cannot pass on an empty table. ✅ **`assets.task_template_id` arriving here is the `files_dir` rule being FOLLOWED, not excepted** — "a column for a feature with no cloud implementation is schema debt" was always "it arrives WITH the feature", and both writers became reachable in the same commit; `files_dir` stays out because its writer still cannot run on this backend. Three shapes now, not to be collapsed: `code` is a wrong NAME whose absence is asserted, `files_dir` is a right name still waiting for its feature, `task_template_id` is a right name whose feature has landed. 🚨 **SIX BREAKERS RAN AND TWO DID NOT FIRE — both corrected a COMMENT rather than the code.** Weakening `WITH CHECK` to the workspace clause fails probe 15 alone; **omitting `WITH CHECK` entirely leaves 24/24 passing**, because Postgres reuses `USING` as the new-row check — the migration's first draft confidently claimed the opposite, and only running it showed so. The real hazard is a `WITH CHECK` *weaker* than its `USING`, which is the shape `folders_update` and every other UPDATE policy here already uses, so copying the house style is what would open it. Removing the `COALESCE` also left 24/24 passing, exactly as that function's own header predicted — a breaker written to *confirm* a stated claim rather than refute it. The other four fired as designed (`can_write_project` instead → probes 11 and 17; CASCADE instead of SET NULL → 22; composite FK dropped → 20). Also: the Settings template manager was **ungated** before this, harmless only because Local Server has no roles — a member pressing New Template would have watched a row appear and vanish, since `TaskTemplateManager` has never rendered its hook's `error`. Both are fixed; a project manager's create now lands **pinned to their own project**, the only thing they may create. **pgTAP 53 → 54 suites, 808 → 832 assertions** (`collected == planned` on every one), **vitest 680 → 698**, build clean, all four CI jobs green including Playwright. 0044 applied and verified **by query** on dev, staging **and** prod (RLS enabled *and* forced, four policies, no `FOR ALL`, composite FK present, `assets` FK `confdeltype` = `n`, zero privileges held by `anon` or `PUBLIC`). **Not delivered and recorded as such:** the runtime verification sweep — the two assignee dropdowns, S27's file surfaces and the `canWrite` gate. A concrete four-item checklist went to Audrey in the chat rather than a general ask; the observations had not returned before the work was committed, so all three carry to S29 **unnarrowed**. Fourth session running, and it is not a code problem. | `06bf564` |

Between Sessions 3 and 4 (completed 2026-07-27): GitHub secrets, all functions
deployed to staging/prod, access-token hook enabled everywhere, Resend domain
verified, templates uploaded, `wilsonapp.com` → `petalstudios.co` swap.

**Session 17 remains** (locked #19 as amended 2026-07-30): S15 operator console
+ TPN hardening ✅ · S16 systems documentation & design pack ✅ · **S17 release
(v1.0.0)**. Launch prompt ready: `docs/sessions/SESSION_17_prompt.md`.

**Migrations 0000–0030 are deployed to dev + staging + prod** (S15 added
0028 + 0029; S17 added 0030). **0031 (S20) is applied to dev + staging, NOT
prod** — both verified after apply with the same seven-check query (four tables
with RLS forced, zero write policies on the operator-owned pair, `authenticated`
without INSERT, `anon` without SELECT, four seeded catalogue rows, the widened
`platform_audit` CHECK, and the D4 foreign key). **Edge Functions:** the twelve
pre-S20 ones are on all three envs; S17 redeployed `invite-member` (it now
bundles `adminGuard`). S20 added a thirteenth, `operator-models`, **on dev +
staging** (401 unauthenticated / 405 on GET measured on both), and deployed the
S19 `ai-proxy` to wilson-dev. ~~**prod's `ai-proxy` still silently drops
`thinking`/`output_config`.**~~ **WITHDRAWN (S21, 2026-08-03)** — dev, staging
and prod all run **byte-identical** `ai-proxy` source matching HEAD, and the
tuning forwarding was confirmed at runtime on staging (probe 7a/7b:
`thinking=1, out=551` vs `thinking=0, out=453`). The claim rested on deploy
**version numbers**, which count per project and are not comparable across
them. **Diff the source, never the version.**
Staging has `ANTHROPIC_API_KEY` set (post-S12); dev/prod keys still per
OWED_AUDREY §5, and `WILSON_AI_KEY_SECRET` is owed on every env per §9C.

⚠️ **Do not trust any sentence in this file about which project is linked —
including this one.** The file is `supabase/.temp/linked-project.json` (not
`project-ref`, as this section said through S21). **Read it before running
anything that writes**, and re-link deliberately.

Measured 2026-08-03 (S22): it was on **`wilson-dev`** (`eqjzmnvkrakroyqxfsvw`),
not staging. The close-out ritual re-links to dev at the end of every session,
so dev is the expected resting state; the "linked to staging" claim above dated
from S18 and had been wrong for four sessions.

---

### Session 22 (2026-08-03) — the privilege sweep, storage copy, task diagnosis

`494a13d` + `8709b1e`. **Migration 0033**, applied and verified **by query** on
dev, staging and prod.

- **`anon` privilege spread closed: 25 tables → 0.** Proven safe *before* any
  SQL: only two policies in the schema are anon-satisfiable (both `USING
  (true)`, both on already-clean tables), and an empirical `SET ROLE anon`
  probe read **0 of 25** tables (17 empty, 8 already raising).
- **Seven SECURITY DEFINER functions were anon-executable** — a *live*
  pre-auth RLS bypass, since they run as owner and PostgREST serves them at
  `/rest/v1/rpc/`. Not in the plan; found by asking what else 0011's blanket
  grant touched. The revoke had to name **PUBLIC**, not just `anon` — each
  carried a bare `=X/postgres` aclitem, so the naive statement would have been
  a silent no-op. This reverses a deliberate S17-era decision; §17 of the
  handbook records the three measurements that retire the original objection.
- **0011's `ALTER DEFAULT PRIVILEGES` disarmed** for `anon`, so new tables are
  no longer born exposed. Stated limit: a second armed entry is granted by
  `supabase_admin`, which `postgres` is not a member of and cannot revoke; it
  applies only to objects `supabase_admin` creates.
- **pgTAP 629 → 655** (25 table probes + 1 schema-wide SECURITY DEFINER guard,
  across 24 existing suites; no new files, no `rls.yml` edit). vitest 482
  unchanged. All four CI jobs green.
- **Storage tab** renamed `RABBIT` → `Storage`, "In use" badge on the active
  backend, honest copy. No logic touched.
- **R.A.B.B.I.T. task creation diagnosed, not fixed** (deliberately): reproduced
  `23502` on `tasks.asset_id`. The obvious fix is insufficient — see
  `OUTSTANDING.md` and `SESSION_23_prompt.md`.

---

## 5. Remaining sessions

> ➡️ **Sessions 19 onward live in
> [`docs/sessions/MASTER_PLAN_S19_ONWARD.md`](sessions/MASTER_PLAN_S19_ONWARD.md).**
> Written 2026-08-01 from Audrey's first real testing pass. It opens with the
> finding that outranks everything below it: **Anthropic retired
> `claude-sonnet-4-20250514` on 2026-06-15, and WILSON hardcodes it at 17 call
> sites — so most of the app's AI has been failing since that date.** The
> sections below remain the record of S8–S17 and are not superseded.

### Session 8 — Dashboard + Notes (TipTap/Yjs) ✅ DONE (2026-07-28)

All four core blocks landed (`1ef4d10` + docs; §4 ledger row 8):

- **Dashboard page** (`src/components/Dashboard/`, page id `dashboard`, Home
  entry below the tools): table/kanban/gallery over the user's cross-project
  assignments, sorting/filtering/grouping (incl. project + my-role),
  TaskDetailPopup reused via synthetic per-project ctx (FileManager
  suppressed; asset field read-only there), project-role write gating via
  `projectRoleMatrix`, WILSON light tokens, zero budget surfaces.
- **Notes** (Dashboard tab): TipTap v3, Yjs note bodies with
  snapshot-merge-write (`ydoc_state` + `version` guard; bounded
  merge-on-conflict retry) — multi-device, no clobber, no Yjs server.
  Owner-only RLS with **NO admin bypass**; not history-captured; never
  broadcast; hard delete v1. User-defined subject options with rename
  cascade; date field; sort/filter/group.
- **Profile**: ProfileSection reused on the Dashboard; avatar Remove/Discard
  added; real avatars in RABBIT + Dashboard presence chips. Rides the
  EXISTING `user-avatars` bucket (0009) — §10-F satisfied by reuse, no new
  bucket (the brief's assumption predated 0009).
- **Workspace channel** (0018) — carry-forward #1 CLOSED; see §2.
- **Stretch NOT started:** field-level cell presence (→ S9+, earliest S10).

### Session 9 — Company Admin Terminal + MFA + Auto-Update Infra ✅ DONE (2026-07-28)

All blocks landed (`44d0de8` + `6182aa5`; §4 ledger row 9; db/README §18):

- **Admin Terminal** (`src/components/AdminTerminal/`, admin-gated, ≥5 UX
  laws applied per the 2026-07-28 requirement — seven, named in each file
  header and the close-out): Users (roster, role, grant toggles w/ confirm,
  show-once reset, deactivate/reactivate), Add People (multi-invite +
  create-with-password → show-once CredentialsPopup), Company, Logs
  (app_events + activity), Diagnostics (error codes WIL-####).
- **Per-user rate-card grants** (0020, §10-A): live-row `has_rate_card_grant`
  in the rce_* policies; client `useRateCardAccess`; view-only grants render
  the rate card read-only.
- **Read alignment** (0020, closed §6 #15): spine SELECTs +
  ws_members workspace-arm + ws_members_admin_write require
  has_active_membership; last-admin guard (locked, GUC escape for S10
  operator tooling); auto-staffing (producer/creator → project managers,
  client creates only); workspaces admin-rename w/ immutable slug.
- **MFA** (locked #9): LoginScreen TOTP stage → aal2; admin enroll gate;
  Settings security section; Edge Functions enforce aal2 for enrolled
  admins.
- **Auto-update** (locked #10/#15): electron-updater + generic B2 feed
  (WILSON_UPDATE_URL runtime override); NSIS channel via electron-builder
  (`npm run dist`); login Update/Skip; Settings version panel.
- **Backups** (locked #11): `.github/workflows/backups.yml` nightly
  pg_dump (postgres:17) → B2 — needs B2 secrets before first run (owed).
- **Logs & error codes** (0021): app_events append-only stream (admin
  stream server-reserved), 90-day purge cron, `src/cloud/errorCodes.js`.
- **Roster polish** (§10-B/E, closed §6 #13): assigned-projects column,
  roster liveness, producer/CD highlight; NewCompanyWizard team step
  (provision-workspace invites[], §10-D).
- Adversarial review: 16 findings — 15 fixed, 1 documented skip.

### Session 10 — O.T.T.E.R. cloud content model ✅ SERVER DONE (2026-07-29)

Commit `31586d5`; §4 ledger row 10; full detail in db/README §19.

**Landed:** migrations 0022 (five tables + helpers + trash + fork + index) and
0023 (public.users dropped, schema.sql/seed.sql deleted — gap #9 CLOSED);
pgTAP 26–30; the `adapters/otterFetch` client seam over 85 call sites;
`runOtterMigration.js`.

**Scope grew mid-session (Audrey, 2026-07-28).** The original two-state
personal/shared model became **three tiers plus two new features**:
`company_standard` courses, per-user edit grants, forking a standard course to
a personal copy, and change requests back to the admin. All of that is built
and pgTAP-pinned on the server.

**NOT started: the O.T.T.E.R. UI.** Tier picker, the mine/shared/standard
filters, share + editor-grant dialog, company-standard designation, the fork
offer, change-request submit/review, the trash list, `can_write` gating, and
mounting the migration panel. → **S11 Block A**, specced in
`docs/sessions/SESSION_11_prompt.md`.

**Not deployed-verified:** CI could not be read from the session machine
(`gh` unauthenticated). Migrations 0022–0023 ARE deployed to dev + staging +
prod (dry-run each, `public.users` confirmed empty on all three first).

> **Re-planned 2026-07-29 (Audrey).** Four sessions remain, not two. S11 was
> carrying both the O.T.T.E.R. UI and the web build — two full sessions — and
> S10 had already shown what that costs. Split them, and add S13 for the file
> lifecycle work (below), which is mostly TPN work pulled forward rather than
> new scope: **S11 O.T.T.E.R. UI · S12 web build · S13 file lifecycle & data
> stewardship · S14 operator console + TPN + v1.0.0.**
> *(Superseded 2026-07-29 post-S11: a fifth session was added — see locked #19.
> Numbering from S13 onward shifted by one.)*

### Session 11 — O.T.T.E.R. UI ✅ DONE (2026-07-29)

Commit `5707895`; §4 ledger row 11; db/README §19 (editor-grant trap) + §20.

**Landed:** the whole feature set from `SESSION_11_prompt.md` — tier picker in
the existing create flow, filter chips above the existing Sidebar 1 list,
share + editor-grant dialog off the course row, admin-only company-standard
designation, the inline fork offer, change-request submit (O.T.T.E.R.) and
review (Admin Terminal), trash/restore as a filter state, `can_write` gating,
the collapsible Sidebar 1, and `OtterMigrationPanel`.

**Migration 0024 — an unplanned server addition.** The S11 brief asserted the
trash was "server-complete and pgTAP-pinned". It was not: `otter_courses_select`,
`otter_subjects_select` and `otter_course_index()` all filter
`deleted_at IS NULL`, so `otter_restore_row()` had no obtainable argument and a
trashed course was unrecoverable by any client — 0022's own comment says exactly
that. `otter_trash_index()` is the metadata-only read side. **Gap #20 CLOSED.**

**Also found dead:** `renderDeleteConfirm` was unreachable (nothing ever set
`showDeleteConfirm`), so O.T.T.E.R. had no way to delete a course at all. The
new row menu opens it, and its "cannot be undone" copy was corrected — in cloud
mode it is a 30-day trash.

**Constraint honoured** (Audrey, 2026-07-29 — "I like how it works now"): every
new surface attaches to the existing shell. The single authorised shell change
was the Sidebar 1 collapse. Existing-UI elements touched are listed in §10.

**Review:** 4 finders, 17 findings, 10 refuted on verification, 7 fixed. The two
that mattered are recorded in §10 because both generalise.

### Session 12 — `ai-proxy` + the web build ✅ DONE (2026-07-29)

Commit `41c7356`; §4 ledger row 12; `docs/WEB_DEPLOY.md` for the web-build
mechanics. Both blocks landed:

- **Block A (locked #21)** — `ai-proxy` is the single Anthropic path on both
  hosts; streaming transport; per-workspace→platform key seam; usage
  telemetry (WIL-6001/6002); the client credential is deleted end to end.
  Deployed to dev+staging+prod. **Blocked on Audrey's `ANTHROPIC_API_KEY`
  secret** — until set, every AI feature answers "AI is not configured for
  this workspace yet" (501, deliberately non-retryable).
- **Block B (locked #18)** — web build (`dist-web`, base `/wilson/`),
  URL ↔ page sync, gap #21 fixed, honest web degradations everywhere the
  local server / preload bridge doesn't exist, web D.O.G. per locked #17
  (no content model — cloud attachments visibly deferred to S14), web
  sessions in localStorage, Playwright `chromium-web` lane.
- **Test host: GitHub Pages** — `gh-pages` branch of the public repo serves
  `https://pretty-aud.github.io/wilson/` once Audrey flips the Pages toggle
  (owed). `/wilsonadmin` becomes a sibling repo in S15. The
  `petalstudios.co` cutover stays post-v1.0.

### Session 13 — Change-request approval that applies ✅ DONE (2026-07-29)

Commit `89b84bc`; §4 ledger row 13. Everything in
`docs/sessions/SESSION_13_prompt.md` landed: migration 0025 (state machine +
review window + `otter_cr_apply`), pgTAP 32 (63 probes, plus the suite-30
rewrite the apply-only rule forced), both dialogs, and the "Open their course"
jump. Deliberate v1 limits held: no diff view (§6 #28), subjects only
(§6 #29), additive only.

**Worth remembering from the review:** the withdraw transition could smuggle
forged reviewer stamps (otter_cr_reviewed_chk exempts 'withdrawn', so only
the trigger stands between a proposer and a fake "reviewed by <admin>" in the
permanent record) — per-transition field pinning has to cover EVERY arm, not
just the ones that write review fields. And gap #33: the DB accepts a
non-admin standard-course owner as a reviewer, but no client surface serves
them (the queue is Admin-Terminal-only).

### Session 14 — File lifecycle & data stewardship ✅ DONE (2026-07-30)

Commit `b109bd2`; §4 ledger row 14. All five blocks landed — storage relink
(local_server, provider-agnostic matcher), CSV export both tiers, the
file_events audit stream + drawer, the rabbit-files bucket decision
(CREATE), and blob GC with certificates. TPN-CONT-002 and TPN-LOG-004 are
remediated in product clothing — the S15 re-audit should tick them.
Original scope below for the record.

- **Storage relink** — the ShotGrid/Blender "find missing files" model, and the
  reason this session exists: point WILSON at a moved folder, it walks the
  tree, matches dangling `files` rows by filename (size + mime as tiebreak),
  shows a preview table of proposed remaps, and applies them on confirm.
  **`local_server` first** (the case where folders actually move), with the
  matcher written provider-agnostically so `google_drive` can follow.
  Backstory: `files` already carries `storage_provider` + a *relative*
  `storage_path` (Drive file id / bare filename / bucket path), so a DB restore
  plus reconnected storage already resolves — relink is for when identifiers
  **drift** (a Drive file deleted and re-uploaded gets a new id; a folder moves).
- **CSV / spreadsheet export** — **both tiers** (Audrey): per-page export
  buttons now (this project's tasks, this rate card, this roster) *and* a full
  workspace takeout as a zip of one CSV per table. `xlsx` is already a
  dependency (rate-card importers), so this is mostly wiring.
  **O.T.T.E.R. is EXCLUDED from the company takeout** — see §10.
- **File audit (Notion-style)** — mostly UI over data already captured:
  `files` is in 0012's edit-history entity CHECK, and `app_events` (0021)
  carries the system stream. Add storage-lifecycle events (uploaded, moved,
  relinked, trashed, purged) and a per-file "who touched this, when" view.
- **`rabbit-files` bucket** — referenced at `supabaseAdapter.js:371` but never
  created by any migration, so the Supabase-Storage option for project files is
  half-wired. Create it with path-scoped policies (0009 `user-avatars`
  pattern), or drop Supabase Storage as a project-files option and keep that
  bucket for avatars only. Decide explicitly.
- **Blob GC (§6 #6)** — file rows soft-delete but blobs persist forever, and
  removed-avatar orphans join them when the best-effort delete fails.

### Session 15 — Operator Console (/wilsonadmin) + Final TPN Hardening ✅ DONE (2026-07-30)

§4 ledger row 15; the last BUILD session (locked #19 as amended). Migration
0028, Edge Functions `operator-workspaces` + `operator-ai-keys`, the
`/wilsonadmin` surface, the durable rate limiter, the MFA fail-closed fix,
gap #32 deleted outright, and a full TPN re-audit against the `1ce18ec`
baseline.

**The one scope correction worth recording.** The prompt listed gap #31
(cloud project attachments) as a cheap close. It is not, and the recon that
established that is worth keeping: D.O.G. reads attachments as inline
`content` data URLs and skips any file without one, so files rows alone
produce zero generation context; `files` has no `description` or
`document_kind` column; D.O.G.'s `isCore` defaults TRUE against
`is_core_definer`'s FALSE, so a 1:1 map silently flips every unmarked file;
ProjectsPage reads `projectsIndex`, which carries no files; and the local
adapter round-trips inline base64 through the JSON bundle, so switching
unconditionally would hide every existing local project's attachments.
Half-wiring it converts today's loud throw into silent data loss — the exact
failure the throw exists to prevent. What S15 DID close is the live bug the
gap was hiding (see §6 #31).

Original scope below for the record.

- **Operator console** (platform tier, `is_platform_operator`, separate
  surface at `petalstudios.co/wilsonadmin` per locked #18): create/manage
  companies (workspaces), administer **per-company Claude API keys**
  (`workspace_ai_keys` — the ai-proxy seam is already live), cross-company
  session/usage logs, build-links management. Session isolation from
  /wilson (separate storage scope; operator sign-in only). **Workspace
  teardown lands here and must include the service-role storage sweep**
  (§6 #34 — S14's GC cannot drain a dead tenant's queue rows).
- **Final TPN hardening**: re-run `tpn-compliance-audit` against the
  `TPN_AUDIT/` baseline (committed at `1ce18ec`); claim the S14
  remediations (TPN-CONT-002, TPN-LOG-004, path containment); close the
  remaining items — durable Edge-Function rate limiting (§6 #16), hard
  no-deferral admin MFA gate once the CI probe admin is enrolled (§6 #17).
- Deferrals sweep, CODE side (§6 — #31 wiring and #32 deletion are the
  cheap closes). Final disposition table is S17's.
- Close-out appends a "what S16 must document" note to
  `SESSION_16_prompt.md`.

### Session 16 — Systems documentation & design pack ✅ DONE (2026-07-30)

§4 ledger row 16. Both deliverables shipped; no product code touched. The
whole-system read did its second job — it filed §6 #44–#58, including one
security finding (#44) that eleven sessions of review had not surfaced, because
nobody had previously traced a `REVOKE` in 0001/0003 forward through 0011's
blanket grant.

Original scope below for the record.

Launch prompt: `docs/sessions/SESSION_16_prompt.md`. **Docs-only — no
product code**; runs on the frozen post-S15 codebase, and the whole-system
read doubles as the final audit (code findings → §6 gaps for S17).

- **`docs/SYSTEMS_HANDBOOK.md`** — the in-length "every system, what it
  does, what talks to what" document (Supabase per concern, Vercel,
  GitHub/CI, B2, Resend, Sentry, Electron/Express, ai-proxy→Anthropic,
  storage providers, the operator console, the three tools + agent
  system, a who-talks-to-whom section). Dual audience: future team
  members AND other Claude accounts (seed material for Claude
  projects/skills/CLAUDE.md); fully self-contained; written FROM the code
  and drift-reviewed like code; NO secrets (repo is public — "private" =
  Audrey hands it out manually). **v1.0.0 release gate.**
- **`docs/SYSTEMS_DESIGN_PACK.md`** — mermaid system map + per-tool
  wireframes/flows + per-function dataflows + a diagram inventory, the
  source pack for Audrey's follow-up Claude design session
  (infographics/wireframes document). **Short, succinct and skimmable
  by requirement** (Audrey, 2026-07-30): diagrams with one-line captions,
  readable end to end in a few minutes. The handbook is where things get
  explained; the design pack is where they get seen, and it links to the
  handbook rather than repeating it. If both explain the same thing, the
  design pack is the one that is wrong.
- Close-out writes `SESSION_17_prompt.md`.

### Session 17 — Release (v1.0.0)

- Fix anything S16's documentation read surfaced (§6 entries it filed).
- Final §6 disposition: every still-open gap closed, re-owned to
  post-1.0, or explicitly accepted with a reason.
- Confirm the release gates: handbook exists and is drift-reviewed; CI
  green; migrations + Edge Functions deployed to all three envs.
- Version cut: package.json → 1.0.0, changelog, tag.

## 6. Carry-forward gaps — FINAL v1.0.0 disposition (Session 17)

> **Every gap below now carries exactly one disposition: CLOSED (with the
> commit), RE-OWNED to post-1.0 (with a reason), or ACCEPTED for v1.0.0 (with
> a reason and its TPN id where relevant). None is undecided.** The
> user-facing summary of what is knowingly imperfect at ship is
> `docs/RELEASE_TESTING.md` → "Known not to work"; this section is the full
> record. (Heading was "live list, end of Session 8" for eight sessions after
> it stopped being true.)

1. ~~Projects INDEX updates live only for the OPEN project~~ — **CLOSED S8**
   (workspace channel, 0018).
2. Token-refresh-while-project-trashed can miss that project's restore event
   (documented in 0016 header; catches up on next open).
3. Revert covers projects/phases/assets/tasks only; hard-deleted projects can't
   be recreated.
4. Restoring a child under a trashed parent leaves trash early (error surfaced;
   parent purge cascades it anyway).
5. Milestones / scenes / levels / experiences have no cloud tables yet (S2
   deferral) — not broadcast, not history-captured.
6. ~~Storage blob GC — file rows soft-delete but blobs persist~~ — **CLOSED
   S14**: trg_files_gc_enqueue + storage_gc_queue + the admin-invoked
   `storage-gc` Edge Function (queue drain, orphan scan, avatar sweep, all
   workspace-scoped and certificate-emitting). Deliberately NOT a cron —
   TS-1.5 dual authorization, and the gap-#24 schedule-branch trap.
7. Roster (project_members) changes are not edit-history captured.
8. Legacy `useTeamMembers` still used by Timeline/Scenes/Levels/Experiences/
   Budget/Intake views.
9. ~~`public.users` drop + `schema.sql` retirement~~ — **CLOSED S10** (0023;
   Audrey confirmed standalone RABBIT is no longer supported).
10. Milestones have no undo path (kept confirm dialog).
11. pgTAP 20/23's realtime probes are lenient in CI by design (no realtime
    service in the CI stack); hosted coverage = live probes.
12. **NEW (S8):** Notes have no cross-device LIVE list refresh (deliberate —
    notes ride no channel; the version guard still makes concurrent edits
    lossless; list refreshes on load/reload). Candidate: per-user topic later.
13. ~~TeamMembersPage does not consume workspace_members events~~ —
    **CLOSED S9** (roster liveness + assigned-projects column).
14. **NEW (S8):** A workspace-less JWT (deactivated everywhere mid-session)
    inserting a note fails 23502 (NOT NULL) instead of a clean 42501 —
    cosmetic; the Dashboard already requires an active workspace to render.
15. ~~Deactivated members: channel/table-read divergence~~ — **CLOSED S9**
    (0020 alignment; pgTAP 20 probe 20 flipped, channel ≡ table reads).
16. ~~Edge-Function rate limiting is in-memory + last-XFF only~~ — **CLOSED
    S15.** `public.edge_rate_limits` + `fn_rate_limit_hit()` (0028) is a
    fixed-window counter in Postgres, shared by every isolate and surviving
    redeploys; `_shared/rateLimit.ts` is the caller. `ai-proxy` and both
    operator functions use it. What it replaced was worse than "best
    effort": an in-memory Map counts one isolate, so the effective limit
    was RPM × however many were warm — an unknowable number, on the one
    endpoint whose overage Anthropic bills. Two properties stated rather
    than discovered: the window is FIXED (up to 2× the limit can pass
    across an edge — a sliding window needs per-hit rows), and the helper
    fails OPEN with a loud `console.error` (a limiter is an abuse control,
    not an authorization control; see §10). **`provision-workspace`'s
    invite budget was NOT migrated** — it is still per-isolate. → #38.
17. ~~adminGuard MFA step-up fails OPEN if listFactors errors~~ — **CLOSED
    S15.** The empty catch is gone: a failed factor lookup now returns 503
    `mfa_check_failed`, and the `error` channel is checked too (supabase-js
    reports most failures there rather than throwing, which would have been
    a second, quieter copy of the same bug). Verified safe for CI first —
    no job calls an adminGuard-backed function; the Playwright auth lane
    exercises `invite-member`, which has its own check. The **stronger**
    gate — refusing admins who never enrolled at all — ships as opt-in
    `WILSON_REQUIRE_ADMIN_MFA=1`, OFF by default, because whether every
    existing prod admin holds a verified factor is not verifiable from a
    session that never signs in, and a default-on gate would lock Audrey
    out of her own Admin Terminal. That residue is TPN-AUTH-003, not #17.
18. **NEW (S9):** electron-updater ships only via the electron-builder NSIS
    channel (`npm run dist`); Forge/Squirrel builds report 'unsupported'.
    Local node_modules lacks electron-updater/electron-builder until an
    install succeeds on this machine (npm TLS issue; lockfile is complete).
19. **NEW (S9):** legacy useTeamMembers sweep still pending (was #8; now
    also feeds the producer/CD highlight only via projectsIndex ids).
20. ~~**O.T.T.E.R. trash has no way out in the client**~~ — **CLOSED S11**
    (migration 0024 `otter_trash_index()` + the "Recently deleted" filter
    state). The gap was deeper than "no UI": there was no server read path
    either, which is why it needed a migration in a session scoped as
    client-only.
21. ~~**O.T.T.E.R. will render an empty library on the web**~~ — **CLOSED
    S12.** `loadSoftwareList()` no longer depends on the settings fetch, and
    `src/lib/localData.js` gives every local-file store (pet, otter-settings,
    agent-skills) an Express-in-Electron / localStorage-on-web home. The
    remaining local-server routes degrade with stated reasons
    (`/api/fetch-url`, PDF extraction, Google-Sheet import) — see #31.
22. ~~**no `can_write` gating in the O.T.T.E.R. UI**~~ — **CLOSED S11.** Every
    generate/edit/delete affordance is now gated on `can_write`, with a stated
    reason where a control disappears rather than a silent absence.
25. ~~**the Anthropic key is on every client**~~ — **CLOSED S12** (locked
    #21). All 14 direct call sites now ride the `ai-proxy` Edge Function on
    both hosts; the `wilson-api-key` localStorage slot (and the pre-WILSON
    legacy slot) are purged on upgrade; the Settings field is gone. No
    direct-Anthropic fallback exists anywhere.
26. ~~approving a change request records a decision, it does not merge~~ —
    **CLOSED S13** (migration 0025, locked #22): `otter_cr_apply()` archives
    then applies additively, and is the only path to `approved`;
    `fn_otter_cr_review` was rewritten for the full revise-and-resubmit loop.
27. ~~a reviewer sees the SUMMARY, not the course~~ — **CLOSED S13**: the
    consented review window (`otter_has_open_review_access`, a SECURITY
    DEFINER helper arm on `otter_courses_select`) opens on submit and closes
    on settle. Proposer-owned sources only — a request naming a colleague's
    course is refused at INSERT, in the helper, and in the apply RPC.
28. **NEW (S11): the admin reviews prose, not a diff.** Even with read access to
    the proposer's course (#27), a reviewer compares two courses by eye. A real
    subject-level diff view is the obvious follow-on and is deliberately NOT in
    the S13 scope — flagged so it is a choice rather than an oversight.
29. **NEW (S11): the apply RPC handles SUBJECTS only.** The five per-course
    reference documents (`hotkeys`, `functions`, `nodes`, `reference_urls`,
    `corrections`) have merge semantics that live in client JS
    (`otterRoutes.js`'s `mergeHotkeys`/`mergeFunctions`/`mergeNodes`).
    Reimplementing them in plpgsql would duplicate load-bearing logic, and
    overwriting them would violate the additive-only rule. So an approval moves
    lesson content and not hotkey tables. State it in the approve dialog.
24. ~~**the S9 backup workflow could never have run**~~ — **CLOSED 2026-07-29.**
    `chore/enable-db-backups` merged to `main`; B2 configured (SSE-B2 +
    Object Lock on, 90-day lifecycle); both prod and staging jobs run green
    with dumps verified present. Original finding retained below because the
    lesson generalises — relevant to S14/S15 if either adds a GitHub Actions
    cron (the existing purge jobs are pg_cron *inside Postgres*, so they are
    unaffected). Original finding: `backups.yml`
    was committed to `feat/multi-user-v1` only. GitHub fires `schedule`
    workflows *exclusively* from the DEFAULT branch and only surfaces the
    `workflow_dispatch` button for workflows present there — so the nightly
    pg_dump had two independent reasons never to execute, and the missing B2
    secrets were only the visible one. Fixed by PR branch
    `chore/enable-db-backups`, which puts that single file on `main`.
    **Lesson for any future scheduled workflow: it must live on the default
    branch or it is decoration.** (`rls.yml` is unaffected — `push` and
    `pull_request` run from the branch where the event happened, which is why
    CI has worked throughout.)
23. ~~**CI unverified for `31586d5`**~~ — **CLOSED 2026-07-29: all four jobs
    green** (pgTAP, issue-session smoke, Vitest, Playwright auth). The
    migrations therefore apply cleanly to an EMPTY database from `0000` to
    `0023` in order, not just to the already-migrated `wilson-dev`. Original
    note: `gh` is not authenticated on
    the session machine. Everything was verified directly against Postgres 17
    on wilson-dev (94/94 pgTAP probes, plan counts exact) + Vitest 256/256 +
    vite build, and the migrations are deployed to all three envs — but the
    Actions run itself was never read. **First task of S11.**
30. **NEW (S12): web multi-tab writes are last-writer-wins.** The
    localStorage stores in `src/lib/localData.js` (pet, otter-settings,
    agent-skills) are full-object overwrites with no cross-tab sync; two
    open tabs both run the pet's 30s decay/auto-save timers and clobber
    each other. Accepted for v1 (one-window product; same class as two
    Electron windows) — documented in the module header. A
    `storage`-event merge is the fix if it ever matters.
31. **project file ATTACHMENTS still ride project-row patches — S15 fixed
    the DATA LOSS, the re-homing is S17.** The `rabbit-files` bucket exists
    and `supabaseAdapter.uploadFile` works end to end, so the blocker is
    gone; what remains is wiring, and S15's recon showed it is NOT the
    cheap close the S15 brief assumed.
    **What S15 DID close** — a live bug the gap was hiding: the
    attachments guard sat *inside* `updateProject`'s "row reduced to
    nothing" branch, so an attachments-ONLY patch threw but a MIXED patch
    (`{title, documents}`) saved the title and dropped the files with no
    error at all; `createProject` discarded `droppedAttachments` entirely,
    so D.O.G.'s create-with-attachments modal was silently lossy in cloud
    mode. Both now refuse, an empty `documents: []` is correctly not
    treated as an attachment, and `projectAttachments.test.js` pins it
    (10 cases — there was no coverage here at all, which is how the hole
    survived from S12).
    **What S17 must do, with the traps already found:**
    (a) a migration adding `files.description` + `files.document_kind` —
    ProjectsPage writes both on every attachment and `files` has neither;
    (b) decide the core-flag polarity explicitly — D.O.G. uses
    `isCore` defaulting **true** (`f.isCore !== false`), `files.is_core_definer`
    defaults **false**, so a 1:1 map flips every previously-unmarked file
    from CORE to REF and changes generation output;
    (c) give D.O.G. a download-and-rehydrate step — `projectFiles` requires
    an inline `content` data URL and `return`s early without one, so
    uploading to storage without this makes cloud attachments upload
    successfully and contribute NOTHING to generation (worse than today's
    loud throw). `adapter.downloadFile` exists on all three adapters and
    has **zero call sites** anywhere;
    (d) give ProjectsPage access to files rows — it reads `projectsIndex`,
    and cloud `listProjects` selects a fixed column list with no files;
    (e) keep local mode readable — the local adapter round-trips inline
    base64 through the JSON bundle, so a blanket switch hides every
    existing local project's attachments;
    (f) gate on adapter MODE, not on `typeof adapter.uploadFile` — the
    Google Drive stub is a function that throws;
    (g) note `deleteFile` soft-deletes and leaves the blob, so the
    ProjectsPage delete affordance changes meaning from "destroyed" to
    "trashed" and must say so.
32. ~~the legacy LOCAL password panel still renders in Electron~~ —
    **CLOSED S15, by deletion.** It went further than the panel: the whole
    `// ── Password management` block in `electron/main.cjs`
    (`/api/auth/session`, `/api/auth/verify`, `/api/auth/change`, the
    hardcoded master-override and default constants, the plaintext
    `wilson-auth.json` reader) and `src/components/PasswordScreen.jsx`
    were removed together. **Together was load-bearing:** PasswordScreen
    was already orphaned (nothing imported it), but deleting only the
    routes would have left its `/api/auth/verify` fetch 404-ing and
    falling through to a hardcoded string comparison — a fail-OPEN gate,
    strictly worse than the dead code. A boot-time
    `cleanupLegacyAuthFile()` unlinks the on-disk credential, because
    deleting code does not delete data. Settings → General now says the
    same true thing on both hosts. TPN impact is the headline: this alone
    closes TPN-AUTH-001, TPN-SDLC-001 and TPN-ENC-003 (all CRITICAL), plus
    TPN-AUTH-002, TPN-AUTH-004 and the `/api/auth/verify` half of
    TPN-NET-003.
33. ~~a NON-admin owner of a company-standard course is a DB-supported
    reviewer with no client surface~~ — **CLOSED S13b** (2026-07-30, commit
    `54d5225`): O.T.T.E.R.'s Requests view surfaces the decidable queue to
    admins AND to owners of the targeted standard course; managers got a
    read-only queue at the same time (0026).
34. ~~workspace hard-delete strands its rabbit-files blobs~~ — **CLOSED
    S15**, both halves. Blobs: `operator-workspaces` action `teardown`
    collects every `rabbit-files` path from BOTH `files` and
    `storage_gc_queue` (paged with `.range()`), deletes them, certificates
    each batch, drops the queue rows, and only THEN deletes the workspace
    row — the order is the fix, because after the CASCADE nothing can
    discover which blobs belonged to the tenant and storage-gc's orphan
    scan fails closed on the vanished rows. Certificates: `platform_audit`
    (0028) carries no workspace FK and snapshots slug/name, so the
    `workspace.teardown` record outlives its subject; pgTAP 35 pins it by
    deleting a workspace and asserting file_events went while the
    certificate stayed.
35. **NEW (S14): GC orphan-scan window can starve on very large buckets.**
    The run-wide budget collects objects in name order, referenced ones
    included, so a project with >5000 referenced objects sorted ahead of
    its orphans never reaches them on any run. Mitigated (batched
    reference checks, honest card copy — no "run again" promise); a
    persisted per-bucket cursor is the fix if real buckets ever get there.
    **S15 TPN disposition: ACCEPTED for v1.0.0, tracked as TPN-CONT-010.**
    The re-audit rated the surrounding control MEDIUM, and starvation
    needs a single project past 5000 referenced objects — a state no
    tenant is near. What the audit flagged as the sharper edge is not the
    cursor but that certified disposal *only ever runs when a human
    clicks*: there is no queue-depth signal anywhere, so a queue can grow
    unbounded and unnoticed. A depth indicator on the Diagnostics card is
    the cheaper and more valuable half; the cursor can wait for evidence.
36. **NEW (S14): the relink census and scan use sync fs on the Electron
    main process.** `fs.existsSync` per file row (and the walker) block the
    process; an UNREACHABLE network share can freeze the app for
    N × timeout when a project's files live there. The client-side render
    storm was fixed in review; the server-side fix is fs.promises.access
    with bounded concurrency.
    **S15 TPN disposition: ACCEPTED for v1.0.0, no finding opened.** The
    re-audit did not rate it a security control at all, and that reading
    is right: it is an availability/UX defect on a local, single-user,
    user-initiated action, with no confidentiality or integrity component
    and no multi-tenant blast radius. It stays a §6 gap and a good
    early-S18 fix (fs.promises.access with a bounded pool is a contained
    change), but it does not belong on the release gate.
37. **NEW (S14): local 'purged' certificates have no UI reader.** They
    survive in bundle.fileEvents (exempt from the 2000-event trim) and the
    project-level route GET /api/rabbit/projects/:id/file-events serves
    them, but no surface renders that stream — the per-file drawer needs a
    live row. Candidate: an audit tab or takeout inclusion later.
38. **NEW (S15): `provision-workspace`'s invite budget is still an
    in-memory per-isolate limiter.** S15 built the durable limiter
    (`fn_rate_limit_hit`, #16) and moved `ai-proxy` and both operator
    functions onto it, but left provision-workspace on its original Map.
    Same unknowable-limit problem, much lower stakes (invites cost email,
    not Anthropic tokens). One-line swap to `isRateLimited(admin,
    'provision-invites', <subject>, N, 60)`; the only judgement call is
    what to key the subject on, since the caller may be unauthenticated —
    which is also why the existing limiter uses last-XFF and inherits the
    usual spoofing caveat.
39. **NEW (S15): workspace teardown leaves orphaned identities.** A user
    whose ONLY membership was in a torn-down company keeps their
    `auth.users` row and can still authenticate; they simply resolve to no
    workspace. Deliberate — deleting those accounts would be a destructive
    act on identities the operator did not create, and a user may hold
    memberships in several companies. What is missing is the *reporting*:
    teardown does not tell the operator how many accounts it stranded, and
    nothing sweeps them later. A count in the teardown result and a
    "stranded accounts" view would close it; a data-retention policy
    decision (how long a workspace-less account may persist) is the real
    question underneath, and belongs with the TPN documentation work.
40. **NEW (S15): the operator console has no e2e lane and no local static
    preview.** `scripts/serve-web.mjs` and the Playwright `chromium-web`
    project both hard-code the `/wilson` mount, so `/wilsonadmin` has
    neither. The session-isolation property IS verified — at build time by
    grepping both bundles for their session keys, and at runtime in a
    browser where an existing `wilson.dev.session` on the same origin was
    correctly ignored — but no automated test holds it. Since isolation
    here is nothing but a key string (§10), a regression would be silent.
    A Playwright spec that loads both surfaces on one origin and asserts
    the keys differ is the cheap version.
41. **NEW (S15, TPN re-audit): 🚨 a LIVE workspace-admin credential for
    wilson-dev was published in the public repo** (TPN-SDLC-007).
    `smoke_admin` is an active `admin`-role account; its password sat in
    two tracked session checklists AND as a hardcoded fallback in two
    tracked Playwright specs, and the anon key needed to complete a
    sign-in is public by design — so the pair was directly usable against
    the real endpoint. Confirmed live against the database during the
    audit. **S15 removed every occurrence from the working tree** (the
    specs now throw if `WILSON_E2E_PASSWORD` is unset; CI already supplies
    it from `DEV_PROBE_PASSWORD`), redacted the docs, and rewrote the
    instructions that told operators to rotate the password *back* to the
    published literal — which is why it stayed valid for eleven sessions.
    **The value is in git history permanently, so ROTATION is owed**
    (OWED_AUDREY §0) and only Audrey can do it. Also worth deciding: the
    probe does not need `admin` for what it tests.
42. **NEW (S15, TPN re-audit): privilege changes are unaudited**
    (TPN-LOG-005, the second open CRITICAL). Role promotions, rate-card
    grants and deactivations go from the browser straight into
    `workspace_members` under the `FOR ALL` `ws_members_admin_write`
    policy, and nothing captures them: 0012's `edit_history` entity CHECK
    deliberately excludes the table ("Session 9 territory" — a comment,
    not an implementation), the only triggers on it are guards, and no
    `app_events` line is written. The roster shows the end state and
    nothing else, so "who granted this person admin, and when" is
    unanswerable for anything that already happened. One migration closes
    it — a DEFINER capture trigger on the 0027 `fn_file_events_capture`
    shape; the copy-paste prompt is `TPN_AUDIT/REMEDIATION_PLAN.md`
    Phase 0b. **S17 should treat this as a release gate**, not a backlog
    item: it is the audit trail for the product's own security boundary.
43. **NEW (S15 review): teardown cannot see blobs that no row points at.**
    `collectBlobPaths` reads `files` and `storage_gc_queue`; an object in
    `rabbit-files` that neither table references — a failed-insert upload
    whose 1-hour delete-own window lapsed, or a row lost to an earlier
    incident — survives its tenant's teardown permanently, and afterwards
    nothing can attribute it (the orphan scan resolves project→workspace
    through the very rows the CASCADE removed). The fix is to LIST the
    bucket under `projects/{project_id}/` for each of the workspace's
    projects and union that with the row-derived set, before the delete.
    Not done in S15 because listing is paginated per prefix and the
    teardown path is already the longest in the console; the row-derived
    sweep covers every blob the product itself created. Note the S15
    review also confirmed the inverse hazard and that one IS fixed:
    `files.storage_path` is client-writable, so a member could point a row
    at another tenant's key and have teardown delete it — the sweep now
    refuses any path outside the workspace's own project ids and
    certificates the refusal (WIL-7008).

---

### Filed by Session 16's documentation read (2026-07-30)

All fifteen were found by reading the whole system to write
`docs/SYSTEMS_HANDBOOK.md`. None was fixed — S16 was frozen-code by design.
The first four are **release-gating**; S17's prompt carries the triage.

44. 🚨 **NEW (S16): `custom_access_token_hook` is executable by
    `authenticated` and `anon`.** 0001 (`:194-195`) and 0003 (`:77-78`) both
    `GRANT ... TO supabase_auth_admin` and `REVOKE ... FROM authenticated,
    anon, public` — but `0011_role_grants.sql:23` then runs a blanket
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated,
    service_role`, and 0011's own "re-assert function lockdowns" pass
    (`:33-43`) re-locks only `provision_workspace_and_admin` and
    `workspace_directory()`. Nothing in 0012–0029 re-revokes the hook. The
    function takes its target user id from the **caller-supplied `event`
    argument** (`0003:29`), not `auth.uid()`, so any signed-in caller can
    compute another user's full claim set — workspace memberships, app_role,
    `is_platform_operator`. Fix is a one-line REVOKE in a new migration plus a
    pgTAP probe. **The general lesson is bigger than the finding:** 0011 also
    sets `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS`, so every
    function created by a later migration inherits the blanket grant too —
    S17 should audit which other DEFINER functions were meant to be locked
    down and are not. Survived eleven sessions of review because every pass
    read the REVOKE in 0001/0003 and stopped there.
45. **NEW (S16): the `managed-files` routes allow arbitrary-path deletion.**
    `PATCH /api/rabbit/projects/:p/managed-files/:id`
    (`electron/main.cjs:1665-1670`) merges `req.body` wholesale with no field
    stripping, so `folder_path` and `stored_name` are client-writable; the
    `?hard=true` DELETE branch (`:1684-1690`) then `path.join`s them onto the
    project root and `fs.unlinkSync`s the result with **no
    `resolveContainedFilePath` call**. The sibling `files` routes were
    hardened for exactly this class in S14 (`:1359-1363` strips
    `storage_path`/`storage_provider`/`id`; every disk path is contained), and
    the thumbnail GET builds its path the same uncontained way (`:1724`).
    Reachable by anything that can reach the loopback port, which mounts bare
    `cors()` and has no auth (TPN-NET-001). Fix is symmetric with the `files`
    routes. Distinct from TPN-CONT-006, which covers the *missing certificate*
    on the same route, not the traversal.
46. **NEW (S16): `invite-member` performs no MFA step-up and can mint an
    admin.** The function reimplements its own claims + live-row check inline
    (`invite-member/index.ts:78-110`) rather than importing `adminGuard`, and
    a grep confirms zero references to `aal`, `mfa`, `listFactors` or
    `adminGuard` in the file. `ROLE_SET` includes `'admin'` (`:45`), so an
    admin holding a verified TOTP factor can create another admin from an
    **aal1** session — while `admin-create-user`, the other path to the same
    outcome, is blocked at aal1 by `requireWorkspaceAdmin`. Locked #9 ("MFA
    for all admin tiers") is therefore not upheld on this path. Fix: route it
    through `adminGuard` like every other admin function.
47. **NEW (S16): R.A.B.B.I.T. milestones are dropped on project load.**
    `localServerAdapter.loadProject` returns 20 explicitly-named keys and
    omits `milestones` (`localServerAdapter.js:73-95`), even though
    `listMilestones`/`upsertMilestone`/`deleteMilestone` exist just below
    (`:439-447`) and the Express routes persist them
    (`electron/main.cjs:1243`). `googleDriveAdapter.loadProject` has the
    identical omission. Because `setActiveProject`/`reloadActiveProject` do
    `setBundle({...EMPTY_BUNDLE, ...next})`, every milestone the user creates
    reverts to `[]` on the next reload, project switch or realtime refetch —
    real data loss on a feature both TimelineView and ProjectTasksView render.
48. **NEW (S16): `addManagedFile` is unguarded outside local mode.**
    `RabbitProvider.addManagedFile` calls `adapterRef.current.createManagedFile`
    unconditionally, and that method exists only on `localServerAdapter`.
    `FileManager.handleAddFiles` guards on `window.electronAPI?.rabbit` — "are
    we in Electron" — not on adapter mode, and the preload bridge is present
    regardless of which backend is selected. In supabase or google_drive mode
    the click throws a `TypeError` swallowed by a generic `catch`, so the UI
    simply stops after the copy spinner with no visible error.
49. **NEW (S16): `googleDriveAdapter` throws on two methods the rate-card hook
    calls unconditionally.** `listRateCards` and `listRateCardEntries` are
    wired to the same `readOnly()` throw stub as the write methods
    (`googleDriveAdapter.js:237-277`), but `useRateCard.js:122,208` calls both
    on mount with only a try/catch → `setError`. Every RABBIT view that mounts
    the hook (Budget, Task detail, Scenes/Levels/Experiences) shows a permanent
    rate-card error banner in Drive mode.
50. **NEW (S16): O.T.T.E.R.'s global Space shortcut fires from every page.**
    The "Global keyboard shortcuts" effect (`Otter.jsx:2197-2211`) registers a
    `window` `keydown` with no `currentPage` gate, and O.T.T.E.R. stays mounted
    under `display:none` on every other page. Pressing Space anywhere in WILSON
    (outside a form field) sets `showSearchModal` inside the hidden tree, so
    the search modal is already open the next time the user opens the tool. The
    correct pattern is in the same file 2000 lines earlier — the
    sidebar-collapse shortcut is explicitly gated with
    `shortcutEnabled: currentPage === 'otter'` and a comment describing this
    exact failure mode. One-line fix.
51. **NEW (S16): `HelpPage.jsx` documents the password panel S15 deleted.**
    Lines 388-396 still tell users the login password "protects the application
    on launch", that changing it "requires entering your current password
    first", and that it is "letters and numbers only, up to 12 characters" and
    "case-insensitive" — all properties of the deleted local credential, none
    of which has ever applied to a Supabase password. `SettingsPage.jsx:546-555`
    says the true thing; Help was never updated. A user following in-app help
    looks for a control that does not exist.
52. **NEW (S16): `logAdminEvent` hardcodes `severity: 'info'`.**
    `_shared/adminGuard.ts:175-188` sets it unconditionally regardless of
    `fields.code`, so `WIL-3004` "Storage cleanup **failed**"
    (`storage-gc/index.ts:264-269`) lands in the log stream at the same
    severity as the `WIL-3003` success line. Anything in the Admin Terminal's
    log viewer that filters or highlights by severity cannot distinguish a
    failed cleanup run from a successful one.
53. **NEW (S16): two `resolve-login` branches write no `auth_attempt_log`
    row.** The `workspace_members` query-error branch (`:147-149`) and the
    `admin.getUserById` failure branch (`:170-172`) both return the uniform
    miss without logging, while the four intended outcomes
    (`resolved`/`not_found`/`rate_limited`/`error`) all do. A backend failure
    during a sign-in attempt is therefore invisible in the one stream that
    exists for it. Cosmetic today; relevant to TPN-LOG-006.
54. **NEW (S16): quiz scores and Validator findings are never persisted.**
    `otter_progress.quiz_attempts` (0022), the `quiz.get`/`quiz.put` adapter
    ops (`supabaseOtterAdapter.js:404-420`) and the
    `/api/software/:slug/quiz-history` route all exist, but `Otter.jsx`
    contains no call to any of them — a completed quiz lives in React state for
    that visit only. Validator results are the same shape with no server table
    at all (`Validator.jsx:107`). Both read as bugs to a user and as
    half-finished features to a reader; decide explicitly whether v1 persists
    them or the UI says it does not.
55. **NEW (S16): Settings → Tools "Storage Location" is inert.** It renders an
    editable path input defaulting to `./data/software/` and persists to
    `otter-settings` (`Otter.jsx:5205-5209`), but `getDataDir()` hardcodes
    `app.getPath('userData')/otter-data` (`electron/main.cjs:36-39`) and never
    reads the setting. The field and its Browse button have no effect on where
    anything is written.
56. **NEW (S16): R.A.B.B.I.T.'s agent integration is prompt-selection only.**
    `AGENT_TOOLS` lists `['otter','rabbit']` and RABBIT calls
    `agent.setActiveTool?.('rabbit')` so its system prompt loads, but nothing
    calls `registerTool('rabbit', ...)` and `createRabbitAgentTools(` has zero
    call sites repo-wide. `handleAgentAction` has no case for any of RABBIT's
    eight declared actions, and `sendAgentMessage`'s fallback resolves to
    Otter's interface while RABBIT is active. The DiffView approval gate is
    exercised only by O.T.T.E.R. Either wire it or stop advertising it in the
    prompt and the skills UI.
57. **NEW (S16): a cross-workspace username collision makes sign-in
    unreachable.** `workspace_members` uniqueness is scoped
    `(workspace_id, username)`, so the same username can legitimately exist in
    two companies. `resolve-login` treats 0 matches and ≥2 matches identically
    as a miss unless `workspace_slug` disambiguates (`:141,151-164`), and its
    own comment says the client should supply the slug — but `LoginScreen`'s
    `resolveLogin` accepts a `workspaceSlug` parameter its only call site never
    passes, and the auth form has no company field. The affected user gets a
    permanent, indistinguishable "sign-in failed" with no path to resolve it.
58. **NEW (S16): documentation drift inside the product and the repo.**
    (a) `src/tools/rabbit_v0.1.0/db/README.md:160` still says the migration
    range is `0000`–`0023` and has no section for 0028 or 0029 — the operator
    console, `workspace_ai_keys`, `platform_audit`, `edge_rate_limits` and the
    0029 lockdown are entirely undocumented there. (b) `electron/env.cjs:9-10`
    describes a `wilsonEnv` preload bridge that does not exist; renderer
    `VITE_*` values are compile-time constants, so `env.json` can only affect
    main-process consumers. (c) The intake wizard's header and README describe
    a 5-step flow; the shipped `STEPS` constant has 3, and
    `IntakeUploader.jsx`/`IntakeClassifier.jsx`/`IntakeCoreDefiner.jsx` remain
    on disk with no importer. (d) `backups.yml:18-19`'s comment illustrates a
    30-day B2 lifecycle; the configured value is 90 days. (e) `main.cjs`'s
    hardcoded User-Agent strings say `WILSON/0.5.5` and `WILSON/0.6`.

---

### FINAL DISPOSITION — every gap, one verdict (Session 17, 2026-07-30)

Three verdicts only. **CLOSED** carries the commit. **RE-OWNED** means real
work deferred past v1.0.0, with the reason. **ACCEPTED** means we are shipping
it knowingly, with the reason and its TPN id where one exists.

The rule applied throughout: S17's hard constraint was *do not change what the
app does or how it looks*. Several gaps below could have been closed with a
patch that also moved a pixel or a behaviour; those were re-owned rather than
smuggled in. Where a gap was left open, the reason is written down — an
undecided gap at a release is a decision nobody made.

| # | Verdict | Why |
|---|---|---|
| 1 | **CLOSED S8** | Workspace channel (0018). |
| 2 | **ACCEPTED** | Token-refresh-while-trashed can miss one restore event; catches up on next open. Documented in the 0016 header. |
| 3 | **ACCEPTED** | Revert covers projects/phases/assets/tasks only. A hard-deleted project cannot be recreated at its original id, and a fresh id would orphan the whole subtree — that is a correctness limit, not an omission. |
| 4 | **ACCEPTED** | Restoring a child under a trashed parent leaves trash early; the error is surfaced and the parent purge cascades it anyway. |
| 5 | **RE-OWNED** | Milestones / scenes / levels / experiences have no cloud tables. This is a migration plus five adapter surfaces, not a release fix. **S17 did fix the data loss inside local mode (#47).** |
| 6 | **CLOSED S14** | `trg_files_gc_enqueue` + `storage_gc_queue` + the admin-invoked `storage-gc` function. |
| 7 | **ACCEPTED** | `project_members` changes are not edit-history captured. Roster changes are visible in the UI and the workspace channel; the audit gap that mattered — *workspace* privilege changes — is #42, closed below. |
| 8 / 19 | **RE-OWNED** | Legacy `useTeamMembers` still backs six views. Migrating a live data source across Timeline / Scenes / Levels / Experiences / Budget / Intake is exactly the kind of refactor this session was told not to attempt. |
| 9 | **CLOSED S10** | `public.users` dropped (0023). |
| 10 | **ACCEPTED** | Milestones have no undo path; the confirm dialog stands in. |
| 11 | **ACCEPTED** | pgTAP realtime probes are lenient in CI by design — there is no realtime service in the CI stack. Hosted coverage comes from live probes. |
| 12 | **ACCEPTED** | Notes have no cross-device live list refresh. Deliberate: notes ride no channel, and the version guard already makes concurrent edits lossless. |
| 13 | **CLOSED S9** | Roster liveness + assigned-projects column. |
| 14 | **ACCEPTED** | A workspace-less JWT inserting a note fails 23502 rather than a clean 42501. Cosmetic; the Dashboard already requires an active workspace to render. |
| 15 | **CLOSED S9** | 0020 read alignment. |
| 16 | **CLOSED S15** | `edge_rate_limits` + `fn_rate_limit_hit()`. |
| 17 | **CLOSED S15** | adminGuard MFA fails closed. |
| 18 | **ACCEPTED** | electron-updater ships only through the electron-builder NSIS channel; Forge/Squirrel builds report `unsupported`. NSIS is the only auto-updatable artifact and that is the shipping channel. |
| 20 | **CLOSED S11** | `otter_trash_index()` (0024). |
| 21 | **CLOSED S12** | Library loads independently of the settings fetch. |
| 22 | **CLOSED S11** | `can_write` gating throughout the O.T.T.E.R. UI. |
| 23 | **CLOSED** | CI green, all four jobs. |
| 24 | **CLOSED** | `backups.yml` lives on `main`; both jobs run green with dumps verified present. The lesson is now recorded in §9. |
| 25 | **CLOSED S12** | `ai-proxy` is the only path to Anthropic. |
| 26 | **CLOSED S13** | `otter_cr_apply()` (0025). |
| 27 | **CLOSED S13** | The consented review window. |
| 28 | **RE-OWNED** | A reviewer still compares two courses by eye. A subject-level diff view is a feature, and it was deliberately excluded from S13's scope rather than forgotten. |
| 29 | **ACCEPTED** | Apply moves subjects, not the five reference documents. Their merge semantics live in client JS; reimplementing them in plpgsql would duplicate load-bearing logic, and overwriting them would violate the additive-only rule. **The approve dialog says so.** |
| 30 | **ACCEPTED** | Web multi-tab last-writer-wins on the three `localStorage` stores. One-window product; same class as two Electron windows. |
| 31 | **RE-OWNED** | D.O.G. cloud attachments. S15 closed the data-loss half; the re-homing is a migration plus five wiring changes with seven catalogued traps (see the entry above — the `isCore` polarity flip alone would change generation output). Explicitly excluded from S17 by the session brief. **In local mode attachments work end to end; in cloud mode they are refused loudly at the write layer, not silently lost.** |
| 32 | **CLOSED S15** | The local password module deleted entire. |
| 33 | **CLOSED S13b** | Non-admin standard-course owners get the decidable queue. |
| 34 | **CLOSED S15** | Teardown collects, deletes and certificates blobs before the CASCADE. |
| 35 | **ACCEPTED** (TPN-CONT-010) | GC orphan-scan starvation needs a single project past 5,000 *referenced* objects — a state no tenant is near. The sharper edge the audit named is not the cursor but that certified disposal only runs when a human clicks; a queue-depth indicator is the cheaper half and is re-owned. |
| 36 | **ACCEPTED** | Synchronous `fs` on the Electron main process during relink census/scan. An availability defect on a local, single-user, user-initiated action with no confidentiality or integrity component. Good early-S18 fix; not a release gate. |
| 37 | **RE-OWNED** | Local `purged` certificates have no UI reader. They survive in `bundle.fileEvents` and the route serves them; no surface renders that stream. |
| 38 | **ACCEPTED** | `provision-workspace`'s invite budget is still a per-isolate limiter. Same unknowable-limit problem as #16, much lower stakes — invites cost email, not Anthropic tokens — and the caller is unauthenticated, so the subject to key on is a real judgement call rather than a one-line swap. |
| 39 | **ACCEPTED** | Teardown strands identities. Deliberate: deleting those accounts would be a destructive act on identities the operator did not create, and a user may hold memberships in several companies. What is missing is the *reporting*, which is re-owned. |
| 40 | **RE-OWNED** | The operator console has no e2e lane. The isolation property IS verified — at build time by grepping both bundles for their session keys, and by hand in a browser — but no automated test holds it, and since isolation here is nothing but a key string, a regression would be silent. A Playwright spec asserting the two keys differ on one origin is the cheap version. |
| 41 | 🚨 **OWED — Audrey only** | The published `smoke_admin` credential (TPN-SDLC-007, open CRITICAL). Every occurrence is out of the working tree and the instructions that told operators to rotate it *back* to the literal are rewritten — but the value is in git history permanently, so **rotation is the only remedy and only Audrey can do it**. `OWED_AUDREY.md` §0. |
| 42 | **CLOSED S17** (`b726e75`) | TPN-LOG-005. `trg_ws_members_audit` captures every privilege change into the reserved `app_events` admin stream. |
| 43 | **ACCEPTED** | Teardown cannot see blobs no row points at. The row-derived sweep covers every blob the product itself created; the residue is a failed-insert upload whose 1-hour cleanup window lapsed. |
| 44 | **CLOSED S17** (`b726e75`); **wider audit CLOSED S22** (`494a13d`) | `custom_access_token_hook` re-revoked. **Sharpened during the fix:** it was callable by `anon`, not merely by any signed-in caller — reachable with nothing but the public anon key. **The follow-up this entry asked for — "audit which other DEFINER functions were meant to be locked" — was finally done in S22, and found seven still open** (`can_comment_project`, `can_manage_project_roster`, `can_write_project`, `fn_comment_project_id`, `has_active_membership`, `project_is_staffed`, `project_role_for`). Migration 0033 revoked them **from `PUBLIC, anon`** — naming only `anon` would have been a silent no-op, since each carried a bare `=X/postgres` aclitem. 0011's `ALTER DEFAULT PRIVILEGES` was disarmed in the same migration, so this cannot re-arm itself, and `35_platform_audit.sql` now asserts the count is zero. |
| 45 | **CLOSED S17** (`b726e75`) | Managed-files containment — and wider than filed: four fs sinks, not two, plus the asset rename/delete pair, which was an arbitrary-*directory-move*. |
| 46 | **CLOSED S17** (`b726e75`) | `invite-member` routed through `adminGuard`. **Does not close every admin-minting path** — see #66. |
| 47 | **CLOSED S17** (`b726e75`) | Milestones survive a load, in both adapters, with a test that pins the whole class. |
| 48 | **CLOSED S17** (`b726e75`) | `addManagedFile` / `refreshManagedFiles` guard on adapter capability. |
| 49 | **CLOSED S17** (`b726e75`) | Drive-mode rate-card reads return empty; the auto-create branch is gated on `adapterSupportsWrites`, without which the banner survives the stub. |
| 50 | **CLOSED S17** (`b726e75`) | O.T.T.E.R.'s Space shortcut gated on `currentPage`. |
| 51 | **CLOSED S17** (`b726e75`) | `HelpPage` password card rewritten to match reality. |
| 52 | **RE-OWNED** | `logAdminEvent` hardcodes `severity: 'info'`, so WIL-3004 "cleanup failed" reads at the same severity as the success line. The fix is one line in `adminGuard.ts` — but that module is bundled by nine Edge Functions, so a change forces a redeploy of all of them (the S15 lesson). Not worth that on release day for a log-viewer nicety. |
| 53 | **ACCEPTED** (TPN-LOG-006 adjacent) | Two `resolve-login` branches write no `auth_attempt_log` row. Cosmetic today; the honest fix belongs with the wider auth-event logging work (#67). |
| 54 | **RE-OWNED** | Quiz scores and Validator findings are never persisted. The columns, routes and adapter ops all exist; the client never calls them. Wiring them is a feature, and it changes what the user sees. **Listed in RELEASE_TESTING.md's "known not to work" so it is not re-found as a bug.** |
| 55 | **RE-OWNED** | Settings → Tools "Storage Location" is inert. Both honest fixes — making it work, or removing it — are visible changes barred this session. Listed as known-not-working. |
| 56 | **CLOSED S17** (`6ab10c6`), partially | The *advertising* is fixed: both misleading strings corrected. The wiring is **RE-OWNED**. Recon sharpened the finding — RABBIT's agent surface is not merely unwired but *unreachable*, because `App.jsx` hard-gates the agent to the O.T.T.E.R. page, so no user can hit a silent no-op. |
| 57 | **ACCEPTED** | A cross-workspace username collision makes sign-in unreachable. The resolver already accepts a `workspace_slug` and the client already has the parameter — the login form simply has no company field, and adding one is a visible change to the first screen every user sees. Real, bounded, and not something to alter on release day. |
| 58 | **CLOSED S17** (`6ab10c6`) | All five documentation-drift items, plus two the gap did not name: db/README was missing sections for 0025/0026 as well as 0028/0029, and the intake step-count drift had a **third** site — the RABBIT knowledge snippet in `App.jsx` that is fed to the companion at runtime, so the agent was actively describing a wizard that no longer exists. |

### Filed by Session 17 (new)

These were found while fixing the above. None is a release blocker; all are
written down so they are choices rather than surprises.

59. **Eight SECURITY DEFINER functions remain `anon`-executable.** The residue
    of #44's wider sweep. Six key on `auth.uid()` and therefore leak nothing to
    an anonymous caller. Two — `project_is_staffed` and `fn_comment_project_id`
    — have no caller gate at all and bypass RLS, but reveal only one bit about
    a UUID the caller must already possess. **ACCEPTED for v1.0.0**, and the
    reason is evidence, not comfort: revoking them from `anon` was tested in a
    rolled-back transaction on wilson-dev and is a **behaviour change** —
    `has_active_membership` backs nearly every policy, so every anonymous table
    read turns from an empty result into a 42501. Post-1.0, the right fix is to
    add an `auth.uid() IS NOT NULL` guard inside the two ungated functions
    rather than to touch grants.
60. **`auth_attempt_log` has no purge job and no stated retention rationale.**
    Unlike `file_events` and `platform_audit`, whose absence of a purge is a
    documented compliance position, this one is simply unaddressed. Decide a
    retention window and either add a sweep or write down why not.
61. **Managed-file thumbnails only resolve under `ASSETS/`.** The thumbnail
    route hardcodes `ASSETS/{assetSlug}/`, but the upload route also writes
    `SCENES/` and `SHOTS/` folder paths, so those thumbnails always 410.
    Fixing it makes thumbnails appear that do not today — a visible change,
    hence deferred.
62. **The Summary view's Budget tile is structurally always zero.**
    `ProjectSummaryView` calls the estimate rollup with no `roleRates`, so the
    tile renders the zero-value currency regardless of the data. Visible
    change to fix; found while auditing the two budget paths for Tier 2.
63. **`CrewTeamTab` / `TalentTab` do not check `res.ok` on the invoice-folder
    call**, so a 400 becomes a swallowed `ERR_INVALID_ARG_TYPE` and the Attach
    button appears to do nothing.
64. **The Agent Skills checkboxes gate nothing.** `isSkillEnabled` is exported
    and has zero call sites repo-wide; no tool runtime consults `agentSkills`
    before honouring an action. **S17 corrected the copy** so the tab no longer
    claims otherwise — for O.T.T.E.R. as well as RABBIT — but the state is
    still loaded, persisted, rendered and read by nothing. Wire it or remove
    the checkboxes post-1.0.
65. **Ten `WIL-70xx` codes emitted by the S15 operator functions are absent
    from `ERROR_CODES`.** No user-visible consequence today — the operator
    console's Audit section does not route through `describeErrorCode` — but
    adding them would add rows to the Diagnostics reference table, which is a
    visible change. Cosmetic, deferred.
66. **`provision-workspace` can still mint an admin from a public endpoint.**
    It inlines its own invite path rather than calling `invite-member`, and its
    `INVITE_ROLE_SET` also contains `'admin'`. `adminGuard` cannot apply — the
    caller has no JWT by definition, this being self-serve company creation
    where the creator becomes the first admin anyway. **ACCEPTED as designed**,
    recorded so that #46's closure is not mistaken for "no unauthenticated path
    can create an admin", which would be false.
67. **Auth events are still unlogged** (TPN-LOG-003, and the correct citation
    for the `WIL-1001/1002/1003` question — `SESSION_17_prompt.md` cited
    TPN-LOG-006, which is a different finding about unread supabase-js error
    channels). Sign-in success, sign-in failure, MFA challenge failure,
    sign-out and session expiry write nothing anywhere. Two of the three
    declared codes **cannot** be wired client-side: at sign-in failure and
    session expiry there is no session and no workspace, and `app_events`'
    INSERT policy requires both, so the write is refused by RLS. This needs a
    server-side writer — an Edge Function or a GoTrue hook — which is real work
    and is why the codes were left declared-but-unwired rather than deleted
    (deleting them removes visible rows from the Diagnostics table).
    **RE-OWNED post-1.0.**

---

### Found by Audrey's release-testing pass (2026-07-30) — the MFA cluster

Four entries, filed together because they share one root cause and because
they are the strongest evidence this session produced that
`docs/RELEASE_TESTING.md` was worth writing. **All three defects sat on the
very first screen a new admin ever sees, and all three were invisible to every
check the project had: CI green on all four jobs, database correct, logs
clean.** They surfaced within about ten minutes of a human actually using it.

68. 🚨 **THE ROOT ENABLER: the MFA path has ZERO automated coverage.**
    Both Playwright projects sign in as the seeded probe admin, which has **no
    verified TOTP factor** — so `hasVerified` is false, the `aal2` branch never
    executes, and neither enrolment nor MFA sign-in has ever run in CI. That is
    why three independent defects could live on the sign-in path with every
    gate green. It is also why `adminGuard`'s own comment could say the
    Playwright lane "exercises invite-member" while never touching the MFA
    step-up that same lane's admin would need.
    **This is the one to fix first post-1.0** — ahead of any individual bug
    below, because without it the next regression here is equally invisible.
    The fix is a seeded probe account WITH a verified factor and a spec that
    completes a TOTP sign-in (deriving codes from the seed secret, which is
    standard practice and needs no human).
    **RE-OWNED post-1.0, highest priority.**

69. **CLOSED S17 (`8222ea1`) — auth awaits were unbounded.** `mfa.challenge`,
    `mfa.verify`, `getSession`, `issue-session`, `refreshSession` and
    `saveSession` had no ceiling on either sign-in surface, so a stalled call
    pinned the button on "Verifying…"/"Working…" forever with no error, no
    retry and nothing in the console. Now bounded at 15 s via
    `src/cloud/auth/withTimeout.js` (8 vitest cases), and a timeout is reported
    differently from a rejected code — telling someone their authenticator code
    was wrong when the network stalled sends them round a loop that cannot
    succeed.

70. **CLOSED S17 (`8222ea1`) — a success with no terminal state became an
    invisible full-screen overlay.** Both auth screens ended their success path
    by handing off to `AuthShell`'s 1 s reveal animation, which calls
    `onAnimationComplete` → `onAuthenticated`/`onComplete`. `busy` was never
    cleared by the step that set it. And `AuthShell` returns `null` once its
    phase reaches `'done'`, while `MfaEnrollGate` wraps it in a
    `position:fixed; inset:0; z-index:60` div — so a missed handoff left the
    user under a transparent full-screen overlay showing `App.jsx`'s orange
    root through it and swallowing every click. **That was the "blank orange
    screen".** Both gates now arm a 4 s fallback that completes the handoff
    directly, ref-guarded so exactly one path fires; the animation is cosmetic
    again rather than load-bearing. `MfaEnrollPanel` also gained an explicit
    `enrolled` phase so a successful activation reads "MFA active ✓" instead of
    waiting to be unmounted by somebody else.

71. **CLOSED S17 (`669a870`) — MFA sign-in deadlocked on `getSession()`.** The
    defect that actually made the console unreachable. `auth-js` guards every
    auth call with a navigator lock keyed on `storageKey`; calling
    `supabase.auth.getSession()` immediately after `supabase.auth.mfa.verify()`
    contends for the lock `verify()` still holds, and never resolves. Not a
    cross-tab problem — a single fresh tab deadlocks identically, which is what
    ruled out the stranded-lock theory. **The round trip was never needed:
    `mfa.verify()` resolves with the upgraded aal2 session**, which the code
    discarded before asking the SDK for the same thing again through the one
    path guaranteed to block. Fixed on both surfaces.
    🔑 **The diagnostic lesson, which generalises well beyond MFA:** the
    operation kept **succeeding**. `auth.mfa_challenges` showed 4 challenges
    and 0 unverified — every code had verified server-side. So every
    server-side signal was green and only the client hung. Three plausible
    client-side theories were wrong in a row; the database answered it in one
    query. **When a client hangs on an operation that appears to work, check
    what the server recorded before theorising about the client.**

72. 🔑 **CLOSED S17 (`920a2f7`) — THE deadlock, and the one that actually made
    sign-in impossible.** `RabbitProvider.jsx:346` registered an **`async`**
    `onAuthStateChange` callback that awaited two Supabase queries
    (`adapter.status()`, `adapter.listProjects()`).

    auth-js invokes every subscriber from inside `_acquireLock` and **awaits**
    each one (`GoTrueClient._notifyAllSubscribers`). Those queries therefore
    called `_getAccessToken()` → `getSession()` → `_acquireLock()`, waiting on
    the lock the callback was already running inside. Self-deadlock, and it
    stranded the entire auth operation — `mfa.verify()` never resolved, so MFA
    sign-in was impossible on both surfaces.

    **Fixed** by making the callback return synchronously and deferring its
    work with `setTimeout(…, 0)`: the lock releases, the queries run a tick
    later against a settled session. All four subscribers in the tree were
    audited; the other three were already synchronous.
    **Guarded** by `src/cloud/auth/authStateCallbacks.test.js`, which fails the
    build if any subscriber is ever declared `async` again — a source-level
    check, because this failure is invisible at runtime until it deadlocks in
    front of a user.

    🔑 **The process lesson, which Audrey named directly and which matters more
    than the bug:** *"stop doing work off of theories until they are proven."*
    Five theories preceded this — a reveal-animation handoff, a stranded
    navigator lock, a `getSession()` deadlock, a stalled Vercel deployment, a
    stale bundle — and two of them were **shipped as fixes**. Each was
    plausible; all five were wrong. Two of them were also "disproved" by
    measurements that could not have worked: a bundle-hash comparison across
    builds with different `VITE_*` values will always differ, and it was
    presented as proof of a stale deploy.

    What actually located it, in order, and cheaply:
    1. `auth.mfa_challenges` — 7 challenges, **0 unverified**, ~110 ms each.
       The server was healthy; the fault was after `verify`.
    2. A Network capture — `verify` returned **200 in 113 ms** and **no request
       followed it**. A hang with no request cannot be a network problem, which
       eliminated every remaining network theory at once.
    3. Reading `GoTrueClient._verify` and then grepping the four subscribers.

    **A theory earns a measurement, never a commit.** Recorded as a standing
    rule in the Claude auto-memory (`feedback_prove_before_acting.md`).

### Filed by Session 18 — the invite path (2026-07-31)

Two defects, either of which alone made an emailed invite unusable. Only the
first was known going in; the second was hiding behind it, and would have
surfaced the instant the first was fixed on its own.

73. 🚨 **CLOSED S18 (`28dec64`) — an emailed invite was redeemed by machines
    before the human clicked.** `{{ .ConfirmationURL }}` is a bare
    `GET /auth/v1/verify?token=…`, so *following the link is the redemption*.
    Anything that fetches links to scan them spends the invite first.

    **Measured on wilson-staging**, both invites Audrey sent on 2026-07-31:

    | recipient | invited → confirmed | tokens |
    |---|---|---|
    | corporate domain (`zerospace.co`) | **16.70 s** | both cleared |
    | Gmail | **12.04 s** | both cleared |

    with `email_confirmed_at` and `last_sign_in_at` set on both, and neither
    recipient having opened the mail. Two different providers rules out a
    single client's quirk.

    ⚠️ **What is measured and what is not.** That a *machine* did it is
    measured — no human was at either mailbox. *Which* machine is not:
    `auth.audit_log_entries` is empty on the hosted project (0 rows), so
    there is no IP to attribute it to, and the popular "mail scanners do
    this" explanation stays an inference. **It does not matter to the fix.**
    The class of defect is "a GET mutates state", and the remedy — move
    redemption behind a click — closes it whoever the fetcher was. Recorded
    this way deliberately: naming a culprit we cannot evidence is how S17
    lost an hour.

    **Fixed** by carrying `{{ .TokenHash }}` to a page in the app and calling
    `verifyOtp({ token_hash, type })` only from a button's onClick.
    **Verified on the production bundle**, with the browser's resource-timing
    buffer confirmed open (2 of 250 entries — the first attempt at this
    measurement was worthless because the dev server's unbundled modules had
    already filled it, and a known-good control fetch was invisible too):
    loading the link issued **zero** cross-origin requests; clicking issued
    **exactly one**, to `/auth/v1/verify`.

    ✅ **VERIFIED END-TO-END ON STAGING, 2026-08-01**, with a real invite to a
    real Gmail address — the same provider that consumed the 2026-07-31 pair
    in 12.0 s:

    | | before (`aud***@gmail.com`) | after (`car***@gmail.com`) |
    |---|---|---|
    | invited → `email_confirmed_at` | **12.04 s** | **12 min 48 s** |
    | what redeemed it | a machine, unclicked | **the recipient's click** |

    At **+11 m 37 s** the row still read `email_confirmed_at` NULL,
    `last_sign_in_at` NULL, `confirmation_token` unspent — checked
    deliberately, because "NULL five seconds after sending" would have proved
    nothing. `email_confirmed_at` 06:53:58 then `last_sign_in_at` 06:54:40,
    42 s apart: set-password, then sign in with it. Audrey confirmed the
    "Welcome to WILSON → Continue" screen appeared before the password form.

74. **CLOSED S18 (`28dec64`) — a live, untouched invite link failed anyway.**
    `ResetPasswordWizard`'s parser required `type === 'recovery'` and returned
    null otherwise. GoTrue v2.194.0 echoes the *requested* type back into the
    redirect fragment — `q.Set("type", params.Type)`, `internal/api/verify.go`
    — so an invite arrives as `type=invite`. The parser returned null and the
    invitee was shown *"This link has already been used, or it has expired."*
    on a link that was live. Password resets say `recovery`, so they worked;
    that asymmetry is why only invites ever looked broken.

    **Nobody had ever seen this**, because no invite had survived long enough
    for anyone to click it (#73). Fixing #73 alone would have shipped a flow
    that still did not work, and the failure would have read as "the new
    token_hash code is broken" rather than as a parser that predates it.

    🔑 **The lesson, and it is not the same one as #72.** #72 was about not
    acting on unproven theories. This is the converse: **a fix aimed at a
    known defect must be checked against the path it unblocks**, because the
    known defect can be masking a second one. What surfaced it was running
    the *current* parser against the fragment GoTrue actually emits, before
    writing any replacement — six lines of verbatim code and one `node`
    invocation, ten minutes ahead of the fix.

    Parsing now lives in `src/cloud/auth/recoveryLink.js` — pure, 27 cases,
    covering both link shapes. One case pins the **old** predicate so the
    asymmetry cannot silently return. That path had no coverage of any kind
    before (#68), which is the reason a defect this simple survived.

75. **ACCEPTED — `supabase/templates/email_change.html` still uses
    `{{ .ConfirmationURL }}`.** Same GET-redeems shape as #73, and left
    alone on purpose: **the flow is unreachable.** Email is read-only in
    `ProfileSection.jsx` and nothing in the app or the Edge Functions calls
    `updateUser({ email })`, so the template is never rendered and no mail is
    ever sent. Converting it would have been an untestable change to a dead
    path during a release freeze. **If email change is ever built, this
    template must move to the `{{ .TokenHash }}` flow first** — the app side
    already supports it; `recoveryLink.js` need only accept `email_change`.

76. **NOT A DEFECT — template variables inside HTML comments.** Recorded
    because it was investigated and dismissed, and someone will wonder again.
    Both templates carried `{{ .ConfirmationURL }}` in their doc comment,
    which looked like it would render a live redeemable URL into every
    message body. It does not: GoTrue parses with Go's **`html/template`**
    (`internal/mailer/templatemailer/template.go`), which elides HTML
    comments from output. Documented behaviour of that package, not measured
    here — no Go toolchain on this machine.
    The comments now name variables bare anyway, as convention: the point of
    #73 is that no redeemable URL appears anywhere in the email, and resting
    that on a stripping step is thin.

---

## 7. Original brief → status traceability

Legend: ✅ done · 🔶 partial · ⬜ planned (session #) · ❓ needs in-app verify ·
✳ deliberately changed.

| Brief item | Where it landed | Status |
|---|---|---|
| Editor timestamp + history button, popup w/ sidebar of edits, before/after main frame, per-project | S5 `EditHistoryDrawer` + capture triggers (0012) | ✅ (drawer lives in Assets/Tasks `_actions`; gallery/kanban affordance not wired) |
| Revert project to a selected state | S7 `revertHistoryEntry` + drawer buttons | 🔶 projects/phases/assets/tasks only (#3 in §6) |
| "Last updated by/at" on ALL project databases | Audit columns (0004) + triggers | ✅ |
| Undo file/row deletes | S6 soft delete (0014) + undo toast + 30-day trash; S14 blob GC + purge certificates | ✅ |
| Team member page shows assigned projects | S9: live assigned-projects column (workspace channel) | ✅ |
| App roles admin/manager/user + dropdown in Team Members (WILSON, not RABBIT) | S3 permissions framework + S4 role dropdown | ✅ |
| Admin per-user extra grants (rate-card view/edit toggles w/ confirm) | 0020 grants + has_rate_card_grant + terminal toggles w/ confirm | ✅ |
| Admin can SEE member passwords | **Changed**: show-once at creation + reset-only (locked #8) | ✳ |
| Copy-credentials popup on user creation | S9 CredentialsPopup (show-once, copy-both) | ✅ ❓ in-app verify owed |
| Username-first login; creator username `Audrey` | S2/S3 AuthShell + resolve-login | ✅ |
| Project roles manager/reviewer/member; write gating incl. approve/complete reviewer-only; members no budget/intake | 0013 helper family + `projectRoleMatrix` | ✅ policies · ❓ per-tab UI sweep (budget/intake/timeline view-only nuances) |
| Producer + Creative Director row highlight; producer/creator auto-manager | 0020 producer/director cols + auto-staff trigger + roster badges | ✅ |
| Budget snapshot card managers-only; members never see financial data | Rate-entry RLS closed (0015); budget-tab gating rides the project-role sweep | 🔶 ❓ |
| Summary strip shows only YOUR projects | 0013: staffed projects gated; **unstaffed = open to all** (backward compat) | 🔶 (matrix-complete once legacy projects are staffed) |
| Real-time co-editing, see others live | S7 broadcast + LWW merge + presence chips/LIVE pill (now with avatars) | ✅ (field-level cell presence: stretch, not started — S9+/S10) |
| Personal Dashboard (RABBIT views + notes + profile + avatar) | S8: Dashboard page (table/kanban/gallery + popup reuse), Notes (TipTap+Yjs), ProfileSection + avatar remove, workspace channel | ✅ ❓ in-app verify owed |
| New company setup wizard (+ create several users at once) | S9 team step → provision-workspace invites[] (Slack-style) | ✅ |
| New user first-open flow (company → login → welcome → profile → home) | S2/S3 wizards | ✅ |
| Central Supabase backend, all users on it | 3 envs, migrations 0000–0030 | ✅ |
| Company BYO storage (AWS S3, Supabase, local, local server, Hetzner, Google Drive) + settings connection UI | S9 StorageConnections cards (local/Supabase/Drive per locked #14) | ✅ (S3/Hetzner post-1.0) |
| Per-company Claude API key, admin-administered | S12 `ai-proxy` shipped the per-workspace→platform seam; **S15** added `workspace_ai_keys` (AES-256-GCM ciphertext, service-role only) + the operator-console UI (`operator-ai-keys`: set/clear, key validated against Anthropic before storing, never readable back — only a 4-char hint) | ✅ ❓ needs `WILSON_AI_KEY_SECRET` set per env (OWED_AUDREY §9C) |
| O.T.T.E.R. personal vs company-shared content, share/unshare, never cross-company | S10 model (0022/0023) + **S11 UI** (tier picker, filter chips, share + editor grants, company standard, fork, trash/restore) + **S13**: change-request approval APPLIES (0025 — archive, additive copy, review window, revise-and-resubmit) | ✅ ❓ in-app verify owed |
| Session system (auth, edit attribution, audit, multi-device, revocation) | + S9 deactivate = RLS cutoff + GoTrue ban + best-effort logout | ✅ (per-device session LIST UI not built — not currently planned) |
| App version hosting, update-check at login w/ update/skip, Settings version panel | S9 electron-updater + B2 + UpdatePrompt + VersionPanel | ✅ (B2 bucket setup owed) |
| Admin terminal (users/teams/logs/API-calls/error codes/debug) | S9 company tier SHIPPED (users/company/logs/diagnostics + WIL-#### codes) + S11 Requests (O.T.T.E.R. change-request review); **S15 operator tier** = `/wilsonadmin`, a separate surface with its own session, its own tier and its own audit stream | ✅ company · ✅ operator ❓ in-app verify owed (OWED_AUDREY §9D) |
| express-session + connect-pg-simple suggestion | Superseded by Supabase Auth | ✳ (locked #1) |

---

## 8. Operating rituals (standing rules for every session)

1. **First tool call of a session:** `git status` on `feat/multi-user-v1` —
   confirm clean, read the prior session's commit. No code before that. Then
   read **`docs/OUTSTANDING.md`** — everything currently known to be broken,
   in one place. Read it *before* planning, not after: several entries are
   REPORTED rather than diagnosed, and a session that starts coding against
   one of those is fixing a guess. It is also the fastest way to notice that
   the thing you are about to build sits on top of something already broken.
2. **Close-out ritual:** feature commit → CI green → deploy migrations
   dev → staging → prod (dry-run before each) → re-link Supabase CLI to
   `wilson-dev` → write `docs/sessions/SESSION_NN+1_prompt.md` → **update this
   MASTER_PLAN (§4 ledger, §5 scope, §6 gaps, §7 statuses)** → **update
   `docs/OUTSTANDING.md`** → update the Claude auto-memory → docs commit + push.

   **On `docs/OUTSTANDING.md`** (added S19, Audrey's request): it is the single
   answer to "what is broken right now". Add an entry only for something
   **broken and not yet fixed** — including anything the session itself broke.
   Delete entries the session fixed, citing the commit. Tag each
   MEASURED / REPORTED / INFERRED.

   **Adding nothing is a correct outcome.** A session that fixes things and
   breaks nothing leaves the file untouched. Do not invent entries to look
   thorough — padding it makes the real ones harder to see. Interim,
   unverified, or planned work is not an entry; that belongs in the forward
   plan. A bug fixed in the same session belongs in a commit message.
2b. 🚨 **NEVER run `supabase config push`. There is no legitimate use of it in
   this repo.** It overwrites the remote auth config from local `config.toml`,
   whose `smtp.enabled = false` would disable hosted Resend email outright.
   Email templates are pasted **by hand** in each dashboard. The CLI has no
   read command for remote auth config, so there is also no "just looking"
   version of it — do not reach for it to inspect state.

   **It was run accidentally on 2026-08-02 and it did apply** (S19; see
   `docs/OUTSTANDING.md`). Not by anyone deciding to run it — by bash
   evaluating backticks inside a double-quoted `node -e "…"`, twice, with the
   `[Y/n]` prompts defaulting to yes on absent stdin. `smtp.enabled` happened
   not to apply; nine other auth settings on wilson-dev did.

2c. 🚨 **Never build a shell command by interpolating content into it.** Both
   of S19's incidents were quoting, not reasoning: the above, and a `grep -v`
   filter that printed a `service_role` key into a transcript because
   `supabase projects api-keys` returns every key on one JSON line.

   - Write scripts to a **file** and run the file. Do not use `node -e "…"`
     with embedded backticks, `$(…)`, or `${…}` — bash evaluates all three
     inside double quotes regardless of what the payload is meant to be.
   - To extract one field from a command's output, **select that field**
     (`python -c`, `jq -r '.field'`). Never filter with `grep -v` and assume
     the shape of what you have not looked at.
   - Prefer the Edit/Write tools over shell heredocs for file edits.

3. **Adversarial review before every feature commit** (independent finders →
   verify → fix confirmed findings pre-commit). S6: 12/12 fixed; S7: 11 fixed;
   S13: 10 confirmed fixed (incl. a reviewer-stamp forgery), 1 refuted,
   4 triaged inline.
4. **Token discipline:** hard cap 15 concurrent agents; finders paste excerpts;
   never resume nondeterministic fan-out pipelines; verify small claim sets
   inline.
5. **The agent never enters credentials** — browser eyeball checks that require
   sign-in are listed at close-out and owed by Audrey. Currently owed:
   two-window live-sync + presence chips + drawer revert/Ctrl+Z (S7); asset
   delete→undo toast, TeamView roster panel, RateCardPage as plain member (S6).
6. **pgTAP traps (learned the hard way):** `throws_ok(sql, arg2, arg3)` — a
   5-char arg2 is treated as SQLSTATE and arg3 becomes the expected MESSAGE
   (use the message form); the `tests` schema is runner-only — de-auth before
   mid-file `tests.login_as` with claims-reset + `RESET ROLE` (calling
   `tests.logout()` as authenticated is a 42501); re-running an
   edited-but-applied migration on dev
   = `supabase migration repair --status reverted NNNN` + `db push
   --include-all`; `supabase db query --linked` (CLI ≥ 2.90) runs SQL against
   the linked hosted env. **S14 additions:** inside one test transaction
   `now()` is frozen, so purge probes need a NEGATIVE retention interval;
   hosted `storage.protect_delete()` blocks direct SQL DELETE on
   storage.objects (pin storage policies via pg_policies, probe writes via
   INSERT only); PostgREST caps un-ranged reads at max_rows (1000) even for
   service_role — Edge Functions must page with `.range()`; the CI lockfile
   must be written by npm 10 (`npx npm@10 install --package-lock-only`) —
   a local npm-11 lockfile regeneration breaks `npm ci`.

---

## 9. Infra registry

| Thing | Value / location |
|---|---|
| Git root | `Dev_Work\wilson\` (repo root is ABOVE `WILSON/`) |
| Branch | `feat/multi-user-v1` (tracks origin) |
| CI workflow | `.github/workflows/rls.yml` (at git root) |
| Supabase envs | dev `eqjzmnvkrakroyqxfsvw` · staging `rzkirvkotslbovzbsdfh` · prod `rqyriuyldhovirbuievt` |
| DB reference doc | `WILSON/src/tools/rabbit_v0.1.0/db/README.md` (§7 superseded-note, §14 realtime, §15 revert) |
| Session prompts | `WILSON/docs/sessions/SESSION_NN_prompt.md` (02–17 present) |
| Systems handbook | `WILSON/docs/SYSTEMS_HANDBOOK.md` (S16, v1.0.0) — **release gate**; every system + who-talks-to-whom, written from the code |
| Design pack | `WILSON/docs/SYSTEMS_DESIGN_PACK.md` (S16) — 24 mermaid diagrams, source for Audrey's design session |
| **Release testing** | `WILSON/docs/RELEASE_TESTING.md` (S17) — first-company setup runbook + per-system checklist, `[BLOCKING]`/`[NOTE]`, with a "known not to work" section so nothing already-known gets re-found. **This is the document Audrey works through before the tag.** |
| Changelog | `WILSON/CHANGELOG.md` (S17) — S1–S17 as one migration story, not a per-session diary |
| Migration count | 0000–0030, all three envs (S15 added 0028 + 0029; S17 added 0030) |
| **Beta web host** | **`https://beta.petalstudios.co/wilson`** — Vercel project `petal-studios/wilson`, Root Directory `WILSON`, production branch `feat/multi-user-v1`, **STAGING-backed**, auto-deploys on every push. Builds BOTH surfaces (`build:vercel && build:vercel:admin`). Install is `npm install --ignore-scripts`, not `npm ci` — Vercel's npm 11 rejects the npm-10 lockfile CI requires. DNS: `beta` CNAME → `cname.vercel-dns.com` at Squarespace. See `docs/WEB_DEPLOY.md`. |
| GH Pages | `gh-pages` branch → `pretty-aud.github.io/wilson/` — a **dormant, manually-redeployed fallback**. Vercel is primary. |
| ai-proxy | Edge Function, all 3 envs; per-workspace key (`workspace_ai_keys`, AES-256-GCM) falling back to the platform `ANTHROPIC_API_KEY`. ✅ **`ANTHROPIC_API_KEY` + `WILSON_AI_KEY_SECRET` set on dev/staging/prod, verified 2026-07-30 with matching digests** (the match matters: a differing `WILSON_AI_KEY_SECRET` makes a company key stored on one env undecryptable on another). **Three stores share the name and none feeds another** — GitHub *repository* secrets (Actions only), Vercel env vars (web build), and **Supabase Edge Function secrets, the one `ai-proxy` reads**; the key had sat in the first for a day, referenced by no workflow. Before that, this row and OWED §6B both claimed staging had it for eleven sessions and neither had been re-checked — it was on none. **State a date and the command, or it rots.** `AI_PROXY_RPM` optional (default 60). |
| Original brief | `WILSON/docs/ORIGINAL_BRIEF_multiuser.md` |
| TPN audit baseline | `WILSON/TPN_AUDIT/` (AUDIT_INDEX, FINDINGS, RECOMMENDATIONS, REMEDIATION_PLAN, SUMMARY, LEARNINGS) |
| Email | Resend SMTP, domain `mail.petalstudios.co`, DNS at Squarespace |
| GitHub secrets | `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_PROBE_USERNAME`, `DEV_PROBE_PASSWORD` |
| Cron jobs | `wilson-purge-edit-history` 04:43 · `wilson-purge-soft-deleted` 04:47 · `wilson-purge-app-events` 04:51 · `wilson-purge-otter-trash` 04:55 · `wilson-purge-rate-limits` 04:59 UTC (all envs). **No purge for `file_events` or `platform_audit` — deliberate, TPN-LOG-004.** |
| Operator console | **`https://admin.petalstudios.co/wilsonadmin`** — decided 2026-07-30 (Audrey, §11C option 1: subdomain, not the apex). Second Vercel output folder on the SAME project, `vite --mode admin`, entry `admin.html` → `src/admin/`. Session key `wilson.operator.session`. **Zero repo change for the domain** — `vercel.json` routes on path, so every domain on the project serves both surfaces; `beta.` keeps working. The subdomain is a second ORIGIN, which upgrades session isolation from a build-time key string to a browser-enforced boundary. ⚠️ Use the product app on `beta.`, not `admin.` — `ForgotPasswordWizard` derives its redirect from `window.location.origin`, and the new origin is not in staging's allow-list. Email+password+TOTP sign-in. Setup runbook: `OWED_AUDREY.md` §12. |
| Operator tier | `public.platform_operators` (SQL-only grant, by design — no UI on any surface). Guard: `supabase/functions/_shared/operatorGuard.ts`. |
| pgTAP without Docker | `python scripts/tap-hosted.py <out.sql> [migration.sql] <suite.sql>` then `supabase db query --linked --file <out.sql>`. `collected` must equal `planned`. |
| Backups workflow | `.github/workflows/backups.yml` (git root) — **lives on `main`, and must.** GitHub fires `schedule` workflows EXCLUSIVELY from the default branch and only shows `workflow_dispatch` for workflows present there; committed to the feature branch it had two independent reasons never to run (§6 #24). Any future scheduled workflow must live on `main` or it is decoration. Secrets: B2_* + BACKUP_*_DB_URL. |
| CI replay list | `rls.yml`'s failure replay must name EVERY suite. It stopped at 32 until S17, so suites 33–38 failed invisibly. Note a failing pgTAP **assertion** is not a SQL error, so "replay produced no ERROR lines" never means "this file passed". |
| Auto-memory | `~\.claude\projects\C--Users-Audrey-Documents-My-Work-Dev-Work-Claude-Work\memory\wilson_multi_user_plan.md` |

---

## 10. Decisions log & open questions

### Resolved 2026-07-28 (Audrey, during the plan reconstruction)

- **Session 8 scope: FULL** — dashboard views + TipTap/Yjs notes +
  profile/avatar + workspace live channel.
- **BYO storage v1.0:** local / local server, Supabase Storage, Google Drive;
  AWS S3 + Hetzner post-1.0. → locked #14.
- **Web build: ALL THREE tools.** Consequence: O.T.T.E.R./D.O.G. need a cloud
  content model first — added as NEW Session 10; operator console + web + TPN
  moved to Session 11. O.T.T.E.R./D.O.G. cloud content = personal +
  company-shared only, never cross-company. → locked #16/#17.
- **Builds + backups host: Backblaze B2 for both.** → locked #15.

### Resolved 2026-07-28 (second round)

- **(A)** Per-user rate-card view/edit toggles: **REINSTATED** → S9 (admin
  confirm flow per the brief).
- **(B)** Producer/CD row highlight + producer/creator auto-manager staffing:
  **confirmed** → S9.
- **(C)** Field-level "who's-editing-this-cell" presence: **S8+** — stretch
  goal from Session 8 onward, earliest feasible.
- **(D)** Bulk user creation: **adapt the invite flow to multi-invite** —
  Slack-channel-style "add many people at once" (NewCompanyWizard + admin
  terminal) → S9.
- **(E)** Team Members assigned-projects column: **confirmed** → S9.
- **(F)** Avatars: **central Supabase Storage** → S8.
- **D.O.G. web clarification:** no local-file access needed — web D.O.G.
  works off the open project's cloud files; light lift, lands with the S11
  web build (see locked #17).

### Resolved 2026-07-28 (Session 8 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **Avatars ride the EXISTING `user-avatars` bucket (0009)** — the §10-F
  "central Supabase Storage" decision was already implemented in S4;
  creating the brief's new `avatars` bucket would have broken ProfileSection,
  NewUserWelcome and the `isOwnAvatarUrl` render guard. No new bucket.
- **Notes v1 exclusions** (db/README §16): owner-only with NO admin bypass;
  hard delete + confirm (no trash); not edit-history captured; never on any
  realtime topic. Multi-device safety = Yjs snapshot-merge-write, not live
  sync.
- **Task UI/DB parity fixes (0019)**: `tasks.notes` column added; `'urgent'`
  added to `task_priority` ('critical' remains, unused) — both were
  pre-existing cloud landmines reachable from RABBIT's own popup.
- **Workspace channel strictness**: deactivated members are denied the
  channel while table reads still allow them — safe-direction divergence,
  pinned by pgTAP 23, aligned in S9.

### Resolved 2026-07-28 (Session 9 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **Auto-staffing scope**: the 0020 trigger seats creator+producer on
  CLIENT creates only (`auth.uid() IS NULL` skips) — fixtures, migrations
  and service scripts keep 0013's unstaffed-open contract. Consequence:
  projects created in-app are staffed from birth, so plain members no
  longer get write access to NEW projects they aren't seated on (this IS
  the §10-B intent; legacy projects unchanged).
- **Edge-Function claims**: app_role/workspace_id are read from the TOKEN
  payload, never `getUser().app_metadata` (only workspace_id is persisted
  there). All admin functions + invite-member also re-check the LIVE
  membership row.
- **app_events streams**: the 'admin' event type + WIL-41xx codes are
  server-reserved (clients can't forge audit lines); client reporter uses
  the error/system/update streams.
- **Auto-update channel**: NSIS via electron-builder is the ONLY
  auto-updatable artifact; Forge/Squirrel stays for dev packaging and
  degrades gracefully ('unsupported').
- **Show-once credentials**: admin-created users may have NO real email
  (synthesized non-deliverable address) — password resets are then
  admin-only by design.

### Resolved 2026-07-28 (Audrey, post-Session 9)

- **Remaining work re-split into THREE smaller sessions** (S10 O.T.T.E.R.
  content · S11 web build + hosting/routing · S12 operator console + TPN +
  v1.0.0) — sized for the switch to Opus 5.
- **Hosting paths locked (#18)**: `/wilson` (app), `/wilson/<tool-or-page>`
  (pages), `/wilsonadmin` (operator console). **CONFIRMED by Audrey:**
  `/wilsonadmin` = the PLATFORM OPERATOR console; the company Admin
  Terminal remains an in-app page at `/wilson/admin-terminal`.
- **Domain relaxed (Audrey):** hosting does NOT need to be at
  `petalstudios.co` — S11 ships to a test host with the locked path shape
  so she can test after the sessions; the production domain cutover is
  post-v1.0.

### Resolved 2026-07-28/29 (Audrey, during Session 10)

- **O.T.T.E.R. sharing is THREE tiers, not two** — `personal` (mark a course
  "just for me"), `shared` ("made for others to share with"), and
  **`company_standard`**: a company can bless a premade course so a user takes
  that instead of generating a new one. Refines locked #17.
- **Owners can grant named individuals edit access** to their course
  (`otter_course_editors`) — creator + admins + grantees can edit.
- **Admins can see that a personal course EXISTS, not its contents** —
  metadata only, via `otter_course_index()`. (The brief's middle option.)
- **Using a company-standard course FORKS a personal copy**, so the official
  version stays pristine and admin edits never change a course underneath
  someone mid-study. The user can then **submit a change request** — their
  updates plus a written explanation of what they are recommending — for an
  admin to review.
- **Soft delete + 30-day trash** for O.T.T.E.R. content (not the notes-v1
  hard-delete precedent — courses cost real time and API spend to generate).
- **Standalone RABBIT against your own Supabase project is no longer
  supported** → `schema.sql` and `seed.sql` deleted, `public.users` dropped.
  Gap #9 closed after five sessions.

### Resolved 2026-07-29 (Session 10 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **No storage bucket for O.T.T.E.R.** — the tool has zero binary content.
- **O.T.T.E.R. content rides no realtime topic.** The 0018 workspace channel
  hands full row payloads to every subscriber, so personal course bodies must
  never travel on it, and courses are not a live co-editing surface.
- **In cloud mode the client-facing course "slug" is the course UUID.** On
  disk a slug was `slugify(name)`, unique only within one user's folder; in a
  shared workspace two visible courses can legitimately share one. Safe because
  `Otter.jsx` looks courses up by NAME, never by slug.
- **Scraped reference page text is not migrated** (url + title only) — a
  regenerable cache of third-party content that does not belong in a shared
  multi-tenant database.
- **An admin cannot grant themselves edit access on a personal course.**
  Without that restriction the "no admin bypass" rule was defeatable in two
  steps (index → self-grant → read). Found by adversarial review.

### Resolved 2026-07-29 (Audrey, post-Session 10 re-plan)

- **FOUR sessions remain, not two**: S11 O.T.T.E.R. UI · S12 web build · S13
  file lifecycle & data stewardship · S14 operator console + TPN + v1.0.0. S11
  had been carrying two full sessions of work.
  **SUPERSEDED later the same day** (see the post-S11 entry below): a FIFTH
  session was added for change-request approval, so file lifecycle is now S14
  and the operator console S15. Locked #19 carries the current numbering.
- **Storage relink is a first-class feature, modelled on ShotGrid/Blender**
  (Audrey): find + preview + **apply**, not merely detect. Point it at the new
  folder and it re-finds the moved assets itself. `local_server` first, matcher
  written provider-agnostically.
- **CSV export ships in both tiers** — per-page buttons *and* a full workspace
  takeout.
- **The O.T.T.E.R. UI must change as LITTLE as possible** (Audrey): "I like how
  it works now." The new features attach to the existing two-sidebar shell —
  filter chips above the existing lists, dialogs off existing rows, the tier
  picker as one more field in the create flow — rather than new views. The
  `laws-of-ux` skill still gets invoked, but it governs the surfaces being
  ADDED; where a law disagrees with something that already exists, that is a
  close-out recommendation for Audrey, not a licence to redesign.
  Consequence: the change-request **review queue lands in the Admin Terminal**,
  not in O.T.T.E.R. — it is admin work, and it keeps O.T.T.E.R. untouched.
- **O.T.T.E.R. content is EXCLUDED from the company-wide takeout.** Audrey's
  reason: courses are educational and may encode internal practice the company
  does not want leaving. There is a second, independent reason that points the
  same way — **personal courses are private even from admins** (0022), so a
  company takeout that swept in O.T.T.E.R. would become an admin backdoor into
  exactly the content Session 10 made unreadable to them. The existing
  per-user `/api/export-all` stays: exporting *your own* courses is fine; a
  company-wide export of *everyone's* is not.
- **B2 holds no customer content** — nightly `pg_dump` + auto-update installers
  only (locked #15). Project files stay in the company's chosen storage
  (locked #14), which is what makes a database-only backup sufficient: `files`
  rows carry `storage_provider` + a relative `storage_path`, so restore + a
  reconnected storage resolves. Confirmed 2026-07-29 by inspecting the schema
  and all three adapters.

### Resolved 2026-07-29 (Session 11 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **The trash needed a migration.** See §5/§6 #20. The lesson generalises: "the
  server is done" is only true if a client can *reach* every state the server
  supports. A soft delete with no listing RPC is a one-way door, and it read as
  complete because the write path was fully pgTAP-pinned.
- **`otter_course_editors.workspace_id` has no DEFAULT** — the only O.T.T.E.R.
  table like that, and `fn_otter_editor_grant_workspace` validates rather than
  defaults. The S11 adapter omitted the column (as it correctly does everywhere
  else) and every editor grant failed with a message that read like a
  cross-tenant bug. **94 passing probes missed it because every pgTAP fixture
  supplies the column by hand** — a general warning about fixtures that are more
  careful than the client. Suite 29 now asserts the schema fact itself.
- **Error banners must live where the user is looking.** Every S11 banner
  initially rendered inside `renderLibrary()`, which sits in a `hidden` wrapper
  unless `currentView === 'library'` — while the Sidebar 1 chips are visible in
  *every* view. A failed trash restore therefore produced no feedback at all.
  Filter chips now navigate to the library, and the sidebar trash list carries
  its own error surface. **Anything reachable from a persistent sidebar needs
  feedback that does not depend on the main pane's current view.**
- **O.T.T.E.R. stays mounted on every page** (the all-pages-rendered shell), so
  a window-level keyboard shortcut registered inside it fires from RABBIT,
  Settings and the Admin Terminal. `Ctrl/Cmd + \` is gated on
  `currentPage === 'otter'`. Same class of trap as the AdminTerminalBody
  lazy-fetch rule.
- **Existing UI touched in S11** (the list Audrey asked for — it is short by
  design):
  1. Sidebar 1's course row: was one full-width `<button>`, now a row
     containing that button plus the actions menu. Same padding, border and
     hover; no visual change.
  2. Sidebar 1 gained a 24px collapse strip above "New" (the authorised
     exception).
  3. `renderDeleteConfirm`'s title and body copy — it claimed a soft delete
     was permanent.
  4. The course-detail header and library cards gained badges; the
     "Add Subject" / "Import" / "Generate All Outlines" controls are now
     conditional on `can_write`.
  Nothing was renamed, reordered or restyled, and no `currentView` was added.
- **UX-law recommendations for EXISTING surfaces — for Audrey, NOT acted on**
  (per the S11 rule that laws govern added surfaces only):
  1. *Jakob's Law / Fitts's Law* — Space opens Search as a global key with no
     visible affordance; the nav bar has a Search button but the shortcut is
     undiscoverable and unusual (most apps use `/` or Cmd+K).
  2. *Von Restorff* — the nav bar's six items are visually identical, so
     Validate (a destructive-adjacent, rarely-used tool) reads as equal in
     weight to Library.
  3. *Doherty Threshold* — course generation shows a time-based fake progress
     bar whose percentages are invented; honest indeterminate progress would
     survive a slow API better.
  4. *Cognitive Load* — the Library sort control offers only Date and Name
     while the sidebar sorts by type; the two lists order the same courses
     differently.

### Resolved 2026-07-29 (Audrey, post-Session 11 — all three S11 flags decided)

- **(1) The API key: one `ai-proxy` Edge Function for BOTH hosts** → locked #21.
  Audrey's requirement was "a solution that works for both the web app and the
  desktop app that does not have any issues with the key… the key should only be
  managed in the admin portal later."
  Shape: the client posts the body it already builds (`model`, `max_tokens`,
  `system`, `messages`, `tools`, `betas`) to `/functions/v1/ai-proxy`; the
  function attaches the key server-side and returns Anthropic's JSON. Electron
  uses it too — one path, so there is no "works on desktop, breaks on the web"
  class of bug (which is exactly what gap #21 was). Auth follows the S9 pattern:
  claims from the token payload **plus a live membership re-check**, so a
  deactivated member cannot spend. Usage lands in `app_events` (0021) with model
  and `usage.input_tokens`/`output_tokens`, which gives the Admin Terminal a
  spend view nearly free and the operator console its per-company numbers.
  **The constraint that shapes the implementation:** Edge Functions must respond
  within **150s** (400s wall clock on paid plans). O.T.T.E.R. subject generation
  already shows "Still working…" at 45s, retries up to 21s on overload, and runs
  three web searches — a plain synchronous proxy would occasionally 504 and lose
  a whole generation. So the proxy requests `stream: true` from Anthropic and
  forwards the SSE: first byte is immediate, the response deadline never bites,
  and the 400s wall clock governs instead. A small client helper reassembles the
  stream, so the **six** `callAnthropicAPI`-style helpers change and the 13 call
  sites do not. Nothing streams today, so no behaviour is at risk.
- **(2) Approval APPLIES the change** → locked #22. Additive only (add + update,
  never delete) and **auto-archive the target before every apply**, because
  O.T.T.E.R. is not edit-history captured so an overwrite is otherwise
  unrecoverable. Decline requires a note; the proposer then either accepts the
  decision or revises and resubmits.
- **(3) Submitting a request lets the admin see the course** → locked #22. Scoped
  to the review window and read-only. This is a **consented** exception to "a
  personal course is private even from admins", not a bypass: the user chose to
  submit it for review, and access ends when the request settles.
- **Sequencing — RESOLVED by adding a session (Audrey, 2026-07-29).** (2) and (3)
  were first specced as an S12 "Block C". The agent flagged that S12 would then
  be carrying the web build, a new Edge Function *and* a new migration — the same
  double-booking that cost S10 and S11 half their scope. **Audrey's call: give it
  its own session.** So the change-request work is now **S13**, file lifecycle
  moves to S14 and the operator console to S15 (locked #19). S12 is back to two
  blocks that are genuinely one job: the proxy and the web build.
  Worth keeping as a pattern — this is the third time splitting a session has
  been the right answer, and the second time it was decided *before* the session
  rather than after it overran.

### Resolved 2026-07-29 (Session 12 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **The test host is GitHub Pages on the existing public repo.** A `gh-pages`
  branch serves `https://pretty-aud.github.io/wilson/` — no new accounts, no
  credentials, and the repo name makes the path shape match `base:/wilson/`
  exactly. `/wilsonadmin` becomes a sibling repo named `wilsonadmin` in S15.
  Consequence Audrey should know: **the built bundle embeds wilson-dev's
  `VITE_SUPABASE_URL` + anon key, which are now publicly readable** on that
  branch. Anon keys are public-by-design (RLS is the boundary, sign-ups are
  off, every table is FORCE RLS + pgTAP-pinned) and any web deployment ships
  them — but it is a state change worth stating out loud.
- **`ai_not_configured` is a 501, not a 503.** Every client retry loop keys
  on 429/503/529 as transient; the missing-key state is permanent, and a 503
  bought ~21s of pointless retries before the honest message. Found by the
  adversarial review; 501 follows the otterFetch precedent.
- **Web sessions live in localStorage** — the Session 10 note said "httpOnly
  cookie on web", but a static host has no server to set one. localStorage is
  what supabase-js's own `persistSession` does; the `TOKEN_REFRESHED` hook
  re-saves the rotated refresh token so long-lived tabs survive. The
  `wilson.dev.session` key kept its name (renaming would sign every dev out
  for zero gain).
- **`supabase config push` is deliberately NOT used** for the
  `site_url`/`additional_redirect_urls` change — it pushes the whole local
  `[auth]` block, and the local toml says `smtp.enabled = false`, which would
  disable hosted Resend email. The dashboard change is on Audrey's owed list
  with exact values.
- **Intake total failure is now loud.** Removing the per-user key gate
  exposed a fake-success path (all chunks fail → empty breakdown → "Intake
  complete"); `runWorkerPool` now throws when NOTHING parsed, keeping
  partial-failure tolerance. Found by the adversarial review.
- **PostgREST `update({})` is a silent 200 no-op** — stripping unknown
  columns from a patch can turn an honest 42703 into silent data loss. The
  adapter now throws on attachments-only patches. General lesson recorded in
  §6 #31; the review caught it by empirically testing against the linked
  project.
- **The review's other keeper:** in-stream SSE `error` events end the stream
  normally — anything that logs "completed" on stream close must sniff for
  them (ai-proxy's usage telemetry now does).

### Resolved 2026-07-30 (Audrey, post-S13 — the Requests view, commit `54d5225`)

- **The change-request surface lives IN O.T.T.E.R.** ("make sure that view is
  in the otter app"). This deliberately revises the S11 call that the queue
  belongs only in the Admin Terminal — the Terminal section STAYS (admin work
  in the admin place), but the in-tool tab is the primary home: admins get
  their company-library controls where the library is, and proposers see
  their own requests + feedback without leaving the tool.
- **The brief's three APP tiers map onto the queue as admin = decide,
  manager = view, user = own requests.** Audrey's word "reviewer" in the
  2026-07-30 message is the brief's tool-wide **Manager** tier, not the
  RABBIT project-level reviewer seat (different axis). Migration 0026 gives
  managers READ on `otter_cr_select` only — deciding, the fork window and
  apply all still refuse them (pgTAP-pinned). The manager read arm follows
  the policy's existing JWT convention (same staleness as the admin arm since
  0022); every acting path stays live-row — documented in 0026's header.
- **The proposer's fork stays private from managers.** The 0025 consent is
  to REVIEWERS; a manager sees the request row (summary, status, outcome),
  never the fork content.

### Resolved 2026-07-29 (Session 13 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **`approved` is unreachable except through `otter_cr_apply()`.** The trigger
  only accepts open → approved when a transaction-local GUC set by the RPC
  names that exact request. Locked #22 says approving IS applying; a bare
  status flip would record an approval that moved no content, so it now raises
  "approving applies the change — call otter_cr_apply() instead".
- **The review window is consent-scoped to the proposer's OWN course.** A
  request whose `source_course_id` names a colleague's personal course would
  otherwise have exposed it to admins the moment anyone filed it. Refused at
  INSERT, re-checked in the helper and in the RPC; `source_course_id` can only
  ever change to NULL (the fork-purged FK path), never to a different course.
- **Settled requests are frozen records.** Widening the proposer's RLS arm so
  "accept the decision" could pass also let them target already-rejected rows;
  the trigger now pins summary + note on every terminal row instead of
  raising, because the ON DELETE SET NULL update from a purged fork lands in
  the same branch and must keep working. Found by the adversarial review, as
  was the withdraw-arm reviewer-stamp forgery it sits next to.
- **Reviewer authority is live-row everywhere.** fn_otter_cr_review originally
  read the JWT (`current_app_role()`, the 0022 convention); it now reads the
  live `workspace_members` row like the helper and the RPC, so a demoted admin
  loses decide/apply/window on the next statement, not the next token refresh.
- **A manual re-run of 0022 must be followed by 0025** — 0022 recreates the
  trigger, `otter_courses_select`, the CR policies and `otter_course_index` at
  their S10 definitions, and every post-condition still passes in that
  half-reverted state. Both headers now state the ordering rule; the migration
  runner's by-version ordering makes every normal path safe.
- **`changes_requested` sits in the Decided tab.** The Open tab is exactly
  "needs an admin's decision" (Selective Attention); a declined request is
  waiting on the proposer and re-enters Open by itself at revision+1 when they
  resubmit. Zeigarnik for the proposer is served in O.T.T.E.R.'s dialog.
- **The one cross-tool jump is an event, not a prop.**
  `wilson:open-otter-course` — App.jsx navigates the shell, Otter selects the
  course (probing readability first: the window can close between queue load
  and click, and an unreadable slug would poison Otter's course cache).
  AdminTerminalPage keeps taking no props.

### Resolved 2026-07-30 (Session 14 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **Block D decided: the `rabbit-files` bucket EXISTS now** — private, 50 MB
  cap, path-scoped policies keyed on `projects/{project_id}/…` riding the
  same helpers as the files-table policies. Deciding factors: locked #14
  names Supabase Storage a v1.0 provider, the adapter was already written
  against the bucket, and the S2 migration tool already rewrites migrated
  rows to point into it — dropping it would have stranded all three. The
  uploader-cleanup DELETE policy is bounded to a ONE-HOUR window on the
  uploader's own fresh objects; the review showed the unbounded version let
  any past uploader destroy or silently replace live blobs, unaudited.
- **Blob GC is admin-INVOKED, not a cron.** TPN TS-1.5 wants dual
  authorization on destruction — a stated confirm click is the second
  factor — and a GitHub Actions cron would hit the gap-#24 default-branch
  trap. The queue + certificates make each run fully accountable
  (WIL-3003/3004 + per-blob ledger rows).
- **Relink folders must be USER-CHOSEN, enforced server-side.** The Express
  server answers any local origin (`cors()`), so a body-supplied
  baseDir/folderPath is never accepted: `rabbit:pick-directory` records
  every user-picked folder, and the relink routes 403 anything else that
  isn't inside the project's own roots. Found by the review — the original
  route reinstated the arbitrary-path read/unlink the PATCH hardening had
  just closed.
- **`files_dir` is the relink base-change semantic**: applying a relink
  against a new folder makes it the project's files home (uploads
  included), disclosed in the dialog BEFORE the write, surfaced in
  Files & Storage with a Reset control, refused with a 409 while the
  recorded home is merely offline, and recorded in the audit stream. The
  review supplied all four guards.
- **file_events has NO purge job on purpose** (TPN-LOG-004: audit ≥ 1 year;
  'purged' rows are the TPN-CONT-002 deletion certificates and outlive
  their subject — no FK on file_id/project_id, admin read-arm survives
  project purge). Revisit retention at the S15 TPN re-audit.
- **The takeout is RLS-scoped client reads, never a DEFINER sweep** — it can
  only contain what the requesting admin already reads. O.T.T.E.R. and
  Notes are excluded in the UI copy AND the archive manifest (locked #20).
- **Review keepers (the general lessons):** a storage policy pinned only by
  existence lets CI bless an unbounded delete (pin the qual's guards too);
  a certificate write must be infallible for client-reachable inputs
  (truncate, don't trust); PostgREST max_rows applies to service_role
  (page every Edge-Function read that can exceed 1000 — the unpaged
  version deleted CURRENT avatars past the cap); and the export/matcher
  bugs (composite-pk order, m.id vs user_id, greedy name-rung) were all
  "fixtures more careful than the client" shapes — S10's meta-lesson, still
  earning its keep.

### Resolved 2026-07-30 (Audrey, post-S14 — v1.0.0 exit documentation)

- **v1.0.0 ships with a systems handbook.** After the build work is fully
  done, S15 writes `docs/SYSTEMS_HANDBOOK.md`: every system listed (what
  Supabase is doing, what Vercel is doing, etc.), what talks to what, in
  length. Audience is dual by design: future team members reading it, and
  other Claude accounts receiving it as seed material for Claude projects
  and skills — so self-contained, factual, excerptable. "Private" means
  Audrey hands it out manually; the repo is public, so the document
  carries no secrets (architecture facts in it are already public in
  these docs).
- **A visual design document follows, driven by Audrey.** S15 also
  produces `docs/SYSTEMS_DESIGN_PACK.md` — mermaid wireframes/dataflows
  of how each system connects and how each tool and each load-bearing
  function works, with a diagram inventory — as the source pack for a
  Claude design session where Audrey builds the final
  infographic/wireframe document.
- ~~Both are sequenced AFTER the S15 build blocks and BEFORE the v1.0.0
  tag; if the session overruns, docs + release split into their own
  session rather than compressing the handbook.~~ **SUPERSEDED same day:
  the split was made proactively instead** — see the three-session
  amendment below and locked #19.

### Resolved 2026-07-30 (Audrey, post-S14 — the three-session tail)

- **S15 was bloated (console + TPN + sweep + two docs deliverables + the
  cut ≈ 2.5–3 sessions), so the tail is now three sessions**: S15
  operator console + TPN hardening (last build) · S16 systems
  documentation & design pack (docs-only, quick relative to a build
  session — no migrations/deploys — but the drift review and diagram set
  are real work) · S17 release.
- **Docs before release, not after (Audrey asked; agent recommended
  keeping her order):** writing the handbook forces an end-to-end read of
  the frozen system, so S16 doubles as the final audit — S17 fixes
  whatever it surfaces BEFORE the v1.0.0 tag, and the handbook release
  gate survives. Swapping would have shipped the tag first and landed any
  documentation-pass discoveries post-release.
- S16 files code findings as §6 gaps rather than fixing them (frozen-code
  rule); S15's close-out appends a "what S16 must document" note to the
  S16 prompt so console-era additions reach the handbook while fresh.

### Resolved 2026-07-30 (Session 15 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **Granting platform-operator status is SQL-only, on purpose, and there is no
  UI for it anywhere.** The console can create and destroy companies, so the
  one thing it must not be able to do is mint more operators. Keeping the
  grant out of band means the highest privilege in the system cannot be
  escalated from a web session even by someone already holding it. Cost:
  bootstrapping a new environment needs one INSERT in the SQL editor
  (OWED_AUDREY §9B). Worth it.
- **The operator console requires MFA outright**, unlike the company Admin
  Terminal which only challenges people who already enrolled. Two reasons it
  is safe to be strict here where it would not be there: the surface is brand
  new, so no existing workflow breaks; and it can delete a tenant. An operator
  with no verified factor is refused with the actual remedy, not a bare 403.
- **Per-company Anthropic keys are AES-256-GCM ciphertext, not Supabase
  Vault.** Vault exists on all three hosted projects and would have been the
  more conventional answer. It was rejected because CI's pgTAP job runs
  `supabase start` on a local stack that cannot be run on the development
  machine (no Docker), so a vault dependency inside the migration chain could
  not be verified before it either passed or broke every job at once.
  App-layer AES-GCM keeps 0028 plain SQL and puts the crypto where the
  adversarial review can read it. **The consequence Audrey should know:** the
  data-encryption key lives in the `WILSON_AI_KEY_SECRET` Edge secret, so
  rotating that secret orphans every stored company key (ciphertext becomes
  undecryptable, ai-proxy fails soft to the platform key, the console still
  shows the old hint). Stated in OWED_AUDREY §9C.
- **Why the key is encrypted at all, given the table is already
  service-role-only with zero policies:** locked #11/#15 put a nightly
  `pg_dump` of prod and staging into Backblaze B2 with 90-day retention. A
  plaintext column would copy every tenant's Anthropic spending credential
  off-platform. The ciphertext goes into the dump; the key that opens it does
  not.
- **`platform_audit` carries no workspace FK, and that is the whole design.**
  `app_events` and `file_events` both `ON DELETE CASCADE` on workspace, so a
  teardown destroys the evidence of itself — the second half of gap #34, and
  the reason a fourth audit stream exists rather than a fifth column on an
  existing one. Slug and name are snapshotted as text so a certificate still
  names the company after the row is gone. pgTAP suite 35 pins exactly this
  by deleting a workspace and asserting file_events vanished while the
  certificate survived.
- **The console talks to service-role Edge Functions, not to widened RLS.** An
  operator has no cross-tenant reach today beyond `workspaces` and
  `auth_attempt_log`; every other table gates on `current_workspace_id()`, and
  the JWT hook refuses to mint a workspace_id the caller is not a member of.
  The alternative — operator arms on a dozen policies — would put every
  company's rows one policy bug away from each other. One crossing
  (`operator_workspace_summary()`), service_role only, behind one guard.
- **The durable rate limiter fails OPEN and operatorGuard fails CLOSED**, in
  the same session, deliberately. A limiter is an abuse control and
  authorization has already run above it, so a database hiccup must not take
  every tenant's AI features offline; an auth check that cannot verify has no
  such excuse. `_shared/rateLimit.ts` logs loudly when it fails, because a
  permanently-broken limiter is otherwise indistinguishable from a working one
  from the outside.
- **Teardown removes the tenant, not the people.** A user whose only
  membership was in the destroyed company keeps an auth account with no
  workspace. Deleting those identities would be a destructive act on accounts
  the operator did not create, and a user may belong to two companies — see
  §6 for the follow-up.
- **`npm run build` still emits only `index.html`.** The admin entry is gated
  on vite `--mode`, so the operator console cannot ship inside the desktop
  installer. Verified by building and checking `dist/` has no `admin.html`.
- **Session isolation between /wilson and /wilsonadmin is a KEY STRING, and
  nothing else.** localStorage is scoped per origin, not per path. Both
  surfaces are on the same host, so the only thing separating them is that
  the bundles are compiled with different constants (`__WILSON_SURFACE__`).
  This is worth remembering because it is fragile in one specific way: any
  future code that reads a session key without going through
  `sessionStorage.js` reintroduces the leak.

### Resolved 2026-07-30 (Session 16 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **The handbook found a security defect that eleven sessions of adversarial
  review had not.** #44 (`custom_access_token_hook` executable by
  `authenticated`) survived because every prior pass read the `REVOKE` in 0001
  and 0003 and stopped there — nobody traced it *forward* through 0011's
  blanket `GRANT EXECUTE ON ALL FUNCTIONS`. Writing "who may execute this"
  as a table forced the question in a way reviewing a diff never did. **This is
  the argument for docs-before-release, and it paid for the session on its
  own.** The generalisable lesson: a grant made in migration N can be silently
  widened by migration N+k, and only a whole-schema read catches it.
- **Two documents, opposite jobs, and the discipline held.** The handbook is
  long because explanation is its purpose; the design pack is diagrams with
  one-line captions and links back. Where both would have explained the same
  thing, the pack cut it. Worth preserving if either is ever revised.
- **A docs session does not need a build session's review.** S16 opened a
  four-finder drift review out of habit; Audrey stopped it partway, correctly.
  Three finders had already returned 13 real findings and the fourth would have
  added marginal value at real cost. **Size the review to the work** — recorded
  in S17's prompt as a standing note.
- **The handbook is a release gate, which makes it a maintenance obligation.**
  If S17's fixes change behaviour the handbook describes, the handbook changes
  in the same commit. A stale gate is worse than no gate, and §17 (known
  limits) is the section most likely to drift as gaps close.

### Resolved 2026-07-30 (Session 17 close-out — architecture-driven, flagged
### for Audrey's awareness)

- **Testing one pgTAP suite in isolation cannot prove a migration is safe.**
  0030's audit trigger writes `app_events` rows during *every* suite's fixture
  setup, which broke `25_app_events`' unfiltered count. Suite 38 passed alone
  on hosted PG17; CI runs all 38 against one database and failed. The hosted
  harness is still the right tool — it just has to be pointed at the whole set
  when a migration adds a writer. Now recorded in §2.
- **A CI annotation that says "no ERROR lines" does not mean "passed".** The
  replay greps for SQL errors, and a failing pgTAP *assertion* is not one. The
  list had also stopped at suite 32, so 33–38 failed invisibly — every
  annotation pointed at files that were fine. Both fixed; the lesson is the
  more transferable half.
- **The handbook is a gate, not an oracle.** S16 established it as the
  accurate document, and it mostly is — but its §15 Vitest count was stale
  where MASTER_PLAN's was right. A mechanical "sync the plan to the handbook"
  pass would have injected a regression. Where they disagree, the code decides.
- **"Fix it or delete it" was a false choice three times this session**, and
  noticing that was worth more than either option. WIL-1001/1002/1003 can be
  neither (deleting removes visible rows, wiring adds them, and two of the
  three are structurally impossible client-side). The `last_updated_at`
  column could not be dropped without breaking every RABBIT UPDATE. The two
  project-folder helpers encode a real invariant rather than drift. In a
  session whose hard rule was "change nothing visible", the correct answer was
  repeatedly *document the constraint* — and each of those is now written down
  where the next reader will hit it.
- **Recon that is allowed to contradict its brief pays for itself.** Every one
  of the four corrections above came from a reader told explicitly to report
  when the brief was wrong. #45 was wider than filed, #49 needed a second fix
  the gap never mentioned, #56 was unreachable rather than merely unwired, and
  the dead-column "cleanup" would have caused an outage.

### Still open

— none currently. New questions get logged here with their target session.

**Waiting on Audrey before v1.0.0 can be tagged:** `OWED_AUDREY.md` §0
(rotate the published `smoke_admin` password — open CRITICAL), §9A + §9B
(enrol TOTP *and* seed `platform_operators`; either alone leaves the console
signing you in and refusing everything), §9C (`WILSON_AI_KEY_SECRET`), §5
(`ANTHROPIC_API_KEY` on dev/prod). The tag and the `main` merge are hers to
authorise once she has worked through `docs/RELEASE_TESTING.md`.
