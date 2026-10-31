# Review — Admin Terminal (src/components/AdminTerminal/, 13 files, 4,933 lines) — light page, admin-only, seven sections behind a 190px left nav


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\AdminTerminalPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\StorageSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\UsersSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\ChangeRequestsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\LogsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\CompanySection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\MultiInviteDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\CreateUserDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\DiagnosticsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\ModelsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\WorkspaceTakeout.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\CredentialsPopup.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\AdminTerminal\StorageCleanupCard.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\lightSurface.js (context)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js (context)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx (lines 1884-1975, 2092, context)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\TeamMembers\TeamMembersPage.jsx (lines 921-927, drift comparison)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (lines 838-848, shortcut-bar comparison)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (lines 134-139, Kbd)`


## Job

The Admin Terminal is the operator bench for one workspace: it exists so a workspace admin can answer "who is in this company, what can they reach, and is the plumbing healthy". It is not one screen, it is seven, and the one action differs per sub-view, which is correct for a console. Users (the default, and by the file's own Pareto note the 80% job): find one person in the roster and change one thing about their access. Company: rename the workspace and manage the department list. Models: pin one AI function to one model. Storage: choose where this company's media lives and prove the choice works. Requests: decide one pending change request, approve or send back. Logs: scan the newest 100 events for the one that explains a complaint. Diagnostics: copy a paste-ready block into a bug report. Every sub-view passes the single-action test except Storage in byos + S3 mode, which has three co-equal primaries on one card (Save bucket, Save secret, Test connection) and is therefore the one sub-view whose job is genuinely unclear at a glance. The shell's job, naming which of the seven you are in, is done by an 11px nav chip and by nothing else in the content pane.


## What works

- The four dialog headers are already one component in everything but name: `font-mono uppercase text-sm tracking-widest` in `#ea580c` beside a 16px lucide icon, identical in UsersSection.jsx:650, MultiInviteDialog.jsx:171, CreateUserDialog.jsx:102 and CredentialsPopup.jsx:100. Promote that pairing verbatim into Dialog's header slot; it needs a type change, not a design decision.

- The left nav's active state is built correctly: a 3px left border in the signal colour plus a 10% signal fill, with an equal 3px transparent border on the inactive state (AdminTerminalPage.jsx:109-110), so selecting an item does not shift the label by a pixel. That fixed-width-slot discipline is exactly what the Table component's sort slot needs, and it is the only place on the surface that already does it.

- The mode and provider pickers in StorageSection (lines 619-640, 813-834) are the best-composed blocks on the page: icon, title and a real explanatory blurb in one bounded target, arranged vertically so the two options are compared by reading down rather than across. They satisfy Common Region without a card boundary fighting the card they already sit in, and they should be the model for every binary choice in the app.

- CredentialsPopup's arm-before-close (CredentialsPopup.jsx:75-83) and the two-step local-folder confirm in StorageSection (lines 934-974) are genuinely good interaction design: step one states what will happen, step two asks. Both are in scope only for their typography, and neither should be touched otherwise.

- ModelsSection is the surface's own proof that the mono default is unnecessary: it contains zero `font-mono` classes (the other twelve files carry 109 between them) and it is the most readable dense list here. It is the pilot for the sans-only rule.


## Findings (34)

**AT-01 · HIGH · Colour** — The ADD PEOPLE menu hints are black on black, contrast 1.00:1  
law: Law of Similarity

