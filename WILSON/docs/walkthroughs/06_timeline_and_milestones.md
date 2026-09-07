# Walkthrough 06 — the timeline: dependency warnings, the re-wire confirm, ghost links, migrated links

**What this checks.** Track A bundle A2, session 1 (`cc1f55e`, `b104e50`,
`643b5ca`, with the review corrections `327cd37`, `4c645f7` and `564f02c`;
2026-09-06). Four things, all around dependencies:

1. **Phase 7** — marking a task or phase *done* while something it depends on
   is not done now shows a warning that names the unfinished dependencies and
   lets you continue. It never blocks, and it fires on every place a task or
   phase status is written (your rulings 9 and the 2026-08-12 "warn dont
   block. do both phases and tasks"). ⚠️ **Changed on 2026-09-07, by your
   ruling:** `Continue anyway` is now the ONLY thing that saves. The X and a
   click outside the warning both CANCEL, the same as `Go back`. Session 1
   shipped the opposite and step 4 below is rewritten for it.
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
4. **Only `Continue anyway` saves. Every other way out cancels.**
   ⚠️ **This is the behaviour you changed on 2026-09-07, and it is the
   REVERSE of what the build you tested in September did.** If you already ran
   this step once, the answer you got then was the old one; run it again.
   Three closings, all of which must leave the change unsaved.
   Open Prod's editor again, set `Status` back to `Active`, `Save` (no warning
   — Active is not a done status). Then:
   - **a. `Go back`.** Set `Status` to `Completed`, `Save`, and click
     `Go back`.
     **Expect:** the warning closes, the editor is still open with Completed
     still showing, and nothing was saved — close the editor and reopen it:
     Active.
   - **b. The X.** `Save` again and close the warning with the small **X** in
     its top-right corner instead of choosing a button.
     **Expect:** nothing is saved. Reopen the editor: still Active.
   - **c. Outside the card.** `Save` again and click the dark area **outside**
     the warning panel.
     **Expect:** nothing is saved. Reopen the editor: still Active.
   - The warning says so on screen; the last line inside it reads
     `A warning, not a block — but only Continue anyway saves it. Closing this
     leaves the change unsaved.`
   - Leave Prod on `Active` so step 5 starts clean.
   - **If instead** any of a, b or c left Prod on Completed: record WHICH one.
     They are three different code paths and only one of them may have been
     missed.
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
4a Go back saved nothing / 4b the X saved nothing / 4c click-outside saved nothing: Y/N Y/N Y/N
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

---

# Part 2 — milestones (key dates): cloud, trash and undo

**What this checks.** Track A bundle A2, **session 2** (`4f65d63`, `d5baa0b`;
2026-09-07), your rulings 26 (*build cloud milestones*) and 38 (*trash and
undo for milestones*). Three things:

5. **Key dates exist in the cloud at all.** They were desktop-only: on the
   beta, creating one raised "milestones table not yet created" and the
   timeline drew none. Migration `0067` built the table; it is applied on dev
   and staging, so the beta has it.
6. **Deleting a key date is undoable.** A toast appears with `Undo`, the way
   deleting an asset or a phase already does.
7. **Recently deleted.** A deleted key date goes to a list you can restore it
   from later — on the beta *and* on the desktop.

In the app a milestone is called a **key date**: the toolbar button is
`Key Date` and the deleted list is `Recently deleted key dates`.

**Where and who.** The same throwaway project as Part 1.

- **The beta**, signed in as a member who can write. Steps 20–27.
- **The desktop app on Local Server.** Steps 28–31.
- **Optional, needs a second account:** step 32.

## Steps

### On the beta

20. **Create one.** `Timeline` tab. In the toolbar between the minimap and the
    Gantt, press `Key Date`. Fill in a title ("Lock picture"), pick a date
    inside the project's range, leave `Phase` empty, and save.
    - **Expect:** it saves with no error, and a diamond appears on the
      timeline at that date, in both the minimap and the detail pane.
    - **If instead** you see a message about a table not existing, or the save
      spins and nothing appears: copy the exact text. That would mean 0067 is
      not on staging and everything below will fail the same way.
21. **A key date with no phase is a real one.** Reload the page. The diamond
    from step 20 must still be there.
    - This is the single most important check in Part 2. The database rule
      that decides whether a key date is visible deliberately looks at the
      PROJECT and never at the phase, because you are allowed to leave `Phase`
      empty. If that were wrong, the save would appear to succeed and the key
      date would vanish on reload with no error anywhere.
