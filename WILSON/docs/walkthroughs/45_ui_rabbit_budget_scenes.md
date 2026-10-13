# Walkthrough 45 — R.A.B.B.I.T.: the Budget and Scenes (UI overhaul B5, B5b)

For Audrey, at the end of the UI pass (W14: nothing here waits on you).
About 40 minutes. Open R.A.B.B.I.T. from your own checkout of
`feat/ui-overhaul` and pick a project with a budget and scenes. The By level
and By experience reports need a game project. Part B needs the packaged
desktop app with your real data.

Before and after screenshots, at 1440x900 and 1280x700, are in
`docs/sessions/handoffs/img/`: `b5-before-*.png` and `b5-after-*.png` for the
Budget, `b5b-before-*.png` and `b5b-after-*.png` for Scenes. The printed
client estimate is `b5-before-print.png` and `b5-after-print.png`.

Everything here is the same screens, the same controls in the same order,
doing the same things. What changed is how they look, and a few keys that
now work where they did nothing: Escape closes a popover or a popup, and Tab
reaches a row's actions.

---

## Part A — what changed, and what to check (any mode)

### 1. Money, everywhere in the Budget

- **One way of writing money.** The same currency sign, decimals and minus
  sign in every table, tile and report (there were five ways, in two
  locales).
- **Figures line up.** Every amount is in the monospaced face and
  right-aligned, so a column of money reads straight down.
- **A variance carries its own sign** ("+$1,200", "−$300"); a zero is "$0".
- **Check:** with a few budget lines, the Summary, the Topsheet and a report
  agree on every total, to the cent.

### 2. Summary, versions and the Topsheet

- The tiles are the standard stat tiles.
- The versions table marks the active version as the selected row; "Locked"
  is a badge.
- The cost waterfall (subtotal, margin, contingency, bid) is one row style
  with one amount column; the grand total is the page's one large number.
- The Topsheet's total is the table's last row, lined up under its column.
- **Check:** set a version active, lock one, change the margin and
  contingency percentages.

### 3. The seven reports and Custom

- Every report is the standard table, amounts on the right, the total its
  last row (the Custom tab's total did not line up with its table before).
- Status words use the app's one set of status colours: "Bidding" is grey
  (it was purple) and "Needs revisions" amber (it was magenta).
- **Check:** By phase, By role, By asset, By scene, By shot and Custom; in a
  game project, By level and By experience.

### 4. Expenses

- The standard table with the same eleven columns in the same order.
- A row's actions show on hover, and also when you Tab to the row.
- Select all and the row checkboxes have a bigger click target.
- The bulk delete, the single delete and "Reset M/C" ask in the app's own
  dialog, not the browser's box. The expense popup is the same dialog, so
  Escape closes it.
- **Check:** add, edit, filter, save a view, delete one and then several,
  undo with Ctrl+Z.

### 5. The Budget tabs

- One strip, the active tab underlined (it was an orange fill), labels in
  sentence case, icons at the height of their words. All thirteen tabs fit
  in a 1024px window.

### 6. Crew/team and Talent

- **Actual now comes before Variance**, the order every other money table
  uses.
- The sky-blue and slate headers are gone; the thick orange divider is one
  hairline; the actual side is one ground.
- The period cells are taller (28px) and open one popover, which also
  closes on Escape now. Each table scrolls sideways inside its own frame.
- **Check:** enter an actual in a period, attach an invoice, change the
  margin and contingency for a row.

### 7. The client estimate

- **On screen** it is dark, in the app's face, in the standard table.
- **Printed** it is Geist at 13px with 11px column headers and the amounts in
  Geist Mono, on white paper (it was Courier New with 9px headers). The
  printed rows are the same list as the screen's.
- **Check:** Print / export; the PDF is set in Geist and every line matches
  the screen.

### 8. Scenes: the tiles and the toolbar

- Four standard stat tiles (runtime, frames, scenes, shots). Their small
  icons are gone: the standard tile has none.
- The toolbar keeps its sixteen controls in the same order. Scenes / Shots
  and Table / Gallery are underlined tabs (they were orange fills). The size
  buttons are one bordered group, the chosen size with an orange edge.
  Sort and Group are standard fields.
- **The create buttons read "New scene" and "New shot"** (they read "Scene"
  and "Shot"), as "New level" and "New asset" do; the current mode's button
  is the orange one.
- Filter, Sort and Group show an orange edge while they are doing something
  (Filter had orange words).
- At 1440 wide the toolbar is one line in both modes, filters on or off. In
  a 1280 window the search and the count move to a second line; every other
  control keeps the first.
- **Check:** switch Scenes / Shots and Table / Gallery, the three sizes,
  sort both ways, group, search.

### 9. The scene and shot tables

- Standard tables, the same columns in the same order. Scene names are bold
  white (they were orange).
- **Every editable cell looks editable before you touch it:** a select shows
  its arrow and a number or date field its box. Before, their borders
  appeared only while the mouse crossed them.
- Status is a coloured dot and the word; "Needs revisions" is amber.
- A ticked row has a tint and an orange edge on its left (it had a full
  orange frame).
- A row's actions (details, delete) show on hover and when you Tab to the
  row, in the same place on every row.
- **The shots table at 1440:** Description gets whatever room is left, which
  is none at 1440, as before, so Duration and Frames stay in view; Start and
  End scroll into view sideways, as before. At 1280, Duration and Frames
  scroll into view with them. A scene's runtime and its details button stay
  at the window's right edge either way.
- The bulk delete of scenes or shots asks in the app's own dialog.
- **Check:** change a status, a time of day, a framing; type frames; set
  dates; open a scene's shots; tick rows; delete one and then several;
  undo with Ctrl+Z.

### 10. The galleries, the filter strip and saved views

- The cards match the Assets and Levels cards: the status is a badge with
  its word (the coloured bar across the top is gone), and the delete button
  shows on hover and when you Tab to the card.
- The filter strip uses the standard fields; the ✕ that removes a row is red.
- Saved views open a floating menu; the bookmark turns orange once you have
  saved a view; a view loads from anywhere on its row.

### 11. The scene and shot popups

- Each is the app's standard dialog, on the raised dark paper (it was a
  lighter brown with an orange frame), so Escape and Tab behave as in every
  other dialog.
