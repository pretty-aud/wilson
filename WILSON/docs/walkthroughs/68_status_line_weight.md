# 68 — THE STATUS LINE UNDER AN ITEM'S TITLE, THICKER (R.A.B.B.I.T.)

1. **The coloured line under every item window's status is thicker.** An
   asset, a task, a scene, a shot, a level and an experience: the line in
   the status's colour across the window, under the dot and the word, is
   now **3px**, three times what it was (1px). It reads as a bar, not a
   hairline. The window is the same size and the details start where they
   did: only the line changed.

**What this is.** FX6, your answer to walkthrough 66's question 2: *"lets
make the line thicker it feels to thin"*. Nothing in the database changed;
nothing needs applying anywhere. The beta gets it the next time the
controller merges, on your word.

**Why 3px.** The line was drawn at 2, 3 and 4px in every status colour
(the pictures in step 7 and 8):

- **2px** is the weight the app already uses to say "this one is chosen":
  the underline under the selected tab (the **Table / Gallery** switch over
  the task window's files has one, and for an *In progress* item it is the
  very same orange) and the edge of a selected row. At 2px the status line
  reads as one more of those.
- **4px** is the heaviest line in the window. It catches the eye before
  the item's name does.
- **3px** reads as the bar you asked to have back ("a color banner/bar
  that was the color of the status"). It is the weight these windows drew
  before the overhaul, and the weight of the status edge on the
  Dashboard's task cards.

**Before you start.** The test data (the development copy's fixtures)
holds Salt Hours. Levels and experiences are switched on by adding
`?fixtures=game` to the address. The test data lives in memory: reloading
the page puts it back.

The pictures are in `docs/sessions/handoffs/img/`, taken by
`scripts/fx6-shots.mjs` at 1440x900 and 1280x700:
`po-fx6-before-NN-<window>-<size>.png` (the 1px line) and
`po-fx6-after-NN-<window>-<size>.png` (3px), NN 01 asset, 02 task, 03 scene,
04 shot, 05 level, 06 experience; `po-fx6-candidates-01-task-top-<size>.png`
(the task window's top at 2, 3 and 4px, one above the other),
`po-fx6-candidates-02-tones-dark-<size>.png` (every status colour at each
weight), `po-fx6-candidates-03-tones-light-<size>.png` (the same on the
light orange ground) and `po-fx6-forced-01-task-<size>.png` (Windows High
Contrast).

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Assets: open **Shooting Script v4**'s details | Under the title, **● FINAL**, then a green bar across the whole window, then the details. (after-01; before-01 has the thin line) |
| 2 | Tasks: open **Lock the shooting script**'s details | The same: **● FINAL** and the green bar. (02) |
| 3 | In that window, change **Status** to **Blocked**, then **In progress**, then **Waiting to start** | The bar turns pink-red, then orange, then grey, at once, and stays as thick. Orange and grey are where the same 3px looks thinnest (they stand out least from the dark window): judge the weight on those. |
| 4 | Scenes: a scene's details; Shots: a shot's details | The same bar on both. (03, 04) |
| 5 | Add `?fixtures=game`. Levels: a level's details; Experiences: an experience's | The same bar; *In progress* is orange. (05, 06) |
| 6 | Scroll a long window's details | The bar stays under the title; only the details scroll. |
| 7 | Open `po-fx6-candidates-01-task-top-1440x900.png` | The task window's top three times: **2 px**, **3 px · what the app now draws**, **4 px**. |
| 8 | Open `po-fx6-candidates-02-tones-dark-1440x900.png` | Every status colour at each weight, side by side: *Not started* (grey), *In progress* (orange), *Approved* (green), *On hold* (amber), *Blocked* (pink-red). |

The light-ground picture (`-03-tones-light-`) is for completeness: no
window draws the banner on the light orange ground today. If one ever
does, the line there stays the light page's thin rule (1px): the light
ground shows no status colours, so there is no coloured bar to thicken.

---

## 2. How to check it

Do steps 1 to 6 at a large window and again at 1280 by 700. Everything
works on the test data in the development copy.

If you use one of Windows' **High Contrast** themes (Settings,
Accessibility, Contrast themes): the colours are replaced by the theme's,
so the line is drawn in the theme's text colour, still 3px, under the
word (`po-fx6-forced-01-task-1440x900.png`, Chromium's imitation of it).

---

## 3. The numbers, measured

- **The line:** 3px, solid, in the status's colour (it was 1px). The
  status band is 28px tall, as before: the word sits 7px under the title
  row and 7px clear of the line (8px and 8px with the thin line), so the
  details start exactly where they did.
- **The windows:** the same widths as before (asset 1152px, task 960px,
  scene, shot, level and experience 896px); the bar runs edge to edge in
  every one.
- **The colours were never faint.** Against the window's background each
  line already stands well out (grey 4.66:1, orange 4.54:1, green 9.28:1,
  amber 7.53:1, pink-red 8.52:1; 3:1 is the usual floor for a line that
  carries meaning). The line was thin, not pale, which is why the fix is
  its weight and not its colour.
- **High Contrast:** the line stays 3px, in the theme's text colour.
- **Tests:** 357 test files / 8,593 tests (2 skipped) at the start, where
  two of the file gateway's own tests failed under the full run's load on
  Windows and passed alone (a known entry in `docs/OUTSTANDING.md`, not
  this work); 357 / 8,597 (2 skipped) after the change and 357 / 8,598
  (2 skipped) after the first review round's corrections, all passing.

---

## 4. Still not right, and not this session's to change

- **Under High Contrast the status dot disappears.** The theme paints over
  every filled shape, so the dot beside the word is gone there (the word
  and the line stay). That is true of the status dot everywhere in the
  app, not only here, and where a dot stands without a word (a project's
  card on the Summary, the rows of the item picker) the status is gone
  with it. It is filed in the list of things still broken
  (`docs/OUTSTANDING.md`) for a session of its own.

---

## 5. The question, when you test

1. **The line's weight.** It is 3px now. Pictures 7 and 8 show 2, 3 and
   4px side by side, in every status colour. Judge it on an *In progress*
   (orange) or a *Waiting to start* (grey) item, where it looks thinnest.
   Keep 3px, or make it thicker (4px) or thinner (2px)?

---

## What was checked, and what was not

Checked in the development copy with its test data, at 1440x900 and
1280x700, in Chromium through `scripts/fx6-shots.mjs`: the six windows
before and after (the line's thickness, style and colour, the band's
height, the word's place and the details' place measured in each), the
three weights side by side in every status colour on both grounds, and the
task window under Chromium's High Contrast imitation. A status changed in
the task window recolours the thicker bar at once (checked in Chromium).
The weight is set in one place in the app's stylesheet and every window
uses it; the automated tests hold that, and fail if a window hands the
banner anything but its status, or if a rule in the app's stylesheets
that names the banner, or that reaches it in a window as the app draws
it, gives the line another weight or a second line. Nothing was run signed in to a
real project, the desktop app was not opened, and a real Windows High
Contrast theme was not tried (Chromium's imitation was).
