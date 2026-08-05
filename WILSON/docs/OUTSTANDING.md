# Outstanding problems

Everything currently known to be **broken and not yet fixed**. Live document —
updated at the end of every session.

## The rule for this file

**Only add something if it is broken and unfixed.** Not "could be improved",
not "worth watching", not "we should probably". If it is fixed in the same
session it is not an entry, it is a commit message.

Three things follow from that:

- **An empty session adds nothing.** A session that fixes things and breaks
  nothing leaves this file untouched. That is a good outcome, not a gap to
  fill. Padding it with hedges makes the real entries harder to see, and a list
  nobody trusts is a list nobody reads.
- **Delete entries when they are fixed.** Cite the commit in the session
  close-out, then remove the entry. This file is the present state, not a
  history — `git log` is the history.
- **Say how you know.** Every entry is tagged, because the difference decides
  whether the next session starts by fixing or by diagnosing:
  - **MEASURED** — observed failing. Says what was run and what came back.
  - **REPORTED** — Audrey hit it; not yet reproduced or diagnosed.
  - **INFERRED** — code reading says it must break, not yet seen failing.
    Names what would settle it.

Anything that is merely unverified, interim, or planned belongs in
`MASTER_PLAN_S19_ONWARD.md`, not here.

---

## 🚨 Security — blocks the v1.0.0 tag

### `smoke_admin` password is in public git history
**MEASURED.** The repo `pretty-aud/wilson` is public and the password was
committed. Rotating the account does not remove it from history.
→ `OWED_AUDREY.md` §0, TPN-SDLC-007. **Audrey's action.**

### `wilson-staging` legacy `service_role` key was exposed
**MEASURED.** S19 (2026-08-02): `supabase projects api-keys` returns every key
in a single JSON line, and a `grep -v service_role` filter that assumed
line-per-key printed all of them into a session transcript. The key bypasses
RLS.
→ Rotate: dashboard → wilson-staging → Settings → API → Legacy API keys → roll
`service_role`. The `anon` key beside it is publishable and needs nothing.
**Audrey's action.** Never filter that command's output; select the one field.

---

## Broken features

### ~~The budget system does not exist in the cloud schema~~ — FIXED (S24, `b07b6c9`)
Deleted per the rule for this file. Migrations 0036 + 0037 applied and verified
**by query** on dev, staging and prod: nine budget settings on `projects`,
`project_members.project_title`, and five money tables (`budget_lines`,
`budget_actuals`, `budget_versions`, `expenses`, `project_rate_overrides`) with
manager-only RLS. The adapter gained the fifteen budget methods it never had.

**Three residues are NOT fixed and are recorded separately below**: the four
scene/shot/level/experience budget tabs, the Client View's `project.name` /
`project.code`, and the absent client-side gate.

The lesson worth carrying: **the plan documents named the wrong columns.** Both
`MASTER_PLAN_S19_ONWARD.md` and `SESSION_24_prompt.md` said the gap was
`margin` and `contingency`. The UI reads `budget_margin_pct` and
`budget_contingency_pct`, plus seven more. Adding `projects.margin` would have
closed the documented gap, satisfied review, and left Audrey's reported bug
100% intact. The columns were derived from a grep of the views instead.

Second lesson: **the React was already finished.** The whole budget — bid,
actuals grid, versions, per-line margin with project-default inheritance, the
client topsheet — was written and had been sitting there unable to persist
anything. The session was scoped as "build the budget" and was actually "give
the finished budget a database". Reading the UI before designing the schema is
what turned a guess into a measurement.

### ~~Four budget tabs can never render in cloud~~ — FIXED (S25, `183b4c2`)
Deleted per the rule for this file. Migration 0040 adds `scenes_enabled`,
`levels_enabled` and `experiences_enabled` (with the entities, not before
them), applied and verified **by query** on dev, staging and prod. The four
tabs appear once the matching toggle is on.

### ~~Client View prints "Project" and "--"~~ — FIXED (S25, `183b4c2`)
**And the fix was NOT the one both plan documents specified**, which is the
part worth keeping. They said to add a `projects.code` column. MEASURED:
nothing in `src/` or `electron/` has ever *written* a bare `code` key on a
project — the only writer is `ProjectSummaryView.jsx:605`,
`update('project_code', v)`. `project.code` was a **wrong read**, exactly like
`project.name` (the column is `title`), not a missing column.

Adding `code` would have closed the documented gap, passed review, and left
the topsheet printing `--` forever. pgTAP `48_scenes` probe 18 now asserts
`projects.code` does **not** exist, so the next attempt to "close the gap"
fails instead of shipping. Third repetition of the S24 `margin` lesson.

### ~~The budget UI has no client-side permission gate~~ — FIXED (S24, `dfdf386`)
The Budget tab is now hidden from anyone who is not a workspace admin or a
manager on that project, via `canSeeProjectMoney()` — the client mirror of
`can_access_project_money()`. It fails CLOSED, so the tab **appears** a beat
late for a project manager rather than being shown to a reviewer and snatched
back; `Rabbit.jsx` also redirects to Summary if a hidden tab is somehow open.

**The project control panel gate is now DONE too (S25, `ccb90e7`).** Both
questions the S25 brief said had to be answered first were — and neither
answer was the expected one:

- **Which screen?** Not a judgement call at all: `ProjectSummaryView.jsx:166`
  renders a header literally reading **"Project Control Panel"**. Asking
  Audrey which screen she meant would have been the S24 mistake (four of nine
  "questions for Audrey" were answerable from the code).
- **Which rule?** **Its own** — and emphatically not the money rule. Audrey,
  2026-08-04: *"managers and reviewers should be able to see and press the
  button and open the control panel, the budget block is managers only. basic
  team members do not need access to the panel at all."*

