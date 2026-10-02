# 53 — EDITS: cuts of a shot list, saved as versions (R.A.B.B.I.T. → SCENES)

An edit is a cut of a shot list: its shots in the order the film plays them. A shot can play twice, be left out, or be new; it keeps its name in every edit, and only the order is the edit's.

Nothing about an edit is saved until you press Save edit: the first change asks once whether to make a new edit (or a new version of the edit on screen), Save edit then pulses until you save or discard, and every way out of the tab, the page, the project or the window asks first.

Reviewers may make and save edits; Archive this edit is for project managers and workspace admins (on the signed-out Local Server there are no roles, so every verb is open).

---

**What this is.** The Scenes tab now makes edits. The shot list bar has an
**EDIT** selector after the list's name: **List order** is the list itself,
and each saved edit of it is chosen there. With an edit on screen the table
is the cut (a shot repeated shows twice, a deleted one as *Missing shot*),
the first tile reads **Edit runtime**, and the bar's right end holds **Save
edit** and **Discard changes** where the list's Save, Save as… and Set
active stood, so the bar never offers two Saves at once. You change a cut
by dragging a row by the grip in its number cell, or from a row's **⋯**
(Move up, Move down, Duplicate in edit, Add shot…, New shot, Remove from
edit). Elsewhere: the Budget's new bid version says which shot list it was
made from, the Timeline grouped by scene names the list it shows, and a
task, an asset or a take linked to a shot says which list holds it.

Your rule of 2026-10-02 is in too: removing a shot list never removes the
Timeline or the Budget. Nothing ever deleted a task (the data never
followed a list); on screen, a task whose scene or shot the active list
does not hold now stays on the Timeline and in the Budget, read as not
assigned ("No Scene", "No scene", "No shot"), and says what it points at.
Its link is kept, so it is under its scene again once the scene is back in
the active list. Clear, Set active, Archive, Withdraw and Remove from this
list say so in their questions.

S3a built the data underneath (one chain of edits per list, each a title
and a version); S3b built the lists on screen; this is bundle S3c. Your
rulings D6, D10 and D12 to D20 are the shape.

Written 2026-10-02 against `feat/post-overhaul-edit-versioning` (S3c,
`po/s3c-edits`). No migration: edits and the budget's shot list use
columns S3a's migrations 0084 and 0086 already made, which are on the
development database and on neither staging nor production yet. On the
Local Server everything works now, with no roles.

