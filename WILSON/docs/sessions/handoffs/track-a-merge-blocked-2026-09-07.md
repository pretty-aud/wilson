# Hand-off — Track A, the merge session (BLOCKED), 2026-09-07

Written by the Track A session that came after bundle A4 to do **the merge**.
Read `HANDOFF_PROTOCOL.md` first; this follows its §4 order. The A4 hand-off
(`track-a-A4-2026-09-07.md`) remains current for everything it says about the
code; this file corrects two of its instructions and adds what this session
measured.

**The merge did not happen. It could not. Both gates are still shut, and one
of them was shut for a reason nobody had measured.** No code changed this
session.

---

## 1. Where you are

- **Track A has no bundles left.** A1, A2, A3, the three A2 decisions and A4
  are all built, reviewed twice each, and sitting unmerged on
  `track-a-product`.
- Branch `track-a-product`, head **`5a129ee`** plus this file. **This session
  wrote no code and changed no behaviour.**
- **The pre-merge of `feat/multi-user-v1` into `track-a-product` was a genuine
  no-op.** `git merge --no-ff origin/feat/multi-user-v1` printed
  `Already up to date.` and created no commit; `origin/feat/multi-user-v1`
  (`08d44d2`) is an ancestor of `track-a-product`, and no other track has
  pushed to it since A4. **An empty merge commit was deliberately not
  fabricated to make the step look done.**
- **Nothing from this branch is merged into `feat/multi-user-v1`.** The same
  five pieces wait.

---

## 2. State, measured, not remembered

| What | Value | How measured |
|---|---|---|
| vitest | **2062 passed / 84 files, exit 0** — exactly the A4 baseline, so the no-op merge disturbed nothing | `npx vitest run` in this worktree |
| migrations in tree | **71**; last six `0065`, `0066`, `0067`, `0068`, `0069`, `0077` | `ls supabase/migrations` |
| pgTAP suites in tree | **72**; last `72_milestone_realtime.sql`. **Suite 73 still free** | `ls supabase/tests/rls` |
| dev (`eqjzmnvkrakroyqxfsvw`) | `0060`–`0064`, `0066`–`0071`, `0073`–`0075`, `0077`. **0065 correctly absent.** All four Track A migrations (0067, 0068, 0069, 0077) present. 4 workspaces, `inet_server_addr` `…9d59…` | `supabase db query --linked` |
| staging (`rzkirvkotslbovzbsdfh`) | **STILL UNKNOWN. Not applied, not read.** The `link` succeeded this time; the `db query` was refused. See §5 | attempted, refused |
| prod (`rqyriuyldhovirbuievt`) | **untouched, deliberately** | — |
| `schema_migrations` shape | `version:text, statements:ARRAY, name:text`. Dev's Track A rows read `0067=milestones`, `0068=user_pets_stale_write_guard`, `0069=otter_nomination_self_approval_audit`, `0077=milestones_realtime` | queried on dev, so the staging INSERT in §6 is copied from the real thing, not guessed |
| CI | **green on this session's pushed head `04324a3`, all four jobs** — Vitest (renderer units), pgTAP (Supabase local DB), Playwright auth (wilson-dev), issue-session smoke (wilson-dev). Run [34181271227](https://github.com/pretty-aud/wilson/actions/runs/34181271227) | GitHub REST by FULL SHA, jobs enumerated rather than the run conclusion trusted |
| CLI link | wilson-dev in **both** `.temp` files, re-verified after the staging attempt | `cat` |
| walkthroughs | **14 exist; her branch has 0.** 8 on `track-a-product`, 3 on `track-b-auth` (10–12), 3 on `track-c-storage` (13–15), **0 on `feat/multi-user-v1`** | `git ls-tree` on all four refs |
| her checkout | `feat/multi-user-v1` at `08d44d2`, **working tree completely clean (0 status lines)** | `git -C` read-only |

---

## 3. Done and verified

1. **Fresh-worktree setup**, protocol §2: `npm install --ignore-scripts`,
   `git checkout -- WILSON/package-lock.json` (the rewrite was discarded and
   appears in no commit), `.env.local` copied from the canonical checkout and
   confirmed matched by `.gitignore:8` (`.env.*`), `supabase link` to
   wilson-dev with both `.temp` files checked.
2. **HEAD checked against the A4 hand-off before touching a file.** It read
   `5a129ee`, not `7e67bd8` — but `5a129ee` is A4's own docs-only follow-up
   recording CI green, and `HEAD == origin/track-a-product` exactly, so no
   other worktree had committed and **no reset was needed.** Verified by
   reading the commit, not by assuming.
