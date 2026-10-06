# Walkthrough 49 — Post-overhaul S2a: each tool's settings in its own bar, the orange you named, and the pet's Shift

Audrey — this is your C1, C3, C6, C7, C8 and C12 from 29 September, done
as you ruled them. Four things changed:

1. **Help and Settings sit at the right end of every tool's own bar**, in
   the same spot in D.O.G., O.T.T.E.R. and R.A.B.B.I.T.
2. **"Tool settings" is gone from the menu strip** for all three tools.
3. **The orange you asked for, exactly where you named it**, and nowhere
   else.
4. **The pet opens on a tap of Shift**, and Enter now presses whatever
   button has focus.

Nothing else moved. You said not to wait for your report (A7), so this was
built, checked twice by independent reviewers and merged onto the
post-overhaul branch. The beta does not have it yet: the whole branch goes
to the beta together (A10).

**What I checked, and where.** Everything was checked in the development
copy with its test data, at 1440x900 and 1280x700. The bars were also
checked at 1024x700, and at the smallest desktop window zoomed in with
Ctrl+= once, twice and four times. The screenshots are in
`docs/sessions/handoffs/img/`, named `po-s2a-…`, each "before" beside its
"after" where there is one.

> 🚨 **One warning before you test.** If a file is selected in
> R.A.B.B.I.T.'s **Bins**, Bins' keys keep working after you leave
> R.A.B.B.I.T. (section 4, first item). Press **Escape** in Bins to clear
> the selection before you go to another page, and don't press Delete or
> Backspace on another page while a Bins file is selected.

---

## 1. What you will see

### Help and Settings at the right end of every tool's bar

Each tool's bar (the dark strip under the orange header) now ends with two
small icons: **Help** (the question mark), then **Settings** (the gear).
They sit at exactly the same place in all three tools, so the gear is
always under the same spot.

- **Help opens that tool's own Help window**, the same one the settings
  panel's footer opens, not the app's Help page.
- **Settings opens that tool's settings panel** (the slide-out on the
  right).
- Hovering shows the name: "Help & documentation", and "D.O.G. settings",
  "O.T.T.E.R. settings" or "R.A.B.B.I.T. settings".
- **R.A.B.B.I.T.:** the two icons were already there, the other way round.
  They swapped, so the gear is last, as in the other two.
- **O.T.T.E.R.:** the two icons sit after Validate, with a small gap.

Shots: `po-s2a-strip-dog-before-1440x900.png` →
`po-s2a-strip-dog-after-1440x900.png`, and the same for `otter` and
`rabbit`, at both sizes.

### D.O.G.'s "Deck outline" bar runs the full width

The bar with **Deck outline** and its four buttons (Undo delete, Redo
delete, Import/export history, Clear history) used to be the top of the
left sidebar and stopped at the sidebar's edge. It now runs across the
whole window, at the same height as the other tools' bars, with Help and
the gear at its right end. The four buttons do exactly what they did.

The page below it moved down by the bar's height (37px). **The slide
preview's box is exactly the size it was** (section 3). One thing to look
at: at 1440x900 in the desktop app, the "Generate page outline" button now
sits right at the bottom edge of the window. That is worked out from the
browser's measurement plus the desktop app's title bar; it was not measured
in the desktop app (question 2).

Shots: `po-s2a-before-dog-1440x900.png` → `po-s2a-after-dog-1440x900.png`,
and the same at 1280x700.

### The menu strip

The menu that opens from the three lines at the top right no longer has
**Tool settings** on a tool page. It reads Home, the other tools,
Dashboard, then Resources and **App settings**, as on every other page.

O.T.T.E.R.'s settings panel had a tab also called "Tool settings". It is
now **Storage & data**: it holds where your library lives and the data
tools.

### The orange you asked for

Only these, each on a dark ground where it reads clearly:

| Where | What is orange |
|---|---|
| D.O.G. | The two section titles, **1 Project documentation & deck context** and **2 Generate page outline**, and their numbers. The circle around the number stays grey. |
| D.O.G. | Under the pointer, the section's header lightens and **the title turns white** there (orange on that lighter ground would be hard to read). It turns orange again when the pointer leaves. With **Full deck** on, section 2 is grey, as before, and stays grey under the pointer. |
| O.T.T.E.R. | The **Course library** title on the library page. No other page title. |
| O.T.T.E.R. | **The keys' letters** in both shortcut tables: the Hotkeys page and the table inside Search. The key's box and edge are unchanged. In Search, rows that don't match what you typed stay grey. |
| O.T.T.E.R. | On a lesson page, the **Key takeaways** and **Practice exercise** titles and their two icons. The cards' edges are unchanged. |

**Selected text turns white.** If you select one of these with the mouse,
it shows white while it is selected, because orange on the selection's
orange tint would be hard to read. It is orange again when you click away.

