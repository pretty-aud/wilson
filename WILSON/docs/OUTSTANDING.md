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

### ~~Anyone with the anon key can create a company — `provision-workspace` is public~~ — CLOSED (S43 removed it; deployed nowhere, re-verified 2026-09-04)
Deleted per the rule for this file. S43 deleted `NewCompanyWizard.jsx`, the
`'new-company'` authMode, the login screen's "New company?" link and
`supabase/functions/provision-workspace/` (zero callers, verified by BUNDLE),
and the deployed function is gone as well: `supabase functions list
--project-ref` on wilson-dev, wilson-staging and wilson-prod returns **no
`provision-workspace` row on any of them** (first measured 2026-08-14,
re-measured 2026-09-04). The entry that stood here went on saying the endpoint
was LIVE for three weeks after it was not. A deploy is recorded nowhere in the
repo, so **check `functions list` per project before believing any note about
what is deployed.**

✅ Company creation still works throughout: the operator console's
`Companies → New company` (`src/admin/CompaniesSection.jsx`) calls
`operator-workspaces`' `create` behind `requirePlatformOperator`, and hands
back a show-once password.

📌 **The emailed setup link Audrey asked for is BUILT and NOT USABLE YET** —
S43b, `186fa63` + `df257d0`, migration 0066. Measured 2026-09-04: 0066 is
applied on dev and staging (the `platform_audit` action CHECK carries
`workspace.invite_sent` on both; prod is at 0063 and does not), but
`operator-workspaces` has not been redeployed on any project since 2026-08-08
(dev v11, staging v9, prod v9), so the console's send button calls a function
that does not know the action and fails. What is owed is one deploy per
environment — `supabase functions deploy operator-workspaces --project-ref
<ref>` — and 0066 must precede it (already true on dev and staging; on prod,
0064 and 0066 first). In the wrong order the send reports success and writes no
certificate. A deploy step, not a defect; the S43b commit messages' "applied to
NO environment yet" is out of date.

---

## Broken features

### The two-factor enrolment screen overflows the sign-in shell's band at laptop heights
**REPORTED by Audrey (2026-09-07, screenshot at roughly 824px tall); cause
read from the code, not yet measured in a browser.** `MfaEnrollGate` renders
inside `AuthShell`, whose split-phase bars are `SPLIT_BAR_HEIGHT = 24vh` each,
so the light band is 52vh — sized (Session 43) for the 330px login form. The
enrolment content (heading, two-line blurb, QR panel, secret, code field,
button, two links) is roughly 490px, so at 824px the band is about 428px and
the heading and the two links sit on the dark bars. The login form fits; this
screen does not. Owner: Track B (`src/cloud/auth/`). Fix shape: let the
shell's bars shrink when the child is taller than the band (never below the
reveal height, which Home's bars must still meet) or scroll the child within
the band; verify with a screenshot at 824px AND at the 700px minimum window,
on the web and the desktop.

### `otterContext` is written on every O.T.T.E.R. navigation and read by nothing

**OBSERVED (2026-08-14, Phase 6.)** `App.jsx` declares
`const [otterContext, setOtterContext] = useState(null)` and passes
`onContextChange={setOtterContext}` to `<Otter>`, which fires it with
`{activeSoftwareSlug, activeSubjectSlug, selectedLessonId}`. The **value** has no
reader anywhere in the repo. This is the tenth instance of the no-caller shape,
after the folder tree (S27), task templates (S28), quiz history (S30),
`setOtterAdapterMode`, `workspaces.storage_mode`, `POST /api/pet/reset`, S31's
settings half and S37's `storageSecretClear`.

Phase 6 deliberately did **not** consume it: the pet must answer a Blender
question from any page, so scoping retrieval to the last-opened course would be
wrong. It is recorded here rather than fixed because deleting it is a judgement
about whether anything is meant to use it.

⚠️ **Note for whoever greps for this:** `grep otterContext` is case-sensitive and
matches only the declaration — the writer is spelled `setOtterContext`. That is
how a first pass this session concluded, wrongly, that it was never written.

### The companion prompt tells the model to emit links against a context block that does not exist

**OBSERVED (2026-08-14, Phase 6.)** `COMPANION_PROMPT` (`prompts.js`) says:
*"Use `[[nav:type:slug|Display Text]]` for clickable links to pages in the
LINKABLE PAGES context."* There is exactly one repo-wide hit for **LINKABLE
PAGES** — that sentence. Nothing assembles such a block, so the model is being
told to link against a list it never receives.

Downstream, `handleCompanionNavLink` parses the slug out of a nav string and then
discards it: both branches call `navigateTo('otter')` identically, so every
course, subject and lesson link lands on the O.T.T.E.R. root.

Phase 6's injected block instructs the model **not** to emit `[[nav:]]` links for
course content, and injects titles rather than slugs, so it does not make this
worse. Fixing it properly means either assembling a real LINKABLE PAGES block
with deep-link targets, or removing the instruction.

### The pet reads the courses in chat mode but not in agent mode

**OBSERVED (2026-08-14, Phase 6.)** `PetCompanion.jsx` picks the send handler
with `activeOnSend = agentMode ? onSendAgent : onSendChat`, and Phase 6's
retrieval lives in `sendChat`. With the wrench toggled on — which is only offered
on the O.T.T.E.R. page, via `agentEnabled={onOtterPage && agent.agentEnabled}` —
the pet stops reading lesson content.

Deliberate for now: agent mode is a different feature with its own prompt, its own
`AgentProvider` context assembly and an approval gate on every write, and giving
it retrieval is a design question rather than a port. Recorded because the
behaviour changes under a toggle with no explanation on screen.

### The pet does not sync live between machines, and a second open window writes its stale copy back

**INFERRED (2026-08-12, Phase 3).** The account pet is read once, by an effect
keyed `[perms.ready, perms.userId]`. There is no subscription and no refetch, so
a computer left open never learns that the pet changed elsewhere — and the moment
anything touches the pet there (a decay tick reaching death, a difficulty change,
petting), `savePet` writes that machine's stale copy over the account row.

Phase 3 makes this visible in a new place: create an egg on PC A while PC B is
open on the old ghost, and B can put the ghost back. The Create Egg path itself
is now correct on both machines; what is missing is propagation.

Practical mitigation until it is fixed: close WILSON on the other computer before
creating an egg. This is the same class as the known two-tab clobber recorded
against `localData.js`, but it now spans machines rather than tabs.

### The pet requires Supabase even on the Local Server adapter

**INFERRED (2026-08-12, Phase 3).** `savePet` routes on `petUserIdRef.current`,
which is correct — the pet follows the person. But the app is behind a mandatory
sign-in, so that ref is effectively never null in normal use, and the
`savePetData` → `POST /api/pet` branch is reachable only in the sub-second window
before permissions resolve.

The consequence for the Phase 3 brief's "works on desktop in **local** mode":
with the Local Server adapter selected but no network, Create Egg fails, now
reports the failure on Settings, and the ghost returns on reload. The egg is
never written to `pet.json` as a fallback, because `mirrorPetToCache` runs only
after `saveCloudPet` succeeds.

This is S31's design rather than a Phase 3 regression — one pet per person cannot
also be a per-device file — but the "local mode" line in the brief is not
satisfied on its own terms and no one has recorded the reinterpretation. Decide
whether an offline pet is meant to exist at all.

### A pet saved as a `corpse` never becomes a ghost

**INFERRED (2026-08-12, Phase 3).** The live decay tick sets `form = 'corpse'`
(`App.jsx`, death check) and only a **10-second `setTimeout` inside that same
tick** promotes it to `'ghost'`. `form` is part of `petMaterialSignature`, so the
corpse is persisted the moment it happens — to the account row, not just the
cache. Close the app, reload or sign out inside those 10 seconds and the corpse
is the stored state forever: `applyOfflineDecay`'s guard excludes `'corpse'`, and
the decay interval's first line excludes it too, so nothing ever moves it again.

Phase 3 made this **recoverable** — `canCreateNewEgg` accepts `corpse` as well as
`ghost` (`src/lib/petLifecycle.js`), so the Create Egg button works from that
state instead of being visible-but-refusing. The state machine itself is
unchanged: the pet still renders as a corpse indefinitely, and a user who does
not press Create Egg has no way forward.

Would settle it: kill the app within 10s of a death, reopen, and read
`form` from `user_pets`. Fixing it means completing the transition on load
(promote a `corpse` whose `diedAt` is more than 10s old), which is a change to
the death rules and was explicitly out of scope for Phase 3.

### Turning Pet Mode OFF does not protect the pet while the app is closed

**INFERRED (2026-08-12, Phase 3).** The live decay tick short-circuits on
`if (!prev.petMode) return prev`, but `applyOfflineDecay` never reads `petMode`
at all — it decays from the `lastUpdatedAt` anchor regardless. So switching Pet
Mode off does not pause starvation, it defers the whole elapsed interval to the
next launch, and the pet can be found dead on reopening. The same function also
ends no sleep and performs no evolution, so a pet asleep at close is immortal
offline and a baby cannot grow while the app is shut.

Would settle it: set `petMode` false, set `lastUpdatedAt` back several hours in
`user_pets`, reload, and read the resulting `hunger`/`form`.

### The per-device pet cache is keyed to the machine, not the account

**INFERRED (2026-08-12, Phase 3).** `getDataDir()` in `electron/main.cjs` has no
user segment, and `PET_KEY` in `src/lib/localData.js` is one `localStorage` key
per origin. Nothing anywhere removes either on sign-out — `SessionSection`
records that the disk copy survives deliberately, on the grounds that the React
state leak was closed. But `resolveUserPet` still **reads that uncleaned copy**
to make its adoption decision, so on a shared computer person A's pet can be
lifted into person B's account when B has no pet row of their own. Suite 56
proves an admin cannot read a member's pet through RLS; this hands one person's
pet to another underneath RLS, through the filesystem.

Phase 3 narrowed the blast radius — adoption now happens only when the account
has **no** row at all — but did not close it.

