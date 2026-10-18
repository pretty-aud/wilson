# Custom table views — the design (VW1, 2026-10-13; her later answers 2026-10-16)

Written to Audrey's answers (`docs/design/CUSTOM_VIEWS_QUESTIONS.md`, every
answer verbatim there: batches 1–8 of 2026-10-13, batches 9–13 of
2026-10-16) and the research (`docs/design/CUSTOM_VIEWS_RESEARCH.md`), with
the `laws-of-ux` and `design-direction` skills loaded. **Status:** the
design of 2026-10-13 was reviewed twice (§11); what her answers of
2026-10-16 added (§4.11 combination groups, the *New* menu, no main item)
is reviewed by the session that builds each part, first. VW1b's parts
(§4.6, §4.7, the Tasks halves of §4.10 and §4.11, §8's KR-1 portalled and
KR-2) were reviewed at its step 0 on 2026-10-17 (§11 round 3) and are
corrected here, with her answers of 2026-10-17 (batches 15 and 16) in them.
§5, the data, was reviewed against the code at VW1c's step 0 on 2026-10-17
(§11 round 4) and is corrected here too.
**Every question is answered.** Taking the main item out of WILSON is its own
session, before the build (VW1m, §7), with its own measured list and
questions.

Everything here is a consequence of one of her answers (cited by its number)
or a house rule.

---

## 1. Her rulings, in one table

| Q | Ruling |
|---|---|
| Q1 | Every view is shared with the project's team; there are no personal views |
| Q2 | Anyone who can edit the project may create, change, reorder and delete views (company admins and managers, the project's managers and members, anyone while a project has nobody on it); reviewers use views, never save them |
| Q3 | A change made with Filter, Sort, Group (or a card) is "for the moment" until saved, Notion-style; a button saves it for later |
| Q3a | *Save* (into this view, for everyone), *Save as new view*, *Reset*; the built-in *All* view cannot be changed or deleted (only *Save as new view* from it); reviewers see *Reset* only |
| Q3b | An unsaved change lasts while WILSON is open: kept across tabs; dropped on close, reload or project switch |
| Q3c, Q-A3 | A slim bar under the toolbar holds *Reset*, *Save as new view* and *Save*, and appears **only while the view on screen has unsaved edits**; the toolbar does not move. It is her *Save view* button (Q-A2): no separate button |
| Q3d | A teammate's save reaches an open table at once; an unsaved change of one's own stays on screen, and the bar says the view was changed by someone else (*Reset* takes theirs) |
| Q4 | Each person opens each table on the view they last used there, per project (per computer on the signed-out desktop); the very first time, *All* |
| Q5 | The Views dropdown lists the project's views (the one on screen ticked) and, Notion-style, holds Filters, Sort, Group and Fields, each opening a card of its own; *New view* and a *…* menu per view (Edit, Rename, Duplicate, Delete, which asks first) for people who may save; the Views button shows the view's name; on Scenes the bookmark icon becomes the button |
| Q-A2 | No *edited* word and no dot on the Views button: the bar is the sign of unsaved edits |
| Q5a | The Filters card shows the filters set now and a button to add one; a new filter is made with today's filter rows, inside the card (Sort, Group and Fields follow the same pattern) |
| Q5b | A card opens in place of the list, one at a time, with a ← back |
| Q5c | Views in the order they were made, *All* first; people who may save views drag them into another order, and everyone sees it |
| Q6, Q-J | Every field can be hidden except the item's name; in Tasks the key-date rows can be turned off too. The columns in front of the name (Assets' picture; Scenes' expand arrow, picture and number; Shots' picture and number) stay in front: hideable, not movable |
| Q6a | The Tasks table's *All* view shows every column the project uses; a narrower window scrolls the table sideways with the task's name kept in place |
| Q7 | A view sets the columns' order and which show; widths stay as WILSON sets them |
| Q8 | A view remembers its layout (Table, Board, Gallery); not the picture or card size; never the search |
| Q-E | A view's fields also choose what shows on cards: the Board's, the Gallery's, and the Scenes table's nested shot rows |
| Q9, Q10 | The Tasks table's Asset cell shows every linked asset ("+N" when they do not fit, the list on hover); clicking it opens a picker that ticks several (search; same-named assets show type and phase) |
| Q11 | Scene, Shot, Level and Experience columns join the Tasks table, each like the Asset column; filterable and groupable; Level and Experience only where the project uses them |
| Q-D, Q-D1–D5 | Grouping by a linked kind makes **one group per combination of items** ("Asset A, Asset B, Asset C"); dragging a task into a group makes that group's items the task's; *Create grouping* (in the toolbar, beside the Group dropdown) opens a window of check boxes to make a group for a combination; created groupings are saved for the project; removed from the group's *…* menu |
| Q-D4, Q-M1–M2 | **No main item, anywhere.** The Timeline groups by combination too (no *Create grouping* there); the Budget's *By asset*, *By scene*, *By shot* split a task's days and money evenly between its items; deleting an asset never deletes a task |
| Q-M3 | Combination groups and *Create grouping* in four tables: Tasks, Assets (by scenes, shots, levels, experiences), Levels and Experiences (by assets) |
| Q-M4 | Taking out the main item is its own session, before the views are built |
| Q12 | The other tables get no new columns; every count counts every link; views can show or hide the counts |
| Q13 | Filters: every condition must match; a condition may hold several values ("is In progress or Pending review") |
| Q14 | Several sorts, in order; the toolbar's Sort dropdown sets the first |
| Q15, Q-I | One grouping, with a switch to show or hide empty groups; empty groups start as today (in tables only the Tasks Status grouping shows them; the Board shows every column) |
| Q-B | Scenes and Shots keep their search box and count on a second line at 1440 |
| Q-C | The Tasks tab keeps two groupings: the table's and the Board's columns |
| Q-A1 | The Tasks toolbar's Phase, Key date and New task become one *New* button with a menu (Task, Phase, Key date), to make room |
| Q-F | A seat that cannot write does not see the editing controls (*New view*, handles, move buttons, *…*, *Create grouping*) |
| Q-G1–G3 | A *New view* is saved for everyone at once, starting as *All*; the item columns sit after Priority, 150px each; *Save* over a teammate's newer save asks first |
| Q-H | Switching views drops a change for now without asking |
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
| **Hick's law / choice overload** | the toolbar at rest | Nothing new on the toolbar at rest: the Views button replaces itself; the save buttons exist only while there is something to save (Q3c, Q-A3); Tasks' three create buttons become one *New* (Q-A1); the editor's power (several sorts, several values, field order) lives one click down, in the cards. |
| **Working memory** | the cards | A card opens in place of the list and the dropdown never grows past the table's top band (Q5b), so the rows stay in view and change as the filter is set. The Views button always names the view on screen. |
| **Von Restorff** | the *changed for now* bar | The one place a view's unsaved state shows, in words, on the kit Banner's tinted strip, present only while there is something to save (Q-A3). *Save* is its one primary button. |
| **Law of common region** | the combination groups | A task about several items sits once, in the group named for all of them together (Q-D): the group's band is the region that says "these tasks share exactly these items", with no hidden "main" one deciding. |

