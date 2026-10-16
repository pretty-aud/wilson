# 74 — A TASK'S ITEMS ARE ITS ITEMS: NO MAIN ITEM (R.A.B.B.I.T. → a project → Tasks, Timeline, Budget, a task's window)

1. **There is no main asset any more** (your words of 2026-10-16: *"lets not
   have main asset be a thing. thats not needed and i dont like."*). A task's
   assets, scenes, shots, levels and experiences are all equal: no *Main*
   badge, no *Move up* / *Move down*, nothing that counts one of them for more.
2. **The Timeline groups by combination.** Grouped by asset (or scene, shot,
   level, experience), a task about two assets sits once, in a row named for
   both (*Lighthouse Interior, Sea Spray Comp*), after the single rows; *No
   asset* is last. There is no *Create grouping* button on the Timeline, as
   you asked. The Tasks table and the Board group the same way.
3. **The Budget splits.** *By asset*, *By scene*, *By shot* (and *By level*,
   *By experience*, and the Custom tab's groups) give each of a task's items
   an even share of its days and money: half each for two. Every report adds
   up exactly to the project's total, and *By asset* has a *No asset* row.
4. **Deleting an asset never deletes a task.** The asset comes off its tasks;
   the tasks stay. While the asset is in the trash it is hidden from its
   tasks, and restoring it puts it back (your answer to Q-N4).
5. **The task's window** has a **Sort** for its items (*Type*, *A to Z*,
   *Date added*: your Q-N1) and a **Files section for each item** (Q-N2); a
   file added in a section is filed in that item's folder (Q-N3).
6. **A task's phase is its own**, everywhere. The Budget's *By phase* used to
   take a task's phase from its first asset; it now reads the task's own, as
   the Timeline always did.

**What this is.** VW1m, the first session of the custom views' build
(`docs/sessions/briefs/po-vw1m-no-main-item.md`): every place WILSON read a
task's main item, measured first (289 places: the hand-off's item 1), your
answers to batch 14, then the change everywhere: migration **0097** and its
suite **100**, the cloud's, the desktop's and the test data's halves, the
Timeline, the Budget, the task window, the Tasks table and Board, the
Dashboard, bid versions and the help. You went to bed before batches 15 and
16; their answers are built to the interim choices (§4), each cheap to
change.

Written 2026-10-16 against `feat/post-overhaul-edit-versioning` (VW1m,
`po/vw1m-no-main-item`). Migration 0097 is applied on **wilson-dev only**;
staging's commands are in the hand-off
(`docs/sessions/handoffs/po-vw1m-2026-10-16.md`, "Waiting on Audrey") and in
the Desktop kit's `00_HOW_TO_APPLY.md`, after 0096.

## 1. Step by step

**A. The task's window** (the development copy on port 5298, the
`vw1m-worktree` entry; `/rabbit`, the test data: **Salt Hours → Tasks**)

| # | Do | You should see |
|---|----|----------------|
| 1 | Hover **Glass and rain rig test** and click its **View task details** | **Items (4)** (`po-vw1m-01-task-window`): *Assets*: Lighthouse Interior and Sea Spray Comp, with no *Main* on either; *Scenes*: The storm; *Shots*: The storm › Rain on the glass. Hovering a row shows only **Remove**. Under the table, one folding **Files** section per item: *Asset: Lighthouse Interior* open, then *Asset: Sea Spray Comp*, *Scene: The storm* and *Shot: The storm › Rain on the glass*, closed. |
| 2 | Open **Scene: The storm** | Its own file, *SC04_lighting_plan.pdf* (the scene's and the shot's sections used to list nothing). |
| 3 | Click the **Sort** button (the up-and-down arrows) in the Items head | *Sort items by*: **Type** (ticked), **A to Z**, **Date added** (`po-vw1m-02-sort-menu`). |
| 4 | Choose **A to Z** | One list, no kind headings, each row keeping its kind's icon (`po-vw1m-02b-sort-a-to-z`); the Files sections follow the same order. **Date added** lists them in the order they were linked to the task (`-02c`). Close the window and open it again: the sort you chose is kept on this computer. |
| 5 | Click **+**, add **Lamp Room** | It joins the list in the sort's place; no item is ever "first". |

**B. The Tasks table and the Board** (**Tasks**)

| # | Do | You should see |
|---|----|----------------|
| 6 | **Group: Asset** | One group per single asset in the Assets tab's order, then **Lighthouse Interior, Sea Spray Comp (1)** holding Glass and rain rig test, and *No asset* last when a task has none (`po-vw1m-03-tasks-by-asset`, `-03b`, `-03c`). Each task is in exactly one group, and the counts add up to the tasks. |
| 7 | The **Asset** cell of Glass and rain rig test | Both names, *Lighthouse Interior, Sea Spray Comp* (cut short with the list on hover). Clicking it opens the task's window. |
| 8 | Drag **Wall texture pass** into the **Lighthouse Interior, Sea Spray Comp** group | It moves there: its assets are now exactly those two (your Q-D1). The **Undo** in the toast puts its asset back. |
| 9 | **Board**, grouped by Asset | A column for every single asset (even empty ones), the **Lighthouse Interior, Sea Spray Comp** column, *No asset* (`po-vw1m-04-board-by-asset`, `-04b`). The card names both assets. |
| 10 | **Filter: Asset is Sea Spray Comp** | Every task that has Sea Spray Comp, including Glass and rain rig test. |

