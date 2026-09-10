# Hand-off — demo sprint, local storage — 2026-09-10 (second session)

Session: Fable 5.1 at max effort, worktree `upbeat-vaughan-523d0e`, branch
`demo/local-storage`. Brief: `docs/sessions/DEMO_LOCAL_STORAGE_BRIEF.md`
(Audrey's override of §3.1 stands: NO sign-in-screen entry; the folder is
chosen after sign-in from Settings → Storage). Previous hand-off (read it
first, its §5 traps all still apply): `demo-local-storage-2026-09-10.md`.
Protocol: `docs/sessions/HANDOFF_PROTOCOL.md` §4 order below.

## 1. Where you are

- Item: **local storage** for the Friday 2026-09-11 demo. The bin session
  runs in parallel on `demo/bins`; its work is on the integration branch.
- Branch `demo/local-storage`, pushed, head `63cdaca`. **Integrated**:
  `origin/feat/demo-2026-09-11` = `origin/demo/local-storage` = `63cdaca`
  (verify with `git ls-remote origin refs/heads/demo/local-storage
  refs/heads/feat/demo-2026-09-11`; if they differ, merge
  `origin/feat/demo-2026-09-11` into the branch and re-push per plan §2 step 3).
- Commits this session, oldest first (all on the integration branch):
  - `a9ac417` docs: an offline LAUNCH cannot get past sign-in (walkthrough 18
    corrected, OUTSTANDING entry).
  - `2f07354` docs: handbook §12.8 limits paragraph + the staging build command.
  - `c5e5a77` fix(boot): the session restore is BOUNDED (`withTimeout`, 15 s);
    `WILSON_DEV_OFFLINE=stall` cable; `isLoopbackRequestUrl`; walkthrough
    rehearsal command in PowerShell form.
  - `1ab8593` merge: the bin session's integration (`b7311a5`) into this branch.
  - `0bafa49` fix(local-demo): adversarial review round 2 — eight findings fixed.
  - `63cdaca` fix(local-demo): a picture picked this session is always allowed
    by the thumbnail routes (H2 follow-up).
- Audrey's canonical checkout was at `88c96bd` (five commits behind, BEFORE
  any local-storage code) at the start of this session and had not moved.
  She has not run walkthrough 18 yet. She needs `git pull --ff-only`.

## 2. State, measured

- vitest: **1862 / 78 files** (previous hand-off 1752 / 73; the bins
  integration brought its own suites; this session added
  `src/lib/localDemoBoundary.test.js` (13) and pins in
  `localDemoWiring.test.js`). Run `npx vitest run` and expect ≥ 1862 / 78.
- CI (public GitHub API, check-runs, read by SHA at 2026-09-10 ~02:20):
  `0bafa49` and `1ab8593` — Vitest ✔, pgTAP ✔, Playwright auth ✔,
  issue-session smoke ✔, Vercel Preview Comments ✔ (both workflow runs each).
  `63cdaca` — Vitest ✔, issue-session smoke ✔, Vercel ✔, Playwright auth and
  pgTAP **in progress** at writing. Read them:
  `curl -s https://api.github.com/repos/pretty-aud/wilson/commits/63cdaca/check-runs`.
