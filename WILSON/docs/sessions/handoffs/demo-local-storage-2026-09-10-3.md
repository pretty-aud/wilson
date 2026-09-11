# Hand-off — demo sprint, local storage — 2026-09-10 (third session)

Session: Fable 5.1 at max effort, worktree `peaceful-merkle-c5a139`, branch
`demo/local-storage`. Brief: `docs/sessions/DEMO_LOCAL_STORAGE_BRIEF.md` —
**§7 is new and changes the story: Audrey's clarification and her decision
for Friday.** Previous hand-offs (their §5 traps all still apply):
`demo-local-storage-2026-09-10-2.md`, `demo-local-storage-2026-09-10.md`.
Protocol: `docs/sessions/HANDOFF_PROTOCOL.md` §4 order below.

## 1. Where you are

- Item: **local storage** for the Friday 2026-09-11 demo. The bin session
  runs in parallel on `demo/bins`; its latest hand-off is
  `demo-bins-2026-09-10-3.md`.
- Branch `demo/local-storage`, pushed. Last content commit **`1572670`**;
  head at the last edit of this file **`493e91a`** (docs only after
  `1572670`). **Integrated**: `origin/feat/demo-2026-09-11` =
  `origin/demo/local-storage` = `493e91a`, verified by ls-remote at 22:57
  (verify with `git ls-remote origin refs/heads/demo/local-storage
  refs/heads/feat/demo-2026-09-11`; if they differ, merge
  `origin/feat/demo-2026-09-11` into the branch and re-push, plan §2 step 3).
