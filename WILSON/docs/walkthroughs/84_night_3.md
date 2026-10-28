# 84 — NIGHT 3

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **B2** (subject shares in O.T.T.E.R.), **M1** (the
desktop → cloud migration, part 1) and **S2** (an offline launch). Each
section stands on its own; answer its questions by their numbers.

## B2 — Subject shares in O.T.T.E.R.

1. **You can share one subject with a colleague.** On a course of yours,
   the **⋯** menu now has **Share a subject…** and **Share this course
   with…** beside *Share or submit…*; the study view of one of your subjects
   has **Share…** under the breadcrumb. They read it inside a course of
   their own, live and read-only, once they accept, with their own
   progress; nothing else of your course is shared.
2. **A whole course is one offer.** *Share this course with…* sends every
   subject the course holds that day; they see one card and **Accept all**
   or **Decline all**. When you later add a subject to that course,
   O.T.T.E.R. asks **Share the new subject too?** — nothing is shared unless
   you say so.
3. **Someone who accepted can pass it on**, one subject at a time
   (**Pass on…**); your list shows every link (*Ben via Mara*), and if you
   withdraw it from the first person, everyone they passed it on to loses
   it too.
4. **Requests holds all of it**: *Shared with you* (offers waiting on you,
   counted on the tab) and *Shared by you* (every link of your subjects,
   with **Withdraw**).

**What this is.** B2 of night 3 (`docs/sessions/briefs/po-b2-subject-shares-client.md`),
the screens over B1's server (migration 0100, already on dev and staging),
built to the design you ruled on (`docs/design/OTTER_SUBJECT_SHARES_DESIGN.md`
§5, §10). Nothing of it shows on your computer's own library: it needs a
signed-in workspace.

### What to click, as two people

You need two accounts in one workspace on the beta (yours and a
colleague's, in two browsers or a private window); a third for step 8.
No session holds a password for any account, so this flow is yours.

| # | Who | Do | You should see |
|---|---|---|---|
| 1 | You | Open a course of yours, **⋯ › Share a subject…**, pick a subject, pick your colleague under **With**, add a note, **Share** | The dialog's line: *They will read this one subject inside their own «…» course, live and read-only, once they accept…* Then, in the library: *Shared with <name>. It is waiting for them to accept.* |
| 2 | Them | Open O.T.T.E.R. | The **Requests** tab carries a count (1). Under **Shared with you**: the subject, *from <you> · <course> · just now*, your note, **Accept** and **Decline** |
| 3 | Them | **Accept** | O.T.T.E.R. opens their course of the same name (made for them if they had none), the new row marked by an orange edge; *«…» is now in your … course, linked live from <you>. It stays read-only; your progress is your own.* |
| 4 | Them | Open the linked subject | In the sidebar a chain glyph where a number would be, and no delete; on its card a **Linked** badge; under the breadcrumb *Linked from <you>'s … · read only · you see their edits as they make them*, with **Pass on…** and **Remove from my course**. No Generate, no editing |
| 5 | Them | **Mark complete** on a lesson | Ticked for them; your own progress on your subject is untouched |
| 6 | You | Change a lesson of that subject | They see it the next time they open it |
| 7 | You | **Requests** | **Shared by you**: the subject, *<name> · accepted*, **Withdraw**. Your subject's study view says *Shared with <name>* (it opens Requests) |
| 8 | Them | **Pass on…** to a third person | Your list adds *<third> via <them> · waiting* |
| 9 | You | **⋯ › Share this course with…** | The subtitle counts the subjects (*7 subjects, 2 of them outlines*); after Share: *Shared your course with <name>: N subjects, waiting for them to accept.* (any subject already shared with them is named). They see one card, **Accept all** / **Decline all** |
| 10 | You | Add a subject to that course | *Share the new subject too?* with them ticked; **Share** or **Not now** |
| 11 | You | **Withdraw** on a link | The confirm: *<name> will lose the link. Their own progress stays theirs.* (and, when they passed it on: *Removing it ends it for the 1 person it was passed on to…*). Their next open: *«…» is no longer shared with you.* and the row leaves their course |
| 12 | You | Move the subject to **Recently deleted** | Their row greys: *No longer available — the owner removed it*, with **Remove**; restore it and it comes back the next time their list is read (they open the library or Requests, or another course) |
| 13 | Either | Sign out on the desktop (your own library) | None of the above shows |

### Pictures

From Chromium at a real 1280×800 and 1440×900 window, on the dev fixtures'
tester (made-up people; the fixtures hold no share, by design, so the
sections themselves are pinned by tests, not photographed). In the folder
*84_night_3 pictures* beside this file:

- `po-b2-after-course-menu-1280x800`, `…-1440x900` — the two new items
  (before: `po-b2-before-course-menu-…`, three items).
- `po-b2-after-share-subject-dialog-…` and `po-b2-after-share-course-dialog-…`
  — the dialog in its two menu modes (new; no before).
- `po-b2-after-study-view-…` — **Share…** under the breadcrumb (before:
  `po-b2-before-study-view-…`, nothing there).
- `po-b2-after-course-view-…` and `po-b2-before-course-view-…` — the course
  view, unchanged when nothing is shared.

### Questions

- **Q1. Pronouns in the new sentences.** The design's examples say *her*
  (*Audrey shared her course…*, *Her own progress stays hers*, *you see her
  edits as she makes them*, *waiting for her to accept*). O.T.T.E.R. cannot
  know a colleague's pronouns, so B2 wrote *their / them* everywhere, as the
  design's own *It is waiting for them to accept.* already does. (a) Keep
  *their / them* (Recommended). (b) Use the person's name instead of a
  pronoun.
- **Q2. The subject delete confirm, in the company library.** It still says
  *This will permanently remove this subject and its lessons. This cannot be
  undone.*, while there a delete is the 30-day trash; B2's added sentence
  for a shared subject (*…while it is in the trash and ends when it is
  purged*) sits under it. Recorded in `docs/OUTSTANDING.md`, not changed.
  (a) Reword it for the company library as the course delete already is,
  in 1.1 (Recommended). (b) Before 1.0.
- **Q3. Size.** The app's main file grew by 36 KB (35,731 bytes: the share
  dialog, the reminder, the two Requests sections, the linked subject and
  the sentences the design names), over the night's 20 KB guide. (a) Accept it: it is one
  whole feature (Recommended). (b) Load the two dialogs only when first
  opened (about 7 KB less in the main file).

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
