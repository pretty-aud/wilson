# Walkthrough 42 — B3: R.A.B.B.I.T.'s Timeline (four sessions: B3, B3b, B3c, B3d)

Audrey — this is the Timeline, all of it, done over four sessions that each
ran out of room and handed on to the next. It covers:

- **the minimap**, your priority: every phase drawn, named and readable;
- **the gantt**: one row across both halves, one set of colours, one legend;
- **the toolbar and the figures** above the gantt;
- **Help, the edit history and the delete questions**, now the app's own
  windows;
- **Settings**, the slide-out, now the same drawer D.O.G. and O.T.T.E.R. use;
- **the task editor's title**.

You asked for no questions until the end (W14), so **the questions are parked
at the bottom**. Nothing here waits on them. (Walkthrough 41 is A3's and 43
is A4's; this one is 42, as planned.)

**What I could and could not see.** Everything was checked against the
development copy with its test project, "Salt Hours", at 1440x900 and
1280x700, and the Timeline at 1024x700 too. The test project has five phases;
to see the minimap with more, the checks added four phases through the app's
own "Phase" form, in memory only. Nothing touched your data.

The screenshots are in `docs/sessions/handoffs/img/`: `b3-before-…` (the
first session's, before anything changed) beside `b3-after-…` (this
session's), and `b3b-minimap-before-…` / `b3b-minimap-after-…` for the
minimap alone with nine phases.

**How to open each thing.** Open R.A.B.B.I.T., open "Salt Hours", pick the
Timeline tab. The minimap is the strip at the top; the gantt is below it.
Settings is the gear at the top right of R.A.B.B.I.T.; Help is the question
mark beside it. The edit history is on the Tasks tab, a task's "View edit
history". A click on a phase's bar in the minimap opens the phase editor.

---

## 1. The minimap (your priority)

You said the minimap had to be easy to read: every phase drawn, nothing
silently cut after six, labels you can read.

- **Every phase is drawn.** It used to stop at six and say nothing. Now the
  strip grows to keep every phase's name: 124px tall for up to five phases
  (the height it always was), 162px at nine, at most 186px at ten. Beyond
  ten the rows get thinner, down to 8px, and are never cut.
- **Each bar says its phase's name**: inside the bar when it fits, beside it
  when it does not. The hover card still shows the full name, the task count
  and the dates.
- **A phase outside the visible window keeps its row**, with a small wedge at
  the edge it went past, so you can see it is there and which way it is.
- **A phase with no dates** keeps its row too, with "· no dates" after its
  name (question 10).
- **The dates along the top** are readable now (they measured 2.29 against
  the minimum of 4.5; now 5.04 and 8.49): every month has its line, the
  labels thin out when they would collide, and the year is written where it
  changes. Nothing overprints at any zoom.
- **Names print on top.** A key date's line or diamond, or the window's
  side, used to cross a phase's name ("Develop◆◆ent" at five years). The
  names now print above them; clicking a key date or the window works as
  before.
- **A date the edge would cut is left out** ("Oc" at the right edge of a
  narrow window); its month keeps its line.
- **The "view is off-screen" arrow** sits over the dates at the top, where
  it used to cover the first two phases' names.
- **The window** (the part the gantt below is showing) is a light orange
  tint with 2px orange sides (question 11).
- **The zoom readout** says the span in words ("2.3 yr", "4.5 mo").
- **What did not change:** clicking, dragging the window, the wheel, the
  edges, the hover card and Fit all do what they did. Dragging a bar in the
  minimap still does not save (it never did; question 8).

Measured at the end of this session, at all three window sizes and all ten
zoom levels: with five phases, all five drawn and none cut; with nine, all
nine drawn and none cut; no label overprints another anywhere.

## 2. The gantt

- **One row across both halves.** The names on the left and the bars on the
  right used to be two separate lists that drifted apart. They are one row
  now: the same height, the same line under it, and hovering either half
  lights both. Checked on every row, at every zoom, at all three sizes, by
  phase and by team member: none off by even a pixel.
- **One set of colours, from the status.** The bars take their colour from
  their status, the same colours the Tasks tab uses: a phase in progress is
  filled orange, a delayed one has an amber outline, a completed one steps
  back to grey (question 12). "Needs revisions" and "final" are the stronger
  fill of their colour (question 13).
- **The links between tasks are grey** (solid between tasks, dashed between
  phases), where they were orange and cyan (question 14).
- **One legend**, a single line between the minimap and the toolbar, naming
  every colour and mark the gantt uses (question 15).
- **A hairline under every row**, like the Tasks table (question 19).

## 3. The toolbar and the figures

- **The toolbar** above the gantt is the app's one toolbar. The zoom (Day,
  Week, Month, Quarter), the grouping and the sort are the app's underlined
  tabs; Undo and Redo are its icon buttons; "Today" is a quiet button.
- **At the narrow 1024px window** the toolbar now wraps onto two lines where
  two of its controls used to print on top of each other (question 16).
- **The eight figures** above the minimap (phases, assets, tasks and so on)
  are the app's figure style, the same as the Summary tab's.

## 4. Help, the edit history, and the delete questions

- **Help** is the app's one window now, 720 wide, laid out like D.O.G.'s
  Help: the pages on the left, the text on the right, each side scrolling on
  its own. Escape closes it.
- **The edit history** is the app's side drawer, 420 wide. It used to slide
  under the title bar in the desktop app and lose its header; it sits below
  the title bar now. Its "Edited" badge is grey (question 17).
- **The five delete questions** ("Remove this dependency?" and the task
  editor's four deletes) were the plain grey browser pop-ups. They are the
  app's small window now, with the same words: Cancel first, the red Delete
  last, and Escape cancels.

## 5. Settings

The Settings slide-out is now the same side drawer D.O.G. and O.T.T.E.R. use
for their settings, so the three tools' settings look and work alike.

- **The same size and place.** It is still 40% of the window and never
  narrower than 420 (576 wide at 1440, 512 at 1280), like D.O.G.'s and
  O.T.T.E.R.'s (question 20). The page behind it dims as before. In the
  desktop app it now starts below the title bar by the app's own rule; it
  used to pad itself by hand.
- **The two tabs** are the app's underlined tabs: "Settings" and "System
  prompts".
- **The lock bar** reads as D.O.G.'s: the padlock, "Locked" or "Unlocked",
  "Read only" or "Editable", and the app's switch.
- **Locked now means locked.** While a tab is locked, every control on it is
  greyed and cannot be changed with the mouse or the keyboard, and its text
  steps down one shade but stays readable. Before, the whole tab was dimmed
  to 60%, which put 80 lines of it below the reading minimum, and the
  keyboard could still change a locked setting (question 21).
- **The five sections** (Timeline display, About, Task templates, Project
  type defaults, Holidays) are the app's cards, spaced as O.T.T.E.R.'s are.
- **The buttons.** "Manage task templates" still opens the task templates
  window, now as a quiet button; it was orange (question 24). A holiday's
  "Add" stays the orange one. "Reset to defaults", and each prompt's "Reset
  to default" and "Save", are quiet text buttons. Help at the bottom is the
  question-mark button, as in D.O.G. and O.T.T.E.R. (question 25).
- **Escape.** Escape now closes Settings, as it closes the other drawers,
  except while you are typing in a field: the fields ignore Escape, as they
  always did, so an unsaved prompt edit is not lost by it. Closing Settings
  any other way (the X, a click on the dimmed page, Escape outside a field,
  Help) still drops a prompt edit you have not saved, as it always did
  (question 22).
- **The project-type ticks** are named for a screen reader ("Scenes: film").
- **Titles in sentence case**: "Timeline display", "Task templates",
  "Project type defaults", "Holidays / blocked days".

Every control is still there and does what it did: both tabs, both locks,
Show weekends, the templates window, the 36 ticks, Reset to defaults, a
holiday's date, name and Add, Import CSV, Export CSV, removing a holiday,
each prompt section, the prompt editors, Reset to default, Save, Help and
the close button.

## 6. The task editor's title

The task editor's title ("Edit phase", "New key date", "Edit asset"…) was
orange, or amber for a key date. It is white now for every kind, the same as
every other window's title (question 23). The small icon beside it keeps its
colour, and the words say what you are editing. The editor's own look (its
dark box and grey header band) is unchanged: that is question 6.

## 7. What was checked

- **The automatic walk** of the Timeline, Settings, Help, the edit history
  and the app's menu, at 1440x900 and 1280x700, and the Timeline at 1024x700:
  no errors, overflow or off-scale type, no unnamed control, no text on
  orange below your rule, no white surface. Settings' own 80 colour pairs
  under the reading minimum and its 39 unnamed controls are gone.
- **One thing the walk flags that is not the Timeline's.** When the walk
  opens Settings or Help over a project's Summary tab, it measures the
  Summary's files table under them: 96 lines of grey text below the reading
  minimum. That table belongs to the next session (B4, the file tables).
- **The minimap**, at all three sizes and all ten zoom levels, with five
  phases and with nine: every phase drawn, none cut, no label overprinting
  another; every gesture as it was.
- **The gantt's rows**, by phase and by team member, at all three sizes and
  all four zooms: one row across both halves, none off by a pixel.
- **All 34 Timeline states** photographed and looked at, one by one.
- **Two rounds of independent review** measured the running app:
  - one reviewer worked every control with the keyboard and the mouse;
  - one measured every colour, size and spacing against D.O.G.'s and
    O.T.T.E.R.'s drawers;
  - one tried to break the automatic checks on purpose.

  The first round found real problems, all fixed and re-measured: the
  holiday date field took the whole row; Escape in a prompt editor wiped an
  unsaved edit; Enter in a holiday field opened the companion; a focus ring
  was cut off; a hover dropped some text below the reading minimum; the
  lock bar, the cards and the prompts did not line up with the other two
  tools. It also found holes in the automatic checks, now closed. The second
  round re-measured every fix, and the minimap at every zoom above all
  (sixty pictures, looked at one by one). It found five more, all fixed and
  re-measured:
  - key-date lines and diamonds crossing the minimap's names;
  - the off-screen arrow covering the first two names;
  - a date cut at the right edge;
  - two Settings buttons stretched across their card (the reset took a
    click anywhere in its row);
  - focus rings cut where the keyboard scrolled a control to the edge.
- **The pets, the page transition and D.O.G.'s preview** were not touched.

## Questions for your final pass (W14)

The first three sessions' nineteen questions, then this session's.

1. **The minimap grows to keep names** (124px up to five phases, up to 186px
   at ten, thinner rows beyond, never cut). Right trade?
2. **The minimap names its phases** on the bars. Keep?
3. **The minimap's dates** ("Oct", the year at January, the first label with
   its year when it fits). Right?
