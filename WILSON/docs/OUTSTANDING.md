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

Entries closed by 2026-10-27 were moved, verbatim, to `docs/archive/OUTSTANDING_CLOSED_2026-10-27.md`.

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

### The TPN re-audit of 2026-10-28 reports eleven High in the file gateway, bins, own storage and the AI file store
**MEASURED (from the code; R2, 2026-10-28; report only, nothing changed).** `docs/sessions/PLAN_TO_1_0.md` §0 item 4 holds the
controller's production steps until "the TPN re-audit reports nothing High". It reports eleven (`TPN_AUDIT/SUMMARY.md`, *Release
gate*), each with its file and line and a fix shape in `TPN_AUDIT/FINDINGS.md`. Eight are the areas' own defects: TPN-AUTH-012 (a
member's catalogue row makes the file gateway serve any file on the share), TPN-NET-016 (the bucket test and the storage-gc drain
fetch an admin's S3 endpoint with no private-address refusal, following redirects), TPN-ENC-015 (the bucket-secret and AI-key
master secrets are the same on all three environments), TPN-ENC-014 (the gateway's keys and credential in plaintext in its
container, and on Windows after a DPAPI failure), TPN-CONT-018 (a teardown leaves bin posters behind its certificate), TPN-ENC-013
(the office door's certificates name private addresses), TPN-ENC-016 (the gateway's root key lives ten years, and its release key
has no successor), TPN-AI-009 (staging's and production's pre-FX12 AI uploads, closed only by the release's own steps). Three are
the areas' own instances of open classes: TPN-AUTH-013 (the outside switch, the gateway's admin calls and the bucket settings skip
the two-factor step-up), TPN-CONT-019, TPN-AI-011 (ai-files falls back to the platform key when a company's own key fails). Her G6
and D14 make TPN-LOG-012 and TPN-SDLC-014 INFO, outside the gate. Phase 8 of `TPN_AUDIT/REMEDIATION_PLAN.md` is the work. →
**Audrey's ruling, per finding** (walkthrough 85, Q1 and Q2, which propose that her ruling stand for "nothing High"): fixed before
1.0, or accepted for 1.0 with the reason written into the finding.
**→ Q1 ruled on 2026-10-28** (Audrey, in chat, verbatim): *"(a) — one session fixes the other seven before the release (Phase 8),
and I accept TPN-AI-009 for the start of the production steps, since it closes at the runbook's (c) and (g) 17 before 9 November."*
TPN-AUTH-012, TPN-NET-016, TPN-ENC-015, TPN-ENC-014, TPN-CONT-018, TPN-ENC-013 and TPN-ENC-016 are fixed before the release by one
session on Phase 8, which the controller names (`docs/sessions/PLAN_TO_1_0.md` §5 rule 8); TPN-AI-009 is accepted for the start
of the production steps, her words in its block. **→ Q2 ruled the same day** (multiple choice, verbatim: *"(a) Count and fix them"*):
TPN-AUTH-013, TPN-CONT-019 and TPN-AI-011 stay counted and are fixed by the same session, ten in all; she named neither near case,
so both stay uncounted. The runbook's (g) 8 now waits for that session's merge.
**→ P8 fixed the ten, 2026-10-28 (night 5; `po-p8-2026-10-28.md`):** each RESOLVED in `TPN_AUDIT/FINDINGS.md` with its evidence;
0104 to 0106 with suites 107 to 109 and ten functions on wilson-dev (staging owes them, the runbook's (b) and (c)); the gateway's
changes as code and tests for its next release. What remains is the controller's (TPN-ENC-015's rotation on each environment,
runbook (d)) and hers (TPN-ENC-016's successor key, (g) 4). The gate reads **0 Critical, 1 High (TPN-AI-009, accepted)**, so (g) 8
waits on that merge no longer.

---

## Broken features

### Budget's Expenses: the *Linked task* filter calls every task "Untitled", and the saved views go stale after a project switch
**INFERRED (VW1's research, 2026-10-13; from the code).** The filter's task
values read `t.name`, which tasks do not have (they have `title`). The
expense views' key is per project but the list is read once when the tab
mounts; a project switch from the context bar keeps the tab mounted, so the
menu lists the previous project's views and the next save writes them under
the new project. Ruled for later (VW1's Q19, Q21).

### Grouping Tasks by Phase or Assignee drops a task whose value is not in the project's list
**INFERRED (VW1's research, 2026-10-13; from the code, not measured).** The
Tasks table's `groups` builds one group per asset, phase or project member
plus *Unassigned*; a task assigned to someone not staffed on the project (or
pointing at a phase or asset the project no longer lists) lands in no group
and vanishes from the grouped table while the count still includes it.
Would settle it: assign a fixture task to a person outside the project,
group by Assignee. *(2026-10-16, VW1m: grouping by Asset no longer drops
one: a task sits in the group of its combination of assets, or in No asset.)*

### Under a minimum font size the tables' dates are cut again, the calendar over the year
**MEASURED (FX10 review round 1, R1-07, 2026-10-13; re-run by the session).**
Firefox 157 at 1280x700 with `font.minimum-size.x-western` set to 16 (its
Settings → Fonts → Minimum font size, an accessibility setting), the Tasks
table on the dev fixtures, measured by the reviewer's copy of
`scripts/fx10-date-fields-shots.mjs` (an option writes the preference into
its throwaway Firefox profile; not in the committed script) and run again
by the session with the same numbers: the date fields' 13px text
is drawn at 16px, so a set date needs 142px and the empty
`mm / dd / yyyy` 146.2px against the 132px the field has in its 144px
column. The last 6.5px of a set date and 11px of the empty pattern are
cut under the calendar button, 3px from it: her `09 / 26 / 202` again.
The task window's wide fields stay whole. FX10's floor is a fixed
`--date-room: 120px` tuned to the 13px text, and every table column is
in px, so neither grows with a minimum font size; at the default size the
dates are whole in all three engines measured (walkthrough 71). Not a
regression: before FX10 these fields were cut at the default size too.
Chromium's own minimum font size (chrome://settings/fonts) was not
measured; the desktop app sets none (no `minimumFontSize` in its
`webPreferences`). Fix shape: the room in em of the field's own font
(about 9.25em) with the tables' date columns derived from it — which
turns FX8's no-sideways-scroll arithmetic at 1280 into a font-dependent
one — or a font-relative layout for the tables as a whole. Owner: the
kit's date floor (`src/index.css`) and the tables' lanes.

### The project control panel's 24 fields have no accessible name
**MEASURED (FX10, 2026-10-13; review round 1's R1-12 named the two
dates).** On the dev fixtures (Salt Hours → Summary → Control panel), read
in the page: all 24 of the panel's inputs, selects and its textarea —
Project name, Client / Studio, Description, Status tag, Director,
Producer, Project code, Status, Type, Tier, Start date, End date,
Currency, the four budget figures, Actuals column mode, Number of
columns, Scene digits, Shot digits, Separator, Numbering start, Frames
per second — have no `<label>` (`labels.length` 0), no `aria-label`, no
`aria-labelledby` and no `title`. `ProjectSummaryView`'s `SettingsField`
draws its words as a `<span>` beside the control, so a screen reader
announces a field by its placeholder where it has one ("PROJ" for
Project code) and otherwise by nothing but its role and value (review
round 2 read Chromium's own accessibility tree: each date has the role
"date" and an empty name). Older than FX10, outside its diff. Fix shape:
`SettingsField` renders a `<label>` around its words and control (the
kit's `Field` does), or gives each control an `aria-label` from its
words. Owner: the Summary lane (`ProjectSummaryView.jsx`).

### In the smallest desktop window, an open task form leaves a shot's take notes no room
**MEASURED (FX10, 2026-10-13; found by the measuring script's pass over
every control in a date's window, review round 2's R2-04).** On the dev
fixtures at 1024x700, Salt Hours → Scenes → Shots → *The door* → Add new
task: the shot window's main column falls from 594px to 260px beside the
form, and each take row — its number (16px), its poster (72px) and its
buttons (148px) — leaves the note's `flex-1` box 0px: the note field is
18px wide, its words ("Keep for the trailer.", or the placeholder "Why
this take…") unreadable and hard to click. The same with the date floor
taken out in the page, so it is older than FX10 and not its CSS. With the
form closed the notes are 248px at 1024; at 1280 and 1440 with the form
open the same pass found their words whole. Fix shape: let a take
row put its buttons under the note below a width, or give the note a
minimum and let the row scroll. Owner: the Scenes lane (the shot window's
takes in `ScenesView.jsx`, beside `RelationsPanel.jsx`'s side form).

### On a touch screen the row checkboxes and the Assets cards' buttons stay invisible until tapped
**MEASURED (FX8 review round 2, R2-09, 2026-10-12; Chromium with touch
emulated, `hasTouch: true`, which makes `(hover: none)` match).** FX8-KR-2
shows the kit's HoverActions at rest on a screen that cannot hover; four
lane-drawn reveals are not HoverActions and still wait for a hover or a
focus: the row checkboxes `.rb-task-check`, `.rb-asset-check`,
`.rb-ent-check` and `.rb-budget-check` (`opacity: 0` until `:hover` /
`:focus-within` / ticked), and in `ProjectAssetsView.jsx` the row's Remove
thumbnail and the gallery card's Open and picture buttons, which React
mounts only while its `hovered` state (`onMouseEnter`) is set. On a phone or
a tablet they are invisible, and the checkboxes tappable unseen. Older than
FX8. Fix shape: the four checkbox reveals in the same `@media (hover: none)`;
the Assets card's and thumbnail's buttons drawn always and revealed by CSS
(the kit's HoverActions) instead of mounted on a mouse event.

### Under forced colours (Windows High Contrast) a status dot is painted out, and every kit tab is underlined
**MEASURED (FX6, 2026-10-12, in Chromium's emulation of forced colours,
Playwright `forcedColors: 'active'`, on the test data, port 5294).** Two kit
marks lose their meaning under a High Contrast theme:
- **The status dot** (`.ui-status-dot`, `src/index.css`) is a filled box
  whose colour is a `background-color`, which forced colours repaint in the
  canvas colour: measured `rgb(255, 255, 255)` on the white palette and
  `rgb(0, 0, 0)` on the black one, the same as the ground, so the dot is
  gone. Beside a word (the badge, the popups' status banner, the Items
  table) the word still says the status. Where the dot stands ALONE the
  status is lost to a sighted High Contrast user: INFERRED from the code
  (not opened under forced colours), a
  project's card in the Summary gallery (`ProjectSummaryView.jsx`,
  `<StatusDot status={st} />` beside the title, no status word) and the
  item picker's rows (`components/RelationsPanel.jsx`, `rb-rel-pick-row`:
  the dot and the item's name). The Dashboard cards' 3px status edge
  (`.dash-card-edge`, a stretched StatusDot) is the same box: INFERRED to
  vanish the same way.
- **Every kit tab is underlined** (`.ui-tab`): the unselected tab's
  `border-bottom: 2px solid transparent` is repainted in the text colour,
  so the selected tab's underline no longer tells it apart (measured on the
  task window's files Table / Gallery: both `2px rgb(0, 0, 0)`; visible in
  `docs/sessions/handoffs/img/po-fx6-forced-01-task-1440x900.png`). The
  selected tab's heavier word still does.

Not FX6's code (FX6 measured them while checking its own line, which stays
3px in the text colour there). Settle it with one
`@media (forced-colors: active)` block in the kit: the dot drawn in a
system colour (say `background-color: CanvasText`, or a `forced-color-adjust:
none` that keeps the tone) and `.ui-tab:not([data-active="true"])` given
`border-bottom-color: Canvas`; then re-measure in the emulation and on a real
Windows High Contrast theme, which no session has tried. Found by FX6's
review round 1 (R1-04).

### The Tasks table's Bid days field hides a figure's first characters behind the browser's arrows
**MEASURED (FX1, 2026-10-12).** Playwright on the dev fixtures at
1440x900, the browser's spinner read through the DevTools protocol (the
input's user-agent shadow root). `ProjectTasksView`'s bid-days cell
(`rb-task-cell-number`, an `<input type="number">` in 13px Geist Mono,
7.8px a character) is 52px with 6px of padding a side, and the browser's
spinner takes 15px of the 40 left: the figure has 25px, three characters.
**12.5** reads **2.5** while the field is focused (the spinner shows and the
figure scrolls to its end); pointed at, it reads **12…** with the spinner
beside it; at rest the lane's ellipsis reads **120.5** as **12…** (FX1's
review round 2 corrected "or pointed at"). The same defect as the shot's frame count that
FX1 fixed (walkthrough 64), outside FX1's brief (the shots table and the
shot popup). FX1's `views/scenes/NumberField.jsx` — the spinner put away,
the field's own chevrons in room its padding keeps, an ellipsis past five
figures — is the fix shape; serving this field means promoting it to the
kit (FX1's hand-off, kit request FX1-KR-1). Owner: the Tasks lane
(`rabbitTasks.css`, `ProjectTasksView.jsx`).

### A held number field fills R.A.B.B.I.T.'s undo history: holding for a second leaves nothing earlier to undo
**MEASURED (FX1 review round 2, R2-08, 2026-10-12).** Every step of a held
chevron on a Scenes number field is one `updateShot` write and one undo
entry (`RabbitProvider`'s `pushHistory`), and the history keeps
`HISTORY_CAP = 10`. With the field's chevrons at their round-one pace (13
steps in 1.5 s) ten Ctrl+Z took a held 2000 → 2013 back only to 2003, and
the two edits made before the hold (another shot's frame count, and this
one's) could no longer be undone; at the pace FX1 shipped, the browser's
own (24 steps in 1.5 s, measured by `scripts/shot-number-fields-shots.mjs`),
a hold of 0.7 s fills it (the press, the first repeat at 250 ms, then one
every 50 ms). The browser's spinner did the same before
FX1, at that same pace: not a regression, and not FX1's to change. Fix
shape: coalesce consecutive `updateShot` entries for the same shot and key
in `pushHistory`, or run a hold inside `runBatch` so it is one undo step.
Owner: `RabbitProvider.jsx` (the undo history).

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

### ~~The desktop→cloud migration does not carry budgets, expenses, levels, experiences, the team or links on tasks yet (part 2)~~ — CLOSED for part 2 (M2, 2026-10-28); the team is night 5's (M2-L1)
**Closed by M2 (night 4, `po/m2-migration-part-2`), MEASURED:** every part-2
row shape was rehearsed on wilson-dev first, rolled back, and the runner
carries each through the cloud's columns — the bid versions after the shot
lists, the lines, the actuals on them, the expenses and the role rates behind
the money gate, then the project's locked and open bid versions by UPDATE
(each only to a version this run carried for this project); the levels and
experiences before the assets, folders, files, a task's items and the
groupings that name them; the links on tasks through the project's tasks.
Pinned by the round trip in `runMigrationBins.test.js` (M2), the handbook's
§3.1 table says what each key becomes. Night 5 (M3) carries what is left:
M2-L1 below. The entry as it stood:
**INFERRED (BC3, 2026-10-09); narrowed by M1 (2026-10-27, night 3 of
`docs/sessions/PLAN_TO_1_0.md`), which carries the key dates, comments, shot
lists with their items and edits, and folders.** The runner copies projects
(through the cloud's columns since M1 — until then every desktop project row
was refused whole: MEASURED on wilson-dev, rolled back, 42703 on
`documents`), phases, assets, tasks, the two edge tables, files (each filed
in its folder since M1), scenes, shots, bins, footage locations, clips,
takes, a task's items, saved views and groupings, and since M1 the
milestones (key dates), comments, `shot_lists`, `shot_list_items`, `edits`
(the active list and the archived ones through 0084's functions) and
`folders`. It does not copy `budgetVersions`, `budgetLines`,
`budgetActuals`, `expenses`, `projectRateOverrides`, `levels`,
`experiences` — nor what names them: a task's items about them, an asset's
links to them, their folders, the groupings of them — `teamAssignments`,
`projectTeam` or `taskLinks`; nor a project's locked and open bid version
pointers (`budget_active_version_id`, `open_budget_version_id`: the cloud's
foreign keys refuse an id it does not hold, which refused the whole project
— MEASURED, 23503 — so the project goes up without them). The report names
each as part 2's (`NOT_CARRIED`, its `part2` flag; the panel's "Stays on this
computer for now (part 2 of the migration carries it)" line), apart from what
no migration carries (M1-L1, M1-L2 below), before the archive is offered.
Settle it with part 2 (M2, night 4). Fix shape: the budget tables in their
order (versions, then the project's two pointers set, then lines, actuals,
expenses, overrides), the levels and experiences and then what names them,
the team, and the links on tasks, each after its parents, ids kept.

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
U+202E and watch it land. Fix shape: a migration (the next free number, 0107
at P8's merge; 0094 was retired on 2026-10-28, walkthrough 85 Q5) adding the
same refusal to the CHECK through a small SQL function (PostgreSQL's regex
has no Unicode-property classes; the function tests the code points), and
the adapter's `BINS_REFUSALS.locationShape` sentence already covers it.

### ~~A second desktop→cloud migration brings back rows a teammate removed from the cloud~~ — CLOSED by M2's record (2026-10-28), narrowed to rows a build before M2 carried
**Closed by M2, the fix shape below, MEASURED by the round trip:** each run
adds the ids it carried to a record kept in the project's bundle on this
computer (`cloudMigration`, per workspace, through the desktop's route
`POST /api/rabbit/projects/:id/cloud-migration-record`, written as rows land,
never before), and a later run — and the dry run — never inserts an id the
record holds: one the cloud no longer shows is counted, named and said
(`REMOVED_SINCE_LAST_RUN`), whether a teammate removed it for good or into
the trash. `runMigrationBins.test.js` "M2: a second run brings back nothing
a teammate removed": run, remove a budget line, a level, a task, a clip, a
key date and a link on a task in the fake cloud, run again — none comes back;
red without the record (its CONTROL). **What remains (narrowed):** a row a
build before M2 carried has no record, so the first M2 run brings it back if
a teammate removed it; and the last rows of a run that stopped part way are
recorded by the next run, which finds them there (a removal in between brings
one back). Settle the first by migrating with M2 from the start. The entry as
it stood:
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
desktop's copy once everything is in the cloud. **M1's kinds (2026-10-27,
read from 0014, 0067, 0084 and 0041, pinned by the round trip in
`runMigrationBins.test.js`):** a key date or a comment removed in the cloud
is soft-deleted and keeps its id, so a second run skips it (a key date is
checked against the trash's own index, `milestones_trash_index`; a comment
meets its key, 23505) and does not bring it back — nor does it for a project,
phase, asset, task or file, soft-deleted the same way (0014), while the row
is in the trash; a shot list or an edit is never deleted (archived), and a
second run neither adds it again nor changes its archive (one a teammate
restored stays restored); a list item, a task's item, a folder, a saved view,
a grouping or a task or phase link removed in the cloud is gone for good (none
of their tables has a trash; 0014 and 0061 keep the link tables hard-delete),
so a second run puts it back, as it does BC3's scenes, shots, bins, clips and
takes; and a row in the trash comes back once the trash is emptied (0014's
`purge_soft_deleted`, nightly, after 30 days). Review rounds 1 and 2 listed
them; Migrate's Done hover and Help name each.

### The cloud keeps no sample rate or channel count on a clip
**INFERRED (BC3 review round 1, 2026-10-09).** The desktop's probe writes
`sample_rate` and `channels` on a clip (`electron/rabbitBins.cjs`, the
probe route) and the inspector shows them (`BinInspector.jsx` `TechRows`,
the Audio line); 0091's `bin_files` has no such columns and the cloud
adapter's `BIN_FILE_COLUMNS` drops them, so a clip added from the desktop
signed in, or migrated, shows no Audio line in the cloud. The migration
strips them before `toColumns` so the console is not warned once per clip.
Fix shape: two nullable columns on `bin_files` (the next free number, 0107
at P8's merge; 0094 was retired on 2026-10-28, walkthrough 85 Q5), the
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

### In cloud mode an O.T.T.E.R. import of a lesson, or of an export made in local mode, saves nothing
**INFERRED from code reading (the N2b design session's review round 2,
2026-10-27); not yet measured.** `handleImportFile` in
`src/tools/otter_v0.3.1/Otter.jsx` (the `data.lesson` branch, and the v2.0
branch for each `sw` of an export) creates the course with `POST /api/software`
and then posts every subject to `/api/software/<slug>/subjects`, where `<slug>`
is a slugified name (`data.lesson.software_or_language` slugified, or
`sw.meta.slug` as the export carried it). In cloud mode a course's `slug` on
the wire is its row id (`toCourseWire` in `supabaseOtterAdapter.js`), so
`subject.save` runs `.eq('course_id', '<slugified-name>')`, Postgres refuses
the non-uuid (22P02) and `unwrap` throws; no import call site checks `res.ok`,
so the import closes as if it had worked while nothing was saved. When the
course already exists, `course.create` dies first on the owner-slug unique
index (23505), unchecked too. Only a same-workspace re-import of an export made
in cloud mode (whose `meta.slug` is the id) reaches a course. Fix shape:
resolve the slug through the course list the import already reloads
(`softwareList`, by name or by the export's id) before posting subjects, and
check `res.ok` on each post. Found while placing the subject-share reminder
(`docs/design/OTTER_SUBJECT_SHARES_DESIGN.md` §5.9: the reminder cannot fire
from these imports until this is fixed); settle it with one lesson import on
the beta.

### In the company library the subject delete confirm says "permanently", and a delete there is the 30-day trash
**MEASURED by reading (B2, 2026-10-27).** `renderDeleteSubjectConfirm` in
`src/tools/otter_v0.3.1/Otter.jsx` says *This will permanently remove this
subject and its lessons. This cannot be undone.* in every mode; in cloud mode
`subject.delete` (`supabaseOtterAdapter.js`) calls `otter_soft_delete_row`,
so the subject goes to Recently deleted for 30 days. The course delete
confirm was corrected for exactly this in Session 11 (its comment says so);
the subject's never was. B2 adds, for a subject with live shares, the
design's *Shared with N people: the link stops for them while it is in the
trash and ends when it is purged.* under it, so the dialog now names the
trash in one sentence and denies it in the one above. Fix shape: the course
confirm's cloud-mode wording for the subject. Outside B2's list; walkthrough
84, B2's Q2.

### While a linked subject is open, the pet has no lesson to read and is not told it is read-only
**MEASURED by reading (B2 review rounds 1 and 2, 2026-10-27).** The agent's
context (`src/agent/AgentProvider.jsx`) reads the subject only when
`activeSubjectSlug` is set, and `Otter.jsx` sets it to null while a LINKED
subject is open (its slug may be the host's own subject's, so the client
identifies it by `link:<subject_id>`, design §5.5); B2 withholds the lesson
id then too (alone under the host course, `lesson_1_1` would name the host's
own lesson of that id). So for a linked subject the pet is handed the host
course and nothing of the subject: it cannot answer about the lesson on
screen as it can for an own subject, and the design's "the agent is told the
subject is read-only" (§5.4) is true only by that omission. Every write is
refused while a link is open (`applyChange` throws, for the host's own
subjects too, since the agent's target names a slug the two can share; the
database would refuse a write to the link anyway). Fix shape: pass the open
link to the agent's context (`activeSubjectKey`, or a linked flag the
provider reads) and let `getContent` serve the open body. `AgentProvider.jsx`
is outside B2's table (design §6.2), so this is recorded, not changed.

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

F4 (2026-11-13): each write is a render of App. Since F4 that renders the shell
and no page (the pages are under `React.memo`); before, it rendered every page.

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

### Avatar does not persist
**REPORTED; root cause still unproven; narrowed by measurement (B1, 2026-10-27).** S21 falsified four hypotheses by
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
**What B1 measured on wilson-dev, by query (2026-10-27):** the four
`user-avatars` policies on `storage.objects`, read from `pg_policies` — INSERT
`user_avatars_insert_own` WITH CHECK `bucket_id = 'user-avatars' AND
auth.role() = 'authenticated' AND (storage.foldername(name))[1] =
current_workspace_id()::text AND (storage.foldername(name))[2] =
auth.uid()::text`; UPDATE `user_avatars_update_own` with the uid arm in its USING and both
path arms in its WITH CHECK;
DELETE `user_avatars_delete_own` on the uid arm alone; SELECT
`user_avatars_select` on the bucket alone — the bucket public, 2 MB, four image
MIME types; and `current_workspace_id()` is
`NULLIF(COALESCE(current_setting('request.jwt.claims', true)::jsonb #>>
'{app_metadata,workspace_id}', ''), '')::uuid`. The client writes
`user-avatars/{workspace_id}/{user_id}/{ts}-{name}` (`ProfileSection.jsx`,
`NewUserWelcome.jsx`): exactly the two folders the policy reads, so a
path-shape mismatch is excluded, and the SELECT side is not involved. What
remains is one candidate: the INSERT and UPDATE policies evaluate to NULL, and
the upload is refused, exactly when the Storage API's `request.jwt.claims`
carries no `app_metadata.workspace_id`. Not measured by B1: the smoke user's
password is a CI secret (`DEV_PROBE_PASSWORD`) and no local file holds it, so
no session can sign in to send the one request that settles it. **The
capture:** as the seeded smoke user on wilson-dev, `POST
/storage/v1/object/user-avatars/<workspace_id>/<user_id>/probe.png` with a
one-pixel PNG, the bearer token and the anon `apikey` (the exact command is in
`docs/sessions/handoffs/po-b1-2026-10-27.md`); a 200 excludes the policy and
points at the client's `avatar_url` write or the render; a 400 whose body says
`new row violates row-level security policy` proves it, and a migration at the
next free numbers (0107 and suite 110 at P8's merge; 0102 and suite 105 were
retired on 2026-10-28, walkthrough 85 Q5) then holds the smallest policy
change that lets the owner of the path upload and still refuses another user's
path. Delete the object after.

### `POST /api/software` on the local server silently discards `visibility`
**MEASURED at code level (2026-08-12, Phase 5); latent.**
Both O.T.T.E.R. create paths send a `visibility` field (`generateCourse` and the
agent path). `electron/main.cjs` drops it, and the caller's guard
(`if (!metaRes.ok || !meta?.slug)`) cannot detect the loss. Harmless **today**
only because the tier picker is wrapped in `{isCourseMode && cloudMode && …}`, so
the field is never sent on the backend that ignores it. It becomes a real bug the
moment anything offers tiers outside cloud mode.

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

### A BYO workspace's thumbnails have no browser preview — deliberate, deferred to its own session

✅ **CLOSED FOR s3 BY P1 (2026-10-28, `po/p1-own-storage-previews`), narrowed to
the live proof and the NAS half.** The three deferred pieces below are built as
one, as this entry said they would be: a GET-only batch signer,
`storage-read-urls` (100 keys and 2 projects a call; the row checked as the
caller; money refused), a longer media expiry (a stream 3600 s, a thumbnail
3600 s, a body read once 300 s), and `getUrl` in `REQUIRED` with all three
providers meeting it. FileManager signs an s3 row's preview in the company's
bucket and renews it while it is shown; the Files tab previews and plays an
s3 file. What remains: the live check on Audrey's test bucket (OSP-06), and
the NAS half, which is the `network` entry below. `NETWORK_STORAGE_DESIGN.md`
§9.

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
   signable stops being shown. (P1, 2026-10-28: display now asks the
   customer's bucket for that key, finds nothing there, and shows the same
   icon — the outcome is unchanged and the rule below stands.)
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

**Measured one level up by P1 (2026-10-28):** a `network` workspace has no
cloud row for its media at all — it is recorded in the desktop's Local Server
mode, and `uploadFile` refuses it on the cloud — so the browser has nothing to
list, let alone preview. Its file panels now say so in one sentence (on the
cloud backend, while the workspace's active provider is `network`). Whether
those files are ever listed in the cloud (the file staying on the server, as
a Bins clip is) is Audrey's Q1 in walkthrough 85, P1, asked for night 5's M3,
which carries a desktop's managed files and on such a workspace would be
refused; pictures would follow her B4 rule (Q2). `NETWORK_STORAGE_DESIGN.md`
§9.4.

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

1. **Closed by 0115.** A pre-existing receipt was gated at the row and not at
   the blob; since 0115 a claimed key's reads follow its row, whatever the path
   says, so a path kept from before is no way in.
2. **A receipt whose body is on a customer's own bucket cannot be flagged at
   all.** `files_money_provider_chk` (0050) refuses a financial row outside
   Supabase, so 0076 scopes its backfill to `storage_provider = 'supabase'`
   rather than aborting. Those rows need their body moved into Supabase before
   they can be gated. Suite 78 probe 53 pins the refusal; breaker BM1 showed an
   unscoped backfill dies on the CHECK.

The standing diagnostic for the first two is in `SYSTEMS_HANDBOOK.md` §12.9
(§12.4 is blob garbage collection — the pointer here was wrong). ⚠️ Read its
two columns differently: `ungated_on_customer_bucket` must be 0, but
`blob_outside_money_segment` counts receipts whose path predates 0076, and is
expected to be non-zero there: since 0115 their reads follow the row.

3. **Local Server receipts uploaded before C4 — counted by nothing.** 0076 is
   a Postgres migration; the desktop keeps its own `is_financial` in its JSON
   bundle (`electron/main.cjs`) and nothing backfills it or moves those bodies
   into `INVOICES/`. Such a receipt stays ungated forever — still listed in
   Project Files, still eligible as D.O.G. deck source material, which is the
   literal defect this entry marks fixed. New desktop uploads are gated
   correctly; only the existing ones are stranded.

### The gateway's tests fail under the full suite's load on Windows, and its journal's rewrite once threw an unhandled EPERM
**MEASURED (FX3, 2026-10-11/12, on the gateway as it was at `2c31d5db`, before GW4 merged).** In three of four full `npx vitest run`s
on Windows (the dev server and Playwright running beside them), one to
three gateway tests failed, and each passed alone every time
(`gateway/test/platform.test.mjs` 63/63 and `runtime.test.mjs` with it;
`doorsOutside.test.mjs` with `platform` 82/82): `platform.test.mjs`'s
"Windows, for real: the owners read by PowerShell … check-state refuses this
folder" (7.6 s, 11.0 s), `runtime.test.mjs`'s "an outside viewing: journal
start and end, posted as one row" (5.0 s) and `doorsOutside.test.mjs`'s
"/v1/health is { ok: true }" (9.9 s) and its GW3 nonce proof (6.9 s). The
runtime run also reported an **unhandled rejection**: `EPERM: operation not
permitted, rename '…\.journal.rewrite' -> '…\journal'` from
`gateway/src/journal/journal.mjs` (the rewrite's `fsp.rename`). The time-outs
are the suite's (a PowerShell spawn and a loopback server under load); the
EPERM is **INFERRED** to be able to happen on a real Windows gateway too (a
rename over a file another process holds open, an antivirus scan say), where
nothing catches it. Settle it: retry the rename on EPERM / EBUSY as Node's
own `fs` guidance for Windows does, and give the three tests the time-outs a
loaded Windows runner needs. *(FX4, 2026-10-12, MEASURED in its five full
runs on Windows: the PowerShell check-state test every time, and once each
`acme.test.mjs`'s "an expired certificate … is renewed within a tick",
`doorsInside.test.mjs`'s "a real TLS client is cut before it",
`doorsOutside.test.mjs`'s "a response still streaming when its authority
runs out is cut" and, outside
the gateway, `src/tools/otter_v0.3.1/quizWiring.test.js`'s whole-tree scan
"nothing anywhere still calls the retired per-course route" (5 s); each
passed alone.)* *(FX6, 2026-10-12, MEASURED in its first full run on
Windows, at the cut `171a88e3`: `release.test.mjs`'s "an answer cut short
is refused and named so …" timed out at 20 s, and the next test, "a status
other than 200 at the end is refused", then read `too_large` where it
expects `status` (INFERRED: the timed-out test's override of the asset
host, 5,000 bytes against that test's 10-byte limit, still in force, the
outcome the file's own comment on that 20 s time-out names); the file
passed alone, 32/32. The full run after FX6's change passed whole.)*
passed alone.)* *(FX7, 2026-10-12, MEASURED: in its full run on the tree
merged with FX5 (`6051b432`, `--maxWorkers=4`, the dev server and
Playwright idle beside it), `acme.test.mjs`'s "bad nonces are retried with
the nonce the refusal carries" failed (`{ ok: false }` where `{ ok: true }`
was expected, 150 ms) and passed alone three times out of three; FX7's
three full runs before the merge had no gateway failure.)* *(FX9,
2026-10-12, MEASURED on FX9's tree (`54472510`; its change is one test's
assertions): 17 runs of `runtime.test.mjs` beside a full `npx vitest run`
at its default workers (32 logical CPUs) and a second test loop, the file
taking up to 26.7 s where it takes 3 s alone, failed twice on the 5 s
time-out — "an outside viewing: journal start and end …" (with the journal
rewrite's unhandled `EPERM` again) and "no cloud for 60 s closes the outside
door (D15) …". Beside `--maxWorkers=4`, 200 runs: one failure, "🚨 the probe
never accepts an echo of the nonce …" (`runtime.test.mjs:596`, a 3.7 s
file): its throwaway loopback echo server received no request (`answers`
was `[]`). The test does not record the probe's error, and 3,400 in-process
repeats of it under the same load missed none: cause NOT ESTABLISHED.)*
*(S1, 2026-10-27, MEASURED on GitHub's Linux runner, not Windows: RLS tests
run 40590939861, its Vitest job, `doorsOutside.test.mjs`'s "a play and a
scrub make one viewing; 60 s idle ends it; the row has counts and two
offsets" — the closed row's `bytes` 524,288, the first range alone, where
1,048,593 is expected, its `fraction` short likewise — on `3a6ec8f8`, a
docs-only merge whose tree (`70736e0a`) is byte-identical to `4c747d87`'s,
which passed in run 40590893549; the same code passed in 40589711054 and
40589629970. S1 touches nothing under `gateway/`. INFERRED: the second
range's bytes are counted as its body finishes streaming, which under load
landed after the test's `tick()`; settle it by consuming the second
response's body before the clock moves, or by counting before the request
resolves. Not re-run: a re-run needs a GitHub sign-in the session has not.)*
*(B2, 2026-10-27, MEASURED on GitHub's runner: the same test, the same
figures — `bytes` 524,288 where 1,048,593 is expected, `fraction` 0.5 — in RLS
tests run 40617232593's Vitest job on `ae80e2c4`, a branch that touches
nothing under `gateway/`; it was the job's one failing test (the run's
annotations). Twice now on CI, never on a Windows run of the suite.)*
*(D1, 2026-10-28, MEASURED on GitHub's runner: the same test and figures (`bytes` 524,288, `fraction` 0.5) in RLS tests run 40661289297's Vitest job on `8221b1a8`, a docs-only commit (D1's hand-off) whose code is `f6ca0cf1`'s, which passed in run 40660619075; the job's one failing test by its annotations. D1 touches nothing under `gateway/`. Three times now on CI.)*
*(R2, 2026-10-28, MEASURED on GitHub's runner: the same test and figures (`bytes` 524,288, `fraction` 0.5, `doorsOutside.test.mjs:364`) in RLS tests run 40666541669's Vitest job on `fcb28123`, R2's merge-in of P1 and D1, whose tree passed the full suite locally (418 files, 10,542 passed, 9 skipped); the job's one failing test by its annotations, the run's other three jobs green. Nothing under `gateway/` changed since `51e5a0d7`. Four times now on CI.)*
*(R2, 2026-10-28, MEASURED on GitHub's runner: the same test and figures (`bytes` 524,288, `fraction` 0.5, `doorsOutside.test.mjs:364`) in RLS tests run 40735566652's Vitest job on `db120984`, the integration branch's merge of R2's record of her Q1 ruling. Its tree is byte for byte `6281d995`'s, which passed all four jobs in run 40734158776 just before, so the same tree has passed and failed on the runner; its other three jobs green, and nothing under `gateway/` changed since `51e5a0d7`. Five times now on CI.)*
*(M3, 2026-10-28, MEASURED on GitHub's runner by the job's annotations: the same test and figures (`bytes` 524,288, `fraction` 0.5, `doorsOutside.test.mjs:364`) in RLS tests run 40780867528's Vitest job on `11de80e8`, M3's hand-off commit, whose tree passed the full suite locally twice, with and without `.env.local` (418 files, 10,615 passed, 9 skipped); the job's one failing test. M3 touches nothing under `gateway/`. Six times now on CI. The same run's smoke job failed apart, at its gateway-ticket probe — wilson-dev's fixture, not the suite: see M3's hand-off.)*
*(P8, 2026-10-28, MEASURED on GitHub's runner by the job's annotations: a SECOND CI-only flake, in the Gateway workflow's *ACME against Pebble* job — a renewal refused with `badNonce` on `9e8f9290` (run 40787368497, 23:26 UTC), the same job green at 19:27 UTC that day and in every earlier run. The workflow runs Pebble with `PEBBLE_WFE_NONCEREJECT=20` (a fifth of nonces refused on purpose) and `gateway/src/acme/client.mjs` retries a bad nonce three times, so three refusals in a row — 0.8% a request, a few percent a run — fail the attempt. Nothing in P8 touches the client's requests. A longer retry is a gateway change for a later session; until then a red there is read against the step's own annotation, as this one was.)*
*(GWF, 2026-10-29, MEASURED, and this thread closed: M3's side session found a race in the gateway and fixed it there with a control (`3a3ecd88` on `po/gwf-gateway-viewing-row-flake`). The door counted a response into its viewing only when the response's pipeline ended (`gateway/src/doors/clips.mjs`, `done()`, on the response's `finish`, which waits on the socket's write callbacks), while the client's `end` needs only the bytes, so the two land in either order, and the test's 60 s tick between them closed the row without the second range. Measured on Windows on `a351adc8`: the door's end came after the client's in 18 of 1,000 responses, and the test's own steps, 500 times in one process, closed the row short twice idle and 13 times beside a full `npx vitest run`, each time with the CI figures (`bytes` 524,288, `fraction` 0.5, `last_offset` 524,287, `read_in_full` false, `range_count` 2): not Linux's alone, only rarer here. The fix counts each chunk into the viewing before it is passed on, where `sent` and the bytes budget count it, and leaves the response's end to mark activity (`viewings.mjs`, `served` and `settled`): the totals and the 60 s and five-minute rules are unchanged. The control, *the row holds every byte the client has, even when the response's own end lands after the idle check*, holds the second response's `finish` and `close`: red 10 of 10 before the fix with the CI figures, green after. After the fix no row closed short in 500 idle or 500 beside the suite, and the file passed 20 of 20 inside two full-suite runs (425 files, 10,828 passed, 9 skipped, no `.env.local`); every CI job green on `3a3ecd88` (RLS tests run 40854831328, its Vitest job among them; Gateway run 40854831268, its tests on Ubuntu and Windows among them). What a response served after its row had closed was counted in no row; later the same day, at Audrey's answer *one line per play*, a response holds its row open until it ends (D7, `GATEWAY_DESIGN.md` §6), so the viewing tests wait for the door's own end before they move the clock.)*
*(GWF, 2026-10-29, MEASURED on this Windows machine in the afternoon, when a full `npx vitest run` took 212 to 226 s against 120 to 125 s in the morning, its transform time too: three of four full runs on the D7 tree failed only outside the gateway, on 5 s time-outs in `src/` tests that pass alone (`timelineWeekends.test.jsx`, several of whose tests take 3.6 to 4.4 s alone, where 27 more of its 34 failed after a time-out in its first; `timelineVersions.test.jsx`; `PageSurface.test.jsx`). A run with the gateway's files as they were before the D7 change failed the same way (`pages.test.js`'s two whole-source scans), and with `--testTimeout=20000` the suite passed whole (425 files, 10,831 passed, 9 skipped). No gateway test failed in any of them.)*

---

## Session log

Kept so the file's own history is visible without `git log`.

| Session | Added | Removed |
|---|---|---|
| Post-overhaul F4 (2026-11-13, wave 2; `po/f4-rerender-discipline` into `feat/post-overhaul-edit-versioning`) — re-render discipline, nothing new on the screen meant: the pet's state in `PetHost` under App, the agent's value memoized and its input apart, `React.memo` on the pages and the three tools' roots, R.A.B.B.I.T.'s state that moves on its own clock out of the provider's value (`state/rabbitLive.js`), the Assets tab's warnings from one index (rabbit C5), O.T.T.E.R.'s lesson body and reference views memoized, D.O.G.'s preview placeholders at module level and its parse kept; measured in the running app before and after (a minute of the pet 2,105.7 to 2,859.2 ms of drawing → 42.4 to 50.7 ms); the render spy `src/lib/renderSpy.js` and its pins; two review rounds on Opus 5.5, whose security defects (the pet's saves and chat reaching the next person's account or screen) and the five things F4 had made worse were fixed in the session; no migration, no SQL, no Edge Function | F4-01 to F4-03, F4-05 to F4-07, F4-09 to F4-13 (F4-04, the pet's chat kept for the next person, was found and fixed in the session; F4-08, the agent's conversation kept for the next person, was found in the session and fixed after its merge) | P1-16 (the preview's loop, `b151c20e`). Comment markers: 4 → 4. |
| MO3 (M.O.T.H. Session 3, 2026-11-08; `po/moth3-tags`) — typed tags, relationships and workspace notes: migrations 0124 to 0129 on wilson-dev, the notes' tiers and trash, the `[[` and `#` pickers in R.A.B.B.I.T., M.O.T.H.'s typed-tag drawer, notes, tags and links in the graph and its record; two whole-session review rounds. | MO3-01 to MO3-12 (above, after MO2's list). | MO2-03 (links are saved: 0127, and the page's link drop), MO2-09, MO2-10, MO2-11, MO2-12 and MO2-18 (0124). |
| MO2 (M.O.T.H. Session 2, 2026-11-07; `po/moth2-graph`) — the graph engine merged with its callers, migrations 0122 and 0123 on wilson-dev, the graph, glow, HUD and navigation; two whole-session review rounds. | MO2-01 to MO2-23 (above, after MO2a's list). | MO2a's R1-17, R1-18, R1-4, 5, 22, 52, R1-11, 23, R1-8, 24, R1-25, R1-13, R1-6, R1-3, R1-7, R1-32, R1-33, R1-34. |
| MO1 (M.O.T.H. Session 1, 2026-11-02 to 2026-11-07; `po/moth1-foundations-9l5hbg`) — migrations 0107 to 0119 and 0121, the Edge Functions, the desktop's trash, moves and office-server routes, and the lazy Moth page; two whole-session review rounds. | MO1-01 to MO1-15 (below, at the end of this file). | The workspace channel's private rows and the write hops on `tasks` and `assets` (A-R1-04, A-R2-03), `files_delete`'s hop (C-R2-01), S4d-01, S4d-02: 0107 to 0109. OSP-01, OSP-07, S4c-12 for claimed keys: 0114, 0115 and the Edge Functions. S4b-06's first half and the receipts' residual 1: 0121, 0115. |
| Post-overhaul DG8 (2026-11-06; `po/dg8-limit-bar-words` into `feat/post-overhaul-edit-versioning`) — her words, verbatim *"sorry dont say that its an estimate"*: the limit bar's sentence, card 1's header and the hover no longer say it, by the brief's table; *About* and *about* stay; the meter's arithmetic unchanged; one new group of tests over every word and attribute of the bar and the header in each state; walkthrough 94 corrected in place. | DG7-01 restated: the number can still read low, and the bar does not say it is an estimate; recorded, not fixed. DG8-01. | nothing: DG7-01 stays open. Comment markers: 4 → 4. |
| Post-overhaul DG7 (2026-11-05; `po/dg7-refs-uploads-side-by-side` into `feat/post-overhaul-edit-versioning`) — her ask, verbatim *"lets have references and the uploads be side by side in the card. this makes the card shorter and fills in the negative space a bit. when doing this, the uploads and references selected/uploaded files should show up on the list together showing what its reading."*, and on the limit bar *"Fix it in the D.O.G. session (Recommended)"*: card 1's References and Uploads two columns (416px to the 576px measure, 24 apart, no query), the first controls on one line, one list of every tile with the contract line and the meter under *The deck reads* (the brief's words, her Q1); `focusAfterRemove` by a tile's kind; card 1 40 to 227px shorter at 1280 to 2560 in every state measured but folded (34, unchanged), 20 to 36 taller only where the columns stack with little listed (DG7-07); the meter: the model's input limit in the registry from the provider's documentation (Sonnet 5, 1,000,000, less the 16,384 reserved), a PDF page at 3,000, *(an estimate)* in its words and the number past the limit, the page cap 600 or 100 by the model and on an upload's tile, the count by mode; a 110-page text PDF 248 percent → 34; Help's step 1 in the card's order; two review rounds on Opus; 76 plants each red; no migration, no SQL, no Edge Function | DG7-01 to DG7-08 | DG6-03, MTR-01, MTR-02, MTR-03. Comment markers: 4 → 4. |
| Post-overhaul SB1 (2026-11-01, night 10; `po/sb1-resizable-sidebars` into `feat/post-overhaul-edit-versioning`) — her ask of 2026-11-01, verbatim *"this divider line from the courses sidebar and the overall otter window should be expanding by grabbing and putting the line to the desired width of the courses sidebar. lets do the same with the sidebar in the dog tool"*: one handle on the kit Panel (`resizable`, `storageKey`, `minWidth`, `maxWidth`, `minBeside`): an 8px strip over the 1px hairline (24 for a finger) that takes no layout width, the line as drawn at rest and a 2px band of the signal on hover, a drag and focus, `role="separator"` with its values, the arrows ±8 and ±40, Home and End, a double-click back to the token, Escape abandoning a drag, the width remembered per device only while it differs from the token and drawn narrower where the row cannot hold it; O.T.T.E.R.'s courses 180 to 480 with 720 kept beside (304 at 1024), D.O.G.'s pages 160 to 480 with 560 kept (464 at 1024); the collapse, its rail and Ctrl/Cmd+\ unchanged, a reopened column at its width; measured at 1280, 1440, 1920 and 2560 (and 1024) before and after, the line and the column beside pixel-identical at rest; C4's preview pin passes at the default; 55 new tests, 50 red on the source before, 112 plants each killed; one design round and two review rounds on Opus (round 1's corrections: the band not drawn in forced colours, a press that changes nothing writes nothing, a window narrowed mid-drag holds the drag, a finger's 8px slop; round 2's: a moved drag owns the width while it lives, the forced-colours ring and the memory's clearing pinned, the Panel measured against its own row in both tools) (Fable's allowance spent until 2026-11-04); no migration, no SQL | SB1-01 to SB1-04 (the design round's three WCAG items: no single-pointer way to set a width, an 8px strip for a mouse, the hairline's 1.48:1 at rest; and the pet over the lesson's *Next* when the courses column is wide at 1280) | nothing |
| AT1 (2026-11-01, night 10 of `docs/sessions/PLAN_TO_1_0.md`; `po/at1-admin-terminal-fit` into `feat/post-overhaul-edit-versioning`) — her ask of 2026-11-01, verbatim in the brief (*"make it wider there is a lot empty space to the sides … the member details should fit and static not able to scroll … the pop up card asking to confirm should be in the center of the overall admin terminal not inside of the column"*): measured first at four sizes (margins 24/100/340/660; the panel 678 px of real content in 512 and 34 px sideways; every confirm 239 wide in the panel, the panel resting at `translateX(0)`, its transform the containing block); one design round on Opus (design-direction, laws-of-ux); the page edge to edge (the registry entry takes no measure), the panel 560 in two columns, no scroll from 1280x720, a compact roster beside it under 860, the confirms beside the panel and the panel at `transform: none`; no kit change; review round 1 on Opus (1 High, measured: one Escape closed the confirm and the panel, older than AT1, fixed; 1 Medium; 3 Low; 4 Notes), round 2 on Opus (1 Medium, measured: from 1160 to ~1265 the roster's search ran under the status chips, round 1's breakpoint move having opened it; the search to 120 and 80, the two columns from 1220; 4 Low, the layout effect untested, three numbers; 3 Notes); 26 plants each red; no migration, no SQL | AT1-01 to AT1-08 | — . Comment markers: 4 → 4. |
| Post-overhaul F2, a third follow-up (2026-10-31; `po/f2-money-rules` into `feat/post-overhaul-edit-versioning`) — her answer to walkthrough 91's F2 Q6, relayed by the controller: a question back (verbatim in the walkthrough), then *"Yes, F2 builds it next (Recommended)"*: a bid version keeps each expense's estimate, at each save and as they are when the budget goes active; the Expenses tab shows the selected bid's figure, what is expected now and what was spent, with *Expected vs bid* and *Actual vs expected*, a sentence naming the bid, and for a budget active from before, *Keep today's estimates as its bid*; the table on the kit's compact cells (1280 holds it); measured before and after in Chromium on the fixtures (Locked bid $20,960, Expected now $21,260, +$300); 12 tests red on `1a36d9ad`'s source, 32 plants each killed; review round 1 on Opus (1 High — the bid froze at the last save, not at the lock: the lock writes them now; 3 Medium; 3 Low), round 2 on Opus (1 Medium — the lock wrote the whole snapshot from this window's copy: only the expenses now, on the stored one, its undo leaving a later save; 5 Low); no migration, no SQL | F2-11, F2-12, F2-13 | F2-10 (closed by measurement). Comment markers: 4 → 4. |
| Post-overhaul F2, a second follow-up (2026-10-31; `po/f2-money-rules` into `feat/post-overhaul-edit-versioning`) — her answers to walkthrough 91's F2 Q4 and Q5, relayed by the controller, verbatim *"Leave them (Recommended)"* and *"Yes, show it (Recommended)"*: the Expenses tab's *Bid total* tile with the agency fee on (budgetMath's `lineMoney`; $24,449 with the $3,189 fee on the fixtures, the Topsheet's figure), nothing built for Q4; measured before and after; a test red first, eleven plants each killed; review round 1 on Opus (her F1 ruling: 1 Medium, the test's missing cases, pinned; 3 Low, the Variance tile now saying *against the estimate, before the fee*, a comment, this row; 4 Notes), round 2 on Opus (no wrong figure in 32 measured cases; the Variance's basis hers, Q6; the hint under an empty Variance removed; a comment); no migration, no SQL | F2-10 (her Q6) | F2-07 (closed by measurement), F2-08 (closed by her answer). Comment markers: 4 → 4. |
| Post-overhaul F2, a follow-up (2026-10-31; `po/f2-money-rules` into `feat/post-overhaul-edit-versioning`) — her answers to walkthrough 91's F2 questions, relayed by the controller, verbatim: Q1 *"Yes, fill in 20% (Recommended)"*, Q2 *"Full rate, $624 (Recommended)"*, Q3 *"Yes, its own line"*: switching the agency fee on anywhere with nothing typed fills in 20% (`agencyPctOnSwitchOn` for the Summary's and the settings' switches, the new-project form, the move to the cloud); the Crew tab prices a role nobody holds at the Summary's rate (the production designer $520 → $624, the crew $76,810 → $92,172); the client estimate's own *Agency fee* line on the crew and the expenses ($17,015, total $141,995 → $159,010) and the Topsheet's expenses fee ($3,189); measured on the fixtures before and after; tests red first; two review rounds, both on Opus (her F1 ruling); no migration, no SQL | F2-07 (the Expenses tab shows no fee), F2-08 (cloud projects already at 0), F2-09 (four older things seen in review) | F2-01, F2-03, F2-04 (closed by measurement). Comment markers: 4 → 4. |
| Post-overhaul DG6, a follow-up (2026-10-31; `po/dg6-one-column` into `feat/post-overhaul-edit-versioning`) — her answers to walkthrough 90, relayed by the controller, verbatim *"One column always"* (Q1) and *"Full card width (Recommended)"* (Q2); then her words to the session with a picture of the beta, verbatim *"i really dont like that there is a open space/gap to right and also project select needs to go above the add references and below the references should be the upload option ... we need a title or something for each function in the project and references card"*; her answer *"Keep it (Recommended)"* to the second design round's one question, given again on the built pictures; and *"remove the dividing lines. the titles themselves are enough to separate"*: D.O.G.'s two input cards run the column's full width (DG5's wrapper, DG6's cap, its two columns from a 1468 window, their `@container` rule and the main column's size container removed; the gutter kept for the output card's width); card 1 titled sections, Project, References, Uploads, then the contract line and the meter, 32px apart and no line, rows in shelves of 416px or more; Choose file after Core files only in the Tab order; `focusAfterRemove` within a section; the output card untouched; measured before and after at 1280, 1440, 1920 and 2560 (no paper beside the cards at any width; card 1 1 percent empty with six references to 1920, 41 at 2560, 42 to 74 with nothing chosen, her ruling, given on the design round's sketch and again on the built pictures); one design round and two review rounds, all on Opus (Fable's week at 100 percent); no migration, no SQL | DG6-02 (card 1's sections: four matters of her taste), DG6-03 (Help's step 1 in the old order) | nothing |
| Post-overhaul F3 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`; `po/f3-desktop-project-file` into `feat/post-overhaul-edit-versioning`) — the code review's REV-06 and REV-07 (desktop-build C1, A6, C2): the desktop's project bundle kept in memory, keyed by its path and a stat stamp, reconciled once per disk load and on every write; one atomic JSON writer (`electron/jsonFile.cjs`, lifted from `rendererStorage.cjs`) for every JSON write in `main.cjs` and `localDemoRoot.cjs`; the subjects GET read-only, the writes keeping the order; the `_DATABASES` mirrors written only when they change; the 50 MB body limit kept; measured before and after on the fixtures' project (a task PATCH 22 → 17 disk calls and 379 KB → 0 read; a cached thumbnail 18 → 12, 5.0 → 3.7 ms; a six-subject list 19 → 10, nothing written); one design round and two review rounds on Opus 5.5 (her ruling "Use Opus for reviews (Recommended)" of 2026-10-31: Fable refused for usage credits); no migration, no SQL; comment markers 4 → 4 | F3-01 to F3-08 | REV-06, REV-07 |
| Post-overhaul F2 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`; `po/f2-money-rules` into `feat/post-overhaul-edit-versioning`) — REV-02 with her ruling of 2026-10-31 in the session's question box on the agency fee switched on with no percentage typed, verbatim *"20%"*: `budgetMath.js` the one money module every Budget surface calls (`projectBudgetSettings` and `bidTotals` moved in, `taskBaseCost` and `lineMoney` added, one `round2`, `AGENCY_DEFAULT_PCT`); margin and contingency on the base on the Crew and Talent tabs and the client estimate; the fourteen inline copies of the inheritance rule and the eleven settings reads with a default of their own gone; measured on the fixtures before and after with the fee on and none typed and with 10% typed (the Crew tab's agency 0% → 20%; with 10% typed its contingency +$8,449 → +$7,681, the Talent tab's +$1,538 → +$1,230, the client estimate's $12,881 → $12,573; the Summary unchanged); tests red first; two review rounds, both on Opus (the Fable call refused for the account's credits; her ruling for F1, *"Use Opus for both (Recommended)"*, relayed by the controller); the Expenses tab's two unread totals removed (review round 1); no migration, no SQL | F2-01 (the Crew tab's rate for a role nobody holds), F2-02 (the Topsheet's crew rows), F2-03 (the client estimate's agency fee, the Topsheet's expenses), F2-04 (the cloud's 0 for a percentage nobody typed), F2-05 (the tabs' Bid total), F2-06 (what is typed on a Crew row for a role nobody holds) | REV-02 (closed by measurement on the fixtures). Comment markers: 4 → 4. |
| Post-overhaul F1 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`; `po/f1-operator-console-list` into `feat/post-overhaul-edit-versioning`) — REV-01 by her ruling of 2026-10-31, verbatim *"Record it, fix at the release steps"*: `PAGE` imported in `operator-workspaces` (the console's company list and teardown step 1d); a `deno check` of every Edge Function in `rls.yml` with Deno 2.1.4 (the Deno inside the pinned CLI's edge runtime), red on the unfixed file and green on the fix on GitHub's runner, the 28 errors its first run found beside REV-01's six held as a counted baseline; a pin in `teardownCollect.test.js`, red first; two review rounds, both on Opus (the account's Fable credits were out; her choice, *"Use Opus for both (Recommended)"*); no deploy (the controller's, on her go), no migration, no SQL | F1-01 (28 type errors in ten files, seven functions and the three shared guards, none of which throws; the check's baseline) | REV-01 (closed by measurement on GitHub's runner). Comment markers: 4 → 4. |
| Post-overhaul DG6 (2026-10-31, night 9; `po/dg6-cards-stacked` into `feat/post-overhaul-edit-versioning`) — her ask of 2026-10-31, verbatim *"this looks objectively bad. please do a pass to make it more appealing for the top two cards. leave the output card how it is dont touch it. i want to keep the 1 and 2 cards stacked not side by side"*: D.O.G.'s two input cards stacked at every width at one capped width, 602px under a 1468 window and 1,202 from it, card 1 in two columns of the 576px measure there; DG5's pair, card 2's cap and the triple removed; the project dropdown's inline 360px cap removed (review round 1, finding 4: with no project the halves were 93px apart); the output card untouched; measured at 1280, 1440, 1920 and 2560 before and after (card 1 empty across 42/2/28/22 percent before, 2/2/1/1 now; card 2 1/2/28/23 before, its box stretched at 1280, 2/2/1/1 now); one Fable design round with the design-direction and laws-of-UX skills; two review rounds, both on Fable; no migration, no SQL | DG6-01 (the type sweep's scanner reads `DeckOutlineGenerator.jsx`'s backticks inverted from line 2635) | DG5-02 (closed by measurement at 3440x1440) |
| Post-overhaul REV (2026-10-31; the controller's read-only code review at her ask, no branch, no code change) — five surveys of the code's areas for redundancies, near-duplicates and inefficiencies, 123 findings, in `docs/reviews/CODE_REVIEW_2026-10-31.md` with the five surveys beside it; seven correctness defects found along the way are REV-01 to REV-07 below; her ruling on REV-01, verbatim: "Record it, fix at the release steps" | | |
| Post-overhaul DG5, a follow-up (2026-10-30; `po/dg5-pair-from-1414` into `feat/post-overhaul-edit-versioning`) — her answer to walkthrough 89's Q2, relayed by the controller, verbatim *"Side by side from about 1,414 only"* (Q1 and Q3 as built): D.O.G.'s two input cards sit side by side from W 1148 (a 1414 window) and stack below it as DG4 left them, card 2 full width there; the design follow-up's W 1000 rule removed; the column keeps its scrollbar's gutter (review round 1, MEASURED with real scrollbars in Chromium 147 and Electron 33: a size query on the scroll column was answered before its scrollbar, so the pair applied at a 1404 window with a sideways scrollbar, and DG5's triple 10px early); measured before and after at 1280, 1366, 1400, 1414, 1440 and 1920; two review rounds, both on Fable; no migration, no SQL | nothing | nothing |
| Post-overhaul DG5 (2026-10-30, night 8; `po/dg5-card1-layout` into `feat/post-overhaul-edit-versioning`) — her ask of 2026-10-30, verbatim *"the redesign has a bit too much negative space. the entire right side is an empty card. lets do a pass to make sure it is visually appealing"*: D.O.G.'s two input cards share one row from a 1280 window (a plain `div.dog-inputs`; `.dog-main` a size container), card 1 in two columns from about 1,974, nothing past the 576px measure; measured at 1280, 1440, 1920 and 2560 before and after (card 1 empty across 42/50/65/75 percent, then none/none/28/22; Generate in view from 1280 with six references listed); three direction words taken out of card 1's sentences; one Fable design round with a follow-up on laptop sizes; two review rounds, both on Fable; no migration, no SQL | DG5-01 (the preview probe's stale first wait), DG5-02 (an ultrawide window: about 44 percent of each card empty again) | nothing |
| Post-overhaul M1, a third follow-up (2026-10-30; `po/m1-desktop-invoice-uploads` into `feat/post-overhaul-edit-versioning`) — her ruling relayed by the controller, *"Yes, M1 fixes it now (Recommended)"* on M1-L7: the desktop's two upload routes (the base64 POST and the streamed PUT) file an invoice or a receipt in the project's INVOICES folder, as the cloud does; measured in the desktop app driven off-screen (a scratch profile, no sign-in), with the commit before as its control; the folder delete lets its files' folder_id go (0043's SET NULL); two review rounds, both on Fable; no migration, no SQL | nothing | M1-L7. |
| Post-overhaul M1, a second follow-up (2026-10-30; `po/m1-invoice-uploads` into `feat/post-overhaul-edit-versioning`) — her ruling relayed by the controller, *"Yes, M1 fixes it now (Recommended)"*: an invoice or a receipt added in the cloud with no folder of its own goes into the project's INVOICES folder (`uploadFile`; made under the root where a project's tree lacks it), measured on wilson-dev (rolled back); two review rounds, both on Fable; no migration, no SQL | M1-L7 (Local Server mode's own upload; review round 1) | M1-L6. |
| Post-overhaul M1, a follow-up (2026-10-29; `po/m1-invoices-folder` into `feat/post-overhaul-edit-versioning`) — her answer to walkthrough 84's M1 Q1, *"1. b"*: the invoices and receipts the desktop shows at the project's top go into the INVOICES folder in the cloud (the project's own, else the cloud's; one that did not land keeps them waiting), said apart from the files filed as on the desktop; her answers to Q2 and Q3 were her rulings of 2026-10-28 already (built by M3 and M2); no migration, no SQL | M1-L6 (the cloud's own invoice upload names no folder; measured from the code) | nothing. |
| Post-overhaul D3 (2026-10-29; `po/d3-bridge-sender-gate` into `feat/post-overhaul-edit-versioning`) — the sign-in bridge answers WILSON's page only, and an answer's link opens a new tab on the web (`docs/sessions/PLAN_TO_1_0.md` night 7; her *"Q2. b"* of 2026-10-29; `docs/design/RECONNECT_DESIGN.md` §14): measured first on a development build of the tip and on the web, one Fable design round, built: every one of the 50 channels the preload bridges is registered through one gate (`electron/ipcGate.cjs`; `ipcMain` in `main.cjs` is the gate, the updater is handed it), which asks D1's rule first and answers any other sender `null` at once, logging the channel and the scheme once; one anchor component for the pet's and O.T.T.E.R.'s answers opens a web link in a new tab on the web; build review round 1 (Fable) found the preload handing a dropped file's place to any page that held it, the link leaving `javascript:` to react-markdown and the source check's blind spots, round 2 (Fable) an answer's link to WILSON's own address reloading WILSON in place, each corrected and measured | D3-01 (with a Sentry DSN, Sentry's own listeners and preload answer any page) | **D2-01** (closed by her ruling in words, *"Q1. a"*: the clips left behind stay listed by name), **D2-02** (closed by measurement: on the build the main window showing another page, another window holding the preload and a frame holding it are each answered `null` for the token, the session and every channel, where the tip handed them all three, and a dropped file's place reaches WILSON's page alone; WILSON's page gets everything it did), **D2-06** (closed by measurement: on the web the pet's and an O.T.T.E.R. lesson's web links open a new tab whose opener is cut and WILSON's tab stays, where the tip replaced it). Comment markers: 4 → 4. |
| Post-overhaul GWF (2026-10-29; `po/gwf-gateway-viewing-row-flake` into `feat/post-overhaul-edit-versioning`) — M3's side session for the gateway's CI flake (`doorsOutside.test.mjs`'s "a play and a scrub make one viewing …", seven times on GitHub's runner): the race measured on Windows and made certain by a control, then fixed in the gateway (a viewing counts each chunk before it is passed on; a response's end only marks activity), the flaky test also checking that both ranges arrived whole; then, at Audrey's answer *one line per play*, D7's one row per play built (a response the door has not finished holds its row open, however long; no five-minute row; `GATEWAY_DESIGN.md` §6 changed in place, with its GWF entry); no migration, nothing outside `gateway/` but this file, the design and the hand-off | **None.** *A response open longer than the idle minute is counted only up to its viewing's close* (MEASURED), written with the first record (`5128e020`), went the same day with D7's one row per play | **The CI-flake thread** of *The gateway's tests fail under the full suite's load on Windows …*, closed by its dated line (the entry stays for the Windows time-outs and the journal's EPERM). Comment markers: 4 → 4. |
| Post-overhaul smoke trace (2026-10-29; `po/smoke-gateway-ticket-trace`, documents only; a side session of M3) — the issue-session smoke job's step *Probe gateway-ticket* read `missing: 3` on wilson-dev on every RLS run from 22:33 to 23:17 UTC on 2026-10-28 (the probe gateway's mint log: the last ticket 19:41:28 UTC, the next 23:26:41 UTC). The cause, P8's 0104 (TPN-AUTH-012): `gateway_clips_for_tickets` returns only checked clips at checked locations, with no backfill, and GW1's fixture clip and location were unchecked; not a deploy (`gateway-ticket` v4 of 2026-10-10), not a policy (0091's eight), not a seat (the probe user an active admin). Reproduced as the probe user in one rolled-back file. Cured by P8's stamp of the four fixture rows as postgres at 23:20:34 UTC (`vetted_by` NULL, the migration's mark): green from run 40787368613 on, and on this branch's push. Nothing written on wilson-dev by this session; `docs/sessions/handoffs/po-smoke-trace-2026-10-29.md` | **nothing.** The problem is fixed; the fixture's missing recipe is in the hand-off's §5. | **nothing.** Comment markers: 4 → 4. |
| Post-overhaul D2 (2026-10-29; `po/d2-desktop-dropped-page-and-sleep-idle` into `feat/post-overhaul-edit-versioning`) — the desktop's two fixes before 1.0 and the report line (`docs/sessions/PLAN_TO_1_0.md` night 6; her *"2. a"* of 2026-10-29; `docs/design/RECONNECT_DESIGN.md` §13): measured first on a development build of the tip, one Fable design round, built: the main window and each window it opens refuse every navigation and top-frame redirect outside the launch's origin (an http(s) one goes to the system browser), `window.open` refuses `file:`, `data:` and every scheme but http(s), `about:blank` and the page's own `blob:`, `navigateOnDragDrop: false` is stated (`electron/windowGuard.cjs`); a file drag nothing handled is cancelled on the window, after Bins' own listeners (`src/lib/dropGuard.js`); `activity()` judges the absence before it counts; the report and panel name the actuals that arrive without the invoice attached by a path, by line and period, never the file; build review round 1 (Fable) found the cloud downloads sent the window to their signed address, now started in the app (`wilson:download-url`), measured; round 2 (Fable) found an email link in the pet's or O.T.T.E.R.'s answers would do nothing, now handed to the mail app, measured | D2-01 (the clips left behind named by their files' names), D2-02 (the bridges' channels not gated), D2-03 (the console has no drop guard), D2-04 (an expenses-sheet actual has no place to re-attach its invoice), D2-05 (the intake button takes no drop), D2-06 (on the web, an answer's link replaces the tab) | **D1-01** (closed by measurement: on the build a page that sends itself to another site stays on WILSON's page and the address goes to the system browser, where the tip landed there with the saved sign-in and the key handed over; a file dropped with drop navigation forced on stays, by either layer alone, where the tip's control build landed on the file; D1's drop itself was an inference), **D1-02** (closed by measurement: after 31 or 120 minutes asleep the first `activity()` ends the session in `idle_timeout`, where the tip carried on; 29 minutes stays), **M3-L7** (M2 Q2 closed by her ruling in words: a project deleted in the cloud stays deleted, no *Carry everything again* in 1.0; M2 Q3 by the build). Comment markers: 4 → 4. |
| Post-overhaul P8 (2026-10-28; `po/p8-tpn-four-areas` into `feat/post-overhaul-edit-versioning`) — Phase 8 of `TPN_AUDIT/REMEDIATION_PLAN.md`, night 5: the four areas' ten High findings fixed (the checked mark on bins, the S3 endpoint vetted and reached at one address, posters at teardown, no-store on the bin streams, ai-files failing closed, the two-factor step-up in SQL, the gateway's secrets sealed, its certificate naming the host, a three-year root with the release key's successor, the master secrets versioned with a re-seal); 0104 to 0106 with suites 107 to 109 on wilson-dev; ten functions redeployed there; walkthrough 86; three Fable rounds | **nothing.** The security entry above carries the arrow line; what remains is the controller's rotation and her successor key, both in the runbook. | **nothing.** Comment markers: 4 → 4. |
| Post-overhaul M3 (2026-10-28; `po/m3-migration-part-3` into `feat/post-overhaul-edit-versioning`) — the desktop → cloud migration, part 3 (`docs/sessions/PLAN_TO_1_0.md` night 5): every row shape rehearsed on wilson-dev first (rolled back), one Fable design round before code; the team matched to company accounts by email for an admin or manager (the unmatched named, their rows arriving without the person), the roster inserted never upserted, every person column by the map and the people set once on rows earlier runs carried without them; the files kept with assets, scenes, shots, levels and experiences as `files` rows with their bodies by the company's storage rule (the resumable path fed by Range requests above the threshold; a server company's stay, her ruling); the rate cards and templates once per run with their gates, the assets' template links restored; the receipts an earlier build left open moved behind the gate; the archive keeps the workspace stores; no migration, no SQL; two review rounds | M3-L1 (the ordinary files step ignores the storage rule), M3-L2 (an s3 body one PUT up to 5 GiB), M3-L3 (a raw desktop id stays until its person joins), M3-L4 (`task_templates` stamps no maker), M3-L5 (the dry run's template links on a project not yet in the cloud), M3-L6 (a receipt's picture removed when it cannot be moved), M3-L7 (walkthrough 85's Q2 and Q3 still hers) | M1-L1, M1-L2, M2-L1, M2-L4 and M2-L5 closed. |
| Post-overhaul R2 (2026-10-28; `po/r2-release-readiness` into `feat/post-overhaul-edit-versioning`) — release readiness (`docs/sessions/PLAN_TO_1_0.md` night 4), documents and an audit only, two review rounds: `docs/PRODUCTION_RUNBOOK.md` (new: the controller's ordered production steps, each with its proof), `docs/RELEASE_TESTING.md` rewritten against the code, `CHANGELOG.md`'s 1.0.0 entry rewritten and dated Unreleased, and the read-only TPN re-audit of the file gateway, bins, own storage and the AI file store (`TPN_AUDIT/`: twenty findings opened, eleven of them High in the release gate, the 2026-08-05 design review's eleven merged, two of them renumbered) | **Two entries:** *The TPN re-audit of 2026-10-28 reports eleven High …* (under Security) and R2-01, the workspace takeout's missing tables (its own section at the end). Three entries carry a dated note of what the controller's kit records on staging and where production's step is: S4b-02, S4c-10, FX12-01. | **Nothing.** |
| Post-overhaul M2 (2026-10-28; `po/m2-migration-part-2` into `feat/post-overhaul-edit-versioning`) — the desktop → cloud migration, part 2 (`docs/sessions/PLAN_TO_1_0.md` night 4): every part-2 row shape rehearsed on wilson-dev first (rolled back); the budgets behind the money gate (versions, lines, actuals, expenses, role rates, the two pointers, receipts kept money), the levels and experiences with what names them, the links on tasks; the phases', assets' and tasks' own checks; the second run's record; migration **0103** (the desktop's three statuses, her ruling of 2026-10-28) and suite **106**, on wilson-dev only; a cleared Director or Producer sent as NULL; two review rounds | M2-L1 (night 5's kinds, for M3), M2-L2 (`upsertTaskLink` sends `project_id`; measured, unreachable today), M2-L3 (a dry run on a cloud without 0103), and from review round 1 M2-L4 (receipts an earlier build left open, said every run), M2-L5 (crew lines out of the Crew tab until night 5), M2-L6 (what the dry run does not foresee), M2-L7 (a removed picture, unreachable), M2-L8 (the id trusted where no read can tell), and from review round 2 M2-L9 (three record rules that are choices) | the part-2 entry and the resurrection entry (closed, the second narrowed); M1-L3, M1-L4 and M1-L5 closed; M1-L1 and M1-L2 to night 5 (M2-L1). |
| Post-overhaul D1 (2026-10-28; `po/d1-desktop-storage-across-relaunch` into `feat/post-overhaul-edit-versioning`) — the desktop keeps its stored state across a relaunch (`docs/design/RECONNECT_DESIGN.md` §12; her ruling of 2026-10-28, *"Fix it in 1.0, a session tonight (Recommended)"*, a fourth session on night 4): measured first (two launches of a development build, a new origin each), designed, the design reviewed on Opus (the Fable call refused, out of usage credits), built: the 4-hour cap from the token's own sign-in time at every restore (`start()` takes the earlier of its record and the `amr`; a fresh sign-in passes none), the renderer's `localStorage` kept in userData (`electron/rendererStorage.cjs`: the launch's first load made exactly the kept keys before the page's first script, written back once a second, when hidden and at `pagehide`; never the session, the idle clocks or tus fingerprints; a file Windows holds at launch never written over); the origin, the token, the cookie and the lock untouched; two build review rounds; walkthrough 85's D1 section | **D1-01** (security, there before D1: a page the main window is sent to, a dropped file's, is handed the preload's bridges; measured), **D1-02** (after a sleep the first key counts before the idle clock judges the absence; measured) | **S2-01** (closed by measurement: on the build a relaunch keeps the sign-in's start, 119.9 minutes left where the tip gave a fresh 240, and a relaunch 3 h 56 min after the sign-in shows *Session ending* 0.7 s after it opens, where the tip gave 239.8 minutes and no notice) and ***On the desktop, the browser's own storage most likely starts empty at every launch*** (closed by measurement: five keys written at one launch came back at the next with their values, where the tip kept none; a key written just before a reload or the window's close kept too; R.A.B.B.I.T.'s storage choice and last project were never in it, measured). Comment markers: 4 → 4. |
| Post-overhaul P1 (2026-10-28; `po/p1-own-storage-previews` into `feat/post-overhaul-edit-versioning`) — browser previews on a workspace's own storage (`docs/sessions/PLAN_TO_1_0.md` night 4; `NETWORK_STORAGE_DESIGN.md` §9): measured first (an s3 row showed icons and an "own bucket" sentence; a NAS workspace's media has no cloud row at all); `storage-read-urls`, a GET-only batch signer (money refused, `can_presign_project_read` once per project, a key signed only when a live s3 row of the caller's, in the key's own project, owns it, read one folder at a time so no filename travels; a thumbnail or one streaming video or audio 3600 s, a body read once 300 s), on wilson-dev only; `getUrl` in `REQUIRED`; FileManager's s3 arm, the Files preview and player for s3 rows; the NAS half's one sentence, Q1–Q2 to Audrey; one design round and two build rounds (Opus, Opus, Fable), 40 failing controls | **OSP-01 to OSP-11** (OSP-08 closed by build round 2): the older signer signs by path; an s3 download is still a Blob; an hour-long clip restarts on its re-mint; rows from before a switch to `network` answer "configure S3"; pre-0076 receipts on s3 are unflagged (a release check); the live check is her test bucket; a writer can make a row vouch for a key in their own project (a migration night); a stale URL after failed renewals; a clip played by MIME alone gets five minutes; the fixtures pass the cloud gate | **The BYO thumbnails entry, closed for s3** (narrowed to the live check and the NAS half); **S4b-02, closed by measurement for dev and staging** (the deployed `storage-presign` downloaded from both is the repository's copy, LEGAL included; production's predates LEGAL). *S44's reversal…* kept true; the `network` entry measured one level up. |
| Post-overhaul DG4 (2026-10-28; `po/dg4-dog-project-references-card` into `feat/post-overhaul-edit-versioning`) — Audrey's five notes on D.O.G.'s References (night 3, added by her): cards 1 and 2 one card, *1 Project and references*, laid out by the laws of UX in one 576px column; the References meter that column's fixed width (the contract line above it measured 571.28px) and 8px thick, the window's footer meter still `flex: 1`; *Place visual* (was *Use visual assets*, its subtitle gone) beside *Theme generator*, the Generate outline card's only two checkboxes, on both sides of the switch; *Use project assets* gone with its flag; *Core files only* beside Add references (the chosen project's readable Core files instead of what is chosen). No migration, no Edge Function. Walkthrough 84, its DG4 section. | DG4-01 (a click on a D.O.G. checkbox's words does nothing, only its 14px box ticks it; MEASURED, pre-existing). Comment markers: 4 → 4. | — |
| Post-overhaul S2 (2026-10-27; `po/s2-offline-launch` into `feat/post-overhaul-edit-versioning`) — the offline launch (`docs/design/RECONNECT_DESIGN.md` §11, her two rulings of 2026-10-27): a saved sign-in inside the 4-hour cap whose launch reaches nothing opens the shell offline — held by the client module, the guard latched, the claims read from the saved token, the strip from the first paint, one sentence on each screen and no New or Create — and is given back to the SDK on the first answered ping; a refused sign-in is cleared from the store; the pet's failed sync is retried without a relaunch | S2-01 (on the desktop the 4-hour cap restarts at every launch: a new origin, an empty localStorage) | *An offline launch cannot get past the sign-in screen, however fresh the saved sign-in*; *A failed pet sync is never retried until WILSON is relaunched* — both closed by measurement (the probe's phase G; `createPetSyncRetry`) |
| Post-overhaul M1 (2026-10-27; `po/m1-migration-part-1` into `feat/post-overhaul-edit-versioning`) — the desktop → cloud migration, part 1 (`docs/sessions/PLAN_TO_1_0.md` night 3): the inventory (the handbook's §3.1 table); a desktop project carried at all, its row through the cloud's columns and each value as its column takes it (measured on wilson-dev, rolled back: 42703, 23503, P0001, 22P02, 22007, 23502); its key dates, comments, shot lists with their items and edits, and folders, each file in its folder; every link only to this project's rows; the round trip on the fixtures; the report's part 2 apart from what no migration carries; two review rounds, both on Opus (Fable's usage out); no migration, no SQL | M1-L1 (asset versions and the desktop's own file store), M1-L2 (the workspace's stores), M1-L3 (a file's level or experience link), M1-L4 (the browser's status and person pickers; measured), M1-L5 (phases, assets and tasks without the project check; review round 2) | nothing; the part 2 entry narrowed and renamed, the resurrection entry measured for M1's kinds. |
| Post-overhaul B2 (2026-10-27; `po/b2-subject-shares-client` into `feat/post-overhaul-edit-versioning`) — subject shares, the client (`docs/sessions/PLAN_TO_1_0.md` night 3; the design's §6.2): the share dialog in three modes (a subject, the whole course, passing it on), the Requests view's *Shared with you* and *Shared by you* (the batch card, the chain line, Withdraw all), the linked subject inside the receiver's course read by id and never cached, `link:<subject_id>` progress through `linkKey()`, the pet's linked entries, the reminder from the six subject-saving paths; no migration, no route, no SQL | the subject delete confirm's *permanently* in the company library (measured by reading; walkthrough 84, Q2); the pet has no lesson to read while a linked subject is open (review round 1, finding 5) | nothing. |
| Post-overhaul R1 (2026-10-27; `po/r1-rabbit-robustness` into `feat/post-overhaul-edit-versioning`) — R.A.B.B.I.T. robustness (`docs/sessions/PLAN_TO_1_0.md` night 2), each item measured before it was fixed: Levels and Experiences take the Scenes rows' write gate; Replace link is one undoable step that loses nothing (the provider's `rewireDependency`, waiting its turn in the undo queue, a write after a project switch kept off another project's bundle); migration 0101 (a bid version's thin `{id, project_id}` event on the project channel; an assigned task's items on the workspace channel, never a private project's) with suite 104, 25/25 on wilson-dev, both on dev only (staging is the controller's, from the Desktop kit); every cloud file read (`listFilesWith`); the Dashboard's `task_items` listener; the Tasks CSV as the table shows it; the Rate card and Team members at 1280 and 1440 with the kit's compact cells (`Table compact`), Team members' badges wrapping under the name; two review rounds on Fable (round 1: 2 MEDIUM, 2 LOW; round 2: 1 MEDIUM, 2 LOW), every correction with a failing control. | R1-L1 to R1-L4 (R1's left-open section, at the end); S3b-02 widened to a level's and an experience's windows. | S5-02, DG1-01, "A dependency rewire deletes before it links", "Levels and Experiences have no write gate", "The Dashboard shows a task's assets as of its last load", "The Tasks CSV export leaves out the asset and the bid"; P1-30 struck with its dated line; P1-29 kept with its dated line, one cut left (R1-L3). |
| Post-overhaul S1 (2026-10-27; `po/s1-reconnect` into `feat/post-overhaul-edit-versioning`) — night 2's reconnect after a hung session check (`docs/design/RECONNECT_DESIGN.md`: the watchdog aborts a request at its budget, the SDK keeps the session and retries by itself, the strip says *reconnecting…* and pings the service that hung, the client module refuses a data request carrying the anon key while signed in, R.A.B.B.I.T.'s dot shows the same word) and the two-factor enrolment overflow, measured closed (506.89px in a 544px well at 824 and 700 tall, Chromium and Electron alike; the shell's 544px floor of 2026-09-11). | **S1-01** (two tabs, one refresh token; INFERRED). | *One hung `getSession()` pins the whole app's auth* (fixed by the build; its two wrong claims recorded in the S1 section) and *The two-factor enrolment screen overflows the sign-in shell's band at laptop heights* (measured closed). |
| Post-overhaul B1 (2026-10-27; `po/b1-subject-shares-server` into `feat/post-overhaul-edit-versioning`) — subject shares, the server (`docs/sessions/PLAN_TO_1_0.md` night 2; the design's §6.1): migration 0100 copied whole from the design's Appendix A (the table, the one SELECT policy, the guard trigger, the consent helper's chain walk, the six functions, the index, the audit lines, the post-conditions), 0065 removed in the same commit; suite 103 (446 probes, 446/446 on wilson-dev; the failing controls of the design's §4 and §10, and of the two review rounds' corrections, run once each against the final suite, 33 in all); `otter_subject_shares` into `rls.yml`'s `RLS_TABLES`, its `KNOWN_UNCOVERED` line gone with 0065; the adapter's seven operations under `/api/otter/subject-shares` and `/api/otter/subjects/:id`, `id` on the subject wires, `export.all`'s `linked_subjects`; the fixtures answer the six ops as nominations; 0100 applied to wilson-dev by query with its history row (md5 recorded in the hand-off; staging is the controller's); the avatars entry narrowed by measurement (the four policies, the claim function, the client's path), no 0102 since the cause is not proven; two review rounds on Fable. | **nothing new**; the avatars entry rewritten to what remains. | nothing. |
| Post-overhaul DG3 (2026-10-27; `po/dg3-dog-closed-list` into `feat/post-overhaul-edit-versioning`) — D.O.G.'s closed list (`docs/sessions/PLAN_TO_1_0.md` §3: DG2-01, DG2-02) and Audrey's two answers of 2026-10-27: a press on either Generate button keeps focus in its box, so the box does not shrink under it and the click lands; Choose file a kit button (Tab, Enter and Space, named *Choose file*; the 20th upload from the keyboard hands focus to its Remove); card 1's field label *Choose a project*; the main region's ring drawn inside its own box on every page, R.A.B.B.I.T.'s shell redrawing it above itself. No migration, no Edge Function. Walkthrough 81. | DG3-03 (on D.O.G. the ring loses its top or bottom side where the output card crosses the column's edge; review round 2, MEASURED), DG3-04 (right after a click on Generate, Alt is the box's; review round 2, MEASURED). Comment markers: 4 → 4. | **DG2-01 fixed**, **DG2-02 fixed** (the DG2 section with them), **FX15-03 fixed** (her ruling, "Keep it everywhere"). |
| Post-overhaul FX15 (2026-10-26; `po/fx15-fx14-leftovers` into `feat/post-overhaul-edit-versioning`) — FX14's leftovers, Audrey's choice of 2026-10-26: four more R.A.B.B.I.T. test mounts out of the gap, each with a CONTROL that holds it open; D.O.G.'s 20 settings headers (16 places in the source) say whether their section is open; one main region exposed on every page (PageSurface, the hidden pages and the two tools' own mains `hidden` off screen); D.O.G.'s Project and layout dropdowns named; a bounded retry on 502/503/504 in the ai-files CI probe. No migration, no Edge Function. Walkthrough 79. | FX15-01 (D.O.G.'s render-test harness could press Enter before D.O.G. had the upload; MEASURED; found by DG2 as well and fixed there, `91eee254`, so removed at FX15's merge), FX15-02 (Single page's Page # and Page Request named by their placeholders; pre-existing), FX15-03 (on R.A.B.B.I.T. the main region's focus ring is cut off; Audrey's call), FX15-04 (at least 13 more R.A.B.B.I.T. test files mount in the same gap; three of them measured, 101 of 131 tests red in it; review round 1), FX15-05 (the closed nav strip's items are Tab stops and screen-reader buttons on every page; pre-existing, review round 1), FX15-06 (Help's navigation and O.T.T.E.R.'s side panel are unnamed landmarks; pre-existing), FX15-07 (D.O.G.'s settings headers are named by their label and description, block content in a button; pre-existing), FX15-08 (a page chosen from the nav strip by keyboard leaves focus on `<body>`; pre-existing, review round 2). Comment markers: 4 → 4. | **FX14-01 fixed** (the four mounts render inside act and wait for the provider's status past `unavailable`; forced into the gap 25 of 50 tests failed before, none after), **FX14-02 fixed**, **FX14-03 fixed**, **FX14-04 fixed** (Single page's layout dropdown too). The FX14 section with them. **DG2-03 fixed** (after FX15's review rounds: the probe's messages call, no-sign-in request and operator's summary go through the same retry as step 1 and `call()`). |
| Post-overhaul DG2 (2026-10-26; `po/dg2-uploads-in-references` into `feat/post-overhaul-edit-versioning`) — Audrey's ask of 2026-10-26: D.O.G.'s Upload Documents section moves into card 2, References, as its first group of rows (each upload a row with its glyph, name, size and Remove; Choose file at the group's foot), so the card reads as one list of what the AI reads; card 1 becomes *1 Project*. What is read, sent, counted and let go of unchanged (the meter measured identical before and after). Review round 1's corrections: a Remove pressed from the keyboard keeps focus in the list (focus on the page made the next Enter a deck), the upload's refusal is said under Choose file, *Remove all references*; round 2's: the notice's Undo and Dismiss the same, the refusal cleared by a generation and announced again when repeated. No migration, no Edge Function. Walkthrough 80. | DG2-01 (D.O.G.'s Choose file is not reachable by keyboard and has no accessible name; pre-existing, MEASURED before and after), DG2-02 (a click on Generate full deck outline with the deck context box focused is lost: the box shrinks under the press; pre-existing, MEASURED), DG2-03 (the CI probe's no-sign-in request failed the smoke job on an upstream 504 on DG2's merge; MEASURED). Comment markers: 4 → 4. | — |
| Post-overhaul FX14 (2026-10-26; `po/fx14-fx13-leftovers` into `feat/post-overhaul-edit-versioning`) — FX13's leftovers, Audrey's choice of 2026-10-26: D.O.G.'s three card title bars fold from the keyboard (a kit IconButton in each header, named by the heading's words); the kit toast holds while keyboard focus is in it and gives focus back when it leaves; the two flaky CI tests, one cause established (each mount could return in the gap between the commit that brings the project and that commit's effects) and fixed in their mounts. No migration, no Edge Function. Walkthrough 78. | FX14-01 (four more R.A.B.B.I.T. test files mount in the same gap; INFERRED), FX14-02 (D.O.G.'s settings drawer's 16 folding sections have no `aria-expanded`; pre-existing), FX14-03 (only D.O.G. and O.T.T.E.R. have a main region, so the toast's focus return has none elsewhere), FX14-04 (D.O.G.'s Project dropdown has no name; pre-existing, found by review round 1's measurement). Comment markers: 4 → 4. | **FX13-01 fixed** (the card title bars by keyboard), **FX13-02 fixed** (the kit toast and keyboard focus), **FX13-03 fixed, both halves, each with its cause** (the drop test's band cannot be late, the regroup draws it in the same act; reproduced locally, the regroup wiped by the provider's pending drafts reset (CI's record is cut off before the Group menu), so FX13's proposed longer wait would not have cured it; the views test's body was past Loading because the status still read `unavailable`, not because of the clock). The FX13 section with them. |
| Post-overhaul FX13 (2026-10-26; `po/fx13-dog-enter-key` into `feat/post-overhaul-edit-versioning`) — D.O.G.'s Enter key, Audrey's answers of 2026-10-26: with Full deck on, Enter starts a full deck only when the deck context box has words (empty: nothing generates, the box gets focus, the toast stack says why; the Generate button, Single page and the regenerate box untouched); Enter on the Single page / Full deck switch moves it; the Alt key kept; the preview's "recorded" line. No migration, no Edge Function. Walkthrough 77. | FX13-01 (D.O.G.'s card title bars fold only with a pointer; pre-existing, found by review round 1), FX13-02 (the kit toast's timer ignores keyboard focus, and a toast that leaves with focus inside drops it to the page; pre-existing, found by review round 2), FX13-03 (VW1m's Tasks-table drop test still fails on CI some runs; measured on FX13's branch push). Comment markers: 4 → 4. | **DG1b-01 closed by her ruling of 2026-10-26: keep** (*"Keep it as it is"*: Alt flips the switch from any page, as before; nothing built). **DG1b-02 fixed**: the preview says a read is recorded only when it downloads. A dated note on P1-04 (her ruling covers Alt from any page; Alt behind an overlay stands). |
| Post-overhaul VW1e (2026-10-25; `po/vw1e-custom-views-tables` into `feat/post-overhaul-edit-versioning`) — custom table views, the build, part 4, the last: the views on Assets, Levels, Experiences, Scenes and Shots (the design's §7 step 5, to her answers): step 0's review of the design's parts against the code (16 findings, corrected in the design); migration 0099 / suite 102 (an asset's levels and experiences on the cloud; applied to wilson-dev by query, staging's lines in the Desktop kit), the adapter's probe and the move to the cloud; the shared piece on the five tables (combination groups and Create grouping, the columns in front of the name, the Gallery's card fields, two lists on Scenes and Shots, List order, defects 3 and 4); the browser's old views removed (Q17); walkthrough 72 part 4; two review rounds on Fable (10 findings, then 6 attacking the first's corrections), every correction with a failing control | dated notes on **P1-08** (narrowed to Budget's Expenses and Team), on *on the desktop, the browser's own storage most likely starts empty at every launch* (the five tables' keys removed) and on *Levels and Experiences have no write gate* (the views and the drag read it now) | **The Assets table sorts the provider's own array in place** (fixed by step 1, `dcc898b8`; proven in `19b40ad9`). Comment markers: 4 → 4. |
| Post-overhaul FX12 (2026-10-25; `po/fx12-ai-file-store-cleanup` into `feat/post-overhaul-edit-versioning`) — the AI's file store forgets what D.O.G. sent it (OUTSTANDING DG1-03): `ai-files` gains DELETE (a member's own ids; an admin's sweep of the workspace's files older than 24 h) and GET (this workspace's ids, times and sizes, never a filename), `operator-ai-files` the operator's counts and sweep, both on wilson-dev only; a row counts only when it binds to the stored file, certificates in the admin stream; D.O.G. lets go when a file or reference leaves, at sign-out and when the desktop closes (which waits, measured), never after a generation; uploads expire in 24 h and reach the store under a neutral name; the Admin Terminal's card and the operator's section; the CI probe signed in as the smoke admin. Two review rounds on Fable (8 findings, then 9). No migration. Her three answers verbatim in the hand-off. | FX12-01 (pre-FX12 uploads on staging and production until the deploy and a sweep; attribution ends 2026-11-09). VW1m's drop test, which failed under this branch's heavier run, now waits for its drop target (a commit, not an entry). Comment markers: 4 → 4. | DG1-03 (closed by FX12: the merge `07f30a4f` into `feat/post-overhaul-edit-versioning`). |
| Post-overhaul VW1d (2026-10-25; `po/vw1d-custom-views-tasks` into `feat/post-overhaul-edit-versioning`) — custom table views, the build, part 3: the views on the Tasks table (the design's §7 step 4, to her answers): step 0's review of the design's screen parts against the code (18 findings, corrected in the design); the Views button with its list and four cards in place, the shared filter row, the *changed for now* bar, the last used view, Create grouping and the project's groupings on Tasks and the Timeline, one New menu; the browser's old Tasks views removed (Q17); kit requests VW1-KR-1 (Popover in place), VW1-KR-3 (MenuButton into the kit) and VW1-KR-4 (Banner `live={false}`), each with its caller; walkthrough 72 part 3; two review rounds on Fable (16 findings on use and the keyboard, then 12 with a security pass on the view's filters), every correction with a failing control; no migration | dated notes on **P1-08** (the Tasks menu replaced) and on *on the desktop, the browser's own storage most likely starts empty at every launch* (the Tasks views no longer kept there) | nothing. Comment markers: 4 → 4. |
| Post-overhaul VW1c (2026-10-17; `po/vw1c-custom-views-data` into `feat/post-overhaul-edit-versioning`) — custom table views, the build, part 2: the views' and groupings' data, with no screen yet (her Q1, Q2, Q4, Q-D2): step 0's review of the design's §5 against the code (19 findings, corrected in the design); migration 0098 (`table_views`, `item_groupings`, `user_settings.table_view_last` with `set_table_view_last`; RLS forced, column grants, the SECURITY DEFINER sweep of a deleted item, `reorder_table_views`, the broadcast with eighteen tables) and suite 101, applied on wilson-dev only; the rules (`state/tableViewsModel.js`) and their CommonJS twin, the Local Server's `electron/rabbitTableViews.cjs` and the machine's own settings file, the cloud adapter's probe and verbs, the dev fixtures, Drive, the takeout, the move to the cloud, the provider's `state/tableViewsState.js` and the live merge; walkthrough 72 part 2; two review rounds on Fable, the first with a security pass | nothing | nothing. Comment markers: 4 → 4. |
| Post-overhaul VW1b (2026-10-17; `po/vw1b-custom-views-build` into `feat/post-overhaul-edit-versioning`) — custom table views, the build, part 1 (Audrey: "please make sure it either shows all or none. additionally, i can see the levels or scenes or shots related"): step 0's design review (21 findings); the Tasks table's Asset, Scene, Shot, Level and Experience columns, each cell every item by name with "+N" and a picker that ticks several (a draft, committed once, one undo step); combination groups by every kind; the checkbox and Title kept in place while the table scrolls sideways (kit requests VW1-KR-1 Popover and VW1-KR-2 sticky columns); widths from the columns on screen; her Q-N1a and Q-N1b sorts; the Levels, Experiences and scene window counts; walkthrough 72 part 1; two review rounds | nothing | **two:** *the scene window's SHOTS / ASSETS / TASKS line counts no asset* (`aa270f73`: it counts `scene_ids`) and **P1-26** (struck through: the Assets half, `aa270f73`). Comment markers: 4 → 4. |
| Post-overhaul DG1b (2026-10-17; `po/dg1b-references-answers` into `feat/post-overhaul-edit-versioning`) — D.O.G.'s references, Audrey's last six answers (batches 5 and 6 of `docs/design/DOG_REFERENCES_QUESTIONS.md`, asked in chat as multiple choice, verbatim there, Q19's conflict between her Q14 and Q2 put in plain words): five confirmed DG1's provisional picks; Q21 changed one, D.O.G. opens on Full deck. No migration (Q12 needed none; 0099 / suite 102 stay unused). Walkthrough 75 §6. | DG1b-01 (D.O.G.'s Alt key flips its switch from any page; found while checking Q21; **closed by her ruling of 2026-10-26: keep**, FX13, nothing built), DG1b-02 (the preview says a cached read is recorded; found by review round 2; **fixed by FX13**); neither fixed here, both outside her answers | nothing |
| Post-overhaul VW1m (2026-10-16; `po/vw1m-no-main-item` into `feat/post-overhaul-edit-versioning`) — no main item (Audrey: "lets not have main asset be a thing. thats not needed and i dont like."): every place a task's main item was read measured first (289), her batch 14 answered (batches 15-16 to interim choices), migration 0097 and suite 100 on wilson-dev (deleting an asset never deletes a task; an older app's single write adds), the Timeline's combination rows, the Budget's even split, the task window's Sort and Files per item, the Tasks table and Board by combination, the Dashboard, bid versions keeping every item; walkthrough 74; two review rounds | **one entry under Broken features:** *the Dashboard shows a task's assets as of its last load* (INFERRED); dated notes on *the desktop's browser storage* (the Items sort is kept there too), *grouping Tasks by Phase or Assignee* (its Asset half fixed) and P1-26 (its Tasks half fixed) | **two:** *on the desktop, a deleted asset's tasks come back when the project is read again* (no backend deletes or hides a task with its asset now: 0097, the provider, the live merge) and **S5b-07** (*an asset whose task is set aside cannot be deleted*: the refusal went with its reason). Comment markers: 4 → 4. |
| Post-overhaul DG1 (2026-10-16; `po/dg1-dog-references` into `feat/post-overhaul-edit-versioning`) — D.O.G.'s references (Audrey: "a robust way to choose ... items in the rabbit tool ... files or personal notes"; "lets make the Full Deck and Single Page interfaces one"): research, her answers (batches 1 to 4 verbatim; 5 and 6 left for tomorrow at her request, built on the recommended picks), the design reviewed twice, the build reviewed twice. | DG1-01 (the cloud lists a project's first 1,000 files only), DG1-02 (on the Local Server an item's own files are not linked to it), DG1-03 (the AI's file store keeps what D.O.G. sends) | — |
| Post-overhaul FX11 (2026-10-16; `po/fx11-connection-dot` into `feat/post-overhaul-edit-versioning`) — one connection dot in the bottom-left corner of every R.A.B.B.I.T. tab, just above the orange bar (Audrey: "this green dot should clarify that the system is connected to the storage solution not just the databases on supabase"): green when the database AND where the files are kept answer (a real, bounded, abortable probe of each: Petal cloud's bucket, a company bucket through storage-presign, the desktop's new `GET /api/rabbit/connection` for the Local Server and a NAS), amber when only the database does, red offline, a diamond and a square besides the colour, the words on hover and on a press (a toggletip), a change announced once; the project bar keeps the name and status left and the faces then Switch right (no LIVE, no adapter dot); the Dashboard's Live badge gone; the Bins counter 24px up (walkthrough 73); two review rounds on Opus, every finding fixed | **nothing.** Every finding of the two rounds was fixed in the session; the trade the corner makes (its cell sits over the left of a list's very bottom row) is the walkthrough's known limit, by her placement, not a fault | nothing |
| Post-overhaul VW1 (2026-10-13; `po/vw1-custom-views` into `feat/post-overhaul-edit-versioning`) — custom table views, research and questions first (Audrey: "lets do a research phase first, then ask me any questions to clarify things and not make any assumptions"): how Notion builds views (`docs/design/CUSTOM_VIEWS_RESEARCH.md`), the five tables measured at 1280 and 1440 (`scripts/vw1-shots.mjs`), 25 questions answered in eight batches and recorded verbatim (`docs/design/CUSTOM_VIEWS_QUESTIONS.md`), the design written to her answers (`docs/design/CUSTOM_VIEWS_DESIGN.md`); no product code (the build is VW1b onward) | **five entries under Broken features, found by the research and ruled for later (her Q19, Q21):** *on the desktop, the browser's own storage most likely starts empty at every launch* (INFERRED); *the Tasks CSV export leaves out the asset and the bid* (INFERRED); *Budget's Expenses: the Linked task filter's "Untitled" and the stale per-project views* (INFERRED); *grouping Tasks by Asset, Phase or Assignee drops a task whose value is not in the project's list* (INFERRED); *the Assets table sorts the provider's own array in place* (INFERRED). **P1-08 and P1-26 are wider than recorded** (dated notes on each, MEASURED); the defects inside the views' own controls (a new filter row empties the table, MEASURED; a filter row keeps the wrong condition; Scenes and Shots share filters and sorts; ticked rows hidden by a filter) are scheduled in the design's §4.8, not entered here | nothing |
| Post-overhaul FX10 (2026-10-13; `po/fx10-date-fields` into `feat/post-overhaul-edit-versioning`) — the date fields (Audrey: "the calendar icon is covering the dates when it has all the space to space them out"): every date and the empty `mm / dd / yyyy` whole, the calendar icon clear and spaced, in the desktop app and in Firefox (her screenshot's), by one kit rule — a date field's floor, the date's room plus its own padding (FX10-KR-1) — with the Tasks, Assets and Shots date columns widened and four windows' rows reshaped; display only, no migration; walkthrough 71; two review rounds | **three entries under Broken features:** *under a minimum font size the tables' dates are cut again* (MEASURED, round 1's R1-07: FX10's floor and the tables' columns are px); *the project control panel's 24 fields have no accessible name* (MEASURED; older than FX10; round 1's R1-12 named the dates); *in the smallest desktop window, an open task form leaves a shot's take notes no room* (MEASURED by the measuring script's neighbours pass; older than FX10). Round 2's R2-03, the desktop app's table dates losing the keyboard's focus at their calendar glyph (older than FX10), was fixed, not entered | nothing. Comment markers: 4 → 4. |
| Post-overhaul FX9 (2026-10-12; `po/fx9-reach-test-race` into `feat/post-overhaul-edit-versioning`) — the gateway's reach-proof test holds the gateway's syncs instead of racing them (`gateway/test/runtime.test.mjs` only; no product code): the race measured (the sync a `check_reach_now` asks for when its reach check lands, 17 ms after it idle; not the 10 s heartbeat), the window read whole in one assertion, two planted door faults caught, 200 loaded runs with no reach failure; one review round (opus) | **nothing under Broken features.** A dated FX9 line on FX3's gateway-load entry (two 5 s time-outs at a heavier load, one echo-probe miss in 200 runs with its cause not established; not FX9's code) | **one entry:** *The gateway's reach-proof test races the gateway's own sync, and fails CI now and then* — the test holds the syncs (`54472510`) |
| Post-overhaul FX8 (2026-10-12; `po/fx8-table-row-actions` into `feat/post-overhaul-edit-versioning`) — the tables' row buttons (Audrey: "lets have uniformity and have the same icon ... lets move them all closer to the title of the items in the tables"): one page icon opens an item's window everywhere ("Open <name>"), every row's buttons right after its title in one order (Open, the row's own, Delete last) through the kit's RowTitle (FX8-KR-1), the actions columns gone, the title column at most 360px in Tasks, Assets, Levels and Experiences with the other columns taking the rest (walkthrough 70); two review rounds | **two entries under Broken features, found by the review rounds and older than FX8:** *Levels and Experiences have no write gate* (INFERRED, round 1); *on a touch screen the row checkboxes and the Assets cards' buttons stay invisible until tapped* (MEASURED, round 2). The rows FX8 measured and left (the Shots table's sideways scroll, walkthrough 47 Q185; the nested shots' at 1280, P1-63; the Budget's expenses, Talent, Team, Files, relations and shot-list window rows) are tracked where they were or are walkthrough 70's questions | nothing |
| Post-overhaul FX6 (2026-10-12; `po/fx6-status-line-weight` into `feat/post-overhaul-edit-versioning`) — the status line under every item popup's title, thicker (Audrey: "lets make the line thicker it feels to thin"): 3px, from 2, 3 and 4px rendered on every tone on both grounds at 1280 and 1440, set in the kit's one `.ui-status-banner` rule, on `typeScale.test.js`'s hand-judged list with her words; client only, no migration; walkthrough 68; two review rounds | **one entry under Broken features:** *under forced colours (Windows High Contrast) a status dot is painted out, and every kit tab is underlined* (MEASURED in Chromium's emulation; not FX6's code; found by its review round 1, R1-04). A dated FX6 line on FX3's gateway-load entry (`release.test.mjs`'s two tests in the first full run at the cut; not FX6's code) | nothing. Comment markers: 4 → 4. |
| Post-overhaul FX7 (2026-10-12; `po/fx7-timeline-header-labels` into `feat/post-overhaul-edit-versioning`) — the Timeline's PROJECT and Bid ver. labels (Audrey: "bid ver and project should be same sizing and color. if anything project should stand out more. lets remove the folder icon before the word project"): both the kit's `ui-field-label` in one column (5.1em of the label, 56.1px at 11px), so the project's name and the dropdown start at one x; no folder icon (the project title bar, every tab); the name a step above the dropdown and, since review round 1, above the version's name in the bar's words (now regular weight; the Budget tab's row keeps its bold); client only, no migration; walkthrough 69; two review rounds (every finding fixed, or named in the hand-off) | **nothing new.** A dated FX7 line on FX3's gateway-load entry (an `acme.test.mjs` test failing once in the merged tree's full run, passing alone; not FX7's code). Nothing broken was found in FX7's own work. Walkthrough 69's one question (keep the version's name regular on the Timeline, or bold again) and the figures band's own TIMELINE title (its icon, the darker grey; a section title in `TimelineView.jsx`, left as it is) are choices, recorded in the hand-off (`docs/sessions/handoffs/po-fx7-2026-10-12.md`) | **nothing.** Comment markers: 4 → 4. |
| Post-overhaul FX4 (2026-10-12; `po/fx4-edits-update-in-place` into `feat/post-overhaul-edit-versioning`) — an edit changes in place (Audrey: "when i make changes to an edit, it should start to edit the current selected edit"): a change to a saved edit asks nothing, Save edit writes into it, Save as… is the only new version, the list's "Save edit as…" reads "Save as…" again; the edit write made conditional on every backend; client-only, no migration; walkthrough 67; two review rounds | **one entry under Broken features:** *the gateway's reach-proof test races the gateway's own sync, and fails CI now and then* (MEASURED: two of FX4's CI runs, one on a commit with no product code; not FX4's code). A dated FX4 line on FX3's gateway-load entry (the tests seen timing out under load in FX4's full runs). **S3c-05** gains an FX4 note (Save edit from the leave question saves a saved edit's changes into it) | **S3c-09, struck through:** untrue since BC1 (`0b38077c`) — the cloud's Scenes tab binds Ctrl+Z (FX4's review round 1, R1-04); Help's Undo card corrected. Comment markers: 4 → 4. |
| Post-overhaul FX2 (2026-10-12; `po/fx2-task-multi-links` into `feat/post-overhaul-edit-versioning`) — a task relates to many items (assets, scenes, shots, levels, experiences): item 1 measured before building (the brief's table name was taken; the cloud never had a level or experience column), migration 0096 and suite 99 on wilson-dev (`task_items`, the single columns kept in step both ways), the adapters, the Local Server, the fixtures, the provider, the task window's Items table, walkthrough 65; two review rounds, the second finding that round 1's bundle wrapper nulled a revived task's links | **two entries under Broken features, both found in passing and not FX2's:** *the scene window's SHOTS / ASSETS / TASKS line counts no asset* (MEASURED) and *on the desktop, a deleted asset's tasks come back when the project is read again* (INFERRED); the migration entry gains a sentence (a task's asset, scene and shot items move; its level and experience items stay with the levels and experiences) | **nothing.** Every finding of the two rounds (six in round 1, seven in round 2, one High each) was fixed in the session or is a named limit in the hand-off's "Known limits" (`docs/sessions/handoffs/po-fx2-2026-10-11.md`). Comment markers: 4 → 4. |
| Post-overhaul FX1 (2026-10-12; `po/fx1-shot-frame-count` into `feat/post-overhaul-edit-versioning`) — the shot's frame-count field (Audrey's "the chevrons are covering up the numbers"): every number field of the shot rows and the popups is `views/scenes/NumberField.jsx`, the browser's spinner put away, its own chevrons clear of the figure, five figures and an ellipsis past that; display only, no migration; two review rounds | **two entries under Broken features:** *the Tasks table's Bid days field hides a figure's first characters behind the browser's arrows* (MEASURED: 12.5 reads 2.5 while focused; found while measuring where else FX1's defect lives; the Tasks lane's), and *a held number field fills R.A.B.B.I.T.'s undo history* (MEASURED by review round 2: ten undo steps, one per step of a hold; the browser's spinner did it too; `RabbitProvider`'s). A dated note on P1-03 (Home's document keydown listener): until FX3's fix reached FX1's branch it also cancelled the arrow keys in every number field and select, and Enter after one of them left the page from a shot's Frames field (MEASURED by FX1's review round 1). | **P1-03, marked FIXED**: by FX3 (`35265888`), which merged into the integration branch before FX1; measured by FX1 after its merge (`b531a799`): the arrow keys step the Scenes number fields and Enter stays on the page. Comment markers: 4 → 4, still pairing. |
| Post-overhaul FX3 (2026-10-12; `po/fx3-banner-version-bar-team-gallery` into `feat/post-overhaul-edit-versioning`) — the status banner back under every item's title, the Timeline's bid version bar under the project title ("Bid ver."), "Save edit as…" on the Scenes tab, the Team tab's Table / Gallery with signed profile pictures (walkthrough 66); two review rounds | **one entry under Broken features:** *the gateway's tests fail under the full suite's load on Windows, and its journal's rewrite once threw an unhandled EPERM* (MEASURED in this session's full runs; not the session's code). Everything FX3 leaves undone otherwise is a named limit or a question in its hand-off (`docs/sessions/handoffs/po-fx3-2026-10-12.md`), none of it broken | nothing. Comment markers: 4 → 4. |
| Post-overhaul GW4 (2026-10-11; `po/gw4-gateway-release` into `feat/post-overhaul-edit-versioning`) — the file gateway's release and install stories: the release signing key (its public half in slot 1, its private half in one Desktop file for Audrey) and the channel on GitHub Releases, the release workflow and its one dry run (a draft left for Audrey), the outside door's free certificate (ACME TLS-ALPN-01) proven against Pebble in CI, the two install stories as Help pages, the hardening guide, walkthrough 63; two review rounds, both security attacks on the release path | **nothing.** Every finding of the two rounds (six in round 1, eleven in round 2; five Medium in all) was fixed in the session or is written down in the hand-off (`docs/sessions/handoffs/po-gw4-2026-10-11.md`): its "Deferred" (Authenticode in an approved environment, a second release key, an administrator's check of an MSI), its "For GW5" (two other workflows' token, the pushed image run) and its "Known limits"; what is Audrey's (the key's secret and its environment, three repository settings, the draft, the first tag, the rehearsal) is in its "Waiting on Audrey" | **nothing.** Comment markers: 4 → 4. |
| Post-overhaul GW3 (2026-10-11; `po/gw3-gateway-web` into `feat/post-overhaul-edit-versioning`) — the file gateway in the web app: the two halves reconciled first (the workspace id in both answers, the reach PROOF on both halves proven by the design's `proof_vector`, a new or next root landing at sync, a viewing's fraction as the gateway's coverage; migration 0095 and suite 98 on wilson-dev), then the Bins tab in a browser playing through a gateway (the adapter, `canStream`, the hand-over, the overlay through the outside door, one clip's viewings, the words and Help, walkthrough 62), measured against GW2's real executable with the fake cloud on loopback; two review rounds | **nothing.** Every finding of the two rounds (sixteen in round 1, eighteen in round 2, two Medium each) was fixed in the session or is a named limit in the hand-off's "Known limits" (`docs/sessions/handoffs/po-gw3-2026-10-11.md`). The office door is not played from the gateway's own computer (by design), the install stories are GW4's, the attack on the player GW5's | **one entry removed from Broken features:** *the cloud's reach check and GW2's gateway disagree* — closed by item 0.2: the gateway's outside `/v1/health` answers `nonce_proof` (never `nonce_echo`), the cloud reads only the proof, and both halves prove the same `proof_vector` in one `npx vitest run`. GW2's pin on this log is loosened to "GW2's row is in the log" so this row sits on top. Comment markers: 4 → 4. |
| Post-overhaul GW2 (2026-10-10; `po/gw2-gateway-service` into `feat/post-overhaul-edit-versioning`) — the file gateway program (`WILSON/gateway/`: the two doors, the tickets, the share rules, the cloud client against a fake cloud, the Windows service and its MSI, the container, CI); two review rounds, both security attacks on the program | **nothing.** Every finding of the two rounds was fixed in the session or is a named limit in the hand-off's "Known limits". Where GW1's functions and the gateway differ (first: neither of GW1's answers carries the workspace id, so the gateway would refuse every ticket) is GW3's planned work, listed in the hand-off's "For GW3": neither half is merged with the other, and nothing a person uses calls either yet | nothing. Comment markers: 4 → 4. |
| Post-overhaul GW1 (2026-10-10; `po/gw1-gateway-cloud` into `feat/post-overhaul-edit-versioning`) — the file gateway's cloud side: migration 0093 and suite 96 (on wilson-dev), the five gateway functions (on wilson-dev), App settings → Storage → File gateway, the file drawer's *Viewed from outside* and the Bins inspector's admin line; two review rounds | **one entry under Broken features:** *the cloud's reach check and GW2's gateway disagree* (MEASURED by both halves' tests, review round 2: GW2's gateway answers `nonce_echo`, the cloud reads only `nonce_proof`; fails safe, nothing published). What GW1 leaves undone otherwise is the gateway program (GW2) and playing in a browser (GW3), and its known limits are in its hand-off (`docs/sessions/handoffs/po-gw1-2026-10-10.md`), none of them broken | **nothing removed;** two fix shapes re-pointed: BC3's *a location's address admits control characters* and *no sample rate or channel count in the cloud* each said *a migration (0093 or later)*, and 0093 is now the file gateway's, so they say 0095 |
| Post-overhaul BC4 (2026-10-09; `po/bc4-gateway-design` into `feat/post-overhaul-edit-versioning`) — the file gateway's design, design first, no product code (`docs/design/GATEWAY_DESIGN.md`); two review rounds, both security attacks on the design | **nothing.** No product code and no migration were written; the 47 findings of the two rounds and their corrections live in the design's own review history, and the decisions it made for Audrey are questions in its hand-off | nothing |
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

- **P1-02 · Space opens O.T.T.E.R.'s Search from any focused control** that is not a field, and can stack Search over an open Dialog or Drawer (`Otter.jsx` global shortcuts). MEASURED. From A4-2. S2a (2026-09-30): the same on the Help and Settings buttons S2a added to O.T.T.E.R.'s strip; Enter presses them (MEASURED, S2a review round 1).
- **P1-04 · D.O.G.'s document keys act behind its overlays** (Alt toggles Full deck; ←/→ switch the page). MEASURED. Needs a C1 ruling. From A4-4. S2a (2026-09-30) narrowed D.O.G.'s Enter only (`enterGenerates.js`: never on another page, never over a drawer, dialog or kit overlay). Alt, ←/→ and Ctrl+Z/Y also have no page check (`DeckOutlineGenerator.jsx` ~3206–3290), and D.O.G. stays mounted, so they act from every page: Ctrl+Z on O.T.T.E.R.'s page, outside a field, undoes D.O.G.'s last text edit unseen. INFERRED from the code; would settle it: a text edit in D.O.G., then Ctrl+Z on another page, then back. S2a gave D.O.G. its `currentPage`, so each handler can gate on it in one line. **FX13 (2026-10-26):** Audrey ruled on Alt from any page, *"Keep it as it is"* (DG1b-01 closed). Alt behind an overlay was not put to her and stands here, MEASURED again by FX13's review round 2 (the settings drawer open, one Alt release flipped the switch; the Help window open, it flipped back), as do ←/→ and Ctrl+Z/Y.
- **P1-05 · A dialog opened from a kit Menu returns focus to `<body>`** on close (A4 fixed its own two callers). MEASURED. Owner: the kit. From A4-11.
- **P1-06 · Focus falls to `<body>` after an inline edit commits or reverts** (`EntityListView`, `ProjectTasksView`, `ScenesView` InlineText). MEASURED. From B4c-10, B5b-32.
- **P1-07 · Budget's period popover does not return focus to its cell** when it closes itself. MEASURED. From B5b-8.
- **P1-08 · Saved-views rows are divs: mouse only** (`ExpenseSavedViewsDropdown`, `TeamSavedViewsDropdown`; the five tables' menus replaced by VW1d and VW1e). MEASURED. From B5b-9, B5b-22. **Wider (VW1's research, 2026-10-13, MEASURED with `scripts/vw1-shots.mjs`):** all six saved-views menus have it — Tasks, Assets, Scenes, Levels and Experiences (each saved row a `div` with no role and no tab stop; only its delete ✕ is a button) and Team (from the code); Escape closes none of the five measured. VW1 replaces the five tables' menus with the new Views dropdown (its build sessions, `docs/design/CUSTOM_VIEWS_DESIGN.md` §4.9); Expenses and Team keep theirs (Audrey, VW1's Q19). *(2026-10-25, VW1d: the Tasks table's menu is gone, replaced by the Views dropdown, a grid with one Tab stop, the arrows between its rows and Escape closing it, tested in `views/tableViews/tasksViews.test.jsx`; Assets', Scenes', Levels' and Experiences' menus follow with VW1e; Expenses' and Team's stay.)* *(2026-10-25, VW1e: the Assets, Levels, Experiences, Scenes and Shots menus are gone too, replaced by the same dropdown (`views/tableViews/assetsViews.test.jsx`, `entityViews.test.jsx`, `scenesViews.test.jsx`). Left: Budget's Expenses (`ExpenseSavedViewsDropdown`) and Team (`TeamSavedViewsDropdown`), kept by her Q19.)*
- **P1-09 · Escape discards unsaved drafts** in ~~the Scenes popups,~~ `ExpensePopup` and the Timeline's Settings (the kit Dialog's `onBeforeClose` could ask). MEASURED. Owner: Audrey, then a session. From B5b-28, B3d. **The Scenes popups' part FIXED by post-overhaul S3b** (2026-10-01, `po/s3b-shot-lists-ui`, D21): closing a scene or shot popup (✕, Close, Escape, the backdrop) with a changed description or notes, or Escape in a changed box, asks "Discard your changes?" first, Cancel focused. Left there: S3b-04 and S3b-05 below.
- **P1-10 · Keyboard scrolling hides the focused row or cell** (the Bins list under its sticky head; Crew/Talent period cells past the scroller's edge). MEASURED. Owner: a session and the kit (scroll padding, B5b-KR-5). From B4c-13, B5b-7.
- **P1-11 · A minimap bar drag does not save.** MEASURED. Owner: Audrey (C1). From B3d. After S1 the minimap drag is a true no-op for a phase drawn over exactly its own dates (post-overhaul S1, 2026-09-30; the minimap draws phases only): its mouse-up writes the DRAWN dates back, and those are now the stored ones, so it no longer stores a day early on this machine. It still rewrites a phase drawn over a different span — one with no dates or one date (drawn over its tasks' span, or today to +14 / padded 14 days when it has none), or a parent widened to cover its sub-phases — with that drawn span. Why the drag moves nothing, confirmed in the running app by S1's review round 2: `OverviewBar`'s move handler writes to `e.currentTarget`, which React 19 sets to null after dispatch, so it throws ("Cannot set properties of null (setting '_draftStart')"), and the mouse-up then writes the unmoved drawn span.
- **P1-12 · Two "Today" buttons** (minimap and gantt). MEASURED. Owner: Audrey. From B3d.
- **P1-13 · O.T.T.E.R.'s duplicate-found dialog is unreachable** (`renderDuplicateModal`; nothing sets its state). INFERRED from the code; would settle it: an import of a course whose slug exists. From A4-9.
- **P1-14 · "Import failed: …" is `window.alert`** (`Otter.jsx` `handleImportFile`). MEASURED. From A4-10.
- **P1-15 · Two `window.confirm` left** (`TeamView.jsx:388` "Remove from project", `:693` "Remove from roster"). MEASURED (P1's grep audit: 2). W9 already ruled the conversion; behaviour, so not P1's visual close.
- **P1-17 · Opening a task template logs React's "unique key" warning** (`TaskTemplateManager` → `TemplateEditor`). MEASURED by V2's probe.
- **Autoplay (R4-36).** MEASURED: the video preview starts playing when it opens (`VideoPreview.jsx:177`, `controls autoPlay`), with no reduced-motion path. Left under C1 by B4; plan §5 names it for this file.

### Older bugs and data, left under C1

- **P1-18 · Role slugs printed as labels** ("production_designer") in the client view's crew list and the By role report (`ClientViewTab` `crewByDept`). MEASURED. Owner: Audrey, then a session.
- **P1-19 · A locked version's total reads $0** in the versions table and active-budget banner (the fixtures' snapshot has no `grandTotal`). MEASURED on the fixtures.
- **P1-23 · A related asset's click in a scene, shot, Level or Experience popup opens nothing** (`RelationsPanel` `onOpenAsset`, R4-26). MEASURED. From B5b-20, B4c-3. **The scene and shot popups FIXED by post-overhaul S3b**: the asset opens in the Assets tab's own `AssetDetailPopup` (now exported) over the popup, as a task opens. Left: the Level and Experience popups (`EntityListView.jsx`, B4c's twin), which still set state nothing renders. Owner: that lane.
- (P1-21 to P1-24 are the four older Scenes bugs walkthrough 45 left under C1; walkthrough 47 Q192.)
- **P1-25 · React logs duplicate keys (26×) after a take is unassigned or undone** (`rabbitFixturesAdapter.js:68-74`, `RabbitProvider.jsx:2919`; dev fixtures). MEASURED.
- **P1-27 · Two tests import `@babel/parser` / `@babel/traverse` undeclared** (`otterCss.test.js`, `authSelectors.test.js`; resolved through plugin-react). MEASURED by reading `package.json`. Declaring them is a lock change: the lock's owner.
- **P1-28 · A missing thumbnail draws the browser's broken-image icon** in a light 1px frame (`FileThumbnail`, the entity popups, Scenes rows; the asset detail draws initials instead). MEASURED.

### Visual rows P1 did not close, and why

MEASURED by V1/V2's walk and look unless tagged otherwise. Rows that wait on a
ruling are Audrey's questions in walkthrough 47 as well.

- **P1-29 · Team members: twelve columns need 1,707px and have 1,230**; what gives way is the free text. *(2026-10-27, R1, hers to overrule — walkthrough 82 Q1, 47 Q57: the kit's compact cells and new shares; every header, control, figure, name and staff badge — Day rate, Status and the buttons among them — whole at 1280 and at 1440, where the page's capped width gives the table the same ~1,240px; a badge that does not fit beside the name wraps under it, so a producer's or director's row is taller; a title as long as "Producer" whole (an inline editor's padding sits in the cell's), longer titles, Email and the longest usernames ellipsised, each whole on hover; nothing hidden, the page having no column chooser. One select option is cut, R1-L3 below. MEASURED in Chromium on the fixtures; `pages.test.js` holds each share to what its column cannot cut.)*
- ~~**P1-30 · Rate card: at 1280 the table scrolls sideways**~~ — CLOSED by R1. *(2026-10-27, hers to overrule — walkthrough 82 §3, 47 Q62: the kit's compact cells (B4-KR-3, `Table compact`), the table's floor 1,080 → 980px, Region a share wider from Overhead; no sideways scroll at 1280 or 1440, the one long role name ellipsised as before. MEASURED in Chromium on the fixtures.)*
- **P1-31 · The Timeline task editor's own chrome:** inline hexes (178 in `TimelineView.jsx`, most of them its), 26 `ring-orange-500`, 4 `ring-amber-500`, its three footer buttons dimming to 30% while saving, "Asset: …" at 3.16:1. Waits on Audrey (walkthrough 42 Q6, in 47).
- **P1-32 · Timeline Fit cuts the first and last key-date diamonds** and hides the last key-date line; two diamonds sit 3.9px apart at 1024 over five years; ~~the week axis overprints a month's first day~~ (fixed by post-overhaul S1, 2026-09-30: ruling B2, option B). Fit's range is C1 (the lane kept it); the minimap window's 2px sides are B3's documented selected edge. Owner: Audrey (47).
- **P1-32a · Other date code still builds a day in UTC** (post-overhaul S1, 2026-09-30; the siblings of the Timeline's parse, left because they are not S1's files). INFERRED from the code and its arithmetic, not run: `ProjectAssetsView.jsx` (~1440–1462 and ~1699–1730) builds an asset template's task dates by `new Date('YYYY-MM-DD')` → `setDate` → `toISOString().split('T')[0]`, which drops a day where the chain crosses the March clock change, and seeds "today" from `toISOString()` (tomorrow in an Eastern evening); `NotesView.jsx:165` dates a note by `toISOString().slice(0, 10)` (the same evening case); `holidays.js` `countWorkingDays` matches holidays by `toISOString().slice(0, 10)` of a local midnight, right west of UTC and a day off east of it; the Budget's `CrewTeamTab.jsx:38` and `TalentTab.jsx:48` read `new Date(project.start_date)`, so their week headers start a day early ("Wk1 08/02" for a project starting 08/03, S1 review round 1 ran a copy in New York). For these the fix is `src/tools/rabbit_v0.1.0/dates.js` (`parseIsoDate`, `toIsoDate`). In `TimelineView.jsx`, not date parses: `TODAY` is read once at module load, so a Timeline left open past midnight draws Today and seeds new tasks a day behind; and with weekends hidden several pixel/day conversions ignore the mask — a bar's move and resize (`dx / dayPx`: a drag across a weekend lands two days short), ~~centring on today (it lands about 2/7 × today's day number columns right of the Today line), the visible window's first day, and the minimap's click-to-jump~~ (those three fixed by post-overhaul S5p, 2026-10-05, with P1-32b). The move and resize, still open, want the pair S5p added (`dayAtX` / `xAtDay` in `timelineMinimap.js`; round 1's sketch: `round(dayAtX(left + dx) − dayAtX(left))`) and a rule for an end that would land on a hidden day; TODAY wants a read per render. Owner: a session (S3b, S5 or P1).
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
- **Hexes left in lane code:** `IngestionToast.jsx` 21 and `UndoToast.jsx` 10 (the toasts' own colours; P1 moved their shadows and radius only), besides the task editor's (P1-31). MEASURED by P1's audit.

## Post-overhaul merge (Track A over the overhaul, `feat/post-overhaul-edit-versioning`) — review round 1 (2026-09-30)

### Round 2 (2026-09-30) — left open, and a numbering correction

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
  **Closed by measurement for dev and staging (P1, 2026-10-28):** the
  deployed `storage-presign` was downloaded from both (dev v5 of 2026-10-02,
  staging v5 of 2026-10-06) and is the repository's copy byte for byte,
  LEGAL included. Production's is v3 of 2026-08-08, before LEGAL; production
  is at 0063, where no LEGAL key exists, and the release runbook redeploys
  every function there.
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
- **S4b-06 · One function answers any company's storage usage.** PRE-EXISTING
  (0055/0057/0073). MEASURED (S1-SEC-03; read again on wilson-dev, 2026-11-07:
  no workspace or membership test in any of its three bodies, and `authenticated`
  may call them): `rabbit_petal_storage_ok(p_project, p_incoming, p_path)` has no
  workspace check, so a search over the byte argument gives another company's
  exact usage, given a project id, and a member's own company's, which 0121 no
  longer tells a member. Personal-space bodies count in that total. Fix:
  `p.workspace_id = current_workspace_id()` and membership inside it, and decide
  what a member's search should be able to learn. Its first half is closed: 0121
  tells members only full or nearly full. Owner: the next session on storage.
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
  the popups. *(R1, 2026-10-27: a level's and an experience's windows mount
  the same FileManager; the rest of those windows is gated now, so its Add
  files and deletes are the one live write a reviewer meets there.)*
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
  title's next version. Owner: Audrey. *(FX4, 2026-10-12: a saved edit's
  changes are now saved INTO it, its summary kept; only a new edit from
  List order is saved this way, as the bar's Save edit saves it too —
  walkthrough 67.)*
- **S3c-07 · A list's first edit takes the list's own title** (D13's
  rule), so the bar can read "Shot list 1 · v1 — Edit Shot list 1 · v1 (not
  saved)". Owner: Audrey.
- **S3c-08 · The shells' exits are held by source pins.** No test mounts
  Rabbit.jsx or App.jsx: the tab strip, the cross-tab jump, navigateTo and
  the close question's fold are pinned on their source
  (leaveGuardWiring.test.js, each pin with a CONTROL) and were exercised
  for real in Chromium and once in the desktop app. Owner: a session that
  mounts the shell.
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
- **S5b-08 · 0090's guard refuses a member's whole-row UPSERT that carries
  an unchanged set-aside stamp** (its INSERT arm reads NEW before ON
  CONFLICT); the UPDATE re-send passes. Harmless today: every S5b write
  strips the stamp. Owner: a schema session, if a client ever re-sends it.

**S5c (2026-10-05, the Budget half — `docs/sessions/handoffs/po-s5c-2026-10-05.md`).**

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
entry; S5-02 closed by R1, 2026-10-27, migration 0101): S5c-01
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
  *(2026-10-28, R2: the controller's kit records staging at version 12 on 2026-10-12; production holds v8, and
  `docs/PRODUCTION_RUNBOOK.md` (c) redeploys it.)*
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

## Post-overhaul DG1 (`po/dg1-dog-references`) — left open (2026-10-16)

- **DG1-02 · On the Local Server, a scene's, shot's, level's or experience's own
  files are not linked to it.** PRE-EXISTING (stated in `deckAttachments.js`):
  the Express upload route writes `phase_id`, `asset_id` and `task_id` and
  drops `scene_id`, `shot_id`, `level_id` and `experience_id`, and the entity
  file managers write the managed store, which `listFiles` never returns. So
  D.O.G.'s *Add references* shows no files under such an item on the desktop
  (it says so, and the files table's files are under Files). Fix: teach the
  route the four columns, and list the managed store (with a download route)
  for references. Owner: Track B (the desktop server).
## Post-overhaul FX12 (`po/fx12-ai-file-store-cleanup`) — left open (2026-10-25)

- **FX12-01 · The uploads D.O.G. made before FX12 on staging and production are
  still in the AI's file store, and from 2026-11-09 nothing can tell whose
  they are.** INFERRED (no session can read those stores: wilson-dev has no
  platform operator and the key lives only inside the functions). Every
  upload since S19's `ai-files` (2026-08-11) went to the store with no expiry
  and nothing deleted it (DG1-03, closed by FX12). FX12's functions are on
  wilson-dev only; until the controller deploys `ai-files` and
  `operator-ai-files` to staging and production, nothing there lets go. A file
  is tied to its company only by its upload row in `app_events`, which the
  90-day purge removes: the first rows go on 2026-11-09, and a file whose row
  is gone is left alone by every sweep for good. Audrey's ruling (2026-10-25,
  verbatim): *"Clean up before 9 November (Recommended)"*. Would settle it:
  the operator console's **AI files** on staging and on live, after the
  deploy, reading *Tied to a company of this environment* before and after
  its sweep. Fix: the deploy, then the operator's sweep (and each company
  admin's card, which also reaches a company's own key) on both, before
  2026-11-09 (walkthrough 76 part C). Owner: the controller and Audrey.
  *(2026-10-28, R2: the controller's kit records `ai-files` v3 and `operator-ai-files` v1 on staging on 2026-10-26, so staging
  owes the sweep alone; production's deploy is `docs/PRODUCTION_RUNBOOK.md` (c) and its sweep (g) step 17. TPN-AI-009 tracks it.)*

## Post-overhaul FX15 (`po/fx15-fx14-leftovers`) — left open (2026-10-26)

- **FX15-02 · Single page's *Page #* and *Page Request* fields are named by
  their example text.** PRE-EXISTING. Their labels are tied to nothing, so
  Chromium names them by their placeholders: *"5 or 1-10"* and *"Example: I
  need a page listing all the main characters with summaries for each..."*.
  MEASURED over CDP (FX15, Single page on, 1280x800); found beside FX14-04's
  layout dropdown. Fix: `htmlFor` and `id`, as FX15 gave the two dropdowns.
  Owner: a D.O.G. session.
- **FX15-05 · The closed nav strip's items are Tab stops and buttons to a screen
  reader, on every page.** PRE-EXISTING. When the strip is closed its box is 0 px
  high, but its 12 or 13 `button.wilson-nav-item` stay `visibility: visible`,
  focusable and in the accessibility tree (no `inert`, no `aria-hidden`): on
  Home a keyboard user Tabs through *Projects, Rate card, … App settings*, all
  unseen, before Home's own list; on Team members the same after the top bar's
  Navigation button. With the strip open, its closed Resources column's five
  items (Projects, Rate card, Files, Admin terminal, Help; `opacity: 0`,
  `max-width: 0`) are the first five Tab stops, unseen. MEASURED by FX15's review
  rounds 1 and 2 (Chromium, Tab walks and CDP tree, 1280x800). Fix: `inert` on the
  strip's container while it is closed (`App.jsx`, the strip's
  `isNavMenuVisible`) and on the Resources column while it is (`navResourcesOpen`),
  or `visibility: hidden`. Owner: the shell.
- **FX15-06 · Two landmarks have no name.** PRE-EXISTING. Help's `<nav>` (since
  FX15 inside the page's main region) and O.T.T.E.R.'s course panel are read as a
  bare *"navigation"* and *"complementary"*, beside D.O.G.'s *"DECK OUTLINE"*,
  O.T.T.E.R.'s *"O.T.T.E.R."* and Admin terminal's *"Admin sections"*. The
  panel's `<aside>` is the kit's (`src/ui/Panel.jsx`, `ui-panel`): it draws its
  `title` (*Courses*) but does not name the landmark by it; D.O.G.'s is named only
  because D.O.G. passes `aria-labelledby` itself. MEASURED (FX15 and its review
  round 2, CDP). Fix: the kit Panel names its `<aside>` by its title span when it
  has one (O.T.T.E.R.'s titled Panels at once), and an `aria-label` on Help's
  `<nav>`. Owner: the kit, then the shell (Help).
- **FX15-07 · D.O.G.'s settings headers are named by their label and their whole
  description, and hold block content.** PRE-EXISTING. Each `button.dog-acc-head`
  holds a `<div>` and a `<p>` (HTML allows only phrasing content in a button), so
  Chromium names it e.g. *"SINGLE PAGE - API SYSTEM MESSAGE Core instruction sent
  as system message for single page generation"*. MEASURED (FX15, CDP). FX15
  added only the open/closed state ("nothing else in the drawer changes"). Fix:
  spans, `aria-labelledby` the label and `aria-describedby` the description, as
  FX14 named the card headers. Owner: a D.O.G. session.
- **FX15-08 · Choosing a page from the nav strip by keyboard drops focus to
  `<body>`.** PRE-EXISTING. The strip lists every page but the current one
  (`navPages`, `p.id !== currentPage` in `src/layout/pages.js`), so the item
  pressed leaves the strip under focus: after Enter on *Rate card*, *D.O.G.*,
  *R.A.B.B.I.T.* or *Help*, focus is on `<body>` and the next Tab starts at the
  top of the window. MEASURED by FX15's review round 2 (Chromium, four keyboard
  navigations). Fix: give focus to the new page's main region (FX15's) once the
  page shows. Owner: the shell.

## Post-overhaul DG3 (`po/dg3-dog-closed-list`) — left open (2026-10-27)

- **DG3-03 · On D.O.G., the main region's ring loses its top or bottom side where the
  Generated output card crosses the column's edge.** Since DG3 the ring is drawn 2px inside
  the region (`main:focus-visible`, `src/index.css`). `.dog-output-frame` is
  `position: relative` (`dog.css`; the rewrite preview's containing block, `.dog-rewrite`),
  and Chromium paints a positioned descendant after its scrolling ancestor's own outline, so
  where the frame crosses the column's bottom edge (or, scrolled to the end, its top edge) it
  covers that side. MEASURED (DG3's review round 2, then the session; Chromium, 1280x800 and
  1440x900): scrolled 379px, the bottom side 36 of 2,080 ring pixels (36 of 2,400 at 1440);
  scrolled to the end, the top side 36 of 2,080; at the top of the column all four sides whole;
  left and right whole throughout. Walkthrough 81 step 7 meets it. Before DG3 the ring sat
  outside the column with its right and bottom always cut, so the column now shows three sides
  or four, never two. Fix: draw D.O.G.'s ring above its column from a positioned wrapper of
  `.dog-main` that does not scroll, as R.A.B.B.I.T.'s shell does (`rabbitShell.css`), a JSX
  change in `DeckOutlineGenerator.jsx` that DG3's brief kept closed; or position the frame only
  while the rewrite preview shows (`.dog-output-frame:has(> .dog-rewrite)`), once nothing else in
  it is found to be placed from it. Owner: a D.O.G. session.
- **~~DG3-04 · Right after a click on Generate, Alt does not flip Single page and Full deck.~~ ACCEPTED by Audrey (2026-10-27, in chat, verbatim: "Keep the cursor in the box (Recommended)"; the option said *As built: the box stays tall while the deck is made and your words stay in view. Alt works after a click elsewhere or a Tab. Nothing changes and the closed list stays at nine.*). Never "fix" it.**
  DG3's fix for DG2-02 keeps the cursor in the deck context box (or the page request box)
  through the click, and D.O.G.'s Alt toggle leaves an Alt in a text box, a dropdown or a field
  to it, as before, so Alt does nothing until the cursor leaves the box (a click on an empty
  part of the page, or Tab). MEASURED by DG3's review round 2 (Chromium, both sizes): the
  switch stays `aria-checked="true"` after Alt; after a click outside the box, Alt flips it.
  Before DG3 the press blurred the box (and the click was lost, DG2-02), so Alt after it
  flipped. Her FX13 answer: *"Alt flips the switch from any page"*. Walkthrough 81 step 6 says
  to click out of the box first. Fix, if wanted: each Generate button takes focus once its
  click has landed (in its click handler, after the press kept the box's height), as a
  landed click did before; not measured. Owner: none; her call is made (keep as built).

## N1 (`po/n1-subtract`) — left open (2026-10-27)

What N1 (night 1's subtract session: the one-off scripts, the session launch
entries, exports nothing calls, one shared R.A.B.B.I.T. test mount, the closed
entries archived) met and did not fix. Three open entries above cite as their
measurement a script N1 deleted (`fx10-date-fields-shots.mjs`,
`shot-number-fields-shots.mjs`, and `vw1-shots.mjs` in P1-08): git has each at
`c48dbb8d`.

- **N1-01 · D.O.G.'s project attachments are cut by size only, not at 20
  files.** `src/tools/rabbit_v0.1.0/deckAttachments.js` says the candidates are
  "cut off at BOTH a count and a total size" (MAX_FILES = 20, "the same ceiling
  the picker beside it already advertises"; MAX_BYTES = 32 MiB), but
  `DOG_ATTACHMENT_MAX_FILES` has no reader in the tree: its bare name, grepped
  across src, electron, gateway, public, supabase/functions, scripts, tests,
  the workflows and the handbook, appears only where it is declared. Nor does
  `DOG_ATTACHMENT_MAX_MIB`, "said once, for the panel copy". INFERRED from the
  code, not run; would settle it: a project with more than 20 stored files
  selected in D.O.G., and the attachments counted. N1 left both constants (they
  are the evidence). Owner: the next session in D.O.G.'s attachments.
- **N1-02 · The launch file's `v1-auth` entry serves a worktree that is
  gone.** It runs `npx vite …/.claude/worktrees/quirky-dewdney-93d080/WILSON
  --port 5246`; that folder no longer exists (MEASURED, `ls`, 2026-10-27). N1's
  brief kept the entry byte for byte. Owner: the controller (remove it, or give
  it session-a's relative path with `VITE_DEV_AUTOLOGIN=off`).
- **N1-03 · Three defects found and not fixed sit in two closed entries, under
  struck leads.** S2b-02's tail holds two (the nodes merge keys a system and a
  category on one a-z0-9 key, so "文字列" and "数学" become one category and
  "C++" and "C#" one system; a stored document that is not a library is left as
  it is while both merges answer as if they merged) and S2b-05's one (a null
  shortcut throws in the Search dialog's hotkey search and in the Hotkeys view's
  search). They are open, but each bullet's lead is struck, so a reader looking
  for open entries passes them. Found and MEASURED by S2c, the session that
  closed both, as those bullets say. N1 kept both whole in this file rather than
  archive open defects (review rounds 1 and 2 found the shape and the count).
  Fix: re-file each tail as its own open entry and archive the struck part.
  Owner: the controller (the file), then a session in O.T.T.E.R.'s merges and
  its Search dialog.
- **N1-04 · `session-a`, `-b` and `-c` serve the worktree with another
  install's `vite`.** Their recipe (`dg2-worktree`'s, as N1's brief named) runs
  `npx vite WILSON` from the worktree root, which has no `package.json`, so `npx`
  takes the first folder above it that has one: the main checkout's `WILSON/`
  and its `node_modules` (MEASURED by N1's review rounds 1 and 2: `npm prefix`
  there, `vite` resolved from it; 6.4.1 in both today, the main checkout on
  another branch). The worktree's own `WILSON/` and plugins are served; it
  breaks if the main install goes or its `vite` drifts from the worktree's.
  Every per-session entry before it did the same. Fix: `cd WILSON&& …` before
  `npx vite --port N --strictPort` (the worktree's own install, which the
  protocol's `npm install` already provides). Owner: the controller.

## S1 (2026-10-27, night 2 of `docs/sessions/PLAN_TO_1_0.md`)

Reconnecting after a hung session check (`docs/design/RECONNECT_DESIGN.md`,
designed, reviewed, built) and the two-factor enrolment overflow (measured
closed; the shell's own comment table and `AuthShell.reveal.test.jsx` carry the
numbers). The entry *One hung `getSession()` pins the whole app's auth* is
deleted as fixed; its two measured claims — a lock global per `storageKey`,
a shared refresh promise nothing outside the SDK can cancel — were wrong for
this app (the lock is a no-op with `persistSession: false`; the pin is the
client's own queue; a fetch given a signal is cancelled and the SDK reads it
as retryable) and are corrected in the design's §1. What S1 met and did not
fix:

- **S1-01 · Two tabs of `/wilson` share one stored session and each rotates
  its refresh token on its own.** With `persistSession: false` every tab's
  auth-js keeps its own copy of the session in memory. The visible tab's
  ticker refreshes it and `supabaseClient.js` writes the rotated tokens to
  localStorage, but a second tab keeps the OLD refresh token in memory and
  presents it at its next refresh — on becoming visible again
  (`_recoverAndRefresh`), or from its own ticker. GoTrue accepts a reused
  refresh token inside its reuse interval (10 s by default) and revokes the
  whole family after it, which signs BOTH tabs out. INFERRED from the SDK as
  installed and GoTrue's documented reuse rule (review round 1 of the
  reconnect design, F8); not measured, because it needs a real session: two
  tabs on wilson-dev as the smoke user, the second hidden for longer than the
  token's life, then shown. Not changed by S1 — an aborted refresh's retry
  presents the same old token a reload does. The desktop has one renderer; the
  operator console has its own token under its own key. Owner: a session in
  `src/cloud/auth/` (the fix shape: re-read the stored session before a tab
  refreshes a token older than the one in storage).

## S2 (2026-10-27, night 3 of `docs/sessions/PLAN_TO_1_0.md`)

The offline launch (`docs/design/RECONNECT_DESIGN.md` §11; her two rulings of
2026-10-27, *"A sign-in less than 4 hours old"* and *"One offline sentence on
each screen, no empty-state words"*) and the pet's retry, designed, reviewed
and built. Two entries are deleted as fixed, each closed by measurement:
*An offline launch cannot get past the sign-in screen, however fresh the saved
sign-in* (`scripts/probes/connection-hang.mjs` phase G on the build: a launch
inside the 4-hour cap that reaches nothing holds the saved sign-in at once, or
at 5 s when the network stalls, sends no real request while it is dead, and
is confirmed 8.5 s after the network returns; its fix shape's "solo-user
rules" for the Storage card became the person's own role, read from the saved
token) and *A failed pet sync is never retried until WILSON is relaunched*
(`src/lib/petLifecycle.js` `createPetSyncRetry`: 5 s, 15 s, 45 s, 2 min 15 s
and 5 min, then only on a trigger — the decision its entry asked for is that
bound). What S2 met and did not fix, S2-01 (*on the desktop the 4-hour cap
restarts at every launch*), D1 closed on 2026-10-28 (the session log's D1 row).

## D1 (2026-10-28, night 4 of `docs/sessions/PLAN_TO_1_0.md`)

The desktop keeps its stored state across a relaunch
(`docs/design/RECONNECT_DESIGN.md` §12; her ruling of 2026-10-28, *"Fix it in
1.0, a session tonight"*): the 4-hour cap runs from the token's own sign-in
time at every restore, and the renderer's `localStorage` is kept in a userData
file (`electron/rendererStorage.cjs`). Two entries are deleted as fixed, each
closed by measurement: S2-01 and *On the desktop, the browser's own storage
most likely starts empty at every launch* (the session log's D1 row). What D1
met and did not fix:

- **D1-01 and D1-02 were closed by D2** (night 6, 2026-10-29): the session
  log's D2 row, and `docs/design/RECONNECT_DESIGN.md` §13 for the
  measurements. D1-01's drop was an inference: D1 sent the window to the
  page from the main process (`loadURL`). Measured by D2 on the tip, a file
  dropped on the window never left the page (Electron 33's
  `navigateOnDragDrop` is false), while a navigation the page itself started
  to another site did, and was handed the saved sign-in and the key.

## D2 (2026-10-29, night 6 of `docs/sessions/PLAN_TO_1_0.md`)

The desktop window stays on WILSON's page, the idle clock judges a sleep
first, and the migration names the actuals left without their invoice
(`docs/design/RECONNECT_DESIGN.md` §13; her *"2. a"* of 2026-10-29). Three
entries closed (the session log's D2 row). What D2 met and did not fix:

- **D2-01, D2-02 and D2-06 were closed by D3** (night 7, 2026-10-29):
  D2-01 by her ruling in words, *"Q1. a"* (the clips left behind stay
  listed by name, as they are); D2-02 and D2-06 by measurement (the session
  log's D3 row, and `docs/design/RECONNECT_DESIGN.md` §14).
- **D2-03 · The operator console has no drop guard.** A file dropped on
  `/wilsonadmin` in a browser opens in the tab's place, as on any page; the
  console holds no bridge. INFERRED (the guard is installed by the app's
  entry, `src/main.jsx`, only). Owner: none.
- **D2-04 · An actual on a line outside Crew/team and Talent cannot have
  its invoice attached again in the browser.** Only those two tabs'
  popovers attach an invoice; the report lists such an actual with no tab.
  No writer in the app makes one (INFERRED: `source: 'expense'` appears only
  in the dev fixtures). Build review round 1, F3. Owner: none.
- **D2-05 · The intake wizard's *Drop or click to add files* button takes
  no drop.** `IntakeWizardView.jsx`'s button has no drop handler: a file
  dropped on it does nothing on either build (before D2 it replaced the
  tab on the web). INFERRED from the code (build review round 1, F6).
  Owner: an intake session (wire it to the hidden input, or say *Click*).

## D3 (2026-10-29, night 7 of `docs/sessions/PLAN_TO_1_0.md`)

The sign-in bridge answers WILSON's page only, and an answer's link opens a
new tab on the web (`docs/design/RECONNECT_DESIGN.md` §14; her *"Q2. b"* of
2026-10-29). Three entries closed (the session log's D3 row). What D3 met
and did not fix:

- **D3-01 · With a Sentry DSN set, Sentry's own IPC answers any page.**
  INFERRED from the library's source (read, not run: no build here has a
  DSN): `@sentry/electron` 5.12.0's main SDK (`ipcMode: IPCMode.Both`)
  registers six listeners on Electron's `ipcMain` that take any sender and
  answer none (`main/ipc.js`, `configureClassic`), a privileged
  `sentry-ipc:` scheme any page of the session can reach, and its own
  preload in every page of the default session
  (`main/integrations/preload-injection.js`), the print and receipt windows
  included. Inbound telemetry only: nothing of WILSON's (the key, the
  session, a file) is handed back. Outside D3's gate, which covers the
  channels WILSON's preload bridges; its source test covers the repo, not
  `node_modules`. Would settle it: a desktop run with a DSN set and a page
  that is not WILSON's sending an event. Fix shape: `initMainSentry` with
  `ipcMode: IPCMode.Protocol` and the preload injection left out, or the
  listeners' sender checked. Owner: the controller (whether 1.0's installer
  sets a DSN).
  Settled by the controller the same evening (2026-10-29; measured, not
  run): no shipped build carries a DSN. The beta's bundle has none
  (`index-BlvqrGRe.js`: no `sentry.io`, its *DSN not set* line present);
  the packaged main process reads only `userData/env.json`
  (`electron/env.cjs`); a production bundle reads no `.env.development`.
  A DSN is set only in her checkout's `.env.development`, so Sentry's own
  channels are live on a development run of the desktop alone. Stays
  recorded (`PLAN_TO_1_0.md` §5, rule 8); the fix shape above applies the
  day a shipped build is given a DSN.

## DG5 (2026-10-30, night 8 of `docs/sessions/PLAN_TO_1_0.md`)

D.O.G.'s two input cards share one row on a wide window, card 1 in two
columns on a very wide one (her ask of 2026-10-30; the session log's DG5
row). What DG5 met outside its list and did not fix:

- **DG5-01 · ~~CLOSED by the controller (2026-10-30, the same hour): the one
  wait is card 1 itself (`.dog-card-project`). PROVEN on the controller's
  worktree at `e43e891a` with the fixtures on 5301: the probe as committed
  exited on `TimeoutError` before measuring; with that line changed it ran
  every step and passed C4 at both sizes and both mounts.~~
  `scripts/dog-preview-probe.mjs` stops before it measures
  anything.** MEASURED on DG5's branch (2026-10-30, Chromium, the dev
  fixtures on 5301): `node scripts/dog-preview-probe.mjs 5301 --check`
  waits up to 20 s for a control reading *Generate Page Outline*, which
  D.O.G. no longer shows when it opens, and exits on `TimeoutError` with
  nothing measured. D.O.G. has opened on Full deck since DG1b (`9d707f9f`,
  2026-10-17: her Q21), where the button reads *Generate full deck
  outline*, so the probe has been stale since then, not since DG5. A
  scratch copy with that one wait replaced by card 1 (`.dog-card-project`)
  runs every step and passes its check (C4: the preview box matches the pin
  at 1280 and 1440, at both mounts) on DG5's layout. Fix: that one line.
  Owner: the controller (a script under `scripts/`, outside DG5's list).
- **DG5-02 · ~~CLOSED by DG6 (2026-10-31, night 9): her ask of that day
  stacked the two cards and DG6 capped them, both one width, 602px under a
  1468 window and 1,202 from it, so nothing grows past 2560. MEASURED on
  `po/dg6-cards-stacked` at 3440x1440 (Chromium on 5301, the fixtures; the
  main column 3,174px): both cards 1,202px wide and 1 percent empty across
  (their own padding and border), with no project and with six references;
  the 1,972px to their right is the page's paper, outside any border; the
  output card keeps the column's full 3,174. Since DG6's follow-up (her
  words of 2026-10-31, "i really dont like that there is a open space/gap
  to right") both cards run the column's full width and card 1 is titled
  sections whose single controls keep their size: MEASURED on
  `po/dg6-one-column` at 3440x1440, card 1 81 percent empty on its right
  with nothing chosen and 58 with six references, none beside it. What
  settles it is her word on wide windows, asked in plain words with
  stretched controls and side-by-side sections as the other options:
  "Keep it (Recommended)" (2026-10-31), on the design round's sketch and
  again on the built pictures and numbers (shown at 1280 and 2560; 3440's
  81 percent is by measurement).~~ On an ultrawide window each card is about 44 percent empty
  across again.** MEASURED by DG5's review round 1 at 3440x1440 (Chromium
  on 5301, the fixtures; the main column 3,200px): card 1 is 2,117px wide
  around its 1,176px of two columns, card 2 1,059px around its 576, so 44
  percent of each card is empty across, about what DG4's card 1 left at
  1280. DG5's row has no cap past 2560 (the brief's range is 1280 to 2560;
  the design round let the margin grow with the window, as the output
  card's does). Would settle it: her word on windows wider than 2560. Fix
  shape: a cap on `.dog-inputs` past some width, which leaves the row's
  right edge short of the full-width output card below it (the design
  round's sketch of hypothesis (b)). Owner: Audrey (1.1).

## DG6 (2026-10-31, night 9 of `docs/sessions/PLAN_TO_1_0.md`)

D.O.G.'s two input cards stacked at every width at one capped width, card 1
in two columns from a 1468 window (her ask of 2026-10-31; the session log's
DG6 row). What DG6 met outside its list and did not fix:

- **DG6-01 · The type sweep's scanner reads `DeckOutlineGenerator.jsx`'s
  backticks inverted from line 2635 on, so a comment's wording can hide
  code from it.** MEASURED on `po/dg6-cards-stacked` (2026-10-31):
  `protectedRanges` (`scripts/ui-source-regions.mjs`) steps over strings
  and comments but not regular-expression literals, and `/^```/` at
  `DeckOutlineGenerator.jsx` 2635 holds three backticks, so from there it
  takes each comment's backtick for a template literal's start and the
  next for its end. A template that holds a `{` and then `word: value;`
  with no brace between is judged embedded CSS and protected: on the branch
  after review round 1, eleven protected spans of over 1,000 characters
  open at a backtick between lines 2635 and 5180 (1,072 to 21,952 characters each, prose and
  code alike; 106,583 of the file's 289,417 characters, 37 percent, are
  protected in all, DG6 review round 2's measurement); eleven were there
  before DG6 too, and DG6's first wording of one comment (*"THE INPUTS STACK: from a
  1468 window since DG6);"*) made a twelfth, 4147 to 4306, and the file fell
  to 558 of 957 code sites seen; `src/ui/typeScale.test.js` (*"sees the
  code in every file it reads"*) failed on it. DG6 reworded the comment
  (`cc8c720e`). Any later comment or string of that shape in this file can
  do it again, and the sweep's checks of what it protects are blind to
  the same spans. Fix shape: let the scanner step over a regular-expression
  literal (a `/` where an expression starts), or blank comments before it
  judges templates. Owner: the controller (a script under `scripts/`,
  outside DG6's list).
- **DG6-02 · Card 1's sections: four matters of her taste, recorded, not
  changed.** MEASURED or read by the follow-up's review round 1 (2026-10-31,
  Chromium on 5301, the fixtures). (a) Project and Uploads open with a
  one-line sentence under their titles (the Caption step); References has
  none with a project chosen, and with none chosen it opens with the
  "Choose a project…" note at the Dense step. (b) The line "What goes to
  the AI…" and its meter close the card with no title, so a reader scanning
  the titles may file them under Uploads, though they count all three. (c)
  Project stacks three lines of words before its dropdown: the title
  "Project", its sentence, and the label "CHOOSE A PROJECT" (DG3's, her
  word); the sentences and the label were there before the sections: card
  1's 104px growth with nothing chosen (424 to 528) is the three new titles
  (about 56px) and the 32px section spacing (about 48), and it puts Generate
  just under a 1440x900 window as D.O.G. opens (about 74px would bring it
  wholly on screen; review round 2). (d) In the shelves each tile keeps DG1's bottom
  hairline, so at 1920 three tiles' rules read as one rule under each
  group; they are the rows', not a section's. Would settle each: her word
  (new sentences are hers to choose). Owner: Audrey.
  **Re-measured by DG7 (2026-11-05, Chromium on 5302, the fixtures; open until
  she answers).** (a) References and Uploads both open with their first control
  now, each section's sentences under its controls; no new sentence was built.
  Project keeps its sentence above its field. (b) The contract line and meter
  are a section titled *The deck reads*, the brief's words: walkthrough 94 Q1. (c)
  Project still stacks three lines before its dropdown; Generate is wholly on
  screen at 1440x900 with nothing chosen (card 1 427px tall, was 528; y 837), 92px
  under it at 1280x800 (was 174). (d) The hairlines are in one list now: at 1920
  three tiles a shelf, at 2560 five, each tile's rule its own with the 24px gap
  between: walkthrough 94 Q3.
- **~~DG6-03 · D.O.G.'s Help gives card 1's step in the old order.~~ CLOSED by
  DG7 (`5606e628`): the step in the card's new order, the same words.** MEASURED
  by the follow-up's review round 2 (read): `src/data/dogHelpContent.jsx`'s
  Basic workflow, step 1, reads "choose the project, upload documents (up to
  20 files…), and tick what else the deck reads"; since DG6's follow-up the
  card is Project, then References, then Uploads. Outside DG6's list (Help's
  words). Fix shape: the step's order, one sentence. Owner: any D.O.G.
  session the controller names.

## F1 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`)

REV-01 fixed and a `deno check` of every Edge Function in CI (her ruling of
2026-10-31; the session log's F1 row). What F1 met outside its list and did
not fix:

- **F1-01 · 28 type errors in ten files (seven functions and the three
  shared guards), held as the deno check's baseline.** MEASURED on GitHub's
  runner (run 41224374487 on `d5e853cf`: Deno 2.1.4, `supabase-js@2.45.4`'s
  own types from esm.sh): 34 errors in 15 groups, six of them REV-01's. The
  other 28: `_shared/adminGuard.ts`, `_shared/memberGuard.ts` and
  `_shared/operatorGuard.ts`, TS2322 each (the guard's
  `admin: ReturnType<typeof createClient>` is
  `SupabaseClient<unknown, never, GenericSchema>`, and the client it makes is
  `SupabaseClient<any, "public", any>`); `resolve-login` TS2345 (its client
  handed to `isRateLimited`, whose `Client` is the same alias,
  `_shared/rateLimit.ts:36`); `storage-gc` 17 (its queue rows' `id`, `object_path`
  and `bucket_id` are `unknown`, passed to `.eq`, `.remove` and the
  presigner); `admin-set-active` TS2769 (a callback's row type);
  `admin-user-security` TS2352 (`User` asserted to `Record<string,
  unknown>`); `ai-files` TS2739 (a query builder, a thenable, where a
  `Promise` is declared); `operator-ai-keys` TS2352 (a select string built at
  run time, which the typed parser reads as an error) and TS2769 (an
  `unknown` passed to `.eq`); `operator-workspaces` `:236-237` TS2488 and
  TS2339 (the list's page typed `{}`). Each is a line of `KNOWN` in
  `.github/workflows/rls.yml` and is listed in every run's warning
  annotation. INFERRED by reading that none throws: each is a type the code
  does not lean on at run time (a thenable awaited, an array typed `{}`, an
  `unknown` passed where a string goes). The job fails on any count above
  `KNOWN` and on any below it. Fix shape (INFERRED, not measured; review
  round 2's reading): `ReturnType<typeof createClient>` is written at ten
  places in nine files (the three guards, `gatewayGuard.ts` twice,
  `rateLimit.ts`, `aiFilesUpstream.ts`, `gatewayReachRun.ts`,
  `gatewaySigning.ts`, `storage-read-urls`), and `gatewayGuard` has no error
  because its client is made in a return position typed by the alias.
  Retyping only the three guards' `admin` would move their errors to the 19
  `isRateLimited` calls, not clear them. Either one exported client type
  for all ten places in one commit (the guards', `resolve-login`'s and
  probably `storage-gc`'s rows clear), or the alias kept and the client
  typed where it is made, as `gatewayGuard` does (the rows stay `unknown`);
  the rest by hand, each lowering its line. 🚨 The counts move with any
  module in the graph, so a session that touches anything under
  `supabase/functions/` needs the `KNOWN` block of `rls.yml` in its list:
  F8 (`_shared/` and its callers) and F7 (`storage-gc`'s and `ai-files`'
  reads), in one wave. At their merge neither branch's numbers need be
  right (F8's type can clear what F7 edits): `KNOWN` is what the merge
  commit's own run reads. Owner: for the controller to place.

## F2 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`)

REV-02 fixed with her ruling of 2026-10-31 (the session log's F2 row). What F2
met outside its list and did not fix:

- **F2-01 · ~~CLOSED by F2's follow-up (2026-10-31; `7cf3732a`), her answer
  to walkthrough 91's F2 Q2, "Full rate, $624 (Recommended)": the Crew tab
  prices a role nobody holds at the Summary's rate (`roleRates`), its own
  `rateMap` removed, and the Topsheet's unreachable one with it. MEASURED in
  Chromium on the fixtures at 15% typed: Production Designer $520 → $624; the
  crew $76,810 → $92,172, the Summary's base; its contingency +$7,681 →
  +$9,217, the Summary's; its bid total $88,332 → $105,998. A member's row
  keeps its own entry; `resolveRate` still has no caller.~~ The Crew tab
  prices a role nobody holds yet below the Summary.**
  MEASURED on the fixtures (Chromium on 5302): the Crew tab's rate for a
  role is the rate card entry's `wage` (`CrewTeamTab.jsx`'s `rateMap`,
  `e.wage || e.day_rate`), which `useRateCard` fills with the card's day
  rate before burden and overhead, while `buildRoleRates` (the Summary, the
  reports, the client estimate) reads `day_rate`, the entry's total with
  them: Production Designer $520 against $624 (12% burden, 8% overhead); the
  crew $76,810 on the Crew tab, the Summary's base $92,172. (With the fee on
  and none typed the Crew tab's bid total is also $92,172: its 20% fee is the
  size of the card's 12% and 8%, a coincidence.) `budgetMath.js`'s
  `resolveRate` prices an unstaffed line at the role's day rate and a
  person's at their wage; no surface calls it. Fix shape: the Crew tab and
  the Topsheet price through `resolveRate`. Owner: Audrey (walkthrough 91,
  F2's Q2).
- **F2-02 · The Topsheet's Crew / Team rows price only members with an entry
  of their own in the active card.** MEASURED on the fixtures: every crew
  department reads $0 subtotal and $0 bid (their actuals, $17,030, only),
  where the Crew tab lists $76,810 of roles nobody holds ($92,172 since
  F2-01's fix), so the Topsheet's grand bid ($37,250 with 15% typed; $40,439
  since F2-03's) leaves the crew out. `TopsheetRollup`'s `crewData`
  (`BudgetView.jsx`) built a `rateMap` it never reached (a member with no
  entry has no role; removed by F2's follow-up) and adds no row for a role
  nobody holds.
  Fix shape: one crew-rows function the Crew tab and the Topsheet both read.
  Owner: none named.
- **F2-03 · ~~CLOSED by F2's follow-up (2026-10-31; `7cf3732a`), her answer
  to Q3, "Yes, its own line": the estimate's *Agency fee* line, the
  project's fee on the crew and the expenses, after Contingency and the
  Production fee (the Talent line keeps its fees, so nothing is counted
  twice); the Topsheet's expenses carry the fee. MEASURED in Chromium on the
  fixtures at 15%: the line none → $17,015, the estimate's total $141,995 →
  $159,010; the Topsheet's expenses fee — → $3,189, its grand bid $37,250 →
  $40,439.~~ The client estimate carries the agency fee on talent only, and
  the Topsheet none on the expenses.** MEASURED on the fixtures with 15%
  typed: the estimate's Talent line ($15,990) holds the fee and the agents'
  fees; its crew lines and *Expenses / travel* hold none, so the project's
  fee on the crew ($13,826 on the Summary's base) appears nowhere on it. The
  Topsheet's *All expenses* row passes `agencyFee={0}` (`BudgetView.jsx`,
  INFERRED by reading; review round 1, finding 10), where 0036's column
  comment and the line computations apply the fee to expenses. Fix shape:
  her answer to walkthrough 91's F2 Q3. Owner: Audrey.
- **F2-04 · ~~CLOSED by F2's follow-up (2026-10-31; `7cf3732a`), her answer
  to Q1, "Yes, fill in 20% (Recommended)": budgetMath's
  `agencyPctOnSwitchOn`, asked by the Summary's and the project settings'
  switches; the new-project form writing 20 when its box is empty (its
  confirmation "20%", not "Enabled"); the move to the cloud writing 20 for a
  desktop project with the fee on and no percentage at all. MEASURED in
  Chromium on the fixtures: a project made with the fee ticked and nothing
  typed, its Agency % empty → 20; the settings' switch turned on over a
  stored 0, 0 → 20; the move, `runMigrationBins.test.js`. Both switches keep
  reading a stored 0 as none typed (on the cloud an untyped 0 cannot be told
  from a typed one), so switching off and on puts 20 over a typed 0, as the
  Summary's switch always did; each writes the switch and the default in one
  update (review round 1, finding 6). Cloud projects already holding 0:
  F2-08.~~ The cloud stores 0 for an agency percentage
  nobody typed, so her 20% reaches a cloud project only through the
  Summary's switch.** MEASURED
  by reading: 0036 makes `budget_agency_pct` `NOT NULL DEFAULT 0`. Three
  routes switch the fee on: the intake (`IntakeWizardView.jsx:211`) sends no
  percentage when none is typed, so the cloud holds 0; the project settings'
  toggle (`ProjectSummaryView.jsx:793`) writes `budget_agency_enabled` alone,
  so 0 again; the Budget Summary's switch (`BudgetView.jsx`, `if
  (!project?.budget_agency_pct)`) writes `AGENCY_DEFAULT_PCT` when the stored
  value is missing or 0 — which also puts 20 over a typed 0 when the fee is
  switched off and on (review round 1, finding 5). The desktop's
  `POST /api/rabbit/projects` (`main.cjs`) keeps an untyped percentage
  absent, where every surface reads 20; the move to the cloud leaves an
  unset value out so the default applies (`migrationRows.js`,
  `PROJECT_DEFAULTED`): a desktop project charging 20% charges 0% once
  moved. Fix shape: the intake and the settings' toggle write
  `AGENCY_DEFAULT_PCT` when the fee is switched on and nothing is typed (her
  answer to walkthrough 91's F2 Q1), the move the same for an unset value;
  then the Summary's switch can read a typed 0 as typed (`== null`). Owner:
  Audrey.
- **F2-05 · The Crew and Talent tabs' Bid total leaves out the margin and
  contingency shown beside it.** MEASURED on the fixtures: Production
  Designer reads Subtotal $18,720, Contingency +$1,872, Bid total $21,528
  (the subtotal and the 15% fee), and the Variance is the actual against
  that; the Summary's overall total adds margin and contingency.
  `lineMoney`'s `bidTotal` keeps the tabs' meaning. Fix shape: her call on
  what a row's Bid total is. Owner: none named.
- **F2-06 · A margin, contingency or actual typed on a Crew row for a role
  nobody holds yet is not kept.** INFERRED by reading (review round 2,
  finding 3; not run): the row's margin and contingency buttons and period
  cells open (`CrewTeamTab.jsx`), and saving calls `ensureLine` with the
  row's id `unassigned-<slug>`, which creates a crew line keyed by that id as
  `team_member_id`. On the cloud that column is a UUID (0037), so the insert
  should be refused; on the desktop the line is made, but the row prices
  with no line (`lineMoney(subtotal, null, …)`) and lists no actuals, so
  what was typed never shows. On the fixtures every crew figure sits on such
  a row. Older than F2. Fix shape: these rows' buttons and period cells
  disabled, or a line keyed by `role_slug`. Owner: none named.
- **F2-07 · ~~CLOSED by F2's second follow-up (2026-10-31), her answer to
  walkthrough 91's F2 Q5, "Yes, show it (Recommended)": with the fee on, the
  Expenses tab's *Bid total* tile, the estimates plus the project's fee
  (budgetMath's `lineMoney`, the Topsheet's figure), the fee under it.
  MEASURED in Chromium on the fixtures at 15%: no fee shown → *Bid total
  $24,449, with the $3,189 agency fee*, equal to the Topsheet's expenses
  bid. The tab's variance and over/under labels stay the cost against its
  estimate (−$316). Commit `e8bd5d2d`.~~ The Expenses tab shows no agency fee, where the Topsheet's
  expenses row and the client estimate now carry it.** MEASURED in Chromium
  on the fixtures at 15% (F2's follow-up, review round 1, finding 1): the
  Topsheet's *All expenses* bid $24,449 and variance −$3,505 (its fee
  $3,189), the Expenses tab's estimated $21,260 and variance −$316, with no
  fee column (it never had one). Fix shape: a fee column or a line on the
  Expenses tab, or the Topsheet's expenses without it; her call
  (walkthrough 91's F2 Q5). Owner: Audrey.
- **F2-08 · ~~CLOSED by her answer to walkthrough 91's F2 Q4 (2026-10-31),
  "Leave them (Recommended)": nothing changes on a budget without her seeing
  it; switching the fee off and on fills in 20%, or she types the number.
  Nothing built.~~ Cloud projects made before F2's follow-up with the fee on and no
  percentage typed hold 0 and charge no fee.** INFERRED by reading (round 1,
  finding 5): nothing changed stored data; switching the fee off and on
  gives one its 20, and typing a percentage gives it that percentage.
  Walkthrough 91's F2 Q4 asks her. Owner: Audrey.
- **F2-09 · Five older things seen in F2's follow-up review, not changed.**
  (a) The client estimate names a crew line by its role's code
  (*production_designer*, *dop*: `ClientViewTab.jsx`'s `crewByDept`, the
  task's position or the slug), MEASURED on the fixtures; (b) the project
  settings' margin, contingency and agency % boxes take edits while the
  budget is locked, where the Summary's are disabled (MEASURED by round 2 in
  Chromium on the locked *Salt Hours*; its agency switch, which since the
  follow-up also writes 20%, is disabled under the lock now,
  `ProjectSummaryView.jsx`);
  (c) two members holding the same role each get all its bid days on the
  Crew tab (INFERRED); (d) the fixtures' internal rate card holds an annual
  wage (61,000) in the `wage` field the Crew tab reads as a day rate
  (`src/dev/fixtures/data/money.js`, INFERRED); (e) the client estimate's
  Agency fee line does not read a crew line's `agency_opt_out`, which the
  Crew tab honours and no screen sets (INFERRED, round 2). Owner: none named.
- **F2-10 · ~~CLOSED by F2's third follow-up (2026-10-31), her answer to
  walkthrough 91's F2 Q6 — a question back, then "Yes, F2 builds it next
  (Recommended)": a bid version keeps each expense's estimate; the Expenses
  tab shows the selected bid's figure (Bid), what is expected now and what
  was spent, with both differences, each saying what it compares
  (*Expected vs bid*, *Actual vs expected*); the lock writes the expenses
  in as they are then. MEASURED in Chromium on the fixtures at 15%:
  Locked bid $20,960, Expected now $21,260, Expected vs bid +$300, Actual
  vs expected −$316; the timber $3,900 bid, $4,200 expected (+$300 vs
  bid). Commits `9ebfdeb1`, `419139cc`, `ca70ad5e`, `6b1a4216`, `b5971874`
  and review round 2's.~~ The Expenses tab's
  Variance is against the estimate; the Crew and Talent tabs' and the
  Topsheet's are against the bid.** MEASURED on the
  fixtures at 15% (F2's second follow-up, both review rounds): the Expenses
  tab −$316 beside its *Bid total* $24,449, the Topsheet's *All expenses*
  −$3,505; while the fee is on the tile says *against the estimate, before
  the fee*. Each expense's over/under label is against its estimate too.
  Also seen, not changed: a typed 0 shows *with the $0 agency fee* where the
  Topsheet shows "—"; each tile rounds on its own ($100 + $15 = $116 on a
  $100.45 estimate), as the Topsheet does. Fix shape: none until her answer
  to walkthrough 91's F2 Q6. Owner: Audrey.
- **F2-11 · Changing an expense while bidding is no unsaved change to the
  open bid version.** MEASURED by review round 1 of F2's third follow-up
  (Playwright on the fixtures): `versionDiff` compares the schedule, the
  rates and the percentages only, so after an expense change alone Save
  stays grey and the Expenses tab's *Bid* is the version as last saved. The
  lock writes the expenses in as they are then (`keepExpensesInBid`, the
  round's fix), so the locked bid is never stale; an open writes no expense
  back (they are the project's). Said in walkthrough 91. Fix shape, if
  wanted: the expenses in `versionDiff` where the Summary and the Timeline
  know them (an older version opened would then read unsaved until saved).
  Owner: none named.
- **F2-12 · The Expenses tab's undo and redo change the screen only.**
  INFERRED by reading (review round 1, finding 7): `useExpenses`' undo and
  redo (`useExpenses.js`) set the list on screen and write nothing, so the
  stored expenses — what a save or the lock keeps in a bid — stay as before
  the undo until the list is read again. Older than F2. Fix shape: undo and
  redo through the adapter, as the provider's are. Owner: none named.
- **F2-13 · The Topsheet's *Bid* for the expenses is today's, the
  Expenses tab's is the locked bid.** MEASURED (round 1, finding 2): on the
  fixtures the Topsheet's *All expenses* Bid is $24,449 (today's estimates
  with today's fee, as its crew and talent rows are today's), the Expenses
  tab's *Locked bid* $20,960 ($24,104 with the bid's fee); the Q5 figure
  stays on the tab under *Expected now*. Round 2 (finding 4, MEASURED): so
  are the Crew and Talent tabs' *Bid total* (today's, with the fee), and
  the Summary's banner names the locked bid with its overall total, which
  has never held the expenses. "Bid" is several figures on one page. Said
  in walkthrough 91. Owner: none named.

## Post-overhaul R1 (`po/r1-rabbit-robustness`) — left open (2026-10-27)

What R1 (night 2: R.A.B.B.I.T. robustness) met and did not fix, and what its
two review rounds found outside its scope.

- **R1-L1 · The rewire confirm still says the old link is gone before the
  new one is saved; on a refusal it is put back now.** `DependencyRewireModal`
  keeps its words (the brief said so), and its last sentence describes the
  loss R1 removed. Walkthrough 82 Q2 offers a sentence for what happens now.
  Owner: Audrey's answer, then any R.A.B.B.I.T. session (one string).
- **R1-L2 · A rewire makes the new link FS with no lag, whatever the old
  one was.** `rewireDependency` builds the new row as the two calls it
  replaced did (`linkTasks` / `linkPhases` with their defaults), so a link the
  R.A.B.B.I.T. agent set to SS with a lag (`set_dependency`) comes back from a
  rewire as FS 0, and the Timeline's schedule reads `lag_days`. INFERRED from
  the code; unchanged by R1. Fix, if wanted: carry the old row's `type` and
  `lag_days` (the confirm names neither, so it is her call). Owner: a Timeline
  session.
- **R1-L3 · On Team members at 1280 and 1440, "Physical Production" loses
  part of its last letter in the Department select.** *(2026-10-27, R1's
  review round 2, R2-02; hers to overrule — walkthrough 82 §3, 47 Q57.)*
  MEASURED in Chromium (3x crops at 1280x800): at 14% the select is 156px and
  the option, the longest of the default departments, needs about 160
  ("Physical Productior"); at 15% it is whole, and the 1% can only come from
  Day rate, where "$100,000 / $128,000" is then cut by 4px. Every other column
  is at its least (`pages.test.js`). The select's title shows the name whole.
  Ways out: a narrower select arrow on this table, a shorter default name, or
  the page's full width at 1440 (walkthrough 82 Q1 (b)). Owner: Audrey, then
  a session.
- **R1-L4 · A task whose status or priority is outside the table's lists
  shows the list's first option in its row.** The row's select has no option
  for the stored value (`'archived'` shows Waiting to start, `'critical'`
  Low), while the CSV writes the stored value in words (Archived, Critical).
  MEASURED by R1's review round 2 in jsdom (R2-06); the table's selects
  predate R1. Fix: show the stored value as a disabled option, or refuse
  values outside the lists where they are written. Owner: the Tasks table's
  next session.

## Post-overhaul M1 (`po/m1-migration-part-1`) — left open (2026-10-27)

What M1 (night 3: the desktop → cloud migration, part 1) found outside its
list while taking the inventory of the bundle (the handbook's §3.1 table).

- **M1-L1 · ~~CLOSED by M3 (2026-10-28): each live managed file is a `files`
  row with its body by the company's storage rule (`carryManagedFiles`,
  `runMigrationBins.test.js`); asset versions by measurement — no desktop
  writes one (0 rows on wilson-dev, `upsertAssetVersion` has no caller), so
  the kind is named only when a bundle holds any.~~ No night of the plan carries asset versions or the desktop's own
  file store.** **→ Night 5's (M3): Audrey's ruling of 2026-10-28, "A night
  after part 2 (Recommended)"; M2-L1 holds the list.** The plan's §2 list for *the migration carries everything*
  names shot lists, edits, folders, comments, milestones, budgets, expenses,
  levels and experiences; a bundle's `assetVersions` (an asset's version
  history) and `managedFiles` (the files FileManager keeps with an asset,
  scene, shot, level or experience, in its folder on this computer — on the
  desktop every entity's files are of this kind, `ctx.supportsManagedFiles`)
  are in neither M1's brief nor M2's. MEASURED from the code: the runner reads
  neither, and the report did not even name the managed files until M1 added
  them to `NOT_CARRIED` (with asset versions, under "the migration does not
  carry it"). Archive and clear local keeps their records in the archive
  file; the bodies stay in the project's folders on disk. Fix shape: each
  live managed file as a `files` row with its body (its folder by its
  `folder_path`, its entity link), after the folders; asset versions after the
  assets and files. Owner: the controller (a line for the plan).
- **M1-L2 · ~~CLOSED by M3 (2026-10-28): the rate cards with their entries
  and the task templates go once per run (a workspace admin or the rate card
  edit grant; a workspace admin or manager), the team through the people map
  (matched by email, her ruling); department defaults stay (no cloud home,
  counted).~~ (→ night 5's, M3: Audrey's ruling of 2026-10-28; M2-L1) No migration carries the workspace's rate cards, team members or
  task templates.** `{userData}/rabbit-data/{rate-cards,team-members,task-templates}/`
  are workspace stores; the runner reads projects only
  (`/api/rabbit/projects`), and neither night's brief names them. A desktop's
  rate card stays on this computer; the cloud's Rate card page starts from the
  company's. MEASURED from the code. Fix shape: a workspace step before the
  projects (rate cards and their entries, task templates; team members want a
  decision — the cloud's directory seats people with accounts). Owner: the
  controller.
- **M1-L3 · ~~CLOSED by M2 (2026-10-28): the levels and experiences land
  before the files, and a file's level or experience link is kept only to
  this project's row, let go otherwise (`FILE_LINKS`, measured: the key takes
  any project's level).~~ A desktop file linked to a level or an experience fails until
  part 2 carries its row.** The runner sends a file's `level_id` /
  `experience_id` as the desktop holds them, and 0043's foreign keys refuse an
  id the cloud does not hold (`files_level_id_fkey`); levels and experiences
  are part 2's. INFERRED from 0043 and the runner: the desktop's upload routes
  write neither link (`electron/projectFileStream.cjs`), so only a file patched
  with one meets it. Fix shape: part 2 carries levels and experiences before
  the files, or lets the link go and says so, as M1 does for a file's link to
  a row removed on this computer. Owner: M2.
- **M1-L4 · ~~CLOSED by M2 (2026-10-28), Audrey's ruling "Add the three to
  the cloud (Recommended)": migration 0103 adds `draft`, `wrapped` and
  `inactive` to `project_status` (suite 106: a member saves each of the
  eight, a reader cannot); the cloud adapter sends a cleared Director or
  Producer as NULL (`supabaseLoadProject.test.js`, "on the wire"); the
  migration carries a project's status as it is.~~ In the browser, a project's status can be set to one the cloud
  refuses.** R.A.B.B.I.T.'s project settings offer Draft and Wrapped
  (`ProjectSummaryView.jsx`'s `STATUS_OPTIONS`) and the Projects page offers
  Inactive (`ProjectDetailPanel.jsx`); the cloud's `project_status` has
  active, on_hold, completed, archived and cancelled (0000). MEASURED on
  wilson-dev, rolled back: *22P02: invalid input value for enum
  project_status: "wrapped"*. The cloud adapter's `updateProject` sends the
  value as chosen, so choosing one of the three in the browser has its save
  refused (INFERRED from the code; not clicked, since a save would write). A
  project the intake wizard makes is Draft as well. The migration no longer
  meets it: review round 1 leaves such a status out, so the project arrives
  as active, named in the report. Fix shape: one list of statuses for both
  builds, the desktop's three mapped to the cloud's five or added to the type
  (a migration), which is a decision for Audrey (the walkthrough 84's Q3 asks
  it for the migration). Owner: the controller. Its sibling, from review round
  2: the Director and Producer pickers store `''` when cleared, which the
  cloud's UUID columns refuse (22P02, measured on wilson-dev), so a cleared
  picker's save is refused in the browser too (INFERRED from the code, not
  clicked); the migration sends such a value empty.
- **M1-L5 · ~~CLOSED by M2 (2026-10-28): this project's phases, assets and
  tasks are read before they go up (an id another project holds is said, and
  what names it lets the link go), and each phase link is kept only to this
  project's phase (measured: the three keys take any project's phase).~~
  Phases, assets and tasks go up without an "is it this project's"
  check, and their own phase links raw.** Review round 2, outside M1's list.
  The runner inserts phases, assets and tasks with `insertOrSkip` and no
  `ours` test, so an id another project holds reads as "already there"; and
  `assets.phase_id`, `tasks.phase_id` and `phases.parent_phase_id` go up as the
  desktop holds them, plain foreign keys with no project in them. M1's own
  kinds check each link against this project's rows (`stateOf`, `verified`),
  so nothing of M1 hangs off such a row; a task of this project could, through
  its phase. INFERRED from the runner and 0000; reachable only where two
  projects share an id (a desktop project copied whole, ids kept). Fix shape:
  read this project's rows first, as BC3 does for scenes, shots and bins, and
  give the three tables the `ours` test and their phase links the key dates'
  check. Owner: M2 (it reworks those inserts for the budgets).
- **M1-L6 · ~~CLOSED by M1 (2026-10-30), her ruling "Yes, M1 fixes it now
  (Recommended)": in the cloud a financial upload with no folder of its own
  takes the project's INVOICES category folder, read by its kind and path
  (the planner's own spelling) and, where the project's tree lacks it, made
  under the project's root (review round 1); a read or a make that fails is
  said in the console and files it at the top (`uploadFile`;
  `invoiceUploadFolder.test.js`, twelve failing controls over the change and
  its two review rounds, both on Fable). MEASURED on wilson-dev, rolled back:
  such a row lands, financial, filed and stamped with its workspace; and the
  make, an INVOICES category row under the root of a project that lacked one
  with an invoice filed in it, lands too; invoices added before stay where
  they are (none at the top on wilson-dev). Local Server mode's own upload is
  M1-L7.~~ An invoice added in the cloud lands at
  the top of the Files tree, while a moved one goes into INVOICES.** Audrey's ruling of 2026-10-29
  (walkthrough 84, M1's Q1, "b") files the invoices and receipts the
  migration carries in the INVOICES folder, where 0041 means invoice files to
  sit. The cloud's own upload of an invoice (`InvoiceAttachment.jsx`, and
  BudgetView's receipts: `uploadFile(projectId, { financial: true, … })`)
  names no folder: its container is the project, so `folder_id` stays null
  and the Files tree draws it at the top (`fileTree.js`). MEASURED from the
  code, not clicked. Fix shape: in `uploadFile`, a financial upload with no
  folder of its own takes the project's INVOICES category folder, read as the
  entity folders are. Owner: for her to place.
- **M1-L7 · ~~CLOSED by M1 (2026-10-30), her ruling "Yes, M1 fixes it now
  (Recommended)" ("The same rule in the desktop's two upload routes, so the
  desktop and the cloud agree, as your parity rule asks"): both routes file an
  invoice or a receipt in the project's INVOICES category row as `folder_id`
  (`invoicesFolderOfBundle`, main.cjs's planner row and its one row writer;
  `projectFileStream.test.js`). MEASURED in the desktop app itself, a
  development build driven off-screen with a scratch profile and no sign-in:
  the stream files an invoice and the base64 POST a receipt in INVOICES, an
  ordinary file goes in none, and a removed INVOICES row is planned again by
  the desktop's next read (Session 26's reconcile on read) and the next
  invoice files into it; the same driver on the commit before the change
  files neither. Review round 1 (on Fable): the hook is built in one tested
  place (`invoicesFolderHook`), and the desktop's folder delete lets its
  files' `folder_id` go, as 0043's SET NULL does in the cloud — measured the
  same way (the removed row's invoice and receipt keep no id; before the fix,
  they kept it). Review round 2 (on Fable): the hook is tested over
  main.cjs's own planner and row writer, lifted from the file, and the
  delete route is replayed (a file anywhere below the removed folder keeps no
  id; one in a sibling keeps its own); fifteen failing controls over the
  change and its two rounds. The fallback that makes the row under the root
  (a bundle read without that reconcile) is pinned by the route tests, not
  reachable through the routes.~~ In Local Server mode (a project kept on the desktop), an invoice
  added there still sits at the top of the Files tree.** Review round 1 of
  M1-L6 (2026-10-30), outside its question. The desktop's two upload routes
  (`electron/projectFileStream.cjs`, the POST and the streamed PUT) write
  `is_financial` and the INVOICES directory but no `folder_id`, and the Files
  tree (`fileTree.js`) places a file by `folder_id`, else its entity, else the
  top: in Local Server mode an invoice added from the budget sits at the top
  beside the INVOICES folder the desktop's planner makes
  (`electron/main.cjs`), while the cloud now files it inside. The desktop
  signed in to the cloud uploads through the cloud's adapter
  (`RabbitProvider.jsx`'s adapter mode), so it files it in INVOICES (review
  round 2); and the migration files a Local Server invoice there when the
  project moves. Her parity rule (2026-08-10, quoted in that file: "all
  functionality should be the same in both versions of the app") would ask
  for the same; her question named the cloud. INFERRED from the code. Fix
  shape: in both routes, a financial upload with no folder takes
  the bundle's INVOICES category row (`kind === 'category'`, the planner's
  path). Owner: for her to place.

## Post-overhaul M2 (`po/m2-migration-part-2`) — left open (2026-10-28)

What M2 (night 4: the desktop → cloud migration, part 2) leaves, and found
outside its list.

- **M2-L1 · ~~CLOSED by M3 (2026-10-28): every kind on the list is carried or
  settled — the team by email (the unmatched named, their rows arriving
  without the person), a line's and a rate's person, the files kept with rows
  (their bodies by the company's storage rule), the rate cards and templates,
  the assets' template links restored by UPDATE; asset versions settled by
  measurement (none exist).~~ Night 5 (M3) carries what no night has carried yet** (Audrey's
  ruling of 2026-10-28, "A night after part 2 (Recommended)"). MEASURED from
  the runner and the report (`NOT_CARRIED`'s later group): `teamAssignments`
  and `projectTeam` (they land in `project_members` by cloud user id, after
  her ruling on people without accounts — the cloud seats only people with
  accounts); what a budget line says of a team member (`team_member_id`,
  carried empty: 0037 reads it as a workspace member's user id on the cloud)
  and a team member's project rate (not carried: 0037's target CHECK needs one
  of role or person); an asset's version history (`assetVersions`); the
  files the desktop keeps with an asset, scene, shot, level or experience
  (`managedFiles`, their contents uploaded — designed first); the company's
  rate cards and task templates (`{userData}/rabbit-data/`), and the template
  an asset was made from (`task_template_id`, carried empty: the key refused
  the whole asset, 23503, measured). Fix shape: the plan's night 5 row; M3's
  brief follows M2's merge. Owner: M3.
- **M2-L2 · The cloud adapter's `upsertTaskLink` sends the provider's
  `project_id`, which `task_links` has no column for.** `RabbitProvider.addTaskLink`
  builds `{ id, project_id, ...link }` and `supabaseAdapter.upsertTaskLink` strips
  only `created_at`. MEASURED on wilson-dev (rolled back): *42703: column
  "project_id" of relation "task_links" does not exist* (through PostgREST,
  PGRST204: the whole write refused). Unreachable today: no screen calls
  `addTaskLink` (MEASURED: no caller outside the provider). Fix shape: strip
  `project_id` in `upsertTaskLink`, with a wire test. Owner: the controller.
- **M2-L3 · A dry run against a cloud without 0103 does not foresee the
  desktop's Draft, Wrapped and Inactive arriving as active.** Only the real
  run's insert meets the type's refusal (22P02), and then sends the row again
  without its status and says so. INFERRED from the runner (no probe of the
  type is made). Moot once 0103 is on every cloud the desktop reaches.
  Owner: none (said in the handbook's §17).
- **M2-L4 · ~~CLOSED by M3 (2026-10-28): moved behind the gate — the picture,
  the object (`files/` → `INVOICES/`, the Storage API's move measured as the
  admin and as a plain-user project manager; a plain member refused on both,
  42501), the row's flag, path and picture in one UPDATE; one that did not
  take is said with its reason and the run is not done.~~ Receipts an earlier build carried as ordinary files stay open to
  every member of the project.** The night-3 build routed a file by its own
  flag, so a receipt kept before C4 (`is_financial` false, named by an
  expense or an actual) went up under `files/`, flagged false. Since review
  round 1 the runner says so on every run while it stays open
  (`RECEIPTS_LEFT_OPEN`, `report.files.receiptsOpen`, a line under the
  report), never as a carried file; since round 2 it keeps the receipt apart
  in the record (`receipts_open`), so an admin's removal there stands
  (counted, named, never uploaded again). It cannot move it. Putting it behind the
  gate is an object move from `files/` to `INVOICES/` and the row's
  `is_financial` and `storage_path` together, and the storage API's move
  under 0042's policies was not measured (no sign-in on M2's run). Fix shape:
  measure the move as a project manager on wilson-dev, then a runner step that
  moves and flags each, said. MEASURED (the runner); INFERRED that one exists
  (only a project migrated by the night-3 build with a pre-C4 receipt).
  Owner: M3 or the controller.
- **M2-L5 · ~~CLOSED by M3 (2026-10-28): a line's person goes up by the people
  map, and a line an earlier run carried without one is set once where the
  cloud still holds nothing (`people_set`), a teammate's clearing standing.~~ A crew line priced for one of the desktop's team members cannot be
  reached in the Crew tab until night 5** (review round 1, M4). It goes up
  without its person (M2-L1), and the Crew tab lists people, so the line and
  its actuals show only in the Summary's totals. Audrey's Q1 in walkthrough
  85. Fix shape: night 5 moves the team and sets the person on the line.
  Owner: M3.
- **M2-L6 · The dry run foresees less than the real run in three places**
  (review round 1, L1: the part not fixed). A status a cloud without 0103
  refuses (M2-L3); the phase and level links the real run lets go, and the
  assets that wait on a level whose owner could not be read; a receipt an
  earlier build left open (M2-L4), which only the real run's per-file read
  finds. Fixed in round 1: the money files a shut gate keeps here are no
  longer in the dry run's files total. Review round 2 adds three: an actual or
  a role rate whose place the cloud holds under another id (`taken`) is
  found only by the real run's insert, so the dry run counts it as going (F3,
  MEASURED by the reviewer's probe: dry `{total 4, taken 0}`, real `{total 3,
  taken 1}`; fix shape: read this project's actuals' line and period and its
  rates' roles in the dry run, one paged read each); a project whose id is
  held out of the person's sight reads as arriving in the dry run, and only
  the real run meets its key (F7: no read can see it); the dry run counts no
  set-aside rows. M3's review round 2 adds one of the files kept with rows: one
  whose id the cloud holds under another project is found only by the real
  run's per-file read (said as not this project's), so the dry run counts it
  as going and probes its body. INFERRED from the runner unless said. Owner:
  none.
- **M2-L7 · A clip's picture removed in the cloud would come back on the next
  run** (review round 1, L4). The runner uploads a picture for a clip whose
  cloud row has none; the record holds the clip, not its picture. Unreachable
  today: MEASURED, no screen or adapter call clears a clip's `poster_path`.
  Fix shape: record the clips whose picture this computer uploaded (beside
  `pointers` and `set_aside`) and never upload one again. Owner: none until
  a screen removes pictures.
- **M2-L8 · Where the runner cannot read whose a row is, it trusts the id.**
  Comments, dependencies and a task's items have no read of "this project's
  rows" before they go up (a comment has no project; M1-L5 settled phases,
  assets and tasks): a duplicate by id is taken as this project's and joins
  the record. Only a desktop project copied with its ids and migrated into a
  private project the runner's person cannot see makes one, and a later run
  would then call it removed. Round 1 settled the pair keys (L2: never
  recorded) and every table with a read (recorded only once known). INFERRED.
  Owner: none.
- **M2-L9 · Three record rules that are choices, said** (review round 2, F4,
  F5 and a nit). A Legal file is never asked about by the record (0092's gate
  is not asked per project), so a teammate's removal of one is never named,
  though it is never brought back either (MEASURED by the reviewer: re-uploaded
  0). The rows set aside again are recorded by row, not by bid version, so a
  row set aside once under one version is not set aside again under a later
  one (fix shape, if wanted: `<version>:<row>`). `SET_ASIDE_AGAIN` counts the
  rows asked, not those the function changed (it keeps an earlier stamp).
  INFERRED from the runner. Owner: none.

## Post-overhaul M3 (`po/m3-migration-part-3`) — left open (2026-10-28)

What M3 (night 5: the desktop → cloud migration, part 3) leaves, and found
outside its list.

- **M3-L1 · The ordinary `files` step sends every body to the Supabase bucket
  whatever the company chose.** The runner's files step uploads through
  `supabase.storage.from('rabbit-files')` with no read of the company's
  storage rule, while the files kept with rows (M3) go where
  `activeWorkspaceProvider` says (s3's provider, nothing for a server
  company). MEASURED from the runner (the step predates the registry). An s3
  company's desktop files land on Petal, where its browser upload would not
  put them. Fix shape: route the ordinary files through the same
  `storageRule()` as the managed ones, with the s3 bound and the server
  sentence. Owner: the controller.
- **M3-L2 · An s3 company's body is one PUT of a fetched Blob, up to 5 GiB.**
  WILSON has no S3 multipart (S37), so the s3 provider's `put` takes a Blob;
  the migration fetches the managed body whole (Chromium's blob store spills
  to disk past its memory limit) and leaves one past
  `S3_MAX_SINGLE_PUT_BYTES`, counted. The Range-fed path exists for Supabase
  only. INFERRED (not measured against a bucket). Owner: none (the stated
  limit of the s3 provider).
- **M3-L3 · A raw desktop id a build before M3 left in a cloud person column
  stays until the person has an account.** M3 sets the people on rows an
  earlier run carried only where the map names the person; an unmatched
  one's column keeps the desktop id (it names nobody — measured, no key), and
  the next run after they join sets it once (`people_set`). Said in the
  handbook's §17. Owner: none.
- **M3-L4 · `task_templates` stamps no maker.** A template the migration (or
  the adapter's upsert) inserts has `created_by` null — MEASURED on
  wilson-dev: the table has 0004's `touch_updated_at` trigger and no
  `fn_audit_touch`. 0044's gates read neither, so nothing hangs on it. Fix
  shape, if wanted: the audit trigger on the table. Owner: none.
- **M3-L5 · The dry run of a project not yet in the cloud counts its assets'
  template links as linkable.** It cannot read rows that do not exist; the
  real run links after the templates land, and a template refused then
  leaves the link, counted (`assetTemplates`). INFERRED from the runner.
  Owner: none.
- **M3-L6 · A receipt's picture that cannot be moved is removed.** The move
  behind the gate (M2-L4) removes a thumbnail it cannot move rather than
  leave a legible JPEG of the receipt open; the browser then shows the icon
  until the file is added again. By design (the design review's finding 1).
  Owner: none.

## Post-overhaul DG4 (`po/dg4-dog-project-references-card`) — left open (2026-10-28)

What DG4 (night 3: D.O.G.'s project and references card, Audrey's five
notes) met outside those notes and did not fix.

- **DG4-01 · A click on a D.O.G. checkbox's words does nothing; only its
  14px box ticks it.** MEASURED in Chromium at 1280x800 (DG4's scratchpad
  probe): a click in the middle of *Place visual*'s words (76x21px) and of
  *Theme generator*'s (108x21px) left each as it was; a click on the box
  (14x14px) ticked it. The same for *Core files only*, and before DG4 for
  every D.O.G. checkbox: the words are a `span.dog-check-label` beside the
  `button.dog-check`, with no `<label>` (the kit has no Checkbox, A1-KR-4).
  Fix: the words inside the button's target, or the kit Checkbox when
  A1-KR-4 lands. Owner: a D.O.G. session, or the kit request.

## P1 (`po/p1-own-storage-previews`) — left open (2026-10-28)

What P1 (night 4: browser previews on a workspace's own storage) measured
outside its scope, or built to a limit, and did not fix. The design is
`NETWORK_STORAGE_DESIGN.md` §9.

- **OSP-02 · A download from a company's own bucket reads the whole body into
  memory.** `s3Provider.getUrl` answers null for `{ download }` (the read
  signer signs no attachment disposition, and a cross-origin `a.download` is
  ignored), so `downloadUrl` falls back to the Blob path through
  `storage-presign` — the S42 limit, still true for s3. Fix shape: a signed
  `response-content-disposition` in `_shared/s3Presign.ts` (shared with three
  functions). Owner: the next storage session.
- **OSP-03 · A clip longer than an hour restarts at 0:00 on its re-mint** — on
  Petal and on a bucket alike: the player re-mints once on its first failed
  range and keys the `<video>` on the new URL. Fix shape: `VideoStage`
  keeps `currentTime` across the re-mint. Owner: none yet.
- **OSP-04 · Rows written on s3 before a switch to `network` answer "configure
  S3".** 0050's switch rule nulls the s3 config, so both signers answer their
  409 (*"…an admin sets it in Admin Terminal → Storage"*) for those rows: a
  misleading sentence for a NAS admin. None exist (no s3 workspace exists
  anywhere). Owner: the next storage session.
- **OSP-05 · A receipt uploaded to an s3 workspace before 0076 is
  indistinguishable from any other file** (it sits under its container
  segment, unflagged; 0076 counts and reports those rows and cannot flip
  them), so either signer signs it for a reader of its project. None exists
  on any environment. **A release check:** before any s3 workspace with
  receipts from before 0076 exists, count `files` rows in
  `expenses.file_ids` with `storage_provider = 's3'`; any above zero needs
  its body moved into Supabase first. Owner: the release runbook.
- **OSP-06 · The live proof waits on Audrey's test bucket.** No S3 workspace
  exists on any environment and no session holds a bucket's keys: the signer
  is proven by its tests (21 failing controls) and by its refusals on
  wilson-dev to a caller with no sign-in. Walkthrough 85, P1, is the live
  check once the controller has deployed `storage-read-urls` to staging.
- ~~**OSP-08 · `storage-read-urls` bounds its body by the declared length.**~~
  **CLOSED by build review round 2 (2026-10-28):** the body is read by
  `readJsonLimited`, streamed under the 128 KB cap; no declared length is
  required. The entry as it stood:
  It refuses a body without a `content-length` (411) or over 128 KB (413)
  before reading it; HTTP/1.1 framing makes the declared length binding, but
  the house readers (`gatewayWire.ts` `readJsonLimited`, `aiFileStore.ts`
  `readSmallJson`) stream under a cap instead (round 1, finding 5). Owner:
  none; a consistency change.
- **OSP-09 · A failed renewal keeps an s3 preview URL past its life.**
  FileManager keeps a key's last URL until a fresh one arrives, so after
  failed renewals (offline, a 5xx) a tile below the fold that loads late gets
  a dead URL, fails once and shows the icon until the next ask (five
  minutes, or the tab's return); a key the signer has since refused keeps its
  last URL until it expires (round 1, finding 7). Fix shape: `getUrls`
  returns each URL's end and the merge drops the dead. Owner: none.
- **OSP-10 · A clip the preview plays by its MIME type alone streams for
  five minutes.** `previewKindFor` picks the player on `video/` or `audio/`,
  while `storage-read-urls` gives the streaming hour only to the extensions
  it knows (`STREAMABLE_EXTENSIONS`, the client's own lists), so an s3
  `.ogv`, `.3gp`, `.aif` or `.wma` gets 300 s, stalls, re-mints once
  (OSP-03) and stalls again (build review round 2, finding 4). Fix shape: the
  s3 arm decides the stage by extension, or the lists grow. Owner: none.
- **OSP-11 · The dev fixtures pass the server-media read's cloud gate.**
  The fixtures adapter reports `adapterMode` 'supabase', so FileManager and
  the Files tab ask the shared client for the storage choice; the read fails
  (the fixtures' address is a closed port) and the ordinary words stay, so
  nothing shows (round 2, finding 6). Fix shape: gate on the adapter's own
  `mode !== 'fixtures'`. Owner: none.

## R2 (2026-10-28, night 4 of `docs/sessions/PLAN_TO_1_0.md`) — left open

- **R2-01 · The workspace takeout holds 23 tables, and none of the scenes, shots, levels, experiences, key dates, budgets or bins.** MEASURED (from the code, 2026-10-28):
  `TAKEOUT_TABLES` in `src/components/AdminTerminal/WorkspaceTakeout.jsx` lists 23 tables, and scenes, shots, levels,
  experiences, key dates (`milestones`), the budget tables, expenses, folders, task templates, shot lists, edits, bins and their
  clips are not among them, while the Company card's *Workspace takeout* reads as the whole company's. Would settle it: a takeout
  of a project that holds a scene and a budget. Owner: none named; 1.1 unless she says otherwise.

## Post-overhaul REV (the controller's read-only code review, 2026-10-31) — recorded

Her ask of 2026-10-31, verbatim: *"review the overall code. DO NOT MAKE CHANGES.
review the overall code. is there any existing redundancies. is there any
functions or systems that are almost duplicates of each other. is there
anywhere we can make things more efficient."* The review is
`docs/reviews/CODE_REVIEW_2026-10-31.md` (the five surveys beside it in
`docs/reviews/code-review-2026-10-31/`). Its redundancy and efficiency
findings live there, not here; the seven correctness defects it found along
the way are recorded below. Nothing becomes a session unless she names it
(`PLAN_TO_1_0.md` §5, rule 8).

- **REV-01 · ~~CLOSED by F1 (2026-10-31; `ef652296`), her ruling "Record it,
  fix at the release steps": `PAGE` added to the import from
  `_shared/teardownCollect.ts`, nothing else in the function changed.
  MEASURED on GitHub's runner by CI's new `deno check` (Deno 2.1.4): on
  `8b4eac85`, the file as it was, run 41224857857 red on TS2304 "Cannot find
  name 'PAGE'" at `:230`, `:233`, `:237`, `:655`, `:662` and `:667` and on
  nothing else new; on `ef652296` run 41224959673 green. The pin in
  `src/cloud/teardownCollect.test.js` (every name `index.ts` uses from
  `teardownCollect.ts` is in its import) red before, green after. The deploy
  to dev and staging is the controller's, on her go: until it lands the
  function still answers the list a bare 500 with no CORS headers, which the
  console shows as "Network error — check your connection." (INFERRED from
  `operatorApi.js:106-107`, as `index.ts:388-395` records for the same
  crash). Teardown step 1d threw too (at `:662`, caught at `:674`): any
  teardown run on dev or staging since 2026-10-28 wrote its WIL-7012
  certificate with `truncated: true` and that run's own abandoned paths
  only, or none when nothing was open, rather than skipping in silence
  (by reading; review round 2).~~ The operator console's
  company list fails: `operator-workspaces` uses `PAGE`, which nothing
  defines or imports.**
  `supabase/functions/operator-workspaces/index.ts:230-237` (the `list`
  action) and `:655-667` (teardown step 1d) read `PAGE`; the import at `:73-76`
  takes the buckets and the two collectors from `_shared/teardownCollect.ts`,
  not `PAGE`, which P8's commit `9bff662a` (2026-10-28) moved there (`:50`).
  That commit is in the version deployed to staging (`3b471707`) and to dev,
  so the console's Companies tab has failed on the beta since 2026-10-28
  (`ReferenceError` at run time: the list answers a bare 500; teardown step
  1d is caught at `:674` and silently skips the abandoned-upload record). CI
  has no `deno check`; `deno` is not on the controller's machine. MEASURED by
  reading, not run. Her ruling of 2026-10-31, verbatim: *"Record it, fix at
  the release steps"*. Fix shape: `PAGE` added to the import, and a
  `deno check` of every function in CI with a failing control. Owner: the
  release steps, before `PRODUCTION_RUNBOOK.md` (g) 11; the controller then
  deploys the function to dev and staging on her go.
- **REV-02 · ~~CLOSED by F2 (2026-10-31; `d1274ed4`), with her ruling of
  that day on the fee switched on with no percentage typed, "20%" (in F2's
  question box; to the controller, "20 percent"): every
  Budget surface calls `src/components/Budget/budgetMath.js` — the settings
  read once (`projectBudgetSettings`, `AGENCY_DEFAULT_PCT`), margin and
  contingency on the base, the fees on it beside them (`lineMoney`), cents as
  `bidTotals` rounds, one `round2`; the fourteen inline copies gone, and a
  scan in `budgetMath.test.js` red on each shape they took. MEASURED in
  Chromium on the fixtures (walkthrough 91, F2): with the fee on and none
  typed the Summary charged 20% (+$18,434) and the Crew tab said "Agency: 0%",
  now 20% on every surface; with 10% typed the Crew tab's contingency +$8,449
  → +$7,681, the Talent tab's +$1,538 → +$1,230, the client estimate's
  $12,881 → $12,573. N1's hand-off note (list 4, "the four Budget views
  still run inline copies, untested") resolved: `effectivePct` and
  `applyMarginAndContingency` are what they run, through `lineMoney`;
  `profit` still has no caller (no surface shows a profit: the Variance
  columns are the actual less the bid).~~ The budget's money rules
  disagree.** The agency percentage
  defaults to 20 when never set in
  `src/tools/rabbit_v0.1.0/state/budgetVersionModel.js:189` and to 0 in
  `views/budget/CrewTeamTab.jsx:123`, `src/components/Budget/useBudgetLines.js:228`
  and `views/BudgetView.jsx:890`; the Crew tab applies margin and contingency
  to the base plus the agency fee (`CrewTeamTab.jsx:197-200`) while
  `bidTotals` (`budgetVersionModel.js:206`) and the tested rules in
  `src/components/Budget/budgetMath.js` apply them to the base, which handbook
  §17 states as the rule. The tested rules (`effectivePct`,
  `applyMarginAndContingency`, `profit`) have no product caller. MEASURED by
  reading, not run. Fix shape: one money module every Budget surface calls,
  the agency default decided once. Owner: Audrey (1.0 or 1.1, her call).
- **REV-03 · O.T.T.E.R.'s Validator reads the FIRST text block of a reply.**
  `src/tools/otter_v0.3.1/Validator.jsx:36` returns
  `content.find(b => b.type === 'text')` before its `pause_turn` check, so a
  web search that says "Let me check…" before searching hands that sentence
  to the JSON parser. The house rule is `textFromMessage` (the last block);
  `src/cloud/textFromMessage.test.js` scans only for `content[0].text`, so
  `.find(...)` passes it. MEASURED by reading. Fix shape: the Validator calls
  O.T.T.E.R.'s own wrapper (`Otter.jsx:1196-1252`) and the guard test learns
  the `.find` shape. Owner: Audrey.
- **REV-04 · D.O.G.'s editable prompt boxes change nothing that is sent.** The
  single-page and full-deck instruction boxes write state whose only readers
  are their textareas (`DeckOutlineGenerator.jsx:517-518` → `:4999`, `:5034`);
  what the model receives is inline text at `:1283-1400`, `:1580-1665` and
  `:1896-2062`, and `prompts/*.js` with `rules.js` (475 lines) never reach it,
  though `src/data/dogHelpContent.jsx:395-451` says they do. The theme prompt
  box is live (`:649`). MEASURED by reading for the two instruction boxes; the
  survey (`docs/reviews/code-review-2026-10-31/dog-otter.md` B1) says the same
  of the three export-schema editors. Fix shape: one prompt builder composed
  from the drawer's values with today's sent text as the byte-identical
  default, or the dead editors removed. Owner: Audrey.
- **REV-05 · Forgot password can silently send nothing.**
  `src/cloud/auth/ForgotPasswordWizard.jsx:50` resolves the username with no
  company; `supabase/functions/resolve-login/index.ts` takes a username and a
  company and answers a miss when a bare username exists in two companies, and
  the wizard then shows its uniform "sent" screen. The wizard's body MEASURED
  by reading; the two-company miss INFERRED (would settle it: one username in
  two companies on wilson-dev, Forgot password, no mail). Owner: Audrey.
- **REV-06 · Listing a course's subjects on the Local Server rewrites every
  subject file.** `electron/main.cjs:796-821` (`renumberSubjects`: `writeJSON`
  per subject) runs on the GET at `:824-830`; O.T.T.E.R.'s warm-up calls it
  per course at launch (`Otter.jsx:682-700`) and again for the quiz picker
  (`:2753-2757`): with her six courses and 49 subjects, 49 rewrites per load,
  through REV-07's in-place writer. MEASURED by reading. Fix shape: the GET
  read-only (the order is set by the writes). Owner: Audrey.
  **Closed by F3 (wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`,
  `po/f3-desktop-project-file`), MEASURED:** the GET reads only; POST, PUT,
  DELETE and `/renumber` keep the curriculum order (what the GET showed),
  writing only a subject whose number changed and never over a file that
  could not be read (the old renumber wrote `{ subject_order }` over one); one
  total order for every list. A GET of a course holding the fixtures' six
  subjects, on a development build: 19 disk calls, 18,171 bytes read and
  18,171 written, 4.4 ms before; 10 calls, 18,171 read, nothing written,
  2.5 ms after.
- **REV-07 · The project file's writer is not atomic.** `electron/main.cjs:245`
  (`writeJSON`: `writeFileSync` in place, no retry) writes every bundle,
  mirror, setting and pet; `readJSON` (`:242`) swallows a parse error, so a
  torn `project.json` reads back as nothing and the project drops out of the
  list (`:2314`). `electron/rendererStorage.cjs:182` already has the
  temp-file-then-rename, retried form. The writers MEASURED by reading; the
  torn-file outcome INFERRED. Fix shape: one `writeJsonAtomic` lifted from
  `rendererStorage.cjs` for every JSON write in `main.cjs` and
  `localDemoRoot.cjs`. Owner: Audrey.
  **Closed by F3 (`po/f3-desktop-project-file`), MEASURED:** every JSON write
  in `main.cjs` and `localDemoRoot.cjs` is `writeJsonAtomic`
  (`electron/jsonFile.cjs`: the text whole to `<file>.tmp`, renamed over the
  file, both retried on EPERM/EBUSY/EACCES, five tries — but a read's
  write-back, a `_DATABASES` mirror, the download and stream audit appends
  and the demo manifest at launch try once, so a folder she can only read
  does not hold them on the retries); `readJSON` keeps its shape. A crash of
  WILSON planted half-way through a write leaves the previous
  `project.json` readable (the in-place writer, the test's control, leaves one
  that reads as nothing). The bundle is kept in memory too (path and a stat
  stamp; reconciled once per disk load and on every write), and the mirrors
  written only when they change. On the fixtures' project (379,320 bytes) with
  a folder on disk, before → after: a task PATCH 22 → 17 disk calls, 379,288 →
  0 bytes read, 647,659 → 471,975 written, 9.8 → 10.0 ms (each write now a
  temporary file and a rename: 0.86–0.92 ms against 0.51–0.54 in place for
  the 379 KB bundle, three runs of 200 on this machine; review round 2's runs
  gave 1.1–1.2 against 0.6); a cached
  thumbnail 18 → 12 calls, the bundle no longer read, 5.0 → 3.7 ms; the
  project list 14 → 8, 4.2 → 3.1 ms. The rest, and what is left, under F3
  below.

## F3 (2026-10-31, wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`) — left open

Found while keeping the desktop's project file in memory; outside the brief's
list (`PLAN_TO_1_0.md` §5, rule 1), so recorded and left.

- **F3-01 · In a demo folder every cached thumbnail answers 500.** MEASURED
  (a development build, the fixtures' project in a scratch demo folder): the
  asset thumbnail GET answered 500 fifteen times in fifteen, on the tip and on
  F3's build alike; on a userData root, 200. The thumbnail cache is under
  `<folder>/.wilson/rabbit-data/thumbnails`, and the six thumbnail GETs in
  `electron/main.cjs` (managed files, assets, and the scene/shot/level/
  experience loop) call `res.sendFile(thumbPath)` without
  `{ dotfiles: 'allow' }`, which every other `sendFile` passes for this reason:
  `send` refuses the dot-folder (a 404 handed to `next`), and
  `localServerErrorHandler` answers 500. Fix shape: `{ dotfiles: 'allow' }` on
  the six, or F9's one `sendMedia`. Owner: F9 (wave 3), or 1.1.
- **F3-02 · `petKnowledge.js` says the subjects GET is a write.**
  `src/tools/otter_v0.3.1/petKnowledge.js:36` and `:477-478` (the index is built
  once per time-to-live because "on the local backend `GET /:slug/subjects` is a
  WRITE"): since F3 it reads only. A renderer comment, which F3 may not touch.
  Owner: F6 or 1.1.
- **F3-03 · The saved sign-in is written in place.** `session.enc`
  (`main.cjs`, the `wilson:session-save` handler's
  `fs.writeFileSync(getSessionPath(), encrypted)`)
  is sealed bytes, not JSON, so outside the brief; a write torn by a crash
  leaves a file `safeStorage` cannot open, and she signs in again. Fix shape:
  `writeTextAtomic`'s temporary file and rename, for bytes. Owner: 1.1.
- **F3-04 · The demo folder's root questions stat the folder on every
  question.** MEASURED: 4 `statSync` of the open folder per project list, 5 per
  task PATCH, and one `realpathSync.native`, against none on a userData root;
  on a NAS-hosted demo folder each is a round trip. Left as they are: review
  round 2's M6 makes every question re-check that the folder is still there,
  and a per-turn memo fails `src/lib/localDemoBoundary.test.js:111-121` (F3's
  design round, finding 2). Fix shape: a presence check scoped to one request
  (a middleware after `express.json`). Owner: 1.1.
- **F3-05 · Two copies of the retried write.** `electron/rendererStorage.cjs`
  keeps its own `withRetry` and `writeKept`, which `jsonFile.cjs` lifted: the
  kept storage reads its `.tmp` first, a different contract, so the design
  round left it alone. Owner: F9 (wave 3).
- **F3-06 · A title that slugifies to nothing puts the project at the root.**
  INFERRED by reading (F3's design round, note 12): for 東京, Проект or 🎬,
  `fileSlugify` gives `""`, so the project POST makes its folder at
  `path.join(rootDir, '')`, the configured root itself, and a PATCH to such a
  title leaves `<oldSlug>_FILES` behind. Since F3 the bundle's slug is repaired
  to `Untitled-Project` in the write (before, by the next read); where the
  folder was made is not, and the POST makes the project's sub-folders before
  that write, so such a title gets a bare `_DATABASES` and `_FILES` at the
  root itself (F3's build review round 2; the PATCH's twin was moved after
  its write in round 1). Owner: 1.1.
- **F3-07 · The list and the thumbnails still parse each kept bundle.** Each
  project in the list and each thumbnail GET parses the whole kept text (about
  0.5 ms for the fixtures' 379 KB) to read `bundle.project` or one row; the
  review's C1 suggested a project-only read and a `?keys=` projection. Not
  built: route bodies, beyond the brief. Owner: none.
- **F3-08 · Two loose ends of the subject routes.** The DELETE's renumber is
  not guarded as the POST's and the PUT's now are (F3's build review round
  1), so a renumber that cannot write another subject answers 500 after the
  delete has landed (before F3 too). `POST …/subjects/reorder` has no caller
  in the renderer; since the list reads the stored order, an order it sets
  now stands until the next subject write renumbers. INFERRED by reading
  (round 2's notes). Owner: none.

## AT1 (2026-11-01, night 10 of `docs/sessions/PLAN_TO_1_0.md`) — left open

The admin terminal edge to edge, the member panel in two columns with no
scroll from 1280x720, its confirms beside the panel and centred on the window
(her ask of 2026-11-01; the session log's AT1 row; walkthrough 92). What AT1
met outside its list, or decided and left for her:

- **AT1-01 · Beside an open member, at 1280 and 1440, the roster shows Member
  and Status only.** By design (the design round; her Q2 in walkthrough 92,
  built on the recommendation): the four columns it drops are what the panel
  shows for the open member and come back when it closes; from 1920 the six
  stay. MEASURED: roster 424 / 584 / 1,064 / 1,704 px at the four sizes. The
  trade (review round 1, against C1): another member's username, role, rate
  access and joined date need the panel closed at those widths, nothing on
  screen says columns were folded, and the search still matches a username or
  email it no longer shows. Before AT1 the six scrolled sideways there with
  Joined cut. **Her answer of 2026-11-01 to walkthrough 92 Q2: "Name and
  status (Recommended)"** — kept as built; the trade above stays recorded.
- **AT1-02 · On a wide window Company, Diagnostics and Storage keep the
  720px reading measure**, left-aligned at the pane's edge. MEASURED at
  2560x1440: 720 in a 2,288 pane, 1,568 px empty to their right (Models 1,240;
  Requests and Logs 2,288). Left as the design round chose (prose and
  label/value cards); her "empty space to the sides" may cover them too. Her
  answer to walkthrough 92 Q1 (2026-11-01): "Edge to edge (Recommended)", the
  page as built; these three sections were not part of that question.
- **AT1-03 · The roster's search field shrinks to 175 px beside an open
  member at 1280, which cuts its placeholder** ("Search username, name, e…").
  MEASURED at 1280x800. The field still works; a shorter placeholder is a
  word for the copy's owner.
- **AT1-04 · Below 1220 the panel is one column and scrolls; the pet sits
  over its bottom-right corner.** MEASURED at 1024x700: 621 px of content
  (with the real account rows in place; 524 with the fixtures' notice) in 452. Whether the pet covers a control once scrolled is NOT measured.
- **AT1-05 · The member panel's account rows do not load on the dev
  fixtures** (`adminApi.js` answers the security read with a notice), so every
  picture shows the notice; the real rows were measured by putting their markup
  in place (147 px value column, no sideways scroll, the worst case 392 px).
  Outside AT1's files.
- **AT1-06 · Kit request B4-KR-2 (a portal on the kit `Dialog`) stays open.**
  AT1 fixed its confirms as the house answer does (siblings of the host, B3c)
  and changed no kit file. Of the 62 non-test files that render `<Dialog`, 24
  portal at least one at the call site (`createPortal(…, document.body)`,
  the B4 lanes' answer for a component inside a transformed host); the rest
  render inline (round 2 counted 46 files with an inline one), safe only
  while no ancestor of theirs has a transform. The panel borrows the dialog
  token `--dialog-form` (560) for its width (review round 1, a Note).
- **AT1-07 · A stale note in `adminTerminal.css`**: the 1180px block's
  comment says the detail panel gives width back there; only the nav and the
  search do (review round 1, read; it predates AT1).
- **AT1-08 · After the Invite dialog or the Add people menu is closed with
  Escape, focus lands on `<body>`.** MEASURED by review round 2 with real
  key presses at 1280x800; it predates AT1 (the panel's confirms return
  focus to their button).

## SB1 (2026-11-01, night 10 of `docs/sessions/PLAN_TO_1_0.md`)

O.T.T.E.R.'s courses sidebar and D.O.G.'s pages sidebar resize by dragging
their edge, through one handle on the kit Panel (her ask of 2026-11-01; the
session log's SB1 row). What SB1 met outside its list and did not fix: the
design round's three WCAG items, and one interplay measured for the pictures.

- **SB1-01 · A pointer that cannot drag has no way to set a sidebar's width
  (WCAG 2.2, 2.5.7 Dragging Movements, AA).** MEASURED on
  `po/sb1-resizable-sidebars` (2026-11-01, Chromium on 5303, the fixtures):
  the handle answers a drag, a double-click (back to the default) and the
  keyboard (the arrows, Home, End); a single click does nothing, and nothing
  else sets a width. 2.5.7 asks for a way a single pointer can use without
  dragging; the keyboard does not count. Fix shape (the design round's): one
  small control of 24px or more on or beside the line, for example
  *Narrower*, *Wider* and *Reset width* in a menu, which meets SB1-02 too.
  Owner: hers to place (1.1); outside SB1's list.
- **SB1-02 · For a mouse the grab strip is 8px wide (2.5.8 Target Size
  (Minimum), AA, asks 24), and it shares pixels with the rows on either
  side.** MEASURED (Chromium, 1280×800, the default widths): the strip is 8px
  by the panel's height (24 under `pointer: coarse`, a finger). Its 24px
  spacing circle meets the course rows' menus and the subjects' delete
  buttons, which end 5px inside the line, and D.O.G.'s Remove, 5px inside
  too. Its 2px inside the line take the last 2px of the full-width rows
  (O.T.T.E.R.'s *Add subject*, D.O.G.'s page rows); its 5px beside take the
  first 5px of whatever starts at the line, which in O.T.T.E.R.'s Study,
  Hotkeys and Nodes views is Sidebar 2's rows (a section, a lesson,
  *Sources*): a press there grabs the line instead of opening the row, and a
  click there does nothing. D.O.G.'s nearest button or field beside is 21px
  away, but card 1's header, which folds the card on a click anywhere on it,
  starts 9px beside the line (after the column's 8px padding and the card's
  1px border; review round 2, measured). For a finger (`pointer: coarse`,
  review round 1, measured with touch emulation) the strip is 24px, 4 inside
  and 19 beside: it takes Sidebar 2's rows from 1 to 19px beside the line and
  the first 10px of D.O.G.'s card 1 header, so a tap there grabs the line
  instead of folding the card; a vertical swipe that
  starts on those pixels cannot scroll the list under them (`touch-action:
  none`; INFERRED). A finger must travel 8px before it drags (a mouse 3), so
  a tap that wanders does not resize. The design round chose these numbers
  (VS Code's sash takes the same 2px inside). Fix shape: SB1-01's control.
  Owner: 1.1.
- **SB1-03 · At rest the separator is the 1px hairline, 1.48:1 against the
  paper (1.4.11 Non-text Contrast, AA, asks 3:1).** MEASURED with the kit's
  contrast helper: `--color-rule` over `--color-paper` flattens to `#3a3735`,
  1.48:1. The brief keeps the line as drawn, so the strip is found by its
  cursor and by the 2px band of the signal (4.91:1 on the paper, 3.32:1
  against the rule it covers) on hover, a drag and keyboard focus. Every
  Panel's hairline is the same rule. Fix shape: a brighter rule at rest, a
  kit token across every docked panel, hers to choose. Owner: 1.1.
- **SB1-04 · With O.T.T.E.R.'s courses column widened in a 1280×800 window,
  the pet covers part of the lesson's *Next* button.** MEASURED (Chromium,
  the fixtures, the first lesson): the lesson column centres in what is
  left, so a wider courses column moves *Next* right, under the pet (fixed
  at the window's bottom right, with no drag of its own). At the default 200
  they do not meet; at 320 the pet covers 14px of the button's 90 (515 px²);
  at 480, 39px (1,225 px²); at 1440×900, none even at 480. It is not new: at
  the default width a 1100×760 window covers *Next* the same way (484 px²).
  Fix shape: the pet's place over the page (walkthrough 47's question), not
  the sidebar. Owner: the pet's (1.1).

## D.O.G.'s reading meter (the controller's read-only measurement, 2026-11-05) — recorded

Her words of 2026-11-05, verbatim: *"Also I added a 110 page script of a movie
and it read it fine and the limit bar said we were more than 100% of what DOG
can read. but it was fine. this is not related to the visual update"*. Read in
the code at `283e65ea` and in staging's usage log; nothing was changed. Her
answer the same hour, verbatim: *"Fix it in the D.O.G. session (Recommended)"*:
DG7's brief carries it as its item 5.

- **~~MTR-01 · The meter says "Past what D.O.G. can read for one deck" for a
  deck that reads whole.~~ CLOSED by DG7 (`3dfe6831`, `5606e628`): the limit is the
  model's, from the provider's documentation, in the registry
  (`MODEL_INPUT_LIMITS`); less the 16,384 reserved, 983,616 on Sonnet 5; a PDF
  page 3,000; the number past the limit, and *(an estimate)* in the sentence until
  her ruling of 2026-11-06 took it out (DG8). A
  110-page text PDF reads 330,000, 34 percent.** MEASURED (read; staging's `app_events`, tool `dog`,
  read-only): the bar is an estimate that warns and never blocks (her Q8 of
  2026-10-16, *"Meter, then warn"*; `meterState`, `meterSentence`). It counts
  a PDF page at 4,500 tokens (`PDF_PAGE_TOKENS`) against a fixed 200,000
  (`REFERENCE_TOKEN_LIMIT`, DG1, 2026-10-16: "under the 232,275-token deck
  that worked"), so a 110-page PDF reads about 495,000, 248%; any PDF of 45
  pages or more is past the limit by itself; and past it the sentence gives
  no percentage. An upload goes whole to the AI's file store and travels by
  its id: nothing in WILSON trims, samples or refuses it (`buildSourceParts`,
  `ai-files`, `ai-proxy`). The log holds eight large D.O.G. requests in 45
  days, 230,850 to 247,693 input tokens each, all completed on
  `claude-sonnet-5`, the latest two on 2026-11-02 (235,175 and 233,533):
  about 2,100 tokens a page if they were her 110-page script, under half the
  meter's guess, and each above its ceiling. wilson-dev holds none. So the
  guess for a text page is about double the measured cost, and the ceiling
  sits below what has worked every time. No model's input limit is recorded
  in the repo. Fix shape, smallest first: say in the sentence that it is a
  cautious estimate, and show the percentage past 100; count a PDF page at a
  measured figure; record the model's input limit in the model registry from
  the provider's documentation and measure against that; show a run's real
  `input_tokens` after it. Owner: DG7.
- **~~MTR-02 · An upload's row never shows the size warning a chosen file's
  row shows, and the page cap that warning names has no source.~~ CLOSED by DG7
  (`3dfe6831`, `5606e628`): the provider's PDF page gives 600 a request, 100 under
  a 1M window (`pdfPageLimit`, by the model); an upload's tile shows the warning, a
  video's excepted (too large to place is a stored file's rule).** MEASURED
  (read): `sizeWarning` is called for a chosen file's row and in the Add
  references window, never for an upload's row, so an uploaded 110-page PDF
  shows no "110 pages: the AI may refuse a PDF over 100" (the design's item
  18 puts the AI's per-file caps on each file's row). The 100
  (`PDF_PAGE_LIMIT`, "the provider's per-request page cap") has no cited
  source in the code or the design, and the requests above went through.
  Fix shape: check the cap against the provider's documentation, cite it or
  remove it, then show the warning on both kinds of row. Owner: with MTR-01.
- **~~MTR-03 · The meter counts the page request for a full deck, which does
  not send it, and leaves out the full deck's fixed system prompt.~~ CLOSED by DG7
  (`3dfe6831`): `modeTokens`, each mode's system prompt and fixed words, the page
  request only for a single page.**
  MEASURED (read): `baseTokens` adds `pagePrompt` whatever the mode, and
  `generateFullDeck` never sends it; `fullDeckSystemPrompt`, the prompt's
  template and the file-roles block are not counted. Small beside a PDF's
  estimate. Fix shape: count what the chosen mode sends. Owner: with MTR-01.

## DG7 (2026-11-05; D.O.G.'s card 1 and the reading meter) — left open

What DG7's reviews met outside its list, or left by its list's own words; each
with its measurement, none fixed (plan §5, rule 7). Walkthrough 94 names them.

- **DG7-01 · The bar's PDF page can run low on dense or picture-heavy PDFs.**
  READ, with arithmetic (the provider's PDF and vision pages, 2026-11-05): 1,500 to
  3,000 text tokens a page, plus the page as a picture, up to 4,784 tokens on the
  newest models: up to 7,784 a page against the bar's 3,000 (text PDFs measured about
  2,100 all in). A 222-page PDF at 4,500 a page costs about 999,000 and reads 68
  percent; at the ceiling 130 pages pass 1,000,000 and read about 40. Input past the
  window is a 400 from the provider. The number can still read low, and by her ruling of
  2026-11-06 (*"sorry dont say that its an estimate"*, DG8) the bar does not say it is an estimate: recorded, not fixed.
  Fix shape: the provider's token counting for a
  real number, or the bytes per page as a density guess. Owner: any D.O.G. session
  the controller names.
- **DG7-02 · The page cap counts the whole request; a tile's warning speaks for its
  own file.** READ: the provider's limit is 600 pages or images a request. Two
  400-page PDFs warn nowhere, and the request can be refused. Fix shape: sum the
  listed pages and pictures, and say it beside the meter. Owner: as DG7-01.
- **DG7-03 · `PDF_BYTE_LIMIT`'s 32 MB has no current source, nor the picture cap's
  10 MB this road.** MEASURED: a 40 MB PDF's tile reads *40 MB: the AI may refuse a PDF
  over 32 MB*, on an upload's too since MTR-02; its comment cites the provider's PDF
  page, which gives 128 MB for a whole request on the first-party API, and D.O.G. sends
  a PDF through the file store. `IMAGE_BYTE_LIMIT` compares raw bytes where the vision
  page's 10 MB is base64 (an 8 MB picture, 10.7 encoded, stays silent), and pictures go
  through the file store too. Fix shape: check both against `ai-files`' own path, then
  correct or remove. Owner: as DG7-01.
- **DG7-04 · Text counts 4 characters a token; the provider's newer ratio is 2.5.**
  MEASURED: a 3,000,000-character upload reads 77 percent with no warning (754,711),
  about 1,200,000 by the documented 2.5M characters per 1M tokens on the current
  tokenizer, past the window. With the limit at 200,000 this could not show; the
  false all-clear is about 2.5M to 3.9M characters. Fix shape: `textTokens` by the
  model's tokenizer. Owner: as DG7-01.
- **DG7-05 · In Single page the bar measures against the full deck's model.** The
  brief's item 5 (a) as written. MEASURED: with `dog.pageOutline` on Haiku 4.5, Single
  page and a 110-page PDF read 34 percent of 983,616 with no warning on its tile; that
  call has 200,000 and a 100-page cap, and reserves 4,096. Fix shape: `deckModel` and
  the reserve follow the mode. Owner: as DG7-01.
- **DG7-06 · A deck at the very top of the limit can stop short and say nothing.**
  READ: `FULL_DECK_ANSWER_TOKENS` covers one call; up to three continuations each add
  up to 16,384, and `model_context_window_exceeded` appears nowhere in `src/`, so the
  loop's other branch ends and a short deck passes as complete. Reachable from about
  95 percent (the loop makes four calls: 1,000,000 less 4 x 16,384). READ: input truly
  past the window is a 400, and the screen says only *Error generating full deck
  outline. Please try again.* Fix shape: treat that stop as the truncation it is, and
  say both. Owner: as DG7-01.
- **DG7-07 · Card 1 is taller than before where its two columns stack.** MEASURED:
  on windows under 1,148px (Electron's minimum is 1,024), or sooner with the pages
  column widened (at 1280 with it at 480 the card is 774 and they stack, 547.5 with
  nothing chosen), with little listed: +19.6 with nothing chosen, +27.6 with a project,
  +35.6 with a project and one upload, +23.6 with 20 uploads; with six references and
  two uploads 67px shorter. The new title and its 8px gap are the cost: 27.6. With the
  columns side by side every state measured is shorter. Settled 2026-11-06: asked
  Q1, she kept the title (*"Keep The deck reads (Recommended)"*), so the extra
  height where the columns stack stays. Nothing to do.
- **DG7-08 · Small things seen, older or taste, recorded.** READ, not measured:
  Preview's `disabled={gone}` should drop focus to `<body>` if a list lands while it
  holds focus, as Chromium did for the Core box (DG4). MEASURED: the kit's IconButton
  describes itself with its own name (*Preview X* twice). At 326 pages the bar says
  *About 100%* and is not past; at 327 *Past … (about 100%)*; both true by
  rounding. Past the limit the header drops *N PDFs not counted*, so its percent is a
  floor; `previewSubtitle` says *about N tokens*, as the hover now does. After a model is
  changed the bar follows at its next render. READ: `coreLine`'s comment still says
  the dropdown is *in the project column beside it*. MEASURED by DG7's round 2: a
  double click on Undo lands its second click on Add references, which moves up under
  the pointer when the notice goes, and opens the window (no notice before DG7 sat
  over Add references' new place). An uploaded PDF whose pages cannot be told says *1
  PDF not counted until read*, though its body is read and it is never counted, and
  its tile says nothing. A chosen video past 100 MB says both *placed only, not read*
  and *too large to place in a slide*. A reference and an upload of one name both read
  *Remove X* (Remove's name is kept by the brief; the hidden word is the tile's). An
  upload's size reads *(103424.0 KB)* where MB would serve. What a source pin cannot
  see: a rule by tag (`li { float: left }`), another sheet.

## DG7, the controller's second look (2026-11-05) — recorded

Four read-only reviewers on Opus 5.5 read the merged change (`d87cc733`): the
meter, the keyboard, the layout, the documents. No defect in the product. The
false lines they found in RELEASE_TESTING §E, walkthrough 94, the handbook's
§13.1 and the design's §18 were corrected by the controller in the commit that
adds this section, each after reading the code. What is left, none fixed:

- **DG7-09 · The references-warning line's × leaves focus on the page.** READ,
  not measured; older than DG7. The amber *Not sent: …* line above card 1
  (`DeckOutlineGenerator.jsx`, `refsWarning`) is dismissed by an icon button
  that removes its own line and hands focus to nothing, the pattern
  `focusAfterRemove` guards against inside card 1 (DG2 to DG4). While the
  outline is still empty (the line shows after a generation, so: after one
  that failed) and step 2 has its words, the next Enter can start a deck. Fix
  shape: hand focus to Add references, as the notice's buttons do. Owner: any
  D.O.G. session the controller names.
- **DG7-10 · A model with no recorded limit keeps 200,000 whole.** READ:
  `readingLimit` takes the answer's 16,384 from a recorded limit and nothing
  from the fallback, so a 200,000 model the registry names reads 183,616 and
  one it does not name reads 200,000. It needs a company or a person to choose
  such a model for the full deck; the default (Sonnet 5) is not touched. Fix
  shape: take the reserve from the fallback too. Owner: as DG7-01.
- **DG7-11 · Two tests that look as if they can fail and cannot.** READ:
  `ReferencesCard.test.jsx`'s *never the page* check presses each Remove with
  fakes that never draw again, so nothing leaves the page and its
  `not.toBe(document.body)` always passes (its other two checks can fail); no
  full-render test presses a reference's ×, Remove all references, Undo or
  Dismiss with real state (the uploads' paths are covered). `dogCss.test.js`'s
  layout census (`PARTS`) leaves out nine parts that have rules: a tile's icon,
  size, warning and gone words, the sub line, the Core mark, the upload error,
  the upload hint and the notice's base class, so a width or a no-wrap on one
  of them passes every pin. Nothing is wrong today. Owner: as DG7-09.
- **DG7-12 · Small things read, recorded.** The notice's `role="status"`
  element mounts together with its words, so a screen reader may not announce
  it, and the same words a second time change nothing in the page and are not
  announced (older than DG7). Wrapped onto a new line, Undo or Dismiss keeps
  its 8px left margin (from the CSS, not drawn). `referenceModel.js`'s comment
  calls her remark verbatim and drops its first word, and its file-roles
  comment says about 95 tokens where the strings come to 105. Six classes in
  `dog.css` match no markup (`.dog-roles`, `.dog-roles-label`,
  `.dog-role-name`, `.dog-role-chip`, `.dog-role-source`, `.dog-chevron`;
  older than DG7). The session row's *40 to 227px shorter* takes its lower
  bound from a state the walkthrough's table does not show: 20 uploads, 816 to
  775.2, measured by DG7's second review round and not measured again.

## DG8 (2026-11-06; the limit bar's words) — recorded

- **DG8-01 · What DG8's check does not walk, and two small things read.** MEASURED by
  DG8's round 1: its check renders the bar and the header, not the Add references
  window's own footer words or the contract line, so the word planted in either (a
  footer `title`, a contract-line `title`) leaves `ReferencesCard.test.jsx` green. Neither
  holds the word today (walked in Chromium, with all 8 rail panes and all 14 Help pages; that
  walk's output was not saved, and a source search by the controller's second look agrees);
  a preview's body in the fixtures shows only an error, so its words are clean by a
  source search only. The Rate Card's hidden text *for estimating* is in the page's DOM on
  `/dog`, out of the accessibility tree and not D.O.G.'s. READ: older comments still
  hold a first name, in a public repository: `referenceModel.js` 2 lines, `ReferencesCard.jsx` 7,
  `ReferencesCard.test.jsx` 5, `enterKey.render.test.jsx` 11; DG8 added none. Owner: any
  D.O.G. session the controller names.

## MO1 (2026-11-07, `docs/design/MOTH_DESIGN.md` §1.14) — left open

- **MO1-01 · A listener who joined a project's channel before being demoted or
  deactivated goes on hearing it until their token next refreshes or runs out.**
  PRE-EXISTING. MEASURED on 2026-11-07 with a real socket and committed writes, on a
  throwaway stack at the CLI's Realtime v2.140.3 (runs 42340511711 and 42340999728): a
  deactivated member and a demoted admin each went on hearing every write, 30 seconds
  on. A new join by a deactivated member is refused at once. A refreshed token closes
  the channel, for the demoted admin once that token says so, and a token that runs out closes it,
  so it is bounded by the token's life, 3,600 s. A control with nothing taken away kept
  its channel through a refresh. A seat does not come into it: a private project is its creator's
  and admins' only, and 0109's epoch closes a privacy flip. Not measured on wilson-dev: its
  Realtime's version may differ, and signing in there needs a password this was not given. Fix
  shape: end a person's channels when they are deactivated or demoted, or accept the hour.
- **MO1-02 · An admin reading a personal space through raw REST leaves no
  record.** INFERRED from what RLS can do: WIL-4114 records every open in WILSON's
  Files page, and a SELECT cannot be logged. In the handbook's deviations table.
- **MO1-03 · A stale admin desktop build lists other people's personal spaces in
  R.A.B.B.I.T.** INFERRED: no minimum-version mechanism exists. Read-only and no
  wider than Files: writes are owner-only at the database and local bodies are
  refused. It ends when the build updates.
- **MO1-04 · A purged moved copy can fall back to its origin's readers.** INFERRED:
  only if both the queue's enqueue and the purge's certificate fail on one purge,
  until the next orphan scan removes the object. Two independent arms, pinned apart.
- **MO1-05 · Moth tells a project member that a file is a receipt, by hiding it.**
  INFERRED: its own project's expense names it, and they can already open it. No
  indicator or count. Beside 0076's TRAP 1.
- **MO1-06 · Office-server leftovers.** INFERRED. (a) Bin items of a project purged
  whole are never walked again and stay on the server; the certificate says
  'company server bin'. (b) A rename made on the server and split across a walk's
  calls gets a new id. (c) Pre-C4 receipts in a share's `<slug>_FILES` carry no flag
  (handbook §12.9 residual 3). (d) A move whose laptop never comes back is called off
  from Moth's trash after a day, or closed by the purge past the retention, which
  leaves its row reading not found.
- **MO1-07 · A desktop project nobody opens keeps its trash past 30 days.** MEASURED
  by reading: purge-expired runs when a project opens in R.A.B.B.I.T. and when Moth's
  trash opens, and at no other time.
- **MO1-08 · `ingestion_chunks`' select policy hops through the run's project only.**
  MEASURED while designing moves. A file with extracted text refuses a move, so moves
  add no leak. The gap in the policy stands.
- **MO1-09 · A deleted asset's own `.trash` bodies are in no trash view on the
  desktop.** MEASURED by reading: managed files of a deleted asset are left out of the
  local restore.
- **MO1-10 · Script on the page can still steer the desktop's file channels.** The
  copy itself is fenced (`electron/copyFileFence.cjs`: a picked file or a project body,
  into the named project's own folder). What is left: (a) a copy may still choose any
  path inside that folder and overwrite a file there; (b) `rabbit:get-file-stats`,
  `rabbit:open-in-explorer` and the two thumbnail channels take any path from the page.
  MEASURED by reading. (c) INFERRED: `rabbit:write-files-config` stores any
  `defaultRootDir` and `rabbit:set-workspace-root` any absolute folder but a bare root,
  and those roots are what the fence contains against. Settled by a run: script moves
  the root, makes a project under it and copies a picked file in.
- **MO1-11 · `op` then `purge` from script on the page can remove any file a member
  could rename on the office server.** MEASURED by reading (round 2). Neither route asks
  the database for an operation. Closing it needs main to ask.
- **MO1-12 · A link the server resolves itself is invisible to the desktop's checks.**
  INFERRED (round 2; DFS, round 1): a Samba link to a money folder reads as an ordinary
  folder, and DFS's real paths may refuse a real child. Settled only on a real server
  (`docs/RELEASE_TESTING.md` §T).
- **MO1-13 · A move or a trash on a desktop project whose folder is on a share can
  freeze the window for the OS timeout.** MEASURED by reading (round 2): synchronous
  calls, as every desktop route in `main.cjs` makes. 42 s measured for such a call.
- **MO1-14 · Rows under a folder that reads as a frame series cannot be called missing,
  and new frames there are not listed,** until the folder stops reading as a series.
  MEASURED by suite 122's shape; the walk does not go into a series. Nothing is lost.
  An adopt's old picture also stays when the purge closes its operation, until the
  bucket's own sweep.
- **MO1-15 · A money or Legal file deleted on the desktop has only the toast's Undo,**
  then goes at 30 days, with no screen listing it. MEASURED by reading (round 2). It used
  to be unlinked at once.

**Recorded with them (R15).** Index liveness of private projects in creators' and admins'
other windows rests on the join refetch, AUDIENCE and the project topic: accepted. Re-run
order: 0107 after any replay of 0013, 0020, 0040, 0041, 0044, 0061 or 0082; 0108 after
0037, 0061 or 0092; 0109 after 0016, 0018, 0098 or 0101. 0092 refuses after 0108, and 0098
refuses after 0109. The definer re-measure: every SECURITY DEFINER body calling a write
gate also calls `passes_project_privacy` or reads under a hop.

## MO2a (2026-11-04, the graph engine on `po/moth2a-engine`, merged by MO2 on 2026-11-07) — left open

Copied from the engine's hand-off (`docs/sessions/handoffs/po-moth2a-2026-11-02.md`, its OTHER list), as it asked.
Each was upheld by a checker told to refute it: MEASURED where the line gives a run or a count, INFERRED
where it reads the code. Line numbers are of `src/tools/moth_v0.1.0/engine/` at `b72c77ce`. MO2 closes
what part A needs as it wires the page, and removes each closed entry here. **MO2 closed and removed R1-17, R1-18, R1-4, 5, 22, 52, R1-11, 23, R1-8, 24, R1-25, R1-13, R1-6, R1-3, R1-7, R1-32, R1-33, R1-34** (the session log's MO2 row).

Each stood against a checker told to refute it. R1 is round 1, R2 round 2 on the label fix, RL round 2 on the line fix.

**A. A person will see or save it once the page is wired: decide these first.**

- **R1-2** `frame.js:156` Clustering triggered by lines does not reduce them: the growth tests dots only, so in light mode the 601st line removes every label and about 676 lines still draw.
- **R1-9** `governor.js:75` The back-off also gates the drop to light: a machine failing in full but fine in light sits failing for stretches of 5.9, 11.9, 21.7 … up to 301 s (fake clock). The manual override is the way out.
- **R1-10** `renderer.js:366` The model's summed line weight never reaches the frame; cluster lines count edges and nothing draws either.
- **RL-4** `renderer.js:197` Same-style lines now blend line by line, so fans brighten where many meet, most at a tag dot (a bright star at 138 lines on one fixture tag, in screenshots). Scale 1 already drew so; scale 1.5 used to show a flat haze. Judge it when the page is live.

**B. Robustness of the worker and the frame.**

- **R1-19** `layoutClient.js:63` Watchdog gaps: a refused pin or a `settled` crossing a pin disarms it during a run, and pins keep re-arming it.
- **R1-20** `layoutWorkerCore.js:134` A coordinate at or above about 9e307 in a saved place or a pin: one tick allocates without limit (over a gigabyte in 5 s) until the watchdog ends it, at every opening of that view. The engine cannot write such a value; validate saved places on read.
- **R1-21** `layoutWorkerCore.js:39` Bad radii or options, or coordinates past float32, come back as NaN or Infinity under a normal `settled`; marked placed, and the next save silently drops them.
- **R1-26** `layoutClient.js:94` `run` throws instead of reporting; a failed post leaves it busy, and a spurious timeout later kills a healthy worker.
- **R1-27** `layoutWorkerCore.js:137` After a capped run, unpinning a dot never pinned sets the whole graph moving, saved dots included.
- **R1-28** `layoutClient.js:74` An error event from a replaced worker kills the current one (a narrow window).
- **R1-12** `frame.js:196` FAR culling ignores the radius: a big cluster at the edge pops in up to 12 px late.
- **R1-15** `navigation.js:46` A two-finger pan at a zoom limit sits one small step inside it (8 to 7.8); no cumulative drift.

**C. Hygiene.**

- **R1-30, 43** `model.js:151` "Never storage_path" has no failing control (the code is right; a one-line check on the fixture closes it).
- **R1-31** `model.js:271` The header says only drawn columns are copied; `mime`, `sizeBytes`, `fileKind`, `updatedAt`, `tags` and `edge.label` have no reader yet.

**D. Test gaps: the code is right today; a slip would ship green.**

- **R1-35** `renderer.js:170` The governor's mode reaching the draw list (cut it, and the frame draws full while reporting light).
- **R1-38** `layoutWorkerCore.js:144` `stop` at either end of the protocol.
- **R1-41** `model.js:290` A view's `edgeKinds`, and hiding kinds other than files.
- **R1-42** `model.js:67` Tag case folding, duplicate rows, the deep-folder limit.
- **R1-44** `frame.js:225` FAR details: off-screen cluster lines, negative coordinates, pair merging, lone dots, repeated growth, the radius cap.
- **R1-45** `glow.js:65,82` The size in fortieths, the flicker's fade, no white core on a first flicker.
- **R1-46** `renderer.js:492` Calm mode switched on during a tween, and off again.
- **R1-47** `renderer.js:149` Which frames feed the governor (settling out; zoom, pinch and fly in).
- **R1-48** `governor.js:71` Hysteresis edges: a bad window resetting the good run, the dwell cap, measuring while overridden.
- **R1-49** `layoutWorkerCore.js:59` Later runs' bounds, a refused init during a run, a throwing init, hold release, the post throttle, the saved-view entry.
- **R1-50** `layoutClient.js:63` The watchdog's re-arm on a tick (dropping it would kill every layout over 5 s), the arm on a restart, worker reuse.
- **R1-51** `renderer.js:485` A repeated hover or selection asking a frame.
- **R2-1** `renderer.test.js` The label test has no sample far right of the centre, so dropping the max clamp passes and every label right of the light gets the full shadow.
- **R2-2** `renderer.test.js` Its label is exactly 32 characters, so judging the raw length instead of the drawn text passes.
- **RL-1** `renderer.test.js` "In the style of its kind" checks only that a colour is in the palette, not that it is the line's kind's.
- **RL-2** `renderer.test.js:48` The line loops' mist branch: no renderer test has a dim dot, and the fake context records no `globalAlpha`.
- **RL-3** `renderer.test.js` The test named "at MID and NEAR" runs at NEAR only (the loop has no branch on level).

## MO2 (2026-11-07, M.O.T.H. Session 2 on `po/moth2-graph`) — left open

- **MO2-01 Her saved local test project is not measured.** PLAN_MOTH §5 Session 2 asks for it beside the debug sample;
  it is in her own app data, which the session's rules say is never read. Asked at the session's close.
- **MO2-02 The 10,000 replay's p95 was 32.9 ms once in three runs** (17.3 and 17.4 the others), with drawing under 3 ms.
  The long frames are elsewhere, most likely the layout's ticks on the main thread while it settles. Not a target (the
  plan's is 1,000 dots, met), not measured further.
- **MO2-04 A project kept only on this computer keeps no saved view, place or setting**: the signed-out desktop has no
  table for them, and the page says they last the visit.
- **MO2-05 The three graph reads are not timed on a large real project.** Dev's projects are small. The runbook's 0122
  row asks for it on staging and production first.
- **MO2-06 Five limits are pinned only by their functions' md5, not by rows**: the 20,001st item, the 60,001st line, a
  1,001-file page, two saves at once against the 200-view cap, the 20,001st place.
- **MO2-07 The desktop app was not driven this session**: the measurements and pictures are from Chrome, headless, on
  the dev fixtures.
- **MO2-08 Looking back reads at most 20,000 rows of the record** (20 pages); past that the slider says only part of
  the period could be read.
- **MO2-13 One hidden target refuses a whole write of places** (a file moved where the writer cannot follow, between
  the read and the write). The page now sends only the dots moved, of the live catalogue, and says so in words; the
  server could leave a hidden target out instead of refusing, without telling anything. A first save of more than
  1,000 dots goes in chunks, and a refused chunk leaves the earlier ones written.
- **MO2-14 A jump whose project takes a while to open still switches the tab** if the person moved to another
  project meanwhile; the item itself is not opened there (its request names the project). Needs a check after the
  next render, not before.
- **MO2-15 A view built from scratch is not reopened on the next visit**: `moth_prefs` keeps only a quick start or a
  saved view as the last view. Keeping a config needs a key `set_moth_prefs` accepts.
- **MO2-16 Touch mode changes gaps and padding at once, and inputs, ticks and icons do not grow.** Her ruling asks it to
  animate; the buttons do.
- **MO2-17 An asset has no card of its own, and a phase opens R.A.B.B.I.T.'s Timeline without selecting the phase.**
  Session 3's items work.
- **MO2-19 "Who last changed it" counts an office-server re-check as a change** (the walker's `updated_by`), and an
  update with no person names the uploader. Needs the catalogue's writers to keep `updated_by`, or an editor from
  `file_events`.
- **MO2-20 The suites do not run a cut answer (20,001 items, 60,001 lines), every same-project arm of the file facts,
  the places read policy's view term, the S6 scan's escape hatch, or a deactivated and reactivated person's settings;
  0122's pre-flight does not list every column its plpgsql reads use.** Each is right in the code today (whole-session
  round 2).
- **MO2-21 The page, small:** Undo of a deleted shared view brings back only the places its deleter could see, under a
  new id; a refresh that fails after a move drops that project's last good read; the colour picker writes a setting at
  every step (the newest answer wins); a bloom shown stays while the camera pans; the canvas does not follow a monitor
  with another scaling; the Settings drawer has no close button and does not take the focus; the tags list is not
  grouped by kind; no test holds the HUD's contrast or the development-only switches.
- **MO2-22 The dev fixtures accept settings the server refuses and count a view's name in UTF-16 units**; on the
  signed-out desktop no folder-to-item lines are drawn.
- **MO2-23 R.A.B.B.I.T.'s Files can show the last project's files for a moment during a project switch**, older than
  Moth, met on the jump path.

## MO3 (2026-11-08, M.O.T.H. Session 3 on `po/moth3-tags`) — left open

- **MO3-01 An approval races a rename, a retire or a delete of the tags it folds** (0126,
  `moth_tag_nomination_decide` and `rabbit_private.moth_tag_fold`). The fold reads the personal tags it folds without
  locking them, so a rename, retire or type change made at that moment is folded anyway; an owner deleting or retiring
  a tag while an admin approves its nomination can deadlock, and the one who loses reads Postgres's own words; rename
  and retire take no catalogue lock, so an approval can fold into a company tag being renamed or retired at that
  moment. INFERRED from the code (whole-session round 1); settle with two sessions on dev, one approving while the
  other renames, retires or deletes.
- **MO3-02 In a shared note two people edit, a typed link can fail to be made.** Only the person who picked it holds
  its key (`moth_note_mentions_sync` binds the writer's own reservations, 0127), and their key list is refused as stale
  when the other person's save lands first; the client sends it once more with a fresh save, which can lose again to a
  third. INFERRED; settle with two people typing in one shared note on dev.
- **MO3-03 Two ways a file locks leave the record of its taggings and links stored, unblanked**: a file that becomes
  money through a receipt (an expense row runs no capture on the file), and a file under a folder that turns Legal.
  Every other way a file locks blanks those rows. No one reads them (the reader asks the file's own gate), but they
  stay stored, a link's words included, until the file is written or purged; a receipt-only file that is then
  hard-deleted keeps them for good (its cascade writes before the file's own capture). INFERRED; settle with a probe
  that makes a tagged file money by a receipt.
- **MO3-04 0127 makes a typed link from a money or a Legal file's description** (`rabbit_private.moth_mentions_apply`
  on `files`). It is never shown (the gate refuses that end) and never recorded (0129), but the row is made; the rule
  at the source is to make none. INFERRED.
- **MO3-05 Two reservations made at the same moment can pass the 500-a-day cap by one** (`moth_mention_reserve`
  counts, then inserts, under no lock). INFERRED.
- **MO3-06 Looking back to before a note or a thing went to the trash brings back its dot but not its links or
  typed-tag lines**: the live read leaves out a link or a tagging whose end is in the trash, and no record row says it
  was there. INFERRED (round B on 0128 and 0129); settle by trashing a linked, tagged note on dev and looking back.
- **MO3-07 Looking back to before a phase or a task was set aside does not bring it back**: the record keeps no
  `set_aside_at` (0119's projection), and its reader asks today's gate, which refuses a set-aside row since 0124.
  INFERRED; settle by setting a phase aside on dev and looking back.
- **MO3-08 A note's or a typed tag's dot is laid out afresh on each visit**: a saved view keeps only the places of dots
  in a project (`state/mothViews.js`, `keeps`), so one moved by hand goes back, though `moth_put_positions` takes them
  since 0126. INFERRED.
- **MO3-09 The Scenes and Shots tables' cells and the Timeline's asset editor edit a description holding a typed link
  as its code** (`[[words|m:key]]`; the windows' boxes do too while editing). At rest every place shows the words. A
  person editing there can cut the token, and its link goes at the next save. INFERRED.
- **MO3-10 `moth_notes` stops at 5,000 inside the function, before its gate**, so a cut that leaves fewer than 5,000
  after the gate is not seen; the client marks only a full 5,000 as cut. And the client's read, a page of 1,000 at a
  time by id, runs the whole function again for each page (up to six for 5,000 notes). An exact sign and one run need
  the function to take a cursor and answer `{notes, truncated}`, as `moth_relationships_read` does. INFERRED; the cost
  is not timed (dev's companies are small).
- **MO3-11 Pinned by no probe, each right in the code today**: the record of an approval's fold (suite 133 has a
  merge's moves and no approval's); the record's pinned columns of a typed tag (`type_id`, `tier`, `canonical_id`,
  `retired_at`; suite 121's pinned-column probe names only the older tables); a gone peer project's branch in the
  capture. INFERRED (the second look on 0128 and 0129).
- **MO3-12 A link picked in a note can be left out without a word**: when the words before the caret change while its
  key is being reserved (a co-editor's change merged into a shared note, say), the editor gives up the splice rather
  than cut the wrong words, and says nothing; the tag of a `#` pick is still put on. INFERRED (whole-session round 2);
  settle with two people in one shared note, one typing above the other's pick.

## MO4 (2026-11-08, M.O.T.H. Session 4 on `po/moth4-boards`, merged 2026-11-12) — left open

From the review round of 0130 to 0133 (12 reviewers, Opus 5.5; each finding read against the code). The rest were
fixed in `e3730b7c`.

- **MO4-01 · A project writer can overwrite a sticky's stored object at its key, past the turn.** MEASURED by
  reading: 0115's update arm on `rabbit-files` lets a writer of the claiming file's project UPDATE the object (its own
  comment says so); 0133's turn fences the files row's key, not the bytes at it. Fix shape: refuse a client's UPDATE
  of an object a sticky's file claims, or make claimed bodies immutable to clients.
- **MO4-02 · A move between projects can put back a sticky's older words.** MEASURED by reading: when a move needs a
  copy, `fn_moth_apply_moves`' commit takes the copy as the key and retires whatever key is there then, without
  comparing it to the plan's source or asking for the turn; a publish between the plan and the commit is undone.
  Fix shape: refuse a file with a live turn, and compare the key to the plan's at commit.
- **MO4-03 · A save racing a removal of a connector's end fails whole with the key's own words** (23503), not in
  plain words. INFERRED by reading `board_put_elements`.
- **MO4-04 · Lock order and stale reads.** INFERRED: folder trash takes files then boards, board saves and stickies
  the other way; `moth_move_folders` and R.A.B.B.I.T.'s entity-folder rename (supabaseAdapter.js, about line 1430)
  can each write a path from a read the other has made stale. No deadlock or wrong path seen in a run.
- **MO4-05 · A move's plan can say a path the move itself will not take** when another folder takes the name between
  the two. INFERRED.
- **MO4-06 · Message costs, small:** any role change, a promotion included, renames every board of the company in the
  admin's transaction; element messages carry no board revision and are cut by count, not bytes; a pen's 4 KB cap on
  the wire measures the stored (compressed) size. INFERRED by reading 0132.
- **MO4-07 · A save running while its project is made private can land on the old channel name after AUDIENCE went
  out.** INFERRED: the name is read at send time inside the save's transaction.
- **MO4-08 · `moth_trash_folders` judges every file below before it applies its 10,000 cap, under the company's
  folder lock; `moth_trashed_folders` cuts a page by `deleted_at` and can drop entries that share one.** INFERRED.
- **MO4-09 · A folder can go to the trash while an office-server file in it has a trash pending**, and that trash's
  failure revert then meets a folder in the trash. INFERRED.
- **MO4-10 · A sticky whose file left its board's folder stays a sticky element on the board** (shown, its words
  saved where the file now is, `board_sticky_publish` refusing in words). MEASURED by suite 138.
- **MO4-11 · Three plants are green by design**, each held by a clause no single-transaction probe can trip: the
  writers' second permission check under the board's lock (two sessions), the 64 MB board cap (64 MB of rows), and
  the restore's parent check (rows coming back child first). Named in the plants' record.
- **MO4-12 · Probes still owed:** a sticky published to a money or Legal key; which boards each person sees, not only
  how many (suite 134's counts).
- **MO4-13 · A board's folder can come to sit in a thing's own folder, and deleting that thing deletes the board
  outright, with no trash.** INFERRED by reading (round 2, check of finding 8): no trigger watches a folder's `kind`
  or its entity keys, so a project writer's plain UPDATE can make a board's folder (or one above it) a shot's own
  folder; and `board_create` and `moth_move_folders` take different locks, so a move into an entity folder racing a
  new board on the same folder can leave the board there. The entity key's cascade then passes `fn_folders_board_guard`
  (it lets every cascade through). Fix shape: refuse a cascaded delete that reaches a board's folder unless the project
  itself is going; refuse a client's change of `kind` or the entity keys with a board at or below; re-check the chain
  under the parent's row lock in `board_create`.
- **MO4-14 · A board's existence is not in `moth_history`, `edit_history` or the takeout.** INFERRED by reading (round
  2): looking back shows a board's folder as a plain folder. 0130's header names 0134 for it, and 0134 is the projects
  hop; no file does it yet. And no file bumps a board's `audience_gen` when its folder changes project (0132's header
  names 0134 for that too); nothing allows that change today (0111 refuses it, `moth_move_folders` refuses a move
  between projects). Fix shape: a later file records a board's making and its trash in the three, and a cross-project
  move of a board, when one is allowed, renames its channels.
- **MO4-15 · A folder move goes through with an office-server file in the trash below it, and that file's restore
  then puts it back at the old place.** INFERRED by reading (round 2, check of finding 21): the move's check counts
  only live files; `network_share_restore` takes the old locator, so the file lands in the old directory while its
  folder's new uploads go to the new one, and later walks mis-file. A pending office-server move out of the folder
  reverts the same way. Fix shape: let a trashed office-server file below refuse the move too, and refuse while a
  pending office-server operation names a file in the subtree; a suite 136 probe (trash cut.mov, then move nas).
- **MO4-16 · Suite 138's `heard`, `want` and `leaks` skip suite 137's partition probe.** INFERRED by reading (round
  2, check of finding 42): on a stack with the realtime schema but no partition for today, E fails rather than reading
  as a no-partition stack, and the leak check runs on no rows. CI excludes realtime, so CI never sees it. Fix shape:
  use 137's `rt_env()` in all three.
- **MO4-17 · A project with no top folder is refused a board, in the words "You cannot make a board here. The folder
  may have moved, or you may not change it."** MEASURED on wilson-dev: four of the probe workspace's six projects
  have no top folder (made before folders, or seeded). The words name the wrong reason. Fix shape: make the top folder
  when a board is asked for, or say the true reason. Count such projects on staging and production first.
- **MO4-18 · A person's own sticky did not open for writing on a double press, once.** MEASURED once: the first try
  of the board spec between two people on a throwaway stack (run 43157769791) waited 20 s for the words box after a
  double press on a sticky that person had just written; the retry, the next run and every run on wilson-dev
  passed. Not reproduced, not explained. Where to look: `beginEdit` returns without a word when the earlier words
  box is still closing, and when the sticky has no file yet in the store.
- **MO4-19 · The board spec can leave an empty board behind on wilson-dev.** MEASURED 2026-11-12: two CI runs
  pushed two minutes apart ran the sign-in and board specs on wilson-dev at once; `board_create` answered so late
  that the app's connection watchdog had cancelled the request, the spec read that as a refusal, and the board was
  made after it had given up (one empty board, "e2e board 2026-11-12 05:13:13", is live in the probe workspace).
  Fix shape: the spec puts any live "e2e board" of an earlier run in the trash as it starts; and pushes are not
  made within a few minutes of each other.
- **MO4-20 · 0132's header says a board message carries at most 50 elements; the function sends 25** (and 200
  removed ids). MEASURED by reading `0132_board_channels.sql` (line 21 against the two chunk sizes). The code is the
  smaller and safer of the two; the header is wrong. Fix shape: correct the comment in the next file that restates
  the function (an applied migration is not edited).
- **MO4-21 · A board has no copy, no duplicate and no right-click menu, so a frame cannot be copied with what it
  holds.** MEASURED by reading: `BoardCanvas.jsx` takes no copy, paste or duplicate key and draws no menu on a right
  press, and the design note (s4b, the readings) leaves all three untouched. Her words asked for frames like Figma's,
  and in Figma a frame copied or duplicated takes what it holds. Fix shape: when copy and duplicate come to boards, a
  frame is copied with `heldBy` of it and the lines whose two ends are both among those, in one undo step, and the
  right-click menu offers *Frame selection* and *Remove the frame only* beside them.
- **MO4-22 · What a frame holds is worked out from positions and stored nowhere.** MEASURED by reading `frames.js`
  (`frameHolds`, `heldBy`): a thing whose bounds' middle is inside a frame and which is no larger than it belongs to
  it, so a thing that merely lies over a frame travels with it when it is dragged or nudged and goes with it on Delete,
  and there is no way to keep a thing over a frame without it belonging. A curved or elbow free line is judged by its
  stored box (its ends and bends, `connectorRecord`), not by the path drawn, so its middle can sit inside a frame the
  line seems to leave. Positions were judged enough in the design note (section B): frames then need no database
  change, and every window works out the same membership from the same positions. Storing membership would take a column on `board_elements`, a
  guard against a frame held by itself through a loop and against a frame of another board, and a rule for a thing
  that someone else drags out of a frame while this window is moving it. Fix shape: only if she asks for a thing to lie
  over a frame without belonging; until then, positions stay the one rule, the same in every window.
- **MO4-23 · While a frame is dragged, the others see only part of it move.** MEASURED by reading `BoardCanvas.jsx`:
  a drag sends at most `MAX_DRAG_SENDS` (20) positions a step, the frames first, so the others see the frame and up to
  19 of what it holds move live; the rest jump to their places when it is let go and the save arrives. Fix shape: one
  message for a frame's move (its id and the offset, which each window applies to what it holds there), or a cap that
  counts a frame's things as one.
- **MO4-24 · A background change is not an undo step and is not in the history or the takeout.** MEASURED by reading
  `boardStore.js` (its header: the background is the board's, not an element's, and not an undo step) and 0136's
  header (history and the takeout are not in it, MO4-14): Ctrl+Z does not take a background back, and looking back
  shows nothing of who changed it, though `updated_by` and `updated_at` are stamped on the board's row. Fix shape: with
  MO4-14, the later file that records a board's making and its trash also records a background's change; an undo step
  for it only if she asks.
- **MO4-25 · Delete on a frame leaves a line from a held thing to something outside, loose at that end.** MEASURED by
  reading `BoardCanvas.jsx` (`removeSelection`, `removeIds`), as built: the frame, what it holds and a line whose two
  ends both go are removed, and a line with one end outside stays, its end at the removed thing freed where it was
  drawn. The walkthrough's picture 27 shows it, and one undo brings it all back (picture 28). Fix shape: none needed if
  she keeps it; else remove such a line with the frame too, in the same undo step.
- **MO4-26 · Suite 134 has no check of the background version's own CHECK or its NOT NULL.** MEASURED by reading
  suite 134's section F (lines 257 to 332) and the planted breakages' record (plants136/NOTES.md): only 0136's
  post-conditions hold `boards_background_version_chk` and the column's NOT NULL, so plants 45 (the check dropped) and
  46 (the NOT NULL dropped) are caught only with the post-conditions kept. A later file that restated the column would
  have no suite to fail. Fix shape: two probes in section F: `UPDATE ... SET background_version = NULL` refused with
  23502, and a board inserted as the owner with `background_version = -1` refused with 23514 (the guard fires only on
  UPDATE).
- **MO4-27 · Two different people changing a background at the same moment has not been run between real
  accounts.** INFERRED by reading: the end-to-end spec's step 3c (`tests/e2e/boards.spec.ts`) runs between two windows
  of one person on wilson-dev; the ordering by version has unit tests (`boardStore.test.js`, the dev fixtures' tests)
  and suite 134's version checks, and no run between two accounts. The release test list's pair check (RELEASE_TESTING
  §W: A and B choose at nearly the same moment and both screens end on the same background) is the manual one. Fix
  shape: run §W's pair check on staging with two real accounts before boards reach people; and when the spec has a
  second seeded person, a step where each changes the background at once.
- **MO4-28 · The planted breakage 25 (0136's REVOKE narrowed to PUBLIC) stays green.** MEASURED on wilson-dev
  2026-11-12 (`pg_default_acl` read there) and by the plants' run 43173011494: a function made by the role that runs migrations
  grants anon nothing by default on this project (postgres's default privileges for functions in public name postgres,
  authenticated and service_role), so suite 134's "anon may not" check cannot fail for that breakage, and the REVOKE's
  `anon` is a second belt. On a database whose defaults differ, 0136's post-condition (anon may not execute
  `board_set_background`) is what would refuse it. Fix shape: none for 0136; read the default privileges on staging and
  production before the apply (`select defaclrole::regrole, defaclacl from pg_default_acl where defaclnamespace =
  'public'::regnamespace and defaclobjtype = 'f'`), and keep each new function's REVOKE naming anon.

From the first whole-session round (12 reviewers by lens and their checkers, Opus 5.5; MOTH_DESIGN §5.3, "The first
whole-session round"): the findings not taken into the code, the most serious first. A finding with no checker was
read by its reviewer alone, so it is INFERRED by reading. The seven taken are in MOTH_DESIGN §5.3.

- **MO4-29 · A new text's add and its words are two undo steps, so one undo leaves an empty text nobody can see.**
  MEASURED by a scratch test on the real store (add, a tick, the words, a tick, undo: one element left, its words
  empty) and by reading (round 1, checked: real, major). `placeText` adds the text and opens its words box
  (`BoardCanvas.jsx`); the store closes a step on the next microtask (`boardStore.js`, `record`); `endEdit` saves the
  words, or removes a text closed empty, later, so in a step of its own. Ctrl+Z after typing takes back only the
  words: the text stays, empty, drawn as nothing, yet selectable by a marquee or Ctrl+A, counted by snapping, fit and
  frames, saved and in every window; a second Ctrl+Z removes it. A text closed empty is an add and then a removal, so
  Ctrl+Z right after brings back an empty text instead of undoing what came before. Closing the words box by its own
  close (a discard), or losing write while typing, leaves a fresh empty text on the board with no undo at all. Fix
  shape: let the words' update or the removal join the add's step (the store's `combine` already makes add and update
  one add, and add and remove no step); remove a fresh empty text on a discard too; tests in `boardStore.test.js`
  (add, tick, joined update: one step; add, tick, joined removal: no step) and `BoardCanvas.test.jsx` (place a text,
  type, close, undo: no element).
- **MO4-30 · On a company that keeps its files in its own s3 bucket, a sticky cannot hold words.** MEASURED by
  reading (round 1, checked: real in part, minor). "New board" is offered whatever the storage (`MothPage.jsx`), and
  the sticky tool makes a sticky through the ordinary upload: an empty note file in the company's bucket
  (`createSticky`). Every save of its words is refused before anything is uploaded (`saveStickyText`, code
  `s3_sticky_off`), and 0133's `board_sticky_publish` refuses the same on the server. What the person meets: they
  type, and at the first pause (1.5 s) the words box says "A sticky's words cannot be saved on the company's own
  storage yet." with a Close button and takes no more typing; the sticky stays empty, for them and for everyone, and
  each new sticky leaves one more empty note file in the board's folder. Earlier entries here record no s3 company on
  any environment (measured 2026-09-06); no board was run on an s3 or an office-share company this session. Fix
  shape: refuse the sticky tool, or `createSticky`, on an s3 company before the upload, in the same words, with a test
  in `boardsCloud.test.js`; and save a sticky's words to a company's own bucket when its moves learn to (0120).
- **MO4-31 · Every picture, video and sticky's words on a board are fetched when it opens, and its videos are not
  stopped when it closes.** MEASURED by reading (round 1, checked: real, minor). `reconcile` builds every element,
  in view or not, and `cull` only hides; a picture or a video signs its URL and starts loading (a video with
  `preload = 'auto'`), and each sticky reads its row and its object, with no queue and no cap, so a board of 300
  stickies and 100 videos asks 600 reads and 100 preloading videos at once. `destroy()` never walks the pictures, so a
  video keeps downloading after the board closes, and a reopen signs and fetches everything again. Nothing shown is
  untrue and no rule is broken; it is a cost that grows with a board. Fix shape: in `destroy()` pause each video,
  remove its `src` and call `load()`, then clear the map; `preload = 'metadata'`; optionally fetch only what is near
  the view, or through a small queue; a unit test that a closed board's video is stopped and an off-view sticky not
  read.
- **MO4-32 · A passing database error is taken as a refusal, and the batch's changes are thrown away.** INFERRED by
  reading (round 1, not checked): `isRefusal` (`boardStore.js`) counts any code outside the network list as the
  server saying no, so a deadlock (40P01, which MO4-04's lock order allows), a serialization failure (40001), a
  statement timeout (57014) or a schema cache reload during a restart (PGRST002) is said in Postgres words, the board
  is read again, and the whole batch's changes are dropped instead of kept and tried again. Fix shape: list these
  classes with the passing ones, and a store test for each.
- **MO4-33 · A save of more than 500 that fails partway is tried again whole, and its undo steps come back as
  someone else's changes.** INFERRED by reading (round 1, two reviewers, not checked; the server's answer to a
  repeated readd not measured): the adapter saves in calls of 500 and marks the part that landed (`err.partial`),
  and nothing on the board reads it; the store sends every pending put in one round and, on an error that is not a
  refusal, queues them all again with their versions unmoved. Undo the removal of 600 things on a link that drops
  after the first call: the retry meets the first 500 at version 1, the server names them as conflicts, the board
  says someone else changed 500 of them, and they are dropped from the undo step. The drawing is right after the
  re-read; the words and the step are not. Fix shape: read `err.partial` and treat the part that landed as saved
  (its versions moved), or cap a round at 500 in the store.
- **MO4-34 · An embed of a file a reader may not see still reaches that reader's window in the board's messages.**
  INFERRED by reading (round 1, not checked): the element guard asks the file gate of the writer only, and an embed's
  file need not be in the board's project; `board_elements_select` (0134) hides the row from a reader without the
  file, but `board_announce` (0132) sends every element to every reader of the board: its place, size, order, style,
  version and `updated_by`. The client does not draw it (a new file-bearing element is read through `board_read`,
  which gives the stop-sign tile), so the file's id and name never travel; what travels is that an element is there
  and how it moves. Fix shape: leave out of a message an embed whose file is not in the board's project, so its
  readers read it through `board_read`, as they do a new element that carries a file.
- **MO4-35 · Whose pointer, presence or drag a message is, is the sender's own word.** INFERRED by reading (round 1,
  not checked): `boardLive.js` takes a cursor's or a drag's person, name and element from the payload, and a
  presence's person from its own `user_id` before the adapter's key; `boardStore.js`'s preview moves any element of
  the board. A reader who may not change the board can send drags for any element, which every window shows moving
  for two seconds a message, though nothing is saved; or track presence with another member's id and name, so "who
  is here" lists someone who is not. Fix shape: take a presence's person from the channel's own key, and a cursor's
  or a drag's person and name from that presence, not from the payload. Its worst case, found by the second round (a
  forged drag drawn in a writer's window and then saved or deleted by that window's own next drag or Delete of a
  frame), is fixed in the session's last fix commit (MOTH_DESIGN §5.3, the second whole-session round): a person's own
  gestures start from the settled board and live places out of range are dropped; the forged identity and the moving
  preview others see stay open here.
- **MO4-36 · On a Local Server every sticky save leaves the earlier words on the office computer for good.**
  INFERRED by reading (round 1, not checked): each pause in typing writes the words to a fresh key and moves the row
  to it; nothing deletes the earlier key. On Supabase, `storage-gc` removes an object no row names after 24 hours;
  nothing sweeps a Local Server's disk (`storage-gc` reads rows only, `localMedia.cjs` collects nothing). Words typed
  and then taken out of a sticky stay on that disk, and the folder grows with every save. Fix shape: after a publish
  that took, delete the earlier key on a Local Server, or sweep the keys no row names there.
- **MO4-37 · A placed file put in the trash reaches no open board.** INFERRED by reading (round 1, not checked): the
  board's messages are sent only by its elements' triggers, the saves and the sticky turns (0132), and
  `moth_trash_files` predates boards; a picture or an embed trashed in Files changes no element, so two people with
  the board open keep its name and picture, and someone writing in a sticky whose file went meets "sticky not found
  or not writable" only at the next save. The stop-sign tile shows when the board is read again. Fix shape: a
  trigger on a file's trash that sends a message to the boards holding it, which read those elements again.
- **MO4-38 · Any coded error from `board_channels` closes the board as gone, in the server's raw words.** INFERRED
  by reading (round 1, not checked; which codes a live server answers there not measured): when a channel drops,
  `boardLive.js` asks for the names again, and `isRefusal` reads a statement timeout (57014), an expired token's
  PGRST301 after a sleep or a busy pooler as a refusal, so the board closes and Moth says the server's sentence, for
  a board that is still there and still the person's. Fix shape: close only on 42501 or the board's own refusal
  codes, and treat the rest as passing (with MO4-32).
- **MO4-39 · A first join that fails says nothing, and "Could not reach the others on this board just now. Your
  changes still save." is never shown.** INFERRED by reading (round 1, not checked): `joinBoard` catches a failed
  first `board_channels` call, schedules its retries and resolves; no link event is sent, since the link was never
  up, and the panel shows those words only when `joinBoard` throws, which it never does. The panel's test mocks a
  throw the real function cannot make. While the retries keep failing, the board looks live and others' changes do
  not arrive. Fix shape: tell the panel of a first join that failed (an event, or a resolve that says so), and test it
  against the real `joinBoard`.
- **MO4-40 · A dragged frame sends up to about 210 messages a second, and no cost table counts them.** INFERRED by
  reading (round 1, not checked): each dragged thing has its own lane at ten a second, up to `MAX_DRAG_SENDS` (20)
  things a step, and the pointer keeps sending while it drags, so a frame drag of 20 or more things sends about 200
  drag messages and 10 pointer messages a second; with five people, about 840 receipts a second from one drag.
  `boardLive.js`'s header ("each sent at most ten times a second") holds a lane at a time; MOTH_DESIGN §5.3 and the
  plan's table count pointer messages only. Whether Supabase's per-project message rate would cut a board during a
  large frame drag is not known. Fix shape: one message for a frame's move (with MO4-23), and drags in the cost
  table.
- **MO4-41 · A board at its 5,000-element cap was never drawn or measured.** INFERRED by reading (round 1, not
  checked; no timing exists): Ctrl+A selects all 5,000, and `cull` then keeps every selected thing visible, so every
  later paint draws all 5,000; every store change, a remote save included, hands all 5,000 to the Transformer again;
  a drag of a loose selection of S things with F frames outside it runs up to F times S frame checks a pointer move
  (100 frames and 2,500 things: 250,000). MOTH_DESIGN §5.3 measures only the debug sample's board, and the plan asks
  a limit beyond the datasets to be said. Fix shape: measure a board of 5,000 (open, select all, drag, a remote save)
  and say the figures, or say in MOTH_DESIGN §5.3 that it is not measured.
- **MO4-42 · Things a dragged frame holds that were out of view stay hidden until it is dropped.** INFERRED by
  reading (round 1, not checked): `cull` hides what lies more than 200 px off screen, and nothing calls it during a
  move, so a large frame dragged into view brings its far things in unseen; they appear at the drop, or earlier on a
  wheel or a remote save. Fix shape: cull during a frame's move, at most once a frame of the screen.
- **MO4-43 · The 5,000-elements-a-board cap has no test.** MEASURED by reading (round 1, checked: real, minor): no
  suite from 134 to 138 brings a board past 5,000 elements, so the three lines of `board_put_elements` (0130) that
  refuse it with 54000 can go and every suite stays green; `boardStore.test.js` tests only the words. It is one of
  the cost bounds MOTH_DESIGN §5.1 and the handbook promise, and unlike the 64 MB cap (MO4-11) one transaction can
  reach it. Fix shape: in suite 135, fill a board to 5,000 (ten saves of 500), check that a new element is refused
  with 54000 and the words, and that a change to an existing element at 5,000 still saves.
- **MO4-44 · Suite 135's "each change counts the board's revision" cannot fail for a removal.** INFERRED by reading
  (round 1, not checked): eight saves on the board before the check take its revision to 8 alone, and the check reads
  `revision >= 8`, so the revision's UPDATE in `board_delete_elements` (0130) can go and it stays green. Fix shape:
  read the revision just before the two removals and check that it is exactly two more after them.
- **MO4-45 · The end-to-end spec's step 9 says the other window is told why, and never looks.** INFERRED by reading
  (round 1, two reviewers, not checked): its header and its title say the second window closes "with the reason", and
  the step checks only that the board is gone there; "You cannot see this board any more, so it was closed." is never
  looked for, so a board closed for another reason, or with no words, passes. When step 8b has run, the second window
  is closed before step 9 and the check is true by default. Fix shape: look for those words in the second window, and
  when 8b has run, say the step is the first window's only.
- **MO4-46 · Step 8b of the end-to-end spec turns the second person off and never back on.** INFERRED by reading
  (round 1, not checked): it sets `is_active = false` for the second seeded person, and the spec's `finally` restores
  nothing; with CI's one retry, a failure after 8b makes the retry sign in as an inactive person and fail at step 2,
  and so does every later run on that throwaway stack. It runs only with `PSQL` and a second person set, never on
  wilson-dev. Fix shape: set `is_active` back in the `finally` when 8b ran.
- **MO4-47 · The check that Konva stays in the board's own chunk cannot fail for a static import of the canvas.**
  INFERRED by reading (round 1, not checked): the scans in `BoardToolbar.test.jsx` and `MothPage.test.jsx` read fixed
  lists of files that leave out `BoardPanel.jsx`, `boardPanelState.js`, `frames.js`, `boardStore.js`, `boardLive.js`
  and `stickyTurn.js`, and look only for an import of `konva`; a static import of `BoardCanvas.jsx` in the panel or
  in Moth's page would put Konva in their chunk with every test green, and the panel's tests mock the lazy target.
  Fix shape: scan every file of the board's folder and Moth's page for a static import of `BoardCanvas.jsx` or
  `konva`, or read the built chunks' contents after a build.

From the second whole-session round (12 reviewers by lens and 22 checkers, Opus 5.5, over `1923b430`; MOTH_DESIGN
§5.3, "The second whole-session round"): the findings not taken into the code, the most serious first. Each checker
said whether its finding breaks security, her acceptance list as written, or neither; the seven taken are the ones it
called security or acceptance, and MOTH_DESIGN §5.3 names them. A finding with no checker was read by its reviewer
alone, so it is INFERRED by reading.

- **MO4-48 · A demoted admin keeps a private project's board, hearing it and sending pointers, until their sign-in
  token refreshes.** INFERRED by reading (round 2, checked: real, minor, breaks security, bounded); the hour itself is
  MO1-01's measurement, not measured again for boards. A private project's board is its creator's and the admins'.
  When an admin who did not create the project is made a member while the board is open, 0132's trigger on
  `workspace_members` renames every board channel of the company and sends AUDIENCE to the old names, and their
  window asks `board_channels` for the new ones at once (`boardLive.js`, `rejoin`). That ask is judged by
  `board_for` (0130) through `moth_can_read_target` and `passes_project_privacy` (0082), whose admin arm is
  `current_app_role()` (0008): the role in the sign-in token, not in the table. The token still says admin, so
  `board_channels` answers the new names and `board_topic_readable` (0132, the same gate) lets the join through. The
  demoted admin then goes on hearing every save, pointer and presence on that board, and may send pointers and
  presence on its live channel, until the token refreshes with the new role or runs out: up to 3,600 s, the
  platform's known window (MO1-01; MO4-07 is the same kind of window for a project made private). `board_read` over
  REST gives them the board for the same hour through the same token arm, so the channel shows nothing `board_read`
  would not. Removal and deactivation are closed at once, since `has_active_membership` reads the table. 0132's header
  still says a role change is closed by the rename; the handbook's §13.6 and MOTH_DESIGN §5.2 now name this
  exception. The checker's fix (a
  new migration so that `board_topic_readable`, for a private project the caller did not create, also asks the
  table, `is_live_workspace_admin`) would close the channels and not `board_read`, nor any other gate that reads the
  role from the token. A whole fix reads the role from the table at every gate, or ends a demoted person's session at
  once, platform-wide. Not taken this session; hers to decide: accept the hour, as MO1-01 does, or have the whole fix
  built.
- **MO4-49 · Undoing an earlier step overwrites another person's later change, and nobody is told.** MEASURED by a
  probe on the real store (round 2, checked: real, major, breaks neither). `boardStore.js` keeps one version per
  element (`myVersion`), not one per step: `rebase` moves it past someone else's save when this person makes a new
  change, and each own save sets it again; an undo sends `expect` set to it. A moves X to 100; B moves it to 500; A
  changes X's fill; A presses undo twice. The first undo takes back the fill; the second sends x 0 with an `expect`
  that now passes, and the server saves it. B's move is gone in every window, unsaid, and B's own undo of it is then
  skipped as someone else's change. The fence works only for the newest step (the store's tests cover only that).
  Fix shape: fence each step: record, when a save answers, the version each element of that step was saved at, and
  keep per element the highest version heard from others; an undo whose element was changed by someone else since
  that step is skipped and said. Test: the probe's sequence ends with x 500 and the conflict said.
- **MO4-50 · Moving a shape or a pen stroke that someone has just deleted refuses the mover's whole save.** MEASURED by
  a probe on the real store with its test server made to refuse as 0130 does (round 2, checked: real, major, breaks
  neither). A move goes out as a patch: the id, the kind and the changed keys (`wireOf`). In `board_put_elements`
  (0130) an id the board no longer holds is inserted from those keys, so a shape has no `shape` and a pen no `points`,
  the table's CHECK (`board_elements_shape_chk`, or `board_points_ok`) refuses it (23514 or 22023), and the whole call
  rolls back. The store takes that as a refusal: it says the raw Postgres words, reads the batch again, and keeps
  nothing, so the mover's other moves in that round snap back and anything they added in it vanishes. The store's
  "made it again" path, built for this race, is reached only by kinds whose bare patch passes the checks. The store's
  own test server accepts the fragment, so no test meets it. MO4-03 is the sibling for a connector's end. Fix shape: a
  new migration so that `board_put_elements` answers a patch for an id not on the board in `conflicts`, not by an
  insert (the client marks a patch as such); the store's conflict path already drops it. Tests in
  `boardStore.test.js` and a suite.
- **MO4-51 · A sticky deleted by one person while another types in it drops the typist's unsaved words.** INFERRED by
  reading (round 2, checked: real, major, breaks neither). A sticky's words save at a pause of 1.5 s
  (`STICKY_SAVE_MS`, a debounce with no longest wait), so while A types steadily nothing is saved. Nothing stops B
  deleting a sticky whose turn A holds (`removeIds` asks nothing of the turns; 0133's lock goes with the element by its
  cascade). When B's removal reaches A's window, `reconcile` calls `closeEditorGone` (`BoardCanvas.jsx`), which closes
  the words box and lets go of the turn and saves and says nothing. A's words since the last pause are gone; if B
  undoes the removal the sticky comes back with the older words. Fix shape: in `closeEditorGone`, for a sticky whose
  words differ from the saved ones, keep the box open as ended with words such as "This sticky was removed. Your
  words are still here to copy."; a test that removes the element before the timer fires and finds the words.
- **MO4-52 · A closed board's waiting changes are dropped with nothing said after eight tries.** INFERRED by reading
  (round 2, checked: real, major, breaks neither; the store's test asserts the give-up). With the network off, the
  board says "Your last changes are not saved yet. WILSON will keep trying." The person closes it; `saveOnClose`
  (`boardStore.js`) tries eight times (1 + 2 + 5 + 10 + 30 + 30 + 30 s, about 108 s) and then ends with the changes
  still waiting; the store is let go and the panel forgets the close. The network back later and the board opened
  again, it reads the server and the changes are gone, unsaid. MOTH_DESIGN §5.3 gives the bound; until this round the
  handbook said a save is kept and tried again, unqualified. Fix shape: `saveOnClose` answers whether it saved; on
  not, the panel keeps the close, sends it first on a reopen or when the window comes back online, and the page says
  once that the board's changes could not be saved. Test: an offline close past eight tries is kept and sent on
  online.
- **MO4-53 · In the desktop app, Ctrl+=, Ctrl+- and Ctrl+0 on a board also zoom the whole window.** INFERRED by reading
  (round 2, checked: real, major, breaks neither). The board takes these keys (zoom in, out, 100%) and calls
  `preventDefault`; `App.jsx`'s document keydown listener, set up only where `electronAPI.zoomIn` exists, runs after
  React's and does not look at `defaultPrevented`, so it zooms the window too, and Ctrl+0 also throws away a window
  zoom the person had set. The web build is not touched. Fix shape: `if (e.defaultPrevented) return` first in that
  handler, with a test (a key on a child that prevents it does not zoom the window; on a plain target it does).
- **MO4-54 · An element's `z` has no range, so one written near the top of bigint, or past 2^53, breaks adding,
  raising and opening the board for everyone.** INFERRED by reading, with node confirming how JSON rounds the numbers
  (round 2, two findings, each checked: real in part; minor and major; breaks neither). `board_elements.z` is a
  bigint with no CHECK (0130), and `board_put_elements` takes any `z` a writer sends. Only a writer calling the
  function by hand can get there; the app's own steps never do. At 9223372036854775807 every window reads it as a
  double, `nextZ` adds one and sends a number bigint refuses (22003): every add, Bring to front, new frame and drop
  into a frame is refused for every member, in Postgres words, with the round's other changes lost, until someone
  sends that element back; and on a board of more than 2,000 elements, `board_read`'s paging cursor at such a `z`
  fails the same way, so the board does not open. Past 2^53 (5,000 elements at 4611686018427387905), `readBoard`'s cursor rounds: a page comes back empty or
  repeats, the loop ends as complete with 2,000 drawn, nothing is said, and the hidden rows still count toward the
  5,000 cap, so adds are refused while the people see 2,000 things. Fix shape: a new migration adding a CHECK that `z`
  lies between -(2^53 - 1) and 2^53 - 1 (NOT VALID, then existing rows clamped and validated), with a suite case;
  `readBoard` throws, rather than answering complete, when a page does not move the cursor on.
- **MO4-55 · Nothing says what a board does when the month's Realtime messages run out, nor how she would know
  first.** INFERRED by reading (round 2, checked: real in part, minor, breaks neither). PLAN_MOTH §5's Session 4 item
  10 asks for "degraded quota states" and the plan asks for a truthful quota failure; no board code reads a quota
  answer, and no document or item names the state. Saves go through the database, not Realtime, so a save is never
  said done when it is not; a channel that will not join shows "Not connected to the others on this board just now.
  WILSON keeps trying." after 4 s, without its cause, and the names are asked again every 30 s at most, with no end.
  What Supabase does at the allowance's end with the spend cap on is not in the repository. Fix shape: say the state
  in MOTH_DESIGN §5.4 (saves go on, others' changes stop arriving, the board says it is not connected); the operator's
  signal is the usage page, read before each release and through the month; optionally tell a quota or limit refusal
  apart in the channel's status and say so.
- **MO4-56 · The brief's dashboard deltas were taken once, for the automated spec, and not for the plan's three
  scenarios.** MEASURED (round 2, checked as part of the operator's cost finding: real in part, minor, breaks
  neither; then a second reading by the session). The brief asks the plan's three scenarios to be measured "with two
  browser contexts and the dashboard's deltas"; the two-to-five-person runs ran on a throwaway stack the usage page
  does not see. The page was read twice on 2026-11-12: 1,057 Realtime messages at 06:01 UTC and 1,703 at 08:27 UTC, a
  rise of 646, over three CI runs of the end-to-end specs on wilson-dev (pushed 05:54, 07:41 and 08:12 UTC; the page
  refreshes hourly, so the first may lie inside the earlier figure and the third outside the later one). One run of
  the board spec, counted on the wire, is 85 sends and 119 receipts, 204 messages as the page counts them: 612 for
  three, within 34 of the page's own rise. So the page's count and the wire's agree for the spec; the plan's
  two-person and five-person scenarios have no dashboard figure of their own. Fix shape: read the usage page just
  before and an hour after one scenario run between real accounts on wilson-dev, with nothing else running.
- **MO4-57 · Send backward or Send to back on a thing in a frame hides it under the frame's fill, still held.**
  MEASURED by a node run of the pure modules (round 2, checked: real in part, minor, breaks neither). `stack`
  (`BoardCanvas.jsx`) takes a frame's things along only when a frame is chosen; a lone held thing is restacked over
  the whole board with no floor, and a frame holds by position, not order. A sticky on a frame sent to back lies under
  the frame's opaque fill, unseen, still held: Delete on the frame removes it too (said once, and Undo brings it all
  back). The first drag or nudge of the frame raises it again, and Ctrl+Z takes the send back. Fix shape: in `stack`,
  for back and backward, stop a held thing just above its innermost holding frame, in the same step; a test.
- **MO4-58 · A turned frame holds, raises and deletes things that lie visibly outside it.** INFERRED by reading, with
  a scratch test on the real modules (round 2, not checked). A frame holds by its axis-aligned bounds (`frames.js`),
  and a turned frame's bounds are the box around its turned corners. A frame of 200 by 200 at (0, 0) turned 45
  degrees has a box reaching x = -141, so a sticky of 40 by 40 at (-130, 10), plainly outside it, is held: turning the frame raises it and saves its `z`, every
  drag of the frame carries it, and Delete on the frame removes it. No document says a turned frame holds by its box
  (MO4-22 names curved lines only). Fix shape: test a turned frame's own outline (its corners turned back), or say
  the rule in MOTH_DESIGN §5.4.
- **MO4-59 · A background change whose answer is lost is said not saved, then appears saved.** INFERRED by reading
  (round 2, checked: real, minor, breaks neither). `saveBackground` (`boardStore.js`) treats every error alike: the
  old background is drawn again and "That change could not be saved." is said, with no retry. If the server had saved
  it, the `board` message or the read after a rejoin carries the higher version and the window turns to the new
  background. The end state is true; the words and the moment back are not. The same shape was fixed for stickies and
  placements in the first round. Fix shape: on an error that is not a refusal, read the board and take its background
  and version; say the words only if that read does not show the choice saved.
- **MO4-60 · Any undo or redo whose answer is lost comes back as someone else's change.** INFERRED by reading (round
  2, not checked; the server's answer to a resend not measured). An undo is sent with `expect`; the server saves it
  and the answer is lost (no code, so the store queues it again with its version unmoved). The resend meets the new
  version, is named a conflict, the window says "Someone else changed this since, so it stays as they left it", and
  the change is dropped from its step; a redone removal (a readd, `expect` 0) meets the row it made. MO4-33 says this
  for a save of more than 500 split partway; this is any size, and MO4-33's fix shapes do not reach it. Fix shape: on
  a conflict for a resent undo, read the row and take it as saved when it matches what was sent.
- **MO4-61 · A clock set back freezes this person's pointer for the others, and keeps a dropped drag drawn.** INFERRED
  by reading (round 2, not checked). `boardLive.js` times its send lanes and its sweep by the wall clock (`now()`):
  after the clock goes back by H, a lane waits about H before it sends again, so the others see this pointer stand
  still until a rejoin; and a peer's drag is swept when it has been silent 2 s by this clock, so with the clock behind
  it stays drawn at its mid-drag place over the saved one until the clock catches up. Fix shape: time lanes and sweeps
  by `performance.now()`.
- **MO4-62 · A passing failure ends a sticky's words box for good, and the first Escape then drops the words.**
  INFERRED by reading (round 2, not checked). `saveSticky` (`BoardCanvas.jsx`) sets the box to ended on every failed
  save, a passing network error included, so it turns read-only with only Close, while its words say "Your words could
  not be saved just now. They are still here.", which promises a later try that never comes. Escape then ends the
  edit, and for an ended sticky that closes the box and drops the words without a question. Fix shape: keep the box
  editing on a passing failure and try again at the next pause; on an ended box, Escape asks first or copies the
  words.
- **MO4-63 · The board itself shows no focus ring.** INFERRED by reading (round 2, not checked). The canvas region is
  the one element every board key acts on (`tabIndex` 0), and its inline `outline: 'none'` beats the kit's global
  `:focus-visible` ring; no style draws one for it. A keyboard user cannot see that the board has the keys. Fix shape:
  drop the inline outline, or draw a ring for the region on `:focus-visible`.
- **MO4-64 · The background's promise of crisp whole-pixel lines fails at a fractional device pixel ratio.** INFERRED
  by reading (round 2, not checked). `background.js` rounds lines to whole CSS pixels and strokes at half a pixel, and
  the canvas applies the device pixel ratio whole, so at 125% or 150% a line is 1.25 or 1.5 device pixels wide at a
  fractional place, blurred unevenly, and dots are uneven; its comment says lines stay on whole pixels at every zoom.
  The test checks CSS pixels only. Fix shape: round in device pixels (the ratio inside the rounding), or soften the
  comment.
- **MO4-65 · Walkthrough 97's 28 pictures are not in the repository.** MEASURED by `git ls-files` and `git log --all`
  (round 2, checked: real, minor, breaks neither). The walkthrough says they are in the folder *97_moth_session_4
  pictures* beside it, and PLAN_MOTH §6 cites them by number; the folder is only in her Desktop copy, never committed
  (walkthroughs 93, 95 and 96 have theirs in the repository). Fix shape: copy the 28 pictures in under the names the
  walkthrough lists, after checking that none shows a real name or email address.
- **MO4-66 · A client may still send an event named AUDIENCE on a board's live channel.** INFERRED by reading (round 1's
  checker of its AUDIENCE finding, the optional hardening it named; not built). Since the first round's fix the client
  takes AUDIENCE only from the database's channel and ignores it on the people's channel, and since the second round
  the fixtures do the same; but 0132's write policy on `moth:board-live:` still lets a reader send an event of that
  name to every window there. Fix shape: a new migration narrowing `moth_board_live_write` so that no client may send
  an event named AUDIENCE on the live channel, with a suite case.

## The twenty-eighth beta merge (the controller, 2026-11-12) — recorded

Read on the merge commit `cc976d53` and on staging while 0107 to 0136 went in. Neither is fixed; the second needs
no fix in the product.

- **B28-01 · The live-board browser test went red once when two CI runs used wilson-dev at the same time.** OBSERVED
  once, not reproduced. The push and the pull request each started a `Playwright auth (wilson-dev)` run of the same
  commit three seconds apart. One failed `tests/e2e/boards.spec.ts:177` (a board live between two windows): on the
  first try at line 213 (the canvas not visible in 30 s; that board took 31.9 s to be made), on the retry at line 335
  (the editor still open after 30 s). The other run passed, and so did the other fourteen checks. Read as timing
  under double load on one database; nobody has shown that the product is at fault, or that it is not. Not re-run.
  Fix shape: keep two runs off wilson-dev at once (a concurrency group on that job), or give this spec's waits more
  room, then run it twice at once to prove the change.
- **B28-02 · Suite 17's #18 fails on a database with real rows on any day when edit-history rows have passed the
  90-day line since the nightly purge.** MEASURED on staging, 2026-11-13 00:31 UTC: the test backdates one row and
  expects `purge_edit_history()` to remove 1; it removed 5, because five real rows of 2026-08-14 were already past
  the line (the 04:43 UTC job had succeeded on each of the last four nights and takes them at its next run). The
  purge is right and the test's count is not its own. `docs/PRODUCTION_RUNBOOK.md` now names it with suite 74's #34
  and #35 and suite 25's #13 as a healthy red. Fix shape: have the test count only the row it backdated.

## F7 (2026-11-13, wave 2's database per-row work on `po/f7-database-per-row-work`; 0137, suite 139) — left open

What 0137 and the three functions left, each with its measurement. Round 1 (nine reviewers) found two blockers, one
of them a security finding, both fixed before anything reached dev. Round 2 (five reviewers, after the apply) found
no blocker and nothing of security; what it changed is in the next commit (storage-gc's orphan scan paged, the tests),
and what both rounds recorded is here. 0137 is applied on dev, so a fault in it is fixed by a later migration, never by
editing it; none needed one.

- **F7-01 · auth_events_insert still asks has_active_membership per row.** MEASURED on dev's live text: its WITH CHECK
  is `... AND ((workspace_id IS NULL) OR has_active_membership(workspace_id))`, with no pin to the claim anywhere, so
  the sub-select would change which company a member may name. One call per inserted sign-in event: negligible.
  Left by design (0137's header).
- **F7-02 · workspace_members' two read policies still ask it per row.** MEASURED (CI on `11256e74`: suites 14, 16, 24,
  38 and 67 red with 42P17): `ws_members_self_update`'s WITH CHECK reads workspace_members by a sub-query, and the
  row-security rewriter refuses to expand a table's policies a second time on one path once any of them holds a
  sub-query; with the sub-select in `ws_members_select` and `ws_members_admin_write` every client UPDATE of a member
  row recursed. A company's members are few rows. Fix shape: express self_update's "a member's row keeps its company"
  without a sub-query (a trigger, or a definer helper), then restate the two with the next migration and its probe.
- **F7-03 · Other helpers still run per row.** MEASURED on dev's 283 live policies: `can_write_project` in 70 policies
  on 21 tables, `can_access_project_money` 34 on 9, `current_app_role` 32 on 15, `can_edit_shot_lists` 22 on 8,
  `can_access_project_legal` 14 on 4, `is_live_workspace_admin` 12 on 8, `moth_can_read_target` 9 on 6,
  `is_platform_operator` 5 on 4, `two_factor_satisfied` 5 on 3; all definers but `current_app_role`. Also
  `fn_try_uuid` in 26 (22 on `storage.objects`, 4 on `realtime.messages`), plpgsql with an EXCEPTION block, so a
  sub-transaction per row: the cost 0137 took out of the meter, still paid on storage and channel reads;
  `rabbit_money_segment` 19 on 1, `moth_can_write_target` 8 on 3, `rabbit_legal_segment` 8 on 1,
  `otter_is_course_owner` 7 on 3. Most take the row's project and cannot be lifted out of the row.
  `is_platform_operator()` and `two_factor_satisfied()` (no argument, STABLE definers) and
  `is_live_workspace_admin(workspace_id)` beside the workspace pin could take the same once-per-statement form, under
  0137's proof and its recursion probe. Counted, not timed: dev is too small to show their cost. Measurement that
  would: EXPLAIN (ANALYZE) of a storage listing and of a project's tasks read on staging's sizes, as a client, rolled
  back, with the helper's calls counted in the plan's filters.
- **F7-04 · storage-gc's round trips that stay one per row.** INFERRED by the design round and round 1: the queue's
  status stamps (grouped, a run killed by the 150 s clock between a removal and its stamp would leave a disposal with
  no certificate, then stamped `missing`), `remove()` with `certify()` per orphan (a batch answers one error, and a
  kill would lose up to a batch of certificates), the projects and file_events reads per folder of the orphan scan
  (groupable only with an exact per-folder fallback), and the twin question per old shot object. Measurement owed: the
  stamps' share of a real run's time.
- **F7-05 · The meter's arm 1b still reads both buckets of every company on every upload.** MEASURED on dev's plan
  (126 objects at 04:24 UTC, none spelled otherwise): 0137 cut the cost per object from fn_try_uuid's sub-transaction
  (about 0.2 ms) to a regular expression (about 5 µs), but arm 1b is still a scan of every object in rabbit-files and
  rabbit-thumbnails. At dev's size the planner scans for arm 1a too (126 objects read once per project; the index
  serves it only with seq scans off): the 26.7 to 2.8 ms is the sub-transactions gone. Making 1b read less needs an
  index on `storage.objects` (a table of the storage schema): her decision, walkthrough 98's first question.
  Measurement that settles whether to ask: the meter's EXPLAIN on staging's object count.
- **F7-06 · 0137's own meter check runs the old meter for every company.** INFERRED: about 0.2 ms per object of both
  buckets, times the number of companies, before any lock that makes anyone wait (it holds ACCESS SHARE only). Read the
  rehearsal's time on staging and production before the apply (the runbook's row says so).
- **F7-07 · rekey_file_body's picture-only phase sets a thumbnail_url without asking 0115's claim.** INFERRED by
  round 1 (r1-gc, finding 4) from 0133: every other writer of a key consults `file_key_admissible`'s step 5, which
  holds a queued key against a new row. storage-gc now reads and acts on 50 queue rows at a time, so the window is one
  slice. Fix shape: the same step 5 for `p_to_thumb` in a later migration.
- **F7-08 · A bin poster's path may hold any character but `//`, `..` and a backslash.** MEASURED by reading 0091's
  `bin_files_poster_path_shape_chk`. It is how a key holding `")` could reach storage-gc's queue (round 1's security
  finding, fixed in the drain: lists are quoted and escaped, and any key that is not plain is asked alone). Fix shape:
  give the poster column `file_key_shape_ok`'s segment rule.
- **F7-09 · No provider filter is proved for storage-gc's guard, so its read is a scan of `files`.** MEASURED on dev
  (both indexes on the columns are partial on the provider; with seq scans off the unfiltered read still scans): a
  network_share row can never name a bucket key (0117's CHECKs), but nothing in the schema stops a google_drive row
  from naming one. The read is batched: MEASURED in the tests (round 2), a full page of 500 rows (250 bodies and their
  250 pictures, typical keys) is 20 reads of `files` when nothing is named and 40 when everything is, where it was
  500. **The orphan scan's two lookups keep the filter** (`referencedPaths` and the twin question `rowNamesTwin` ask
  only `supabase`, `s3` and `local_server` rows, as before F7): so a google_drive row naming a `rabbit-files` key does
  not keep it from the orphan scan, though the drain's guard asks every provider (a network_share row cannot name one,
  by 0117's CHECKs). Kept on purpose: without the filter the twin question's LIKE is a scan of `files` for every old
  object, which puts the 150 s deadline at risk. Fix shape, hers (walkthrough 98's second question): a CHECK retiring
  google_drive (`storage_provider <> 'google_drive'`, after counting the rows on each environment: 0 on dev), which
  would make the filter provable everywhere, the partial indexes usable and the orphan scan's filter complete.
- **F7-10 · An event row naming a file id over about 2.7 kB can no longer be inserted, and a long one can stop the
  apply.** INFERRED (round 1, and round 2 by reading): 0137's `app_events_file_id_idx` indexes `context->>'file_id'`
  of every row, and a btree entry holds at most about 2,704 bytes, so a row whose file id is incompressible and longer
  fails with 54000 where it was accepted before (0021's CHECK lets `context` be up to 8,000 characters, and any active
  member may insert into their own company's app_events). No writer of this product names such an id: ai-files and
  operator-ai-files accept only `file_` and 8 to 96 letters and digits, and no database function puts a client's file
  id into app_events (dev's longest: 101 characters). The same member can make a staging or production apply, or a
  re-run, refuse by first writing a file id over 1,000 bytes: the pre-flight refuses rather than build midway (the
  runbook's row: read `longest_id` just before the apply; the 90-day purge removes such a row). The check is not
  atomic with the build either (SHARE is taken at §4, after §3): a long row written between them aborts the build, a
  safe refusal.
- **F7-11 · CI's storage schema was never listed.** INFERRED by round 1 (r1-meter): whether arm 1a's range is served
  by an index on CI's local stack is not known (correct either way). On dev it is served only with seq scans off, by
  `objects_bucket_id_name_version_key` (F7-05).
- **F7-12 · Two pgTAP pins prove less than their words since the sub-select also names `current_workspace_id()`.**
  Fixed in suites 99 (test 4) and 101 (test 5), which now look for the pin itself. MEASURED by reading in round 2: no
  other suite finds the pin by a bare `current_workspace_id()` substring (suite 103:166 reads a column's default;
  suites 90, 95 and 100 pin whole texts). Suite 01:129 is in F7-18. Closed.
- **F7-13 · The AI file list's main read (readUploadRows) takes a generic plan from a connection's sixth call.**
  MEASURED on dev, 2026-11-13 04:52 UTC, one rolled-back session: the read prepared as PostgREST sends it (the JSON
  key and every value as parameters), `plan_cache_mode` auto, as service_role, eight runs. The first five are custom
  plans on `app_events_ai_files_ws_id_idx`, 0.75 ms; from the sixth the generic plan, a walk of `app_events_pkey`
  with a filter: 4.3 ms for dev's busiest company (2,855 AI rows), 6.9 ms for a company with none (all 14,294 rows
  walked). readCertifiedGone (2.2 to 2.9 ms) and readAbsentNoted (1.3 to 1.5 ms) kept custom plans in all nine runs.
  MEASURED whole, 05:11 and 05:15 UTC on a quiet dev: the statement as sent, its JSON reply included, twelve runs, and
  the old shape timed the same way (the two indexes and the statistics dropped inside a rolled-back transaction):
  readUploadRows 5.1 ms for the first five and 8.6 ms after, the old shape 8.9 and 8.5; readCertifiedGone 5.7 against
  6.0; readAbsentNoted 1.85 against 1.85. So at dev's size the indexes save about 4 ms on a connection's first five
  upload reads and nothing after; the 44 ms live mean before 0137 was CI's load on dev and stale statistics. Whether
  the two indexes earn their write cost (F7-17) is part of the same later decision. A generic plan cannot match an index on `context->>'tool'` when the key
  is a parameter, and PostgREST keeps its prepared statements for a connection's life, so a pooled connection's
  steady state is the generic plan, which grows with `app_events`. Options for a later migration, the controller's
  and her call (walkthrough 98's third question): an index on `app_events (workspace_id, code, id)` that a generic
  plan can use, or `plan_cache_mode = force_custom_plan` for service_role (INFERRED by round 2: PostgREST applies the
  role's settings per request, so only the Edge Functions' service-role reads would change). Measurement that
  settles it: the same eight runs on staging's `app_events`.
- **F7-14 · A slow spell on dev, 04:30 to 04:50 UTC, to be read again.** MEASURED from dev's statement statistics,
  04:30:47 to 04:49:57 UTC: readUploadRows ran 15 more times at a mean of 1,183 ms, readCertifiedGone 5 at 48.7 ms,
  readAbsentNoted 5 at 80.7 ms. At 04:52 nothing was running on `app_events` and no lock was held on it; the worst plan
  measured (F7-13) is 7 ms, and a cold first touch cost 95 to 200 ms. Read as dev's small server being slow in that
  window (a cold cache or its disk), not a plan. READ AGAIN, 04:49:57 to 05:04:22 UTC (CI's smoke and Playwright on
  `c23648dd` ran on dev): readUploadRows 60 calls at a mean of 51 ms, readCertifiedGone and readAbsentNoted 20 each at
  11 ms; on a quiet dev at 05:11 the whole statements took 8.6, 5.7 and 1.8 ms. The live means follow CI's load on
  dev's small server. Left open: a statement's first run on a fresh connection cost 46 to 270 ms in one timing loop,
  while EXPLAIN shows under 1 ms of planning and every page already in memory (05:12 UTC); read as cold data, not
  settled.
- **F7-15 · 0137's own comments that are wrong (never edited: the file is applied).** MEASURED by reading the file:
  line 15 says "207 calls" for the row's-column form; with `ws_members_select` and both clauses of
  `ws_members_admin_write` left alone it restates 204 of them, plus notes_select's 1 and the 13 bare calls: 218, the
  number §2 checks. Line 178 says "the one exception"; there are three policies, four clauses. Lines 1669 to 1671 say
  each probe statement carries a WHERE or a RETURNING "so the read policies are collected too": true of the UPDATE
  only (the DELETE's and the INSERT's `RETURNING 1` name no column, so they ask for no read right); the coverage is
  still complete, and the handbook's §4.4 has the reasoning. Lines 63 and 64 say `app_events`' inserts wait "while" the
  indexes are built; they wait from §4 to the commit (the runbook's row says so). Line 70 says the search_path is the
  caller's again at the end: true, and `lock_timeout` (5 s) and the setting `f7.caller_search_path` stay set to the
  transaction's end (harmless; a chained rehearsal's later files inherit them).
- **F7-16 · Two small edges, grouped.** (a) INFERRED by round 2 (0137:1720 to 1723): the recursion probe re-raises only
  `lock_not_available` and `query_canceled`, so a deadlock (40P01) on a statement kind outside the must-succeed rule
  (FOR UPDATE, DELETE and INSERT, anything as anon, every table outside `public`, `storage.objects` included) counts
  as a pass with nothing proven. Near impossible: the probe takes only weak locks. Fix shape, in a later file's probe:
  re-raise `deadlock_detected`, and require success on `storage.objects` too, which holds 12 of the restated clauses.
  (b) Older than F7, INFERRED by round 1: `rabbit_object_incoming_bytes` (0057:192) raises "bigint out of range" for a
  size of 19 or more digits, though its comment says it never raises; the old and the new meter raise alike, and no
  member path to such metadata was found (an upload's length is checked against the bucket's limit first).
- **F7-17 · The file-id index holds an entry for every event row, most of them empty.** INFERRED by round 2: about 80%
  of dev's `app_events` rows carry no `file_id` (2,831 AI rows of 14,177 before 0137), so each of those inserts adds an
  empty entry. A partial index `WHERE (context->>'file_id') IS NOT NULL` would serve both naming reads (in a custom
  plan an `= ANY` over the given ids implies it), and readAbsentNoted, which names no file id, could never take it, so
  round 1's trap (a partial index taken for its predicate alone) stays shut. Small: take it only in a later migration
  that touches this index anyway.
- **F7-18 · Test notes, grouped (round 2).** Each is a test that proves less than its words; none hides a fault found.
  `src/cloud/edgeSweeps.test.js`: ai-files' "after equals what the list then answers" compares against the
  member-scoped list (no `workspace_members` row is planted, so the list answers `scope: 'own'`; every planted upload
  is the admin's, so the two agree, and a sweep whose `after` was cut to the caller's own uploads would pass too: plant
  a live admin and a second member's upload, and assert `scope === 'workspace'`); the two "says the same" cases
  (ai-files' `remaining` against `after.count`, the operator's `remaining_attributed` against `left_alone`) compare
  fields filled from one variable, so neither can go red, and the first case of each block is what proves the totals.
  Suite 139: its recursion probe (`t139_recursion`, 139:85 to 116), the guard that lasts after 0137, is weaker than
  0137's (as authenticated only, four statements with no WHERE or RETURNING, and no check that each statement was
  rewritten, so a table whose PREPAREs all fail for another reason reads "no recursion"); #28, #29 and #55 (and #31's
  exact sum) count everything company `11111111` can see, so they hold only while dev's fixture company has no real
  rows; #26 is held by two restated policies at once (`tasks_update`'s own sub-select and the projects hop through
  `projects_select`), so it goes red only if both break. Suite 01:129 pins the sub-select without the
  `(workspace_id = current_workspace_id())` pin that suites 99 and 101 added (behaviour still held by suite 115:1815
  and :1826). The brief's item 4 controls at the migration's level (a policy put back per row fails the
  post-condition; a guard removed fails the comparison) exist only in the session's scratch files and ran against
  `bcc8b131`'s file: the comparison is unchanged since, by diff, but the exception plant was proven against the one-row
  check `6bdd30f2` replaced, and no plant restates `ws_members_select` or `ws_members_admin_write` as text. The
  hand-off says which file each plant ran against.

## F4 (2026-11-13, wave 2 of `docs/sessions/PLAN_WEEK_2026-11-04.md`) — left open

Re-render discipline (`po/f4-rerender-discipline`; brief `docs/sessions/briefs/po-f4-rerender-discipline.md`).
What F4 met outside its list, what its measurements left, and what its two review rounds recorded. None is fixed.
Review round 1 (six reviewers, Opus 5.5): two security defects and the five the round found F4 had made worse
were fixed in the session, the five by her answer *"Fix them now (Recommended)"* (2026-11-13). Review round 2
(five reviewers, Opus 5.5) found the first security fix incomplete (a save queued behind one in flight still
reached the next person's account, and the pet's chat reached them by three other paths) and two of the five
half done (Settings' Models tab drew the loaded words over stale copies; the open lesson was parsed again at
every change of page): those were fixed in the session too, the first as security, the two as the rest of her
answer. F4-08, the agent's own conversation kept for the next person, was fixed after the session's merge at her
word *"Yes, fix it here"* (2026-11-13). What is below was left.

- **F4-01 · Two pet pictures draw repeated React keys.** MEASURED in the running app (every pet render of an
  otter: *"Encountered two children with the same key"*, the key `o14_13`) and while reading the sprites: each
  sprite keys a pixel by its place (`src/components/sprites/index.jsx:98`, `` key={`o${x}_${y}`} ``) and the otter
  and the monkey (`mk2_1`) paint a place twice. React may then drop or keep the wrong pixel on an update. Before F4
  too. Fix shape: paint each place once, or key by the call's index.
- **F4-02 · In the pet's agent mode the Send button sends nothing.** MEASURED in the running app before F4 and
  unchanged by it: the button is `onClick={activeOnSend}` (`src/components/PetCompanion.jsx:226`), which hands the
  click event to `sendAgentMessage(overrideInput)` (`src/agent/AgentProvider.jsx:263`); `overrideInput ||
  agentInputRef.current` is the event, and *"currentInput.trim is not a function"* is an unhandled rejection. Enter
  sends. Fix shape: `onClick={() => activeOnSend()}`.
- **F4-03 · Day-scale words drawn from the clock move only when their component draws.** INFERRED by reading.
  Today's date and the days left in R.A.B.B.I.T. (`views/budget/ClientViewTab.jsx:216`,
  `components/MilestoneTrashModal.jsx:46`) and M.O.T.H. (`components/MothTrashView.jsx:14`, `MothTimeSlider.jsx:14`)
  are computed from `Date.now()` while drawing. Before F4 a live pet's ticks drew every page and these with them; a
  page left open across midnight now keeps yesterday's word. The minutes-and-hours words (the Admin terminal's,
  O.T.T.E.R.'s requests) were fixed in the session: they read `lib/minuteClock.js`. Fix shape: the same clock.
- **F4-05 · A change to the project open in R.A.B.B.I.T. is a new value for every reader of the provider.** MEASURED
  (rabbit C1's other half; F4 took the state that moves on its own clock out of the value, `state/rabbitLive.js`):
  one task renamed on the Assets tab is one commit in which all seven readers mounted there run, 574 component
  renders (`state/volatileState.rerender.test.jsx`, pinned at that number so it moves with the code); in the running
  app (development build, the Assets tab open, every page entered) a new value with nothing on the tab changed drew
  17 readers and 2,237 components in 119 to 123 ms. Not only a write makes one (review round 2, E-1, by
  reading; F4's commit `f7b20e87` said a write): the Bins tab's gateway refresh, every 60 s while the tab is open
  in a company with gateways (`views/BinsView.jsx:347`), runs `discover` (`adapters/gatewayBins.js:248`), which
  calls its `onChange` whatever it found, and the provider's handler (`gatewayChangedRef`, `RabbitProvider.jsx:6700`)
  sets the bundle's `binFiles` and `binsInfo` with `ticketsRev` one more: a new value with nothing written, and
  again at each batch of tickets (a hover on a tile). Before F4 too. Fix shape: split the value by what changes
  together (the bundle's slices, the views, the actions), or a store read with selectors; and set nothing when
  the gateways' state is unchanged.
- **F4-06 · `NotesView.review.test.jsx` went red once under load.** OBSERVED once, not reproduced: *"a note moved to
  the trash elsewhere: said in words, the editor locks, and no save is tried again"* read `ed.isEditable` true just
  after the words appeared (line 177), in a run of 108 files on four workers; alone it passed three runs of three.
  It reads nothing F4 changed. Fix shape: wait for the lock, not for the words.
- **F4-07 · A link in the pet's chat goes through the first page's navigation.** INFERRED by reading (review round
  1): `handleCompanionNavLink` (`src/App.jsx`, the pet's host) has `[]` as its deps, so it keeps the first render's
  `navigateTo`, whose `currentPage` is the page the app opened on. On R.A.B.B.I.T. with an unsaved edit a link in
  a chat reply skips the "leave with an unsaved edit?" question; on O.T.T.E.R. a link to O.T.T.E.R. replays the
  2.2 s transition and, on the web, pushes a second history entry. The same before F4 (the handler was App's, with
  the same deps). Fix shape: read `navigateTo` through a ref.
- **F4-09 · D.O.G.'s Prompts tab shows the models as they were when D.O.G. last drew.** INFERRED by reading
  (review round 2, B-3): `src/components/settings/ModelPicker.jsx:61` and `:65` read `modelFor()` and
  `defaultModelFor()` while drawing, and D.O.G. is under `React.memo` since F4 (`e3e5efb1`). A load of the tiers
  that lands while the tab is open (App's, when an offline launch's connection comes back) shows nothing there
  until D.O.G. draws for a reason of its own; before F4, App's next render drew it. Caused by F4. Fix shape: a
  subscription to the tiers in `lib/activeModel.js`, read by the picker with `useSyncExternalStore` (the flag's
  subscription tells only that a first load landed).
- **F4-10 · The model tiers stay the first person's when another signs in over them.** INFERRED by reading
  (review round 2, B-4): `src/App.jsx` loads the tiers in an effect on `[authed, perms.offline]` only, and neither
  changes when another person signs in with no sign-out between. The second person's Settings shows the first's own
  choices and the first's company's defaults, and `modelFor()` answers from them, until Refresh. Before F4 too.
  The agent's prompt overrides are the same (by reading, while fixing F4-08): `src/agent/AgentProvider.jsx` reads
  them (`loadAgentSkills`) at mount and when Settings saves, so after a change of person its requests carry the
  first person's prompt overrides until then, though App has mirrored the second's settings into the cache.
  Security-adjacent: one person's settings shown to, and used for, another. Fix shape: key the load on the
  signed-in person's id and empty the tiers (and the flag) when it changes; App tells the agent when the next
  person's settings have reached the cache, and it reads its overrides again.
- **F4-11 · The session's source guards and render pins have blind spots, and one rule calls correct code an
  error.** CONFIRMED by temporary tests, deleted (review round 2, C-2 to C-5), and by reading (E-3, E-4); caused
  by F4 (`ca2aa63f`, `f7b20e87`, `99d14da0`):
  - `otterRerender.test.jsx`'s rule that a view reads no ref while it draws misses an alias (`const r = ref;
    r.current`), a ref handed to a helper, a `[]` callback called while drawing, `Reflect.get` and
    `({ current: cur } = ref)`; and it calls correct code an error: a handler made in the body and handed by name
    (`const toTop = () => ref.current…; onClick={toTop}`), `onClick={cond ? () => … : undefined}`, a callback ref
    (`ref={(el) => { r.current = el }}`). Its lists may hold only state and props (a memo's value, a hook's
    result or a callback in a list is refused; `[x?.type]` reads as `undefined`).
  - `src/lib/renderSpy.js`'s `typesOf` does not see a memo loaded through `lazy()`: `rendersOf` gives 0 and
    `assertSeen` throws, so a pin on one fails rather than passes.
  - `rabbitLive.test.jsx`'s list of readers matches only a single-quoted `useRabbitLive('name'`, and its guard on
    D.O.G.'s six fields (line 258) only `rabbitCtx?.name`: a plain `rabbitCtx.bundle` passes the guard and is
    `undefined` when it runs, since D.O.G.'s object holds six fields.
  - `views/assetWarningRender.test.jsx:139` pins the provider's `tasksAbout` calls at 0 with nothing in the file
    showing that the counter counts one (`ctx.selectTasksByAsset` still calls it and would), and by the reviewer's
    reading no test fails if the rows stop asking for their warning.

  Fix shape: one item at a time, each with a plant that turns it red.
- **F4-12 · R.A.B.B.I.T.'s value does not list `authUserId`, and two readers ask for the adapter while drawing.**
  INFERRED by reading (review round 2, E-2): `authUserId` is a field of the value (`state/RabbitProvider.jsx:9119`)
  and not one of its `useMemo`'s deps (so at `a71cd144` too). Before F4 the adapter's status, set after every auth
  event, made a new value; since F4 each `setAuthUserId` is fresh only because another field moves in the same
  commit (`withdrawUserId` through the `canWithdraw*` callbacks and `recentlyWithdrawn`, `recoverableEditDrafts`
  through `draftPersonKey`, or `projectMembers`). No reader sees the wrong person today. `components/ConnectionDot.jsx:118`
  and `src/tools/moth_v0.1.0/MothPage.jsx:125` call `getAdapter()` while they draw; on a desktop launch in
  `local_server` mode whose server answers offline, the one field of the value that changes is `tableViewLast`
  (`state/tableViewsState.js:590`'s effect), and that is what takes the dot out of "pending". A refactor of
  either would make these real. Fix shape: list `authUserId` in the deps; hand the adapter's kind to the
  readers through `state/rabbitLive.js`.
- **F4-13 · What a change of person still leaves to the next one.** INFERRED by reading (review round 2's fixes,
  `8a9d6652` and `ad407a5d`, closed the rest). Before F4 too:
  - The pet's chat request (`callAI`, `src/App.jsx`'s `sendChat`) reads the session's token when it is sent: a
    question asked by A that goes out as the client takes B's session (another tab's sign-in) goes to the model
    under B's account. Its answer is dropped since `8a9d6652`; the question is not. Security-adjacent. Fix shape:
    the request names its person and the AI proxy refuses another's token (an Edge Function's change).
  - When another person signs in over the first with no sign-out between, the first's save notice (its toast and
    Settings' copy) and the Create Egg status stay up, as a sign-out would have cleared them; their words are
    generic. One of them can be the database's own refusal: since `ad407a5d` the pet's and settings' saves name
    their person, so a save of the first's that goes out as the client takes the second's session is refused
    (SQLSTATE 42501) and can show, in that moment, as the first's save error. `src/lib/userStateWiring.test.js:342`
    pins exactly two `setPetNoticeSticky(null)` in `App.jsx` ("cleared on sign-out and on a later successful save,
    and nowhere else"), so a third clear changes that test too. Fix shape: the identity effect clears them where
    it blanks the pet.
  - From the review of F4-08's fix (one reviewer, Opus 5.5; by reading): a subject or course the agent's proposal
    set generating just before a change of person keeps running (`src/tools/otter_v0.3.1/Otter.jsx`'s
    `agentGenerateSingleSubject` and `agentGenerateCourse`, which do not track the person) and posts its result under
    the next person's session. And at a launch whose stored session is one person's while the permissions name
    another (another tab's sign-in during the launch), what was typed or sent to the agent before the permissions
    answered stays: the agent is told the person only once the permissions are ready, and App's comparison with the
    stored session's person (`bootOwnerRef`) is not handed to it. Fix shape: the generation queue keeps the person
    it started for and stops when they go; App hands the agent the stored session's person until the permissions
    answer.
