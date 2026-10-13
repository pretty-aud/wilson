# Review — Resources: Projects (list + detail + create), Rate Card (page + table), Team Members, Files explorer. All four are LIGHT pages on #f4a261. Repo root: C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON (evidence paths below are relative to that root).


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Resources\ProjectFilesExplorer.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Resources\fileTree.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Projects\ProjectsPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Projects\ProjectListPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\Projects\ProjectDetailPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\RateCard\RateCardPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\RateCard\RateCardTable.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\TeamMembers\TeamMembersPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\lightSurface.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\lightSurface.test.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ProjectFilesTable.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx (lines 96-112, 1690-1930, 2088-2106)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (lines 836-848, the canonical shortcut bar)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (Kbd, lines 134-139)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\localMediaWiring.test.js (lines 158-166, pins App.jsx strings)`


## Job

RESOURCES is the studio's reference data: four sub-views, each with exactly one job. Projects list: open a project (primary), create one (secondary). Projects detail: edit one project's fields; its own primary action is ambiguous today because "Back to Projects", "Open in RABBIT" and "Delete Project" are all rendered at identical weight, so the detail view technically has no primary action and that is itself a finding (F-R06, F-R30). Rate Card: read and edit day rates by department; primary is inline cell edit, and the two tabs are the only view switch. Team Members: read the roster; primary is inline edit of title/department/role. Files: choose a project, then read its folders and files; primary is "pick a file and read its details" and it is read-only by design (ProjectFilesExplorer.jsx:23-24). Across all four the recurring job is SCAN A TABLE, which is why the type scale and the row/header alignment carry more weight here than anywhere else in the app.


## What works

- lightSurface.js exists and is imported by all four pages. It is the only shared token module on this surface and it already proves the thesis: one ink, hairlines as a tint of the ink, a warm well instead of a card. Its header calls itself "a deliberate exception" (lightSurface.js:31-34) — it is the cure, not the exception.

- lightSurface.test.js is a working contrast harness with FAILING CONTROLS (lines 59-65 pin every stone step as failing). The rework session does not need to build a measurement rig; it needs to extend this one. Line 106-113 already forbids a near-white fill lighter than the page — the exact defect ProjectFilesExplorer ships at line 214.

- The Rate Card's department group bar is the one place on this surface where a decision was made and defended: #c2410c carrying white at 5.18:1, with the reasoning and Audrey's quote inline (RateCardTable.jsx:660-669). It is the only status colour on the surface that measures.

- Team Members' ThLight/TdLight (TeamMembersPage.jsx:921-930) are the closest thing to a real table atom in the app — correct padding parity between head and body cells, one ink, weight-not-colour emphasis. Promote these, do not rewrite them.

- RateCardTable's EditCell/RateCompCell keep Escape-reverts-the-edit (lines 94, 155) and commit on blur. The interaction is right; only its typography and hit targets are wrong.

- The Rate Card's empty states say WHICH of three reasons applies rather than rendering a blank grid (RateCardPage.jsx:452-477). The copy is the best on the surface; only its type and its four different shells are wrong.

- Files' Columns view is a genuinely correct Finder implementation: columnsFor walks the selection, a non-folder ends the walk (fileTree.js:162-173). The mechanism is sound; the chrome around it is what fails.


## Findings (37)

**F-R01 · HIGH · System** — Four pages, 52 colour values, five tables, eleven input treatments, nine empty states  
law: Law of Similarity

- Problem: This surface is four pages reachable from one nav group, and they share exactly one module (lightSurface.js). Measured across the seven files: 31 live hex values plus 21 rgba values (52 distinct colours), five table implementations, eleven input treatments, nine empty/loading shells, six error shells, three hover systems. The documented rule that produces this is visual-language.md Composition rule 3, 'local tokens, not global'.

- Why it matters: Law of Similarity says things that look alike are read as having the same function. Here the inverse happens: a table header on Projects (11px mono bold 0.06em on rgba(120,70,30,0.45)) and a table header on Files (10px sans bold 0.1em on #f5efe6) do the same job and share nothing, so the reader re-learns the page on every navigation. This is the single cause underneath two thirds of the findings below; fixing it individually per page leaves the mechanism intact.

- Change: Promote lightSurface.js from a token file to the light half of the src/ui kit named in the system review: Table (Th/Td/Row), Toolbar, PageHeader, Input/Select, Button, Badge/StatusBadge, EmptyState, Loading, ErrorBanner. Every one of the four pages imports it and defines no local L object. Delete the local token objects at ProjectDetailPanel.jsx:20-54 and the module constants at ProjectFilesExplorer.jsx:34-40.

- Evidence: `src/components/lightSurface.js:31` — `// (WILSON's convention is local 'L' token objects per page — visual-language // §Composition rule 3. This module is a deliberate exception, because §B3 // asks`<br>`src/components/Projects/ProjectDetailPanel.jsx:20` — `const L = {   label: {     fontSize: 13, fontWeight: 700, textTransform: 'uppercase',`<br>`src/components/Resources/ProjectFilesExplorer.jsx:34` — `const INK = LIGHT_INK const MUTED = '#7c4f1f' const ACCENT = '#ea580c'`




**F-R02 · HIGH · Colour** — The Projects list status column measures 1.1:1 and is effectively invisible  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: The status select paints #16a34a (active) or #dc2626 (inactive) on backgroundColor rgba(120,70,30,0.5), which itself sits on a zebra row of rgba(120,70,30,0.12/0.22) over #f4a261. Composited, the well is about #a86a38. Green on it measures 1.33:1; red measures 1.10:1. At 12px bold uppercase.

- Why it matters: This is the only status indicator on the Projects list and the only colour-coded signal in the whole view, and it is below the threshold at which a normally sighted reader can resolve the glyphs at all. It also breaks Audrey's standing rule twice over: a saturated mid-tone ink on a warm orange-brown well is neither white nor black. Von Restorff cannot work when the isolated element is the least visible thing in the row.

- Change: Render status as a StatusBadge: LIGHT_INK label at the 11px Label step on a LIGHT_WELL chip for inactive, and on a #c2410c chip carrying white for active (the one status fill on this surface that is already proven at 5.18:1, RateCardTable.jsx:664). Keep the select as the control; style its face as the badge. Colour never carries the state alone.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:184` — `fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: (project.status || 'active') === 'active' ? '#16a34a' : '#dc2626', backgroundColor: 'rgba(120,`<br>`src/components/Projects/ProjectListPanel.jsx:140` — `backgroundColor: i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)',`




**F-R03 · HIGH · Colour** — MUTED #7c4f1f carries six of the Files table's seven columns at 2.6 to 3.4:1  
law: Law of Similarity

