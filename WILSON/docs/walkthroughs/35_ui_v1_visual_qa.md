# Walkthrough 35 — V1: every screen walked, and what is off

UI overhaul session **V1**, plan §5 Wave 4 — your ask, recorded as Q13.
Branch `ui/v1-visual-qa`, integrated into `feat/ui-overhaul`. Nothing here
reaches the beta: `feat/multi-user-v1` is untouched.

Audrey — this one is a report more than a change. You asked for a session
that walks every page and every screen behind it, checks the font at every
step and the alignment of every table and toolbar, and names anything off.
I did that on **75 screens at both window sizes**. Until now the checks had
reached the twelve pages you can type into the address bar and nothing
behind them: none of Settings' seven tabs, the Admin Terminal's sections,
Budget's ten views, O.T.T.E.R.'s tools, or any of the dialogs.

I fixed the small things I found, and there is **one change you will see**:
the active tab along the top of R.A.B.B.I.T. The rest are named below, with
the pictures, and seven of them need a decision from you.

---

## 1. Did "stop point 1" come true?

The plan promised that after Wave 1 the app would be one typeface, one set of
sizes, one case, one border, two corner radii and no white, with every table
and dialog still its old self underneath. Measured on all 75 screens:

| the promise | what the walk measured | verdict |
|---|---|---|
| **One typeface** | About 99,500 characters drawn on screen at each size. All but **8** are Geist or Geist Mono, confirmed by asking the browser which font it actually used. | ✅ with one gap (§4.3) |
| **One set of sizes** | 0 pieces of text off the seven sizes, on every screen, at both window sizes. | ✅ |
| **One case** | Capitals only on labels — after I fixed seven places that still shouted (§2). | ✅ now |
| **One border** | True everywhere the stylesheets decide. R.A.B.B.I.T.'s pop-ups and task rows still draw their own 2–3px frames. | ⚠️ R.A.B.B.I.T. only |
| **Two corner radii** | Same story: 11 hand-set corners in R.A.B.B.I.T. | ⚠️ R.A.B.B.I.T. only |
| **No white** | True everywhere except Budget's **Client View**, which is near-white. | ❓ question 4 |
| **Two page classes** | Home, Settings and Help on the light orange; the three tools and all six data pages on the dark. Exactly what you ruled. | ✅ |
| **Dialogs still their old selves** | Confirmed. The four already rebuilt are exactly right; every tool dialog is the old one. **All 18 fit on a 1280x700 screen** — including the task pop-up the plan had flagged as overflowing. | ✅ as expected |

Sizes, overflow and the typeface were already this clean on the twelve main
pages; what is new is that it is now true, and measured, on the screens
behind them.

---

## 2. What I fixed

**The one you will see: R.A.B.B.I.T.'s active tab.** The tab you are on
(Summary, Tasks, Timeline…) was cream text on the bright orange — 3.35 to 1,
which breaks your own rule that small text on orange is black or white, and
this one is on every R.A.B.B.I.T. screen. The text is now the dark ink the
rule calls for (4.91 to 1). The orange fill is unchanged; the plan already
has the session that rebuilds R.A.B.B.I.T. replacing it with an underline.
Compare `t2-after-rabbit-timeline-1280x700.png` with
`v1-rabbit-timeline-1280x700.png`.

**Seven places still shouting in capitals.** The title bars of the Settings
and Help panels in D.O.G., O.T.T.E.R. and R.A.B.B.I.T. said SETTINGS and
HELP & DOCUMENTATION in spaced capitals. A panel title is sentence case by
your ruling, so they now read "Settings" and "Help & Documentation", same
size, same colour. And Budget → Custom's totals row said TOTAL in the
typewriter font; it is the small label style now, like the Rate Card's.

**Four things the code said that the screen did not do** — invisible, but
each was the kind of note that sends the next session the wrong way. The
largest: the sign-in screen's source carried a table of measurements that
were out of date, and I re-took all five.

---

## 3. Your sign-in screens on a short window (your W7)

You asked, when you kept the thinner sign-in bars, to make sure "nothing is
bleeding from one box to the other" on a small window. **Nothing does.** At
1280x700, on the three sign-in screens a browser can reach:

| screen | content | clear of each orange bar |
|---|---|---|
| company name | 150px | 197px |
| username and password | 290px | 127px |
| forgot password | 220px | 162px |

