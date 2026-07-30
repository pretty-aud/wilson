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

## 2. Architecture (as built through Session 7)

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
  RLS policy starts from
  `workspace_id = (auth.jwt()->'app_metadata'->>'workspace_id')::uuid`;
  indexes on `workspace_id` are mandatory.
- **Migrations `0000`–`0027`** in `supabase/migrations/` — all deployed to
  dev + staging + prod as of Session 14 close-out. No backlog.
  **Ordering rule (S13):** 0025/0026 overwrite objects 0022 also creates; a
  MANUAL re-run of 0022 must be followed by re-running 0025 AND 0026 (all
  three headers say so). 0027 overwrites nothing — no ordering rule.
- **Edge Functions:** `resolve-login`, `issue-session` (ES256),
  `provision-workspace` (+ initial-team invites[], S9), `invite-member`,
  `ai-proxy` (S12), `storage-gc` (S14 — admin-invoked blob disposal with
  certificates), and the S9 admin set on `_shared/adminGuard.ts`:
  `admin-create-user`, `admin-reset-password`, `admin-set-active`,
  `admin-user-security` (verify_jwt=false; claims from the TOKEN payload;
  live-row admin check; MFA aal2 step-up).
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
- RABBIT talks through the **adapter layer** (`supabaseAdapter` for cloud,
  local / Google Drive adapters preserved). Never bypass it.
- Presence + LIVE pill (`RealtimePresenceStrip`), undo toast, EditHistoryDrawer
  with revert — all landed.

### Test & CI gates

- **pgTAP RLS suite** `supabase/tests/rls/01–33` (runs in CI local stack;
  realtime probes environment-tolerant). The seven O.T.T.E.R. suites (26–32)
  total **184 probes**; suite 33 (S14 file lifecycle) adds 26.
- **Vitest** 329/329 green end of S14. **Playwright** auth/permissions e2e.
- **No Docker on this machine**, so pgTAP is verified by shipping a
  `BEGIN; … ROLLBACK;` script through `supabase db query --linked --file`.
  Two things make that harness lie if you get them wrong: keep `SELECT plan(N)`
  (pgTAP raises "test without a plan" otherwise), and rewrite **every** pgTAP
  function the suite uses — a missed one (`has_table` bit S11) still runs and
  still counts toward pgTAP's numbering but never reaches the collector, so it
  vanishes from the pass count. Always compare collected rows against
  `max(test number)`.
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

---

## 3. Locked decisions — do NOT relitigate

1. **Supabase Auth** (not express-session/connect-pg-simple — the brief's
   suggestion was superseded in Session 1).
2. **Username-first login** — server-side resolver, constant-time, rate-limited.
   Creator username: `Audrey`.
3. **Electron + web in parallel from v1** (web build lands Session 10).
4. **Hybrid storage** — central Supabase core + bring-your-own storage for
   company files/artwork.
5. **Two-tier admin** — company admin (terminal, S9) vs platform operator
   (console, S10).
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

Between Sessions 3 and 4 (completed 2026-07-27): GitHub secrets, all functions
deployed to staging/prod, access-token hook enabled everywhere, Resend domain
verified, templates uploaded, `wilsonapp.com` → `petalstudios.co` swap.

