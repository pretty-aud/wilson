# Walkthrough 30 — the type pass, across the whole app at once

UI overhaul bundle **T0**, plan §5 Wave 1. Branch `ui/t0-codemod`, merged into
`feat/ui-overhaul`. Nothing here reaches the beta: `feat/multi-user-v1` is
untouched.

This is the one you said you would recognise as "the overhaul". It is a single
mechanical sweep over every page: one set of font sizes, one case, one weight
pair, one border, two corner radii, and the typewriter font kept only where the
thing on screen is actually data. **No layout moved and no control changed.**
Tables are still tables, every button is still where it was, and every click
still does what it did.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. If you would rather just look, the pictures are
in `docs/sessions/handoffs/img/`, twelve pairs: `t0-before-*` and `t0-after-*`
for Home, Settings, D.O.G., O.T.T.E.R., R.A.B.B.I.T. Timeline and Files, each at
1440x900 and at 1280x700.

---

## The six pairs, and what to look at in each

**D.O.G.** (`t0-*-dog-*.png`) — the clearest pair, look at this one first. The
grey hint lines under each field ("Link a project to include its documents…",
"Source material for generating slide content") were 9 to 10px in the
typewriter font; they are now 12 to 13px in the normal one and you can read them
without leaning in. The big button at the bottom said GENERATE PAGE OUTLINE and
now says "Generate Page Outline". The panel frames went from 2px to a hairline.
The orange section headings did not change, because they were already doing the
job the small-capitals style is for.

**R.A.B.B.I.T. Timeline** (`t0-*-rabbit-timeline-*.png`) — the row of tabs along
the top read INTAKE SUMMARY TEAM TASKS TIMELINE and now reads Intake, Summary,
Team, Tasks, Timeline. The task names down the left of the Gantt are bigger. The
phase and task bars, the dates, the zoom control and the minimap are untouched.

**Files** (`t0-*-files-*.png`) — **not one line changed**, and that is the good
news rather than a gap. You called this page out by name as the worst of them;
an earlier session rebuilt it, and the sweep re-derived every one of its type
decisions from scratch and agreed with all of them. Settings is the same: zero
changed lines. So are Home, Team members, the Rate card and the Dashboard. The
Admin terminal moved by six lines, all in one place and all in the same
direction: three Windows network paths in the storage help (`\\server\share\…`)
got their typewriter font back, because a path is exactly the kind of thing
that font is for. Everything else the sweep found was in the three tools, the
help text and the operator console — the surfaces earlier sessions had not
reached yet.

**O.T.T.E.R.** (`t0-*-otter-*.png`) — course and lesson text steps up a size;
the buttons stop shouting.

**Home** (`t0-*-home-*.png`) — identical by design. You ruled Home stays
ALL CAPITALS and its fonts were already converted, so the sweep skipped it
entirely.

---

## What actually changed, in plain English

**Sizes.** Every hand-written font size in the app — 2,582 of them, in twenty-one
different values from 7px up to 30px — now uses one of seven named sizes. The
smallest is 11px and nothing is smaller. Most of the tiny 9 and 10px text became
13px, which is why the app reads as less cramped.

The rule was not "11px stays 11px". It was: look at what the text *is*. A small
capitals label stays a small capitals label. A sentence is a sentence and can
never become a label, however small it used to be. That distinction is the whole
job — a previous session got it backwards and put 52 runs of ordinary text into
small capitals, and undoing that took a full session.

**Case.** Capitals now survive in one place only: short labels — column headers,
field labels, the little orange eyebrows above a section, status chips. 279 sites
lost their capitals, and 276 of those are buttons and dropdowns. The text in
those buttons was already written in ordinary case in the code; the styling was
shouting it. Now the screen and the code agree.

**Weight.** Bold (700) and medium (500) are gone. There are two weights, normal
and semibold, and that is it.

**The typewriter font.** This was the biggest single cause of the app looking
dated, and 1,338 of its 1,601 uses are gone. It stays for things that are
genuinely data: money, dates and times, file names and paths, ids and codes,
frame counts and timecodes, byte sizes, keyboard keys, code samples. It has left
headings, labels, buttons, form fields, paragraphs and empty states.

**Borders and corners.** Every 2px frame is now a 1px hairline (208 of them).
Every corner radius is one of two values, 3px on controls and 6px on things that
float above the page. Circles stayed circles — avatars, status dots and the
round progress tracks were left alone.

---

## One thing I decided, and four questions still open

**The section headings became sentence case, and I want to tell you why I made
that call rather than asking.** Across D.O.G., O.T.T.E.R., R.A.B.B.I.T. and the
help pages, 54 section headings were written at 14px in bold spaced capitals —
OVERVIEW, BASIC WORKFLOW, KEY FEATURES. The design system calls that shape an
"eyebrow" and gives it the 11px label size, so the first run put them there. Two
reviewers independently caught what that did: it left the headings **smaller
than the paragraphs underneath them**. D.O.G.'s help pane had fifteen headings
at 11px sitting above forty-seven sub-headings at 13px, and the operator
console's only page title was 11px over a 13px paragraph. That is not a style
preference, it is a hierarchy that reads as broken.

So a heading is now a heading: 14px, semibold, sentence case — "Overview",
"Basic workflow". You can see it on O.T.T.E.R.'s library page, where the
category marker that read SOFTWARE now reads "Software". It looks more like
Notion and less like a control panel, which is the direction you asked for, but
it is a real change of character and if you want the capitals back it is one
line in the map and a re-run.

**1. Checkbox and field labels still shout.** On D.O.G. you will see THEME
GENERATOR, USE UPLOADED ASSETS, USE PROJECT ASSETS beside their checkboxes.
Those are field labels, which the system does put in small capitals — correct by
the rules — but three in a row is the loudest thing left on that screen. Same
question as the headings, narrower, and this one I did not decide.

**2. Some names are still shouted.** O.T.T.E.R.'s sidebar shows a course called
DAVINCI RESOLVE in capitals. That span was already uppercase before this work,
and the rule keeps a label's capitals — but a course name is arguably not a
label. Tell me if you want names exempted and I will hand the lanes a list.

**3. Email addresses.** A person's email in the team list is now in the normal
font, not the typewriter one. I judged an address to be closer to a name than to
an id. Easy to reverse if you disagree.

**4. Disabled buttons still fade out.** 94 controls dim themselves to 40%
opacity when disabled, which the design system wants replaced by a proper
"disabled" colour. I measured them and left all 94 alone: 90 of them also paint
their own background, and swapping the fade for a dim text colour would leave a
disabled button sitting there in full-strength orange, looking clickable. That
needs doing per surface by the sessions that follow, not by a search and replace.

---

## What comes next

Three sessions (T1, T2, T3) pick up what a mechanical sweep cannot safely touch:
font sizes written inside JavaScript style objects rather than as classes. There
are 68 of those, plus 40 font choices and 26 letter-spacings, and over half of
them are in one file — R.A.B.B.I.T.'s intake preparation screen. After those the
app is one typeface, one scale and one case everywhere, with every table and
dialog still its old self underneath.