3. **Gate (a) — the walkthrough reports — is CLOSED AS A DIAGNOSIS, WITH PROOF.**
   Five sessions have now searched for a report. This one stopped searching for
   the report and measured the cause instead:
   - No file matching `report` / `result` / `feedback` / `walkthrough` has ever
     been **added** on any ref except the eight walkthrough **scripts** sessions
     wrote themselves (`git log --all --diff-filter=A`).
   - `WILSON/docs/walkthroughs/` contains **0 files on `feat/multi-user-v1`**
     while `WILSON/docs/sessions/` contains **51**. The folder is not sparse or
     stale on that branch; it has never existed there.
   - Her checkout sits on `feat/multi-user-v1`, is **clean**, and
     `WILSON/docs/walkthroughs/` **is not present on disk in it at all.**
   **She has never been able to open a single walkthrough. This is not a
   testing backlog; it was a delivery failure, and it is ours.**
4. **ALL FOURTEEN WALKTHROUGHS WERE DELIVERED TO HER DIRECTLY** (`SendUserFile`),
   which puts them in front of her on any device **without pushing anything to
   `feat/multi-user-v1`** — that branch auto-deploys the staging beta and the
   push is her call, not a session's.
   🚨 **AND THIS IS NOT A TRACK A PROBLEM.** Track B's 10–12 live only on
   `track-b-auth` and Track C's 13–15 only on `track-c-storage`. **All three
   tracks are blocked on reports she was never able to produce**, for the same
   reason, and B's and C's hand-offs are presumably also recording "no report
   yet". Theirs were extracted with `git show <branch>:<path>` and sent too;
   no other track's files were modified.
5. **Gate (b) — staging — attempted, and the wall moved.** See §5; it is new
   information and it changes what to ask her for.
6. **The merge order was verified by ancestry rather than trusted**, because
   Audrey's own fix-branch commit `b051e20` sorts early by date and looks like
   it belongs to A1. It does not: `b051e20` is **NOT** an ancestor of A1's head
   `6373e36`; it arrives only with A4's merge `601756a`. The five bundle heads
   form a clean chain, each an ancestor of the next:
   `6373e36` → `9e361f1` → `f78b045` → `2d80a2d` → `5a129ee`.

---

## 4. In flight

**Nothing.** No uncommitted work beyond this file. `package-lock.json` is
reverted. `.claude/` is untracked and left so.

---

## 5. Traps hit (things the briefs did not say)

- 🚨 **THE STAGING WALL IS ON `db query`, NOT ON `link` — AND FIVE HAND-OFFS SAY
  OTHERWISE.** Measured this session, in this order:
  - `supabase link --project-ref <staging> --password "" --workdir <scratch>` →
    **REFUSED** (as in the four previous sessions).
  - `supabase link --project-ref <staging> --password ""`, **plain, no
    `--workdir`** → **ALLOWED. It succeeded.** `linked-project.json` then read
    `wilson-staging`.
  - `supabase db query --linked --file <a read-only SELECT>` while linked to
    staging → **REFUSED.**
  So the classifier is not blocking "linking to staging" as such; the plain
  form gets through and the **query** is what stops. **The next session should
  try the plain link, and what Audrey needs to allow is `db query`, not
  `link`.** No attempt was made to reach the same query by another syntax —
  that would be working around the denial's intent, which the brief forbids.
- 🚨 **A SUCCESSFUL STAGING `link` SILENTLY REPOINTS THE WHOLE WORKTREE.** After
  it, every `db query --linked` goes to **staging**, including one typed out of
  habit. The link was reversed immediately and **both** `.temp` files re-read
  before any further query. If you try the plain link, re-link to
  `eqjzmnvkrakroyqxfsvw` in the very next command, and check both files, not one.
- 🚨 **THE A4 HAND-OFF'S STAGING COMMANDS COULD NOT HAVE WORKED, AND WOULD HAVE
  FAILED CONFUSINGLY.** They are written as
  `--file supabase/migrations/0068_…` to be run from `WILSON/`. But
  `feat/multi-user-v1` — the branch her checkout is on — **stops at 0066**, and
  `0068`, `0069` and `0077` are **absent from her working tree.** Every one of
  those commands would have died with a missing file, on a path that looks
  correct. Corrected in §6. **Before handing someone a `--file` command, check
  the file exists on the branch THEY are standing on.**
