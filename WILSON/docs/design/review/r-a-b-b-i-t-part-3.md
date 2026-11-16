# Review — R.A.B.B.I.T. part 3 — BudgetView (Summary, By Phase / Role / Asset / Scene / Shot / Level / Experience, Custom, Crew/Team, Talent, Expenses, Client View) and ScenesView (scene table, scene gallery, shot table, shot gallery, scene detail popup, shot detail popup)


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BudgetView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\budget\CrewTeamTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\budget\TalentTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\budget\ClientViewTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\CurrencyDisplay.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ScenesView.jsx`


## Job

Budget is where a project's money is bid, versioned, locked against a snapshot and reconciled against actuals. Scenes is where a film project's scene and shot spine is built, numbered and timed. One primary action per sub-view: Summary = set margin / contingency and lock a bid ("Set Budget Active"); By Phase / Role / Asset / Scene / Shot / Level / Experience = read one grouped total, these are reports with no action; Custom = choose a grouping; Crew/Team and Talent = type an actual into a period cell; Expenses = create an expense; Client View = print the estimate; Scenes in scenes mode = create a scene and edit its row inline; Scenes in shots mode = set a shot's frame count and status. Two failures at this pass. First, Summary carries three co-equal primary actions (edit the waterfall percentages, save a bid version, set the budget active), rendered at three unrelated weights, none dominant, so the screen has no single landing point. Second, seven of the thirteen budget tabs are the same operation ("group the same numbers a different way") presented as peers of three genuinely different data sets and one output document, so the tab strip does not encode what the surface is actually for.


## What works

- The Crew/Team and Talent row contract genuinely works and should become the shared Table's row model: each row is ONE flex element spanning both the bid zone and the actual zone, which is why the two halves cannot drift vertically no matter how many period columns are added (CrewTeamTab.jsx:7-9 states the rule, CrewTeamTab.jsx:517-615 implements it).

- ClientViewTab is the only real <table> on this surface, with <thead>/<th>/<td>, one right-aligned numeric column, hairline row dividers and a 2px total rule (ClientViewTab.jsx:198-251). It is already about eighty percent of the proposed src/ui/Table and is the right thing to promote rather than rewrite.

- ScenesView is the only file on this surface that already uses tabular-nums, and it uses it on every derived numeric: runtime, frame counts, group timecode, gallery durations (17 occurrences, e.g. ScenesView.jsx:1414, 1599, 1836). The convention is already understood in this codebase; it just never reached the money.

- Hover-revealed row actions are consistent in seven places: a reserved fixed-width slot, opacity-0 to group-hover:opacity-100, one transition-opacity (ExpenseRow BudgetView.jsx:2099, SceneTable ScenesView.jsx:1424, nested shot ScenesView.jsx:1614, ShotTable ScenesView.jsx:2092, TalentTab.jsx:522). This already matches the proposed HoverActions component and only needs focus-within added.

- The no-rate-card banner is the best piece of product writing in RABBIT: it distinguishes "this budget is zero" from "this budget cannot be calculated yet", names the exact place to fix it, and says what still works (BudgetView.jsx:233-250). Keep the copy verbatim; only re-typeset it.

- Escape-reverts-the-edit is implemented correctly in all four inline editors on this surface (TalentTab.jsx:170-173, BudgetView.jsx:1196, BudgetView.jsx:1280, ScenesView.jsx:3294), matching the binUi behaviour the system review wants promoted.


## Findings (40)

**R3-01 · HIGH · System** — Five money formatters, two locales, on one screen  
law: Law of Similarity

- Problem: fmtCurrency is copy-pasted into four files with a hardcoded 'en-US' locale, while CurrencyDisplay formats with Intl.NumberFormat(undefined, ...), which is the VIEWER's locale. Both render on the Summary tab at once: the waterfall uses CurrencyDisplay, the Topsheet directly below it uses fmtC. On any non-US locale the same amount appears in two different formats in the same card, and the differing separator and symbol widths break the right edge of a column that is supposed to be a money column.

- Why it matters: One formatter is the precondition for every other money-alignment fix; with five you cannot assert column behaviour anywhere.

- Change: Delete all four fmtCurrency copies and route every amount through CurrencyDisplay. Give CurrencyDisplay one explicit locale (project locale or 'en-US', chosen once), make it emit tabular figures and the mono numeric role, and make the em-dash empty marker come from its `fallback` prop instead of the ~40 inline '—' literals.

- Evidence: `src/tools/rabbit_v0.1.0/components/CurrencyDisplay.jsx:34` — `formatted = new Intl.NumberFormat(undefined, {`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:48` — `return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:25` — `return n.toLocaleString('en-US', { style: 'currency', currency, ... })`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:35` — `return n.toLocaleString('en-US', { style: 'currency', currency, ... })`<br>`src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:16` — `return n.toLocaleString('en-US', { style: 'currency', currency, ... })`




**R3-02 · HIGH · Typography** — Zero tabular-nums in four money tables; the columns only line up by accident  
law: Law of Uniform Connectedness

- Problem: Measured across BudgetView, CrewTeamTab, TalentTab and ClientViewTab: tabular-nums appears zero times. Every money column currently aligns solely because font-mono is applied blanket, so the browser fallback mono happens to give equal advance widths. The system review retires font-mono from about 1,900 of 1,917 uses; the moment these cells become a proportional sans, every bid, actual, variance and total column loses its right edge at once, in the one place in WILSON where a misread digit costs money.

- Why it matters: This is the single highest-risk regression in the whole overhaul: the type change silently breaks the money tables unless the numeric role is made explicit first.

- Change: Make the numeric role explicit rather than incidental: every currency, day-count and percentage cell gets font-variant-numeric: tabular-nums plus the mono numeric face, set at 0.94em of its sans step so it does not sit larger than the label beside it, and text-align:right. Put it in the Td component with align="right", not in 40 call sites. Apply to CurrencyDisplay's span so it is impossible to opt out.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:554` — `<span style={{ color: row.rate > 0 ? '#a8a29e' : '#57534e' }}>{row.rate > 0 ? fmtCurrency(row.rate, currency) : '—'}</span>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1083` — `<span className={'text-[11.5px] font-mono text-right ${bold ? 'font-bold' : ''}'} style={{ color: '#d6d3d1', width: colW.bid }}>{fmtC(bidTotal)}</span>`<br>`src/tools/rabbit_v0.1.0/components/CurrencyDisplay.jsx:44` — `return <span className={className} style={style}>{formatted}</span>`




**R3-03 · HIGH · Alignment** — BreakdownTable renders six money and day columns fully left-aligned, header and cells  
law: Law of Uniform Connectedness

- Problem: BreakdownTable is the table behind seven of the thirteen budget tabs (By Phase, By Role, By Asset, By Scene, By Shot, By Level, By Experience, Custom). Its header spans and every one of its cells are left-aligned: the task count, the bid days, the logged days and the cost all start at the left edge of their grid column, so numbers of different lengths ragged-right against each other and cannot be compared by eye or summed down the column. This is the most-used table on the surface and it is the only one that never right-aligns anything.

- Why it matters: Cheapest high-impact fix on the surface: two components, roughly ten lines, fixes seven tabs.

- Change: Right-align every numeric column, header included, in Th/Td with align="right". Name column stays left. Cost column gets the mono numeric role. The change is entirely visual: same columns, same order, same data.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2848` — `<span className="truncate" style={{ color: '#d6d3d1' }}>{row.name}</span> <span style={{ color: '#a8a29e' }}>{row.taskCount}</span> <span style={{ color: '#a8a2`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2864` — `<span key={c} className="text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>{c}</span>`




**R3-04 · HIGH · Alignment** — The Custom tab's totals row does not line up with the table it totals  
law: Law of Uniform Connectedness

- Problem: The totals row is a sibling of BreakdownTable, not a row inside it. BreakdownTable wraps its rows in p-3 and pads each row px-3; the totals row sits outside that wrapper with px-2. The result is a roughly 13px horizontal offset between the totals row's six columns and the six columns directly above them, so the grand total does not sit under the column it totals. It is also left-aligned, so the total and the values it sums have different right edges as well as different left ones.

- Why it matters: A totals row that misses its own columns is the defect a money tool can least afford, and it is visible without measuring.

- Change: Move the totals row inside BreakdownTable as a `footer` slot on the shared Table so it inherits the same grid, the same cell padding and the same align="right" as the body. A totals row must be a row of the table, never a sibling of it.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1667` — `className="grid grid-cols-6 gap-2 px-2 py-2 mt-2 rounded-sm text-[11.5px] font-mono items-center"`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2844` — `<div className="flex flex-col gap-1 p-3">`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2847` — `<div key={'${row.name}-${i}'} className="grid grid-cols-6 gap-2 px-3 py-2 rounded-sm ...">`




**R3-05 · HIGH · Alignment** — The money columns are ordered three different ways across one tab set, and Crew and Talent put Variance before the Actual it is derived from  
**constraint: touches-interaction** · law: Mental Model

- Problem: Crew/Team and Talent read: Subtotal, Margin, Contingency, Bid Total, divider, Variance, Actual. The Topsheet on the Summary tab reads: Subtotal, Agency, Bid, Actual, Variance. The Expenses table reads: Estimated, Margin, Contingency, Actual, Variance. BreakdownTable reads: Bid, Logged, Variance, Cost. So the same four concepts appear in four orders, and in the two biggest tables the derived value (Variance = Actual minus Bid) is printed to the LEFT of the Actual it comes from. Scanning left to right the reader meets the answer before either input.

- Why it matters: Column order is the grammar of a money table; three grammars in one tab set is why the tabs do not read as one document.

- Change: Fix one order for the whole surface and apply it everywhere: Bid, Actual, Variance, with Subtotal / Margin / Contingency ahead of Bid where they exist. In Crew and Talent this means swapping the Variance and Actual cells in the header (CrewTeamTab 492-493, TalentTab 445-446), in the member and line rows, in the department subtotal and in the grand total. Flagged for Audrey because moving a column is arguably a change to a way of viewing, even though no control and no data changes.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:492` — `<div style={{ width: W_VAR, ... }}><span ...>Variance</span></div> <div style={{ width: W_ACT, ... }}><span ...>Actual</span></div>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1069` — `<span ... style={{ ... width: colW.bid }}>Bid</span> <span ... style={{ ... width: colW.actual }}>Actual</span> <span ... style={{ ... width: colW.variance }}>V`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2112` — `{ label: 'Actual', flex: 1, field: 'actual_cost' }, { label: 'Variance', flex: 0.8, field: 'variance' },`




**R3-06 · HIGH · Hierarchy** — Every label on this surface is physically smaller than the thing it labels, so hierarchy is carried entirely by orange  
law: Von Restorff Effect

- Problem: Card titles are 10.5px over 11.5px body. Field labels are 9.5px over a 10.5px select. FieldLabel in the detail popups is 10.5px over an 11.5px input. Table headers are 9.5px over 11.5px cells. In every pairing the heading is one to two pixels SMALLER than its content, and the only thing making it read as a heading is uppercase plus #fb923c. Convert this surface to greyscale and the hierarchy vanishes completely, which is exactly the failure mode the system review names app-wide.

- Why it matters: Colour-carried hierarchy collapses the moment the palette is reduced, which the palette pass is about to do.

- Change: Invert the relationship using the proposed scale: Card title becomes the 16px H2 step, sentence case, weight 600, with a hairline above instead of a filled bar. Field labels and table headers become the 11px Label step, weight 600, +0.06em, in ink at 72 percent, and their controls and cells rise to 13px Dense. Hierarchy then comes from size and weight, and orange is freed to mark the one active state.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2817` — `<h3 className="text-[10.5px] font-mono uppercase tracking-widest font-bold mb-4 px-1" style={{ color: '#fb923c' }}>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2885` — `<span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>{label}</span>`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:3352` — `<span className="block text-[10.5px] font-mono uppercase tracking-widest font-medium mb-1" style={{ color: '#78716c' }}>`




**R3-07 · HIGH · System** — Seventeen distinct type sizes on this surface, six of them half-pixel, three below 9px  
law: Law of Prägnanz

- Problem: Measured across the five files: 10.5px (162 uses), 11.5px (149), 9.5px (89), 12.5px (27), text-xs (16), 13.5px (13), text-sm (8), 8.5px (7), text-xl (5), 11px (3), 10px (3), text-lg (2), text-base (2), 8px (2), 14px (2), 7.5px (1), text-2xl (1). The half-pixel steps are below the rendering threshold at 96dpi, so 10.5 and 11.5 are not perceptibly different sizes doing different jobs; they are the same size written two ways. The 7.5px and 8px captions are below any legible floor.

- Why it matters: Seventeen sizes in eight thousand lines is not a scale, and it is the mechanism behind every hierarchy finding below.

- Change: Collapse onto the eight-step scale: 9.5px and 10.5px label uses become the 11px Label step; 10.5px and 11.5px cell and body uses become 13px Dense or 14px Body by role; 12.5px becomes 13px Dense; 13.5px and 14px become 16px H2; 18px and 20px become 20px H1; 24px stays as the one display number. Delete 7.5px, 8px and 8.5px outright, promoting their content to the 11px floor.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2850` — `className="absolute bottom-0 left-0 right-0 text-[7.5px] font-mono uppercase tracking-wider text-center py-px ..."`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:496` — `<span className="text-[8.5px] font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>{label}</span>`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:677` — `<span className="text-[8.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>{label}</span>`




**R3-08 · HIGH · Hierarchy** — Grand Total is rendered at three different sizes in three tabs of the same view  
law: Von Restorff Effect

- Problem: The Summary waterfall's Grand Total is a 16px uppercase orange label beside a 24px value. The Topsheet's Grand Total, four hundred pixels further down the SAME tab, is a 12.5px label beside 12.5px values. Crew/Team's Grand Total is 12.5px, and Talent's is 12.5px for the label and a mix of 11.5px and 12.5px across its own cells. The single most important number in the tool is rendered at four weights depending on which tab you are on, and in two of them it is smaller than a table cell elsewhere on the surface.

- Why it matters: If one element on this surface deserves to be unmistakable it is this one, and it is currently smaller than a row label on two tabs.

- Change: One GrandTotal treatment: label at the 16px H2 step, sentence case, weight 600, in ink at 100 percent; value at the 20px H1 step, tabular mono, weight 600, right-aligned to the same edge as the column above it, with a single 1px signal rule above the row. Apply it identically in all four places.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:658` — `<span className="text-base font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Grand Total</span> <div className="text-2xl font-mono font`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1139` — `<span className="flex-1 text-[12.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Grand Total</span>`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:656` — `className="px-3 py-2.5 text-[12.5px] font-mono font-bold uppercase tracking-wider" <span style={{ color: '#fb923c' }}>Grand Total</span>`




**R3-09 · HIGH · Hierarchy** — The Summary cost waterfall uses four label treatments and three amount sizes across five rows  
law: Law of Common Region

- Problem: Base cost: 13.5px bold uppercase tracked #d6d3d1 label, 16px amount. Margin and Contingency: 12px regular sentence-case #a8a29e label with a '+' prefix, 13.5px amount. Agency fee: 12px regular #a8a29e label plus a pill toggle plus an inline percentage button, 13.5px amount. Grand Total: 16px bold uppercase orange label, 24px amount. Five rows, four label languages, three amount sizes, two inks. This is a column of numbers the reader is meant to add up, and nothing about its typography says they belong to one sum. The rows also sit on #1c1917, the same value as the page ground, with no border, so the only thing making them rows is a 4px gap.

- Why it matters: This is the first thing a user sees on the Budget tab and it is where the money hierarchy either exists or does not.

- Change: One WaterfallRow component for all four input rows: label at 14px Body sentence case in ink at 72 percent, amount at 14px tabular mono in ink at 100 percent, right-aligned to a shared 160px column, on a paper-raised ground with a hairline between rows. Grand Total gets the single GrandTotal treatment from R3-08 with one signal rule above it. The '+' prefix becomes typographic (a leading sign inside the amount), not part of the label.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:588` — `<span className="text-[13.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#d6d3d1' }}>   Base cost`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1270` — `<span className="text-xs font-mono" style={{ color: '#a8a29e' }}>+ {label}</span>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:586` — `<div className="flex items-center justify-between py-3 px-4 rounded-sm mb-1"   style={{ backgroundColor: '#1c1917' }}>`




**R3-10 · HIGH · System** — Four separate summary-tile components with identical colour objects and three different layouts  
law: Law of Similarity

- Problem: BigTile in BudgetView, SummaryTile in CrewTeamTab, SummaryTile in TalentTab and BigTile in ScenesView all declare the same three-tone colour object verbatim. They have already diverged: BudgetView's takes a `hint` line and uses text-xl, the two SummaryTiles drop the hint and use text-xl, ScenesView's takes an `icon`, lays out horizontally instead of vertically and uses text-lg. Their containers also differ: grid grid-cols-1 sm:grid-cols-3 in Summary, flex gap-3 flex-wrap in Expenses, Crew and Talent, flex gap-3 px-4 pt-4 pb-2 in Scenes. Four components, three layouts, three row containers, one concept.

- Why it matters: Four copies of one tile in one surface is the local proof of the app-wide component-layer failure, and it is a two-hour fix.

- Change: One src/ui/StatTile taking label, value, optional hint, optional icon and a semantic tone token, in one row container at a fixed 24px gutter. Label at the 11px Label step, value at 20px H1 tabular, hint at 12px Caption, icon at 16px. Delete the four copies.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2826` — `function BigTile({ label, value, hint, tone = 'neutral' }) {   const colors = {     good: { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac' `<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:724` — `function SummaryTile({ label, value, tone = 'neutral' }) {   const colors = {     good: { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac' },`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1163` — `function BigTile({ icon: Icon, label, value, tone = 'neutral' }) {`




**R3-11 · HIGH · Colour** — Two status palettes, ten values, including a magenta and a purple, each doing four visual jobs  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: statusColor in ScenesView and budgetStatusColor in BudgetView are near-duplicates of the same nine-case switch; budgetStatusColor adds 'bidding' as #c084fc (purple) and ScenesView's uses #e879f9 (magenta) for 'needs_revisions'. Both are cool hues, in direct breach of the documented rule 'Warm over cool. No blues, no cyans' (visual-language Composition rule 2). Worse, 'approved' #4ade80 and 'final' #22c55e are two greens that are indistinguishable at 10.5px inside a 2px accent bar, so the two states the eye most needs to separate are the two that look the same. Each status colour is simultaneously the select's text colour, the select's border at 19 percent alpha, the group header's left accent bar and the card's bottom accent strip.

- Why it matters: Status is the single most repeated visual token in RABBIT and it currently has two sources of truth and a hue the design doc forbids.

- Change: One src/ui/StatusBadge taking a semantic token (not_started, in_progress, pending_review, needs_revisions, approved, final, blocked, on_hold, omitted, bidding) and rendering dot, fill and label from one source, so a status colour can never be written inline again. Map the ten values onto the four functional tokens plus warm screens: success for approved/final differentiated by weight not hue, warning for pending_review/on_hold, danger for blocked, ink at 48 percent for not_started/omitted, signal for in_progress. Retire #e879f9 and #c084fc.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:206` — `case 'needs_revisions': return '#e879f9' case 'approved':       return '#4ade80' case 'final':          return '#22c55e'`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2895` — `case 'needs_revisions': return '#e879f9' ... case 'bidding':         return '#c084fc'`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1367` — `border: '1px solid ${statusColor(sc.status)}30',`




**R3-12 · HIGH · Colour** — Sky blue and slate are used as chrome in the two biggest money tables, against the documented warm-only rule  
**constraint: palette-decision**

- Problem: CrewTeamTab and TalentTab paint the Variance and Actual column headers #38bdf8 (sky-400) and the twenty period column headers #64748b (slate-500). These are the only cool hues anywhere in RABBIT and they sit in the densest, most-read part of the tool. The usage is also internally inconsistent: the department subtotal's Actual value is #38bdf8 while the grand total's Actual value directly below it is #d6d3d1, so the same semantic cell is two colours at two levels of the same table.

- Why it matters: A named, written rule is being broken in the most-looked-at table in the app, and it is six lines to fix.

- Change: Delete #38bdf8 and #64748b. Every header on this surface becomes the 11px Label step in ink at 72 percent, warm. The actual-zone distinction is already carried by its darker ground and the divider; it does not need a second, cool signal. Make the department subtotal and grand total Actual cells the same ink.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:492` — `<span className="text-[9.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#38bdf8' }}>Variance</span>`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:647` — `<span style={{ color: '#38bdf8' }}>{group.actualTotal > 0 ? fmtCurrency(group.actualTotal, currency) : '—'}</span>`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:449` — `<span className="text-[8.5px] font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>{label}</span>`




**R3-13 · HIGH · Colour** — Three inks below 3.5:1 are used as body text, one of them at 1.7:1  
**constraint: palette-decision**

- Problem: Measured on this surface's own grounds. #57534e on #1c1917 is 2.32:1 and is the colour of every empty-cell em dash, the ScenesView result count, the gallery metadata and the Empty component's copy. #44403c on #1c1917 is 1.71:1 and is used as TEXT for the time-of-day, framing and camera-movement placeholders and for zero-value runtime and frame counts at 12.5px, which means a genuinely present zero is functionally invisible. #64748b on #1f1d1a is 3.52:1 and carries the twenty period column headers at 8.5px. None of these reach 4.5:1 and two do not reach 3:1 at any size.

- Why it matters: Audrey's colour rule is enforced on orange but nothing enforces the dark surface, and this is where the dark surface fails.

- Change: Collapse all four dark greys (#d6d3d1, #a8a29e, #78716c, #57534e) plus #44403c-as-text onto one ink, #f5f0ec, at 100 / 72 / 48 percent. The 48 percent screen is the floor for any text, including em dashes and zero values; #44403c survives only as a border, never as a glyph. Extend the authContrast.test.js pattern to assert these three ratios so a regression fails a test.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1380` — `style={{ color: sc.time_of_day ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1414` — `style={{ color: totals.totalFrames > 0 ? '#d6d3d1' : '#44403c' }}`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2928` — `return <div className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>{children}</div>`




**R3-15 · HIGH · Uniformity** — This surface registers document-level keyboard shortcuts twice and shows them nowhere — Audrey's named example, instantiated here  
law: Paradox of the Active User

- Problem: ExpensesTab binds Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y at the window level, and ScenesView binds the same pair at the document level. ExpensesTab surfaces them only in a title attribute on an icon button; ScenesView surfaces them nowhere at all, has no undo control of any kind, and silently binds nothing when supportsBins is false, so on the cloud the same keys do nothing with no affordance either way. This is precisely the gap Audrey called out with the bins shortcut bar: the same ecosystem, the same keys, a hint bar in one place and none anywhere else.

- Why it matters: Audrey named this exact gap unprompted; fixing it on two of the busiest views is the most visible proof the overhaul is a system and not a repaint.

- Change: Mount the promoted src/ui/ShortcutBar (28px, hairline top, Kbd plus 12px label pairs, groups separated by 24px) at the bottom of both ExpensesTab and ScenesView, listing the keys each actually registers. Where ScenesView's binding is conditional, the bar reflects the condition rather than lying. Same component, same height, same Kbd, as BinsView.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1849` — `if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() } if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:370` — `if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) ctxRef.current?.redo?.(); else ctxRef.current?.undo?.() }`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:365` — `if (!supportsBins) return`




**R3-16 · HIGH · Hierarchy** — Thirteen budget tabs in one register, separated by dividers that are invisible  
law: Hick's Law

- Problem: With all project flags on, the tab strip renders thirteen tabs plus two dividers, every one of them a 10.5px uppercase tracked chip with a 12px icon, so nothing distinguishes a report from a data entry surface from an exported document. The two dividers that were written to make that distinction are 1px by 16px in #292524 on a #1c1917 ground, a contrast ratio near 1.1:1, so they are not visible at all. The icon is also larger than the cap height of the label beside it, so the strip reads as a row of icons with captions rather than a row of tabs.

- Why it matters: Thirteen equal-weight choices at the entry point to the whole tool, with the one mechanism that would chunk them rendered invisible.

- Change: Visual grouping only, every tab stays reachable and stays a tab. Tabs adopt the proposed Tabs component: 14px sentence case, weight 400 inactive and 600 active, 2px signal underline, no fill. Make the two group separators a real hairline at rule (rgba(245,240,236,0.14)) with 24px of space either side, and label the three groups with the 11px Label step: Breakdowns, Entry, Output. Icons drop to 14px so they sit inside the cap height. See the Hick's hotspot entry for the disclosure option, which is out of scope under constraint 1.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:208` — `return <div key={t.id} className="self-stretch flex items-center mx-1"><div style={{ width: 1, height: 16, backgroundColor: '#292524' }} /></div>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:224` — `<Icon className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase tracking-wider">`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:51` — `const TABS = [ { id: 'summary', ... }, ... { id: 'client', label: 'Client View', icon: Eye } ]`




**R3-20 · HIGH · System** — Four different table mechanisms on one surface  
law: Law of Similarity

- Problem: BudgetView's version list is a 12-column CSS grid. BreakdownTable and the Custom totals row are 6-column CSS grids. Expenses rows, Crew/Team and Talent are flex rows with fixed pixel or flex-ratio column widths. ClientViewTab is a real <table>. Each mechanism has its own idea of cell padding, its own header treatment, its own row height and its own alignment defaults, which is why R3-03, R3-04 and R3-28 exist as separate defects rather than one. Row heights also differ: py-1.5, py-2, py-2.5 and a computed minHeight of rowH + 8 all appear as 'a table row' on this surface.

- Why it matters: System fix that resolves three separate alignment findings at once, which is exactly the ranking rule.

- Change: Promote one src/ui/Table with Th, Td and Row: 36px row, 32px head, 8px 12px cells, hairline dividers, no zebra, one hover fill, one selected fill plus a 2px signal left border, align="right" with tabular figures for numerics, and a fixed-width sort slot. Migrate all four. Where a table needs fixed pixel columns (Crew and Talent, because of the twenty period columns) the Table accepts a column-width map rather than each file inventing one.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:757` — `className="grid grid-cols-12 gap-2 px-3 py-1.5"`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2862` — `<div className={'grid ${sixCol ? 'grid-cols-6' : 'grid-cols-3'} gap-2 px-3 py-1.5'} ...`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:40` — `const W_NAME  = 180 const W_TYPE  = 56 const W_RATE  = 80`




**R3-22 · HIGH · Colour** — Forty-seven distinct hex values on this surface, with seven greys sharing the border role  
**constraint: palette-decision** · law: Law of Prägnanz

- Problem: Counted across the five files: 47 distinct hex values. The border role alone carries #44403c (206 uses), #57534e, #292524, #33302e, #3a3733, plus #e7e5e4 and #d6d3d1 in ClientViewTab, plus status-colour-at-19-percent borders in ScenesView. #33302e and #3a3733 each exist to be very slightly darker than #44403c in one context, a difference no viewer can name. The ground role carries #1c1917, #292524, #0c0a09, #1f1d1a, #1a1915, #1a1815 and #1a2e1a, where the last four are one-off near-blacks.

- Why it matters: Forty-seven values in five files is the local share of the app's 121, and the border role is where the drift is most visible as visual noise.

- Change: Map onto the proposed token set: paper #1c1917, paper-raised #232020 (absorbing #292524, #1f1d1a, #1a1915, #1a1815), paper-recessed #0c0a09, rule rgba(245,240,236,0.14) for every hairline (absorbing #44403c, #57534e, #33302e, #3a3733 in their border role), ink at three screens for every grey glyph, signal #ea580c for the one active state. Delete the one-off #1a2e1a and #166534 in favour of the success token.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1079` — `style={{ backgroundColor: bold ? '#292524' : '#1c1917', border: '1px solid ${bold ? '#57534e' : '#3a3733'}' }}`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:565` — `style={{ color: row.marginAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:775` — `backgroundColor: isActive && v.id === lockedVersionId ? '#1a2e1a'   : v.is_active ? '#292524' : '#1c1917',`




**R3-25 · HIGH · Hierarchy** — The ScenesView toolbar puts sixteen controls in one wrapping row, including two identical size triples  
law: Hick's Law

- Problem: In one flex-wrap row: content mode (2 buttons), Filter, a sort select of six or nine options, a sort-direction button, a group select of three or seven options, view mode (2 buttons), a thumbnail-size triple, a gallery-size triple, an FPS badge, a saved-views icon button, a search field, a result count, New Scene, and New Shot with its own dropdown. Sixteen interactive targets, all at 10.5px uppercase, with three different divider specs between them. The thumbnail-size and gallery-size triples are the same control (item size) rendered as two separate three-button groups that are mutually exclusive by view mode, so the user learns two controls for one idea. The FPS badge sits in the middle of the interactive row but is not interactive.

- Why it matters: Highest choice count of any single row on this surface, and merging the two size triples costs nothing in reachability.

- Change: Adopt src/ui/Toolbar: 44px, 24px gutter, hairline bottom, left and right slots, every child 28px so the row has one baseline and never wraps. Left slot: content mode, view mode, filter, sort, group. Right slot: size (ONE segmented triple, since the two are never visible at once, so this is a rename not a behaviour change), saved views, search, count, then the two primary create buttons. Move the FPS badge out of the interactive row into the page header as an 11px Label-step readout, since it is state, not a control.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:734` — `<div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:810` — `{[{ key: 'sm', size: 10 }, { key: 'md', size: 13 }, { key: 'lg', size: 16 }].map(({ key, size }) => (`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:844` — `<span className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0" ...>{fps} fps</span>`




**R3-26 · HIGH · Build** — ScenesView paints thirty-two hover borders by mutating e.target.style directly, so its selects are invisible until hovered  
law: Paradox of the Active User

- Problem: Every inline select and number input in the scene and shot rows is rendered with border '1px solid transparent' and then given a border by onMouseEnter / onMouseLeave handlers that write to e.target.style.borderColor. There are 32 such mutations. Two consequences. Visually, six of the thirteen columns in a shot row are editable controls with no affordance at rest, so the row looks like static text until the mouse happens to cross it, and the table has no consistent control chrome. Mechanically, these handlers will fight any CSS-based hover the overhaul introduces, because an inline style always wins.

- Why it matters: It is both a visible readability defect and the thing most likely to make a CSS-token rewrite silently not apply.

- Change: Delete all 32 handlers. Give inline table controls a rest-state chrome from the Input/Select tokens: transparent background, 1px rule-colour bottom border only, 4px radius, 28px height, with the full hairline box appearing on hover and focus via CSS. This makes the editable cells legible as editable without changing what clicking them does. This is the single biggest mechanical hazard in the ScenesView rework and should be done in one pass, not incrementally.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1380` — `style={{ color: sc.time_of_day ? '#a8a29e' : '#44403c', border: '1px solid transparent' }} onMouseEnter={e => { e.target.style.borderColor = '#44403c' }} onMous`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1608` — `onMouseEnter={e => { e.target.style.borderColor = '#44403c' }} onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderColor = 'trans`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2008` — `style={{ color: 'transparent', border: '1px solid transparent' }}`




**R3-14 · MEDIUM · Alignment** — The sign sits on two different sides of the currency symbol inside one right-aligned column  
law: Law of Uniform Connectedness

- Problem: Every variance cell composes the sign by hand: a positive renders '+$1,234' because '+' is prepended to the formatted string, a negative renders '-$1,234' because toLocaleString puts the minus before the symbol. So in a right-aligned column the reader scanning the left edge of the numbers sees '+$' on one row and '-$' on the next, and the glyph that carries the meaning is not in a consistent position. The pattern is repeated in five places.

- Why it matters: Small and cheap, and it is the difference between a variance column you can scan and one you must read.

- Change: Give CurrencyDisplay a `signed` prop that formats with signDisplay:'exceptZero', so the sign is placed by Intl and is always in the same position relative to the symbol. Remove the five hand-built `${v > 0 ? '+' : ''}` prefixes.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1086` — `{bidTotal > 0 || actualTotal > 0 ? '${v > 0 ? '+' : ''}${fmtC(v)}' : '—'}`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:587` — `? '${row.variance > 0 ? '+' : ''}${fmtCurrency(row.variance, currency)}'`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:537` — `? '${comp.variance > 0 ? '+' : ''}${fmtCurrency(comp.variance, currency)}'`




**R3-17 · MEDIUM · System** — The active budget tab fills with the frame's own orange and carries a dead underline  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: The active tab sets backgroundColor #ea580c and borderBottom 2px solid #ea580c simultaneously. The underline is the same colour as the fill it sits on, so it can never be seen: it is dead code that nonetheless reserves two pixels on every tab, active or not. Separately, #ea580c is the app frame's colour, so a content-layer control is borrowing the chrome's identity, which the system review's condition on keeping the orange frame explicitly forbids.

- Why it matters: It is three lines, it removes a dead rule, and it is the concrete instance of the frame-colour rule the palette decision turns on.

- Change: One active treatment: a 2px signal underline on a transparent tab, no fill, label weight 600. Delete the backgroundColor. Keep the 2px reserved on inactive tabs so the label does not shift. This is the same treatment the proposed Tabs component uses everywhere else in the app.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:218` — `color: active ? '#fff7ed' : '#a8a29e', backgroundColor: active ? '#ea580c' : 'transparent', borderBottom: active ? '2px solid #ea580c' : '2px solid transparent'`




**R3-18 · MEDIUM · System** — Three different active-state treatments for tab-like controls inside one tool  
law: Law of Similarity

- Problem: The Budget tab strip marks active with a solid #ea580c fill plus an invisible underline and no container. ScenesView's content-mode and view-mode toggles mark active with a solid #ea580c fill inside a shared 1px bordered segmented group. ScenesView's thumbnail-size and gallery-size triples mark active with a fill plus a 1px left border between items. The Filter button marks active by turning its label #fb923c. Four controls that all mean 'this one is selected', four visual languages, in two files of one tool.

- Why it matters: Same meaning rendered four ways inside one tool is the clearest thing a viewer registers as 'this is not one product'.

- Change: Two components cover all four: Tabs (2px signal underline, no fill) for the budget strip, and a Segmented control (one bordered group, active gets a paper-raised fill and weight 600, never the signal fill) for content mode, view mode and the two size triples. The Filter button becomes a Chip with one active treatment shared with every other filter chip in RABBIT.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:741` — `color: contentMode === m ? '#fff7ed' : '#78716c', backgroundColor: contentMode === m ? '#ea580c' : 'transparent',`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:814` — `backgroundColor: thumbSize === key ? '#ea580c' : 'transparent', color: thumbSize === key ? '#fff7ed' : '#78716c', borderLeft: key !== 'sm' ? '1px solid #44403c'`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:753` — `style={{ color: filters.length > 0 ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}`




**R3-19 · MEDIUM · System** — Five empty states, three loading states, and loading is rendered with the empty-state component  
law: Doherty Threshold

- Problem: 'Nothing here' appears in five shapes: an italic 11.5px line with no container (BudgetView's Empty), a centred block with a 40px icon and a 10.5px body (CrewTeamTab), the same block plus an action button (TalentTab), a centred 12.5px uppercase line (SceneTable), and a centred 12.5px uppercase line carrying an instruction (ShotTable). Loading appears in three shapes, and one of them is literally the Empty component with the word Loading in it, so a table that is still fetching and a table that is genuinely empty look identical. Below 400ms that is invisible; above it, it reads as 'there is no data'.

- Why it matters: Cheap, and it removes a state ambiguity that currently makes a slow load look like a broken budget.

- Change: One src/ui/EmptyState (24px icon, 14px sentence-case title, 13px body, optional action slot) for all five, and a separate src/ui/Loading that renders skeleton rows for tables and a spinner elsewhere. Never route a loading state through EmptyState.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2011` — `if (expLoading) return <Empty>Loading expenses...</Empty>`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:424` — `<div className="flex flex-col items-center justify-center py-16 gap-4">   <Users className="w-10 h-10" style={{ color: '#44403c' }} />`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1230` — `<span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>   No scenes yet`




**R3-21 · MEDIUM · Hierarchy** — A 3px saturated orange rule runs the full height of the Crew and Talent tables and is the loudest thing on screen  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: W_DIV is 3px of #fb923c, repeated on the header row, every member row, every department subtotal and the grand total, so it reads as an unbroken saturated vertical bar through the whole table. It is the only vertical rule anywhere in RABBIT and it is more visually dominant than any number in the table, including the grand total. A zone boundary is being carried by the loudest element available when the two zones already differ by ground colour.

- Why it matters: The most emphasised element in a money table should not be a divider.

- Change: Reduce the divider to a 1px hairline at rgba(245,240,236,0.14), the same rule used everywhere else. The bid and actual zones stay distinguished by their existing ground difference plus the column headers. If a stronger boundary is wanted, add 16px of gutter rather than saturation.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:50` — `const W_DIV   = 3`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:579` — `<div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:528` — `<div style={{ width: W_DIV, backgroundColor: '#fb923c' }} />`




**R3-23 · MEDIUM · Motion** — Two row-hover languages in one tool, one of which brightens the images inside the row  
law: Law of Similarity

- Problem: Expenses rows, Breakdown rows, Scene rows and Shot rows use hover:bg-stone-800, a background swap. Crew/Team and Talent rows use hover:brightness-110, a CSS filter on the entire row. The filter also brightens the 3px orange divider, the status chips and any BinPoster or img the row contains, which is not what a hover state should do to content. It is also a different perceived response speed because a filter re-composites the whole row.

- Why it matters: Cheap, and hover:brightness on a row containing thumbnails is a visible artefact rather than a state.

- Change: One hover: a paper-raised background fill at 150ms on the Row component, everywhere. Delete both hover:brightness-110 uses. Filters never apply to a row containing media.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:517` — `<div key={row.id} className="flex transition-colors hover:brightness-110" style={{ borderBottom: '1px solid #3a3733' }}>`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:462` — `<div className="flex transition-colors hover:brightness-110 group/trow" style={{ borderBottom: '1px solid #3a3733' }}>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2026` — `className="flex items-center gap-2 px-3 py-2 rounded-sm transition-colors hover:bg-stone-800 cursor-pointer group"`




**R3-24 · MEDIUM · Build** — Hover-revealed row actions never reveal on focus, and their reserved slots are four different widths  
**constraint: touches-interaction** · law: Fitts's Law

- Problem: All seven hover-action slots are gated purely on group-hover, so a keyboard user tabbing through the table reaches a delete button that is at opacity 0 and cannot see what is focused. The reserved slot widths also differ: w-14 (56px) in the Scenes tables, flex 0.5 in ExpenseRow, W_DEL 36px in TalentTab, and absolute positioning in both galleries, so the right edge of each table ends at a different place.

- Why it matters: One component, seven call sites, and it removes a real keyboard dead end.

- Change: Promote src/ui/HoverActions with a single reserved width, revealing on group-hover AND focus-within, 120ms opacity. Adopt in all seven places. Purely additive to keyboard reachability, flagged so Audrey can confirm she wants the focus behaviour.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1424` — `<span className="w-14 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2099` — `<div style={{ flex: 0.5 }} className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" ...`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:522` — `<div style={{ width: W_DEL, backgroundColor: '#1c1917' }} className="flex items-center justify-center opacity-0 group-hover/trow:opacity-100 transition-opacity"`




**R3-27 · MEDIUM · Build** — The client estimate, the one document that leaves the building, is set in Courier New by a second stylesheet living in a template literal

- Problem: ClientViewTab's print window writes its own sixteen-rule stylesheet inside a string, with font-family 'Courier New', monospace on the body, an 18px uppercase h1 at 2px tracking, 9px table headers and 11px cells. The on-screen preview card directly above it uses font-mono (the browser fallback) with an 18px text-lg heading and 11.5px cells. So the preview is not a preview of what prints, and the printed artefact will not follow the overhaul unless someone remembers this string exists.

- Why it matters: It is the only artefact on this surface a client sees, and it is the one place the typeface decision is externally visible.

- Change: Derive the print stylesheet from the same tokens as the preview: one embedded webfont declaration or a documented print fallback, the 20px H1, 11px Label headers, 13px Dense cells, one hairline, one total rule. Then assert by rendering both from the same values so the preview is genuinely the preview. At minimum, replace 'Courier New' with the chosen sans, since Courier is the single most dated thing a client sees.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:116` — `body { font-family: 'Courier New', monospace; padding: 40px; color: #1c1917; }`<br>`src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:181` — `<h2 className="text-lg font-mono font-bold uppercase tracking-wider mb-1" style={{ color: '#1c1917' }}>`<br>`src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:122` — `th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px; border-bottom: 2px solid #1c1917; }`




**R3-28 · MEDIUM · Alignment** — The budget-versions table indents its header four pixels differently from its rows, and expresses selection through a nested ternary of six colours  
law: Law of Uniform Connectedness

- Problem: The header row is px-3 py-1.5 and the data rows are px-2 py-2, so in a six-column money table the column labels sit 4px right of the values beneath them and the header is 4px shorter than a row. Selection is computed inline as a three-way ternary over background (#1a2e1a, #292524, #1c1917) and a matching three-way ternary over border (#22c55e, #ea580c, #44403c), with the name cell's colour computed by a third ternary (#86efac, #fb923c, #d6d3d1). Three states, nine colour decisions, written inline in the row.

- Why it matters: Small, measurable, and in the table that decides which bid is the contract.

- Change: Move into the shared Table: one cell padding of 8px 12px for both head and body, one hover fill, one selected fill plus a 2px signal left border, and a StatusBadge for the locked and active markers instead of colouring the whole row. The locked state becomes a badge, not a green row.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:757` — `className="grid grid-cols-12 gap-2 px-3 py-1.5"`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:773` — `className="grid grid-cols-12 gap-2 px-2 py-2 rounded-sm text-xs font-mono items-center"`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:799` — `<span className="col-span-4 truncate" style={{   color: isActive && v.id === lockedVersionId ? '#86efac'     : v.is_active ? '#fb923c' : '#d6d3d1' }}>`




**R3-29 · MEDIUM · Density** — Eight icon sizes, and in the tab strip the icon is taller than the cap height of its own label  
law: Law of Similarity

- Problem: Icons on this surface run w-2.5 (10px), w-3 (12), w-3.5 (14), w-4 (16), w-5 (20), w-6 (24), w-7 (28) and w-10 (40). In the budget tab strip a 12px icon sits beside a 10.5px uppercase label whose cap height is about 7.5px, so the icon reads as the dominant object and the label as its caption. The same mismatch occurs on every toolbar button, where a 14px icon accompanies a 10.5px label.

- Why it matters: An icon larger than its label's cap height is the fastest visual tell of an undesigned control.

- Change: Three icon sizes only: 14px inside dense controls and table cells, 16px in rows and buttons, 24px in empty states. Set icon size to the cap height of the label beside it, not to its point size. Delete the 10px, 20px, 28px and 40px uses.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:224` — `<Icon className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase tracking-wider">`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:425` — `<Users className="w-10 h-10" style={{ color: '#44403c' }} />`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:610` — `{hasAttach && <Paperclip className="absolute top-0 right-0.5 w-2.5 h-2.5" style={{ color: '#fb923c' }} />}`




**R3-30 · MEDIUM · Density** — Card draws a box around content that does not need one, and its title sits inside the box smaller than the body  
law: Law of Common Region

- Problem: Card wraps every Summary section in a 1px #44403c box with p-5 and mb-4, then puts a 10.5px orange uppercase title inside it. Five stacked boxes down the Summary tab produce five competing regions with no ranking between them, and the boxes are doing the grouping work that proximity and a section rule would do more quietly. Card also sets its own mb-4 while the parent already sets gap-4, so the vertical rhythm between cards is 16px in some places and 32px in others.

- Why it matters: Five equal boxes is the reason the Summary tab has no reading order below the tiles.

- Change: Replace Card's box with the proposed SectionTitle: a 16px sentence-case heading at weight 600 with a hairline above it and 32px of space before, 16px after, no border, no fill. Delete the internal mb-4 so the parent's gap is the only vertical rhythm. This satisfies Common Region through rule and gutter rather than through a card, which is the point the design-direction skill makes explicitly.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2815` — `<div className="rounded-sm p-5 mb-4" style={{ border: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:527` — `<div className="flex flex-col gap-4">`




**R3-31 · MEDIUM · Density** — Four different content gutters inside one view  
law: Law of Proximity

- Problem: BudgetView's content area is p-6 (24px). Its tab strip and rate-card banner are px-5 (20px). BreakdownTable and SceneTable wrap in p-3 (12px). ScenesView's tiles, toolbar and filter panel are px-4 (16px), its toolbars' info bars are px-1 (4px), and the ExpensesTab toolbar is px-1 while the table header directly below it is px-3. So the left edge of the toolbar, the left edge of the column headers and the left edge of the rows are three different verticals in the same table, and moving between tabs shifts the whole content block left and right.

- Why it matters: Audrey named alignment and placement specifically; this is the one that makes the whole surface look untidy at a glance.

- Change: One page gutter of 24px, applied by the view shell, used by the tab strip, the toolbar, the table and the footer alike, so every left edge on the surface is the same vertical. Tables stop setting their own padding; only cell padding (8px 12px) lives inside the Table.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:252` — `<div className="flex-1 overflow-auto p-6">`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2137` — `<div className="flex items-center gap-3 px-1 flex-wrap">`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2234` — `<div className="relative flex gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid #44403c' }}>`




**R3-32 · MEDIUM · System** — Five hand-rolled popovers duplicating the same clamping maths with hardcoded 280 by 320 geometry  
**constraint: touches-interaction** · law: Law of Similarity

- Problem: ActualPopover appears twice (CrewTeamTab, TalentTab), MarginContPopover appears twice (CrewTeamTab, TalentTab) and ExpenseMarginContPopover once (BudgetView). All five compute left and top from a stored rect with the same three lines, all five use a 2px #ea580c border and a 0 12px 40px rgba(0,0,0,0.6) shadow, all five register their own document mousedown listener, and all five hardcode popW and popH so the clamp is wrong the moment their content changes height. The two margin-and-contingency popovers are byte-for-byte the same component in three files.

- Why it matters: Three identical components in three files is the clearest duplication on the surface and it is already solved elsewhere in the app.

- Change: Promote binUi's Menu and Dialog (viewport clamping already handled, modal stack, topmost-only Escape, busy lock) and render all five through them: one floating surface, 8px radius, one shadow at 0 8px 24px rgba(0,0,0,0.35), one backdrop value. Delete the three duplicate MarginContPopover definitions and keep one. Flagged because the shared component owns outside-click and Escape behaviour.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:70` — `const popW = 280 const popH = 320 const left = Math.min(pos.x, window.innerWidth - popW - 12)`<br>`src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:201` — `const popW = 280 const popH = 280 const left = Math.min(pos.x, window.innerWidth - popW - 12)`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2388` — `const popW = 280 const popH = 280 const left = Math.min(pos.x, window.innerWidth - popW - 12)`




**R3-33 · MEDIUM · Density** — Twenty period cells per row at roughly 16px tall, each opening a 280 by 320 popover  
law: Fitts's Law

- Problem: Each period cell is a full-width button with py-0.5 on a 10.5px font, so the target is about 16px tall inside a 72px column, and there are twenty of them per row by default (budget_actual_column_count defaults to 20). With a dozen crew members that is 240 sixteen-pixel targets on one screen, each of which opens a large popover, and the resting content of an empty cell is a single middle dot at #44403c on #1a1915, which is under 2:1 and effectively invisible. The margin and contingency cells beside them are the same 16px height inside an 80px column.

- Why it matters: This is the actual data-entry surface of the budget and it has the smallest targets in the tool.

- Change: Raise the cell control to the 28px sm density token so the click target matches the rest of the app, set the empty marker at the ink 48 percent screen so an empty cell is legibly empty, and give a cell with a value a paper-raised fill rather than a border. Column width stays 72px; only the row height and the marker change. Same interaction, same popover.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:603` — `className="relative w-full text-[10.5px] font-mono rounded-sm py-0.5 transition-colors hover:bg-stone-700"`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:605` — `color: cellActual?.value ? '#d6d3d1' : '#44403c', border: '1px solid ${cellActual?.value ? '#57534e' : '#33302e'}',`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:609` — `{cellActual?.value ? fmtCurrency(cellActual.value, currency) : '·'}`




**R3-36 · MEDIUM · Hierarchy** — The scene and shot detail popups present twelve fields in three unlabelled three-column grids with no section headings  
law: Chunking

- Problem: The shot popup stacks three separate grid-cols-3 blocks with a mb-5 between them: Status / Type / Time of Day / Shot number / Frame count / Duration, then Framing / Camera Movement / empty div, then Parent scene / Start Date / End Date. Nothing names the groups, one cell is an empty placeholder div holding the grid open, and the read-only fields (Duration, Parent scene) are styled identically to the editable selects beside them, so the reader cannot tell which cells accept input. The scene popup has the same structure. Twelve to fifteen fields with no chunking.

- Why it matters: The popup is where a shot is actually specified, and right now it reads as one undifferentiated field dump.

- Change: Keep the same fields, the same order and the same grid. Add three SectionTitle eyebrows at the 11px Label step with a hairline above: Identity, Camera, Schedule. Replace the empty placeholder div with a grid-column span. Give read-only fields a distinct treatment (no border, ink at 72 percent, no focus ring) so editable and inert stop looking alike.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2865` — `<div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2939` — `<div />`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2911` — `<FieldLabel>Duration</FieldLabel> <div className="px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums rounded-sm"   style={{ backgroundColor: '#1c1917', color: .`




**R3-38 · MEDIUM · System** — Selection is expressed three ways across four tables on this surface  
law: Law of Similarity

- Problem: Expense rows and Scene and Shot rows mark selection with an orange tint at 8 to 10 percent plus a full #ea580c border. Budget version rows mark the active version with a full #ea580c border and a #292524 fill, and the locked one with a #22c55e border and a #1a2e1a fill. The Custom tab's filters express their active state by turning a label orange. Four tables, three selection languages, and in the versions table the selection colour also carries semantic state, so a user cannot tell selected from locked from active without reading the icon.

- Why it matters: Selection is the state a user changes most often and it should never mean two things.

- Change: One selected treatment everywhere: a paper-raised fill plus a 2px signal left border on the row, no full-perimeter border, no hue change. Semantic states (active, locked) become StatusBadge chips inside the row, which separates 'I picked this' from 'the system says this'.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2027` — `style={{ backgroundColor: isChecked ? 'rgba(234, 88, 12, 0.1)' : '#1c1917', border: '1px solid ${isChecked ? '#ea580c' : '#44403c'}' }}`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1288` — `backgroundColor: isChecked ? 'rgba(234, 88, 12, 0.1)' : '#1c1917', border: '1px solid ${isChecked ? '#ea580c' : '#44403c'}',`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:777` — `border: '1px solid ${isActive && v.id === lockedVersionId ? '#22c55e'   : v.is_active ? '#ea580c' : '#44403c'}',`




**R3-39 · MEDIUM · Typography** — The Client View preview sets its metadata at 9.5 and 10.5px on a near-white card, below any desktop floor

- Problem: The preview card is #fafaf9 with #78716c metadata at 9.5px for the Project Code and Date labels and 10.5px for the signature block. #78716c on #fafaf9 measures 4.66:1, which passes for body but not at those sizes, and this is the one surface on the tool that is meant to look like a printed document a client reads. The card's own heading is 18px uppercase tracked mono, which is the only uppercase display type on a light ground anywhere in RABBIT.

- Why it matters: Small surface, but it is the only one an outside reader ever sees.

- Change: Bring the preview onto the shared scale: labels at the 11px Label step, values and table cells at 13px Dense, the project title at the 20px H1 step in sentence case, the total at 16px H2. Metadata ink moves to the light-surface ink at its 72 percent screen. Keep the card's near-white ground; it is correct for a document proxy.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:188` — `<span className="text-[9.5px] uppercase tracking-widest block" style={{ color: '#78716c' }}>Project Code</span>`<br>`src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:181` — `<h2 className="text-lg font-mono font-bold uppercase tracking-wider mb-1" style={{ color: '#1c1917' }}>`<br>`src/tools/rabbit_v0.1.0/views/budget/ClientViewTab.jsx:258` — `<div className="flex flex-col gap-4 text-[10.5px] font-mono" style={{ color: '#1c1917' }}>`




**R3-34 · LOW · Build** — CurrencyDisplay does not inherit colour, so every call site writes the colour twice

- Problem: Callers set a colour on the wrapping element and then pass the identical colour again in CurrencyDisplay's style prop, because the component's span would otherwise not inherit through the surrounding div's own style. About twenty-five call sites carry a duplicated inline colour for this reason, which means a token swap must edit both halves of each pair or the numbers and their containers will disagree.

- Why it matters: Removes twenty-five places where the palette pass could half-apply.

- Change: Let CurrencyDisplay's span inherit (color: 'inherit' by default) and delete the duplicated style prop from every call site. One colour decision per cell.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:591` — `<div className="text-base font-mono font-bold text-right" style={{ color: '#d6d3d1', width: 160, flexShrink: 0 }}>   <CurrencyDisplay value={baseCost} currency=`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1296` — `<CurrencyDisplay value={amount} currency={currency} style={{ color: '#a8a29e' }} />`




**R3-35 · LOW · Alignment** — The Summary amount column's 160px width is a magic number written four times in two components

- Problem: The waterfall's right column is set with width: 160, flexShrink: 0 on the Base cost row, on the Agency fee row, on the Grand Total row and inside WaterfallRow. They currently match, so the column aligns, but nothing enforces it: changing one leaves three behind and the alignment silently breaks.

- Why it matters: Low cost, and it is the kind of thing that regresses on the very next edit.

- Change: One exported constant, or better, let the shared Table own the column so the width is declared once in a column map. The width itself should be re-derived after the type change, since a 14px tabular figure is wider than an 11.5px mono one.

- Evidence: `src/tools/rabbit_v0.1.0/views/BudgetView.jsx:591` — `style={{ color: '#d6d3d1', width: 160, flexShrink: 0 }}`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1295` — `<div className="text-[13.5px] font-mono text-right" style={{ color: '#a8a29e', width: 160, flexShrink: 0 }}>`




**R3-37 · LOW · Colour** — The actual zone uses two near-identical near-blacks depending on row type  
**constraint: palette-decision**

- Problem: In Crew/Team and Talent the actual zone's ground is #1f1d1a on the header row, the department subtotal and the grand total, and #1a1915 on the member and line rows. The difference is imperceptible but arbitrary, and it means the zone's identity is two hexes rather than one, which will survive a careless token migration as two tokens.

- Why it matters: Two tokens where there is one job, and it is invisible enough that nobody will catch it during migration.

- Change: One ground for the actual zone, taken from paper-raised or paper-recessed. The distinction between a header row and a data row comes from the hairline and the type weight, never from a two-percent luminance shift.

- Evidence: `src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:580` — `<div style={{ width: W_VAR, backgroundColor: '#1a1915' }} ...`<br>`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:636` — `<div style={{ width: W_VAR, backgroundColor: '#1f1d1a' }} ...`




**R3-40 · LOW · Density** — The same checkbox has two different hit areas depending on which table it is in  
law: Fitts's Law

- Problem: In SceneTable and ShotTable the checkbox is a 12px icon inside a w-7 span that carries the onClick, so the target is 28px wide. In the Expenses header and rows it is a 12px icon inside a button with p-0.5, so the target is about 20px. In the nested shot rows it is a bare span with no width class at all, so the target is the icon itself at 12px. Three hit areas for one control, the smallest of them well under any reasonable target size.

- Why it matters: Three targets for one control, and the smallest is 12px.

- Change: One Checkbox component: a 14px glyph in a 28px square target, everywhere, with the same rest, hover and checked treatments. The visual size of the glyph does not change; only the target does.

- Evidence: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1294` — `<span className="w-7 flex items-center justify-center cursor-pointer flex-shrink-0"   onClick={e => { e.stopPropagation(); toggleOne(sc.id) }}>`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1478` — `<span className="flex items-center justify-center cursor-pointer flex-shrink-0"   onClick={() => toggleNestedShot(shot.id)}>`<br>`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2032` — `<button type="button" onClick={() => expToggleOne(exp.id)}   className="p-0.5 rounded hover:bg-stone-700 transition-colors"`





## Uniformity gaps

- **Keyboard shortcut hints (Audrey's named example)** — here: Ctrl+Z / Ctrl+Shift+Z bound at window level in BudgetView.jsx:1842-1854 and at document level in ScenesView.jsx:364-375. The only surfacing anywhere is a title attribute on the Expenses undo button (BudgetView.jsx:2147). ScenesView shows nothing and has no undo control at all. — elsewhere: BinsView mounts a persistent shortcut bar at the bottom of the view. — do: Mount the promoted src/ui/ShortcutBar (28px, hairline top, Kbd plus 12px label pairs, groups at 24px) in both ExpensesTab and ScenesView, and make it the mounting rule for any view that registers document-level keys.

- **Summary tile** — here: Four components: BigTile BudgetView.jsx:2826 (vertical, hint, text-xl), SummaryTile CrewTeamTab.jsx:724 (vertical, no hint, text-xl), SummaryTile TalentTab.jsx:695 (identical copy), BigTile ScenesView.jsx:1163 (horizontal, icon, text-lg). Three different row containers. — elsewhere: Every other WILSON surface hand-rolls its own tile too; this is the app-wide pattern the system review flags. — do: One src/ui/StatTile with label at 11px Label, value at 20px H1 tabular, optional 12px hint, optional 16px icon, semantic tone token, in one 24px-gutter row container.

- **Money formatting** — here: Four copies of fmtCurrency hardcoding en-US (BudgetView.jsx:46, CrewTeamTab.jsx:23, TalentTab.jsx:33, ClientViewTab.jsx:14) alongside CurrencyDisplay using the viewer's locale (CurrencyDisplay.jsx:34). Both render on the Summary tab at once. — elsewhere: CurrencyDisplay exists precisely to be the one formatter; its own header says 'so that every dollar/euro/yen amount inside RABBIT renders the same way'. — do: Route everything through CurrencyDisplay with one explicit locale, tabular figures and the fallback em dash; delete the four copies.

- **Status colour** — here: statusColor ScenesView.jsx:202 and budgetStatusColor BudgetView.jsx:2891, two near-identical nine-case switches, with each colour doing four jobs (select text, select border at 19 percent, group accent bar, card accent strip). — elsewhere: Every RABBIT view that shows a status writes its own switch. — do: One src/ui/StatusBadge taking a semantic token and rendering dot, fill and label from one source, so a status colour cannot be written inline again.

- **Table** — here: Four mechanisms: grid-cols-12 (BudgetView.jsx:757), grid-cols-6 (BudgetView.jsx:2862), flex with fixed px or flex ratios (CrewTeamTab.jsx:40-53, BudgetView.jsx:2107-2118), real <table> (ClientViewTab.jsx:198). — elsewhere: The system review counts 19 hand-built tables and 10 header-cell implementations app-wide. — do: Promote one src/ui/Table with Th/Td/Row; ClientViewTab's markup is the closest existing thing and should be the starting point.

- **Empty and loading state** — here: Five empty shapes (BudgetView.jsx:2927, CrewTeamTab.jsx:422, TalentTab.jsx:372, ScenesView.jsx:1227, ScenesView.jsx:1757) and three loading shapes, one of which routes through the empty component (BudgetView.jsx:2011). — elsewhere: Same duplication on every WILSON surface. — do: One EmptyState and one separate Loading with table skeleton rows. A loading state never uses EmptyState.

- **Active state on tab-like controls** — here: Signal fill plus dead underline (BudgetView.jsx:218), signal fill inside a bordered segmented group (ScenesView.jsx:741 and 797), signal fill with a per-item left border (ScenesView.jsx:814), orange label only (ScenesView.jsx:753). — elsewhere: The system review counts four tab bars with three active treatments app-wide. — do: Tabs get a 2px signal underline with no fill; Segmented gets a paper-raised fill with weight 600; Chip gets one active treatment.

- **Row hover** — here: hover:bg-stone-800 in Expenses, Breakdown, Scene and Shot rows; hover:brightness-110 in CrewTeamTab.jsx:517 and TalentTab.jsx:462, which also brightens thumbnails and the orange divider. — elsewhere: Background swap is the app's dominant convention. — do: One paper-raised hover fill at 150ms on the shared Row. No filters on rows containing media.

- **Popover** — here: Five hand-rolled fixed popovers with duplicated clamping and hardcoded 280x320 geometry (CrewTeamTab.jsx:70 and 151, TalentTab.jsx:82 and 201, BudgetView.jsx:2388); MarginContPopover exists three times byte-for-byte. — elsewhere: binUi's Menu and Dialog already handle viewport clamping, the modal stack and topmost-only Escape. — do: Promote binUi's Menu and Dialog; delete the duplicates and keep one margin-and-contingency editor.

- **Divider** — here: Three specs on one surface: 1x16 #292524 (BudgetView.jsx:208 tab strip, ScenesView.jsx:758 toolbar), 1x20 #44403c (BudgetView.jsx:2155 Expenses toolbar), 1x18 and 1x14 #44403c inside bulk bars (BudgetView.jsx:2242, ScenesView.jsx:1263). — elsewhere: No shared rule token exists. — do: One hairline token at rgba(245,240,236,0.14), one height derived from the control height it separates, 24px of space either side in a toolbar.

- **Content gutter** — here: p-6 (BudgetView.jsx:252), px-5 (BudgetView.jsx:203), p-3 (BudgetView.jsx:2844, ScenesView.jsx:1238), px-4 (ScenesView.jsx:726 and 734), px-1 (BudgetView.jsx:2137). — elsewhere: The system review proposes one 24px page gutter app-wide. — do: One 24px gutter owned by the view shell; tables stop setting their own padding and own only cell padding.

- **Checkbox** — here: 28px span target (ScenesView.jsx:1294), ~20px button target (BudgetView.jsx:2032), 12px bare-icon target (ScenesView.jsx:1478). — elsewhere: No shared Checkbox exists. — do: One Checkbox: 14px glyph in a 28px square target, everywhere.


## Alignment issues

- Custom tab, totals row against the BreakdownTable above it (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1667`): The totals row is a sibling of BreakdownTable, not a row in it: the table wraps its rows in p-3 and pads each row px-3, while the totals row uses px-2 outside that wrapper, so the six totals columns sit roughly 13px left of the six columns they total. → Move the totals row into the shared Table as a footer slot so it inherits the same grid, cell padding and right alignment as the body.

- BreakdownTable, all seven report tabs, header and every numeric cell (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:2848`): Task count, bid days, logged days and cost are all left-aligned, header included, so numbers of different lengths ragged-right against each other and cannot be compared down the column. → align="right" plus tabular figures on every numeric column, header included; only the name column stays left.

- Crew/Team and Talent, money column order versus the Topsheet and Expenses (`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:492`): Variance is printed to the left of the Actual it is derived from, and the same four concepts appear in four different orders across the Topsheet, Expenses, Breakdown and these two tables. → One order everywhere: Subtotal, Margin, Contingency, Bid, Actual, Variance. Swap the Variance and Actual cells in the header, member rows, department subtotals and grand total.

- Every variance cell, sign against the currency symbol (`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:587`): A positive renders as '+$1,234' (sign prepended by hand) and a negative as '-$1,234' (sign placed by Intl), so in a right-aligned column the sign glyph alternates position relative to the symbol. → Format with signDisplay:'exceptZero' inside CurrencyDisplay and delete the five hand-built sign prefixes.

- Budget versions table, header row against data rows (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:757`): Header is px-3 py-1.5, rows are px-2 py-2, so the column labels sit 4px right of their values and the header is 4px shorter than a row. → One cell padding of 8px 12px for head and body, from the shared Table.

- Topsheet rollup, indented category rows against the Category header (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:1080`): The Category header is flex-1 with no indent while indented DataRows add paddingLeft: 12, so an indented label starts 12px right of the header that names it and there is no visual connector between the two. → Indent the header by the same token, or better, express hierarchy with a 12px tree indent owned by the Row so header and rows share one left rail.

- Summary waterfall, amount column width (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:591`): width: 160, flexShrink: 0 is written four times across two components; nothing enforces the match, and the value is derived from 11.5px mono so it will be wrong after the type change. → One column-width declaration in the Table's column map, re-measured against 14px tabular figures.

- ScenesView toolbar, column headers and rows, three different left edges (`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:734`): The toolbar is px-4, the table wrapper is p-3 with rows at px-3, and the info bars are px-1, so the toolbar's left edge, the column header's left edge and the row's left edge are three different verticals in the same view. → One 24px page gutter owned by the shell; the table owns only cell padding.

- Budget tab strip, icon baseline against label (`src/tools/rabbit_v0.1.0/views/BudgetView.jsx:224`): A 12px icon sits beside a 10.5px uppercase label whose cap height is about 7.5px, so the icon overhangs the label's cap line top and bottom and the pair has no shared optical baseline. → Icons at 14px beside a 14px sentence-case label, or sized to cap height, with items-center on a fixed 28px control height.

- Crew/Team and Talent, fixed pixel column widths against the new type size (`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:40`): W_RATE 80, W_SUB 88, W_BID 96 and W_COL 72 were measured against 11.5px mono. At 13px tabular figures a value like $1,234,567 overflows W_SUB and W_BID, and totalW (line 406) drives the table's minWidth and therefore the horizontal scroll extent. → Re-measure every width constant against the new numeric face at its shipping size, do not scale them proportionally, and move them into the Table's column map.

- Crew/Team, department subtotal Actual against grand total Actual (`src/tools/rabbit_v0.1.0/views/budget/CrewTeamTab.jsx:647`): The department subtotal's Actual is #38bdf8 and the grand total's Actual directly below it is #d6d3d1, so the same semantic cell is two colours at two levels of one column. → One ink for the Actual column at every level; weight, not hue, distinguishes a subtotal from a row.

- Shot detail popup, third properties grid (`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:2939`): An empty <div /> is used as a spacer to hold the three-column grid open, so the Framing and Camera Movement pair is visually orphaned to the left with unexplained space beside it. → Span the remaining column with a grid-column rule, or move Camera Movement's long labels into a two-column block; never hold a grid open with an empty element.


## Hick's Law hotspots

- BudgetView tab strip (BudgetView.jsx:202-231): 13 visible choices → Seven tabs (By Phase, By Role, By Asset, By Scene, By Shot, By Level, By Experience) are one operation with a parameter, three (Crew/Team, Talent, Expenses) are separate data sets, one (Custom) is a configurator, one (Client View) is an output, one (Summary) is the home. Keep all thirteen as tabs and reachable; make the existing two dividers real hairlines with 24px either side and add three 11px Label-step group captions (Breakdowns / Entry / Output). That takes the effective decision from thirteen peers to three groups of one, seven and three without touching flow. If Audrey later wants a true reduction, the seven breakdowns collapse into Summary's existing group-by control, which is a flow change and out of scope here.

- ScenesView toolbar (ScenesView.jsx:734-936): 16 visible choices → Merge the thumbnail-size and gallery-size triples into one Size segmented control, since they are never visible at the same time and mean the same thing; that is a rename, not a removal. Move the FPS badge out of the interactive row into the page header as a readout. Put the two create buttons in a right slot separated by 24px so the destructive-adjacent cluster (filter, sort, group) reads as one group and the create pair as another. Net: 16 targets in one undifferentiated row becomes 13 in three labelled zones, all still one click away.

- ExpensesTab toolbar (BudgetView.jsx:2137-2221): 11 visible choices → Eleven controls plus three dividers, wrapping onto two rows at narrow widths. Group as: create (New expense), history (Undo, Redo), view (Filter, Sort field, Sort direction, Group, Views), maintenance (Reset M/C), find (Search, count). Adopt the 44px Toolbar with 28px children and 24px group gaps so the four groups are legible as groups; nothing is hidden. 'Reset M/C' is the only genuinely rare, destructive-adjacent control and is the one candidate for an overflow menu if she wants one.

- Shot row in ShotTable (ScenesView.jsx:1881-2102): 16 visible choices → Per row: checkbox, thumbnail picker, name, takes chips, status, time of day, type, framing, camera movement, description, frame count, start date, end date, view, delete. Six of these are selects with no rest-state affordance (see R3-26), which is what makes the row feel like sixteen hidden choices rather than sixteen visible ones. Give every editable cell a rest-state chrome so the count is honest, keep the columns as they are, and let the existing Saved Views feature carry any column reduction the user wants.

- Shot detail popup properties (ScenesView.jsx:2865-2971): 12 visible choices → Twelve fields in three unlabelled grid-cols-3 blocks, with read-only and editable fields styled identically. Add three 11px Label-step section eyebrows (Identity, Camera, Schedule) and give read-only fields a distinct inert treatment. Same fields, same order, three chunks of three to six instead of one field dump.

- Custom tab filters (BudgetView.jsx:1630-1657): 3 visible choices → Three selects, but the Group by select carries up to nine options and the Status filter eleven. This one is already well within limits; the only change needed is a fixed 28px control height and the shared Select chrome so the three read as one control group rather than three independently styled dropdowns.


## Type inventory

| px | uses | roles it is currently doing | collapses to |
|---|---|---|---|
| 7.5 | 1 | "from primary take" caption over a shot thumbnail (ScenesView:2850) | 11 Label |
| 8 | 2 | "Set thumbnail" hint in both detail popups (ScenesView:2409, 2847) | 11 Label |
| 8.5 | 7 | period column headers (CrewTeamTab:496, TalentTab:449), status pills (ScenesView:1701, 2214, 2641), talent detail labels (TalentTab:677), "Locked" badge (BudgetView:805) | 11 Label |
| 9.5 | 89 | table headers, field labels, group counts, bulk-select labels, popover labels | 11 Label |
| 10 | 3 | talent type select (TalentTab:478), FPS badge (ScenesView:844), retry button (ScenesView:975) | 11 Label / 13 Dense |
| 10.5 | 162 | table headers AND buttons AND tab labels AND body hints AND counts AND cell values | split three ways: 11 Label, 13 Dense, 14 Body |
| 11 | 3 | upload error (BudgetView:2732), talent detail values (TalentTab:681, 685) | 12 Caption |
| 11.5 | 149 | table cell values, body copy, inputs, secondary buttons, empty states | 13 Dense / 14 Body |
| 12 (text-xs) | 16 | waterfall row labels, selects, warning copy, footer info | 13 Dense / 14 Body |
| 12.5 | 27 | runtime and frame cells, grand total labels, table empty states | 13 Dense |
| 13.5 | 13 | Base cost label, PctInput, Client View heading, dialog titles | 16 H2 |
| 14 (text-sm / [14px]) | 10 | banner title, modal titles, scene and shot popup titles | 16 H2 |
| 16 (text-base) | 2 | Base cost amount, "Grand Total" label (BudgetView:591, 658) | 16 H2 and the GrandTotal treatment |
| 18 (text-lg) | 2 | ScenesView BigTile value (:1175), Client View project title (:181) | 20 H1 |
| 20 (text-xl) | 5 | tile values, version variance amount | 20 H1 |
| 24 (text-2xl) | 1 | Summary grand total amount (BudgetView:661) | keep: the one display number on the surface |

17 distinct sizes, 6 of them half-pixel and below the rendering threshold at 96dpi. Weights in use: 4 (default, font-medium, font-semibold, font-bold). Case: 223 uppercase occurrences against 191 tracking-wide/wider/widest occurrences, so effectively every label, header, button, tab, chip and status pill is the same typographic object. tabular-nums: 17 uses, all in ScenesView, none in any money table.


## Priority order

R3-01, R3-02, R3-03, R3-04, R3-07, R3-06, R3-10, R3-20, R3-15, R3-22, R3-11, R3-12, R3-13, R3-08, R3-09, R3-16, R3-26, R3-25, R3-05, R3-31, R3-19, R3-18, R3-38, R3-30, R3-21, R3-17, R3-14, R3-29, R3-36, R3-28, R3-32, R3-23, R3-24, R3-33, R3-27, R3-39, R3-34, R3-35, R3-37, R3-40


## Rework scope (reviewer's estimate)

Files: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\views\BudgetView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\views\budget\CrewTeamTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\views\budget\TalentTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\views\budget\ClientViewTab.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\components\CurrencyDisplay.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\src\tools\rabbit_v0.1.0\views\ScenesView.jsx`  
Approx lines: 8063  
Suggested sessions: 4  
Split: Session A, primitives and the money contract (touches all six files shallowly, roughly 600 lines changed). Consolidate the five money formatters into CurrencyDisplay with one locale, tabular figures, signDisplay and an inherited colour (R3-01, R3-02, R3-14, R3-34). Collapse the four summary tiles into StatTile (R3-10). Collapse the two status palettes into StatusBadge (R3-11). Split EmptyState from Loading and adopt in all eight places (R3-19). Right-align BreakdownTable and move the Custom totals row inside it (R3-03, R3-04). This session must land first because R3-02 is the regression the type change would otherwise cause silently. Session B, BudgetView.jsx (one 2,941-line file, roughly 1,200 lines changed). Type scale and hierarchy across Summary, versions, Topsheet and Expenses (R3-06, R3-07, R3-08, R3-09, R3-30), tab strip and active state (R3-16, R3-17, R3-18), gutters (R3-31), versions table into the shared Table (R3-28), selection language (R3-38), Expenses toolbar and the ShortcutBar (R3-15, Hick's hotspot 3). Session C, the two money tables plus the client document (CrewTeamTab 737, TalentTab 708, ClientViewTab 276, roughly 700 lines changed). Column order swap (R3-05, needs Audrey's ruling first), cool hues out (R3-12), divider to hairline (R3-21), the two grounds unified (R3-37), period-cell density (R3-33), the three duplicate popovers into one via binUi Dialog/Menu (R3-32), fixed pixel widths re-measured against the new numeric face, and the print template rebuilt from tokens (R3-27, R3-39). Session D, ScenesView.jsx alone (3,356 lines, 344 inline style objects, roughly 1,400 lines changed). Delete all 32 e.target.style mutations and give inline controls a rest-state chrome (R3-26), toolbar into the 44px Toolbar with the two size triples merged (R3-25), scene and shot tables into the shared Table, both galleries onto the shared card, the two detail popups chunked and read-only fields differentiated (R3-36), checkbox targets unified (R3-40), ink screens applied (R3-13). Do not attempt Session D in the same session as any other file.  
Risks: Scale: 8,063 lines across six files, two of which (BudgetView 2,941, ScenesView 3,356) each hold a dozen or more components and cannot be safely reviewed in one pass. State lives in inline styles: 900 style={{ }} objects across the surface (BudgetView 283, ScenesView 344, CrewTeamTab 125, TalentTab 115, ClientViewTab 33), and they encode selected, disabled, tone, status, zero-versus-nonzero and locked, so a class-based token swap cannot be done by find-and-replace and every ternary must be read. Direct DOM mutation: ScenesView writes e.target.style.borderColor in 32 places; an inline style always beats a CSS rule, so any hover treatment added without deleting these will appear not to apply and will look like a build problem rather than a code one. Fixed pixel column constants: CrewTeamTab lines 40-53 and TalentTab lines 50-65 were measured against 11.5px mono and feed totalW, which sets the table's minWidth and therefore the horizontal scroll extent; going to 13px tabular figures overflows W_SUB (88) and W_BID (96) for seven-figure amounts. Re-measure, do not scale. A second stylesheet: ClientViewTab lines 114-130 hold sixteen CSS rules inside a template literal that drives the printed client estimate; it will silently keep Courier New unless explicitly rebuilt, and it is the only artefact here that reaches a client. Thin safety net: no test on this surface pins a class name or a style; the only tests touching these paths are logic tests (budgetMath.test.js, entityNaming.test.js, columnAllowlist.test.js), so a visual regression will not fail CI and every change needs a human look. One decision blocks Session C: the Variance-before-Actual column swap (R3-05) is flagged touches-interaction and needs Audrey's ruling before the session starts, because reverting it afterwards means touching four row types in two files. Three findings are palette-decisions (R3-11, R3-12, R3-22 plus R3-17, R3-21, R3-37) and should ride the same ruling as the app-wide palette question rather than being decided here. No untouchable file is involved: the D.O.G. preview exclusion and the pet exclusion do not reach this surface, and the page transition is not touched.
