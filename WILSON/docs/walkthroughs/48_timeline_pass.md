# Walkthrough 48 — Post-overhaul S1: the Timeline pass

Audrey — this is the quick pass on R.A.B.B.I.T.'s Timeline you asked for,
built from your answers B1 to B9 on 29 September. Five things changed:

1. **Phase names are orange again, task names are white** — in the name
   column only.
2. **The week header no longer prints one date on top of another.**
3. **Dates land where you put them.** Bars, key dates and the editors were
   all reading your dates one day early; they read the day that is stored
   now.
4. **Task rows have no line under them in the gantt.** Phase rows keep
   theirs, and the name column keeps every line.
5. **The minimap's window slides** to its new size when you switch between
   Day, Week, Month and Quarter.

Nothing else on the Timeline moved. You said not to wait for your report, so
this was built, checked twice by independent reviewers and merged onto the
post-overhaul branch; you can test it whenever suits you.

**What I checked, and where.** Everything was checked in the development
copy with its test project, "Salt Hours" (August to December 2026), at
1440x900 and 1280x700, on this machine's Eastern time. The screenshots are
in `docs/sessions/handoffs/img/`, named `po-s1-…`, each "before" beside its
"after".

**How to open it.** Open R.A.B.B.I.T., open your project, pick the Timeline
tab. The minimap is the strip at the top; the gantt is below it, with the
zoom tabs (Day, Week, Month, Quarter) in the toolbar between them.

---

## 1. Orange phase names, white task names (your B1 and B9)

In the name column on the left of the gantt:

- **A phase's name, and a sub-phase's, is orange**, bold as before. It is a
  new, slightly lighter orange made for small text on the dark background.
  The app's own orange is too dark to read on the phase row's grey band
  (4.1 against the 4.5 minimum); the new one reads at 6.5, and 5.7 when the
  pointer is on the row.
- **A task's name is white** (the app's off-white), always. It used to be
  grey and only turned white under the pointer; the row's highlight now
  shows the pointer instead.
- **Unchanged:** the name printed on a phase's own bar, the minimap's phase
  names, the collapse arrow, "+ New task", and the PHASE / TASK heading.

The orange is a proper colour of the app now, with its contrast checked
automatically, so no one can quietly swap it for one you cannot read.

Shots: `po-s1-timeline-before-1440x900.png` → `po-s1-timeline-after-1440x900.png`
(and the same at 1280x700).

## 2. The week header (your B2: option B)

**What was wrong.** At Week zoom, a month's first day prints two lines —
"Dec 2026" above "Dec 1" — and every Monday prints its date. When a Monday
fell a day or two before the 1st, its date printed right under the month's:
"Nov 30" ran into "Dec 1". At Day zoom the month name ("Dec 2026") is wider
than one day's column, so the next day's line cut through it.

**What it does now.** A date prints only where it fits before the next
line, and a month's first day always wins: the Monday gives way instead.
The Monday keeps its thin line, so the week is still marked. At Day zoom
every day keeps its date, and the month name sits on the background, so no
line runs through it.

**Weekends hidden (your B8b).** In Day view with "Show weekends" off, a
month whose 1st is a Saturday or Sunday used to lose its month name and its
bold line altogether (August and November 2026 had neither). They now show
on the first day that is drawn, Monday the 3rd or the 2nd.

**One more thing I fixed there.** With weekends shown, a 1st on a Saturday
or Sunday drew the weekend shading but not the month's bold line. It draws
both now.

**A problem you will meet there, older than this pass and not fixed yet.**
With "Show weekends" off, switching into or out of Day view moves the gantt
to a different part of the year (from mid-September to mid-December, when I
measured it), the minimap's outlined box shows the wrong weeks, and the
gantt's "Today" button lands past today. With weekends shown none of this
happens. It comes from the Timeline measuring its scroll position as if the
hidden weekend columns were still there. It is recorded for the next
session that works on the Timeline. To look at the weekend month labels,
scroll the gantt back to August or November by hand after switching.

