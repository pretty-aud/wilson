# Hand-off — The smoke job's gateway-ticket probe, red on wilson-dev on the evening of 2026-10-28: the cause (0104's checked mark on GW1's fixture), the cure (P8's stamp), the record (a side session of M3, 2026-10-29)

## 1. Where you are

- **Session:** started by M3 (`docs/sessions/handoffs/po-m3-2026-10-28.md`) after its runs read the issue-session smoke job red at its step *Probe gateway-ticket*: find the cause with evidence, get the step green (the owning track's fix, or a fixture repair if that is all it is), record it. M3's brief was written before the cure: its read of the fixture was at 22:59 UTC, P8's stamp at 23:20 UTC. Started on Fable 5.1; on **Opus 5.5 by her word in this session, *"use opus"*** (about 09:33 UTC 2026-10-29); every query and document below ran on Opus 5.5.
- **Branch:** `po/smoke-gateway-ticket-trace`, cut from `origin/feat/post-overhaul-edit-versioning` at `ce782612` (D2's merge); the integration branch unset as its upstream at the cut, its own `origin/po/smoke-gateway-ticket-trace` the upstream since the push. **Documents only:** this file and one row at the top of `docs/OUTSTANDING.md`'s session log. Not merged.
- **Commits:** `1636ac64` (this file and the row), then this file's CI record (the commit after it).
- **Worktree:** `gallant-keller-9bd82c` (the app under `WILSON/`). The untracked root `.claude/launch.json` (the app's copy, a subset of the tracked one) was moved to the session's scratchpad before the checkout, never deleted. Linked to wilson-dev (`supabase/.temp/project-ref` and `linked-project.json` say `eqjzmnvkrakroyqxfsvw`, wilson-dev). No `npm install`, no `.env.local`, no dev server.
- **wilson-dev:** read, and one `BEGIN … ROLLBACK` file; **nothing written, applied or deployed** by this session. Staging and production not touched.

## 2. State, measured, not remembered

- **The history** (`supabase_migrations.schema_migrations` from 0100, 09:38 UTC 2026-10-29): `0100 0101 0103 0104 0105 0106`; `md5(statements[1])` is `8d9e3c61a8b6fd370fa6111cd01dc9fc` (0104), `600918749bd670dc076f402d7f3f1267` (0105), `50f8f796ef8c309047a3824f65b35474` (0106), each the md5 of the tree's file with CRLF taken out. The table has no times and `track_commit_timestamp` is off, so no apply is timed on the database; the window is dated by the mint log and the runs below.
- **The functions** (`supabase functions list`): `gateway-ticket` **v4, 2026-10-10 09:51:30 UTC** (GW1's deploy, unchanged); `resolve-login` v11 (2026-09-07), `issue-session` v9 (2026-04-19). Changed in the window, P8's ten, none on the probe's path: `operator-workspaces` v17 21:09:03, `gateway-reach` v5 21:21:03, `gateway-enrol` v5 21:48:30, `gateway-sync` v5 21:48:32, `operator-ai-keys` v8 22:05:58, `storage-secret` v5 22:06:02, `storage-presign` v6 22:06:06, `storage-gc` v13 22:06:10, `storage-read-urls` v4 22:06:12, `ai-files` v8 22:06:16 (UTC, 2026-10-28).
- **What the probe reads through, on dev against the tree:** `gateway_clips_for_tickets(uuid[])`'s body is 0104 §4's, line for line (blank lines aside): SECURITY INVOKER, STABLE, `search_path=public`, its WHERE ending `AND f.vetted_at IS NOT NULL AND l.vetted_at IS NOT NULL`. `gateways_visible` is 0104 §8's (a definer view, `security_barrier`; 0093's four filters, `inside_names` added last). The eight policies on `bin_files` and `bin_locations` are 0091's, predicate for predicate, row security forced on both; no later migration touches them.
- **GW1's fixture:** the probe gateway `55650240-…` live (root confirmed 2026-10-10 06:45:45, last seen 2026-10-10 08:45:00, not revoked); the forgotten `…aa02` revoked 2026-10-10 06:49:03; clip `…f1` (the Smoke Workspace, location `…c1`, project `96960001-…0001`) and clip `…f2` (workspace `bbbbbbbb-…`, location `…c2`, project `dddddddd-…`); all four bins rows `vetted_at` **2026-10-28 23:20:34.830594 UTC**, `vetted_by` NULL, `updated_at` the same instant (one transaction). Dev holds no other bins rows: 2 files, 2 locations, none unchecked. The project: active, not private, no `project_members` rows (none needed: `bin_files_select` asks the workspace claim and the project's visibility, and the probe user is the workspace's admin).
- **The probe user:** `af3e9c28-37ea-4060-8d01-854bf8d8074d`, the only user in the probe gateway's mint log (no email or username was read or printed); one `workspace_members` row: the Smoke Workspace, `admin`, active.
- **The mint log** (`gateway_ticket_mints`, the probe gateway): 351 mints since 2026-10-10 06:45:45 UTC, all that user and clip `…f1`, the latest 2026-10-29 09:35:16 UTC. **None between 2026-10-28 19:41:28 and 23:26:41 UTC.** Each green run of the step mints one ticket.
- **CI, RLS tests, read through the public API (unauthenticated):**

| Run | Created (UTC) | Head | The smoke job's step *Probe gateway-ticket* |
|---|---|---|---|
| 40756486566 | 10-28 19:41:01 | `d72f7e63` | green (the mint at 19:41:28); every job green |
| — | — | — | no RLS run from 19:50 to 22:33 UTC; 0104 first committed 20:54:58 UTC (`8d04fda3`) |
| 40780867528 | 10-28 22:33:25 | `11de80e8` | red, `missing: 3` (M3's read) |
| 40783623773 | 10-28 22:55:37 | `c0123c3c` | red, `missing: 3` (M3's read) |
| 40784810530 | 10-28 23:05:17 | `5b44533c` | red, `missing: 3` (M3's read) |
| 40785427273 | 10-28 23:10:20 | `9eec04a2` | red at 23:10:41, the only red job; annotation the same `missing: 3` (this session's read) |
| 40786314809 | 10-28 23:17:35 | `e91dbdd5` | red at 23:17:55, the only red job; annotation `no ticket for the clip the probe user may read: {"error":null,"tickets":0,"missing":3,"refused":0}` |
| — | 10-28 23:20:34 | — | P8 stamps the four fixture rows on dev |
| 40787368613 | 10-28 23:26:22 | `9e8f9290` | green at 23:26:39 (the mint at 23:26:41), *Probe ai-files* ran too; the run red on Vitest alone (`gateway/test/config.test.mjs:137`, P8's, fixed by `91c89cce`) |
| 40788805342, 40789703303 | 10-28 23:38:55, 23:46:55 | `357f1579`, `fd3af69d` | green; every job green |

- **The verifying push:** `1636ac64` (this branch's first commit, documents only), RLS tests run **40852934517** (created 2026-10-29 09:51:40 UTC, completed 09:57:08 UTC, success): the issue-session smoke green, Playwright auth green, Vitest green, pgTAP green. The smoke job's steps: *Probe issue-session* green, *Probe gateway-ticket* green at 09:52:01 UTC (its notice annotation: *one ticket in the wire's shape, two missing, a forgotten gateway 404, no sign-in 401*), *Probe ai-files* green. The commit carrying this line is documents only; its run is in the chat close-out.

## 3. Done and verified

1. **The cause, named:** P8's migration **0104** (`0104_bins_vetted_and_gateway_names.sql`, TPN-AUTH-012), applied on wilson-dev in the window. Its §4 restated `gateway_clips_for_tickets` to return only clips that carry the new checked mark (`vetted_at`) at a location that carries it, and its header says **no backfill**: every existing row starts unchecked. Dev's only bins rows are GW1's fixture, so from the apply the RPC returned nothing for the probe's three ids and `gateway-ticket` answered 200 with all three `missing`, the gateway still found (not 404). It is the migration working as designed on a fixture written before the mark existed; nothing is broken in the code.
2. **Not the cause, by the same reads:** no deploy (`gateway-ticket` and `resolve-login` are the October and September versions); no policy (0091's eight); no change to the view's filters (0093's); no seat removed (the probe user is the active admin it was, and the fixture project never had or needed a seat).
3. **Reproduced as the probe user, rolled back** (`supabase db query --linked --file`, one file, `BEGIN … ROLLBACK`; the claims carry the user's id, `role` authenticated and the workspace claim; `SET LOCAL ROLE authenticated`): **as stamped**, the RPC returns `…f1` alone (`…f2` out of sight by RLS, `…ff` unknown) and `gateways_visible` shows the probe gateway; **with `…f1`'s and `…c1`'s marks cleared** (as postgres, no claims, as 0104 left them) the RPC returns nothing while the gateway, the clip and its location are all still in the caller's sight. The RPC's own join for `…f1` finds 1 row without the marks and 0 with either conjunct added, so the predicates that failed are 0104's two, both. Read again after the run: all four rows' `vetted_at` and `updated_at` still 23:20:34.830594 UTC.
4. **The cure, P8's (the owning track; not redone here):** after the controller traced the probe to the fixture, P8 stamped the two clips and their two locations as postgres with `vetted_by` NULL at 23:20:34 UTC, the mark 0104 gives a non-client's row (`UPDATE public.bin_locations SET vetted_at = now(), vetted_by = NULL WHERE id IN (…) AND vetted_at IS NULL`, then the same on `bin_files`; P8's hand-off §6 item 1, `4b1fc3fd`; the plan's night 5 record, `4728a92d`). The step has passed on every run since: 40787368613 onward, the mints to 09:35 UTC today, and run 40852934517 on this branch's push, every job green (§2).
5. **The record:** `docs/OUTSTANDING.md`'s session log, one row at the top: the window, the cause, the cure. No entry was added: the file keeps only what is broken and unfixed, and this is fixed. Comment markers: 4 → 4.

## 4. In flight

Nothing.

## 5. Traps hit

- **An unchecked clip is absent exactly as an invisible one is.** The probe's `missing: 3`, with the gateway found (200, not 404), cannot tell an unchecked fixture from one out of the caller's sight; that is the design (no oracle). When the step reads `missing` again, read the four rows' `vetted_at` first.
- **"Untouched since 2026-10-10" was true and was not the whole state.** 0104 added a column with no backfill, which changed what the rows pass without writing them; a gate can move while every `updated_at` stays put.
- **There is no recipe for the fixture.** The probe's header says the SQL is in GW1's hand-off; that hand-off names the ids only. A fixture made again after a reset needs both marks (as postgres, `vetted_by` NULL), or the step reads `missing` again.
- **While this step is red, the ai-files probe does not run:** it is the next step and is skipped (runs 40785427273 and 40786314809 show it `skipped`). FX12's probe was blind for the window too.
- **The history and the database carry no apply times** (no time column, `track_commit_timestamp` off). The mint log dates a window this probe guards to the second.
- `git switch -c <branch> origin/feat/post-overhaul-edit-versioning` sets the integration branch as upstream: `git branch --unset-upstream` before any push. Git Bash rewrites `rev:path` into a Windows path: `MSYS_NO_PATHCONV=1`. The CLI's update notice follows its JSON when stderr is merged: parse to the last `}`, and check that compared files are not empty before trusting a `diff`.
- The public API was read at most once a minute but for one pair of calls 32 seconds apart (09:45:54 and 09:46:26 UTC).

## 6. Waiting on Audrey

Nothing.

## 7. Next session's first three steps

For whoever next sees *Probe gateway-ticket* read `missing`:

1. On wilson-dev, read only: `select 'file' as t, id, vetted_at from public.bin_files where id in ('96960001-0000-4000-8000-0000000000f1', '96960001-0000-4000-8000-0000000000f2') union all select 'location', id, vetted_at from public.bin_locations where id in ('96960001-0000-4000-8000-0000000000c1', '96960001-0000-4000-8000-0000000000c2');` by `supabase db query --linked --file`.
2. If a mark is NULL, stamp it the migration's way with P8's two statements (P8's hand-off §6 item 1), as postgres: a write on dev, with the controller's or her go.
3. Confirm by a documents-only push to a `po/` branch: the run's jobs at `/actions/runs/<run id>/jobs` and the smoke job's annotations (*one ticket in the wire's shape, two missing, a forgotten gateway 404, no sign-in 401*), at most once a minute.

## 8. Auto-memory: none.

This file is the memory; the lessons are in §5.
