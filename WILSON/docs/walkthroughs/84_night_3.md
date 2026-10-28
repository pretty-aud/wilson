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

## M1 — The migration carries five more kinds

App settings → Storage → **Migrate to cloud**, on the desktop app signed in to
the company the projects go to. Part 1 of two (part 2 is night 4).

1. **A desktop project moves at all now.** Every project the desktop app makes
   carries three keys of its own — its D.O.G. attachment lists and its files
   folder — that the cloud's projects table has no column for, so the cloud
   refused the whole project, and every phase, task, asset, file, scene and
   clip of it with it. Measured on wilson-dev before the fix, with nothing
   kept: *column "documents" of relation "projects" does not exist*. A locked
   or open bid version (the budgets are part 2's) and the project's folder on
   this computer (the cloud takes a project folder only from an admin or a
   manager, inside the company's drive) refused it the same way. The project
   now goes up with the columns the cloud has; the report says, per project,
   *names a locked or open bid version: part 2 of the migration sets it…* and
   *project folder on this computer stays this computer's setting…*. Its
   values go up as the cloud's columns take them: a status the cloud does not
   have (Draft or Wrapped from the project's settings, Inactive from the
   Projects page) arrives as Active, and the report says *1 project has a
   status the cloud does not have (wrapped): it arrives as active* (see Q3); a
   project started in D.O.G. keeps its dates, and a date you changed later in
   R.A.B.B.I.T.'s settings wins, on the day you picked; a cleared date, frame
   rate, director or producer arrives empty or at the cloud's default instead
   of refusing the project. A value the cloud cannot hold — a budget in yen
   past ten billion, say — is left out and named in the settings' words: *1
   project has a value the cloud cannot hold (targeted budget total)…*. These
   two lines appear only for a project that arrives in that run.
2. **Its key dates go up** (the Timeline's diamonds), after its phases. One in
   this computer's **Recently deleted key dates** is not carried, and the
   report says so; one removed in the cloud since an earlier run stays removed.
   One whose phase you deleted here arrives without a phase, counted: *1 key
   date arrives without its phase: removed on this computer…*.
3. **Its comments go up**, on the same tasks, assets, phases and project. No
   screen shows comments today; the report's **comments** row counts them.
4. **Its shot lists go up, with their items and edits.** Each list holds the
   same scenes and shots in the same order; its edits keep their chain. The
   list that is active on this computer is made active in the cloud. A list
   or edit you archived here arrives live and is archived straight after —
   the cloud allows no other way — so the cloud's archive date is the day you
   migrate. The dry run names those: *1 shot list and 1 edit archived on this
   computer: archived in the cloud too, once carried.* A list in the cloud has
   one chain of edits; if a teammate started or continued it there since an
   earlier run, or an older version left two chains in one list here, an edit
   cannot take a place another holds, so it stays (with the edits after it),
   counted, and the dry run says the same: *N edits not carried: the shot
   list's one chain of edits already has an edit in their place…*.
5. **Its folders go up, and each file lands in its folder.** The Files tab's
   tree in the browser is the desktop's: ASSETS with a folder per asset,
   SCENES, SHOTS, INVOICES, and each file in the folder you saw it in on this
   computer (an asset's file in the asset's folder). A file at the project's
   top stays at the top, as do invoices (see Q1). A file linked to a task,
   asset or phase you deleted here arrives without that link, counted: *N
   links of a file to a row removed on this computer… let go*. A file whose
   folder could not go up in a run waits with it, and the next run brings
   both, the file in its folder.
6. **What stays is named before you can clear anything, part 2's apart.**
   Under the report: *Stays on this computer for now (part 2 of the migration
   carries it): …budget lines, …levels…* and *Stays on this computer (the
   migration does not carry it): …asset versions, …files kept with assets,
   scenes, shots, levels and experiences on this computer…*. Archive and
   clear local keeps all of it in the archive file.
7. **Running it again changes nothing that is there.** Every row already in
   the cloud is skipped, one in its trash included until the trash is emptied
   after 30 days; a row a teammate removed from the cloud for good comes back
   — a scene, shot, bin, clip, take, folder, saved view, grouping, task or
   phase link, or an item of a list or a task, the kinds with no trash
   (stopping that is part 2's).
   Migrate's hover when it is done says it, and Help's paragraph too.

### Step by step

| # | Do | You see |
|---|---|---|
| 1 | **Dry-run** | Per project, in the log: the bins' lines as before, then *N shot lists with M items and K edits*, the archived ones named, *"Shot list 1 · v1" will be the active shot list in the cloud, if none is active there*, *N files filed in their folders, as on this computer*, and the bid version and project folder lines where they apply. Nothing is written. |
| 2 | The report | Six new rows in the order things move: **key dates** after phases, **comments** after the links, **shot lists**, **items on shot lists** and **edits** after shots, **folders**, then **files** (`po-m1-after-migrate-report-rows-1280x800`; the panel's new description is `po-m1-after-migrate-panel-1280x800`, both in `docs/sessions/handoffs/img/`, taken in the browser tester, where there is no desktop to read, so the counts are 0 there). Under the table, one line each for what did not move and why, and the not-carried sentence in its two parts. |
| 3 | Answer the footage question as before, then **Migrate** | The same lines, now in the past tense: *"Shot list 1 · v1" is the active shot list in the cloud*, *N files filed in their folders*. When nothing failed: Migrate's hover reads *Done. Running it again skips every row already in the cloud…*, and **Archive and clear local** appears; its hover names part 2. |
| 4 | Open the project in the browser (the beta) | **Timeline**: the key dates. **Scenes**: the lists in the list picker, the active one selected, the archived one among the archived lists; its edits in the edit picker. **Files**: the folder tree, each file in its folder. **Bins** as before. |
| 5 | **Dry-run** again | The project, key dates, shot lists, items on shot lists, edits and folders count as *Skipped*, nothing under *Would insert*; no *files filed* line. Comments, like phases, assets and tasks, count in **Total** only: a comment has no project to read the cloud by, so the real run skips each one by its id instead. |

**What only your desktop can show:** the dry run and the real run read the
projects through the desktop's own server, which a browser does not have, so
the counts, the log lines and the run itself are yours to see. The tests run
the whole of the development copy's project (Salt Hours, turned back into the
desktop's shape) through the migration and check every key date, comment,
list, item, edit, folder and file comes out in the cloud's shape with its id
and its parents; and that a second run changes nothing.

**If a list cannot be archived for you:** the cloud lets a workspace admin or
the project's manager archive a list (whoever carries a project to the cloud
the first time becomes its manager). Anyone else can archive only a list
nobody has saved or built on, so
the report then says *"…" is archived on this computer but live in the cloud*;
archive it on the Scenes tab.

### Questions

- **Q1.** Invoices and the files added at the project's top sit at the top of
  the Files tree in the cloud, as on the desktop (the desktop records no
  folder for them; an invoice's file is kept in INVOICES on disk). Should the
  migration file invoices in the INVOICES folder instead? (a) Leave them at
  the top, as the desktop shows them (as built). (b) INVOICES.
- **Q2.** No night of the plan carries an asset's version history or the
  files the desktop keeps with an asset, scene, shot, level or experience
  (FileManager's), and none carries the company's rate cards, team members
  or task templates from this computer. The report now names the first two
  before you can clear anything. (a) Add them to part 2 (night 4). (b) A night
  after part 2. (c) Leave them: the archive file keeps them.
- **Q3.** The cloud's project statuses are Active, On hold, Completed,
  Archived and Cancelled. A desktop project set to Draft or Wrapped (its
  settings) or Inactive (the Projects page) arrives as Active, and the report
  names it, so you can set it on the project afterwards. Should the migration
  choose one of the cloud's instead? (a) Active, named (as built). (b) Draft
  and Inactive become On hold, Wrapped becomes Completed.

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
with the cloud cut by a stub. Nothing here signed in to anything. The
pictures named in the table (`po-s2-offline-…`, at 1280×800 and 1440×900)
are in the folder *84_night_3 pictures* beside this file, and in the repo
under `docs/sessions/handoffs/img/`.

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
