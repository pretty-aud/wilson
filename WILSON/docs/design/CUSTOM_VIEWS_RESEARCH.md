# Custom table views — the research (VW1, 2026-10-13)

Branch `po/vw1-custom-views`, cut from `feat/post-overhaul-edit-versioning`
at `77ac80d3`. Phase 1 of `docs/sessions/briefs/po-vw1-custom-views.md`:
how Notion builds its database views, how WILSON's five tables work today,
and the gap between them. **Nothing here is decided.** The decisions are put
to Audrey in `docs/design/CUSTOM_VIEWS_QUESTIONS.md`, and nothing is designed
or built until she has answered them.

## 0. Her words (2026-10-13, verbatim)

> issue with the asset view in the table of tasks. see image. the interface in the table doesnt allow for multiple assets to be connected to it. please make sure it either shows all or none. additionally, i can see the levels or scenes or shots related. lets do a session to do a pass on this. what i would like to do here is lets create a way for a user to create their own views like you can in notion. think about how notion has the ability to turn on and off what fields are seen in the table. lets add a drop down when you press the views option for creating saved filtered/sorted views that allows you to select your filters, sorting, grouping and what fields are seen. these views should be project specific. lets do a research path on how Notion does the drop down in tables that allows you to set all those settings. i still want to keep the filter button, the sorting drop down and grouping dropdown. this new views drop down is to build customized views.

> lets do a research phase first, then ask me any questions to clarify things and not make any assumptions.

> lets have this work for tasks, scenes, assets, levels, experiences.

> make sure to make a new session for this and lets use the UX laws and designer skills for this please.

Her screenshot: the Tasks table's *Asset* column, one row's cell open as a
dropdown listing *—*, *tester*, *tester*, one choice only.

**What is already settled by her words**, and so not asked again: views are
made by the person (not only built in); the place to make them is a dropdown
opened from the *Views* control; a view holds filters, sorting, grouping and
which fields show; views belong to a project; the Filter button, the Sort
dropdown and the Group dropdown stay; it covers Tasks, Scenes, Assets,
Levels and Experiences.

---

## 1. How Notion builds views

Read on 2026-10-13 from Notion's public help centre and its public API
guide, signed out. Everything below is a summary in my own words. The pages
carry no article dates (only a 2026 copyright line), so where a page is
silent this says so rather than guessing. Sources are listed at the end of
the section.

### 1.1 A database has many views; each view keeps its own settings

- **One set of rows, many ways to look at it.** A Notion database is one list
  of pages (rows). A *view* is a saved way of showing that list: a layout
  (Table, Board, List, Gallery, Calendar, Timeline, Chart, and newer ones such
  as Map, Form and Dashboard) plus that view's own filters, sorts, grouping
  and visible properties. A new database starts with one Table view, and a
  database must always keep at least one view (the API refuses to delete the
  last one).
- **Each view is independent.** Changing one view's filter, sort, grouping or
  visible properties never changes another view.
- **Views sit as tabs above the table.** Since the 2022 redesign the views
  show as a row of tabs at the top of the database, switched with one click;
  when there are many, the overflow sits behind a "*N* more…" item. On a
  narrow screen the tabs collapse into the current view's name, which opens
  the list.
- **Adding a view:** the **+** after the last tab, then pick a layout and give
  it a name. A new view can also start from an existing view's settings (the
  2022 release added copying an existing view's settings).
- **Managing a view:** clicking a view's tab opens its menu: rename, edit the
  view, duplicate, copy a link to that view, delete. Views are reordered by
  dragging their tabs.
- **Which view opens first:** Notion's help pages do not say. A new database
  opens on its one view; whether Notion then reopens the view a person last
  used, or always the leftmost tab, is not documented.

### 1.2 The view settings menu

One menu (the settings button at the top right of the database) holds
everything about the current view. The help pages list these items:

| Item | What it does |
|---|---|
| Layout | The layout (Table, Board…) and its own options: for a table, vertical lines and wrapping; for a board, card size and card preview; how a row's page opens |
| Property visibility | Each property (field) with an eye to show or hide it in this view, dragged to set the order |
| Filter | The view's filters (§1.4) |
| Sort | The view's sorts (§1.5) |
| Group | Group the rows by one property (§1.6) |
| Sub-group | A second grouping inside the first (boards) |
| Copy link to view | A link that opens the database on this view |

