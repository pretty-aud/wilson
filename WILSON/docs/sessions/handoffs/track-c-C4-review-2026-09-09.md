# Hand-off — Track C, bundle C4's REVIEW ROUNDS, 2026-09-09

Written by the sixth Track C session, per `HANDOFF_PROTOCOL.md` §4. The brief is
`TRACK_C_storage_files_prompt.md`; the rulings are `FIX_PLAN_2026-09-04.md`; the
session before this one is `track-c-C4-2026-09-08.md`, which built C4 and left
it unreviewed.

**C4 is now REVIEWED and is ON BOTH ENVIRONMENTS. It is still NOT MERGED, for
the one unchanged reason: Audrey's walkthrough reports.**

---

## 1. Where you are

- Branch **`track-c-storage`**. Commits this session:
  - **`4f0e6b7`** — review round 1's corrections (9 files).
  - **`64dc4da`** — review round 2's corrections (8 files).
  - **`<this commit>`** — this file.
- HEAD when this session opened was **`6a66355`**, exactly what C4 pushed. **No
  divergence, nothing to reset** — the third session in a row to check, and the
  first for which the answer was simply "it matches".
- **Bundles C1, C2, C3 and C4 all remain unmerged**, awaiting walkthroughs
  13, 14, 15 and 16.
- **Nothing is uncommitted.**
- `feat/multi-user-v1` has not moved since **`08d44d2`**, which is already
  contained in `track-c-storage` (0 commits ahead of the track branch), so the
  pre-merge `git merge --no-ff feat/multi-user-v1` will be a no-op.
  `track-c-storage` is **27 commits ahead** of it.

## 2. State, measured 2026-09-09, not remembered

Discriminator `inet_server_addr()` + a workspace count in every query.
**Dev `…9d59…` (4 workspaces). Staging `…9d47…` (1 workspace).**
Prod is `rqyriuyldhovirbuievt` and was **not touched**.

| | dev | staging |
|---|---|---|
| migrations ≥ 0070 | 0070, 0071, 0073, 0074, 0075, **0076**, 0077 | 0070, 0071, 0073, 0074, 0075, **0076** |
| 0076 recorded md5 | `fd0dc1ac2c2dfcd2566fde4eac817ccb` | `fd0dc1ac2c2dfcd2566fde4eac817ccb` |
| 0076 recorded length | 23108 chars | 23108 chars |
| `expenses` / `files` / `file_events` rows | 0 / 0 / 0 | 0 / 0 |
| financial files, ungated receipts | 0, 0 | 0, 0 |
| policies on `public.files` | 4 | 4 |
| `workspace_storage` where provider = 's3' | **0** | — |

- **0065 is still absent from dev**, as intended. 0072 is absent from staging
  (it is Track B's unused number, not a fault).
- **Both environments now record the SAME md5 for 0076, and it equals the md5
  of the file's LF bytes** (the git blob). That invariant holds for 0074
  (`5068e6c9…`) and 0075 (`4c576832…`) too — see §5, because the C4 hand-off
  said otherwise about 0075 and was wrong.
- Tree: **71 migrations, 73 pgTAP suite files.** ⚠️ The C4 hand-off said 70
  migrations; it is 71. (Earlier prompts said 71/72 suites; also wrong.)
- **Vitest: 1815 / 76 files**, all passing (was 1809 — this session adds 6 pins).
- **Suite 78: 60/60 on dev.** `plan` went 49 → 58 (C2 → C4) → 59 (round 1) →
  **60** (round 2 added the control that makes the access probe mean something).
- **C1's display half is still blocked.** Re-measured: **0** s3 workspaces on
  dev. Her test bucket still does not exist. Do not start it.
- **CI GREEN on the pushed head `272acc242c38dc976e9e0ec50a3c6e7948cab076`** —
  RLS tests run #383, success in 1m 57s, **all four jobs**: pgTAP (Supabase
  local DB), Vitest (renderer units), issue-session smoke (wilson-dev) and
  Playwright auth (wilson-dev).
  https://github.com/pretty-aud/wilson/actions/runs/34322950020
  🚨 **That run is also the only proof suite 78's new `storage.objects`
  INSERT and probes 59/60 work anywhere but hosted dev** — review round 2
  raised exactly that, since `supabase start` excludes storage-api. The
  pgTAP job builds a clean database from EVERY migration including 0065 and
  runs all 73 suites under real pgTAP, so it is the stronger evidence and it
  covers what the stalled local sweep could not.

