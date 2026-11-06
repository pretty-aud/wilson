# 94 — D.O.G.'s card 1: References and Uploads side by side, and the limit bar

One session, **DG7**, in two sections: the layout, then the limit bar. Answer
the questions by their numbers. Nothing here needs a sign-in; every picture is
the dev fixtures' made-up project (*Salt Hours*).

## The layout

Your ask of 2026-11-05: *"lets have references and the uploads be side by side
in the card. this makes the card shorter and fills in the negative space a bit.
when doing this, the uploads and references selected/uploaded files should show
up on the list together showing what its reading."*

**What changed.**

1. **References and Uploads sit side by side**, under Project. Each column has
   its title and its own buttons. They share the row equally, up to the same
   576 px width your text lines keep, and on a window under about 1,148 px they
   stack, one under the other, as they did.
2. **One list under both**, across the card: every chosen reference (items,
   then files, then notes), then every upload, as tiles that pack together, two
   across on a laptop, three on a 1920 monitor, five on your 2560 screen.
3. **The small labels Items (3), Files (2) and Notes (1) are gone.** This is a
   change you will see: the glyph and the words on each tile say what it is. A
   screen reader still hears it: an item says its kind in its words, and a file,
   a note and an upload say it in a hidden word before the name.
4. **The list, the line *What goes to the AI…* and the bar are one section with
   a title, *The deck reads*.** The section is always there, so nothing appears
   from nowhere when the first tile arrives. The words are my suggestion: Q1.
5. **Add references and Choose file sit on one line**, whether a project is
   chosen or not. To do that with no new sentence, each section's sentences moved
   under its buttons, keeping their words: *Source material for generating slide
   content (max 20 files)* is under Choose file now, and *Choose a project to
   reference its items and files…* under Add references. Two exceptions: the
   line *N references removed. Undo Dismiss*, and the line a project change leaves,
   come first while they show, so Add references sits lower (about 35 to 81 px)
   until you press Undo or Dismiss (the review found that, placed after the
   buttons, reaching Undo meant passing the Core files only box, where Enter can
   start a deck); and when the columns stack the two buttons are not side by side
   at all.