22. **A key date ON a phase.** Create a second one ("Delivery"), and this time
    choose a phase in the `Phase` field. Save, reload, confirm it is still
    there.
23. **Edit it.** Click the "Delivery" diamond, change its title and colour,
    save, reload.
    - **Expect:** both changes stuck.
    - **If instead** the edit appears to save and reverts on reload: that is
      the failure worth reporting in full — which field, and what it reverted
      to.
24. **Delete, then Undo.** Delete "Delivery".
    - **Expect:** a toast at the bottom saying "Deleted key date" and the
      title in quotes, with an `Undo` control. Press `Undo`.
    - **Expect:** the diamond comes back, in the same place, with the title
      and colour from step 23. Reload and confirm it is still back.
24b. **Then Redo, and then Undo a CREATE.** This one matters more than it
    looks: it is the gesture that was broken and is now fixed.
    - With "Delivery" restored by step 24, press the redo arrow in the same
      toolbar. **Expect:** it disappears again.
    - Now make a NEW key date ("Scratch"), press Undo, then press Redo, then
      Undo once more. **Expect:** it toggles away and back cleanly every time,
      and after the final Undo it is gone.
    - **Then open `Deleted`.** **Expect:** "Scratch" is NOT in the list. Undoing
      something you just created is not the same as deleting it, and it should
      leave no trace.
    - **If instead** Redo does nothing at all, or "Scratch" appears in the
      deleted list: record which, exactly.

25. **Delete, then leave it.** Delete "Delivery" again and let the toast go
    (or dismiss it). The diamond stays gone.
26. **Recently deleted.** Press `Deleted` in the same toolbar.
    - **Expect:** a panel titled `Recently deleted key dates` listing
      "Delivery", with the date you deleted it and a line saying when it is
      removed for good. Press `Restore`.
    - **Expect:** the panel updates, the diamond returns to the timeline, and
      it survives a reload.
    - **If instead** the panel is empty, or says it could not read the list:
      copy the exact text. An empty list and a failed read are different
      answers and the panel is written to distinguish them.
27. **A reviewer cannot restore.** *Only if you have a second account on the
    project as a reviewer.* Sign in as that account, open the same project's
    `Timeline`, press `Deleted`.
    - **Expect:** the list is readable, and `Restore` is refused with the same
      "you do not have permission" style message the other write controls
      give — not a raw database error.

27b. **The Tasks tab has key dates too.** Open the `Tasks` tab. Key dates
    appear as their own rows among the tasks. Delete one from there.
    - **Expect:** it goes straight away with the same undo toast, and NO
      "are you sure" dialog. That dialog used to stand in for the missing undo
      path and was removed when the undo path arrived.
    - **Expect:** `Undo` on the toast brings it back.
    - **Now restore it without leaving this tab.** ⚠️ **New on 2026-09-07:**
      you asked for the Recently Deleted panel on the Tasks tab as well as the
      Timeline, and the toolbar here now has its own button. It is labelled
      `Deleted Key Dates`, not the Timeline's bare `Deleted` — this screen is
      about tasks, and "Deleted" alone would read as a list of deleted tasks,
      which is not a thing the product has. Press it and press `Restore`.
    - **Expect:** the same `Recently deleted key dates` panel, the same list
      the Timeline shows, and the row returns to BOTH tabs.
    - **If instead** the button is missing, or the panel is empty while the
      Timeline's shows the same key date: record which.
    - **If instead** you still get a confirmation dialog: record it.

### On the desktop (Local Server)

28. **Create one.** Settings → `Storage` → `Storage Backend` → `Local Server`.
    Open the same kind of project, `Timeline`, `Key Date`, save one.
29. **Delete and Undo.** Delete it and press `Undo` on the toast. It comes
    back. **Close the app and reopen it**, then check it is still there — the
    desktop writes to disk, so a reload is not the same test as a restart.
30. **Recently deleted on the desktop.** Delete it again, press `Deleted`,
    and `Restore` it from the panel. Restart the app and confirm it stayed.
    - **Expect:** the panel does NOT show a "removed for good in N days"
      countdown here. Nothing purges on Local Server, so promising a deadline
      would be a lie. If you DO see a countdown on the desktop, say so.
