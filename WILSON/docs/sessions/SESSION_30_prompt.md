# SESSION 30 launch prompt — O.T.T.E.R. KEEPS ITS WORK

> **Scheduled by Audrey on 2026-08-04** (*"lets make a new session for this"*),
> after S28's close-out named it the largest genuinely broken thing left.
>
> **STATE AFTER S29 (2026-08-05, `7443fed` → `f2d82cc`) — do not re-measure
> it:** migrations **0000–0044** on all three envs, next free **0045**. S29
> added **no SQL** — the schema was already right and the client simply never
> asked. pgTAP unchanged at **54 suites / 832 assertions**; O.T.T.E.R. owns
> **26–32** (seven suites). Vitest **36 files / 803 cases**. All four CI jobs
> green on `f2d82cc`, Playwright included. CLI linked to `wilson-dev`.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — the O.T.T.E.R. entry has a measured block
>    that contradicts its own one-line headline. Read the block, not the line.
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is the
>    authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S29 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`). ⚠️ The CLI actually
>    reads `supabase/.temp/project-ref` beside it; both exist and agree.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**And this brief is itself a claim about the code.** Every citation below was
re-verified on 2026-08-05, because the previous draft of this file had a wrong
path and a wrong central fact — both recorded in place so you can see the
shape of the error. **Re-verify before citing anything again.**

---

## 🚨 THE HEADLINE IS WRONG, AND THE MEASUREMENT IS DONE

`OUTSTANDING.md` has carried one line — *"validator findings and quiz scores
are not saved"* — since before S19. It is **three different defects**, and two
of them are not what it says.

**Sizing this as "add persistence for two things" would produce three wrong
guesses and probably a duplicate table.** Two of the three need no new table
at all.

---

### 1. Validator findings — genuinely nothing exists ✅ BUILD this

`auditResults` is React state (`Validator.jsx:121`, re-verified) and there is
no store for it on any backend, no adapter op, and no route. This half is
real.

> ⚠️ **THE PREVIOUS DRAFT OF THIS BRIEF HAD THE PATH WRONG.** It said
> `src/tools/otter_v0.3.1/components/Validator.jsx`. There is no `components/`
> in that path — the file is **`src/tools/otter_v0.3.1/Validator.jsx`**. A
> `Read` on the cited path errors outright, which is the lucky version; the
> unlucky version is a grep that quietly matches nothing and reads as "clean".

**Open questions that must be settled BEFORE any SQL — none is derivable:**
- **Is an audit run worth keeping at all, or only its accepted fixes?** The UI
  already tracks `acceptedFixes` / `declinedFixes` (`Validator.jsx:127-128`)
  as `Set`s, separately from the findings themselves.
- **Per user or per course?** A validator run is about the COURSE, but it was
  produced by a person. `otter_progress` is per-user; `otter_courses` is not.
- **Does a new run replace the last one, or append?**

→ **Ask Audrey.** The nearest precedent (`otter_progress`) is per-user and that
may well be the wrong shape here. S28's one gating question was asked rather
than assumed, and that is the reason its permission rule is right.

---

### 2. "Apply fix" — works in CLOUD, silently 404s on Local Server ⚠️ PARITY

Not a persistence gap, and the code already says so — `otterRoutes.js:162-165`,
quoted verbatim:

> *"Validator.jsx:441 issues a PUT here. No such Express route exists, so
> against the local server it has always been a silent 404 — the 'apply fix'
> button never persisted anything. Cloud mode treats it as the save it was
> clearly meant to be."*

⚠️ **THAT COMMENT'S OWN CITATION IS STALE, STILL, AND IT IS NOW TWO SESSIONS
OLD.** Re-verified 2026-08-05: the `otterFetch` call is at
**`Validator.jsx:444`** with `method: 'PUT'` on **`:445`**. Line 441 is inside
the guard above it. **Fix the comment while you are in there** — it has now
survived one session that noticed it and did nothing.

The URL is `/api/software/${softwareSlug}/subjects/${subjectSlug}`, and cloud
maps `PUT` → `subject.save` (`otterRoutes.js:166`).

So this is the opposite way round from the usual complaint: **cloud is the one
that works.** The fix is an Express route in `electron/main.cjs`, not a
migration.

🚨 **Confirm which backend Audrey saw it fail on before touching anything.**
If she was on the beta, this is not her bug and building the Express route
fixes nothing she has experienced.

---

### 3. Quiz scores — THE PATH IS BUILT AND THE WRITER HAS NO CALLER 🚨 WIRE this

Every hop re-measured 2026-08-05:

| hop | where | state |
|---|---|---|
| column | `otter_progress.quiz_attempts` (0022) | exists |
| adapter read | `supabaseOtterAdapter.js:404-409` `quiz.get` | exists |
| adapter write | `supabaseOtterAdapter.js:411-420` `quiz.put` | exists |
| route mapping | `otterRoutes.js:200-203` `/api/software/:slug/quiz-history` | exists |
| unit test | `otterRoutes.test.js:92-93` | **passes** |
| **a caller for `quiz.put`** | anywhere in `src/` | **ZERO** |

> 🚨 **CORRECTION TO THE PREVIOUS DRAFT, AND IT MATTERS.** That draft said
> `quiz-history` has "**no occurrences** outside the route table and its own
> test" and that the path has **zero** callers. **That is wrong.**
> `quiz.get` has exactly one caller: **`supabaseOtterAdapter.js:660`**, inside
> `export.all` — the admin data takeout.
>
> **The consequence is a defect nobody has written down.** The takeout reads
> `quizHistory` for every course and puts it in the export
> (`:653`, `:666`). Since nothing ever writes, **every data export WILSON has
> ever produced has carried an empty quiz history while presenting itself as
> complete.** That is a stronger statement than "a dead feature" and it should
> be in `OUTSTANDING.md` if S30 does not fix it.
>
> The accurate claim is: **`quiz.put` has no caller; `quiz.get` has one, and it
> is a reader that has only ever read nothing.**

**Where the wiring goes — measured, so you do not have to hunt:**

- `Otter.jsx:2110-2118` `nextQuestion` — `setQuizComplete(true)` at **`:2112`**
  is the single moment a quiz finishes. That is the write point.
- `Otter.jsx:125-126` — `quizScore` and `quizComplete` are React state and
  nothing else.
- `Otter.jsx:4720` `renderQuizResults` computes the percentage, and its **"Try
  Again" button at `:4726` zeroes the score**. So the result is destroyed by
  the most obvious next click.

🚨 **THREE TRAPS IN THE WRITE, all measured:**

1. **`quiz.put` is WHOLE-ARRAY REPLACEMENT** — `quiz_attempts: body?.attempts
   ?? []` (`:417`). Posting only the new attempt **erases every previous one**.
   The caller must read-modify-write: `quiz.get`, append, `quiz.put`.
2. **There is a 1 MiB CHECK on the column** —
   `otter_progress_quiz_sz_chk CHECK (pg_column_size(quiz_attempts) <=
   1048576)` (`0022:274`). An append-forever array eventually violates it and
   the write starts failing. Decide the retention rule (last N attempts? per
   course?) **before** writing the caller, not after someone hits it.
3. **`quiz.put` requires a signed-in user** and throws
   `OtterCloudError('not signed in', 401)` (`:413`). Whatever calls it needs a
   failure path that reaches the user — this is O.T.T.E.R., where a swallowed
   error is the house defect.

✅ **ONE THING THAT LOOKS LIKE A BUG AND IS NOT — do not "fix" it.**
`quiz.get` (`:406-407`) and `progress.get` (`:369-370`) both filter on
`course_id` alone with `.maybeSingle()`, with **no `user_id` filter**, even
though `otter_progress` is keyed `(course_id, user_id)`. That is safe:
`otter_progress_select` (`0022:607-612`) carries `AND user_id = auth.uid()`,
so RLS returns at most one row. Adding a redundant filter would be this
project's recurring mistake — a change that closes a documented-looking gap
and fixes nothing. **Verified, stated, leave it.**

> 🚨 **THIS IS THE THIRD INSTANCE OF THE SAME SHAPE.** The folder tree (S27)
> and task templates (S28) were both complete features with no caller. This one
> goes further: **a passing unit test covers the dead path.**
> `otterRoutes.test.js:92-93` asserts the route mapping and is green, and the
> mapping is correct — it is just that nothing ever calls the route.
>
> **Green tests are not evidence that anything runs.** S29 produced the sharpest
> version of this: its own guard test passed while the gate it guarded was
> stubbed out with `const canWrite = true`.

**DO THE CENSUS FIRST, before writing a line.** How many `otter_progress` rows
carry a non-empty `quiz_attempts`?

```sql
SELECT count(*) FILTER (WHERE quiz_attempts IS NOT NULL
                          AND jsonb_array_length(quiz_attempts) > 0) AS with_attempts,
       count(*) AS total
