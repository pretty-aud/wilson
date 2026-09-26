# Walkthrough 44 — R.A.B.B.I.T.: files, assets, relations, Levels and Experiences, the Bins list (UI overhaul B4, B4b, B4c)

For Audrey, at the end of the UI pass (W14: nothing here waits on you).
About 30 minutes. Open R.A.B.B.I.T. from your own checkout of
`feat/ui-overhaul` and pick a project. Levels and Experiences need a project
with them switched on (a game project). Part B needs the packaged desktop app
with your real data, in Local Server mode.

Before and after screenshots, at 1440x900 and 1280x700, are in
`docs/sessions/handoffs/img/`: `b4-before-*.png` (before any of this),
`b4b-after-*.png` (halfway) and `b4-after-*.png` (the end).

Everything here is the same screens, the same controls in the same order,
doing the same things. What changed is how they look, and a few keys that
now work where they did nothing.

---

## Part A — what changed, and what to check (any mode)

### 1. The project files table (Summary, Control Panel, Projects page, Intake)

- **One table everywhere**: the same header, row height, text and colours
  at all four places it appears. The Files page's table matches it.
- **Size reads the same number everywhere** (it used to be worked out three
  different ways).
- **Narrow places keep the file name readable.** In Intake and the Control
  Panel the table tightens its cells instead of cutting the name.
- **Every small icon button says what it does** when you hover it
  ("Delete brief.pdf", "File activity for brief.pdf").
- **Check:** the sizes match what you expect, and nothing is cut off.

### 2. The file manager (inside the asset, task and scene popups)

- **Its header is one row**: the title, Table / Gallery as an underline,
  and "Add files" as the orange button, all one height.
- **Gallery pictures fit their frame** (they used to hang past it and be
  cut at the top and bottom).
- **Delete asks on the standard dialog** (it was the system's grey
  pop-up). Escape closes only the question.
- **Gallery cards**: the file-type label is readable now (it was too faint),
  and every card says its file's name when you hover it.
- **Check:** add a file, switch to Gallery, delete a file and cancel.

### 3. The video player

- **It is the standard dialog now**: the file's name as its title in plain
  text (it was small orange capitals), the standard close button.
- **The video is exactly the size it was, and still plays on its own.**
- **One Escape closes only the player**; the popup under it stays.
- **Check:** play a video from an asset's files, press Escape, then Escape
  again (the second closes the asset popup).

### 4. The Assets page

- **Toolbar, table and gallery match the Tasks page**: the same controls,
  heights and underline tabs.
- **Status is a dot and a word** in the table, and a badge on gallery cards
  (the coloured stripe is gone; colour alone was never enough to read).
- **New asset and the asset popup are the standard dialog.** The popup's
  title is the asset's name. Escape closes it. Its tasks table and its
  files table now have the same row height, each in a thin frame.
- **Deleting several assets asks on the standard dialog** (it was the
  system pop-up).
- **The status-warning dialog** (click an asset's "tasks not yet done"
  warning) now shows each status in its own colour. It used to show every
  status in green, even "Blocked".
- **Check:** open an asset, link a scene, change its status, open its
  warning if it has one.

### 5. Relations (the sidebars in the asset, scene, level and experience popups)

- **Both sidebars are one width** (300px) with the same headings.
- **The two pickers look alike now** (link scenes to an asset, link assets
  to a scene).
- **"Scenes: 2 linked" chips** replace "2 scene(s)" in the asset popup's
  relation fields.
- **Check:** link and unlink a scene from an asset, and an asset from a
  scene.

### 6. Levels and Experiences

- **One page underneath now.** The two tabs were two copies of the same
  1,300 lines that had started to drift apart. They are one component,
  proven to draw exactly what the two copies drew before the restyle.
- **The same look as Assets**: toolbar, table, gallery, New, the popup.
- **Rows lose their coloured left edge**; status is a dot and a word.
- **The popup is the standard dialog.** "Add new task" now opens the task
  form INSIDE the popup as its left column. It used to float as a separate
  panel beside the popup. The dialog cannot keep a panel outside itself, so
  it grows wider instead.
- **Escape closes the popup, but Escape inside the task form or the asset
  picker does nothing**, as before, so a half-typed task is never lost.
- **Deleting several asks on the standard dialog** (it was the system
  pop-up).
- **Check:** open a level, add a task, press Escape while typing its title
  (the form stays), link an asset, delete a level and cancel.

### 7. File activity and Relink

