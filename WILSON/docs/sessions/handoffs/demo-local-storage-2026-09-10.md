# Hand-off — demo sprint, local storage — 2026-09-10

Session: Fable 5.1 at max effort, worktree `funny-leakey-5a12fd`, branch
`demo/local-storage`. Brief: `docs/sessions/DEMO_LOCAL_STORAGE_BRIEF.md`.
Protocol: `docs/sessions/HANDOFF_PROTOCOL.md` §4 order below.

## 1. Where you are

- Item: **local storage** for the Friday 2026-09-11 demo (the second session
  of the sprint; the bin session runs in parallel on `demo/bins`).
- Branch `demo/local-storage`, pushed. Commits, oldest first:
  - `2ab285f` feat(local-demo): the root-aware data layer, the module, the
    IPC, the Storage card — **integrated** onto `feat/demo-2026-09-11`
    (fast-forward 88c96bd → 2ab285f).
  - `6b053f3` docs: walkthrough 18 + handbook §12.8.
  - `862fbc8` feat: demo comfort (Create demo project, Reset demo folder).
  - the commit after it: fix(local-demo): review round 1 (§3a) — code,
    docs and this hand-off together.
- **Everything on `demo/local-storage` is integrated** onto
  `feat/demo-2026-09-11` at the end of this session. Verify:
  `git log --oneline origin/feat/demo-2026-09-11 -1` names the same commit
  as `git log --oneline origin/demo/local-storage -1`. If it does not, the
  last push was rejected (someone integrated in between): merge
  `origin/feat/demo-2026-09-11` into the branch again and re-push.

## 2. State, measured

- vitest: **1752 / 73 files** (base 1706 / 71). New: `src/lib/localDemoRoot.test.js`
  (24), `src/lib/localDemoWiring.test.js` (14 incl. seed/reset).
- CI on the integrated head `2ab285f` (public GitHub API, check-runs): Vitest
  ✔, pgTAP ✔, Playwright auth (wilson-dev) ✔, issue-session smoke ✔, Vercel
  Preview Comments ✔.
- CI on the branch head `862fbc8`: Vitest ✔, Playwright auth ✔,
  issue-session smoke ✔, **pgTAP ✘ at step 3 "Install Supabase CLI"** (15 s
  into the job, before any test ran; no SQL or workflow file changed between
  2ab285f and 862fbc8 — `git diff --name-only 2ab285f 862fbc8 -- supabase
  .github` is empty). A CLI-download transient, not this branch; re-read the
  run on the next push.
- No migrations, no Edge Functions, nothing deployed. Cloud parity is not
  part of this item.
- Measured in the real Electron window (my instance, scratch userData via
  `WILSON_USER_DATA`, scratch folder `demo-smoke`): the project bundle and
  the project folder land inside the demo folder and `userData/rabbit-data`
  is never created; Close folder returns to app data; a renamed folder reports
  missing on the next launch; reset removes exactly `projects/` and
  `.wilson/rabbit-data`; the seed's row shapes are accepted by the local
  scene/shot routes and their folders appear on disk.
- Offline, signed OUT, with `WILSON_DEV_OFFLINE=1`: the sign-in screen is
  up immediately, the local server answers `/api/rabbit/projects` in 3 ms,
  every cloud request fails in 0–2 ms (status 0) — no spinner, no wait. The
  company step degrades to a derived slug (existing design); sign-in itself
  cannot succeed offline, by Audrey's rule.

## 3. Done and verified

