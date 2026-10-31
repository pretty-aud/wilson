# Brief — F2 · The budget's money rules in one place (wave 1 of `docs/sessions/PLAN_WEEK_2026-11-04.md`)

**The defect (OUTSTANDING REV-02; the review's rabbit A4 and shared-client A5).** The rule "base = days × rate; margin and contingency each on the base; the agency fee on top" is written seven times and the copies disagree: the agency percentage defaults to 20 when never set in `src/tools/rabbit_v0.1.0/state/budgetVersionModel.js:189` and to 0 in `views/budget/CrewTeamTab.jsx:123`, `src/components/Budget/useBudgetLines.js:228` and `views/BudgetView.jsx:890`; the Crew tab applies margin and contingency to the base plus the agency fee (`CrewTeamTab.jsx:197-200`) while `bidTotals` (`budgetVersionModel.js:206`) and the tested `src/components/Budget/budgetMath.js` apply them to the base (handbook §17's rule); only `bidTotals` rounds to cents. The tested rules (`effectivePct`, `applyMarginAndContingency`, `profit`) have no product caller; the margin-inheritance rule is inlined fourteen times across `BudgetView.jsx`, `TalentTab.jsx`, `CrewTeamTab.jsx` and `ClientViewTab.jsx`.

**Her ruling to carry (asked before this chip is clicked):** the agency fee when no percentage was ever typed — the plan recommends 0 (the fee is what she typed); if she chose 20, that is the one default. The chip's message or the controller's morning note says which.

**Model.** Opus 5.5; if you are on Fable, stop on this line and wait for "go". The two review rounds on Fable.

**Branch.** `po/f2-money-rules` from `origin/feat/post-overhaul-edit-versioning`; the usual setup. No migration, no SQL, no deploy, no sign-in anywhere. Files: `src/components/Budget/`, `src/tools/rabbit_v0.1.0/views/budget/`, `views/BudgetView.jsx`, `state/budgetVersionModel.js`, `state/selectors.js` and their tests; nothing in `electron/` or `supabase/`.

**The list.**
1. Measure first on the fixtures (Chromium on the dev server, as DG4 did): the Summary's waterfall, the Topsheet, the Crew tab, the Talent tab and the Client view for the fixtures' project with the agency fee on and no percentage typed, and with 10 percent typed; record every figure.
2. `budgetMath.js` becomes the one module: `projectBudgetSettings` and `bidTotals` move into it beside `effectivePct`, `applyMarginAndContingency`, `profit` and one `round2`; the agency default decided once by her ruling; margin and contingency on the base everywhere; cents rounding where `bidTotals` already rounds. Every Budget surface calls it; the fourteen inline copies and the duplicate `round2` go (subtract before add).
3. Tests with failing controls: the module's tests extended for the default and the base rule; each surface's test pinned on a figure that the old copy got wrong; the controls red first.
4. Measure after: the same figures; every surface agrees with the module; the differences from step 1 listed in the walkthrough in plain words (what changes on a real budget when the fee is on and no percentage was typed).
5. Docs: handbook §17's money lines; OUTSTANDING REV-02 closed with the measurement, N1's "four Budget views still run inline copies" note resolved; walkthrough 91's F2 section with the before-and-after table; the hand-off `handoffs/po-f2-2026-11-04.md` (the bundle's size before and after).
6. Merge the tip in, your own `--no-ff` merge, CI read, the close-out to the controller (*Wilson branch planning*).

**Rules.** Plan §5, all eight; the two review rounds; markers four; the fixtures only in every picture and figure.
