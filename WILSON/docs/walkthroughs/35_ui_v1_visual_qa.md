# Walkthrough 35 — V1: the screens walked, and what is off

UI overhaul session **V1**, plan §5 Wave 4 — your ask, recorded as Q13.
Branch `ui/v1-visual-qa`, integrated into `feat/ui-overhaul`. Nothing here
reaches the beta: `feat/multi-user-v1` is untouched.

**Nothing in here needs an answer now.** You ruled on 23 September (W14) that
walkthroughs wait for the end of the whole UI pass. The questions at the
bottom are for that final read, and no session is waiting on them.

Audrey — this one is a report more than a change. You asked for a session
that walks every page and the screens behind it, checks the font at every
step and the alignment of the tables and toolbars, and names anything off.
The checks before this reached the twelve pages you can type into the
address bar and R.A.B.B.I.T.'s tabs. V1 added Settings' tabs, the Admin
Terminal's sections, Budget's ten views, O.T.T.E.R.'s tools and lesson page,
Help's sections, and 18 of the app's roughly 60 pop-ups and panels — **FILL
screens at both window sizes**. What it did not reach is named in the last
section, so nobody reads this as "every screen".

There is **one change you will see**: the active tab along the top of
R.A.B.B.I.T. The rest are named below, with the pictures.

---

## 1. Did "stop point 1" come true?

The plan promised that after Wave 1 the app would be one typeface, one set of
sizes, one case, one border, two corner radii and no white, with every table
and dialog still its old self underneath. Measured on every screen walked:

| the promise | what the walk measured | verdict |
|---|---|---|
| **One typeface** | About 99,500 characters drawn on screen at each size. All but **8 pieces of text** — one character in each — are Geist or Geist Mono, confirmed by asking the browser which font it actually used. | ✅ with one gap (§4.3) |
| **One set of sizes** | 0 pieces of text off the seven sizes, on every screen walked, at both window sizes. | ✅ |
| **One case** | Capitals only on labels — after I fixed ten places that still shouted (§2). Two buttons still use the label style (§4.4). | ✅ nearly |
| **One border** | True everywhere a shared stylesheet decides. D.O.G., O.T.T.E.R. and R.A.B.B.I.T. still draw some 2–3px frames of their own. | ⚠️ the three tools |
| **Two corner radii** | Same story: about a dozen hand-set corners, in the tools. | ⚠️ the three tools |
| **No white** | True everywhere except Budget's **Client View**, which is near-white. | ❓ question 3 |
| **Two page classes** | Home, Settings and Help on the light orange; the three tools and all six data pages on the dark. Exactly what you ruled. | ✅ |
| **Dialogs still their old selves** | Confirmed. The four already rebuilt are exactly right; every tool dialog is the old one. All 18 I opened stay on a 1280x700 screen — three of them only by scrolling inside, which is how they were built. | ✅ as expected |

---

## 2. What I fixed

**The one you will see: R.A.B.B.I.T.'s active tab.** The tab you are on
(Summary, Tasks, Timeline…) was cream text on the bright orange — 3.35 to 1,
which breaks your rule that small text on orange is black or white. It is on
every R.A.B.B.I.T. screen. The text is now black (4.91 to 1), and the same
for the row of Budget tabs just under it, so the two match. **This is a
stopgap, not the finished look**: the design has the selected tab lose the
orange fill and take an underline instead, and the R.A.B.B.I.T. session that
starts next does that. Compare `t2-after-rabbit-timeline-1280x700.png` with
`v1-rabbit-timeline-1280x700.png`.

**Ten places still shouting in capitals.** The title bars of the Settings
and Help panels in D.O.G., O.T.T.E.R. and R.A.B.B.I.T. said SETTINGS and
HELP & DOCUMENTATION in spaced capitals; a panel title is sentence case by
your ruling, so they now read "Settings", "RABBIT Settings" and "Help &
Documentation", same size, same colour. Budget → Custom's totals row said
TOTAL in the typewriter font; it is the small label style now, like the Rate
Card's. And three warnings on the Timeline ("Read only", "Not saved") that
only appear in particular states are the small label style too.

**Four things the code said that the screen did not do** — invisible, but
each was the kind of note that sends the next session the wrong way. The
largest: the sign-in screen's source carried a table of measurements that
were out of date, and I re-took them.

---

## 3. Your sign-in screens on a short window (your W7)

You asked, when you kept the thinner sign-in bars, to make sure "nothing is
bleeding from one box to the other" on a small window. **Nothing does,** on
the four sign-in screens a browser can reach without an account, at
1280x700:

| screen | content | clear of each orange bar |
|---|---|---|
| company name | 150px | 197px |
| username and password | 290px | 127px |
| forgot password | 220px | 162px |
| the "set a new password" link from an email | 129px | 207px |

`v1-auth-credentials-1280x700.png` is the tallest. **Two screens are not
checked:** the two-factor set-up every admin is sent through, and the
new-user welcome. Both need a signed-in account. The only measurement of
them is an estimate from 11 September, taken before the type pass changed
them, which said they fit with about 15px to spare. Worth a look on a
short window when you walk the build.

---

## 4. What is off, most important first

### 4.1 Team members truncates the money

`v1-team-members-1280x700.png`. The Team members table cannot show its own
**Day rate** ("$42,…") or **Status** ("ACTIV" — cut mid-word), and the last
column, where the deactivate buttons are, is clipped at the edge. **Wider
windows do not help:** data pages stop at 1240px wide, so it looks the same
at 1440 (`v1-team-members-1440x900.png`) and beyond.

