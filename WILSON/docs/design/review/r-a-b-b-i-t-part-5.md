# Review — R.A.B.B.I.T. part 5: Bins (BinsView + views/bins/* + UndoToast + IngestionToast)


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `src/tools/rabbit_v0.1.0/views/BinsView.jsx`, `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx`, `src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx`, `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx`, `src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx`, `src/tools/rabbit_v0.1.0/views/bins/BinPoster.jsx`, `src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx`, `src/tools/rabbit_v0.1.0/views/bins/AddFilesDialog.jsx`, `src/tools/rabbit_v0.1.0/views/bins/AssignToShotDialog.jsx`, `src/tools/rabbit_v0.1.0/views/bins/TakePickerDialog.jsx`, `src/tools/rabbit_v0.1.0/views/bins/RelinkBinsDialog.jsx`, `src/tools/rabbit_v0.1.0/views/bins/DeleteBinDialog.jsx`, `src/tools/rabbit_v0.1.0/views/bins/ShotTakesPanel.jsx`, `src/tools/rabbit_v0.1.0/views/bins/ShotTakeChips.jsx`, `src/tools/rabbit_v0.1.0/components/UndoToast.jsx`, `src/tools/rabbit_v0.1.0/components/IngestionToast.jsx`, `src/tools/rabbit_v0.1.0/bins/binMedia.js`, `src/tools/rabbit_v0.1.0/bins/binSelectors.js (SORT_FIELDS, EMPTY_FILTERS only)`, `src/tools/rabbit_v0.1.0/bins/shotTakeSelectors.js (TAKE_ROLE_META only)`, `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx`, `src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx`, `src/tools/rabbit_v0.1.0/Rabbit.jsx`, `src/tools/rabbit_v0.1.0/views/ScenesView.jsx (import surface + ShotTakeChips call sites only)`


## Job

Bins is a footage review surface: look at what was shot, mark it, log it, and say which shot it belongs to. Per sub-view the one action is: tree, pick the scope; files pane (grid or list), mark and select; inspector, log the selected file or files; add dialog, decide what enters the project; assign and take-picker dialogs, bind a file to a shot; relink dialog, point offline rows at their new path; delete dialog, choose move or remove. The pane in the middle is the primary surface and the marks (select, reject, circle) are the primary action; everything else is scope, filter or metadata. This is answerable and coherent, which is why the failures below are visual and systemic rather than structural.


## What works

- binUi.jsx IS the component layer the rest of the app is missing. A token object, a Button, an IconButton, a Chip, a Kbd, a Menu with viewport clamping, a Modal with a modal stack and topmost-only Escape, a Field that cannot let a label drift from its control, an EmptyState, a Spinner, and Input/TextArea/Select carrying the best input interaction in the codebase (useEscapeRevert at binUi.jsx:261, Escape reverts the edit to its focus-time value and stops there so the dialog stays open). The rework should PROMOTE this file, not replace it. Alongside lightSurface.js it is the second proof that the documented 'local tokens, not global' rule is the defect and the exception is the cure.

- The numeric discipline in the list view is correct and rare: duration, Size px, fps and Bytes all carry align:'right' in TABLE_COLUMNS and render with tabular-nums, and the header buttons mirror it with justify-end (BinFileTable.jsx:29-33, :53, :136-140). Grid tiles, the tree counts, the selection count and the take index all use tabular-nums too. Nothing else in RABBIT is this consistent about numbers.

- Radius is already unified here: 53 rounded-sm and 5 rounded-full across the whole surface, no rounded, rounded-md or rounded-lg. Bins is the one part of RABBIT that does not carry the 374 rounded (4px) drift.

- The error and empty copy is written by someone who knows the domain and says the true thing: 'Files stay where they are; the bin keeps a reference, a poster frame and the logging' (BinsView.jsx:786), 'no decoder on this machine (ffmpeg missing)' (BinInspector.jsx:272), 'The file is not at its recorded path. Plug the drive in, or use Relink' (BinInspector.jsx:326). The AddFilesDialog subtitle does honest accounting of included, sequences, duplicates, missing and bytes in one line (AddFilesDialog.jsx:76). Do not touch the words, only their type.

- Loading and empty are genuinely distinguished on the main pane: a Spinner plus 'Loading bins…' rather than an EmptyState pretending nothing is there (BinsView.jsx:770-771). This is the pattern the rest of the app needs and it is already here.

- The tests on this surface are selectors, media vocabulary and routes only (binMedia.test.js, binSelectors.test.js, shotTakeSelectors.test.js, rabbitBins.routes.test.js). No render test, no class-name assertion. A visual rework of the Bins JSX carries near-zero test risk, which is not true of most of the app.


## Findings (35)

**B01 · HIGH · System** — Every button primitive declares a hover fill that its own inline style suppresses  
law: Law of Similarity