6. **The buttons in References are a little closer** (8 px apart, the same as the
   project's dropdown and New project; they were 16). At 16 *Remove all
   references* missed fitting at 1280 by 4 px and took a line of its own.
7. **Help's step 1** gives the card's new order, in the same words.

Nothing else in D.O.G. changed: card 2 and the generated output keep their size
and their left edge, and sit higher because card 1 is shorter (the slide
preview's own check passes).

**Tab now goes:** card 1's header, *Choose a project*, New project, (Undo and
Dismiss while that line shows), Add references, Core files only, Remove all
references, Choose file, then each reference's eye and ×, each upload's ×, then
card 2's header. Removing a tile from the keyboard moves to the next tile of the
same kind (a reference to a reference, an upload to an upload), else the previous
one, else that kind's own button; never to the Core files only box, and never off
the page, where the next Enter would start a deck.

### What it measured

In the browser, on the made-up project, with scrollbars showing and hidden (the
same numbers), the pages column at its usual width. "Six and two" is six
references and two uploads listed.

**Card 1's height, before → now, in px:**

| Window | Nothing chosen | A project chosen | Six and two | Folded |
|---|---|---|---|---|
| 1280 × 800 | 528 → 446 | 532 → 464 | 803 → 608 | 34 → 34 |
| 1440 × 900 | 528 → 427 | 532 → 464 | 803 → 608 | 34 → 34 |
| 1920 × 1080 | 528 → 427 | 470 → 402 | 709 → 514 | 34 → 34 |
| 2560 × 1440 | 528 → 427 | 470 → 402 | 709 → 482 | 34 → 34 |

**One place it is taller:** where the two columns stack, with little listed: 20
to 36 px more (at 760 and 860 wide, 580 → 600 and 528 → 548 with nothing chosen,
with six and two still 67 px shorter). The new title and its gap are the reason,
so *no title* in Q1 would take it back. They stack on a window under 1,148 px
(WILSON's window goes down to 1,024), or sooner if you widen the pages column: at
1280 with that column at its widest the card is 774 px and they stack.

**Generate outline's button, as D.O.G. opens and with six and two:**

| Window | Nothing chosen | Six and two |
|---|---|---|
| 1280 × 800 | 174 px below the window → 92 below | 449 below → 254 below |
| 1440 × 900 | 74 below → **on screen** | 349 below → 154 below |
| 1920 × 1080 | on screen | 75 below → **on screen** |
| 2560 × 1440 | on screen | on screen |

**The empty space to the right of Uploads, as a share of the card, nothing
chosen:** 68 → 17 percent at 1280, 72 → 21 at 1440, 80 → 44 at 1920, 86 → 60 at
2560. To the right of the two columns themselves: none at 1280 and 1440, 28
percent at 1920, 48 at 2560 (Q2).

**Each sentence's lines:** at 1280, *Choose a project to reference…* takes 2 and
the other sentences 1 each; from 1440 all take 1. (The made-up project's own
description takes 2 at every width, as it did.) **Add references, Core files only
and Remove all references stay on one line at 1280** (they need 470 px of the
column's 482; under a window of about 1,256 px Remove all takes its own line).
Nothing scrolls sideways at 760, 860, 1280, 1440, 1920, 2560 or 3440.

### What to do

On the beta after the merge, or the development copy. Resize the window, or use
your laptop and your wide monitor.

| # | Do | You should see |
|---|---|---|
| 1 | Open D.O.G. | Project; under it **References** and **Uploads (0)** side by side, Add references and Choose file on one line; then **The deck reads**, the line *What goes to the AI…* and the bar |
| 2 | Choose a project, list some references (**Add references**, tick, **Done**), upload a file | One list under both columns, references first, the upload after them, no Items or Files labels; the Uploads title, above Choose file, reads **Uploads (1)** |
| 3 | Press Tab from the top of D.O.G. | The order above: the buttons first, then the tiles |
| 4 | Tab to an upload's ×, press Enter | The next upload's ×; from the last upload in the list, the one before it; **Choose file** once no upload is left; never a reference's × |
| 5 | Press **Remove all references** with the keyboard | *N references removed. Undo Dismiss* opens the column; focus on Add references; Shift+Tab reaches Dismiss, again Undo |
| 6 | Fold card 1 | Its header bar with its count, as before |

### Pictures

In *94_dog_card_1 pictures*, beside this file, at 1280 × 800, 1440 × 900,
1920 × 1080 and 2560 × 1440:

- `po-dg7-before-01-open-…`, `po-dg7-after-01-open-…`: as D.O.G. opens.
- `po-dg7-before-02-project-…`, `po-dg7-after-02-project-…`: *Salt Hours* chosen.
- `po-dg7-before-03-six-references-two-uploads-…`, `po-dg7-after-03-…`: six and two.
- `po-dg7-before-04-folded-…`, `po-dg7-after-04-folded-…`: card 1 folded.
- `po-dg7-after-05-notice-1440x900.png`: right after Remove all references.
- `po-dg7-q1-no-title-1440x900.png` and `po-dg7-q2-columns-share-the-width-2560x1440.png`:
  your choices below, drawn on the page for the picture only.

### How it was checked

- Measured before building, and again after each change. The numbers above are
  the last run.
- D.O.G.'s tests rewritten for the new order, and new ones for what the old
  layout could not break (the last upload's × with a reference listed, a middle
  tile, the 20th upload from the keyboard). 43 deliberate breakages of the layout
  and the keyboard rules each turned a test red.
- Two reviews. The first found three things worth fixing on this card: the Undo
  line (item 5 above), a hidden word that sat outside its tile and could scroll
  the whole page out of place for a screen reader, and a long project name in that
  line running past its column. All fixed. The second found that a medium-length
  line left Dismiss alone on a line (fixed), more ways round the tests (closed),
  and several numbers in these notes (corrected).
- Recorded for you, not changed, on the project's open list: the line *What goes
  to the AI…* has its title now if you keep it; Project still shows three lines of
  words before its dropdown; References still has no sentence under its title (and
  now neither has Uploads, by design: both open with their button). A quick double
  click on Undo lands its second click on Add references, which moves up under the
  pointer when the line goes, and opens that window; Escape closes it.

### Questions

**Answered 2026-11-06, in the controller's chat, with five of these pictures:** Q1 *"Keep The deck reads (Recommended)"*; Q2 *"Keep the text width (Recommended)"*; Q3 *"Keep the lines (Recommended)"*. All three are what is built, so nothing changes.

- **Q1. The title over the list, the line and the bar.** (a) *The deck reads*
  (recommended: it says what the list is and does not open with "What" a line
  above *What goes to the AI*). (b) No title (picture: `po-dg7-q1-no-title-…`; the
  card is about 28 px shorter, the line and the bar read as part of the list). (c)
  Your own words.
- **Q2. On a very wide window, the empty space to the right of the two columns**
  (28 percent of the row at 1920, 48 at 2560: picture `po-dg7-after-03-…-2560x1440`).
  (a) The columns stay at the 576 px width of your text lines (recommended: their
  lines stay readable and the Uploads column starts where the project's
  description starts). (b) The columns share the card's width (picture:
  `po-dg7-q2-columns-share-the-width-…`; 1,122 px each at 2560, a button at the left
  of each and much more empty beside it).
- **Q3. The thin line under each tile** (pictures at 1920 and 2560: with the
  list across the card it reads as a line per tile, not one line across a section,
  which is what you had removed). (a) Keep it (recommended: it tells one tile from
  the next at a glance). (b) Remove it.

## The limit bar

Your words of 2026-11-05: *"Also I added a 110 page script of a movie and it
read it fine and the limit bar said we were more than 100% of what DOG can read.
but it was fine. this is not related to the visual update"* Asked what to do, you chose *"Fix it in the D.O.G. session
(Recommended)"*. It only ever warned; it still only warns. Nothing in WILSON cuts
or refuses a file for this number.

*Tokens* below are the AI's unit for counting what it reads, roughly a word.

**What it read for a 110-page text PDF:**

| | Before | Now |
|---|---|---|
| One PDF page counted at | 4,500 tokens | 3,000 tokens |
| The PDF | 495,000 | 330,000 |
| Measured against | 200,000 (a number picked in October) | 983,616 (the AI model's own limit) |
| The bar | *Past what D.O.G. can read for one deck…*, 248 percent | *About 34% of what D.O.G. can read for one deck (an estimate)* |

The usage log's largest decks really took 230,850 to 247,693 tokens, about 2,100
a page if they were your script, so the bar still reads a little high on purpose.

**Where the limit comes from.** The AI provider's documentation, read on
2026-11-05 and written down in WILSON's list of models with the source beside it:
Sonnet 5, the model a full deck uses, takes 1,000,000 tokens. Less the 16,384 a
full deck keeps for its answer: 983,616. If you or a company choose another model
for the full deck, the bar follows it (Haiku 4.5 takes 200,000, so 183,616); a
model WILSON has no record of keeps the old 200,000.

**Why 3,000 a page.** The provider says a page typically costs 1,500 to 3,000
tokens of text, and a picture of the page on top. Your decks measured about 2,100
all in. 3,000 is cautious for a text PDF like a script. **It can read low** for a
PDF of dense or picture-heavy pages, up to about 7,800 a page by the provider's
numbers, which is why the bar now says *an estimate* (recorded on the project's
open list).

**Its words now:**

- Under the limit: *About 34% of what D.O.G. can read for one deck (an estimate)*.
- Past it: *Past what D.O.G. can read for one deck (about 248%, an estimate):
  generating may be slow, cost more, or fail.* It used to give no number there.
  (248 is the number in the picture, where two made-up PDFs hold 810 pages together.
  It equals your script's old reading only by chance: your script now reads about 34%.)
- In card 1's header, with the card open or folded: *over the limit, about 248% (an estimate)*.

**Two smaller fixes.**

- **The page warning.** *The AI may refuse a PDF over 100* had no source and your
  script passed it. The provider's limit is 600 pages a request (100 on the smaller
  models), so it now says 600 for Sonnet 5. An upload's tile now shows the same
  warning a chosen file's tile shows (it never did). One exception: a video's
  *too large to place in a slide* stays off an upload's tile, because it is not
  true of an upload.
- **It counts what the chosen mode sends.** A page request typed for Single page no
  longer counts in Full deck, and each mode's own fixed instructions now do (about
  4,700 tokens for a full deck, about 3,400 for a page). So D.O.G. opening with
  nothing chosen is still *Less than 1%*.

### What to do

| # | Do | You should see |
|---|---|---|
| 1 | Upload your 110-page script | The bar about a third of the way, *About 34%… (an estimate)*; hover it for the tokens; no warning on the tile |
| 2 | Generate, then read that generation's row in the usage log | The real count, lower than the bar's |
| 3 | Switch to Single page and type a page request | The bar's words or its hover move; back on Full deck they do not count |

Pictures, in the same folder, at 1280 × 800 and 1440 × 900:
`po-dg7-meter-after-110-pages-…` and `po-dg7-meter-after-past-the-limit-…` (made-up
PDFs of 110 and 700 pages).

### How it was checked

Tests with 33 deliberate breakages, each red (the limit, the reserve, the page
figure, the words, the header, the page cap, the warning on an upload, the count by
mode, the figures in the list). Each model's figure was read again from the
documentation by a reviewer and a checker. No AI call was made, and neither the
server's AI function nor its list of models was touched.

**Recorded, not changed**, on the project's open list: the page cap counts a whole
request, so two 400-page PDFs warn nowhere; the 32 MB PDF warning looks out of date
too (the provider says 128 MB for a request); plain text is counted at 4 characters
a token where the provider's newer ratio is 2.5, so a very long text file can read
low; in Single page the bar still measures against the full deck's model; a deck
near the very top of the limit could stop short with no message; and a request
truly past the model's limit shows D.O.G.'s general *Error generating full deck
outline. Please try again.*, not the reason.

### Question

**Answered 2026-11-06:** first *"Keep as built (Recommended)"*; a minute later, *"sorry dont say that its an estimate and also for the buttons, lets make srue to have them be aligned on the placement with the other button"*; and of the buttons, asked which she meant, *"disregard i see buttons are aligned forget what i said"*. So the bar keeps its words but for *(an estimate)*, which goes everywhere it shows (the session DG8, brief `docs/sessions/briefs/po-dg8-limit-bar-words.md`). This page is corrected when DG8 lands.

- **Q4. The bar's new words** (above). (a) As built (recommended: today's words,
  with *(an estimate)* added and the number past the limit). (b) The word first:
  *An estimate: about 34% of what D.O.G. can read for one deck.* (c) Your own words.
