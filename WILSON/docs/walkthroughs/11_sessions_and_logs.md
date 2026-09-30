# Walkthrough 11 — Sessions and the sign-in log

**Track B, bundle B2 (2026-09-06).** What this proves: every sign-in,
failed sign-in, two-factor check, sign-out and timeout is written down and
can be read in **Admin Terminal → Logs → Sign-ins** (and, for operators, in
the console's **Sign-ins** section); a session left alone is warned at
**25 minutes** and signed out at **30**, and the login screen says why; a
session ends after **4 hours** no matter how busy it is; the app and the
operator console keep separate clocks; and when the network silently dies
mid-use the app says **Connection lost — reload to continue** instead of
freezing.

**Where:** the beta (`beta.petalstudios.co/wilson`), backed by **staging**.
The operator console is `admin.petalstudios.co/wilsonadmin`.

**Accounts:** your workspace admin (Browser B) and your operator account
(Browser A). Two browsers, as in walkthrough 10.

**Before you start — the two hooks (OWED_AUDREY §14).** Two of the rows
this walkthrough looks for — a *failed* sign-in and a two-factor check —
are written by the sign-in server, and only if staging's two Auth hooks are
enabled in the dashboard. Steps that need them say so. Everything else
(your own sign-ins, sign-outs and timeouts) is written by the app and works
either way.

Every label below was grep-verified against `src/` on the day this was
written. Times are wall-clock: an idle tab in the background can be signed
out up to a minute late (browsers slow background timers), and is judged
the instant you look at it again.

---

## Step 1 — Sign in badly, then well (Browser B)

1. Open the beta, signed out. Clear the `COMPANY` step. Type your username
   and a **wrong** password, `Sign in`.
   - **Expect:** `SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.`
2. Now the right password. If you are enrolled in two-factor, type a
   **wrong** code once (`CODE REJECTED. TRY AGAIN.`), then the right one.
   - **Expect:** the app.

## Step 2 — Read it back: Admin Terminal → Logs → Sign-ins (Browser B)

1. Open **Admin Terminal**, click **Logs** in its left nav, then the
   **Sign-ins** chip beside `System` and `Activity`.
   - **Expect:** a table with the columns `Time`, `Event`, `Person`, `Where`,
     `Address`, `Factor`, newest first, and under it the line
     *"Addresses are recorded on the app’s own rows only; checks made by the
     sign-in server carry none."*
   - **Expect:** the top row reads **Signed in**, `Where` = `app`, `Person`
     = your name, and an `Address` (your public IP).
2. **If the hooks are on (Step 0 of §14):** above or beside it, a
   **Sign-in failed** row from the `sign-in server` with no address (`--`),
   and — if you did the two-factor part — a **Two-factor failed** and a
   **Two-factor passed** row with `Factor` = `totp`.
   - **If instead** the failed row is missing and the hooks are enabled:
     record that; if the hooks are not yet enabled, that is expected and
     the row will appear once they are.
3. Change the filter (`All events`) to **Failures**.
   - **Expect:** only the red rows. Set it back to `All events`.
4. Press **Refresh**.
   - **Expect:** the same rows, no error.

## Step 3 — Sign out is a row too (Browser B)

1. Settings → the sign-out control you used in walkthrough 10 → sign out.
   - **Expect:** the `LOGIN` screen with **no** line above the form.
2. Sign back in, open Logs → Sign-ins.
   - **Expect:** a **Signed out** row (`Where` = `app`, with an address)
     just under your new **Signed in** row.

## Step 4 — Leave it alone: the idle warning and sign-out (Browser B)

This step takes 30 minutes of not touching the tab. Start it, note the time,
and go do something else on another device — do not scroll, click or type
in Browser B.

1. At **25 minutes** a dialog headed **STILL THERE?** appears: *"You’ll be
   signed out in 4:59 for inactivity. Move the mouse or press a key to stay
   signed in."* with a **STAY SIGNED IN** button and a live countdown.
   - **Expect:** it counts down. Do not touch it.
2. At **30 minutes** the app is gone and the `LOGIN` screen shows, with the
   line `SIGNED OUT AFTER 30 MINUTES WITHOUT ACTIVITY.` above the form.
   - **If instead** the app is still there past 31 minutes: record whether
     the tab was in the foreground, and the time.
3. Sign in again; Logs → Sign-ins.
   - **Expect:** a **Signed out (idle)** row, `Where` = `app`.

## Step 5 — The warning clears when you come back (Browser B, optional)

1. Repeat the wait until **STILL THERE?** appears (25 minutes), then move
   the mouse.
   - **Expect:** the dialog disappears at once and you are still signed in.
     (The button does the same thing; moving is enough.)

## Step 6 — The 4-hour limit ends a busy session (Browser B, long)

Leave the app open through a working morning and keep using it now and
then (the idle clock resets on every click; the 4-hour clock does not).

1. At about **3 h 55 min** after that sign-in a dialog headed
   **SESSION ENDING** appears: *"Sessions end after 4 hours. You’ll be
   signed out in 4:59 — save your work."* with an **OK** button.
   - **Expect:** clicking OK hides it; moving the mouse does **not** bring
     more time.
2. At **4 hours** the `LOGIN` screen, with the line
   `SIGNED OUT: SESSIONS END AFTER 4 HOURS. SIGN IN AGAIN TO CONTINUE.`
3. Sign in; Logs → Sign-ins.
   - **Expect:** a **Signed out (4-hour limit)** row.
4. Reload test, any time before the 4 hours: press the browser's reload.
   - **Expect:** you stay signed in and the 4-hour clock keeps its original
     start (a reload is not a new sign-in). Not visible directly; the proof
     is that Step 6.2 lands 4 hours after the SIGN-IN, not after the reload.

## Step 7 — The two surfaces keep separate clocks (Browsers A and B)

1. Browser A: sign in to the operator console (`Email`, `Password`,
   `Authenticator code`) and keep using it — click between `Companies`,
   `Models`, `Audit` every few minutes.
2. Browser B: sign in to the app and leave it alone for 30 minutes.
   - **Expect:** Browser B is signed out on schedule (Step 4) **even though
     the console was busy the whole time**, and Browser A is still signed
     in afterwards.
3. The reverse, if you have the patience: keep Browser B busy and leave the
   console alone.
   - **Expect:** the console shows **STILL THERE?** at 25 minutes and its own
     sign-in screen at 30, with the same idle line in a small amber box
     above the form; Browser B is untouched.

## Step 8 — The operator mirror (Browser A)

1. In the console's left nav click **Sign-ins** (below `Audit`).
   - **Expect:** the heading **OPERATOR SIGN-INS**, a note of how many
     operators the platform has, and a table `When`, `Event`, `Who`,
     `Surface`, `Address`, `Factor`.
   - **Expect:** your console sign-in as **Signed in** with `Surface` =
     `console`, your email under `Who` with *you* beneath it, and an
     address; your app sign-ins (Steps 1–6) with `Surface` = `app`; and, if
     the hooks are on, the server's **Two-factor passed** row for the
     console sign-in with `Surface` = `—` and no address.
2. Filter to **Two-factor**, then **Sign-outs & timeouts**.
   - **Expect:** the table narrows each time.

## Step 9 — Connection lost (Browser B)

The banner is for a network that **looks** connected but goes nowhere: the
modem drops, the router loses its uplink, a VPN stops forwarding. Turning
Wi-Fi off is a different case — the browser then *knows* it is offline,
requests fail at once, and the screens show their own errors; no banner is
expected for that, by design.

1. Signed in and on Home, disconnect your router from the internet while
   the laptop stays connected to it (pull the modem's power or the WAN
   cable). Then open **Resources → Team Members**.
   - **Expect:** within about **20 seconds** a dark bar across the top of the
     window: **Connection lost — reload to continue.** with a **RELOAD**
     button.
   - **Record** how many seconds it took.
2. Reconnect the modem, wait for the connection to come back, press
   **RELOAD**.
   - **Expect:** the app reloads, you are still signed in, and Team Members
     loads.
3. Turn Wi-Fi off instead (the "different case"): note what the screen
   does — an error line in the page you are on, no banner.
   - **If instead** the banner appears with Wi-Fi off: not wrong, just
     record it.

## Step 10 — A long upload does not trip the banner (Browser B)

1. In a project's Files, upload the largest video you have handy (a few
   hundred megabytes is ideal). While it runs, keep the network up.
   - **Expect:** the upload proceeds and **no** Connection-lost banner
     appears at any point, however long it takes.

