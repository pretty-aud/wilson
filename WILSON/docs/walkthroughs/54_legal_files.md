# 54 — LEGAL FILES: a Legal file is seen only by the people who see the money (R.A.B.B.I.T. → FILES)

**What this is.** A project manager or a workspace admin can now add files
**as Legal**. A Legal file goes into the project's **LEGAL** folder, and only
the people who can see the project's money see it: workspace admins and the
project's managers. Project members, reviewers and workspace managers who
hold only a member seat on the project do not see the file, its name, its
note, its activity or its contents, and are not shown the button. Legal is
chosen when the file is added and stays with it; it is no longer a tag you
can tick.

Your words, 2026-10-01: who sees a Legal file — *"same as money files for
now"*; and Legal only when the file is added — *"thats fine. yes that makes
sense that its just the folder that is locked."* This is bundle S4b.

Written 2026-10-01 against `feat/post-overhaul-edit-versioning` (S4b,
`po/s4b-legal-gate`). Works on both backends. On the cloud the database
enforces it. On the Local Server there are no roles, so there Legal is a
folder you can lock on the drive or NAS yourself, and the app says so.

**Before you start.** On the cloud this needs **migration 0085** (tags, from
S4a) and then **migration 0088** (the Legal gate), in that order. Neither
is on any database yet. The commands are in the S4b hand-off under "Waiting
on Audrey", and copies of both files are in
`Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\`. Until 0088
is applied, **Add as Legal** is there for managers but greyed, and pointing
at it says *"Legal files need a database update (migration 0088) that has
not reached this workspace yet."* On the test data (the development copy's
fixtures) everything below can be seen except the upload itself, which the
test data refuses. To see a project as a member there, open
`/rabbit?fixtures=member`.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | As a **workspace admin** or the project's **manager**, open a project in **R.A.B.B.I.T.** and click **Files** | On the right of the toolbar: **File activity**, then **Add as Legal** (a padlock), then **Add files** (orange). Pointing at Add as Legal says *"Only project managers and workspace admins will see these files."* |
| 2 | Click **Add as Legal** | Your computer's file picker, exactly as Add files opens it. Cancel it: nothing else happens. |
| 3 | Pick two files | A small window: *"Add these 2 files as Legal?"*, the two file names, *"Only project managers and workspace admins will see these files."* and *"Legal is chosen when a file is added. To change it later, add the file again."* Buttons: **Cancel** and **Add 2 as Legal**. One file says *"Add this file as Legal?"* and **Add as Legal**; more than five list five names and *"and N more"*. |
| 4 | Click **Add 2 as Legal** | The window closes, the button says *Adding…*, and the files appear in a **LEGAL** folder in the project's top level. If the database refuses (say you are not a manager after all), the reason shows in the red line above the files, as for Add files. |
| 5 | Open **LEGAL** and click one of the files | Its file window. Under **Tags** the **Legal** chip is lit and cannot be clicked, with *"Added as Legal. To change this, add the file again. Only project managers and workspace admins can see this file."* **Core project file** is off and cannot be turned on: *"A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads."* Notes, Kind and the other tags work as on any file. |
| 6 | Click the **Legal** chip on any other file | Nothing: no file can become Legal after it is added. (Finance cannot be clicked either, as before.) |
| 7 | Sign in as a **project member** or **reviewer** of the same project (or a workspace manager who is only a member on it) and open **Files** | No **Add as Legal** button. No **LEGAL** folder. The Legal files are not in the list, the count line does not count them, and the filter cannot find them. File activity, the project's edit history and D.O.G.'s project files do not mention them. |
| 8 | Still as the member, add an ordinary file with **Add files** | It works as before. |
| 9 | As the manager, open **RESOURCES → PROJECTS** and pick the same project | The Legal files are in its file list beside the others, their **Core** box greyed (pointing at it gives the reason). The bin at the end of a row deletes the file. A member sees no Legal file here either. |
| 10 | On the **Local Server** (the desktop app storing on this computer or a NAS), do steps 1 to 5 | The same button for everyone (the Local Server has no roles). Pointing at it, and the window in place of who will see the files, says: *"On this computer's storage Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself."* The files land in a real **LEGAL** folder inside the project folder, beside **INVOICES**. The file window says the same line under Tags. |

**Who can add a Legal file.** Exactly the people who can see the project's
money: a workspace admin, or someone whose seat on the project is manager.
The cloud's database checks this itself, so a member who found a way to
send the request anyway is refused and nothing is stored.

**Where a Legal file is kept.** On the cloud, always in Petal's storage,
even on a workspace that keeps its other files in its own bucket or on a
NAS, for the same reason invoices are: the lock is a rule in the database,
and a bucket or a NAS cannot know who is a project manager. Like an
invoice, a Legal file of up to 25 MB does not count against the workspace's
Petal storage allowance; a larger one counts like any other file.

**What you will no longer see as a member.** These used to show an invoice
to people who could not open it, and now show neither an invoice nor a
Legal file to them: the live updates another member's window receives, the
edit history a workspace manager could read, and trashing or restoring a
file by its id. A manager's second window now sees a new invoice or Legal
file on its next refresh rather than at once.

**Where a Legal file is deleted.** On RESOURCES → PROJECTS, where workspace
admins and the project's managers see Legal files beside the others, with
the Core box locked (members do not see them there either).

**Moving a desktop project to the cloud** (Settings, the migration): Legal
files go to the cloud's locked LEGAL folder, and invoices to its INVOICES
folder. If the cloud database is not ready for Legal files (0088), they stay
on this computer and the report says why. A file the computer cannot read
now counts as failed, never as "skipped".

**Limits, stated.**
- **Legal cannot be taken off, or put on later.** To make a Legal file
  ordinary, add it again with Add files and delete the Legal copy on
  RESOURCES → PROJECTS, where managers and admins see Legal files with
  their Core box locked; the database refuses moving a file into or out of
  LEGAL, for everyone.
- **A Legal file is never Core**, so Intake and D.O.G. never read it.
- **The Local Server cannot hide anything from anyone** who can open the
  project folder; lock the LEGAL folder with the drive's or NAS's own
  permissions.
- **Add as Legal is on the Files tab only.** The Resources → Files page has
  no Add files either (it moved to the tab with your E1), because both add
  to the project open in R.A.B.B.I.T.
- **When a Legal file is deleted for good**, its deletion record is shown
  only to managers and admins, unlike an invoice's, which every project
  member sees (question 1 below).

---

## 2. How to check it

Do steps 1 to 9 at a large window and again at 1280 by 700. Steps 1 to 5
need two accounts on the same cloud project (a manager and a member) once
0085 and 0088 are applied. On the test data, `/rabbit` is the manager and
`/rabbit?fixtures=member` is the member; the test data holds one Legal file,
*Location_release_Saltmarsh_Light.pdf*, and refuses uploads. Step 10 needs
the desktop app on the Local Server.

---

## 3. The numbers, measured

- **Tests:** 227 test files / 5,490 tests at the start; 232 files / 5,614 tests at the end of this bundle's branch, all passing. 125 deliberately broken versions of the code were planted by this session after each step and each review, and every one was caught but one that changes nothing a person could see (named in the hand-off). The reviewers planted 28 of their own; each one the tests missed was fixed and is among the 125.
- **The database checks** (run on the development database's real data and
  rolled back): the new Legal checks, 108 of 108 passing, and twenty neighbouring sets of checks that 0088 touches, every one passing.
- **Broken versions of the migration** (each a hand-edited copy): twenty, from the five the brief named (the lock removed from one rule, the list put back, the tag rule weakened) to the ones review added. The migration's own checks refused every one by name, and with those checks taken out, the Legal checks above turned red in each case.
- **Screens** (the test data, 1440x900 and 1280x700): the manager's Files
  tab with Add as Legal and the LEGAL folder, the confirmation, the Legal
  file's window with its locked chip and Core switch; the same project as a
  member, with 30 files instead of 33 and no LEGAL folder. Shots:
  `po-s4b-fixtures-*.png`. **The desktop app** (a development build against a real Local Server): a new project got a LEGAL folder beside INVOICES; four files added as Legal landed in it and nowhere else, each marked Legal; the window said the Local Server's sentence. Shots: `po-s4b-localserver-*.png`.

---

## 4. Still not right, and not this session's to change

- **The pet covers the end of the file window's last button** at both
  sizes (OUTSTANDING P1-54, your C5).
- **A manager's second window does not show a new invoice or Legal file
  until it refreshes** (OUTSTANDING S4b-03).

---

## 5. Questions, when you test

1. **A Legal file's deletion record.** When an invoice is deleted for good,
   every project member can still see that it was deleted, with its name
   (your ruling 22). For a Legal file this bundle hides that record from
   members too, because the brief said nothing may name a Legal file to
   them. Keep it hidden (recommended), or show Legal deletion records like
   invoices'?
2. **The LEGAL folder for members.** A member sees the INVOICES folder
   (empty for them) but not the LEGAL folder at all, because a folder that
   appeared when the first Legal file was added would itself tell them one
   exists. Is that right, or should every project show an empty LEGAL
   folder to everyone?
3. **A workspace manager can make themselves a project's manager.** Today
   a workspace manager can give themselves (or anyone) a manager seat on any
   project, and from that moment sees its Legal files, its invoices and its
   budget; nothing records the change. Your ruling says workspace managers
   do not see Legal files. Recommended: a workspace manager may still staff
   projects, but only an admin (or the project's existing manager) may make
   someone a project MANAGER, themselves included. Or keep it as it is.
4. **"Same as money files for now."** When you decide who else should see
   Legal files (a legal or production role, say), it is one rule in the
   database to change. Who, if anyone?

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and
1280x700, against the development database in runs that were rolled back,
and by the automated checks on GitHub (every push green). The desktop app was run once (the development build) for the LEGAL folder.

**Not checked:** the migration applied for real (it is waiting on you); a
real cloud upload of a Legal file; the packaged desktop app; a Mac.
