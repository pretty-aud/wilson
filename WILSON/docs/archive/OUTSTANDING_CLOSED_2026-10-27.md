# OUTSTANDING.md: the closed entries, archived 2026-10-27

Moved verbatim from `docs/OUTSTANDING.md` by N1 (`po/n1-subtract`, branched from
`feat/post-overhaul-edit-versioning` at `c48dbb8d`; the move is its list 6), so the live
file holds what is open. Every heading struck through (`### ~~…~~ — FIXED / CLOSED /
APPLIED …`) came with its body, and every closed bullet (struck through, or `CLOSED by …`
in its lead). Each group below says where its entries stood: the section, the sub-heading
above a bullet, and the lines they held in the live file before the move. Four closed entries
stayed in the live file: two bullets that also record a defect found and not fixed (S2b-02,
S2b-05), and two struck headings whose bodies hold the file's HTML comment blocks, so that its
comment markers stay four ("R.A.B.B.I.T. item creation fails in cloud mode", "The pet and
per-user settings do not follow the user between computers"). So did the Security section,
struck heading and all, and the Session log. Nothing here is open; git has every earlier
version of both files.

## From *Broken features* (lines 597–1522)

### ~~Migration 0061 is written and NOT applied to any environment~~ — APPLIED on all three (re-verified 2026-09-04)
Deleted per the rule for this file. `public.phase_dependencies` exists and
`0061` is recorded in `supabase_migrations.schema_migrations` on wilson-dev,
wilson-staging and wilson-prod, queried on 2026-09-04 through three throwaway
`--workdir` links with a per-environment discriminator (`inet_server_addr()`
and the workspace count differ on each; the repo's own link to dev was never
touched). The entry was written on 2026-08-11 and the migrations were applied
on 2026-08-12 (`docs/fixes/README.md` records 0000–0063 on all three); nobody
came back to this file. ⚠️ Phase→phase links have still **not been re-tested
by Audrey** since the table arrived — a verification item recorded in
`docs/fixes/README.md`, not a defect.

### ~~Migration 0059 dropped two columns from `workspace_directory()`~~ — FIXED by 0060, APPLIED on all three (re-verified 2026-09-04)
Deleted per the rule for this file. `workspace_directory()`'s `RETURNS TABLE`
list names `grant_rate_card_view` and `grant_rate_card_edit` again on
wilson-dev, wilson-staging and wilson-prod, and `0060` is recorded on all three
(queried 2026-09-04; applied 2026-08-12 per `docs/fixes/README.md`). The Admin
Terminal's rate-card toggles therefore read the table's values again instead of
`undefined`. ⚠️ Nobody has watched those toggles since — an eyeball check, not
an entry. The lesson stands: **when a migration re-creates a function with an
explicit column list, the risk is not the column you are ADDING; it is every
column already there** — and 0060's post-condition asserts all three names, so
the next rebuild cannot drop them silently.

#### How it stayed hidden for two days — the part worth keeping

pgTAP suite `24_admin_grants.sql` has asserted this contract since Session 9 and
failed the moment 0059 landed (`column d.grant_rate_card_edit does not exist`).
**The suite did its job perfectly.** Two things hid it:

1. `cfe2cbd` broke TWO things at once — this regression, AND it added a new test
   file (`67_member_full_time.sql`) that had never been executed and carried
   three faults of its own: invalid `LATERAL` scope; a call to
   `tests.authenticate_as`, which has never existed; and a 2-column `auth.users`
   seed where every other file in the suite writes 11. All three are fixed and
   67 now replays clean.
2. 🚨 **The CI step built to explain pgTAP failures guaranteed they could not be
   read.** It emitted an `::error::` annotation for EVERY replayed file,
   including passing ones. GitHub caps annotations at 10 per step, so with 67
   suites the entire budget was spent announcing that files 01–10 were fine, and
   the real error sat past the cap. Job logs need repo admin (403), so there was
   no other route. Fixed in `.github/workflows/rls.yml` — annotate only on real
   errors. **That fix is what surfaced this bug in a single run.**

🚨 **pgTAP needs Docker and this machine has none, so these tests are never run
before being committed.** The "1440 tests green" recorded against `cfe2cbd` was
**vitest**, which never reads these files. Installing Docker would let
`supabase test db` run locally and close this whole class of failure.

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

### ~~Two of the four assignee dropdowns are hard-empty in cloud mode~~ — CLOSED (2026-08-05, observed)
**Audrey watched the Timeline task editor's Assignee dropdown populate on the
beta and confirmed it works.** Open since S22, MEASURED since S23, and carried
unverified through S24–S29 because reaching it needs a signed-in session
against staging that nothing in this repo automates. The code-level fix landed
in S24 (`b07b6c9` — `listTeamMembers` on the Supabase adapter over
`workspace_directory()`, plus `teamAssignments` in `loadProject`); this is the
observation that finally settles it.

**Deliberately precise about what was observed.** She confirmed the **Timeline**
dropdown. `ProjectAssetsView`'s asset-detail rows share the same root cause and
the same hook, so they are INFERRED-good rather than watched — stated here
rather than quietly folded in. A dropdown is a READ and leaves no database
trace, so unlike the Validator write below there is nothing to verify by query:
her eyes are the only possible instrument, and per S23's lesson a user action
that requires a precondition outranks reasoning about that precondition.

→ ~~**One thing from the old entry survived as its own item**: `useRosterMembers`
swallowing the RPC error.~~ **Closed by Track B bundle B1 (2026-09-06):** the hook returns `error`, `RateCardPage` shows it, and `useRosterMembers.test.js` goes red if it is swallowed again.

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

### ~~A non-admin has no way to submit a course to the company library, and nowhere to ask~~ — FIXED (Phase 5, migration 0064, `a7d87c5` + `fb17ac7`)
Deleted per the rule for this file — built the same day as course nominations
(the BUILT block below). The original finding is kept because its three
specifics still hold for the promotion path.

`otter_courses.visibility` has three tiers, and `company_standard` is admin-only
at the **database** level: `fn_otter_pin_course_identity` gates it on
`current_app_role()`. `selectableVisibilities()` mirrors that correctly, offering
a non-admin owner only `['personal','shared']`, and a green assertion in
`otterSharing.test.js` pins it. So the client is right — **there is simply no
path.**

There is also **no nomination surface anywhere**: no table, no route, no UI
representing "make my course the company standard". The change-request queue
cannot serve as one — `otter_cr_insert` requires the target to already be
`company_standard`, and `otter_cr_apply` never writes `visibility`. Promotion is
therefore an **immediate, unreviewed, admin-only flip**, and nothing in the
product can create the *first* standard course of a topic except an admin doing
that by hand.

Three specifics worth keeping:

- **Promotion is genuinely two steps, and nothing says so.** `otter_courses_select`
  has no admin arm (three migrations ship post-conditions that fail the build if
  `current_app_role` appears there), and Postgres applies SELECT policies to an
  UPDATE's WHERE — so an admin asked to promote a still-`personal` course matches
  **zero rows**. The owner must set `shared` first. Phase 5 put this in the
  Sharing dialog for non-admins; it is still undocumented in the schema.
- **A refusal is silent.** `fn_otter_pin_course_identity` never raises — it
  assigns the old value back, and because RLS `WITH CHECK` runs *after* BEFORE-ROW
  triggers, the reverted row passes and the UPDATE reports success, 1 row
  affected, no error. `ShareCourseDialog` compares sent-vs-returned and is safe;
  **`course.update` in the adapter does not**, so any future caller gets a
  phantom success.
- **The gate is untested on both sides.** pgTAP 26 covers the INSERT gate but has
  **no test for the UPDATE promotion gate by a non-admin owner** — the exact
  `ELSIF` arm that blocks this is uncovered across the whole suite. On the client,
  no test mentions `cloudMode` or `otterCloudActive`, the predicate that decides
  whether any sharing UI renders at all (and which calls `getSession()` unbounded
  — see *One hung `getSession()` pins the whole app's auth* above).

→ **UPDATE, same day.** Audrey decided the shape: *"it needs to be
reviewers/managers not just admins with approval access. anyone should be able
to submit to become company standard"*, and — on the consent question 0026 had
deliberately answered the other way — that **submitting grants approvers a
read-only window** on the course, as change requests already do.

**BUILT, BOTH HALVES, AND LIVE ON THE BETA (2026-08-12).** 0064 applied to dev
and staging (**prod still at 0063**); `a7d87c5` + `fb17ac7` pushed; CI green on
`fb17ac7` (all four jobs, including a from-scratch replay of every migration
0000–0064 with suite 70); the deployed bundle
`/wilson/assets/index-hYIqRWuY.js` was probed and carries the client
(`/api/otter/nominations`, `otter_nomination_apply`, both new strings) — not
just a deploy timestamp, per the Phase 3 lesson. Migration
`0064_otter_course_nominations.sql` + pgTAP suite 70 (36/36 against wilson-dev in
a rolled-back transaction), `nomination.*` adapter ops, four `cloudOnly` routes,
the submit panel in `ShareCourseDialog` and the review surface in `RequestsView`.
1557 unit tests green, build clean, 22 breaker mutations all red.

⚠️ **Nothing has been exercised by a human, on any environment.** Every
assertion above is a unit test or a rolled-back transaction. The feature has
never round-tripped through a real browser against a real database.

What remains is not this file's kind of entry, and is tracked elsewhere:
- **Prod is at 0063** — re-measured 2026-09-04: no `otter_course_nominations`
  table there; dev and staging have it, with 0064 applied and verified on both
  on 2026-08-12 (staging preflighted before its three `CREATE OR REPLACE`
  objects were replaced and post-checked afterwards; pgTAP 70 green against the
  applied schema). Environment state — `docs/fixes/README.md`.
- **A human walkthrough is owed:** submit as a plain member, approve as a
  manager, confirm the incumbent stood down, confirm the read window opens AND
  closes. `docs/RELEASE_TESTING.md`.
- ~~⚠️ **`maySuggest`'s dead-end (next entry) gets worse with this feature**:
  approving a nomination DEMOTES the incumbent standard, so every fork of it
  immediately starts showing a "Suggest a change…" item whose POST cannot
  succeed.~~ — FIXED (2026-08-13, `b051e20`), merged onto `track-a-product` in
  bundle A4. Being made routine by 0064 is what turned this from a corner case
  into the thing worth fixing.

### ~~A manager can approve their own nomination~~ — FIXED (2026-09-07, `93c199e`)
Audrey ruled on it (decision 36): **allowed, and recorded.** A manager can already
promote a course by hand, so refusing in the RPC would move the work rather than
prevent it. Migration **0069** re-creates `otter_nomination_apply` and writes an
`app_events` row with the new code **`WIL-4108`** when the nominator is the caller —
in the SAME transaction as the promotion, and allowed to raise, so an unrecorded
self-promotion rolls back with it. Suite 70 (36 → 48) proves it with the CONTROL
first: approving someone else’s nomination writes no line. Three function mutants
red on dev. ⚠️ **Applied on dev only** — see the staging note in the hand-off.

### ~~"Suggest a change…" is offered on forks of a demoted standard, where it cannot work~~ — FIXED (2026-08-13, `b051e20`)
Kept struck rather than deleted because the brief's suggested fix was half of
one, and the missing half is the part worth remembering.

**The defect, as filed.** `CourseRowMenu`'s `maySuggest` gated on
`!!course?.source_course_id` — "this is a fork" — and never re-checked that the
source was *still* `company_standard`. `otter_cr_insert` (0025) requires
`otter_course_visibility(target_course_id) = 'company_standard'` at INSERT, so
after a demotion the item still showed, `ChangeRequestDialog` still rendered its
whole submit form, the user still wrote a summary, and only the POST failed.

**What the fix does.** `Otter.jsx` gained one resolver, `sourceCourseOf`, which
looks a fork's source up in `softwareList`; the three `CourseRowMenu` sites pass
`sourceIsStandard`, which `maySuggest` now ANDs in. The prop defaults **false**,
so a fourth render site that forgets it loses the item rather than restoring the
dead end.

**Two things the original entry had wrong or missing.**

1. **Gating the menu item is not sufficient.** `RequestsView` opens
   `ChangeRequestDialog` directly through `Otter.jsx`'s `onOpenDialog` — it never
   touches `CourseRowMenu`. A proposer whose standard was demoted mid-review
   could still reach the submit form from their own queue. The dialog therefore
   makes the same check itself (`canPropose`), and its existing no-target empty
   state was widened to say *which* nothing this is: "wasn't copied from a
   standard" and "was, and that standard has since stood down" are different
   facts, and telling someone the first when the second is true reads as a bug.
2. **"Source not in my list" was the wrong test.** The entry proposed treating
   absence as "not a readable standard". Absence *is* safe — `otter_course_index`
   returns every `company_standard` course to every member (0022), so a live
   standard is always present — but it is not the case that bites. A **demoted
   standard stays in the list**; `handleCourseChanged` merges the new tier into
   the row in place. So the check must read `visibility`, not existence. A
   presence test (`!!sourceCourseOf(sw)`) would have looked right, passed review,
   and fixed nothing. `suggestChangeGating.test.js` pins this specifically.

**Not over-corrected.** `otter_cr_update` gates on *who* the caller is and never
on the target's visibility, so withdrawing an open request and accepting a
decline both still succeed after a demotion. Hiding the whole dialog would have
stranded a proposer with a request they could not close, so only the write half
is gated — pinned by a test, because it is the obvious one-line "simplification"
a later session would reach for.

**Still MEASURED at code level; NOT observed at runtime.** The suite is a source
scan (no jsdom in the tree), so it proves the gate is written and wired to all
four call sites. It cannot prove the item disappears on screen. A human
walkthrough — demote a standard, then open a fork's menu — is still owed.

### ~~Signing in to the desktop app hides O.T.T.E.R.’s local courses, with no way back~~ — FIXED (2026-09-07, `088dba8`)
Audrey’s decision 3. `setOtterAdapterMode` was referenced in two comments as "the
Settings override" and had **zero callers** since Session 10 — the fourth feature to
ship with none. It now has a control: O.T.T.E.R. → `SETTINGS` → `Tool Settings` →
**`Library`**, offering `Company (signed in)` and `This computer`, pinned per DEVICE
in `localStorage`. A notice on the library screen says which library is showing and
carries the way back, in BOTH directions, so recovery never depends on finding a
padlocked Settings tab. Phase 6’s pet index is cleared on the switch, or the pet
would keep answering from the library you just left for five minutes. A `local` pin
is refused on the web build, where there is no Express server to honour it.
32 breaker mutations red. ⚠️ **No human has clicked it yet** — walkthrough
`08_otter.md` steps 1–7.

### ~~There is no way to log out~~ — FIXED (S31, `272fb83`)
Deleted per the rule for this file. `SessionSection` is on the Profile tab
beside the password and 2FA controls, and it gates itself the way
`PasswordSection` does rather than offering a live button with no session
behind it.

🚨 **Two things that made this bigger than "add a button", both MEASURED:**

- **Sign-out was an unscoped GLOBAL revoke.** `supabase.auth.signOut()` with no
  `scope` argument revokes every refresh token the person holds. The operator
  console deliberately passes `scope: 'local'` for the opposite reason, and
  Audrey is both a platform operator and a workspace admin running two accounts
  in two browsers — so a Settings sign-out would have dropped her operator
  console at its next token refresh, minutes later, with nothing on screen
  connecting the two. Now `scope: 'local'`.
- 🚨 **Shipping the button alone would have been a REGRESSION.** `clearSession()`
  has never cleared the pet: the previous person's stayed in React state, kept
  decaying, kept auto-saving, and reappeared for whoever signed in next — on the
  web, and on the desktop where `pet.json` survives on disk regardless. That
  leak has been near-unreachable only because the sole sign-out control sat
  inside the MFA enrolment gate. The button and the teardown are one change.

⚠️ **The entry's own claim needed correcting.** It said there was no way to log
out; the MECHANISM has existed since S30 as `window.wilsonSignOut` and already
had exactly one caller — `MfaSection.jsx`'s "Sign out instead". So this added a
second caller to a live path, **not** a fourth built-with-no-caller feature.
Same correction `quiz.get` needed in S30: before writing "nothing calls this",
grep for it.

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

### ~~Welcome page has a phantom cursor~~ — FIXED (S43)
Deleted per the rule for this file. **The guess was right and the mechanism was
worse than the entry described.** `NewUserWelcome`'s `TerminalInput` set
`caretColor: 'transparent'` on its input AND rendered an `AuthCursor` beside
it — so the screen carried **one permanently-blinking `_` per field**, none of
which tracked focus, while the real caret was deliberately invisible. That is
why it "kept blinking on the right while typing elsewhere": it was never
attached to anything in the first place.

`AuthCursor` and its `@keyframes blink` are both gone (zero callers after the
fix — `NewCompanyWizard` held the other three), and the native caret is back
on. Confirmed in the running DOM: no element on the auth surfaces carries a
`blink` animation.

## From *UI overhaul (`feat/ui-overhaul`, merged nowhere) — left open at its close, P1 (2026-09-27)*, under *Behaviour and keyboard, left under C1 (no view or interaction change was allowed)* (lines 2007–2009)

- ~~**P1-01 · Enter toggles the pet.** MEASURED. `App.jsx` ~1404–1417: Enter on any focused button toggles the pet and never presses the button (every kit Dialog, drawer, picker; Space works). Owner: Audrey (C5), then a session. From A4-1, B3d, B4c-6, B5b-27.~~ — FIXED by post-overhaul S2a (2026-09-30, branch `po/s2a-settings-placement`, ruling C12): a bare Shift tap toggles the pet (`src/lib/companionHotkey.js`) and Enter presses the focused control, measured in the running app in all three tools (`05bf5fe`, hardened by `edb7fa9` and `07d34d6`). What is left of the class is in the S2a section at the end of this file.
- ~~**P1-03 · Home's document keydown listener runs on every page**~~ — FIXED by post-overhaul FX3 (`35265888`, its review round 2, R2-01, 2026-10-12): Home's handler acts only when `currentPage === 'home'`; measured by FX1 below. (`Home.jsx:134-197`): ArrowDown+Enter in O.T.T.E.R.'s Search went to /dog; it can swallow an Escape. MEASURED. From A4-3. S2a (2026-09-30): now that Enter presses the focused control everywhere else, this is the one place Enter can still do something different (after an arrow key on any page, Enter can open a Home destination). It also strands a kit Dialog: Search, left open when ArrowDown+Enter went to /dog, stayed registered, so on D.O.G. `overlayOpen()` was true, the Shift tap was dead and Tab never moved focus (the hidden dialog's trap found no visible control) until she went back and closed Search. MEASURED by S2a's review round 1 (B-R1-09). Owner: Audrey (Home is fonts-only under C3), or the kit (a Dialog on a hidden page should neither count nor trap). FX1 (2026-10-12): until FX3's fix reached FX1's branch, the same listener cancelled ArrowUp / ArrowDown in every number field and select on every page (the Scenes tab's frame counts and scene and shot numbers never stepped by keyboard, a Status select did not move), and Enter after one of them left the page: in a shot's Frames field ArrowUp then Enter opened `/settings`, ArrowDown then Enter `/dog` (MEASURED by FX1's review round 1, R1-01, and re-run by the session). After the merge (`b531a799`), in Playwright on the dev fixtures: in the shot table's Frames field and the shot popup's Frame count, ArrowUp twice took 2000 to 2002, ArrowDown back to 2001, and Enter stayed on `/rabbit`.

