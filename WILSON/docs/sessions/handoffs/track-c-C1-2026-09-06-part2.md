# Hand-off — Track C, bundle C1 (reservation half), second session, 2026-09-06

Written by the second Track C session, per `HANDOFF_PROTOCOL.md` §4. The first
session's hand-off is `track-c-C1-2026-09-06.md` (same folder); this file
supersedes its §2, §4, §6 and §7. The brief is
`TRACK_C_storage_files_prompt.md`; the rulings are `FIX_PLAN_2026-09-04.md`.

## 1. Where you are

- **Track C, bundle C1, RESERVATION HALF — on dev AND staging, reviewed twice,
  CI green, NOT merged.** The display half (own-bucket previews, long video)
  stays deferred by the brief's own rule: no S3 workspace exists on any
  environment (re-measured this session; dev's `workspace_storage` is empty,
  staging's one row is `byos/network`).
- Branch **`track-c-storage`**. Commits this session, in order: `ef49f02` and
  `1eef46d` (merges of `feat/multi-user-v1` — protocol docs, then the CI
  trigger on `track-*` pushes), **`ea8467f`** (review round 1 fixes),
  **`f4f92ba`** (review round 2 fixes + the docs), then this hand-off's own
  commit — the last commit hash is `git log -1` on `origin/track-c-storage`.
- **Not merged into `feat/multi-user-v1`.** The merge waits on Audrey's
  walkthrough 13 report (§6). Everything else the merge needed is done: 0073 is
  on staging by query, `storage-gc` v10 is on staging, both review rounds ran,
  CI is green on the pushed head.

## 2. State, measured, not remembered (all by query, 2026-09-06 → 07 UTC)

Discriminators: dev `…9d59…` (4 workspaces / 3 projects / 2 users), staging
`…9d47…` (1 / 1 / 6), prod `…9d3a…` (0 / 0 / 0). Repo link stayed on dev
throughout; staging and prod were read (and staging written) through throwaway
`--workdir` links in the scratch directory.

| | dev | staging | prod |
|---|---|---|---|
| migrations ≥ 0059 | 0059–0064, 0066, **0073** | 0059–0064, 0066, **0073** (applied this session: DDL first, history row second; `md5(statements[1])` = `90a3f641…` = the file) | 0059–0063 |
| `upload_reservations` | present, RLS enabled+forced, 1 policy | present, same | absent |
| `petal_storage_quota_insert` | 3-arg (`…, name)`) | 3-arg | 2-arg |
| `file_events_event_check` | 8 terms incl. `upload_abandoned` | 8 terms | 7 |
| `wilson-sweep-abandoned-uploads` cron | `39 * * * *` active | `39 * * * *` active | none |
| `storage-gc` | **v10** 2026-09-07 00:17:00, `index.ts` sha256 `05072cbdcdcd6269…` (downloaded into scratch and hashed) | **v10** 00:17:03, same hash | v8 |
| `storage-presign` | v3 | v3 | v3 |
| `operator-workspaces` (Track A's) | v12 (2026-09-06 23:28) | v10 (23:28) | v9 |
| `resolve-login` (Track B's) | v8 (2026-09-06 23:17) | v9 | v8 |
| `workspace_storage` rows | none | `byos/network` = 1 | none |
| s3 `files` rows | 0 | 0 | 0 |

- Migration numbers used from C's reservation: **0073** only (0074, 0075
  free). pgTAP suites: **77** taken (78, 79 free); 71 files in the tree.
- Suite 77 (with the four probes strengthened in round 1): **53/53 on dev AND
  on staging** through the shim; suite 66: **30/30 on staging**.
- Full `tap-all` sweep against **staging** with 0073 applied (`scripts/` and
  `supabase/tests/` copied into the staging workdir; every suite a rolled-back
  transaction): **suites 71, clean 68, problem 3 — assertions planned 1295,
  passed 1292, failed 3.** None of the three is 0073's, and all three are
  **pre-existing failures already fixed on `track-a-product`, gone once A1
  merges** (verified against `origin/track-a-product` before writing this):
  **67_member_full_time** cannot run through the hosted shim on OUR branch
  (`col_type_is` unimplemented — A1's `ce0d73e` teaches the shim
  `col_type_is` / `col_not_null` / `col_default_is`); **35_platform_audit**
  #17 and #19 are the unscoped operator counts (scoped to the fixture in
  A1's `5dcff98`); **28_otter_progress** #12 counted `otter_progress`
  unscoped, so staging's one real study record read 1 (scoped to its fixture
  course in `ce0d73e`). Every other suite, 77 included, collected exactly what
  it planned.
- Vitest: **1735 / 72 files** (was 1729 / 72; six tests added in round 1).
- CI on the pushed head `ea8467f`: **green** —
  https://github.com/pretty-aud/wilson/actions/runs/34069574781 (Vitest,
  issue-session smoke, Playwright auth, pgTAP with the coverage guard, all
  success). CI runs on `track-*` pushes since the controller's `136030a`,
  merged in at `1eef46d`.

