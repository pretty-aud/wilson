# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M2** (the desktop → cloud migration, part 2), **P1**
(browser previews for own-storage workspaces), **R2** (release readiness) and
**D1** (the desktop keeps its settings and its four-hour limit), which Audrey
added. Each section stands on its own; answer its questions by their numbers.

## D1 — The desktop keeps its settings and its four-hour limit

Your ruling of 2026-10-28 on OUTSTANDING S2-01, *"Fix it in 1.0, a session
tonight (Recommended)"*. Measured first, designed, reviewed (the design round
ran on Opus: the Fable weekly limit refused it), then built.

1. **The desktop now keeps what the window stores, across a quit and a
   relaunch.** Every launch opens WILSON at a new local address, and the
   window's own storage used to start empty each time. Now WILSON keeps it
   in a file beside your saved sign-in and puts it back before the window
   draws: the timeline's settings (Show weekends, the sort, the grouping),
   collapsed phases, edited prompts, holidays, Budget's and Team's saved
   views and columns, the Scenes tab's shot list, the task window's item
   sort, O.T.T.E.R.'s sidebar and library choice, the last company on the
   sign-in screen, the update prompt's *skip this version*, and **the crash
   copies of unsaved edits**, which until now never survived the relaunch
   they exist for.
2. **The four-hour limit runs from your real sign-in at every launch**, on
   the desktop and on the web. Before, every desktop launch started four new
   hours.
3. **Already kept, and unchanged:** R.A.B.B.I.T.'s storage choice and last
   project (they were in a file all along: the question you answered said
   they probably reset, and the measurement showed they did not), the pet,
   O.T.T.E.R.'s settings, the agent skills, each table's last used view.
4. **Once, at the first launch after installing this build,** the settings
   start from their defaults: what the old version kept is in a storage it
   could never reach again. From then on they stay.

### What to click, on the desktop

1. Sign in. In **R.A.B.B.I.T.**, open a project's **Timeline**, open
   **RABBIT settings** (the gear) → **Settings** → **Timeline display**, and
   turn **Show weekends** off. At Day zoom, Saturdays and Sundays go.
2. Open **Team**, choose **Saved views** → **Save current view**, and name it
   *D1 test*.
3. Quit WILSON (the window's ✕, then **Close**) and open it again.
4. You are back in without signing in (it is less than four hours since you
   did). Open the same Timeline: weekends are still hidden. **Team** →
   **Saved views** lists *D1 test*.
5. Turn Show weekends back on and delete *D1 test*; quit and reopen once
   more: both stay as you left them.

### The four-hour limit across a relaunch

You cannot wait four hours, so here is what was measured in the desktop app
(a development build, a scratch folder, a made-up sign-in whose token says it
was made 3 h 56 min earlier, nothing reaching the cloud):

| | Before D1 | With D1 |
|---|---|---|
| The relaunch's four hours start at | the relaunch | your sign-in |
| Time left after the relaunch | 239.8 minutes | 3.9 minutes |
| *Session ending* notice | not shown | on screen 0.7 s after the launch: *You'll be signed out in 3:57* |

So if you sign in at 9:00 and relaunch at 12:58, the *Session ending* notice
appears at once with about two minutes left, and at 13:00 you are signed out
with *"Signed out: sessions end after 4 hours. Sign in again to continue."*
Before, that relaunch gave you until 16:58. Sign in again and the four hours
start again, as always.

The picture `po-d1-cap-notice-at-relaunch-1400x900` (the desktop app at
its own 1400×900, the notice over Home, the strip because the cloud was cut)
is in the folder *85_night_4 pictures* beside this file, and in the repo
under `docs/sessions/handoffs/img/`.

How it was checked, besides that run: two launches writing five of these
keys (all five came back at the second launch; before D1 none did); a key
written just before a reload and one written just before the window closed
(both came back); the tests (a relaunch inside the four hours keeps the
deadline, one past it signs out at once, a fresh sign-in starts its own four
hours, the online and offline starts agree); the local server's lock harness
(31 checks, unchanged).

### What is left as it is

- **A crash loses the last second.** WILSON writes the window's storage back
  once a second, when the window is hidden, and as it closes or reloads. If
  it crashes or the computer loses power, a change made in the second before
  is lost (measured: a key written 2.5 s before was kept, one written
  0.05 s before was not).
- **If Windows holds the file as WILSON starts** (an antivirus scan that
  lasts longer than WILSON waits), that launch starts from the defaults,
  what you change in it is not kept, and the file is left as it was: the
  next launch, or a reload of the window, has your settings back.
- **Two security findings outside this fix**, recorded for the controller
  (OUTSTANDING D1-01 and D1-02) and asked below.

### Questions

**Q1.** A file dropped on WILSON's window anywhere but Bins opens as a page
inside WILSON's window, and that page is handed what WILSON's own page has,
your saved sign-in and the local server's key among them (measured with a
made-up page; nothing is sent anywhere by WILSON itself). What should happen?

- (a) **WILSON's window never leaves WILSON's own page: a drop outside Bins
  does nothing, a link opens in your browser as today, before 1.0
  (Recommended).**
- (b) The same, after 1.0.

**Q2.** When the computer sleeps with WILSON open, the first key or click
after it wakes counts as activity before WILSON notices how long it was idle,
so a session that sat idle for hours carries on instead of signing out
(measured in the tests). What should happen?

- (a) **WILSON judges the absence first, as it already does when you come
  back to the window from another one: idle 30 minutes or more, signed out
  with the usual line, before 1.0 (Recommended).**
- (b) The same, after 1.0.
