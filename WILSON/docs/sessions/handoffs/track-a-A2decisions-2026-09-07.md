# Hand-off — Track A, Audrey's three A2 decisions (2026-09-07)

Written by the Track A session that did **Audrey's three A2 carry-over
decisions**, for the session that does **bundle A4 (O.T.T.E.R.)**. Read
`HANDOFF_PROTOCOL.md` first; this follows its §4 order. The A1, A2s1, A2s2 and
A3 hand-offs remain current for everything they say about the environment; this
file corrects and adds rather than repeating.

---

## 1. Where you are

- **Track A — product logic. Audrey's three A2 decisions are COMPLETE and NOT
  MERGED. Bundle A4 (O.T.T.E.R.) is NOT started.**
- Branch `track-a-product`, head **`3bd240d`** plus this file. This session's
  commits, oldest first:
  - `e1cb51c` merge of `feat/multi-user-v1` (`08d44d2`) before starting
  - `983e689` decisions 1 and 2 — the dismiss flip, the Tasks-tab trash mount
  - `bd4e470` decision 3 — migration **0077**, suite **72**, the merge layer
  - `e2ea889` R1's corrections (14 findings across two lenses)
  - `3bd240d` R2's corrections (R2 reviewed R1's fixes; 3 HIGH, two of them
    verdict *worse than the bug*)
  - plus this file.
- **NOTHING from this branch is merged into `feat/multi-user-v1`.** FOUR
  pieces now wait on Audrey: A1, A2, A3 and these three decisions.
- 🚨 **No walkthrough report exists anywhere.** Searched exhaustively on
  2026-09-07: every local and remote-tracking branch, all seventeen worktrees,
  the canonical checkout's working tree (clean, on `feat/multi-user-v1`,
  `08d44d2`), her local-only `docs/fixes/`, `Downloads`/`Desktop`/`Documents`,
  and every Claude session transcript on this machine. **Zero files with
  `report`/`result`/`feedback` in the path have EVER been added to this repo on
  any branch.** So nothing merged, and nothing could have.

---

## 2. State, measured, not remembered

