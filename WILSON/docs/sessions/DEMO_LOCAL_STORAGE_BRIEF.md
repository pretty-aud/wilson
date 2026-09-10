# Local storage for the demo — brief for the second demo-sprint session

Audrey, 2026-09-08 (verbatim, this is the spec):

> local storage solution - for demo-ing i need the ability to use the system
> and not need a server or a cloud solution. I want to be able to setup a
> local folder on my local storage just to demo the system

And on 2026-09-10: *"start local storage"* — this session runs **in parallel
with the bin-system session** (`DEMO_BINS_BRIEF.md`), on the same integration
branch. §2 says how the two stay out of each other's files.

Read this file, then `DEMO_2026-09-11_PLAN.md` §0 (what exists), §2 (branch
mechanics — unusual, follow exactly), §4 (rules), §7 (the demo script this
enables), then `HANDOFF_PROTOCOL.md` §2 (worktree setup) and §4 (hand-off
file). You have **no memory of this repo** beyond `docs/`.

**Model:** Fable 5.1 at max effort (Audrey's default for new sessions from
2026-09-09). State your model in your first line; if it is not Fable 5.1,
stop and tell her.

**Deadline:** Friday 2026-09-11 afternoon for the whole demo. This item is
the foundation the demo script starts on, so aim to have it integrated and
walkable **by Wednesday night**, then support the bins session and fix what
Audrey's run-through finds.

---

## 1. What "local storage" means here

The story Friday opens with: open WILSON on a laptop, signed out, no
internet, no Supabase, no NAS. Choose **one folder** on the local disk.
Everything the demo creates from then on — projects, their files, thumbnails,
the bins the other session is building — lives under that folder. Close the
app, reopen it, it is all there. Copy the folder to another machine, point
WILSON at it, same demo.

What exists today (measured 2026-09-10; verify before relying on it):

- **Local Server mode** is the desktop's signed-out, single-user backend: the
  in-app Express server in `electron/main.cjs`, chosen at **Settings → Storage
  → `Storage Backend` → `Local Server`** (`adapterMode: 'local_server'` in
  `src/lib/userState.js`; the label logic is in `SettingsPage.jsx` around
  line 688). There is **no "work locally" entry on the sign-in screen** — a
  fresh user has to know to open Settings.
- **Project bundles** (`readRabbitBundle` / the JSON write helper) live in
  `userData/rabbit-data/` — Electron's per-user app data, NOT under any
  user-chosen folder. `getRabbitDataDir()` (`main.cjs:57`) is the root of
  that; `getThumbCacheDir()` (`:180`) sits under it; `getDataDir()` (`:42`) is
  O.T.T.E.R.'s `otter-data`, a separate root.
- **Project FILES** resolve under a configurable root:
  `rabbit-data/files-config.json` → `{ defaultRootDir }` (`readFilesConfig`,
  `:105`; `resolveConfiguredRootDir`, `:111–117`, where a cloud workspace's
  configured root wins over the per-machine default); a project's folder is
  `project.folder_root || resolveConfiguredRootDir()` + `project.folder_slug`
  (`:1674`). The renderer sets `defaultRootDir` from the
  `src/components/settings/StorageConnections.jsx` card through the preload
  bridge (`readFilesConfig` / `writeFilesConfig` → IPC
  `rabbit:read-files-config` / `rabbit:write-files-config`, `main.cjs:3556`).
  So half of the feature exists: files can already live in a chosen folder;
  the project data and thumbnails cannot.
- **Path containment** is a rule, not a suggestion: `electron/pathContainment.cjs`
  and the "folder the user picked through the OS dialog IS the authorization"
  comments (`main.cjs` around `import-folder` and the relink routes). Every
  path you resolve under the chosen folder goes through it.
- `src/lib/localData.js` is the per-machine cache for the pet, O.T.T.E.R.
  settings and agent skills — signed-in accounts own the truth. Leave its
  authority model alone.

---

## 2. Ownership against the bin session (both run now)

