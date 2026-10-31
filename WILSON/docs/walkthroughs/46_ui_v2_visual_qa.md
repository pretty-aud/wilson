# Walkthrough 46 — V2: the second look at every screen

UI overhaul session **V2**, plan §5 Wave 4 — the second visual pass you asked
for in W16, after the D.O.G., O.T.T.E.R. and R.A.B.B.I.T. sessions and before
P1 closes the overhaul. Branch `ui/v2-visual-qa`, integrated into
`feat/ui-overhaul`. Nothing here reaches the beta: `feat/multi-user-v1` is
untouched.

**Nothing in here needs an answer now.** You ruled (W14) that walkthroughs
wait for the end of the whole UI pass. The questions at the bottom are for
that final read; no session is waiting on them.

Audrey — V1 walked the app before the three tool sessions rebuilt it. This
is the same walk again, afterwards: every page and the screens behind it,
at 1440x900 and at 1280x700, checking the font at every step, the tables and
toolbars, the two kinds of page, and anything that looks off. V2 fixed the
small things it found, each with a check that fails if it comes back, and
wrote everything larger into one list for P1, the session after this one.

**What you will see:** the Timeline's "+ Task" editor fits a short window
and its Save button reads clearly; D.O.G.'s three checkboxes read like the
switch beside them; the Files page shows whole dates; asset types read
"Script" rather than "script"; one line fewer under the Budget reports' tabs;
and a few faint greys you can now read. Everything else in here is a list —
what the walk measured, what is still off, and your questions — and the
pictures sit side by side in `docs/sessions/handoffs/img/`, prefixed
`v2-before-` and `v2-after-`.

---

## 1. What was walked

**116 screens at both window sizes**, before the fixes and after them: every
page, the screens behind the tabs, and the pop-ups and side panels the
walking script can open — one more than before, the Timeline's task editor.
**42 more states** that the script cannot reach (menus, pop-overs, filter
strips, questions behind a delete) were opened with a second script and
given the same checks. **Your five sign-in screens** on a short window
(§4). And **every 1280x700 picture by eye**. The last section lists exactly
what was and was not reached.

## 2. Before and after

The same checks as V1's, on every screen, at both window sizes (the counts
are the same at 1280x700 and 1440x900 unless it says otherwise):

| the check | before V2 | after V2 |
|---|---|---|
| **One typeface** | Every character in Geist or Geist Mono except 9 — the arrows and radio circles Windows draws itself (V1's §4.3, still open: walkthrough 35's question 1) | the same 9 |
| **One set of sizes** | 0 off the scale | 0 |
| **Sentence case** | 0 capitals off the label style, by the script's rule; by eye, a handful in Help, Settings and D.O.G. | D.O.G.'s three checkboxes and Settings' "Agent skills" fixed; the rest listed for P1 (§6) |
| **Text on orange** | 0 on the screens the script walked — but 2 in the Timeline's task editor, which it did not open | 0, and the script opens that editor now |
| **Text too faint to read** | 20 places on 3 screens | 9 on 2: O.T.T.E.R.'s Help list and one line in the task editor, both on P1's list |
| **No white surfaces** | 0 | 0 |
| **Nothing overflowing a screen** | 0 | 0 |
| **Dialogs on the window** | the task editor 815px tall on a 700px window, its title out of reach | every dialog fits, and scrolls inside where it must |
| **Your sign-in screens (W7)** | nothing bleeding between the boxes | the same (§4) |

The remaining counts the script keeps (four console messages that only
happen without a real sign-in, the three unnamed window buttons of the
desktop title bar, the codec written in capitals) are all filed, with
their owners, as they were after V1.

## 3. What I fixed

Each fix has a check that fails if the fault comes back; for the ones a
test cannot see, the walking script checks the screen itself.

**The Timeline's "+ Task" editor.** Its Save button was cream text on the
bright orange (3.35 to 1 — your rule is black or white on orange, and the
same fault V1 fixed on the tabs); it is white on the deeper orange now, as
every other main button is (5.18 to 1). "Extend phase", in the dialog that
asks when a task runs past its phase, had the same fault and the same fix.
Its close button had no name for a screen reader; it has one. And on a
1280x700 window the editor was 815 pixels tall: its title and first fields
sat above the top of the window, where nothing could reach them. It now
stops at the standard dialog height and scrolls inside, like every other
dialog, and a message such as "Task title is required." shows just above
the buttons, set off from the fields by a line, wherever you have scrolled
to; a screen reader announces it too
(`v2-before-rabbit-timeline-task-new-1280x700.png`,
`v2-after-rabbit-timeline-task-new-1280x700.png` and
`v2-after-rabbit-timeline-task-error-1280x700.png`). The walking script
opens it now, so its fit, its contrast and its close button are checked on
every walk.

