# Review — R.A.B.B.I.T. part 1 — shell (Rabbit.jsx, ViewTabs, ProjectContextBar), Intake wizard, Project Summary, Team, Tasks (+ TaskDetailPopup, NewTaskPopup). Repo root for all evidence paths: C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\Rabbit.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ViewTabs.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectContextBar.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\IntakeWizardView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\intake\IntakePrepare.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\intake\IntakeProgress.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\intake\IntakeReview.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ProjectSummaryView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\TeamView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ProjectTasksView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\TaskDetailPopup.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\NewTaskPopup.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectFilesTable.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\rabbitHelpContent.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (reference only, for the shortcut-bar and Btn/Kbd comparison)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (reference only, lines 827-848)`


## Job

R.A.B.B.I.T. is the project workspace: one active project, eleven views onto it under a single tab strip. Per sub-view the one primary action is: **Shell** — switch view (the tab strip is the whole job; everything else is chrome). **Intake** — Run Intake on the uploaded core files; the sub-steps are Add files (prepare), wait (run), Save to project (review). **Summary** — read the state of the project and leave for the tab that fixes what you saw; its secondary action is pick/switch project. **Team** — assign a workspace member to this project. **Tasks** — edit tasks in place; the toolbar's job is to narrow the set you are editing, and New task is the one primary. **TaskDetailPopup** — edit one task's properties; **NewTaskPopup** — create one task. Two sub-views currently have no single dominant action and that is itself the finding: Summary presents four co-equal entry points to the same project list (F09), and Tasks presents four co-equal buttons at the right end of its toolbar (Export, Phase, Key Date, New task) where only New task is primary (F14).


## What works

- The Bins footer bar (views/BinsView.jsx:844-848) is the only place in R.A.B.B.I.T. where the shell's two floating corner overlays have a surface to sit on: the comment at :840-843 says so explicitly and reserves paddingLeft:30 for the adapter dot. It is the correct pattern and the right thing to promote; the other ten views are the ones that are wrong, not this one.

- binUi.jsx is a real component layer — C tokens, Btn with three variants, IconBtn, Kbd, EmptyState, Menu, Spinner — built in exactly the idiom the rest of the tool hand-rolls. It is a working proof that this surface can be componentised without changing a single interaction, and it already covers roughly 60 percent of what Tasks and Team need.

- IntakePrepare's hanging-indent grid actually measures correctly: the label column is width 84 with gap 16 (views/intake/IntakePrepare.jsx:268) and the description and the generation grid both hang at paddingLeft 100 (:290, :306). It is the one place in the surface where a deliberate column has been set and held.

- The Escape-reverts-the-edit contract in the inline cell editors (ProjectTasksView.jsx:1906, :1323, :1397) is the best interaction in the file and is implemented identically in all of them. It needs advertising, not changing.

- ProjectFilesSection's grid collapse when the Budget block is permission-hidden (ProjectSummaryView.jsx:756) is the correct response to a gated region: one column instead of an empty half. It is the only place in the surface that handles a hidden region as a layout event rather than a hole.

- The bulk-action bar overlaying the task table header (ProjectTasksView.jsx:1009-1038) is a genuinely good move: the controls appear where the selection was made and do not push the table down.


## Findings (44)

**R01 · HIGH · System** — IntakePrepare loads a THIRD type family and it actually resolves on Windows  
law: Law of Similarity

- Problem: The system review states that nothing in WILSON loads a typeface, so every surface renders in the OS default. That is not true on this surface. IntakePrepare declares its own font stacks and applies them to every element on the screen. 'Century Gothic' ships with Microsoft Office, so on Audrey's machine this one wizard step renders in a geometric sans while the step indicator rendered 40px above it by IntakeWizardView renders in the browser fallback mono. The seam is visible inside a single view, mid-flow. It also breaks composition rule 7 (two families only) and the header comment at :5-11 documents the deviation as a feature.

- Why it matters: A type system cannot be imposed while one file opts out of it by name. This is also the single most visible inconsistency in the surface: the same wizard changes typeface between its chrome and its body.

- Change: Delete the SANS and DATA constants and every fontFamily reference in IntakePrepare (28 occurrences). Re-express the screen in the shared scale: title at H1/20 sentence case, the lede at Body/14, persona and generation labels at Dense/13, the accepted-extensions strip and the file counts at Caption/12 mono. Remove the 0.18em / 0.14em / 0.12em / 0.2em tracking values entirely; tracking exists only on the Label role.

- Evidence: `src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:55` — `const SANS = "'Century Gothic', 'Futura', 'Avenir', system-ui, -apple-system, sans-serif" const DATA = "ui-monospace, 'SF Mono', 'Cascadia Code', monospace"`<br>`src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:142` — `fontSize: 20, fontFamily: SANS, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#fb923c',`<br>`src/tools/rabbit_v0.1.0/views/IntakeWizardView.jsx:627` — `<span className="text-[10px] font-mono uppercase tracking-wider">{s.label}</span>`




**R02 · HIGH · Typography** — Twenty-one distinct type sizes on one surface, ten of them at half-pixel steps  
law: Law of Prägnanz

- Problem: Counted across the twelve files: text-[11.5px] x62, text-[11px] x53, text-[10.5px] x49, text-[10px] x39, text-[12px] x37, text-[9px] x28, text-xs x25, text-[13px] x10, text-[12.5px] x10, text-[9.5px] x8, text-[13.5px] x5, text-sm x4, text-[14px] x4, text-[8.5px] x3, text-xl x2, text-lg x1, text-[8px] x1, text-2xl x1, plus inline fontSize 11 x11, 13 x5, 12 x5, 20 x1, 14 x1. Six of those steps (8.5, 9.5, 10.5, 11.5, 12.5, 13.5) cannot render a distinct stem weight at 96dpi, so the surface pays for six type levels it does not visually get. About 79 occurrences sit at or below 10px.

- Why it matters: Twenty-one levels is not a hierarchy, it is noise. The reader cannot learn it, so every element has to be read rather than recognised, which is precisely the 'hard to read' complaint.

