# Brief — FX7 · the Timeline's PROJECT and BID VER. labels: one size and colour, the project standing out, no folder icon (R.A.B.B.I.T. fixes, 2026-10-12, two of three)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else.
Read first: `src/tools/rabbit_v0.1.0/views/TimelineVersions.jsx` (the version bar, `rb-tl-ver-bar`, its *Bid ver.* label), `views/TimelineView.jsx` (where FX3 put the bar directly under the project title: find the *Project* label and its folder icon), `views/rabbitTimeline.css` and its CSS test, `timelineVersions.test.jsx`, `docs/sessions/handoffs/po-fx3-2026-10-12.md` (item 2) and `po-s5d-2026-10-05.md` (the bar's controls and its 1280 measurement), `src/index.css` (the kit's label step and ink tokens), `docs/design/POST_OVERHAUL_PLAN.md` §4, `docs/SYSTEMS_HANDBOOK.md` §17. Load `laws-of-ux` and `design-direction` first.

Branch `po/fx7-timeline-header-labels` from `origin/feat/post-overhaul-edit-versioning` (`git branch --unset-upstream` after); port **5295**; walkthrough **69**; hand-off `docs/sessions/handoffs/po-fx7-<date>.md`. The dev fixtures (`VITE_DEV_FIXTURES=1`, `VITE_DEV_AUTOLOGIN=tester` in `.env.local`, no database); no migration, no Edge Function, no staging or prod. Two adversarial review rounds, ONE reviewer subagent each on `model: "opus"` (the Fable weekly allowance is spent until 2026-10-14 08:00 UTC), a UX pass, the second attacking the first's corrections. No waiting for Audrey; no chips; last command `git checkout --detach`. State the `npx vitest run --maxWorkers=4` count you measure (357 files / 8,593 tests, 2 skipped, at the last merge). Locate by identifier, never by line number. Read CI after every push through the public API with `curl`. Screenshots before and after at 1280 and 1440 through the dev server (the `scripts/*-shots.mjs` pattern). The hand-off in protocol §4 order (`docs/sessions/HANDOFF_PROTOCOL.md`); merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push. The beta now runs this branch (merge `708e93be`, 2026-10-12): your fix reaches it only when the controller merges again on her word. FX6 and FX8 run beside you; merge the integration branch before your push and keep their changes.

## Her words (2026-10-12, verbatim), with her screenshot of the two rows (a folder icon, *PROJECT*, the project's name; below it *BID VER.* and *Curr…*)

> see image attached bid ver and project should be same sizing and color. if anything project should stand out more. lets remove the folder icon before the word project

## The work

1. **The two labels**, *Project* and *Bid ver.*, in one size and one colour (the kit's label step and ink), in one column so the two values start at the same x.
2. **The project stands out more**: its value (the project's name) reads as the first thing on the Timeline (a step above the version's value in weight or ink, within the kit's 400/600 weights); the version's value keeps every state S5d gave it (looking, open, locked, the sentences).
3. **No folder icon** before *Project*.
4. Every control of the version bar unchanged (Save, Save as new version…, Edit this version, the rates, the looking state); the 1280 width still fits (S5d measured 290 px needed). Pin the labels' shared class and the missing icon in the tests.
5. Walkthrough 69 (`docs/walkthroughs/69_timeline_header_labels.md` + README row, a copy in `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`), before and after, one question in §5; `docs/OUTSTANDING.md` (broken-and-unfixed only).

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- `TimelineView.jsx` (7,000+ lines) is a file the plan calls unsafe to edit as it stands: change the smallest thing; hand off at protocol §1's first trigger.
- `src/ui/typeScale.test.js` allows weights 400/600 only and refuses an unjudged edge of 2px or more.
- A subagent can overwrite your working tree: after each review round, assert the executable form with failing controls before committing its corrections.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`: files with escapes go through Write/Edit.
