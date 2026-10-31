# Review — Dashboard (My Tasks / Notes / Profile) — src/components/Dashboard/


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Dashboard\DashboardPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Dashboard\DashboardTasksView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Dashboard\NotesView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Dashboard\dashboardTaskModel.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\lightSurface.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\ProfileSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\SettingsPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\RateCard\RateCardPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\TeamMembers\TeamMembersPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ProjectTasksView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\TaskDetailPopup.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx`


## Job

The Dashboard is the one place a person answers "what is on me right now, across every project" without opening a project. It has three sub-views and each has exactly one job and one primary action. MY TASKS: read my cross-project workload and change a task's status in place; the one action is the status change on a row (the popup is the secondary path). NOTES: capture and retrieve my own private writing; the one action is "write in the selected note", with "New note" as the entry action. PROFILE: edit how I appear to teammates; the one action is "Save profile". The surface passes pass 1, but two of the three sub-views fail to express that job visually. In My Tasks nothing on the screen is more prominent than anything else, so the eye has no landing point at all. In Notes the loudest object on the page is the orange "New note" button, which is the entry action, not the job; the writing surface it exists to fill is the quietest thing on screen.


## What works

- lightSurface.js is actually imported and honoured: every text ink on the light half of this surface is LIGHT_INK, and the greys that survive (#a8a29e at DashboardTasksView.jsx:632, 639, 679) are all on the #1c1917 cards, where they are correct. The one-ink discipline is real here and the rework should keep it rather than re-deriving it.

- RolePill (DashboardTasksView.jsx:103-125) reasons explicitly about which surface it lands on and makes the CALLER declare it (`onDark`), defaulting to the branch where a wrong guess is unreadable rather than merely dim. That is the correct mental model for a two-surface app and it is the only component in this review that has it.

- All three views run off one pure, unit-tested filter/sort/group engine (dashboardTaskModel.js), so a visual pass can restyle the table, the board and the gallery without touching a line of logic. This is why the rework scope below is small.

- The save-state indicator (NotesView.jsx:632-639) is at the end of the toolbar where the eye finishes reading, and its error text says what will happen next ('Save failed — retrying on next edit') rather than just naming the failure.

- Both sub-views distinguish 'you have nothing' from 'nothing matches your filter' (DashboardTasksView.jsx:351-353, NotesView.jsx:222). Most surfaces in this app skip that distinction entirely.


## Findings (35)

**D1 · HIGH · Typography** — Monospace is the body face of the entire surface, including the note editor  
law: Law of Similarity

- Problem: 35 font-mono occurrences across three files and zero font-sans. Every task title, project name, date, count, empty state, error message, search field and note preview is set in the browser fallback mono. The worst instance is the note body itself: a rich-text editor with headings, bold, bullets and links, hard-set to ui-monospace at NotesView.jsx:678. A person writing prose in their own notebook is typing into a terminal. This is the single largest contributor to Audrey's 'fonts that dont look super contemporary' on this surface.

- Change: Adopt the app type system's rule: mono keeps only dates, counts, the '+N' presence overflow and the task-count numeral. Everything else moves to the sans. Delete font-mono from DashboardTasksView.jsx lines 51, 79, 95, 111, 225, 317, 350, 521, 534, 535, 536, 544, 545, 607, 629, 632, 639, 676, 679 and NotesView.jsx lines 49, 141, 221, 230, 244, 252, 257, 303, 330, 711, 726, and change NotesView.jsx:678 to the sans stack.

- Evidence: `src/components/Dashboard/NotesView.jsx:678` — `font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`<br>`src/components/Dashboard/DashboardTasksView.jsx:51` — `const inputClass = 'px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500'`<br>`src/components/Dashboard/DashboardTasksView.jsx:534` — `<td className="px-3 py-2 text-xs font-mono" style={{ color: L.text }}>{task.title}</td>`




**D2 · HIGH · System** — Ten distinct type sizes on a surface holding one table, one list and one editor

- Problem: 9, 10, 10.5, 11, 12, 13, 14, 16, 20 and 24px are all in use. 10.5px appears ten times (DashboardTasksView 518, 521, 604, 607, 632, 639, 679, 685; NotesView 257, 303) and is perceptually indistinguishable from the 10px and 11px steps sitting beside it, so three sizes are doing one job. 24 of the 57 size declarations are text-xs (12px), which means the de-facto body is 12px where Apple's desktop floor is 13 and Notion runs 14 to 16.

- Change: Collapse to five steps from the app scale: 16 (sub-view title), 14 (body, note text, tab labels), 13 (table cells, list rows, dense meta), 12 (captions, counts, timestamps), 11 (table headers, field labels, badges — the floor). Delete every use of 9px and 10.5px. Nothing on this surface needs 20 or 24 except the note H1 (D14).

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:518` — `<span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: L.label }}>`<br>`src/components/Dashboard/DashboardPage.jsx:128` — `className="px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider"`<br>`src/components/Dashboard/NotesView.jsx:247` — `<span className="px-1.5 rounded-sm text-[9px] font-bold uppercase tracking-wider"`




**D3 · HIGH · Colour** — Eight of nine status colours and two of four priority colours are invisible on the light orange page  
law: Von Restorff Effect

- Problem: dashboardTaskModel.js:12-13 asserts the RABBIT status palette 'read correctly on WILSON's light pages too'. Measured against #f4a261 that claim is false. #fb923c (in_progress) is 1.09:1. #a8a29e (waiting_to_start, the DEFAULT status) is 1.42:1, so the 8px StatusDot for the most common status on the screen is effectively not drawn. #ef4444 (blocked) is 1.83:1, #57534e (omitted) 3.70:1, and #fbbf24, #fcd34d, #4ade80, #22c55e and #e879f9 all land under 2:1. priorityColor('low') is #78716c at 2.33:1 and the default is #a8a29e at 1.42:1, and unlike the dot these are TEXT, rendered at 12px weight 700. This is exactly the grey-on-orange defect Audrey named, reintroduced through a colour function rather than a class.