Separately, the database's own **•••** menu has **Lock views** (§1.7).

### 1.3 Fields (Notion calls them properties) in a table view

- **Show or hide per view:** the eye beside each property in *Property
  visibility*; one view can show fields another hides.
- **Order per view:** drag a column heading left or right in the table, or
  drag the property in *Property visibility*.
- **Width per view:** drag a column's edge. Notion's API guide stores a
  column's width inside the view's own settings (a width per property, for
  table views), so two views of one table can size a column differently.
- **Wrap and freeze:** a column can wrap its text onto several lines; a table
  can freeze its columns up to a chosen one so they stay put while the rest
  scrolls sideways.
- **The title column:** the title property (the row's name) cannot be
  deleted, because it is what opens each row's page; the table help page says
  it can be dragged to another position. The help pages do not say whether
  it can be hidden.

### 1.4 Filters

- **Simple filters:** *Filter* → pick a property → set the condition. Filters
  set this way show in a bar under the view tabs (the API guide calls them
  "quick filters", the ones shown in the filter bar).
- **Advanced filters:** *Add advanced filter* builds rules joined by **And**
  or **Or**, and rules can be gathered into *filter groups*, nested up to
  three layers deep. A simple filter can be moved into the advanced one from
  its **•••** menu. Since the redesign, advanced filters are deliberately
  less prominent: simple filters are the default.
- **Only for me, until saved:** a change to a shared view's filter applies
  only to the person who made it until they press **Save for everyone**;
  **Reset** throws the personal change away (the 2022 release note).

### 1.5 Sorts

- *Sort* → pick a property → ascending or descending. A view can hold several
  sorts; their priority is set by dragging them up or down.
- Text sorts A–Z, numbers by value, and select-type properties follow the
  order of their options (which is set by dragging the options).
- Like filters, a sort change is only for the person who made it until
  *Save for everyone*.
- Rows can also be dragged into order by hand with the row's handle (the
  table help page).

### 1.6 Groups and sub-groups

- *Group* → pick a property: rows gather under one heading per value.
- Inside the Group settings: show or hide each group with an eye; sort the
  groups (by hand, alphabetically, or by the option order); **hide empty
  groups**; *Remove grouping*.
- *Sub-group* adds a second layer (status, then priority inside each
  status). Notion's API guide says boards can sub-group and tables cannot.
- On a board, a column can be hidden from its own **•••** menu; hidden
  groups are listed in the Group settings to bring back.

### 1.7 Who may change a view

- **A personal change, then publish:** for filters and sorts, Notion's rule
  is "yours until you choose *Save for everyone*". The help pages describe
  that choice for filters and sorts only; they do not say it for grouping,
  layout or visible properties.
- **By permission level:** a person with Notion's *Can edit content* access
  can add, edit and delete rows but cannot add, change or delete views, and
  cannot change filters or sorts. They can still make their **own** linked
  view of the database on another page and filter or sort that freely
  without touching the shared views.
- **Lock views:** from the database's **•••** menu; it stops anyone changing
  properties and views (the rows stay editable). Anyone with edit access can
  switch the lock off again.
- **Private views:** the help pages describe no view that only one person
  can see. Notion's routes to "my own view" are the personal (unsaved) filter
  and sort changes, and a linked view placed on one's own page.

### 1.8 How many rows load

The help pages give a *Load limit* setting for Timeline views (show 10
pages, or more). For tables they are silent; the 2022 release notes mention a
"Load 50 more" button at the end of a long table. A database holds at most
250,000 rows.

### 1.9 A relation that links several rows, in one cell

Notion's *relation* property (a link from a row to rows of another
database) is the nearest thing to a WILSON task's items:

- One cell can hold **several** linked rows. Clicking the cell opens a picker
  that searches the other database; picking adds a link, and the **–** beside
  a linked row removes it. A linked row can be opened from the cell.
