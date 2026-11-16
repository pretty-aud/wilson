# Hand-off — Track B, bundle B2 part 2 (2026-09-07)

Written per `docs/sessions/HANDOFF_PROTOCOL.md` §4. The next Track B session
reads this after the protocol and before the brief. This is the session that
did B2 part 2 — the client emitters, the idle timeout and cap, the two
Sign-ins views, the connection-lost banner, migration 0071 — and its two
review rounds. It hands off at the bundle boundary: B2 is built, reviewed
and documented; what remains of it is Audrey's (walkthrough 11, two dashboard
steps, one migration on dev) and then the merge.

## 1. Where you are

- **Track B — sign-in and security.** **B1** finished through both review
  rounds, NOT merged (waits on the walkthrough 10 report). **B2** finished
  through both review rounds, NOT merged (waits on the walkthrough 11 report
  and on 0071 reaching dev — see §6). **B3** (the desktop server lock and the
  single-instance lock) is the next session's bundle.
- Branch **`track-b-auth`**, held checked-out by three stale worktrees now,
  so the first command is still
  `git fetch origin && git checkout --ignore-other-worktrees track-b-auth`.
- Commits since the B2 part 1 hand-off (`b884827`): `3e3dffc` merge of
  `feat/multi-user-v1` (`c045806`, docs only); `aafc488` B2 part 2 (the
  code, with the full design and every measurement in its message);
  `782db39` the docs; `85e9c84` and `4913a40` (two CI-visibility steps, below);
  `e5dd486` review round R2's fixes; then this hand-off's commit.
- **Nothing merged** into `feat/multi-user-v1`. When both walkthrough
  reports are in and 0071 is on dev: merge `feat/multi-user-v1` into the
  branch (expect the trivial adjacent-line conflict in `rls.yml`'s
  `RLS_TABLES` — Track C's `upload_reservations` beside `auth_events`; keep
  both), vitest, `git merge --no-ff track-b-auth` into `feat/multi-user-v1`,
  push both, watch CI. A merge deploys the beta client; 0070 and 0071 are
  already on staging, so the deploy is safe.

## 2. State, measured, not remembered

| Thing | Value | How measured |
|---|---|---|
| Migrations used from B's reservation (0070–0072) | **0070**, **0071** (`0071_auth_events_admin_scope.sql`); 0072 free | tree |
| Applied on **dev** | 0060–0064, 0066, 0070, 0073 — **0071 NOT applied**: the classifier refused `supabase db query --linked --file supabase/migrations/0071_…sql` against dev (twice would be working around it; once was tried). Audrey's step, OWED_AUDREY §14 step 4 | `schema_migrations` by query, 2026-09-07 |
| Applied on **staging** | 0064, 0066, 0070, **0071**, 0073 — 0071 applied through the throwaway `--workdir` link (allowed) and recorded with `migration repair`; policy qual carries `workspace_id IS NULL` | query: `inet_server_addr()` …`9d47`…, 1 workspace, 26 sessions |
| Applied on **prod** | not measured | — |
| Hooks enabled | **NO**, dev and staging (nobody enabled them) — so every `sign_in / failure` and `mfa_verify` row is still unwritten; only client rows exist | OWED §14 |
| pgTAP suites in the tree | **71** (01–70 + 74); suite 74 is now **35** assertions | `ls supabase/tests/rls` |
| Suite 74 | breaker on dev under 0070: #28 have 7 / want 6, #29 have 1 / want 0 (the defect 0071 fixes); shim (0071 + 74 in one rolled-back transaction) on dev **35/35**; on **staging for real 35/35**; on dev today **red on the two 0071 assertions** until 0071 is applied there | `tap-hosted.py` builds, `db query --file` |
| Vitest | **77 files / 1761 tests** green (was 72 / 1712) | `npx vitest run` |
| Playwright | 14 scenarios across three files (`auth.spec.ts` 6, `sessions.spec.ts` 5, `web-path.spec.ts` 3); **not runnable on this machine** (no `WILSON_E2E_PASSWORD`); CI runs them against wilson-dev as the smoke admin. **GREEN on `e5dd486`** (run 34083059724, all four jobs). The run before it, 34082552663, was 11 passed / 2 skipped / 1 failed, and that single failure was scenario 7's own assertion (§5 trap 2) — so the idle warning, the idle sign-out, the activity clear, the 4-hour cap and the connection-lost banner were already passing against the hosted project before it was fixed | check-run annotations |
| CI | **GREEN on `e5dd486`**, the last code commit — Vitest, pgTAP, Playwright and the issue-session smoke all success: https://github.com/pretty-aud/wilson/actions/runs/34083059724. `b5d67ef` (whitespace only) and this hand-off's commit get their own runs; read them from the branch list. Three earlier runs were red on Playwright ALONE, all for the one assertion in §5 trap 2 | public API `…/actions/runs?branch=track-b-auth` |
| `auth_events` rows on dev from CI's Playwright runs | **12 per run**: ten `sign_in`, one `idle_timeout`, one `session_cap` — every one `source: client`, `surface: app`, stamped with address, user agent, session id and company. This is the emitters, the timeouts and the stamp trigger proven end to end against a hosted project | `db query` on `auth_events`, after runs 34081470033 and 34081932783 |
| `resolve-login` | unchanged: dev v10, staging v12 | part 1 hand-off; not redeployed |
| Freeze reproduction | `node scripts/probes/connection-hang.mjs .env.local` on dev: control read 1392 ms; behind a refresh that never settles, a PostgREST read NO ANSWER after 10 000 ms with 0 `/rest/v1/` requests issued, `getSession()` NO ANSWER after 3 000 ms; the watchdog with a 5 s budget raised `lost` after 5 203 ms | this session, exit 0 |
| CLI link in the worktree | wilson-dev (`eqjzmnvkrakroyqxfsvw`); the staging link lived in a scratch workdir that dies with the session | `supabase/.temp/project-ref` |

