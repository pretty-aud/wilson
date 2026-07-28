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
- **Migrations `0000`–`0019`** in `supabase/migrations/` — all deployed to
  dev + staging + prod as of Session 8 close-out. No backlog.
- **Edge Functions:** `resolve-login`, `issue-session` (ES256),
  `provision-workspace`, `invite-member`.
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

- **pgTAP RLS suite** `supabase/tests/rls/01–23` (runs in CI local stack;
  realtime probes environment-tolerant).
- **Vitest** 209/209 green end of S8. **Playwright** auth/permissions e2e.
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
| 8 | 2026-07-28 | Dashboard (cross-project task table/kanban/gallery + TaskDetailPopup reuse) + Notes (TipTap v3 + Yjs snapshot-merge-write, owner-only, no admin bypass) + workspace channel (0018: projects/members/assigned-tasks/assets/project_members) + avatar remove + avatars in presence chips + task UI/DB parity (0019: tasks.notes, 'urgent'); 9/9 review findings + 8 minors fixed | `1ef4d10`, `156a74e` |

Between Sessions 3 and 4 (completed 2026-07-27): GitHub secrets, all functions
deployed to staging/prod, access-token hook enabled everywhere, Resend domain
verified, templates uploaded, `wilsonapp.com` → `petalstudios.co` swap.

**Sessions 9–11 remain** (Session 10 was added 2026-07-28 by the web-parity
decision — see §5/§10). Launch prompt ready:
`docs/sessions/SESSION_09_prompt.md`.

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

### Session 9 — Company Admin Terminal + MFA + Auto-Update Infra ← NEXT

Launch prompt: `docs/sessions/SESSION_09_prompt.md`.

From the brief (Admin Terminal + credentials sections) + locked decisions:

- **Admin Terminal** (company-admin tier, UX-laws treatment): create users
  (**show-once credentials + copy-to-clipboard popup**), reset passwords,
  deactivate/reactivate (+ token revocation — deferred from S4), last-admin
  protection; manage teams, company name/details; **per-user grants beyond
  role: rate-card view/edit toggles with admin confirm flow (REINSTATED per
  the brief — §10-A)**.
- **Multi-invite (Slack-style, §10-D):** adapt the single-user invite flow to
  batch — add many people at once, like adding members to a new Slack channel.
  Applies to both the NewCompanyWizard initial team and the admin terminal.
- **Roster polish (§10-B/E):** producer + creative-director row highlight;
  producer/creator auto-staffed as project manager on creation; Team Members
  page gains an **assigned-projects column** built on `project_members`.
- **Logs & diagnostics**: viewer over the audit/edit-history infrastructure —
  who changed what, auth events, API/error states; **error-code system** so
  users can report issues and the admin can see where the problem lies; debug
  panel.
