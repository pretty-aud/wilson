# 84 — NIGHT 3: ONE WALKTHROUGH, A SECTION PER SESSION

Night 3 of `docs/sessions/PLAN_TO_1_0.md` ran its sessions side by side, and
each writes its own section here (the plan's §5, rule 3: one walkthrough a
night). Read the section of the work you are testing; each numbers its own
questions.

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
   project started in D.O.G. keeps its dates; a cleared date or frame rate
   arrives empty or at the cloud's default instead of refusing the project.
2. **Its key dates go up** (the Timeline's diamonds), after its phases. One in
   this computer's **Recently deleted key dates** is not carried, and the
   report says so; one removed in the cloud since an earlier run stays removed.
   One whose phase you deleted here arrives without a phase, counted: *1 key
   date on a phase removed on this computer… arrives without it*.
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
   earlier run, this computer's edit cannot take that place, so it stays (with
   the edits after it), counted: *N edits not carried: their place in the shot
   list's one chain of edits is an edit made in the cloud since…*.
5. **Its folders go up, and each file lands in its folder.** The Files tab's
   tree in the browser is the desktop's: ASSETS with a folder per asset,
   SCENES, SHOTS, INVOICES, and each file in the folder you saw it in on this
   computer (an asset's file in the asset's folder). A file at the project's
   top stays at the top, as do invoices (see Q1). A file linked to a task,
   asset or phase you deleted here arrives without that link, counted: *N
   links of a file to a row removed on this computer… let go*.
6. **What stays is named before you can clear anything, part 2's apart.**
   Under the report: *Stays on this computer for now (part 2 of the migration
   carries it): …budget lines, …levels…* and *Stays on this computer (the
   migration does not carry it): …asset versions, …files kept with assets,
   scenes, shots, levels and experiences on this computer…*. Archive and
   clear local keeps all of it in the archive file.
7. **Running it again changes nothing that is there.** Every row already in
   the cloud is skipped, one in its trash included until the trash is emptied
   after 30 days; a row a teammate removed from the cloud for good comes back
   — a scene, shot, bin, clip, take, folder, saved view, grouping, or an item
   of a list or a task, the kinds with no trash (stopping that is part 2's).
   Migrate's hover when it is done says it, and Help's paragraph too.

### Step by step

| # | Do | You see |
|---|---|---|
| 1 | **Dry-run** | Per project, in the log: the bins' lines as before, then *N shot lists with M items and K edits*, the archived ones named, *"Shot list 1 · v1" will be the active shot list in the cloud, if none is active there*, *N files filed in their folders, as on this computer*, and the bid version and project folder lines where they apply. Nothing is written. |
| 2 | The report | Six new rows in the order things move: **key dates** after phases, **comments** after the links, **shot lists**, **items on shot lists** and **edits** after shots, **folders**, then **files** (`po-m1-after-migrate-report-rows-1280x800`; the panel's new description is `po-m1-after-migrate-panel-1280x800`, both in `docs/sessions/handoffs/img/`, taken in the browser tester, where there is no desktop to read, so the counts are 0 there). Under the table, one line each for what did not move and why, and the not-carried sentence in its two parts. |
| 3 | Answer the footage question as before, then **Migrate** | The same lines, now in the past tense: *"Shot list 1 · v1" is the active shot list in the cloud*, *N files filed in their folders*. When nothing failed: Migrate's hover reads *Done. Running it again skips every row already in the cloud…*, and **Archive and clear local** appears; its hover names part 2. |
| 4 | Open the project in the browser (the beta) | **Timeline**: the key dates. **Scenes**: the lists in the list picker, the active one selected, the archived one among the archived lists; its edits in the edit picker. **Files**: the folder tree, each file in its folder. **Bins** as before. |
| 5 | **Dry-run** again | Key dates, shot lists, items on shot lists, edits and folders count as *Skipped*, nothing under *Would insert*; no *files filed* line. Comments, like phases, assets and tasks, count in **Total** only: a comment has no project to read the cloud by, so the real run skips each one by its id instead. |

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
