# Brief — VW1 · custom table views, as Notion builds them: research first, then Audrey's questions, then the design and the build (Tasks, Scenes, Assets, Levels, Experiences; the Tasks table's item columns fixed on the way)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else. Reviewer subagents on `model: "opus"`.

**This session is different from the others in one rule: it WAITS for Audrey.** She asked for "a research phase first, then ask me any questions to clarify things and not make any assumptions". So: research, then ask her in THIS session's chat, then design and build only to her answers. Every other house rule stands.

Read first: `docs/sessions/HANDOFF_PROTOCOL.md`; `docs/design/POST_OVERHAUL_PLAN.md` §4; `docs/SYSTEMS_HANDBOOK.md` §17; `docs/sessions/handoffs/po-fx2-2026-10-11.md` (a task holds many items, `task_items`, migration 0096; its pick 7, *"every other editor writes the main item: the Tasks table's Asset cell…"*, is what her screenshot shows, and her words below reopen it); `po-fx8-2026-10-12.md` (the tables' title cells and row buttons, as built yesterday); the five views (`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx`, `ScenesView.jsx`, `ProjectAssetsView.jsx`, `LevelsView.jsx`, `ExperiencesView.jsx`, and the shared `EntityListView.jsx`) with their toolbars (the Filter button, the Sort and Group dropdowns, the existing saved views: `SceneSavedViewsDropdown` and its siblings, kept in `localStorage` today, per browser); `docs/OUTSTANDING.md` P1-08 (the saved-views rows are mouse-only); `docs/design/review/r-a-b-b-i-t-part-2.md` and walkthrough 47 (the overhaul's toolbar and table rules). **Load `laws-of-ux` and `design-direction` before the design (her words: "lets use the UX laws and designer skills for this please").**

Branch `po/vw1-custom-views` from `origin/feat/post-overhaul-edit-versioning` (`git branch --unset-upstream` after); port **5298**; walkthrough **72**; hand-off `docs/sessions/handoffs/po-vw1-<date>.md`. If the views must be kept on the cloud per project, the migration is **0097 / suite 100** (0094 / 97 stay reserved), rehearsed rolled back through `scripts/tap-hosted.py`, applied to wilson-dev by `supabase db query --linked --file …` plus its history row, with a Desktop kit section in `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\00_HOW_TO_APPLY.md` and the staging lines in "Waiting on Audrey"; never `db push`; never staging or prod. `.env.local` copied in and `supabase link` to wilson-dev only when you reach the database. Two adversarial review rounds, ONE reviewer subagent each, on the design (UX, and security if there is a table) and on the code, the second attacking the first's corrections. No chips: if the build is more than one session, write the next session's brief into `docs/sessions/briefs/` and say so in the hand-off; the controller spawns it. State the `npx vitest run --maxWorkers=4` count you measure (357+ files at the last merge). Locate by identifier, never by line number. Read CI after every push through the public API with `curl`. Last command `git checkout --detach`.

## Her words (2026-10-13, verbatim), with her two screenshots

The first screenshot: the Tasks table's *Asset* column; one row's cell open as a dropdown listing *—*, *tester*, *tester*, one choice only.

> issue with the asset view in the table of tasks. see image. the interface in the table doesnt allow for multiple assets to be connected to it. please make sure it either shows all or none. additionally, i can see the levels or scenes or shots related. lets do a session to do a pass on this. what i would like to do here is lets create a way for a user to create their own views like you can in notion. think about how notion has the ability to turn on and off what fields are seen in the table. lets add a drop down when you press the views option for creating saved filtered/sorted views that allows you to select your filters, sorting, grouping and what fields are seen. these views should be project specific. lets do a research path on how Notion does the drop down in tables that allows you to set all those settings. i still want to keep the filter button, the sorting drop down and grouping dropdown. this new views drop down is to build customized views.

> lets do a research phase first, then ask me any questions to clarify things and not make any assumptions.

> lets have this work for tasks, scenes, assets, levels, experiences.

> make sure to make a new session for this and lets use the UX laws and designer skills for this please.