## 3. Done and verified

1. **THE TWO ADVERSARIAL REVIEW ROUNDS, run from scratch.** C4 was treated as
   completely unreviewed, which it was. Round 1 was three Opus subagents (SQL,
   client, docs) plus this session's own pass; round 2 reviewed round 1's
   corrections.
2. **The gap C4 named is NOT a gap.** `googleDriveAdapter.js:267` is
   `uploadFile: readOnly('uploadFile')` and `readOnly` (`:48`) returns an async
   function that throws. Drive cannot write an ungated receipt because it
   cannot write anything. "Both write-capable backends" survives **as written**
   — C4's claim was true, though asserted without checking. Nothing pins Drive
   as read-only, so a future Drive write path must revisit handbook §12.9;
   that is now stated there.
3. **🚨 THE FIX HAD LOCKED THE MANAGER OUT OF THEIR OWN RECEIPT — fixed.**
   `FileManager.jsx:194` drops every `is_financial` row and
   `ProjectsPage.jsx:187` filters them from the project's file table, so
   marking a receipt financial removed it from both surfaces that can open a
   file; `ExpensePopup` rendered only a paperclip, a name and a remove button.
   The single open path for a financial file is `InvoiceAttachment.handleOpen`,
   keyed on `budget_actuals.attachment_path` and never wired to
   `expenses.file_ids`. **Walkthrough 16's own step A3 could not have passed.**
   `ExpensePopup` now has the receipt's own open control (re-list → find by id
   → `downloadFile` → object URL), pinned by three new vitest probes, one
   proven by a breaker.
4. **🚨 A RECEIPT IS NOW EXEMPT FROM THE PETAL STORAGE QUOTA — documented, not
   fixed.** `rabbit_quota_exempt_path` (0055) is true for any money segment and
   short-circuits the RESTRICTIVE `petal_storage_quota_insert`, so a receipt
   under `INVOICES/` **can never be refused**; `workspace_petal_committed_bytes`
   has no matching exemption, so its bytes still consume the allowance that
   refuses ordinary media. Verified by reading both functions and the policy on
   dev. 0055 justified the exemption on the premise that money paths are tiny;
   the expense picker is `<input type="file" multiple>` with no `accept` and no
   size cap. **Not a security hole** — 0037 gates `expenses` — **but a billing
   one. Bounding it is a 0055 change and a pricing decision: Audrey's.**
5. **Migration 0076 — the guard and four post-conditions**, applied to dev AND
   staging with every assertion green on both:
   - **A ROW-SECURITY GUARD, as its own statement ABOVE the backfill.** `files`
     and `expenses` are ENABLE **and FORCE** RLS, so a role without a bypass
     would update zero rows, read zero in every count, pass the post-conditions
     vacuously and print `0076 OK` over a database full of ungated receipts —
     and nothing else in the file could tell that apart from "nothing to do"
     (3h even ASSERTS the forcing that creates the hazard). It uses
     `row_security_active()` rather than a `rolsuper OR rolbypassrls` proxy, so
     it asks the real question and cannot wrongly refuse CI's local stack.
     ⚠️ **Round 2 moved it.** Round 1 put it first inside the post-condition
     block — which is the *third* statement of the file, after both UPDATEs,
     and under a plain `psql` apply they would already be committed. A guard
     that fires after the write it guards is a report.
   - **3d** asserts the CHECK by `pg_get_constraintdef` — and, after round 2,
     asserts the **`is_financial`** axis as well as the path one. The constraint
     has two money disjuncts and this backfill writes the flag, so the flag
     disjunct is the one that makes TRAP 1 real; round 1 asserted only the other.
   - **3g** counts **3 USING + 2 WITH CHECK** — four policies carry five money
     clauses, and the old concatenation counted policies, so a `files_update`
     that kept one arm and dropped the other passed.
   - **3i keeps TWO instruments, which is the point.**
     `information_schema.column_privileges` structurally cannot express DELETE,
     TRUNCATE or TRIGGER (measured: it holds only
     INSERT/REFERENCES/SELECT/UPDATE across the whole public schema, while
     `role_table_grants` on `files` holds all seven), so `GRANT TRUNCATE TO
     anon` — which bypasses RLS — passed 3g, 3h and 3i together. But
     `has_table_privilege` cannot see a COLUMN grant, so round 1's swap was a
     coverage regression: `GRANT SELECT (is_financial) ON public.files TO anon`
     would have started passing. **Round 2 restored the column arm alongside**,
     which is exactly what suite 79 does and why. The redundant `'public'`
     grantee is gone — anon inherits PUBLIC.