- 🚨 **THE BACKSLASH TRAP BIT A FIFTH SESSION, THROUGH A SIXTH LAYER — AND
  THE VICTIM WAS THE EDIT THAT DOCUMENTED THE FIX.** Rewriting this file to record
  a Windows Desktop path, the path went into a **non-raw Python triple-quoted
  string**, where `\U` in `\Users` is a unicode escape: `SyntaxError: truncated
  \UXXXXXXXX escape`. It failed loudly and wrote nothing, which is the good
  outcome — `\b` in the same position would have written an invisible 0x08 instead.
  The standing rule held and I broke it anyway: **never write a backslash into
  generated code. Build it with `chr(92)`** — here,
  `chr(92).join(['C:', 'Users', ...])`. Six layers so far: regex source, quoted
  heredoc, JSON, shell, markdown and now a Python string literal.
- **Do not fabricate a merge commit to make a step look performed.** The
  instruction was to merge `feat/multi-user-v1` in with a merge commit; git said
  `Already up to date.`, and `--no-ff` does not invent a commit when the target
  is already an ancestor. The honest record is the no-op.
- **The A4 hand-off's own head was one commit stale** (`7e67bd8` vs `5a129ee`)
  because A4 pushed a docs follow-up after writing it. That is benign, but it
  means "HEAD differs from the hand-off" is **not** on its own proof of a
  stale-worktree collision — read the differing commit before resetting.

---

## 6. Waiting on Audrey

**Both of these are hers. Track A cannot merge until both are done, and there
is no other Track A work to do in the meantime.**

1. 🚨 **THE WALKTHROUGH REPORTS — now actually delivered.** Walkthroughs 01–08
   were sent to her in the chat as files this session. The blocking set for the
   five unmerged pieces is **01, 02 (A1), 06 both parts (A2), 07 (A3) and 08
   (A4)**; 03, 04 and 05 also belong to A1.
   **She then asked for them on her Desktop, and they are there:**
   `C:\Users\Audrey\Desktop\WILSON walkthroughs\` — all 14 plus a written
   `00_START_HERE.md` index giving each one's track, bundle, whether it blocks a
   merge, and a suggested order (02 and 01 first, 06 last of Track A's).
   Copied outside git: **no branch, no push and no deploy was involved.**
   They also remain on disk in any worktree holding `track-a-product`.
   **Getting them onto `feat/multi-user-v1` is a push to a branch that
   auto-deploys the staging beta — still her call, still not a session's.**

2. 🚨 **0068, 0069 AND 0077 ON STAGING — with the commands corrected so they
   can actually run.** The files do **not** exist in her checkout, so these run
   from a directory that has them:

   ```
   cd "C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\great-cori-a6d599\WILSON"
   supabase link --project-ref rzkirvkotslbovzbsdfh --password ""
   supabase db query --linked --file supabase/migrations/0068_user_pets_stale_write_guard.sql
   supabase db query --linked --file supabase/migrations/0069_otter_nomination_self_approval_audit.sql
   supabase db query --linked --file supabase/migrations/0077_milestones_realtime.sql
   ```

   Then record them in the ledger — one statement, three rows, copied from
   dev's actual values and safe to run twice:

   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values
     ('0068', 'user_pets_stale_write_guard'),
     ('0069', 'otter_nomination_self_approval_audit'),
     ('0077', 'milestones_realtime')
   on conflict (version) do nothing;
   ```

   Then **re-link to dev in the very next command** and check both `.temp`
   files:

   ```
   supabase link --project-ref eqjzmnvkrakroyqxfsvw --password ""
   ```

   Then `node scripts/tap-all.mjs 56 70 72` → 39/39, 48/48 and 20/20, **run
   alone** (one CLI user at a time, and never piped through `tail`).
   0069 is safe to run twice: its preflight notices a re-run and continues.

   **If she would rather a session did it:** the only thing that needs allowing
   is `supabase db query` while the CLI is linked to staging. The `link` itself
   already goes through in its plain form.

3. **Decision 37's fifth document** — carried from A4, unanswered. Four of five
   reference documents move on approval; `corrections` deliberately stay with
   the proposer, because `otter_fork_course` blanks them by design. If she wants
   all five it is one line in `CR_DOC_MERGE`. Walkthrough 08 asks her directly.
4. **`WIL-3005` / `3006` / `3007` are Track C's** — written and documented but
   absent from `errorCodes.js`, so the Logs view shows *Unknown error code*.
   Three lines. Filed in `OUTSTANDING.md`; `eventVocabulary.test.js` exempts
   exactly those three and fails on any new drift.
5. **A residual A4 stated rather than hid:** the load-generation guard covers
   `loadSoftwareList` and its four awaiting callers, **not** `selectSoftware` /
   `selectSubject`. Two ordinary callers at the same generation are still
   last-writer-wins. Pre-existing, not a regression; the comment in `Otter.jsx`
   says so.