**C. The Timeline** (**Timeline**)

| # | Do | You should see |
|---|----|----------------|
| 11 | **Group by asset** (the boxes icon) | Every asset's own row with its bar, as before; then **Lighthouse Interior, Sea Spray Comp**, with no bar, holding Glass and rain rig test once (`po-vw1m-05-timeline-by-asset`); *No asset* last (`-05c`). Clicking the combined row's header opens nothing. |
| 12 | Drag a task's bar from one asset's row onto another's | The task's assets become that row's (Ctrl+Z on the Timeline puts them back). Dropping it on the combined row gives it both. |
| 13 | **+ New task** under **Lighthouse Interior**'s row | The new task starts on Lighthouse Interior (it used to start on the project's first asset and first phase, whichever row you clicked). |
| 14 | `/rabbit?fixtures=game`, **Group by level** | Harbour Approach, Lamp Room, Café at Dusk and Cliff Path each with their bars; **Cliff Path, Lamp Room** holding Glass and rain rig test; *No level* last (`po-vw1m-07-timeline-by-level-game`). |

**D. The Budget** (**Budget**)

| # | Do | You should see |
|---|----|----------------|
| 15 | **By asset** | Glass and rain rig test's 2 days and $1,680 split in half: *Lighthouse Interior* 20.0 days / $14,076, *Sea Spray Comp* 15.0 / $12,600 (`po-vw1m-06-budget-by-asset`). Every row adds up exactly to the Summary's 125.5 bid days and $92,172. |
| 16 | **By phase** | Each task under its own phase (`-06b`); the rows add up. |
| 17 | Take **Final mix**'s only asset off, then **By asset** again | A **No asset** row with its 5.0 days / $3,000 (`-06c`), and the rows still add up. |

**E. Deleting an asset**

| # | Do | You should see |
|---|----|----------------|
| 18 | **Assets**: delete **Sea Spray Comp** | The toast says *Its tasks stay.* Its three tasks stay on the Tasks tab, the Timeline and the Budget; Glass and rain rig test now shows Lighthouse Interior only. |
| 19 | The toast's **Undo** (or, on the cloud, restore it from the trash) | Sea Spray Comp is back on its tasks. |

**F. Elsewhere**

- **The Dashboard** names every asset of a task (*A, B*), and its *Phase*
  grouping reads each task's own phase. None of the test data's tester's
  tasks has two assets, so the test data cannot show the two names
  (`po-vw1m-08-dashboard`).
- **The desktop app signed out** already kept a task when its asset was
  deleted; it now keeps the screen in step too (the tasks no longer vanish
  until the next read).
- **A bid version** now keeps each task's items; one saved before today keeps
  working (opening it puts back what it remembers and takes nothing away).

## 2. What changed, place by place

| Place | Before | Now |
|---|---|---|
| Task window | *Main* badge; Move up / Move down; the first asset's files | No *Main*, no Move; a Sort (Type, A to Z, Date added); a Files section per item |
| Timeline grouped by an item | a task under its first item | one row per combination, after the single rows; no *Create grouping* |
| Tasks table and Board grouped by asset | a task under its first asset; a drop swapped the first asset | one group per combination; a drop gives the task that group's assets |
| Budget By asset / scene / shot / level / experience | the whole task under its first item | an even split; *No asset* row; rows add up exactly |
| Budget By phase | the first asset's phase | the task's own phase |
| Deleting an asset (cloud) | its tasks deleted, and hidden while it was in the trash | the tasks stay; the asset is hidden from them while in the trash |
| Older WILSON builds setting one asset | replaced the task's first asset | adds that asset; never removes one |
| A bid version | kept each task's first item only | keeps every item |
| Task history | *asset_id: … → …* when the first asset changed | no asset, scene or shot lines (your answer to Q-N8 decides what replaces them) |

## 3. Known limits

- **The Budget's split shows fractions of a day** where a task has several
  items (as your answer said).
- **The Dashboard updates a task's assets on the next load**, not the moment
  a teammate adds a second asset (the live channel it listens to carries
  tasks, not their items).
- **The sort is kept per computer**; on the desktop app the browser storage
  it uses most likely starts empty at every launch (an existing entry in
  `docs/OUTSTANDING.md`).
- **The help** says how the Timeline and the Budget show a task with several
  items; the custom views (VW1b onward) will add the rest.

## 4. Questions for you (not yet asked: you went to bed)

Each is built to its interim choice until you answer
(`docs/design/CUSTOM_VIEWS_QUESTIONS.md`, batches 15 and 16):

1. **Q-N1a.** Sorting a task's items by date: when it was added to the task
   *(interim)*, or when the item itself was made?
2. **Q-N1b.** Sorting by type: by kind (assets, scenes, shots…) *(interim)*,
   or by the asset's own type (Character, Prop…)?
3. **Q-N5.** The Tasks table's Asset cell until VW1b's tick-list: names every
   asset and opens the window *(interim)*; or makes the chosen asset the only
   one; or adds it?
4. **Q-N6.** The Dashboard: every asset *(interim)*, or no asset column?
5. **Q-N7.** A bid version keeps every item *(interim)*, or none?
6. **Q-N8.** A task's history: record each item added and removed, in words
   (a database change), or no history of items *(interim)*?
