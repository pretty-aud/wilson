# 72 — CUSTOM TABLE VIEWS (R.A.B.B.I.T. → a project → Tasks, Levels, Experiences, Scenes)

This walkthrough grows with the build: **part 1 (VW1b)** is the Tasks table's
item columns and the counts; **part 2 (VW1c)** the views' data; **part 3
(VW1d)** the views on the Tasks table; part 4 (the other tables) is added by
the session that builds it, and completes it.

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

## Part 2 — where your views and groupings will be kept (VW1c, 2026-10-17)

**Nothing new on screen.** This part builds the place your saved views and
groupings live, on every kind of WILSON, so the next session (part 3) can put
the *Views* dropdown on the Tasks table. The *Views* button is still the old
one until then.

1. **A view** is a named, saved way of showing one table — Tasks, Assets,
   Scenes, Shots, Levels or Experiences — in one project: its filters, sorts,
   grouping, which fields show and in what order, and its layout. It is
   **shared with everyone on the project** (your Q1), and **anyone who can
   edit the project may save one; a reviewer never can** (Q2). Each table
   starts with *All* only, which is never stored (Q20).
2. **A save never writes over a teammate's newer save without asking**
   (Q-G3): every view carries a number that changes each time its settings
   are saved, and a *Save* writes only if the number is still the one your
   change started from. A rename or a new order does not change it.
3. **A grouping** made with *Create grouping* is **saved for the project**
   (Q-D2). Deleting an item for good (a scene, a shot, a level, an
   experience, or an asset when the bin is emptied) takes it out of the
   groupings that name it, and *Undo* puts it back. An asset in the trash
   stays in its groupings, which hide until you restore it (your Q-N4).
4. **The view you last used on each table** is remembered for you (Q4): with
   your own settings when you are signed in (your 300 most recent tables),
   and in the computer's own settings on the desktop without signing in.
5. **A teammate's saved view reaches an open table at once** on the cloud
   (Q3d). The desktop without signing in shows it at the next load.
6. **Moving a desktop project to the cloud carries its views and
   groupings**; groupings of levels or experiences stay behind (the move does
   not carry those yet), and its report counts them. **The company takeout**
   includes both.

**What this is.** VW1c, the third session of the custom views' build
(`docs/sessions/briefs/po-vw1c-custom-views-data.md`): first a review of the
design's data part against the code (19 findings, corrected in
`docs/design/CUSTOM_VIEWS_DESIGN.md`), then migration **0098** and its tests,
the desktop's and the test data's twins, Google Drive (no views there: it
will say *not on this server yet*), and the app's half, with nothing on screen
using it yet. Written 2026-10-17 against `feat/post-overhaul-edit-versioning`
(`po/vw1c-custom-views-data`).

### 1. Nothing to try in the app yet

Part 3 (VW1d) is the first you can click. Migration 0098 is on **dev**; the
beta's database (**staging**) needs it before the beta can save views (below).
Until then a WILSON on a database without it shows saved views as *not on
this server yet* and keeps working.

### 2. Known limits

- **The desktop without signing in has no roles** (anyone using it may save
  views) **and no live channel** (a teammate's save on a shared NAS project
  shows at the next load).
- **A grouping names at most 100 items**, and each must be in the project
  when it is made; **a view's settings are at most 32 KB**; a project's table
  holds at most **200 views and 500 groupings**.
- **A grouping hides while one of its items is in the trash**, and comes back
  when the item is restored.

### 3. Staging (yours, when the beta merges)

