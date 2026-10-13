# Review — R.A.B.B.I.T. part 4: Assets (table + gallery + create modal + detail popup), the file manager, relations (panel, sidebar, pickers, badge), Levels and Experiences. 8,557 lines across 11 files, all rooted at C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\ (evidence paths below are relative to that root).


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ProjectAssetsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\LevelsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ExperiencesView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileManager.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\RelationsPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectFilesTable.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileThumbnail.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\VideoPreview.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\RelinkDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileAuditDrawer.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\AssetStatusWarningModal.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Resources\ProjectFilesExplorer.jsx (comparison only)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\BinFileTable.jsx (comparison only)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (comparison only)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (shortcut bar, comparison only)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\storage\thumbnails.test.js (build risk)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\localMediaWiring.test.js (build risk)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\writeGate.test.js (build risk)`


## Job

This surface is the production inventory: the place a producer answers "what exists on this show, what state is it in, and where are its files". Its sub-views each have one action, and only some of them know it. Assets table: change one asset's state in place (status, dates, phase) while scanning a list, so the primary action is the inline cell edit and everything else is support. Assets gallery: recognise an asset by picture, so the primary action is opening one. New asset modal: create one named asset, so the primary action is Confirm and Create, and Name is the only required field. Levels and Experiences: the same job as the assets table over a flat list of nine columns' worth of nothing, so their primary action is also the inline edit. FileManager: add a file and get a file back, so the primary action is Add files. Relations panel and pickers: see and change what this entity connects to, primary action link or unlink. RelinkDialog, FileAuditDrawer, VideoPreview, AssetStatusWarningModal: one question each, answered well. The failure is AssetDetailPopup: it carries four co-equal jobs (relations sidebar, a 13-field property grid, an editable task table, a full file manager with its own toolbar and its own view toggle) in one 1,152px modal, so it has no primary action and the eye has nowhere to land. That is finding R4-10 and it is a hierarchy problem, not a scope problem: the four sections can stay, they just cannot all be first.


## What works

- FileThumbnail is the one genuinely reusable atom on this surface: one component serves the cloud signed URL and the desktop route, remembers which URL failed rather than that one did, falls back to a typed file glyph, and is rendered at both the table and the grid site from a single bound element (FileManager.jsx:958). It is the shape the rest of the kit should copy.

- The copy-progress bar (FileManager.jsx:906-923) is deliberately one shape for two completely different transports, a local streaming copy and a resumable cloud upload, so the person watching cannot tell them apart. That is exactly the ecosystem uniformity Audrey is asking for, achieved once, in the smallest place.

- RelinkDialog's PreviewGroup (RelinkDialog.jsx:305-320) is the best-structured component in the surface: a labelled group with a count and a state colour, an empty string of its own, and a bounded scroll. It is one rename away from being the shared SectionTitle the system needs.

- NewAssetPopup's error contract is right and rare: the dialog stays open with the user's input intact, the failure prints in the footer (ProjectAssetsView.jsx:1639-1646), and the footer states the promise out loud, "Nothing is saved until you confirm." (:1651). Promote both into Dialog.

- The bulk-action bar wraps six controls in ONE GatedAction with the parent row's own gap (ProjectAssetsView.jsx:854), so a reviewer sees one dimmed group with one explanation instead of six tooltips. Keep this behaviour verbatim when the bar is restyled.


## Findings (46)

**R4-01 · HIGH · System** — Four table implementations inside this surface, five across the ecosystem, none sharing a row height  
law: Law of Similarity

- Problem: The assets table is a flex row stack with per-row borders; the task table inside the asset detail popup is an HTML table with local Th/Td; the file table one section below it is a second HTML table with a different local Th/Td; ProjectFilesTable is a CSS grid with hand-written gridTemplateColumns strings; Levels and Experiences are flex spans with fixed w-16/w-28 columns. BinFileTable is a sixth grid and ProjectFilesExplorer a fifth HTML table at 13px. No two share a row height, header treatment, cell padding or divider.

- Why it matters: This is the single reason the surface cannot read as one product. Every downstream finding about alignment, type size and colour is a symptom of there being no Table component to put the decision in once. It is also why Audrey can see three file tables in one app and call one of them atrocious: they were never the same thing.

- Change: Build src/ui/Table with Th, Td and Row at the system spec (36px row, 32px head, 8px/12px cells, hairline dividers, no zebra, one hover fill, one selected fill plus a 2px signal left border, align="right" with tabular-nums, fixed-width sort slot) and convert all five implementations to it. The flex-vs-table-vs-grid choice per site is an implementation detail the component absorbs; the visible result is one row rhythm everywhere.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:841` — `<div className="min-w-full relative flex flex-col gap-1 p-3">`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2096` — `<table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:937` — `<table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:110` — `? '48px minmax(180px,1fr) 100px 60px 76px minmax(140px,1fr) 96px...'`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:512` — `<div className="relative flex items-center gap-0 px-4 py-2" style={{ borderBottom: '1px solid #44403c' }}>`




**R4-02 · HIGH · Typography** — Sixteen type sizes on one surface, floor at 7px, de-facto body at 11.5px

- Problem: Measured union across the eleven files: 30, 24, 14, 13.5, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8 and 7px. The working body size is 11.5px (51 uses in ProjectAssetsView alone), the table headers are 10.5px, field labels are 9.5px, and the nested-shot status badge is 7px uppercase with tracking.

- Why it matters: Below about 10px, uppercase with positive tracking stops being type and becomes texture: the reader recognises the shape of the chip, not the word in it. A 7px tracked label cannot be read at arm's length on a 96dpi monitor, and the surface uses that treatment for status, which is the single most important datum on the page. Sixteen sizes also means no two sections can be compared, because a heading here is the same size as a cell there.

