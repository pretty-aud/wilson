# D.O.G., O.T.T.E.R. and the help content: redundancies, near-duplicates and waste

Read-only review of the integration tip `0d33b17f` (worktree `post-overhaul-merge`), 2026-10-31.
Paths are relative to `ROOT\WILSON` =
`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\post-overhaul-merge\WILSON`.
Nothing was edited, run, built or installed. **MEASURED** = counted or read from the code (or
`node_modules`) on this tip; **INFERRED** = the code says it must happen, nothing was run to see it.
Ids like N1-01 are `docs/OUTSTANDING.md`'s. Within each section the findings are ordered by what they
would save (code or runtime); the severity also weighs wrong behaviour.

## Measured facts

| Area | Files | Source modules | Tests | CSS |
|---|---|---|---|---|
| D.O.G. `src/tools/deck-outline-generator_v0.514/` | 30 | 21 (11,482 lines) | 8 (4,780 lines) | 1 (1,656 lines) |
| O.T.T.E.R. `src/tools/otter_v0.3.1/` | 47 | 23 (15,269 lines) | 23 (9,325 lines) | 1 (3,074 lines) |
| Help `src/data/` | 3 | 2 (1,364 lines) | 1 (519 lines) | 0 |

Largest files: `Otter.jsx` 6,402 lines; `DeckOutlineGenerator.jsx` 5,533; `otter.css` 3,074; `dog.css` 1,656;
`LayoutVisualizer.jsx` 1,624; `components/RequestsView.jsx` 1,261; `adapters/supabaseOtterAdapter.js` 1,082;
`petKnowledge.js` 1,058; `Validator.jsx` 1,038; `data/dogHelpContent.jsx` 949; `references/referenceModel.js` 856;
`components/otterSharing.js` 747.

- Each tool is essentially one component: `DeckOutlineGenerator.jsx` holds 88 `useState`, 72 `useCallback`,
  15 `useEffect`, 9 `useMemo`; `Otter.jsx` 104 `useState`, 53 `useCallback`, 18 `useEffect`, 4 `useMemo`.
  Neither root is memoized (both `index.jsx` are one-line re-exports) and `App.jsx:2596` renders every page at once.
- Every AI call in the area goes through `callAI` (ai-proxy). D.O.G.'s eight readers use `textFromMessage`;
  O.T.T.E.R. uses `extractTextAndCitations` (last text block); the Validator reads the FIRST text block (A6).
- 251 named exports in the area's 46 non-test modules; 51 have no importer outside their own file except tests (D).
  Every module has a non-test importer (no dead file).
- `console.log`: 21 in `DeckOutlineGenerator.jsx`, one per `parseSlideContent` call (`parser.js:92`), one per
  `LayoutVisualizer` render (`LayoutVisualizer.jsx:68`), none in `Otter.jsx`; `vite.config.js` drops none, has no `manualChunks`.
- `import { Prism }` from react-syntax-highlighter 16.1.0 loads `refractor/all`
  (`node_modules/react-syntax-highlighter/dist/esm/prism.js:3`): refractor 5.0.0, 297 grammars, 935,047 bytes of
  grammar source. O.T.T.E.R. names 26 languages (`otterLanguage.js:84`).
- `dist/` in this worktree is stale (2026-09-29, main chunk `index-BrMi8IMi.js` 3,919,097 bytes), so bundle
  figures here come from `node_modules`, not from a build of the tip.
- CSS: 30 declaration blocks of 3+ declarations (131 declarations) in `dog.css` are identical to blocks in
  `otter.css`; 14 blocks repeat inside `dog.css`, 58 inside `otter.css`.

---

## A. Near-duplicate functions

### A1. O.T.T.E.R.'s five generators are two copies of one pipeline plus a third
**High** · MEASURED (line spans; copies compared by reading)
- **Where:** `src/tools/otter_v0.3.1/Otter.jsx:1367-1542` `generateCourse` and `:2283-2451` `agentGenerateCourse`;
  `:1583-1842` `generateSubjectContent`, `:1847-2056` `generateSingleSubject`, `:2063-2280` `agentGenerateSingleSubject` (1,033 lines).
- **What:** the agent versions are the UI versions copied with parameters in place of state (their own comments:
  "mirrors generateCourse but takes params"). The course pair repeats the message, the existing-subject dedupe,
  the parse, the course create and the stub loop (`1388-1525` against `2312-2439`). The three subject paths
  repeat the type hints and node detection, the three dedup reads, the reference-URL block, the
  strip-fences/parse/regex/parse cascade, the section normalising, the source dedupe, the subject save and the
  hotkeys/functions/nodes normalise-merge-and-cache block (`1758-1807` = `1991-2039` = `2221-2269`). About 430
  lines are copies. They have already drifted: a string `key_takeaways` is kept at `1724` and dropped at `1953`
  and `2184`; the agent's node hint lost its type list (`2112` against `1881`). The slug regex is inlined 8 times
  (`1491, 1500, 1965, 2195, 2405, 2414, 2882, 2887`) although `slugify` (`adapters/otterRoutes.js:608`) is imported
  at `:86`. Every cross-cutting change pays this: the subject-share reminder had to be placed in six save paths
  (`docs/design/OTTER_SUBJECT_SHARES_DESIGN.md` §5.9).
