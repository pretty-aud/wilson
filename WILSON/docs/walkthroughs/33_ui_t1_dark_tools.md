# Walkthrough 33 — T1: D.O.G. and O.T.T.E.R.'s leftovers, and the lesson page

Audrey — this is the short one. Walkthrough 30 was the codemod that moved
2,582 type sizes at once. T1 is the bit that codemod could not reach in your
two dark tools, plus one surface it could not see at all.

**One of these you will notice immediately. The rest you would have to hunt
for.** Five minutes on §1, skim the rest. Two questions at the end.

---

## 1. The O.T.T.E.R. lesson page — the one that actually looks different

Open O.T.T.E.R., click a course, click a subject. The reading pane on the
right is the page this bundle is about.

Compare `docs/sessions/handoffs/img/t1-before-otter-lesson-1280x700.png`
with  `docs/sessions/handoffs/img/t1-after-otter-lesson-1280x700.png`.

| | before | after |
|---|---|---|
| the lesson body text | 16px | **14px** |
| "Timeline frame rate" (a section heading) | 20px, heavy | **16px, semibold** |
| a smaller sub-heading | 17.6px | **14px** |
| the big heading at the top of a lesson | 24px | **20px** |
| `inline code` | 14.4px | **13px** |
| how wide a line of prose runs | 74 characters | **65 characters** |

The width is the part you feel rather than see. Around 65 characters is the
line length typographers settle on for reading; the lesson pane was running to
74. In the "after" shot the paragraph under "Timeline frame rate" wraps after
"Project Settings →" instead of running the full width of the pane.

The net effect is that more of the lesson fits on screen — in those two shots
the whole "Practice Exercise" card is visible after, and was cut off before.

**🚨 QUESTION 1: the body text went from 16px to 14px. Keep it, or put it
back?**

The design system (plan §3.1) anchors the whole app at 14px body and gives
"paragraphs, descriptions, list items" to that step, with no exception for a
reading surface. The lesson pane was at 16 only because nothing had ever set
it — it inherited the browser default while every other surface in the app had
been moved onto the scale.

So 14 is what the system says, and that is what I did. **But a long-form
reading pane is the strongest case anyone could make for 16**, and you are the
one who reads these. If you want it back at 16, say so: it is a one-line
change and the headings, the leading and the line width would all stay as they
are now.

**🚨 QUESTION 2: the ragged right edge.**

In the "after" shot the prose now stops at about 613 pixels, but the
orange-bordered **Key Takeaways** and **Practice Exercise** cards below it
still run the full width. Those cards are not part of the lesson text — they
are O.T.T.E.R.'s own components, and narrowing them means changing the panels,
which belongs to the later session that reworks colours and panels on this
surface (lane A3).

So: live with the ragged edge until A3, or pull that forward? I would live
with it — the reading win is worth more than the alignment cost — but it is a
visible thing I introduced and you should get to say.

---

## 2. D.O.G.'s "Resolve Duplicate" window

You will only see this if D.O.G. generates two versions of the same slide. I
could not make that happen with test data, so there is no screenshot — what I
have instead is a measurement of the box, in the hand-off.

- The title used to render as **RESOLVE DUPLICATE** in capitals. It now reads
  **Resolve Duplicate**, at the section-heading size. Capitals belong to the
  small label step (Q2, which you already ruled on), and a window title is not
  a label.
- The two buttons at the bottom, **Export All** and **Continue**, go from 13px
  to the standard 14px button size.
- Inside the small preview cards, the slide title and subtitle land on the
  scale, and two lines of 10px preview text come up to 13px.

**One honest trade.** Inside those preview cards the subtitle was 11px and the
copy lines under it were 10px; both are 13px now, so a one-pixel difference
between them is gone. One pixel at that size was not visible. What I said in
my first commit — that the difference in grey still separated them — was
**wrong**, and a reviewer caught it: on the card you have actually selected,
both greys resolve to the same value. What separates them now is the rule line
above the copy, and the bullets. If that turns out to be too little when you
next hit this window, tell me and the session that reworks D.O.G. will give
them a real distinction.

---

## 3. What did NOT change

Everything else. T1 touched two component files and one block of stylesheet.
Home, Settings, the D.O.G. main screen, the O.T.T.E.R. course library, Files
and the R.A.B.B.I.T. timeline are all in the screenshot set as a control.

Nine of those twelve control frames are byte-for-byte identical between before
and after. Three are not, and I checked each rather than waving it away:

- **Settings, both sizes** — 729 pixels, all inside one small box: the pet
  card says "Ollie F" in one shot and "Ollie M" in the other. The fixture
  generates Ollie's sex at random.
- **Timeline, 1440x900** — 156 pixels: the glow on the end of one dependency
  arrow in the Gantt.

Neither is text and neither is on a surface this bundle touched.

Colours did not change anywhere. Nor did spacing, borders or corners on the
lesson page — those belong to the session that reworks that surface properly,
and I left them exactly as they were so its diff stays readable. T1 was type
only.

---

## 4. The thing worth knowing even though it is invisible

**The lesson page had never been checked by anything.**

The overhaul has a script that walks all twelve pages in a real browser and
measures every piece of text on screen. It has been reporting "0 text off the
scale" for days. That was true, and it was also not about the lesson page: the
script visits `/otter`, but the lesson pane does not exist until you have
clicked a course *and* a subject — so what it measured was the course library.
The lesson page sat behind that green number with headings at 24px and code at
14.4px. (T2 found the same blind spot on R.A.B.B.I.T. the same afternoon: its
check never opened a project.)

Two things came out of it:

1. The screenshot script now knows how to click into a lesson, so the reading
   surface is in the picture set from here on.
2. The test suite now reads that stylesheet directly and fails if any size in
   it stops being one of the seven steps, if a line-height stops being the
   step's own, if a weight goes off 400/600, or if the reading width leaves
   the 60–66 character band. I broke each one on purpose to watch it go red,
   then put it back — seventeen of those in all.

---

## 5. What I got wrong, and who caught it

Two reviewers went at this before it shipped and found seventeen real defects
between them. Three worth telling you about, because they are the kind that
look fine:

- My new stylesheet test **could not see a whole rule** if that rule were
  written in a slightly newer CSS style. A reviewer rewrote two rules that
  way, left a real 24px heading inside them, and every test stayed green.
- My **test for the test** was checking itself rather than the code — it
  proved a pattern worked on a string I had typed into the test file, never on
  the actual stylesheet. That is exactly the mistake the same file warns about
  in its own header, two paragraphs from where I made it.
- I excused one hard-coded size in O.T.T.E.R.'s code editor on the grounds
  that the editor needs a plain number. True — but there was already a number
  in the design system I had not looked for. The excuse is deleted and the
  editor reads the real value now.

All seventeen are fixed and each one has a test that goes red without the fix.

---

## 6. Still owed to you, from before

`gh auth login`, run once in a worktree. **Six sessions have now needed it.**
Sessions read the build status from GitHub anonymously, which is rate-limited
per hour, and T0 ran out of that budget at the moment it needed to confirm its
own final build. One command, and the whole class of problem goes away.
