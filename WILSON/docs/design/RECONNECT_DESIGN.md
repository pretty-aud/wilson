# Reconnecting after a hung sign-in check — the design (S1, 2026-10-27)

Night 2 of `docs/sessions/PLAN_TO_1_0.md` (§2, her answer of 2026-10-27:
*"Reconnect after a hung sign-in (Recommended)"*; the brief is
`docs/sessions/briefs/po-s1-reconnect.md`). What it is for, in her words from
the plan: *one stuck session check pins every cloud call; a banner says so and
nothing recovers.* Today the banner reads "Connection lost — reload to
continue", and a reload is the only way out (Track B, B2 part 2, 2026-09-06;
`docs/OUTSTANDING.md`, *One hung `getSession()` pins the whole app's auth*).

Measured on 2026-10-27 against `origin/feat/post-overhaul-edit-versioning`
(`64fac2fa`): `@supabase/auth-js` and `@supabase/supabase-js` 2.101.1 as
installed; `scripts/probes/connection-hang.mjs` against wilson-dev with two new
phases (D, E); the app on port 5303 in Chromium 147 and in the desktop app
(Electron 33.4.11, Chromium 130). Nothing was signed in; no real token exists
in any of it.

---

## 1. What was measured

| # | Question | Measured |
|---|---|---|
| 1 | Which lock does auth-js take in the browser, in Electron, in the probe? | **None.** The constructor picks `navigatorLock` only when `persistSession` is true in a browser with `navigator.locks`; the app sets `persistSession: false` (it keeps the session itself), so `supabase.auth.lock` is `lockNoOp` — read in the page on 5303 (`lock lockNoOp`, `navigator.locks` present, `persistSession false`), the same branch in Electron (`navigator.locks` present there too, the option the same), and in the probe (`lockNoOp`; Node 24 has `navigator.locks` but no `window`). The OUTSTANDING entry's "the lock is global per `storageKey`" is wrong for this app. |
| 2 | Then what pins the app? | **The client's own queue.** `_acquireLock` sets `lockAcquired` while the first caller's work runs and pushes every later caller onto `pendingInLock` behind the previous one; the holder returns only after it has drained that queue. The `lockAcquireTimeout` option is passed to the lock function alone and is never consulted on the queued branch. One refresh that never answers holds `lockAcquired` for ever, every `getSession()` queues behind it, and supabase-js awaits `getSession()` before every PostgREST, Storage and Functions request (`_getAccessToken`). Measured in phases B and D: the read behind the refresh never reaches the network (0 `/rest/v1/` requests), `pendingInLock` 4 and growing (the auto-refresh ticker queues one more every 30 s). |
| 3 | A second client with the same `storageKey` while the first is pinned? | **Independent.** Its own `lockAcquired`, its own queue, its own in-memory session; no lock is shared. It issued its read 643 ms after it was made while client 1 stayed pinned (phase D). |
| 4 | What settles the hang today? | A reload (the page state is thrown away). `withTimeout` does not: it races and leaves the request pending, so the queue stays held (OUTSTANDING, measured S21; re-read in `withTimeout.js`). |
| 5 | What does aborting the hung request from the fetch wrapper do? | **The SDK treats the rejected fetch as `AuthRetryableFetchError` (status 0), keeps the session, and retries with backoff** (200, 400, 800… ms) while the loop's elapsed time plus the next backoff stays under 30 s. With a 2 s budget per attempt: 7 attempts at 1, 2225, 4639, 7457, 11075, 16297 and 24705 ms, the loop over at 26.7 s. With the app's 20 s budget that is two attempts, at 0 and 20.2 s, the loop over at 40.2 s. |
| 6 | …and to the waiters? | **They do not fail fast.** The session stays in memory and still reads as expired, so each queued caller, when its turn comes, starts the loop again; the first caller is held until the whole queue has drained. Phase E, the app's situation (a saved session, three callers): 13 attempts over 43 s, nothing settled at 45 s, `lockAcquired true`, `pendingInLock 4`. In phase E's other run (no saved session) the loop ran once and every waiter settled at 27 s with `session null`, the read going out with the anon key and answered 401. |
| 7 | …and when the network comes back? | **It recovers by itself, at once.** The running attempt answered, `TOKEN_REFRESHED` fired 64 ms later, the queue drained, `getSession()` returned the session and the read went out with the new token 466 ms after the network answered. Nothing had to be re-created, re-bound or reloaded. |
| 8 | The banner | Raised at the budget: 5.19–5.26 s with the probe's 5 s budget and 250 ms tick; 20–21 s in the app (20 s budget, 1 s tick). |