- **Fix shape:** one `generateSubject({ course, topic | stub, onPhase, signal })` and one
  `generateCourseOutline({ name, context, visibility, onPhase })` built on shared `buildSubjectMessage`,
  `parseModelJson`, `normalizeSections` and `saveGeneratedSubject`, with the agent wrappers passing parameters.
- **Recorded:** not as a redundancy. The sixth save path (the import) is already recorded as *"In cloud mode an
  O.T.T.E.R. import of a lesson … saves nothing"*.

### A2. D.O.G. parses its own slide format in three places, and the asset line in three more
**Medium** · MEASURED (grep counts)
- **Where:** `DeckOutlineGenerator.jsx:880-1053` `parseOutputToPages` (three strategies); `modals/HistoryModal.jsx:69-155`
  `handleImport` (three strategies); `parser.js:2-100` `parseSlideContent` and `:107-175` `correctGeometryIconOrder`.
  The asset line `• [Type | ratio] - text` is parsed by `parser.js:179-193` `parsePlacedAssets`,
  `DeckOutlineGenerator.jsx:3657-3673` (image prompts) and `LayoutVisualizer.jsx:286-346`; the TITLE/SUBTITLE
  locators again at `DeckOutlineGenerator.jsx:2377-2394` and `LayoutVisualizer.jsx:79-104` (`updateField`, never called).
- **What:** the SLIDE header pattern and the TITLE pattern are each written at least 7 times (~250 lines in all).
  The copies accept different shapes: the import's first strategy needs `[LAYOUT TYPE: …]` and 20+ `═`
  (`HistoryModal.jsx:74`), generation takes either header form and 5+ `═` (`DeckOutlineGenerator.jsx:888-901`), so
  the same text can split differently on import and on generation.
- **Fix shape:** one `splitSlides(text)`, `slideHeader(block)` and `parseAssetLine(line)` in `parser.js`, used by
  generation, import, the visualiser and the image-prompt export.
- **Recorded:** no.

### A3. The change-request decision handlers are copied between the Admin Terminal and O.T.T.E.R.
**Medium** · MEASURED
- **Where:** `src/components/AdminTerminal/ChangeRequestsSection.jsx:91-96` `fmt`, `:143-166` `loadDiff`, `:168-195`
  `approve`, `:197-218` `decline`, `:226-237` `openTheirCourse`; the same five in
  `src/tools/otter_v0.3.1/components/RequestsView.jsx:72-77, 194-217, 219-251, 253-276, 278-287`.
- **What:** identical bodies (~100 lines) apart from comments and `openTheirCourse`'s last line (a window event
  against a callback); both read `res.json()` before `res.ok`. The two surfaces are by design (handbook §13.2,
  "admin work in the admin place", one `DOC_LABELS` "so a third surface cannot drift"); the handlers were copied
  instead of shared, which is the drift that rule was written against.
- **Fix shape:** a `useChangeRequestDecisions({ load, onOpenCourse })` hook beside `DOC_LABELS`
  (`adapters/otterRoutes.js`) that both surfaces call.
- **Recorded:** no.

### A4. D.O.G. decides "what kind of file is this" four ways, and they disagree on pictures
**Medium** · MEASURED for the copies; INFERRED for the failed generation (would settle: upload one `.svg` and Generate)
- **Where:** `DeckOutlineGenerator.jsx:754-869` `handleFileUpload` (its own tests at `769-787` and four near-identical
  `FileReader` branches at `789-861`); `references/referenceModel.js:113-141` `readableType` and `:212-220`
  `legacyDogType`; `src/tools/rabbit_v0.1.0/deckAttachments.js:253-260` `dogTypeForRow` (read through
  `referenceModel.js:150-153`); the accept lists `references/ReferencesCard.jsx:145` (`image/*`) and the New project
  window's `DeckOutlineGenerator.jsx:5470, 5503`; the video extensions `(mp4|mov|webm|avi|mkv)` at
  `DeckOutlineGenerator.jsx:781`, `referenceModel.js:215`, `deckAttachments.js:257`; the 20-file limit at
  `ReferencesCard.jsx:148`, `DeckOutlineGenerator.jsx:759-760` and `deckAttachments.js:299`.
- **What:** an upload takes any `image/*` and `file.type.startsWith('image/')` (`:777`) sends an SVG, HEIC, TIFF or
  BMP as an image block, which `referenceModel.js:113-118` itself says "fails the whole generation"; the same file
  chosen as a reference is refused by `readableType`. The New project window offers `.doc`, `.docx` and `.xlsx`,
  which D.O.G. then lists greyed as unreadable. The 20 is written three times, one of them with no reader.
- **Fix shape:** one `dogKind({ mime, name })` with `readableType`'s rules, used by the upload, the legacy and stored
  readers and every accept list, and one `FileReader` path keyed by the kind.
- **Recorded:** the unread 20 is already recorded as N1-01; the picture divergence is not.

