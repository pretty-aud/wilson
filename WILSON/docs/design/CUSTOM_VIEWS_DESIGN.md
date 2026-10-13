# Custom table views — the design (VW1, 2026-10-13)

Written to Audrey's answers of 2026-10-13
(`docs/design/CUSTOM_VIEWS_QUESTIONS.md`, every answer verbatim there) and
the research (`docs/design/CUSTOM_VIEWS_RESEARCH.md`), with the `laws-of-ux`
and `design-direction` skills loaded. **Status: reviewed twice (§11); the
questions it still has for her are §10, asked when she is back** (her words
at the end of the evening: *"leave any remaining questions for
tomorrow"*). The build starts with VW1b
(`docs/sessions/briefs/po-vw1b-custom-views-build.md`), in the order of §7.

Everything here is a consequence of one of her answers (cited as Qn) or a
house rule. Where the design had to choose something she will see and her
answers do not reach it, it says **Design default** and §10 asks her.

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
| **Hick's law / choice overload** | the toolbar at rest | Nothing new on the toolbar at rest: the Views button replaces itself and keeps one width (§4.1); the save buttons exist only while there is something to save (Q3c); the editor's power (several sorts, several values, field order) lives one click down, in the cards. |
| **Working memory** | the cards | A card opens in place of the list and the dropdown never grows past the table's top band (Q5b), so the rows stay in view and change as the filter is set. The Views button always names the view on screen, so nobody has to remember which view they are in. |
| **Von Restorff** | the *changed for now* bar | The one place a view's unsaved state is shown in words, on the kit Banner's tinted strip, impossible to miss and gone when there is nothing to save. *Save* is the bar's one primary button. |
| **Fitts's law** | the item cells | A task's items are edited where the eye already is: the cell opens the picker (Q10); the picker's tick rows are the full 28px row, not a 14px box. |

Two house rules carry as much weight: **forgiveness** (every saved change to
a view shows the shell's undo toast; Delete asks first; *Reset* is always
one click) and **her rule A6** (*"keep things relatively the same … add
things where they make sense"*): the Filter strip, the Sort and Group
dropdowns and the Table/Board/Gallery tabs stay exactly where they are and
keep working. Her standing rule of 2026-08-04 for R.A.B.B.I.T.'s controls
(*keep the button gray and explain why*, noted in `ProjectTasksView.jsx`)
applies to every verb a seat cannot use.

`design-direction`'s count for this feature: **Inks: 0 new** (the kit's
paper, paper-raised, ink, muted ink, hairline, signal). **Families: 0 new**
(Geist, Geist Mono for counts only). **Weights: 400 and 600 only**
(`src/ui/typeScale.test.js`).

---

## 3. The words

| Word | Meaning |
|---|---|
| **View** | A named, saved way of showing one table in one project: its filters, sorts, grouping (with or without empty groups), which fields show and in what order, and its layout. Shared with everyone on the project. |
| ***All*** | Each table's built-in view: every field the project uses, nothing filtered, today's default order and grouping (Shots: grouped by Scene, as today; Scenes: list order; the Tasks Board: columns by Status). It cannot be changed, renamed or deleted, and it is always first. |
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
- **Anatomy:** the kit `Button` (sm, 28px tall, the Dense step like every
  toolbar button): the BookmarkPlus icon (14), the view's name (400), a
  reserved slot for " · edited" (muted ink, shown while the view is changed
  for now, hidden but still taking its room otherwise), then a chevron. Its
  accessible name reads "Views: Shoot week" (", edited" while changed);
  `aria-expanded`; `aria-haspopup="dialog"`.
- **One width, so the toolbar never moves (Q3c; review R1-1).** The button
  keeps the width its table's toolbar has room for without adding a line,
  measured at 1440 (research §2.1): on Tasks that is about 180px in all
  (102px free beside today's 81px button), which leaves the name about 65px
  (some ten characters) beside the reserved *edited*; on Assets, Levels and
  Experiences the name may run to 180px. The name is cut with "…"; the full
  name is in the tooltip, the dropdown's row and the bar. *Design default;
  §10 Q-A asks her whether a dot for* edited *(more of the name) or a second
  toolbar line suits her better.*
- **Scenes and Shots:** the icon (28px) becomes this button, so at **1440**
  their search box and count drop to a second line, as they already do at
  1280. *Design default; §10 Q-B.*

### 4.2 The Views dropdown

A non-modal floating card (the kit request **Popover**, §8), anchored under
the button's left edge, 300px wide while it shows the list, paper-raised,
6px radius, the one shadow; it never runs past the window (it scrolls inside
past the window's height less 24px). Opening moves the keyboard to the
ticked view; closing returns it to the button.

From top to bottom:

1. **Views** (a section label at the Label step, capitals):
   - *All*, then the project's views in their order (Q5c). The list is one
     Tab stop; ↑ / ↓ move between its rows (review R1-10). Each row: a tick
     and `aria-current="true"` for the view on screen, the name (cut with
     "…"), and, on hover or focus, the row's actions: a drag handle at its
     start (a button named "Move Shoot week, 2 of 4"; Alt+↑ / Alt+↓ move the
     row while the handle has focus) and at its end *Move up*, *Move down*
     and the *…* button (FX2's Items table's hover buttons).
   - **Choosing a row** applies that view, makes it this person's last used
     view on this table (Q4) and closes the dropdown (review R1-18). If the
     view on screen is changed for now, the choice first asks: "Shoot week
     has changes for now. Switch views and drop them?" — *Keep editing*
     (focused) / *Switch*; after *Switch* the keyboard returns to the Views
     button. *Design default; §10 Q-H.*
   - **The *…* menu** (the kit `Menu`): **Edit** (applies the view and keeps
     the dropdown open, the keyboard on *Filters* below), **Rename** (the
     name becomes a field in the row: Enter keeps, Escape reverts),
     **Duplicate** ("Shoot week copy", placed at the end of the list, Q5c),
     **Delete** (asks: "Delete Shoot week for everyone on this project?" —
     *Cancel* focused / *Delete*; afterwards the keyboard goes to the next
     row, or to the Views button). *All* has no handle, no move buttons and
     no *…*.
   - **Reviewers and seats that cannot write** see the handles, the move
     buttons and the *…* greyed with the tooltip "Only the project's editors
     can change views" (her 2026-08-04 rule; review R1-20). *Design default;
     §10 Q-F asks hidden or greyed.*
2. **This view** (a section label): four 28px rows, each with the part's
   name, a short summary in the muted ink, and a chevron:
   - **Filters** — "2 filters" / "None"
   - **Sort** — "Phase, then Start" / "Default order"
   - **Group** — "By status" / "None" (on the Tasks Board: "Columns by
     status")
   - **Fields** — "9 of 13 shown"
   Each opens its card in place (§4.3). Reviewers have these too: their
   changes are for the moment (Q2, Q3a).
3. **New view**: a 28px row with a plus (greyed with its reason for a seat
   that cannot write); it becomes a name field in place ("View name", Enter
   creates, Escape cancels). The new view is saved at once for everyone,
   starting as *All* (every field, nothing filtered), placed at the end, and
   applied, so its parts are set through the cards and kept with *Save* in
   the bar. *Design default; §10 Q-G.*

**States.**
- *Loading* (the project's views not read yet): the list shows the kit
  `Loading` line under *All*, and *All* works.
- *Error* (the views could not be read): "Views could not be loaded." with
  *Try again*, which reloads the project (the desktop has no per-collection
  read; review R1-8); *All* works.
- *Not on this server yet* (a database without migration 0097; review R1-2):
  *All* alone; *New view*, the move buttons and the *…* greyed with "Saved
  views are not on this server yet."; the last used view neither read nor
  written.
- *Empty*: *All* alone, and for people who may save views, the hint "Change
  the table, then *Save as new view*, or start a *New view*."
- *The view on screen deleted by a teammate, with no change of one's own*:
  the table goes to *All* and a toast says "Shoot week was deleted. Showing
  All." (review R1-8).

### 4.3 The four cards

A card replaces the dropdown's content in place (Q5b): the same floating
card, its header a ← button ("Back to views") and the part's name; Escape on
a card goes back to the list, Escape on the list closes the dropdown. The
card widens to 480px for Filters and Sort (their rows need it), keeping its
left edge. Every change applies to the table at once, as a change for now.
Each card's list is one Tab stop with ↑ / ↓ between rows, and each moved row
is announced in the polite live region ("Phase moved to position 2 of 2").

- **Filters** (Q5a, Q13): the view's filters, one row each in today's shape
  — *Where* / *And*, the field, the condition, the value — then *+ Add
  filter*. **The toolbar's Filter strip and this card draw the same row
  component** (review R1-12), so a filter made in one reads and edits the
  same in the other.
  - For a choice field (Status, Priority, Phase, Assignee, Type, Asset,
    Scene, Shot, Level, Experience…), the value is a picker with tick boxes:
    one or several values; the row reads "Status is In progress, Pending
    review". *is* matches any of them; *is not* matches none of them.
  - For a task's linked kinds (Asset, Scene, Shot, Level, Experience): *is*
    = one of the task's items is among the values; *is not* = none is; *is
    empty* = the task has no item of that kind (review R1-23).
  - Text fields (Title, Name) keep *contains*, *does not contain*, *is*,
    *is not* with one text value; every field keeps *is empty*, *is not
    empty*.
  - A row with no value yet filters nothing, is not counted, and is never
    saved (Q21); a field change resets the row's condition to that field's
    first and its value to none (Q21).
  - Each row ends with ✕ ("Remove this filter").
- **Sort** (Q14): the view's sorts in order, each a row: a drag handle
  button, the field, the direction (*A → Z* / *Z → A*, or *Earliest first*
  / *Latest first* for dates), ✕; *Move up* / *Move down* among the row's
  hover actions; then *+ Add sort*. The reorder keys live on the handle only
  (the field and direction are native selects, whose own arrows choose
  values; review R1-10). The toolbar's Sort dropdown sets the first sort:
  choosing a field already used later removes that later sort; *Sort…*
  removes the first sort.
- **Group** (Q15): the grouping field (*None* first), then the **Hide empty
  groups** switch (the kit `Switch`). *Design default:* the switch starts on
  in tables (what every table but Tasks' Status grouping does today) and off
  on the Board (an empty column is where a card is dropped). **On the Tasks
  tab a view keeps the table's grouping and the Board's columns apart, as
  the tab does today** (review R1-4): the card shows the one for the layout
  on screen. *Design default; §10 Q-C.*
- **Fields** (Q6, Q7): every field of the table in the view's order, each a
  row: a drag handle button, the field's name, and an eye switch (the kit
  `Switch`, labelled "Show <field>"); *Move up* / *Move down* among the
  hover actions. The name field is first and its switch on and disabled
  ("Always shown"), because it is the column kept in place (Q6a). In Tasks,
  **Show key dates** is a separate switch under the list (key dates are
  rows, not a column; review R1-18). *Show all* / *Hide all* (all but the
  name) at the card's foot. *Whether the fields also hide lines on the Board's
  and the Gallery's cards, and on the Scenes table's nested shot rows: §10
  Q-E; until she answers, the fields apply to tables only.*

### 4.4 The *changed for now* bar (Q3c, Q3d)

The kit `Banner` (its `info` tone: one Dense line on a 14% tint with a
hairline under it, the buttons in its action slot), in the flow **after the
Filter strip when it is open, directly above the table** (so the strip never
moves under the pointer; review R1-12), present only while the view on
screen has a change for now. Its words are also written into a polite live
region that is always mounted above the table (the bar's own controls stay
outside it; review R1-11), so a screen reader hears it appear and change.

| State | Words | Buttons |
|---|---|---|
| A change of one's own | "Shoot week: changed for now" | *Reset* (ghost) · *Save as new view* (secondary) · *Save* (primary) |
| The same, on *All* | "All: changed for now" | *Reset* · *Save as new view* |
| The same, for a seat that cannot write | "Shoot week: changed for now. Only the project's editors can save views." | *Reset* (and *Save as new view*, *Save* greyed with that reason) |
| A teammate saved the view meanwhile | "Mara changed Shoot week. Your changes are still on screen." | *Reset* (takes theirs) · *Save as new view* · *Save* (writes yours over theirs, after asking) |
| The same person, from another window | "You changed Shoot week in another window. Your changes here are still on screen." | the same |
| A teammate deleted the view meanwhile | "Shoot week was deleted. Your changes are still on screen." (no name: a delete does not say who) | *Reset* (back to *All*) · *Save as new view* |
| A save that failed | (danger tone) "Shoot week could not be saved: <reason>." | *Try again* · *Reset* |

- *Save as new view* turns the bar's words into a name field ("View name",
  the view's name + " copy" selected); Enter saves and applies the new view
  (placed at the end), Escape cancels.
- **Save is conditional** (review R1-6): a change for now remembers the
  revision of the view it started from; *Save* writes only if the view
  still holds that revision. If it does not (a teammate saved first, even
  when the live channel lagged), nothing is written and the bar turns to the
  "changed meanwhile" state. Only a change of the view's settings bumps the
  revision: a rename or a reorder updates the name and the place in the
  list without raising the bar.
- **Undo** (review R1-7): every saved change to a view (Save, Save as new
  view, Rename, Duplicate, Delete, a reorder) shows the shell's undo toast
  (`components/UndoToast.jsx`), named ("Shoot week deleted for everyone ·
  Undo"). Undo writes only while the view still holds the revision it left;
  otherwise the toast says it has changed since. Ctrl+Z is not bound on
  Tasks, Assets, Levels or Experiences, and on the Timeline it must not
  silently take back a view: view changes are kept out of the shared
  keyboard history.

### 4.5 Unsaved changes and the last used view (Q3b, Q4)

- A change for now lives with the project in WILSON's memory (the provider,
  outside the project's bundle and outside the undo history), per table:
  going to the Timeline and back to Tasks finds it as it was; a reload,
  closing WILSON or switching project drops it.
- Choosing a view, or saving one as new, records it as that person's last
  used view on that table in that project; the table opens on it next time.
  If it has been deleted since, the table opens on *All*.
- **No flash of the wrong view** (review R1-8): the last used map is read
  with the person's settings at sign-in (on the desktop, with the machine's
  settings at start-up); a table draws its rows only once both its views and
  that map are in.

### 4.6 The Tasks table's item columns (Q9–Q11a, Q6a)

- **Columns:** Asset, then Scene and Shot, then Level and Experience, after
  Priority, before Phase; each a field in the Fields card. A kind's column
  is there when the project has that kind turned on or any task names one
  (the task window's picker rule; review R1-23). Each is 150px wide (the
  Asset column's minimum today); the Title keeps FX8's rule (the remainder,
  at most 360px). *Design default (place and width); §10 Q-G.*
- **The cell:** the task's items of that kind by name, main first, separated
  by commas, cut with "+2" (a kit `Badge` in the muted ink) when they do not
  fit; the full list in order is the cell's tooltip **and its accessible
  name** (review R1-11); "—" when there are none. A shot reads "Scene ›
  Shot", the app's form elsewhere (the task window's Items table, the
  Budget; review R1-21). A row no longer in the project reads "No longer in
  the project" (as the task window's Items table does).
- **The picker (Q10):** clicking the cell (or Enter on it) opens a Popover
  under the cell: a search field ("Search assets"), then every row of that
  kind in the project, each a 28px row (`role="checkbox"`, `aria-checked`)
  with a tick: the name, and in the muted ink what tells same-named rows
  apart (an asset's type and phase; a shot's scene; a scene's number).
  Ticking adds the item at the end of the task's list; unticking removes it
  (the last one asks first, as the task window does). The order and the main
  item are the task window's (its Items table is unchanged); the picker
  shows the main one first with *Main*. Scenes and shots offer the active
  shot list's rows with *Show all lists*, as the task window's picker does.
  Escape closes; focus returns to the cell.
- **A seat that cannot write:** the cell is a focusable button that looks
  disabled and carries the reason ("Only the project's editors can change a
  task's items"), like the row's other cells; its accessible name is still
  the whole list (review R1-11).
- **Filters and grouping:** Scene, Shot, Level and Experience join the
  filter fields and the group fields; filters match through any item
  (§4.3); grouping puts a task once, under its main item (Q11a), its cell
  naming the others. **A group's *New task* row links the new task to that
  group's item** (review R1-13). *What dragging a task onto another item's
  group does: §10 Q-D; until she answers, it adds that item as the task's
  main one and keeps the others.*
- **Width (Q6a):** with every column on, the table is wider than the window
  (about 1,540px for a film project, 1,840px with scenes and levels); it
  scrolls sideways inside its frame and the checkbox and Title columns stay
  in place (the kit request **Table sticky columns**, §8), the rest sliding
  under them. The fixed sum and the spare (FX8's rule) are computed from the
  columns the view shows (§4.10).
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

Defects 1, 2 and 5 are properties of the shared filter row and dropdown and
land with them (§7 step 4); 3 and 4 with the other tables (step 5).

Recorded in `docs/OUTSTANDING.md`, not fixed: the Tasks CSV export's
missing Asset and Bid and its raw status words; the Expenses *Linked task*
filter's "Untitled"; grouping Tasks by Asset, Phase or Assignee dropping a
task whose value is not in the project's list; Assets sorting the provider's
array in place; the desktop's browser storage starting empty at every
launch (it no longer holds views, but still holds other stores).

### 4.9 Keyboard, focus and motion

- **The dropdown** is a non-modal dialog (`role="dialog"`, labelled
  "Views"): it holds form fields, so it is not a `menu`. It renders in the
  page right after its button (not at the end of the document), so Tab
  moves through it in order and Tab past its last control leaves it and
  closes it. Each list inside is one Tab stop with ↑ / ↓ between its rows
  (a roving tab index); Enter or Space chooses; Escape goes back from a
  card, then closes; focus returns to the Views button.
- **Layers:** a question opened from the dropdown (Delete, Switch views) is
  the kit `Dialog` over it; the Popover ignores Escape while a layer above
  it is open, or when the key was already handled, so Escape closes only the
  top layer (§8 KR-1; review R1-9).
- **The picker:** the search field has the keyboard on open; ↓ moves into
  the list; Space ticks; Escape closes; focus returns to the cell.
- **The bar:** its buttons are in the Tab order right after the toolbar (or
  the strip); saving moves focus to the Views button.
- **Announcements:** one polite live region per table, always mounted,
  speaks the bar's state and every reorder (§4.3, §4.4).
- **Names:** the Table / Board / Gallery tabs' group is labelled "Layout"
  for screen readers (today "View", beside the new "Views"; review R1-21).
- **Motion:** the dropdown and the cards appear in `--duration-response`
  (200ms) on `--ease-response`; a card swaps in place with a cross-fade in
  the same token; the bar appears in the flow (the table moves down by its
  height once). With reduced motion, all of it appears at once (the house's
  reduced-motion twin, `v2Motion.test.js`).
- **Contrast and type:** the Dense step for the button and the rows, the
  Label step (11px, capitals) for section labels only, the muted ink for
  summaries (ink-3 on paper-raised is pinned at 4.5:1); focus rings are the
  kit's (orange on dark).

### 4.10 Widths when a view hides columns (Q7; review R1-3)

FX8's rule adds up every fixed column (`--rb-task-fixed`, `--rb-asset-fixed`,
`--rb-ent-fixed`) and gives the name what is left up to 360px, the spare
going to the growable columns (Tasks: Asset, Phase, Assignee; Assets,
Levels, Experiences: Description). Taken as it is, a hidden column's width
would go to the name and push it far past 360px. So each table computes its
fixed sum **from the columns the view shows** (an inline custom property on
the table's wrapper), the spare is shared by the **visible** growable
columns, and when none is visible the name still stops at 360px and an
empty last column takes the rest. The table's minimum width is that sum
plus the name's minimum. A test per table hides every growable column and
holds the name at 360px or less.

---

## 5. The data

### 5.1 A view

```
{
  id, project_id, workspace_id,
  table_key: 'tasks' | 'assets' | 'scenes' | 'shots' | 'levels' | 'experiences',
  name,                      -- 1 to 80 characters, trimmed; duplicates allowed (as today)
  position,                  -- the order in the dropdown (Q5c); >= 0
  revision,                  -- bumped only when config changes (review R1-6)
  config: {
    version: 1,
    layout: 'table' | 'board' | 'gallery',         -- Q8; board for Tasks only
    filters: [ { field, op, values: [...] } ],     -- Q13; every row must match; incomplete rows never stored
    sorts:   [ { field, dir: 'asc' | 'desc' } ],   -- Q14; in order
    group:   { field, hideEmpty } | null,          -- Q15
    board:   { field, hideEmpty },                 -- Tasks only: the Board's columns (review R1-4)
    fields:  [ { key, visible } ],                 -- Q6, Q7; the order; the name is always first and visible
    keyDates: true | false                         -- Tasks only (Q6)
  },
  created_at, created_by, updated_at, updated_by
}
```

- Field keys are the table's own (Tasks: `title`, `status`, `priority`,
  `asset`, `scene`, `shot`, `level`, `experience`, `phase`, `assignee`,
  `start`, `end`, `bid`; the others from their columns). A key the table
  does not know is ignored on read and **kept on write** (a newer view saved
  by an older client loses nothing; review R1-23); a field the view does not
  list is shown at its default place (a column added later appears in old
  views).
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
  object under 32 KB; `position >= 0`; `revision >= 1`; the project a
  same-workspace composite foreign key, `ON DELETE CASCADE`.
- **Triggers:** the workspace stamped from the project; `fn_audit_touch`;
  a pin trigger that, on a signed-in insert, stamps `created_by`,
  `updated_by`, `created_at` and `updated_at` itself (`fn_audit_touch` only
  fills what the client leaves empty, so a client could otherwise post a
  2099 `updated_at` that makes every later live update look stale to
  `realtimeMerge.js`'s `isStaleIncoming`; review R1-16), and on update
  keeps `created_by`; `revision` bumped when `config` changes.
- **RLS (Q2):** four policies, each reaching the project through `projects`
  under the caller's own RLS (so a private project's views stay hidden, the
  0072 arm, and a `return=minimal` insert is judged by its own policy),
  plus `has_active_membership` and the workspace arm (0096 §10b); insert,
  update and delete also need `can_write_project(project_id)` (company
  admins and managers, the project's managers and members, anyone on an
  unstaffed project; never a reviewer). UPDATE's `WITH CHECK` equals its
  `USING`. Every arm is restated in full, never `CREATE OR REPLACE`d into a
  narrower one, and each is proved in the suite (the 0062 lesson).
- **Grants:** SELECT, DELETE; INSERT on `(id, project_id, table_key, name,
  position, config)` only; UPDATE on `name`, `position` and `config` only.
- **`reorder_table_views(project, table_key, ids[])`**, SECURITY INVOKER (as
  `reorder_task_items`): raises 22023 for a table key outside the six or an
  id named twice; touches only rows `WHERE project_id = p_project AND
  table_key = p_table_key`; rewrites `position` in one statement under the
  caller's RLS; returns the rows it wrote (zero rows reads as a refusal on
  the client).
- **The last used view (Q4; review R1-17):** a new column
  `user_settings.table_view_last` (JSONB, `{ "<project_id>:<table_key>":
  { "view": "<view_id or 'all'>", "at": <time> } }`), written **one key at
  a time** through a SECURITY INVOKER function
  (`coalesce(table_view_last, '{}') || jsonb_build_object(k, v)`) only when
  the value changes, debounced, so two computers never write over each
  other's entries; the client keeps the newest 300 entries. It is read and
  written by its own requests, never inside `fetchCloudSettings` /
  `saveCloudSettings` (whose select and upsert must keep working on a
  database without the column). Own row only (0046's policies; suite 57
  gains the column).
- **Live (Q3d):** `table_views` joins `fn_realtime_broadcast`'s project arm
  (the seventeenth table), the function restated whole, and the two suites
  that pin the list (72, 99) say seventeen; `realtimeMerge.js` maps it to
  `tableViews` and orders it by position, created_at, id
  (`COLLECTION_ORDER`). The project channel's join check equals
  `projects_select`, so a private project's views reach only the people who
  can open the project.
- **A client ahead of its database** (review R1-2): `loadProject`'s read of
  `table_views` is the 0097 probe, as `probeTaskItems` is 0096's: `42P01` /
  `PGRST205` → `tableViews: []` and `tableViewsAvailable: false`; any other
  error → `tableViewsError`, never a failed load. While unavailable, the
  dropdown shows the *Not on this server yet* state (§4.2).
- **Suite 100** (`supabase/tests/rls/100_table_views.sql`): every role
  (company admin, manager, user; project manager, member, reviewer; an
  unstaffed project; a seatless member; another workspace; a private project
  outside it; an inactive member; anon) against every verb; the column
  grants; the CHECKs; the pin trigger (a client's `created_by`,
  `updated_at` ignored); the revision bump; the RPC under RLS (an id from
  another project or another table key ignored; a reviewer's call writes
  nothing); the broadcast. **Three things are taught first** (review R1-15):
  the coverage guard in the root `rls.yml` is a shell glob, so it becomes
  `compgen -G "supabase/tests/rls/[0-9][0-9]_${t}.sql" || compgen -G
  "supabase/tests/rls/[0-9][0-9][0-9]_${t}.sql"` with an error that says
  "NN or NNN", proved with a failing control for a two- and a three-digit
  suite; `scripts/tap-all.mjs` sorts suites by number (not as text) and
  filters by whole number; CI's failure-replay list gains 98, 99 and 100.
  `RLS_TABLES` gains `table_views` in the same commit as the suite.
- **Applied to wilson-dev only**, after a rolled-back rehearsal through
  `scripts/tap-hosted.py`, by `supabase db query --linked --file …` plus its
  history row; the Desktop kit section in `00_HOW_TO_APPLY.md`; the staging
  lines in the hand-off's "Waiting on Audrey". Never `db push`; never staging
  or prod.

### 5.3 The desktop signed out (the Local Server)

- Views ride in the project's file as a `tableViews` collection
  (`emptyBundle`, `readRabbitBundle`'s missing-array fill), written through
  `rabbitSubentityRoutes('table-views', 'tableViews', …)` with
  `touch: false` (a view's save does not move the project to the top of the
  Projects list), and a reorder route beside FX2's `rabbitTaskItems.cjs`.
  The routes check what the cloud's CHECKs check (the name's length, the six
  table keys, the config's type and size), so a desktop view always moves
  to the cloud; a save carries the revision it started from and the PATCH
  refuses a stale one, as `updateEdit`'s `expectSavedAt` does (review R1-6).
- No roles: anyone using the desktop may save views (her ruling in batch 1;
  the walkthrough says so in one line). No live channel: a teammate's save
  on a shared NAS project shows the next time the project loads (§9).
- The last used view is per computer: a `tableViewLast` map in the
  machine's own settings block (the `rabbit` settings that live in
  `otter-settings.json` on the desktop), not in the project's file; its
  writes are serialized (`saveRabbitSettings` is read-modify-write).

### 5.4 The other backends and places

- **The dev fixtures:** an empty `tableViews` (Q20: *All* only), the same
  verbs in memory with the revision rule, and the last used map in memory.
- **Google Drive:** loads `tableViews: []` with `tableViewsAvailable:
  false`, so its verbs are greyed up front with "Saved views need the cloud
  or the desktop's Local Server" (her *keep the button gray and explain why*
  rule), never refused after a click.
- **The provider** (`RabbitProvider.jsx`): `ctx.tableViews`,
  `ctx.tableViewsAvailable`; the mutators `addTableView`, `updateTableView`,
  `deleteTableView`, `reorderTableViews`, each in `mutationsRef` with its
  undo toast and kept out of the keyboard history (§4.4); `ctx.tableViewLast`
  and `setTableViewLast`; the changes-for-now store (per project and table,
  in memory, outside `EMPTY_BUNDLE` and outside `clearHistory`, cleared when
  the project changes); selectors `viewsOf(tableKey)` and
  `allViewOf(tableKey)`.
- **The bundle-key places** (FX2's list): `EMPTY_BUNDLE`, each adapter's
  `loadProject` (cloud, Local Server, fixtures, Drive), `EXPECTED_KEYS`,
  `CLOUD_BUNDLE_KEYS`, `BUNDLE_KEYS`, the Drive loader's regex,
  `columnAllowlist.test.js`; the workspace takeout (`TAKEOUT_TABLES`); the
  move to the cloud (`runMigration.js` carries a desktop project's views;
  levels and experiences are not carried (`NOT_CARRIED`), so a view's Level
  or Experience filter values arrive pointing at nothing: the report counts
  them; review R1-23).
- **The old views (Q17):** on the first load after each table's new views
  ship, its browser key is removed (`rabbit_task_saved_views`,
  `rabbit_asset_saved_views`, `rabbit_scene_saved_views`,
  `rabbit_level_saved_views`, `rabbit_experience_saved_views`); Expenses'
  and Team's keys are untouched (Q19). The five old dropdowns and their save
  rows and dialogs are deleted with them.

---

## 6. One shared piece, five tables

The Views button, the dropdown, the cards, the shared filter row and the bar
are one R.A.B.B.I.T. component (`views/tableViews/`), given each table's
description: its key, its fields (key, label, kind: text, choice, date,
number, linked), its filterable, sortable and groupable fields, its defaults
(*All*), and how to read a row's value for a field. The five views keep
their own toolbars and tables and hand their filter, sort, group, layout and
field state to it in place of their local state. **`ScenesView.jsx`'s
change is its own step** (review R1-14): its state for the two modes, *List
order* and the Move up / Move down gating move behind the shared component's
two tables, and its dropdown, save row and saved-view handlers go; the file
is the plan's unsafe one, so that step does nothing else.

---

## 7. The build, in order

Each step leaves the app working; the Tasks table's item columns come first
(her bug, the brief's order). Re-cut after review round 1 (R1-14): the data
alone is a session; the shared filter row is built once, in step 4.

| Step | What | Session |
|---|---|---|
| 0 | This file's two review rounds (done, §11); her answers to §10 (asked when she is back; VW1b's step 0 if not yet) | VW1 / VW1b |
| 1 | **The Tasks table's item columns** (§4.6): the cells, the picker, the Scene/Shot/Level/Experience columns, grouping by them (and *New task* in a group), the sticky name and sideways scroll, the Board's cards; the kit requests Popover and Table sticky columns with these callers. **Not the item-kind filters** (they come with the shared filter row, step 4) | VW1b |
| 2 | **The counts** (§4.7) | VW1b |
| 3 | **The data:** 0097 + suite 100 on wilson-dev (the guard, tap-all and replay list taught first), suite 57's column, the adapters with the 0097 probe, the Local Server, the fixtures, Drive's greyed verbs, the provider, the undo toasts, live merge, bundle keys, the move to the cloud, the takeout | VW1c |
| 4 | **The views on Tasks:** the button, the dropdown, the four cards, the shared filter row (multi-value, the item-kind filters, defects 1 and 2), the bar and its live region, the last used view, changes for now, the widths from the visible columns (§4.10), the keyboard and Escape (defect 5); Tasks' old key removed | VW1d |
| 5 | **The other tables:** Assets, Levels and Experiences, then Scenes and Shots as their own step (two lists; defects 3 and 4); their old keys removed | VW1e |
| 6 | Walkthrough 72 (each session adds its part; VW1e completes it), `docs/OUTSTANDING.md` (P1-08 narrowed, P1-26 and the scene window's count closed), the help pages (`rabbitHelpContent.jsx`), `docs/SYSTEMS_HANDBOOK.md` (§4.5 the project channel's feeds, §13.3, §17 this file's §9), the hand-offs, the merges | each session; VW1e last |

Every session: two adversarial code review rounds at its end (one reviewer
each, the second attacking the first's corrections), each correction
asserted with a failing control before its commit; the
`npx vitest run --maxWorkers=4` count stated; pictures at 1280x700 and
1440x900 (`scripts/vw1-shots.mjs` grows the after states); every export with
a caller; every new mutator in `mutationsRef`; the fixtures' seams
(`src/dev/devFixtures.test.js`); the lane-prefix CSS test (FX2's trap: a new
class prefix in a shared sheet is refused).

---

## 8. Kit requests (each lands with its first caller)

- **VW1-KR-1 `Popover`** (`src/ui/Popover.jsx`): a non-modal floating card
  anchored to a trigger (below it, left edges aligned, kept in the window),
  paper-raised, 6px radius, the one shadow; `role="dialog"` with a label.
  It renders in the DOM right after its trigger (so Tab continues to the next
  control, and Tab out of it closes it); registers with `overlay.js`, records
  `modalDepth()` when it opens and ignores Escape while a layer above it is
  open or when the key was already handled (`defaultPrevented`), as `Dialog`
  does; an outside press closes it; focus moves in on open and back to the
  trigger on close (or to a named fallback when the trigger is gone).
  Callers: the Views dropdown, the item picker (review R1-9).
- **VW1-KR-2 Table sticky columns** (`src/ui/Table.jsx` + `src/index.css`):
  `stickyColumns={n}` keeps the first n columns in place while the table
  scrolls sideways (review R1-22): the sticky cells on opaque paper, the row
  tints (hover, selected) drawn as a background image over it; the
  scroller's left gutter covered; a `colSpan` row's content (group headers,
  *New task*) sticky itself; the scroller's `scroll-padding-left` equal to
  the sticky width (a focused cell is never hidden under them, WCAG 2.4.11);
  the sticky header cells above the body's; the Title cell a `<th
  scope="row">`. Caller: the Tasks table (the checkbox and Title).

---

## 9. Known limits (the walkthrough names each)

- **The signed-out desktop has no roles:** anyone using it may save, change
  and delete views.
- **The signed-out desktop has no live channel:** a teammate's save on a
  shared NAS project shows the next time the project loads.
- **On the cloud, assets carry no level or experience links:** a level's
  and an experience's asset count is 0 there, as their windows' lists are.
- **Sums and grouped rows count a task once, under its main item** (FX2's
  rule; Q11a); lists and cells name every item.
- **A filter value whose row is gone matches nothing** and shows as "No
  longer in the project" in the card.
- **A deleted view does not say who deleted it.**
- **Budget's Expenses and the Team tab** keep their old saved views (Q19),
  per browser, and their keyboard gap (P1-08 for those two).

---

## 10. Questions for Audrey (asked when she is back; nothing here is built before her answer)

Each with the choices and the one I would pick first. Until she answers, the
design holds the choice marked *(until she answers)*.

**Q-A. The Views button's room on the Tasks toolbar.** At 1440 the Tasks
toolbar has room for a button of about 180px without adding a line: some
ten characters of the view's name beside the word *edited*.
- **A dot for *edited*** *(Recommended)*: a small orange dot after the name
  while the view has a change (the bar under the toolbar already says
  "changed for now" in words), which leaves about fifteen characters for the
  name.
- **Keep the word, cut the name** *(until she answers: her Q5 wording)*:
  about ten characters of the name, then "· edited".
- **Let the Tasks toolbar take two lines at 1440**, as it already does at
  1280, and show the whole word and more of the name.

**Q-B. Scenes and Shots at 1440.** With the named Views button, their
search box and count move to a second line at 1440 (they already do at
1280).
- **Keep it** *(Recommended; until she answers)*.
- **Regroup the toolbar** as walkthrough 47's Q184 proposed (one size
  control instead of three; the fps readout moved; filters on the left,
  views, search and the create buttons on the right) so it fits one line.

**Q-C. The Tasks tab's two groupings.** Today the table's grouping and the
Board's columns are set separately (the Board defaults to Status).
- **Two, as today** *(Recommended; until she answers)*: a view keeps both,
  each with its own *Hide empty groups* switch.
- **One for both**: the Board follows the table's grouping (Status when the
  table has none).

**Q-D. Dragging a task onto another item's group** (Tasks grouped by Asset,
Scene, Shot, Level or Experience).
- **Adds that item as the task's main one and keeps the others**
  *(Recommended; until she answers)*: nothing is lost.
- **Replaces the main item** (what dragging between Asset groups does today;
  FX2's question 7, still open).
- **Dragging between these groups is off.**

**Q-E. Fields on cards.** On the Board and in the Gallery (and on the shot
rows nested in the Scenes table), do a view's field switches also hide those
lines?
- **Yes, one list of fields per view** *(Recommended)*: Notion's way.
- **No, fields only change the table** *(until she answers: today's
  cards)*.

**Q-F. What a reviewer sees of the editing controls** (New view, the move
buttons, the *…* menus).
- **Greyed with "Only the project's editors can change views"**
  *(Recommended; until she answers: her 2026-08-04 rule, keep the button
  gray and explain why)*.
- **Hidden.**

**Q-G. Three smaller things, one answer each** (all shown as built until
she says otherwise): a *New view* is saved for everyone at once, starting
as *All*, and set up with the cards; the new item columns sit after Priority
at 150px each; *Save* over a teammate's newer save asks first. Right?

**Q-H. Switching views with a change for now** asks first ("Switch views and
drop them?").
- **Ask first** *(Recommended; until she answers)*.
- **Switch and drop without asking.**

---

## 11. The review rounds

### Round 1 (one Opus reviewer, read-only, 2026-10-13) — 23 findings

Three high, eleven medium, nine low or low-medium. Every finding is taken:
**[design]** corrections are written into the sections above; **[question
for Audrey]** findings are §10's Q-A, Q-C, Q-D, Q-E and Q-F (the design
holds a choice until she answers); **[build note]** findings are in §4.6,
§4.10, §5 and §8.

| # | Severity | Finding (short) | Where it went |
|---|---|---|---|
| R1-1 | high | the named button widens on *edited* and wraps the Tasks toolbar at 1440, against Q3c | §4.1 one width, the slot reserved; §10 Q-A |
| R1-2 | high | no path for a client against a database without 0097 (staging, the beta) | §5.2 the probe; §4.2's state; §5.4 Drive greyed |
| R1-3 | high | a hidden column's width goes to the name, past 360px | §4.10 |
| R1-4 | medium | Tasks has two groupings (table, Board); the config had one | §5.1 `board`; §4.3; §10 Q-C |
| R1-5 | medium | a delete cannot say who; one's own other window | §4.4 wordings |
| R1-6 | medium | a save without a revision overwrites a teammate's when the live channel lags | §5.1 `revision`; §4.4 conditional save; §5.3 the PATCH guard |
| R1-7 | medium | Ctrl+Z is not bound on four of the five tables | §4.4 the undo toast; §5.4 |
| R1-8 | medium | five missing states | §4.2, §4.4, §4.5, §9 |
| R1-9 | medium | Escape layering, Tab order and focus return for the Popover | §4.9; §8 KR-1 |
| R1-10 | medium | reorder keys clash with native selects; no announcement; too many Tab stops | §4.2, §4.3, §4.9 |
| R1-11 | medium | the Banner's live region and the hidden "+N" | §4.4, §4.6, §4.9 |
| R1-12 | medium | the Filter strip cannot show several values; the bar's place | §4.3 one row component; §4.4 |
| R1-13 | medium | grouping by item kinds: drags and *New task* rows | §4.6; §10 Q-D |
| R1-14 | medium | the build plan's sizing and order; missing docs | §6, §7 |
| R1-15 | medium | the coverage guard is a shell glob | §5.2 |
| R1-16 | low-medium | 0097 hardening (insert columns, timestamps, the RPC) | §5.2 |
| R1-17 | low-medium | the last used map clobbered across computers; its growth | §5.2, §5.3 |
| R1-18 | low | visible choices not marked; Duplicate's place; Key dates; choosing closes | §4.2, §4.3; §10 Q-G, Q-H |
| R1-19 | low | fields on Board, Gallery and nested shot rows | §10 Q-E |
| R1-20 | low | reviewers: hidden or greyed | §4.2; §10 Q-F |
| R1-21 | low | "Scene › Shot"; the Dense step; the tabs' "View" label | §4.1, §4.6, §4.9 |
| R1-22 | low | sticky columns' paper, gutter, colSpan rows, focus | §8 KR-2 |
| R1-23 | low | merge order, desktop CHECKs, migration's levels, unknown keys, item-kind filter meaning, toolbar Sort, when a kind's column shows | §4.3, §4.6, §5.1, §5.3, §5.4 |

What round 1 found sound: §1's fidelity to her 25 answers; 0097's access
rules (every policy hops to the project; `can_write_project` is exactly
Q2's set; private projects stay hidden; inactive members, other workspaces
and anon are shut out); the live channel does not widen who can read; the
stated facts about the broadcast's restatement, `tap-all.mjs` and the
replay list; the drafts' home in the provider; the last used map cannot
leak; the counts fix; the kit choices (a non-modal dialog; sticky cells
feasible on the kit Table's `border-collapse: separate`; contrast and type);
the old views' removal scoped by Q17 and Q19.

### Round 2

ROUND-2-PLACEHOLDER
