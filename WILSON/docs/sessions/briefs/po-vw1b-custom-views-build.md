# Brief — VW1b · custom table views, the build, part 1: the Tasks table's item columns and the counts (to Audrey's VW1 answers)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else. Reviewer subagents on `model: "opus"`.

VW1 (2026-10-13) did the research, asked Audrey 25 questions in eight batches (answered, recorded verbatim), and wrote the design to her answers, reviewed twice. **This session builds the first two steps of the design's §7**: the Tasks table's item columns (her bug: "the interface in the table doesnt allow for multiple assets to be connected to it. please make sure it either shows all or none. additionally, i can see the levels or scenes or shots related") and the counts that read wrong. No views yet (that is VW1c), no migration.

Read first: `docs/sessions/HANDOFF_PROTOCOL.md`; `docs/design/POST_OVERHAUL_PLAN.md` §4; **`docs/sessions/handoffs/po-vw1-2026-10-13.md`** (VW1's hand-off); **`docs/design/CUSTOM_VIEWS_DESIGN.md`** (the design; §4.6 and §4.7 are this session's; §8's two kit requests land here); **`docs/design/CUSTOM_VIEWS_QUESTIONS.md`** (her answers, binding; look for answers to the design's §10 questions under a later batch); `docs/design/CUSTOM_VIEWS_RESEARCH.md` §2 (the five tables as they are); `docs/sessions/handoffs/po-fx2-2026-10-11.md` (a task's items: `task_items`, the main item rule, the task window's Items table and its picker); `po-fx8-2026-10-12.md` (the title column's width rule); FX10's hand-off if it has landed (`docs/sessions/handoffs/po-fx10-<date>.md`: it changed the date fields in the same table files). Load `laws-of-ux` and `design-direction` before touching a screen.

Branch `po/vw1b-custom-views-build` from `origin/feat/post-overhaul-edit-versioning` (it carries VW1's merge; `git branch --unset-upstream` after); port **5298** (its own `vw1b-worktree` entry in the tracked `.claude/launch.json`, modelled on `vw1-worktree`); walkthrough **72** (`docs/walkthroughs/72_custom_views.md`; this session writes its part 1, VW1d completes it); hand-off `docs/sessions/handoffs/po-vw1b-<date>.md`; the next brief `docs/sessions/briefs/po-vw1c-custom-views-data.md` (the design's §7 step 3 and 4) written before the hand-off. No chips: the controller spawns VW1c.

## Step 0 · her remaining questions

The design's §10 holds eight questions (Q-A to Q-H) that VW1 left for her at her word ("leave any remaining questions for tomorrow"). If the questions file has no answers to them yet (she may have answered in VW1's own chat), ask her in this session's chat with the multiple-choice tool: at most four per batch, one batch per turn, your pick first marked *(Recommended)*, plain words, a type-in always possible; record her answers verbatim in `CUSTOM_VIEWS_QUESTIONS.md` (a batch 9) and carry them into the design. Until an answer is in, build to the choice the design marks *(until she answers)*. Of this session's steps, only Q-D (dragging a task onto another item's group) and Q-G (the item columns' place and width) touch step 1.

## Step 1 · the Tasks table's item columns (design §4.6)

- The cell for each kind (Asset, Scene, Shot, Level, Experience): every item by name, main first, "+N" when they do not fit, the list in the tooltip, "—" when none, *No longer in the project* for a gone row, a shot's scene and number where names repeat.
- The picker (the kit request **VW1-KR-1 `Popover`**, its first caller): search, tick several, the disambiguation line, the active shot list's scenes and shots with *Show all lists* (reuse the task window's picker logic in `RelationsPanel.jsx`, do not fork it), the last item's removal asking, Escape and focus return, read-only for reviewers. Writes go through the provider's `addTaskItem` / `removeTaskItem` (already in `mutationsRef` with undo). The Asset cell stops writing `asset_id` through `updateTask`.
- The new columns in the Tasks table (a kind's column is there when the project has that kind turned on or any task names one, the task window's picker rule), 150px each, after Priority; the group fields for the four kinds (once under the main item, Q11a), dragging between their groups as §10 Q-D rules, a group's *New task* row linking the new task to that group's item. **Not the item-kind filters**: they come with the shared filter row in VW1d (the design's §7, re-cut by review round 1).
- Sideways scrolling with the checkbox and Title columns kept in place (the kit request **VW1-KR-2 Table sticky columns**, with every note of the design's §8: opaque paper, the gutter, `colSpan` rows, `scroll-padding-left`, `<th scope="row">`); FX8's width arithmetic (`--rb-task-fixed`, the spare) recomputed for the columns on screen; Board cards naming every asset.
- Tests: the cell (its accessible name is the whole list), the picker (keyboard, `role="checkbox"`), grouping and drags, the sticky columns, the width arithmetic with and without the new columns; the kit's own tests for both requests; `rabbitRowTitles.test.jsx` and `rabbitTasksCss.test.js` kept green.

## Step 2 · the counts (design §4.7)

Levels' and Experiences' Assets and Tasks counts and the window's *Linked counts* line; the scene window's asset count (`ScenesView.jsx` → `assetCountByScene`: change only that, the file is the plan's unsafe one). Fix `rabbitEntityViewsRender.test.jsx`'s fixture that pins the wrong field (`level_id` on an asset). OUTSTANDING: P1-26 and *the scene window's SHOTS / ASSETS / TASKS line counts no asset* close.

## Then

Two adversarial code review rounds, ONE reviewer subagent each, the second attacking the first's corrections; after each round, `git status`, HEAD and `node_modules` checked (a reviewer can touch the tree) and every correction asserted in executable form with a failing control before its commit. Pictures before and after at 1280x700 and 1440x900 (`scripts/vw1-shots.mjs` gains the after states: the two-asset row, the picker open, a film and a game project's Tasks table scrolled sideways). Walkthrough 72 part 1 + README row + the Desktop copy (`C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`). `npx vitest run --maxWorkers=4` count stated. Merge the integration branch in before building and before the hand-off; merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push; read CI through the public API with `curl`. Last command `git checkout --detach`.

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- FX10 (the date fields' calendar icon) edits the same table files and merges first: merge the integration branch before you build and keep its changes.
- `ProjectTasksView.jsx` is 2,000+ lines and has no test of its toolbar (VW1's research); `ScenesView.jsx` (4,700 lines) and `TimelineView.jsx` are the files the plan calls unsafe: change the smallest thing.
- The task window's Items table owns the order and the main item; the cell never reorders. On the cloud a task's level and experience exist only as items, and assets carry no level or experience links (the cloud adapter drops them): a game project's level counts of assets are 0 there by data, not by bug.
- The fixtures: task 18 ("Glass and rain rig test") has two assets; `?fixtures=game` gives tasks 17 and 18 levels and experiences (task 18 two levels); the level "Cliff Path" is task 18's second level.
- Ctrl+Z is not bound on the Tasks tab (FX2): undo of an item change is the Timeline's or the task window's.
- `src/ui/typeScale.test.js` allows weights 400/600 only and refuses an unjudged 2px edge; `src/dev/devFixtures.test.js` pins the fixtures' seams; the lane CSS test refuses a new class prefix in a shared sheet (FX2's `rb-rel-` lesson).
- Playwright's Chromium hides scrollbars: measure sideways scrolling with FX8's `--scrollbars` approach.
- A subagent can overwrite your working tree: check after each review round.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`; the Write tool decodes `\u` and four hex digits: placeholders, then scan.
- Copyright: summarise Notion's documentation; never copy its pages or pictures into the repository.
