# Brief — FX11 · one connection dot in the bottom-left corner that means "everything is connected", and a project bar with only the status (R.A.B.B.I.T. fixes, 2026-10-16)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else. Reviewer subagents on `model: "opus"`.
Read first: `src/tools/rabbit_v0.1.0/Rabbit.jsx` (`AdapterStatusDot`, `RealtimePresenceStrip`, the `adapterDot` and `presence` nodes, the Summary tab's `statusInTabBar` docking), `components/ProjectContextBar.jsx` (its header comment: the two slots and why they docked there, B1 and Q10), `state/RabbitProvider.jsx` (`adapterMode`, `adapterStatus`, `realtimeStatus`, `presentUsers`, and how each is measured today), `views/BinsView.jsx` (the bins and files counter at the bottom left), `src/components/Dashboard/DashboardPage.jsx` (its *Live* badge beside the faces, `dash-presence`), `src/App.jsx` (the orange bar at the window's foot: measure what it is), the storage modes and their probes (`docs/NETWORK_STORAGE_DESIGN.md`, `src/components/settings/StorageConnections.jsx`, the Local Server adapter's health route), `src/ui/StatusBadge.jsx`, `docs/design/POST_OVERHAUL_PLAN.md` §4, `docs/SYSTEMS_HANDBOOK.md` §17. Load `laws-of-ux` and `design-direction` first.

Branch `po/fx11-connection-dot` from `origin/feat/post-overhaul-edit-versioning` (`git branch --unset-upstream` after); port **5299**; walkthrough **73** (72 is VW1's); hand-off `docs/sessions/handoffs/po-fx11-<date>.md`. The dev fixtures (`VITE_DEV_FIXTURES=1`, `VITE_DEV_AUTOLOGIN=tester` in `.env.local`), and, for the real probes, the desktop app against a Local Server only if the measuring needs it (say so in chat first, a scratch `WILSON_USER_DATA` and `--user-data-dir`, the window off-screen, `app.exit(0)` in a `finally`); no migration, no Edge Function, no staging or prod. Two adversarial review rounds, ONE reviewer subagent each on `model: "opus"` (UX with an accessibility check, and whether every state the dot shows is true), the second attacking the first's corrections. No waiting for Audrey (her answers are below); no chips; last command `git checkout --detach`. State the `npx vitest run --maxWorkers=4` count you measure. Locate by identifier, never by line number. Read CI after every push through the public API with `curl`. Screenshots before and after at 1280 and 1440. The hand-off in protocol §4 order (`docs/sessions/HANDOFF_PROTOCOL.md`); merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push. The beta gets it when the controller merges on her word. VW1b–VW1e (custom views) edit the tables beside you: merge the integration branch before your push and keep their changes.

## Her words (2026-10-16, verbatim), with her screenshot of the project bar: *ACTIVE* by the project's name on the left; *LIVE* and a second green dot on the right

> see the image i attached the project bar has three green dots and its confusing. remove the live and additional green dot. just leave the icons that appear for users

> move the live dot to the bottom left corner of the window right above the orange bar. for this lets move the bin and files counter a little higher up to make space for the green dot in the bin tab. to confirm this green dot should clarify that the system is connected to the storage solution not just the databases on supabase

## Her answers (2026-10-16, asked in chat as multiple choice; verbatim)

- **What the dot tells:** "Everything is connected (Recommended)" — green when both the WILSON database and the file storage answer; amber when the database works but the storage does not (files cannot open or save); red when offline; hovering says each part in words.
- **Which storage it checks:** "Where your files are kept (Recommended)" — the storage the company chose for its files (Petal cloud, its own bucket, the Local Server or NAS); the Bins tab keeps its own per-location words for footage shares.
- **Where:** "Every R.A.B.B.I.T. tab (Recommended)" — the bottom-left corner of every R.A.B.B.I.T. tab, just above the orange bar; the Bins tab's bin and file counter moves up a little to make room.
- **The Dashboard's Live badge:** "remove there too. i just want the project status there on that bar next to project name. leave to the right the switch dropdown"
- **The faces of who else has the project open:** "Keep the faces (Recommended)" — the bar: the project's name and status on the left; the faces, then the switch dropdown, on the right; no LIVE, no dot.

## The work

1. **Measure first** (a table in the hand-off): what `adapterStatus` and `realtimeStatus` actually test today in each mode (the cloud, the company's own bucket, the Local Server signed out, the desktop signed in), how often, and what a broken storage looks like to each; what the orange bar at the window's foot is and how tall; where the Bins counter sits at 1280 and 1440.
2. **The project bar**: the *Live* / *Sync* pill and the adapter dot leave it; the project's name and status on the left; the faces of who else has the project open, then *Switch*, on the right (the Summary tab's tab-bar docking follows the same rule).
3. **The Dashboard**: its *Live* badge goes; the faces stay.
4. **The connection dot**, drawn once by R.A.B.B.I.T. in the bottom-left corner of every tab, just above the orange bar: green when the database AND the files' storage answer; amber when the database answers and the storage does not; red when offline (or the Local Server is unreachable); its hover text and accessible name say each part in words (*Database: connected · Files: Petal cloud, connected · Live updates: on*), and a change of state is announced politely once. The storage check is a real, cheap probe of where the files are kept (the bucket or the server answering), never inferred from the database alone; bounded in time, never blocking the page, and quiet when nothing changes. The Bins tab's per-location words for footage shares stay as they are.
5. **The Bins tab**: its bin and file counter moves up enough that the dot sits clear beneath it at both widths; nothing else on the tab moves.
6. Pin it: render tests for the bar's contents, the dot's three states and its words, the Dashboard without the badge; the probe as a pure module with its own test (timeouts, each mode).
7. Walkthrough 73 (`docs/walkthroughs/73_connection_dot.md` + README row, a copy in `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`), before and after; `docs/OUTSTANDING.md` (broken-and-unfixed only).

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- `fetch` resolves for every status: a storage probe reads `res.ok`; a 403 from a bucket is "storage not answering for you", not "connected".
- `withTimeout` races but never aborts (SYSTEMS_HANDBOOK §17): a storage probe that hangs must not hold auth-js's lock; use an `AbortController`.
- `src/ui/typeScale.test.js` allows weights 400/600 only and refuses an unjudged 2px edge; `src/dev/devFixtures.test.js` pins the fixtures' seams (the fixtures need a storage state to show all three colours).
- A subagent can overwrite your working tree: after each review round, assert the executable form with failing controls before committing its corrections.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`: files with escapes go through Write/Edit.