Would settle it: sign out on the desktop, sign in as a second account with no
`user_pets` row, and read that row afterwards.

### A failed cloud pet read leaves the stale device pet routed to the account

**INFERRED (2026-08-12, Phase 3).** In the sign-in effect `petUserIdRef.current`
is set unconditionally, *before* the async block. If `resolveUserPet()` then
throws, the catch deliberately does not clear or replace `petData` — so the app
keeps rendering the **stale device pet** while `savePet` now routes writes to the
**account**. Any interaction, or the decay tick reaching death, writes that stale
pet over the account row, with no adoption decision and no staleness check. A
transient Supabase blip on the second computer is enough to overwrite the first
computer's pet. The S34 storage-root effect two blocks below refuses to act on a
failed read for exactly this reason; the pet effect does the opposite.

### The `user_pets.feedback` size cap is untested, and Create Egg is the statement most likely to trip it

**INFERRED (2026-08-12, Phase 3).** `0046` carries
`CHECK (pg_column_size(feedback) <= 262144)` and claims in comments that it sits
far above anything a conversation can produce. Nothing tests that claim. Feedback
entries store the assistant reply **untruncated** (the 2000-char truncation
applies only to what is sent to the model), replies run at `max_tokens: 1024`,
and the array keeps the last 50 — the same order of magnitude as the cap.

Create Egg carries the entire feedback array into the new pet by design, so it is
the write most likely to hit the ceiling. A violation throws inside
`saveCloudPet`; Phase 3 now surfaces that on the Settings page rather than
silently, but the egg would still fail to persist. Suite 56 probes `feedback`
for array-ness only and has **no probe of the size cap, and no accepting control**
proving a maximal legitimate payload is allowed.

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

### A dependency rewire deletes before it links, so a failed link is data loss

**INFERRED (2026-08-11, code reading).** `beginDependencyRewire`'s `onUp` calls
`onUnlinkDependency(dep.id)` and only then `onLinkTasks` / `onLinkPhases`, with
neither awaited and no `ctx.runBatch` wrapper. If the link half is rejected —
the commonest case being the `unique (predecessor_id, successor_id)` constraint
when the target edge already exists — the unlink has already committed and the
gesture is a pure delete.

Two compounding details, both pre-existing:

- `optimistic()` reads `snapshot = bundleRef.current` synchronously, and
  `bundleRef` is only refreshed by an effect, so both writes in that tick
  capture the SAME pre-gesture snapshot. The rollback therefore redraws the
  arrow that was genuinely deleted — the chart shows an edge the database no
  longer has, until the next load.
- It pushes two separate history entries, so one Ctrl+Z undoes half a rewire.

Phase 2 made the failure *visible* (the "Not saved" strip) but did not make the
gesture atomic. The honest fix is to await the unlink and only then link, or to
wrap both in `runBatch`. Not attempted this phase because it changes undo
semantics and deserves its own test.

### The cloud dependency loader is workspace-scoped, not project-scoped

**INFERRED (2026-08-11, code reading).** `listDependenciesWith` filters on a
NON-inner embed (`.eq('predecessor.project_id', …)` with no `!inner`), which in
PostgREST filters the embedded resource rather than the top-level rows — so the
server left-joins and rows belonging to other projects come back with
`predecessor: null`. `task_deps_select` (0004, never revised by 0013) scopes to
the WORKSPACE, so `ctx.dependencies` carries every project's edges. The adjacent
`task_links` fetch uses `tasks!inner` and is correctly scoped; the two lines were
written differently and behave differently.

**No user-visible symptom today:** `visibleDeps`, `buildSchedule` and
`selectCriticalPath` all drop edges whose endpoints are not in the current
project's lookup.

🚨 **Deliberately not fixed in Phase 2.** Adding `!inner` means combining a
constraint-name hint with a join modifier
(`tasks!task_dependencies_predecessor_id_fkey!inner`) — a form that appears
NOWHERE else in this repo and has therefore never been executed against a real
PostgREST. That query is the one that draws every dependency arrow in the
product, and it ends in `.catch(() => [])`. Getting it wrong empties every Gantt
silently. → Fix it in its own change, and settle the syntax first with one
authenticated GET against staging before pushing anything.

### Deleting a task or a phase leaves orphaned dependency rows on the desktop

**INFERRED (2026-08-11, code reading).** `electron/main.cjs` backs both deletes
with the generic `rabbitSubentityRoutes` DELETE, which splices only the target
collection — there is no cascade and no dependency sweep, so edges referencing
the deleted row stay in `project.json` and are re-mirrored into
`{Slug}_DATABASES/tasks.json` and `timeline.json` on every write. `RabbitProvider`
prunes the CLIENT bundle, which masks it for the session; they return on reload.
Cloud is unaffected (0061's `ON DELETE CASCADE` on a hard delete; a soft-deleted
parent keeps its edges deliberately so they return on restore).

Harmless to render — every consumer skips edges with unknown endpoints — but the
two backends diverge, and the orphans accumulate.

### A desktop→cloud migration silently drops the whole dependency graph

**INFERRED (2026-08-11, code reading).** `src/cloud/migrate/runMigration.js`
inserts projects, phases, assets, tasks and files. The word `dependencies`
appears in it exactly once, inside a comment describing
`localServerAdapter.loadProject`'s return shape. There is no write to
`task_dependencies` and none to `phase_dependencies`. A user who migrates a
desktop project to the cloud arrives with an empty Gantt link set, no error, and
no indication anything was lost.

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


### Every input on every light page is under AA, and it is not the grey problem
**MEASURED (2026-08-10, S43 §B).** WILSON's light-page input well is
`rgba(120, 70, 30, 0.55)` over `#f4a261` (visual-language §Inputs). Composited,
that is `#b06f3c`, and:

- the `#fde8d0` it is actually paired with measures **3.38:1**
- black on it measures **4.32:1**

Both under the 4.5:1 AA floor for normal text. Neither ink rescues it — the
WELL is the problem, not the text on it.

This is **pre-existing and distinct from the grey complaint S43 fixed**: it was
found because the new `lightSurface` contrast test refused to accept the value
as a token, not because anything looked wrong on screen. It is recorded rather
than fixed because changing that well restyles every field on Home, Settings,
Projects, Rate Card, Team Members and the Admin Terminal at once, on a guess
about what Audrey wants them to look like.

→ Fixing it means choosing a new well and re-pairing the ink — a design
decision, not a repair. `src/components/lightSurface.js` carries the numbers
and deliberately does NOT export the value, so nobody adopts it by accident.

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

→ **One thing from the old entry survives and is now its own item below**:
`useRosterMembers` swallowing the RPC error.

### `useRosterMembers` cannot tell a broken roster from an empty one
**INFERRED (S23, unchanged).** Split out of the assignee-dropdown entry above
when that closed, rather than deleted with it. `ProjectTasksView`'s dropdown is
on the healthy `workspace_directory()` path and intersects correctly — but if
the roster ever resolves to `[]`, the staffed branch filters an empty list and
yields `[]` too, and the hook **drops the error** rather than passing it
through. So an RPC failure and a genuinely empty workspace are indistinguishable
at every call site. Not currently biting anything; it is what would make the
next roster problem take a session instead of a minute.
→ Surface the error. Not scheduled.

<!-- historical, kept for the reasoning:
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
-->

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
- ⚠️ **`maySuggest`'s dead-end (next entry) gets worse with this feature**:
  approving a nomination DEMOTES the incumbent standard, so every fork of it
  immediately starts showing a "Suggest a change…" item whose POST cannot
  succeed.

### A manager can approve their own nomination
**MEASURED in code (2026-08-12, Phase 5); decision owed by Audrey.** The
nomination RPC checks the caller's role, not authorship, and the UI only hides
the decide controls on your own row — the route is open. So a manager can
nominate their own course and approve it in one sitting: an unreviewed
self-promotion path. Deliberate for now, because a manager already holds the
authority to promote by hand, and **Audrey has not ruled on it.** Split out of
the closed entry above on 2026-09-04 so it does not sit under a FIXED heading.
→ If she wants it closed: refuse in the RPC when the nominator is the caller,
with a pgTAP probe and a breaker.

### "Suggest a change…" is offered on forks of a demoted standard, where it cannot work
**MEASURED at code level (2026-08-12, Phase 5); NOT observed at runtime.**
`CourseRowMenu`'s `maySuggest` gates only on `!!course?.source_course_id` — it
never re-checks that the source is *still* `company_standard`. If an admin demotes
a standard (the `confirmDrop` path in `ShareCourseDialog`), every existing fork
keeps showing the menu item, `ChangeRequestDialog` renders its full submit form,
and only the POST fails, at RLS, with *"Change requests can only be raised against
a company standard course."* The user is offered a control that cannot succeed.

Not fixed in Phase 5 because the check needs the caller to resolve
`source_course_id` against `softwareList` (`CourseRowMenu` only receives one
course), and "source not in my list" would have to be treated as "not a readable
standard" — correct, but worth a deliberate look rather than a drive-by.

### `POST /api/software` on the local server silently discards `visibility`
**MEASURED at code level (2026-08-12, Phase 5); latent.**
Both O.T.T.E.R. create paths send a `visibility` field (`generateCourse` and the
agent path). `electron/main.cjs` drops it, and the caller's guard
(`if (!metaRes.ok || !meta?.slug)`) cannot detect the loss. Harmless **today**
only because the tier picker is wrapped in `{isCourseMode && cloudMode && …}`, so
the field is never sent on the backend that ignores it. It becomes a real bug the
moment anything offers tiers outside cloud mode.

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

### ~~The pet and per-user settings do not follow the user between computers~~ — FIXED (S31, `272fb83` + `29d36fc`)
Deleted per the rule for this file. Migration 0046 creates `public.user_pets`
and `public.user_settings`, applied and verified **by query** on dev, staging
and prod: 8 policies, 0 `FOR ALL`, **0 workspace-scoped, 0 membership-gated, no
`workspace_id` column**, nothing held by `anon` or `PUBLIC`. pgTAP 56 + 57 are
48 assertions, proven by seven breakers including a control.