| You own (nobody else edits) | The bin session owns |
|---|---|
| `electron/main.cjs` data-root layer: `getRabbitDataDir`, `getThumbCacheDir`, `readFilesConfig` / `writeFilesConfig`, `resolveConfiguredRootDir`, the files-config IPC, the folder dialogs; `electron/preload.cjs` for any new IPC; `electron/pathContainment.cjs` | `electron/rabbitBins.cjs` (its routes; mounted from `main.cjs` with one line), `views/BinsView.jsx`, the `bins` entry in `components/ViewTabs.jsx`, `views/ScenesView.jsx` (its milestone 2), its `// --- bins ---` adapter blocks |
| `src/components/settings/StorageConnections.jsx`, the Storage tab of `SettingsPage.jsx`, `src/lib/userState.js` local-mode bits, the signed-out entry (see §3.1) | nothing in Settings or sign-in |

Rules:

- **Keep helper names and signatures stable.** The bin session writes bytes
  through the existing managed-files plumbing and calls your helpers; it never
  hardcodes `userData`. If you must change a signature, do it in one commit,
  integrate immediately (plan §2 step 3), and say what changed in the commit
  message — that is the other session's only channel.
- **`main.cjs` outside the data-root layer:** one mount line per session; do
  not reflow or reorder routes.
- The files the paused tracks changed (plan §1 list) are touch-minimally:
  `SettingsPage.jsx`, `userState.js`, `App.jsx`, `LoginScreen.jsx`,
  `main.cjs`, `preload.cjs` are all on it. Add small, delimited pieces; never
  restructure. For the sign-in screen (Track B rebuilt it): render your entry
  point as **one new component** mounted from `LoginScreen.jsx` with a
  one-line hook, not an edit through its body.

---

## 3. What to build

### 3.1 The way in