- The title is the name in white with its code beside it; the status is a
  badge under it (it was a coloured line). Delete sits bottom left, Close
  bottom right; a click outside still closes it.
- **The fields have section headings:** Identity and Schedule in a scene;
  Identity, Camera and Schedule in a shot. The same fields in the same
  order. Values you cannot edit (runtime, total frames, the counts,
  duration, parent scene, the folder) have no box, so they no longer look
  like fields.
- Escape while you are editing the name, description or notes undoes the
  edit first; a second Escape closes the popup.
- The new-task form opens as the popup's left column, as in the Levels
  popup. In the smallest window, with the form open, the scene's fields
  stack in one or two columns instead of squeezing to a sliver.
- A task opened from the popup's sidebar opens over it; Escape closes the
  task and leaves the popup.
- **Check:** edit each field, pick a thumbnail, add a file, link an asset and
  a task, open the task and press Escape once, then again.

### 12. Found and fixed by the two review rounds

Two independent reviews went over everything above, in the code and in the
running app. What they caught that you could have met:

- **Undo works inside a scene or shot popup.** Its toast used to sit under
  the popup's shade, so clicking Undo closed the popup instead.
- **Escape in an Expenses relation picker closes the list**, not the whole
  expense with your draft.
- **A margin you type for one expense no longer carries to the next** one
  you open, and is not saved there.
- **Days read the same on every tab** (1.15 is 1.1 everywhere, as before).
- **Ctrl+Z does nothing while a delete question is open**, as when the
  browser's box asked.
- **A scene's shots, opened in the table, fit a 1440 window** with their
  actions in view.
- **Keyboard focus is always visible:** the ring is whole on the Budget
  tabs, the sort headers and the shot table's bands, and never hides under
  a table's header when you Tab back up.
- **Escape in a popup's description or notes** puts you back on that field,
  not at the top of the page.

---

## Part B — the packaged app, with your real data

1. **Scenes with your footage** (Local Server mode): the Takes column, pick a
   take in a shot popup, the primary take's poster standing in for an empty
   thumbnail.
2. **A long scene list:** sort, group, filter, save a view and load it again.
3. **The Budget with real numbers:** print the client estimate to PDF; it is
   set in Geist, and its lines match the screen.
4. **125% and 150% Windows scaling, and the smallest window:** the Scenes
   toolbar wraps inside itself; a scene popup with the task form open keeps
   its date fields whole.
5. **Crew/team and Talent with many periods:** the table scrolls sideways in
   its frame; Tab through the period cells.

---

## Questions (carried in the hand-off; answer any time)

**From B5 (the Budget): each a visible change made within the rules, or a
change the rules kept me from making.**

1. Crew/team and Talent now read Actual before Variance, the order the
   Topsheet, Expenses and the reports already used. Keep the swap?
2. Status colours are the app's one status set: "Bidding" is grey (it was
   purple), "Needs revisions" amber (it was magenta), and Approved and Final
   the same green (they were two greens nobody could tell apart). Does
   Bidding deserve its own colour?
3. Crew and Talent's sky-blue and slate headers, every too-faint grey and
   the forty-seven one-off colours are gone, for the app's three inks.
   Confirm?