6. **Suite 78 is 60 probes, and the honest version of a claim round 1 got
   wrong.** Round 1 wrote "REVIEW ROUND 1 REPLACED A TAUTOLOGY HERE" over probe
   55 — **and had not touched its assertion**, only its message; round 2 diffed
   it against `b90ee99` and found it byte-identical. What round 1 actually did
   was add an access probe *beside* the tautology. That is now stated plainly in
   the file: **probe 55 is a shape assertion over the fixture's own string and
   can never go red if the blob gate closes; probe 60 is the access probe, and
   probe 59 is its control** — a money-namespace object the member must NOT be
   able to read, without which "the member can read the receipt's blob" cannot
   be told apart from "storage RLS is not applying to this session at all".
   Both pass, so the exposure is measured rather than assumed. Probe 60's
   message carries its own disposition, because a comment is not printed in a
   CI log. Probe 57 widened to the total event count.
7. **Migration 0076 on STAGING**, which is what unblocks the merge. Applied
   from `track-c-storage` (the file exists on no other branch), statements
   first and the history row second, then **the CLI was re-linked to
   `eqjzmnvkrakroyqxfsvw` in the very next command and BOTH `.temp` files were
   re-read**, plus a live query confirming `…9d59…` / 4 workspaces.
8. **Docs corrected** — see §5 for the list; every correction was settled by
   query or by reading the migration, not argued.
9. **🚨 ROUND 2 FOUND FIVE DEFECTS IN ROUND 1'S OWN CORRECTIONS**, which is the
   whole reason this track runs two rounds. In severity order: the 3i coverage
   regression (§3.5); the guard sitting after the writes it guarded (§3.5); 3d
   asserting the wrong axis (§3.5); **probe 55's "replaced a tautology" claim
   being simply false** (§3.6); and probe 59 having no presence control, so it
   could not distinguish "the policy served it" from "storage RLS is not
   applying here" (§3.6). It also found four surviving `Files`/`Resources`
   label contradictions in walkthrough 16 that round 1's own new preamble
   declared wrong, two silent-failure paths in the new `openFile`
   (a pop-up-blocked `window.open` returning null unchecked, and a bare
   `return` on a missing adapter while the button renders unconditionally —
   both the exact failure `InvoiceAttachment`'s header calls the bug it
   replaced), and a test slice that ran to end of file instead of to the end of
   the function. All fixed.
10. **AUDREY ANSWERED, ASKED DIRECTLY THIS SESSION** (not inferred from
    silence): **walkthroughs 13, 14, 15 and 16 have NOT been run** — unchanged
    from 2026-09-08 — so nothing was merged. And on the quota exemption
    (§3.4) her ruling is **BOUND THE EXEMPTION BY SIZE**: a change to 0055's
    `rabbit_quota_exempt_path` so only small money files are exempt. That is a
    new migration in C1's family, and it is the next session's work — see §4.

## 4. In flight — the exact next actions

1. **THE MERGE, when the reports are in.** `git merge --no-ff feat/multi-user-v1`
   into `track-c-storage` first (a no-op today — see §1), re-run vitest and
   `tap-all`, then `git merge --no-ff track-c-storage` into
   `feat/multi-user-v1`, push both, confirm CI. **All four bundles go
   together.** Expect a trivial conflict in `OUTSTANDING.md`'s session log
   (rows at the top — keep both). **C4 needs no `rls.yml` change**: verified —
   `expenses` is in `RLS_TABLES` (line 74) mapped to `46_expenses.sql`,
   `file_events` is covered by `33_file_lifecycle` (line 154), and
   `78_file_events_money.sql` is already in the replay list (line 401), whose
   73 entries match the 73 suite files.
2. **⚠️ THE FULL `tap-all` SWEEP DID NOT COMPLETE THIS SESSION, and that is the
   one piece of owed verification.** See §5 — CLI contention from concurrent
   sessions stalled it three times. What WAS run and is green: **suite 78 at
   59/59 (three times, including once at the final state)** and **suite 48 at
   19/19**; a first sweep completed 47 suites before it stalled and was killed
   before printing its table. **CI is the authoritative full sweep** and runs
   all 73 suites against a clean database built from every migration including
   0065 — confirm it on the pushed head. Re-run `node scripts/tap-all.mjs`
   when the machine is quiet.