- A relation can be limited to **one** linked row (the picker then allows
  one).
- The help page does not say how a cell with many links is drawn (all of
  them, cut short, or a count). A *rollup* property can show the linked rows'
  count, or a sum, earliest date and so on, as its own column.

### 1.10 What Notion stores for one view (its API guide)

A view is: a name; a layout type; the filter (conditions joined by and/or);
the list of sorts (property and direction, in order); the "quick filters"
shown in the filter bar; and a layout-specific *configuration*: the list of
properties with, for each, whether it is visible, its width (tables) and
whether it wraps; the grouping property (and the sub-grouping property,
boards only); frozen columns, vertical lines and sub-items for tables; card
size and cover for boards and galleries. A view belongs to its database and
shows one data source; a database must keep at least one view.

### Sources (Notion's public pages, read 2026-10-13)

- Database views, filters, sorts & groups — https://www.notion.com/help/views-filters-and-sorts
- Table view databases — https://www.notion.com/help/tables
- Board view (Kanban) — https://www.notion.com/help/boards
- Database properties — https://www.notion.com/help/database-properties
- Relations & rollups — https://www.notion.com/help/relations-and-rollups
- Intro to databases (locking, *Can edit content*) — https://www.notion.com/help/intro-to-databases
- Optimize database load times & performance — https://www.notion.com/help/optimize-database-load-times-and-performance
- Using advanced database filters (guide) — https://www.notion.com/help/guides/using-advanced-database-filters
- Databases reimagined: what's changed (guide) — https://www.notion.com/help/guides/databases-reimagined-whats-changed
- Release notes, 15 March 2022 (personal changes, Save for everyone, Reset, view tabs) — https://www.notion.com/releases/2022-03-15
- Working with views (API guide) — https://developers.notion.com/guides/data-apis/working-with-views

---

## 2. WILSON today

Measured on 2026-10-13 at `77ac80d3`, on the dev fixtures' *Salt Hours*
(levels and experiences on `?fixtures=game`), in Chromium at 1440x900 and
1280x700, by `scripts/vw1-shots.mjs` (its numbers are in
`docs/sessions/handoffs/img/po-vw1-measure-1440x900.json` and
`…-1280x700.json`), and by reading the code by identifier. **Measured** means
seen in the running app; **from the code** means read, not run.

### 2.1 The five toolbars, left to right (measured)

| Table | Controls, left to right | Right side |
|---|---|---|
| **Tasks** | Filter · Sort (*Sort…*, 7 fields) · a direction arrow while sorted · Group (*No grouping*, 5) · Table / Board · **Views** · Search tasks (titles only) | the count (42/42) · Export · Phase · Key date · Deleted key dates · **New task** |
| **Assets** | Filter · Sort (6) · arrow while sorted · Group (3) · Table / Gallery · three thumbnail sizes (named only by a tooltip) · **Views** · Search assets (names only) | the count · **New asset** |
| **Scenes**, Scenes mode | Scenes / Shots · Filter · Sort (*List order*, 6) · arrow (always) · Group (2) · Table / Gallery · three sizes · *24 fps* · **a bookmark icon named "Saved views"** · Search · the count | **New scene** · New shot |
| **Scenes**, Shots mode | the same, with Sort 9 fields and Group 6 (*Scene* by default) | New scene · **New shot** |
| **Levels**, **Experiences** | Filter · Sort (3) · arrow (always, even unsorted) · Group (1) · Table / Gallery · card sizes (gallery only) · **Views** · Search (names only) | the count · **New level** / **New experience** |

At 1280 the Scenes toolbar wraps: the search box and the count drop to a
second line (`po-vw1-scenes-01-rest-1280x700.png`).

