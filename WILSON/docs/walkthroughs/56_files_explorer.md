# 56 — FILES: the Table as an explorer, shot folders inside their scenes, files on levels and experiences (R.A.B.B.I.T. → FILES, SCENES, LEVELS, EXPERIENCES)

**What this is.** Your first beta report on the Files tab, built. The Table
now shows **one folder at a time**, like Windows Explorer: click a folder to
open it, the path above the rows says where you are, Backspace goes up, and
the search box still finds a file anywhere in the project. A shot's folder now
lives **inside its scene's folder** (SCENES › the scene › the shot), on the
cloud and on the Local Server alike, and a project made before this change
is offered a one-time **Move shot folders into their scenes…** from the Files
tab. And a level's and an experience's popup have a **Files** section, where
files are added and seen, as a scene's and a shot's already do.

Your words, 2026-10-05: *"levels and experiences dont allow for me to add
files to a them. remember these are folders too"*; *"shot folders should be in
the scene folders so when i press a scene i should see the shot folders in the
scene folder. since inheritably shots have to be a part of a scene"*; *"in the
files table view. everything seems to be in the same level. similar to windows
explorer. i should be able to press into a folder and the table should show
the files/folders in that folder … at the top i should see the breadcrumb path
of where the folder is in etc."*

Written 2026-10-06 against `feat/post-overhaul-edit-versioning` (S4c,
`po/s4c-files-explorer`). Works on both backends, the cloud (Supabase) and the
Local Server, and on the test data. No database migration: the folder table
(0041) already allowed a folder inside a folder, and the file links for levels
and experiences (0043) were already there, waiting for a writer.

