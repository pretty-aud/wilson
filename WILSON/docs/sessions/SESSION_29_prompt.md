# SESSION 29 launch prompt — THE TIMELINE PERMISSION GATE, and the verification sweep

> **STATE AFTER S28 (2026-08-04, `06bf564` feature + `0b7bfdc` docs), so you do
> not re-measure it:** migrations run **0000–0044** on dev, staging and prod
> (next free number is **0045**); pgTAP is **54 suites / 832 assertions**;
> vitest is **35 files / 698 cases**. All four CI jobs green, Playwright
> included. Task templates work in cloud.
>
> ⚠️ **THE SESSION SEQUENCE CHANGED (Audrey, 2026-08-04):** *"parse them out
> into one session for timeline, one for otter, then settings."* So: **S29**
> this, **S30** O.T.T.E.R. persistence, **S31** per-user settings + pet +
> logout, **S32** the design pass (whose brief already exists and was written
> when it was S29 — read its header).

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — the `canWrite` entry has a new block at
>    the top that supersedes the historical analysis beneath it
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S28 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`). ⚠️ The CLI actually
>    reads `supabase/.temp/project-ref` beside it; both exist and agree.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**This session exists because that rule finally paid off on a four-session
investigation — and the answer was that nothing was broken where everyone was
looking.**

---

## ✅ WHAT WAS SETTLED, so you do not re-investigate it

The "New task button disappears" mystery ran from S23 to S28. Audrey supplied
the runtime observation on 2026-08-04 and it resolved:

> *"its not showing for tester who is not a manager or reviewer. but they can
> still see it in the timeline view."*

**MEASURED against staging** (the beta's backend), every seat on the only live
project — `Legend Road`, staffed with 3 roster rows:

| user | workspace role | project seat | DB allows task insert |
|---|---|---|---|
| `audrey` | admin | manager | **YES** — two independent routes |
| `audrey2` | user | reviewer | no |
| `derek` | manager | member | YES |
| `hello` | manager | *none* | YES (workspace bypass) |
| **`tester`** | **user** | ***none*** | **no** |

**So the missing button is the gate WORKING CORRECTLY.** `tester` holds no seat
on a staffed project and is not a workspace admin or manager, so
`can_write_project` is false — at the database and in the client mirror. Tasks
and Board hide the control because the database would refuse it.

**The original sighting is separately closed as not-worth-chasing:** `audrey`
has two independent routes to true, so no evaluation of the gate can hide the
button for her. Either that sighting was the other browser, or it was never the
gate. If it recurs, capture the browser AND the account **at that moment** —
and never ask "which account are you on" in general.

---

## S29 — the actual defect, which is the INVERSE one

🚨 **`TimelineView.jsx` has ZERO occurrences of `canWrite`, `canOnProject` or
`usePermissions`.** MEASURED 2026-08-04: it is the **only task-creating surface
in R.A.B.B.I.T. with no permission gate at all**. Seven other files carry one
(`ProjectAssetsView`, `ProjectSummaryView`, `Rabbit.jsx`, `ProjectTasksView`,
`TeamView`, `TaskDetailPopup`, `EditHistoryDrawer`); Timeline does not.

So the Timeline offers task creation to a user the database will always refuse,
and the refusal reaches them as a raw Postgres string. Audrey's screenshot:

```
[supabase] new row violates row-level security policy for table "tasks"
```

`tasks_insert` (0013) requires `can_write_project(project_id)`. Nothing is
wrong with the policy. The UI simply never asked.

### 🚨 THIS IS NOT A ONE-LINE FIX — size it properly

The Timeline has **at least a dozen** create entry points, all funnelling
through `openNewTask` (`:259`). Verified by grep 2026-08-04 — **re-verify these
numbers before citing them, this file is 6500+ lines and S28's own brief was
burned by a stale citation**:

| entry point | line |
|---|---|
| toolbar `onNewTask` | `:4677` (wired at `:653`) |
| phase drop-zone "New task…" | `:2173` |
| in-row `+ New task` drop zone | `:2531` |
| drag-to-draw on empty space | see the file header, `:27` |
| `onNewTaskInPhase` handler | `:746` |
| context-menu `+ New task` items | `:5826`–`:6440`, many |
| the write itself | `:3811` `await ctx.addTask(payload)` |

🚨 **Gating ONLY the funnel is the wrong fix and is actively harmful.** Every
affordance would stay visible and do nothing — which is precisely the S23 "the
button does nothing" defect that cost hours to diagnose. **The funnel and the
affordances have to move together.**

### ✅ THE DESIGN QUESTION IS ANSWERED — do not re-ask it

`OUTSTANDING.md` carried this note from S23 and nobody had decided it:

> *the UX is wrong either way — a reviewer should be told why they cannot add,
> not have the control silently disappear.*

**Audrey decided, 2026-08-04: "keep button gray and explain why."**

So the target is **NOT** what the other four views currently do. The control
**stays visible, rendered disabled/grey, and says why** — on the Timeline and
everywhere else.

🚨 **THAT MAKES THIS BIGGER THAN THE TIMELINE, AND THE SCOPE MUST BE FACED
RATHER THAN DISCOVERED HALFWAY.** `ProjectTasksView`, `ProjectAssetsView` and
the Board **hide** their create controls today — six surfaces off one
`canWrite` flag. If only the Timeline greys out, the app contradicts itself
screen by screen, which is worse than either rule applied consistently.

→ **Build ONE shared treatment and apply it to every gated create affordance**,
Timeline included. That is the coherent version of what she asked for, and it
retires the S23 note instead of moving it. If the session runs out of room,
finish the Timeline and say explicitly which surfaces still hide — do not leave
it implied.

**Implementation traps for a disabled control:**

- A `disabled` button does **not** reliably fire mouse events, so a bare
  `title=` tooltip may never appear. Wrap it, or use the same hover/tooltip
  mechanism the codebase already uses elsewhere — check before inventing one.
- Grey must not read as "loading". `canOnProject` deliberately returns **true**
  while permissions resolve (see below), so a control should never be grey
  merely because the session has not settled.
- The reason text should name the actual rule ("only project managers and
  members can add tasks"), not a generic "no permission" — the whole point of
  her decision is that the user learns something.

### What the gate must be

`canOnProject({ appRole, projectRole, isStaffed, ready }, 'project.entity.write')`
— identical to `ProjectTasksView.jsx:211-219`. **Do not invent a new action.**

🚨 **`ready` is load-bearing and must be passed.** `canOnProject` returns
**true** while permissions are still loading (`projectRoleMatrix.js:132`), on
purpose: a control that vanishes is indistinguishable from a real denial, and
if `getSession()` never settles it vanishes permanently for someone fully
authorised. Omitting `ready` defaults it to `true`, which quietly turns
"loading" into "denied" — the exact S23 bug.

### Coverage

There is **no vitest that mounts any of this** and there cannot be — nothing in
the suite mounts React. So the honest options are a source-level guard in the
shape of `taskPayloadKeys.test.js` (assert `TimelineView.jsx` references the
gate at all, which at least fails if someone deletes it) plus **watching it in
the running app as two different users**. Say which you did.

---

## 🚨 THE VERIFICATION SWEEP — inherited, and now four sessions old

S25, S26, S27 and S28 were each asked and none could: nothing in this repo
automates a signed-in session against staging. **Ask at the START, with a
checklist naming the screen, the click and what a pass looks like** — that
change of approach is what finally produced the `tester` observation above.

1. **The two assignee dropdowns.** Timeline → open a task → Assignee; then
   Assets → open an asset → its task rows. **Grep `teamAssignments`; do not
   trust a line number.**
2. **Files in cloud — all of S27 is unobserved.** Upload a file to an asset;
   it should appear, download, and show in Resources → Projects → that project.
   Change a project rate and confirm a `FINANCE/RATES.json` object appears.
3. **Task templates — all of S28 is unobserved in the UI.** Settings →
   R.A.B.B.I.T. → Manage Task Templates → create one → apply it to an asset →
   **confirm the created tasks carry their roles.** The database chain is
   proven (`scripts/probes/task-templates-e2e.sql`, 6/6 on dev and staging);
   the React path is not.

---

## Carried, and NOT to be guessed at

- **O.T.T.E.R. persistence — S30.** ⚠️ Read `OUTSTANDING.md`'s entry in full
  first: it is **three different defects**, and two are not what the headline
  says. Quiz scores have a complete storage path with **no caller**; "apply
  fix" works in cloud and 404s on Local Server; only the validator findings
  genuinely need building.
- **Per-user settings + pet + logout — S31.** Audrey settled the scope on
  2026-08-04: **one pet and one set of settings per person, everywhere**, not
  per workspace.
- **One hung `getSession()` pins the whole app's auth.** `withTimeout` races
  without aborting. Bounding N call sites fixes N UIs, not the app. **Design it
  before writing it.**
- **Avatar does not persist.** Four hypotheses falsified; failures are now
  loud. If it recurs, capture the message.

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it.
- 🚨 **NEVER pipe a file through PowerShell to rewrite it.** PS 5.1 reads
  BOM-less UTF-8 as ANSI and silently double-encodes — S28 did this to its own
  probe script and mangled every box-drawing character in one command. Use the
  Write tool for anything another program parses.
- 💡 **To READ another environment without re-linking**, give `db query` a
  throwaway `--workdir` holding only a minimal `supabase/config.toml`
  (`project_id = "..."` and nothing else — the repo's real one references auth
  email templates that will not exist there) plus `supabase/.temp/`. S28 used
  this to query staging while the repo stayed linked to dev; verified the repo
  link was untouched afterwards.
- ⚠️ **`supabase db query -o json` does NOT return `RAISE NOTICE` output.** A
  `DO` block that logs with NOTICE returns `"rows": []` — indistinguishable
  from one that never ran. Write to a temp table and `SELECT` it, and `GRANT`
  on that table if the block drops to `authenticated`.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **`supabase db query --file` returns only the LAST result set.**
- **A migration's text does not tell you the database's state.** Query it.
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set.** `collected` MUST
  equal `planned`.
- 🚨 **Prove a new test by BREAKING it — including breakers you expect to
  PASS.** Two of S28's six did not fire and both corrected a **comment** rather
  than the code. Omitting `WITH CHECK` from an UPDATE policy changes nothing
  (Postgres reuses `USING` as the new-row check); the hazard is a `WITH CHECK`
  *weaker* than its `USING`.
- 🚨 **THREE GREEN CI JOBS CAN MEAN NOTHING. Playwright is the only one that
  proves the app RENDERS**, and **a passing unit test can cover a code path
  nothing ever calls** — `otterRoutes.test.js` does exactly that for quiz
  history. If Playwright fails, check
  `document.getElementById('root').children.length` against the dev server.
- **`docs/SYSTEMS_HANDBOOK.md` §17 is a gate, not an oracle.** Eight sessions
  have corrected it.

---

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
6. Write `SESSION_30_prompt.md` if it needs revising → update the plan
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
