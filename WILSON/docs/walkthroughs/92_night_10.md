# 92 — NIGHT 10

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **AT1** (the admin terminal wider, the member details
fitted, their confirms in the middle of the window) and **SB1** (O.T.T.E.R.'s
and D.O.G.'s sidebars resized by dragging their edge). Each section stands on
its own; answer its questions by their numbers.

## SB1 — drag a sidebar's edge to set its width, in O.T.T.E.R. and D.O.G.

Your ask of 2026-11-01, with your picture of O.T.T.E.R.'s courses column:
*"this divider line from the courses sidebar and the overall otter window
should be expanding by grabbing and putting the line to the desired width of
the courses sidebar. lets do the same with the sidebar in the dog tool"*.
Measured first at four window sizes, then designed (one design round, with
the designer and laws-of-UX skills), built, and reviewed twice. The design
round and both reviews ran on Opus: your Fable allowance is used up until
4 November.

### What you see now

- **The line moves.** Point at the thin line between O.T.T.E.R.'s Courses
  column and the rest of the window: the pointer becomes the two-way resize
  arrow. Hold and drag, and the column follows the pointer. D.O.G.'s column
  of pages (under *Deck outline*) works the same way.
- **How far it goes.** O.T.T.E.R.'s courses: from 180 px (a little narrower
  than today's fixed 200) to 480 px. D.O.G.'s pages: from 160 px to 480 px
  (today's fixed width is 240). On a small window it stops sooner, so the
  lesson or the cards beside it keep enough room. On the desktop app's
  smallest window (1024 px wide) O.T.T.E.R.'s stops at 304 px and D.O.G.'s at
  464 px. A width that does not fit a smaller window is drawn narrower, and
  comes back when the window is wide again.
- **It remembers.** The width you leave is kept on this computer, the way the
  hidden or shown courses column already is, so it is there the next time you
  open WILSON. It belongs to the computer, not to your account: your laptop
  and your desktop each keep their own.
- **Double-click the line** to put the column back to its usual width.
- **Hiding the courses still works.** The « button and Ctrl+\ hide
  O.T.T.E.R.'s courses column as before. Showing it again brings it back at
  the width you chose.
- **Nothing looks different until you use it.** At rest the line is the same
  thin line, pixel for pixel. When the pointer rests on it for a moment, while
  you drag it, or when you reach it with the Tab key, a thin orange band lights
  it up.
- **From the keyboard.** Tab reaches the line after the column's own buttons.
  The left and right arrows move it 8 px (40 px with Shift); Home and End go to
  the narrowest and the widest. A screen reader calls it the Courses (or Deck
  outline) divider and says its width in pixels.
- **Changed your mind mid-drag?** Press Escape before you let go and it goes
  back to where it was.
- **D.O.G.'s output.** A wider pages column leaves less room for the slide
  preview in the output card, just as a smaller window does. At the usual width
  the preview is exactly as wide as before.

### What it measured

In Chromium with the made-up test company, at 1280 × 800, 1440 × 900,
1920 × 1080 and 2560 × 1440. Before: O.T.T.E.R.'s courses column was 200 px
at every window size and cut five of the ten names it showed with "…"
(*DaVinci Resolve 1…*, *Project setup …*); D.O.G.'s pages column was 240 px
at every size. Below 180 px the filter buttons in O.T.T.E.R.'s column stick
out of it; at 280 px no name is cut. D.O.G.'s page titles wrap rather than
cut, and take up to five lines at 140 px (three at 160).

After: at rest both columns, their lines and everything beside them are
pixel for pixel what they were at all four sizes. Dragged, the width follows
the pointer exactly, stops at the limits above, and is kept when you let go.

### What to do

| # | Do this | What you see |
|---|---|---|
| 1 | Open O.T.T.E.R. and point at the line to the right of Courses | The resize arrow; after a moment an orange band on the line |
| 2 | Drag it right until *DaVinci Resolve 19* shows in full | The column follows; the lesson moves over |
| 3 | Quit and reopen WILSON (or reload the page) | The column at the width you left |
| 4 | Click « (Hide courses), then the thin strip that is left | The column hides, and comes back at your width |
| 5 | Double-click the line | The column back at its usual width |
| 6 | In D.O.G., drag the line to the right of the pages | The pages column widens; the cards beside it narrow |
| 7 | Press Tab until the line has the orange band, then the arrows, Home and End | 8 px a press; Home and End the narrowest and the widest |
| 8 | Start a drag and press Escape before letting go | The column goes back to where it was |

### Pictures

From Chromium at the four sizes above, on the made-up test company only. In
the folder *92_night_10 pictures* beside this file:

- `po-sb1-before-01-otter-…` and `po-sb1-after-01-otter-…` — O.T.T.E.R. on a
  lesson, the courses column at its usual width: the same before and after.
- `po-sb1-after-02-otter-hover-1280x800` — the orange band on the line, the
  pointer resting on it.
- `po-sb1-after-03-otter-wider-…` — the courses column dragged to 320 px:
  every name in full.
- `po-sb1-before-04-dog-…` and `po-sb1-after-04-dog-…` — D.O.G. with four
  pages, its pages column at its usual width: the same before and after.
- `po-sb1-after-05-dog-wider-…` — the pages column dragged to 360 px.

### How it was checked

- Dragged with a real mouse in Chromium at the four sizes and at 1024 × 700,
  in both tools: the width, the limits, the keys, Escape, the double-click,
  hiding and showing the courses, a reload, and a remembered width on a
  smaller window. No text gets selected and no file drop starts during a
  drag; nothing appeared in the console.
- D.O.G.'s slide preview keeps exactly its width at the usual sidebar width,
  by its own pixel check at 1280 and 1440.
- 37 new tests, 34 of them failing on the code before the change (the other
  three check that nothing else changed and that two of the checks can
  fail); 85 deliberate mistakes planted one at a time in the new code, each
  caught by a failing test.

### Seen and written down, not changed

These are written in the outstanding list (SB1-01 to SB1-04) for after 1.0:

- **Someone who cannot drag** (some people use a switch or a mouth stick)
  has no way to set the width except the keyboard; the accessibility
  guidelines ask for a way that works with clicks alone, for example
  *Narrower* and *Wider* in a small menu.
- **The grab strip is narrow for a mouse**: 8 px wide (24 on a touch
  screen). It also takes the first few pixels of the rows right beside the
  line (O.T.T.E.R.'s lessons list), so a click in those few pixels does not
  open the lesson.
- **The line is faint at rest** (the same faint line every sidebar has), so
  until the pointer reaches it you find it by where it is, not by how it
  looks.
- **With the courses column wide on a 1280 window, the pet covers part of the
  lesson's *Next* button** (it already does at the usual width on an
  1100-pixel window).

### Questions

None. Nothing here waits on you; the four notes above are yours to place
after 1.0 if you want them.