**Before you start.** On the test data (the development copy), Salt Hours is
a project from *before* this change: its sixteen shot folders sit under SHOTS,
so the first thing the Files tab shows is the offer. On the cloud, your one
staging project is the same (its four shots are under SHOTS today) — the
offer appears there too, for a project manager (or member, §5 question 6),
the first time the Files tab is opened after the beta has this branch.
Nothing moves until someone presses the button.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open a project in **R.A.B.B.I.T.**, click **Files**, then **Table** | The project folder's own contents only: the folders first (ASSETS, INVOICES, SCENES, SHOTS …), then the files at the root. Above the rows: an up-arrow button, greyed, and the path **Project**. No Location column. |
| 2 | Click the **SCENES** row | The table shows SCENES' contents: one folder per scene. The path reads **Project › SCENES**; the up-arrow is live and its tooltip says *Up to Project (Backspace)*. |
| 3 | Click a scene's folder (**Lighthouse-Dawn** on the test data) | The scene folder's contents: its files, and — once the shot folders have been moved (step 9) — its shot folders. The path reads **Project › SCENES › Lighthouse-Dawn**; **Project** and **SCENES** are buttons. |
| 4 | Press **Backspace** (a row is focused after you click into a folder) | Up one folder, to SCENES, with **Lighthouse-Dawn**'s row focused — where you came from. **Alt+←** does the same; the up-arrow button too. Click **Project** in the path to go straight to the top. |
| 5 | Press **↓** and **↑**, then **Enter** on a folder's name | The focus moves down and up the rows; Enter opens the folder (Enter on a file previews it, as before). **Home** and **End** jump to the first and last row. |
| 6 | Type *board* in the filter box | The table switches to a **search across the whole project**: every file and folder whose name, path or tag matches, with a **Location** column saying where each one is, and a line above the rows — *N matches for “board” across the project* — with **Clear**. |
| 7 | Click **Clear** (or empty the box) | Back in the folder you were in, exactly where you left it. A search that matches nothing says *No files match “…” in this project*. |
| 8 | Click **Columns**, then **Table** again | The Columns view opens on the same folder you were in, and the Table comes back to it: the two views keep one place. A selected file's **Location** in the file window matches the path above the table. |
| 9 | At the top of the Files tab, read the blue notice and click **Move shot folders into their scenes…** | The notice says *16 shot folders still sit under SHOTS: Father-At-The-Tiller, Her-Side, His-Side and 13 more. From now on a shot's folder lives inside its scene's.* The question lists every folder and where it goes (**SHOTS/The-Door → SCENES/Lighthouse-Dawn/The-Door** …), the first eight then *and N more*, and says: *Each folder moves with every file in it; no file is deleted, and only an empty SHOTS folder is removed at the end. A file in Recently deleted keeps its place and still restores. If it stops part way, what has moved stays moved, and you can run it again for the rest.* (On the Local Server the middle sentence reads *A file in Recently deleted moves with its folder.*) |
| 10 | Click **Move shot folders** | A line *Moving Father-At-The-Tiller (1 of 16)…* while it runs, one shot after another in the order the notice names them (on the Local Server, which answers in one go, the line reads *Moving shot folders (1 of 16)…*), then a green notice: *Moved 16 shot folders into their scenes. The empty SHOTS folder is gone.* The offer is gone. Open SCENES › Lighthouse-Dawn: its shot folders are inside it now, with their files. |
| 11 | Open the **Scenes** tab, a scene's popup, then one of its shots' | The scene's **Folder** line reads *SCENES/Lighthouse-Dawn/*; the shot's reads *SCENES/Lighthouse-Dawn/The-Door/*. Before the move the shot's read *SHOTS/The-Door/*: the line says where the folder *is*. Rename the scene: its shot folders' lines follow at once (on the Local Server the directory on disk keeps the old name, as a rename always has there; the Files tab still shows each file in its shot's folder). |
| 12 | Switch the test data to the game variant (add `?fixtures=game` to the address) and open **Levels**, then a level's **View details** | Under Notes, a **Files (1)** section — the same one the scene and shot popups have — with **Add files**, Table and Gallery, the file's download and delete. **Linked counts** now reads *… / 1 file*. |
| 13 | Open **Experiences**, then an experience's **View details** | The same Files section, with its own file. |
| 14 | Click **Add files** in a level's popup and pick a file (on the cloud); on the Local Server the desktop's picker opens | The file appears in the list, and in the Files tab under **LEVELS › the level**. An experience's goes under **EXPERIENCES › the experience**. |
| 15 | Click **New level**, add a file in the form, and **Confirm & create** | The level is created, then its file is added to its own folder (before this, a file picked in the form went nowhere). While that runs the button reads *Creating…*, then *Adding <file> (1 of N)…*, a line says the dialog closes when they are all added, and Cancel, Escape and the backdrop wait; a file that could not be added is named, and the dialog stays open with **Close**. |
| 16 | Open the Files tab's **Help (?)** | *Files* now has *Getting around the table* and *Folders*: the keys, the path, where a shot's folder lives, and the one-time move. *Scenes and shot lists* has a *Folders* line. |

**What the words mean.** The **path** above the table (Project › SCENES ›
Lighthouse-Dawn) is where you are; every crumb but the last is a button. A
**search** is the whole project, not the folder: the Location column exists
only then. **SHOTS** was the folder beside SCENES that held every shot's
folder; from now on it is made only for a shot that has no scene (the
database allows one), and the empty SHOTS folder is removed once nothing is
left in it. The **move** is the one time a folder is re-parented: renaming a
shot moves its folder within the parent it has (as renaming always did),
never across to another.

**What gets recorded.** The move changes where the objects are, on both
buckets on the cloud (a file's body in `rabbit-files` and its preview in
`rabbit-thumbnails`), and on disk on the Local Server, and the rows that say
so — each file's row rewritten the moment its object has been seen at its
new place, so no file is ever left moved with its row saying the old place
for longer than one step. On the cloud, before a shot's first file moves,
the whole shot is checked (a file missing from storage, a file at both
places, a folder already at the destination: the shot is left where it is,
with the reason, and nothing of it moves); if a file's row cannot be
rewritten and cannot even be read back, the file is left where it landed
and the shot says *run it again* — the next run finds it. No file is
deleted, nothing is copied twice: a file that is already at its new place
from an earlier run is counted done, and a file that is at both places is
left alone and named. A file in **Recently deleted** keeps its old place on
the cloud (the app cannot see trashed rows) and still restores; on the Local
Server it moves with its folder, as its file does. On the cloud the move is
refused by the database for anyone who cannot edit the project (a reviewer,
a person with no seat) — rehearsed on the development database and rolled
back.

**Who can do what.** The offer is shown only to someone who can edit the
project (a manager or member — see §5, question 6; on the Local Server,
everyone), and the database refuses the move for anyone else. The Files
section on a level or an experience follows the same rule as a scene's.

**Limits, stated.**
- A folder opens on **one click**. The second click of a habitual
  double-click, and the double-click itself, are ignored for a second after
  the folder opened — longer than any double-click speed the system allows
  — so neither can land on the new folder's rows (a file nobody chose would
  otherwise open in the preview and be logged as read). A fresh click is
  never held. (Windows Explorer opens on a double-click; this follows your
  "press into a folder". Say if you want double-click.)
- On the **Local Server** a shot is checked only as far as the disk allows:
  a file already missing before the move is counted (the result says how
  many) and its record moves with the folder; a clash with a file already at
  the destination is found as the folder is merged, entry by entry in name
  order, and what moved before it stays moved. The cloud checks the whole
  shot before its first file moves.
- The move is **refused on the Local Server while the project folder is
  recorded but cannot be reached** from this computer (a NAS offline, a
  drive unplugged): rows moved without their files would describe a file
  nowhere. That holds even when a folder of the project's name exists under
  this computer's files root (one is made whenever an asset is added
  offline): a shot none of whose files are found there is refused with the
  recorded folder named. A shot whose files are all gone from the project's
  own folder is refused too (none found), never counted missing and moved.
  With no folder recorded and none resolving, only a shot with no file
  records moves (its rows alone).
- Two people (or two tabs) running the move at once are **not locked out of
  each other**. One tab runs one move per project at a time; two tabs, or
  two people, can in a narrow window undo each other's step on one file,
  and only one result would say so. Run it from one place (OUTSTANDING
  S4c-12 names the lock that would close this).
- A shot's file in **your own bucket** (an S3 workspace) is not moved yet:
  its shot folder stays under SHOTS and the result names it. No such
  workspace exists on any environment today.
- A **private project's** files live on the computer that holds them: the
  move runs from that desktop app, and from anywhere else those shots are
  left with the reason.
- A shot folder is **not re-parented while one of its files is missing from
  storage**: the result names the file; delete the dead row and run again.
- On the cloud the bucket's prefixes are by **id**, not by name (as they
  have been since Session 27), so a rename never has to copy objects; the
  folder's path is what the Files tab shows. On the Local Server the
  directories are named by the slug, as before.
- The Columns view does not search (as before); the search is the Table's.

---

## 2. How to check it

Do each step at a large window and again at 1280 by 700. Steps 9 and 10 on
the test data move sixteen folders in memory and come back on reload. On the
cloud, run them on the staging project once the beta has this branch: the
offer names three of its four shot folders and *and 1 more*; the question
lists all four; after **Move shot folders**, the result
should read *Moved 4 shot folders into their scenes. The empty SHOTS folder is
gone.*, the two files you can add to a shot before running it should open
and preview afterwards, and the Files tab's SCENES › each scene should hold
its shot folders. If the result names something left behind, its sentence
says why and a second press runs the rest.

In the desktop app on the Local Server, open a project that has shots with
managed files, run the move, and check the project folder on disk: the
`SHOTS\<shot>` directories are inside `SCENES\<scene>\` now, every file with
them, and `SHOTS\` is gone once it is empty. Then add a file to a level: it
lands in `LEVELS\<level>\`.

---

## 3. The numbers, measured

- **Tests:** 272 test files / 6,591 tests at the start; 277 files / 6,671
  tests at the end of this bundle's code; **279 files / 6,733 tests** after
  the two review rounds, all passing. 112 deliberately broken versions of
  the code were planted — 40 for the build (the keys' page gate, the
  overlay check, the text-field check, folders before files, the search's
  ancestors, the double-click guard, the deep link, the Location column, the
  lazy SHOTS category, the nested path, the pending rule, the rewrite before
  verification, the move-back, both-keys, s3, the directory move, the clash
  check, the SHOTS tidy, the managed-files folder, the level link, the
  create form's upload, the popup's Folder line …) and 36 for each review
  round (the check before the first move, the row rewritten only after the
  object is seen, the put-back only after a successful read-back, the
  re-check before re-parenting, the paged reads, the counted SHOTS, the
  unreachable and the fallback folder, the parent walk, the gc's twin
  question and its fail-closed reads, the double-click window, the
  progress line, the create form's one press …) — and every one was caught
  by a test.
- **The database rehearsal** (wilson-dev, Northwind's two shot folders, a
  rolled-back transaction as its manager): the scene's folder row inserted;
  the object's row renamed to the nested key in both buckets (1 row each,
  at the new key 1, at the old key 0); the files row and the folder row
  rewritten; a person with no seat and a reviewer got 0 rows on every step;
  a member got 1. The nested key's third segment, `scenes`, is not
  money-gated, not a money key and not quota-exempt.
- **Shots:** `docs/sessions/handoffs/img/po-s4c-*-1440x900.png` and
  `…-1280x700.png` — the root with the offer, SCENES, a scene, Backspace, a
  search, the question, the result, the root after, a scene holding its
  shot folders, a shot folder, the shot popup's Folder line, a level's and
  an experience's popup with their Files section, a level's folder in the
  Files tab.

---

## 4. Still not right, and not this session's to change

- **The pet covers the end of the file window's last button** at both sizes
  (OUTSTANDING P1-54, your C5).
- **The Duration header is cut** ("DURATI…") at 1280 (P1-60).
- A shot's file in your own bucket is not moved (S4c-01); the Local Server
  move was replayed on a temp folder, not opened in Electron (S4c-06).
- The storage garbage collector (`storage-gc`) learned to keep a shot's file
  mid-move (its row names the other shape of the key) and to stop, not
  delete, when a database read fails; the Edge Function needs deploying for
  either to hold on staging and prod (S4c-10). Until it is, a move that
  stops between a file's move and its row is a file the collector may
  delete a day later — run the move with the app open and the network up,
  and run it again at once if it stops.
- Two people running the move at once can undo each other's step on one
  file (S4c-12): run it from one place until a lock exists.
- A level or experience made with files picked in its form holds the form
  until every file is added; a multi-gigabyte copy on the Local Server is
  minutes of *Adding … (1 of N)…* (S4c-13).

---

## 5. Questions, when you test

1. **One click or two to open a folder?** It opens on one click now (your
   "press into a folder"), with the double-click's second click ignored.
   Windows Explorer needs a double-click and uses one click to select.
   Keep one click, or go to Explorer's double-click?
2. **The path's shape.** "Project › SCENES › Lighthouse-Dawn", the last crumb
   in the full ink, an up-arrow at its start. Should the project's own name
   stand in for "Project"?
3. **Enter on a file previews it** (as S4a built it); Enter on a folder opens
   it. Keep, or should Enter on a file open its file window instead?
4. **The offer, not a question at open.** The move is a notice on the Files
   tab with its button, never a dialog the moment the project opens. Right,
   or should a manager be asked once on first open?
5. **A shot with no scene.** Its folder stays under SHOTS. Should the app
   stop allowing a shot with no scene, so SHOTS can go for good?
6. **Who may run the move?** The brief said a manager past the project's
   write gate and nobody else. Every policy the move relies on (the folder
   rows, the file rows, both buckets' objects) is `can_write_project`,
   which admits a project **member** too, and the offer follows the same
   gate; a reviewer and a person with no seat are refused. Keep members, or
   restrict it to managers (a gate in the Files tab, and a policy of its own
   for the move)?

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and 1280x700
(every step above), by the tests named in §3, and on the development
database in a rolled-back rehearsal of every database step of the move as
Northwind's manager, a member, a reviewer and a person with no seat. Then
read twice by an adversarial reviewer, the second time attacking the first's
corrections: round one found the move could leave a file no record named
(and the garbage collector would have deleted it a day later), that the
Local Server moved records without their files when the project folder was
unreachable, and that the offer counted the active shot list's shots; round
two found the first fix's unreachable-folder refusal skipped whenever a
folder of the project's name existed on this computer, that the garbage
collector's reads failed open, that renaming a scene on the Local Server
dropped its shots' files to the project root in the Files tab, and that the
double-click guard was shorter than Windows' double-click time. Every finding
of both rounds is fixed and pinned by a test (112 deliberately broken
versions caught in all; the hand-off lists them).

**Not checked:** the Storage API's own move against a real bucket (the
session has no signed-in cloud session; the first real run is staging's, and
§2 says what to look for); the desktop app on the Local Server (the move is
replayed on a temp folder by `desktopShotRefiling.test.js`, not opened on
your screen); the packaged desktop app; a Mac.
