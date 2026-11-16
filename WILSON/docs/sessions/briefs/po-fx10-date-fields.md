# Brief — FX10 · the date fields: the calendar icon covers the year (R.A.B.B.I.T. fixes, 2026-10-13)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else. Reviewer subagents on `model: "opus"`.
Read first: `docs/sessions/handoffs/po-fx1-2026-10-12.md` and `src/tools/rabbit_v0.1.0/views/scenes/NumberField.jsx` (the same defect solved for the number fields' spinners: measured, room reserved, the browser's control styled), every `type="date"` input in R.A.B.B.I.T. (`views/ProjectTasksView.jsx`, `ProjectAssetsView.jsx`, `ScenesView.jsx`, `EntityListView.jsx`, `TimelineView.jsx`, `BudgetView.jsx`, `ProjectSummaryView.jsx`, `components/TaskDetailPopup.jsx`, `NewTaskPopup.jsx`, `RelationsPanel.jsx`), the kit's input rules in `src/index.css` and `src/ui/`, `docs/sessions/handoffs/po-fx8-2026-10-12.md` (the tables' columns as built yesterday), `docs/design/POST_OVERHAUL_PLAN.md` §4, `docs/SYSTEMS_HANDBOOK.md` §17. Load `laws-of-ux` and `design-direction` first.

Branch `po/fx10-date-fields` from `origin/feat/post-overhaul-edit-versioning` (`git branch --unset-upstream` after); port **5297**; walkthrough **71**; hand-off `docs/sessions/handoffs/po-fx10-<date>.md`. The dev fixtures (`VITE_DEV_FIXTURES=1`, `VITE_DEV_AUTOLOGIN=tester` in `.env.local`, no database); no migration, no Edge Function, no staging or prod. Two adversarial review rounds, ONE reviewer subagent each on `model: "opus"`, a UX pass with an accessibility check, the second attacking the first's corrections. No waiting for Audrey; no chips; last command `git checkout --detach`. State the `npx vitest run --maxWorkers=4` count you measure. Locate by identifier, never by line number. Read CI after every push through the public API with `curl`. Screenshots before and after at 1280 and 1440 through the dev server. The hand-off in protocol §4 order (`docs/sessions/HANDOFF_PROTOCOL.md`); merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push. The beta runs this branch's merge of 2026-10-12 (`f8268e14`); your fix reaches it when the controller merges again on her word. VW1 (custom views) runs beside you in the same table files but builds only after Audrey answers its questions: merge first, and say in your hand-off what you changed in each table.

## Her words (2026-10-13, verbatim), with her screenshot of the Tasks table's Start and End columns (`09 / 26 / 202` with the calendar icon over the last digit, `mm / dd / yy` in the empty row)

> also see second image attached, similar to the frame count chevrons, the calendar icon is covering the dates when it has all the space to space them out

## The work

1. **Measure first** (a table in the hand-off): every date field in R.A.B.B.I.T.'s tables and windows, its width, what it shows full and empty (`09 / 26 / 2026`, `mm / dd / yyyy`), where the calendar icon lands, at 1280 and 1440, in Chromium (the desktop app's engine too).
2. **The whole date always visible, the icon clear of it with space between**, using the room the column has (her words: "when it has all the space to space them out"); a column too narrow for a whole date and its icon widens to fit; the empty state whole as well.
3. **One shared rule or component** so every date field follows (as FX1's `NumberField` did for numbers): the native picker and typing kept, the keyboard unchanged, the value and every caller unchanged (display only).
4. Pin it: a render or CSS test per field kind; the CSS tests of each sheet you touch.
5. Walkthrough 71 (`docs/walkthroughs/71_date_fields.md` + README row, a copy in `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`), before and after; `docs/OUTSTANDING.md` (broken-and-unfixed only).

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- Firefox and Safari draw the date field differently; Playwright here has Chromium only: say what was not measured.
- `TimelineView.jsx` (7,000+ lines, 23 date fields) and `ScenesView.jsx` are the files the plan calls unsafe to edit as they stand: prefer the shared rule over edits inside them.
- `src/ui/typeScale.test.js` allows weights 400/600 only and refuses an unjudged 2px edge.
- A subagent can overwrite your working tree: after each review round, assert the executable form with failing controls before committing its corrections.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`: files with escapes go through Write/Edit.
