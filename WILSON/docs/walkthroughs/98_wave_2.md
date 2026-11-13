# 98 — WAVE 2 (after M.O.T.H., from 2026-11-13)

One file for the wave (`docs/sessions/PLAN_WEEK_2026-11-04.md`;
`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **F4**
(the app re-draws less of itself), **F7** (the database does less work per
row) and **F8** (the server's shared code in one place). None of the three
sets out to put anything new on the screen: each section says in plain
words what changed underneath, how it was measured before and after, and
what was checked. Each section stands on its own; answer its questions, if
it has any, by their numbers.

## F4 — The app re-draws less of itself

Every time something small happened, the app used to draw every page again,
the hidden ones too: the pet blinking or getting a little hungrier, a letter
typed to the pet, R.A.B.B.I.T. being told again who else has the project
open. Now only the part that changed is drawn again. Nothing new is on the
screen and nothing you do has changed: this section says what was measured
before and after, and gives five short checks if you want to see for
yourself that everything still behaves.

**What was measured.** In the app as it runs while it is being built (a
development build, on the pretend company, every page visited once), with
React's own timer. A development build draws everything twice on purpose,
so these times are larger than in the app you install: they compare with
each other, not with it.

| What happened | Before | After |
|---|---|---|
| A minute of the pet sitting there | 2.1 to 2.9 s of drawing (32,000 to 44,000 pieces of the screen) | 0.04 to 0.05 s (about 90 pieces: the pet) |
| Ten letters typed to the pet | 0.7 to 0.9 s | about 0.05 s |
| R.A.B.B.I.T. told again who else has the project open | 2,400 pieces, 24 to 29 ms | 2 pieces, about 1 ms |
| R.A.B.B.I.T.'s live-updates light changing | 2,400 pieces, 140 to 166 ms | 4 pieces, about 1 ms |
| Ten letters in D.O.G.'s deck context box, a slide in the preview | the preview drawn 10 times, its picture frames built 10 times | the preview not drawn at all |
| D.O.G.'s *Resolve duplicate* preview, the mouse over an option | drawn 2,009 times in 3 seconds; the console said "Maximum update depth exceeded" 38 times | drawn twice; nothing said |
| The Assets tab's warnings (an asset marked approved while one of its tasks is not done) | each row searched every task | one pass for the whole table: on a made-up project of 400 assets and 2,000 tasks, 18 ms down to 0.4 ms |

The duplicate-page preview is the one that froze for a moment and filled the
console (it was on the open-items list as P1-16). That is closed.

**Five checks, if you want them** (any build; a minute each):

1. **The pet.** Chat with it; let it fall asleep and watch the Z's and the
   dream cloud; come back and see it jump. Open Settings: its card shows the
   same name, stats and mode as before. While it is awake, type a question to
   it: the letters stay where you typed them.
2. **R.A.B.B.I.T.'s undo.** Delete an asset, then press *Undo* on the toast at
   the bottom: the asset comes back. Hold the mouse over the toast: its
   countdown stops, as before.
3. **D.O.G.'s preview.** Open a slide in the preview, then type in the deck
   context box beside it: the box keeps every letter and the cursor stays
   there. Change the theme with the arrows: the slide's colours change. A
   picture placed on a slide stays on it.
4. **O.T.T.E.R.** Open a lesson and mark it complete; open Functions and
   search for something; open Hotkeys and Nodes: each shows and finds as
   before.
5. **D.O.G.'s export.** With two pages of the same number, choose Export and
   download the outline: *Resolve duplicate* opens. Move the mouse over each
   option: no freeze.

**What is left, written down for later** (one small item is new with this
session; none of it is fixed here):

- R.A.B.B.I.T. still keeps the open project in one big store. Any change to
  the project, yours or a colleague's, draws again every part of the app that
  reads it: with the Assets tab open, about 2,200 pieces and 120 ms in a
  development build. The Bins tab's check of the file servers, once a
  minute, does the same with nothing changed. Splitting that store is a job
  of its own.
- D.O.G. draws its whole page again for each letter typed in its own boxes,
  about 33 ms a letter in a development build, as before. Only its slide
  preview stopped joining in.
- The new one: D.O.G.'s Prompts tab can show an AI model as it was before
  your settings finished loading, until D.O.G. draws again for another
  reason.
- Found on the way: in the pet's agent mode the *Send* button sends nothing
  (Enter does); the agent's own conversation is not cleared when the person
  at the computer changes (read in the code, not yet tried); when a second
  person signs in over the first without signing out, Settings' AI models
  keep showing the first person's choices until *Refresh*; and two of the
  pets' pictures make React complain in the console about repeated pieces.

**What the review fixed.** The review read every change, and found two
security problems on one rare path: a second person signing in over the
first without a sign-out between (a second tab can do that). The first
person's pet could be saved into the second person's account, and the first
person's chat with the pet stayed on screen for the second, and was sent on
as theirs. Both are fixed, and a test holds each. It also found five things
this session had made slightly worse, which you had fixed rather than written
down: a slide's video frame showing the previous video's picture; Settings'
Models tab saying "Loading your settings…" after it had loaded; a rare kind
of link in a lesson showing as plain text; the Admin terminal's "5m ago"
standing still while you stay on the page; and some of the session's own
tests missing what they were meant to catch.

A second review looked again. It found the security fix incomplete: a pet
save waiting in line behind another could still land in the second person's
account, and the first person's chat could still reach the second person in
three other ways (an answer from the pet still on its way; a pet that had
not finished loading; the hatch dialog, with the name typed into it). All
are fixed, each with a test. The pet's saves and reads, and your settings',
now also say whose they are, so the database itself refuses one sent under
the wrong account. It also found two of the five fixes half done: Settings'
Models tab could say "You have not overridden anything" when you had, and an
open lesson was read again at every change of page. Both are finished.

No questions for you in this section.

## F7 — The database does less work per row

*This section is written by session F7 when its work is done.*

## F8 — The server's shared code, in one place

*This section is written by session F8 when its work is done.*