While linked to staging, right after 0097 (VW1m's lines in the Desktop kit),
before re-linking to dev. The files are in the Desktop kit
(`Post-overhaul\migrations-to-apply\`), whose `00_HOW_TO_APPLY.md` has the
same lines:

```
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0098_table_views.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0098.sql"
supabase db query --linked "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations where version >= '0090'"
supabase db query --linked "select (select count(*) from pg_policies where tablename in ('table_views', 'item_groupings')) as policies, (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.fn_realtime_broadcast()'::regprocedure) as broadcast_body, (select count(*) from information_schema.columns where table_name = 'user_settings' and column_name = 'table_view_last') as last_used_column"
```

The history should end `0097 0098`, `policies` should be `8`, `broadcast_body`
`e5abdcf2b8abce914416acb148144971` and `last_used_column` `1`. No Edge
Function changed.

### 4. Questions for you

None this time.

## Part 3 — your views on the Tasks table (VW1d, 2026-10-25)

1. **The Tasks toolbar's *Views* button names the view on screen** (your Q5,
   Q-A2: no *edited* word, no dot). It opens a list, right under the button:
   **All**, then the project's views, shared with everyone on the project
   (Q1), the one on screen ticked; then **This view**: *Filters*, *Sort*,
   *Group* and *Fields*, each with a short summary. Each opens its own card
   in the same place, with a ← back (Q5a, Q5b).
2. **Filter, Sort, Group, the Table / Board tabs and the cards change the
   view for the moment** (Q3). While the table differs from the view as
   saved, a slim bar under the toolbar says *Shoot week: changed for now*
   with **Reset**, **Save as new view** and **Save** (Q3a, Q3c, Q-A3); on
   *All*, which cannot change, *Save as new view* only. A change lasts while
   WILSON is open, across tabs (Q3b); choosing another view drops it without
   asking (Q-H).
3. **A filter can match several values** (Q13): *Status is In progress,
   Pending review*, ticked in a small list. A new filter row filters nothing
   until it has a value, and *Filter (1)* counts only rows that filter; a
   row's condition and value reset when its field changes (the two defects
   you said to fix, Q21). **Several sorts, in order** (Q14): the toolbar's
   Sort sets the first, the Sort card holds the rest; drag a sort by its
   handle to change their order. A filter or a sort written by another
   WILSON that this table cannot apply says so, *(cannot filter)* or *(not
   in this table)*, and does nothing.
4. **Fields** (Q6, Q7): hide any column but *Title*, or move it by its
   handle (drag it, or its ↑ and ↓); turn the key dates' rows off with
   **Show key dates**. On the **Board** the same
   card chooses what a card shows (Q-E): Status, Priority, Asset, Assignee,
   Start, Bid.
5. **Group** (Q15, Q-I): **Hide empty groups**, starting as today (off for
   Status and on the Board, on for the rest).
6. **New view** (Q-G1) is saved for everyone at once, starting as *All*;
   each view's **…** has Edit, Rename, Duplicate and Delete (which asks
   first); drag a view by its handle, or use *Move up* / *Move down*, to
   reorder them for everyone (Q5c). A view saved by a newer WILSON shows
   as much as this one can: change it and the bar adds *This view was made
   by a newer WILSON.*, with *Save* greyed, and its *Duplicate* is greyed
   too, so nothing that WILSON added is lost.
7. **Each table opens on the view you last used there** (Q4).
8. **A teammate's save reaches you at once** (Q3d); if you have a change of
   your own, it stays on screen and the bar says who saved; **Save** then
   asks before writing yours over theirs (Q-G3).
9. **The toolbar's Phase, Key date and New task are one *New* button** with
   a menu (Q-A1); **Create grouping** appears beside the Group menu while
   the table is grouped by Asset, Scene, Shot, Level or Experience (Q-D3).
   A grouping is saved for the project (Q-D2) and shows even while empty, to
   drag tasks into; remove it from its group's **…** (Q-D5). The Timeline
   grouped by asset, scene, level or experience shows the groupings too,
   with no Create grouping there (Q-D4).
10. **The views your browser kept for the Tasks table before are gone**
    (Q17, *Start fresh*). The other tables' old views stay until their part.

**What this is.** VW1d, the fourth session of the custom views' build
(`docs/sessions/briefs/po-vw1d-custom-views-tasks.md`): first a review of the
design's screen parts against the code (18 findings, corrected in
`docs/design/CUSTOM_VIEWS_DESIGN.md`), then the views on the Tasks table, the
design's §7 step 4, then two code reviews (16 findings on use and the
keyboard, 12 on what a view's filters can hold), each correction proven by a
test that fails without it. No database change: it uses part 2's. Assets, Levels,
Experiences, Scenes and Shots get theirs in part 4 (VW1e).

Written 2026-10-25 against `feat/post-overhaul-edit-versioning` (VW1d,
`po/vw1d-custom-views-tasks`). Nothing to apply anywhere.

### 1. Step by step

**A. The toolbar and the list** (the development copy on port 5298, the
`vw1d-worktree` entry; `/rabbit`, the test data: **Salt Hours → Tasks**)

| # | Do | You should see |
|---|----|----------------|
| 1 | Look at the toolbar | *Filter, Sort, Group, Table / Board*, the **All** button, the search; on the right the count, *Export*, *Deleted key dates* and one orange **New** (`po-vw1d-01-rest`). |
| 2 | Click **New** | *Task*, *Phase*, *Key date* (`-02-new-menu`). Each does what its button did. |
| 3 | Click **All**, then **New view**, type **Shoot week**, press **Enter** | The button now reads *Shoot week*; the list shows it ticked under *All*; the undo toast says *Shoot week saved for everyone* (`-03-dropdown`). |
| 4 | Click **Filters**, then **Add filter**; leave its value empty | The card widens; nothing in the table changes and no bar appears (an empty row filters nothing). |
| 5 | Choose **Status**, click **Choose…**, tick **In progress** and **Pending review** | The table shows only those; the bar appears: *Shoot week: changed for now* (`-04-filters`, `-05-bar`). |
| 6 | Press **Esc** three times | The tick list closes, then the card goes back to the list, then the list closes; the keyboard is on the Views button. |
| 7 | Click **Save** in the bar | The bar goes; the toast says *Shoot week saved* (its Undo takes it back). |
| 8 | Click **All** in the list, then **Shoot week** again | All 42 tasks, then the filtered ones again. Go to Timeline and back: still *Shoot week*. |

**B. Sort, Group, Fields** (still Salt Hours → Tasks)

| # | Do | You should see |
|---|----|----------------|
| 9 | Toolbar **Sort: Phase**; then the list → **Sort** → **Add sort** → **Start date** | The summary reads *Phase, then Start*. |
| 10 | **Group: Status**, then the list → **Group** → **Hide empty groups** | Nine status groups, then only the ones with tasks. |
| 11 | The list → **Fields**, turn off **Show Priority**, then **Show key dates** | The Priority column goes; the key dates' rows go (`-09-fields`). *Title* says *Always shown*. |
| 12 | **Board**, then the list → **Fields** | The card's own six; turn off *Priority*: the cards lose it (`-10-board-fields`). |
| 13 | **Reset** in the bar | Back to the view as saved. |

**C. Groupings** (still Salt Hours → Tasks)

| # | Do | You should see |
|---|----|----------------|
| 14 | **Group: Asset** | **Create grouping** beside the Group menu (`-06-grouped`). |
| 15 | Click it, tick **Lighthouse Interior** and **Cliff Path** | The name reads *Cliff Path, Lighthouse Interior* as you tick (`-07-create`). **Create**. |
| 16 | Scroll to the new group | *Cliff Path, Lighthouse Interior* **0**, empty, ready to drag a task into (`-08-grouping`). Drag one in: it is about exactly those two. |
| 17 | Open **Create grouping** again and tick the same two | *That grouping already exists.* and *Create* greyed. **Cancel**. |
| 18 | Point at the group's head, click **…** → **Remove grouping** | It asks first; **Remove grouping**: the group goes (it stays while tasks are in it). |
| 19 | **Timeline**, group by asset | The grouping is a row there too. |

**D. The keyboard**

| # | Do | You should see |
|---|----|----------------|
| 20 | Tab to the Views button, **Enter** | The list opens with the keyboard on the ticked view. **↑ ↓** move between views, **← →** along a row's buttons (the handle, *Move up*, *Move down*, **…**). |
| 21 | On a view's handle, **Alt + ↓** | The view moves down for everyone. |

**E. On the desktop app and the beta**, when you choose: the same steps on a
real project. On the beta, saving views needs part 2's staging lines first;
until then the list says *Saved views are not on this server yet.*

### 2. What changed, place by place

| Where | Before | Now |
|-------|--------|-----|
| Tasks toolbar | *Views* (a menu of this browser's saved views); *Phase*, *Key date*, *New task* | the view's name, its list and cards; one *New* menu |
| Filters | one value each; a new row emptied the table | several values; an empty row filters nothing |
| Sort | one | several, in order |
| Group | as it was | plus *Hide empty groups*; *Create grouping* |
| Columns | all of them, always | a view hides or moves any but *Title* |
| Board cards | always six lines' worth | a view hides any of them |
| Under the toolbar | nothing | the bar, only while there is something to save |
| Timeline grouped by an item | combinations with tasks | the project's groupings too, even empty |

### 3. Known limits

- **The toolbar still takes two lines in some cases** (the Views button
  keeps 160px for the name, about 14 letters; measured in
  `po-vw1d-measure-1440x900.json` and `-1280x700.json`):

  | Width | At rest | A filter on | Grouped by an item | Grouped and sorted |
  |-------|---------|-------------|--------------------|--------------------|
  | 1440 | one line | one line | one line | two lines |
  | 1280 | one line (it took two) | two lines | two lines | two lines |

  At 1280 at rest its two halves sit 17px apart and need 8; *Filter (1)* is
  17px wider than *Filter*, so the count, *Export*, *Deleted key dates* and
  *New* drop to a second line (`po-vw1d-05-bar-1280x700`).
- **A Board card keeps its own order**: a view chooses which of its six
  fields show, not their order; Phase, End and the other items have no
  place on a card yet.
- **One field list serves the table and the Board**: a field hidden on the
  Board is hidden in the table too.
- **The Board's Group menu has no *No grouping*** any more: a Board view
  always has columns.
- **A grouping naming a scene or shot outside the active shot list** shows in
  the table, not on the Timeline (which shows the active list).
- **The desktop without signing in** names no person in the bar (*changed on
  another computer*), and learns of a teammate's save when it saves.

### 4. Questions for you

1. **The Views button's width**: 160px shows about 14 letters of a view's
   name and keeps the toolbar on one line at 1440 until a sort is chosen
   while grouped by an item. Keep it, or narrower (about 12 letters, 136px)
   so that case, and 1280 with a filter on, stay on one line too? Grouped by
   an item, 1280 takes two lines either way.
2. **The Board's card fields**: hiding Priority on the Board also hides the
   Priority column in that view's table (one list for both). Keep that, or
   should the Board keep its own list of card fields?
