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

*This section is written by session F7 when its work is done.*

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
  can no longer drift apart. The rest, the storage clean-up's own bucket
  copy and the AI files program's second "who is asking?" check, sits in
  programs another session was changing at the same time; it moves onto the
  shared copy at the next merge.
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