**Four things worth carrying forward, three of which contradict the plan
documents that scoped this:**

- 🚨 **"Store `last_fed_at` and compute on read" described behaviour the code
  does not have.** MEASURED: `lastFedAt` is written by `handleFeed` and **read
  by nothing** in `src/` or `electron/`. The decay anchor has always been
  `lastUpdatedAt`. Building to the note would have anchored decay on a field
  with no meaning.
- 🚨 **The census was wrong in both directions and still overstates the
  precedent.** The real figures on wilson-dev are **45 policied tables, 40
  workspace-scoped, 2 touching `auth.uid()` without a workspace** — and neither
  of those 2 is a usable precedent. `auth_attempt_log` is **not per-user at
  all** (it has a `workspace_id` column; it matches an `auth.uid()` text search
  only because its operator check reads `platform_operators.user_id =
  auth.uid()`), and `platform_operators_self` is **SELECT-only**. 0046 writes
  the project's first per-user INSERT/UPDATE/DELETE policies.
- 🚨 **The fix was DELETING the 30-second auto-save, not adding sync.** On a
  shared row that timer *is* the clobber. It was worst where it looked safest:
  the decay reducer returns the identical object reference for an egg, a corpse,
  a ghost or `petMode` off, so `petData` never changed, the effect was never
  torn down, and it fired cleanly over the other machine's state. **Audrey's own
  pet is a ghost — one of those four.** Nothing was lost: hunger and happiness
  are a value at an anchor, so decay needs no writes at all.
- 🚨 **The adoption danger was the ORDER, not the blank default.** The app mints
  and persists a pristine egg the first time it reads an empty store, on every
  host it has run on — so a second computer that has merely been *opened* already
  has a "pet", and uploading it would have destroyed Ollie. `isRealPet()` is the
  discriminator; a pristine egg can never beat anything.

⚠️ **`0046` is also the first table where an admin cannot read a member's row.**
That is deliberate — a pet and someone's own edited prompts are not business
records — and suite 56 pins it.

<!-- historical, kept for the reasoning:
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
-->

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

### `ResetPasswordWizard` still performs a global sign-out
**MEASURED (S31, 2026-08-05).** `src/cloud/auth/ResetPasswordWizard.jsx` calls
`supabase.auth.signOut()` with no `scope` argument, so completing a password
reset revokes every refresh token the person holds — including the operator
console's — with no copy saying so. Found while fixing the same defect in
`App.jsx`'s `wilsonSignOut`.
→ Deliberately **not** changed in S31: what a password reset should revoke is a
security decision, not a tidy-up. Arguably a global revoke is *correct* there.
Needs a decision, then one line either way. Not scheduled.

### A failed pet LOAD has nowhere to show itself
**MEASURED (S31).** `loadPet` was the one function in `localData.js` that S30
left with neither a `res.ok` check nor a reported catch; S31 makes the failure
representable (it sets `petSaveError`) but **not visible**, because when the
load fails `petData` stays null and `App.jsx` renders no companion at all — so
the component that would display the message is unmounted.

The same gap applies to the existing save banner: `PetCompanion` renders it only
**inside the chat popup**, so a save failure is invisible unless the user opens
the companion chat and the pet has hatched. S30 made the failure representable;
neither session has made it visible.
→ Needs a surface that does not depend on the pet rendering. Small. Not
scheduled.

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

### A BYO workspace's thumbnails have no browser preview — deliberate, deferred to its own session

**The compliance half is FIXED (S44, migration 0054).** A thumbnail is now
written to, and disposed of at, the provider its body went to; the entry that
stood here — *"a BYO workspace's thumbnails are written to Petal storage"* — is
closed. What remains is a **product** gap, not a compliance one.

**What is missing:** a workspace on its own S3 bucket generates and stores
previews correctly, but **the file grid shows file-type icons instead of
them.** `signedThumbnailUrls` can only sign objects in Petal's bucket, and
`FileManager` filters to `storage_provider === 'supabase'` so the gap is stated
rather than silently missed.