- Change: Collapse to the eight-step shared scale. The mapping for this surface: page/wizard titles 20; card and section titles 16; group headers, tab labels and active states 14; table cells, list rows and every inline editor 13; metadata, counts, hints and descriptions 12; table headers, field labels, status badges and the Kbd 11. Nothing below 11 ships. Delete every half-pixel value; there are 137 of them and they are a find-and-replace, not a judgement call.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1814` — `<span className="text-[13.5px] font-mono leading-snug font-medium" style={{ color: '#e7e5e4' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1335` — `className="px-1 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"`<br>`src/tools/rabbit_v0.1.0/Rabbit.jsx:365` — `className="flex items-center justify-center rounded-full text-[8px] font-mono font-bold"`




**R03 · HIGH · Typography** — 339 font-mono uses make fallback mono the UI face of the whole surface  
law: Aesthetic-Usability Effect

- Problem: Every label, heading, button, tab, chip, empty state, description, placeholder and body sentence in these twelve files is set in font-mono with no font loaded, so Windows resolves it to Consolas or Courier New. A monospace face at 10 to 12px with uppercase and letterspacing is the 2003 control-panel look Audrey is describing. There are exactly seven places in scope where mono is doing a real job: bid days, task counts, file sizes, dates, the seat count, the chunk counter and the naming preview.

- Why it matters: This is the largest single contributor to 'fonts that don't look contemporary'. Notion, Obsidian and Frame.io all set their entire chrome in one sans and reserve mono for data.

- Change: Strip font-mono from all 339 sites and reinstate it only on: ProjectSummaryView Stat/BudgetTile values and the byRole day/cost pairs, ProjectTasksView bid_days and dates and the n/N filter count, ProjectFilesTable size and created columns, IntakeProgress's chunk counter, the formatShotCode preview, and any future Kbd. Everything else goes to the sans.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1474` — `<div className="flex items-center gap-2 text-xs font-mono italic" style={{ color: '#78716c' }}>`<br>`src/tools/rabbit_v0.1.0/components/NewTaskPopup.jsx:95` — `const labelCls = 'text-[9.5px] font-mono uppercase tracking-wider mb-1 block'`




**R04 · HIGH · Typography** — 140 uppercase elements and 124 letterspaced ones flatten every role into one object  
law: Von Restorff Effect

- Problem: tracking-wider x95, tracking-widest x28, tracking-wide x1, and 140 uppercase. A tab label, a section heading, a field label, a primary button, a table header, a status pill, a group header, a count chip and a toolbar select are all the same typographic object: 10 to 12px bold uppercase tracked mono. In ProjectSummaryView alone the Card title (:1364), the SettingsSection title (:1201), the SettingsField label (:1213), the Stat label (:1415), the BudgetTile label (:1461) and the ListRow tag (:1436) are six different roles rendered in five near-identical treatments.

- Why it matters: When everything is emphasised nothing is. There is no first thing for the eye to land on in any of these views, which is the hierarchy failure underneath the readability complaint.

- Change: Uppercase survives in exactly one role on this surface: the 11px Label (table headers, field labels, status badges) with +0.06em tracking. Card titles, section titles, group headers, tab labels, button labels, empty-state copy and every description go to sentence case at zero tracking. That is roughly 120 of the 140 uppercase sites.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1364` — `<h3 className="text-[13px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1213` — `<span className="text-[9px] font-mono uppercase tracking-widest font-medium" style={{ color: '#78716c' }}>{label}</span>`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1955` — `<span className="text-[11.5px] font-mono uppercase tracking-widest" style={{ color: colors.label }}>{label}</span>`




**R05 · HIGH · Alignment** — The Tasks table header and its rows sit on three different left edges  
law: Law of Uniform Connectedness

- Problem: The header row is a bare flex with no padding, so its 36px checkbox column starts at x=0. The rows are rendered inside a container with p-3, so every ungrouped row starts 12px further right than the header column it belongs to. Grouped rows are nested one level deeper with another p-3, so they start 24px right of the header. The column widths are driven by identical flex ratios, so every column in the table is out of register with its own header by 12 or 24px, and the offset changes when you switch grouping on.

- Why it matters: This is the single most visible alignment defect in R.A.B.B.I.T. and it is exactly what Audrey means by 'make sure alignment in rows and items all make sense'. A seven-column table whose headers do not sit over their columns cannot be scanned vertically.

- Change: Give the header container the same horizontal padding as the row container (px-3), or better, remove the padding from both and let the shared Row component own its 8px/12px cell padding. Delete the nested p-3 on TaskGroup's row list so grouped and ungrouped rows share one left edge; indent the group instead with a 3px left rule on the group wrapper, not with padding on the rows.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1007` — `<div className="relative flex sticky top-0 z-10" style={{ borderBottom: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1060` — `<div className="flex flex-col gap-1 p-3">`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1280` — `<div className="flex flex-col gap-1 p-3 pt-1">`




**R06 · HIGH · Build** — The Team table's sticky header is transparent, so rows scroll through the header text

- Problem: thead carries sticky top-0 z-10 but the Th component sets only a colour and a bottom border. There is no background fill, and the table body rows paint #1c1917. On any roster longer than the viewport the member rows scroll up and render behind the header labels, which remain painted on top of them.

- Why it matters: It is a rendering bug, not a taste question, and it is on the densest screen of the view. Anyone with more than about twelve seats sees it immediately.

- Change: Give the shared Th a background of the raised paper token and a 1px bottom hairline, and set the sticky context on the header row rather than on thead. The shared Table component fixes this once for all nineteen tables in the app.

- Evidence: `src/tools/rabbit_v0.1.0/views/TeamView.jsx:528` — `<thead className="sticky top-0 z-10">   <tr style={{ borderBottom: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:1068` — `<th className="px-4 py-2.5 text-[10.5px] font-mono uppercase tracking-widest text-left" style={{ color: '#78716c', borderBottom: '1px solid #44403c' }}>`




**R07 · HIGH · System** — Five status colour maps on one surface, four of which disagree, one of which is blue  
**constraint: palette-decision** · law: Law of Similarity

- Problem: ProjectContextBar:47-51 maps wrapped to #15803d. ProjectSummaryView:309 maps wrapped to #3b82f6 and adds on_hold #f59e0b. ProjectSummaryView:659 maps active to #22c55e (not #15803d) and wrapped to #3b82f6. ProjectMiniCard:1308 maps wrapped to #15803d again. STATUS_COLORS:1386 maps active to #15803d and wrapped to #3b82f6. The same project therefore shows a different status colour in the context bar, the gallery strip and the control panel simultaneously. #3b82f6 is a blue, which breaks composition rule 2 (warm over cool) outright.

- Why it matters: A status colour that changes between two visible components on the same screen is worse than no status colour. It also means the colour carries no information the user can learn.

- Change: One StatusBadge component taking a semantic token (draft/active/on_hold/wrapped/archived) and rendering dot, fill and label from one source. Retire #3b82f6 and #22c55e; wrapped takes the success token, on_hold takes warning, archived takes ink at 48 percent, draft and active take signal and success. Delete all five inline maps.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:309` — `const stColor = st === 'active' ? '#15803d' : st === 'archived' ? '#57534e' : st === 'wrapped' ? '#3b82f6' : st === 'on_hold' ? '#f59e0b' : '#ea580c'`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1386` — `const STATUS_COLORS = { draft: '#ea580c', active: '#15803d', on_hold: '#f59e0b', wrapped: '#3b82f6', archived: '#57534e' }`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:47` — `status === 'wrapped'  ? '#15803d' :`




**R08 · HIGH · Colour** — Forty-one distinct hex values on this surface, including four cool hues  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: Measured across the twelve files: 41 distinct values. The warm core accounts for eleven of them. The rest are one-off status and accent values, and four are cool: #3b82f6 (wrapped project), #a78bfa with #4c1d95 (the reviewer role chip in TeamView), and #e879f9 (the needs_revisions task status). The statusColor ladder alone spends nine values (#fb923c, #fbbf24, #e879f9, #4ade80, #22c55e, #ef4444, #fcd34d, #57534e, #a8a29e) where four of them are within one hue step of each other: #fbbf24 pending_review and #fcd34d on_hold are indistinguishable at 11px, and #4ade80 approved and #22c55e final likewise.

- Why it matters: Nine colours the user cannot tell apart is not a legend, it is decoration. And four cool hues break the palette rule the project wrote down for itself.

- Change: Reduce the task status ladder to four semantic tokens plus neutral: in_progress = signal, pending_review + on_hold = warning, needs_revisions + blocked = danger, approved + final = success, waiting_to_start + omitted = ink at 48 percent. Carry the distinction between the paired states in the LABEL, which is already rendered beside the colour in every case. Retire #e879f9, #fcd34d, #4ade80, #a78bfa, #4c1d95 and #3b82f6.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:105` — `case 'pending_review': return '#fbbf24' case 'needs_revisions': return '#e879f9' case 'on_hold':        return '#fcd34d'`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:39` — `reviewer: { fg: '#a78bfa', bg: '#1c1917', border: '#4c1d95' },`




**R09 · HIGH · Job** — Four different project pickers, three different visual treatments, two of them on screen at once  
**constraint: touches-interaction** · law: Law of Similarity

- Problem: Picking a project is available through: the Switch dropdown in ProjectContextBar (a 240px menu of 11px rows with a dot and a caps status word), the horizontal gallery strip on Summary (180px cards on a #0c0a09 well with a 1.5px dot), the ProjectMiniCard grid inside the no-project Card (a different card with a filled status pill and a two-line description), and the New project button which appears in three of those places. On Summary with a project loaded, the gallery strip and the header card are both visible and both name the project.

- Why it matters: Four doors into one room, each drawn differently, is the clearest possible violation of Law of Similarity and it is why Summary has no dominant element. It also costs the user a decision (which picker?) at every entry.

- Change: One project picker component, used in all four places, rendering the same row: name at Dense/13, client at Caption/12, one StatusBadge. Keep the gallery strip as the Summary affordance and the dropdown as the in-flight switcher (the two contexts genuinely differ), but make them the same row inside two containers. Delete ProjectMiniCard and the duplicate no-project Card branch.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:312` — `<button key={p.id} type="button" onClick={() => setActiveProject?.(p.id)}   className="flex-shrink-0 flex flex-col gap-1.5 px-3.5 py-2.5 rounded-sm transition-a`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1306` — `function ProjectMiniCard({ project, active, onClick }) {`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:114` — `<button key={p.id} type="button" onClick={() => { setActiveProject?.(p.id); setOpen(false) }}`




**R10 · HIGH · System** — Nine distinct corner radii on one surface  
law: Law of Prägnanz

- Problem: rounded-sm x83 (2px), bare rounded x121 (4px), rounded-md x18 (6px), rounded-lg x5 (8px), rounded-full x7, plus inline borderRadius 3 (ProjectFilesTable selects), 4, 5, 6 and 10 (the settings toggle). Within one component tree: ProjectSummaryView's Card is rounded-sm, its SettingsSection is rounded-lg, its module cards are rounded-lg, its inputs are rounded-md and its mini card is rounded-sm.

- Why it matters: Radius is the cheapest signal a component system gives you. Nine of them means the user cannot infer 'this is a panel' or 'this is a control' from shape at all.

- Change: Two values, per the system proposal: 4px on controls, inputs, buttons, chips, rows, panels and cards; 8px on floating surfaces only (the seven modals and the three dropdowns). rounded-full survives on the avatar and the presence chips. That is a mechanical substitution across 234 class sites and 14 inline values.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1360` — `<div className="rounded-sm p-5" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1198` — `<div className="rounded-lg overflow-hidden" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1227` — `width: 36, height: 20, borderRadius: 10,`




**R11 · HIGH · System** — Seven hand-rolled modals in five files, three backdrop values, two border treatments, none closes on Escape  
**constraint: touches-interaction** · law: Law of Similarity

- Problem: IntakeWizardView's confirm dialog, TeamView's save-view dialog and MemberPickerModal, ProjectTasksView's save-view and phase dialogs, TaskDetailPopup and NewTaskPopup are seven independent implementations of fixed inset-0 plus a translate(-50%,-50%) card. Backdrops are rgba(0,0,0,0.6) x7, rgba(0,0,0,0.5) x7 and rgba(0,0,0,0.3) x1. Four use border: 2px solid #f97316; three use 1px solid #44403c. Five use boxShadow '0 20px 60px rgba(0,0,0,0.5)'; the dropdowns use '0 8px 24px' or Tailwind shadow-2xl. None of the seven registers an Escape handler; binUi's Modal has a topmost-only Escape stack that works.

- Why it matters: Seven modals that look like four different products is the component-layer failure in miniature. The 2px orange border is also the heaviest chrome in the app and reads as an alert on a routine create dialog.

- Change: Promote binUi's Modal to src/ui/Dialog unchanged and route all seven through it: one backdrop rgba(12,10,9,0.6), one raised surface, 8px radius, one hairline, one floating shadow, header/body/footer. Delete the 2px #f97316 frame entirely. The Escape behaviour arrives with the component; flag it to Audrey as an interaction addition rather than a change.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:177` — `style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '85vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:572` — `style={{ transform: 'translate(-50%, -50%)', backgroundColor: '#292524', border: '1px solid #44403c', padding: 24, minWidth: 300 }}`<br>`src/tools/rabbit_v0.1.0/views/IntakeWizardView.jsx:493` — `style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}`




**R12 · HIGH · System** — Team ships two entirely different interfaces for the same job depending on adapter mode  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: TeamView returns ProjectMembersPanel when adapterMode is supabase and a ten-column spreadsheet otherwise. The cloud branch is a single 672px-max centred card with 28px avatars, two-line identity rows, a role select with a description line under it, and no toolbar at all. The local branch is a full-width ten-column table with a filter engine, sort, grouping, saved views, search and a multi-select modal. Same job, same data model, no shared component, no shared type sizes. The demo runs Local Server, so the table is what Audrey sees; beta users see the card.

- Why it matters: This is the uniformity complaint in its most extreme form: the same tab is two products. It also means any styling work done on one branch silently does not apply to the other.

- Change: Unify on the table, which is the richer surface and matches the rest of R.A.B.B.I.T. Render the cloud roster through the same Table/Row/StatusBadge components with the columns the cloud data supports (avatar+name, username, title, role, remove) and mount the add-member picker in the shared Toolbar's right slot. This is a visual unification only; neither branch's data flow changes.

- Evidence: `src/tools/rabbit_v0.1.0/views/TeamView.jsx:436` — `if (cloudMode) {   return <ProjectMembersPanel ctx={ctx} /> }`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:722` — `<div className="max-w-2xl mx-auto px-6 py-6">`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:527` — `<table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}>`




**R13 · HIGH · Density** — Neither table on this surface is a table: Team floats its rows on a 2px gap, Tasks draws each row as a bordered box  
law: Law of Uniform Connectedness

- Problem: TeamView sets borderCollapse:separate with borderSpacing '0 2px' AND a 1px bottom border on every row, so rows read as detached bars with a double rule between them. ProjectTasksView renders each row as a flex div with a full 1px #44403c border, a 4px radius and a 1px gap, so a hundred-task view is a hundred outlined boxes. Neither matches ProjectFilesTable, which is a CSS grid with a single 1px divider and no per-row border.

- Why it matters: Frame.io's density comes from rows separated by a single hairline with generous cell padding. Boxes-in-a-list is the heaviest possible way to draw a table and it is the main reason the Tasks view reads as cluttered rather than dense.

- Change: One Table/Row: 36px row, 32px head, 8px/12px cell padding, one hairline divider between rows, no per-row border, no gap, no radius on rows, no zebra. Selection is a signal-tinted fill plus a 2px signal left border; hover is one fill. Keep the existing drag affordance and the drag-over inset shadow, which are state, not decoration.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1612` — `border: isSelected ? '1px solid #ea580c' : '1px solid #44403c', borderRadius: 4, backgroundColor: isSelected ? 'rgba(234, 88, 12, 0.1)' : '#1c1917',`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:527` — `<table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}>`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:321` — `<tr key={r.id} className="hover:!bg-stone-800 transition-colors" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>`




**R14 · HIGH · Alignment** — The Tasks toolbar puts nine controls on five different heights in one row  
law: Fitts's Law

- Problem: Measured from the classes: the Filter button is py-1.5 at 10.5px (about 30px), the Export button is py-1 at 10.5px (about 26px), the Phase / Key Date / New task buttons are py-1.5 at 11.5px (about 31px), the sort-direction icon button is p-1.5 around a 14px icon (26px, no border), the Sort and Group selects are py-1.5 at 10.5px with UA select metrics, and the segmented Table/Board control adds a 1px wrapper border around py-1.5 children. Nothing shares a baseline, and the row is flex-wrap so at narrow widths it breaks into two ragged lines.

- Why it matters: This is the row Audrey looks at every time she opens Tasks. Five heights in one strip is the most visible density failure on the surface and it is cheap to fix.

- Change: Shared Toolbar at 44px with a 24px gutter and a hairline bottom. Every child is exactly 28px tall: buttons sm, selects sm, the search field sm, the segmented control sm with its wrapper border sized so total height is 28. Remove flex-wrap and let the search field flex-shrink instead. Icon-only buttons get the same 28px box with a centred 14px icon.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:639` — `className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800 disabled:opacity-4`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:671` — `className="flex items-center gap-1.5 px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors"`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:561` — `className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"`




**R15 · HIGH · Flow** — The shell's two corner overlays float over content with no surface, at 8px and 8.5px type, everywhere except Bins  
**constraint: touches-interaction** · law: Law of Common Region

- Problem: AdapterStatusDot is a 10px circle pinned at left:10 bottom:18 with a coloured box-shadow glow. RealtimePresenceStrip sits at left:26 bottom:13 carrying an 8.5px uppercase tracked pill and 16px initial chips with 8px type. In Bins these land on a 34px footer bar that reserves paddingLeft:30 for them and the comment at BinsView.jsx:840 says exactly that. In the other ten views they hover over whatever the view happens to be rendering, including over table rows and over the Kanban board's horizontal scroller.

- Why it matters: This is Audrey's own named example, stated precisely: 'you added the shortcuts for the bin tool at the bottom but no where else'. The dot and the presence chips are shell furniture that got a home in one view and nowhere else. 8px type is also unreadable on any display.

- Change: Promote the Bins footer to a shell-level StatusBar at 28px, mounted by Rabbit.jsx below the view body, with a hairline top on the recessed token. Left slot: the adapter StatusDot (no glow) plus its label at Caption/12, then the presence pill at Label/11 and 18px avatar chips. Right slot: each view's own count line (the Tasks n/N, the Team seat count, the Bins file count) and, when a view registers document keys, its Kbd hints. Every view then gets the same floor.

- Evidence: `src/tools/rabbit_v0.1.0/Rabbit.jsx:293` — `left: 10, bottom: 18, width: 10, height: 10, backgroundColor: color, border: '1px solid rgba(0,0,0,0.5)', boxShadow: glow,`<br>`src/tools/rabbit_v0.1.0/Rabbit.jsx:340` — `className="text-[8.5px] font-mono uppercase tracking-wider font-bold px-1 py-px rounded-sm"`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `<div className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap"   style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgro`




**R16 · HIGH · Hierarchy** — The active tab borrows the frame's own orange as a content fill and reads as a chip, not a tab  
law: Von Restorff Effect

- Problem: The active tab sets backgroundColor #ea580c AND borderBottom 2px solid #ea580c, so the fill and the underline are the same colour and the underline is invisible against it. #ea580c is the app's top-bar colour, so a content-layer element is wearing the chrome's identity. The inactive label is #a8a29e on #1c1917 at 11px uppercase tracked, which at that size is a low-contrast smudge; the eleven-item strip reads as one orange blob and ten grey ones.

- Why it matters: The tab strip is the shell's single most important control and it is the first thing seen on entering the tool. Fill-based active states also collapse the moment the palette changes, which is what the overhaul is doing.

- Change: Drop the fill. Active = the label at 14 weight 600 in full ink plus a 2px signal underline sitting on the strip's bottom hairline. Inactive = the same 14px at weight 400 in ink at 72 percent. Sentence case, no tracking, no uppercase. The icon stays at 14px and takes the label's colour.

- Evidence: `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:51` — `className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors disabled:opacity-30"`<br>`src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:54` — `backgroundColor: active ? '#ea580c' : 'transparent', borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',`




**R18 · HIGH · Density** — TaskDetailPopup presents up to fifteen fields in one flat two-column grid with no grouping  
law: Chunking

- Problem: The properties grid holds Status, Priority, Asset, Phase, Scene, Shot, Level, Experience, Assignee, Reviewer, Role, Bid days, Bid total, Start date, End date. All fifteen are identical 12px selects on identical wells with identical 10px FieldLabels, in one gap-x-6 gap-y-4 grid with no headings, no rules and no ordering logic. Below it, Description and Notes are two further identical bordered boxes.

- Why it matters: Fifteen undifferentiated fields is far past Miller's 7±2. The user has to read every label to find the one they came for, every time, and there is no cue that Scene/Shot/Level/Experience are conditional while the rest are not.

- Change: Chunk into four labelled groups separated by a hairline and an 11px Label eyebrow, keeping every field exactly where the data model puts it: Workflow (Status, Priority), Placement (Phase, Asset, then the conditional Scene/Shot/Level/Experience), People (Assignee, Reviewer, Role), Schedule and cost (Start, End, Bid days, Bid total). No field is removed or moved to another screen; this is spacing and a heading per group.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:321` — `<div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">`<br>`src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:647` — `function FieldLabel({ children }) {   return (     <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>`




**R24 · HIGH · Typography** — ProjectFilesTable renders 9px headers and 10px cells inside a 13px page

- Problem: The dark variant sets header fontSize 9 and cell fontSize 10 with 7px/8px and 6px/8px padding, plus a nested select at fontSize 10 with borderRadius 3. It is rendered inside IntakePrepare (where the surrounding copy is 13px Century Gothic), inside Summary's Card and inside ProjectFilesSection. So the densest table in R.A.B.B.I.T. runs at two-thirds the size of the paragraph above it, in three different hosts.

- Why it matters: This is the same defect Audrey named on the Files page ('looks atrocious'), appearing three times inside R.A.B.B.I.T. 9px is unreadable and 10px is below the Apple desktop floor.

- Change: Header to Label/11, cells to Dense/13, cell padding 8px/12px, row 36px, radius 4 on the container and none on the cells. Also delete the `if (files.length === 0) return null` early return so every host stops inventing its own empty state.

- Evidence: `src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:96` — `const hdr = {   fontSize: w ? 11 : 9, fontFamily: 'ui-monospace,monospace',`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:103` — `const cell = {   fontSize: w ? 13 : 10, fontFamily: 'ui-monospace,monospace',`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:91` — `if (files.length === 0) return null`




**R17 · MEDIUM · Hierarchy** — TaskDetailPopup prints the task title twice, at the same size, weight and colour, 60px apart  
**constraint: touches-interaction** · law: Von Restorff Effect

- Problem: The modal header renders the title at 14px mono bold #fb923c. The first field in the right column is Title, whose PopupInlineText renders the same string at 14px mono bold #fb923c. Nothing distinguishes the read-only header instance from the editable field instance except position.

- Why it matters: Two identical dominant elements is no dominant element, and the user cannot tell which one they are supposed to click.

- Change: The header title becomes the dialog's H2 at 16 sentence case weight 600 in full ink and is read-only. Delete the Title field from the properties grid and make the header instance the editable one (click to edit, Escape reverts, matching every other inline editor in the tool). That also reclaims a grid row.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:184` — `<span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>   {task.title || 'Untitled task'}`<br>`src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:675` — `className="text-[14px] font-mono font-bold text-left w-full hover:bg-stone-700/40 px-2.5 py-1.5 rounded transition-colors" style={{ color: value ? '#fb923c' : '`




**R19 · MEDIUM · Hierarchy** — Four metric tiles on this surface invert label and value orientation against each other  
law: Law of Similarity

- Problem: Stat (Summary) puts the value on top and the label below. CountTile (IntakeReview) puts the value on top and the label below. BudgetTile (Summary) puts the label on top and the value below. TaskBigTile (Tasks) puts the label on top and the value below. The value sizes are also four different steps: Stat text-sm (14), CountTile 14px, BudgetTile text-xl (20), TaskBigTile text-lg (18). Two of these, Stat and BudgetTile, sit within 400px of each other on the same Summary screen.

- Why it matters: Audrey named orientation explicitly. A reader scanning a row of tiles builds an expectation from the first one; inverting it on the next block means re-reading. And four sizes for one role means the tiles fight rather than rank.

- Change: One Stat component: value first at 20 weight 600 tabular-nums, label under it at Label/11, optional hint at Caption/12. One 28px icon slot on the left, optional. Replace all four. The good/danger tone stays but expresses through the value colour only, not through the border.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1414` — `<span className="text-sm font-mono font-bold truncate" style={{ color: '#d6d3d1' }}>{value}</span> <span className="text-[10px] font-mono uppercase tracking-wid`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1461` — `<span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: '#a8a29e' }}>{label}</span> <span className="text-xl font-mono font-bold" styl`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1955` — `<span className="text-[11.5px] font-mono uppercase tracking-widest" style={{ color: colors.label }}>{label}</span> <span className="text-lg font-mono font-bold"`




**R20 · MEDIUM · System** — No numeric column on this surface uses tabular figures or right alignment  
law: Law of Uniform Connectedness

- Problem: Bid days in the Tasks table, task counts in Team, day counts and currency in the Summary byRole rows, the Bid total in the detail popup and the seat counts are all left-aligned proportional text. In the byRole list the value string ('12 d · $4,800') is a single left-aligned span, so neither the days nor the money form a column.

- Why it matters: Unaligned numerals are the fastest way to make a data table look amateur next to Frame.io, and they make comparison impossible, which is the only reason those columns exist.

- Change: align='right' plus font-variant-numeric: tabular-nums on Bid, Tasks, Bid days, Bid total, days and every currency value. Split the byRole row into two right-aligned columns (days, cost) so the decimal points line up down the list.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:605` — `<span style={{ color: '#a8a29e' }}>   {row.days} d · {fmtMoney(row.cost, budget.currency)} </span>`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1937` — `className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors disabled:cursor-not-all`




**R21 · MEDIUM · System** — Six different empty states and no loading state that is distinguishable from one  
law: Law of Similarity

- Problem: NoProjectPlaceholder (40px icon, 12px centred copy, orange button). NoProjectGate (40px icon, 11px copy, orange button, different gap). IntakePrepare's no-files box (22px icon, 12px copy, a 1px bordered well). ProjectFilesSection's no-files box (20px icon, 10px copy, a 2px DASHED orange-at-30-percent border). Summary's Empty (inline italic 12px with a 14px icon, no centring). TeamView's two (32px and 24px icons, 11.5px italic). Meanwhile the loading states are Summary's 'Loading project…' at 11px uppercase, Team's 'Loading members...' at 11.5px italic and ProjectMembersPanel's 'Loading directory…' at 10.5px italic. A loading state and an empty state are typographically the same object.

- Why it matters: 'Nothing here' and 'still fetching' must never look the same; the user cannot tell whether to wait or to act. And six empty states means the tool has no voice.

- Change: One EmptyState: 24px icon, title at 14 sentence case, body at 13, optional action slot. One separate Loading: skeleton rows for the two tables and the files table, a spinner for the rest. Never use EmptyState for a loading condition.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:220` — `<span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>   Loading project…`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1157` — `style={{ border: '2px dashed ${SECTION_ACCENT}30', backgroundColor: '#1c191780' }}>`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:959` — `<span className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>Loading members...</span>`




**R22 · MEDIUM · System** — ProjectSummaryView defines two card components and uses five card treatments  
law: Law of Common Region

- Problem: Card is rounded-sm, p-5, #292524, 1px #44403c, title 13px orange uppercase tracking-widest with a 16px icon. SettingsSection is rounded-lg, p-4, #292524, 1px #44403c, with a 3px LEFT accent border and a 12px orange uppercase title. The three module cards (Scenes, Levels, Experiences) are rounded-lg with a 3px left border on the HEADER only and an 11px title. The gallery strip is a rounded-sm well on #0c0a09. ProjectMiniCard is rounded-sm p-3 on #1c1917. Five containers, five paddings, three title sizes.

- Why it matters: One screen should not carry five ways of saying 'these things belong together'. The eye reads the differences as meaning and finds none.

- Change: One Panel: raised token surface, 1px hairline, 4px radius, 16px padding, a 32px header carrying a 16px sentence-case title and an optional icon, no accent bar and no filled title strip. The 3px left accents go; the toggle state on the module cards expresses through the toggle and an ink-at-48 title, not a border colour.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1199` — `<div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid #44403c', borderLeft: '3px solid ${color}' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:822` — `style={{ borderBottom: project.scenes_enabled ? '1px solid #44403c' : 'none', borderLeft: '3px solid ${project.scenes_enabled ? SECTION_ACCENT : '#57534e'}' }}`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1360` — `<div className="rounded-sm p-5" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>`




**R23 · MEDIUM · Hierarchy** — Summary states the project's identity three times on one scroll  
law: Selective Attention

- Problem: The gallery strip names the active project (orange title, status dot). The header Card names it again at text-2xl with status, dates, director and producer. Opening the Control Panel names it a third time at text-xl with status, type and tier in a slash-separated caps line. The ProjectContextBar, which exists precisely to hold that identity, is suppressed on Summary (Rabbit.jsx:202 renders it only when activeView !== 'summary').

- Why it matters: Three statements of the same fact at three sizes with three status treatments is why nothing on Summary reads as the first thing. Selective Attention means the user filters all three.

- Change: Keep the header Card as the single identity block: title at 20 sentence case, one StatusBadge, dates at Caption/12, director and producer at Dense/13. Reduce the gallery strip cards to name plus status dot only (drop the orange title on the active card; mark active with the signal left border the shared Row uses). Delete the identity line from the Control Panel header and let the panel title be 'Project settings'.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:356` — `<h1 className="text-2xl font-mono font-bold" style={{ color: '#d6d3d1' }}>   {project.title}`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:669` — `{project.status || 'draft'} / {project.project_type?.replace(/_/g, ' ') || 'untyped'} / {project.project_tier || 'untiered'}`<br>`src/tools/rabbit_v0.1.0/Rabbit.jsx:202` — `{activeView !== 'summary' && (   <ProjectContextBar /> )}`




**R25 · MEDIUM · Hierarchy** — The Tasks toolbar gives four buttons at its right end and only one is primary  
law: Serial Position Effect

- Problem: Export, Phase, Key Date and New task sit in one gap-2 cluster. Export is a bordered ghost at 10.5px. Phase is a bordered ghost at 11.5px in #a8a29e. Key Date is a bordered ghost at 11.5px in #f59e0b (amber, the only amber control in the toolbar). New task is the orange fill. Three of the four are outlined boxes of near-identical weight, and the amber one pulls the eye harder than it deserves because amber on dark is the highest-contrast thing in the row.

- Why it matters: Serial Position says the last item in a row is remembered; here four items compete for that position and the amber one wins by accident.

- Change: One primary (New task, md 36px, signal fill). Phase and Key Date become secondary ghosts at sm 28px in one ink; Key Date loses the amber, which belongs to milestone rows, not to the button that makes them. Export becomes an icon-only ghost with a tooltip, since it is a once-a-week action. That is four controls reduced to one primary plus three equal-weight secondaries without removing anything.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:663` — `className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors" style={{ color: `<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:634` — `onClick={handleExportCsv} disabled={processed.length === 0}`




**R26 · MEDIUM · System** — statusColor and priorityColor are duplicated verbatim in two files and will drift

- Problem: ProjectTasksView.jsx:105-127 and TaskDetailPopup.jsx:35-56 contain byte-identical copies of both functions, and TASK_STATUSES and PRIORITIES are declared three times (ProjectTasksView:48, TaskDetailPopup:29, NewTaskPopup:29). NewTaskPopup's header comment at :23-24 explicitly documents the duplication as intentional.

- Why it matters: This is the 'local tokens, not global' rule producing exactly the drift it was meant to prevent. The five status maps in R07 are the same defect one stage further along.

- Change: One taskStatus module exporting the status list, the priority list, the semantic token per status and the display label. StatusBadge consumes it. Delete all six copies.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:35` — `function statusColor(status) {   switch (status) {     case 'in_progress':    return '#fb923c'`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:105` — `function statusColor(status) {   switch (status) {     case 'in_progress':    return '#fb923c'`




**R27 · MEDIUM · Motion** — Nine box-shadow treatments in twelve files, in an app whose own spec says it uses no shadows

- Problem: '0 20px 60px rgba(0,0,0,0.5)' on five modals; '0 8px 24px rgba(0,0,0,0.5)' on the Tasks views dropdown; shadow-2xl on three other dropdowns; '0 2px 8px rgba(0,0,0,0.3)' on a hovered Kanban card; '0 0 0 1px #ea580c' as a fake ring on two card types; 'inset 3px 0 0 #ea580c' as a drag indicator; 'inset 0 0 0 2px #ea580c, 0 0 20px rgba(234,88,12,0.15)' on a drag-over column; '0 0 8px ${statusColor}60' as a glow on the control-panel status dot; and '0 0 6px rgba(...)' as a glow on the shell adapter dot. visual-language.md:212 states WILSON does not use drop shadows.

- Why it matters: Two of these are doing real work (the drag indicators). Two are duplicating a border with a spread shadow. Two are glows, which are the single most dated effect in the surface.

- Change: One floating shadow, 0 8px 24px rgba(0,0,0,0.35), applied to modals, menus and toasts only. Docked surfaces get a hairline. Replace the '0 0 0 1px' fake rings with a real 1px signal border. Delete both dot glows. Keep the two drag insets, retimed to 160ms.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:668` — `style={{ backgroundColor: statusColor, boxShadow: '0 0 8px ${statusColor}60' }}`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1727` — `boxShadow: dragOver   ? 'inset 0 0 0 2px #ea580c, 0 0 20px rgba(234, 88, 12, 0.15)'   : 'none',`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:321` — `boxShadow: isActive ? '0 0 0 1px #ea580c' : 'none',`




**R28 · MEDIUM · Flow** — The intake wizard's step indicator is three chips, not a progress indicator, and its step numbering is wrong on screen  
law: Goal-Gradient Effect

- Problem: StepIndicator renders three bordered chips with a number and a caps label, separated by a chevron glyph. Completed and pending steps are distinguished only by opacity 0.5 versus 1, and the active one is an orange fill. There is no bar, no percentage and no sense of distance. Separately, IntakeReview's own heading says 'Step 5 · Review & save breakdown' while the indicator directly above it shows step 3 of 3, and IntakeProgress's file header comment calls itself step 4.

- Why it matters: Goal-Gradient needs a visible distance to the goal, and an on-screen 'Step 5' inside a three-step wizard is a plain content defect a user will read as a bug.

- Change: Replace the chips with a 2px rule across the content width, filled to the current step in signal, with the three labels sitting under it at Label/11 (past steps in ink at 72 percent, current in full ink weight 600, future at 48 percent). Change the IntakeReview heading to 'Review and save breakdown' with no step number, since the indicator carries the position.

- Evidence: `src/tools/rabbit_v0.1.0/views/intake/IntakeReview.jsx:71` — `<h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#fb923c' }}>   Step 5 · Review & save breakdown`<br>`src/tools/rabbit_v0.1.0/views/IntakeWizardView.jsx:618` — `className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm" style={{ color: active ? '#fff7ed' : '#a8a29e', backgroundColor: active ? '#ea580c' : 'transparent'`




**R29 · MEDIUM · System** — The intake wizard has two different footers for one flow  
law: Law of Similarity

- Problem: IntakePrepare's footer is a 14px/36px inline-styled bar on #1c1917 with a 1px #292524 top, a 12px status line and a 13px uppercase 0.12em-tracked 'Run Intake →' button using an arrow glyph. IntakeReview has no footer bar at all: its Back / Discard / Save controls are a bare flex row inside the scrolling content at 11 to 12px with a 1px #44403c top border nowhere. NewProjectForm has a third: px-6 py-3 on #292524 with a 1px #44403c top. The user crosses three footers in one flow.

- Why it matters: The footer is the flow's progress bar in disguise. Three of them means the user relearns where 'continue' lives at each step.

- Change: One wizard footer, 44px, hairline top on the recessed token, 24px gutter, left slot for the status line at Caption/12 and right slot for secondary then primary at md 36px. Move IntakeReview's controls into it so they stop scrolling away. Replace the arrow glyphs with a lucide ArrowRight at 16px.

- Evidence: `src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:378` — `padding: '14px 36px', borderTop: '1px solid #292524', backgroundColor: '#1c1917',`<br>`src/tools/rabbit_v0.1.0/views/intake/IntakeReview.jsx:179` — `<div className="flex justify-between items-center">`<br>`src/tools/rabbit_v0.1.0/views/IntakeWizardView.jsx:470` — `<div className="flex items-center justify-between px-6 py-3" style={{ borderTop: '1px solid #44403c', backgroundColor: '#292524' }}>`




**R30 · MEDIUM · System** — Two structurally identical filter panels, built twice, with different type and different Done logic  
law: Law of Similarity

- Problem: TeamView's TeamFilterPanel and ProjectTasksView's FilterPanel are the same component: a Where/And row of field select, operator select, value control and a remove X, plus an Add filter button and a Done button. Team runs at 9.5px/10.5px with rounded-sm and a #78716c remove icon; Tasks runs at 10.5px/11.5px with rounded and a #fca5a5 remove icon. Tasks hides Done until at least one filter exists; Team always shows it.

- Why it matters: Two copies of one component is how the type drift happened in the first place, and the user meets both within two tab clicks.

- Change: One FilterPanel in src/ui, parameterised on the field list. Label at 11, controls at Dense/13, all sm 28px, remove icon in ink at 48 percent turning danger on hover. One Done behaviour.

- Evidence: `src/tools/rabbit_v0.1.0/views/TeamView.jsx:1095` — `<span className="text-[9.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>   {i === 0 ? 'Where' : 'And'}`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:843` — `<span className="text-[10.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>   {i === 0 ? 'Where' : 'And'}`




**R31 · MEDIUM · System** — Two saved-views dropdowns, one a labelled button and one a bare icon  
law: Jakob's Law

- Problem: ProjectTasksView's SavedViewsDropdown is a bordered button reading 'Views' with a bookmark icon, opening a 224px menu with 11.5px rows. TeamView's TeamSavedViewsDropdown is an unlabelled 26px icon button whose colour is the only cue that saved views exist, opening a 180px menu with 11.5px rows and a 10.5px footer action. Same feature, same storage pattern, two affordances.

- Why it matters: An unlabelled icon for a feature with no established convention fails Jakob's Law; the user has no way to know Team has saved views at all.

- Change: One SavedViews control, the labelled version, in both toolbars. One Menu component (promote binUi's) for the panel.

- Evidence: `src/tools/rabbit_v0.1.0/views/TeamView.jsx:1162` — `<button type="button" onClick={() => setOpen(o => !o)}   className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"   style={{ color: views.length > 0 ? `<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:912` — `<BookmarkPlus className="w-3.5 h-3.5" /> Views`




**R32 · MEDIUM · System** — The same group header is drawn three ways across the Tasks view  
law: Law of Uniform Connectedness

- Problem: TaskGroup's header carries a 3px LEFT border in the status accent with a 12.5px uppercase tracked bold label and a count chip on #292524. KanbanColumn's header carries a 3px BOTTOM border in the same accent with the same 12.5px label and a count chip on #1c1917. TeamView's group header carries no accent at all, a chevron, an 11.5px orange label and a bare 9.5px count. Three orientations, three count treatments, one semantic.

- Why it matters: Uniform Connectedness: the accent bar is supposed to say 'this group is that status'. Rotating it 90 degrees between two views of the same data means it says nothing.

- Change: One GroupHeader at 32px: chevron, label at 14 sentence case weight 600, count as a Badge at Label/11, and a 3px LEFT signal or status rule on the group wrapper in both table and board. The board column keeps its own 1px top hairline instead of the 3px bottom border.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1216` — `backgroundColor: '#1c1917', borderBottom: '1px solid #44403c', borderLeft: '3px solid ${groupAccent}',`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1734` — `<div className="px-3.5 py-3 flex items-center justify-between"   style={{ borderBottom: '3px solid ${headerAccent}', flexShrink: 0 }}>`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:552` — `<span className="text-[11.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{g.label}</span>`




**R33 · MEDIUM · Colour** — The 'Add Files' button is the only inverted primary in R.A.B.B.I.T.  
law: Law of Similarity

- Problem: Every primary action on this surface is #ea580c fill with #fff7ed text and a #c2410c border (fourteen instances). ProjectFilesSection's Add Files button alone uses a #fb923c fill with #1c1917 text and no border. It sits inside the Control Panel four inches from the Change and Reset buttons, which are ghosts.

- Why it matters: Law of Similarity says a button that looks different does something different. This one does not.

- Change: Make it the standard primary at sm 28px, or better, demote it to a secondary since 'Add files' is not the panel's primary action.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1123` — `className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider transition-all hover:brightness-125" style={{ backgro`




**R40 · MEDIUM · Build** — Row state lives in inline style objects driven by React state, which will fight any class-based rework  
**constraint: touches-interaction**

- Problem: TaskRow, MilestoneRow, KanbanCard, ProjectMiniCard, the gallery card, the MemberPickerModal row and TaskGroup all compute background, border and opacity inline from a `hovered` useState plus onMouseEnter/onMouseLeave, rather than from CSS :hover. MemberPickerModal goes further and mutates e.currentTarget.style.backgroundColor directly on mouse events. TaskRow's flatSelect sets cursor inline, which the file's own comment at :1493-1496 notes beats Tailwind's disabled:cursor-not-allowed variant.

- Why it matters: This is the main build risk for the rework session. Any hover, selected or focus treatment written as a Tailwind class will be silently overridden by the style attribute, and the failure is invisible rather than an error.

- Change: Before restyling, convert hover and selected state on these seven components to CSS classes and data attributes (data-selected, :hover, :focus-within). Delete the seven `hovered` useStates and the direct style mutation in MemberPickerModal. Do this as a mechanical pre-step in its own commit so the visual pass has a clean surface.

- Evidence: `src/tools/rabbit_v0.1.0/views/TeamView.jsx:979` — `onMouseEnter={(e) => { if (!checked) e.currentTarget.style.backgroundColor = '#44403c' }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = checked`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1497` — `const flatSelect = {   backgroundColor: 'transparent', border: '1px solid transparent',   outline: 'none', cursor: canWrite ? 'pointer' : 'not-allowed', }`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1799` — `border: '1px solid ${hovered ? '#57534e' : '#44403c'}',`




**R41 · MEDIUM · Flow** — Twelve inline editors implement Enter-commits / Escape-reverts and not one of them says so  
**constraint: touches-interaction** · law: Paradox of the Active User

- Problem: ProjectTasksView has eight (CellInlineText, CellNumberInput, PhaseInlineEdit, the milestone title and date editors, the kanban add input, the two dialog inputs); TaskDetailPopup has four. All honour Enter and Escape. There is no Kbd hint, no placeholder mention, no footer hint and no document-level key handler anywhere in the surface, while BinsView.jsx:846 advertises twelve shortcuts in a permanent footer bar.

- Why it matters: The Paradox of the Active User says nobody reads the help modal. The best interaction in R.A.B.B.I.T. is invisible, and the one view that does advertise its keys is the one Audrey cited as the uniformity outlier.

- Change: With the shell StatusBar from R15 in place, give Tasks and Team a right-slot hint set built from the shared Kbd: Enter save, Esc cancel on any focused editor, and the existing bulk keys. No key bindings are added or changed; only the existing ones become visible.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1906` — `onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:846` — `<span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span><span><Kbd>S</Kbd> select</span>`




**R42 · MEDIUM · Build** — TaskDetailPopup writes every field without checking canWrite, unlike the row it opens from  
**constraint: touches-interaction**

- Problem: handleUpdate at :162 calls ctx.updateTask directly. TaskRow's equivalent at :1482 opens with `if (!canWrite) return`. TaskDetailPopup computes canWrite at :104 and uses it only to gate the Delete button. So a reviewer who opens the detail popup gets fifteen live-looking selects that will be refused by RLS with a raw error, which is the exact failure shape the Session 29 comments in this same file describe fixing elsewhere.

- Why it matters: Out of scope as an interaction change, but in scope as a visual-state problem: the rework will style disabled and read-only states, and this component has no read-only state to style. Flagging it so the session does not paint over a live defect.

- Change: Do not change behaviour in the visual pass. Record it for a follow-up, and when building the shared Input/Select, give them a real read-only variant so the fix is one prop when Audrey authorises it.

- Evidence: `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:162` — `function handleUpdate(patch) { ctx?.updateTask?.(task.id, patch) }`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1482` — `function handleUpdate(patch) {   if (!canWrite) return   ctx?.updateTask?.(task.id, patch) }`<br>`src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:104` — `const canWrite = canOnProject(gateCtx, 'project.entity.write')`




**R44 · MEDIUM · Density** — Four page gutters and no shared content measure across the five sub-views  
law: Law of Proximity

- Problem: Tasks uses px-4 on its toolbar and p-3 on its table body. Team uses px-4 on its toolbar and px-4 on its cells, but ProjectMembersPanel uses px-6 py-6 with max-w-2xl. Summary uses p-6 with no max width. IntakePrepare uses maxWidth 760 with padding '32px 36px 28px'. NewProjectForm uses max-w-5xl with p-6. ProjectContextBar uses px-6 while ViewTabs directly above it uses px-2, so the tab strip's left edge sits 16px left of the project name beneath it.

- Why it matters: The gutter mismatch between ViewTabs and ProjectContextBar is visible on every non-Summary tab: the two shell strips do not share a left edge. And five content measures means no two views frame their content the same way.

- Change: One 24px page gutter used by ViewTabs, ProjectContextBar, every toolbar and every view body. Two measures: 720px for the reading and form views (IntakePrepare, NewProjectForm, the cloud roster) and full-width capped at 1240px for the data views (Tasks, Team table, Summary). Views stop setting their own padding.

- Evidence: `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:37` — `className="flex items-center gap-1 px-2"`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:54` — `className="flex items-center gap-3 px-6 py-2"`<br>`src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:138` — `<div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 36px 28px' }}>`




**R34 · LOW · System** — SettingsToggle is the only pill shape in a surface whose written rule is sharp over soft  
law: Jakob's Law

- Problem: A 36x20 track at borderRadius 10 with a 14px circular knob, used five times in the Control Panel. Everything else in the surface is a 2 or 4px rectangle. It also has no focus ring (focus:outline-none with no replacement) and no label association.

- Why it matters: One rounded object among 230 rectangles reads as imported from somewhere else. The missing focus ring is an accessibility defect, not a taste call.

- Change: Either keep the pill and accept it as the app's one switch shape (defensible, since a switch reading as a switch is a Jakob's Law win), or replace with a 28px segmented On/Off. Either way add a focus-visible signal ring and wire the label. I would keep the pill and standardise it as the single Switch component.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1225` — `className="relative flex-shrink-0 transition-colors focus:outline-none" style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: checked ? '#ea580c' :`




**R35 · LOW · System** — NewTaskPopup closes with an HTML entity instead of a lucide icon  
law: Fitts's Law

- Problem: The close control is the raw character &#10005; set at 13px mono in #78716c, inside a button with no padding and no hover state. Every other close in the surface is a lucide X at 14 to 16px in a p-1 hover box. It is also the only file in scope that imports no icons at all. visual-language.md composition rule 5 forbids glyphs in place of icons.

- Why it matters: It is a 12px hit target with no hover feedback, and it looks visibly different from the six other close buttons the user meets.

- Change: lucide X at 16px inside the shared Dialog header, which owns the close control anyway once R11 lands.

- Evidence: `src/tools/rabbit_v0.1.0/components/NewTaskPopup.jsx:117` — `<button type="button" onClick={onClose} className="text-[13px] font-mono" style={{ color: '#78716c' }}>   &#10005; </button>`




**R36 · LOW · System** — StatusPill is dead code that will be re-adopted by mistake

- Problem: Defined at ProjectSummaryView.jsx:1374 with its own three-value status map. Zero call sites anywhere in the repo; StatusDropdown replaced it. It is a fourth status colour map sitting in the file waiting for someone to import it.

- Why it matters: The component-consolidation pass will find it and treat it as prior art.

- Change: Delete it as part of the StatusBadge work.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:1374` — `function StatusPill({ status }) {   const color = status === 'active' ? '#15803d' : status === 'archived' ? '#57534e' : '#ea580c'`




**R37 · LOW · Colour** — Two off-ramp hex values that belong to no ramp

- Problem: The gallery card's inactive border is '#333', a cool neutral that is not in the stone ramp and is the only three-digit hex in the surface. The Control Panel heading is '#f5f5f4' (stone-100) where every other heading on dark is #d6d3d1 or #fb923c, and the Kanban card title is '#e7e5e4' (stone-200), a third near-white. Three near-identical light inks with no distinct job.

- Why it matters: Small, but these are exactly the values that survive a palette pass because nobody grepped for them.

- Change: All three become the single ink token at 100 percent. Borders become the rule token.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:320` — `border: '1px solid ${isActive ? '#ea580c' : '#333'}',`<br>`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:673` — `<h2 className="text-xl font-mono font-bold mt-3" style={{ color: '#f5f5f4' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1814` — `<span className="text-[13.5px] font-mono leading-snug font-medium" style={{ color: '#e7e5e4' }}>`




**R38 · LOW · Density** — MilestoneRow fills seven of its ten columns with a near-invisible em dash  
law: Law of Prägnanz

- Problem: Every column a milestone does not use renders an em dash at 11.5px in #3a3733, which is 1.15:1 against the row's rgba(245,158,11,0.04) fill. The result is seven columns of faint grey noise per milestone row, and the row already carries two Diamond icons (one in the checkbox slot, one beside the title).

- Why it matters: Prägnanz: every element should earn its place. A placeholder you cannot read is noise with a cost and no benefit.

- Change: Render empty cells as genuinely empty. Keep one Diamond, in the checkbox slot, and drop the duplicate beside the title.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1458` — `<div key={c.key} className="px-3.5 py-2" style={{ flex: c.flex, minWidth: 0 }}>   <span className="text-[11.5px] font-mono" style={{ color: '#3a3733' }}>—</span`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1392` — `<Diamond className="w-3 h-3 flex-shrink-0" style={{ color: milestone.color || '#f59e0b', fill: milestone.color || '#f59e0b' }} />`




**R39 · LOW · Motion** — Transition durations run 150 / 200 / 250ms with no rule, and nothing handles reduced motion  
law: Doherty Threshold

- Problem: 150ms on card hover, row background, toggle knob, hover-reveal opacity and the module-card opacity; 200ms on the progress bar and both drag-over states; 0.15s ease on the intake persona chips and upload zone; Tailwind's default 150ms on the ~90 bare transition-colors. No prefers-reduced-motion guard anywhere in the twelve files.

- Why it matters: Minor, but a component layer should ship one duration per motion class rather than three by accident, and the drag-over states at 200ms are the slowest thing in a drag interaction, where response should be immediate.

- Change: 120ms ease-out for hover, focus and hover-reveal; 160ms cubic-bezier(0.2,0,0,1) for menus, panels, filters and drag-over. Keep the 1600ms page transition untouched. Add a reduced-motion block that sets transition-duration to 0.01ms for this subtree.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1730` — `transition: 'background-color 200ms ease, box-shadow 200ms ease',`<br>`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1616` — `transition: 'background-color 150ms ease, border-color 150ms ease',`<br>`src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:320` — `transition: 'all 0.15s ease',`




**R43 · LOW · Density** — The Tasks view opens with four metric tiles the user did not ask for  
**constraint: touches-interaction** · _taste, not error_ · law: Selective Attention

- Problem: Tasks Remaining, Days Remaining, Tasks Completed and Days Passed occupy a 56px band above the toolbar on every visit, always expanded, before the table the user came for. Days Passed in particular answers a question nobody asks while editing tasks, and the same four numbers are available on Summary.

- Why it matters: Taste, not error. A dashboard strip on a working screen costs vertical field on the densest view in the tool. But it is a legitimate design choice and Audrey may want it.

- Change: My recommendation: keep the four tiles but move them to the shell StatusBar's right slot as a single line of Label/11 pairs, returning about 56px of table. If Audrey wants them as tiles, they at least go to the shared Stat from R19 at a uniform 64px height with the value first.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:533` — `<div className="flex gap-3 px-4 pt-4 pb-2 flex-wrap flex-shrink-0">   <TaskBigTile icon={ListChecks} label="Tasks Remaining" value={taskSummary.remaining} />`





## Uniformity gaps

- **Shortcut hints / a view footer** — here: Zero. No Kbd, no shortcut bar, no document-level key handler in any of the twelve files, despite twelve inline editors implementing Enter and Escape (views/ProjectTasksView.jsx:1906, :1323, :1397; components/TaskDetailPopup.jsx:668). — elsewhere: BinsView.jsx:844-848 mounts a 34px footer bar with twelve Kbd hints and reserves paddingLeft:30 so the shell's adapter dot reads as part of it. This is Audrey's named example. — do: Promote it to a shell-level StatusBar mounted by Rabbit.jsx for all eleven views: adapter dot and presence on the left, the view's count line and its Kbd hints on the right.

- **Button primitive** — here: Hand-rolled at 24 sites with nine distinct padding pairs (px-2 py-1, px-2 py-1.5, px-2.5 py-1, px-2.5 py-1.5, px-3 py-1, px-3 py-1.5, px-4 py-1.5, px-5 py-1.5, px-5 py-2) and five label sizes (10, 10.5, 11, 11.5, 13px). — elsewhere: views/bins/binUi.jsx:20-38 already exports Btn with primary/danger/default variants and exactly two sizes. — do: Promote binUi's Btn to src/ui/Button, add a ghost variant and a 36px md size, and replace all 24 sites.

- **Icon button** — here: p-1, p-1.5, p-0.5 with icons at w-3, w-3.5, w-4, w-5, w-6, w-8, w-10, w-12 — eight icon sizes in one surface. — elsewhere: binUi.jsx:40-59 exports IconBtn with one padding and a size prop. — do: Three icon sizes only: 14px in dense controls, 16px in rows and buttons, 24px in empty states. Promote IconBtn.

- **Modal / dialog** — here: Seven hand-rolled overlays across five files, three backdrop alphas, two border treatments, no Escape (components/TaskDetailPopup.jsx:173, components/NewTaskPopup.jsx:101, views/TeamView.jsx:571 and :907, views/ProjectTasksView.jsx:738 and :762, views/IntakeWizardView.jsx:491). — elsewhere: binUi's Modal carries a modal stack, topmost-only Escape, a busy lock and an in-footer error slot. — do: Promote it to src/ui/Dialog and route all seven through it. Delete the 2px #f97316 frame.

- **Dropdown menu** — here: Four hand-rolled panels with different widths (240, 224, 180, and the roster picker's left-4 right-4), two shadow treatments (inline boxShadow vs Tailwind shadow-2xl) and three row heights (py-1.5, py-2, py-2.5). — elsewhere: binUi exports Menu with viewport clamping already handled. — do: One Menu component; the four call sites keep their own item lists.

- **Status colour** — here: Five inline maps in two files, four of which disagree; two verbatim copies of statusColor and priorityColor; a reviewer chip in violet. — elsewhere: binUi's C token object plus binMedia's COLOR_HEX show the pattern R.A.B.B.I.T. needs. — do: One StatusBadge taking a semantic token. A status colour must become un-writable inline.

- **Table** — here: Three implementations: a real <table> with borderSpacing 0 2px (TeamView:527), a flex fake-table of bordered boxes (ProjectTasksView:1004-1055), and a CSS grid at 9px/10px (ProjectFilesTable:123). — elsewhere: The system review counts 19 hand-built tables app-wide and 10 header-cell implementations. — do: One Table/Th/Td/Row. This is the single highest-leverage component on the surface.

- **Empty state** — here: Six (Rabbit.jsx:387, IntakeWizardView.jsx:640, IntakePrepare.jsx:241, ProjectSummaryView.jsx:1156 and :1472, TeamView.jsx:519 and :788). — elsewhere: binUi exports EmptyState. — do: One EmptyState plus a separate Loading with table skeletons, so 'empty' and 'fetching' stop looking identical.

- **Toolbar** — here: Two, both flex-wrap, both px-4 py-2, both with five control heights inside (ProjectTasksView:541, TeamView:443). — elsewhere: Nothing in the app defines one; the system review proposes 44px with 28px children. — do: One Toolbar, 44px, 24px gutter, hairline bottom, left/right slots, no wrap.

- **Type family** — here: Two, and they are not the app's two: 339 font-mono uses plus a private Century Gothic / Futura / Avenir stack in IntakePrepare.jsx:55. — elsewhere: Every other file in WILSON uses the mono fallback only. — do: Delete the private stack before any global font work, or the global font will land on eleven of twelve files and leave the twelfth in Century Gothic.

- **Page gutter** — here: px-2 (ViewTabs), px-4 (both toolbars), px-6 (ProjectContextBar, Summary, NewProjectForm, cloud roster), 36px (IntakePrepare). The tab strip and the context bar directly beneath it do not share a left edge. — elsewhere: App.jsx sets content padding in vh, which the system review flags separately. — do: One 24px gutter everywhere in the tool, set by the shell, not by the views.


## Alignment issues

- Tasks table — header versus rows (`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1060`): The header flex has no padding (x=0) while the row container has p-3, so every column sits 12px right of its own header. Grouped rows nest a second p-3, putting them 24px right. Three left edges for one column set, and the offset changes when grouping is toggled. → Remove the padding from both containers and let the shared Row own 8px/12px cell padding. Indent groups with a 3px left rule on the group wrapper, never with padding on the rows.

- Shell — ViewTabs versus ProjectContextBar (`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:54`): ViewTabs is px-2 and ProjectContextBar directly beneath it is px-6. The first tab's icon and the folder icon under it are 16px apart horizontally on every non-Summary tab. → One 24px gutter on both strips, plus the same 24px on every view body, so the tool has a single left margin from the top bar down.

- Summary — Stat row versus BudgetTile row (`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:418`): The Stat row is a 4-column grid with value-above-label; the BudgetTile row 150px below is a 3-column grid with label-above-value. Two tile rows on one screen with inverted internal orientation and different column counts, so no vertical line runs through the card. → One Stat component, value first. Keep 4 and 3 columns if the content demands it, but set both on the same 12-column grid so the first and last tiles share edges with the card.

- Tasks toolbar — control baselines (`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:541`): Nine controls at roughly 26, 26, 28, 30, 30, 30, 31, 31, 31px. Nothing shares a baseline and the row is flex-wrap, so at narrow widths it breaks into two ragged lines with the primary orphaned. → 44px Toolbar, every child exactly 28px, no wrap; the search field is the flex-shrink element.

- Team toolbar — control baselines (`src/tools/rabbit_v0.1.0/views/TeamView.jsx:443`): Eight controls at three heights (26px icon buttons, ~30px selects, ~31px Assign Members), plus three 1px x 16px divider strips that are vertically centred against controls of differing heights, so the dividers read as off-centre. → Same 44px Toolbar with 28px children; dividers become 1px x 20px on a shared centre line, or drop them and use 24px group gaps instead.

- TaskDetailPopup — Bid total versus its neighbours (`src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx:476`): The Bid total read-only box is given minHeight 34 to fake the height of the selects beside it. Every other field in the grid derives its height from px-2.5 py-1.5 plus its own line-height, so the row is aligned by a magic number that will break the moment the type size changes. → One control height token (sm 28 / md 36) applied to inputs, selects and read-only value boxes alike, so no field needs a compensating minHeight.

- Team member row — icon-to-text baseline (`src/tools/rabbit_v0.1.0/views/TeamView.jsx:322`): The name cell pairs a 24px avatar with 12px text using items-center, while the Type, Role and date cells put their controls in the same row at 10.5 and 11.5px with different intrinsic heights. Across the ten columns the text baselines do not line up, which is visible because the row is only 36px tall. → Fix the row height at 36px, set every cell to align-middle with one Dense/13 type size, and let the avatar be 24px in a fixed-width first column so the name's baseline is the row's baseline.

- Kanban column header versus table group header (`src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx:1734`): The same accent rule is a 3px LEFT border in the table and a 3px BOTTOM border on the board. Switching view modes rotates the group's identity marker 90 degrees. → Left rule in both. The board column gets a 1px top hairline for its header instead.

- Intake — files table inside the prepare page (`src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx:229`): ProjectFilesTable is dropped into a 760px column whose other content hangs at a 100px indent; the table starts at 0 and runs full width, so it does not align with the persona row, the generation grid or the descriptions above and below it. → Either pull the table to the full content width and let the configuration block lose its hanging indent below it, or indent the table to the same 100px. One of the two, consistently.

- Summary folder row (`src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx:425`): A 16px icon, an 11px caps label, an 11px path, and two 10px buttons with px-2 py-0.5 all on one flex line with items-center. The two buttons are about 19px tall against a 16px icon and three text runs at two sizes, so nothing in the row shares a vertical centre convincingly and the buttons read as squashed. → Treat it as a Field: 11px Label above, then a 28px row containing the path well and two sm buttons at 28px.


## Hick's Law hotspots

- ViewTabs — the tab strip (components/ViewTabs.jsx:18-32): 11 visible choices → Eleven peers, each an icon plus an 11px caps word, all weighted identically. This is a system question but here is what these five views need from it: keep all eleven reachable and keep the order, but insert one 24px group gap so the strip reads as three chunks the eye can pre-sort — Plan (Intake, Summary, Team, Tasks, Timeline, Budget), Content (Assets, Scenes, Bins, Levels, Experiences), and the right-hand tool slot (Settings, Help). Miller's 7±2 is satisfied by the first chunk, and the second chunk is already conditional on project toggles, so in practice most projects show six to eight. No tab is hidden, moved to a menu, or renamed.

- Tasks toolbar — right-hand action cluster (views/ProjectTasksView.jsx:626-676): 4 visible choices → Export, Phase, Key Date and New task are four near-identical bordered controls at the position Serial Position says is remembered. Keep all four visible; make exactly one primary (New task at md 36px), demote Phase and Key Date to equal-weight sm ghosts in one ink, and reduce Export to an icon-only ghost with a tooltip. Decision time falls because three of the four stop competing, and nothing moves into a menu.

- Tasks toolbar — whole row (views/ProjectTasksView.jsx:541-677): 9 visible choices → Filter, Sort, sort-direction, Group, Table/Board, Views, Search, Export, Phase, Key Date, New task is eleven decision points including the count. Group them by function with 24px gaps and 8px within-group gaps instead of a uniform gap-2 plus three 1px dividers: [Filter | Sort | Group] [Table/Board] [Views] [Search] ... [count | Export] [Phase | Key Date | New task]. Same controls, same order, same behaviour; the row goes from eleven equal items to six clusters.

- TaskDetailPopup — properties grid (components/TaskDetailPopup.jsx:321-502): 15 visible choices → Fifteen identical selects with no headings. Chunk into four labelled groups (Workflow, Placement, People, Schedule and cost) separated by a hairline and an 11px eyebrow. Every field stays in the dialog and in the same relative order; the user scans four labels instead of fifteen.

- Project Control Panel — one screen (views/ProjectSummaryView.jsx:661-966): 34 visible choices → Thirty-four writable controls in one scroll: 6 header fields, 6 classification fields, 1 realtime toggle, 7 budget fields, 4 storage controls, and up to 10 inside the three module cards. The three module cards already use progressive disclosure correctly (collapsed until toggled on) and should be the model. Apply the same to Budget and Files & Storage: show the four fields that change most (currency, total, folder, add files) and put margin, contingency, agency, actuals mode and column count behind a 'More budget settings' disclosure inside the same panel. Nothing leaves the screen; it starts folded.

- Team toolbar (views/TeamView.jsx:443-510): 8 visible choices → Filter, Sort, sort-direction, Group, Saved views (unlabelled icon), Search, count, Assign Members. Same clustering treatment as Tasks, and give the saved-views icon a label so it stops being an undiscoverable eighth choice.

- IntakePrepare — configuration block (views/intake/IntakePrepare.jsx:265-340): 10 visible choices → Six persona chips plus four generation checkboxes in one undifferentiated block. It is already correctly chunked by the two hanging-indent labels and is the best-organised decision point on the surface. Only change: the disabled Scene Breakdown option sits at opacity 0.3 with its reason in 11px grey, which reads as broken rather than conditional. Keep it in place, raise it to full opacity with an 'Off' badge and the reason at Caption/12, matching how the module cards express a disabled state.


## Type inventory

| px | Where it is used on this surface | Count | Should become |
|---|---|---|---|
| 24 (text-2xl) | Summary header project title (ProjectSummaryView:356) | 1 | H1 / 20 |
| 20 (text-xl, fontSize 20) | Control Panel title (:673), BudgetTile value (:1464), IntakePrepare page title (IntakePrepare:142) | 3 | H1 / 20 for the two titles; Stat value 20 for the tile |
| 18 (text-lg) | TaskBigTile value (ProjectTasksView:1956) | 1 | Stat value / 20 |
| 14 (text-sm, text-[14px], fontSize 14) | Section headers in help tokens, Stat value (:1414), CountTile value (IntakeReview:229), TaskDetailPopup header title (:184) and Title field (:669), IntakePrepare upload copy (:179) | 9 | H2 / 16 for titles, Stat value 20 for numbers, H3 / 14 for the card title |
| 13.5 | Kanban card title (:1814), "No tasks yet" (:998), two dialog titles (:741, :765), no-project line (:523) | 5 | H3 / 14 or Body / 14 |
| 13 (text-[13px], fontSize 13) | Card title (:1364), Control Panel bar title (:273), Projects strip title (:295), phase chip name (:508), ListRow title (:1428), NewProjectForm header (IntakeWizardView:233) and title input (:256), IntakePrepare lede (:163) and generation labels (:328) | 15 | H2 / 16 for the three titles; Dense / 13 for rows and inputs; Body / 14 for the lede |
| 12.5 | TaskGroup label (:1268), PhaseInlineEdit (:1309), CellInlineText (:1895), milestone title (:1403) | 10 | H3 / 14 for group headers; Dense / 13 for cell text |
| 12 (text-xs, text-[12px], fontSize 12) | Every TaskDetailPopup select and textarea, NewTaskPopup header, ProjectContextBar project name, TeamView name cells, Summary description and Empty, all help body text | 62 | Dense / 13 for controls and cells; Body / 14 for descriptions; Caption / 12 for metadata |
| 11.5 | The single most common size: all Tasks cells, all Team cells, all filter controls, most buttons, most dialog copy | 62 | Dense / 13 |
| 11 (text-[11px], fontSize 11) | ViewTabs labels, most primary and secondary buttons, module card titles, Summary date and folder rows, IntakeReview section titles, FileNameEditor | 64 | H3 / 14 for tab labels; Body / 14 for buttons; Label / 11 for eyebrows only |
| 10.5 | Both toolbars entirely, all Th cells, Kanban card meta, status and priority chips, bulk controls | 49 | Label / 11 for headers and chips; Dense / 13 for toolbar controls |
| 10 | SettingsField-adjacent labels, FieldLabel, ConfirmRow labels, folder buttons, Summary tags, CollapsibleSection label | 39 | Label / 11 |
| 9.5 | NewTaskPopup labels, Team filter Where/And, phase Start/End labels, role descriptions, 'bound' chip | 8 | Label / 11 or Caption / 12 |
| 9 | SettingsField label, SectionCard title, ConfirmRow group eyebrows, ProjectContextBar 'Project' eyebrow and status pill, ProjectFilesTable headers, attachment metadata | 28 | Label / 11 |
| 8.5 | ProjectMiniCard status pill (:1335), presence pill (Rabbit:340), MediaTag small | 3 | Label / 11 |
| 8 | Presence initials chip (Rabbit:365) | 1 | Label / 11 |

**21 distinct sizes; 6 of them at half-pixel steps that cannot render distinctly at 96dpi; roughly 79 occurrences at or below 10px.** Cases in use: UPPERCASE x140, sentence case elsewhere. Weights: 400, 500 (font-medium x4), 600 (font-semibold x9) and 700 (font-bold x47) — four weights where two will do. Tracking: tracking-wider x95, tracking-widest x28, tracking-wide x1, plus six inline letterSpacing values in IntakePrepare (0.02, 0.04, 0.08, 0.1, 0.12, 0.14, 0.18, 0.2em).


## Priority order

R01 — Delete IntakePrepare's private Century Gothic font stack. Must land BEFORE any global typeface work or the new font will apply to eleven of twelve files and leave one rendering in a geometric sans. One file, 28 fontFamily references, under an hour., R02 + R03 + R04 — Apply the shared type scale, strip mono from the 332 non-numeric sites, and reduce uppercase from 140 to about 20. These three are one edit and together they are the entire 'doesn't look contemporary' complaint. Cheapest high-impact work on the surface., R05 — Fix the Tasks table's three left edges. Two lines of padding, and it is the most visible alignment defect in R.A.B.B.I.T., R06 — Give the Team sticky header a background. One line, fixes a rendering bug on the densest screen., R13 + R24 — Build the shared Table/Th/Td/Row and adopt it in Team, Tasks and ProjectFilesTable. One component retires three implementations, fixes the 9px headers, the 2px row gap, the box-per-row treatment and the missing tabular numerics in one pass., R07 + R08 + R26 — One StatusBadge plus one taskStatus module. Retires five status maps, two duplicated colour functions, nine status colours and all four cool hues., R14 + R44 — Shared Toolbar at 44px with 28px children, and one 24px gutter across the shell and all five views. Fixes both toolbars, the ViewTabs/ContextBar edge mismatch and the four content measures., R11 — Promote binUi's Modal to src/ui/Dialog and route all seven overlays through it. Retires three backdrops, two borders, five shadows and the 2px orange frame., R15 + R41 — Promote the Bins footer to a shell StatusBar and put the existing Enter/Escape conventions in it. This is Audrey's own named uniformity example and it fixes the 8px floating overlays at the same time., R09 + R23 — One project picker component and one identity block on Summary. Gives Summary a dominant element for the first time., R10 + R22 — Two radii and one Panel. Mechanical, large blast radius, best done immediately after the Table so both share the token., R18 + R17 — Chunk the TaskDetailPopup properties grid and stop printing the title twice., R21 — One EmptyState plus one Loading with table skeletons. Retires six empty states and makes loading distinguishable., R19 + R20 — One Stat component with value-first orientation and tabular numerics in every numeric column., R25 + R32 + R30 + R31 — Button hierarchy in the Tasks toolbar, one GroupHeader orientation, one FilterPanel, one SavedViews control., R12 — Unify the two Team interfaces. Largest single piece of work in the scope and the only one that needs its own session., R27 + R39 — One floating shadow, no glows, two motion durations, a reduced-motion guard., R28 + R29 — Intake progress rule instead of chips, one wizard footer, fix the 'Step 5' label., R33 + R35 + R36 + R37 + R38 — Cleanup: the inverted Add Files button, the entity close glyph, the dead StatusPill, the three off-ramp hexes, the milestone em dashes., R34 + R43 — Taste calls for Audrey: keep or replace the pill toggle, keep or relocate the four Tasks metric tiles., R40 + R42 — Pre-step and follow-up, not findings to style around: convert inline hover state to CSS before the visual pass (R40 gates several of the above), and record the TaskDetailPopup ungated write for a separate session.


## Rework scope (reviewer's estimate)

Files: `src/tools/rabbit_v0.1.0/Rabbit.jsx (409 lines)`, `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx (77)`, `src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx (155)`, `src/tools/rabbit_v0.1.0/views/IntakeWizardView.jsx (662)`, `src/tools/rabbit_v0.1.0/views/intake/IntakePrepare.jsx (401)`, `src/tools/rabbit_v0.1.0/views/intake/IntakeProgress.jsx (161)`, `src/tools/rabbit_v0.1.0/views/intake/IntakeReview.jsx (290)`, `src/tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx (1493)`, `src/tools/rabbit_v0.1.0/views/TeamView.jsx (1203)`, `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx (1962)`, `src/tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx (681)`, `src/tools/rabbit_v0.1.0/components/NewTaskPopup.jsx (253)`, `src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx (273) — shared with the Files/Assets scope, must be co-ordinated`, `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx (read + promote, do not edit in place)`, `NEW: src/ui/{Button,IconBtn,Table,Toolbar,Dialog,Menu,Input,Select,Field,EmptyState,Loading,StatusBadge,Badge,Chip,Panel,Kbd,ShortcutBar,Stat,HoverActions}.jsx`, `NEW: src/tools/rabbit_v0.1.0/taskStatus.js`  
Approx lines: 8020  
Suggested sessions: 4  
Split: **Session 1 — Foundations and the mechanical pass (no visual judgement).** Promote binUi's Btn, IconBtn, Menu, Modal, EmptyState and Kbd into src/ui and build Table, Toolbar, Stat, StatusBadge, Field and Loading beside them. Then the three purely mechanical edits across all twelve files: delete IntakePrepare's font stack (R01), apply the type scale and strip mono and uppercase (R02/R03/R04), collapse nine radii to two (R10). Also do R40 first inside this session, as its own commit, because converting inline hover state to CSS is what makes everything after it stick. Ends with the surface restyled but structurally unchanged.\n\n**Session 2 — Tables, toolbars and the grid.** Adopt the shared Table in Team, Tasks and ProjectFilesTable (R13, R24, R06, R05), the shared Toolbar in both views (R14), one 24px gutter and two measures across the shell and all five views (R44), tabular numerics (R20), and the shared Stat (R19). This is the session that fixes the alignment complaints. Co-ordinate the ProjectFilesTable change with whoever owns the Files page, since it is the same component.\n\n**Session 3 — Components and chrome.** Route all seven modals through Dialog (R11), one project picker (R09), one Summary identity block (R23), one Panel (R22), one StatusBadge and taskStatus module (R07/R08/R26), one FilterPanel and one SavedViews (R30/R31), one GroupHeader (R32), the shell StatusBar with shortcut hints (R15/R41), one EmptyState and Loading (R21), TaskDetailPopup chunking (R17/R18), button hierarchy (R25), the intake footer and progress rule (R28/R29), shadows and motion (R27/R39), and the cleanup batch (R33/R35/R36/R37/R38).\n\n**Session 4 — Team unification (R12), alone.** Merging the cloud roster panel into the shared table touches permission-conditional rendering in both branches and is the only change in scope that can break a screen for one adapter mode and not the other. It gets its own session with a Local Server pass and a Supabase pass.\n\nIf only three sessions are available, drop Session 4 and leave R12 as a separate follow-up — do NOT fold it into Session 3.  
Risks: **1. Inline styles hide state and will silently beat new classes.** Seven components compute background, border and opacity inline from a `hovered` useState (ProjectTasksView:1607, :1372, :1798; ProjectSummaryView:1317, :316; TeamView:979), and MemberPickerModal mutates e.currentTarget.style directly. TaskRow's own comment at :1493-1496 documents that its inline cursor beats Tailwind's disabled: variant. Any hover or selected treatment written as a class will be overridden with no error. R40 must be a separate commit at the very start of Session 1.\n\n**2. ProjectTasksView is 1,962 lines with eleven components in one file**, and ProjectSummaryView is 1,493 with fifteen. Both exceed what can be safely edited in one pass. Split each into a directory before restyling, or work strictly component-by-component with a build between each.\n\n**3. ProjectFilesTable is shared across scopes.** It is rendered by IntakePrepare, by Summary's Project Files card and by ProjectFilesSection, and it is almost certainly also in the Files-page reviewer's scope. Its `variant='warm'` branch serves a light surface whose ground may change under the F36 palette decision. Do not restyle its warm branch until Audrey rules on the light-page class.\n\n**4. Permission-conditional rendering is dense and load-bearing.** GatedAction wrappers, canWrite, canSeeMoney, canOpenControlPanel and `ready` appear throughout, and the comments record several sessions lost to getting them wrong. Every one of them must survive verbatim. In particular, the GatedAction at ProjectTasksView:1020 carries a comment explaining that it must generate a box rather than `contents` and that it repeats the parent's gap-3 internally — a Toolbar rewrite that changes that gap will break the dimming.\n\n**5. Two branches per view.** TeamView renders two different UIs by adapter mode; TaskDetailPopup renders a two-column or one-column modal depending on linked relations; Tasks renders table or board; every cell editor has a readOnly branch. The rework must be exercised in both Local Server and cloud, and with canWrite both true and false, or half the surface goes unstyled.\n\n**6. Tests may pin class names.** The comments reference writeGate.test.js and authContrast.test.js as the things that caught earlier regressions. Run the suite after Session 1's mechanical pass, before any further work, so a class-name assertion fails early rather than at the end of four sessions.\n\n**7. The `#f4a261` input text colour.** IntakeWizardView, TaskDetailPopup and NewTaskPopup all set input text to #f4a261 on a #1c1917 well (39 occurrences). That is the light-page GROUND colour being used as an ink on dark. It reads fine today but it couples these inputs to the page-class decision in F36; hold it until Audrey rules, then move it to the ink token.