---

## Report back (paste and fill in)

```
Walkthrough 11 — sessions and the sign-in log — <date>
Hooks enabled on staging before starting: yes / no
Step 1 wrong password wording: …; two-factor wrong code wording: …
Step 2 Signed in row: yes / no; Where = app: yes / no; address shown: yes / no; legend line: yes / no
Step 2 hook rows (Sign-in failed / Two-factor): present / missing / hooks off; Failures filter: ok / not ok
Step 3 Signed out row after signing back in: yes / no
Step 4 STILL THERE? at: … min; signed out at: … min; login line seen: yes / no (text: …); tab foreground/background: …
Step 4.3 Signed out (idle) row: yes / no
Step 5 (optional) dialog cleared on mouse move: yes / no
Step 6 (long) SESSION ENDING at: …; signed out at: …; login line: …; Signed out (4-hour limit) row: yes / no; reload kept the clock: yes / no / not tested
Step 7 app signed out while console busy: yes / no; console still signed in: yes / no; reverse tested: yes / no (…)
Step 8 operator Sign-ins: console row with Surface console: yes / no; app rows: yes / no; hook rows with —: yes / no / hooks off
Step 9 banner after modem drop: yes / no, after … s; RELOAD recovered: yes / no; Wi-Fi off showed: …
Step 10 upload of … MB ran … min with no banner: yes / no
Anything else: …
```
