# R.A.B.B.I.T. review: redundancies, near-duplicates, inefficiencies, exports with no caller

Read-only review of the worktree `post-overhaul-merge` (detached at the integration tip), 2026-10-31. Nothing was changed.

Path shorthand: `rabbit/` = `WILSON/src/tools/rabbit_v0.1.0/`. Every other path is relative to `WILSON/`.

How things were measured:
- Counts come from grep over the tree.
- "Shared lines" = the non-comment, non-blank lines two blocks have in common after trimming (and, where stated, after renaming the entity word, e.g. Scene/Shot to X). It is a floor for near-duplicates, because renamed variables do not match.
- "Exact windows" = 8 consecutive non-trivial lines that appear more than once.
- Runtime costs were counted from the code (requests per action, scans per render). They were not timed in a running app, and each finding says which.

Every finding was checked against `docs/OUTSTANDING.md`, handbook §17, §12, §13.3 and `rabbit/db/README.md`. Where a finding is already recorded, it says so.

---

## Measured facts

- **Files in `rabbit/`:** 396 in total. 201 are tests and 195 are not: 100 `.js`, 85 `.jsx`, 8 `.css`, 2 `.md`.
- **Lines:** 96,200 in the non-test files, 77,371 in the tests.
- **Largest non-test files, by line count:**

| File | Lines |
|---|---|
| `rabbit/state/RabbitProvider.jsx` | 8,948 |
| `rabbit/views/TimelineView.jsx` | 8,096 |
| `rabbit/adapters/supabaseAdapter.js` | 5,832 |
| `rabbit/views/ScenesView.jsx` | 4,740 |
| `rabbit/views/BudgetView.jsx` | 3,286 |
| `rabbit/views/rabbitFiles.css` | 2,696 |
| `rabbit/views/ProjectAssetsView.jsx` | 2,410 |
| `rabbit/views/ProjectTasksView.jsx` | 2,229 |
| `rabbit/views/rabbitScenes.css` | 1,870 |
| `rabbit/views/EntityListView.jsx` | 1,773 |
| `rabbit/components/RelationsPanel.jsx` | 1,599 |
| `rabbit/views/BinsView.jsx` | 1,398 |
| `rabbit/views/rabbitBudget.css` | 1,387 |
| `rabbit/rabbitCssGuards.js` (a test helper) | 1,377 |
| `rabbit/views/TeamView.jsx` | 1,337 |
| `rabbit/components/FileManager.jsx` | 1,310 |
| `rabbit/adapters/localServerAdapter.js` | 1,306 |

- **`RabbitProvider` is one component** running from line 279 to 8,933: 228 `useCallback`, 64 `useRef`, 28 `useState`, 25 `useEffect` and 17 `useMemo`. It feeds one context value (`RabbitProvider.jsx:8594`).
- **That value has 75 `useRabbit()` / `useContext(RabbitContext)` call sites in 67 non-test files across the app.** They include D.O.G.'s `DeckOutlineGenerator.jsx`, `SettingsPage.jsx`, `ProjectsPage.jsx` and the Dashboard. `App.jsx:2596` renders every page at once.
- **No memoization and no virtualisation:** zero uses of `React.memo` in `rabbit/`, `src/ui/` or `src/components/`, and no list-virtualisation library in `package.json`.
- **Exact repeated blocks:** 8-line windows cover 968 lines across the 201 non-test files of `rabbit/`, `components/Resources`, `components/Budget` and `cloud/migrate`:

| File | Lines in repeated windows |
|---|---|
| `ScenesView.jsx` | 326 |
| `TimelineView.jsx` | 141 |
| `ProjectAssetsView.jsx` | 121 |
| `supabaseAdapter.js` | 93 |
| `EntityListView.jsx` | 76 |
| `ProjectTasksView.jsx` | 64 |

- **Adapters:**
  - The three adapters define 253 method/property names.
  - `googleDriveAdapter.js` contains 80 `readOnly(` occurrences.
  - `localServerAdapter.js` contains 98 hand-written JSON request literals, and 21 of its `list*` methods each fetch the whole project bundle.
  - The cloud `loadProject` runs 29 reads in parallel.
- **Build:** the only build output in the worktree (`WILSON/dist`, dated 2026-09-29, so stale) has a main chunk `assets/index-BrMi8IMi.js` of 3,919,097 bytes (1,125,537 gzipped). There is no `React.lazy` anywhere in `src/`, and `vite.config.js:53` raises `chunkSizeWarningLimit` to 2000.
- **Earlier export census:** N1 (2026-10-27, `docs/sessions/handoffs/po-n1-2026-10-27.md` list 4) already ran a full census of exports with no caller and removed 142 export keywords. Section D builds on it rather than repeating it.

---

## A. Near-duplicate functions

**A1. Scenes and Shots are drawn by twin components (and the Levels/Experiences popup is a third cousin).**
- **Severity:** High (about 560 lines).
- **Locations:**
  - `rabbit/views/ScenesView.jsx:3367` `SceneDetailPopup` and `:3877` `ShotDetailPopup`: 332 of 415 code lines shared after renaming Scene/Shot. That is 80%.
  - `ScenesView.jsx:2006` `SceneTable` and `:2715` `ShotTable`: 230 lines shared.
  - `ScenesView.jsx:2631` `SceneGallery` and `:3200` `ShotGallery`: 39 lines shared.
  - Handlers that each exist twice in the file: `handleUpdate` (3418 and 3918), `handleSetThumbnail` (3440 and 3937), `handleClearThumbnail` (3451 and 3948), `handleCreateTask` (3458 and 3955), and the `NewTaskSidePopup` mounts (3518 and 4014).
  - `rabbit/views/EntityListView.jsx:1071` `EntityDetailPopup` shares 151 lines with `SceneDetailPopup`.