3. **🚨 AUDREY'S NEW RULING: BOUND THE QUOTA EXEMPTION BY SIZE.** Asked this
   session (§3.4, §3.10). `rabbit_quota_exempt_path` (0055:315-332) exempts any
   money-segment path from the RESTRICTIVE `petal_storage_quota_insert`, so a
   receipt can never be refused however large, while
   `workspace_petal_committed_bytes` still counts its bytes. She wants the
   exemption bounded by object size rather than the picker capped.
   **This is a new migration in Track C's C1 family (0055's descendant), not an
   edit to 0055**, and it needs its own number — the ledger's next free one is
   **0078**, which `FIX_PLAN_2026-09-04.md` currently assigns to Track D, **so
   ask the controller or Audrey before taking it.** It needs its own two review
   rounds and a probe pair (a small money file still exempt; an oversized one
   weighed and refusable). It does NOT block the C1–C4 merge.
4. **C4 deployed NO Edge Function**, and neither did this session. Nothing
   touches `supabase/functions/**`, so there is no staging deploy owed.

## 5. Traps hit

- 🚨 **THE STAGING WALL GAVE ITS SEVENTH ANSWER IN SEVEN SESSIONS: both `link`
  AND `db query` ALLOWED.** That matches C4 and contradicts Track A one day
  earlier. **Re-probe it every session; never inherit the answer.**
- 🚨 **A MIGRATION CANNOT PROVE ITS OWN BACKFILL RAN WHEN IT IS SUBJECT TO
  RLS.** `FORCE ROW LEVEL SECURITY` binds the table owner too. With no JWT the
  workspace predicate is NULL, so every statement AND every post-condition sees
  nothing, and the file reports success. On a zero-row environment that is
  indistinguishable from the truth. Dev's applying role is `postgres` with
  `rolbypassrls = true` (`rolsuper` false), so C4's apply was sound — but only
  by luck of the environment. **Any migration whose evidence is a count needs
  `row_security_active()` asserted first.**
- 🚨 **`information_schema.column_privileges` IS NOT A GRANT AUDIT.** It can
  only ever express the four column-grantable privileges. `GRANT TRUNCATE` —
  which bypasses RLS entirely — is invisible to it. Use `has_table_privilege`
  over all seven. This is the **third** time the repo has hit it (77, 79, now
  0076 via 0075).
- 🚨 **FOUR POLICIES CAN CARRY FIVE MONEY CLAUSES.** `files_update` holds the
  arm in USING *and* WITH CHECK. Concatenating `qual || with_check` before a
  LIKE counts policies, not clauses, and a policy that loses one arm passes.
- 🚨 **A PROBE THAT ASSERTS A PROPERTY OF ITS OWN FIXTURE STRING PROVES
  NOTHING.** Old probe 55 read `NOT rabbit_money_key(storage_path)` on a path
  the suite had just written. It would have stayed green after someone closed
  the very gap it claimed to pin. If a probe is about ACCESS, it must make an
  access attempt.
- 🚨 **`rabbit_files_invoices_*` HAS NOT EXISTED SINCE 0042** dropped it
  (`0042:212-214`) in favour of `rabbit_files_money_*`. C4's BudgetView comment
  and handbook §12.9 both named it — the **same phantom family** as the S39
  incident this repo already records, where a brief said "four policies: three
  base plus `rabbit_files_invoices_select`" and a literal port would have
  shipped a bucket with no money gate. There are **four** base policies and
  four money ones; **eight**, which is what 0042's own post-condition asserts.
- 🚨 **THE C4 HAND-OFF'S md5 ADVICE WAS RIGHT AND ITS EXAMPLE WAS WRONG.** It
  said 0075's recorded md5 "no longer" equals the committed blob's. Re-measured:
  `4c576832…` on dev **does** equal `git show HEAD:…0075….sql`. Only the CRLF
  *working copy* differs. The rule stands (compare against the LF blob, use
  `tr -cd '\r' | wc -c` to detect CRLF); the example was a misreading.
- ⚠️ **CORRECTING AN APPLIED MIGRATION IS THIS REPO'S PRACTICE, AND IT COMES
  WITH AN OBLIGATION.** 0074 was edited after being applied (`ce63a54`, C2's
  review round 1) and its HEAD blob md5 still equals dev's recorded md5 — so
  the history row was re-recorded. This session did the same for 0076: dev's
  row was UPDATEd to the corrected text and staging received the corrected file
  from the start, so both environments and the git blob agree on one md5.