🚨 **`project.settings.open` is the ONLY action where a reviewer outranks a
member.** `project.entity.write` is the exact inverse on those two seats, and
`canSeeProjectMoney` admits neither — so every existing gate was wrong here in
a way that would have passed review. Gated in **two** places (the button and
the render branch), because `setShowSettings(true)` has a second caller
(`:124`, straight after creating a project) and she asked for no access rather
than a missing link. The unstaffed opening is load-bearing: a new project has
no members yet, so without it creating a project would lock you out of
configuring it.

### ~~Crew and Talent invoice folders are desktop-only~~ — FIXED (S24, `dfdf386`)
Both tabs now attach invoices through `InvoiceAttachment`, which picks with a
plain `<input type="file">` (Electron's renderer is Chromium, so the desktop
bridge was never needed to choose a file) and stores through the adapter's
`uploadFile`. Works on the web, in the desktop app, on Supabase and on Local
Server. Migration 0038 keeps invoices manager-only at BOTH layers — the
`files.is_financial` row flag and the reserved `invoices` storage path — because
the obvious implementation would have let any project member download the
invoice PDF, which is the amount they had just been denied. pgTAP `05_files`
covers it (5 → 9 assertions).

**No legacy invoice attachments exist — MEASURED, not assumed (2026-08-04).**
Queried all three environments (`budget_actuals` rows carrying an
`attachment_path` that is not a `file:` reference: **0**, on dev, staging and
prod — the table was created hours earlier by 0037) and every local project
bundle on this machine (four projects including LEGEND ROAD: **0** budget
actuals of any kind). Attaching never worked on the web, so nothing was ever
stranded on one computer.

The `InvoiceAttachment` component still handles a legacy absolute path, and
`resolveFileBaseDir` still falls back to the old directory — both are correct
if such a file ever turns up, and cost nothing. But this was briefly written up
as a caveat for Audrey, which it is not: **the population is empty.** Recorded
here so nobody re-adds it as a known limitation without querying first.

### ~~Task templates do not exist in cloud mode~~ — FIXED (S28, `06bf564`)
Deleted per the rule for this file. Migration 0044 creates `public.task_templates`
(RLS enabled and forced, four policies, no `FOR ALL` arm, zero privileges held
by `anon` or `PUBLIC`) plus `assets.task_template_id`, applied and verified **by
query** on dev, staging and prod. `supabaseAdapter` gained the five methods it
never had; pgTAP `54_task_templates` is 24 assertions, proven by six deliberate
breakers.

**Audrey settled the permission question (2026-08-04)** — the thing this entry
said had to be settled before any SQL was written: *workspace admins and
managers globally, project managers additionally for templates pinned to their
own project.* One definition, `can_write_task_template(uuid)`, mirrored on the
client by `canWriteTaskTemplate()`.

Three things worth keeping:

- 🚨 **The feature had never produced a row on ANY backend.** MEASURED before
  anything was written: `%APPDATA%\wilson\rabbit-data\task-templates\` exists
  and is **empty**, so there were zero templates on Local Server too, where it
  has worked the whole time. The S27 lesson applied *before* the fact rather
  than after it — creating the table would have made every test pass and
  changed nothing on screen. `scripts/probes/task-templates-e2e.sql` is the
  answer: it walks create → project read → asset stamped → template applied →
  **roles present** → template deleted without taking the asset, as an
  authenticated user against real rows, and rolls back. 6/6 on dev and staging.
- 🚨 **The `role_slug` bug was real and is fixed at both sites**
  (`ProjectAssetsView.jsx:1427` and `:1730`, re-verified by grep this session).
  The probe's breaker — omit the key, exactly as `toColumns` did — reports
  `roles were [<NULL>, <NULL>]`, which is what shipped. `taskPayloadKeys.test.js`
  now guards the CALL SITE, which the allowlist tests cannot: they pin
  `toColumns`, so reverting the view left them green.
- **`assets.task_template_id` arrives here, and that is the `files_dir` rule
  being FOLLOWED.** "A column for a feature with no cloud implementation is
  schema debt" was always "it arrives WITH the feature". Both writers became
  reachable in the same commit. `files_dir` stays out, because its writer still
  cannot run on this backend.

**The tenancy leak was not ported.** The local `GET /projects/:id/task-templates`
filters on `project_id` alone and would return another workspace's global
templates. The cloud adapter runs the same filter and RLS supplies the
workspace scope the route omits — pinned by suite 54 probes 8-9, which carry a
**presence control** so "sees nothing" cannot pass on an empty table.

### ~~R.A.B.B.I.T. item creation fails in cloud mode~~ — FIXED (S23, `2727328`)
Deleted per the rule for this file. Migrations 0034 + 0035 and the adapter
column allowlist; proven by re-running the original probe, where the exact
payload that returned `23502` now SUCCEEDS on staging. Detail is in the commit
and the session log below.

<!-- removed: the original entry's evidence now lives in 2727328's message

Inserting the exact payload the UI sends, as an authenticated admin member of
the fixture workspace, via `tests.rls_setup()` + real JWT claims:

```
23502: null value in column "asset_id" of relation "tasks"
       violates not-null constraint