- **What:** One "entity window" (name, status, dates, description and notes, thumbnail, relations, Files section, new-task side form) and one table/gallery are written once per kind. A fix to one window (focus, Escape, discard question) has to be made two or three times.
- **Fix shape:** One `EntityWindow` / `EntityRows` component, configured per kind the way `EntityListView`'s `entity` config already does for Levels and Experiences.
- **Basis:** MEASURED.

**A2. `supabaseAdapter.js` repeats its own machinery.**
- **Severity:** High (about 500 lines that could become about 150).
- **Locations:**
  - **"Client ahead of its database" scaffolding, written four times.** Each copy is a flag, a reset, an unavailable message, an error builder, a `require*`, a probe, `missing*` tests and its own unwrap:
    - 0084: lines 1002–1010, 1685–1765 and 1810–1830.
    - 0091: lines 1969–2033 and 2496–2526.
    - 0096: lines 2045–2073 and 2166–2200.
    - 0098: lines 2217–2252 and 2304–2327.
  - Inside that scaffolding, some pieces are byte-identical:
    - `missing0084Function` (1762) and `missing0091Function` (2030).
    - `shotListRefusal` (1860) and `binsRefusal` (2516).
    - `probeShotLists` (1698), `probeBins` (1987) and `probeTaskItems` (2064) differ only in which flag they set.
  - Three column probes with the same shape: `privateProjectsAvailable` (242), `fileMetaAvailable` (260) and `fileTagsAvailable` (276).
  - Fifteen inline copies of `unwrapOptionalTable`'s logic and its bookkeeping (`if (error) { if 42P01/PGRST205 return []; lastError=…; throw } lastError=null; lastSyncAt=…`):
    - `remoteViewsOfClip` 3890, `listFileEvents` 3929, `listEditHistory` 3988, `listProjectMembers` 4013, `listMyTasks` 4074.
    - `listPhasesByProjects` 4105, `listProjectMembersByProjects` 4125, `listNotes` 4148, `getNote` 4165, `saveNoteDoc` 4205.
    - `listNoteSubjects` 4233, `retagNoteSubject` 4267, `listTrashedMilestones` 4937, `getTableViewLast` 3247, `setTableViewLast` 3268.
  - Eight `restore*` methods, seven of them carrying the same five-line comment: 2913, 2938, 2963, 2988, 3872, 3974, 4324 and 4926.
  - The `log_file_downloaded` block three times: 3698, 3753 and 3853.
  - Eleven bins RPC wrappers with an identical shape: 5323–5627.
  - "write … select(); no row means 42501" eight times: 4518, 5057, 5300, 5369, 5383, 5522, 5536 (a DELETE) and 5567.
  - **`subscribeProjectChanges` (5644–5729) and `subscribeWorkspaceChanges` (5738–5820): about 85 lines each, differing only in the topic string and one guard.**
  - `writeProjectManifest` (4810) and `writeProjectRates` (4839).
- **What:**
  - Each new migration-gated feature copied the previous feature's scaffolding.
  - The realtime payload normalizer exists three times. The two live copies are inline at 5689–5694 and 5781–5786. The tested copy, `rabbit/state/realtimeMerge.js:413` `normalizeBroadcastPayload`, has no product caller (see D1). So the tests pin a copy, not the code that runs.
- **Fix shape:** Use a `schemaFeature({ migration, code, message, tables, fns })` factory, one `pgError()` / `readTolerant()` pair, a `subscribeTopic(topic, cb, opts)` helper that calls `normalizeBroadcastPayload`, and `softDelete(table)` / `restore(table)` builders.
- **Constraints:** none. The flags must still survive auth events (lines 140–151), and a factory keeps that.
- **Basis:** MEASURED.

**A3. The table-view glue is copied into four views.**
- **Severity:** High (about 300 lines).
- **Locations:**
  - `rabbit/views/EntityListView.jsx:131–415`
  - `rabbit/views/ProjectAssetsView.jsx:132–449`
  - `rabbit/views/ProjectTasksView.jsx:127–700`
  - `rabbit/views/ScenesView.jsx:216, 389–438, 1085–1091`
  - Shared code lines measured: Entity and Assets 100 of 168/181; Assets and Tasks 95; Entity and Tasks 73.
- **What:** Each view re-declares the same pieces around `useTableView`:
  - `useOptionalToast`, `rosterById` / `nameOf`, `notify`, `useAsk`
  - the announce live region, `dropFailure`, the `focusGroupMenu` effect (only the CSS selector differs), `focusViews`
  - the "remove old saved views" effect
  - the config destructuring (`viewMode` / `filters` / `sorts` / `firstSort` / `groupBy` / `hideEmpty`)
  - `setViewMode`, `setGroupBy`, `setSortField`, `reverseSort`, `addFilter`, `updateFilter`, `removeFilter`
  - the search-then-filter-then-sort memo, `savedOf`, `removeGrouping`, `fieldList` / `columns` / `cardShows`
  - `kindKept` / `canDrag` and the absent-links announce effect
- **Fix shape:** One `useTableScreen({ ctx, tableKey, description, rows, canWrite, toolbarSelector })` hook beside `useTableView` that returns those pieces.
- **Basis:** MEASURED.