## 3. Done and verified

1. **Merge of `feat/multi-user-v1` (`c045806`) into the branch** (`3e3dffc`)
   — docs only upstream; clean; vitest 72 / 1712 before any work.
2. **Client emitters** (`aafc488`, `src/cloud/auth/authEvents.js`):
   `sign_in` after a completed sign-in (App.jsx `handleAuth`, OperatorApp
   `handleSignedIn`), `sign_out` from the Settings control (App.jsx
   `signOutLocal`, the function `window.wilsonSignOut` now points at),
   `idle_timeout` / `session_cap` from the timeouts, each with
   `context.surface` (`app` / `admin`); bounded (4 s), error channel read.
   `WIL-1002` emitted on both expiries on the app surface (not the operator
   surface, on purpose — `reportAppEvent` writes to the company log).
   Verified: `authEvents.test.js` (body contract, error channel, ceiling);
   the contract is the one suite 74's client tests exercise.
3. **Idle timeout and cap** (`src/cloud/auth/sessionTimeouts.js`, the
   `useSessionTimeouts` hook, `SessionWarning.jsx`): 25 / 30 minutes, 4
   hours with a 5-minute notice, wall-clock, per-surface storage keys off
   `SESSION_STORAGE_KEY` (now exported from `sessionStorage.js`), shared by
   two tabs of one surface on purpose, visibility judged before it counts,
   the cap keyed by the JWT `session_id` so a reload keeps it. Both
   surfaces, `scope: 'local'`, the reason on the login screen
   (`LoginScreen` / `OperatorLogin` `notice`). Verified:
   `sessionTimeouts.test.js` (hand-stepped clock: warning, sign-out,
   activity, cap ignores activity, reload keeps the cap, surfaces isolated,
   tabs shared, visibility, hostile storage, JWT helpers),
   `sessionDialogs.test.js` (renderToString of both dialogs), e2e 8–10 in
   CI.
4. **Sign-ins views**: Admin Terminal → Logs → **Sign-ins** tab
   (`LogsSection.jsx`, `AdminTerminalPage` passes the roster `wm` for
   names) and the operator console's **Sign-ins** section
   (`src/admin/SignInsSection.jsx`, filtered to `platform_operators`). Shared
   labels in `src/cloud/auth/authEventLabels.js` (+ test). Unknown-username
   attempts stay in `auth_attempt_log` and in neither view (operator-readable
   only; a policy decision). Verified by build (both bundles) and by e2e
   scenario 7 in CI — which is also the scenario that caught its own bad
   assertion (§5 trap 2); no local sign-in was possible (§5 trap 1).
