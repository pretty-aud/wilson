# 51 — SHOT LISTS: the Scenes tab with more than one list (R.A.B.B.I.T. → SCENES)

A scene or shot is ONE row shared by every shot list that contains it: renaming a shot, changing its status, notes or thumbnail in one list changes it in every list; only which scenes and shots a list holds, and their order, belong to the list.

The Scenes tab shows the list YOU are viewing, which can differ from the project's ACTIVE list; the Timeline, Budget, Tasks, Assets, Bins and every other surface show only the active list's scenes and shots.

Reviewers may now create and edit shot lists and edits (a first: they could only comment before), but they still cannot create, rename or delete a scene or shot itself; making a list active and archiving are for project managers and workspace admins only, except that whoever made a new list or edit can withdraw it again while it is untouched (on the signed-out Local Server there are no roles, so both are open).

---

**What this is.** The Scenes tab now works with shot lists. A new bar sits
between the four totals and the toolbar: it names the list you are looking
at, says whether it is the project's active list and whether it has changed
since it was last saved, and holds the list's verbs. **Shot lists…** opens
every list; **New shot list** and **Save as…** make one. A scene or a shot
can be taken out of one list without deleting it (**Remove from this
list**), and **Add from another list…** links rows in. Delete now says
plainly that it deletes from the project and from every list.

S3a built the data underneath (migrations 0084 and 0086, the three
backends, the provider); this is bundle S3b, the screens. Your rulings D1 to
D21 are the shape. Edits, drag and drop and the Save edit button are S3c's.

