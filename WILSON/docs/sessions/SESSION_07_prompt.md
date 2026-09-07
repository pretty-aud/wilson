# SESSION 7 launch prompt — Realtime + Revert-to-State

> Paste into a new Claude Code conversation from the WILSON repo to start Session 7.
> Session 6 handoff: `docs/sessions/SESSION_06_prompt.md` (prior deltas).
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Where Session 6 left the repo

Branch: **`feat/multi-user-v1`**. Session 6 landed Project-Role Gating + Soft-Delete Undo + rate-entry identity as **`324a44c`** (full session) + **`848d225`** (pgTAP fix: de-auth before `tests.login_as` persona switches — the tests schema is runner-only) plus a docs/status follow-up commit.

### Migration history

| Version | File | Added in |
|---|---|---|
| 0000–0012 | (unchanged — see SESSION_05/06 prompts) | Sessions 1–5 |
| 0013 | `project_members.sql` | **Session 6** — per-project roles (manager/reviewer/member), composite FK to workspace_members, `can_write_project()` helper family gating every project-scoped entity write policy, unstaffed-is-open rule, projects INSERT admin+manager / DELETE admin, `tasks.assignee_id`/`reviewer_id` |
| 0014 | `soft_delete.sql` | **Session 6** — trash via SECURITY DEFINER RPCs `soft_delete_row()`/`restore_soft_deleted()` (+ shared `fn_trash_authz()`), `fn_soft_delete_stamp` trigger (projects transition admin-only), SELECT policies filter `deleted_at` + live-parent EXISTS (transitive subtree hiding), partial live indexes, `purge_soft_deleted()` 30-day sweep + pg_cron `wilson-purge-soft-deleted` @ 04:47 UTC |
| 0015 | `rate_entry_identity.sql` | **Session 6** — rate_card_entries identity/wage columns (`member_id` = auth user id canonically), SELECT admin+manager, writes admin |

### Session 6 deliverables by area

| Block | Key files |
|---|---|
| Migrations | `supabase/migrations/0013_project_members.sql`, `0014_soft_delete.sql`, `0015_rate_entry_identity.sql` |
| pgTAP | `supabase/tests/rls/18_project_members.sql` (25 probes), `19_soft_delete.sql` (30 probes); `01_projects.sql` + `08_rate_card_entries.sql` updated for the tightened policies (inline `app_role` claims) |
| CI | `.github/workflows/rls.yml` (git root): `project_members` in RLS_TABLES; 18/19 in the failure replay list |
| Adapters | supabaseAdapter: delete{Project,Phase,Asset,Task,File,Comment,RateCard} → `soft_delete_row` RPC; `restore*` → `restore_soft_deleted` RPC; `listProjectMembers`/`upsertProjectMember`/`removeProjectMember` (42P01/PGRST205-tolerant); deleteFile no longer removes the storage blob |
| Provider | RabbitProvider: undo-toast state + targeted `undoHistoryEntry` (splice-back on failure), all-or-nothing batch `deleteAssets`/`deleteTasks` with server-side compensation, roster slice (`projectMembers`, `myProjectRole`, `projectIsStaffed`, 3 mutators) with request-sequence guard |
| Permissions | `src/permissions/projectRoleMatrix.js` + test (81 tests) — mirrors the 0013 DB helpers, keep in LOCKSTEP |
| Identity seam | `src/components/TeamMembers/useRosterMembers.js` — auth user ids in cloud, legacy JSON ids locally; consumed by RateCardPage, TaskDetailPopup, ProjectTasksView |
| UI | `UndoToast.jsx` (App-level mount, 8s hover-paused countdown); row-level delete confirms removed (bulk + project confirms stay); TeamView cloud roster panel; RateCardPage permission notice; ProjectsPage/ProjectDetailPanel create/delete gated in cloud mode; EditHistoryDrawer labels Deleted/Restored via `entryActionMeta` |
| Docs | `db/README.md` §11 (project roles), §12 (soft delete), §13 (rate-entry identity) |

### The load-bearing Postgres lesson (do not relearn this the hard way)

**SELECT policies apply to BOTH sides of an UPDATE that reads the table.**
Setting `deleted_at` makes the NEW row invisible → `42501 new row violates
row-level security policy`; clearing it can't target the hidden OLD row →
silent 0-row no-op. That is why BOTH trash directions are SECURITY DEFINER
RPCs. Any future policy that hides rows must consider this for every
UPDATE path. (Found live on wilson-dev; pgTAP 19 probes 1 and 7 pin it.)

