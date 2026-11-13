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

Nothing new appears on the screen. Underneath, the database stops repeating the same question for every row it looks
at, the storage meter no longer does a slow step for every stored file, and the AI file list's reads of the event log
have shortcuts of their own. Every answer is the same as before: who may see what, who may change what, how much
storage a company is using, and which stored file may be cleaned up.

**What changed, in plain words.**

1. *"Is this person still a member of the company?"* Nearly every rule that decides who sees a row asked this once
   for every row. Now it is asked once per request. That is 186 of the 189 rules that ask it. Three keep asking per
   row on purpose: one, for the sign-in log, may name any company or none, and two belong to the members list itself,
   where asking once would make the database refuse to save any change to a member.
2. *How much storage a company is using* (checked on every upload). The count used to do a slow step for every stored
   file of every company. That step is gone. It still reads through every company's files once, to find any whose
   project id is spelled unusually (capital letters, braces, missing dashes), so nobody can slip past the limit that
   way. On a store much bigger than your test copy, the database can also go straight to the company's own projects
   for the rest of the count; your test copy is too small for it to bother.
3. *Storage clean-up* (the admin's "Run storage cleanup" button). Before deleting a leftover file, it checks that no
   file record still points at it. It used to check once per file. Now it checks in groups of 50, still asking about
   every kind of storage, then acts on each group before checking the next: for a full batch of 500, 20 to 40 checks
   instead of 500. Round 1's reviewers found a way one strangely named file could have hidden its neighbours from that
   check. That was fixed and tested before anything reached your test copy. Round 2's reviewers found that the older
   part of the clean-up, which looks for stored files that no record lists, could have deleted files still in use if
   the server were ever set to answer fewer rows at a time than it does now. It now asks page by page, like the new
   check.
4. *The AI file list* (the Admin Terminal's "The AI's file store" card, and the operator's view). Its reads of the
   event log now have indexes of their own, and a clean-up now lists the store once instead of twice. The count it
   shows after a clean-up is what the clean-up started with, less what it removed: it can show a few too many, never
   too few, and the next refresh corrects it.
5. Six duplicate indexes that a wider index already covered are gone.

**How it was checked.**

- The change to the 186 rules checks itself as it runs. It compares every rule's text with its text a moment before,
  and refuses if anything differs but the one substitution. It also refuses if any rule would loop back on itself.
  Four reviewers re-read all 186 rules by their own methods, and nine reviewers in all attacked the work. Once it was
  on your test copy, five more reviewers attacked it again. They found no security problem; what they found is fixed
  or written down.
- On your test copy (wilson-dev), before and after:

  | What | Before | After |
  |---|---|---|
  | Updating 42 tasks: membership questions | about 140 | 5, each asked once |
  | The storage meter, one company | 26.7 ms | 2.8 ms: the slow step per file is gone |
  | The AI list's main read | 8.9 ms | 5.1 ms for a connection's first five times, then 8.6 ms |
  | The AI list's certificate read | 6.0 ms | 5.7 ms |
  | A clean-up of the AI file store: listings of the store | 2 | 1 |

  The two AI rows were timed the same way on a quiet test server, the old way by taking the new shortcuts away inside
  a test that was then undone. At your test copy's size the shortcuts save about 4 thousandths of a second on a
  connection's first five reads and nothing after: from its sixth time the database answers that read in a
  general-purpose way that cannot use them (question 3 below). They are for a much bigger event log. An earlier
  figure of 44 ms for the old read was an average taken while GitHub's checks were loading the test server, so it
  overstated the gain. The test copy is small (126 stored files, 4 companies, about 14,300 log entries), so these
  times are small either way; what the rows show is which slow steps are gone.
- For about twenty minutes after the change (13 November, 04:30 to 04:50 UTC) the AI list's real reads on your test
  copy averaged over a second each. When it was checked, nothing was running and nothing was held up, and the slowest
  way the database can answer that read takes 7 ms, so it reads as the small test server being slow for a while.
  Measured again: during GitHub's next checks (04:50 to 05:04 UTC) the same read averaged 51 ms, and on a quiet server
  just after, 8.6 ms. The real reads' times follow how busy the test server is.
- The storage meter gives the same number as before for every company. The change compares the old and new counts
  itself, and the tests plant every unusual spelling, each with the exact wrong total a broken count would give.
- The database tests ran on a fresh database in GitHub's checks, and the whole set ran again on your test copy after
  the change (the new test file needed a one-line fix to run there; then it passed, 60 of 60).

**Nothing for you to do here.** Three decisions are yours, and none of them waits. Answer them by their numbers when
you choose.

1. *The storage meter and unusual spellings.* It still reads every company's files on every upload to find the
   unusually spelled ones. An extra index on Supabase's own storage tables would let it look at far fewer. It is cheap
   today (a few thousandths of a second on your test copy). The recommendation is: not now. The hand-off says what
   would make it worth asking again.
2. *The old "Google Drive" storage type.* Nothing in WILSON creates it (your test copy has none), but the database
   does not forbid it. A rule retiring it would let the clean-up's check use its indexes, and would close a small gap:
   the older part of the clean-up does not ask about that type before deleting. Each copy of the database would be
   counted first.
3. *The AI list's main read after its fifth time.* A next database change could add one more index that the
   general-purpose answer can use, or tell the database always to answer this read with the actual values in hand.
   Either is small; the hand-off has the numbers.

## F8 — The server's shared code, in one place

**Nothing new on the screen.** WILSON's server work happens in small programs
that Supabase runs for it: signing in, the AI helper, signing addresses for a
company's own storage bucket, the file gateway's playback tickets, and the
admin and operator screens' actions. Twenty of them carried a lot of copied
code: three copies of the code that locks and unlocks stored secrets, four
copies of the code that loads a company's own bucket, the "who is asking?"
check written four ways, two copies of the code that talks to an outside
server, and fourteen places that read a request with no size limit.

**What changed underneath.**

- The secret locks, the code that talks to an outside server and the
  size-limited reading are now each written once and shared, and so are
  three of the four bucket copies and the "who is asking?" checks in the
  programs this session owns: a fix to one is a fix to all, and those copies
  can no longer drift apart. The rest sat in programs another session was
  changing at the same time. The storage clean-up's own bucket copy was
  moved onto the shared copy at this merge, after the other session's work
  came in: every answer stayed the same, checked first with tests that run
  the real programs, and it now signs its deletions with less work (three
  files took 15 signing steps, now 7). The AI files program's second "who is
  asking?" check was left as it is, on purpose. Its two checks are timed
  around the upload: it asks again once a clean-up's request has fully
  arrived, and its list asks your role again just before it answers, so
  someone whose access is taken away while their request is still on its
  way is turned down. Asking only once was tried at this merge and taken
  back for that reason.
- The server does less work per request. It used to unlock a secret's master
  key from scratch every time: ten locks and ten unlocks now take one step
  where they took twenty. A panel of 100 file previews now takes 104
  signing steps where it took 500. A video playing through the file
  gateway no longer re-opens the company's signing key every time a clip
  asks for a ticket.
- **One thing is new, on purpose:** a request far larger than anything the
  app sends is now refused ("too large"): what is past the limit is read
  and thrown away, never kept. Each limit was set from what the app really
  sends, with room to spare: the
  admin, operator and storage actions send at most about 1.6 KB and the
  limit is 16 KB; the sign-in steps send at most about 250 bytes and the
  limit is 4 KB; the AI helper's limit is 33 MB, above the AI provider's own
  32 MB ceiling, so it refuses nothing that could have worked.

**How it was checked.** Before anything moved, about 500 tests were written
that run the real server code and hold every answer it gave: each refusal's
words, their order, and who read which table. Every step was held to those
tests, and each was broken on purpose once to see a test catch it. Eight
reviewers then ran the old and the new code side by side on millions of
generated requests. They found nothing that let anyone in who was refused
before, and nothing a person could see that changed, apart from the "too
large" refusal. On the practice copy of WILSON (wilson-dev) each of the
twenty was called after the change and answered as before. One thing the
practice copy taught: a refused oversized request got no answer at all
until the server read it through, so it now reads the extra and throws it
away before saying "too large".

**Nothing to answer.** There is nothing to try on screen. If you ever paste
something enormous into a field and see "Request failed (413)", that is this
limit; friendlier words for it are recorded for a later session.
