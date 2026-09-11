# Hand-off — demo sprint, local storage — 2026-09-11 (fourth session)

Session: Fable 5.1 at max effort, worktree `laughing-proskuriakova-bf7d67`,
branch `demo/local-storage`. Brief: `docs/sessions/DEMO_LOCAL_STORAGE_BRIEF.md`
— **§8 is new: Audrey's 2026-09-11 words and what was built that night.**
Previous hand-offs (their §5 traps all still apply):
`demo-local-storage-2026-09-10-3.md`, `-2.md`, `demo-local-storage-2026-09-10.md`.
Protocol: `docs/sessions/HANDOFF_PROTOCOL.md` §4 order below.

## 1. Where you are

- Item: **local storage** for the Friday 2026-09-11 demo — and, since
  ~00:10 on the 11th, **private projects: cloud rows, media on this
  computer**, built overnight on Audrey's "i need it tonight".
- Branch `demo/local-storage`, pushed. Commits this session, oldest first:
  - `4c10387` feat(local-media): private projects — the code, tests,
    migration 0072 and pgTAP suite 80.
  - `77ac263` fix(pgtap 80): claims in the JWT's own shape; the docs
    (brief §8, walkthrough 18 "Private projects", handbook §12.8a,
    OUTSTANDING, plan §7 addendum).
  - `0e0871e` fix(local-server): a project file STREAMS to disk — Audrey's
    "[localServer] HTTP 413" adding a clip (electron/projectFileStream.cjs).
  - `16346fa` merge: `origin/feat/demo-2026-09-11` (`c09aacc`, the bins'
    walkthrough docs) into this branch — **integrated**: at 00:52 both
    `origin/feat/demo-2026-09-11` and `origin/demo/local-storage` were
    `16346fa`. The hand-off commit(s) after it are docs only; verify the two
    refs still agree (`git ls-remote origin refs/heads/demo/local-storage
    refs/heads/feat/demo-2026-09-11`) and re-integrate if not.
  - **This session may still be running when you read this** (Audrey kept
    sending work: the Resources file explorer, §4). If `git rev-parse HEAD`
    differs from your own last push, `git fetch origin && git reset --hard
    origin/demo/local-storage` before touching a file (protocol §6).
- Audrey's canonical checkout was at `7d242db` at 23:05 on the 10th. She
  was running the **packaged exe** this session built for her
  (`out\WILSON-win32-x64\WILSON.exe` in this worktree, staging bundle,
  her REAL app data) — that is where "projects from supabase are not
  showing up" (Local Server was the remembered backend; two clicks fixed
  it) and "Okay so its working" came from. A second package with tonight's
  code is at `out-private\WILSON-win32-x64\WILSON.exe` (§3).

## 2. State, measured

- vitest: **1970 / 84 files** at `0e0871e` / `16346fa` (previous hand-off
  1920 / 80; new `storage/localMedia.test.js` 21,
  `storage/localServerProvider.test.js` 7, `lib/localMediaWiring.test.js` 16,
  `storage/projectFileStream.test.js` 5, plus pins moved in
  `localDemoWiring.test.js`, `storageRegistry.test.js`, `thumbnails.test.js`).
- **Migration 0072 on staging: NOT applied — blocked.** `supabase link
  --project-ref rzkirvkotslbovzbsdfh --password ""` was ALLOWED from this
  worktree and a read-only probe answered (1 workspace, `is_private`
  absent, last recorded migration `0078`, `projects_select` without the
  arm); `supabase db query --linked -f
  supabase/migrations/0072_private_projects.sql` was **denied by the
  auto-mode classifier**. Exactly the wall protocol §2 describes; the
  worktree was re-linked to wilson-dev afterwards. §6 item 1 is Audrey's.
- CI on `4c10387`: Vitest ✔, Playwright auth ✔, smoke ✔, Vercel ✔,
  **pgTAP ✘ at "Run pgTAP suite"** — suite 80's manager insert refused
  (`current_app_role()` reads `app_metadata.app_role` from the JWT claims;
  `tests.login_as` never sets it) and the second `tests.login_as` died with
  "permission denied for schema tests" once the role was `authenticated`.
  Read from the check run's public annotations (the job log is 403 without a
  token). Fixed in `77ac263` in suite 59's shape (`set_config` with
  `app_role` in `app_metadata`).
- CI on `77ac263`: read it by SHA —
  `curl -s https://api.github.com/repos/pretty-aud/wilson/commits/77ac263/check-runs`
  — the line below is updated at hand-off time.
  - CI-77ac263: (filled in below in §2a)
