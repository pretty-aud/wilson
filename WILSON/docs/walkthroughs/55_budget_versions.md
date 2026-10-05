# 55 — BID VERSIONS: open one, change it, Save back into it, keep the others (R.A.B.B.I.T. → BUDGET → SUMMARY) — the Budget half

> **The Timeline's own version control arrives with the next session (S5d).**
> This walkthrough is the Budget's half: everything below happens on the
> Budget's **Summary**. The Timeline already *shows* the open version's
> schedule (every step that changes it is checked there), but its dropdown,
> its "Viewing bid version" banner and its own Save are the next session's,
> and so is this walkthrough's second half.

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

- The Timeline's own version dropdown, its banner and its Save: S5d.
- Help pages for versions: S5d.

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