**D.O.G.'s three checkboxes** — "Theme generator", "Use uploaded assets",
"Use project assets" — were small capitals beside the sentence-case "Full
deck" switch on the same row. They read like the switch now.

**D.O.G.'s settings accordions** now behave like O.T.T.E.R.'s: the grey
description under a title stays readable when the pointer is over it, and
the keyboard focus ring shows whole (it was cut off by the row).

**Budget.** The reports (By phase, By role… and Custom) drew a second
hairline just under the tabs' own; the first section no longer draws its
own (`v2-before-rabbit-budget-by-role-1280x700.png` beside the after
picture). An expense's title and description show in full when you hover
them (both are cut short at 1280). The "open invoice" button shows a small
spinner while it fetches. The project Summary's Budget figure now uses the
same money rules as the Budget tab, so one amount cannot print two ways.

**The Files page's dates** printed the date and the time ("9/10/2026,
7:35:00 PM") into a column with room for about two-thirds of it, so every
date ended in "…". They print "Sep 10, 2026" now, like R.A.B.B.I.T.'s file
tables, and show the full date and time when you hover them
(`v2-before-files-project-1280x700.png`).

**Asset types** printed their internal codes ("script", "vfx"); they read
"Script", "VFX" and so on now, in the table, the pop-ups and the pickers.

**Faint grey on tinted rows.** On the Rate Card, the empty row you type a
new role into (and a team member with no rate yet) set its grey words too
faint for its background (3.75 to 1); a selected note's date on the
Dashboard (4.17 to 1) and a template's "Global" in the task templates
(3.85 to 1) the same. All three are the readable grey now.

**Smaller:** the Admin Terminal's Diagnostics label "WILSON VERSION" no
longer wraps onto two lines; Settings' "Agent Skills" tab reads "Agent
skills", as its own heading already did; the R.A.B.B.I.T. Summary's
"Control Panel" button and the Control Panel's "Dashboard" button, the two
ends of the same switch, are the standard button (both were one-offs,
slightly taller and lighter than the buttons beside them); a table's sort button draws its
keyboard focus ring whole (the top was cut); and three R.A.B.B.I.T. screens
(Tasks, Bins, the Control Panel's modules) no longer animate when your
computer is set to reduce motion.

**In the tools that check the app:** the script that opens every screen
now opens the Timeline editor too, and records what the pet covers on each
screen; the script that reaches pop-ups the walk cannot now works on every
page, not only R.A.B.B.I.T.; and a checker that skips comments stopped
skipping part of D.O.G.'s code.

## 4. Your sign-in screens on a short window (your W7)

You kept the thinner sign-in bars on the condition that "nothing is
bleeding from one box to the other". **Nothing does**, on the five sign-in
screens a browser can reach without an account, at 1280x700 and again at
1440x900. Every figure is V1's, to within a pixel (the invite link's
clearance was 207px then):

| screen | content | clear of each orange bar |
|---|---|---|
| company name | 150px | 197px |
| username and password | 290px | 127px |
| forgot password | 220px | 162px |
| an invite link, first step | 129px | 208px |
| a link that has expired or was already used | 192px | 176px |

The space between the bars is 544px at both window sizes. The checks that
walk every other screen also passed on these: one font, no text too faint,
nothing cut. Still not checked, because each needs a real account or a
working link: the new-password form and its "done" screen, the two-factor
step, the workspace chooser, "email sent", the two-factor setup and the
first-login welcome.

## 5. Where the pet sits over your data

Walkthrough 45 asked where the pet sits over something you need (its
question 33). The walking script now measures it on every screen: whatever
the pet's square overlaps that is actually drawn there, not hidden and not
scrolled out of view. When a dialog or side panel is open, the pet is drawn
behind it and covers nothing you can see, so those screens are left out.

On the sample project the pet sits over something on **13 screens at
1280x700** and on **5 at 1440x900**:

| screen | at 1280x700 | at 1440x900 |
|---|---|---|
| D.O.G. | the lower right of the box you type the brief into | clear |
| D.O.G., with the menu open | the words of the "Full deck" switch | clear |
| Home | a note's date ("Sep 18, 2026") | clear |
| Rate Card | a department row's overhead ("—" and the word "Overhead") | clear |
| R.A.B.B.I.T., Intake | the words of the "Run intake" button | the same |
| R.A.B.B.I.T., Summary | clear | two dates ("Aug 21, 2026", "Aug 11, 2026") |
| Tasks, board | the add-a-task line at the foot of a column | clear |
| Budget | a figure in the right-hand column ("+$13,826") | clear |
| Budget, by role | "$1,728" | clear |
| Budget, by asset | "$4,992" and "$3,744" | "$1,872" and "$1,440" |
| Budget, custom view | "$92,172" | clear |
| Budget, client view | "$15,360" and "$9,240" | "$12,942" and "$142,364" |
| Assets, gallery | an asset's phase ("Pre-production") | clear |
| Shots | a shot's timecode ("00:00:12:00") and a "Scene details" button | four fields you type in: the frames and the start date of two shots |

Most are figures at the right of a table. At both sizes it also sits on
the "Run intake" button's words, and at 1440x900 on four of the Shots
fields. With your own projects the things in that corner change; the
place of the corner does not. Nothing was changed here: where the pet
sits is yours to decide (45's question 33, still open, §7).

## 6. What is off, most important first

Everything below is written into one table in the V2 hand-off (§4.2,
84 rows, each gathering one or more items from the lanes and from V2) that
P1 works from, so nothing here is lost.

**Team members and the Rate Card still cut their right-hand columns**
(`v2-before-team-members-1280x700.png`, `v2-before-rate-card-1280x700.png`),
exactly as V1 found: Team members' day rate, status and the deactivate
buttons, the Rate Card's region, tier and the department rows' overhead
default. Both need a decision about what gives way (walkthrough 35's
question 2 for Team members).

**Dates are written six ways** (question 2), and **the Projects page shows
a project's dates one day apart** between its list and its detail — a
time-zone slip, a real bug for P1.

**The Timeline's task editor** (the pop-up behind "+ Task", which the walk
could not reach before) had three faults V2 fixed (§3). Its overall look —
the old brown panel and borders — still waits on walkthrough 42's
question 6.

**Home's Resources column** fades the other five items to an unreadable
brown on the orange (question 3).

**Help pages** still use Title Case headings and menu items ("Basic
Workflow", "Key Features"), spell R.A.B.B.I.T. out two different ways, and
O.T.T.E.R.'s feature list is faint orange (4.23 to 1). All copy, all P1's.

**The same thing drawn different ways**: the three detail pop-ups
(question 4), tables on or off the margin (question 5), how a table is
sorted (a list, a list plus a button, a list plus an arrow), where the
"New …" button sits, how a dialog is closed ("Done" or "Close", orange or
outlined), and four ways to show an empty value ("--", "–", "—", "·").
Each is small; together they are what still makes the tools feel like
three apps. P1 has the list.

**A missing picture shows the browser's broken-image icon** in a thin light
frame (the scene rows and the level and scene pop-ups on the sample
project) where the asset pop-up shows initials instead.

**Small type slips P1 will sweep**: "Control Panel" in Title Case (the
walking script uses that label, so it changes with the scripts), the
Settings → Agent switches drawn as orange blocks in capitals, a model name
cut mid-word in Settings → Models, and a few glyphs still drawn by Windows
rather than Geist (the arrows and radio circles, and "₩" in the currency
list).

## 7. Questions for the final pass

1. **Chips.** The standard chip (the filter buttons down O.T.T.E.R.'s course
   list, "ALL", "MADE FOR ME"…, and the Admin Terminal's filters) is set in
   small capitals, because the component plan says chips use the label
   style. Your sentence-case ruling (Q2) names chips among the things that
   go to sentence case. Which should win?
2. **One way to write a date.** The app writes dates six ways today:
   "Aug 3, 2026", "08/24/2026", "9/2/2026", "2026-09-21", "08/02" and
   "Aug 19, 2026, 7:00 AM". Shall P1 make them one — for example
   "Sep 2, 2026", with the time only where it matters?
3. **Home's Resources column.** When it opens, the other five items on Home
   fade to a brown that is very hard to read on the orange (1.77 to 1; your
   rule is black or white on orange). Home is yours to keep as it is (its
   only change in this overhaul was the font). Keep the fade, or make them
   readable?
4. **The three kinds of detail pop-up.** A level's (or experience's), a
   scene's (or shot's) and a task's pop-up each draw the same things
   differently: plain text or boxed fields, capital or sentence-case
   headings, "Done" or "Close". Which one should P1 make the others match?
