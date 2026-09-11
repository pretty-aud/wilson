# Hand-off — Dev fixtures mode — 2026-09-11

Session: Fable 5.1 at max effort, worktree `ecstatic-feistel-7f6693`, branch
`ui/dev-fixtures` cut from `origin/feat/ui-overhaul` at `720affb` (the F2
tree plus D2, C1-prep). Brief: the "Dev fixtures mode" chip F1 spawned on
Audrey's words (2026-09-11 late): *"for reviewing instead of seeing empty
tables. lets add a dev mode/debug menu and add a fake project with a fake
team, fake assets fake everything just to show what it looks like. make it
easy to turn off. like a bypass for the database data"*. Protocol:
`docs/sessions/HANDOFF_PROTOCOL.md` — §4 order below. Plan constraints:
`docs/design/UI_OVERHAUL_PLAN.md` §0 (C1, C9, no hex outside `@theme`) and
§6 (branch mechanics). Walkthrough for Audrey:
`docs/walkthroughs/26_dev_fixtures.md` (24 and 25 were taken by C1 and C2
while this session ran).

## 1. Where you are

- Track: the UI overhaul's side chip (not in the F2 → T0 chain). Bundle:
  **Dev fixtures mode** — one switch, one fake studio. Complete.
- Branch `ui/dev-fixtures`, pushed. Commits, oldest first:
  - `e2a22b2` feat(dev): the switch, the badge, the dataset, the R.A.B.B.I.T.
    fixtures adapter, the otterFetch handler, the seams, 48 tests, the
    probe script, `.env.example`, the fixtures-on captures.
  - `ed27856` fix(dev): realtime status word; O.T.T.E.R. hotkeys carry
    windows/mac; walkthrough; the fixtures-off and open-project captures.
  - `bd24977`, `a7fda97` docs: the walkthrough renumbered (26).
  - review-round commits and the integration merge follow — see
    `git log 720affb..HEAD`.
- Integration into `feat/ui-overhaul`: **see the last lines of this file**
  ("Integrated"). If that line is missing, integrate per plan §6.3 first.

## 2. State, measured

- vitest at `ed27856`: **128 files / 2396 tests**, green (baseline at
  `720affb` with the seams applied and no new tests: 124 / 2348). New:
  `src/dev/devFixtures.test.js` (7), `src/dev/fixtures/
  rabbitFixturesAdapter.contract.test.js` (15), `dataset.test.js` (13),
  `otterFixturesRoutes.test.js` (13).
- `npx vite build` (production): passes; **twelve fixture strings grepped
  against `dist/` — zero hits** (`VITE_DEV_FIXTURES`, `wilson.dev-fixtures`,
  `Lantern & Ash`, `Salt Hours`, `f1c70000-`, `DevFixturesBadge`,
  `dev-fixtures-badge`, `Dev fixtures`, `devFixtures`, `fixturesAdapter`,
  `otterFixtures`, `fixtures on`); six asset files.
- `node scripts/devFixturesProbe.mjs http://localhost:5233` (nine pages,
  Playwright, fresh context each run): **fixtures ON — 0 requests to the
  Supabase host, 0 console errors. Fixtures OFF — 27 requests** (the three
  model-tier reads tester mode has always made on every page, all 401) and
  27 console errors (those 401s). Before the last three seams the ON run
  showed 45 requests: the pet row and a `project_members` join fire only
  once usePermissions reports an identity, which tester mode never did.
- No migrations, no Edge Functions, no Supabase link, no staging.
- Dev server for this worktree: **port 5233**, launch config
  `wilson-dev-fixtures` in the worktree's untracked `.claude/launch.json`
  (F1 §5 trap 1), with `VITE_DEV_AUTOLOGIN=tester` and `VITE_DEV_FIXTURES=1`
  in its `.env.local`. `curl -s localhost:5233/src/index.css | grep
  __vite__id` names this worktree.
- CI: `rls.yml` runs on `ui/**`; the runs for `ui/dev-fixtures` are at
  https://github.com/pretty-aud/wilson/actions?query=branch%3Aui%2Fdev-fixtures
  (`gh` is not authenticated here; read the conclusion there).

## 3. Done and verified