- Commits this session, oldest first:
  - `1572670` docs(local-demo): Audrey's clarification, the two-part Friday
    demo (option 1), the offline launch MEASURED.
  - `75de78e` merge: `origin/feat/demo-2026-09-11` (`2626bb6`, the bins'
    milestone 2 + two review rounds) into `demo/local-storage`.
  - `4562183` docs: this hand-off; `3221544` merge: `origin/feat/demo-2026-09-11`
    (`0040f58`, the bins' hand-off 4) into `demo/local-storage` — the head
    after this file was written; both refs verified at `3221544`.
  - **No code changed this session.** Everything below is docs, measurement
    and a decision.
- Audrey's canonical checkout was at `efd4042` at 22:50 (she pulled during
  the day; that head has all the local-storage code and the bins' milestone 2
  but not `ff1b031`, their relink-poster fix, nor this session's docs). She
  needs `git pull --ff-only` once more.

## 2. State, measured

- vitest: **1920 / 80 files** at `75de78e` (previous hand-off 1862 / 78; the
  bins' milestone-2 suites came in with `2626bb6`). Expect ≥ 1920 / 80.
- CI on `75de78e` (public GitHub API, check-runs by SHA, read 22:50 local):
  two workflow runs as usual. Run 34556121009: Vitest ✔, issue-session smoke
  ✔, Vercel ✔, Playwright auth in progress, **pgTAP ✘ at step 3 "Install
  Supabase CLI"** — 1 s into the job, before the coverage guard or any test
  ran (steps 4–6 skipped). The same CLI-download transient hand-off 1 saw at
  `862fbc8`; nothing under `supabase/` or `.github/` is in this session's
  push (`1572670` is docs-only, and `2626bb6`'s own CI was fully green,
  pgTAP ✔ on both runs). Run 34556119508, re-read at 22:52: **pgTAP ✔,
  Playwright auth ✔, Vitest ✔, smoke ✔** — the head is green on a full run.
  `3221544` (docs only) was pushed at 22:54; read it the same way:
  `curl -s https://api.github.com/repos/pretty-aud/wilson/commits/3221544/check-runs`.
- **Audrey's decision (brief §7, verbatim there).** Her words at ~02:20:
  *"local file storage should be solely for media and files, database entries
  and data should still be cloud based. only file storage is local with local
  selected."* Measured against the code: that model (rows in Supabase, file
  bodies on a local folder) exists in NO mode — Supabase mode refuses uploads
  for a workspace on its own server / NAS / local folder (S36,
  `supabaseAdapter.js` `uploadFile`), and managed files, disk thumbnails and
  the bins are `local_server`-only (`supportsManagedFiles`, `supportsBins`).
  The folder as built (brief §1–§3, from her 2026-09-08 words) moves the DATA
  local and pins Local Server on open — the opposite. Offered three options;
  she chose **option 1 at ~22:30: two parts, nothing new built** — part 1 in
  Supabase mode (her real projects and databases), part 2 after Settings →
  Storage → *Storage Backend* → Local Server (the demo folder + the bins).
  Declined: (2) Local Server only with a one-time copy of her cloud projects
  into the folder; (3) Supabase only. The target model is the `network`
  provider's second half (`NETWORK_STORAGE_DESIGN.md` §4a2b): a post-Friday
  session, more than a day, adapter-level. **Confirmed late 2026-09-10 through
  the controller session ("Wilson multiuser merge and PR"), her words:**
  *"i dont need cloud mode for bins till next week. i just need local for
  testing."* — the demo folder and the bins stay Local Server only, as built;
  option 2 and the network-provider model are next week's work.
- **The offline launch, MEASURED in a real window** (staging build at
  `b8c2bed`, Audrey's real sign-in saved on a scratch-userData test window,
  driven over CDP; times from the renderer's `load` event):

  | Launch | The session restore | Sign-in screen up |
  |---|---|---|
  | online, signed out (baseline) | none | +4.5 s (the sign-in screen's own reveal) |
  | `WILSON_DEV_OFFLINE=1` | `GET /auth/v1/user` cancelled (`ERR_BLOCKED_BY_CLIENT`) at +10 ms; `[wilson] setSession failed: Failed to fetch` | +4.5 s |
  | `WILSON_DEV_OFFLINE=stall` | left pending; `[wilson] session restore skipped: session restore timed out after 15000ms` at +15.0 s | +19.3 s (4.3 s after the timeout) |

  Never an orange window. Note the two different console lines: with `=1`
  `hydrateSupabase` catches the fetch error itself (`setSession failed`) and
  returns null; the `session restore skipped` line is the `withTimeout`
  path only. `OUTSTANDING.md`'s entry is now MEASURED; walkthrough 18 "The
  cable pulled" and handbook §12.8 carry the numbers.
- Not built, on purpose: the offline-tolerant launch (dropped — part 1 needs
  the cloud); Q3 adopt-existing; Q4 seed content (`planDemoProject` in
  `src/components/local/localDemoClient.js` is still the placeholder);
  the `MfaSection.jsx` one-liner (Track B's file, waits on her yes).
- No migrations, no Edge Functions, nothing deployed, no `.env.*` committed.

## 3. Done and verified

| What | Commit | How verified |
|---|---|---|
| Audrey's clarification recorded verbatim with what it means against the code, and her option-1 decision | `1572670` | brief §7; plan §7 dated addendum (append only); walkthrough 18 "How Friday runs" (the two-part rehearsal, sent to her with SendUserFile at 22:51); handbook §12.8 "Not this feature" |
| Offline launch measured (table above), OUTSTANDING INFERRED → MEASURED | `1572670` | CDP boot logs (`boot7.log`, `window4.log`, `window7.log` in this session's scratchpad — not in the repo); the numbers are in three docs |
| The bin session told: option 1, bins stay local_server-only, nothing new needed from them | — | cross-session message delivered ~02:50, their turn started on it |
| Integration | `75de78e` | vitest 1920 / 80; both pushes verified by `git ls-remote` |
| Three test windows opened on Audrey's screen and closed; the scratch userData (her `session.enc`) deleted after each | — | `ls` of the scratchpad after each close |

## 4. In flight

- **Audrey's rehearsal of the two-part flow** — walkthrough 18 "How Friday
  runs" — on her checkout after `git pull --ff-only`. Not reported at
  writing. Her only report tonight was the Local-Server-default trap in a
  fresh test window (§5, not a defect).
- CI: `75de78e` green on a full run (§2); `3221544` and `493e91a` are docs-only
  merges/commits after it — read them by SHA if a green mark on the exact
  head is wanted.
- Friday morning is fixes only (plan §0). Do not build the target model
  before the demo.
- This session ended on the controller's instruction once her answer left
  nothing to build: hand-off updated, integrated, `git checkout --detach`
  run — the branch is free for a continuation.

## 5. Traps hit (this session; the previous hand-offs' §5 all still apply)

- **A fresh userData defaults the Storage Backend to Local Server**
  (`DEFAULT_ADAPTER_MODE = 'local_server'`, `RabbitProvider.jsx:56`;
  `otter-settings.json` has no `rabbit.adapterMode` until someone switches).
  A signed-in test window therefore shows NO cloud projects and the
  Dashboard says "needs the cloud" — Audrey read that as *"cloud access is
  not working. projects and databases are not showing up"*. Say it in the
  chat whenever a test window opens, with the click (Settings → Storage →
  *Storage Backend* → Supabase).
- **Closing the test window over CDP:** `Browser.close` does nothing in
  Electron sent on the page target (an error, window stays) and HANGS on the
  browser target (`/json/version`'s socket never answers). What works:
  `Runtime.evaluate` of `setTimeout(function(){window.close()},50)` — the
  window closes in under a second and the process exits. Graceful fallback:
  `taskkill /PID <pid>` (WM_CLOSE); `/F` last.
- **Two tool calls do not start together.** A background launch and a
  foreground watcher issued in one response started up to several seconds
  apart; the watcher attached to the wrong window twice. Put the launch
  (`electron … > log 2>&1 &`) and the watcher in ONE shell command; the
  watcher retries the CDP target for 60 s (`node cdp.js boot N`: attach,
  `Network`/`Runtime`/`Log`/`Page` enable, poll a structural probe — input
  counts and `innerText`, never input values).
- **Audrey interacts with every test window she sees** — she signed in within
  a minute both times and created a project in the first one. Say what the
  window is for and when it will close; close it only for a stated reason.
- Doc edits: 13 exact single-occurrence replacements across five CRLF docs
  via a spec file + a 25-line Node patcher (scratchpad `patch.js`, block
  format `@@FILE / @@FIND / @@REPLACE / @@END`, CRLF normalised for matching
  and written back). The Edit tool was not used on repo docs: its
  Read-before-Edit rule needs the Read tool, and Bash `cat` does not count.
- pgTAP's "Install Supabase CLI" transient again (hand-off 1 saw it at
  `862fbc8`); the twin run is the tie-breaker, never a re-push.
- The cross-session message to the bin session was delivered immediately
  (their turn started on it); hand-off 2 saw it queued behind a busy turn.
  Read `list_events` on the target before relying on either.
- Time: Audrey's day spans both ends of a session — she signed in at 02:18
  and again at 22:35; GitHub's timestamps are UTC (local + 4 h).

## 6. Waiting on Audrey

1. **The rehearsal report** of the two-part flow (walkthrough 18 "How Friday
   runs": part 1, the switch, part 2, the switch back), on `75de78e` or later.
2. **`MfaSection.jsx`** `data.all` one-liner (hand-off 2 §6 item 4) — Track
   B's file; still no yes at hand-off (the controller confirmed late
   2026-09-10): unbuilt. The same for the offline-tolerant launch (hand-off 2
   §6 item 3): no yes, unbuilt, and moot for Friday since part 1 needs the
   cloud.
3. **Q4 seed content** — only if she wants a seeded project for part 2
   (*Create demo project* makes "Friday Demo" with placeholder scene/shot
   names). **Q6** which machine / OS.
4. Post-Friday: the "only file storage is local" build — its own session
   (brief §7 says where the pieces are).
5. The O.T.T.E.R. software routes traversal (`OUTSTANDING.md`, INFERRED) —
   who takes it; not this item.

## 7. Next session's first three steps

1. `git fetch origin && git checkout demo/local-storage` (the branch exists;
   `git checkout --ignore-other-worktrees demo/local-storage` if a stale
   worktree holds it), confirm `git rev-parse HEAD` = `git rev-parse
   origin/demo/local-storage`; `npm install --ignore-scripts && git checkout
   -- package-lock.json`; copy `.env.local`, `.env.staging`,
   `.env.development` from the canonical checkout into `WILSON/`; set
   `ELECTRON_OVERRIDE_DIST_PATH` to the canonical
   `node_modules\electron\dist` (hand-off 1 §5).
2. Read brief §7, this file, hand-off 2 §5 and hand-off 1 §5; `npx vitest
   run` (expect ≥ 1920 / 80); read CI on `75de78e` by SHA (§2).
3. Take Audrey's rehearsal report as the work list (Friday morning: fixes
   only). Nothing new is built for the demo; the target model waits.

## 8. Auto-memory: none

This file is the memory.
