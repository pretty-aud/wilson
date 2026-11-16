# Review: the desktop main process and the build (redundancy, near-duplicates, efficiency)

Read-only review, 2026-10-31. Nothing in the tree was changed, built, installed or run.
`ROOT` = `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\post-overhaul-merge` (detached at the integration tip).
Paths below start at `WILSON/` or `.github/` under ROOT. Line numbers are from this checkout.
Each finding was checked against `WILSON/docs/OUTSTANDING.md` (and, where relevant, `TPN_AUDIT/FINDINGS.md`, handbook §17 and the hand-offs) before it was written; "Recorded" says what was found.

---

## Measured facts

| What | Count |
|---|---|
| `electron/` modules | 25 `.cjs` files, 14,295 lines |
| Largest files | `main.cjs` 5,663 lines (309,388 bytes) · `rabbitBins.cjs` 2,389 · `rabbitShotLists.cjs` 1,065 · `rabbitTableViews.cjs` 853 · `rabbitTaskItems.cjs` 536 · `localDemoRoot.cjs` 531 · `ffmpeg.cjs` 415 · `projectFileStream.cjs` 357 |
| Local server routes | 178 literal registrations (main.cjs 100, rabbitBins 43, rabbitTableViews 10, rabbitShotLists 8, localMedia 6, rabbitTaskItems 4, projectFileStream 2, projectFilePatch 2, connectionProbe 1, fileReads 1, spaFallback 1) → about 235 endpoints at runtime (19 factory registrations × 3 verbs + 1 restore, and the 4-entity thumbnail loop). Handbook §3.1 still says 89 / ~144. |
| IPC | 46 registrations in `main.cjs` + 7 in `updater.cjs`, all through the gate (50 channels) |
| Project bundle I/O | `readRabbitBundle()` at 40 call sites in main.cjs + 11 in modules; `writeRabbitBundle()` at 68 sites, 46 of which also rewrite the six `_DATABASES` mirror files |
| Synchronous fs in `main.cjs` | 139 `existsSync`/`statSync`/`readdirSync`/`realpathSync` calls; 4 uses of `fs.promises` |
| Tests coupled to the main process | 34 test files reference `main.cjs`'s source by path; 63 reference `electron/` modules |
| `scripts/` | 34 top-level scripts (33 `.mjs` + 1 `.py`, 9,704 lines) + 11 in `probes/` (3,039 lines). `package.json` runs 2; CI runs 1 + 3 probes; tests or other scripts import 10; 17 launch their own Chromium |
| `package.json` | 28 dependencies + 15 devDependencies = 43; 20 npm scripts; 2 packagers (the `build` key → electron-builder; `forge.config.cjs` → electron-forge) |
| Workflows | 4 files, 1,655 lines (`rls.yml` 879, `gateway-release.yml` 378, `gateway.yml` 293, `backups.yml` 105) |
| Renderer bundle | main chunk 5,000,463 bytes as measured 2026-10-29 (`docs/design/RECONNECT_DESIGN.md` §14.9). The `dist/` in this worktree is from 2026-09-29 and was not used. |

25 findings: A 10, B 6, C 6, D 3. Ranked inside each section by how much code or runtime the fix would save; severity is the risk of leaving it.

---

## A. Near-duplicate functions

### A1. Six implementations of "where is this project's folder on this computer"
- **Severity:** High · **MEASURED** (the copies and how they differ) / **INFERRED** (that they diverge in use)
- **Where:** `WILSON/electron/main.cjs:1728` (`resolveProjectFolder`) and `main.cjs:2808` (`resolveProjectFolderRoot`); renderer `WILSON/src/tools/rabbit_v0.1.0/components/FileManager.jsx:724`, `:862`, `:909` and `components/entityFiles.js:104-112`. The project-slug fallback is retyped at `main.cjs:1737, 1799, 2049, 2134` (`'Untitled-Project'`) and `main.cjs:3927, 4382` plus `FileManager.jsx:686, 860, 907`, `entityFiles.js:110` (`'Untitled'`); the asset-slug fallback at `main.cjs:2868, 2911, 2956, 3967, 4391`.
- **What:** The two main-process resolvers answer the same question differently. `resolveProjectFolder` returns nothing unless `<root>/<slug>` already exists and uses the stored slug as it is; `resolveProjectFolderRoot` returns the path whether or not it exists and re-slugifies the stored slug (the S40 fix). The folder tree, mirrors, manifest, rates file and shot re-filing use the first; asset folders, managed-file bodies, thumbnails and the hard delete use the second. `main.cjs:3227-3236` already documents the hazard this creates: an asset made while the recorded folder was offline creates a fallback folder that later reads as the project's folder. The renderer rebuilds the rule four more times to compute the absolute `destDir` it hands to `rabbit:copy-file` and `rabbit:open-in-explorer`, without the existence or demo-folder checks and with a different fallback name.
- **Fix shape:** One main-side `projectFolderOf(bundle, { mustExist })` with `projectSlugOf` / `assetSlugOf`, and a copy IPC that takes the managed-file record id and resolves the destination through `resolveManagedFileDiskPath`, so the renderer never builds a disk path.
- **Recorded:** the uncontained `destDir` of `rabbit:copy-file` is already recorded as **TPN-NET-008** (its second fix). The six resolvers are not recorded.

