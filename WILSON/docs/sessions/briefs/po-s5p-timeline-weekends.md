# Brief — S5p · the Timeline with weekends hidden: P1-32b (S5's step 8, on its own beside S5c)

**Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else.
Read first: `docs/OUTSTANDING.md` — **P1-32b** (the whole entry: what was MEASURED, the six conversions, the fix's shape) and P1-32c (leave it unless a line of it falls out of your fix); `docs/sessions/handoffs/po-s1-2026-09-30.md` §3 (items 2 and 5: the week header and the minimap window, which your fix must not undo), §5 (traps), §6 and §7 (the two scripts to run before and after, the date helper); `docs/sessions/handoffs/po-s3c-2026-10-02.md` "For S5" (the Timeline's label and its measured room, the page-gated undo keys — do not disturb them); `docs/design/POST_OVERHAUL_PLAN.md` §0 and §4; `docs/sessions/HANDOFF_PROTOCOL.md`. Code: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx` (`DetailPane`'s weekend mask; the zoom re-anchoring effect, `changeZoom`, `visibleStartDays` / `visibleSpanDays`, `scrollDetailToDay`, the gantt's Today, the first-mount centring), `views/timelineMinimap.js`, `dates.js`.

Branch `po/s5p-timeline-weekends` from `origin/feat/post-overhaul-edit-versioning` (then `git branch --unset-upstream`); port **5282**; no new walkthrough file — append a dated "Weekends hidden (P1-32b)" section to `docs/walkthroughs/48_timeline_pass.md` (what was wrong, four things to try) and copy that file again to `C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\`; hand-off `docs/sessions/handoffs/po-s5p-<date>.md`. Two adversarial review rounds, ONE reviewer subagent each (`model: "opus"`), the second attacking the first's corrections, each bounded to this bundle's diff. No waiting for Audrey; no chips; last command `git checkout --detach`. State the `npx vitest run` count you measure at start and end. Locate by identifier, never by line number.

## 🚨 Another session runs beside you

S5c (`po/s5-budget-versions`) is building bid versions on the Budget page: `views/BudgetView.jsx`, `views/budget/*`, `rabbitBudget.css`, `Rabbit.jsx`, `state/RabbitProvider.jsx`, `src/permissions/*`. **Yours are the Timeline's files only**: `views/TimelineView.jsx`, `views/timelineMinimap.js`, `rabbitTimeline.css` if a rule must move, the Timeline's tests and the two scripts. Add no version control to the Timeline (that is the session after S5c). In `docs/OUTSTANDING.md` edit the P1-32 entries only. Fetch before integrating; if a merge conflicts inside a file that is not yours, stop and say so in chat.

## What is wrong (measured by S1's review round 2 in the running app, 2026-09-30)

With "Show weekends" off, only `DetailPane` knows which day columns are hidden. Everything else converts the gantt's scroll to days as `scrollLeft / DAY_PX`: the zoom re-anchoring, `changeZoom`, the visible window (`visibleStartDays` / `visibleSpanDays`, which place the minimap's window), `scrollDetailToDay`, the gantt's Today, and the first-mount centring. So: Week → Day moved the gantt from 14 Sep to 11 Dec 2026 (+88 days) and Day → Week moved it back; at Day zoom the minimap's window reads 15 Sep – 6 Oct while the gantt shows December; Today lands on 10 Dec with today off screen; and toggling "Show weekends" does not re-anchor (`hideWeekends` is missing from the effect's dependencies). With weekends shown every zoom change keeps its date (S1 measured 36 transitions).

## The work

1. **Reproduce it first**, in the running app on the dev fixtures, at 1440x900: the four symptoms above, with numbers, into the hand-off. If one does not reproduce, say so.
2. **One mask-aware pair.** Lift the weekend mask (or a pure `weekendMask(start, days, dayPx)`) into `TimelineView`, write one pure x↔day pair (`dayIndexAtX` and its inverse) that both the pane and the six conversions use, record the scroll anchor as a DAY through it, and add `hideWeekends` to the re-anchoring effect's dependencies so the toggle keeps the date under the eye. Dates go through `dates.js` (never `new Date('YYYY-MM-DD')`: it is a day early on this workstation).
3. **Tests, each with a planted-fault control**: the pair is its own inverse on every day with the mask on and off (a hidden day maps to the next visible one, stated); each of the six conversions at each of the four zooms with weekends hidden AND shown; the 36 zoom transitions S1 measured keep their date in both modes; the toggle keeps the anchor day; the minimap's window brackets what the gantt shows.
4. **Do not undo S1 or S3c**: the week header's no-overlap rule and month labels, the gantt-half row borders, the minimap window's animation on the four zoom tabs, the read-only "Shot list:" label and its measured room, the page-gated undo keys. Run `node scripts/timeline-rows-probe.mjs 5282` and `node scripts/timeline-state-shots.mjs 5282 --out <dir>` BEFORE and AFTER (S1 §7): with weekends shown, the state shots must not move by a pixel that is not explained.
5. **Close P1-32b** in OUTSTANDING with a dated line (or leave open what did not reproduce); add what you found and did not fix.

## Tests that pin these files (update in the same commit; prove each loosening with a plant)

`rabbitTimelineCss.test.js`, `timelineShotLists.test.jsx`, `timelineMinimap.test.js`, `timelineMinimapRender.test.jsx`, `state/listRemovalKeepsTasks.test.jsx` (keep it green), `v2Motion.test.js`, the Timeline's other tests you find by grepping for the functions you change.

## Verification and hand-off

Dev server on 5282 (`VITE_DEV_AUTOLOGIN=tester VITE_DEV_FIXTURES=1`); before/after screenshots of the four symptoms at 1440x900 and 1280x700 into `docs/sessions/handoffs/img/po-s5p-*`; the hand-off in protocol §4 order with the measured before and after of each symptom, and "For the Timeline's version-control session" (anything about the toolbar, the anchor or the mask it must respect). No Electron launch should be needed; if one is, say so in chat first, keep the window off-screen and close it in a `finally`.
