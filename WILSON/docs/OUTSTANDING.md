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

✅ **The emailed setup link is DEPLOYED and testable** — S43b (`186fa63` +
`df257d0`), second-reviewed and shipped by Track A bundle A1 (`5dcff98`,
2026-09-06): `operator-workspaces` v10 on staging and v12 on dev, both
hash-verified against the source from a scratch download; migration 0066 was
already on both by query. Prod has neither 0064, 0066 nor the function — the
release session does prod, in that order. The R2 round found one defect inside
the corrections (the read-only `admin_contact` action did not catch the shared
lookup's throw, so a database hiccup read as "Network error") and fixed it.
Walkthrough `docs/walkthroughs/02_setup_link.md` is hers; the bundle merges
after her report.

---

## Broken features

### The signed-out desktop's bins freeze the window on a share whose server does not answer
**MEASURED (BC2, 2026-10-09).** The Local Server's bins routes
(`/api/rabbit/bins/*` in `electron/rabbitBins.cjs`: the list's online check,
relink scan, probe, thumbnail, stream) test each clip's path with
synchronous `fs.existsSync` / `fs.statSync` in the desktop's MAIN process.
Measured on Windows with Node, the first such call on a dead network
address is held **5.0 s** for a name that does not resolve
(`\\salthours-nas\footage`) and **42.1 s** for an address nothing answers
(`\\10.255.255.1\…`); the window is frozen for that long. BC2 fixed the
same thing for the cloud routes (`rootReachable`: one asynchronous question
per location root, 2 s limit, kept 15 s — `rabbitCloudBinsDeadShare.routes.test.js`)
but B12 kept the signed-out routes untouched. Fix shape: the same root
question for each known bin root before its clips are touched.

### Adding a big folder from a company share walks it on the desktop's main thread
**INFERRED (BC2 review round 2, 2026-10-09).** `POST /api/rabbit/cloud-bins/prepare`
(`electron/rabbitBins.cjs`) asks the location's ROOT off the main thread
first, then walks the picked folder with the synchronous helpers the
signed-out add uses (`walkFolder`, `detectSequence`, `cloudFileItem`'s
`statSync`): up to 5,000 entries, one network round trip each, on the main
process. A big folder on a slow share holds the window for seconds while the
add dialog fills; a share that dies mid-walk holds it until Windows lets go
(up to 42 s measured for one call). Measured only small: a 12-frame sequence
walked in 33–44 ms over the stood-up share. Settle it by timing a folder of a
few thousand files over SMB on a LAN. Fix shape: run prepare's walk in a
worker thread, as the root question now is.

### The desktop→cloud migration carries no shot lists, list items, edits, folders, comments, milestones, budgets, expenses, levels, experiences, team or links on tasks
**INFERRED (BC3, 2026-10-09; read from `src/cloud/migrate/runMigration.js`;
widened by review round 2).** The runner copies projects, phases, assets,
tasks, the two edge tables, files, and — since BC3, because a take needs its
shot — scenes, shots, bins, footage locations, clips and takes. It copies
none of the desktop bundle's other collections: `shotLists`,
`shotListItems`, `edits`, `folders` (S3a, `active_shot_list_id` dropped,
scope#9, chose not to carry lists, and nothing since has), nor `comments`,
`assetVersions`, `milestones`, `budgetVersions`, `budgetLines`,
`budgetActuals`, `expenses`, `projectRateOverrides`, `levels`,
`experiences`, `teamAssignments`, `projectTeam` or `taskLinks` — each a
route the desktop serves (`rabbitSubentityRoutes` in `electron/main.cjs`)
and keeps in the same bundle; nor a scene's or shot's `thumbnail_image` (a
file on the desktop's disk). "Archive and clear local" then moves the only
copy of all of it into the archive JSON, which no screen reads back. Since
review round 2 the report names what stays, by count, BEFORE the archive is
offered (`NOT_CARRIED` / `notCarriedOf` in `src/cloud/migrate/binsMigration.js`,
the panel's "Stays on this computer (the migration does not carry it)"
line, the archive button's hover), so "Done" means what moved and this says
what did not. Settle it by migrating a desktop project that has a budget,
two lists and an edit and opening its tabs in the cloud. Fix shape: carry
`shot_lists` and `shot_list_items` after the shots (ids kept; the composite
FKs of 0084 allow it), then `edits`, with `active_shot_list_id` set last;
`folders` after the files; the budget tables in their own order (versions,
lines, actuals, expenses, overrides); comments, asset versions, milestones,
levels, experiences and the team after their parents — and the archive
button waiting until the list is empty.

### The cloud's own address CHECK admits control and formatting characters
**INFERRED (BC2 review round 2 deferred it; BC3 review rounds 1 and 2 widened
the guards; read from `supabase/migrations/0091_bins_on_the_cloud.sql`
`bin_locations_unc_path_shape_chk` and the three `isUncPath` guards).** The
desktop's, the renderer's and the fixtures' guards refuse every control and
format character, both separators and every default-ignorable code point
(`UNC_FORBIDDEN_CHARS_RE`, one Unicode-property regex, held equal by
`binsAdapterParity.test.js`); 0091's CHECK refuses the path's shape and the
nine Windows-forbidden characters only. A location written past the app —
through the REST API with a member's key — can carry a right-to-left
override or a zero-width space into every Connect question in the company.
Settle it with `psql`: insert a `bin_locations` row whose `unc_path` holds
U+202E and watch it land. Fix shape: a migration (0093 or later) adding the
same refusal to the CHECK through a small SQL function (PostgreSQL's regex
has no Unicode-property classes; the function tests the code points), and
the adapter's `BINS_REFUSALS.locationShape` sentence already covers it.

### A second desktop→cloud migration brings back rows a teammate removed from the cloud
**INFERRED (BC3 review round 1, 2026-10-09; read from `src/cloud/migrate/runMigration.js`
`insertOrSkip`).** The runner is idempotent by KEY: a row already in the
cloud is skipped (23505), a row not there is inserted — for every table it
carries, since Track A A2, and since BC3 for scenes, shots, bins, clips and
takes too. So a run after a teammate removed a clip (B10), a bin, a scene or
a task in the cloud puts it back, with its takes; nothing in the cloud
records "carried, then removed". The dry run's *Would insert* column shows
the count and Help says it; walkthrough 58 step 23 walks it. Settle it by
migrating, removing a clip in the browser, and running again. Fix shape: a
per-computer record of the ids each run carried (the desktop's own settings
file, as the per-computer folder of a footage location is kept), so a later
run inserts only ids never carried; until then, archive and clear the
desktop's copy once everything is in the cloud.

### The cloud keeps no sample rate or channel count on a clip
**INFERRED (BC3 review round 1, 2026-10-09).** The desktop's probe writes
`sample_rate` and `channels` on a clip (`electron/rabbitBins.cjs`, the
probe route) and the inspector shows them (`BinInspector.jsx` `TechRows`,
the Audio line); 0091's `bin_files` has no such columns and the cloud
adapter's `BIN_FILE_COLUMNS` drops them, so a clip added from the desktop
signed in, or migrated, shows no Audio line in the cloud. The migration
strips them before `toColumns` so the console is not warned once per clip.
Fix shape: two nullable columns on `bin_files` (0093 or later), the
allowlist, and `add_bin_files` accepting them.

### A private project's media body is never purged from the desktop
**INFERRED from the design (2026-09-11, the private-projects build,
`4c10387`); a stated limit, not yet seen to matter.** Cloud rows with
`storage_provider = 'local_server'` keep their bodies under the desktop's
local media root (`electron/localMedia.cjs`). `deleteFile` is a soft delete
that leaves every provider's blob in place (the documented blob-GC gap), and
the hard-delete / GC sweeps run in the cloud (`trg_files_gc_enqueue`, the
orphan scan, the teardown sweep), which cannot reach a disk: a local body
outlives its row for ever. §4a2b invariant 3 ("purge is provider-aware") is
therefore not met for this provider. Fix shape: on the desktop, a sweep that
lists `local-media` keys and unlinks any whose row is gone — or a `del()`
from `deleteFile` when the row is hard-deleted. Until then, *Reset demo
folder* deliberately leaves `media\` alone (its rows outlive the folder).

### O.T.T.E.R. software routes join a route parameter onto `getSoftwareDir()` raw
**INFERRED from code reading (adversarial review round 2 of the local demo
folder, 2026-09-10); not yet measured.** The same shape that round measured
on the R.A.B.B.I.T. per-id routes (fixed the same day with `dataFilePath`):
`electron/main.cjs` joins `req.params.slug` / `req.params.sub` onto
`getSoftwareDir()` in the O.T.T.E.R. software routes (the review named lines
486, 492, 574–595, 600, 618–620, 642, 659, 695–700, 721–726, 762–768, 803–808
and 883–899 at `1ab8593`), and Express 5 decodes `..%2F` to `../`, so a
caller of these routes can read, write or unlink outside
`userData/otter-data` — up to and including an open demo folder. Since B3
(Track B, 2026-09-07) that caller is the app's own renderer (any script on
its origin: the launch cookie rides every same-origin request) or a holder
of the per-launch token — an unauthenticated local page now gets a bare 401
from every `/api` route — which narrows the reach, not the defect. Fix shape:
the same `dataFileOrThrow` the R.A.B.B.I.T. routes use, one line per helper.
Out of the local-storage item's scope (O.T.T.E.R. stays in userData, brief
Q2); settle it by copying the routes into a scratch express app the way the
review's `repro-express.cjs` did.

### An offline launch cannot get past the sign-in screen, however fresh the saved sign-in
**MEASURED 2026-09-10 22:41 — a staging build at `b8c2bed`, Audrey's real
sign-in saved on a test window, relaunched with `WILSON_DEV_OFFLINE=1`: the
`GET /auth/v1/user` is cancelled 10 ms after the page loads (`[wilson]
setSession failed: Failed to fetch`) and the sign-in screen is up 4.5 s after
the page loads, the same as a signed-out launch; with `=stall` the restore
times out at 15.0 s (`session restore timed out after 15000ms`) and the
sign-in screen follows 4.3 s later — never an orange window.**
`checkSessionValid()` (App.jsx) restores the saved
session through `hydrateSupabase()` → `supabase.auth.setSession()`, and
`@supabase/auth-js` 2.101.1 `GoTrueClient._setSession` calls `_getUser()`
(GET `/auth/v1/user`) for a token that has NOT expired
(`dist/main/GoTrueClient.js` line 2815); an unreachable auth server turns that
into an error, `hydrateSupabase` returns null, and the boot lands on the
sign-in screen with no way through. The demo script's step 6 ("close and
relaunch … pull the cable at any point") therefore holds only when the
relaunch happens online; walkthrough 18 "The cable pulled" says so. Fix
shape (a policy decision, asked in the local-storage hand-off): in
`hydrateSupabase`, when the saved token is unexpired and `setSession` fails
with a retryable fetch error, return the saved session so the shell opens
offline; cloud calls then fail honestly and the Storage card follows
solo-user rules until the next online launch. Owner: the local-storage
session (`demo/local-storage`). **2026-09-10, later:** Audrey chose cloud data
for part 1 of the demo (`DEMO_LOCAL_STORAGE_BRIEF.md` §7), so an offline
LAUNCH is no longer a Friday requirement and the offline-tolerant launch is
not being built; the bounded restore (`c5e5a77`) stands, measured above. The
limit itself stands and is stated in walkthrough 18 "The cable pulled".

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

### A failed pet sync is never retried until WILSON is relaunched

**MEASURED by the A3 review rounds (2026-09-07).** When `resolveUserPet` throws
— a transient Supabase blip on sign-in — `petUserIdRef` is deliberately left
null so the failure cannot re-point writes at the account (that is the fix for
the entry this replaced). Nothing then installs it: the identity effect is keyed
`[perms.ready, perms.userId]`, both primitives, and `usePermissions` re-renders
on `TOKEN_REFRESHED` without changing `userId`, so the effect never runs again
for that session. Every subsequent pet save fails for the life of the process.

It is not silent — the save reports *"Your pet could not be reached in your
account, so this change was not saved. Reopen WILSON to try again."*, and the
copy names the relaunch precisely because nothing retries. The pet on screen is
this account's cached one, so nothing is lost or shown wrongly.

Would fix it: a nonce ref bumped on a failed resolve and included in the
effect's dependencies, driven by a bounded backoff or by `navigator.onLine`.
Small. Not scheduled — it needs a decision about how hard to retry against a
service that may be refusing on purpose.

### The pet does not sync live between machines

**INFERRED (2026-08-12, Phase 3); NARROWED by Track A bundle A3 (2026-09-07,
`5add1d4` + `700588e` + `7322e12`).** The account pet is read once, by an effect keyed
`[perms.ready, perms.userId]`. There is no subscription and no refetch, so a
computer left open never learns that the pet changed elsewhere.

🚨 **The second half of this entry — "and writes its stale copy back" — is
CLOSED.** Audrey's ruling 4 (2026-09-07) chose refusal over live sync:
migration 0068 is a BEFORE UPDATE trigger on `public.user_pets` raising
SQLSTATE `WP001` when `NEW.last_updated_at` is older than the stored row's, and
the client no longer stamps a fresh anchor on every save, so the anchor a
window sends is the one it is holding. On the refusal it does not retry — it
re-reads the account and shows *"Your pet changed on another device —
refreshed."*

⚠️ **What is still open, precisely.** Two timestamps cannot order two writers
that have both legitimately moved forward. A second window showing a LIVE pet
with Pet Mode ON advances its own anchor every thirty seconds from its own
decay tick, so its copy is genuinely newer and its write is accepted.

A first version of this paragraph claimed every window showing an egg, a
corpse, a ghost or Pet Mode off was protected. **That is too strong, and it was
corrected by the bundle's own review round.** A write is refused only when its
anchor is OLDER than the stored one, which needs the *winning* writer to have
advanced the anchor. Two windows both sitting on a non-decaying pet hold the
SAME anchor, equal is allowed by design, and the second still overwrites the
first. So: protected when the other machine has moved the pet on — creating an
egg, feeding, petting a *hatched* pet, hatching, waking, a decay tick, or the
second save of a Pet Mode resume. Not protected when neither has. (Petting an
egg that does not hatch does not move the anchor; the egg's own mint did.) Audrey's reported case (create an egg on PC A
while PC B sits on the old ghost) is protected, because minting an egg stamps a
fresh anchor.

⚠️ It is also **clock-sensitive**, because the anchor is client-supplied: a
machine whose clock runs fast always wins, and one whose clock runs slow is
refused, re-reads, adopts the account's anchor and can then write. A skewed
clock degrades the guard rather than trapping anybody, but it does so
silently.

Closing the rest needs a revision counter or the live sync ruling 4 declined.
A second window still needs a reload to SEE a change.

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

**Narrowed by Track A bundle A2 (`643b5ca`, 2026-09-06), Audrey's ruling 7.** The
gesture now asks first: releasing the arrow on another bar parks the rewire, and
`DependencyRewireModal` names the edge being replaced ("A → B becomes A → C") and
says the old link is removed before the new one is saved. "Replace link" runs
unlink-then-link (`commitRewire`); "Keep old link" writes nothing; the mouseup
itself no longer links (pinned by `dependencyRewire.test.js`). She accepted the
confirm knowing it does not fix the loss. What remains is exactly the atomicity
above — neither write awaited, no `runBatch`, the stale-snapshot rollback, the
split undo — and it is all this entry now claims.

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

### The Dashboard writes task statuses without the Phase 7 dependency warning

**INFERRED (2026-09-06, code reading).** Phase 7 (`643b5ca`) warns, naming the
unfinished predecessors, on every R.A.B.B.I.T. task- and phase-status write and
lets the person continue. The Dashboard is the one surface it does not reach:
`DashboardTasksView.jsx`'s status select and its kanban drop write through
`useMyTasks.patchTask`, and the cross-project task model (`useMyTasks`) loads
tasks, phases and the roster but no `task_dependencies` rows. `TaskDetailPopup`
carries the guard, but the `ctx` the Dashboard hands it has no `dependencies`
array, and `statusWarning` answers null for "cannot check", never "clean". So a
task marked Final from the Dashboard over an unfinished predecessor gets no
warning, while the same task on the Tasks tab does. The Phase 7 brief's own
warning applies: a check that fires on six screens and not the seventh trains
the reader to trust silence.
→ `useMyTasks` loads the edges for its tasks (one `task_dependencies` query on
`successor_id in (…)`, cloud-only like the rest of the hook), passes
`dependencies` in the ctx it gives the popup, and its own two writers call
`useDependencyStatusGuard`. Not scheduled.

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

### One hung `getSession()` pins the whole app's auth — reconnect deferred, banner shipped (Track B B2 part 2, 2026-09-06)
**NARROWED (B2 part 2).** The pin is now reproduced on demand and has a
surface. `scripts/probes/connection-hang.mjs` against wilson-dev: a refresh
that never settles, a PostgREST read behind it that never resolves and never
issues a request, `getSession()` stuck behind the same shared
`refreshingDeferred`. `src/cloud/connectionWatchdog.js` wraps the one fetch
supabase-js uses and raises **"Connection lost — reload to continue"** when
an auth, PostgREST or storage-download request is pending past 20 s while
`navigator.onLine` is true (uploads, the resumable path and every Edge
Function call are outside it by construction; a slow upload never trips it,
pinned by test). Reload is the remedy; **reconnect logic is deferred by
Audrey (fix plan answer 10).** What remains open is only the reconnect:
nothing outside the SDK can cancel its shared refresh promise, so a real
fix is a client re-create on detection or an SDK change. The measured facts
below stand.

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

→ Deferred by her choice (answer 10). The banner above is the surface until
a reconnect is designed; when it is, design it before writing it.

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

### `POST /api/software` on the local server silently discards `visibility`
**MEASURED at code level (2026-08-12, Phase 5); latent.**
Both O.T.T.E.R. create paths send a `visibility` field (`generateCourse` and the
agent path). `electron/main.cjs` drops it, and the caller's guard
(`if (!metaRes.ok || !meta?.slug)`) cannot detect the loss. Harmless **today**
only because the tier picker is wrapped in `{isCourseMode && cloudMode && …}`, so
the field is never sent on the backend that ignores it. It becomes a real bug the
moment anything offers tiers outside cloud mode.

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

### Three storage event codes are written and documented but not in the client registry
**MEASURED 2026-09-07 (Track A, A4), by the guard that now pins this.**
`WIL-3005`, `WIL-3006` and `WIL-3007` are written by
`supabase/functions/storage-secret/index.ts` and have rows in `SYSTEMS_HANDBOOK`
Appendix B, but have **never** been in `src/cloud/errorCodes.js`. So
`describeErrorCode()` returns *"Unknown error code"* for all three in the Admin
Terminal → `Logs` view, which is the only place they are ever read.
→ **Not fixed here on purpose:** they are Track C’s codes and this was Track A’s
bundle. The fix is three lines in `ERROR_CODES`. `src/cloud/eventVocabulary.test.js`
exempts exactly these three BY NAME and fails on any NEW drift, and its
"the exemption list is no wider than the drift" probe goes red the moment one of
them is registered — so the exemption cannot outlive the bug.

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
| Post-overhaul BC3 (2026-10-09; `po/bc3-bins-web` into `feat/post-overhaul-edit-versioning`) — the browser's Bins tab (the catalogue, B5) and a desktop project's bins moving to the cloud (B9); two review rounds | **four entries under Broken features:** *the desktop→cloud migration carries no shot lists, list items, edits, folders, comments, milestones, budgets, expenses, levels, experiences, team or links on tasks* (INFERRED; pre-existing, found while adding the bins' part, widened to every collection by review round 2, which also made the report name what stays before the archive is offered; scenes and shots are carried since BC3); *a second desktop→cloud migration brings back rows a teammate removed from the cloud* (INFERRED, review round 1; pre-existing for every table, widened by BC3); *the cloud keeps no sample rate or channel count on a clip* (INFERRED, review round 1; 0091); *the cloud's own address CHECK admits control and formatting characters* (INFERRED; BC2 deferred the migration, BC3's guards refuse them by Unicode property since review round 2). | nothing. |
| Post-overhaul S4d (2026-10-09; `po/s4d-legal-gate-managers` into `feat/post-overhaul-edit-versioning`) — the Legal gate of its own (0092): workspace managers see Legal files without a seat, money unchanged, a deleted file's record follows the file's gate; two review rounds | **one section at the end: S4d-01**, an older gap found while copying 0072's arm into the predicate (the eight money storage policies carry no private-project hop of their own, so a non-creator project manager reaches a private project's invoice OBJECT while its row is hidden; INFERRED from 0042's text). Dated notes on S4b-03 (the Legal audience refreshes too) and S4b-05 (the Legal half is moot). | nothing closed: S4b-10 and S4b-11 stay Audrey's. |
| Post-overhaul S2a (2026-09-30; `po/s2a-settings-placement` into `feat/post-overhaul-edit-versioning`) — settings at each strip's right end, the orange Audrey named, the pet's Shift tap; two review rounds | **one section at the end: seven entries the two review rounds found and S2a did not fix** (other sessions' files, the kit, or not S2a's to change): S2a-01 🚨 Bins' keys act from every page (Delete removes up to five selected files without a question; MEASURED for Enter), S2a-02 the hand-rolled modals the Shift rule cannot see, S2a-03 the kit Drawer's focus, S2a-04 the workspace chooser's Enter, S2a-05 the unlayered scrollbar rule, S2a-06 D.O.G.'s Enter during the leave transition, S2a-07 the Timeline drawer's "RABBIT settings". Dated notes on P1-02, P1-03 (now the one place Enter does something else; a stranded Search freezes the keys) and P1-04 (D.O.G.'s Alt, arrows and Ctrl+Z have no page check). | **P1-01 closed**: a bare Shift tap toggles the pet and Enter presses the focused control (`05bf5fe`, `edb7fa9`, `07d34d6`). |
| UI overhaul P1 (2026-09-27; `ui/p1-close` into `feat/ui-overhaul`, which is merged nowhere) | **one section at the end: the overhaul as its last session left it.** V2's §4.2 sections A (behaviour, left under C1) and B (older bugs and data), each row with its number, owner and origin; the visual rows P1 did not close and why; autoplay (R4-36), which plan §5 named for this file; the pet over the page. Questions stay in walkthrough 47, not here. | nothing: no earlier entry was the overhaul's. Comment markers: 5 → 5, still pairing. |
| Track C / **migration 0078** (2026-09-09) — the quota exemption bounded by size; pgTAP suite **77 extended** (probes 54-68), five breakers; two review rounds | **nothing.** | **One entry CLOSED: a receipt was exempt from the Petal storage quota at any size.** C4 made a receipt land under an `INVOICES/` segment so it would be money-gated, and that segment is what `rabbit_quota_exempt_path` (0055) keys on — so a receipt could not be refused however large, while `workspace_petal_committed_bytes` kept counting its bytes against the allowance that refuses ordinary media. Measured ceiling: the bucket's own **50 GiB** per object. Not a security hole (0037 gates `expenses`), a billing one. Audrey's ruling, asked and answered this session: **bound the exemption by size**, not cap the picker. 0078 adds `public.rabbit_quota_exempt_max_bytes()` = **25 MiB** as the one definition, plus `rabbit_quota_exempt_bytes(name,bytes)` and `rabbit_quota_exempt_object(name,md)` composed over it; `rabbit_quota_exempt_path` is UNCHANGED and delegated to, so suite 65's probes 13-17 stay green. 🚨 **THE HAND-OFF NAMED ONE ENFORCEMENT SITE AND THERE ARE TWO.** Besides the RESTRICTIVE `petal_storage_quota_insert`, `reserve_upload_bytes` (0073, C1) returned NULL early for any exempt path — and that is the one the CLIENT calls, before any byte moves. Bounding only the policy would have let a large receipt reserve nothing, upload, and be refused at commit, which is the exact failure C1 exists to remove. Breaker B3 proves it: bound the policy alone and probe 55 is the ONLY probe that reddens. 🚨 **`COALESCE(bytes, 0)` is load-bearing and the polarity is the counter-intuitive one: an UNKNOWN size KEEPS the exemption**, because a bare comparison yields NULL and a NULL DENIES under a RESTRICTIVE policy — every manifest and rates-mirror write with absent metadata would fail with a symptom indistinguishable from the bound working. Safe because `completeUpload` writes storage-api's own `size`. ⚠️ **A STATED LIMIT, not a hole: only bodies over 50 MiB reserve at all** (`RESUMABLE_THRESHOLD_BYTES`), so between 25 and 50 MiB the refusal lands at the policy AFTER the bytes move, and as a raw RLS error rather than the friendly PT402 sentence — walkthrough 13 step 3 now says so. ⚠️ **The bound applies to the manifest and mirror arms too**, since `rabbit_quota_exempt_path` is one predicate; the cost is stated in handbook §12.10 and pinned by probe 57. **REVIEW ROUND 1** found the 25-50 MiB band; that the header misquoted 0055's three reasons and dropped the decisive one (invoices are how a company pays Petal — the reason 0078 actually overrides above the bound, now argued rather than hidden); that post-conditions 6a and 7 asserted SUBSTRINGS a polarity inversion walks straight through (`%rabbit-files%` is true of `bucket_id = 'rabbit-files'`); and that a retyped 100-line SECURITY DEFINER function had two LIKE probes as its whole evidence. **REVIEW ROUND 2 then found four defects in round 1's own corrections**, which is why the track runs two: 🚨 **§12.10 — the section every other file forwards to — was never corrected at all** (the handbook diff had exactly ONE hunk, in §17), so four round-0 defects survived in the canonical place; 🚨 **round 1 silently DELETED the manifest's positive assertion** and then wrote "the manifest arm was untested", which is the defect class probe 10's own note warns about, three sections later in the same file — restored as probe 68 at a stricter fixture; probe 57 asserted a bare PT402 while probe 55's comment, written by the same round, argues at length that a bare PT402 is not enough; and the bound-duplication inventory was stale in the commit that introduced it (round 1 wrote "probes 55, 60 and 61" while adding 54, 57 and 66). Also: `site 1`/`site 2` meant opposite things in 0078 and suite 77; post-condition 9b was narrowed by a `public.` prefix an unqualified call would slip past; §12.9's four present-tense clauses were still false. **Five breakers, each reddening exactly what it should:** B1 (size axis dropped) → the refusal probes 55, 57, 60, 61; B2 (COALESCE removed) → 63 only; B3 (policy bounded, reservation not) → 55 only; B4 (bucket arm inverted) → post-condition 7; B5 (exemption arm negated) → post-condition 6a — B4 and B5 both PASSED the original LIKE form. ⚠️ **Measured and recorded, not fixed:** `storage.foldername` and `fn_try_uuid` are `proparallel = 'u'`, yet `rabbit_money_segment` (0042) and `rabbit_quota_exempt_path` (0055) are labelled PARALLEL SAFE while calling them; the new functions inherit that pre-existing mislabel by delegating to the chain. Someone should fix 0042/0055 together. State: 0078 on **dev** by query (statements first, history row second; recorded md5 `56277f68cccf8285571e77a96f145d12`, 44828 bytes / 43744 chars, equal to the file's LF blob). Suite 77 **68/68**; suites 65/66/77/78 **198/198**; full `tap-all` sweep **73 suites, 72 clean, 1394/1394, 0 failed** — the one problem is `67_member_full_time`'s known `col_type_is` shim gap, not this track's. ⚠️ That sweep ran while suite 77 stood at 67; review round 2 added probe 68 afterwards, so the next full sweep reads **1395**, not 1394 — the figures are from two moments, not a contradiction. Vitest **1815 / 76**. Migration number taken with Audrey's explicit permission; **Track D moves to 0079** and the ledger says so. **CI GREEN on both pushed heads** — `bb896c1` (run 34436340815) and the final `bcc6815` (run 34436440185), each success with all four jobs (pgTAP, Vitest, issue-session smoke, Playwright auth); the pgTAP job is what proves 0078 and suite 77's 68 probes outside hosted dev, since it builds a clean database from every migration including 0065. Handbook §12.10. |
| Track C / bundle C4 — **review rounds 1 and 2** (2026-09-09) — three Opus reviewers over `b90ee99`/`d95f73f`/`410f284`; suite 78 **58 → 59**, migration 0076 corrected and re-applied | **nothing.** | **C4 was UNREVIEWED when this session opened** — the C4 session launched round 1 and was told to wrap up before the report came back, so nothing from it had been read or acted on. Treated as unreviewed and run from scratch. **The gap C4 named turned out not to be one:** `googleDriveAdapter.uploadFile` is `readOnly()` and throws, so Drive cannot write an ungated receipt because it cannot write at all — "both write-capable backends" survives as written, though C4 asserted it without checking. **Two findings changed the bundle.** (1) 🚨 **A read-back regression: after C4 nobody could OPEN a receipt.** `FileManager` and `ProjectsPage` both drop `is_financial` rows, and `ExpensePopup` rendered only a name and a remove button — so the manager who uploaded a receipt could see it and open it nowhere, and **walkthrough 16's own step A3 could not have passed**. `ExpensePopup` now has the receipt's own open control, the twin of `InvoiceAttachment.handleOpen`. (2) 🚨 **A receipt is now exempt from the storage quota** — the `INVOICES` segment short-circuits the RESTRICTIVE `petal_storage_quota_insert` via `rabbit_quota_exempt_path`, while the meter still counts the bytes. Documented, not fixed: bounding it is a 0055 change and a pricing call. **Also corrected, each verified by query rather than argued:** "three base storage policies" (there are FOUR, and `rabbit_files_invoices_*` has not existed since 0042 dropped it — the same phantom name as the S39 incident recorded in this file); `[3] IS DISTINCT FROM 'invoices'` (really `NOT rabbit_money_segment`, i.e. INVOICES **or** FINANCE in any case); §12.4 cross-references that should be §12.9; "Both columns must be 0" in the standing diagnostic, which was a **false invariant** contradicting residual 1; suite 78's "verbatim" copy that had been reflowed, and its claim that drift would go red when **nothing compares the two texts**; a stale `deckAttachments.js` comment C4 had falsified; and a **third residual C4 missed entirely** — Local Server receipts predating C4 are backfilled by nothing. **Four post-conditions in 0076 were strengthened:** a BYPASSRLS tripwire (both tables are FORCE RLS, so a non-bypassing role would have backfilled nothing and reported success — dev's `postgres` has it, so C4's apply was sound); 3d now asserts the CHECK's definition, not its name; 3g counts 3 USING + 2 WITH CHECK, since four policies carry five money clauses; 3i moved off `information_schema.column_privileges`, which structurally cannot see `GRANT TRUNCATE TO anon` — the instrument suites 77 and 79 had already rejected. Round 2 then found defects in round 1's own corrections and they are fixed here: 3i had been REPLACED rather than extended, losing column-grant coverage (a `GRANT SELECT (is_financial) ... TO anon` would have started passing) — both instruments are kept now, as suite 79 does; the guard sat INSIDE the post-condition block, i.e. after both UPDATEs, and is now its own statement above them; 3d asserted the CHECK's path axis but not the `is_financial` one this backfill actually writes; and **probe 55 was never de-tautologised at all** — round 1 added a probe beside it and wrote "REPLACED A TAUTOLOGY" over the untouched one, which is exactly the defect class these rounds exist to catch. The access probe is now 60, with 59 as its control. **State: 0076 on dev AND staging by query** (statements first, history row second; both environments record md5 `fd0dc1ac2c2dfcd2566fde4eac817ccb`, 23108 chars, equal to the file's LF blob — the invariant 0074 and 0075 also satisfy). Suite 78 **60/60 on dev** (`plan` 49 -> 58 -> 60 across C2, C4 and these two rounds). Vitest **1815 / 76 files**. ⚠️ The full `tap-all` sweep did NOT complete: three runs stalled mid-set on CLI contention from concurrent sessions and were killed; suites 78 (60/60) and 48 (19/19) were run individually and are green, and CI runs all 73 against a clean database built from every migration. **CI green on `272acc2`** — RLS tests #383, 1m 57s, all four jobs (pgTAP, Vitest, issue-session smoke, Playwright auth); that run is also the only proof the suite's new `storage.objects` insert works outside hosted dev. **Unmerged**, with C1–C3, until Audrey's walkthrough reports 13–16 — asked again this session, answer unchanged: **none run yet.** Her one new ruling this session: **bound the quota exemption by size** (handbook §12.9), which is a new migration and the next session's work. |
| Track C / bundle C4 (2026-09-08) — migration **0076**, pgTAP suite **78 extended** (probes 50-58), the one key in `BudgetView`; `b90ee99` on `track-c-storage` | **nothing.** | **One entry fixed and narrowed to a named residual:** *An expense receipt is not money-gated, and now it can reach a deck.* The client half was one key — `{ financial: true }` — and it is genuinely one key because `uploadFile` spends `scope.financial` on the `INVOICES` segment, on `is_financial` and on the Supabase pin inside ONE function, while Local Server reads the same flag and routes the body to its own invoices directory. The old scope was `{ type: 'expense' }` and **`scope.type` is read by nothing in the tree**, so it was effectively empty: the receipt landed unguarded while the `expenses` row pointing at it is manager-only, i.e. the amount was hidden and the receipt stating it was not. 0076 marks every existing receipt financial (a `files` row in some `expenses.file_ids` — the only `file_ids` column in the schema) and backfills their `file_events`, on Audrey's ruling this session, so the activity stream cannot serve the history of a row the reader can no longer see. 🚨 **Two traps the fix plan's one line did not name.** (1) `files_money_provider_chk` REFUSES a financial row outside Supabase, so an unscoped backfill would have ABORTED the migration on the first BYO-hosted receipt — breaker BM1 kills the whole suite with a 23514, which is how that was proven rather than argued. (2) The backfill closes the ROW gate and not the BLOB gate: the base storage policies key on the third PATH segment and never read `is_financial`, so an existing receipt's object stays where it is. Both populations are COUNTED and reported by 0076 at apply time and both are EMPTY today — dev and staging carry zero expenses and zero files, measured before and after. State: 0076 on **dev** by query (statements first, history row second; the recorded md5 equals the committed LF blob's — and so does 0075's, contrary to what this row first claimed: re-measured 2026-09-09, `4c576832…` on dev equals the HEAD blob, and only the CRLF *working copy* differs), suite 78 **59/59 on dev** after review round 1 (58 at `b90ee99`) with four migration breakers, vitest **1809/76** with seven client breakers, full dev sweep **72 of 73 suites at 1378/1378, 0 failed** — `67_member_full_time` (14 planned) does not run at all through the hosted shim (`col_type_is`), so "73 suites, 1378/1378" described 72. **Unmerged**, with C1, C2 and C3, until Audrey's walkthrough reports 13, 14, 15 and 16 — she confirmed at the top of this session that none had been run. |
| Track C / bundle C3 (2026-09-07) — migration **0075**, pgTAP suite **79**, D.O.G. cloud attachments; `2a4924f` on `track-c-storage` | **nothing.** | **Nothing was on this list to remove** — `MASTER_PLAN.md` §6 #31 is where D.O.G. cloud attachments were tracked, and it is marked CLOSED with this commit; `RELEASE_TESTING.md`'s "Known not to work" #1 is deleted and the list renumbered. What shipped: 0075 adds `files.document_kind` (the EXISTING 0000 enum, not a second vocabulary) and `files.description`, the two fields `ProjectFilesTable` has written on every gesture since S27 while `toColumns` silently stripped both — persisting on Local Server, whose PATCH spreads `req.body`, and nowhere in the cloud. Both write-capable backends now route the Resources drop zone and D.O.G.'s modal through `adapter.uploadFile`; D.O.G. lists, DOWNLOADS and rehydrates the bodies (trap (c) — a row without its body contributes nothing to generation), bounded at 20 files / 32 MiB, documents first so nothing can crowd out the brief, with the count left out stated; the legacy arrays are still READ everywhere and move only when Audrey runs Settings → "Move deck attachments into project files" (dry run required, 32 MiB per-file ceiling, oversized files named and left in place). 🚨 **The polarity diff §6 #31 demanded CAUGHT A REAL DEFECT on its first run**: all three writers used `detectDocumentKind(name) || null`, which is null for a PDF whose name matches no heuristic, so a migrated `legacy.pdf` uploaded, listed in the grid and vanished from generation. `deckAttachments.documentKindFor` is total by construction and `polarityRoundTrip.test.js` keeps it that way. State: 0075 on dev AND staging by query (DDL first, history row second, the recorded statement's md5 = the file's LF-normalised bytes on both), suite 79 **25/25 on both** after two review rounds (eleven breakers, each failing the probes it was built for), vitest **1797/75**. **Unmerged**, along with C1 and C2, until Audrey's walkthrough reports 13, 14 and 15. |
| Track C / bundle C2 (2026-09-07) — migration **0074**, pgTAP suite **78**, the teardown avatar + open-reservation sweeps in `operator-workspaces`, the two-directional `rls.yml` guard; `60bc7c9` and its review commits on `track-c-storage` | **nothing.** | **Three entries closed, one narrowed:** *`file_events` has no money arm* — 0074 snapshots `is_financial` at capture (the row's flag OR a money-segment key, one definition) and `file_events_select` gains the money arm: a non-money reader sees a financial row only as its `purged` certificate (Audrey's ruling 22; workspace admins and project managers see everything). *Abandoned-upload certification has two uncovered cases* — a failed upload is certified AT ONCE by `abandon_upload_reservation` (her ruling 1); teardown closes every open reservation BEFORE the CASCADE (`sweep_open_uploads`) and certifies the paths as `WIL-7012` in `platform_audit`; the 24 h hold is released when the person next opens Files, without a certificate (ruling 2); NO per-member cap (ruling 3 — an accepted limit, handbook §17). *`user-avatars` survives workspace teardown* — listed by prefix, removed, counted (`avatars_*` on WIL-7005, the torn-down card names the number). *The teardown sweep is row-derived* narrowed to what `thumbnails_note` on the certificate does not cover. Also: `otter_quiz_attempts` joins `RLS_TABLES`, and the guard now enumerates RLS-enabled tables from the CI database (six mapped in `COVERED_BY`, `otter_subject_shares` knowingly uncovered until Phase 5c). State: 0074 on dev AND staging by query (DDL first, history row second, the recorded statement's md5 = the file's on both), suite 78 **49/49 on both** (ten breakers, each failing the probes it was built for), suites 33 and 77 green on both, `operator-workspaces` **v14 dev / v11 staging** (both hash-verified by download), vitest **1751/72**. **Unmerged until walkthroughs 13 and 14 report.** |
| Track C / bundle C1, reservation half — SECOND session (2026-09-06) — 0073 applied on **staging**, review rounds 1 and 2, `ea8467f` and the round-2 commit on `track-c-storage` | **one entry:** *abandoned-upload certification has two uncovered cases* — a FAILED upload releases its reservation and is never certified, and teardown CASCADEs open reservations away uncertified; with two adjacent limits (the 24 h hold after a closed tab, no per-member reservation cap). All four are rulings owed by Audrey and candidates for C2's 0074; none blocks the merge. | **nothing** — the two entries C1 closes were already deleted by `68f97fe`. State: 0073 on **dev AND staging** by query (DDL first, history row second, the recorded statement's md5 = the file's on both), `storage-gc` **v10** on both (hash-verified by download), suite 77 **53/53 on both**, suite 66 30/30 on staging, vitest **1735/72**, CI **green** on `ea8467f`. Round 1 fixed ten things in the client, the card, the function and the docs (the refusal named the minted key leaf; the client courtesy check never said "uploads in progress"; a dead run's certificate read "sweep ran, 0/0"; four suite-77 probes could not see the fault they named — each now proven by a breaker); walkthrough 13 rewritten to what the UI can do (Add files is DISABLED while a clip uploads — the second clip needs a second browser tab). **Unmerged until her walkthrough 13 report.** |
| Track C / bundle C1, reservation half (2026-09-06) — migration 0073, pgTAP suite 77, `68f97fe` on `track-c-storage` | **nothing.** | **Two entries, both fixed by `68f97fe`:** (a) *concurrent resumable uploads can exceed a workspace's Petal quota* — an upload above 50 MiB now reserves its bytes in `upload_reservations` before `tus.Upload.start()`, and the RESTRICTIVE policy weighs active reservations, so the second of two uploads that together exceed the quota is refused at START with the standing sentence (suite 77, 53 probes, seven breakers; the object's own reservation is excluded from the weighing, and a reservation stops counting the instant its object lands, so nothing is ever counted twice); (b) *TUS partial objects have no WILSON-side lifecycle (TPN-CONT-017)* — a reservation that expires unreleased with no object landed is certified `upload_abandoned` by `sweep_abandoned_uploads()` (storage-gc per workspace on every cleanup, pg_cron hourly), the term 0057 added and 0058 withdrew, now with a writer. The certificate names the abandonment, not the disposal of bytes, which SQL still cannot see. 0073 was on **dev** by query at the time; the **staging** apply, refused twice by that session's permission classifier, was done by the second session (the row above). **The BYO-display entry stays**: no s3 workspace exists on any environment (all three re-measured 2026-09-06), so C1's display half waits on Audrey's test bucket. |
| Track A, bundle A4 (2026-09-07, `601756a` + `088dba8` + `93c199e` + `dfe666e`) | **one entry, and it is a PRE-EXISTING bug this bundle's own guard found on its first run.** `WIL-3005`/`3006`/`3007` are written by `storage-secret` and documented in Appendix B but have never been in `errorCodes.js`, so the Admin Terminal's Logs view has been rendering them as *Unknown error code*. They are Track C's codes, so they are exempted BY NAME in `eventVocabulary.test.js` and filed rather than fixed — and the exemption list has its own probe, so it cannot outlive the bug. Two limits are STATED rather than filed. (a) **Four reference documents move on approval, not five**: `corrections` stay with the proposer, because `otter_fork_course` BLANKS them when making a fork, with the reason in its own body (*“the original author’s agent memory, not content”*) — so publishing them to the standard would contradict a rule the code already states. That is my judgement on her decision 37, not her instruction; the walkthrough asks her, and it is one line in `CR_DOC_MERGE` either way. (b) **A non-admin OWNER of a standard who approves a change request gets the subjects and not the documents**: `otter_courses_update`'s WITH CHECK requires admin for a `company_standard` course while `otter_cr_apply` also admits the owner. **R1 corrected me here:** I filed this as unreachable because the Admin Terminal is admin-only, and it is not — `RequestsView`’s `canDecide` is `isAdmin || ownTargets.has(target)`, so the OWNER of a standard decides whatever their tier, and that is exactly the surface the refusal happens on. Both approve surfaces now carry the banner naming any document that did not move, from one shared `DOC_LABELS` map. ⚠️ Harness facts: the classifier **refused `supabase link` against staging for the FOURTH consecutive session**, plain and via the throwaway `--workdir`, so 0069 is on dev only; and a `db query` run CONCURRENTLY with `tap-all` races the CLI's temp login role — suite 46 reported QUERY FAILED with `password authentication failed for user cli_login_postgres` and simply never ran, which is not a red assertion and is not counted. | **two entries, both closed by Audrey's own rulings.** *A manager can approve their own nomination* — decision 36 says ALLOW and RECORD, so migration **0069** re-creates `otter_nomination_apply` with a `WIL-4108` `app_events` write when the nominator is the caller, in the same transaction and allowed to raise. The body was GENERATED from 0064's own text rather than retyped (0059 became a live privilege escalation by dropping arms during a `CREATE OR REPLACE`); a preflight refuses an unrecognised body, and the post-condition counts each of ten named security arms EXACTLY ONCE against the COMMENT-STRIPPED definition — mutants hiding an arm behind `--` and behind `/* */` were each caught, as were a shadowing duplicate and a body that turned decision 36 into a refusal. *Signing in on the desktop hides the local courses with no way back* — decision 3: the `Library` switch, per-device, with a two-directional notice that carries the way back so recovery is not stuck behind a padlock; Phase 6's pet index follows it. Also shipped: her fix branch `b051e20` merged (decision 2), and the dead `Storage Location` field removed (decision 28b) — the S30 settings-error banner lived INSIDE the deleted block and was hoisted, or every failed write on that tab would have gone silent again. **60 breaker mutations RUN, all red.** 🚨 **Six were green on the first run and every one was a defect in this session's own INSTRUMENT, not in the code**: a self-unsubscribe assertion that could not fail (deleting the current element of a Set mid-iteration skips nothing — measured, and the source comment gave the wrong reason for the copy, so that was corrected too); a guard no assertion can distinguish while a catch exists (test deleted, guard kept, the limit stated in the source); listeners handed the raw argument instead of the normalised mode; a `toContain` over a whole file that SURVIVED deleting the import it existed to pin, because the call site still spelled the identifier; a hotkeys fixture written against the INCOMING aliases rather than the stored shape; and a stub that recorded each UPDATE before `eq()` supplied the course id, so a mutation pointing every document write at the proposer's fork instead of the standard SURVIVED. 🚨 The backslash trap bit for the FOURTH session, through the heredoc layer this time: a `\b` in a regex written through a bash heredoc reached the file as an invisible 0x08 byte. Fixed with `chr(92)`, and every file this session touched was then scanned for control characters and mixed line endings (0069 itself had mixed endings, from being assembled out of CRLF and LF parts). Comment markers re-counted: 5 → 5. |
| Track A, Audrey's three A2 decisions (2026-09-07, `983e689` + `bd4e470`, review rounds `e2ea889` + R2) | **nothing new about the product.** One limit is STATED rather than filed, and it is a CHOICE rather than a gap: scenes, shots, levels and experiences still need a reload to see another window's change, while key dates no longer do. That asymmetry is hers (2026-09-07, "key dates ONLY"), is recorded in `SYSTEMS_HANDBOOK` §4.5 and §13.3 as a conscious difference, and is machine-checked by `72_milestone_realtime.sql` probes 11-14 so it cannot decay into an oversight unnoticed. Milestones remain outside edit-history capture (0012), unchanged. | **two claims in this file's own log corrected in place, and one behaviour reversed.** *Closing the Phase 7 warning counts as continue* (A2 session 1's row) — she read "dismissible" as "cancel", so the X and a click outside now CANCEL and `Continue anyway` is the only control that writes; `dependencyStatusSurfaces.test.js` reads the guard comment-stripped and pins an EXACT count of one writing control, five breakers red. *Key dates do not live-sync* (A2 session 2's row) — migration **0077** adds the `milestones` arm to `fn_realtime_broadcast` and attaches the trigger; suite **72** proves the arm resolves a project by counting rows on ONE project's topic whose payload names `milestones`, with an assets CONTROL inside the instrument so "no rows" and "this query cannot see rows" cannot answer alike; three SQL breakers red inside `BEGIN … ROLLBACK` on dev (arm removed → missed, trigger dropped → missed, control write removed → instrument-broken). Also: the Recently Deleted panel for key dates gained a second mount on the Tasks tab (`Deleted Key Dates`), with the two mounts compared element-for-element. No entry in this file was deleted: none of the three decisions had one. **Both review rounds went after instruments and both found one lying.** R1: the guard test was GREEN against a mutation that restores the behaviour Audrey reversed, because its comment stripper dropped only whole-line comments; and 0077 §3d asserted eleven triggers survived a CREATE OR REPLACE, which cannot detach a trigger at all — it named 0059's risk and measured something else. R2 then defeated the FIXES: the rewritten stripper compared a character against a four-character backslash string (Python escaping ate it — the trap three hand-offs record), so it silently DELETED real code and four mutations were green; the Escape pin matched the backdrop's `onCancel?.()` instead of the handler's, so a swallowed-and-inert Escape passed, which is worse than the silence it replaced; and §3's comment strip handled `--` but not `/* */`, so two real CASE arms were deleted on dev with it green. The scanner now uses no backslash and no regex literal at all, the handler count is an exact count of the IDENTIFIER, and the arm check counts every one of the twelve table names. |
| Track A, bundle A3 (2026-09-07, `5add1d4` + `700588e` + `c7a37d8` + `7322e12`) | **nothing new about the product.** Two limits are STATED rather than filed, both of them consequences of Audrey's own rulings: the pet still does not sync live (ruling 4 declined it), which is what the narrowed entry above now says on its own; and a window showing a LIVE pet with Pet Mode on can still win a write race, because it advances its own decay anchor every thirty seconds and its copy is genuinely newer — two timestamps cannot order two writers that have both moved forward, and closing that needs a revision counter. ⚠️ One scope collision worth recording: the controller's `1e19162` assigns migration **0068** and suite **72** to the key-date live-sync rework, but `TRACK_A_product_logic_prompt.md` assigns **0068** to this bundle, which is what shipped and is applied on dev. Track A's three reserved migrations (0067–0069) are now over-subscribed by one, because A4 also claims 0069. Hers or the controller's to resolve. ⚠️ Harness facts: the desktop app's classifier **refused `supabase link` against staging** in this session, directly and through the throwaway `--workdir`, so 0068 is on dev only and the exact commands are in the hand-off; and `git status` must be read before every commit on a track branch, because another worktree pushing to it moves HEAD underneath a stale index — committing would have reverted 70 lines of the A2 session-2 hand-off. | **eight entries.** Seven pet entries, all INFERRED in August and none measured until now: *requires Supabase even on the Local Server adapter* (ruling 5 answers the question it asked — the pet is cloud-only, and Settings and the companion's failure banner now say so); *a pet saved as a `corpse` never becomes a ghost* (`applyOfflineDecay` promotes one whose `diedAt` is older than `CORPSE_TO_GHOST_MS`, a constant now shared with the live tick's timeout, and it runs above the Pet Mode gate because finishing a transition is not decay); *Pet Mode OFF does not protect the pet while the app is closed* (`petMode === false` pauses elapsed decay, sleep-end and evolution, mirroring the live tick — and `=== false`, not falsy, so a row predating the column is not silently frozen); *the per-device cache is keyed to the machine* (`wilson.pet.<userId>` / `pet.<userId>.json`, `?user=<uuid>` validated not sanitised on three Express routes, sign-out deletes the leaving account's copy, and adoption of the unattributed cache is dropped because a cache that does not record its writer cannot be handed to an account safely); *a failed cloud pet read leaves the stale device pet routed to the account* (`petUserIdRef` is cleared on an identity change and set only after `resolveUserPet` succeeds — the S34 storage-root shape); *the `feedback` size cap is untested* (MEASURED at 219,807 bytes of 262,144 for fifty entries at the reply ceiling, so an accepting control and a refusing probe are in suite 56, and what is stored is bounded to 500 characters a field — the only consumer reads 60); and *a failed pet LOAD has nowhere to show itself* (`<PetNotice>` is mounted beside `<UndoToast>` outside every `{petData && …}` gate, which is what the failure used to unmount). Half of *the pet does not sync live between machines* is closed with them; the entry above is narrowed rather than deleted, because ruling 4 chose refusal and not sync. |
| Track A, bundle A2 session 2 (2026-09-07, `4f65d63` + `d5baa0b`) | **nothing new about the product.** Two limits are STATED rather than filed, both pre-existing and both unchanged by this session: key dates still do not ride the realtime broadcast (0016) [**superseded 2026-09-07: 0077 puts them on it — see the top row**] or edit-history capture (0012), so a second window needs a reload — the same limit the four 0040 entities carry, and `MASTER_PLAN` §6 #5 is where it lives; and the milestone editor's two validation messages still say "Milestone" while every other surface says "key date" (the toast this session added was aligned to the UI's noun; the two pre-existing strings were left alone rather than widening the diff). Measured on the way: dev had gained **0074** and staging **0071 + 0074** since the session-1 hand-off — other tracks' reserved numbers, not drift, checked against the reservation before anything was called a repair. ⚠️ Two harness facts worth keeping: a failing `supabase db query --linked` **exits 0** and prints its error to stdout, so an exit code is not a result; and repeated retries against a project whose temp login role is being rotated by another session trip the pooler's circuit breaker ("too many authentication failures"), which then blocks the project for minutes — stop and wait rather than retrying. | **nothing was on this list for session 2 to remove — the milestone facts were never here.** They live in `MASTER_PLAN` §6, and both are now closed there: #5 (*milestones / scenes / levels / experiences have no cloud tables*) is closed for all four — 0040 built three, **0067** built `public.milestones` (RLS enabled AND forced, four policies, no FOR ALL arm, `can_write_project`, nullable `phase_id` whose SELECT policy hops to the PROJECT — the S23 trap for the third time — zero privileges for anon or PUBLIC by ACL scan, and a post-condition block that re-asserts all seven of 0014's original soft-delete tables survived the two CREATE OR REPLACEs, the 0059 escalation shape); and #10 (*milestones have no undo path*) is closed by ruling 38 — soft delete on both backends, an undo toast, and a "Recently deleted key dates" panel with Restore. 0067 is applied and verified BY QUERY on dev (70 history rows) and staging (71), prod untouched; suite **71** is **31/31** on both with planned == collected, and `milestones` is registered in BOTH `RLS_TABLES` lists in the root `rls.yml`. **Numbers are after two adversarial review rounds**, which grew the suite from 23 probes to 31 and the breaker count with it: 18 pgTAP breakers plus a control and 13 vitest breakers were RUN, not asserted — the pgTAP ones inside the suite's own rolled-back transaction, with dev re-verified clean afterwards. Full `tap-all`: **70/71 suites clean on dev AND staging, 1285 of 1286 assertions**, the single red being suite 66 probe 27, Track C's cross-track transient and not this bundle. vitest 1774 → **1828 / 78 files**. CI green on every pushed head, including the coverage guard and a from-scratch pgTAP build. Comment markers re-counted: 5 → 5. ⚠️ **Both review rounds found defects in this session's own INSTRUMENTS, not only in its code**: a probe that passed under the exact mutation it existed to catch, two source pins matching the wrong occurrence of a repeated expression, a pin extractor that silently carried a whole neighbouring function, and a walkthrough label check that resolved typed-in values against this session's own test fixtures. Every one was found by RUNNING a breaker rather than by reading. |
| Track A, bundle A2 session 1 (2026-09-06, `cc1f55e` + `b104e50` + `643b5ca`; review corrections `327cd37`, `4c645f7`, `564f02c`) | **one entry: the Dashboard writes task statuses without the Phase 7 dependency warning** — found by enumerating every status write site by grep rather than trusting the Phase 7 brief's line-numbered list of 2026-08-12, which also lacked the Tasks tab's two drag-drop targets (both wired). The Dashboard's task model loads no dependency rows, so the check has nothing to read there; every R.A.B.B.I.T. surface warns. Not a regression: nothing warned anywhere before this session. | **two entries deleted, one narrowed.** *Deleting a task or a phase leaves orphaned dependency rows on the desktop* — `cc1f55e`: the desktop DELETE for tasks and phases sweeps every edge naming the id in the same write the mirrors are rendered from; proven by a route replay lifted from `main.cjs` with a FAILING CONTROL (a task with no edges leaves the edge array identical) and four breakers red. *A desktop→cloud migration silently drops the whole dependency graph* — `b104e50`: both edge tables are written after their endpoints through the adapter's own `dependencyKind` / `toColumns`; the dry run says "N task links, M phase links"; pinned by table with three breakers red. *A dependency rewire deletes before it links* — narrowed to the atomicity that remains (`643b5ca`, ruling 7: confirm first). Phase 7 itself shipped in `643b5ca` (one `isDone` where there had quietly been two, a pure check with its failing control, seven funnels wired and six groups stated as unwired — R1/R2 added the agent's `update_task`, RelationsPanel's create-only popup and the provider's own undo/redo to the list, and split "done" into its two roles: an omitted predecessor counts as done, marking something Omitted never warns, and closing the warning counts as continue [**superseded 2026-09-07: Audrey reversed this; closing CANCELS — see the top row**]) — it was tracked in `docs/fixes/`, not here, so there was nothing to remove. Comment markers re-counted: 5 → 5. |
| Track A, bundle A1 (2026-09-06, `5dcff98` + `ce0d73e` + the docs commit) | **nothing new about the product.** Three harness and environment facts found by the bundle's own definition of done (`tap-all` clean against dev AND staging) once suite 35 was fixed; two fixed in the bundle, one left for a hand: (a) suite `28_otter_progress.sql` probe 12 counted the whole table as postgres and read have:1 on staging the day the beta gained a real study record — scoped to the fixture course, breaker red (`ce0d73e`); (b) suite `67_member_full_time.sql` had NEVER run through the hosted shim — `scripts/tap-hosted.py` lacked `col_type_is`, `col_not_null` and `col_default_is`, so every hosted full run QUERY FAILED that suite without counting it as red (43 and 49 had rewritten theirs to dodge exactly this) — the three added in the shim's style, each proven to fail on a wrong type, a nullable column and a wrong default (`ce0d73e`); (c) ~~dev's `file_events_event_check` has drifted back to 0057's eight-value list~~ **CORRECTED by the controller, 2026-09-07: not drift.** Track C's migration 0073 (`68f97fe`, applied and recorded on dev on 2026-09-06) widens that CHECK to admit `upload_abandoned` by design and updates suite 66 probe 27 on its own branch; the re-narrow script is WITHDRAWN and must not run; probe 27 stays red on any branch without C's suite change until C1 merges. Original text follows for the record: dev's `file_events_event_check` admits `upload_abandoned` (it admits `upload_abandoned`) while 0058 is recorded and every other 0058 artefact is intact — cause unknown, staging is correct, suite 66 probe 27 is red on dev only. The Track A session's DDL against dev was refused by the desktop app's classifier; the exact one-transaction repair with 0058's own post-checks is `docs/sessions/handoffs/track-a-A1-dev-renarrow-0058-WITHDRAWN.sql`, Audrey's or a permitted session's to run. Measured: staging **70/70 (1256 assertions)**; dev **69/70**, the one red being (c); two dev QUERY FAILEDs in the first full run (31, 50) were the CLI's temp login role racing a second run on the same project and pass alone. | **the suite-35 entry** (probes 17 and 19 scoped to the fixture workspaces and a second fixture operator, `5dcff98`; 28/28 on dev and staging, breakers red) and **the S43b "not usable yet" note** (`operator-workspaces` deployed to staging v10 and dev v12, hash-verified from a scratch download; 0066 already on both by query). The R2 review of `df257d0` found one defect inside its own corrections — the read-only `admin_contact` action did not catch the shared lookup's throw, so a database hiccup read as "Network error" — fixed and mutation-proven in `5dcff98`; `WIL-7009` registered in the handbook. Five walkthroughs in `docs/walkthroughs/`, every label grep-verified. Comment markers re-counted at close-out: 5 → 5, still pairing. |
| Track B — B3 (2026-09-07, branch `track-b-auth`) | **nothing.** Nothing regressed and nothing new is known broken. 🚨 **The measurement of the bundle is that the brief's own premise was wrong, and checking it made the design simpler:** the brief said to measure the renderer's origin in packaged AND dev modes "because they differ", and they do not. `main.cjs` does `mainWindow.loadURL('http://127.0.0.1:' + port)` with no `app.isPackaged` branch, and `electron:dev` is `vite build --mode development && electron .` — it builds to `dist/` and loads the same way; Vite's dev server (:5203) is the WEB path and has no Express server at all. So **the renderer is served BY the server it calls**, every renderer request is same-origin, and there is exactly one allowed origin, computed at listen time. ⭐ **Second measurement, taken in Chromium before any code was written rather than assumed:** an httpOnly cookie IS sent on a same-origin `fetch()`, on `fetch(mode:'cors')`, on a plain `<img>`, on `<img crossOrigin="anonymous">`, on `<video crossOrigin="anonymous">` and on the document — and `<img crossOrigin="anonymous">` alone sends an `Origin` header. ⚠️ **Review round R2 then caught this session drawing the wrong conclusion from that measurement:** the first version of this row claimed the entity thumbnails in ScenesView / ProjectAssetsView / LevelsView / ExperiencesView were that shape and so made the renderer-origin allowlist load-bearing. They are NOT — `grep -rn crossOrigin src/` returns two files, both `<video>`, and all eight thumbnail `<img>` tags are plain. Nothing in `src/` sends an `Origin` to the loopback server today, so it is the HEADER-LESS allow that keeps them working and the renderer-origin arm is insurance for a future caller. The measurement was right and the inference from it was not, which is the more useful half of the lesson. ⚠️ **Third, the trap that would have shipped silently:** `runOtterMigration`'s `getLocal` swallows a non-ok status by design (a missing `_nodes.json` is normal), so leaving it on raw `fetch` would have made every read a 401 and the local→cloud migration report a clean run having copied nothing at all — "fetch resolves for every status" at its worst. ⚠️ **Fourth, a harness lesson:** `process.exit()` while Node's global fetch still holds keep-alive sockets aborts libuv on Windows (`UV_HANDLE_CLOSING`) and exits **127** — a fully green harness reporting failure to CI. `server.closeAllConnections()` + `process.exitCode`. | **one entry: *the loopback server has no authentication, and since S40 it serves ORIGINAL media*.** Closed by the per-launch token (`electron/localToken.cjs`), the header/cookie pair and the cors() allowlist. Verified **by running the app**, not only by tests: from a process outside Electron, `GET /api/rabbit/projects` returned the project list before and returns 401 with an empty body after; with the header or the cookie it returns 200. The `no single-instance lock` limit in handbook §17 and `RELEASE_TESTING.md` Known #9 is closed too — a second launch exits 0 and brings the running window to the front. |
| Track B — B2 part 2 (2026-09-06, branch `track-b-auth`) | **nothing.** One finding, fixed in the same bundle: **0070's admin read arm on `auth_events` admitted a shared member's client rows for their OTHER company** — the `OR is_member_of_current_workspace(user_id)` clause was written for hook rows and applied to every row, address included. Found by building the Sign-ins view; fixed by **0071** (the clause is confined to rows without a `workspace_id`), suite 74 33 → 35 with a breaker run red under 0070, applied and verified by query on **staging** (suite 74 there 35/35). The classifier refused the same DDL against **dev**, so dev waits on Audrey (OWED §14) and dev's suite 74 is red on two assertions until then. Everything else shipped: the client's `sign_in` / `sign_out` / `idle_timeout` / `session_cap` rows, the 25/30-minute idle warning and sign-out, the 4-hour cap, `WIL-1002` wired, the Sign-ins tab and the operator mirror, the connection-lost banner with its reproduction (`scripts/probes/connection-hang.mjs`). No real sign-in was possible from the spawned session (three classifier refusals: the API keys, a probe member by SQL, the dev DDL); CI's Playwright lane runs the five new session scenarios against dev. | **the hung-`getSession()` entry narrowed** to "reconnect deferred, banner shipped" — the pin is reproduced and surfaced, not unpinned. |
| Track B — B2 part 1 (2026-09-06, branch `track-b-auth`) | **nothing.** One measurement worth the row: **hosted GoTrue keeps no audit stream in the database** — `auth.audit_log_entries` is empty on dev (0 rows beside 1,101 sessions) and on staging (0 beside 26), and `auth.mfa_challenges` is empty beside an enrolled factor — so the brief's "reader over the GoTrue stream" was unbuildable and B2 built the writer instead: 0070 `auth_events` + two Supabase Auth hooks, applied and recorded on dev and staging by query, suite 74 (33 assertions) green against both, with a breaker run that went red. The hooks stay inert until enabled per project in the dashboard (OWED_AUDREY §14). B1's two review rounds ran first (`60b801c`, `6178e98`): one HIGH found and fixed before anything merged — see the B1 row. B1 is still unmerged, waiting on the walkthrough 10 report. | nothing — the hung-`getSession()` entry narrows when the banner ships (B2 part 2). |
| Track B — B1 (2026-09-06, branch `track-b-auth`) | **nothing.** Nothing regressed and nothing new is known broken. The session's finding is not an entry because it was fixed before it reached anything that mattered: **"take the LAST X-Forwarded-For hop" — the remedy TPN-NET-004 prescribed and the old `provision-workspace` carried — is wrong on this platform.** The last hop is Supabase's own relay and varies per request, so for eleven minutes on wilson-dev (`resolve-login` v7) the new durable limiter counted each request under a different subject and refused nothing. Caught by the burst probe the brief's "harness with a failing control" rule demanded, measured with a throwaway header-echo function (a caller-supplied `x-forwarded-for` is stripped; a spoofed `cf-connecting-ip` gets a Cloudflare 403), fixed in v8 (`cf-connecting-ip`; the 21st check in a minute answers 429). No migration; migrations stay 0000–0066 and pgTAP stays 70 suites. **Review round R1 (same day, the next session) found one more, also fixed before anything merged:** a `*` typed at the company step was a prefix search — PostgREST aliases `*` to `%` in an `ilike` pattern, so `smo*` resolved the smoke workspace and returned its slug (measured on dev v8; staging v10 carried the same code). The resolver now folds `*` to a one-character `_` and re-checks the returned names for equality (dev v9, staging v11; R2 then strengthened both controls to the display name minus its last character plus `*`, the only input that reaches the re-check — dev v10, staging v12). | **`useRosterMembers` cannot tell a broken roster from an empty one** — the hook returns `error`, `RateCardPage` shows it, `useRosterMembers.test.js` goes red if it is swallowed again. **`ResetPasswordWizard` still performs a global sign-out** — decided by Audrey (answer 12): it stays global, `scope: 'global'` is now explicit, and the screen says `YOU WILL BE SIGNED OUT ON EVERY DEVICE.` before and "signed out on every device" after. Both in the B1 commit. |
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

## Bins (demo sprint, 2026-09-10)

### A disconnected network root can stall the local server while bins open or relink
**INFERRED.** `electron/rabbitBins.cjs` stats every referenced path on the
list route and walks known roots (capped at 5000 entries / depth 8) for the
relink scan, all synchronously on the Express thread. A root on an unplugged
SMB share makes each `statSync` wait out the network timeout, and no other
R.A.B.B.I.T. request is served meanwhile. Would settle it: a bin file added
from a network drive, the drive disconnected, the Bins tab opened — measure
the freeze. Fix direction: stat and walk asynchronously (`fs.promises`) with a
per-root deadline, or skip roots whose drive letter is not mounted.

### A file dropped on any tab other than Bins may navigate the window to it
**INFERRED** (review round 2, 2026-09-10). Nothing in `electron/main.cjs` or
`src/App.jsx` prevents the default of an OS `drop` (no `will-navigate` guard,
no document-level `dragover`/`drop` handler), and Chromium's default for a
file dropped on a document is to navigate to it. The Bins tab guards every
surface while it is mounted (`views/BinsView.jsx`, the document-level drop
effect), so the demo path is covered; a clip dropped on Scenes, Summary or
Tasks is not. Would settle it: drag an MP4 from Explorer onto the Summary
tab of the dev app. Fix direction: a `will-navigate` handler in `main.cjs`
that refuses anything but the app's own origin, plus a document-level
`dragover`/`drop` `preventDefault` in `App.jsx` — the shell's layer, not
the bin session's.

## UI overhaul (`feat/ui-overhaul`, merged nowhere) — left open at its close, P1 (2026-09-27)

Everything the overhaul knows is broken and did not fix, as the last session
(P1) left it. The source is V2's one table (`docs/sessions/handoffs/ui-v2-2026-09-27.md`
§4.2), each row kept with its number, owner and origin; P1's hand-off
(`ui-p1-2026-09-27.md`) says what P1 closed. Questions for Audrey are in
`docs/walkthroughs/47_ui_overhaul_final.md` §2, not here. Tags as this file
defines them; a row's "owner" is who acts first.

### Behaviour and keyboard, left under C1 (no view or interaction change was allowed)

- ~~**P1-01 · Enter toggles the pet.** MEASURED. `App.jsx` ~1404–1417: Enter on any focused button toggles the pet and never presses the button (every kit Dialog, drawer, picker; Space works). Owner: Audrey (C5), then a session. From A4-1, B3d, B4c-6, B5b-27.~~ — FIXED by post-overhaul S2a (2026-09-30, branch `po/s2a-settings-placement`, ruling C12): a bare Shift tap toggles the pet (`src/lib/companionHotkey.js`) and Enter presses the focused control, measured in the running app in all three tools (`05bf5fe`, hardened by `edb7fa9` and `07d34d6`). What is left of the class is in the S2a section at the end of this file.
- **P1-02 · Space opens O.T.T.E.R.'s Search from any focused control** that is not a field, and can stack Search over an open Dialog or Drawer (`Otter.jsx` global shortcuts). MEASURED. From A4-2. S2a (2026-09-30): the same on the Help and Settings buttons S2a added to O.T.T.E.R.'s strip; Enter presses them (MEASURED, S2a review round 1).
- **P1-03 · Home's document keydown listener runs on every page** (`Home.jsx:134-197`): ArrowDown+Enter in O.T.T.E.R.'s Search went to /dog; it can swallow an Escape. MEASURED. From A4-3. S2a (2026-09-30): now that Enter presses the focused control everywhere else, this is the one place Enter can still do something different (after an arrow key on any page, Enter can open a Home destination). It also strands a kit Dialog: Search, left open when ArrowDown+Enter went to /dog, stayed registered, so on D.O.G. `overlayOpen()` was true, the Shift tap was dead and Tab never moved focus (the hidden dialog's trap found no visible control) until she went back and closed Search. MEASURED by S2a's review round 1 (B-R1-09). Owner: Audrey (Home is fonts-only under C3), or the kit (a Dialog on a hidden page should neither count nor trap).
- **P1-04 · D.O.G.'s document keys act behind its overlays** (Alt toggles Full deck; ←/→ switch the page). MEASURED. Needs a C1 ruling. From A4-4. S2a (2026-09-30) narrowed D.O.G.'s Enter only (`enterGenerates.js`: never on another page, never over a drawer, dialog or kit overlay). Alt, ←/→ and Ctrl+Z/Y also have no page check (`DeckOutlineGenerator.jsx` ~3206–3290), and D.O.G. stays mounted, so they act from every page: Ctrl+Z on O.T.T.E.R.'s page, outside a field, undoes D.O.G.'s last text edit unseen. INFERRED from the code; would settle it: a text edit in D.O.G., then Ctrl+Z on another page, then back. S2a gave D.O.G. its `currentPage`, so each handler can gate on it in one line.
- **P1-05 · A dialog opened from a kit Menu returns focus to `<body>`** on close (A4 fixed its own two callers). MEASURED. Owner: the kit. From A4-11.
- **P1-06 · Focus falls to `<body>` after an inline edit commits or reverts** (`EntityListView`, `ProjectTasksView`, `ScenesView` InlineText). MEASURED. From B4c-10, B5b-32.
- **P1-07 · Budget's period popover does not return focus to its cell** when it closes itself. MEASURED. From B5b-8.
- **P1-08 · Saved-views rows are divs: mouse only** (`ExpenseSavedViewsDropdown`, `SceneSavedViewsDropdown`). MEASURED. From B5b-9, B5b-22.
- **P1-09 · Escape discards unsaved drafts** in ~~the Scenes popups,~~ `ExpensePopup` and the Timeline's Settings (the kit Dialog's `onBeforeClose` could ask). MEASURED. Owner: Audrey, then a session. From B5b-28, B3d. **The Scenes popups' part FIXED by post-overhaul S3b** (2026-10-01, `po/s3b-shot-lists-ui`, D21): closing a scene or shot popup (✕, Close, Escape, the backdrop) with a changed description or notes, or Escape in a changed box, asks "Discard your changes?" first, Cancel focused. Left there: S3b-04 and S3b-05 below.
- **P1-10 · Keyboard scrolling hides the focused row or cell** (the Bins list under its sticky head; Crew/Talent period cells past the scroller's edge). MEASURED. Owner: a session and the kit (scroll padding, B5b-KR-5). From B4c-13, B5b-7.
- **P1-11 · A minimap bar drag does not save.** MEASURED. Owner: Audrey (C1). From B3d. After S1 the minimap drag is a true no-op for a phase drawn over exactly its own dates (post-overhaul S1, 2026-09-30; the minimap draws phases only): its mouse-up writes the DRAWN dates back, and those are now the stored ones, so it no longer stores a day early on this machine. It still rewrites a phase drawn over a different span — one with no dates or one date (drawn over its tasks' span, or today to +14 / padded 14 days when it has none), or a parent widened to cover its sub-phases — with that drawn span. Why the drag moves nothing, confirmed in the running app by S1's review round 2: `OverviewBar`'s move handler writes to `e.currentTarget`, which React 19 sets to null after dispatch, so it throws ("Cannot set properties of null (setting '_draftStart')"), and the mouse-up then writes the unmoved drawn span.
- **P1-12 · Two "Today" buttons** (minimap and gantt). MEASURED. Owner: Audrey. From B3d.
- **P1-13 · O.T.T.E.R.'s duplicate-found dialog is unreachable** (`renderDuplicateModal`; nothing sets its state). INFERRED from the code; would settle it: an import of a course whose slug exists. From A4-9.
- **P1-14 · "Import failed: …" is `window.alert`** (`Otter.jsx` `handleImportFile`). MEASURED. From A4-10.
- **P1-15 · Two `window.confirm` left** (`TeamView.jsx:388` "Remove from project", `:693` "Remove from roster"). MEASURED (P1's grep audit: 2). W9 already ruled the conversion; behaviour, so not P1's visual close.
- **P1-16 · The slide preview logs "Maximum update depth exceeded"** when the duplicate resolver previews (`LayoutVisualizer`, C4). MEASURED. Needs a C4 ruling. From A4-13.
- **P1-17 · Opening a task template logs React's "unique key" warning** (`TaskTemplateManager` → `TemplateEditor`). MEASURED by V2's probe.
- **Autoplay (R4-36).** MEASURED: the video preview starts playing when it opens (`VideoPreview.jsx:177`, `controls autoPlay`), with no reduced-motion path. Left under C1 by B4; plan §5 names it for this file.

### Older bugs and data, left under C1

- **P1-18 · Role slugs printed as labels** ("production_designer") in the client view's crew list and the By role report (`ClientViewTab` `crewByDept`). MEASURED. Owner: Audrey, then a session.
- **P1-19 · A locked version's total reads $0** in the versions table and active-budget banner (the fixtures' snapshot has no `grandTotal`). MEASURED on the fixtures.
- ~~**P1-20 · The Projects page shows a project's dates one day early** ("Aug 2 – Dec 17, 2026" against 08/03 – 12/18 in its fields): a time-zone parse. MEASURED.~~ — FIXED by post-overhaul S1 (2026-09-30, branch `po/s1-timeline`, ruling B5): the page reads its dates through `src/tools/rabbit_v0.1.0/dates.js`, the one helper the Timeline and the Tasks view use.
- ~~**P1-21 · A new scene thumbnail shows late** in the ungrouped scene table (never handed `thumbRevision` / `onThumbChanged`). MEASURED. From B5b-18.~~ — FIXED by post-overhaul S3b (2026-10-01, `po/s3b-shot-lists-ui`): the table is handed both.
- ~~**P1-22 · A shot row's delete inside the scene popup also opens that shot.** MEASURED. From B5b-19.~~ — FIXED by post-overhaul S3b: its click stops at the button.
- **P1-23 · A related asset's click in a scene, shot, Level or Experience popup opens nothing** (`RelationsPanel` `onOpenAsset`, R4-26). MEASURED. From B5b-20, B4c-3. **The scene and shot popups FIXED by post-overhaul S3b**: the asset opens in the Assets tab's own `AssetDetailPopup` (now exported) over the popup, as a task opens. Left: the Level and Experience popups (`EntityListView.jsx`, B4c's twin), which still set state nothing renders. Owner: that lane.
- ~~**P1-24 · "Files (N)" shows twice** in the popups / `FileManager`. MEASURED. From B5b-21.~~ — FIXED by post-overhaul S3b: the popups' own label went; FileManager's head says it once.
- (P1-21 to P1-24 are the four older Scenes bugs walkthrough 45 left under C1; walkthrough 47 Q192.)
- **P1-25 · React logs duplicate keys (26×) after a take is unassigned or undone** (`rabbitFixturesAdapter.js:68-74`, `RabbitProvider.jsx:2919`; dev fixtures). MEASURED.
- **P1-26 · Linked counts disagree:** `EntityListView` reads `level_id` while the sidebar reads `level_ids` ("Assets (1)" beside "0 assets"). MEASURED.
- **P1-27 · Two tests import `@babel/parser` / `@babel/traverse` undeclared** (`otterCss.test.js`, `authSelectors.test.js`; resolved through plugin-react). MEASURED by reading `package.json`. Declaring them is a lock change: the lock's owner.
- **P1-28 · A missing thumbnail draws the browser's broken-image icon** in a light 1px frame (`FileThumbnail`, the entity popups, Scenes rows; the asset detail draws initials instead). MEASURED.

### Visual rows P1 did not close, and why

MEASURED by V1/V2's walk and look unless tagged otherwise. Rows that wait on a
ruling are Audrey's questions in walkthrough 47 as well.

- **P1-29 · Team members: twelve columns need 1,707px and have 1,230**; Day rate, Status and the actions cut at every width. Waits on Audrey's design call (47).
- **P1-30 · Rate card: at 1280 the table scrolls sideways**; its frame is 980px and its columns' content needs about 1,040px (P1 measured), so no re-split fits. Ways out in 47 (the kit's compact padding, B4-KR-3, would fit it).
- **P1-31 · The Timeline task editor's own chrome:** inline hexes (178 in `TimelineView.jsx`, most of them its), 26 `ring-orange-500`, 4 `ring-amber-500`, its three footer buttons dimming to 30% while saving, "Asset: …" at 3.16:1. Waits on Audrey (walkthrough 42 Q6, in 47).
- **P1-32 · Timeline Fit cuts the first and last key-date diamonds** and hides the last key-date line; two diamonds sit 3.9px apart at 1024 over five years; ~~the week axis overprints a month's first day~~ (fixed by post-overhaul S1, 2026-09-30: ruling B2, option B). Fit's range is C1 (the lane kept it); the minimap window's 2px sides are B3's documented selected edge. Owner: Audrey (47).
- **P1-32a · Other date code still builds a day in UTC** (post-overhaul S1, 2026-09-30; the siblings of the Timeline's parse, left because they are not S1's files). INFERRED from the code and its arithmetic, not run: `ProjectAssetsView.jsx` (~1440–1462 and ~1699–1730) builds an asset template's task dates by `new Date('YYYY-MM-DD')` → `setDate` → `toISOString().split('T')[0]`, which drops a day where the chain crosses the March clock change, and seeds "today" from `toISOString()` (tomorrow in an Eastern evening); `NotesView.jsx:165` dates a note by `toISOString().slice(0, 10)` (the same evening case); `holidays.js` `countWorkingDays` matches holidays by `toISOString().slice(0, 10)` of a local midnight, right west of UTC and a day off east of it; the Budget's `CrewTeamTab.jsx:38` and `TalentTab.jsx:48` read `new Date(project.start_date)`, so their week headers start a day early ("Wk1 08/02" for a project starting 08/03, S1 review round 1 ran a copy in New York). For these the fix is `src/tools/rabbit_v0.1.0/dates.js` (`parseIsoDate`, `toIsoDate`). In `TimelineView.jsx`, not date parses: `TODAY` is read once at module load, so a Timeline left open past midnight draws Today and seeds new tasks a day behind; and with weekends hidden several pixel/day conversions ignore the mask — a bar's move and resize (`dx / dayPx`: a drag across a weekend lands two days short), ~~centring on today (it lands about 2/7 × today's day number columns right of the Today line), the visible window's first day, and the minimap's click-to-jump~~ (those three fixed by post-overhaul S5p, 2026-10-05, with P1-32b). The move and resize, still open, want the pair S5p added (`dayAtX` / `xAtDay` in `timelineMinimap.js`; round 1's sketch: `round(dayAtX(left + dx) − dayAtX(left))`) and a rule for an end that would land on a hidden day; TODAY wants a read per render. Owner: a session (S3b, S5 or P1).
- **P1-32b · ✅ CLOSED 2026-10-05 by post-overhaul S5p (see the end of this entry) — ~~🚨 With weekends hidden, Day zoom's pixel/day conversions outside the gantt pane ignore the hidden columns~~** (HIGH; older than S1; MEASURED by S1's review round 2 in the running app, 2026-09-30). `TimelineView` converts the gantt's scroll to days as `scrollLeft / DAY_PX` in the zoom re-anchoring, `changeZoom`, the visible window (`visibleStartDays` / `visibleSpanDays`, which place the minimap's window), `scrollDetailToDay`, the gantt's Today and the first-mount centring — only `DetailPane` holds the weekend mask. So with "Show weekends" off: Week → Day moved the gantt from 14 Sep to 11 Dec 2026 (+88 days) and Day → Week moved it back; at Day zoom the minimap's window reads 15 Sep – 6 Oct while the gantt shows December; the gantt's Today lands on 10 Dec, with today off screen; and toggling "Show weekends" does not re-anchor (`hideWeekends` is not in the effect's deps). With weekends shown every zoom change keeps its date (S1 measured 36 transitions). The fix: lift the mask (or a pure `weekendMask(start, days, dayPx)`) into `TimelineView`, record the anchor as a DAY through it, route those six conversions through one mask-aware x↔day pair (`dayIndexAtX` and its inverse), and add `hideWeekends` to the deps. Owner: a session — the next that edits `TimelineView.jsx` (S5), or its own small one. **Closed 2026-10-05 by post-overhaul S5p** (`po/s5p-timeline-weekends`: `50f9604d` the fix, `bb749c59` and `02ea371e` its two review rounds; integrated into `feat/post-overhaul-edit-versioning`; hand-off `docs/sessions/handoffs/po-s5p-2026-10-05.md`, walkthrough 48 §6). Reproduced first in the app on the fixtures, clock Thu 24 Sep 2026, at 1440x900 and 1280x700 — S1's numbers to the day: Week → Day Mon 14 Sep → Fri 11 Dec (+88); at Day zoom the window 15 Sep – 6 Oct against the gantt's 11 Dec – 12 Jan; Today 10 Dec at the left, today off screen; the switch 11 Dec → 14 Sep → 11 Dec; transitions 36/36 kept shown, 18/36 hidden. Fixed as proposed here: `weekendMask` built in `TimelineView` and handed to `DetailPane` (which builds none); one pair `dayAtX` / `xAtDay` (+ `visibleDayRange`) in `timelineMinimap.js` that the pane and the six conversions share; the anchor a DAY (`anchorDayRef`); `hideWeekends` in the re-anchoring's deps. After: +0 days; the window brackets the gantt; Today centred, its line on screen; the switch keeps the date both ways; 36/36 in both settings; the window still slides on the zoom tabs (32/32 frame by frame, `scripts/timeline-window-slide.mjs`); with weekends shown the state shots move nothing but a dependency arrow that differs between two runs of the same code. **Found and fixed beside it** (not the mask's): the minimap's click and window drag used the scale of the last schedule rebuild — Week's 22px from the Timeline's opening — so at Day zoom a click landed 207 days early with weekends shown (154 hidden); `scrollDetailToDay` is a callback on the scale and the mask now. **Found and NOT fixed:** a bar's move and resize with weekends hidden (P1-32a, still open: it needs a rule for an end that lands on a hidden day); P1-32c untouched. Instruments for the next session: `scripts/timeline-weekends-probe.mjs <port>` (exits 1 on any moved date), `scripts/timeline-window-slide.mjs <port>`.
- **P1-32c · Smaller Timeline defects S1's reviews found and left** (all older than S1, LOW, MEASURED in the running app): the "+ New task" ghost goes stale under a still pointer after a wheel pan (it shows the day the pointer WAS over, the click proposes the one under it); the minimap's `onWheel` calls `preventDefault` on a passive listener (Chrome logs an error and the call does nothing); opening the new-task editor with the dev fixtures calls Supabase's `release_stale_upload_reservations`, which answers 401.
- **P1-33 · Home's Resources column dims the other items to 1.77:1 on the orange** (a C6 break on the fonts-only page). Owner: Audrey (47).
- **P1-34 · Dates in six forms app-wide.** Owner: Audrey (one format, 47), then the kit's date formatter (V2-KR-1).
- **P1-37 · The lesson page's heading outline:** the lesson title is an `<h2>` under the tool's `<h1>`, and a lesson's `#` renders an `<h1>` below it. Not visual; closing it moves `.lesson-content`'s h1–h3 selectors with the tags, which `typeScale.test.js`'s lesson sweep names. Direction: render the markdown's h1/h2/h3 as h3/h4/h5 with the selectors following.
- **P1-38 · `scrollbar-gutter: stable` on O.T.T.E.R.'s scrollers only.** Owner: Audrey (47).
- **P1-40 · The three popups draw the same things three ways** (Level/Experience, Scene/Shot, Task). Owner: Audrey (which is the model, 47).
- **P1-41 · Tables full-bleed on Levels, Experiences, Tasks, Assets; on the gutter on Scenes and Budget**; Levels/Experiences show a select-all box with no row boxes. Owner: Audrey (47).
- **P1-42 · The Scenes and Levels/Experiences/Assets toolbars differ** (icon toggles vs text, "Views" vs its icon, the count, the size picker, three sorts, a moving create button). Needs the kit's segmented control (B5b-KR-2) and Audrey's answers (47).
- **P1-43 · Dialogs close three ways** (an orange "Done", an outline "Close", an outline "Done"); the Rate card's Google Sheet dialog's Cancel is borderless. Not reached by P1: it needs one convention chosen and every caller moved.
- **P1-44 · Budget:** empty values marked four ways ("--", "–", "—", "·"; R4-19 said one em dash); Custom's total row has a grey rule where the others are orange and leaves Logged/Variance blank; the Margin / Contingency / Agency fee inputs do not form a column; the actuals popovers' titles are capitalised and carry a name; variance figures sit ~2px high. Not reached by P1. (Talent's rate is Audrey's question.)
- **P1-45 · Bins' three pane header rules sit at three heights** (211 / 225 / 265); "Add" moves 86px between grid and list. Not reached by P1.
- **P1-49 · A count is styled three ways** ("8 MEMBERS" on the Label step, "16 tasks" in the mono, "1 project"); P1's audit found three more on the Label step in the mono (Intake, Summary, Team). Not reached by P1: it needs one count style chosen.
- **P1-51 · O.T.T.E.R.:** selects draw the browser's chevron (D.O.G.'s draw a custom one); page titles at x399 in a centred column on Admin / Quiz / New course against x224 elsewhere; Validate's actions end at 1256 vs 1245; the quiz's levels lower case vs capitalised badges; Help's title 12px right of its nav; the Search field's magnifier outside the field. Not reached by P1.
- **P1-53 · Glyphs in a fallback face:** → ← ● ○ (Segoe UI), D.O.G.'s ▸ output markers (Cambria Math: 17 glyphs on Help → D.O.G. → System prompts, filed in the walk with a glyph ceiling each) and "₩" (Cascadia Mono). Owner: Audrey (may a session fetch Geist's release, 47).
- **P1-54 · The pet sits over drawn page content** — the screens are measured by P1's final walk in 47 §3. Owner: Audrey (C5). Post-overhaul S4a adds one: the file window's footer, whose last button ends where the pet sits. The pet covers the right end of Download at 1440x900 on a cloud file and of Preview at 1280x700 on the Local Server (`docs/sessions/handoffs/img/po-s4a-fixtures-file-window-1440x900.png`, `po-s4a-localserver-file-window-1280x700.png`).
- **P1-55 / P1-79 · Chips (and the Dashboard's "Filter" chip) are on the capitalised Label step** while Q2 lists chips for sentence case. Owner: Audrey (47).
- **P1-56 · Project type names in Title Case; CAM MOVE / FRAMING codes and the Bins codec in capitals.** Owner: Audrey (47).
- **P1-57 · Names 600 in the entity tables, 400 in the file tables; the popup Tasks table's Assignee / Reviewer in full ink; dates right-aligned on the Files page, left in R.A.B.B.I.T.'s file tables.** Owner: Audrey (47).
- **P1-58 · One 16:9 preview geometry at three sizes** (`FileThumbnail`, the Assets and Level thumbnails, R4-35). Not reached by P1.
- **P1-59 · The Assets toolbar's ten controls, the popup's four jobs, the two-line row, one picker, the bulk bar over the header, the sidebar's status pill.** Waits on walkthrough 44's questions (in 47).
- **P1-60 · The Files page's Created / Modified / Duration widths have no floor** (a date still cut at 1024; "DURATI…" cut at 1280 and 1440). Owner: Audrey (walkthrough 44 Q27/Q28, in 47). Since post-overhaul S4a, R.A.B.B.I.T.'s Files tab is the same explorer and shares it, and the file window open beside the table narrows the table further.
- **P1-61 · `ShotTakeChips` paints inline colours and borders and takes no class** (B6's contract); its take rows' data-coloured inset edge goes with it. Not reached by P1.
- **P1-63 · The nested shot rows still scroll sideways** at medium / large thumbnails (`rabbitScenes.css`). Not reached by P1.
- **P1-64 · The Budget strip's `scrollbar-width: none` loses to the unlayered `.wilson-dark-scroll *`.** INFERRED (latent: the strip never overflows at 1024+). The fix is layering that `index.css` block, a global cascade change.
- **P1-65 · Partial dead selectors are not guarded** (`.rb-audit-body .rb-relink-row`); a shadowed `keepEscape` would pass the §11 guard. Tooling; not reached by P1.
- **P1-67 · The native date field's calendar icon draws a white focus square** (47 native date inputs). Not reached by P1 (headless Chromium does not show the picker indicator's focus).
- **P1-68 · The kit input's edge is 1.48:1 on the raised paper** (WCAG 1.4.11 asks 3:1 for an input's only boundary). Every field's look: Audrey's call (47, with the outlined button's edge).
- **P1-69 · `otterCss.test.js`'s scope guard lets a kit ROOT be reached through an O.T.T.E.R. container.** Needs a ruling.
- **P1-70 · `scripts/ui-walk.mjs` runs every screen in one browser context**, so a `--only` run measures Settings / Help over whatever the last screen left. Tooling; not reached by P1.
- **P1-72 · The Undo toast (z 90) sits over the kit Menu (80) and the lane popover (65) app-wide.** Owner: Audrey (47).
- **P1-73 · A zero margin reads "+$0" in the Summary but "$0" elsewhere; a variance under 50¢ reads "$0" in its tone.** Owner: Audrey (47).
- **P1-82 · The four Scenes tiles lost their icons** (the kit Stat has no icon slot, B5b-KR-1). Owner: Audrey (47), then the kit.
- **P1-83 · A sortable head's inset ring sits on the first glyph of a left-aligned label**, and Budget's and Bins' sheets duplicate the kit's inset rule. Not closed: moving the ring into the cell padding changes every sortable head's hit box, and Bins' head layout is built on the kit's `padding: 0`, which `binsCss.test.js` pins.
- **The agent overlays are still hand-drawn:** `DiffView` (a private backdrop, the stone palette, an orange frame) and the agent toast; P1 moved their shadows onto the float token and the outline proposal onto the kit Dialog. Not reached by P1.
- ~~**The Summary's missing-files notice is hand-drawn**~~ **Closed by post-overhaul S4a (`7cd5914`, 2026-09-30):** the notice moved with Relink to R.A.B.B.I.T.'s Files tab, on the kit Banner (warning tone, the Relink… button in its action slot); `ProjectFilesExplorer.test.jsx` pins it. As filed: (`ProjectSummaryView.jsx`, the relink notice: a `color-mix` warning tint, its own hairline, a kit Button inside), where the kit Banner has the warning tone and an action slot, as Storage's load error now uses (P1-39). READ in code at P1's close (review round two's mono fix touched its sentence); not reached by P1.
- **Hexes left in lane code:** `IngestionToast.jsx` 21 and `UndoToast.jsx` 10 (the toasts' own colours; P1 moved their shadows and radius only), besides the task editor's (P1-31). MEASURED by P1's audit.

## Post-overhaul merge (Track A over the overhaul, `feat/post-overhaul-edit-versioning`) — review round 1 (2026-09-30)

### 🚨 The workspace realtime channel broadcasts a PRIVATE project's rows to every member
**MEASURED (2026-09-29, merge review round 1, A-R1-04; PRE-EXISTING on the
overhaul parent `60a8981` — not introduced by the merge, and not fixed by its
round-1 corrections).**
`fn_workspace_realtime_broadcast` (`0018_workspace_channel.sql:159`, attached
to `projects`, `workspace_members`, `tasks`, `assets`, `project_members`)
passes whole NEW/OLD rows to `realtime.broadcast_changes` on
`rabbit:workspace:<ws>` with only a workspace filter, on the premise its own
comment states — "Membership ≡ visibility". 0072 made that premise false:
`projects_select` gained the private-project arm, and the join gate
`can_read_workspace_topic` still checks membership only. So a private
project's **id, title and `is_private` flag** (and its assigned tasks, its
label-changing asset events, its roster) reach every active member's channel
— members who cannot SELECT the row. The per-project topic (0016) is
unaffected: its join gate is `SECURITY INVOKER` over `projects_select`.

**What 0082 closed, and what it did not:** the id the channel leaks now opens
nothing — `milestones_trash_index` and `fn_trash_authz` (so `soft_delete_row`
/ `restore_soft_deleted`) carry the privacy arm (0082, suite 82), which was
the practical harm (A-R1-01). The broadcast itself is untouched, because it is
a product decision about what the workspace channel carries. The candidate
fix — skip a `projects` row whose `is_private` is set, and a `tasks` /
`assets` / `project_members` row whose project is private — means a project
flipped to private after the fact stays in the other members' project index
by NAME until their next refetch (they cannot open it; `projects_select`
refuses), and broadcasting the flip would carry the row that must not be
carried. Audrey's call, then its own migration (the next free number after
0082) with a suite-80 probe: no workspace-topic message for a private
project's insert, with a public-project control. 0082's header records the
shape.

**Correction (round 2, A-R2-03):** "the id the channel leaks now opens
nothing" was true of the trash paths only. It still opened a WRITE through
`milestones_insert` / `milestones_update`, whose WITH CHECK gated on
`can_write_project` alone — closed in 0082 §3b (both WITH CHECKs gain
`EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id)`, evaluated
under the caller's `projects_select`; suite 82 probes 20-23). The same gap on
`tasks` and `assets` is the entry below.

### Round 2 (2026-09-30) — left open, and a numbering correction

- **`tasks_insert`, `tasks_update`, `assets_insert` and `assets_update` (0013)
  have no hop to the parent project.** PRE-EXISTING on the overhaul parent
  `60a8981`; MEASURED by merge review round 2 (A-R2-03), NOT fixed here.
  Their WITH CHECK is workspace + membership + `can_write_project(project_id)`,
  and `can_write_project` is TRUE for every admin and manager and for every
  member of an UNSTAFFED project (0013:115-121), with no privacy arm; the
  populate trigger (0004) fills only a NULL `workspace_id`, so a client that
  sends its own passes the workspace arm. So the id the workspace channel
  leaks (the entry above) admits a write: a second manager can insert a task
  or an asset into another member's private project over PostgREST
  (supabase-js's `.insert()` without `.select()` sends `Prefer:
  return=minimal`, so no SELECT policy is consulted), or move an existing row
  INTO it through UPDATE's WITH CHECK. The fix is the one-line hop 0082 §3b
  gives `milestones`, in each of the four policies — but it retypes 0013's
  policies on tables with their own suites (03, 04), so it belongs with the
  broadcast ruling above: its own migration, the next free number, with
  suite-03/04 probes of suite 82's shape (the second manager's INSERT throws
  42501; the same INSERT on the public project lives; a refused move leaves
  the row where it was).
- **Enter on a focused page button outside any overlay opens the pet instead
  of pressing the button.** PRE-EXISTING on the overhaul parent; MEASURED by
  round 2 (A-R2-04), NOT fixed. App's window-level Enter handler (now
  `src/lib/companionHotkey.js`) stands down for text controls and — since
  round 2 — for any kit overlay (`overlayOpen()`, which the status warning
  registers with) and any `[role="dialog"]` ancestor; that was the finding,
  and it is closed. It still cancels the keydown when a plain page `<button>`
  or link has focus and a pet exists, and Chromium activates a focused button
  on the keypress a cancelled keydown suppresses — so a keyboard user who
  Tabs to a page button and presses Enter opens the companion. One more arm
  in `enterTogglesCompanion` (`BUTTON`, `A`, `[role="button"]`) closes it;
  left out because it changes the shell's page-level behaviour beyond the
  merge's brief. Audrey's call.
- **⚠️ Migration 0082 and pgTAP suite 82 are TAKEN by this merge
  (A-R2-06).** The post-overhaul plan (2026-09-29) names 0082 / suite 82 as
  the first free numbers for its five feature sessions. Measured across every
  local and remote ref on 2026-09-30, the next free numbers are **0083 /
  suite 83**. The plan needs renumbering before any feature session starts;
  0082's header says the same. **Superseded the same day:** the Track C
  merge's review round 1 took 0083 / suite 83 (C-R1-01, the section below),
  so the next free numbers are now **0084 / suite 84**.

## Post-overhaul merge (Track C over the overhaul, `feat/post-overhaul-edit-versioning`) — review round 1 (2026-09-30)

### Track C's file gates met private projects — closed in 0083 (C-R1-01), with what it leaves
**MEASURED by the merge review (C-R1-01) and FIXED in migration 0083 /
suite 83.** The class 0082 closed for Track A, on Track C's files:
`reserve_upload_bytes` (0078) and `log_file_downloaded` (0074, restating
0047 — this one PRE-EXISTS on the overhaul parent, and 0082 did not list it)
are SECURITY DEFINER bodies that checked project access the pre-0072 way,
and `files_insert` / `files_update` (0038) had no hop through `projects`. So
a second manager, or any member of an unstaffed private project, holding the
id the workspace channel leaks (the Track A entry above) could reserve
against `projects/<private-id>/…` — and `abandon_upload_reservation` or the
hourly sweep would then land an `upload_abandoned` certificate in that
project's `file_events` — could write a `downloaded` event for its files
(an existence oracle), and could INSERT a `files` row into it (return=minimal:
no SELECT policy sees the row) or rewrite its files with an UPDATE that reads
no column. 0083 adds `passes_project_privacy` (0082) to the two bodies' first
refusal, the same message and code as before, and the parent hop to the two
WITH CHECKs; suite 83 probes each with the second manager, the plain member,
the creator and the admin, with a public-project control beside every
refusal. ⚠️ Round 2 (C-R2-01) corrected round 1's claim, made here and in
0083's header, that the same callers could also *move* a file INTO the
private project: a filtered UPDATE reads a column, so Postgres requires
SELECT and applies `files_select`'s USING — hop included since 0038 — to the
new row as a WITH CHECK, and that move was refused before 0083. Suite 83's
probe 18 could therefore never fail (the round-1 "inert guard" class, in
pgTAP; suite 79's probe-15 note had already recorded why). Probe 20
(`UPDATE public.files SET description = 'x'`, no WHERE — the one UPDATE
shape no SELECT policy touches) is now the failing control for
`files_update`'s hop, with a presence control that the abort rewrote
nothing; probe 18 stays, re-described as the filtered move it is. Left as
it is, on purpose: `abandon_upload_reservation`,
`release_*` and the sweeps act on reservation ROWS, and after 0083 no row
can exist for a project its maker could not see. **Still open from this
class:** `tasks_insert` / `tasks_update` / `assets_insert` / `assets_update`
(the Track A round-2 entry above) and the broadcast itself.

- **Walkthrough 15 names the wrong tab, the old button case and a R.A.B.B.I.T.
  view that does not exist** for the attachment migration (lines 21, 112-127:
  "Settings → RABBIT → … Click DRY-RUN … MOVE"; lines 65, 122 and 185:
  "RABBIT → Files" / "RABBIT's Files view" — the view list is intake, summary,
  assets, team, tasks, scenes, bins, levels, experiences, timeline and budget,
  and a project-level stored row shows on the **Summary** tab's **Project
  files** card; round 2, C-R2-03, which also corrected the panel's own
  success copy). The tab has been labelled **Storage** since Session 22
  (its key is still `rabbit`), and the merged `AttachmentMigrationPanel`'s
  buttons read **Dry-run** and **Move** (sentence case, the overhaul's rule).
  MEASURED by the merge review (C-R1-05); the in-app copy that pointed at a
  "Settings → Migration" location is corrected in the same round. NOT fixed
  here: the merge sessions may not edit `docs/walkthroughs/`. A session that
  may must repair `docs/walkthroughs/15_*.md` — and Audrey's Desktop copy of
  it (`WILSON walkthroughs\`) is hers to replace.
- **`InvoiceAttachment.handleOpen` still passes `'noopener'` and never reads
  `window.open`'s return**, so a pop-up that the browser blocks fails
  silently there (the invoice-row twin of BudgetView's receipt control, which
  C-R1-02 fixed: `window.open` returns null whenever `noopener` is set, so a
  return check and `noopener` cannot coexist — BudgetView now checks the
  return and severs the opener by hand). Out of C-R1-02's scope; not changed.
  One-line fix when a session wants it: the same `opened.opener = null`
  idiom, then a `setError` on a null return.
- **`files_delete` (0038) still has no hop through `projects`, and a
  filter-less `DELETE FROM public.files` runs under it alone** — the one
  DELETE shape `files_select` never sees (a WHERE reads a column, and
  Postgres then applies `files_select`'s USING to the rows as well).
  `authenticated` still holds DELETE on `files` (0033 revokes only TRUNCATE /
  REFERENCES / TRIGGER), so a second manager, or an unstaffed member, could
  hard-delete every row their `can_write_project` admits — a private
  project's included, each with a purge certificate in that project's
  `file_events`. PRE-EXISTS on the overhaul parent (0038 met 0072 there);
  MEASURED by the merge review's round 2 (C-R2-01), NOT closed here — 0083's
  "deliberately not changed" list says the same. Reachable only by a
  statement that reads no column: never a filtered PostgREST request, and
  one that `pg-safeupdate`, where Supabase preloads it for the API role,
  refuses outright — unmeasured on this project's three envs, so the hop is
  the gate to add. Take it with the `tasks_*` / `assets_*` hops above, in
  one migration (0084 or later, with the DELETE twin of suite 83's probe 20).
- **No Content-Security-Policy on either build, and a stored body's type is
  the uploader's browser's word.** `rabbit-files` has no
  `allowed_mime_types`, the receipt and invoice pickers take any file, and
  supabaseProvider stores `file.type` as the object's Content-Type; a blob:
  URL runs on the origin that made it. So a receipt uploaded as `text/html`
  or `image/svg+xml` and opened through `URL.createObjectURL` +
  `window.open` executed as script on WILSON's origin in the next money
  reader's tab — on the web, beside the Supabase session in localStorage.
  FIXED at both sinks by round 2 (C-R2-02): `toInlineSafeBlob`
  (`src/lib/inlineSafeBlob.js`) re-types anything but PNG / JPEG / GIF /
  WebP / AVIF / PDF to `application/octet-stream` before the URL exists, so
  it downloads instead of rendering — the renderer-side twin of the Local
  Server's `safeMediaContentType`. STILL OPEN, the class: `vercel.json`,
  `index.html` and `electron/main.cjs` set no CSP, so every future sink of a
  client-typed body (a preview pane, an `<iframe>`, an `<object>`) has to
  call the helper by hand. A CSP that keeps `script-src` and `object-src`
  off `blob:` is the structural fix. PRE-EXISTING on the overhaul parent
  (`InvoiceAttachment.handleOpen` carried the first sink).
- **⚠️ Migration 0083 and pgTAP suite 83 are TAKEN by this round
  (C-R1-01).** Measured across every local and remote ref on 2026-09-30, the
  next free numbers are **0084 / suite 84**. The post-overhaul plan
  (2026-09-29) still says 0082 / 82 and the Track A entry above said 0083 /
  83; both are stale, and the plan needs renumbering before any feature
  session starts. 0083's header says the same.

## Post-overhaul S2a (`po/s2a-settings-placement`) — left open (2026-09-30)

What S2a's two review rounds found broken and did not fix, because the file
is another session's or the fix is not S2a's to make. P1-01 is closed above;
P1-02, P1-03 and P1-04 carry S2a's notes. Questions for Audrey are in
walkthrough 49 §5, not here.

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
- **S2a-02 · The Shift tap and the Enter rule cannot see hand-rolled
  modals.** "Not over a dialog" knows the kit overlays, a shown drawer
  backdrop and anything `role="dialog"`, `alertdialog` or `aria-modal`.
  Five modals are plain `fixed inset-0` divs with none of those: Close
  WILSON (`App.jsx` ~2772), the Timeline's `PhaseExtendModal` and
  `TaskEditor` (`TimelineView.jsx` ~4137, ~4207), `DiffView` and the hatch
  modal (`PetCompanion.jsx` ~314). With focus on one of their buttons, a
  Shift tap opens the pet's chat under the modal. INFERRED from the code by
  S2a's review round 1 (B-R1-12); would settle it: open the quit
  confirmation, Tab to Cancel, tap Shift. Owner: each modal's next session
  (give it `role="dialog"` and `aria-modal`, or move it to the kit Dialog).
- **S2a-03 · A kit Drawer never takes focus, and gives it back to
  `<body>`.** From a tool's new gear to the drawer's first control is 16
  Tabs in O.T.T.E.R. (through controls under its backdrop), 11 in D.O.G.
  and 3 in R.A.B.B.I.T.; Escape or Close from inside drops focus to
  `<body>`, not back to the gear. MEASURED in all three by S2a's review
  round 1 (B-R1-13). Owner: the kit (S2a kit request S2a-KR-4).
- **S2a-04 · The workspace chooser's Enter signs into the wrong
  workspace** (`LoginScreen.jsx` ~673–690). Its window-level Enter handler
  cancels the key and picks `workspaces[workspaceIndex]`, which only
  mouseenter and the arrow keys set, so Tab to the second workspace and
  Enter signs into the first. INFERRED from the code (the dev sign-in
  skips this screen); would settle it: a user with two workspaces, Tab,
  Enter. From S2a's review round 1 (B-R1-11).
- **S2a-05 · An unlayered rule draws the scrollbar O.T.T.E.R.'s tab list
  hides.** `.wilson-dark-scroll *` sets the scrollbar outside any layer, so
  it beats the strip's layered `scrollbar-width: none`. Where the tab list
  still overflows it draws a scrollbar under the tabs and the strip grows
  from 37px to 44px, putting the gear about 4px below the other tools'.
  MEASURED at 711px of window before round 2 (V-R2-01). Since round 2 the
  list fits down to 711px (four Ctrl+= presses on the smallest window), so
  this shows only narrower than that. Owner: the kit (S2a-KR-3: move
  `.wilson-dark-scroll` into `@layer base`).
- **S2a-06 · D.O.G.'s Enter still generates during the leave
  transition.** `currentPage` changes only at the transition's swap, after
  the fade-out, the compress (600ms) and the title hold (400ms), so for
  about a second after she picks another page D.O.G. still counts as
  current, and an Enter pressed then still starts a generation. INFERRED
  from `App.jsx` ~1990–2004 by S2a's review round 2 (B-R2-07); would settle
  it: with a document loaded, pick another page in the nav strip and press
  Enter at once. Owner: the session that next edits the transition (by
  ruling it is otherwise untouched).
- **S2a-07 · The Timeline's settings drawer still titles itself "RABBIT
  settings"**, while the gear that opens it reads "R.A.B.B.I.T. settings".
  MEASURED: the drawer's heading and its label are that fixed string
  (`TimelineView.jsx` ~5466–5471; ~5598–5603 after S1). The file was S1's
  this wave, and S2a's brief allowed it one title string (the drawer
  footer's Help). Owner: the next session that edits `TimelineView.jsx`
  (S3c or S5).

## Post-overhaul S2b (`po/s2b-otter-functions-lesson`) — left open (2026-09-30)

What S2b's review rounds found and did not fix, because the file is another
session's or the decision is Audrey's. Her questions are in walkthrough 50
§3, not here.

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
- ~~**S2b-02 · The hotkeys merge has the same keying weaknesses the functions
  merge had fixed in S2b.**~~ `mergeHotkeys` (otterRoutes.js) and its Local
  Server twin key a category on `normKey`, so names with no Latin letters
  ("文字列", "数学") all key to '' and merge into one, and a category value
  that is not a string throws on every later merge. Its keying on
  `category || name` was already right. INFERRED from S2b's review of the
  functions merge (A-L2, A-L3). Owner: whoever next edits the hotkeys merge.
  **Closed by S2c (`po/s2c-otter-tidy`), 2026-10-05:** reproduced on both
  backends over her real hotkeys (the two names made one category; a name
  of 5 threw), then fixed — both copies key through S2b's helper
  (`categoryKey` in otterRoutes.js, shared with `mergeFunctions`; the
  route's three keying lines are `mergeFunctionsDoc`'s): a sent name is
  `category`, else `name`, else "General", and it joins only a category
  the Hotkeys page draws (a `shortcuts` list headed by its `category`) —
  review round 1: joining by `name`, as "General" or through a `hotkeys`
  list put shortcuts under a blank heading or off the page. One algorithm
  on both backends (`adapters/hotkeysMerge.test.js`: 22 cases on both,
  parity, 600 seeded documents, everything added drawn by the page's own
  filter). Her own categories sent again change nothing, before and after.
  Admitted (review rounds 1 and 2): S2b's key, now both merges', keeps `+`
  and `#` and counts the spaces around them, so "Edit + Mode" / "Edit
  Mode" and "Ctrl+Click Actions" / "Ctrl + Click Actions" (one heading
  each before) are two; and it counts a combining mark as punctuation, so
  in a script with vowel signs two names can still meet (Hindi "कि" and
  "की"), while NFC and NFD spellings of "Édition" stay apart. None of her
  66 headings has a `+`, `#` or combining mark. Changing the key changes
  both merges and both Local Server copies together (`mergeFunctionsDoc`
  was outside this brief). And a heading the page draws that is not a
  string (a number) is never joined: sending "5" beside a stored 5 makes a
  second "5" (before, both copies threw). Found and NOT fixed (outside the
  brief, which allowed main.cjs's hotkeys route only): the NODES merge
  (`mergeNodes` and the `/api/software/:slug/nodes/merge` route) keys a
  system and a category on the same a-z0-9 key — measured, "文字列" and
  "数学" become one category and the systems "C++" and "C#" one system.
  Owner: whoever next edits the nodes merge. Also found (review rounds 1
  and 2): a stored document that is not a library is now left as it is by
  both merges on every path — generation, import and change-request
  approval — which then answer as if it merged while nothing moved.
  Before, on the cloud, an array or `categories: null` was overwritten with
  the merged library and only a `categories` string or object threw (an
  approval then listed it failed); on the Local Server every such shape
  threw. No writer makes these shapes (main.cjs, the column default and
  every merge write a list). Owner: the next session on the merges or the
  approval flow — signal "not merged" (and perhaps read `categories: null`
  as empty, as the Hotkeys page does).
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
- ~~**S2b-05 · A function entry that is not an object breaks the Search
  dialog's function search**~~ (`fnSearchText` reads `f.name`), and the
  Functions view's card. Pre-existing (the old search read `f.name` the same
  way); the merge no longer writes such entries since S2b, but an imported
  library can carry one. INFERRED. Owner: the next session in the Search
  dialog.
  **Closed by S2c (`po/s2c-otter-tidy`), 2026-10-05:** reproduced (a null
  threw in the Search dialog and blanked the window from the Functions
  view; one level up, a null category or a list that is not a list threw
  in the pet's `flattenDoc` and blinded the pet to the WHOLE library — a
  Blender question answered "could not be reached"), then fixed: one
  reader, `functionEntries` (otterRoutes.js), skips what is not a function
  in the Search dialog and the Functions view; the card draws nothing for
  one; `flattenDoc` skips it at every level of all three documents; and
  (review round 1) the three generation paths' "existing functions" lists
  read through it too. Also on those lines: the Functions view's own
  search no longer throws on a field that is not a string, and it and the
  Search dialog read each field as the card draws it (`cardText`). Her
  library: unchanged (46 functions, 92 coloured wells, 0 errors, with or
  without the plants).
  Found and NOT fixed (the brief named the function readers only): the
  same class in the HOTKEY readers — a null shortcut in a category's list
  throws in the Search dialog's hotkey search and in the Hotkeys view's
  search ("Cannot read properties of null (reading 'action')", measured on
  Otter.jsx's own lines). Owner: the next session in the Search dialog or
  the Hotkeys view (the pet's `flattenDoc` already skips one since S2c).

## Post-overhaul S4a (`po/s4a-files-ui`) — left open (2026-09-30)

What S4a built around or found and did not fix. S2a-01 and the Summary's
hand-drawn missing-files notice are closed above; P1-54 and P1-60 carry
S4a's notes. Questions for Audrey are in walkthrough 52 §5, not here.

- **S4a-01 · Migration 0085 (`files.tags`) is written and NOT applied to
  any environment.** The desktop app's classifier refuses DDL writes to dev
  from a session, so the migration was proven by the hosted shim in a
  rolled-back run (suite 87, after review round 2: 30 planned / 30
  collected / 30 passed) and by CI. The client tolerates a database without the column, as it does for
  0081: tags read as none, the file window says "Tags need a database
  update that has not reached this workspace yet.", and a tags-only save
  is refused with nothing changed. The
  exact dev and staging commands are in the S4a hand-off (Waiting on
  Audrey). The file and its history row are in
  `Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\`. Owner:
  Audrey.
- ~~**S4a-02 · The Legal tag restricts nothing yet.**~~ **Closed by S4b
  (`po/s4b-legal-gate`, migration 0088), once 0088 is applied:** Audrey
  ruled on 2026-10-01 that a Legal file is seen by "same as money files for
  now" and that Legal is chosen when the file is added. A Legal file now
  lives under the project's `LEGAL` folder, which joins `INVOICES` and
  `FINANCE` in the one list of locked folders; its row, its bytes, its
  thumbnail and its events are for workspace admins and the project's
  managers only, and the tag can no longer be ticked on an existing file.
  See S4b below for what is left.
- **S4a-03 · Electron's PDF viewer titles a previewed PDF with a blob's
  id.** Every PDF, the Local Server's and the cloud's, is fetched and handed
  to the viewer as a typed blob (so `safeMediaContentType` stays as it is,
  and a cloud body is never framed by its signed URL — review round 1), and
  the viewer's toolbar shows the blob's UUID. The preview's own head carries
  the file's name.
  MEASURED in Electron 33
  (`docs/sessions/handoffs/img/po-s4a-localserver-preview-pdf-*.png`).
  Cosmetic. Owner: the next session on previews.
- **S4a-04 · The preview is the workbench Dialog, not a lightbox.** The
  kit has no full-window Dialog, so the preview is 960px wide. It is the
  kit's cap high (88vh) and every kind, a video with its controls
  included, fits the stage the bar and a refusal leave (review round 2,
  R2-UI-04, measured at 1280x700 and 1440x900). Owner: the kit
  (S4a-KR-1, "a lightbox-sized Dialog").
- **S4a-06 · The thumbnail routes may answer 500 under a dot-folder.**
  S4a's review round 2 measured that `send` refuses an absolute path
  through any dot-folder (`dotfiles: 'ignore'`, its default). That broke
  the SPA fallback from a `.claude` worktree (fixed in `d3963c4`) and the
  file stream, download and managed-file stream routes under a demo
  folder's `.wilson\rabbit-data` (fixed in round 2, `dotfiles: 'allow'`).
  The thumbnail routes call `res.sendFile(thumbPath)` the same way
  (`main.cjs`'s asset, scene, shot and managed-file thumbnails;
  `rabbitBins.cjs`'s bin thumbnails), and in demo mode the cache dir is
  `<folder>\.wilson\rabbit-data\thumbnails`, so every cached thumbnail
  likely answers 500 while a demo folder is open. INFERRED from the same
  mechanism. Would settle it: open a demo folder and load a thumbnail.
  Owner: the next session on thumbnails (the same one-argument fix).
- **S4a-07 · Ctrl+Z on another page undoes R.A.B.B.I.T.'s last edit.**
  Every page stays mounted, and three of R.A.B.B.I.T.'s tabs bind the undo
  keys on the whole window with no page gate: the Timeline
  (`TimelineView.jsx`, `window`), Scenes (`ScenesView.jsx`, `document`)
  and Budget (`BudgetView.jsx`, `window`). MEASURED by S4a's review round 2
  and again by S4a (Playwright, the dev fixtures, 1440x900): with
  R.A.B.B.I.T. left on Scenes, Ctrl+Z on D.O.G. (focus on the page, not a
  field) turned a scene renamed "RENAMED BY PROBE" back to "Lighthouse,
  dawn"; left on the Timeline, the same key changed the renamed task; left
  on Summary, which binds no keys (the control), nothing changed. Budget's
  handler has the same shape: INFERRED. Same class as S2a-01 (Bins' keys),
  and the same fix: `Rabbit.jsx` passes `pageActive={currentPage ===
  'rabbit'}` and each handler returns while it is false. Not changed by
  S4a: S3b, next on this branch, touches `ScenesView.jsx` and
  `BudgetView.jsx` (S4a's brief). Owner: S3b (Scenes, Budget) and the next
  session on `TimelineView.jsx` (S3c or S5).
  **Scenes FIXED by post-overhaul S3b** (2026-10-01): the handler acts only
  while R.A.B.B.I.T. is the page on screen, and stands down under a kit
  menu, the settings drawer (or focus in one) and any kit dialog while none
  of the tab's own popups or takes dialogs is open (the Bins keys' rule;
  the popups keep the keys, C1). **Budget and the Timeline are left**: S3b's
  brief gave `BudgetView.jsx` and `TimelineView.jsx` to S3c. Owner: S3c.
  **Budget and the Timeline FIXED by post-overhaul S3c** (2026-10-02, step
  1, `25083448`): each handler acts only while R.A.B.B.I.T. is the page on
  screen (`pageActive`, Rabbit.jsx's) and stands down under the settings
  drawer or with focus in one, as the Scenes and Bins keys do; each has an
  off-page CONTROL (rabbitBudgetRender, timelineShotLists).
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

## Post-overhaul S4b (`po/s4b-legal-gate`) — left open (2026-10-01)

What S4b built around or found and did not fix. Questions for Audrey are in
walkthrough 54 §5 and the S4b hand-off, not here.

- **S4b-01 · Migration 0088 (`0088_legal_files.sql`) is written and NOT
  applied to any environment — and it needs 0085 first.** Its §0 refuses to
  run without `files.tags`. Proven by the hosted shim in rolled-back runs
  against wilson-dev's real data with 0085 prepended (suite 90; the counts
  are in the S4b hand-off) and by CI. Until it is applied the client offers
  no Legal option: Add as Legal is greyed with "Legal files need a database
  update (migration 0088) that has not reached this workspace yet." The
  exact dev and staging commands are in the S4b hand-off (Waiting on
  Audrey); the file and its history row are in
  `Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\`.
  Owner: Audrey.
- **S4b-02 · The Edge Function `storage-presign` carries its own copy of
  the locked-folder list and is not redeployed.**
  `supabase/functions/_shared/moneySegments.ts` gained `LEGAL` in the same
  commit as 0088 (held to the SQL function by
  `storagePresignBoundary.test.js`). Until it is deployed the function would
  presign a `LEGAL` key for an s3 workspace. Nothing reaches that today: the
  client never presigns a money key (a Legal upload is pinned to Supabase),
  and `files_money_provider_chk` refuses an s3 row under `LEGAL` once 0088
  is applied. Owner: Audrey (`supabase functions deploy storage-presign`
  on dev, then staging).
- **S4b-03 · A manager's second window does not see a new invoice or Legal
  file until it reloads.** 0088 stops the realtime broadcast of money
  `files` rows, because the project topic is joined by every project reader
  and the message carried the whole row (MEASURED: a member read an
  invoice's name, note and path off it). A per-row money check inside
  `realtime.broadcast_changes` is not possible — a broadcast has no
  per-recipient filter — so the fix is a second, money-only topic whose join
  gate is `can_access_project_money`. Owner: the next session on realtime.
  **2026-10-09 (S4d, 0092):** the same for the Legal audience — a Legal row
  stays off the topic (its audience is wider than money's and still narrower
  than the topic's), so a workspace manager's second window refreshes to see
  a new Legal file too. The fix would then be TWO extra topics, or one per
  gate: the Legal one joined on `can_access_project_legal`.
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
- **🚨 S4b-05 · A workspace manager can give themselves a manager seat on
  any project, and so read its Legal files and its money.** PRE-EXISTING
  (0013's roster policies and 0037's money gate; invoices, budgets and rates
  are exposed the same way). MEASURED by S4b's security review, round 1
  (S1-SEC-01), in a rolled-back run on wilson-dev: a workspace manager
  holding a member seat ran `UPDATE project_members SET project_role =
  'manager' WHERE project_id = … AND user_id = auth.uid()`, then read the
  Legal file's name, note, body and thumbnail; one with no seat did the
  same with an INSERT. `can_manage_project_roster` is `current_app_role() IN
  ('admin','manager') OR project_role_for(p) = 'manager'`, no trigger stops a
  change to one's own seat, and `project_members` writes no edit history, so
  nothing records it. Audrey ruled that workspace-level managers do NOT see
  Legal files; this is how they can. The smallest fix is a BEFORE INSERT OR
  UPDATE trigger on `project_members` refusing a manager seat for oneself
  unless the caller is an admin or already the project's manager (with an
  opening for the creator of an unstaffed project), and
  `projectRoleMatrix.js` in step — but it changes who can staff projects.
  Owner: Audrey's decision (S4b hand-off, Waiting on Audrey), then its own
  migration.
  **2026-10-02 — ACCEPTED by Audrey, no fix:** "workspace managers can have
  access to the files that is okay. inherently workspace manager may need to
  access a folder to review things." The gate is unchanged (admins and the
  project's managers); a workspace manager reaches a project's Legal and
  money files by taking its manager seat, and nothing records that step.
  Not to be "fixed" without a new ruling (`POST_OVERHAUL_ANSWERS.md`,
  2026-10-02).
  **2026-10-09 (S4d, 0092):** the Legal half is moot — a workspace manager
  sees Legal files WITHOUT the seat now (`can_access_project_legal`, Audrey
  2026-10-08). The money half stands as accepted: invoices, the budget and
  the rates still need the seat, and taking it is still unrecorded.
- **S4b-06 · Storage totals tell a member when a hidden file arrives, and
  one function answers any company's.** PRE-EXISTING (0055/0057/0073).
  MEASURED (S1-SEC-03): `workspace_storage_usage()` gives every member the
  exact workspace total, Legal and exempt objects included (4,300 bytes with
  a 4,000-byte Legal file beside a 300-byte plain one), so polling it shows
  when a hidden file appears and its size. And `rabbit_petal_storage_ok(
  p_project, p_incoming, p_path)` is executable by any signed-in user with
  no workspace check: a search over the byte argument gives another
  company's exact usage, given a project id. Fix for the second:
  `p.workspace_id = current_workspace_id()` and membership inside it.
  Coarsening the first is a product decision (Add files' courtesy check
  reads the exact figure). Owner: the next session on storage.
- **S4b-07 · Knowing a Legal file's id, a member can confirm it exists.**
  PRE-EXISTING, INFORMATIONAL. MEASURED (S1-SEC-06): `INSERT … ON CONFLICT
  (id) DO NOTHING` answers 0 rows for an existing id and 1 for an unknown
  one; a plain INSERT answers 23505 on `files_pkey`. No source of the id
  was found for a member (`asset_versions.file_id` and
  `rate_cards.source_file_id` would carry one only if a manager linked the
  file). Owner: none until an id is exposed somewhere.
- **S4b-08 · A manager on a desktop or web build from before S4b can attach
  a Legal file to a D.O.G. deck.** The exclusion is the client's
  (`deckAttachments.js`); the database rightly gives a manager the row.
  Once 0088 is applied, a manager on an old build sees Legal files and that
  build does not know to leave them out of a deck every member reads.
  INFERRED. Owner: the release that ships S4b (ship before applying 0088
  on staging, or accept the window).
- **S4b-10 · A money-cleared person can rename a Legal OBJECT out of LEGAL
  through the Storage API.** MEASURED by S4b's security review, round 2
  (S2-G): the storage UPDATE policies are permissive and OR — the old key
  passes `rabbit_files_money_update`'s USING, the new one `rabbit_files_update`'s
  WITH CHECK — so `UPDATE storage.objects SET name = …/project/…` moves the
  body (and its thumbnail) where every member can list and read it. The
  `files` row stays Legal (`trg_files_legal_fixed`). Since S4c one client
  path calls storage move — the shot-folder re-filing, on keys whose third
  segment is `shots` or `scenes`, never LEGAL — so the restrictive policy
  below would not refuse it; before S4c no client did, and the same person
  can always download and re-add the file, so nobody gains what they could
  not already give away. The
  validated fix is a RESTRICTIVE `FOR UPDATE` policy on both buckets,
  `NOT rabbit_legal_segment((storage.foldername(name))[3])` in USING and
  WITH CHECK — but it may refuse Supabase Storage's OWN updates of a Legal
  object (a resumable upload completing, a thumbnail regenerated), and that
  cannot be smoke-tested from a session. Owner: Audrey's decision; if yes,
  its own migration with a resumable-upload smoke test on dev first.
  **2026-10-09 (S4d, 0092):** the same person set now includes a WORKSPACE
  MANAGER without a seat: they pass `rabbit_files_money_update`'s USING for
  a LEGAL key (the Legal arm) and `rabbit_files_update`'s WITH CHECK for an
  ordinary key, so they too can rename or copy a Legal body or thumbnail to
  where members read it (S4d review round 1, finding 7; not measured — the
  same OR of permissive policies S4b measured). With remote viewing on,
  0091's `petal_bin_posters_update` is a second route for a thumbnail. The
  fix above closes both for everyone; the decision is still Audrey's.
- **S4b-11 · Files migrated desktop→cloud before S4b may hold the app's own
  page instead of their contents.** Until S4b's review round 1 the migration
  read each body from `/files/:id`, a route the Local Server never had; the
  single-page fallback answered `index.html` with a 200, and that is what was
  uploaded. A re-run now finds those rows already in the cloud and leaves
  them (it no longer uploads first), saying so only when their path differs.
  INFERRED from the code — whether anyone ran the migration is unknown. Would
  settle it: on each environment, list `files` rows whose body is ~1 KB of
  HTML. Owner: Audrey (whether any company migrated), then a repair session.
- **S4b-09 · The desktop→cloud migration sends `tags` to a database that may
  not have the column.** Since S4a a desktop row carries `tags`, and
  `runMigration` inserts `{ ...f }`: a cloud database without 0085 refuses
  every such row ("column tags does not exist"). Found while making the
  migration Legal-aware (S4b review round 1); not changed, it is S4a's.
  INFERRED. Owner: the next session on the migration.

## Post-overhaul S3b (`po/s3b-shot-lists-ui`) — left open (2026-10-01)

What S3b (the Scenes tab's shot lists) built around or found and did not
fix. P1-09 (the Scenes popups' part), P1-21, P1-22, P1-24, the Scenes popups'
side of P1-23, and S4a-07's Scenes handler are closed above. Questions for
Audrey are in walkthrough 51, not here.

- **S3b-01 · The Scenes popups' sidebar offers a reviewer writes the
  database refuses.** RelationsPanel's "Add asset relation" and each
  relation's remove are ungated (`RelationsPanel.jsx` has no permission
  check; INFERRED from the code). S3b gated every scene and shot verb in
  `ScenesView.jsx`. Review round 1 (R1-04) found "Add new task" was
  ScenesView's own: the panel draws it whenever it is handed
  `onCreateTask`, so the popups now hand it only with the gate, and their
  `handleCreateTask` refuses (writeGate.test.js holds both). The rest of
  the panel is S3c's file. Owner: S3c.
  **FIXED by post-overhaul S3c** (2026-10-02, step 1): RelationsPanel takes
  the seat (`canWrite`, `writeReason`): "Add asset relation" and each
  relation's remove are greyed with the reason (GatedAction), and both
  funnels refuse; the Scenes popups hand it theirs.
- **S3b-02 · FileManager in the scene and shot popups is ungated.** A
  reviewer sees Add files and each file's delete (`FileManager.jsx` reads no
  permission; INFERRED from the code). Owner: the Files lane, or S3c with
  the popups.
- **S3b-03 · The Scenes tab binds Ctrl+Z / Ctrl+Y only on the Local
  Server.** The handler has returned early without `supportsBins` since
  milestone 2, so on the cloud there is no undo key on the tab (the undo
  toast still works). INFERRED from the code; unchanged by S3b. Owner:
  Audrey (is the key wanted on the cloud?), then a session.
- **S3b-04 · A popup's Delete drops a changed draft without asking.** Delete
  scene / Delete shot closes the popup and then asks about the delete; a
  description or notes draft is gone even if the delete is cancelled
  (INFERRED from the code: the button calls `onClose` directly, past D21's
  guard). Owner: a session (C1: the delete's own flow).
- **S3b-05 · The popups' task form is dropped without asking.** D21 covers
  the popups' own drafts; NewTaskSidePopup's (RelationsPanel's) closes with
  the popup. INFERRED from the code. Owner: S3c.
  **FIXED by post-overhaul S3c** (2026-10-02, step 7): the form reports
  typed work (`onDirtyChange`), and a popup with a typed task form asks
  D21's question before it closes ("What you typed in the new task is not
  saved. Discard it, or go back to it.").
- **S3b-06 · The popup name's Escape reverts without asking.** A one-line
  field reverting on Escape is the kit's convention (useEscapeRevert), so
  D21 left it; recorded in case Audrey wants the question there too.
  Owner: Audrey.
- **S3b-07 · The Local Server's shot-list patch is an upsert.** A rename of
  a list the server does not hold makes a new list (`rabbitShotLists.cjs`
  538–597; review round 1, R1-18, read from the code). The provider patches
  only lists it holds, so it is reachable only when the client and the
  server disagree. Owner: S3a's lane (the Local Server route).
- **S3b-08 · "Show in Bins" drops a popup's changed draft without asking.**
  The shot popup's takes panel switches tab (`ShotTakesPanel.jsx` 121 →
  `Rabbit.jsx` 114), which unmounts the Scenes tab and its popup: a typed
  description or notes is gone without D21's question (review round 1,
  R1-19, traced in the code). So is one when another scene's or shot's
  popup is opened over it by a navigation target ("Open in Scenes"): since
  review round 2 each popup is keyed by its row, so the first one's draft
  no longer carries into the second — it goes, unasked (MEASURED by the
  "a popup is its row's own" test). Owner: S3c (the leave guard) or the
  Bins lane.
  **FIXED by post-overhaul S3c** (2026-10-02, step 7): each popup with
  typed work registers with the leave guard (`state/leaveGuard.js`):
  "Show in Bins", any other way off the tab, a project switch, and a jump
  opening another row's popup ask D21's question first; Cancel keeps the
  typed text. Leaving the page does not ask: the tab stays mounted.
- **S3b-09 · The asset popup the Scenes popups open is ungated, and lists
  the active list's rows.** Since P1-23 a related asset opens the Assets
  tab's own `AssetDetailPopup` (`ProjectAssetsView.jsx` 1655), which
  reads no permission — a reviewer can change its status — and whose scene
  and shot pickers read `ctx.scenes` / `ctx.shots`, the active list's
  (2023, 2037; review round 1, R1-20, read from the code). Owner: the
  Assets lane, and S3c for the relation pickers.
  **The relation pickers FIXED by post-overhaul S3c** (2026-10-02, step 1):
  they offer the active list's scenes and shots by default with "Show all
  lists", keep a row already linked, and name each row's list; the popup
  takes the seat (`canWrite`), so a reviewer's relation badges are greyed
  and its funnels refuse. The rest of the popup is the Assets lane's.
- **S3b-10 · The provider's undo batch is one global slot, and a replay
  records nothing.** `RabbitProvider.jsx` `runBatch`, `pushHistory`,
  `undo` / `redo`. (a) Any mutation that completes while a batch is open
  joins it: an edit made on the tab while a bulk delete runs is undone with
  the delete, in one step. (b) A mutation that completes while an undo or
  redo replays pushes no step at all (`suspended`): it can never be undone.
  (c) `runBatch`'s `finally` reads `b.entries` from the slot after
  `clearHistory` (or a project or adapter switch) has emptied it: a
  TypeError, which ScenesView's bulk delete logs as "Failed to delete …".
  Review round 2 (R2-01), MEASURED by its probes over the real provider.
  ScenesView keeps its own keys off (b) — Ctrl+Z / Ctrl+Y stand down while a
  bulk delete runs — but the undo toast's Undo can still start a replay in
  that window. Owner: S3a's lane (the provider): guard `b`, and decide
  whether a batch should collect only its own calls.
  Post-overhaul S3c does not lean on it: a draft's changes write nothing,
  and Save edit records its write and its Save as ONE step pushed directly
  (`saveEditDraft`), never through the batch slot.
- **S3b-11 · Admin Terminal → Users: "Add people" likely cannot close its
  own menu in the app.** `UsersSection.jsx` `armSwallow` arms the swallow
  in the button's onMouseDown only `if (addMenuAt)` — but in Chromium React
  19 has already flushed the Menu's close (made in its document-capture
  mousedown) in the microtask checkpoint before that handler runs, so it is
  never armed and the click re-opens the menu (READ; the same order MEASURED
  for S3b's MenuButton by emulation in review round 2, R2-02, and fixed
  there with a window-capture listener: `views/scenes/MenuButton.jsx`).
  Owner: the Admin Terminal lane.

## Post-overhaul S3c (`po/s3c-edits`) — left open (2026-10-02)

What S3c (edits: the cut, the draft, Save edit, drag-and-drop, the leave
guard, the budget's shot list, what links belong to) built around or found
and did not fix. S3b-01, S3b-05, S3b-08, S3b-09's relation pickers and
S4a-07's Budget and Timeline handlers are closed above. Questions for
Audrey are in walkthrough 53 and the hand-off's "Waiting on Audrey".

**Built, 2026-10-02 — Audrey's rule "removing a list never removes the
Timeline or the Budget"** (the S3c brief's dated section): the Timeline's
group-by-scene and the Budget's By scene / By shot / Custom read the
ACTIVE list's scenes and shots only (D10), and a task linked outside it
reads as not assigned ("No scene in the active list", "No shot in the
active list" — a name true of both kinds of task under it; the
controller's note of the same day) — never dropped, never under a scene
brought back from another list (step 1's first reading) — with what it
points at in its tooltip and in the task popup (", not in the active
list"). Its link is never written. Remove from this list and Clear on the
active list, Set active, Archive and Withdraw say so. The executable test:
`state/listRemovalKeepsTasks.test.jsx`.

- **S3c-01 · Another project's unsaved edit is not part of the window's
  close question.** An automatic switch (the project cleared) leaves a
  draft in memory under its own project; the close question names the open
  project's only. Its stored copy survives, and that project's next visit
  offers "Recover unsaved edit?". By design (D12: an automatic switch cannot
  ask). Owner: Audrey (should the close question name it?).
- **S3c-02 · A drop onto a scene with no shot in the list changes
  nothing.** A cut is shots; a scene with none is no block of it, so a shot
  dropped on its heading has nowhere to land. Owner: Audrey (should the
  shot make that scene a block of its own?).
- **S3c-03 · New shot in an edit makes a real shot on the list at once.**
  D6: "entirely new shots" are real shot rows. The draft's own undo, and
  Discard changes, take it out of the edit, not out of the list (delete it
  there). Owner: Audrey.
- **S3c-04 · An edit made by Save edit is Saved at once.** Its snapshot
  holds the names "Missing shot: …" shows (D17), so its maker's Withdraw
  this edit never applies to it; Ctrl+Z straight after Save edit takes the
  Save back and withdraws it (one step, "Recently removed"); later it is a
  manager's Archive. Owner: Audrey (the reading S3c took of "createEditFrom,
  or saveEdit where the API calls for it").
- **S3c-05 · Save edit from the leave or close question saves without a
  summary.** Under the name the first-change question gave it, at that
  title's next version. Owner: Audrey.
- ~~**S3c-06 · "Recover unsaved edit?" says "WILSON closed" after a browser
  tab was reloaded too.**~~ Closed in S3c's review round 2 (R2-03): it says
  the edit "was left unsaved", true of a closed window, a reloaded tab and
  a sign-out alike; and a copy is removed under its own person when a save
  finishes after a sign-out (it was offered back as unsaved).
- **S3c-07 · A list's first edit takes the list's own title** (D13's
  rule), so the bar can read "Shot list 1 · v1 — Edit Shot list 1 · v1 (not
  saved)". Owner: Audrey.
- **S3c-08 · The shells' exits are held by source pins.** No test mounts
  Rabbit.jsx or App.jsx: the tab strip, the cross-tab jump, navigateTo and
  the close question's fold are pinned on their source
  (leaveGuardWiring.test.js, each pin with a CONTROL) and were exercised
  for real in Chromium and once in the desktop app. Owner: a session that
  mounts the shell.
- **S3c-09 · On the cloud the Scenes tab still binds Ctrl+Z only with an
  unsaved edit on screen** (then the draft's own undo, on every backend);
  otherwise S3b-03 stands. Owner: Audrey (with S3b-03).
- **S3c-10 · P1-32b is still open** (the Timeline's weekends-off
  conversions): S5's, as the brief said.
- **S3c-11 · One exit can ask two questions in a row.** A Scenes popup
  with typed words, and an unsaved edit: the tab strip (or a project
  switch) asks the popup's "Discard your changes?" first, then "Save the
  edit before leaving?" — the nearer work first, by design
  (`state/leaveGuard.js`, review round 1's note). Owner: Audrey (one
  combined question instead?).
- **S3c-12 · An edit written whose names alone were refused, from the
  leave question: its notice can go unseen.** Review round 2 (R2-01) made
  such an edit SAVED (it is written; the question about it asked about
  nothing): the exit goes on and the refusal ("The edit was saved as …, but
  the names it holds were not: …") is the provider's `ctx.error`, which
  the Scenes bar's Banner shows only while the tab is open. Leaving the
  tab or the page, it is not seen; the edit is there either way, without
  the names "Missing shot: …" would show. The provider has no app-wide
  notice of its own (it sits above the kit's toast stack). Owner: a
  session (a provider notice on the toast stack).
- **S3c-13 · A sign-out the app did not ask for (PLAUSIBLE, not
  reproduced).** The provider drops the drafts from memory when the
  signed-in person changes (R1-02; their copies stay, offered to the same
  person's next visit). auth-js's own SIGNED_OUT after a refused token
  refresh would do that while App, which does not listen for it, stays
  signed in; on the Local Server the project stays open, so the edit
  leaves the screen without a question (its copy kept). Read in review
  round 2, not reproduced. Owner: the auth lane (App and SIGNED_OUT).

## Post-overhaul S5 (`po/s5-budget-versions`) — left open (2026-10-05)

What S5 (bid versions as living documents: open / selected / locked, the
two save verbs, migration 0089) found and did not fix, or built around.
S5 handed off after its step 2 (the schema, the adapters, the provider and
the pure model); steps 3–9 (the Summary, the questions, the Timeline, the
Local Server's money gate, P1-32b, the docs) are its continuation's.

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
- **S5-02 · Bid versions are not broadcast** (0016 never added
  `budget_versions`): another window does not see a version saved, opened
  or deleted elsewhere until it reloads the project; the project row's
  pointers (`open_budget_version_id`, the lock) DO arrive live. Older than
  S5. Owner: a realtime session.
- **S5-03 · Opening a version whose task (or phase, or key date) was
  trashed brings it back under a NEW id on the cloud**: a trashed row sits
  behind its SELECT policy and the upsert by its old id is refused, so the
  provider re-makes it (the brief's "else a new id written back to the
  snapshot on the next Save") and points its tasks at a re-made phase. The
  trashed original stays in "Recently deleted"; its comments and files stay
  on it. The Local Server (hard delete) and the dev fixtures take the saved
  id. Owner: Audrey (should opening restore from the trash instead?).
- **S5-04 · The S5 client needs 0089 on its database.** A version opened,
  or a bid selected, names `projects.open_budget_version_id` or calls
  `select_budget_version`; on a database without 0089 those writes are
  refused (PGRST204 / PGRST202). Reading is unaffected. 0089 on a database
  before the S5 client is harmless (an older client never reads or writes
  the pointer). By design for the beta (A10: the branch ships whole, after
  staging's migrations); recorded so nobody cherry-picks the client ahead.

## Post-overhaul S5b (`po/s5-budget-versions`, the continuation) — left open (2026-10-05)

S5b built step 0 (Audrey's ruling (a): each bid version shows exactly its
own schedule — rows it does not hold are SET ASIDE, migration 0090) and
closed S5-01; it handed off before steps 3–9 (the Summary, the questions,
the Timeline, the Local Server's money gate, P1-32b, the docs) —
`docs/sessions/handoffs/po-s5b-2026-10-05.md`.

- **S5b-01 · The project's budget AMOUNT and currency are shown to, and
  editable by, every project member on the Projects page.**
  `projects.budget_total` / `budget_currency` (0000) sit in
  `ProjectDetailPanel`'s Budget group with no role gate; 0090 does not guard
  them (a trigger cannot hide a read). Under D8 ("only project admins can
  access the budget") the group would hide from members and the columns take
  0090's guard. Owner: Audrey (is that number money?).
- **S5b-02 · Tasks and phases have no "Recently deleted"** — only key dates
  do. On the cloud they go to the trash (purged at 30 days) and come back by
  Undo or the Edit history; on the Local Server they are hard-deleted (Undo
  re-adds them). The new questions say "Undo brings them back", never
  "Recently deleted", for tasks and phases. Owner: Audrey (a list like the
  key dates'?).
- **S5b-03 · From the Dashboard, a task of a project that has a bid version
  open (and is not the project open in R.A.B.B.I.T.) cannot be deleted**: the
  question sends the person to the project's Timeline or Tasks, where Remove
  from this version can keep it in the versions that hold it (review round
  1, R1-06). Decided by S5b. Owner: Audrey.
- **S5b-04 · Every client of one project must be S5b or later once a
  version is opened.** An older client does not split set-aside rows out, so
  it shows them as live, and an older client's version save folds them in
  (review round 1, R1-07). The S5b client needs 0090 (an open is refused
  without it, "stopped part way"); 0090 before the client is harmless. A
  desktop build left behind is the risk. Owner: the controller (the beta
  ships the branch whole).
- **S5b-05 · The admin's Workspace takeout and the desktop backup keep
  set-aside rows**, on purpose (a backup keeps every row; the takeout's CSV
  carries `set_aside_at`). Owner: Audrey.
- **S5b-06 · The Budget tab still writes versions the OLD way until step 3**
  (`createBidVersion`, `deleteVersion`, the lock in `SummaryTab`, each then
  reloading the project). None of them opens a version, so nothing is set
  aside from there, but a version deleted from that table skips constraint
  10's question (review round 1, R1-08). Owner: the continuation (step 3).
- **S5b-07 · An asset whose task is set aside cannot be deleted** (review
  round 1, R1-01): the cloud sees a task through its asset and cascades the
  asset's delete onto it, so the delete is refused with the tasks named.
  Decided by S5b. Owner: Audrey (or delete them with it, named?).
- **S5b-08 · 0090's guard refuses a member's whole-row UPSERT that carries
  an unchanged set-aside stamp** (its INSERT arm reads NEW before ON
  CONFLICT); the UPDATE re-send passes. Harmless today: every S5b write
  strips the stamp. Owner: a schema session, if a client ever re-sends it.

**S5c (2026-10-05, the Budget half — `docs/sessions/handoffs/po-s5c-2026-10-05.md`).**

- **S5b-06 — CLOSED by S5c** (`20542394`): the Summary's versions table,
  its inline activate panel and every adapter write left `BudgetView.jsx`;
  every version write is the provider's mutators (one undo step each, no
  reload), and a source pin in `rabbitBudgetRender.test.jsx` holds it.
- **P1-32a, the Budget's half — CLOSED by S5c** (`04b0a4ce`): Crew/team's and
  Talent's period headers read the project's start through `dates.js` and
  step on the calendar (`views/budget/periodLabel.js`). The rest of P1-32a
  (ProjectAssetsView, NotesView, holidays.js, the Timeline's TODAY) is not
  S5's and stays open there.
- **S5c-01 · The Budget page has no Ctrl+Z for version steps.** Its only
  undo keys are the Expenses tab's, which undo the expenses' own history;
  the version steps raise the undo toast instead (`ctx.runWithUndoToast`).
  A Ctrl+Z on the Summary needs the waterfall's margin / contingency /
  agency edits (`ctx.updateProject`, no undo step today) to record their
  own steps first, or it would take back the last version step instead of
  the margin just typed. Owner: Audrey (walkthrough 55, question 4).
- **S5c-02 · The test data's bids were saved with the plain role rates**
  (no burden or overhead), the app's rate card adds them, so on the test
  data the locked Bid v2 reads "Now $115,215" against "Bid $96,013" after
  Reset to bidding. The app is right; the fixtures' snapshot rates differ.
  Owner: Audrey (rebuild them?), then a fixtures session.
- ~~**S5c-03 · The Timeline's version control, the help pages and walkthrough
  55's second half** are S5d's (steps 6 and 9).~~ — CLOSED by S5d (below).
- **S5c-04 · `deleteAssets` has R2-01's fault on the Local Server.** Its
  bulk delete is all-or-nothing only where the backend can restore
  (`restoreAsset`); the Local Server has none (its DELETE removes the row),
  so a bulk asset delete stopped part way has hard-deleted some assets
  while the rollback shows them, and no step is recorded. The fix is
  `deleteTasks`'s (S5c review round 2): record the ones that went
  (`err.deletedIds`), take them off the screen, push their step. Owner: a
  provider session (assets are outside S5's lane).
- **S5c-05 · An undo or redo replaying across a project switch pushes its
  entry onto the NEXT project's stack.** `undo`, `redo` and
  `undoHistoryEntry` (`RabbitProvider.jsx`) push back to
  `historyRef.current` after their awaits; a switch mid-replay
  (`clearHistory`) has replaced it, so the first project's entry lands on
  the second's redo (or, for a failed toast Undo, its undo) stack, and
  Ctrl+Y there replays the first project's ops by id. Narrow (a switch
  during a replay), found by S5c while working R2-07, not by a probe. Fix:
  capture the stack at the start and push back only while
  `historyRef.current` is still it — as `runBatch` has done since S5's
  R1-03. Owner: a provider session.

**S5d (2026-10-05, the Timeline half and the bundle's close — `docs/sessions/handoffs/po-s5d-2026-10-05.md`).**

- **S5c-03 — CLOSED by S5d** (`2f33d361`, `d5197073`, `126907f0`, and the
  review rounds' commits in the hand-off): the Timeline's bid version bar
  (the toolbar's second row, past the money gate only), viewing a version
  read-only as a span move, the lock greying the bar with its reason; the
  "Budget" and "Timeline" help pages; walkthrough 55's second half.
- **S5d-01 · `removeOrDelete`, `undo`, `redo` and `undoHistoryEntry` do not
  refuse while a replay still runs.** INFERRED from the code (S5d review
  round 1, R1-06; not run). S5c's round 2 (R2-03) made the version steps
  refuse once the queue's wait has passed with an undo still replaying;
  these four were left out. Past the wait, `removeOrDelete` (the Timeline's
  Delete while a version is open: Remove from this version) records nothing
  (its pushes drop while `suspended`), so the set-aside has no Undo and no
  toast; it still measures its toast from the top of the stack at the asking
  (`before`), so a redo queued ahead of it can be offered as its Undo; and a
  second Ctrl+Z past the wait runs its `finally { suspended = false }` while
  the first replay goes on, so the rest of that replay records entries of
  its own. What would settle it: S5c's R2-03 probe (a held
  `selectBudgetVersion`, `__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50`) with a
  Remove from this version, or a second Ctrl+Z, behind it. Fix:
  `refuseWhileReplaying` in the four, and `runWithUndoToast`'s marker in
  `removeOrDelete`. Owner: a provider session.
- **S5d-02 · The gantt's link writes, `addTaskLink` and `removeTaskLink`
  push their undo step with no visit check, and `addTeamAssignment` merges
  into whatever project is open.** INFERRED (review round 1, R1-07; worded
  by round 2, R2-09). `linkTasks`, `linkPhases` and `unlinkTasks` (the
  dependency drags), `addTaskLink` and `removeTaskLink` lack S5c R2-07's
  `visit` guard: a project switched mid-request gets the step on the NEW
  project's stack, and its Ctrl+Z deletes the first project's edge by id.
  `addTeamAssignment` pushes no undo step; it merges its row after its await
  with no visit check, so a switch mid-request puts the first project's
  assignment into the second's state. Fix: the guard `addAsset` and the rest
  have. Owner: a provider session.
- **S5d-03 · Grouped by scene, a viewed bid version is grouped by the LIVE
  active shot list.** INFERRED (review round 1, R1-08). `ctx.scenes`,
  `ctx.shots` and the toolbar's "Shot list:" label stay the live list's,
  while the version was based on its own (`shot_list_id`,
  `snapshot.shot_list`): a version based on another list shows its
  scene-linked tasks as not assigned, "linked outside the active list",
  under the live list's label. What would settle it: view a version whose
  `shot_list_id` is the archived Pickups list, grouped by scene. Fix: while
  viewing, group by that list's scenes and shots (`ctx.scenesOf` /
  `ctx.shotsOf`) and label it from the snapshot, or say in the bar which list
  the scenes come from. Owner: Audrey (which list should a viewed version's
  scenes come from?), then a Timeline session.
- **S5d-04 · The rate card can read as settled with the last workspace's
  rates for a moment after a backend switch.** INFERRED (review round 1).
  S5c's R2-02 resets the project's rates in render per project;
  `useRateCard` has no such reset per workspace, so once the new project's
  overrides land the old card can read `settled`, and a Save in that moment
  writes the old card's rates into the open version. Owner: a rates session.
- **S5d-05 · A task write still in flight when a version step starts can be
  named as that step's Undo, or join it.** MEASURED by S5d's review round 2
  (R2-03). Since R1-02 / R2-01 nothing on the Timeline can change while a
  version step runs, but a write already sent (a drag released a moment
  before Save) is not waited for, and `updateTask` is outside the history
  queue. A plain Save (no stranded rows) opens no batch, so the drag lands as
  its own undo entry; if the Save then FAILS having changed nothing,
  `runWithUndoToast`'s `offer()` sees an entry above its marker and raises
  "Stopped part way: Undo takes back what changed", whose Undo takes back
  only the drag — S5c R2-08's rule (nothing changed, no Undo named) broken.
  On a step that holds a batch (a Save that strands rows, the composites),
  `pushHistory` adds the drag to the batch, and the step's Undo takes it back
  too. It needs a write landing after the press: a slow connection. Fix:
  `offer()` names only an entry the step itself made (run the plain Save in
  `runBatch` and target that entry by identity, not `token > from`), and a
  step waits for the writes in flight (the provider keeps no count of them
  today). Owner: a provider session.
- **S5d-06 · Back at Current after looking at a version whose chart starts
  after the date you were on, the gantt is at that version's first day, not
  where it was.** MEASURED (`timelineWeekends.test.jsx`, "moved 300 days":
  parked on Mon 12 Oct 2026, a version whose chart opens Tue 1 Dec 2026,
  Current comes back on 1 Dec). Since round 1's R1-03 the look keeps a date
  on the version's chart (it came back 300 days late before); the date before
  the look is not remembered. Rare: the version must start more than the
  chart's six-month lead-in after the left date. Fix: remember the left date
  when a look begins and put it back at Current if the person did not scroll
  during the look. Owner: Audrey (walkthrough 55, question 22), then a
  Timeline session.
- **S5d-07 · Grouped by team, an emptied roster explains nothing.** MEASURED
  by construction (review round 2, R2-08). Round 1's R1-09 says "Assignee: no
  longer in the project" only once the roster has someone in it, because
  while it loads it holds no one; a roster READ and empty (a Local Server
  team emptied) is the same to it, so its assigned tasks sit under
  Unassigned without the sentence. `useRosterMembers`' `loading` starts false
  before the first fetch, so telling the two apart needs a "first read
  finished" flag there. Owner: a roster session.

**Still open from S5, the bundle as a whole** (each above, by its own
entry): S5-02 (bid versions are not broadcast — another window sees a
version saved, opened or deleted elsewhere only on its next load); S5c-01
(the Budget page has no Ctrl+Z for version steps — the toast is the way
back); S5c-02 (the test data's bids carry the plain rates); S5b-01 (the
project's budget amount and currency are shown to every member on the
Projects page); S5b-04 (once a version is opened, every client of that
project must be S5b or later). S5-03, S5-04, S5b-02, S5b-03, S5b-05, S5b-07,
S5b-08, S5c-04, S5c-05 and S5d-01 – 07 stand as written.

## Post-overhaul S4c (`po/s4c-files-explorer`) — left open (2026-10-06)

S4c built Audrey's first beta report on the Files tab (walkthrough 56): the
Table as an explorer (one folder at a time, a crumb bar, Backspace goes up,
the search box reaches the whole tree), shot folders inside their scene's
folder with a one-time, offered re-filing on every backend, and files on
levels and experiences. The overhaul review's flat list (F-R12, the long
note that was above `TableView`) is superseded at her word; the Location
column lives only in a search now. Questions for Audrey are in walkthrough
56 §5, not here.

- **S4c-01 · A shot folder is never re-filed for a body in the customer's
  own bucket (s3).** The cloud move needs copy-then-delete through presigned
  URLs, which the s3 provider does not have (S44 left its display for its
  own session too); `refileShotFolders` leaves such a shot where it is and
  names it ("… is in your own bucket, which cannot be moved from here yet").
  No s3 workspace exists on any environment to build or verify it against.
  Owner: the s3 session, when one is scoped.
- **S4c-02 · A private project's shot bodies move only from the desktop
  that holds them.** Their bodies live under the desktop's local media root
  (storage_provider `local_server`); the cloud adapter moves them through
  the desktop's new `POST /api/rabbit/local-media/move` and, off the desktop,
  leaves the shot with the reason ("… run this from the desktop app there").
  By design (A9's private-project rule), recorded so the beta's words are
  expected. Owner: none.
- **S4c-03 · A live file whose object is missing from storage holds its shot
  folder back.** The re-filing checks every file of a shot BEFORE its first
  object moves (review round 1) and leaves the shot where it is while one of
  its live files is "missing from rabbit-files": the rows would otherwise
  describe a file nowhere. The way out is to delete the dead row. A file in
  Recently deleted is invisible to the client (`files_select`, 0014), so its
  body keeps its old key — which still works after a restore (the key is a
  key; the third segment `shots` is not gated). Owner: Audrey, if it ever
  shows; the sentence names the file.
- **S4c-04 · A shot moved to another scene keeps its folder where it is.**
  Nothing in the Scenes tab changes a shot's scene today (measured: no
  writer of `scene_id` on a shot), so there is no surface for it; if one
  comes, its folder should move with the same verified move primitive the
  re-filing uses (`refileOneShot` / `refileOneShotRow`), never a bare row
  update. `ensureEntityFolder` deliberately keeps an existing folder's
  parent on every backend. Owner: the session that adds the control.
- **S4c-05 · The cloud rehearsal was the database half only.** The spawned
  session has no signed-in cloud session (`VITE_DEV_AUTOLOGIN=tester` skips
  sign-in with no session; the credentialed variant needs a test account's
  password this machine does not hold), so the Storage API's `move` itself
  was not called against wilson-dev. What was proven there, in a rolled-back
  transaction as Northwind's manager: the policies admit every step (the
  scene's folder row, both buckets' object rows renamed to the nested key,
  the files row, the folder row), and refuse a reviewer and a person with
  no seat. The API's move is that UPDATE plus a copy in the store, under the
  same policies (S4b-10 measured the same UPDATE for a money-cleared
  person). Owner: Audrey — the first run on staging's one project is the
  first real move (walkthrough 56 §2 says what to look for); S5 lists the
  four shots.
- **S4c-06 · The Local Server re-filing was not run in Electron.** It is
  replayed on a real temp directory with the shipped functions lifted out of
  `main.cjs` (`desktopShotRefiling.test.js`: the directory move, the
  entry-by-entry merge, the never-overwrite refusal, the verify-then-rewrite
  order, the empty SHOTS tidy, the rows-only path). Not opened on Audrey's
  screen. Owner: Audrey's next desktop run (walkthrough 56 §2, the Local
  Server steps).
- **S4c-07 · `FileManager` re-rendered without end when mounted with no
  files** (`files = []` as a default and `ctx?.files || []` each made a new
  array per render; the signing effect depends on it and sets state). Fixed
  in S4c with one shared empty array; the asset, scene and shot popups never
  hit it because they always passed the provider's list. Recorded because
  the shape (a default-argument array in a memo chain) exists elsewhere.
  Owner: none; a sweep for the pattern is a cheap future task.
- **S4c-08 · The fixtures' default dataset stands for a project from before
  S4c.** Its sixteen shot folders sit under SHOTS and two shot files with
  them, so the offer shows on first open and the walkthrough's move has
  something to move; the fixtures adapter re-files them in memory. A test
  that wants the nested layout re-files first (`shotRefiling.fixtures.test.js`
  shows how). The fixtures' keys are path-based
  (`…/projects/<pid>/<folder path>/<name>`) where the cloud's are id-based
  (`projects/<pid>/scenes/<sceneId>/<shotId>/<leaf>`); the fixtures adapter
  rewrites by path, so a test of the cloud's key shape belongs in
  `shotRefilingCloud.test.js`, not the fixtures. Owner: none.
- **S4c-09 · A move that stops between an object and its row leaves one
  file the next run must find.** On the cloud each file's row is rewritten
  at once after its object is seen at the new key, so the window is one
  round trip per object; `storage-gc` now keeps an object whose twin key a
  row names (`_shared/shotKeys.ts`), and the next run counts the object
  landed and rewrites the row. On the Local Server the directory moves in
  one step and every record is retargeted at once, but the bundle is
  written after the shot, so a crash in between leaves records saying the
  old place until the next run (which finds each file at its new place and
  counts it done) — unless the shot was RENAMED in between: the next run
  then looks under the shot's new slug, finds no record there, re-parents
  the row, and the records still say `SHOTS/<old>/`, a folder that no
  longer exists; the files are at `SCENES/<scene>/<old>/`, where the relink
  census finds them (review round 2). On the cloud, a row that could not be
  rewritten and could not be read back is left where it landed, said with
  "run it again", and the next run counts it landed. A journal written
  before the move would close every window for good. Owner: a future
  session, if a stopped move ever shows in the beta.
- **S4c-10 · `storage-gc` must be deployed for the twin-key guard to hold.**
  The Edge Function's orphan scan deleted any `rabbit-files` object no row
  named once it was 24h old — exactly what a stopped move leaves. The code
  on this branch asks the files table for the other shape of a shot key
  before it deletes (one query per unreferenced object only), counted as
  `skipped_twin`; pinned by `storageGcShotTwins.test.js`. Nothing deploys
  Edge Functions from a session: `supabase functions deploy storage-gc`
  on staging, then prod, by Audrey. Until then the walkthrough says to run
  the move with the app open and the network up. Owner: Audrey.
- **S4c-11 · On the Local Server a rename moves the folder ROWS, never the
  directory.** As before S4c for every entity (the PATCH route's note: the
  old directory is left with whatever is in it, and a managed record stays
  with its file). Since S4c a renamed scene re-paths the rows under it
  (walked by `parent_id`, finished on any later ensure if a pass stopped),
  so no row says a path its parent no longer has — but the directories and
  the records keep the old scene's name on disk, as they always did. The
  Files tab places such a record by its ENTITY when its `folder_path` names
  no row (`fileTree.js`, review round 2: before that fix a renamed scene's
  shot files fell to the project root), and the stream route and Show in
  folder read the record's own path, so everything still opens; a new
  upload to the shot lands in the NEW directory, so one shot's files can sit
  in two directories until someone moves them by hand. Moving the directory
  and the records on a rename (as the asset route does) is one change on
  each backend. Owner: a session that takes renames.
- **S4c-12 · Two runs of the move at once are NOT safe against each other.**
  One tab runs one move per project at a time (`refilingNow` in the
  adapter), and a second tab or a second person meets the same checks per
  object — but in one narrow window they can undo each other's step on one
  file (review round 2: A's row update fails without committing; B counts
  the object landed and sends its own update; A reads the row before B's
  commit, sees the old key, and moves the object back; B's update then
  commits the new key — a row naming a key the object is not at, which only
  A's result mentions, as an update error). A lock row in the database, or a
  `pg_advisory_xact_lock` in a function that does the row writes, is the
  answer; until one exists, run the move from ONE place (walkthrough 56
  says so). Owner: a session that takes the lock, before a team of two
  runs it.
- **S4c-13 · The create form holds while its files are added.** A level or
  experience made with files picked in the form is created, then its files
  are added one by one with the button naming each (*Adding <file> (i of
  n)…*) and a line saying the dialog closes when they are all added; Cancel,
  Escape and the backdrop wait. A multi-gigabyte copy on the Local Server is
  minutes of that with no way out but to wait (review round 2). The fuller
  answer is to close the form once the row exists and hand the files to the
  entity's FileManager, which has per-file progress. Owner: a session on
  the entity popups.
- **S4c-14 · A build from before S4c, still open during a deploy, can put a
  moved shot's row back under a SHOTS path.** Its `ensureEntityFolderWith`
  wrote `path: SHOTS/<slug>` on a shot rename (its planner knew no nesting)
  without touching `parent_id`, and kept uploading under `shots/<id>/`.
  Since review round 2 the next ensure by a current build walks the scene's
  rows by `parent_id` and puts the path right; the upload's old prefix is
  what the offer is for, and the offer returns. Owner: none (deploy windows
  only).

## Post-overhaul S4d (`po/s4d-legal-gate-managers`) — left open (2026-10-09)

S4d gave Legal files a gate of their own (migration 0092,
`can_access_project_legal`: the money gate OR a workspace manager, with
0037's workspace hop and 0072's privacy arm), re-pointed every closure 0088
had made through the money gate, and — Audrey's Legal 1 — made a deleted
file's record follow the file's gate for invoices and Legal files alike.
Money is unchanged and pinned (0092's post-condition 12). Questions for
Audrey are in walkthrough 54 §6 and the S4d hand-off, not here. S4b-10 and
S4b-11 are untouched and still hers.

- **S4d-01 · The eight money storage policies carry no private-project hop
  of their own, so a project manager who did not create a private project
  can read its invoice OBJECTS while its rows are hidden.** PRE-EXISTING
  (0042 / 0053 / 0072). INFERRED from the policy text while 0092 copied
  0072's arm into the Legal predicate: `rabbit_files_money_select` and its
  seven siblings are `bucket … AND rabbit_money_segment(seg) AND
  can_access_project_money(project)`, with no `EXISTS (SELECT 1 FROM
  projects p …)` hop — the eight BASE policies have one, which is how a
  private project's ordinary objects follow projects_select. The money
  predicate is SECURITY DEFINER and reads projects with RLS bypassed, so for
  a project_members row with project_role = manager on a private project it
  answers true whoever created the project. The ROW is hidden (files_select
  hops), and such a seat can only be placed by someone who can already see
  the project; the MANAGER leg 0092 added does carry the privacy arm
  (inside can_access_project_legal, suite 95 §H), while the predicate's
  money half is the money gate called as it is — so a non-creator holding a
  manager seat on a private project reaches its Legal objects through the
  money half exactly as it reaches its invoice objects (S4d review round 1,
  finding 9). Would settle it: seat a second manager on a private project
  and read `storage.objects` under `projects/<id>/INVOICES/` as them. Fix:
  the hop in all eight money policies, or `passes_project_privacy` inside
  can_access_project_money (0037's body is pinned WHOLE by 0092's
  post-condition 12 and suite 95 probe 167; both move with it). Owner: a
  session on private projects, with Audrey's nod (it narrows the money gate
  for a non-creator manager).
- **S4d-02 · `edit_history_select` has no private-project arm, so every
  workspace admin and manager reads a private project's ordinary edit
  history.** PRE-EXISTING (0012 / 0072). INFERRED from the policy text while
  0092 restated it (S4d review round 1, finding 10): the policy is workspace
  + app role admin/manager + membership + the money / Legal arms, with no
  hop through `projects` and no `passes_project_privacy`; `edit_history`
  rows carry `project_id` only for `files` entries (0088), so a hop would
  need the column for every entity type first. A private project's money
  rows are already the money audience's and its Legal rows the Legal
  audience's (the arms); what is open is the rest — a task's or scene's
  history, with names and notes in the diff. Would settle it: read
  `edit_history` for a private project's task as a workspace manager who
  did not create it. Owner: a session on private projects.