### A2. Six thumbnail generators and three poster-acceptors; the hardening landed in one
- **Severity:** Medium · **INFERRED** (by reading)
- **Where:** generators `main.cjs:4151-4220` (managed file: sharp 256, `toFile`), `main.cjs:4293-4328` (asset: sharp 512, `toFile`), `main.cjs:4331-4363` (scene/shot/level/experience loop: the asset route's body again), `main.cjs:5516-5546` (four IPC channels generate/clear for asset and entity, the same sharp call), `WILSON/electron/rabbitBins.cjs:973-1020` (bin: sharp → buffer → `writePosterAtomically`, single flight `posterOnce`), `rabbitBins.cjs:2227-2283` (cloud bin: the same, inline `.part`, no single flight). Acceptors: `main.cjs:4244-4281`, `rabbitBins.cjs:1025-1039`, `rabbitBins.cjs:2210-2226` (same base64 decode, 262,144-byte cap, JPEG magic check).
- **What:** "Serve the cached JPEG, else make it once, atomically" is written six times. The bins' review round 2 fixed three defects in its own copy (two tiles racing on one write, a torn file then served forever, libvips failing past MAX_PATH so the write goes through Node's fs). The four sharp paths in `main.cjs` still write in place with no single flight; the cloud-bin copy has no single flight; the managed-file acceptor writes in place. The IPC generate path skips the `thumbnailSourceAllowed` check the GET routes apply (`main.cjs:4317`, `:4351`). Fourteen `res.sendFile(thumbPath)` calls (seven in each file) lack `dotfiles: 'allow'`, the one-argument fix the stream routes got.
- **Fix shape:** One `makePoster({ src, dest, edge, quality })` (sharp → buffer → atomic write, single flight; the ffmpeg arm through `generateVideoThumbOnce`) and one `acceptPoster(base64)`, with the asset/entity cache keyed by source path + mtime as `rabbitBins.thumbKeyFor` already does, so the GET alone suffices and the four IPC channels go.
- **Recorded:** the dot-folder 500 on the thumbnail `sendFile` calls is already recorded as **S4a-06**. The six copies are not.

### A3. Three hand-written families of JSON-file routes
- **Severity:** Low · **MEASURED**
- **Where:** O.T.T.E.R. `main.cjs:945, 1013, 1106, 1147, 1152, 1227, 1232, 1238, 1303, 1310, 1320, 1324` (eight GETs and four POSTs of the same two lines: read the file with a default, or write the body whole); workspace stores `main.cjs:4464-4611` (rate cards, team members, task templates: three identical `get*Dir` helpers, three `*Path` helpers, four list routes that `readdir` and parse every file on every request, near-identical POST/PATCH/DELETE).
- **What:** About 160 lines of one shape, while R.A.B.B.I.T.'s sub-entities already use a factory (`main.cjs:2651`).
- **Fix shape:** A `jsonDocRoute(route, file, default)` and a `flatStoreRoutes(kind, dir, filter)` factory, with the course folder resolved once through a contained `courseDir(slug)`.
- **Recorded:** the raw slug join is already recorded (OUTSTANDING, *O.T.T.E.R. software routes join a route parameter onto `getSoftwareDir()` raw*); the duplication is not.

### A4. Route scaffolding copied into every module
- **Severity:** Low · **MEASURED**
- **Where:** load-bundle-or-404 at `rabbitBins.cjs:354`, `rabbitShotLists.cjs:534`, `rabbitTableViews.cjs:594`, `rabbitTaskItems.cjs:437`, and 38 inline `if (!bundle) return rabbitNotFound(res)` in `main.cjs`; `fail()` at `rabbitShotLists.cjs:530`, `rabbitTableViews.cjs:588`, `rabbitTaskItems.cjs:434`; the same-origin test at `fileReads.cjs:30` (exported) and `rabbitBins.cjs:331`; `isDir`/`isFile`/`isAbs` at `rabbitBins.cjs:360-362` and again `:1689-1691`; the UUID regex at `main.cjs:480` and `:612`; the managed hard delete re-derives `resolveManagedFileDiskPath` inline (`main.cjs:4019-4023` vs `:2859`); OS dialogs opened from four HTTP routes (`rabbitBins.cjs:549, 562, 1994, 2006`) and four IPC channels (`main.cjs:5195, 5383, 5397, 5499`).
- **What:** Each module re-declares the same helpers. Each module's `load()` also re-runs a reconcile pass `readRabbitBundle` has already run ("a no-op there", their own comments say): one more walk over the arrays per request.
- **Fix shape:** `main.cjs` injects one route kit (`loadBundle`, `fail`, `notFound`, `isSameOriginRequest`, `pickWithDialog`) that the modules destructure instead of redefining.
- **Recorded:** no.

