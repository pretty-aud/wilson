# 83 — RECONNECTING AFTER A HUNG SESSION CHECK, AND THE TWO-FACTOR SCREEN MEASURED

1. **A connection that silently dies no longer pins the app until you
   reload.** When a request to the cloud hangs for 20 seconds while your
   computer still says it is online (a router that went away, a captive
   portal, a VPN that stopped forwarding), WILSON now cancels it and says
   **"Connection lost — reconnecting…"** in the strip at the top of the
   window. The sign-in library keeps your session and tries again by
   itself; WILSON asks the service that hung every 10 seconds; the moment it
   answers, the strip goes and whatever was waiting finishes — no reload.
   Before, the strip said *reload to continue* and a reload was the only way
   out.
2. **A minute without an answer, the strip says "Connection lost — reload to
   continue."** — the old sentence, for the case it was written for. Reload
   is on the strip in both states, for anyone who would rather not wait.
3. **R.A.B.B.I.T.'s corner dot says the same**: an amber diamond,
   *Database: reconnecting…*, while the strip is up; green again within a few
   seconds of the connection coming back.
4. **The two-factor enrolment screen fits.** Your screenshot of 7 September
   (the screen spilling onto the orange bars at about 824px tall) was taken
   before the sign-in shell's bars were re-derived on 11 September. Measured
   now, live, in the browser and in the desktop app: the screen is 507px
   tall in a 544px band at 824px, at the 700px minimum window, at 1280x800
   and at 1440x900 — 18px clear of each bar every time. Nothing was changed
   on the screen; the measurement is pinned so it cannot drift unnoticed.

**What this is.** S1 of night 2 (`docs/sessions/briefs/po-s1-reconnect.md`):
your answer of 2026-10-27, *"Reconnect after a hung sign-in (Recommended)"*,
designed first (`docs/design/RECONNECT_DESIGN.md`, reviewed before a line was
written), then built; and one entry of the closed defects list, measured.
Written 2026-10-27 against `feat/post-overhaul-edit-versioning`
(`po/s1-reconnect`). Client and desktop app only; no database change, no
server function, nothing in the sign-in flow itself.

## 1. What you will see

A silent hang is hard to make on purpose: your computer has to stay
"online" while packets go nowhere. If you have a Wi-Fi that does that (a
captive portal before you accept it, a VPN whose tunnel has dropped), this is
the sequence; otherwise section 3 is the measured one.

| # | Do | You should see |
|---|----|----------------|
| 1 | Signed in, on any R.A.B.B.I.T. tab, let the connection go dead while the computer still shows Wi-Fi connected; then do something that reads the cloud (open a project, switch a tab) | Nothing for 20 seconds, as before. At 20 s: the strip **"Connection lost — reconnecting…"** with **Reload** at the top of the window; the corner dot an amber diamond, pointing at it says *Database: reconnecting… · Files: …, reconnecting…*. What you clicked shows its own "could not load" where it has one. |
| 2 | Bring the connection back | Within about ten seconds the strip goes, the dot is green, and what was waiting on the session finishes by itself. The thing you clicked in step 1 that showed an error needs its own retry (a click), and works. |
| 3 | Instead of step 2, leave it dead for a minute | At 80 s into the hang the strip reads **"Connection lost — reload to continue."**, still with **Reload**. WILSON keeps asking every 10 seconds; if the connection returns later the strip still goes by itself. Reload works as it always did. |
| 4 | The two-factor screen: sign in as an admin without an authenticator set up (or Settings → Profile → two-factor, which shows the same block) on a window about 824px tall, and at the smallest window the desktop app allows | The heading, the QR, the secret, the code field, the button and the two links all sit on the light band, clear of both orange bars (`po-s1-after-desktop-gate-1280x824`, `po-s1-after-gate-1280x700`; the same pictures before, since nothing moved). |

## 2. Your answers

None asked. The words on the strip and the retry timings were this session's
to pick (the brief); the design's review (round 1, before the build) agreed
that no decision here is yours alone to make. Your pending ruling on the
**offline launch** (an app started with no connection) is untouched: at
start-up the session check keeps its own 15 s ceiling and shows the sign-in
screen as it did, with your stored sign-in kept.

## 3. How it was checked

- **The hang, reproduced on demand** against wilson-dev with
  `scripts/probes/connection-hang.mjs` (no sign-in, no real token; the
  refresh is a request to a black hole, as a dead socket is): a refresh that
  never answers pins every later read (0 requests reach the network) and
  `getSession()` with them. Measured there: the sign-in library takes **no
  lock** in this app (it never does with `persistSession: false`, in the
  browser, in Electron or in Node) — the pin is its own one-at-a-time queue,
  which no option of the library bounds; a second client is independent of
  it; and a cancelled refresh is one the library retries by itself, keeping
  the session, 200 ms later and then once per budget.
- **The build, measured with the same probe** (its phase F, the real 20 s
  budget): the strip up 21.3 s into the hang (the refresh carries a small
  body: a second more); both callers held while the network was dead, the
  library's attempts at 0, 21.5 and 42.7 s (one per budget); the network back
  at 45 s; the next ping (52.3 s) answered, the strip cleared 7.3 s after the
  network returned, the dead attempt was cancelled, the retry (52.5 s)
  landed, `TOKEN_REFRESHED` fired and the queued read went out with the new
  token 0.3 s later; the caller that started the hang, answered last with no
  session, was refused by the client module (its request never left with the
  anonymous key); the library's queue empty 1.5 s later.
- **Tests**: the watchdog's (30, with the library as installed on a fetch
  that never answers the refresh but honours a cancel — the hang, the
  recovery, the start-up check — and a CONTROL with the old counting-only
  wrapper, still pending after five minutes); the strip's two sentences; the
  dot's word; the shell's geometry pins for the enrolment screen (the flat
  bars of 7 September as a failing control: 2 of 29 red).
- **The sign-in shell, before and after**, at 1280x800, 1440x900, 1280x824
  and 1280x700, in Chromium 147 and in the desktop app (Electron 33): every
  element of the company step, the password step and the enrolment screen at
  the same pixel; the bars the same height. The enrolment screen reached
  through a stand-in for the cloud on the dev fixtures' tester (nothing real
  is reached; the development copy's cloud address is a closed local port).
- **CI's own browser test of the strip** (a read that never answers → the
  strip within 35 s, *Connection lost*, **Reload**) reads either sentence.
- No sign-in anywhere, no AI call, nothing sent to a server but the probe's
  anonymous reads of wilson-dev.

## 4. Left as it is

- **A request that hung may have landed.** A save cancelled at 20 s can have
  reached the database; the screen says "could not save", and a second save
  of a *new* item can make it twice. Before, the same save hung for ever and
  the same duplicate was one reload away. Not worse; sooner.
- **If the hang swallowed the answer to a token refresh** (the request
  reached the server, the reply never came), the retry presents a token the
  server has already rotated; outside its 10-second grace that ends the
  session — the sign-in screen, with whatever was unsaved. A reload after
  the same hang did exactly that too; it now happens without the reload.
- **While the connection is dead, screens waiting on the session wait** (the
  strip says so); the alternative was to drop the session, which is a
  sign-out. The screen that first met the hang shows its error when the
  connection returns and needs one retry.
- **Two browser tabs of WILSON with one sign-in** can sign each other out
  when one refreshes the token the other still holds (`docs/OUTSTANDING.md`,
  S1-01: inferred, not measured, older than this change).