The OUTSTANDING entry's second claim, "nothing outside the SDK can cancel its shared refresh promise", is therefore also wrong: the SDK passes no signal, but the fetch it is given can carry one, and a rejected refresh is a case the SDK handles (retry, session kept).

## 2. The detection — unchanged

`src/cloud/connectionWatchdog.js` as it stands: the one fetch supabase-js uses, the 20 s budget, the scope (every `/auth/v1/`, every `/rest/v1/`, `GET`/`HEAD` of `/storage/v1/object`), `navigator.onLine` true, the ticker only while something is pending. Nothing measured says the threshold or the scope is wrong: a healthy round trip is hundreds of milliseconds, the auth screens' own ceilings are 15 s, and 20 s is still inside the time a person stays looking at a screen.

## 3. The recovery — (a), the abort, chosen by the measurement

**At the budget the watchdog aborts the request instead of only counting it.** Every watched request gets its own `AbortController` (joined to the caller's `signal` when one is passed, as supabase-js's `.abortSignal()` does); when a request has been pending for the budget while the browser says it is online, the watchdog aborts it. Then, measured:

- the SDK's refresh rejects, the SDK retries by itself (one more attempt at 20.2 s), keeps the session, and keeps knocking: every queued caller's turn is a new attempt, and the auto-refresh ticker adds one every 30 s while the window is visible;
- the moment the network answers, the next attempt lands, `TOKEN_REFRESHED` fires, every waiter completes, and the app continues with the same client, the same channels, the same `sharedAuthedClient` — no reload;
- a PostgREST or storage request that hangs on its own (the token fine) is aborted the same way: its caller's error path runs at 20 s instead of never.

**Why not (b), a fresh client built on detection.** It works mechanically (fact 3) and buys nothing (a) does not: the fresh client's own first refresh hangs on the same dead network, and the old client's waiters stay held unless something aborts them, which is (a). Its cost is real: 32 files import the module-level `supabase` (R.A.B.B.I.T.'s `sharedAuthedClient` is the same instance, `RabbitProvider` subscribes to its auth events, two realtime channel sites, `usePermissions`, the pet's user state), every one of which would have to re-bind.

**Why not (c), an SDK option.** `lockAcquireTimeout` governs the lock function, which is a no-op here, and is never consulted on the queued branch (fact 2); a custom `lock` with a timeout would run a second refresh beside the hung one, sharing the same `refreshingDeferred`, which is the same pin.

**What the SDK gives us that this design does not re-do:** the retry. No module calls `refreshSession()` or re-issues the refresh; the measured loop and the ticker do it. The one call the app makes is in §4.

### What `lost` means, and when it clears

Today a watched request that settles late clears the banner. With aborts, nothing settles late: an aborted request is a settle, and it must not clear the condition, or the banner would blink at the budget and vanish with the app still stuck. So:

- `lost` turns on at the first abort and **clears only when a watched request resolves** (any HTTP status: an answer is a connection; a rejection — the abort, or a network error — is not);
- while lost, the watchdog sends a **ping** every 10 s: `HEAD <origin>/rest/v1/` with the `apikey` header of the request that hung (both read from that request; no new seam in the client module), a 5 s budget of its own, aborted like any other. An answered ping clears `lost`. The ping is to PostgREST, the service the reads go to: CI's Playwright scenario 11 holds every `/rest/v1/` request open and expects the banner to stay, which it does, because the ping hangs too;
- on the clear, the client module (`supabaseClient.js`) calls `supabase.auth.getSession()` once: if the token is stale this starts the refresh now rather than at the ticker's next tick, so a person who was waiting sees the screen finish within a second of the network returning. That is the app's one retry; a second is the SDK's own.

### Thresholds (mine to pick, picked)

| Number | Value | Why |
|---|---|---|
| Budget | 20 s | unchanged (§2) |
| Ping cadence, budget | 10 s, 5 s | a healthy `HEAD` is under a second; 10 s keeps the words true without a request storm; the SDK's own loop knocks at 20 s and 30 s on top |
| The words change | 60 s lost | three pings and two SDK attempts without an answer; after that the strip says reload, and the pings continue so a late answer still clears it |

## 4. What the person sees

