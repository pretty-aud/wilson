# The read-only code review of 2026-10-31

**Her ask, verbatim:** *"review the overall code. DO NOT MAKE CHANGES. review the overall code. is there any existing redundancies. is there any functions or systems that are almost duplicates of each other. is there anywhere we can make things more efficient."*

**How it was done.** The integration tip (`0d33b17f`, then `ef415b47`, docs only between them) was read by five surveyors, one per area, each told to change nothing, to cite file and line, to check `docs/OUTSTANDING.md` first and to list what looks duplicated but is separate on purpose. The controller read all five reports, checked the claims that would change what she does against the code (marked **checked by the controller** below), and wrote this page. Nothing in the code was changed. The five surveys, with every finding and location, are in `docs/reviews/code-review-2026-10-31/`: `rabbit.md`, `dog-otter.md`, `shared-client.md`, `desktop-build.md`, `server-gateway.md`. Each ends with a "not redundant, by design" list; read it before acting on anything in that area.

**Counts.** 123 findings in all (five surveys of 23 to 25 each): about 47 near-duplicate functions, 30 redundant systems, 32 inefficiencies, 14 no-caller groups. Seven are correctness defects found along the way, recorded in OUTSTANDING as REV-01 to REV-07. Nothing here becomes a session unless she names it (plan §5, rule 8); the 1.0 gate (plan §0) is unchanged except where REV-01 enters the release steps by her ruling.

---

## 1. The short answer

**Yes to all three questions.** The code works, and its tests pass, but the same job is often written several times, and the same work is often done several times per screen or per request. The themes, largest first:

1. **Every change redraws the whole app.** Nothing under `src/` uses `React.memo`. The pet's chat text, its sleep animation and its timers live in the app root, and R.A.B.B.I.T.'s one provider value depends on the whole project bundle, so every keystroke to the pet, every timer tick and every edit re-renders every mounted page, D.O.G. and O.T.T.E.R. included, visible or not. O.T.T.E.R. rebuilds all seven of its views each time, re-parsing the open lesson and re-highlighting every code block. (rabbit C1, shared-client C1, dog-otter C1 and C2.)
2. **The same data is fetched many times.** The roster is fetched at least seven times at an admin's launch and held in five or more copies; a cloud project is loaded twice on open and every load reads every comment in the workspace; O.T.T.E.R.'s library is loaded by three separate loaders (about 92 reads at launch for her six courses); the rate card is read by nine independent hooks. (shared-client B1 to B3, rabbit C2, dog-otter B2.)
3. **On the desktop, every request handles the whole project file, synchronously.** One task edit is about 22 disk calls; 46 of 68 write sites rewrite all six mirror files whatever changed; listing a course's subjects rewrites every subject file. (desktop-build C1 and C2.)
4. **The database asks the membership question once per row.** 155 policies on 54 tables call the membership check per row although the row's workspace is already pinned; the upload quota sums every object of every company on each upload. (server-gateway C1 and C2.)
5. **One job, several implementations.** Scenes and Shots are drawn by twin components (about 560 lines shared); O.T.T.E.R.'s five generators are two copies of one pipeline (about 430 lines); `supabaseAdapter.js` repeats its own scaffolding (about 500 lines); Edge Function calls are written 17 times with nine error vocabularies; the three crypto modules in the functions are one file three times; the desktop asks "where is this project's folder" six ways; bytes are formatted eight ways, dates in six forms (already P1-34), the margin rule 14 times.
6. **The main bundle carries what is rarely used.** All 297 code-highlighting grammars (about 15 percent of the chunk) for the 26 languages O.T.T.E.R. names; the migration screens, the admin terminal and the notes editor loaded at every launch though they open on demand; 475 lines of prompt text that is never sent.

**What is deliberately double and must stay:** the money gate on both the row and the blob; the eight base plus eight money storage policies; the quota's two enforcement sites; the window guard, the IPC gate, the launch token and path containment as layered locks; the three adapters and the five-function storage providers; the CommonJS twins of renderer rules pinned by parity tests; the three master secrets; the refetch on channel join. Each survey names its own list.

---

## 2. Correctness defects found along the way (OUTSTANDING REV-01 to REV-07)

