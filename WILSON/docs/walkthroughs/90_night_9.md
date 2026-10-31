# 90 — NIGHT 9

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **DG6** (D.O.G.'s two first cards, stacked and cleaned
up). Each section stands on its own; answer its questions by their numbers.

## DG6 — D.O.G.'s two first cards, stacked, each as wide as what is in it

Your ask of 2026-10-31, with your picture of the two cards side by side at a
very wide window: *"this looks objectively bad. please do a pass to make it
more appealing for the top two cards. leave the output card how it is dont
touch it. i want to keep the 1 and 2 cards stacked not side by side. find a
way to clean this up and make it more visual appealing. use the designer and
UX laws skills for this"*. Measured first at four window sizes, then designed
(one design round on Fable, with the designer and laws-of-UX skills), built,
and reviewed twice on Fable.

1. **The two cards are one under the other at every window size** (your
   words). *1 Project and references* on top, *2 Generate outline* under it,
   the generated output below both. Nothing sits side by side any more.
2. **Each card is as wide as what is in it, and the two are the same
   width.** On a laptop screen (up to about 1,467 px wide) both cards are
   602 px wide: one column of text and controls, the same 576 px column as
   before, and a card that ends just after it. Where the cards used to run
   the whole width with half of each card empty, the space beside them is
   now the page, not the inside of a card.
3. **On a wider window card 1 opens into two columns.** From a window about
   1,468 px wide (a 1920 monitor, your 2,000 px window, a 2560 screen): both
   cards are 1,202 px wide; card 1 has the project on the left (the
   dropdown, New project, its description) and what the deck reads on the
   right (the line *What goes to the AI…*, Uploads, your references, the
   bar, Add references with Core files only), 24 px apart, the two columns
   starting level. Generate outline's box and its button take its full width
   under card 1. Q1 and Q2 below.
4. **Nothing grows past that.** On a screen wider than 2,560 px the cards
   stay 1,202 px wide at the left, under the same left edge as the output
   card; the output card keeps the full width, as it always did. (This also
   settles the note from night 8 that on an ultrawide screen each card was
   about 44 percent empty again.)
5. **The output card is untouched**, and so is everything a person meets in
   the two cards: the same titles, folds and count; Tab visits everything in
   the same order (in the two columns, the left column top to bottom, then
   the right); a screen reader hears exactly what it heard before. The three
   sentences you chose on night 8 (Q1 of walkthrough 89) are as they were.

### What it measured

With the dev fixtures' project (*Salt Hours*) and six references listed;
"empty" is the share of a card to the right of its last word or control.

| Window | Card 1 empty, before | now | Card 2 empty, before | now | Generate on screen, before | now |
|---|---|---|---|---|---|---|
| 1280 × 800 | 42% (full width) | 2% | its box and button 988 px across | 2% (576 px) | no | no |
| 1440 × 900 | 2% (side by side) | 2% | 2% (side by side) | 2% | yes | no |
| 1920 × 1080 | 28% (side by side) | 1% (two columns) | 28% | 1% (1,176 px) | yes | yes |
| 2560 × 1440 | 22% (your picture's layout) | 1% | 23% | 1% | yes | yes |

The 1 or 2 percent left is the card's own edge. With the cards stacked, a
1440 × 900 window shows Generate only after a short scroll once references
are listed (it was in view while the cards sat side by side); at 1280 it
was already below. On a 1920 or wider screen card 1 is shorter than a
single column would be (562 px tall with six references, not 722), so
Generate is in view there. Card 1 in two columns keeps one gap from
night 8: the project's half ends under its description while the references
run on beside it (about 360 px of it with six references; your answer to
walkthrough 89's Q3 kept Uploads with the references). With no project
chosen, New project ends 93 px short of the references' column; choosing a
project closes that to 24, its description filling the column.

### What to do

On the beta after the morning's merge, or the development copy
(`session-a`, the dev fixtures' tester, its project *Salt Hours*). Resize
the window, or use your laptop and your wide monitor.

| # | Do | You should see |
|---|---|---|
| 1 | Open D.O.G. in a window about 1280 px wide (a laptop screen) | The two cards one under the other, both 602 px wide at the left; the page's background to their right; the generated output below them across the full width |
| 2 | Widen the window to about 1,468 px or more | Both cards widen together to 1,202 px; card 1 opens into two columns, the project on the left, *What goes to the AI…* and Uploads at the top of the right; Generate outline's box and button across its card |
| 3 | Choose a project and list six references (**Add references**, tick, **Done**) | The references' column grows downwards; the project's column ends under its description; Generate outline stays under card 1, both cards the same width |
| 4 | Widen the window as far as it goes (your wide monitor, full screen) | The two cards stay 1,202 px wide at the left; nothing inside them stretches; the generated output below runs the full width |
| 5 | Fold each card by its chevron | Each card becomes its header bar at the same width, with its count; the output moves up |
| 6 | Press Tab from the top of D.O.G. | The same order as before: card 1's header, *Choose a project*, New project, Choose file, each listed reference's eye and ×, Add references, Core files only, Remove all references, then card 2's header and its controls |

### Pictures

From Chromium at 1280 × 800, 1440 × 900, 1920 × 1080 and 2560 × 1440, on
the dev fixtures' tester (a made-up project and files). In the folder
*90_night_9 pictures* beside this file, with your own picture
(`her-cards-1-and-2-paired-2026-10-31.webp`):

- `po-dg6-before-01-open-…` and `po-dg6-after-01-open-…` — D.O.G. as it
  opens, no project.
- `po-dg6-before-02-project-…` and `po-dg6-after-02-project-…` — *Salt
  Hours* chosen, six references listed (three items, two files, a note).
- `po-dg6-before-03-single-page-…` and `po-dg6-after-03-single-page-…` —
  the same, with Generate outline switched to Single page (where Generate
  is below the window, the picture shows card 2 at the top of the window).
- `po-dg6-before-04-folded-…` and `po-dg6-after-04-folded-…` — both cards
  folded.

"Before" is the layout of night 8 (side by side from about 1,414 px).

### How it was checked

REVIEW-RESULTS

### Questions

- **Q1. Card 1 in two columns on a wide window.** (a) As built
  (Recommended): from about 1,468 px the project on the left and what the
  deck reads on the right, both cards 1,202 px wide; Generate is on screen
  on a 1920 × 1080 monitor with references listed. (b) One column at every
  size: both cards 602 px wide everywhere; card 1 is taller (722 px with six
  references, no empty space under the project), and Generate is below the
  window on a 1920 × 1080 monitor once references are listed.
- **Q2. Generate outline's box and button on a wide window.** (a) As built
  (Recommended): as wide as the card, 1,176 px, about 190 px wider than the
  box you type into on a 1280 laptop today, the button under the box it
  sends. (b) One column's width, 576 px, at the left, the right half of
  card 2 empty. (c) Card 2 in two columns like card 1: the switch and the
  two checkboxes on the left, the box and Generate on the right, the card
  about 240 px tall instead of 307 (a small change to the page's markup;
  nothing a person or a screen reader meets would change order).