Unchanged on purpose: the generate buttons (they are already the orange
button when they can be pressed, your C2), every field label, "Generated
output", the progress bars and the links in lessons (your answers to 80 and
81 in walkthrough 47).

Shots, each at both sizes: `po-s2a-dog-document-loaded-…` (a document
attached, so the generate button is lit), `po-s2a-dog-header-hover-…`,
`po-s2a-otter-library-…`, `po-s2a-otter-hotkeys-…`,
`po-s2a-otter-search-hotkeys-…` and `po-s2a-otter-lesson-cards-…`.

### The pet: a tap of Shift

**Tap Shift on its own** (press it and let go, nothing else) to open or
close the pet's chat. It does nothing while you are typing in a box, and
nothing while a window (a dialog, a menu or a settings panel) is open.
Shift with another key (Shift+Tab, a capital letter, Ctrl+Shift+Z), Shift
held while you click or scroll, and Shift held down for more than half a
second never touch the pet.

**Enter now presses the button that has focus.** Tab to a button, press
Enter, and it does what a click does, in every tool and every window.
(Before, Enter opened the pet instead, and only Space worked.)

**D.O.G.'s own Enter shortcut still works where it did.** On D.O.G.'s
page, with a document loaded and no outline yet, Enter starts the
generation when nothing is focused, or when one of D.O.G.'s option boxes or
the Full deck switch is (it no longer flips the switch back). With any
other button focused, Enter presses that button. It never starts a
generation from another page, or while a window or the settings panel is
open.

---

## 2. How to check it

Read the warning at the top first. Do each step at a large window and
again at a small one (1280 wide by 700 tall).

1. Open **D.O.G.**, **O.T.T.E.R.** and **R.A.B.B.I.T.** in turn. In each,
   the question mark and the gear are the last two icons at the right end
   of the dark bar, in the same place.
2. In each tool, click the **question mark**: the tool's own Help window
   opens. Close it. Click the **gear**: the settings panel slides out.
3. Open the **menu** (three lines, top right) on a tool page: there is no
   "Tool settings".
4. In O.T.T.E.R.'s settings panel, the second tab reads **Storage & data**.
5. In **D.O.G.**, look at the two section titles: orange, with orange
   numbers. Move the pointer over a section's header: the title turns white
   while the header is lit. Switch **Full deck** on: section 2 turns grey
   and stays grey under the pointer.
6. In **O.T.T.E.R.**: the library's **Course library** title is orange.
   Open the course, then **Hotkeys**: the keys' letters are orange. Press
   **Search**, type a shortcut's name (for example "Blade") and pick the
   Keyboard shortcuts result: the matching row's keys are orange, the
   others grey. Open a lesson: **Key takeaways** and **Practice exercise**
   are orange.
7. **The pet:** click somewhere empty on the page, then **tap Shift**. The
   chat opens. Tap it again: it closes. Click into any text box and press
   Shift: nothing happens to the pet.
8. **Enter:** press Tab until the gear in a tool's bar is focused (it shows
   an orange ring), then press Enter: the settings panel opens. Do the same
   on a dialog's button (for example, a delete question's Cancel): Enter
   presses it.
9. **Zoom:** in the desktop app at its smallest window, open O.T.T.E.R. and
   press **Ctrl+=** up to four times. The tab icons drop away in steps so
   every tab stays fully visible, and the question mark and gear stay at
   the right end. Shots at four presses: `po-s2a-strip-zoom-otter-711x486.png`
   (an admin) and `po-s2a-strip-zoom-otter-member-711x486.png` (a member,
   with "Requests").

---

## 3. The numbers, measured

**Where the two icons sit** (left edge, top edge, in pixels; each icon is
28 by 28; the gear's right edge is 24px in from the window's), from
`scripts/tool-strip-probe.mjs --check`. They are identical in all three
tools at every size, for an admin, a member and local mode:

| Window | Help | Settings |
|---|---|---|
| 1440 x 900 | 1356, 103 | 1388, 103 |
| 1280 x 700 | 1196, 103 | 1228, 103 |
| 1024 x 700 | 940, 103 | 972, 103 |
| 935 x 639 (smallest window, Ctrl+= once) | 851, 99 | 883, 99 |
| 853 x 583 (twice) | 769, 51 | 801, 51 |
| 711 x 486 (four times) | 627, 51 | 659, 51 |

The top edge moves at the zoomed sizes because the orange header itself is
shorter there; all three bars move with it.

Every tool's bar is 37px tall (36 plus its hairline). O.T.T.E.R.'s last tab
(Validate) is fully visible at every size above: as an admin, as a member
(whose "Requests" tab is wider than "Admin") and in local mode. Its tab
icons drop in steps to make room. With seven tabs they go when the tab
list is under 630px wide, with six under 530px, and Search's icon and
Edit's little arrow go when the window is under 742px. The tightest case is
a member at four zoom steps, with 8px to spare.