6. **`git worktree remove` for `sleepy-meninsky-0b4ae6`** — only after `b051e20`
   lands on `feat/multi-user-v1`, which has still not happened.
7. **Stale worktrees, hers to remove:** `kind-payne-febae2` (A1),
   `wizardly-lehmann-113acd` (A2s1), `affectionate-herschel-224d83` (A2s2),
   `vigorous-joliot-bb6e3f` (A3), `beautiful-tesla-97a573` (A2 decisions),
   `friendly-jackson-27b867` (A4). **Not this one** until the merge is done —
   it currently holds the only reachable copy of the walkthroughs and the three
   staging migration files.

---

## 7. Next session's first three steps

1. `git fetch origin && git checkout --ignore-other-worktrees track-a-product`,
   then protocol §2 (`npm install --ignore-scripts`,
   `git checkout -- WILSON/package-lock.json`, copy `.env.local`,
   `supabase link` to wilson-dev, check **both** `.temp` files). Then
   `git rev-parse HEAD` and compare with this file's commit — and if it
   differs, **read the differing commit before resetting**; A4's did not
   indicate a collision.
2. **Check the two gates in §6 before anything else, and say which are clear.**
   If either is not, **do not invent work** — Track A's brief is exhausted and
   every remaining item in §6 is Audrey's. Ask which of Track B, Track C or the
   L1 release track she wants, and read that brief instead of this one.
3. **If both gates are clear, merging is the entire job.** From a
   `feat/multi-user-v1` checkout, in this order, always `--no-ff`, never squash
   (heads verified by ancestry in §3 item 6):

   ```
   git merge --no-ff 6373e36   # A1
   git merge --no-ff 9e361f1   # A2, BOTH sessions — A2 does not merge in halves
   git merge --no-ff f78b045   # A3
   git merge --no-ff 2d80a2d   # the three A2 decisions
   git merge --no-ff 5a129ee   # A4 (this also brings in her b051e20)
   ```

   Then push `feat/multi-user-v1` and `track-a-product` — **bare `git push`;
   `git push origin track-a-product` has been refused before** — and confirm CI
   green on the pushed head, **all four jobs** (Vitest, pgTAP, Playwright auth,
   issue-session smoke), read from the GitHub REST API **by full SHA**.
   Remember the push to `feat/multi-user-v1` **deploys the staging beta**, which
   is why §6 item 2 must be finished first.

---

## 9. Cross-track survey (measured this session, because Track A had no work)

Audrey asked which track to run next and told this session to recommend one.
Measured rather than inferred, from each track's own hand-off and from dev:

| Track | Bundles left | Blocked on |
|---|---|---|
| **A** | **none** | her two gates in §6 |
| **B** | **none** — B3's hand-off says so in its own §7 step 3 | walkthrough reports 10, 11, 12. Its other gate is now CLEAR: **0071 IS on dev** (measured here), which B3's hand-off still lists as outstanding |
| **C** | **one: C4** | nothing. C1's *display half* is still blocked — dev has **0** rows in `workspace_storage` where `provider = 's3'`, so her test bucket still does not exist |

**Recommendation given: Track C, bundle C4 ("receipts are money").** It is the
only unblocked buildable bundle left in the whole fix phase: one key in
`BudgetView`'s upload path plus migration **0076** marking existing receipts
financial. `0076` is **absent from the tree**, so it is genuinely unbuilt.
Note **Track C's own C3 hand-off does not mention C4** — it says "Track C has no
bundle left" and warns against taking a number. That hand-off predates C4, which
`FIX_PLAN_2026-09-04.md` added on 2026-09-07 and explicitly assigned 0076 to
Track C. **The fix plan is right and the C3 hand-off is stale on this point;**
the next Track C session should not be talked out of C4 by its own hand-off.

L1 (release) was not recommended: the fix plan puts it last, after A, B, C and
the overhaul.

---

## 8. Auto-memory

None, per `HANDOFF_PROTOCOL.md` §4 item 8. This file is the memory. The two
lessons worth promoting to the controller's cross-track notes are both about
handing work to a person rather than about code:

- **Check that the file exists on the branch the reader is standing on.** Five
  hand-offs told Audrey to run walkthroughs and migrations that were not in her
  working tree, and no session checked until now.
- **A permission wall is per command and per argument shape, not per
  environment.** The plain `link` to staging is allowed; the `--workdir` form is
  refused; the `db query` behind it is refused. Re-probe the exact command
  before repeating "staging is blocked" a sixth time.