## From *UI overhaul (`feat/ui-overhaul`, merged nowhere) — left open at its close, P1 (2026-09-27)*, under *Older bugs and data, left under C1* (lines 2030–2037)

- ~~**P1-20 · The Projects page shows a project's dates one day early** ("Aug 2 – Dec 17, 2026" against 08/03 – 12/18 in its fields): a time-zone parse. MEASURED.~~ — FIXED by post-overhaul S1 (2026-09-30, branch `po/s1-timeline`, ruling B5): the page reads its dates through `src/tools/rabbit_v0.1.0/dates.js`, the one helper the Timeline and the Tasks view use.
- ~~**P1-21 · A new scene thumbnail shows late** in the ungrouped scene table (never handed `thumbRevision` / `onThumbChanged`). MEASURED. From B5b-18.~~ — FIXED by post-overhaul S3b (2026-10-01, `po/s3b-shot-lists-ui`): the table is handed both.
- ~~**P1-22 · A shot row's delete inside the scene popup also opens that shot.** MEASURED. From B5b-19.~~ — FIXED by post-overhaul S3b: its click stops at the button.
- ~~**P1-24 · "Files (N)" shows twice** in the popups / `FileManager`. MEASURED. From B5b-21.~~ — FIXED by post-overhaul S3b: the popups' own label went; FileManager's head says it once.
- ~~**P1-26 · Linked counts disagree:** `EntityListView` reads `level_id` while the sidebar reads `level_ids` ("Assets (1)" beside "0 assets"). MEASURED. **Wider (VW1's research, 2026-10-13, MEASURED on `?fixtures=game`):** the Tasks count is wrong too — it counts a task only under its first level (`taskCountById` reads the task's main `level_id`), so "Cliff Path", which fixture task 18 names second, reads 0 assets and 0 tasks in the table and in its window's *Linked counts* line while the window lists *Assets (2)* and *Tasks (1)* (`docs/sessions/handoffs/img/po-vw1-levels-05-window-counts-*.png`). Audrey ruled the fix (VW1's Q12); it is step 2 of `docs/design/CUSTOM_VIEWS_DESIGN.md` §7. *(2026-10-16, VW1m: the Tasks count now counts every task with an item of that level or experience; the Assets count is still VW1b's.)*~~ — FIXED by post-overhaul VW1b (2026-10-17, `aa270f73`): the Assets count and the window's *Linked counts* line read an asset's `level_ids` / `experience_ids` (Cliff Path reads 2 assets in its row and its window, `docs/sessions/handoffs/img/po-vw1b-*-08-levels-*.png`); the Tasks half was VW1m's.

## From *UI overhaul (`feat/ui-overhaul`, merged nowhere) — left open at its close, P1 (2026-09-27)*, under *Visual rows P1 did not close, and why* (lines 2051–2086)

- **P1-32b · ✅ CLOSED 2026-10-05 by post-overhaul S5p (see the end of this entry) — ~~🚨 With weekends hidden, Day zoom's pixel/day conversions outside the gantt pane ignore the hidden columns~~** (HIGH; older than S1; MEASURED by S1's review round 2 in the running app, 2026-09-30). `TimelineView` converts the gantt's scroll to days as `scrollLeft / DAY_PX` in the zoom re-anchoring, `changeZoom`, the visible window (`visibleStartDays` / `visibleSpanDays`, which place the minimap's window), `scrollDetailToDay`, the gantt's Today and the first-mount centring — only `DetailPane` holds the weekend mask. So with "Show weekends" off: Week → Day moved the gantt from 14 Sep to 11 Dec 2026 (+88 days) and Day → Week moved it back; at Day zoom the minimap's window reads 15 Sep – 6 Oct while the gantt shows December; the gantt's Today lands on 10 Dec, with today off screen; and toggling "Show weekends" does not re-anchor (`hideWeekends` is not in the effect's deps). With weekends shown every zoom change keeps its date (S1 measured 36 transitions). The fix: lift the mask (or a pure `weekendMask(start, days, dayPx)`) into `TimelineView`, record the anchor as a DAY through it, route those six conversions through one mask-aware x↔day pair (`dayIndexAtX` and its inverse), and add `hideWeekends` to the deps. Owner: a session — the next that edits `TimelineView.jsx` (S5), or its own small one. **Closed 2026-10-05 by post-overhaul S5p** (`po/s5p-timeline-weekends`: `50f9604d` the fix, `bb749c59` and `02ea371e` its two review rounds; integrated into `feat/post-overhaul-edit-versioning`; hand-off `docs/sessions/handoffs/po-s5p-2026-10-05.md`, walkthrough 48 §6). Reproduced first in the app on the fixtures, clock Thu 24 Sep 2026, at 1440x900 and 1280x700 — S1's numbers to the day: Week → Day Mon 14 Sep → Fri 11 Dec (+88); at Day zoom the window 15 Sep – 6 Oct against the gantt's 11 Dec – 12 Jan; Today 10 Dec at the left, today off screen; the switch 11 Dec → 14 Sep → 11 Dec; transitions 36/36 kept shown, 18/36 hidden. Fixed as proposed here: `weekendMask` built in `TimelineView` and handed to `DetailPane` (which builds none); one pair `dayAtX` / `xAtDay` (+ `visibleDayRange`) in `timelineMinimap.js` that the pane and the six conversions share; the anchor a DAY (`anchorDayRef`); `hideWeekends` in the re-anchoring's deps. After: +0 days; the window brackets the gantt; Today centred, its line on screen; the switch keeps the date both ways; 36/36 in both settings; the window still slides on the zoom tabs (32/32 frame by frame, `scripts/timeline-window-slide.mjs`); with weekends shown the state shots move nothing but a dependency arrow that differs between two runs of the same code. **Found and fixed beside it** (not the mask's): the minimap's click and window drag used the scale of the last schedule rebuild — Week's 22px from the Timeline's opening — so at Day zoom a click landed 207 days early with weekends shown (154 hidden); `scrollDetailToDay` is a callback on the scale and the mask now. **Found and NOT fixed:** a bar's move and resize with weekends hidden (P1-32a, still open: it needs a rule for an end that lands on a hidden day); P1-32c untouched. Instruments for the next session: `scripts/timeline-weekends-probe.mjs <port>` (exits 1 on any moved date), `scripts/timeline-window-slide.mjs <port>`.
- ~~**The Summary's missing-files notice is hand-drawn**~~ **Closed by post-overhaul S4a (`7cd5914`, 2026-09-30):** the notice moved with Relink to R.A.B.B.I.T.'s Files tab, on the kit Banner (warning tone, the Relink… button in its action slot); `ProjectFilesExplorer.test.jsx` pins it. As filed: (`ProjectSummaryView.jsx`, the relink notice: a `color-mix` warning tint, its own hairline, a kit Button inside), where the kit Banner has the warning tone and an action slot, as Storage's load error now uses (P1-39). READ in code at P1's close (review round two's mono fix touched its sentence); not reached by P1.

## From *Post-overhaul S2a (`po/s2a-settings-placement`) — left open (2026-09-30)* (lines 2281–2303)

- ~~**S2a-01 · 🚨 Bins' document keys act from every page**~~ **Closed by
  post-overhaul S4a (`643c61b`, 2026-09-30):** BinsView takes `pageActive`
  (Rabbit passes `currentPage === 'rabbit'`; it defaults closed), and the
  handler also stands down under a kit Drawer, which the overlay stack
  cannot see. With R.A.B.B.I.T.'s settings drawer open over Bins, Delete
  on its buttons had removed the selected files and Escape had cleared
  the selection instead of closing it. `binsView.test.jsx` plants the old
  handler and goes red. The entry as filed: (`BinsView.jsx`
  ~520–585). The handler has no page check, and R.A.B.B.I.T. stays mounted
  with Bins as its view, so while a Bins file is selected its keys act on
  whatever page she is on: Enter (when not on a control) is cancelled and
  starts a rename she cannot see; ↑/↓ move the hidden selection; S, R, U
  and C flag or circle the selected files; 0–8 colour them; **Delete or
  Backspace removes up to five selected files from the bin without a
  question** (six or more ask, on the hidden page); Ctrl+Z/Y undo and redo
  in R.A.B.B.I.T. MEASURED for Enter by S2a's review round 2: with a file
  selected in Bins, a bare Enter on D.O.G.'s page was taken, so D.O.G.'s
  "Enter generates" did nothing (S2a no longer lets a cancelled Enter stop
  D.O.G., B-R2-01). INFERRED from the same handler for the other keys;
  would settle it: select one file in Bins, open D.O.G., click the page,
  press Delete, go back. A removal can be undone from R.A.B.B.I.T.'s
  history. Owner: the next session that edits `BinsView.jsx` (S4a): gate
  the handler on R.A.B.B.I.T. being the current page and Bins its view.

## From *Post-overhaul S2b (`po/s2b-otter-functions-lesson`) — left open (2026-09-30)* (lines 2360–2456)

- ~~**S2b-01 · The pet reads a nameless function category as no group.**~~
  `petKnowledge.js` (`flattenDoc`) labels a function category
  `cat.category || cat.name || ''`, so her Python library's 46 functions
  reach the pet with an empty group where O.T.T.E.R.'s views now say
  "General" (and a category whose name is not a string is read raw).
  INFERRED from the code by S2b's review round 1 (A-L6). Owner: the next
  session that edits `petKnowledge.js`: read it through
  `functionCategoryName` (`adapters/otterRoutes.js`).
  **Closed by S2c (`po/s2c-otter-tidy`), 2026-10-05:** reproduced on her
  real library, then fixed — `flattenDoc` reads `functionCategoryName`;
  her Python's 46 rows reach the pet as "General" (before: ""), and the
  pet's reference line reads "[Python → functions → General]"
  (`node scripts/otter-library-replay.mjs pet`).
- ~~**S2b-03 · The outline page's "[outline]" is clipped, or lost, when the
  subject title nearly fills the column.**~~ The subject (`.otter-crumb-current`,
  capped at the line) and the note do not share the line: a subject within
  about 50px of the column pushes "[outline]" out of sight. MEASURED by S2b's
  review round 2 (B-L1) on stress titles; her real subjects (296px at most)
  only meet it below a 345px column, and the outline page's column is 595px
  or more at every window measured. A fix (measured by the reviewer):
  `.otter-crumb-current:has(+ .otter-crumb-note) { max-width: calc(100% -
  4px - 3.84em) }`. Owner: the next session on O.T.T.E.R.'s reading pages.
  **Closed by S2c (`po/s2c-otter-tidy`), 2026-10-05**, and corrected:
  measured at 1440 and 1280, "[outline]" is never clipped — it is placed
  first and keeps the line; the SUBJECT, and the course with it, wraps out
  of sight from 568px (of 612.61px), and the line reads "[outline]" alone.
  Fixed with the reviewer's cap, scoped by the outline page
  (`.otter-view-page[data-width='subject'] .otter-crumb-current`, which
  typeScale's cascade judge models; it reads `:has()` as reaching every
  crumb) and at `4em`, not `3.84em`: the note is 46.03px (3.836em), so
  3.84em left 0.05px, and a note 0.09px wider lost the subject again
  (measured); at 4em, none. Her 49 subjects and 42 stress titles at seven
  sizes and scales: subject and note on the line every time, nothing
  taller than a line; her own pages' shots byte-identical before and after.
  The price, admitted (review round 1): a subject in the 2px between the
  two caps (560.6–562.6px on the 612.61px line) ends in "…" where it fitted.
  And (review round 2) the note's own box is that 4em exactly
  (`flex: 0 0 4em; min-width: 0`), so subject and note always make the
  line however wide a font draws "[outline]": with the note's text 6px
  wider, the subject is still never lost (at worst its "]" is clipped).
- ~~**S2b-04 · The breadcrumb's accessible names are not the convention.**~~
  "Where this lesson sits" / "Where this subject sits" (A3's) where
  "Breadcrumb" is what screen-reader users expect, and the run's zero-width
  space shows as its own text node in the accessibility tree. From S2b's
  review round 2 (B-L4). Owner: the next accessibility pass.
  **Closed by S2c (`po/s2c-otter-tidy`), 2026-10-05:** both breadcrumbs are
  named "Breadcrumb", and both zero-width spaces (the course's too) carry
  an empty alternative text (`content: '\200B'; content: '\200B' / ''` —
  the plain one first for a browser without the syntax, review round 1;
  the production build keeps both). Measured in Chromium's accessibility
  tree: before, 2 and 1 zero-width StaticText nodes; after, 0. Nothing
  visible changed.

## From *Post-overhaul S4a (`po/s4a-files-ui`) — left open (2026-09-30)* (lines 2502–2576)

- ~~**S4a-02 · The Legal tag restricts nothing yet.**~~ **Closed by S4b
  (`po/s4b-legal-gate`, migration 0088), once 0088 is applied:** Audrey
  ruled on 2026-10-01 that a Legal file is seen by "same as money files for
  now" and that Legal is chosen when the file is added. A Legal file now
  lives under the project's `LEGAL` folder, which joins `INVOICES` and
  `FINANCE` in the one list of locked folders; its row, its bytes, its
  thumbnail and its events are for workspace admins and the project's
  managers only, and the tag can no longer be ticked on an existing file.
  See S4b below for what is left.
- ~~**S4a-05 · A load-sensitive flake**~~ **Fixed in the same bundle, in the
  test only:** `rabbitEntityViewsRender.test.jsx`, Levels and Experiences,
  "the task form hands focus back to 'Add new task'…". Measured red in 4
  of 20 full-suite runs on `po/s4a-files-ui` and 0 of 11 on its base
  `7c9c3b2`; the extra test files added load. The product was right. The
  form closes when `addTask` resolves, outside any event, so React runs
  the hand-back effect on the scheduler, and a loaded runner let
  `waitFor` settle one tick before it. The check now waits for the
  hand-back. With the hook removed it still fails, on that line alone
  (proved with the earlier checks taken out). Green in the next 5 of 5
  full runs.

## From *Post-overhaul S4b (`po/s4b-legal-gate`) — left open (2026-10-01)* (lines 2617–2626)

- ~~**S4b-04 · A desktop file tagged Legal during S4a's label period stays
  in the project's files folder.**~~ **Fixed in the same bundle (review
  rounds 1 and 2):** the Local Server removes such a LABEL once per project
  (`electron/legalFiling.cjs` `settleLegalLabels`; the ids stripped are kept
  in the bundle's `legalLabelsSettled`) — on a managed file, on an invoice,
  and on a project file whose body is in the files folder rather than a
  `LEGAL` one — as 0088 §2 strips the cloud's once. A Legal row whose body
  is in `LEGAL`, or missing altogether, keeps its tag; a project is not
  settled while its folder is offline or any labelled file's body is found
  nowhere (an unplugged drive), and is asked again on the next read.

## From *Post-overhaul S3c (`po/s3c-edits`) — left open (2026-10-02)* (lines 2876–2896)

- ~~**S3c-06 · "Recover unsaved edit?" says "WILSON closed" after a browser
  tab was reloaded too.**~~ Closed in S3c's review round 2 (R2-03): it says
  the edit "was left unsaved", true of a closed window, a reloaded tab and
  a sign-out alike; and a copy is removed under its own person when a save
  finishes after a sign-out (it was offered back as unsaved).
- ~~**S3c-09 · On the cloud the Scenes tab still binds Ctrl+Z only with an
  unsaved edit on screen** (then the draft's own undo, on every backend);
  otherwise S3b-03 stands. Owner: Audrey (with S3b-03).~~ No longer true
  (FX4's review round 1, 2026-10-12): since BC1 (`0b38077c`, 2026-10-07)
  `supportsBins` is true on the cloud, so the Scenes tab binds Ctrl+Z there
  as on the Local Server; after FX4's Save edit, Ctrl+Z takes the save back
  on both. Help's Undo card says so.

## From *Post-overhaul S5 (`po/s5-budget-versions`) — left open (2026-10-05)* (lines 2932–2951)

- **S5-01 · CLOSED by S5b (2026-10-05): MEASURED, then guarded.** A
  rolled-back probe on wilson-dev as a project member changed all nine of
  0036's budget columns, the lock included (21/21 collected); 0090's
  `trg_projects_budget_settings_guard` now refuses a change to any of them
  unless the caller passes the money gate (suite 92 probes a member, a
  workspace manager with a member seat, a reviewer, a manager, an admin, an
  unchanged re-send and the lock FK's SET NULL). `budget_total` /
  `budget_currency` (0000) are NOT guarded — S5b-01 below. The entry as it
  stood: **A project MEMBER can change the project's money settings
  directly** (INFERRED from the policies, not run): `projects_update`
  (0013) admits every `can_write_project` caller to every column, and no
  trigger guards `budget_margin_pct`, `budget_contingency_pct`,
  `budget_agency_*`, `budget_actual_column_*`, `budget_active`,
  `budget_active_version_id` or `budget_finalized` (0036 added them
  unguarded). The Budget tab is hidden from a member, and 0037 keeps the
  money TABLES from them, but a PATCH of `projects` from devtools lands. 0089
  guards only its own new column (`open_budget_version_id`), as the brief
  asked; the existing money gates were "untouched" by ruling. Owner: a
  schema session (a guard on those columns, the 0084 §7b shape) — Audrey
  to say whether a member may ever touch them.

## From *Post-overhaul S5b (`po/s5-budget-versions`, the continuation) — left open (2026-10-05)*, under *S5c (2026-10-05, the Budget half — `docs/sessions/handoffs/po-s5c-2026-10-05.md`).* (lines 3021–3043)

- **S5b-06 — CLOSED by S5c** (`20542394`): the Summary's versions table,
  its inline activate panel and every adapter write left `BudgetView.jsx`;
  every version write is the provider's mutators (one undo step each, no
  reload), and a source pin in `rabbitBudgetRender.test.jsx` holds it.
- **P1-32a, the Budget's half — CLOSED by S5c** (`04b0a4ce`): Crew/team's and
  Talent's period headers read the project's start through `dates.js` and
  step on the calendar (`views/budget/periodLabel.js`). The rest of P1-32a
  (ProjectAssetsView, NotesView, holidays.js, the Timeline's TODAY) is not
  S5's and stays open there.
- ~~**S5c-03 · The Timeline's version control, the help pages and walkthrough
  55's second half** are S5d's (steps 6 and 9).~~ — CLOSED by S5d (below).

## From *Post-overhaul S5b (`po/s5-budget-versions`, the continuation) — left open (2026-10-05)*, under *S5d (2026-10-05, the Timeline half and the bundle's close — `docs/sessions/handoffs/po-s5d-2026-10-05.md`).* (lines 3066–3070)

- **S5c-03 — CLOSED by S5d** (`2f33d361`, `d5197073`, `126907f0`, and the
  review rounds' commits in the hand-off): the Timeline's bid version bar
  (the toolbar's second row, past the money gate only), viewing a version
  read-only as a span move, the lock greying the bar with its reason; the
  "Budget" and "Timeline" help pages; walkthrough 55's second half.