| Item (brief) | Commit | Verified by |
|---|---|---|
| **The switch** `src/dev/devFixtures.js`: `VITE_DEV_FIXTURES=1` (read once, on a line that names `import.meta.env.DEV` first) AND localStorage `wilson.dev-fixtures !== 'off'`; a registry `installDevFixtures()/devFixtures()`; a refusal bus `devWriteRefused()/onDevWriteRefused()`. Every exported function's first statement is `if (!import.meta.env.DEV) return …` | `e2a22b2` | `devFixtures.test.js` pins the read, the first-statement guard, the seam list, the single dynamic import, the badge mount and the no-network rule, with a control |
| **The badge** `src/dev/DevFixturesBadge.jsx` — DEV · fixtures on/off · *Salt Hours* · OFF/ON, fixed top-left under `--titlebar-offset`, tokens only (`paper-raised`, `ink`, `rule`, `signal`, the Label step, the mono), `data-surface="dark"`; the toggle writes localStorage and reloads; refusals arrive as toasts on the app's one stack | `e2a22b2` | pane: OFF → "0 members / No members yet", ON → 8 members; `img/ui-fixtures-off-*.png` vs `img/ui-fixtures-*.png` |
| **The seam: `selectAdapter('supabase')` returns the fixtures adapter** when on, so `adapterMode` stays `'supabase'` and the ten `=== 'supabase'` gates (provider roster/notes/workspace channel, Dashboard `useMyTasks`/`useNotes`, ProjectsPage, D.O.G.'s cloud projects, TeamView, EditHistoryDrawer, FileAuditDrawer, useRosterMembers) open onto fixture data. `adapterSupportsWrites('fixtures')` is true. **Not** a fourth `ADAPTER_MODES` entry (Settings' picker unchanged — C1) | `e2a22b2` | contract test: `ADAPTER_MODES` lacks `fixtures`, `selectAdapter('fixtures')` throws; pane: Team, Dashboard, drawers populated |
| **The R.A.B.B.I.T. fixtures adapter** `src/dev/fixtures/rabbitFixturesAdapter.js`, mode `'fixtures'`: every method the Supabase adapter exposes (120, measured from the real factory with the client mocked) plus the Local Server bins/takes surface (27; 148 methods in all); reads clone; writes mutate the store; soft delete/restore on the 0014 tables; `listMyTasks` embeds; the notes version guard; one primary per shot; `thumbnailUrls` by object path; `subscribe*` report `SUBSCRIBED`; `supportsPrivateProjects` true; uploads, downloads, OS pickers, opening/relinking refused | `e2a22b2`, `ed27856` | `rabbitFixturesAdapter.contract.test.js` (15); pane: every R.A.B.B.I.T. tab |
| **The otterFetch handler** `otterFixturesRoutes.js`: every `op` the parser produces, the Express wire shapes (`toCourseWire`/`toSubjectWire` re-stated), `DOC_MERGERS` for merges, progress and quiz history mutate, the workspace-only flows (fork, editors, change requests, nominations, trash restore) refused with 501 + toast; `cloudActive()` true when on so the cloud UI renders | `e2a22b2`, `ed27856` | `otterFixturesRoutes.test.js` (13); pane: course card, subject, lesson, hotkeys with Windows/Mac |
| **The dataset** `src/dev/fixtures/data/*.js` — "Lantern & Ash Pictures", *Salt Hours* (a 14-minute short): 8 people with roles, rates, pronouns, SVG avatars; project with producer/director, 5 phases Aug 3 – Dec 18 2026, 3 milestones, 15 assets, **42 tasks** across all nine statuses and four priorities (Mara, the reviewer, on 16), 15 dependencies (11 task, 4 phase), links, comments, versions, edit history, roster, 2 task templates; 6 scenes, 16 shots, 5 bins, 12 bin files (posters, one rejected, 7 selects), 8 takes; a folder tree from the real planner (41 folders) + 32 files with 19 SVG thumbnails + file events; 2 rate cards (14 general roles, 6 internal from wages), 35 budget lines on crew/talent/expenses, 4 actuals, 2 bid versions (v2 active), 3 expenses, 1 rate override; 3 note subjects + 4 notes with real Yjs bodies; 1 O.T.T.E.R. course, 4 subjects, 8 sections, 19 lessons, hotkeys/functions/references, progress, 2 quiz attempts. Ids `f1c70000-KKKK-4000-8000-N` (valid v4, stable) | `e2a22b2`, `ed27856` | `dataset.test.js` (13): every FK, vocabulary, count, Yjs body, unique ids |
| **The seams**, each on a line naming `import.meta.env.DEV`: `usePermissions` (the dataset's admin, no listener), `useWorkspaceMembers` (roster, `updateMember` in memory, `isOwnAvatarUrl` accepts `data:image/svg+xml`), `TeamMembersPage` (the membership join), `ProfileSection` (own row + email), `userState` (pet/settings mirror in the store), `modelSources.loadModelSources` (skips), `RabbitProvider` (boot mode `'supabase'` when on; `authUserId` falls back to the fixture user so `myProjectRole` resolves; `supportsBins` opens), `App.jsx` (`{import.meta.env.DEV && <DevFixturesBadge />}`), `main.jsx` (the one dynamic import before the first render) | `e2a22b2` | `devFixtures.test.js` pins the list; the probe shows 0 Supabase requests |
| **`.env.example`** documents `VITE_DEV_FIXTURES=1` beside the sign-in modes | `e2a22b2` | text |
| **`scripts/devFixturesProbe.mjs`** — loads nine pages fixtures on then off and lists every request to the Supabase host + console errors | `e2a22b2` | run; output in §2 |
| Screenshots: `img/ui-fixtures-{root,team-members,project-files,rate-card,dashboard,rabbit,otter,settings}-{1440x900,1280x700}.png` (on), `img/ui-fixtures-off-{root,team-members,project-files,rabbit,otter,dashboard}-*.png` (off), `img/ui-fixtures-open-rabbit-*.png` (the project open) | `e2a22b2`, `ed27856` | `scripts/screenshot.mjs`, `--storage` states for off / open |

**Review round 1** (Opus): pending at the time of this draft — see the
paragraph below once it is filled in.

**Review round 2** (Opus, attacking round 1's corrections): pending.

Integrated: (filled in at the end of the session — last lines of this file.)

## 4. In flight

Nothing uncommitted at hand-off.

## 5. Traps hit

1. **Registering a fourth adapter mode would have shown Audrey the
   local-server subset.** Ten gates read `adapterMode === 'supabase'`
   (provider roster/notes/channel, `useMyTasks`, `useNotes`, ProjectsPage,
   D.O.G., TeamView, the two drawers, `useRosterMembers`). The fixtures
   adapter therefore SUBSTITUTES for the cloud slot inside `selectAdapter`
   and reports `mode: 'fixtures'` on the object only; `adapterSupportsWrites`
   knows the word.
2. **The fixture identity wakes reads tester mode never made.** With
   `usePermissions` reporting a user and a workspace, `user_pets`
   (userState) and TeamMembersPage's `project_members … projects(title)`
   join fired for the first time — 401s, but requests. The probe script
   found them; three more seams closed them. Measure with the probe after
   any new seam, not by reasoning.
3. **The Browser pane's network buffer is useless on a Vite dev page** (F1
   §2's resource-timing note): 250 entries fill with unbundled modules
   before boot ends. Use Playwright (`scripts/devFixturesProbe.mjs`) for
   any "what left the machine" claim.
4. **The pane's console buffer survives reloads** (F2 trap 6, again): the
   first tab kept 401s from before the last seams. A new tab showed none.
5. **The provider maps Supabase channel words, not adjectives.**
   `onStatus('live')` did nothing; `onStatus('SUBSCRIBED')` is what
   `setRealtimeStatus('live')` keys on, and it also schedules the refetch —
   which is the real behaviour and is fine.
6. **O.T.T.E.R. hotkeys are `{ action, key, windows, mac, notes }`** and
   functions `{ name, syntax, description, example }`; a first cut with
   `keys` rendered empty Windows/Mac columns. Grep `s.windows` before
   inventing a wire field.
7. **`vitest` has `import.meta.env.DEV === true`** (mode `test`), so
   `installDevFixtures()` runs at import in tests; the tests use
   `buildDevFixtures()` directly and never depend on `.env.local`.
8. **Node cannot resolve `@playwright/test` from the scratchpad** — a
   probe script has to live under `WILSON/` (it does: `scripts/`).
9. **`scripts/screenshot.mjs --pages /rabbit` alone is mangled by Git Bash**
   (F2 trap 7): `root,/rabbit` works; the unwanted `root` capture is
   deleted after.
10. **`git ls-tree <rev>:<path>` from inside `WILSON/` listed nothing** and a
    `$(( … + 1 ))` on an empty list renumbered the walkthrough to 1. Use
    `git ls-tree -r --name-only <rev> | grep <path>` and read the number
    before moving a file.
11. **`ProjectFilesTable` reads the local file shape** (`f.type`, `f.size`,
    `f.file_name`), so cloud rows — and fixture rows, which are
    cloud-shaped — show "–" for KIND and SIZE on the Summary. Pre-existing
    in cloud; the fixtures do not paper over it (an alias would misrepresent
    what a cloud row carries). Recorded for lane B.
12. **The Summary's BUDGET tile is $0** because the provider's rollup
    multiplies task bid days by `roleRates`, which the provider never has
    (the rate card lives in a hook). Same on wilson-dev; not a fixtures
    defect. Recorded for lane B.
13. **A refusal bus must not need the DOM**: the first cut dispatched a
    `CustomEvent` on `globalThis`, which Node has no listener surface for,
    so the node-env tests saw nothing. A module-level `Set` of listeners
    works everywhere.
14. **A `primary` assigned explicitly must demote the old primary**, not be
    demoted by position order. Normalisation runs after the intent is
    applied, never instead of it.

## 6. Waiting on Audrey

- **Walkthrough 26**, not yet reported. Two soft decisions in it (the
  pill's position; whether "Salt Hours" is the kind of project she wants
  to review against). Nothing blocks on them.
- Lane B notes from traps 11 and 12 (files table shape on the Summary; the
  $0 budget tile) are hers to route — they predate this bundle.

## 7. Next session's first three steps

There is no next session in this chain: the chip was a one-off beside the
UI overhaul's F2 → T0 line, and this file says so. If the fixtures need
extending (a second project, a brand campaign, a game with levels and
experiences), the steps are:

1. `git fetch origin && git checkout -b ui/dev-fixtures-2 origin/feat/ui-overhaul && npm install --ignore-scripts && git checkout -- package-lock.json`,
   copy `.env.local`, add `VITE_DEV_AUTOLOGIN=tester` and
   `VITE_DEV_FIXTURES=1`, add a launch entry with `--prefix` and a free
   port, confirm `__vite__id`.
2. Edit `src/dev/fixtures/data/*.js` only (plain data); run
   `npx vitest run src/dev` — `dataset.test.js` names every broken link;
   `npm run build` and grep `dist/` for a string from the new data.
3. If a page needs a new seam, add it on a line that names
   `import.meta.env.DEV`, add the file to `SEAMS` in
   `src/dev/devFixtures.test.js`, and run `node scripts/devFixturesProbe.mjs`
   — the ON run must stay at 0 requests.

## 8. Notes for whoever touches this next

- **What is honest and what is not.** Reads are the dataset; writes to
  entities, notes, rate cards, budget, scenes, bins metadata, takes,
  courses, subjects, docs, progress, quiz history and the pet/settings
  mirror mutate the in-memory store for the session (a reload resets).
  Bytes and the OS are refused with a toast: `uploadFile`, `downloadFile`,
  `pickBinFiles`, `pickBinFolder`, `prepareBinFiles`, `addBinFiles`,
  `postBinFileThumbnail`, `binRelinkApply`, `openBinFile`; O.T.T.E.R.'s
  fork / editors / change requests / nominations / trash restore. `fileUrl`
  and `downloadUrl` return the SVG placeholder when the row has one, else
  refuse. `writeProjectManifest` / `writeProjectRates` store the mirror in
  memory (a write, not a drop).
- **Colour in the dataset is data.** The SVG placeholder tints (eight
  muted pairs in `svg.js`), the phase colours and the bin label colours are
  row values a picture or a Timeline bar carries, the same class as
  `binMedia.COLOR_HEX`; the badge itself uses only `@theme` tokens.
- **Where the reviewer is.** `PERMISSIONS` in `data/workspace.js` — Mara
  Okonkwo, admin, producer, project manager on *Salt Hours*. Change her
  role there to review as a manager or a user; `canOnProject` and
  `canSeeProjectMoney` then gate as they would live.
- **Electron dev** (`npm run electron:dev`) is a Vite *development* build,
  so the fixtures work there when the two env lines are set; the provider's
  boot forces the cloud slot when they are on, whatever the saved backend
  is. Packaged and web builds are production builds and carry none of it.
- **Source-text tests touched by this bundle:** `src/dev/devFixtures.test.js`
  reads `main.jsx`, `App.jsx` and the seam files as text. `pages.test.js`,
  `tokens.test.js` (`className="wilson-chrome"` × 3), `localDemoWiring`
  (`{authed && (` shape), `devAutoLogin.test.js` (one
  `VITE_DEV_AUTOLOGIN` read in App.jsx) all still pass — the badge is
  mounted BEFORE `{authed && (` for exactly that reason.

## 9. Auto-memory: none.

The worktree's memory folder is empty and the main repo's is not this
session's to edit. This file is the memory; every lesson is in §5.
