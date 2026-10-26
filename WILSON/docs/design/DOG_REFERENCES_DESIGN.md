# D.O.G. references — the design (DG1, 2026-10-16)

Phase 3 of `docs/sessions/briefs/po-dg1-dog-references.md`. Built only on Audrey's
answers in `docs/design/DOG_REFERENCES_QUESTIONS.md` (batches 1 to 4, verbatim
there). Batch 5 was left for tomorrow at her request ("keep coding im going to
sleep. leave questions for tomorrow"); where this design needs one of its four
answers it follows the recommended pick and marks it **provisional (Qn)**, built
so that a different answer is one change. The research is
`docs/design/DOG_REFERENCES_RESEARCH.md`.

**Answered on 2026-10-17 (DG1b).** Batches 5 and 6 were put to her in chat
(her answers verbatim in the questions file). Five confirmed the provisional
picks; Q21 changed one: D.O.G. opens on *Full deck*. §1's P rows, §2.4 and §9
items 8 and 9 now say what she ruled; §13 is the record.

Written with the `laws-of-ux` and `design-direction` skills loaded. Inks and
families do not change: D.O.G.'s existing tokens and kit components only, no new
colour, no new typeface.

---

## 1. What she ruled, in one list

| # | Ruling | Her answer |
|---|---|---|
| R1 | References can be production items (assets, scenes, shots, levels, experiences), tasks, the Timeline's phases and milestones, files, and her own notes. Not Bin clips. | Q1, her brief |
| R2 | Choosing a project sets what can be chosen; it sends nothing on its own. | Q2 |
| R3 | The references view folds away (a deck from uploads and the prompt alone). | Q2 |
| R4 | Quick choices: all Core files; files from today; files from a range of dates. Files by the day added, notes by their own date. | Q2, Q18 |
| R5 | An item sends its words; its files are listed under it, ticked one by one. | Q3 |
| R6 | The card lists names only; any reference can be previewed. | Q4 |
| R7 | Any of her own notes, with or without a project. | Q5 |
| R8 | Legal and money files are never offered, for anyone. | Q6 |
| R9 | Local Server: items and files work; the Notes group says notes need the cloud. | Q7 |
| R10 | A meter; past the limit it warns and Generate still works. | Q8 |
| R11 | Its own card, between the project and uploads card and the deck card. | Q9 |
| R12 | Adding opens a window: one search, Items / Files / Notes, ticks, quick choices, Preview per row. | Q10 |
| R13 | A folder's tick chooses everything in it D.O.G. can read. | Q11 |
| R14 | In Single page, the full deck text and the theme setting still apply, and a line says so. | Q13 |
| R15 | The two media boxes do what they did before; *Use uploaded assets* reads *Use visual assets*, "to place media in the deck". | Q14, her brief |
| R16 | Core belongs to files and is set in R.A.B.B.I.T.; D.O.G.'s ticks only mark what a deck uses. Items and notes are never Core. | Q15 |
| R17 | The project's title and description always go. | Q17 |
| R18 | Full deck and Single page are one card; the switch reads *Single page* on its other side; Full deck shows the full deck box and the theme generator; Single page shows page number, layout and the single page box; the two media boxes show in both; examples and subtitles stay. | her brief |
| R19 | Uploads stay exactly as they are. | her brief |
| P12 | **Answered (Q12, 2026-10-17):** the chosen set is kept while WILSON is open, never written to the computer. | Q12, "Same as uploads" |
| P19 | **Answered (Q19, 2026-10-17):** *Use project assets* places the pictures and videos among the chosen references. Her Q14 words ("like before") could also mean the project's own media, ticked or not; that reading would send unticked pictures to the AI, which her Q2 rules out. Put to her in those words, she chose the ticked ones. | Q19, "Only the ones you tick" |
| P20 | **Answered (Q20, 2026-10-17):** the cards read *1 Project documentation*, *2 References*, *3 Generate outline*. | Q20, "Keep those names" |
| P21 | **Answered (Q21, 2026-10-17):** D.O.G. opens on *Full deck*; the side is then kept while WILSON is open (the Alt key can flip it from any page, kept by her ruling of 2026-10-26: §16). | Q21, "Full deck" |
| P22 | **Answered (Q22, 2026-10-17):** an item also sends its type, dates and production fields (§3, §9 item 8). | Q22, "Keep them" |
| P23 | **Answered (Q23, 2026-10-17):** *"to place media in the deck"* shows beside *Use visual assets*, in the hint ink. | Q23, "Shown beside the box" |

---

## 2. The screen

Top to bottom, D.O.G.'s middle column holds three input cards and the output.

```
┌ 1 PROJECT DOCUMENTATION ─────────────────────────────── ˅ ┐
│ PROJECT  The deck's project. Its title and description go │
│          with every deck; choose what else in References.  │
│ [ Salt Hours            ˅ ] [ + New project ]              │
│ ┌ A fourteen-minute short. Mara returns to the lighthouse… │
│ UPLOAD DOCUMENTS  Source material… (max 20 files)          │
│ [ ⇪ Choose file (PDF, MD, TXT, images) ]                   │
└────────────────────────────────────────────────────────────┘
┌ 2 REFERENCES                              6 chosen     ˅ ┐
│ Only what is listed here goes to the AI, with the        │
│ project's title and description.                         │
│ ITEMS (3)                                                │
│  ▣ Scene 02 · The storm                         👁  ✕    │
│  ▣ Shot · The storm › Rain on the glass         👁  ✕    │
│  ▣ Task · Glass and rain rig test               👁  ✕    │
│ FILES (2)                                                │
│  ▤ Treatment_v3.pdf                     CORE    👁  ✕    │
│  ▤ lighthouse_ref.jpg                           👁  ✕    │
│ NOTES (1)                                                │
│  ▤ Notes from the animatic review               👁  ✕    │
│ ▬▬▬▬▬▬▬░░░░░░░░░░░░░░  About 24% of what one deck reads  │
│ [ + Add references ]                                     │
└────────────────────────────────────────────────────────────┘
┌ 3 GENERATE OUTLINE ───────────────────────────────────── ˅ ┐
│  Single page ( ●○ ) Full deck                              │
│  ☐ Use visual assets  to place media in the deck           │
│  ☐ Use project assets                                      │
│  — Single page side —                                      │
│  SLIDE LAYOUT TYPE ˅      PAGE #                           │
│  PAGE REQUEST  Describe the specific content…              │
│  [ Example: I need a page listing all the main…         ]  │
│  Also applied here: your full deck context and the theme   │
│  generator (on).                                           │
│  [ ✦ Generate page outline ]                               │
└────────────────────────────────────────────────────────────┘
┌ GENERATED OUTPUT ─────────────────────────────────────────┐
```

Card 3 is drawn on its Single page side. D.O.G. opens on Full deck (her Q21,
§2.4).

**The laws that shape it** (each tied to a decision):

- **Law of Common Region and serial position.** The three cards read in the
  order the work goes: what the deck is about, what the AI reads, what you ask
  for. The references card sits between them (R11) because it is the second
  thing, not because it is new.
- **Working memory.** The card lists every chosen thing by name, grouped, with
  the meter under it, so the person never has to remember what is in the deck's
  reading list while writing the request below it.
- **Hick's law and chunking.** The window groups by kind with counts down a
  rail (Items with its eight kinds, Files, Notes) and one search across all of
  them; the card groups the chosen rows the same three ways.
- **Tesler's law.** D.O.G. does the size arithmetic and shows one bar; the
  person never sees a token count unless they hover for it.
- **Fitts's law.** *Add references* sits at the foot of the list it adds to;
  each row's Preview and Remove are at the row's end where the eye finishes the
  name, as in the task window's Items table.

### 2.1 Card 1, *Project documentation* (her name, Q20)

- **Project**: the dropdown and **New project**, as today. Its hint changes,
  because today's words would now be false: *"The deck's project. Its title and
  description go with every deck; choose what else in References."*
- **The description panel** stays (the project's description). Removed: the
  "N attachments · M core" line, "Reading project attachments…", the left-out
  note, and the **File roles · click to toggle** chips (R16: D.O.G. no longer
  writes a file's Core mark). The New project window's upload error line stays
  (it is the only place that failure is said).
- **Upload Documents**: untouched (R19). Same label, hint, button, chips, the
  20-file count, the same file kinds, in memory only.
- The **Deck Context & Guidelines** box and the four controls on its label line
  move to card 3.

### 2.2 Card 2, *References*

- **Header**: step 2, *References*, the count ("6 chosen", or "None chosen"),
  and the chevron. It folds like the other cards (R3); folded, the header still
  shows the count, so a folded card never hides that references are going.
- **The contract line** (the research's pattern 2), true as written (review
  round 1, finding 3): *"What goes to the AI: your uploads, what is listed
  here, and the project's title and description, with what you write below."*
- **The chosen rows**, grouped under *Items (n)*, *Files (n)*, *Notes (n)*, each
  row: the kind's glyph, the name, and at its end **Preview** (the eye) and
  **Remove** (×). Names only (R6). An item reads with its kind and number where
  it has one (*Scene 02 · The storm*, *Shot · The storm › Rain on the glass*,
  *Phase · Pre-production*, *Milestone · Picture lock*); a file shows **Core**
  after its name when its own mark says so (read-only, R16); a note shows its
  title.
- **A reference that can no longer be read** (deleted, moved behind the Legal
  gate, the backend switched) stays in the list, greyed, with *"No longer
  available; it will not be sent"*, until removed (the research's pattern 8). It
  is never sent.
- **The meter**: one bar and *"About 24% of what D.O.G. can read for one
  deck"* (*"Less than 1%"* below one), counting everything that will be sent
  (the project's text, the deck text, the uploads and the references). A PDF is
  counted by its pages once its body is in hand (an upload; a chosen file once
  read at Preview or Generate); until then it is not guessed, and the line adds
  *"· 2 PDFs not counted until read"*. Past 100% the bar turns amber and the
  line reads *"Past what D.O.G. can read for one deck: generating may be slow,
  cost more, or fail."*; Generate stays enabled (R10). The hover says it is an
  estimate, in tokens. A PDF over 100 pages says so on its row.
- **Add references** opens the window. With no project chosen the card says
  *"Choose a project to reference its items and files. Your notes can be
  referenced without one."* and the button still opens the window on Notes (R7).
- **Changing project** sets the old project's items and files aside, keeps the
  notes (they are not a project's), and says so in one line under the header:
  *"3 references from Salt Hours are set aside; they come back when you choose
  Salt Hours again."* Choosing it again brings them back (*"… are back."*). No
  dialog (flow), and nothing lost (review round 1, finding 17). Remove sits
  apart from Preview at the row's end.

### 2.3 The window, *Add references* (R12)

The kit's `Dialog` at `width="workbench"` (960). Title *Add references*,
subtitle *From Salt Hours, and your notes* (or *Your notes* with no project).

- **Search** across the top: *Search items, files and notes*. Typing narrows
  every group at once and shows the matching files from every folder, with
  their folder path, as the Files tab's search does.
- **The rail** (left, ~200px): *Items* and under it each kind with its count:
  assets and tasks always, every other kind only when the project holds at
  least one (D.O.G.'s project list does not carry R.A.B.B.I.T.'s *scenes on* and
  *levels on* switches, so what a project holds is the test); then *Files (n)*;
  then *Notes (n)*. A kind that
  could not be listed shows *"—"* and, when chosen, *"Could not be listed"*.
  Local Server: *Notes* shows *"Notes need the cloud"* (R9).
- **The list** (middle): one row per thing with a **tick box**, the kind glyph,
  the status dot (items), the name, and at its end **Preview**. A ticked row is
  chosen at once (the card behind updates); there is no separate confirm. An
  item that has files shows a chevron; opening it lists its files (by the file's
  own link to the item, R5), each with its own tick. Ticking the item does not
  tick its files.
- **Files** open as the Files tab does: a path above, folders first, Backspace
  goes up. A folder's tick (R13) chooses every file inside it, at every depth,
  that D.O.G. may send; it shows as part-ticked when only some are. Legal and
  money files are not in the list at all (R8), so a folder's tick cannot reach
  them.
- **Quick choices** (R4), in a strip above the files: **All Core files**
  (ticks every file whose own mark is Core), **Added today**, and **Dates**
  (from, to, then *Tick these*), by the day each file was added. On *Notes* the
  same strip offers **Today** and **Dates**, by the note's own date. Each quick
  choice only ticks; it never unticks.
- **Preview** opens a pane on the window's right (the list narrows) showing
  exactly what will be sent for that row (§4) and its size; × closes it. Previews
  are on demand only (R6).
- **The footer**: the same meter as the card, *"N chosen"*, and **Done**.
  Escape and Done both close and keep the ticks.

### 2.4 Card 3, *Generate outline* (her name, Q20; R18 exactly)

- **The switch**, first in the card: *Single page*, the switch, *Full deck*.
  Both words always show; the side that is on reads in the full ink and the
  other in the dim ink, and the knob sits on that side. The switch's own name
  is *Full deck* (`aria-label`; checked is Full deck, unchecked is Single
  page), so a screen reader hears which side is on; the two words are pointer
  shortcuts to their side, hidden from it and not in the tab order. Space and
  Enter work as on every switch and Left and Right choose a side: since FX13
  (her "Enter moves the switch", 2026-10-26) Enter on the switch moves it and
  generates nothing (until then it was D.O.G.'s generate key there: review
  round 1, finding 4; DG1b review round 2, finding 3). It opens on *Full deck*
  (her Q21, 2026-10-17), and the side is then kept while WILSON is open; the
  Alt key, which toggles it, is heard on every page, kept so by her ruling of
  2026-10-26 (§16).
- **The two media boxes**, under the switch, in both modes:
  - **Use visual assets** with *"to place media in the deck"* after it in the
    hint ink (R15): your uploaded pictures and videos, as *Use uploaded assets*
    did.
  - **Use project assets**: the project's pictures and videos among your
    chosen references (her Q19).
- **Full deck side**: **Deck Context & Guidelines** with the **Theme generator**
  box on its label line, the hint *"Set the overall tone, style, and objectives
  for the deck • Include desired page count"*, the box with its example
  *"Example: This is a pitch deck for a luxury brand activation. The tone should
  be sophisticated and aspirational..."*, and **Generate full deck outline**.
- **Single page side**: **Slide Layout Type** (hint *"Choose how content will
  be arranged on the slide"*, "Select layout...", the layout's description under
  it), **Page #** (hint *"Single number or range (e.g. 3-7)"*, example *"5 or
  1-10"*), **Page Request** (hint *"Describe the specific content you want on
  this slide"*, example *"Example: I need a page listing all the main characters
  with summaries for each..."*), then the line R14 asks for, then **Generate page
  outline**. The line: *"Also applied here: your full deck context"* followed,
  when that box has text, by its first words in quotes, *"and the theme
  generator (on)"* or *(off)*.
- The card folds like card 2 did. Nothing in it is greyed: the side that is off
  is not drawn.

---

## 3. The data read for each kind

The pool is listed when the window first opens for a project, and again each
time it opens (a cheap list, never a body). On the cloud each list is the
adapter's own read with the person's session (`listAssets`, `listTasks`,
`listScenes`, `listShots`, `listLevels`, `listExperiences`, `listPhases`,
`listMilestones`, `listFolders`, `listFiles`; `listNotes`); on the Local Server
one `loadProject` gives them all (each of its list calls would fetch the whole
bundle again). Each kind is read on its own and a failure stays in its own row.

| Kind | Listed when | Sent (its words) | Never sent |
|---|---|---|---|
| Asset | not deleted | name, type, status, start and end, description | thumbnail |
| Task | not deleted, not set aside | title, status, priority, start and end, role, description, notes; its items' names | bid and logged days (they feed the budget) |
| Scene | always | number, name, status, type, time of day, start and end, description, notes | thumbnail |
| Shot | always | number, name, its scene's number and name, status, framing, camera movement, frame count, description, notes | thumbnail |
| Level, experience | always | name, status, start and end, description, notes | thumbnail |
| Phase | not deleted, not set aside (0090) | name, start and end, description | |
| Milestone | not deleted, not set aside | title, date, its phase's name, description | |
| File | not deleted, not money, not Legal (R8) | its body, as today: text inline, PDF and pictures through the AI's file store, video never (placement only) | |
| Legacy attachment (the old arrays, Local Server) | always | its body, as today | |
| Note | yours (the database allows no other) | title, subject, date, the whole text | the preview column |

A file's **Core** mark comes from the file: `is_core_definer === true` for a
stored file, `isCore !== false` for a legacy one (today's two polarities, kept
exactly).

**A note's text** is read the way the Notes page reads it: a fresh Yjs document,
the stored state applied, an editor with the Notes page's own extensions, and
the editor's text. One module, `src/components/Dashboard/noteText.js`, owns the
extension list (`noteEditorExtensions(ydoc)`) and the reader
(`noteTextFromState(b64)`); `NotesView` imports the extension list from it, so
there is one definition, not a second way. The list's `body_preview` is never
sent.

---

## 4. What one generation sends, and the ceiling

Nothing is read until **Generate** (or a Preview). At Generate, D.O.G. reads the
chosen files' bodies through `adapter.downloadFile` (on the cloud this records a
download in each file's activity, as today, but only for files that are
actually used) and the chosen notes' text, then builds the message as today:

| Part | Change |
|---|---|
| PDFs and pictures (uploads, chosen files) | as today, through `ai-files` |
| PROJECT CONTEXT | title and description (R17); the FILE ROLES block lists the **chosen** files as CORE or REF, as today |
| DECK CONTEXT & GUIDELINES | unchanged |
| EXISTING DECK PAGES | unchanged |
| UPLOADED FILES | the uploads, the chosen files, and one more line: *Chosen references (items and notes) (text)* |
| TEXT CONTENT | as today, plus that references text under its own header |
| Placement | *Use visual assets*: the uploads' pictures and videos; *Use project assets*: those among the chosen files (P19) |

**The references text** is one block: a header saying what it is, then each
item's words (§3) as a short labelled paragraph, then each note under its title,
subject and date. It travels as one more text source through `buildSourceParts`,
so the 256 KB rule that already moves a large text to the file store applies to
it too, with no new transport.

**With nothing chosen and only uploads**, the message is byte for byte today's.
With a project chosen and nothing ticked, the AI gets the project's title and
description and nothing else from the project (R2).

**Generate needs a source**: at least one upload or one chosen reference
(today: at least one file). The project's text alone does not start a deck.

**The ceiling** (R10). Estimates, in tokens, from the AI provider's published
rules and the house's four characters to a token:

| Source | Estimate |
|---|---|
| Words (items, notes, text files, the deck text, the project text) | characters ÷ 4 |
| PDF | pages × 4,500 (1,500 to 3,000 text tokens a page plus the page as a picture), the pages read from the body's page tree, or from inside its compressed object streams; not counted, and said, until the body is in hand |
| Picture | 4,000 each (the newest models cap a picture at 4,784) |
| Video | 0 (never sent) |

The limit is **200,000**, under the 232,275 of the real deck that worked, leaving
room for the system prompt, the format and the pages already made. The bar shows
the estimate against it; past it, amber and the warning, never a block.

---

## 5. Privacy: what leaves, and what can be chosen

1. **Nothing a person may not read is listed.** On the cloud every list is the
   person's own read under the database's rules: a private project only for
   its creator and the workspace's admins (0072; its files live on the
   creator's computer, so on an admin's they cannot be read and grey at
   Generate), files without money files for anyone
   without money access, Legal files only for admins and managers (0088, 0092),
   notes only their owner's (0017: owner only, no admin bypass).
2. **Nothing a person may read is sent unless they ticked it**, except the
   project's title and description (R17), the deck text and the uploads, all of
   which they typed or chose.
3. **Legal and money files are never offered in D.O.G.**, even to those who may
   open them (R8), because a deck reaches every member of the project. The test
   is `isDeckReferenceFile`, beside today's `isDeckAttachmentRow` in
   `deckAttachments.js`, sharing `isLegalFile` and `is_financial`.
4. **A teammate's note can never appear**: the database refuses it, and D.O.G.
   reads notes only through the person's own `listNotes` and `getNote`.
5. **Nothing chosen is written to the computer** (P12): no note title, no file
   name, no id goes to browser storage. The chosen set lives in the screen's
   memory and goes when WILSON closes.
6. **A file is read at Generate or at a Preview the person asks for**, never
   at the choosing. On both backends each read, a preview's included, is
   recorded in the file's activity like any download, and the preview says so
   when it downloads (a body read once is kept while WILSON is open, and a
   preview of it says it is not recorded again: FX13, was OUTSTANDING DG1b-02)
   (a PDF is read at Preview so its pages can be counted before Generate); a picture
   over 8 MB is described, not fetched, to preview it. A note's text is read
   when it is ticked (its owner's own, recording nothing), so the meter can
   count it.
7. **At Generate the pool is listed again through the same gate**; a reference
   missing from the fresh list (deleted, trashed: a trashed file's blob still
   downloads, so the list is the test, not the download) is not sent and is
   greyed in the card. A greyed reference does not count as a source, and when
   nothing chosen can be read and nothing is uploaded, D.O.G. says so instead
   of generating from the project's text alone.
8. **The Local Server** is one person on one computer: everything in its bundle
   may be listed, except Legal and money files (the same rule), and there are no
   notes.

---

## 6. The Local Server and the other backends

| Backend | Items | Files | Notes | Generate |
|---|---|---|---|---|
| Cloud | yes | yes | yours | signed in, as today |
| Local Server (signed in for the AI) | yes, from one `loadProject`; a scene's, shot's, level's or experience's own files are not linked to it there (the route drops those links; entity file managers write the managed store), and the window says so | yes, the files table's | *"Notes need the cloud"* | as today |
| Signed out | listed if the backend can | listed if the backend can | none | refused by the AI relay, as today |
| Google Drive | each kind *"could not be listed"*: some reads refuse, the rest do not exist, and both say so (hover: *"This storage cannot list them."*) | listed | none | as today |
| A teammate's private project (a workspace admin) | listed (0072) | listed; bodies live on the creator's computer, so they grey at Generate | yours | as today |
| Dev fixtures | yes | listed; reading a body is refused, as for every fixture download | the four test notes | as today |

---

## 7. The AI calls

- Every call stays on `ai-proxy` through `callAI`; no new call is added.
- **Every reply is read with `textFromMessage`** (the brief's rule), in all
  eight of D.O.G.'s calls. `textFromMessage` returns the reply's LAST text block
  (before DG1 each call joined every text block). D.O.G.'s calls use no tools,
  so a reply holds one text block after its thinking and the read is the same
  text; a call that ever adds a server tool must revisit this (code review
  round 1, finding 2).
- The export formats (`DECKOUTLINE.md`, `VIS_DECKOUTLINE.md`, `IMG_PROMPTS.md`,
  the placed asset files) do not change.
- The theme generator never sees a reference: it reads the deck text, the page
  titles and the uploads, as before, so a deck made from references alone takes
  its colours from the deck text.

---

## 8. The build, in order

`DeckOutlineGenerator.jsx` is one 5,584-line component; the references live in
their own modules and the component changes as little as it can.

1. **`src/components/Dashboard/noteText.js`**: `noteEditorExtensions(ydoc)` and
   `noteTextFromState(b64)`; `NotesView` imports the extension list. Test (jsdom):
   a fixture-shaped state reads back its paragraphs; the source pin that
   `NotesView` uses the shared list.
2. **`references/referenceModel.js`** (pure, in D.O.G.'s folder): the kinds and
   their labels; `buildPool(lists)` (the exclusions of §3 and §5);
   `isDeckReferenceFile`; an item's files; folder ticks; the quick choices; each
   kind's words; the references text; the estimates and the meter state; the
   project-change rule. Tests for each, including the privacy exclusions with
   failing controls.
3. **`references/useReferences.js`**: the chosen set, the pool load (per backend,
   §3), Preview, and `resolveForGeneration()`, which reads the chosen bodies and
   returns D.O.G.'s own file entries (the shape `buildSourceParts`,
   placement and export already take) plus the references text.
4. **`references/ReferencesCard.jsx`** and **`references/ReferencesPicker.jsx`**,
   styles in `dog.css` (house weights 400 and 600, no unjudged 2px edge).
5. **`DeckOutlineGenerator.jsx`**: card 1 trimmed; card 2 mounted; card 3
   merged from the old card 1 tail and card 2; the auto-attachment effect and the
   Core toggle removed; `projectContext` over the chosen files; the three
   generators resolve sources first and pass the list to `buildSourceParts`;
   *Generate needs a source* counts references; placement per §4; the
   New project window's files start ticked in References (they were added here,
   for this deck); `textFromMessage` in the eight readers.
6. **Tests that follow**: `deckAttachmentSource.test.js` (the fetch-effect and
   attachment-bound pins go with the effect; the polarity, ordering and
   exclusion pins stay or move to the reference model), `dogCss.test.js`,
   `enterGenerates.test.js`.
7. **Walkthrough 75**, its pictures, `OUTSTANDING.md`, the hand-off.

---

## 9. Decisions this design makes that she has not seen (say if wrong)

1. Card 1's project hint changes, because today's words would be false (§2.1).
2. Files added in the New project window start ticked in References.
3. Changing project drops the old project's items and files from the list and
   keeps the notes, with a one-line notice, no dialog.
4. A task's bid and logged days are not sent.
5. The limit is 200,000 estimated tokens.
6. A reference that becomes unreadable stays in the list, greyed, until removed.
7. Quick choices only tick; they never untick.
8. An item sends more than the four fields her Q1 and Q3 options named (name,
   status, description, notes): also its type, dates, scene number, time of
   day, framing, camera movement, frame count, a task's priority, role and
   what it is about, a milestone's phase. Shared project data, no privacy
   change. Asked as Q22; she kept them (2026-10-17).
9. *"to place media in the deck"* is shown as the box's hint; her quote may
   have been her explanation rather than label text. Asked as Q23; she chose
   it shown beside the box (2026-10-17).
10. The cloud's file list has no paging (PostgREST's 1,000-row default, as for
    the Files tab today): past 1,000 files in one project, *All Core files*
    and a folder's tick reach only the first thousand. Stated, not fixed
    here (`docs/OUTSTANDING.md`).
11. A kind shows in the rail when the project holds at least one (FX2's
    picker's second arm); a kind switched off in R.A.B.B.I.T. but holding
    rows still shows.
12. Videos can be chosen, for placement only: their row says *placed only, not
    read*, they do not count as a source for Generate, and one over 100 MB is
    not read at all (it is named instead).
13. The window opens on Files when a project is chosen (on Your notes without
    one).
14. The single page line reads *"Also applied here, from Full deck: your
    context (“…”) and the theme generator (on; set it under Full deck)."*
15. Beside the date tools: *"N without a date are not included"*.
16. Your notes always travel in the request itself, never in the AI's file
    store; PDFs and pictures go through the AI's file store, which keeps them
    (the pre-existing transport since S19), and the contract line's hover says
    so. Deleting what the file store keeps is not part of DG1 (it is an Edge
    Function change; `OUTSTANDING.md`).
17. **Remove all**, with one **Undo** in the notice; at most 200 rows drawn per
    list, then *"type in the search to narrow"*.
18. The AI's per-file caps are said on each file's row (a PDF over 100 pages or
    32 MB, a picture over 10 MB): warnings, never blocks, as Q8.

---

## 10. Design review round 1 (2026-10-16): the findings and what was done

A Fable reviewer read this design, her verbatim answers and the code, read-only.
Nineteen findings; every one is answered in the sections above and in the build
(commit `66305319`).

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | HIGH | A PDF estimated by bytes is wrong by an order of magnitude either way | Counted by pages (page tree, or compressed object streams through the platform's DecompressionStream); not guessed before the body is in hand; said in the meter; over 100 pages flagged (§2.2, §4) |
| 2 | MEDIUM | P19 departs from "like before" | Kept provisional; the conflict with Q2 put to her first (§1, Q19); on 2026-10-17 she chose the ticked ones |
| 3 | MEDIUM | The contract line was false (uploads go too) | Rewritten to name everything that goes (§2.2) |
| 4 | MEDIUM | The two-sided switch's name and keys | Name *Full deck*, words pointer-only and hidden from a screen reader, Left/Right choose, Enter unchanged (§2.4) |
| 5 | MEDIUM | Local Server: an item's own files are not linked to it | Stated in §6 and in the window |
| 6 | MEDIUM | Adapter error text in the rail; signed-out state | One plain line when signed out; *"could not be listed"* with the storage's words on hover |
| 7 | MEDIUM/LOW | Previews download and are recorded | Said in §5.6 and in the preview; pictures over 8 MB described, not fetched |
| 8 | LOW | "The read fails" was the wrong mechanism | §5.7: the fresh, gated list is the test; nothing-readable stops generation |
| 9 | LOW | Set-aside phases | §3 row fixed (the code already filtered) |
| 10 | LOW | 0072 misstated | §5.1 and a §6 row |
| 11 | LOW | Google Drive kinds hidden in silence | A missing read says it cannot list them |
| 12 | LOW | Item fields beyond her list | §9 item 8, Q22 |
| 13 | LOW | Notes read at tick | Said in §5.6 |
| 14 | LOW | Date tools: undated files and notes | Counted beside the tools |
| 15 | LOW | No paging past 1,000 files | §9 item 10, `OUTSTANDING.md` |
| 16 | LOW | Switched-off kinds | §9 item 11 (FX2's rule) |
| 17 | LOW | Forgiveness on a project change; Remove beside Preview | Set aside and brought back; Remove apart |
| 18 | LOW | "to place media in the deck" as label or explanation | Q23 |
| 19 | LOW | The meter's unit; the theme generator | Plain words; §7 says the theme generator never sees a reference |

---

## 11. Design review round 2 and code review round 1 (2026-10-16)

Two more Fable reviewers, read-only: the second design round attacked round
1's corrections (15 findings, 4 HIGH); the first code round read the whole
product diff (7 findings, none HIGH, and the tests that could not fail).
Everything below landed in commit `ef17d94a`.

| Finding | Done |
|---|---|
| HIGH: a chosen PDF's pages could not be learned before Generate | Preview reads the PDF and counts its pages; its row then warns past 100 pages |
| HIGH: the page counter was wrong on an incremental save (1 for 120), a nested root (24 for 12) and bookmarks (300 for 12) | The root's /Count, bound to its own dictionary; the linearization hint; the compressed streams always read; page objects never the answer; the three shapes are tests |
| HIGH: nothing bounded the bytes Generate downloads | The AI's caps said per row; videos over 100 MB not read; the download size in the meter past 25 MB |
| HIGH (both reviews): a restored or adopted reference previewed as "no longer available" | Preview lists first when the screen has not |
| A failed list greyed every reference | Greyed only by a list that succeeded; a failed one stops Generate with its own sentence |
| Signed out decided from one failed list | Only when every read failed for want of a session; notes-only wording |
| A video-only choice enabled Generate | Videos do not count as a source; marked *placed only, not read* |
| A long items block (and a note in it) could reach the AI's file store | Notes travel in their own block, inline-only |
| The folded card hid the meter's warning | The header says *over the limit* or *N PDFs not counted* |
| The preview silent about the desktop's download record; Drive's wording; the switch's "off"; the meter's valuenow past 100; the notes that stay; the Q13 line's control; one-ended date ranges; Remove all; huge lists; same-named files; a .jpg with no type | All done (§9 items 12 to 18) |
| `textFromMessage` keeps the last text block | Stated in §7; kept, as the brief rules |
| Upload PDFs counted O(n²) | Each counted once |
| EmptyState `description` (never shown) | `body` |
| The folder path had no loop guard | Guarded as `folderTrail` |
| Tests that could not fail | `useReferences.test.jsx`, behavioural, with failing controls; the round-trip test asserts what it names; an order-independent Switch pin |

## 12. Code review round 2 (2026-10-16)

The second code reviewer attacked the corrections above (nine findings, none
HIGH); everything landed in commit `131bf12a`, each with a test that fails
without it.

| Finding | Done |
|---|---|
| A video-only upload stopped generating (a regression against "leave that how it was") | The stop applies only when references were chosen and nothing of them, nor any upload, is readable |
| A pool read in flight across a project change could land and grey the returning references | The read sequence moves on with the project |
| Nothing tested the notes' inline-only transport at its consumer | One pure rule, `sendsInline`, tested; the component pinned to it |
| A folders failure blocked the files | Its own error; the files list at the top level |
| `/Count 12 0 R`, zero or an absurd count read as a number | Unknown instead |
| A PDF counted twice on its first preview | Once, however many reads ask |
| "32 MB: … over 32 MB" at the boundary | Sizes round up |
| The items block could be served from the AI file-id cache | Never cached |
| The download size counted bodies already read | Leaves them out |

## 13. Her batch 5 and 6 answers (DG1b, 2026-10-17)

DG1b asked the six in chat, as multiple choice, Q19's conflict in plain words;
her answers are verbatim in `DOG_REFERENCES_QUESTIONS.md`.

| Question | Her answer | What it changes |
|---|---|---|
| Q12 remembering | "Same as uploads (Recommended)" | Nothing: the chosen set stays in memory while WILSON is open. No migration; 0099 and suite 102 stay unused. |
| Q19 what *Use project assets* places | "Only the ones you tick (Recommended)" | Nothing: the ticked pictures and videos, from anywhere in the project. One not ticked is never placed or sent. |
| Q20 the card names | "Keep those names (Recommended)" | Nothing. |
| Q21 the switch's opening side | "Full deck" | `fullDeckMode` starts `true`. |
| Q22 an item's extra fields | "Keep them (Recommended)" | Nothing: §3's table stands. |
| Q23 the box's hint | "Shown beside the box (Recommended)" | Nothing. |

**What opening on Full deck does, measured in the development copy.** A fresh
D.O.G. shows the deck context box, the theme generator and *Generate full deck
outline*; the layout, the page number and the page box are drawn when the
switch is moved to Single page. App keeps every page mounted, so the side then
stays where it is put until WILSON closes: moved to Single page, away to
R.A.B.B.I.T. through the app's own page change and back, it is still on Single
page. The exception, found while checking this and not fixed (outside her
answers): D.O.G.'s Alt toggle is heard on every page, so one Alt release on
R.A.B.B.I.T. flipped the hidden switch (OUTSTANDING DG1b-01).

One consequence, stated: with no page yet, D.O.G.'s Enter key (on its page,
outside a text field, and not on a button other than its own tick boxes and
switch: `enterGenerates.js`) generates a full deck whenever *Generate full
deck outline* is enabled, as it always did with Full deck on; before, at
opening, it also needed a layout and a page request. The deck context may be
empty, and the theme generator, ticked at open, runs with it. Enter on any
other focused button presses that button: after *Done* closes the References
window, focus is on *Add references*, and Enter reopened the window (measured;
with focus on the page, Enter started the deck). Two more Enters do the same,
as they always did with Full deck on: Enter on the switch itself generates
instead of moving it (Space and the arrow keys move it), and Enter in the deck
context box generates even after pages exist (its own handler; Shift+Enter
for a new line). Whether Enter at open should also want a deck context, and
whether Enter on the switch should move it, are hers to say (walkthrough 75
§4).

**Tests.** `enterGenerates.test.js` pins the opening side, and that nothing
sets the side on its own (every call is a click, the switch, an arrow key or
Alt), each with a control. On the real component, flipping the side back and
planting a mount-time reset each turn one test red.

**Also.** `scripts/dg1-shots.mjs` sets the switch to a side instead of toggling
it, and records the side D.O.G. opens on (`refsOpensOn`).

## 14. DG1b code review round 1 (2026-10-17)

A Fable reviewer read DG1b's two commits, her answers and the code, read-only:
eight findings, four MEDIUM, none wrong with the switch itself.

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | MEDIUM | `scripts/ui-walk.mjs` proved D.O.G.'s page by "Generate page outline", which Full deck does not draw | The proof is card 3's title, *Generate outline*, on either side |
| 2 | MEDIUM | Walkthrough 75 still said Q21 opens on Single page, and its §4 listed all six as open | §1, §2 and §4 updated in place; §6 "After your answers" written; the README row |
| 3 | MEDIUM | "The side is kept while WILSON is open" is false for Alt: D.O.G.'s Alt toggle is heard on every page (the Files tab's Alt+← ends in one) | Measured (one Alt release on R.A.B.B.I.T. flipped it); said in §1, §2.4, §13, the questions file, the code note and the walkthrough; OUTSTANDING DG1b-01; not fixed (outside her answers), hers to rule |
| 4 | MEDIUM | Enter at open now starts a full deck, and the theme call, as soon as there is a source, with an empty deck context; "exactly when its button can" overstated it | §13 says it in full (the empty context, the theme generator, Enter on a focused button presses it: after *Done* it reopened the window, measured); "exactly" gone from the note and the test; whether Enter at open should want a deck context is hers (walkthrough 75 §4) |
| 5 | LOW | Q12's "nothing is written" overstated: a chosen file's read is recorded in its activity | The questions file and the walkthrough say so |
| 6 | LOW | `dg1-shots.mjs`'s comments described a toggle that no longer happens | They say which shots share a side |
| 7 | LOW | The tests were brittle in places, and blind to a remount from App | The Alt check is bounded by its handler, not a character window; a new test that App mounts D.O.G. once with no `key`, with a control; on the real files, a planted key, a moved Alt handler, the side flipped back and a mount-time reset each turned the tests red |
| 8 | LOW | Beyond her answers: tooling only (the launch entry, `refsOpensOn`) | Nothing to do |

## 15. DG1b code review round 2 (2026-10-17)

A second Fable reviewer attacked round 1's corrections (commit `b27b20d7`),
read-only: seven findings, four MEDIUM, none in the switch itself. It found
the walk script's new proof sound.

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | MEDIUM | Walkthrough 75 step 12 (on the real cloud) still assumed D.O.G. opens on Single page: it ends on *Generate page outline*, which Full deck does not draw | The step says *Single page*, a layout and a page request first |
| 2 | MEDIUM | Step 13 promised one *downloaded* record per preview and per generation; `readBody` keeps each body for the session, so a preview's read is used again at Generate and one record is left; the preview's "Reading it here is recorded" line shows on such a reuse too | Step 13 says one record and why; the preview line is DG1's and outside her answers: OUTSTANDING DG1b-02 |
| 3 | MEDIUM | §2.4's "Space and Enter work as on every switch" is false once there is something to read: Enter on the switch is D.O.G.'s generate key there (C12's exception), so since Q21 a keyboard user changing sides at open starts a full deck | §2.4 and §13 say it; walkthrough 75 §6 lists every Enter that generates; her §4 question asks whether Enter on the switch should move it |
| 4 | MEDIUM | The App test proved only that D.O.G.'s tag has no `key`: a condition around it, a key on its page, or a page that drops its children would remount it and pass | One check now names each of those, with a control for each planted into App's real text; the walkthrough's line matches what it proves |
| 5 | LOW | The Alt check's window could pass a toggle placed beside the handler, and a harmless rewrite (`(prev) =>`) could break it | The toggle must sit in the handler that checks for Alt, up to that handler's close; `(prev) =>` is read; controls for a toggle beside it and a second one |
| 6 | LOW | "Not in a text box" was not the whole Enter story: the deck context box's own Enter generates, even after pages exist; links, tabs and an open window | Walkthrough 75 §6 and §13 say so |
| 7 | LOW | Nits: "the twelve-page check script" is the walk of every page; step 17 must go through WILSON's menu in the browser; step 16's picture is the 1440x900 one; DG1b-01's fix needs `currentPage` in the effect's dependencies | All four done |

On the real files, each correction's test was made to fail: a `key` after
D.O.G.'s other props in `App.jsx` (now caught only by the new check), a
condition around D.O.G.'s tag, the Alt toggle moved beside its handler, the
side flipped back, and a mount-time reset each turned exactly one test red.
`scripts/ui-walk.mjs --only dog` passes with the new proof and fails with the
old one ("1 of 1 screens did not come back clean").

## 16. FX13: Enter and Alt, her answers of 2026-10-26

Asked by the controller in chat as multiple choice (walkthrough 75 §4's two
questions); her words are in `docs/sessions/briefs/po-fx13-dog-enter-key.md`.

| Question | Her answer | Built |
|---|---|---|
| Enter at the start, the deck context box | "Enter needs text in the box" | With Full deck on, D.O.G.'s Enter (`enterIsDogs`) starts a full deck only when the box has words (`enterStarts`; whitespace is empty). Empty: nothing starts, the box gets focus (card 3 opens if folded, the box brought to the middle of the page, named by its label since review round 1) and the kit toast stack says why, one toast at a time, with no timer: it goes when it stops being true (review round 2). The box's own Enter does nothing when it is empty. The Generate button, Single page and the regenerate box are untouched. |
| Enter on the switch | "Enter moves the switch (Recommended)" | The switch left `GENERATE_TOGGLES`: Enter is the kit Switch's own and flips it. The `.dog-check` tick boxes keep "Enter generates" (B-R1-01), under the rule above. |
| The Alt key | "Keep it as it is" | Nothing; OUTSTANDING DG1b-01 closed by her ruling. |

Also: the preview's "Reading it here is recorded" line is said only when that
preview downloads (was OUTSTANDING DG1b-02; `useReferences`' `bodyKept`).
Walkthrough 77.
