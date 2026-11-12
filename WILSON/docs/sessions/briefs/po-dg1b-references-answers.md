# Brief — DG1b · D.O.G.'s references: Audrey's last six answers, asked and built

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything
else. Reviewer subagents on `model: "fable"` (Fable for design and reviews, Opus for
code); if the Fable weekly limit refuses a round, run it on `opus` and say so.

**This session WAITS for Audrey**, as DG1 and VW1 did: her answers first, then the
build, only to her answers.

## Where DG1 left it

DG1 (`po/dg1-dog-references`, merged into `feat/post-overhaul-edit-versioning`;
hand-off `docs/sessions/handoffs/po-dg1-2026-10-16.md`) built D.O.G.'s References
card and window and the one Single page / Full deck card on her batches 1 to 4.
On 2026-10-16 she said *"keep coding im going to sleep. leave questions for
tomorrow"*, so batches 5 and 6 of `docs/design/DOG_REFERENCES_QUESTIONS.md` were
written and not asked; the build follows each recommended pick, marked
*provisional* in `docs/design/DOG_REFERENCES_DESIGN.md` §1 and §9.

## Do, in order

1. `git fetch origin`; cut `po/dg1b-references-answers` from
   `origin/feat/post-overhaul-edit-versioning`; `git branch --unset-upstream`;
   move any untracked `.claude/launch.json` at the worktree root to your
   scratchpad first (never delete it). `npm install --ignore-scripts`, then
   `git checkout -- package-lock.json`. The dev server: the `dg1-worktree` entry's
   recipe in `.claude/launch.json` on your own port (copy it; change the path and
   the port).
2. Ask her, in this chat, with the multiple-choice tool, at most four per batch,
   one batch per turn, a type-in always possible, each recommended pick first:
   **batch 5** (Q12 remembering, Q19 what *Use project assets* places, Q20 the
   card names, Q21 the switch's opening side) and **batch 6** (Q22 an item's
   extra fields, Q23 the box's hint). Put Q19's conflict to her in plain words:
   her Q14 ("like before") would place the project's own pictures without a
   tick, and a placed picture is also sent to the AI, which her Q2 rules out.
   Record her answers verbatim under each batch.
3. Build what her answers change, nothing else. Where each lives:
   - **Q12**: `references/useReferences.js` (the chosen set and `setAside`, memory
     only today). *Per project, this computer*: browser storage keyed by project,
     **ids only**, never a note's title, cleared when the project is gone;
     *per project, everywhere*: migration **0099 / suite 102** (DG1's reservation,
     unused), dev only, rehearsed rolled back.
   - **Q19**: `DeckOutlineGenerator.jsx` `placementFrom` / `resolveSources`. "The
     project's own" means reading project-level pictures and videos at Generate
     (the old `isDeckAttachmentRow` media arm) and sending the pictures: say so.
   - **Q20**: the three `<h2>` titles (`DeckOutlineGenerator.jsx`,
     `references/ReferencesCard.jsx`); `dogCss.test.js` counts the step titles.
   - **Q21**: `fullDeckMode`'s initial state.
   - **Q22**: `referenceModel.itemWords` (the fields per kind; the design §3 table).
   - **Q23**: the hint span beside *Use visual assets* in the merged card.
4. Two review rounds on the code (the second attacking the first's corrections),
   `npx vitest run --maxWorkers=4` stated, walkthrough 75 updated in place (a §6,
   "After your answers") and copied to
   `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`, the pictures
   retaken with `node scripts/dg1-shots.mjs <port> --out docs/sessions/handoffs/img
   --size <W>x<H> --part refs`, a hand-off in protocol §4 order, merge into
   `feat/post-overhaul-edit-versioning` with `--no-ff`, push, read CI with `curl`,
   last command `git checkout --detach`.

## Facts that will bite

- The heredoc trap is real here: Bash heredocs halve `\\`, the Write tool decodes
  `\u` + four hex digits, and Python in text mode writes CRLF on Windows. Write
  edit scripts with the Write tool and match line endings (DG1's
  `edit_util.py` pattern: normalise on read, restore on write, assert every
  replacement's count).
- A screenshot taken right after a click in the Browser pane can blend two
  frames; a `zoom` or a Playwright shot is the truth.
- The test data refuses every file download (`devWriteRefused`), so a deck can
  never be generated from files there; the real cloud is Audrey's walkthrough.
- Never read `data.content[0].text`; D.O.G. reads every reply with
  `textFromMessage` (it keeps the last text block; D.O.G.'s calls use no tools).
- Never sign in anywhere; never staging or prod.