5. **The banner** (`src/cloud/connectionWatchdog.js`,
   `ConnectionLostBanner.jsx`, wired as `global.fetch` in
   `supabaseClient.js`): reproduced first (§2's numbers, the script is
   `scripts/probes/connection-hang.mjs`); watches `/auth/v1/*`,
   `/rest/v1/*`, `GET|HEAD /storage/v1/object`; never uploads, the
   resumable path, `/functions/v1/*` (all raw fetch in this codebase) or
   realtime; 20 s budget while `navigator.onLine`; a late settle clears it;
   under the 32 px title bar in Electron. Verified:
   `connectionWatchdog.test.js` including the NO-FALSE-POSITIVE upload test,
   e2e scenario 11 in CI.
6. **0071** — narrows 0070's admin read arm (`OR is_member…` applied to
   every row, so an admin of company A could read a shared member's client
   rows for company B, address included): §2's breaker / shim / staging
   numbers. The Admin Terminal view also filters those rows on screen (belt;
   0071 is the braces).
7. **Docs, own-bundle lines only** (`782db39`): `OUTSTANDING.md` (the
   hung-`getSession()` entry narrowed to "reconnect deferred, banner
   shipped"; a session-log row at the top), `CHANGELOG.md` Known-limitations
   bullet rewritten, `SYSTEMS_HANDBOOK.md` §17 B2 bullet → shipped,
   `OWED_AUDREY.md` §14 (hook wording, the dashboard figures, step 4: apply
   0071 on dev), `RELEASE_TESTING.md` §B three lines, `TPN_AUDIT/FINDINGS.md`
   TPN-AUTH-004 / TPN-LOG-003 / TPN-LOG-007 annotated, walkthrough
   `docs/walkthroughs/11_sessions_and_logs.md`. Markers re-counted:
   OUTSTANDING 4/4, FINDINGS 0/0, others 0/0.
8. **Review rounds.** R1 by this session over the App.jsx session-block
   diff and the track's invariants. **R2 by a fresh-context, read-only
   subagent** over `aafc488` + `782db39`: no HIGH, two MEDIUM, eight LOW,
   all fixed in `e5dd486` (its message carries each one).
   - **M1, the one that mattered:** `expire()` deleted the cap clock BEFORE
     `onExpire`'s sign-out ran, and that sign-out awaits `getSession()`
     internally — the hang this bundle's own banner exists for. A hung or
     interrupted sign-out therefore left the persisted session in place with
     no start time, and the next boot handed it a FRESH four hours. The
     absolute cap was defeated by the sign-out it triggers. Both keys now
     survive the expiry (they are keyed by session id), and both sign-out
     paths clear the stored session FIRST and bound `signOut()` at 4 s.
   - **M2:** the cap notice was a modal with a backdrop and `autoFocus` on a
     session that is by definition busy — it ate clicks and pulled the caret
     out of whatever was being typed, on the one notice that says "save your
     work". Now a non-modal card. R2 also showed the idle dialog's button
     cannot be reached by a click (any input clears the warning first, which
     is what its copy promises); kept, with a comment saying why and why not
     to "fix" it by narrowing the activity events.
   - LOW: a future activity timestamp (a backwards clock) suppressed the
     idle timeout; a double sign-out wrote two rows; the Sign-ins query
     filtered by company after `.limit(200)`; a stale comment in
     `LoginScreen`; `import.meta.env?.DEV` made the dev-override fold depend
     on the bundler matching an optional chain. All fixed, the DEV key
     grep-proven absent from the production bundle.
   - R2's own verification list is in its report; it independently checked
     the four track invariants, the watchdog's reach into supabase-js
     2.101.1, z-order, 0071's deparsed policy, and every on-screen label the
     walkthrough quotes.

## 4. In flight — exact next actions

Nothing uncommitted. What is left of B2 is not code:

1. **Audrey applies 0071 on dev** (OWED §14 step 4, the exact commands), then
   `node scripts/tap-all.mjs 74` reads 35/35 there too.
2. **Audrey enables the two hooks** on dev and staging (OWED §14 steps 1–3)
   — until then the Sign-ins views show only the app's own rows, never a
   failed password or a two-factor check.
3. **Walkthrough 11** on the beta → her report. Steps 4 and 6 are 30
   minutes and 4 hours of wall-clock; Step 9 needs the modem dropped, not
   Wi-Fi (the walkthrough explains why).
4. **Merge** B1 + B2 when both reports are in (§1).
5. Then **B3** in a new session (the brief's third bundle: the per-launch
   token on every desktop request, the single-instance lock — `electron/`
   files Track B owns; suite 75–76 and 0072 still free if it needs them).

## 5. Traps hit

1. 🚨 **Three classifier refusals, all recorded, none worked around:**
   `supabase projects api-keys --project-ref <dev>` (wanted the service role
   to create a probe member through the admin API); `supabase db query
   --linked --file <scratch>.sql` whose body was an `INSERT INTO auth.users`
   (a probe member by SQL, the pgTAP-fixture shape); and the 0071 DDL
   `supabase db query --linked --file supabase/migrations/0071_…sql` against
   dev. The SAME DDL through `--linked --workdir <scratch linked to staging>`
   was allowed — per command, per session, as the protocol says — which is
   how staging ended up AHEAD of dev on 0071. Consequence for the session:
   **no real sign-in was possible**; the browser checks were the signed-out
   boot of both surfaces; everything session-shaped is verified by unit
   tests, the reproduction script, and CI's Playwright lane (which has the
   password).