**A4. The money rules run in seven places, and they no longer agree.**
- **Severity:** High (correctness risk on bids, not only size).
- **Locations:**
  - `components/Budget/budgetMath.js:26` `effectivePct`, `:45` `applyMarginAndContingency` and `:62` `profit`. These are tested, and no product code calls them.
  - `rabbit/state/budgetVersionModel.js:189` `projectBudgetSettings` (agency `?? 20`) and `:206` `bidTotals`.
  - `rabbit/state/selectors.js:73` `selectProjectBudgetRollup` (base only).
  - `components/Budget/useBudgetLines.js:228–268` (agency `?? 0`).
  - `rabbit/views/budget/CrewTeamTab.jsx:123` (agency `?? 0`) and `:189–200`.
  - `rabbit/views/BudgetView.jsx:890–945` `TopsheetRollup.crewData` (agency `?? 0`; recomputes CrewTeamTab's `rateMap`, `bidDaysByRole` and per-member subtotal).
  - `rabbit/views/budget/ClientViewTab.jsx:125–191`.
  - `round2` is defined twice: `budgetMath.js:150` and `budgetVersionModel.js:82`.
- **What:** "base = days × rate, margin and contingency each on the base, agency fee on top" is written seven times.
- **Divergences visible in the code** (inferred from the code, not run):
  - **The agency percentage defaults differently.** It defaults to 20% in the Summary waterfall and in bid snapshots, and to 0% in the line computations, the Topsheet and the Crew tab. A project created with the agency on and no percentage typed (`IntakeWizardView.jsx:211` sends none) reads both ways.
  - **Margin and contingency use different bases.** The Crew tab applies them to `bidTotal = subtotal + agencyFee`, which compounds the fee. The tested rule and `bidTotals` apply them to the base, which handbook §17 states as the rule.
  - **Rounding differs.** Only `bidTotals` rounds to cents.
- **Already recorded:**
  - The tested-but-unused copy is noted in N1's hand-off, list 4: "the four Budget views still run inline copies, untested". It is not an OUTSTANDING entry.
  - The Summary's zero Budget tile is already recorded in handbook §17 (Correctness).
- **Fix shape:** Make `budgetMath.js` (with `bidTotals` / `projectBudgetSettings` moved into it) the one module every Budget surface calls, with the agency default decided once.
- **Basis:** MEASURED for the copies; INFERRED for the divergences.

**A5. The Timeline builds rows per kind in near-copies, and keeps its own copy of the combination-grouping rule.**
- **Severity:** Medium (about 200–300 lines).
- **Locations:**
  - Row builders in `rabbit/views/TimelineView.jsx`: `buildRows` 7058, `buildRowsByTeam` 7201, `buildRowsByAsset` 7336, `buildRowsByScene` 7491, `buildRowsByLevel` 7734, `buildRowsByExperience` 7847.
  - `sortTasks` / `sortPhases` are re-declared inside each builder: 7083, 7207, 7341, 7507, 7746, 7859. These are exact windows.
  - Overlap measured: Asset and Level builders share 85% of their lines; Level and Experience share 66%.
  - `bucketByCombination` (6784) re-states `rabbit/views/tableViews/combinationGroups.js` `combinationGroupsOf`, which handbook VW1e calls "one rule for every table".
  - `OverviewBar` (2412) and `DetailBar` (4271) share 51 of `OverviewBar`'s 80 code lines (drag handling).
- **What:** Each grouping kind re-implements bucket, sort, push rows and drop zone. The Timeline's bucketing differs from the tables' in label collation and key function, so the same grouping can be ordered differently on the two screens.
- **Fix shape:** One `buildRowsByKind(kind, …)` over `combinationGroupsOf`, with `sortTasks` / `sortPhases` hoisted to module scope.
- **Basis:** MEASURED.

**A6. View-local copies of small UI primitives.**
- **Severity:** Medium (about 300 lines across 17 copies).
- **Locations:**

| Primitive | Copies | Overlap |
|---|---|---|
| `CellInlineText` | `ProjectAssetsView.jsx:2373`, `ProjectTasksView.jsx:2166` | 86% |
| `BulkSelect` | `EntityListView.jsx:1639`, `ProjectTasksView.jsx:1379`, `ProjectAssetsView.jsx:1064` (as `AssetBulkSelect`), `ScenesView.jsx:4452` (as `SceneBulkSelect`) | 86% (Scenes 45%) |
| `ConfirmDialog` | `EntityListView.jsx:1448`, `ScenesView.jsx:4412` | 89% |
| `InlineText` | `EntityListView.jsx:1665`, `ProjectAssetsView.jsx:2328`, `ScenesView.jsx:4481` | about 47% |
| `PopupInlineText` | `TaskDetailPopup.jsx:756`, `EntityListView.jsx:1724`, `ScenesView.jsx:4545` | 62% |
| `FieldLabel` | `EntityListView.jsx:1767`, `ScenesView.jsx:4734` | |
| `useOptionalToast` | 4 copies (see A3) | |

- **What:** The kit (`src/ui`) has no inline-edit, bulk-select or confirm primitive, so each view grew its own.
- **Already recorded:** The focus defect these inline editors share is already recorded as P1-06 (the defect, not the duplication).
- **Fix shape:** Promote one `InlineText` (with cell and popup variants), one `BulkSelect` and one confirm (or `useAsk`) into `src/ui`.
- **Basis:** MEASURED.

**A7. The provider writes each entity's mutators by hand.**
- **Severity:** Medium (about 250 lines).
- **Locations:**
  - `rabbit/state/RabbitProvider.jsx:4048–4128` (`addLevel` / `updateLevel` / `deleteLevel`) and `:4131–4211` (the Experience three) are verbatim twins: only the collection key and the noun differ.
  - `updateScene` 3822, `updateShot` 3977, `updateLevel` 4075 and `updateExperience` 4158 share one body.
  - `addScene` 3758 and `addShot` 3925 differ only in the collection and the list-link field.
- **What:** This is the same twin that B4c folded on the view side (`EntityListView.jsx:11–15`, "a verbatim twin that differed only in the entity's words") but left in the provider.
- **Fix shape:** A `makeEntityMutators({ collection, kind, adapterUpsert, adapterDelete })` factory used for the four 0040 entities.
- **Basis:** MEASURED.

**A8. `localServerAdapter.js` spells out its request options 98 times.**
- **Severity:** Medium (about 200 lines).
- **Locations:**
  - `rabbit/adapters/localServerAdapter.js:290–1281`: 98 copies of `{ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(…) }`.
  - `cloudBinFileThumbnailBase64` (1258) rebuilds by hand the query string `cloudBinFileThumbnailUrl` (1227) already builds.
- **What:** Boilerplate. A header or body change has 98 places to miss.
- **Fix shape:** One `sendJson(url, method, body)` beside `jfetch`, and the base64 reader calling the URL builder.
- **Basis:** MEASURED.

**A9. Several I/O routines are written twice, and some copies have drifted apart.**
- **Severity:** Low (small code, real drift).
- **Locations:**
  - **Download:** `rabbit/components/FileManager.jsx:822` `handleCloudDownload` re-implements `components/Resources/fileActions.js:54` `downloadCloudFile`. The latter's own header names FileManager as its source.
  - **Receipt and invoice open:** `rabbit/views/BudgetView.jsx:2826` `openFile` and `components/Budget/InvoiceAttachment.jsx:108` `handleOpen` are declared twins, and they diverged. BudgetView dropped `'noopener'` and checks the null `window.open` (merge review C-R1-02); InvoiceAttachment still passes `'noopener'` and checks nothing. Each also reads the project's **whole** file list (`adapter.listFiles`) to find one row by id.
  - **Holiday CSV:** `rabbit/holidays.js:147` and `rabbit/views/TimelineView.jsx:6002–6011` write the holiday CSV outside `src/lib/csvExport.js`, the "one writer" of handbook §12.5. So it has no BOM, no quoting and no formula-injection guard, and it revokes the object URL synchronously after the click. That is the S27 trap that `csvExport` and `fileActions` both avoid.
  - **The migration re-implements adapter routines:**
    - `cloud/migrate/runMigration.js:327` `cloudLocksLegal` repeats `supabaseAdapter.js:310` `legalFilesAvailable`.
    - `:596–602` (the JPEG check) and `:609` `uploadPoster` repeat `posterBytesFrom` (2540) and `postBinFileThumbnail` (5459).
    - `:2366` re-declares `managedStreamUrl`, which `rabbit/storage/managedVideoThumbnail.js:51` exports.
- **Fix shape:**
  - FileManager and both receipt opens call `fileActions` (and read the row from `ctx.files`, not a full list).
  - The holiday export goes through `csvExport.downloadBlob`.
  - The migration imports the adapter's helpers.
- **Basis:** MEASURED.

**A10. Small helpers are re-typed across files.**
- **Severity:** Low.
- **Locations and what:**
  - **`fmt` (underscores to spaces), 8 copies,** each the same as the kit's `humanizeStatus` (`src/ui/StatusDot.jsx:48`): `NewTaskPopup.jsx:49`, `RelationsPanel.jsx:69`, `TaskDetailPopup.jsx:73`, `EntityListView.jsx:152`, `IntakeWizardView.jsx:45`, `ProjectAssetsView.jsx:175`, `ProjectTasksView.jsx:242`, `TeamView.jsx:111`.
  - **`formatBytes`, 5 copies with three different roundings:** `cloud/workspaceStorage.js:172` (whose comment says "two roundings of the same number, side by side, read as a bug"), `rabbit/bins/binMedia.js:139`, `rabbit/components/FileManager.jsx:68`, `rabbit/components/ProjectFilesTable.jsx:97` (caps at MB, so 50 GiB reads "51200.0 MB"), `rabbit/storage/uploadNotices.js:85`.
  - **`formatDuration`, 2 copies:** `binMedia.js:128` gives "00:12" and `storage/mediaMetadata.js:70` gives "0:12" for the same clip.
  - **9 file-extension extractors with three return shapes:** `binMedia.js:64`, `bins/gatewayMedia.js:41`, `intake/pipeline.js:132` (identical to `views/intake/IntakePrepare.jsx:28`), `FileThumbnail.jsx:71`, `entityFiles.js:29`, `mediaMetadata.js:31`, `uploadNotices.js:92`, `ProjectFilesTable.jsx:110`.
  - **Two `isMediaFile` with opposite meanings:** `ProjectFilesTable.jsx:124` means image or video; `mediaMetadata.js:53` means video or audio.
  - **Status and priority lists:** task statuses defined 6 times, entity statuses 5 times, priorities 6 times. Examples: `TaskDetailPopup.jsx:63`, `NewTaskPopup.jsx:42`, `RelationsPanel.jsx:437`, `ProjectAssetsView.jsx:116`, `tableViews/tasksTableView.js:29`, `EntityListView.jsx:111`, `cloud/migrate/migrationRows.js:640`.
  - **Code-unit comparator, 4 copies:** `localServerAdapter.js:107`, `budgetVersionModel.js:102`, `taskItemsModel.js:111`, `tableViews/combinationGroups.js:35`.
  - **"A task's phase is its own, else the one its assets share", 3 copies:** `BudgetView.jsx:529`, `TimelineView.jsx:6742–6760`, `components/Dashboard/dashboardTaskModel.js:232` (`taskPhaseKey`). `taskItemsModel.js` is meant to be the rules' one statement.
  - **The task-template application loop appears twice:** `ProjectAssetsView.jsx:1517–1566` and `:1785–1846`. Its UTC date arithmetic is already recorded as P1-32a.
- **Already recorded:** the date formatters (`FileManager.jsx:75`, `ProjectFilesTable.jsx:104`, `ProjectFilesExplorer.jsx:201/213`) are already recorded as P1-34, and `rabbit/dates.js` `showDate` exists for them.
- **Fix shape:** One `format.js` (bytes, duration, extension, humanize via the kit), the vocabularies exported once from `taskItemsModel` / `tasksTableView`, and `phaseOfTask` moved into `taskItemsModel`.
- **Basis:** MEASURED.

---

## B. Redundant systems

**B1. Two roster hooks with no shared cache. In the cloud both call `workspace_directory`.**
- **Severity:** Medium (repeated identical requests).
- **Locations:**
  - `components/TeamMembers/useRosterMembers.js:49–50` runs both `useWorkspaceMembers` (`useWorkspaceMembers.js:83`, an RPC) and `useTeamMembers`. On the cloud, `useTeamMembers` calls `supabaseAdapter.listTeamMembers` (`rabbit/adapters/supabaseAdapter.js:4416`), which runs the same RPC.
  - The comment at `useRosterMembers.js:46` ("useTeamMembers no-ops without adapter.listTeamMembers (supabase/drive)") has been stale since Session 24 added that method.
  - Views that call both hooks: `EntityListView.jsx:165` and `:261`, `ScenesView.jsx:322` and `:388`.
  - `TimelineView.jsx:265` and `:4840` call `useRosterMembers` twice.
  - `TaskDetailPopup.jsx:98` and `ProjectAssetsView.jsx:1739` fetch on every popup open.
  - `useTeamMembers.js:79–81` also reloads whenever `adapterStatus.online` changes.
- **What:** Each mount fetches. In cloud mode one `useRosterMembers` mount is two identical RPCs. Opening Scenes costs about five, the Timeline about six, and every pre-mounted page adds its own at start.
- **Fix shape:** One cached roster store (module-level or one provider) that both hooks read, refreshed by the workspace channel's `workspace_members` events.
- **Basis:** MEASURED for the calls; INFERRED for the totals.

**B2. Two reads of each collection, paged differently.**
- **Severity:** Medium (silently truncates large projects).
- **Locations:**
  - `supabaseAdapter.js` `loadProject` (2697) pages assets, tasks, scenes and shots (2748–2785). It does not page phases, levels, experiences, milestones or **folders** (2790).
  - That unpaged folders read duplicates `listFoldersWith` (1216), which pages because "a list that has to be WHOLE … the folder tree" must be.
  - The adapter's own `listAssets` (2949), `listTasks` (2974), `listPhases` (2924), `listScenes` (4618), `listShots` (4636), `listLevels` (4651), `listExperiences` (4666) and `listMilestones` (4882) are all unpaged.
  - D.O.G.'s references read exactly those unpaged methods: `src/tools/deck-outline-generator_v0.514/references/useReferences.js:48–53, 108–124`.
- **What:** One query per collection is built twice, and the two copies disagree about paging. A project past 1,000 shots, assets or folders loses rows either in `ctx.folders` or in D.O.G.'s references. DG1-01 was this exact shape for files, and R1 fixed it for files only.
- **Fix shape:** One `read<Collection>With(client, projectId)` per collection, all paged, used by both `loadProject` and the `list*` methods.
- **Basis:** MEASURED for the code; INFERRED for the truncation.

**B3. The project roster is held twice on the cloud.**
- **Severity:** Medium.
- **Locations:**
  - `supabaseAdapter.js:2772–2774`: `loadProject` reads `project_members` into `bundle.teamAssignments`.
  - `RabbitProvider.jsx:860–889`: `refreshProjectMembers` reads `project_members` again (`listProjectMembers`, 4013) into `projectMembers`.
  - `RabbitProvider.jsx:891–971`: the roster mutators update only `projectMembers`.
- **What:** Two reads of one table on every project open, and two copies that drift: Budget, Timeline and Entity views read `ctx.teamAssignments`, which is stale after a seat change until the next reload.
- **Fix shape:** On the cloud, derive `teamAssignments` from `projectMembers` (or the reverse) and read the table once.
- **Basis:** MEASURED.

**B4. Two update paths for entities.**
- **Severity:** Medium.
- **Locations:**
  - Per-field patch with pending-field LWW: `RabbitProvider.jsx:1715` (phases), `:1893` (assets), `:4620` (tasks), `:4277` (milestones).
  - Whole-row upsert with no pending fields: `:3830`, `:3985`, `:4083`, `:4166` (scenes, shots, levels, experiences).
- **What:** The four 0040 entities still send the whole cached row on every edit. That is the pre-S7 shape `supabaseAdapter.js:2630–2634` says "silently clobbered every field a collaborator changed", and it sends every column for a one-field change.
- **Design note:** The four entities' *reload* limit (no broadcast) is Audrey's stated choice (§13.3). The whole-row write is not stated anywhere as deliberate.
- **Fix shape:** Give the four tables `patch*` through the existing `patchRow` and route their updates like `updatePhase`.
- **Basis:** MEASURED.

**B5. Three task-creation forms.**
- **Severity:** Medium.
- **Locations:**
  - `rabbit/components/NewTaskPopup.jsx` (Tasks tab).
  - `rabbit/components/RelationsPanel.jsx:443–753` `NewTaskSidePopup` (Levels, Experiences, Scenes ×2).
  - `rabbit/views/TimelineView.jsx:4826` `TaskEditor` with `emptyTaskDraft` (5699).
- **What:** Three drafts and three field sets for one task row:
  - The role and description are asked in only two of them.
  - Items carried in only two.
  - Default dates (today to +7) only on the Timeline.
  - Each has its own status and priority lists.
- **Fix shape:** One task form (draft plus fields) that each host frames as a dialog, side panel or Timeline editor.
- **Basis:** INFERRED from structure; overlap not line-measured.

**B6. Two ways to assemble the write gate.**
- **Severity:** Low.
- **Locations:**
  - `rabbit/state/useProjectAccess.js:47`. Its header says "Before this, every view rebuilt the same object by hand".
  - It is still rebuilt inline at `EntityListView.jsx:193–196`, `ProjectAssetsView.jsx:214–221`, `ProjectTasksView.jsx:407–414`, `ProjectSummaryView.jsx:137` and `TeamView.jsx:706`.
  - `TaskDetailPopup.jsx:120–128` is the one with a reason: it takes the Dashboard's `ctx` as a prop, so the hook cannot read it.
- **What:** Two ways to ask "can I write this project?". The hook adds `noRoles` and the inline copies do not (no effect on `project.entity.write` today).
- **Fix shape:** The views call `useProjectAccess()`; the hook accepts an optional `ctx` for the popup.
- **Basis:** MEASURED.

**B7. Two settings stores with the same function names, and the settings UI lives inside the Timeline.**
- **Severity:** Low.
- **Locations:**
  - `RabbitProvider.jsx:140–156`: async `loadRabbitSettings` / `saveRabbitSettings`, the otter-settings `rabbit` key (adapter mode, active project).
  - `TimelineView.jsx:185–230`: sync functions with the same names over `localStorage 'rabbit-timeline-settings-v1'` (weekends, sort, group, project-type templates).
  - `SettingsPanel` (6121), `HelpModal` (6424) and `DEFAULT_PROJECT_TYPE_TEMPLATES` (196) are imported from the 8,096-line Timeline by `Rabbit.jsx:53`, `IntakeWizardView.jsx:30` and `ProjectSummaryView.jsx:36`.
  - `holidays.js` and the collapse key (`TimelineView.jsx:383`) are two more `localStorage` stores.
- **What:** Same names, different stores and contents. Project-creation templates live in a "timeline settings" key.
- **Fix shape:** Move the settings panel, help modal and templates into their own module, and rename one pair (or merge it into one store).
- **Basis:** MEASURED.

---

## C. Inefficiencies

**C1. One context value keyed on the whole bundle re-renders every consumer on every change.**
- **Severity:** High (visible runtime cost on big projects).
- **Locations:**
  - `RabbitProvider.jsx:8594` (`value` `useMemo`); `bundle` is in its dependencies at line 8876.
  - `memoSelectors` (8570–8585) is keyed on `bundle`.
  - 67 consumer files and 75 call sites, all pages mounted at once (`App.jsx:2596`).
  - Zero `React.memo`; no list virtualisation; row callbacks are inline lambdas (for example `ProjectAssetsView.jsx:884`).
- **What:** Each optimistic write, realtime event or load gives a new context value, so every mounted consumer re-renders, including D.O.G., Settings, Projects and the Dashboard on hidden pages. The open tab's tables re-render every row: tasks, assets and gantt rows.
- **Fix shape:**
  - Split into a stable actions context and data-slice contexts (or a store read through `useSyncExternalStore` with selectors).
  - Memo the row components.
  - Both stay within the README's "no new state management libraries" rule.
- **Basis:** MEASURED as structure; INFERRED for magnitude.

**C2. Cloud project reads are repeated on open and on auth events, and each load reads every comment in the workspace.**
- **Severity:** High.
- **Locations:**
  - `RabbitProvider.jsx:798`: `setActiveProject` runs `loadProject`.
  - On the channel's first `SUBSCRIBED`, `:1189–1197` schedules a refetch, which `:1041–1079` runs as a second full `loadProject` (29 reads, `supabaseAdapter.js:2739–2814`).
  - `supabaseAdapter.js:2756` reads `comments` with no filter and no paging (every comment the user can see, workspace-wide, cut at 1,000). Its only reader is the set-aside word count, `rabbit/state/setAside.js:147–156` via `RabbitProvider.jsx:8038/8069`. No UI creates, lists or deletes comments (see D2).
  - The auth handler `RabbitProvider.jsx:700–725` runs `status()` plus `listProjects()` on every `TOKEN_REFRESHED` and on the `SIGNED_IN` that auth-js emits at each hidden-to-visible switch (`supabaseAdapter.js:140–147`). It replaces `adapterStatus` with a new object even when nothing changed, which feeds C1.
- **What:** Every project open costs two full bundle loads. Every load drags in the workspace's comments. Every window focus re-reads the project list and re-renders everything.
- **Fix shape:**
  - Subscribe first, then load once (this still closes the missed-events window that db README §14 refetches for).
  - Read comments only for this project's rows, or count them when a removal question is asked.
  - Keep `adapterStatus` identity when unchanged, and re-read the list only on a real sign-in change.
- **Design note:** the refetch-on-join is deliberate; the fix keeps its guarantee.
- **Basis:** MEASURED in code; INFERRED for latency.

**C3. On the desktop, each `list*` re-downloads the whole project bundle.**
- **Severity:** Medium.
- **Locations:**
  - `rabbit/adapters/localServerAdapter.js`: 21 methods `GET /projects/:id` and keep one key. Lines 305, 313, 321, 481, 551, 562, 679, 691, 732, 748, 764, 780, 791, 811, 833, 881, 920, 931, 950, 1024, 1048.
  - `RabbitProvider.jsx:2185` `refreshShotListsNow` fires three of them in parallel and has 12 call sites.
  - Opening Budget fires four: `useBudgetLines.js:63–64` (sequential), `useExpenses.js:81`, `useProjectRateOverrides.js:156`.
  - Budget lines and actuals already come back in `loadProject` (`localServerAdapter.js:221–222`) and are exposed as `ctx.budgetLines` / `ctx.budgetActuals` (`RabbitProvider.jsx:8642–8643`), which nothing reads.
- **What:** Several multi-megabyte JSON parses of one file to read one array each. The data is also held in two places.
- **Fix shape:** Collection routes on the local server (as `/task-items` and `/table-views` already have), or one bundle read shared per refresh; drop the unread `ctx.budgetLines` / `ctx.budgetActuals`.
- **Basis:** MEASURED.

**C4. Cloud creates and uploads re-read the folder tree and the project.**
- **Severity:** Medium.
- **Locations:**
  - `supabaseAdapter.js:1323–1401` `ensureEntityFolderWith`, run on every entity create and rename:
    - It reads all folders, paged (`foldersByPath`, 1236).
    - For a shot it reads them twice: a scene lookup at 1302, then the scene's ensure recursing at 1390.
    - It walks `rows` once per queued folder (1362–1377).
    - `insertFolderIfMissing` re-reads everything on a 23505 (1278).
  - `RabbitProvider.jsx:1500–1505` reads `listFolders` again after a rename.
  - `uploadFile` adds per file: a folder lookup (3379), an INVOICES lookup (3406), `shotSceneId` (3443) and `projectIsPrivate` (3481 → 336).
- **What:** Each "New shot" click costs two full folder-tree reads. A 50-file drop costs about 150 extra round trips.
- **Fix shape:** Pass the bundle's `folders` (and `project.is_private`) into the adapter calls, read only the scene's row where needed, and resolve per-project facts once per upload batch.
- **Basis:** MEASURED in code; INFERRED for counts.

**C5. The asset warning scans every task and item, once per row.**
- **Severity:** Medium.
- **Locations:**
  - `ProjectAssetsView.jsx:882` and `:1321`, and `ProjectSummaryView.jsx:195`, call `ctx.selectAssetStatusWarning(a)` per asset.
  - That runs `RabbitProvider.jsx:8571–8576` → `taskItemsModel.js:179` `tasksAbout`, which scans all task items and filters all tasks on each call.
  - The same rows already get an indexed `taskCountsByEntity` (`ProjectAssetsView.jsx:242`).
- **What:** O(assets × (items + tasks)) per render, repeated on every context change (C1).
- **Fix shape:** Build an asset-to-tasks index once in `memoSelectors` (from `indexItemsByTask`) and answer from it.
- **Basis:** MEASURED in code; INFERRED for cost.

**C6. No code splitting.**
- **Severity:** Low.
- **Locations:**
  - `rabbit/Rabbit.jsx:49–59` imports every view statically, including the 8,096-line Timeline just for its settings panel.
  - `rabbit/rabbitHelpContent.jsx` (1,217 lines of JSX) is in the start-up chunk.
  - There is no `React.lazy` in `src/`.
  - The stale 2026-09-29 build's main chunk is 3.9 MB (1.1 MB gzipped).
- **What:** The web beta downloads and parses all of R.A.B.B.I.T. (about 96k source lines) before the first screen, whichever page is opened.
- **Fix shape:** Lazy-load the R.A.B.B.I.T. tabs, help and intake (`mammoth` and JSZip are already dynamic imports).
- **Basis:** INFERRED; R.A.B.B.I.T.'s share of the chunk was not measured.

---

## D. Exports and adapter methods with no caller

**D1. Exports nothing in the product imports.**
- **Severity:** Low.
- **Locations and what:** A scan of all 185 non-test `.js`/`.jsx` modules in `rabbit/`, against every non-test file in `src/` and `electron/`, found 233 exported names with no reference outside their own file. N1 (2026-10-27) ruled on almost all of them: exports kept as their tests' handle, test seams, and the test-only helper modules `rabbitCssGuards.js` (65 exports) and `views/bins/binsGuards.js` (11). What remains:
  - **No caller at all:**
    - `rabbit/agent/rabbitAgentTools.js` default export `createRabbitAgentTools`: the whole 220-line module is imported by nothing. Already recorded as MASTER_PLAN §6 #56 and handbook §17 (Product gaps).
    - `rabbit/deckAttachments.js:299/309` `DOG_ATTACHMENT_MAX_FILES` / `_MIB`: already recorded as N1-01.
  - **Test-only, same root as N1-01:** `deckAttachments.js:272` `orderAttachmentCandidates`, `:141` `isDeckDocumentRow` and `:199` `attachmentRowIsVisible`. The ordering and cut path has had no product caller since D.O.G.'s references (DG1).
  - **Test-only, and the live code runs a different copy:** `rabbit/state/realtimeMerge.js:413` `normalizeBroadcastPayload` (see A2). Not in N1's lists.
  - **Test-only, on N1's "tangled with assertions" list:** `planIsEmpty`, `hasStorageProvider`, `WORKSPACE_PROVIDER_VALUES`, `gatewayReachWord`, `isFilterEmpty`, `ticketExpiresAt`, `isDoneStatus`, `homeIndexOf`, `moveField`, `canViewVersion`. Unchanged since N1.
  - **The tested money rules with no product caller** (`budgetMath` `effectivePct`, `applyMarginAndContingency`, `profit`): see A4.
- **Fix shape:**
  - Retire `rabbitAgentTools.js` or wire it.
  - Either call or delete the `deckAttachments` ordering path.
  - Make the adapter call `normalizeBroadcastPayload`.
- **Basis:** MEASURED.

**D2. Adapter methods nothing calls (N1's census covered exports, not object methods).**
- **Severity:** Low.
- **Locations:** checked against all of `src/` and `electron/`, outside the three adapters, `adapters/index.js`, the dev fixtures and tests.

| Method | Defined in |
|---|---|
| `createComment`, `listComments`, `deleteComment` | supabase, localServer, googleDrive |
| `restoreComment` | supabase, googleDrive |
| `listAssetVersions`, `upsertAssetVersion` | all three adapters; `cloud/migrate/binsMigration.js:429` already says "called by nothing" |
| `listIngestionChunks`, `upsertIngestionChunk`, `updateChunk` | all three adapters; the intake pipeline builds chunk rows at `intake/pipeline.js:502–510` and never stores them |
| `deleteFolder` | supabase, localServer, googleDrive |
| `deleteRateCard` | supabase, localServer, googleDrive |
| `restoreRateCard`, `restoreFile` | supabase, googleDrive |
| `updateBudgetActual` | supabase, localServer |
| `importFolder`, `listProjectTeam` | localServer |

- **What:** These implement features with no surface. A soft-deleted file or rate card cannot be restored from the app, and no comment can be made. They are the "shipped with no caller" shape the project's memory warns about. `replaceShotListItems` also has no app caller, but by design (see below).
- **Fix shape:** Wire or remove each, and keep `adapters/index.js`'s typedef in step.
- **Basis:** MEASURED.

---

## Not redundant, by design

- **Three adapters (plus the dev fixtures) implementing one interface.** Handbook §13.3: "The adapter layer is the rule".
- **Storage providers of five functions each** (Supabase, s3, local server). §12.1a: "a provider is FIVE functions, never an adapter fork".
- **Two provider vocabularies** (`workspace_storage.provider` and `files.storage_provider`). §12.1: "Do not merge them". A financial file is Supabase whatever the workspace chose.
- **The money pin in two places** (`fileProviderFor` and `files_money_provider_chk`). §12.1a: deliberate double enforcement. Money-gated files never leave Supabase.
- **Renderer and main-process twins pinned by parity tests:** `folderPaths.js` / `fileSlugify` against `electron/main.cjs` (§12.6, `folderParity.test.js`), `tableViewsModel` against `rabbitTableViews.cjs`, `taskItemsModel` against `rabbitTaskItems.cjs`, `shotListModel` against `rabbitShotLists.cjs`, and the `binMedia` vocabulary. The main process cannot import renderer modules. The folder path is computed client-side on purpose (§12.6).
- **Two file stores** (`public.files` and `managedFiles`). §17 Files (S27); `ctx.supportsManagedFiles` picks one.
- **`toColumns` allowlist plus `sanitize` denylist.** Two layers on purpose (S23).
- **`downloadFile` (Blob) and `downloadUrl` (signed URL).** Two download paths on purpose (S42); both write the audit row. The different signing lifetimes (300 s versus 3600 s) are deliberate.
- **Image and video thumbnailers as separate entry points.** S40: `canThumbnail()` refuses video on purpose.
- **TeamView's two roster UIs** (cloud `project_members`, local `team_assignments`). db README §11.
- **Budget Expenses' and Team's own saved-view menus.** Handbook VW1e, her Q19.
- **D.O.G.'s `isCore` and `files.is_core_definer`.** §17 Correctness: deliberately not unified.
- **Client mirrors of database gates** (`projectRoleMatrix`, `canSeeProjectMoney`). The lockstep invariant of §13.3.
- **Google Drive's 80 `readOnly` stubs.** §12.1a: "the shape to avoid, not to finish". It is still selectable in Settings (`SettingsPage.jsx:799–821`).
- **The refetch on channel join** closes the missed-events window (db README §14). C2 only reorders it.
- **The per-migration "client ahead of database" flags** are not cleared on auth events, on purpose (`supabaseAdapter.js:140–151`). A2's factory keeps that.
- **`replaceShotListItems` with no app caller.** Kept for tooling and bulk restores (`adapters/index.js:388–389`).
- **`rabbitCssGuards.js` and `binsGuards.js`.** Test helpers living in `src/`, kept by N1, never imported by the product. N1's 366 exports kept as their tests' handle, likewise.
- **The migration's object key** (`cloud/migrate/runMigration.js:347` `cloudObjectPathFor`) differs from `uploadFile`'s on purpose. It is keyed by the file's id so a second run finds its object (`objectAlreadyThere`), so it is not a copy of `uploadFile`'s key builder.
