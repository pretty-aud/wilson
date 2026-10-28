# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M2** (the desktop → cloud migration, part 2), **P1**
(previews on your own storage), **R2** (release readiness) and **D1** (the
desktop keeps its stored state across a relaunch), which you added. Each
section stands on its own; answer its questions by their numbers.

## M2 — The migration carries budgets, levels and experiences

1. **A desktop project now moves whole, but for its team.** Its budget —
   the bid versions, every line, the actuals with their invoices, the
   expenses with their receipts, the role rates — its levels and
   experiences (and their folders and files, the assets' and tasks' links to
   them), and the links on its tasks go up with everything that moved
   before. The locked bid version arrives locked; an open one arrives open,
   with the rows it had set aside still aside.
2. **A budget moves only for someone who may see it.** In the cloud only a
   workspace admin or the project's manager sees a project's budget. You
   become a project's manager when the migration puts it in the cloud, so
   your own run carries the budget. Someone else running it for a project
   that is already there sees one line saying the budget stayed on their
   computer, and nothing fails.
3. **A second run brings back nothing a teammate removed.** The project on
   your computer now keeps a record of every row the migration carried. Run
   it again after someone deletes a budget line or a level in the browser,
   and that row stays deleted. The report names it.
4. **Your three statuses exist in the cloud.** Draft, Wrapped and Inactive
   save in the browser now, and a migrated project keeps its own. Clearing
   the Director or the Producer saves too.

