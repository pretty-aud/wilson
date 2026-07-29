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
- **Migrations `0000`–`0023`** in `supabase/migrations/` — all deployed to
  dev + staging + prod as of Session 10 close-out. No backlog.
- **Edge Functions:** `resolve-login`, `issue-session` (ES256),
  `provision-workspace` (+ initial-team invites[], S9), `invite-member`,
  and the S9 admin set on `_shared/adminGuard.ts`: `admin-create-user`,
  `admin-reset-password`, `admin-set-active`, `admin-user-security`
  (verify_jwt=false; claims from the TOKEN payload; live-row admin check;
  MFA aal2 step-up).
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

- **pgTAP RLS suite** `supabase/tests/rls/01–25` (runs in CI local stack;
  realtime probes environment-tolerant).
- **Vitest** 224/224 green end of S9. **Playwright** auth/permissions e2e.
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
11. **PITR permanently deferred** ($100/mo) — replaced by nightly `pg_dump` to
    Backblaze B2 (S9).
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

Between Sessions 3 and 4 (completed 2026-07-27): GitHub secrets, all functions
deployed to staging/prod, access-token hook enabled everywhere, Resend domain
verified, templates uploaded, `wilsonapp.com` → `petalstudios.co` swap.

**Sessions 10–12 remain** (re-split 2026-07-28: the old Session 11 was
broken into web build (S11) and operator console + TPN + v1.0.0 (S12) for
smaller sessions on Opus 5 — see §5/§10). Launch prompt ready:
`docs/sessions/SESSION_10_prompt.md`.

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

### Session 11 — O.T.T.E.R. UI + Web Build ← NEXT

Prerequisite for all-three-tools web parity (locked #16/#17). O.T.T.E.R.
content moves from local-disk JSON (`otter-data/`) to workspace-tenanted cloud
tables + storage with an ownership model:

- **Personal content** — courses/subjects a user generated; private to that
  user by default.
- **Company-shared content** — pages/courses the company owns, or that a user
  shares to the workspace; visible workspace-wide. **Never a cross-company
  wiki**: every piece of content is owned by exactly one workspace (or one
  user within it).
- Share / unshare flow (user → workspace); RLS mirroring the RABBIT patterns
  (`workspace_id` + `owner_id`); migration tool for existing `otter-data/`.
- D.O.G.: **nothing needed in this session** (clarified 2026-07-28) — no
  local-file dependency and no content model. Web D.O.G. generates decks off
  the open project's cloud files; its web wiring (Edge-Function Anthropic
  proxy + project-file reads) lands with the S11 web build and is a light
  lift.
- Resolve `public.users` drop + `schema.sql` retirement (§6 #9) while the
  schema is open — this is the standalone-RABBIT decision's natural home.

### Session 11 — Web Build + Hosting/Routing (all three tools)

Path-based hosting per locked #18. Scope (kept deliberately smaller for
the Opus 5 session split):

- **Web vite target**: `base: '/wilson/'` build variant (Electron build
  keeps `./`); feature detection for the browser (no electronAPI: updater
  panel degrades, local/Drive storage cards inform, safeStorage bridge
  absent → web session strategy per the supabaseClient comment).
- **URL ↔ page sync**: map the existing `currentPage` state onto
  `/wilson/{dog,otter,rabbit,dashboard,settings,project-manager,
  rate-card,team-members,admin-terminal,help}` with history API — the
  all-pages-rendered shell stays; deep links + SPA fallback rewrites.
- **Auth on the web**: `WILSON_SITE_URL` → `https://petalstudios.co/wilson`
  on all three envs; Supabase `site_url`/`additional_redirect_urls`
  updated; recovery/invite emails land on `/wilson/#/recovery`; session
  persistence for browsers (locked follow-up from Session 2's
  `persistSession:false` note).