- Change: Collapse to the system scale, six steps used here: H2 16 for dialog titles, H3 14 for card and section titles and the active view, Body 14 for prose and inputs, Dense 13 for table cells and list rows, Caption 12 for counts and metadata, Label 11 uppercase 600 +0.06em for table headers and field labels. Nothing below 11 ships. The 7, 8, 8.5, 9, 9.5 and 10px uses become Label 11 or Caption 12.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:799` — `className="px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider rounded flex-shrink-0"`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:153` — `className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded flex-shrink-0"`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:1196` — `<th className="px-2 py-1.5 text-[9px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>`<br>`src/tools/rabbit_v0.1.0/components/FileThumbnail.jsx:148` — `<span className="text-[8.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>`




**R4-03 · HIGH · Hierarchy** — The asset row has no anchor: eight of nine cells are the same size, weight and ink  
law: Von Restorff Effect

- Problem: Name, type, phase, status, start, due, description and task count all render at 11.5px mono, weight 400, in #d6d3d1 or #a8a29e. The only things louder than the asset's own name are the group header (12.5px bold uppercase in a saturated status colour) and the orange New asset button in the toolbar.

- Why it matters: Scanning a table is a search for the name, then a check of one attribute. When the name carries no more weight than the description it sits beside, the eye has to read the row left to right instead of landing on it. This is the concrete reason the assets table feels like a control panel rather than Frame.io.

- Change: Name to Dense 13px weight 600 in full ink; type, phase, dates and description to Dense 13px weight 400 at 72 percent ink; task count to Caption 12 right-aligned tabular; status to the shared StatusBadge at Label 11. One dominant element per row, achieved by weight and ink, not by adding a colour.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1029` — `<CellInlineText value={asset.name || ''} placeholder="Untitled" ... />`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1104` — `<span className="text-[11.5px] font-mono truncate block" style={{ color: '#a8a29e' }}`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2314` — `className="text-[11.5px] font-mono text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-1 rounded"`




**R4-04 · HIGH · Alignment** — The thumbnail column is a different width on every row, so whole rows slide sideways  
law: Law of Uniform Connectedness

- Problem: The header reserves `rowH` for the thumbnail (36, 72 or 108px depending on the size selector). A row reserves `effectiveH`, which is `rowH` only when that asset has a thumbnail and 36px otherwise. At the 3x setting a row with no thumbnail starts its Name column 72px to the left of the row above it, and the header aligns only with thumbnailed rows.

- Why it matters: This is the most visible broken thing on the surface and it is exactly what Audrey means by "make sure alignment in rows and items all make sense". Columns that do not share a left edge cannot be scanned as columns at all, and the defect appears the moment anyone uses the 2x or 3x control the toolbar puts in front of them.

- Change: Fix the thumbnail column at one width for the whole table (the selected `rowH`) and letterbox the 36px placeholder inside it. The row height can still vary with the setting; the column width must not.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:885` — `<div style={{ width: rowH, flexShrink: 0 }} />`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:994` — `const effectiveH = hasThumbnail ? rowH : BASE_ROW_H`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1161` — `<div style={{ width: effectiveH, flexShrink: 0, display: 'flex', ... }}>`




**R4-05 · HIGH · Colour** — One file contains two status-colour languages, so the same asset shows two different greens  
law: Law of Similarity

- Problem: `statusColor` renders approved as #4ade80 and final as #22c55e. 830 lines later `statusTone` plus `toneColors` render the same approved or final as #86efac on a #15803d border. The table row uses the first, the detail popup's Status field uses the second.

- Why it matters: A status colour is a token, not a decoration: its whole value is that the same state looks the same everywhere. Open an asset from the row you just read and the green changes. That is a system defect masquerading as a palette choice, and it is cheap to fix.

- Change: Delete `statusTone` and `toneColors` (ProjectAssetsView.jsx:2340-2356). One StatusBadge component takes a semantic token and renders dot, fill, border and label from one source, so a status colour can never be written inline again. Map the nine statuses onto the system's success / warning / danger / neutral plus one signal, which also retires the second amber and the second green.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1067` — `style={{ ...flatSelect, color: sc }}>   // sc = statusColor(asset.status)`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1905` — `tone={statusTone(asset.status)}`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2350` — `case 'good':   return { bg: '#1c1917', fg: '#86efac', border: '#15803d' }`




**R4-06 · HIGH · System** — Two tables stacked inside one modal use opposite chrome, about 200px apart  
law: Law of Common Region

- Problem: In AssetDetailPopup the tasks table has a #292524 header with 11.5px stone uppercase Th and transparent rows. Directly below it the files table has a #44403c header with 9px ORANGE uppercase Th, and its rows are #292524 fills separated by #1c1917 lines, which is the page colour used as a divider. The two are visible at the same time.

- Why it matters: This is the clearest single screenshot of the whole problem: one modal, two table languages, and the lower one inverts figure and ground relative to the upper one. Nothing about files justifies a different table from tasks.

- Change: Both become src/ui/Table. Header fill is paper-raised, header type is the Label step in ink at 48 percent (never the accent), rows are transparent on paper with hairline dividers. The file table loses its orange header entirely; orange stops being a way to say "this is a header".

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2098` — `<tr style={{ backgroundColor: '#292524', borderBottom: '2px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:939` — `<tr style={{ backgroundColor: '#44403c' }}>`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:967` — `<tr key={f.id} style={{ borderBottom: '1px solid #1c1917', backgroundColor: '#292524' }}>`




**R4-07 · HIGH · System** — The identical table-or-gallery toggle has two different active treatments on the same screen  
law: Law of Similarity

- Problem: The assets toolbar renders a bordered segmented control whose active half is a solid #ea580c fill with #fff7ed text and a 10.5px label. The FileManager inside the asset detail popup renders the same toggle as two unlabelled 12px icons whose active state is a #44403c fill with #fb923c ink. Both are on screen together when a detail popup is open over the table.

- Why it matters: This is Audrey's uniformity complaint in its purest form. Same control, same two states, same tool, two visual languages, and one of them uses the border colour as an active fill so "active" reads as "disabled".

- Change: One src/ui/Tabs used for both: 14px sentence case, weight 400 inactive and 600 active, one 2px signal underline, no fill. Content-layer elements stop borrowing #ea580c, which is the frame's colour.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:432` — `backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent',`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:821` — `color: viewMode === 'table' ? '#fb923c' : '#78716c', backgroundColor: viewMode === 'table' ? '#44403c' : 'transparent',`




**R4-08 · HIGH · Hierarchy** — The file manager's primary action is a 20px tall button with 10px text  
law: Fitts's Law

- Problem: Add files is `px-2 py-0.5 text-[10px]`, which computes to roughly 20px of height and a 10px uppercase tracked label, inside a section whose whole purpose is adding files. The New asset button that does the equivalent job one level up is `px-4 py-1.5 text-[11.5px]`, roughly 28px.

- Why it matters: Fitts's Law, directly: the one control this section exists for is the smallest control in it, and it sits at the far right of a header row where the cursor never is after reading a file list. It is also the reason the files section reads as an afterthought glued to the bottom of the asset popup.

- Change: Add files becomes Button primary size md at 36px with a 14px sentence-case label and a 16px icon, anchored left in a 44px Toolbar above the table, where the eye enters the section. Every other control in that header drops to the 28px sm size so the row has one baseline.

- Evidence: `src/tools/rabbit_v0.1.0/components/FileManager.jsx:804` — `className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm hover:brightness-110"`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:497` — `className="flex items-center gap-1.5 px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm"`




**R4-09 · HIGH · Hierarchy** — The widest modal in the surface has the smallest title

- Problem: AssetDetailPopup is max-w-6xl (1,152px) and titles itself with InlineText, which renders at text-xs, 12px. The Levels and Experiences detail popups, at max-w-4xl (896px), title themselves at 14px bold. The New Asset modal titles itself at 13.5px, RelationPickerPopup at 13px, NewTaskSidePopup at 13px, ConfirmDialog at 13.5px, RelinkDialog at 12.5px, FileAuditDrawer at 12.5px.

- Why it matters: Seven dialogs, six title sizes, and they run in the opposite direction to the dialogs' importance. A 1,152px modal holding four sections needs the largest title on the surface, not the smallest.

- Change: Every dialog title is the H2 step, 16px sentence case weight 600, with the entity icon at 16px, regardless of dialog width. The editable-name behaviour of the asset title stays; only its type changes.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1825` — `<InlineText value={asset.name || ''} ... placeholder="Untitled Asset" />`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2277` — `className="text-xs font-mono text-left w-full truncate hover:bg-stone-700 px-1 py-0.5 rounded"`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:773` — `<span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>`




**R4-10 · HIGH · Job** — AssetDetailPopup carries four co-equal jobs and three nested toolbars  
**constraint: touches-interaction** · law: Cognitive Load

- Problem: One 1,152px modal holds: a 320px relations sidebar with its own collapsible sections and link buttons, a 120px thumbnail block with two buttons, a 13-cell property grid, a tasks table with four editable selects per row, and a complete FileManager with its own header, its own add button, its own view toggle and its own table. Nothing is visually senior to anything else.

- Why it matters: With no dominant element the modal is read as a wall. Working Memory and Cognitive Load both bite here: the user opened it to change one thing and has to locate that thing among four sections that all present at the same volume.

- Change: Keep all four sections and their behaviour. Give the modal one visual spine: a 56px header (icon, 16px editable name, StatusBadge, close), then the property grid as the first and only full-width block, then Tasks and Files as SectionTitle-led regions with a hairline above each and no inner toolbar chrome of their own beyond one right-aligned action. The relations sidebar keeps its column but loses its per-section boxes in favour of hairline-separated groups, so the eye reads one page rather than six panels.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1839` — `<AssetRelationsSidebar asset={asset} ctx={ctx} />`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1892` — `<div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2122` — `<FileManager files={ctx?.managedFiles || []} assetId={asset.id} ... mode="full" />`




**R4-11 · HIGH · Uniformity** — LevelsView and ExperiencesView are a 1,295-line verbatim twin that has already drifted three times

- Problem: Normalising entity names, the two files differ in eleven places, of which three are visual: the detail popup's Status select is 12.5px in Levels and 11.5px in Experiences, and both date inputs use focus:ring-2 in Levels and focus:ring-1 in Experiences. Everything else, including the filter panel, the saved-views dropdown, the bulk select, InlineText, PopupInlineText, FieldLabel and ConfirmDialog, is duplicated character for character.

- Why it matters: This is the drift mechanism the whole overhaul exists to stop, caught in the act. Any fix applied to one file is half applied, and the two views are guaranteed to diverge further with every session that touches one of them.

- Change: Extract one EntityListView that Levels and Experiences render with props (entity noun, icon, statuses, ctx methods, storage key). If that is judged too large for a visual pass, the fallback is to apply the kit twice and add a test asserting the two files are identical after entity-name normalisation, so the next drift fails CI instead of shipping.

- Evidence: `src/tools/rabbit_v0.1.0/views/LevelsView.jsx:846` — `className="w-full px-2.5 py-1.5 text-[12.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"`<br>`src/tools/rabbit_v0.1.0/views/ExperiencesView.jsx:846` — `className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:865` — `... text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500   // Experiences:865 says ring-1`




**R4-12 · HIGH · System** — Thirteen hand-rolled overlays, four backdrop values, three z-bands, three panel borders  
law: Law of Prägnanz

- Problem: This surface builds its own modal thirteen times. Backdrops are rgba(0,0,0,0.6) eleven times, rgba(0,0,0,0.5) three times, rgba(0,0,0,0.72) once and rgba(28,25,23,0.6) once. Panels are variously 2px #f97316, 2px #ef4444, or 1px #44403c. Shadows are 0 20px 60px rgba(0,0,0,0.5) in most, 0 0 60px rgba(0,0,0,0.6) in RelinkDialog, 0 8px 24px in the dropdowns, and none at all in AssetStatusWarningModal and VideoPreview. Radii run rounded-sm, rounded and rounded-lg across the same set.

- Why it matters: Every dialog on this surface is a different object, so the tool has no idea what a dialog is. It also means Escape handling, backdrop click and busy locking are reimplemented per site, and they are not all the same (VideoPreview correctly tracks where a press began; the others close on any backdrop click, so dragging a scroll bar out of a modal dismisses it).

- Change: Promote binUi's Modal to src/ui/Dialog unchanged, including the modal stack, topmost-only Escape, busy lock and onBeforeClose guard, and route all thirteen through it: one backdrop rgba(12,10,9,0.6), one surface, 8px radius, one floating shadow, header / body / footer. Keep the z bands 50 / 60 / 70 as they are, since the detail popup mounts FileManager which mounts VideoPreview and the stacking is load bearing.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1482` — `<div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />`<br>`src/tools/rabbit_v0.1.0/components/VideoPreview.jsx:116` — `style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}`<br>`src/tools/rabbit_v0.1.0/components/AssetStatusWarningModal.jsx:41` — `style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}`<br>`src/tools/rabbit_v0.1.0/components/RelinkDialog.jsx:119` — `backgroundColor: '#1c1917', border: '1px solid #44403c', boxShadow: '0 0 60px rgba(0,0,0,0.6)'`




**R4-14 · HIGH · Uniformity** — No footer bar anywhere in part 4, which is Audrey's named example; the counts float in the toolbar instead  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: BinsView ends in a 34px footer bar with a hairline top, a recessed fill, Kbd hints and a right-aligned count. Nothing on this surface has one. The assets view instead prints "12/47" as a 10.5px uppercase tracked label wedged between the search box and the New asset button, and Levels and Experiences copy that placement. None of these views register any document-level keys, so there is currently nothing to hint.

- Why it matters: This is the exact gap Audrey called out: one tool in the ecosystem got a shortcut bar and nothing else did. The bar is also the right home for the record count, which is metadata about the whole view and does not belong inside a control strip where it competes with the primary action.

- Change: Promote BinsView's footer to src/ui/ShortcutBar at 28px with a hairline top, Kbd at the 11px Label step, groups separated by 24px, and a right-aligned count slot. Mount it in the assets, levels and experiences views carrying the count immediately, with no keys. Adding the keys themselves (arrow navigation, Del, Ctrl+Z) is a separate decision because it changes interaction; flagged here so Audrey can rule on it.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgroundColor: C.deep, minHeight: 34, paddingLeft: 30 }}`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:491` — `<span className="text-[10.5px] font-mono uppercase tracking-wider px-1" ...>{processed.length}/{assets.length}</span>`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:377` — `<span className="text-[10.5px] font-mono uppercase tracking-wider px-1" ...>{sorted.length}/{levels.length}</span>`




**R4-15 · HIGH · Colour** — Thirty-nine hex values on this surface, twelve of which encode state, two of them cool hues the app's own rule bans  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: Counted across the eleven files: 39 distinct hex. State alone uses #4ade80 approved, #22c55e final, #86efac (the second green, from toneColors), #fbbf24 pending_review, #fcd34d on_hold, #fb923c in_progress, #e879f9 needs_revisions, #ef4444 blocked, #fca5a5 danger-on-dark, #f87171 (a third red in RelinkDialog), #57534e omitted and #a8a29e not_started. #e879f9 is a fuchsia and #a78bfa a violet, both cool, in a system whose own written rule is "warm over cool, no blues, no cyans".

- Why it matters: Two ambers that differ by a hair mean pending_review and on_hold are indistinguishable in a 32px chip; two greens mean approved and final are too. Meanwhile the violet reviewer select is the only cool hue in R.A.B.B.I.T. and it is doing no work colour could not do with position. Hierarchy is being asked of the palette because the type scale cannot supply it.

- Change: Reduce to the system's four functional values plus one signal, applied through StatusBadge: success for approved and final (they separate by label and by a filled-versus-outlined badge, not by hue), warning for pending_review, needs_revisions and on_hold, danger for blocked, neutral ink at 48 percent for not_started and omitted, signal for in_progress. Retire #a78bfa from the reviewer select and #e879f9 from the status ladder.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:141` — `case 'needs_revisions': return '#e879f9'`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2193` — `style={{ backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid transparent', maxWidth: '120px' }}`<br>`src/tools/rabbit_v0.1.0/components/RelinkDialog.jsx:228` — `<PreviewGroup label={'Still missing (${match.unmatched.length})'} color="#f87171">`




**R4-26 · HIGH · Build** — Clicking a related asset in a Level or Experience detail popup does nothing  
**constraint: touches-interaction** · law: Paradox of the Active User

- Problem: Both views pass `onOpenAsset={id => setNestedAssetId(id)}` to RelationsPanel. In LevelsView the resulting state is read only by `hasLeftSide`, which is itself never used; in ExperiencesView it is never read at all. No component renders a nested asset. The rows still show a pointer cursor and a hover fill, so they advertise a click that has no effect.

- Why it matters: It is a dead affordance on a surface whose whole purpose is navigating between related things, and the visual pass will make it worse by making those rows look more clickable. Also note that the twin's own drift removed the unused variable from one file and not the other, which is R4-11 again.

- Change: Either render a nested asset popup beside the level popup the way nestedTaskId already does, or remove the click affordance from the asset rows in this context. Flagging rather than deciding, because either choice changes behaviour.

- Evidence: `src/tools/rabbit_v0.1.0/views/LevelsView.jsx:724` — `const hasLeftSide = showCreateTask || nestedTaskId || nestedAssetId`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:792` — `onOpenAsset={id => setNestedAssetId(id)}`<br>`src/tools/rabbit_v0.1.0/views/ExperiencesView.jsx:690` — `const [nestedAssetId, setNestedAssetId] = useState(null)   // never read`




**R4-37 · HIGH · Flow** — The assets toolbar presents ten controls and five dropdowns before any data is visible  
**constraint: touches-interaction** · law: Hick's Law

- Problem: Left to right: Filter, a seven-option sort select, a sort-direction toggle, a divider, a four-option group select, a divider, a two-way view toggle, a three-way thumbnail-size toggle, a Views dropdown with its own save and delete affordances, a divider, a search field, a count, and New asset. Every one of them is presented at the same volume, in the same 10.5px uppercase, and none of them is the primary action.

- Why it matters: Hick's Law bites hardest here because the decision is not "which control" but "is any of this relevant to what I came to do", and thirteen equally weighted objects make that decision slow every single time the view opens. Serial Position also says the two most memorable slots, first and last, are currently spent on Filter and New asset, which is half right.

- Change: Three groups with progressive disclosure that keeps every control reachable. Left: search (the most-used control, promoted to first position and given real width). Centre: one View button that opens a popover holding Filter, Sort, Group and Saved views, badged with the count of active modifiers, so the strip shows state without showing every control. Right: the view toggle, the density toggle, then New asset as the only filled button. Ten visible objects become five.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:387` — `<div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:466` — `<AssetSavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={...} />`




**R4-41 · HIGH · Typography** — The file manager runs its entire body at 9 and 10px: eighteen of its twenty sized elements

- Problem: Measured: nine uses of text-[9px], nine of text-[10px], two of text-[11px], and nothing larger anywhere in the component. That includes the section title, the add button, every table header, the version chip, size, date, the progress label, both notice banners, the error banner, and every gallery card label.

- Why it matters: This is the component Audrey is looking at when she says the files database looks atrocious, and the measurement explains why: it is an entire functional area rendered below the legibility floor, in a fallback monospace, on the smallest surface in the app. Nothing about the type here is a choice; it is what happened when a component was squeezed into the bottom of a modal.

- Change: Apply the scale with no exceptions: section title 16, add button label 14, table headers Label 11, cells Dense 13, size and date Dense 13 tabular, version chip Label 11, notices Body 14. The section gets more vertical space because it needs it, which is the correct trade against a 108px-tall thumbnail row elsewhere.

- Evidence: `src/tools/rabbit_v0.1.0/components/FileManager.jsx:767` — `<span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#fb923c' }}>Files ({assetFiles.length})</span>`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:909` — `<span className="text-[9px] font-mono truncate" style={{ color: '#a8a29e', maxWidth: 200 }}>`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:1116` — `<span className="text-[10px] font-mono truncate" style={{ color: '#d6d3d1' }}>`




**R4-13 · MEDIUM · System** — Eleven empty states, eight type sizes, five of them uppercase, one that renders nothing at all

- Problem: AssetTable empty is a 48px icon plus 13.5px plus 11.5px. AssetGallery empty is the same icon plus one 13.5px line. LevelTable and LevelGallery are a bare 12.5px uppercase line. FileManager is a 24px icon plus 11px italic with a double-hyphen dash. RelationsPanel sections are 9.5px uppercase. RelationPickerPopup is 10.5px uppercase. AssetPickerOverlay is 10px uppercase. FileAuditDrawer is 11.5px sentence case. ProjectFilesTable returns null.

- Why it matters: Empty is the state a new user meets first, and it is where the product either explains itself or looks broken. Uppercase tracked 9.5px is a label treatment applied to a sentence, and `return null` means a whole table silently is not there with nothing saying why.

- Change: One src/ui/EmptyState: 24px icon, 14px sentence-case title, 13px body, optional action slot. Sentence case, never uppercase. ProjectFilesTable gets a real empty state instead of returning null. Never used for a loading state, which is R4-40.

- Evidence: `src/tools/rabbit_v0.1.0/components/FileManager.jsx:929` — `<span className="text-[11px] font-mono italic" ...>No files yet -- click "Add files" to get started.</span>`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:139` — `<p className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>No assets linked</p>`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:91` — `if (files.length === 0) return null`




**R4-16 · MEDIUM · Alignment** — The toolbar has no control-height token; six control heights land between 26 and 30px  
law: Law of Uniform Connectedness

- Problem: Every control in the assets toolbar derives its height from padding plus an arbitrary font size. The Filter button and the sort, group and view-mode controls come out near 27px. The thumbnail-size selector is three `w-7 h-7` buttons inside a 1px-bordered wrapper, so 30px, and it sits immediately beside the 27px view-mode control. The sort-direction button is `p-1.5` around a 14px icon with no border, so 26px. The search field is 27px and New asset is 28px.

- Why it matters: A toolbar reads as one object only when its children share a baseline and a height. Two segmented controls sitting side by side, three pixels apart in height, is visible at a glance and is the first thing that makes a strip look assembled rather than designed.

- Change: Toolbar is 44px with a 24px gutter and a hairline bottom. Every child is exactly 28px (the sm control size), including the icon-only buttons, which get a fixed 28x28 box. Heights come from a token, never from padding plus font size.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:452` — `className="flex items-center justify-center w-7 h-7 transition-colors"`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:430` — `className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:407` — `className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"`




**R4-17 · MEDIUM · Alignment** — Numeric columns are left-aligned in one table, centred in another, and never right-aligned or tabular

- Problem: The assets table's Tasks count is a left-aligned span in a flex:0.6 column under a left-aligned header. The Levels and Experiences Assets and Tasks counts are centred in fixed w-16 columns. File sizes in FileManager are left-aligned mono. The only tabular-nums on the entire surface is RelationBadge, which is never rendered (see R4-27).

- Why it matters: Numbers compare by their right edge. Centred counts of mixed digit width jitter column to column, and a left-aligned count under a left-aligned header cannot be scanned for outliers, which is the only reason a count column exists.

- Change: Table's Td takes align="right" and applies font-variant-numeric: tabular-nums plus the mono family for every numeric column: counts, sizes, durations, bid days, bytes. Headers of right-aligned columns right-align too.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1110` — `return <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>{taskCount}</span>`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:582` — `<span className="w-16 text-[11.5px] font-mono text-center" style={{ color: '#a8a29e' }}>`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:1110` — `<span className="text-[9.5px] font-mono tabular-nums">{count}</span>`




**R4-18 · MEDIUM · Typography** — Title Case, sentence case and UPPERCASE all appear as the label treatment, sometimes for the same word

- Problem: The sort dropdown offers "Start date" and the field label two hundred lines away reads "Start Date". Buttons say "New asset" and "New level" while the modals they open title themselves "Create New Asset", "New Level", "New Experience" and "New Task". On top of that, almost every label, heading, button and chip is uppercase with tracking-wider.

- Why it matters: Casing is a signal about rank. When headings, buttons, table headers, chips and status pills are all uppercase tracked at 9 to 12px, none of them signals anything, and the Title Case modal titles read as a different product from the sentence-case buttons that open them. The visual-language doc already says sentence case for everything but system labels; the surface does the opposite.

- Change: Sentence case everywhere except the Label role (table headers, field labels, eyebrows, Kbd, status badges), which is the only uppercase that survives and carries +0.06em. "Start date" is the one spelling. "New asset" opens a dialog titled "New asset".

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:101` — `{ value: 'start_date', label: 'Start date' },`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1560` — `<label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" ...>Start Date</label>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1500` — `Create New Asset`




**R4-20 · MEDIUM · System** — Four inline text editors doing one job, at four sizes, with two different commit rules  
law: Law of Similarity

- Problem: ProjectAssetsView defines InlineText (text-xs, 12px) and CellInlineText (11.5px). LevelsView and ExperiencesView each define InlineText (11.5 or 12.5px via a size prop) and PopupInlineText (13.5px). The Levels pair trims the draft before committing; the Assets pair does not. All four implement the same Enter-commits, Escape-reverts, blur-commits contract by hand.

- Why it matters: Click a name in the assets table and you get one editor; click a name in the level detail and you get a different one, a pixel size apart, with different whitespace behaviour. The Escape-reverts behaviour is the best input interaction in the app and it is currently reimplemented four times, which means it will eventually be four different behaviours.

- Change: One src/ui/Input plus one InlineEdit wrapper promoted from binUi, with the Dense 13px step in cells and Body 14px in dialogs, trimming on commit, and the Escape-reverts rule in one place. Delete all four local copies.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2241` — `function InlineText({ value, onCommit, placeholder, readOnly = false }) {`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2286` — `function CellInlineText({ value, placeholder, onCommit, readOnly = false }) {`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:1234` — `const trimmed = draft.trim() if (trimmed !== value) onCommit(trimmed)`




**R4-21 · MEDIUM · Density** — The 3x thumbnail setting produces a 108px row holding one line of 11.5px text

- Problem: THUMB_SIZES multiplies the 36px base row by 2 and 3, and the row's minHeight follows, but nothing else in the row scales: the name, the selects, the dates and the description stay at 11.5px, vertically centred in a 108px band. Roughly 90px of every row is empty.

- Why it matters: This is emptiness rather than structural whitespace: the space appeared because an image got bigger, not because the content needed breathing room. Three rows fill the viewport and the table stops being a table.

- Change: Keep all three sizes and the control. At 2x and 3x, promote the row to a two-line layout (name at Dense 13 weight 600 over a Caption 12 metadata line) so the extra height carries information, and cap the cell padding so the text block sits at the top of the thumbnail rather than floating in the middle of it.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:49` — `const THUMB_SIZES = { sm: { label: '1×', h: BASE_ROW_H }, md: { ... h: BASE_ROW_H * 2 }, lg: { ... h: BASE_ROW_H * 3 } }`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1145` — `minHeight: effectiveH,`




**R4-22 · MEDIUM · Density** — Two row languages: bordered 4px-radius cards with gaps in Assets, hairline rows with a 3px status spine in Levels  
_taste, not error_ · law: Law of Common Region

- Problem: AssetRow is a card: 1px border on all four sides, borderRadius 4, inside a container with `gap-1 p-3`, so rows are separated by 4px of background. LevelTable and ExperienceTable are classic rows: a 1px bottom border, a 3px left border in the status colour, no gap, no radius.

- Why it matters: Two tables in one tool, one reading as a stack of boxes and one as a list. The card treatment also costs 4px of vertical rhythm per row for no information, and the per-row border is what makes the table read as heavy. Notion, Frame.io and Obsidian all use the hairline row.

- Change: One row: transparent, 36px, hairline divider, no radius, one hover fill, and for the selected state a fill plus a 2px signal left border. Adopt the Levels status spine as an option on Table rather than as a per-view invention. I would call the card-versus-row choice taste, but the fact that both exist in one tool is not.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1141` — `border: isSelected ? '1px solid #ea580c' : '1px solid #44403c', borderRadius: 4,`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:547` — `style={{ borderBottom: '1px solid #292524', borderLeft: '3px solid ${statusColor(lv.status)}' }}`




**R4-23 · MEDIUM · System** — The same relations sidebar is 360px in one export and 320px in the other, in one file

- Problem: RelationsPanel, used by the Level and Experience detail popups, is 360px wide. AssetRelationsSidebar, used by the asset detail popup, is 320px. Both are a left column of collapsible relation groups with a 1px right border on #1c1917, defined 590 lines apart in the same file.

- Why it matters: Open a level, then open an asset from it, and the left column jumps 40px. Panel widths are one of the few dimensions a user perceives absolutely, because the content edge moves.

- Change: One src/ui/Panel with width tokens 200 / 240 / 300; both sidebars take 300. One hairline, one 32px header at the Label step, no per-section boxes.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:110` — `style={{ width: 360, borderRight: '1px solid #44403c', backgroundColor: '#1c1917' }}`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:702` — `style={{ width: 320, borderRight: '1px solid #44403c', backgroundColor: '#1c1917' }}`




**R4-24 · MEDIUM · System** — Composite two-glyph icon buttons at 10px each, in an 18px target, found nowhere else in the app  
law: Fitts's Law

- Problem: The Scenes and Shots section header carries two buttons, each drawn as a 10px entity glyph immediately followed by a 10px plus sign: Film+Plus and Clapperboard+Plus. They sit inside p-1, so the hit target is roughly 18x18, and they are nested inside the section's own header button.

- Why it matters: Fitts's Law on an 18px target holding two 10px glyphs is bad enough; the bigger problem is that this composite-icon idea exists exactly twice in WILSON and is therefore not a pattern, it is a one-off. It also reads as a rendering artefact rather than a control.

- Change: One 28px icon button with a single Plus and a tooltip, or a single Plus that opens a two-item menu (Link scene / Link shot). Icons at 16px inside 28px targets, matching the rest of the kit.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:726` — `<Film className="w-2.5 h-2.5" /><Plus className="w-2.5 h-2.5" />`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:733` — `<Clapperboard className="w-2.5 h-2.5" /><Plus className="w-2.5 h-2.5" />`




**R4-25 · MEDIUM · Typography** — The relations sidebar sets its status badges at 8px and 7px, the smallest type in R.A.B.B.I.T.

- Problem: Related asset, task, level, experience and orphan-shot rows carry an 8px uppercase tracked status badge; the shots nested under a scene carry a 7px one, because the nesting was expressed by shrinking the type. Item names in the same rows are 11px and the section counts are 10.5px.

- Why it matters: Depth is being encoded as size, which runs out immediately: one more nesting level and the badge is 6px. The badge is also the only place in the sidebar where state appears, so the least legible element carries the most important datum.

- Change: One StatusBadge at the Label step, 11px, identical at every depth. Nesting is expressed by indentation and the existing hairline spine, which already does the job at RelationsPanel.jsx:790. Names go to Dense 13, counts to Caption 12.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:799` — `<span className="px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider rounded flex-shrink-0"`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:775` — `<span className="text-[8px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>`




**R4-27 · MEDIUM · Build** — RelationBadge is exported, imported and never rendered, and it is the component the relation fields needed

- Problem: RelationsPanel exports RelationBadge (icon plus count, active and inactive treatments, the only tabular-nums on the surface). ProjectAssetsView imports it at line 44 and never uses it. Meanwhile the asset detail popup renders four hand-built relation buttons that print "3 scene(s)" or "--" in a 12px mono button.

- Why it matters: This is the repo's known no-caller pattern, and here it costs design quality directly: the designed component is sitting unused while four bespoke buttons do its job worse, with a literal "(s)" pluralisation in the label.

- Change: Render RelationBadge in the four relation fields (Scenes, Shots, Levels, Experiences), restyled to the Chip spec: Label 11, 4px radius, one active treatment, count in tabular mono. Remove the "(s)" strings; the badge shows icon plus number.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:44` — `import { RelationPickerPopup, RelationBadge, AssetRelationsSidebar } from '../components/RelationsPanel'`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1993` — `{(asset.scene_ids?.length || 0) > 0 ? '${asset.scene_ids.length} scene(s)' : '--'}`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:1100` — `export function RelationBadge({ icon: Icon, count, label, onClick }) {`




**R4-28 · MEDIUM · Colour** — The assets table's date inputs do not set colorScheme dark, so the native picker renders light on a dark row

- Problem: Every date input in ProjectAssetsView (table cells, New Asset modal, detail popup) sets background, colour and border but omits `colorScheme: 'dark'`. The equivalent inputs in LevelsView, ExperiencesView and NewTaskSidePopup all set it.

- Why it matters: The browser paints the calendar glyph and the whole picker panel from colorScheme. On the darkest table in the app, six date cells per screen show a light-mode calendar icon, and opening one drops a white panel onto #1c1917. It is the single most obviously unfinished detail in the assets table.

- Change: Set colorScheme: 'dark' on every date input on dark surfaces, from one Input component so it cannot be forgotten again.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1088` — `style={{ backgroundColor: 'transparent', color: asset.start_date ? '#d6d3d1' : '#57534e', border: '1px solid transparent' }}`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:868` — `border: '1px solid #44403c', colorScheme: 'dark',`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:556` — `style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}`




**R4-29 · MEDIUM · Colour** — #44403c is the hairline colour everywhere and a surface fill in four places

- Problem: The file table's header row, the version chip in both the file table and the file gallery card, and the Pending tasks header in AssetStatusWarningModal all use #44403c as a background. Everywhere else on the surface (about 64 uses in ProjectAssetsView alone) it is a 1px border.

- Why it matters: When a border value becomes a fill, panels stop reading as panels: a #44403c block on #1c1917 looks like a thick rule that has swollen, and the 9px orange text sitting on it has nowhere to go. It also breaks the elevation logic, because #44403c is lighter than the raised surface #292524 that should be carrying these.

- Change: Header fills and chips take paper-raised. #44403c disappears entirely as both a fill and a border, replaced by the `rule` token, a screen of the ink, so panels stop looking like boxes drawn in grey.

- Evidence: `src/tools/rabbit_v0.1.0/components/FileManager.jsx:1042` — `<span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ color: '#fb923c', backgroundColor: '#44403c' }}>`<br>`src/tools/rabbit_v0.1.0/components/AssetStatusWarningModal.jsx:90` — `style={{ color: '#fb923c', borderBottom: '1px solid #44403c', backgroundColor: '#44403c' }}`




**R4-30 · MEDIUM · Colour** — The status-mismatch modal prints every status in green, whatever the status is

- Problem: AssetStatusWarningModal renders the asset's status in a chip hard-coded to #86efac on #15803d, with no reference to statusColor. It is reachable for any status, since the warning triggers on child-task state, so a blocked or on_hold asset can be shown with a green status chip in a red-bordered warning dialog.

- Why it matters: It is the same defect as R4-05 in its most visible form: a status colour written inline instead of derived. A green chip inside a warning also actively contradicts the dialog's message.

- Change: Replace with StatusBadge taking the asset's own status token. The pending-task chips two rows below (hard-coded #fb923c on #57534e) take the same component.

- Evidence: `src/tools/rabbit_v0.1.0/components/AssetStatusWarningModal.jsx:75` — `style={{ backgroundColor: '#1c1917', color: '#86efac', border: '1px solid #15803d' }} {asset.status}`<br>`src/tools/rabbit_v0.1.0/components/AssetStatusWarningModal.jsx:106` — `style={{ backgroundColor: '#292524', color: '#fb923c', border: '1px solid #57534e' }}`




**R4-31 · MEDIUM · System** — ProjectFilesTable carries two complete visual languages behind a boolean, and renders nothing when empty

- Problem: A single `const w = variant === 'warm'` switches header size 11 or 9, cell size 13 or 10, cell padding 10px/14px or 6px/8px, checkbox 16 or 14, icon 15 or 13, six colour pairs, zebra striping on or off, and border colour. The dark variant runs its body at 10px. The component also returns null for an empty list.

- Why it matters: This is the drift mechanism written as a feature: one component that is two designs, so a fix to one arm silently leaves the other. The dark arm at 10px is also below the legibility floor, and it is one of the three file tables Audrey is comparing.

- Change: Convert to src/ui/Table with a surface prop that changes tokens only, not sizes, paddings or zebra. One row height, one cell padding, one type scale for both page classes. Zebra goes; hairlines do the grouping. Add an EmptyState.

- Evidence: `src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:96` — `const hdr = { fontSize: w ? 11 : 9, ... padding: w ? '10px 14px' : '7px 8px', ... }`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:145` — `backgroundColor: w ? (i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)') : '#1c1917',`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:91` — `if (files.length === 0) return null`




**R4-32 · MEDIUM · Typography** — RelinkDialog's prose runs about 85 characters per line at 11.5px mono

- Problem: The dialog is 640px wide with 16px side padding. Its explanatory paragraphs are 11.5px mono, which at roughly 6.9px per character gives about 85 characters per line, and the base-change warning paragraph is a four-line block at the same measure.

- Why it matters: Above 75 characters the eye loses the line return, and mono makes it worse because every character is the same width so there are no word-shape landmarks. This is the one place on the surface with real prose and it is the hardest thing here to read.

- Change: Prose in dialogs is Body 14 in the sans face, not mono, capped at 66ch. Mono keeps only the paths, which is exactly what it is for and where it already earns its place in this dialog.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelinkDialog.jsx:118` — `style={{ width: 640, maxWidth: 'calc(100vw - 48px)', ... }}`<br>`src/tools/rabbit_v0.1.0/components/RelinkDialog.jsx:147` — `<p className="text-[11.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>`<br>`src/tools/rabbit_v0.1.0/components/RelinkDialog.jsx:186` — `<p className="text-[10.5px] font-mono leading-relaxed px-3 py-2 rounded"`




**R4-33 · MEDIUM · Alignment** — The group header exists at three paddings, and its accent bar does not line up with the rows it heads  
law: Law of Common Region

- Problem: In the assets table the group header is px-3.5 inside a p-3 container, so its 3px accent sits 12px from the panel edge while the rows it heads sit 12px in as well but carry their own 1px border. In the assets gallery the same header is px-5. In Levels and Experiences it is px-5 over rows that start at px-4.

- Why it matters: A group header's only job is to bracket the rows beneath it. Three left edges for one component means the bracket is visibly loose in every mode, and the accent stripe points at nothing.

- Change: One SectionTitle used for group headers, flush to the same 24px page gutter as the rows, hairline above rather than below, 16px sentence case, count in Caption 12. If the status accent is kept it becomes the row spine, aligned to the row's left edge.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:902` — `<div className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-stone-800/30"`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:543` — `<div className="flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-stone-800/30"`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:418` — `<div className="flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-stone-800/30"`




**R4-34 · MEDIUM · Hierarchy** — The multi-select checkbox is invisible at rest in Assets and always visible in Levels  
law: Paradox of the Active User

- Problem: AssetRow's checkbox is `opacity: isSelected || hovered ? 1 : 0`, so the whole selection column is blank until the pointer enters a row. LevelTable and ExperienceTable render the same checkbox at full opacity always. The select-all control in the header is always visible in both.

- Why it matters: Two answers to one question in one tool, and the hidden version leaves a 36px empty gutter down the left of the table with a visible select-all control at the top of it, which reads as a rendering fault. Bulk editing is the assets table's highest-value affordance and it is the one thing the table does not admit to having.

- Change: Pick one and apply it everywhere. Recommended: the HoverActions pattern, revealed on row hover AND focus-within, but with the column reserving its width and the select-all header checkbox always visible, so the gutter is never empty and keyboard users can reach it.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1153` — `style={{ opacity: isSelected || hovered ? 1 : 0, transition: 'opacity 150ms ease' }}`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:550` — `<span className="w-8 flex items-center justify-center cursor-pointer" onClick={() => toggleOne(lv.id)}>`




**R4-35 · MEDIUM · System** — Preview imagery appears at five geometries and two aspect ratios for one concept  
law: Law of Similarity

- Problem: The asset table thumbnail is a 36, 72 or 108px square; the asset gallery card image is a full-width 144px band; the asset detail thumbnail is a 120px square; the level and experience detail thumbnail is 142x80; FileThumbnail is a 32px or 120px square. The gallery grids are minmax(220px) for assets and minmax(140px) for files, with the level and experience gallery cards at a fixed 160, 220 or 300 with a 0.6 height ratio.

- Why it matters: An asset's picture is one idea and it changes shape five times as you move through the surface, so nothing is recognisable between views. The two aspect ratios also mean the same source image is cropped differently depending on where you look at it.

- Change: One aspect ratio for entity previews, 16:9, at three sizes: 32px tall in dense rows, 120px in cards, 180px in detail. One card width token for every gallery on the surface. The crop then matches everywhere and a thumbnail becomes recognisable across views.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1275` — `className="h-36 flex items-center justify-center relative overflow-hidden"`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1848` — `style={{ width: 120, height: 120, backgroundColor: '#1c1917', border: '1px solid #44403c' }}`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:803` — `style={{ width: 142, height: 80, backgroundColor: '#1c1917', border: '1px solid #44403c' }}`




**R4-38 · MEDIUM · Flow** — The New Asset dialog weights eight fields equally when only one is required  
**constraint: touches-interaction** · law: Hick's Law

- Problem: Name, Type, Status, Phase, Start date, Due date, Description and Task template are laid out as eight identically styled blocks with identical 9.5px labels, followed by a task preview panel. Only Name is required, and the Confirm button is disabled until it is filled.

- Why it matters: The dialog already knows what matters, and does not say so. Every field asks for a decision at the same volume, which is the definition of a Hick's Law hotspot in a creation flow, and the required field is marked only by an asterisk in a 9.5px label.

- Change: Name gets the Body 14 input at 36px with an H3 label, alone, at the top. Type and Status follow as a single row of two. Everything else moves under a "More details" disclosure that is closed by default and shows a count when populated. Nothing is removed and nothing becomes unreachable.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1514` — `<label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Name *</label>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1660` — `disabled={!draft.name.trim() || creating}`




**R4-39 · MEDIUM · Flow** — The asset detail property grid shows up to thirteen fields, four of which usually read as an empty dash  
law: Chunking

- Problem: Type, Status, Phase, Tasks, Task Template, Start Date, Due Date, Description, Created, Updated, plus Scenes, Shots, Levels and Experiences when their project flags are on. The four relation fields render "--" until something is linked, and Created and Updated are read-only dates presented with the same label treatment as the editable fields.

- Why it matters: Thirteen fields at one volume, several of them empty and two of them not editable at all, is a wall rather than a form. It is also unclear which cells can be changed, because read-only values and editable controls share a label style and a size.

- Change: Two groups separated by a hairline: the six editable properties first, then a metadata group (Tasks, Created, Updated) at Caption 12 with no label chrome. The four relation fields become RelationBadge chips in one wrapped row, so zero links costs one line instead of four rows of dashes. Read-only values lose the field-well treatment so they stop looking like inputs.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1892` — `<div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1984` — `{asset.created_at && <PropField label="Created" value={new Date(asset.created_at).toLocaleDateString()} />}`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2011` — `{(asset.level_ids?.length || 0) > 0 ? '${asset.level_ids.length} level(s)' : '--'}`




**R4-40 · MEDIUM · System** — Loading and empty look identical in the file manager, and the video player loads into a void  
law: Doherty Threshold

- Problem: While files are loading, FileManager renders neither a table nor its empty state (the empty block is gated on `!copying`), so the section is simply absent. VideoPreview shows a bare 20px spinner centred in a 480x270 black box with no filename and no indication of what is opening. FileAuditDrawer shows the word Loading at 11.5px. NewAssetPopup swaps its button label to Creating.

- Why it matters: Four loading languages, and the most common one is indistinguishable from "there is nothing here". On a file list that is actively misleading, because "no files" and "files not arrived yet" are opposite facts.

- Change: One src/ui/Loading with skeleton rows for tables and a spinner elsewhere, never EmptyState. VideoPreview's loading state keeps the dialog header with the filename visible, so the panel says what it is loading.

- Evidence: `src/tools/rabbit_v0.1.0/components/FileManager.jsx:926` — `{assetFiles.length === 0 && !copying && (`<br>`src/tools/rabbit_v0.1.0/components/VideoPreview.jsx:200` — `<Loader2 className="w-5 h-5 animate-spin" style={{ color: '#78716c' }} />`




**R4-43 · MEDIUM · System** — Linking an entity uses an in-panel overlay in one direction and a centred modal in the other  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: RelationsPanel links assets to a scene through AssetPickerOverlay, an absolutely positioned panel that covers the 360px sidebar. AssetRelationsSidebar links scenes to an asset through RelationPickerPopup, a centred 448px modal with a backdrop at z-60. Both are a search field over a list of items with a status dot and a name.

- Why it matters: The same job, reached from two sides of the same relationship, arrives as two different kinds of surface. One of them dims the whole application and one does not, which tells the user the two operations have different weight when they do not.

- Change: Visually: give both the same header, search field, row and footer spec so they read as one component even while they remain two shells. Structurally the better answer is one Dialog for both, but that changes where the picker appears, so it is flagged for Audrey rather than assumed.

- Evidence: `src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:273` — `<div className="absolute inset-0 z-30 flex flex-col" style={{ backgroundColor: '#1c1917' }}>`<br>`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:1003` — `<div className="fixed z-[60] top-1/2 left-1/2 w-full max-w-md rounded overflow-hidden flex flex-col"`




**R4-46 · MEDIUM · System** — Saving a view is a centred modal in Assets and an inline strip in Levels and Experiences  
law: Jakob's Law

- Problem: The same Save current view action opens a 320px centred modal with a backdrop, a 13.5px bold title, an input and Cancel and Save buttons in ProjectAssetsView, and an inline 48-character-wide strip pushed in under the toolbar with a Save button and an X in LevelsView and ExperiencesView. The dropdown that launches both is byte-identical between the three files.

- Why it matters: Identical trigger, identical dropdown, identical feature, two completely different answers to "where does this appear". It is the clearest evidence that these three views were written as three products.

- Change: One answer for all three. The inline strip is the better one (it does not dim the application for a single text field), so promote it and give it the Toolbar spec: 44px, hairline bottom, one Input at 28px, one primary and one ghost button.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:591` — `<div className="fixed z-50 top-1/2 left-1/2 w-80 rounded p-5 flex flex-col gap-4"`<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:396` — `<div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>`




**R4-19 · LOW · Typography** — Two dashes and two ellipses mean the same thing, sometimes in the same component

- Problem: "No value" is written as the ASCII double hyphen in at least twenty places and as a real em dash in at least five, including inside the same file and the same select. "In progress" is written as three periods in Creating..., Applying..., Copying..., Uploading... and Add notes..., and as a real ellipsis in Search assets…, Loading…, Walking {folder}… and Choose folder….

- Why it matters: Small, but this is precisely the register Audrey is pointing at when she says the fonts do not look contemporary. Double hyphens and triple periods are what a terminal emits; a designed product uses the glyphs.

- Change: One em dash for an empty value, defined once in the Table component so no cell writes it, and one real ellipsis character for pending copy. Ban both ASCII forms with a lint rule if one is cheap.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1056` — `<option value="">--</option>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1106` — `{asset.description || '—'}`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:813` — `{copying ? (managed ? 'Copying...' : 'Uploading...') : 'Add files'}`




**R4-36 · LOW · Motion** — Motion durations are correct; reduced-motion is unhandled and the video autoplays  
**constraint: touches-interaction**

- Problem: Every transition on the surface is either Tailwind's 150ms default or an explicit 150ms opacity, which sits inside the interactive band and needs no change. No component on this surface consults prefers-reduced-motion, and VideoPreview mounts with autoPlay.

- Why it matters: The durations are genuinely fine, so this is a small finding, but autoplay is the one move here that can cause harm: clicking a still frame in a file list starts full-motion video and audio without asking. The app has a prefersReducedMotion() helper in the auth shell already.

- Change: Keep all 150ms transitions. Gate the hover-reveal and spinner animations behind prefers-reduced-motion using the existing helper, and drop autoPlay in favour of a poster frame plus the browser's own play control, which is one attribute and no new UI.

- Evidence: `src/tools/rabbit_v0.1.0/components/VideoPreview.jsx:185` — `controls autoPlay`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1034` — `style={{ ... opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}`




**R4-42 · LOW · Alignment** — Every data column is one pixel out of register with its header

- Problem: The header row is a borderless div whose cells start at px-3.5. Each data row carries a 1px border on all four sides, so its cells start one pixel further in. Every column on the assets table is therefore misaligned with its own header by one pixel, consistently.

- Why it matters: It is one pixel, but it is one pixel on every column of the densest table in the tool, and it is the kind of thing that makes a surface read as slightly out of focus without the viewer being able to say why. It disappears for free when the row card becomes a hairline row (R4-22).

- Change: Row and header share one padding token and one border model, enforced by the Table component rather than by matching class strings in two places.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:843` — `<div className="relative flex sticky top-0 z-10" style={{ borderBottom: '1px solid #44403c' }}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1201` — `<div key={c.key} className="px-3.5 py-2 flex items-center" style={{ flex: c.flex, minWidth: 0, overflow: 'hidden' }}>`




**R4-44 · LOW · Hierarchy** — One cell in the asset row is read-only and looks exactly like the seven editable ones  
law: Law of Similarity

- Problem: Name, type, phase, status, start and due are all editable in place and carry a hover fill. Description is a plain truncated span with a title attribute, no hover state and no editor, yet it sits in the same 11.5px stone as its neighbours in an identically padded cell.

- Why it matters: Law of Similarity, inverted: things that look alike are assumed to behave alike. Clicking the description does nothing, and there is no way to learn that except by trying. Reinforced by the fact that the description IS editable two clicks away in the detail popup.

- Change: Read-only cells render at 72 percent ink with no hover fill and no pointer, and editable cells keep the hover fill, so the row states its own affordances at rest. Keep the behaviour exactly as it is.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1104` — `<span className="text-[11.5px] font-mono truncate block" style={{ color: '#a8a29e' }} title={asset.description || ''}>`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1044` — `className="px-1.5 py-1 text-[11.5px] font-mono rounded ... hover:bg-stone-700/40 transition-colors"`




**R4-45 · LOW · System** — The bulk-action bar covers the column headers it floats over  
law: Law of Common Region

- Problem: When anything is selected, a fit-content panel with a 1px orange border is absolutely positioned at left:36 over the header row, hiding the Name, Type, Phase and Status labels behind it while the rest of the header stays visible. Both the assets and the levels tables do this.

- Why it matters: Half a header and a floating panel on top of it is a visibly unresolved state, and it happens during the operation where the user most needs to know which column is which.

- Change: Replace the header row's contents rather than overlaying them: the selection bar becomes the full-width header for the duration of the selection, same 32px height, same left edge, with the count at the left and actions at the right. No new behaviour, and the overlay's z-index and positioning maths disappear.

- Evidence: `src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:846` — `<div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm" style={{ left: 36, backgroundColor: '#292524', border: '1px solid #ea580c', `<br>`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:527` — `<div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"`





## Uniformity gaps

- **Keyboard-shortcut / footer bar (Audrey's named example)** — here: Absent from all three views on this surface. The record count instead floats inside the control strip at src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:491 and views/LevelsView.jsx:377. — elsewhere: BinsView ends in a 34px footer with a hairline top, a recessed fill, Kbd hints and a right-aligned count (views/BinsView.jsx:844-847), using Kbd from views/bins/binUi.jsx:134. — do: Promote it to src/ui/ShortcutBar at 28px with Kbd at the 11px Label step, and mount it in every R.A.B.B.I.T. view carrying at minimum the record count. Adding actual key bindings to these tables is a separate ruling because it changes interaction.

- **Table / gallery view toggle** — here: Filled #ea580c segmented control at views/ProjectAssetsView.jsx:428-445 and an unlabelled icon pair with a #44403c active fill at components/FileManager.jsx:815-838, both visible at once when a detail popup is open. — elsewhere: Bins uses Chip from views/bins/binUi.jsx:119 with an accent fill and an accent border for active state, a third treatment again. — do: One src/ui/Tabs: 14px sentence case, 2px signal underline, no fill. Content-layer controls stop using the frame's #ea580c as a fill.

- **File table** — here: components/FileManager.jsx:937 is an HTML table with 9px orange headers on a #44403c fill; components/ProjectFilesTable.jsx:123 is a CSS grid with two variants and 9 or 11px headers. — elsewhere: views/bins/BinFileTable.jsx:50 is a grid with 9.5px headers and 11.5px cells; src/components/Resources/ProjectFilesExplorer.jsx:212 is an HTML table with 10px headers and 13px cells, the only one already close to the target scale. — do: All four become src/ui/Table. ProjectFilesExplorer's 13px cell size is the correct anchor and should be the Dense step the others move to.

- **Status colour** — here: Four copies of statusColor (views/ProjectAssetsView.jsx:137, components/RelationsPanel.jsx:23, views/LevelsView.jsx:77, views/ExperiencesView.jsx:77) plus a second language, statusTone and toneColors, at views/ProjectAssetsView.jsx:2340-2356, plus a hard-coded green chip at components/AssetStatusWarningModal.jsx:75. — elsewhere: FileAuditDrawer exports FILE_EVENT_META (components/FileAuditDrawer.jsx:34) which is the right shape already: one map from a semantic event to label, colour and icon. — do: One StatusBadge taking a semantic token, modelled on FILE_EVENT_META, so a status colour can never be written inline again.

- **Inline text editing** — here: Four local implementations: views/ProjectAssetsView.jsx:2241 and :2286, views/LevelsView.jsx:1227 and :1259 (duplicated again in ExperiencesView). — elsewhere: BinFileTable.jsx:105 implements a fifth, with select-on-focus behaviour the other four lack. — do: One src/ui/Input plus InlineEdit, promoted from binUi, keeping Escape-reverts and adopting BinFileTable's select-on-focus.

- **Dialog** — here: Thirteen hand-rolled overlays across this surface, four backdrop values, three panel border treatments, four shadow values. — elsewhere: binUi's Modal already has the modal stack, topmost-only Escape, busy lock and onBeforeClose guard (views/bins/binUi.jsx:141-151). — do: Promote binUi's Modal to src/ui/Dialog unchanged and route all thirteen through it.

- **Saved views** — here: The dropdown is byte-identical in all three views, but Save opens a centred modal in Assets (views/ProjectAssetsView.jsx:591) and an inline strip in Levels and Experiences (views/LevelsView.jsx:396). — do: Keep the inline strip, give it the Toolbar spec, and delete the modal.

- **Empty state** — here: Eleven variants at eight type sizes across this surface, five uppercase, one returning null (components/ProjectFilesTable.jsx:91). — elsewhere: binUi exports an EmptyState (imported at views/BinsView.jsx:30), which is the only shared one in R.A.B.B.I.T. — do: Promote binUi's EmptyState to src/ui/EmptyState and use it for all eleven.

- **Date input on a dark surface** — here: No colorScheme in views/ProjectAssetsView.jsx:1088, :1099, :1563, :1569, :1939, :1948. — elsewhere: colorScheme: 'dark' is set in views/LevelsView.jsx:868 and :881, views/ExperiencesView.jsx:868 and :881, components/RelationsPanel.jsx:556 and :562. — do: One Input component sets it once; six light-mode native pickers on the darkest table in the app disappear.

- **Panel width** — here: 360px at components/RelationsPanel.jsx:110 and 320px at :702 for the same relations sidebar. — elsewhere: FileAuditDrawer is 420px (components/FileAuditDrawer.jsx:75), NewTaskSidePopup is 400px (components/RelationsPanel.jsx:399). — do: Width tokens 200 / 240 / 300 for docked panels and one drawer width; four bespoke numbers become two tokens.

- **Entity link picker** — here: An in-panel overlay at components/RelationsPanel.jsx:273 and a centred modal at :1003 for the two directions of the same relationship. — do: Match their type, spacing and row spec now; unifying the shell is an interaction decision for Audrey.


## Alignment issues

- Assets table, thumbnail column (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:885`): The header reserves rowH (36, 72 or 108px) while a row reserves 36px whenever that asset has no thumbnail, so at the 3x setting every un-thumbnailed row starts its columns 72px to the left of its neighbours and the header aligns with only some rows. → Fix the thumbnail column at the selected rowH for every row and letterbox the placeholder inside it.

- Assets table, header versus rows (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:843`): The header is borderless and rows carry a 1px border on all sides, so every column is one pixel out of register with its own header. → One padding token and one border model, owned by the Table component.

- Assets toolbar, segmented controls (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:449`): The thumbnail-size control is three 28px buttons inside a 1px-bordered wrapper (30px total) sitting immediately beside the view-mode control, which computes to roughly 27px. Control heights across the strip range from 26 to 30px because every one derives from padding plus font size. → 44px Toolbar, every child exactly 28px from a token.

- Group header versus rows, all three views (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:902`): px-3.5 in the table, px-5 in the gallery (:543) and px-5 in Levels over px-4 rows (LevelsView.jsx:418 and :546), so the group's accent bar never shares a left edge with the rows it heads. → One SectionTitle flush to the same 24px gutter as the rows.

- Numeric columns across the surface (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1110`): The Tasks count is left-aligned here, centred in LevelsView.jsx:582 and :587, and left-aligned mono for file sizes in FileManager.jsx:1047. Nothing uses tabular figures except RelationBadge, which is never rendered. → align=right plus tabular-nums on every numeric column, set by Td.

- Asset detail popup, property grid versus tasks table versus file manager (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1842`): The right column pads px-5 (20px), the tasks table's Td pads px-3.5 (14px) and the file table's Td pads px-2 (8px), so three stacked sections in one modal have three different left edges. → One content gutter for the modal body; Table owns its own cell padding but its outer edge aligns to that gutter.

- Relations sidebar, scene rows versus orphan shot rows (`src/tools/rabbit_v0.1.0/components/RelationsPanel.jsx:827`): Orphan shots fake the expand chevron's width with an empty 14px span and pad px-2.5, while scene rows use a real chevron button and pad px-2, so the two row types in one list do not share an icon column. → One row component with a reserved 20px leading slot that is either a chevron or empty.

- Level and Experience table, header versus rows (`src/tools/rabbit_v0.1.0/views/LevelsView.jsx:512`): The header is px-4 with no left accent; rows are px-4 with a 3px left border, so the content inside every row starts 3px right of its header label. → Reserve the spine's width in the header, or move the spine outside the row's padding box.

- File manager header bar (`src/tools/rabbit_v0.1.0/components/FileManager.jsx:765`): The section title, a 12px folder icon button, a 20px Add files button and two 20px icon buttons sit on one row with four different heights and no shared baseline. → 44px Toolbar, 28px children, title at the H2 step outside the toolbar.

- Asset gallery card footer (`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:1336`): The card body pads p-2 and the footer pads px-2 py-1, so the task count sits 4px higher in its band than the name does in its own, and the status chip at :1314 is positioned absolutely at 1.5 (6px) from the image edge, a third inset value on one card. → One card spacing token: 12px body padding, 12px footer padding, 8px chip inset.


## Hick's Law hotspots

- Assets view toolbar (ProjectAssetsView.jsx:387-503): 13 visible choices → Three groups. Left: search, promoted to first position with real width. Centre: one View button opening a popover that holds Filter, Sort, Sort direction, Group and Saved views, badged with the number of active modifiers so state is visible without the controls being visible. Right: view toggle, density toggle, then New asset as the only filled button. Thirteen objects become five; every control stays reachable in one click.

- Levels and Experiences toolbar (LevelsView.jsx:280-387): 11 visible choices → Same treatment, and note these views offer a sort direction toggle that is always enabled even with no sort field set (LevelsView.jsx:298, unlike the assets view which hides it) and a Group dropdown with exactly two options. Fold Group into the View popover; a two-option dropdown is a toggle.

- New Asset dialog (ProjectAssetsView.jsx:1513-1603): 9 visible choices → Name alone at the top at Body 14 / 36px. Type and Status as one row. Phase, dates, description and task template under a closed 'More details' disclosure that shows a filled count. Nine decisions become three, and the only required one is unmissable.

- Asset detail property grid (ProjectAssetsView.jsx:1892-2024): 14 visible choices → Two hairline-separated groups: six editable properties, then a metadata group (Tasks, Created, Updated) at Caption 12 with no field chrome. The four relation fields collapse into one wrapped row of RelationBadge chips, so zero links costs one line instead of four rows of dashes.

- Asset detail popup as a whole (ProjectAssetsView.jsx:1811-2145): 6 visible choices → Six interactive regions compete at once (relations sidebar, thumbnail block, property grid, relation pickers, tasks table, file manager with its own toolbar). Keep all six; give them rank. One 56px header, then the property grid full width, then Tasks and Files as SectionTitle-led regions each with a single right-aligned action and no inner toolbar chrome.

- Bulk-action bar (ProjectAssetsView.jsx:845-872): 6 visible choices → Three dropdowns, a delete, a divider pair and a close, floating over the hidden column headers. Keep all controls, but render them in the header's own place rather than on top of it, with Status first (the overwhelmingly common bulk edit) and delete separated to the far right, away from the primary controls.

- Relations sidebar section headers (RelationsPanel.jsx:709-736): 4 visible choices → Each header is itself a button and contains two more buttons drawn as 10px glyph pairs. Reduce to one 28px Plus that opens a two-item menu (Link scene / Link shot), which also removes the nested interactive elements.

- File manager header (FileManager.jsx:765-839): 5 visible choices → Title, folder-open icon, Add files, table icon, gallery icon at four different heights. Promote Add files to 36px primary at the left of a 44px toolbar, group the two view icons into one Tabs control, and keep the folder-open icon as a 28px ghost button beside it.


## Type inventory

| px | Weight / case | Where it is used on this surface | Should become |
|---|---|---|---|
| 30 (text-3xl) | bold mono | Asset detail popup initials placeholder (ProjectAssetsView.jsx:1857) | Display is not a text role here; keep as a graphic, set to 24 |
| 24 (text-2xl) | bold mono | Gallery card initials placeholder (:1285) | graphic, 24 |
| 14 | bold mono | Level and Experience detail popup titles (LevelsView.jsx:773, :1029) | H2 16 sentence 600 |
| 13.5 | bold mono uppercase | New Asset title (:1499), Save view title (:593), ConfirmDialog title (LevelsView.jsx:980), PopupInlineText (LevelsView.jsx:1276), "No project loaded" (:376) | H2 16 for titles, Body 14 for the inline editor |
| 13 | bold mono | RelationPickerPopup title (RelationsPanel.jsx:1017), NewTaskSidePopup title (:404) | H2 16 |
| 12.5 | bold mono uppercase | Group header labels (:549, :908), gallery card names (LevelsView.jsx:654), RelinkDialog and FileAuditDrawer headers, ConfirmDialog body, Levels description and notes wells | H2 16 for headers, H3 14 for card names, Body 14 for prose |
| 12 (text-xs) | regular mono | InlineText (:2277), description editor (:1976), the four relation buttons (:1991) | Body 14 |
| 11.5 | regular mono | The de-facto body: every table cell, every select, every modal footer button, most buttons (51 uses in ProjectAssetsView alone) | Dense 13 in cells, Body 14 in dialogs |
| 11 | regular mono | Relations item names (RelationsPanel.jsx:150), VideoPreview detail text, FileManager name cell, AssetStatusWarningModal rows | Dense 13 |
| 10.5 | semibold or bold mono uppercase tracked | Toolbar controls, table headers (:887), section headers (RelationsPanel.jsx:123), FieldLabel (LevelsView.jsx:1291), RelinkDialog paths | Label 11 for headers and labels, Dense 13 for toolbar control text |
| 10 | mono, mixed | Almost all of FileManager, SideLabel (RelationsPanel.jsx:600), picker counts, AssetStatusWarningModal chips | Label 11 or Caption 12 |
| 9.5 | mono uppercase tracked | PropField labels (:2213), New Asset field labels (:1514), gallery status chip (:1314), relations empty states (:139) | Label 11 |
| 9 | mono uppercase tracked | FileManager Th (:1196), progress label (:909), gallery card meta (:1130), ProjectFilesTable dark header | Label 11 |
| 8.5 | mono uppercase tracked | FileThumbnail extension label (FileThumbnail.jsx:148) | Label 11 |
| 8 | mono uppercase tracked | Relations status badges (RelationsPanel.jsx:153, :223, :833, :898), "Set thumbnail" hint (LevelsView.jsx:825) | Label 11 |
| 7 | mono uppercase tracked | Nested shot status badge (RelationsPanel.jsx:799) | Label 11 |

Sixteen distinct sizes, one face (fallback mono), two weights that only ever appear at sizes where they cannot separate, and uppercase plus tracking applied at every size from 7 to 13.5. The target is six steps of the shared scale: 16 / 14 / 14 / 13 / 12 / 11, with mono retained only for sizes, dates, durations, counts, ids, paths and keys.


## Priority order

R4-02 (the type scale: sixteen sizes down to six, floor at 11px). Every hierarchy, alignment and readability finding below is a symptom of this one, and it is the cheapest global change on the surface., R4-01 (one Table component). Fixes R4-06, R4-17, R4-42 and most of R4-31 at once, and is the precondition for the assets, files, levels and experiences tables ever looking related., R4-41 (the file manager's 9 and 10px body). This is the specific component Audrey called atrocious; it is a pure type-and-spacing fix with no behaviour attached and it is visible the moment she opens an asset., R4-04 (the thumbnail column width bug). One line, high visibility, and it is the concrete instance of her alignment complaint., R4-05 (delete the second status-colour language) and R4-30 (the hard-coded green chip). Both are small, both remove real contradictions, and both are prerequisites for StatusBadge., R4-15 (thirty-nine colours down to the token set, cool hues retired). Needs Audrey's ruling on the status ladder reduction, so start it early., R4-07 (one Tabs treatment) and R4-46 (one saved-view surface). Two cheap, highly visible uniformity wins inside one screen., R4-12 (one Dialog, promoted from binUi). Thirteen overlays collapse, and every dialog on the surface inherits correct Escape, backdrop and busy behaviour for free., R4-03 (give the asset row an anchor) and R4-22 (hairline rows instead of card rows). These are what make the table read as Frame.io rather than as a control panel, and they land naturally once R4-01 and R4-02 exist., R4-08 (the 20px primary action) and R4-16 (one toolbar control height). Fitts plus baseline, both mechanical once the Button and Toolbar tokens exist., R4-14 (ShortcutBar everywhere). Audrey's own named example, and the count moves out of the control strip as a side effect., R4-13 and R4-40 (one EmptyState, one Loading, and stop using the first for the second)., R4-11 (collapse the Levels and Experiences twins, or gate them with a test). Not first because it is the largest structural change, but it must land in the same wave or the surface re-drifts immediately., R4-10, R4-37, R4-38, R4-39 (the four Hick's Law hotspots). High value but each carries interaction risk, so they need Audrey's ruling before the rework session starts., R4-20, R4-23, R4-24, R4-25, R4-28, R4-29, R4-33, R4-34, R4-35, R4-45 (component and token consolidation, mechanical once the kit exists)., R4-18, R4-19, R4-32, R4-42, R4-44 (copy, casing, measure and affordance polish; last because they are cheap and independent)., R4-26 and R4-27 (the dead click and the never-rendered badge). Behaviour changes, so they are decisions rather than rework, but they should be raised before the visual pass makes both more prominent.


## Rework scope (reviewer's estimate)

Files: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ProjectAssetsView.jsx (2,356 lines, 311 inline hex uses)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\LevelsView.jsx (1,295)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\ExperiencesView.jsx (1,295, a twin of the above)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileManager.jsx (1,223)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\RelationsPanel.jsx (1,113)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectFilesTable.jsx (273)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\RelinkDialog.jsx (320)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\VideoPreview.jsx (206)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileAuditDrawer.jsx (170)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\FileThumbnail.jsx (154)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\AssetStatusWarningModal.jsx (152)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Resources\ProjectFilesExplorer.jsx (the third file table, must move in the same wave)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\BinFileTable.jsx (the fourth; read-only unless the Table conversion reaches it)`, `NEW: src\ui\Table.jsx, Toolbar.jsx, Button.jsx, Input.jsx, Tabs.jsx, Chip.jsx, StatusBadge.jsx, EmptyState.jsx, Loading.jsx, Dialog.jsx, Menu.jsx, Panel.jsx, Kbd.jsx, ShortcutBar.jsx, HoverActions.jsx, SectionTitle.jsx (most promoted from views\bins\binUi.jsx rather than written)`  
Approx lines: 2600  
Suggested sessions: 4  
Split: Session 1, the kit and its proving ground (about 700 lines touched). Promote binUi's Modal, Menu, Input, EmptyState, Kbd and Chip into src/ui, add Table, Toolbar, Button, Tabs, StatusBadge, Loading, SectionTitle, Panel, ShortcutBar and HoverActions, then land them on the five smallest files: FileThumbnail, VideoPreview, AssetStatusWarningModal, FileAuditDrawer, RelinkDialog. These are low risk, they exercise the dialog, empty, loading, error and badge contracts, and they prove the kit before it meets a 2,356-line file.

Session 2, the file tier (about 700 lines). FileManager and ProjectFilesTable onto Table, Toolbar, Button, Tabs and EmptyState, then reconcile ProjectFilesExplorer so the three file tables Audrey compares become one component. This is the session that answers her specific complaint. Read the three source-text test files first.

Session 3, ProjectAssetsView alone (about 800 lines). Toolbar, table, gallery, both modals, the detail popup, the two inline editors, the bulk bar, the status tokens. It is the largest single file and it should not share a session with anything.

Session 4, the twins and relations (about 400 lines). Collapse LevelsView and ExperiencesView into one parameterised view, or apply the kit twice plus an identity test, and take RelationsPanel with them since both consume it. Ends with the ShortcutBar mounted in all three views and a pass that greps the whole surface for any remaining inline hex, any size below 11px and any hand-rolled overlay.  
Risks: 1) SOURCE-TEXT TESTS. storage/thumbnails.test.js:577 counts the literal string `thumbnailUrl={thumbUrls.get(f.thumbnail_url)` in FileManager.jsx and asserts it appears exactly twice; :581 and :601 assert two more exact regexes over the same file; src/lib/localMediaWiring.test.js:101-107 asserts six exact source substrings in FileManager.jsx; views/writeGate.test.js:248 reads ProjectAssetsView.jsx as text. Reformatting the JSX, or extracting the two FileThumbnail render sites into one shared cell component, breaks green tests with no behaviour change. Read those assertions before touching either file and update them in the same commit.
2) STATE LIVES IN INLINE STYLE OBJECTS. hover, selected and readOnly are expressed as JS ternaries inside style props (ProjectAssetsView.jsx:1018 flatSelect, :1034, :1114, :1143, :1153), not as CSS classes. A class-based rewrite silently changes behaviour, and the file already carries a warning that an inline cursor beats the disabled:cursor-not-allowed class (:1016). Convert state to data attributes plus CSS, one component at a time, and diff the rendered states.
3) THE TWINS. LevelsView and ExperiencesView are 1,295-line duplicates that have already drifted three times. Any fix applied once is half applied. Either collapse them first or land an identity test in the same session.
4) THE NESTING STACK. AssetDetailPopup mounts FileManager which mounts VideoPreview, across z-50, z-60 and z-70. Radius, shadow and type changes are safe; z-index and positioning changes are not.
5) CONSTRAINT 1. R4-10, R4-14, R4-26, R4-36, R4-37, R4-38 and R4-43 touch interaction and need Audrey's ruling before work starts, not during.
6) TWO LIVE DEFECTS the visual pass will surface: the dead related-asset click (R4-26) and the never-rendered RelationBadge (R4-27). Fixing either is a behaviour change.
7) PALETTE DECISION. R4-15 reduces a nine-value status ladder; it changes what Audrey's own projects look like at a glance and must be agreed before StatusBadge is written, because every table on the surface consumes it.
8) ProjectFilesExplorer sits on a light-orange page while everything else here is dark. If Audrey rules Option A on the page class (data pages move to paper), the third file table changes surface as well as component, which doubles that piece of work.
