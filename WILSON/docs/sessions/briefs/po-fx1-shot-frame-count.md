# Brief — FX1 · the shot's frame-count field: the spinner chevrons cover the digits (R.A.B.B.I.T. small fixes, 2026-10-11, one of three)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else. Reviewer subagents on `model: "opus"` (the Fable weekly allowance is spent until 2026-10-14 08:00 UTC).
Read first: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx` (the shot row's `frame_count` input, `type="number"`, and every other `type="number"` input in the shots table and the shot popup: frame count, scene number, takes), `views/rabbitScenes.css` and `rabbitScenesCss.test.js` (the shots table's cell widths; every rule you add is pinned there), `src/ui/typeScale.test.js` (weights 400/600 only; no new 2px edge), `src/ui/kit.css` (the kit's number-input rule, if one exists: measure first), `docs/design/review/r-a-b-b-i-t-part-2.md` (the overhaul's rules for the shots table), `docs/sessions/HANDOFF_PROTOCOL.md`, `docs/design/POST_OVERHAUL_PLAN.md` §4, `docs/SYSTEMS_HANDBOOK.md` §17.

Branch `po/fx1-shot-frame-count` from `origin/feat/post-overhaul-edit-versioning` (then `git branch --unset-upstream`); port **5290**; walkthrough **64**; hand-off `docs/sessions/handoffs/po-fx1-<date>.md`. No migration, no database, no `.env.local` needed (the dev fixtures: `VITE_DEV_FIXTURES=1`, `VITE_DEV_AUTOLOGIN=tester`). Two adversarial review rounds, ONE reviewer subagent each (a UX pass with a security glance), the second attacking the first's corrections. No waiting for Audrey; no chips; last command `git checkout --detach`. State the `npx vitest run` count you measure (336 files / 8,097 tests, 2 skipped, at the cut). Locate by identifier, never by line number. Read CI after every push through the public API with `curl`.

## Her words (2026-10-11, verbatim)

> for the frame count bar in the shot items, see image, the chevrons are covering up the numbers. lets please make sure this can be seen correctly with spacing between each. after 5 digits, add ellipsis to keep.

Her picture: three stacked number fields on the dark ground (`2000`, `6000`, `0`) with the browser's spinner chevrons drawn over the last digit, and an eye icon to the right.

## The work

1. **Measure first**: which inputs in the shots table and the shot popup are `type="number"`, their widths at 1280 and 1440, and where the chevrons land over the digits (a screenshot through the dev server, as the overhaul's `scripts/scenes-shot-lists-shots.mjs` takes them).
2. **The fix, for every number field of the shots table and popup, not only frame count**: the digits never sit under the chevrons (room for the spinner inside the field, or the kit's own spinner at the field's edge; the field wide enough for five digits plus the spinner at the smallest column width), with clear spacing between the number and the chevrons. **After five digits the display truncates with an ellipsis** and the full number is shown on focus and in the field's `title`; typing is never truncated. A `type="number"` input cannot draw an ellipsis: use the kit's text input with `inputMode="numeric"` and the same validation (digits only, `min`, the blank state) when the field is not focused, or another shape you can defend in the hand-off; the stored value and every caller (`frame_count` in the shot lists, the edits' totals, the budget's frame sums) are unchanged.
3. Pin it: a render test that a six-digit value shows five digits and an ellipsis unfocused and the full value focused; the CSS test for the new rules; the Local Server and the cloud unchanged (display only).
4. Walkthrough 64 (`docs/walkthroughs/64_shot_frame_count_field.md` + README row), screenshots before and after at both widths, `docs/OUTSTANDING.md` (broken-and-unfixed only), the hand-off in protocol §4 order.

## Facts that will bite

- **A subagent can overwrite your working tree**: after each review round, assert the executable form with failing controls before committing its corrections.
- The app's untracked `.claude/launch.json` at the worktree root blocks the checkout: move it to your scratchpad, never delete it. The Bash tool persists output over ~30 KB to a file. Bash heredocs halve `\\`: files with escapes go through Write/Edit.
- `ScenesView.jsx` is over 3,500 lines and the plan calls it unsafe to edit as it stands: change the smallest thing, hand off at protocol §1's first trigger.
- These fixes land on the integration branch; the controller decides which beta merge carries them.
