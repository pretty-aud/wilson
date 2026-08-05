# SESSION 30 launch prompt — O.T.T.E.R. KEEPS ITS WORK

> **Scheduled by Audrey on 2026-08-04** (*"lets make a new session for this"*),
> after S28's close-out named it the largest genuinely broken thing left.
>
> **STATE AFTER S29 (2026-08-05, `7443fed`) — updated, do not re-measure it:**
> migrations **0000–0044** on all three envs, next free **0045** (S29 added no
> SQL — the schema was already right; the client simply never asked). pgTAP is
> unchanged at **54 suites / 832 assertions**. Vitest is now **36 files / 803
> cases**. All four CI jobs green.
>
> ⚠️ **Two things S29 learned that apply directly here.** First, `ready` was
> missing from three permission gates that all *looked* correct — if you add a
> gate to any O.T.T.E.R. surface, `writeGate.test.js` will fail unless you pass
> it. Second, and more relevant: S29's own guard test PASSED while the gate was
> stubbed out with `const canWrite = true`. **Prove your test by breaking it,
> including the breakers you expect to pass** — one of S29's four real findings
> came from a breaker that did nothing.

> Paste into a new Claude Code conversation. **Start from `WILSON/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — the O.T.T.E.R. entry has a measured block
>    that contradicts its own headline. Read it before planning anything.
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md`
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**

---

## 🚨 THE HEADLINE IS WRONG AND THE MEASUREMENT IS ALREADY DONE

`OUTSTANDING.md` has carried one line — *"validator findings and quiz scores
are not saved"* — since before S19. It is **three different defects**, and two
of them are not what it says. All of this was MEASURED on 2026-08-04 by
grepping for the writer and then asking whether anything calls it.

**Sizing this as "add persistence for two things" would produce three wrong
guesses and probably a duplicate table.**

### 1. Validator findings — genuinely nothing exists ✅ build this

`auditResults` is React state (`Validator.jsx:121`) and there is no store for
it on any backend, no adapter op, and no route. This half is real.

Open questions that must be settled BEFORE any SQL — none is derivable:
- **Is an audit run worth keeping at all, or only its accepted fixes?** The UI
  already tracks `acceptedFixes` / `declinedFixes` (`Validator.jsx:127-128`)
  separately from the findings.
- **Per user or per course?** A validator run is about the COURSE, but it was
  produced by a person. `otter_progress` is per-user; `otter_courses` is not.
- **Does a new run replace the last one or append?**

→ **Ask Audrey.** The nearest precedent (`otter_progress`) is per-user and that
may well be wrong here.

### 2. "Apply fix" — works in CLOUD, silently 404s on Local Server ⚠️ parity

Not a persistence gap. The code already says so, `otterRoutes.js:162-165`:

> *"Validator.jsx:441 issues a PUT here. No such Express route exists, so
> against the local server it has always been a silent 404 — the 'apply fix'
> button never persisted anything. Cloud mode treats it as the save it was
> clearly meant to be."*

⚠️ **THAT COMMENT'S OWN CITATION IS STALE — verified 2026-08-04.** The PUT is
at **`Validator.jsx:444`**, not `:441`; line 441 is the `}` closing the
`if (!applied)` guard above it. Three lines, and it is the fifth instance of
this project's citation decay. The URL it posts to is
`/api/software/${softwareSlug}/subjects/${subjectSlug}`. **Re-verify before
citing it again, and fix the comment while you are there.**

So this is the opposite way round from the usual complaint: **cloud is the one
that works.** The fix is an Express route in `electron/main.cjs`, not a
migration. 🚨 **Confirm which backend Audrey saw it fail on before touching
anything** — if she was on the beta, this is not her bug.

### 3. Quiz scores — THE ENTIRE PATH IS BUILT AND NOTHING CALLS IT 🚨 wire this

MEASURED, every hop:

| hop | where | state |
|---|---|---|
| column | `otter_progress.quiz_attempts` | exists |
| adapter read/write | `supabaseOtterAdapter.js:404-420` (`quiz.get`/`quiz.put`) | exist |
| route mapping | `otterRoutes.js:200-203`, `/api/software/:slug/quiz-history` | exists |
| unit test | `otterRoutes.test.js:92-93` | **passes** |
| **a caller** | anywhere in `src/` | **ZERO** |

`quiz-history` has **no occurrences** outside the route table and its own test.
The quiz UI never writes. **The fix is wiring, not building** — and adding a
table here would be the duplicate this brief exists to prevent.

> 🚨 **THIS IS THE THIRD INSTANCE OF THE SAME SHAPE.** The folder tree (S27)
> and task templates (S28) were both complete features with no caller. This one
> goes further: **a passing unit test covers the dead path.** Green tests are
> not evidence that anything runs. The check that distinguishes "built" from
> "working" is a census — `SELECT count(*)` in the environment the user is in —
> and for a wiring job, watching it happen in the app.
>
> **Do that census FIRST:** how many `otter_progress` rows carry a non-empty
> `quiz_attempts` on staging? If the answer is zero across every environment,
> you have confirmed the diagnosis before writing a line.

---

## Also in this session — and it is small

**There is no way to log out.** MEASURED 2026-08-04: `SettingsPage.jsx` has
**zero** occurrences of `signOut`, `logout` or `log out`. Audrey asked for a
sign-out control in System Settings.

⚠️ It is listed here rather than in S31 only if S29/S30 have room — it belongs
with the settings work either way. **Check whether S31 already took it** before
building it twice. And note `supabaseClient.js:44` uses **different session
storage keys per surface** (`sb-wilson-operator` vs `sb-wilson-app`), so
"log out" must be explicit about which session it ends.

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it.
- 🚨 **NEVER pipe a file through PowerShell to rewrite it** — PS 5.1 reads
  BOM-less UTF-8 as ANSI and silently double-encodes. Use the Write tool.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths; `docs/messed up handbook.pdf` stays untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **`supabase db query --file` returns only the LAST result set.**
- ⚠️ **`supabase db query -o json` does NOT return `RAISE NOTICE`.** Write to a
  temp table and SELECT it.
- 💡 **To READ another environment without re-linking**, use a throwaway
  `--workdir` with a minimal `config.toml` (`project_id` only) plus
  `supabase/.temp/`.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist** — but note
  O.T.T.E.R. uses its own adapter (`supabaseOtterAdapter.js`), NOT R.A.B.B.I.T.'s,
  so `COLUMN_ALLOWLIST` does not apply here. Check how that adapter guards
  writes before assuming either way.
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set.** `collected` MUST
  equal `planned`. O.T.T.E.R. already owns suites 26–32.
- 🚨 **Prove a new suite by BREAKING it**, including breakers you expect to
  pass.
- 🚨 **Playwright is the only CI job that proves the app RENDERS**, and a
  passing unit test can cover a path nothing calls — this session has the
  proof of that.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.**

---

## Close-out ritual

1. Apply migrations to **dev**, verify **by query**, run `tap-all`.
2. Feature commit(s).
3. Apply to **staging**, then **prod** — dry-run and verify each **by query**.
   ⚠️ **Staging BEFORE the push.**
4. Push → **CI green on all four jobs.**
5. Re-link the CLI to `wilson-dev`.
6. Write the next brief → update the plan documents → the handbook if
   behaviour changed → **`docs/OUTSTANDING.md`** → the Claude auto-memory →
   docs commit + push.

> **THEN, FINALLY, IN THE CHAT:** the remaining-session list, and a layman's
> breakdown in plain English — no jargon, no table names, no migration numbers,
> no file paths. What CHANGED FOR AUDREY, and what she still has to do herself.