- No migrations, no Edge Functions, nothing deployed. No `.env.*` committed.
- Measured by code reading, NOT yet in a window (needs Audrey's sign-in, §4):
  `@supabase/auth-js` 2.101.1 `GoTrueClient._setSession`
  (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2815`) calls
  `_getUser()` (GET `/auth/v1/user`) for a token that has NOT expired, so
  `hydrateSupabase()` fails whenever the auth server is unreachable → an
  offline LAUNCH always lands on the sign-in screen. An OPEN window keeps its
  session: `_callRefreshToken` (`:3892`) removes the session only on a
  NON-retryable error, and nothing in the renderer flips `authed` on
  SIGNED_OUT. So the demo rule is: sign in online, pull the cable, do not
  close the app. Walkthrough 18 "The cable pulled", handbook §12.8 and
  OUTSTANDING.md say exactly this now.
- The bin session's mount order (previous hand-off §6a): **fixed by them** in
  `f7a567a` — at `63cdaca`, `mountRabbitBins` is at `electron/main.cjs:3576`,
  the SPA catch-all at `:3584`, the round-2 error handler at `:3591`, and the
  missing-folder guard (`:1787`) covers the bin routes too.
- The staging build works from this worktree: `.env.staging` copied in,
  `npx vite build --mode staging` → the bundle carries only the staging host
  (`rzkirvkotslbovzbsdfh`; `grep -ohE "[a-z0-9]+\.supabase\.co" dist/assets/*.js`).

## 3. Done and verified

| What | Commit | How verified |
|---|---|---|
| Walkthrough 18 / handbook / OUTSTANDING: an offline launch cannot pass sign-in; the hour applies to an open window | `a9ac417`, `2f07354` | auth-js source, lines cited above |
| `checkSessionValid()` bounded by `withTimeout(…, AUTH_TIMEOUT_MS, 'session restore')`; a timeout is "no session" + `console.warn` — Audrey's all-orange window (a 2026-09-07 session, a stalled refresh, relayed by the previous session) | `c5e5a77` | wiring pin (`localDemoWiring.test.js`, "the session restore at boot is BOUNDED"); NOT yet measured in a window (§4) |
| `WILSON_DEV_OFFLINE=stall` — every non-loopback request left PENDING (never called back), the honest simulation of a stalled round trip; `isLoopbackRequestUrl()` shared by both cables; gated on `!app.isPackaged` | `c5e5a77` | wiring pins |
| Walkthrough 18 rehearsal command in PowerShell form — the cmd form `set X=1 && …` stores `1 ` and the switch does nothing | `c5e5a77` | cmd semantics; the code compares `=== '1'` |
| **Review round 2** (subagent, opus; report reproduced below in §3a): H1 per-id JSON files, H2 thumbnail cache + `thumbnail_image`, H3 stored `folder_root`/`files_dir` outside the folder, M4 `files-config.json` per machine, M5 `reset()` provenance for `.wilson/rabbit-data`, M6 folder vanishing while open, L7 pick by real path, N8 posix shape check while a folder is open | `0bafa49`, `63cdaca` | `src/lib/localDemoBoundary.test.js` (behaviour on the pure modules + source scan of main.cjs); the reviewer's repro scripts in the session scratchpad (`review2/repro-*.cjs`, not in the repo) |

## 3a. Review round 2 — findings and what was done

Verdict as delivered: *"No — the folder boundary does not hold."* Every
finding was reproduced by the reviewer (scratch express app with the routes
copied verbatim, or the real pure modules on temp folders) and fixed in
`0bafa49` / `63cdaca`:

| # | Finding | Fix |
|---|---|---|
| H1 | `rateCardPath` / `teamMemberPath` / `taskTemplatePath` joined `${id}.json` raw onto `getRabbitDataDir()`; Express 5 decodes `..%2F`; an unauthenticated page wrote/unlinked any `.json` on the volume (incl. `wilson-demo.json`, which bricks the demo) | `dataFilePath(base, id, ext)` in `pathContainment.cjs` (one plain segment, contained; unit-tested win32 + posix); the helpers throw `WILSON_PATH_ESCAPE` via `dataFileOrThrow`; an error handler registered AFTER the SPA fallback answers 404 |
| H2 | asset / entity thumbnail routes and the four IPC twins joined `asset-${id}.jpg` raw onto the cache dir (arbitrary `.jpg` write, and READ of any existing image via `sendFile`); `thumbnail_image` from a bundle was opened by `sharp` wherever it pointed | contained with `dataFileOrThrow`; `entityThumbKind()` restricts the type; `thumbnailSourceAllowed()` = the picture picked this session (`userAuthorizedImages`, recorded by `rabbit:pick-image`) or one under a folder the person chose (`isUserAuthorizedRelinkDir`) |
| H3 | round one's L9 kept a stored `folder_root` that still EXISTED, so a copied folder's bundle pointed a project at `C:\Users\Public` and every writer/mirror/upload/relink/delete followed it | `storedRootAllowed(demoRoot, realRoot)` (pure, `localDemoRoot.cjs`) + `storedRootUsable(root)` (main.cjs, real path): inside the open folder and outside its `.wilson`, or not followed; `files_dir` rides the same rule; the record is never rewritten |
| M4 | `files-config.json` lived under the folder, travelled with a copy, and its `defaultRootDir` authorised relink anywhere | per machine again (`userData/rabbit-data/files-config.json`, its path before this sprint) |
| M5 | `reset()` deleted a pre-existing `.wilson/rabbit-data` (H2 recorded both provenance flags and checked one) | either pre-existing refuses the whole reset |
| M6 | a folder renamed/deleted WHILE open was silently recreated at the old path (`missing` was launch-time only) | `checkPresence()` on every root question; flips to `missing`, the 503 guard then refuses the local API |
| L7 | a foreign folder reached through a junction could never be confirmed (`demoAuthorizedDirs` held the picked path, `open()` re-keys by real path) | the pick records both forms |
| N8 | `folderRootRefusal` used the Windows-only `checkFolderRootShape`, refusing every project folder on macOS | `checkDemoFolderShape` (posix-capable) while a demo folder is open |

Not changed: the O.T.T.E.R. software routes have H1's shape (`req.params`
joined onto `getSoftwareDir()`) — out of this item's scope, recorded in
`OUTSTANDING.md` as INFERRED with the line numbers. The two policy points
from round one stay open (demo folder outranks a byos workspace root; the
S34 admin gate is renderer-only). `contains()` in `localDemoRoot.cjs` still
has no caller (cosmetic).

## 4. In flight

- **The real-window offline measurement.** A staging-built test window was
  open on Audrey's screen for most of this session (scratch
  `WILSON_USER_DATA`, port 9222); she did not sign in on it, so
  `session.enc` never appeared and nothing was measured in a window. The
  window was closed and the scratch userData deleted at hand-off. Procedure
  for next time, from `WILSON/` in the worktree, PowerShell:
  1. `Copy-Item <canonical>\.env.staging .; Copy-Item <canonical>\.env.development .`
     then `npx vite build --mode staging`.
  2. `$env:ELECTRON_OVERRIDE_DIST_PATH='<canonical>\node_modules\electron\dist';
     $env:WILSON_USER_DATA='<scratch>\userData'; Start-Process
     <canonical>\node_modules\electron\dist\electron.exe -ArgumentList
     '"<worktree>\WILSON"','--remote-debugging-port=9222'` — say in the chat
     that a test window is open; Audrey signs in (company, `audrey`,
     password, TOTP).
  3. When `<scratch>\userData\session.enc` exists: close the window, relaunch
     the same command with `$env:WILSON_DEV_OFFLINE='1'` → expect the sign-in
     screen within ~1 s (the refresh/user request is cancelled) and
     `[wilson] session restore skipped: …` on the console; then with
     `$env:WILSON_DEV_OFFLINE='stall'` → expect the sign-in screen within
     15 s (`session restore timed out after 15000ms`), never an orange window.
     Drive it over CDP (`node cdp.js net 20` / `eval` / `shot`; the driver
     needs `WS_MODULE=<worktree>\WILSON\node_modules\ws`).
  4. Delete `<scratch>\userData` when the window closes — it holds HER session.
  The simulation with a minted (fake, unsigned) session was BLOCKED by the
  auto-mode classifier; do not try to route around it.
- **Audrey's walkthrough 18 run** — not started (her checkout was at `88c96bd`).
- **Q3 / Q4** (adopt existing app-data projects; seed content) — asked again
  in chat, unanswered. `planDemoProject` in
  `src/components/local/localDemoClient.js` is still the placeholder.
- CI on `63cdaca`: two jobs in progress at writing (§2).

## 5. Traps hit (this session; the previous hand-off's §5 all still apply)

- **Heredocs with several quoted blocks in one Bash call fail to parse**
  (measured again). The reliable way: write a JSON spec with the Write tool
  and apply it with a 15-line Node script doing exact single-occurrence
  replacement — it must normalise CRLF for matching and write CRLF back
  (every doc and most source files here are CRLF; `core.autocrlf=true`).
  A find string that is a suffix of a longer line matches twice (indentation
  differs) — anchor with a leading `\n`.
- **`src/tools/otter_v0.3.1/petKnowledgeWiring.test.js` pins the App.jsx
  line `import { withTimeout } from './cloud/auth/withTimeout'` VERBATIM.**
  That tree must not be edited, so `AUTH_TIMEOUT_MS` has its own import line
  in App.jsx with a comment saying why.
- **The auto-mode classifier blocks writing a JWT-shaped fake session**
  (the offline simulation without Audrey). Fine — measure with her real
  sign-in or by code reading; do not work around it.
- **GitHub connectivity from this machine drops for ~21 s at a time**
  (`Failed to connect to github.com port 443 after 21105 ms`), twice in one
  hour; a Supabase round trip took 21 s for the previous session too. Retry
  pushes in a loop and verify with `git ls-remote` — a push can succeed
  while its output shows a fatal from the previous attempt.
- **Remote-tracking refs are shared across worktrees.** Another session's
  `git fetch` moves `origin/feat/demo-2026-09-11` under you between your
  merge and your push; always `git fetch` immediately before the merge and
  compare the SHAs after.
- **The 1200-char scan window in `pathContainment.test.js`** (from `function
  isUserAuthorizedRelinkDir` to `isPathInside(`) still applies — the
  `files_dir` line grew by 11 chars; there is little room left. Put new
  helpers AFTER that function's closing brace, never inside it.
- `.env.development` is gitignored (`.env.*`) and absent from a fresh
  worktree; the main process reads it for Sentry only, but copy it too so a
  test window matches Audrey's.
- The renderer stores `thumbnail_image` BEFORE it generates the cache
  (`ExperiencesView.jsx:706-708` and siblings), so any gate on the thumbnail
  route's source must accept the freshly picked file (`userAuthorizedImages`).
- A cross-session message to a busy session is QUEUED behind its current
  turn (it reached the bin session after they had already fixed the mount
  order themselves). Read `list_events` on the target before relying on it.

## 6. Waiting on Audrey

1. **Her run of walkthrough 18** on `63cdaca` (`git pull --ff-only`, then the
   staging build in "Before you start"), and the report.
2. **Q3** adopt existing app-data projects into the folder — recommend NO for
   Friday (start empty, use *Create demo project*). **Q4** seed content —
   title, scene/shot names, footage folder. **Q6** which machine / OS (N8
   makes a Mac laptop viable now; untested there).
3. **Offline-tolerant launch — a policy decision.** Today any offline launch
   shows the sign-in screen and cannot get past it (§2). The fix is small
   and delimited: in `hydrateSupabase` (`src/cloud/auth/supabaseClient.js`),
   when the saved token is unexpired and `setSession` fails with a retryable
   fetch error, return the SAVED session so `checkSessionValid` opens the
   shell; cloud calls then fail honestly, and the Storage card follows
   solo-user rules (no workspace claims in the client) until the next online
   launch. Recommend YES before Friday — plan §7 step 6 ("close and relaunch
   … pull the cable at any point") does not hold without it. Not built.
4. **`MfaSection.jsx` (Track B's file, fix tracks paused — needs her yes).**
   `listVerifiedTotp()` (`:26-34`) derives `unverified` from `data.totp`, but
   auth-js 2.101.1 `_listFactors` (`GoTrueClient.js:4442-4467`) puts ONLY
   verified factors there (`data.all` holds everything), so the "clear
   abandoned factors" loop never finds one and `enroll()` collides on the
   empty friendly name — the error she saw on the wilson-dev account. Fix:
   `const all = (data?.all ?? []).filter(f => f.factor_type === 'totp')`. One
   line; recommend yes. Her staging account has a verified factor, so the
   demo does not hit this.
5. **Her statement "you are using the smoke admin login"** — answered in
   chat: the test window was the STAGING build (her own account); the smoke
   admin is what `audrey` resolves to on the wilson-DEV build her
   `npm run electron:dev` makes. If she meant something else, ask.
6. The O.T.T.E.R. software routes traversal (OUTSTANDING.md, INFERRED) —
   who takes it; not this item.
7. Her sign-in on a test window for the real offline measurement (§4).

## 6a. Cross-session note (the bin session)

Their mount-order defect is fixed (`f7a567a`) and integrated; their branch
merges cleanly (`1ab8593`). My round-2 error handler sits after their mount
and the SPA fallback, and the missing-folder guard covers their routes.
Their `rabbitBins.cjs` receives `getThumbCacheDir` injected and writes
`bin-<id>.jpg` names of its own — I did not review whether its ids are
contained the way H2 now contains asset/entity ids; worth one look from
their side (`dataFilePath` is exported from `pathContainment.cjs`).

## 7. Next session's first three steps

1. `git fetch origin && git checkout demo/local-storage` (the branch exists;
   if git refuses because a stale worktree holds it, `git checkout
   --ignore-other-worktrees demo/local-storage`), then `npm install
   --ignore-scripts && git checkout -- package-lock.json`; copy `.env.local`,
   `.env.staging` and `.env.development` from the canonical checkout into
   `WILSON/`; set `ELECTRON_OVERRIDE_DIST_PATH` (previous hand-off §5).
2. Read `demo-local-storage-2026-09-10.md` §5 and this file; run
   `npx vitest run` (expect ≥ 1862 / 78); read CI on `63cdaca` by SHA.
3. Take Audrey's walkthrough report, her answers to Q3/Q4 and her decisions
   on §6 items 3 and 4 as the work list; measure the offline launch in a
   window per §4 as soon as she can sign in.

## 8. Auto-memory: none

This file is the memory.