**Sessions 15–17 remain** (locked #19 as amended 2026-07-30): S15 operator
console + TPN hardening · S16 systems documentation & design pack · S17
release (v1.0.0). Launch prompts ready: `docs/sessions/SESSION_15_prompt.md`
and `SESSION_16_prompt.md`; S16 writes S17's.

**Migrations 0000–0027 are deployed to dev + staging + prod** (S14 added
0027). **Edge Functions:** `ai-proxy` (S12) and `storage-gc` (S14) deployed
to all three envs; staging has `ANTHROPIC_API_KEY` set (post-S12);
dev/prod keys still per OWED_AUDREY §5. CLI linked to `wilson-dev`.

---

## 5. Remaining sessions

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

### Session 15 — Operator Console (/wilsonadmin) + Final TPN Hardening

Launch prompt: `docs/sessions/SESSION_15_prompt.md`. The last BUILD
session (locked #19 as amended — docs and the cut moved to S16/S17).

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

### Session 16 — Systems documentation & design pack (Audrey, 2026-07-30)

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
  (infographics/wireframes document).
- Close-out writes `SESSION_17_prompt.md`.

### Session 17 — Release (v1.0.0)

- Fix anything S16's documentation read surfaced (§6 entries it filed).
- Final §6 disposition: every still-open gap closed, re-owned to
  post-1.0, or explicitly accepted with a reason.
- Confirm the release gates: handbook exists and is drift-reviewed; CI
  green; migrations + Edge Functions deployed to all three envs.
- Version cut: package.json → 1.0.0, changelog, tag.

## 6. Carry-forward gaps (live list, end of Session 8)

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
16. **NEW (S9):** Edge-Function rate limiting is in-memory + last-XFF only
    (provision-workspace invite budget included) — durable DB-backed
    limiter is S15 TPN work. **S12 note:** `ai-proxy` (the spend endpoint)
    gained a per-workspace in-memory limiter (default 60/min,
    `AI_PROXY_RPM` override, NaN-guarded) — same per-isolate caveat.
17. **NEW (S9):** adminGuard MFA step-up fails OPEN if listFactors errors
    (documented skip; GoTrue still challenges enrolled users at sign-in).
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
31. **project file ATTACHMENTS have no cloud home — UNBLOCKED S14, wiring
    remains (→ S15 cheap close).** The `rabbit-files` bucket now exists
    with path-scoped policies, so `supabaseAdapter.uploadFile` works end to
    end. Still open: D.O.G./ProjectsPage attachments ride project-row
    patches (`documents`/`visualAssets`), and
    `supabaseAdapter.updateProject` still throws on attachments-only
    patches (the honest S12 behavior). Closing = route those attachment
    flows through `uploadFile`/files rows and retire the throw. Original
    S12 context: locked #17 gives D.O.G. no content model; web-only
    degradations with stated reasons remain (`/api/fetch-url`, PDF text
    extraction, Google-Sheet import).
32. **NEW (S12): the legacy LOCAL password panel still renders in Electron.**
    Settings → Change Password drives `/api/auth/change` (the pre-cloud
    local password). On the web it now degrades to a recovery-flow pointer,
    but in Electron it still edits a credential nothing checks since the
    Supabase login landed (S2) — candidate for deletion in a later session.
33. ~~a NON-admin owner of a company-standard course is a DB-supported
    reviewer with no client surface~~ — **CLOSED S13b** (2026-07-30, commit
    `54d5225`): O.T.T.E.R.'s Requests view surfaces the decidable queue to
    admins AND to owners of the targeted standard course; managers got a
    read-only queue at the same time (0026).
34. **NEW (S14): workspace hard-delete strands its rabbit-files blobs.**
    The CASCADE purges files rows (queue rows enqueue with the dead
    workspace_id; certificates FK-cascade away), and `storage-gc` is
    workspace-scoped — no admin of a deleted tenant exists to drain the
    queue, and other admins' orphan scans fail closed on the unknown
    project folders (correctly). Named in 0027's enqueue-trigger comment.
    **S15 owns it**: the operator console's workspace teardown must include
    a service-role storage sweep.
35. **NEW (S14): GC orphan-scan window can starve on very large buckets.**
    The run-wide budget collects objects in name order, referenced ones
    included, so a project with >5000 referenced objects sorted ahead of
    its orphans never reaches them on any run. Mitigated (batched
    reference checks, honest card copy — no "run again" promise); a
    persisted per-bucket cursor is the fix if real buckets ever get there.
36. **NEW (S14): the relink census and scan use sync fs on the Electron
    main process.** `fs.existsSync` per file row (and the walker) block the
    process; an UNREACHABLE network share can freeze the app for
    N × timeout when a project's files live there. The client-side render
    storm was fixed in review; the server-side fix is fs.promises.access
    with bounded concurrency.
37. **NEW (S14): local 'purged' certificates have no UI reader.** They
    survive in bundle.fileEvents (exempt from the 2000-event trim) and the
    project-level route GET /api/rabbit/projects/:id/file-events serves
    them, but no surface renders that stream — the per-file drawer needs a
    live row. Candidate: an audit tab or takeout inclusion later.

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
| Central Supabase backend, all users on it | 3 envs, migrations 0000–0016 | ✅ |
| Company BYO storage (AWS S3, Supabase, local, local server, Hetzner, Google Drive) + settings connection UI | S9 StorageConnections cards (local/Supabase/Drive per locked #14) | ✅ (S3/Hetzner post-1.0) |
| Per-company Claude API key, admin-administered | S12 `ai-proxy` SHIPPED the per-workspace→platform resolution seam (deployed to all 3 envs); the `workspace_ai_keys` table + admin UI land with the S15 operator console | ✅ seam · ⬜ admin UI S15 |
| O.T.T.E.R. personal vs company-shared content, share/unshare, never cross-company | S10 model (0022/0023) + **S11 UI** (tier picker, filter chips, share + editor grants, company standard, fork, trash/restore) + **S13**: change-request approval APPLIES (0025 — archive, additive copy, review window, revise-and-resubmit) | ✅ ❓ in-app verify owed |
| Session system (auth, edit attribution, audit, multi-device, revocation) | + S9 deactivate = RLS cutoff + GoTrue ban + best-effort logout | ✅ (per-device session LIST UI not built — not currently planned) |
| App version hosting, update-check at login w/ update/skip, Settings version panel | S9 electron-updater + B2 + UpdatePrompt + VersionPanel | ✅ (B2 bucket setup owed) |
| Admin terminal (users/teams/logs/API-calls/error codes/debug) | S9 company tier SHIPPED (users/company/logs/diagnostics + WIL-#### codes) + S11 Requests (O.T.T.E.R. change-request review); operator tier = S15 | ✅ company · ⬜ operator |
| express-session + connect-pg-simple suggestion | Superseded by Supabase Auth | ✳ (locked #1) |

---

## 8. Operating rituals (standing rules for every session)

1. **First tool call of a session:** `git status` on `feat/multi-user-v1` —
   confirm clean, read the prior session's commit. No code before that.
2. **Close-out ritual:** feature commit → CI green → deploy migrations
   dev → staging → prod (dry-run before each) → re-link Supabase CLI to
   `wilson-dev` → write `docs/sessions/SESSION_NN+1_prompt.md` → **update this
   MASTER_PLAN (§4 ledger, §5 scope, §6 gaps, §7 statuses)** → update the
   Claude auto-memory → docs commit + push.
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
| Session prompts | `WILSON/docs/sessions/SESSION_NN_prompt.md` (02–16 present; S16 writes 17) |
| Web test host | `https://pretty-aud.github.io/wilson/` — `gh-pages` branch of the public repo; Pages toggle owed (see `docs/WEB_DEPLOY.md`) |
| ai-proxy | Edge Function, all 3 envs; key = `ANTHROPIC_API_KEY` secret (owed) with per-workspace seam; `AI_PROXY_RPM` optional |
| Original brief | `WILSON/docs/ORIGINAL_BRIEF_multiuser.md` |
| TPN audit baseline | `WILSON/TPN_AUDIT/` (AUDIT_INDEX, FINDINGS, RECOMMENDATIONS, REMEDIATION_PLAN, SUMMARY, LEARNINGS) |
| Email | Resend SMTP, domain `mail.petalstudios.co`, DNS at Squarespace |
| GitHub secrets | `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_PROBE_USERNAME`, `DEV_PROBE_PASSWORD` |
| Cron jobs | `wilson-purge-edit-history` 04:43 · `wilson-purge-soft-deleted` 04:47 · `wilson-purge-app-events` 04:51 UTC (all envs) |
| Backups workflow | `.github/workflows/backups.yml` (git root) — needs B2_* + BACKUP_*_DB_URL secrets |
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

### Still open

— none currently. New questions get logged here with their target session.
