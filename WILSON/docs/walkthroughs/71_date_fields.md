# 71 — THE DATE FIELDS: THE WHOLE DATE, THEN ITS CALENDAR (R.A.B.B.I.T.)

1. **Every date shows whole, and so does an empty field's
   `mm / dd / yyyy`, with the calendar icon after it and space between.**
   In the desktop app and in Firefox, in every table and window. Your
   screenshot was Firefox's: Firefox writes a date with spaces
   (`09 / 26 / 2026`) and always shows its calendar button, so in the Tasks
   table's date fields the button sat over the year's last figure in every
   row, empty or not. The desktop app (and Chrome) showed a date with its
   icon 5px away, and cut an empty field's last letter, while you pointed
   at the row.
2. **The tables' date columns are wider:** Tasks' Start and End, and
   Assets' Start and Due, 124 → 144px; the Shots table's Start and End
   144 → 150px. The room comes from the column that can give it:
   - **Tasks:** the Title column's narrowest gives 40px. From 1440 up
     nothing changes for the title (360px). At 1280 it is 234px (224 while
     the list is long enough to scroll), was 274: after its buttons about
     120px is left for the words, so most titles end in "…" there; point at
     one for the whole title (in the desktop app at 1280, 24 of the test
     data's 42 titles are cut). Question 1.
   - **Assets:** Description gives 40px at every width (140px at 1280, was
     180); the Name column is unchanged.
   - **Shots:** the table already scrolls sideways; it is 12px wider.
3. **Five places changed shape so their dates fit:**
   - **An item's new-task form** (the + by Tasks in a level's,
     experience's, scene's or shot's window): Start and End share a line,
     169 to 178px each, and Bid days has the next — the order the Tasks
     table and the New task window use. Before, the three shared a line
     and Firefox cut both dates; giving the dates their room on that line
     would have left Bid days too narrow for "12.5". In a 700px-tall
     window the form now scrolls to reach Bid days.
   - **The Summary's Control panel:** its last row (Project code, Status,
     Type, Tier, Start date, End date) is six across from a 1280 window up
     and three across below, where a sixth is narrower than a date's room.
   - **The Bins inspector:** Shoot day's column is never narrower than the
     date's room; the left column (Slate, Modifier, Roll / card) gives the
     4px it needs in the desktop app.
   - **A key date's editor** in the Tasks table stays inside its cell (it
     ran 8px past it, 14 in Firefox), and its focus ring is drawn just
     inside it so the cell's edge does not cut the ring.
   - **A level's or an experience's details** go one to a line rather
     than squeeze a date: in the smallest desktop window (1024 by 700)
     with the task form open, Status, the linked counts, Start date and
     Due date stack; from 1280 they are two to a line, as before.
