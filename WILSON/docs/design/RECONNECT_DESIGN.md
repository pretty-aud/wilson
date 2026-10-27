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
in any of it. Review round 1 (Fable, the design alone) found what §9 lists;
this is the corrected design the build follows.

---

## 1. What was measured

| # | Question | Measured |
|---|---|---|
| 1 | Which lock does auth-js take in the browser, in Electron, in the probe? | **None.** The constructor picks `navigatorLock` only when `persistSession` is true in a browser with `navigator.locks`; the app sets `persistSession: false` (it keeps the session itself), so `supabase.auth.lock` is `lockNoOp` — read in the page on 5303 (`lock lockNoOp`, `navigator.locks` present, `persistSession false`), the same branch in Electron (`navigator.locks` present there too, the option the same), and in the probe (`lockNoOp`; Node 24 has `navigator.locks` but no `window`). The OUTSTANDING entry's "the lock is global per `storageKey`" is wrong for this app. |
| 2 | Then what pins the app? | **The client's own queue.** `_acquireLock` sets `lockAcquired` while the first caller's work runs and pushes every later caller onto `pendingInLock` behind the previous one; the holder returns **its own result** only after it has drained that queue (`return await result` after the drain loop). The `lockAcquireTimeout` option is passed to the lock function alone and is never consulted on the queued branch. One refresh that never answers holds `lockAcquired` for ever, every `getSession()` queues behind it, and supabase-js awaits `getSession()` before every PostgREST, Storage and Functions request (`_getAccessToken`). Measured in phases B and D: the read behind the refresh never reaches the network (0 `/rest/v1/` requests), `pendingInLock` 4 and growing (the auto-refresh ticker queues one more every 30 s). |
| 3 | A second client with the same `storageKey` while the first is pinned? | **Independent.** Its own `lockAcquired`, its own queue, its own in-memory session; no lock is shared. It issued its read 643 ms after it was made while client 1 stayed pinned (phase D). |
| 4 | What settles the hang today? | A reload (the page state is thrown away). `withTimeout` does not: it races and leaves the request pending, so the queue stays held (OUTSTANDING, measured S21; re-read in `withTimeout.js`). The start-up check is already bounded by it: `checkSessionValid` races `hydrateSupabase` against 15 s, a timeout reads as "no session", the sign-in screen appears at 15 s and the stored tokens are kept (Audrey's all-orange window of 2026-09-10; the demo sprint's ceiling). |
| 5 | What does aborting the hung request from the fetch wrapper do? | **The SDK treats the rejected fetch as `AuthRetryableFetchError` (status 0), keeps the session, and retries with backoff** (200, 400, 800… ms) while the loop's elapsed time plus the next backoff stays under 30 s. With a 2 s budget per attempt: 7 attempts at 1, 2225, 4639, 7457, 11075, 16297 and 24705 ms, the loop over at 26.7 s. With the app's 20 s budget that is two attempts, at 0 and 20.2 s, the loop over at 40.2 s (any budget of 15 s or more gives two). |
| 6 | …and to the waiters? | **They do not fail fast.** The session stays in memory and still reads as expired, so each queued caller, when its turn comes, starts the loop again; the holder is held until the whole queue has drained, and then returns the result **its own** loop produced. Phase E, the app's situation (a saved session, three callers): 13 attempts over 43 s, nothing settled at 45 s, `lockAcquired true`, `pendingInLock 4`. In phase E's other run (no saved session) the loop ran once and every waiter settled at 27 s with `session null`, the read going out with the anon key and answered 401. |
| 7 | …and when the network comes back? | **It recovers by itself, at once — for the callers still queued.** The running attempt answered, `TOKEN_REFRESHED` fired 64 ms later, the queue drained, a queued caller's `getSession()` returned the session and its read went out with the new token 466 ms after the network answered. Nothing had to be re-created, re-bound or reloaded. **The holder** (the caller whose `getSession()` started the hung refresh) is held until the whole queue has drained — through the real watchdog with its 20 s budget, phase F: 70 s into a dead network it had not settled, the queue at 5, the SDK's attempts at 0, 21.4, 42.6 and 64 s (one per budget: the holder's two, then the queued caller's) — and when the queue does drain it returns its own loop's result, no session, so its read goes out with the anon key: refused by the client module's guard (§3), its screen's error path, the person's retry. **The build, end to end** (phase F, the network back 45 s into the hang): the strip up at 21.3 s; the ping at 52.3 s answered and cleared the strip 7.3 s after the network returned, the dead attempt was aborted, the retry at 52.5 s landed, `TOKEN_REFRESHED`, the queued read with the new token 0.3 s later, the holder's read refused, the queue empty. |
| 8 | The banner | Raised at the budget: 5.19–5.26 s with the probe's 5 s budget and 250 ms tick; 20–21 s in the app (20 s budget, 1 s tick). |

