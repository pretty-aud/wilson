# 20 — UI overhaul, Foundation 1: the face, the tokens, the kit

**What this is.** The first of the UI overhaul's sessions
(`docs/design/UI_OVERHAUL_PLAN.md` §5, bundle F1). Nothing you use changes;
what changes is what everything is made of. The app now boots in one
typeface (Inter, self-hosted), every colour, size and spacing value lives in
one place (`@theme` in `src/index.css`) with a test that measures each one,
and the shared component kit (`src/ui/`) exists — promoted from the Bins
tab's own primitives, which were the best-built corner of the app.

Your words, 2026-09-11: *"these tools are all part of one large ecosystem and
should have a shared visual language … make sure we have uniform font sizing
for body, titles, etc. … everything seems to use fonts that dont look super
contemporary."* This session is the part of the answer that has to exist
before the visible part (Wave 1, the type pass) can be banked.

Written 2026-09-11 against `feat/ui-overhaul`, session branch
`ui/f1-foundation`. Works on both backends; nothing here touches data.

**What you will NOT see yet.** The sizes, the uppercase, the monospace
everywhere, the 2px borders — all of that is Wave 1 (the codemod). This
bundle is deliberately quiet: the face, the Files page's chrome, keyboard
focus, and the Bins tab (see step 7).

---

| # | Do | You should see |
|---|----|----------------|
| 1 | `git checkout feat/ui-overhaul && git pull --ff-only && npm install && npm run dev` (port 5203), or run the packaged build once one is cut from this branch. | The sign-in screen. **LOGIN**, COMPANY and the CONTINUE button are now set in **Inter** — a geometric-humanist face, visibly different from the Windows Segoe UI you had (compare `docs/sessions/handoffs/img/ui-f1-before-root-1440x900.png` and `…after…`). Everything else about the screen is the same. |
| 2 | Sign in and look at **Home**. | The six page buttons, the Resources column, the titles — all Inter, at their old sizes and weights (Home is fonts-only, constraint C3). Layout, icons and spacing unchanged. |
| 3 | **D.O.G.**, then **O.T.T.E.R.**, then **R.A.B.B.I.T.** — scroll a long panel in each. | The scrollbars look as they did: 8px, a grey thumb that turns orange on hover. They are now one shared class (`wilson-dark-scroll`) instead of a stylesheet D.O.G. injected into every page. O.T.T.E.R.'s Settings panel and Requests view still scroll with the same thumb (they used to depend on a class defined inside D.O.G.). |
| 4 | Any page: press **Tab** a few times. | A 2px orange ring appears around the focused control on dark pages, black on light ones. Click a control with the mouse instead: **no ring** (it fires on keyboard focus only). Before this, roughly 80 controls had no visible focus at all and the rest had one of four different rings. |
| 5 | Menu (≡) → **RESOURCES** → **FILES**. | The orange top bar is **shorter** than it was and the bottom bar too: the Files page now has the same chrome as Projects, Rate Card and Team Members (200/150). It used to render inside Home's 268/268 bars by omission and lost about 186px of table. The pet moves down with the bar (Q12, expected). |
| 6 | Any text field: click into it, select some text. | The caret is orange on dark surfaces and black on light ones; the selection highlight is an orange tint on dark and a dark tint on light — the text keeps its own colour. Placeholders are the muted ink on dark and italic black on light (a grey on orange is the thing your colour rule forbids). |
| 7 | **R.A.B.B.I.T.** → **BINS**. Open a bin, right-click a file, open **Add files**, **Delete bin**, **Assign to shot**. | **This is the one place that looks different**, and it is the thing I most want your word on. Bins' buttons, inputs, selects, chips, key caps, context menu and dialogs are now the shared kit: sentence-case 13–14px Inter labels instead of 10px uppercase mono, 28px toolbar buttons, 36px dialog buttons, the filled primary in the darker orange with white text, dialogs on a slightly raised surface with an 8px corner, the shortcut bar's key caps at 11px (up from 9px; the bar is still 34px tall with your 30px left padding). Every control is still there and does what it did; Escape, the modal stack and the busy lock all behave as before (a test proves it). The Scenes tab's takes panel and take picker share these components and change the same way. **If you would rather Bins waited for its own session (B6) and stayed as it was, say so — it is one commit to give binUi local copies again.** |
| 8 | Bins: hover a button. | It now has a hover state. Every Bins button shipped with a dead hover (an inline background beat the hover class); the kit keeps state in data attributes and CSS, so that class of bug cannot recur in kit components. |
| 9 | Optional, in a terminal: `npx vitest run`. | **110 files, 2121 tests, green** (was 86 / 1995). The new ones: the tokens and contrast tests (every ink/ground pair measured, the review's bad values pinned as failing), one render test per kit component, the six Bins dialogs mounted, and the bars test now cross-checks every page id in App.jsx. |

---

## Decisions this bundle needs from you

1. **Q17 — Dialog behaviours.** The kit's Dialog can bring Escape-to-close, a modal stack and a busy lock to the ~60 overlays that lack them. Until you say yes it ships with those OFF by default (Bins keep them explicitly). Your yes is one line: `DIALOG_BEHAVIOURS_DEFAULT = true` in `src/ui/Dialog.jsx`; every later session inherits it.
2. **Bins now, or Bins in B6** (step 7).
3. **Q3 — Inter + JetBrains Mono** is what shipped. Geist + Geist Mono is a ten-minute swap (four files under `public/fonts`, two lines in `@theme`, `--mono-size-adjust` to 1.0) if you want the Linear register instead; say so before Wave 1 starts.
4. **Q8(b)** — the Files page took the resource-class bars (200/150). Whether the whole class drops to 120/80 is still yours; nothing in this bundle presumes it.

## Where things are

- The specification, as code: `src/index.css` (`@theme`, the fonts, the global rules, the kit's CSS) and `src/ui/tokens.js`.
- The kit: `src/ui/` — one file and one test per component; `src/ui/index.js` is the inventory.
- The tests that make the numbers true: `src/ui/tokens.test.js`, `src/ui/contrast.test.js`.
- The sweep: `scripts/sweepOutlineNone.mjs` (re-runnable as a check). Screenshots: `scripts/screenshot.mjs`.
- The design doc: `~/.claude/skills/wilson-app/visual-language.md` — composition rule 3 is now "shared tokens, not local"; the typography section is the new scale. (It lives in your skills folder, not the repo, so the change is on this machine only.)
- The hand-off for F2: `docs/sessions/handoffs/ui-f1-2026-09-11.md`.