**The slide preview (your C4):** `scripts/dog-preview-probe.mjs --check`
passes before and after, at both window sizes and in both places the
preview is drawn. Its measurements are identical, byte for byte.

**The orange** (legibility against the ground it sits on; 4.5 is the bar
for text, 3 for an icon), from `scripts/orange-probe.mjs --check`:

| Where | Ground | Ratio |
|---|---|---|
| D.O.G.'s section titles and numbers | the card | 4.54 |
| the same under the pointer (turned white) | the lit header | 12.15 |
| Course library | the page | 4.91 |
| the keys' letters (both tables) | the key's box | 5.55 |
| the lesson cards' titles and icons | the card | 4.54 |

Orange on the lit header would be 3.86, and on the selection's tint about
3. Both are below the bar, which is why the text turns white there.

---

## 4. Still not right, and not this session's to change

- 🚨 **Bins' keys work from every page.** While a file is selected in
  R.A.B.B.I.T.'s Bins, its keys still act when you are on another page.
  This session's review saw Enter do it: it quietly starts renaming the
  file, out of sight. By the code, Delete or Backspace will remove up to
  five selected files from the bin without asking, and S, R, U, C and the
  number keys will flag, circle or colour them. Undo in R.A.B.B.I.T. brings
  a removal back. The fix belongs to the next session that works on Bins
  (`docs/OUTSTANDING.md`, S2a-01).
- **Home's arrow keys still reach every page** (P1-03). After you press ↑
  or ↓ anywhere, Enter can take you to a Home destination instead of
  pressing the focused button. It is the one place left where Enter does
  not press what is focused, and it lives in Home, which you ruled stays as
  it is apart from its fonts (question 4).
- **Space in O.T.T.E.R. still opens Search** from a focused button (P1-02),
  so press Enter, not Space, on O.T.T.E.R.'s buttons.
- **A few older pop-up windows don't count as windows for the Shift
  rule:** the "Close WILSON" question, the Timeline's task editor and its
  "extend the phase?" question, the AI's change preview and the hatch
  window. With a button in one of them focused, a tap of Shift opens the
  pet's chat underneath (S2a-02).
- **The settings panels don't take the focus when they open** (S2a-03).
  After opening one with Enter, Tab goes through the page behind it first
  (16 presses to reach O.T.T.E.R.'s panel), and closing it leaves the focus
  nowhere rather than back on the gear.
- **R.A.B.B.I.T.'s settings panel still titles itself "RABBIT settings"**
  inside the panel (S2a-07). The gear says "R.A.B.B.I.T. settings". The
  panel's file belonged to the Timeline session this week; a later session
  can match it.
- **Zoomed in more than four steps on the smallest window**, O.T.T.E.R.'s
  tab list scrolls sideways and shows a thin scrollbar under the tabs,
  which makes its bar a little taller there (S2a-05).
- **An egg has no chat.** A tap of Shift opens the chat for a hatched pet.
  An egg has no chat window to open, as before (clicking the egg pets it).

---

## 5. Questions, when you test

1. **D.O.G.'s sidebar width** (this continues walkthrough 47's question 64).
   It is 240px because its header had to hold the title and four buttons,
   and that header has gone into the new bar. At 200px the page would get
   40px back and the slide preview would show 40px more of its slide. That
   changes the preview's box, so it is your call under C4. Keep 240, or
   200?
2. **The new bar's height in D.O.G.** It takes 37px from the page below, so
   at 1440x900 in the desktop app the "Generate page outline" button sits
   right at the bottom edge. Fine, or should D.O.G. find the room somewhere
   else?
3. **The pet over a window.** A tap of Shift does nothing while a dialog, a
   menu or a settings panel is open, so the pet never appears over one.
   Fine, or should Shift open the pet there too?
4. **Home's Enter** (section 4): fix it, which means a change to Home beyond
   its fonts, or leave it?
5. **"Storage & data"** for O.T.T.E.R.'s second settings tab: fine?
6. **Two oranges for text.** This week the Timeline's phase names (your B1,
   the other session) got a lighter orange made for small text, because the
   standard orange was hard to read on the phase rows' tinted band. The
   places in this walkthrough use the standard orange, as the plan said,
   and each reads clearly where it is (section 3). Keep the two, or use the
   lighter one for all orange text?

---

## What was checked, and what was not

Checked in the development copy with the test data at 1440x900 and
1280x700, with the bars also at 1024x700 and the three zoomed sizes. Three
scripts measured the running app and fail on any miss. The test suite
passes in full, and 38 deliberately broken versions of this work were each
caught by it. The pet and Enter were checked by a scripted run in the
browser; the test data's pet is an egg, so the run drew it as hatched to see
the chat open and close. D.O.G.'s Enter shortcut was checked the same way,
with no request leaving the machine.

**Not checked:** the packaged desktop app (the development copy only), a
real non-admin O.T.T.E.R. account (the numbers measure the longer
"Requests" label instead), Windows display scaling at 125% and 150%, and
Mac keys.
