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

---

## 7. Audrey's clarification and decision, 2026-09-10 (after §3 was built)

Seen in a signed-in staging test window whose fresh app data defaulted the
Storage Backend to Local Server, so her cloud projects did not show. Verbatim:

> cloud access is not working. projects and databases are not showing up.
>
> to clarify, local file storage should be solely for media and files,
> database entries and data should still be cloud based. only file storage is
> local with local selected

**What that means against the code (measured 2026-09-10):**

- The model she describes — rows in Supabase, file bodies on a local folder —
  exists in NO mode. Supabase mode sends bodies to the Petal cloud bucket (or
  S3); a workspace on its own server, NAS or local folder (`workspace_storage`
  mode `byos`, provider `network`, including the Admin Terminal's
  "this computer's folder" `root_kind = 'local'`) is REFUSED for uploads in
  cloud mode by the S36 decision in `supabaseAdapter.js` `uploadFile` ("add
  files from the desktop app in Local Server mode"). Managed files, thumbnails
  on disk, the bins and the demo folder are `local_server`-only
  (`supportsManagedFiles`, `supportsBins` in `RabbitProvider.jsx`).
- §1–§3 of this brief followed her 2026-09-08 words ("not need a server or a
  cloud solution"), so the folder as built moves the DATA under it and pins
  Local Server when a folder is opened — the opposite of the clarification.
  It stays for Friday (below); it is not the target design.
- The target design is the second half of the `network` provider
  (`docs/NETWORK_STORAGE_DESIGN.md` §4a2b): `files.storage_provider =
  'local_server'` per row, `workspace_storage.provider = 'network'` with the
  chosen root, and the cloud adapter's upload / read / thumbnail / delete
  paths routing bodies through the desktop's Express server under that root
  (the registry already states `NEW_BODY_GOES_TO[network] = LOCAL_SERVER`,
  `storage/index.js`). The bins would need cloud rows of their own.
  Adapter-level, more than a day: a dedicated session after Friday, not this
  sprint.

**Her decision for Friday — option 1 of three, "two parts, nothing new
built":** part 1 in Supabase mode shows her real projects and databases;
part 2 switches the Storage Backend to Local Server in Settings → Storage and
shows the demo folder and the bins there. Both states persist. Walkthrough 18
"How Friday runs" is the rehearsal. Declined: (2) Local Server only, with a
one-time copy of her cloud projects into the folder; (3) Supabase only, no
folder and no bins. The offline-tolerant launch (hand-off 2 §6 item 3) is
dropped: part 1 needs the cloud anyway.

---

## 8. Built the same night — private projects: cloud rows, media on this computer (2026-09-11)

Audrey, 2026-09-11 ~00:05, after part 1 of the rehearsal worked, verbatim:

> Okay so its working but heres the thing. remember all databases need to
> live in the supabase storage at all times. the only thing local storage
> should be related to is just the media files and asset of the project. the
> system should still track and record all databases in supabase. in settings
> just clarify that it is only working for demos as local projects cant be
> shared with other.
>
> how we can treat this is lets also just give users the ability to setup
> private projects for themselves.
>
> again, i just want to be able to use the supabase databases and use the
> local storage for demo purposes

and, asked whether that was next week's build: *"i need it tonight"*.

**What was built (commit `4c10387` on `demo/local-storage`):**

- **A private project** (migration `0072_private_projects.sql`,
  `projects.is_private`): a cloud project row visible to its creator and to
  workspace admins, hidden from everyone else by `projects_select`; every
  child row follows through the live-parent hop already in its own SELECT
  policy, so no other policy changed (pgTAP suite 80). Made from PROJECTS →
  NEW PROJECT → the **Private project** checkbox — shown only in Supabase
  mode, on the desktop, when the database has the column: the adapter probes
  it once per session, so a client ahead of the database lists projects
  exactly as before and shows no checkbox.
- **Its media lives on this computer.** `uploadFile` routes a non-financial
  upload on a private project to the `local_server` storage provider
  (`src/tools/rabbit_v0.1.0/storage/localServerProvider.js`) — the value
  the registry has mapped `network` to since S36 and nobody had implemented,
  because a browser cannot reach a disk. The desktop renderer can, through
  five routes on its own Express server (`electron/localMedia.cjs`,
  `/api/rabbit/local-media/…`). Bodies land under **`<demo folder>\media\`**
  while a folder is open, app data's `rabbit-data\local-media\` otherwise;
  thumbnails and playback are served from disk; the row
  (`files.storage_provider = 'local_server'`) stays in Supabase. An invoice
  on a private project stays in Supabase — the money pin still wins. Off the
  desktop a private project's row resolves to a sentence, never to a throw.
- **The copy she asked for**, on Settings → Storage: for demos only,
  databases stay in Supabase, only media goes local, nothing stored on this
  computer can be shared; the card shows the media root. Opening a demo
  folder no longer flips the backend to Local Server — a cloud session that
  opens a folder stays a cloud session.
- The bins stay Local Server only (her 2026-09-10 answer: next week).

**Before it shows on staging:** migration 0072 must be applied there
(hand-off 4 §6 has the command). Until then the checkbox is absent and
nothing else is different. Walkthrough 18's last section is the click-by-click.

**Also that night, ~00:50 → 01:40 (her words in hand-off 4 §4):** the
Local Server upload now STREAMS (`electron/projectFileStream.cjs` — her
"[localServer] HTTP 413" adding a clip); every file row records its own
duration (audio/video, read by the renderer as the file is added) and its
source's modified time (migration `0081_file_media_metadata.sql`, mirrored
on the local row); and **RESOURCES → FILES** (`components/Resources/`,
walkthrough 19) shows a chosen project's folders and files as one sortable
table and as Finder-style columns, with every detail per file. 0081 is
applied with the same command shape as 0072 (hand-off 4 §6).