### A5. D.O.G.'s rewrite and its "regenerate" build the same request twice
**Low** · MEASURED
- **Where:** `DeckOutlineGenerator.jsx:3294-3368` `handleRewriteRequest` and `:3371-3445` `handleRewriteRedo`
  (`3300-3353` = `3380-3430`); the "deck context plus the first two text uploads" excerpt three times:
  `629-636` (themes), `3300-3305`, `3380-3385`.
- **What:** ~60 identical lines (line count, surrounding context, formatting detection, format hint, extend
  context); the two differ only in the model key (`dog.rewrite` / `dog.rewriteRedo`) and how the preview is set.
- **Fix shape:** one `rewriteRequest(selection, mode)` returning the body, called by both handlers.
- **Recorded:** no.

### A6. The Validator's AI wrapper is a second pause_turn wrapper, and it reads the wrong text block
**High** (little code, wrong answers) · INFERRED (would settle: one validation whose reply searches before
answering, logging `data.content`'s block types)
- **Where:** `src/tools/otter_v0.3.1/Validator.jsx:23-66` `callValidatorAPI` and `:69-83` `parseJSONResponse`;
  `Otter.jsx:1196-1252` `callAnthropicAPI`, `:1263-1307` `describeResponse` / `extractTextAndCitations`, and the
  JSON cascade at `:1430-1441` (plus five more copies, A1).
- **What:** two wrappers for one job (call ai-proxy, retry, resume a paused web-search turn). The Validator's
  returns the FIRST text block (`data.content.find(b => b.type === 'text')`, `:36`) before it looks at
  `pause_turn` (`:53`), so a web-search reply that says "Let me check…" before searching hands the preamble to the
  JSON parser, and its `pause_turn` branch runs only when a reply has no text at all; it also has no 429/529 retry.
  This breaks the S30 rule (model text through `textFromMessage`, the LAST text block); the guard in
  `src/cloud/textFromMessage.test.js` scans only for `content[0].text`, so `.find(...)` passes it.
- **Fix shape:** move O.T.T.E.R.'s wrapper out of the component and have the Validator call it, keeping the rules:
  `textFromMessage` / `extractTextAndCitations`, `pause_turn` resumed with the assistant turn appended and no
  trailing user turn, bounded at 3.
- **Recorded:** no.

### A7. exportVisualAssets decodes base64 by hand, the slow way
**Medium** (memory on export) · INFERRED (size by arithmetic)
- **Where:** `DeckOutlineGenerator.jsx:3977-3981`; the shared `base64ToBlob` at `src/cloud/aiFiles.js:93`.
- **What:** one `atob` over the whole file, then a plain JS `Array` of char codes, then a `Uint8Array`, per placed
  asset. A placed video may be up to 100 MB (`referenceModel.js:662`), so export builds a 100-million-element array
  (several hundred MB) for it. `aiFiles.js:85-91` exists to avoid exactly this (chunked, never one big `atob`).
- **Fix shape:** `base64ToBlob(fileData.content, fileData.mediaType)`.
- **Recorded:** no.

### A8. Four readers walk the three reference documents for search
**Low** · MEASURED
- **Where:** `Otter.jsx:3146-3264` (Search dialog), `petKnowledge.js:703-759` `flattenDoc` (the pet; its comment says it
  was "taken from performSearch"), `Otter.jsx:5782-5788` (Functions view search), `Otter.jsx:5838-5843` (Hotkeys view search).
- **What:** four walkers of the same hotkeys/functions/nodes shapes that find different things: node inputs and
  outputs are searched only by the dialog, a `hotkeys` list only by the pet, a shortcut's notes by the dialog but
  not the Hotkeys view; the dialog builds each matching node's text twice (`3227-3231` and `3237-3240`).
- **Fix shape:** the dialog and both views filter `flattenDoc`'s rows (one reader, its entry guards included).
- **Recorded:** the two unguarded readers' crash on a null shortcut is already recorded as N1-03 (from S2b-05's tail).

### A9. Small shared-layer helpers re-written inside the tools
**Low** · MEASURED
- **Where / what:**
  - Blob download: `src/lib/csvExport.js:67` `downloadBlob`; re-written at `deck-outline-generator_v0.514/export.js:21-28`
    and `Otter.jsx:2803-2809`, both revoking the object URL synchronously after `click()`, which the shared helper
    delays on purpose ("Give the click a tick before revoking").
  - Contrast: `LayoutVisualizer.jsx:137-150` re-implements `colorUtils.js:2-16` while importing both (`:4`);
    `DeckOutlineGenerator.jsx:17` imports `getLuminance` and `getContrastRatio` and uses neither.
  - `useOptionalToast`: `DeckOutlineGenerator.jsx:54` and four R.A.B.B.I.T. views (`EntityListView.jsx:131`,
    `ProjectAssetsView.jsx:132`, `ProjectTasksView.jsx:127`, `ScenesView.jsx:216`).
  - JWT claims decoded by hand at `adapters/index.js:170-182` and `adapters/supabaseOtterAdapter.js:135-146`, beside
    `src/cloud/auth/WorkspaceSwitcher.jsx:66` `decodeJwtClaims`, `src/permissions/usePermissions.js:61` `readClaims`
    and `src/App.jsx:228`.
  - The same MB formatter at `references/useReferences.js:58` and `references/ReferencesCard.jsx:57`
    (`referenceModel.js:665` rounds up on purpose and is not a copy).
