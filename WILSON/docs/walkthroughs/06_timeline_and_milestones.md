# Walkthrough 06 — the timeline: dependency warnings, the re-wire confirm, ghost links, migrated links

**What this checks.** Track A bundle A2, session 1 (`cc1f55e`, `b104e50`,
`643b5ca`, with the review corrections `327cd37`, `4c645f7` and `564f02c`;
2026-09-06). Four things, all around dependencies:

1. **Phase 7** — marking a task or phase *done* while something it depends on
   is not done now shows a warning that names the unfinished dependencies and
   lets you continue. It never blocks, and it fires on every place a task or
   phase status is written (your rulings 9 and the 2026-08-12 "warn dont
   block. do both phases and tasks").
2. **The re-wire confirm** — dragging a dependency arrow onto a different bar
   now asks before it replaces the link (ruling 7; it does not make the two
   writes atomic, and the modal says so).
3. **Ghost links on the desktop** — deleting a task or phase on Local Server
   now removes its dependency rows in the same write, so they no longer come
   back on reload (ruling 8).
4. **Migrated links** — the desktop→cloud migration now carries the
   dependency graph and its dry run counts the links (ruling 8).

The milestone half of this bundle (cloud milestones, trash and undo) is
session 2 and is **not** in this file yet; that session appends its steps
below the report.

**Where and who.**

- **The beta** (staging-backed), signed in as a **member who can write** the
  project — one browser is enough. Steps 1–14.
- **The desktop app on Local Server** (Settings → `Storage` → `Storage Backend`
  → `Local Server`). Steps 15–17.
- **The desktop app signed in to the cloud** for the migration dry run.
  Steps 18–19. This is the only step that touches the migration tool; do a
  **dry run only** unless you want the project copied.

Set-up on the beta, once: a throwaway project with **three tasks** (call them
Model, Rig, Animate) and **two phases** (Pre and Prod). Leave every status at
its default (tasks *Waiting to start*, phases *Not started*).

## Steps

### Phase 7 — the warning, on every surface

1. **Timeline tab, link the tasks.** Open `Timeline`. Hover the Model bar in
   the lower (detail) pane until the small handle appears at its right edge
   (tooltip `Drag to link a dependency`). Drag it onto the Rig bar. Do the
   same from Rig onto Animate.
   - **Expect:** two arrows, Model → Rig → Animate.
   - **If instead** an arrow does not appear, or the `Not saved` strip shows
     at the top of the timeline: record its exact text.
2. **Timeline tab, link the phases.** Drag the handle from the Pre phase bar
   onto the Prod phase bar.
   - **Expect:** an arrow Pre → Prod.
   - **If instead** it fails: record the `Not saved` text — that is the
     phase→phase link migration 0061 enabled, and a failure there is a
     different bug.
3. **Phase editor.** Click the Prod bar (a click without dragging opens the
   editor, headed `Edit phase`). Set `Status` to `Completed` and click `Save`.
   - **Expect:** a modal headed `Unfinished dependencies` saying Prod is being
     marked Completed while a phase it depends on is not done, with **Pre**
     listed under `Not done yet` with its status. Click `Continue anyway`.
     The editor closes and Prod's status is Completed (open it again to
     check).
   - **If instead** there is no modal and Prod just saves: record it. **This
     is the failure that matters most in this whole walkthrough** — silence
     means a surface was missed. Say which screen.
4. **Go back keeps the change unsaved; closing the warning saves it.** Open
   Prod's editor again, set `Status` back to `Active`, `Save` (no warning —
   Active is not a done status). Set it to `Completed` again, `Save`, and this
   time click `Go back`.
   - **Expect:** the modal closes, the editor is still open with Completed
     still selected, and nothing was saved (close the editor, reopen: Active).
   - Now `Save` once more and close the warning with its X (or click outside
     it) instead of choosing a button.
   - **Expect:** that counts as `Continue anyway` — the editor closes and Prod
     is Completed. A dismissed warning is never a silent cancel; only
     `Go back` is. Then put Prod back to `Active` (`Save`, no warning) so
     step 5 starts clean.
   - **If instead** the editor closed on Go back, or the X left the status
     unchanged: record which.