**Fields offered** (measured, from each select's options):

| Table | Filter by | Sort by | Group by |
|---|---|---|---|
| Tasks | Status, Priority, Asset, Phase, Assignee, Title | Title, Status, Priority, Start date, End date, Bid days, Created | Status, Asset, Phase, Priority, Assignee |
| Assets | Status, Type, Phase, Name | Name, Type, Status, Start date, Due date, Created | Type, Phase, Status |
| Scenes | Status, Type, Time of day, Name | Name, Scene number, Type, Status, Time of day, Created | Type, Status |
| Shots | Status, Type, Time of day, Framing, Camera movement, Name | Name, Shot number, Type, Status, Time of day, Framing, Camera movement, Frame count, Created | Scene, Status, Type, Time of day, Framing, Camera movement |
| Levels, Experiences | Status, Name | Name, Status, Created | Status |

**How the three work, the same in every table:**

- **Filter** opens a strip under the toolbar (not a menu): rows of *Where /
  And* field · condition · value. Choice fields offer *is, is not, is empty,
  is not empty*; text fields add *contains, does not contain*. Every row must
  match (**And only**: no Or, no groups). Active filters show only as
  *Filter (n)* with an orange edge; there is no "clear all"; *Done* closes
  the strip and keeps the filters.
- **Sort** is one field and one direction. Clicking a column's heading does
  not sort in any of the five (the kit's table supports it; Budget's
  expenses use it).
- **Group** is one level. A group's band collapses and opens, for the visit
  only. Empty groups show only in the Tasks table's Status grouping (all
  nine statuses) and the Tasks board; everywhere else a group exists only if
  a row is in it.

### 2.2 Saved views today (measured and from the code)

| | Tasks | Assets | Scenes | Levels / Experiences | Budget → Expenses | Team |
|---|---|---|---|---|---|---|
| Kept in | this browser | this browser | this browser | this browser | this browser | this browser |
| One list per | table, **every project shares it** | table, every project | table, every project | table, every project | **project** | table, every project |
| A view stores | filters, sort, group, the board's grouping, Table/Board | filters, sort, group, Table/Gallery, thumbnail size | filters, sort, group, Table/Gallery, card and thumbnail size, Scenes or Shots | filters, sort, group, Table/Gallery, card size | filters, sort, group | filters, sort, group |
| Never stored | search, collapsed groups, columns (no column can be chosen) | same | same, and the Shots mode's grouping | same | same | same |
| Saved through | a dialog | a dialog | a row under the toolbar | a row under the toolbar | a dialog | a dialog |
| The button | the word **Views** | **Views** | **a bookmark icon** | **Views** | **Views** | an icon |

The same in all six:

- **No default view and no "current view" mark.** Nothing is applied when a
  table opens, and the button never says which view is on screen.
- **A view cannot be renamed, changed, duplicated or reordered.** *Save*
  always adds a new one (duplicate names allowed); delete is at once, with
  no question and no undo.
- **Loading a view** replaces the filters, sort, grouping and layout; it
  leaves the search, the collapsed groups and the ticked rows as they were.
