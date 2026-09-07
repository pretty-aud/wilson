# SESSION 8 launch prompt — Dashboard + Notes (TipTap/Yjs)

> Paste into a new Claude Code conversation from the WILSON repo to start Session 8.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> The plan lives IN-REPO since 2026-07-28 (the old `.claude\plans\` master-plan
> file was lost; MASTER_PLAN.md v2 is the reconstruction and the single source
> of truth — this prompt is only the session-scoped view of it).
> Session 7 handoff detail: `docs/sessions/SESSION_07_prompt.md`.
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Context recap — where Sessions 1–7 left the repo

- Branch **`feat/multi-user-v1`**. Sessions 1–7 committed, pushed, **CI green**
  (last: `338c90e` feature + `4375872` docs). Migrations **0000–0016 deployed
  to dev + staging + prod. NO migration backlog.**
- Built so far: Supabase auth (username-first, invites, forgot/reset,
  onboarding wizards) · RLS lockdown of 13 RABBIT tables + pgTAP suite 01–20 ·
  permissions framework (app roles admin/manager/user + project roles
  manager/reviewer/member, `roleMatrix`/`projectRoleMatrix` in LOCKSTEP with
  SQL helpers) · Team Members on `workspace_members` + `ProfileSection`
  (built for reuse HERE) · edit history w/ 90-day retention + drawer ·
  soft-delete trash w/ undo toast + 30-day purge · realtime live sync
  (broadcast-from-database) + presence + LWW-per-field merge +
  revert-to-state.
- **Architecture rails (locked — MASTER_PLAN §3):** frozen JWT claim shape;
  `workspace_id` tenancy on every table + every policy; realtime =
  `realtime.broadcast_changes`, NEVER postgres_changes; LWW per field
  everywhere, **Yjs ONLY for long-form text (it enters in THIS session)**;
  reference docs `src/tools/rabbit_v0.1.0/db/README.md` §14 (realtime) + §15
  (revert).
- **Postgres lesson that keeps biting (S6/S7):** SELECT policies apply to BOTH
  sides of an UPDATE that reads the table — soft-delete/restore go through
  SECURITY DEFINER RPCs; broadcast authorizes once at join.
- Sessions renumbered 2026-07-28: **S9** admin terminal + MFA + auto-update
  (B2) + BYO-storage UI + multi-invite + roster polish · **S10** O.T.T.E.R.
  cloud content model · **S11** operator console + web build (all 3 tools) +
  final TPN hardening.

## Session 8 goal — FULL scope (confirmed by Audrey 2026-07-28, MASTER_PLAN §10)

Four core blocks + one stretch. The Dashboard is the user's personal
cross-tool surface (v1 = RABBIT data only), living on Home below the tools.

### 1. Dashboard page

- **Table, kanban, and gallery views** of the user's own work across all
  projects they're staffed on — `tasks.assignee_id` / `reviewer_id` (added in
  0013) are the anchor columns.
- Same interactions and popups as the RABBIT task view (**reuse
  TaskDetailPopup**), but styled in **WILSON app colors** (visual-language
  tokens — do NOT import the RABBIT theme wholesale).
- Sorting, filtering, grouping.
- Respect project-role gating: dashboard rows must never leak budget fields or
  projects the user can't see (RLS already enforces server-side; keep the UI
  honest too).

### 2. Notes (TipTap + Yjs)

- Per-user private notes. Rich text on **TipTap**: headers, bold, underline,
  bullet lists, links — Notion-grade editing UX.
- **Yjs enters here** (locked #6) and ONLY here — note bodies. The multi-device
  same-user case is why (two logged-in machines editing one note must not
  clobber). Do NOT let Yjs leak into RABBIT entity fields.
- Note metadata: **subject** = dropdown with **user-defined options** (user can
  create/edit their own option list) + **date field**. Sort/filter/group by
  subject and date.
- Notes are owner-only (RLS: `owner_id = auth.uid()` + workspace check). If
  trash is wanted, reuse the 0014 soft-delete RPC pattern; otherwise hard
  delete + confirm is acceptable for v1.

### 3. Profile

- Personal data editing (pronouns etc.) — **reuse S4 `ProfileSection`**
  (`src/` Settings → Profile; it was built for this).
- **Avatar upload / replace / delete → central Supabase Storage** (decided
  §10-F): an `avatars` bucket, owner-write / workspace-read storage policies
  (policies are SQL — they ride the session migration), avatar shown in
  presence chips + Team Members where natural.

### 4. Workspace live channel (carry-forward #1 — IN scope)

- Workspace-level broadcast topic (e.g. `rabbit:workspace:{id}`) following the
  0016 pattern (AFTER trigger → `realtime.broadcast_changes`, never aborts
  writes, guarded for db-only stacks) so the **projects index and Dashboard
  stay live** (project create/rename/trash/restore currently only reach the
  OPEN project's subscribers).
- Authorize at join like `can_read_project_topic()` — workspace membership ≡
  visibility. Presence for the dashboard can ride the same channel.

### STRETCH (non-blocking — §10-C "S8+")

- Field-level cell presence: Notion-style "who's on this cell" indicator on
  RABBIT table cells, riding the existing presence channel. Only if the four
  core blocks land with tests green.

## Expected DB work (migration 0017+)

- `notes` table (workspace_id, owner_id, title/body storage for TipTap+Yjs —
  research the storage shape: Yjs update log vs snapshot; keep it
  owner-only-RLS) + per-user subject options (small table or JSONB on a
  per-user prefs row).
- `avatars` storage bucket + storage policies; avatar reference on
  `workspace_members`.
- Workspace broadcast trigger (projects at minimum; consider
  workspace_members for roster liveness).
- pgTAP `21_*.sql`+ (owner-only notes probes, storage policies if testable,
  workspace-topic authorization); update `RLS_TABLES` + the replay list in
  `.github/workflows/rls.yml` — **rls.yml lives at the GIT ROOT
  (`Dev_Work\wilson\`), not in `WILSON/`**.
- Close-out deploy ritual per MASTER_PLAN §8: dev → CI green → staging → prod
  (dry-run before each) → re-link CLI to `wilson-dev`.

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- pgTAP: `throws_ok` message-form only (5-char arg2 becomes SQLSTATE); `tests`
  schema is runner-only — de-auth before mid-file `tests.login_as`; edited
  already-applied migration on dev = `supabase migration repair --status
  reverted NNNN` + `db push --include-all`; `supabase db query --linked` runs
  SQL on the linked hosted env.
- Realtime: a fresh env has NO `realtime.messages` partitions until the first
  websocket connect (`realtime.send` drops rows with a WARNING) — pgTAP
  detects routability empirically.
- StrictMode-safe `mountedRef` pattern in new hooks (effect body must reset
  true).
- Preserve the all-pages-rendered pattern in App.jsx (Dashboard = new page
  toggled visible, never remounted). Go through the RABBIT adapter seams —
  local/drive adapters return sensible empties; don't break offline.
- Token discipline: **hard cap 15 agents at once**; finders paste excerpts;
  never resume nondeterministic fan-out pipelines; adversarial review before
  the feature commit (S6: 12/12 fixed; S7: 11 fixed — keep the streak).
- The agent NEVER enters credentials. Browser eyeballs owed by Audrey at
  close-out — and still owed from S6/S7: two-window live-sync + presence
  chips; History drawer revert + Ctrl+Z; asset delete → undo toast; TeamView
  roster panel; RateCardPage as plain member.

## Non-goals (S8)

- Admin terminal, MFA, auto-update, backups, per-user rate-card toggles,
  Slack-style multi-invite, Team-Members assigned-projects column (**S9**).
- O.T.T.E.R. cloud content model (**S10**); operator console, web build,
  final TPN hardening (**S11**).
- No cloud tables for milestones/scenes/levels/experiences (unchanged S2
  deferral).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green → deploy 0017+ to staging + prod (dry-run each) →
re-link CLI to wilson-dev → write `docs/sessions/SESSION_09_prompt.md` →
**update `docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps, §7 statuses,
§10)** → update the Claude auto-memory → docs commit + push → list Audrey's
owed browser checks.

## Reminder

**No code before the branch is confirmed.** First tool call: `git status` on
`feat/multi-user-v1`, verify clean, read the Session 7 commit (`338c90e`),
then `docs/MASTER_PLAN.md`, then start.
