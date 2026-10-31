# 55 — BID VERSIONS: open one, change it, Save back into it, keep the others (R.A.B.B.I.T. → BUDGET → SUMMARY, and → TIMELINE)

> **Both halves are in.** Steps 1–22 are the Budget's (its **Summary**, S5c);
> steps 23–35, further down — *"The Timeline's half"* — are the Timeline's own
> **Bid version** bar: its dropdown, looking at a version read-only, Edit this
> version and Save from the Timeline, and the bar under a lock (S5d). The
> help pages ("Budget" and "Timeline", in R.A.B.B.I.T.'s Help) say the same in
> short.

**What this is.** A bid version is now a living document, as you asked
(F2). One version can be **open**: the Timeline and Budget show exactly its
schedule, and **Save** writes your changes back *into* it — "Mid ROM" stays
"Mid ROM" while you keep working on it. A new version appears only when you
press **Save as new version…** and give it a name. One version is the
**selected** bid, the one the variance measures against; you choose it in a
dropdown. One can be **locked** as the budget in production. Opening a
version that does not hold some of the Timeline's tasks takes those tasks
**off the Timeline** — they are kept whole, comments, files and logged time
included, and **come back** when you edit a version that holds them (your
ruling (a), *"to answer you a"*).

Your words, 2026-10-05: *"to edit a version press "Edit this version":
WILSON asks once to confirm, then loads that version into the live Timeline
and Budget and it becomes the open version. while a version is open, Save
writes the changes back INTO that version … a new version is only made on
purpose with "Save as new version", which asks for a name"*; and for the
total, *"the total with the agency % is important to be defined as the
overall total."* This is bundle S5, its third part (S5c).

Written 2026-10-05 against `feat/post-overhaul-edit-versioning` (S5c,
`po/s5-budget-versions`). Works on the cloud, the Local Server and the test
data.

**Before you start.** On the cloud this needs **migration 0089** (the open
version) and **migration 0090** (rows set aside). Both are on wilson-dev;
neither is on staging or prod yet (the S5b hand-off, "For the beta", has
the commands). On the **Local Server** nothing is needed. On the **test
data** (the development copy's fixtures, "Salt Hours") everything below can
be seen: Bid v1 holds the first 31 tasks, Bid v2 all 42 and is locked when
you start.

**Undo on this page.** The Budget has no Ctrl+Z of its own for these steps
(its Expenses tab's Ctrl+Z is the expenses' history). Every step that
changes the Timeline, locks, unlocks or deletes shows the **undo toast** at
the bottom — *"11 tasks left the Timeline: editing “Mid ROM”"* with
**Undo** — and that Undo takes back exactly that step. (Ctrl+Z on the
Timeline undoes them too.) If a step stops part way (the network drops),
the toast says *"Stopped part way: Undo takes back what changed"* and stays
until you use it or close it.

---

## 1. Step by step

The pictures are the test data's (`docs/sessions/handoffs/img/po-s5c-*`,
at 1440×900 and 1280×700). Your own steps use your own project.

| # | Do | You should see |
|---|----|----------------|
| 1 | Open a project, **Budget**, **Summary** | Top to bottom: the **Budget active — in production** banner if a bid is locked, the three day tiles, **Bid versions**, **Cost breakdown**, the Topsheet (picture 01). |
| 2 | If the banner is there, click **Reset to bidding** | The banner goes. At the bottom: *"Back to bidding: “…” unlocked"* with **Undo** (picture 04). Undo would lock it again, leaving the Timeline as it is. |
| 3 | In **Bid versions**, with no version open, click **Save as new version…** — the orange button | A form: **Name** has the cursor (typing is the job); **Note** under it; *"Based on the shot list “…”"*; **Cancel** first, then **Save as new version**. Type **Low ROM** and save. The row now reads **Open version: Low ROM · Saved …**; **Selected bid** shows Low ROM. |
| 4 | On the Timeline or in Tasks add two tasks. Back on the Budget's Summary | **Low ROM · Unsaved changes**, and **Save** is the orange button with *"● Unsaved"* beside it (picture 07). |
| 5 | Click **Save as new version…**, name it **Mid ROM**, save | Mid ROM is now the open version and the selected bid; Low ROM stays as you saved it (without the two tasks). |
| 6 | Add three more tasks, then **Save as new version…** **High ROM** | Three versions, three schedules. Under the selected bid, the automatic line: *"vs Mid ROM: +… bid days · 3 tasks added · +$…"*. |
| 7 | Put a **comment** on one of High ROM's three extra tasks (the task window, Comments) | — |
| 8 | In **Selected bid** choose **Mid ROM**, then **Edit this version** | *"Edit “Mid ROM”?"* — Cancel first. It says what happens: *"3 tasks that are not part of it leave the Timeline: “…”, “…” and “…”"* and *"Nothing on a row that leaves is lost: it comes back, with its comments, files and logged time, when you edit a version that holds it."* Click **Edit this version**. |
| 9 | Look at the Timeline | Only Mid ROM's tasks. The three extras are not in Tasks, not in the Budget's days, not anywhere — set aside, not deleted. The toast said *"3 tasks left the Timeline: editing “Mid ROM”"*. The save row: **Mid ROM · Saved …**, Save grey (nothing unsaved after an open). |
| 10 | Choose **High ROM**, **Edit this version**, confirm | *"3 tasks of its own come back"*. On the Timeline the three return — the same tasks — and the one you commented on still has its comment. |
| 11 | Log time on one of High ROM's extras (**1.5** days), then choose **Mid ROM** and **Edit this version** | The question names it first: *"“…” has work on it (1.5 days logged)."*, and one checkbox: **Keep it on the Timeline in “Mid ROM” (it becomes an unsaved change)** — **off** (picture 05 shows two worked tasks: "Keep them…"). Leave it off and confirm: the task leaves with its logged time kept. Or tick it: it stays, and Mid ROM reads *Unsaved changes* at once. |
| 12 | With Mid ROM open, change a task's days (or the Margin) | **Unsaved changes**; **Save** orange with *"● Unsaved"*. Click **Save**: *"Saved …"*, and it is still **Mid ROM** — same name, same place in the list (picture 09). |
| 13 | Change something again, then choose **High ROM** and **Edit this version** | First: *"Save the changes to “Mid ROM” first?"* — **Cancel** (first, with the focus), **Discard changes**, **Save to “Mid ROM”** (picture 08). Each does what it says; then the Edit question follows. |
| 14 | Look at the selected bid's facts | **Overall total** (with the agency fee, *"with 15% agency"*), **Before agency** beside it, **Bid days**, **Timeline** ("142 d" — point at it for the dates), **Last saved**, **Shot list**, the note, the automatic line, and **Variance vs the selected bid** with *Bid $… · Now $…*. In **Cost breakdown** the last row is now **Overall total**, with **Before agency** under it while the fee is on (picture 14). |
| 15 | **Manage versions…** | Every version, newest first: its state (**Locked**, **Open**, **Selected** — the selected one is also the highlighted row), created, **Overall**, **Before agency**, bid days, timeline length, note; a **⋯** per row with Select as the bid, Edit this version, Rename…, Edit note…, Delete… (picture 10). |
| 16 | **⋯** on **High ROM** → **Delete…** while Mid ROM is open | *"Delete “High ROM”?"* names the tasks only it holds that are off the Timeline now — the worked one first — *"They are deleted with it."* and *"Undo brings back the version and those rows."* Delete, then **Undo** in the toast: High ROM and its tasks are back. (Picture 11 is the test data's other case: Bid v2's set-aside tasks are also held by "Revision after week 2", so nothing goes with it and the question says only *"Undo brings back the version."*) |
| 17 | **Set budget active** on the open, saved version | *"Set “Mid ROM” active?"* — *"It is the open version, so the Timeline already shows it."* Confirm: the banner, *"Locked bid: Mid ROM · locked …"*; the toast *"Locked “Mid ROM” as the budget in production"* (pictures 12, 13). |
| 18 | While locked: **Edit this version** | Grey, with the reason under it: *"While the budget is active no version is opened: Reset to bidding first."* The selected bid can't be changed. The live Timeline stays editable. |
| 19 | While locked: **Save as new version…** — the orange one now — **Revision after week 2** | The form says *"Records … It is not opened or selected: the budget stays locked to “Mid ROM”."* Save: the toast *"Recorded “Revision after week 2”; the lock is unchanged"* (pictures 02, 03). The variance still measures against Mid ROM. |
| 20 | **Reset to bidding** | Back to step 2. |
| 21 | On the Tasks tab, with a version open, delete a task another version also holds | *"Remove “…” from “…”?"* — it stays in the other version and comes back when you edit it; a task no other version holds is deleted instead (S5b's question, unchanged). |
| 22 | **The Local Server** (the desktop app, signed out) | R.A.B.B.I.T.'s tabs now include **Budget** (picture 15). On the Local Server there are no roles: every gate is open — your words, *"its only me on this pc"*. The Control Panel's **Budget variables** show there too, and **Add as Legal** already did (since S4b). The cloud is unchanged: a reviewer or a member still sees no Budget. |

## 2. How to check it

- **Undo**: after steps 8, 10, 16, 17 and 2/20, the toast's **Undo** takes
  back exactly that step (the tasks return or leave again, the version
  comes back, the lock returns or lifts).
- **Nothing lost**: after step 9, the three extras are in no list; after
  step 10 they are back with the same comments, files and logged time.
- **Save into, not new**: after step 12 the list in Manage versions… has
  the same three versions; Mid ROM's "Last saved" moved.

## 3. The numbers, measured

- Tests: **263 files / 6,356** at the start → **267 files / 6,475** at the
  end, all passing. New test files: the block and its questions over the
  real provider and the test data (`views/budget/bidVersions.test.jsx`),
  the review's proofs kept as tests (`views/budget/bidVersionsReview.test.jsx`),
  the rate hooks (`components/Budget/ratesRead.test.jsx`), the Crew and
  Talent period headers (`views/budget/periodLabel.test.js`).
- Planted faults (a deliberate bug put in, to prove a test catches it, then
  taken out): **87 of 88** caught. The one not caught is a second safety
  layer that no screen can show missing (the S5c hand-off, trap 5).
- **Two review rounds** (an independent reviewer each time, trying to break
  it). Round 1 found seven things, all fixed before you test:
  - a step that stopped part way (the network dropping mid-step) showed no
    toast, so the Budget had no way back — now the toast says *"Stopped
    part way: Undo takes back what changed"*; and a version delete that
    stopped part way could leave its tasks on the Timeline — now they are
    set aside again;
  - a version deleted while an Undo was still running could not be brought
    back — it now waits its turn;
  - a rate on the rate card that no task uses made every version read
    *Unsaved changes* — only the roles the tasks use count now;
  - a task added at the moment you switch projects could land in the other
    project — it stays in its own;
  - the unsaved question's Save as new version… said "no shot list", and
    Manage versions… → Delete… → back forgot your shot-list choice — both
    fixed;
  - one failed read of the project's rates greyed the block until you
    switched projects — it is tried again.
- Round 2 found ten more, all fixed before you test:
  - **on the Local Server** (your desktop), a version delete or Edit this
    version → Discard that stopped part way had already deleted some tasks
    that its Undo could not bring back — now they are recorded as they go,
    and Undo brings them back;
  - after switching projects, the Budget could show — and Save into a bid —
    the previous project's rates for a moment, or for good if the new
    project's rates could not be read — now the rates are always the open
    project's;
  - a step taken while a long Undo was still running could be lost — it
    now says *"an Undo is still running — try again once it has
    finished"*;
  - a version's shot-list choice came back when you edited that version
    again — it no longer does;
  - Save, and Save as new version…, offered no Undo when they stopped part
    way, and Save as new version… could make the version twice — now the
    toast offers Undo, and the form says the version was made and offers
    only **Close**;
  - deleting a version, choosing another bid, then pressing the delete's
    Undo made two bids selected — now only the one you chose stays selected;
  - an asset, scene, shot, level or experience added just as you switched
    projects showed in the other project — it stays in its own (a scene or
    shot there under **Not in any list**);
  - Edit this version or Set budget active that could not even start said
    *"Undo takes back what changed"* — now it says *"Nothing changed."*;
  - the toast of a step that stopped part way vanished after 8 seconds
    while the question still promised its Undo — that toast now stays until
    you use it or close it;
  - a failed read of the rate card is tried again, like the project's
    rates.
- The test data's numbers: Bid v2 (locked) overall **$96,013**, before agency
  $84,491, 125.5 bid days, 137 d. After Reset to bidding the live overall
  reads **$115,215**: the app's rate card adds burden and overhead to each
  role's rate, while the test data's bids were saved with the plain rates.
  Opening a version writes its own rates as the project's rates, so the
  variance is $0 right after an open (picture 06).

## 4. Still not right, and not this session's to change

- ~~The Timeline's own version dropdown, its banner and its Save: S5d.~~
  Done — the Timeline's half, below.
- ~~Help pages for versions: S5d.~~ Done — "Budget" and "Timeline" in
  R.A.B.B.I.T.'s Help.

## 5. Questions, when you test

1. **"Overall total"** is now the name of the Cost breakdown's last row
   (it said "Grand total"), with **Before agency** under it while the fee is
   on — your F7. Right? (The Topsheet's own "Grand total" is a different
   figure, the budget lines', and kept its name.)
2. **Before agency** shows only while the agency fee is on (off, the two
   totals are the same number). Right?
3. The dropdown's options say **Locked** and **Open**; the selected bid is
   the dropdown's own value, so it is not repeated in its option ("Active"
   in F13 was the old word for selected). Right?
4. **Undo on the Budget is the toast.** A Ctrl+Z on the Summary would need
   the margin, contingency and agency edits to record their own undo steps
   first (today a Ctrl+Z there would take back the last *version* step, not
   the margin you just typed). Want that?
5. **Save as new version…** puts the cursor in **Name**, with **Cancel**
   first in the footer (the first brief said "Cancel focused"). Right?
6. The **keep** checkbox is **off** by default (leaving loses nothing; keeping
   makes the version unsaved at once). Right?
7. **Deleting a version deletes the tasks only it held** (they are off the
   Timeline and no other version could bring them back), named in its
   question, Undo bringing them back. Or should those with work come back
   to the Timeline instead?
8. In **Manage versions…** a long name wraps onto a second line rather than
   being cut; the shot list a version was based on is in the name's
   tooltip and in the selected bid's facts, not a column. Right?
9. On the **Local Server** the Control Panel's **Budget variables** open
   with the Budget tab (the same rule). Right?
10. The test data's bids were saved with the plain rates (no burden or
    overhead), so after Reset to bidding the locked bid reads $19,202 under
    "Now". Rebuild the test data's bids with the burdened rates?

## What was checked, and what was not

Checked: every step above on the test data in a browser (port 5280, this
worktree's own server), scripted at 1440×900 and 1280×700
(`scripts/budget-versions-shots.mjs`); step 22 in the desktop app itself
(the development build, signed out, the Local Server, a scratch profile).
Checked by automated tests, not by hand: a step that stops part way (the
network dropping mid-step), a step while an Undo is still running, a
project switch mid-step, a failed read of the rates. Not checked: the cloud
with 0089 and 0090 applied to a real workspace (dev has them; the steps are
the same).

---

# The Timeline's half (S5d) — the Bid version bar, looking at a version, and the lock

**What this is.** The Timeline has its own way into bid versions now, for
project managers and workspace admins (and on the Local Server, where there
are no roles): a **Bid version** bar directly under the zoom toolbar. Its
dropdown chooses what the gantt shows — **Current** (the live schedule, which
*is* the open version when one is open) or any saved version, **read-only**.
While a version is open, the bar says whether it is saved and gives you
**Save** right there. Under a lock the bar is greyed and says why. Your words,
2026-10-05: *"viewing a version is read-only. to edit a version press "Edit
this version""*, and *"while the budget is active the Timeline dropdown is
greyed out with the reason shown … i still edit the live Timeline during
production as normal."*

Written 2026-10-05 against `feat/post-overhaul-edit-versioning` (S5d, the
last part of bundle S5, `po/s5-budget-versions`). The same migrations as the
Budget's half (0089, 0090); nothing new.

**Why a bar of its own, and not a control inside the toolbar.** Measured on
the test data: at 1280×700 with six Group-by tabs and the "Shot list:" label,
the toolbar has 18px to spare (116px grouped by phase with four tabs), and the
smallest control that says "● Unsaved" and saves needs about 290px. The
choice was this row, or turning four of the toolbar's labelled buttons
(Today, Key date, Deleted, the sort pair) into bare icons. The toolbar is
exactly as it was; the bar costs one row (37px) under it.

## 6. Step by step

The pictures are the test data's (`docs/sessions/handoffs/img/po-s5d-*`, at
1440×900 and 1280×700).

| # | Do | You should see |
|---|----|----------------|
| 23 | Open the project's **Timeline** | Under the zoom toolbar, a row: **BID VERSION**, a dropdown, a few words, and buttons at the right. A member or a reviewer sees no such row, and nothing of it is even loaded for them (your F10). |
| 24 | If a bid is locked | The dropdown is grey, showing the locked bid (*"Bid v2 (pre-production) · 09/02/2026 · Locked"*), and beside it: *"While the budget is active no version is opened: Reset to bidding first."* The Timeline itself is untouched: drag a bar and it moves (picture 01). |
| 25 | While locked: **Save as new version…** | The form says it *"Records what the Timeline and Budget show now … It is not opened or selected"*. Name it **Revision after week 2** and save: the toast *"Recorded “Revision after week 2”; the lock is unchanged"* (pictures 02, 03). |
| 26 | On the Budget's Summary, **Reset to bidding**; back to the Timeline | *"No version is open."* and **Save as new version…** (picture 04). |
| 27 | Open the dropdown | **Current** first; then *Bid versions*, newest first — the open one marked *Open*, a locked one *Locked*; then **Manage versions…**. A version saved before versions kept their schedule shows *"· no timeline captured"*, greyed: it can't be looked at. No money anywhere in it (picture 05). |
| 28 | Choose **Bid v1**, then **Edit this version** in the bar, confirm; then **Save as new version…** *Low ROM*. The same from **Bid v2**: *Mid ROM* | Two versions made from the Timeline: Low ROM (31 tasks) and Mid ROM (42). Mid ROM is open. |
| 29 | Choose **Low ROM** while Mid ROM is open | The bar turns grey-tinted: *"Viewing bid version: Low ROM · 10/05/2026"*, *Read-only*, with **Edit this version** and **Current**. The gantt, the minimap and the band above show Low ROM: its 31 tasks, its dates, its key dates, its own critical path. **+ Phase**, **Key date** and **+ Task** are greyed with *"Viewing a bid version is read-only: Current goes back to the live schedule."*; Undo is grey and Ctrl+Z does nothing; an undo toast on screen keeps its **Undo** greyed until you are back at Current; a bar can't be dragged; a click on a bar opens nothing (picture 06). |
| 30 | **Current** | Back to the live schedule, Mid ROM's: *"Open: Mid ROM · Saved …"* (picture 07). Looking wrote nothing: no task left or came back, nothing new in Undo. |
| 31 | Choose **Low ROM** again, **Edit this version** | *"Edit “Low ROM”?"* — the Budget's own question (picture 08). **Edit this version**: the toast *"11 tasks left the Timeline: editing “Low ROM”"*; the tint goes; *"Open: Low ROM · Saved …"* (picture 09). |
| 32 | Drag a bar a day later | *"Open: Low ROM · Unsaved changes"*, and **● Unsaved** beside **Save**, whose edge turns orange and breathes (picture 10). **Save**: *"Saved …"* — still Low ROM (picture 11). For the moment it saves, the Timeline is greyed: *"A bid version step is still running: the Timeline takes changes again when it ends."* |
| 33 | **Save as new version…** — *High ROM* | The form, the cursor in Name, Cancel first in its footer (picture 12); then High ROM is open and selected (picture 13). |
| 34 | The gear → **Editable** → **Show weekends** off; **Day**; choose **Low ROM** | Note the date at the gantt's left edge (picture 14). **Week**, then **Day** again: the same date at the left (pictures 15, 16). Looking at a version never throws the gantt back to today. |
| 35 | Leave the Timeline (another tab) and come back | **Current** again: looking at a version is a look, not a state that stays. |

## 7. How to check it

- **Looking writes nothing**: after 29–30, Manage versions… lists the same
  versions; no task left the Timeline or came back; Undo has nothing new.
- **Save into, not new**: after 32, the list in Manage versions… is the same;
  Low ROM's "Saved" moved.
- **The lock**: the dropdown can't be opened under it; the Timeline still
  moves; Save as new version… only records.

## 8. The numbers, measured

On the test data in Chromium (this worktree's own server, port 5280), at
1440×900 and 1280×700 unless a line says otherwise.

- **The toolbar is exactly as it was.** Its free room, measured before S5d
  and after, to the tenth of a pixel: 17.9px at 1280 with six Group-by tabs
  and the "Shot list:" label, 115.7px at 1280 grouped by phase with four
  tabs, 157.5px at 1440 with six tabs. The bar is one row of 37px under it.
- **The bar's pieces** (Mid ROM open, unsaved): the dropdown 320px (a
  dropdown is as wide as its longest choice; from 1280 up it may take
  320px), the words 213px, the buttons 331px (Save 75, Save as new
  version… 179), "● Unsaved" 62px. Locked: the sentence 413px, one button
  (179px).
- **Narrower windows** (1024×700): the dropdown gives way first, down to
  140px, so the words fit whole — *"Open: Bid v1 (fund application) ·
  Unsaved changes"* — and so does the lock's sentence. If even that is too
  little (the rates could not be read, and the sentence saying so is long),
  the version's name and that sentence each end in "…", and the buttons
  never leave the window. A refusal (*"an Undo is still running — try again
  once it has finished"*, or a step that stopped part way) is a red-tinted
  line of its own under the bar, every word shown, its ✕ in reach.
- **Looking at a version keeps the date** at the gantt's left edge: Fri 11
  Dec 2026 stays at the left looking at a version whose schedule is 3 days
  earlier, or 4 or 5 days later, and back at Current, with weekends shown
  and hidden (automated). Pictures 14–16: Jul 20 at the left at Day, Week
  and Day again (at 1440; at 1280 Jul 23 at Day and the week of Jul 20 at
  Week). A version whose chart starts after the date you were on opens at
  its own first day, weekends shown or hidden (automated: a version 300 days
  later opens on Tue 1 Dec 2026), and Current comes back to that day
  (question 22).
- **The Timeline's own checks, before S5d and after both reviews**: every
  gantt row lines up (52 of 52 at every zoom, grouped by phase and by team,
  worst 0.5px off centre); the 31 states the Timeline's picture script
  takes are the same above the bar's row, and the same everywhere with the
  bar hidden but for one dependency arrow that also differs between two
  runs of the same code; the weekends switch keeps the date in all 36 zoom
  changes with weekends shown and with them hidden; the minimap's window
  still slides on the zoom tabs (16 of 16, both settings).
- **Tests**: 268 files / 6,514 tests when S5d began; 272 files / 6,591 at
  its end (with and without the development settings file). Every change
  has a test proven by breaking the code on purpose: 48 of 48 for the first
  build, 19 of 19 for the first review's corrections, 20 of 20 for the
  second's.

## 9. Questions, when you test (the Timeline's half)

11. **The bar is a row of its own** under the toolbar (the toolbar had no
    room at 1280 with six Group-by tabs). The alternative: four of the
    toolbar's labelled buttons as bare icons, and no extra row. Right?
12. **Save on the Timeline is not a filled orange button**: its edge turns
    orange and breathes, with "● Unsaved" beside it — the Timeline's one
    filled orange stays **+ Task**. (On the Budget's Summary, Save is the
    filled one.) Right?
13. **Save as new version… is never orange on the Timeline** (on the Summary
    it is, when it is the only way to save). Right?
14. **While looking at a version, a click on a bar opens nothing**: the task
    window shows the task as it is *now* — its comments, logged time, today's
    dates — which the version does not hold. Its tooltip says the saved name
    and length. Or would you rather a read-only window of the saved task?
15. **Looking keeps the date at the gantt's left edge** (so two versions can
    be compared over the same weeks); it does not jump to the version's
    start. Right?
16. **Choosing the open version in the dropdown is Current** (it is what
    Current shows), rather than its last saved state. Right?
17. **A version's arrows are its tasks' links as they are now** — a version
    doesn't keep links; Edit this version would bring back exactly these.
    Right?
18. **Versions now remember who each task was assigned to**, so "Group by
    team" works when looking at one; versions saved before today show the
    assignee as it is now. Right?
19. **"Group by team" no longer drops a task** whose assignee is not on the
    project's team: it shows under Unassigned, saying who (it used to vanish
    from that grouping — older than S5). Right?
