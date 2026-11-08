# 96 — M.O.T.H. SESSION 3

Notes can now be shared, tags have types and can be your own or the company's, and things can be linked to each other
as you write. This file says what is there, how to see it, what it does not do yet, and what was checked. Nothing new
waits on you, under **Questions**.

None of this is on staging or production. The database changes are on your test database, and the code is on its own
branch until it is merged into the integration branch.

## What you see now

- **Notes for more than one person.** A note in the Dashboard is yours alone at first. Set it to *Shared with the
  company* and every member reads it. An admin can make a note the company standard, which only admins change. A note
  you may not change opens to read, and says why.
- **The trash.** Deleting a note puts it in the trash for 30 days, with **Undo** straight away and **Bring back** from
  the *Trash* list. Only an admin puts the company standard in the trash.
- **Changes come together when saved.** Two people writing in one note each keep their words; they come together when
  each of you saves. You do not see each other type: that is planned for later, and the note says so above its words.
- **Typed tags.** A tag now has a type, such as *Character* or *Location*, with its own shape and colour. The tags you
  make are yours alone: no one else sees them or where you used them, not even an admin. Type `#` and a tag's name in a
  note, or in a task's, asset's, scene's or shot's description, to tag it; the tag goes on the thing and leaves nothing
  in the words. If you make a tag the company already has, M.O.T.H. says so and offers the company's.
- **Putting a tag forward.** A tag of your own can be put forward to the company. An admin approves it (it becomes the
  company's, and everyone's own use of theirs stays theirs) or turns it down. Managers put forward but do not decide.
  Admins rename, merge and retire the company's tags, and every use follows.
- **Links.** Type `[[` and part of a name in the same places to link something you can see: pick it from the list and
  its name goes in as a link. The thing you linked lists it under *Mentioned in*; a thing's own links are under
  *Links*, with their words. Links drawn by hand in M.O.T.H. are kept now too.
- **What others see of your links.** Someone who cannot see where a link leads sees its words as plain words, with
  nothing to say a link was there. A note that links things in two projects shows each reader only the links they may
  see. Invoices and Legal files never take part, for anyone.
- **In M.O.T.H.** Notes and typed tags are dots, saved links are lines, and a note's dot opens it in the Dashboard. The
  *Typed tags* drawer makes tags and types, puts tags forward, and, for an admin, approves, renames, merges and retires.
- **Looking back.** The time slider now also rewinds notes, typed tags, their uses and links, from the day their record
  began, and says so when you look back further.
- **D.O.G.** reads a note's or a thing's words as their reader sees them: a link's hidden code never reaches a deck.

## What to do

1. **See it with no server and no risk.** In a dev build with the pretend company on, add `?fixtures=tags` to the
   address: *Salt Hours* with typed tags, links and Theo's shared note *Look of the film*. In a second window add
   `?fixtures=tags&as=theo` to see the same company as Theo, the director. Each window keeps its own pretend company, so
   what one of you types does not reach the other; what each sees of the same starting company is the check.
2. **Try it on your test database with two accounts**, when you can: one admin and one member, in two browsers. The
   release checklist's new section *§V. Typed tags, links and notes* walks it in about 25 minutes. This session did not
   sign in to your test database as anyone; the same rules were checked there by its database tests, as each person.

## Worth knowing

- **Editing shows the link's code.** While you edit a description or notes in a box, a link shows as its code, for
  example `[[Lookbook|m:…]]`; when you are done it shows as the name again. In a table's cell it is the same.
- **A new task or asset** takes `[[` in its description but not `#`: there is nothing to tag until it is made.
- **Before the record began** for notes, typed tags and links, looking back shows them as they were on that day.

## Not built yet

- M.O.T.H. does not yet keep where you put a note's or a typed tag's dot.
- Looking back to before a note went to the trash brings back its dot but not its links or tag lines.
- Seeing each other type in a note, live, is planned after the release.

## What was checked

- **Tests:** every new part has its own tests. The whole suite was run again on the final code: 486 test files, 12,397
  tests passed; the one that failed under load (a test of the office-server walk, which reaches a small local server)
  passed when run alone.
- **The database changes** (six of them: one for Session 2's leftovers, three for notes, tags and links, two for their
  record) were each reviewed by 16 to 30 agents and then by one more, rehearsed on your test database and undone, run
  under every database test, and checked with planted mistakes on a throwaway test server: 198 planted in all; 136 were
  caught by a test, 49 refused by a rule, and each of the 13 not caught is held by another rule, named in the design
  document. Then they were put on your test database on 2026-11-08 (UTC): the first at 01:24, the notes, tags and links at
  03:38 to 03:39, and their record at 05:39 to 05:40. Every database test passed again there, but two older ones about
  sign-in records that were already red on your test database before this session (6,942 of 6,944).
- **The two-person check**, with the pretend company's Mara (an admin) and Theo (a manager) in two browser windows: Mara's
  own tag is not in Theo's window at all, and her link to her sketch is plain words for him. That check found one fault
  first: a note drew every link alike, so Theo saw the sketch's words drawn as a link. It was fixed and checked again.

## Pictures

In the folder *96_moth_session_3 pictures* beside this file, all from the pretend company:

- **1 a shared note, as Mara.jpg:** Theo's shared note, its two links drawn as links for Mara.
- **2 the same note, as Theo.jpg:** the same note for Theo: *Mara* is a link, *the lantern sketch* is plain words.
- **3 typed tags, as Mara.jpg:** the *Typed tags* drawer: Mara's own tag and the company's.
- **4 typed tags, as Theo.jpg:** the same drawer for Theo: no tag of Mara's at all.
- **5 a tag the company already has.jpg:** making *lead*: the company has *Lead*, and the drawer says so.
- **6 a tag of her own, put forward.jpg** and **7 approved, the company now has it.jpg:** putting a tag forward, and an
  admin approving it.
- **8 renaming a company tag.jpg:** an admin renaming the company's tag.
- **9 a note put in the trash, with Undo.jpg** and **10 the trash, and Bring back.jpg:** the trash.
- **11 the character Mara, as Mara.jpg** and **12 the character Mara, as Theo.jpg:** an asset's window: its tags (Mara's
  own *Lantern* only in hers), its links and where it is mentioned.
- **13 a link being written.jpg:** `[[look` in a task's description, and the list of what it can link.

## Your acceptance list

From the plan's Session 3:

1. **A personal typed tag is undiscoverable by a second account.** Pictures 3, 4, 11 and 12; the database tests, as each
   person, for tags, their uses, positions, nominations and their record.
2. **A duplicate warning and a nudge to the company's tag.** Picture 5.
3. **Put forward, approved by an admin, renamed, merged; every visible use follows.** Pictures 6, 7 and 8.
4. **`#` and `[[` in notes and R.A.B.B.I.T.'s descriptions; links and *Mentioned in* both ways.** Pictures 11 and 13.
5. **A hidden destination is plain words with no hint.** Pictures 1 and 2.
6. **A shared note bridges two projects; each reader sees only what they may.** Pictures 1 and 2 (Salt Hours and Mara's
   personal space).
7. **A note's trash, Undo and Bring back; D.O.G. reads a note's words; the merge-on-save described plainly; no promise of
   live typing.** Pictures 9 and 10; the words above each note.

## Questions

None new. Your saved local test project is still Session 2's question, in its own chat.
