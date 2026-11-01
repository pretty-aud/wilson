# 92 — NIGHT 10

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **AT1** (the admin terminal wider, the member details
fitted, their confirms in the middle of the window) and **SB1** (O.T.T.E.R.'s
and D.O.G.'s sidebars resized by dragging their edge). Each section stands on
its own; answer its questions by their numbers.

## AT1 — the admin terminal edge to edge, the member details fitted, their confirms centred

Your ask of 2026-11-01, with three pictures (they showed real people, so
they are not copied here and none of the pictures below uses them): *"see
image attached of admin terminal. make it wider there is a lot empty space to
the sides. see second image attached. the member details should fit and
static not able to scroll and i should be able to see everything on a fitted
area. also when i press reset password, any pop up from the buttons in the
member details is inside of the column. the pop up card asking to confirm
should be in the center of the overall admin terminal not inside of the
column."* Measured first at four window sizes, then designed (one design
round on Opus, with the designer and laws-of-UX skills), built, and reviewed
twice on Opus.

### What you see now

- **Wider.** The admin terminal runs edge to edge with the same small margin
  (24 px) the Files page has, at every window size. The title *Admin
  terminal* sits at that margin too, above the section list. Company,
  Diagnostics and Storage keep their reading width (720 px) from the left
  edge of the sections; Models stops at 1240 px so a model's name stays near
  its dropdown; Users, Requests and Logs use the whole width.
- **The member details fit.** Selecting someone opens their details in two
  columns: on the left who they are (Identity) and what they can do (Access:
  role and the two rate-card switches); on the right their account
  (Security: email, last sign-in, two-step sign-in, a ban if any), *Reset
  password*, and the danger zone. Everything shows at once, with no scrolling
  up and down and none sideways, on a 1280 × 800 window and anything larger
  (on the desktop app's 1280 × 800 window too, and even at 1280 × 720).
- **The cut-off left edge is gone.** It came from the account rows: the
  value column was 73 px wide and the *no real inbox* and *Not enrolled*
  labels are about 105 px, so the details slid 34 px sideways and cut the
  first letters of every heading. The value column is 147 px now and a label
  wraps under the email instead.
- **Every confirm from the details opens in the middle of the window**, at
  its full width: Reset password, the two rate-card switches, Deactivate and
  Reactivate. It was laid out inside the details' column (239 px wide,
  centred on the column) because of how the details slide in; that is fixed
  in the admin terminal itself, so nothing else in the app moved. The
  keyboard works as before: the confirm takes focus, Cancel or Escape returns
  you to the button you pressed, and Escape again closes the details.
- **On a laptop-sized window** (1280 or 1440 wide), while someone's details
  are open, the list beside them shows just each person's name and whether
  they are active; the other columns (username, role, rate access, joined)
  are the ones the details show for that person, and they come back when you
  close the details. From 1920 wide the list keeps all six columns. (Before,
  the list scrolled sideways at every size while details were open, and the
  *Joined* column was cut.) Question 2 below.
- Below 1220 wide the details narrow to one column and can scroll up and
  down there; nothing is ever cut off.

### What it measured

With the dev fixtures (a made-up company; the member opened is *Theo
Lindqvist*). The member details' account rows do not load on the test data,
so their height was measured with the same rows put in place, a long email,
both labels and a ban line.

| Window | Empty either side, before | now | Details scroll, before (the real rows) | now | Confirm, before | now |
|---|---|---|---|---|---|---|
| 1280 × 800 | 24 px | 24 px | yes, 166 px hidden, and 34 px sideways | no | 239 px wide, in the column | 400 px, window centre |
| 1440 × 900 | 100 px | 24 px | yes, and sideways | no | in the column | window centre |
| 1920 × 1080 | 340 px | 24 px | sideways | no | in the column | window centre |
| 2560 × 1440 | 660 px | 24 px | sideways | no | in the column | window centre |

The list beside open details: 744 px and scrolling sideways at 1280 before,
424 px with name and status now; 1,064 px with all six columns at 1920.

### What to do

On the beta after the morning's merge, or the development copy (`session-a`,
the dev fixtures' tester). Resize the window, or use your laptop and your
wide monitor.

