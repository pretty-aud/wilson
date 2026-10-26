# 78 — D.O.G.'S CARD TITLE BARS BY KEYBOARD, AND NOTES THAT WAIT FOR YOU

1. **D.O.G.'s three card title bars fold from the keyboard.** Each bar
   (*1 Project documentation*, *2 References*, *3 Generate outline*) now has
   its chevron as a small button at its right end. Tab reaches it, and Enter
   or Space folds or opens the card. A screen reader names it by the card's
   title and says whether the card is open. Enter on it never makes a deck.
   Clicking anywhere on the bar still folds the card, as before.
2. **A note at the bottom of the window waits while you are on it.** A note
   that goes by itself now waits while keyboard focus is on it, as it already
   did while the pointer is over it. Tab away and it finishes its time.
3. **When a note goes, focus goes back to where you were.** Before, focus fell
   to the top of the window. Now it goes back to what you were on before you
   reached the note. If that is gone, it goes to the page's main area.
4. **Two tests that failed now and then on GitHub are fixed, with their cause
   found.** Nothing you use changed with them.

**What this is.** FX14 of the post-overhaul plan
(`docs/sessions/briefs/po-fx14-fx13-leftovers.md`, your choice of
2026-10-26). Written 2026-10-26 against `feat/post-overhaul-edit-versioning`
(`po/fx14-fx13-leftovers`). No database change, no server function.

## 1. Step by step

On the development copy (port 5304, the `fx14-worktree` entry). Its test data
refuses some changes and says so in a note at the bottom for six seconds;
steps 6 to 11 use that note.

| # | Do | You should see |
|---|----|----------------|
| 1 | Open D.O.G. Click an empty part of the page, then press **Tab** until the orange ring reaches the chevron at the right end of **1 Project documentation** (it comes after the top bar's buttons and D.O.G.'s Help and Settings) | The ring on the chevron (`po-fx14-after-02-header-focus`). A screen reader says the card's title in the bar's capitals, *"PROJECT DOCUMENTATION, button, expanded"*, as it says the deck context box's label (walkthrough 77). |
| 2 | Press **Enter** | Card 1 folds, its chevron points right and the ring stays on it (`po-fx14-after-03-card1-folded-by-key`). Nothing else happens. |
| 3 | Press **Space** | Card 1 opens again. |
| 4 | Tab on: **References** has its chevron after the project controls, **Generate outline** after Add references. Fold and open each with Enter or Space, once with the deck context box empty and once with words in it | Each folds and opens. No deck starts. |
| 5 | Click anywhere on a title bar | The card folds, as it always has. |
| 6 | Open **Team members**. On the last row (Theo Lindqvist) press **Deactivate**, then **Deactivate** in the window | The test data refuses it: a note at the bottom, *"Dev fixtures: Changing a member's access is not available on fixture data."* The ring is back on Theo's Deactivate button. Nothing changed. |
| 7 | Press **Tab** once | The ring is on the note's ×. |
| 8 | Wait ten seconds | The note stays. Before, it went after six seconds and took the ring with it. |
| 9 | Press **Enter** | The note closes and the ring is back on Theo's Deactivate button. Before, focus was nowhere and the next Tab began at the top of the window. |
| 10 | Do step 6 again, Tab to the ×, then press **Shift+Tab** | The ring goes back to Deactivate, and the note goes about six seconds later. |
| 11 | Do step 6 again and rest the pointer on the note | It stays while the pointer is on it and goes once the pointer leaves, as before. Its × closes it, as before. |
| 12 | In D.O.G., **Choose file** and pick any small .txt. Click an empty part of the page and press **Enter** | D.O.G.'s note *"Write in the deck context box first"* (walkthrough 77). |
| 13 | Press **Tab** twice (Generate full deck outline, then the note's ×), then press **Alt** | The switch moves to Single page and the note goes, since it is no longer true. The Generate full deck outline button has gone too, so focus goes to D.O.G.'s main area, not the top of the window: the orange focus ring goes round that whole column (`po-fx14-after-04-note-gone-main-ring`). |

## 2. Your answer (2026-10-26, verbatim)

| Question | Your answer |
|---|---|
| The next session | *"FX14: FX13's leftovers (Recommended)"*: one small session for D.O.G.'s card title bars by keyboard, the kit note holding while keyboard focus is in it, and the two flaky tests. No migration. |

No questions are open.

## 3. How it was checked

- **In Chromium, before and after**, at 1280x800 and 1440x900, the two sizes
  the same. A Tab walk of D.O.G.'s page went from 25 stops to 28, the three
  new ones being the chevrons. Enter and Space on each chevron, with the deck
  context box empty and with words, made no deck and sent nothing. FX13's
  Enter rule is unchanged: with card 3 folded and the box empty, Enter opens
  it and puts focus in the box. A six-second note was reached by Tab, held,
  closed from the keyboard and taken down by its owner, and the pointer still
  holds it and closes it as before. No request left the page.
- **Tests** on the real D.O.G. and on the kit note. Each was made to fail by
  putting the old code back or by breaking the new code on purpose.
- **The two flaky tests**: their cause was found and reproduced before
  anything changed, and it is one cause. With the test data, a project loads
  in one go, and WILSON's R.A.B.B.I.T. finishes setting itself up a moment
  later. Both tests could carry on in that moment. One then saw the table
  instead of *"Loading views"*. The other had its grouping thrown away by that
  setting-up, so the group it was waiting for never came. FX13's guess, a
  longer wait, would not have fixed the second. Both tests now wait for the
  setting-up to finish.
- **Two code reviews**, each by a separate reviewer driving Chromium. The
  first found that focus given back while WILSON was still taking the note
  away did not register, so a second note that focus went back to still ran
  out its time. Focus is now given back a moment later, and it registers. It
  also found that closing a note with the mouse moved focus and could scroll
  the page; now only a note reached with the keyboard gives focus back. It
  found the capitals a screen reader hears (now in step 1) and that D.O.G.'s
  Project dropdown has no name (written down, FX14-04). The second checked
  those fixes and found the ring round the main column in step 13 (now said,
  with a picture) and a case with no test (added).

## 4. Left as it is

- **Escape does not close a note**, as before. It was not part of this
  session.
- **On pages with no main area** (R.A.B.B.I.T., Home, Settings and most
  others), a note that goes after the thing you came from is gone still leaves
  focus at the top of the window. This is written down to fix
  (`docs/OUTSTANDING.md`, FX14-03).
- **D.O.G.'s settings window has folding sections** that are buttons already,
  but they do not say whether they are open. This is written down to fix
  (FX14-02).
- **The chevron is a little smaller and brighter than before**, because it is
  now the kit's small icon button. The ring sits around it.
- **Closing a note with the pointer** leaves focus where it was, as before,
  when it was the pointer that put focus on the note. A note you reached with
  Tab gives focus back however you close it.
- **The orange ring round D.O.G.'s main column** (step 13) is the kit's
  focus ring, showing where focus went. Whether that area should wear it is
  yours to say; nothing was changed for it.
- **Alt on a chevron** flips the Single page / Full deck switch, as Alt does
  on every D.O.G. button, by your answer *"Keep it as it is"*.
