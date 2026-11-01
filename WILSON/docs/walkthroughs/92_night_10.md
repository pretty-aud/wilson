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