2. 🚨 **Never assert on a table ROW's text — assert on its cells.** A row's
   `innerText` is its cells concatenated with NO separator, so the Sign-ins
   row came back as `just nowSigned inSmoke Adminapp52.161.82.87--` and
   `/app/` could not match: "Admin" runs straight into "app". The row
   was correct and the assertion was not, and it cost three CI runs.
   `row.getByRole('cell').nth(n)` with `toHaveText` is the shape that works.
3. 🚨 **A failed GitHub Actions job's LOG is unreadable without a sign-in.**
   `gh` is not authenticated here; the REST log endpoint answers 403 "Must
   have admin rights to Repository" even on a public repo; the web log needs
   a signed-in browser; the raw-log URL 404s. The only public artefact is
   check-run ANNOTATIONS. So `playwright.config.ts` now adds the `github`
   reporter under `CI`, which emits one `::error` per failed test — title,
   file, line and the assertion — as annotations, readable through
   `…/check-runs/<job id>/annotations`. That turned "Playwright is red" into
   the exact line in one run. Do the same for any future CI-only failure.
4. **A Playwright `click()` MOVES the pointer first, and pointer movement is
   activity.** The idle dialog therefore unmounts under the cursor before
   the press lands — correct behaviour, impossible test. Use
   `keyboard.press('Enter')` on the autofocused button (a keydown is
   activity too, so it also passes, but deterministically).
5. **vitest's esbuild uses the classic JSX runtime**, so the first test that
   rendered a `.jsx` component with `renderToString` died with "React is not
   defined" — silently, as an empty string, until printed. Fixed in
   `vitest.config.js` with `esbuild: { jsx: 'automatic' }` (the React plugin
   only configures `vite.config.js`). React's SSR also puts `<!-- -->`
   between text and an expression: match with `(<!-- -->)?`.
6. **`useSyncExternalStore` under `renderToString` reads the SERVER
   snapshot** (the third argument). Pass the same reader as the client one;
   a hard-coded `false` renders nothing in a test.
7. **auth-js 2.101.1 with `persistSession: false` uses `lockNoOp`** in Node
   AND in the browser (`navigatorLock` only when `persistSession` is on), so
   the pin measured in OUTSTANDING is `refreshingDeferred` — one shared
   promise every caller awaits — rather than the lock. Same effect, one
   mechanism; the reproduction script shows it (0 requests issued behind
   the hang).
8. **Tool calls issued together run together.** An `Edit` and a `vitest run`
   of the edited file in one message raced; the run reported the old file.
   Edit first, run next.
9. **A long commit message through a shell heredoc failed on quoting**; write
   it with the Write tool and `git commit -F`.
10. **The CLI's `db query` JSON now carries a `warning` field** about
   untrusted data and a banner before the body; parse from the first `{`.