4. **One keyboard fix in the desktop app.** Tabbing through a Tasks or
   Assets row's date, the keyboard stops on the calendar icon after the
   year (the browser's own stop); the icon used to vanish there and take
   the focus with it, so for one key press nothing on the page showed
   where you were. Now the icon stays, ringed, as in every other date
   field.
5. **Nothing else changed.** The calendar picker is the browser's own;
   typing a date, the arrow keys and the icon work as before; every date is
   stored exactly as before.

**What this is.** FX10, from your words of 2026-10-13: "similar to the
frame count chevrons, the calendar icon is covering the dates when it has
all the space to space them out". One rule for every date field in the app,
in the shared look (the kit): a date field is never narrower than the
date's room — 120px, which holds Firefox's widest, the empty
`mm / dd / yyyy` with its button — plus its own padding. Neither browser
can cut a date or put its icon over it, and where a field is wider the
extra room goes between the date and the icon. The figures are drawn
evenly spaced, so a column of dates lines up. Nothing in the database
changed and nothing needs applying anywhere.

**Before you start.** The test data (the development copy's fixtures) holds
Salt Hours; Levels and Experiences need `?fixtures=game` on the address.
Reloading the page puts the test data back. Check in the desktop app AND in
Firefox if you can: they draw dates differently.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-fx10-<before|after>-<engine>-<surface>-c1-<state>-<size>.png`: engine
`electron` (the desktop app's own engine), `firefox`, or `chromium`; state
`rest`, `hover` (the pointer on the first date), `focus`, or `rest-full`
(Chromium's whole window); size 1440x900 or 1280x700. The before pictures
show the pet companion where it sat; the after ones hide it, as the script
does while it measures. `scripts/fx10-date-fields-shots.mjs` took them and
measured every number below.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | In **Firefox**: Salt Hours → **Tasks**, look at Start and End | Every date whole, `09 / 26 / 2026`, the calendar button after it, about 13px clear (10px after an empty `mm / dd / yyyy`). Before: `09 / 26 / 202` under the button in every row. (firefox-tasks, before and after) |
| 2 | In the **desktop app**: the same, then point at a row | The row's calendar icons show at the right of each date field, about 25px after a date (22 after an empty one). Before: 5px, and an empty field's last "y" was cut. Nothing moves when they show. (electron-tasks hover) |
| 3 | Group by **Phase** | Each phase's Start and End whole with their icons; the fields are 138px (were 132). |
| 4 | Click a key date's date (the diamond rows at the top), then press Tab and Shift+Tab back | Its editor opens inside the Start cell (it ran past the cell before) with the date whole; the focus ring sits just inside the field. |
| 5 | **Assets** | Start and Due as in Tasks; Description is 40px narrower. |
| 6 | **Scenes → Shots → Table** | Start and End whole in every row (Firefox cut the year in every row before); 150px columns. |
| 7 | Open a task, a new task, an asset, a new asset, a scene, a shot | The dates were already whole here and look the same. |
| 8 | Open a scene (or a shot, or with `?fixtures=game` a level), then **Add new task** (the + by Tasks) | Start and End on one line, each 169 to 178px, whole; Bid days on the next (scroll the form for it in a 700px-tall window). Before: the three shared a line and Firefox cut both dates. |
| 9 | `?fixtures=game` → **Levels**, open *Harbour Approach* | The level's Start and Due whole, two to a line. |
| 10 | **Timeline**: + Task, + Phase, + Key date | The editors' dates whole, as before. |
| 11 | **Summary → Control panel** at a 1280 window, then narrower | The last row six across; below 1280, three across. Start and End whole either way. |
| 12 | **Bins** → List view → a clip → **Shoot day** | Whole, its right edge in line with Take and Camera above it; in the desktop app Slate, Modifier and Roll / card are 4px narrower to give it room. |
| 13 | R.A.B.B.I.T. settings → Holidays (switch **Editable** on); Budget → Expenses → New expense; Intake → New project; D.O.G. → New project; Projects → Salt Hours; Dashboard → Notes → a note | Whole, as before. |
| 14 | In the **desktop app**, click a Tasks row's Start, then press Tab four times | The keyboard goes month → day → year → the calendar icon (ringed, still shown) → End. Before: at the icon the ring vanished for one press. The same in Assets. |
| 15 | In any date field: type a date, use the arrow keys, click the icon (Alt+Down in Firefox) | The browser's picker and keys, unchanged; the date saves as before. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700; the windows also
at the smallest desktop window (1024 by 700). All of it works on the test
data in the development copy. Firefox is the browser your screenshot came
from; the desktop app is Chromium inside, and Chrome and Edge draw dates
the same way.

---

## 3. The numbers, measured

Measured on the test data in three engines — Playwright's Chromium, the
desktop app's own Electron 33 (Chromium 130) and Firefox 157 — at 1024x700,
1280x700 and 1440x900, each date set (2026-09-26) and empty, at rest,
pointed at and focused. "Gap" is from the date's last figure to the icon.

| Where | Field in its column, before → after | Desktop app, before → after | Firefox, before → after |
|---|---|---|---|
| Tasks and Assets rows | 112 in 124 → 132 in 144px | a date 5px from its icon → 25px; an empty field's last "y" cut 1.3px → whole, 22px | 9.5px of every date under the button (13px of `mm / dd / yyyy`) → whole, 13.5px (10 empty) |
| Shots table | 120 in 144 → 138 in 150 | 4.6px (3.7 empty) → 25 (22) | 10px of every date under the button (11 empty) → whole, 13.5 (10) |
| A phase's dates (grouped by phase) | 132 → 138 | 19 (16 empty) → 25 (22) | 7.5px; the empty button 4.5px from the "y" → 13.5 (10.5) |
| A key date's editor | 132 in a 124 cell, 8px past (14 in Firefox) → 138 in 144, inside | 19 (16) → 25 (22) | the empty button 4.5px from the "y" → 13.5 (10) |
| An item window's new-task form | 119 to 125 → 169 to 178 | 6 (2.6 empty) → 57 (53) | 2px of a date under the button (6 of `mm / dd / yyyy`) → whole, 54 (50.5) |
| Bins inspector, Shoot day | 134 → 138, its column with it | 19 (18) → 25 (22) | whole → whole, 15 (11.5) |
| A level's, an experience's, an asset's window | 133, unchanged in the desktop app; Firefox 125 → 132 | whole, 26 (23), unchanged | 6.5 (6) → 13.5 (10) |
| Every other window: a task, a new task, a new asset, a scene, a shot, the Timeline's editors, Holidays, a new expense, the Control panel, Intake, D.O.G., Projects, a Dashboard note | unchanged | whole, as before | whole, as before |

"Gap" figures are the smallest seen at any of the three sizes and states;
the desktop app's icon shows on a table row only while you point at it.

- **Nothing new scrolls sideways.** Tasks' narrowest is 1,238px, as FX8
  left it, so it fits a 1280 window beside the list's scrollbar; Assets is
  1,236px, as before. The Shots table still scrolls sideways at 1280 and
  1440, as before, 12px more.
- **Every other field and menu in a date's row, form or window has room
  for its words**, measured the same way (an empty number field filled
  with 12.5 first; Bid days' "12.5" has 137 to 145px) — but one, older
  than this session: in the smallest desktop window, with the new-task
  form open beside a shot, the shot's take notes (§4).
- **Tests:** 359 test files / 8,649 tests (6 skipped) at the start, all
  passing; **360 / 8,691 (6 skipped) at the end**, all passing. Every fix
  was proved by breaking it on purpose and watching a test fail: 61
  deliberately broken versions, all 61 caught.
- **Two review rounds** (one reviewer each, the second attacking the
  first's corrections), both driving the desktop app's engine and Firefox
  with real keys. The first found twelve things (one serious: the new-task
  form's Bid days left too narrow for "12.5"); the second, nine (three of
  middling weight: the form's dates below the fold of a 700px-tall window,
  thirteen ways the tests could still be fooled, and the keyboard's focus
  vanishing at a table date's calendar icon in the desktop app, older than
  this session). All are fixed, or named in §4 and `docs/OUTSTANDING.md`.

---

## 4. Still not right, and not this session's to change

- **A minimum font size brings the cut back in the tables.** If Firefox's
  minimum font size (Settings → Fonts, an accessibility setting) is 16, a
  table's dates are drawn larger than the room allows and the year is cut
  under the button again; the windows stay whole. The room is a fixed size
  for the app's 13px dates. In `docs/OUTSTANDING.md`.
- **The Summary's Control panel fields have no names for a screen
  reader** (all 24 of them, Start and End included): the words beside them
  are not tied to them. Older than this session; in `docs/OUTSTANDING.md`.
- **A shot's take notes have no room in the smallest desktop window while
  the new-task form is open beside the shot** (the window's main column
  falls to 260px and each note field to 18px). Older than this session,
  found by its measurements; in `docs/OUTSTANDING.md`.
- **The new-task form's Role menu** cannot show its longest role, "Art
  Department Assistant", once chosen (the open list shows it whole). Older
  than this session.
- **Safari** draws date fields its own way and was not measured (there is
  no Safari on Windows).
- **Other languages** were measured only in the desktop app's engine
  (Korean, German and British English fit; the US format is the widest);
  Firefox in another language was not measured.
- **The Team tab's Start and End** are in its older table, which only the
  desktop's signed-out Local Server shows; the test data has the newer one.
  The rule reaches them (they are the kit's small field); not measured.
- **Bins' "Add files" dialog** (Shoot day for the whole batch) needs files
  from a desktop folder and was not opened; its five columns at the
  dialog's 960px are about 170px each, more than the 138 a date needs.
- **The Holidays field is greyed until you switch the settings to
  Editable**, and Firefox draws no calendar button on a greyed field.

---

## 5. Questions, when you test

1. **Tasks at 1280: the title column is 40px narrower** (234px; 224 while
   the list scrolls). In the desktop app at 1280, beside the list's
   scrollbar, 24 of the test data's 42 titles end in "…", 15 more than with
   the 40px back. Keep it, or take the 40px from Asset, Phase and Assignee
   instead (54 more of their names would be cut, most of them Phases)?
2. **In the desktop app a table row's calendar icons show only while you
   point at the row; Firefox always shows them.** With the wider fields the
   desktop app's icon sits at the field's right end, about 26px after its
   date and 28px before the next column's: it can read as belonging to
   either. Keep it, show the field's outline on the pointed row so each
   icon sits in its own box, or show the icons always?