Shots:
- Week zoom, late November into December: `po-s1-week-nov-dec-before-1440x900.png` → `po-s1-week-nov-dec-after-1440x900.png`.
- Day zoom, the month name at December 1: `po-s1-day-dec-before-1440x900.png` → `po-s1-day-dec-after-1440x900.png`.
- Day zoom with weekends hidden, November: `po-s1-day-nov-weekends-hidden-after-1440x900.png` (before, "Nov 2026" was not on the header at all).
- Day zoom with weekends shown, Sunday 1 November: `po-s1-day-nov-weekends-shown-before-1440x900.png` → `po-s1-day-nov-weekends-shown-after-1440x900.png` (the month's line through the weekend shading).
- Each of these, except the last pair, is also there at 1280x700.

**Option C, for later.** You kept option C for its own session "if you want
a week to read as a cell". It would split the header into two bands: the
month across the top, and below it one cell per unit — one per day, one per
Monday-to-Sunday week, or one per month — each with its label inside. A
short week at a month's edge would be one narrow cell, so nothing could ever
print on top of anything. The cost is a new header structure, the help
text, and every screenshot baseline; it changes how the header looks more
than option B did. Say the word and it becomes its own session.

## 3. Dates land where you put them (your B3, B4, B5, B8a)

**What was wrong.** Your dates are stored as plain calendar days, like
"2026-12-01". The Timeline read that as midnight in London, which on your
East Coast machine is the evening before. So every bar, every key date and
every date box in the phase, asset and key-date editors showed one day
early. Dropping a bar on December 3 stored December 3, then drew it on
December 2. Worse, opening one of those editors and pressing Save wrote the
day-early date back.

**What it does now.** A stored day is that day, wherever the computer is.
There are no time zones involved: as you said, the project runs in the
zone the timeline is made in.

**What you will see.** On your machine everything the Timeline draws from a
stored date moves **one day to the right**: every bar, every key date,
every editor's date. That is not a new shift; it is the old one undone. The
bars now sit on the days that are stored. I checked two tasks and a key date
against what is stored:

| | stored | drawn before | drawn now |
|---|---|---|---|
| Task "Lock the shooting script" | Aug 3 → Aug 19 | Aug 2 → Aug 18 | Aug 3 → Aug 19 |
| Task "Scene numbering pass" | Aug 17 → Aug 19 | Aug 16 → Aug 18 | Aug 17 → Aug 19 |
| Key date "Picture lock" | Nov 6 | Nov 5 | Nov 6 |

**Creating a task where you point (your B8a).** Clicking "+ New task" in the
gantt starts the task on the day under the pointer. It used to round to the
nearest line, so a click past the middle of a day made the task on the next
day. The faint preview bar that follows the pointer now covers exactly
where the task will land: that day and the six after it, at every zoom (it
used to sit centred on the pointer, and at Month and Quarter zoom it was
drawn longer than the week). At those two zooms the bar is narrow, so its
"+ New task" label is cut short. Dragging on an empty row to draw a task covers every day you
drag across, the one you let go on included. With weekends hidden, both
count only the days you can see; they used to count the hidden weekend
columns too.

One thing to know about end dates: the Timeline stores a task's end as the
day AFTER its last day, so a task drawn over the 7th, 8th and 9th ends on
the 10th. That is how it has always drawn bars, and "+ New task" has always
proposed a week that way. A few other places treat an end date as the last
day. That is a question for you, below.

**The same fix elsewhere (your B5).** The Projects page showed every
project's start and end one day early; it reads them correctly now. On the
Tasks tab, **"Days passed" now reads one less** than it did: the start date
was read a day early, so the count had an extra day in it (on a project's
first day it now reads 0). "Days remaining" reads the same today, but only
because a second mistake cancelled the first — a day counted twice across
the November clock change — so after that change it would have been a day
short; both count on the calendar now. The Tasks tab's "Key date" button
made the key date on tomorrow if you pressed it in the evening; it uses
today now.

**Your old data (your B4).** As you said, nothing goes back through old
dates. What could have drifted, on this machine, before this change: anything
saved from the phase, asset or key-date editors, a phase dragged with its
tasks, or a minimap bar dragged and released — each could have stored a date
one day EARLIER than you picked — and a key date made with the Tasks tab's
"Key date" button in the evening, which stored one day LATER.

## 4. No line under task rows in the gantt (your B6)

In the gantt half, a task row has no line under it now, and nor does the
"+ New task" row under a phase. The bars read against the column lines
instead. A phase row keeps its line, and the name column on the left keeps
every line, so each name still sits on its own ruled row. This is the same
in every grouping (by phase, team member, asset or scene).

Shots: the Timeline before and after, as in section 1.

## 5. The minimap's window slides on a zoom change (your B7)

The orange outlined box in the minimap shows which part of the project the
gantt is showing. When you switch between Day, Week, Month and Quarter, the
box now **slides and stretches** to its new size over a fifth of a second,
instead of jumping. Everything else that moves it — scrolling the gantt,
dragging the box, Fit, Today, the zoom slider, Ctrl and the mouse wheel,
clicking in the minimap — still moves it at once. If your computer is set
to reduce motion, it does not slide at all.

A few things came with it:

- **Zooming out keeps your place.** Switching from Day or Week to Month or
  Quarter used to jump the gantt months back (Week to Quarter moved its
  first date from mid-September to mid-May). It now keeps the same first
  date on screen, as zooming in always did — unless the gantt is already
  scrolled to the end of its range, where it can only stop at the end. (With
  "Show weekends" off, Day view still moves it: the problem in section 2.)
- The first moment after a zoom change used to draw the box in the wrong
  place for one frame; it no longer does.
- The box also slides when a zoom change takes it off the minimap's edge or
  brings it back, instead of vanishing or popping in.
- The scroll bar under the minimap stops fading when your computer is set to
  reduce motion, like everything else.

To see it: switch from Week to Day, then from Day to Quarter, and watch the
outlined box in the minimap.

---

## Waiting on you

1. **The week header.** Does option B read right to you at Week zoom around
   a month's start (for example late November into December 2026)? Option C
   is there if you want a week to read as one cell.
2. **Bars land where you drop them.** Drag a bar onto a day, let go, and
   check it stays on that day; open a phase or key date and check its dates
   read the days you set.
3. **What an end date means.** The Timeline stores a task's end as the day
   after its last day (a task over the 7th to the 9th ends on the 10th), and
   draws every bar that way. Asset templates, the phase editor's check and
   the database's own rule treat an end as the last day. Should it be "the
   last day" everywhere? It changes how every bar is drawn and every date
   is saved, so it would be its own small session. Until you say, nothing
   changes.
4. **Days passed on the first day.** On a project's first day the Tasks
   tab's "Days passed" reads 0 now (before, a misread date made it 1).
   Should the first day count as day 1?