## 3. Done and verified

1. **Staging carries 0073** — applied through the throwaway workdir exactly as
   the first hand-off's §4.1 said (the migration copied INTO the workdir's
   `supabase/migrations/`, relative `--file`), verified by the state query
   (table, forced RLS, one policy, 3-arg policy text, six functions, 8-term
   vocabulary, the hourly cron), THEN the history row from a script-built
   dollar-quoted INSERT (never shell interpolation), THEN verified again: the
   recorded statement's md5 equals dev's and the file's. The desktop app's
   permission classifier allowed every staging write this session (DDL,
   history row, two `functions deploy`) — the wall the first session hit did
   not appear; the protocol's "per command, not per project" holds in both
   directions.
2. **`storage-gc` on staging** — v9 first (the `68f97fe` source, hash
   `7af0500086c68b3b…` confirmed by download), then **v10 on dev and staging**
   after round 1's certificate fix (hash `05072cbdcdcd6269…`, both downloaded
   into scratch and hashed).
3. **Review round 1** (`ea8467f`): two read-only review lenses (breakage
   elsewhere; completeness against the brief and the docs) plus a read of every
   changed file. The commit message carries the full list. Headlines: the
   refusal named the minted key leaf (fixed client-side, `nameTheFile`); the
   CLIENT courtesy check is what refuses the second concurrent clip and never
   said "uploads in progress" (both sentences now match the server's); the
   storage-gc failure certificate could read "sweep ran, 0/0" (the flag now
   starts true); the cleanup card never showed the sweep's counts; the Admin
   Terminal and operator "used" figures were unlabelled for a number that now
   includes reservations; suite 77 probes 4, 26, 45 and 50 strengthened in
   place (plan stays 53); handbook §12.3/§12.4/§17 contradictions; walkthrough
   13 rewritten to what the shipped UI can do (Add files is DISABLED during an
   upload, so the second clip comes from a second browser tab; the operator
   quota field takes gigabytes; step 4 cannot say "has used all"; the hourly
   cron beats a next-day manual cleanup to the certificate).
4. **Breakers for the review's probes**, rolled back, against the applied 0073:
   Bx (reservation arm returns 0, dev) fails 15 probes including the headline
   20 and the policy probe 27; By (reserve skips THE ONE PREDICATE, staging)
   fails 9 including 20; Bz+Bw+Bv+Bu+Bt as one transaction (staging) fails
   exactly {4, 26, 30, 31, 45, 50} — and the OLD probes 4, 45 and 50 could not
   see Bv, Bu, Bt. Table in `ea8467f`'s message.
5. **Review round 2** (a fresh read-only review of `ea8467f`, the round-1
   corrections): eleven candidates; five confirmed and fixed in the round-2
   commit — round 1's cap-pin regex change was a NO-OP (0053 was admitted by
   the FIRST arm, a `WHERE … file_size_limit = 262144` comparison, not by the
   VALUES arm round 1 tightened; the arm now matches `SET … file_size_limit =
   N` only, and the test pins 0053 → `[]` and 0057 → exactly
   `['53687091200']`); "a failed upload releases and is not certified" was
   WRONG for the network-drop case (the release RPC rides the same network and
   swallows its failure, so a drop IS certified — handbook §17, the TPN note
   and walkthrough Part B reworded; only a failure the server answered
   releases); the cleanup card and handbook §12.4 named ONE cause for a flag
   that now has three; probe 4 named four privileges and let a TRUNCATE grant
   pass as "nothing" (all seven now); the client's not-enough-space sentence
   still differed from the server's (byte-identical now, and the walkthrough
   quotes it). Two accepted as limits (§5): the refusal names the file twice
   (FileManager's per-file prefix plus the quoted sentence); two browser tabs
   share one session. The rest were verified-OK notes or corrections to the
   round-1 commit MESSAGE (its cap-pin claim was not backed; its hash is of
   CRLF bytes). Suite 77 re-run after the probe-4 change: 53/53 on dev.
6. **CI green on the pushed head** (URL in §2).

## 4. In flight — the exact next actions

1. **Audrey's walkthrough 13, Parts A–C** (sent at the close of this session,
   §6). The bundle merges only after her report.