11. **All pages are mounted at once**, so the roster fetch happens at
   sign-in; an e2e that needs a request it controls must click a Refresh
   (LogsSection's) rather than navigate to a page.
12. **`npx playwright test --list` needs `WILSON_E2E_PASSWORD=dummy`** —
   `authFlow.ts` throws at import without it; the list is the cheapest
   compile check of a new spec.
13. The browser pane's screenshot timed out on the operator login page
    (twice); `get_page_text` still read it. Not the page's fault.
14. `git status` in the worktree root always shows `?? .claude/` (the
    pane's `launch.json` lives there); never `git add -A`.

## 6. Waiting on Audrey

- **Walkthrough 10 report** (B1's merge gate) — unchanged from the last
  hand-off.
- **Walkthrough 11 report** (`docs/walkthroughs/11_sessions_and_logs.md`,
  B2's merge gate).
- **OWED_AUDREY §14:** steps 1–3 (enable the two hooks on dev and staging,
  then the probe query) and the new **step 4** (apply 0071 on dev; the three
  commands are in the file). Also the dashboard session figures: a
  time-box of 4 hours or more, an inactivity timeout of 30 minutes or more.
- **Decisions:** (a) the 4-hour cap shipped as the default — say if it
  should be longer; the number lives in one constant
  (`SESSION_CAP_MS`, `sessionTimeouts.js`). (b) The banner fires only while
  the browser says it is online (the brief's wording: the silent hang); with
  Wi-Fi OFF the browser knows, requests fail fast and the screens show their
  own errors — if you want the banner there too it is one condition in
  `connectionWatchdog.js` (`isOnline`). (c) The 5-minute "Session ending"
  notice before the cap is this session's judgment — keep or drop.
- **Three things R2 raised that are decisions, not defects, and were left
  alone rather than changed unilaterally:** (a) an operator's console
  sign-ins are stamped with their JWT's company (0070's trigger has no
  opt-out), so they appear in that company's own Admin Terminal → Sign-ins
  as "operator console" rows — accurate, and the operator is a member there,
  but say if operator activity should be invisible to a company admin.
  (b) A non-operator who tries the console door gets a `sign_in` row with
  surface `admin`; true, but "Signed in — operator console" may read as
  granted access. (c) An operator whose JWT company claim points at a
  company they are no longer active in has every console row refused by the
  INSERT policy, silently (a console warning only).
- **Optional:** `gh auth login` on this machine — the public API served for
  runs and annotations, but a FAILED job's log needs it (§5 trap 3).

## 7. Next session's first three steps, verbatim

1. In the fresh worktree (cut from `main`; `docs/sessions/` is absent until
   the checkout): `git fetch origin && git checkout --ignore-other-worktrees
   track-b-auth`; `npm install --ignore-scripts`; `git checkout --
   WILSON/package-lock.json`; copy `.env.local` from
   `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.env.local` into
   the worktree's `WILSON/`; from `WILSON/`: `supabase link --project-ref
   eqjzmnvkrakroyqxfsvw --password ""`; confirm `supabase/.temp/project-ref`
   says `eqjzmnvkrakroyqxfsvw`.
2. Read CI on the branch head (public API). Re-measure §2: is 0071 on dev
   (`schema_migrations`)? are the hooks enabled (a `gotrue_hook` row after a
   sign-in)? run `supabase db query --linked --file
   scripts/probes/auth-events-recent.sql` — CI's Playwright runs leave the
   smoke admin's `sign_in` / `sign_out` / `idle_timeout` / `session_cap`
   client rows on dev, addresses stamped, which is the cheapest proof the
   emitters work end to end. If both walkthrough reports are in AND 0071 is
   on dev: merge `feat/multi-user-v1` into the branch (keep both `RLS_TABLES`
   lines), vitest, `git merge --no-ff track-b-auth` into `feat/multi-user-v1`,
   push both, watch CI. If not, B3 proceeds on the track branch and the
   merge waits.
3. Bundle **B3** per `TRACK_B_signin_security_prompt.md`: the per-launch
   token in `startLocalServer` (header for renderer fetches through the
   preload bridge, cookie for `<img>`/`<video>` loads, `cors()` narrowed to
   the renderer's origin in both modes), the harness with a failing control,
   `app.requestSingleInstanceLock()`; walkthrough `12_desktop_local_mode.md`.
   One bundle, then hand off.

## 8. Auto-memory

None, per the protocol: this file is the memory.
