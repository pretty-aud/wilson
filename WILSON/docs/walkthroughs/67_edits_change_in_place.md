# 67 — AN EDIT CHANGES IN PLACE: SAVE EDIT AND SAVE AS… (R.A.B.B.I.T. → SCENES)

1. **A change to an edit no longer asks for a new version.** Drag a shot,
   or use a row's ⋯, on an edit that is already saved: the change is made to
   that edit at once. The bar shows **● Unsaved**, and the edit selector
   reads *Shot list 1 · v1 (unsaved changes)*.
2. **Save edit saves into the edit on screen.** Its title and version stay,
   and its cut becomes the one on screen. No window opens.
3. **Save as… is the only way to a new version.** It opens *Save as a new
   version*, which asks the title and version (by default the same title,
   next version) and a summary. The edit you started from stays as it was
   saved.
4. **The buttons are named as you asked:** with an edit on screen the bar
   reads **Save edit**, **Save as…**, **Discard changes**. In List order the
   list's own button is **Save as…** again (it read *Save edit as…*).

**What this is.** FX4, from your words of 2026-10-12 answering walkthrough
66: "when i make changes to an edit, it should start to edit the current
selected edit instead of asking me to always make a new one." Nothing in the
database changed, and nothing needs applying anywhere. The cloud already let
an edit be saved into; only the app asked for a new version every time.

**Your answers to walkthrough 66, questions 1 to 3, are recorded:** the
banner keeps its word, the 1px line stays, and the Team gallery stays inside
the roster's column. Nothing changed for them.