20. **Leaving the Timeline returns to Current** (your F2's "viewing" is a
    look) — switching projects too. Right?
21. **While a bid version is being saved or changed, the Timeline stands
    still** for that moment — + Phase, Key date and + Task greyed with *"A
    bid version step is still running: the Timeline takes changes again
    when it ends."*, Undo grey, a click on a task opening nothing — even if
    you leave the tab and come back, or started it on the Budget. (A change
    made meanwhile used to join the step, so its Undo took your change back
    too.) If the step hangs, the Timeline lets go after 20 seconds; only the
    bar's buttons keep waiting. On the test data it lasts a blink. Right?
22. **A version whose schedule starts after the date you were looking at
    opens at its own first day**, and **Current** then comes back to that
    day, not to where you were before you looked. Should Current put you
    back where you were?
23. **While you look at a version, the undo toast's Undo waits**: greyed,
    saying why, its countdown stopped; back at Current it works again (it
    would have changed the live schedule, which you were not looking at).
    Right?
24. **When something can't be done, the bar says so on a red line of its
    own under it**, with ✕ to close it; and in a narrow window the dropdown
    narrows first, then the version's *name* gives way, never "Unsaved
    changes". Right?

## What was checked, and what was not (the Timeline's half)

Checked: steps 23–35 on the test data in a browser, scripted at 1440×900
and 1280×700 (`scripts/budget-versions-shots.mjs --part timeline`); the bar
at 1024×700 in its long states. Checked by automated tests, not by hand:
who sees the bar (a member and a reviewer: nothing of it, not even the
rates read), looking writes nothing (every write the backend could be asked
for is counted: none), Ctrl+Z, Undo and the toast's Undo waiting while
looking, a version deleted while you look at it, a Save refused while an
Undo still runs, a Save that fails, a Save that hangs, leaving the tab
mid-Save, a write that fails while another lands. Two adversarial reviews
(one reviewer each): the first found nine things (six fixed, the rest
recorded for other sessions), the second nine in the first one's fixes (six
fixed, three recorded). Not checked: the cloud with 0089 and 0090 on a real
workspace (dev has them; the steps are the same); the desktop app itself
(the bar is the same component there).