- Problem: MenuItem renders its hint with `color: LIGHT_INK` (#1c1917) inside a menu panel painted `backgroundColor: '#1c1917'`. The two strings 'They set their own password' and 'You hand over the credentials' are literally invisible, and the hover state `hover:bg-stone-800` (#292524) only lifts them to about 1.1:1. This is the exact failure lightSurface.js:22-25 warns about: the element was classified by the file it lives in (a light page) rather than the surface it sits on (a dark floating panel).

- Why it matters: This is the cheapest high-severity fix on the surface and it is the only one that is a straight defect rather than a judgement. It also demonstrates the mechanism the whole rework has to prevent: a shared token applied by file rather than by surface.

- Change: Repaint the menu as a light-surface floating panel using LIGHT_SURFACE_SOLID (#dd9155, black measures 6.91:1 on it) with LIGHT_INK label and a 72% screen of the ink for the hint, or keep it dark and set the hint to the dark-surface secondary ink. Either way the menu must come from the shared Menu component so this cannot recur; its label/hint pairing is already solved in binUi.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:197` — `style={{ backgroundColor: '#1c1917', border: '1px solid #ea580c', minWidth: '210px' }}`<br>`src/components/AdminTerminal/UsersSection.jsx:697` — `{hint && <span className="block text-[10px] mt-0.5" style={{ color: LIGHT_INK }}>{hint}</span>}`<br>`src/components/lightSurface.js:22` — `// their job. Classify by the SURFACE an element actually sits on, never by // the file it lives in`




**AT-02 · HIGH · System** — Four private copies of the same secondary button, already diverged three ways  
law: Law of Similarity

- Problem: `darkBtnClass` + `darkBtnStyle` are declared, byte-for-byte as a pair, in four files. They have already drifted: CompanySection and StorageSection declare the class without the flex wrapper, DiagnosticsSection and StorageCleanupCard bake `flex items-center gap-1.5` into it, and StorageSection then re-adds the wrapper ad hoc at line 896 with `gap-1` instead of `gap-1.5`. On top of that, five more files hand-write the identical button from scratch rather than importing any of the four constants, so the same control exists in nine spellings inside one directory. This is Audrey's uniformity complaint in miniature, inside a single folder, not across tools.

- Why it matters: Highest leverage system fix on the surface: it removes 24 divergence sites, deletes two constants from four files, and it is mechanical. It also kills the disabled-opacity inconsistency (0.40 in two files, 0.50 in two) for free.

- Change: Delete all four constant pairs and all nine hand-written spellings; render every one of them as `<Button variant="secondary" size="sm">` from the shared kit. There are 24 call sites; none of them has a bespoke requirement.

- Evidence: `src/components/AdminTerminal/CompanySection.jsx:32` — `const darkBtnClass = 'px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40' const darkBtnStyle = { backgr`<br>`src/components/AdminTerminal/DiagnosticsSection.jsx:28` — `const darkBtnClass = 'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50'`<br>`src/components/AdminTerminal/StorageSection.jsx:896` — `className={'${darkBtnClass} flex items-center gap-1'} style={darkBtnStyle}>`<br>`src/components/AdminTerminal/ModelsSection.jsx:122` — `className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40" style={{ backg`




**AT-03 · HIGH · System** — The shared light-surface tokens are imported as a badge and then bypassed  
law: Law of Uniform Connectedness

- Problem: Six of thirteen files import LIGHT_RULE; four of them (ChangeRequestsSection, CompanySection, DiagnosticsSection, ModelsSection) never reference it after the import line and spell hairlines as `rgba(120, 70, 30, 0.3)` or `#d6d3d1` instead. UsersSection imports LIGHT_WELL, LIGHT_TABLE_FRAME and LIGHT_TABLE_HEAD_CELL and uses none of the three, writing `rgba(120, 70, 30, 0.18)` as a literal at line 169 where LIGHT_WELL is exactly that value. LogsSection imports LIGHT_TABLE_FRAME and LIGHT_RULE and uses neither. The token module works; nothing enforces it, so the surface reads as if it had no tokens at all.

- Why it matters: The system review calls lightSurface.js the counter-example that proves the local-tokens rule is the defect. On this surface the module is imported six times and honoured twice, which means the cure was applied and then ignored. Any rework that does not add enforcement will drift again within two sessions.

- Change: Remove every unused import, then replace the literals they were meant to prevent: `rgba(120,70,30,0.18)` becomes LIGHT_WELL (7 sites), `rgba(120,70,30,0.3)` and `#d6d3d1` become the hairline token (15 sites), `#1c1917`/`text-stone-900` become the ink token (65 sites). Add an eslint no-unused-vars gate so an imported token that is not used fails the build rather than shipping as a comment.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:34` — `LIGHT_INK, LIGHT_RULE, LIGHT_WELL, LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW, LIGHT_TABLE_HEAD_CELL,`<br>`src/components/AdminTerminal/UsersSection.jsx:169` — `<div className="flex items-center gap-1 rounded-sm p-0.5" style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)' }}>`<br>`src/components/AdminTerminal/ModelsSection.jsx:51` — `import { LIGHT_INK, LIGHT_RULE } from '../lightSurface' // §B — light page`<br>`src/components/AdminTerminal/ModelsSection.jsx:152` — `<div className="rounded-sm" style={{ border: '1px solid #d6d3d1' }}>`




**AT-04 · HIGH · Colour** — Three of the four tables are framed in colours lighter than the page they sit on  
law: Law of Common Region

- Problem: LogsSection's two tables, the Diagnostics error-code table and the ModelsSection row group are all framed `1px solid #d6d3d1` with `1px solid #e7e5e4` row dividers, on a `#f4a261` page. lightSurface.js's own measurement block lists both values under 'lighter than the page itself'. They render as pale outlines floating on orange, which is precisely the near-white-card defect Audrey rejected on the Rate Card. Meanwhile the roster table one nav item away is framed with LIGHT_RULE, a tint of the ink. Two table frames, one page, one session.

- Why it matters: Cheap, mechanical, and it fixes the thing Audrey actually sees. A hairline that is lighter than its ground is not a hairline, it is a highlight, and three of this surface's four data views are drawn in it.

- Change: Replace all five frame values and all five divider values with the single hairline token. That is ten one-line edits and it is the single change that will most visibly pull Logs, Diagnostics and Models into the same page as Users.

- Evidence: `src/components/AdminTerminal/LogsSection.jsx:265` — `<div className="overflow-auto flex-1 rounded-sm wilson-light-scroll" style={{ border: '1px solid #d6d3d1', maxHeight: '100%' }}>`<br>`src/components/AdminTerminal/LogsSection.jsx:298` — `style={{ borderBottom: expanded ? 'none' : '1px solid #e7e5e4' }}`<br>`src/components/AdminTerminal/UsersSection.jsx:239` — `<div className="overflow-auto flex-1 rounded-sm wilson-light-scroll" style={{ border: '1px solid ${LIGHT_RULE}' }}>`<br>`src/components/lightSurface.js:17` — `//     #e7e5e4  stone-200   lighter than the page itself`




**AT-05 · HIGH · Colour** — Every error banner on the page sits at roughly 2.1:1  
law: Selective Attention

- Problem: The standard error treatment here is `#dc2626` text on `rgba(220,38,38,0.1)` over `#f4a261`. Composited that ground is rgb(242,150,91) and the measured contrast is 2.14:1. The visual-language document already records `#ef4444` at 1.83:1 on this page and names `#7f1d1d` (4.86:1) as the fix, so the correct value is known and was not applied here. There are also two error inks in use on the same surface, `#dc2626` in six files and `#991b1b` in four, plus the alpha written two ways (0.1 and 0.10) and three icon choices (none, AlertCircle, AlertTriangle), giving seven distinct error-banner implementations across thirteen files.

- Why it matters: An error message an admin cannot read is an error message that did not happen. This one blocks the job in four of seven sub-views and the corrected value is already written down in the project's own design doc.

- Change: One Banner component, variant danger: `#7f1d1d` ink, one ground, one AlertTriangle at 16px, optional dismiss. Delete the other six. `#dc2626` and `#991b1b` both retire from the light surface; `#dc2626` may stay inside the dark dialogs where it measures acceptably.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:217` — `style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:257` — `<div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(153,27,27,0.10)' }}>   <AlertCircle className="w-4 h-4 mt-0.5 `<br>`src/components/AdminTerminal/WorkspaceTakeout.jsx:172` — `<div className="mb-3 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>`




**AT-06 · HIGH · Colour** — The whole semantic colour vocabulary fails on the orange ground and violates the white-or-black rule  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: Measured against `#f4a261`: `#15803d` success 2.43:1 (9 uses), `#c2410c` 2.50:1 (5), `#b45309` 2.6:1 (2), `#166534` 3.41:1 (8), `#9a3412` 3.54:1 (13). Not one of them reaches 4.5:1 and not one of them is white or black, so Audrey's standing rule is broken 37 times on this surface. The most visible instances are the Members-summary numbers, where 'Active' is painted #15803d and 'Admins' #c2410c at 20px, and the CountStat label beneath each is black, so the label reads more strongly than the number it labels.

- Why it matters: Thirty-seven violations of the one written colour rule the project has, all on the page class Audrey called atrocious. This is also the finding that most depends on her ruling between the system review's light-page options A, B and C, so it should be raised with that decision rather than fixed in isolation.

- Change: Adopt the system review's one-ink rule for the light class without exception: all of these become LIGHT_INK and the semantic meaning moves to an icon, a dot with a written label, or position. Where a semantic colour must survive, put it on a dark chip rather than as light-surface text, which is the treatment the status dot already uses correctly at UsersSection.jsx:763. Colour on this ground is decorative, not informational.

- Evidence: `src/components/AdminTerminal/CompanySection.jsx:250` — `<CountStat label="Active" value={active} color="#15803d" /> <CountStat label="Admins" value={admins} color="#c2410c" />`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:63` — `open: { color: '#b45309', label: 'Open' }, changes_requested: { color: '#9a3412', label: 'Changes requested' }, approved: { color: '#166534', label: 'Approved' `<br>`src/components/AdminTerminal/StorageSection.jsx:677` — `<p className="text-[11px] leading-relaxed mb-2" style={{ color: '#9a3412' }}>`




**AT-07 · HIGH · Typography** — Nine type sizes, an 11px body, and 50 occurrences at 10px or smaller  
law: Cognitive Load

- Problem: The surface uses 9px (7), 10px (43), 11px (108), 12px as `text-[12px]` (2), 12px as `text-xs` (64), 14px (17), 16px and 10px as inline fontSize in Avatar, 18px (1) and 20px (1), plus the shell's 20px title. The de-facto body is 11px, one step below the app-wide 12px and three steps below Notion. Fifty elements render at 10px or below, including every table header, every field label, every status chip and the 9px 'you' badge. There is no perceptual difference between the 11px and 12px runs, which do the same job in the same paragraphs, so two of the nine sizes exist only because two authors typed different things.

- Why it matters: System fix before surface fix: correcting the scale resolves the card-title, panel-title and toolbar hierarchy findings below at the same time. It is also the largest single contributor to the dated look on a page whose longest explanatory paragraphs currently run at 11px.

- Change: Collapse to five steps of the shared scale: 20 page title, 16 section, 14 card title and body, 13 table cell and dense list, 11 label (the floor). `text-[9px]` is deleted outright, `text-[10px]` maps to 11 Label, `text-[11px]` and `text-xs` both map to 13 Dense or 14 Body depending on whether they are in a table. That is roughly 240 class edits and it is the single change that most affects how contemporary this page looks.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:270` — `<span className="text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm" style={{ backgroundColor: '#ea580c', color: '#fff' }}>   you`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:310` — `<span className="block text-[12px] font-bold" style={{ color: '#1c1917' }}>`<br>`src/components/AdminTerminal/StorageSection.jsx:634` — `<span className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>   {m.blurb}`




**AT-08 · HIGH · Typography** — Ninety-one uppercase elements and eighty-six letterspaced ones flatten every role into one object  
law: Von Restorff Effect

- Problem: Across thirteen files there are 91 `uppercase` classes, 67 `tracking-wider` and 19 `tracking-widest`. A nav item, a section title, a card title, a field label, a table header, a button label, a status chip, a group heading and a danger-zone warning are all the same typographic object: 10 or 11px, bold, uppercase, tracked. Nothing can be scanned because nothing differs. In the detail panel this reaches its limit: the panel's own title 'Member detail' and the four group headings inside it are character-for-character the same treatment, so the panel has no top.

- Why it matters: Direct answer to Audrey's brief. When everything is emphasised nothing is, and this surface is the densest concentration of the pattern in the app outside the tools. Pairs with AT-07 as one edit pass.

- Change: Uppercase survives in exactly two roles, the transition Display and the 11px Label. Table headers, field labels and status badges keep it. Section titles, card titles, buttons, tabs, nav items, group headings and the danger-zone heading all go to sentence case at weight 600 with zero tracking. That removes roughly 60 of the 91 uppercase instances and about 55 of the 86 tracking classes.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:413` — `<span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: LIGHT_INK }}>   Member detail`<br>`src/components/AdminTerminal/UsersSection.jsx:771` — `<span className="block text-[10px] font-bold uppercase tracking-widest mb-2 pb-1" style={{ color: LIGHT_INK, borderBottom: '1px solid ${LIGHT_RULE}' }}>`<br>`src/components/AdminTerminal/AdminTerminalPage.jsx:107` — `className="flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-left rounded-sm transition-colors"`




**AT-09 · HIGH · Hierarchy** — The page title is drawn twice, once in white in the bar and once in black 20px below it  
law: Selective Attention

- Problem: App.jsx paints 'ADMIN TERMINAL' at 20px bold uppercase white in the orange bar for this page, and AdminTerminalBody immediately paints 'Admin Terminal' again at 18px bold uppercase tracking-widest in black, with a Terminal icon, as the first thing in the content area. Two page titles, 24px apart, in two colours and two sizes. Together they consume about 56px of the roughly 400px of usable vertical field this page gets, and the section the admin actually selected is named nowhere except an 11px nav chip.

- Why it matters: One dominant element per view is the rule, and this view opens with two identical ones. Deleting the duplicate is a three-line edit that both cleans the hierarchy and buys back vertical space on the page that has least of it.

- Change: Delete the in-body h1 and its icon (AdminTerminalPage.jsx:89-94). Put the selected section's name in its place at the 16px Section step, sentence case, so the content pane finally says which of the seven you are looking at. That recovers about 30px and gives every sub-view the anchor five of them currently lack.

- Evidence: `src/App.jsx:1896` — `<h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>`<br>`src/components/AdminTerminal/AdminTerminalPage.jsx:89` — `<Terminal className="w-6 h-6" style={{ color: '#1c1917' }} /> <h1 className="text-lg font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>   Admin `




**AT-10 · HIGH · Hierarchy** — Five of the seven sections open with no heading at all, and the two that do use different levels  
law: Serial Position Effect

- Problem: Users, Logs and Requests open straight into a toolbar. Company and Diagnostics open straight into a card whose h2 is the first text on screen, so a card title is doing duty as a section title. Only Storage and Models carry a real section heading, and they set it at `text-sm` 14px. The result is that the content pane has no consistent top edge: sometimes a 22px chip row, sometimes a 14px uppercase card title, sometimes a 14px uppercase section title. There is no single place the eye can land on arrival.

- Why it matters: Pairs with AT-09 and costs almost nothing once SectionTitle exists. Without it, replacing the duplicate h1 with a section name has nowhere consistent to live.

- Change: Every section opens with the same SectionTitle block: 16px sentence case at weight 600, an optional 13px description, hairline below. Company and Diagnostics get 'Company' and 'Diagnostics' above their card stacks; Users, Logs and Requests get theirs above the toolbar. The toolbar then reads as a control strip under a title rather than as the page's masthead.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:152` — `{/* Toolbar */} <div className="flex items-center gap-2 mb-4 flex-wrap">`<br>`src/components/AdminTerminal/CompanySection.jsx:166` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">   Company details`<br>`src/components/AdminTerminal/StorageSection.jsx:588` — `<h2 className="text-sm font-bold uppercase tracking-widest mb-1" style={{ color: '#1c1917' }}>   Storage`




**AT-11 · HIGH · Density** — 350px of orange chrome above and below the app's densest admin table  
law: Law of Proximity

- Problem: PAGE_BARS gives admin-terminal the resource-page 200/150 pair. On a 900px viewport, after the 32px TitleBar, the bars resolve to their full 200 and 150, the shell adds `3vh 0` (about 54px), and AdminTerminalBody adds its own `2rem 2rem` (64px vertical). Before a single row renders, 300px of the 868px available has gone to padding and 350px to bars. After the duplicate title block, the roster table and its toolbar share roughly 348px, which is about eight rows. Logs fetches 100 rows into the same box.

- Why it matters: The single highest-impact non-typographic change available here, and it is a one-line edit plus one padding change. The system review recommends 120/80 for resource pages generally; this page is the strongest case for it because it is the only light page that runs two scrolling tables and a 360px side panel at once.

- Change: Move admin-terminal from bars(200,150) to bars(120,80) in pageBars.js, matching the system review's resource-page recommendation, and drop the page's own vertical padding to the 24px gutter token. That returns about 190px, roughly doubling the visible row count on the two table sub-views. The bars stay orange and stay animated; only the resting heights change.

- Evidence: `src/layout/pageBars.js:98` — `'admin-terminal':   bars(200, 150),`<br>`src/components/AdminTerminal/AdminTerminalPage.jsx:88` — `<div className="h-full flex flex-col" style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}>`<br>`src/App.jsx:2092` — `padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',`




**AT-12 · HIGH · Alignment** — The Users toolbar puts three different control heights in one row  
law: Fitts's Law

- Problem: The roster toolbar holds a search input at `py-1.5` with 11px text (about 26px tall), a three-up status filter at `py-1` with 10px text inside a `p-0.5` track (about 22px), and the ADD PEOPLE primary at `py-2.5` with 11px text (about 36px). Three heights, vertically centred, so there is no shared baseline and no shared cap line; the row reads as three unrelated widgets that happen to be on the same line. Logs and Requests each have their own two-height version of the same row.

- Why it matters: Audrey named alignment explicitly. A toolbar with three heights is the most legible alignment failure on the surface and it is the first thing on the default sub-view.

- Change: One Toolbar at 44px with every child at 28px, primary included, per the density tokens. The ADD PEOPLE button loses its extra height and keeps its prominence through fill and position, which is what Fitts's Law actually asks for here: it is already at the far right end of a row the cursor travels along, so size is not what is buying the target.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:160` — `className="flex-1 px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`<br>`src/components/AdminTerminal/UsersSection.jsx:175` — `className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"`<br>`src/components/AdminTerminal/UsersSection.jsx:189` — `className="flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"`




**AT-13 · MEDIUM · Colour** — Card body copy is painted darker than the card title it sits under  
law: Law of Similarity

- Problem: Nine cards across CompanySection, DiagnosticsSection, WorkspaceTakeout and StorageCleanupCard title with `text-stone-900` (#1c1917) and set their description with `text-stone-950` (#0c0a09). The body is darker than the heading, which inverts the emphasis the size difference is trying to establish. It also introduces a fourth spelling of the ink on a page that already writes #1c1917 as a literal (65 times), as LIGHT_INK, and as `text-stone-900`.

- Why it matters: Small, mechanical, and it removes one of four competing spellings of the same black. Worth doing in the same pass as AT-03.

- Change: One ink token for both, hierarchy from size and weight only, exactly as lightSurface.js:27-29 already specifies. Nine two-line edits.

- Evidence: `src/components/AdminTerminal/CompanySection.jsx:166` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">   Company details </h2>`<br>`src/components/AdminTerminal/CompanySection.jsx:169` — `<p className="text-xs text-stone-950 mb-4 leading-relaxed">`<br>`src/components/lightSurface.js:27` — `// Hierarchy on a light surface comes from SIZE and WEIGHT, and emptiness from // italic. Not from a second ink`




**AT-14 · MEDIUM · System** — Card titles are 14px in four files and 11px in one, on the same page  
law: Law of Similarity

- Problem: Company, Diagnostics, Workspace Takeout and Storage Cleanup all title their cards `text-sm font-bold uppercase tracking-widest` (14px, widest tracking). Storage titles its five cards `text-[11px] font-bold uppercase tracking-wider` (11px, one tracking step tighter) and then puts a 14px h2 above them. So the same visual object, a bordered card containing one concern, is announced at two sizes depending on which nav item you clicked. Storage's cards look like sub-items of Company's cards even though they are peers.

- Why it matters: Directly answers 'make sure we have uniform font sizing for body, titles, etc.' with a measured instance inside one page.

- Change: One Card component with one title slot at the 14px H3 step, sentence case, weight 600. Storage keeps its 16px section title above the stack; Company and Diagnostics gain one (AT-10) so the relationship becomes legible rather than implied.

- Evidence: `src/components/AdminTerminal/DiagnosticsSection.jsx:118` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">   Build &amp; environment`<br>`src/components/AdminTerminal/StorageSection.jsx:611` — `<h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: LIGHT_INK }}>   Storage mode`<br>`src/components/AdminTerminal/StorageCleanupCard.jsx:82` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">   Storage cleanup`




**AT-15 · MEDIUM · System** — Loading and empty are rendered by the same component with the same icon  
law: Doherty Threshold

- Problem: LogsSection calls `<EmptyState text="Loading..." />` for the loading state and `<EmptyState text="No events yet." />` for the empty state, in both tables. Same ScrollText icon, same italic mono, same centring. An admin cannot tell a slow query from an empty log. UsersSection has the same problem in a different shape (an italic centred string for loading at line 229, an icon plus italic centred string for empty at 232), and ChangeRequestsSection invents a third treatment (spinner plus non-italic text). Three loading treatments, three empty treatments, one surface.

- Why it matters: The system review names this exact defect app-wide; on this surface it exists in its purest form, as one function called for two opposite meanings.

- Change: Separate EmptyState from Loading. Tables get skeleton rows so the frame and column rhythm are visible while data arrives; everything else gets a spinner. EmptyState keeps the 24px icon, a 14px sentence-case title and a 13px line. Also normalise the ellipsis: 'Loading...' appears in Users and Logs, 'Loading…' in Requests.

- Evidence: `src/components/AdminTerminal/LogsSection.jsx:260` — `if (loading && events.length === 0) return <EmptyState text="Loading..." /> if (events.length === 0) {   return <EmptyState text={allCount === 0 ? 'No events ye`<br>`src/components/AdminTerminal/UsersSection.jsx:228` — `<div className="flex items-center justify-center py-20">   <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>Loading...</span>`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:280` — `<div className="flex items-center gap-2 py-10 justify-center">   <Loader2 className="w-4 h-4 animate-spin" style={{ color: LIGHT_INK }} />`




**AT-16 · MEDIUM · System** — Four modal shells, three z-indices, two backdrops, and a 6px radius nothing else on the page uses  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: UsersSection's ConfirmModal (z 85, rgba(0,0,0,0.6)), MultiInviteDialog (z 80, 0.6), CreateUserDialog (z 80, 0.6) and CredentialsPopup (z 90, 0.65) each hand-roll the same overlay. All four set `borderRadius: '6px'` and `2px solid #ea580c`, while the 123 other rounded elements on the surface are `rounded-sm` at 2px and every other border is 1px. The dialogs' own input fields then use a third radius, `borderRadius: 3`. So one surface carries 2px, 3px and 6px radii and 1px and 2px borders.

- Why it matters: Four copies of one overlay is four places for a future backdrop or escape-handling change to be applied three times. The radius inconsistency also settles a question the system review flagged as taste: this page already ships 6px on its floating surfaces, so the proposed 4px control / 8px floating split is closer to what is here than the documented 2px convention is.

- Change: Promote binUi's Dialog and use it for all four: one backdrop, one 8px floating radius, one 1px hairline, one shadow, header/body/footer contract, the modal stack that already handles topmost-only Escape. Delete the four private shells and the `borderRadius: 3` field style. The 2px signal border on dialogs is the only place `border-2` survives on this surface and it should go with them.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:645` — `backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '20px 22px', width: 'min(400px, 92vw)', color: '#f4a261',`<br>`src/components/AdminTerminal/CredentialsPopup.jsx:93` — `backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '22px 24px', width: 'min(460px, 92vw)', color: '#f4a261',`<br>`src/components/AdminTerminal/CreateUserDialog.jsx:18` — `const fieldStyle = {   width: '100%', padding: '7px 9px', fontSize: 12,   ... border: '1px solid #44403c', borderRadius: 3,`




**AT-17 · MEDIUM · Alignment** — Label and value pairs are set with justify-between, so two ragged edges face each other and no column forms  
law: Law of Proximity

- Problem: The Diagnostics environment block and the detail panel's security rows both put a left-aligned uppercase label and a right-aligned mono value in a `flex justify-between` row. Six rows in Diagnostics, four in the panel. Because the labels vary from 'Role' to 'Supabase host' and the values from '--' to a full UUID, neither side forms a column: the label column is ragged right and the value column is ragged left, and the reader's eye has to re-find the start of every value. The values also break mid-string (`break-all`) against a ragged left edge.

- Why it matters: Direct answer to 'orientation of labels vs values'. Cheap, affects ten rows, and it is the pattern most likely to be copied into the next admin card.

- Change: Replace both with a two-column grid: a fixed label column at the 11px Label step (about 120px in Diagnostics, 96px in the panel), values left-aligned in the second column with tabular-nums where numeric. One Field component, used in both places. This is the same fix the shared kit's Field pattern already specifies and it makes the two blocks the same object.

- Evidence: `src/components/AdminTerminal/DiagnosticsSection.jsx:126` — `<div key={k} className="flex items-baseline justify-between gap-3">   <span className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0" ...>{k}</sp`<br>`src/components/AdminTerminal/UsersSection.jsx:817` — `<div className="flex items-baseline justify-between gap-2 text-xs" style={{ color: '#1c1917' }}>   <span className="text-[10px] font-bold uppercase tracking-wid`




**AT-18 · MEDIUM · Alignment** — No table on the surface declares a column width, and the truncate in the roster is inert  
law: Law of Prägnanz

- Problem: All four tables are `w-full` with `borderCollapse: separate` and auto layout, no colgroup and no width on any cell except one 110px code column in Diagnostics. The member name carries `truncate`, but it sits in a flex row inside a td with no `min-w-0` and no fixed width, so the class never fires and a long display name simply widens the column. In Logs the unbounded Message column is last and uncapped, so one long message forces horizontal scroll on the whole container and pushes Time out of view.

- Why it matters: Column edges that move with the data are the reason a table stops reading as a table. This is the structural half of the alignment brief and it cannot be fixed by spacing alone.

- Change: Give Table a width contract: fixed layout, explicit widths for the short columns (status, role, severity, time, action), the one flexible column last with `min-w-0` on its content wrapper so truncate actually works, and a title attribute carrying the full value. Logs's Message column gets a two-line clamp rather than a truncate, since the message is the reason the row is being read.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:264` — `<div className="flex items-center gap-2">   <Avatar member={m} />   <span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>`<br>`src/components/AdminTerminal/UsersSection.jsx:710` — `function TdLight({ children }) {   return <td className="px-3 py-2 align-middle">{children}</td>`<br>`src/components/AdminTerminal/LogsSection.jsx:331` — `<TdLight>   <span className="text-xs font-mono" style={{ color: '#1c1917' }}>{event.message}</span>`




**AT-19 · MEDIUM · System** — Three copies of ThLight and TdLight, already diverged from the shared token they were meant to share  
law: Law of Similarity

- Problem: UsersSection and LogsSection each define their own ThLight and TdLight, identical to each other and to TeamMembersPage's, except that TeamMembersPage applies `style={LIGHT_TABLE_HEAD_CELL}` while both Admin Terminal copies apply `style={{ color: LIGHT_INK }}` and drop the token's fontWeight 700. UsersSection imports LIGHT_TABLE_HEAD_CELL and then does not use it. lightSurface.js:31-34 exists specifically to stop this, and names the three files by name.

- Why it matters: The drift the token module was written to prevent has already happened, in the two files it names. Fixing it here also fixes Team Members and Dashboard at the same time, so it is cross-surface leverage from a single-surface edit.

- Change: One Th and one Td in the shared kit, both reading from the token. Delete all three local pairs. The Diagnostics error-code table and the ModelsSection row group adopt the same Row so the surface has one row height (36px) and one cell padding (8px 12px) instead of the current `py-2`, `py-1.5` and `px-3 py-2` mix.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:702` — `function ThLight({ children }) {   return (     <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: LIGHT_INK }}>`<br>`src/components/TeamMembers/TeamMembersPage.jsx:921` — `function ThLight({ children }) {   return (     <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={LIGHT_TABLE_HEAD_CELL}`<br>`src/components/lightSurface.js:31` — `// asks for ONE table treatment across Team Members, Users and Logs, and three // local copies is exactly how they drifted apart.)`




**AT-20 · MEDIUM · Density** — The S3 bucket card presents eleven controls at one type size with no internal grouping  
law: Hick's Law

- Problem: In byos plus S3 mode the Bucket card stacks: endpoint, region, bucket, prefix, access key id, a path-style checkbox with a two-sentence explanation, Save bucket, a secret input, Save secret, Remove secret and Test connection. Eleven interactive targets, all at 11px, separated only by `gap-2` and two hairlines, with three co-equal Save-shaped buttons. There is no visual statement that the three blocks are sequential (address the bucket, then authorise it, then prove it), even though the copy at line 508-511 says exactly that.

- Why it matters: The worst decision point on the surface by count, and the only sub-view whose primary action is genuinely ambiguous. Grouping is purely visual and changes no control and no flow.

- Change: Keep every control and every flow. Split the card into three titled blocks at the 14px H3 step: Connection, Credentials, Verify. Give each block one primary at 36px and demote the rest. The sequence is already in the code's own notice strings, so this is making the existing model visible rather than inventing one.

- Evidence: `src/components/AdminTerminal/StorageSection.jsx:1029` — `<div className="flex flex-col gap-2 mb-2">   <label className="flex flex-col gap-1">`<br>`src/components/AdminTerminal/StorageSection.jsx:1119` — `<div className="flex items-center gap-2 flex-wrap">   <input type="password" value={secretDraft}`<br>`src/components/AdminTerminal/StorageSection.jsx:508` — `setNotice(secretHint   ? 'Bucket saved. Test the connection below.'   : 'Bucket saved. Save the access key secret, then test the connection.')`




**AT-21 · MEDIUM · Build** — Focus is removed in one place with no replacement, and absent in a whole dialog  
law: Jakob's Law

- Problem: MultiInviteDialog's per-row role select sets `focus:outline-none` and does not add a ring, so keyboard focus on it is invisible. CreateUserDialog's four fields and one select use an inline fieldStyle with no focus treatment at all, relying on the browser default against a dark panel. Elsewhere the surface uses `focus:ring-2 focus:ring-orange-500` on `focus` rather than `focus-visible`, so a mouse click paints a ring on 17 inputs that nobody asked for.

- Why it matters: Accessibility is specified with the component, not appended. This one is cheap because it lands entirely inside the new Input and Button.

- Change: One focus-visible ring in the shared Input, Select and Button, applied everywhere including the two dialogs. Remove the bare `focus:outline-none`. This is an accessibility fix that is also a visual consistency fix: the ring currently appears on 17 of 24 focusable controls.

- Evidence: `src/components/AdminTerminal/MultiInviteDialog.jsx:214` — `className="px-1.5 py-1 text-[11px] font-mono rounded-sm focus:outline-none cursor-pointer"`<br>`src/components/AdminTerminal/CreateUserDialog.jsx:18` — `const fieldStyle = {   width: '100%', padding: '7px 9px', fontSize: 12,`<br>`src/components/AdminTerminal/StorageSection.jsx:1038` — `className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`




**AT-22 · MEDIUM · Colour** — Four hover fills, three of them near-white, on an orange page  
law: Law of Similarity

- Problem: The surface hovers with `hover:bg-stone-100` (Logs rows), `hover:bg-stone-200` (the panel close button and the copy-id button), `hover:bg-stone-300` (department chip remove) and `hover:bg-stone-800` (the dark menu item). The first three are Tailwind palette values landing on surfaces whose resting state is defined by inline hex, so hover and rest come from two unrelated systems and a token change will not move the hover. All three are also lighter than `#f4a261`, so hovering an element makes it flash white.

- Why it matters: Small individually, but it is four more values on a surface already carrying 50, and the missing roster hover is an affordance gap on the default sub-view.

- Change: One hover fill per surface class, derived from the ink: about an 8% screen on light, about a 6% tint on dark. Applied by the shared Row, Button and IconButton so a hover can no longer be written inline. Also note that the roster table has no row hover at all while Logs does, so the two tables teach opposite things about whether a row is clickable, even though both are.

- Evidence: `src/components/AdminTerminal/LogsSection.jsx:297` — `className="cursor-pointer transition-colors hover:bg-stone-100"`<br>`src/components/AdminTerminal/CompanySection.jsx:275` — `className="p-0.5 rounded-sm hover:bg-stone-300 transition-colors"`<br>`src/components/AdminTerminal/UsersSection.jsx:256` — `className="cursor-pointer transition-colors" style={{   borderBottom: '1px solid ${LIGHT_RULE}',`




**AT-23 · MEDIUM · Flow** — The surface registers document-level Escape in five places and hints at it once, in a tooltip  
law: Paradox of the Active User

- Problem: Escape closes the add menu, the detail panel, ConfirmModal, MultiInviteDialog and CreateUserDialog. The only surfacing of this anywhere is a `title="Close (Esc)"` on the panel's X button, which requires a hover to discover. The bins view solves the same problem with a 34px shortcut bar pinned to the bottom, and Audrey named that bar as the example of what the rest of the app is missing. The Admin Terminal has no equivalent and no footer of any kind.

- Why it matters: This is Audrey's own named uniformity example applied to my surface. It costs one component mount per sub-view once ShortcutBar exists, and it is the most visible signal that the tools and the admin pages belong to one product.

- Change: Mount the shared ShortcutBar at 28px along the bottom of the content pane, showing the keys live for the current sub-view: `Esc` close on the panel and dialogs, `/` focus search on Users, `R` refresh on Logs and Requests. Same Kbd, same grouping, same position as bins, so the two surfaces finally read as one ecosystem. This adds a hint, not a shortcut; no key binding changes.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:416` — `<button type="button" onClick={onClose} className="p-1 rounded-sm hover:bg-stone-200 transition-colors" style={{ color: LIGHT_INK }} title="Close (Esc)">`<br>`src/components/AdminTerminal/UsersSection.jsx:358` — `const onKey = (e) => { if (e.key === 'Escape') onClose() } window.addEventListener('keydown', onKey)`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:843` — `<div className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap"   style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgro`




**AT-24 · MEDIUM · Colour** — Every input on the page sits at 3.38:1, measured and documented, and there are twenty of them  
**constraint: palette-decision** · law: Postel's Law

- Problem: `lightInputStyle` pairs `#fde8d0` text on `rgba(120,70,30,0.55)`, which lightSurface.js:50-59 measures at 3.38:1 and explicitly refuses to export as a token for that reason. It is declared privately in UsersSection, CompanySection, StorageSection and LogsSection anyway, and used by roughly twenty fields including every S3 credential field, the workspace name and the roster search. The token module recorded the problem and deferred it; the deferral has now been copied four times.

- Why it matters: Known, measured, already in OUTSTANDING, and it affects every field an admin types into. It is listed as a palette decision because the correct fix depends on her light-page ruling, not because the measurement is in doubt.

- Change: This is the light-page input decision the system review defers to Audrey. Under its option A the data sub-views move to the dark ground and the well problem disappears; under B the well becomes a real recessed surface on a near-neutral ground; under C it needs a darker ink on a lighter well to reach 4.5:1. Whichever she picks, the four private copies collapse into one Input with one light variant, so the next change is one edit.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:40` — `const lightInputStyle = {   backgroundColor: 'rgba(120, 70, 30, 0.55)',   color: '#fde8d0',`<br>`src/components/lightSurface.js:52` — `// existing input well on light pages (visual-language §Inputs). It was going // to live here, and the contrast test refused it: black on that well measures // `<br>`src/components/AdminTerminal/StorageSection.jsx:62` — `const lightInputStyle = {   backgroundColor: 'rgba(120, 70, 30, 0.55)',`




**AT-25 · MEDIUM · Motion** — The one animation on the surface is transition-all, has no exit, and ignores the app's own reduced-motion helper  
**constraint: touches-transition** · law: Doherty Threshold

- Problem: The member detail panel animates in with `transition-all duration-200` plus a 24px translate, driven by rAF. `transition-all` animates the border and width along with the transform, so the hairline separating the panel from the table draws itself in. There is no exit animation, because the panel unmounts the instant `selectedId` clears, so clicking a second member produces an asymmetric snap-out then slide-in. And it does not consult `prefersReducedMotion()`, which AuthShell already exports and which the visual-language document treats as the house contract.

- Why it matters: Only real motion on the surface, so the fix is contained. The reduced-motion gap matters because this page is admin-only and long-dwell, which is exactly where vestibular triggers are least acceptable.

- Change: Name the properties (`transition: opacity 160ms ease-out, transform 160ms ease-out`), keep the panel mounted for a 120ms fade-out before unmount so entry and exit are symmetric, and gate both on prefersReducedMotion, delivering the end state instantly when it is set. Durations stay inside the interactive band.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:404` — `className="flex-shrink-0 ml-4 pl-4 overflow-y-auto wilson-light-scroll transition-all duration-200" style={{   width: '360px',`<br>`src/components/AdminTerminal/UsersSection.jsx:350` — `const id = requestAnimationFrame(() => setEntered(true))`




**AT-26 · MEDIUM · System** — Success and notice states exist in five shapes with two different greens  
law: Law of Similarity

- Problem: Requests uses `rgba(22,101,52,0.10)` with `#166534` text, a Check icon and a dismiss. Storage uses bare `#166534` text with CheckCircle2 and no ground. Workspace Takeout and Storage Cleanup use `rgba(21,128,61,0.1)` with `#15803d` and a Check. Diagnostics uses bare `#15803d` text with no icon. Two greens (both failing contrast per AT-06), two grounds, three icon choices, one dismiss. The same event, a thing succeeded, is announced five ways within one nav column.

- Why it matters: Pairs with AT-05 as one Banner component covering both variants. Five call sites, all mechanical.

- Change: One Banner variant success, one ground, one icon, one ink, optional dismiss, used in all five places. The system review's single-toast-anchor recommendation does not apply here because these are all inline confirmations attached to the control that fired them, which is correct and should stay inline.

- Evidence: `src/components/AdminTerminal/ChangeRequestsSection.jsx:265` — `<div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(22,101,52,0.10)' }}>`<br>`src/components/AdminTerminal/StorageSection.jsx:1179` — `<div className="flex items-center gap-1.5 text-[11px] font-mono mb-2" style={{ color: '#166534' }}>`<br>`src/components/AdminTerminal/WorkspaceTakeout.jsx:178` — `<div className="mb-3 flex items-start gap-2 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(21, 128, 61, 0.1)', color: '#15803d' }}>`




**AT-27 · MEDIUM · Alignment** — The Models row wraps under pressure and drops its Reset control below the select  
law: Law of Common Region

- Problem: Each of the 28 model rows is `flex items-center gap-2 flex-wrap` holding a text block with `minWidth: 200px`, a select with `minWidth: 190px` and a conditional Reset link. At the content widths this page actually gets, once the detail-panel-free pane narrows or the label is long, the row wraps and Reset lands on a second line under the select, breaking the column of selects that the eye is scanning down. The select also has no height, no background and a `#d6d3d1` border, so it renders as an OS-default control with a near-white outline, unlike every other select on the surface which carries `lightSelectStyle`.

- Why it matters: 28 rows is the longest repeated unit on the surface, so a row that reflows costs more here than anywhere else. The reserved-slot fix is the same HoverActions pattern the shared kit needs anyway.

- Change: Fix the row at 36px with a three-column grid: flexible label, 190px select, 28px reserved Reset slot that is always present and only becomes visible on override or hover. That preserves the Von Restorff intent the file's header describes (an overridden row is the only one carrying an accent) while stopping the row from reflowing. Give the select the shared Select styling.

- Evidence: `src/components/AdminTerminal/ModelsSection.jsx:170` — `<div className="flex items-center gap-2 flex-wrap">   <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>`<br>`src/components/AdminTerminal/ModelsSection.jsx:185` — `className="px-2 py-1 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40" style={{ border: '1px solid #d6d3d1', col`<br>`src/components/AdminTerminal/ModelsSection.jsx:199` — `{chosen && (   <button type="button" onClick={() => apply(entry.key, '')}`




**AT-28 · MEDIUM · System** — The primary action exists in five paddings and the one green button is the only primary in its view  
law: Von Restorff Effect

- Problem: The orange primary appears as `px-5 py-2.5` with a `1px #c2410c` border and `#fff7ed` text (Add people), `px-4 py-2.5` with the same border (Copy both), and `px-3 py-1.5` with no border and `#fff` text in three dialogs. Requests then makes its primary green (`#166534`) at `text-[10px]`, so on that sub-view the signal colour marks the secondary action and green marks the primary. Cancel exists in three treatments across the surface: a bare ink link in Storage, a brown-well fill in Requests, a transparent-with-stone-border in the dialogs.

- Why it matters: Follows AT-02 mechanically once Button exists. The green primary is the one judgement call in it and it is worth making explicitly: one signal colour per app is the rule the system review sets, and this is the only place on the surface that breaks it.

- Change: Button with four variants and two sizes. Primary is the signal colour, one padding pair per size, sentence case, weight 600, no border. 'Archive, then apply' becomes the signal primary and the green retires; the action being destructive-adjacent is communicated by the confirm step it already has, not by hue. Cancel becomes the ghost variant everywhere.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:190` — `style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:415` — `className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" style={{ backgroundColor: '#1665`<br>`src/components/AdminTerminal/StorageSection.jsx:949` — `className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm" style={{ color: LIGHT_INK }}> Cancel`




**AT-29 · MEDIUM · Density** — Three gutters stack between the window edge and the first pixel of content  
**constraint: touches-home** · law: Law of Uniform Connectedness

- Problem: The shell sets the top bar's title at `px-6` (24px), the nav strip's right edge at `paddingRight: 48px`, and the content wrapper at `3vh 0` vertically with no horizontal padding. AdminTerminalBody then applies its own `padding: '2rem 2rem'` (32px). So the page title sits 24px from the left, the nav strip items 48px from the right, and the console content 32px from both, and none of the three edges line up. The nav strip is the menu that opens this page, and it does not align with the page it opens.

- Why it matters: Structural whitespace means consistent gutters, and this page has three. The fix is shared with every other light page, so it belongs to the shell session rather than to this surface, but the evidence lives here.

- Change: One 24px page gutter used by the bar, the strip and the content area, per the spacing scale. Remove the page's own padding entirely and let the shell own it. The `maxWidth: 1240px` centring stays, since it already matches the system review's proposed data-page cap and is the only page in the app that gets it right.

- Evidence: `src/components/AdminTerminal/AdminTerminalPage.jsx:88` — `style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}`<br>`src/App.jsx:1894` — `<div className="flex items-center justify-between w-full px-6" style={{ paddingBottom: '12px' }}>`<br>`src/App.jsx:1952` — `paddingRight: '48px',`




**AT-30 · LOW · System** — Log severity is communicated by colour alone  
law: Law of Similarity

- Problem: The Sev column renders a bare 8px dot whose only label is a `title` attribute. Four severities are distinguished by hue (a 45% ink tint, amber, red, dark brown), three of which fail contrast on this ground per AT-06, and two of which (error #dc2626 and critical #7c2d12) are hard to tell apart at 8px. The column header is also the surface's only abbreviation, 'Sev', which the 11px Label step does not need.

- Why it matters: The surface already contains the correct pattern two files away, so this is adopting an existing local solution rather than inventing one.

- Change: Keep the dot and add the word beside it, as StatusDot already does correctly in the roster at UsersSection.jsx:760-766. Header becomes 'Severity'. If the column is too narrow for both, the dot becomes a 11px Label badge carrying the word and the colour becomes a ground rather than the sole signal.

- Evidence: `src/components/AdminTerminal/LogsSection.jsx:305` — `<span   className="inline-block w-2 h-2 rounded-full"   style={{ backgroundColor: SEVERITY_DOT[event.severity] || 'rgba(28, 25, 23, 0.45)' }}`<br>`src/components/AdminTerminal/UsersSection.jsx:762` — `<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? '#22c55e' : '#ef4444' }} /> <span className="text-xs font-mono" style={{`




**AT-31 · LOW · Density** — Two card-stack rhythms on one page  
law: Law of Proximity

- Problem: Company and Diagnostics space their cards with `space-y-6` (24px) at `maxWidth: 640px`. Storage spaces its with `mb-3` (12px) at `maxWidth: 720px`. Models runs at `maxWidth: 900px` with `mb-4` between groups. Three measures and three gaps for the same kind of stacked content, so moving between nav items changes the page's rhythm and its column width.

- Why it matters: Low severity on its own, but it is the reason the console feels like seven pages rather than one bench, and it costs three edits.

- Change: One measure for form and reading sub-views (720px per the system review) and one gap from the spacing scale (24px between cards, 12px within). Models keeps a wider measure only because its rows are three-column; cap it at the 1240px data width rather than an arbitrary 900.

- Evidence: `src/components/AdminTerminal/CompanySection.jsx:163` — `<div className="space-y-6 pb-8" style={{ maxWidth: '640px' }}>`<br>`src/components/AdminTerminal/StorageSection.jsx:587` — `<div style={{ maxWidth: '720px' }}>`<br>`src/components/AdminTerminal/ModelsSection.jsx:108` — `<div className="pb-8 overflow-y-auto wilson-light-scroll h-full" style={{ maxWidth: '900px' }}>`




**AT-32 · LOW · Typography** — The same size is spelled two ways and the same wait is spelled two ways  
law: Law of Similarity

- Problem: 12px is written as `text-xs` 64 times and as `text-[12px]` twice, both in ChangeRequestsSection, where they sit in the same list item as the 11px text. 'Loading' appears as 'Loading...' in Users and Logs and as 'Loading…' in Requests; 'Saving' appears as 'Saving…' throughout but 'Working…' in ConfirmModal. Small, but it is the tell that no two sections were written against the same reference.

- Why it matters: Free once the scale pass is running. Worth listing so the rework session does not leave the two stragglers behind.

- Change: Falls out of AT-07 for the sizes. For the copy, one wait string ('Loading…') and one busy verb per action, set in the Button's busy slot so it cannot be retyped.

- Evidence: `src/components/AdminTerminal/ChangeRequestsSection.jsx:331` — `<p className="text-[12px] whitespace-pre-wrap mb-3" style={{ color: '#1c1917' }}>`<br>`src/components/AdminTerminal/ChangeRequestsSection.jsx:282` — `<span className="text-[11px] font-mono" style={{ color: LIGHT_INK }}>Loading…</span>`<br>`src/components/AdminTerminal/UsersSection.jsx:229` — `<span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>Loading...</span>`




**AT-33 · LOW · Flow** — The nav is at seven items by its own admission and the next section has nowhere to go  
_taste, not error_ · law: Miller's Law

- Problem: NAV holds Users, Company, Models, Storage, Requests, Logs, Diagnostics. The file's comment says Session 34 took it to the 7 plus or minus 2 limit and that the next section must argue for merging rather than appending. Three of the seven (Company, Models, Storage) are company configuration, and Requests sits beside them for the same stated reason, which means four of seven items are one concept.

- Why it matters: Cheap, visual only, and it is the grouping the file's own comments already describe in prose.

- Change: Not a change now, a rule for the rework: the nav gets one hairline group separator after Users and one before Logs, splitting it visually into People / Configuration / Operations without moving or renaming a single item. That is purely visual, keeps all seven reachable at one click, and gives the eighth section a home when it arrives. Flagged as taste: the current flat list is defensible.

- Evidence: `src/components/AdminTerminal/AdminTerminalPage.jsx:51` — `const NAV = [   { key: 'users', label: 'Users', icon: Users },   { key: 'company', label: 'Company', icon: Building2 },`<br>`src/components/AdminTerminal/AdminTerminalPage.jsx:46` — `// Session 34 adds the seventh — AT the 7±2 limit now; the next section must // argue for merging, not appending.`




**AT-34 · LOW · Build** — No dialog on the surface traps focus  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: All four modals set `role="dialog" aria-modal="true"` and handle Escape, but none constrains Tab. From an open ConfirmModal, Tab walks straight into the roster table behind the backdrop, which is still interactive. Only CreateUserDialog sets initial focus, and it does so on a 50ms timer.

- Why it matters: Accessibility specified with the component. Lands inside the Dialog promotion in AT-16, so it is nearly free there and expensive separately.

- Change: binUi's Dialog already owns the modal stack and topmost-only Escape; add focus containment and initial focus to it once, and all four inherit it. No interaction changes for a mouse user.

- Evidence: `src/components/AdminTerminal/UsersSection.jsx:638` — `role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center"`<br>`src/components/AdminTerminal/CreateUserDialog.jsx:43` — `const t = setTimeout(() => usernameRef.current?.focus(), 50)`





## Uniformity gaps

- **Secondary button** — here: Four private `darkBtnClass`/`darkBtnStyle` pairs at CompanySection.jsx:32, StorageSection.jsx:67, DiagnosticsSection.jsx:28, StorageCleanupCard.jsx:36, plus five hand-written copies at ChangeRequestsSection.jsx:248, LogsSection.jsx:219, ModelsSection.jsx:122, UsersSection.jsx:530, WorkspaceTakeout.jsx:193. Two already differ on the flex wrapper and three on the gap. — elsewhere: The rest of the app has the same problem at larger scale; binUi's Btn in R.A.B.B.I.T. is the closest thing to a real Button component and is the obvious promotion candidate. — do: One Button, variants primary / secondary / ghost / danger, sizes sm 28px and md 36px. Delete all nine local spellings.

- **Table header cell** — here: ThLight/TdLight defined locally in UsersSection.jsx:702-711 and LogsSection.jsx:421-430, both dropping the shared LIGHT_TABLE_HEAD_CELL token in favour of `{ color: LIGHT_INK }`; UsersSection imports the token and never uses it. — elsewhere: TeamMembersPage.jsx:921 keeps the token; Dashboard and the operator console carry two more copies. Five copies app-wide, already diverged on weight. — do: One Th and one Td in the shared kit reading from the token, adopted by Users, Logs, Diagnostics and Models so this page has one row height and one cell padding.

- **Table frame and row divider** — here: Users frames with LIGHT_RULE (UsersSection.jsx:239); Logs, Diagnostics and Models frame with `#d6d3d1` and divide with `#e7e5e4` (LogsSection.jsx:265/298, DiagnosticsSection.jsx:177/181, ModelsSection.jsx:152/166), both of which lightSurface.js:17 measures as lighter than the page. — elsewhere: The near-white card on the orange page is the exact defect Audrey rejected on the Rate Card. — do: One hairline token for all frames and dividers on light surfaces. Ten one-line edits on this surface.

- **Keyboard shortcut hints** — here: Escape is registered at UsersSection.jsx:115, :358, :619, MultiInviteDialog.jsx:65 and CreateUserDialog.jsx:49, and surfaced only as a `title` attribute at UsersSection.jsx:416. — elsewhere: BinsView.jsx:843-848 pins a 34px bar of Kbd chips along the bottom. Audrey named this as the canonical inconsistency. — do: Mount the shared ShortcutBar at 28px on every Admin Terminal sub-view, using the same Kbd. Hints only, no key bindings change.

- **Card title** — here: 14px uppercase tracking-widest in CompanySection.jsx:166, DiagnosticsSection.jsx:118, WorkspaceTakeout.jsx:157, StorageCleanupCard.jsx:82; 11px uppercase tracking-wider in StorageSection.jsx:611 and four siblings. — elsewhere: Settings and Help both use the 14px form, so Storage is the outlier app-wide as well as on this page. — do: One Card with one title slot at the 14px H3 step, sentence case, weight 600.

- **Modal shell** — here: Four hand-rolled overlays at UsersSection.jsx:637, MultiInviteDialog.jsx:155, CreateUserDialog.jsx:86, CredentialsPopup.jsx:86. Three z-indices (80, 85, 90), two backdrops (0.6, 0.65), all four at a 6px radius that nothing else on the surface uses. — elsewhere: 66 hand-rolled overlays app-wide across 36 files with 22 backdrop values, per the system review. — do: Promote binUi's Dialog with its modal stack and topmost-only Escape; the four dialog headers here are already identical and become its header slot verbatim.

- **Error and success banner** — here: Seven error implementations (two inks, two alphas, three icon choices, one dismiss) and five success implementations (two greens, two grounds, three icon choices). Sample sites: UsersSection.jsx:215, ChangeRequestsSection.jsx:257, StorageSection.jsx:1172, WorkspaceTakeout.jsx:172, StorageCleanupCard.jsx:98. — elsewhere: Four toast systems in four screen positions app-wide. These are inline rather than toasts and should stay inline. — do: One Banner with variants danger / warning / success, one ink per variant meeting 4.5:1 on its ground, one icon, optional dismiss.

- **Loading versus empty** — here: LogsSection.jsx:260 and :366 call the same EmptyState component with the text 'Loading...'; Users uses a bare italic string; Requests uses a spinner and a different ellipsis. — elsewhere: The same collapse appears across the app; the system review calls it out by name. — do: Separate Loading (table skeleton rows, spinner elsewhere) from EmptyState (24px icon, 14px title, 13px body, action slot).

- **Input well** — here: `lightInputStyle` declared privately four times (UsersSection.jsx:40, CompanySection.jsx:23, StorageSection.jsx:62, LogsSection.jsx:35 as lightSelectStyle) at a measured 3.38:1, which lightSurface.js:50-59 refused to export for exactly that reason. — elsewhere: Every light page in the app carries a copy. Recorded in docs/OUTSTANDING.md and never resolved. — do: One Input/Select/TextArea with one light variant, resolved against Audrey's light-page ruling. Keep binUi's Escape-reverts-the-edit behaviour.

- **Hover fill** — here: stone-100 (LogsSection.jsx:297), stone-200 (UsersSection.jsx:416, CompanySection.jsx:224), stone-300 (CompanySection.jsx:275), stone-800 (UsersSection.jsx:694); the roster table has no row hover at all while Logs does. — elsewhere: Tailwind-palette hovers on inline-hex surfaces recur across the light pages. — do: One hover screen per surface class, owned by Row / Button / IconButton, so a hover can never be written inline again.


## Alignment issues

- Users toolbar, three controls in one row (`src/components/AdminTerminal/UsersSection.jsx:152`): Search input about 26px, status chips about 22px, ADD PEOPLE about 36px. Three heights, centred, no shared baseline or cap line. → Toolbar at 44px, every child at 28px, primary included. Prominence comes from fill and end position, not height.

- Logs toolbar and Requests toolbar (`src/components/AdminTerminal/LogsSection.jsx:175`): Chips at about 22px sit beside selects and a refresh button at about 28px, so the chip group floats inside the row. → Same 28px child height across the Toolbar; the chip track's `p-0.5` becomes part of the 28px rather than added to a 22px chip.

- Label and value rows in Diagnostics and the member panel (`src/components/AdminTerminal/DiagnosticsSection.jsx:126`): `justify-between` puts a ragged-right label column against a ragged-left value column, so no vertical edge forms in either. Values additionally `break-all`. → Two-column grid, fixed label column (about 120px in Diagnostics, 96px in the panel), values left-aligned, tabular-nums where numeric.

- Member name cell in the roster (`src/components/AdminTerminal/UsersSection.jsx:264`): `truncate` sits on a span inside a flex row with no `min-w-0`, inside a td with no width, in an auto-layout table. The class never fires and long names widen the column. → Fixed table layout with declared widths, `min-w-0` on the flex wrapper, title attribute carrying the full name.

- Logs Message column (`src/components/AdminTerminal/LogsSection.jsx:331`): Last column, unbounded, no wrap or clamp; one long message forces horizontal scroll on the whole container and pushes Time out of view. → Two-line clamp on the message, fixed widths on Time, Sev, Type, Code and Actor.

- Models row (`src/components/AdminTerminal/ModelsSection.jsx:170`): `flex-wrap` with a 200px minimum label block and a 190px select drops the Reset control onto a second line, breaking the column of 28 selects. → Three-column grid at a fixed 36px row height with a reserved 28px Reset slot, revealed on override and on hover.

- Members summary stat row (`src/components/AdminTerminal/CompanySection.jsx:248`): Three CountStats in a `gap-6` flex with no fixed widths, so the label positions shift as the digit counts change. → Fixed-width stat cells; number and label share one left edge that does not move.

- Page gutters (`src/components/AdminTerminal/AdminTerminalPage.jsx:88`): The page's own 32px gutter sits inside a shell whose title bar uses 24px and whose nav strip uses 48px. Three left or right edges, none aligned. → One 24px page gutter owned by the shell; the page sets no padding of its own. Keep the 1240px centred cap.

- Nav label indentation (`src/components/AdminTerminal/AdminTerminalPage.jsx:107`): A 3px left border plus `px-3` puts the nav icon 15px from the nav's left edge while the section content starts at 0 of the content pane, so nothing in the nav aligns with anything in the pane. → Keep the 3px indicator, move the padding so the icon's left edge lands on the page gutter and the label lands on a consistent text column.

- S3 field labels (`src/components/AdminTerminal/StorageSection.jsx:1032`): One span carries an uppercase bold label and a `font-normal normal-case` parenthetical, so a single line holds two cases and two weights; the 4px within-field gap against an 8px between-field gap is only a 2:1 proximity ratio, too weak to group. → Label at the 11px Label step, hint on its own line at the 12px Caption step, 4px within field and 16px between fields, matching AuthShell's measured ratio.


## Hick's Law hotspots

- StorageSection, byos + S3 mode, the Bucket card (StorageSection.jsx:979-1170): 11 visible choices → Split into three titled blocks at the 14px H3 step, Connection / Credentials / Verify, each with exactly one 36px primary and the rest demoted to secondary. The sequence is already stated in the code's own notice strings at line 508. No control is removed, hidden or moved between blocks; this makes the existing three-step model visible.

- StorageSection, whole section in byos + S3 (mode picker 2 + provider picker 2 + 11 bucket controls + Retry): 16 visible choices → Collapse the two already-chosen pickers to a single 28px summary row with a Change affordance once a provider is saved, expanding back to the two-card form on click. Both options stay one click away; the card that is done stops competing with the card that is not.

- UsersSection, detail panel for one member (UsersSection.jsx:402-557): 8 visible choices → Role select, two grants, reset password, deactivate, close, plus two hidden behind grants. Keep all eight and let the type scale do the work: group headings move to 14 H3 so Identity / Access / Security / Danger read as four blocks rather than four identical 10px labels. Danger zone keeps its separation but loses its red heading in favour of the standard section heading plus a danger-variant button.

- UsersSection toolbar (search, 3 status filters, ADD PEOPLE with a 2-item menu): 7 visible choices → Already well chunked; the two-item add menu is the right call. Only change is height alignment (AT-12). Add `/` as a search-focus hint in the ShortcutBar so the most-used control has a keyboard path.

- AdminTerminalPage left nav (AdminTerminalPage.jsx:51-59): 7 visible choices → At the 7 plus or minus 2 limit by the file's own note. Add one hairline separator after Users and one before Logs, splitting People / Configuration / Operations visually. All seven stay one click away; the eighth section gets a home. Taste rather than error.

- ModelsSection, 28 rows each with a full approved-model select plus Reset: 28 visible choices → Chunking by tool is already correct and should stay. Add a single 28px filter chip pair above the list, All / Overridden, so the five deliberate choices can be isolated from the twenty-three defaults without scrolling 28 rows. Both states show the same rows, so nothing becomes unreachable.

- LogsSection toolbar (2 tabs, a 7-option type select, a 4-option severity select, Refresh): 4 visible choices → Well within budget. Only fix the two control heights and give the selects the shared Select styling.

- DiagnosticsSection, five cards with five action buttons and a 280px scrolling code table: 6 visible choices → Two of the five cards are reference, three are actions. Order the stack actions-first (Copy diagnostics, Send test event, Send Sentry test, Storage cleanup) with the error-code reference table last, since it is looked up rather than acted on. Serial Position: the thing an admin came for should not be third.


## Type inventory

| px | Spelling | Count | Role today | Should become |
|---|---|---|---|---|
| 9 | `text-[9px]` | 7 | 'you' badge, rate-access chips, MFA chip, activity action chip | **Deleted.** All become the 11px Label |
| 10 | `text-[10px]` | 43 | table headers, field labels, group headings, panel title, hints, some button labels, danger-zone heading | Split: table headers and field labels to 11 Label; hints to 12 Caption; button labels to 14 Body; panel and group headings to 14 H3 |
| 10 | inline `fontSize: 10` | 1 | small avatar initial | 11 Label |
| 11 | `text-[11px]` | 108 | de-facto body: card blurbs, warning copy, most buttons, nav items, model rows, notices | Body 14 for prose, Dense 13 in tables and rows, 14 for buttons |
| 12 | `text-xs` | 64 | second body: table cells, card descriptions, toggle labels, error banners, code chips | Dense 13 in tables, Body 14 in prose |
| 12 | `text-[12px]` | 2 | request title and summary in ChangeRequestsSection only | 14 H3 and 14 Body |
| 12 | inline `fontSize: 12` | 1 | CreateUserDialog field text | Body 14 |
| 14 | `text-sm` | 17 | card titles in four files, all four dialog titles, detail-panel name | 16 H2 for dialog titles, 14 H3 for card titles and the panel name |
| 16 | inline `fontSize: 16` | 1 | 40px avatar initial | unchanged, it is a glyph not text |
| 18 | `text-lg` | 1 | the duplicate in-body page title | **Deleted** with the title (AT-09) |
| 20 | `text-xl` | 1 | CountStat number | 20 H1, the only display figure on the surface |
| 20 | `text-[20px]` (shell) | 1 | ADMIN TERMINAL in the orange bar | 20 H1, sentence case |

**Weights:** effectively one, 700 (`font-bold` on every label, button, heading and chip; `fontWeight: 700` in the unused table token). 400 appears only as the default on body paragraphs and one `font-normal` override inside an uppercase span. There is no 600 anywhere, so the scale's emphatic step does not exist and 700 is carrying every level. Target: 400 and 600 only.

**Case:** 91 `uppercase`, applied to nav items, section titles, card titles, field labels, table headers, buttons, chips, status pills, group headings and the danger-zone heading. Target: 2 roles (Display, Label), about 31 survivors.

**Tracking:** 67 `tracking-wider`, 19 `tracking-widest`, both applied to the same kinds of element in different files (card titles are widest in four files and wider in one). Target: `+0.06em` on the 11px Label only, `+0.01em` on H1, zero elsewhere.

**Mono:** 109 `font-mono` across 12 files (StorageSection and UsersSection 24 each, LogsSection 15). Under the mono-keeps-one-job rule, about 18 survive: workspace ID, slug, error codes, entity ids, paths, bucket and prefix, byte figures, round-trip milliseconds, the credential rows and the JSON context block. ModelsSection already uses zero and is the most readable section here, which is the local proof the rule works.


## Priority order

AT-01 — fix the black-on-black menu hints. One file, two lines, a genuine defect, and the only finding here that is invisible content rather than ugly content., AT-02 — one Button, delete four constant pairs and nine hand-written copies. Largest single reduction in divergence sites on the surface and it is mechanical., AT-03 — stop importing tokens and then bypassing them; add the lint gate. Without this the rework drifts again in two sessions, so it must land before the cosmetic passes, not after., AT-04 — replace the five #d6d3d1 frames and five #e7e5e4 dividers with the hairline token. Ten one-line edits and it is the most visible thing Audrey will notice., AT-11 — drop admin-terminal from bars(200,150) to bars(120,80) and remove the page's own 2rem padding. One line plus one, returns about 190px to the densest page in the console., AT-07 + AT-08 — the type pass. Nine sizes to five, 91 uppercase to about 31, one weight to two. Roughly 240 edits, and it resolves AT-14, AT-22's hierarchy half and AT-32 on the way through., AT-09 + AT-10 — delete the duplicate page title, give all seven sections one SectionTitle. Cheap once the scale exists and it fixes the surface's missing top edge., AT-05 + AT-26 — one Banner covering danger and success. Eleven call sites collapse to one component and error text goes from 2.1:1 to legible., AT-19 — one Th/Td/Row in the shared kit. Fixes this surface, Team Members and Dashboard from one edit., AT-12 + AT-17 + AT-18 — the alignment pass: one toolbar height, label-value grids, table column widths. This is the half of Audrey's brief that spacing alone cannot deliver., AT-16 + AT-34 — promote binUi's Dialog, gaining focus containment for free. Four shells become one., AT-15 — separate Loading from EmptyState, with table skeletons. Small, and it removes a genuine ambiguity in Logs., AT-06 + AT-24 — the light-page colour and input-well decisions. Ranked here rather than higher because both wait on Audrey's ruling between options A, B and C; the measurements are settled, the direction is not., AT-20 + AT-27 — regroup the S3 card into three blocks; fix the Models row to a grid. The two worst Hick's hotspots, both purely visual., AT-21 + AT-22 + AT-25 — focus-visible everywhere, one hover screen per surface, named-property motion with a reduced-motion gate and a symmetric exit., AT-23 — mount the ShortcutBar. Depends on the shared component existing; it is the clearest single signal that the admin pages and the tools are one product., AT-28 + AT-30 + AT-31 + AT-33 — one primary treatment and the green retirement, a labelled severity, one card rhythm, and the nav's two hairline separators. Cleanup, last.


## Rework scope (reviewer's estimate)

Files: `src/components/AdminTerminal/StorageSection.jsx (1185)`, `src/components/AdminTerminal/UsersSection.jsx (822)`, `src/components/AdminTerminal/ChangeRequestsSection.jsx (497)`, `src/components/AdminTerminal/LogsSection.jsx (430)`, `src/components/AdminTerminal/CompanySection.jsx (325)`, `src/components/AdminTerminal/MultiInviteDialog.jsx (303)`, `src/components/AdminTerminal/CreateUserDialog.jsx (235)`, `src/components/AdminTerminal/DiagnosticsSection.jsx (233)`, `src/components/AdminTerminal/ModelsSection.jsx (223)`, `src/components/AdminTerminal/WorkspaceTakeout.jsx (203)`, `src/components/AdminTerminal/CredentialsPopup.jsx (182)`, `src/components/AdminTerminal/AdminTerminalPage.jsx (149)`, `src/components/AdminTerminal/StorageCleanupCard.jsx (146)`, `src/components/lightSurface.js (86, shared — extend, do not fork)`, `src/layout/pageBars.js (one line, line 98)`, `src/App.jsx (lines 1892-1900 and 2092, shared with every light page — belongs to the shell session)`  
Approx lines: 1450  
Suggested sessions: 3  
Split: Session A — SYSTEM, about 500 lines touched, no visual redesign: adopt Button, Th/Td/Row, Banner, EmptyState/Loading, Dialog, Input/Select, Menu from the shared kit; delete the four darkBtnClass pairs, the two ThLight/TdLight pairs, the four modal shells, the seven error and five success banners; replace every #d6d3d1 / #e7e5e4 / literal rgba with its token; add the unused-import lint gate. Fix AT-01 first, in its own commit, because it is a defect rather than a refactor. Ends with the surface looking almost identical and carrying half the divergence. Session B — TYPE AND COLOUR, about 650 lines: apply the eight-step scale (nine sizes to five), sentence case everywhere except the 11px Label, 700 to 600, retire mono from all but the roughly 18 numeric and identifier sites, collapse the 50 colour values, and resolve the semantic inks and the input well against Audrey's light-page ruling. This is the session that changes how the page looks and it must not start before A lands, or the same edits get made in nine places. Session C — LAYOUT, DENSITY AND MOTION, about 300 lines: delete the duplicate h1, add SectionTitle to all seven sections, one 44px toolbar with 28px children, label-value grids, fixed table column widths, the S3 three-block regroup, the Models grid row, the Models filter chips, the Diagnostics card reorder, the nav separators, the ShortcutBar mount, and the panel's named-property motion with a reduced-motion gate and a symmetric exit. Take the pageBars.js line here only if the shell session has not already claimed it. If only two sessions are available, merge A and C and run B alone, since B is the one that must not be interleaved.  
Risks: 1. StorageSection is 1,185 lines with eleven conditional visual branches (byos+network, byos+s3, central ready/loading/error/suspended/atCeiling, loadError, confirmStep 1 and 2, secretStatusError, cryptoMissing, connectionEdited, root_path-present, s3FileCount null/0/n). Most of them need a real workspace_storage row to reach, so they cannot be eyeballed in a dev build. Enumerate the branches from the source and drive each one by hand before declaring the section done; the inline styles mean a missed branch ships an unstyled state that nobody sees until a customer is in it. 2. TWO test files grep the SOURCE TEXT of StorageSection.jsx and AdminTerminalPage.jsx: src/lib/workspaceRootWiring.test.js:26-27, :98-106 (including `expect(adminTerminalPage).toContain('<StorageSection')`) and :134-140, and src/tools/rabbit_v0.1.0/storage/storagePresignBoundary.test.js:271, :290, :297. None of them pins a class name, so restyling is safe, but extracting JSX out of those two files, renaming them, or wrapping <StorageSection /> in anything will break the suite. Also note workspaceRootWiring.test.js:140 is a `not.toContain` on a bare function name, which is the house's 0038 trap: a comment mentioning that name fails the test. 3. Four sections lazy-fetch on first activation behind `loadedRef` (CompanySection.jsx:62, StorageSection.jsx:160, ChangeRequestsSection.jsx:89, LogsSection.jsx:84/118, ModelsSection.jsx:63). Any restructure that changes a component's identity or key remounts it, resets the ref and refires RPCs on every section hop, including a workspace_directory call. Verify with the network panel after the layout pass. 4. UsersSection's ConfirmModal, CredentialsPopup, CreateUserDialog and MultiInviteDialog are DARK panels living inside light-page files. lightSurface.js:22-25 warns about exactly this and AT-01 proves the warning was already ignored once. Classify every element by the surface it renders on, not the file it is in; a blanket light-page sweep will destroy all four. 5. CredentialsPopup is show-once: the password exists only in props while it is open and there is no way to reopen it to check a style. Test it with a throwaway user before it matters. 6. AT-01 means two hint strings have never been visible to any human; making them legible surfaces copy that has never been reviewed, so read it before shipping. 7. The bar-height change (pageBars.js:98) and the gutter change (App.jsx) are shared with Settings, Projects, Rate Card, Team Members, Dashboard and Files. They must be made once by the shell session, not by this one, or six pages get three different answers.
