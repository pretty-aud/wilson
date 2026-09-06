# TRACK B launch prompt — SIGN-IN AND SECURITY (company-first sign-in, auth logging + timeouts, the desktop server lock)

> **One of three tracks that run at the same time.** The plan and Audrey's
> rulings are in `FIX_PLAN_2026-09-04.md`; this brief is Track B. Tracks A
> (product logic) and C (storage and files) run in their own worktrees.
> **This track owns** `src/cloud/auth/**` (`LoginScreen.jsx`,
> `ResetPasswordWizard.jsx`, `AuthShell.jsx`, `sessionStorage.js`,
> `supabaseClient.js`), the SESSION BLOCK of `src/App.jsx` (sign-in effects,
> `wilsonSignOut`, `withTimeout` call sites — not the pet effects, which are
> Track A's), `src/cloud/withTimeout.js`, `supabase/functions/resolve-login/`,
> `supabase/functions/_shared/*Guard.ts`, `electron/main.cjs`'s server
> (`startLocalServer`, the Express middleware, `cors()`) and
> `electron/preload.cjs`, `src/components/TeamMembers/useRosterMembers.js`,
> and the operator console's sign-in (`src/admin/OperatorLogin.jsx`).
> Anything else, ask the owning track.

> **Numbers reserved for this track:** migrations **0070, 0071, 0072**; pgTAP
> suites **74, 75, 76**. Gaps are fine; collisions are not.

> **STATE — re-measure, do not trust this block.** At `606f91d` (2026-09-04):
> migrations `0000`–`0066` in the tree; dev and staging carry 0059–0064 and
> 0066 with 0065 skipped; prod at 0063. pgTAP 70 suites. Vitest 1706 / 71
> files. CLI linked to wilson-dev. **Facts this brief leans on, measured
> 2026-09-04:** `workspace_members` has carried `UNIQUE (workspace_id,
> username)` since 0001; `resolve-login`'s body type already accepts
> `workspace_slug` or `company` and resolves a display NAME or a slug
> (`slugifyWorkspace`); `app.requestSingleInstanceLock` appears nowhere in
> `electron/main.cjs`; nothing in `src/` implements an idle timeout (the only
> `IDLE_` constant is an animation hold in `AuthShell.jsx`); `WIL-1001`,
> `WIL-1002`, `WIL-1003` are declared in `src/cloud/errorCodes.js` and emitted
> by nothing.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill.** Read `docs/fixes/README.md` "Rules that
   apply to every phase", `FIX_PLAN_2026-09-04.md` "Rules for running tracks in
   tandem", and `TPN_AUDIT/FINDINGS.md` for TPN-AUTH (sessions, MFA), TPN-LOG
   (auth events, TPN-LOG-007) and TPN-NET (the loopback server).
2. **Read `HANDOFF_PROTOCOL.md` and do its fresh-worktree setup.** You start
   inside a worktree the desktop app made for this session (a `claude/…`
   branch cut from `feat/multi-user-v1`): rename it `track-b-auth` (or check
   out that branch if a hand-off says it exists), `npm install`, copy
   `.env.local` from the canonical checkout, and `supabase link` to wilson-dev
   from `WILSON/` inside the worktree — `supabase/.temp/` is gitignored, so
   the worktree is UNLINKED until you do. Check `linked-project.json` and
   `project-ref` say wilson-dev before anything writes. **One bundle per
   session; hand off at the boundary as the protocol says.**
3. **Re-measure the STATE block** and the facts above by grep and by query.
4. **Read `docs/OUTSTANDING.md`** for: *One hung `getSession()` pins the whole
   app's auth*, *`ResetPasswordWizard` still performs a global sign-out*,
   *`useRosterMembers` cannot tell a broken roster from an empty one*, *The
   loopback server has no authentication, and since S40 it serves ORIGINAL
   media*. And `SYSTEMS_HANDBOOK.md` §17 "Correctness" (the username
   collision) and "Security-adjacent".
5. **Bundle order is B1 → B2 → B3.** B1 changes the first screen every person
   sees, so it goes first and gets the longest soak on the beta.

---

## Bundle B1 — company-first sign-in (1 session)

### What is wrong

A username that exists in two companies makes sign-in unreachable: the
resolver treats two matches as a miss unless a workspace slug disambiguates,
and the login screen has no company field (`MASTER_PLAN.md` §6 #57, accepted
at 1.0.0 because adding the field changes the first screen). Also in this
area: a password reset revokes every session the person holds, including the
operator console, and says nothing; and a roster that fails to load is
indistinguishable from an empty one because `useRosterMembers` drops the error.

### Audrey's decisions

Answer 34, verbatim: *"at login the user first lists what company they are
with, THEN it asks for the login. and when setting it up the account for the
first time, this is already decided what company it is with. how this should
work is that for logging in, the system should confirm the company listed
first exists and is real, after it makes sure the company exists THEN it
should pull from that companies list. so a user could have multiple companies
they work for and want to have the same name. think of how in files you can
have two files with the exact name as long as they are in a different folder,
this is how it should work. when creating an account the username should
check for duplicates within just the same company."*

12: *keep signing out everywhere on a password reset; say so on screen.*
17: *show an error when the roster fails to load.*

### What already exists (measure it, do not rebuild it)

- Usernames are ALREADY unique per company at the database
  (`UNIQUE (workspace_id, username)`, 0001) — her "two files in different
  folders" rule is the schema today. Account creation (`admin-create-user`,
  `invite-member`) already lands on that constraint; check that each turns
  the violation into a friendly "that username is taken in this company"
  rather than a raw error.