4. The active Budget tab lost its orange fill for the underline. Confirm?
5. Crew and Talent's thick orange zone divider is one hairline, and the
   actual side one ground. Confirm?
6. Expenses' and Talent's row actions show when you Tab to the row, as well
   as on hover. Keep?
7. The five hand-made popovers are one popover, and it closes on Escape now
   (none did). Keep?
8. The thirteen Budget tabs: add group captions (Breakdowns, Entry, Output),
   or fold the seven "By …" reports into one tab with a picker? Either is a
   view change, so nothing was done.
9. The Summary has three equal actions: edit the percentages, save a bid
   version, set the budget active. Which one is the page's main action?
10. Ctrl+Z and Ctrl+Shift+Z work in Expenses and Scenes, but only a
    button's tooltip mentions them. There is no shortcut bar (your rule);
    should Help list them?
11. Expenses' toolbar has eleven controls. Group them, or move the rarely
    used "Reset M/C" into a menu?
12. The client estimate prints role codes ("production_designer") as line
    labels. Should it print the rate card's role names?
13. The Client view is dark on screen now (no white surfaces); the printed
    estimate is white paper in Geist. Walkthrough 35 asked about the
    near-white preview. Is this right?
14. A zero margin reads "+$0" in the Summary (the plus is the figure's own
    sign now) but "$0" in Crew and Talent's margin cells, and a variance
    under 50¢ reads "$0" in its red or green. Keep, or make them one rule?
15. Rows you cannot click have no hover highlight now (Summary's tables,
    the reports, Crew and Talent); Expenses' rows, which open the expense,
    keep it. Right?
16. Crew and Talent scroll sideways inside their own frame, with the
    scrollbar under the last row, and their columns are wider for the 13px
    figures. Right?
17. Escape on an Expenses relation picker used to close the whole expense
    popup and lose the draft. After the review, Escape closes the open list
    first and keeps the popup. Confirm?

**From B5b (Scenes), and the two review rounds.**

18. The create buttons read "New scene" and "New shot" (they read "Scene"
    and "Shot"), as "New level" and "New asset" do. That adds a word, not
    only a change of case. Keep?
19. The Scenes toolbar keeps its sixteen controls in one row. The review
    proposed one size control instead of two (they never show together),
    the FPS readout moved into the page header, and the row split into a
    left group (modes, filter, sort, group) and a right group (size, saved
    views, search, count, the create buttons). Do you want that regrouping?
20. The shots table has sixteen columns. At 1440, Description gets no room
    and Start and End scroll sideways, as before. Hide some columns behind
    a column chooser, or keep all sixteen?
21. Editable cells show their control at rest now: a select's arrow, a
    number or date field's box. The review proposed only an underline at
    rest. Keep the arrows and boxes?
22. The four Scenes tiles lost their small icons, because the standard tile
    has none. Adding an icon slot is a kit change. Want the icons back?
23. Scene and shot names in the tables are bold white, not orange, and the
    gallery cards lost the coloured status bar for a badge with the word,
    as on Assets. Keep?
24. The saved-views button on Scenes stays an icon (other pages show the
    word "Views"): at 1440 the shots toolbar has no room for the word. Keep
    the icon?
25. The delete questions (Scenes' three, Expenses' bulk delete and both
    "Reset M/C") open with Cancel focused, so Enter cancels. The browser's
    box used to confirm on Enter. Keep Cancel as the default?
26. Some things are reachable by Tab now that were mouse-only: the shot
    table's scene bands, the row checkboxes, the popups' name, description
    and notes, and the scene popup's shot names. Keep?
27. Escape closes a scene, shot or expense popup even with an unsaved
    description, notes or half-filled task form (the standard dialog's
    Escape). Should the popup ask before throwing a draft away?
28. The popups' fields have section headings (Identity, Camera, Schedule),
    and values you cannot edit have no box. Keep?
29. Older bugs, left alone because nothing may change how Scenes behaves
    in this pass: a shot row's delete inside the scene popup also opens that
    shot; a related asset's click in a popup opens nothing; "Files (N)"
    appears twice in a popup; the ungrouped scene table does not show a
    newly picked thumbnail until something else changes. Fix them in P1?
30. Outside this lane: Enter on any focused button toggles the pet instead
    of pressing the button (Space works). The pets are yours to change, so
    this waits for you. Fix it in P1?
31. In the tables, a scene's or shot's name and description are edited by
    clicking them; Tab does not reach them. Making each one a Tab stop
    (one per row) would change how the tables behave, so it was not done.
    Want it?
32. The Undo toast now sits over menus as well as dialogs, which is the
    standard order. A context menu opened near the bottom centre (Bins,
    Tasks) can sit under a live toast. Keep?
33. At 1280 wide the pet covers some table figures: the Topsheet's
    grand-total variance and the Scenes runtime column. The pets are yours
    to change. Move it?
