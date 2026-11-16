# Review — R.A.B.B.I.T. part 2 — Timeline (Gantt), its SummaryBand / minimap / detail toolbar / two panes, the four overlays it owns (TaskEditor, PhaseExtendModal, SettingsPanel, HelpModal) and the EditHistoryDrawer


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\TimelineView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\EditHistoryDrawer.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\Rabbit.jsx (context: strip stack above the view)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ViewTabs.jsx (context: tab idiom)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectContextBar.jsx (context: strip gutter)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (context: the shared kit that already exists)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (context: the ShortcutBar Audrey named)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\rabbitHelpContent.jsx (context: Help body type tokens, no legend)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\writeGate.test.js (context: rework risk)`


## Job

The Timeline exists to answer one question at a glance: where is this project in time, and what is late. Per sub-view: the SummaryBand's job is to state project scale (its one action is the minimap zoom); the OverviewPane's job is to orient and navigate (its one action is drag the frame); the DetailZoomToolbar's job is to change what the gantt shows (its one action is the zoom step); the DetailPane's job is to read and adjust schedule (its one action is drag a bar); TaskEditor's is to commit one record (Save); SettingsPanel's is to change how the timeline draws (the weekend toggle plus holidays); HelpModal's is to explain the gestures; EditHistoryDrawer's is to review and revert one change. The failure is that four of those sub-views have no dominant element at all — the SummaryBand carries eight peer statistics plus two buttons plus a slider at one type size, and the DetailZoomToolbar carries fifteen to eighteen peer controls in one 32px strip — so "the one action" is not expressed anywhere in the design.


## What works

- The gantt's structural idea is right and worth protecting: a locked week-or-larger navigator over a zoomable detail pane, with the frame as the only link between them, is exactly the Notion/Frame.io model and it is implemented coherently (TimelineView.jsx:1115-1124 derives the frame from calendar dates, not buffer pixels, so it survives independent pan and zoom).

- The containment rails are a genuinely good piece of information design. ContainmentOverlay (3013-3183) draws a shadow underlay at strokeWidth+2 before the 1.6px line (3132-3143) so the rail reads on any bar colour — that is the correct way to put a hairline over a busy field, and it is the only place on this surface where legibility was solved rather than assumed.

- The hover-off delay on DetailBar (3513-3519, 180ms) is a real interaction-design decision: the dependency grip sits 22px outside the bar's box, so an instant mouseleave would make it unreachable. Keep this verbatim.

- The read-only strip (692-701) and the dependency-failure strip (708-726) are the right pattern — a gesture has no control to grey out, so the reason is stated once at pane level. The reasoning in the comments is better than the rendering; the pattern should be promoted, not discarded.

- barTone (5757-5815) is a single function that owns every bar colour decision. It is the only token-shaped thing on the surface, and it means the bar palette can be collapsed in one place rather than hunted through 7,000 lines.

- buildAxisTicks' MIN_GAP suppression (6978, 7001-7007) stops stub labels colliding at week zoom. Small, correct, invisible when it works.


## Findings (42)

**TL-01 · HIGH · System** — Five segmented-control idioms with four different active treatments, three of them inside one 32px strip  
law: Law of Similarity

- Problem: The DetailZoomToolbar holds three mutually-exclusive selectors side by side and signals selection three different ways: the zoom chips use a solid #ea580c fill with white text (4864-4865); the group-by icons 8px away use colour only, #fb923c vs #57534e, no fill and no underline (4908); the sort pair uses colour only again but as text at a different size (4928, 4939). Above them ViewTabs uses fill PLUS a 2px bottom border (ViewTabs.jsx:55-59) and SettingsPanel's tabs use a full-width fill plus a border-bottom at 14px bold sans (5205-5209). One screen, five idioms, four active languages. This is Audrey's ecosystem complaint stated in code.

- Why it matters: Law of Similarity: three controls that look like three different kinds of thing but behave identically teach the user nothing transferable. The cost compounds because the same person then meets a fourth idiom one strip up and a fifth in the settings drawer.

- Change: Collapse all five onto one Tabs/Segmented component: 14px sentence case, weight 400 inactive and 600 active, one 2px signal underline, no fill anywhere in the content layer. Icon-only sets (group-by) become the same component with an icon plus a visible label, or a single labelled Select if the row runs out of width. The zoom chips lose the orange fill; the underline carries the state.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4864` — `color: zoomId === z.id ? '#fff7ed' : '#78716c', backgroundColor: zoomId === z.id ? '#ea580c' : 'transparent',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4908` — `color: groupBy === g.id ? '#fb923c' : '#57534e',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4928` — `color: sortOrder === 'asc' ? '#fb923c' : '#57534e',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5205` — `className={'flex-1 px-4 py-2 text-sm font-bold transition-colors border-b-2 ${`




**TL-02 · HIGH · Typography** — Task names — the most-read text in the tool — are 11.5px mono at 3.65:1, below the text floor, in a file that states the floor in a comment 86 lines earlier  
law: Selective Attention

- Problem: Every task label in the sticky left column is rendered #78716c on #1c1917. Measured that is 3.65:1, under the 4.5:1 floor for text. The file already knows this: the comment at 2364-2366 says stone-500 is "3.65:1 — a glyph, so the 3:1 floor applies" and stone-400 is used for the drop-zone LABEL "because 4.5:1 is the floor for text". Eighty-six lines later the actual task titles get the glyph colour. The result is that phase names (#fb923c) shout and the task names under them nearly disappear, which inverts the reading order of a gantt — you scan tasks, not phases.

- Why it matters: Selective Attention: the user's goal is a task, so the task row is the stimulus that must survive filtering. Right now it is the faintest text on the pane.

