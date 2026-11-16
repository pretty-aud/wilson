# Walkthrough 40 — A2: D.O.G.'s chrome, part 2

Audrey — this is the second of the two D.O.G. sessions. Part 1 (walkthrough
36) did everything you see before you open anything. This one did the rest:
the two bars above the outline text, the little rewrite box, the right-click
menu, and every window D.O.G. opens — History import/export, the duplicate
picker, New project, Settings and Help. The slide preview itself was not
touched and has not moved a pixel.

You asked for no questions until the end (W14), so **the questions are parked
at the bottom**. Nothing here waits on them.

(Walkthrough 39 is B2's, the R.A.B.B.I.T. Tasks session running beside this
one, so this is 40.)

---

## 1. The two bars above the outline

Import any outline (the folder icon in the sidebar → Import), open a page, and
compare

`docs/sessions/handoffs/img/a2-dog-toolbars-before-1440x900.png` with
`docs/sessions/handoffs/img/a2-dog-toolbars-after-1440x900.png`.

- **"Edit output" bar.** Its five controls were three different heights; they
  are one height now and the bar is the app's standard toolbar. "Regenerate
  page" is the app's one primary button (deep orange, white text) where it was
  bright orange with small white text, which your "white or black on orange"
  rule forbids. The label "EDIT OUTPUT:" is grey instead of orange.
- **The formatting bar** (undo, redo, and in text view bold / bullets /
  numbers) was a thinner strip of small orange icons; it is the same standard
  toolbar with grey icons that brighten on hover. It is 14px taller, so the
  outline starts a little lower.
- Both bars now start at the same left edge as the tabs above them.

**Try:** type a change in "Describe changes" and press Enter (it still
regenerates); switch to text view and use the three formatting buttons on a
selection.

## 2. The right-click menu and the rewrite box

Select some text in the outline and right-click. Compare the `menu` pair.

- The menu is the app's standard menu: grey text and icons (they were all
  orange), one quiet hover (it was an orange stripe down the left), and the
  shortcuts shown in the small monospace the app uses for keys.
- Same eleven items in the same order. It now closes with Escape, and if you
  open it low on the screen it opens upward so all of it is on screen; the
  last rewrite options used to fall off the bottom.
- Pick a rewrite style: the box that appears is the app's standard floating
  panel. The new text is white and the text it replaces is grey (the new text
  was orange). "Replace" is the primary button.

## 3. History import/export

The folder icon in the sidebar. Compare the `history` pair.

- It is the app's standard dialog: one backdrop, one panel, the title in
  sentence case, a named ✕.
- **Export / Import** are the app's tabs (a thin orange line under the one you
  are on). "Export" used to be a solid orange block with white text. Each
  still fills half the strip, so a click anywhere on it still switches, and
  the window no longer changes height when you switch.
- The folder path is white when you have picked a folder and grey when it is
  the default, where it was light orange and a hard-to-read grey.
- The three options use the same checkbox as section 1. The image-model menu
  sits right under "Generate image prompts" instead of being indented further
  than anything else.
- **The download button moved to the bottom-right of the dialog**, where every
  dialog in the app keeps its main action. Same button, same wording. On the
  Import tab, "Import to history" is there too.
- Fixed on the way: pasting worked, but typing into the empty paste box used
  to lose your cursor after the first letter. It does not now.

## 4. The duplicate picker

Export a deck where two pages share a number. Compare the `resolver` pair.

- It is the app's widest standard dialog (960). The two versions sit side by
  side as before; the one you pick gets the thin orange edge and a faint
  orange tint, and its text brightens. "Continue" is the primary button.
- **Hover a version for half a second**: the slide preview still opens in the
  middle of the screen, the same size, in exactly the same place (measured to
  the pixel at both window sizes). Its frame is grey instead of orange. The
  "Hold..." hint while you wait is still there.

## 5. New project

Section 1 → New project. Compare the `new-project` pair.

- This was the one window on D.O.G. that looked like it came from another app
  (the critic's words): orange typing, thick frames, its own focus glow. It
  is the standard dialog now, with the standard fields.
- "Create project" is the primary button; it was white on bright orange.
- On a local project, the two "Click to upload" areas are the standard
  secondary button (the same as "Choose file" in section 1), and each picked
  file has a ✕ that says what it removes. Before, the upload areas could not
  be reached with the keyboard.
- Same fields, same order; clicking outside still closes it.

## 6. Settings

The ☰ menu → Tool settings. Compare the `settings` pair.

- It still slides in from the right at the same width (40% of the window).
  It is the app's standard side panel now, the first one in the app to use
  it, so it no longer needs its own workaround for the desktop app's title
  bar.
- **The lock.** "Locked" used to fade the whole panel to half strength, which
  made the prompt names unreadable (1.8 to 1 contrast). Now the lock greys out
  only what you cannot change: the text boxes and their "Reset to default"
  buttons. The section headers stay readable and still open and close.
- The lock switch is the app's standard switch. The tabs are the app's tabs.
- The sixteen section names are grey instead of orange; the prompt text in the
  boxes is white instead of orange.
- It now closes with Escape as well as the ✕ and a click outside. If Help is
  open on top of it, the first Escape closes Help and the second closes
  Settings.

**Try:** unlock, open "Single page – API system message", edit a word, press
"Reset to default"; lock again and check the box greys out.

## 7. Help

Settings → the ? at the bottom. Compare the `help` pair.

- The standard dialog at the reading width. It is narrower (720 instead of
  850), which keeps each line of help text to a comfortable length (about 65
  characters; it was about 100).
- The page you are on in the contents list has the faint orange tint and a
  thin orange edge, and the list no longer shifts by 2px.
- **Not changed:** the help pages' own text (their orange headings) — that
  text is shared with the app's main Help page, so it belongs to the last
  session (P1), not to D.O.G.

---

## Questions (parked for the end — W14)

**1. The caption under the preview.** "Preview is read-only…" is now upright
instead of italic. The critic also wanted it smaller (12px) and wrapped to a
shorter line. Both would change the height of the box the preview sits in by a
couple of pixels, and that box is measured to protect the preview. Allow the
two pixels, or leave it?

**2. Settings' width.** The app's standard side panel comes in three widths,
the widest 300px. Settings needs room for sixteen long prompts, so it keeps
its old width (40% of the window, at least 400px). This is recorded as a
request for a wider standard size. Fine?

**3. Things that now close with Escape** because they use the standard parts:
Settings, the right-click menu, and every dialog. Before, Escape did nothing on
Settings and the menu. Keep?

**4. The main button of each dialog moved to its bottom-right** (History's
download, the duplicate picker, New project). Same buttons, new place — the
app's standard. Keep?

**5. The duplicate picker's half-second hover and its "Hold..." hint** are
unchanged. The critic wanted a shorter delay and no hint; that changes how it
behaves, so it is yours to decide.

**6. Keys behind the windows** (unchanged, present before this session): with
a D.O.G. window open, the ← and → keys on a focused button still switch the
page behind it, Alt still flips Full deck, and Enter never presses a focused
button (it goes to the pet companion — Space works). Stop the first two while a
window is open?

**7. A warning that was already there:** hovering a version in the duplicate
picker makes the slide preview log "Maximum update depth exceeded" to the
developer console. It happened before this session too, and it comes from the
preview itself, which nobody may touch (C4). Nothing visible goes wrong. Worth a
look later?

**8. Carried from part 1 and earlier** (walkthrough 36, still open): the 8px
margins round the preview, the small-capital panel titles, the prompt boxes
that grow while you type, the Geist font's missing ▸ ✓ ✕ → glyphs.
