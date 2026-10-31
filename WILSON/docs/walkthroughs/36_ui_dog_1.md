# Walkthrough 36 — A1: D.O.G.'s chrome, part 1

Audrey — this is the first of the two D.O.G. sessions. It covers everything
you see on D.O.G. before you open a dialog: the Deck Outline sidebar, the two
numbered sections, and the top of the Generated Output panel (its buttons, the
page tabs and the text / preview switch). The slide preview itself was not
touched, and neither was anything inside Settings, Help or the history dialog
beyond their title bars — that is part 2.

You asked for no questions until the end (W14), so **six questions are
parked at the bottom** instead of being asked. Nothing here waits on them.

---

## 1. The page at rest

Open D.O.G. Compare

`docs/sessions/handoffs/img/a1-dog-before-1440x900.png` with
`docs/sessions/handoffs/img/a1-dog-after-1440x900.png`

(and the same pair at `1280x700`).

| | before | after |
|---|---|---|
| section titles | orange, 14px, a filled orange circle with a white number | one quiet treatment: small capitals in grey, a thin circle round the number, a hairline under the bar |
| field labels ("PROJECT", "UPLOAD DOCUMENTS"…) | orange | light grey — orange now marks only what is on or selected |
| the section boxes | a hard drop shadow, three shades of grey | one flat panel colour and a hairline, no shadow |
| "New project", "Choose file" | orange text on grey boxes | the app's standard secondary button |
| "Generate page outline" | an orange bar with dark text and a drop shadow | the app's one primary button (deep orange, white text) |
| the Full deck toggle | hand-made, orange label | the app's standard switch |
| the three checkboxes | orange ticks, unlabelled for screen readers | the same checkboxes, named |
| the red "generation failed" and amber "theme colours" boxes (they only appear when something goes wrong) | hand-made boxes | the app's standard warning banners; the amber one's ✕ still dismisses it |

Everything you could click is still there and does the same thing. The
sidebar is 16px wider (240 instead of 224): it is now the app's standard side
panel, the same one O.T.T.E.R. and Files will use.

**Try:** collapse and reopen section 1 by its title bar; switch Full deck on
and watch section 2 grey out and fold, then off; pick the Salt Hours project.

## 2. With a deck open

Import any outline (the folder icon in the sidebar → Import), click two pages
in the sidebar, and compare

`docs/sessions/handoffs/img/a1-dog-preview-before-1440x900.png` with
`docs/sessions/handoffs/img/a1-dog-preview-after-1440x900.png`.

- **The page tabs** are the app's tabs now: a thin orange line under the page
  you are on, no boxes. Each tab's ✕ sits next to the tab instead of inside it
  (it used to be a button inside a button, which screen readers read as one).
- **Export .md / Copy** were small orange buttons with white text — the exact
  thing your "white or black on orange" rule forbids. They are ordinary
  secondary buttons now.
- **The text / preview switch** (the two icons at the right of the tab row)
  shows the one you are on with a thin orange edge instead of a solid orange
  square.
- **The sidebar rows**: a page that is open in a tab has a thin grey edge on
  its left. Hover a row and the ✕ to remove it still appears where the time
  was.

## 3. The slide preview — why the page has tighter margins

The preview is a fixed-size slide inside a window that clips it, so the width
the page leaves for it is exactly how much of the slide you see. You asked for
it not to move (C4), so this session measured it before touching anything and
after every change, at both window sizes, in both places it appears (the output
panel and the duplicate-page picker). **It has not moved a pixel.**

The cost is visible: the panels now sit 8px from the sidebar and the window
edge, where they used to sit 16px away. The standard side panel is 16px wider
than the old sidebar, and that 16px had to come from somewhere other than the
preview. (The frame drawn round the preview also lost its thick grey border,
and a 2px strip of the same black keeps the width. You cannot see the strip.)

## 4. Settings and Help — the title bars only

Open Settings (the ☰ menu → Tool settings) and its Help (the ? at the bottom).
Their title bars now match the section bars. The sixteen collapsible prompt
headers inside Settings now react when you hover them; they were written with
a colour that does not exist, so they never had. Everything else in Settings
is still its old self — that is part 2.

---

## Questions (parked for the end — W14)

**1. Margins.** The main column sits 8px from the sidebar instead of the 24px
the rest of the app uses, to keep the preview exactly where it was. The other
options were a preview 32px narrower, or a narrower sidebar with its four
buttons moved onto a second row. Keep 8px?

**2. Section titles in small capitals.** The critic wanted them bigger (16px,
normal case). The app's side panel uses small capitals for its title, and all
six title bars on D.O.G. now match it. Keep, or make panel titles larger
app-wide?

**3. "Full deck" and "CORE / REF".** The switch's label is now normal-size
text ("Full deck"); the Core / Ref tags on a project's files are now the app's
standard toggle chips ("CORE" / "REF" in small capitals, the orange edge when
on). Fine?

**4. Additions you did not ask for** (all accessibility, all from the app's
standard controls): the sidebar's remove ✕ now also appears when you reach it
with the keyboard; every icon-only button has a hover tooltip; the checkboxes
and the switch announce themselves to a screen reader.

**5. Things left exactly as they were because changing them changes
behaviour** — say if you want any of them: the two prompt boxes still grow
taller while you type in them; the sidebar's time still disappears when you
hover a row; the output panel still says "No output yet" while a full deck is
generating.

**6. (From V1, still yours.)** May a session download the Geist font's release
to check whether it draws ▸ ✓ ✕ → ? D.O.G.'s outlines use ▸ everywhere, and
today those glyphs fall back to Segoe UI.
