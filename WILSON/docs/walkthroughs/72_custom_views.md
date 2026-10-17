# 72 — CUSTOM TABLE VIEWS (R.A.B.B.I.T. → a project → Tasks, Levels, Experiences, Scenes)

This walkthrough grows with the build: **part 1 (VW1b)** is the Tasks table's
item columns and the counts; parts 2 to 4 (the views' data, the views on
Tasks, the other tables) are added by the sessions that build them, and the
last one completes it.

## Part 1 — every item in the Tasks table, and the counts (VW1b, 2026-10-17)

1. **The Tasks table shows all of a task's items** (your words of 2026-10-13:
   *"please make sure it either shows all or none. additionally, i can see the
   levels or scenes or shots related"*). Next to **Asset** there are now
   **Scene** and **Shot** columns, and **Level** and **Experience** on a
   project that uses them (your Q9, Q11). A cell names every item, as many as
   fit and then **+1**, **+2**: point at it for the whole list.
2. **Click a cell to tick several** (Q10). A small list opens under the cell:
   a search, then every asset of the project with a tick box; for scenes and
   shots, the active shot list's, with **Show all lists** for the rest. Two
   assets with the same name say their type and phase. The change is saved
   when the list closes, as **one** step: the undo toast takes it back.
3. **The order inside a cell is the task window's Sort**: *Type* (now your
   answer: the asset's own type, character before environment before prop),
   *A to Z*, or *Date created* (now your answer: when the item itself was
   made). Change it in any task's window and the table follows at once.
4. **Group by Scene, Shot, Level or Experience** as you could by Asset: one
   group per combination, *No scene* (or *No shot*, …) last. Dragging a task
   into a group gives it exactly that group's items.
5. **A wide table scrolls sideways**, and the tick box and the task's name
   stay where they are (Q6a). A film project's table is now wider than 1440,
   so at 1440 and 1280 it scrolls a little; the name keeps 216px.
6. **The counts are right.** A level's (or experience's) *Assets* column and
   its window's *Linked counts* line count the assets linked to it (they read
   0), and a scene window's *shots / assets / tasks* line counts its assets
   (it read 0 too).

**What this is.** VW1b, the second session of the custom views' build
(`docs/sessions/briefs/po-vw1b-custom-views-build.md`): first a review of the
design's parts it builds against what VW1m left (21 findings, corrected in
`docs/design/CUSTOM_VIEWS_DESIGN.md`), then the design's §7 steps 1 and 2. No
views yet (the *Views* button is still the old one), no database change.

Written 2026-10-17 against `feat/post-overhaul-edit-versioning` (VW1b,
`po/vw1b-custom-views-build`). Nothing to apply anywhere: it is all in the
app.

### 1. Step by step

**A. The cells** (the development copy on port 5298, the `vw1b-worktree`
entry; `/rabbit`, the test data: **Salt Hours → Tasks**, **Table**)

| # | Do | You should see |
|---|----|----------------|
| 1 | Look at the headers | *Title, Status, Priority,* **Asset, Scene, Shot,** *Phase, Assignee, Start, End, Bid* (`po-vw1b-after-01-tasks`). Before, *Asset* was the only one (`po-vw1b-before-01-tasks`). |
| 2 | Find **Glass and rain rig test** | **Asset**: *Lighthouse Int…* and a small **+1** (in a 150px column the first name and the count do not both fit, so the name is cut); point at it for *Lighthouse Interior, Sea Spray Comp*. **Scene**: *The storm*. **Shot**: *The storm › Rain on the glass*, cut short by the cell (`-02-two-assets`). A task with none reads **—**. |
| 3 | Scroll the table sideways (the bar under it, or Shift + the wheel) | Status, Priority and the rest slide under the task's name; the tick box and the name stay put, and nothing shows in the gap at the left edge (`-05-scrolled`). |

**B. The picker** (still Salt Hours → Tasks)

