# 84 — NIGHT 3: SUBJECT SHARES (THE CLIENT), THE MIGRATION (PART 1), THE OFFLINE LAUNCH

One walkthrough for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), a
section per session: **B2** (subject shares, the client), **M1** (the desktop
to cloud migration, part 1) and **S2** (the offline launch). Each section says
what changed, what to do, what you should see, and its questions for you,
numbered within the section.

## S2 — Offline launch

1. **WILSON opens without a connection if you signed in less than four hours
   ago.** Your answer of 2026-10-27, *"A sign-in less than 4 hours old"*.
   Before, any launch without a connection stopped at the sign-in screen,
   however fresh your sign-in was. Now the app opens as usual and works on
   what this computer has; nothing in the cloud is reached, and nothing
   pretends to be.
2. **Every tool says so in one sentence**, your second answer, *"One offline
   sentence on each screen, no empty-state words"*: *Could not reach the
   database — your projects appear when the connection returns.* (tasks,
   notes, courses where that is the screen's word). No "No projects yet", and
   no New project, New note or New course while offline.
3. **The strip at the top says "Connection lost — reconnecting…" from the
   first moment, and stays that way** — never "reload to continue", because a
   reload would only open offline again. Reload stays on it.
4. **When the connection comes back, everything fills in by itself**, within
   about ten seconds: the strip goes, your projects, tasks, notes and the
   company's courses appear, R.A.B.B.I.T.'s corner dot turns green, and your
   pet syncs from your account. No reload.
5. **Your pet** is the one this computer last saw while offline, with no
   error message; a change to it is refused with the usual *"…Reopen WILSON to
   try again."* until the connection returns. A pet that failed to sync for
   any other reason now tries again by itself (after 5 s, 15 s, 45 s, 2¼ min
   and 5 min, and whenever the connection comes back) instead of waiting for a
   relaunch.
6. **More than four hours after signing in, nothing changes**: the sign-in
   screen, as before. A sign-in itself still needs the connection, and there
   is still no way in without one (your rule of 2026-09-10).

**What this is.** S2 of night 3 (`docs/sessions/briefs/po-s2-offline-launch.md`):
your two answers, designed first (`docs/design/RECONNECT_DESIGN.md` §11,
reviewed before the build; the review changed how a slow-but-working
connection is treated, so it is never mistaken for none), built, and
reviewed twice.

### What you will see

| # | Do | You should see |
|---|----|----------------|
| 1 | Sign in as usual (the desktop app, or the web), then quit WILSON. | — |
| 2 | Turn the Wi-Fi off (or pull the cable), then open WILSON within four hours of that sign-in. | The app opens past the sign-in screen at once (measured: 0.1 s after the window loads; 5 s when the computer says it is online but nothing answers), with **"Connection lost — reconnecting…"** and **Reload** in the strip (`po-s2-offline-desktop-home-*`, `po-s2-offline-web-home-*`). |
| 3 | Open R.A.B.B.I.T., the Projects page, D.O.G., the Dashboard and O.T.T.E.R. | On the web, and on the desktop when R.A.B.B.I.T. is set to the cloud: one sentence on each in place of the empty list, and no New or Create button (`po-s2-offline-web-rabbit-*`, `-projects-*`, `-dog-*`, `-dashboard-*`, `-otter-*`). On the desktop on the Local Server, R.A.B.B.I.T. shows your local projects as before (they work offline). O.T.T.E.R. on the desktop shows this computer's library with the line *This is the library on this computer: your company library could not be reached, and appears when the connection returns.*; Import stays, New course does not (it needs the AI) (`po-s2-offline-desktop-otter-*`). |
| 4 | Wait a minute or two. | The strip still says *reconnecting*. R.A.B.B.I.T.'s dot is an amber diamond (*Reconnecting to the database*), or says *Offline: no network* when the computer knows it is offline — never *Not signed in*. |
| 5 | Settings → Storage. | The Supabase card has no green dot and reads *Signed in · (host) · not reachable right now*. |
| 6 | Turn the Wi-Fi back on. | Within about ten seconds: the strip goes, the lists fill in (`po-s2-offline-web-rabbit-back-1280x800`), the dot turns green, the pet syncs. On the desktop, O.T.T.E.R. moves to the company library (Q1). If you are an admin who has not set up two-factor yet, the two-factor screen appears now, as it would have at an online launch. |
| 7 | Try steps 1–2 more than four hours after signing in. | The sign-in screen, as before. |

### How it was checked

| | Before (today's code) | After |
|---|---|---|
| Desktop app, every request cancelled (`WILSON_DEV_OFFLINE=1`), a made-up saved session | the sign-in screen 4.4 s after the window loads (your measurement of 2026-09-10: 4.5 s) | the app 0.1 s after the window loads, the strip up |
| Desktop app, every request left hanging (`=stall`) | the sign-in screen 19.3 s after (yours: 15.0 + 4.3 s) | the app 5.1 s after, the strip up |
| The connection back (desktop, a stub answering) | — | the strip gone 7.8 s after; the pet, the storage folder, the model choices and the welcome check read at once |
| The cloud refusing a saved sign-in (wilson-dev, a made-up one) | the sign-in screen at 0.1–0.5 s, the saved sign-in kept | the same screen at 0.1–0.2 s, and the refused sign-in removed from this computer |

Measured with `scripts/probes/connection-hang.mjs` phase G against wilson-dev
(no sign-in anywhere; the tokens are made up) and in the desktop app on a
scratch profile, off-screen. The web pictures are the built app in Chromium
with the cloud cut by a stub. Nothing here signed in to anything.

### Your questions

**Q1.** When the connection returns while you are inside a course from this
computer's library (the desktop, opened offline), what should O.T.T.E.R. do?
- **(a)** Switch to the company library at once, as Settings → Library does — *built*; the course you were in is left (Settings → Library → This computer brings it back).
- **(b)** Stay in the course, and offer the company library in the notice instead.

### Left as it is

- **On the desktop, every launch starts with an empty browser storage**
  (OUTSTANDING S2-01): the app's window gets a new address each launch, so
  the four-hour clock restarts at every relaunch there (the offline launch
  does not depend on it: it reads the sign-in time from the sign-in itself),
  and R.A.B.B.I.T.'s choice of storage backend falls back to the Local Server.
  Measured, not changed: the four-hour rule is not this session's to change.
- The rate card, team members and the Admin Terminal show their own error
  while offline and read again on their own refresh or the next launch;
  R.A.B.B.I.T. does not reopen the project you last had open once the
  connection returns.