Two house rules carry as much weight: **forgiveness** (every saved change to
a view, every drag between groups and every removed grouping shows the
shell's undo toast; Delete asks first; *Reset* is always one click) and
**her rule A6** (*"keep things relatively the same … add things where they
make sense"*): the Filter strip, the Sort and Group dropdowns and the
layout tabs stay where they are and keep working.

`design-direction`'s count: **Inks: 0 new. Families: 0 new. Weights: 400
and 600 only** (`src/ui/typeScale.test.js`).

---

## 3. The words

| Word | Meaning |
|---|---|
| **View** | A named, saved way of showing one table in one project: its filters, sorts, grouping (with or without empty groups), which fields show and in what order (on cards too), and its layout. Shared with everyone on the project. |
| ***All*** | Each table's built-in view: every field the project uses, nothing filtered, today's default order and grouping (Shots: grouped by Scene, as today; Scenes: list order; the Tasks Board: columns by Status). It cannot be changed, renamed or deleted, and it is always first. |
| **Changed for now** | The view on screen with changes that are not saved (a *draft*). It lasts while WILSON is open (Q3b) and belongs to that person and that table. |
| **Last used** | The view a person last chose (or saved as new) on a table in a project; that table opens on it (Q4). |
| **Table** | One of the six lists that have views: `tasks`, `assets`, `scenes`, `shots`, `levels`, `experiences` (Scenes and Shots apart, Q16). |
| **Combination group** | When a table is grouped by a linked kind, the group of rows linked to exactly the same set of items of that kind ("Lighthouse Interior, Storm Lantern"); the set has no order and its name lists the items in the display order (by name, numbers read as numbers; scenes and shots by their numbers; §4.11). Rows linked to none are in "No asset" (or "No scene", …). |
| **Grouping** | A combination group made with *Create grouping* (Q-D): saved for the project, shown even while empty, so rows can be dragged into it. |
| **A seat that cannot write** | A reviewer, or anyone `can_write_project` refuses on the project. |

There is **no main item**: since her Q-D4, no item of a row counts for more
than another anywhere she sees it.

---

## 4. The screens

All sizes in px at the kit's Dense density; every colour a kit token; every
repeated piece a kit component (§8 lists the kit requests).

### 4.1 The Views button and the toolbar

- **Where:** exactly where today's *Views* button (or Scenes' bookmark icon)
  is, in the toolbar's left slot, after the layout tabs.
- **Anatomy:** the kit `Button` (sm, 28px tall, the Dense step like every
  toolbar button): the BookmarkPlus icon (14), the view's name (400), a
  chevron. No *edited* word and no dot (Q-A2): the bar under the toolbar is
  the sign of unsaved edits. Its accessible name reads "Views: Shoot week";
  `aria-expanded`; `aria-haspopup="dialog"`.
- **One width per table**, so the toolbar never moves when a view changes.
  The name is cut with "…"; the full name is the tooltip, the dropdown's
  row and the bar's words.
- **Tasks makes room with one *New* button** (Q-A1): Phase, Key date and
  New task become one primary *New* button whose menu holds *Task*, *Phase*
  and *Key date* (the kit `MenuButton`, §8 KR-3), each item keeping its
  gate and its reason. Measured at 1440 before it (review R2-1, live): about
  42px to spare; the three buttons and their gaps take 297px, the *New*
  button about 84px, so about 255px are free. They go to the Views button
  (about 170px: about 15 letters of the name) and to *Create grouping*
  (§4.11), which appears beside the Group dropdown only while the table is
  grouped by a linked kind, so both fit on one line at 1440. The build
  measures the final numbers in Chromium at 1280 and 1440; at 1280 the
  toolbar already takes two lines. The Tasks count (`.rb-task-count`) gets
  a minimum width sized to its total's figures, so filtering never re-wraps
  the toolbar.
- **Assets, Levels and Experiences** have 220px or more free and take a
  180px button.
- **Scenes and Shots:** the icon (28px) becomes this button (180px); at
  1440 their search box and count drop to a second line, as they already do
  at 1280 (Q-B).

### 4.2 The Views dropdown

A non-modal floating card (the kit request **Popover**, §8, rendered in
place right after the button: no toolbar ancestor clips it), anchored under
the button's left edge, 300px wide while it shows the list, paper-raised,
6px radius, the one shadow; at most as tall as the room below the button
less 12px, scrolling inside past that. Opening moves the keyboard to the
ticked view; closing returns it to the button.

From top to bottom:

1. **Views** (a section label at the Label step, capitals):
   - *All*, then the project's views in their order (Q5c). The list is a
     **grid**: ↑ / ↓ move between rows, ← / → between a row's controls, and
     only the active row's controls are in the Tab order. Each row: a tick
     and `aria-current="true"` for the view on screen, the name (cut with
     "…"), and, for people who may save views, on hover or focus, a drag
     handle at its start (a button named "Move Shoot week, 2 of 4"; Alt+↑ /
     Alt+↓ move the row while the handle has focus) and at its end *Move
     up*, *Move down* and the *…* button.
   - **Choosing a row** applies that view, makes it this person's last used
     view on this table (Q4) and closes the dropdown. **A change for now is
     dropped without asking** (Q-H): the table shows the chosen view as
     saved, and the bar goes.
   - **The *…* menu** is the kit `MenuButton` (§8 KR-3): **Edit** (applies
     the view and keeps the dropdown open, the keyboard on *Filters*),
     **Rename** (the name becomes a field in the row: Enter keeps, Escape
     reverts), **Duplicate** ("Shoot week copy", placed at the end, Q5c),
     **Delete** (asks: "Delete Shoot week for everyone on this project?" —
     *Cancel* focused / *Delete*; afterwards the keyboard goes to the next
     row, or to the Views button). *All* has no handle, no move buttons and
     no *…*.
   - **A seat that cannot write** does not see the handles, the move
     buttons, the *…* or *New view* (Q-F).
2. **This view** (a section label): four 28px rows, each with the part's
   name, a short summary in the muted ink, and a chevron: **Filters** ("2
   filters" / "None"), **Sort** ("Phase, then Start" / "Default order"),
   **Group** ("By status" / "None"; on the Tasks Board "Columns by status"),
   **Fields** ("9 of 13 shown"). Each opens its card in place (§4.3). A seat
   that cannot write has these too: its changes are for the moment.
3. **New view** (people who may save views): a 28px row with a plus; it
   becomes a name field in place ("View name", Enter creates, Escape
   cancels). The new view is saved at once for everyone, starting as *All*,
   placed at the end, and applied (Q-G1); its parts are set through the
   cards and kept with *Save* in the bar.

**States.** *Loading*: the kit `Loading` line under *All*; *All* works.
*Error*: "Views could not be loaded." with *Try again* (it reloads the
project); *All* works. *Not on this server yet* (a database without the
views' migration, or Google Drive): *All* alone, with "Saved views are not
on this server yet." in place of *New view*. *Empty*: *All* alone, and for
people who may save views the hint "Change the table, then *Save as new
view*, or start a *New view*." *The view on screen deleted by a teammate,
with no change of one's own*: the table goes to *All* and a toast says
"Shoot week was deleted. Showing All."

### 4.3 The four cards

A card replaces the dropdown's content in place (Q5b): its header a ←
button ("Back to views") and the part's name; Escape on a card goes back to
the list, Escape on the list closes the dropdown. The card widens to 480px
for Filters and Sort, keeping its left edge. Every change applies to the
table at once, as a change for now. The Filters and Sort cards are plain
forms in Tab order; the Fields list is a grid like the Views list. A moved
row is announced in the table's polite live region.

- **Filters** (Q5a, Q13): the view's filters, one row each in today's shape
  — *Where* / *And*, the field, the condition, the value — then *+ Add
  filter*. **The toolbar's Filter strip and this card draw the same row
  component.** A choice field's value is a picker with tick boxes (a child
  Popover): one or several values ("Status is In progress, Pending
  review"); *is* matches any of them, *is not* none of them. For a linked
  kind (Asset, Scene, Shot, Level, Experience): *is* = one of the row's
  items is among the values; *is not* = none is; *is empty* = no item of
  that kind. Text fields keep *contains*, *does not contain*, *is*, *is
  not*; every field keeps *is empty*, *is not empty*. A row with no value
  yet filters nothing, is not counted, and is never saved; a field change
  resets the row's condition and value (Q21). Each row ends with ✕.
- **Sort** (Q14): the view's sorts in order, each a row: a drag handle
  button, the field, the direction, ✕; *Move up* / *Move down* among the
  row's hover actions; then *+ Add sort*. The toolbar's Sort dropdown sets
  the first sort: choosing a field already used later removes that later
  sort; *Sort…* removes the first.
- **Group** (Q15): the grouping field (*None* first), then **Hide empty
  groups** (the kit `Switch`), starting as today (Q-I: off where today shows
  empty groups, the Tasks Status grouping and the Tasks Board; on elsewhere).
  On the Tasks tab the table's grouping and the Board's columns stay apart,
  as today (Q-C); the card shows the one for the layout on screen. Grouped by
  a linked kind, the groups are combination groups (§4.11).
- **Fields** (Q6, Q7, Q-E, Q-J): every field of the table in the view's
  order, each a row: a drag handle button, the field's name and an eye
  switch ("Show <field>"); *Move up* / *Move down* among the hover actions.
  The name field is first, its switch on and disabled ("Always shown"). The
  columns in front of the name (Assets' picture; Scenes' expand arrow,
  picture and number; Shots' picture and number) are listed above it with
  their switches, not movable (Q-J). In a Board or Gallery view the same
  list says which lines a card shows, in that order (Q-E); in the Scenes
  table it also says which columns the nested shot rows show. In Tasks,
  **Show key dates** is a separate switch under the list. *Show all* /
  *Hide all* (all but the name) at the card's foot.

### 4.4 The *changed for now* bar (Q3c, Q-A3, Q3d)

The kit `Banner` (its `info` tone; without its own live role, §8 KR-4), in
the flow after the Filter strip when it is open, directly above the table,
**present only while the view on screen has unsaved edits** (Q-A3) or news
about them. Its words are written into the table's polite live region.

| State | Words | Buttons |
|---|---|---|
| A change of one's own | "Shoot week: changed for now" | *Reset* (ghost) · *Save as new view* (secondary) · *Save* (primary) |
| The same, on *All* | "All: changed for now" | *Reset* · *Save as new view* |
| The same, for a seat that cannot write | "Shoot week: changed for now. Only the project's editors can save views." | *Reset* only (Q3a) |
| On a backend without views | "Changed for now. Saved views are not on this server yet." | *Reset* only |
| A teammate saved the view meanwhile | "Mara changed Shoot week. Your changes are still on screen." | *Reset* (takes theirs) · *Save as new view* · *Save* (writes yours over theirs, after asking, Q-G3) |
| The same person, from another window | "You changed Shoot week in another window. Your changes here are still on screen." | the same |
| The signed-out desktop, after a refused save | "Shoot week was changed on another computer. Your changes are still on screen." | the same |
| A teammate deleted the view meanwhile | "Shoot week was deleted. Your changes are still on screen." | *Reset* (back to *All*) · *Save as new view* |
| The person may no longer change views | (danger tone) "You can no longer change views on this project." | *Reset* · *Save as new view* greyed with that reason |
| A save that failed | (danger tone) "Shoot week could not be saved: <reason>." | *Try again* · *Reset* |

- *Save as new view* turns the bar's words into a name field ("View name",
  the view's name + " copy" selected); Enter saves and applies the new view
  (placed at the end), Escape cancels.
- **Save is conditional**: a change for now remembers the revision of the
  view it started from, and *Save* writes only if the view still holds it.
  A save that changes nothing reads the row once: no row means *deleted*;
  another revision means *changed meanwhile* (the bar names the person who
  made it); the same revision means the database filtered the write out
  without a word, which only its access rules do: the person may no longer
  change views on this project (that state; VW1c step 0, finding 13). A
  refusal with words (a CHECK, a cap) is the danger state. Only a change of
  the view's settings makes a new revision; a rename or a reorder does not
  raise the bar.
- **Undo**: every saved change to a view shows the shell's undo toast
  (`components/UndoToast.jsx`), named; it pauses while it has the keyboard's
  focus as well as under the pointer. Undo of a settings save is conditional
  on the revision it left, of a rename on the name it set; undo of a reorder
  is unconditional; undo of a new view deletes it only while it still has
  the revision it was made with, so a teammate's save in between is never
  thrown away (VW1c). A refused undo shows a kit notice. Ctrl+Z is not bound
  on Tasks, Assets, Levels or Experiences; on Scenes, Ctrl+Z while a view's
  toast shows runs that toast's Undo; view changes never enter the
  Timeline's keyboard history.

### 4.5 Unsaved changes and the last used view (Q3b, Q4)

- A change for now lives with the project in WILSON's memory (the provider,
  outside the bundle and the undo history), per table: going to another tab
  and back finds it; a reload, closing WILSON, switching project or
  switching views drops it.
- Choosing a view, or saving one as new, records it as that person's last
  used view on that table in that project; the table opens on it next time
  (on *All* if it has been deleted since).
- **No flash of the wrong view, and no blank table:** the last used map is
  read with the person's settings at sign-in (on the desktop, with the
  machine's settings at start-up). Until a table has both its views and
  that map, its body shows the kit `Loading` line and the toolbar works. The
  map's read is its own probe (`42703` / `PGRST204`: not on this server, an
  empty map); if it fails or has not answered within 2s, the table opens on
  *All* and nothing is written to the map for that visit.

### 4.6 The Tasks table's item columns (Q9–Q11, Q6a, Q-G2)

Reviewed at VW1b's step 0 (2026-10-17, §11 round 3, after her answers of
2026-10-16 and 2026-10-17) and corrected here. Each part says which session
builds it: **VW1b** the columns, the cells, the one-kind picker, the
columns' presence rule, Scene, Shot, Level and Experience in the Group menu,
the sticky columns and the widths; VW1d the Fields card and the shared
filter row; VW1m built the Asset filter's any-item match and the Board's
cards naming every asset (VW1b tests them).

- **Columns (VW1b):** Asset, then Scene and Shot, then Level and Experience,
  after Priority, before Phase, each at least 150px (Q-G2) and growable
  (§4.10). A kind's column is there when the project has that kind turned on
  or any task names a live item of it (the task window's picker rule,
  `pickerKinds`, read over every task). Keyed by KIND (`asset`, `scene`,
  `shot`, `level`, `experience`): the keys VW1c stores in a view's `fields`
  (§5.1). The Title keeps FX8's rule (the remainder, between 216 and 360px).
  Each is a field in the Fields card (VW1d).
- **The cell (VW1b):** the task's LIVE items of that kind (her Q-N4: an item
  whose row is in the trash or not loaded is not shown and not counted, and
  comes back with its row), by name, separated by commas, in the task
  window's *Sort* (her Q10: "the order ... stay as the task's window sets
  them"; the Sort is the window's choice, remembered per computer, her Q-N1,
  so the window and the cells always agree on one computer). Her answers of
  2026-10-17 (batch 15) say what the Sort means: *Type* lists the assets by
  their own type, in the Assets table's order (`ASSET_TYPES`), then by name,
  and the other kinds after the assets; *A to Z* by name; *Date created* by
  when each row itself was made (its `created_at`; a row without one last).
  As many names as fit, then "+N" (the kit `Badge` in the muted ink) for the
  rest, measured in the CELL's room (its fractional width) with each "+N"
  badge's own width kept for it, measured on a hidden copy of the badge (code
  review round 1, R1-4 and R1-8; round 2, R2-1 and R2-4: a width by digits
  fitted "1", the narrowest, and cut a name beside "+2" to "+9", and a
  whole-number room dropped a name that fitted); until the cell is measured
  the names are cut with "…", so nothing jumps; a cell with one name is never
  measured. The whole list, in the same order, is the cell's tooltip and its
  accessible name; "—" when there are none (named "No asset", "No scene", …).
  A shot reads "Scene › Shot". A group's band keeps the display order (§4.11):
  where the Sort is not *A to Z*, a cell and its band can name the same items
  in two orders (walkthrough 72 asks her).