5. **The no-warning control.** Open Pre's editor, set `Status` → `Completed`,
   `Save` (Pre depends on nothing, so no modal). Now open Prod, `Completed`,
   `Save`.
   - **Expect:** **no warning this time** — Prod saves straight away.
   - **If instead** it still warns: record the text; the check is wrong.
6. **Tasks tab, inline dropdown.** Open `Tasks` (the `Table` view). On the
   Animate row, change the `Status` cell to `Final`.
   - **Expect:** `Unfinished dependencies` naming **Rig** (Waiting to start).
     `Go back` → the cell shows Waiting to start again. Repeat and
     `Continue anyway` → Animate is Final.
   - **If instead** the cell changed with no modal: record it.
7. **Tasks tab, the task popup.** On the Rig row click the `View task details`
   button. In the popup set `Status` to `Final`.
   - **Expect:** the warning, naming **Model**. `Continue anyway` → Rig is
     Final and the popup stays open.
   - **If instead** no modal: record it.
8. **Tasks tab, bulk — one summary.** Set Rig and Animate back to *Waiting to
   start* from their dropdowns (no warning: not a done status). Tick the boxes
   on the Rig and Animate rows; the bar reads "2 selected". In that bar, set
   `Status` to `Final`.
   - **Expect:** ONE modal — "2 of 2 tasks being marked Final have unfinished
     dependencies" — listing Rig (depends on Model) and Animate (depends on
     Rig), not two modals. `Go back` → both rows still selected and unchanged.
     Repeat, `Continue anyway` → both Final, selection cleared.
   - **If instead** two modals, or the selection was lost on Go back: record.
9. **Tasks tab, Board drag.** Switch to `Board`. Drag the Model card into the
   `Final` column.
   - **Expect:** no warning (Model depends on nothing); it lands. Now set Rig
     and Animate back to *Waiting to start* (drag them to that column — no
     warning either), then drag Animate into `Final`.
   - **Expect:** the warning naming Rig; `Continue anyway` lands the card.
   - **If instead** the card moved silently: record it.
10. **Assets tab, task rows inside an asset.** Open `Assets`, create an asset
    if the project has none, and attach Rig to it (open Rig's popup and set
    its asset). Click the asset to open its detail; in its tasks table set
    Rig's `Status` to `Final` (Rig should be *Waiting to start* first — set it
    from the Tasks tab if not).
    - **Expect:** the warning naming Model only if Model is not done — so put
      Model back to *Waiting to start* first, then try. `Continue anyway` →
      Final.
    - **If instead** no modal: record it.
11. **Omitted counts as done — and is never itself warned about.** Set Model's
    status to `Omitted` (Tasks tab dropdown — no warning, and none expected).
    Then set Rig to `Final`.
    - **Expect:** no warning: an omitted predecessor is treated as done.
    - Put Rig back to *Waiting to start*, then set Animate (which depends on
      Rig) to `Omitted`.
    - **Expect:** no warning either — a skip is not a completion. Then set
      Animate straight from Omitted to `Approved`.
    - **Expect:** the warning, naming Rig — un-omitting into a done status is
      the one move out of Omitted that checks.
    - **If instead** any of the three behaved differently: record which.
12. **Nothing blocks, on any surface.** Every modal above had `Continue
    anyway` and the status landed. Record any place where it did not.

### The re-wire confirm

