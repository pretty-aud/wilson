# SESSION 6 launch prompt — RABBIT Project-Role Gating + Soft-Delete Undo

> Paste into a new Claude Code conversation from the WILSON repo to start Session 6.
> Session 5 handoff: `docs/sessions/SESSION_05_prompt.md` (prior deltas).
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Where Session 5 left the repo

Branch: **`feat/multi-user-v1`**. Session 5 landed Edit History (no revert) as **`51403d3`** (full session) plus a docs/status follow-up commit.

### Migration history

| Version | File | Added in |
|---|---|---|
| 0000–0011 | (unchanged — see SESSION_05_prompt.md) | Sessions 1–4 |
| 0012 | `edit_history.sql` | **Session 5** — append-only `edit_history` table, generic AFTER-trigger capture on all 13 RABBIT tables, admin+manager workspace-scoped read RLS, `purge_edit_history()` + pg_cron nightly sweep (hosted only) |

### Session 5 deliverables by area

| Block | Key files |
|---|---|
| Capture + retention | `supabase/migrations/0012_edit_history.sql` (table, `fn_edit_history_capture()`, triggers `trg_<t>_edit_history`, `purge_edit_history()`, guarded pg_cron schedule `wilson-purge-edit-history` @ 04:43 UTC) |
| pgTAP | `supabase/tests/rls/17_edit_history.sql` (19 probes: capture/diff/noise/no-op, parent-join + cascade workspace resolution, 4 RLS angles, append-only, purge) |
| CI | `.github/workflows/rls.yml` (**at the git root**, not WILSON/): `edit_history` added to RLS_TABLES coverage guard; `17_edit_history.sql` added to the failure psql-replay list |
| Adapters | `supabaseAdapter.listEditHistory(entityType, entityId)` (tolerates pre-0012 envs via 42P01/PGRST205 → []); local_server + google_drive return `[]`; typedef in `adapters/index.js` |
| Drawer UI | `src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx` (right drawer, z-[70]) + `editHistoryFormat.js` (pure helpers) + `editHistoryFormat.test.js` (14 Vitest tests) |
| View wiring | `ProjectAssetsView.jsx` + `ProjectTasksView.jsx`: History button in the `_actions` hover cluster (table rows), gated on `rabbit.history.view`; `_actions` flex 0.4 → 0.7 when gated in |
| Permissions | `roleMatrix.js` + test: new `rabbit.history.view` → admin+manager |
| Docs | `src/tools/rabbit_v0.1.0/db/README.md` §10 (capture model, RLS posture, retention, known gaps) |

### Verified working (2026-07-28)

- Migration 0012 applied to **wilson-dev**; live probe (create → update → no-op update → delete on a scratch project) produced exactly 3 history rows with correct per-field diffs, noise columns excluded, no-op skipped; probe rows cleaned up.
- pg_cron job `wilson-purge-edit-history` confirmed scheduled on wilson-dev via `cron.job`.
- Vitest 53/53; `vite build` green.
- **CI green on `51403d3`** — all four jobs (pgTAP incl. the new 17-file suite on a fresh 0000→0012 stack, Vitest, Playwright auth, smoke).
- **0012 deployed to ALL THREE envs** (dev → CI green → staging → prod, dry-run before each push); pg_cron job `wilson-purge-edit-history` confirmed present on dev, staging, AND prod via `cron.job`. CLI re-linked to wilson-dev. **No migration backlog for Session 6** — first time since Session 3.
- Sessions 4+5 deferred deploys (0010/0011 → staging+prod) were also completed this session, at its start.
- Browser verification of the drawer was **not** performed by the agent (signing in requires credentials the agent must not enter); DB layer verified directly, auth path covered by CI Playwright. Eyeball the drawer once in your signed-in app: Assets or Tasks table → hover a row → History (clock) icon.

## Known gaps & deferred items (carry-forward list)

- **Service_role writes to the 7 child tables** (no `workspace_id` column) skip capture when the parent row is gone and no JWT claim exists. Documented in README §10. Fine for now; revisit if Edge Functions start writing RABBIT children.
- **Gallery cards + Kanban cards have no History affordance** — only table rows. Add if wanted (thread `onHistoryClick` into AssetGallery/AssetCard + KanbanBoard/Column/Card following the same pattern).
- **local_server / google_drive modes capture nothing** — drawer shows a mode notice. Local parity candidate when Session 6 unifies identity.
- **rate_card_entries RLS is workspace-scoped, not role-scoped** (Session 4 deferral, still open) — any member can SELECT per-person wages via PostgREST. Candidate 0013.
- **public.users drop + schema.sql retirement**: deferred AGAIN, deliberately. Investigation found `public.users` is retained on purpose for standalone RABBIT installs and `db/schema.sql` is frozen-after-release per README §8. Dropping it needs a decision about whether standalone RABBIT is still a supported deployment — make that call before writing the migration.
- **Deactivated members with live tokens** (S9), **last-admin protection** (S9-ish), **admin self-change of app_role/username at DB level** (0009 bypass) — unchanged from Session 4's list.
- Supabase CLI on this machine is v2.90.0 (v2.110.0 available) — `supabase db query` exists and is handy for probing linked envs.

## Session 6 goal (from master plan)

**RABBIT Project-Role Gating + Soft-Delete Undo.** Two threads:

1. **Project-level roles** (Manager / Reviewer / Member per project) — the separate matrix the roleMatrix header reserves; project/team identity unification (RABBIT `team_members` JSON entity vs `workspace_members` reality; rate entries written from TeamMembersPage use auth user_id while legacy RABBIT ids don't match — the orphan-rows problem from Session 4).
2. **Soft-delete undo** — the `deleted_at`/`deleted_by` columns exist on all 13 tables (0000) but nothing sets them; only `projects_select` filters them. Decide the soft-delete story per table, wire delete paths to soft-delete + undo toast, and extend RLS/pgTAP accordingly. Note: edit_history already logs soft-deletes as `update` rows (deleted_at is NOT in the diff noise list — it shows up as a changed field, which is correct for the drawer).

Verify against the master plan / memory before committing to scope. Locked decisions still apply (LWW per field, RABBIT-only history, etc.).

### Non-goals

- Revert / undo from history (Session 7, with Realtime).
- Dashboard (Session 8).

## Token discipline (standing rule)

Unchanged from Session 5: hard cap 15 agents at once; finders paste excerpts; never resume nondeterministic fan-out pipelines; prefer inline verification for a handful of claims.

## Reminder

Per the standing rule: **no code changes before branch is confirmed.** First tool call: `git status` on `feat/multi-user-v1`, verify clean, then read the Session 5 commit before starting.
