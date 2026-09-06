# TRACK A launch prompt — PRODUCT LOGIC (setup link + walkthroughs, timeline + milestones, pet, O.T.T.E.R.)

> **One of three tracks that run at the same time.** The plan and Audrey's
> rulings are in `FIX_PLAN_2026-09-04.md`; this brief is Track A of it. Tracks
> B (sign-in and security) and C (storage and files) run in their own
> worktrees on their own branches. **This track owns** `RabbitProvider.jsx`,
> the R.A.B.B.I.T. adapters, `TimelineView.jsx`, the pet files
> (`src/lib/petLifecycle.js`, `src/lib/localData.js`, `src/lib/userState.js`,
> `PetCompanion.jsx`, and the PET EFFECT BLOCK of `src/App.jsx` — not its
> session block, which is Track B's), everything under
> `src/tools/otter_v0.3.1/`, and for bundle A1 only, `src/admin/CompaniesSection.jsx`,
> `src/admin/operatorApi.js` and `supabase/functions/operator-workspaces/index.ts`.
> Anything else you need changed, ask the owning track.

> **Numbers reserved for this track:** migrations **0067, 0068, 0069**; pgTAP
> suites **71, 72, 73**. Gaps are fine. Taking any other number is how two
> sessions have collided before.

> **STATE — re-measure, do not trust this block.** At `606f91d` (2026-09-04):
> migrations `0000`–`0066` in the tree; **dev and staging carry 0059–0064 and
> 0066, with 0065 deliberately skipped; prod is at 0063.** pgTAP 70 suites.
> Vitest 1706 / 71 files. CLI linked to wilson-dev. `operator-workspaces` last
> deployed 2026-08-08 on every project (dev v11, staging v9, prod v9).
> 🚨 **Read the working tree and query the environments** — every STATE block
> in this repo has been stale within the day.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`. Read
   `docs/fixes/README.md` "Rules that apply to every phase" and
   `docs/sessions/FIX_PLAN_2026-09-04.md` "Rules for running tracks in tandem".
2. **Cut the worktree:** `git worktree add ../wilson-track-a -b track-a-product
   feat/multi-user-v1` from the git root (the PARENT `wilson/`). Run the
   Supabase CLI from `WILSON/` inside it; check `supabase/.temp/linked-project.json`
   **and** `project-ref` say wilson-dev before anything writes.
3. **Re-measure the STATE block**: `git log --oneline -3`, `git status --short`,
   `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`, and the
   migration history on dev, staging and prod **by query** (the throwaway
   `--workdir` recipe in `docs/sessions/FIX_PLAN_2026-09-04.md` is not written
   there; it is in the auto-memory `wilson_migration_rules`: copy
   `supabase/config.toml` and `supabase/templates/` into a scratch dir, `link`
   there with `--password ""`, then `db query --linked --workdir <dir>`, and put
   `inet_server_addr()` plus a workspace count in every query as the
   discriminator).
4. **Read the `OUTSTANDING.md` entries named in each bundle** before touching
   the code they describe. Re-verify every citation in this brief **by symbol**;
   the session that edits a file breaks its own line numbers.
5. **Bundle order is A1 → A2 → A3 → A4.** A1 first because it deploys what is
   already built and unblocks Audrey's testing of everything else.

---

## Bundle A1 — the setup link, deployed; every walkthrough written (1 session)

### What is wrong

S43b (`186fa63` + `df257d0`) built "email a company its setup link" for the
operator console. Migration 0066 is applied on dev and staging (verified by
query 2026-09-04: the `platform_audit` action CHECK carries
`workspace.invite_sent`; prod does not). **The function was never
redeployed**, so the console's button calls a version of `operator-workspaces`
that does not know `send_setup_link` or `admin_contact`, and fails. The
correction round `df257d0` has had no second review, and the house record
(`wilson_hard_won_rules`) is that the second round is where an inert fix gets
caught.

### Audrey's decisions

Answer 1: *review, then deploy; she tests.* Answer 18: *scripted walkthroughs
she follows.* Answer 19: *the pet reading lessons is tested first.*

### What to do

1. **Second adversarial review of `df257d0`, aimed at the CORRECTIONS**, not at
   the feature again: the read-only `admin_contact` action and the panel that
   displays the address before asking for it typed; `loadFoundingAdmin()` being
   the ONE query both actions share; `isSynthesizedAddress()` covering BOTH
   suffixes (`@wilson.invalid` and `wilson.<workspace8>.<local>@mail.petalstudios.co`);
   the `already_suspended` refusal; WIL-7009. Give one lens *"what does this
   break elsewhere"* and one completeness critic. Re-run the mutation set the
   commit message lists (WIL-7006 restored; suspended guard removed; second
   synthesized format dropped; mail moved above the guards) — each must go
   red. `deno check` baseline is **4 errors**; do not add one.
2. **Scope suite 35 while you are in it.** `OUTSTANDING.md` records that
   `35_platform_audit.sql` cannot pass on staging or prod because two probes
   count unscoped rows (#17 and #19). S43b extended that suite; scope both
   probes to the fixture operator and fixture workspaces exactly as S33 did
   for suites 56/57 (`439f702`). Then `node scripts/tap-all.mjs` must be clean
   against dev AND staging.
3. **Deploy** `supabase functions deploy operator-workspaces --project-ref
   rzkirvkotslbovzbsdfh` (staging, the beta) and `--project-ref
   eqjzmnvkrakroyqxfsvw` (dev). **Not prod**: it lacks 0064 and 0066. Verify
   by `supabase functions list --project-ref <ref>` (versions 9 → 10 on
   staging, 11 → 12 on dev) AND by `supabase functions download` into a
   SCRATCH directory (🚨 never from the repo root — it overwrites source) and a
   `sha256sum` against `supabase/functions/operator-workspaces/index.ts`.
4. **Write the walkthroughs** as `docs/walkthroughs/NN_<feature>.md`, one file
   each, in this order: `01_pet_reads_lessons.md` (from
   `docs/fixes/phase-6-pet-reads-lessons/BRIEF.md` "Test plan (Audrey)" plus her
   four rulings in the auto-memory `wilson_session_history`: no course → brief
   answer + New Course button; a colleague's personal course readable only
   while a review window is open; admin is not a window; the window closes on
   decision), `02_setup_link.md` (the console button end to end, including the
   typed-address confirmation and the `WIL-7009` certificate in Audit),
   `03_course_nominations.md` (from `docs/fixes/phase-5-otter-course-submission/BRIEF.md`
   and `OWED_AUDREY.md` §8: submit as a plain member, approve as a manager,
   incumbent stands down, read window opens AND closes),
   `04_uploads_and_files.md` (S42 + S27 outcome blocks in
   `MASTER_PLAN_S19_ONWARD.md`: a multi-GB resumable upload, the cloud
   FileManager, the Resources drop zone, the folder + manifest panel),
   `05_company_lifecycle.md` (`OWED_AUDREY.md` §9D items 1–7).
   **Format:** numbered steps, the EXACT on-screen labels (🚨 grep `src/` for
   every label you write — RELEASE_TESTING once pointed two blocking steps at a
   menu item that had been renamed), an "expect" line per step, an "if instead"
   line naming what to record, and a report template at the end she can paste
   back. Which account each step needs (she runs two accounts in two browsers;
   name the browser AND the moment).

### Definition of done

R2 findings fixed and their mutations red; suite 35 clean on dev AND staging;
function deployed on staging + dev and hash-verified; five walkthroughs in
`docs/walkthroughs/` with every label grep-verified; vitest green; CI green on
the pushed head. `OUTSTANDING.md`: delete the suite-35 entry citing the
commit; the S43b closure note under the `provision-workspace` heading loses its
"not usable yet" line.

### Test plan (Audrey)

Walkthrough `02_setup_link.md`, on the beta's operator console, with a
throwaway company: create it, send the link, receive the email, set the
password, sign in as that admin, confirm the `WIL-7009` row in Audit names the
address. Then start `01_pet_reads_lessons.md` on the desktop app.

---

## Bundle A2 — timeline and milestones (2 sessions)

### What is wrong

Five `OUTSTANDING.md` entries and one unbuilt phase, all in one area:

- **A dependency re-wire deletes before it links.** `beginDependencyRewire`
  in `TimelineView.jsx` calls `onUnlinkDependency` and then `onLinkTasks` /
  `onLinkPhases`, neither awaited, no `runBatch`; a refused link (commonest:
  the `unique (predecessor_id, successor_id)` constraint) leaves a pure
  delete, the rollback redraws an edge the database no longer has, and undo
  is split in two.
- **Deleting a task or phase on the desktop leaves orphaned dependency
  rows.** `rabbitSubentityRoutes` in `electron/main.cjs` splices only the
  target collection; the edges stay in `project.json` and are re-mirrored
  into `{Slug}_DATABASES/tasks.json` and `timeline.json`. Cloud is unaffected
  (0061 CASCADEs on hard delete; soft delete keeps edges deliberately).
- **A desktop→cloud migration silently drops the whole dependency graph.**
  `src/cloud/migrate/runMigration.js` inserts projects, phases, assets, tasks
  and files and never writes `task_dependencies` or `phase_dependencies`.
- **Nothing checks dependencies when a status changes** — Phase 7, whose
  brief is written and correct: `docs/fixes/phase-7-dependency-status-warning/BRIEF.md`.
- **Milestones are cloud-dead**: `upsertMilestone` / `deleteMilestone` in
  `supabaseAdapter.js` throw "milestones table not yet created", and deleting
  one anywhere is immediate (`MASTER_PLAN.md` §6 #10).

### Audrey's decisions

7: *confirm first* — an "are you sure" before a re-wire, **knowing it does not
fix the loss**; the atomicity stays an `OUTSTANDING.md` entry. 8: *fix both*
the ghost links and the migration. 9: *warn, naming the unfinished
dependencies, then let the person continue* — the Phase 7 brief already says
warn-not-block, phases AND tasks. 38: *trash and undo for milestones*. 26:
*build cloud milestones* like scenes and levels got. Her standing directive
for R.A.B.B.I.T. (2026-08-10): *"full functionality and look of the original
main single user previous build"* — diff against `main` before designing
anything new.

### What to build

**Session 1 — the timeline.**

1. The confirm: a modal before `beginDependencyRewire`'s `onUp` commits,
   stating which edge is being replaced. Keep the gesture otherwise unchanged;
   narrow the `OUTSTANDING.md` entry to the atomicity that remains.
2. Ghost links: the desktop DELETE for tasks and phases sweeps every
   dependency row whose predecessor or successor is the deleted id, in the
   same write that removes the entity, so the mirrors never see them again.
   Measure the bundle shape first (which array holds phase edges vs task
   edges, and what `timeline.json` mirrors). Prove it with a route replay
   that has a FAILING CONTROL (delete a task with no edges and assert nothing
   else moved). `vitest.config` includes only `src/**` — the S30 replay-harness
   shape (`~60 lines over electron/main.cjs`'s routes) is the instrument.
3. Migration links: after tasks and phases are inserted, insert both edge
   tables through the id map; the dry run reports *"N task links, M phase
   links"* alongside its other counts, and a project with edges must show
   them in the Gantt after a real run. Pin with a test that counts inserts by
   table and fails when either insert is removed.
4. Phase 7 exactly as its brief: extend the `AssetStatusWarningModal.jsx`
   pattern, find EVERY status-write site (the brief counts at least seven and
   says a warning on one of them is worse than none), phases and tasks, warn
   and continue.

**Session 2 — milestones.**

5. Migration **0067** `public.milestones`: RLS enabled AND forced, workspace
   stamp + touch triggers, policies on `can_write_project` (not the money
   gate), no `FOR ALL` arm, `deleted_at` for trash from day one, **zero
   privileges held by `anon` OR `PUBLIC`** (scan, do not list — the S22
   grantee lesson), and a post-condition block. Suite **71** `71_milestones.sql`
   with a presence control, a member-can-write probe, a reviewer-cannot-write
   probe, a trash-then-restore probe, and the anon probe; add `milestones` to
   `RLS_TABLES` in `.github/workflows/rls.yml` (🚨 one file at the git root,
   two lists inside it). Apply to dev and staging by hand with the recipe,
   verify by query on both, **not prod**.
6. Adapter: replace the two throws with real methods, add a list method and
   the `milestones` key to `loadProject`, a `COLUMN_ALLOWLIST` entry, and
   extend `columnAllowlist.test.js` and `supabaseLoadProject.test.js` (the
   second exists because S24's permanently-empty `budgetVersions` was found by
   reading, not by a test). S17's "milestones survive a load" test (#47) must
   stay green on both adapters.
7. Trash + undo: soft delete, an undo toast on delete (assets already have
   one — `OWED_AUDREY.md` §3), a "Recently deleted" list with Restore, on
   BOTH backends (parity is her rule: Phase 3 exists because it was broken).

### Traps

- 🚨 **The S23 trap:** a SELECT policy that requires the parent to exist turns
  a successful write into a read that returns nothing. Milestones belong to a
  project and possibly a phase — if `phase_id` is nullable, the policy must
  hop to the PROJECT, as `shots_select` does, never to the phase.
- 🚨 **The `!inner` loader (`listDependenciesWith`) is workspace-scoped, not
  project-scoped, and deliberately unfixed** — do not "tidy" it in passing;
  it draws every arrow in the product and ends in `.catch(() => [])`.
- The `!inner` + constraint-hint query form has never run against real
  PostgREST here; if you touch a dependency query, settle the syntax with one
  authenticated GET against staging first.
- Every new probe must be proven by BREAKING it; a suite that never RAN is not
  a breaker that fired (`--reporter=basic` does not exist in vitest 4).

### Definition of done

Confirm modal; no orphan rows after a desktop delete (replay-proven with a
control); migration carries both edge tables (test-pinned); Phase 7 shipped
per its brief with every write site listed in the commit; 0067 + suite 71 on
dev and staging by query; milestones work on both backends with trash and
undo; vitest and `tap-all` green; CI green on the pushed head; walkthrough
`06_timeline_and_milestones.md` written and label-checked. `OUTSTANDING.md`:
delete the ghost-links, migration and "milestones local-only" facts; narrow
the re-wire entry; close-out row in the session log.

### Test plan (Audrey)

On the beta, one project with three tasks and two phases: link A→B, re-wire
B→C and see the confirm; mark B *Final* while A is *Not started* and read the
warning, then continue; create a milestone, delete it, press Undo, delete it
again and restore it from Recently deleted. On the desktop, Local Server:
delete a task that has links, reload, confirm no stray arrows. Then run the
migration tool on a desktop project that has links, dry run first, and count
the links it reports.

---

## Bundle A3 — the pet's lifecycle (1 session)

### What is wrong

Seven `OUTSTANDING.md` entries from Phase 3, all INFERRED, all in the pet's
read/write path in `src/App.jsx` (the pet effect keyed
`[perms.ready, perms.userId]`), `src/lib/userState.js` (`resolveUserPet`,
`mirrorPetToCache`, the cloud save), `src/lib/petLifecycle.js`
(`applyOfflineDecay`, `canCreateNewEgg`) and `src/lib/localData.js`
(`PET_KEY`, `getDataDir()` in `electron/main.cjs` has no user segment):

- no live sync; a second open window writes its stale copy back;
- the pet needs Supabase even on Local Server (`mirrorPetToCache` runs only
  after a cloud save succeeds);
- a pet saved as `corpse` never becomes a ghost if the app closes inside the
  10-second promotion timer;
- Pet Mode OFF does not protect the pet while closed (`applyOfflineDecay`
  never reads `petMode`; it also ends no sleep and performs no evolution);
- the per-device cache is keyed to the machine, so a shared computer can
  adopt person A's pet into person B's account;
- a failed cloud read leaves the stale device pet routed to the account
  (`petUserIdRef.current` is set before the async read);
- the `user_pets.feedback` size cap is untested and Create Egg is the write
  most likely to trip it.

### Audrey's decisions

4: *refuse to save an older copy over a newer one; the stale window gets a
refresh notice.* 5: *cloud-only; drop the offline promise and say so on
screen.* 6: *fix all three death oddities together.* (Live sync — answer 4's
"Big" option — was NOT chosen.)

### What to build

1. **Refuse older copies at the database, not only in the client.**
   Migration **0068**: a BEFORE UPDATE trigger on `public.user_pets` that
   raises when `NEW.last_updated_at < OLD.last_updated_at` (the anchor column
   0046 made load-bearing; `updated_at` is the touch column and is not the
   comparison). The client sends the anchor it holds; on the refusal it does
   NOT retry, marks its copy stale, re-reads, and shows *"Your pet changed on
   another device — refreshed"* on a surface that does not depend on the pet
   rendering (Settings' pet card AND a toast — the existing save banner lives
   inside the chat popup and is invisible unless the pet has hatched, which is
   its own entry). Extend suite **56** (one suite per table) with the refusal
   probe and an ACCEPTING control (a newer anchor is allowed), each proven by
   a breaker. Apply 0068 to dev and staging by hand, verify by query.
2. **Cloud-only, stated.** The Settings pet card and the companion's failure
   copy say the pet lives in the account and needs a connection; remove the
   "works offline" claim from `docs/fixes/phase-3-pet-new-egg/BRIEF.md`'s
   definition and from the handbook. Leave the sub-second `POST /api/pet`
   branch alone unless it is dead — measure whether anything can reach it.
3. **The death trio.** (a) On load, promote a `corpse` whose `diedAt` is
   older than the promotion window to `ghost` — the state machine completes
   instead of stalling; `canCreateNewEgg` keeps accepting both. (b)
   `applyOfflineDecay` honours `petMode === false` (no elapsed decay applied
   while off); state in the commit what it does about sleep and evolution
   offline, because today a sleeping pet is immortal and a baby cannot grow
   while closed — mirror the live tick or say why not. (c) The device cache is
   keyed by account (`pet.<userId>.json` on disk, `PET_KEY:<userId>` on the
   web) AND cleared on sign-out (`clearSession` → a new IPC for the disk copy),
   so `resolveUserPet` can only adopt a cache the same account wrote. (d) Set
   `petUserIdRef.current` only after `resolveUserPet` succeeds; on a failed
   read keep the previous routing and show the error — the S34 storage-root
   effect two blocks below already refuses to act on a failed read; copy it.
4. **The feedback cap:** one probe that writes a maximal legitimate feedback
   array (50 entries × the real reply size) and passes, and one that exceeds
   `262144` bytes and fails on the CHECK — an accepting control and a
   refusing probe, both in suite 56.

### Traps

- 🚨 **S31 DELETED the 30-second auto-save on purpose** — on a shared row that
  timer *is* the clobber. Do not reintroduce a timer; hunger and happiness are
  values at an anchor, recomputed on read.
- 🚨 `isRealPet()` is the adoption discriminator; a pristine egg can never
  beat anything. Keep it in front of every adoption path you touch.
- The decay reducer returns the identical object for an egg, a corpse, a
  ghost or `petMode` off — effects keyed on `petData` will not re-run for
  those; that is how the old timer fired over another machine's state.
- `0046` is the project's first per-user write policy — classify a policy by
  its SHAPE, not by grepping for `auth.uid()`.

### Definition of done

0068 + suite 56 extensions on dev and staging by query, breakers red; the
stale-window notice visible without the pet rendering; corpse promotes on
load; Pet Mode off pauses decay while closed (measured: set `petMode` false,
push `last_updated_at` back six hours in `user_pets`, reload, read `hunger`);
cache keyed by account and cleared on sign-out (measured: sign out, sign in
as a second account with no pet row, read that row afterwards — it must be
absent); vitest green; walkthrough `07_pet_lifecycle.md`. `OUTSTANDING.md`:
delete the seven entries, citing the commit; the "failed pet LOAD has nowhere
to show itself" entry closes with the new surface.

### Test plan (Audrey)

Two computers, same account: create an egg on A while B is open on the old
ghost; on B, pet it — expect the refresh notice, not the ghost coming back.
Then on one computer: turn Pet Mode off, close the app for an hour, reopen —
hunger unchanged. Let a pet die and close the app within five seconds; reopen
— a ghost, and Create Egg works.

---

## Bundle A4 — O.T.T.E.R. (1 session)

### What is wrong

- **"Suggest a change…" is offered on forks of a demoted standard**, where the
  POST fails at RLS. `CourseRowMenu.jsx`'s `maySuggest` gates on
  `!!course?.source_course_id && canReadCourse(course)` and never re-checks the
  source's tier. Audrey's fix already exists: `b051e20` on branch
  `claude/sleepy-meninsky-0b4ae6` (worktree at
  `WILSON/.claude/worktrees/sleepy-meninsky-0b4ae6`), with `3e18d1f` docs.
- **Signing in on the desktop hides the six local courses** with no way back.
  `otterFetch` routes to Supabase whenever the session carries a
  `workspace_id`; `setOtterAdapterMode` in `src/tools/otter_v0.3.1/adapters/index.js`
  is "the Settings override" two comments describe and has **zero callers**.
- **A dead field:** O.T.T.E.R. → its own Settings → Tools tab (padlocked by
  default) → "Storage Location" in `Otter.jsx`, editable, does nothing
  (`RELEASE_TESTING.md` "Known not to work" #3). The project-files location in
  General settings is REAL and stays.
- **A manager can approve their own nomination.** `otter_nomination_apply`
  (0064) checks role, not authorship; the UI hides the decide controls on your
  own row; the route is open.
- **Approving a change request moves subjects but not the five reference
  documents.** `otter_cr_apply` (0025) moves subjects; the documents' merge
  semantics live in client JS (`MASTER_PLAN.md` §6 #29 explains why plpgsql
  was avoided).

### Audrey's decisions

2: *merge her fix branch.* 3: *a Settings switch to view the local library
while signed in.* 28b: *remove the O.T.T.E.R. field.* 36: *allow
self-approval, with an audit line saying they approved their own.* 37: *move
the reference documents too.*

### What to build

1. **Merge `claude/sleepy-meninsky-0b4ae6`** into the track branch with a
   merge commit; run vitest; read the diff — it is hers, review it like any
   other change; after it lands on `feat/multi-user-v1`, `git worktree remove`
   that worktree (tell her first; it is hers).
2. **The library switch**, desktop only (local courses exist only there): an
   O.T.T.E.R. Settings control *Library: Company (signed in) / This computer*,
   persisted per device, calling `setOtterAdapterMode`; a notice on the
   library screen whenever the local library is hidden. 🚨 Phase 6's retrieval
   (`petKnowledge.js`) reads through the same `otterFetch` seam — it must
   follow the switch, and its cached index must be invalidated when the mode
   changes, or the pet answers from the other library. Read the auto-memory
   `wilson_otter_cloud_traps` (eighteen ways a write is discarded or a suite
   lies) before touching the adapter boundary.
3. **Remove the dead field** and update `RELEASE_TESTING.md` #3.
4. **Self-approval audit line.** Migration **0069** re-creates
   `otter_nomination_apply` (🚨 preflight the arms you are replacing on each
   env, restate the whole body, post-check they survived — 0059 became a live
   privilege escalation by dropping arms during a `CREATE OR REPLACE`), and
   when the nominator is the caller writes an `app_events` row with a new
   code. 🚨 **The event vocabulary lives in FOUR places** — `src/cloud/errorCodes.js`,
   the handbook Appendix B, the Admin Terminal's Logs filter, and the writer —
   and `platformAuditActions.test.js` found on its first run that two codes had
   been in a CHECK for weeks and never in the console filter. Add all four;
   extend suite 70 with a self-approval probe that reads the event row.
5. **Reference documents on approval.** Measure first: what are the five
   documents, where do they live on a course, and what does the client's merge
   do (`ChangeRequestsSection.jsx` / `RequestsView.jsx` / the
   `supabaseOtterAdapter.js` `otter_cr_apply` caller). Then choose and STATE
   the choice: either the approver's client applies the document merge after
   the RPC succeeds (it must read the fork's documents BEFORE the RPC, because
   the consented review window CLOSES on decision), or the merge moves into
   plpgsql and duplicates the client rule (§6 #29's objection). Whichever:
   the archive copy `<name> (before change #n)` must hold the OLD documents
   too, and additivity holds (a document deleted on the fork is still present
   on the standard).

### Traps

- 🚨 `fn_otter_pin_course_identity` never raises — it assigns the old value
  back and the UPDATE reports success. Any new caller compares sent vs
  returned, as `ShareCourseDialog` does.
- 🚨 `otter_courses_select` has NO admin arm and three migrations ship
  post-conditions that fail the build if `current_app_role` appears there.
- `parsed.software_name` overrides the name a person types when generating.
- Replay any retrieval or scoring change against her REAL library
  (`%APPDATA%\wilson\otter-data\software`, six courses, 49 subjects), never
  a fixture — the technique that found what 1652 green tests missed.

### Definition of done

Her fix merged; the switch works on the desktop and Phase 6 follows it; the
dead field gone; 0069 on dev and staging by query with the preflight and
post-check recorded; the audit line in all four vocabulary places; documents
move on approval with the archive holding the old ones; vitest green;
walkthrough `08_otter.md`. `OUTSTANDING.md`: delete the four entries
(dead-end, local courses, dead field, self-approval), narrow or delete #29's
residue, session-log row.

### Test plan (Audrey)

Desktop: sign in, flip the switch to *This computer*, see your six courses;
ask the pet a Blender question and confirm it answers from them. Beta: demote
a standard, open a fork's menu — no *Suggest a change…*. As a manager,
nominate and approve your own course; Admin Terminal → Logs shows the
self-approval line. Approve a change request whose fork edited a reference
document; open the standard and see the change, then open the archive copy
and see the old text.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command; write scripts to
files. Query the database rather than trusting migration text or commit
messages (0066 was "applied nowhere" in its own commit message and on two
environments in fact). One query per `--file`. Count `<!--` / `-->` after
editing long markdown. `otterFetch` and `fetch` resolve for EVERY status.
Never read `data.content[0].text`; use `textFromMessage`. Enumerate the
exports and grep each for a caller before committing — ten features have
shipped with none. A brief is a hypothesis: verify its root cause before
building its fix. Cite symbols, not line numbers.

⚠️ **Deploy order for anything with a migration: dev → staging BEFORE the git
push**; `feat/multi-user-v1` auto-deploys the staging-backed beta. **Never
`supabase db push`** while 0065 sits unapplied; apply by hand. Prod gets
nothing from this track; it waits for the release session.

🚨 **Two review rounds before every merge.** R2 reviews R1's corrections.
Then the walkthrough goes to Audrey and the bundle merges only after she
reports.

## Close-out ritual (per bundle, then once for the track)

1. `docs/OUTSTANDING.md`: delete what is fixed citing the commit, narrow what
   remains, add a session-log row. Adding nothing is a valid outcome.
2. Migration verified **by query on dev AND staging**; CLI re-linked to
   wilson-dev; `tap-all` clean against dev and staging; full vitest; new
   suites registered in `.github/workflows/rls.yml` (both lists).
3. Merge `feat/multi-user-v1` into the track branch, resolve, re-run tests;
   then merge the bundle into `feat/multi-user-v1` with a merge commit and
   push; CI green on the pushed head, Playwright included.
4. Handbook §17 and the affected sections rewritten from "decided" to "shipped",
   limits stated in both directions.
5. Update the auto-memory: `wilson_migration_rules` (numbers used, env state)
   and `wilson_session_history`.
6. **Close out in the chat** with the remaining-bundle list and a plain-English
   breakdown for Audrey: fixed / only diagnosed / hers to do. Never let a
   diagnosis read as a fix.
