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

*This section is written by session F4 when its work is done.*

## F7 — The database does less work per row

Nothing new appears on the screen. Underneath, the database stops repeating the same question for every row it looks
at, and a few reads that went through a whole table now go straight to what they need. Every answer is the same as
before: who may see what, who may change what, how much storage a company is using, and which stored file may be
cleaned up.

**What changed, in plain words.**

1. *"Is this person still a member of the company?"* Nearly every rule that decides who sees a row asked this once
   for every row. Now it is asked once per request. That is 186 of the 189 rules that ask it. Three keep asking per
   row on purpose: one names no company at all, and two belong to the members list itself, where asking once would
   make the database refuse to save any change to a member.
2. *How much storage a company is using* (checked on every upload). The count used to look at every stored file of
   every company. Now it looks under the company's own projects through the storage index. Files whose project id is
   spelled unusually (capital letters, braces, missing dashes) are still counted, so nobody can slip past the limit
   that way.
3. *Storage clean-up* (the admin's "clean up storage" button). Before deleting a leftover file, it checks that no
   file record still points at it. It used to check once per file. Now it checks in groups, still asking about every
   kind of storage, then acts on each group before checking the next. Round 1's reviewers found a way one strangely
   named file could have hidden its neighbours from that check. That was fixed and tested before anything reached
   your test copy.
4. *The AI file list* (the Admin Terminal's "The AI's file store" card, and the operator's view). Its reads of the
   event log now have indexes of their own, and a clean-up now lists the store once instead of twice.
5. Six duplicate indexes that a wider index already covered are gone.

**How it was checked.**

- The change to the 186 rules checks itself as it runs. It compares every rule's text with its text a moment before,
  and refuses if anything differs but the one substitution. It also refuses if any rule would loop back on itself.
  Four reviewers re-read all 186 rules by their own methods, and nine reviewers in all attacked the work.
- On your test copy (wilson-dev), before and after:

  | What | Before | After |
  |---|---|---|
  | Updating 42 tasks: membership questions | about 140 | one per part of the request |
  | The storage meter, one company | 26.7 ms, every file of every company read | 2.8 ms, its own projects' files |
  | The AI list's main read | 44 ms on average (13.9 ms in the plan) | 0.6 ms in the plan |
  | The AI list's certificate read | 29.9 ms | 1.8 ms |

  The test copy is small (126 stored files, 4 companies), so some of the gain shows only as the shape of the plan.
- The storage meter gives the same number as before for every company. The change compares the old and new counts
  itself, and the tests plant every unusual spelling.
- The test suite ran on a fresh database in CI, and the whole set ran again on your test copy after the change.

**Nothing for you to do here.** One decision is yours, and nothing waits on it. The storage meter still glances at
every company's unusually spelled files. An index on Supabase's own storage tables would make it look only at the
company's own. It is cheap today; the hand-off says what would make it worth asking again.

## F8 — The server's shared code, in one place

*This section is written by session F8 when its work is done.*