- Problem: ProjectFilesExplorer defines MUTED = '#7c4f1f' and uses it for every column header, and for the Type, Size, Created, Modified, Duration and Location cells, the row count, the Empty component, the details-panel labels and the column chevrons. On the page it measures 3.40:1; on the darker zebra row (rgba(120,70,30,0.22) composited, about #d98e52) it measures 2.64:1.

- Why it matters: This is the measured answer to "files database looks atrocious". Six of seven columns of the densest table in the app are set in a brown that fails AA and is, functionally, the grey-on-orange Audrey banned in capitals wearing a warm hue. lightSurface.js:27-29 states the resolution explicitly: hierarchy on a light surface comes from size and weight, never a second ink.

- Change: Delete MUTED. Every cell becomes LIGHT_INK. Secondary columns drop rank by size (13px Dense to 12px Caption) and weight (400 against the name's 600), not by colour. The column headers go to the 11px Label step in LIGHT_INK at weight 600 on a LIGHT_WELL header row, which is already the proven treatment in TeamMembersPage.jsx:923.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:35` — `const MUTED = '#7c4f1f'`<br>`src/components/Resources/ProjectFilesExplorer.jsx:241` — `<td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{isFolder ? 'Folder' : m.type}</td>`<br>`src/components/Resources/ProjectFilesExplorer.jsx:219` — `style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, cursor: 'poin`




**F-R04 · HIGH · Build** — 'project-files' is missing from PAGE_BARS, so the densest table renders inside Home's chrome

- Problem: PAGE_BARS has no 'project-files' key, and App.jsx falls back to PAGE_BARS.home. Files therefore renders with 268/268 bars instead of the 200/150 its three sibling Resources pages get. On any display 1076px or taller that is 536px of chrome against their 350px: 186px of field lost, and 433px against the tool pages.

- Why it matters: The Files table is the only surface in Resources with no vertical budget to spare (32px rows, seven columns, a sticky header and a 300px side panel). Losing 186px is roughly six rows, or a third of what fits. It is a one-line fix and it is the highest impact-per-character finding in the review.

- Change: Add `'project-files': bars(200, 150),` to PAGE_BARS immediately after 'team-members'. Then, per the system review's F35, move all six Resources rows to bars(120, 80), which returns a further 150px to every page in this group.

- Evidence: `src/layout/pageBars.js:94` — `'project-manager':  bars(200, 150), 'rate-card':        bars(200, 150), 'team-members':     bars(200, 150),`<br>`src/App.jsx:1753` — `const pageBars = PAGE_BARS[currentPage] || PAGE_BARS.home;`




**F-R05 · HIGH · Colour** — The Files table header is a near-white cream band, the defect a test already exists to prevent

- Problem: The sticky thead paints #f5efe6. Its luminance is 0.869 against the page's 0.459, so it is a near-white sheet laid across the orange page. It is the only use of this value in the app.

- Why it matters: lightSurface.test.js:106-113 asserts that the shared header well must be DARKER than the page, quoting Audrey's original complaint about "a white box and white header for the box that doesnt fit the visual language", and her Rate Card ruling "NO WHITE BACKGROUND". Files ships the exact banned shape; it simply does not import the token the test guards, so nothing fails. This is the second measured reason the page reads as a different, older application than its neighbours.

- Change: Replace #f5efe6 with LIGHT_WELL. Extend lightSurface.test.js to assert that no fill used in the Resources pages has a luminance above the page's, with #f5efe6 and #fef3e8 pinned as failing controls so the value cannot come back.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:214` — `<tr style={{ position: 'sticky', top: 0, backgroundColor: '#f5efe6', zIndex: 1 }}>`<br>`src/components/lightSurface.test.js:106` — `it('the header is NOT a near-white card — that was the actual complaint', () => {`




**F-R06 · HIGH · Hierarchy** — Every page on this surface prints its own title twice, and the in-page copy is the weaker one  
law: Selective Attention

- Problem: App.jsx renders PAGE_TITLES[currentPage] at 20px bold uppercase white in the orange bar for all four pages. Each page then renders the same word again in its content: "Projects" at 18px, "Files" at text-lg, "Team Members" at text-lg, "Rate Card" at text-sm. The two titles sit within roughly 150px of each other vertically.

- Why it matters: Two elements compete for first position and they say the same thing, so the eye resolves the duplicate before it resolves anything that carries information. Worse, the in-page copy is smaller and lower contrast than the chrome copy, so it reads as a subtitle of itself. Selective Attention: the first thing the reader's eye filters for should be the content, and on arrival it is a repeated label.

- Change: Delete the in-page title on all four pages and keep only the actions that sat beside it. The row becomes a 44px Toolbar with a left slot (view switcher, project picker, filters) and a right slot (primary action, counts). The chrome title is the H1 and the only H1.

- Evidence: `src/App.jsx:1896` — `<h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>`<br>`src/components/Resources/ProjectFilesExplorer.jsx:141` — `<h2 className="text-lg font-bold uppercase tracking-widest" style={{ color: INK, marginRight: 8 }}>Files</h2>`<br>`src/components/TeamMembers/TeamMembersPage.jsx:285` — `<h1 className="text-lg font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>   Team Members </h1>`




**F-R07 · HIGH · System** — Five table implementations on one surface, five header fills, four row heights, three divider colours  
law: Law of Uniform Connectedness

- Problem: Projects list is a CSS grid with a rgba(120,70,30,0.45) header and 0.12/0.22 zebra. ProjectFilesTable warm (rendered inside Projects detail) is a second CSS grid with the same header fill, the same zebra and a different radius. RateCardTable is a real table whose th paints bare #f4a261 with a 2px #7c2d12 underline and whose td divider is #fed7aa, a near-white peach. Team Members is a real table on LIGHT_WELL with LIGHT_RULE dividers and no zebra. Files is a real table with an #f5efe6 header and zebra. Row heights measure roughly 53, 40, 32 and 30px.

- Why it matters: Two of these tables render on the same scroll (Projects detail shows ProjectFilesTable directly under form fields styled by a different token object), and all five are within two clicks of each other. Law of Uniform Connectedness is inverted: identical data structures are drawn five ways, so nothing connects. This is the single highest-leverage structural fix on the surface, and it is the one Audrey named when she asked why the shortcuts exist in one place only.

- Change: One Table component: 36px row, 32px head on LIGHT_WELL, 8px/12px cells, LIGHT_RULE hairline dividers, NO zebra, one hover fill, one selected fill plus a 2px signal left border, right-aligned numerics with tabular-nums, a fixed-width sort slot. Delete the zebra in Projects list (ProjectListPanel.jsx:140), Files (ProjectFilesExplorer.jsx:236) and ProjectFilesTable warm (ProjectFilesTable.jsx:145-147); delete #fed7aa entirely.

- Evidence: `src/components/RateCard/RateCardTable.jsx:574` — `const td = {   borderBottom: '1px solid #fed7aa',   padding: '1px 2px',`<br>`src/components/Projects/ProjectListPanel.jsx:110` — `backgroundColor: 'rgba(120, 70, 30, 0.45)', borderBottom: '1px solid rgba(120, 70, 30, 0.3)',`<br>`src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:145` — `backgroundColor: w   ? (i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)')   : '#1c1917',`




**F-R08 · HIGH · System** — Eleven input treatments across four pages, including two that drop a black well onto the orange page  
law: Law of Similarity

- Problem: Counted: Files select and search (#1c1917 fill, #f4a261 text, 1px #44403c); Projects create input (same); ProjectDetailPanel L.input (rgba(120,70,30,0.55), #fde8d0, 2px border); TeamMembers inputStyle (same fill, no border); TeamMembers InlineLightText (rgba(120,70,30,0.35), LIGHT_INK, LIGHT_RULE); TeamMembers InlineLightSelect (transparent, LIGHT_RULE); TeamMembers modal fieldStyle (rgba(244,162,97,0.12), #f4a261, 3px radius); RateCardTable EditCell (LIGHT_WELL, 1px #ea580c); DepartmentSelect (transparent, no border); the currency filter (no fill, a #f4a261 bottom rule only); ProjectFilesTable's kind select (rgba(120,70,30,0.5), 3px radius).

- Why it matters: Postel's Law is about accepting varied input, not producing varied fields. A user filling the Projects detail form and then filtering the Files table meets two fields with nothing in common: one is a brown well with cream text, one is a black hole with orange text. The #fde8d0-on-0.55-well pair is already recorded as failing at 3.38:1 (lightSurface.js:50-59), so four of the eleven are also illegible.

- Change: Two inputs, both from the kit: a docked light field (LIGHT_WELL fill, 1px LIGHT_RULE, LIGHT_INK text, 4px radius, 28px and 36px sizes, one focus-visible ring) and an inline-edit field (transparent until focus, then the same well plus a signal ring). The dark #1c1917 wells go; there is no reason for a light page to host a black field. Keep binUi's Escape-reverts behaviour, which RateCardTable and TeamMembers already implement.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:146` — `style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c', minWidth: 240 }}`<br>`src/components/Projects/ProjectDetailPanel.jsx:30` — `input: {   width: '100%', padding: '10px 14px', fontSize: 15,   backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0',`<br>`src/components/lightSurface.js:54` — `// going to live here, and the contrast test refused it: black on that well // measures 4.32:1, just under AA — and the pale '#fde8d0' it is actually // paired `




**F-R09 · HIGH · Alignment** — RateCardTable's header and body padding disagree, misaligning all eleven columns by 6px  
law: Law of Proximity

- Problem: th padding is '6px 4px'; td padding is '1px 2px' and every cell's inner control adds its own px-2 (8px) or px-1 (4px). So a column label starts 4px from the column edge while its data starts 10px in. Every column in an eleven-column financial grid is off by 6px, and the vertical padding disagrees by 5px on the header and 27px on the row (the row height comes entirely from EditCell's minHeight: 28px).

- Why it matters: A rate card is read by running the eye down a column. When the label does not sit over its own data the column stops being a column, which is the difference between a table you scan and a table you parse. It is also why the grid reads as cramped: 1px of vertical cell padding means the divider sits almost against the glyphs.

- Change: One cell padding token used by both th and td: 8px 12px, with the inner control padded to zero and the cell owning the inset. Row 36px, head 32px, set on the row rather than inferred from a child's minHeight.

- Evidence: `src/components/RateCard/RateCardTable.jsx:559` — `const th = {   backgroundColor: '#f4a261',   ...   padding: '6px 4px',`<br>`src/components/RateCard/RateCardTable.jsx:574` — `const td = {   borderBottom: '1px solid #fed7aa',   padding: '1px 2px',`<br>`src/components/RateCard/RateCardTable.jsx:106` — `className={'w-full px-2 py-1.5 text-xs rounded-sm transition-colors ...'} style={{ color: LIGHT_INK, textAlign: align, minHeight: '28px' }}`




**F-R10 · HIGH · Alignment** — Files sets Size and Duration in monospace and then left-aligns them

- Problem: The Size and Duration cells carry fontFamily monospace but no textAlign, so they inherit left. Their headers are hard-coded textAlign: 'left'. Sorting them is numerically correct (fileTree.js:190,193), so the column is sortable but not comparable by eye.

- Why it matters: The entire reason to set a figure in mono is that the digits line up. Left-aligning ragged-length byte counts throws that away, and the reader cannot tell 9.8 MB from 98 MB without reading both. Frame.io's media tables right-align every numeric for exactly this reason.

- Change: Right-align Size, Duration and both date columns; add font-variant-numeric: tabular-nums. Move textAlign onto the HEADERS array so the header and cell cannot disagree, rather than repeating it per cell.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:242` — `<td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{isFolder ? '' : formatBytes(m.sizeBytes)}</td>`<br>`src/components/Resources/ProjectFilesExplorer.jsx:204` — `const HEADERS = [   ['name', 'Name'], ['type', 'Type'], ['size', 'Size'], ['created', 'Created'],`




**F-R11 · HIGH · Motion** — The Files table and column list have no hover and no focus state at all  
**constraint: touches-interaction** · law: Doherty Threshold

- Problem: Table rows compute backgroundColor purely from selection and zebra index; there is no hover branch and no transition. Column items likewise paint only isSel. Rows are <tr> elements with onClick and no role, tabIndex or focus styling; column items are real buttons but get no visible focus ring.

- Why it matters: Doherty Threshold is about the system answering instantly; here it never answers. The one table on this surface whose whole job is pointing at rows is the one that gives no indication a row is pointable. Everything else on the surface has at least one hover treatment, so this also reads as an unfinished screen rather than a quiet one.

- Change: One hover fill and one selected fill from the kit, 120ms opacity/background transition, plus a :focus-visible ring on the column buttons and on the table rows once they carry a role. The cursor already switches on file rows (line 236), so the affordance is half declared already.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:236` — `style={{ backgroundColor: isSel ? SELECTED : (i % 2 === 0 ? ROW_A : ROW_B), cursor: isFolder ? 'default' : 'pointer' }}`<br>`src/components/Resources/ProjectFilesExplorer.jsx:275` — `padding: '7px 12px', textAlign: 'left', fontSize: 13, color: INK, border: 'none', cursor: 'pointer', backgroundColor: isSel ? SELECTED : 'transparent', fontWeig`




**F-R13 · HIGH · System** — Nine empty and loading treatments, and on Files the two are visually identical  
law: Zeigarnik Effect

- Problem: Files uses one Empty component for "choose a project", "Loading…" and "no files" (lines 180-182), plus a fourth variant inside the details panel. Rate Card has four (a Lock notice, a Users-icon block with two sub-lines, a bare centred string, and an italic td). Team Members has two. Projects list has a fifth shape entirely: a 56px circle, a 24px icon, a 16px title, a 13px body and a button.

- Why it matters: When "loading" and "nothing here" render as the same grey sentence in the same position, the reader cannot tell a slow adapter from an empty project, and on Files that distinction is the whole question. Zeigarnik: an incomplete state has to look incomplete.

- Change: One EmptyState (24px icon, 14px sentence-case title, 13px body, optional action slot) and a separate Loading that renders skeleton rows for a table and a spinner elsewhere. Projects list's empty state is the only one with an action and should become the canonical shape, minus the 56px circle.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:180` — `{!projectId && <Empty>Choose a project to see its folders and files.</Empty>} {projectId && loading && <Empty>Loading…</Empty>} {projectId && !loading && tree &`<br>`src/components/RateCard/RateCardPage.jsx:457` — `<div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">   <Users className="w-7 h-7" style={{ color: LIGHT_INK }} />`<br>`src/components/Projects/ProjectListPanel.jsx:76` — `width: 56, height: 56, borderRadius: '50%', backgroundColor: 'rgba(120, 70, 30, 0.4)', marginBottom: 16,`




**F-R14 · HIGH · Colour** — Six error treatments, four error inks, and the delete confirmation measures 2.34:1  
**constraint: palette-decision** · law: Cognitive Bias

- Problem: Errors render as: a dark #1c1917 box with #fca5a5 text (Files); a dark box with text-red-400 (Projects create); a rgba(220,38,38,0.1) tint with #dc2626 text (Projects list and detail); a #fee2e2 near-white pink band with #991b1b mono (Rate Card); bare #dc2626 mono with no container (Team Members); and the same tint again (Team Members admin errors). #dc2626 on #f4a261 measures 2.34:1, and the delete confirmation question is set in it at 14px bold.

- Why it matters: The moment a user is asked to confirm a destructive action is the moment the text must be the most legible on the page; here it is the least. The fix already exists in the codebase as a measured token: AUTH_ERROR_INK #7f1d1d at 4.86:1, documented in visual-language.md as "a darkened #ef4444, not a fourth ink".

- Change: One danger ink on light, #7f1d1d, and one ErrorBanner: LIGHT_WELL fill, 1px #7f1d1d rule, 13px LIGHT_INK body with the danger ink reserved for the icon and the action. Delete #fee2e2, #fca5a5, #991b1b, #ef4444 and text-red-400 from this surface. Pin all five as failing controls in lightSurface.test.js.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:249` — `<span style={{ fontSize: 14, color: '#dc2626', fontWeight: 700 }}>   Delete "{projects.find(p => p.id === deleteConfirm)?.title}"?`<br>`src/components/RateCard/RateCardPage.jsx:311` — `className="flex items-start gap-2 px-6 py-2" style={{ backgroundColor: '#fee2e2', borderBottom: '1px solid #991b1b' }}`<br>`src/components/Resources/ProjectFilesExplorer.jsx:177` — `<div className="mx-6 mt-3 text-xs px-3 py-2 rounded-sm" style={{ backgroundColor: '#1c1917', border: '1px solid #991b1b', color: '#fca5a5' }}>{error}</div>`




**F-R15 · HIGH · Density** — Five page gutters and three measures inside one nav group  
law: Law of Common Region

- Problem: Projects list uses maxWidth 1100 with padding 32px 40px. Projects detail uses maxWidth 1100 with padding 28px 40px. Team Members uses maxWidth 1080 with 32px. Rate Card is full width with px-6 (24px). Files is full width with 18px 24px on the header and no gutter on the table, so cells start 12px from the window edge. On top of all of this App.jsx adds `3vh 0`, so the vertical gutter changes with window height while the horizontal one does not.

- Why it matters: The left edge of content moves between 12px and 40px as the user walks the Resources group, and the top padding jumps 4px when they click from the Projects list into a project. Nothing in the group shares a frame, which is what makes it read as four small applications rather than one section. Law of Common Region needs a consistent region to work.

- Change: One 24px page gutter owned by the shell, not by the pages; App.jsx's `3vh 0` becomes 24px. Two measures: 720px for the Projects detail form, full width capped at 1240px for the four tables. Pages stop setting their own padding and maxWidth entirely.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:40` — `<div style={{ maxWidth: 1100, margin: '0 auto', width: '100%', padding: '32px 40px', flex: 1 }}>`<br>`src/components/TeamMembers/TeamMembersPage.jsx:282` — `style={{ maxWidth: '1080px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}`<br>`src/App.jsx:2100` — `padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',`




**F-R16 · HIGH · Alignment** — The Files toolbar mixes 38px and 27px controls, and Refresh is styled identically to a view toggle  
law: Law of Similarity

- Problem: In one flex row with alignItems: center: an 18px h2, a 38px select (py-2 + text-sm), two 27px buttons (6px padding + 11px text), a 38px search input, another 27px button, and a 12px count string. The Table/Columns pair and the Refresh button all come from the same btnStyle helper, so an idempotent command and a two-state radio group are the same object.

- Why it matters: Two control heights in one toolbar means there is no baseline, and the row reads as assembled rather than laid out. Law of Similarity then compounds it: a user scanning for the view switcher finds three identical outlined pills, one of which is not a view. Hick's Law cost is small in count but real in kind, because the grouping is actively misleading.

- Change: One 44px Toolbar, every child 28px. Table/Columns becomes a segmented control with a shared border and one signal fill for active. Refresh becomes a ghost icon button in the RIGHT slot, separated by the flex gap, so it cannot be read as a third view. The count moves to the right slot beside it at the 12px Caption step.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:61` — `const btnStyle = (active) => ({   padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',`<br>`src/components/Resources/ProjectFilesExplorer.jsx:167` — `<button type="button" style={btnStyle(false)} onClick={() => setReloads(n => n + 1)} disabled={!projectId || loading}>Refresh</button>`<br>`src/components/Resources/ProjectFilesExplorer.jsx:140` — `<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '18px 24px 12px', borderBottom: BORDER }}>`




**F-R17 · HIGH · Typography** — Nine distinct type sizes and roughly thirty distinct type objects across four pages  
law: Law of Similarity

- Problem: Measured across the seven files: inline fontSize values of 9, 10, 11, 12, 13, 14, 15, 16 and 18, plus Tailwind text-[9px], text-[10px], text-[11px], text-xs, text-sm and text-lg. Combined with case, weight, tracking and family, this surface carries about thirty distinct type objects. A 13px bold uppercase 0.05em object is a FIELD LABEL in ProjectDetailPanel.jsx:21 and a BUTTON in the same file at line 114.

- Why it matters: When a label and a button are the same typographic object, the reader has to use position alone to tell an affordance from a caption, and Law of Similarity is actively working against the design. The 9px steps (the Private badge, the staff badges, the burden toggle, the computed amount) are below the threshold at which weight and tracking are resolvable at 96dpi.

- Change: Collapse onto the eight-step scale from the system review. On this surface that means: page title 20 (chrome only), section 16, card/group title 14, body 14, table cell 13, caption 12, label 11. Nothing below 11px ships. Buttons go to 14px sentence case weight 600, no tracking; field labels go to the 11px uppercase Label step. That alone separates the two objects currently colliding.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:21` — `label: {   fontSize: 13, fontWeight: 700, textTransform: 'uppercase',   letterSpacing: '0.05em', color: '#4a2c10', marginBottom: 6,`<br>`src/components/Projects/ProjectDetailPanel.jsx:114` — `padding: '8px 16px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',`<br>`src/components/RateCard/RateCardTable.jsx:200` — `<span className="text-[9px] font-mono pr-5" style={{ color: LIGHT_INK }}>`




**F-R18 · HIGH · Typography** — The same data type is monospace on one page and sans on the next, and 21 of those are invisible to the font-mono count  
law: Jakob's Law

- Problem: Team Members sets a person's NAME in mono (TeamMembersPage.jsx:534) and so does every other cell on that page. Projects list sets a project title in sans at 15px and only the two date columns in mono. Files sets the file name in sans and Size, Duration and Location in mono. Rate Card sets everything in mono including role labels and department names. Beyond the 66 font-mono class uses, this surface carries 21 inline `fontFamily: 'ui-monospace, monospace'` declarations that the app-wide 1,917 count does not include.

- Why it matters: The de-facto UI face of the Resources section is the browser fallback mono, which is what Audrey means by "fonts that dont look super contemporary". Notion and Apple's system apps set a person's name in the UI sans and reserve mono for figures; doing the reverse is the loudest single tell that this is a control panel rather than a product.

- Change: Apply the system review's rule with no exceptions on this surface. Mono keeps numerics in tables (sizes, durations, wages, totals, counts), file paths, ids and the version footer. It loses names, titles, departments, roles, descriptions, buttons, labels, tabs, chips, empty states and every heading. Grep for both spellings: the 21 inline declarations will be missed by a class-based sweep.

- Evidence: `src/components/TeamMembers/TeamMembersPage.jsx:534` — `<span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>   {member.display_name || member.username || '--'}`<br>`src/components/Projects/ProjectListPanel.jsx:149` — `fontSize: 15, color: '#3a1e08', fontWeight: 600, padding: '14px 14px', overflow: 'hidden', textOverflow: 'ellipsis',`<br>`src/components/Projects/ProjectDetailPanel.jsx:32` — `fontFamily: 'ui-monospace, monospace',`




**F-R19 · HIGH · Colour** — The success and danger inks the system review proposes do not measure on this page class  
**constraint: palette-decision**

- Problem: The system review specifies success #15803d and danger #b91c1c on light. Measured against #f4a261: #15803d is 2.43:1 and #b91c1c is 3.14:1. Both fail AA. This surface already uses #15803d for the Active pill (TeamMembersPage.jsx:638, 2.28:1 on its own chip), #166534 for a positive rate total (3.46:1) and for "With rates", and #16a34a for the Projects status select (1.33:1).

- Why it matters: This is the finding my surface needs that the overall review did not anticipate. Resources is where WILSON renders state: active/inactive projects, rated/unrated members, positive/zero totals, active/deactivated accounts. The semantic palette therefore has to be derived against #f4a261, not against white. #7f1d1d is the only ink in the codebase proven on this page (4.86:1, visual-language.md). There is no proven green.

- Change: Two paths, and Audrey picks. Under her Option A (data pages move to the dark `paper`), the proposed semantic palette works unchanged and this finding disappears, which is an argument for Option A. Under Option B or C, drop colour-coded status on light entirely: StatusBadge renders LIGHT_INK at the 11px Label step on a LIGHT_WELL chip for the neutral state and a #c2410c chip carrying white for the signal state, which is already measured at 5.18:1 in RateCardTable.jsx:664. Add both greens and #b91c1c to lightSurface.test.js as failing controls either way.

- Evidence: `src/components/TeamMembers/TeamMembersPage.jsx:635` — `style={inactive   ? { backgroundColor: 'rgba(120, 70, 30, 0.12)', color: LIGHT_INK }   : { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#15803d' }}`<br>`src/components/RateCard/RateCardTable.jsx:828` — `style={{   color: computed.total > 0 ? '#166534' : LIGHT_INK, }}`<br>`src/components/RateCard/RateCardTable.jsx:660` — `// #c2410c is the same dark orange as the primary button, and carries white at 5.18:1.`




**F-R12 · MEDIUM · Density** — Sorting the Files table keeps indentation that no longer describes anything  
law: Law of Prägnanz

- Problem: sortRows reorders the flattened list globally while each row keeps the depth it had in the tree, and indent is only zeroed when a query is present. Sort by Size and a file three levels deep renders indented 54px directly beneath an unrelated root folder.

- Why it matters: Indentation is a structural claim about parentage. Once the sort has broken the parentage, the indent asserts a relationship that does not exist, which is worse than no indent. The file already contains the correct pattern one line above.

- Change: One line: `const indent = (query || sortKey !== 'name') ? 0 : 1`. Pass sortKey into TableView, which it does not currently receive for this purpose but already receives for the header arrows.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:210` — `const indent = query ? 0 : 1`<br>`src/components/Resources/fileTree.js:198` — `return [...rows].sort((a, b) => {   const va = val(a); const vb = val(b)`




**F-R20 · MEDIUM · System** — Three hover systems in one file, and four near-white hovers on an orange page  
law: Law of Similarity

- Problem: RateCardTable uses hover:bg-orange-900/10 in six places, hover:bg-orange-100 in four and hover:bg-red-100 in one. TeamMembers uses hover:bg-stone-200 three times, a cool grey on a warm page, and a JS onMouseEnter that writes LIGHT_WELL in a fourth. Projects list writes hover colours in JS onMouseEnter/onMouseLeave handlers. orange-100 (#ffedd5), red-100 and stone-200 are all lighter than #f4a261.

- Why it matters: A hover lighter than the page reads as a hole, not a highlight, and it is the same near-white defect as F-R05 at a smaller scale. Three treatments in one component means the same gesture produces three different answers within one table. The cool stone-200 also breaks visual-language Composition rule 2 (warm over cool).

- Change: One hover fill for the whole surface, a darker screen of the ink or LIGHT_WELL at low alpha, applied by the Table and Button components. Delete orange-100, red-100 and stone-200. Move the Projects list hover out of JS into CSS so it can also answer :focus-within.

- Evidence: `src/components/RateCard/RateCardTable.jsx:382` — `className="p-1 rounded-sm hover:bg-orange-100 transition-colors"`<br>`src/components/TeamMembers/TeamMembersPage.jsx:753` — `className="text-xs font-mono text-left hover:bg-stone-200 px-1 py-0.5 rounded-sm transition-colors"`<br>`src/components/Projects/ProjectListPanel.jsx:145` — `onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(120, 70, 30, 0.38)'}`




**F-R21 · MEDIUM · Flow** — The Rate Card burden cell puts a 9px, 45%-opacity toggle two pixels from a different action  
**constraint: touches-interaction** · law: Fitts's Law

- Problem: In display mode the burden and overhead cells render two adjacent buttons in a gap-0.5 (2px) flex row: the value button, which opens an inline editor, and a 9px %/$ toggle at opacity 0.45 with px-1 py-0.5 padding, giving roughly a 16x14px hit area. Both cells are repeated on every row.

- Why it matters: Fitts's Law: a 16px target 2px from a different target is a mis-click, and the mis-click here silently changes a rate from a percentage to a dollar amount on a financial record. The 45% opacity also means the control is a de-facto grey, which on this page class is the banned third ink rendered by another mechanism.

- Change: Keep both controls, keep both behaviours. Reserve a fixed 28px slot at the cell's right edge for the type toggle, separated from the value by 8px, rendered at the 11px Label step in full-opacity LIGHT_INK. In the editing branch the toggle is already 10px and sized correctly, so the two states finally match.

- Evidence: `src/components/RateCard/RateCardTable.jsx:189` — `className="px-1 py-0.5 text-[9px] font-bold font-mono rounded-sm hover:bg-orange-100 flex-shrink-0" style={{ color: '#7c2d12', opacity: 0.45, lineHeight: 1 }}`<br>`src/components/RateCard/RateCardTable.jsx:174` — `<div className="flex items-center gap-0.5">`




**F-R22 · MEDIUM · Hierarchy** — The Rate Card's active tab is set in a lighter ink than the inactive tab  
law: Von Restorff Effect

- Problem: tabStyle paints the active tab #7c2d12 (4.54:1 on the page) and the inactive tab #451a03 (roughly 7:1). The selection is carried by a LIGHT_WELL fill and a border, but the ink runs backwards: the tab you are not on has the stronger text.

- Why it matters: Hierarchy that is achieved by fill while the ink contradicts it is a hierarchy the eye has to override. It is also the only tab bar on this surface, so there is no second instance to learn the convention from.

- Change: One ink, LIGHT_INK, for both states. Active carries weight 600 and a 2px #ea580c underline; inactive carries weight 400 and no fill. This also retires the 2px #7c2d12 header rule and the marginBottom: -2px hack that exists to hide the tab's own bottom border.

- Evidence: `src/components/RateCard/RateCardPage.jsx:204` — `backgroundColor: isActive ? LIGHT_WELL : 'transparent', color: isActive ? '#7c2d12' : '#451a03', border: isActive ? '1px solid #7c2d12' : '1px solid transparent`




**F-R23 · MEDIUM · Density** — The Files details panel occupies 300px permanently to say nothing  
**constraint: touches-interaction** · _taste, not error_ · law: Cognitive Load

- Problem: DetailsPanel renders at a fixed 300px whether or not a file is selected, including in Table view where the seven columns are already competing. When empty it contains one 12px mono sentence.

- Why it matters: The Files page is the one view on this surface with a genuine width problem: seven nowrap columns, a Name column capped at maxWidth 420 and a Location column capped at 360, inside an overflow:auto container with no minimum widths, so column boundaries move per project. Spending 300px on an empty panel is emptiness, not structure.

- Change: Keep the panel and keep the interaction. Give it width 0 with overflow hidden and a 160ms width transition when nothing is selected, or collapse it to a 32px rail carrying the Details label. Either keeps every control reachable and returns 300px to the table on arrival, which is the state the page is in most of the time.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:295` — `<div style={{ width: 300, borderLeft: BORDER, padding: 16, fontSize: 12, color: MUTED, fontFamily: 'monospace' }} data-file-details="none">   Select a file to s`<br>`src/components/Resources/ProjectFilesExplorer.jsx:238` — `whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420`




**F-R24 · MEDIUM · System** — Nothing on this surface shows a keyboard hint, though four views register Enter and Escape  
law: Paradox of the Active User

- Problem: RateCardTable's EditCell and RateCompCell handle Enter and Escape; DeptDefaultInput does; TeamMembers' InlineLightText does; the rate modal handles Escape; the Projects create input commits on Enter. None of it is visible anywhere. BinsView mounts a 34px footer bar of Kbd pairs describing twelve shortcuts, and it is the only one in the app.

- Why it matters: This is Audrey's own named example of the uniformity failure. Paradox of the Active User says nobody reads a manual, so an undiscoverable shortcut is an unused one, and the cost of the inconsistency is that RABBIT teaches the user a convention that four Resources pages then withhold.

- Change: Promote BinsView's footer into a ShortcutBar component at 28px with a LIGHT_RULE top hairline, Kbd plus 12px label pairs grouped with 24px separators, and mount it on every view that registers document-level or field-level keys. On this surface that is Rate Card (Enter commit, Esc revert, Tab next cell), Team Members (same) and Files (once it gains row keys). Raise Kbd from 9px to the 11px Label step at the same time.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `<div className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap"   style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgro`<br>`src/components/RateCard/RateCardTable.jsx:92` — `onKeyDown={e => {   if (e.key === 'Enter') { e.preventDefault(); commit() }   else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }`<br>`src/components/TeamMembers/TeamMembersPage.jsx:946` — `onKeyDown={(e) => {   if (e.key === 'Enter') commit()   if (e.key === 'Escape') { setDraft(value); setEditing(false) }`




**F-R25 · MEDIUM · System** — ProjectDetailPanel is the only page here drawing 2px rules, and its divider is 2px of a translucent brown

- Problem: L.input and L.select carry 2px borders, L.divider is a 2px top rule, the drop zone is a 2px dashed border, and RateCardPage's ImporterCard uses a 2px #f4a261 border plus a 2px #7c2d12 header rule and a 2px #ea580c modal border. Everything else on the surface is 1px, including all four tables.

- Why it matters: A 2px rule against 11 to 13px type is roughly a sixth of the cap height, which is the same measurable reason the system review gives for D.O.G. and O.T.T.E.R. reading heavier and older than RABBIT. On a light-orange page the 2px translucent brown divider also reads as a smudge rather than a line.

- Change: One hairline at 1px everywhere, LIGHT_RULE on this page class. Delete every border-2 and every '2px solid' on this surface. The section divider becomes a single LIGHT_RULE hairline with 32px above and 24px below, replacing the current symmetric 28px margin.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:50` — `divider: {   borderTop: '2px solid rgba(120, 70, 30, 0.25)',   margin: '28px 0',`<br>`src/components/RateCard/RateCardPage.jsx:553` — `backgroundColor: 'transparent', border: '2px solid #f4a261', color: '#7c2d12',`<br>`src/components/RateCard/RateCardTable.jsx:562` — `borderBottom: '2px solid #7c2d12',`




**F-R26 · MEDIUM · Alignment** — Inline-edit cells sit 4 to 6px right of their plain neighbours in the Team Members table  
law: Law of Proximity

- Problem: TdLight pads px-3 (12px). Inside it, ReadCell renders a bare span at 12px, InlineLightText adds px-1 (4px) and InlineLightSelect adds px-1.5 (6px) plus a 1px border. So Member, Username and Pronouns start at 12px while Title starts at 17px and Department and Role start at 19px, against headers that all start at 12px.

- Why it matters: Five columns aligned to one edge and three to another, in an eight to twelve column table, is visible as a ragged left edge running down the middle of the table. It also means the editable columns announce themselves by misalignment rather than by an affordance.

- Change: Give the cell the padding and the control zero horizontal padding, with the control filling the cell (width 100%, negative margin equal to the cell inset if a focus ring needs room). Editability is announced on hover and focus by the well, which InlineLightText already paints, not by a permanent offset.

- Evidence: `src/components/TeamMembers/TeamMembersPage.jsx:928` — `function TdLight({ children }) {   return <td className="px-3 py-2 align-middle">{children}</td> }`<br>`src/components/TeamMembers/TeamMembersPage.jsx:959` — `className={'text-xs font-mono text-left w-full truncate px-1 py-0.5 rounded-sm transition-colors${value ? '' : ' italic'}'}`<br>`src/components/TeamMembers/TeamMembersPage.jsx:975` — `className="px-1.5 py-0.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"`




**F-R27 · MEDIUM · Alignment** — The Projects list Status value sits 9px right of its own column header

- Problem: The header spans pad 12px 14px inside a container padded 0 8px, so a label starts at 22px. Data cells pad 14px 14px, so most values also start at 22px. The Status cell wraps a select that adds its own 1px border plus 8px padding, so its text starts at 31px.

- Why it matters: It is the only misaligned column in the table and it is the column carrying the only state signal, so the eye catches the break exactly where it should be reading a value. Small, measurable, cheap.

- Change: Once F-R02 turns Status into a StatusBadge, give the badge zero left inset and let the cell own the 12px. Verify against the Title column, which is the alignment reference for the table.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:178` — `<span style={{ padding: '14px 14px' }}>   <select`<br>`src/components/Projects/ProjectListPanel.jsx:188` — `border: '1px solid rgba(120, 70, 30, 0.3)', borderRadius: 2, padding: '4px 8px', outline: 'none',`




**F-R28 · MEDIUM · Hierarchy** — In the Projects detail, Back, Open in RABBIT and Delete Project are the same button at the same size  
law: Cognitive Bias

- Problem: All three use padding 8px 16px, fontSize 13, fontWeight 700, uppercase, letterSpacing 0.04em. Back is #ea580c with white, Delete is #dc2626 with white, Open in RABBIT is #44403c with #fb923c. Delete sits at the bottom with no section heading of its own, directly after a divider identical to every other divider on the page.

- Why it matters: There is no primary action in this view, which means the page has none (critique pass 1). A destructive action rendered at the same weight as a navigation control, with no bounded danger region, is the pattern Cognitive Bias says to design against. The #fb923c on #44403c pairing is also a fourth button colourway used exactly once.

- Change: Back becomes a ghost button with a left chevron at the 14px step. Open in RABBIT becomes the secondary. Delete Project becomes a ghost danger button inside a bounded region with an 11px Label eyebrow reading DANGER ZONE and a LIGHT_RULE frame, placed after a heavier 32px gap than the other sections. Retire #44403c/#fb923c from this page.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:126` — `backgroundColor: '#44403c', color: '#fb923c', border: '1px solid #57534e', padding: '8px 16px', fontSize: 13, fontWeight: 700,`<br>`src/components/Projects/ProjectDetailPanel.jsx:501` — `backgroundColor: '#dc2626', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',`




**F-R29 · MEDIUM · System** — Four badge shapes on one surface, two of them at 9px  
law: Law of Similarity

- Problem: The Private badge is 9px bold uppercase 0.08em with a 1px #7c2d12 outline and radius 2. The PRODUCER/DIRECTOR badges are 9px bold uppercase on a #f4a261 fill with radius 2. The "you" badge is 9px on #ea580c. The status pill is 10px on a tinted fill with radius 2. The unrated tab count is 9px on #c2410c with rounded-full. Two of these are interactive-adjacent and three are inert, and nothing distinguishes the two kinds.

- Why it matters: Law of Similarity again, at the smallest scale where it still matters: five small coloured rectangles with five different rules teach the reader nothing. At 9px the tracking is not resolvable, so the tracking is cost without benefit.

- Change: Two components. Badge, inert: 11px Label step, LIGHT_INK on LIGHT_WELL, radius 4. StatusBadge, semantic: the same shell taking a token. Both at 11px, both radius 4, both with 4px 6px padding. rounded-full survives only on the numeric count, which is the one that genuinely reads as a counter.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:159` — `marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7c2d12', border: '1px solid #7c2d12',`<br>`src/components/TeamMembers/TeamMembersPage.jsx:540` — `className="text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm flex-shrink-0" style={{ backgroundColor: '#f4a261', color: '#7c2d12' }}`<br>`src/components/RateCard/RateCardPage.jsx:262` — `className="px-1.5 py-0.5 text-[9px] rounded-full font-bold" style={{ backgroundColor: '#c2410c', color: '#ffffff' }}`




**F-R30 · MEDIUM · Motion** — The drop zone transitions `all`, so its padding animates and the page jumps on first upload  
**constraint: touches-interaction** · law: Peak-End Rule

- Problem: transition: 'all 0.15s ease' is set on a container whose padding is conditional on fileCount (24px 32px when empty, 12px 24px once files exist) and whose marginBottom also flips 0 to 16px. The first successful upload therefore animates two layout properties and shifts everything below by 28px.

- Why it matters: Peak-End Rule: the first upload is the moment the feature proves it worked, and what the user sees is the page moving under them. A transition on `all` is also the one motion default that guarantees layout-affecting properties get animated by accident.

- Change: transition: 'background-color 120ms ease, border-color 120ms ease'. Keep one padding for both states, 16px 24px, so the size change disappears entirely rather than being animated. The icon size flip (22px to 16px) goes with it; one 16px icon in both states.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:356` — `padding: fileCount > 0 ? '12px 24px' : '24px 32px', ... transition: 'all 0.15s ease',`<br>`src/components/Projects/ProjectDetailPanel.jsx:365` — `size={fileCount > 0 ? 16 : 22}`




**F-R36 · MEDIUM · Typography** — Uppercase plus tracking is applied to every heading, label, button, tab, badge and header cell on the surface  
law: Von Restorff Effect

- Problem: Counted across the four pages: page titles, section titles, field labels, sublabels, every button, both tabs, all five sets of table header cells, four badge types, the status pill, the view switcher, the importer card labels and the department bar are all uppercase with positive tracking. Sentence case appears only in body paragraphs, table data and empty-state copy.

- Why it matters: This is the mechanism behind Audrey's "everything seems to use fonts that dont look super contemporary". When a section heading, a button, a table header and a 9px badge are all small bold tracked caps, the only difference between them is size, and at 9 to 13px the size differences are two or three pixels. Hierarchy collapses into a flat field of small caps that must be read rather than scanned. Notion and Apple both reserve caps for a single eyebrow role.

- Change: Uppercase survives in exactly two roles on this surface: the 11px Label step (table headers, field labels, eyebrows, Kbd) and the chrome page title. Section titles, buttons, tabs, badges, the view switcher and every card label go to sentence case at weight 600 with zero tracking. This is the largest single visual change in the pass and the one most likely to make her say it looks modern.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:45` — `section: {   fontSize: 16, fontWeight: 700, textTransform: 'uppercase',   letterSpacing: '0.05em', color: '#3a1e08',`<br>`src/components/RateCard/RateCardPage.jsx:237` — `className="px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider rounded-t-sm transition-colors"`<br>`src/components/TeamMembers/TeamMembersPage.jsx:301` — `className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"`




**F-R31 · LOW · Hierarchy** — The Projects folder tree expresses de-emphasis with opacity, which on an orange page is a grey

- Problem: Entity folders render at opacity 0.85 and root at fontWeight 700, inside a mono block on rgba(120,70,30,0.18) with #5c3415 text. Indentation is a raw paddingLeft multiplication with no rule or connector.

- Why it matters: Opacity on a coloured ground produces a blend toward the ground, which is precisely the mechanism the grey-on-orange rule exists to ban, arrived at by a different route. #5c3415 is also a sixth brown ink on a surface that is supposed to have one.

- Change: LIGHT_INK at the 13px Dense step for every row; weight 600 for the root, 400 for the rest, and drop the opacity entirely. Keep the paddingLeft indent, it is the one thing here that works.

- Evidence: `src/components/Projects/ProjectDetailPanel.jsx:448` — `paddingLeft: ((f.path || '').split('/').filter(Boolean).length) * 16, opacity: f.kind === 'entity' ? 0.85 : 1, fontWeight: f.kind === 'root' ? 700 : 400,`<br>`src/components/Projects/ProjectDetailPanel.jsx:437` — `fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#5c3415', backgroundColor: 'rgba(120, 70, 30, 0.18)',`




**F-R32 · LOW · Typography** — Files sets the Location column at 11px while every sibling cell is 13px

- Problem: The Location cell overrides to fontSize 11 and monospace inside a table whose cells are 13px, and it is capped at maxWidth 360 with ellipsis. The Size cell in Columns view does the same at 11px.

- Why it matters: A single column stepped down by 2px inside an otherwise even table reads as a rendering fault rather than a deliberate rank. If Location matters less, it belongs later in the column order or in the details panel, not at a smaller size.

- Change: 12px Caption step for Location, consistent with the other secondary columns once F-R03 removes the colour distinction. If the path still does not fit, truncate from the left so the leaf folder survives, which is what Finder does and what a path reader actually needs.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:246` — `maxWidth: 360, fontFamily: 'monospace', fontSize: 11 }}>{isFolder ? node.path : (node.parent && !node.parent.isRoot ? node.parent.path : '')}`<br>`src/components/Resources/ProjectFilesExplorer.jsx:282` — `: <span style={{ color: MUTED, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{formatBytes(node.meta?.sizeBytes)}</span>}`




**F-R33 · LOW · Density** — The Files details panel stacks label over value at a 0:10px proximity ratio  
_taste, not error_ · law: Law of Proximity

- Problem: Each dt/dd pair has no gap between the label and its value, and 10px between pairs. Eight pairs at two lines each fill roughly 290px of a 300px panel.

- Why it matters: Law of Proximity works on ratio, not absolutes. The app's own auth kit uses 5px within a field and 18px between (a 3.6:1 ratio) and documents that the ratio is what makes the pairing read. A 0:10 ratio means the pairs are held together only by the visual difference between the label and value styles, which F-R03 is about to reduce.

- Change: A two-column definition grid: 96px label column at the 11px Label step, value at the 13px Dense step, 8px row gap, baseline aligned. Eight rows fit in about 160px, the panel gains room for a preview or an action, and the label/value relationship is carried by the grid rather than by colour.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:316` — `<div key={k} style={{ marginBottom: 10 }}>   <dt style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>{k}</dt>   <dd styl`




**F-R34 · LOW · Density** — The Projects list and detail disagree on top padding by 4px, so the page twitches on open

- Problem: The list is padding 32px 40px, the detail is 28px 40px. Clicking a row moves everything up 4px.

- Why it matters: Both views are the same page under one title and one set of bars, so the only thing that changes on click should be the content. It is small, but it is free.

- Change: One page padding token for both, applied by the shell per F-R15.

- Evidence: `src/components/Projects/ProjectListPanel.jsx:40` — `padding: '32px 40px', flex: 1 }}>`<br>`src/components/Projects/ProjectDetailPanel.jsx:105` — `<div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 40px' }}>`




**F-R35 · LOW · Colour** — The Rate Card table header paints bare #f4a261, so it is the one table header with no region at all  
law: Law of Common Region

- Problem: th backgroundColor is #f4a261, identical to the page. The header is separated from the body only by a 2px #7c2d12 underline, while the three other tables on this surface all use a filled header band.

- Why it matters: A sticky header with no fill means that when the body scrolls under it, rows pass through the header text. It is also the fourth different answer to "what colour is a table header" within one nav group.

- Change: LIGHT_WELL, as in Team Members. It is the only opaque-enough value on this page class and it already has a test asserting it is darker than the page.

- Evidence: `src/components/RateCard/RateCardTable.jsx:559` — `const th = {   backgroundColor: '#f4a261',   color: '#1c1917',`




**F-R37 · LOW · Flow** — Files hides the Table/Columns switch in the middle of a wrapping toolbar  
_taste, not error_ · law: Serial Position Effect

- Problem: The view toggle sits third in a flex-wrap row, between the project select and the search field. At narrow widths the row wraps and the toggle moves below the fold of the header. It is also the only genuinely stateful control in the row.

- Why it matters: Serial Position: the first and last positions in a control row are the ones that are found. The view switch is the one decision this page asks the user to make repeatedly, and it is buried in the middle where the wrap lands.

- Change: Toolbar left slot in order: project select, then the segmented view switch. Right slot: search, Refresh, counts. The switch keeps both options and the same behaviour; it just stops being the thing that wraps.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:154` — `<div style={{ display: 'flex', gap: 6 }} role="group" aria-label="View">   <button type="button" style={btnStyle(view === 'table')} onClick={() => setView('tabl`





## Uniformity gaps

- **Keyboard shortcut hints** — here: Nothing. Four views on this surface register Enter/Escape (src/components/RateCard/RateCardTable.jsx:92-95, src/components/TeamMembers/TeamMembersPage.jsx:946-949, src/components/TeamMembers/TeamMembersPage.jsx:773, src/components/Projects/ProjectsPage.jsx:349) and none of them tells the user. — elsewhere: RABBIT's BinsView mounts a 34px footer of twelve Kbd pairs (src/tools/rabbit_v0.1.0/views/BinsView.jsx:844-848) using Kbd from binUi.jsx:134. It is the only one in the app, which is Audrey's own example. — do: Promote it to src/ui/ShortcutBar at 28px with Kbd at the 11px Label step, and mount it on Rate Card, Team Members and Files.

- **Table (header, row height, cell padding, dividers, zebra)** — here: Five implementations: src/components/Projects/ProjectListPanel.jsx:110-146 (grid, zebra, ~53px rows); src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx:123-149 (grid, zebra, radius 4); src/components/RateCard/RateCardTable.jsx:559-578 (table, bare-page header, #fed7aa divider, 30px rows); src/components/TeamMembers/TeamMembersPage.jsx:921-930 (table, LIGHT_WELL, no zebra, 40px rows); src/components/Resources/ProjectFilesExplorer.jsx:212-251 (table, #f5efe6 header, zebra, 32px rows). — elsewhere: Team Members is the closest to correct and its head/body padding already matches. — do: One src/ui/Table with Th/Td/Row promoted from the Team Members atoms. 36px row, 32px head on LIGHT_WELL, 8px/12px cells, LIGHT_RULE dividers, no zebra. ProjectFilesTable's warm variant adopts it too, which needs a cross-folder import decision the system review did not cover.

- **Table header cell type** — here: Five spellings: 11px mono 700 UPPER 0.06em (ProjectListPanel.jsx:120); 11px mono 700 0.06em (ProjectFilesTable.jsx:97); 10px mono 700 UPPER 0.05em (RateCardTable.jsx:563-566); 10px SANS 700 UPPER tracking-wider (TeamMembersPage.jsx:923); 10px SANS 700 UPPER 0.1em (ProjectFilesExplorer.jsx:219). Three tracking values, three inks, and a mono/sans split. — do: One Th at the 11px Label step, weight 600, +0.06em, LIGHT_INK, sans. Tracking is a property of the role, not of the page.

- **Text input and select** — here: Eleven treatments, enumerated in F-R08. Two of them (ProjectFilesExplorer.jsx:146,164 and ProjectsPage.jsx:353) drop a #1c1917 well onto the orange page; four use the rgba(120,70,30,0.55)+#fde8d0 pairing that lightSurface.js:50-59 records as failing at 3.38:1. — elsewhere: RateCardTable.jsx:97 is the only one that uses shared tokens. — do: Two inputs from the kit, docked and inline-edit. No dark wells on light pages.

- **Page header / page title** — here: Four pages print their title twice (see F-R06), each with different metrics, and four different header containers: a bordered flex row (ProjectFilesExplorer.jsx:140), a title+subtitle+button block (ProjectListPanel.jsx:42-68), an icon+title row (TeamMembersPage.jsx:283-288), and a bordered bar with tabs (RateCardPage.jsx:217-306). — elsewhere: App.jsx:1892-1906 already renders a correct H1 for all of them. — do: Delete the in-page titles. One 44px Toolbar with left and right slots, driven by the PAGES registry so a new page cannot be registered in two lists and missed in a third, which is exactly how F-R04 happened.

- **Empty and loading states** — here: Nine shells across four pages (F-R13). On Files the loading and empty states are the same component with different strings. — do: One EmptyState plus a separate Loading with table skeleton rows, so a slow adapter never looks like an empty project.

- **Error banner** — here: Six shells, four inks (#dc2626, #991b1b, #fca5a5, text-red-400), and one near-white pink band (RateCardPage.jsx:312). None of them is the measured AUTH_ERROR_INK. — elsewhere: src/cloud/auth/AuthShell.jsx exports AUTH_ERROR_INK #7f1d1d at 4.86:1 on this exact page class. — do: One ErrorBanner, one danger ink #7f1d1d, asserted in lightSurface.test.js alongside the existing failing controls.

- **Hover treatment** — here: Three in RateCardTable alone (orange-900/10, orange-100, red-100), plus stone-200 in TeamMembers, plus JS-written inline styles in ProjectListPanel.jsx:145-146 and 230-231, plus none at all in ProjectFilesExplorer. — do: One hover fill from the kit, applied by Table and Button, in CSS so :focus-within answers too.

- **Mono policy** — here: Names are mono in Team Members and sans in Projects. Rate Card is mono throughout including role labels. Files mixes within a single row. 21 of the mono declarations on this surface are inline `fontFamily` strings, invisible to an app-wide font-mono sweep. — do: Mono keeps numerics, paths, ids and keys only. Sweep both the class and the inline spelling.

- **Badges and status pills** — here: Five shapes at 9px and 10px with four fills and two radii (F-R29). — do: Badge (inert) and StatusBadge (semantic), both 11px, radius 4, one active treatment.

- **Border weight** — here: ProjectDetailPanel and RateCardPage draw 2px rules and inputs; the four tables draw 1px. — elsewhere: RABBIT is 1px in 912 places. — do: One hairline at 1px everywhere on this surface.


## Alignment issues

- Rate Card table, all eleven columns (`src/components/RateCard/RateCardTable.jsx:574`): th padding '6px 4px' against td padding '1px 2px' plus an inner px-2, so every column label sits 6px left of its own data and the row's vertical rhythm comes from a child's minHeight rather than the row. → One cell padding token, 8px 12px, on both th and td; inner controls padded to zero; row height 36px and head 32px set on the row.

- Team Members table, Title / Department / Role columns (`src/components/TeamMembers/TeamMembersPage.jsx:959`): TdLight pads 12px; InlineLightText adds 4px and InlineLightSelect adds 6px plus a border, so three of eight to twelve columns start 5 to 7px right of the rest and of their own headers. → Cell owns the inset; the control fills the cell at width 100% with zero horizontal padding.

- Projects list, Status column (`src/components/Projects/ProjectListPanel.jsx:178`): Header label starts at 22px, the select's text starts at 31px because the wrapper span and the select each add their own padding. → Replace with a StatusBadge at zero left inset; the cell supplies the 12px.

- Files table, Size and Duration columns (`src/components/Resources/ProjectFilesExplorer.jsx:242`): Monospace numerics are left-aligned with left-aligned headers, so ragged-length byte counts and timecodes cannot be compared down the column. → Right-align with tabular-nums, and move alignment into the HEADERS array so header and cell cannot disagree.

- Files header toolbar (`src/components/Resources/ProjectFilesExplorer.jsx:140`): An 18px heading, two 38px fields, three 27px buttons and a 12px string share one centre-aligned row, so nothing sits on a baseline and the row wraps unpredictably. → 44px Toolbar, every child 28px, left and right slots, never wraps.

- Files table, sorted state (`src/components/Resources/ProjectFilesExplorer.jsx:210`): Depth indentation is retained after a sort has destroyed the parent-child ordering, so indentation asserts a relationship the rows no longer have. → const indent = (query || sortKey !== 'name') ? 0 : 1

- Projects list to detail transition (`src/components/Projects/ProjectDetailPanel.jsx:105`): 32px top padding on the list, 28px on the detail, so the content shifts 4px when a row is opened. → One page padding token owned by the shell.

- Files column browser, folder chevron (`src/components/Resources/ProjectFilesExplorer.jsx:281`): The '›' affordance is MUTED #7c4f1f at 3.40:1 and is the only signal distinguishing a folder from a file at the right edge of a 260px column, while the left edge distinguishes them by fontWeight 700 against 500. → LIGHT_INK chevron, and make the folder/file distinction carry on one axis rather than two weak ones.

- Projects list, header row versus data rows (`src/components/Projects/ProjectListPanel.jsx:112`): The seven-column grid template is written out twice, once for the header at line 112 and once per row at line 136. Any column change has to be made in two places or the header silently detaches from the body. → Hoist the template to one constant, or let the Table component own it.

- Rate Card sort and group headers (`src/components/RateCard/RateCardTable.jsx:647`): The actions column header is a '⋯' glyph right-aligned in a 4% column while its cells are a two-icon flex row; and the department bar spans all eleven columns with its own 12px inset, so the group label does not align to the Role column beneath it. → Fixed-width action slot, and indent the department bar's label to the first column's text inset so the grouping reads as a heading over the column it names.


## Hick's Law hotspots

- Files page, arrival state (no project chosen): 5 visible choices → Low count but the wrong grouping: the Table/Columns radio pair and the Refresh command are rendered by the same btnStyle helper, so three identical pills offer two different kinds of decision. Split by slot, not by hiding: project select and the segmented view switch in the Toolbar's left slot, search plus a ghost Refresh icon plus the counts in the right slot. Nothing is removed.

- Files table, loaded state: 19 visible choices → Seven sortable headers, seven interactive column widths, the five toolbar controls, plus every row. The headers are the real cost: each carries an appended ' ▲' that shifts the label when sorting changes, so the reader re-reads the row on every sort. Give the sort glyph a fixed 12px slot so the header labels never move, and let the active column carry weight 600 so the current sort is findable without reading all seven.

- Rate Card, General tab with the defaults panel open: 26 visible choices → Two tabs, Export, three importer cards, the defaults disclosure, then ten department cards each holding two inline editors. The ten-card grid duplicates editors that already exist on every department group bar in the table below (RateCardTable.jsx:692-701), so the same value is editable in two places on one screen. Keep both behaviours but collapse the panel by default (it already is) and label it 'Edit all department defaults', so it reads as the bulk path rather than a second, competing one.

- Rate Card table row: 14 visible choices → Per row: role, department select, hourly, day, burden value, burden type toggle, overhead value, overhead type toggle, currency, region, tier, duplicate, delete. Fourteen targets in a 30px band, two of them 16px wide and 2px apart. Do not remove any. Reserve a fixed 28px slot for each type toggle at its cell's right edge, and move duplicate/delete into a HoverActions slot revealed on row hover and focus-within, which takes the resting count to twelve and the visual count to ten.

- Team Members toolbar: 9 visible choices → Up to three view buttons, Invite, Export, department select, search, clear, count, in one wrapping flex row with no grouping and four control heights. Group into two slots with a single hairline between them: views and Invite on the left as the 'what am I looking at / act on it' group, filters and count on the right. Same nine controls, two regions instead of one undifferentiated run.

- Projects detail view: 13 visible choices → Eight form fields plus three page-level buttons plus the drop zone plus the files table, with Delete Project rendered at the same size and weight as Back. The count is fine for a form; the failure is that no control is primary. Demote Back to a ghost, keep Open in RABBIT as secondary, and put Delete in a bounded danger region so the eye stops counting it among the navigation.


## Type inventory

| Role as used today | Size / weight / case / tracking / family | Where | Collapses to |
|---|---|---|---|
| Page title, in-page duplicate | 18px 700 UPPER 0.06em sans | ProjectListPanel.jsx:44; ProjectFilesExplorer.jsx:141; TeamMembersPage.jsx:285; ProjectsPage.jsx:342 | **Deleted.** The chrome H1 at 20px is the only page title (F-R06) |
| Page title, Rate Card variant | 14px 700 UPPER tracking-widest sans | RateCardPage.jsx:225 | Deleted, same reason |
| Section title | 16px 700 UPPER 0.05em | ProjectDetailPanel.jsx:45 | H2, 16px 600 sentence case, no tracking |
| Empty-state title | 16px 700 sentence | ProjectListPanel.jsx:83 | H2 16px 600, same object |
| Row title / project name | 15px 600 sans | ProjectListPanel.jsx:150 | Dense 13px 600 |
| Form input value | 15px 400 mono | ProjectDetailPanel.jsx:32 | Body 14px 400 sans |
| Delete-confirm question | 14px 700 sentence | ProjectListPanel.jsx:249; ProjectDetailPanel.jsx:472 | Body 14px 600 |
| Toolbar field | 14px mono (text-sm) | ProjectFilesExplorer.jsx:145,163 | Body 14px 400 sans |
| Field label | 13px 700 UPPER 0.05em | ProjectDetailPanel.jsx:21 | Label 11px 600 UPPER +0.06em |
| Button | 13px 700 UPPER 0.04em | ProjectListPanel.jsx:61; ProjectDetailPanel.jsx:114,127,479,490,502 | Body 14px 600 sentence, no tracking |
| Description / help copy | 13px 400 sentence | ProjectListPanel.jsx:50; ProjectDetailPanel.jsx:343,423 | Dense 13px 400 |
| Table cell | 13px 500/700 sans | ProjectFilesExplorer.jsx:238 | Dense 13px, 600 for the name column only |
| Empty-state body | 13px mono | ProjectFilesExplorer.jsx:200 | Dense 13px sans |
| Status control | 12px 700 UPPER 0.04em | ProjectListPanel.jsx:184 | Label 11px 600 inside a StatusBadge |
| Date cell | 12px mono | ProjectListPanel.jsx:207,215 | Caption 12px mono (mono KEPT: numeric) |
| Generic cell | 12px mono (text-xs) | RateCardTable + TeamMembersPage, ~45 uses | Dense 13px sans; mono only for wage/total/size |
| Sublabel | 11px 400 UPPER 0.04em | ProjectDetailPanel.jsx:26 | Label 11px 600 UPPER |
| Timestamp | 11px 400 mono | ProjectDetailPanel.jsx:141,146 | Caption 12px mono |
| Panel copy | 11px mono (text-[11px]) | RateCardPage.jsx:357,379,410,437,467 | Dense 13px sans |
| Small button | 11px 700 UPPER tracking-wider | TeamMembersPage.jsx:315,328,900,909 | Body 14px 600 sentence |
| Location / size cell | 11px mono | ProjectFilesExplorer.jsx:246,282 | Caption 12px mono |
| Table header cell (five spellings) | 10-11px 700 UPPER, tracking 0.05 / 0.06 / 0.1em, mono and sans | ProjectListPanel.jsx:120; ProjectFilesTable.jsx:97; RateCardTable.jsx:563; TeamMembersPage.jsx:923; ProjectFilesExplorer.jsx:219 | **One** Label 11px 600 UPPER +0.06em sans |
| Details eyebrow | 10px 700 UPPER 0.1em | ProjectFilesExplorer.jsx:314 | Label 11px |
| Details dt | 10px 400 UPPER 0.08em | ProjectFilesExplorer.jsx:318 | Label 11px 600 |
| Panel eyebrow | 10px mono UPPER tracking-widest | RateCardPage.jsx:337,393 | Label 11px sans |
| View switcher | 10px 700 UPPER tracking-wider | TeamMembersPage.jsx:301 | Body 14px sentence, 600 active |
| Status pill | 10px 700 UPPER tracking-wider | TeamMembersPage.jsx:635 | Label 11px in StatusBadge |
| Dept default / importer note | 10px mono | RateCardTable.jsx:340,366; RateCardPage.jsx:562 | Caption 12px (mono only for the % value) |
| Private badge | 9px 700 UPPER 0.08em | ProjectListPanel.jsx:159 | Label 11px in Badge |
| Staff / self badge | 9px 700 UPPER tracking-wider | TeamMembersPage.jsx:540,548 | Label 11px in Badge |
| Computed amount, %/$ toggle, dept chip | 9px mono | RateCardTable.jsx:192,200,610 | Label 11px; **nothing below 11px ships** |

**Totals today: 9 distinct pixel sizes, ~31 distinct type objects, 4 of them below the 11px floor, 66 font-mono class uses plus 21 inline monospace declarations. Target: 6 of the 8 scale steps in use (20 is chrome-only, 34 is the transition overlay), 2 weights, uppercase in 1 role.**


## Priority order

F-R04 — add 'project-files' to PAGE_BARS. One line, returns 186px to the page Audrey called atrocious. Do it first because every density judgement below is made against the wrong viewport until it lands., F-R01 — promote lightSurface.js into the light half of the src/ui kit. Every finding from F-R07 down is an instance of this one, and fixing them individually leaves the mechanism that produced them intact., F-R02 — the Projects status column at 1.1:1. Highest severity measured defect on the surface and it is six lines., F-R03 — delete MUTED #7c4f1f from Files. Six of seven columns at 2.6 to 3.4:1. This is the measured answer to 'files database looks atrocious'., F-R05 — replace the #f5efe6 near-white header. Same page, same complaint, and a test already exists that forbids it., F-R14 — one danger ink #7f1d1d and one ErrorBanner. The delete confirmation at 2.34:1 is the least readable text at the most consequential moment., F-R19 — the semantic palette must be re-derived against #f4a261. Blocked on Audrey's F36 ruling; raise it early because Option A makes it disappear., F-R06 — delete the four duplicated in-page titles. Cheap, and it is the first thing the eye resolves on every page in the group., F-R36 — uppercase and tracking drop to one role. Largest perceptual change per line edited, and the direct answer to 'fonts that dont look super contemporary'., F-R18 — apply the mono rule, sweeping the 21 inline declarations as well as the 66 classes., F-R17 — collapse ~31 type objects onto the eight-step scale. Do it with F-R36 and F-R18 as one typography pass, not three., F-R07 — one Table component. The largest single structural fix and the one that makes the four pages read as one section., F-R08 — two inputs, and the dark wells leave the light pages., F-R09 — Rate Card head/body padding parity. Falls out of F-R07 but must be verified separately because it is the worst alignment defect and the file is 970 lines., F-R15 — one page gutter and two measures, owned by the shell., F-R16 — one 44px Toolbar with 28px children, on all four pages., F-R10 — right-align and tabularise the numeric columns., F-R11 — hover and focus on the Files table and column list., F-R13 — one EmptyState and a separate Loading., F-R12 — the one-line sorted-indent fix., F-R24 — the ShortcutBar. Audrey's named example; it is a new component, so it follows the kit., F-R25 — one hairline at 1px., F-R20 — one hover fill, near-white and cool hovers deleted., F-R29 — Badge and StatusBadge., F-R26 / F-R27 — the two remaining cell-inset misalignments., F-R21 — the burden type toggle's hit target., F-R22 — the Rate Card tab ink., F-R28 — the Projects detail button hierarchy and danger region., F-R35 — LIGHT_WELL on the Rate Card header., F-R30 — the drop zone's `all` transition., F-R31 / F-R32 / F-R33 / F-R34 / F-R37 — the low-severity remainder, folded into whichever session owns the file.


## Rework scope (reviewer's estimate)

Files: `src/components/lightSurface.js (86 lines today; becomes the light half of the src/ui kit)`, `src/components/lightSurface.test.js (115; extend with danger/success/muted failing controls)`, `src/layout/pageBars.js (1 line added)`, `src/App.jsx (2 regions: the 3vh padding at 2100, and the PAGES registry so a page cannot be registered in two lists and missed in a third)`, `src/components/Resources/ProjectFilesExplorer.jsx (325; effectively a full rewrite onto the kit)`, `src/components/Resources/fileTree.js (1 line, the sorted-indent signal)`, `src/components/Projects/ProjectsPage.jsx (486; only the create view at 338-393 and the props at 449-485)`, `src/components/Projects/ProjectListPanel.jsx (298; full)`, `src/components/Projects/ProjectDetailPanel.jsx (534; full, the L object at 20-54 goes)`, `src/components/RateCard/RateCardPage.jsx (566; the header at 212-306, the left panel at 331-448, four empty states, ImporterCard)`, `src/components/RateCard/RateCardTable.jsx (970; th/td at 559-578, six sub-components, the department bar, the draft row)`, `src/components/TeamMembers/TeamMembersPage.jsx (981; the toolbar at 291-361, the table atoms at 921-981, the row at 515-694; the RateCardEditorModal at 767-918 is a DARK surface and is deliberately out of scope except for its button metrics)`, `src/tools/rabbit_v0.1.0/components/ProjectFilesTable.jsx (273; the warm variant only, roughly 80 lines)`  
Approx lines: 1500  
Suggested sessions: 3  
Split: Session A, the kit and the shell (~450 lines, mostly new): extend lightSurface into src/ui with Table (Th/Td/Row), Toolbar, PageHeader, Input/Select, Button, Badge/StatusBadge, EmptyState, Loading, ErrorBanner, Kbd, ShortcutBar, HoverActions. Add 'project-files' to PAGE_BARS and fix the shell gutter. Extend lightSurface.test.js with #7c4f1f, #6b4423, #16a34a, #15803d, #166534, #dc2626, #b91c1c and #f5efe6 as failing controls and #7f1d1d and #c2410c-with-white as passing ones, so F-R03, F-R05, F-R14 and F-R19 become executable rather than remembered. Ship nothing visual; the kit is unreferenced at the end of this session, which is the point (no page changes, no risk). Session B, Files and Projects (~600 lines): ProjectFilesExplorer, ProjectListPanel, ProjectDetailPanel, the ProjectsPage create view, and the ProjectFilesTable warm variant. These four render together and share three of the five tables, so splitting them leaves half a surface converted. Session C, Rate Card and Team Members (~450 lines): RateCardTable, RateCardPage, TeamMembersPage. Both pages read the same rate hook and Team Members hosts the rate modal, so they share state assumptions and belong together. If the budget only allows two sessions, merge A into B and keep C separate; do NOT merge B and C, because RateCardTable alone is 970 lines with six stateful sub-components.  
Risks: 1) RateCardTable.jsx is 970 lines containing six sub-components (EditCell, RateCompCell, CurrencyCell, DepartmentSelect, TierSelect, DeptDefaultInput, RowActions) whose editing-versus-display state is expressed ONLY as an inline-style swap between two returned JSX branches. Any extraction must preserve BOTH branches; converting only the display branch silently leaves the editor unstyled, and the editor is what the user sees while typing. 2) src/lib/localMediaWiring.test.js:158-166 pins exact source strings from App.jsx including "{ id: 'project-files',   label: 'FILES' }," with its literal triple space. Adding the PAGE_BARS entry is safe, but any reformat of the nav registry breaks the test; read that test before touching App.jsx. 3) ThLight/TdLight (TeamMembersPage.jsx:921-930) are the origin of five verbatim copies elsewhere in the app that have already diverged. Restyling them in place without promoting them widens the drift instead of closing it. 4) ProjectListPanel rows are divs carrying onClick plus JS onMouseEnter/onMouseLeave that write inline backgroundColor. Moving hover to CSS changes the DOM shape and the computed style, so any snapshot or e2e selector reading that inline style breaks; there is no such test today but the rows also have no role or tabIndex, so adding focus styling is an interaction change and must be flagged to Audrey under constraint 1. 5) F-R19 and F-R02 and F-R14 are all blocked on Audrey's F36 page-class ruling. Under Option A (data pages move to the dark paper) three findings evaporate and Session B's Files rewrite is materially different; get the ruling before Session B starts, not during it. 6) The 21 inline fontFamily monospace declarations on this surface do not appear in the app-wide 1,917 font-mono count, so a class-only sweep will report the mono work as finished while Projects detail and Files are still half mono. 7) ProjectFilesTable lives under src/tools/rabbit_v0.1.0/ and is rendered by a Resources page; adopting the shared kit means either a Resources page importing tool code (already true) or a tool importing src/ui. The system review's component inventory did not name this file, so the import direction needs deciding in Session A. 8) The Rate Card's ghost rows, draft row and dept-default editors write through the same handleUpdate path; a restyle that changes which element receives the click (for example wrapping a cell) can convert a ghost row into a real entry on a stray click, which is a write to a financial record. Verify against the ghost branch at RateCardTable.jsx:529-538 before and after.
