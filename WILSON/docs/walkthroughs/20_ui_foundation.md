# 20 — UI overhaul, Foundation 1: the face, the tokens, the kit

**What this is.** The first of the UI overhaul's sessions
(`docs/design/UI_OVERHAUL_PLAN.md` §5, bundle F1). Nothing you use changes;
what changes is what everything is made of. The app now boots in one
typeface — **Geist**, the face you chose from the specimen tonight, with
Geist Mono for data — every colour, size and spacing value lives in one
place (`@theme` in `src/index.css`) with a test that measures each one, and
the shared component kit (`src/ui/`) exists, promoted from the Bins tab's
own primitives, which were the best-built corner of the app.

Your words, 2026-09-11: *"these tools are all part of one large ecosystem and
should have a shared visual language … make sure we have uniform font sizing
for body, titles, etc. … everything seems to use fonts that dont look super
contemporary."* This session is the part of the answer that has to exist
before the visible part (Wave 1, the type pass) can be banked.

Written 2026-09-11 against `feat/ui-overhaul`, session branch
`ui/f1-foundation`. Your rulings on Q3 (Geist), Q5 (3px / 6px radius), Q10
(no shortcut bar), Q17 (Dialog: Escape, the stack, the busy lock, nothing
more) and Q18 (the transition untouched) are all applied. Works on both
backends; nothing here touches data.

**What you will NOT see yet.** The sizes, the uppercase, the monospace
everywhere, the 2px borders — all of that is Wave 1 (the codemod). This
bundle is deliberately quiet: the face, the Files page's chrome, keyboard
focus, and the Bins tab (see step 7).

**Before you start.** To skip the sign-in screen in the dev build, add the
four `VITE_DEV_AUTOLOGIN` lines from `.env.example` to your `.env.local`
with the seeded tester's details (workspace `smoke`, user `smoke_admin`; the
password is the `DEV_PROBE_PASSWORD` GitHub secret). It only exists in dev
builds — `vite build` compiles it out — so it can never reach the installer
or the beta.

---

| # | Do | You should see |
|---|----|----------------|
| 1 | `git checkout feat/ui-overhaul && git pull --ff-only && npm install && npm run dev` (port 5203), or run the packaged build once one is cut from this branch. | The sign-in screen. **LOGIN**, COMPANY and the CONTINUE button are set in **Geist** — compare `docs/sessions/handoffs/img/ui-f1-before-root-1440x900.png` (Segoe UI) with `…after…` (Geist). Everything else about the screen is the same, and the light block still runs edge to edge. |
| 2 | Sign in (or let the dev auto sign-in do it) and look at **Home**. | The six page buttons, the Resources column, the titles — all Geist, at their old sizes and weights (Home is fonts-only, constraint C3). Layout, icons and spacing unchanged. The page-transition title is untouched (Q18): only its family follows the face. |
| 3 | **D.O.G.**, then **O.T.T.E.R.**, then **R.A.B.B.I.T.** — scroll a long panel in each. | The scrollbars look as they did: 8px, a grey thumb that turns orange on hover. They are now one shared class (`wilson-dark-scroll`) instead of a stylesheet D.O.G. injected into every page. O.T.T.E.R.'s Settings panel and Requests view still scroll with the same thumb (they used to depend on a class defined inside D.O.G.). |
| 4 | Any page: press **Tab** a few times, including across the orange top bar and the nav strip. | A 2px ring appears around the focused control: orange on dark pages, **black on the orange bars and on light pages** (an orange ring on orange was invisible — the first review round caught it). Click a button with the mouse instead: **no ring**. Click into a **text field**: the ring shows (Chromium treats a click into a field as keyboard-worthy, which is right). Before this, roughly 80 controls had no visible focus at all and the rest had one of four different rings. |
| 5 | Menu (≡) → **RESOURCES** → **FILES**. | The orange top bar is **shorter** than it was and the bottom bar too: the Files page now has the same chrome as Projects, Rate Card and Team Members (200/150). It used to render inside Home's 268/268 bars by omission and lost about 186px of table. The pet moves down with the bar (Q12, expected). Q8(b) — the whole class to 120/80 — is a later session. |
| 6 | Any text field: click into it, select some text. | The caret is orange on dark surfaces and black on light ones; the selection highlight is an orange tint on dark and a dark tint on light — the text keeps its own colour. Placeholders are the muted ink on dark and italic black on light (a grey on orange is the thing your colour rule forbids). |
| 7 | **R.A.B.B.I.T.** → **BINS**. Open a bin, right-click a file, open **Add files**, **Delete bin**, **Assign to shot**. | **This is the one place that looks different**, and it is the thing I most want your word on. Bins' buttons, inputs, selects, chips, key caps, context menu and dialogs are now the shared kit: sentence-case 13–14px Geist labels instead of 10px uppercase mono, 28px toolbar buttons, 36px dialog buttons, the filled primary in the darker orange with white text, 3px corners on controls and 6px on the dialogs, which sit on a slightly raised surface and fade in over 200ms; the shortcut bar's key caps at 11px (the bar itself stays as it is until B6 removes it per Q10). Every control is still there and does what it did; Escape, the modal stack and the busy lock behave as before (a test proves it). The Scenes tab's takes panel and take picker share these components and change the same way. **If you would rather Bins waited for its own session (B6) and stayed as it was, say so — it is one commit to give binUi local copies again.** |
| 8 | Bins: hover a button. | It now has a hover state. Every Bins button shipped with a dead hover (an inline background beat the hover class); the kit keeps state in data attributes and CSS, so that class of bug cannot recur in kit components. |
| 9 | Optional, in a terminal: `npx vitest run`. | **111 files, 2136 tests, green** (was 86 / 1995). The new ones: the tokens and contrast tests (every ink/ground pair measured, the review's bad values pinned as failing, the ten legacy hexes in the lesson-content rules pinned as the only ones outside `@theme`), one render test per kit component, the six Bins dialogs mounted, the bars test cross-checking every page id in App.jsx, and the guard that keeps the dev sign-in out of shipped builds. |

---

## Decisions this bundle still needs from you

1. **Bins now, or Bins in B6** (step 7). Everything else you ruled on tonight is in.

## Where things are

- The specification, as code: `src/index.css` (`@theme`, the fonts, the global rules in `@layer base`, the kit's CSS) and `src/ui/tokens.js`.
- The kit: `src/ui/` — one file and one test per component; `src/ui/index.js` is the inventory. There is no `ShortcutBar` (Q10); `Kbd` stays for Help content and menu hints.
- The tests that make the numbers true: `src/ui/tokens.test.js`, `src/ui/contrast.test.js`.
- The sweep: `scripts/sweepOutlineNone.mjs` (re-runnable as a check). Screenshots: `scripts/screenshot.mjs`.
- The dev sign-in: `src/cloud/auth/LoginScreen.jsx` (the effect at the end of the handlers), `src/cloud/auth/devAutoLogin.test.js`, `.env.example`.
- The design doc: `~/.claude/skills/wilson-app/visual-language.md` — composition rule 3 is now "shared tokens, not local"; the typography, borders and scrollbar sections are the new system; the full-width rule for the light block is under "Page margins". (It lives in your skills folder, not the repo, so the change is on this machine only.)
- The hand-off for F2: `docs/sessions/handoffs/ui-f1-2026-09-11.md`.
