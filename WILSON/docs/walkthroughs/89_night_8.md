# 89 — NIGHT 8

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **DG5** (D.O.G.'s first two cards on a wide window).
Each section stands on its own; answer its questions by their numbers.

## DG5 — D.O.G.'s first two cards use the width of a wide window

Your ask of 2026-10-30, with your picture of card 1 at a 2,000 px wide
window: *"the redesign has a bit too much negative space. the entire right
side is an empty card. lets do a pass to make sure it is visually
appealing"*. Measured first at four window sizes, then designed (one design
round on Fable; asked for a second look at laptop sizes once its first
layout was on screen, it brought the side-by-side cards down to 1280),
built, and reviewed twice on Fable.

1. **From a 1280 window, the two cards sit side by side.** *1 Project and
   references* on the left, *2 Generate outline* on the right, the
   generated output below both, as wide as it was. So **Generate is on
   screen without scrolling**, even with many references listed. In a
   window narrower than about 1,270 px the two cards stay one under the
   other, exactly as before.
2. **On a very wide window card 1 splits in two.** From about 1,974 px
   wide (your 2,000 px window is one): the project on the left (the
   dropdown, New project, its description) and what the deck reads on the
   right (the line *What goes to the AI…*, Uploads, your references, the
   bar, Add references with Core files only). Generate outline takes the
   last third of the row.
3. **Nothing is stretched to fill.** Every line of text, the bar and the
   boxes keep the width they had (576 px at most), so they stay easy to
   read. Generate outline's box and its button now stop at that width too,
   where on a 2560 screen they ran 2,278 px across. This is what walkthrough
   84's Q4 (b) offered: you do not need to answer that question.
4. **Three sentences lost a direction word**, because what they pointed at
   can now sit beside them. Card 1's hint now ends *choose what else goes.*
   (was *choose what else below.*); the line above Uploads now reads *What
   goes to the AI: what is listed here, the project's title and
   description, and what you write in step 2.* (was *…with what you write
   below.*); under Core files only, with no project, *Core files come from
   a project: choose one.* (was *…choose one above.*; walkthrough 84's DG4
   section, step 1, still quotes the old words). Q1 below.
5. **Nothing else moves.** The same two cards with the same titles, folds
   and count; Tab visits everything in the same order; a screen reader
   hears exactly what it heard before. The output card is untouched.

### What it measured

With the dev fixtures' project (*Salt Hours*) and six references listed;
"empty" is the share of card 1 to the right of its last word or control.

| Window | Card 1 empty, before | Card 1 empty, now | Generate on screen, before | now |
|---|---|---|---|---|
| 1280 × 800 | 42% | none | no | yes |
| 1440 × 900 | 50% | none | no | yes |
| 1920 × 1080 | 65% | 28% | no | yes |
| 2560 × 1440 | 75% | 22% | yes | yes |

At 1920 and 2560 the space left in each card is the same share in both
cards, a margin rather than half a card. On a 2560 screen card 1 is also
shorter (562 px tall with six references, was 722), so the output starts
higher up. One new gap: when card 1 splits, the project's half ends under
its description while the references run on beside it, so with six
references the lower part of the left half is empty (about 360 px of it at
2560; more with many uploads). Q3 below.

### What to do

On the beta after the morning's merge, or the development copy
(`session-a`, the dev fixtures' tester, its project *Salt Hours*). Resize
the window, or use your laptop and your wide monitor.

| # | Do | You should see |
|---|---|---|
| 1 | Open D.O.G. in a window about 1280 px wide (a laptop screen) | Two cards side by side, **1 PROJECT AND REFERENCES** on the left and **2 GENERATE OUTLINE** on the right, the generated output below both |
| 2 | Choose a project and list six references (**Add references**, tick, **Done**) | Card 1 grows downwards; **Generate full deck outline** stays on screen, top right |
| 3 | Widen the window to 2,000 px or more (your wide monitor, full screen) | Card 1 splits: the project on its left, the references on its right; Generate outline the last third of the row; no line of text runs longer than before |
| 4 | Make the window narrower than about 1,270 px | The two cards one under the other, as before |
| 5 | Fold card 1 by its chevron, side by side | Card 1 becomes its header bar with its count; card 2 stays open beside it |
| 6 | Press Tab from the top of D.O.G. | The same order as before: card 1's header, *Choose a project*, New project, Choose file, each listed reference's eye and ×, Add references, Core files only, Remove all references, then card 2's header and its controls |

### Pictures

From Chromium at 1280 × 800, 1440 × 900, 1920 × 1080 and 2560 × 1440, on
the dev fixtures' tester (a made-up project and files). In the folder
*89_night_8 pictures* beside this file, with your own picture
(`her-card1-too-empty-2026-10-30.webp`):

- `po-dg5-before-01-open-…` and `po-dg5-after-01-open-…` — D.O.G. as it
  opens, no project.
- `po-dg5-before-02-project-…` and `po-dg5-after-02-project-…` — *Salt
  Hours* chosen, six references listed (three items, two files, a note).
- `po-dg5-before-03-single-page-…` and `po-dg5-after-03-single-page-…` —
  the same, with Generate outline switched to Single page.

### How it was checked

- Measured in Chromium before and after at the four sizes above, and at
  1024 × 700 and 1366 × 768: the cards' widths, how much of each is empty,
  and where Generate sits.
- The one new piece of styling (the main column measuring its own width)
  was checked in the desktop app's own browser engine (Electron 33) and in
  Chrome: nothing that floats over the page (menus, the rewrite box) moves.
- The slide preview under the cards keeps exactly the width it had at 1280
  and 1440, measured with its own pixel check (whose first step is out of
  date since October; that is recorded for later, and it was run with that
  step set aside).
- D.O.G.'s tests: the order of everything in card 1, the folds, the count
  and the Tab order pass unchanged; new tests pin the widths and the
  arithmetic behind each one; 21 deliberate breakages each turned a test
  red.
- The first review found the third direction word (*above*) and six small
  slips in the tests and these notes, all corrected. The second review
  checked those corrections and found nothing more in the app, only two
  small slips in wording (a number in these notes and a test's comment),
  corrected.

### Questions

- **Q1. The three sentences without a direction word.** (a) As built
  (Recommended): *"The deck's project. Its title and description go with
  every deck; choose what else goes."*, *"What goes to the AI: what is
  listed here, the project's title and description, and what you write in
  step 2."* and *"Core files come from a project: choose one."* (b) Other
  words: write them.
- **Q2. Side by side from a 1280 window.** At 1280 card 1 is a little
  narrower than its usual width, so the project's description takes three
  lines (two before) and the line *What goes to the AI…* two; in exchange
  both cards are full and Generate is on screen. (a) Keep side by side from
  1280 (Recommended). (b) Side by side only from about 1,414 px: at 1280
  the cards stack as before, and Generate is below the fold once
  references are listed.
- **Q3. The empty lower left when card 1 splits.** (a) As built
  (Recommended): the project's half ends under its description; the
  references run on beside it. (b) On a very wide window, put Uploads under
  the project's description too, so the two halves end nearer each other.
