# Brief — FX6 · the status line under an item's title, thicker (R.A.B.B.I.T. fixes, 2026-10-12, one of three)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else.
Read first: `src/ui/StatusBanner.jsx` and its rules in `src/index.css` (`.ui-status-banner`: FX3 drew one 1px line of `--status-color` across its foot), `src/ui/Dialog.jsx` (the band slot), `src/ui/typeScale.test.js` (the hand-judged edges list), `docs/sessions/handoffs/po-fx3-2026-10-12.md` and walkthrough 66 (its question 2 asked exactly this), the popups that draw the banner (`components/TaskDetailPopup.jsx`, `views/ProjectAssetsView.jsx`, `views/ScenesView.jsx`, `views/EntityListView.jsx`), `docs/design/POST_OVERHAUL_PLAN.md` §4, `docs/SYSTEMS_HANDBOOK.md` §17. Load `laws-of-ux` and `design-direction` first.

Branch `po/fx6-status-line-weight` from `origin/feat/post-overhaul-edit-versioning` (`git branch --unset-upstream` after); port **5294**; walkthrough **68**; hand-off `docs/sessions/handoffs/po-fx6-<date>.md`. The dev fixtures (`VITE_DEV_FIXTURES=1`, `VITE_DEV_AUTOLOGIN=tester` in `.env.local`, no database); no migration, no Edge Function, no staging or prod. Two adversarial review rounds, ONE reviewer subagent each on `model: "opus"` (the Fable weekly allowance is spent until 2026-10-14 08:00 UTC), a UX pass, the second attacking the first's corrections. No waiting for Audrey; no chips; last command `git checkout --detach`. State the `npx vitest run --maxWorkers=4` count you measure (357 files / 8,593 tests, 2 skipped, at the last merge). Locate by identifier, never by line number. Read CI after every push through the public API with `curl`. Screenshots before and after at 1280 and 1440 through the dev server (the `scripts/*-shots.mjs` pattern). The hand-off in protocol §4 order (`docs/sessions/HANDOFF_PROTOCOL.md`); merge into `feat/post-overhaul-edit-versioning` with `--no-ff`, push. The beta now runs this branch (merge `708e93be`, 2026-10-12): your fix reaches it only when the controller merges again on her word. FX7 and FX8 run beside you; merge the integration branch before your push and keep their changes.

## Her words (2026-10-12, verbatim; her answer to walkthrough 66's question 2)

> for the window/card that opens for assets/tasks/scenes/etc the status color line below the status title. lets make the line thicker it feels to thin

And from 2026-10-11, what she asked to bring back: *"a color banner/bar that was the color of the status"*.

## The work

1. Render the banner's line at 2, 3 and 4 px on every status tone, on the light and the dark ground, at 1280 and 1440; pick the weight that reads as a bar rather than a rule (her word was "banner/bar"); say why in the hand-off.
2. Change it in the ONE place (the kit's `.ui-status-banner` rule), so every popup follows; put the edge on `typeScale.test.js`'s hand-judged list with her words above as the judgement; forced-colours mode still shows it (a system colour where the tone is gone).
3. Walkthrough 68 (`docs/walkthroughs/68_status_line_weight.md` + README row, a copy in `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`): the chosen weight in every popup, the three candidates side by side so she can say "thicker" or "thinner", one question in §5; `docs/OUTSTANDING.md` (broken-and-unfixed only).

## Facts that will bite

- Move the untracked `.claude/launch.json` at the worktree root to your scratchpad before the checkout; never delete it.
- `src/ui/typeScale.test.js` allows weights 400/600 only and every edge of 2px or more must be one a person judged: that list is where her judgement goes.
- A subagent can overwrite your working tree: after each review round, assert the executable form with failing controls before committing its corrections.
- The Bash tool persists output over ~30 KB to a file; Bash heredocs halve `\\`: files with escapes go through Write/Edit.
