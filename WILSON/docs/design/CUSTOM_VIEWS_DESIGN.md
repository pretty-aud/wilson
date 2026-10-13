# Custom table views — the design (VW1, 2026-10-13)

Written to Audrey's answers of 2026-10-13
(`docs/design/CUSTOM_VIEWS_QUESTIONS.md`, every answer verbatim there) and
the research (`docs/design/CUSTOM_VIEWS_RESEARCH.md`), with the `laws-of-ux`
and `design-direction` skills loaded. **Status: draft, not yet reviewed.**
The next session (VW1b, `docs/sessions/briefs/po-vw1b-custom-views-build.md`)
runs this file's two review rounds (UX with accessibility; security of the
new table) before any code, corrects this file, then builds in the order of
§7.

Everything here is a consequence of one of her answers (cited as Qn) or a
house rule. Where the design had to choose something she will see and her
answers do not reach, it says **Design default** and the walkthrough asks
her about it.

---

## 1. Her rulings, in one table

| Q | Ruling |
|---|---|
| Q1 | Every view is shared with the project's team; there are no personal views |
| Q2 | Anyone who can edit the project may create, change, reorder and delete views (company admins and managers, the project's managers and members, anyone while a project has nobody on it); reviewers use views, never save them |
| Q3 | A change made with Filter, Sort, Group (or a card) is "for the moment" until saved, Notion-style; a button saves it for later |
| Q3a | *Save* (into this view, for everyone), *Save as new view*, *Reset*; the built-in *All* view cannot be changed or deleted (only *Save as new view* from it); reviewers see *Reset* only |
| Q3b | An unsaved change lasts while WILSON is open: kept across tabs; dropped on close, reload or project switch |
| Q3c | While a view has a change, a slim bar under the toolbar holds *Reset*, *Save as new view* and *Save*; the toolbar does not move |
| Q3d | A teammate's save reaches an open table at once; an unsaved change of one's own stays on screen, and the bar says the view was changed by someone else (*Reset* takes theirs) |
| Q4 | Each person opens each table on the view they last used there, per project (per computer on the signed-out desktop); the very first time, *All* |
| Q5 | The Views dropdown lists the project's views (the one on screen ticked) and, Notion-style, holds Filters, Sort, Group and Fields, each opening a card of its own; *New view* and a *…* menu per view (Edit, Rename, Duplicate, Delete, which asks first) for people who may save; the Views button shows the view's name, and *edited* while it has a change; on Scenes the bookmark icon becomes the button |
| Q5a | The Filters card shows the filters set now and a button to add one; a new filter is made with today's filter rows, inside the card (and the Sort, Group and Fields cards follow the same pattern) |
| Q5b | A card opens in place of the list, one at a time, with a ← back |
| Q5c | Views in the order they were made, *All* first; people who may save views drag them into another order, and everyone sees it |
| Q6 | Every field can be hidden except the item's name; in Tasks the key-date rows can be turned off too |
| Q6a | The Tasks table's *All* view shows every column the project uses; a narrower window scrolls the table sideways with the task's name kept in place |
| Q7 | A view sets the columns' order and which show; widths stay as WILSON sets them |
| Q8 | A view remembers its layout (Table, Board, Gallery); not the picture or card size; never the search |
| Q9, Q10 | The Tasks table's Asset cell shows every linked asset (main first, "+N" when they do not fit, the list on hover); clicking it opens a picker that ticks several (search; same-named assets show type and phase) |
| Q11 | Scene, Shot, Level and Experience columns join the Tasks table, each like the Asset column; filterable and groupable; Level and Experience only where the project uses them |
| Q11a | Grouped by one of these kinds, a task shows once, under its main item |
| Q12 | The other four tables get no new columns; every count counts every link; views can show or hide the counts |
| Q13 | Filters: every condition must match; a condition may hold several values ("is In progress or Pending review") |
| Q14 | Several sorts, in order; the toolbar's Sort dropdown sets the first |
| Q15 | One grouping, with a switch to show or hide empty groups, the same on every table |
| Q16 | Scenes and Shots each have their own list of views |
| Q17 | The views each browser holds today for the five tables are removed |
| Q19 | Budget's Expenses and the Team tab keep their saved views; the new views come to them later |
| Q20 | Each table comes with *All* only |
| Q21 | Fixed in this work: a new filter row emptying the table; a filter row keeping the wrong condition; Scenes and Shots sharing filters and sorts; ticked rows hidden by a filter; the menus' keyboard and Escape. The rest is recorded for later |

---

## 2. The laws that shape it

`design-direction` asks for three to five laws, each tied to an element and
a decision. These five do the work here.

| Law | Element | Decision |
|---|---|---|
| **Jakob's law** | the dropdown, the cards, the bar | Notion's own pattern, as she asked: a list of views, then the view's parts each opening its own card in place (Q5, Q5b), and changes that stay "for the moment" until *Save* (Q3). The *Reset / Save* bar sits where Notion puts its *Reset / Save for everyone*: under the controls, above the rows (Q3c). |
| **Hick's law / choice overload** | the toolbar at rest | Nothing new on the toolbar at rest: the Views button replaces itself; the save buttons exist only while there is something to save (Q3c); the editor's power (several sorts, several values, field order) lives one click down, in the cards. |
| **Working memory** | the cards | A card opens in place of the list and the dropdown never grows past the table's top band (Q5b), so the rows stay in view and change as the filter is set. The Views button always names the view on screen, so nobody has to remember which view they are in. |
| **Von Restorff** | the *changed for now* bar | The one place a view's unsaved state is shown in words, on the kit Banner's tinted strip, impossible to miss and gone when there is nothing to save. *Save* is the bar's one primary button. |
| **Fitts's law** | the item cells | A task's items are edited where the eye already is: the cell opens the picker (Q10); the picker's tick boxes are the full 28px row, not a 14px box. |

Two house rules carry as much weight: **forgiveness** (every saved change to
a view can be undone; Delete asks first; *Reset* is always one click) and
**her rule A6** (*"keep things relatively the same … add things where they
make sense"*): the Filter strip, the Sort and Group dropdowns and the
Table/Board/Gallery tabs stay exactly where they are and keep working.

`design-direction`'s count for this feature: **Inks: 0 new** (the kit's
paper, paper-raised, ink, muted ink, hairline, signal). **Families: 0 new**
(Geist, Geist Mono for counts only). **Weights: 400 and 600 only**
(`src/ui/typeScale.test.js`).

---

## 3. The words

| Word | Meaning |
|---|---|
| **View** | A named, saved way of showing one table in one project: its filters, sorts, grouping (with or without empty groups), which fields show and in what order, and its layout. Shared with everyone on the project. |
| ***All*** | Each table's built-in view: every field the project uses, nothing filtered, today's default order and grouping (Shots: grouped by Scene, as today; Scenes: list order). It cannot be changed, renamed or deleted, and it is always first. |
| **Changed for now** | The view on screen with changes that are not saved (a *draft*). It lasts while WILSON is open (Q3b) and belongs to that person and that table. |
| **Last used** | The view a person last chose (or saved as new) on a table in a project; that table opens on it (Q4). |
| **Table** | One of the six lists that have views: `tasks`, `assets`, `scenes`, `shots`, `levels`, `experiences` (Scenes and Shots apart, Q16). |

---

## 4. The screens

All sizes in px at the kit's Dense density; every colour a kit token; every
repeated piece a kit component (§8 lists the two kit requests).

### 4.1 The Views button (every table)

- **Where:** exactly where today's *Views* button (or Scenes' bookmark icon)
  is, in the toolbar's left slot, after the layout tabs.
