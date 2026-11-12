# Walkthrough 38 — Bins, on the kit

UI overhaul bundle **B6**, plan §5 Wave 3, lane B. Branch `ui/b6-bins`,
integrated into `feat/ui-overhaul`. Nothing here reaches the beta:
`feat/multi-user-v1` is untouched. Per W14 nothing here waits on you; read it
in the final pass. (Walkthroughs 36 and 37 are A1's and B1's.)

The Bins tab was the seed of the whole kit — F1 lifted its buttons, dialogs,
menus and fields out to become everyone's — and then, on your ruling, kept its
own copies until its own session. This is that session. The tab now draws
with the same pieces as every other screen, and the four things the review
found worst about it are fixed.

**No control moved, no view changed, no key changed what it does.** One thing
left the screen, on your ruling (Q10): the shortcut bar along the bottom. What
it carried is all still there, somewhere else — below.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

Bins only exist in Local Server mode in the desktop app, so the honest test is
the packaged build with your own bins (below). The dev server can show a fake
project with twelve files: in `WILSON/.env.local` add `VITE_DEV_AUTOLOGIN=tester`
and `VITE_DEV_FIXTURES=1`, then `cd WILSON && npm run dev`, open R.A.B.B.I.T.,
click Salt Hours, then Bins. The pictures are in `docs/sessions/handoffs/img/`:
`b6-before-*` and `b6-after-*`, the Bins and Scenes tabs at 1440x900 and at
1280x700.

---

## The one to look at first: move the mouse

Before, **no button on the Bins tab reacted to the mouse.** Every one of them
declared a hover colour and then painted over it, so the Add button, the view
switch, the filters, the chips, the marks in the inspector and every dialog's
buttons all sat perfectly still under the pointer. Now they all respond, the
orange Add button included (it darkens; it does not turn grey).

And **every row now answers the pointer**: the bins on the left, every line in
the list view, every tile in the frame view, the shots in "Assign to shot" and
the files in "Add takes". In a sixteen-column list, that line under the mouse
is what stops your eye losing its place across the row.

## What else you will see

- **The words are readable.** Two of the greys the tab used were too faint to
  pass the contrast rule — the column headers, the field labels, the file
  paths, the counts, and the shortcut bar itself at 2.6:1. They are the app's
  three-step grey now. On the fake project the tab went from **51** pieces of
  text below the line to **none**.
- **The small type tags on the posters** (VID, AUD, IMG) sat on the picture
  with nothing behind them and were hard to read on a dark or brown frame.
  They have their own small tinted backing now, so they read the same on any
  poster, in any row, selected or not.
- **The typewriter face is only on data now**: file names, slates, takes,
  rolls, days, timecodes, sizes, codecs. Bin names, scene names, labels and
  sentences are in the app's normal face. File names in the list and on the
  tiles are a touch bolder, so a row reads name-first.
- **Dialogs are the app's dialogs**: the same shape, width steps, title and
  buttons as everywhere else. They also move the keyboard into themselves
  when they open (Tab stays inside them), which the old Bins ones never did —
  and when they close, the keyboard lands where it used to, so Space still
  plays and Enter still renames.
- **The three Windows pop-ups are gone** (your W9): "Remove 7 files from the
  bin?" and "Discard this batch?" are the app's own dialogs now, with the
  same words. They open with Cancel / Keep editing ready, so a stray Enter
  can never delete anything.
- **Offline files** (a drive that is unplugged) used to look faded — so faded
  they failed the contrast rule. They now go to the quiet grey instead,
  readable, and clearly quieter than the rest; the poster still says OFFLINE.
- A few measured fixes you may notice: the Day column no longer breaks a date
  over two lines; the Codec column fits "PRORES 422 HQ"; the Slate and Take
  fields in the inspector line up side by side (one sat lower than the other);
  the colour swatches fit on one line; the bins list rows are a little taller.

## Where the shortcut bar went (Q10)

"No shortcut bar anywhere" — it was the only one in the app, and it is gone.

- **Every key it listed** is in **Help → Shortcuts & Tips**, in a new card,
  "Bins: the keyboard". It lists what the keys actually do, which is more
  than the bar ever showed: Home / End, Ctrl+A, 0 clears the colour, Enter
  renames as well as F2, redo.
- **The count on its right** ("12 files in 5 bins · 3 offline") is at the
  bottom of the bins list on the left.
- **The green light and the LIVE pill** that sat in its corner are in the
  project bar at the top now (B1's change), on every tab.
- The keys themselves work exactly as before; the bar only ever showed them.

## Please check in the desktop app, with your real bins

The fake project cannot show these, and they matter:

1. A bin with **offline files**: are they readable, and still obviously
   offline?
2. **Your real footage posters**: are the VID / IMG / AUD tags readable on
   them?
3. **Add files** from a folder: the dialog opens with the cursor on the first
   batch field; tick and untick; press Escape after changing something — you
   should be asked "Discard this batch?".
4. Close any dialog with its **Cancel** button, then press **Space** with a
   video selected — it should play, as it always did. (Round one of the review
   caught this breaking and it was fixed.)
5. At **125 and 150 percent** Windows scaling, the toolbar and the selection
   bar.

## Questions for you (nothing waits on them)

1. **Coloured chips and marks.** An active filter chip (Video, Selects…) and
   the inspector's Select / Reject / Circled now show their colour as a soft
   tint with a coloured edge, not a solid block — white text on the solid
   colour was too faint to read. Keep it, or go back to solid?
2. **Orange text in a selected row.** The orange slate line on a tile ("1A ·
   T1 · A cam") and the orange "1 shot" in the list turn white when the row is
   hovered or selected, because orange is too faint on the highlight. Fine?
3. **Chips with your own words** — a camera, a day, a scene name, a tag — keep
   the case you typed ("camera-original"). The other chips are in capitals
   (VIDEO, SELECTS). Fine?
4. **The count "12 files in 5 bins"** is now at the bottom of the bins list.
   Is that where you would look for it?
5. **An orange frame around the files area** appears once you use the keyboard
   there (the arrow keys, Shift-click). It tells you the keys are going to that
   pane; before, there was no sign at all. Keep it?
6. **Offline files** are quiet grey instead of faded. Still obviously offline?
7. **"Clear Esc"** — the Clear button in the selection bar still shows its key.
   Keep?
8. **Still on the list from the review**, not done because each changes a
   control or needs your eye: the tile-size slider (steps instead of a slide?);
   the media-type colours (video's orange is one of the retired oranges); the
   toolbar sitting on two lines and the selection bar wrapping; grouping the
   long right-click menu and the filter row.

One thing that is not Bins but you will meet here: in the app, **pressing
Enter on a focused button does nothing** anywhere — the pet's keyboard
shortcut catches Enter first. It predates this work and is noted for the
foundation session.

---

What was measured, what was fixed after two review rounds, and every
difference between the old Bins pieces and the app's shared ones are in the
hand-off, `docs/sessions/handoffs/ui-b6-2026-09-23.md`.
