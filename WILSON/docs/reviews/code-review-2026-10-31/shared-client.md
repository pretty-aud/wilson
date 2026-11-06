# Shared client layer — redundancy and efficiency review (read-only, 2026-10-31)

Scope: `src/cloud/`, `src/lib/`, `src/components/`, `src/ui/`, `src/dev/`, `src/main.jsx`, `src/App.jsx`, and their seams with the three tools. Tree: the post-overhaul-merge worktree at `ef415b47`. Every path below is relative to `ROOT\WILSON\`. Nothing was changed, built or run; "MEASURED" means counted from the code or from the build already on disk, "INFERRED" means read from the code and not run.

Checked against before writing: `docs/OUTSTANDING.md` (each finding grepped), `docs/SYSTEMS_HANDBOOK.md` §1–3, §4.2–4.5, §13.4–13.5, §17, `docs/design/RECONNECT_DESIGN.md`, and N1's export census (`docs/sessions/handoffs/po-n1-2026-10-27.md`, List 4).

---

## Measured facts

| Folder | Non-test JS/JSX modules | Non-test lines | Test files |
|---|---|---|---|
| `src/cloud` | 39 | 16,007 | 38 |
| `src/lib` | 14 | 2,950 | 27 |
| `src/components` | 83 (+ 4 CSS) | 27,317 | 37 |
| `src/ui` | 38 | 3,733 | 44 |
| `src/dev` | 19 (+ 2 media) | 6,020 | 12 |
| `src/App.jsx` / `src/main.jsx` | 2 | 3,259 / 68 | — |
| **Area total** | **195** | **≈59,350** | **158** |

For scale: `src/tools/rabbit_v0.1.0` 85,975 lines, `otter_v0.3.1` 15,269, `deck-outline-generator_v0.514` 11,482.

Largest files in the area: `src/cloud/migrate/runMigration.js` 3,805 · `src/App.jsx` 3,259 · `src/dev/fixtures/rabbitFixturesAdapter.js` 2,081 · `src/components/Resources/ProjectFilesExplorer.jsx` 1,686 · `src/components/SettingsPage.jsx` 1,424 · `src/components/AdminTerminal/StorageSection.jsx` 1,267 · `src/cloud/auth/AuthShell.jsx` 1,131 · `src/components/RateCard/RateCardTable.jsx` 1,065 · `src/cloud/auth/LoginScreen.jsx` 1,046 · `src/cloud/migrate/migrationRows.js` 1,016 · `src/components/TeamMembers/TeamMembersPage.jsx` 972 · `src/components/Dashboard/NotesView.jsx` 826 · `src/components/AdminTerminal/UsersSection.jsx` 806 · `src/components/Dashboard/DashboardTasksView.jsx` 797 · `src/components/settings/GatewaySettings.jsx` 776.

Other counts used below:
- **Seams:** 40 shared-layer files import from `src/tools/`; 24 of those imports are `RabbitProvider`. `useRabbit()` has 98 call sites app-wide.
- **Rendering:** `memo(` appears in no file under `src/`; `React.lazy` / `Suspense` in none. The only code-split points are `xlsx`, `jszip`, `mammoth`, Sentry and the dev fixtures.
- **Bundle:** the only build on disk is `dist/` from 2026-09-29 (stale; not rebuilt here). Its main chunk `dist/assets/index-BrMi8IMi.js` is 3,904,503 bytes and holds 297 Prism grammar registrations spanning 579,414 bytes (≈15 %).
- **Session reads:** `supabase.auth.getSession()` is called at ~30 non-comment sites; `usePermissions()` at 37 call sites, each instance with its own `getSession()` and `onAuthStateChange` subscription; 6 other modules subscribe to auth events.
- **Export scan:** 150 of the area's exports have no reader outside their own file (tests excluded): 9 have none at all, 23 only tests, 118 only their own file.

---

## A. Near-duplicate functions

### A1. Edge Function calls: one job, nine helpers and eight inline copies
- **Severity:** High
- **Locations:** helpers `src/cloud/adminApi.js:50` (`callAdminFn`), `src/cloud/storageApi.js:31` + `:46` (`sessionToken`, `callStorageFn`), `src/cloud/aiProxy.js:90-121` (inside `callAI`), `src/cloud/aiFiles.js:139-151`, `:231` (`readToken`), `:261` (`callFiles`), `src/cloud/gatewayApi.js:151-212` and `:416-453` (the same ~35-line block twice in one file). Inline: `src/cloud/auth/InviteMemberDialog.jsx:172-188`, `src/components/AdminTerminal/MultiInviteDialog.jsx:151-175`, `src/components/AdminTerminal/StorageCleanupCard.jsx:63-75`, `src/cloud/auth/WorkspaceSwitcher.jsx:74`, `src/cloud/auth/LoginScreen.jsx:183`, `:211`, `:230`, `src/cloud/auth/ForgotPasswordWizard.jsx:50`. The operator console's twin: `src/admin/operatorApi.js:84-91`.
- **What:** each one reads the access token (bounded by `withTimeout` in three places, unbounded in the rest), POSTs JSON with `apikey` + `Bearer`, reads JSON and maps the error code to a sentence. Ceilings differ for no stated reason: gateway 15 s / 30 s, AI file store 15 s / 120 s, everything else none — and Edge Function calls are outside the watchdog by construction (RECONNECT_DESIGN §5), so those can hang. Nine error vocabularies (`adminApi.js:21`, `aiProxy.js:30`, `aiFiles.js:51`, `gatewayApi.js:53`, `InviteMemberDialog.jsx:197`, `MultiInviteDialog.jsx:44` — "Same error map InviteMemberDialog uses", a copy — `StorageCleanupCard.jsx:46`, `AIFileStoreCard.jsx:31`, which re-maps codes `aiFiles.js` already mapped, and `operatorApi.js:21`); `mfa_required` reads four different sentences. `invite-member` is called by two dialogs with the same body and map.
- **Fix shape:** one `callEdgeFunction(name, body, { token, signal, timeoutMs, words })` in `src/cloud` (bounded token read, abort on timeout, `res.ok` before the body, one base vocabulary), with `callAI`, `uploadAIFile` and `presignStorage` kept as thin throwing wrappers on top.
- **Evidence:** MEASURED (17 call sites by grep for `functions/v1`).

### A2. Auth steps written twice, and the forgot-password copy has drifted
- **Severity:** Medium
- **Locations:** `issueSession` — `src/cloud/auth/LoginScreen.jsx:230` and `src/cloud/auth/WorkspaceSwitcher.jsx:74` (one returns null, the other throws). `resolveLogin` — `LoginScreen.jsx:183` (sends `workspace_slug`, handles 429) and `src/cloud/auth/ForgotPasswordWizard.jsx:50` (username only). "Needs aal2 → find a verified TOTP": `LoginScreen.jsx:466-478`, again at `:563-570` (dev auto sign-in), `src/App.jsx:537-539`, `src/cloud/auth/MfaSection.jsx:34`, `src/admin/OperatorLogin.jsx:75-80`. Challenge + verify: `LoginScreen.jsx:602-607`, `MfaSection.jsx:138-142`, `OperatorLogin.jsx:117-120`.
- **What:** the same GoTrue and Edge steps restated per screen. The forgot-password copy never learned S43's company step: `supabase/functions/resolve-login/index.ts:347` answers "miss" when a bare username matches two companies, so a person whose username exists in two companies gets no reset email while the wizard shows its uniform "sent" screen. `LoginScreen.jsx:467-469`'s two MFA reads also carry no ceiling, against the screen's own "every await gets a ceiling" rule (`withTimeout.js:12-14`).
- **Fix shape:** one `src/cloud/auth` module (`issueSession`, `resolveLogin(username, slug)`, `mfaStepNeeded()`, `verifyTotp()`) used by LoginScreen, WorkspaceSwitcher, ForgotPasswordWizard, MfaSection and the operator login, with the wizard taking (or remembering) the company.
- **Evidence:** MEASURED for the copies. INFERRED for the missed reset email — the handbook records "without" as a fact (`docs/SYSTEMS_HANDBOOK.md:927`); not in OUTSTANDING. Would settle it: one username in two companies on wilson-dev, Forgot password, no mail.

### A3. Wrapping an AI call: retry, history trim, `pause_turn` and JSON extraction restated per caller
- **Severity:** Medium
- **Locations:** `src/App.jsx:2030-2068` (pet chat) and `src/agent/AgentProvider.jsx:350-384` (agent chat): the same trim (first two + a marker + the recent tail; 40/2000 against 30/3000), the same three-attempt loop with `2000 * attempt` backoff, the same `authish` regex. `src/tools/otter_v0.3.1/Otter.jsx:1195-1222` (its own 3/6/12 s table), `src/tools/rabbit_v0.1.0/intake/pipeline.js:386-405` (its own 1.5 s loop). `pause_turn` resume: `Otter.jsx:1242-1249` and `src/tools/otter_v0.3.1/Validator.jsx:52-60`. JSON from model text: `Otter.jsx:1430`, `:1700`, `:1929`, `:2160`, `:2348`, `:2570` (one fence-strip regex six times), `Validator.jsx:69`, `pipeline.js:409`. Picking the text block: `src/cloud/anthropicStream.js:48` `textFromMessage` (the LAST text block) against `Validator.jsx:36` (the FIRST).
- **What:** the two chat loops retry every non-auth error, including the 546 that `aiProxy.js:43-56` says must not be retried; the Validator alone takes the first text block, which after a web search can be the preamble rather than the answer.
- **Fix shape:** `callAIWithRetry(body, { attempts, delays, resumePauses })` and `jsonFromMessage(message)` beside `callAI` / `textFromMessage` in `src/cloud`, and one `trimHistory(messages, { max, chars })` for the two chats.
- **Evidence:** MEASURED (the copies); INFERRED (the 546 retry and the first-block read happening in practice).

### A4. The pet's state machine is written twice
- **Severity:** Medium
- **Locations:** `src/App.jsx:1586-1668` (the live 30-second tick: sleep end, falling asleep, decay, death, evolution) and `src/lib/petLifecycle.js:239-371` (`applyOfflineDecay`).
- **What:** both encode the same rules from the same constants and are kept in step by comments ("mirrors the tick"); `App.jsx:1592-1598` records a drift that shipped. They already differ: the "falls asleep after 15 interactions or 30 minutes" step exists only in the tick.
- **Fix shape:** one pure `advancePet(pet, fromMs, toMs)` in `petLifecycle.js`, called by the tick with 30 s and by the load with the elapsed time.
- **Evidence:** MEASURED (the copies); INFERRED (whether the sleep difference is intended).

### A5. The money rules are tested in one place and computed in another
- **Severity:** Medium
- **Locations:** `src/components/Budget/budgetMath.js:26` (`effectivePct`), `:45` (`applyMarginAndContingency`), `:62` (`profit`) — no production caller. Inline copies: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx` (6 × `_pct != null ? Number(…)`, e.g. `:2026`, `:2031`, `:2096-2097`, `:2506-2507`), `views/budget/TalentTab.jsx` (6, e.g. `:217-218`, `:315`), `views/budget/CrewTeamTab.jsx:197-200`, `views/budget/ClientViewTab.jsx:189-191`.
- **What:** Session 24 wrote `budgetMath.js` because the rules lived in four inline copies; the screens were never switched over, so the tests pin functions nothing runs (14 inline copies of the inheritance rule alone).
- **Fix shape:** make the four budget views call `effectivePct`, `applyMarginAndContingency` and `profit`.
- **Evidence:** MEASURED. Recorded in N1's hand-off (List 4, "the four Budget views still run inline copies, untested"); not in OUTSTANDING.

### A6. Storage object keys built in several places, one decision gate-relevant
- **Severity:** Medium
- **Locations:** the gated third segment decided twice — `src/cloud/migrate/runMigration.js:346-350` (`cloudObjectPathFor`) and `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:3429-3446` (`uploadFile`'s key). Poster key, upload and refusal regex twice — `runMigration.js:609-612` and `supabaseAdapter.js:5468-5472`. The file-name sanitiser `replace(/[^a-zA-Z0-9._-]+/g, '_')` at `runMigration.js:348`, `:2520`, `supabaseAdapter.js:3431`, `src/cloud/onboarding/NewUserWelcome.jsx:177`, `src/components/settings/ProfileSection.jsx:186`, while `src/tools/rabbit_v0.1.0/components/relinkMatcher.js:31` exports it as `sanitizeFileName` ("Mirror of the upload-side filename sanitizer").
- **What:** the INVOICES / LEGAL third segment is what the money and Legal storage policies key on (handbook §17), and two writers decide it independently; they also produce different key shapes for the same kind of file (`…/<fileId>/<name>` against `…/<entityId>/<ts>-<name>`).
- **Fix shape:** a `storageKeys.js` beside `storage/index.js` owning `sanitizeFileName`, the gated-segment rule and the poster key, imported by the adapter and the migration.
- **Evidence:** MEASURED (copies); INFERRED (the risk: a new gated segment added to one writer only).

### A7. Six timeout helpers, and the shared one never aborts
- **Severity:** Medium
- **Locations:** `src/cloud/auth/withTimeout.js:41` (races, never aborts — by design for sign-in, `:16-19`); a private copy at `src/tools/rabbit_v0.1.0/bins/binProbeFallback.js:18`; `src/tools/rabbit_v0.1.0/bins/gatewayDoors.js:69` (`fetchWithin`, abort + race) and `:80` (`fetchPath`, abort timer); `src/tools/rabbit_v0.1.0/state/connectionStatus.js:111` (`bounded`, abort + cancel); `src/cloud/aiFiles.js:246` (`timedSignal`, abort joined to the caller's signal); inline twice at `src/cloud/gatewayApi.js:162-176` and `:425-439`.
- **What:** "bound this await" is written six ways; because the shared helper leaves the request running, every caller that needs it cancelled wrote its own.
- **Fix shape:** add `withDeadline(fn(signal), ms, { signal })` (abort + race, joined to an outer signal) to `withTimeout.js`, keep `withTimeout` for sign-in work, and point the five copies at it.
- **Evidence:** MEASURED.

### A8. JWT claims decoded six ways
- **Severity:** Low
- **Locations:** `src/cloud/auth/sessionTimeouts.js:65` (`readJwtClaims`, exported, pads correctly), `src/permissions/usePermissions.js:61` (`readClaims`, the same code), `src/cloud/auth/WorkspaceSwitcher.jsx:66`, `src/App.jsx:223-233` (`storedSessionUserId` — also a second `loadSession()` IPC decrypt at boot beside `App.jsx:179`), `src/tools/otter_v0.3.1/adapters/index.js:177`, `src/tools/otter_v0.3.1/adapters/supabaseOtterAdapter.js:134-146` (the last four without padding).
- **Fix shape:** import `readJwtClaims` everywhere, or read claims from the auth store proposed in B3.
- **Evidence:** MEASURED.

### A9. Blob downloads: seven hand-built anchors, three revoke at once
- **Severity:** Low
- **Locations:** `src/lib/csvExport.js:67` (`downloadBlob`, revokes after 1 s), `src/components/Resources/fileActions.js:54` + `:100` (`downloadCloudFile`, `clickLink`, 10 s), `src/components/settings/GatewaySettings.jsx:77` (`downloadPem`, a copy of `downloadBlob`), `src/tools/rabbit_v0.1.0/components/FileManager.jsx:822-851` (`handleCloudDownload` — the steps of `fileActions.downloadCloudFile`, whose header says so, while importing `startSignedDownload` from it), `src/tools/deck-outline-generator_v0.514/export.js:21-28`, `src/tools/otter_v0.3.1/Otter.jsx:2802-2809`, `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:6003-6010`.
- **What:** the last three revoke the object URL synchronously — the case `fileActions.js:68` records (S27) as able to cancel the download.
- **Fix shape:** everything calls one `downloadBlob` (moved to `src/lib/download.js`) and `FileManager` calls `fileActions.downloadCloudFile`.
- **Evidence:** MEASURED (copies); INFERRED (a lost download is browser-dependent).

### A10. Byte sizes formatted eight ways
- **Severity:** Low
- **Locations:** shared — `src/cloud/workspaceStorage.js:172` (`formatBytes`: KB…TB, '—'), `src/cloud/migrate/AttachmentMigrationPanel.jsx:37` (KiB/MiB/GiB, two decimals), `src/components/settings/gatewayWords.js:667` (`formatBytesShort`). Tools — `src/tools/rabbit_v0.1.0/bins/binMedia.js:139` (a second exported `formatBytes`), `components/FileManager.jsx:68`, `components/ProjectFilesTable.jsx:97` (stops at MB: a 1.5 GB file prints "1536.0 MB"), `storage/uploadNotices.js:85`, `views/IntakeWizardView.jsx:429` (inline).
- **What:** one job, eight outputs; the same file reads differently on the Files page and in R.A.B.B.I.T.'s tables.
- **Fix shape:** keep `workspaceStorage.formatBytes` (moved to `src/lib`) and delete the other seven.
- **Evidence:** MEASURED. Not in OUTSTANDING.

### A11. Small rules restated inline
- **Severity:** Low
- **Locations:**
  - `USERNAME_RE` five times — `src/cloud/auth/inviteParsing.js:12` (exported), `InviteMemberDialog.jsx:81`, `ForgotPasswordWizard.jsx:40`, `LoginScreen.jsx:412` (inline literal), `src/admin/CompaniesSection.jsx:125`; `EMAIL_RE` twice — `inviteParsing.js:13`, `InviteMemberDialog.jsx:82`.
  - The app-role option list four times — `InviteMemberDialog.jsx:88`, `MultiInviteDialog.jsx:70`, `CreateUserDialog.jsx:46`, `UsersSection.jsx:55`.
  - Role strings beside `src/permissions/roleMatrix.js`: `AdminTerminalPage.jsx:74` (the matrix has `admin.terminal.access`), `InviteMemberDialog.jsx:250` (`member.invite`), `Home.jsx:87`, `FootageSettings.jsx:236`, `GatewaySettings.jsx:521`, `App.jsx:2565`; two exact duplicates — `canEditMachineRoot` (`SettingsPage.jsx:129` = `StorageConnections.jsx:125`) and `adminTier` (`App.jsx:532` = `MfaSection.jsx:597`).
  - `hasLocalServer()` (`src/lib/localData.js:85`) restated at `src/cloud/migrate/OtterMigrationPanel.jsx:53`, `src/tools/otter_v0.3.1/adapters/index.js:160`, `Otter.jsx:304`.
  - Avatar constants, checks and upload twice — `NewUserWelcome.jsx:108-110`, `:141-148`, `:176-196` and `ProfileSection.jsx:31-33`, `:155-162`, `:185-199`; URL → object path twice — `ProfileSection.jsx:267-274` and `src/components/TeamMembers/avatarReads.js:66` (`avatarObjectPath`).
- **What:** each copy is a second place a rule change must land. The avatar pair matters most: OUTSTANDING's "Avatar does not persist" may end in a fix both writers must take.
- **Fix shape:** import the exports that already exist (`inviteParsing`, `avatarReads`, `hasLocalServer`), add the missing actions to `roleMatrix.js` and call `perms.can`, and give the avatar upload one helper in `avatarReads.js`.
- **Evidence:** MEASURED.

### A12. UI logic written twice
- **Severity:** Low
- **Locations:** "workspace event → filter → 400 ms debounce → reload" five times — `src/components/TeamMembers/TeamMembersPage.jsx:197-206` and `:245-256`, `src/components/Dashboard/DashboardPage.jsx:127-142`, `src/components/Dashboard/useMyTasks.js:107-162`, `src/components/RateCard/useRateCardAccess.js:92-104`. The model-tier table twice — `src/components/AdminTerminal/ModelsSection.jsx` (company tier) and `src/components/settings/UserModelsSection.jsx` (user tier): the same state set, the same load (`loadApprovedModels` + sources), the same per-row save/busy/error handling, the same `registryByTool()` list.
- **Fix shape:** a `useWorkspaceEventReload(isRelevant, reload)` hook, and one `ModelTierTable({ tier, save, inherited })` both sections render.
- **Evidence:** MEASURED.

### A13. Already recorded — dates, toasts, hand-rolled modals
- **Severity:** Low
- **Dates:** ten private formatters in the shared layer (`LogsSection.jsx:88`, `UsersSection.jsx:88` / `:95`, `DashboardTasksView.jsx:63`, `NotesView.jsx:105`, `ProjectDetailPanel.jsx:82`, `ProjectFilesExplorer.jsx:201` / `:213`, `AIFileStoreCard.jsx:45`; two `timeAgo`s still print '--' for empty) beside `src/tools/rabbit_v0.1.0/dates.js:114` `showDate` — **already recorded as P1-34** (one format, then the kit's formatter). The only new point: the helper the kit would wrap lives in a tool folder, and `src/components/Projects/ProjectListPanel.jsx:45` already reaches into the tool for it.
- **Toasts** outside the kit stack (`src/agent/AgentProvider.jsx:19` `AgentToast`; `IngestionToast`) — **already recorded** in OUTSTANDING's UI-overhaul P1 rows ("The agent overlays are still hand-drawn", "Hexes left in lane code").
- **The pet's hatch modal** outside the kit Dialog (`src/components/PetCompanion.jsx:319`) — **already recorded as S2a-02**.

---

## B. Redundant systems

### B1. The roster is fetched per hook instance — and twice per `useRosterMembers` in cloud mode
- **Severity:** High
- **Locations:** `src/components/TeamMembers/useWorkspaceMembers.js:53-102` (the RPC at `:83`, its own state per instance); `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:4416-4418` (`listTeamMembers` → the same `workspace_directory()`); `src/components/TeamMembers/useRosterMembers.js:45-50` mounts both hooks unconditionally, its comment saying `useTeamMembers` "no-ops … (supabase/drive)" — stale since S24 gave the cloud adapter `listTeamMembers`. Mounted at every launch (every page renders): `src/components/Dashboard/DashboardPage.jsx:119`, `src/components/TeamMembers/TeamMembersPage.jsx:157`, `src/components/RateCard/RateCardPage.jsx:100` (two RPCs), `src/tools/rabbit_v0.1.0/Rabbit.jsx:222` (two RPCs), `src/components/AdminTerminal/AdminTerminalPage.jsx:93` (admins). More on open: `src/components/settings/FootageSettings.jsx:66`, the two O.T.T.E.R. share dialogs, `TeamView.jsx:693` and about ten R.A.B.B.I.T. views' `useTeamMembers` / `useRosterMembers`.
- **What:** at least seven identical `workspace_directory()` RPCs at an admin's launch (six for anyone else) and five or more separate copies of the same roster. A member change reloads two of the copies (TeamMembersPage, the presence strip) and leaves the rest stale until they remount. `useWorkspaceMembers` fires whenever a workspace claim exists, so a signed-in desktop on the Local Server pays for RPCs it then ignores.
- **Fix shape:** one module-level roster store per workspace (`useSyncExternalStore`, with the in-flight dedupe and generation guard `src/cloud/workspaceStorage.js:66-110` and `useRateCard`'s `sharedLoadRateCards` already use), reloaded once per `workspace_members` event, with `useRosterMembers` mapping it per mode instead of mounting both sources.
- **Evidence:** INFERRED (the count is from the code; would settle it: the network panel at launch filtered on `workspace_directory`). Not in OUTSTANDING.

### B2. The rate card has nine independent copies
- **Severity:** Medium
- **Locations:** `src/components/RateCard/useRateCard.js:96-117` (its own note: "EIGHT independent useRateCard() consumers … and no provider or cache between them"), `:202` (`sharedLoadRateCards` dedupes only a load already in flight), `:246-253` (cards, entries and defaults held per instance). Consumers: `RateCardPage.jsx:88`, `SettingsPage.jsx:167`, `TeamMembersPage.jsx:158` (these three at every launch), `TaskDetailPopup.jsx:130`, `BudgetView.jsx:173`, `EntityListView.jsx:166`, `ScenesView.jsx:323`, `TimelineVersions.jsx:83`.
- **What:** each mount reads the cards and entries again and keeps its own copy; an edit on the Rate Card page reaches the other copies only when they remount.
- **Fix shape:** lift cards and entries into one workspace-keyed store (or provider) all nine read, with `sharedLoadRateCards`' create-once guard inside it.
- **Evidence:** INFERRED. Related but not the same: S5d-04 (stale rates for a moment after a backend switch).

### B3. Who is signed in is held in many places, each asking the SDK again
- **Severity:** Medium
- **Locations:** `src/permissions/usePermissions.js:117` (`getSession`) and `:129` (`onAuthStateChange`) per instance — 37 call sites, most mounted at launch. Other auth listeners: `src/cloud/aiFiles.js:226` (its own `currentToken`), `src/components/TeamMembers/avatarReads.js:106`, `src/tools/rabbit_v0.1.0/components/ConnectionDot.jsx:138`, `src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx:700` and `:1291` (two in one provider). Identity copies: `src/lib/userState.js:59` (`currentUserId`), App's `authed` / `sessionId` / `petUserIdRef`. About 30 `getSession()` token reads (A1's helpers, `src/cloud/errorCodes.js:89` on every reported event, `OtterMigrationPanel.jsx:58`, `src/lib/modelSources.js:250`, `PasswordSection.jsx:77`, `ProfileSection.jsx:107`, `RabbitProvider.jsx:873` / `:1286`, `supabaseAdapter.js:121`, `:4076`, `:5663`, `:5755`).
- **What:** `src/cloud/auth/supabaseClient.js:332` already sees every auth event and `heldSession.js` already shares the held session through `useSyncExternalStore`; everything else re-derives it — about forty subscriptions, each setting state and re-rendering on every `TOKEN_REFRESHED`. Seven comments still justify avoiding `getSession()` by "auth-js's global per-storageKey lock" (`App.jsx:212`, `:2003`, `storageApi.js:43`, `userState.js:57`, `projectRoleMatrix.js:391`, `connectionStatus.js:36`, `supabaseProvider.js:31`), which RECONNECT_DESIGN §1 measured as wrong for this app (the lock is `lockNoOp`; the pin is the client's own queue, aborted at 20 s since S1).
- **Fix shape:** export one auth snapshot store from `supabaseClient.js` (`{ session, token, claims, userId, workspaceId, offline }`) fed by its existing listener and `heldSession`, make `usePermissions` a `useSyncExternalStore` over it, and let the token readers and listeners read it.
- **Evidence:** MEASURED (counts); INFERRED (re-render cost).

### B4. Two sources for "the active workspace"
- **Severity:** Medium
- **Locations:** the JWT claim (the frozen shape, handbook §4.3) — `usePermissions.js:77-83`, `src/tools/otter_v0.3.1/adapters/index.js:177`, `supabaseOtterAdapter.js:140`, the first stating the rule (`index.js:163-166`: "app_metadata on the user object is not authoritative"). The user object instead — `src/App.jsx:472` (the onboarding check; its comment says "JWT"), `src/cloud/errorCodes.js:90` (every `app_events` insert), `src/cloud/migrate/OtterMigrationPanel.jsx:59`, `src/lib/modelSources.js:257` (model-override writes), `RabbitProvider.jsx:1288` / `:1292` (the workspace channel key; its comment at `:1280` says "from the JWT claims"), `ConnectionDot.jsx:142`.
- **What:** the access-token hook re-derives `workspace_id` (kept while an active membership, else the oldest), while `session.user.app_metadata` holds whatever `issue-session` last wrote. When they differ (a deactivated membership), the channel joins one company while RLS answers for another, and `app_events` rows and model overrides are refused.
- **Fix shape:** read the workspace from the claims everywhere (the B3 store) and delete the user-object reads.
- **Evidence:** INFERRED (would settle it: deactivate a member in their active company, sign them in, compare `session.user.app_metadata.workspace_id` with the claim). Not in OUTSTANDING.

### B5. The S19 model-preference store is still read at every launch
- **Severity:** Low
- **Locations:** `src/main.jsx:25` (`initUserModelPrefs`), `src/lib/userModelPrefs.js:30-73` (`wilson.modelPrefs.v1`), `src/lib/modelSources.js:105-113` (hydrate replaces the user tier straight after), `:371-400` (the migration marks itself done and never clears the key); `setUserModelPref` / `clearUserModelPrefs` (`userModelPrefs.js:81`, `:94`) have test callers only.
- **What:** a second store for the user tier, superseded by `user_model_overrides` in S20, still parsed at every launch and overwritten at once whenever the S20 cache exists.
- **Fix shape:** skip `initUserModelPrefs` once `wilson.modelPrefs.migrated.v1` is set, and clear the legacy key when the migration marks itself done.
- **Evidence:** MEASURED (the path); the runtime cost is tiny.

---

## C. Inefficiencies

### C1. App-level pet and chat state re-renders every mounted page
- **Severity:** High
- **Locations:** `src/App.jsx:1039-1044` (the pet chat input lives in App state: one App render per keystroke), `:1722-1726` (sleep animation: a state change every 2 s while the pet sleeps), `:1729-1742` (dream cloud: two state changes every 11–18 s, continuous with Pet Mode on), `:1745-1760` (attention jump, every 20–60 s), `:1586-1588` (decay tick, 30 s), `:2597-2662` (`renderAllPages` builds all twelve pages on every App render). `src/agent/AgentProvider.jsx:53` (the agent's input text in provider state) and `:542` (`const value = {…}`, not memoized), read by `App.jsx:87` / `:106`, `SettingsPage.jsx:163`, `Otter.jsx:468`, `Rabbit.jsx:73`.
- **What:** nothing in `src/` uses `memo()`, so each of those state changes re-runs the render of D.O.G. (`DeckOutlineGenerator.jsx`, 5,533 lines), O.T.T.E.R. (`Otter.jsx`, 6,402 lines), R.A.B.B.I.T.'s shell and open view, and the Settings, Dashboard, Team, Rate Card and Admin pages. With a live pet (an egg, corpse or ghost skips the timers) that is roughly 10–20 whole-app renders a minute while idle and about 40 while it sleeps, plus one per character typed to the pet or the agent.
- **Fix shape:** move the pet, its animations and the chat input into one `PetHost` component below the pages, memoize `AgentProvider`'s value and keep the input text in the panel, and wrap the prop-less pages in `React.memo`.
- **Evidence:** MEASURED (the state sites; no `memo()` in `src/`); INFERRED (render cost — would settle it: React Profiler, pet idle for a minute). Not in OUTSTANDING.

### C2. The syntax highlighter ships all 297 Prism grammars in the main chunk
- **Severity:** High
- **Locations:** `import { Prism } from 'react-syntax-highlighter'` at `src/components/PetCompanion.jsx:4`, `src/components/Resources/FilePreviewDialog.jsx:49`, `src/tools/otter_v0.3.1/Otter.jsx:5`, `src/tools/otter_v0.3.1/FunctionCard.jsx:1`; the package's `dist/esm/prism.js:3` imports `refractor/all`.
- **What:** 297 grammars (935 KB of source). In the build on disk they span 579,414 of the main chunk's 3,904,503 bytes (≈15 %), parsed at every launch for code blocks in the pet's answers, lessons and file previews.
- **Fix shape:** switch the four imports to `PrismAsyncLight` (each grammar fetched on first use; every language still available to O.T.T.E.R.) or to `PrismLight` with the ~35 languages `src/components/Resources/filePreview.js:46` lists.
- **Evidence:** MEASURED in the 2026-09-29 build (`dist/assets/index-BrMi8IMi.js`); the imports are unchanged since.

### C3. Screens that open on demand are statically imported into the main chunk
- **Severity:** Medium
- **Locations:** `src/components/SettingsPage.jsx:19-21` → `src/cloud/migrate/*` (6,954 lines, 419 KB of source; mounted only in Settings → R.A.B.B.I.T., `:772`, `:884-894`; the runner needs the desktop's local server). `src/App.jsx:45` → `src/components/AdminTerminal/*` (5,350 lines, 241 KB; the body mounts only for admins, `AdminTerminalPage.jsx:92`). The Notes editor stack — `yjs` (300 KB), `@tiptap/core` (233 KB) and ProseMirror (≈490 KB of model/view/state/transform source) — via `src/components/Dashboard/NotesView.jsx:40-41` and `noteText.js:31-34`, also imported by D.O.G.'s `references/useReferences.js:40`.
- **What:** three subtrees most launches never open are parsed at every launch, on both hosts.
- **Fix shape:** `React.lazy` + `Suspense` for the three migration panels and `AdminTerminalBody` (they already mount on demand, and `rabbitCssGuards.js:1323` already reads `lazy(() => import())`); a dynamic import of the editor on the first open of the Notes tab (it mounts hidden at launch today, `DashboardPage.jsx:85-86`, so this changes when the tab mounts); and `rabbitHelpContent.jsx:19`'s words moved out of `binsMigration.js` so the help keeps no static path into the migration.
- **Evidence:** MEASURED (source sizes); INFERRED (minified bytes saved).
- **Design note:** page-level laziness would conflict with handbook §13.4 (every page mounted at once); these three subtrees do not.

### C4. One 280-field R.A.B.B.I.T. context carries presence, progress and toasts
- **Severity:** Medium
- **Locations:** `src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx:8594-8932` (one `useMemo` value: presence at `:8727` and `:8732`, realtime status `:8726`, the ingestion run `:8710`, the undo toast `:8739`, among about 280 fields). 98 `useRabbit()` call sites, 24 of them imports in the shared layer (TeamMembersPage, DashboardPage, RateCardPage, SettingsPage, ProjectFilesExplorer, the migration panels…).
- **What:** every presence sync, connection-status flip, ingestion progress step or undo-toast change produces a new value and re-renders every consumer on every page.
- **Fix shape:** split the volatile state (presence, connection status, ingestion run, undo toast) into its own context or subscribable store, leaving actions and project data in the main value.
- **Evidence:** INFERRED (would settle it: Profiler while a second user joins presence).

### C5. Every `otterFetch` reads and decodes the session — twice
- **Severity:** Low
- **Locations:** `src/tools/otter_v0.3.1/adapters/index.js:168-183` (`cloudActive`: `getSession` + JWT decode), run by `otterFetch` at `:234` (127 call sites), then `supabaseOtterAdapter.js:134` (`currentWorkspaceId`: `getSession` + decode again) inside the handler.
- **What:** two session reads and two decodes per O.T.T.E.R. request, for a value `usePermissions` and `heldSession` already hold.
- **Fix shape:** read the SDK session's claims synchronously from the B3 store, keeping RECONNECT_DESIGN §11.8's rule that a held session is not "cloud active".
- **Evidence:** INFERRED (small per call; the gain is fewer queued `getSession` calls during a hang).

---

## D. Exports with no caller

Method: every `export` declaration and export list in the area's 195 non-test modules; each name grepped (case-insensitive, whole word) across all non-test code under `WILSON/` (`src`, `electron`, `gateway`, `scripts`, `supabase/functions`, `public`), then across the tests. N1 (night 1, 2026-10-27) ran the same census and deliberately kept exports that are their own tests' handle and the kit's token surface; listed here is what is still dead or new since.

### D1. Read by nothing, or by tests alone
- **Severity:** Low
- **Locations and status:**
  - `src/components/settings/agentSkillRegistry.js:155` `isSkillEnabled` — no reader anywhere; already recorded in handbook §17 ("The Agent Skills checkboxes gate nothing"), not in OUTSTANDING.
  - `src/ui/tokens.js:266` `SHADOW_FLOAT_LIGHT`, `:270` `WIDTH_READING`, `:271` `WIDTH_DATA_MAX`, `:272` `CONTROL_SM`, `:275` `ROW_DENSE`, `:276` `TABLE_HEAD`, `:278` `PAGE_HEADER`, `:279` `PANEL_HEADER` — no reader; kept by N1 on purpose as the kit's token surface.
  - **New:** `src/components/lightSurface.js` (the whole module) and `src/ui/tokens.js:314-318` (`LIGHT_INK`, `LIGHT_RULE`, `LIGHT_WELL`, `LIGHT_ACCENT`, `LIGHT_SURFACE_SOLID`) — read only by `lightSurface.test.js`. The module's header says "31 files import them"; two tests now assert none do (`adminTerminalCss.test.js:1283`, `dashboardCss.test.js:106`), and the handbook still names it a shared token module (`docs/SYSTEMS_HANDBOOK.md:4574`). N1's grep kept it because the module re-exports the aliases.
  - **New since N1, test-only:** `src/components/AnswerLink.jsx` `opensInANewTab` (D3, 2026-10-29). The test seams (`aiFiles.js` `__setCurrentTokenForTests`, `avatarReads.js` `_reset…` / `_avatarSignCalls…`, `ProjectFilesExplorer.jsx` `_resetPreviewReadsForTests`, `useRateCard.js` `__resetRateCardLoadCache`) and N1's kept list (`getModelWarnings`, `clearModelWarnings`, `setUserModelPref`, `clearUserModelPrefs`, the `budgetMath` trio — see A5 — `TM_COLUMN_WIDTHS`, `BUDGET_SHEETS`, `FIXTURE_ID_PREFIX`, `shouldWatch`) stand as N1 left them.
- **Fix shape:** delete `lightSurface.js`, its test and the five aliases and correct the handbook's line; `isSkillEnabled` is hers (wire the checkboxes or remove them, §17).
- **Evidence:** MEASURED.

### D2. Exported but read only inside their own file, added since N1
- **Severity:** Low
- **Locations:** `src/cloud/migrate/migrationRows.js` — `PROJECT_LEFT_AT_HOME`, `CLOUD_PROJECT_STATUSES`, `projectValuesLeftOut`, `entityOf`, `VERSION_TYPES`, `LINE_SHEETS`, `ACTUAL_SOURCES`, `FILE_REF`, `PEOPLE_MATCH_ROLES`, `normalizeEmail`, `MEMBER_ROLES`, `ASSIGNMENT_DATES`, `RATE_CARD_TYPES`, `RATE_ENTRY_TYPES`, `templateTasksForCloud` (15; no test reads them either); `src/cloud/migrate/runMigration.js` — `EDIT_NAME_TAKEN`, `PEOPLE_WHY`, `TEMPLATE_NOT_OURS`, `MANAGED_WORDS` (4); `src/cloud/connectionWatchdog.js:122` `BODY_BYTES_PER_SECOND`.
- **What:** N1 removed the `export` keyword from 142 bindings of this shape; M1–M3 and S1 added these after. No runtime cost; a wider module surface than anything uses.
- **Fix shape:** drop the `export` keyword on all 20.
- **Evidence:** MEASURED.

---

## Not redundant, by design

- **Every page mounted at launch** (handbook §13.4). Why C3 targets subtrees that already mount on demand, never whole pages.
- **`withTimeout` races without aborting** for sign-in work (`withTimeout.js:16-19`), and the watchdog aborts the SDK's own requests at 20 s (RECONNECT_DESIGN §3). A7 adds an aborting sibling; it does not replace either.
- **`supabaseClient.js` + `connectionWatchdog.js` + `heldSession.js`** — one design split across three modules (RECONNECT_DESIGN §3, §11).
- **R.A.B.B.I.T.'s connection dot and the watchdog's pings** — different questions (RECONNECT_DESIGN §4): the dot reports three services all the time; the strip reports a hang.
- **`localData.js` caches against `userState.js`'s account rows** (handbook §3.2, S31); `rabbit.adapterMode`, `rabbit.activeProjectId` and `storageLocation` per device on purpose.
- **Two `sign_in` rows** (the client's and the password hook's) — `authEvents.js:13-16`.
- **`sessionStorage.js`'s per-surface key and `supabaseClient.js`'s `storageKey`** — two keys, two jobs (`supabaseClient.js:35-41`).
- **`activeModel.tuningFor` over `aiModels.tuningFor`** — a wrapper adding the operator's effort, not a copy (`activeModel.js:66-80`).
- **O.T.T.E.R.'s migration reading with raw `fetch`, never `otterFetch`** (handbook §13.4), and `runMigration.js`'s own local reads.
- **The app's close question is hand-rolled** (`App.jsx:3092-3125`: binUi's `APP_QUESTION` marker and C1).
- **`UndoToast` as the kit stack's pinned row** (`src/ui/Toast.jsx:61-73`) and **`PetNotice` pushing onto the kit stack** (its header).
- **One project channel and one workspace channel**, fanned out by `RabbitProvider.subscribeWorkspaceEvents` (handbook §4.5): no second subscription to a table exists; consumers reloading on events is the stated pattern (only their reload code is duplicated, A12).
- **`StorageConnections` (this computer) and `StorageSection` (the workspace)** — two different settings (handbook §12.7).
- **The dev fixtures mirror the adapters** and are dropped from every production build (`src/main.jsx:55-68`, `src/dev/devFixtures.js:9-16`).
- **The kit's status family** (`StatusDot` → `StatusBadge` → `StatusBanner`) composes; nothing in `src/ui` duplicates another kit component.
- **`workspaceStorage.js`'s cached read** (in-flight dedupe and a generation guard) — the pattern B1 and B2 should copy, not a duplicate.
- **The unread tokens in `src/ui/tokens.js`** — kept by N1 as the kit's token surface (D1).
