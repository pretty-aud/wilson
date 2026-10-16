# D.O.G. references — the research (DG1, 2026-10-16)

Post-overhaul DG1, phase 1 of three (`docs/sessions/briefs/po-dg1-dog-references.md`).
Research only: no product code changed. The questions this raises for Audrey are
in `docs/design/DOG_REFERENCES_QUESTIONS.md`; the design is written only after her
answers.

Her words (2026-10-16, verbatim, in the brief): D.O.G. should let a person choose
"items in the rabbit tool like assets, scenes, shots, levels, etc and choose files
or personal notes a person makes", read "the notes pages in the dashboard", and
"pull from files, from databases, and from notes"; uploads stay "how it was"; the
Full deck and Single page interfaces become one, to make room for the new card.

---

## 1. How other tools let a person choose what the AI draws on

Public pages only, read on 2026-10-16, summarised in our own words; at most one
short quote per tool. Nothing was signed into.

### 1.1 Google NotebookLM (renamed "Gemini Notebook" in its help centre)

A notebook keeps a **Sources** panel down the left. Sources go in one at a time or
in a batch (pasted text, Google Docs and Slides, Drive files, PDF, Word,
PowerPoint, web links, YouTube and more), and each one gets a tick box: an answer
is built only from the sources that are ticked. Opening a source shows a **Source
Guide**, an automatic summary with its key topics, so a person can judge it before
asking anything. Answers carry numbered citations that jump back to the passage.
The limits are hard and published: 50 sources per notebook on the free plan (up to
600 on the largest), and 500,000 words or 200 MB per source. A source over the
limit fails to import rather than being cut short.

