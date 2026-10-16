# D.O.G. references — the design (DG1, 2026-10-16)

Phase 3 of `docs/sessions/briefs/po-dg1-dog-references.md`. Built only on Audrey's
answers in `docs/design/DOG_REFERENCES_QUESTIONS.md` (batches 1 to 4, verbatim
there). Batch 5 was left for tomorrow at her request ("keep coding im going to
sleep. leave questions for tomorrow"); where this design needs one of its four
answers it follows the recommended pick and marks it **provisional (Qn)**, built
so that a different answer is one change. The research is
`docs/design/DOG_REFERENCES_RESEARCH.md`.

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
| P12 | **Provisional (Q12):** the chosen set is kept while WILSON is open, never written to the computer. | recommended pick |
| P19 | **Provisional (Q19):** *Use project assets* places the pictures and videos among the chosen references. | recommended pick |
| P20 | **Provisional (Q20):** the cards read *1 Project documentation*, *2 References*, *3 Generate outline*. | recommended pick |
| P21 | **Provisional (Q21):** D.O.G. opens on *Single page*, as today. | recommended pick |

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

### 2.1 Card 1, *Project documentation* (provisional name, P20)

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
- **The contract line** (the research's pattern 2): *"Only what is listed here
  goes to the AI, with the project's title and description."*
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
- **The meter**: one bar and *"About 24% of what one deck reads"*, counting
  everything that will be sent (the project's text, the deck text, the uploads
  and the references). At 100% and past it the bar turns amber and the line reads
  *"Past what one deck reads: generating may be slow, cost more, or fail."*;
  Generate stays enabled (R10). The estimate in tokens is the bar's title text.
- **Add references** opens the window. With no project chosen the card says
  *"Choose a project to reference its items and files. Your notes can be
  referenced without one."* and the button still opens the window on Notes (R7).
- **Changing project** removes the old project's items and files from the list,
  keeps the notes (they are not a project's), and says so in one line under the
  header: *"3 references from Salt Hours were removed."* No dialog (flow): it is
  a list, not work.

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

### 2.4 Card 3, *Generate outline* (provisional name, P20; R18 exactly)

- **The switch**, first in the card: *Single page*, the switch, *Full deck*.
  Both words always show; the side that is on reads in the full ink and the
  other in the dim ink, and the knob sits on that side. Clicking either word
  chooses that side; the switch toggles. The switch keeps its `dog-full-deck`
  class, so Enter keeps generating from it (`enterGenerates.js`). It opens on
  *Single page* (P21).
- **The two media boxes**, under the switch, in both modes:
  - **Use visual assets** with *"to place media in the deck"* after it in the
    hint ink (R15): your uploaded pictures and videos, as *Use uploaded assets*
    did.
  - **Use project assets**: the project's pictures and videos among your
    chosen references (P19).
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
| Phase | always | name, start and end, description | |
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
| PDF | bytes ÷ 20 (about 1,500 to 3,000 text tokens a page plus the page as a picture) |
| Picture | 4,000 each (the newest models cap a picture at 4,784) |
| Video | 0 (never sent) |

The limit is **200,000**, under the 232,275 of the real deck that worked, leaving
room for the system prompt, the format and the pages already made. The bar shows
the estimate against it; past it, amber and the warning, never a block.

---

## 5. Privacy: what leaves, and what can be chosen

1. **Nothing a person may not read is listed.** On the cloud every list is the
   person's own read under the database's rules: a private project's items only
   for its creator and members (0072), files without money files for anyone
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
6. **Reading happens at Generate or Preview**, never at the choosing, so a
   download record means a body was really used.
7. **A reference that becomes unreadable** after it was chosen is not sent: the
   read at Generate fails for it, and the card greys it (§2.2).
8. **The Local Server** is one person on one computer: everything in its bundle
   may be listed, except Legal and money files (the same rule), and there are no
   notes.

---

## 6. The Local Server and the other backends

| Backend | Items | Files | Notes | Generate |
|---|---|---|---|---|
| Cloud | yes | yes | yours | signed in, as today |
| Local Server (signed in for the AI) | yes, from one `loadProject` | yes | *"Notes need the cloud"* | as today |
| Signed out | listed if the backend can | listed if the backend can | none | refused by the AI relay, as today |
| Google Drive | each kind *"Could not be listed"* (its reads refuse) | listed | none | as today |
| Dev fixtures | yes | listed; reading a body is refused, as for every fixture download | the four test notes | as today |

---

## 7. The AI calls

- Every call stays on `ai-proxy` through `callAI`; no new call is added.
- **Every reply is read with `textFromMessage`** (the brief's rule), in all
  eight of D.O.G.'s calls; a D.O.G. test pins it. Measured today: each call joins
  every text block of the reply; with no tools in D.O.G.'s calls a reply has one
  text block after its thinking, so the read is the same text.
- The export formats (`DECKOUTLINE.md`, `VIS_DECKOUTLINE.md`, `IMG_PROMPTS.md`,
  the placed asset files) do not change.

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