- `resolve-login` already accepts `workspace_slug` / `company` and resolves
  either the display name or the slug. `LoginScreen.jsx` already references
  `workspace_slug` somewhere — find how (a hidden parameter? a deep link?).
- `fetchUserWorkspaces()` and the post-sign-in workspace chooser handle a
  person with several memberships today. Company-first makes the chooser
  redundant at sign-in; measure whether anything else uses it (a "switch
  company" control in Settings would still need it).

### What to build

1. **Two steps on the sign-in screen.** Step 1: *Company* (display name or
   slug; remember the last company on this device; a deep link may pre-fill
   it). Step 2: *Username* and *Password*, submitted with the company. The
   resolver is called WITH the company every time from the new client, so the
   "two matches is a miss" branch is unreachable from it; keep the branch for
   older clients and the CI smoke.
2. **"Confirm the company exists first" — her ruling, built carefully.** A
   visible confirmation before credentials is what she asked for, and it is
   also company-name enumeration: an outsider can learn which companies are
   real. Build it as: a rate-limited check through the DURABLE limiter
   (`fn_rate_limit_hit`, `edge_rate_limits` — not a per-isolate Map), a
   constant-time response, and ONE wording for "no such company" and
   "company exists but is suspended" so the step reveals existence only, never
   status. Record the residual risk in `SYSTEMS_HANDBOOK.md` §17 and in the
   TPN pack as an accepted, rate-limited disclosure. State in the commit that
   this was her ruling and what it discloses.
3. **Username enumeration must stay closed.** The credentials step's failure
   wording and timing are identical whether the username or the password was
   wrong — `RELEASE_TESTING.md` already has a `[BLOCKING]` step for this
   ("Different wording or a visibly faster failure is a username-enumeration
   leak"). Keep the resolver's constant-time behaviour; add a Playwright
   assertion for the wording.
4. **Password reset:** keep the global `signOut()` in `ResetPasswordWizard.jsx`
   and add the on-screen line *"You will be signed out on every device"*.
   Delete the `OUTSTANDING.md` entry as decided-by-Audrey.
5. **Roster errors:** `useRosterMembers` returns `{ members, error }`; every
   call site (`RateCardPage.jsx`, `workspaceStorage.js`, the supabase adapter)
   shows or propagates the error; a test that fails when the hook swallows it.

### Traps

- 🚨 **CI signs in through the UI.** The `issue-session-smoke` job and the
  Playwright job (`tests/e2e/auth.spec.ts`, `tests/e2e/web-path.spec.ts`) log
  in as `smoke_admin` with `WILSON_E2E_PASSWORD`. Changing the first screen
  without updating those specs turns CI red in a way that looks like a test
  failure. Update them in the same commit; the smoke fixture's company is the
  seed workspace.
- 🚨 The operator console (`/wilsonadmin`, `OperatorLogin.jsx`) signs in with
  email + password + TOTP and has no company — leave it alone.
- 🚨 **After renaming any user-visible string, grep `docs/`** — `RELEASE_TESTING.md`
  Part 1 walks the sign-in screen step by step, and `OWED_AUDREY.md` §12's
  runbook does too. Update both.
- `resolve-login` keys its per-IP throttle on the FIRST `X-Forwarded-For` hop
  (spoofable, TPN-NET-004); while you are in the function, key it on the last
  hop like `provision-workspace` did.
- Two accounts in two browsers at once is how Audrey tests; the "remembered
  company" is per device, never per account.

### Definition of done

Company-first flow on the beta; CI green with the updated Playwright and
smoke specs; enumeration assertion in Playwright; wording identical for bad
username vs bad password (measured with two timed requests); reset-screen
copy; roster errors surfaced with a test; walkthrough `10_sign_in.md` with
the exact new labels; `RELEASE_TESTING.md` and `OWED_AUDREY.md` §12 updated;
`OUTSTANDING.md` entries for the reset and the roster deleted; §6 #57 marked
CLOSED in `MASTER_PLAN.md`; session-log row.

### Test plan (Audrey)

Two companies on staging with the same username in both (create the second
through the operator console). Sign in as each by naming the company first.
Type a company that does not exist — read the message; type a suspended one —
the message must be the same. Type a wrong password and a wrong username —
same message, same feel. Reset a password and read the "signed out
everywhere" line; confirm the operator console tab did sign out.

---

## Bundle B2 — auth logging, idle timeout, the freeze banner (1–2 sessions)

### What is wrong

- **No sign-in, sign-out, session expiry or failed MFA challenge writes an
  audit row anywhere** (TPN-LOG-006/007, `CHANGELOG.md` "Known limitations").
  Two of the three declared codes cannot be wired client-side at all: at
  sign-in failure there is no session, and `app_events`' INSERT policy requires
  one. Operator sign-in and guard refusals are equally unlogged.
- **No idle timeout, no absolute session cap, no concurrent-session control**
  (TPN-AUTH, `FINDINGS.md`'s AS-3.8 re-audit). Refresh rotation is unbounded.
- **One hung `getSession()` pins the whole app.** supabase-js awaits
  `_getAccessToken()` for every PostgREST, Storage and Functions call; an
  abandoned call keeps auth-js's global per-`storageKey` lock; `withTimeout`
  races but never aborts. Bounding N call sites fixes N UIs, not the app
  (`OUTSTANDING.md`, MEASURED S21).

### Audrey's decisions

23: *log sign-ins* and *idle timeout* — both; **admin two-factor stays
optional** (not chosen). 10: *a "connection lost, reload" banner*; proper
reconnect logic deferred.

### What to build

1. **Logging — MEASURE BEFORE BUILDING A WRITER.** Supabase's GoTrue keeps its
   own audit stream in `auth.audit_log_entries` (login, logout, token refresh,
   MFA verify) and failed challenges in `auth.mfa_challenges`
   (`verified_at IS NULL` — the S17 investigation read that table). Query
   wilson-dev with the throwaway-workdir recipe and confirm which actions are
   present and what payload they carry. **If they are there, do not invent a
   writer; build a READER**: migration **0070** adds a SECURITY DEFINER
   function that returns those entries scoped to the caller's workspace
   members (join on `workspace_members.user_id`; cross-tenant otherwise), with
   `REVOKE ... FROM PUBLIC, anon` (the grantee lesson: suite 35 asserts ZERO
   anon-executable definer functions in `public`), plus an Admin Terminal
   "Sign-ins" view under Logs, and an operator-console mirror for operator
   sign-ins. Suite **74** proves a member cannot read another company's rows
   and an admin cannot read outside their company. If the GoTrue stream is
   missing what TPN wants, THEN add the server-side writer for the gaps only,
   and say which.
2. **Idle timeout and session cap.** Client-side, both surfaces (`/wilson`
   and `/wilsonadmin`, web and Electron): activity tracked on pointer, key
   and visibility events; a warning at 25 minutes idle, sign-out at 30
   (TPN AS-3.8's figure); an absolute cap (state the number in the commit,
   TPN asks for 4 hours) that signs out regardless of activity and says why.
   🚨 The sign-out is `scope: 'local'` (S31: a global revoke drops the same
   person's operator console minutes later with nothing on screen connecting
   the two). Supabase's dashboard time-box and inactivity settings are Audrey's
   to set per project; note them in `OWED_AUDREY.md` rather than pretending
   the client is the whole control.
3. **The freeze banner.** Reproduce the hang first (cut the network mid-session
   on the beta; watch a `.from()` call never resolve) and record the
   reproduction. Then a watchdog scoped to PostgREST/Storage/Functions calls
   only — NOT AI streams, NOT resumable uploads, which legitimately run for
   minutes — that shows *"Connection lost — reload to continue"* with a Reload
   button when a bounded call exceeds its budget while `navigator.onLine` is
   true. It must never fire during a healthy long operation; pin that with a
   test that runs a fake slow upload under it.

### Traps

- 🚨 **Do not sweep the 26 `getSession()` sites with `withTimeout`** — S21
  proved a sweep goes green and leaves the app just as stuck. The banner is
  the honest surface; the fix is deferred by her choice.
- The `custom_access_token_hook` was reachable by `anon` once (#44); any new
  function touching `auth` tables gets the same post-condition.
- `adminGuard.ts` is bundled by nine Edge Functions; a change there forces
  nine redeploys. Prefer a new function to editing the guard.
- The two surfaces have different storage keys by design; the idle logic must
  not share state across them (a busy `/wilsonadmin` tab must not keep a
  `/wilson` tab alive, and vice versa).

### Definition of done

Measured answer about `auth.audit_log_entries` in the commit; reader (and
writer only if needed) on dev + staging by query with suite 74 and breakers;
Sign-ins view on both consoles; idle warning + sign-out + cap on both surfaces
and both hosts with tests; banner with its reproduction recorded and a
no-false-positive test; `OUTSTANDING.md`: the hung-`getSession()` entry
narrowed to "reconnect deferred, banner shipped"; `CHANGELOG.md` "Known
limitations" auth-logging bullet rewritten; TPN findings LOG-006/007 and
AUTH session items annotated; walkthrough `11_sessions_and_logs.md`.

### Test plan (Audrey)

Sign in and out on the beta twice, fail two-factor once; Admin Terminal →
Logs → Sign-ins shows all of it with times. Leave a tab idle: warning at 25
minutes, signed out at 30. Kill your Wi-Fi mid-use: the banner appears within
the stated seconds; reconnect, press Reload, carry on. Start a large upload
and confirm the banner does NOT appear while it runs.

---

## Bundle B3 — the desktop server lock and the single-instance lock (1 session)

### What is wrong

`startLocalServer` in `electron/main.cjs` does `expressApp.listen(0,
'127.0.0.1')` with `expressApp.use(cors())`: no token, no origin allowlist, no
session check, `Access-Control-Allow-Origin: *` on ~94 routes, and since S40
`managed-files/:id/stream` returns the original full-resolution media bytes
with Range support. `GET /api/rabbit/projects` lists project ids and
`.../managed-files` lists file ids, so any process on the machine that can
reach the port can enumerate and stream pre-release footage while WILSON is
open (`OUTSTANDING.md`, MEASURED S40; TPN-NET). Separately, two copies of the
desktop app can run against one `userData` directory (§6 accepted list).

### Audrey's decisions

21: *a per-launch token that every desktop request must carry.* 30: *only one
copy at a time.*

### What to build

1. **Mint a token per launch** in `startLocalServer` (32 random bytes), and
   check it in ONE middleware ahead of every route; refuse with 401 and no
   body detail. Two ways in, because two kinds of caller exist:
   - **Header** for everything the renderer fetches: `localServerAdapter.js`,
     the O.T.T.E.R. local routes behind `otterFetch`, `InvoiceAttachment.jsx`,
     `videoThumbnails.js`, anything else `grep -rn "127.0.0.1\|localhost"`
     finds under `src/`. Hand the token to the renderer through
     `electron/preload.cjs`'s `electronAPI` bridge (never through a global
     the web build could see).
   - **Cookie** for what a browser element loads by URL and cannot header:
     `FileThumbnail`'s `<img src>` and the `<video src>` of the stream route.
     Set an `httpOnly` cookie for the loopback origin from main
     (`session.defaultSession.cookies.set`) at launch; the middleware accepts
     cookie OR header. With credentials in play `cors()` can no longer answer
     `*` — allow exactly the renderer's own origin in packaged AND dev modes
     (measure both; they differ), and nothing else.
2. **Prove it with a harness that has a FAILING CONTROL:** start the server,
   request a route with no token → 401; with the header → 200; with the
   cookie → 200; with a wrong token → 401; and a control that shows the
   assertion can fail (flip the expected status once and watch it go red).
   `vitest.config` includes only `src/**`; the harness lives in `scripts/` or
   beside `electron/pathContainment.cjs`'s tests.
3. **Single instance:** `app.requestSingleInstanceLock()` at boot; on
   `second-instance`, focus the existing window (restore if minimised) and pass
   any deep link through. Nostalgia TV learned the "never run two copies"
   lesson the hard way; this closes it here.

### Traps

- 🚨 **CORS is NOT browser-only** (auto-memory). The token is the control; the
  origin allowlist is defence in depth, not the gate.
- 🚨 **Every renderer fetch to the loopback must carry the token or it breaks
  silently** — `fetch` resolves for every status, and an unchecked 401 reads as
  an empty list. Grep for the writers of the server URL, not for the string
  `19854` (the port is ephemeral; `listen(0)`).
- The web build must not reference the bridge; `window.electronAPI` is
  undefined there and is not a backend selector (`ctx.supportsManagedFiles`
  is).
- The stream route already refuses soft-deleted rows and serves a safe
  content type; keep both.

### Definition of done

Every loopback request carries the token (grep-proven list in the commit);
401 without it (harness with control); `cors()` allowlist measured for both
modes; single-instance lock; the desktop app runs end to end on Local Server
mode (thumbnails, previews, video, invoices, O.T.T.E.R. local routes) — checked
by running it, not by tests alone; `OUTSTANDING.md`: delete the loopback entry
and the §6 single-instance limit; handbook §17 "Video (S40)" rewritten;
TPN-NET annotated; walkthrough `12_desktop_local_mode.md`.

### Test plan (Audrey)

Desktop, Local Server mode: open a project's files, see thumbnails, play a
video, attach an invoice, open O.T.T.E.R. locally. Launch the app a second
time from the Start Menu — the running window comes to the front instead of a
second copy. (I will attach the harness output showing 401 without the token.)

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command; write scripts to
files. Query the database rather than trusting migration text or commit
messages. One query per `--file`. Count `<!--` / `-->` after editing long
markdown. `fetch` resolves for EVERY status. Never let a secret's VALUE reach
a transcript — `supabase projects api-keys` returns ONE JSON line; select the
field, never filter the output. Cite symbols, not line numbers. A brief is a
hypothesis: verify its root cause before building its fix.

⚠️ **Deploy order for anything with a migration: dev → staging BEFORE the git
push.** Never `db push` while 0065 is unapplied. Prod waits for the release
session.

🚨 **Two review rounds before every merge; R2 reviews R1's corrections.**
Auth surfaces are where the last four reviews found their highs.

## Close-out ritual (per bundle, then once for the track)

1. `docs/OUTSTANDING.md`: delete what is fixed citing the commit, narrow what
   remains, session-log row.
2. Migration verified by query on dev AND staging; CLI re-linked to wilson-dev;
   `tap-all` clean; full vitest; new suites in both `rls.yml` lists.
3. Merge `feat/multi-user-v1` into the track branch first, resolve, re-test;
   then merge the bundle in with a merge commit and push; CI green on the
   pushed head **including the updated Playwright and smoke specs**.
4. `SYSTEMS_HANDBOOK.md` §17 and the auth sections rewritten to what shipped;
   `TPN_AUDIT/FINDINGS.md` annotated per finding touched; `CHANGELOG.md`
   "Known limitations" bullets corrected.
5. Update the auto-memory (`wilson_migration_rules`, `wilson_session_history`).
6. **Close out in the chat**: remaining bundles, plain-English breakdown,
   fixed / diagnosed / hers to do.
