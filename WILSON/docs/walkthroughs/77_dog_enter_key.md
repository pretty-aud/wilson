# 77 — D.O.G.'S ENTER KEY: A FULL DECK NEEDS WORDS IN THE BOX, AND ENTER MOVES THE SWITCH

1. **A full deck from Enter needs words in the deck context box** (your
   answer: *"Enter needs text in the box"*). With the box empty, Enter makes
   nothing: the box gets focus and a note at the bottom of the window says
   why. **Generate full deck outline** still works with the box empty.
2. **Enter on the Single page / Full deck switch moves the switch** (your
   answer: *"Enter moves the switch"*), as Space and the arrow keys do. It
   makes nothing. D.O.G.'s tick boxes keep "Enter makes the deck", as you use
   them.
3. **The Alt key stays as it is** (your answer: *"Keep it as it is"*). Alt
   flips the switch from any page, as before. Nothing was changed.
4. **The preview tells the truth about what is recorded.** A file's preview
   says *"Reading it here is recorded in the file's activity"* only when that
   preview downloads it. A file already read while WILSON is open says so
   instead, and is not recorded again.

**What this is.** FX13 of the post-overhaul plan
(`docs/sessions/briefs/po-fx13-dog-enter-key.md`, your three answers
verbatim). Written 2026-10-26 against `feat/post-overhaul-edit-versioning`
(`po/fx13-dog-enter-key`). Single page and the regenerate box are untouched.
No database change, no server function.

## 1. Enter, before and after

With **Full deck** on, something to read (a file uploaded, or a reference
chosen) and no page yet:

| Where Enter lands | Before | Now |
|---|---|---|
| The page itself (nothing focused), the deck context box empty, or spaces only | Made a full deck | **Makes nothing.** The box gets focus, in the middle of the screen; a note at the bottom says *"Write in the deck context box first"* |
| The page itself, words in the box | Made a full deck | Makes a full deck |
| The **Single page / Full deck** switch | Made a full deck; the switch did not move | **Moves the switch** to Single page; makes nothing |
| A tick box (Use visual assets, Use project assets, Theme generator), the box empty | Made a full deck; the tick did not change | **Makes nothing**; the box gets focus and the note says why; the tick does not change |
| A tick box, words in the box | Made a full deck; the tick did not change | The same |
| Inside the deck context box, empty or spaces only | Made a full deck | **Nothing**, not even a new line |
| Inside the box, with words (even after pages exist) | Made a full deck | The same |
| Shift+Enter inside the box | A new line | The same |
| Card 3 folded, the box empty | Made a full deck behind the folded card | **Card 3 opens**, the box gets focus, the note says why |
| **Add references**, Help, D.O.G. settings | Opened its window | The same |
| Nothing to read yet | Nothing | The same |
| The **Generate full deck outline** button, the box empty | Made a full deck | The same |

With **Single page** on:

| Where Enter lands | Before | Now |
|---|---|---|
| The page itself, with a layout and a page request | Made the page | The same |
| The page itself, without them | Nothing | The same |
| The switch | Made the page; the switch did not move | **Moves the switch** to Full deck; makes nothing |
| Inside the page box, with a layout chosen | Made the page | The same |
| The page number, the layout dropdown | Their own (nothing made) | The same |

## 2. Step by step

On the development copy (port 5303, the `fx13-worktree` entry, `/dog`). Its
test data cannot reach the AI, so a deck that starts stops at once and D.O.G.
shows the red *"Error generating full deck outline. Please try again."* That
red line is how you see that Enter started one.

| # | Do | You should see |
|---|----|----------------|
| 1 | Open D.O.G.; in card 1, **Choose file** and pick any small .txt | The file listed. Card 3 on **Full deck**, the deck context box empty. |
| 2 | Click an empty part of the page (not a button, not a box), press **Enter** | No red line: nothing started. The deck context box takes its orange edge in the middle of the screen, and at the bottom: *"Write in the deck context box first. Enter makes a full deck once the box has words in it. Generate full deck outline works with the box empty."* It goes after five seconds (`po-fx13-after-01-page-empty`). |
| 3 | In the box, press **Enter**, then **Shift+Enter** | Enter: nothing. Shift+Enter: a new line. Delete it. |
| 4 | Click the **Theme generator** tick (it unticks), press **Enter** | The tick stays as you left it; the box gets focus and the note again. Tick it back. |
| 5 | Click the switch (it moves to **Single page**, as always), press **Enter** | The switch moves back to **Full deck**, and no deck starts (`po-fx13-after-04-switch-empty`). |
| 6 | Fold card 3 (its title bar), click an empty part of the page, press **Enter** | Card 3 opens with the box in focus, and the note. |
| 7 | Type a few words in the box, click an empty part of the page, press **Enter** | A deck starts: the red line (the test data cannot reach the AI). |
| 8 | Empty the box, press **Generate full deck outline** | A deck starts: the red line. The button never needed words. |
| 9 | Press and release **Alt** outside any box | The switch flips, as it always has. |

**The preview's line** needs the real cloud (the test data cannot read files):
walkthrough 75 steps 12 and 13. Preview a chosen PDF: its line ends *"Reading it
here is recorded in the file's activity, as any download is."* Preview it again:
*"Already read while WILSON is open, so showing it here is not recorded again."*
Its activity in R.A.B.B.I.T. shows one *downloaded* record.

## 3. Your answers (2026-10-26, verbatim)

| Question | Your answer |
|---|---|
| Enter at the start, the deck context box | *"Enter needs text in the box"*: with the box empty, Enter does nothing and the box gets focus; the Generate button still works. |
| Enter on the switch | *"Enter moves the switch (Recommended)"*: Enter on a focused control acts on that control, as everywhere else; Enter generates from the page, the tick boxes and the box as before. |
| The Alt key | *"Keep it as it is"*: Alt flips the switch from any page, as before. |

No questions are open.

## 4. How it was checked

- **Every place Enter can land, in Chromium**, before and after, at
  1280x800 and 1440x900 (25 places, the two sizes identical; the table above
  is that measurement). No request ever left the page: the test data stops a
  deck before it reaches the AI.
- **Tests on the real D.O.G.**, with the call to the AI replaced so none is
  made: an empty or blank box makes nothing and moves focus, with the note
  said once; words make the deck and the call carries them; the switch flips
  and makes nothing; the tick boxes, the Generate button and Single page as
  above. Each test was made to fail by putting the old code back.
- **The preview's line**: each read counted beside the line it shows.
- **Two code reviews** (section 5 when they are done).

## 5. Left as it is

- **The Alt key** hears Alt on every page, by your answer.
- **Enter in the box after pages exist** still makes a full deck when the box
  has words, as before.
- **Where Enter made nothing before** (nothing to read yet, or a deck already
  running), it still makes nothing, and the note does not show: the box was
  not what stopped it.