- **The picker (VW1b, Q10):** the cell is a button; a click, Enter or Space
  opens the kit Popover (portalled, §8 KR-1) under it, labelled "Assets of
  <task>" (or Scenes, …). Inside: a search field; for scenes and shots the
  *Show all lists* switch (the active shot list's rows by default, as the
  task window's picker; a row the task already has stays listed whatever its
  list); then every live row of that kind in the project, each a dense row
  (32px, as the window's picker rows) with `role="checkbox"`,
  `aria-checked`, a tick, the name and, only for rows whose name another row
  shares, in the muted ink what tells them apart (an asset's type and phase;
  a scene's number; a shot's number, its scene already in its name). The
  list is ONE Tab stop (roving focus: ↑ ↓ Home End move, Space or Enter
  ticks); ↓ from the search moves into it. The window's own picker keeps its
  add-only shape; the two share the kinds rule, each kind's rows (`pickerRows`
  for scenes and shots), the search's match and the lookup's names
  (`RelationsPanel.jsx`), so neither forks the other.
  - **A draft, committed once (step 0 review, finding 3).** While the
    Popover is open a tick changes a draft of the task's items of that kind,
    and the cell shows the draft. Closing it (Escape, a press outside, Tab
    out, the cell pressed again) commits ONCE: what was added and what was
    removed, applied to the task's items as they are then (a teammate's
    change meanwhile is kept), through `ctx.setTaskItemsOfKind` (queued, one
    undo step, its hidden items kept) inside `ctx.runWithUndoToast`:
    *Added “Storm Lantern” to “Rig test”*, *Removed …*, or *Changed the
    assets of “Rig test”*. The toast is the announcement. Nothing changed:
    nothing written, no toast. A refusal or a failure is said in the tab's
    Banner (VW1m R2-2's route). Grouped by that kind, the row moves once,
    after the commit: a write at every tick would move the row, and unmount
    the cell the Popover hangs from, at every tick. The closed picker's list
    stays in its cell until the write lands (then the cell reads the task's
    items again: the same, or after a refusal what is really there), and a
    picker opened on the cell before then starts from that list, so a second
    close builds on the first (code review round 2, R2-2: the cell showed the
    old items until the queued write landed, then jumped; built on the old
    items, a second close took the first change back).
  - **Unticking the task's last live item (of any kind) asks first**, at
    the untick, with the window's question (*Remove the last item*), a kit
    Dialog over the Popover; *Cancel* keeps it ticked.
  - **Focus:** the search has the keyboard on open; closing returns it to
    the cell, found again by its task and kind when the row has re-rendered
    or moved group, else the table's scroller. Tab from the Popover's last
    control closes it and goes on to the control after the cell; Shift+Tab
    from its first returns to the cell.
- **A seat that cannot write (VW1b):** the cell is text at full ink (no
  picker, not a Tab stop). The names that fit and the "+N" are
  `aria-hidden`, and the whole list is in a visually hidden span, so a
  screen reader reads it once; the task's *Open* shows the list.
- **Where the backend keeps no items** (`ctx.taskItemsAvailable` false: a
  cloud before 0096, the test doubles; step 0 review, finding 19): the cell
  is VW1m's, the task's one item by name on a button that opens its window;
  no picker.
- **Not in a cell (step 0 review, finding 1):** no "No longer in the
  project" and no "Not loaded yet". The lookup cannot tell a row in the
  trash from one not loaded (both are simply not in the bundle), her Q-N4
  hides both, and nothing schedules a re-read.
- **Filters:** the Asset filter matches any of a task's live assets (VW1m);
  Scene, Shot, Level and Experience join the filter fields with the shared
  filter row (VW1d).
- **Grouping (VW1b):** Scene, Shot, Level and Experience join the Group menu
  (the table's and the Board's) where their column shows; grouped by any of
  them, the combination groups of §4.11, for the table and the Board's
  columns.
- **Width (Q6a, VW1b):** with every column on, the table scrolls sideways
  inside its frame, the checkbox and Title columns kept in place (§8 KR-2);
  the widths follow §4.10.
- **The Board:** a card names all its assets, as the cell does (VW1m); its
  lines are the view's fields (Q-E, VW1d).

### 4.7 The counts (Q12)

- **Levels and Experiences (VW1b):** the Assets count counts the assets
  whose `level_ids` / `experience_ids` hold the row, each asset once; the
  view's `linkKey` (`level_id` / `experience_id`) stays for the two things it
  is right for, the files count and a new task's seed. The Tasks count
  counts every task with a live item of that level or experience (VW1m). The
  window's *Linked counts* line reads the same two maps, so it changes with
  them. **On the cloud** assets carry no level or experience links yet (the
  adapter's allowlist leaves them out), so there a level's Assets count is 0
  by data, not by defect, until VW1e adds the links (§4.11); walkthrough 72
  says so (step 0 review, finding 11).
- **The scene window's** *shots / assets / tasks* line counts assets through
  `scene_ids` (VW1b). In `ScenesView.jsx`, the plan's unsafe file, only
  `assetCountByScene` changes; the Scenes table has no Assets column.
- The two fixtures that pinned the wrong field (an asset's `level_id` in
  `rabbitEntityViewsRender.test.jsx`) move to `level_ids` /
  `experience_ids`.
- Each count is a field a view can hide (VW1d, VW1e).

### 4.8 The defects fixed (Q21)

1. A new filter row filters nothing until it has a value, and *Filter (n)*
   counts only complete rows.
2. Changing a row's field resets its condition and value.
3. Scenes and Shots each keep their own filters, sorts and grouping.
4. Ticked rows that a filter or search hides are unticked.
5. The Views dropdown and its menus work by keyboard and Escape closes them:
   P1-08 closes for the five tables (it stays for Expenses and Team, Q19).

Recorded in `docs/OUTSTANDING.md`, not fixed: the Tasks CSV export's
missing columns; the Expenses *Linked task* filter's "Untitled"; grouping
Tasks by Phase or Assignee dropping a task whose value is not in the
project's list; Assets sorting the provider's array in place; the desktop's
browser storage starting empty at every launch.

### 4.9 Keyboard, focus and motion

- **The dropdown** is a non-modal dialog (`role="dialog"`, labelled
  "Views"), rendered right after its button: Tab moves through it in order
  and Tab past its last control closes it. The Views and Fields lists are
  grids; the Filters and Sort cards are plain forms. Enter or Space chooses;
  Escape goes back from a card, then closes; focus returns to the button.
- **Layers:** Popovers are kept on a stack in `overlay.js`; only the top one
  answers Escape (capture phase, marked handled, so a Dialog under it stays
  open: step 0 review, finding 7) and outside presses; it stands down while
  a Dialog or a Menu opened after it is open; a press inside a kit `Menu`, a
  kit `Dialog` or a child Popover is not outside (§8 KR-1).
- **The picker:** the search field has the keyboard on open; ↓ moves into
  the list; Space ticks; Escape closes; Tab from its last control goes to
  the control after the cell and closes it, Shift+Tab from its first returns
  to the cell.
- **The bar:** its buttons follow the toolbar (or the strip) in the Tab
  order; saving moves focus to the Views button.
- **Announcements:** one polite live region per table on screen, always
  mounted, speaks the bar's state, every reorder and every drag between
  groups.
- **Names:** the layout tabs' group is labelled "Layout" for screen readers.
- **Motion:** opacity only, in `--duration-response` (200ms) on
  `--ease-response`; with reduced motion, all of it appears at once
  (`v2Motion.test.js`).
- **Contrast and type:** the Dense step for the button and the rows, the
  Label step for section labels, the muted ink for summaries; the kit's
  focus rings.

### 4.10 Widths when a view hides or adds columns (Q7)

- **All six tables take their fixed sum and their minimum width from the
  columns on screen**, as inline custom properties on the table's wrapper;
  the Tasks sum includes the item columns a project shows.
- **The spare is divided by the number of visible growable columns**
  (`--…-grow-n`; today's literal `3` goes), and is not used when none is
  visible.
- **With no growable column visible, the table is `width: min(100%, fixed
  + 360px)`**: no filler column.
- **Alignment keyed on a column, not a position**: Bid's header padding
  moves to `data-col="bid"`.
- A test per table hides every growable column and holds the name at 360px
  or less; one shows every column and checks the minimum width.
- **Tasks (VW1b; step 0 review, finding 6).** The growable columns are the
  five item columns (each at least 150px, Q-G2: they hold lists of names, the
  reason the Asset column grew), Phase and Assignee; the checkbox, Status,
  Priority, the two dates and Bid are fixed. The view computes, from the
  columns on screen, `--rb-task-fixed` (the sum of every visible column's
  width or minimum) and `--rb-task-grow-n` (the number of visible growable
  columns, at least 1, so the division is never by 0) and sets them as inline
  custom properties on `.rb-task-table-wrap`: one pure function whose output
  is only those two properties, and one entry added to the lane guard's
  `STYLES_ALLOWED` with a control. With no growable column visible (VW1d),
  `data-grow="none"` gives the table `width: min(100%, var(--rb-task-fixed) +
  var(--rb-task-title-max))`. An asset-only project's numbers are exactly
  today's (three growable columns). In the sheet's arithmetic (content boxes
  1256, 1416 and 1896, as `rabbitRowTitles.test.jsx` measures them): a film
  project (Asset, Scene, Shot; fixed 1322, narrowest 1538) scrolls 282px at
  1280 and 122px at 1440 with the Title at 216; at 1920 each growable column
  takes 42.8px more and the Title is 360. With all five kinds (fixed 1622,
  narrowest 1838) it scrolls 582px and 422px; at 1920 nothing scrolls and the
  Title is 274. `rabbitRowTitles.test.jsx`'s Tasks arithmetic gains these
  cases; its asset-only numbers stand.
- **Bid's alignment** keys on `data-col="bid"`, on Bid's head cell and on
  every row's Bid cell (the key dates' rows too), not on `:last-child`.

### 4.11 Combination groups and *Create grouping* (Q-D, Q-D1–D5, Q-M3)

- **Where:** the Tasks table and Board grouped by Asset, Scene, Shot, Level
  or Experience; Assets grouped by Scene, Shot, Level or Experience (the
  ones an asset is in: `scene_ids`, `shot_ids`, `level_ids`,
  `experience_ids`); Levels and Experiences grouped by Asset (the assets that
  name them). The Timeline grouped by asset, scene, shot, level or
  experience shows the Tasks table's combination groups as its rows, and has
  no *Create grouping* (VW1m builds the Timeline's half).
- **The groups (the Tasks half built by VW1m; Scene, Shot, Level and
  Experience reach the Group menu in VW1b):** one group per set of items
  rows are linked to, named by its items in the display order ("Lighthouse
  Interior, Storm Lantern": assets, levels and experiences by name, numbers
  read as numbers; scenes by number; shots by their scene's number, then
  their own), the empty set as "No asset" (or "No scene", …); a row sits in
  exactly one group, so the groups' counts add up to the rows'. The order
  (step 0 review, finding 10): a group for each single item in the project's
  own order (the active shot list's, for scenes and shots), then the
  combinations by their name, then "No …" last. In a table a group exists
  while a row is in it (the Tasks Status grouping excepted, Q-I); the Board
  keeps a column for every single item, empty or not (Q-I). The project's
  groupings (below; VW1c, VW1d) show even while empty, except while one of
  their items is in the trash (§5.2: hidden with it, back on restore); the
  *Hide empty groups* switch (VW1d) hides the empty ones for that view.
- **Dragging a row into a group makes that group's items the row's**
  (Q-D1): any others come off; dragging into "No asset" takes them all off;
  the undo toast puts them back, and is the announcement. Its items in the
  trash are kept (Q-N4), so a restore puts them back; a drop on the group the
  row is in writes nothing and shows no toast; where the backend keeps no
  items a group is one item or none and the drop writes that single field
  (VW1m, step 0 review finding 15). A seat that cannot write cannot drag.
- ***Create grouping*** (VW1d, with its data in VW1c) (Q-D3): a toolbar button beside the Group dropdown,
  shown only while the table is grouped by a linked kind, hidden from a seat
  that cannot write (Q-F). It opens the kit `Dialog` "Create grouping":
  a search field and a check box for every item of that kind in the project
  (with what tells same-named items apart), the grouping's name made from
  the ticked items as they are ticked, *Cancel* and *Create* (at least one
  item ticked; a combination that already exists says so instead). Created,
  the grouping shows at once, empty, ready for rows to be dragged in.
- **Saved for the project** (Q-D2): every view of that table grouped by that
  kind shows it, for everyone; the Timeline shows the Tasks table's.
- **Removed from the group's *…* menu** (Q-D5): *Remove grouping* asks
  first; rows keep their items, and a group that still holds rows stays as
  any combination with rows does.
- **On the cloud** assets carry no level or experience links today (the
  cloud adapter drops `level_ids` / `experience_ids`); Levels' and
  Experiences' grouping by asset, and Assets' grouping by level or
  experience, need them there too (her A9 rule), so the session that builds
  those groupings adds them to the cloud.

---

## 5. The data

### 5.1 A view

```
{
  id, project_id, workspace_id,
  table_key: 'tasks' | 'assets' | 'scenes' | 'shots' | 'levels' | 'experiences',
  name,                      -- 1 to 80 characters, trimmed; duplicates allowed
  position,                  -- the order in the dropdown (Q5c); >= 0
  revision, revised_by,      -- a new revision (from a sequence) on insert and on every config change, and who made it
  config: {
    version: 1,
    layout: 'table' | 'board' | 'gallery',         -- Q8; board for Tasks only
    filters: [ { field, op, values: [...] } ],     -- Q13; every row must match; incomplete rows never stored
    sorts:   [ { field, dir: 'asc' | 'desc' } ],   -- Q14; in order
    group:   { field, hideEmpty } | null,          -- Q15, Q-I
    board:   { field, hideEmpty },                 -- Tasks only: the Board's columns (Q-C)
    fields:  [ { key, visible } ],                 -- Q6, Q7, Q-E: the order and visibility, for the table and the cards
    leading: [ { key, visible } ],                 -- Q-J: the columns in front of the name, visibility only
    keyDates: true | false                         -- Tasks only (Q6)
  },
  created_at, created_by, updated_at, updated_by
}
```

- One reader turns a stored config into the table's state and **never
  throws**: a key the table does not know is ignored on read and kept on
  write; a field the view does not list shows at its default place; an
  unreadable config opens as *All*; `version` above the client's greys
  *Save* with "This view was made by a newer WILSON."
- **Every `field` and `key` in a config is the table's column key** (VW1c
  step 0, finding 9): the Tasks table's are `views/tasksTableColumns.js`'
  (`title`, `status`, `priority`, `asset`, `scene`, `shot`, `level`,
  `experience`, `phase_id`, `assignee_id`, `start_date`, `end_date`,
  `bid_days`), a linked kind by its kind name. Today's three vocabularies
  for one thing (the columns' keys, the Group menu's values `phase` /
  `assignee`, the Filter strip's `phase_id` / `asset_id`) are mapped to it
  once, where the screens hand their state to the views (VW1d); the other
  tables' keys come with their descriptions (VW1e).
- A filter's `values` hold ids for linked rows and words for the rest; a
  value whose row is gone matches nothing and the card shows it as "No longer
  in the project".
- *All* is never stored. `allViewOf(tableKey)` (§5.5) builds it: no filter,
  no sort, `fields: []` (every field at its default place), the grouping as
  today (the Tasks table none and its Board by Status; Shots by Scene; the
  rest none) and *Hide empty groups* as today (Q-I).
- **The revision** comes from one sequence for every view, so no view ever
  has a number another view had, even one deleted and made again with the
  same id (an undo): a change for now can never be saved over a view that
  only looks unchanged.

### 5.2 A grouping (Q-D2)

```
{
  id, project_id, workspace_id,
  table_key: 'tasks' | 'assets' | 'levels' | 'experiences',
  kind: 'asset' | 'scene' | 'shot' | 'level' | 'experience',   -- the pairs §4.11 allows
  entity_ids: [ ... ],       -- 1 to 100 ids, the set: stored sorted and distinct, unique per (project, table_key, kind)
  created_at, created_by, updated_at, updated_by
}
```

A grouping names a set of items; it holds no rows. Rows join it by having
exactly its live items, and a grouping whose set is a combination that rows
already have IS that combination's group: never two groups for one set.

- **Made:** every id names a live row of its kind in the project, checked
  by the database as the person who makes it (so an asset in the trash, or a
  row of another project, is refused); at most 100 items (VW1c step 0,
  finding 7).
- **An item in the trash** (an asset, on the cloud and in the fixtures; her
  Q-N4): a grouping shows only while every item it names is live. It hides
  with its item and comes back on restore; nothing stored changes (finding
  3).
- **An item deleted for good** (a scene, shot, level or experience, which
  have no trash; an asset at the 30-day purge; every item on the signed-out
  desktop) leaves every grouping that names it, and a grouping left with no
  items, or left naming the same set as another grouping, goes (findings 1
  and 2). The undo of such a delete puts the row back, then the groupings it
  took the item from, as they were (the provider, §5.5): one the delete
  removed is made again with its id; one it shrank is made again first,
  under a new id, and the shrunk row removed only after, so a set the
  backend refuses (the row did not come back) leaves the shrunk grouping
  as it was and the notice says so (VW1c review round 1, R1-1).

### 5.3 The cloud: one migration for both (VW1c)

**`table_views` and `item_groupings`**, in one migration: **0098, with
suite 101** (VW1m took 0097 / 100 for the main item; 0099 / 102 were DG1's
and stay unused). The house's pattern from 0096: pre-flight checks and a
re-run guard, the tables, triggers, RLS forced, grants, the functions, the
broadcast restated whole, post-conditions.

- **`table_views` columns** as §5.1; `table_key` CHECKed to the six; `name`
  CHECKed (trimmed, 1 to 80 characters, no control characters); `config` a
  JSON object of at most 32 KB as text; `position >= 0`; the project a
  same-workspace composite foreign key (`projects_id_workspace_key`), `ON
  DELETE CASCADE`.
- **`item_groupings` columns** as §5.2; `table_key` and `kind` CHECKed to the
  pairs §4.11 allows; `entity_ids` 1 to 100 ids, one dimension, no NULL,
  sorted and distinct (an immutable helper in the CHECK), unique per
  (project, table_key, kind, entity_ids), a GIN index for the sweep below;
  the project a same-workspace composite foreign key, `ON DELETE CASCADE`.
- **Triggers**, named so the BEFORE triggers fire in name order *audit →
  cap → pin → populate_workspace → validate* (VW1c step 0, finding 19):
  `fn_audit_touch`; the caps, which take a transaction lock on (project,
  table key) and refuse in words past 200 views, or 500 groupings, per
  project and table (`54000`); the pin, which on a signed-in insert stamps
  `created_by`, `updated_by`, `created_at` and `updated_at` itself and on an
  update keeps `created_by` and `created_at` (VW1's trap 7), and for views
  takes `revision` from `table_views_revision_seq` on insert and on every
  change of `config` (`revised_by` = the caller; a rename or a reorder keeps
  both), and for groupings sorts the ids and drops repeats; the workspace
  stamped from the project; for groupings, the check that every id is a row
  of its kind in the grouping's project, run as the caller (so the trash and
  a private project hide what they hide), else `23503` in words.
- **The sweep** (findings 1 and 2): `fn_item_groupings_forget(kind)`, an
  AFTER DELETE trigger on `assets`, `scenes`, `shots`, `levels` and
  `experiences`, **SECURITY DEFINER** (`SET search_path = public`, EXECUTE
  revoked from PUBLIC, anon and authenticated; 0086's shape): a project
  member's scene delete runs as that member, who holds no UPDATE on
  `item_groupings`, and an array carries no foreign key whose cascade would
  run as the owner. It takes the deleted row's id out of every grouping of
  that kind in its project; a grouping left empty, or left naming the set of
  another grouping of the same table and kind, is deleted instead (the
  unique key would refuse the delete, and on the nightly purge roll back the
  whole sweep); while the project itself is being deleted it does nothing
  (its groupings go with it).
- **RLS (Q2):** four policies on each table, each reaching the project
  through `projects` under the caller's own RLS (the private-project arm;
  a `return=minimal` insert is judged by its own policy), plus
  `has_active_membership` and the workspace arm; insert, update and delete
  also need `can_write_project(project_id)`. UPDATE's `WITH CHECK` equals its
  `USING`. Every arm restated in full and proved in the suite (the 0062
  lesson).
- **Grants:** `table_views`: SELECT, DELETE; INSERT on `(id, project_id,
  table_key, name, position, config)`; UPDATE on `name`, `position`,
  `config`. `item_groupings`: SELECT, DELETE; INSERT on `(id, project_id,
  table_key, kind, entity_ids)`; no UPDATE (a grouping is replaced, not
  edited). The client creates with `insert` and saves with `update`, never
  `upsert`. `table_views_revision_seq`: everything revoked from PUBLIC, anon
  and authenticated, then USAGE to authenticated (the caller's `nextval` in
  the pin) and service_role; stated and pinned, not left to the schema's
  default privileges (finding 11).
- **`reorder_table_views(project, table_key, ids[])`**, SECURITY INVOKER,
  0096 §6's rule (finding 12): 22023 for an unknown table key, a NULL id or
  a repeated id; the named views first in the order given, every other view
  of that project and table after them in its current order (a teammate's
  new view a stale list did not name lands after, never colliding); positions
  dense from 0; an id of another project or table ignored; returns the rows
  it moved. Ties in position read by `created_at`, then `id`, everywhere (the
  load, the dropdown, `COLLECTION_ORDER`).
- **The last used view (Q4):** `user_settings.table_view_last`, a JSON
  object CHECKed to 64 KB: `{ "<project id>:<table key>": { "view": <view id
  or "all">, "at": <the server's clock, epoch milliseconds> } }` (about 135
  bytes an entry, 40 KB at 300). `set_table_view_last(p_key, p_view)`,
  SECURITY INVOKER: 22023 unless `p_key` is a project id and one of the six
  table keys and `p_view` a view id or `all`; one statement (`INSERT … ON
  CONFLICT (user_id) DO UPDATE`) that merges the key and keeps the 300
  newest by `at`, the first-ever write inserting the person's row (`user_id`
  defaults to `auth.uid()`, under `user_settings_insert`); returns the map.
  The row is the person's own and its grants are table-wide, so the column
  is not fenced: the client writes it only through the function (finding
  10). Read by its own request, never inside `fetchCloudSettings` /
  `saveCloudSettings`, which select and upsert only their two columns; suite
  57 proves the first-ever write, the trim, the refusals, and another
  person's row untouched.
- **Live (Q3d):** both tables join `fn_realtime_broadcast`'s project arm
  (eighteen tables), the function restated whole; 0098's §0 accepts 0096's
  body (a first run) or its own (a re-run) by md5 and refuses a re-run after
  a later migration. **The pins that move with it** (finding 5): suite 72
  probe 10 and suite 99 probe 16 (the exact set of tables carrying the
  trigger), suite 100 probe 7 (the body's md5, now 0098's), and
  `state/realtimeMerge.test.js`'s list of tables; suites 20, 23, 94 and 95
  hold unchanged, their arms restated word for word. `realtimeMerge.js` maps
  the two to `tableViews` and `itemGroupings` with their `COLLECTION_ORDER`;
  an older client ignores unknown tables.
- **A client ahead of its database:** `loadProject`'s reads of the two
  tables are the migration's probe (`42P01` / `PGRST205` → empty and
  unavailable; any other error → an error state, never a failed load).
- **The suite, 101** (`101_table_views.sql`): every role against every verb
  on both tables; the grants (an `upsert` refused, the sequence's); the
  CHECKs; the pin; the revision; the caps; the ids' check (another project's
  row, a trashed asset, an unknown id); the RPC under RLS; the sweep (a
  member's scene delete shrinks a grouping, the collision, the empty
  grouping, the purge's path, a client cannot run it); the broadcast. VW1m
  taught the three-digit suites (the coverage guard, `tap-all.mjs`, the
  replay list's pin); what is left: the replay line gains
  `101_table_views.sql` and `storage/rlsSuiteLists.test.js` its pin.
  **Coverage** (finding 4): the guard demands a suite named exactly for each
  table in `RLS_TABLES`, so `table_views` joins `RLS_TABLES` with
  `101_table_views.sql` and `item_groupings` maps to it in `COVERED_BY`
  (93_bins' shape), in the suite's commit.
- **Applied to wilson-dev only**, rehearsed rolled back first through
  `scripts/tap-hosted.py`, by `supabase db query --linked --file …` plus its
  history row; the Desktop kit section; the staging lines in the hand-off.
  Never `db push`; never staging or prod.

### 5.4 The desktop signed out (the Local Server)

- Views and groupings ride in the project's file as `tableViews` and
  `itemGroupings`, through their own module, `electron/rabbitTableViews.cjs`
  (the CommonJS twin of the model's backend half, §5.5): routes under
  `/api/rabbit/projects/:projectId/table-views` (GET, POST, PATCH `/:id`
  with the revision or the name it expects, DELETE `/:id`, POST `/reorder`)
  and `/item-groupings` (GET, POST, DELETE `/:id`); every write through
  `writeRabbitBundle(…, { touch: false })`, so the project does not move to
  the top of the Projects list and the `_DATABASES` mirrors, which carry no
  views, are not rewritten (finding 16); the cloud CHECKs' twins and its
  caps; the revision from a counter kept in the file and never reused; the
  reorder; a 409 `{ code: 'table_view_stale', row }` carrying the stored row
  when a save's revision (or an undo's name) is stale, the shot lists'
  `edit_saved_since` shape; an item's delete leaves the groupings that name
  it, by a hook on the generic delete routes and the asset route (as
  `taskItemHooks`) and a prune on read.
- No roles: anyone using the desktop may save views and create groupings. No
  live channel: a teammate's save on a shared NAS project shows the next time
  the project loads.
- The last used view is per computer (finding 8): the machine's own file
  `<data folder>/rabbit-machine-settings.json` (`{ tableViewLast }`), read by
  `GET /api/rabbit/machine-settings`, written by `POST
  /api/rabbit/machine-settings/table-view-last` `{ key, view }`, which merges
  that one key with the server's clock and keeps the 300 newest (the twin of
  `set_table_view_last`). The handler is synchronous, so two windows' writes
  never lose each other's key (a whole-file write would). Never
  `localStorage`: the page's address changes at every launch (VW1's trap 5).

### 5.5 The other backends and places

- **The model** (finding 15): `state/tableViewsModel.js`, pure: the six table
  keys and the grouping pairs, the name rule, the never-throwing config
  reader and the writer that keeps unknown keys, *All*, the order of views,
  a grouping's set (sorted, distinct, its key, whether it is live), the
  sweep's rule (an item gone: shrink, or go when empty or a repeat), and the
  last used map's merge and trim. Its backend half is copied in CommonJS
  into `electron/rabbitTableViews.cjs`, held to it by
  `tableViewsParity.test.js` (FX2's `taskItemsParity` shape), and
  `src/dev/devFixtures.test.js` lets the fixtures import it.
- **The dev fixtures:** empty `tableViews` and `itemGroupings` (Q20), the same
  verbs in memory with the cloud's rules (the revision, the caps, the ids'
  check, the conditional save answering as the cloud does, the sweep on a
  hard delete), the last used map in memory.
- **Google Drive:** loads both empty and unavailable; the dropdown and *Create
  grouping* show *not on this server yet* up front.
- **The provider** (`RabbitProvider.jsx`): `ctx.tableViews`,
  `ctx.itemGroupings`, their availability; the mutators `addTableView`,
  `updateTableView`, `renameTableView`, `deleteTableView`,
  `reorderTableViews`, `addItemGrouping`, `removeItemGrouping`, and the
  drag's `setTaskItemsOfKind` (one undoable write of a task's items of one
  kind, VW1m's), each in `mutationsRef`, each with its undo toast and kept
  out of the keyboard history (the toast's own undo, not a history entry);
  `ctx.tableViewLast` and `setTableViewLast` (the map read once a sign-in,
  its 2s wait, §4.5); the changes-for-now store (per project and table: the
  view it started from, that view's revision, the config; dropped on a
  project switch or a reload); selectors `viewsOf(tableKey)`,
  `allViewOf(tableKey)`, `groupingsOf(tableKey, kind)`.
  - **Undo** (§4.4): a settings save's undo writes the old config only while
    the view still has the revision the save left; a rename's only while it
    still has the name it set; a reorder's always; a new view's undo deletes
    it only while it still has the revision it was made with (a teammate's
    save is never thrown away); a delete's undo makes the view again with
    its id (a new revision); a grouping's add is undone by removing it, its
    removal by adding it again. A refused undo says why and closes; one
    whose request never answered keeps the toast to try again (round 1,
    R1-4). A removal the cloud's policies filter out keeps the grouping on
    screen (R1-3).
  - **A delete for good takes items out of groupings** (§5.2): the provider's
    delete of a scene, shot, level or experience (and of an asset, where the
    backend removes the row: the desktop) remembers the groupings it touched
    and its undo puts them back as they were after the row, as VW1m's undo
    puts a task's items back.
  - **Who changed a view** (finding 14): `revised_by` is named through the
    workspace directory (`listTeamMembers`), "Someone" when it is not there
    (a company admin without a seat is in the directory; a removed member is
    not); on the desktop it is empty, and the bar says "another computer"
    (VW1d's words).
- **The bundle-key places** (finding 17), for both collections: `EMPTY_BUNDLE`
  (`RabbitProvider.jsx`); the bundle's typedef (`adapters/index.js`); each
  adapter's `loadProject` (the cloud's, the Local Server's normaliser, the
  fixtures', Drive's explicit list); `electron/main.cjs`' `emptyBundle` and
  `readRabbitBundle`'s old-bundle step; the three key lists
  (`adapters/loadProjectBundle.test.js`' `EXPECTED_KEYS` and its Drive
  loader pattern, which reads the last key; `supabaseLoadProject.test.js`'
  `CLOUD_BUNDLE_KEYS`; the fixtures' contract `BUNDLE_KEYS`);
  `state/mutationsRegistry.test.js` (every new mutator registered);
  `TAKEOUT_TABLES` (the takeout carries both tables; `table_view_last` is a
  person's own and stays out, as the rest of `user_settings` does). The
  desktop's readable `timeline.json` names schedule rows only and takes
  neither.
- **The move to the cloud** (finding 18): both carried with their ids, by
  insert (never upsert), after the scenes and shots they may name, through
  the cloud adapter's column allowlist, which strips `workspace_id`,
  `revision`, `revised_by` and the audit four; groupings of levels and
  experiences, and filter values naming levels and experiences (which the
  move does not carry), are counted in its report as left behind.
- **The old views (Q17):** each table's browser key is removed on the first
  load after its new views ship; Expenses' and Team's are untouched.

---

## 6. One shared piece, five tables

The Views button, the dropdown, the cards, the shared filter row, the bar,
the combination grouping and *Create grouping* are one R.A.B.B.I.T.
component (`views/tableViews/`), given each table's description: its key,
its fields (key, label, kind), its leading columns, its filterable,
sortable and groupable fields (and which are linked kinds), its defaults
(*All*), and how to read a row's value for a field. The five views keep
their own toolbars and tables and hand their state to it. **`ScenesView.jsx`'s
change is its own step** (the plan's unsafe file): its two modes' state,
*List order* and the Move up / Move down gating move behind the shared
component's two tables, and its dropdown, save row and saved-view handlers
go.

---

## 7. The build, in order

Re-ordered by her Q-M4 (2026-10-16): the main item goes first, in its own
session; then the build as planned, with her later answers in it.

| Step | What | Session |
|---|---|---|
| 0 | The design's two review rounds (done, §11); her answers (all in) | VW1 |
| M | **No main item** (Q-D4, Q-M1, Q-M2, Q-M4): measured first, every place "main" is read (as FX2 did), the questions that list raises asked in that session (the task window's Items table without *Main*, its order, the files under it, what a bid version keeps, the Dashboard's task window, the Timeline's rows); the database change (its own migration: the tasks' single item columns and their triggers, the delete rule: deleting an asset never deletes a task); the Timeline grouped by combination (no *Create grouping*); the Budget's split; every other reader; reviewed twice | **VW1m** |
| 1 | **The Tasks table's item columns** (§4.6): the cells, the picker, the new columns, the combination groups (§4.11) for the table and the Board (without *Create grouping*, whose storage is step 3), dragging between groups, the Asset filter matching any asset, the sticky name and sideways scroll, the widths from the columns on screen; the kit requests Popover and Table sticky columns | VW1b |
| 2 | **The counts** (§4.7) | VW1b |
| 3 | **The data:** the views' and groupings' migration + suite (§5.3), suite 57's column and `set_table_view_last`, the adapters with the probe, the Local Server's `rabbitTableViews.cjs`, the fixtures, Drive, the provider, the undo toasts, live merge, bundle keys, the move to the cloud, the takeout | VW1c |
| 4 | **The views on Tasks:** the button and the *New* menu (Q-A1), the dropdown, the cards, the shared filter row (defects 1, 2), the bar, the last used view and the wait, changes for now, the keyboard (defect 5), *Create grouping* on Tasks and the Timeline's rows for the project's groupings; Tasks' old key removed | VW1d |
| 5 | **The other tables:** Assets, Levels and Experiences (their views; their combination groups and *Create grouping*, with the cloud's asset–level and asset–experience links), then Scenes and Shots as their own step (two lists; defects 3 and 4); their old keys removed | VW1e |
| 6 | Walkthrough 72 (each session adds its part; VW1e completes it), `docs/OUTSTANDING.md`, the help pages (`rabbitHelpContent.jsx`), `docs/SYSTEMS_HANDBOOK.md` (§4.5, §13.3, §17), the hand-offs, the merges | each session |

Every session: a review of the parts of this design it builds that are not
yet reviewed (her 2026-10-16 additions) before its code; two adversarial
code review rounds at its end (one reviewer each, the second attacking the
first's corrections), each correction asserted with a failing control
before its commit; the `npx vitest run --maxWorkers=4` count stated;
pictures at 1280x700 and 1440x900; every export with a caller; every new
mutator in `mutationsRef`; the fixtures' seams; the lane-prefix CSS test.

---

## 8. Kit requests (each lands with its first caller)

- **VW1-KR-1 `Popover`** (`src/ui/Popover.jsx`): a non-modal floating card,
  `role="dialog"` with a label (never `aria-modal`), paper-raised, 6px
  radius, the one shadow, opacity-only motion. *In place* (rendered right
  after its trigger; Tab continues to the next control and Tab out closes
  it; as tall as the room below less 12px) when no ancestor clips it (the
  Views dropdown; built with that caller, VW1d). *Portalled* (built by VW1b
  with the item picker, inside the table's scroller; step 0 review, findings
  7 and 8): into `<body>` with `position: fixed` from the trigger's box at
  its open; under the trigger's left edge, above it when under 240px is free
  below and more above, 12px inside the window's edges, at most the room on
  its side less 12px, scrolling inside past that with its scroll contained
  (`overscroll-behavior: contain`: a wheel over it never scrolls the table).
  A caller whose trigger can sit partly under a cover names `minLeft`, the
  card's least left edge (VW1b code review round 1, R1-6: the Tasks cells
  pass the sticky Title's right edge). A caller with a long list makes its
  list the scroller, so its search stays in view (R1-7).
  **Layers:** z-index 70, the Dialog's own, so equal layers stack in
  document order: a Dialog opened from it (the last item's question) covers
  it, and a Popover opened from a Dialog sits over that Dialog; under the
  Menu (80) and the toasts (90), over the drawer (60). Kept on a stack in
  `overlay.js`; only the top Popover answers Escape and outside presses, and
  it stands down while a Dialog or a Menu opened AFTER it is open
  (`modalDepth()` and `menuDepth()` read at its open). It hears Escape in the
  capture phase and marks it handled, so a Dialog under it (whose listener
  checks `defaultPrevented`) stays open. `overlayOpen()` counts it. A press
  outside closes it, but not one on its trigger (whose own click toggles
  it), in a kit Menu, a Dialog or another Popover. A scroll of anything that
  holds the trigger, heard from the frame after its open (its own opening
  must not close it), or a window resize closes it: its place was measured
  once. **Focus** in on open (a named control, else the first); back on close
  to the trigger its caller names now (the cell's row may have re-rendered),
  else the first trigger, and only when focus was still in the card (a press
  elsewhere keeps its own focus). It keeps the Tab order a portal would
  lose: Tab from its last control closes it and moves on to the control
  after the trigger; Shift+Tab from its first returns to the trigger.
- **VW1-KR-2 Table sticky columns** (`src/ui/Table.jsx` + `src/index.css`;
  VW1b; step 0 review, findings 4 and 5): `stickyColumns={n}` (1 to 3) keeps
  the first n columns in place while the table scrolls sideways
  (`border-collapse: separate` is what makes sticky cells possible: keep it).
  - **Insets, measured.** The Table reads its sticky head cells' widths (a
    `ResizeObserver`) into `--ui-sticky-<k>` on the table, the left inset of
    column k. A sticky cell holds at the scroller's PADDING edge (measured in
    Chromium 152 at step 0: `left: 0` in a scroller padded 12px holds at
    12px from its border), so the first inset is 0, not the gutter.
  - **Focus.** A control focused under the sticky columns (Shift+Tab back
    along a row scrolled sideways) is scrolled clear of them, with its focus
    ring's 4px; a control in a sticky place (a sticky cell, a band's sticky
    words) moves nothing. Not `scroll-padding-left` (VW1b code review round
    1, R1-2, measured): Chromium reads everything left of it as outside the
    view, so focus landing IN a sticky cell (a title's rename field, the next
    row's checkbox on Tab) threw the table back to its start, and a control
    only partly under the cover was not moved at all. A POINTER press moves
    nothing (round 2, R2-3, measured): its focus lands on the press, before
    the release, so the control slid from under the pointer, and a press
    within the ring's 4px of the cover's edge was lost (no click).
  - **Layers over them.** A lane layer that lies over the sticky cells sits
    above their z-index: the Tasks bulk bar (4, over the head's 3) and the
    drag-over band stuck under the head (2, over the body's 1) — R1-1, R1-3.
  - **The gutter covered.** The scroller's own left padding (its gutter,
    `--ui-sticky-gutter` where the lane pads it) is covered by the first
    sticky cell, or the cells scrolling past would show through it.
  - **Paint.** Every head cell of a table with sticky columns `z-index: 2`,
    its sticky head cells 3; body sticky cells 1. A sticky cell's ground is
    the surface's paper at every state (dark `--color-paper`, light
    `--color-surface-light-solid`), and a state's tint reaches it as a
    `background-image` (the drag mark's own pattern): the kit's selected and
    interactive-hover fills do so, and a lane re-points its own row fills
    for its sticky cells (the Tasks hover; `rabbitTasksCss.test.js`'s
    `kitFights` measures the result). The selected row's 2px edge is on the
    first cell, which is sticky, so it stays in view.
  - **A spanning cell** (a group's band, the add row) is not sticky; its
    content is (`position: sticky; left: 0`, at its own width), the cell made
    `overflow: visible`: a `.ui-td`'s `overflow: hidden` would make the cell
    the content's scroll container, and the content would never move.
  - **No `<th scope="row">`** (finding 5): the Title cell holds the row's
    three buttons, so a row header would read them out with every cell, and
    sticky needs no `th`. A row header is its own request once RowTitle's
    buttons are reconsidered.
- **VW1-KR-3 `MenuButton`** (from `views/scenes/MenuButton.jsx` to
  `src/ui/`): a button that opens the kit `Menu` with a keyboard model and
  stays shown while its menu is open. Callers: the views' *…*, the Tasks
  toolbar's *New* (Q-A1), the groups' *…* (*Remove grouping*), then the
  Scenes rows that use it today.
- **VW1-KR-4 `Banner` `live` prop** (`src/ui/Banner.jsx`): `live={false}`
  drops the Banner's own live role. Caller: the bar.

---

## 9. Known limits (the walkthrough names each)

- **The signed-out desktop has no roles** (anyone using it may save views
  and create groupings) **and no live channel** (a teammate's save on a
  shared NAS project shows the next time the project loads; its bar names no
  person).
- **The Budget's split shows fractions of a day** where a task has several
  items (Q-M1).
- **A filter value whose row is gone matches nothing**; a deleted view does
  not say who deleted it.
- **A grouping names at most 100 items**, each a live row of the project
  when it is made, and **hides while one of its items is in the trash**
  (her Q-N4); deleted for good, the item leaves it (VW1c).
- **A view's settings are at most 32 KB**, and a project's table holds at
  most 200 views and 500 groupings; the last used map keeps a person's 300
  newest tables (VW1c).
- **Scenes, shots, levels and experiences are not on the live channel**: a
  row a teammate has just added, and a task's item naming it, show at the
  next load; until then the item is hidden, like one in the trash (Q-N4).
- **A Board grouped by Scene or Shot** shows a column for every scene or shot
  of the active list, empty ones included (her Q-I), until the view's *Hide
  empty groups* (VW1d).
- **A cell and its group's band can name the same items in two orders**: the
  cell follows the task window's Sort (Q10), the band the display order
  (§4.11).
- **On the cloud a level's or experience's Assets count is 0** until VW1e
  carries assets' level and experience links there (§4.7).
- **Budget's Expenses and the Team tab** keep their old saved views (Q19)
  and their keyboard gap (P1-08 for those two).

---

## 10. Her questions: all answered

Asked 2026-10-13 (batches 1–8) and 2026-10-16 (batches 9–13), every answer
verbatim in `CUSTOM_VIEWS_QUESTIONS.md`; §1 carries each ruling. What is
still to ask is VW1m's: the questions its measured list of every place the
main item is read will raise (the task window's Items table and its order,
the files under it, what a bid version keeps, the Dashboard's task window),
asked in that session.

---

## 11. The review rounds (the design of 2026-10-13; VW1b's parts at its step 0; §5 at VW1c's)

The two rounds reviewed the design before her answers of 2026-10-16. Their
findings and corrections stand where her later answers did not replace
them; where they did (the *edited* marker, the main item, the interim
choices), her answer rules.

### Round 1 (one Opus reviewer, read-only, 2026-10-13) — 23 findings

Three high (the named button widening the Tasks toolbar; no path for a
client against a database without the migration; a hidden column's width
going to the name), eleven medium, nine low or low-medium; every one taken
(the full table is in this file's history at `de3f4fcb`).

### Round 2 (one Opus reviewer, read-only, attacking round 1's corrections at `b7930077`) — 17 findings

One high (the Tasks toolbar has about 42px to spare at 1440, not 102:
re-measured live), eleven medium or medium-low, five low or low-medium;
every one taken (the full table is at `de3f4fcb`).

### Round 3 (VW1b's step 0: one Fable reviewer, read-only, 2026-10-17, against VW1m's code at `6ed89048`) — 21 findings

The parts her answers of 2026-10-16 and 2026-10-17 added that VW1b builds
(§4.6, §4.7, §4.10's and §4.11's Tasks halves, §8's KR-1 portalled and
KR-2). Corrected above; the claim one correction rests on was measured in
the browser first (finding 4's insets).

| # | Severity | Finding | Taken |
|---|---|---|---|
| 1 | high | the cell's "No longer in the project" and "Not loaded yet" cannot be told apart from what the bundle holds and contradict Q-N4; nothing could schedule the re-read | struck (§4.6, §9) |
| 2 | high | "the order the task's window lists them" is the window's per-computer Sort, not the display order the band uses; her 2026-10-17 answers change what *Type* and *Date* mean | her two answers written into §4.6; the cell keeps the window's Sort (her Q10's own words and VW1b's brief), the band the display order; the mismatch is a known limit and a walkthrough question. **Not taken:** the display order for the cell (it would part the cell from the window Q10 ties it to) |
| 3 | high | a tick written at once moves the row when grouped by that kind (the cell unmounts under the Popover), and the raw item verbs are not queued for the undo toast | a draft committed once on close through the queued `setTaskItemsOfKind`, inside `runWithUndoToast` (§4.6) |
| 4 | high | KR-2 unbuildable as written: a sticky child of a `.ui-td` sticks to the cell; paint order unspecified; row fills are cell backgrounds | paint order, grounds and tints as images, the spanning cells made `overflow: visible`, the measured insets (§8). **Not taken:** insets of 12px and 48px: measured, a sticky cell already holds at the padding edge; the gutter is covered instead |
| 5 | medium-high | a `<th scope="row">` Title cell would read its three buttons with every cell; a pinned test counts `td`s | dropped (§8) |
| 6 | medium-high | which columns grow is undefined; the `/ 3` and the inline style collide with two tests and the lane guard | the item columns grow at a 150px minimum; inline properties through one guarded entry; `data-grow="none"`; the numbers (§4.10) |
| 7 | medium | focus has no answer for a trigger that unmounts; Escape order against the Dialog | the caller names the trigger now; capture-phase Escape, standing down for newer layers (§8) |
| 8 | medium | no layer named; the scroll rule needs exceptions | z-index 70 by document order (over a Dialog it opens from, which the reviewer's 65 would not be); the scroll heard from the next frame; contained overscroll; resize (§8) |
| 9 | medium | the window's picker is add-only, all kinds, no ticks | shared pieces named; the cell's picker new (§4.6) |
| 10 | medium | the groups' order and "A to Z" do not describe VW1m's model | VW1m's order and the display order written (§3, §4.11) |
| 11 | medium | the cloud has no asset-level links; two fixtures pin `level_id` | §4.7 |
| 12 | medium | the read-only cell reads twice | the visible part `aria-hidden`, one hidden list (§4.6). **Not taken:** a button that opens the window (VW1b's brief: text, not a Tab stop) |
| 13 | medium | "+N" needs a mechanism | measured after layout, ellipsis until then, one-name cells never measured (§4.6) |
| 14 | medium | scope untagged | each part tagged with its session (§4.6, §4.11) |
| 15 | low | the drag's rules unsaid | §4.11 |
| 16 | low | the Board by Scene or Shot shows every column | §9 |
| 17 | low | two announcements for one drag | the toast is the announcement (§4.6, §4.11) |
| 18 | low | the picker's keyboard model | one Tab stop, roving (§4.6) |
| 19 | low | no rule where the backend keeps no items | VW1m's cell there (§4.6) |
| 20 | low | the columns' keys | keyed by kind (§4.6) |
| 21 | nit | words: "Enter on it", "28px row" | §4.6 |

### Round 4 (VW1c's step 0: one Fable reviewer, read-only, 2026-10-17, against the code at `f227519f`) — 19 findings

§5 whole and what §3, §4.2 to §4.5, §4.11 and §9 ask of the data, against
the code after VW1m (0097) and VW1b, and her answers. Every claim the
corrections rest on was read again by hand first (the five item tables'
deletes, the coverage guard, the pins on the broadcast and on the bundle's
keys). Corrected above.

| # | Severity | Finding | Taken |
|---|---|---|---|
| 1 | high | the item sweep, as an ordinary trigger, runs as a member deleting a scene, who holds no UPDATE on `item_groupings`: the delete would fail (scenes, shots, levels and experiences have no trash; an array has no foreign key to cascade as the owner) | the sweep is SECURITY DEFINER, EXECUTE revoked from clients (§5.3) |
| 2 | high | a grouping shrunk to the set of another grouping breaks the unique key inside the sweep: the delete refused, and the nightly purge rolled back whole | the shrunk grouping is deleted instead (§5.3), the same rule in the desktop's and the fixtures' twins |
| 3 | high | an asset in the trash: no rule for a grouping naming it, and its shrunk label would collide with the single item's group; on the desktop an undone delete could not bring the grouping back | a grouping shows only while every item is live (Q-N4), never two groups for one set; the undo of a delete for good restores the groupings (§5.2, §5.5) |
| 4 | medium | the coverage guard demands a suite named for each table in `RLS_TABLES`; one suite cannot be named for two | `table_views` in `RLS_TABLES`, `item_groupings` in `COVERED_BY` (93_bins' shape) — the brief's "RLS_TABLES gains both" read through the guard (§5.3) |
| 5 | medium | the pins that move with the broadcast were unnamed, one of them a hash | named: suites 72 (probe 10), 99 (probe 16, the trigger set; probe 14, which counts the sixteen names, stays true) and 100 (probe 7, the md5), the live merge's test; 0098's §0 md5 pair (§5.3) |
| 6 | medium | §5.3's numbers and "three things taught first" were stale | 0098 / 101; only the replay line and its pin left to teach (§5.3) |
| 7 | medium | `entity_ids` unchecked (another project's rows, unknown ids) and unbounded | checked as the caller at insert; at most 100 (§5.2, §5.3) |
| 8 | medium | the desktop's "machine settings" had no file or route, and whole-file writes lose another window's key | `rabbit-machine-settings.json`, a GET and a one-key merge (§5.4) |
| 9 | medium-low | three vocabularies for the Tasks table's fields | the column keys, mapped once by the screens (§5.1) |
| 10 | low-medium | "written only through" `set_table_view_last` contradicts `user_settings`' table-wide grants | said as the client's rule; the key, the view and the shape validated and stated (§5.3) |
| 11 | low | the revision's `nextval` worked only through the schema's default privileges | the sequence's grants stated and pinned; one sequence kept for every view (a per-view counter would repeat after a delete and its undo, §5.1) |
| 12 | low | the reorder's rule for ids a stale list omits, and the tie order, unsaid | 0096 §6's rule; ties by `created_at`, `id` (§5.3) |
| 13 | low | "the same revision means the database refused" is in fact RLS's silent filter | that branch is "you can no longer change views"; the danger state is for a refusal with words (§4.4) |
| 14 | low | the roster cannot name a company admin or manager without a seat | named through the workspace directory, "Someone" otherwise (§5.5) |
| 15 | low | the CHECKs' twins had no named home | `state/tableViewsModel.js`, its CommonJS twin, a parity test, the fixtures' allowance (§5.5) |
| 16 | low | `touch: false` also skips the mirrors; the item deletes need a hook | said; the hook as `taskItemHooks` (§5.4) |
| 17 | low | "the bundle-key places" were implicit | listed (§5.5) |
| 18 | low | the move to the cloud must pass the column allowlist | said; levels' and experiences' groupings and filter values counted as left behind (§5.5) |
| 19 | nit | `item_groupings` lacked the audit four the triggers write; the BEFORE triggers' order unsaid | the audit four; the order by name (§5.2, §5.3) |

Not verified by the reviewer: the live channel's largest message (a 32 KB
view sends its old and new rows); staging and production (dev only).

### What rounds 1 and 2 found sound

What both rounds found sound: §1's fidelity to her answers of 2026-10-13;
the access rules (every policy hops to the project; `can_write_project` is
exactly Q2's set; private projects stay hidden); the live channel does not
widen who can read; the drafts' home in the provider; the last used map
cannot leak; the counts fix; the kit choices; the probe; the undo toast;
BEFORE triggers under column grants; the Views dropdown rendering in place.
