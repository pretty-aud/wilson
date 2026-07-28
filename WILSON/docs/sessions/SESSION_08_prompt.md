# SESSION 8 launch prompt — Dashboard + Notes (TipTap)

> Paste into a new Claude Code conversation from the WILSON repo to start Session 8.
> Session 7 handoff: `docs/sessions/SESSION_07_prompt.md` (prior deltas).
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Where Session 7 left the repo

Branch: **`feat/multi-user-v1`**. Session 7 landed Realtime live sync +
Revert-to-State (see the session commit on this branch for the full message).

### Migration history

| Version | File | Added in |
|---|---|---|
| 0000–0015 | (unchanged — see SESSION_06/07 prompts) | Sessions 1–6 |
| 0016 | `realtime_broadcast.sql` | **Session 7** — broadcast-from-database live sync: `fn_realtime_broadcast()` AFTER-trigger on the 10 project-scoped tables → `realtime.broadcast_changes('rabbit:project:{id}', …)`; `can_read_project_topic()` (SECURITY INVOKER — channel access ≡ `projects_select` visibility) + `fn_try_uuid()`; `realtime.messages` policies (SELECT broadcast+presence, INSERT presence-only), guarded for db-only stacks |

### THE architectural decision (do not relitigate without reading §14)

**Realtime rides on `realtime.broadcast_changes`, NOT `postgres_changes`**
(which the old scaffolding and earlier prompts assumed). postgres_changes
evaluates the SUBSCRIBER's SELECT policy against the NEW row of every
UPDATE — under the 0014 soft-delete policies, trash UPDATEs would be
withheld from every collaborator (the Session 6 lesson resurfacing on the
realtime path). Broadcast delivers full old/new rows and authorizes ONCE
at join. `db/README.md` §14 is the reference; §15 covers revert.

### Session 7 deliverables by area

| Block | Key files |
|---|---|
| Migration | `supabase/migrations/0016_realtime_broadcast.sql` |
| pgTAP | `supabase/tests/rls/20_realtime.sql` (27 probes, environment-tolerant: CI runs `supabase start --exclude realtime` so realtime-schema probes report 'no-schema'/'no-partition' leniently; partition routability detected EMPIRICALLY via a `realtime.send` probe) |
| CI | `.github/workflows/rls.yml` (git root): 20 in the replay list |
| Merge layer | `state/realtimeMerge.js` (pure; LWW-per-field via pending-field sets + `updated_at` stale guard; soft-delete events mirror local cascade shapes; restores → `refetch` effect) + tests |
| Revert layer | `components/editHistoryRevert.js` (pure planner: inverse-patch + forwardPatch / restore / soft-delete / recreate; projects·phases·assets·tasks only) + tests |
| Adapter | supabaseAdapter: `subscribeProjectChanges()` on private channel `rabbit:project:{id}` + presence (self filtered out); `patchPhase/patchAsset/patchTask` per-field patches (undefined→null, empty→no-op); `restore*` now RETURN the RPC boolean (false = already live) |
| Provider | RabbitProvider: pending-field registry; realtime effect (subscribe/status/presence, refetch on EVERY join, debounced refetch, effect drain); `reloadActiveProject()` + bundle-load sequence guard; `revertHistoryEntry()`; update mutators patch-first; add mutators upsert-by-id (echo race); `optimistic()` rollback schedules reconvergence refetch; `suspended` preserved across history resets |
| UI | EditHistoryDrawer revert buttons (gated `rabbit.history.revert`, admin+manager); `RealtimePresenceStrip` in Rabbit.jsx (LIVE/SYNC pill + initials chips, bottom-left) |
| Docs | `db/README.md` §7 (superseded note), §14 (realtime), §15 (revert) |

### Verified working (2026-07-28)

- Vitest 182/182 (44 new: realtimeMerge 26, editHistoryRevert 15, roleMatrix +3); `vite build` green.
- Migration 0016 live on wilson-dev; rolled-back live probe: 7 writes → 7 broadcasts, correct topics, full old/new payloads, soft-delete transition + link-table DELETE-via-parent-join delivered.
- **Partition discovery (important):** a hosted project whose Realtime tenant was never active has NO `realtime.messages` partitions — `realtime.send` drops rows with only a WARNING. First websocket connect activates the tenant and provisions partitions (verified empirically: 0 rows before, 1 after a single anon channel join). Self-healing, but don't expect broadcast rows on a fresh env until a client connects.
- Adversarial review: 4 finders → 13 findings → 8 confirmed (3 major: first-join missed-events window, optimistic-rollback erasing merged events, INSERT-echo duplicates) + 3 unverified — ALL 11 fixed pre-commit; 2 refuted with documented traces.
- **CI green on `338c90e`** (first run, no retries — the environment-tolerant pgTAP probes behaved as designed on the realtime-less CI stack).
- **0016 deployed to ALL THREE envs** (dev → CI green → staging → prod, dry-run before each push); 10 triggers + 2 realtime.messages policies verified on each via `pg_trigger`/`pg_policies` counts. CLI re-linked to wilson-dev. **No migration backlog for Session 8.**
- Browser verification of live sync / presence / revert UI not performed by the agent (sign-in requires credentials the agent must not enter); eyeball once signed in with TWO windows: edit an asset field in one → it appears in the other (LIVE pill bottom-left, teammate chip visible); delete a task in one → it vanishes in the other; History drawer → revert an edit (entry appears as a new edit, Ctrl+Z undoes it).

## Known gaps & deferred items (carry-forward list)

- **Projects INDEX updates live only for the OPEN project's topic** — other projects' create/rename/delete land on next refresh. Candidate: workspace-level channel for the Dashboard (S8 fits naturally).
- **A client whose token refreshes while its open project sits in the trash** can miss that project's restore event (policy re-eval at token refresh; documented in 0016 header). Catches up on next open.
- **Revert supports projects/phases/assets/tasks only**; files/comments/rate_cards entries show no revert button. Hard-deleted projects can't be recreated (fresh id would orphan children).
- **Restoring a child under a trashed parent** restores in the DB but stays hidden; the revert path surfaces an explanatory error, but the row has still left the trash early (purge of the parent cascades it anyway).
- **Milestones/scenes/levels/experiences** are not broadcast (no cloud tables yet — S2 deferral unchanged).
- Storage blob GC (S9/S10), roster edit-history capture, legacy `useTeamMembers` sweep, `public.users` drop decision, deactivated-member tokens (S9), last-admin protection — unchanged from S7 prompt.
- pgTAP 20's realtime-schema probes are lenient in CI by design; hosted coverage is the live probe. If CI ever gains the realtime service, probes tighten automatically.

## Session 8 goal (from master plan)

**Dashboard + Notes (TipTap).** The Dashboard is the post-login landing
surface (ProfileSection from S4 was built to be reused here). Notes brings
long-form rich text on TipTap — and per the locked decision, **Yjs enters
here** (LWW-per-field everywhere else; Yjs ONLY for long-form text).
Consider a workspace-level broadcast channel for dashboard liveness (see
carry-forward #1). Verify against the master plan / memory before
committing to scope. Locked decisions still apply.

### Non-goals

- MFA, auto-update, backups, admin terminal (Session 9).
- Platform operator console, web build, TPN hardening (Session 10).

## Token discipline (standing rule)

Unchanged: hard cap 15 agents at once; finders paste excerpts; never resume
nondeterministic fan-out pipelines; prefer inline verification for a handful
of claims.

## Reminder

Per the standing rule: **no code changes before branch is confirmed.**
First tool call: `git status` on `feat/multi-user-v1`, verify clean, then
read the Session 7 commit before starting.