- **Backend storage connection UI** in system settings — v1.0 providers
  CONFIRMED (locked #14): local / local server, Supabase Storage, Google
  Drive. AWS S3 + Hetzner (one S3-compatible adapter) move post-1.0.
- **MFA for all admin tiers** (Supabase Auth MFA).
- **Auto-update**: electron-updater + hosted builds; version check at login →
  update / skip prompt; Settings shows current version + "check for updates";
  backend keeps latest build + links to previous builds.
- **Backups**: nightly `pg_dump` → Backblaze B2 (locked #11).
- Deferred-in: storage blob GC (with S11), roster edit-history capture,
  legacy `useTeamMembers` sweep (Timeline/Scenes/Levels/Experiences/Budget/
  Intake still on the legacy hook).

### Session 10 — O.T.T.E.R. cloud content model (NEW — added 2026-07-28)

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

### Session 11 — Platform Operator Console + Web Build + Final TPN Hardening

- **Operator console** (platform tier, `is_platform_operator`): create/manage
  companies (workspaces), administer **per-company Claude API keys** (empty
  input per company; operator can populate), cross-company session/usage
  logs, build-links management.
- **Web build — ALL THREE TOOLS** (locked #16), riding the S10 content model:
  RABBIT + Dashboard + O.T.T.E.R. + D.O.G. in the browser. D.O.G. is the
  light one — project-file-driven, no local files (web path: Edge-Function
  Anthropic proxy so the key never ships to a browser).
- **Final TPN hardening**: re-run `tpn-compliance-audit` against the
  `TPN_AUDIT/` baseline (FINDINGS/RECOMMENDATIONS/REMEDIATION_PLAN committed at
  `1ce18ec`); close remaining items.
- Remaining deferrals sweep (§6), storage blob GC, v1.0.0 version cut.

---

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
9. `public.users` drop + `schema.sql` retirement — needs the standalone-RABBIT
   decision first (deliberately retained).
10. Milestones have no undo path (kept confirm dialog).
11. pgTAP 20/23's realtime probes are lenient in CI by design (no realtime
    service in the CI stack); hosted coverage = live probes.
12. **NEW (S8):** Notes have no cross-device LIVE list refresh (deliberate —
    notes ride no channel; the version guard still makes concurrent edits
    lossless; list refreshes on load/reload). Candidate: per-user topic later.
13. **NEW (S8):** TeamMembersPage does not yet consume workspace_members
    events (the Dashboard presence strip does) — S9 roster polish wires it.
14. **NEW (S8):** A workspace-less JWT (deactivated everywhere mid-session)
    inserting a note fails 23502 (NOT NULL) instead of a clean 42501 —
    cosmetic; the Dashboard already requires an active workspace to render.
15. **NEW (S8):** Deactivated members: workspace channel DENIES (0018) while
    table reads still allow until refresh — deliberate divergence, pinned by
    pgTAP 23 probe 12; S9's token revocation + SELECT-policy sweep aligns.

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
| Team member page shows assigned projects | `project_members` data exists (0013) | ⬜ S9 — confirmed (2026-07-28) |
| App roles admin/manager/user + dropdown in Team Members (WILSON, not RABBIT) | S3 permissions framework + S4 role dropdown | ✅ |
| Admin per-user extra grants (rate-card view/edit toggles w/ confirm) | Rate card currently ROLE-based: SELECT admin+manager, write admin (0015) | ⬜ S9 — REINSTATED per brief (2026-07-28) |
| Admin can SEE member passwords | **Changed**: show-once at creation + reset-only (locked #8) | ✳ |
| Copy-credentials popup on user creation | S9 admin terminal | ⬜ S9 |
| Username-first login; creator username `Audrey` | S2/S3 AuthShell + resolve-login | ✅ |
| Project roles manager/reviewer/member; write gating incl. approve/complete reviewer-only; members no budget/intake | 0013 helper family + `projectRoleMatrix` | ✅ policies · ❓ per-tab UI sweep (budget/intake/timeline view-only nuances) |
| Producer + Creative Director row highlight; producer/creator auto-manager | Not found in S4–S7 records | ⬜ S9 — confirmed wanted (2026-07-28) |
| Budget snapshot card managers-only; members never see financial data | Rate-entry RLS closed (0015); budget-tab gating rides the project-role sweep | 🔶 ❓ |
| Summary strip shows only YOUR projects | 0013: staffed projects gated; **unstaffed = open to all** (backward compat) | 🔶 (matrix-complete once legacy projects are staffed) |
| Real-time co-editing, see others live | S7 broadcast + LWW merge + presence chips/LIVE pill (now with avatars) | ✅ (field-level cell presence: stretch, not started — S9+/S10) |
| Personal Dashboard (RABBIT views + notes + profile + avatar) | S8: Dashboard page (table/kanban/gallery + popup reuse), Notes (TipTap+Yjs), ProfileSection + avatar remove, workspace channel | ✅ ❓ in-app verify owed |
| New company setup wizard (+ create several users at once) | S2 `NewCompanyWizard`; bulk initial users via invites | ✅ / ⬜ S9 Slack-style multi-invite (2026-07-28) |
| New user first-open flow (company → login → welcome → profile → home) | S2/S3 wizards | ✅ |
| Central Supabase backend, all users on it | 3 envs, migrations 0000–0016 | ✅ |
| Company BYO storage (AWS S3, Supabase, local, local server, Hetzner, Google Drive) + settings connection UI | Adapters exist for local/Supabase/Drive (v0.6); connection UI in S9 | ⬜ S9 — v1.0: local/Supabase/Drive (locked #14); S3/Hetzner post-1.0 |
| Per-company Claude API key, admin-administered | S11 operator console | ⬜ S11 |
| Session system (auth, edit attribution, audit, multi-device, revocation) | Supabase Auth JWT + `issue-session` ES256 + `actor_label` audit + presence | ✅ core · ⬜ session list/revoke UI (S9) |
| App version hosting, update-check at login w/ update/skip, Settings version panel | S9 auto-update block | ⬜ S9 |
| Admin terminal (users/teams/logs/API-calls/error codes/debug) | S9 + S10 split (two-tier, locked #5) | ⬜ |
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
| Session prompts | `WILSON/docs/sessions/SESSION_NN_prompt.md` (02–08 present) |
| Original brief | `WILSON/docs/ORIGINAL_BRIEF_multiuser.md` |
| TPN audit baseline | `WILSON/TPN_AUDIT/` (AUDIT_INDEX, FINDINGS, RECOMMENDATIONS, REMEDIATION_PLAN, SUMMARY, LEARNINGS) |
| Email | Resend SMTP, domain `mail.petalstudios.co`, DNS at Squarespace |
| GitHub secrets | `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_PROBE_USERNAME`, `DEV_PROBE_PASSWORD` |
| Cron jobs | `wilson-purge-edit-history` 04:43 UTC · `wilson-purge-soft-deleted` 04:47 UTC (all envs) |
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

### Still open

— none currently. New questions get logged here with their target session.