- Problem: Btn, IconBtn, Chip and MarkBtn all carry `hover:bg-stone-700` in className and then set `backgroundColor` in the inline style object on the same element. Inline style has higher specificity than a class, so the hover rule never applies. Every button in the toolbar, the filter row, the selection bar, the inspector and all six dialog footers is hover-inert. The one-off buttons that were NOT built as components (the tree's + at BinTree.jsx:57, the marks cell at BinFileTable.jsx:123, the Modal close at binUi.jsx:225) set no inline background and therefore DO hover. The hover behaviour is exactly inverted from the component discipline.

- Why it matters: Four primitives that look like buttons do not behave like buttons, while four ad-hoc divs and buttons do. Similarity is the cue that tells a user what is clickable, and here it is actively lying. It is also the cheapest high-impact fix on the surface: one file, four call sites.

- Change: Move the surface colour out of the inline style object. Give Btn/IconBtn/Chip/MarkBtn a data-variant attribute and define background, hover and active in CSS against the tokens, or set the hover fill through a CSS custom property (`style={{ '--bg': ..., '--bg-hover': ... }}`) that a class consumes. Verify by hovering the primary Add button: it must not stay flat and must not turn stone-700 grey.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:32` — `className={'... rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-40 ...'} style={{ ...base, ...style }}   // base sets backgroundColor: C.accent`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:49` — `className={'p-1.5 rounded-sm transition-colors hover:bg-stone-700 ...'} style={{ ... backgroundColor: active ? C.accent : 'transparent', ... }}`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:122` — `className="... hover:bg-stone-700 whitespace-nowrap" style={{ ... backgroundColor: active ? (color || C.accent) : 'transparent', ... }}`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:257` — `className="... rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-40" style={{ ... backgroundColor: active ? color : 'transparent', ... }}`




**B02 · HIGH · System** — No row hover state anywhere: not in the tree, not in the 16-column table, not on the grid tiles  
law: Fitts's Law

- Problem: BinFileTable Row, BinTree TreeRow/BinNode and BinFileGrid Tile all set backgroundColor from selected/active/dragOver only. None has a hover fill. The list view is a 16-column, horizontally scrolling table with ~35px rows and 1px dividers, and there is nothing tracking the cursor across it. Losing your horizontal place is the main failure mode of a wide table and this table has no defence against it. Frame.io and Notion both solve exactly this with a hover fill, and it is the single biggest reason the list view reads as an export rather than a tool.

- Why it matters: Fitts's Law is about acquiring a target; a row you cannot confirm you are over is a target you have to acquire twice. The `group` class is already on the tree node (BinTree.jsx:134) with nothing consuming it, so the intent was there and never landed.

- Change: Add one hover fill token (a 6 percent screen of the ink) to the shared Row component and apply it to table rows, tree rows and tiles. Keep the existing selected tint and the current-item marker as they are. `transition-colors` is already on the tree and tile, so it costs one declaration.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:148` — `className="grid items-center px-2 cursor-default" style={{ ... backgroundColor: selected ? 'rgba(234,88,12,0.16)' : 'transparent', ... }}`<br>`src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:134` — `className="flex items-center gap-1.5 pr-2 py-[5px] cursor-pointer text-[11.5px] font-mono transition-colors group" // no hover rule; backgroundColor is dragOver`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:85` — `className="rounded-sm overflow-hidden cursor-default flex flex-col" // backgroundColor: selected ? tint : C.panel; no hover`




**B03 · HIGH · Typography** — Eight type sizes live inside a 3.5 pixel band, six of them below 11px and four on half-pixel steps  
law: Miller's Law

- Problem: Measured on this surface alone: text-[9.5px] x41, text-[10.5px] x29, text-[10px] x24, text-[11px] x20, text-[11.5px] x11, text-[9px] x10, text-[8.5px] x6, text-[12px] x3. Eight nominal levels from 8.5px to 12px. At 96dpi a 9.5px step and a 10px step land on the same or adjacent pixel rows, so the surface has eight declared levels and about three perceptible ones. Weight is effectively constant at 400 (font-bold appears once, in UndoToast.jsx:101), so hierarchy is not carried by size or weight at all. It is carried by colour, and two of the five inks fail contrast (see B04). That is why the densest screen in the app reads as an undifferentiated field.

- Why it matters: Four tile lines at 11 / 9.5 / 9.5 / 9 are four items the eye must separate with no reliable cue, so they collapse into one block of texture. Cutting to three perceptible levels with real weight contrast is what turns a tile from a paragraph into a label.

- Change: Collapse to four steps of the shared scale. 12 and 11.5 to Dense 13 (tree rows, menu items, table name cell, inputs, take names). 11 to Dense 13 for table cells and tile names, Caption 12 for prose. 10.5 to Caption 12. 10, 9.5, 9 and 8.5 to Label 11 for anything uppercase (chips, field labels, table headers, section titles, Kbd, badges) and Caption 12 for the tile metadata lines. The Modal title and the EmptyState title take H2 16. Nothing below 11px ships. Weight does the work the failing inks were doing: 600 for the name in a row, 400 for everything under it.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:118` — `<div className="truncate text-[11px] font-mono" ...>{row.display_name}</div> <div className="truncate text-[9.5px] font-mono" ...>{slateLine(row)}</div> <div cl`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:68` — `${small ? 'px-1 text-[8.5px] leading-[14px]' : 'px-1.5 text-[9.5px] leading-[18px]'}`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:680` — `<div className="text-[12px] font-mono uppercase tracking-wider truncate" ...>   {currentBin ? currentBin.name : 'All files'}   <span className="ml-2 text-[9.5px`




**B04 · HIGH · Colour** — Two of the five inks fail contrast, and the worse one carries the shortcut bar Audrey praised  
law: Selective Attention

- Problem: Measured against the surface grounds: C.dimmer #57534e on C.bg #1c1917 is 2.29:1 and on C.deep #0c0a09 is 2.59:1. C.dim #78716c on #1c1917 is 3.64:1. AA needs 4.5:1 for text under 18.66px, and everything here is under 12px. C.dimmer is the colour of the entire footer shortcut bar at 9px (BinsView.jsx:845), the tree's caption and counts, the inspector's empty state, the table's second name line, both 'Nothing matches.' messages and the AddFilesDialog footnote. C.dim is the colour of every Field label, every Section title, every table header and every grid tile tech line. So the two things a reviewer reads most, the column headers and the keyboard hints, are the two least legible things on the screen.

- Why it matters: Audrey named the shortcut bar as the thing the rest of the app should copy. It is conceptually right and it is currently the least readable element in WILSON: 9px at 2.6:1. Fixing it is both the fix and the template.

- Change: Replace the five-value ladder with one ink at three screens (100 / 72 / 52 percent of #f5f0ec). Note for the system session: 48 percent measures 4.47:1 on #1c1917, three hundredths short of AA, so the tertiary screen must be 52 percent, which measures 5.04:1. Retire C.dimmer entirely; anything currently dimmer becomes the 52 percent screen at Label 11 or Caption 12, never smaller. C.dim, C.muted, C.text and C.bright become the three screens plus bright. Raise the shortcut bar from 9px to Label 11 while you are there.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:15` — `text: '#d6d3d1', bright: '#fff7ed', muted: '#a8a29e', dim: '#78716c', dimmer: '#57534e',`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `<div className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap"   style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgro`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:39` — `<span className="text-[9.5px] font-mono uppercase tracking-wider flex-1 truncate" style={{ color: C.dim }}>{title}</span>`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:53` — `className={'flex items-center gap-1 px-2 py-1.5 text-[9.5px] font-mono uppercase tracking-wider ...'} style={{ color: sort?.field === c.id ? C.accentText : C.di`




**B05 · HIGH · Colour** — The active Chip and the primary Button put near-white on saturated fills at 2.0 to 3.4 to 1  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: Chip paints the category colour as a solid fill and sets the label to C.bright #fff7ed. Measured: #fff7ed on the green selects chip #22c55e is 2.15:1; on the amber offline chip #f59e0b it is 2.02:1; on the red rejects chip #ef4444 it is near 2.6:1. The media-type chips fill with MEDIA_TYPE_META colour plus 'cc' alpha, which lands in the same band. Btn primary is #fff7ed on C.accent #ea580c at 3.35:1, and black #1c1917 on the same orange measures 4.91:1. Audrey's standing rule says white or black on an orange surface; here the surface chose white and it is the wrong half of her own rule. The colour rule is documented for the light page ground but nobody applied it to a filled control.

- Why it matters: The chips are meant to stand out when active, and they do, but the label inside them is unreadable at 10px. Isolation by fill is the wrong tool when the fill is a mid-tone; isolation by border and tint keeps the category coding and returns the text to a legible ink.

- Change: Stop filling with the category colour. An active Chip keeps the colour as a 1px border plus a 14 percent tint of that colour and sets the label to the one ink, which is the same move StatusBadge makes. The primary Button keeps #ea580c and switches its label to #1c1917. Extend the authContrast.test.js pattern to assert the Chip and Button token pairs so this cannot regress.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:124` — `color: active ? C.bright : C.muted, backgroundColor: active ? (color || C.accent) : 'transparent',`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:745` — `<Chip active={...} color={C.green} count={...}><Check className="w-3 h-3" /> selects</Chip> <Chip active={...} color={C.red} ...>rejects</Chip> <Chip active={..`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:22` — `? { color: C.bright, backgroundColor: C.accent, border: '1px solid ${C.accentBorder}' }`




**B06 · HIGH · Hierarchy** — No sub-view has a dominant element; the pane that matters is framed by four competing strips  
**constraint: touches-home** · law: Von Restorff Effect

- Problem: Squinted, the Bins screen resolves as five horizontal bands of near-identical weight before the content: the ViewTabs strip with an #ea580c filled tab, the ProjectContextBar with a filled status pill, the Bins notice bar, the Bins toolbar with a filled orange Add button and a two-line title, and the filter row of filled chips. Every one of them carries an orange fill and 9 to 12px uppercase tracked type. The file grid, which is the reason the screen exists, is the only band with no fill and no emphasis. The eye lands on the chrome, not the frames.

- Why it matters: The framework's test is to count what competes for first position. Here five things do, and all five use the same device (orange fill plus tracked caps). When everything is emphasised nothing is, and that flatness is precisely what Audrey means by not contemporary.

- Change: One filled orange element per screen, and it is the primary action (Add). The active ViewTab drops its fill for a 2px signal underline. The status pill in ProjectContextBar becomes a dot plus label at the Label step. The filter chips lose their fills per B05. The notice bar keeps its hairline and drops the tinted ground. The result is that the only saturated thing above the content is the one button you press.

- Evidence: `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:54` — `backgroundColor: active ? '#ea580c' : 'transparent', borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:67` — `className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0" style={{ color: '#fff7ed', backgroundColor: statusColor, border`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:706` — `<Btn primary disabled={!canWrite} title={canWrite ? 'Add files or a folder' : ...}`




**B07 · HIGH · Density** — About 300px of stacked horizontal chrome sits above the first frame, and about 70px below it  
law: Cognitive Load

- Problem: Measured top to bottom on a tools page: App TitleBar 32, orange top bar 95 (pageBars tools), ViewTabs about 32 (py-2 plus 11px type plus border), ProjectContextBar about 34 (py-2 plus a 12px title and an 18px pill), the Bins notice bar about 25 when present, the Bins toolbar about 45 (py-2 around a two-line title block), the filter row about 37 when open, and in list view a 25px table header. That is roughly 300px before the first row. At the bottom the selection bar adds about 30, the shortcut bar 34, and the page's own bottom bar 8. On a 1080p screen roughly 35 percent of the vertical field is chrome, on a surface whose job is looking at pictures.

- Why it matters: Every band is a thing to read past. Structural whitespace is a measured breath between components; five stacked strips at five different heights with five different paddings is not whitespace, it is accumulation.

- Change: Three cuts that change no interaction. Collapse the Bins toolbar's two-line title block to one line at the H2 16 step with the stats moved to the right-hand slot, taking the toolbar to the 44px token. Merge the notice bar into the toolbar's right slot as an inline message rather than its own band. Set the toolbar, filter row, table header, selection bar and shortcut bar to the density tokens (44 / 36 / 32 / 36 / 28). That returns roughly 60 to 80px, and the bands stop reading as five separate objects because they finally share a height rhythm.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:676` — `<div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid ${C.line}' }}>`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:649` — `<div className="flex items-center gap-2 px-4 py-1.5 text-[10.5px] font-mono flex-shrink-0"   style={{ borderBottom: ..., backgroundColor: C.deep }}>`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:813` — `<div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 flex-wrap" style={{ borderTop: ..., backgroundColor: C.deep }}>`




**B08 · HIGH · Alignment** — The toolbar puts five different control heights on one row, and wraps when it runs out of width  
law: Law of Uniform Connectedness

- Problem: Computed heights of the toolbar's children: Chip (px-2 py-[3px] at 10px) about 20px, native range input about 20px, IconBtn (p-1.5 plus a 14px icon plus 1px border) 26px, Btn (px-3 py-1.5 at 10.5px) about 27px, the sort select about 27px with its own native metrics, the search input (py-1.5 at 11px) about 28px. Nothing shares a height and nothing shares a baseline, because the row is items-center so the type inside each control sits at a different y. The row also carries flex-wrap with an ml-auto group (BinsView.jsx:701), so at narrower widths the right-hand group drops to a second line and the toolbar silently doubles in height with a ragged edge.

- Why it matters: Audrey asked specifically about control heights in a toolbar and about things looking clean from placement and orientation. One row, one height, one baseline is the whole answer, and the native range input is the element that will refuse it (see B29).

- Change: One control height for the row: 28px (sm). Btn small, Btn, IconBtn, Chip, the search field and the sort select all take it, with one padding pair each. Remove flex-wrap from the toolbar and let the search field flex-shrink instead, so the toolbar can never become two rows. The title block moves to a single line so the row height is the control height plus 8px of padding, which is the 44px toolbar token.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:701` — `<div className="ml-auto flex items-center gap-1.5 flex-wrap">`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:721` — `<input type="range" min={120} max={360} step={20} value={tileWidth} ... className="w-20 accent-orange-600" />`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:732` — `<select value={sort.field} ... className="py-1.5 px-2 text-[10.5px] font-mono rounded-sm focus:outline-none"`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:122` — `className="inline-flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono uppercase tracking-wider rounded-sm ..."`




**B09 · MEDIUM · Alignment** — Right-aligned column headers shift sideways when their column is sorted  
law: Law of Uniform Connectedness

- Problem: The sort arrow is appended inside the header button after the label with gap-1. For left-aligned columns that is harmless, the label's left edge is fixed. For the four right-aligned columns (Duration, Size px, fps, Bytes) the button is justify-end, so adding the arrow pushes the LABEL about 14px to the left and the arrow, not the text, now sits above the column of numbers. Sorting a numeric column visibly breaks the alignment between its header and its values, and un-sorting snaps it back.

- Why it matters: A numeric column's right edge is the line the reader scans. Moving the header off that line, only while the column is sorted, breaks the one alignment a data table is obliged to hold.

- Change: Reserve a fixed-width sort slot (14px) on every sortable header, rendered empty when the column is not the sort field. The label's edge then never moves, in either alignment, and the arrow occupies a consistent gutter. This is the Table component's `fixed-width sort slot` requirement and Bins is the concrete case for it.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:53` — `className={'flex items-center gap-1 px-2 py-1.5 ... ${c.align === 'right' ? 'justify-end' : ''} ...'} {c.label} {sort?.field === c.id && (sort.dir === 'desc' ? `




**B10 · MEDIUM · Alignment** — The inspector uses three label orientations and four label-column widths in one 320px rail  
law: Law of Proximity

- Problem: Field defaults to label-above-control (flex-col gap-1). Field inline puts the label left at minWidth 88, used once, for Colour in Marks. TechRows uses its own key-left layout at minWidth 70. The Logging section then drops six fields into grid-cols-2 so their labels start at two different x positions. AssignToShotDialog adds w-8 and w-36 fixed columns. Scrolling the inspector top to bottom, the reader crosses label-left at 88, label-above, label-above in two columns, label-above again in Notes, then key-left at 70. There is no single left edge in the rail and no consistent label-to-value relationship.

- Why it matters: Audrey asked about the orientation of labels versus values by name. Three orientations in one rail means the eye has to re-learn the pairing at every section boundary, and the 70 versus 88 mismatch means the two key columns that ARE left-aligned do not line up with each other either.

- Change: One orientation for the whole rail: label above control, 4px gap within a field and 16px between fields, which is the Field proximity ratio already proven in AuthShell. TechRows becomes the same Field shape with a Caption 12 value rather than a bespoke key column, or if a key-value read is wanted there, make it a definition list at one fixed key width used by every key-value block in the app. Delete `inline` from Field or give it one width token.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:243` — `<label className={'flex ${inline ? 'items-center gap-3' : 'flex-col gap-1'} min-w-0'}>   <span className="text-[9.5px] ..." style={{ ..., minWidth: inline ? 88 `<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:266` — `<div className="flex items-baseline gap-2 text-[10.5px] font-mono min-w-0">   <span className="flex-shrink-0" style={{ color: C.dimmer, minWidth: 70 }}>{k}</spa`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:199` — `<div className="grid grid-cols-2 gap-2">   <Field label="Slate" ...><Field label="Take" ...>`




**B11 · MEDIUM · System** — Four bare-text empty states bypass the EmptyState component that lives in the same folder  
law: Law of Similarity

- Problem: binUi exports EmptyState and BinsView uses it three times. Meanwhile BinFileTable renders `Nothing matches.` as a raw div at 11px dimmer with px-4 py-6, BinFileGrid renders the same words at 11px dimmer with px-2 py-6, BinTree renders its own sentence at 10.5px dimmer, and BinInspector renders its own at 10.5px dimmer centred in a flex box. Four lookalikes, four paddings, three sizes, all at a failing contrast, for the same state.

- Why it matters: The component exists, is imported in the same folder, and was skipped four times. That is the local-token drift the system review diagnoses, reproduced inside a single feature folder in one sprint, which is the strongest possible argument that the discipline has to be enforced by the component and not by convention.

- Change: Route all four through EmptyState (compact variant), which already has an icon slot, a title step, a body step and an action slot. Give the filtered-empty case an action (Clear filters) since it is the only one with an obvious next move, and the table and grid variants must produce the identical block so switching view does not change the message.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:86` — `<div className="px-4 py-6 text-[11px] font-mono" style={{ color: C.dimmer }}>Nothing matches.</div>`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:27` — `{rows.length === 0 && <div className="px-2 py-6 text-[11px] font-mono" style={{ color: C.dimmer }}>Nothing matches.</div>}`<br>`src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:71` — `<div className="px-3 py-3 text-[10.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>   No bins yet. Make one with +, or drop a folder on the empty pa`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:110` — `<div className="flex-1 flex items-center justify-center px-6 text-center text-[10.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>`




**B12 · MEDIUM · System** — AssignToShotDialog carries the fourth verbatim copy of the shot status colour ramp, and it imports three hues found nowhere else in Bins  
law: Law of Similarity

- Problem: A nine-case statusColor switch is declared at file scope. The identical switch exists in RelationsPanel.jsx:26, TaskDetailPopup.jsx:38 and BudgetView.jsx:2894. It brings #fbbf24 amber, #e879f9 fuchsia and #fcd34d pale yellow onto the Bins surface, three hues that appear in no other Bins file, and #57534e for omitted, which measures 2.3:1 as text. The pill also sets its own ground to rgba(0,0,0,0.3), a black wash used nowhere else here.

- Why it matters: A status is one semantic thing and it is currently four independent visual things. The Bins copy is the newest, which means the drift is still happening as of this sprint.

- Change: Replace with the shared StatusBadge taking a semantic token. One source for the ramp, one dot-plus-label rendering, one set of values validated for contrast on the dark ground. This deletes three hues from the Bins palette and removes a fourth copy of the ramp from the codebase.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/AssignToShotDialog.jsx:18` — `function statusColor(status) {   switch (status) {     case 'in_progress': return '#fb923c'`<br>`src/tools/rabbit_v0.1.0/views/bins/AssignToShotDialog.jsx:115` — `<span className="px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"   style={{ color: statusColor(shot.status), backgroundC`




**B13 · MEDIUM · Colour** — The same orange is used at six different alphas for selection, active, hover-drop and primary emphasis  
law: Law of Similarity

- Problem: rgba(234,88,12,...) appears at 0.06 (primary take row), 0.12 (picked shot row and picked file row in the take picker), 0.14 (selected tile), 0.16 (selected table row), 0.18 (active tree row) and 0.25 (drag-over tree row). Five of those six mean exactly the same thing: this item is selected. They differ only because each file chose its own number. A selected row in the table and a selected tile in the grid are visually different states for the same data.

- Why it matters: Selection is the state this surface is built around: the marks, the selection bar, the inspector and every keyboard shortcut key off it. It cannot be five slightly different colours.

- Change: Two alphas total. `selected` at one value and `drag-target` at a second, clearly stronger one. Everything currently at 0.06, 0.12, 0.14, 0.16 and 0.18 becomes `selected`; 0.25 becomes `drag-target`. The primary-take row at 0.06 is not a selection, it is a rank, so it takes the 3px left border it already has (ShotTakesPanel.jsx:94) and drops the fill.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:151` — `backgroundColor: selected ? 'rgba(234,88,12,0.16)' : 'transparent',`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:87` — `backgroundColor: selected ? 'rgba(234,88,12,0.14)' : C.panel,`<br>`src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:138` — `backgroundColor: dragOver ? 'rgba(234,88,12,0.25)' : active ? 'rgba(234,88,12,0.18)' : 'transparent',`




**B14 · MEDIUM · Uniformity** — Kbd and the shortcut bar exist in exactly two places in the whole app, both inside BinsView  
law: Jakob's Law

- Problem: Grepped app-wide: Kbd is imported once and used twice, both in BinsView.jsx (line 827 and line 846). No other tool, view or page in WILSON shows a keyboard hint, and several bind document-level keys: TimelineView binds undo and redo, ScenesView binds undo, the Bins preview binds Space, D.O.G. and O.T.T.E.R. have their own. Audrey named this exact asymmetry. Compounding it, the bar it lives in is 9px at 2.6:1, has no grouping, and lists twelve hints as an undifferentiated run of spans.

- Why it matters: Every media tool the user already knows (Avid, Premiere, Resolve) puts its modifier hints somewhere consistent. Having them in one of eleven RABBIT tabs and nowhere else teaches the user that they are a Bins feature rather than an app convention.

- Change: Promote Kbd and a ShortcutBar to the shared kit at the 28px height token, Kbd at Label 11 with a hairline and a min-width of 18px so single characters centre. Group the twelve hints into three clusters separated by 24px (navigate / mark / act), which is the only change needed to make it scannable. Mount it from every view that registers document-level keys, starting with ScenesView and TimelineView. This is the single most visible piece of the ecosystem argument because Audrey already cited it.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:846` — `<span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span><span><Kbd>S</Kbd> select</span> ... <span><Kbd>Ctrl</Kbd><Kbd>Z</Kbd> undo</span>`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:134` — `<kbd className="inline-block px-1 rounded-sm text-[9px] font-mono leading-[14px]"   style={{ color: C.muted, border: '1px solid ${C.line}', backgroundColor: C.d`




**B15 · MEDIUM · System** — The C token object stops at the bins folder boundary and the two toasts that serve Bins are outside it  
law: Law of Similarity

- Problem: binUi exports C and every file in views/bins imports it. UndoToast and IngestionToast, which are the toasts Bins triggers, hardcode the same values inline: '#292524', '#ea580c', '#44403c', '#a8a29e', '#fb923c', '#1c1917'. ViewTabs and ProjectContextBar, the two bands directly above Bins, do the same. So the surface has a token module and four of its own neighbours reimplement it by hand, with drift already visible: UndoToast uses #e7e5e4 for its message, a stone value that exists nowhere in C.

- Why it matters: The bins folder proves the token module works. The four files immediately around it prove that a module scoped to a folder does not stop drift, it just relocates the boundary.

- Change: Lift C into the shared token module and have all four import it. This is a mechanical change with no visual delta except the #e7e5e4 to ink correction, and it is the precondition for every other fix here holding.

- Evidence: `src/tools/rabbit_v0.1.0/components/UndoToast.jsx:92` — `<span className="flex-1 text-[11px] font-mono truncate" style={{ color: '#e7e5e4' }}>`<br>`src/tools/rabbit_v0.1.0/components/IngestionToast.jsx:59` — `style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}`<br>`src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:39` — `backgroundColor: '#1c1917', borderBottom: '1px solid #44403c',`




**B16 · MEDIUM · Hierarchy** — The file context menu reaches forty to sixty flat items with no scannable structure  
**constraint: touches-interaction** · law: Hick's Law

- Problem: fileMenu builds one flat list: four mark actions, Assign, a Colour header plus eight colours plus No colour, a Move to header plus one entry per bin, a Copy to header plus one entry per bin, four file actions and Remove. With ten bins that is about 42 items; with twenty bins about 62. Menu clamps to the viewport with maxHeight and scrolls, so on a short window the user scrolls a list of sixty items to reach Remove. The bin menu does the same with a Kind header of seven, a Colour header of nine and a Move inside entry per bin.

- Why it matters: Decision time rises logarithmically with the number of options, and a scrolling menu adds a search cost on top. The nine colour rows are the clearest waste: colour is a swatch, and rendering it as nine text rows is the menu doing the work a single row of dots does better.

- Change: Keep every action reachable and change only the structure. Colour becomes a single row of swatches rendered inline in the menu rather than nine rows. Move to and Copy to become two items that open a submenu or the existing binTargets Menu at the cursor, which is already implemented for the selection bar (BinsView.jsx:823). That takes the ten-bin case from about 42 items to about 14 without removing a single command.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:465` — `...(canWrite ? COLORS.map((c, i) => ({ label: c, ColorDot: c, hint: String(i + 1), onClick: ... })) : []), canWrite && { label: 'No colour', hint: '0', ... },`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:469` — `...(canWrite ? binTargets(new Set([row?.bin_id])).map(t => ({ label: t.label, Icon: FolderInput, ... })) : []), canWrite && { header: 'Copy to (as an instance)'`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:501` — `...(canWrite ? bins.filter(b => !sub.has(b.id) && b.id !== bin.parent_bin_id).map(b => ({ label: 'Move inside ${binPathLabel(bins, b.id)}', ... })) : []),`




**B17 · MEDIUM · Hierarchy** — The filter row is an unbounded flat chip field whose only grouping cue is two 8px spacer spans  
law: Chunking

- Problem: The row emits, in order: up to eight media-type chips, three flag chips, circled, offline, up to eight colour chips, one chip per distinct camera, one per shoot day, one per scene, one per tag, and a clear link. The grouping between these six unrelated axes is two literal `<span style={{ width: 8 }} />` elements. On a real shoot with a dozen tags and three cameras this is thirty to fifty chips wrapping across three or four lines with no labels, and the row grows the pane's chrome as it does.

- Why it matters: Six independent filter axes rendered as one run of identical pills is the definition of an unchunked set. A label and a 24px gap cost nothing and do the entire job.

- Change: Keep every chip. Add one Label-11 eyebrow per axis (Type, Marks, Colour, Camera, Day, Scene, Tags) and separate the groups by 24px instead of 8. Cap the open-ended axes (cameras, days, scenes, tags) at six chips with a `+n more` that expands in place. That is progressive disclosure with nothing removed, and the eyebrows alone convert an undifferentiated field into six scannable groups.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:744` — `<span style={{ width: 8 }} />`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:752` — `{filterValues.cameras.map(c => <Chip ... >{c} cam</Chip>)} {filterValues.days.map(d => <Chip ... >{d}</Chip>)} {filterValues.tags.map(t => <Chip ... >#{t}</Chip`




**B18 · MEDIUM · Typography** — Forty-three elements on this surface are uppercase with added tracking, including every button and the bin title  
law: Law of Similarity

- Problem: Counted across the surface: 43 uppercase declarations, nearly all paired with tracking-wider. Btn and Btn small are uppercase tracked. Chip is uppercase tracked. MarkBtn is uppercase tracked. Section titles, Field labels, table headers, Modal titles, EmptyState titles, MediaTag, the take-role pill, the Kbd bar, the tick-all links and the current bin's name in the toolbar are all uppercase tracked at 8.5 to 12px. A section heading, a nav item, a button, a table header, a chip and a status pill are therefore the same typographic object, which is exactly the app-wide diagnosis reproduced in one view. The bin name is the worst case: a user-entered proper noun rendered in tracked caps at 12px.

- Why it matters: Tracked caps is a single visual signal and it is currently attached to six different roles, so it signals nothing. Returning it to one role is what makes the Label step readable as a label rather than as more of the same.

- Change: Uppercase survives in two roles only: the Label step (table headers, field labels, eyebrows, Kbd, badges) at 11px with +0.06em, and the page-transition Display. Everything else goes sentence case with zero tracking. Concretely: Btn, Btn small, Chip, MarkBtn, Modal title, EmptyState title, Section title, the tick-all links and the current bin name all become sentence case. The bin name in particular should render exactly as the user typed it.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:32` — `... font-mono uppercase tracking-wider rounded-sm transition-colors ...`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:680` — `<div className="text-[12px] font-mono uppercase tracking-wider truncate" style={{ color: C.bright }} ...>   {currentBin ? currentBin.name : 'All files'}`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:312` — `<div className="text-[12px] font-mono uppercase tracking-wider" style={{ color: C.muted }}>{title}</div>`




**B19 · MEDIUM · System** — One poster component renders at five different aspect ratios and the icons come in seven sizes  
law: Law of Similarity

- Problem: BinPoster is called at 36x22 (1.64) in the table, 100 percent inside a 16/9 box (1.78) in the grid, 72x41 (1.76) in the takes panel, 64x36 (1.78) in the picker, 44x25 (1.76) in the assign dialog, 64x64 (1.0) for audio, and height x 16/9 in ShotTakeChips with height driven by a row-height variable, so ScenesView renders the same chip at 20, 22 and 26px tall from three call sites. Because the img uses object-cover, the 1.64 table thumbnail crops the frame differently from every other instance of the same frame. Icons on the surface come in 8, 10, 12, 14, 16, 20 and 32px.

- Why it matters: The poster is the most repeated object in the tool and it is the one the eye uses to recognise a clip across views. Five crops of the same frame is a recognition cost, and it is the reason a file does not feel like the same file in the table as in the grid.

- Change: One aspect token, 16:9, and three poster sizes: 32 (dense row), 64 (list and picker), 160 (inspector). ShotTakeChips takes the dense token rather than deriving from rowH. Icons collapse to three sizes: 14 inside dense controls, 16 in rows and buttons, 24 in empty states. That deletes 8, 10, 12, 20 and 32 from the surface.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:102` — `<BinPoster row={row} src={thumbUrl} width={36} height={22} />`<br>`src/tools/rabbit_v0.1.0/views/bins/ShotTakeChips.jsx:19` — `const w = Math.round(height * 16 / 9)`<br>`src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1533` — `<ShotTakeChips entries={shotTakeEntries} ... height={Math.min(nestedThumbH, 22)} max={3}`




**B20 · MEDIUM · Build** — Nothing on this surface has a focus state, and the pane that owns twelve keyboard shortcuts is an invisible tab stop  
law: Paradox of the Active User

- Problem: The files pane is tabIndex 0 with an explicit `outline: 'none'` and no replacement indicator, so a keyboard user who tabs onto the surface that owns arrows, S, R, U, C, 0 to 8, A, Space, F2, Delete and Ctrl+Z gets no sign that they have arrived. Grepped across views/bins: zero occurrences of focus-visible. Btn, IconBtn, Chip, MarkBtn and every Menu item have hover declarations (dead per B01) and no focus declarations at all. Only the inputs ring, and they use `focus:` rather than `focus-visible:`, so a mouse click also draws the ring.

- Why it matters: The surface teaches its shortcuts in a footer bar. A user who acts on that teaching by tabbing in gets no confirmation that the keys will land. The affordance and the feedback disagree.

- Change: One focus-visible ring token applied by the shared Button, IconButton, Chip and Menu item, and applied to the pane so its border or a 2px inset signal appears when it holds focus. Switch the input rings from focus to focus-visible. This changes no interaction and is the difference between a keyboard-first tool and one that merely accepts keys.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:673` — `<div className="flex-1 min-w-0 flex flex-col" ref={paneRef} tabIndex={0} style={{ outline: 'none' }}`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:254` — `const inputClass = 'w-full px-2 py-1 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-stone-600'`




**B21 · MEDIUM · System** — Five feedback channels are live at once, two of them OS-native confirm dialogs  
**constraint: touches-interaction** · law: Flow

- Problem: Bins can tell the user something through: the inline notice bar at the top of the view, the error row inside a Modal footer, UndoToast fixed bottom-centre, IngestionToast fixed bottom-left, and window.confirm, used twice. The two window.confirm calls render a Windows Chromium system alert in an app with a custom frameless titlebar and its own well-built Modal, and one of them fires on a bulk remove, which is exactly the moment the app should look most in control.

- Why it matters: A system alert breaks the frame of the application completely, and it is the one surface in the flow the design language cannot reach. The Modal already handles busy locking and the escape stack, so the replacement is a swap, not a build.

- Change: Route both window.confirm calls through the existing Modal as a Dialog with a danger confirm, preserving the wording and the behaviour. Anchor UndoToast and IngestionToast to one position (bottom centre, 24px up) through one stack manager so they cannot both occupy the lower edge. Keep the in-dialog error row, which is correct and hard-won. That is three channels, one of them modal, and no OS chrome.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:248` — `if (ids.length > 5 && !window.confirm('Remove ${ids.length} files from the bin? ...')) return`<br>`src/tools/rabbit_v0.1.0/views/bins/AddFilesDialog.jsx:49` — `const guardedCancel = () => { if (busy) return; if (!dirty || window.confirm('Discard this batch? ...')) onCancel() }`<br>`src/tools/rabbit_v0.1.0/components/IngestionToast.jsx:48` — `className="fixed bottom-4 left-4 z-50 flex flex-col rounded-sm shadow-2xl"`




**B22 · MEDIUM · Motion** — No reduced-motion handling, a keyframes block injected from inside a component, and a transition-all on the toggle  
**constraint: touches-preview** · law: Doherty Threshold

- Problem: Grepped: zero prefers-reduced-motion in the whole of rabbit_v0.1.0. Three moves ignore it. The UndoToast countdown runs an 8 second scaleX and injects its own `@keyframes rabbit-undo-countdown` into the document through an inline style tag on every render, which is the same class of defect as the scrollbar style tag D.O.G. injects globally. The Spinner runs animate-spin. The grid tile hover-scrub starts decoding video on mouse move, which under reduced-motion should hold the poster. The Toggle animates with transition-all, which transitions layout properties rather than just the knob position.

- Why it matters: The countdown bar is the only motion here with a real job (it makes the undo deadline visible, and it pauses on hover, which is genuinely good work). It should keep that job and stop being the mechanism that ships a global keyframes rule from a toast.

- Change: Move the keyframes to index.css. Under prefers-reduced-motion: reduce, the countdown bar renders as a static width that jumps in steps rather than animating, the spinner becomes a static indicator, and canHoverScrub returns false so the poster holds. Change transition-all to transition-[left] on the Toggle knob. Interactive transitions on this surface are already unspecified Tailwind defaults at 150ms, which is in band, so nothing else needs timing work.

- Evidence: `src/tools/rabbit_v0.1.0/components/UndoToast.jsx:140` — `<style>{'@keyframes rabbit-undo-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }'}</style>`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:328` — `<span className="absolute top-[2px] rounded-full transition-all" style={{ width: 12, height: 12, left: checked ? 14 : 2, ... }} />`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:95` — `<video ref={videoRef} src={streamUrl} muted preload="metadata" playsInline`




**B23 · MEDIUM · System** — The current item and the selected item are drawn four different ways across the two views of the same list  
law: Law of Similarity

- Problem: In the table, selected is a 0.16 orange fill and current is `inset 2px 0 0` on the left edge. In the grid, selected is a 0.14 fill plus a border colour change to accentBorder, and current is a `0 0 0 1px` ring on all four sides. Switching from list view to frame view therefore changes both what selection looks like and what the keyboard cursor looks like, for the same rows in the same order.

- Why it matters: The two views share a selection model, a keyboard handler and an inspector. They should share the vocabulary that shows the state those three operate on.

- Change: One selected treatment (the shared selected fill) and one current treatment (a 2px signal left border in the table, and the same 2px signal as a left edge on the tile rather than a full ring) so the cursor reads as the same object in both views. The tile's border stays the hairline in both states; only the fill and the left edge change.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:153` — `boxShadow: current ? 'inset 2px 0 0 ${C.accent}' : 'none',`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:88` — `border: '1px solid ${selected ? C.accentBorder : C.line}', boxShadow: current ? '0 0 0 1px ${C.accent}' : 'none',`




**B24 · MEDIUM · Density** — Grid tile height changes when the bin column appears, so switching bins reflows the whole grid  
law: Law of Prägnanz

- Problem: The bin line at the bottom of a tile renders only when showBin is true, and showBin is `!currentBinId || includeNested`. Selecting a bin and turning nested off removes a 13px line from every tile, so the entire grid relayouts to a different row height on a scope change that should only change which tiles are present. Two of the other three lines already reserve minHeight 13 to prevent exactly this, so the intent was understood and missed on the fourth.

- Why it matters: A grid whose cell height depends on a filter is a grid the eye cannot hold a model of. Reserving or removing the line makes the layout predictable at no cost to the information, which stays available in the inspector.

- Change: Either reserve the fourth line the way the other two are reserved, or move the bin name off the tile entirely and into the hover state and the inspector, which is where the other provenance lives. The second is better: four metadata lines on a 200px tile is one too many, and it is the only line that is constant across a whole bin.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:119` — `<div className="truncate text-[9.5px] font-mono" style={{ color: C.accentText, minHeight: 13 }}>{slateLine(row)}</div> <div className="truncate text-[9.5px] fon`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:643` — `const showBinColumn = !currentBinId || includeNested`




**B25 · MEDIUM · Hierarchy** — The selection bar puts eighteen targets in one wrapping strip and pushes the content up when it appears  
**constraint: touches-interaction** · law: Hick's Law

- Problem: When anything is selected a bar appears with: a count, an optional stats line, Select, Reject, Unflag, Circle, Assign to shot, nine colour dots, Move to, Copy to, Remove, and a clear link. That is eighteen clickable targets at 20 to 27px heights, flex-wrapping, inside the content column, so the grid or table shortens by roughly 30px the moment a file is clicked and grows back when the selection clears.

- Why it matters: This bar appears at the exact moment the user has committed to an action, so the choice cost lands when attention is highest. Three groups and a collapsed colour control take it from eighteen decisions to about eight without losing a command.

- Change: Keep every action. Group the strip into three zones separated by 24px: marks (Select, Reject, Unflag, Circle, colours), placement (Assign, Move to, Copy to), destructive (Remove), with the count and clear pinned to the two ends. Collapse the nine colour dots behind a single swatch button that opens the existing ColorPicker as a popover, which removes eight targets and matches how colour is set everywhere else. Reserve the bar's height so the content does not jump.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:822` — `<span className="inline-flex items-center gap-1 px-1">{COLORS.map(c => <ColorDot key={c} color={c} size={10} onClick={...} />)}<ColorDot color={null} size={10} `<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:812` — `{selection.size > 0 && (   <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 flex-wrap" ...`




**B26 · MEDIUM · Typography** — Kbd is 9px, the smallest type in the app, and it is the element whose whole purpose is being read  
law: Aesthetic-Usability Effect

- Problem: Kbd renders at 9px with leading 14px, px-1 and no min-width, in C.muted on C.deep. A single-character key like S occupies a 10px wide box while Shift occupies a 34px one, so the twelve hints in the footer have twelve different rhythms and no column. Combined with the 9px C.dimmer label text beside them (B04) the bar is a 2.6:1 strip of variable-width boxes.

- Why it matters: This is the one component on the surface Audrey has already blessed conceptually. Making it the best-drawn small component in the app is the cheapest way to make the ecosystem argument visible to her.

- Change: Kbd at Label 11, min-width 18px, centred, 4px radius, one hairline, ink at 72 percent. The label beside it at Caption 12. The bar at the 28px height token. A single key and a modifier pair then read as the same object, and the bar becomes the thing Audrey wants copied everywhere rather than the thing nobody can read.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:136` — `<kbd className="inline-block px-1 rounded-sm text-[9px] font-mono leading-[14px]"`




**B27 · LOW · System** — The mono face is doing work it should not: 132 font-mono declarations on this surface, almost all of them on labels and prose  
law: Jakob's Law

- Problem: Counted 132 font-mono uses across BinsView, views/bins and the two toasts. Almost none are numerics. They are on button labels, section titles, field labels, empty-state prose, dialog footnotes, menu items, tree node names, tile names and the entire shortcut bar. Meanwhile the genuine numeric columns (duration, bytes, fps, dimensions, counts, take index) are already marked tabular-nums and would keep the mono under the proposed rule.

- Why it matters: Avid, Premiere and Resolve all set their bin metadata in a UI sans and reserve mono for timecode. Setting a two-sentence empty-state paragraph in the browser fallback mono is the tell that there is no type system, and this surface has 115 of them.

- Change: Apply the mono rule exactly: numerics in tables, ids, file paths, timecode, keyboard keys, codec strings and the version footer keep the mono. Labels, headings, buttons, tabs, chips, empty states, menu items, bin names, file display names and all body copy move to the sans. On this surface that is roughly 115 of the 132 declarations, and it is the single biggest contributor to the dated read.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:110` — `className="flex-1 flex items-center justify-center px-6 text-center text-[10.5px] font-mono leading-relaxed"`<br>`src/tools/rabbit_v0.1.0/views/bins/AddFilesDialog.jsx:156` — `<div className="mt-2 text-[9.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>   Files are referenced where they are; nothing is copied or renamed.`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:136` — `case 'duration_sec': return <span className="tabular-nums" style={{ color: C.muted }}>{formatDuration(row.duration_sec)}</span>`




**B28 · LOW · Typography** — Prose blocks run past a readable measure or are capped arbitrarily  
law: Cognitive Load

- Problem: EmptyState caps its body at max-w-md (448px) which at 11px is roughly 90 characters, above the 75 ceiling. The AddFilesDialog footnote and the TakePickerDialog footnote have no cap at all and run the full 860px and 820px dialog width, which at 9.5px is about 150 characters per line. The RelinkBinsDialog known-folders header is a full sentence of instruction inside a 9.5px uppercase tracked header, which is the worst possible setting for a sentence.

- Why it matters: A 150-character line at 9.5px in a failing ink is copy that will not be read, and this copy is the part that explains that nothing is copied or renamed, which is the reassurance the whole feature depends on.

- Change: One measure token for prose, 60 to 66ch, applied by EmptyState, the dialog footnotes and the inspector empty state. The Relink known-folders header keeps a short Label eyebrow (Known folders) and moves its sentence to a Caption-12 line beneath it, sentence case.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:313` — `{body && <div className="text-[11px] font-mono mt-1.5 max-w-md leading-relaxed" style={{ color: C.dim }}>{body}</div>}`<br>`src/tools/rabbit_v0.1.0/views/bins/RelinkBinsDialog.jsx:97` — `<div className="px-2 py-1 text-[9.5px] font-mono uppercase tracking-wider" ...>Known folders — scanned on open after a drive is plugged back in; scan one now, o`<br>`src/tools/rabbit_v0.1.0/views/bins/TakePickerDialog.jsx:104` — `<div className="mt-2 text-[9.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>`




**B29 · LOW · Build** — The tile-size range input cannot be made to match the toolbar, and the sort select cannot be made to match either  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: Two toolbar children are native controls whose height and internal metrics the design cannot fully set. `<input type="range">` with accent-orange-600 renders a platform track and thumb about 20px tall on Windows Chromium, and `<select>` applies its own minimum height and dropdown arrow regardless of the declared py-1.5. So B08's one-height rule has two elements that will not comply without replacement.

- Why it matters: Replacing the slider with discrete steps is a change to a control's form, which touches interaction, so it needs Audrey's call. Everything else in B08 can proceed without it.

- Change: The range input becomes three or four discrete size buttons in a segmented control at 28px, which is a common-region group next to the existing view toggle and matches how Avid and Premiere size frames. If the continuous slider must stay, wrap it in a 28px shell and style the track and thumb explicitly rather than relying on accent-color. The select stays native for accessibility but gets an explicit height, appearance-none and the app's own chevron, which is the only way it sits on the row. Flagging both because a spec that quietly cannot be built is not finished.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:721` — `<input type="range" min={120} max={360} step={20} value={tileWidth} onChange={...} title="Tile size" className="w-20 accent-orange-600" />`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:732` — `<select value={sort.field} ... className="py-1.5 px-2 text-[10.5px] font-mono rounded-sm focus:outline-none"`




**B30 · LOW · Build** — Tree, table and grid declare child ARIA roles with no container role  
law: Jakob's Law

- Problem: BinTree renders role="treeitem" with no role="tree" ancestor and no tabindex on the items. BinFileTable renders role="row" with no role="table" or rowgroup and no role="columnheader" on the sortable header buttons, which also carry no aria-sort. BinFileGrid renders role="gridcell" with no role="grid" or row. A screen reader gets orphaned roles, which is worse than none.

- Why it matters: Accessibility is structural, specified with the component. These three are the exact components being promoted, so it is cheaper now than after twenty call sites adopt them.

- Change: Add the container roles and aria-sort on the sorted header as part of the shared Table, Tree and Grid components. Zero visual change, and it means the shared components ship correct rather than needing a second pass.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:103` — `<div role="treeitem" aria-selected={active}`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:146` — `<div ref={innerRef} role="row" aria-selected={selected} draggable={canWrite && !renaming}`<br>`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:75` — `<div ref={innerRef} role="gridcell" aria-selected={selected} draggable={canWrite}`




**B31 · LOW · Build** — IconBtn builds a Tailwind class from a runtime value, and the class it builds is inert

- Problem: IconBtn composes `w-${size} h-${size}` from a prop, then sets width and height inline from `size * 4`. The inline style always wins, so the composed class is dead; and because Tailwind cannot see a dynamically composed class, it only exists at all when some other file happens to use the same literal. It is a JIT hazard sitting in the most-used icon component on the surface.

- Why it matters: Not a visual defect today. It is the mechanism by which an icon size silently changes when an unrelated file is edited, which is exactly the kind of thing that makes a design system stop holding.

- Change: Drop the composed className and take an explicit size token (sm 14, md 16) rather than a multiplier. Removes a class of bug that will bite the moment someone passes a size no other file uses.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:57` — `<Icon className={'w-${size} h-${size}'} style={{ width: '${size * 4}px', height: '${size * 4}px' }} />`




**B32 · LOW · Density** — Spacing is ad hoc: twelve distinct vertical paddings, three gutters and off-token rail widths  
law: Law of Proximity

- Problem: Counted on this surface: py-1.5 x17, py-1 x13, py-2 x11, py-6 x5, py-0.5 x5, py-3 x4, py-4 x3, py-[5px] x2, py-[3px], py-[2px], py-8, py-16. Horizontal gutters are px-2 in the table and grid, px-3 in the toolbar, tree and inspector, px-4 in the notice bar and the Modal. The rails are 232 (BinTree default) and 320 (BinInspector default), neither on the 200/240/300 width tokens. The tree row indent is 10 + depth * 14, so nothing in the tree aligns to a 4px grid either.

- Why it matters: Audrey asked for alignment in rows and items to make sense. Twelve paddings and three gutters is why the bands do not line up with each other or with the rails, and it is a mechanical fix once the tokens exist.

- Change: Snap to the 4px scale: 4, 8, 12, 16, 24, 32, 48 and nothing else. One page gutter of 24 wherever content meets a rail edge, 8 x 12 cell padding in the table, 12 tile padding in the grid. Rails to 240 and 300. Tree indent to 8 + depth * 16 so every level lands on the grid.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:107` — `paddingLeft: 10 + depth * 14,`<br>`src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:22` — `allCount, allOffline, canWrite, width = 232,`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:57` — `onPatch, onOpen, onProbe, onRemove, binPathFor, width = 320,`




**B33 · LOW · Colour** — The eight-hue media-type ramp is cool-heavy and contradicts the documented warm-only rule  
**constraint: palette-decision** · _taste, not error_ · law: Mental Model

- Problem: MEDIA_TYPE_META ships #38bdf8 sky, #a78bfa violet, #c084fc purple, #f472b6 pink alongside orange, green and two stones. COLOR_HEX adds cyan #06b6d4, blue #3b82f6, purple #a855f7 and pink #ec4899. Composition rule 2 in visual-language.md says no blues, no cyans. These are data-categorical rather than chrome, which is the documented exemption case, so this is a taste call, not an error.

- Why it matters: Marked as taste so the rest of the palette findings stay credible. The colour dots themselves are fine; what is not fine is those same hues being used as chip FILLS with white text, which is B05 and is an error.

- Change: Two defensible options. Keep the eight as data colours on the grounds that a colourist's bin labels are an industry vocabulary the user brings with them, in which case write the exemption into the new spec so the next reviewer does not re-raise it. Or generate eight from one hue rotation anchored on the warm end so the ramp reads as one family. My position: keep them. Avid and Premiere both use a full-spectrum bin colour set, the user's mental model comes from there, and constraining it to warm hues makes eight categories that all look like each other.

- Evidence: `src/tools/rabbit_v0.1.0/bins/binMedia.js:37` — `still:    { label: 'Still',    short: 'IMG', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)' }, sequence: { label: 'Sequence', short: 'SEQ', color: '#a78bfa', bg:`<br>`src/tools/rabbit_v0.1.0/bins/binMedia.js:47` — `red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899',`




**B34 · LOW · Motion** — Bins' Modal has no entrance while the documented language specifies slide-up for modals  
law: Doherty Threshold

- Problem: binUi's Modal renders straight into place with no animation. visual-language.md lists `slide-up` (300ms ease-out) as the modal entrance, and other WILSON modals use it. So the best-behaved modal in the app is also the only one that appears without any transition, and six Bins dialogs pop in.

- Why it matters: The motion shows causality: the dialog came from the button you pressed. It is also the cheapest way to make the promoted Dialog feel newer than the 66 overlays it replaces.

- Change: When Modal is promoted to the shared Dialog, give it one entrance: 160ms opacity on the backdrop plus a 160ms 8px rise on the surface, cubic-bezier(0.2, 0, 0, 1), and the end state delivered instantly under reduced motion. Under 240ms because it is interactive, not decorative.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:216` — `<div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(12,10,9,0.72)' }}`




**B35 · LOW · System** — No scrollbar class anywhere in Bins, so the tool gets Chromium defaults while light pages get the custom one

- Problem: Grepped rabbit_v0.1.0: wilson-light-scroll appears once, in ProjectFilesTable. Every scroll container in Bins (the tree list, the table, the grid, the inspector, the Menu, the Modal body, and five dialog lists) is unstyled, so they render the platform scrollbar against the stone ground while the light pages of the same app render a custom warm one. The system review calls for two classes; Bins currently has zero.

- Why it matters: Small, but it is a visible seam between the dark tools and the light pages on a screen that has eleven of them.

- Change: Apply .wilson-dark-scroll to the eleven scroll containers in Bins as part of adopting the two-class system. Purely additive.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:49` — `<div className="flex-1 min-h-0 overflow-auto" style={{ backgroundColor: C.bg }}>`<br>`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:130` — `<div className="flex-1 overflow-y-auto">`





## Uniformity gaps

- **Keyboard shortcut hints (Kbd + a footer bar)** — here: The only implementation in WILSON: src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:134 (Kbd) used at BinsView.jsx:827 and BinsView.jsx:846. — elsewhere: Nowhere. Grepped app-wide: zero other uses. TimelineView binds undo and redo, ScenesView binds undo, the Bins preview binds Space, D.O.G. and O.T.T.E.R. carry their own key handlers, and none of them tells the user. — do: Promote to src/ui/Kbd and src/ui/ShortcutBar at the 28px height token, Kbd at Label 11 with min-width 18. Mount it from every view that registers a document-level key. This is Audrey's own named example and should be the first visible proof of the shared language.

- **Modal and Menu** — here: binUi.jsx:198 Modal (modal stack, topmost-only Escape, busy lock, in-footer error, onBeforeClose guard) and binUi.jsx:153 Menu (viewport clamping, header/divider/danger/hint vocabulary, open-menu counter). — elsewhere: 66 hand-rolled overlays across 36 files with 22 different backdrop values, per the system review. — do: Promote both to src/ui/Dialog and src/ui/Menu unchanged behaviourally. Preserve the modalStack and openMenus counters and the exported overlayOpen(), because BinsView's document key handler and the Preview's Space handler both stand down on it (BinsView.jsx:512, BinInspector.jsx:311). Losing that reintroduces video playing behind a backdrop.

- **Escape reverts the edit** — here: binUi.jsx:261 useEscapeRevert, used by TextInput and TextArea. — elsewhere: Nowhere. Every other input in the app commits or discards on its own terms. — do: Promote with Input, TextArea and Select. It is the best input interaction in the codebase and it is currently locked inside one feature folder.

- **Token object** — here: binUi.jsx:13 exports C, imported by all 13 files in views/bins. — elsewhere: UndoToast.jsx, IngestionToast.jsx, ViewTabs.jsx and ProjectContextBar.jsx all hardcode the same hexes inline, and UndoToast has already drifted (#e7e5e4 at line 92 exists in no token). — do: Lift C into the shared token module. The four neighbours are the proof that a folder-scoped module relocates drift rather than stopping it.

- **Shot status colour** — here: AssignToShotDialog.jsx:18, a nine-case switch declared at file scope. — elsewhere: RelationsPanel.jsx:26, TaskDetailPopup.jsx:38 and BudgetView.jsx:2894 carry the identical switch. Bins is the fourth copy and the newest. — do: One src/ui/StatusBadge taking a semantic token. Deletes three hues (#fbbf24, #e879f9, #fcd34d) from the Bins palette in the process.

- **Thumbnail** — here: BinPoster.jsx:29, which its own header says was modelled on FileThumbnail (S40). — elsewhere: FileManager's FileThumbnail still exists separately. BinPoster is then called at five different aspect ratios across six files, and ShotTakeChips derives its size from a row-height variable so ScenesView renders it at 20, 22 and 26px from three call sites (ScenesView.jsx:1533, :1950, :2231). — do: Merge BinPoster and FileThumbnail into one src/ui/Thumb with one 16:9 aspect and three size tokens (32 / 64 / 160). Do not ship two thumbnail components that already share a failure-memoisation rule.

- **Row hover and hover-revealed controls** — here: Absent. No hover fill on tree rows, table rows or tiles; the marks control in the table is always visible (BinFileTable.jsx:121) and the rest of the row actions live in a context menu. — elsewhere: The system review found hover-revealed controls in six files. — do: Bins should ADOPT the shared HoverActions and the shared row hover fill, not export anything here. This is the one place the newest view is behind the rest.

- **Toast position** — here: Bins can raise an inline notice at the TOP of its own view (BinsView.jsx:648), UndoToast at bottom centre (UndoToast.jsx:81) and IngestionToast at bottom left (IngestionToast.jsx:48), all three simultaneously. — elsewhere: Four toast systems in four screen positions app-wide. — do: One anchor, one stack manager. The in-dialog error row (binUi.jsx:232) is a separate and correct channel and stays.

- **Filled orange as an active state** — here: Btn primary at binUi.jsx:22 and Chip active at binUi.jsx:125 both fill with #ea580c. — elsewhere: ViewTabs.jsx:54 fills the active tab with the same #ea580c, 40px above the Add button, and ProjectContextBar.jsx:67 fills the status pill with it when a project is a draft. — do: One filled orange element per screen and it is the primary action. Tabs take a 2px signal underline, the status pill becomes a dot plus label, the chips take border plus tint.

- **Global CSS injected from a component** — here: UndoToast.jsx:140 injects @keyframes rabbit-undo-countdown through an inline style tag. — elsewhere: D.O.G. injects a global scrollbar style tag, per the system review. — do: Move to index.css. Same defect class, second instance, and this one ships from a component that mounts on every RABBIT page.


## Alignment issues

- List view, the four right-aligned numeric column headers (Duration, Size px, fps, Bytes) (`src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:53`): The sort arrow is appended after the label inside a justify-end button, so sorting the column pushes the label roughly 14px left off the numbers it heads, and unsorting snaps it back. → Reserve a fixed 14px sort slot on every sortable header, rendered empty when the column is not the sort field.

- Bins toolbar, the whole right-hand control group (`src/tools/rabbit_v0.1.0/views/BinsView.jsx:701`): Five control heights on one items-center row (Chip about 20, range about 20, IconBtn 26, Btn and select about 27, search input about 28), so no two labels share a baseline. flex-wrap means the group drops to a second line at narrow widths and the toolbar silently doubles in height. → One 28px control height for every child. Remove flex-wrap and let the search field shrink instead, so the toolbar is always one 44px row.

- Inspector rail, top to bottom (`src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx:266`): Three label orientations in one 320px rail: Field inline at minWidth 88 (Colour), Field stacked (everything in Logging and Notes), TechRows key-left at minWidth 70. The two left-aligned key columns do not line up with each other, and the grid-cols-2 block starts its labels at two more x positions. → One orientation, label above control, 4px within a field and 16px between fields. TechRows becomes the same Field shape or a definition list at one shared key width.

- Bins toolbar title block versus the ProjectContextBar 34px above it (`src/tools/rabbit_v0.1.0/views/BinsView.jsx:680`): Two title treatments stacked 34px apart: the project title at 12px mono bold sentence case with a filled pill (ProjectContextBar.jsx:63), and the bin title at 12px mono uppercase tracked with a colour dot. Same size, different case, different tracking, different weight, different left inset (px-6 versus px-3). → One PageHeader-style title shape for both, at the same left inset, same step, sentence case. The bin title moves to H2 16 and the project title to Caption 12 above it, so the hierarchy between them is stated rather than implied.

- The bin tree, every level of indent (`src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx:107`): paddingLeft is 10 + depth * 14, so no tree row starts on a 4px grid and the chevron gutter (a 12px span) does not align with the 14px indent step. The All files row inserts a bare 12px spacer to fake the chevron column (BinTree.jsx:112), which means its icon sits one pixel off the icons below it. → 8 + depth * 16, with a 16px chevron gutter used by every row including All files, so the icon column is one vertical line from top to bottom.

- Grid tile metadata block (`src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx:117`): Four text lines at 11 / 9.5 / 9.5 / 9px, two with reserved minHeight 13 and two without, so the block's height depends on whether the bin line renders. The tile padding is px-2 py-1.5 while the grid gap is 12 and the container padding is 12, so the text does not align with the poster edge above it or the tile edges beside it. → Reserve or remove the bin line (see B24), set the text block to 12px padding to match the grid rhythm, and collapse the four lines to name at Dense 13 weight 600 plus one Caption 12 metadata line.

- List view row height versus header height (`src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx:150`): Rows declare minHeight 34 but their content (a 22px poster beside two stacked text lines at 11.5 and 9.5px inside py-1) computes to about 35, so the declared height is inert and the real height is content-derived. The sticky header computes to about 25px, noticeably shorter than the rows it heads. → Row 36 and header 32 from the density tokens, with the row height set rather than implied so it cannot drift when the name line changes size.

- AssignToShotDialog shot rows (`src/tools/rabbit_v0.1.0/views/bins/AssignToShotDialog.jsx:112`): Four fixed-width columns chosen ad hoc inside a flex row: w-8 for the shot number, an auto framing label, a status pill that changes width with its word, and w-36 for the take count. Because the framing label and the pill are content-sized, the take count column is the only thing that lines up, and the status pills form a ragged edge down the list. → A four-column grid with fixed tracks so number, name, status and count each form a column, and the status pill takes the shared StatusBadge at one width.


## Hick's Law hotspots

- File context menu (BinsView.jsx:455-479), right-click on any row or tile: 42 visible choices → About 42 items with ten bins, about 62 with twenty, in one flat scrolling list. Render the nine colours as a single inline swatch row instead of nine rows, and turn Move to and Copy to into two items that open the binTargets Menu at the cursor, which is already implemented for the selection bar at BinsView.jsx:823. Ten-bin case drops to about 14 items, and every command stays reachable.

- Bin context menu (BinsView.jsx:485-504), right-click on a tree node: 34 visible choices → Header, 4 actions, 7 kinds, 9 colours, 3 move commands, one Move inside per other bin, and Delete. Colours become one swatch row, Kind becomes a submenu (it is a single-choice property with a current value, which is what a submenu is for), and the Move inside list becomes one item that opens the bin picker. Drops to about 12.

- Filter row (BinsView.jsx:741-758): 30 visible choices → Six independent axes (type, marks, colour, camera, day, scene, tag) rendered as one wrapping run of identical chips, separated only by two 8px spacer spans. Add a Label-11 eyebrow per axis and 24px between groups, and cap the four open-ended axes at six chips with a +n more that expands in place. Nothing is removed; the row becomes six scannable groups.

- Selection bar (BinsView.jsx:812-828), appears the moment anything is selected: 18 visible choices → Count, stats, 4 mark buttons, Assign, 9 colour dots, Move to, Copy to, Remove, clear. Group into marks / placement / destructive with 24px between groups, and collapse the nine dots into one swatch button that opens the existing ColorPicker as a popover. Eighteen targets to about eight, same commands.

- Bins toolbar (BinsView.jsx:676-738): 9 visible choices → Nine control groups, one of which is a 14-option sort select that duplicates the ten sortable column headers in list view. Keep both (removing either changes interaction), but de-emphasise: the sort select and direction toggle become one 28px control with the direction inside it, and the tile-size slider becomes a segmented control grouped with the existing view toggle so the two view controls read as one region.

- Inspector Logging section (BinInspector.jsx:182-228): 11 visible choices → Name, Type, Tags, Slate, Take, Modifier, Camera, Roll, Shoot day, Scene, Shot in one open section. Chunk into three labelled groups with a Label-11 eyebrow each: identity (Name, Type, Tags), slate (Slate, Take, Modifier, Camera, Roll, Day), story (Scene, Shot). The section already collapses, so this is grouping inside it, not hiding.

- Footer shortcut bar (BinsView.jsx:846): 12 visible choices → Twelve hints in one ungrouped run. Three clusters at 24px apart: navigate (arrows, Shift), mark (S, R, U, C, 1-8), act (A, Space, F2, Del, Ctrl+Z). Same twelve hints, one third the scan cost.

- RABBIT ViewTabs immediately above the Bins surface (ViewTabs.jsx:18-32): 11 visible choices → Eleven tabs, above Miller's 7 plus or minus 2, several of which are conditional on project toggles so the count changes per project. Out of this surface's scope to restructure, but flagging it because Bins inherits the decision cost every time it is opened. A hairline group separator after Budget (setup versus production versus content) would chunk it without moving a tab.


## Type inventory

| px | uses | weight | case | roles it currently serves | collapses to |
|---|---|---|---|---|---|
| 12 | 3 | 400 | UPPER + tracking | current bin name in the toolbar (BinsView:680), Modal title (binUi:222), EmptyState title (binUi:312) | H2 16, sentence case, 600 |
| 11.5 | 11 | 400 | sentence | tree row label, Menu item label, table Name cell, all inputs, take name in ShotTakesPanel, shot name in AssignToShot | Dense 13 |
| 11 | 20 | 400 | mixed | table cell text, grid tile name, search inputs, both "Nothing matches", DeleteBinDialog body, UndoToast message | Dense 13 (rows) / Body 14 (dialog prose) |
| 10.5 | 29 | 400 | mixed | Btn label (UPPER), notice bar, TechRows key and value, selection count, relink rows, most dialog prose | Caption 12 (prose) / 13 sentence case (Btn) |
| 10 | 24 | 400 | UPPER + tracking | Chip, MarkBtn, Btn small, "clear N", Tick all / Untick all links, IngestionToast status | Label 11 (chips) / 13 sentence case (buttons and links) |
| 9.5 | 41 | 400 | UPPER + tracking, and sentence | Field label, Section title, table column headers, inspector header, MediaTag, grid tile slate and tech lines, toolbar stats, every hint | Label 11 (labels, headers) / Caption 12 (tile metadata, hints) |
| 9 | 10 | 400 | UPPER, and sentence | Kbd, tree counts, grid tile bin line, "offline" on a poster, IngestionToast last-label | Label 11 (Kbd) / Caption 12 (counts) |
| 8.5 | 6 | 400 | UPPER + tracking | MediaTag small, grid "used in" and frame-count badges, take-role pill, BinPoster "offline" | Label 11. Nothing smaller ships. |

Eight declared levels inside a 3.5px band, six of them below 11px and four on half-pixel steps that cannot resolve at 96dpi, so the surface has about three perceptible levels doing the work of eight. Weight is effectively constant at 400 (one font-bold, UndoToast:101), which means hierarchy is carried entirely by the five-value ink ladder, two of whose values fail contrast. Uppercase appears 43 times and tracking almost as often, attached to six different roles. The collapse target is five steps of the shared scale, of which this surface needs four: H2 16, Body 14, Dense 13, Caption 12, Label 11.


## Priority order

B01 dead hover states on every button primitive. One file, four call sites, and it is the reason the whole surface feels unresponsive. Highest impact per line changed on the entire review., B02 no row hover in tree, table or grid. One token, three components, and it is the single change that makes the 16-column list view usable., B15 lift the C token object out of the bins folder so ViewTabs, ProjectContextBar and the two toasts share it. This is the precondition for B04, B05 and B13 holding rather than drifting again., B04 the two failing inks. Collapsing five inks to one ink at three screens fixes the shortcut bar, every field label, every column header and every tile metadata line at once, and it is the system fix that makes three hierarchy findings disappear., B03 collapse eight type sizes to four scale steps. System fix, resolves most of the hierarchy flatness, and must land before any per-component polish or it will all be redone., B27 apply the mono rule: about 115 of 132 font-mono declarations move to the sans. Cheap, mechanical, and the largest single contributor to the contemporary look Audrey asked for., B05 stop filling chips and the primary button with mid-tones under near-white. Her own colour rule, applied to filled controls. Pairs naturally with B04 and B13., B18 uppercase and tracking back to the Label role only. Falls out of B03 and B27 and is what stops a button, a heading, a chip and a table header being the same object., B14 promote Kbd and the ShortcutBar. Her named example, and the first thing she will look for in the rework., B08 one control height in the toolbar, no wrap. Her named concern about alignment in rows, and the most visible single band on the screen., B07 the 300px chrome stack. Depends on B08 and the density tokens; returns 60 to 80px of frame area., B06 one filled orange element per screen. Depends on B05 and touches the shell, so it needs the shell session., B13 six selection alphas to two. Mechanical once the tokens exist., B11 four bare empty states through EmptyState, plus B12 StatusBadge and B19 one Thumb. Three component consolidations that go together., B09 the reserved sort slot, B10 one label orientation in the inspector, B32 the 4px spacing snap. Alignment cleanup, best done in the same pass as B03., B20 focus states. Structural, cheap, and specified with the components being promoted., B16 and B17 and B25, the three Hick's Law groupings (file menu, filter row, selection bar). Highest cognitive payoff of anything left, but each touches structure so they want their own review with Audrey., B21 replace the two window.confirm calls, and B22 reduced motion plus the injected keyframes. Correctness work with small visual payoff., B23 one current and one selected treatment, B24 the reflowing tile, B26 Kbd at 11px, B28 the measure cap, B34 the dialog entrance, B35 the scrollbar class. Polish, last session., B29 the native range and select (needs Audrey's call on the slider), B30 container ARIA roles, B31 the composed Tailwind class, B33 the media hue ramp (taste, my position is keep it). Record and decide, do not block on them.


## Rework scope (reviewer's estimate)

Files: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx (333, the token and primitive source; most of the work lands here)`, `src/tools/rabbit_v0.1.0/views/BinsView.jsx (886, chrome and the three bars; the render block is one 220-line JSX return)`, `src/tools/rabbit_v0.1.0/views/bins/BinInspector.jsx (383)`, `src/tools/rabbit_v0.1.0/views/bins/BinFileTable.jsx (161)`, `src/tools/rabbit_v0.1.0/views/bins/BinTree.jsx (160)`, `src/tools/rabbit_v0.1.0/views/bins/AddFilesDialog.jsx (162)`, `src/tools/rabbit_v0.1.0/views/bins/ShotTakesPanel.jsx (144)`, `src/tools/rabbit_v0.1.0/views/bins/RelinkBinsDialog.jsx (137)`, `src/tools/rabbit_v0.1.0/views/bins/BinFileGrid.jsx (128)`, `src/tools/rabbit_v0.1.0/views/bins/AssignToShotDialog.jsx (128)`, `src/tools/rabbit_v0.1.0/views/bins/TakePickerDialog.jsx (109)`, `src/tools/rabbit_v0.1.0/views/bins/DeleteBinDialog.jsx (70)`, `src/tools/rabbit_v0.1.0/views/bins/BinPoster.jsx (54)`, `src/tools/rabbit_v0.1.0/views/bins/ShotTakeChips.jsx (50)`, `src/tools/rabbit_v0.1.0/components/UndoToast.jsx (143)`, `src/tools/rabbit_v0.1.0/components/IngestionToast.jsx (139)`, `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx (76, shell adoption)`, `src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx (154, shell adoption)`, `src/tools/rabbit_v0.1.0/bins/binMedia.js (MEDIA_TYPE_META and COLOR_HEX only, if the palette decision changes them)`, `src/index.css (move the UndoToast keyframes, add .wilson-dark-scroll usage)`, `src/tools/rabbit_v0.1.0/views/ScenesView.jsx (3356, NOT edited but visually affected: it imports ShotTakeChips, ShotTakesPanel and TakePickerDialog and therefore binUi transitively)`  
Approx lines: 1100  
Suggested sessions: 3  
Split: Three sessions, in this order, because each depends on the one before. SESSION 1, the kit (about 450 lines, mostly binUi): lift C to the shared token module and have ViewTabs, ProjectContextBar, UndoToast and IngestionToast import it; rewrite the primitives against the new type scale, ink ladder, 28/36 heights and 4px spacing; fix the dead hover (B01) and add focus-visible (B20); promote Kbd, ShortcutBar, Dialog, Menu, Field, Input, EmptyState, Loading, Badge, StatusBadge, Chip, Button, Thumb. No consumer changes yet beyond what compiles. Ends with a visual pass over Bins AND ScenesView, since both consume it. SESSION 2, the working surface (about 400 lines): BinsView chrome (toolbar one row one height, notice merged, filter row grouped, selection bar grouped, shortcut bar promoted and grouped), BinTree (indent grid, row hover, empty state), BinFileTable (row hover, 36/32 heights, reserved sort slot, empty state), BinFileGrid (row hover, tile text block, reserved bin line, empty state). This is the session Audrey will judge the rework by. SESSION 3, the rails and the dialogs (about 250 lines): BinInspector (one label orientation, chunked Logging, section headers at the Label step), the six dialogs adopting Dialog and the new type, StatusBadge in AssignToShotDialog, the two toasts to one anchor, the window.confirm replacements, reduced motion, the keyframes move, the scrollbar class. If it has to be two sessions rather than three, merge 1 and 3 and keep 2 alone, because session 2 is the one that must not be rushed.  
Risks: 1. ScenesView is 3,356 lines and consumes three bins components plus binUi transitively (ScenesView.jsx:56-58). Any change to binUi's visual contract changes ScenesView, and ShotTakeChips is called there at three different heights (:1533 Math.min(nestedThumbH,22), :1950 Math.min(rowH,26), :2231 height 20). Fixing B19 by giving the chip a size token changes three ScenesView surfaces that are outside this review's scope, so it needs a visual check there. 2. The keyboard handler reads the grid's REAL computed gridTemplateColumns from the [data-bin-grid] element (BinsView.jsx:515-517) after a review round found a formula walking the cursor diagonally. Changing tile width, gap or the grid template is therefore NOT a purely visual change; the data-bin-grid attribute and the auto-fill template must survive intact. 3. binUi exports overlayOpen() backed by a module-level modalStack and openMenus counter (binUi.jsx:148-150). BinsView's document key handler (:512) and the Preview's Space handler (BinInspector.jsx:311) both stand down on it. Promoting Modal and Menu to a shared Dialog and Menu must carry those counters or Space plays video behind a backdrop and Escape closes two dialogs, both of which were adversarial-review findings already paid for. 4. B01 is the inline-styles-hide-state risk in its purest form: the fix changes where the background colour is declared on four primitives used roughly 90 times, so a missed call site silently loses its fill rather than its hover. Grep for every Btn, IconBtn, Chip and MarkBtn use and check the disabled, active and danger variants specifically. 5. BinsView holds about 30 pieces of useState and a dozen useCallback whose dependency arrays are hand-tuned with 🚨 comments (the load effect must not depend on ctx, :139; the document keydown is bound with an empty array through a ref, :561-570). A JSX-only edit is safe; touching the hooks is not. 6. Low risk on tests: the bins tests are binMedia, binSelectors, shotTakeSelectors, ffmpegInfo and routes, all pure logic. No render test, no class-name assertion, nothing pins a hex. 7. B05 and B33 both need Audrey's palette ruling before they can land; B29 needs her ruling on whether the tile slider can become discrete steps.
