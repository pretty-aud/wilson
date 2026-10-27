# 79 — ONE MAIN AREA ON EVERY PAGE, AND D.O.G.'S SETTINGS AND DROPDOWNS NAMED

1. **Every page has one main area for a screen reader.** Before, only D.O.G.
   and O.T.T.E.R. had one. On Home, R.A.B.B.I.T., Settings, Team members, Help
   and the rest, a screen reader's list of landmarks had no main area at all.
   Now each page has exactly one, and a page you are not on is never counted.
2. **When a note goes and the thing you were on has gone too, focus goes to
   the page's main area.** Before, on every page but D.O.G. and O.T.T.E.R., it
   fell to the top of the window.
3. **D.O.G.'s settings sections say whether they are open.** The twenty
   folding sections in D.O.G.'s Settings drawer now tell a screen reader
   "collapsed" or "expanded".
4. **D.O.G.'s Project and Slide Layout Type dropdowns have names.** A screen
   reader used to say only "combo box". It now says each one's label.
5. **A test of the AI file store that runs on GitHub tries again when the
   network fails.** Nothing you use changed with it.

Nothing on screen looks different, apart from one moment: when focus goes to
a page's main area (point 2), the orange focus ring goes round that area, as
it already did on D.O.G. (walkthrough 78, step 13). That ring is yours to
decide on (§4).

**What this is.** FX15 of the post-overhaul plan
(`docs/sessions/briefs/po-fx15-fx14-leftovers.md`, your choice of
2026-10-26). Written 2026-10-26 against `feat/post-overhaul-edit-versioning`
(`po/fx15-fx14-leftovers`). No database change, no server function.

## 1. Step by step

On the development copy (port 5305, the `fx15-worktree` entry). Steps 1 to 4
need a screen reader. With NVDA, **Insert+F7** opens the elements list
(choose *Landmarks*) and **D** moves from one landmark to the next. With
Narrator, turn on scan mode (**Caps Lock+Space**) and press **D**.

| # | Do | You should hear or see |
|---|----|------------------------|
| 1 | Open **Home** and list the landmarks | One: *"main"*. Before, Home had none. |
| 2 | Open **R.A.B.B.I.T.**, open **Salt Hours**, and list the landmarks on any tab (try **Tasks** and **Budget**) | The top bar (*"banner"*) and one *"main"*. On Budget also the *"Bid versions"* region. Before, there was no main on any tab. |
| 3 | Do the same on **Settings**, **Team members**, **Help**, **D.O.G.** and **O.T.T.E.R.** | One *"main"* on each. D.O.G. also has the *"DECK OUTLINE"* side panel; O.T.T.E.R. its navigation and side panel; Help its navigation, now inside the main area. D.O.G. and O.T.T.E.R. sounded the same before; the others had no main. |
| 4 | In **D.O.G.**, Tab to the **Project** dropdown. Then press **Alt** (Single page) and Tab to the layout dropdown | *"PROJECT, combo box"* and *"SLIDE LAYOUT TYPE, combo box"*, in capitals as the labels are drawn. Before, both were only *"combo box"*. Click the word *Project* above the dropdown: the dropdown takes focus. Press **Alt** again to go back to Full deck. |
| 5 | In D.O.G., open **Settings** (the gear at the right end of the *Deck outline* bar). Tab to **Single Page - API System Message** | *"SINGLE PAGE - API SYSTEM MESSAGE, Core instruction sent as system message for single page generation, button, collapsed"*. |
| 6 | Press **Enter** | The section opens, as a click opens it, and the screen reader says *"expanded"*. Enter again closes it: *"collapsed"*. Every section on both tabs (*System prompts*, *Output format*) does the same. |
| 7 | Open **Team members**. On the last row (Theo Lindqvist) press **Deactivate**, then **Deactivate** in the window; press **Tab** once, then **Enter** on the note's × | As in walkthrough 78: the note closes and focus is back on Theo's Deactivate button, which is still there. |

**Where focus goes when a note leaves on a R.A.B.B.I.T. page.** R.A.B.B.I.T.'s
own notes come only from a teammate's change (a view they deleted), which the
development copy cannot make, so this was measured in Chromium, not walked:
a note on R.A.B.B.I.T.'s Tasks tab, focus on its × and the thing it came from
gone, then Enter. Focus now goes to R.A.B.B.I.T.'s main area; before, it fell
to the top of the window. The same on Team members. On R.A.B.B.I.T. the
orange ring does not show (the tool fills the window to its edges, which cut
the ring off); on Team members it shows as a line along the top and the
bottom of the page's area (`po-fx15-after-02-note-gone-team-members`, beside
`po-fx15-before-02-…`, where there is none).

## 2. Your answer (2026-10-26, verbatim)

| Question | Your answer |
|---|---|
| The next session | *"FX15: FX14's leftovers (Recommended)"*: one small session for four more R.A.B.B.I.T. test files that can flake the same way, D.O.G.'s settings sections and Project dropdown for screen readers, a main area on every page so focus never falls to the top, and a retry in the GitHub test that went red on one 502. No migration. |

No questions are open.

## 3. How it was checked

- **In Chromium, before and after**, at 1280x800 and 1440x900, the two sizes
  the same, reading Chromium's own accessibility tree (what a screen reader
  is given): the landmarks of all twelve pages and all ten R.A.B.B.I.T. tabs,
  D.O.G.'s two dropdowns' names, the twenty settings headers' state, and where
  focus went when a note left (`scripts/fx15-landmarks-names.mjs`).
- **Nothing else moved on screen.** Every page at rest was photographed before
  and after and compared pixel by pixel: identical at 1440x900; at 1280x800
  the only differences were the pet's sex (picked at random each time) and a
  few scrollbar pixels that also differ between two runs of the same code.
- **The tests**: the whole suite, plus new tests for each change, each shown
  to fail when its change is taken out.
- No sign-in, no AI call, nothing sent to a server.

## 4. Yours to decide (not blocking)

- **The ring round a page's main area.** When focus goes to a page's main area,
  the kit's orange ring goes round it: round D.O.G.'s column (walkthrough 78),
  and now along the top and bottom of Team members and the other plain pages.
  On R.A.B.B.I.T. the page fills the window to its edges and the ring is cut
  off, so nothing shows where focus went. Whether that area should wear the ring,
  or something else, is still your call (FX14's hand-off §6); nothing was
  changed.