- Sources: <https://support.google.com/gemininotebook/answer/16215270?hl=en>
- FAQ, limits: <https://support.google.com/gemininotebook/answer/16269187?hl=en>
- Plans: <https://support.google.com/gemininotebook/answer/16213268?hl=en>
- "Chat responses in Gemini Notebook only use data from your sources." (chat help,
  <https://support.google.com/gemininotebook/answer/16179559?hl=en>)

### 1.2 Notion AI

Three ways to set what the AI reads: a **source picker** under the chat box (the
whole workspace, a teamspace, a page, a connected app, or the web), an
**@-mention** of a page or person inside the question, and **Add context** to
attach a page. Custom agents list the exact pages and databases they may read, and
start with none. Answers cite their pages. Notion repeats one promise on every page
about it: the AI reads only what the asking person can already open. A copied
agent shows pages the new owner cannot open as greyed "no access" chips.

- Enterprise search: <https://www.notion.com/help/enterprise-search>
- Custom agents: <https://www.notion.com/help/custom-agents>
- Security: <https://www.notion.com/help/notion-ai-security-practices>
- "Notion AI only shows you information from places you can access."
  (<https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai>)

### 1.3 Gamma

Three doors into a deck: **Generate** from a topic, **Paste** your own text, or
**Import** a file (PowerPoint, Word, PDF) or a link. The person says whether to
expand, condense or keep the text as it is, then reviews an outline (**Plan mode**)
before the deck is built; afterwards "View Source Prompt" shows what went in. The
newer agent reads connected apps only when the request points at them. The real
ceilings are published only for the programmers' interface: 100,000 tokens of
input text, or 50 pages, per request; files up to 100 MB (PDF) and 200 MB (Word,
PowerPoint).

- Getting started: <https://help.gamma.app/en/articles/7838093-getting-started-with-gamma-ai>
- Connectors: <https://help.gamma.app/en/articles/15675394-how-do-i-use-gamma-with-inbound-connectors>
- Limits: <https://developers.gamma.app/guides/generate-api-parameters-explained>
- The agent "only reads a source when you reference it." (connectors page above)

### 1.4 Canva

Canva's pages refused the research fetcher, so this section rests on search-engine
extracts of Canva's own help pages and should be re-read in a browser before it is
relied on. The old "Docs to Decks" button is retired. Today a person starts a
presentation from Canva AI, attaches context with an **Add** menu (upload, their
Canva designs, Google Drive, Dropbox, OneDrive), edits the outline section by
section, then generates. Context files are capped at **three per request, 10 MB
each**, and each generation spends a monthly AI allowance.

- Create a presentation with Canva AI: <https://www.canva.com/en_au/help/using-magic-presentations/>
- Import files to Canva AI: <https://www.canva.com/en_in/help/import-to-canva-ai/>
- Docs to Decks, retired: <https://www.canva.com/en_in/help/docs-to-decks/>

### 1.5 Microsoft Copilot (PowerPoint and Copilot Chat)

PowerPoint's **Create presentation from file** offers recent OneDrive and
SharePoint files; typing **/** in the prompt searches by file name, and up to
**five files** can be referenced in one prompt. Copilot shows an outline and
builds only after the person confirms. Microsoft's own training says to tell
Copilot what to take from each file rather than attaching everything. Copilot
Chat's **/** menu adds tabs for people, files, meetings and emails, ranked by
recent activity. Copilot surfaces only what the person can already view.

- PowerPoint: <https://support.microsoft.com/copilot-powerpoint>
- Referring to files: <https://support.microsoft.com/en-us/Microsoft-365-Copilot/refer-to-specific-files-and-more-in-microsoft-365-copilot>
- Privacy: <https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-privacy>
- "Copilot can't use files you don't have permission to view."
  (<https://learn.microsoft.com/en-us/training/modules/present-copilot-microsoft-powerpoint/2-craft-engaging-slides>)

### 1.6 For a person building one deck

| | Seeing what is chosen | Searching | Choosing many | The cost of too much | Previewing a source |
|---|---|---|---|---|---|
| NotebookLM | Best: one panel, one tick each | None over what is already added | Batch add; ticks after | Hard count per plan, nothing about quality | Best: a summary per source |
| Notion AI | One scope at a time; mentions scroll away | Strong, whole workspace | By container, not by ticking pages | Nothing published | None: open the page yourself |
| Gamma | Weak: the text becomes the deck | None over your own material | One file or paste per import | Says expand, condense or keep; caps only in the API docs | Plan mode previews the output, not the input |
| Canva | Attachments in the prompt; outline step | Browse uploads | Three files at most | Three files, 10 MB, an allowance | The outline, not the inputs |
| Copilot | Files sit in the prompt | Type a name after **/** | Five files at most | The cap, and advice to say what each file is for | None |

**Worth adopting.**

1. One list of what the AI will use, with a count, visible while the person writes
   the prompt (NotebookLM).
2. A plain sentence saying the AI uses only what is chosen, and only what the
   person can open (NotebookLM, Notion, Copilot).
3. Two ways in: browse by kind, and type to search (Notion, Copilot).
4. Choose many at once with tick boxes, and remove any one with one click.
5. A preview of exactly what will be sent before generating (NotebookLM's guide).
6. A published ceiling with a meter showing how full the set is, failing loudly
   when it is chosen rather than quietly when the deck is generated.
7. Read lazily: list many things cheaply, read the full text only of what is chosen
   (Gamma's connectors).
8. A reference that disappears or becomes unreadable after it was chosen shows as
   greyed, not silently dropped (Notion's chips).

**To avoid.**

1. Recent items as the only way to find anything (Copilot's two-file picker).
2. Silent cutting at generation time (reported of Gamma).
3. Different powers through different doors (Canva's outline only from one entry).
4. Limits kept in a help page instead of on the screen.
5. "Attach everything and let it decide" (Microsoft's own advice against it).

---

## 2. D.O.G. today, measured

Measured on 2026-10-16 from the code at `2ef0bbde` and on the dev fixtures
(`node scripts/dg1-shots.mjs 5300 --out docs/sessions/handoffs/img --size <W>x<H>`,
the `dg1-worktree` dev server). Line numbers are not given; every claim names the
identifier that carries it in `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx`
unless another file is named.

### 2.1 The screen

Three cards down the middle, the deck's pages down the left
(`po-dg1-dog-01-rest-*.png`).

**Card 1, "Project documentation & deck context":**

| Field | Hint (the subtitle) | Example (placeholder) |
|---|---|---|
| Project (dropdown, **New project** beside it) | Link a project to include its documents and assets in generation | No project selected |
| Upload Documents (**Choose file**, "(PDF, MD, TXT, images)") | Source material for generating slide content (max 20 files) | |
| Deck Context & Guidelines, with three tick boxes on its label line: **Theme generator** (on), **Use uploaded assets** (off), **Use project assets** (off); the **Full deck** switch at the line's right end | Set the overall tone, style, and objectives for the deck; with Full deck on it adds "• Include desired page count" | Example: This is a pitch deck for a luxury brand activation. The tone should be sophisticated and aspirational... |

**Card 2, "Generate page outline":**

| Field | Hint | Example |
|---|---|---|
| Slide Layout Type (dropdown: "Select layout..." and 15 layouts; the chosen layout's description appears under it) | Choose how content will be arranged on the slide | |
| Page # (free text) | Single number or range (e.g. 3-7) | 5 or 1-10 |
| Page Request | Describe the specific content you want on this slide | Example: I need a page listing all the main characters with summaries for each... |

Then **Generate page outline**. **Card 3, "Generated output"**, holds the result.

**The Full deck switch** (`fullDeckMode`). Off, its label reads only "Full deck"
and the track is grey: nothing names the other state. On
(`po-dg1-dog-03-full-deck-*.png`), card 2 collapses to its title with
"(Disabled in full deck mode)" and **Generate full deck outline** appears at the
foot of card 1. The deck context box is the full deck's prompt (Enter generates
the deck); it is also sent with every single page. Turning the switch off reopens
card 2.

### 2.2 What choosing a project sends to the AI

Choosing a project (`selectedProjectId`) does three things.

1. **Its title and description** become `projectContext`, under PROJECT CONTEXT.
   No other field of the project is sent: not its status, dates, client, type or
   anything in R.A.B.B.I.T.'s tabs.
2. **Its attachments are downloaded, at once, in full.** Two stores feed one list
   (`projectFiles`): the old arrays on the project record (`documents`,
   `visualAssets`, written only on the Local Server) and the files table, read
   with `adapter.listFiles` and filtered by `isDeckAttachmentRow`
   (`src/tools/rabbit_v0.1.0/deckAttachments.js`). A file qualifies when it is a
   classified document (any `document_kind`), or a picture or video filed against
   the project itself. **Never**: a file filed against a scene, shot, asset, task,
   phase, level or experience; a money file; a Legal file (even for a manager who
   may open it, because a deck reaches every member of the project); a deleted
   one. Documents come first, then newest. At most **20 files and 32 MiB**
   (`DOG_ATTACHMENT_MAX_FILES`, `DOG_ATTACHMENT_MAX_BYTES`); a file that does not
   fit is skipped whole, never cut, and the panel says how many were left out.
   **Every body is downloaded when the project is chosen**, before anyone asks for
   a deck, and on the cloud each download writes a "downloaded" record into the
   file's activity (`log_file_downloaded`): choosing a project with 20 attachments
   writes 20 records for downloads nobody asked for.
3. **The file roles.** Each attachment is CORE or REF (a chip in the panel flips
   it), and PROJECT CONTEXT lists both groups by name, telling the AI that CORE
   files define the project and REF files only support it.

With a project chosen the panel shows its description, "N attachments · M core"
and the roles list (`po-dg1-dog-02-project-*.png`). In the test data Salt Hours
has none: "0 attachments".

### 2.3 What one generation sends

`buildSourceParts` turns every upload and attachment into the message. In order:

| Part | From |
|---|---|
| PDFs and pictures | uploaded once to the AI provider's file store through `ai-files`, then referenced by id (§2.6) |
| PROJECT CONTEXT | title, description, CORE and REF file names |
| DECK CONTEXT & GUIDELINES | the deck context box |
| EXISTING DECK PAGES | single page and regenerate only: one line per page already made |
| UPLOADED FILES | one line per file: its name and kind |
| TEXT CONTENT | each text file's whole body inline, up to 256 KB each (a larger one goes through the file store) |
| Placement instructions | only with a "Use … assets" box ticked |
| SELECTED SLIDE LAYOUT and USER REQUEST | single page only |

**Videos are never sent to the AI**; they exist only to be placed into frames.
Nothing is truncated anywhere.

**Generation needs a file.** Both generate buttons stay greyed until at least one
file is uploaded or attached (`hasFileContent`). Measured: with Salt Hours chosen
and nothing uploaded, both are disabled. A project's description alone, or
anything else that is not a file, cannot start a deck today.

### 2.4 What it costs

Measured points, recorded in the code beside the full-deck call:

| What | Input tokens |
|---|---|
| The S19 test deck (2026-08-02) | 14,513 |
| A real deck (2026-08-03) | 232,275 (about $0.70 a call; a long deck can make up to three continuation calls, each sending it all again) |

From the AI provider's published figures: a PDF page costs about 1,500 to 3,000
tokens of text plus the page as a picture
(<https://platform.claude.com/docs/en/build-with-claude/pdf-support>); a picture
costs one token per 28 × 28 pixels, at most 4,784 on the newest models
(<https://platform.claude.com/docs/en/build-with-claude/vision>). The house rule
of thumb is four characters to a token (`src/tools/rabbit_v0.1.0/intake/chunkers/notes.js`).
So a scene's name, description and notes run to roughly 100 to 300 tokens, a
thousand-word note about 1,300, a ten-page PDF 15,000 to 30,000 or more, one
photograph up to about 4,800. The full-deck call runs on the reasoning tier
(`claude-sonnet-5`, `modelFor('dog.fullDeck')`) at medium effort
(`tuningFor('dog.fullDeck')`).

### 2.5 The upload path

**Choose file** takes one file per pick, up to 20 (`handleFileUpload`): PDF,
Markdown, text, pictures and videos, with no size limit. The button's own words
leave out video though it is accepted. Uploads live in this screen's memory only
(`uploadedFiles`): they are not saved to the project, and they are gone when
D.O.G. is reloaded. Her words keep this exactly as it is.

### 2.6 The cloud, the Local Server, and the file relay

- **The AI is the cloud's, on both.** Every call goes through the `ai-proxy`
  function with the signed-in person's session; signed out, D.O.G. cannot
  generate at all (`callAI` in `src/cloud/aiProxy.js` refuses without a session).
- **`ai-files`** relays a PDF or picture to the AI provider's file store once, so
  later calls send a short id instead of megabytes (the 546 failure of
  2026-08-10). It inspects nothing.
- **Handbook §13.1 is out of date here.** It says cloud attachments are refused
  at the adapter; that was true before Track C's C3, which moved them into the
  files table. What is still refused is writing the old arrays on the cloud.
- **The Local Server** has every R.A.B.B.I.T. item and file in its project bundle
  (`loadProject`), with no per-person permissions (one person, one computer). Its
  upload route drops a file's scene, shot, level and experience links (stated in
  `deckAttachments.js`). **It has no notes at all**: notes are cloud-only.
- **How the answers are read.** None of D.O.G.'s eight calls uses
  `textFromMessage`; each joins every text block of the reply. The rule's guard
  (`src/cloud/textFromMessage.test.js`) bans only `content[0].text`, which D.O.G.
  does not use, so all eight pass it.

### 2.7 The two "assets" boxes, the theme generator

- **Use uploaded assets** and **Use project assets** (`useUploadedAssets`,
  `useProjectAssets`) put the uploads' or the project's pictures and videos on the
  table for placing into slide frames (`placementAssets`); the AI is told which
  file goes in which frame and is told not to reuse one already placed. They do
  nothing to what the AI reads.
- **Theme generator** (`enableThemeGen`, on by default) asks the fast model for
  three colour themes the first time a deck gets pages, **in both modes**: the
  first single page triggers it as much as a full deck. Off, the deck takes the
  first preset theme. It reads the deck context's first 800 characters, the page
  titles, and the **uploads'** names and first two text excerpts; it never reads
  the project's attachments. The refresh button beside the theme always makes new
  ones.

### 2.8 What a R.A.B.B.I.T. item holds

| Kind | What it holds that a deck could use | Pictures |
|---|---|---|
| Asset | name, type, description, status, dates, phase | a thumbnail address |
| Task | title, description, notes, status, priority, dates, bid and logged days, role; its items (FX2, 0096) | none |
| Scene | name, number, description, notes, status, type, time of day, dates | a thumbnail address |
| Shot | the scene's fields plus framing, camera movement, frame count | a thumbnail address |
| Level | name, description, notes, status, dates | a thumbnail address |
| Experience | as a level | a thumbnail address |
| A file | name, kind (`document_kind`), description (0075), tags (0085), folder, size, its links to the items above | the file itself |

Every item's files are found through the file's own link to it (`scene_id`,
`shot_id`, `asset_id`, `task_id`, `level_id`, `experience_id`); the Files tab
shows them as folders (SCENES › a scene › its shots, walkthrough 56). Bins hold
clips whose poster frames are pictures too. On the cloud, every one of these is
read with the person's own session, so database rules decide what can be listed.

### 2.9 What a Dashboard note holds, and whose a person can see

Migration 0017: a note is a title (up to 200 characters), a subject (the person's
own list), a date, `ydoc_state` and `body_preview`.

- **The text lives in `ydoc_state`**, a Yjs document. `NotesView` reads it by
  applying the stored state to a fresh document under its editor (TipTap's
  starter kit with the Collaboration extension) and asking the editor for its
  text. `body_preview` is only the first 300 characters (500 at most by the
  database's rule), for the list; it is never the note.
- **Owner only, no exception.** All four rules on `notes` require
  `owner_id = auth.uid()`, and the table's own comment says "no admin bypass". A
  person sees only their own notes; there is no sharing, no teammate's notes and
  no administrator's view.
- **A note belongs to no project.** It has no project link; the nearest thing is
  its subject, which the person names freely.
- **Cloud only.** Signed out or on the Local Server the Notes tab shows that the
  cloud is needed.
- The test data has four notes, with real Yjs bodies (`src/dev/fixtures/data/notes.js`);
  the first opens at 49 words (`po-dg1-notes-*.png`).

### 2.10 What a person may read, by kind

| Kind | The rule today |
|---|---|
| Projects | the dropdown lists what the person can see; a private project only its creator and members (0072) |
| Items | anyone who can see the project (each table's select rule hops to the project) |
| Files | the project's members, minus money files (money access only) and Legal files (admins, the project's managers, workspace managers: 0088, 0092); D.O.G. never takes a money or Legal file, whoever asks |
| Notes | their owner, and nobody else |
| Local Server | everything on this computer: one person |

### 2.11 Pickers WILSON already has

- **The task window's "Add an item"** (FX2, walkthrough 65,
  `po-fx2-03-picker-*.png`, `po-fx2-04-picker-search-*.png`): one search over
  every kind, then a group per kind with its count, each row a kind icon, a
  status dot and the name; one click adds one.
- **A scene's Assets table** in its popup: the chosen rows as a table with a **+**
  at its head.
- **The Bins' take picker** (`TakePickerDialog`): a window to choose clips.
- **The Files tab** (walkthrough 56): one folder at a time with a path above, and
  a search that finds a file anywhere in the project.

All four choose one thing per click. None chooses many at once.

---

## 3. The gap

1. **A project is all or nothing.** Choosing one sends its title, description and
   up to 20 attachments picked by rule. A person cannot choose a scene, a shot, a
   level, a task or a particular file; files filed under an item are excluded
   outright.
2. **Notes cannot reach D.O.G. at all.**
3. **Nothing but a file can start a deck.** Even a project full of scenes cannot
   generate without an upload or an attachment.
4. **Reading happens too early.** Every attachment is downloaded, and its download
   recorded, when the project is chosen, whether or not a deck is made.
5. **The person cannot see what the AI will read**, beyond file names, and cannot
   see its size or cost before generating.
6. **The switch names only one side**, and the screen holds two near-duplicate
   input cards: the reason her merge makes room.
7. **Privacy is per kind**: notes owner-only, files behind the money and Legal
   gates, items by project, the Local Server by computer. A references picker has
   to keep each kind's rule, not a new one.

## 4. What this asks of Audrey

Every decision the design would otherwise make for her is in
`docs/design/DOG_REFERENCES_QUESTIONS.md`, two to four choices each with one
recommended, asked in this session's chat four at a time. Her answers are
recorded there verbatim as they come.

## 5. The pictures

In `docs/sessions/handoffs/img/`, each at 1440x900 and 1280x700, with the
measurements beside them (`po-dg1-measure-dog-notes-<size>.json`):

| Picture | What it shows |
|---|---|
| `po-dg1-dog-01-rest` | D.O.G. at rest, nothing chosen |
| `po-dg1-dog-02-project` | Salt Hours chosen: description, "0 attachments" |
| `po-dg1-dog-03-full-deck` | Full deck on: card 2 folded, the full deck button in card 1 |
| `po-dg1-dog-04-single-page` | Full deck off, a layout chosen, card 2 in view |
| `po-dg1-notes-01-list` | Dashboard → Notes: the four test notes |
| `po-dg1-notes-02-open` | The first note open |

FX2's picker (`po-fx2-03-picker-*`, `po-fx2-04-picker-search-*`) and the Files
tab (`po-s4c-*`) are already in the same folder.