- Change: Task label goes to the 100% ink (#f5f0ec or existing #d6d3d1) at the 13px Dense step, weight 400, sentence case. Phase label goes to the same ink at 13px weight 600. The phase/task distinction is carried by weight and the 2px signal left border already present at 2404, not by hue. This also fixes the measure: 13px sans holds roughly 30 percent more characters in the fixed 240px LABEL_W than 11.5px mono.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2452` — `style={{ color: r.kind === 'phase' ? '#fb923c' : '#78716c' }}`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2447` — `className={'text-[11.5px] font-mono truncate ${`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2365` — `applies); the LABEL is stone-400 (6.8:1) because 4.5:1 is the floor for text. Both are existing palette values.`




**TL-03 · HIGH · Hierarchy** — A gantt row is drawn as two unrelated halves: the label column has no fill and an invisible divider, the chart half has a filled band and a dashed border  
law: Law of Uniform Connectedness

- Problem: For a phase row the label half is transparent with a 1px #292524 bottom border (2399-2400) and a 2px #fb923c left border (2404); the chart half of the same row is a filled rgba(68,64,60,0.55) band with a 1px #1c1917 border (2783-2787). For a drop-zone row the label half has borderBottom '1px solid transparent' (2332) and the chart half has '1px dashed #44403c' (2718). The two halves are separated by a borderRight of #292524 on #1c1917, which measures 1.15:1 — effectively invisible. So the single most important visual claim a gantt makes, "this label belongs to this bar", is made by nothing. Hover makes it worse: the label half lights up with hover:bg-stone-800/50 (2396) and the chart half has no hover state at all, so pointing at a row highlights the left 240px and stops.

- Why it matters: Law of Uniform Connectedness and Common Region: a row is a region, and this one is two regions with a seam down the middle. It is the specific defect behind "make sure alignment in rows and items all make sense".

- Change: One Row component spans both halves. One 36px height, one hairline divider at the rule token, one hover fill applied to the whole row via a shared row-hover state (the pane already tracks dropZoneHover and reparentHoverPhaseId, so the plumbing exists), one selected fill plus a 2px signal left border. Delete the phase-row chart fill entirely — the phase is already distinguished by weight, by the left border, and by its bar.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2278` — `borderRight: '1px solid #292524',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2786` — `? (r.isSubgroup ? 'rgba(51, 48, 45, 0.45)' : 'rgba(68, 64, 60, 0.55)') : 'transparent',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2396` — `className={'relative flex items-center hover:bg-stone-800/50 transition-colors ${isTaskRow && canWrite ? ...`




**TL-04 · HIGH · System** — Nine type sizes for six roles; 10.5px alone plays button, body copy, field label and dialog title

- Problem: This surface uses 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 14 and an unclassed inherited 16px. Five of those are half-pixel steps below the rendering threshold. text-[10.5px] appears 52 times and is simultaneously the button label (4634, 4657, 4954, 4977), the field label (4684), the dialog title (3898, 4156), and multi-line body copy in the settings drawer (5262-5265). Meanwhile the two largest elements on the whole surface — the SettingsPanel and HelpModal headers — carry NO size class at all (5194, 5463) and render at the browser default 16px by accident. A scale where the biggest step is an accident and one step does four jobs is not a scale.

- Why it matters: Pass 4 of the framework: correcting the scale resolves most of the hierarchy findings below at once, so it outranks every individual fix.

- Change: Map onto the eight-step system scale: axis ticks and field labels to Label 11px; table cells, row labels, bar labels, list rows to Dense 13px; body copy, inputs, help prose to Body 14px; dialog and section titles to H2 16px; there is nothing on this surface that needs H1. Delete 9.5, 10, 10.5, 11.5 and 12.5 outright. Give the two accidental 16px headers an explicit step so they stop depending on a UA default.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5194` — `<span className="font-bold text-orange-400 uppercase tracking-wide">RABBIT Settings</span>`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4684` — `<label className="block text-[10.5px] font-mono uppercase tracking-widest mb-1" style={{ color: '#a8a29e' }}>`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5262` — `<p className="text-[10.5px] text-stone-500 mt-1">`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:93` — `<div className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>`




**TL-05 · HIGH · Colour** — 43 distinct hex values in one file, 19 bar-state palettes, and no legend anywhere that says what a colour means  
**constraint: palette-decision** · law: Working Memory

- Problem: barTone (5757-5815) defines four subgroup palettes, four phase palettes and ten task-status palettes, each a bg/border/fg triple. Add two dependency colours (5.orange task, cyan phase, 3207-3208), a red today line (2595), a user-chosen milestone colour from a free colour picker (4216), a weekend tint, and the containment rail — and the gantt encodes roughly 20 states in colour with no key. Nothing on the surface explains any of it; rabbitHelpContent.jsx has no legend page, only prose about the critical path. The user is asked to memorise a 20-value code.

- Why it matters: Working Memory: a 20-value colour code that exists only in the renderer forces recall instead of recognition. Von Restorff also collapses — when nine bar states are all warm and saturated, none of them isolates.

- Change: Two moves. (a) Collapse barTone onto the semantic tokens: one signal for active/in-progress, one success, one warning, one danger, plus ink-at-48-percent for everything inert; status detail moves from hue to a StatusBadge rendered inside or beside the bar. (b) Add a legend. It fits in the space the SummaryBand wastes (see TL-07) as a single inline row of dot+label pairs at the 11px Label step, or as a hover-revealed key on a single icon at the right of the toolbar. A gantt without a legend is a chart without axis labels.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5790` — `switch (status) {   case 'in_progress':     if (critical) return { bg: '#9a3412', border: '#fb923c', fg: '#fff7ed' }`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3207` — `const TASK_COLOR  = '#fb923c' const PHASE_COLOR = '#22d3ee'`<br>`src/tools/rabbit_v0.1.0/rabbitHelpContent.jsx:7` — `export const RABBIT_HELP_SIDEBAR_ITEMS = [ ... 11 items, none of which is a legend ]`




**TL-06 · HIGH · Flow** — Two identically-styled buttons both labelled "Today" with the same icon, 40px apart, doing different things  
law: Law of Similarity

- Problem: SummaryBand renders a Crosshair + "Today" at 10.5px mono uppercase tracking-wider that centres the MINIMAP (5631-5640). DetailZoomToolbar renders a Crosshair + "Today" at 10.5px mono uppercase tracking-wider that centres the DETAIL PANE (4876-4885). Same glyph, same word, same type, same case, same tracking, stacked one strip apart with the minimap between them. The only difference is a tooltip. There is no way to know which one you want without clicking and observing.

- Why it matters: Law of Similarity is doing active harm here: two things that look identical are guaranteed to be read as the same control.

- Change: Keep both actions, kill the collision. The minimap's control belongs on the minimap, not in the stats band — move Fit and Today into the OverviewPane's own top-right corner where they are inside the region they act on (Law of Common Region), and label them "Fit project" and "Centre today". The detail toolbar keeps "Today" alone. Nothing about what the controls do changes.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4881` — `title="Center the detail timeline on today" <Crosshair className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase tracking-wider">Today</span>`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5634` — `title="Center minimap on today" <Crosshair className="w-3 h-3" /> Today`




**TL-07 · HIGH · Hierarchy** — SummaryBand: eight peer statistics at one size, value and label the same size, numbers not in a column, one icon used for three different metrics  
law: Von Restorff Effect

- Problem: SummaryTile renders icon, value and label all at text-[11.5px] font-mono, differentiated only by colour (#fb923c value, #d6d3d1 label). Eight tiles sit in a wrapping flex row, so each number floats at an x position set by the width of the tile before it — nothing is scannable as a column. CalendarDays is the band's title icon (5598) AND the "Span" icon (5609) AND the "Critical days" icon (5611): one glyph, three meanings, in one row. Units are inconsistent — "305 d", "212 d", "18.0 d" — because criticalDays alone gets toFixed(1) (5611). tabular-nums appears exactly once in the whole file, on the zoom label (5702), and never on the eight actual numbers.

- Why it matters: The critique framework's hierarchy test: squint at this band and nothing resolves first. Hierarchy is being attempted with colour alone, which is exactly the failure mode that collapses when the palette is corrected.

- Change: Rebuild as a stat row with internal hierarchy: value at 16px weight 600 with tabular-nums, label beneath at the 11px Label step, fixed tile width so the values form a column, one hairline separator between tiles instead of the current nothing. Give Span and Critical days distinct icons or drop icons from the tiles entirely and let the number lead. Normalise the unit formatting in buildSummary (7055-7073) so all three day figures render the same way. Demote "Critical days" and "Working" behind the primary five if the row still crowds.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5719` — `<Icon className="w-3 h-3" style={{ color: colors.icon }} /> <span className="text-[11.5px] font-mono font-medium" style={{ color: colors.value }}>{value}</span>`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5609` — `<SummaryTile icon={CalendarDays}  label="Span"          value={'${summary.spanDays} d'} /> <SummaryTile icon={Briefcase}     label="Working"       value={'${sum`




**TL-08 · HIGH · Hierarchy** — DetailZoomToolbar: 15 to 18 controls in one strip, six of them icon-only, and the two create actions are drawn at opposite ends of the emphasis range  
law: Hick's Law

- Problem: In one 32px row the user meets undo, redo, four zoom chips, Today, three to six group-by icons, two sort buttons, and three create buttons — 15 controls minimum, 18 on a project with scenes, levels and experiences enabled. Six to nine of them are unlabelled icons. Worse, the three create actions are peers in the data model but siblings in nothing else: "+ Phase" is #78716c text on transparent (3.65:1, 4955), "Key Date" is #f59e0b text on transparent (4967), "+ Task" is white on a solid #ea580c fill (4978). Three ways to create a thing, three visual weights, and the weakest of them is also below the contrast floor.

- Why it matters: Hick's Law directly: decision time rises with the log of the option count, and unlabelled icons raise the per-option cost as well as the count.

- Change: One primary only: "New task" as the single filled Button at md 36px. Phase and Key Date become secondary Buttons in the same 28px row, or better, collapse into a single "New" Menu with three items — which keeps every control reachable and drops the visible choice count. Undo/redo move out of this strip entirely: they are global (they already bind Ctrl+Z at window level, 294-312) and belong in a ShortcutBar, not competing with zoom. Group-by becomes one labelled control showing its current value rather than three-to-six unlabelled icons.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4955` — `style={{ color: '#78716c' }} <Plus className="w-3 h-3" /> Phase`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4977` — `className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors" style={{ color: '#fff7ed', backg`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4892` — `{ id: 'phase',      icon: Layers,   title: 'Group by phase' }, { id: 'team',       icon: Users,    title: 'Group by team member' },`




**TL-09 · HIGH · Typography** — The date axis — the one thing that makes a gantt readable — is 9.5px at 2.29:1

- Problem: Detail axis minor labels are #57534e on #1c1917, measured 2.29:1, at text-[9.5px] (2497-2498). The minimap's minor ticks are the same colour at the same size (1173). Major labels are #78716c, 3.65:1 (2498). The column header "Phase / Task" is #57534e at 9.5px too (2289). Under the 44px HEADER_PX these sit in a header that is 4.6 times taller than the type it contains. On a 96dpi Windows panel at 100 percent, 9.5px system mono at 2.29:1 is not readable text — it is texture. A user cannot tell what week a bar is in without zooming the OS.

- Why it matters: Accessibility is structural, not a pass at the end. This is the axis of a chart; if it is unreadable the chart is decorative.

- Change: Axis labels to the 11px Label step at the ink's 72 percent screen (that is the floor; nothing smaller ships). Minor ticks differ from major by weight and by tick-line strength, not by dropping to 2.29:1. Drop HEADER_PX from 44 to 32, which returns 12px to the chart on every project and lets the two label tiers sit on a real baseline rather than floating.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2496` — `className="text-[9.5px] font-mono whitespace-nowrap" style={{ color: tick.major ? '#78716c' : '#57534e', marginBottom: 4 }}`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2289` — `<span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#57534e' }}>   Phase / Task`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1173` — `<span className="text-[9.5px] font-mono whitespace-nowrap" style={{ color: tick.major ? '#a8a29e' : '#57534e' }}>`




**TL-10 · HIGH · Alignment** — Eight stacked strips, five different left edges, and the column header aligns with nothing in its own column  
law: Law of Proximity

- Problem: Reading down the window: ViewTabs is px-2 (8px), ProjectContextBar px-6 (24px), the read-only and depError banners px-3 (12px, 694/710), SummaryBand px-6 (5594), the OverviewPane's content starts at 0, DetailZoomToolbar px-6 (4821), the label column's header px-3 (2282, 12px), depth-0 phase rows at paddingLeft 6+0+20 = 26px (2406), and drop-zone rows at 8+depth*14+20, which is 28px at depth 0 and 42px at depth 1 versus 40px for a task row at the same depth (2336 vs 2406). So the "Phase / Task" header sits 14px left of the phase names it heads, and a "New task…" row sits 2px right of the task rows above it — plus another 18px once its Plus icon is counted, putting its text 20px out of line with the task titles it is appended to.

- Why it matters: Direct answer to "make sure things look clean from placement and orientation and alignment". A single shared gutter is the cheapest change on this list and it is visible on every screen.

- Change: One page gutter of 24px for every horizontal strip including both banners. Inside the label column, one indent unit of 16px and one base inset, applied identically to phase, task and drop-zone rows so depth N always lands on the same x. The header label sits on that same inset. Set the icon slot to a fixed 20px reserved width so an icon's presence never shifts the text after it.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2336` — `paddingLeft: 8 + depth * INDENT_UNIT + 20,`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2406` — `paddingLeft: (6 + depth * INDENT_UNIT + 20),`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2282` — `className="flex items-end px-3 pb-2 sticky top-0 z-10"`




**TL-11 · HIGH · System** — Five overlays on one surface: five backdrops, four surface colours, four border treatments, four dialog-title sizes

- Problem: TaskEditor: backdrop rgba(28,25,23,0.75), surface #292524, 1px #44403c, title 10.5px (4138, 4144, 4156). PhaseExtendModal: backdrop rgba(28,25,23,0.78), surface #292524, 1px #fb923c, title 10.5px (3884, 3891, 3898). SettingsPanel: backdrop bg-black/50, surface bg-stone-800, border-l-2 border-stone-600, title unclassed 16px (5180-5194). HelpModal: backdrop bg-black/70, surface bg-stone-800, border-2 border-stone-600, title unclassed 16px (5455-5463). EditHistoryDrawer: backdrop rgba(0,0,0,0.6), surface #1c1917, borderLeft 2px #ea580c, title 12.5px, plus a 0 0 60px shadow (EditHistoryDrawer.jsx:83-93). Five renderings of one contract.

- Why it matters: Pass 4: this is the highest-leverage structural fix on the surface because it removes five maintenance sites and makes the next dialog free.

- Change: Promote binUi's Modal to src/ui/Dialog and a matching src/ui/Drawer, then port all five. One backdrop rgba(12,10,9,0.6), one raised surface, one 1px rule, one 8px radius, one floating shadow, one header/body/footer contract with the title at the 16px H2 step in sentence case. The Bins tab already proves this works inside RABBIT; this surface should not be inventing a sixth.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3884` — `style={{ backgroundColor: 'rgba(28, 25, 23, 0.78)' }}`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4138` — `style={{ backgroundColor: 'rgba(28, 25, 23, 0.75)' }}`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:85` — `style={{ width: 420, backgroundColor: '#1c1917', borderLeft: '2px solid #ea580c', boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}`




**TL-12 · MEDIUM · Colour** — The one primary button is white-ish on #ea580c at 3.35:1, below the floor, and Audrey's own colour rule says the ink should be black  
**constraint: palette-decision**

- Problem: "+ Task" (4978), "Save" (4658), "Extend phase" (3925), "Add" holiday (5073) and "Manage Task Templates" (5295) all render #fff7ed on #ea580c. Measured that is 3.35:1 — worse than pure white's documented 3.56:1 — at 10.5px bold uppercase, which is small text and needs 4.5:1. The documented rule table puts #1c1917 on #ea580c at 4.66:1 and passing. Every filled orange button in this surface fails its own spec.

- Why it matters: Audrey's standing colour rule, applied to the orange that appears in the content layer rather than the frame.

- Change: Ink on the filled signal button becomes #1c1917 at the 14px step, weight 600, sentence case. That satisfies white-or-black-on-orange, clears 4.5:1, and stops the button reading as a glowing chip. Extend authContrast.test.js's pattern to assert the button token so it cannot regress.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4978` — `style={{ color: '#fff7ed', backgroundColor: '#ea580c' }}`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4658` — `style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}`




**TL-13 · MEDIUM · Colour** — Nine content-layer elements fill with #ea580c, so the tool's content borrows the shell's frame colour  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: The frame around every WILSON page is #ea580c. Inside the Timeline, #ea580c is also the active zoom chip (4865), the +Task fill (4978), Save (4658), Extend phase (3925), the two off-frame minimap arrows (1369, 1392), the Add-holiday button (5073), Manage Task Templates (5295), and the project-type checkbox fill (5337) — plus six rgba(234,88,12,…) washes for drag previews and hovers (2057, 2335, 2721, 2745, 2877, 2911). The identity colour is doing nine jobs, which means it identifies nothing.

- Why it matters: Von Restorff: an isolation colour used nine times in one view isolates nothing. It also fights the shell, which is where that colour is supposed to live.

- Change: Signal keeps exactly four jobs on this surface: the frame, the one primary action, the one active state, the one selection. Off-frame arrows become a ghost IconButton at the ink, not an orange chip. The checkbox fill and the drag washes move to a screen of the ink. The active zoom chip loses its fill entirely per TL-01.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1369` — `color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5337` — `backgroundColor: tpl[field] ? '#ea580c' : 'transparent', border: '1px solid ${tpl[field] ? '#ea580c' : '#57534e'}',`




**TL-14 · MEDIUM · Colour** — Cyan and fuchsia in the chrome, and one bar state drawn in zinc while everything else is stone  
**constraint: palette-decision**

- Problem: Phase-to-phase dependency arrows are #22d3ee cyan (3208, 3840) with a matching #ecfeff gradient stop (3327). The needs_revisions task bar is #4a1942 / #e879f9 / #fae8ff — a purple-magenta family (5797). The completed-phase bar is #27272a / #52525b / #a1a1aa (5781), which is Tailwind zinc, not stone: a cool neutral ramp used for exactly one state in a warm-neutral app. The documented composition rule is "Warm over cool. No blues, no cyans."

- Why it matters: The documented rule exists; this surface is the biggest violator of it. The zinc drift is the kind of thing nobody finds by eye and everybody feels.

- Change: Phase dependencies differ from task dependencies by line weight and dash pattern, not hue — both use the ink at 72 percent with the arrowhead carrying the distinction. needs_revisions becomes the warning token. The completed-phase palette moves onto the stone ramp so it stops reading fractionally blue next to its neighbours.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3208` — `const PHASE_COLOR = '#22d3ee'`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5781` — `if (phaseStatus === 'completed') return { bg: '#27272a', border: '#52525b', fg: '#a1a1aa' }`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5797` — `case 'needs_revisions':   return { bg: '#4a1942', border: '#e879f9', fg: '#fae8ff' }`




**TL-15 · MEDIUM · Colour** — The dividing rules have their hierarchy backwards: the chart's spine is the faintest line on screen  
law: Law of Prägnanz

- Problem: #292524 on #1c1917 measures 1.15:1 and #44403c measures 1.70:1. The label-column/chart divider — the structural spine of the whole gantt — is #292524 at full opacity (2278), as are the axis header border (2468), the SummaryBand and toolbar borders (5595, 4822) and the toolbar separators (4854, 4874, 4887, 4919). Meanwhile the decorative weekly grid line inside the chart is #44403c (2581) and major boundaries are #57534e (2551). So the ornament is brighter than the structure.

- Why it matters: Prägnanz: the eye reads the strongest lines as the structure. Right now they describe the wrong structure.

- Change: One rule token, rgba(245,240,236,0.14), for every structural hairline: strip borders, the column spine, the axis underline, row dividers. Grid lines inside the chart drop to half that. The spine gets the rule token at full strength and nothing else on the surface is allowed to be brighter than it.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2278` — `borderRight: '1px solid #292524',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2581` — `backgroundColor: isWeek ? '#44403c' : '#292524', opacity: 0.4,`




**TL-16 · MEDIUM · Density** — Five horizontal strips consume roughly 400px before the first task row, on a page whose bottom bar is 8px

- Problem: TitleBar 32 + orange top bar 95 (pageBars: rabbit 95/8) + ViewTabs ~34 + ProjectContextBar ~32 + banners 0-26 + SummaryBand ~32 + OverviewPane 160 (line 111) + DetailZoomToolbar ~32 = 417px of chrome. On a 900px window the actual gantt gets under 450px, which at the week-zoom row height of 34px is 13 rows. The OverviewPane alone is 160px of fixed height for what is, in the phase grouping, a list of at most five visible bars.

- Why it matters: Density is correct; emptiness is not. A 44px header holding 9.5px type and a 160px navigator holding five 22px bars are both emptiness.

- Change: OVERVIEW_HEIGHT drops from 160 to 120 and OVERVIEW_HEADER from 24 to 20. HEADER_PX drops from 44 to 32 (TL-09). Fold the minimap's Fit/Today/zoom controls into the OverviewPane's own header (TL-06), deleting the right half of the SummaryBand and letting that band shrink to a 32px stat row. Net return to the chart: roughly 70px, about two extra rows at week zoom, with no control removed.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:109` — `const DEFAULT_ROW_PX  = 30 const HEADER_PX        = 44 const LABEL_W          = 240 const OVERVIEW_HEIGHT  = 160`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1188` — `height: OVERVIEW_HEIGHT - OVERVIEW_HEADER - OVERVIEW_SCROLLBAR_H - 2,`




**TL-17 · MEDIUM · Density** — The minimap silently truncates after the sixth phase, with no scroll, count or indicator  
**constraint: touches-preview**

- Problem: The minimap body is OVERVIEW_HEIGHT − OVERVIEW_HEADER − OVERVIEW_SCROLLBAR_H − 2 = 124px with overflow hidden (1188-1191). Phase rows are OVERVIEW_PHASE_ROW_PX = 22 (1115) and buildOverviewRows emits one row per phase with no cap (6876-6890). 124 ÷ 22 = 5.6, so from the sixth phase down the navigator stops showing the project. Nothing indicates this: no scrollbar, no "+4 more", no count.

- Why it matters: A navigator that hides part of what it navigates is worse than no navigator. This is a layout defect with a functional consequence, which is why it outranks pure polish.

- Change: Either make the minimap's row height adaptive to fit N phases in the available 124px with a floor of 8px, or cap at five and render a count chip in the header. The second is cheaper and more honest. Whichever is chosen, the pane must never present a partial project as a whole one.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1188` — `height: OVERVIEW_HEIGHT - OVERVIEW_HEADER - OVERVIEW_SCROLLBAR_H - 2, cursor: isPanning ? 'grabbing' : 'grab', overflow: 'hidden',`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1130` — `const h = r.kind === 'phase' ? OVERVIEW_PHASE_ROW_PX : OVERVIEW_TASK_ROW_PX`




**TL-18 · MEDIUM · Hierarchy** — The minimap frame — the most important object on the navigator — is a 1px 50-percent line at 2.88:1 that the bars render on top of  
**constraint: touches-preview** · law: Von Restorff Effect

- Problem: The visible-window frame is border 1px rgba(251,146,60,0.5) with a 6 percent fill (1322-1323), which composites to about 2.88:1 against #1c1917 — under the 3:1 floor for a UI component. Its zIndex is 5 while every OverviewBar sits at zIndex 6 (1817), so wherever there is a bar the frame's edge and fill are occluded. The comment above it still describes a "2px orange border" and reserves a 1px gutter to protect it (1316-1319); the border was reduced to 1px and the comment was not updated, so the compensation now protects nothing.

- Why it matters: The navigator has exactly one job and one dominant element, and that element is currently the weakest mark on the pane.

- Change: The frame becomes the one element on the minimap drawn at full signal: a 1px signal border top and bottom is not enough, so use two 2px signal edges left and right with a 10 percent fill between, at a zIndex above the bars but with pointer-events confined to the edges so bar hit-testing is unchanged. Delete the stale comment and the now-pointless 1px gutter.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1322` — `border: '1px solid rgba(251, 146, 60, 0.5)', backgroundColor: 'rgba(251, 146, 60, 0.06)', borderRadius: 2, zIndex: 5,`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1813` — `// Lift bars above the visible-window frame (zIndex 5) so // hover/click still hit the bar even when it sits inside zIndex: 6,`




**TL-19 · MEDIUM · Motion** — Every dependency arrow runs three nested SVG circles on an infinite 2.2s animateMotion with a Gaussian blur, forever, with no reduced-motion fallback anywhere on the surface  
**constraint: touches-interaction** · law: Flow

- Problem: For each visible dependency the overlay renders an r=7 blurred bloom, an r=4 gradient dot and an r=1.3 white core, each with animateMotion dur=2.2s repeatCount=indefinite plus an opacity keyframe (3413-3449). On a project with thirty dependencies that is ninety perpetually animating nodes, one of them through an feGaussianBlur filter. The stated reason is "a sense of flow direction", but direction is already carried by the arrowhead marker. There is no prefers-reduced-motion handling in either file.

- Why it matters: Pass 8: a move needs causality, attention or a state change. An indefinite loop that runs whether or not anything happened is motion proving it exists. Glow and bloom are also on the default banned list.

- Change: Cut the pulse to a single r=3 dot with no blur and no gradient, and run it only on hover of the arrow or of either endpoint bar — then it shows causality, which is a real reason. Delete the radialGradients and the blur filter. Add a reduced-motion guard that removes the animation entirely rather than slowing it.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3416` — `<circle r={7} fill={glowId} filter="url(#rabbit-pulse-blur)">   <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3332` — `<filter id="rabbit-pulse-blur" x="-200%" y="-200%" width="500%" height="500%">   <feGaussianBlur stdDeviation="1.6" />`




**TL-20 · MEDIUM · Motion** — Seven shadow treatments including an inset white bevel, in an app whose own spec says it does not use drop shadows

- Problem: Minimap phase bars carry '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)' (1809-1811) — a drop shadow plus a top-edge white highlight, which is a bevel. Detail phase bars carry '0 0 0 1px rgba(0,0,0,0.4)' (3785). The dependency grip carries the same (3844). Milestone diamonds glow at '0 0 3px' and '0 0 4px' with a hex-alpha suffix (1243, 2640). Hover popup and reparent ghost use shadow-lg (1407, 2963). SettingsPanel and HelpModal use shadow-2xl (5182, 5457). EditHistoryDrawer uses '0 0 60px rgba(0,0,0,0.5)' (EditHistoryDrawer.jsx:85). Seven languages; the spec says there should be none.

- Why it matters: The inset white highlight is the single most dated pixel on the surface. It is the 2003 control-panel move, and it is on the element the user looks at first.

- Change: One elevation token, 0 8px 24px rgba(0,0,0,0.35), applied only to floating surfaces: Dialog, Menu, Drawer, the hover popup and the drag ghost. Delete every bar shadow, the inset bevel, and both diamond glows — bars and diamonds are docked elements and get a hairline instead.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1809` — `boxShadow: isPhase   ? '0 1px 3px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)'   : undefined,`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2640` — `boxShadow: '0 0 4px ${msColor}66',`




**TL-21 · MEDIUM · Hierarchy** — Bar type is 10.5px mono, and phase bars additionally take bold + uppercase + tracking, inside a bar that can be 46px tall  
**constraint: touches-interaction**

- Problem: DetailBar's label is text-[10.5px] font-mono truncate, and when phaseStyle it also gets font-bold uppercase tracking-wider (3798-3800). At day zoom ROW_PX is 56 (102) so a task bar is rowPx−10 = 46px tall carrying one line of 10.5px type — a 4.4:1 box-to-type ratio. The bar is also hidden entirely below 32px width (3796), so short tasks are unlabelled with no fallback.

- Why it matters: Bold plus uppercase plus tracking at 10.5px is the exact combination the system review names as reading like a control panel, and it is applied to the object the eye lands on first.

- Change: Bar label to the 13px Dense step, sentence case, weight 400 for tasks and 600 for phases; drop uppercase and tracking from the bar entirely. Cap bar height at 24px and vertically centre it in the row, so the day-zoom cell keeps its width for the day number without inflating the bar. Below 32px, render the label to the right of the bar rather than dropping it.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3798` — `className={'text-[10.5px] font-mono truncate pointer-events-none overflow-hidden ${   subgroupStyle ? 'font-semibold' : (phaseStyle ? 'font-bold uppercase track`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3782` — `height: subgroupStyle ? rowPx - 8 : (phaseStyle ? rowPx - 6 : rowPx - 10),`




**TL-22 · MEDIUM · Flow** — The empty state is written twice, in two colours, two styles, and it names a button that does not exist by that name  
law: Paradox of the Active User

- Problem: When rows is empty the label column renders "No phases yet — click + Phase" at fontSize 11 monospace #78716c in an 80px box (2293-2304) and the chart simultaneously renders "Click + Phase or drag on the overview above to draw a task" at fontSize 11 monospace italic #57534e absolutely positioned over the whole body (2649-2662). Two messages, two contrasts (3.65:1 and 2.29:1), one italic, neither aligned to the other, both referring to a control the toolbar actually labels "Phase" with a Plus icon (4958). There is also no loading state at all: !project falls through to "No project loaded" (664-672), an empty state doing a loading state's job.

- Why it matters: Paradox of the Active User: people do not read instructions, they click. An empty state whose only affordance is a sentence pointing at a 3.65:1 button elsewhere is an instruction manual.

- Change: One EmptyState component spanning the full pane: 24px icon, a 14px sentence-case title ("No phases yet"), a 13px body line, and an actual primary Button that opens the phase editor — not prose describing where the button is. Copy matches the control's real label. Add a separate Loading component with skeleton rows so "still fetching" and "genuinely empty" stop looking identical.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2300` — `fontSize: 11, fontFamily: 'monospace', }}> {canWrite ? 'No phases yet — click + Phase' : 'No phases yet'}`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2652` — `style={{ color: '#57534e', fontSize: 11, fontFamily: 'monospace', fontStyle: 'italic' }}`




**TL-23 · MEDIUM · System** — Four error renderings for one semantic, at three sizes and two backgrounds  
law: Law of Similarity

- Problem: The dependency-failure strip is text-[10.5px] #fca5a5 on #1c1917 with a #7f1d1d bottom border (710-712). TaskEditor's error is text-[11.5px] #fca5a5 on #1c1917 with a full 1px #7f1d1d box (4616-4617). EditHistoryDrawer's load error is text-[11.5px] on rgba(153,27,27,0.15) (119-120) and its revert error is text-[11px] on the same (134-135). Four treatments, three sizes, two grounds. Nine distinct reds appear across the file including #ef4444, #fca5a5, #7f1d1d, #b91c1c-adjacent washes.

- Why it matters: Law of Similarity applied to state: a user should learn what an error looks like once.

- Change: One danger token and one inline-error component: 13px, danger ink, a 12 percent danger wash, one 1px danger rule, one 4px radius. Pane-level failures use the Banner variant, dialog-level failures use the in-footer variant from the promoted Dialog contract. Keep the dismiss affordance and the tooltip-carries-the-raw-detail behaviour exactly as they are; that part is right.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:710` — `className="flex items-center gap-2 px-3 py-1.5 text-[10.5px] font-mono" style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #7f1d1d', color: '#fca5a5'`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:134` — `<div className="text-[11px] font-mono px-3 py-2 rounded"   style={{ color: '#fca5a5', backgroundColor: 'rgba(153,27,27,0.15)', border: '1px solid #7f1d1d' }}>`




**TL-24 · MEDIUM · Build** — The SettingsPanel hand-compensates for the 32px TitleBar and the EditHistoryDrawer does not, so one right-hand drawer slides under it

- Problem: SettingsPanel sets paddingTop: window.electronAPI ? '32px' : '0px' (5186). EditHistoryDrawer is fixed top-0 right-0 bottom-0 with no such compensation (EditHistoryDrawer.jsx:84), so in the packaged app its header sits beneath the custom title bar. Two drawers, same edge, same session, one aware of the shell and one not. The widths differ too — 40 percent with a 420px floor versus a flat 420px — as do the accent borders (stone-600 versus #ea580c).

- Why it matters: This is a shipped visual defect, not a preference. It is also the exact shape of the "one component, two implementations" problem the rest of this review is about.

- Change: One Drawer component owns the shell inset once, reading it from a layout constant rather than sniffing window.electronAPI. One width token (this surface wants 420). One hairline, no accent border. Port both.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5186` — `paddingTop: typeof window !== 'undefined' && window.electronAPI ? '32px' : '0px',`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:84` — `<div className="fixed top-0 right-0 bottom-0 z-[70] flex flex-col"   style={{ width: 420, backgroundColor: '#1c1917', borderLeft: '2px solid #ea580c', ... }}`




**TL-25 · MEDIUM · Colour** — The lock toggle's knob is stone-500 on an orange track: 1.71:1 in the ON state, and the sibling toggle right below it uses a different knob colour

- Problem: The prompts/tools lock toggle sets the track to bg-orange-500 when unlocked but leaves the knob bg-stone-500 in both states (5244-5248). #78716c on #f97316 measures 1.71:1 — the state indicator is effectively invisible in the state it is meant to indicate. Sixteen lines later the Show-weekends toggle, the same component by eye, uses bg-stone-200 for its knob (5272). Same control, two knob colours, one of them broken.

- Why it matters: Audrey's grey-on-orange rule, in its component form. The measurement is the same argument that produced the rule for text.

- Change: One Toggle component. Knob is #1c1917 on the signal track and the raised surface on the inert track, per the white-or-black-on-orange rule applied to components. Both call sites use it. Also drop rounded-full from the track — the documented composition rule is that WILSON avoids pill radii, and these two are the only pills on the surface.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5244` — `className={'relative w-11 h-6 rounded-full transition-colors ${isLocked ? 'bg-stone-600' : 'bg-orange-500'}'} <span className={'absolute top-1 w-4 h-4 bg-stone-`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5272` — `className={'absolute top-1 w-4 h-4 bg-stone-200 rounded-full transition-transform ${settings.showWeekends ? 'left-6' : 'left-1'}'}`




**TL-26 · MEDIUM · Typography** — Settings body copy runs 10.5px across roughly 115 characters; help body runs 12px across roughly 100

- Problem: SettingsPanel is width 40 percent with a 420px floor and p-4 content padding, so on a 1600px window the text column is about 600px. The descriptive paragraphs inside it are text-[10.5px] (5262, 5279, 5288, 5305) — roughly 115 characters per line. The HelpModal is 850px wide minus a 208px sidebar and p-5, about 560px of text at 12px (rabbitHelpContent D.bodyText), roughly 100 characters. The target band is 45 to 75, with 60 to 66 ideal. Both are 1.5 to 1.9 times over.

- Why it matters: Measure is the most reliably ignored typographic control and the one a reader feels most. 115ch at 10.5px is the worst measure on the surface.

- Change: Body copy in both panels goes to the 14px Body step with a max-width of 66ch set in ch units, left-aligned within the panel. For the HelpModal that also means the content column stops being full-bleed, which gives the prose a left edge that agrees with its headings.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5262` — `<p className="text-[10.5px] text-stone-500 mt-1">   When OFF, Saturday + Sunday columns are hidden from the day-view gantt entirely.`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5492` — `<div className="flex-1 overflow-y-auto p-5">   <RabbitHelpContent helpPage={helpPage} theme="dark" />`




**TL-27 · MEDIUM · Alignment** — Control heights in the detail toolbar do not agree: +Task is 4px taller than the two buttons touching it, and icon sizes alternate 12/14px with no rule  
law: Fitts's Law

- Problem: Within one flex row: undo and redo are p-1.5 with w-3.5 icons, about 26px; zoom chips are px-2.5 py-1, about 24px; Today is px-2 py-1 with a w-3 icon; group-by is p-1.5 with w-3.5; sort is px-2 py-1; "+ Phase" and "Key Date" are px-2.5 py-1 with w-3 icons; "+ Task" is px-2.5 py-1.5 with a w-3 icon, about 28px. So the primary button is visibly taller than its two immediate neighbours, and the icon sizes alternate 14, 12, 14, 12 across the row. Five of the eight also carry a hover:bg-stone-800 and three do not.

- Why it matters: Directly answers "make sure alignment in rows and items all make sense". A toolbar with three heights in it looks assembled rather than designed, even to someone who cannot name why.

- Change: Every child of a Toolbar is 28px tall with one padding pair and one 14px icon size, so the row has a single baseline. The primary action, if it stays inline, is the only one at 36px and it is separated by a 24px gap rather than the current 6px. One hover treatment across all of them.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4954` — `className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800"`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4977` — `className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4883` — `<Crosshair className="w-3 h-3" />`




**TL-28 · MEDIUM · System** — No shortcut bar on a view that binds document-level keys — the exact gap Audrey named  
law: Paradox of the Active User

- Problem: TimelineView registers a window keydown handler for Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (294-312) and exposes undo/redo only as two unlabelled 14px icons in a crowded toolbar. BinsView, in the same tool, ends with a 34px footer listing twelve Kbd hints (BinsView.jsx:843-846) using a shared Kbd primitive (bins/binUi.jsx:134-138). The Timeline gets nothing. It also has at least seven undiscoverable gestures — drag empty space to draw a task, drag a bar body, drag a bar edge, drag the right-edge dot to link, drag the arrowhead to rewire, drop on empty space to disconnect, Ctrl+wheel to zoom the minimap — all documented only in title attributes and a help page.

- Why it matters: Audrey named this herself. It is also the Paradox of the Active User: seven gestures with no rendered affordance are seven features nobody finds.

- Change: Promote BinsView's footer to src/ui/ShortcutBar at 28px with Kbd at the 11px Label step, and mount it here with: Ctrl+Z undo, Ctrl+Shift+Z redo, drag to move, drag edge to resize, drag dot to link, Ctrl+wheel to zoom. Same bar, same height, same position, in every view that binds keys or carries a gesture. This is the single clearest expression of "these tools are all part of one large ecosystem".

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:294` — `useEffect(() => {   function onKey(e) { ... if (k === 'z' && !e.shiftKey) { e.preventDefault(); ctx?.undo?.() }`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:846` — `<span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span> … <span><Kbd>Ctrl</Kbd><Kbd>Z</Kbd> undo</span>`




**TL-29 · MEDIUM · Typography** — Four dialog titles at four sizes, all uppercase with tracking, none at a title size

- Problem: PhaseExtendModal's title is text-[10.5px] uppercase tracking-widest font-bold (3898). TaskEditor's is text-[10.5px] uppercase tracking-widest font-bold (4156). EditHistoryDrawer's is text-[12.5px] uppercase tracking-wider font-bold (93). SettingsPanel's and HelpModal's are unclassed 16px uppercase tracking-wide (5194, 5463). So the largest type on the whole surface is an accident and two of the four dialog titles are smaller than the body text inside their own dialogs (TaskEditor's inputs are text-xs, 12px, at 4198).

- Why it matters: A title smaller than its own body copy is not a title. This is the clearest instance of "when everything is emphasised nothing is".

- Change: One dialog title role: 16px, sentence case, weight 600, no tracking, in the shared Dialog header. "Edit phase", "Task outside phase window", "Edit history", "RABBIT settings", "Help". Uppercase survives only in the 11px Label role.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4156` — `<span className="text-[10.5px] font-mono uppercase tracking-widest font-bold" style={{ color: isMilestone ? '#f59e0b' : '#fb923c' }}>`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3898` — `<span className="text-[10.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fed7aa' }}>   Task outside phase window`




**TL-30 · MEDIUM · System** — TaskEditor: 35 inputs and selects styled by copy-paste, with the ink colour changing by mode for no reason  
law: Law of Similarity

- Problem: Every field repeats the same literal: className "w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500" plus style backgroundColor #1c1917, border 1px #44403c. The text colour then varies by editor mode — #f59e0b for milestone fields (4199, 4209, 4230), #f4a261 for phase/task/asset fields (4257, 4342, 4420), #a8a29e for description fields (4243, 4328) — and the focus ring changes with it (ring-amber-500 for milestones, ring-orange-500 elsewhere). So the same field type reads as three different controls depending on which record you opened, and the description field is quieter than its own label. Nineteen select elements additionally set per-option inline colours (4288-4296, 4562-4565, 4575-4583), which Chromium renders inconsistently on Windows and which encodes status meaning in a dropdown the user sees for one second.

- Why it matters: 35 copies of a control is 35 places for the next drift. binUi already solved this inside the same tool.

- Change: Promote binUi's Input/TextArea/Select to src/ui, one dark variant, 36px md height, 1px rule, 4px radius, 14px Body ink at the 100 percent screen regardless of mode, one focus-visible ring in signal. Delete the per-mode ink and the per-mode ring. Replace inline option colours with a StatusBadge shown next to the select's current value, where it is actually legible and persistent.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4198` — `className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500" style={{ backgroundColor: '#1c1917', color: '#f59`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4288` — `<option value="not_started" style={{ color: '#a8a29e' }}>Not started</option> <option value="in_progress" style={{ color: '#fb923c' }}>In progress</option>`




**TL-31 · MEDIUM · Flow** — TaskEditor is a 20-field form with no grouping, no section heads and no sense of length  
law: Chunking

- Problem: The task mode renders Title, Phase, Asset, Scene, Shot, Level, Experience, Start, End, Bid days, Assigned to, Priority, Status, plus a file manager — up to fourteen controls with no visual grouping beyond a repeating grid-cols-2. Every Field label is the same 10.5px uppercase tracking-widest #a8a29e (4684), so identity fields, relation fields, schedule fields and workflow fields are typographically identical. The modal is max-w-md (448px) and scrolls with no scrollbar styling and no indication of how much is below.

- Why it matters: Chunking and Miller's Law: fourteen ungrouped peers exceeds working memory, and Law of Proximity is currently doing nothing because every gap is the same.

- Change: Keep every field and every control. Group them with SectionTitle eyebrows at the 11px Label step and 24px gaps between groups versus 16px within: Identity (title, phase, asset), Placement (scene/shot/level/experience, only the enabled ones), Schedule (start, end, bid days), Assignment (assignee, priority, status), Files. Widen to 560px so the two-column pairs stop crushing. Label goes to 11px Label, value to 14px Body, with a 4px label-to-control gap against a 16px group gap so the pairing cannot drift.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4681` — `function Field({ label, children }) {   return (<div><label className="block text-[10.5px] font-mono uppercase tracking-widest mb-1" ...`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4143` — `className="rounded-sm flex flex-col w-full max-w-md"`




**TL-32 · MEDIUM · Build** — Two native OS surfaces punch through the custom chrome: five confirm() calls and an <input type="color">  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: Destructive actions use the browser's confirm(): 'Remove this dependency?' (3375), 'Delete this milestone?' (4103), 'Delete this asset?…' (4109), 'Delete this phase?…' (4115), 'Delete this task?' (4121). In a frameless Electron app with a custom title bar these render as an unstyled Chromium dialog with the app's file path in it. The milestone colour field is a raw <input type="color"> (4214-4219) that opens the OS colour picker and prints the raw hex beside it at 10.5px (4221), which also means the surface's palette is user-extensible without limit — any recommendation to reduce the ink count is void while a colour wheel ships.

- Why it matters: Jakob's Law governs mechanism, not expression: a confirmation must behave like a confirmation, but it does not have to be the browser's. The colour picker is also the one hole through which the palette leaks.

- Change: Route all five confirms through the promoted Dialog with a danger primary — same two outcomes, same flow, one styled surface. Replace the colour wheel with six fixed swatches drawn from the token set (signal, success, warning, danger, info, neutral) rendered as a small radio group; the stored value stays a hex so no data changes.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:3375` — `if (confirm('Remove this dependency?')) onUnlinkDependency?.(e.id)`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4214` — `<input type="color" value={draft.color || '#f59e0b'} onChange={(e) => patch('color', e.target.value)}   className="w-8 h-8 rounded-sm border-0 cursor-pointer"`




**TL-33 · MEDIUM · System** — SettingsPanel is drawn in 2px borders and 14px sans while the tool it configures is 1px borders and 10.5px mono  
law: Law of Common Region

- Problem: Five settings cards use bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4 (5257, 5277, 5286, 5303, 5045) with text-sm font-bold labels. The gantt behind it is 1px #44403c everywhere. So the configuration panel is visually heavier than the thing it configures, and it is the only place on this surface using 14px type. The tabs are also full-width flex-1 fills (5205), a sixth tab idiom. Its lock bar, tabs and header are three stacked strips before any setting appears.

- Why it matters: A 2px rule against 11px type is the measurable reason D.O.G. and O.T.T.E.R. read heavier than RABBIT; this panel imports that weight into RABBIT.

- Change: Cards become a hairline plus a SectionTitle at 16px sentence case, not a bordered box — the Law of Common Region is satisfied by the rule and the gutter. All borders to 1px. Tabs adopt the shared underline Tabs component. Fold the lock bar into the tab row as a right-aligned control so the panel loses one strip.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5257` — `<div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">   <label className="block text-sm font-bold mb-2 text-orange-400">Timeline Display<`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5226` — `<div className="bg-stone-900 px-4 py-2 border-b-2 border-stone-600 flex items-center justify-between flex-shrink-0">`




**TL-34 · MEDIUM · Alignment** — The Project Type Defaults table is a hand-rolled flex table with a 4px header/row height mismatch and a 3.65:1 header

- Problem: Header row is px-3 py-2 with text-[10.5px] uppercase tracking-wider font-bold at #78716c (5311-5315). Body rows are px-3 py-1.5 with text-[11.5px] capitalize at #d6d3d1 (5321-5323). So the header is 30px and the rows are 26px, the header type is smaller than the body type, and the header is below the contrast floor. Twelve rows of three 16×16 checkboxes in w-16 columns with no zebra, no hover on the checkbox itself, and a bare "Reset to defaults" text link at 10.5px underneath (5352).

- Why it matters: This is the "files database looks atrocious" pattern at small scale: hand-rolled table, mono, uppercase, undersized, low-contrast header, mismatched row heights.

- Change: This is the twentieth hand-built table in the app. Port it to the shared Table with Th/Td: 32px head at the 11px Label step, 36px rows at 13px Dense, 8px/12px cells, hairline dividers, one hover fill. Checkbox becomes the shared control. "Reset to defaults" becomes a ghost Button, not a link.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5312` — `<span className="flex-1 text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Type</span> <span className="w-16 text-[10.5px]`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5321` — `<div key={type} className="flex items-center px-3 py-1.5 hover:bg-stone-800/40 transition-colors"   style={{ borderBottom: '1px solid #292524' }}>`




**TL-35 · LOW · System** — HolidaysEditor rows are 24px, the divider is invisible, and the two CSV buttons are a third button variant  
law: Fitts's Law

- Problem: Holiday rows are px-3 py-1 with text-[11.5px] mono and a border-b border-stone-800 on a #0c0a09 ground — #292524 on #0c0a09 is very close to 1:1 and the divider does not exist visually (5117-5126). The row is roughly 24px, under the 28px control floor, with an X button at p-0.5 that is a 16px hit target. Import CSV and Export CSV use a fourth button style — #a8a29e on #1c1917 with a 1px #44403c border (5087, 5096) — next to an Add button in the filled orange style (5073).

- Why it matters: Fitts's Law on the 16px delete target, and a fourth button variant in a file that already had three.

- Change: Rows to the shared 36px table row with the rule token divider; remove button to a HoverActions slot revealed on row hover and focus-within, with a 28px target. Import, Export and Add all become the shared Button: Add primary, the other two secondary.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5119` — `className="flex items-center gap-2 px-3 py-1 border-b border-stone-800 last:border-b-0 hover:bg-stone-900"`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5086` — `className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm" style={{ color: '#a8a29e', backgroundColor: '#1c1917',`




**TL-36 · LOW · System** — Dead code carrying a sixth active-state idiom: ZoomControls, three unused constants and two unused icon imports

- Problem: ZoomControls (5506-5551) is explicitly marked "legacy — kept for compatibility, no longer rendered" and is 46 lines implementing yet another zoom toolbar, with its own active treatment (#ea580c fill on a #1c1917 ground inside a 1px #44403c group). ZoomIn and ZoomOut are imported at line 51 solely for it. OVERVIEW_ROW_PX (114) is described as a "legacy fallback" and is only reached by dead branches in OverviewContainmentOverlay (1613, 1617, 1622) and OverviewBar (1725). OVERVIEW_TASK_ROW_PX (116) is unreachable because buildOverviewRows emits only phases.

- Why it matters: Cheap, zero risk, and it removes one of the six competing idioms from the file before anyone has to reconcile them.

- Change: Delete ZoomControls, the two icon imports, OVERVIEW_ROW_PX and its fallback branches, and OVERVIEW_TASK_ROW_PX. Nothing renders them; they are a trap for the next person grepping for "the zoom control".

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5502` — `// ZoomControls (legacy — kept for compatibility, no longer // rendered. The new DetailZoomToolbar replaced it.)`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:114` — `const OVERVIEW_ROW_PX       = 14                  // legacy fallback / OverviewBar baseline const OVERVIEW_TASK_ROW_PX  = 11                  // shorter rows fo`




**TL-37 · LOW · Typography** — The minimap zoom control puts three type sizes and four colours into a 200px span

- Problem: Reading left to right: "Zoom" is text-[9.5px] uppercase tracking-wider #78716c (5641), "6mo" is text-[10.5px] #78716c (5644), the slider is a native range with accentColor #fb923c (5655), "5yr" is text-[10.5px] #78716c (5700), and the live value is text-[11.5px] tabular-nums #fb923c with minWidth 48 (5702). Three sizes, one native control, one hand-drawn tick overlay whose left:8/right:8 inset is a guess at the browser's thumb half-width (5663-5672 and its own comment says so).

- Why it matters: A 200px control with three type sizes in it reads as three controls.

- Change: One size for the whole group: 11px Label for "Zoom", "6mo" and "5yr"; the live value at 13px Dense with tabular-nums. Either restyle the range with a real track and thumb so the snap ticks can align to a known geometry, or drop the overlaid ticks and mark the snap points in the value label instead. The magic inset will drift on any Chromium update.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5641` — `<span className="text-[9.5px] font-mono uppercase tracking-wider ml-1" style={{ color: '#78716c' }}>Zoom</span> <span className="text-[10.5px] font-mono" style=`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5663` — `Padding on  the sides matches the typical thumb half-width so  the lines align with the track, not the container  edges.`




**TL-38 · LOW · Hierarchy** — The minimap hover popup is a fifth floating-surface treatment and its border colour changes with the hovered object  
law: Law of Similarity

- Problem: The popup is fixed, rounded-sm, shadow-lg, with fontFamily 'monospace' set inline (1416) rather than by class, a 6px/10px padding pair used nowhere else, and a border whose colour is the hovered milestone's user-chosen hex or #fb923c for a phase (1412). Inside it: an 11.5px bold uppercase tracking-wider title, a 10.5px count, a 10.5px date range and, for milestones, a 9.5px "project bound" tag (1423-1443) — four sizes in a 320px popover.

- Why it matters: A tooltip whose chrome changes colour per object cannot be recognised as one component.

- Change: One floating surface from the shared kit: raised ground, one rule, 8px radius, one shadow, 12px padding. Title at 13px weight 600 sentence case, metadata at 12px Caption. The hovered object's colour appears as a dot inside the popup, never as the popup's own border.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1412` — `border: '1px solid ${hoverPopup.row.kind === 'milestone' ? (hoverPopup.row.milestone?.color || '#f59e0b') : '#fb923c'}', padding: '6px 10px', zIndex: 9999, maxW`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1434` — `<div className="text-[9.5px] mt-0.5 uppercase" style={{ color: '#78716c' }}>project bound</div>`




**TL-39 · LOW · Density** — Row height swings 28 to 56px with the zoom control, so the left column's density is governed by a control that names the time axis  
**constraint: touches-interaction** · _taste, not error_

- Problem: ROW_PX_BY_ZOOM sets day 56, week 34, month 30, quarter 28 (101-106) and the same value drives the label column's row height (2331, 2398). At day zoom a task name occupies a 56px row; at quarter zoom the same name occupies 28px. The reason given is that the day cell needs width for a day number, which is a chart-axis concern, not a label-column one.

- Why it matters: Density should be a property of the data, not of an unrelated control. Flagged as adjacent to the viewing model, so it is Audrey's call whether the fixed row is worth losing the day-cell breathing room.

- Change: Fix the row at the 36px table row across all zooms and let the bar centre itself inside it (see TL-21). The day cell's 56px WIDTH is unaffected — dayPx and rowPx are independent. This is the only spacing change on this list that touches chart geometry, so it wants a visual check at all four zooms.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:101` — `const ROW_PX_BY_ZOOM = {   day:     56,   week:    34,`




**TL-40 · LOW · Uniformity** — EditHistoryDrawer runs a private five-step type scale and a badge style that exists nowhere else

- Problem: In 225 lines it uses 10, 10.5, 11, 11.5 and 12.5px — five sizes for a header, a subtitle, a badge, an actor name, a timestamp, a summary, diff lines and a footer. The action badge is an outlined pill at text-[10px] uppercase tracking-wider bold with border and colour both taken from meta.color and opacity 0.9 (179-181), which is a sixth badge treatment. Diff lines use line-through with a separate textDecorationColor (214) at 11px.

- Why it matters: A 225-line drawer inventing five type steps is the local-tokens rule producing drift at the smallest possible scale.

- Change: Port onto the shared scale: header 16px sentence case, subtitle 12px Caption, badge to the shared StatusBadge at the 11px Label step, actor 13px Dense weight 600, timestamp 12px Caption, diff lines 13px Dense with the old value at ink-48 and the new at ink-100. Drop the 0.9 opacity on the badge — a screened border is not a design decision, it is a way of avoiding one.

- Evidence: `src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:179` — `<span className="text-[10px] font-mono uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"   style={{ color: meta.color, border: '1px sol`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:212` — `<div key={l.field} className="text-[11px] font-mono flex items-baseline gap-1.5 min-w-0">`




**TL-41 · LOW · Uniformity** — EditHistoryDrawer's four states are four one-off divs, and its three loading indicators are three different things

- Problem: Not-cloud, error, loading and empty are four separately hand-styled blocks (113-130) at three different treatments: two boxed with a border, two bare text. "Loading…" is bare 11.5px text, while the refresh button spins its own icon (102) and the revert button spins a third (198). Three loading affordances in one drawer, none of which is a skeleton, so "loading" and "nothing here" look nearly identical.

- Why it matters: The system review calls this out app-wide; this drawer is a compact instance of it and is cheap to fix while the file is open.

- Change: Empty and not-cloud use the shared EmptyState. Error uses the shared inline error from TL-23. Loading uses skeleton entry cards so the drawer's shape is stable while it fetches. The two spinners stay as in-button state, which is correct.

- Evidence: `src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:124` — `<div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>   Loading…`<br>`src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx:128` — `<div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>   No recorded changes in the last 90 days.`




**TL-42 · LOW · Alignment** — The column header and the axis header sit on different baselines across the seam, 4px apart

- Problem: Both headers are HEADER_PX = 44 tall. The label column's header uses flex items-end px-3 pb-2, putting its 9.5px baseline 8px off the bottom (2282-2290). The chart's axis header is a column flex whose bottom label carries marginBottom 4 (2498), putting its baseline 4px off the bottom. So the two pieces of 9.5px header type across the chart's main seam are 4px out of alignment.

- Why it matters: Small, but it is the seam the eye crosses on every single read of the chart.

- Change: One header component, one bottom inset, one baseline. With HEADER_PX at 32 (TL-09) both labels sit on the same 8px inset and the top tier of the axis becomes a 11px Label eyebrow at a fixed top inset.

- Evidence: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2282` — `className="flex items-end px-3 pb-2 sticky top-0 z-10"`<br>`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2498` — `style={{ color: tick.major ? '#78716c' : '#57534e', marginBottom: 4 }}`





## Uniformity gaps

- **Keyboard shortcut hints (the ShortcutBar Audrey named)** — here: Absent. TimelineView.jsx:294-312 registers Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y at window level and the only exposure is two unlabelled 14px icons at TimelineView.jsx:4826-4851. Seven drag gestures are documented only in title attributes. — elsewhere: BinsView.jsx:843-846 renders a 34px footer with twelve Kbd hints built from bins/binUi.jsx:134-138. — do: Promote BinsView's footer to src/ui/ShortcutBar at 28px with the shared Kbd at the 11px Label step, and mount it in every view that binds document-level keys or carries an undiscoverable gesture — Timeline first.

- **Shared UI primitives inside RABBIT** — here: TimelineView.jsx defines its own Field (4681), its own button markup nine times, its own inputs 35 times, its own modal twice and its own drawer once — importing nothing from bins/binUi. — elsewhere: views/bins/binUi.jsx already exports C, Btn, IconBtn, Chip, Menu, EmptyState, Kbd, Spinner, MediaTag, ColorDot and Field, and its header states the intent: "The Bins tab is built from these so every screen in it reads the same." — do: binUi is the proof the shared layer works inside this tool. Promote it to src/ui, extend it with Table, Toolbar, Tabs, StatusBadge, ShortcutBar and Drawer, and rebuild the Timeline against it rather than adding a second private kit.

- **Tab / segmented control** — here: Five idioms: zoom chips with a fill (4858-4871), group-by icons with colour only (4902-4914), sort with colour only at another size (4923-4944), SettingsPanel tabs as full-width 14px fills (5203-5222), HelpModal sidebar as a left-border list at 11.5px (5475-5486). — elsewhere: ViewTabs.jsx:50-62 is a sixth — fill plus a 2px bottom border at 11px mono uppercase — and it sits directly above this view. — do: One Tabs component with a 2px signal underline and no fill, used by ViewTabs, the zoom step, group-by, sort and the settings tabs. The help sidebar becomes a Panel nav list, which is a different component with its own single treatment.

- **Page gutter** — here: Eight strips, five left edges: ViewTabs px-2, ProjectContextBar px-6, banners px-3 (694, 710), SummaryBand px-6 (5594), DetailZoomToolbar px-6 (4821), label header px-3 (2282), phase rows 26px (2406), drop-zone rows 28/42px (2336). — elsewhere: ProjectContextBar.jsx:54 and the two py-2 px-6 strips already agree on 24px, so three of eight are correct. — do: 24px everywhere, owned by the strip component, with the label column's base inset set from the same constant so the header and its rows share one edge.

- **Dialog and drawer chrome** — here: Five overlays, five backdrops, four surfaces, four border treatments, four title sizes, one shell-inset compensation present and one missing (TimelineView.jsx:3884/4138/5180/5455, EditHistoryDrawer.jsx:83). — elsewhere: bins/binUi.jsx's Modal already implements the modal stack, topmost-only Escape, busy lock and in-footer error. — do: Promote that Modal to src/ui/Dialog and add a matching Drawer that owns the 32px title-bar inset once. Port all five.

- **Status colour** — here: Nineteen bar palettes in barTone (5757-5815), nineteen inline <option> colours (4288-4296, 4394-4397, 4562-4565, 4575-4583), a user-picked milestone hex (4216), and a history badge colour from entryActionMeta (EditHistoryDrawer.jsx:179-181). — elsewhere: The file's own comment at 5755 says barTone "aligns with statusColor() in ProjectTasksView" — two tools, two copies of one mapping. — do: One StatusBadge taking a semantic token and one status-to-token map imported by both, so a status colour can never be written inline again.

- **Toast and banner** — here: Two pane-level banners (692-726) and no toast at all, while the provider exposes showUndoToast and components/UndoToast.jsx exists and is mounted at the Rabbit shell. — elsewhere: RabbitProvider.jsx:292-301 owns the toast; other views consume it. — do: One Toast anchor and one Banner variant. The Timeline's two banners become Banners; anything transient that can be undone (a bar drag, a reparent) should reach the existing UndoToast rather than being silent.

- **Icon sizing** — here: Five sizes on this surface — 10, 12, 14, 16, 20px — with 12 and 14 alternating inside a single toolbar row (4837, 4883, 4912, 4957). — elsewhere: binUi's IconBtn takes one size prop defaulting to 3.5 (14px) for its whole tab. — do: Three sizes only: 14px inside dense controls, 16px in rows and buttons, 24px in empty states.


## Alignment issues

- Gantt row, label half versus chart half (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2400`): Phase rows are transparent with a 1px #292524 bottom border in the label column and a filled rgba(68,64,60,0.55) band with a 1px #1c1917 border in the chart. Drop-zone rows have a transparent bottom border on the left (2332) and a 1px dashed #44403c on the right (2718). The two halves do not read as one row, and the divider between them measures 1.15:1. → One Row component spanning both halves: one 36px height, one hairline at the rule token, one fill state. Drop the chart-side phase band entirely.

- Gantt row hover (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2396`): hover:bg-stone-800/50 is on the label-column row only. The chart half has no hover state, so pointing at a row highlights the left 240px and stops at the divider. → Lift hover to a shared row index in DetailPane and apply the same fill to both halves; the pane already tracks dropZoneHover and reparentHoverPhaseId, so the mechanism exists.

- Label column indent (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2336`): Drop-zone rows use paddingLeft 8 + depth*14 + 20 while phase and task rows use 6 + depth*14 + 20. At depth 1 that is 42px versus 40px, and the drop-zone's in-flow Plus icon pushes its text a further 18px right, so "New task…" lands 20px out of line with the task titles it follows. → One base inset and one 16px indent unit for all three row kinds, with a fixed 20px reserved icon slot so an icon's presence never shifts the text after it.

- Column header versus its own column (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2282`): "Phase / Task" sits at px-3 (12px) while the depth-0 phase names it heads sit at 26px and task names at 40px. The header aligns with nothing beneath it. → Header takes the same base inset as a depth-0 row.

- Header baselines across the chart seam (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:2498`): The label header is bottom-aligned with pb-2 (8px) and the axis label carries marginBottom 4, so two pieces of 9.5px header type are 4px out of alignment across the divider. → One header component, one bottom inset, one baseline.

- DetailZoomToolbar control heights (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4977`): "+ Task" is px-2.5 py-1.5 (~28px) while "Key Date" and "+ Phase" immediately beside it are px-2.5 py-1 (~24px), and undo/redo/group-by are p-1.5 (~26px). Three heights in one row. → Every Toolbar child at 28px with one padding pair; the primary action alone at 36px, separated by a 24px gap.

- DetailZoomToolbar icon sizes (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:4883`): Icons alternate w-3.5 (undo, redo, group-by) and w-3 (Today, Plus on all three create buttons) across a single row with no rule. → One 14px icon size for every control in a toolbar.

- SummaryBand numeric column (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5718`): Eight tiles in a wrapping flex row with no fixed width, so eight numbers sit at eight x positions determined by the preceding label's length. None uses tabular-nums; one value alone is formatted to one decimal (5611). → Fixed tile width, value above label, tabular-nums on every figure, one unit format decided in buildSummary.

- Banner strips versus the strips below them (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:694`): The read-only and dependency-error strips are px-3 (12px) while SummaryBand, the toolbar and ProjectContextBar are px-6 (24px). The banners hang 12px left of everything under them. → Both banners to the 24px page gutter.

- Project Type Defaults table (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:5311`): Header row px-3 py-2 (~30px) against body rows px-3 py-1.5 (~26px), and the header type (10.5px) is smaller than the body type (11.5px). → 32px head, 36px rows, header at the 11px Label step, body at 13px Dense.

- Minimap frame stacking (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1817`): OverviewBar sits at zIndex 6 and the visible-window frame at zIndex 5, so the frame's border and fill are occluded wherever a bar exists — which is everywhere it matters. → Frame edges move above the bars with pointer-events confined to the 2px edges, so hit-testing on the bars is unchanged.

- Minimap frame gutter (`src/tools/rabbit_v0.1.0/views/TimelineView.jsx:1316`): A 1px top and bottom gutter is reserved by a comment describing a "2px orange border" that the code at 1322 no longer draws. The compensation protects nothing and eats 2px of a 124px pane. → Delete the stale comment and either restore the 2px edge or remove the gutter.


## Hick's Law hotspots

- DetailZoomToolbar (TimelineView.jsx:4819-4986): 18 visible choices → Undo and redo leave the strip and move to a ShortcutBar (they are already global key bindings). The three create actions collapse to one filled "New" Button opening a three-item Menu — task, phase, key date — which keeps all three reachable in one click plus one. Group-by becomes a single labelled control showing its current value, expanding to the full list on click. Sort becomes one control that toggles direction rather than two mutually exclusive buttons. Visible choices drop from 18 to 8 with nothing removed and nothing made harder to reach.

- SummaryBand (TimelineView.jsx:5592-5710): 16 visible choices → Eight statistics, two buttons, a slider and four label fragments in one row. Fit, Today and the zoom slider move into the OverviewPane's own header, which is the region they act on — that removes six items and also fixes the duplicate-Today collision. Of the eight stats, Phases, Tasks, Blocked and Span are the ones read daily; Assets, Critical, Working and Critical days move behind a single hover or click disclosure on the band. Visible items drop from 16 to 5, with every figure still one gesture away.

- TaskEditor, task mode (TimelineView.jsx:4412-4610): 14 visible choices → Fourteen controls with no grouping. Chunk into five labelled groups — Identity, Placement, Schedule, Assignment, Files — with 24px between groups and 16px within, so the user faces four or five decisions at a time rather than fourteen. No field is removed or hidden; the Placement group already self-hides when scenes, levels and experiences are disabled.

- Status and priority selects (TimelineView.jsx:4568-4585, 4281-4298): 9 visible choices → Nine task statuses in one flat select with nine inline colours. Group them with optgroup into Not started / In flight / In review / Closed, which keeps all nine selectable while reducing the scan to four groups. Drop the per-option inline colours and show the chosen status as a StatusBadge beside the control, where the colour is persistent and legible.

- HelpModal sidebar (TimelineView.jsx:5474-5486): 11 visible choices → Eleven flat nav items, right at the ceiling of working memory and with no grouping. Chunk into three headed groups — Getting started (Overview, Projects, Intake), Planning (Assets, Timeline, Phases & Tasks, Dependencies, Zoom & Weekends), Reference (Budget, Settings, Shortcuts) — using the 11px Label eyebrow. Same eleven destinations, three scan targets.

- The whole pane, gesture load (TimelineView.jsx:2039-2096, 2184-2253, 1912-2014, 1089-1110): 7 visible choices → Seven mouse gestures carry real writes — drag empty space to draw, drag a bar body, drag a bar edge, drag the row to reparent, drag the right-edge dot to link, drag the arrowhead to rewire, drop on empty space to disconnect — and none has a rendered affordance at rest. This is not a choice-count problem but a discoverability one; the fix is the ShortcutBar plus a hover cursor language that is consistent (currently the chart row is `crosshair` at 2790 while the bar is `grab` at 3778 and the drop-zone is `pointer` at 2714, with no legend tying the three together).


## Type inventory

| px | Class / source | Count | Roles it is currently playing |
|---|---|---|---|
| 16 | none — inherited UA default | 2 | Dialog title (SettingsPanel 5194, HelpModal 5463). The largest type on the surface, set by accident |
| 14 | `text-sm` | 7 | Settings card label (5258, 5278, 5287, 5304), HolidaysEditor label (5046), settings tab (5205, 5215), lock status (5231) — section title + tab + status, all at one size |
| 12.5 | `text-[12.5px]` | 1 | Drawer title (EditHistoryDrawer 93) |
| 12 | `text-xs` | 35 | Every TaskEditor input and select value (4198+), HelpModal body copy, version footer (5489) — input + body + caption |
| 11.5 | `text-[11.5px]` | 18 | Row labels (2447), hover popup title (1439), "Timeline" band title (5599), both halves of every SummaryTile (5720-5721), holiday rows (5121), help sidebar items (5478), history actor (183) |
| 11 | `fontSize: 11` inline | 3 | Both empty states (2300, 2652), reparent ghost (2971) |
| 11 | `text-[11px]` | 3 | History diff lines and revert error (EditHistoryDrawer 134, 204, 212) |
| 10.5 | `text-[10.5px]` | 52 | Buttons (4634, 4647, 4657, 4954, 4977), field labels (4684), **dialog titles** (3898, 4156), bar labels (3798), banner text (694, 710), settings body copy (5262), table headers (5312) |
| 10 | `text-[10px]` | 3 | History badge (179), timestamp (186), drawer footer (159) |
| 9.5 | `text-[9.5px]` | 7 | Both axis tick tiers (1173, 2489, 2497), column header (2289), "Zoom" (5641), asset caption (4594) |

Nine sizes, five of them half-pixel, for six real roles. `text-[10.5px]` alone plays button, field label, dialog title and body paragraph. Weights: `font-bold` x23, `font-medium` x4, `font-semibold` x2 plus the default — four weights, and 700 is the most common. Case: 44 `uppercase` occurrences and 43 `tracking-*` (wide x6, wider x30, widest x7), so almost every label, heading, button, tab, chip, axis tick and status pill is the same typographic object: 9.5-to-11.5px bold uppercase tracked mono. Family: 89 `font-mono` classes plus 4 inline `fontFamily: 'monospace'`; zero sans. Nothing on this surface is set in a sans face, including 20 form fields and every paragraph of body copy.


## Priority order

TL-04 — adopt the shared type scale on this surface. Nine sizes to six steps, one family rule, uppercase confined to the Label role. This is the system fix and it resolves TL-09, TL-21, TL-26, TL-29, TL-37, TL-40 and TL-42 as a side effect, so doing it first stops those being fixed seven times., TL-10 — one 24px page gutter and one indent rule across all eight strips and all three row kinds. Cheapest change on the list, visible on every screen, and it is the literal answer to her alignment note., TL-03 — make the gantt row one row: one height, one hairline, one hover that spans the label column and the chart. Highest perceived-quality return per hour on the surface., TL-02 — task labels off the 3.65:1 grey. One line, fixes the single worst readability defect, and it is the text the user came to read., TL-01 — collapse five segmented-control idioms to one Tabs component. Cheap once the scale exists, and it is the clearest statement that the tools share a language., TL-28 — mount the ShortcutBar. Audrey named this gap herself; the component already exists in BinsView and wants promoting, not writing., TL-15 — one rule token, with the chart's spine as the strongest line rather than the faintest. Cheap and it makes the whole pane read as structured., TL-11 — promote binUi's Modal to a shared Dialog and Drawer and port all five overlays. Larger, but it deletes five maintenance sites and makes TL-23, TL-24, TL-29, TL-32 and TL-41 fall out of it., TL-09 — axis labels to the 11px Label floor at a readable ink, header to 32px. Without this the chart cannot be read at all., TL-08 and TL-27 — restructure the detail toolbar: one primary, one control height, one icon size, undo/redo out., TL-07 — rebuild the SummaryBand with real internal hierarchy and a numeric column., TL-05 and TL-13 and TL-14 — the palette: collapse barTone onto semantic tokens, confine #ea580c to four jobs, retire cyan/fuchsia/zinc. Needs Audrey's ruling on the palette question, so it is sequenced after the structural work rather than blocking it., TL-06 — split the two "Today" buttons by moving the minimap's controls into the minimap., TL-12 and TL-25 — black ink on every orange fill, one Toggle component with a visible knob. Both are her own colour rule applied consistently., TL-22 — one EmptyState and a real Loading component with skeleton rows., TL-20 and TL-19 — one elevation token, delete the inset bevel and both diamond glows, cut the infinite dependency pulse to a hover-triggered dot and add a reduced-motion guard., TL-16, TL-17, TL-18 — reclaim roughly 70px of vertical field, stop the minimap truncating silently, and make the frame the dominant object on the navigator., TL-30, TL-31 — promote the input kit and chunk the TaskEditor., TL-33, TL-34, TL-35 — settings drawer to 1px chrome, shared Table, shared Buttons., TL-36 — delete ZoomControls and the three dead constants. Do this first in whichever session opens the file, since it is zero-risk and removes a competing idiom before anyone has to reconcile it., TL-23, TL-24, TL-38, TL-39, TL-40, TL-41, TL-42 — the remainder, all of which are small once the shared kit exists.


## Rework scope (reviewer's estimate)

Files: `src/tools/rabbit_v0.1.0/views/TimelineView.jsx`, `src/tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx`, `src/ui/* (new: Table, Toolbar, Tabs, Button, Input/TextArea/Select, Dialog, Drawer, Menu, EmptyState, Loading, StatusBadge, Chip, Badge, Kbd, ShortcutBar, Panel, HoverActions, Field, SectionTitle, Toast)`, `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx (source of the promoted Modal, Menu, Input, Field, Kbd, Btn, EmptyState — moved, not rewritten)`, `src/tools/rabbit_v0.1.0/rabbitHelpContent.jsx (D token object: body copy to the Body step, sidebar grouping, new legend page)`, `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx (adopts the shared Tabs, so the tool's own strip stops being a sixth idiom)`, `src/tools/rabbit_v0.1.0/views/writeGate.test.js (assertion loosened before any JSX reformat — see risks)`  
Approx lines: 1150  
Suggested sessions: 3  
Split: Session 1 — the system layer and the strips (~350 lines). Create src/ui by promoting binUi (Button, Input, Select, TextArea, Field, Menu, Dialog, EmptyState, Kbd) and adding Toolbar, Tabs, ShortcutBar, SectionTitle, StatusBadge. Add the rabbit token module. Then apply it to the strips only: the two banners, SummaryBand, DetailZoomToolbar, and ViewTabs. Delete ZoomControls and the dead constants. Deliverables: TL-36, TL-10 (strips half), TL-01, TL-04 (strips half), TL-06, TL-07, TL-08, TL-27, TL-28, TL-12, TL-13 (chrome half). Low risk — none of this touches the writeGate JSX blocks or the chart geometry, except DetailZoomToolbar's own props, which must keep canWrite={canWrite} verbatim.

Session 2 — the two panes (~450 lines). One Row across both halves, one indent rule, one hover, one rule token, label and bar and axis type onto the scale, the legend, the empty and loading states, header to 32px, minimap frame and truncation, elevation and motion cleanup. Deliverables: TL-02, TL-03, TL-09, TL-10 (rows half), TL-15, TL-16, TL-17, TL-18, TL-19, TL-20, TL-21, TL-22, TL-42, and the barTone collapse of TL-05/TL-14 shipped together with the legend. Highest risk session: it is where the writeGate indentation, the drag-state inline styles and the zIndex stack all live. Loosen the test first.

Session 3 — the overlays (~350 lines). Port TaskEditor, PhaseExtendModal, SettingsPanel, HelpModal and EditHistoryDrawer onto Dialog/Drawer/Input/Table/Toast. Deliverables: TL-11, TL-23, TL-24, TL-25, TL-26, TL-29, TL-30, TL-31, TL-32, TL-33, TL-34, TL-35, TL-38, TL-40, TL-41, TL-13 (checkbox and button fills). Medium risk, fully isolated from the chart; the only trap is that TaskEditor's `inert={!canWrite}` on the body (4188) and the two GatedAction wrappers (4629, 4652) must survive the port intact.  
Risks: 1. writeGate.test.js pins the SHAPE of this file, not just its behaviour. It requires `useProjectAccess(` to be called inside tools/rabbit_v0.1.0/views/TimelineView.jsx, requires `const { … canWrite … } = useProjectAccess(`, and for each of DetailZoomToolbar, DetailPane and OverviewPane it locates the element's closing tag by searching for the literal string "\n      />" — six spaces of indent. Any reformat of those three JSX blocks, any change to their indentation, and any extraction of those components into their own files will fail the suite. Loosen those three assertions to search for the component's own closing brace or use an AST before touching the JSX, and prove the loosened test by breaking it (remove a canWrite prop and confirm it still fails).
2. A 7,073-line single file. Session 2 in particular edits three components that live 1,500 lines apart and share the dayToX / rowPx / span geometry. Do not attempt an extract-to-files refactor in the same session as a visual change; if the file is to be split, that is its own session with no styling in it.
3. Inline styles carry live drag state. OverviewBar stashes _draftStart and _draftEnd directly on the DOM node (1770-1771) and DetailBar's local `drag` state feeds `tone` through barTone on every mousemove (3567). Converting these to classes or to a styled component will silently drop the live preview.
4. barTone (5757-5815) is the single source of truth for every bar's colour AND the only encoding of task status in the chart. Collapsing 19 palettes to 6 tokens changes the meaning of the chart, not just its look — it must ship with the legend (TL-05) in the same change, or the user loses information they currently have.
5. The minimap's hit-testing depends on hand-computed zIndex 5 and 6 plus data-minimap-nojump markers walked up the DOM (1074-1078). Restyling the frame (TL-18) can make bars unclickable or make the background pan swallow bar clicks. Verify all four gestures — click to jump, drag frame, drag bar, Ctrl+wheel zoom — after any change to that stack.
6. ROW_PX_BY_ZOOM feeds both the label column and the chart's bar arithmetic (2331, 2398, 2716, 2781, 2873, 3238, 3782). Changing it (TL-39) moves dependency-arrow endpoints, ghost overlays and containment rails at once. This is the one finding I would hold for a separate visual check at all four zoom levels.
7. There is no way to see this surface in a test — nothing in the suite mounts React (writeGate.test.js says so in its own header). Every visual claim here has to be verified by Audrey in the running app, so each session should end with a named list of what to look at.
8. The Timeline is on a paused track branch and the demo sprint owns the working tree. Confirm the branch story before any of this is scheduled.