**What this is.** M2 of night 4 (`docs/sessions/briefs/po-m2-migration-part-2.md`),
your two rulings of 2026-10-28 (*"Add the three to the cloud"*; *"A night
after part 2"*). Every row shape was tried on wilson-dev first and rolled
back. Migration **0103** adds the three statuses, and the controller puts it
on staging before you start. The team, an asset's version history, the files
your desktop keeps with its rows, and the company's rate cards and task
templates move in night 5 (M3).

**Before you start.** The controller has said 0103 is on staging. Use the
desktop app, signed in to the beta's company, on a desktop project with a
budget: bid versions (one locked), lines, an actual with an invoice, an
expense with a receipt. If you have a game project, its levels and
experiences go too. A second person in the browser helps with step 7, or
use a second browser window signed in as yourself.

1. **Dry-run.** Settings → Storage → *Migrate to cloud* → **Dry-run first**.
   The table has new rows: **levels**, **experiences** (above *assets*),
   **task dependencies** and **links on tasks** (the old *task links* row was
   the dependencies, and now says so), and after *files*: **bid versions**,
   **budget lines**, **actuals**, **expenses**, **role rates**. *Would insert*
   counts what will go.
2. **Read the lines under the table.** Only those that apply appear:
   - *Stays on this computer for now (a later run of the migration carries
     it): … team members named on budget lines, … team member's project rate
     …* A crew line priced for someone on your desktop team goes up without
     the person; the person comes with the team in night 5. A rate set for a
     person stays here; a role's rate goes.
   - *Stays on this computer (the migration does not carry it): … invoice
     attached by a path on this computer …* An invoice attached in the old
     desktop-only way (a path on your disk) is not uploaded; its actual goes
     without it.
   - *… receipt kept as an ordinary file on this computer goes up behind the
     money gate, as the expense or actual naming it does.* Only if a receipt
     was added before the money gate existed: it goes where only managers
     and admins see it.
   - In the progress log: *the locked bid version will be set in the cloud
     as on this computer, if none is there.*
3. **Migrate.** Press **Migrate**. The log streams. When it ends, hover
   **Migrate** and read: *Done. Running it again writes nothing already in
   the cloud and brings back nothing a teammate removed there since: this
   computer keeps a record of every row the migration carried. The team,
   asset versions and the files kept with assets, scenes, shots, levels and
   experiences on this computer move in a later run of the migration.*
   If you moved this project with last night's build and it had a receipt
   kept before receipts became money, a line under the table reads *… receipt
   an earlier run carried as an ordinary file is open to every member of the
   project in the cloud …*: that build carried it as an ordinary file, and
   this one cannot move it behind the gate yet. If it must not be seen,
   remove it in the browser; no later run brings it back.
4. **Check it in the browser.** Open the project on the beta:
   - **Budget**: the versions, the locked one locked (*Versions*), the lines
     with their rates and days, the actuals in their periods. An actual's
     invoice opens (**Open invoice**). The expenses carry their receipts.
     A crew line priced for one of your desktop team members has no person
     yet: its actuals count in the Summary's totals, but the **Crew** tab,
     which lists people, shows it only once night 5 moves the team.
   - **Levels** and **Experiences**: each row, its status, its folder and
     files. An asset in a level shows the level.
   - **Tasks**: a task's links, if your project had any.
5. **Run it again at once.** **Dry-run**, then **Migrate**: nothing is
   inserted, and no line says anything was removed.
6. **The statuses, in the browser.** On another project: R.A.B.B.I.T. →
   the project's settings → **Status** → **Draft**, then **Wrapped**; reload
   each time, and it stays. On the **Projects** page, set one to
   **Inactive**; reload. In the settings, clear the **Director** (*Select
   director…*) and the **Producer**; reload: both empty, no error.
7. **A teammate removes something.** In the browser, delete one budget line
   (Budget → the line's delete) and one level (Levels → delete).
8. **Run it again on the desktop.** **Dry-run**: the first line under the
   table reads *Removed in the cloud since an earlier run, so not carried
   again: 1 level, 1 budget line*, with each one's name below it.
   **Migrate**, then reload the browser: neither came back.
9. **If someone else runs it** (optional: a workspace manager who is not
   the project's manager, on a project you migrated): their report shows
   one line, *1 project's budget (… rows, with its receipts) stays on this
   computer: in the cloud only a workspace admin or the project's manager
   sees its budget, and you are neither (a workspace admin can make you the
   project's manager; then run again).* Nothing else of the project fails.
   **Archive and clear local** is not offered (it would clear the only copy
   of that budget), and hovering **Migrate** reads *1 project's budget is
   still on this computer, so it keeps its copy: once a workspace admin
   makes you the project's manager, Migrate again.*

**Questions**

- **Q1.** A crew line priced for one of your desktop team members arrives
  in the cloud without the person until night 5 moves the team: its money
  is in the Summary's totals, but the Crew tab does not list it until then.
  Is that fine for a few days, or should night 5 come before you migrate a
  project with crew actuals?
- **Q2.** The record means a project you delete in the cloud is never put
  back by the migration, even if you want it back. Should night 5 add a
  way to make this computer forget what it carried (*Carry everything
  again*), or is deleting the project for good the right answer?
- **Q3.** An invoice attached the old way (a path on one computer) is not
  carried, and its actual goes without it. Should the report list those
  actuals by name, so you can attach the invoice again in the browser?

## P1 — Previews on your own storage

1. **A company that keeps its files in its own S3 bucket now sees their
   pictures.** In the Files panel of an asset, scene, shot, level or
   experience, a picture or a video in the company's bucket shows its
   thumbnail, in the table and in the gallery, as a file on Petal's storage
   does. Until tonight those rows were file-type icons.
2. **The Files tab previews and plays them.** A picture, a PDF or a text file
   in the company's bucket opens in the preview; a video plays. The bytes go
   straight from the company's bucket to your browser or the desktop app;
   Petal never carries them.
3. **Money and Legal files are as before**: they never leave Petal's
   storage, and nothing new can ask for them.
4. **A company that keeps its media on its own server (a NAS)**: in the
   browser its Files panels and its Files tab now say where that media is,
   instead of looking empty: *This company keeps its media on its own
   server, so files are added and opened in the WILSON desktop app (Local
   Server mode). Footage on the server is listed in Bins.* What comes after
   that is your Q1 and Q2 below.

**What this is.** P1 of night 4 (`docs/sessions/briefs/po-p1-own-storage-previews.md`),
measured and designed first (`docs/NETWORK_STORAGE_DESIGN.md` §9, one review
round), then built: a new cloud function, `storage-read-urls`, signs the
addresses of a company's own files for a short time, only for a file the
person may already open. It is on wilson-dev; **the controller deploys it to
staging first**, and only then does the beta show any of this. No company
with its own bucket exists on any environment tonight, so the proof is the
tests and the function on dev; your test bucket on the beta is the first
real one.

### What to do with your test bucket (once the function is on staging)

| # | Do | You should see |
|---|---|---|
| 1 | On the beta, as a workspace admin: **Admin Terminal › Storage › Your own storage › S3-compatible bucket**; your bucket, its key and secret; the CORS rule from the handbook (§12.7a) pasted into the bucket's settings; **Test connection** | Both halves pass |
| 2 | Choose your own storage with that bucket and save | *Saved* |
| 3 | In a project, open an asset, **Files › Add files**: one picture (PNG or JPEG) and one short H.264 MP4 | Both upload, and each row shows its thumbnail (the video's still frame) |
| 4 | **Gallery** | The same two pictures, larger |
| 5 | Close the asset and open it again | The pictures are back at once |
| 6 | **Files** tab, the asset's folder, double-click the picture | The preview shows it |
| 7 | Double-click the video | It plays when you press play, and seeking works |
| 8 | Leave the asset's Files panel open for more than an hour, then open the gallery or scroll | The pictures are still there (renewed every few minutes while they are shown) |
| 9 | Add an invoice or a Legal file to that project | It goes to Petal's storage as always; your bucket does not get it |

If the pictures stay icons, **Test connection** first: a missing CORS rule is
the likeliest cause, and it says so.

### What a company on its own server shows

In the browser (and in the desktop app with the cloud backend): an empty
Files panel says the sentence above; the Files tab says it above the
project's folders. In the desktop app with Local Server mode nothing changed:
its files and their pictures are there as before. The sentence is pinned by
tests rather than photographed: the dev fixtures have no such company.

### Pictures

From Chromium at a real 1280×800 and 1440×900 window, on the dev fixtures'
tester (made-up projects; one file of the fixtures sits in a company bucket,
the Lamp Room level's blockout picture, and the fixtures stand in for that
bucket). In the folder *85_night_4 pictures* beside this file:

- `po-p1-after-level-files-1280x800`, `…-1440x900` — the Lamp Room level's
  window: its Files table shows the blockout's thumbnail, signed in the
  company's bucket (before tonight that row would have been a file-type
  icon; there is no before picture, because the fixtures had no file in a
  company bucket until tonight).
- `po-p1-after-level-gallery-…` — the same panel in Gallery.
- `po-p1-after-files-preview-…` — the Files tab, LEVELS › Lamp-Room, the
  blockout opened in the preview (its details say *Your own bucket*).

### Questions

- **Q1. A company that keeps its media on its own server: its project files
  in the browser.** Today the browser lists none of them; only the Bins tab
  lists the server's footage. (a) For 1.0 they stay on the server and in the
  desktop app; the browser says so where they would be, and night 5's M3
  leaves them where they are on such a company and says so (Recommended:
  listing them in the cloud is a feature of its own, a design night and a
  build night at least, and Bins already gives footage a view in the
  browser). (b) Night 5's M3 lists them in the cloud: a row per file naming
  where it is on the server, the file staying there, as a Bins clip is; the
  browser shows the list (pictures as Q2; playing them would wait for the
  file gateway). (c) List them after 1.0, in a design night of their own.
- **Q2. If they are listed (Q1 b or c), their pictures.** (a) As your rule
  for footage in Bins: made by the desktop that adds the file and kept on
  Petal's storage only while the company's remote viewing is on
  (Recommended: it is how Bins already works). (b) Never on Petal's storage:
  icons in the browser, pictures only later through the file gateway (a
  gateway release with its own signed build and a TPN review). (c) No
  pictures for them in the browser at all.

### How it was checked

- **Reviews:** the design, then the build twice, each by a second model
  reading the code to break it (the design and the first build round on
  Opus, the second on Fable); everything that broke a claim was fixed the
  same night, the rest is in the list below.
- **Tests:** the full suite, 417 files, 10,496 passed and 9 skipped (10,404
  before tonight: 92 new). Every piece has a failing control, run and seen
  to fail for the predicted reason: 40 in all (the money key, a key outside
  a project, an unreadable project, an inactive member, a workspace not on
  S3, the project asked once, the order, the row and its own project, the
  thumbnail's own key, the hour only for video and audio, the read by
  folder, the folder's own files only, the paging, the batches, the icon
  for a refused file, a money key never sent, the renewal, the two maps,
  getUrl required, the video, read-once, the sign-out, the storage choice
  after a sign-out, the server sentence).
- **On wilson-dev** (deployed tonight, nowhere else; version 3): the function
  answers a browser's preflight, refuses anything but POST (405) and every
  call without a real sign-in (401), and the copy running there is the
  repository's. No session signs in, so nothing further is measured live.
- **The app's size:** the main bundle grows by 4,305 bytes.

### Left as it is

`docs/OUTSTANDING.md`, P1: OSP-01 the older signer still signs by path, not by
row (it needs the same row check and a redeploy everywhere); OSP-02 a download
from a bucket still reads the whole file into memory; OSP-03 a clip longer
than an hour restarts at 0:00 on its renewal, on Petal and on a bucket alike;
OSP-04 files written to a bucket before a switch to a server answer "configure
S3"; OSP-05 a receipt uploaded to a bucket before migration 0076 is not marked
as money (none exists; the release runbook counts them); OSP-06 the live check
is your test bucket; OSP-07 someone who can write to a project can still make a
file row stand for any key in that project (a database rule, for a migration
night); OSP-09 after failed renewals a late tile can load a dead link once;
OSP-10 a clip that plays by its type alone, with an extension the list does
not know, gets five minutes; OSP-11 the dev fixtures try a storage read that
fails harmlessly.

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
