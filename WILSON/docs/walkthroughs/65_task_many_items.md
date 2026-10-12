# 65 — A TASK ABOUT SEVERAL THINGS: THE TASK WINDOW'S ITEMS (R.A.B.B.I.T. → a project → Tasks → a task's window)

1. **A task can be about several assets, scenes, shots, levels and
   experiences** (your words of 2026-10-11). The task window opens on an
   **Items** table at the top of its left column, the scene window's Assets
   table in shape: one **+**, the rows grouped by kind with each one's status,
   and Move up, Move down and Remove at the row's end.
2. **The first of each kind is the task's main one**, marked *Main* where a
   kind holds more than one. Sums and grouped rows (the Budget, the Timeline,
   the Tasks table's groups) show a task once, under its main item. The
   windows and the counts of each asset, scene, shot, level and experience
   list every task about it.
3. **Removing a task's last item asks first**, Cancel focused. Any other
   remove is one click, and Ctrl+Z on the Timeline puts it back.
4. **Levels and experiences now reach the cloud.** Until now the cloud
   dropped a task's level and experience; they are items now, so the
   Timeline's and the Budget's by-level and by-experience groupings work on
   the cloud too.
5. **Every older screen sees what it saw.** Each task keeps its one asset,
   scene and shot, and the database (migration 0096), the desktop app and the
   test data keep each equal to the task's main item of that kind.

**What this is.** FX2, the second of the three fixes from your list of
2026-10-11 (`docs/sessions/briefs/po-fx2-task-multi-links.md`): migration
**0096** (a new table, `task_items`, one row per thing a task is about) and
its suite **99**; the cloud's, the desktop's and the test data's halves; the
task window's Items table; and every screen that lists "the tasks about this"
reading the items. The "let me know if there is an issue here" you asked for
is the hand-off's first section: two issues measured (the brief's table name
was taken; the cloud never had a task's level or experience) and every reader
of a task's link with its pick. The picks are the numbered questions in its
"Waiting on Audrey".

Written 2026-10-12 against `feat/post-overhaul-edit-versioning` (FX2,
`po/fx2-task-multi-links`). Migration 0096 is applied on **wilson-dev only**;
staging's commands are in the hand-off
(`docs/sessions/handoffs/po-fx2-2026-10-11.md`, "Waiting on Audrey") and in
the Desktop kit's `00_HOW_TO_APPLY.md`, after 0095.

## 1. Step by step

**A. The task window** (the development copy on port 5291, `/rabbit`, the
test data: **Salt Hours → Tasks**)

| # | Do | You should see |
|---|----|----------------|
| 1 | Hover **Glass and rain rig test** and click its **View task details** | The window, with **Items (4)** at the top of its left column (`po-fx2-01`): *Assets*: Lighthouse Interior, marked **Main**, and Sea Spray Comp; *Scenes*: The storm; *Shots*: The storm › Rain on the glass. Each row carries the kind's icon, the status dot, the name and the status word. Under the table, the files of the main asset and the main shot, as before. On the right, *Placement* keeps only **Phase**: the asset, scene, shot, level and experience selects are gone. |
| 2 | Hover **Sea Spray Comp** | At the row's end: **Move up**, **Move down** (greyed: it is the last asset) and **Remove** (`po-fx2-02`). The status words do not move: every row keeps the same slot for these buttons. |
| 3 | Click **+** (*Add an item*) at the table's head | The picker opens over the left column (`po-fx2-03`): *Add an item*, one search (*Search assets, scenes, shots…*), then *Assets (13)*, *Scenes (5)* and *Shots*: everything in the project the task does not already name. |
| 4 | Type **boat** | Every kind narrows at once (`po-fx2-04`): *Father's boat* under Scenes, its two shots under Shots. |
| 5 | Click **Father's boat**, then the picker's **×** | **Items (5)**. *Scenes* holds The storm, marked **Main**, then Father's boat (`po-fx2-05`). The task's scene is still The storm everywhere a sum or a grouped row reads it. |
| 6 | Hover **The storm** and click **Move The storm down** | Father's boat is first and **Main** (`po-fx2-06`). The Budget's *By scene* now adds the task's money under Father's boat, once. (The Timeline's *Group by scene* keeps it under its shot, The storm › Rain on the glass: see §4.) |
| 7 | **Done**; open **Weather cover plan** | *Assets*: Cliff Path; *Scenes*: Cliff path (**Main**), then Salt hours; no shot. |
| 8 | Hover **Salt hours**, click **Move Salt hours up**, **Done**; then **Timeline** and **Group by scene** (the film icon) | Weather cover plan's row is under **Salt hours** (it was under Cliff path). |
| 9 | **Scenes** tab: open **The storm** | *Tasks (2)*: Glass and rain rig test and Spray comp, sc 04 sh 010–030 (`po-fx2-08`). Glass and rain rig test is still listed: The storm is still one of its items. **Father's boat**'s window lists it too. |
| 10 | **Tasks**: open **Final mix**; hover **Score & Foley**, click **Remove** | *Remove the last item* asks first, **Cancel** focused (`po-fx2-07`): *Remove "Score & Foley"? It is this task's only item: the Timeline and the Budget will show the task under no asset, scene or shot until you add one.* **Cancel** keeps it. |
| 11 | Open **Glass and rain rig test**, remove **Sea Spray Comp**, **Done**; then **Timeline** and **Ctrl+Z** | Sea Spray Comp is back (open the task again: **Items (5)**). Each add, remove and move is one step of undo. Ctrl+Z inside the task window on the Tasks tab does nothing, as for every task edit there today. |

**B. A game project** (`/rabbit?fixtures=game`: the same project with levels
and experiences turned on)

| # | Do | You should see |
|---|----|----------------|
| 12 | **Salt Hours → Tasks**, open **Practical lamp rig** | *Assets*: Lighthouse Interior; *Levels*: Lamp Room; *Experiences*: First Light (`po-fx2-09`). |
| 13 | Click **+** | The search reads *Search assets, scenes, shots, levels, experiences…*, and the picker has five groups (`po-fx2-10`). |
| 14 | **Timeline**, **Group by level**, then **Group by experience** | Practical lamp rig is under Lamp Room, then under First Light. The test data always kept a task's level; on the cloud this grouping put every task under *No level* until 0096. |

**C. On the desktop app** (the Local Server; the same window)

| # | Do | You should see |
|---|----|----------------|
| 15 | Open a desktop project's task that has an asset | *Items (1)*: that asset. The desktop gives every task its items the first time it reads the project (each task's asset, scene, shot, level and experience), with the same rules as the cloud. |
| 16 | Add a second asset, quit the app and open it again | The two assets, in the same order. |

**D. On the real cloud** (wilson-dev; the beta signed in, when you choose)

| # | Do | You should see |
|---|----|----------------|
| 17 | Open any task that had an asset | *Items (1)*: that asset (dev has 21 such tasks, now 21 items). |
| 18 | Add a scene to it in one browser, with the same project open in a second | The second browser shows the new item within a moment, without a reload (the table is on the project's live channel). |
| 19 | As a project's reviewer, open a task | The **+**, the moves and the removes are greyed with the reason; nothing can be written (suite 99 refuses a reviewer's writes at the database too). |

## 2. How to check it

- The tests: `npx vitest run src/tools/rabbit_v0.1.0/state/taskItemsModel.test.js src/tools/rabbit_v0.1.0/state/taskItemsParity.test.js src/tools/rabbit_v0.1.0/state/rabbitTaskItems.routes.test.js src/tools/rabbit_v0.1.0/state/taskItemsProvider.test.jsx src/tools/rabbit_v0.1.0/state/taskItemsRealtime.test.js src/tools/rabbit_v0.1.0/adapters/taskItemsCloud.test.js src/tools/rabbit_v0.1.0/components/taskItemsTable.test.jsx src/cloud/migrate/runMigration.test.js src/dev` — the rules (`taskItemsModel`), the desktop copy of the rules against the web's (`taskItemsParity`), the Local Server's routes and hooks over a bundle (`rabbitTaskItems.routes`), the provider's verbs with undo and the single links as item writes (`taskItemsProvider`), the live channel (`taskItemsRealtime`), the cloud adapter and a database without 0096 (`taskItemsCloud`), the window (`taskItemsTable`), a desktop project moved to the cloud carrying its items (`runMigration`), and the test data.
- The database: suite 99 (`supabase/tests/rls/99_task_items.sql`, 97 probes) runs on every push in CI's pgTAP job after 0096; suite 72 now names sixteen tables on the live channel.
- The development copy: the `fx2-worktree` launch entry, port 5291; `node scripts/task-items-shots.mjs 5291 --out <dir> [--size 1280x700]` walks §1 A and B (steps 1–6, 9, 10, 12, 13) and photographs them.

## 3. What was rehearsed, and how

- **0096 and suite 99 against wilson-dev's real data, rolled back**
  (`scripts/tap-hosted.py`): 97 of 97. Then every suite with 0096 put in
  front of it: 93 of 94 clean; suite 74 fails the same way without 0096 (it
  counts dev's real sign-ins).
- **Applied to wilson-dev** (`supabase db query --linked --file`, then its
  history row): the history reads … 0093 0095 0096; 21 items for the 21
  tasks with an asset; the table's four policies and its triggers are in
  place; suites 11, 17, 20, 72, 92, 94, 95 and 99 pass against the applied
  database.
- **The window, §1 A and B**, in Playwright's Chromium at 1440x900 and
  1280x700 on the test data (`scripts/task-items-shots.mjs`; the pictures are
  `docs/sessions/handoffs/img/po-fx2-01` to `-10`, at both sizes). Steps 7–8
  (the Timeline following a main scene), 11 (undo) and 14 (the game data's
  groupings) were driven by scripts on the same data and read back.
- **The desktop app was not opened.** Its routes and the hooks its generic
  task, scene, shot, level and experience routes call were driven over a
  project's bundle in tests (`rabbitTaskItems.routes.test.js`, with the real
  module and the real route function lifted out of `electron/main.cjs`), and
  its copy of the rules is checked against the web's
  (`taskItemsParity.test.js`). §1 C is yours.
- **Signed in as a person on wilson-dev**: not in a browser (the smoke
  users' password is a GitHub secret). Suite 99 signs in as a manager, a
  member, a reviewer, a member of another workspace and a person outside a
  private project, and as nobody. §1 D is yours.

## 4. Still not right, and not this session's to change

- **The Timeline's *Group by scene* puts a task that has a shot under that
  shot**, inside the shot's scene, whatever the task's own scene (as before
  FX2). When a task's main scene and its main shot's scene differ, the
  Timeline and the Budget's *By scene* place it differently (§1 step 6).
- **On the desktop, deleting an asset keeps its tasks** (as before FX2; the
  cloud deletes them): the asset leaves their items and each takes its next
  asset as main.
- **The Scenes table's asset count is always 0**: it reads a field assets do
  not have. Found in passing; it is in `docs/OUTSTANDING.md`.
- **The Dashboard's task window shows no items**: it has no project open
  behind it. It shows the main asset, read-only, as before.
- **The tasks CSV names no asset, scene, shot or item** (as before; the
  hand-off's question 9).
- **A bid version keeps each task's main items only.** Opening an older
  version makes its saved main items the main ones again and removes nothing.
- **Templates name no items** (they never named an asset): a template
  applied to an asset gives each of its tasks that one asset.
- **The edit history** shows a change of main item as the task's asset,
  scene or shot changing; adding or removing a second item writes no line.

## 5. Questions, when you test

1. **The *Main* badge shows only where a kind holds more than one** (one
   asset alone is plainly the main one). Would you rather see it on every
   first row?
2. **Only the last item's remove asks first.** Removing the main asset moves
   the task to its next asset in the Timeline and the Budget without asking
   (Ctrl+Z on the Timeline puts it back). Should that ask too?
3. **The picker offers the active shot list's scenes and shots**, with *Show
   all lists* for the rest, as the window's old selects did. Right?
4. **The files under the table follow the main asset and the main shot**, as
   before. Would you want a files section per item instead?