### Verified working (2026-07-28)

- Vitest 138/138; `vite build` green.
- Migrations 0013–0015 live on **wilson-dev**; rolled-back live probe passed all 5 stages (seat + trigger-derived workspace, reviewer write denial, raw soft-delete → 42501, RPC delete → transitive hiding + `deleted_by` stamp, raw restore no-op + RPC restore + stamp clear). Both purge cron jobs confirmed via `cron.job` (04:43 + 04:47 UTC).
- Adversarial review (4 finders → 12 confirmed findings incl. the restore-under-RLS critical) — all 12 fixed before commit.
- **CI green on `848d225`** — all four jobs (pgTAP incl. the new 18/19 suites on a fresh 0000→0015 stack, Vitest, Playwright auth, smoke). The first run (`324a44c`) failed only on 19's `tests.login_as`-while-authenticated bug; the other three jobs were green from the start.
- **0013–0015 deployed to ALL THREE envs** (dev → CI green → staging → prod, dry-run before each push); both purge cron jobs (`wilson-purge-edit-history` @ 04:43, `wilson-purge-soft-deleted` @ 04:47 UTC) confirmed present on dev, staging AND prod via `cron.job`. CLI re-linked to wilson-dev. **No migration backlog for Session 7.**
- Browser verification of toast/roster UI not performed by the agent (sign-in requires credentials the agent must not enter); eyeball once signed in: delete an asset row (toast + Undo), Team view roster panel (cloud), rate card page as a plain member (permission notice).

## Known gaps & deferred items (carry-forward list)

- **Storage blobs for soft-deleted/purged `files` rows are never GC'd** (restorability requires keeping them at delete time; SQL purge can't reach the storage API). Candidate: Edge Function sweep in S9/S10 hardening.
- **Undo toast covers Assets/Tasks/Projects flows**; deletes issued from TimelineView/ScenesView editor modals still hard-confirm first but soft-delete + toast via the same provider fns. Milestones stay hard-delete + confirm (no undo path).
- **Gallery/Kanban history affordances** still table-rows only (S5 carry-forward).
- **Identity unification partial by design**: useRosterMembers seam covers RateCardPage/TaskDetailPopup/ProjectTasksView; TimelineView/Scenes/Levels/Experiences/Budget/Intake/ProjectSummary still consume legacy `useTeamMembers` (local-only views; empty-in-cloud unchanged). Legacy local JSON ids not migrated to auth ids.
- **project_members changes are NOT edit-history captured** (0012 entity CHECK locks the 13 tables; roster is auth-layer). Revisit if roster auditing is wanted.
- **public.users drop + schema.sql retirement** — still needs the standalone-RABBIT support decision first (S5 note).
- **Deactivated members with live tokens** (S9), **last-admin protection** (S9-ish), **admin self-change at DB level** (0009 bypass) — unchanged.
- rls.yml throws_ok probes assume exact PG error text; a CI Postgres major bump may reword messages (18/19 flagged).

## Session 7 goal (from master plan)

**Realtime + Revert-to-State.** Supabase Realtime (postgres_changes) live sync for RABBIT project bundles — LWW per field per the locked decision — plus revert-from-history: EditHistoryDrawer gains "revert to this state" using the 0012 diffs (create→delete, delete→recreate, update→inverse patch; soft-delete rows revert via the trash RPCs). subscribeProjectChanges() scaffolding exists in supabaseAdapter since Session 1. Presence (who's viewing) if time allows; Yjs for long-form text stays deferred until Notes (S8).

Verify against the master plan / memory before committing to scope. Locked decisions still apply.

### Non-goals

- Dashboard + Notes/TipTap (Session 8).
- MFA, auto-update, backups (Session 9).

## Token discipline (standing rule)

Unchanged: hard cap 15 agents at once; finders paste excerpts; never resume nondeterministic fan-out pipelines; prefer inline verification for a handful of claims.

## Reminder

Per the standing rule: **no code changes before branch is confirmed.** First tool call: `git status` on `feat/multi-user-v1`, verify clean, then read the Session 6 commit before starting.