- The real server, measured over CDP on a scratch userData (staging build at
  `4c10387`): `GET /api/rabbit/local-media` → `{ root }`; PUT → 200
  `{ key, size }`; GET with `Range: bytes=0-4` → 206 `image/png`; HEAD 200;
  an encoded `..` key → 404; a missing key → 404 **JSON** (not the SPA's
  index.html — the mount order is right); DELETE → 204. The same probe
  inside the PACKAGED app (`out-private`, dev electron on a scratch
  userData): identical answers.
- **Not measured in a signed-in window:** the checkbox, the badge, an actual
  upload through `uploadFile`, the thumbnail tile, playback. Those need
  Audrey's sign-in AND migration 0072 on the database she signs into (§6).
- No Edge Functions, nothing deployed, no `.env.*` committed. Migration 0072
  is applied **nowhere yet** (§6) — CI's local Postgres is the only place it
  has run.

## 2a. CI on the pushed heads (updated at hand-off)

- `77ac263`: Vitest ✔, pgTAP ✔ (suite 80 passes on a real Postgres — the
  migration applied and every assertion held), Playwright auth ✔, smoke ✔,
  Vercel ✔ (run 34562902439).
- `0e0871e`: all five ✔ (run 34563392146).
- `16346fa` (the integrated head): two runs as usual — 34563439271 all ✔;
  34563487894 Vitest ✔, pgTAP ✔, smoke ✔, Vercel ✔, Playwright auth in
  progress at 00:53. Read it by SHA if a green mark on the exact head is
  wanted.

## 3. Done and verified

