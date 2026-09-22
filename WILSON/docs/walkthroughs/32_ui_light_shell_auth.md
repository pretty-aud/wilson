# Walkthrough 32 — the light pages, the shell and sign-in

UI overhaul bundle **T3**, plan §5 Wave 1. Branch `ui/t3-light-shell-auth`,
integrated into `feat/ui-overhaul`. Nothing here reaches the beta:
`feat/multi-user-v1` is untouched.

**Set your expectations before you open it: this one is almost invisible, on
purpose.** Walkthrough 30 was the pass you said you would recognise as "the
overhaul" — it moved every size on every page. This is the cleanup behind it.
Wave 1 gave three sessions the leftovers the big sweep could not safely reach,
and mine were the settings pages, the app frame and the sign-in screen.

Most of what I changed was already correct on screen and wrong in the source:
a size written as `16px` where it should say "the H2 step", a font weight
asking for a heaviness the app's typeface does not have. Changing those moves
nothing and prevents the next drift. **One thing you will actually see**, and
it is worth a look.

---

## The one visible change: the "Close WILSON" box

`docs/sessions/handoffs/img/t3-before-close-dialog-1280x700.png` and
`t3-after-close-dialog-1280x700.png`.

This is the confirmation that appears when you close the desktop app. It was
the last thing in the app frame still written in the old voice — a four-word
heading wearing four kinds of emphasis at once: capitals, bold, letter-spacing
*and* the typewriter font. The buttons said CANCEL and CLOSE the same way.

It now reads "Close WILSON" over "Cancel" and "Close", in the app's normal
typeface, at the same sizes as before — so the box is exactly where it was and
nothing shifted.

**The part that mattered more than the type.** The orange Close button had
white text on the bright orange, and that pairing measures 3.56 to 1 — under
the 4.5 the rest of the app is held to. The app already has a darker orange for
exactly this job, and white on it measures 5.18. The odd part: the button's
*hover* colour was already the darker one, so for its whole life it has been
one mouse-move away from the legal colour and has spent its resting state
illegible. It rests on the right one now and darkens from there.

Nothing about what the buttons DO changed.

---

## Your sign-in screen's password field, re-checked

The password box on the sign-in screen is two layers stacked exactly on top of
each other: a real password input that lays out the dots but paints them
invisible, and a second layer that draws the asterisks you see. If those two
layers ever disagree about the font by even a fraction, the blinking cursor
drifts away from the end of the asterisks — and you get the specific misery of
not being able to tell how much of your password you have typed, on the screen
everyone passes every day.

It was measured at zero drift before the overhaul changed the typeface. The
plan flagged it as something to re-check afterwards, because a typeface change
is exactly what moves those numbers. **Re-measured in a real browser, at both
window sizes: zero drift on every axis, to two decimal places.**

It is a script now (`scripts/ui-caret-check.mjs`), so it is a number anyone can
re-run rather than a claim in a comment. I also broke it three times
deliberately to make sure it would notice — and one of those was instructive:
when I swapped the hidden layer's font to the normal one, *every* "do the two
layers match?" check still said yes, and only the measurement of the actual
letter widths caught it. The two layers agreed perfectly about a font in which
the dots and the asterisks are different widths.

---

## Two things I found that nobody had looked at

**1. The test that guards the whole type system was not running on Windows —
at all.** T0 built a 35-case guard to hold all its work in place. On any
Windows checkout it silently failed to load, and the test runner reports that
as "one failed file, zero failed tests" — so the summary line stays calm while
the number of tests quietly drops by 35. It was green on the build server
(Linux) the whole time, which is why nobody saw it.

The cause was line endings: Git on Windows rewrites files on checkout, and that
one rewrite broke a step inside the build tool. One line of configuration fixes
it for good. The session working on D.O.G. and O.T.T.E.R. hit the same wall
within minutes of me and dropped its own workaround in favour of this.

**2. Five stylesheets had never been checked by anything.** The audit script
that proves the overhaul is done has a note at the top saying the CSS files are
"counted separately below". There was no below — it only ever read the
JavaScript. So roughly 4,000 lines of styling behind Settings, the Dashboard,
the Admin Terminal and the Files page had been swept by no tool at any point in
this project.

They turn out to be in good shape. Every one of the thirty-six places they set
text in capitals is the one role that is *supposed* to shout. What they do
still carry is a single island: **O.T.T.E.R.'s lesson-reading styles**, which
are entirely pre-overhaul — the three old oranges, the whole old grey ladder,
sizes that are not on the scale. That belongs to a later session by the plan
(it is lane A3's), and it is now counted and listed rather than invisible.

---

## What I deliberately did not do

Three things on surfaces I touched, which I left and wrote down rather than
quietly taking. Say if you would rather they were done now:

- **The Cancel button in that Close box is still grey-on-grey.** The type is
  fixed; the colours are lane work, and I did not want to redesign a button
  while claiming to do a type pass.
- **The Close box's frame is still a 2px orange border with 4px rounded
  corners**, where the rest of the app is now a hairline and two corner sizes.
  Same reason.
- **The operator console's one-time-code field is a third copy** of the field
  you see when you sign in with two-factor, at a slightly different spacing and
  missing a centring correction the other two have. That console is out of
  scope by an earlier ruling of yours, so it stays an open item.

---

## Questions

1. **The Close box** — happy with it as it is, or should its frame and the
   Cancel button be finished at the same time? It is a small job and nobody
   currently owns it.
2. **O.T.T.E.R.'s lesson pages** are the largest un-overhauled surface left in
   the app. They are scheduled, but late. Do you want them pulled forward?
3. **One small thing still needs you**, and it has now been asked six sessions
   running: a single `gh auth login` in this repo. Without it these sessions
   read the build server's results anonymously, which is rate-limited per hour,
   and twice now a session has been unable to confirm whether its own final
   commit passed.

---

## To look at it yourself

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev`. The pictures are in
`docs/sessions/handoffs/img/`, prefixed `t3-`: Home, Settings, Help, the
Dashboard, the Admin Terminal and Files at both window sizes, plus the two
close-dialog shots.

There is no before/after pair for the six pages, and that is the honest report
rather than a gap: they are pixel-identical. The proof is not a photograph but
a measurement — a real browser walks all twelve pages at both sizes and checks
every piece of text it can see. **Zero errors, zero sideways overflow, and zero
text at a size that is not one of the seven.**
