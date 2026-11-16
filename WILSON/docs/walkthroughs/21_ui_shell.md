# Walkthrough 21 — the shell and the first rebuilt page (UI overhaul, F2)

For Audrey. 2026-09-11. Continues walkthrough 20 (F1 — tokens, fonts, the
kit's primitives). Nothing here is on the beta; it lives on
`feat/ui-overhaul` until you merge it yourself.

To look at it:

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

---

## 1. What changed, in one paragraph

Every page now draws its header from **one list**. The three tool pages had
three byte-identical header blocks, and the other eight were picked out by a
hand-written chain of `if page is this or this or this`. Adding a page meant
editing three separate lists, and the Files page got added to two of them —
which is why, for three weeks, the busiest table in the app was squeezed into
Home's chrome and lost about 400 pixels of height with nothing anywhere
reporting a problem. There is one list now, and a page missing anything from
it stops the app at startup instead of guessing.

On top of that: the nav strip is grouped and renamed, the tool subtitles are
readable for the first time, and **Team Members is rebuilt** as the reference
page every later session copies.

---

## 2. The things you will notice

**The nav strip.** Open any page and click the hamburger.

- It reads `Home / D.O.G. / O.T.T.E.R. / R.A.B.B.I.T. / Dashboard`, then a
  thin dividing line, then `Tool settings / Resources / App settings`.
- **"SYSTEM SETTINGS" is now "App settings"**, and a tool's own "SETTINGS" is
  now "Tool settings" — your Q7. They used to be two items reading almost the
  same word, one above the other, in the same column.
- It is sentence case, not SHOUTING, and slightly larger. Hovering an item
  turns it **black** instead of fading it grey. The old fade was white text
  going transparent over orange, which is the low-contrast thing your
  all-caps rule exists to stop; black on the orange is the most readable ink
  available and it gets *more* readable as you point at it, not less.
- The strip's right edge now lines up with the hamburger that opens it. It
  was 24 pixels short of it on every page.

**The tool pages.** Go to R.A.B.B.I.T. The line under the wordmark —
"Resource Allocation, Budgeting & Breakdown Intake Tool" — is **black** now.
It was a pale orange on the orange bar, and it measured 2.6:1, which is the
least readable standing text anywhere in WILSON. The wordmark above it stays
white, because at that size white on the orange is legal and black would
look like a mistake.

**Team Members.** This is the big one, and the one to poke at.

- It is on the **dark surface** now, like the tools — your Option A ruling.
  It is not only for looks: on the light orange, the green you were using for
  "Active" measured 2.4:1 and the red 3.1:1, so *no* status colour on that
  page was actually readable. On the dark surface they are, so status is a
  colour and a dot and a word instead of one flat ink for everything.
- The table has one row height, one header, real column alignment, and money
  lines up digit under digit. Day rates are in the monospace face with
  figures that share a width, so a column of numbers reads as a column.
- The near-white box and its near-white header strip are gone (you flagged
  that one directly). The region is still there; it is a hairline and a
  panel in the app's own colours.
- **Row buttons appear on hover.** The deactivate and reactivate buttons used
  to sit there permanently on every row — two hundred pieces of chrome on a
  two-hundred-person roster. They now fade in when you point at a row *and*
  when you reach one with the keyboard, so nothing has become unreachable.
- "Loading" and "nothing here" no longer look identical. Loading draws grey
  ghost rows where the real rows will land; empty draws an icon and a
  sentence.
- Exporting the roster now tells you it worked, and names the file. **See §4
  — I need a yes or no on that one.**

**Everywhere.** The page content's top and bottom padding was measured as a
percentage of window height, so the app's spacing quietly changed as you
resized. It is a fixed 24 pixels now, the same 24 pixels as every other
margin in the app.

---

## 3. What did NOT change

- **The page transition** is untouched — same timings, same title, same
  everything. Your Q18.
- **Home** is untouched. Fonts only, as ruled.
- **D.O.G.'s slide preview** is untouched, and so is everything inside the
  three tools below their header bar. Those are later sessions.
- **Every control on Team Members still does exactly what it did**: the same
  columns, the same three saved views, the same permissions, the same inline
  edits, the same invite, the same two-step rate confirmation, and the CSV
  export still refuses to include wage data in a view that does not show it.

---

## 4. Three things I need you to rule on

Each is small, each is one line to reverse, and I have flagged rather than
assumed.

**(a) The export confirmation.** Clicking Export now pops a small message
bottom-centre: "Roster exported — 14 members to team-roster-2026-09-11.csv".
Before, the file just appeared with no acknowledgement. This is the only
thing on the page that behaves differently from before, and the rule for
this overhaul is that behaviour does not change without you saying so.
**Keep it, or take it out?**

**(b) Escape inside the rate dialog.** Open a member's day rate, click into
the wage field, and press Escape. It now *undoes your edit to that field* and
leaves the dialog open; a second Escape closes it. Before, the first Escape
closed the dialog and threw the edit away. The new behaviour came in with the
shared text field, which learned it from the Bins work — where pressing
Escape in a note used to close the whole dialog and lose the note. I think
the new way is right, but it is a change, so: **keep it, or should Escape
close the dialog on the first press here?**

**(c) Home still says "SYSTEM SETTINGS".** The nav strip and the page's own
title now say "App settings", but Home's six big buttons are ruled
fonts-only, so I did not touch the word there. Right now the app calls one
page two names depending on where you are standing. **Say the word and it
becomes "App settings" on Home too** — it is one string.

---

## 5. What is not finished, and who finishes it

- Five of the six data pages (Files, Projects, Rate Card, Dashboard, Admin
  Terminal) are **still on the light orange**. They move to the dark surface
  one at a time, each in the session that also moves its own text and
  borders. Moving them early would render dark text on a dark page.
- Four shared components are built and tested but not yet used anywhere
  (a section heading, a sidebar, a slide-out panel, a metric tile). They have
  no honest home on Team Members, and inventing one would break the
  no-new-interactions rule. Each is booked to the session that needs it, and
  a test now fails if that list ever grows.
- The tools' insides, R.A.B.B.I.T.'s tables, Settings and the light pages are
  all still their old selves. The big visible sweep — one typeface, one set
  of sizes, sentence case everywhere — is the next session (T0), and it is
  the one you will recognise as "the overhaul".

---

## 6. Pictures

`docs/sessions/handoffs/img/` — every page at 1440x900 and 1280x700.
`ui-f2-after-*` is this session; `ui-f1-after-*` is the same pages before it,
so the pairs line up.

The tables are **empty** in these captures: they were taken in a signed-out
developer mode with no data. The one you asked for — a fake project with a
fake team so tables can be reviewed with rows in them — is waiting as a chip
for you to click.