The OUTSTANDING entry's second claim, "nothing outside the SDK can cancel its shared refresh promise", is therefore also wrong: the SDK passes no signal, but the fetch it is given can carry one, and a rejected refresh is a case the SDK handles (retry, session kept).

## 2. The detection — unchanged, with one scale

`src/cloud/connectionWatchdog.js` as it stands: the one fetch supabase-js uses, the 20 s budget, the scope (every `/auth/v1/`, every `/rest/v1/`, `GET`/`HEAD` of `/storage/v1/object`), `navigator.onLine` true, the ticker only while something is pending. A healthy round trip is hundreds of milliseconds, the auth screens' own ceilings are 15 s, and 20 s is still inside the time a person stays looking at a screen. **One addition (round 1, F5):** a request with a body gets one second more per 50 KB of it (a 1 MB course save: 40 s), so a slow uplink is not read as a dead one — nothing changes for the body-less reads and the small writes that are nearly all of the traffic.

## 3. The recovery — (a), the abort, chosen by the measurement

**At the budget the watchdog aborts the request instead of only counting it.** Every watched request gets its own `AbortController` (joined to the caller's `signal` when one is passed, as supabase-js's `.abortSignal()` does; a caller's own abort is a settle, never a loss); when a request has been pending for its budget while the browser says it is online, the watchdog aborts it. Then, measured:

- the SDK's refresh rejects, the SDK retries by itself (one more attempt at 20.2 s), keeps the session, and keeps knocking: every queued caller's turn is a new attempt — on the wire, one attempt per budget;
- when the network answers, the next attempt lands, `TOKEN_REFRESHED` fires, every caller still queued completes, and the app continues with the same client, the same channels, the same `sharedAuthedClient` — no reload;
- a PostgREST or storage request that hangs on its own (the token fine) is aborted the same way: its caller's error path runs at 20 s instead of never.

**Why not (b), a fresh client built on detection.** It works mechanically (fact 3) and buys nothing (a) does not: the fresh client's own first refresh hangs on the same dead network, and the old client's waiters stay held unless something aborts them, which is (a). Its cost is real: 32 files import the module-level `supabase` (R.A.B.B.I.T.'s `sharedAuthedClient` is the same instance, `RabbitProvider` subscribes to its auth events, two realtime channel sites, `usePermissions`, the pet's user state), every one of which would have to re-bind.

**Why not (c), an SDK option.** `lockAcquireTimeout` governs the lock function, which is a no-op here, and is never consulted on the queued branch (fact 2); a custom `lock` with a timeout would run a second refresh beside the hung one, sharing the same `refreshingDeferred`, which is the same pin.

**What the SDK gives us that this design does not re-do:** the retry. No module re-issues the refresh; the measured loop does it. The one call the app makes is the nudge below.

### What `lost` means, and when it clears

Today a watched request that settles late clears the banner. With aborts, nothing settles late: an aborted request is a settle, and it must not clear the condition, or the strip would blink at the budget and vanish with the app still stuck. And a clear must come from the service that hung: GoTrue stuck while PostgREST answers is an ordinary partial outage, and a PostgREST answer says nothing about it (round 1, F1). So:

- `lost` is kept **per family** — `auth` (`/auth/v1/`), `rest` (`/rest/v1/`), `storage` — turns on for a family at its first abort, and **clears for that family only when a request of that family resolves with a status under 500** (an answer is a connection; a 5xx from the gateway, a rejection, an abort are not). The strip shows while any family is lost; its clock runs from the first raise and is not restarted by later aborts;
- while a family is lost the watchdog **pings** it every 10 s with a 5 s budget: `GET <origin>/auth/v1/health` for auth, `HEAD <origin>/rest/v1/` for rest, `HEAD` of the hung object's own address for storage — each with the `apikey` header of the request that hung (both read from that request; no new seam in the client module). An answered ping clears its family; an aborted ping changes nothing. CI's Playwright scenario 11 holds every `/rest/v1/` request open and expects the strip to stay, which it does, because the rest ping hangs too;
- **an answered ping also aborts, at once, every request of that family that was already pending when the ping was sent** (round 1, F3): after a sleep-wake or a VPN reset the old connection is dead and would otherwise sit until its own budget; aborting it makes the SDK's next attempt — which lands — the next thing on the wire. So the time from the network returning to the refresh landing is the ping cadence plus a round trip, about 11 s at most;
- on the **auth** family's clear, the client module (`supabaseClient.js`) calls `supabase.auth.getSession()` once. If the SDK is free and the token stale, this starts the refresh now; if the lock is still held, it queues behind the attempt already in flight, which is harmless. That is the app's one retry.

### The holder's read, and the guard (round 1, F2a)

By fact 2 the first caller — the one whose `getSession()` started the hung refresh — returns the result of its own loop even when a later attempt succeeded: `{ session: null, error }`. supabase-js then drops the error and sends that caller's request with the **anon key** (fact 6: measured, 401 on `workspaces`; on a table anon may read, an empty 200 that looks like data). So the client module's fetch refuses, before the watchdog ever sees it, **a `/rest/v1/` or `/storage/v1/` request that carries the anon bearer while a person is signed in** (signed in: the last auth event carried a session; signed out: `SIGNED_OUT`). The refusal is a rejected fetch with one sentence ("Signed in, but the session check failed; the request was not sent"), which postgrest-js turns into the caller's error result (status 0) — the caller's own error path, never an empty success. Nothing legitimate is lost: every PostgREST and storage call the app makes while signed in carries the session's token; the anon calls (`resolve-login`, the Edge Functions) are raw fetches outside the client.

### Thresholds (mine to pick, picked)

| Number | Value | Why |
|---|---|---|
| Budget | 20 s, plus 1 s per 50 KB of body | unchanged for everything but a large write (§2) |
| Ping cadence, budget | 10 s, 5 s | a healthy `HEAD` or `GET /health` is under a second; six tiny requests a minute per lost family while lost, nothing otherwise; the SDK's own attempts are one per budget on top |
| The words change | 60 s lost — 80 s into the hang | three pings and two SDK attempts without an answer; after that the strip says reload, and the pings continue so a late answer still clears it |

## 4. What the person sees

| When | The strip (`ConnectionLostBanner`, `role="alert"`, above every modal) | The dot (R.A.B.B.I.T., bottom-left) |
|---|---|---|
| 20 s into a silent hang | **"Connection lost — reconnecting…"**, with **Reload** (kept: the escape hatch for a person who would rather not wait) | an amber diamond, *Database: reconnecting… · Files: … · Live updates: …*, summary *Reconnecting to the database* |
| the service answers (a ping or the SDK's own attempt) | the strip goes. The screens that were **waiting on the session check** complete by themselves within the ping cadence (§3) — all but the one whose call started the hung refresh, which is answered last with no session and shows its error then (fact 7; the guard). The screens whose own read or write was **aborted at 20 s** showed their error at 20 s and do not re-run. Both kinds: the person retries them (round 1, F4) | the dot asks again at once and goes green |
| 80 s into the hang, nothing answered | **"Connection lost — reload to continue."**, with **Reload** (today's words, kept for the state they were written for) | still reconnecting |

Both sentences contain *Connection lost*; the button is *Reload* in both: `tests/e2e/sessions.spec.ts` scenario 11 and `sessionDialogs.test.js` keep passing as written (run before claiming it, §6). On the **sign-in screen** the strip appears too, as today, for a sign-in or MFA request that hangs: the screen's own 15 s ceiling has already shown its message, and "reconnecting…" is still the true word for what the watchdog is doing to the service, session or no session (round 1, F12). Nothing changes in the sign-in flow, the wizards or the enrolment gate.

**At start-up** (round 1, F2b): a hung session check already ends in the sign-in screen at 15 s with the stored tokens kept (fact 4) — the case her pending *offline launch* ruling is about, untouched here. What changes under it: the SDK's attempts end at 40.2 s instead of never, so a sign-in typed on that screen is no longer queued for ever behind the hung check (today it hangs too, and its 15 s ceiling reads "try again" until a reload); a late success keeps being harmless, as the restore path's comment says.

## 5. What is never retried, and what an abort costs

- **Outside the watchdog by construction, and staying so:** uploads (`POST`/`PUT /storage/v1/object`), the resumable path, every Edge Function call (raw fetch, a 150 s wall clock), realtime (a websocket). Never watched, never aborted, never pinged.
- **A write aborted at 20 s may have landed** — an insert, an update, an auth write (`PUT /auth/v1/user`, an MFA enrolment). The caller's error path runs ("could not save") while the row may exist. No caller retries a write on an error by itself (grep: no retry loop around any `.insert`, `.update`, `.upsert` or `.rpc`); the person's own retry of a **create** can duplicate it, because R.A.B.B.I.T.'s ids are the server's (an update or a delete repeated is the same row). Today the same write hangs for ever, the person reloads, and the same duplicate is one click away. Not worse; sooner, and the list reloads with the row in it.
- **A refresh aborted after GoTrue rotated the token** (the request arrived, the answer was lost). Every attempt is another presentation of the old refresh token: accepted inside GoTrue's reuse interval (10 s by default), refused after it, and a refusal removes the session — the sign-in screen, unprompted, with whatever was unsaved. Today the same loss follows the person's own reload, a few seconds later, since the stored session holds the same old token. The same loss, sooner (round 1, F7). Not measurable without a real session, which this session never has (§6).
- **Two clients, one refresh token** (round 1, F8): two web tabs of `/wilson` hydrate the same stored session, and each rotates it on its own — a hazard of `persistSession: false` that predates this design and is not changed by it; the desktop has one renderer; the operator console has its own token under its own key.
- **The auth screens' own ceilings (15 s, `withTimeout`) are under the budget**, so a sign-in or MFA verify is already abandoned by its screen before the watchdog aborts it; their reasoning about a request that "may have taken effect server-side" is unchanged.
- **A queued caller still waits** while the network is dead (fact 6). The design does not fail them: the alternative is a non-retryable error, which makes the SDK drop the session and sign the person out — worse than a reload. The strip says what is true meanwhile.

## 6. The test plan

1. **`connectionWatchdog.test.js`** (the hand-stepped clock and controllable fetch already there): a watched request pending past the budget is aborted (its signal fires; the caller's promise rejects with the base fetch's rejection); a body adds to the budget; `lost` turns on at the abort, per family, and stays on after it; it clears on an answer under 500 from the same family only (a rest answer does not clear an auth loss; a 503 clears nothing); the pings: their three shapes, the `apikey` of the hung request, every 10 s, a 5 s budget, stopped on the clear; an answered ping aborts the family's older pending requests; a caller's own signal is honoured and raises nothing; an aborted ping does not restart the clock; the words state at 60 s lost; the no-false-positive upload test and every exclusion as before; `reset()` lowers everything.
2. **The hang and the recovery, through auth-js as installed** (a Vitest with fake timers, `GoTrueClient` on a fetch that answers `GET /user`, never answers `POST /token` but honours the signal): a `getSession()` on a saved, nearly expired session hangs; through the watchdog's wrapper it settles after the budget and the SDK's retry; when the fake network answers during an attempt, `getSession()` returns the refreshed session and `TOKEN_REFRESHED` fires; a `setSession` that hangs (the start-up check) ends at the loop's end with no session saved, and a later `setSession` succeeds; an auth-only hang stays lost while rest answers. **CONTROL:** the same client through a wrapper that only counts (today's) is still pending after minutes of fake time.
3. **The client module's guard** (`supabaseClient.js`): a `/rest/v1/` request with the anon bearer is refused while signed in and passed while signed out; `/auth/v1/` and the raw fetches are untouched.
4. **The probe** (`scripts/probes/connection-hang.mjs`, phase F, against wilson-dev): the hang through the real watchdog with its real budget, the abort at 20 s, the SDK's retry at 20.2 s, the loop ending at 40.2 s with the holder's read refused by the guard (not sent as anon), the network answering during a queued caller's attempt, `TOKEN_REFRESHED`, that caller's read with the new token, `lost` cleared by the ping — with times in the hand-off. Not in the probe: the rotation case (§5), which needs a real refresh token.
5. **The dot** (`connectionStatus.test.js`, `ConnectionDot.test.jsx`): the `reconnecting` state's tone, words and summary; the dot asks again on the clear.
6. **CI's Playwright scenario 11** as written, and `sessionDialogs.test.js`, run before the claim.

## 7. Her questions

**None.** The words are mine to write and the retry numbers mine to pick (the brief); nothing here touches the sign-in flow — the start-up case keeps its 15 s ceiling and her pending *offline launch* ruling decides what that screen does; the one behaviour that reaches a person — a request that hung for 20 s now fails instead of hanging — is the thing she asked for, and §5 states its cost beside today's. Round 1 agreed: no finding was a choice only she can make.

## 8. The build

`src/cloud/connectionWatchdog.js` (the abort, the families, `lost`'s new rule, the pings, the phase, the body scale), `src/cloud/ConnectionLostBanner.jsx` (two sentences), `src/cloud/auth/supabaseClient.js` (the anon guard, the one `getSession()` on the auth clear; its header's "Reload is the remedy" corrected), `src/tools/rabbit_v0.1.0/state/connectionStatus.js` and `components/ConnectionDot.jsx` (the reconnecting state), their tests, the probe's phase F, `docs/OUTSTANDING.md` (the entry rewritten to what the measurement leaves, deleted only if nothing does), the handbook's §17 line, walkthrough 83. No migration, no Edge Function, no database change, nothing in the sign-in flow.

## 9. Review round 1 (Fable, the design alone, 2026-10-27)

Verdict: the build can go without a ruling. Two High: **F1**, a PostgREST ping would clear an auth-only loss and make the strip blink (§3 now pings and clears per family, the clock not restarted); **F2**, the holder returns its own loop's result and its read goes out as anon (§3's guard), and the start-up check (§4: already bounded at 15 s, tokens kept, her ruling's case). Medium: **F3** the nudge is queued while the lock is held and recovery after a dead connection could wait a budget (§3: an answered ping aborts the family's older requests; "about 11 s", not "a second"); **F4** aborted reads do not re-run (§4); **F5** a slow large write (§2's body scale); **F6** duplicates (§5); **F7** rotation is per attempt (§5); **F8** two clients, one token (§5). Low: **F9** the ticker's tick is queued, not sent (§3); **F10** 60 s lost is 80 s into the hang (§3); **F11** a caller's own abort and an aborted ping (§3, §6); **F12** the strip on the sign-in screen (§4); **F13** the OUTSTANDING entry is rewritten, not deleted, unless nothing remains (§8). Notes F14–F17 are honoured in §6 and §5.
