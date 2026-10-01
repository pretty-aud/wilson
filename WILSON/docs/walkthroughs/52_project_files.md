# 52 — FILES: the Files tab, the file window, tags and previews (R.A.B.B.I.T. → FILES, and RESOURCES → FILES)

**What this is.** The project files explorer is no longer read-only. It is
now also a tab in R.A.B.B.I.T., called **Files**, right after Summary. Pick
a file and the panel beside the list becomes its **file window**: its facts,
then a note, the Core switch, its Kind and its tags, all editable, with
**Preview** and the file's own actions at the bottom. A preview opens images,
video, audio, PDFs, Markdown, code and text in a window over the list, and
the arrow keys step to the next file. The Summary's two file lists are gone:
Add files, Relink and File activity live on the Files tab now. And Bins'
keys no longer act from other pages.

Your words, 2026-09-29: *"lets make sure the files page is not read only. i
need to be able to view, download, and edit the files database. so edit
notes, tags, etc. … dont have the cloud silently throw away kind and
description."* Your rulings E1 to E14 are the shape; this is bundle S4a.

Written 2026-09-30 against `feat/post-overhaul-edit-versioning` (S4a,
`po/s4a-files-ui`). Works on both backends, the cloud (Supabase) and the
Local Server. The Resources → Files page is the same explorer and keeps its
project picker; on the R.A.B.B.I.T. tab the picker is hidden, because the
open project is the one shown.