| When | The strip (`ConnectionLostBanner`, `role="alert"`, above every modal) | The dot (R.A.B.B.I.T., bottom-left) |
|---|---|---|
| 20 s into a silent hang | **"Connection lost — reconnecting…"**, with **Reload** (kept: the escape hatch for a person who would rather not wait) | an amber diamond, *Database: reconnecting… · Files: … · Live updates: …*, summary *Reconnecting to the database* |
| the network answers | the strip goes; what was waiting completes | the dot asks again at once and goes green |
| 60 s lost, nothing answered | **"Connection lost — reload to continue."**, with **Reload** (today's words, kept for the state they were written for) | still reconnecting |

Both sentences contain *Connection lost*; the button is *Reload* in both: `tests/e2e/sessions.spec.ts` scenario 11 and `sessionDialogs.test.js` keep passing as written. Nothing changes on the sign-in screen, the wizards or the enrolment gate.

## 5. What is never retried, and what an abort costs

- **Outside the watchdog by construction, and staying so:** uploads (`POST`/`PUT /storage/v1/object`), the resumable path, every Edge Function call (raw fetch, a 150 s wall clock), realtime (a websocket). Never watched, never aborted, never pinged.
- **A write aborted at 20 s may have landed.** The caller's error path runs (a "could not save" toast, a list that reloads) while the row may exist. Today the same write hangs for ever and the person reloads, with the same uncertainty and a dead screen in between. Not worse; sooner.
- **A refresh aborted after GoTrue rotated the token.** The retry presents the old refresh token: accepted inside GoTrue's reuse interval, refused after it, and a refusal removes the session (the sign-in screen). A reload has exactly the same exposure, since the stored session holds the same old token. Not worse.
- **The auth screens' own ceilings (15 s, `withTimeout`) are under the budget**, so a sign-in or MFA verify is already abandoned by its screen before the watchdog aborts it; their reasoning about a request that "may have taken effect server-side" is unchanged.
- **A queued caller still waits** while the network is dead (fact 6). The design does not fail them: the alternative is a non-retryable error, which makes the SDK drop the session and sign the person out — worse than a reload. The strip says what is true meanwhile.

## 6. The test plan

1. **`connectionWatchdog.test.js`** (the hand-stepped clock and controllable fetch already there): a watched request pending past the budget is aborted (its signal fires; the caller's promise rejects with the base fetch's rejection); `lost` turns on at the abort and stays on after it (today's "settles late" case now reads "an answer clears, an abort does not"); the ping: `HEAD <origin>/rest/v1/` with the `apikey` seen on the hung request, every 10 s, a 5 s budget, stopped on the clear; the caller's own signal is honoured; the words state at 60 s; the no-false-positive upload test and every exclusion as before; `reset()` lowers everything.
2. **The hang and the recovery, through auth-js as installed** (a Vitest with fake timers, `GoTrueClient` on a fetch that answers `GET /user`, never answers `POST /token` but honours the signal): a `getSession()` on a saved, nearly expired session hangs; through the watchdog's wrapper it settles after the budget and the SDK's retry; when the fake network answers, `getSession()` returns the refreshed session and `TOKEN_REFRESHED` fires. **CONTROL:** the same client through a wrapper that only counts (today's) is still pending after minutes of fake time.
3. **The probe** (`scripts/probes/connection-hang.mjs`, phase F, against wilson-dev): the hang through the real watchdog with its real budget, the abort at 20 s, the SDK's retry at 20.2 s, the network answering, `TOKEN_REFRESHED`, the read with the new token, `lost` cleared by the ping — with times in the hand-off.
4. **The dot** (`connectionStatus.test.js`, `ConnectionDot.test.jsx`): the `reconnecting` state's tone, words and summary; the dot asks again on the clear.
5. **CI's Playwright scenario 11** as written (the words and the button are unchanged in the first state).

## 7. Her questions

**None.** The words are mine to write and the retry numbers mine to pick (the brief); nothing here touches the sign-in flow; the one behaviour that reaches a person — a request that hung for 20 s now fails instead of hanging — is the thing she asked for, and §5 states its cost beside today's. The reviewers may still send the build back; that is what round 1 is for.

## 8. The build, if round 1 says go

`src/cloud/connectionWatchdog.js` (the abort, `lost`'s new rule, the ping, the phase), `src/cloud/ConnectionLostBanner.jsx` (two sentences), `src/cloud/auth/supabaseClient.js` (the one `getSession()` on the clear; its header's "Reload is the remedy" corrected), `src/tools/rabbit_v0.1.0/state/connectionStatus.js` and `components/ConnectionDot.jsx` (the reconnecting state), their tests, the probe's phase F, `docs/OUTSTANDING.md` (the entry deleted, its two wrong claims recorded here), the handbook's §17 line, walkthrough 83. No migration, no Edge Function, no database change, nothing in the sign-in flow.