- **The keyboard cannot load a view (OUTSTANDING P1-08 is wider than it
  says).** In all five tables, measured, each saved view in the menu is a
  plain block with no tab stop and no role: only the mouse can choose it.
  Its delete ✕ is a real button, so the keyboard can delete a view it cannot
  open. Escape does not close any of the five menus (measured with the
  keyboard on the menu's button); there are no arrow keys; opening the menu
  does not move the keyboard into it. P1-08 names only the Expenses and
  Scenes menus; Tasks, Assets, Levels, Experiences and Team are the same.
- **A view saved in one project is offered in every project** (all but
  Expenses), although it holds that project's own asset, phase and person
  ids (from the code): loaded in another project, a Tasks view filtered by
  asset or phase shows nothing.
- **On the desktop, these views most likely do not survive a restart** (from
  the code and the handbook's §14, not measured by relaunching): the
  desktop's local server takes a new port at every launch and the window
  loads that address, and a browser keeps its storage per address, so each
  launch starts with an empty store. The same would hold for the Scenes
  tab's remembered shot list and the unsaved edit copies.
- **Team's views exist only on the desktop and Google Drive**: on the cloud
  the Team tab is the members panel, with no toolbar (from the code).
- **Expenses' per-project list goes stale after a project switch** made
  while the tab is open (from the code): the menu keeps the previous
  project's views, and the next save writes them under the new project.

### 2.3 Every column (measured)

Widths in pixels at 1440 / 1280 (one number when both agree). No column can
be hidden, moved or resized by the person in any of the five tables; each
width is fixed in the table's sheet, and the name column takes what is left
up to 360px (FX8's rule).

| Table | Columns, in order | Table width | Scrolls sideways |
|---|---|---|---|
| **Tasks** | ☐ 36 · **Title** 360/274 · Status 148 · Priority 88 · **Asset** 175/150 · Phase 149/124 · Assignee 149/124 · Start 124 · End 124 · Bid 64 | 1416 / 1256 | no |
| **Assets** | ☐ 36 · picture 36 · **Name** 360/292 · Type 112 · Phase 136 · Status 152 · Start 124 · Due 124 · Description 272/180 · Tasks (a count) 64 | 1416 / 1256 | no |
| **Scenes** | ☐ 28 · shots arrow 36 · picture 76 · # 56 · **Name** 308 · Status 160 · Time of day 128 · Type 96 · Description 296/136 · Runtime 120 · Frames 88 | 1392 / 1232 | no |
| **Shots** | ☐ 28 · picture 76 · # 56 · **Shot name** 308 · Takes 200 · Status 160 · Time of day 128 · Type 96 · Framing 88 · Cam move 128 · **Description 0** · Duration 120 · Frames 88 · Start 144 · End 144 | 1764 | **yes, at both sizes** |
| **Levels**, **Experiences** | ☐ 36 · **Name** 360 · Status 152 · Assets (a count) 72 · Tasks (a count) 64 · Description 732/572 | 1416 / 1256 | no |

- **The Shots table is the one that already needs a column chooser**: its
  Description column gets 0px at both sizes and the table runs 1764px wide
  (walkthrough 47 Q185 asked "a column chooser, or keep all sixteen?"; the
  count is fourteen, fifteen with Takes).
- The scene table's nested shots have their own fourteen columns (no dates)
  and no header row.
- The Tasks table also shows **key dates** as rows (a diamond, the name, the
  date; every other column "—"): above the tasks, among them when sorted by
  date, or above the groups when grouped. Filters and search never hide
  them.
- The Tasks *Board* shows per card: the title, status, priority, the first
  asset, the assignee, the start date and the bid days.

### 2.4 What each table shows of a task's items, and of its own links

Since FX2 (migration 0096) a task relates to many items: assets, scenes,
shots, levels and experiences, ordered within each kind; the first of each
kind is the task's *main* one, and the task's window lists them all in its
*Items* table.

**The Tasks table** (measured on the fixtures' "Glass and rain rig test",
which has two assets, `po-vw1-tasks-05-two-assets-*.png`):

- **Only an Asset column exists.** There is no Scene, Shot, Level or
  Experience column, no grouping by them, and the board's cards show the
  first asset only. So her "i can see the levels or scenes or shots related"
  most likely means *cannot*; it is asked, not assumed.
- **The Asset cell is a one-choice dropdown** (the browser's own select)
  listing *—* and every asset in the project by name; two assets with the
  same name read the same ("tester", "tester" is two assets called tester).
  For a task with two assets it shows the first only; the second appears
  nowhere in the row.
- **What a choice does** (from the code, FX2's rule): picking an asset the
  task already has moves it first; picking another replaces the first (the
  second stays); *—* removes only the first, after which the cell shows the
  second. The scenes, shots, levels and experiences are never touched.
- **Elsewhere on the tab:** the Asset filter matches the first asset only;
  grouping by asset shows the task once, under its first asset; *New task*
  takes one asset; the CSV export has no asset column.

**The other four:**

| Table | Shows of its links | Right or wrong (measured unless marked) |
|---|---|---|
| Assets | *Tasks*: a count of every task that names the asset (any position) | right |
| Scenes | no task or asset column; the scene window's *shots / assets / tasks* line | the assets figure is always 0 (OUTSTANDING, FX2) |
| Shots | *Takes*: up to three take chips; the lists a shot is in, as the name's tooltip | right |
| Levels, Experiences | *Assets* and *Tasks* counts | **both wrong**: all four levels read 0 assets; "Cliff Path" reads 0 assets and 0 tasks while its own window lists *Assets (2)* and *Tasks (1)*, and its *Linked counts* line says "0 assets / 0 tasks" (`po-vw1-levels-05-window-counts-*.png`). The assets count reads a field nothing writes; the tasks count counts a task only under its first level (OUTSTANDING P1-26, wider than recorded) |

On the cloud, assets have no level or experience links at all (the cloud
adapter drops them), and a task's level and experience live only in its
items.

### 2.5 What a table remembers (from the code)

- **Only the saved-views list survives a reload.** Filters, sort, grouping,
  layout, sizes, collapsed groups and the search reset on every reload and
  every time another R.A.B.B.I.T. tab is opened and closed.
- **Switching project while staying on a tab keeps that tab's filters,
  sort and grouping**, holding the old project's ids.

### 2.6 Where views could be kept: the cloud, the desktop, the roles

From the code and the migrations (read, not run). These are the facts the
design will stand on whichever way she answers; none of them is a decision.

- **The cloud has no place for views today.** No table holds table-view
  settings, per project or per person (every `CREATE TABLE` read). The
  nearest stores are `user_settings` (per person, across workspaces),
  `notes` (the owner only), and the project's own settings columns (shared,
  written by anyone who can write the project). Views kept on the cloud need
  a new table: migration **0097** with suite **100**, both free (0094 /
  suite 97 stay reserved for BC3's path check).
  - **Suite 100 needs three things taught:** the RLS coverage guard in the
    root `.github/workflows/rls.yml` matches two-digit suite names only
    (`[0-9][0-9]_<table>.sql`); `scripts/tap-all.mjs` sorts suite names as
    text, so `100_` would run before `10_`, and `tap-all 10` would pick it
    up too; CI's failure-replay list is written out by hand and stops at
    suite 96.
  - **A row's maker is not pinned by default:** `fn_audit_touch` stamps
    `created_by` only when the client sends none, so an owner column for a
    personal view would need the pinned-maker trigger the shot lists use
    (`fn_shot_list_pin_maker`, 0086).
- **The roles, on the cloud.** Company-wide (`workspace_members.app_role`):
  admin, manager, user. Per project (`project_members.project_role`):
  manager, member, reviewer. Who may write a project (`can_write_project`):
  company admins and managers, the project's managers and members, and
  anyone while a project has nobody on it; reviewers read and comment, and
  since 0084 / 0091 may also edit shot lists, edits and bins. "Admin or the
  project's manager" exists only written inline in the shot-list functions
  (no helper). A private project (0072) hides everything under it from
  people outside it, and a new table's rules must reach through to the
  project to inherit that. On the screen, `useProjectAccess()` gives
  `canWrite`; there is no "is a manager" field (`canOnProject`'s
  `project.shotlist.activate` is the nearest: admin or the project's
  manager).
- **Who is signed in.** On the cloud, `usePermissions().userId` (the
  sign-in's user id). On the signed-out desktop there is no user: the
  stores already kept per person there (the Scenes tab's remembered shot
  list, the unsaved edit copies) use the literal `'local'` instead.
- **The desktop (the Local Server).** One file per project holds everything
  about it (`rabbit-data/projects/<id>/project.json`, or the open demo
  folder's copy), each collection a list inside it; generic routes
  (`rabbitSubentityRoutes`) write a collection and the whole file is read
  at once. It has no users and no roles ("every gate is open on the Local
  Server"). A new collection rides in that file the way `taskItems` did
  (FX2), through the same places: the provider's empty bundle, each
  adapter's `loadProject`, the three bundle-key tests, the fixtures, the
  move to the cloud and the workspace takeout.
- **The live channel.** A change to a shared view would reach everyone with
  the project open through the project's broadcast (`fn_realtime_broadcast`,
  sixteen tables since 0096); a new table there means restating that
  function whole, and the two suites that pin its list (72, 99).

### 2.7 Found in passing (not views, but in the same controls)

Each is to be recorded in `docs/OUTSTANDING.md` by this session, narrowly.

1. **"Add filter" hides every row at once** (measured on Tasks: 42/42 →
   0/42, "No tasks match these filters"): the new row is *Status is* with no
   value, and an empty value matches nothing. On Assets and Levels the empty
   table then says "No assets yet" / "No levels yet" (from the code).
2. **Changing a filter row's field keeps its condition** (Tasks, Assets,
   Scenes; from the code): *does not contain* carried onto a choice field
   with an empty value hides every row.
3. **Scenes and Shots share one filter list and one sort** (from the code): a
   Shots-only filter (*Framing*) hides every scene in Scenes mode; a
   Shots-only sort leaves Scenes mode "sorted" with nothing chosen, which
   switches off *Move up / Move down* and the drag grips. In Shots mode
   grouped by Scene (the default), changing the sort changes nothing on
   screen.
4. **Ticked rows stay ticked when a filter or search hides them** (Tasks,
   Assets, Levels, Experiences; from the code): a bulk delete or status
   change then acts on rows that are not on screen.
5. **Grouping Tasks by Asset, Phase or Assignee drops a task whose value is
   not in the project's list** (for example an assignee not on the project),
   while the count still includes it (from the code, not measured).
6. **The Tasks CSV export** leaves out the asset and the bid, and writes
   statuses as stored (`in_progress`) (from the code).
7. **Expenses' *Linked task* filter labels every task "Untitled"** (from the
   code: it reads a field tasks do not have).

---

## 3. The gap

| | Notion | WILSON today |
|---|---|---|
| Where views live | in the database: everyone with access sees the same views | in one browser; one list per table for every project (Expenses per project); on the desktop, most likely gone at each restart |
| Shared or personal | views are shared; a filter or sort change is personal until *Save for everyone* | personal to the browser; nothing is shared |
| Who may change a view | edit access; *Can edit content* cannot touch views, filters or sorts; *Lock views* | anyone at that browser |
| What a view holds | layout, filters, sorts, grouping (+ sub-group), visible properties, their order and width, wrap, frozen columns | filters, one sort, one grouping, layout, size |
| Fields on and off | per view, with an eye; order by dragging; widths by dragging | none: every column always shows, in a fixed order and width |
| Filters | simple ones, plus And/Or groups three deep | And only; a new filter row hides every row until it has a value |
| Sorts | several, in order | one |
| Groups | one, plus sub-groups (boards); hide empty groups; hide one group | one; empty groups in Tasks' Status only |
| Default / current view | the view tabs show which is open | none; the button never names the view |
| Manage a view | rename, duplicate, delete, reorder, copy a link | save a new one, or delete at once |
| Keyboard | the menu and its items are reachable | a saved view cannot be opened without a mouse (all six menus) |
| Several links in one cell | a relation cell holds several; a picker adds and removes them | the Tasks table shows and edits the first asset only; no scene, shot, level or experience column |
| Counts of links | rollups count every link | Levels and Experiences count wrong (assets always 0; tasks only the first level) |

## 4. What this asks of Audrey

Every decision the design would otherwise make for her is in
`docs/design/CUSTOM_VIEWS_QUESTIONS.md`, each with two to four choices and a
recommended one, asked in chat four at a time. Her answers are recorded
there, verbatim, as they come; the design (`CUSTOM_VIEWS_DESIGN.md`) is
written only after them.

## 5. The pictures

In `docs/sessions/handoffs/img/`, each at 1440x900 and 1280x700, taken by
`node scripts/vw1-shots.mjs 5298 --out docs/sessions/handoffs/img --size
<W>x<H>` against the `vw1-worktree` dev server:

| Table | Pictures (`po-vw1-<table>-<nn>-<state>-<size>.png`) |
|---|---|
| Tasks | `01-rest`, `02-filter` (the strip open), `03-views` (the menu), `04-views-saved` (after saving one view), `05-two-assets` (the row whose task has two assets) |
| Assets | `01-rest`, `02-filter`, `03-views`, `04-views-saved` |
| Scenes | the same four |
| Shots | the same four |
| Levels | the same four, and `05-window-counts` ("Cliff Path"'s window beside its counts) |
| Experiences | the same four |

A browser's own dropdown list (Sort, Group, the Asset cell) is drawn by the
operating system and never reaches a screenshot; their options are in the
measurement files.