### A5. Six copies of "send this file's bytes safely", and they have drifted
- **Severity:** Medium · **MEASURED**
- **Where:** `main.cjs:3645-3653` (files download), `main.cjs:4136-4147` (managed-file stream), `WILSON/electron/fileReads.cjs:82-92` (files stream), `rabbitBins.cjs:1055-1068` (bin stream), `rabbitBins.cjs:2332-2345` (cloud-bin stream), `WILSON/electron/localMedia.cjs:281-294` (private-project media).
- **What:** Each sets the allowlisted Content-Type and `nosniff`, then `sendFile` with a cancel-tolerant callback. `Cache-Control: no-store` + `Pragma` reached the two bin copies only; the `Sec-Fetch-Site` same-origin gate is on the files and bin streams but not on the managed-file stream or local media; local media sends `private, max-age=0`.
- **Fix shape:** One `sendMedia(res, diskPath, { mime, attachmentName })` carrying no-store and the same-origin gate, called by all six.
- **Recorded:** the missing no-store on `main.cjs`'s routes is already recorded as **TPN-CONT-003** (open); **TPN-CONT-019** fixed the two bin copies only. The duplication is not recorded.

### A6. Four JSON writers; the one that holds the projects is not atomic
- **Severity:** Medium · **INFERRED**
- **Where:** `main.cjs:241-247` (`readJSON`/`writeJSON`: `writeFileSync` in place, no retry; used for every bundle, mirror, setting, store and pet); `WILSON/electron/localDemoRoot.cjs:225-231` (a second copy); `WILSON/electron/rendererStorage.cjs:148` and `:182` (`readKept`/`writeKept`: temp file + rename, retried on EPERM/EBUSY/EACCES); `main.cjs:4655-4665` (cloud-bins local paths: `.part` + rename); `rabbitBins.cjs:961` (`writePosterAtomically`).
- **What:** One job, four behaviours. The renderer's localStorage copy gets an atomic, retried write; the project bundles do not. A write Windows refuses (an indexer or antivirus lock) fails the route, and a torn `project.json` reads back as nothing because `readJSON` swallows the parse error (`main.cjs:242`): the project then answers 404 and drops out of the list (`main.cjs:2314`).
- **Fix shape:** Lift `writeKept`'s write-temp-then-rename-with-retry into one `writeJsonAtomic` (and one `readJson`) and use it wherever `main.cjs` and `localDemoRoot.cjs` write JSON.
- **Recorded:** no.

### A7. Two bounded folder walkers
- **Severity:** Low · **MEASURED**
- **Where:** `main.cjs:3765-3803` (files relink scan) and `rabbitBins.cjs:272-305` (`walkFolder`, "shared by prepare and relink-scan").
- **What:** The same caps (20,000 entries, depth 12), the same symlink following, the same realpath cycle set, the same dot-file and `node_modules` skip.
- **Fix shape:** Export `walkFolder` and call it from the files relink scan with an `onFile` that collects the size.
- **Recorded:** no (OUTSTANDING mentions `walkFolder` only for running on the main thread).

### A8. Two copies of the media tables inside the main process
- **Severity:** Low · **MEASURED** (compared programmatically)
- **Where:** `main.cjs:446` `VIDEO_EXTENSIONS` and `rabbitBins.cjs:54` `VIDEO_EXTS` (21 entries each, identical); `main.cjs:430` `THUMB_EXTENSIONS` (9) ⊂ `rabbitBins.cjs:59` `STILL_EXTS` (11: adds `.heic`, `.heif`); `localMedia.cjs:66` `MIME` (21) ⊂ `rabbitBins.cjs:77` `MIME_BY_EXT` (39; identical where they overlap).
- **What:** The same tables in two CommonJS files of one process (the renderer copies are a separate, test-pinned pair). Effect: a private project's `.mpg`, `.wmv`, `.mts`, `.m2ts`, `.mxf`, `.aif`, `.heic` is served from local media as `application/octet-stream` (`localMedia.cjs:95-98`) while the same file in a bin gets its media type.
- **Fix shape:** `main.cjs` and `localMedia.cjs` require the tables from `rabbitBins.cjs` (or from one `mediaTypes.cjs`).
- **Recorded:** no.