**Before you start.** The test data (the development copy's fixtures) holds
Salt Hours with *Shot list 1 · v1* and no edits. Step 1 makes one. The test
data lives in memory: reloading the page puts it back.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-fx4-before-NN-<state>-<size>.png` and `po-fx4-after-NN-<state>-<size>.png`
(sizes 1440x900 and 1280x700), the same eight states before and after, taken
by `scripts/fx4-shots.mjs`.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open Salt Hours' **Scenes** tab | In List order the bar's right end reads **Save**, **Save as…**, then ⋯. Before, the middle one read *Save edit as…*. (after-01, before-01) |
| 2 | Drag *The storm* by its grip onto *Cliff path* | *Make a new edit from this list?*, as before: in List order there is no edit yet, so the first change still asks before it makes one. Click **Start new edit**. |
| 3 | Click **Save edit** | The new edit is saved as *Shot list 1 · v1*, the name the question gave it. No window opens; before, a *Save edit* window asked for a name here. The bar: *Saved 10/12/2026*, **Save edit** greyed, **Save as…** beside it. (after-02) |
| 4 | On that saved edit, open *The door*'s ⋯ and click **Move down** | No question. Before, this asked *Make a new version of this edit?* every time (before-03). Now the cut changes at once, **● Unsaved** appears with **Save edit** pulsing, then **Save as…** and **Discard changes**. The selector reads *Shot list 1 · v1 (unsaved changes)*. (after-03) |
| 5 | Drag another shot by its grip | It lands at once, as part of the same unsaved changes. Nothing asks until you save or discard. |
| 6 | Hover **Save edit** | *Saves these changes into "Shot list 1 · v1", replacing its cut as it was saved. Save as… keeps that one and saves these as a new version.* (after-04) |
| 7 | Click **Save edit** | Saved into *Shot list 1 · v1*: the same name, no new version in the selector, *Saved* with today's date, and the pulse gone. The keyboard's place moves to **Save as…**, and a screen reader hears *"Shot list 1 · v1" saved*. (after-05; before-05 was the window that made v2) |
| 7a | Make a change, click **Save edit**, and while it is still saving make another change (a drag, a row's ⋯, a **New shot**) | The save writes what was there when you pressed it. The change made while it saved stays on screen as **● Unsaved**, now changes to the version just saved: nothing is lost, the next Save edit writes it, and Ctrl+Z takes it back to the cut just saved. A screen reader hears *"…" saved. Changes made while it saved are not saved yet.* |
| 8 | *Up the stair*'s ⋯ → **Duplicate in edit**, then **Save as…** | *Save as a new version*: *A new version, from "Shot list 1 · v1": this cut, 17 shots in this order. "Shot list 1 · v1" stays as it was saved.* **Title** fixed while **Same title, next version** is on, *Will be "Shot list 1 · v2"*, and a **Summary**. (after-06) |
| 9 | Type a summary, click **Save new version** | *Shot list 1 · v2* is on screen and saved; *Shot list 1 · v1* is still in the selector, as it was saved. (after-07) |
| 10 | Make a change, then click **Timeline** in the tab strip | *Save the edit before leaving?*: *"Shot list 1 · v2", an edit of "Shot list 1 · v1", has changes that are not saved. Save edit saves it; Discard changes drops what is not saved; Keep editing goes back to it.* **Keep editing** is focused (Escape too). Its **Save edit** saves into the edit, as the bar's does. Leave while a **Save edit** is still saving and the question opens at once; when that save lands with nothing left unsaved, it closes by itself and you go on. Its **Discard changes** never waits for a save that is slow to answer. (after-08) |
| 11 | Make a change, click **Discard changes** | *The changes to "Shot list 1 · v2" are not saved: they go, and it comes back as it was saved.* **Discard changes** brings the saved cut back, and the keyboard's place moves to **Save as…**. |
| 12 | With a saved edit on screen and nothing changed, click **Save as…** | The same window: a copy of the edit as the next version. |
| 13 | Press **Ctrl+Z** after a change (before saving) | It undoes that change; **Ctrl+Y** redoes it. **Unsaved** stays until you save or discard. After **Save edit**, Ctrl+Z takes the save back (the edit's cut as it was saved before), on the cloud as on the Local Server. |
| 14 | Help (?) → **Scenes & shot lists** | The shot list bar's card names **Save as…**. The edits cards say a change to an edit asks nothing, **Save edit** saves into it, and **Save as…** is the only way to a new version. |

### When two people change one edit

| # | Do | You should see |
|---|----|----------------|
| 15 | You and someone else both change the same saved edit. They press **Save edit** first, then you do | Your Save edit saves nothing, and the bar says: *Someone saved "…" since these changes began, and Save edit would write over that. Save as… keeps your changes as a new version; Discard changes shows the edit as they saved it.* Your changes stay on screen. This holds even when the two saves land in the same moment: the cloud, the Local Server and the test data each write an edit only while it still carries the save your changes began from. (Checked by tests: edits are not sent live to other screens, so this is found when you save.) Once Save as… has kept your changes, the message goes. |
| 16 | A manager archives the edit while you have changes to it | The selector reads *(unsaved changes, archived)*; **Save edit** greys, its hover saying **Save as…** keeps them as a new version; your changes stay. Leaving asks without a Save edit (it could only fail): Keep editing, then Save as…, or Discard changes. |

### As a reviewer (the cloud)

| # | Do | You should see |
|---|----|----------------|
| 17 | Change a saved edit and press **Save edit** or **Save as…** | Both work, as before: a reviewer makes and saves edits. **Archive this edit** stays managers only. |

### One question a change can still ask

| # | Do | You should see |
|---|----|----------------|
| 18 | On a list with a saved edit, leave a change unsaved and close WILSON (or reload). Open the Scenes tab again, click **Not now** at *Recover unsaved edit?*, then change a saved edit of that list | *Replace the unsaved edit kept from before?* Changing the edit would replace the one kept from before (one unsaved edit per list). **Cancel** (focused) keeps it, and the bar's ⋯ then has **Recover unsaved edit…**. **Replace kept edit** (red) makes the change. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700. Steps 1 to 14 work
on the test data in the development copy. Steps 15 and 16 need a second
person (or a second window) on the cloud. Step 17 needs a cloud project where
you are a reviewer. On the Local Server there are no roles, so every verb is
open. Step 18 needs the Local Server or the cloud: the test data forgets its
edits on a reload (only the unsaved copy survives), so there is no saved
edit to change after it. It was checked by an automated test.

---

## 3. The numbers, measured

- **Tests:** 349 test files / 8,375 tests (2 skipped) at the start, all
  passing but the file gateway's own PowerShell test, which runs out of time
  under the full run's load on Windows and passes alone (`docs/OUTSTANDING.md`).
  After the change: 349 / 8,404 (2 skipped), the same two-under-load
  exceptions (the gateway's, and once an O.T.T.E.R. wiring scan), both
  passing alone. After the first review round 349 / 8,433, after the
  second 349 / 8,445 (2 skipped), all passing but the gateway's load
  time-out, which passes alone.
- **Two review rounds** (one reviewer each, attacking first the whole
  change, then the first round's corrections). The first found one serious
  fault, a change made while Save edit was still saving was lost, and eleven
  smaller ones; the second found nine, none serious, in the first round's
  corrections. All are fixed. Every fix was proved by breaking it on
  purpose and watching its test fail: 88 deliberately broken versions.
  84 were caught at once; two more once their tests were made stronger;
  and two are second guards, each caught when broken together with the
  guard it backs.
- **In a real browser** (Chromium, the development copy): 40 checks driven
  by keys and real drags. They covered the list's first drag still asking, its Cancel
  focused, Tab and Enter starting the edit, focus landing on Save edit, Save
  edit by Enter opening nothing, a row's ⋯ by Enter and the arrow keys to
  Move down asking nothing, Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z on the changes,
  a drag on the changes, Save as… by Enter opening its window with the focus
  in its summary, Escape closing it, Save edit by Enter saving into the edit
  with no new version, Discard changes with Cancel focused and Escape
  keeping the changes, the leave question with Keep editing focused, Escape
  staying and its Save edit saving and leaving.
- **The bar** holds one line (44px) at 1440, 1280 and 1024 wide with
  **● Unsaved**, **Save edit**, **Save as…** and **Discard changes** on it.

---

## 4. Still not right, and not this session's to change

- **The cloud's half of "two saves in the same moment" was checked against
  a stand-in for the database, not the database.** The cloud writes an edit
  only where its stored save is still the one your changes began from (a
  filtered update); tests prove what the app asks the cloud for, and the
  Local Server and the test data were run for real. Nothing in the database
  changed for it, so there is nothing to apply.
- **A scene's thumbnail draws a broken-image icon on the test data**
  (P1-28), in every picture.

---

## 5. Questions, when you test

1. **The button names, as I read your words.** With an edit on screen the
   bar reads **Save edit** and **Save as…** (and **Discard changes** while
   something is unsaved). In List order the list's own button reads **Save
   as…** again, not *Save edit as…*. Both Save as… windows are titled *Save
   as a new version*: the list's makes a new shot list, the edit's a new
   version of the edit, and each says which under its title. Is that what
   you meant?
2. **Save edit replaces the edit's cut without asking**, as Save does in
   any app. Save as… is the way to keep the old one, and Ctrl+Z straight
   after takes the save back (on the cloud too: the Scenes tab has had
   Ctrl+Z there since bins came to the cloud). Keep, or ask before
   replacing?
3. **The very first change in List order still asks** *Make a new edit from
   this list?* There is no edit yet, so the question says what it makes.
   Keep it, or make the edit without asking there too?
4. **Save edit on a brand-new edit (from List order) saves it under the name
   the question gave it**, *Shot list 1 · v1*, without a window. Save as…
   names it. Keep?
5. **Save as… with nothing changed** makes a copy of the edit as its next
   version, ready to change. Keep?
6. **The one question left on a saved edit** (step 18): a change that would
   replace an unsaved edit kept from before asks first, because only one
   unsaved edit per list can be kept. Keep, or never ask?
7. **When someone else saved the edit since you began** (step 15), Save
   edit saves nothing and says Save as… keeps yours. Keep?
8. **The selector's words:** *(unsaved changes)* after an edit you are
   changing, *(not saved)* after a new one from List order. Keep?
9. **Undo back to where you started still shows Unsaved** until you save or
   discard (S3c's rule: nothing asks again until then). Keep?

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900 and 1280x700
(and the bar at 1024 wide), in Chromium, with keys and native drags. The
before and after pictures were taken by `scripts/fx4-shots.mjs`. The save
into the edit, its one undo step, refusing a Save made since, refusing an
archived edit, refusing when the edit cannot be read again, Save as… from
changes and from a saved edit, the leave and close questions' words and
their Save edit, a recovered copy, and a sign-out in the middle of a save
were checked through the real data layer in tests (`editDraftsProvider`'s
FX4 block). Two people on one edit was checked there by changing the stored
edit under an open change, and in Chromium by a second save landing between
the check and the write. A save that is slow, or never answers, was driven
in Chromium with the test data's writes held back: changes made meanwhile
(a drag, a row's ⋯, a New shot) kept; the leave question opening at once
and closing by itself; Escape staying; Discard leaving while the write
still hung; the window's close question not held by it.

**Not checked:** a real second person on the cloud, a real reviewer seat,
the desktop app (its window's close question shares the leave question's
words, checked by tests), staging or production.