| Id | What | Basis | Her ruling / owner |
|---|---|---|---|
| REV-01 | **The operator console's company list fails.** `supabase/functions/operator-workspaces/index.ts` uses `PAGE` (lines 230–237, the `list` action; 655–667, teardown step 1d) but neither defines nor imports it; P8's commit `9bff662a` (2026-10-28) moved it to `_shared/teardownCollect.ts:50`. That commit is in the version deployed to staging (`3b471707`) and to dev. CI has no `deno check`. | checked by the controller (read, not run; `deno` is not on this machine) | her ruling of 2026-10-31, verbatim **"Record it, fix at the release steps"**: the import and a `deno check` of every function in CI, before runbook (g) 11; the controller then deploys the function to dev and staging on her go |
| REV-02 | **The budget's money rules disagree.** The agency percentage defaults to 20 when never set in `budgetVersionModel.js:189` and to 0 in `CrewTeamTab.jsx:123`, `useBudgetLines.js:228` and `BudgetView.jsx:890`; the Crew tab applies margin and contingency to the base plus the agency fee (`CrewTeamTab.jsx:197–200`) while `bidTotals` and the tested `budgetMath.js` apply them to the base. The tested rules (`effectivePct`, `applyMarginAndContingency`, `profit`) have no product caller. | checked by the controller (read, not run) | hers to place |
| REV-03 | **O.T.T.E.R.'s Validator reads the first text block of a reply** (`Validator.jsx:36`, `content.find(b => b.type === 'text')`) before its `pause_turn` check, so a web search that answers "Let me check…" first hands that sentence to the JSON parser. The house rule is `textFromMessage` (the last block); the guard test scans only for `content[0].text`. | checked by the controller | hers |
| REV-04 | **D.O.G.'s editable prompt boxes change nothing that is sent.** The single-page and full-deck instruction boxes write state read only by their textareas (`DeckOutlineGenerator.jsx:517–518` → `4999`, `5034`); what is sent is inline text at `1283–1400`, `1580–1665`, `1896–2062`, and `prompts/*.js` plus `rules.js` (475 lines) never reach the model, though the Help says they do. The theme prompt box is live (`:649`). | checked by the controller for the two instruction boxes; the survey says the same of the three export-schema editors | hers |
| REV-05 | **Forgot password can silently send nothing.** `ForgotPasswordWizard.jsx:50` resolves the username without the company; `resolve-login` answers a miss when a bare username exists in two companies, and the wizard shows its uniform "sent" screen. | the wizard's body checked by the controller; the two-company miss inferred from `resolve-login` (would settle it: one username in two companies on wilson-dev) | hers |
| REV-06 | **Listing a course's subjects on the Local Server rewrites every subject file.** `electron/main.cjs:796–821` (`renumberSubjects`, `writeJSON` per subject) runs on the GET at `:824`; O.T.T.E.R.'s warm-up calls it per course at launch and again for the quiz picker. A write on every read, through the in-place writer of REV-07. | checked by the controller | hers |
| REV-07 | **The project file's writer is not atomic.** `main.cjs:245` (`writeJSON`: `writeFileSync` in place, no retry) writes every bundle, mirror, setting and pet; a torn `project.json` reads back as nothing (`readJSON` swallows the parse error) and the project drops out of the list. `rendererStorage.cjs:182` already has the temp-file-then-rename, retried form. | checked by the controller (the writers); the torn-file outcome inferred | hers |

---

## 3. The biggest near-duplicates (A), with where they are