13. **Replace a link.** `Timeline`. Reset the tasks to *Waiting to start* if
    you like (not required). Find the arrow Model → Rig. At its head (the
    Rig end) is a small circle with the tooltip `Drag to rewire — drop on
    empty space to disconnect`. Drag it and release on the **Animate** bar.
    - **Expect:** a modal headed `Replace this dependency?` showing `Old`
      Model → Rig struck through and `New` Model → Animate, with the sentence
      that the old link is removed before the new one is saved. Click
      `Keep old link`.
    - **Expect:** nothing changed — the Model → Rig arrow is still there.
    - Drag the same head onto Animate again and click `Replace link`.
    - **Expect:** the arrow now runs Model → Animate and Model → Rig is gone.
      If the `Not saved` strip appears instead (it will if Model → Animate
      already existed), record its exact text: the old link is gone and the
      new one was refused — that is the known, accepted loss the modal warned
      about.
    - **If instead** the arrow moved with no modal: record it.
14. **The other two drops are unchanged.** Drag the head of an arrow and
    release it back on the same bar it came from: nothing happens. Drag it and
    release on empty space: the arrow is removed with no modal (that is the
    disconnect gesture, as before). Clicking an arrow still asks `Remove this
    dependency?`.
    - **If instead** any of those three changed: record which.

### Ghost links on the desktop (Local Server)

15. **Set up.** Desktop app, Settings → `Storage` → `Storage Backend` →
    `Local Server`. Open (or make) a project, `Timeline`, create two tasks and
    link them A → B. Note the project's folder on disk (Settings → the project
    files location, or the project's folder as shown on its page).
16. **Delete and reload.** On the `Tasks` tab delete task B (the trash icon on
    its row; the undo toast appears — let it expire). Close and reopen the
    project, or restart the app.
    - **Expect:** no arrow from A to anything; the `Timeline` shows A alone.
    - **If instead** a stray arrow, or an arrow to a task that no longer
      exists, is drawn: record it and which task.
17. **The mirrors on disk.** Open the project folder's `{Slug}_DATABASES`
    sub-folder and look in `tasks.json` and `timeline.json`.
    - **Expect:** the `dependencies` array in both has no row naming B's id.
    - **If instead** a row with B's id is still there: record the file name.

### Migrated links (dry run only)

18. **Dry run.** Desktop app, signed in to the cloud workspace, with a Local
    Server project that has at least one task link and one phase link (the
    project from step 15 after re-linking, or any project with arrows).
    Settings → `Storage` → the `Migrate to cloud` section → `DRY-RUN`.
    - **Expect:** the progress lines name each project with its counts, for
      example "2 phases, 3 tasks, 1 task link, 1 phase link", and the
      `Dry-run report` table has `task links` and `phase links` rows whose
      `Total` match the arrows you can see.
    - **If instead** the rows are missing or read 0 for a project that has
      arrows: record the project and the numbers.
19. **A real run is your call.** `MIGRATE` copies the project into the cloud
    workspace. If you do run it, open that project on the beta afterwards:
    the `Timeline` must show the same arrows the desktop had, and the
    `Migration report` `Inserted` counts for the two link rows must match the
    dry run's `Total`. Record the counts either way.

## Report (paste back)

```
Walkthrough 06 — timeline (A2 session 1) — date:
1 task arrows drawn: Y/N          2 phase arrow drawn: Y/N
3 phase editor warned, named Pre, Continue landed: Y/N
4 Go back kept the editor open and saved nothing / X counted as Continue: Y/N Y/N
5 no warning once Pre was Completed: Y/N
6 inline dropdown warned: Y/N     7 task popup warned: Y/N
8 bulk: ONE summary, selection kept on Go back: Y/N
9 Board drag warned: Y/N          10 asset task rows warned: Y/N
11 omitted predecessor ignored / marking Omitted silent / Omitted→Approved warned: Y/N Y/N Y/N
12 any surface that changed a status with NO warning (screen + control):
13 re-wire: Keep old link left it, Replace link moved it: Y/N   Not saved text, if any:
14 same-bar / empty-space / click-to-remove unchanged: Y/N
15–16 desktop: stray arrow after delete + reload: Y/N
17 tasks.json / timeline.json clean of B's id: Y/N
18 dry run counts (task links / phase links) vs arrows seen:
19 real run done: Y/N   inserted counts:
Anything odd (exact text):
```
