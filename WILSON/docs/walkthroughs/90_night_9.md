# 90 — NIGHT 9

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **DG6** (D.O.G.'s two first cards, stacked and cleaned
up). Each section stands on its own; answer its questions by their numbers.

## DG6 — D.O.G.'s two first cards, stacked, card 1 in titled sections

Your ask of 2026-10-31, with your picture of the two cards side by side at a
very wide window: *"this looks objectively bad. please do a pass to make it
more appealing for the top two cards. leave the output card how it is dont
touch it. i want to keep the 1 and 2 cards stacked not side by side. find a
way to clean this up and make it more visual appealing. use the designer and
UX laws skills for this"*. Measured first at four window sizes, then designed
(one design round on Fable, with the designer and laws-of-UX skills), built,
and reviewed twice on Fable.

**What you said next, the same day, and what it changed.**

- Your answers to this walkthrough's first two questions (asked in the
  controller's chat): Q1 *One column always*, Q2 *Full card width*.
- Then, to the session, with a picture of the beta: *"we need to fix this
  layout. i really dont like that there is a open space/gap to right and
  also project select needs to go above the add references and below the
  references should be the upload option. i want you to do a pass on this
  card to make it more visually appealing and make it easier to read. we
  need a title or something for each function in the project and references
  card. right now it takes a second to comprehend what each function is and
  it would be a lot easier if they were easily visibly divided in the card
  to tell that each is a different function."*
- A second design round (on Opus this time) asked you one question, on a
  very wide screen a section holding only one button: you chose **Keep it**.
- On its sketch you said: *"remove the dividing lines. the titles themselves
  are enough to separate"*, and that each title's text and buttons should
  sit under it, not in a column to its right.

All of that is built. The lines and the pictures below say what you see now.

1. **The two cards are one under the other at every window size**, and the
   generated output below them, untouched.
2. **The two cards run the full width**, the same width as the generated
   output below them: no empty page to their right at any window size.
3. **Card 1 is three titled sections, in your order**: **Project** (the
   dropdown and New project, the chosen project's description), then
   **References** (your items, files and notes, Add references with Core
   files only beside it), then **Uploads** (your files, Choose file). Each
   title is a little larger and brighter than the small capital labels
   inside it, so you can tell a section from the things in it; there are no
   lines between sections, only space, twice the space between the things
   inside one section. Last comes the line *What goes to the AI…* with the
   bar under it, which counts all three.
4. **Lists use the width.** Your references and uploads sit side by side in
   rows of tiles: two across on a laptop, three on a 1920 monitor, up to
   five on your 2560 screen. Each tile keeps its eye and × close to its
   name.
5. **One section's single button stays its normal size** (your *Keep it*):
   with nothing chosen, Project, Uploads and the bar end where they end, so
   on your wide screen the right side of those rows is empty until you add
   things.
6. **Generate outline's box and button run the card's full width** (your
   Q2).
7. **The project dropdown is wider**: it runs beside New project to the end
   of its field, level with the description under it.
8. **The output card is untouched**, and so is every name a screen reader
   hears. Tab visits the same things, with one move you asked for: Choose
   file now comes after Add references and Core files only (it was right
   after New project). A screen reader also hears the three section titles
   as headings. The three sentences you chose on night 8 (Q1 of walkthrough
   89) are word for word as they were.

### What it measured

With the dev fixtures' project (*Salt Hours*) and six references listed;
"empty" is the share of a card to the right of its last word or control.

| Window | Card 1 empty, before (night 8) | now | Empty page beside the cards, now | Generate on screen, before | now |
|---|---|---|---|---|---|
| 1280 × 800 | 42% (full width) | 1% | none | no | no |
| 1440 × 900 | 2% (side by side) | 1% | none | yes | no |
| 1920 × 1080 | 28% (side by side) | 1% | none | yes | no (35 px below) |
| 2560 × 1440 | 22% (your picture's layout) | 41% | none | yes | yes |

At 2560 the 41 percent is the right of the tile rows: three items fill three
of the five tiles a row can hold there; a dozen uploads fill it. With
nothing chosen card 1 is 42 to 74 percent empty on the right from 1280 to
2560 (your *Keep it*). Card 1 is 763 px tall with six references on a
laptop and 669 from 1920, so Generate needs a short scroll below a 1440-tall
window once references are listed; card 2 itself is unchanged inside.

### What to do

On the beta after the morning's merge, or the development copy
(`session-a`, the dev fixtures' tester, its project *Salt Hours*). Resize
the window, or use your laptop and your wide monitor.

| # | Do | You should see |
|---|---|---|
| 1 | Open D.O.G. at any width | Card 1 and card 2 across the full width, one under the other, the generated output below; no empty page beside them |
| 2 | Look at card 1 | Three titles, **Project**, **References**, **Uploads (0)**, each with its own things under it, space between them and no lines; the line *What goes to the AI…* and its bar last |
| 3 | Choose a project and list six references (**Add references**, tick, **Done**) | The project's description beside or under the dropdown; your references as tiles under References, two to five across depending on the width |
| 4 | Upload a file with **Choose file** | It appears as a tile under Uploads, Choose file under it |
| 5 | Fold each card by its chevron | Each card becomes its header bar across the width, with its count; the output moves up |
| 6 | Press Tab from the top of D.O.G. | Card 1's header, *Choose a project*, New project, each reference's eye and ×, Add references, Core files only, Remove all references, each upload's ×, Choose file, then card 2's header and its controls |

### Pictures

From Chromium at 1280 × 800, 1440 × 900, 1920 × 1080 and 2560 × 1440, on
the dev fixtures' tester (a made-up project and files). In the folder
*90_night_9 pictures* beside this file, with your own two pictures
(`her-cards-1-and-2-paired-2026-10-31.webp`, and the beta's card 1 you sent
with your later words, `her-card1-gap-to-right-2026-10-31.webp`):

- `po-dg6-before-01-open-…` and `po-dg6-after-01-open-…` — D.O.G. as it
  opens, no project.
- `po-dg6-before-02-project-…` and `po-dg6-after-02-project-…` — *Salt
  Hours* chosen, six references listed (three items, two files, a note).
- `po-dg6-before-03-single-page-…` and `po-dg6-after-03-single-page-…` —
  the same, with Generate outline switched to Single page (where Generate
  is below the window, the picture shows card 2 at the top of the window).
- `po-dg6-before-04-folded-…` and `po-dg6-after-04-folded-…` — both cards
  folded.

"Before" is the layout of night 8 (side by side from about 1,414 px);
"after" is what is built now, retaken at every size after your later words.

### How it was checked

FOLLOW-UP-CHECKS

### Questions

- **Q1. Card 1 in two columns on a wide window.** (a) As first built. (b)
  One column at every size. **Answered 2026-10-31: (b), "One column always";
  built, and then reshaped by your later words (the top of this section).**
- **Q2. Generate outline's box and button on a wide window.** (a) As wide as
  the card. (b) One column's width. (c) Card 2 in two columns. **Answered
  2026-10-31: (a), "Full card width"; built: they run the card's full width
  at every size.**
- **On a very wide screen, a section holding only one button** (asked in
  the session). **Answered 2026-10-31: "Keep it".**

No question is open.
