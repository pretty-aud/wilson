# 70 — THE TABLES' ROW BUTTONS: ONE PAGE ICON, RIGHT AFTER THE TITLE (R.A.B.B.I.T.)

1. **One icon opens an item's window: the page icon.** Scenes, a scene's
   shots, the Shots table, an edit's shots, Levels and Experiences showed
   an eye. They now show the page icon that Tasks and Assets had. Point at
   it and it says **Open** and the item's name (*Open Lighthouse, dawn*).
   The scene bands in the Shots table and the scene heads in the shot
   gallery open their scene with the same icon.
2. **The buttons sit right after the title, in the same order in every
   table:** Open first, then the row's own (Tasks and Assets: the edit
   history; Scenes and Shots: the shot-list ⋯; an edit's shots: the edit's
   ⋯), Delete last. The gap is the same everywhere: the first button starts
   10px after the title's last letter, and the buttons sit 2px apart. They
   show when you point at the row or Tab into it, as before. The columns
   at the row's far end that held them are gone.
3. **The title column is narrower.** In Tasks, Assets, Levels and
   Experiences it is at most 360px, about 35 characters before the title
   is cut with "…" (the whole title shows when you point at it). The other
   columns take the space back: in Tasks, Asset, Phase and Assignee share
   it; in Assets, Levels and Experiences, Description takes it. Scenes and
   Shots' name columns were already a set width (216px); they grow by the
   buttons' width and the 112px column at the end goes.
4. **Delete asks exactly as it did.** A task asks only when a bid version
   is open and another version holds it; an asset deletes at once with
   Undo; a scene, a shot, a level or an experience asks first.

**What this is.** FX8, from your words of 2026-10-12: "lets have uniformity
and have the same icon for these since they are essentially the same thing
... lets move them all closer to the title of the items in the tables ...
the cell/ssection for the title is sooo wide." Nothing in the database
changed and nothing needs applying anywhere.