- From the signed-out sign-in screen, a clear **"Work locally"** (or "Open a
  local demo folder") entry: one click → OS folder dialog → the app is in
  Local Server mode with that folder as its root, no account, no network.
- The same entry from Settings → Storage, with the current folder shown in
  full, a **Change folder…** action, and an **Open in Explorer** action.
- First launch after choosing a folder that already contains a WILSON demo
  (see the manifest in 3.2): adopt it, do not reinitialise. A folder that is
  empty: initialise it. A folder that is neither (random files): ask.

### 3.2 Where things live

- **Everything under the chosen folder**, in a layout a person can read:
  ```
  <folder>/
    wilson-demo.json          # manifest: version, created, app version, last opened
    projects/<slug>/          # the project's files (today's folder_slug layout)
    .wilson/rabbit-data/      # bundles, files-config, thumbnails cache
  ```
  (Adjust the names to what the code already calls things; the point is one
  folder, self-describing, copyable.) Ask Audrey (§6) whether the bundles
  should move under the folder — recommend **yes**, that is what makes it a
  demo she can carry.
- `getRabbitDataDir()` and `getThumbCacheDir()` become root-aware: when a
  local demo folder is active they resolve under it; otherwise exactly as
  today. Existing Local Server data in `userData` keeps working when no folder
  is chosen — **do not migrate anyone silently**; offer "adopt existing local
  projects into this folder" as an explicit action if she wants it.
- The active folder is remembered per machine (a small file in `userData`,
  plus a **recent folders** list so she can switch between demo folders).
- Relative paths inside the folder so a copied folder still resolves; a
  missing folder on launch (drive unplugged) gets a plain message and the
  choice to locate it or pick another, never a crash or a silent fallback to
  `userData`.

### 3.3 Offline and signed-out for real

- With the network cable pulled: no spinner, no blocked UI, no call to
  Supabase or Sentry that delays anything. Find every startup path that waits
  on the cloud (`fetch` resolves for every status here — look for silent
  empties as well as spinners) and make sure Local Server mode never waits.
- The pet, O.T.T.E.R. and the agent still open or degrade with an honest
  message; they are not the demo, they must not break it.

### 3.4 Demo comfort (only after 3.1–3.3 are integrated)

- A **seed**: "Create demo project" that makes a project with `scenes_enabled`
  on, a couple of scenes and shots, so the bins session and Friday's script
  have something to land on (ask Audrey what the sample should be, §6).
- **Reset demo folder** with a confirmation that names the folder and what
  it will delete — and never deletes anything outside it.

---

## 4. Done means

- Plan §7 steps 1 and 6 work end to end: launch signed out → Work locally →
  pick folder → new project → close and relaunch → it is all there; cable
  pulled → nothing changes. Verified in the real Electron window (`npm run
  dev`) against a scratch folder, screenshots in the hand-off.
- Vitest green (state the count; base 1706 / 71) with tests for the root
  resolution (folder active / not active / missing folder / containment) and
  the manifest adopt/initialise/ask logic.
- One adversarial review round minimum on the path-containment and
  folder-authorisation surface; a second if time.
- Integrated onto `feat/demo-2026-09-11` (plan §2 step 3), CI green on the
  pushed head (read by full SHA from the public GitHub API).
- Walkthrough `docs/walkthroughs/18_local_demo_folder.md` (16 and 17 are the
  bin session's) written for a person clicking, **sent to Audrey with
  `SendUserFile`**.
- `docs/SYSTEMS_HANDBOOK.md` gains a "Local demo folder" section (append, do
  not reflow); `docs/OUTSTANDING.md` gains only what is broken and unfixed.
- `%APPDATA%` is virtualized for Claude: you cannot read Audrey's running
  app's `userData`. Point your own dev instance at a scratch folder and ask
  her to look in Explorer for anything on her side.

---

## 5. Process, branch and hand-offs

```
git fetch origin
git checkout -b demo/local-storage origin/feat/demo-2026-09-11
npm install --ignore-scripts && git checkout -- package-lock.json
```
Copy `.env.local` from `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.env.local`
into this worktree's `WILSON/` (never commit it). No `supabase link`.

- Integrate per plan §2 step 3: `git merge --no-ff origin/feat/demo-2026-09-11`
  into your branch, vitest, `git push origin HEAD:feat/demo-2026-09-11`.
  **Never check out `feat/demo-2026-09-11`** (Audrey's checkout holds it).
  Push `demo/local-storage` early and often; CI runs on `demo/**`. Integrate
  the root-aware helpers as soon as they are green so the bin session builds
  on them.
- Hand off (protocol §1 triggers): `docs/sessions/handoffs/demo-local-storage-<YYYY-MM-DD>.md`,
  integrated, then a `spawn_task` chip titled `Continue demo: local storage
  (<what is left>)` whose prompt repeats the setup above, names this brief and
  the hand-off, and says Fable 5.1 at max effort.
- Do not touch a `track-*` branch, `feat/multi-user-v1`, staging or prod; do
  not deploy; do not spawn track chips (the fix tracks are paused); do not
  edit `src/tools/otter_v0.3.1/**`.
- Traps: `fetch` resolves for every status; enumerate exports and grep
  callers before committing; never `open(path, "w")` on a file you cannot
  regenerate; never a backslash in generated code (`chr(92)`); heredocs over
  ~100 lines fail (Write tool); a `<!--` in a long markdown file has deleted
  227 lines here.

---

## 6. Questions for Audrey (ask in one numbered message, with your recommendation beside each)

1. Should the project data (bundles, thumbnails) move under the chosen
   folder, so the folder is the whole demo and can be copied? Recommend yes.
2. Is O.T.T.E.R.'s local library part of the demo folder, or does it stay
   where it is today? Recommend: stays.
3. When she picks a folder for the first time, should the app offer to adopt
   the Local Server projects already on the machine, start empty, or both?
4. Does she want a seeded demo project (with scenes and shots turned on), and
   what should it contain? Which sample footage folder will the demo use?
5. Should she be able to switch between several demo folders (recent list)?
6. Does the demo run on this workstation only, or also on a laptop — if a
   laptop, which OS, so the folder-copy path is tested on it?
