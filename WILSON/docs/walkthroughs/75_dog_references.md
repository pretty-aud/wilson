# 75 — WHAT A DECK READS: REFERENCES, AND ONE SINGLE PAGE / FULL DECK CARD (D.O.G.)

1. **You choose what the deck reads.** Choosing a project no longer sends its
   files on its own: it sends the project's title and description, and a new
   card, **2 References**, lists everything else the deck will read. **Add
   references** opens a window with one search, the project's items (assets,
   scenes, shots, levels, experiences, tasks, phases, milestones), its files
   (folder by folder, as in the Files tab) and **your notes** from the
   Dashboard, with tick boxes to choose many at once.
2. **Quick ways to choose many** (your words: *"select all core files or
   files from today or a range of dates"*): **All Core files**, **Added
   today**, and a **date range**; for notes, by the date each note carries.
   A folder's tick chooses everything in it that D.O.G. can use.
3. **Names only, a preview on demand.** The card lists names, grouped Items,
   Files and Notes. The eye on any row shows exactly what is sent for it. The
   card folds away when a deck needs only your uploads and the prompt.
4. **One card for a single page and a full deck.** The switch reads *Single
   page* on one side and *Full deck* on the other. Full deck shows the deck
   context box and the theme generator; Single page shows the layout, the page
   number and the page box. *Use visual assets* (it was *Use uploaded
   assets*), *to place media in the deck*, and *Use project assets* are there
   in both. Every hint and example is as it was. Uploading is untouched.
5. **A meter, not a wall.** A bar shows how much of what D.O.G. can read for
   one deck is used; past the limit it turns amber and warns, and **Generate**
   still works.

**What this is.** DG1 of the post-overhaul plan
(`docs/sessions/briefs/po-dg1-dog-references.md`): research
(`docs/design/DOG_REFERENCES_RESEARCH.md`), your answers
(`docs/design/DOG_REFERENCES_QUESTIONS.md`, batches 1 to 4 verbatim), the
design (`docs/design/DOG_REFERENCES_DESIGN.md`) and the build. **Batches 5 and
6 (six questions) wait for you**: you asked to *"leave questions for
tomorrow"*, so the build follows the recommended pick of each, marked
*provisional* in the design. Section 4 below lists them.

Written 2026-10-16 against `feat/post-overhaul-edit-versioning` (DG1,
`po/dg1-dog-references`). No database change.

## 1. Step by step

**A. The three cards** (the development copy on port 5300, `/dog`, the test
data)

| # | Do | You should see |
|---|----|----------------|
| 1 | Open D.O.G. | Three cards: **1 Project documentation** (the project and your uploads), **2 References** (*None chosen*), **3 Generate outline**, then the output. In card 3 the switch reads **Single page** (bright) and **Full deck** (dim). |
| 2 | Choose **Salt Hours** | Its description under the dropdown, and nothing else: no attachment count, no Core / Ref chips. Card 2 reads *"What goes to the AI: your uploads, what is listed here, and the project's title and description, with what you write below."* (`po-dg1-refs-01-cards`) |

**B. The window**

| # | Do | You should see |
|---|----|----------------|
| 3 | **Add references** | *Add references, From Salt Hours, and your notes*: a search, then down the left *Items* (Assets 15, Scenes 6, Shots 16, Tasks 42, Phases 5, Milestones 3), *Files 32*, *Your notes 4*. Files open first, with **All Core files**, **Added today** and the date range above the folders (`po-dg1-refs-02-window-files`). |
| 4 | **Scenes**, tick **The storm**, then its eye | On the right, exactly what goes for it: *[Scene] The storm, Scene number: 4, Status: In progress, Type: Int ext, Time of day: Night, Dates…, Description…*, about 43 tokens (`po-dg1-refs-03-window-scene-preview`). A scene with files shows *1 file* beside it; open it to tick the file. |
| 5 | **Your notes**, tick the first | Each note with its subject and date (`po-dg1-refs-04-window-notes`). |
| 6 | Type **storm** in the search | Every kind narrows at once; files show their folder. |
| 7 | **Files**, open a folder, tick the folder's own box | Every file in it, at every depth, is chosen; the box shows part-ticked when only some are. A file D.O.G. cannot read (a Photoshop file, a Word file) is listed greyed: *D.O.G. cannot read this kind of file*. |
| 8 | **Done** | Card 2: *Items (1)* Scene · The storm; *Notes (1)*; the meter, *Less than 1% of what D.O.G. can read for one deck*; **Add references** and **Remove all** (it keeps what it removed for one **Undo**) (`po-dg1-refs-05-card-chosen`). Fold the card: its header still says how many are chosen, and warns if the meter is past the limit. |

**C. The one card**

| # | Do | You should see |
|---|----|----------------|
| 9 | Switch to **Full deck** (or click the words *Full deck*) | The deck context box with its example and *"• Include desired page count"*, the **Theme generator** box on its label line, **Generate full deck outline** (`po-dg1-refs-06-full-deck`). The two media boxes stay. |
| 10 | Back to **Single page**, choose a layout | Layout, page number and the page box, each with its hint and example, and under the page box: *"Also applied here, from Full deck: …the theme generator (on)."* (`po-dg1-refs-07-single-page`) |
| 11 | A new page: **Add references**, **All Core files**, **Done**; **Full deck**, **Generate full deck outline** | The test data refuses every file download, so: *"Nothing you chose could be read, so nothing was generated…"* and an amber line, *"Not sent: Salt_Hours_shooting_script_v4.pdf (could not be read), …"* (`po-dg1-refs-08-nothing-readable`). All Core files ticked six: the Photoshop file is greyed, *D.O.G. cannot read this kind of file*. |
| 11b | Tick a video in Files | Its card row says *placed only, not read*: a video is placed in a slide by *Use project assets*, never sent to the AI, and on its own it does not enable Generate. |

**D. On the real cloud** (wilson-dev or the beta, signed in, when you choose)

| # | Do | You should see |
|---|----|----------------|
| 12 | Choose a project with a brief PDF; **Add references**, **All Core files**, **Done**; then a scene and one of your notes; **Generate page outline** | A page built from the brief, the scene and the note. Preview the PDF first and the window says *"Sent whole, as a PDF the AI reads page by page (N pages)…"* and that the read is recorded; a PDF over 100 pages (or 32 MB) says the AI may refuse it, on its row. |
| 13 | Open the brief's file activity in R.A.B.B.I.T. | One *downloaded* record for the generation, and one for each preview of it. Choosing it recorded nothing. |
| 14 | Choose another project, then the first again | *"N references from … are set aside; they come back when you choose … again."*, then *"… are back."* Your notes stay throughout. |

**E. On the desktop app** (the Local Server)

| # | Do | You should see |
|---|----|----------------|
| 15 | **Add references** | Items and files as on the cloud; *Your notes* reads *Cloud only*, and its page says notes need the cloud. On a scene, shot, level or experience: *"On this computer a scene's own files are not listed under it; find them under Files."* |

## 2. How to check it

- The tests: `npx vitest run src/tools/deck-outline-generator_v0.514 src/components/Dashboard src/cloud/migrate/polarityRoundTrip.test.js src/tools/rabbit_v0.1.0/views/rabbitFilesRender.test.jsx`.
- The development copy: the `dg1-worktree` launch entry, port 5300;
  `node scripts/dg1-shots.mjs 5300 --out <dir> --size 1440x900 --part refs`
  walks §1 A to C and photographs them (`--part dog` and `--part notes` are
  the before pictures).

## 3. What was checked, and how

- **Two design reviews and two code reviews**, each by a separate reviewer
  reading the code; their findings and what was done are in the design's
  sections 10 and 11 and the hand-off.
- **The references hook, driven with a fake backend**
  (`references/useReferences.test.jsx`): choosing reads nothing, a preview
  reads once, a second generation reuses the read, a failed list stops the
  deck and greys nothing, a gone reference is greyed and named, the notes stay
  in the request.
- **The note reader** reads a note exactly as the Notes page does (one shared
  editor setup, `noteText.js`); a test breaks it on purpose and four tests
  fail.
- **The privacy rule** (Legal and money files never offered, trashed rows
  never offered, nothing a person may not read): tests drive every path that
  chooses many (a folder's tick, the quick choices, the index), each with a
  failing control.
- **Every hint and example** on the merged card measured before and after:
  the same words, except the renamed box, the project's hint and the new
  references line.

## 4. Waiting on you

Batches 5 and 6 in `docs/design/DOG_REFERENCES_QUESTIONS.md`, each built on
its recommended pick:

- **Q12** remembering: kept while WILSON is open, as uploads are.
- **Q19** *Use project assets*: places the pictures and videos among your
  chosen references. Your *"like before"* would place the project's own media
  without a tick, and that would send unticked pictures to the AI, which your
  Q2 rules out; this one needs your call.
- **Q20** the card names; **Q21** the switch opens on *Single page*.
- **Q22** an item's extra fields (type, dates, framing…); **Q23** whether
  *"to place media in the deck"* shows beside the box.

## 5. Known limits

- On the desktop, a scene's, shot's, level's or experience's own files are not
  linked to it (the desktop route drops those links); they are under Files.
- On the cloud, a project with more than 1,000 files lists the first 1,000
  (the Files tab does the same today).
- A PDF is counted by its pages only once it is read (an upload at once; a
  chosen file at its first preview or generation); until then the meter says
  how many it has not counted.