**Before you start.** The test data (the development copy's fixtures)
holds Salt Hours with "Shot list 1 · v1", the active list, six scenes and
sixteen shots, and no edits. The test data lives in memory: reloading the
page forgets what you made (which is how step 21 shows its question).

The pictures are in `docs/sessions/handoffs/img/`, named
`po-s3c-NN-<state>-1440x900.png` and `…-1280x700.png`, in the order of the
steps below.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open Salt Hours' **Scenes** tab | The bar as before, with **EDIT** and a selector reading **List order** after the list's name. Each scene's number cell has a grip (⠿) at its left, always shown. (01) |
| 2 | Drag *The storm* by its grip up over *Cliff path*, and hold it there | An orange line across the top of *Cliff path*: where it will land. Over a place it cannot land (a scene over a shot, say), no line. (02) |
| 3 | Let go | *Make a new edit from this list?*: *Start new edit makes "Shot list 1 · v1", a new edit of "Shot list 1 · v1", from the list's order with this change: Move the scene "The storm" before "Cliff path". The list itself does not change. Nothing is saved until you choose Save edit.* **Cancel** is focused; Cancel (or Escape) puts the row back and makes nothing. (03) |
| 4 | Click **Start new edit** | The edit on screen, not saved: the selector reads *Shot list 1 · v1 (not saved)*; at the right **● Unsaved**, then **Save edit** with its orange edge pulsing slowly (once every 1.2 seconds), then **Discard changes**. The table is the cut: **CUT** (its place in the cut), the shot's own **#**, **SHOT**, Status, Duration, Frames, under a band per scene with its shot count, runtime and frames; *The storm* now plays second. The first tile reads **Edit runtime**. **New scene** and **New shot** grey: hovering says an edit is on screen and where shots are added to it. Choose **List order** later and the list is as it was. (04) |
| 5 | Click *Up the stair*'s **⋯** | **Move up**, **Move down**, **Duplicate in edit**, **Add shot…**, **New shot**, and **Remove from edit** (red). A scene band's **⋯** has **Move scene up**, **Move scene down**, **Duplicate scene in edit** and **Remove scene from edit**. Move up and Move down are the keyboard's way to do what a drag does; they grey while a search is on. (05) |
| 6 | **Duplicate in edit** on *Up the stair*, then **Remove from edit** on *Her side* | No question this time: the edit is already unsaved. *Up the stair* plays twice in a row (you can see it behind the next picture's dialog) and *Harbour café* holds 2 shots. The tiles count the cut: 00:03:06:00 and 4,464 frames, one more stair and one side less. (06) |
| 7 | *The door*'s **⋯** → **Add shot…** | *Add shots to the edit*: *Into "Shot list 1 · v1", after "The door" (cut 1). A shot added twice plays twice.* The list's shots scene by scene, with a search; a shot already in the cut says *In the cut*. Tick *Lightning, wide*: the button reads **Add 1 shot**. (07) |
| 8 | Click **Add 1 shot** | It plays second, inside *Lighthouse, dawn*'s band: an added shot joins the scene block it lands in. |
| 9 | Click **Save edit** | *Save edit*: *The next edit of "Shot list 1 · v1": this cut, 17 shots in this order. Every shot keeps its name.* **Title** *Shot list 1*, **Same title, next version** on, *Will be "Shot list 1 · v1"*, and a **Summary**. Type one. (08) |
| 10 | Click **Save edit** in the dialog | The selector reads *Shot list 1 · v1* with *Saved 10/02/2026* beside it; the pulse and *Unsaved* go. **Save edit** stays, greyed: hovering says *Nothing to save: "Shot list 1 · v1" is as it was saved. A change to the cut starts its next version.* The bar's **⋯** holds **Archive this edit**. (09) |
| 11 | *The door*'s **⋯** → **Move down** | *Make a new version of this edit?*: *Start new version makes "Shot list 1 · v2" from "Shot list 1 · v1" with this change: Move "The door" down. "Shot list 1 · v1" stays as it was saved. Nothing is saved until you choose Save edit.* Click **Cancel**. (10) |
| 12 | Click **Shot lists…** | Under the lists, *EDITS OF "SHOT LIST 1 · V1" (1)*: each edit's title, version, the date it was made and its summary, with a **⋯** per row. Press Escape. (11) |
| 13 | Choose **List order**, open **Shots**, and delete *Lightning, wide* (its bin, then **Delete**); then choose *Shot list 1 · v1* again | Both of its plays read *Missing shot: Lightning, wide*, with dashes for status, duration and frames. Runtime and frames drop (00:03:02:00, 4,368), and the **Shots** tile counts the 15 shots still there (the count beside the search, 17/17, counts rows). Undoing the delete brings the shot back into the cut. (12) |
| 14 | *The door*'s **⋯** → **Move down** → **Start new version** | *Shot list 1 · v2 (not saved)*, pulsing. Now the ways out. |
| 15 | Click **Timeline** in the tab strip | *Save the edit before leaving?*: *"Shot list 1 · v2", an edit of "Shot list 1 · v1", is not saved. Save edit keeps it as its next version; Discard changes drops it; Keep editing goes back to it.* **Keep editing** (first and focused; Escape too), **Discard changes** (red), **Save edit** (orange). Click **Keep editing**: you stay. (13) |
| 16 | Open the menu (☰) and click **Home** | The same question, before the page starts to change. **Keep editing**. (14) |
| 17 | Open *The door*'s details (the eye) and click **Show in Bins** | The same question over the shot window: the jump leaves the Scenes tab. **Keep editing**, then **Close** the window. (15) A shot or scene window's own typed text asks its own question when a jump would drop it (S3b-08), and so does the task form inside it (S3b-05). |
| 18 | Choose **List order** in the edit selector | The same question: another list or edit on the bar leaves this one. **Keep editing**. Opening another list from **Shot lists…**, or making one, asks too. (16) |
| 19 | **Switch** to another project | The same question, before the switch. The test data holds one project, so this one is checked by an automated test, not in a picture. |
| 20 | Close WILSON (the desktop app's ✕) | WILSON's own *Close WILSON*, with the edit folded in: *"Shot list 1 · v1", an edit of "Shot list 1 · v1", is not saved. Save it before closing, or discard it.* **Keep editing** (focused), **Discard and close** (red), **Save edit and close** (orange). One question, never two in a row. In a browser tab, closing or reloading the tab shows the browser's own prompt instead. (21, from the desktop app) |
| 21 | With an edit unsaved, reload the page and open the Scenes tab | *Recover unsaved edit?*: *WILSON closed before "Shot list 1 · v2", an edit of "Shot list 1 · v1", was saved. It holds 17 shots. It was last changed 10/02/2026, 09:00 AM. Recover it to keep working on it, or discard it.* **Not now** (focused), **Discard edit**, **Recover edit**. (17) |
| 22 | Open **Budget** and scroll to **Budget versions** | Beside **Save current as bid version**, **BASED ON SHOT LIST**: *Shot list 1 · v1 (active)*, with every live list to choose from. The version you save remembers it: the versions table and the active budget's banner name it, and keep its name if the list is archived later. (18) |
| 23 | Open **Timeline**, and **Group by scene** | The toolbar reads *Shot list: Shot list 1 · v1*: the list whose scenes it groups by. Nothing else in the Timeline changed. (19) |
| 24 | Open **Scenes → Shots**, *The door*'s details, **Add new task**, and open the task | Under its **Shot**, the list that holds it: *Shot list 1 · v1*. A shot in more than one list or edit adds "+N", and hovering names each. The asset relations panel and the Bins inspector print it the same way; the Budget's By scene and By shot tables and the Timeline's rows say it on hover. (20) |
| 25 | Close the task and the shot window. On **Scenes**, **New shot list** → *Second unit*, **Start from** the list on screen → **Create shot list**, then **Set active** | *Make this the active list?* now also says: *Nothing on the Timeline or the Budget is deleted: a task on a scene or shot this list does not hold reads there as not assigned until that scene or shot is in the active list.* Click **Make active**. (22) |
| 26 | *Lighthouse, dawn*'s shot-list **⋯** → **Remove from this list** | The question ends: *This is the active list, so the other tabs stop showing it. Nothing on the Timeline or the Budget is deleted: a task on it reads there as not assigned until it is in the active list again.* (Clear this list says the same.) Click **Remove from list**. (23) |
| 27 | Open **Timeline**, **Group by scene**, and find *Grade the doorway* (step 24's task) | Still there: *Lighthouse, dawn* is no group now, and its task is under **No Scene**. Hover it: *Scene "Lighthouse, dawn": in Shot list 1 · v1, not in the active list*, the same for its shot, then the row's usual hint. (24) |
| 28 | Open **Budget → By scene** | **No scene** counts it with the rest (43 tasks): no task and no day is lost. Hover **No scene**: *Tasks here are linked outside the active list:* and each scene they point at. By shot says the same under **No shot**. (25) |
| 29 | Open *Grade the doorway* | Under **Scene** and **Shot** (still *Lighthouse, dawn* and *The door*: the link is kept): *Shot list 1 · v1, not in the active list*. Hovering it says the Timeline and the Budget show its tasks as not assigned until it is in the active list again. (26) |
| 30 | Make *Shot list 1 · v1* active again (or add *Lighthouse, dawn* back to *Second unit*) | *Grade the doorway* is under *Lighthouse, dawn* again, on the Timeline and in the Budget: nothing was written to the task. |
| 31 | Open **Help (?) → Scenes & shot lists** | All of this in short: the Edits section, and "Tasks stay" under the active list. |

### As a reviewer (the cloud, a project you are a reviewer on)

| # | Do | You should see |
|---|----|----------------|
| 32 | Drag a row, then save the edit | Both work: a reviewer makes and saves edits. A row's **New shot** greys (it adds a real shot to the list, which is for the members who add shots). |
| 33 | Open a saved edit's **⋯** | **Archive this edit** is greyed (*managers only*). |

### On the Local Server

| # | Do | You should see |
|---|----|----------------|
| 34 | Press **Ctrl+Z** after a change to an unsaved edit | It undoes that change in the edit (Ctrl+Y redoes it); the shot list's own undo waits until the edit is saved or discarded. On the cloud Ctrl+Z works the same way while an edit is unsaved, and only then (S3c-09). |
| 35 | Press **Ctrl+Z** on the **Budget** or **Timeline** tab from another page | Nothing: their undo keys now act only while R.A.B.B.I.T. is on screen (S4a-07), like the Scenes tab's. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700. Steps 1 to 18 and
21 to 31 work on the test data in the development copy. Step 19 needs a
second project; step 20 needs the desktop app. Steps 32 and 33 need a cloud
project where you are a reviewer. On the Local Server there are no roles,
so every verb is open.

---

## 3. The numbers, measured

- **Tests:** 237 test files / 5,795 tests at the start; 250 files / 6,035
  tests at the end of the bundle's eight steps, and 251 / 6,052 with your
  rule of 2026-10-02 built, all passing. 238 deliberately broken versions
  of the code were planted, step by step (25 of them against the rule,
  among them one that brings back the old drop): 237 were caught, and the
  one left is a guard that only matters for a single frame, which no test
  can see (the hand-off lists them by step).
- **The desktop app** (Electron 33.4.11, the development build, a scratch
  data folder, the window off-screen, against a real Local Server): an
  unsaved edit folded into *Close WILSON* at 1440x900 and 1280x700 with
  every answer inside the box; **Discard and close** quit the app.
- **In a real browser** (Chromium): a native drag lands where its line
  showed; the pulse runs at 1.2 seconds and stops under reduced motion
  with the dot and the word still there; each exit above asks, and a back
  press that is answered Keep editing leaves the address where it was.

---

## 4. Still not right, and not this session's to change

- **A scene's thumbnail draws a broken-image icon on the test data**
  (P1-28; picture 01): the fixtures name thumbnails that are not there.
- **The toolbar wraps its search to a second line at 1280** (R3-25, your
  question 184 in walkthrough 47).
- **The Timeline's weekends-off conversions** (P1-32b): S5's.
- The rest is in OUTSTANDING's S3c section (S3c-01 to S3c-10) and in the
  questions below.

---

## 5. Questions, when you test

1. **A list's first edit takes the list's own title.** D13 names a new
   edit after the chain's latest edit, or after the list when it has none,
   so the first edit of "Shot list 1 · v1" is "Shot list 1 · v1" too, and
   the bar can read *Shot list 1 · v1 / EDIT Shot list 1 · v1 (not saved)*
   (S3c-07). Keep, or give a first edit a title of its own ("Shot list 1
   cut · v1")?
2. **Save edit makes the edit Saved at once.** It writes the edit and its
   names together, so the edit is never "untouched": its maker's
   **Withdraw this edit** never applies to it. Ctrl+Z straight after
   takes the save back (where Ctrl+Z works); later it is a manager's
   **Archive this edit** (S3c-04). Keep?
3. **Save edit from the leave or the close question saves without a
   summary**, under the name the first question gave it (S3c-05). Keep, or
   open the Save edit form first?
4. **An added shot joins the scene block it lands in.** *Lightning, wide*
   (The storm's) added after *The door* plays inside *Lighthouse, dawn*'s
   band. Keep, or give it a band of its own scene?
5. **The grip is always shown** in the number cell, not only on hover.
   Keep?
6. **On a list, a drag works only in List order** (sorted any other way,
   the rows on screen are not the list's order, so there is nothing for a
   drop to mean). Keep?
7. **Save edit stays on the bar while an edit is on screen**, greyed when
   there is nothing to save, rather than appearing only after a change.
   Keep?
8. **A drop onto a scene the list has no shot of changes nothing**
   (S3c-02): a cut is shots. Should the shot start that scene's block?
9. **New shot in an edit adds a real shot to the list at once** (D6).
   Discard changes takes it out of the edit, not out of the list (S3c-03).
   Keep?
10. **Another project's unsaved edit is not in the close question**
    (S3c-01): only the open project's is. Its copy is kept, and that
    project's next visit offers it back. Should the close question name
    it?
11. **"Recover unsaved edit?" says "WILSON closed"** also after a browser
    tab was reloaded (S3c-06). Reword to "WILSON was closed or reloaded"?
12. **Ctrl+Z on the cloud** works in the Scenes tab only while an edit is
    unsaved (S3c-09, with S3b-03's question 5 in walkthrough 51). Want it
    on the cloud always?
13. **Your rule of 2026-10-02, read one level at a time.** A task whose
    scene IS in the active list but whose shot is not reads under its
    scene (as a task of the scene), not under "No Scene"; By scene counts
    it under its scene and By shot under "No shot". Keep, or should any
    link outside the active list send the whole task to "No Scene"?
14. **Archive and Withdraw** are only ever offered on a list that is not
    the active one, so their questions now say the Timeline and the
    Budget do not change. (Walkthrough 51's question 8 is answered: Clear
    stays on the active list, behind its question, which now says what it
    does to the Timeline and the Budget.)

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and
1280x700 (every step above except 19, 20, 30 and 32 to 35), with native
drags in a real browser, and in the desktop app (the development build,
not the packaged one) against a real Local Server for the window's close
question. The project switch, a reviewer's view, the Local Server's
Ctrl+Z and the Budget's and Timeline's page gate on their undo keys were
checked by automated tests, not by hand. Saving a bid version with its
shot list was checked by tests on all three backends. Your rule of
2026-10-02 was checked through the real provider in a test (four tasks;
clear the active list, make another active, archive the old one, delete
a scene, bring a scene back: every task drawn and every total the same
after each), and step 30 by that test, not by hand.

**Not checked:** a real reviewer seat on the cloud; the packaged desktop
app; staging or production (neither has 0084 or 0086); a Mac; the
browser's own prompt on a reload or a closed tab (its wiring is pinned by
a test; the desktop app asks its own question instead).