2. **The merge**, when her report is in: `git merge --no-ff feat/multi-user-v1`
   into `track-c-storage` first (resolve, vitest, `tap-all`), then
   `git merge --no-ff track-c-storage` into `feat/multi-user-v1`, push both.
   The merge deploys the beta; staging already carries 0073 and `storage-gc`
   v10, so nothing else must precede it. Expect a trivial conflict in
   `OUTSTANDING.md`'s session log (rows are added at the top — keep both), and
   an adjacent-line conflict in root `rls.yml`'s `RLS_TABLES` where Track B
   adds `auth_events` beside our `upload_reservations` (the controller
   reworded the ownership rule on 2026-09-06: entries land with their suites
   on each track's branch, and Track C RESOLVES that list at merge time rather
   than owning every addition — keep both entries, and check the replay list
   the same way).
3. **Rulings owed** (§6) feed bundle C2's migration 0074; do not build them
   without her answer.

## 5. Traps hit

- The desktop app cut this worktree from `main` AND `track-c-storage` was still
  checked out in the FIRST session's worktree, so `git checkout` was refused
  ("already checked out"). `git -C <old worktree> checkout --detach` frees the
  branch without deleting anything; then check it out here. Do not remove the
  old worktree (it holds that session's `.env.local` and link).
- **The Bash tool in the desktop app only parses heredocs delimited by `EOF`.**
  `<<'PY'` and `<<'MSG'` both died with "unexpected EOF while looking for
  matching `'`" and nothing ran. Write scripts and commit messages with the
  Write tool and run `python file.py` / `git commit -F file`.
- **`supabase db query` runs must be one at a time PER PROJECT** (the CLI's
  temporary login role races). Dev and staging can run in parallel; two on
  staging cannot. `tap-all` on staging: copy `scripts/` and `supabase/tests/`
  into the staging workdir and run it there (`--linked` then means staging).
- `supabase functions download --workdir <scratch> --project-ref <ref>` works
  from any linked scratch workdir (the flag overrides the link) — and it
  overwrites `supabase/functions/<slug>/` under that workdir, so never a repo.
- `information_schema.role_table_grants` cannot show a grant to PUBLIC (the
  docs say so; `table_privileges` can). 0073's post-condition 1 has that shape
  and cannot be changed now (applied on two environments); the NEXT
  migration's post-conditions should use `has_table_privilege('anon', …)`
  (anon inherits PUBLIC). Suite 77 probe 4 already does.
- `FileManager`'s Add files button is `disabled={copying}` and there is no drop
  zone: two uploads in flight from one machine need two browser tabs. Files
  chosen together upload one after the other.
- The client courtesy check (`classifyUpload`) reads
  `workspace_storage_usage()`, which now includes reservations, on EVERY add —
  so it, not the server, is what refuses a concurrent second clip. Any copy
  the server says must be said there too.
- The unauthenticated GitHub API answers for this public repo
  (`/repos/pretty-aud/wilson/actions/runs?branch=…`); `gh` is not signed in on
  this machine.
- `formatBytes` rounds at ≥ 10 units: a 0.3 GB plan prints "307 MB", the
  remainder after a 200 MiB clip "107 MB" — the walkthrough's example numbers
  (a clip of 200 decimal MB prints 191 / 116; the walkthrough says so).
- Every sha256 in this file is of the CRLF working-tree bytes
  (`core.autocrlf=true`); `git show <rev>:<path> | sha256sum` gives a
  different value (`ef5afdc9…` for `ea8467f`'s storage-gc) and is NOT a
  mismatch — hash the file `functions download` writes, as this session did.
- FileManager prefixes every per-file failure with the file's name, so an
  over-quota refusal reads `clip.mov: [supabase] upload refused: Not enough
  Petal cloud storage for "clip.mov": …` — the name twice. Accepted: the
  prefix is the batch list's convention and the sentence must stand alone.
- Two browser tabs share one Supabase session in localStorage; a token refresh
  in one rotates what the other holds, and tus re-reads the token per request,
  so walkthrough Part A's first upload could in principle 401 mid-way. Not
  observed; if it happens, that is the cause — retry with the quota raised.
- A `file_size_limit = N` regex matches a WHERE comparison as readily as an
  assignment; 0053's and 0057's post-conditions both compare another bucket's
  cap. Pin ASSIGNMENTS (`SET … =`), and prove the pin with a migration that
  only compares.
- Two of Track B's lessons, relayed by the controller, that 0073 already
  leans on: hosted `postgres` is BYPASSRLS, so a SECURITY DEFINER function
  bypasses FORCE RLS — which is exactly how `reserve_upload_bytes`,
  `release_upload_reservation` and `sweep_abandoned_uploads` write a table
  with zero write policies; and the planner pre-evaluates STABLE helpers
  inside a policy, so an anon probe with EMPTY claims dies 22P02 before the
  42501 it is looking for — suite 77 probe 52 sets `{"role":"anon"}` for that
  reason. Keep both shapes in suite 78.

## 6. Waiting on Audrey

- **Walkthrough 13, Parts A–C** — `docs/walkthroughs/13_uploads_own_bucket.md`.
  Until the merge, run the app FROM THE BRANCH: in the canonical checkout,
  `git checkout track-c-storage`, `npm run dev`, signed in against dev or
  staging (both carry 0073 and `storage-gc` v10). Report the ☐ lines and the
  exact refusal wording. The merge follows her report.
- **Four rulings**, each a design choice the brief did not make; none blocks
  the merge, all feed C2's migration 0074:
  1. An upload that FAILS with an error (network drop, 5xx) releases its
     reservation and is NOT certified; only a closed tab / crash is. Certify
     failures at once (a small `abandon_upload_reservation(path)` RPC that
     closes the row as `abandoned` and writes the certificate, called from the
     client's failure path)? Recommended: yes, in 0074.
  2. A closed tab holds its reserved bytes for 24 h; on a small plan the same
     person's retry is refused for a day and no control releases it. Accept
     and say so (current), let the app release the same person's own stale
     rows when they next open Files (loses the certificate for those), or an
     admin "release abandoned uploads" control (needs SQL)?
  3. `reserve_upload_bytes` has no per-member cap: a member who can write one
     project can reserve the whole quota under fabricated keys for 24 h. Add a
     cap on active reservations per user (e.g. 10) in 0074?
  4. ~~Teardown CASCADEs `upload_reservations` away uncertified~~ — no longer
     a ruling: the controller put the pre-CASCADE reservation sweep into the
     fix plan's C2 row (2026-09-06), so C2 builds it (§7 step 3).
- **The S3-compatible test bucket** as a workspace on dev (Admin Terminal →
  Storage → S3-compatible, CORS `AllowedOrigins: ["*"]`). Until it exists,
  C1's display half stays deferred; C2 runs meanwhile.
- Nothing else is hers: staging is done, CI runs on the branch, no PR is
  needed for CI.

## 7. Next session's first three steps

1. `git fetch origin && git checkout track-c-storage` (if refused because the
   branch is checked out in another worktree, `git -C <that worktree> checkout
   --detach` first), then `git merge --no-ff feat/multi-user-v1`, resolve,
   `npm install --ignore-scripts`, `git checkout -- WILSON/package-lock.json`,
   vitest. Copy `.env.local`, `supabase link` to wilson-dev from `WILSON/`,
   confirm `supabase/.temp/project-ref` says `eqjzmnvkrakroyqxfsvw`.
2. If Audrey's walkthrough 13 report is in and clean: merge the bundle
   `--no-ff` into `feat/multi-user-v1` (§4.2) and push; confirm CI on
   `feat/multi-user-v1`. If it is not in, leave the bundle on the branch and
   say so.
3. Start bundle **C2** (migration **0074**, suite **78**). The fix plan's C2
   row (as the controller amended it on 2026-09-06) now names, besides the
   brief's two items:
   - `file_events.is_financial` + the `file_events_select` money arm (restate
     every arm; post-condition asserts the arm);
   - the avatar sweep at teardown with a counted certificate line;
   - **a sweep of the workspace's OPEN upload reservations BEFORE the
     teardown CASCADE, with its own certificate line** (`sweep_abandoned_uploads`
     only takes EXPIRED rows, so this needs a teardown-scoped variant or a
     parameter — every open row of the tenant is abandoned by definition);
   - **making `rls.yml`'s coverage guard two-directional** (Track C owns that
     file's RLS_TABLES edits): enumerate the RLS-enabled tables from the CI
     database (`pg_class.relrowsecurity` in `public`) and require each to be in
     `RLS_TABLES` or in an explicit covered-by map (`file_events` →
     `33_file_lifecycle`, `platform_operators` → `35_platform_audit`, and so
     on), so the eight tables absent today (`auth_attempt_log`, `file_events`,
     `otter_quiz_attempts`, `otter_subject_shares`, `platform_operators`,
     `storage_gc_queue`, `workspace_members`, `workspaces`) become a red step
     instead of a silent hole; list `otter_subject_shares` as KNOWINGLY
     uncovered (the 0065 hole) until Phase 5c builds it;
   - and, with her rulings from §6: `abandon_upload_reservation(path)` for the
     client's failure path, and the per-member cap on active reservations.
   Coordinate with Track A before redeploying `operator-workspaces` (dev v12 /
   staging v10 at hand-off; read `functions list` again first). One bundle
   per session.

## 8. Session close-out line

Merged: nothing (the merge waits on the walkthrough report). Committed,
unmerged: `ea8467f` (round 1), `f4f92ba` (round 2 + docs) and this hand-off
on `track-c-storage`, all pushed. Uncommitted: nothing. Context consumed:
moderate — the migration, suite 77, the client, two review reports and their
verification; a natural seam (both environments carry the bundle, reviews
closed, only her report and the merge remain).