- **Fix shape:** import the shared helpers; export `useOptionalToast` from `src/ui` and one `decodeJwtClaims` from `src/cloud/auth`.
- **Recorded:** no.

---

## B. Redundant systems

### B1. D.O.G. has two prompt systems, and the one people can edit is never sent
**High** · MEASURED (each of the five values' only reader is its textarea; `git log -S '${singlePageInstructions}'`
finds no commit that ever sent it)
- **Where:** sent: the inline format, example and RULES at `DeckOutlineGenerator.jsx:1283-1400` (single page),
  `:1580-1665` (regenerate), `:1896-2062` (full deck): 371 lines in three variants that already differ (the
  regenerate copy lost rule 5's "more detail" override and rule 8's ratio guide; the full-deck copy has rules the
  others lack). Never sent: `prompts/singlePagePrompts.js:32-102` and `prompts/fullDeckPrompts.js:51-164` (OUTPUT_FORMAT
  and INSTRUCTIONS), `prompts/rules.js:1-268` (imported only by those INSTRUCTIONS), `prompts/imagePrompts.js:80-103`:
  475 lines. The drawer edits five of them (state `DeckOutlineGenerator.jsx:517-522, 573`; textareas `4999, 5034,
  5218, 5235, 5268`); the read-only VIS schema (`5252`) is a third hand copy of `export.js:92-115`.
- **What:** "Generation rules" and the three "Export schema" editors change nothing, though the Help says they do
  (`data/dogHelpContent.jsx:395-451`, `504-510`, `624-626`: *"Change 'max 4 sentences per section' to …"*). The two
  sent system prompts tell the model to "use the per-layout coordinate recipes" (`singlePagePrompts.js:22`,
  `fullDeckPrompts.js:30`) that exist only in `rules.js`, which never reaches the model; `rules.js:147` also says
  "TEXT FRAMES … do NOT include them" while every sent example includes text frames, which
  `correctGeometryIconOrder` (`parser.js:131`) relies on. Handbook §13.1 and the `wilson-app` skill
  (`geometry-and-layouts.md`) describe `rules.js` as what the model receives. The drawer's 15 hand-copied accordion
  blocks (`4971-5164`, `5207-5272`) add ~250 lines of JSX.
- **Fix shape:** one prompt builder that composes what is sent from the drawer's values, with defaults
  byte-identical to today's inline text (so no deck changes), or remove the five dead editors and their constants;
  drive the drawer from one table either way.
- **Rule:** the three export files and their structure are a contract (handbook §13.1); today's sent text must stay
  the default. **Recorded:** no.

### B2. O.T.T.E.R.'s library is fetched by two independent fan-outs, and a third for the quiz
**High** (runtime) · MEASURED (request counts from the code)
- **Where:** `Otter.jsx:656-710` `loadSoftwareList` (7 reads per course, then one full read per subject into
  `subjectCacheRef`) and `:712-753` `selectSoftware(slug, true)` (the same 7 plus per-subject reads);
  `petKnowledge.js:482-620` `loadKnowledgeIndex` (per course the subject list and 3 documents, one full read per
  non-stub subject, the share list; once per 5 minutes); `Otter.jsx:2742-2767` `loadQuizSelectionData` (2 reads per
  course on every quiz open, after copying the same data from `softwareCacheRef` at `2745-2748`).
- **What:** three loaders of the same course data. With C courses and S subjects, O.T.T.E.R.'s mount makes
  1 + 7C + S reads and the pet's first content question up to 1 + 4C + S + 1 more: with her six courses
  (`petKnowledge.js:522`) and, as the project records them, 49 subjects, 92 reads at launch and up to 75 again. On
  the Local Server every subject list re-reads and REWRITES every subject file of that course
  (`electron/main.cjs:796-821`, called by the GET at `824-829`); the pet budgets for that (`petKnowledge.js:477-480`),
  O.T.T.E.R.'s own loaders do not.