### A9. Two URL fetchers
- **Severity:** Low · **MEASURED**
- **Where:** `main.cjs:1357` (`/api/fetch-url`) and `main.cjs:1394` (`/api/fetch-raw`).
- **What:** The same AbortController, timeout and User-Agent scaffold. `fetch-url` reads the whole body with no cap; `fetch-raw` checks its 5 MB cap only after buffering everything.
- **Fix shape:** One `fetchCapped(url, { timeoutMs, maxBytes })` that stops reading at the cap, used by both routes.
- **Recorded:** the open proxy and the after-buffering cap are already recorded as **TPN-NET-002**; the duplicate scaffold is not.

### A10. The storage-root shape rule twice in main, and the inline copy has drifted
- **Severity:** Low · **INFERRED** (by reading; reachable only from an admin-set `workspace_storage` row, through the gated IPC)
- **Where:** `WILSON/electron/pathContainment.cjs:71` (`checkFolderRootShape`) and `main.cjs:5268-5293` (inline in `rabbit:set-workspace-root`). A third sibling, `localDemoRoot.cjs:73` (`checkDemoFolderShape`), is wider on purpose (posix).
- **What:** `pathContainment.cjs`'s header calls its function "the same refusals the workspace-root IPC handler makes inline". The inline copy lacks the device-namespace refusal (`\\?\…`, `\\.\…`), so `\\?\C:\x` passes as a workspace root (three components) while the same string is refused as a project folder.
- **Fix shape:** The IPC handler calls `checkFolderRootShape` and keeps only its own local-kind existence check.
- **Recorded:** no.

---

## B. Redundant systems

### B1. Hand-kept CommonJS twins of the renderer's rules
- **Severity:** Medium (largest code saving; correct today) · **INFERRED**
- **Where:** `WILSON/electron/rabbitTaskItems.cjs` (536 lines; header: "The RULES are … taskItemsModel.js's … copied here in CommonJS") ↔ `src/tools/rabbit_v0.1.0/state/taskItemsModel.js` (593); `rabbitTableViews.cjs` (853; header lines 29-30) ↔ `state/tableViewsModel.js` (598); `rabbitShotLists.cjs` (1,065; lines 114-118) ↔ `state/shotListModel.js` (684); `main.cjs:1766-1909` and `:3188-3203` (folder categories, `slugOrFallback`, `planEntityFolderFor`, `pendingShotRefilingFor`) ↔ `folderPaths.js` and the shot re-filing rule; `main.cjs:950-1083` (hotkeys and functions merges) ↔ `src/tools/otter_v0.3.1/adapters/otterRoutes.js:383, 449`.
- **What:** Two thousand-plus lines of rules exist twice because "a synchronous route cannot import an ES module". Each pair is held together by a parity test (taskItemsParity, tableViewsParity, shotListBackfillParity, folderParity, functionsMerge, hotkeysMerge, binMedia, videoThumbnails). Every rule change is written twice and tested twice.
- **Fix shape:** Generate the CommonJS copies from the ES modules at build time (esbuild already ships with Vite: `--bundle --format=cjs`) into a folder under `electron/` that electron-builder already packs, so one copy is hand-written and one build check replaces the parity tests.
- **Recorded:** no.

### B2. Two upload transports for project files; the base64 one has no caller
- **Severity:** Medium · **MEASURED** (no caller)
- **Where:** `WILSON/electron/projectFileStream.cjs:174-239` (POST `…/files`, base64 inside JSON) and `:241-354` (PUT `…/files-stream`); their two row builders `:194-226` and `:308-338`; `main.cjs:591` (`express.json({ limit: '50mb' })`); `main.cjs:4618` (`/api/extract-pdf`, a base64 data URL); `src/cloud/migrate/runAttachmentMigration.js:55-73` (32 MiB ceiling "because uploadFile base64-encodes").
- **What:** Since the demo (2026-09-11) `localServerAdapter.uploadFile` sends every upload to the PUT (`localServerAdapter.js:9`, `:468`); nothing in `src/` calls the POST (only `projectFileStream.test.js`). The two routes build the same row field by field. The 50 MB JSON limit now serves the dead POST and `extract-pdf`'s base64 body (the poster posts are ≤256 KB). The attachment migration's 32 MiB ceiling, and handbook §17's reason for it, describe a constraint that no longer exists.
- **Fix shape:** Remove the POST and keep one `fileRowFor()`, send the PDF to `extract-pdf` as a raw body the way `files-stream` does, and recompute the migration ceiling; the 50 MB limit can then shrink everywhere except the project write routes, which still receive whole rows of older projects that carry base64 D.O.G. attachments until "Move deck attachments into project files" has run.
- **Recorded:** no. Handbook §3.1 ("uploads ride base64 inside JSON") and §17 (the 32 MiB reason) are stale.