```

The chain, every hop read:
- `ProjectTasksView.jsx:406` `handleAddTask` sends `{title, status, priority}`.
  The toolbar button (`:635`) passes no defaults; the Board's inline add
  (`:1582-1594`) only sets `asset_id` when `kanbanGroup === 'asset'`, and the
  default group is `'status'`.
- `RabbitProvider.jsx:1577` adds `id`/`project_id`/`status`/`priority` — still
  no `asset_id`.
- `0000_rabbit_base_schema.sql:178` — `asset_id uuid not null references
  assets(id)`. No migration ever relaxed it. Contrast `workspace_id`, which
  IS auto-stamped by `trg_tasks_populate_workspace` (`0004:161-164`) — which
  is why adding `workspace_id` by hand changes nothing (measured, case B).
- `supabaseAdapter.js:83` `unwrap` throws; `RabbitProvider.jsx:1584` awaits
  the adapter **before** `setBundle` at `:1587`, so no row is ever added to
  state and there is no optimistic row to flicker.
- `ProjectTasksView.jsx:406` has no `try/catch` and the `onClick` arrow drops
  the rejected promise. No `unhandledrejection` handler exists anywhere in
  `src/` or `electron/`. **Net effect on screen: nothing at all.**

So "the button does nothing" is literal. And in Board view what *vanishes* is
the typed text, not a rendered card — `commitAdd` clears the input
unconditionally before the write resolves. The optimistic-insert theory in the
old plan doc is **refuted**: there is no optimistic state on this path.

Cloud-mode only. The local Express route (`main.cjs:1090-1098`) writes
`req.body` into a JSON bundle with no column check, so the same click succeeds
on Local Server. **Cheap falsifying test before anyone edits code:** switch
R.A.B.B.I.T. to Local Server and click New task. Works locally + dead in cloud
confirms this; dead in both refutes it. (The web build forces `supabase`, so
the beta always takes the failing path.)

→ **Not fixed here — deliberately.** The obvious fix is wrong on its own:
`0014_soft_delete.sql:238` makes `tasks_select` require
`EXISTS (SELECT 1 FROM assets a WHERE a.id = tasks.asset_id)`, so a task with
a NULL `asset_id` fails its own SELECT policy and `.single()` returns PGRST116.
Making the column nullable would **move** the failure, not remove it. Both must
change together, and whether a task may exist without an asset is a product
decision, not a schema detail. Also worth knowing: there is **no automated
coverage of task creation at any layer** — no vitest, no pgTAP. That is why a
total failure shipped unnoticed. → S24.
-->

**Partly closed by S25 (`183b4c2`), and worth stating precisely.** There is
now creation coverage for the FOUR NEW entity tables — pgTAP 48-51 exercise
the real create payloads, and `columnAllowlist.test.js` imports the actual
`COLUMN_ALLOWLIST` (rather than mirroring it, as the older adapter tests do)
so a missing entry fails a test instead of a runtime request.
`supabaseLoadProject.test.js` closes the matching read-side gap: the existing
bundle-key guard only ever covered the LOCAL adapter, which is why S24's
permanently-empty `budgetVersions` was found by reading rather than by a test.

**Still uncovered: `tasks` and `assets` creation itself** — the two payloads
that actually broke in S23 have no vitest around them and no pgTAP insert
probe. The allowlist test covers the mechanism; it does not cover those two
tables' own payloads. That is the remaining half.

### Two of the four assignee dropdowns are hard-empty in cloud mode
**MEASURED (S23).** Upgraded from the S22 entry, which reasoned from **dev**
where `project_members` is empty. On **staging** — Audrey's actual environment
— it has 3 rows, so the *staffed* branch runs, not the fallback. The S22
conclusion was measured against the wrong database.

- ~~`TimelineView.jsx:4228` (task editor) and `ProjectAssetsView.jsx:2108`
  (asset-detail task rows) are unconditionally empty in cloud~~ — **the stated
  cause is REMOVED (S24, `b07b6c9`).** Both early-returned because
  `adapter.listTeamMembers` existed only on `localServerAdapter`; the Supabase
  adapter now implements it over the existing `workspace_directory()` RPC, and
  `loadProject` now returns `teamAssignments` from `project_members` (it was
  omitting the key, and the provider's
  `setBundle({ ...EMPTY_BUNDLE, ...next })` reset it to `[]` on every load).
  ⚠️ **This is CODE-level, not observed. STILL NOT OBSERVED after S25.** The
  adapter method exists and is built; nobody has watched these two dropdowns
  populate in the running app. S25 was asked to confirm this at runtime and
  **did not** — reaching those dropdowns needs a signed-in session against
  staging with a staffed project, which no automated check in this repo
  performs. Recorded as still-unverified rather than quietly closed: the fix
  was a by-product of the budget work (the Crew/Team tab needs the same
  roster), not a targeted repair, and an unwatched fix is not a fix.
  → **One look at the Timeline task editor on the beta settles it.**
- `ProjectTasksView`'s dropdown is on the healthy `workspace_directory()` path
  and intersects correctly — but if the roster ever resolves to `[]`, the
  staffed branch filters an empty list and yields `[]` too, and
  `useRosterMembers` **drops the error** rather than passing it through, so an
  RPC failure and a genuinely empty workspace are indistinguishable at every
  call site.

→ Roster-error surfacing is still owed: `useRosterMembers` swallowing the error
means a broken RPC and an empty workspace look identical everywhere. S25.

### ~~Scenes / levels / experiences are unavailable on cloud projects~~ — FIXED (S25, `183b4c2`)
Deleted per the rule for this file. Migration 0040 creates `scenes`, `shots`,
`levels` and `experiences` with RLS enabled and forced, sixteen policies, no
`FOR ALL` arm and zero privileges held by `anon` or `PUBLIC` — applied and
verified **by query** on dev, staging and prod. `supabaseAdapter` gained the
four list methods it never had and real implementations for the eight methods
that threw. Naming moved to `entityNaming.js` so both adapters name
identically.

They use `can_write_project`, **not** `can_access_project_money`: scenes are
ordinary project content and a team member must be able to create one.
Borrowing the money gate would have locked the feature to managers and nobody
would have noticed until someone tried to add a scene. pgTAP `48_scenes`
asserts a project member CAN write and a reviewer can read but not write.

### One hung `getSession()` pins the whole app's auth, and `withTimeout` cannot unpin it
**MEASURED (S21, against `@supabase/auth-js` 2.101.1 as installed.)** This
replaces the old "Profile panel can spin forever" entry, which framed the
problem as N independent call sites. It is not.

Two facts, both read out of `node_modules`:

1. **The class is far larger than the explicit call sites.** supabase-js binds
   `_getAccessToken()` into `fetchWithAuth` for *every* PostgREST, Storage and
   Functions request, and that awaits `auth.getSession()` internally
   (`supabase-js/dist/index.mjs:523-528`). So every `.from(...)` carries the
   same unbounded wait. Counting `.auth.getSession()` occurrences understates
   it by an order of magnitude.
2. **`withTimeout` races, it does not abort** — by design
   (`withTimeout.js:16-19`). The abandoned call still holds `lockAcquired` in
   auth-js, and the lock is global per `storageKey`. Every later auth operation
   then queues in `pendingInLock`, which consults **no** acquire timeout
   (`GoTrueClient.js:2232-2251`). All three clients share the one lock —
   RABBIT's `sharedAuthedClient` is the same instance.

**Consequence, and why the planned "sweep the 22 sites" was not done:** bounding
a call site restores *that site's UI* and nothing else. A sweep would have gone
green and left the app just as stuck, while letting the session report the class
as closed.

What S21 did instead (`10fcd29`): fixed the two places where the defect was
actually reachable and reportable — `ProfileSection`'s loader now has
`try/catch/finally` so `loading` clears on every path (the `Promise.all`'s
*other* leg is unbounded too, so bounding only the auth call would not have
closed it), and `aiProxy`'s pre-flight is bounded with its own code and message
rather than falling through to "Sign in to use AI features."

→ The real remediation is probably an app-level circuit-breaker or forced
re-hydrate, not per-site ceilings. **Design it before writing it.**

### Avatar does not persist
**REPORTED; root cause still unproven.** S21 falsified four hypotheses by
measurement — the `avatar_url` column, the `user-avatars` bucket (public, 2 MB,
correct MIME list), the storage policies, and the `isOwnAvatarUrl` render guard
all exist and are correct, and the self-guard trigger RAISES rather than
silently reverting and does not block `avatar_url` on a self-update.

**Definitively NOT the same cause as the loader hang above** — if the load
hangs, the component early-returns "Loading profile…" and the avatar controls
are never mounted, so no upload can start.

`10fcd29` fixed two things that were making every failure mode *look like
success*: an RLS-refused UPDATE matches zero rows and raises nothing, and the
code merged the patch into local state anyway; and the `catch` never cleared
`avatarFile`, so the blob preview survived any failure until the next mount.

→ **That makes a silent failure loud; it does not prove the report is fixed.**
If it recurs, the panel will now say what went wrong — capture that message.
The one candidate not yet excluded is whether the Storage API populates
`request.jwt.claims` with `app_metadata` at all; if it does not,
`current_workspace_id()` is NULL inside the storage policy and every upload is
refused in every environment. One devtools Network capture of the
`POST /storage/v1/object/user-avatars/...` settles it.

### ~~O.T.T.E.R. validator findings and quiz scores are not saved~~ — FIXED (S30, `2d8b658` + `c3317d4`)
Deleted per the rule for this file. The one line really was three defects, and
none of the three was what it said.

**1. The Validator's "Accept Fix" never saved — and reported that it had.**
Two faults stacked so neither was visible: `electron/main.cjs` had no PUT route
for a subject (so on Local Server, where all six of Audrey's courses live,
every accepted fix 404ed), and `applyFix` did not check `res.ok` (so the 404
was reported as a green "Fix #n applied"). Either alone would have shown
something. Both are fixed, and `validatorSave.test.js` pins each half —
proven by removing them one at a time.

**2. "Apply fix" parity.** The missing Express route was the whole of it;
cloud has worked since Session 10.

**3. Quiz scores — the path was built and had no caller.** Column, both
adapter ops, route mapping, and a PASSING unit test, for twenty sessions.
Migration 0045 replaces the per-course column with `otter_quiz_attempts`
(one personal history, 30 days), because a quiz spans courses and the old
shape could not hold one. `quizWiring.test.js` fails if the call is removed.

**Audrey declined audit-report storage** (2026-08-05): *"just make Accept
actually save."* Findings still live only for the session — that is a scope
choice, not breakage, so it is recorded in `MASTER_PLAN_S19_ONWARD.md`.

**The export defect went with it.** `export.all` called `quiz.get` once per
course — the only caller on the entire quiz path — reading a column nothing
had ever written, so every export WILSON produced carried an empty quiz
history while presenting itself as complete. Both backends now ship one
honest top-level `quiz_history`.

### Signing in to the desktop app hides O.T.T.E.R.'s local courses, with no way back
**MEASURED at code level (2026-08-05); NOT observed at runtime.**
`otterFetch` routes to Supabase whenever the session carries a `workspace_id`
(`adapters/index.js:47-59`), and cloud holds **0 courses on every
environment** — so a signed-in desktop user sees an empty library while six
courses (49 subjects, 138 lessons) sit in `%APPDATA%\wilson\otter-data`.

The escape hatch is referenced twice in comments and **does not exist**:
`setOtterAdapterMode` has **zero callers anywhere in the repo**, so
`modeOverride` is permanently `'auto'`. `adapters/index.js:26` calls it "the
Settings override" and `Otter.jsx:238` says "the Settings mode override can pin
local while a session exists". Neither is true. That is the **fourth** feature
to ship complete with no caller — after the folder tree (S27), task templates
(S28) and quiz history (S30) — and it was found while looking for something
else.

→ **Audrey has de-prioritised the CONTENT** (2026-08-05): *"thats not
important … we can start with otter being empty. i can generate new courses
during beta testing."* So no migration is owed. What is still owed is that the
app says nothing when a library empties on sign-in, and offers no way to look
at the old one. Small; not scheduled.

<!-- removed: the original entry read —
Known #2. Both generate correctly and neither result is persisted, so the work
is lost on navigation.

> 🚨 **THIS ENTRY WAS ONE LINE COVERING THREE DIFFERENT DEFECTS, and two of
> them are not what it says. MEASURED 2026-08-04, by grepping for the writer
> and then asking whether anything calls it.** Written down before S30 starts,
> because "add persistence for both" would have been three wrong guesses and
> would probably have added a duplicate table.
>
> **1. Validator findings — genuinely nothing exists.** `auditResults` is React
> state (`Validator.jsx:121`) and there is no store for it on any backend, no
> adapter op, and no route. This half is real and needs building.
>
> **2. "Apply fix" — works in CLOUD, silently 404s on Local Server.** Not a
> persistence gap, a parity gap, and the code already says so:
> `otterRoutes.js:162-165` — *"Validator.jsx:441 issues a PUT here. No such
> Express route exists, so against the local server it has always been a silent
> 404 — the 'apply fix' button never persisted anything. Cloud mode treats it
> as the save it was clearly meant to be."* So this is the opposite way round
> from the usual complaint: cloud is the one that works.
>
> **3. Quiz scores — the ENTIRE path is built and NOTHING CALLS IT.**
> `otter_progress.quiz_attempts` is a column; `quiz.get` / `quiz.put` exist
> (`supabaseOtterAdapter.js:404-420`); `otterRoutes.js:200-203` maps
> `/api/software/:slug/quiz-history` GET/POST onto them; and
> `otterRoutes.test.js:92-93` asserts that mapping and **passes**. The quiz UI
> never writes: `quizScore` is React state (`Otter.jsx:125`), the quiz ends at
> `setQuizComplete(true)` (`Otter.jsx:2112`), and the results screen's own "Try
> Again" button (`:4726`) zeroes it.
>
> 🚨 **CORRECTED 2026-08-05 — the "zero callers" claim was wrong, and the true
> version is worse.** This entry said `quiz-history` has *"zero occurrences
> anywhere else in `src/`"*. It does not. **`quiz.get` has exactly one caller:
> `supabaseOtterAdapter.js:660`, inside `export.all`** — the admin data
> takeout, which reads `quizHistory` per course and ships it in the export
> (`:653`, `:666`).
>
> **So every data export WILSON has ever produced carries an empty quiz history
> while presenting itself as complete.** That is a separate, unfixed defect
> from "the quiz does not save", and it is the one with a compliance flavour —
> a takeout is a claim about completeness. It disappears the moment the writer
> is wired, but if S30 wires only part of this, say which.
>
> The accurate statement is: **`quiz.put` has no caller; `quiz.get` has one,
> and it has only ever read nothing.**
>
> **That is the third instance of the same shape** — the folder tree (S27) and
> task templates (S28) were both complete features with no caller — and the
> first where a **passing unit test** covers the dead path, which is exactly
> why green tests are not evidence that something runs. The fix here is
> WIRING, not building, and the two halves must not be sized as one job.
>
> ⚠️ **Three measured traps for whoever wires it** (2026-08-05):
> `quiz.put` is **whole-array replacement** (`:417`), so posting only the new
> attempt erases the history — read, append, write. There is a **1 MiB CHECK**
> on the column (`otter_progress_quiz_sz_chk`, `0022:274`), so append-forever
> eventually fails and the retention rule must be decided first. And `quiz.put`
> throws `401` when signed out (`:413`), so the caller needs a visible failure
> path.
>
> ✅ **One thing that looks like a bug and is NOT — do not "fix" it.**
> `quiz.get` and `progress.get` filter on `course_id` alone with
> `.maybeSingle()` and no `user_id`, though the table is keyed
> `(course_id, user_id)`. `otter_progress_select` (`0022:607-612`) carries
> `AND user_id = auth.uid()`, so RLS returns at most one row.
-->

**Two things the S30 investigation corrected in the block above, kept because
both were confidently written and both were wrong:**

- It said the accept-fix problem was "a parity gap, cloud is the one that
  works". Cloud's DATABASE works — the e2e probe is 9/9 on dev and staging —
  but the CLIENT was broken on both backends, because an unchecked `res.ok`
  turns an RLS refusal into a green tick just as readily as a 404 does.
- It called the quiz half "WIRING, not building". Wiring alone would have
  filed a multi-course score under one arbitrary course. The measurement that
  changes it is `quizSelections`: a quiz is assembled from every course the
  user ticks, so `otter_progress`'s `course_id NOT NULL` cannot hold an
  attempt at all.

### The pet and per-user settings do not follow the user between computers
**MEASURED (2026-08-04).** Audrey signed into the **same account** (`audrey`,
admin) on a second computer and was asked to create a new pet — the name,
state, hunger and content levels did not travel. Her requirement, verbatim in
substance: *"each user should have their personal settings saved along with the
pet details and status. if i log on one computer and i see a pet that is hungry
on another computer i should see the same pet at the same state."*

The cause is not a sync bug — there is nothing to sync. `src/lib/localData.js`
is **per-device by construction**: Express-backed storage in Electron,
`localStorage` on the web. The pet lives there (`PetCompanion.jsx`,
`SettingsPage.jsx`, `App.jsx` all read it), so a second machine has no pet to
find and correctly offers to create one.

→ Needs a per-user store in the database, its own RLS (a user reads and writes
**only their own** row), a suite, adapter methods, and a one-time migration
that adopts the existing local pet rather than overwriting it with a blank —
otherwise the first cloud save wipes the pet she already has. **Do not treat
this as a small fix.**

✅ **Scope settled (Audrey, 2026-08-04): ONE pet and ONE set of settings per
PERSON, everywhere — not per workspace.**

🚨 **Two findings from the S28 review pass that change the design, both
MEASURED:**

- **The schema will fight the per-user rule.** 44 tables carry policies on
  wilson-dev; **39 scope by `current_workspace_id()` and exactly one
  (`auth_attempt_log`) is purely per-user.** `user_model_overrides` looks like
  the precedent and is **not** — all four of its policies are workspace-scoped,
  so copying it builds the per-workspace pet she rejected.
- **The pet auto-saves every 30 seconds and writes are whole-object
  last-writer-wins** (`localData.js:20-25`, a KNOWN GAP note written when
  *"the app is a one-window product"*). Synced, two signed-in computers would
  overwrite each other continuously and hunger would jitter between two values
  — the exact symptom this is meant to remove. Hunger decays with time, so
  storing `last_fed_at` and computing on read probably removes the conflict
  rather than resolving it. **Settle this before the migration.**

### There is no way to log out
**MEASURED (2026-08-04).** `src/components/SettingsPage.jsx` contains **zero**
occurrences of `signOut`, `logout` or `log out`. There is no sign-out control
in System Settings, and Audrey asked for one. Small on its own; grouped with
the per-user settings work because both touch the same screen.

### D4 is enforced for stored settings, not for a hand-made request
**MEASURED (S20).** Migration 0031 FKs both override tables to
`platform_approved_models`, so an admin or user cannot *persist* an unapproved
model — verified against wilson-dev, the insert fails on
`workspace_model_overrides_model_id_fkey`. What is **not** covered: `ai-proxy`
does not check the requested model against the catalogue, so an authenticated
user with devtools can POST an arbitrary model id on a one-off request and it
will be served.

This is a deliberate scope decision (Audrey, 2026-08-02), not an oversight: a
catalogue read on the path of every AI call turns a database hiccup into an AI
outage, which is the exact failure class that cost 47 days. D4's stated purpose
— stopping a company admin putting every generation on the priciest model —
holds, because that requires *storing* a choice.
→ Fix if it ever needs to be airtight: check `model` against a cached catalogue
in `ai-proxy` and 403 on a miss, failing **open** if the catalogue read itself
fails. Not scheduled.

### ~~Project-scoped team member rates are not in the project manifest~~ — FIXED (S27, `5384d4e`)
Deleted per the rule for this file. Migration 0042 adds the `FINANCE` path
segment, gated by `can_access_project_money` exactly as `INVOICES` is, and
`projectRates.js` writes `projects/<id>/FINANCE/RATES.json` on both writable
backends. Applied and verified **by query** on dev, staging and prod.

Audrey chose a gated file over leaving the rates app-only (2026-08-04).

The part worth keeping: **the fix was not "add a second gated trio".** Doing
it the existing way would have put the reserved segment name in EIGHT places
that all had to agree, and the base three had to exclude BOTH — permissive
policies OR together, so a base policy that forgot `FINANCE` would serve the
rates to every project member no matter how correct the gated policy was.
That is precisely how 0038 failed. 0042 reduces the whole thing to one
`public.rabbit_money_segment(text)`; the base policies negate it, the money
policies assert it, and a third segment is a one-line change.

🚨 It is **NULL-safe by construction, and that is load-bearing rather than
tidy.** `projects/<id>/PROJECT.json` has no third path segment, so the
predicate is called with NULL; a bare `upper(seg) IN (...)` returns NULL,
`NOT NULL` is NULL, and a NULL policy expression FAILS. Without the coalesce
the manifest becomes unreadable and unwritable by everyone — pgTAP 53 probes
1, 5 and 11 all fail together when it is removed, which is how that was found.

### Welcome page has a phantom cursor
**REPORTED.** A black cursor blinks permanently, unattached to any input, and
keeps blinking on the right while typing elsewhere. Likely the shared
`AuthCursor` from `AuthShell.jsx` — **that is a guess, confirm in the DOM
first.**
→ S25.

---

## Session log

Kept so the file's own history is visible without `git log`.

| Session | Added | Removed |
|---|---|---|
| S30, postscript II (2026-08-05) | **nothing.** ✅ **CONFIRMED BY AUDREY AND THEN BY QUERY:** *"it worked"* — and staging now holds `Blender 5.1 [personal]`, 9 subjects, 1 with generated content over 2 sections. Before tonight `otter_courses` was **0 rows on all three environments**, so that is the first cloud course O.T.T.E.R. has ever produced. The entry below is kept because the fix SHIPPED inferred rather than observed, and the discipline that made that safe is worth keeping: the `pause_turn` fix (`ce11709`) was **INFERRED, not OBSERVED**. Audrey's outline generated and subject content then failed with *"Failed to parse subject JSON"*; the cause is traced through code and matches the symptom exactly (the outline carries no tools and works, `generateSubjectContent` carries `web_search_20250305` and fails), but running the live API needs her password, which a session must not handle. **So the instrument shipped with the fix:** every O.T.T.E.R. parse failure now appends `[stop_reason; blocks; chars of text]`. If it recurs, the message names the cause instead of costing another round trip. Not an entry here because nothing is known broken — if the diagnostic comes back saying otherwise, THAT is the entry. | nothing further. |
| S30, postscript (2026-08-05) | **nothing.** Audrey tested O.T.T.E.R. immediately after the close-out and **every** course generation failed — *"Failed to parse course outline JSON."* Found, fixed and pushed in `a905471`, so per this file's own rule it is a commit message and not an entry. It is recorded in `MASTER_PLAN_S19_ONWARD.md` because of what it says about the SESSION: the generation had succeeded (`end_turn`, complete JSON) and the app read `content[0].text`, which is a **thinking block**. **Eight call sites across three tools.** Migration 0045 was verified on three environments, 55 pgTAP suites and 834 unit tests were green and the e2e probe was 9/9 — and the tool could not produce a single course. **Database-proven is not app-proven.** | nothing further. |
| S30 (2026-08-05) | **one entry: signing in to the desktop app hides O.T.T.E.R.'s local courses**, with no way back — found while establishing which backend Audrey's report came from, not by looking for it. Nothing regressed. Two scope choices are recorded in `MASTER_PLAN_S19_ONWARD.md` rather than here, per this file's own rule: Audrey declined storage for validator audit REPORTS (*"just make Accept actually save"*), and the quiz history is deliberately per (workspace, user) rather than per person. | **O.T.T.E.R. validator findings and quiz scores** — the whole three-defect entry, by `2d8b658` (no SQL) and `c3317d4` (migration 0045, applied and verified **by query** on dev, staging and prod). The export defect recorded inside it went with it. The single most useful measurement of the session was taken before any code: **`otter_courses` holds 0 rows on dev, staging AND prod**, including trashed, while all six of Audrey's real courses are on Local Server — which identified the backend her report came from and made "build cloud storage for it" the wrong shape twice over. |
| S29 (2026-08-05) | **nothing.** Nothing regressed, and every defect S29 found was also fixed in it — so per this file's own rule they are commit messages, not entries. Four are worth knowing about anyway, all in `7443fed`: `ready` was missing from **three** gates (`TaskDetailPopup`, `DashboardTasksView`, `TeamView`) which is the S23 bug surviving in three files that looked correctly gated; and **inline row editing was ungated** in both `ProjectTasksView` and `ProjectAssetsView` — every cell, dropdown, date and kanban drag committed through an unguarded funnel, which is why both files read as "already gated" when only their create buttons were. Two stated limits are recorded in `MASTER_PLAN_S19_ONWARD.md` rather than here, because they are scope choices and not breakage: hover-revealed row icons still hide rather than grey, and `ProjectSummaryView`'s control-panel button still hides. **The three verification items were NOT closed** — the checklist went to Audrey at the START of the session this time, and the observations had not come back before the work was committed. The assignee-dropdown entry below is therefore untouched. | **every R.A.B.B.I.T. create button can vanish behind one `canWrite` flag** — the whole entry, historical block included. The reported half was explained in S28 (`tester` correctly has no seat); the real defect was the inverse and is fixed by `7443fed`: `TimelineView.jsx` now gates ~12 create affordances, both panes' bar drags, drag-to-draw, reparent, the dependency grip and rewire, and the editor's Save/Delete. The S23 UX note the entry carried is retired rather than moved — Audrey chose "keep button gray and explain why", and `GatedAction` applies that everywhere instead of hiding. |
| S28 (2026-08-04) | **nothing.** Nothing regressed and nothing new was found broken. One stated limit of what shipped is recorded in `MASTER_PLAN_S19_ONWARD.md` rather than here, per this file's own rule: `canWriteTaskTemplate` is stricter than RLS for a project manager viewing a template pinned to a project they do not currently have open — deliberate, documented in the function, and fails CLOSED. The three verification items were **not** closed: Audrey was given a checklist and the observations had not come back by the time the work was committed, so the dropdown entry below stays exactly as it was rather than being quietly narrowed. | **task templates absent in cloud** (0044 + `06bf564`, applied and verified **by query** on dev, staging and prod, and proven end to end by a rolled-back probe on dev AND staging). The `role_slug` defect recorded inside that entry went with it — it was reachable only through the branch 0044 brought to life, and it is fixed at both sites with a source-level guard that fails if either is reverted. |
| S27 (2026-08-04) | **nothing.** Nothing regressed and nothing new was found broken that is not already listed. The task-templates entry was annotated — its third deferral was Audrey's explicit decision this time, which is worth distinguishing from a session running out of room. ⚠️ The new file surfaces (FileManager in cloud, the Resources drop zone, the folder/manifest panel) are **built and not yet watched working** — that belongs in `MASTER_PLAN_S19_ONWARD.md` per this file's own rule, not here, and it is recorded there. | **project-scoped rates absent from the project folder** (0042 + `5384d4e`, applied and verified **by query** on dev, staging and prod). Two defects that were never on this list were also fixed and are recorded in the commit rather than here, because a thing found and fixed in one session is a commit message: the manifest could only ever be written ONCE per project (no UPDATE policy has ever existed on the rabbit-files bucket), and the folder tree had produced ZERO rows on any environment because its only caller was `createProject`. |
| S26 (2026-08-04) | **one entry: project-scoped rates are absent from the manifest** — a stated limit of what shipped, with the two policies that force it. Nothing regressed. The `canWrite` entry was **corrected**, not narrowed: its header claimed both leading theories were refuted while its own body reopened one of them, the same self-contradiction `267c4c3` had already fixed in the S26 brief and never carried across here. Exactly one theory is refuted, on code; the other rests on testimony and is marked INFERRED. | nothing was fixed that was on this list. S26 built new capability rather than repairing existing breakage. |
| S25 (2026-08-04) | **nothing new is broken.** Two entries were NARROWED rather than added: the `canWrite` gate (both leading theories refuted — Audrey confirms the account was `audrey`, who is admin AND project manager, and `canOnProject` already fails OPEN while permissions load, so a hung session leaves buttons PRESENT), and **task templates**, which S25 was scoped to fix and deliberately did not — it needs a fifth table and a suite, not a method. The assignee-dropdown entry is re-marked **still unobserved**: S25 was asked to confirm it at runtime and could not. | **scenes/levels/experiences unavailable in cloud**, **four budget tabs that can never render**, and **Client View printing "Project" and "--"** — all three by 0040 + `183b4c2`, applied and verified **by query** on dev, staging and prod. The Client View fix is recorded above because the documented fix (`add projects.code`) would have fixed nothing. |
| S24 (2026-08-03) | **four budget tabs that can never render** (they gate on three `projects` columns that do not exist), **Client View printing "Project" and "--"** (it reads `project.name`/`project.code`; the column is `title`), **no client-side gate on the budget UI** (a UX defect now that RLS is the authority), and **desktop-only invoice folders** in the Crew/Talent tabs. All four are pre-existing and were found by reading the budget UI properly for the first time; none is new breakage. | **the budget system's absence from the cloud schema** (0036 + 0037 + `b07b6c9`, applied and verified **by query** on dev, staging and prod). The assignee-dropdown entry was **narrowed, not closed** — the two hard-empty dropdowns' stated cause is removed at code level but has not been watched working. |
| S19 (2026-08-02) | staging `service_role` exposure | **email templates** (confirmed on all three projects; the entry was seeded from a stale S18 note). **wilson-dev auth config** — added and closed the same session; restored by hand, CI green on `68c9758`. |
| S20 (2026-08-02) | the D4 / `ai-proxy` boundary above — recorded because it is a stated limit of what shipped, not because anything regressed | nothing (S20 touched none of the entries below the security block) |
| S20, later the same day | nothing new. The Profile-panel entry was **corrected**: the unbounded-`getSession()` class is 26 sites, not 18, and S20 itself added two of them (`modelSources.js`, both writers). Those two are now bounded with `withTimeout` and pinned by tests that fail with a hang when the bound is removed. The rest of the class is S21's sweep. | nothing |
| S23 (2026-08-03) — **same conversation as S22**; it completed the S22 brief, wrote the S23 brief, then executed it in the same sitting when Audrey reported she could not create anything. No gap, nothing skipped. | **every create button can vanish behind one `canWrite` flag** — the gate is MEASURED, the cause is NOT ESTABLISHED, and the leading theory was refuted by the fact that opening the New Asset dialog proves the flag was true. **Task templates absent in cloud.** Both are pre-existing, neither was introduced this session. | **R.A.B.B.I.T. item creation** (0034 + 0035 + `2727328`, applied and verified by query on all three envs; the original failing payload now SUCCEEDS on staging). The assignee-dropdown entry was **corrected, not closed** — S22 measured it against dev, where the roster is empty; staging behaves differently and two dropdowns are hard-empty for a different reason entirely. |
| S22 (2026-08-03) | the R.A.B.B.I.T. task-creation entry, **upgraded REPORTED → MEASURED** with a reproduced `23502` and a named cause, plus a separate **assignee-dropdown** entry whose documented lead turned out to point at a branch that never runs. Neither is new breakage — the old entry was one line of guesswork and is now two entries of evidence. | the **`anon` privilege spread** (0033 + `494a13d`, applied and verified **by query** on dev, staging and prod: 25 tables → 0, and 7 anon-executable SECURITY DEFINER functions → 0). **Storage tab reads as broken on the web** (`8709b1e`). |
| S21 (2026-08-02) | the **`anon` privilege spread** (25 tables remaining) — found by a test assertion failing, not by looking for it. The **auth-js global lock**, which replaces the old Profile-panel entry with a correct account of why per-site ceilings do not fix it. | **`rate_cards.type`** (0032 + `10fcd29`, applied and verified on dev, staging and prod). **Password change missing** (`10fcd29`). **Profile panel spins forever** — superseded, see above. The avatar entry is kept but rewritten: four hypotheses falsified, the success-masking fixed, root cause still open. |

S23's lesson is **measure the environment the user is actually in.** S22
measured `project_members` on wilson-dev, found zero rows, and concluded the
staffed branch never runs — sound reasoning from a real query. But Audrey uses
the beta, which is **staging-backed**, where that table has three rows and the
opposite branch runs. The measurement was correct and the conclusion was wrong
because it was taken from the wrong database. Checking `.env.local` (dev) vs
the beta host (staging) is one command and it reframes every roster symptom.

Its corollary is about evidence ranking. The single most useful fact in the
whole investigation was not found by reading permission code: it is that
`setShowNewAssetPopup(true)` has exactly one caller, the `canWrite`-gated
button — so **Audrey having opened that dialog proves the flag was true**. A
user action that requires a precondition is direct evidence about that
precondition, and it outranks any amount of reasoning about how the flag is
computed. Two agents had built confident stories that this one observation
killed.

S22's lesson, and it is about **grantees, not grants**. The 25 tables were
granted to `anon` explicitly, so `REVOKE ... FROM anon` worked. The seven
SECURITY DEFINER functions were granted to **PUBLIC** — every one carried a
bare `=X/postgres` aclitem — so the same statement against them would have been
a **silent no-op**: no error, migration reports success, hole still open, and
nothing visible afterwards without re-querying the ACL. 0011:42 already knew
this (`REVOKE ... FROM PUBLIC, anon`) and the knowledge had not travelled.
**Check who actually holds the privilege before writing the REVOKE, and make
the post-condition scan every object rather than the ones you listed.** The
scan is what would have caught it; the list is what would have missed it.

The second half of the lesson is about scope. The recorded problem was "25
tables". Asking what *else* migration 0011's blanket grant touched found two
more things nobody had written down — the anon-executable SECURITY DEFINER
functions (a live pre-auth RLS bypass, not a latent grant) and the still-armed
`ALTER DEFAULT PRIVILEGES` that would have re-opened the hole on the next
`CREATE TABLE`. Fixing only the documented 25 would have been a correct fix to
a third of the problem, and would have read as complete.

S21's own lesson, and the reason the `anon` entry exists at all: **a test
assertion written to the house convention found a hole nobody was looking for.**
The migration was scoped to add one column. The suite grew the standing
`ok(NOT has_table_privilege('anon', …))` probe because that is what the
convention says to do, it failed, and 26 tables turned out to be open. Two
independent investigators had both reasoned — correctly, from the migration
text — that no REVOKE was needed, because `ALTER TABLE ADD COLUMN` creates no
new object and so does not trip 0011's trap. That reasoning was sound and the
conclusion was still wrong, because nobody had checked the *existing* grant
state. Reasoning about what a migration does is not a substitute for querying
what is there.

Both S19 additions were the same root cause: **a shell command built by string
interpolation, where the content was not safe for the shell.** The first
printed a `service_role` key into a transcript because a `grep -v` filter
assumed line-per-key JSON; the second ran `supabase config push` because bash
evaluated backticks inside a double-quoted `node -e`. Neither was a reasoning
error — both were quoting. See the standing rule in `MASTER_PLAN.md`.

One lesson from closing the second one, worth keeping: **the push diff showed
what it attempted, not what it changed.** Of nine settings listed, only two
were actually off when checked — `Enable email provider` and TOTP. Site URL,
OTP length, signup and confirm-email were all still original. Reading the live
state first would have replaced a nine-row restore list with a two-row one.