**Before you start.** The test data (the development copy's fixtures) holds
Salt Hours. Levels and Experiences need `?fixtures=game` on the address.
The test data lives in memory: reloading the page puts it back.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-fx8-before-<table>-NN-<state>-<size>.png` and
`po-fx8-after-<table>-NN-<state>-<size>.png`. There are eight tables (tasks,
assets, scenes, nest = a scene's shots, shots, cut = an edit's shots,
levels, experiences), three states each (01 rest, 02 the first row pointed
at, 03 the keyboard on its first button) and two sizes (1440x900,
1280x700). `scripts/fx8-shots.mjs` took them and measured every number
below.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Salt Hours → **Tasks**, point at *Lock the shooting script* | Right after the title: the page icon, the edit-history clock, the trash. Before, the page icon sat at the far end of a 362px title column (172px after the words at 1440) and the clock and trash at the row's right end, 1,160px away. (after-tasks-02, before-tasks-02) |
| 2 | Point at each button | *Open Lock the shooting script*, *View edit history for Lock the shooting script*, *Delete Lock the shooting script*. Before: *View task details*, *View edit history*, *Delete task*. |
| 3 | Look at the columns at 1440 and on a wide screen | Title is 360px. Asset, Phase and Assignee are wider (175, 149 and 149px at 1440). Before, Title took everything: 362px at 1440, 842px at 1920. At 1280 the title is 274px, wider than before (202px), because the 72px column at the end is gone. |
| 4 | Click in front of the first task's checkbox and press Tab | The keyboard's place goes checkbox → title → **Open** → clock → trash → Status. The buttons show while the keyboard is on the row. (after-tasks-03) |
| 5 | **Open**, the clock, the trash | The task's window, its edit history, and the delete, each as before. The key dates at the top keep only Delete, right after their names (the project's bound start and end have none). |
| 6 | **Board** | A card's buttons read *Open …* and *Delete …* too. |
| 7 | **Assets**, point at *Shooting Script v4* | Page icon, clock, trash right after the name. Name is 292px at 1280 and 360px from 1440 up; Description takes the rest (180px at 1280, 272px at 1440). Before: Name 380px at 1440 and 860px at 1920, the page icon at its end, the clock and trash at the row's end. (after-assets-02) |
| 8 | **Scenes**, point at *Lighthouse, dawn* | Page icon, shot-list ⋯, trash right after the name. Before: an eye, the ⋯ and the trash at the row's right end, 976px after the name at 1440. (after-scenes-02, before-scenes-02) |
| 9 | Open the scene's shots (the arrow) and point at *The door* | The same three, right after the shot's name. At 1440 the nested shots no longer scroll sideways (their columns are 20px narrower). |
| 10 | **Shots**, point at *The door* | The same three after the name. The band above (*Lighthouse, dawn*) keeps its button at its right end, as the page icon now (question 1). |
| 11 | Drag *The storm* by its grip onto *Cliff path* → **Start new edit**, point at *The door* | An edit's shots: the page icon and the edit's ⋯ right after the name, shown on pointing or Tab. Before, an eye and the ⋯ sat always visible at the row's end. The scene bands keep their ⋯ at their right end. (after-cut-02, after-cut-03) |
| 12 | Add `?fixtures=game` → **Levels**, point at *Harbour Approach*; then **Experiences** | Page icon and trash right after the name. Name is 360px and Description takes the rest (572px at 1280, 732px at 1440). Before, the two split the width (430px each at 1280, 510 at 1440), with the eye and trash at the row's end. (after-levels-02, after-experiences-02) |
| 13 | Delete from any table | It asks, or deletes with Undo, exactly as before (point 4 above). |
| 14 | Click a title (Tasks, Assets, Scenes, Levels) | It still becomes a field to rename. The field takes the whole cell while you type, and the buttons wait at its end. |
| 15 | Rename a task to a long title (40+ characters) | It is cut with "…" at the column's 360px, and the buttons stay right after it. Point at it for the whole title. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700. All of it works on
the test data in the development copy. A reviewer (a seat that cannot
write) sees Open and the history, and no trash.

---

## 3. The numbers, measured

Measured in Chromium on the test data, at 1280x700, 1440x900 and 1920x1080
(the first row of each table; the distance is from the title's last letter
to the first button's left edge).

| Table | Title column before (1280 / 1440 / 1920) | after | Open's distance from the title, before → after (1440) | The other buttons before |
|---|---|---|---|---|
| Tasks | 202 / 362 / 842 | 274 / 360 / 360 | 172 → 10 | clock and trash at the row's end, 1,160px away |
| Assets | 220 / 380 / 860 | 292 / 360 / 360 | 212 → 10 | clock and trash at the row's end, 1,152px away |
| Scenes | 216 at every width | 308 | 976 (the eye, at the row's end) → 10 | ⋯ and trash beside the eye |
| A scene's shots | 144 | 236 | 1,046 → 10 | the same |
| Shots | 216 | 308 | 1,458 (past the window) → 10 | the same |
| An edit's shots | 556 / 716 / 1,196 | 668 / 828 / 1,308 | 1,058 → 10 | the ⋯ beside the eye, always shown, 4px apart |
| Levels, Experiences | 430 / 510 / 750 | 360 / 360 / 360 | 1,190 → 10 | trash beside the eye |

- **Where they show, before and after:** pointing at the row or the
  keyboard inside it, in every table. An edit's shots were always shown;
  they now follow the same rule.
- **Nothing new scrolls sideways.** Each table's narrowest width is what it
  was (Tasks 1,254px, Assets 1,236px with the history button, Levels 716px).
  The Shots table still scrolls sideways at 1280 and 1440, as before, 20px
  less. The nested shots stopped scrolling at 1440 and still scroll at 1280.
- **The buttons are the same size** (28px) and stay in the Tab order, right
  after the title.
- **Tests:** 357 test files / 8,593 tests (2 skipped) at the start, all
  passing. *(The counts after the change and the two review rounds are
  added at the end of the session.)*

---

## 4. Still not right, and not this session's to change

- **The thumbnails draw a broken-image icon on the test data** (P1-28), in
  every picture.
- **The Shots table has sixteen columns** and still scrolls sideways at
  1280 and 1440 (walkthrough 47, question 185). The nested shots still
  scroll at 1280 (P1-63).
- **Rows that open no item's window keep their buttons at the row's end**:
  the Budget's expenses (Edit, Delete), Talent's lines, the Team tab's
  members (Remove), the Files tables, the relations in a window, and the
  shot-list windows' rows. Their buttons edit, remove or download; none is
  "open the details". Question 3 asks about the expenses.

---

## 5. Questions, when you test

1. **The scene bands keep their button at the right end.** In the Shots
   table (grouped by scene), each scene's band opens the scene with the page
   icon at the band's right end, beside its runtime. An edit's bands have
   their ⋯ there too. The band is one button that opens and closes its
   scene's shots, across its whole width. Moving its icon next to the
   scene's name means only the words would open and close it. Keep it at
   the right end, or move it next to the name?
2. **An edit's shots: the Shot column still takes the rest** (828px at
   1440). The buttons now sit right after the name, but the other three
   columns (Status, Duration, Frames) hold short, fixed content, so there
   is no column to give the space to. Keep it, or cap it at 360px like the
   others and let Status, Duration and Frames spread out?
3. **The Budget's expenses:** Edit (a pencil, which opens the expense's
   window) and Delete still sit at the row's right end. Move them after
   the expense's title, with the page icon for Edit, as here?