(Her second screenshot, the calendar icon covering the dates, is FX10's, not yours.)

## Phase 1 · research (no product code)

1. **Notion**: how its database views are built and changed: adding a view, the view's settings menu (layout; which properties show and in what order; filters, including grouped and nested ones; one or more sorts; grouping and sub-grouping, empty groups; how many rows load), renaming, duplicating, deleting and reordering views, the default view, and how a change to a view's filter or sort is saved for everyone or kept for the one person. Use Notion's public help pages and guides (web search, or the built-in browser on public pages; never sign in anywhere). Write it in your own words with the links; no long quotes (at most one short quote per source).
2. **WILSON today**, measured per table (Tasks, Scenes, Assets, Levels, Experiences): the toolbar's Filter, Sort and Group controls; the saved views each has (what a saved view stores, where, per browser or per project, what Budget expenses and Team do beside them); every column, which can hide or move today, its width; the relation columns: what the Tasks table shows and edits for a task with two assets, a scene, two shots, a level and an experience (FX2's `task_items`), and what the other four tables show of their tasks and items; the Local Server and the cloud paths; the keyboard (P1-08).
3. Write `docs/design/CUSTOM_VIEWS_RESEARCH.md`: Notion's model in plain words, WILSON today, the gap, with screenshots of WILSON at 1280 and 1440.

## Phase 2 · her questions (wait for her answers)

Write `docs/design/CUSTOM_VIEWS_QUESTIONS.md`: every decision the design would otherwise make for her, each with two to four choices, your pick first marked *(Recommended)*, in plain words (what each choice means for her day, no column names). Then ask her **in this chat** with the multiple-choice question tool: **at most four questions per batch, one batch per turn, a type-in answer always possible, explain any question in plain words when she asks, and give her a self-contained line to paste if she asks for one (no "option A").** Record her answers verbatim in the questions file as they come. Nothing that changes what she sees is decided without her. The decisions include at least: shared with the project's team or personal (or both, as Notion's "for everyone / just for me"); who may create, change and delete a shared view (by role); the default view of each table; whether the toolbar's Filter, Sort and Group change the current view at once or only until *Save*; where the views control lives and what its dropdown holds; which fields can hide (the title always shown?), column order and width per view; the relation fields (the Tasks table's Asset, and Scene, Shot, Level, Experience fields: every linked item shown, or none, and whether a cell edits many items or opens the task's window); what happens to the views that live in each browser today; the desktop signed out (Local Server); Budget expenses and Team, which she did not name.

## Phase 3 · the design, then the build (only after her answers)

1. `docs/design/CUSTOM_VIEWS_DESIGN.md`: the views dropdown and the view builder (filters, sorts, grouping, fields) through `laws-of-ux` and `design-direction`, the data model (a table only if her answers need one: 0097 / suite 100, RLS by role as she ruled, the private-projects arm, `RLS_TABLES`), the Local Server parity, the migration of the views each browser holds today, the build plan; reviewed twice.
2. The build, in the order the design gives, the Tasks table's item columns first (her bug); every new mutator in `mutationsRef` with undo; every export with a caller; the bundle-key places if a collection is added; the fixtures. Hand off at protocol §1's first trigger with the next brief written.
3. Walkthrough 72 (`docs/walkthroughs/72_custom_views.md` + README row, a copy in the Desktop folder), screenshots, `docs/OUTSTANDING.md` (P1-08 closed if the new dropdown answers it), the hand-off in protocol §4 order; merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push.

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- `ScenesView.jsx` (3,500+ lines) and `TimelineView.jsx` are the files the plan calls unsafe to edit as they stand: change the smallest thing.
- FX10 (the date fields' calendar icon) runs beside you in the same table files and will merge first: merge the integration branch before you build and keep its changes.
- `CREATE OR REPLACE` and a rewritten policy silently drop arms (0062): restate every arm and prove each in the suite.
- `src/ui/typeScale.test.js` allows weights 400/600 only and refuses an unjudged 2px edge; `src/dev/devFixtures.test.js` pins the fixtures' seams.
- A subagent can overwrite your working tree: after each review round, assert the executable form with failing controls before committing its corrections.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`; the Write tool decodes `\u` and four hex digits: placeholders, then scan.
- Copyright: summarise Notion's documentation; never copy its pages or pictures into the repository.