Written 2026-10-01 against `feat/post-overhaul-edit-versioning` (S3b,
`po/s3b-shot-lists-ui`). Works on both backends. On the cloud, shot lists
need migrations 0084 and 0086: both are on the development database, and
neither is on staging or production yet (S3a's hand-off). On the Local
Server everything works now, with no roles, so every verb is open.

**Before you start.** With only one list nothing looks different except the
new bar: the table, the tiles and the toolbar are as they were. The test
data (the development copy's fixtures) holds "Shot list 1 · v1", the active
list with every scene and shot, and "Pickups · v1", archived.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-s3b-NN-<state>-1440x900.png` and `…-1280x700.png`, in the order of the
steps below. The before pictures are `po-s3b-before-scenes-1440.png` and
`…-1280.png`.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open a project's **Scenes** tab | The totals, then the new bar: **SHOT LIST Shot list 1 · v1**, an **ACTIVE** badge, *Never saved*, and on the right **New shot list**, **Shot lists…**, **Save**, **Save as…** and **⋯** (More). Then the toolbar and the table, as before. The sort reads **List order**: the list's own order. (01) |
| 2 | Hover a scene's name | Its tooltip names the lists that hold it: *In: Shot list 1 · v1*. A row no live list holds says *In no shot list*. |
| 3 | Click **New shot list** | The form: **Title** (the list on screen's, selected, so typing replaces it), the switch **Same title, next version**, **Summary**, and **Start from**: the list on screen, every scene and shot in this project, or empty. A line says what "linked" means. Type *Second unit*, choose **Empty**. (02) |
| 4 | Click **Create shot list** | The bar shows **Second unit · v1**, no badge, and **Active: Shot list 1 · v1** (click it to go back to the active list). **Set active** appears. The table is empty. The other tabs still show the active list. (03) |
| 5 | Click **⋯** | **Add from another list…** first, then **Edit details…**, **Clear this list** (only before the list is first saved), **Withdraw** (only for the list you made, while it is untouched; on the Local Server, which has no users, for any untouched list) and **Archive**. (04) |
| 6 | Click **Add from another list…** | *Add from another list*, **From** the first list with something to add (here *Shot list 1 · v1*), a search, and the rows scene by scene. Tick scene 1: its three shots tick with it. Tick one shot of scene 2: scene 2 shows a dash (some of its shots). The button counts what will be added: **Add 2 scenes and 4 shots**. Rows the list already holds are ticked and greyed. (05) |
| 7 | Click the **Add** button | The rows appear in *Second unit*; the totals count them. (06) |
| 8 | Hover a row and click its **⋯** (between View details and Delete) | **Move up**, **Move down** (List order only) and **Remove from this list**. (07) |
| 9 | Click **Remove from this list** | *Remove from this list?*: *Takes "Lighthouse, dawn" and its 3 shots out of "Second unit · v1". Nothing is deleted: it stays in the project. It is still in "Shot list 1 · v1".* Cancel is focused. Click **Cancel**. (08) |
| 10 | Hover a row and click its **Delete** (the bin) | *Delete scene?*: *This will permanently delete "Cliff path" and its 3 shots from the project. It will be gone from both shot lists that hold it: …* and, because a list is on screen, how to take it out of this list only. Click **Cancel**. (09) |
| 11 | Click **Save** | *Saved 10/01/2026*. **Save** greys, and hovering it says nothing has changed since then. Change anything in the list (a status, a row added) and it comes back with *Not saved since changes*. (10) |
| 12 | Click **Save as…** | The form with **Same title, next version** on: *Will be "Second unit · v2"*. Click **Cancel**. (11) |
| 13 | Click **Set active** | *Make this the active list?*: it becomes the list every other tab shows; the old one is kept and can be made active again. Click **Cancel** (or **Make active** to try it). (12) |
| 14 | Make another list (*Night unit*, empty), then **⋯ → Withdraw** | *Withdraw this list?*: you made it and nobody has saved it or started an edit on it, so you can take it back; it is set aside, not deleted. (On the Local Server, which has no users, it says nobody has saved it or started an edit on it.) (13) |
| 15 | Click **Withdraw** | The tab goes back to the active list, and the bar says *Recently removed: Night unit · v1* with **Open** and **Restore**, until you leave the Scenes tab. (14) |
| 16 | Click **Restore** | *Night unit* is back, on screen. (15) |
| 17 | Click **Shot lists…** | Every live list, newest first: the Active badge, title, version, the date it was made, its summary, and a **⋯** per row (Set active, Edit details…, Clear, Withdraw, Archive, as you may). Below, **Archived… (1)**; **New shot list…** at the footer's left, **Cancel** and **Open** at its right. (16) |
| 18 | Click **Archived…** | The archived and withdrawn lists, each marked, with **Restore** for whoever may. **All shot lists** goes back. (17) |
| 19 | Open *Shot list 1*, and **Remove from this list** on *Salt hours* | This time the question says no other list holds it, so it will be found under "Not in any list" (and so will any of its shots no other list holds), and, because *Shot list 1* is the active list, that the Timeline, Budget and every other tab will no longer show it. Click **Remove from list**. (18) |
| 20 | **Shot lists… → Not in any list (1) → Open** | The scenes and shots no live list holds: *Salt hours*. The bar says **Not in any list**. (19) |
| 21 | Click *Salt hours*'s **⋯** | **ADD TO LIST** and each live list: one click adds it there. (20) |
| 22 | Open a scene, change its **Description**, and press **Escape** (or ✕, Close, or click outside) | *Discard your changes?*: what you typed is not saved. **Cancel** (focused) keeps it; **Discard** drops it. With nothing changed, Escape closes as before. The notes too, and the shot window too. If someone changes the description meanwhile, what you typed stays. (21) |
| 23 | Tick two scenes | The selection bar has **Remove from list** beside **Delete**, in the plain button, not the red one. A selection holds only what is on screen: another list, a search or a filter unticks what it hides, and closing a scene unticks its shots. |
| 24 | Open **Help (?) → Scenes & shot lists** | The page that says all of this in short. |
| 24a | Open an archived list (**Shot lists… → Archived… → Open**) | It reads like any list, marked **Archived**. **New scene**, **New shot** and **Add shot** are greyed: hovering says the list is archived, to restore it or open another list to add scenes and shots. (22) |

### As a reviewer (the cloud, a project you are a reviewer on)

| # | Do | You should see |
|---|----|----------------|
| 25 | Open the Scenes tab | Everything reads as before. **New scene**, **New shot**, every **Delete**, **Add shot** and the selection bar's Status, Type, Time of day and Delete are greyed; hovering one says *Reviewers can read, comment and build shot lists and edits, but cannot change scenes, shots, tasks, budgets or the project's other items. Ask a project manager for a member or manager seat.* A scene's window has no "Add new task". |
| 26 | Click a name, a status, a date | Nothing opens: the names and descriptions are plain words, the choices and dates are greyed. The thumbnails are pictures, not buttons. |
| 27 | Open a scene | Every field is shown without its box, as a value you cannot change is; Delete scene and Add shot are greyed. |
| 28 | Use the bar, a row's **⋯**, **Add from another list…** | All live: a reviewer builds lists. **Set active** and **Archive** are greyed for anyone who is not a project manager or a workspace admin. |

### On the Local Server

| # | Do | You should see |
|---|----|----------------|
| 29 | Open R.A.B.B.I.T. on **D.O.G.** or any other page, and press **Ctrl+Z** | Nothing: Scenes' undo keys act only while R.A.B.B.I.T. is on screen (before this, they undid R.A.B.B.I.T.'s last edit from any page). On the Scenes tab, Ctrl+Z still undoes, also inside a scene or shot window, but not while a menu, a question, the settings drawer or the shot lists' windows are open, nor while a delete of several rows is still going. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700. Steps 1 to 24 work
on the test data and on the Local Server. Steps 25 to 28 need a cloud
project where you are a reviewer (or ask someone to look with a reviewer
seat). On the Local Server there are no roles, so every verb is open.

---

## 3. The numbers, measured

- **Tests:** 227 test files / 5,490 tests at the start; 231 files / 5,634 tests at the
  end of this bundle's eight steps, all passing. 187 deliberately broken
  versions of the code were planted by this session, step by step, and
  every one was caught (the hand-off lists them by step). Two review rounds
  followed: 231 / 5,652 after the first, 232 / 5,671 after the second, and
  237 / 5,795 with the other bundle of the day (S4b, the Legal gate) merged
  in, all passing. The rounds planted 68 more broken versions: every one is
  caught but one, a check that a second guard always covers (recorded in
  the hand-off with one more of the same kind the second reviewer found).
- **The table at 1280:** the actions column grew from 84 to 112 pixels (it
  holds three buttons now: View details, the shot-list menu, Delete), and
  Description and the nested shots' names gave the room back, so the scene
  table still fits a 1280 window inside its gutters (checked by a test).
- **The desktop app, against a real Local Server** (Electron 33.4.11, the
  development build, a scratch data folder, the window off-screen; a
  project seeded through the Local Server's own routes): the first list
  was made from every scene and shot and became active (9 rows); a second
  list, empty, took a scene and its shots through Add from another list…;
  Remove from this list named the other list that keeps the shot; Save
  stored a version point; Edit details… changed the summary alone (the
  server read it back); Withdraw and Restore round-tripped. Shots:
  `po-s3b-localserver-*.png`.

---

## 4. Still not right, and not this session's to change

*2026-10-02: bundle S3c (walkthrough 53) has since fixed the popups'
sidebar for a reviewer (S3b-01), the task form and "Show in Bins" that
dropped typed words unasked (S3b-05, S3b-08), the relation pickers that
read only the active list (S3b-09), and the Budget's and Timeline's Ctrl+Z
from other pages (S4a-07).*

- **A scene's or shot's thumbnail draws a broken-image icon on the test
  data** (P1-28): the fixtures name thumbnails that are not there.
- **The toolbar wraps its search to a second line at 1280** (R3-25's
  regrouping is still your question 184 in walkthrough 47).
- **The popups' sidebar** (asset relations) and **their file list** are not
  gated for reviewers yet (S3b-01, S3b-02): those files are S3c's and the
  Files lane's. ("Add new task" is: it was this tab's own.)
- **The asset window a scene or shot window opens** is the Assets tab's,
  which is not gated for reviewers yet, and its scene and shot pickers list
  only the active list's (S3b-09).
- **"Show in Bins" in a shot window's takes** leaves the tab without asking
  about a changed description or notes (S3b-08): the leave guard is S3c's.
- **A popup's Delete drops a changed draft without asking** (S3b-04), and
  **the task form inside a popup is dropped without asking** (S3b-05).
- **The Budget and Timeline tabs' Ctrl+Z still acts from other pages**
  (S4a-07): S3c's files.
- **An edit made while a delete of several rows is still going joins that
  delete's undo step**, and the undo toast can still be pressed in that
  moment (S3b-10): the provider's, not this tab's.

---

## 5. Questions, when you test

1. **The first list.** A new list becomes the project's active list only
   when the project has none and you may make one active (managers and
   workspace admins; everyone on the Local Server). Otherwise it is made
   and shown, and the active list stays. Keep that rule?
2. **Add from another list… lives in the bar's ⋯.** It leads that menu, but
   it is not a button on the bar (the bar keeps room for S3c's edit picker
   and Save edit). Is it easy enough to find, or should it be a button?
3. **The Delete question is longer now** (three sentences: what goes, the
   lists it leaves, and how to take it out of this list only). Keep, or
   shorten to the first sentence and the list count?
4. **A reviewer's view.** Names and descriptions are plain words, choices
   and dates greyed, the buttons greyed with the reason on hover. Is that
   the right read-only look, or should a reviewer's cells keep their boxes?
5. **Ctrl+Z on the cloud.** The Scenes tab binds its undo keys only on the
   Local Server, as it did before (S3b-03). Want them on the cloud too?
6. **"Not in any list".** It adds one row at a time (each row's ⋯). Do you
   want a selection's "Add to list" as well?
7. **Walkthrough 47's Scenes questions.** This bundle decides **Q192**: all
   four older Scenes bugs are fixed (a shot's delete in the scene window no
   longer opens it; a related asset opens; "Files (N)" once; the ungrouped
   table shows a new thumbnail at once). It touches but does not decide
   **Q183** (the bar's "New shot list" follows "New scene"; if you say no to
   Q183 it becomes "Shot list"), **Q185** (the actions column is wider now,
   Description narrower) and **Q191** (a reviewer's read-only fields follow
   "no box"). Q184, Q186 to Q190 and Q193 are untouched.
8. **Clear on the active list.** Every project's backfilled "Shot list 1 ·
   v1" is the active list and has never been saved, so by D4 it can be
   cleared, which empties every other tab. Clear is offered there, as D4
   rules, and its question now ends: *This is the active list, so the
   Timeline, Budget and every other tab will no longer show them.* Keep it,
   or withhold Clear on the active list (as Archive is)?

   **2026-10-02 — answered by Audrey:** *"lets not allow a clear without
   giving the user a warning and asking them to confirm they want to clear
   and let them know it will clear things. but also. i want it that if a
   shot list is removed. dont delete the budget and timeline."* Clear stays
   on the active list, behind its question. That question's last sentence
   was not true and is rewritten (bundle S3c): nothing on the Timeline or
   the Budget is deleted, and a task on those scenes and shots stays there,
   read as not assigned until they are in the active list again (its link
   is kept). Set active, Archive, Withdraw and Remove from this list say
   the same. Walkthrough 53, steps 25 to 30, shows it.

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and
1280x700 (every step above except 25 to 29), and in the desktop app (the
development build, not the packaged one) against a real Local Server:
lists made, filled, saved, renamed, withdrawn and restored, read back from
the server. A reviewer's view and the page gate on Ctrl+Z were checked by
automated tests, not by hand. After the two review rounds the pictures
were taken again on the reviewed code (seven changed, one added: step
24a); the desktop app was not run again. How the ⋯ menus behave in the
browser's own order of events was checked by an emulation in the tests
(the second review found that the test's order had hidden a fault), not
by hand in the app.

**Not checked:** a real reviewer seat on the cloud (the gates are the same
rule the database enforces, and are tested); the packaged desktop app;
staging or production (neither has 0084 or 0086); a Mac.