| # | Do | You should see |
|---|---|---|
| 1 | Open Resources → Admin Terminal on a wide screen | The page edge to edge, a small margin both sides; the title above the section list |
| 2 | Select a member in Users | Their details in two columns beside the list; no scroll bar in the details; every heading's first letter there |
| 3 | Press *Reset password* | The confirm in the middle of the whole window, full width; Cancel brings you back to the button |
| 4 | Flip a rate-card switch, then *Deactivate* | Each confirm in the middle of the window; Escape closes the confirm, a second Escape the details |
| 5 | On a laptop window, with details open | The list shows names and status only; close the details (× or Escape) and the six columns are back |
| 6 | Visit Company, Models, Storage, Requests, Logs, Diagnostics | Each as before, wider where it is a table; nothing scrolls sideways |

### Pictures

From Chromium at 1280 × 800, 1440 × 900, 1920 × 1080 and 2560 × 1440, on
the dev fixtures' tester (made-up people). In the folder *92_night_10
pictures* beside this file:

- `po-at1-before-01-details-…` and `po-at1-after-01-details-…` — Users with
  Theo Lindqvist's details open.
- `po-at1-before-02-confirm-…` and `po-at1-after-02-confirm-…` — the same,
  with Reset password's confirm open.

On the test data the account rows show a one-line notice instead (*Security
details are not available on fixture data*); your real rows fit the same
space, as measured above.

### How it was checked

- Measured in Chromium before and after at the four sizes above, and at
  1280 × 720, 1280 × 768 (the desktop app's 1280 × 800 window, under its
  title bar) and 1024 × 700 (its smallest): the page's margins, the title's
  place, the details' height and width against the window, the list beside
  them, and where each of the four confirms draws, with focus, Escape and the
  return of focus checked each time. Nothing scrolls sideways at any size.
- Why the confirm was in the column: the details slide in, and the way the
  slide was written left them as the frame a confirm is placed in. Measured
  by switching that off on the old page: the same confirm then filled the
  window. Now the confirms sit beside the details, and the details no longer
  keep the slide at rest; the slide looks the same, and stays off if your
  computer asks for less motion.
- Tests: new ones pin that no confirm is inside the details, that focus goes
  in and comes back, the two-column list beside open details and its six
  columns otherwise, the page's full width with the title, the details'
  width and two columns, and the account rows' wider value. Sixteen
  deliberate breakages (each piece of the old code put back, one at a time)
  each turned a test red, and so did ten more for what the two reviews
  changed: twenty-six in all. The whole suite passes.
- Two reviews (on Opus). The first found, with a real key press, that one
  Escape on a confirm closed the confirm and the member details together
  (older than this work, and the brief asks Escape to behave): fixed, one
  Escape closes one thing and you are back on the button. It also found that
  a narrow window just under 1280 (a 1366 or 1536 screen with Windows
  scaling) fell to one scrolling column: the two columns now hold down to
  1220 wide. And a single frame of the wide list squeezed beside new details
  (gone), and three tests that could not fail (rewritten until a deliberate
  breakage turned each red). The second confirmed with real key presses that
  Escape now closes one thing at a time everywhere in Users, and found that
  between about 1160 and 1265 wide (with details open) the search box ran
  under the *All / Active / Deactivated* buttons: the box now narrows
  further, the two columns start at 1220, and nothing overlaps from the
  desktop's smallest window up (measured every 20 px). It also found a few
  wrong numbers in these notes and a test that could not see the list's
  quick switch; all corrected.
- Recorded for you, not changed (OUTSTANDING AT1-01 to AT1-07): the list's
  two columns beside open details (Q2); Company, Diagnostics and Storage stay
  720 wide on a wide window, with empty space to their right (Q1 touches it);
  the search box's hint is cut short beside open details at 1280; below 1220
  the pet sits over the details' corner; the test data shows a notice where
  your account rows go.

### Questions

The work is built on the recommended answer to each; say if you want the
other.

- **Q1. How wide should the admin terminal go on a big screen?** (a) Edge to
  edge, with the same small margin the Files page has (Recommended, built).
  (b) Wider than it was, but stopping short on very large screens, leaving
  some margin either side.
- **Q2. On a laptop-sized window, while someone's details are open, what
  should the list beside them show?** (a) Just each person's name and whether
  they are active; the other columns come back when you close the details
  (Recommended, built). (b) All the columns, scrolling sideways to reach the
  ones that do not fit.

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