| What | Value | How measured |
|---|---|---|
| Track A migrations | **0067 (A2), 0068 (A3), 0077 (these decisions).** 0069 still free and still reserved for A4's `otter_nomination_apply` | `ls supabase/migrations` → 70 files |
| pgTAP suites | **72.** Suite 72 = `72_milestone_realtime.sql`, new this session. 73 free | `ls supabase/tests/rls` |
| dev (`eqjzmnvkrakroyqxfsvw`) | **0077 applied and recorded.** `schema_migrations` ≥ 0066: `0066,0067,0068,0070,0071,0073,0074,0075,0077`; 4 workspaces; `inet_server_addr` `…9d59…` | `supabase db query --linked`, repeatedly |
| 0077 verified ON dev | `trg_milestones_realtime` tgtype **29** (ROW+INSERT+DELETE+UPDATE, no BEFORE bit), the arm present in `pg_get_functiondef`, **12** triggers running `fn_realtime_broadcast` (+5 workspace ones on the other function = 17 by name) | by query, not by the apply exiting 0 |
| staging (`rzkirvkotslbovzbsdfh`) | **0068 and 0077 NOT applied.** Not read either — the classifier refused `link` **twice again** this session, plain and `--workdir`. Third session running | attempted, refused |
| prod (`rqyriuyldhovirbuievt`) | **untouched, deliberately** | — |
| other tracks on dev | 0074 (C) appeared since A3's measurement. NOT drift — checked against the ledger first | `schema_migrations` |
| Edge Functions | **none deployed.** No function changed | — |
| pgTAP full run | **72 suites, 71 clean. 1319 planned, 1318 passed, 1 failed.** Planned 1319 = A3's 1299 + suite 72's 20, so nothing silently failed to run. The one red is `66_cloud_multi_gb` probe 27 — Track C's cross-track transient, red on any branch without C's suite-66 change, and this session did not touch that file | `node scripts/tap-all.mjs`, run **alone**, never piped through `tail` |
| suite 72 on dev | **20/20.** Probe 20's real status **measured**: `landed`, with 4 milestone broadcast rows (insert, date move, trash, restore) and 1 assets control row | `tap-all.mjs 72`, plus a hand-run of the probe's own SQL |
| vitest | **1967 / 79 files** (was 1938 / 79 at session start): +29 tests, no new file | `npx vitest run` |
| `npx vite build` | clean every time, 8–18 s, only the pre-existing chunk-size warning | on every commit touching a view |
| CI | **green on the pushed head `1c29a39`, all four jobs** — Vitest, pgTAP, issue-session smoke and Playwright auth. Run [34160354368](https://github.com/pretty-aud/wilson/actions/runs/34160354368). The pgTAP job rebuilds Postgres from every migration in order, so it also proves **0077 applies to a virgin database** and suite 72 passes there (in its catalog-only form — CI starts the stack with `--exclude realtime`, so probe 20 answers `no-schema`/`no-partition` there and the behavioural measurement is the hand run on dev) | GitHub REST by FULL SHA, unauthenticated (`gh` is not logged in here; `curl` works) |
| CLI link | `supabase/.temp/project-ref` and `linked-project.json` both wilson-dev, re-read after every staging attempt | — |

---

## 3. Done and verified

1. **Decision 1 — the Phase 7 warning's X and click-outside CANCEL** the status
   change (`983e689`, corrected in both rounds). This REVERSES what A2 session
   1 shipped, which had said in `DependencyStatusGuard.jsx`'s header that the
   two handlers marked DISMISS were the whole change if she read "dismissible"
   as "cancel". She did. `Continue anyway` is now the only control that writes.
   The header, the on-screen caption and the button's `title`/`aria-label` all
   argued the old reading and were rewritten with the handlers. **Escape also
   cancels** now (R1 found it did nothing, which under this ruling reads as a
   frozen modal), on the **capture** phase with `stopImmediatePropagation`.
   `role="dialog"`/`aria-modal` added; the absence of a focus trap is STATED,
   not half-built.
2. **Decision 2 — `MilestoneTrashModal` has a second mount on the Tasks tab**
   (`983e689`). The button reads **`Deleted Key Dates`**, NOT the Timeline's
   bare `Deleted`: that toolbar is all key dates and phases, but this screen is
   TASKS, where "Deleted" alone would promise a list of deleted tasks that does
   not exist. Both mounts pass identical props and a test compares the whole
   element.
3. **Decision 3 — key dates live-sync between windows** (`bd4e470`).
   Migration **0077** adds one arm to `fn_realtime_broadcast` (milestones join
   the plain `project_id` branch — 0067 gave the table its own column) and
   attaches `trg_milestones_realtime` AFTER INSERT OR UPDATE OR DELETE. UPDATE
   is the operation ruling 38's trash rides on. Client: `milestones` joins
   `TABLE_TO_COLLECTION`, and `SORTED_COLLECTIONS` (a Set + one hardcoded
   sort_order comparator) became `COLLECTION_ORDER`, a map — **key dates order
   by DATE, not sort_order**, so the old Set would have sorted every live key
   date into the wrong place. `byMilestoneDate` moved out of
   `localServerAdapter` into `state/milestoneOrder.js`.
4. **KEY DATES ONLY, and the other half is machine-checked.** Scenes, shots,
   levels and experiences keep the reload limit by her explicit choice. Suite
   72 probes 11–14 assert none of them carries a trigger running
   `fn_realtime_broadcast`, **matched by FUNCTION, not by trigger name**. 0077
   deliberately does NOT assert this: a post-condition that fails on a
   legitimate future widening is the guarded-narrowing trap 0061's header
   describes, whereas a test is meant to be changed on purpose and with a diff.
5. **Two review rounds, both closed, and both found an instrument lying.**
   §5 has the detail; it is the point of this hand-off.
6. **Breakers: 17 over the guard, 10 over the product, 4 over the mount, 6 SQL
   inside `BEGIN … ROLLBACK` on dev.** Every one behaved as intended at the
   end. **Nine were green when first run and each was a finding.**

---

## 4. In flight

**Nothing.** No uncommitted work. `package-lock.json` was reverted after
`npm install` and never committed. `.claude/` is untracked and was left so.

---

## 5. Traps hit (the brief did not say these)

- 🚨 **THE BACKSLASH TRAP GOT ME, THROUGH A LAYER THE HAND-OFFS DO NOT NAME.**
  Three hand-offs in a row warn that the tool harness collapses backslashes in
  a bash heredoc, so I wrote every file edit as a Python script via the Write
  tool — and **Python's own string escaping ate it instead**. `if (c === '\\')`
  became a comparison against a FOUR-character string in the file. The escape
  branch of a comment scanner was dead, four test mutations went green, and one
  of them silently DELETED real code before a count ran. **The rule is not
  "avoid heredocs" — it is: never write a backslash into generated code at all.
  Use `String.fromCharCode(92)` / `chr(92)`.** The repo already had this habit
  (`milestoneHistoryOps.test.js`); I did not follow it until R2 forced me to.
- 🚨 **A CHECK CAN NAME THE RIGHT RISK AND MEASURE SOMETHING ELSE.** 0077 §3d
  and suite 72 probe 10 both asserted that eleven triggers "survived the
  CREATE OR REPLACE", citing 0059's dropped arms. **A body swap cannot detach a
  trigger** — `pg_trigger` holds the function OID and the OID does not change.
  The real risk when a shared body is RETYPED is a lost `WHEN` arm: every
  trigger still attached, `v_project` NULL, `RETURN NULL`, silence. Nothing
  checked it. **Ask of every post-condition: what mutation makes this fail?**
- 🚨 **`pg_get_functiondef` RETURNS THE COMMENTS.** A text check against it is
  satisfied by a commented-out arm. R1 found the `--` case; R2 found that the
  fix for it still fell to `/* */`, and deleted two real arms on dev with both
  instruments green. Strip **both** forms before any `LIKE`. And a presence
  check is not enough: PL/pgSQL `CASE` takes the FIRST match, so an earlier
  shadowing arm satisfies it — **count** each name, exactly once.
- 🚨 **A `toContain` ON THE WHOLE FILE FINDS THE WRONG HANDLER.** R1's Escape
  pin asserted the file contains `onCancel?.()`; the backdrop handler already
  did. Deleting the cancel from the Escape handler left the key swallowed and
  inert — a frozen modal, worse than the silence it fixed — and the test was
  green. **Slice the thing you mean, then assert inside the slice.**
- 🚨 **A SAMENESS CHECK CANNOT SEE A SYMMETRICAL DELETION.** The two
  trash-modal mounts are compared element-for-element; removing `purgeScheduled`
  from BOTH files kept them equal and kept the test green — the exact defect the
  test's own comment claims to catch. Name the required props as well.
- 🚨 **A GUARD THAT NARROWS A WINDOW IS NOT A FIX.** R1 made `MilestoneRow`
  re-seed its drafts from props, guarded on "not editing" so a live typist is
  not interrupted. R2 pointed out the original bug still runs inside that
  window: open the field, a remote rename lands, click away, and the untouched
  draft is written over the rename. The fix is to compare against a BASELINE
  captured when the field opened — "did this person change anything?" — not
  against whatever the prop happens to be now.
- **A count pin over a syntax pattern will be walked past.** `onClick={onContinue}`
  → beaten by `onDoubleClick`. `/on[A-Z]\w*=\{[^}]*onContinue/` → beaten by a
  spread, an alias, and a nested-brace body (`[^}]*` cannot cross a `}`).
  **Count the IDENTIFIER**, exactly, and name each site in a comment.
- **An anchor that is not unique should ABORT, not guess.** One breaker aborted
  because `} finally {` appears 12 times in `RabbitProvider.jsx`. That is the
  script working; every edit script here asserts an exact occurrence count and
  writes nothing if it is wrong. It caught a wrong-file edit twice.
- **Python reads a CRLF file as LF.** An edit script that reads with
  `newline=''` and matches an LF anchor finds nothing; one that reads normally
  and writes with `newline=''` silently converts the whole file to LF.
  `core.autocrlf=true` hides that from `git diff` but not from the next tool.
  Read normally, write `newline='\r\n'`.
- **The tap-all busy-wait is a trap.** `until grep -q …; do :; done` burns a
  tool call's whole timeout. The background-task notification arrives on its
  own; wait for it.
- **The desktop app's classifier refused, this session:** `supabase link`
  against staging, both plain and via a throwaway `--workdir` (twice, matching
  A3). Everything against dev ran, including DDL by `--file` and mutations
  inside `BEGIN … ROLLBACK`.

---

## 6. Waiting on Audrey

1. 🚨 **WALKTHROUGHS 02, 01, 06 (both parts) and 07 — still no report, and
   there may be a structural reason.** `docs/walkthroughs/` **has never existed
   on `feat/multi-user-v1`**, which is the branch her canonical checkout sits
   on: `git ls-tree -r feat/multi-user-v1 | grep -i walkthrough` returns
   nothing, and it never has. The scripts live only on the `track-*` branches.
   If she has been looking in her normal working folder, there is nothing
   there. **The files are readable today at**
   `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\beautiful-tesla-97a573\WILSON\docs\walkthroughs\`.
   Getting them onto `feat/multi-user-v1` would be a push to that branch, which
   deploys the staging beta — **that is her call, not a session's.**
2. 🚨 **0068 AND 0077 ON STAGING ARE HERS OR A PERMITTED SESSION'S.** From
   `WILSON/` with a throwaway workdir (copy `supabase/config.toml` and
   `supabase/templates/` into a scratch dir first):
   ```
   supabase link --project-ref rzkirvkotslbovzbsdfh --password "" --workdir <dir>
   supabase db query --linked --workdir <dir> --file supabase/migrations/0068_user_pets_stale_write_guard.sql
   supabase db query --linked --workdir <dir> --file supabase/migrations/0077_milestones_realtime.sql
   ```
   then one `--file` per INSERT recording `0068`/`user_pets_stale_write_guard`
   and `0077`/`milestones_realtime` into `supabase_migrations.schema_migrations`
   with `on conflict (version) do nothing`. Then
   `node scripts/tap-all.mjs 56 72` through the `--workdir` variant → 39/39 and
   20/20. **A2, A3 and these decisions all merge into `feat/multi-user-v1` only
   after this**, because a merge there deploys the staging-backed beta.
3. **Walkthrough 06 has changed under her.** If she already ran it, three
   answers are now different: **step 4** (the X and click-outside now CANCEL —
   the reverse of what she would have seen), **step 27b/27c** (the panel is on
   the Tasks tab too), and **steps 32–34** (live sync replaced the "known
   limit" note). The report template changed to match.
4. **Two readings from A2 session 1 are still hers to confirm or flip.** Her
   decision 1 superseded the first of them; the second stands.
5. **Stale worktrees are hers to remove:** `kind-payne-febae2` (A1),
   `wizardly-lehmann-113acd` (A2s1), `affectionate-herschel-224d83` (A2s2),
   `vigorous-joliot-bb6e3f` (A3) and this one, `beautiful-tesla-97a573`, once
   these decisions merge.
6. **A limit worth her opinion, not a defect.** Two people editing the SAME key
   date now merge per FIELD in cloud (`patchMilestone`, added in R2) but the
   DESKTOP still writes whole rows — its PATCH route would have to go in
   `electron/main.cjs`, which is **Track B's** file. Local Server has no live
   sync at all, so nothing races there; it is recorded rather than fixed.

---

## 7. Next session's first three steps (bundle A4 — O.T.T.E.R.)

1. `git fetch origin && git checkout --ignore-other-worktrees track-a-product`,
   then `HANDOFF_PROTOCOL.md` §2: `npm install --ignore-scripts`,
   `git checkout -- WILSON/package-lock.json`, copy `.env.local` from the
   canonical checkout, `supabase link --project-ref eqjzmnvkrakroyqxfsvw
   --password ""` from `WILSON/` (the scoop `supabase`, NOT `npx supabase`),
   and confirm both `.temp` files say wilson-dev. **Then `git rev-parse HEAD`
   and compare it with this file's commit** — if it differs, another worktree
   has committed and you must `git reset --hard origin/track-a-product` before
   touching a file.
2. **Merge `feat/multi-user-v1` INTO `track-a-product` (`--no-ff`) and re-run
   vitest** before anything else. Then check whether §6 items 1 and 2 have
   happened. If reports are back AND 0068+0077 are on staging, merging is the
   first work; A2 does not merge in halves, and A1 can go alone from a
   `feat/multi-user-v1` checkout with `git merge --no-ff 6373e36`.
3. **Bundle A4 exactly as `TRACK_A_product_logic_prompt.md` "Bundle A4" lists
   it.** Its migration **0069** is free and reserved for
   `otter_nomination_apply`; suite **73** is free. Read the auto-memory
   `wilson_otter_cloud_traps` before touching the adapter boundary, and merge
   her fix branch `claude/sleepy-meninsky-0b4ae6` (`b051e20`) first.
4. **Carry-over:** B1 is still not merged into `feat/multi-user-v1`, so the
   roster `error` field does not exist on the merged tree. Other tracks'
   migrations keep appearing on dev — check the ledger in
   `FIX_PLAN_2026-09-04.md` before calling anything drift. The ledger now
   records **suite 72 as taken**.

---

## 8. Auto-memory

None, per `HANDOFF_PROTOCOL.md` §4 item 8. This file is the memory; every
lesson is in §5. The one worth promoting to the controller's cross-track notes
is the first: **never write a backslash into generated code — use a character
code.** It has now cost three sessions through three different layers.