5. **Tables across the full width, or on the margin?** On Levels,
   Experiences, Tasks and Assets the table runs edge to edge while the
   toolbar above it sits on the 24px margin; on Scenes and Budget the
   table sits on the margin too. Which?
6. **Names bold or regular?** Names are bold in the asset, level, scene and
   task tables and regular in the file tables; and the Files page puts its
   dates on the right, as figures, where R.A.B.B.I.T.'s file tables put
   them on the left. One rule for each?
7. **D.O.G.'s settings accordions** have their titles in small capitals,
   the same size as the labels under them; O.T.T.E.R.'s have a bold 14px
   title, which reads as a heading. Make D.O.G.'s like O.T.T.E.R.'s?
8. **Side panels' titles.** Every side panel (File activity, Edit history,
   R.A.B.B.I.T. settings) is titled only by a small capitalised word at the
   top; a dialog has a proper title. Give side panels a title too?
9. **Talent's rate** shows "900", bold, with no currency; Crew/team's shows
   "$520". Make them the same?

**Still open from earlier walkthroughs, not asked again:** 45's questions
30 (Enter and the pet), 33 (the pet over data — §5 above has the measured
list), 12, 14, 19, 20, 24, 27 and 32; 42's question 6 (the Timeline task
editor's look — V2 fixed only its contrast, its close button and its
height, §3), 8, 9, 11, 18, 22 and 26; 44's 16–18, 27 and 28; 43's 32 and 33;
41's 16; 38's 24; 35's question 1 (Geist's full release — now also for the
"₩" in the currency list); and 32's question 1 (the Close WILSON box).

---

## What was walked, and what was not

**The walking script** (`scripts/ui-walk.mjs`, V1's, extended by every
session since) opened **116 screens** at both window sizes, before and
after the fixes: the twelve pages, the shell's menu and quit box, D.O.G.'s
two dialogs, O.T.T.E.R.'s views and sixteen of its dialogs and panels,
R.A.B.B.I.T.'s tabs, its ten Budget views, its Levels and Experiences, its
pop-ups and side panels, Settings' tabs, the Admin Terminal's sections,
Help's sections, and — new in V2 — the Timeline's task editor. Each screen
is proven open before it is measured, and the script asks the browser which
font drew every character.

**A second script** (`scripts/ui-probe.mjs`, extended in V2 to work on
every page and to run the same checks) opened **42 more states** the walk
cannot, at both sizes: Budget's filter strip, saved views, the three
margin-and-contingency pop-overs, "Reset M/C", the new-expense form and
bulk delete; Scenes' filter strip, saved views, the new-shot scene picker,
the shots nested under a scene, their bulk bar and the takes dialogs; the
project switcher; Bins' menus; Tasks' bulk delete; the Timeline's task,
phase and key-date editors; a new level and its delete question; Home's
Resources column; Settings' remove-department question, currency list and
template editor; the Admin Terminal's Add people menu and its two
dialogs; Team members' deactivate question; the Rate Card's currency
list; the Dashboard's two delete questions; D.O.G.'s Help and New project;
O.T.T.E.R.'s Edit menu and course menu.

**By eye:** every 1280x700 picture, all 115, was looked at against the
design rules — the font, headers over their figures, toolbars on one line,
one set of sizes, sentence case, no orange block as the "selected" look,
the pet — and each thing found was checked on the picture before it went
into §6 or the P1 list.

**Not reached:** R.A.B.B.I.T.'s "Assign members" and saved views on the
Team tab (the sample project shows the roster instead); anything that needs
a model to answer first (a quiz's questions, D.O.G.'s AI rewrite menu, a
generated outline); anything only the desktop app has (Google Drive, the
demo folder's questions, the update prompt, a folder picker); and anything
behind a real account (the sign-in stages named in §4).

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. The pictures are in
`docs/sessions/handoffs/img/`, prefixed `v2-before-` and `v2-after-`.