- **Web D.O.G.** (locked #17): Edge-Function Anthropic proxy so the key
  never ships to a browser; generates off the open project's cloud files.
- **Deploy target**: a TEST host (any static host with SPA rewrites)
  serving the locked path shape — `<test-host>/wilson` +
  `<test-host>/wilsonadmin`; Audrey needs it reachable for post-session
  testing. `petalstudios.co` cutover is post-v1.0 production work.
- O.T.T.E.R./RABBIT web smoke passes; Playwright web-path lane.

### Session 12 — Operator Console (/wilsonadmin) + Final TPN Hardening + v1.0.0

- **Operator console** (platform tier, `is_platform_operator`, separate
  surface at `petalstudios.co/wilsonadmin` per locked #18): create/manage
  companies (workspaces), administer **per-company Claude API keys**,
  cross-company session/usage logs, build-links management. Session
  isolation from /wilson (separate storage scope; operator sign-in only).
- **Final TPN hardening**: re-run `tpn-compliance-audit` against the
  `TPN_AUDIT/` baseline (committed at `1ce18ec`); close remaining items —
  durable Edge-Function rate limiting (§6 #16), hard no-deferral admin MFA
  gate once the CI probe admin is enrolled (§6 #17), storage blob GC
  (§6 #6).
- Remaining deferrals sweep (§6), v1.0.0 version cut.

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
6. Storage blob GC — file rows soft-delete but blobs persist (S9/S10; now also
   includes removed-avatar orphans when the best-effort delete fails).
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
    limiter is S11 TPN work.
17. **NEW (S9):** adminGuard MFA step-up fails OPEN if listFactors errors
    (documented skip; GoTrue still challenges enrolled users at sign-in).
18. **NEW (S9):** electron-updater ships only via the electron-builder NSIS
    channel (`npm run dist`); Forge/Squirrel builds report 'unsupported'.
    Local node_modules lacks electron-updater/electron-builder until an
    install succeeds on this machine (npm TLS issue; lockfile is complete).
19. **NEW (S9):** legacy useTeamMembers sweep still pending (was #8; now
    also feeds the producer/CD highlight only via projectsIndex ids).
20. **NEW (S10): O.T.T.E.R. trash has no way out in the client.**
    `otter_soft_delete_row` is wired to `course.delete`, but nothing lists or
    restores trashed courses, so a deleted course simply vanishes until the
    30-day purge destroys it. `otter_restore_row` exists and is pgTAP-pinned.
    → S11 Block A, item 6.
21. **NEW (S10): O.T.T.E.R. will render an empty library on the web.**
    `Otter.jsx`'s mount effect calls `loadSoftwareList()` only inside the
    `fetch('/api/otter-settings')` success chain. That route is correctly not
    an adapter route, so in a browser it 404s, the outer `.catch(() => {})`
    swallows it, and the list never loads. Also affects `/api/agent-skills`,
    `/api/migration-needed`, `/api/migrate`, `/api/fetch-url`.
    → S11 Block B.
22. **NEW (S10): no `can_write` gating in the O.T.T.E.R. UI.** Every
    generate/edit affordance is offered on any course the user can open. The
    adapter now returns a clean 403 rather than a fabricated success, so
    nothing is lost silently — but the control should not be there.
    → S11 Block A, item 7.
23. **NEW (S10): CI unverified for `31586d5`.** `gh` is not authenticated on
    the session machine. Everything was verified directly against Postgres 17
    on wilson-dev (94/94 pgTAP probes, plan counts exact) + Vitest 256/256 +
    vite build, and the migrations are deployed to all three envs — but the
    Actions run itself was never read. **First task of S11.**

---

## 7. Original brief → status traceability

Legend: ✅ done · 🔶 partial · ⬜ planned (session #) · ❓ needs in-app verify ·
✳ deliberately changed.

| Brief item | Where it landed | Status |
|---|---|---|
| Editor timestamp + history button, popup w/ sidebar of edits, before/after main frame, per-project | S5 `EditHistoryDrawer` + capture triggers (0012) | ✅ (drawer lives in Assets/Tasks `_actions`; gallery/kanban affordance not wired) |
| Revert project to a selected state | S7 `revertHistoryEntry` + drawer buttons | 🔶 projects/phases/assets/tasks only (#3 in §6) |
| "Last updated by/at" on ALL project databases | Audit columns (0004) + triggers | ✅ |
| Undo file/row deletes | S6 soft delete (0014) + undo toast + 30-day trash | ✅ (blob GC pending) |
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
| Per-company Claude API key, admin-administered | S11 operator console | ⬜ S11 |
| Session system (auth, edit attribution, audit, multi-device, revocation) | + S9 deactivate = RLS cutoff + GoTrue ban + best-effort logout | ✅ (per-device session LIST UI not built — not currently planned) |
| App version hosting, update-check at login w/ update/skip, Settings version panel | S9 electron-updater + B2 + UpdatePrompt + VersionPanel | ✅ (B2 bucket setup owed) |
| Admin terminal (users/teams/logs/API-calls/error codes/debug) | S9 company tier SHIPPED (users/company/logs/diagnostics + WIL-#### codes); operator tier = S11 | ✅ company · ⬜ operator |
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
   verify → fix confirmed findings pre-commit). S6: 12/12 fixed; S7: 11 fixed.
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
   mid-file `tests.login_as`; re-running an edited-but-applied migration on dev
   = `supabase migration repair --status reverted NNNN` + `db push
   --include-all`; `supabase db query --linked` (CLI ≥ 2.90) runs SQL against
   the linked hosted env.

---

## 9. Infra registry

| Thing | Value / location |
|---|---|
| Git root | `Dev_Work\wilson\` (repo root is ABOVE `WILSON/`) |
| Branch | `feat/multi-user-v1` (tracks origin) |
| CI workflow | `.github/workflows/rls.yml` (at git root) |
| Supabase envs | dev `eqjzmnvkrakroyqxfsvw` · staging `rzkirvkotslbovzbsdfh` · prod `rqyriuyldhovirbuievt` |
| DB reference doc | `WILSON/src/tools/rabbit_v0.1.0/db/README.md` (§7 superseded-note, §14 realtime, §15 revert) |
| Session prompts | `WILSON/docs/sessions/SESSION_NN_prompt.md` (02–10 present) |
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

### Still open

— none currently. New questions get logged here with their target session.