| What | Commit | How verified |
|---|---|---|
| `electron/localMedia.cjs` — five routes (describe / put / get + Range + `?download=` / head / delete), untrusted-key shape check, lexical + real-path containment, 503 with a sentence while the root cannot be resolved | `4c10387` | `localMedia.test.js` (21, real express on a temp root incl. a junction out of the root); CDP probe in the real server and in the packaged app |
| `main.cjs`: `getLocalMediaRoot()` (`<folder>\media` / `rabbit-data\local-media`; MISSING refuses), `mediaRoot` in `localDemoState()`, ONE mount line after the guard and before the SPA fallback | `4c10387` | `localMediaWiring.test.js` pins the order and the injection |
| `storage/localServerProvider.js` — the `local_server` registry provider (XHR progress put, get, del, exists, getUrl, describe; `NOT_HERE` off the desktop); registered beside supabase and s3 | `4c10387` | `localServerProvider.test.js` (7); `storageRegistry.test.js` pin |
| `uploadFile`: private + non-financial → `LOCAL_SERVER`, else unchanged (S36 refusal, S37 read inside the else); `is_private` probed (`42703` → absent), `listProjects` / `createProject` / `PROJECT_COLUMNS` / `supportsPrivateProjects()` | `4c10387` | wiring pins; the registry test's existing pins still hold |
| FileManager: `local_server` previews from the local URL, never signed; icons off the desktop | `4c10387` | wiring pin; `thumbnails.test.js` deps pin updated |
| ProjectsPage checkbox (cloud + desktop + column) and ProjectListPanel badge | `4c10387` | wiring pins; NOT yet seen in a signed-in window |
| Settings → Storage copy (demos only, databases in Supabase, media local, nothing shareable) + media root line; the Local Server hint; opening a folder no longer pins Local Server | `4c10387` | wiring pins; `localDemoWiring.test.js` pin inverted |
| Migration `0072_private_projects.sql` + suite `80_private_projects.sql` | `4c10387`, `77ac263` | CI pgTAP (§2a) |
| Docs: brief §8, walkthrough 18 "Private projects" (P1–P7), handbook §12.8a, OUTSTANDING (local body never purged), plan §7 addendum | `77ac263` | comment-marker counts unchanged in every long doc |
| Packaged exes: `out\` (7d242db, hers to run tonight) and `out-private\` (rebuilt at `0e0871e`: private projects + the streamed upload) | — | both smoke-booted on a scratch userData with the dev electron; hers is running on her real app data |
| **The 413**: `electron/projectFileStream.cjs` — `PUT …/files-stream` pipes the body to disk, same row / directory / event as the base64 POST (which stays); `localServerAdapter.uploadFile` hands `fetch` (XHR for progress) the File itself; `streamPutJson` is the one transport | `0e0871e` | `projectFileStream.test.js` (64 MB through a real express app behind the same 50mb json parser); in the REAL server on a scratch userData: 64 MB → 200 in 760 ms, row in the bundle, bytes on disk, `/download` serves it with Range; the OLD route with 60 MB → 413 |

## 4. In flight

- **Audrey's run of walkthrough 18 "Private projects" (P1–P7)** — needs 0072
  on the database she signs into (§6 item 1) and the `out-private` exe (or
  her checkout after `git pull --ff-only` + `npx vite build --mode staging`
  + `npx electron .`).
- **The integration** (plan §2 step 3) — done at the end of this session if
  §2a says so; otherwise: `git fetch origin && git merge --no-ff
  origin/feat/demo-2026-09-11 && npx vitest run && git push origin
  HEAD:feat/demo-2026-09-11`. `origin/feat/demo-2026-09-11` was at
  `c09aacc` (the bins' walkthrough docs) when this session merged it;
  `git merge-tree --write-tree` reported no conflict.
- Friday morning: fixes from her report.
- **Asked at 00:50, verbatim:** *"make sure that in the databases for
  files, it states the name of the file, file type, creation date and time,
  file size, if its an audio or video file the duration as well. in the
  resource section of the app please add a way for me to view all the files
  in a project. allow me to choose a project and have a way to view folders
  and files. it should look something like window explorer. have a way to
  view all files and folder in one table, and also have a view that works
  like the column system in finder for mac os. so idea is one column is one
  level of folders, then the next column is one folder layer in and so on.
  let me know if you have questions make sure to show all details for a
  file like listed before."* This session started on it right after this
  hand-off was committed; its own commits and the next hand-off say how far
  it got.

## 5. Traps hit (this session; the previous hand-offs' §5 all still apply)

- **`current_app_role()` is JWT-derived** (`0008`): it reads
  `app_metadata.app_role` from `request.jwt.claims` and never touches
  `workspace_members`. `tests.login_as(user, ws)` sets `sub` and
  `workspace_id` only, so a "manager" logged in that way is refused by every
  policy that names a role. Log in the way suite 59 does — `set_config` with
  `app_role` in `app_metadata`, then `set_config('role','authenticated')`.
- **After the first switch to `authenticated`, the `tests` schema is off
  limits** ("permission denied for schema tests"): a second
  `tests.login_as` or `tests.logout()` kills the suite. Every later switch
  is `set_config`.
- **A data-modifying CTE cannot sit inside a function argument** ("WITH
  clause containing a data-modifying statement must be at the top level"):
  run the UPDATE as its own statement and read the result back.
- **The CI job log needs a token (403), but the check run's ANNOTATIONS are
  public**: `GET /repos/pretty-aud/wilson/check-runs/<id>/annotations` names
  the failed tests and the first `ERROR:` line. `<id>` is the pgTAP entry's
  `id` in the commit's `check-runs` JSON.
- **`vitest` reads CRLF files verbatim**: a source-scan pin that spans a line
  break must normalise (`.replace(/\r\n/g, '\n')`) or it never matches.
- **The forge config has no `outDir`, and `electron-forge package` cannot
  overwrite an exe that is running** (hers, in `out\`). The core API can:
  `require('@electron-forge/core').api.package({ dir, outDir, interactive:
  false })` (scratchpad `package2.cjs`) — same `forge.config.cjs`, second
  folder. Electron's zip was already in `%LOCALAPPDATA%\electron\Cache`, so
  no download. `prune: true` keeps `sharp`'s prebuilt `@img/sharp-win32-x64`.
- **A packaged app ignores `WILSON_USER_DATA`** (`!app.isPackaged`), so a
  packaged exe always runs on the REAL `%APPDATA%\wilson`. To smoke-test the
  package without touching her data: run its `resources\app` folder with the
  dev `electron.exe` (`app.isPackaged` false → the scratch knob works).
- **Express 5 wildcard params are arrays**: `'/api/rabbit/local-media/*key'`
  gives `req.params.key` as decoded segments; `[].concat(req.params.key).join('/')`.
  `fetch` normalises a literal `..` in a URL before sending — test traversal
  with `%2e%2e`.
- **`res.sendFile` (the `send` module) handles Range, HEAD and conditional
  GET itself**; headers passed in its `headers` option land before it picks a
  type, so a `Content-Type` set there wins. `express.json` (mounted globally)
  ignores an `application/octet-stream` body — always send that type, never
  the file's own (a JSON upload would be parsed and consumed).
- **`thumbnails.test.js` pins FileManager's exact filter text**
  (`.filter(f => f.storage_provider !== 's3')`) and the effect's exact deps
  — add a SECOND `.filter(...)` line rather than editing the first, and
  update the deps pin with a reason.
- **Audrey DOES use the test window — silently.** At 00:32 she signed in on
  the 9222 window (fresh scratch userData → Local Server), opened her demo
  folder `C:\Users\Audrey\Documents\TESTING`, made `Legend-Road-Series`, and
  at 00:36 hit the 413 there (net2.log, port 55073). This session restarted
  that window at 00:44 for the fix WITHOUT knowing — her session and the
  folder POINTER went with the scratch userData (deleted on close, as the
  rule says); the folder's contents (the project, under
  `TESTING\.wilson\rabbit-data`) were never touched. Before closing a test
  window, `ls <scratch>\userData\session.enc` — if it exists, say so and
  wait. She also ran the packaged `out\WILSON.exe` on her real app data
  earlier the same night (the "projects not showing up" report).
- **The classifier allows `supabase link` to STAGING and read-only `db
  query --linked`, and blocks a `db query --linked -f <migration>`.** So a
  session can VERIFY staging's state but not change it; the apply is hers.
- **`db push` is the wrong tool on staging tonight**: it records `0078` as
  its last migration (the tracks' 0076/0078 are there; this branch has up to
  0066 plus 0072), so `db push` would demand `migration repair`. A
  single-batch `db query -f` of the idempotent file is the safe apply.

## 6. Waiting on Audrey

1. **Migration 0072 on the database she demos from (staging,
   `rzkirvkotslbovzbsdfh`).** Blocked for a spawned session (protocol §2).
   From `WILSON\` in her checkout, after `git pull --ff-only`:
   ```
   supabase link --project-ref rzkirvkotslbovzbsdfh
   supabase db query --linked --file supabase\migrations\0072_private_projects.sql
   ```
   (the file is idempotent: `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF
   EXISTS` + `CREATE`, `CREATE INDEX IF NOT EXISTS`, and it RAISEs if the
   column or the policy arm is missing afterwards). `db push` is the wrong
   tool tonight: staging carries migration versions this branch does not
   have (the tracks'), and `db push` refuses or needs `--include-all` and
   `migration repair`. Re-link to wilson-dev afterwards if she wants
   (`--project-ref eqjzmnvkrakroyqxfsvw`). Until 0072 is there the checkbox
   is absent and nothing else differs. **And 0081** (files.duration_sec,
   files.source_modified_at — nullable, no policy change), same shape:
   ```
   supabase db query --linked -f supabase\migrations\0081_file_media_metadata.sql
   ```
   Without it the FILES page still works; the two columns stay empty for
   cloud rows (the local rows carry them regardless).
2. **Her rehearsal report** of walkthrough 18 "Private projects" P1–P7, on
   the `out-private` exe or her checkout at `16346fa`+ (`git pull
   --ff-only`, `npx vite build --mode staging`, `npx electron .`).
2a. **The Resources file explorer + file metadata (asked 00:50, §4)** —
   whatever this session did not finish is the next item.
3. **Two-part demo report, part 2** (Local Server + folder + bins) — she
   reported part 1 working ("Okay so its working"); part 2 not yet.
4. Q4 seed content (`planDemoProject` is still the placeholder); Q6 machine.
5. Post-Friday: purge of a local body when its row is gone (OUTSTANDING);
   bins in cloud mode (her: next week); the network provider's second half
   for a whole workspace (brief §7) — private projects are the per-project
   half of it.

## 7. Next session's first three steps

1. `git fetch origin && git checkout demo/local-storage` (or
   `--ignore-other-worktrees`), confirm `git rev-parse HEAD` =
   `git rev-parse origin/demo/local-storage`; `npm install --ignore-scripts
   && git checkout -- package-lock.json`; copy `.env.local`, `.env.staging`,
   `.env.development` from the canonical checkout into `WILSON/`; set
   `ELECTRON_OVERRIDE_DIST_PATH` (hand-off 1 §5).
2. Read brief §7–§8, this file, hand-off 3 §5, hand-off 2 §5, hand-off 1 §5;
   `npx vitest run` (expect ≥ 1963 / 83); read CI on the pushed head by SHA.
3. Take Audrey's reports (§6 items 2–3) as the work list. Friday morning is
   fixes only. If 0072 is not on staging yet, that is item 1 before anything.

## 8. Auto-memory: none

This file is the memory.
