# Walkthrough 34 — R.A.B.B.I.T.'s last hand-written type

UI overhaul bundle **T2**, plan §5 Wave 1. Branch `ui/t2-rabbit`, integrated
into `feat/ui-overhaul`. Nothing here reaches the beta: `feat/multi-user-v1` is
untouched.

Walkthrough 30 was the sweep over the whole app. It could only move type
written as a *class name*. R.A.B.B.I.T. had 105 sizes, faces, weights,
letter-spacings and CAPITALS written the other way — directly on the element,
where they beat every class — and this session moved those. Four files, and one
screen holds 84 of the 105: **Intake**.

**No layout moved and no control changed.** Four column widths grew in one
table, and that is the only thing on this list that is not type; the reason is
below and it is a good one.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. If you would rather just look, the pictures
are in `docs/sessions/handoffs/img/`, six pairs — `t2-before-*` and `t2-after-*`
— for R.A.B.B.I.T.'s Intake, Team, Summary and Timeline tabs, the Projects page
and the Files page, each at 1440x900 and at 1280x700.

---

## The one to look at first: Intake

`t2-*-rabbit-intake-*.png`. Open R.A.B.B.I.T., click Salt Hours, click Intake.

Before, this screen had six different ways of shouting at you. Nearly every
line was in capitals, spaced out, at a size the rest of the app does not use:
PREPARE INTAKE, DROP FILES OR CLICK TO BROWSE, ADD MORE FILES, NEW PROJECT, RUN
INTAKE. After, the capitals are on the four things that really are labels —
CONFIGURATION, PERSONAS, GENERATE and the file count — and everything else is
sentence case at a size from the scale.

Three things to look at:

- **"Drop files or click to browse"** was 14px capitals with wide spacing. It
  is 14px sentence case now. It is the button's own words, and the rule is that
  a button is a button: no button in the app shouts any more.
- **The list of file types under it** (`txt · md · markdown · …`) was 11px in
  the typewriter font. It is 12px in the normal one. It is still very dim —
  that colour is a later session's job, not this one's.
- **"Run Intake"** at the bottom right was 13px capitals; it is 14px sentence
  case, which makes it the largest control on the screen. That is right for the
  thing the screen exists to do.

## Team

`t2-*-rabbit-team-*.png`. The round initials next to each person were being
drawn at **9 and 10 pixels** — computed from the circle's size, so they were
never on the scale and never could be. They are 12px now, in the normal font,
in both sizes of circle.

I tried 13px first and it was wrong: two wide capitals — "WW" — measure 25.6px
inside a 24px circle, and the letters render outside it. 12px fits every pair.

> **One for later, not for you to decide now.** Even at 12px, two W's are
> 23.7px across a circle whose inside is about 22.4px at the height of the
> capitals. Nothing on the type scale really fits two letters in a 24px circle;
> the circle wants to be 28, which two of the four places already are. I have
> written that down for the session that rebuilds Team.

## Summary, and the project files table

`t2-*-rabbit-summary-*.png`. This table is drawn on four different screens
(Intake once you have uploaded something, Summary, the control panel, and the
Projects page). Its column headings were **9px** and its cells **10px** on the
dark pages. Headings are 11px small capitals now and cells are 13px.

The file names, sizes, types and dates keep the typewriter font, because that
is what it is for. **Two columns lost it**: Description, which holds whatever
you type, and Kind, whose whole vocabulary is words like "treatment" and "pitch
bible". Those two are in the normal font now.

**The non-type change.** Making the cells 13px stopped four columns fitting
their own content. I measured rather than guessed, and it took three goes:

| column | was | now | the widest thing it holds |
|---|---|---|---|
| Kind | 90 | 80 | "pitch bible" |
| Type | 52 | 80 | "MARKDOWN" |
| Size | 64 | 88 | "1023.9 KB" |
| Created | 80 | 112 | "Sep 19, 2026" |

Kind gets *narrower* than my first attempt because it also moved to the normal
font, where the same words are 24px shorter. The first attempt sized it for the
typewriter font and pushed the whole table 14px wider than the Intake screen
allows; the version that shipped fits exactly, measured with a 1.1 MB file
whose name, kind, type and size are all the worst case at once.

## Timeline

`t2-*-rabbit-timeline-*.png`. Four small things: the popup that appears when you
hover a phase in the overview keeps the typewriter font (it is a name, a count
and a date range); the two "nothing here yet" messages and the label that
follows your cursor when you drag a task onto another phase move to the normal
font at 13px. The Gantt itself — the bars, the dates, the zoom, the dragging —
is untouched.

### Walkthrough 30 told you something that turns out not to be true

Walkthrough 30 said the phase bars had lost "the only thing that told a phase
bar apart from a task bar at a glance", and that "the two kinds of bar now look
the same". I measured it on your Salt Hours timeline, and they differ on five
things:

| | task bar | phase bar |
|---|---|---|
| weight | normal | **bold** |
| border | 1px | 2px |
| outline | none | a dark ring |
| height | 24px | 28px |
| colours | its own palette | a different one |

Phase against *subgroup* bars — the comparison the code was actually making —
is four things, the loudest being that a subgroup's border is **dashed** and a
phase's is solid.

So nothing needs rescuing here. What is left is a tidying question:

> **Question 1.** The line of code that used to make phase bars different now
> has two identical halves. Do you want it simplified to say what it means —
> "a parent bar is bold" — or left exactly as it is, as a marker that somebody
> once intended more? I have left it alone and written the measurement beside
> it. Either answer is fine; the screen looks the same.

---

## What I would like you to look at and tell me

1. **The initials on Team.** 12px capitals in a 24px circle is a snug fit.
   Please look at 125% and 150% Windows scaling as well as 100% — I can only
   check the one.
2. **Intake's four remaining shouts** (CONFIGURATION, PERSONAS, GENERATE and
   "3 FILES"). Those are correct by the rules — they are labels — but four on
   one screen is still four. Walkthrough 30 asked you a related question about
   field labels elsewhere; one answer should cover both.
3. **The project files table on Intake once you have uploaded something.** It
   is the narrowest of the four places it appears and it now fits exactly. If
   it feels tight, the honest fix is to rebuild that table, which is already on
   the plan.
4. **Question 1 above**, about the phase bars.

## What I did not touch, on purpose

- **Colour.** The very dim greys on Intake, the greens on the project bar, the
  oranges: all a later session's, and changing one here would have made this
  diff impossible to read.
- **Anything you can click.** Drag, zoom, dependencies, the wizard's steps, the
  file picker: all identical.
- **The money columns' figure alignment.** §3.1 wants numbers in tables right-
  aligned with lining figures. The files table has neither, and doing half of
  it is worse than none — that goes to the session that rebuilds the table.

## How I know it is right

- Every page of the app, and every one of R.A.B.B.I.T.'s nine tabs with a
  project open, walked in a real browser at both window sizes: **no errors, no
  sideways scrolling, and not one piece of text at a size off the scale.**
  Before this session that check never opened a project, so it had never
  actually looked at any of the screens above.
- The full test suite: 140 files, 2,911 tests, green — including with the local
  environment file moved out of the way, which is how the build server runs it.
- Three rounds of adversarial review, and they found real things: the initials
  spilling out of their circle, prose set in the typewriter font, and a Size
  column that could not show a file size. All three were invisible in the
  fixture project, which has no file sizes in it.