| Where | What is written more than once | Size |
|---|---|---|
| `rabbit/views/ScenesView.jsx:3367` and `:3877`; tables `:2006` and `:2715` | Scenes and Shots as twin components (80 percent shared), `EntityListView.jsx:1071` a third cousin | ~560 lines |
| `otter_v0.3.1/Otter.jsx:1367–2451` | five generators that are two copies of one pipeline, already drifted (`1724` vs `1953`); the slug regex inlined 8 times beside an imported `slugify` | ~430 lines |
| `rabbit/adapters/supabaseAdapter.js` | the "client ahead of its database" scaffolding four times; 15 inline copies of one error handler; two realtime subscribers at `5644` and `5738` almost identical; the tested payload normaliser (`realtimeMerge.js:413`) has no product caller | ~500 lines |
| `rabbit/views/EntityListView.jsx:131–415`, `ProjectAssetsView.jsx:132–449`, `ProjectTasksView.jsx:127–700`, `ScenesView.jsx` | the table-view glue around `useTableView` copied into four views | ~300 lines |
| `src/cloud/*Api.js` and eight inline sites | Edge Function calls: nine helpers plus eight inline copies, uneven time limits, nine error vocabularies | ~17 sites |
| `supabase/functions/_shared/aiKeyCrypto.ts`, `storageSecretCrypto.ts`, `gatewayKeyCrypto.ts` | the same envelope crypto three times (P8's versioning reached two of three) | ~110 lines |
| four storage functions | the S3 config and secret loaded and decrypted in four places | ~120 lines |
| `electron/main.cjs:1728` and `:2808`; `FileManager.jsx:724/862/909`; `entityFiles.js:104` | "where is this project's folder" six ways, two of which disagree on whether it must exist | 6 copies |
| `electron/main.cjs` and `rabbitBins.cjs` | six thumbnail generators; the atomic write and single flight landed in one | 6 copies |
| `rabbit/views/TimelineView.jsx:7058–7847` | six row builders per grouping kind, `sortTasks`/`sortPhases` re-declared in each | ~250 lines |
| `rabbit/views/budget/*`, `BudgetView.jsx`, `budgetVersionModel.js`, `useBudgetLines.js` | the money rules seven times (REV-02) | 7 copies |
| `migrations/0025:296` and `0064:513` | the change-request and nomination review triggers: one state machine twice | 2 copies |
| view-local copies | `InlineText`, `BulkSelect`, `ConfirmDialog`, `useOptionalToast`, `fmt`, `formatBytes` (8 ways), extension extractors (9), status lists (6) | ~300 lines |

## 4. Redundant systems (B)

- **Two prompt systems in D.O.G.** (REV-04): the drawer edits 475 lines nothing sends; the sent text is inline in three variants that already differ.
- **Three loaders of O.T.T.E.R.'s library** and a per-instance roster hook that fetches twice in cloud mode; **nine rate-card copies**; **two reads of each R.A.B.B.I.T. collection paged differently** (the bundle's folder read is unpaged while `listFoldersWith` pages: a project past 1,000 folders loses rows); **the project roster held twice** on the cloud.
- **Two update paths for entities**: four of the 0040 entities still send the whole cached row on every edit, the shape the adapter's own comment says "silently clobbered every field a collaborator changed".
- **Two upload transports on the desktop**: the base64 POST (`projectFileStream.cjs:174`) has had no caller since 2026-09-11; the 32 MiB migration ceiling and the 50 MB JSON limit rest on it. (M1-L7's hook was added to both routes, so the dead one carries it too.)
- **Two packagers** (`forge.config.cjs` ships nothing; `dist:publish` uploads nothing for a generic feed) and three Forge-only packages.
- **Hand-kept CommonJS twins** of about 2,000 lines of renderer rules, each pinned by a parity test: correct today, and every rule change is written twice; they could be generated from the ES modules at build time.
- **Three guards and `issue-session`** re-implement one caller check in the functions; responses and CORS in three families; three ways to read a request body, most of them unbounded.
- **Two S3 read signers with different authority** (already OSP-01).

## 5. Inefficiencies (C)

- **Whole-app re-renders** (theme 1): the fix shape is a pet host below the pages, a memoized agent value, `React.memo` on the prop-less pages and the two tool roots, a split of R.A.B.B.I.T.'s volatile state (presence, status, toasts) out of its one context value, and memoized lesson bodies in O.T.T.E.R.
- **Repeated fetches** (theme 2): one roster store, one rate-card store, one O.T.T.E.R. library loader, the project loaded once after the channel joins, comments read only for the project's rows.
- **The desktop's synchronous bundle handling** (theme 3): the bundle kept in memory keyed by path and mtime, a key projection on the project GET, mirrors written only when their keys change, the subject-list GET made read-only.
- **The database** (theme 4): `(SELECT has_active_membership(current_workspace_id()))` in the 155 policies so the check runs once per statement; the quota meter scanning each project's own key prefix; indexes on `files.storage_path` and `files.thumbnail_url` (Storage Cleanup can run up to 500 whole-table scans per click); an expression index for ai-files' reads of `app_events`; six overlapping indexes.
- **The bundle** (theme 6): `PrismLight` or the async highlighter (about 579 KB of grammars today); the migration panels, the admin terminal body and the notes editor loaded on first open; D.O.G.'s unsent prompt text removed or sent.
- **Smaller**: 21 `console.log` in D.O.G. including the whole model reply; three keydown listeners re-added per keystroke; the layout visualiser declaring components inside its render (every placed video decoded again per redraw; likely the cause of P1-16); O.T.T.E.R.'s search rebuilding the whole library's text per keystroke; secrets unsealed and keys re-derived per Edge call; CI downloading Electron in two jobs that never launch it; the pgTAP replay list hand-written for all 103 suites.

## 6. No caller (D)

Already censused by N1 (2026-10-27); what is new or still dead: `rabbitAgentTools.js` (a 220-line module nothing imports; already MASTER_PLAN §6 #56); the adapters' comment, asset-version, ingestion-chunk, folder-delete and rate-card-delete methods (features with no surface); the tested money rules (REV-02); `lightSurface.js` and five token aliases read by one test; the IPC channels `zoom-get` and `rabbit:write-gdrive-config` (so the app can never create Drive's config: hers to rule, a connect flow or the channel goes); `/api/migrate` and `/api/migration-needed` (a check and a no-op POST on every O.T.T.E.R. mount); the dead `window.rabbitDesktop` branch in `InvoiceAttachment.jsx`; about 15 scripts overlapping the two general tools (`ui-walk`, `a11y-walk`; `otter-library-replay` is worth keeping as a third); two unused `_shared` exports in the functions. Every Edge Function and every dependency has a caller; of 216 live SQL functions only `reorder_task_items` and two quota shims lack a real one, both kept on purpose.

## 7. What the controller checked itself

Read against the tip, not run: REV-01 (the missing import, the deployed version, the absent CI check), REV-02 (both divergences), REV-03 (the first-block read), REV-04 (the two instruction boxes' only readers; the theme box live), REV-06 (`writeJSON` inside the list route), REV-07 (the two writers), the double project load and the unfiltered comments read (rabbit C2), the unpaged folders read (rabbit B2), the base64 route's callers (desktop B2), the money rules' callers (`effectivePct`, `applyMarginAndContingency`, `profit`: none outside tests; `resolveRate` and `buildRoleRates` in use). Everything else stands as the surveys state it, each marked MEASURED or INFERRED with what would settle it.