### B3. Two packagers; and `dist:publish` is `dist`
- **Severity:** Medium · **MEASURED**
- **Where:** `WILSON/package.json` `build` key and scripts `dist`, `dist:publish`; `WILSON/forge.config.cjs` with scripts `package`, `make`; devDependencies `@electron-forge/cli`, `@electron-forge/maker-squirrel`; dependency `electron-squirrel-startup`, required at every launch (`main.cjs:76`).
- **What:** Forge's config ignores `/public` (so the window icon `main.cjs:4934` loads is absent in its package), carries no ffmpeg, has the opposite asar default, and makes a Squirrel installer the updater cannot update (handbook §11). Its only recorded use is a dev package in `out\` (`docs/sessions/handoffs/demo-local-storage-2026-09-11.md:166`). `dist:publish` uploads nothing: electron-builder has no publisher for a generic feed (`node_modules/app-builder-lib/out/publish/PublishManager.js:247`, `case "generic": return null`).
- **Fix shape:** Make `npm run package` run `electron-builder --dir` (the shipping config, unpacked) and remove `forge.config.cjs`, both Forge packages, `electron-squirrel-startup` and `dist:publish`.
- **Recorded:** `dist:publish` uploading nothing is already recorded in `docs/PRODUCTION_RUNBOOK.md` step (f)5 (handbook §7.4 still says it publishes); Forge's degradation is described in handbook §11. The two-packager redundancy is not an OUTSTANDING entry.