| # | Do | You should see |
|---|----|----------------|
| 4 | Click the **Asset** cell of Glass and rain rig test | A list under the cell (above it, when the cell is near the bottom), titled for the task; the search has the cursor; *Lighthouse Interior* and *Sea Spray Comp* are ticked (`-03-picker`). |
| 5 | Type **storm** | Only *Storm Lantern* is left. Clear the search. |
| 6 | Tick **Storm Lantern** | It is ticked, and the cell behind already says three names (nothing is saved yet). |
| 7 | Press **Esc** | The list closes; the undo toast says *Added "Storm Lantern" to "Glass and rain rig test"*. Click **Undo** in it: the task is back to two assets. |
| 8 | Open the list again, press **↓** | The keyboard moves into the list; **↑ ↓** move, **Space** ticks, **Tab** leaves to the next cell (and saves). |
| 9 | Open **Wardrobe fitting**'s Asset cell (its only item is *Mara*), untick *Mara* | *Remove the last item* asks first, over the list: **Cancel** keeps it ticked. |
| 10 | Open a **Scene** cell | The active shot list's scenes; turn on **Show all lists** to see the others. |

**C. The Sort, the groups and the Board**

| # | Do | You should see |
|---|----|----------------|
| 11 | Open **Glass and rain rig test**'s window (its page icon), click **Sort** in the Items head | *Type*, *A to Z*, **Date created** (it said *Date added*). Under *Type* the assets are in runs named by their type (*Assets · Environment*, *Assets · VFX*). Choose *Date created*, close the window: the Asset cell behind follows the same order. |
| 12 | **Group: Asset** | The single assets, then **Lighthouse Interior, Sea Spray Comp (1)**, then *No asset* (`-04-by-asset`). |
| 13 | **Group: Scene**, then **Shot** | The same, by scene and by shot. Drag a task onto *The storm*: it is about exactly that scene, and the toast can undo it. |
| 14 | **Board**, **Group: Shot** | A column for every shot of the active list (empty ones too, as the Board always shows), then *No shot*. |

**D. A game project** (`/rabbit?fixtures=game`, Salt Hours with levels and experiences)

| # | Do | You should see |
|---|----|----------------|
| 15 | **Tasks** | **Level** and **Experience** columns too (`-06-game`); Glass and rain rig test: *Cliff Path +1* and *The Storm*. Scroll sideways (`-07-game-scrolled`). |
| 16 | **Levels** | **Cliff Path**: *Assets* **2**, *Tasks* **1** (it read 0 assets). Open it: *Linked counts* reads **2 assets / 1 tasks**, matching *Assets (2)* beside it (`-08-levels`; before, `po-vw1b-before-08-levels`). |

**E. The scene window** (Salt Hours → **Scenes**)

| # | Do | You should see |
|---|----|----------------|
| 17 | Open **The storm**, link **Sea Spray Comp** in its *Assets* list | The *Shots / assets / tasks* line counts it: **3 / 1 / 2** (it stayed 3 / 0 / 2). |

**F. On the desktop app and the beta**, when you choose: the same steps on a
real project. The counts on the **cloud** need one more thing first (below).

### 2. What changed, place by place

| Where | Before | Now |
|-------|--------|-----|
| Tasks table | one *Asset* column, the names cut short, a click opened the task | a column per kind the project uses; names, "+N", a picker that ticks several, saved as one step |
| Tasks table, wide | fitted the window, or squeezed | scrolls sideways; tick box and name stay |
| Group menu (table and Board) | Asset among the item kinds | Asset, Scene, Shot, Level, Experience, where the project uses them |
| A task's window, Sort | *Date added*; *Type* by kind | *Date created*; *Type* by the asset's own type, the runs named |
| Levels, Experiences | *Assets* 0 | the assets linked to them |
| Scene window | assets 0 | the assets linked to the scene |

### 3. Known limits

- **On the cloud a level's or experience's Assets count is 0**: the cloud
  does not carry an asset's levels and experiences yet. The session that
  builds the other tables' views (VW1e) adds them.
- **A cell and its group's band can list the same items in two orders**: the
  cell follows the task window's Sort, the band always reads A to Z (scenes
  and shots by number).
- **A film project's table scrolls sideways at 1440**, with the name at 216px
  (it had 360). Hiding columns comes with the views (part 3).
- **A Board grouped by Scene or Shot shows every scene or shot of the active
  list**, empty ones too, until the views' *Hide empty groups*.
- **A scene, shot, level or experience a teammate has just made** shows in a
  task's cell at the next load (they are not on the live channel); until
  then the cell leaves it out.

### 4. Questions for you

1. **The order in a cell** follows the task window's Sort (your Q10), while
   the group's name reads A to Z. Keep it, or should cells always read A to
   Z like the group names?
2. **At 1440 a film project's table now scrolls a little sideways** (two more
   columns) and the task's name keeps 216px. Keep it until the views let you
   hide columns, or keep *All* narrower now?
