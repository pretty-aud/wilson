# 58 — BINS IN THE BROWSER, and a desktop project's bins moving to the cloud (R.A.B.B.I.T. → BINS; App settings → Storage → Migrate to cloud)

1. **The footage never moves.** A cloud clip is a footage LOCATION (the
   company's share, saved once by its network address, `\\server\footage`,
   and named) plus a path inside it; WILSON records where the file is and
   reads it from there on a computer that can reach it. Nothing uploads,
   nothing costs footage storage (B1, B2).
2. **A clip's small picture goes to the cloud only while the company's admin
   has turned "Allow files to be viewed from outside the office network" on**
   (B4, B5a). The database refuses the upload while it is off; the client
   asks the switch first so a person reads a sentence, not a storage error.
   A teammate on the office network makes their own picture from the file.
3. **Reviewers may do everything members may in bins** (B6): the gate for all
   four tables is `can_edit_shot_lists()`, and `project.bins.write` in the
   client matrix mirrors it. Removing a clip or a bin removes rows, never a
   byte on the server (B10), and the undo puts the rows and their takes back.

**What this is.** Two things. First, the Bins tab in a **browser** (the beta,
or anyone who prefers the web app): your ruling B5 — until the file gateway
exists, the browser shows the **catalogue**. Every bin and clip is there with
its picture where the company allows one, its logging, its marks and its
takes; you log, flag, colour, circle, assign takes (from a clip, or from a
shot on the Scenes tab), move, copy and remove, with Undo; a change made in
the browser shows up on every desktop and vice versa. Adding clips and
playing them need the desktop app on a computer that can reach the footage,
and the tab says so once, at the top. Second, **a desktop project moving to
the cloud brings its bins** (your B9): App settings → Storage → Migrate to
cloud now carries the scenes and shots, the bins, every clip's logging and
marks, the takes, and the pictures while the switch is on — and asks, once
for each folder the clips were added from, *Which footage location is
this?*

Written 2026-10-09 against `feat/post-overhaul-edit-versioning` (BC3,
`po/bc3-bins-web`). No database migration: BC1's 0091 holds everything. The
desktop app signed in (BC2) and the signed-out desktop (B12) are unchanged.

## 1. Step by step

**A. The catalogue, in a browser** (the beta signed in, or the development
copy on port 5286 with `?bins=browser` on the address, which makes the test
data answer as the cloud does in a browser)

| # | Do | You should see |
|---|----|----------------|
| 1 | **R.A.B.B.I.T. → a project → Bins** | Every bin in the rail, every clip in the frame view with its picture (where the switch was on when it was uploaded; otherwise the kind's icon, never a broken image), and ONE notice at the top: *This is the catalogue: every bin and clip, with its picture where the company allows one, its logging, its marks and its takes. Adding clips and playing them need the desktop app on a computer that can reach the footage.* Its × puts it away for the session. The toolbar's button is **New bin**, not Add. No clip is greyed out. (`po-bc3-01-bins-catalogue-notice`) |
| 2 | Click a clip | The inspector: the picture, *Not on this computer*, then *A browser cannot read "Footage NAS", so the clip cannot be played here; open the project in the desktop app on a computer that reaches the share to play it. It can still be logged, flagged and assigned to a shot.* and *Space shows the picture large.* Below, the marks, the colours, **Used in shots**, every logging field editable, and the File section with its location, its path inside it and who added it. No Open, no Reveal, no "read the columns again": the browser has no OS and no decoder to offer them with. (`po-bc3-02-bins-inspector-not-on-this-computer`) |
| 3 | Press **Space** | The picture, large, over the files pane, with the clip's name, its marks, its slate line, and *Space or Esc closes · arrows move · S, R, U mark*. Press **↓**: the next clip's picture. Press **S**: it is selected (the mark appears in the header). **Esc** closes the picture and keeps the clip selected; a second **Esc** clears the selection. (`po-bc3-03-bins-picture-large-space`) |
| 4 | Move the mouse across a tile | Nothing scrubs (there is nothing to scrub from); the tile keeps its picture. |
| 5 | Right-click a clip | Select, Reject, Unflag, Circle, Assign to shot…, the colours, Move to, Copy to, Rename, Remove — and no *Open in default app*, no *Reveal in Explorer*, no *Read columns again*. (`po-bc3-05-bins-file-menu-no-open`) |
| 6 | Drag a file from your computer onto the page | Nothing lights up as a target, and the notice bar says once: *Adding clips needs the desktop app on a computer that can reach the footage.* Nothing is read. |
| 7 | Switch to the **list view** (the ≡ button) | The same rows and columns as on the desktop; no row is dimmed. (`po-bc3-08-bins-list-view`) |
| 8 | In an empty project (no bins) | *No bins yet*: *A bin lists clips where they sit on the company's footage locations. Start from a set here; clips are added from the desktop app on a computer that reaches the footage.* The starter sets and **Empty bin** work; there is no *Import a folder…*. |

**B. Logging, flags, takes, remove — for everyone, live**

| # | Do | You should see |
|---|----|----------------|
| 9 | With a clip selected, press **S** (or click **Select** in the selection bar) | The green check on the tile; on a desktop that has the project open, the same check appears without a reload (B7). **R** rejects, **U** unflags, **C** circles, **1–8** colour, **0** clears the colour. (`po-bc3-04-bins-select-mark-s`) |
| 10 | Type a slate, a take, a camera, a note in the inspector | Saved on the way out of the field; mixed values across a selection read *mixed* and typing sets them all. |
| 11 | Press **A** (or **Assign to shot** in the selection bar) | The assign dialog, scenes and shots as on the desktop; tick a shot, **Assign**; the clip's **Used in shots** names it, and the Scenes tab's shot shows the take. *Ctrl+Z* undoes it. (`po-bc3-06-bins-assign-to-shot`) |
| 12 | **Scenes → Shots**, a shot's **View details** | The shot's takes, each with its picture, its role and its note, and **Add takes…** — a take's clip reads *not on this computer* (never *offline*: that word is the signed-out desktop's). Reviewers may assign takes here too (B6). (`po-bc3-09-scenes-takes-in-browser`) |
| 13 | Select a clip, press **Delete** | Removed from the bin (nothing on the server is touched, B10); the toast offers **Undo**, which puts it back with its takes. More than five at once asks first. (`po-bc3-07-bins-remove-undo-toast`) |
| 14 | Right-click a bin → **Delete bin…** with clips in it | The same question as on the desktop: move them to another bin, or remove them (undo restores them). |
| 15 | Sign in as a **reviewer** | Everything above works the same (B6: *Reviewers same as members*); someone with no seat on a staffed project reads the gate's reason on New bin and sees no logging controls. |

