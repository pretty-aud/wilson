# 66 — THE STATUS BANNER, THE BID VERSION UNDER THE PROJECT, "SAVE EDIT AS…", THE TEAM GALLERY (R.A.B.B.I.T.)

1. **Every item's window has its status under its title again.** An
   asset, a task, a scene, a shot, a level and an experience: directly
   under the title, the status's dot and its word, and one line in the
   status's colour across the whole window, above the details. It is the
   same colour as the status in the item's row, and it changes the moment
   the status does (and back on an undo).
2. **The bid version sits right under the project.** On the Timeline the
   first thing under PROJECT is now **BID VER.** and its dropdown: first
   the project you are in, then the version you are working off. The zoom
   toolbar closes up where the bar used to be.
3. **"Save as…" on the Scenes tab reads "Save edit as…".**
4. **The Team tab has a gallery.** **Table** / **Gallery** at the top of
   the tab; the gallery shows one card per person with their profile
   picture (or their initials where there is none), their name, their role
   and their seat, and the same controls the list has. Your choice is
   remembered on this computer.

**What this is.** FX3, the third of the three fix sessions from your list
of 2026-10-11, with your two follow-ups of the same day on the first two
items (no green bar behind the word; the bar further left, reading
"Bid ver."). Nothing in the database changed; nothing needs applying
anywhere.