- ⚠️ **`tap-all` IS UNUSABLE WHEN OTHER SESSIONS ARE ACTIVE.** Three separate
  runs stalled mid-sweep (at suites 48, 58 and 3 of a targeted set), each
  resuming fine when run alone. The protocol's "one `tap-all` at a time" is
  about correctness; this is about it simply not finishing. Prefer CI, or run
  it when nothing else is going.
- ⚠️ **Backticks in a bash heredoc run as command substitution.** A `python -c`
  block full of `` `identifiers` `` failed noisily. The standing trap ("never
  interpolate content into a shell command; write scripts to files") applies to
  heredocs too — and Windows `cp1252` stdout will also refuse `→`/`⚠` unless
  you wrap stdout in a UTF-8 writer.
- ⚠️ **Markdown/SQL edits must respect CRLF.** Most files here are CRLF; a
  Python replace built on `\n` silently matches nothing. Normalise, substitute,
  restore. `git` still stores LF, which is why the md5 comparison uses the blob.

## 6. Waiting on Audrey

- **Walkthroughs 13, 14, 15 and 16 — all four still unrun. ASKED DIRECTLY THIS
  SESSION; the answer was "none run yet", unchanged from 2026-09-08.** That is
  the only thing keeping four finished bundles unmerged. All four are in
  `C:\Users\Audrey\Desktop\WILSON walkthroughs\` with the index.
  ⚠️ **Walkthrough 16 was corrected this session and the Desktop copy
  re-synced** — A3 said the receipt should be downloadable from Project Files,
  which the fix makes impossible by design; there is now an **A2b** that opens
  it from the expense instead, which is the control that matters. The index's
  headline count was 14 for 15 scripts; fixed.
  **Run 16 against DEV or STAGING — both now carry 0076.**
- **The quota exemption decision is ANSWERED, not owed: bound it by size.**
  See §4 item 3 for what that means and why it needs a migration number that is
  not currently Track C's.
- **The S3-compatible test bucket** as a workspace on dev. Re-measured: still
  **zero**. C1's display half waits on it.
- **The full `tap-all` sweep** is owed (§4 item 2) — not hers to run, but worth
  knowing it is outstanding.

## 7. Next session's first three steps

1. `git fetch origin && git checkout track-c-storage` (add
   `--ignore-other-worktrees` if a stale worktree holds it). **Then
   `git rev-parse HEAD` and compare with this hand-off's own commit. If it differs, READ the
   differing commit before doing anything** — twice it has been a benign docs
   merge and a blind reset would have destroyed real work; once (this session)
   it matched exactly. `npm install --ignore-scripts`,
   `git checkout -- WILSON/package-lock.json`, copy `.env.local` from the
   canonical checkout, `supabase link --project-ref eqjzmnvkrakroyqxfsvw
   --password ""` from `WILSON/`, confirm **both** `.temp` files say wilson-dev.
2. **Run `node scripts/tap-all.mjs` when the machine is quiet** and record the
   number (§4 item 2). Expect 73 suites; `67_member_full_time` (14 planned)
   will not run through the hosted shim — a known `col_type_is` gap, not this
   track's — so a clean sweep reads 72 clean / 1 problem, 1378 of 1392 planned.
3. **Ask Audrey whether walkthroughs 13, 14, 15 and 16 have been run** — do not
   infer it from silence; she has now been asked at the top of three sessions
   running and the answer has been "not yet" each time — and **if they are in
   and clean, merge all four bundles** (§4 item 1). If they are not, leave them
   and say so, then do §4 item 3 (bounding the quota exemption) instead, which
   is real work that does not wait on her.

## 8. Session close-out line

Merged: nothing. Committed and pushed on `track-c-storage`: **`4f0e6b7`**
(review round 1), **`64dc4da`** (review round 2) and this file.
Uncommitted: nothing. Applied: **0076 on dev AND staging**, both recording the
same md5 as the git blob. **C4 is now reviewed** — the two rounds found a
regression that would have failed the bundle's own walkthrough, an unnamed
quota exemption, four weak post-conditions, a tautological probe and a phantom
policy family — and it is still unmerged only because the four walkthrough
reports are not in.