- **File activity** (Summary → Control Panel → a file's clock button) is
  the standard side drawer. Its title looks like Edit history's. Escape
  closes it. The file's name stays at the top while the list scrolls.
- **Relink missing files** (only in Local Server mode, see Part B) is the
  standard dialog, with warnings as strips and the confidence as badges.

### 8. The Bins list view

- **The list is the same table as everywhere else** underneath, but it
  keeps its tight Bins spacing: every column is where it was.
- **The header is on the lighter dark ground**, and every sorted column
  shows its arrow (some were squeezed to nothing before). The sorted
  column's name is no longer orange: it is the normal text colour with a
  grey arrow, as on the Files page.
- **Clicking anywhere in a column's header sorts it**, edge to edge.
- **Long values end in "…"** instead of being cut mid-letter.
- **Check:** open Bins, switch to the list view, sort by a few columns,
  select with click, shift-click and ctrl-click, rename a file with a
  double-click, cycle a flag, and drag a file onto a bin.

---

## Part B — the packaged app, with your real data

1. **Relink missing files** (Local Server mode, with a project folder moved):
   the list of missing files scrolls; choose the new folder, check the
   preview, apply. The dialog is locked while it applies. Press Tab through
   it: with a long list, Tab still reaches Cancel and the folder button.
2. **File activity** for a file with a long history: the list scrolls, the
   file's name stays at the top. It clears the app's title bar.
3. **Play a local video** from an asset's files: it starts on its own, at
   the size it used to be. Escape closes only the player.
4. **A game project**: Levels and Experiences, their popups, a new task from
   a popup, a level's thumbnail (change it and remove it).
5. **Bins with your footage**: the list view, a drag onto a bin, a rename.
6. **125% and 150% Windows scaling, and the smallest window**: the level
   popup with the task form open still shows both date pickers whole.

---

## Questions (carried in the hand-off; answer any time)

**From B4 (files table and file manager):**

1. Should cloud uploads carry the file kind that Intake gives local files?
2. The standard dialog adds a ✕ to small question dialogs that had none
   (the Assets bulk delete, the create-task question). Keep it?
3. The task popup's files column is 400px wide, so its file table scrolls
   sideways. Widen the column, or accept the scroll?
4. The file manager's view switch is two words, "Table" and "Gallery". Keep?
5. The batch-upload summary is the neutral notice, not amber. Keep?
6. The files table lists kinds in sentence case. Keep?

**From B4b (Assets and relations): each a visible change made within the rules.**

7. The Assets gallery card lost its 2px status stripe; a badge with the word
   says it instead. Keep?
8. The asset popup: a status badge under the title replaces the coloured
   header line, the orange frame is gone, and the property values are
   borderless in-place editors. Keep?
9. The popup's tasks table has fixed columns: a long title ends in "…" with
   the full title on hover. Keep?
10. The relation fields are chips with a glyph and a count ("Scenes: 2
    linked"). Keep?
11. "Link scene" and "Link shot" are one glyph each; they lost their "+".
    Keep?
12. Both relation sidebars are 300px (they were 360 and 320); names cut
    off sooner, with the full name on hover; status words are grey
    sentence case, not coloured capitals. Keep?
13. A picker over the asset popup dims the window a second time, and the
    pickers and the video player now cover the whole window. Keep?
14. The thumbnail's remove control is 18px in the corner, as before (the
    standard kit has no smaller button). Keep?
15. One picker for both directions of linking? (It would move where one of
    them appears.)
16. The Assets toolbar has ten controls before the data. Search first and
    one "View" menu holding Filter, Sort, Group and Saved views: yes, or
    leave it?
17. At the larger thumbnail sizes, a two-line row (the name over its
    details)? It would be a new view, so it was not done.
18. Clicking a related asset in a level or experience popup does nothing.
    Open the asset beside the popup, or stop it looking clickable?

**From B4c (the video player, Levels and Experiences, the overlays, the Bins list):**

19. The task form opens INSIDE the level / experience popup as its left
    column (it was a separate panel beside the popup). Keep?
20. The video player's title is the file name in plain 16px text (it was
    small orange capitals), and its "not available" message box is 560px
    wide (it was 482). Keep?
21. Levels and Experiences rows lost their coloured left edge; status is a
    dot and a word, as on Assets. Keep?
22. The status-warning dialog is a little narrower (400px, it was 448).
    Keep?
23. File activity's title looks like Edit history's (small grey capitals),
    and Escape now closes the drawer. Keep?
24. The Bins list keeps showing codecs in capitals ("PRORES 422 HQ"), as
    the Inspector does. Keep, or show them as they are stored?
25. Enter on a focused button opens or closes your companion (the app did
    this before any of this work). So the new standard questions do not
    answer Enter where the old system pop-ups did; Space works. This is the
    same question as walkthrough 39's number 10: one answer covers both.
26. The Bins list's sorted column is no longer orange: its name is the
    normal text colour and its arrow grey, as on the Files page. Keep?
27. Asset rows stay 36px tall, because a 36px thumbnail does not fit the
    32px row the plan gives media tables. Keep 36?
28. In narrow places (the Control Panel, Intake, the task popup's files)
    the file-name column stays narrow, so the table does not scroll
    sideways, and long names end in "…". Wider names with sideways
    scrolling instead?
29. Side drawers (File activity, Edit history) do not take the keyboard
    when they open: Tab stays on the page behind them. Should they take it,
    as dialogs do?