`v1-auth-credentials-1280x700.png` is the tallest of them. The two-factor
set-up and the new-user welcome only exist for a signed-in account, so I
could not reach them; the numbers the sign-in code records for them say they
fit with about 15px to spare.

---

## 4. What is off, most important first

### 4.1 Team members truncates the money

`v1-team-members-1280x700.png`. The Team members table cannot show its own
**Day rate** ("$42,…") or **Status** ("ACTIV" — cut mid-word), and the last
column, where the deactivate buttons are, is clipped at the edge. **Wider
windows do not help:** data pages stop at 1240px wide, so it looks the same
at 1440 and beyond.

I measured what each column needs. Its twelve columns want **1,707 pixels**
and the table has 1,230. Giving money and status the room they need makes
names and emails cut off instead. That is a design call, not a tidy-up, so I
have not made it — question 3.

### 4.2 White text on orange, in about forty places

The fix in §2 was the most visible of a whole family. The walk found **37
places** where light text sits on orange below the size your rule allows —
D.O.G.'s numbered steps, O.T.T.E.R.'s "+ New" and filter chips, and
R.A.B.B.I.T.'s "New task", "Table" and every Budget tab. Behind them are
about 150 lines of code across all three tools.

The fix is mechanical, and your own rulings already decide it: a main
button goes to the darker orange with white text (Q16), and a selected tab
or chip gets black text. But it touches every tool, so it wants a session of
its own rather than a tidy-up — question 2.

### 4.3 Arrows and ticks are not in the font

Geist's files, as the app ships them, do not include → ← ✓ ✕ ● ○ ▸ and a
few others. Where the app uses one — "Run Intake →", "Copied ✓", O.T.T.E.R.'s
round "●/○" option buttons, and every arrow in a generated lesson — Windows
quietly draws that one character in Segoe UI. It is subtle; you would see
a slightly different arrow. About 40 spots in the app's own text, plus all
generated content. The clean fix is to ship the missing characters with
the font, which means downloading a file — question 1.

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
  the department rows' "Overhead" control are cut off at the right.
- **Asset and scene details put a button inside a button**, which the
  browser reports as an error.
- **About 250 icon-only buttons have no name** — row checkboxes, delete
  buttons, the ✕ that closes several dialogs. A screen reader says "button"
  and nothing else, and hovering shows no tooltip.
- **R.A.B.B.I.T. and O.T.T.E.R. still use the old greys** that are too faint
  — about 640 pieces of text. That is the colour pass the tool sessions are
  planned to do; I have counted it, not changed it.

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

## 6. Questions

1. **The missing arrows and ticks (§4.3).** May a session download the full
   Geist font files (free, the same licence as now) to fill the gap? If not,
   the alternative is replacing the ~40 in the app's text with icons and
   living with Segoe UI in generated lessons.
2. **White text on orange (§4.2).** A dedicated session to fix all ~40 now,
   by your two existing rules — or leave each to its tool's session, which
   waits on the track merges?
3. **Team members (§4.1).** Which do you prefer: let this one page run wider
   than 1240px; show the day rate on two lines; scroll the table sideways
   with the name column pinned; or hide a column? (The last two change what
   the page does, so they need your yes.)
4. **Budget's Client View is near-white.** Is that deliberate, because it
   is the page you show a client — like a printed document — or should it go
   dark like everything else?
5. **The Close WILSON box** — walkthrough 32's question 1 is still open. My
   recommendation, having now measured every dialog: move it to the raised
   dark and a plain title, which is what the four rebuilt dialogs look like.
6. **The operator console's code field** — the admin-only console is out of
   scope by your earlier ruling (Q14), and its two-factor code field is
   still a slightly different copy of the one you sign in with. Still out of
   scope?
7. **`gh auth login`**, once, in a terminal in this repo — now owed by eight
   sessions. It lets sessions read the build results without being
   rate-limited.

---

## To look at it yourself

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. The pictures are in
`docs/sessions/handoffs/img/`, prefixed `v1-`.

**How I know.** A script now walks all 75 screens in a real browser and
proves each one opened before measuring it — a screen that fails to open is
a failure, never a pass, because three earlier sessions each found a check
that had been measuring the wrong screen. It asks the browser which font
drew every character, checks every rule of the type scale, checks every
dialog against the window, and measures contrast, borders, corners and
white on every element. It is `scripts/ui-walk.mjs`, and it goes red on
anything new.