**Before you start.** Tags on the cloud need **migration 0085**, which is
not on any database yet. The commands are in the S4a hand-off under
"Waiting on Audrey", and a copy of the file is in
`Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\`. Without it
everything else here works; the Tags field says *"Tags need a database
update that has not reached this workspace yet."* On the Local Server tags
work now. On the test data (the development copy's fixtures) a preview says
there is nothing to show, because the test files have no contents: use the
desktop app or a cloud project to see previews.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open a project in **R.A.B.B.I.T.** | A **Files** tab right after **Summary**. Help (?) and Settings (gear) are still the last two icons at the right end of the bar. |
| 2 | Click **Files** | The explorer for this project, in Columns view: no project picker. On the right of the toolbar: the filter (*Filter by name, path or tag*), Refresh, the count line (*N folders · M files · title*), **File activity** and **Add files**. |
| 3 | Click **Table** | Every folder and file in one flat table, as before (E7 kept it as shipped). **No panel on the right** while nothing is selected: the table has the full width. |
| 4 | Click a file's **name** | The file window opens on the right: **Details** with a close ×, the eight facts (Name, Type, Size, Created, Modified, Duration, Location, Stored), then **Notes**, **Core project file**, **Kind** and **Tags**, and at the bottom **Preview** with the file's own actions. The name is a button, so Tab reaches it too. |
| 5 | Type in **Notes**, then click elsewhere | The note is saved when you leave the box. Type again and press **Escape** instead: the old note comes back. |
| 6 | Turn **Core project file** on | Saved at once. The sentence under it is your definition: the files that give context about the project (the script, the treatment, storyboards, mood boards), which Intake and D.O.G. read. |
| 7 | Pick a **Kind** | Saved at once. Kind is what the document is (script, treatment, deck …), from the same list Intake uses. |
| 8 | Click two **tags**, then one of them again | Each tag lights up as it is added and goes dark when you click it again; a file can carry several. **Finance** cannot be clicked: it is on when the file was added as a money file. **Legal** carries the line *"Legal is not restricted yet: anyone who can open the file can still see it."* |
| 9 | Type a tag's name (for example *creative*) in the filter | The list narrows to files with that tag, beside the names and paths that match. |
| 10 | Click **File activity** | The selected file's history in a side panel: uploaded, moved, relinked, downloaded, trashed, restored. |
| 11 | **Double-click** a file, or press **Enter** on its name, or click **Preview** | The preview opens over the list: the file's name and *"3 of 12 · Document · PDF · 2 MB"* at the top, the previous and next arrows on the left, the file's actions on the right. An image is drawn whole, a video and audio wait for you to press play, a PDF opens in the viewer, Markdown is drawn as a page, code is coloured, text is shown as typed. |
| 12 | Press **→**, then **←** | The next file, then back: the same files, in the same order, as the list you were looking at. **Esc** closes the preview. |
| 13 | Preview an **.html** or **.svg** file | Its text, never the page itself. |
| 14 | Preview a **Photoshop** (.psd) file | *"No preview available"* and *"WILSON cannot draw this image format here. Open it in its own app."*, with the file's action under it. |
| 15 | On the cloud, click **Download** in the file window | The browser saves a copy under the file's own name. |
| 16 | In the desktop app, on a file stored on this computer, click **Show in folder**, then the arrow-out icon beside it (**Open in default app**) | File Explorer opens with the file selected; then the file opens in the program Windows uses for it. A program or script is refused: *"WILSON does not open programs or scripts. Use Show in folder to see it."* |
| 17 | Open **Summary** | No file list any more. The Control panel's **Files & storage** keeps the project folder and says *"The project's files are in the Files tab: add files, relink missing ones and see each file's activity there."* |
| 18 | In **Bins**, select a file. Open **D.O.G.**, click an empty part of the page and press **Delete**. Go back to Bins | The file is still there and still selected. Bins' keys only act while R.A.B.B.I.T. is on screen. |
| 19 | In Bins with a file selected, open R.A.B.B.I.T.'s settings (the gear) and press **Escape** | The settings panel closes; the selection stays. Before this, Escape cleared the selection and the panel stayed open, and Delete on one of its buttons removed the selected files behind it. |

**What the words mean.** **Kind** is the document's sub-type, from Intake's
list. **Tags** are the folder-like categories: Production, Creative, Legal,
Finance, Reference, Assets, Code, Shots and Documentation. **Core project
file** is the flag Intake and D.O.G. already read as the project's context.
A file that belongs to an asset, a shot or a scene in the desktop app takes
notes and tags; Core and Kind are for the project's own files, and the
window says *"Core files are project files; add it to the project to mark it
core."*

**What gets recorded.** Each edit to a note, the Core flag, the Kind or the
tags is kept in the file's edit history, as edits already were. Opening a
preview is recorded in File activity as one *Downloaded*. On the cloud that
is once per file per session. On the Local Server it is once per file per
minute, so a video's many small reads count once.

**Who can edit.** Anyone who can edit the project. Someone who cannot sees
the window read-only, with the reason above the fields. Only someone who can see the
project's money (a workspace admin, or the project's manager) can set Legal,
so it is already in the right hands when Legal starts to hide files (S4b,
after your ruling). Google Drive files are read-only here, as before.

**Limits, stated.**
- **No 3D viewer** (E6): an FBX or OBJ says *"There is no 3D preview yet.
  Download the file to open it."*
- A text, Markdown or code file over **2 MB** is not read; it says so, with
  Download.
- Files stored in **your own bucket** have no preview yet; they offer
  Download.
- The preview is the largest window the kit has (960 wide), not a
  full-screen lightbox. A full-window one is a kit request.
- Add files on the Files tab still files into the project's root (E1), not
  into the folder you are looking at, and it does not guess the Kind.
- The file window has **no Delete**. Deleting a file stays on the Projects
  page and in each asset's, shot's or scene's own files panel.

---

## 2. How to check it

Do each step at a large window and again at 1280 by 700. In the desktop app,
use a project with a few kinds of file (a picture, a short video, a PDF, a
Markdown or text file). Steps 11 to 16 need real files, so use the desktop
app or a cloud project, not the test data.

---

## 3. The numbers, measured

- **Tests:** 214 test files / 5,148 tests at the start; 221 files / 5,270
  tests now, all passing. 73 deliberately broken versions of the code
  were planted, and every one that changes what the app does was caught;
  the 3 that change nothing a person could see are named in the
  hand-off. The migration's own checks caught 3 broken versions of it.
- **The R.A.B.B.I.T. bar with twelve tabs** (`scripts/tool-strip-probe.mjs
  5277 --check`, before and after): Help and Settings sit at the same
  pixels as before at every size, the gear's right edge 24px in from the
  window's. With a game project open (all twelve tabs), the tab list is
  wider than the bar at the three narrowest desktop windows, 935, 853 and
  711 pixels wide (zoomed in), by 83, 165 and 307px, against 37, 119 and
  261px with eleven. The last tabs scroll out of view there, as they
  already did. Shots:
  `po-s4a-fixtures-strip-before-rabbit-*.png` and `…-after-…`.
- **Previews in the desktop app** (Electron 33, a real Local Server, nine
  kinds of file at both sizes): every kind drew, video and audio did not
  start on their own, and each file opened twice recorded exactly one
  *Downloaded* (the Photoshop file none, since nothing was read). Shots:
  `po-s4a-localserver-preview-*.png`.
- **Bins' keys** (the test data, both sizes): on D.O.G. with a Bins file
  selected, Delete, Backspace, S, 1 and Enter did nothing. Back in Bins
  there were still 12 files with the same one selected. The same Delete on
  R.A.B.B.I.T. removed it (11). Shots: `po-s4a-fixtures-bins-gate-*.png`.

---

## 4. Still not right, and not this session's to change

- **The pet covers the end of the file window's last button** at both
  sizes (OUTSTANDING P1-54, your C5).
- **The Duration header is cut** ("DURATI…") at 1280 and 1440, and more
  with the file window open (P1-60, waiting on walkthrough 44 Q27/Q28).
- **The PDF viewer's own toolbar shows a code instead of the file's name**
  in the desktop app; the preview's title above it has the name (S4a-03).

---

## 5. Questions, when you test

1. **Legal's audience (E4a), which S4b waits on.** Who should NOT see a file
   tagged Legal? The setter rule already matches the people who see the
   money (workspace admins and the project's managers). Recommended: the
   same people see Legal files, so one rule governs both. Or name another
   group.
2. **Delete in the file window?** It has none today; deleting stays on the
   Projects page and in each asset's, shot's or scene's files. Add a Delete
   (with its question) at the bottom of the file window, or keep it out?
3. **Should Add files guess the Kind from the file's name**, as Intake does
   (this continues walkthrough 47's question 135)? Today a file added on the
   Files tab has no Kind until you pick one.
4. **The preview's size.** Is the 960-wide window enough for video and PDFs,
   or is the full-window lightbox worth asking the kit for now?
5. **Walkthrough 47's question 58, again:** with File activity and Add files
   now on the right of the Files tab's toolbar, is the Table / Columns
   switch easy to find, and does Refresh read as a command?

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and
1280x700, and in the desktop app (the development build, not the packaged
one) against a real Local Server for every preview kind, Show in folder and
Open in default app's refusals, and the stream's range reads. The migration
was proven on the development database in a run that was rolled back (24 of
24 checks) and by the automated checks on GitHub.

**Not checked:** a cloud project's previews against real storage (the code
uses the same signed address the downloads already use); the packaged
desktop app; Google Drive files in the file window; a Mac.