FROM public.otter_progress;
```

Zero across every environment confirms the diagnosis before any code. ⚠️ Run it
against **staging** as well as dev — staging is what the beta uses, and S23's
lesson is that measuring the wrong database gives a correct measurement and a
wrong conclusion. Use the throwaway `--workdir` trick rather than re-linking.

---

## ⛔ THE LOGOUT IS **NOT** IN THIS SESSION — and the reason is a real defect

**Both the S30 and the S31 drafts claimed it, and each told the other to check
first.** A circular deferral is how something gets built twice or never.
**Resolved 2026-08-05: logout belongs to S31**, which Audrey named "per-user
settings + pet + logout". It has been removed from here. Do not build it.

If you touch it anyway, know this much — it is **wiring, not building**:
`App.jsx:373-381` already defines `window.wilsonSignOut` (signs out of
Supabase, clears the session, resets auth state), and its own comment at
`:371-372` says *"Exposed on window for the next-session Settings panel to wire
up; doesn't affect the UI yet."* `SettingsPage.jsx` has zero occurrences of
`signOut`/`logout`, which is the true half of the `OUTSTANDING.md` entry.

---

## Traps specific to O.T.T.E.R.

- **O.T.T.E.R. has its OWN adapter** (`supabaseOtterAdapter.js`), not
  R.A.B.B.I.T.'s. `COLUMN_ALLOWLIST` and `toColumns` **do not apply here.**
  Check how this adapter guards writes before assuming either way.
- **`unwrap()` throws on error** — the O.T.T.E.R. adapter's errors surface as
  `OtterCloudError` with a status. Follow that convention.
- 🚨 **Read [[wilson_otter_cloud_traps]]** — eighteen measured Postgres /
  supabase-js / pgTAP failure modes that silently discard writes or make a
  passing suite lie. This is the session they were written for.
- **`otter_progress` is PER-USER by design** (`0022:246-249`): keying it to the
  course alone "would let two people studying one course clobber each other."
  Do not undo that when adding validator storage.

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it.
- 🚨 **NEVER pipe a file through PowerShell to rewrite it** — PS 5.1 reads
  BOM-less UTF-8 as ANSI and silently double-encodes. Use the Write tool, or a
  Node `.mjs` script with explicit `utf8` on read AND write.
- ⚠️ **PowerShell here-strings for commit messages are unreliable here.** S29
  had `git commit -m @'…'@` shred a message into pathspecs. **Write the message
  to a file and use `git commit -F`.**
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths; `docs/messed up handbook.pdf` stays untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **`supabase db query --file` returns only the LAST result set** — one query
  per file.
- ⚠️ **`supabase db query -o json` does NOT return `RAISE NOTICE`.** A `DO`
  block that logs with NOTICE returns `"rows": []`, indistinguishable from one
  that never ran. Write to a temp table and `SELECT` it.
- 💡 **To READ another environment without re-linking**, give `db query` a
  throwaway `--workdir` holding only a minimal `supabase/config.toml`
  (`project_id` and nothing else) plus `supabase/.temp/`.
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set.** `collected` MUST
  equal `planned`.
- 🚨 **Prove a new test by BREAKING it — including breakers you expect to
  PASS.** S29's most useful finding came from a breaker that did nothing, and
  a second one confirmed a real coverage limit rather than a defect.
- 🚨 **Playwright is the only CI job that proves the app RENDERS.** If it
  fails, check `document.getElementById('root').children.length` against the
  dev server — 17 descendants and a login screen is the known-good baseline.
- **`docs/SYSTEMS_HANDBOOK.md` §17 is a gate, not an oracle.** Nine sessions
  have now corrected its counts.

---

## Still open, and NOT this session's job

- ⚠️ **The runtime verification sweep is FIVE sessions old.** Three items in
  `OUTSTANDING.md`: both assignee dropdowns, cloud files end to end, and task
  templates carrying their roles. S29 sent Audrey a numbered checklist in its
  FIRST message (which is the approach that works) and the answers had not come
  back before commit. **Ask again at the start, specifically, naming the screen
  and the click.**
- **One hung `getSession()` pins the whole app's auth.** `withTimeout` races
  without aborting. Bounding N call sites fixes N UIs, not the app. **Design it
  before writing it.**
- **Avatar does not persist.** Four hypotheses falsified; failures are now
  loud. If it recurs, capture the message.

## Still owed by Audrey — blocking the v1.0.0 tag

1. **Rotate `smoke_admin`** — in the PUBLIC repo's git history. The one open
   CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key.** That command
   returns all keys as ONE JSON line — never filter it, select the one field.
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged.** Ask before tagging, and ask
   **again** before merging to `main`.

---

## Close-out ritual

1. Apply migrations to **dev** (if any), verify **by query**, run `tap-all`.
2. Feature commit(s).
3. Apply to **staging**, then **prod** — dry-run each, verify each **by query**.
   ⚠️ **Staging goes BEFORE the push**: this branch auto-deploys the
   staging-backed beta.
4. Push → **CI green on all four jobs** (a skip is not green).
5. Re-link the CLI to `wilson-dev`.
6. Write `SESSION_31_prompt.md` if it needs revising → update the plan
   documents → update `docs/SYSTEMS_HANDBOOK.md` if behaviour changed →
   **update `docs/OUTSTANDING.md`** → update the Claude auto-memory → docs
   commit + push.

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY. Say plainly what is fixed,
>    what is only diagnosed, and what she needs to do herself.