- Change: Split the palette by surface. Keep the existing values as the DARK set (they are correct on the #1c1917 kanban and gallery cards). Add a LIGHT set of the same nine semantics darkened to 4.5:1 or better on #f4a261, and have statusColor/priorityColor take an `onLight` argument the same way RolePill already takes `onDark`. On the light table, stop encoding priority with colour alone: render it as an 11px label with a dark ink and reserve colour for the urgent and high cases only.

- Evidence: `src/components/Dashboard/dashboardTaskModel.js:12` — `// Status accent colors are the same semantic set // RABBIT uses — they read correctly on WILSON's light pages too.`<br>`src/components/Dashboard/dashboardTaskModel.js:59` — `default:                return '#a8a29e' // waiting_to_start`<br>`src/components/Dashboard/DashboardTasksView.jsx:96` — `style={{ color: priorityColor(value), border: 'none', fontWeight: 700 }}`




**D4 · HIGH · Colour** — Every error and success message on this surface fails the orange rule

- Problem: The task error strip and the note error strip paint #dc2626 on rgba(220,38,38,0.1) over #f4a261. That composites to (242,150,91) and measures 2.14:1 at 12px. The note load-failure message is #dc2626 on the translucent white panel at 3.27:1. The 'Saved' state is #15803d directly on #f4a261 at 2.41:1, at 10px weight 700. The delete-note button ships a third red, #ef4444, next to the other two. Three semantic states, four hex values, none of them legible on the page they sit on.

- Change: One danger ink and one success ink per surface, both dark enough to pass on #f4a261. The auth kit already measured a usable red: #7f1d1d at 4.86:1 (visual-language.md). Use it for all three red sites (DashboardTasksView 341, NotesView 211, 633, 711) and retire #ef4444 from NotesView:595 in favour of the same value. For success, darken #15803d until it clears 4.5:1 on #f4a261, or drop the colour entirely and let the 'Saved' word carry the meaning with weight.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:341` — `style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}`<br>`src/components/Dashboard/NotesView.jsx:633` — `color: saveState === 'error' ? '#dc2626' : saveState === 'saved' ? '#15803d' : L.muted,`<br>`src/components/Dashboard/NotesView.jsx:595` — `style={{ backgroundColor: L.chipBg, color: '#ef4444' }}`




**D5 · HIGH · Colour** — The Live presence pill is orange text on an orange tint at 1.81:1

- Problem: #ea580c on rgba(251,146,60,0.18) over #f4a261 composites to (245,159,90) and measures 1.81:1, at 9px weight 700 with letterspacing. It is the smallest text on the surface and the lowest contrast. It also introduces a fourth orange (#fb923c) as its border for no reason a screen of an existing ink could not serve.

- Change: Make it black on LIGHT_WELL with a LIGHT_RULE hairline, at the 11px Label step. The pill loses its colour and keeps its job: it is a status marker, not a call to action. Retire #fb923c from this file.

- Evidence: `src/components/Dashboard/DashboardPage.jsx:129` — `style={{ backgroundColor: 'rgba(251, 146, 60, 0.18)', color: '#ea580c', border: '1px solid #fb923c' }}`




**D6 · HIGH · Hierarchy** — The task table has no hierarchy at all: eight columns, one ink, one size, one face  
law: Selective Attention

- Problem: Task, Project, Asset, Start and Due are all 12px mono #1c1917. The code even implies a distinction that does not render: Task and Due use L.text while Project, Asset and Start use LIGHT_INK, and both constants resolve to #1c1917. So a row's subject, its parent project, its asset and two dates are typographically identical and the eye has nothing to grab. This is the concrete mechanism behind 'files database looks atrocious' applied to this table.

- Change: Three levels. Task title at 13px weight 600 in the full ink. Project and Asset at 13px weight 400 in the full ink. Start, Due, Role at 12px weight 400. Right-align both date columns with tabular figures and give Due the weight, not Start, since Due is what the default sort is on. Delete the L.text/LIGHT_INK duplication and use one token.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:534` — `<td className="px-3 py-2 text-xs font-mono" style={{ color: L.text }}>{task.title}</td> <td className="px-3 py-2 text-xs font-mono" style={{ color: LIGHT_INK }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:545` — `<td className="px-3 py-2 text-xs font-mono" style={{ color: L.text }}>{fmtDate(task.end_date)}</td>`<br>`src/components/Dashboard/DashboardTasksView.jsx:34` — `text:        '#1c1917',   label:       LIGHT_INK,`




**D7 · HIGH · Density** — Every table row draws two native select carets, so the table reads as a form  
law: Law of Prägnanz

- Problem: StatusSelect and PrioritySelect are bare <select> elements with bg-transparent and border:none, but nothing sets appearance:none anywhere in this file or in index.css. Chromium therefore paints its native dropdown arrow in the Status and Priority cell of every row, permanently. At thirty tasks that is sixty caret glyphs competing with the data. It is the single biggest reason this table looks busier than Frame.io's.

- Change: Add appearance:none to both selects and reveal a 12px chevron on row hover and on focus-within only. The control behaves identically; it stops advertising itself when nobody is pointing at it. Apply the same treatment to the HoverActions pattern the system review proposes.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:79` — `className="text-xs font-mono bg-transparent focus:outline-none cursor-pointer"         style={{ color: L.text, border: 'none' }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:95` — `className="text-xs font-mono bg-transparent focus:outline-none cursor-pointer"`




**D8 · HIGH · Job** — The loading state renders nine empty labelled bands, and it is the default view  
**constraint: touches-interaction** · law: Doherty Threshold

- Problem: The empty branch is gated on `processed.length === 0 && !mt.loading`, so while loading is true the table renders instead. Default groupBy is 'status', and groupTasks keeps every empty status group (dashboardTaskModel.js:185), so the first thing a person sees on opening the Dashboard is a header row plus nine group bands reading 'waiting to start 0', 'in progress 0' and so on. The only progress signal is a 14px spinner at the far right of the toolbar, roughly 900px from where the eye is. After loading, a person with four tasks in two statuses still sees seven empty bands.

- Change: Two changes. First, add skeleton rows: five 36px rows with a shimmering ink-at-8-percent block in each cell, shown while mt.loading and processed is empty, so loading and empty stop looking the same. Second, drop the well fill and the count chip on empty status bands so they recede to a hairline and a label instead of reading as content.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:347` — `{processed.length === 0 && !mt.loading ? (`<br>`src/components/Dashboard/dashboardTaskModel.js:185` — `.filter(g => g.tasks.length > 0 || groupBy === 'status' || groupBy === 'priority')`<br>`src/components/Dashboard/DashboardTasksView.jsx:327` — `<RefreshCw className={'w-3.5 h-3.5 ${mt.loading ? 'animate-spin' : ''}'} />`




**D9 · HIGH · Typography** — The note body runs at about 106 characters per line

- Problem: The editor pane is flex-1 inside a 1240px page with 32px gutters, minus the 300px list and a 16px gap, minus 16px of its own px-4: roughly 828px of text column. At 13px monospace the advance width is about 7.8px, giving about 106 characters per line against a 60 to 66 target and a 75 maximum. Combined with the mono face (D1) the note body is the least readable long-form text in the app, on the one screen whose entire purpose is long-form text.

- Change: Cap the ProseMirror measure at 66ch and centre the column in the pane. At the app's 14px sans that is about 620px, leaving the extra width as margin rather than line length. Set leading to 1.5 at 14px.

- Evidence: `src/components/Dashboard/NotesView.jsx:675` — `.wilson-note-editor .ProseMirror {           outline: none;           min-height: 320px; font-size: 13px; line-height: 1.65;`<br>`src/components/Dashboard/NotesView.jsx:703` — `className="wilson-note-editor flex-1 overflow-y-auto rounded-sm px-4 py-3"`




**D10 · HIGH · Typography** — The note editor rewrites the user's own Heading 1 in uppercase

- Problem: A person types a heading in their private notebook and the editor transforms it to uppercase with negative tracking. This is the app's system-label treatment applied to user-authored content. It is not a style choice on a chrome element; it changes what the person wrote back at them, and there is no way to opt out.

- Change: Delete text-transform:uppercase and letter-spacing:-0.01em from the H1 rule. Set H1 to 20px weight 600 sentence case and H2 to 16px weight 600, matching the app scale so a note heading looks like every other heading in WILSON.

- Evidence: `src/components/Dashboard/NotesView.jsx:681` — `font-size: 20px; font-weight: 700; letter-spacing: -0.01em;           margin: 0.6em 0 0.3em; text-transform: uppercase;`




**D11 · HIGH · System** — Two primary-button treatments inside one page, one tab apart  
law: Law of Similarity

- Problem: On the Notes tab the primary action 'New note' is an orange #ea580c fill with white text. On the Profile tab the primary action 'Save profile' is a #1c1917 fill with #f4a261 text. Both are the one primary action of their sub-view, both are reached by a single click on the same tab bar, and they share no visual property. The dark-chip form also appears on this surface as the SECONDARY treatment (sort direction, refresh, filter, manage subjects), so the same object means 'primary' on one tab and 'secondary' on another.

- Change: One Button component, variants primary / secondary / ghost / danger. Primary is the signal fill with white text at 36px. Secondary is a hairline with no fill at 28px. Convert NotesView.jsx:157 and ProfileSection.jsx:428 to primary, and DashboardTasksView.jsx:298, 310, 325 and NotesView.jsx:201, 366 to secondary. The dark #1c1917 chip disappears from the light surface entirely.

- Evidence: `src/components/Dashboard/NotesView.jsx:158` — `style={{ backgroundColor: L.primary, color: L.primaryText }}`<br>`src/components/settings/ProfileSection.jsx:429` — `style={{ backgroundColor: '#1c1917', color: '#f4a261' }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:298` — `style={{ backgroundColor: L.chipBg, color: L.chipText }}`




**D12 · MEDIUM · Colour** — The Notes tab reintroduces the white card on orange that was removed from the Rate Card  
law: Law of Common Region

- Problem: L.surface is rgba(255,255,255,0.45), which composites over #f4a261 to (249,204,168), a near-white warm panel. It is used for every unselected note row, the SubjectManager panel and the whole editor surface, so most of the Notes tab is a field of pale cards on an orange ground. lightSurface.js records Audrey's verdict on exactly this move ('NO WHITE BACKGROUND') and already exports the replacement, LIGHT_SURFACE_SOLID #dd9155, which nothing in this file imports. visual-language.md blesses `bg-white/40` as the card pattern, so the documentation is also wrong here and should change with the code.

- Change: Editor surface and SubjectManager panel take LIGHT_WELL with a LIGHT_RULE hairline. Note rows take no fill at all and are separated by hairlines, which is the same Common Region without a card. Delete L.surface.

- Evidence: `src/components/Dashboard/NotesView.jsx:46` — `surface:     'rgba(255, 255, 255, 0.45)',`<br>`src/components/lightSurface.js:69` — `// Audrey, 2026-08-10, on the Rate Card: "NO WHITE BACKGROUND." The panels // there were #fef3e8 / #fff7ed / #fff — near-white cards dropped onto the // orange `<br>`src/components/Dashboard/NotesView.jsx:704` — `style={{ backgroundColor: L.surface, border: '1px solid ${L.border}' }}`




**D13 · MEDIUM · System** — The Dashboard is the one light table that does not use the shared table tokens

- Problem: lightSurface.js exports LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW, LIGHT_TABLE_HEAD_CELL and LIGHT_TABLE_ROW_DIVIDER precisely so that the light tables stop drifting. TeamMembersPage, UsersSection and LogsSection all import them. DashboardTasksView imports only LIGHT_INK, LIGHT_RULE and LIGHT_WELL and re-inlines the equivalents by hand, and its ThLight is the fifth hand-written copy of that component in the repo. It has already diverged: it is the only one that takes a width prop and the only one that does not carry LIGHT_TABLE_HEAD_CELL's fontWeight.

- Change: Replace the local implementation with the shared Table / Th / Td components the system review specifies, and carry the width prop across as a column-spec field. This finding is free once that component exists, and it is the cheapest way to make this table and the Team Members table look like one product.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:446` — `function ThLight({ children, width }) {   return (     <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left"`<br>`src/components/TeamMembers/TeamMembersPage.jsx:923` — `<th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={LIGHT_TABLE_HEAD_CELL}>`<br>`src/components/Dashboard/DashboardTasksView.jsx:459` — `<div className="overflow-auto flex-1 rounded-sm" style={{ border: '1px solid ${L.border}' }}>`




**D14 · MEDIUM · System** — Three light-page tab bars, three specifications, and the Dashboard's borrows the wrong orange  
law: Law of Uniform Connectedness

- Problem: DashboardPage.jsx says in its header comment that it follows the SettingsPage tab-bar pattern. It copies the active fill and the underline exactly, then changes the size from 12px to 11px, the tracking from widest to wider and the padding from px-5 py-2 to px-4 py-2. RateCardPage is a third variant at px-3 py-1 in mono. All three use a #f97316 underline while the bar directly above them is #ea580c, so two different oranges sit 8px apart vertically. None of the three draws a rule across the full tab row, so the underline marks an isolated chip rather than an active tab in a set.

- Change: One Tabs component: 14px sentence case, weight 400 inactive and 600 active, a 2px #ea580c underline on the active tab, a full-width LIGHT_RULE hairline under the whole row, no fill on any tab. Apply to DashboardPage.jsx:44, SettingsPage.jsx:337 and RateCardPage.jsx:237, 254.

- Evidence: `src/components/Dashboard/DashboardPage.jsx:44` — `className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-t-sm transition-colors"`<br>`src/components/SettingsPage.jsx:337` — `className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-t-sm transition-colors"`<br>`src/components/RateCard/RateCardPage.jsx:237` — `className="px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider rounded-t-sm transition-colors"`




**D15 · MEDIUM · Density** — The task toolbar has at least four control heights in one items-center row  
law: Fitts's Law

- Problem: Measured from padding plus content: the view-toggle buttons resolve to about 28px, the sort-direction and refresh chips to about 26px, the filter button to about 28px, and the search input and the two selects to about 31px because their height comes from the browser's intrinsic control sizing. Nothing in the row shares a top or bottom edge, so the strip reads as ragged even before anyone reads a word of it. The row is also flex-wrap, so at narrow widths the count and the refresh button drop onto a second line with no defined gutter.

- Change: Every child of the toolbar gets an explicit 28px height and 0 vertical padding, with the label centred by line-height. Set the toolbar itself to a fixed 44px and remove flex-wrap; if the content cannot fit, the search field flexes rather than the row wrapping.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:237` — `<div className="flex items-center gap-2 flex-wrap pb-3">`<br>`src/components/Dashboard/DashboardTasksView.jsx:250` — `className="px-2.5 py-1.5 transition-colors"`<br>`src/components/Dashboard/DashboardTasksView.jsx:324` — `className="p-1.5 rounded-sm transition-colors hover:opacity-80"`




**D16 · MEDIUM · System** — One input class produces two heights via an important-override

- Problem: inputClass is px-3 py-2 (about 31px). Three call sites in the Notes list append `!py-1` to force about 24px, while the same class in the editor metadata row 400 lines later keeps the full height. So the sort select in the list and the subject select in the editor are the same component at two sizes with no name for either size, and the difference is expressed as a Tailwind importance escape hatch.

- Change: Two named sizes on the shared Input/Select component: sm at 28px and md at 36px. Replace `${inputClass} !py-1` at NotesView.jsx:167, 177, 188, 317, 359 with size="sm" and the bare inputClass at 567, 574, 588 with size="md".

- Evidence: `src/components/Dashboard/NotesView.jsx:49` — `const inputClass = 'px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500'`<br>`src/components/Dashboard/NotesView.jsx:167` — `className={'${inputClass} !py-1'}`<br>`src/components/Dashboard/NotesView.jsx:574` — `className={inputClass}`




**D17 · MEDIUM · Hierarchy** — The gallery card's dominant element is a letter that carries no information  
law: Von Restorff Effect

- Problem: Each card is topped by an 80px band containing the first letter of the task title at 24px weight 700, and the full title is printed in 12px directly below it. The loudest object on every card is a redundant restatement of the quietest. Von Restorff is running in reverse: the thing that stands out is the thing that matters least.

- Change: Delete the letter. Put the status word in that band at the 14px step in the status ink, or remove the band entirely and let the card be title, project, role and date with a 3px status edge. If a visual anchor is genuinely wanted for scanning, use the 3px priority edge that already exists and give the band back to content.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:665` — `<span className="text-2xl font-bold" style={{ color: statusColor(task.status), opacity: 0.85 }}>   {(task.title || '?').trim().charAt(0).toUpperCase()}</span>`<br>`src/components/Dashboard/DashboardTasksView.jsx:676` — `<div className="text-xs font-mono font-bold leading-snug" style={{ color: L.chipText }}>   {task.title}</div>`




**D18 · MEDIUM · System** — The same 3px accent edge encodes status in one view and priority in the other, at opposite edges  
law: Law of Uniform Connectedness

- Problem: The kanban card carries a 3px status bar along its top. The gallery card carries a 3px priority bar along its bottom. Same device, same thickness, two meanings, two positions, on two views of the same data one toggle apart. A person who learns the kanban code has to unlearn it to read the gallery.

- Change: One meaning per device. Status takes the 3px edge in both views, at the top. Priority moves to the 11px Label chip that the kanban card already uses for it, and the gallery card adopts the same chip.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:627` — `<div style={{ height: 3, backgroundColor: statusColor(task.status) }} />`<br>`src/components/Dashboard/DashboardTasksView.jsx:690` — `<div style={{ height: 3, backgroundColor: priorityColor(task.priority), marginTop: 'auto' }} />`




**D19 · MEDIUM · System** — Two error components, one surface, and one of them cannot be dismissed  
**constraint: touches-interaction**

- Problem: The tasks error is a red strip with no icon and no dismiss. The notes error is the same strip with a dismiss X bolted into a flex row. They sit one tab apart, they carry the same kind of message, and they are written twice.

- Change: One inline Alert component with variants and an optional onDismiss, used at DashboardTasksView.jsx:340 and NotesView.jsx:209. Give both the dismiss, since the tasks error currently persists until the next successful reload with no way for a person to clear it.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:341` — `<div className="text-xs font-mono mb-2 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>`<br>`src/components/Dashboard/NotesView.jsx:210` — `<div className="text-xs font-mono mb-2 px-3 py-2 rounded-sm flex items-start justify-between gap-2"`




**D20 · MEDIUM · System** — Two empty-state shapes and two loading-state shapes on one surface

- Problem: The cloud-gate empty states have an icon, a 14px uppercase tracking-widest title and a 12px body. The list empty states have an icon and a single 12px mono italic line with no title and no action. The 'no note selected' state has a 32px icon and one italic line. The 'Loading…' state is a bare italic span with no icon and no layout. Four related states, four compositions.

- Change: One EmptyState component: 24px icon, 14px sentence-case title, 13px body, optional action slot. Apply at DashboardTasksView.jsx:219, 348 and NotesView.jsx:136, 219, 280. Move 'Loading…' out of EmptyState entirely and into the Loading component from D8 so absence and delay stop looking identical.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:222` — `<div className="text-sm font-bold uppercase tracking-widest" style={{ color: L.label }}>   Dashboard needs the cloud</div>`<br>`src/components/Dashboard/DashboardTasksView.jsx:350` — `<div className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>`<br>`src/components/Dashboard/NotesView.jsx:726` — `<span className="text-xs font-mono italic" style={{ color: L.muted }}>Loading…</span>`




**D21 · MEDIUM · Flow** — Note rows are clickable with no hover affordance, and the dead transition class proves it was intended  
law: Doherty Threshold

- Problem: The note row button carries transition-colors and no hover rule at all, so the transition animates nothing and the row gives no feedback until it is clicked. Selecting it then swaps the surface from near-white to near-black and removes its 1px border, so the selected row's text shifts by a pixel and the row changes surface class rather than state.

- Change: Add a hover fill at ink 4 percent. Change the selected state from a surface swap to LIGHT_WELL plus a 2px #ea580c left border, keeping the ink and the border constant so nothing moves. That also removes the need for the #a8a29e branches at lines 252 and 258, which exist only because the selected row becomes a dark surface.

- Evidence: `src/components/Dashboard/NotesView.jsx:239` — `className="text-left rounded-sm px-3 py-2 transition-colors"`<br>`src/components/Dashboard/NotesView.jsx:240` — `style={selectedId === n.id   ? { backgroundColor: L.chipBg, color: L.chipText }   : { backgroundColor: L.surface, color: L.text, border: '1px solid ${L.border}'`




**D22 · MEDIUM · System** — Three visually identical toolbar chips, one with a hover state  
law: Law of Similarity

- Problem: The sort-direction chip, the filter chip and the refresh chip are the same dark #1c1917 square with #f4a261 content. Refresh has hover:opacity-80; the other two have transition-colors with no hover rule, so nothing happens. Three identical objects, two of them inert on hover, which trains the eye that the treatment does not mean 'interactive'.

- Change: One IconButton component with one hover fill and one focus ring, applied to all three plus the filter remove button at line 423 and the manage-subjects toggle at NotesView.jsx:198.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:297` — `className="p-1.5 rounded-sm transition-colors"           style={{ backgroundColor: L.chipBg, color: L.chipText }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:324` — `className="p-1.5 rounded-sm transition-colors hover:opacity-80"`




**D23 · MEDIUM · Typography** — Twenty-two uppercase, letterspaced, bold elements on one surface, at six different sizes  
law: Von Restorff Effect

- Problem: Tab labels, the Live pill, toolbar field labels, the filter button, table headers, group headers, kanban column headers, role pills, priority labels, gallery status badges, note group headers, note subject chips, the save-state word, the Apply and Cancel buttons and the Retry button are all the same typographic object: 9 to 11px, weight 700, uppercase, letterspaced. A heading, a control, a data label and a status indicator are indistinguishable, so the surface reads as a flat field of small caps that has to be read rather than scanned.

- Change: Uppercase survives in exactly one role on this surface: the 11px Label step, used for table headers, field labels and status badges. Everything else becomes sentence case at its scale step: tab labels 14px, group headers 13px weight 600, buttons 14px weight 600 with no tracking, the save state 12px sentence case.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:52` — `const labelClass = 'text-[11px] font-bold uppercase tracking-wider'`<br>`src/components/Dashboard/DashboardTasksView.jsx:636` — `<span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: priorityColor(task.priority) }}>`<br>`src/components/Dashboard/NotesView.jsx:658` — `className="px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"`




**D24 · MEDIUM · Density** — The note editor's seven format buttons are one undifferentiated run at Miller's limit  
law: Miller's Law

- Problem: Heading 1, Heading 2, Bold, Underline, Bullet list, Add link and Remove link are seven identical 26px dark squares in a gap-1 row with no grouping. They are four semantic clusters presented as one. Remove link is also given the same weight as the six constructive actions, so a destructive-ish control sits inside the formatting run.

- Change: Three groups separated by 16px: block level (H1, H2, list), inline marks (bold, underline), link (add, remove). Give Remove link the ghost variant so it recedes. No behaviour changes; this is proximity and weight only.

- Evidence: `src/components/Dashboard/NotesView.jsx:602` — `<div className="flex items-center gap-1 pb-2">`<br>`src/components/Dashboard/NotesView.jsx:627` — `<button type="button" title="Remove link" style={tbBtn(false)}           className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().unsetLink().run()}>`




**D25 · MEDIUM · Colour** — Twenty-six distinct colour values on a surface that needs about eight

- Problem: Twenty in the three JSX files and six more reaching in through statusColor and priorityColor. Within that set the same semantic is written more than once: four oranges (#ea580c, #f97316, #fb923c, #f4a261), three reds (#dc2626, #ef4444, plus the rgba tint), four greys on the dark cards (#a8a29e, #78716c, #57534e, #44403c), and two brown wells at 0.55, 0.18 and 0.10 alpha.

- Change: Reduce to signal #ea580c, ink #1c1917, rule LIGHT_RULE, well LIGHT_WELL, solid LIGHT_SURFACE_SOLID, one danger, one success, plus the status set from D3 as a semantic scale. Every remaining value must justify itself against a screen of an existing ink.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:42` — `inputBg:     'rgba(120, 70, 30, 0.55)',   inputText:   '#fde8d0',`<br>`src/components/Dashboard/DashboardTasksView.jsx:513` — `style={{ backgroundColor: dragOver ? 'rgba(234, 88, 12, 0.12)' : 'rgba(120, 70, 30, 0.10)' }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:625` — `style={{ backgroundColor: L.chipBg, border: '1px solid #44403c' }}`




**D26 · MEDIUM · Colour** — Every input on this surface is pale text on a brown well at 3.38:1  
**constraint: palette-decision**

- Problem: L.inputBg rgba(120,70,30,0.55) with L.inputText #fde8d0 appears on the search field, both toolbar selects, all three filter selects, the note title input, the subject select, the date input, the new-subject input, the rename input, the link URL input, the subject chip and the avatar fallback initials. lightSurface.js measured this pairing at 3.38:1 and deliberately refused to export it, recording it in docs/OUTSTANDING.md instead. The Dashboard is the surface where it appears most often, and the RolePill 'Reviewing' variant renders it at 10px weight 700, which is its worst instance.

- Change: This is the one finding on this surface that needs a decision the system review flags rather than a local fix: the well and its ink are app-wide. The cheap correct answer is ink #1c1917 on LIGHT_WELL rgba(120,70,30,0.18), which the module already exports and which measures 6.91:1. Change the Dashboard's inputs to that pairing and let the same change land on Settings and Team Members in the same session so the two do not diverge.

- Evidence: `src/components/lightSurface.js:52` — `// going to live here, and the contrast test refused it: black on that well // measures 4.32:1, just under AA — and the pale '#fde8d0' it is actually // paired `<br>`src/components/Dashboard/DashboardTasksView.jsx:119` — `: { backgroundColor: L.inputBg, color: L.inputText }}`<br>`src/components/Dashboard/NotesView.jsx:248` — `style={{ backgroundColor: L.inputBg, color: L.inputText }}>`




**D27 · MEDIUM · Hierarchy** — The Notes tab has no title and the editor's title input is styled as a form field  
law: Selective Attention

- Problem: The note title, which is the single most important string in the view, is an input with the same brown well, the same 12px mono and the same height as the subject dropdown and the date picker beside it. Nothing on the Notes tab reads as a heading. The result is that the person's own note has no visible name until they read the third control in a row of four.

- Change: Make the title a borderless, fill-less input at the 20px step, weight 600, sitting on the page ground with a hairline underline on focus only. Drop subject and date to the 12px caption step underneath it. That gives the Notes tab the one dominant element it currently lacks without adding a component.

- Evidence: `src/components/Dashboard/NotesView.jsx:567` — `className={'${inputClass} flex-1 min-w-40 font-bold'}           style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}`




**D28 · LOW · Motion** — Two easing curves, one hand-written transition, and no reduced-motion handling on the spinner

- Problem: Every interactive transition on this surface is Tailwind's transition-colors, which uses cubic-bezier(0.4,0,0.2,1) at 150ms and sits correctly inside the interactive band. The single exception is the kanban column's hand-written 200ms ease, which is the only place a different curve appears. Separately the refresh spinner is the only continuous motion on the surface and it is not covered by a prefers-reduced-motion rule, so it keeps rotating for a person who has asked for stillness.

- Change: Replace the kanban column's inline transition with the same 150ms token. Add the spinner to index.css's existing prefers-reduced-motion block so it resolves to a static state rather than a slower rotation.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:594` — `transition: 'background-color 200ms ease, box-shadow 200ms ease',`<br>`src/components/Dashboard/DashboardTasksView.jsx:327` — `<RefreshCw className={'w-3.5 h-3.5 ${mt.loading ? 'animate-spin' : ''}'} />`




**D29 · LOW · Build** — The note editor injects a style tag that is torn down and rebuilt on every note switch

- Problem: NoteEditor is keyed by note.id, so the whole component including its 30-line inline style element unmounts and remounts each time a different note is selected. The same CSS rules are removed from and reinserted into the document on every click in the list. It also means the note body's typeface, size, measure and heading rules live inside a component rather than in the stylesheet, which is why D1, D9 and D10 all have to be fixed in the same place.

- Change: Move the .wilson-note-editor rules into index.css. No behaviour changes and the per-switch DOM write disappears. This is also the prerequisite for the measure cap in D9.

- Evidence: `src/components/Dashboard/NotesView.jsx:671` — `<style>{'         .wilson-note-editor .ProseMirror {`<br>`src/components/Dashboard/NotesView.jsx:273` — `<NoteEditor             key={selected.id}`




**D30 · LOW · System** — Both destructive confirmations use the native window.confirm dialog  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: Deleting a task and deleting a note both raise the Electron system dialog, which carries none of the app's type, colour or chrome and which is the single most off-brand surface reachable from the Dashboard. The app already owns a better one: binUi's Modal has a modal stack, topmost-only Escape, a busy lock and in-footer errors.

- Change: Swap both to the Dialog component the system review promotes from binUi. The flow is unchanged: a confirm with two choices, the same copy, the same return semantics (the task path already depends on a false return keeping the popup open, so preserve that contract).

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:207` — `if (!window.confirm('Delete this task? (30-day trash, admins can restore)')) {           return false         }`<br>`src/components/Dashboard/NotesView.jsx:127` — `if (!window.confirm('Delete this note permanently? Notes have no trash.')) return`




**D31 · LOW · System** — The only modal this surface opens is a dark panel with a 2px bright-orange frame and a heavy shadow

- Problem: TaskDetailPopup is the destination of every row click on the tasks table, and it is RABBIT's component rendered unchanged over a light orange page. It carries a 2px #f97316 border, a #292524 fill and a 0 20px 60px shadow, three treatments that appear nowhere else on the Dashboard and that the visual language document says the app does not use. The Dashboard inherits the inconsistency without owning it.

- Change: Fold TaskDetailPopup into the shared Dialog contract when that component lands: one backdrop, one surface, a 1px hairline, 8px radius, one shadow. Because RABBIT renders the same component, this has to be scheduled with the RABBIT pass rather than inside the Dashboard session.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:177` — `style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '85vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)`




**D32 · LOW · Density** — Three panel widths and three container treatments for one dataset

- Problem: The notes list is 300px, kanban columns are 270px and gallery cards are minmax(220px, 1fr). None comes from a scale. The three task views also disagree on their container: the table has a border frame, each kanban column has its own border, and the gallery has no frame at all, so switching views changes not only the layout but whether the content appears to sit inside anything.

- Change: Take widths from the 200 / 240 / 300 tokens: notes list 300, kanban column 240, gallery minmax(240px, 1fr). Give all three views the same frame treatment, which after D12 means a hairline and no fill in every case.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:590` — `width: 270,`<br>`src/components/Dashboard/DashboardTasksView.jsx:653` — `style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}`<br>`src/components/Dashboard/NotesView.jsx:152` — `<div className="flex flex-col flex-shrink-0" style={{ width: 300 }}>`




**D33 · LOW · Colour** — The kanban and gallery views are dark cards on the light orange page  
**constraint: palette-decision**

- Problem: The table view is a light surface. Switching to Board or Gallery replaces it with a field of #1c1917 cards bordered #44403c, sitting on #f4a261. Two of three views of the same data belong to the app's other surface class, which is why the colour count on this surface is 26 rather than 8: the greys at lines 632, 639, 679 and 685 exist only because those cards are dark.

- Change: This depends on Audrey's ruling on the light-orange page class. Under Option A, where data pages move to the paper ground, all three views become dark and the inconsistency resolves by itself. Under Option B or C the cards must become light: LIGHT_WELL fill, LIGHT_RULE hairline, LIGHT_INK text, which also deletes the four stone greys from this surface. Do not fix this before the ruling; the fix is the opposite in each direction.

- Evidence: `src/components/Dashboard/DashboardTasksView.jsx:625` — `style={{ backgroundColor: L.chipBg, border: '1px solid #44403c' }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:632` — `<div className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>`




**D34 · LOW · System** — No shortcut bar, and the keys that do exist are undocumented  
**constraint: touches-interaction** · law: Paradox of the Active User

- Problem: Audrey named the Bins shortcut bar as the example of a pattern that exists in one place and nowhere else. The Dashboard is one of the nowhere-elses, and it does register keys: Enter and Escape in the link panel, Enter and Escape in the subject rename, Enter in the new-subject field. None is shown anywhere, so they are discoverable only by guessing. The Bins bar also puts its item count in the footer at 9px mono; the Dashboard puts the equivalent count in the toolbar at 12px mono. Same information, two places, two sizes.

- Change: Mount the shared 28px ShortcutBar at the bottom of the Notes editor showing Enter apply and Esc cancel while the link panel or a rename is open, and move the task count into a ShortcutBar at the bottom of the tasks view so it matches where Bins puts its count. Display only: register no new keys, since new shortcuts would change interactions.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `<div className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap"         style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, b`<br>`src/components/Dashboard/DashboardTasksView.jsx:317` — `<span className="text-xs font-mono" style={{ color: LIGHT_INK }}>           {processed.length} task{processed.length === 1 ? '' : 's'}</span>`<br>`src/components/Dashboard/NotesView.jsx:649` — `if (e.key === 'Enter') applyLink()               if (e.key === 'Escape') setLinkPanel(null)`




**D35 · LOW · System** — The Profile tab imports a second ink and a fourth heading treatment from Settings

- Problem: ProfileSection is shared with the Settings page, so its drift arrives on the Dashboard unchanged. Its section title is text-sm uppercase tracking-widest, a fifth heading treatment on this surface. Its body copy is text-stone-950 #0c0a09, a second ink on a page whose whole discipline is one ink. Its avatar ring is #c2410c, a fifth orange.

- Change: Fix in the Settings pass, not here, and note the dependency: any change to ProfileSection lands on two surfaces at once. Title to the 16px sentence-case step, body to LIGHT_INK, ring to the signal.

- Evidence: `src/components/settings/ProfileSection.jsx:296` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Profile</h2>       <p className="text-xs text-stone-950 mb-4 leading-relaxed">`<br>`src/components/settings/ProfileSection.jsx:309` — `style={{ border: '2px solid #c2410c' }}`





## Uniformity gaps

- **Shortcut hints** — here: Absent. The Dashboard registers Enter and Escape in three places (NotesView.jsx:312-315, 353-357, 649-652) and shows none of them. — elsewhere: BinsView.jsx:844-847 mounts a 34px footer bar with Kbd pairs for twelve keys plus a right-aligned item count; binUi.jsx:134-139 owns the Kbd. — do: Mount the shared ShortcutBar on both sub-views. Display only, no new key registrations.

- **Item count placement** — here: DashboardTasksView.jsx:317, in the toolbar at top right, 12px mono. — elsewhere: BinsView.jsx:847, in the footer bar at right, 9px mono, ml-auto. — do: One place for a count: the right end of the ShortcutBar, at the 12px caption step.

- **Light table head cell** — here: DashboardTasksView.jsx:446-455, a fifth hand-written ThLight that does not import LIGHT_TABLE_HEAD_CELL and is the only copy taking a width prop. — elsewhere: TeamMembersPage.jsx:923, UsersSection.jsx:704 and LogsSection.jsx:423 all share the same string; the first uses the shared token object. — do: One Table/Th/Td from src/ui, driven by a column spec that carries width.

- **Light table frame and row divider** — here: DashboardTasksView.jsx:459 and 532 re-inline the border values by hand. — elsewhere: lightSurface.js:77-86 exports LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW and LIGHT_TABLE_ROW_DIVIDER; TeamMembersPage.jsx:383, 386 consume them. — do: Consume the exports, or better, let the shared Table own them so no page references them at all.

- **Light-page tab bar** — here: DashboardPage.jsx:44, 11px, tracking-wider, px-4 py-2, #f97316 underline, no group rule. — elsewhere: SettingsPage.jsx:337 is 12px tracking-widest px-5 py-2; RateCardPage.jsx:237 is 12px mono px-3 py-1. All three use #f97316 under an #ea580c bar. — do: One Tabs component: 14px sentence case, #ea580c 2px underline, full-width hairline under the row.

- **Task table DOM strategy** — here: A real <table> with <thead>/<tbody>, cells at px-3 py-2, header at 10px. — elsewhere: ProjectTasksView.jsx:1005-1055 renders the same task object as nested flex divs with a sticky header at px-3.5 py-2.5 and 10.5px labels. — do: Decide once. The shared Table should own one DOM strategy so the two views of one object can ever look alike; keeping both is the reason the header padding, row padding and header size all differ today.

- **Task cell type size** — here: 12px mono for every cell (DashboardTasksView.jsx:534). — elsewhere: 11.5px mono in RABBIT (ProjectTasksView.jsx:1523, 1534, 1544), with the title at 12.5px. — do: One Dense step at 13px in both, with the title at weight 600.

- **Group header treatment** — here: 10.5px bold uppercase on a rgba(120,70,30,0.10) band, not collapsible (DashboardTasksView.jsx:513-522). — elsewhere: RABBIT uses 12.5px bold uppercase with a collapse chevron (ProjectTasksView.jsx:1309, 1332). — do: One group-header treatment at the 13px step. The collapse affordance is an interaction difference and is out of scope.

- **Status and priority colour** — here: dashboardTaskModel.js:49-71, a verbatim copy of RABBIT's switch bodies, used on a light surface it was never measured against. — elsewhere: ProjectTasksView.jsx:105-127, identical values, used on #1c1917 where they are correct. — do: One semantic status token with a light value and a dark value, consumed by both files, so the next copy cannot drift.

- **Primary button** — here: Orange fill on Notes (NotesView.jsx:158), dark chip on Profile (ProfileSection.jsx:429), dark chip as SECONDARY on Tasks (DashboardTasksView.jsx:298). — elsewhere: binUi.jsx has a Btn with real variants. — do: One Button with primary/secondary/ghost/danger, promoted from binUi.

- **Destructive confirmation** — here: window.confirm twice (DashboardTasksView.jsx:207, NotesView.jsx:127). — elsewhere: binUi's Modal with a modal stack, busy lock and in-footer errors. — do: One Dialog. Preserve the tasks path's false-return contract.

- **Content gutter** — here: 32px (DashboardPage.jsx:35, padding '2rem 2rem'). — elsewhere: The page title in the orange bar above is at 24px (App.jsx:1895, px-6). AdminTerminalPage.jsx:88 also uses 32px; OperatorApp.jsx:192 uses 32px. — do: One 24px page gutter everywhere so the title and the first content column share a left edge.


## Alignment issues

- Page title against the first content column (`src/components/Dashboard/DashboardPage.jsx:35`): The orange bar's page title sits at a 24px left inset (App.jsx:1895, px-6) while the Dashboard's tab bar and table start at 32px. The 8px offset is small enough to read as an accident rather than an indent, and it breaks the only vertical line the page has. → Set the Dashboard content padding to 24px and make that the one page gutter.

- Presence strip against the tab row (`src/components/Dashboard/DashboardPage.jsx:37`): The row is items-end and the strip carries its own pb-1, so the Live pill and the 24px avatars are hand-nudged 4px off the tab baseline. The avatars (24px) and the tabs (about 31px) share neither a top nor a bottom edge. → Set both sides to a fixed 32px height with items-center, and delete the pb-1 nudge.

- Toolbar labels against their selects (`src/components/Dashboard/DashboardTasksView.jsx:273`): 'Group' and 'Sort' are 11px uppercase labels placed inline before roughly 31px selects and vertically centred, so the label cap height sits about 3px above the select's text baseline. This is also the only place on the surface where a label precedes its value horizontally; every other label on the Dashboard and in ProfileSection is stacked above. → Either stack label over control like every other field, or drop the labels entirely and let the select's own first option carry the name ('Group: Status'). Pick one orientation for the whole app.

- Table row heights (`src/components/Dashboard/DashboardTasksView.jsx:537`): Row height is decided by whichever cell is tallest, and two cells contain unstyled <select> elements whose height is browser intrinsic. So no row height was ever designed, and the group header row at py-1.5 is a different, also undesigned, height. → Fix data rows at 36px and group header rows at 32px, with the selects set to 100 percent height and no intrinsic padding.

- Date columns (`src/components/Dashboard/DashboardTasksView.jsx:544`): Start and Due are left-aligned toLocaleDateString output, so 'Sep 3, 2026' and 'Sep 14, 2026' put their commas and years in different columns even in a monospace face. Numeric data left-aligned in a table is the tell of a table that was never laid out. → Right-align both date columns with tabular figures, or switch to a fixed-width format. Right-align is the smaller change and matches the proposed Table's align='right'.

- Column widths (`src/components/Dashboard/DashboardTasksView.jsx:460`): Five columns are fixed at 150+90+100+110+110 = 560px inside a minWidth of 900, leaving 340px to be split three ways. Task, the most important column, gets about 113px and truncates before Status, which is a dropdown with nine fixed-length options, gives up a pixel. → Task 3fr, Project 2fr, Asset 1.5fr for the flexible columns; reduce Status to 120 now that the caret is hidden (D7).

- Nested scroll contexts (`src/components/Dashboard/DashboardTasksView.jsx:459`): The table is overflow-auto with minWidth 900 inside a page that is itself overflow:auto (App.jsx:1815). Below roughly 1000px of window width the table scrolls horizontally inside a page that scrolls vertically, and the header row does not stick, so the column names leave the screen on the first scroll. → Make the thead sticky and let the table fill the available width without a minWidth, with only the Asset column collapsing.

- Vertical rhythm between stacked sections (`src/components/Dashboard/DashboardPage.jsx:37`): Tab row pb-4 (16px), toolbar pb-3 (12px), filter panel pb-3 (12px), error strip mb-2 (8px), notes list rows gap-1.5 (6px). Five gaps from four unrelated values, none of which is on a 4/8/12/16/24 scale in any consistent way. → One rhythm: 24px between major sections, 16px between a control strip and its content, 8px inside a group.

- Avatar ring weight (`src/components/Dashboard/DashboardPage.jsx:145`): The presence avatars use a 1.5px border, the only such value in the app. At 96dpi a 1.5px line renders as 1px or 2px depending on subpixel position, so five avatars in an overlapping row can visibly disagree on ring weight. → 1px, matching every other hairline on the surface.

- Selected note row text position (`src/components/Dashboard/NotesView.jsx:240`): The unselected row has a 1px border and the selected row has none. Under border-box sizing the content box grows by 1px on selection, so the title, chip and date all shift a pixel up and left at the moment of selection. → Keep the border on both states and change only its colour, or give both a transparent 1px border. Covered by the D21 selected-state change.

- Notes list vs editor control heights (`src/components/Dashboard/NotesView.jsx:167`): The sort, group and subject selects in the list are forced to about 24px with !py-1 while the subject and date selects in the editor, 400 lines later in the same view, are about 31px. Two heights for one component, visible simultaneously. → Two named sizes, sm 28px and md 36px. Covered by D16.


## Hick's Law hotspots

- Tasks toolbar at rest (DashboardTasksView.jsx:237-329): 9 visible choices → Nine interactive targets in one flat ragged strip, exposing 21 options behind them (3 view modes, 5 groupings, 7 sorts, 2 directions, 4 filter fields) before a person has read a single task. The safe fix that changes nothing about what any control does: cluster the strip into three regions with 24px between them and 8px within, separated by a LIGHT_RULE hairline. View mode and search on the left, Group / Sort / Direction / Filter in the middle, count and refresh on the right. Perceived choice drops from nine flat items to three groups at zero interaction cost. The stronger fix, which does touch interaction and is flagged as such, is to collapse Group / Sort / Direction / Filter into one 'View options' popover whose trigger chip states the current setting; every control stays reachable but it changes where they live.

- Every task table row (DashboardTasksView.jsx:537-542): 13 visible choices → Each row carries a nine-option status select and a four-option priority select, both permanently advertising themselves with a native caret. At thirty rows that is 390 latent options and 60 caret glyphs on screen at once. Hide the carets until row hover or focus-within (D7). The options stay identical and equally reachable; they stop being visible until someone points at that row.

- Filter panel, per row (DashboardTasksView.jsx:394-431): 4 visible choices → Each filter row is three selects plus a remove button, and rows are unbounded. Field offers 4, operator 2, value up to N projects. The selects are identical brown wells in a gap-1.5 run, so a person cannot tell field from operator from value without reading each one. Give the three selects fixed proportional widths (2fr / 1fr / 3fr) so the columns line up across stacked rows, and put an 11px Label above the first row only. No interaction change, and stacked filters become readable as a table rather than a pile.

- Notes left column before any note is visible (NotesView.jsx:153-205): 5 visible choices → New note, Sort (4 options), Group (3), Subject filter (N+1) and Manage subjects occupy two full rows, and the SubjectManager panel adds a third when open, so up to three control rows sit above the first note. Sort and Group are configuration a person sets once. Move them to the right of the list header at the 12px caption step as text triggers rather than filled selects, keeping New note as the only filled control. Every option remains one click away and the list starts about 60px higher.

- Note editor format toolbar (NotesView.jsx:602-631): 7 visible choices → Seven identical dark squares at Miller's limit with no grouping. Split into three proximity groups (block level, inline marks, link) separated by 16px, and give Remove link the ghost variant. Nothing moves out of reach and the run stops reading as a single undifferentiated bank of switches.

- Dashboard tab bar (DashboardPage.jsx:38-52): 3 visible choices → Three tabs is correct and needs no change. Note only that the absence of a rule across the row means the underline marks an isolated chip rather than the active member of a set; the hairline in D14 fixes the reading without touching the count.


## Type inventory

| px | Weight | Case | Tracking | Face | Role today | Where (file:line) | Should become |
|---|---|---|---|---|---|---|---|
| 24 | 700 | — | — | sans | gallery card initial | TasksView:665 | deleted (D17) |
| 20 | 700 | UPPER | -0.01em | mono | note H1 (user content) | NotesView:681 | 20 / 600 / sentence / 0 |
| 16 | 700 | — | — | mono | note H2 (user content) | NotesView:685 | 16 / 600 / sentence |
| 14 | 700 | UPPER | widest | sans | cloud-gate titles | TasksView:222, NotesView:138 | 16 / 600 / sentence (H2) |
| 13 | 400 | — | — | mono | note body | NotesView:676 | 14 / 400 / sentence / sans |
| 12 | 400 | — | — | mono | table cells, inputs, counts, errors, empty states, note previews, subject rows | TasksView:51, 317, 341, 350, 534-545; NotesView:49, 141, 221, 244, 330, 711, 726 | 13 Dense for cells and rows, 12 Caption for counts and meta, 14 Body for errors and empty text |
| 12 | 700 | — | — | mono | inline priority select | TasksView:95-96 | 13 / 400 / sentence, colour only for urgent and high |
| 11 | 700 | UPPER | wider | sans | tab labels, toolbar field labels, filter button, add-filter, New note, Apply, Cancel, Retry, avatar upload | DashboardPage:44; TasksView:52, 307, 436; NotesView:157, 658, 663, 717 | 14 / 600 / sentence for tabs and buttons; 11 Label only for field labels |
| 10.5 | 700 | UPPER | wider | sans | table and kanban group headers | TasksView:518, 604 | 13 / 600 / sentence |
| 10.5 | 400 | — | — | mono | group counts, kanban and gallery meta, note preview, subject-manager empty | TasksView:521, 607, 632, 639, 679, 685; NotesView:257, 303 | 12 Caption |
| 10 | 700 | UPPER | wider | sans | table headers, role pill, kanban priority, note group headers, subject-manager heading, save state | TasksView:449, 117, 636; NotesView:229, 299, 632 | 11 Label for headers and pills; 12 Caption sentence case for the save state |
| 10 | 700 | — | — | sans | avatar initial | DashboardPage:151 | 12 / 600 |
| 10 | 400 | — | — | mono | note date | NotesView:252 | 12 Caption |
| 9 | 700 | UPPER | wider | sans | Live pill, gallery status badge, note subject chip | DashboardPage:128; TasksView:669; NotesView:247 | 11 Label (the floor) |
| 9 | 700 | — | — | mono | presence overflow +N | DashboardPage:160 | 11 Label, mono retained (numeric) |

Ten distinct sizes, two weights (400 and 700, with 700 on 28 elements), two cases with 22 uppercase declarations, 21 tracking declarations, and 35 font-mono against 0 font-sans. Target: five steps, two weights (400 and 600), uppercase in one role only, mono on dates, counts and the +N badge alone.


## Priority order

D1 — mono to sans across the surface, including the note body. One rule, 35 sites, and it is the largest part of what Audrey means by 'not contemporary'., D2 — collapse ten type sizes to the five shared steps. Doing this first makes D6, D17, D23 and D27 mostly free., D3 — fix the status and priority colours on the light surface. The default status dot is currently invisible at 1.42:1 and this is Audrey's own written rule being broken by a colour function., D4 — one danger ink and one success ink, both legible on #f4a261. Three semantics, four hex values, none of them readable today., D5 — the Live pill at 1.81:1. One line, highest contrast gain per character changed., D26 — the input well and its pale ink at 3.38:1, on twelve controls. Flagged palette-decision because the fix is app-wide, but the Dashboard is where it hurts most., D6 — give the table three levels of hierarchy instead of one. Cheap, and it is the specific mechanism behind 'looks atrocious'., D7 — hide the native select carets until hover. Two lines, removes 60 glyphs from a 30-row table., D9 and D10 — cap the note measure at 66ch and stop uppercasing the user's own headings. Both live in the same injected style block, so do them with D29., D8 — skeleton rows for loading, and recede the empty status bands. Today the default first paint is nine empty labelled rows., D11 — one Button component. Two primary treatments one tab apart is the most visible component failure on this surface., D13 and D14 — adopt the shared Table and Tabs. These are free once the components exist and they are what makes the Dashboard, Team Members and Settings read as one product., D12 — remove the translucent white card surface, which is the defect already removed from the Rate Card., D15 and D16 — one control height per size, in the toolbar and in the inputs., D23 — uppercase drops to the Label role only., D20, D19, D22 — one EmptyState, one Alert, one IconButton., D21, D24, D27 — note row hover and selected state, format toolbar grouping, note title as a heading., D17, D18, D32 — gallery letter, accent-edge meaning, panel widths., D28, D29, D30, D31, D34, D35 — motion tokens, move the injected CSS, Dialog swap, shortcut bar, and the two cross-surface dependencies., D33 — hold until Audrey rules on the light-orange page class. The fix is the opposite under Option A than under B or C, so doing it early guarantees rework.


## Rework scope (reviewer's estimate)

Files: `src/components/Dashboard/DashboardPage.jsx`, `src/components/Dashboard/DashboardTasksView.jsx`, `src/components/Dashboard/NotesView.jsx`, `src/components/Dashboard/dashboardTaskModel.js`, `src/index.css`, `src/components/lightSurface.js`  
Approx lines: 420  
Suggested sessions: 2  
Split: Session 1: the shell and the tasks view. DashboardPage.jsx in full, DashboardTasksView.jsx in full, and the colour functions in dashboardTaskModel.js, done alongside or immediately after the shared Table, Toolbar, Button, Tabs, EmptyState, Loading and IconButton components land, since eight of this session's findings resolve by adopting them. Roughly 260 lines touched. Session 2: the notes view. NotesView.jsx in full plus the move of .wilson-note-editor into index.css. Roughly 160 lines touched, and its only shared dependencies are Button, Input and EmptyState, so it can run in parallel with session 1 if the component layer is already in place. Do not split the tasks view across sessions: the table, kanban and gallery share the L token object and the status palette, and changing one without the other two is how the three views diverged in the first place. Hold D33 (the dark cards) out of both sessions until Audrey rules on the light-orange page class.  
Risks: Five things can turn this into rework rather than a pass. FIRST, the surface depends on two components it does not own. TaskDetailPopup (RABBIT, 680 lines, dark #292524 with a 2px #f97316 frame and a heavy shadow) is the destination of every row click, and ProfileSection (Settings, 442 lines) is a whole tab. Changing either changes another surface, so both must be scheduled with their owning pass and explicitly left alone here. SECOND, statusColor and priorityColor are a verbatim copy of RABBIT's switch bodies (dashboardTaskModel.js:49-71 against ProjectTasksView.jsx:105-127). A light-surface fix that edits only the Dashboard copy leaves the app with two divergent palettes for one vocabulary; the correct shape is one semantic token with a light and a dark value consumed by both, which means the RABBIT file is touched in the same session or the two drift again. THIRD, the drag and drop is hand-rolled and its visual feedback lives in inline style branches keyed off a dragCountRef enter/leave counter (DashboardTasksView.jsx:492-513 for the table group, 572-600 for the kanban column). Restyling the row and column chrome must preserve both dragOver branches or drag feedback disappears silently, with no test to catch it. FOURTH, the note editor's entire typography is inside a <style> element that is unmounted and remounted per note because NoteEditor is keyed by note.id (NotesView.jsx:273, 671-701); the face change, the measure cap and the heading case all land there, so move it to index.css first and make the rest of the edits against the stylesheet. FIFTH, L.text and LIGHT_INK both resolve to #1c1917 across the tasks view, so a search-and-replace on either one will look correct and silently drop an intended distinction that never rendered anyway; resolve the duplication deliberately rather than mechanically. Test risk is low: dashboardTaskModel.test.js and noteSync.test.js are pure-logic and pin no class names, nothing renders these components in a test, and there is no src/ui directory yet, so the component layer arrives clean. Note also that 'dashboard' IS correctly registered in PAGE_BARS at 200/150 (pageBars.js:97), so this surface does not carry the project-files chrome bug; it does carry the 200/150 bar height, and the system review's recommended drop to 120/80 returns roughly 150px of vertical field to a view that currently shows about eight table rows.