- **Anatomy:** the kit `Button` (sm, 28px tall): the BookmarkPlus icon (14),
  the view's name (the Body step, 400), then, while the view is changed for
  now, " · edited" in the muted ink, then a chevron. The name is cut with
  "…" past 180px; the full name is the tooltip. Its accessible name reads
  "Views: Shoot week" (", edited" while changed); `aria-expanded`;
  `aria-haspopup="dialog"`.
- **Width, measured against today's toolbars** (research §2.1): Tasks,
  Assets, Levels and Experiences have 100px or more free between the left
  and right groups at 1440, so the named button fits on one line there as
  today; at 1280 Tasks already takes two lines and still does. **Scenes and
  Shots:** the icon (28px) becomes this button (about 150px with a short
  name), so at **1440** their search box and count drop to a second line, as
  they already do at 1280. *Design default; the walkthrough shows it and
  offers walkthrough 47's Q184 regrouping as the alternative.*

### 4.2 The Views dropdown

A non-modal floating card (the kit request **Popover**, §8), anchored under
the button's left edge, 300px wide while it shows the list, paper-raised,
6px radius, the one shadow; it never runs past the window (it scrolls inside
past the window's height less 24px). Opening moves the keyboard to the
ticked view; closing returns it to the button.

From top to bottom:

1. **Views** (a section label at the Label step, capitals):
   - *All*, then the project's views in their order (Q5c). Each row is a
     28px button: a tick for the view on screen, the name (cut with "…"),
     and for people who may save views, on hover or focus, a drag handle
     at the row's start and a *…* button at its end.
   - Choosing a row applies that view (and makes it this person's last used
     view on this table, Q4). If the view on screen is changed for now, the
     choice first asks: "Shoot week has changes for now. Switch views and
     drop them?" — *Keep editing* (focused) / *Switch*.
   - The *…* menu (the kit `Menu`): **Edit** (applies the view and opens
     the dropdown's view part, below), **Rename** (the name becomes a field
     in the row: Enter keeps, Escape reverts), **Duplicate** ("Shoot week
     copy", placed after it), **Delete** (asks: "Delete Shoot week for
     everyone on this project?" — *Cancel* focused / *Delete*; Ctrl+Z puts
     it back). *All* has no *…* menu and no handle.
   - **Reorder:** drag a row by its handle; for the keyboard, *Move up* /
     *Move down* in the *…* menu (FX2's Items table does the same).
2. **This view** (a section label): four 28px rows, each with the part's
   name, a short summary in the muted ink, and a chevron:
   - **Filters** — "2 filters" / "None"
   - **Sort** — "Phase, then Start" / "Default order"
   - **Group** — "By status" / "None"
   - **Fields** — "9 of 13 shown"
   Each opens its card in place (§4.3). Reviewers have these too: their
   changes are for the moment (Q2, Q3a).
3. **New view** (people who may save views): a 28px row with a plus; it
   becomes a name field in place ("View name", Enter creates, Escape
   cancels). The new view starts as *All* (every field, nothing filtered)
   and is applied at once, so its parts are set through the cards and kept
   with *Save* in the bar.

**States.** Loading (the project's views not read yet): the list shows the
kit `Loading` line under *All*, and *All* works. Error (the views could not
be read): "Views could not be loaded." with *Try again*, and *All* works.
Empty: *All* alone, and for people who may save views, the hint "Change the
table, then *Save as new view*, or start a *New view*." Read-only (a
reviewer, or a seat that cannot write): no *New view*, no handles, no *…*;
the list and the four parts as for everyone.

### 4.3 The four cards

A card replaces the dropdown's content in place (Q5b): the same floating
card, its header a ← button ("Back to views") and the part's name; Escape on
a card goes back to the list, Escape on the list closes the dropdown. The
card widens to 480px for Filters and Sort (their rows need it), keeping its
left edge. Every change applies to the table at once, as a change for now.

- **Filters** (Q5a, Q13): the view's filters, one row each in today's shape
  — *Where* / *And*, the field, the condition, the value — then *+ Add
  filter*.
  - For a choice field (Status, Priority, Phase, Assignee, Type, Asset,
    Scene, Shot, Level, Experience…), the value is a picker with tick boxes:
    one or several values; the row reads "Status is In progress, Pending
    review". *is* matches any of them; *is not* matches none of them.
  - Text fields (Title, Name) keep *contains*, *does not contain*, *is*,
    *is not* with one text value; every field keeps *is empty*, *is not
    empty*.
  - A row with no value yet filters nothing and is not counted (Q21); a
    field change resets the row's condition to that field's first and its
    value to none (Q21).
  - Each row ends with ✕ ("Remove this filter").
- **Sort** (Q14): the view's sorts in order, each a row: the field, the
  direction (*A → Z* / *Z → A*, or *Earliest first* / *Latest first* for
  dates), ✕; a drag handle at the row's start (*Move up* / *Move down* in
  the row's own keys: Alt+↑ / Alt+↓); then *+ Add sort*. The toolbar's Sort
  dropdown and its direction button set the first sort and leave the rest.
- **Group** (Q15): the grouping field (*None* first), then the **Hide empty
  groups** switch (the kit `Switch`). In Board layout this card names the
  board's columns. *Design default:* the switch starts **on** in tables
  (what every table but Tasks' Status grouping does today) and **off** on
  the Board (an empty column is where a card is dropped).
- **Fields** (Q6, Q7): every field of the table in the view's order, each a
  row: a drag handle, the field's name, and an eye switch (the kit
  `Switch`, labelled "Show <field>"). The name field is first, its switch on
  and disabled ("Always shown"). In Tasks, **Key dates** is a row too
  (shows or hides the key-date rows). *Show all* / *Hide all* (all but the
  name) at the card's foot. Keyboard reorder: Alt+↑ / Alt+↓ on a row.

### 4.4 The *changed for now* bar (Q3c, Q3d)

The kit `Banner` (its `info` tone: one Dense line on a 14% tint with a
hairline under it, the buttons in its action slot, `role="status"` so a
screen reader hears it appear), in the flow between the toolbar and the
table, present only while the view on screen has a change for now:

| State | Words | Buttons |
|---|---|---|
| A change of one's own | "Shoot week: changed for now" | *Reset* (ghost) · *Save as new view* (secondary) · *Save* (primary) |
| The same, on *All* | "All: changed for now" | *Reset* · *Save as new view* |
| The same, for a reviewer | "Shoot week: changed for now. Only the project's editors can save views." | *Reset* |
| A teammate saved the view meanwhile | "Mara changed Shoot week. Your changes are still on screen." | *Reset* (takes theirs) · *Save as new view* · *Save* (writes yours over theirs, after asking) |
| A teammate deleted the view meanwhile | "Mara deleted Shoot week. Your changes are still on screen." | *Reset* (back to *All*) · *Save as new view* |

*Save as new view* turns the bar's words into a name field ("View name",
the view's name + " copy" selected), Enter saves and applies the new view,
Escape cancels. *Save* writes at once (no question) unless a teammate saved
in between. Each save is one undo step.

### 4.5 Unsaved changes and the last used view (Q3b, Q4)

- A change for now lives with the project in WILSON's memory, per table:
  going to the Timeline and back to Tasks finds it as it was; a reload,
  closing WILSON or switching project drops it.
- Choosing a view, or saving one as new, records it as that person's last
  used view on that table in that project; the table opens on it next time.
  If it has been deleted since, the table opens on *All*.

### 4.6 The Tasks table's item columns (Q9–Q11a, Q6a)

- **Columns:** Asset, then Scene and Shot (where the project has scenes),
  then Level and Experience (where it uses them), after Priority, before
  Phase; each a field in the Fields card. Each is 150px wide (the Asset
  column's minimum today); the Title keeps FX8's rule (the remainder, at
  most 360px).
- **The cell:** the task's items of that kind by name, main first, separated
  by commas, cut with "+2" (a kit `Badge` in the muted ink) when they do not
  fit; the full list in order is the cell's tooltip; "—" when there are
  none. A shot reads "Sc 4 · 10" before its name when two shots share a name.
  A row no longer in the project reads "No longer in the project" (as the
  task window's Items table does).
- **The picker (Q10):** clicking the cell (or Enter on it) opens a Popover
  under the cell: a search field ("Search assets"), then every row of that
  kind in the project, each a 28px row with a tick box: the name, and in the
  muted ink what tells same-named rows apart (an asset's type and phase; a
  shot's scene and number; a scene's number). Ticking adds the item at the
  end of the task's list; unticking removes it (the last one asks first, as
  the task window does). The order and the main item are the task window's
  (its Items table is unchanged); the picker shows the main one first with
  *Main*. Scenes and shots offer the active shot list's rows with *Show all
  lists*, as the task window's picker does. Escape closes; focus returns to
  the cell. Reviewers and seats that cannot write get the tooltip, no
  picker.
- **Filters and grouping:** Scene, Shot, Level and Experience join the
  filter fields and the group fields. A filter matches a task through any of
  its items (Q11, from "all shown"); the Asset filter does too (today it
  matches the main asset only). Grouping puts a task once, under its main
  item (Q11a); its cell names the others.
- **Width (Q6a):** with every column on, the table is wider than the window
  (about 1,540px for a film project, 1,840px with scenes and levels); it
  scrolls sideways inside its frame and the checkbox and Title columns stay
  in place (the kit request **Table sticky columns**, §8), the rest sliding
  under them. A view that hides columns gives their room back by FX8's rule.
- **The Board:** a card names all its assets (comma-separated, "+N"), as
  the cell does; its other lines are unchanged.
- **New task:** unchanged in this work (one asset; the window adds more).

### 4.7 The counts (Q12)

- **Levels and Experiences:** the Assets count counts assets whose
  `level_ids` / `experience_ids` hold the row (what the window's sidebar
  reads), and the Tasks count counts every task with an item of that level
  or experience (`taskCountsByEntity`, as Assets already does). The window's
  *Linked counts* line reads the same numbers. (On the cloud, assets carry
  no level or experience links: the Assets count there is 0 and so is the
  window's list — the same number; recorded as a known limit.)
- **The scene window's** *shots / assets / tasks* line counts assets through
  `scene_ids` (OUTSTANDING's entry closes).
- Each count is a field a view can hide (Assets' *Tasks*; Levels' and
  Experiences' *Assets* and *Tasks*).

### 4.8 The defects fixed (Q21)

1. A new filter row filters nothing until it has a value, and *Filter (n)*
   counts only complete rows (Tasks, Assets, Levels, Experiences, Scenes,
   Shots).
2. Changing a row's field resets its condition and value.
3. Scenes and Shots each keep their own filters, sorts and grouping (Q16
   makes them separate tables in the views model).
4. Ticked rows that a filter or search hides are unticked, so a bulk action
   acts only on rows on screen.
5. The Views dropdown works by keyboard (§4.9) and Escape closes it: P1-08
   closes for the five tables (it stays open for Expenses and Team, Q19).

Recorded in `docs/OUTSTANDING.md`, not fixed: the Tasks CSV export's
missing Asset and Bid and its raw status words; the Expenses *Linked task*
filter's "Untitled"; grouping Tasks by Asset, Phase or Assignee dropping a
task whose value is not in the project's list; Assets sorting the provider's
array in place; the desktop's browser storage starting empty at every
launch (it no longer holds views, but still holds other stores).

### 4.9 Keyboard, focus and motion

- **The dropdown** is a non-modal dialog (`role="dialog"`, labelled
  "Views"): it holds form fields, so it is not a `menu`. Tab and Shift+Tab
  move through it in order; ↑ / ↓ move between the rows of a list (views,
  parts, fields, sorts); Enter or Space chooses; Escape goes back from a
  card, then closes; focus returns to the Views button. Opening a card moves
  the keyboard to its first control; ← back returns it to the part's row.
- **The picker:** the search field has the keyboard on open; ↓ moves into
  the list; Space ticks; Escape closes; focus returns to the cell.
- **The bar:** its buttons are in the Tab order right after the toolbar;
  saving moves focus to the Views button.
- **Motion:** the dropdown and the cards appear in `--duration-response`
  (200ms) on `--ease-response`; a card swaps in place with a cross-fade in
  the same token; the bar appears without sliding the table (it is in the
  flow; the table moves down by its height once). With reduced motion, all
  of it appears at once (the house's reduced-motion twin,
  `v2Motion.test.js`).
- **Contrast and type:** the Body step for names, the Label step (11px,
  capitals) for section labels only, the muted ink for summaries (its pairs
  are already in `tokens.test.js`); focus rings are the kit's (orange on
  dark).

---

## 5. The data

### 5.1 A view

```
{
  id, project_id, workspace_id,
  table_key: 'tasks' | 'assets' | 'scenes' | 'shots' | 'levels' | 'experiences',
  name,                      -- 1 to 80 characters, trimmed; duplicates allowed (as today)
  position,                  -- the order in the dropdown (Q5c)
  config: {
    version: 1,
    layout: 'table' | 'board' | 'gallery',         -- Q8; board for Tasks only
    filters: [ { field, op, values: [...] } ],     -- Q13; every row must match
    sorts:   [ { field, dir: 'asc' | 'desc' } ],   -- Q14; in order
    group:   { field, hideEmpty } | null,          -- Q15
    fields:  [ { key, visible } ]                  -- Q6, Q7; the order; the name is always visible
  },
  created_at, created_by, updated_at, updated_by
}
```

- Field keys are the table's own (Tasks: `title`, `status`, `priority`,
  `asset`, `scene`, `shot`, `level`, `experience`, `phase`, `assignee`,
  `start`, `end`, `bid`, `key_dates`; the others from their columns). A key
  the table does not know is ignored on read (a newer view on an older
  client); a field the view does not list is shown at its default place (a
  column added later appears in old views).
- A filter's `values` hold ids for linked rows (phase, assignee, asset,
  scene, shot, level, experience) and words for the rest; a value whose row
  is gone matches nothing and the card shows it as "No longer in the
  project".
- *All* is never stored; it is computed per table from the table's defaults.

### 5.2 The cloud: migration 0097, suite 100

**0097 `table_views`** (the house's pattern from 0096: pre-flight checks and
a re-run guard, the table, triggers, RLS forced, grants, an RPC, the
broadcast restated whole, post-conditions):

- **Columns** as §5.1; `table_key` CHECKed to the six; `name` CHECKed
  (`char_length(btrim(name)) between 1 and 80`); `config` CHECKed to a JSON
  object under 32 KB; `position` an integer; the project a same-workspace
  composite foreign key, `ON DELETE CASCADE`.
- **Triggers:** the workspace stamped from the project; `fn_audit_touch`;
  `created_by` pinned on insert and kept on update, as
  `fn_shot_list_pin_maker` does (0086), because `fn_audit_touch` stamps only
  when the client sends none.
- **RLS (Q2):** four policies, each reaching the project through `projects`
  under the caller's own RLS (so a private project's views stay hidden, the
  0072 arm), plus `has_active_membership`; insert, update and delete also
  need `can_write_project(project_id)` (company admins and managers, the
  project's managers and members, anyone on an unstaffed project; never a
  reviewer). Every arm is restated in full, never `CREATE OR REPLACE`d into a
  narrower one, and each is proved in the suite (the 0062 lesson).
- **Grants:** SELECT, INSERT, DELETE; UPDATE on `name`, `position` and
  `config` only.
- **`reorder_table_views(project, table_key, ids[])`**, SECURITY INVOKER (as
  `reorder_task_items`): rewrites `position` in one statement under the
  caller's RLS.
- **The last used view (Q4):** a new column `user_settings.table_view_last`
  (JSONB, `{ "<project_id>:<table_key>": "<view_id or 'all'>" }`, capped like
  the row's other JSONB), written through `src/lib/userState.js` as the row's
  other settings are; own row only (0046's policies). The cloud's per-person
  store follows the person to any computer, which a browser store cannot do
  on the desktop (research §2.2).
- **Live (Q3d):** `table_views` joins `fn_realtime_broadcast`'s project arm
  (the seventeenth table), the function restated whole, and the two suites
  that pin the list (72, 99) say seventeen; `realtimeMerge.js` maps it to
  `tableViews`.
- **Suite 100** (`supabase/tests/rls/100_table_views.sql`): every role
  (company admin, manager, user; project manager, member, reviewer; an
  unstaffed project; a seatless member; another workspace; a private project
  outside it; an inactive member; anon) against every verb; the column
  grant; the CHECKs; the RPC under RLS; the pinned maker; the broadcast.
  **Three things are taught first** (research §2.6): the coverage guard in
  the root `rls.yml` accepts a three-digit suite (`[0-9][0-9][0-9]?_`),
  `scripts/tap-all.mjs` sorts suites by number (not as text) and filters by
  whole number, and CI's failure-replay list gains 98, 99 and 100.
  `RLS_TABLES` gains `table_views` in the same commit as the suite.
- **Applied to wilson-dev only**, after a rolled-back rehearsal through
  `scripts/tap-hosted.py`, by `supabase db query --linked --file …` plus its
  history row; the Desktop kit section in `00_HOW_TO_APPLY.md`; the staging
  lines in the hand-off's "Waiting on Audrey". Never `db push`; never staging
  or prod.

### 5.3 The desktop signed out (the Local Server)

- Views ride in the project's file as a `tableViews` collection
  (`emptyBundle`, `readRabbitBundle`'s missing-array fill), written through
  `rabbitSubentityRoutes('table-views', 'tableViews', …)`, with a reorder
  route beside FX2's `rabbitTaskItems.cjs` pattern. No roles: anyone using
  the desktop may save views (her ruling in batch 1; the walkthrough says
  so in one line).
- The last used view is per computer: a `tableViewLast` map in the
  machine's own settings block (the `rabbit` settings that live in
  `otter-settings.json` on the desktop), not in the project's file.

### 5.4 The other backends and places

- **The dev fixtures:** an empty `tableViews` (Q20: *All* only), the same
  verbs in memory, and the last used map in memory.
- **Google Drive:** loads `tableViews: []`; its writes refuse in words
  ("Saved views need the cloud or the desktop's Local Server").
- **The provider** (`RabbitProvider.jsx`): `ctx.tableViews`; the mutators
  `addTableView`, `updateTableView`, `deleteTableView`, `reorderTableViews`,
  each in `mutationsRef` with undo (`pushHistory`); `ctx.tableViewLast` and
  `setTableViewLast`; the changes-for-now store (per project and table, in
  memory, cleared when the project changes); selectors `viewsOf(tableKey)`
  and `allViewOf(tableKey)`.
- **The bundle-key places** (FX2's list): `EMPTY_BUNDLE`, each adapter's
  `loadProject` (cloud, Local Server, fixtures, Drive), `EXPECTED_KEYS`,
  `CLOUD_BUNDLE_KEYS`, `BUNDLE_KEYS`, the Drive loader's regex,
  `columnAllowlist.test.js`; the move to the cloud (`runMigration.js`
  carries a desktop project's views) and the workspace takeout
  (`TAKEOUT_TABLES`).
- **The old views (Q17):** on the first load after this ships, the five
  browser keys (`rabbit_task_saved_views`, `rabbit_asset_saved_views`,
  `rabbit_scene_saved_views`, `rabbit_level_saved_views`,
  `rabbit_experience_saved_views`) are removed; Expenses' and Team's keys
  are untouched (Q19). The five old dropdowns and their save rows and
  dialogs are deleted with them.

---

## 6. One shared piece, five tables

The Views button, the dropdown, the cards and the bar are one R.A.B.B.I.T.
component (`views/tableViews/`), given each table's description: its key,
its fields (key, label, kind: text, choice, date, number, linked), its
filterable, sortable and groupable fields, its defaults (*All*), and how to
read a row's value for a field. The five views keep their own toolbars and
tables and hand their filter, sort, group, layout and field state to it in
place of their local state. `ScenesView.jsx` changes the smallest thing (the
plan calls it unsafe to edit as it stands): its state for the two modes
moves behind the shared component's two tables, and its dropdown, save row
and saved-view handlers are removed.

---

## 7. The build, in order

Each step leaves the app working; the Tasks table's item columns come first
(her bug, the brief's order).

| Step | What | Where |
|---|---|---|
| 0 | This file's two review rounds (one reviewer each, `model: "opus"`): UX with accessibility; security of 0097; the second attacking the first's corrections; corrections written back here | VW1b |
| 1 | **The Tasks table's item columns** (§4.6): the cells, the picker, Scene/Shot/Level/Experience columns, filters and grouping by them, the sticky name and sideways scroll, the Board's cards; the kit requests Popover and Table sticky columns with these callers | VW1b |
| 2 | **The counts** (§4.7) | VW1b |
| 3 | **The data:** 0097 + suite 100 on wilson-dev (the guard, tap-all and replay list taught first), the adapters, the Local Server, the fixtures, Drive's refusal, the provider, live merge, bundle keys, the move to the cloud, the takeout | VW1c |
| 4 | **The views on Tasks:** the button, the dropdown, the four cards, the bar, the last used view, changes for now, the old keys removed for Tasks | VW1c |
| 5 | **The other four tables:** Assets, Scenes and Shots (two lists), Levels, Experiences; their old keys removed | VW1d |
| 6 | **The defects** (§4.8) | VW1d |
| 7 | Walkthrough 72, `docs/OUTSTANDING.md` (P1-08 narrowed, the recorded defects), the help pages, the hand-off, the merge | VW1d |

Every step: two adversarial code review rounds at the session's end (one
reviewer each, the second attacking the first's corrections), each
correction asserted with a failing control before its commit; the
`npx vitest run --maxWorkers=4` count stated; pictures at 1280x700 and
1440x900 (`scripts/vw1-shots.mjs` grows the after states); every export with
a caller; every new mutator in `mutationsRef` with undo; the fixtures'
seams (`src/dev/devFixtures.test.js`).

---

## 8. Kit requests (each lands with its first caller)

- **VW1-KR-1 `Popover`** (`src/ui/Popover.jsx`): a non-modal floating card
  anchored to a trigger (below it, left edges aligned, kept in the window),
  paper-raised, 6px radius, the one shadow; registers with `overlay.js` (as
  `Menu` does) so document keys stand down; Escape and an outside press
  close it; focus moves in on open and back to the trigger on close;
  `role="dialog"` with a label. Callers: the Views dropdown, the item
  picker.
- **VW1-KR-2 Table sticky columns** (`src/ui/Table.jsx` + `src/index.css`):
  `stickyColumns={n}` keeps the first n columns in place while the table
  scrolls sideways, on the cell's own paper with the hairline at their right
  edge. Caller: the Tasks table (the checkbox and Title).

---

## 9. Known limits (the walkthrough names each)

- **The signed-out desktop has no roles:** anyone using it may save, change
  and delete views.
- **On the cloud, assets carry no level or experience links:** a level's
  and an experience's asset count is 0 there, as their windows' lists are.
- **Sums and grouped rows count a task once, under its main item** (FX2's
  rule; Q11a); lists and cells name every item.
- **A filter value whose row is gone matches nothing** and shows as "No
  longer in the project" in the card.
- **Budget's Expenses and the Team tab** keep their old saved views (Q19),
  per browser, and their keyboard gap (P1-08 for those two).

## 10. For the walkthrough to ask her (design defaults)

1. The Scenes and Shots toolbars take two lines at 1440 once the Views
   button shows the view's name (§4.1): keep, or regroup the toolbar as
   walkthrough 47's Q184 proposed?
2. The *Hide empty groups* switch starts on in tables and off on the Board
   (§4.3): right?
3. Switching views with a change for now asks first (§4.2): right, or
   switch and drop without asking?