4. **The zoom readout** ("2.3 yr", "4.5 mo"). Fit still goes below the
   slider's six-month end on a short project. Keep Fit as it is?
5. **A phase's label and a sub-phase's label** are two separate rules at the
   same weight (T2's question 4).
6. **The task editor and the phase-extend window**: their delete questions
   are the app's window now, their own look is not. Now, or in a later pass?
7. **Enter on a focused button toggles the companion** (the app's, not the
   Timeline's).
8. **A minimap bar cannot be dragged** to move its phase (it never could).
   Fix it (that changes what a drag does) or leave it?
9. **Two "Today" buttons**, the minimap's and the gantt's. Rename one?
10. **A phase without dates** shows "· no dates" in the minimap. Keep?
11. **The minimap's window**: a light orange tint with 2px orange sides.
    Right weight?
12. **The phase colours**: in progress is the orange fill, delayed the amber
    outline, completed a quiet grey. A group row reads the same. Right?
13. **Needs revisions and final** are the stronger fill of their colour
    beside pending review and approved (needs revisions was pink). Enough of
    a difference?
14. **The links are grey**, solid between tasks and dashed between phases,
    where they were orange and cyan. Keep?
15. **The legend** is its own line between the minimap and the toolbar,
    twelve entries. Keep it there?
16. **At the 1024px window the toolbar is two lines** (it used to overprint
    itself), so the gantt there is 37px shorter. Right?
17. **The history's "Edited" badge is grey** (it was orange); created and
    restored stay green, deleted red. Keep?
18. **The gantt's week dates print a week's date against a month's first
    day** ("Aug 31" beside "Sep 1" overlap at week zoom). Not changed. Apply
    the minimap's no-overlap rule to the gantt?
19. **A hairline under every gantt row.** Right weight?

This session's:

20. **Settings is 40% of the window** (576 at 1440), as D.O.G.'s and
    O.T.T.E.R.'s are; the app's fixed drawer width is 420. Keep the 40%?
21. **A locked tab greys every control**, and the keyboard can no longer
    change a locked setting (it could before). Right?
22. **Escape closes Settings**, except inside a field. A prompt edit you
    have not saved is lost when Settings closes, as it always was with the X
    or a click outside. Keep it that way, or keep the edit until you save?
23. **The task editor's title is white** for every kind (it was orange, and
    amber for a key date); the icon keeps the colour. Right?
24. **"Manage task templates" is a quiet button** (it was orange); a
    holiday's "Add" stays orange. Right?
25. **Help in the Settings footer is the question-mark button** (it said
    "Help"), as in D.O.G. and O.T.T.E.R. Right?
26. **Project type names are Title Case** ("Music Video"), as everywhere
    else in R.A.B.B.I.T. Sentence case everywhere ("Music video")?
27. **While Settings is open, the dimmed page covers the undo and upload
    notices** at the bottom (they sat above the old dimming). Raise them
    above it?