- **Fix shape:** one per-identity library loader (module-level, as the pet's already is) that O.T.T.E.R., the pet and
  the quiz picker all read, and a Local Server list that writes only when an order actually changes.
- **Rule:** the pet's index stays per identity and cleared on identity change, and linked subjects never enter
  O.T.T.E.R.'s caches (design §5.4); a shared loader must keep both. **Recorded:** no.

### B3. The four O.T.T.E.R. document merges exist twice, once per backend
**Medium** · MEASURED
- **Where:** `electron/main.cjs:950-1001` (hotkeys), `1044-1077` (`mergeFunctionsDoc`), `1084-1104` (`migrateNodesData`),
  `1112-1142` (nodes), `249` (`slugify`); `adapters/otterRoutes.js:383-445, 449-472, 474-489, 491-509, 608-614`.
- **What:** about 150 lines written twice "line for line" (`main.cjs:951-954`), kept equal by parity tests
  (`adapters/hotkeysMerge.test.js`, `functionsMerge.test.js`); the nodes pair has no parity test, and its keying
  defect sits in both copies.
- **Fix shape:** one merge module both sides load (a `.cjs` that `main.cjs` requires and Vite imports, or the ESM one
  loaded in the main process with `import()`).
- **Recorded:** only as "both copies" in S2b-02's closing note and N1-03 (the nodes keying), not as a redundancy.

### B4. D.O.G. keeps each slide's text in two stores and under two undo stacks
**Medium** · MEASURED (counts)
- **Where:** `DeckOutlineGenerator.jsx:109` `openTabs[].content` and `:128` `history[].output`; 13 `setOpenTabs` and
  13 `setHistory` writes, paired at `1512/1524, 1752/1759, 1807/1814, 1852/1859, 2216/2228, 2329/2333, 3573-3574,
  3588-3589, 3608-3609, 3624-3625, 3630-3631`; text undo (refs `581-585`, `2501-2565`, 14 deep) and regeneration undo
  (`543-544`, `1789-1876`, 8 deep) over the same text; a third stack for history deletes (`129-130`, `3569-3633`).
- **What:** each keystroke copies both arrays (`updateTabContent`, `2327-2336`); one missed pair and the open tab no
  longer matches what Export writes; two undo buttons undo the same slide by different rules.
- **Fix shape:** one slide store keyed by id (tabs hold ids) and one per-slide history for edits and regenerations.
- **Recorded:** no (P1-04, D.O.G.'s Ctrl+Z acting from other pages, is related and already recorded).

### B5. Two ways to read an O.T.T.E.R. response
**Medium** · MEASURED (grep counts)
- **Where:** defensive: `components/otterSharing.js:292-296` `readBody` and `:304-314` `shareCall`;
  `components/ShareCourseDialog.jsx:57-61` (`readBody`, a verbatim copy); `petKnowledge.js:396-409` `readJson`.
  Direct `res.json()` before or without `res.ok`: 82 sites — `Otter.jsx` 58, `RequestsView.jsx` 9,
  `ChangeRequestDialog.jsx` 5, `Validator.jsx` 4, `ShareCourseDialog.jsx` 1,
  `src/components/AdminTerminal/ChangeRequestsSection.jsx` 5.
- **What:** the house rule (`otterFetch` resolves for every status, and a non-JSON error body turns the authored
  refusal into a SyntaxError: `ShareCourseDialog.jsx:45-56`) lives in three private helpers and is skipped by the
  other 82 reads.
- **Fix shape:** export one reader in `shareCall`'s shape from `adapters/` and use it at every `otterFetch` site.
- **Recorded:** no.

### B6. The help role tables are four copies of two tables
**Low** · MEASURED
- **Where:** `src/components/HelpPage.jsx:45-59` (L); `data/dogHelpContent.jsx:35-71` (D) and `73-109` (L);
  `data/otterHelpContent.jsx:24-34` (L) and `44-53` (D); `src/tools/rabbit_v0.1.0/rabbitHelpContent.jsx:106-115` (L) and `127-136` (D).
- **What:** each says it is "key for key HelpPage's"; O.T.T.E.R.'s and R.A.B.B.I.T.'s light tables are byte-identical
  and their dark ones differ in one key; they drifted once already (`otterHelpContent.jsx:15-23`); the default theme
  is dark in `DogHelpContent` (`:112`) and light in `OtterHelpContent` (`:56`). (HelpPage also writes its own
  R.A.B.B.I.T. pages instead of using `RabbitHelpContent`: outside this area.)
- **Fix shape:** one `helpTheme.js` exporting the light and dark role sets, D.O.G.'s extra keys included.
- **Recorded:** no.

### B7. The two tool stylesheets repeat the same declaration blocks
**Low** · MEASURED (blocks of 3+ declarations compared with declarations sorted)
- **Where:** `dog.css` and `otter.css`, e.g. `.dog-mode` = `.otter-val-queue-line`, `.dog-head-icon` = `.otter-group-icon`,
  `.dog-rewrite-text` = `.otter-req-feedback-text`, `.dog-history-layout` = `.otter-finding-source`.
- **What:** 30 identical blocks (131 declarations) across the two files; 14 repeats inside `dog.css`, 58 inside `otter.css`.
- **Fix shape:** the shared row, caption and icon patterns as kit classes.
- **Recorded:** no.

---

## C. Inefficiencies

### C1. Both tools re-render whole, off screen too, on unrelated typing and edits
**High** · INFERRED (would settle: React Profiler while typing in the pet, with a slide preview and a lesson open)
- **Where:** `src/App.jsx:1039-1043` (the pet's chat input is App state, set per keystroke via
  `PetCompanion.jsx:219`), `2596-2625` and `2943` (every page rendered on each App render), the tool roots not
  memoized (`*/index.jsx`); `DeckOutlineGenerator.jsx:151` `useRabbit()` over RabbitProvider's whole value
  (`src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx:8594-8930`, deps include `bundle`, `adapterStatus`,
  `presentUsers`, `realtimeStatus`, `undoToast`), of which D.O.G. reads six fields; `Otter.jsx:468` `useAgent()` over a
  value rebuilt on every AgentProvider render (`src/agent/AgentProvider.jsx:542-566`, `agentInput` included), which
  also unregisters and re-registers O.T.T.E.R.'s agent tool each time (`Otter.jsx:595-597`, dep `agent`).
- **What:** each keystroke in the pet (chat or agent mode), each R.A.B.B.I.T. edit, each presence or realtime change
  re-renders the 5,533-line and 6,402-line components, visible or not. What one render costs is C2 and C3. D.O.G.'s
  own comment (`167-173`) records the provider's churn but guards only one effect from it.
- **Fix shape:** `React.memo` both tool roots (their props are stable), memoize AgentProvider's value, and give D.O.G.
  a narrow projects selector instead of the whole provider.
- **Recorded:** no.

### C2. O.T.T.E.R. rebuilds all seven views on every render, hidden ones included
**High** · INFERRED
- **Where:** `Otter.jsx:3484-3490`; the lesson body `5213-5244` (`ReactMarkdown` with an inline `components` object,
  an inline heading strip, a `SyntaxHighlighter` per fence); the Functions view `5778-5828` (`FunctionCard` per function,
  two highlighted wells each, `FunctionCard.jsx:41-52`); the Hotkeys table `5837-5901`; the Nodes view from `5910`;
  1-second progress timers at `1378, 1594, 1856, 2071, 2292`.
- **What:** every render re-parses the open lesson's markdown, re-tokenises every code block and every function well
  (her Python library: 46 functions, 92 wells, by S2c's count in OUTSTANDING S2b-05's closing note) and rebuilds the
  reference tables, for all seven views, hidden or not; during any generation the timers make that once a second,
  also while O.T.T.E.R. is off screen; C1 adds a render per pet keystroke.
- **Fix shape:** memoize the lesson body on its content and make the reference views memoized components keyed on
  their data (the hidden-not-unmounted layout can stay).
- **Rule:** Requests and Validator stay conditionally mounted and the Validator hidden, never unmounted (handbook
  §13.2). **Recorded:** no.

### C3. LayoutVisualizer remounts its media on every render
**High** · INFERRED (the P1-16 symptom is MEASURED)
- **Where:** `LayoutVisualizer.jsx:435` `ImagePlaceholder` and `:573` `IconLogoPlaceholder` declared inside the render
  (9 and 12 uses); `VideoThumbnail.jsx:7-28`; data URLs rebuilt at `LayoutVisualizer.jsx:482` and `636-638`; the parse
  and two logs per render at `:10`, `parser.js:92`, `:68`; memos keyed on per-render arrays at `:136` and `:426`;
  the default `placementAssets = []` (`:9`) feeding the effect at `:618-642`; `modals/DuplicateResolverModal.jsx:182`
  mounts it without `placementAssets`.
- **What:** a new component type per render makes React unmount and remount every placed picture and video, so each
  parent render re-decodes the pictures and, for a video, builds a `<video>` from the full base64 data URL and draws
  a frame again; the slide is re-parsed and logged twice; the two memos never hit. With the default `[]` the effect
  sets a new `{}` every render, a loop: the likely cause of P1-16.
- **Fix shape:** hoist the two components to module scope, memo the parse on `content`, `React.memo` the visualiser,
  a module-level empty-array default, and one object URL per asset.
- **Recorded:** the symptom is already recorded as P1-16 ("Maximum update depth exceeded" when the duplicate
  resolver previews); its cause is not.

### C4. O.T.T.E.R. re-reads whole courses after every write, and the desktop rewrites every subject on each read
**Medium** · MEASURED by reading (requests per path)
- **Where:** `Otter.jsx:1589` and `1622` (the stub read twice before generating), `1809-1812` and `1837-1839`
  (`invalidateCache` + `selectSoftware(…, true)` twice, plus `selectSubject`), `712-753`; `electron/main.cjs:796-821`.
- **What:** after one subject generation the client re-reads the course's 7 documents and every subject body twice
  and reads back the subject it has just posted (`updatedSubject`, `1738`): up to 35 reads for one write on a
  10-subject course, and on the Local Server each of the two subject lists rewrites every subject file.
- **Fix shape:** put the saved subject and the merge routes' returned documents into the caches and drop the forced reloads.
- **Recorded:** no.

### C5. The full Prism grammar set ships in the main chunk
**Medium** · MEASURED (`node_modules`); the saving in the minified chunk is INFERRED
- **Where:** `Otter.jsx:5`, `FunctionCard.jsx:1`, `src/components/PetCompanion.jsx:4`,
  `src/components/Resources/FilePreviewDialog.jsx:49`; `otterLanguage.js:84`.
- **What:** `Prism` pulls `refractor/all`, 297 grammars and 935,047 bytes of grammar source, where O.T.T.E.R. names 26
  languages. App imports both tools statically (`App.jsx:52-53`) and mounts them at launch, so `React.lazy` on the
  tools gains nothing; the help bodies (`dogHelpContent.jsx` 949 lines, `otterHelpContent.jsx` 415) open only in
  dialogs and could load on first open, and B1's 475 unsent prompt lines ship too. Monaco is fetched at run time by
  `@monaco-editor/react`'s default loader (no `loader.config` in `src`), not bundled (INFERRED).
- **Fix shape:** `PrismLight` with the 26 languages registered (`otterLanguage.js` already maps them) and
  `prism-async-light` for FilePreviewDialog's arbitrary files.
- **Recorded:** no.

### C6. O.T.T.E.R.'s search rebuilds the whole library's text on every keystroke
**Medium** · INFERRED
- **Where:** `Otter.jsx:3738` (`performSearch` on each change), `3088-3270`.
- **What:** no debounce and no index: each keystroke lowercases the full text of every lesson, hotkey, function and
  node, awaits uncached subject reads one at a time inside the loop (an older, slower search can land after a newer
  one), and puts each matching lesson's whole text into state.
- **Fix shape:** a lowercase index rebuilt when the caches change (A8's rows plus the lesson text), a short debounce,
  and stale results dropped.
- **Recorded:** handbook §17 states search runs per keystroke (as the reason linked subjects are not searched); not
  recorded as a cost.

### C7. D.O.G. turns files into base64 it does not use, and back again
**Low** · INFERRED
- **Where:** `DeckOutlineGenerator.jsx:390-417` (the New project window reads every file as a data URL), `471-499` (a
  backend with a file store uploads `f.raw`), `5511-5512` (only image thumbnails read `content`); `1171-1181`
  (`ensureAIFileId` turns the base64 back into a Blob via `base64ToBlob`); `references/useReferences.js:64-79`
  (`blobToDogContent`, a downloaded Blob to base64).
- **What:** on the cloud and the Local Server a document or video added in the New project window is held whole as a
  base64 string nothing reads; an upload or a chosen file goes File/Blob → base64 → Blob before the AI store sees it,
  a third more memory at each step.
- **Fix shape:** keep the File/Blob and make base64 lazily for placement, page counting and export; object URLs for thumbnails.
- **Recorded:** no.

### C8. Smaller hot-path waste in D.O.G.
**Low** · MEASURED
- **Where / what:**
  - 21 `console.log` in `DeckOutlineGenerator.jsx`, including the whole API response (`2151`) and the full raw output
    (`2245`), plus one per `parseSlideContent` call (`parser.js:92`) and per visualiser render (`LayoutVisualizer.jsx:68`).
  - Constants rebuilt every render: `FORMATTING_PRESERVATION` and `DEFAULT_REWRITE_PROMPTS` (`588-603`),
    `REWRITE_LABELS` (`2339-2345`), `MODEL_DISPLAY_NAMES` (`3699-3704`).
  - Three document keydown listeners removed and re-added on every editor keystroke (`3131-3154` dep `activeTab`,
    `3157-3192` dep `openTabs`, `3244-3267` dep `generatePageOutline`, which depends on `history`).
  - The project dropdown re-lists every project on focus and again on change (`4209-4210` →
    `RabbitProvider.jsx:766-775`, unthrottled), and each list gives the provider's value a new identity (C1).
  - Single page and regenerate parse every history slide twice per call (`1422-1440`, `1688-1703`).
- **Fix shape:** module constants, handlers through refs, logs behind a debug flag (or dropped in the build), and the
  projects re-listed on open only when stale.
- **Recorded:** no (P1-04 covers the same listeners' page gating, not their churn).

---

## D. Exports with no caller

**Low** · MEASURED. Method: the 251 named exports of the area's 46 non-test modules (`export function|const|let|class`
and `export { … }`) were each grepped case-insensitively as a word across `WILSON/` (tracked files; tests, docs and
markdown excluded), outside their own file. 51 have no importer outside their own file except tests.

- **No reader at all (1):** `CORE_LABEL` — `references/ReferencesCard.jsx:224`; the same words are hard-coded at `:463` and `:470`.
- **Read only by a test, dead in production (3):** `pdfPagesFromBinary` — `references/referenceModel.js:791` (a copy of
  the clear-text half of `countPdfPages`, `822-824`); `isLinkKey` — `components/otterSharing.js:215`;
  `_peekPetKnowledgeCache` — `petKnowledge.js:384` (a stated test seam: by design).
- **Used only inside their own module, no test either; the `export` can go (12):** `parser.js:105` `TITLE_LAYOUT_NAMES`;
  `referenceModel.js:657` `PDF_PAGE_LIMIT`, `:659` `PDF_BYTE_LIMIT`, `:660` `IMAGE_BYTE_LIMIT`; `ReferencesCard.jsx:52`
  `rowLabel`, `:60` `meterSentence`, `:151` `uploadSize`, `:236` `coreLine`; `useReferences.js:61`
  `PREVIEW_IMAGE_MAX_BYTES`, `:64` `blobToDogContent`, `:90` `readPoolLists`; `otterSharing.js:469` `liveChildren`.
- **Used inside their module and imported only by tests, a test surface (35):** `aiFileCache.js` `AI_FILE_TTL_MS`;
  `enterGenerates.js` `ENTER_PRESSES`, `GENERATE_TOGGLES`; `referenceModel.js` `isDeckReferenceFile`, `readableType`,
  `coreLabel`, `REFERENCE_TOKEN_LIMIT`, `IMAGE_TOKEN_ESTIMATE`, `PDF_PAGE_TOKENS`; `ReferencesCard.jsx` `UPLOAD_ACCEPT`,
  `UPLOAD_LIMIT`, `focusAfterRemove`, `CORE_TITLE`; `adapters/otterRoutes.js` `mergeCorrections`, `mergeReferenceUrls`,
  `flattenNodesForMerge`; `otterSharing.js` `VISIBILITY_ORDER`, `NOT_A_MEMBER_WORDS`, `shareFailureText`, `viaLabel`;
  `FunctionCard.jsx` `CodeWell`; `otterLanguage.js` `COURSE_LANGUAGES` (stated "Exported for its test");
  `petKnowledge.js` `MAX_BLOCK_CHARS`, `MAX_LESSON_CHARS`, `TRUNCATION_MARK`, `queryStems`, `matchedStems`,
  `requiredCoverage`, `looksLikeContentQuestion`, `shouldRetrieve`, `isRetrievableCourse`, `rankSubjects`, `rankDocRows`,
  `rankLessons`, `buildKnowledgeBlock`.
- **Not exports, but dead in the area:** `LayoutVisualizer.jsx:79-104` `updateField` (never called); the five drawer
  states of B1; the two unused colour imports at `DeckOutlineGenerator.jsx:17`; O.T.T.E.R.'s duplicate-found dialog
  (already recorded as P1-13); `otterContext`'s value (already recorded: *"`otterContext` is written on every O.T.T.E.R.
  navigation and read by nothing"*); `DOG_ATTACHMENT_MAX_FILES` / `_MAX_MIB` in `deckAttachments.js` (already recorded as N1-01).

---

## Not redundant, by design

1. Every AI call goes through `callAI` and ai-proxy (`src/cloud/aiProxy.js`). D.O.G.'s `max_tokens` continuation loop
   (`DeckOutlineGenerator.jsx:2132-2198`) and O.T.T.E.R.'s `pause_turn` resume (`Otter.jsx:1242-1249`) answer different
   stop reasons; both stay. (Only the Validator's second `pause_turn` wrapper is a finding, A6.)
2. `extractTextAndCitations` (`Otter.jsx:1270-1307`) beside `textFromMessage`: it also needs the web-search sources
   and strips `<cite>` tags; its text is the last text block, the same rule.
3. The pet's knowledge index (`petKnowledge.js`) apart from O.T.T.E.R.'s caches: module-level, per identity, cleared
   on identity change, titles only with bodies read live per message, usable from every page. Only the duplicated
   fetch fan-out (B2) is a finding.
4. D.O.G.'s reference preview (`references/ReferencesCard.jsx:89-136`, what D.O.G. sends and its token cost) and the
   Resources `FilePreviewDialog` (the file itself) do different jobs.
5. FilePreviewDialog's markdown renderer (no raw HTML, links shown not followed, images named not fetched) differs
   from the lesson and pet renderers on purpose. (The lesson renderer, `Otter.jsx:5213-5244`, and the pet's,
   `PetCompanion.jsx:118-131`, do share one shape and could be one component; small.)
6. `LayoutVisualizer` re-derives the layout from the layout type and never reads the COMPONENT GEOMETRY JSON
   (handbook §13.1: do not "fix" it).
7. The two Core polarities (legacy `isCore !== false`, stored `is_core_definer === true`; `referenceModel.js:178-182`),
   pinned by migration 0075 and pgTAP 79.
8. `aiFileCache` (ids in the AI store, their owners and TTL) and `useReferences`' `bodyCache` (bodies read this
   session) cache different things.
9. D.O.G.'s two size rules: the 256 KB inline-or-file-store switch (`DeckOutlineGenerator.jsx:1218`) is transport, the
   200,000-token meter (`referenceModel.js:652`) a warning (design §4).
10. RequestsView and the Admin Terminal's change-request section as two surfaces, one `DOC_LABELS` (handbook §13.2);
    only their copied handlers are A3.
11. `otterFetch` returning a `Response` for ~90 call sites (handbook §13.2); its stringify-then-parse in cloud mode is
    the cost of that seam. (Its per-call `getSession` + JWT decode could be cached per sign-in change; small.)
12. The change-request document merge staying in client JavaScript, not plpgsql (handbook §13.2).
13. Linked subjects kept out of `subjectCacheRef`, `softwareCacheRef` and `quizSelectionData`, read by id at each use (design §5.4-5.5).
14. Hidden-but-mounted O.T.T.E.R. views, conditionally mounted Requests and Validator, and App rendering every page so
    state survives navigation: C1 and C2 are about the cost of re-rendering them, not the mounting.
15. The three export files and their structure (handbook §13.1 contract): the exporters are the source; the drawer's
    schema editors are the redundancy (B1).
16. `enterGenerates.js` as its own module (a testable Enter rule) and `referenceModel.js` (pure) beside
    `useReferences.js` (I/O), as DOG_REFERENCES_DESIGN §8 lays out.
17. The dark in-tool and light Help themes of the help content: two themes on purpose; only the copies of each role
    table are B6.