**C. A desktop project's bins move to the cloud** (the desktop app, signed in
to the company; the project's bins were made with nobody signed in)

| # | Do | You should see |
|---|----|----------------|
| 16 | **App settings → Storage → Migrate to cloud → Dry-run** | The log counts, per project, *N bins, M clips in K footage roots, T takes* and, for each root, *\\server\share\Day01: 6 clips — which footage location is this? (not named yet)*; the dry-run report's table has rows for scenes, shots, bins, footage locations, clips, takes and pictures. Nothing is written. Under the report, **Footage locations**, *0 of K answered*, and ONE question per root: *Which footage location is this?*, the folder in mono, *N clips in M projects · a share on the network* or *· a folder on this computer: give its address as the network sees it*. **Migrate** stays off and says why on hover. (`po-bc3-11-migrate-dry-run-question`) |
| 17 | A root on a network share | Its address field starts from the company's location that already holds it (matched by address, any spelling) — that counts as answered — or from the share itself with a suggested name as a NEW location, which does not: *Suggested: A new location "Footage" at \\nas\footage: 14 clips at its top. Use this address, or type another.* with a **Use this address** button (a new company location is made only from an address you confirmed, never from a project file alone). Under the field, in words, what will happen: *The company's "Footage NAS" (\\nas\footage): 6 clips at Day01/…* |
| 18 | A root that is a drive letter (`D:\Set photos`) | Its field starts empty (a drive letter is this computer's alone; the cloud refuses it as an address, B2). Type the folder's network address — `smb://nas/set photos/` or `\\nas\set photos`, any way you have it — and it is tidied to the one shape the cloud stores; a name field appears for a new location; the sentence under it says where the clips will land. A drive letter typed as the address is refused before the run with the cloud's own sentence. (`po-bc3-12-migrate-answers`) |
| 19 | **Leave on this computer for now** on a root | Its clips stay on this computer, listed in the report; the root counts as answered, so Migrate lights up once every root is. **Name it** takes you back to the field. (`po-bc3-13-migrate-leave-for-now`) |
| 20 | **Migrate** | The log: *Footage location "…" (\\…) named* for each new one, *Pictures: n of m* while the switch is on, then *7 bins, 16 clips and 9 takes in the cloud; 2 clips left on this computer: name their footage location and run the migration again*. The report table counts every table; under it the clips left behind, by name and folder (and their takes, which wait with them), and *N pictures: pictures stay on this computer: the company has not allowed files to be viewed from outside the office network…* when the switch is off. While anything is left on this computer there is NO **Archive and clear local** (it would delete the only copy); Migrate stays on and says *N clips are still on this computer: name their footage location below and Migrate again*, and the question stays under it. (`po-bc3-14-migrate-report`, `po-bc3-15-migrate-report-table`) |
| 21 | Open the project in the cloud (the desktop app signed in, or a browser) | The bins as they were, nested as they were; every clip under its location at the path it had inside the folder you named (its id kept, so the desktop's own project folders and the cloud agree); every take on its shot (a shot whose primary take stayed behind takes its first landed take as primary); the pictures where the switch was on. On a desktop that reaches the share, each clip plays from it. |
| 22 | Name the root you left for now, **Migrate** again | Its clips arrive, with their takes. Every row already there is skipped, no second location is made (a location you named is the company's now, matched by address), and a picture the first run could not make — the clip was not reachable then — is uploaded now. The desktop's own project file is never modified by the migration. Once nothing is left, Migrate reads *Done* and **Archive and clear local** appears. |
| 23 | **Dry-run** after a teammate removed a clip in the cloud | The dry run's *Would insert* column counts it again: a second run brings back a row removed from the cloud since the first (the runner has always worked by id, for every table; Help says so). Remove it again in the cloud, or archive and clear the desktop's copy once everything is there. |

## 2. How to check it

- The tests: `npx vitest run src/tools/rabbit_v0.1.0/views/bins src/cloud/migrate src/dev/fixtures src/tools/rabbit_v0.1.0/rabbitBinsHelp.test.jsx` — among them `binsViewBrowser.test.jsx` (the catalogue: the notice, New bin, no control without its verb, no dim, the inspector's sentence, Space, the keys, the drop, the empty states, a shot's takes' word, the launch entry), `binsViewCloud.test.jsx` (BC2's, with the browser's Add pin rewritten), `binsBrowserVariant.test.js` (`?bins=browser`), `binsMigration.test.js` (the roots, the question's answers, the cloud row, bins parents first), `runMigrationBins.test.js` (the dry run and the real run on the fixtures' Salt Hours in the desktop's shape and on a bundle shaped like your projects; a second run; what cannot land is said), `migrationPanelBins.test.jsx` (the question in the panel), `rabbitBinsHelp.test.jsx` (Help quotes the controls' words).
- The development copy (port 5286, the test data): `/rabbit?bins=browser` shows the catalogue as a browser gets it (every clip *not on this computer*); `/rabbit` alone shows the test data answering for every clip (the inspector then reads *Playing a clip needs the desktop app on a computer that can reach the footage.* with no Open button).
- The real thing: the beta signed in as a smoke user, a project with bins made on a desktop signed in to the same company (BC2's walkthrough 57 makes one); and the desktop app signed in, with a project whose bins were made signed out, through Migrate to cloud. §5's checklist.

## 3. What was rehearsed, and how

- **The browser's Bins**, every step of §1 A and B except 8, 10, 14 and 15,
  on the test data with `?bins=browser` (the fixtures answer the capability
  object as the cloud does in a browser: no picking, no bytes, no row
  reachable), in Playwright's Chromium at 1440x900 and 1280x700
  (`scripts/bins-browser-shots.mjs`; the pictures are
  `docs/sessions/handoffs/img/po-bc3-01` to `-10`). Steps 8, 10, 14 and 15
  are pinned by the tests.
- **The move**, §1 C: the same page, with the desktop's three routes (the
  project list, the project's bundle, a clip's picture) and the cloud's REST
  and storage answered **inside the page** by Playwright — a stub, not
  wilson-dev. The bundle is the test data's Salt Hours turned back into the
  signed-out desktop's shape: 7 bins (three nested under Footage), 16 clips
  including a frame sequence, 9 takes on shots, the footage and the plates
  on `\\salthours-nas\footage`, the two stills on `D:\Set photos`. The dry
  run asked both roots; the run named two locations and sent 57 inserts and
  14 pictures to the stub (`po-bc3-11` to `-15`). The runner's own tests
  cover the second run and every refusal.
- **Not run signed in to wilson-dev or the beta.** The smoke users' password
  is a GitHub secret (BC2 §4 says why), so the browser's own run on the real
  cloud and a real move into the company are yours (§5). The desktop app
  (Electron) was not launched: the migration's source was the stubbed
  routes, which answer exactly what the desktop's own routes answer.

## 4. Still not right, and not this session's to change

- **The migration carries no shot lists, list items, edits or folders.** It
  never did (S3a noted it carried no scenes or shots either; BC3 added
  those, since a take needs its shot). A migrated project shows every scene
  and shot with no active list (D10); its edits and its project folders are
  not copied. Named in `docs/OUTSTANDING.md`.
- **A clip whose root nobody names cannot be given "an empty location"**: the
  cloud's `bin_files.location_id` is NOT NULL (0091). So such a clip stays on
  this computer, listed, and a later run brings it — the nearest honest thing
  to the brief's "migrated with its location left empty". Making the column
  nullable is a migration (0093 at the earliest) and a change to every
  reader; not taken.
- **A second run brings back a row a teammate removed from the cloud since
  the first.** The runner works by id — a row already there is skipped, a
  row not there is inserted — for every table, and always has; BC3 made
  the dry run count what would come back and Help say it. Remembering what
  a run carried (per computer) is the fix; named in `docs/OUTSTANDING.md`.
- **The cloud keeps no sample rate or channel count on a clip** (0091 has no
  column): the desktop reads them, the migration cannot carry them, and the
  inspector's Audio line is empty in the cloud. Named in `docs/OUTSTANDING.md`.
- **Every tile signs its own picture** (one request per clip on a grid, no
  batching): fine for a project's bins, slow for thousands of clips in
  "All files". A batched signing is the fix; a known limit in the hand-off.
- **Live updates reach the browser as the cloud broadcasts them** (B7):
  `bins`, `bin_files` and `shot_takes`; a location renamed by a teammate is
  read again on the next load or add (`bin_locations` is not broadcast, BC1).
- **A picture is signed per read and kept 50 minutes**; a copy made while the
  switch was off shows its original's picture (BC1's known limit).
- **Playing in a browser is the gateway's** (BC4): the preview panel's seam,
  the poster → stream hand-over and the words to replace are in the hand-off.

## 5. Questions, when you test

1. **One notice, dismissable for the session**, at the top of the tab, in
   place of a greyed Add, a dead preview and a count of clips *not on this
   computer* that would be all of them. Right? (Or should it stay until the
   gateway exists, undismissable?)
2. **New bin stands where Add stood** in a browser: one control that does
   what it says, rather than an Add menu of two disabled picks. Keep?
3. **No dim in a browser.** On the desktop a clip this computer cannot reach
   is dimmed; in a browser every clip would be, and a whole catalogue in the
   disabled ink reads as a tab that does not work. Each clip keeps its mark
   and the inspector its sentence. Keep, or dim them all as the desktop
   does?
4. **Space shows the picture large** where nothing can play, and the arrows
   move under it so a review runs on the keyboard without a player. Is
   large-on-Space the right key, or would you rather Enter (which renames
   today)?
5. **The browser's sentence** under a clip: *A browser cannot read "Footage
   NAS", so the clip cannot be played here; open the project in the desktop
   app on a computer that reaches the share to play it.* — rather than the
   desktop's *is not reachable from this computer*, which would counsel a
   folder question no browser can answer. Keep the wording?
6. **The migration's question is per folder the clips were added from**
   (the desktop's known roots), not per clip and not per share. A share
   added from three folders asks three times, each pre-filled with the same
   location; a drive letter asks for its address on the network. Right
   grain?
7. **A root left unnamed leaves its clips here, listed**, rather than
   refusing the whole run or inventing an address. Keep?
8. **Pictures upload during the migration only while the switch is on**, and
   the report says so when it is off; a clip the desktop cannot reach at
   migration time gets its picture on a later run (or from a desktop that
   reaches it). Keep?
9. **A typed address inside one of the company's locations IS that
   location** (`\\nas\footage\dailies` typed for a drive letter lands the
   clips under "Footage NAS" at `dailies/…`), and an address that is one of
   the company's exactly wins over a deeper one. Keep?
10. **A new company location is made only from an address you confirmed**
    (review round 1, security): a share WILSON suggests from the project
    file waits for **Use this address** or a typed address, while a root
    already under one of the company's locations counts as answered by
    itself. One more click per new share, so that no project file can name
    a location by itself. Keep, or let the suggestion count?

## What was checked, and what was not

Checked: §1 A and B steps 1–7, 9, 11–13 and §1 C steps 16–20 at 1440x900
and 1280x700 on the test data (screenshots `docs/sessions/handoffs/img/po-bc3-*`),
the migration's writes against a stub inside the page (§3); the tests in §2;
the full suite (`npx vitest run`: the counts are in the hand-off). Not
checked: the beta or the desktop app signed in to wilson-dev (§3), a real
move into a real company, a second person's screen updating live, a Mac, a
slow link.