**Before you start.** The test data (the development copy's fixtures)
holds Salt Hours. Levels and experiences are switched on by adding
`?fixtures=game` to the address. The test data lives in memory: reloading
the page puts it back.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-fx3-before-<part>-NN-<state>-<size>.png` and
`po-fx3-after-<part>-NN-<state>-<size>.png` (`<part>` is banner,
versionbar, saveas or team; sizes 1440x900 and 1280x700), taken by
`scripts/fx3-shots.mjs`.

---

## 1. Step by step

### The status banner (every item's window)

Before: the status was a small badge under the title (before-banner 01–06).

| # | Do | You should see |
|---|----|----------------|
| 1 | Assets: open **Shooting Script v4**'s details | Under the title, **● FINAL** on the left, then a thin green line across the whole window, then the details. No green bar behind the word, no second grey line. (after-banner 01) |
| 2 | Tasks: open **Lock the shooting script**'s details | The same: **● FINAL** and the green line. (02) |
| 3 | Timeline: Budget → **Reset to bidding**, then Timeline, click the task **Lock the shooting script**; change its **Status** to **Blocked** | The line and the dot turn red and the word reads **BLOCKED** at once. (03) |
| 4 | Click the window's title (off the field), press **Ctrl+Z** | Back to **● FINAL** and green. (04) |
| 5 | Scenes: a scene's details, then Shots: a shot's details | The same banner on both. (05, 06) |
| 6 | Add `?fixtures=game`, Levels: a level's details; Experiences: an experience's | The same banner; *In progress* is orange. (07, 08) |
| 7 | Scroll a long window's details | The banner stays under the title; only the details scroll. |

### The bid version bar (Timeline)

Before: the bar was its own row under the zoom toolbar (before-versionbar 01–04).

| # | Do | You should see |
|---|----|----------------|
| 8 | Open the Timeline | Under **PROJECT Salt Hours**, the next row is **BID VER.** with the dropdown (greyed while the budget is locked) and the sentence about the lock; then the summary, the minimap, the legend and the zoom toolbar, with nothing under the toolbar. (after-versionbar 01) |
| 9 | Hover **BID VER.** | The tooltip says "Bid version". |
| 10 | Budget → **Reset to bidding**, back to the Timeline | The dropdown live on **Current**, **Save as new version…** at the right. (02) |
| 11 | Choose **Bid v1** in the dropdown | *Viewing bid version: Bid v1 …* with **Edit this version** and **Current**; the row takes its grey wash, as before. (03) |
| 12 | **Edit this version**, answer its question | *Open: Bid v1 … · Saved …*, **Save** and **Save as new version…**. (04) Every control, state and sentence is the same as before; only the place changed. |

### "Save edit as…" (Scenes)

| # | Do | You should see |
|---|----|----------------|
| 13 | Open the Scenes tab | The shot-list bar reads **Save edit as…** where it read *Save as…*; everything still fits on one line, down to a 1024-wide window. (before/after-saveas 01) |
| 14 | Click it | The same dialog as before: *Save as a new version*, its title and its **Save new version** unchanged. (02) |
| 15 | Help → R.A.B.B.I.T. → the shot-list card | **Save edit as…** in its list of the bar's verbs. |

The Budget's and the Timeline's **Save as new version…** keep their name.

### The Team gallery

Before: the roster as a list only (before-team 01).

| # | Do | You should see |
|---|----|----------------|
| 16 | Open the Team tab | **Table** and **Gallery** at the top left; **Table** chosen; the roster list exactly as it was. (after-team 01) |
| 17 | Click **Gallery** | One card per person, in the list's order (managers, then members, then reviewers, by name): the picture, the name, the role, and in the card's foot the seat dropdown and the remove button. (02) |
| 18 | Press **Tab** until the first card is ringed, then the **arrow keys** | The ring moves card to card; up and down move by a row. **Home** and **End** go to the ends. (03) |
| 19 | Press **Enter** on a card | You are in the card: its seat dropdown is ringed. **Escape** brings you back out to the card. (04) |
| 20 | Change a seat in a card; remove someone (it asks first, as the list does) | The same as in the list. |
| 21 | Leave the tab and come back, or reload | Still **Gallery**: the choice is kept on this computer. |
| 22 | As a reviewer on the project (cloud) | The cards show the seat as a label, with no dropdown and no remove, as the list does. |

On the Local Server the Team tab's table has the same **Table / Gallery**
switch after its grouping, and the same cards (with the role dropdown and
the remove the table has).

---

## 2. How to check it

Do each part at a large window and again at 1280 by 700. Everything above
works on the test data in the development copy except step 22 (a cloud
project where you are a reviewer) and the Local Server's Team table
(checked by automated tests). **Pictures in the test data are generated
initials, drawn as circles**, so the cards crop them; a real photo fills
the picture area, cropped from its top third where a face is.

---

## 3. The numbers, measured

- **Tests:** 336 test files / 8,097 tests (2 skipped) at the start; 339 /
  8,132 (2 skipped) at the end of the four items, all passing.
- **The banner:** 28px tall, edge to edge, its dot on the title's left
  edge; the line is 1px. In every window: the title row, then the banner,
  then the details (asset 1152px wide, task 960, scene, shot, level and
  experience 896).
- **The bid version bar:** at 1440x900 and 1280x700, in all four states,
  the project title row ends and the bar begins at the same pixel (180);
  **BID VER.** starts at x=24, the page's edge, where the title row's own
  contents start; the dropdown, the sentence and the buttons are the same
  widths as before to the pixel; the gantt starts where it did (505).
- **Save edit as…:** 106px; the bar fits on one line at 1440, 1280 and 1024.
- **The Team gallery:** three cards a row at 1440 and 1280 (inside the
  roster's column), each picture area 144px tall. The pictures are asked
  for in **one** request for the whole roster, kept for an hour, and only
  the ones on screen load.

---

## 4. Still not right, and not this session's to change

- **The roster list, the Team page and the presence avatars still use the
  picture's public address.** The gallery reads each picture through a
  signed, expiring link, as your files are read; everything else that draws
  an avatar still uses its public address, and the avatars bucket is still
  readable by anyone with the app's public key (the security audit's
  TPN-CLOUD-004). Making the rest signed, and the bucket private, is a
  separate change.
- **There is no member sheet to open.** A row in the Team list opens
  nothing, so a card opens nothing either; **Enter** takes you into the
  card's controls.

---

## 5. Questions, when you test

1. **The banner's word.** You asked for "just the color dot and the color
   line"; the word stays beside the dot so the status is never told by
   colour alone (and the window's fields already show it too). Keep the
   word, or the dot alone?
2. **The line's weight.** It is 1px. The one before the overhaul was
   thicker (about 3px); the app's rule since the overhaul is no line of 2px
   or more except a short list you approved by hand. Keep 1px, or add the
   banner's line to that list at 2 or 3px?
3. **The Team gallery's width.** The cards sit inside the roster's column
   (three a row). Keep, or let the gallery use the whole width (five or six
   a row)?
4. **Save edit as…'s dialog** is still titled *Save as a new version*.
   Rename it to match ("Save edit as a new version")?
5. **The other avatars** (§4): sign them all and make the bucket private?

---

## What was checked, and what was not

Checked in the development copy with its test data, at 1440x900 and
1280x700 (and 1024x700 for the Scenes bar), in Chromium through
`scripts/fx3-shots.mjs`: the six windows, the status change and its undo
on the Timeline, the four bar states with their measurements, the Scenes
bar and its dialog, the Team list, the gallery, the arrows and Enter. The
Timeline's rows probe (`timeline-rows-probe.mjs`) passes at both sizes.
The signed pictures, the one request, the hour's cache, a picture that
cannot be read, one that fails to load, a reviewer's cards and the Local
Server's gallery were checked by automated tests against a stand-in for
storage, not against a real bucket: the test data's pictures are generated
in the page. Nothing was run signed in to a real project, and the desktop
app was not opened.