I measured what each column needs. Its twelve columns want **1,707 pixels**
and the table has 1,230. Giving money and status the room they need makes
names and emails cut off instead. That is a design call, not a tidy-up, so I
have not made it — question 2.

### 4.2 Light text on orange, in about forty places

The tab fix in §2 was the most visible of a family. The walk found **37
places** where light text sits on orange below the size your rule allows —
D.O.G.'s numbered steps, O.T.T.E.R.'s "+ New" and filter chips
(`v1-otter-lesson-1280x700.png`, top left), and R.A.B.B.I.T.'s "New task",
"Table" and the Intake choices.

Your rulings already decide the fix, so this is not a question: a main
button moves to the darker orange that carries white text (your Q16), and a
selected tab or chip loses the orange fill and takes an underline. The
D.O.G., O.T.T.E.R. and R.A.B.B.I.T. sessions that start now (your W13) are
rebuilding exactly those surfaces; each has its list.

### 4.3 Arrows and ticks are not in the font

The font files the app ships do not include → ← ✓ ✕ ● ○ ▸ and a few others.
Where the app uses one — "Run Intake →", "Copied ✓", O.T.T.E.R.'s round
"●/○" option buttons, and every arrow in a generated lesson — Windows
quietly draws that one character in Segoe UI. It is subtle; you would see a
slightly different arrow — or, on O.T.T.E.R.'s new-course form, round
option buttons drawn as text (`v1-otter-new-course-1280x700.png`). About 40
spots in the app's own text, plus all generated content.

The free font package the app uses publishes no extra file with these
characters in it. Whether Geist itself draws them at all is **not yet
known** — finding out means downloading Geist's full release — question 1.

### 4.4 Smaller things, each filed with its owner

- **Tasks: the start dates break in half** at 1280 wide — "2026-11-" on one
  line, "06" on the next — which doubles those rows' height.
  (`v1-rabbit-tasks-1280x700.png`)
- **Timeline's overview labels overprint** each other ("Mar 2026Apr
  2026…"). They touched before the overhaul too; at the new size they
  overlap. It is already the plan's priority for the Timeline session.
- **The "LIVE" presence badge floats over the table** at the bottom left of
  R.A.B.B.I.T., covering a row or a heading. The plan already moves it into
  the project bar.
- **Rate Card's table is wider than its frame** at 1280: the Tier column and
  the department rows' "Overhead" control are cut off at the right
  (`v1-rate-card-1280x700.png`).
- **Asset and scene details put a button inside a button**, which the
  browser reports as an error.
- **Two buttons still use the small-capitals label style** — "FILTER" on the
  Dashboard and "TODAY" on the Timeline. A button is sentence case by your
  ruling.
- **About 250 icon-only buttons have no name** — row checkboxes, delete
  buttons, the ✕ that closes several panels. A screen reader says "button"
  and nothing else, and hovering shows no tooltip.
- **The tools still use the old greys** that are too faint — several hundred
  pieces of text. That is the colour pass the tool sessions are planned to
  do; I have counted it, not changed it.

---

## 5. A correction to walkthrough 32

Walkthrough 32 asked whether to strengthen the faint outline on the app's
secondary buttons and said it fell short of "the accessibility guideline for
the edge of a control". **I checked the guideline and that is not what it
says.** WCAG's own explanation: if a control "has visible content (such as
text…)… a border or other indication of the overall boundary… is not
required". The text in those buttons is 15 to 1. So it is purely a look
question — do you want the outline stronger? — with nothing to fix for
accessibility's sake.

---

## 6. Questions for the final pass

1. **The missing arrows and ticks (§4.3).** May a session download Geist's
   full release (free, the same licence as now) to see whether it draws
   them, and ship them if it does? If it does not, the app's own ~40 get
   icons and generated lessons keep Segoe UI for those characters.
2. **Team members (§4.1).** Which do you prefer: let this one page run wider
   than 1240px; show the day rate on two lines; scroll the table sideways
   with the name column pinned; or hide a column? (The last two change what
   the page does, so they need your yes.)
3. **Budget's Client View is near-white**
   (`v1-rabbit-budget-client-view-1280x700.png`). Deliberate, because it is the
   page you show a client — like a printed document — or should it go dark
   like everything else?
4. **The Close WILSON box** — walkthrough 32's question 1 is still open. My
   recommendation, having now measured the dialogs: move it to the raised
   dark and a plain title, which is what the four rebuilt dialogs look like.
5. **The operator console's code field** — the admin-only console is out of
   scope by your earlier ruling (Q14), and its two-factor code field is
   still a slightly different copy of the one you sign in with. Still out of
   scope?
6. **`gh auth login`**, once, in a terminal in this repo — now owed by eight
   sessions. It lets sessions read the build results without being
   rate-limited.

---

## What was walked, and what was not

A script now opens FILL screens in a real browser and proves each one opened
before measuring it — the proof has to be false before its last click and
true after, and nothing in the app's frame can satisfy it. That rule exists
because checks in this project have measured the wrong screen and reported a
pass five times now — the last one was the first draft of this script. It asks the browser which font drew every
character, checks every rule of the type scale, checks each open dialog
against the window, and measures contrast, borders, corners and white. It
is `scripts/ui-walk.mjs`, and it goes red on anything new.

**Not walked:** about 40 of the app's pop-ups and panels, R.A.B.B.I.T.'s
Levels and Experiences tabs (hidden for the sample project's type),
Timeline's task editor, and anything that needs a signed-in account — the
two sign-in screens in §3 among them. A second visual pass (V2, your W16)
runs after the D.O.G., O.T.T.E.R. and R.A.B.B.I.T. sessions, with the same
script.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. The pictures are in
`docs/sessions/handoffs/img/`, prefixed `v1-`.