### B4. Three "is this root reachable" probes
- **Severity:** Low · **INFERRED**
- **Where:** `main.cjs:5313` (`rabbit:probe-storage-root`: stat, readdir and a test write under a 5 s race), `WILSON/electron/connectionProbe.cjs:52` (`fs.promises.stat` on libuv's pool, 3 s, single flight), `rabbitBins.cjs:1642`, `:1732`, `:1780` (worker-thread stat, slot limit, answer cache; libuv stats capped at 2).
- **What:** One primitive written three ways. The bins version is the one BC2's review hardened to keep a dead SMB stat off libuv's four shared threads; the connection dot still stats on that pool (its header accepts holding one thread).
- **Fix shape:** Export the bins' `rootReachable` and use it for the dot and for the IPC probe's existence step.
- **Recorded:** no.

### B5. Two IPC paths for "show this file in its folder"
- **Severity:** Low · **MEASURED**
- **Where:** `main.cjs:5466` `rabbit:open-in-explorer` (any path the page sends) and `main.cjs:5480` `rabbit:open-path` with `reveal` (main resolves the row; `openPath.cjs`). `FileManager.jsx:874` and `:921` still build the path themselves (A1); `ProjectFilesExplorer.jsx:812` uses the row form. `src/components/Budget/InvoiceAttachment.jsx:79` and `:110` call `window.rabbitDesktop.openInExplorer`, a bridge the preload never exposes (a dead branch).
- **What:** The newer channel exists so the page names a row, never a path; two FileManager actions still send paths.
- **Fix shape:** Move FileManager's two reveals onto `openPath` by row, keep `open-in-explorer` for configured folder roots only, and delete InvoiceAttachment's legacy branch.
- **Recorded:** no.

### B6. Six env-file parsers
- **Severity:** Low · **MEASURED**
- **Where:** `WILSON/electron/env.cjs:20` (`parseDotenv`); `WILSON/scripts/probes/ai-models.mjs:67`, `deck-latency.mjs:47`, `generation-e2e.mjs:62` (three identical `loadEnvFile`), `connection-hang.mjs:49`, `resolve-login-limiter.mjs:45`.
- **What:** Six hand-written `.env` parsers with slightly different quote and whitespace rules. (`env.cjs` beside Vite's `import.meta.env` is not a pair: different processes, no bridge on purpose.)
- **Fix shape:** Node's own `util.parseEnv` / `process.loadEnvFile` (Node ≥20.12; Electron 33 ships 20.18, CI uses 22), or one helper the probes import.
- **Recorded:** no.

---

## C. Inefficiencies

### C1. Every R.A.B.B.I.T. request parses the whole project; every edit rewrites it and six mirrors, synchronously on Electron's main process
- **Severity:** High · **INFERRED** (counted by reading)
- **Where:** `main.cjs:1468-1636` (`readRabbitBundle`: full read, backfill, prune, reconcile, `ensureProjectFolders` with at least six `existsSync`, folder rows), `main.cjs:1637-1650` (`writeRabbitBundle`: the whole bundle, pretty-printed), `main.cjs:2046-2121` (`mirrorProjectDatabases`: six files on every touched write), `main.cjs:2306-2323` (the list parses every bundle to return `bundle.project`), `main.cjs:4151, 4293, 4333` (thumbnail GETs parse the bundle even on a cache hit); renderer `src/tools/rabbit_v0.1.0/adapters/localServerAdapter.js:305-950` (21 list methods GET the whole bundle to keep one key; only `loadProject`, `:199`, needs all of it).
- **What:** For a project with a folder on disk, one task PATCH is about 22 synchronous fs calls: one full read, one full write and six mirror writes (more with a demo folder open, since every root question stats it, `localDemoRoot.cjs:255`). 46 of the 68 bundle-write sites rewrite all six mirrors whatever changed. A gallery of N thumbnails parses the bundle N times; a screen that lists phases, tasks and files serializes and ships the whole bundle (file events, ingestion text) once per list. All of it runs in the process that also drives the window and IPC.
- **Fix shape:** Keep each bundle in memory keyed by its path and mtime (main is the only writer and holds the single-instance lock; the mtime catches a copied or hand-edited folder), reconcile once per disk load, add a `?keys=` projection to `GET /projects/:id`, write `project.json` compact, and mirror only the files whose keys changed (or debounce the mirrors).
- **Recorded:** the dead-share freeze is already recorded (OUTSTANDING, *The signed-out desktop's bins freeze the window on a share whose server does not answer*; handbook §17, *Synchronous fs on the Electron main process*). The steady-state cost on a healthy disk is not.

### C2. Listing a course's subjects rewrites every subject file
- **Severity:** High · **INFERRED** (counted from code)
- **Where:** `main.cjs:796-821` (`renumberSubjects`: reads every subject and writes every one back) called by `main.cjs:824-830` (`GET …/subjects`, a read); the library warm-up `src/tools/otter_v0.3.1/Otter.jsx:682-700` (7 GETs per course + 1 per subject) and again `Otter.jsx:2753-2757` (the quiz picker); `main.cjs:1258` (`/api/export-all` already returns all of it in one response).
- **What:** For a library of 6 courses and 49 subjects kept on this computer (the Local Server library), one load is about 92 requests, 98 subject-file reads and 49 subject-file rewrites; opening the quiz picker rewrites them again. With A6's in-place writer, a read can tear a lesson file.
- **Fix shape:** Make the GET read-only (POST, DELETE, `/renumber` and `/reorder` already set the order) and warm the cache from one bundle route shaped like `export-all`.
- **Recorded:** no.

### C3. Repeated per-call disk checks and config re-reads
- **Severity:** Low · **MEASURED** (counts) / **INFERRED** (cost)
- **Where:** eleven get-and-ensure-directory helpers with the same body (`main.cjs:130, 136, 151, 270, 394, 1435, 1454, 2383, 4464, 4531, 4565`; 27 `existsSync`+`mkdirSync` pairs in `main.cjs`); `configuredRoot` `main.cjs:293-303` re-reads `files-config.json` on every resolve though main is its only writer (`main.cjs:276`); `localDemoRoot.cjs:255` stats the demo folder on every root question; `WILSON/electron/ffmpeg.cjs:88` `resolveFfmpegPath` stats up to three candidates and runs at least four times per video poster (`main.cjs:4193`, `extractFrame`, two `runFfmpeg`).
- **What:** The same questions asked of the disk many times per request.
- **Fix shape:** Memoise the directories already made, hold `files-config` in memory after each write, and cache the ffmpeg path for a few seconds (still seeing a binary dropped in without a restart).
- **Recorded:** no.

### C4. The renderer ships one ~5 MB chunk
- **Severity:** Low · **INFERRED**
- **Where:** `WILSON/vite.config.js:53` (`chunkSizeWarningLimit: 2000`, no manual chunks); the full Prism highlighter imported statically in `src/components/PetCompanion.jsx:4`, `src/components/Resources/FilePreviewDialog.jsx:49`, `src/tools/otter_v0.3.1/FunctionCard.jsx:1`, `src/tools/otter_v0.3.1/Otter.jsx:5`.
- **What:** The main chunk was measured at 5,000,463 bytes (RECONNECT_DESIGN §14.9). `xlsx`, `jszip` and `mammoth` are already loaded on demand; the all-languages highlighter is not.
- **Fix shape:** `PrismLight` with the languages the app shows registered, or load the highlighter lazily.
- **Recorded:** no.

### C5. CI downloads Electron in two jobs that never launch it, and reinstalls Chromium every run
- **Severity:** Low · **INFERRED**
- **Where:** `.github/workflows/rls.yml:791-792` (unit: `npm ci`) and `:848-854` (e2e-auth: `npm ci`, then `npx playwright install chromium --with-deps`); compare `gateway.yml:85` and `gateway-release.yml:118` (`npm ci --ignore-scripts`).
- **What:** `electron@33.4.11`'s postinstall (`node install.js`) fetches the Electron binary (about 100 MB per handbook §3.2) in both jobs; no CI test starts Electron (they read `main.cjs` as text). Playwright's browser is not cached.
- **Fix shape:** Set `ELECTRON_SKIP_BINARY_DOWNLOAD: 1` on both jobs and cache `~/.cache/ms-playwright` keyed on the Playwright version.
- **Recorded:** no.

### C6. Duplicated CI steps and a hand-kept list of every suite
- **Severity:** Low · **MEASURED**
- **Where:** `rls.yml:702-716` and `:825-839` (the same secrets check), the four-secret env block five times (`rls.yml:705, 725, 741, 763, 828`); `gateway.yml:58-97` and `gateway-release.yml:92-128` (the tests job, step for step) and the MSI build (`gateway.yml:109-121` vs `gateway-release.yml:165-176`; only `gateway.yml` reads the MSI's tables back); `rls.yml:623` (the replay loop names all 103 suites, which is exactly the 103 files in `supabase/tests/rls/`) with 323 comment lines (`rls.yml:294-622`) recording its upkeep; `backups.yml` pipes `pg_dump -Fc` (already compressed) through `gzip -6` and downloads the AWS CLI on every run.
- **What:** The same steps maintained twice, and a list that has to be edited by hand for every new suite (handbook §7.1: "the replay list failing is silent").
- **Fix shape:** Job-level env, one reusable gateway workflow (`workflow_call`) for tests and MSI used by both files, a sorted glob for the replay, and `pg_dump -Fc` without gzip (the restore notes updated).
- **Recorded:** the replay-list hazard is documented in handbook §7.1, not in OUTSTANDING.

---

## D. Exports, channels, scripts and dependencies with no caller

### D1. Exports, IPC channels and routes nothing calls
- **Severity:** Low · **MEASURED** (grep across `src`, `electron`, `scripts`, `tests`, `gateway`)
- `electron/localToken.cjs` `localCorsOptions`: exported, used only inside the module.
- `electron/rabbitBins.cjs` `extOf` and `pathKey`: exported; the same-named functions in `src/` are the renderer's own.
- IPC `zoom-get` (`main.cjs:5627`) and `electronAPI.zoomGet` (`preload.cjs`): no renderer caller.
- IPC `rabbit:write-gdrive-config` (`main.cjs:5065`) and `electronAPI.rabbit.writeGdriveConfig`: no caller, so nothing in the app can create the `gdrive-config.json` that `googleDriveAdapter.js:73` needs (only the tokens are written, `:82`). Plaintext storage of both is already recorded as **TPN-ENC-002**.
- `/api/migration-needed` (`main.cjs:1292`) and `/api/migrate` (`main.cjs:1298`, whose whole body is "Migration handled client-side or not needed"), with their caller `Otter.jsx:1140-1147`: a check and a no-op POST on every O.T.T.E.R. mount.
- `POST …/files` (B2). `GET …/file-events` (`main.cjs:3722`) has no reader but is kept on purpose by its comment.
- `window.rabbitDesktop` (`InvoiceAttachment.jsx:79`): a consumer of a bridge that does not exist.
- By design and left out: `wilson:sentry-test` (a DevTools tool), and the many module exports used only by their own tests (the reason those modules were extracted).
- **Fix shape:** Remove each; the Drive channel only after she rules whether Google Drive gets a connect flow.
- **Recorded:** no (except TPN-ENC-002 for the Drive files' plaintext).

### D2. Scripts nothing runs, and the ones that overlap the two general tools
- **Severity:** Low · **MEASURED** (who runs, imports or names each)
- The plan's two general tools are `scripts/ui-walk.mjs` and `scripts/a11y-walk.mjs` (`docs/sessions/PLAN_TO_1_0.md` §5 rule 2; the N1 hand-off's last section).
- Overlapping `ui-walk`: `ui-page-check.mjs` (12 URLs; `ui-walk` walks 77 screens through the same `ui-measure.mjs`), `ui-probe.mjs`, `ui-clips.mjs`, `ui-shot-scrolled.mjs`, `ui-print-estimate.mjs` (each re-implements `ui-walk`'s open-the-project-and-click-by-text stepper), `ui-caret-check.mjs`, the five `timeline-*.mjs` probes, `tool-strip-probe.mjs`, `dog-preview-probe.mjs`, `signin-welcome-frames.mjs`, `gateway-fullscreen-guard.mjs`. Seventeen scripts launch their own Chromium, fifteen define their own `sleep`, fourteen their own project opener.
- No runner, importer or test mention: `otter-library-replay.mjs` (keep it: it is the replay against her real library the project's rules call for, so name it a third general tool), `tap-hosted.py`, `timeline-window-slide.mjs`, and the one-time codemods `ui-pass1-sizes.mjs` and `sweepOutlineNone.mjs`.
- `serve-web.mjs` (run by `preview:web` and Playwright) is a second static + SPA server that still sends `index.html` by absolute path, the form `electron/spaFallback.cjs` documents as failing under a dot-folder, which every session worktree (`.claude\worktrees\…`) is.
- **Fix shape:** Fold the stepper probes into `ui-walk` entries (a `--only` screen plus a measure hook), delete the applied codemods, and have `serve-web.mjs` reuse `sendSpaIndex`.
- **Recorded:** the survivors are left as "a later cut for the controller" in `docs/sessions/handoffs/po-n1-2026-10-27.md` (judgment 1), not in OUTSTANDING. The launch file's dead `v1-auth` entry and the session entries' borrowed `vite` are already recorded as **N1-02** and **N1-04**.

### D3. package.json dependencies
- **Severity:** Low · **MEASURED** (import grep plus each package's declared peers)
- None is dead. Every dependency is imported, run as a CLI, or a declared peer: `@tiptap/pm` (peer of `@tiptap/core` and `@tiptap/react`), `@tiptap/y-tiptap` (peer of `@tiptap/extension-collaboration`), `y-protocols` (peer of `@tiptap/y-tiptap`), `@testing-library/dom`, `@types/react`, `@types/react-dom` (peers of `@testing-library/react` / `@tiptap/react`), `jsdom` (Vitest's environment), `electron-builder` (CLI).
- The only ones that exist for something that does not ship: `@electron-forge/cli`, `@electron-forge/maker-squirrel`, `electron-squirrel-startup` (B3).
- One small overlap: the main process uses `crypto.randomUUID` (`main.cjs:1431-1433` says why), while the renderer imports `uuid` in 10 files where `crypto.randomUUID()` is also available.
- **Recorded:** no.

---

## Not redundant, by design

Each of these looks like a duplicate and is not; removing one would weaken a lock or break a stated rule.

1. **`windowGuard.cjs` (D2) + `ipcGate.cjs` (D3) + the per-launch token (B3) + path containment.** Layered locks; RECONNECT_DESIGN §14 calls D3 "the second lock behind" D2. Not a redundancy.
2. **`fromThisLaunchsPage` inside the three storage channels and the download channel**, behind the gate that asks the same rule (§14.2.6: kept on purpose, their pins stay).
3. **The token by header and by cookie.** Two carriers for one check: `fetch` can set a header, `<img>`/`<video>` cannot.
4. **Narrowed CORS beside the token.** `localToken.cjs`: CORS is not the gate, it is insurance for a future caller that sends an Origin.
5. **The `Sec-Fetch-Site` same-origin gate on the bins and file streams.** The launch cookie is host-scoped and `SameSite=lax`, so it would ride a request from another loopback port (same-site); only this header tells them apart. (The two copies of the *function* are A4; the *mechanism* stays.)
6. **Lexical `resolveContainedFilePath` + real-path `insideByRealPath`** in local media and open-path: a junction defeats the first alone.
7. **Three consent sets** (`userAuthorizedDirs`, `demoAuthorizedDirs`, `userAuthorizedImages`): S14's rule that a pick for one purpose is not consent for another.
8. **`rabbit:set-workspace-root` and `local-demo:*` over IPC instead of Express**: any script on the page's origin carries the cookie; IPC answers only WILSON's page.
9. **`safeMediaContentType` (main) and `inlineSafeBlob` (renderer)**: two sides of one rule.
10. **Main-side refusals that mirror renderer and database refusals** (`checkFolderRootShape` ↔ `src/lib/storageRoot.js`; `folderRootRefusal` ↔ migration 0049's guard): S34's "refusals in depth".
11. **The CommonJS ↔ ES-module twins** are correct and pinned today; B1 proposes generating one from the other, not deleting either.
12. **Two update feeds** (the `build.publish` URL compiled into `app-update.yml`, and `WILSON_UPDATE_URL` from `env.json`): handbook §11, an operator can repoint without a rebuild. Its missing validation is a recorded TPN posture note.
13. **`env.cjs` (main process, at run time) vs Vite's `import.meta.env` (renderer, at build time)**: different processes; `env.cjs`'s header says there is no bridge on purpose.
14. **The `downloaded` audit write throttled on the stream routes and not on the download route** (`main.cjs:4085`): a download is one request, a video is dozens.
15. **The preload's once-a-second localStorage diff**: RECONNECT_DESIGN §12.10 measured at most 0.4 ms for 200 KB.
16. **The static shell and SPA fallback outside the token** (handbook §3.1): a failed `cookies.set` must give a degraded app, not a white window.
17. **Two ffmpeg runs per video poster** (duration probe, then extract): no ffprobe is shipped, the probe picks a better frame, and one 45 s deadline bounds both (`ffmpeg.cjs:150-275`).
18. **`session-a/b/c` in the launch file**, identical but for the port: the plan's three fixed entries.

---

## Noticed outside the brief (one line each, not counted)

- OUTSTANDING holds the bins dead-share freeze twice (the MEASURED entry at line 272 and the INFERRED one at line 1507), and *A file dropped on any tab other than Bins may navigate the window to it* (near line 1517) describes what D2's `windowGuard.cjs` and `dropGuard.js` fixed.
- `@monaco-editor/react` loads the editor from its CDN unless a loader path is configured, and no `loader.config` exists in `src/`: O.T.T.E.R.'s code editor needs the network on the desktop (INFERRED, not run).