**Why it was deferred (Audrey's call, 2026-08-08):** displaying them needs a
BATCH presign that does not exist — `storage-presign` authorises **one key per
call**, so a 50-file grid is 50 round trips against `STORAGE_PRESIGN_RPM`, and
its GET expiry is **300s** against the Supabase arm's **3600s**, so a grid left
open goes dead. And the deciding fact: **there is no S3 workspace on any
environment to verify a new signing endpoint against** (dev and prod all-zero;
staging's one `byos` workspace is provider `network` with zero `files` rows), so
the first real customer would be the test.

⚠️ **There is no desktop consolation prize.** `FileThumbnail`'s Express-route
branch is gated on `file.extension`, and a cloud `files` row has no `extension`
column — so an S3 workspace loses previews on web **and** desktop, totally, not
partially.

🚨 **Generation was the one-way door, and it shipped.** A preview that exists
can be displayed later by a pure client change: no backfill, no egress. A
preview that was never generated can only be made later by **downloading the
full source** — the one expensive design `storage/thumbnails.js` exists to
refuse, and the reason `thumbnail_url` sat unwritten from 0000 until S39.

→ Candidate shape when a test target exists: a GET-only batch signer
(`storage-thumbnails`) that authorises **every** key, groups by
`shape.projectId` and evaluates `can_presign_project_read` once per distinct
project, bounds the batch explicitly, and returns `{urls, refused}` keyed by the
input string. `FileThumbnail`'s per-URL error memory (`erroredSrc`) already
repairs a tile when a fresh URL arrives, so no component change is needed.

✅ **S40 DECIDED THE SAME QUESTION THE SAME WAY (2026-08-09), so this entry now
covers video too.** A video still is a thumbnail, and it is generated and stored
at its body's provider exactly as an image is — and equally, it is not displayed
for an s3 row, for the two reasons above, unchanged: there is no batch presign,
and there is still no S3 workspace on any environment to verify one against.

**S40 added a third, matching deferral for the same reason: s3 video PLAYBACK.**
`storage/index.js`'s `REQUIRED` is deliberately still
`['put','get','del','exists','describe']` and the new `getUrl` is **optional** —
`supabaseProvider` implements it, `s3Provider` does not. Promoting it to
`REQUIRED` would make `registerStorageProvider` refuse s3 outright. The specific
obstacle is measured and separate from the display one: `storage-presign`'s GET
expiry is **300 s**, so a clip longer than five minutes dies mid-playback with a
403 the `<video>` element reports as a stall.

→ The three deferred pieces are one session: a batch GET signer, a longer media
GET expiry, and `getUrl` moving into `REQUIRED` once both providers can honour it.

---

### The teardown sweep of `rabbit-files` and `rabbit-thumbnails` is row-derived, so a stranded object is neither removed nor counted

`uploadFile` can leave an object with no `files` row: body put succeeds,
thumbnail put succeeds, the row insert is refused, and **both** compensating
deletes are best-effort. The orphan scan deliberately walks neither thumbnail
location, so such an object is invisible to `files`, to the queue, and to the
teardown scan — and after the CASCADE, invisible forever.

**Narrowed by Track C / C2 (2026-09-07):** the omission is now LEGIBLE on the
certificate — `WIL-7005` carries `thumbnails_note`, a sentence stating that
`blobs_*` and `thumbnails_*` are row-derived and that a stranded body or preview
is neither removed nor counted — so the certificate no longer affirms a complete
disposal of those two buckets. (`user-avatars` is the exception: C2 LISTS it by
prefix, so a stranded avatar IS removed and counted.) What remains is the
omission itself: a `list()` of `projects/{id}` per owned project in both buckets
would find and remove the strays, and was not built because a tenant with many
projects would spend the Edge deadline on listings — a design choice, not an
oversight. Until then the sentence on the certificate is the whole fix.

---

### ⚠️ S44's reversal is safe ONLY because no s3 thumbnail predates it — record before that changes

S39 wrote **every** thumbnail to `rabbit-thumbnails`, including for s3 bodies.
S44 reversed the destination with **no key migration**, and nothing in the code
can tell an old key from a new one. For an s3 `files` row created *before* 0054,
all three layers are wrong at once:

1. **Display** — excluded by the provider filter, so a preview that *is*
   signable stops being shown.
2. **Teardown** — excluded from the Petal sweep (left behind) **and** counted in
   `byo_thumbnails_left` as if it were in the customer's bucket.
3. **`storage-gc`** — the worst: 0054 enqueues it as `byo-s3`/`s3`, the drain
   issues a signed DELETE against the customer bucket for a key that was never
   there, **S3 answers 204 for a missing key**, and it is stamped `deleted` with
   a disposal certificate — while the object sits untouched on Petal forever.

**Exposure is zero and that is the entire safety argument:** measured 2026-08-08,
dev and prod all-zero, staging's one `byos` workspace is `provider = 'network'`
with 0 `files` rows. Nothing recorded that the reversal depends on the set being
empty, so it is recorded here.

🚨 **No s3 workspace may be created carrying pre-0054 thumbnails without a
key-migration pass first** — this matters most on a backup restore.

---

### A `network`-provider workspace can never have cloud previews at all

Not a defect and not fixable — recorded so it is not re-filed as one. A browser
cannot read a NAS, so a workspace whose media lives on the customer's own
filesystem has no cloud thumbnail path in either direction. **"A thumbnail lives
where its source lives" is therefore a uniform RULE whose OUTCOME is not
uniform**, and the desktop's own `sharp` cache is what serves people sitting
next to the media.

---

### 🚨 The loopback server has no authentication, and since S40 it serves ORIGINAL media

**MEASURED (S40 adversarial review, 2026-08-09).** `expressApp.listen(0,
'127.0.0.1')` with `expressApp.use(cors())` — no token, no origin allowlist, no
session check, `Access-Control-Allow-Origin: *` on every one of ~94 routes. That
is pre-existing and documented. What S40 changed is **what an unauthenticated
caller can obtain**: the new `managed-files/:id/stream` route returns the
original, full-resolution bytes of the customer's media, with Range support.
Before it, the worst this server disclosed was manifests and 256px derivatives.

Everything needed to address it is served by equally open routes:
`GET /api/rabbit/projects` lists project ids and
`GET .../managed-files` lists every file id. So any other process on the machine
that can reach the port — a malicious postinstall in an unrelated repo, a
browser extension with localhost access — can enumerate and stream pre-release
footage while WILSON is open.

**Three things S40 DID fix, so this entry is narrower than it looks:** the
containment base is no longer client-controlled (see below), the response can no
longer be served as `text/html` on WILSON's own origin (`safeMediaContentType` +
`nosniff`), and a soft-deleted row is refused.

→ The remaining fix is authentication on the local server — a per-launch bearer
token minted in `startLocalServer` and handed to the renderer through preload,
checked by middleware. That is its own session: **every** `fetch` in the RABBIT
renderer and every adapter call would have to carry it. **Not scheduled.**
⚠️ Note this is the same class as the pre-existing entry for `file_events`
metadata — the difference is only what leaks.

---

### ⚠️ Professional codecs have no preview until an ffmpeg binary is installed

**MEASURED (S40).** `resources/ffmpeg/` ships with a README and a `.gitignore`
and **no binary** — deliberately: `pretty-aud/wilson` is public and `git add -A`
sweeps untracked files into it, so an 80 MB third-party executable does not
belong in the history. `hasFfmpeg()` is therefore `false` on every machine
today, the managed-file thumbnail route answers `415 { code: 'ffmpeg_missing' }`
for video, and ProRes/DNxHD/MXF rows keep a file-type icon.

This is an **install step, not breakage** — H.264/AAC MP4, VP8/VP9 WebM and AV1
all preview and thumbnail without it, on both tiers — but it is listed here
because the feature Audrey asked for is not complete until the binary is
dropped in, and nothing in the app says so.

→ `resources/ffmpeg/README.md` carries the install and, more importantly, **which
build to download**: an **LGPL** build, verified with `ffmpeg -version` (if the
`configuration:` line contains `--enable-gpl`, `--enable-libx264` or
`--enable-libx265` it is the wrong one). **Audrey's action**, and worth a real
check by whoever handles contracts, because studios ask about third-party
licensing in their own assessments.

⚠️ **And nothing in code or CI verifies the licence of whatever gets installed.**
The README is the only control. A CI check that runs `ffmpeg -version` and fails
on `--enable-gpl` would close it; not written.

---

### A managed video added BEFORE ffmpeg is installed keeps its icon until it is re-added

**MEASURED (S40).** Two decoders produce a managed-file preview and they have
different reach. The **ffmpeg** arm lives on the thumbnail GET route, so it
generates on demand — install the binary and existing videos get previews the
next time their tile renders. The **renderer** arm
(`ensureManagedVideoThumbnail`) has exactly one caller, `handleAddManagedFiles`,
so it only ever runs for a file being added.

So on a machine with no ffmpeg, a browser-decodable video that was already in a
project — or one imported through `POST /managed-files/import-folder`, which
never runs the renderer path at all — never acquires a preview, and there is no
control that asks for one.

→ Either give `import-folder` the same post-copy call, or add a "generate
previews" action to the Files view. Small. **Not scheduled.**

---

### pgTAP suite 35 cannot pass on staging or prod — its counts are unscoped

**MEASURED (S42, 2026-08-10).** `node scripts/tap-all.mjs` is 66/66 clean
against **dev** and **65/66 against staging**, failing two assertions in
`35_platform_audit.sql`:

```
#17 an operator reads platform_audit across every workspace  [have: 5  want: 2]
#19 an operator can list the operator roster                 [have: 2  want: 1]
```

Both are **unscoped counts that add real rows to the suite's own fixtures**.
Staging holds 3 `platform_audit` rows and 1 `platform_operators` row, all dated
**2026-07-31** — so 3 + 2 fixtures = 5, and 1 + 1 = 2. Nothing about it is new:
it would have failed identically before S42, and `storage_plan.*` actions on
staging are **0**, so none of it came from S41 or S42.

It passes on dev only because dev has never had real operator activity. That
makes it a **latent** failure that appears the first time anyone runs the full
set against an environment in use — which is exactly what S42 did, and why it
was found now rather than by reading.

🚨 **This is the class 0055's header names in so many words** — *"Postgres-side
reads are ALWAYS scoped to the fixture workspaces — dev carries real rows and an
unscoped count decays the day the feature is used"* — and suite 35 predates the
rule. Suites 56/57 had the same defect and were fixed in S33 (`439f702`).

⚠️ **The cost is not the two assertions, it is the discipline.** The standing
rule is "run the whole pgTAP set before pushing a migration", and a set that can
never be clean on the environment the beta actually runs against trains people to
read a red result as normal.

→ Scope both probes to the fixture operator and fixture workspaces, exactly as
S33 did for 56/57. Small and self-contained. **Deliberately not done in S42** —
it is an unrelated suite and editing it mid-deploy is how a session breaks
something it was not looking at.

### `too_large` points at the desktop app, which shares the same ceiling

**MEASURED (S42 review, low).** The over-cap message says *"Add it from the
WILSON desktop app."* For a **Petal cloud** workspace the desktop app is not a
different ceiling — it runs the same `supabaseProvider` against the same
`rabbit-files` bucket. Only switching that workspace to Local Server mode
(managed files, no ceiling) actually changes the answer, and the message does not
say so.

Pre-existing wording, but S42 re-blessed it with a new number and made it the
only size refusal Petal can now produce. Reachable only above **50 GiB**, so the
population is currently empty.
→ One sentence, once someone decides what it should say. Not scheduled.

---

### An expense receipt is not money-gated, and now it can reach a deck — FIXED (C4), three residuals

**INFERRED (2026-09-07, Track C bundle C3, review round 1; confirmed by round
2 by reading both call sites).** `BudgetView`'s receipt upload calls
`adapter.uploadFile(projectId, { type: 'expense' }, file)`. `type` is not a key
`uploadFile` reads and `financial` is absent, so `is_financial: !!scope.financial`
is **false** and `uploadContainerFor` falls through to `{ seg: 'project' }` —
the row lands unguarded under the ordinary path segment, readable by every
project member. `InvoiceAttachment`, one file away, passes
`{ financial: true, lineId }` and is gated correctly. A receipt states an
amount, so this is the class of exposure 0038 exists to close, on the one
budget surface that missed it. Not observed failing on a live project, which
is why this is INFERRED rather than MEASURED.

Pre-existing since the receipt upload was written, and unrelated to Track C.
It is recorded because C3 made it more VISIBLE, not because C3 caused it:
project-level media is now deck source material, so a receipt photo can be
downloaded into a generation prompt.

**FIXED 2026-09-08 by Track C bundle C4** (`b90ee99`), except for the three named
residuals, below. The client half was one key — `{ financial: true }` in
`BudgetView`'s upload — and it closes both gates on both write-capable
backends, because `uploadFile` spends the flag on the `INVOICES` segment, on
`is_financial` and on the Supabase pin inside one function, and Local Server
reads the same flag and routes the body to its own invoices directory.
Migration **0076** marks every existing receipt financial (a `files` row whose
id appears in an `expenses.file_ids`) and backfills their `file_events` too, so
the activity stream cannot serve the history of a row the reader can no longer
see. Measured before and after: dev and staging both carry ZERO expenses and
ZERO files, so the backfill moved nothing on either and exists for the
environments that come later.

→ **RESIDUALS.** Review round 1 found the "exactly two" framing wrong: there
are THREE, and only the first two are counted and reported by 0076 at apply
time. All three are empty on dev and staging today.

1. **A pre-existing receipt is gated at the ROW and not at the BLOB.** The
   four base `rabbit_files_*` storage policies key on the third PATH segment
   and never consult `files.is_financial`, so flipping the flag does not move
   an existing object to the money side of that test. The practical effect is
   still large — `storage_path` itself becomes manager-only, so the path can no
   longer be DISCOVERED through the app — but anyone already holding a path
   keeps object-level read access. Moving the bytes is not a migration's job
   (`storage.objects.name` IS the S3 key, so renaming the row without moving
   the object breaks the download); it needs a one-time client-side mover in
   the shape of C3's `runAttachmentMigration`. Pinned as a fact by suite 78
   probe 55 rather than left as a comment.
2. **A receipt whose body is on a customer's own bucket cannot be flagged at
   all.** `files_money_provider_chk` (0050) refuses a financial row outside
   Supabase, so 0076 scopes its backfill to `storage_provider = 'supabase'`
   rather than aborting. Those rows need their body moved into Supabase before
   they can be gated. Suite 78 probe 53 pins the refusal; breaker BM1 showed an
   unscoped backfill dies on the CHECK.

The standing diagnostic for the first two is in `SYSTEMS_HANDBOOK.md` §12.9
(§12.4 is blob garbage collection — the pointer here was wrong). ⚠️ Read its
two columns differently: `ungated_on_customer_bucket` must be 0, but
`blob_outside_money_segment` IS the size of residual 1 and is expected to be
non-zero wherever receipts predate 0076.

3. **Local Server receipts uploaded before C4 — counted by nothing.** 0076 is
   a Postgres migration; the desktop keeps its own `is_financial` in its JSON
   bundle (`electron/main.cjs`) and nothing backfills it or moves those bodies
   into `INVOICES/`. Such a receipt stays ungated forever — still listed in
   Project Files, still eligible as D.O.G. deck source material, which is the
   literal defect this entry marks fixed. New desktop uploads are gated
   correctly; only the existing ones are stranded.

---

## Session log

Kept so the file's own history is visible without `git log`.

| Session | Added | Removed |
|---|---|---|
| Track C / **migration 0078** (2026-09-09) — the quota exemption bounded by size; pgTAP suite **77 extended** (probes 54-68), five breakers; two review rounds | **nothing.** | **One entry CLOSED: a receipt was exempt from the Petal storage quota at any size.** C4 made a receipt land under an `INVOICES/` segment so it would be money-gated, and that segment is what `rabbit_quota_exempt_path` (0055) keys on — so a receipt could not be refused however large, while `workspace_petal_committed_bytes` kept counting its bytes against the allowance that refuses ordinary media. Measured ceiling: the bucket's own **50 GiB** per object. Not a security hole (0037 gates `expenses`), a billing one. Audrey's ruling, asked and answered this session: **bound the exemption by size**, not cap the picker. 0078 adds `public.rabbit_quota_exempt_max_bytes()` = **25 MiB** as the one definition, plus `rabbit_quota_exempt_bytes(name,bytes)` and `rabbit_quota_exempt_object(name,md)` composed over it; `rabbit_quota_exempt_path` is UNCHANGED and delegated to, so suite 65's probes 13-17 stay green. 🚨 **THE HAND-OFF NAMED ONE ENFORCEMENT SITE AND THERE ARE TWO.** Besides the RESTRICTIVE `petal_storage_quota_insert`, `reserve_upload_bytes` (0073, C1) returned NULL early for any exempt path — and that is the one the CLIENT calls, before any byte moves. Bounding only the policy would have let a large receipt reserve nothing, upload, and be refused at commit, which is the exact failure C1 exists to remove. Breaker B3 proves it: bound the policy alone and probe 55 is the ONLY probe that reddens. 🚨 **`COALESCE(bytes, 0)` is load-bearing and the polarity is the counter-intuitive one: an UNKNOWN size KEEPS the exemption**, because a bare comparison yields NULL and a NULL DENIES under a RESTRICTIVE policy — every manifest and rates-mirror write with absent metadata would fail with a symptom indistinguishable from the bound working. Safe because `completeUpload` writes storage-api's own `size`. ⚠️ **A STATED LIMIT, not a hole: only bodies over 50 MiB reserve at all** (`RESUMABLE_THRESHOLD_BYTES`), so between 25 and 50 MiB the refusal lands at the policy AFTER the bytes move, and as a raw RLS error rather than the friendly PT402 sentence — walkthrough 13 step 3 now says so. ⚠️ **The bound applies to the manifest and mirror arms too**, since `rabbit_quota_exempt_path` is one predicate; the cost is stated in handbook §12.10 and pinned by probe 57. **REVIEW ROUND 1** found the 25-50 MiB band; that the header misquoted 0055's three reasons and dropped the decisive one (invoices are how a company pays Petal — the reason 0078 actually overrides above the bound, now argued rather than hidden); that post-conditions 6a and 7 asserted SUBSTRINGS a polarity inversion walks straight through (`%rabbit-files%` is true of `bucket_id = 'rabbit-files'`); and that a retyped 100-line SECURITY DEFINER function had two LIKE probes as its whole evidence. **REVIEW ROUND 2 then found four defects in round 1's own corrections**, which is why the track runs two: 🚨 **§12.10 — the section every other file forwards to — was never corrected at all** (the handbook diff had exactly ONE hunk, in §17), so four round-0 defects survived in the canonical place; 🚨 **round 1 silently DELETED the manifest's positive assertion** and then wrote "the manifest arm was untested", which is the defect class probe 10's own note warns about, three sections later in the same file — restored as probe 68 at a stricter fixture; probe 57 asserted a bare PT402 while probe 55's comment, written by the same round, argues at length that a bare PT402 is not enough; and the bound-duplication inventory was stale in the commit that introduced it (round 1 wrote "probes 55, 60 and 61" while adding 54, 57 and 66). Also: `site 1`/`site 2` meant opposite things in 0078 and suite 77; post-condition 9b was narrowed by a `public.` prefix an unqualified call would slip past; §12.9's four present-tense clauses were still false. **Five breakers, each reddening exactly what it should:** B1 (size axis dropped) → the refusal probes 55, 57, 60, 61; B2 (COALESCE removed) → 63 only; B3 (policy bounded, reservation not) → 55 only; B4 (bucket arm inverted) → post-condition 7; B5 (exemption arm negated) → post-condition 6a — B4 and B5 both PASSED the original LIKE form. ⚠️ **Measured and recorded, not fixed:** `storage.foldername` and `fn_try_uuid` are `proparallel = 'u'`, yet `rabbit_money_segment` (0042) and `rabbit_quota_exempt_path` (0055) are labelled PARALLEL SAFE while calling them; the new functions inherit that pre-existing mislabel by delegating to the chain. Someone should fix 0042/0055 together. State: 0078 on **dev** by query (statements first, history row second; recorded md5 `56277f68cccf8285571e77a96f145d12`, 44828 bytes / 43744 chars, equal to the file's LF blob). Suite 77 **68/68**; suites 65/66/77/78 **198/198**; full `tap-all` sweep **73 suites, 72 clean, 1394/1394, 0 failed** — the one problem is `67_member_full_time`'s known `col_type_is` shim gap, not this track's. Vitest **1815 / 76**. Migration number taken with Audrey's explicit permission; **Track D moves to 0079** and the ledger says so. Handbook §12.10. |
| Track C / bundle C4 — **review rounds 1 and 2** (2026-09-09) — three Opus reviewers over `b90ee99`/`d95f73f`/`410f284`; suite 78 **58 → 59**, migration 0076 corrected and re-applied | **nothing.** | **C4 was UNREVIEWED when this session opened** — the C4 session launched round 1 and was told to wrap up before the report came back, so nothing from it had been read or acted on. Treated as unreviewed and run from scratch. **The gap C4 named turned out not to be one:** `googleDriveAdapter.uploadFile` is `readOnly()` and throws, so Drive cannot write an ungated receipt because it cannot write at all — "both write-capable backends" survives as written, though C4 asserted it without checking. **Two findings changed the bundle.** (1) 🚨 **A read-back regression: after C4 nobody could OPEN a receipt.** `FileManager` and `ProjectsPage` both drop `is_financial` rows, and `ExpensePopup` rendered only a name and a remove button — so the manager who uploaded a receipt could see it and open it nowhere, and **walkthrough 16's own step A3 could not have passed**. `ExpensePopup` now has the receipt's own open control, the twin of `InvoiceAttachment.handleOpen`. (2) 🚨 **A receipt is now exempt from the storage quota** — the `INVOICES` segment short-circuits the RESTRICTIVE `petal_storage_quota_insert` via `rabbit_quota_exempt_path`, while the meter still counts the bytes. Documented, not fixed: bounding it is a 0055 change and a pricing call. **Also corrected, each verified by query rather than argued:** "three base storage policies" (there are FOUR, and `rabbit_files_invoices_*` has not existed since 0042 dropped it — the same phantom name as the S39 incident recorded in this file); `[3] IS DISTINCT FROM 'invoices'` (really `NOT rabbit_money_segment`, i.e. INVOICES **or** FINANCE in any case); §12.4 cross-references that should be §12.9; "Both columns must be 0" in the standing diagnostic, which was a **false invariant** contradicting residual 1; suite 78's "verbatim" copy that had been reflowed, and its claim that drift would go red when **nothing compares the two texts**; a stale `deckAttachments.js` comment C4 had falsified; and a **third residual C4 missed entirely** — Local Server receipts predating C4 are backfilled by nothing. **Four post-conditions in 0076 were strengthened:** a BYPASSRLS tripwire (both tables are FORCE RLS, so a non-bypassing role would have backfilled nothing and reported success — dev's `postgres` has it, so C4's apply was sound); 3d now asserts the CHECK's definition, not its name; 3g counts 3 USING + 2 WITH CHECK, since four policies carry five money clauses; 3i moved off `information_schema.column_privileges`, which structurally cannot see `GRANT TRUNCATE TO anon` — the instrument suites 77 and 79 had already rejected. Round 2 then found defects in round 1's own corrections and they are fixed here: 3i had been REPLACED rather than extended, losing column-grant coverage (a `GRANT SELECT (is_financial) ... TO anon` would have started passing) — both instruments are kept now, as suite 79 does; the guard sat INSIDE the post-condition block, i.e. after both UPDATEs, and is now its own statement above them; 3d asserted the CHECK's path axis but not the `is_financial` one this backfill actually writes; and **probe 55 was never de-tautologised at all** — round 1 added a probe beside it and wrote "REPLACED A TAUTOLOGY" over the untouched one, which is exactly the defect class these rounds exist to catch. The access probe is now 60, with 59 as its control. **State: 0076 on dev AND staging by query** (statements first, history row second; both environments record md5 `fd0dc1ac2c2dfcd2566fde4eac817ccb`, 23108 chars, equal to the file's LF blob — the invariant 0074 and 0075 also satisfy). Suite 78 **60/60 on dev** (`plan` 49 -> 58 -> 60 across C2, C4 and these two rounds). Vitest **1815 / 76 files**. ⚠️ The full `tap-all` sweep did NOT complete: three runs stalled mid-set on CLI contention from concurrent sessions and were killed; suites 78 (60/60) and 48 (19/19) were run individually and are green, and CI runs all 73 against a clean database built from every migration. **CI green on `272acc2`** — RLS tests #383, 1m 57s, all four jobs (pgTAP, Vitest, issue-session smoke, Playwright auth); that run is also the only proof the suite's new `storage.objects` insert works outside hosted dev. **Unmerged**, with C1–C3, until Audrey's walkthrough reports 13–16 — asked again this session, answer unchanged: **none run yet.** Her one new ruling this session: **bound the quota exemption by size** (handbook §12.9), which is a new migration and the next session's work. |
| Track C / bundle C4 (2026-09-08) — migration **0076**, pgTAP suite **78 extended** (probes 50-58), the one key in `BudgetView`; `b90ee99` on `track-c-storage` | **nothing.** | **One entry fixed and narrowed to a named residual:** *An expense receipt is not money-gated, and now it can reach a deck.* The client half was one key — `{ financial: true }` — and it is genuinely one key because `uploadFile` spends `scope.financial` on the `INVOICES` segment, on `is_financial` and on the Supabase pin inside ONE function, while Local Server reads the same flag and routes the body to its own invoices directory. The old scope was `{ type: 'expense' }` and **`scope.type` is read by nothing in the tree**, so it was effectively empty: the receipt landed unguarded while the `expenses` row pointing at it is manager-only, i.e. the amount was hidden and the receipt stating it was not. 0076 marks every existing receipt financial (a `files` row in some `expenses.file_ids` — the only `file_ids` column in the schema) and backfills their `file_events`, on Audrey's ruling this session, so the activity stream cannot serve the history of a row the reader can no longer see. 🚨 **Two traps the fix plan's one line did not name.** (1) `files_money_provider_chk` REFUSES a financial row outside Supabase, so an unscoped backfill would have ABORTED the migration on the first BYO-hosted receipt — breaker BM1 kills the whole suite with a 23514, which is how that was proven rather than argued. (2) The backfill closes the ROW gate and not the BLOB gate: the base storage policies key on the third PATH segment and never read `is_financial`, so an existing receipt's object stays where it is. Both populations are COUNTED and reported by 0076 at apply time and both are EMPTY today — dev and staging carry zero expenses and zero files, measured before and after. State: 0076 on **dev** by query (statements first, history row second; the recorded md5 equals the committed LF blob's — and so does 0075's, contrary to what this row first claimed: re-measured 2026-09-09, `4c576832…` on dev equals the HEAD blob, and only the CRLF *working copy* differs), suite 78 **59/59 on dev** after review round 1 (58 at `b90ee99`) with four migration breakers, vitest **1809/76** with seven client breakers, full dev sweep **72 of 73 suites at 1378/1378, 0 failed** — `67_member_full_time` (14 planned) does not run at all through the hosted shim (`col_type_is`), so "73 suites, 1378/1378" described 72. **Unmerged**, with C1, C2 and C3, until Audrey's walkthrough reports 13, 14, 15 and 16 — she confirmed at the top of this session that none had been run. |
| Track C / bundle C3 (2026-09-07) — migration **0075**, pgTAP suite **79**, D.O.G. cloud attachments; `2a4924f` on `track-c-storage` | **nothing.** | **Nothing was on this list to remove** — `MASTER_PLAN.md` §6 #31 is where D.O.G. cloud attachments were tracked, and it is marked CLOSED with this commit; `RELEASE_TESTING.md`'s "Known not to work" #1 is deleted and the list renumbered. What shipped: 0075 adds `files.document_kind` (the EXISTING 0000 enum, not a second vocabulary) and `files.description`, the two fields `ProjectFilesTable` has written on every gesture since S27 while `toColumns` silently stripped both — persisting on Local Server, whose PATCH spreads `req.body`, and nowhere in the cloud. Both write-capable backends now route the Resources drop zone and D.O.G.'s modal through `adapter.uploadFile`; D.O.G. lists, DOWNLOADS and rehydrates the bodies (trap (c) — a row without its body contributes nothing to generation), bounded at 20 files / 32 MiB, documents first so nothing can crowd out the brief, with the count left out stated; the legacy arrays are still READ everywhere and move only when Audrey runs Settings → "Move deck attachments into project files" (dry run required, 32 MiB per-file ceiling, oversized files named and left in place). 🚨 **The polarity diff §6 #31 demanded CAUGHT A REAL DEFECT on its first run**: all three writers used `detectDocumentKind(name) || null`, which is null for a PDF whose name matches no heuristic, so a migrated `legacy.pdf` uploaded, listed in the grid and vanished from generation. `deckAttachments.documentKindFor` is total by construction and `polarityRoundTrip.test.js` keeps it that way. State: 0075 on dev AND staging by query (DDL first, history row second, the recorded statement's md5 = the file's LF-normalised bytes on both), suite 79 **25/25 on both** after two review rounds (eleven breakers, each failing the probes it was built for), vitest **1797/75**. **Unmerged**, along with C1 and C2, until Audrey's walkthrough reports 13, 14 and 15. |
| Track C / bundle C2 (2026-09-07) — migration **0074**, pgTAP suite **78**, the teardown avatar + open-reservation sweeps in `operator-workspaces`, the two-directional `rls.yml` guard; `60bc7c9` and its review commits on `track-c-storage` | **nothing.** | **Three entries closed, one narrowed:** *`file_events` has no money arm* — 0074 snapshots `is_financial` at capture (the row's flag OR a money-segment key, one definition) and `file_events_select` gains the money arm: a non-money reader sees a financial row only as its `purged` certificate (Audrey's ruling 22; workspace admins and project managers see everything). *Abandoned-upload certification has two uncovered cases* — a failed upload is certified AT ONCE by `abandon_upload_reservation` (her ruling 1); teardown closes every open reservation BEFORE the CASCADE (`sweep_open_uploads`) and certifies the paths as `WIL-7012` in `platform_audit`; the 24 h hold is released when the person next opens Files, without a certificate (ruling 2); NO per-member cap (ruling 3 — an accepted limit, handbook §17). *`user-avatars` survives workspace teardown* — listed by prefix, removed, counted (`avatars_*` on WIL-7005, the torn-down card names the number). *The teardown sweep is row-derived* narrowed to what `thumbnails_note` on the certificate does not cover. Also: `otter_quiz_attempts` joins `RLS_TABLES`, and the guard now enumerates RLS-enabled tables from the CI database (six mapped in `COVERED_BY`, `otter_subject_shares` knowingly uncovered until Phase 5c). State: 0074 on dev AND staging by query (DDL first, history row second, the recorded statement's md5 = the file's on both), suite 78 **49/49 on both** (ten breakers, each failing the probes it was built for), suites 33 and 77 green on both, `operator-workspaces` **v14 dev / v11 staging** (both hash-verified by download), vitest **1751/72**. **Unmerged until walkthroughs 13 and 14 report.** |
| Track C / bundle C1, reservation half — SECOND session (2026-09-06) — 0073 applied on **staging**, review rounds 1 and 2, `ea8467f` and the round-2 commit on `track-c-storage` | **one entry:** *abandoned-upload certification has two uncovered cases* — a FAILED upload releases its reservation and is never certified, and teardown CASCADEs open reservations away uncertified; with two adjacent limits (the 24 h hold after a closed tab, no per-member reservation cap). All four are rulings owed by Audrey and candidates for C2's 0074; none blocks the merge. | **nothing** — the two entries C1 closes were already deleted by `68f97fe`. State: 0073 on **dev AND staging** by query (DDL first, history row second, the recorded statement's md5 = the file's on both), `storage-gc` **v10** on both (hash-verified by download), suite 77 **53/53 on both**, suite 66 30/30 on staging, vitest **1735/72**, CI **green** on `ea8467f`. Round 1 fixed ten things in the client, the card, the function and the docs (the refusal named the minted key leaf; the client courtesy check never said "uploads in progress"; a dead run's certificate read "sweep ran, 0/0"; four suite-77 probes could not see the fault they named — each now proven by a breaker); walkthrough 13 rewritten to what the UI can do (Add files is DISABLED while a clip uploads — the second clip needs a second browser tab). **Unmerged until her walkthrough 13 report.** |
| Track C / bundle C1, reservation half (2026-09-06) — migration 0073, pgTAP suite 77, `68f97fe` on `track-c-storage` | **nothing.** | **Two entries, both fixed by `68f97fe`:** (a) *concurrent resumable uploads can exceed a workspace's Petal quota* — an upload above 50 MiB now reserves its bytes in `upload_reservations` before `tus.Upload.start()`, and the RESTRICTIVE policy weighs active reservations, so the second of two uploads that together exceed the quota is refused at START with the standing sentence (suite 77, 53 probes, seven breakers; the object's own reservation is excluded from the weighing, and a reservation stops counting the instant its object lands, so nothing is ever counted twice); (b) *TUS partial objects have no WILSON-side lifecycle (TPN-CONT-017)* — a reservation that expires unreleased with no object landed is certified `upload_abandoned` by `sweep_abandoned_uploads()` (storage-gc per workspace on every cleanup, pg_cron hourly), the term 0057 added and 0058 withdrew, now with a writer. The certificate names the abandonment, not the disposal of bytes, which SQL still cannot see. 0073 was on **dev** by query at the time; the **staging** apply, refused twice by that session's permission classifier, was done by the second session (the row above). **The BYO-display entry stays**: no s3 workspace exists on any environment (all three re-measured 2026-09-06), so C1's display half waits on Audrey's test bucket. |
| 2026-09-04 (`main` merged into the branch, PR #4 readied; no source change) | **one entry, by splitting, not by regression:** *a manager can approve their own nomination* was a bullet inside a now-closed entry and is its own entry so it does not sit under a FIXED heading. Nothing regressed. | **Four stale entries closed, each re-verified the same day against all three projects — by `supabase functions list --project-ref` and by `db query` through throwaway `--workdir` links with a per-environment discriminator — rather than from notes:** `provision-workspace` (removed by S43, deployed nowhere; the entry had said LIVE for three weeks); migration 0061 (applied everywhere on 2026-08-12, `phase_dependencies` present on all three); migrations 0059/0060 (0060 applied everywhere; `workspace_directory()` names both grant columns again); the non-admin course submission (built as Phase 5 nominations: 0064 on dev + staging, prod at 0063). 🚨 **The finding of the pass is drift: all four were resolved by 2026-08-14 and still read as open on 2026-09-04, because closing work updates commits and briefs and nobody re-reads them into this file.** ⚠️ Measured on the way and recorded in the `provision-workspace` closure: **migration 0066 IS applied on dev and staging** (the audit CHECK carries `workspace.invite_sent`; prod does not), contradicting the S43b commit messages of 2026-08-16, and `operator-workspaces` has not been redeployed on any project since 2026-08-08 — so the setup-link button is inert for the function's reason alone. 0065 is still applied nowhere. Comment markers re-counted at close-out: 5 → 5, still pairing. |
| S42 (2026-08-10) | **three entries, and two of them are about S42's own work being wrong rather than about anything regressing.** (a) **concurrent resumable uploads can exceed the quota** — pre-existing, and S42 shipped a fix for it that did not work; (b) **TUS partial objects have no WILSON-side lifecycle** — the brief's TPN-CONT-017 deliverable, attempted and withdrawn; (c) the `too_large` message points at a desktop app that shares the same ceiling. 🚨 **THE FINDING OF THE SESSION IS THAT MIGRATION 0057 CLOSED A HOLE IT DID NOT CLOSE, AND ITS OWN pgTAP SUITE AGREED.** 0057 metered `storage.s3_multipart_uploads.in_progress_size` to stop N concurrent uploads each passing a check blind to the others; suite 66 asserted the closure in three probes. **WILSON uploads over TUS, whose state storage-api keeps in S3 `.info` objects via `@tus/s3-store` — that table is written only by the S3-compatible protocol handler WILSON never calls.** The arm summed a permanently empty set and the three probes passed solely on rows the suite inserted itself: a green test over a path the product does not have, written into the suite meant to catch exactly that. 0058 removes the arm, the `upload_abandoned` term and the sweep, and probe 13 now asserts the meter does **not** move. It was surfaced by a verifier *refuting a different claim*, then confirmed independently against storage-api v1.68.1 source — **a review's refutations are worth reading as carefully as its findings.** 🚨 **Second: the resumable path froze the bearer token at upload start.** `jwt_expiry` is 3600 s and auth-js returns any token with ≥91 s of life unrefreshed; tus re-reads `options.headers` per request but nothing mutated it, and `shouldRetryTusError` classified the resulting 401 as permanent — so **no upload lasting longer than its token could ever finish**, on the one path that only runs above 50 MiB. Fixed with `onBeforeRequest` re-reading a live token, plus 401 made retryable. Confirmed HIGH by two independent verifiers. ⚠️ **Third, and it is a `git status` blind spot: `.github/workflows/rls.yml` lives in the PARENT git root**, so the pgTAP replay list read as up to date from inside `WILSON/` while stopping at suite 65 — the S17 failure mode, where suites failed invisibly and every annotation pointed at a file that was fine. 🚨 **Fourth: a migration can be green and change nothing.** `storage.buckets.file_size_limit` is capped by a PROJECT-LEVEL limit in the Supabase dashboard that SQL cannot observe; 0057 raises the bucket to 50 GiB and does nothing until that figure is raised by hand on each project (done 2026-08-10). ⭐ **Three of the review's own findings were REFUTED with evidence**, and one of my own tests was replaced twice for being vacuous — an occurrence count that passed with the defect present, and a regex matching `onProgressX`. Stated limits (s3 stays at a 5 GB single PUT; no cross-session upload resume; the progress pins are structural, not breaker-verified) are in the S42 outcome block. | **nothing was on this list for S42 to remove.** ⚠️ Comment markers re-counted at close-out: still pairing. |
| S41 (2026-08-09) | **nothing.** Nothing regressed and nothing new is known broken. The session's own work — Petal cloud as a paid, operator-managed product, migrations 0055 **and** 0056 — is tracked in the design (§4a3) and `MASTER_PLAN`, and **the pre-push adversarial review's 8 confirmed findings (1 from its completeness critic) were all fixed before the code was pushed**, so per this file's rule they are commit content, not entries. 🚨 **The one worth remembering is not a bug in the feature but a LIE IN ITS ERROR MESSAGE: both new over-quota notices told the user to delete files, and that remedy CANNOT WORK.** A cloud delete is soft (0014), `storage-gc` refuses a trashed row for 30 days, and the meter reads `storage.objects` — so an admin following the advice deletes real work and watches the number not move. Offering a remedy that cannot work is worse than offering none; both messages now name the 30 days instead. 🚨 **Second: the wrong keyword on the new policy re-opens the invoice hole.** Breaker B1 dropped `AS RESTRICTIVE` expecting the quota to stop binding; as a ninth PERMISSIVE arm its own money EXEMPTION instead ORs in and GRANTS a write `rabbit_files_money_insert` was refusing — 0038's inversion, recreated by the file adding a quota. ⚠️ **Third, about this session's own tests: the ordering pin written to catch S40's FileList defect DID NOT FIRE**, because it matched the COMMENT that quotes the expression while explaining the bug. Two operands, same trap; the fix is to strip comments, not to chase forms. ⭐ **Two PRE-EXISTING defects were found by new guards rather than by looking:** `platformAuditActions.test.js` found on its first run that `operator.granted`/`operator.revoked` have been in the CHECK since S15 and never in the operator console's filter; and suite 65's new thumbnail probe exists because the EXCLUSION had a probe and the INCLUSION did not — dropping `rabbit-thumbnails` from the meter left the suite at 38/38 and every post-condition green. Stated limits (the gate is `rabbit-files` INSERT only; `used < quota` does not weigh the incoming object; money paths are metered but never gated; the operator summary scans both buckets once per company) are in the S41 outcome block and handbook §17, where scope choices belong. | **nothing was on this list for S41 to remove.** ⚠️ Comment markers re-counted at close-out: still pairing. |
| S40 (2026-08-09) | **three entries, none of them a regression and one of them a narrowing.** (a) **the loopback server has no auth, and S40 raised what that discloses** from manifests and 256px derivatives to original media bytes — pre-existing shape, materially bigger stake, and the three parts S40 *could* fix in scope were fixed. (b) **professional codecs have no preview until an ffmpeg binary is installed** — an install step, recorded because the feature Audrey asked for is not complete without it and nothing in the app says so. (c) **a managed video added before ffmpeg is installed keeps its icon**, because the two decoders have different reach. No migration; migrations stay 0000–0054 and pgTAP stays 64 suites. 🚨 **The finding of the session is that S40's own headline change silently killed a feature that had nothing to do with video.** Inserting `await getWorkspaceStorageCached()` ahead of `Array.from(fileList)` in `handleAddCloudFiles` moved the read into a microtask — and the picker's `onChange` does `handler(e.target.files); e.target.value = ''`. **MEASURED in Electron 33's own Chromium: `input.files` returns ONE FileList object that `value=''` empties IN PLACE** (`{sameObject: true, afterLength: 0}`), so **every cloud upload on the beta and on desktop-in-cloud-mode became a silent no-op** — no rows, no error, no console output. Caught by the pre-deploy adversarial review; **no wiring test could have seen it, because they grep source text and this is an ORDERING property.** 🚨 **Second: the containment base was itself client-controlled.** `resolveProjectFolderRoot` joined `folder_slug` — written verbatim from `req.body` by the project POST and the PATCH spread — under the configured root, so `folder_slug: '../../../..'` turned `D:\WilsonRoot\Projects` into `D:\` and every `resolveContainedFilePath` below it faithfully contained against a directory the caller chose. Pre-existing since the folder tree; S40 is where it stopped being survivable, because the stream route returns original bytes of any type instead of a 256px JPEG of an image. **Verified by running the real expressions, fixed at the resolver AND both writers** — the resolver half is load-bearing, because a bundle already on disk may carry a poisoned slug. ⚠️ **And the review's value was not only in its findings: writing the test for one of them exposed a bug the review missed** — `resolveFfmpegPath`'s env override short-circuited on `existsSync` and so was the one path exempt from the "must be a file" rule it was written to enforce. **17 of 37 findings were confirmed and fixed** (5 high), against code already green on 1315 assertions and 16/16 breakers; the breaker set is now **33/33**. | **nothing was on this list for S40 to remove.** ⚠️ The S44 entry *"a BYO workspace's thumbnails have no browser preview"* was **annotated, not closed**: it asked that S40 decide the same question for video stills, and S40 decided it the same way — **generate, do not display** — so s3 playback and s3 still-display are deferred together, for the same two measured reasons (no batch presign; no S3 workspace on any environment to verify one against). ⚠️ Comment blocks re-counted at close-out: still pairing. |
| S39 (2026-08-08) | **nothing.** Nothing regressed and nothing new is known broken. **S38 was not run** — its Google OAuth gate (`OWED_AUDREY.md` §13) was unfiled, so per that brief's own instruction the session swapped to S39, which was one of the three independent roots. The session's own work (thumbnails, migration 0053) is tracked in the design and `MASTER_PLAN`, and **the pre-deploy adversarial review's 4 confirmed findings (from 20 raised, 8 verified) were all fixed before the migration reached staging**, so per this file's rule they are commit content, not entries. 🚨 **The one worth remembering is not a bug but a DOCUMENT: this session's brief and design §5d.1 both said `rabbit-files` has "FOUR policies: three base + `rabbit_files_invoices_select`" and said to port those.** There are **eight**, they live in 0042, and that invoice policy has not existed since 0042 dropped it. A literal port ships a thumbnails bucket with **no money gate** — `TPN-CLOUD-008` arriving through the instructions written to prevent it. **The code knew:** `supabaseProvider.js:19` has said "eight RLS policies (0042)" since S36. Handbook §4.7 is corrected, including its stale "there is no UPDATE policy". ⚠️ **Also: a pgTAP probe written as a row count passed against a bucket with NO POLICIES AT ALL** — a USING failure yields zero rows silently, a WITH CHECK failure RAISES, so that probe must be `throws_ok`. ⚠️ **And the comment trap returned a third way**: a test's comment-stripper ran block comments in a separate first pass, so a LINE comment containing `rabbit-files/projects/*` opened a block that ate 40 lines of real code including the call being asserted. **One alternating pass, block alternative first.** Stated limits (no orphan sweep over `rabbit-thumbnails`, Local Server's tier untouched, no video thumbnails, `thumbnail_url` client-writable) are in §12.7b and §17. ⚠️ **One decision is flagged for Audrey rather than taken: a BYO-storage workspace's previews live on Petal while its media does not** — see the S39 outcome block. | **nothing was on this list for S39 to remove.** ⚠️ Comment blocks still pair 5→5 (checked at close-out). |
| S37 (2026-08-08) | **nothing.** Nothing regressed and nothing new is known broken. The session's own work — S3-compatible storage, migrations 0051 + 0052 — is tracked in the design and `MASTER_PLAN`, and **the pre-deploy adversarial review's 12 confirmed findings (5 medium, 7 low, from 25 raised) were all fixed before the migration reached staging**, so per this file's rule they are commit content, not entries. 🚨 **The three worth remembering: two path gates disagreed about a filename the product itself writes** (`checkRowShapedPath` rejects only a segment that IS `..`; the signer rejected `includes('..')` — so `render..v2.mov` passed authorisation and then 500ed, permanently, on one provider only); **a warning promised the opposite of what happens** (the S3→NAS switch card said bucket files "stay readable" — the row remembers its provider but the CONNECTION is erased by 0050's config CHECK, so every pre-switch body becomes unreachable); and **the GC counted HTTP 404 as a successful disposal** (an absent S3 key returns 204 — a 404 is the BUCKET missing, so one flipped path-style setting would have stamped TPN-CONT-002 certificates on a whole batch of bodies still sitting in the customer's bucket). ⚠️ **The review's own fixes reproduced the 0038 trap twice**: two new `not.toContain` assertions matched the COMMENTS explaining why those forms are wrong. **A negative assertion over a file that documents its own trap will match the documentation** — assert the executable form. Stated limits (no orphan scan over customer buckets, teardown leaves them by design, advisory `downloaded`, 5 GB single-PUT ceiling) are in the S37 outcome block, where scope choices belong. | **the `storage-gc` manifest/rates deploy entry** — `supabase functions deploy storage-gc operator-workspaces storage-presign storage-secret` run against dev, staging AND prod (2026-08-08), so the destructive version is gone from every environment and Storage Cleanup is safe to click again. |
| S36, storage-gc follow-up (2026-08-07) | **the entry below was rewritten, not added.** The orphan-scan defect is **fixed** — `_shared/reservedObjects.ts` is the one definition, consulted by the orphan scan AND the queue drain (`storage_path` is client-writable, so a member can enqueue the rates file by pointing a row at it and deleting it), and teardown now sweeps the same objects because it had the **converse** defect: the money-gated rates mirror survived its own tenant's certified destruction. What remains, and is all the entry now claims, is that **Edge Functions deploy by hand and this one has not been deployed** — so the beta still carries the destructive version. 🚨 **The lesson is about §17, not the GC:** the same blind spot was recorded there as a gap in what teardown could SEE, one sentence away from the sentence that would have said it also DESTROYS. **Read every stated coverage limit in both directions.** Also worth keeping: the breaker run was itself vacuous on its first pass — `--reporter=basic` does not exist in vitest 4, every run died at startup, and all nine breakers scored "RED (good)" for the wrong reason. **A suite that never RAN is not a breaker that fired**; the script now asserts the suite ran before believing a failure. | **nothing** — the entry was rewritten in place rather than removed, because the deploy has not happened. |
| S36 (2026-08-07) | **one entry: `storage-gc`'s orphan scan would delete every project manifest and rates file** — pre-existing, found while mapping the storage surface for the registry, and deliberately NOT patched because it is nothing to do with providers and the fix belongs with the GC's own reserved-name handling (**patched in the follow-up above**). Nothing regressed. The session's own target (the vacuous-pass hole in `workspace_storage`) was tracked in the design/`MASTER_PLAN` rather than here and is closed by 0050. **The pre-deploy adversarial review confirmed 5 of 40 findings (1 medium) against code already green on 60/60 pgTAP + 1048 vitest** — all fixed before deploy, so per this file's rule they are commit content, not entries. 🚨 **The medium is worth knowing about: the probe labelled "row axis" pinned nothing** — it tripped the path arm too, so deleting the row arm from `files_money_provider_chk` left the suite reporting 31/31. **A breaker that neuters a WHOLE constraint is arm-blind**; proving a multi-arm predicate needs arm-level breakers. 🚨 **And those only work before the migration is applied** — every `ADD CONSTRAINT` is wrapped in `EXCEPTION WHEN duplicate_object`, so a modified migration replayed against an applied one is a silent no-op and the breaker passes vacuously. Also measured: **Postgres reports a CHECK violation by the alphabetically first constraint name**, which lets a new constraint steal an old suite's `throws_ok` message. Stated limits (the constant provider argument, `provider_config` having no reader, no provider UI) are in the S36 outcome block, where scope choices belong. | **nothing was on this list for S36 to remove.** ⚠️ Comment blocks now pair 201→250, 297→330, 459→525, **580→625** — the S30 close-out row below lists only the first three, because the fourth was added by S31 after it was written. |
| S35 (2026-08-07) | **nothing.** Nothing regressed and nothing new is known broken. The session's target — `folder_root` taken verbatim from the body of an unauthenticated API (TPN-NET-015, HIGH) — was tracked in the design/`MASTER_PLAN` rather than here, and is closed in the same commit, along with **8 findings (2 high) the pre-push adversarial review confirmed against code already green on 27/27 pgTAP + 1013 vitest**; per this file's rule they are commit content, not entries. 🚨 **The one to remember: the session guarded the wrong column first.** `resolveProjectFilesDir` consults `project.files_dir` BEFORE `folder_root`, and `files_dir` rode the same unfiltered `...req.body` spread — so the new folder_root guard could be bypassed entirely by setting its higher-priority sibling, which additionally promotes that directory into `isUserAuthorizedRelinkDir`'s roots. **Guarding a field means guarding whatever OUTRANKS it in resolution.** Second high: the client gate applied a cloud-only seat in every adapter mode, greying a control that works on a local/solo desktop and that no local layer refuses — now keyed on `workspaceId` exactly as S34's machine-root gate is. Also worth the line: **the cloud write of `folder_root` had been silently stripped by the adapter allowlist since 0040** — the exact shape `toColumns`' own warning describes — so the Change button on a cloud-backend desktop did nothing; it now lands, and it shipped WITH its guard rather than before it. Stated limits (desktop-only controls; seat is the workspace claim only; §4c UNC-form check still owed) are in the S35 outcome block, where scope choices belong. | **nothing was on this list for S35 to remove.** |
| S34 (2026-08-07) | **nothing.** Nothing regressed and nothing new is known broken. The session's one live defect — `StorageConnections.jsx` gating on nothing (TPN-AUTH-009) — was tracked in `MASTER_PLAN_S19_ONWARD.md`/the design rather than here, and is closed in the same commit that made the root workspace-wide; the mapping pass found a SECOND ungated machine-root surface the brief never listed (`SettingsPage.jsx`'s Change/Clear/Select controls), gated likewise. The pre-deploy adversarial review confirmed **20 findings (3 high) against code already green on 31/31 pgTAP + 972 vitest** — all fixed or recorded before the migration touched staging, so per this file's rule they are commit content, not entries. Four stated limits (no live root re-broadcast; sync fs on a dead NAS can stall main; the web terminal cannot probe; root-unknown is not a modelled state) are in the S34 outcome block, where scope choices belong. | **nothing was on this list for S34 to remove.** |
| S33 (2026-08-07) | **one entry: `file_events` has no money arm** — pre-existing since 0027, surfaced by the adversarial review S33 ran before deploying its own migration, and deliberately not patched because the fix is entangled with deletion certificates (see the entry). Three review findings against S33's OWN code were fixed before deploy and are commit content, not entries: the RPC's missing 0038 money gate, the NULL-not-false money-gate result that made the first fix silently fail OPEN in procedural SQL (the 0042 lesson inverted — `COALESCE` is load-bearing), and the local download route 500ing + reordering the project list when the audit write failed. Three stated limits are recorded in `MASTER_PLAN_S19_ONWARD.md`'s S33 outcome block rather than here: cloud download logging is advisory by construction, the managed-files desktop flow has no WILSON-mediated read to log until S40's serving route (noted in that brief), and `googleDriveAdapter` logs nothing. Also fixed in passing (`439f702`): suites 56/57's unscoped postgres-side counts, which failed the day dev carried a real pet row. | **the drive-root / share-root entry** (`ed85072` + migration 0047, applied and verified **by query** on dev, staging and prod; the escape cases the entry said were worth keeping are now vitest cases that must stay green, plus 18 new pgTAP assertions incl. two probes that exist because breakers proved the suite couldn't otherwise detect deleting the workspace-claim or membership checks). |
| S31 (2026-08-05) | **three entries, none of them a regression.** (a) **`ResetPasswordWizard` still performs a global sign-out** — found while fixing the same defect in `App.jsx`, and deliberately left alone because what a password reset revokes is a security decision. (b) **A failed pet LOAD has nowhere to show itself** — S31 made it representable, neither session has made it visible, and the same is true of S30's save banner, which renders only inside the chat popup. (c) The parallel network-storage session added the drive-root entry above. 🚨 **The finding of the session is not in this file at all: the settings half of S31 shipped in `272fb83` with ZERO CALLERS and was caught by grepping for callers before writing these docs.** Sixth instance of the shape, in the session whose brief warned about it five times, with a call-site guard already written for the *pet* half and a green unit test sitting over the dead settings path. Fixed in `29d36fc`. **Writing a call-site guard for half a change is how the other half goes dead.** | **the pet and per-user settings do not follow the user between computers** (0046 + `272fb83` + `29d36fc`, applied and verified **by query** on dev, staging and prod) and **there is no way to log out** (`272fb83`). Both entries' own claims needed correcting first: the plan's "store `last_fed_at`" named a field nothing reads, the schema census was wrong in both directions, and "there is no way to log out" was true of the Settings screen but not of the app — `window.wilsonSignOut` already had one caller. |
| S30, close-out (2026-08-05) | **nothing new broken.** Two things worth recording. **(a)** The pet's saves failed silently through THREE layers and are fixed (`73828c7`) — commit message, not an entry, per this file's rule. **(b) 🚨 THIS FILE WAS ITSELF BROKEN BY THIS SESSION AND IS NOW REPAIRED.** Closing the assignee-dropdown entry left an HTML comment opened at its historical block and never closed, so **everything from there to the next `-->` was commented out — 227 lines, hiding three LIVE entries**: the hung `getSession()`, the avatar, and *"signing in to the desktop app hides O.T.T.E.R.'s local courses"*, which this same session had added. Found by grepping the comment markers during the close-out rather than by reading the file, which is the only way it would have shown. **A `<!--` in a long markdown file is a silent delete.** Comments now pair 201→250, 297→330, 459→525. | nothing further. |
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