| What | Commit | How verified |
|---|---|---|
| `electron/localDemoRoot.cjs`: manifest, pointer + recent list, adopt/initialise/ask, shape check (win32 + posix), reset | 2ab285f, 862fbc8 | unit tests against real temp folders; Electron smoke |
| `getRabbitDataDir()` / `getThumbCacheDir()` / `resolveConfiguredRootDir()` root-aware, names and signatures unchanged | 2ab285f | wiring test pins; smoke: bundle at `<folder>/.wilson/rabbit-data/projects/<id>/project.json`, project folder at `<folder>/projects/<slug>/` |
| `folderRootRefusal` demo arm, relink roots, `readRabbitBundle` folder_root rebase | 2ab285f | wiring test pins; review round (§4) |
| IPC `local-demo:*` + preload bridge; `open` only for dialog-picked or remembered folders | 2ab285f, 862fbc8 | wiring test; driven over CDP from the renderer |
| Settings → Storage card: full path, Change folder…, Open in Explorer, Close folder, recent folders (Open / Forget), missing-folder state, foreign-folder confirm, Create demo project, Reset demo folder… | 2ab285f, 862fbc8 | rendered and clicked in the Electron window while the shell was open (screenshots in the scratchpad during the session; the signed-in run is Audrey's) |
| **No entry on the sign-in screen** — Audrey, 2026-09-10: *"remove the work locally button at login. user still needs to login no matter what."* The first cut had one and a `localMode` shell gate; both were removed and `localDemoWiring.test.js` pins that `LoginScreen.jsx` and `App.jsx` carry nothing of this feature | 2ab285f | test + `git diff 88c96bd 2ab285f -- src/App.jsx src/cloud/auth/LoginScreen.jsx` is empty |
| Dev-only knobs `WILSON_USER_DATA`, `WILSON_DEV_OFFLINE=1`, gated on `!app.isPackaged` | 2ab285f | wiring test; used for every measurement above |
| Walkthrough `docs/walkthroughs/18_local_demo_folder.md` (sent to Audrey with SendUserFile), handbook §12.8 | 6b053f3, 862fbc8 | — |

## 3a. Adversarial review round 1 (subagent, model opus) — verdict and what was done

Verdict as delivered: *"the folder boundary does not hold, and the feature
as committed does not run."* Every finding was reproduced by reading the
code and fixed in the commit after `862fbc8` (see `git log`):

| # | Finding | Fix |
|---|---|---|
| H1 | The card imported the client's `pickLocalFolder` under the name of a callback it already had; the local const shadowed it, so *Choose a demo folder…* ran the files-root picker, repointed `defaultRootDir` and threw. The pick path was never reached in the window (the earlier UI runs used the since-removed sign-in entry and the recent list). | Import alias `pickDemoFolder`; wiring pins the alias and forbids a local declaration. |
| H2 | `reset()` deleted a `projects/` that existed before WILSON opened the folder ("use it anyway"). | Manifest `created_layout` provenance at initialise; `reset()` refuses without it (older manifests refuse too); two-pass check-then-delete. |
| H3 | `resolveProjectFolder` & co. join the RAW `folder_slug` (S40 hardened only `resolveProjectFolderRoot`); a copied folder's bundle with `..\..` escaped the root and dragged the relink authorisation along. | `readRabbitBundle` re-slugifies `folder_slug` once, before anything joins it. |
| M4 | `reopenLocalFolder` retried with `allowForeign: true` on its own — the ASK rule switched off for every remembered path. | It takes `confirmForeign` like the pick flow; the card passes it. |
| M5 | A files-root pick (`userAuthorizedDirs`) authorised `local-demo:open`. | Own `demoAuthorizedDirs` set, written only by `local-demo:pick`. |
| M6 | Missing folder → resolvers fell through to userData for every writer. | `localDemoMissingGuard` (503 with a sentence) mounted ahead of `/api/rabbit`. |
| M7 | Lexical containment; a `.wilson` junction made `reset()` delete outside. | Folders stored by real path; `reset()` re-checks real paths before `rmSync`. Junction test on Windows. |
| L8 | Demo arm of `folderRootRefusal` allowed a project folder inside `.wilson`. | Refused. |
| L9 | Rebase overwrote a `folder_root` that still existed elsewhere. | Rebase only when the stored path is gone; `relinked` event logged. |
| L10 | `appDataProjectCount` had no reader. | Removed. |
| N12 | Offline regex accepted a userinfo trick. | `new URL().hostname === '127.0.0.1'`. |
| N13 | 3+ leading separators passed the shape check and were rebased onto the process drive. | Refused. |
| adjacent | `DELETE /api/rabbit/projects/:id` and `getRabbitProjectDir` joined a decoded `..%2F` id; the base is now the user's folder. | Contained with `resolveContainedFilePath`; traversal is 404. |

Not changed, recorded as policy questions for Audrey (§6): an open demo
folder outranks a signed-in byos workspace root in `resolveConfiguredRootDir`
/ `folderRootRefusal`; the S34 admin gate is renderer-only for `open / close /
forget / reset`. A second round was not run.

## 4. In flight

- **Integrate the post-review commit(s)** (plan §2 step 3):
  `git fetch origin && git merge --no-ff origin/feat/demo-2026-09-11 && npx
  vitest run && git push origin HEAD:feat/demo-2026-09-11` — done at the end
  of this session if `git log origin/feat/demo-2026-09-11` shows the commit
  above `862fbc8`; otherwise do it first.
- **Audrey's signed-in run-through of walkthrough 18.** Nobody has yet seen
  the Storage card in a signed-in session: my instance cannot sign in (no
  credentials, by rule), and Audrey's sign-in on my test window was refused
  by wilson-dev (see §6).
- **Offline, signed in** (brief §3.3): not measured. Needs a session saved
  while online, then `set WILSON_DEV_OFFLINE=1 && npm run electron:dev`. Read
  `docs/walkthroughs/18_local_demo_folder.md` "The cable pulled" for the
  known one-hour token limit. Audit targets if something waits: `App.jsx`
  effects keyed on `authed` (onboarding query, `loadModelSources`, MFA
  `listFactors`, `fetchWorkspaceStorage`), `MigrationPanel`, `usePermissions`.
- **Adopt existing Local Server projects into the folder** (brief §3.2, Q3):
  not built; the card reports `appDataProjectCount` from `localDemoState()`
  but shows no button yet. Build only if Audrey says yes.
- **Seed content** (Q4): `planDemoProject` in `localDemoClient.js` is a
  placeholder (two scenes, five shots, generic names). Replace with what she
  names.

## 5. Traps hit

- `npm install --ignore-scripts` skips Electron's postinstall, so
  `node_modules/electron/dist` is missing and `electron .` throws "Electron
  failed to install correctly". Fix without a download:
  `export ELECTRON_OVERRIDE_DIST_PATH="C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/node_modules/electron/dist"`
  (same 33.4.11).
- **`npm run dev` is the browser build** — no Express server, no bridge, no
  Local Server mode. The Electron window loads `dist/`, so `npm run build`
  (or `build:dev`) before `electron .`; her `npm run electron:dev` does both.
- Driving the Electron window: launch with `--remote-debugging-port=9222`
  and talk CDP from Node (a 40-line script: `Runtime.evaluate`,
  `Page.captureScreenshot`, `Network`/`Log` events). The in-app Browser pane
  cannot reach an Electron window. Native dialogs cannot be driven; test
  `open` on remembered folders instead.
- **Test windows appear on Audrey's screen.** She maximised one, opened
  Settings in it, and tried to sign in on it. Say in the chat when a window
  is a test instance, and never screenshot the sign-in form.
- `%APPDATA%\wilson` was readable in this session (not virtualised as the
  brief says). Do not touch it; use `WILSON_USER_DATA`.
- `pathContainment.test.js` scans a 1200-char window from
  `function isUserAuthorizedRelinkDir` and expects `isPathInside(` inside it:
  one added line with a long comment pushed it out. Keep additions there to
  one short line.
- `checkFolderRootShape` (pathContainment) is Windows-only by design (drive
  or UNC); a posix path fails it. The demo module has its own
  `checkDemoFolderShape` so a Mac laptop and the ubuntu CI runner work.
- The whole shell is gated on `authed` (`App.jsx` `{authed && (`); a signed-
  out local mode needed a second gate — removed on Audrey's instruction.
- **Sign-in on the desktop dev build goes to wilson-dev** (`.env.development`
  and `.env.local` both point at `eqjzmnvkrakroyqxfsvw`, same anon key). The
  resolver knows username `audrey` in workspace `petal` (email
  `ad…@petalstudios.co`); GoTrue answered 400 invalid_credentials to her
  password. That is the wilson-dev password, not the beta one.
- The auto-mode classifier can go temporarily unavailable ("claude-sonnet-5
  is temporarily unavailable"); read-only tools keep working, Bash comes
  back after a minute.
- Heredocs with many quoted blocks in one Bash call failed to parse; the
  reliable way to patch a 4,000-line file is a spec file + a tiny Node
  script doing exact single-occurrence replacement (Edit-tool semantics).

## 6. Waiting on Audrey

- Answers to brief §6: **Q1** built as recommended (bundles + thumbnails
  under the folder); **Q2** O.T.T.E.R. and the pet stay in userData; **Q3**
  adopt-existing is NOT built (start empty); **Q4** seed content placeholder;
  **Q5** recent-folder switching built; **Q6** which machine / OS.
- Her decision recorded 2026-09-10: no sign-in-screen entry; login required.
- The wilson-dev password (or a reset via "Forgot password?") so she can run
  walkthrough 18 signed in, and report.
- Whether "Sign in shortly before going offline" is acceptable for Friday, or
  whether she wants a longer JWT expiry on wilson-dev (a Supabase auth
  setting, not code).

## 6a. Cross-session note (the bin session)

`origin/demo/bins` (f7e67ac at the time of writing) merges cleanly onto the
integration branch (`git merge-tree --write-tree` reports no conflict) and
injects `getThumbCacheDir` into its mount, so it builds on the root-aware
helper. One likely defect, relayed to that session by message on
2026-09-10: its mount block in `startLocalServer` sits AFTER the SPA
catch-all `expressApp.get('/{*splat}')`, so its `expressApp.get(...)` routes
(bins list, thumbnail, stream) answer with index.html in the real window
while its route tests stay green. The fix is theirs: move the mount above
the static/catch-all lines. Check it landed before Friday.

## 7. Next session's first three steps

1. `git fetch origin && git checkout -b demo/local-storage-2 origin/demo/local-storage`
   (or `git checkout demo/local-storage` if continuing the same branch — note
   the worktree-ref trap in protocol §6), then
   `npm install --ignore-scripts && git checkout -- package-lock.json`, copy
   `.env.local` from the canonical checkout into `WILSON/`, set
   `ELECTRON_OVERRIDE_DIST_PATH` as in §5.
2. Read this file, then `docs/sessions/DEMO_LOCAL_STORAGE_BRIEF.md` and
   `docs/walkthroughs/18_local_demo_folder.md`; run `npx vitest run` (expect
   1752 / 73 or more).
3. Take Audrey's walkthrough report and her answers to Q3/Q4 as the work
   list; integrate anything unintegrated first (§4).

## 8. Auto-memory: none

This file is the memory.