30b. **The Tasks tab's own button, on the desktop.** Still on Local Server,
    open the `Tasks` tab, delete a key date from its row, then press
    `Deleted Key Dates` in that toolbar and `Restore` it.
    - **Expect:** the same list the Timeline's `Deleted` shows, the row comes
      back, and — as in step 30 — **no** "removed for good in N days"
      countdown, because nothing purges on Local Server.
    - **If instead** you see a countdown here but not on the Timeline (or the
      other way round): record which screen. The two panels are supposed to be
      the same panel.
31. **A deleted key date does not come back by itself.** Delete one, leave it
    deleted, restart the app.
    - **Expect:** it is still gone from the timeline, and still listed under
      `Deleted`.
    - **If instead** it reappears on the timeline: that is the bug this whole
      change exists to avoid — record it.

### Live sync between two windows — NEW, 2026-09-07 (migration 0077)

**What changed, and what deliberately did not.** Step 32 used to tell you that
key dates do NOT live-sync and that you would need to reload the second
window. You read that and asked for the sync. Migration `0077` puts key dates
on the same live channel tasks are already on, so a change in one window shows
up in the other on its own.

🚨 **Scenes, shots, levels and experiences deliberately did NOT get this.**
That was your explicit choice — key dates only — and it is written down as a
conscious difference rather than an oversight (the handbook, §4.5 and §13.3).
Step 34 checks that it stayed a difference.

**This needs two windows on the beta, side by side, both signed in and both
with the same project open.** Leave both open the whole time — the point is
that neither is reloaded.

32. **Add, move, delete, restore — all without a reload.** Both windows on
    `Timeline`.
    - **a.** In window A press `Key Date`, title it "Live", pick a date inside
      the project, save.
      **Expect:** the diamond appears in window B on its own, within a second
      or two.
    - **b.** In window A click the "Live" diamond, change its date, save.
      **Expect:** window B moves it on its own.
    - **c.** In window A delete "Live" and let the toast go.
      **Expect:** it disappears from window B on its own.
    - **d.** In window A press `Deleted`, then `Restore` on "Live".
      **Expect:** it comes back in window B on its own.
    - **If instead** any of the four needed a reload in window B: say WHICH,
      and confirm window B had been open the whole time and had not been left
      on another tab of the app.
33. **It lands in the right PLACE, not just on the screen.** Switch window B
    to the `Tasks` tab, where key dates are rows among the tasks. In window A
    create a key date dated EARLIER than every other key date in the project.
    - **Expect:** in window B it appears **in date order** — above the others,
      where a reload would have put it.
    - **If instead** it lands at the bottom of the key-date rows and only
      sorts itself once you reload: record it. That is a real defect and this
      step is the only place it shows.
34. **The difference you asked for is still there.** If the project has
    `Scenes` (or `Levels`, or `Experiences`) turned on, open that tab in both
    windows and add one in window A.
    - **Expect:** window B does **not** show it until you reload. That is
      correct, and it is your decision, not a bug.
    - **If you have changed your mind** and want those four to live-sync too,
      say so here — it is its own piece of work, not a tweak.

## Report — Part 2 (paste back)

```
Walkthrough 06 Part 2 — key dates (A2 session 2) — date:
20 created on the beta, diamond appeared: Y/N   exact error if not:
21 no-phase key date survived a reload: Y/N        <-- the important one
22 key date on a phase survived a reload: Y/N
23 edit stuck after reload: Y/N    if it reverted, which field:
24 delete toast appeared with Undo / Undo restored it / survived reload: Y/N Y/N Y/N
25 dismissed toast left it deleted: Y/N
26 Deleted panel listed it / Restore worked / survived reload: Y/N Y/N Y/N
    countdown line shown on the beta: Y/N
24b redo worked / undone CREATE left nothing in Deleted: Y/N Y/N
27 reviewer: list readable Y/N, Restore refused readably (not a raw error) Y/N
27b Tasks tab: deleted with no dialog / toast Undo worked: Y/N Y/N
27c Deleted Key Dates button present on Tasks / Restore from it worked: Y/N Y/N
28 desktop create: Y/N
29 desktop Undo survived an app RESTART: Y/N
30 desktop Restore survived a restart: Y/N   countdown shown (should be N): Y/N
30b desktop Tasks tab: Deleted Key Dates listed it / Restore worked / no countdown: Y/N Y/N Y/N
31 deleted key date stayed deleted after a restart: Y/N
32 live sync, NO reload -- a add / b date move / c delete / d restore: Y/N Y/N Y/N Y/N
33 the new key date landed in DATE ORDER on the Tasks tab: Y/N
34 scenes/levels still need a reload (should be Y): Y/N   changed your mind: Y/N
Anything odd (exact text):
```
