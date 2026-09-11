# WILSON UI overhaul — design review, 2026-09-11


Generated from the review workflow (one Opus 5 system review, twelve Opus 5 per-surface reviews, one Opus 5 constraint critic; 14 agents, 65 minutes, 3.8M tokens) run read-only against `feat/ui-overhaul` at `e5afaea`. Code-based: every finding cites file and line. Constraints in force: no interaction or view changes; the page transition stays; Home is fonts only; D.O.G. LayoutVisualizer and VideoThumbnail untouched; pets untouched; white or black only on orange.

Companion: `UI_OVERHAUL_PLAN.md` (the decisions, the design system, the sessions). This file is the evidence. **Read Part 3 (the critic) before acting on any Part 1 or Part 2 number**: it corrects the ink ladder, the white-on-orange threshold, the primary-button fill and several counts.


## Per-surface reviews (Part 2, one file each)

- [R.A.B.B.I.T. part 1 — shell (Rabbit.jsx, ViewTabs, ProjectContextBar), Intake wizard, Project Summary, Team, Tasks (+ TaskDetailPopup, NewTaskPopup). Repo root for all evidence paths: C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\](review/r-a-b-b-i-t-part-1.md) — 44 findings (18 high), 11 uniformity gaps, 10 alignment issues, 7 Hick's hotspots; scope ≈ 8020 lines, 4 sessions (reviewer's estimate)


- [Dashboard (My Tasks / Notes / Profile) — src/components/Dashboard/](review/dashboard.md) — 35 findings (11 high), 12 uniformity gaps, 11 alignment issues, 6 Hick's hotspots; scope ≈ 420 lines, 2 sessions (reviewer's estimate)


- [R.A.B.B.I.T. part 3 — BudgetView (Summary, By Phase / Role / Asset / Scene / Shot / Level / Experience, Custom, Crew/Team, Talent, Expenses, Client View) and ScenesView (scene table, scene gallery, shot table, shot gallery, scene detail popup, shot detail popup)](review/r-a-b-b-i-t-part-3.md) — 40 findings (19 high), 12 uniformity gaps, 12 alignment issues, 6 Hick's hotspots; scope ≈ 8063 lines, 4 sessions (reviewer's estimate)


- [D.O.G. (Deck Outline Generator) tool chrome — sidebar outline, Section 1 Document & Context, Section 2 Page Generation, Output panel (tabs bar, view toggle, regenerate bar, formatting toolbar, read-only caption, empty state), rewrite popover, right-click context menu, Settings slide-out with prompt tabs, Help modal, History Import/Export modal, Duplicate Resolver modal, New Project modal. Slide preview (LayoutVisualizer / VideoThumbnail) excluded.](review/d-o-g.md) — 34 findings (12 high), 12 uniformity gaps, 11 alignment issues, 6 Hick's hotspots; scope ≈ 1050 lines, 3 sessions (reviewer's estimate)


- [Admin Terminal (src/components/AdminTerminal/, 13 files, 4,933 lines) — light page, admin-only, seven sections behind a 190px left nav](review/admin-terminal.md) — 34 findings (12 high), 10 uniformity gaps, 10 alignment issues, 8 Hick's hotspots; scope ≈ 1450 lines, 3 sessions (reviewer's estimate)


- [Resources: Projects (list + detail + create), Rate Card (page + table), Team Members, Files explorer. All four are LIGHT pages on #f4a261. Repo root: C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON (evidence paths below are relative to that root).](review/resources.md) — 37 findings (18 high), 11 uniformity gaps, 10 alignment issues, 6 Hick's hotspots; scope ≈ 1500 lines, 3 sessions (reviewer's estimate)


- [Auth surfaces (AuthShell + LoginScreen + ForgotPasswordWizard + ResetPasswordWizard + MfaSection), onboarding (NewUserWelcome), the two session-level overlays (UpdatePrompt, InviteMemberDialog), the two chrome-level notices (ModelWarningBanner, WorkspaceSwitcher), the Help page, and Home's typography only](review/auth-surfaces.md) — 38 findings (12 high), 9 uniformity gaps, 9 alignment issues, 5 Hick's hotspots; scope ≈ 850 lines, 3 sessions (reviewer's estimate)


- [R.A.B.B.I.T. part 5: Bins (BinsView + views/bins/* + UndoToast + IngestionToast)](review/r-a-b-b-i-t-part-5.md) — 35 findings (8 high), 10 uniformity gaps, 8 alignment issues, 8 Hick's hotspots; scope ≈ 1100 lines, 3 sessions (reviewer's estimate)


- [System Settings (SettingsPage + src/components/settings/*)](review/system-settings.md) — 44 findings (16 high), 13 uniformity gaps, 10 alignment issues, 8 Hick's hotspots; scope ≈ 1750 lines, 3 sessions (reviewer's estimate)


- [R.A.B.B.I.T. part 4: Assets (table + gallery + create modal + detail popup), the file manager, relations (panel, sidebar, pickers, badge), Levels and Experiences. 8,557 lines across 11 files, all rooted at C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\ (evidence paths below are relative to that root).](review/r-a-b-b-i-t-part-4.md) — 46 findings (17 high), 11 uniformity gaps, 10 alignment issues, 8 Hick's hotspots; scope ≈ 2600 lines, 4 sessions (reviewer's estimate)


- [O.T.T.E.R. (learning platform tool) — nav bar, Sidebar 1 (courses/subjects), Sidebar 2 (lessons/hotkey groups/node groups), Library, Prompt/Generate, Study + lesson markdown, Sources, Quiz Center + question/results/code-writing, Hotkeys, Functions, Nodes, Search modal, Requests, Validator (setup + results), Settings slide-out, Trash, and the six dialogs](review/o-t-t-e-r.md) — 38 findings (13 high), 10 uniformity gaps, 9 alignment issues, 8 Hick's hotspots; scope ≈ 2600 lines, 4 sessions (reviewer's estimate)


- [R.A.B.B.I.T. part 2 — Timeline (Gantt), its SummaryBand / minimap / detail toolbar / two panes, the four overlays it owns (TaskEditor, PhaseExtendModal, SettingsPanel, HelpModal) and the EditHistoryDrawer](review/r-a-b-b-i-t-part-2.md) — 42 findings (11 high), 8 uniformity gaps, 12 alignment issues, 6 Hick's hotspots; scope ≈ 1150 lines, 3 sessions (reviewer's estimate)



## Part 1 — System review


### Diagnosis

WILSON does not look dated because of its colours. It looks dated because it has no type system and no component layer, and the two compound. Nothing loads a typeface, so every surface renders in the OS default, and 1,917 font-mono classes make the browser fallback mono the de-facto UI face of a production tool. There is no scale: 26 distinct type sizes are in use, including half-pixel steps (8.5, 9.5, 10.5, 11.5, 12.5, 13.5) below the perceptual and rendering threshold, and about 300 occurrences below 10px. The de-facto body is 12px where Notion runs 14 to 16 and Apple desktop floors at 13. On top of that 1,167 elements are uppercase and 1,029 carry letterspacing, so a section heading, a nav item, a button, a table header, a chip and a status pill are all the same typographic object: 10 to 12px bold uppercase tracked. When everything is emphasised nothing is, and hierarchy collapses into a flat field of small caps that must be read rather than scanned. That flatness is what reads as a control panel rather than a contemporary tool. The second cause is architectural and is written into the design doc as a virtue: "local tokens, not global" (visual-language.md, Composition rule 3). Every page defines its own L or C object, so the app carries 121 distinct hex values, 19 hand-built tables, five verbatim copies of one ThLight that have already diverged on colour, 66 hand-rolled modal overlays across 36 files with 22 backdrop values, four toast systems in four screen positions, four tab bars with three active treatments, two contradictory scrollbar systems (one injected globally from inside D.O.G.), and two incompatible shadow languages (41 hard offset, 43 soft blur) in an app whose own spec says it uses no shadows. The counter-example proves the point: lightSurface.js is a shared token module, 30 files import it, it fixed grey-on-orange app-wide, and its header calls itself "a deliberate exception". The rule is the defect and the exception is the cure. Third, the light-orange working surface is a structural ceiling, not a taste problem. #f4a261 is a saturated mid-tone, so the whole stone ramp fails on it and Audrey's white-or-black rule is the correct forced response. But one ink means hierarchy can only come from size and weight, and the type system that would deliver that does not exist, so every light page has instead invented a bespoke workaround: a brown well, a near-white cream header, a dark input dropped onto an orange field. The Files page is where all three causes land at once, which is why she singled it out, and it also carries a one-line bug: 'project-files' was never added to PAGE_BARS, so the densest table in the app renders inside Home's 268/268 chrome and loses about 400px of vertical field.


### What works

- binUi.jsx is a real component kit and should be the template for the whole app: one C token object, and Btn, IconBtn, Chip, Kbd, Menu, Modal, Field, TextInput, TextArea, Select, EmptyState, Spinner and Toggle all defined once. Its Modal already handles a modal stack, topmost-only Escape, a busy lock, error rendered inside the footer, and an onBeforeClose guard. Nothing else in the app comes close.

- lightSurface.js proves the shared-token exception works. It is imported by 30 files, it states the measured contrast for each value, and it deliberately refuses to export the rgba(120,70,30,0.55) input well because black on it measures 4.32:1. A token module that argues with itself is a healthy one.

- The bins shortcut bar (BinsView.jsx:844) is the single best interaction-surfacing idea in the app. Persistent, non-modal, sits on the frame edge, teaches by presence rather than a Hotkeys dialog. Audrey is right that it should be everywhere.

- pageBars.js derives both bar heights from one budget with a documented min/max ordering and a test that pins it. Geometry with a rationale, not a magic table.

- App.jsx's TRANSITION object is one definition with two consumers (page navigation and the post-sign-in welcome), which is why the sign-in hand-off reads as one continuous movement instead of two animations disagreeing.

- The transition overlay title is already #1c1917 on #f4a261 at 8.49:1 (App.jsx:2071), with the reasoning recorded. The colour rule is being enforced where someone looked.

- RabbitProvider's UndoToast is a genuinely modern forgiveness pattern: instant delete, 8s window, hover pauses both the timer and the countdown bar.


### Findings (42)

**F01 · HIGH · Typography** — No typeface is loaded, and font-mono is applied 1,917 times  
law: Aesthetic-Usability Effect

- Problem: index.css imports Tailwind and defines no @font-face, no @theme and no body font-family, so the entire app renders in the OS fallback stack. 1,917 font-mono classes against 2 font-sans mean the browser's default monospace is the actual UI face of every table, label, button and heading. A default mono at 10 to 12px is the single loudest signal that a product was not designed.

- Why it matters: Aesthetic-Usability Effect: perceived quality is set before a single word is read, and a default face caps it. Every reference app Audrey named ships one deliberate sans (Notion uses Inter, Obsidian Inter, Frame.io a grotesque, Apple SF).

- Change: Self-host one variable sans and one mono as woff2 under public/fonts, declare them in an @theme block in index.css, set font-family on html, then delete font-mono everywhere it is not data. Mono keeps a job (numerics, sizes, durations, paths, ids, keys, code) and loses everything else.

- Evidence: `src/index.css:1` — `@import "tailwindcss";  /* no @theme, no @font-face, no html font-family anywhere in the file */`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:32` — `className={'inline-flex items-center gap-1.5 ${small ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[10.5px]'} font-mono uppercase tracking-wider ...'}`




**F02 · HIGH · Typography** — 26 distinct type sizes, seven of them half-pixel, ~300 below 10px  
law: Law of Similarity

- Problem: Measured across src: Tailwind steps 12/14/16/18/20/24/30/48, arbitrary steps 7/7.5/8/8.5/9/9.5/10/10.5/11/11.5/12/12.5/13/13.5/14/20/24, and inline sizes 6/7/8/9/10/11/12/13/14/15/16/16.8/17/18/20/20.5/24. The half-pixel steps alone account for 1,077 occurrences (10.5px x403, 11.5px x355, 9.5px x169, 12.5px x70, 13.5px x31, 8.5px x17, 7.5px x1). A 0.5px difference is not a hierarchy level; it is noise that renders identically at 1x and makes two adjacent surfaces look subtly misaligned for no reason a reader can name.

- Why it matters: System pass: a scale with 26 steps is not a scale. It is also the reason nothing lines up across tools, because two components that should match are set 0.5 or 1px apart.

- Change: Adopt a 7-step scale anchored on 14px body, ratio 1.125 with a hand-set display step, every step a whole pixel, 11px as an absolute floor. Delete 6, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11.5, 12.5, 13.5, 15, 16.8, 17, 18, 20.5, 30 and 48 from the codebase.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:68` — `${small ? 'px-1 text-[8.5px] leading-[14px]' : 'px-1.5 text-[9.5px] leading-[18px]'}`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:60` — `<span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>`<br>`src/components/Resources/ProjectFilesExplorer.jsx:219` — `style={{ ... fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED ... }}`




**F03 · HIGH · Hierarchy** — 1,167 uppercase elements and 1,029 tracked ones flatten every level to one  
law: Von Restorff Effect

- Problem: tracking-wider x650, tracking-widest x216, tracking-wide x163, plus 60 inline letterSpacing values spanning 0.02em to 0.4em. A Settings section heading (text-sm font-bold uppercase tracking-widest), a Home nav item (font-bold text-sm tracking-widest uppercase) and a Settings button (text-xs font-bold uppercase tracking-wider) are typographically indistinguishable. There is no body voice in the app at all: everything is a label.

- Why it matters: Selective Attention and Von Restorff both fail when every element is emphasised. Notion and Apple reserve caps for one role (a small metadata label) and set everything else sentence case, which is exactly why they scan.

- Change: Reserve uppercase plus tracking for one role only: the 11px Label. Section titles, buttons, tabs, chips, table headers, empty states and dialog titles all go sentence case at their scale step with no tracking. This is the single largest visual change in the overhaul and the one that makes it read as contemporary.

- Evidence: `src/components/SettingsPage.jsx:389` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">`<br>`src/components/Home.jsx:226` — `className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"`<br>`src/components/SettingsPage.jsx:461` — `className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"`




**F04 · HIGH · System** — "Local tokens, not global" is documented as a rule and is the mechanism of every drift  
law: Law of Similarity

- Problem: visual-language.md Composition rule 3 instructs new pages to copy HelpPage's local L object rather than import a shared one. The measured result is 121 distinct hex values in src, 80 in RABBIT alone, and five verbatim copies of ThLight that have already diverged: CompaniesSection hardcodes #57534e, LogsSection and UsersSection use LIGHT_INK, DashboardTasksView uses a local L.label, TeamMembersPage uses LIGHT_TABLE_HEAD_CELL. One of those four is a grey on orange and therefore breaks Audrey's own rule.

- Why it matters: This is the root cause finding. Fixing surfaces without reversing this rule guarantees the next feature re-introduces the drift, exactly as Files did three weeks ago.

- Change: Reverse the rule in the doc. Ship src/ui/tokens.js and src/ui/ components, absorb lightSurface.js into it keeping the existing export names as aliases so the 30 importers keep working, and make a local token object the thing that needs justification.

- Evidence: `src/admin/CompaniesSection.jsx:113` — `className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:449` — `className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: L.label, width }}`<br>`src/components/lightSurface.js:36` — `// (WILSON's convention is local 'L' token objects per page ... This module is a deliberate exception`




**F05 · HIGH · Build** — The Files page is missing from PAGE_BARS, so it renders inside Home's 268/268 chrome

- Problem: PAGE_BARS has no 'project-files' key. App.jsx line 1753 does PAGE_BARS[currentPage] || PAGE_BARS.home, so the densest table in the app gets Home's 268px top and 268px bottom bars. On a 900px window that leaves roughly 360px for a seven-column table plus a 300px details panel plus a wrapping toolbar. The same fallback also parks the pet sprite 284px off the bottom (App.jsx:1647).

- Why it matters: This is most of why she called Files atrocious. It is a one-line fix with the largest visible payoff in the review.

- Change: Add 'project-files': bars(200, 150) to PAGE_BARS, or bars(95, 8) if Files is treated as a tool-class surface, which is what its density argues for.

- Evidence: `src/layout/pageBars.js:97` — `  dashboard:          bars(200, 150),   'admin-terminal':   bars(200, 150),   help:               bars(140, 100),   // no 'project-files' entry`<br>`src/App.jsx:1753` — `const pageBars = PAGE_BARS[currentPage] || PAGE_BARS.home;`




**F06 · HIGH · System** — 19 hand-built tables, 10 header-cell implementations, no shared Table  
**constraint: touches-interaction** · law: Law of Similarity

- Problem: Tables exist in 19 files. Header cells are implemented by five copies of ThLight, five separate Th/th definitions, and inline th styles in ProjectFilesExplorer and two places in Otter. Row heights differ (px-3 py-2 in the light tables, 8px 12px in Files, header 10px 12px against body 8px 12px in the same Files table so head and body do not share a vertical rhythm). Some tables zebra-stripe, most do not. Numeric columns are right-aligned in RateCardTable and left-aligned in Files.

- Why it matters: Audrey named alignment in rows and items explicitly. A shared Table is the only thing that makes 19 surfaces align without 19 separate decisions.

- Change: Build src/ui/Table with Th, Td and Row. One 36px row, 32px head, 8px 12px cells, hairline dividers, no zebra, one selected fill, align="right" plus tabular-nums for every numeric column, and a fixed-width sort indicator slot so the header label does not shift when sort direction changes.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:219` — `<th ... style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, ... }}>  // body cells are '8px 12px'`<br>`src/components/RateCard/RateCardTable.jsx:639` — `<th style={{ ...th, width: COL.hourly, textAlign: 'right' }}>Hourly</th>`<br>`src/components/TeamMembers/TeamMembersPage.jsx:923` — `<th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={LIGHT_TABLE_HEAD_CELL}>`




**F07 · HIGH · System** — 66 hand-rolled modal overlays across 36 files, 22 different backdrop values  
law: Jakob's Law

- Problem: fixed inset-0 appears 66 times in 36 files. Backdrops measured: rgba(0,0,0,0.6) x34, 0.3 x17, 0.5 x11, bg-black/50 x10, bg-black/60 x6, bg-black/70 x5, 0.7 x4, 0.35 x4, rgba(12,10,9,0.7/0.72/0.75/0.8), 0.65, 0.72, 0.4 and more. Exactly one real Modal component exists (binUi), and it is the only one that handles a modal stack, topmost-only Escape, a busy lock and an in-footer error. Every other dialog re-implements a subset by hand.

- Why it matters: A dialog is the most attention-expensive object in an interface. Twenty-two backdrops means the app dims to a different depth depending on which button you pressed, which reads as instability.

- Change: Promote binUi's Modal to src/ui/Dialog unchanged, one backdrop (rgba(12,10,9,0.6)), one surface, one 8px radius, one header/body/footer contract, and migrate the 66 sites. Highest-count files first: Otter.jsx (9), TimelineView and TaskTemplateManager (4 each).

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:216` — `<div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(12,10,9,0.72)' }}`<br>`src/App.jsx:2236` — `backgroundColor: 'rgba(0,0,0,0.6)',`<br>`src/tools/otter_v0.3.1/Otter.jsx:5554` — `<div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">`




**F09 · HIGH · Colour** — The Files table sets six of its seven columns in a 3:1 brown on an orange ground

- Problem: MUTED = '#7c4f1f' is applied to Type, Size, Created, Modified, Duration and Location, to the table header, to both empty states, to the details panel labels and to the columns view. Against the row fill (rgba(120,70,30,0.12) over #f4a261) it measures about 3.0:1. It is neither white nor black, which is the rule Audrey wrote in capitals, and it means every field on the page except the filename is the hardest thing on it to read.

- Why it matters: This is the literal content of her complaint about Files. It is also the exact defect lightSurface.js was created to stop, and this file imports LIGHT_INK and then ignores everything else in the module.

- Change: Delete MUTED. Every cell is LIGHT_INK. Secondary rank comes from the 13px step against 14px and weight 400 against 600, never from a lighter ink. Take BORDER from LIGHT_RULE, the header fill from LIGHT_WELL, and the selected fill from LIGHT_ACCENT at 14 percent.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:35` — `const MUTED = '#7c4f1f'`<br>`src/components/Resources/ProjectFilesExplorer.jsx:241` — `<td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{isFolder ? 'Folder' : m.type}</td>`<br>`src/components/lightSurface.js:43` — `export const LIGHT_INK = '#1c1917'   // "Every piece of text on a light surface."`




**F10 · HIGH · Colour** — The Files toolbar drops two dark stone input wells onto the light orange page  
law: Law of Similarity

- Problem: The project select and the filter input are backgroundColor #1c1917 with #f4a261 text and a #44403c border, sitting on a #f4a261 page next to transparent 11px outline buttons. Three control languages in one 60px strip: a dark well, a ghost outline button, and a monospace count string. The documented light-page input is rgba(120,70,30,0.55).

- Why it matters: Law of Similarity and Common Region both break: the two darkest objects on the page are the two least important controls, so the eye lands on the filter box before the table.

- Change: Use one light-surface control style: LIGHT_WELL fill, LIGHT_RULE hairline, LIGHT_INK text, 4px radius, 28px height, one focus ring. Same geometry for select, input and button so the toolbar sits on one baseline instead of three.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:146` — `style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c', minWidth: 240 }}`<br>`src/components/Resources/ProjectFilesExplorer.jsx:63` — `borderRadius: 2, cursor: 'pointer', border: '1px solid ${active ? ACCENT : 'rgba(120,70,30,0.4)'}',`




**F14 · HIGH · Flow** — The nav strip can present 15 choices at once and puts SETTINGS next to SYSTEM SETTINGS  
**constraint: touches-interaction** · law: Hick's Law

- Problem: getNavStripItems returns up to 8 items (HOME, D.O.G., O.T.T.E.R., R.A.B.B.I.T., DASHBOARD, SETTINGS, RESOURCES, SYSTEM SETTINGS) and getResourcesNavItems up to 7 (PROJECTS, RATE CARD, TEAM MEMBERS, FILES, ADMIN TERMINAL, HELP), all at identical 16px bold uppercase 0.2em with no grouping, no rules and no size difference. Two adjacent items differ by one word and do completely different things: SETTINGS opens the current tool's panel, SYSTEM SETTINGS navigates to a page.

- Why it matters: Hick's Law is the law Audrey asked to focus on, and this is where it bites hardest in the shell. Miller's Law puts the ceiling at 7 plus or minus 2; 15 undifferentiated peers is roughly double. The naming collision is also a Mental Model failure: one is tool scope, one is app scope, and the labels do not say so.

- Change: Three moves, none of which change what the strip does. First, rename to "Tool settings" and "App settings" so scope is in the label. Second, group the strip with one hairline and a Label-role caption per group (Tools / Resources / System) so 15 items read as three groups of four to six. Third, set the group captions at the 11px Label step and the items at the 16px step, so the list has two levels instead of one.

- Evidence: `src/App.jsx:1706` — `if (isDog)    items.push({ label: 'SETTINGS', action: () => closeNavAndTrigger(setOpenSettingsTrigger) });`<br>`src/App.jsx:1715` — `items.push({ label: 'SYSTEM SETTINGS', action: () => closeNavAndGo('settings') });`<br>`src/App.jsx:1722` — `const getResourcesNavItems = () => { const all = [ ... 7 entries ... ] }`




**F22 · HIGH · Motion** — The 2100ms page transition has no reduced-motion path  
**constraint: touches-transition**

- Problem: index.css guards exactly one animation with prefers-reduced-motion, the 200ms auth step fade. The page transition (250 fade out, 600 compress, 400 hold, 600 expand, 250 fade in) plays in full for every user on every navigation, and it is a large-area transform. AuthShell reads prefersReducedMotion(), the shell does not.

- Why it matters: Large-area movement is the category that actually causes harm, and this is the largest in the app. The fallback must deliver the end state, not a slower version.

- Change: Keep the transition exactly as specified. Under prefers-reduced-motion: reduce, skip compress and expand, hold the title for 400ms over a still frame, and cross-fade the page in 120ms. Read the preference at call time in navigateTo and playWelcome the way AuthShell already does.

- Evidence: `src/index.css:56` — `@media (prefers-reduced-motion: reduce) {   .auth-step { animation: none; } }`<br>`src/App.jsx:1179` — `const TRANSITION = { fadeOut: 250, compress: 600, hold: 400, expand: 600, fadeIn: 250 };`<br>`src/cloud/auth/AuthShell.jsx:239` — `const reduceMotion = prefersReducedMotion()`




**F35 · HIGH · Colour** — Can the orange chrome carry a Notion-calm interface  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: The #ea580c frame is 95px top on tools, 200/150 on resource pages and 268/268 on Home, plus a 32px title bar, so on a 900px window a resource page spends 350px of 900 on chrome before the nav strip opens. The question is whether a saturated orange frame is compatible with the calm Audrey is asking for.

- Why it matters: It has to be answered before any surface work, because the answer sets what the content field has to do.

- Change: My position: keep it. Frame.io and Obsidian both put a saturated brand edge around a calm field, and the orange is the strongest piece of identity WILSON has. Three conditions. First, the frame carries white or black only, so the orange-200 subtitle in F16 goes to white and loses rank by size. Second, the resource-page bars drop from 200/150 to 120/80, which returns about 150px of content field to the exact pages that are densest. Third, no content-layer element uses #ea580c as a fill, so the frame colour stays unique to the frame and the active RABBIT tab (F29) stops borrowing it. Marked palette-decision because condition two changes the card-on-a-desk framing Audrey chose.

- Evidence: `src/layout/pageBars.js:93` — `settings:           bars(200, 150), 'project-manager':  bars(200, 150),`<br>`src/App.jsx:1924` — `backgroundColor: '#ea580c', height: topHeight,`




**F36 · HIGH · Colour** — The light-orange page class cannot carry it, and that is a structural ceiling rather than a taste call  
**constraint: palette-decision**

- Problem: #f4a261 is a saturated mid-tone. lightSurface.js already measured the consequence: the entire stone ramp fails on it, white is 2.06:1, and only #1c1917 clears at 8.49:1. So a light page gets exactly one ink and no card, which is why every one of them has invented a workaround instead: a brown well at rgba(120,70,30,0.55) that black measures 4.32:1 against (the module refuses to export it for that reason), a flattened #dd9155 for floating panels, a one-off #f5efe6 header in Files, and two dark stone inputs dropped onto the orange in the same toolbar. Nine of the twelve pages are this class, and they are the ones Audrey calls atrocious.

- Why it matters: Every reference she named puts working content on a near-neutral field, because a second ink and a raised surface are the two devices a dense interface needs and a saturated ground removes both.

- Change: Three options, ranked. Option A, recommended: keep #f4a261 for Home, Settings and Help, which are reading and form surfaces where one ink is enough, and move the data pages (Files, Team Members, Rate Card, Admin Terminal, Dashboard tables, Projects) onto the same dark stone the tools already use. The orange frame stays on all of them, so the app reads as one system and the split becomes reading pages versus working pages rather than nine versus three. Option B: keep all nine light but change their ground to a warm near-neutral (#f2ece4, about L*93) and let #f4a261 do only the bars and the transition overlay. Black, a real secondary ink and a raised card all become available, and it lands closest to Notion. Costs the orange page identity. Option C: change nothing and accept one-ink hierarchy permanently, which is what Session 43 already committed to and which caps how modern the light pages can look. Audrey rules.

- Evidence: `src/components/lightSurface.js:22` — `//     #a8a29e  stone-400   1.42:1  x      #57534e  stone-600   3.70:1  x //     #78716c  stone-500   2.33:1  x      ... //     #1c1917  stone-900   8.49:1  ok`<br>`src/components/lightSurface.js:52` — `// black on that well measures 4.32:1, just under AA ... That is a REAL, pre-existing problem with every input on every light page`<br>`src/App.jsx:2044` — `backgroundColor: isDarkPage ? '#1c1917' : '#f4a261',`




**F08 · MEDIUM · System** — Four tab bars, three active treatments, four sizes  
**constraint: touches-interaction** · law: Law of Similarity

- Problem: SettingsPage tabs are px-5 py-2 text-xs bold uppercase tracking-widest, active = brown fill + white + 2px #f97316 underline. DashboardPage tabs are px-4 py-2 text-[11px] bold uppercase tracking-wider, active = same fill but 11px not 12px and tracking-wider not widest. RABBIT ViewTabs are px-3 py-2 text-[11px] mono uppercase tracking-wider, active = solid #ea580c fill plus a 2px #ea580c bottom border that is invisible against its own fill. Otter's view switcher is px-4 py-2 text-sm font-medium sentence case with an orange-400 label and orange-500 border-bottom, the only one in the app that is not caps and the only one using weight 500.

- Why it matters: Law of Similarity: four tab bars that look different teach the user that they are four different mechanisms. They are not.

- Change: One src/ui/Tabs. Sentence case at the 14px step, weight 600 when active, one active treatment: 2px signal underline and full-strength ink. No fill. The fill is what makes RABBIT's tab strip read as chrome rather than content.

- Evidence: `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:54` — `backgroundColor: active ? '#ea580c' : 'transparent', borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',`<br>`src/components/SettingsPage.jsx:337` — `className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-t-sm transition-colors"`<br>`src/components/Dashboard/DashboardPage.jsx:45` — `className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-t-sm transition-colors"`




**F11 · MEDIUM · Alignment** — The Files name column cannot left-align, because folders and files use glyphs of different widths  
law: Law of Uniform Connectedness

- Problem: Each name cell prefixes a literal character, U+25B8 for a folder and a middle dot for a file, followed by an 8px margin. The two glyphs have different advance widths in any proportional face, so within a single folder listing the filenames start at different x positions. Indentation is separately applied as paddingLeft 12 + depth*18*indent, and indent is silently zeroed while a filter is active, so the tree structure disappears mid-interaction with no other cue.

- Why it matters: This is precisely what Audrey means by "make sure alignment in rows and items all make sense". It is visible in every screenshot of the page.

- Change: Replace both glyphs with a fixed 16px icon slot (lucide Folder and File) so the name text has one x origin at every depth. Keep depth indentation on the slot, not the text, and when a filter flattens the tree show the path in the Location column rather than silently removing indentation.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:239` — `<span aria-hidden style={{ marginRight: 8 }}>{isFolder ? '▸' : '·'}</span>{node.name}`<br>`src/components/Resources/ProjectFilesExplorer.jsx:210` — `const indent = query ? 0 : 1`




**F12 · MEDIUM · Density** — The Files table carries three competing row states and a one-off cream header  
law: Law of Prägnanz

- Problem: Rows alternate between two brown tints (0.12 and 0.22 alpha) and a third fill marks selection. Zebra striping plus a selection fill means the selected row competes with the stripe rather than standing out from it. The sticky header is #f5efe6, a near-white cream that appears nowhere else in 121 colours, and Audrey's standing instruction on the Rate Card was "NO WHITE BACKGROUND".

- Why it matters: Frame.io and Notion both use hairline dividers rather than zebra because a stripe is a second signal competing with hover, selection and focus. Density pass: the stripe is decoration that makes the data harder to track, not easier.

- Change: Drop zebra entirely. One hairline row divider (LIGHT_RULE), one hover fill at 6 percent ink, one selected fill at 14 percent signal, one 2px signal left border on the selected row. Header fill becomes LIGHT_WELL; delete #f5efe6.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:37` — `const ROW_A = 'rgba(120, 70, 30, 0.12)' const ROW_B = 'rgba(120, 70, 30, 0.22)' const SELECTED = 'rgba(234, 88, 12, 0.24)'`<br>`src/components/Resources/ProjectFilesExplorer.jsx:214` — `<tr style={{ position: 'sticky', top: 0, backgroundColor: '#f5efe6', zIndex: 1 }}>`




**F13 · MEDIUM · Typography** — Files uses six type sizes on one 325-line page and duplicates the page title  
law: Occam's Razor

- Problem: 10px headers and detail labels, 11px buttons and path cells, 12px count string and details placeholder, 13px table body, columns rows, detail values and empty states, 14px select and input, 18px page heading. None come from a scale. The 18px uppercase tracking-widest heading reading "Files" also duplicates the "FILES" already rendered in the orange top bar 100px above it.

- Why it matters: Two page titles in one viewport is a hierarchy error, and the in-page one is the weaker of the two.

- Change: Delete the in-page h2 and let the top bar own the page title. Reset the remaining sizes to Label 11, Caption 12, Dense 13, Body 14. That is four sizes for the whole page.

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:141` — `<h2 className="text-lg font-bold uppercase tracking-widest" style={{ color: INK, marginRight: 8 }}>Files</h2>`<br>`src/App.jsx:1896` — `<h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>`




**F15 · MEDIUM · Alignment** — The nav strip aligns to nothing in the bar that opens it  
law: Law of Uniform Connectedness

- Problem: The nav strip is right-aligned with paddingRight 48px and a 48px column gap. The hamburger that opens it sits at px-4 (16px) on tool pages and px-6 (24px) on resource pages. So the items slide out 32px or 24px short of the control that summoned them, and the two top-bar variants disagree with each other as well. getNavStripHeight computes count*24 + (count-1)*16 + 48, where the 24 is an assumed line box for 16px type and will be wrong the moment the size changes.

- Why it matters: Law of Uniform Connectedness: a menu that does not share an edge with its trigger reads as a separate object that happened to appear. This is the alignment complaint at shell level.

- Change: One page gutter token (24px) used by the top bar, the nav strip and every page's content area. Right-align nav items to the same 24px edge as the hamburger. Derive the strip height from the item count times a row-height token rather than a hardcoded 24.

- Evidence: `src/App.jsx:1959` — `gap: '48px', paddingRight: '48px',`<br>`src/App.jsx:1831` — `<div className="flex items-center justify-between w-full h-full px-4 pb-3">`<br>`src/App.jsx:1895` — `<div className="flex items-center justify-between w-full px-6" style={{ paddingBottom: '12px' }}>`




**F16 · MEDIUM · Hierarchy** — Four different page-title treatments, and the tool subtitle sits at about 2.7:1 on orange  
**constraint: palette-decision** · law: Jakob's Law

- Problem: Tool pages: 24px bold uppercase tracking-tight white in the orange bar, with a text-orange-200 text-xs subtitle. Resource pages: 20px bold uppercase tracking-tight white, no subtitle. Otter's in-page view titles: text-2xl (24px) bold #fb923c sentence case on stone. Files: 18px bold uppercase tracking-widest black. Four sizes, three cases, three inks for one role. The orange-200 subtitle (#fed7aa on #ea580c) measures roughly 2.7:1 and is neither white nor black.

- Why it matters: The page title is the one element that must be identical across an ecosystem, because it is how the user confirms where they are. Also a direct read of Audrey's colour rule: a tint of the ground is a grey by another name.

- Change: One PageHeader component, one title step (20px, weight 600, sentence case, white), one subtitle step (13px, white, no tint) with hierarchy carried by size not colour. Tool and resource pages differ only in whether the subtitle slot is filled.

- Evidence: `src/App.jsx:1835` — `<h1 className="text-[24px] font-bold tracking-tight uppercase leading-tight text-white">D.O.G.</h1> <p className="text-orange-200 text-xs tracking-wide">Deck Ou`<br>`src/App.jsx:1896` — `<h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>`<br>`src/tools/otter_v0.3.1/Otter.jsx:4058` — `<h2 className="text-2xl font-bold text-orange-400">Course Library</h2>`




**F17 · MEDIUM · Uniformity** — Home and the nav strip name the same destinations in two typographic voices  
**constraint: touches-home** · law: Law of Similarity

- Problem: Home renders "System Settings" as sentence-case data uppercased by CSS at 14px bold 0.1em. The nav strip hardcodes the string 'SYSTEM SETTINGS' at 16px bold 0.2em. Two lists, two casing mechanisms, two sizes, two tracking values, for the same six destinations. Home is also the only surface in the app whose primary type is 14px; everywhere else it is 12px.

- Why it matters: These two lists are seen within two seconds of each other on every session. They are the app's first impression of whether it is one system.

- Change: Extract one NAV_DESTINATIONS array with sentence-case labels, consumed by both. Both render at the same scale step with the same case rule. Per constraint 3 this is the only change Home needs.

- Evidence: `src/components/Home.jsx:29` — `{ id: 'settings',         label: 'System Settings',  Icon: Settings },`<br>`src/App.jsx:1715` — `items.push({ label: 'SYSTEM SETTINGS', action: () => closeNavAndGo('settings') });`<br>`src/App.jsx:2021` — `fontSize: '16px',   // nav strip; Home is text-sm (14px)`




**F18 · MEDIUM · Uniformity** — The shortcut bar exists once, at 9px and about 2.5:1  
law: Jakob's Law

- Problem: BinsView renders twelve keyboard hints in a 34px footer at text-[9px] in C.dimmer (#57534e) on C.deep (#0c0a09), which measures roughly 2.5:1. Twelve hints run in one undifferentiated row with a 12px gap and no grouping. Elsewhere the same information is surfaced three other ways: Otter has a Hotkeys view behind a tab, D.O.G. prints shortcuts inside a context menu at text-stone-600 on stone-800 (about 1.9:1), and everywhere else it is a title attribute or nothing.

- Why it matters: This is Audrey's own named example of the missing shared language. The pattern is right and the execution is the least legible text in the app.

- Change: Promote to src/ui/ShortcutBar. 28px tall, hairline top, Kbd at 11px, labels at 12px in ink at 60 percent on dark, hints grouped with a 24px gap between groups (navigation / review / edit). Mount it in every view that registers document-level keys: BinsView, ScenesView, TimelineView, Otter's lesson reader, D.O.G.'s editor.

- Evidence: `src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `className="flex items-center gap-3 pr-3 text-[9px] font-mono flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid ${C.line}', color: C.dimmer, backgroundColo`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:136` — `<kbd className="inline-block px-1 rounded-sm text-[9px] font-mono leading-[14px]"`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5191` — `<Undo2 className="w-3 h-3 flex-shrink-0" /> Undo <span className="ml-auto text-stone-600 text-[10px]">{modKey}Z</span>`




**F19 · MEDIUM · Build** — D.O.G. injects a global scrollbar stylesheet that overrides index.css on every page

- Problem: DeckOutlineGenerator renders a style tag setting ::-webkit-scrollbar globally plus a universal selector rule (* { scrollbar-width: thin; scrollbar-color: #57534e #1c1917 }). Because App renders all pages simultaneously and hides them with display:none, this stylesheet is mounted for the entire session regardless of which page is showing, and it collides with .wilson-light-scroll in index.css. Two scrollbar systems: 8px dark with a #1c1917 track versus 6px orange thumb with no track.

- Why it matters: Scrollbar chrome is one of the three things a user reads as "this is one app". It currently depends on selector specificity between a component and a stylesheet.

- Change: Delete the style tag. Move both scrollbar treatments into index.css as .wilson-dark-scroll and .wilson-light-scroll, apply the dark one on the tool page wrappers in App.jsx alongside the light one already applied there, and drop the universal selector rule.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3719` — `/* Firefox scrollbar */ * {   scrollbar-width: thin;   scrollbar-color: #57534e #1c1917; }`<br>`src/index.css:61` — `.wilson-light-scroll::-webkit-scrollbar { width: 6px; height: 6px; }`




**F20 · MEDIUM · Colour** — Two incompatible shadow languages, in an app whose spec says it has none  
law: Law of Prägnanz

- Problem: 41 hard offset shadows (shadow-[4px_4px_0px...] x30, 8px x4, 3px x3, 2px x2, 1px x2) and 43 soft blur shadows (shadow-2xl x28, xl x7, lg x6, md x2), plus a coloured glow on RABBIT's status dot. The offset shadow is a brutalist device, the blur is a material one, and they appear within one screen of each other. visual-language.md says WILSON does not use heavy drop shadows.

- Why it matters: Shadow is the depth grammar of an interface. Two grammars means the user cannot tell docked from floating, which is the only job elevation has.

- Change: One elevation rule. Docked surfaces (panels, sidebars, toolbars, tables, cards) get a hairline and no shadow. Floating surfaces only (Dialog, Menu, popover, Toast) get exactly one shadow: 0 8px 24px rgba(0,0,0,0.35) on dark and 0 8px 24px rgba(60,30,10,0.25) on light. Delete all 41 offset shadows and the dot's glow.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3854` — `<section className="bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]">`<br>`src/tools/rabbit_v0.1.0/Rabbit.jsx:300` — `boxShadow: glow,   // '0 0 6px rgba(34,197,94,0.7)'`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:97` — `className="absolute right-0 mt-1 z-40 rounded-sm shadow-2xl overflow-hidden"`




**F21 · MEDIUM · System** — Border weight splits the app in half: 2px in D.O.G. and O.T.T.E.R., 1px in RABBIT  
_taste, not error_ · law: Law of Similarity

- Problem: border-2 appears 53 times in D.O.G. and 146 in O.T.T.E.R.; plain 1px border appears 912 times in RABBIT. A 2px rule against 11px type is roughly one sixth of the cap height, so the older two tools read as heavier and boxier than the newest one even though the palette is the same. Radii are similarly split: rounded-sm (2px) x1364, rounded (4px) x467, rounded-md x23, rounded-lg x6, plus inline radii of 2, 3, 4, 5, 6 and 10.

- Why it matters: Border weight and radius are the two cheapest ways an interface signals its age, and this is the visible difference between RABBIT (which reads current) and D.O.G. (which does not).

- Change: One hairline at 1px everywhere; delete border-2 entirely. Two radii only: 4px for controls, inputs, chips, rows and panels, 8px for floating surfaces. Drop 2px, which at 96dpi reads as an aliasing artefact rather than as sharpness, and drop 3, 5, 6 and 10.

- Evidence: `src/tools/otter_v0.3.1/Otter.jsx:3507` — `<aside className="w-[200px] shrink-0 bg-stone-800 border-r-2 border-stone-600 overflow-hidden flex flex-col">`<br>`src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:40` — `borderBottom: '1px solid #44403c',`<br>`src/App.jsx:2241` — `border: '2px solid #ea580c', borderRadius: '6px',`




**F23 · MEDIUM · Motion** — The transition's payload is a 16.8px word in the middle of a full screen  
**constraint: touches-transition** · law: Peak-End Rule

- Problem: The bars compress for 600ms to meet in the middle and hold for 400ms, and what they deliver is 16.8px bold uppercase at 0.3em letterspacing. On a 1400px field that is a whisper at the loudest moment of the app. The documented spec said text-4xl to text-5xl (36 to 48px); the shipped value is a third of that. At 0.3em the tracking is also so wide that a long title like R.A.B.B.I.T. reads as separated characters rather than a word.

- Why it matters: Peak-End Rule: the transition is the app's signature gesture and its peak currently under-delivers. This is a type fix inside a transition that stays, not a change to the transition.

- Change: Raise the title to the 34px display step, weight 600, tracking 0.12em, keeping the #1c1917 ink on #f4a261 that is already correct at 8.49:1. Keep every duration exactly as it is.

- Evidence: `src/App.jsx:2073` — `fontSize: '16.8px', letterSpacing: '0.3em', textTransform: 'uppercase',`




**F24 · MEDIUM · Build** — 405 uses of focus:outline-none against 325 focus rings, in four different treatments

- Problem: focus:outline-none x405. Replacements: focus:ring-2 x224, focus:ring-1 x101, focus:border-orange-500 x47, focus:ring-orange-500 x318, focus:ring-amber-500 x6, focus:ring-orange-700 x1. Roughly 80 elements strip the native focus indicator and put nothing back, and the ones that do are split between a 1px ring, a 2px ring and a border colour change.

- Why it matters: The nav strip is explicitly keyboard-reachable (App.jsx wires onFocus into the hover state for that reason), so keyboard operation is a supported path and half of it has no visible focus.

- Change: One focus token used by every control in src/ui/: a 2px signal ring at 40 percent with a 1px offset, applied via focus-visible so it does not fire on mouse clicks. Remove every bare focus:outline-none.

- Evidence: `src/App.jsx:1684` — `// 'hover:' is mouse-only and this nav is keyboard-reachable ... so focus feeds the same state`<br>`src/components/Resources/ProjectFilesExplorer.jsx:145` — `className="px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:254` — `const inputClass = 'w-full px-2 py-1 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 ...'`




**F25 · MEDIUM · System** — Four toast systems in four screen positions with four palettes  
law: Doherty Threshold

- Problem: AgentProvider renders bottom-24 centre, stone-800 with an orange-500 border and orange-400 text at 12px mono. UndoToast renders bottom-6 centre on #292524. IngestionToast renders bottom-4 left on #292524 with a 10px uppercase header. ModelWarningBanner renders full width above the chrome in amber rgba(180,83,9,0.14) at 13px. Two of them can be on screen at once and they will not stack, they will overlap.

- Why it matters: Transient feedback is the one surface where consistency of position is functional, not aesthetic: the eye learns one place to look.

- Change: One src/ui/Toast with one anchor (bottom centre, 24px up), one surface, one stack manager, and variants info / success / warning / danger drawn from the functional tokens. ModelWarningBanner stays a banner, since a persistent degradation is not a toast, but takes its colours from the same warning token.

- Evidence: `src/agent/AgentProvider.jsx:25` — `className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-stone-800 border border-orange-500 text-orange-400 px-4 py-2 rounded-sm text-xs font-mono shadow-lg`<br>`src/tools/rabbit_v0.1.0/components/UndoToast.jsx:81` — `className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-sm shadow-2xl ..."`<br>`src/tools/rabbit_v0.1.0/components/IngestionToast.jsx:48` — `className="fixed bottom-4 left-4 z-50 flex flex-col rounded-sm shadow-2xl"`




**F26 · MEDIUM · System** — 47 empty-state sites, two EmptyState components with different props  
law: Zeigarnik Effect

- Problem: binUi's EmptyState takes Icon, title, body, children and compact, and renders a centred 12px uppercase title with an 11px body. LogsSection defines its own EmptyState taking only text, rendering a 12px italic mono line under a fixed ScrollText icon. ProjectFilesExplorer defines a third, called Empty, at 13px centred mono. D.O.G. writes its own inline with a circular stone icon badge. Loading states are routed through the same components as genuinely empty ones, so "Loading..." and "No events yet" look identical.

- Why it matters: Empty and loading are different states with different user actions, and the app currently cannot tell them apart visually. Zeigarnik: an empty state is where the next action should be offered, and only binUi's version has a slot for it.

- Change: One src/ui/EmptyState (icon 24px, title 14px weight 600 sentence case, body 13px, action slot) and one src/ui/Loading (skeleton rows for tables, a spinner elsewhere). Never route a loading state through an empty state.

- Evidence: `src/components/AdminTerminal/LogsSection.jsx:412` — `function EmptyState({ text }) { ... <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>{text}</span>`<br>`src/components/AdminTerminal/LogsSection.jsx:260` — `if (loading && events.length === 0) return <EmptyState text="Loading..." />`<br>`src/components/Resources/ProjectFilesExplorer.jsx:200` — `<div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13, color: MUTED, fontFamily: 'monospace' }}>{children}</div>`




**F27 · MEDIUM · Colour** — HelpPage's L object, the template the design doc tells every page to copy, contains three grey-on-orange tokens

- Problem: listItem is text-stone-700 (about 4.4:1 on #f4a261), listMuted and mono are text-stone-600 (about 3.4:1), and mono is 10px. All three sit on the #f4a261 content area. lightSurface.js's own header lists stone-600 at 3.70:1 as a failure. The visual-language doc reproduces this exact object as the pattern new pages should follow.

- Why it matters: The doc is actively propagating the defect it elsewhere forbids. Every page built from this template inherits it.

- Change: Delete listMuted. listItem and mono become LIGHT_INK at the 13px and 12px steps. mono keeps the mono face because it holds paths and commands, but not a lighter ink. Then rewrite the Composition rule 3 section so the doc stops teaching this.

- Evidence: `src/components/HelpPage.jsx:32` — `listItem: 'text-[11px] text-stone-700 leading-relaxed', listMuted: 'text-[11px] text-stone-600 leading-relaxed', mono: 'text-[10px] text-stone-600 bg-white/30 p`<br>`src/components/lightSurface.js:22` — `//     #78716c  stone-500   2.33:1  x      #57534e  stone-600   3.70:1  x`




**F28 · MEDIUM · System** — binUi's C token set has 16 entries, one of them a duplicate, and eight type sizes

- Problem: C defines bg, panel, deep, line, faint, text, bright, muted, dim, dimmer, accent, accentBorder, accentText, green, red, amber. faint and panel are both '#292524', so two names carry one value and will inevitably diverge. Five of the sixteen are greys (text, muted, dim, dimmer plus line), which is four levels of de-emphasis for one dark surface. The same file sets type at 8.5, 9, 9.5, 10, 10.5, 11, 11.5 and 12px. This is the best component file in the codebase and it still has no scale.

- Why it matters: This kit becomes the app's kit, so its token set is the one that has to be right first.

- Change: Reduce to: three surfaces (recessed, base, raised), one hairline, one ink at three screens (100 / 72 / 48 percent), one signal, and four functional colours. Delete faint, dim and dimmer. Map the eight sizes onto Label 11, Caption 12, Dense 13, Body 14.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:13` — `export const C = {   bg: '#1c1917', panel: '#292524', deep: '#0c0a09', line: '#44403c', faint: '#292524',   text: '#d6d3d1', bright: '#fff7ed', muted: '#a8a29e'`




**F29 · MEDIUM · Hierarchy** — RABBIT's tab strip carries eleven peers and paints the active one in the app's chrome colour  
**constraint: touches-interaction** · law: Miller's Law

- Problem: RABBIT_VIEWS has eleven entries, all rendered at identical weight with an icon each. The active tab gets a solid #ea580c fill plus a 2px #ea580c bottom border, which is invisible against its own fill, so one of the two active treatments does nothing. #ea580c is also the colour of the orange bars two rows above, so the active tab reads as a piece of the app frame that has slipped into the content area.

- Why it matters: Miller's Law caps a peer set around seven to nine. Von Restorff: the isolate should stand out from its group, not match the chrome of a different layer.

- Change: Interactions stay identical (eleven tabs, same order, same hiding rules). Visually: drop the fill, keep a 2px signal underline with full-strength ink on the active label and 60 percent on the rest, drop the per-tab icons to a 16px slot that appears only for the active tab, and separate the strip into two groups with a hairline (project views, then production views) so eleven reads as five plus six.

- Evidence: `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:18` — `export const RABBIT_VIEWS = [ ... 11 entries: intake, summary, team, tasks, timeline, budget, assets, scenes, bins, levels, experiences ]`<br>`src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:58` — `borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',   // on a #ea580c fill`




**F30 · MEDIUM · System** — ProjectContextBar sets 9px type and re-implements its status colours twice with three greens  
law: Law of Uniform Connectedness

- Problem: One 155-line component uses 9px, 10px, 11px and 12px. The status colour ladder is written once at line 46 for the pill (#15803d fill) and again inline at lines 134 and 137 for the dropdown (#15803d dot, #4ade80 label), so one semantic state has three colour expressions in one file. The primary control, Switch, is a 10px uppercase mono label inside a 1px box.

- Why it matters: 9px is below every desktop legibility floor, and a status vocabulary that is written twice is a vocabulary that has already forked.

- Change: One StatusBadge component taking a semantic token (active / draft / archived / wrapped), so the dot, the pill and the label always agree. Type goes to Label 11 for the field caption and Dense 13 for the project title. Switch becomes a 28px secondary button at the 12px step.

- Evidence: `src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:46` — `const statusColor = status === 'active' ? '#15803d' : status === 'archived' ? '#57534e' : status === 'wrapped' ? '#15803d' : '#ea580c';`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:136` — `color: p.status === 'active' ? '#4ade80' : p.status === 'archived' ? '#78716c' : ...`




**F31 · MEDIUM · Colour** — O.T.T.E.R.'s node badges add fifteen cool, saturated inks against the documented warm-only rule  
**constraint: palette-decision** · _taste, not error_ · law: Miller's Law

- Problem: NODE_TYPE_COLORS defines fifteen values including four blues and cyans (#60a5fa, #818cf8, #22d3ee, #2dd4bf), two purples, two pinks and a lime. visual-language.md Composition rule 2 says warm over cool, no blues, no cyans. Fifteen categorical colours also exceeds what anyone can hold, so the encoding does not actually encode.

- Why it matters: Miller's Law: a categorical ramp past about eight becomes a lookup rather than a signal. The rule violation matters less than the fact that it does not work as a legend.

- Change: If these mirror Blender or Unreal's own socket colours they are load-bearing and stay, documented as an exempt data ramp. If they do not, reduce to eight categories generated by one hue rotation at fixed saturation and lightness, with a ninth "other" bucket, so they read as one family rather than fifteen unrelated chips. See the open questions.

- Evidence: `src/tools/otter_v0.3.1/Otter.jsx:58` — `const NODE_TYPE_COLORS = {   'Float': '#60a5fa', 'Integer': '#818cf8', 'Vector': '#c084fc',   'Color': '#facc15', 'Shader': '#4ade80', 'Geometry': '#2dd4bf', ..`




**F33 · MEDIUM · System** — There is no Button outside binUi, and the padding grid has nine cells  
law: Law of Similarity

- Problem: SettingsPage alone uses px-3 py-1, px-3 py-1.5, px-4 py-1.5, px-4 py-2 and px-5 py-2, at 10px, 11px and 12px, all bold uppercase tracked. Primary fills are split across #ea580c (x98), #fb923c (x10), #f97316 (x4), #c2410c (x2), bg-orange-600 (x59), bg-orange-500 (x48) and bg-orange-700 (x33). Danger is split across bg-red-900 (x36), #dc2626 (x10), bg-red-800, bg-red-700, bg-red-600, #ef4444 and more. So a Save button in Settings, in RABBIT and in Otter are three different objects at three sizes in three oranges.

- Why it matters: Law of Similarity governs affordance. If the primary action does not look the same in three tools, the user has to re-learn it in each, which is the opposite of an ecosystem.

- Change: One src/ui/Button. Variants primary / secondary / ghost / danger. Two sizes: sm 28px (px-2.5) and md 36px (px-4). One signal for primary (#ea580c), one danger (#b91c1c on light, #fca5a5 outline on dark). Sentence case, weight 600, no tracking.

- Evidence: `src/components/SettingsPage.jsx:483` — `className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"`<br>`src/components/SettingsPage.jsx:337` — `className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-t-sm transition-colors"`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:21` — `const base = primary ? { color: C.bright, backgroundColor: C.accent, border: '1px solid ${C.accentBorder}' } : ...`




**F34 · MEDIUM · Density** — The content area supplies no horizontal gutter, so every page invents one and two measures disagree by 570px  
law: Law of Proximity

- Problem: App.jsx pads the content wrapper 3vh 0, vertical only. Each page then supplies its own horizontal padding and measure: Dashboard maxWidth 1240px with 2rem padding, SettingsPage max-w-2xl (672px) with px-8, Files padding 18px 24px 12px, HelpPage p-6. Vertical padding in vh also means the gutter above the content changes with window height while the gutter beside it does not, so the frame is never square.

- Why it matters: The page frame is the one thing every surface shares and it currently shares nothing. This is the structural half of Audrey's placement and orientation complaint.

- Change: Move the gutter into the shell: 24px horizontal, 24px vertical, in pixels not vh. Two measure tokens only: 720px for reading and form pages (Settings, Help), full width with a 1240px cap for data pages (Dashboard, Files, Team Members, Rate Card, Admin Terminal). Pages stop setting their own padding.

- Evidence: `src/App.jsx:2100` — `padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',`<br>`src/components/Dashboard/DashboardPage.jsx:35` — `style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}`<br>`src/components/SettingsPage.jsx:329` — `<div className="flex-1 flex justify-center py-8 px-8 overflow-auto">   <div className="w-full max-w-2xl">`




**F39 · MEDIUM · Hierarchy** — D.O.G.'s section chrome is a different design language from the rest of the app  
**constraint: touches-preview** · law: Law of Common Region

- Problem: Each section is a stone-800 box with a 2px stone-700 border, a hard 3px offset shadow, a filled stone-700 header bar in orange-400 text, and a numbered orange-500 circle badge. Nothing else in WILSON uses a filled header bar, an offset shadow or a circular number badge. RABBIT, which is the newest tool, uses hairlines and no fill for the same job.

- Why it matters: D.O.G. is the first tool in the list on Home, so it is the first interior most users see, and it is the least current surface in the app.

- Change: Sections become a hairline-topped region with a SectionTitle (16px sentence case weight 600) and an optional 11px Label step number, no fill, no border box, no shadow. The collapse affordance moves to a chevron at the end of the title row. Interactions unchanged.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3854` — `<section className="bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3861` — `<span className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white font-mono text-xs">1</span>`




**F32 · LOW · Build** — Adding a page requires editing three separate lists and the Files page was added to two of them

- Problem: A page must be registered in PAGE_TITLES (App.jsx:96), in PAGE_BARS (pageBars.js:88) and in a hand-maintained eight-way OR chain in renderTopBarContent (App.jsx:1892). Files was added to the first and third and missed the second, which is F05. Nothing fails if a key is missing; it silently falls back to Home's geometry.

- Why it matters: This is the structural reason F05 happened and the reason it will happen again to the next page.

- Change: One PAGES registry: { id, title, subtitle, bars, surface: 'dark' | 'light', chrome: 'tool' | 'page' }. PAGE_TITLES, PAGE_BARS, the OR chain and the nav lists all derive from it, and a missing bars value becomes a build-time failure rather than a silent fallback.

- Evidence: `src/App.jsx:1892` — `if (currentPage === 'settings' || currentPage === 'project-manager' || currentPage === 'rate-card' || currentPage === 'team-members' || currentPage === 'project`<br>`src/App.jsx:96` — `const PAGE_TITLES = { home: 'HOME', dog: 'D.O.G.', ... 'project-files': 'FILES', ... }`




**F37 · LOW · Build** — IconBtn generates a Tailwind class the compiler can never see

- Problem: className is built as w-${size} h-${size} from a runtime prop. Tailwind v4 scans source text, so w-3.5 is never emitted and the class is inert. It happens to work because the same values are also set inline, which means the class is dead code that looks load-bearing and will mislead the next person who tries to change the icon size.

- Why it matters: Small, but it is the kind of thing that makes a rework session distrust the file it is migrating.

- Change: Delete the dynamic class and keep the inline width and height, or switch to a size variant with literal classes.

- Evidence: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:57` — `<Icon className={'w-${size} h-${size}'} style={{ width: '${size * 4}px', height: '${size * 4}px' }} />`




**F38 · LOW · System** — The close dialog is the only surface in the app using 6px and 4px radii and an explicit monospace family  
law: Peak-End Rule

- Problem: It sets borderRadius 6px on the card and 4px on both buttons, and fontFamily 'monospace' on the title and both buttons, in a codebase where 1364 elements use rounded-sm. Its Cancel button is #a8a29e on #44403c, which measures about 3.3:1. It is the last thing a user sees before the app closes, so it is a Peak-End surface rendered in values that exist nowhere else.

- Why it matters: Peak-End Rule: the exit is half of what gets remembered.

- Change: Rebuild on src/ui/Dialog with the standard radius, surface, backdrop and Button variants. Title at the 16px step, sentence case, body at 14px.

- Evidence: `src/App.jsx:2241` — `border: '2px solid #ea580c', borderRadius: '6px', padding: '32px 36px 28px',`<br>`src/App.jsx:2277` — `borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace',`




**F40 · LOW · System** — Hover-revealed row controls exist in six files and nowhere else  
**constraint: touches-interaction** · law: Selective Attention

- Problem: group-hover:opacity-100 appears in ScenesView (4), BudgetView, LevelsView and ExperiencesView (2 each), and once each in D.O.G. and Otter. Everywhere else row actions are always visible, which is what makes the tables look busy. Notion's quiet chrome is almost entirely this one pattern.

- Why it matters: It is the cheapest single move toward the calm Audrey is asking for, and the codebase already knows how to do it.

- Change: One src/ui/HoverActions wrapping a row's action cluster: opacity 0, revealed on row hover and on keyboard focus within, with a fixed-width reserved slot so the row does not reflow when it appears. Apply to every table row and list item that currently shows a persistent action cluster.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3817` — `className="absolute top-2 right-2 p-1 bg-stone-600 hover:bg-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"`




**F41 · LOW · Motion** — transition-all and four duration values are used interchangeably  
**constraint: touches-home** · law: Doherty Threshold

- Problem: transition-all appears on Home's nav buttons with duration-200, which animates layout properties as well as colour. Elsewhere the app uses transition-colors, a 200ms inline opacity transition on the nav strip, 250ms on content fades, 300ms on the nav strip height and the resources column, 400ms on the nav strip height when idle and 600ms when animating, and 0ms with a 300ms delay on the content background swap.

- Why it matters: Motion pass: durations should map to categories (state change, interactive response, view transition), not to whichever number was typed that day. transition-all is also a performance and jank risk on a column that resizes.

- Change: Three tokens: 120ms ease-out for state change, 200ms cubic-bezier(0.2,0,0,1) for interactive response, 240ms for panels and columns. The page transition keeps its own five values untouched. Replace every transition-all with the specific properties.

- Evidence: `src/components/Home.jsx:212` — `className="flex items-center gap-5 pr-8 py-3 transition-all duration-200"`<br>`src/App.jsx:1954` — `transition: 'height ${isAnimating ? '600ms' : '400ms'} ${EASE}',`<br>`src/App.jsx:2049` — `transition: 'background-color 0ms linear ${isCompressed ? '0ms' : '300ms'}',`




**F42 · LOW · Job** — The Files page has two co-equal primary actions and a toolbar that wraps  
law: Fitts's Law

- Problem: The header row is one flex-wrap container holding a title, a project select, two view buttons, a search input, a Refresh button and a count string, with a 12px gap and no grouping. At any window narrower than roughly 1100px it wraps, and the wrap point is unpredictable because the select is minWidth 240 and the input minWidth 220. The page's actual job, choose a project then read its files, is therefore stated by a control sitting in the middle of a row of six.

- Why it matters: Job pass: if the one action is not the most prominent thing, the screen has no hierarchy, only arrangement. Fitts's Law: the project select is the control every visit starts with and it is the same size as Refresh.

- Change: Split into two rows inside one Toolbar. Row one is the project select at 36px as the single primary control, with the count string beside it as 12px Caption. Row two is the filter input, the Table/Columns segmented control and Refresh, right-aligned, all at 28px. No wrapping, one baseline per row, no in-page title (see F13).

- Evidence: `src/components/Resources/ProjectFilesExplorer.jsx:140` — `<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '18px 24px 12px', borderBottom: BORDER }}>`





### Priority order

F01, F02, F03, F04, F05, F06, F33, F07, F08, F34, F15, F18, F14, F09, F10, F22, F21, F20, F11, F12, F13, F42, F26, F25, F23, F29, F16, F17, F19, F24, F27, F28, F30, F40, F39, F32, F41, F38, F31, F36, F35, F37


### Shared-pattern inventory

**Page header / page title** → src/ui/PageHeader: 56px, 24px gutter, title at the 20px step weight 600 sentence case, optional 13px subtitle in the same ink, right-hand actions slot. Driven by the PAGES registry (F32).

- Divergence: Four sizes (18, 20, 24, 24), three cases, three inks, two gutters (16 and 24px). Files renders its title twice.

- Implementations: `src/App.jsx:1831` — `tool bar: logo + text-[24px] bold uppercase tracking-tight + text-orange-200 text-xs subtitle, px-4 pb-3`<br>`src/App.jsx:1895` — `resource bar: text-[20px] bold uppercase tracking-tight, px-6, paddingBottom 12px`<br>`src/components/Resources/ProjectFilesExplorer.jsx:141` — `in-page: text-lg font-bold uppercase tracking-widest, duplicates the bar title`<br>`src/tools/otter_v0.3.1/Otter.jsx:4058` — `in-page: text-2xl font-bold text-orange-400, sentence case`




**Section title** → src/ui/SectionTitle: 16px weight 600 sentence case, no tracking, optional 13px description, optional 11px Label-step eyebrow. Field labels use the separate 11px Label role.

- Divergence: Same nominal role at 9.5, 12 and 14px, with tracking-wide, tracking-wider and tracking-widest, and one version wrapped in a filled bar.

- Implementations: `src/components/SettingsPage.jsx:389` — `text-sm font-bold uppercase tracking-widest text-stone-900 mb-1  (repeated 9 times in this file)`<br>`src/components/HelpPage.jsx:28` — `sectionTitle: 'text-sm font-bold text-stone-900 uppercase tracking-wide mb-3'`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3859` — `font-bold uppercase tracking-wide text-sm, inside a filled stone-700 bar`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:244` — `Field label: text-[9.5px] font-mono uppercase tracking-wider`




**Table (thead, row height, cell padding, alignment)** → src/ui/Table with Th, Td, Row: 36px row, 32px head, 8px 12px cells, hairline dividers, no zebra, one hover fill, one selected fill plus a 2px signal left border, align="right" with tabular-nums for numerics, and a fixed-width sort slot.

- Divergence: 19 tables, 10 header-cell implementations, 5 of them byte-identical copies that have already forked on colour. Row heights, cell padding, sticky behaviour, zebra striping and numeric alignment all differ per table.

- Implementations: `src/components/TeamMembers/TeamMembersPage.jsx:921` — `ThLight: px-3 py-2 text-[10px] bold uppercase tracking-wider, style=LIGHT_TABLE_HEAD_CELL`<br>`src/components/AdminTerminal/UsersSection.jsx:702` — `ThLight: identical markup, style={{ color: LIGHT_INK }}`<br>`src/components/AdminTerminal/LogsSection.jsx:421` — `ThLight: identical markup, style={{ color: LIGHT_INK }}`<br>`src/components/Dashboard/DashboardTasksView.jsx:446` — `ThLight: identical markup plus a width prop, style={{ color: L.label }}`<br>`src/admin/CompaniesSection.jsx:110` — `ThLight: identical markup, style={{ color: '#57534e' }}  <- grey on orange`<br>`src/components/Resources/ProjectFilesExplorer.jsx:219` — `inline th: padding '10px 12px', fontSize 10, color MUTED; body cells '8px 12px'`<br>`src/components/RateCard/RateCardTable.jsx:559` — `const th = { ... }  plus per-column widths and textAlign right on numerics`<br>`src/tools/rabbit_v0.1.0/views/TeamView.jsx:1066` — `function Th({ children })  with a sticky thead and a 1px #44403c row border`<br>`src/tools/rabbit_v0.1.0/components/FileManager.jsx:1194` — `function Th({ children })`<br>`src/tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx:2226` — `function Th({ children, style: extraStyle })`




**Toolbar / control strip above a view** → src/ui/Toolbar: 44px, 24px gutter, hairline bottom, left and right slots, all children 28px so they share one baseline, never wraps.

- Divergence: Three heights, three gutters, two backgrounds, and only one of the three establishes a baseline its controls share.

- Implementations: `src/components/Resources/ProjectFilesExplorer.jsx:140` — `flex, gap 12, flexWrap, padding '18px 24px 12px', 6 heterogeneous controls`<br>`src/tools/rabbit_v0.1.0/Rabbit.jsx:179` — `rightSlot buttons p-1.5 with a 1px #44403c border on #1c1917`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:813` — `selection bar: gap-1.5 px-3 py-1.5 flexWrap on C.deep with a top hairline`




**Buttons (primary / secondary / danger)** → src/ui/Button: variants primary / secondary / ghost / danger, sizes sm 28px and md 36px, one signal fill, one danger, sentence case, weight 600, no tracking.

- Divergence: Nine padding combinations, five type sizes, six orange fills (#ea580c x98, bg-orange-600 x59, bg-orange-500 x48, bg-orange-700 x33, #fb923c x10, #f97316 x4) and nine danger values.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:20` — `Btn: primary | danger | default, px-3 py-1.5 text-[10.5px] or px-2 py-1 text-[10px]`<br>`src/components/SettingsPage.jsx:483` — `px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm`<br>`src/components/SettingsPage.jsx:636` — `px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm`<br>`src/components/Resources/ProjectFilesExplorer.jsx:61` — `btnStyle: padding '6px 12px', fontSize 11, borderRadius 2, transparent fill`<br>`src/tools/otter_v0.3.1/Otter.jsx:5559` — `w-full bg-orange-600 text-white border-2 border-orange-700 py-2 rounded-sm text-sm font-bold`




**Inputs and selects** → src/ui/Input, TextArea, Select: one dark well and one light well, 1px hairline, 4px radius, 28px (sm) and 36px (md), Dense 13px, one focus-visible ring. Keep binUi's Escape-reverts-the-edit behaviour, which is the best input interaction in the app.

- Divergence: Four wells, four border weights (0, 1, 2px), four type sizes, three focus treatments, and a dark well used on a light page. The documented spec (2px #44403c) matches none of them.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:253` — `inputStyle + inputClass: C.panel fill, 1px C.line, px-2 py-1 text-[11.5px] mono, ring-1`<br>`src/components/SettingsPage.jsx:250` — `inputStyle = { backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }`<br>`src/components/Resources/ProjectFilesExplorer.jsx:146` — `backgroundColor '#1c1917', color '#f4a261', border '1px solid #44403c'  (dark well on a light page)`<br>`src/tools/otter_v0.3.1/Otter.jsx:5022` — `bg-stone-800 text-white border-2 border-stone-600 pl-9 pr-3 py-2 text-sm focus:border-orange-500`




**Tabs** → src/ui/Tabs: 14px sentence case, weight 400 inactive / 600 active, one 2px signal underline, no fill, optional group separator for sets above nine.

- Divergence: Four sizes (11, 11, 12, 14), two cases, two accents (#f97316 and #ea580c), three active treatments, one weight nobody else uses.

- Implementations: `src/components/SettingsPage.jsx:337` — `px-5 py-2 text-xs bold uppercase tracking-widest; active = brown fill + white + 2px #f97316`<br>`src/components/Dashboard/DashboardPage.jsx:45` — `px-4 py-2 text-[11px] bold uppercase tracking-wider; active = same fill, different size and tracking`<br>`src/tools/rabbit_v0.1.0/components/ViewTabs.jsx:51` — `px-3 py-2 text-[11px] mono uppercase tracking-wider; active = #ea580c fill + 2px #ea580c border`<br>`src/tools/otter_v0.3.1/Otter.jsx:2960` — `px-4 py-2 text-sm font-medium sentence case; active = orange-400 text + orange-500 border-b-2`




**Chips, badges and status pills** → src/ui/Chip (interactive filter) and src/ui/Badge (inert label) plus one StatusBadge taking a semantic token, so a status colour can never be written inline again.

- Divergence: Sizes 8.5 to 12px; status semantics re-derived inline in at least four places with three greens and a cool grey and a violet that exist nowhere else.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:119` — `Chip: px-2 py-[3px] text-[10px] mono uppercase tracking-wider`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:62` — `MediaTag: text-[8.5px] or text-[9.5px], colour from MEDIA_TYPE_META with a 33-alpha border`<br>`src/tools/rabbit_v0.1.0/components/ProjectContextBar.jsx:68` — `status pill: px-1.5 py-0.5 text-[9px], fill = statusColor, border = the same colour`<br>`src/components/SettingsPage.jsx:418` — `pet state: text-xs uppercase bold with a 6-branch inline colour ternary incl. #6b7280 and #8b5cf6`<br>`src/tools/otter_v0.3.1/Otter.jsx:58` — `NodeTypeBadge over a 15-value cool/warm colour map`




**Dialogs and modals** → src/ui/Dialog, promoted from binUi unchanged: one backdrop rgba(12,10,9,0.6), one surface, 8px radius, one floating shadow, header / body / footer contract.

- Divergence: 66 fixed inset-0 overlays across 36 files, 22 distinct backdrop values, three radii, two shadow languages. Only binUi handles stacking, Escape precedence and busy state.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:198` — `Modal: stack-aware Escape, busy lock, in-footer error, onBeforeClose guard, rgba(12,10,9,0.72)`<br>`src/App.jsx:2232` — `close dialog: rgba(0,0,0,0.6), 6px radius, monospace, 4px button radius`<br>`src/tools/otter_v0.3.1/Otter.jsx:5554` — `bg-black/50, bg-stone-800, border-2 border-stone-600, shadow-[4px_4px_0px...]`




**Empty and loading states** → src/ui/EmptyState (icon 24px, 14px title sentence case, 13px body, action slot) plus a separate src/ui/Loading with table skeleton rows.

- Divergence: 47 empty-state sites, three components with incompatible props, one inline variant, and loading routed through the same component as empty so the two states look identical.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:308` — `EmptyState({ Icon, title, body, children, compact }) -> 12px uppercase title, 11px body`<br>`src/components/AdminTerminal/LogsSection.jsx:412` — `EmptyState({ text }) -> fixed ScrollText icon, text-xs mono italic`<br>`src/components/Resources/ProjectFilesExplorer.jsx:198` — `Empty({ children }) -> padding 48px 24px, fontSize 13, monospace, colour MUTED`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3788` — `inline: text-stone-500 text-xs with a w-10 h-10 stone-700 circular icon badge`




**Toasts and banners** → src/ui/Toast: one anchor bottom centre 24px up, one stack manager, variants info / success / warning / danger. ModelWarningBanner stays a banner but takes the warning token.

- Divergence: Four anchors, four palettes, four type sizes, no stacking, and two of them can overlap.

- Implementations: `src/agent/AgentProvider.jsx:25` — `fixed bottom-24 centre, bg-stone-800, border-orange-500, text-orange-400, text-xs mono`<br>`src/tools/rabbit_v0.1.0/components/UndoToast.jsx:81` — `fixed bottom-6 centre, #292524, shadow-2xl, 2px countdown bar`<br>`src/tools/rabbit_v0.1.0/components/IngestionToast.jsx:48` — `fixed bottom-4 LEFT, #292524, 10px uppercase tracking-widest header`<br>`src/components/ModelWarningBanner.jsx:40` — `full-width banner above the chrome, rgba(180,83,9,0.14), #b45309, fontSize 13`




**Shortcut hints (Kbd)** → src/ui/Kbd at 11px plus src/ui/ShortcutBar at 28px with grouped hints, mounted by every view that registers document-level keys.

- Divergence: Three surfacing strategies (persistent bar, context-menu suffix, dedicated view) and the only good one is the least legible text in the app.

- Implementations: `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:134` — `Kbd: px-1 rounded-sm text-[9px] font-mono leading-[14px], C.muted on C.deep`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:844` — `the only persistent bar: 12 hints, text-[9px], C.dimmer on C.deep (about 2.5:1)`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5191` — `context-menu hints: text-stone-600 text-[10px] on stone-800 (about 1.9:1)`<br>`src/tools/otter_v0.3.1/Otter.jsx:2966` — `a Hotkeys view behind a tab rather than any inline hint`




**Scrollbars** → Two classes in index.css, .wilson-dark-scroll and .wilson-light-scroll, both 8px with a transparent track and a signal-tinted thumb, applied by the shell per page surface. Delete the injected style tag and both inline overrides.

- Divergence: Two global systems fighting on specificity plus two inline overrides in one file. Because all pages are mounted at once, D.O.G.'s stylesheet applies on every page of the app.

- Implementations: `src/index.css:61` — `.wilson-light-scroll: 6px, transparent track, #c2712c thumb, 3px radius, plus a descendant rule`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3701` — `<style> injected globally: 8px, #1c1917 track, #57534e thumb, 4px radius, plus a universal selector`<br>`src/components/HelpPage.jsx:73` — `inline: scrollbarWidth 'thin', scrollbarColor 'rgba(255,255,255,0.2) transparent'`<br>`src/components/HelpPage.jsx:146` — `inline on the same page's content pane: scrollbarColor 'rgba(0,0,0,0.15) transparent'`




**Sidebars and panels** → src/ui/Panel: width tokens 200 / 240 / 300, one hairline, one 32px header at the Label step, no fill. Its surface comes from the raised token, so #1f1c1a and the stone-800 / stone-700 pairing both disappear.

- Divergence: Widths 200, 200, 220, 224, 300; border weights 1px and 2px; four surface tones including a unique #1f1c1a; two header treatments (filled bar and none).

- Implementations: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3736` — `w-56 bg-stone-800 border-r-2 border-stone-700, header is a filled stone-700 bar`<br>`src/tools/otter_v0.3.1/Otter.jsx:3507` — `w-[200px] bg-stone-800 border-r-2 border-stone-600`<br>`src/tools/otter_v0.3.1/Otter.jsx:3717` — `w-[220px] border-r-2 border-stone-600, backgroundColor '#1f1c1a'  (a one-off surface tone)`<br>`src/components/HelpPage.jsx:70` — `width 200px, rgba(120,70,30,0.55), borderRight 1px rgba(0,0,0,0.1)`<br>`src/components/Resources/ProjectFilesExplorer.jsx:313` — `details panel width 300, borderLeft 1px rgba(120,70,30,0.25)`




**Hover-revealed row controls** → src/ui/HoverActions: reserved fixed-width slot, revealed on row hover and on focus-within, one 120ms opacity transition. Adopt across every table row and list item.

- Divergence: Used in 6 files and absent from all 19 tables and every list elsewhere, so most rows carry permanently visible action clusters. No keyboard-focus equivalent, so the controls are unreachable by keyboard.

- Implementations: `src/tools/rabbit_v0.1.0/views/ScenesView.jsx:1` — `group-hover:opacity-100 x4 (also BudgetView x2, LevelsView x2, ExperiencesView x2)`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3817` — `absolute top-2 right-2 ... opacity-0 group-hover:opacity-100 transition-opacity`





### Type inventory (as shipped)

| px | Weight / case / tracking | Role as used | Where (representative) |
|---|---|---|---|
| 6 | 400 | unlabelled micro text | inline `fontSize: '6px'` x1 |
| 7 / 7.5 | 400 and 700 | micro labels, sprite captions | `text-[7px]` x2, `text-[7.5px]` x1, inline `'7px'` x5 |
| 8 | 400 / 700 caps | micro tags | `text-[8px]` x13, inline `'8px'` x3 |
| 8.5 | 700 caps +0.05em mono | MediaTag small | binUi.jsx:68 (x17) |
| 9 | 700 caps +0.1em mono | Kbd, shortcut bar, ProjectContextBar field label + status pill | binUi.jsx:136, BinsView.jsx:844, ProjectContextBar.jsx:60 (x86 + inline x3) |
| 9.5 | 700 caps +0.05em mono | Field label, Menu header, Menu hint, MediaTag | binUi.jsx:175, 184, 244 (x169) |
| 10 | 700 caps +0.05/0.1em | every table header (5 ThLight copies + Files), Chip, Btn small, D.O.G. shortcut suffix, IngestionToast header | CompaniesSection.jsx:113, binUi.jsx:122, ProjectFilesExplorer.jsx:219 (x482 + inline x11) |
| 10.5 | 700 caps +0.05em mono | Btn default, Modal subtitle, Toggle label, selection count | binUi.jsx:32, 223, 330 (x403) |
| 11 | 700 caps +0.05em; also 400 body | Settings buttons, Help list items, ViewTabs, Files buttons + path cell, Otter menu rows | ViewTabs.jsx:51, HelpPage.jsx:32, ProjectFilesExplorer.jsx:63 (x553 + inline x35) |
| 11.5 | 400 mono | binUi TextInput / TextArea / Select, Menu item label | binUi.jsx:179, 254 (x355) |
| 12 (text-xs) | 400 body; 700 caps labels | **the de-facto body size of the app**, plus buttons, chips, EmptyState title, Modal title, close-dialog buttons | HelpPage.jsx:29, SettingsPage.jsx:337, binUi.jsx:222 (x662 + x74 + inline x23) |
| 12.5 | 400 | dense rows | `text-[12.5px]` x70 |
| 13 | 400 | Files table body, Files columns, Files detail values, close-dialog body, ModelWarningBanner | ProjectFilesExplorer.jsx:212, 275, 319; App.jsx:2258 (x16 + inline x39) |
| 13.5 | 400 | dense rows | `text-[13.5px]` x31 |
| 14 (text-sm) | 700 caps +0.1em; also 400/500 | **Settings + Help section titles**, Home nav labels, Files select + input, Otter view tabs (500), Otter dialog body | SettingsPage.jsx:389, Home.jsx:226, Otter.jsx:2960 (x291 + x10 + inline x14) |
| 15 | 400 | one-off | inline x3 |
| 16 (text-base) | 700 caps +0.2em (nav) / bold (close dialog title) | **nav strip items**, close-dialog title | App.jsx:1980, 2021; App.jsx:2249 (x10 + inline x7) |
| 16.8 | 700 caps +0.3em | **the page-transition title** | App.jsx:2073 |
| 17 | 600 | lesson h3 (1.1rem) | index.css:252, inline x2 |
| 18 (text-lg) | 700 caps +0.1em | Files in-page title, Otter dialog title | ProjectFilesExplorer.jsx:141 (x30) |
| 20 (text-xl) | 700 caps -0.025em | **resource-page title in the orange bar** | App.jsx:1896 (x16 + x1 + inline x2) |
| 20.5 | mono +0.15em | boot PASSWORD | AuthShell.jsx:370 |
| 24 (text-2xl) | 700 caps -0.025em (bars) / 700 sentence (Otter) | **tool-page title in the orange bar**, Otter view titles, D.O.G. slide titles | App.jsx:1835, Otter.jsx:4058 (x18 + x3 + inline x1) |
| 30 (text-3xl) | 700 | D.O.G. slide preview titles (out of scope) | LayoutVisualizer.jsx:750 |
| 48 (text-5xl) | 700 | one site | x1 |

**Totals.** 26 distinct sizes, 7 of them half-pixel. About 301 occurrences below 10px. Two weights nominally (400 / 700) but `font-medium` (500) and `font-semibold` (600) also appear, so four. 1,167 uppercase elements. 1,029 tracked elements across 7 Tailwind tracking values and 60 distinct inline `letterSpacing` values (0.02em to 0.4em). `font-mono` x1,917 against `font-sans` x2. No `@font-face` and no `@theme`, so all of it renders in the OS fallback.


### Reviewer's proposed direction (corrected by the critic and the plan; the plan wins where they differ)


#### typefaces

Families: 2. WILSON is an Electron app, so any commercial foundry licence lands in the app/embedded tier, which is almost always a separate and much higher price than desktop or web. Open licence is the correct call here and there are faces that hold up, so this is not a compromise. PRIMARY (recommended): **Geist**, Vercel, SIL OFL, self-hosted woff2. Variable, drawn for product UI, tall x-height, true tabular figures, and it is precisely the register Audrey means by sleek. It ships as a designed superfamily with **Geist Mono**, which the type-systems reference says to prefer where one exists, so metrics and colour match at the same nominal size with no compensation. ALTERNATE if she wants the safest possible Windows rendering rather than character: **Inter** (Rasmus Andersson, SIL OFL) with **JetBrains Mono** (SIL OFL). Inter is the most battle-tested UI face at 13 to 14px on Windows and it is what Notion and Obsidian both use; note honestly that Inter plus JetBrains Mono is not a designed pair, so the mono must be set at 0.94em of its sans step to stop it sitting larger in a table cell. NOT recommended: Space Grotesk (too much character at 13px), Public Sans (institutional), and any Klim, Grilli or Dinamo face unless she wants to pay an embedded-app tier. Fallback stack: `Geist, 'Inter', system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif` and `'Geist Mono', 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace`. THE MONO KEEPS A JOB, and only this job: numerics in tables (sizes, durations, budgets, counts), ids, file paths, timecode, keyboard keys, code blocks and the version footer. It loses labels, headings, buttons, tabs, chips, empty states and body copy. That single rule deletes roughly 1,900 of the 1,917 `font-mono` uses and is the largest part of the contemporary-look fix. Weights: 2 (400 and 600). 700 goes everywhere; at 14px on either face 600 is already emphatic, and 700 plus uppercase plus tracking is the exact combination that reads as a 2003 control panel. 500 goes too. If a third weight feels necessary it is a hierarchy problem, not a weight problem.


#### type scale

Anchor: **14px body**. Ratio **1.125 (major second)**, per type-systems for dense UI with many near-peer levels, with the display step hand-set. I am departing from the reference's 15 to 16px UI band deliberately and it is a decision, not a drift: this is a frameless desktop tool at 100% zoom on Windows with seven-column tables, Apple's desktop body floor is 13px, Notion runs 14 to 16, and the app's current de-facto body is 12px, so 14 is already a 17 percent legibility gain without costing a column. 8 steps, every one a whole pixel, every one with a job.

| Role | px | Derivation | Leading | Tracking | Weight | Case | Used for |
|---|---|---|---|---|---|---|---|
| Display | 34 | hand-set, off scale | 1.0 | +0.12em | 600 | UPPER | the page-transition title only |
| H1 / Page title | 20 | 14 x 1.125^3 = 19.9 | 1.2 | +0.01em | 600 | Sentence | PageHeader title in the orange bar |
| H2 / Section | 16 | 14 x 1.125 = 15.75 | 1.3 | 0 | 600 | Sentence | SectionTitle, Dialog title, EmptyState title |
| H3 / Subsection | 14 | anchor | 1.4 | 0 | 600 | Sentence | card titles, group headings, active tab |
| Body | 14 | anchor | 1.5 | 0 | 400 | Sentence | paragraphs, descriptions, list items, inputs |
| Dense | 13 | hand-set | 1.45 | 0 | 400 | Sentence | table cells, dense lists, tree rows, sidebars |
| Caption | 12 | 14 / 1.125 = 12.4 | 1.4 | 0 | 400 | Sentence | metadata, hints, counts, timestamps, subtitles |
| Label | 11 | 14 / 1.125^2 = 11.1 | 1.3 | +0.06em | 600 | UPPER | table headers, field labels, eyebrows, Kbd, status badges. **The floor. Nothing smaller ships.** |

14 x 1.125^2 = 17.7 is generated and deliberately unused; nothing needs a level between 16 and 20. 13 is hand-set between Body and Caption because a seven-column table at 14px does not hold its measure and 13 is the Apple desktop floor; it is the only non-derived step and it earns its place. Measure: 60 to 66ch, set in ch, capped at 72ch for Help and Settings prose. Leading runs inverse to size as shown. Uppercase appears in exactly two roles, Display and Label, and both carry positive tracking because uppercase without added tracking reads as a bug. Everything else is sentence case with zero tracking.


#### colour

**Inks: 3 (paper, ink, signal). Plus 4 functional values and 2 page-class grounds.** Down from 121 hex values.

| Token | Hex | Job |
|---|---|---|
| `paper` | `#1c1917` | the one dark working surface (unchanged) |
| `paper-raised` | `#232020` | panels, table headers, menus, dialogs. Replaces #292524 and the one-off #1f1c1a |
| `paper-recessed` | `#0c0a09` | footers, shortcut bar, code wells (unchanged) |
| `ink` | `#f5f0ec` at 100 / 72 / 48 percent | ALL text on dark. One ink at three screens replaces #d6d3d1, #a8a29e, #78716c and #57534e, which is 1,277 uses of four unrelated greys collapsed to one |
| `rule` | `rgba(245,240,236,0.14)` on dark, `rgba(28,25,23,0.22)` on light (= existing LIGHT_RULE) | every hairline. Replaces #44403c (772 uses) as a border |
| `signal` | `#ea580c` | the frame, the one primary action, the one active state, the one selection. ONE value. #f97316, #fb923c, #fdba74 and #c2410c are retired from chrome |
| `ink-light` | `#1c1917` (= existing LIGHT_INK) | ALL text on a light surface. One ink; hierarchy from size and weight only |
| `well-light` | `rgba(120,70,30,0.18)` (= existing LIGHT_WELL) | table headers, toolbars, inert chips on light |
| `surface-light-solid` | `#dd9155` (= existing) | opaque floating panels on light |
| success | `#15803d` on light, `#4ade80` on dark | one state, two surfaces. Kills the #15803d / #4ade80 / #86efac / #22c55e spread |
| danger | `#b91c1c` on light, `#fca5a5` on dark | replaces 9 red values |
| warning | `#b45309` on light, `#f59e0b` on dark | replaces amber spread |
| info / neutral | ink at 48 percent | not a colour |

Rules. A new colour is guilty until proven innocent: a screen of an existing ink almost always does the job. No cool hues in chrome (visual-language Composition rule 2), which retires #6b7280 and #8b5cf6 from the pet status ladder; O.T.T.E.R.'s 15-value node ramp is data-categorical and is exempt only if it mirrors the host application's own socket colours (see open questions), otherwise it reduces to 8 generated from one hue rotation plus an "other" bucket. `#f4a261` keeps exactly two jobs no matter which page-class option is chosen: the transition overlay and the light page ground.

**THE ORANGE CHROME (F35, palette-decision).** Keep it. It is the strongest identity WILSON has, and a saturated brand frame around a calm field is what Frame.io and Obsidian both do. Three conditions: the frame carries white or black only, so the `text-orange-200` tool subtitle at about 2.7:1 becomes white and drops rank by size instead of colour; the resource-page bars drop from 200/150 to 120/80, returning roughly 150px of field to the densest pages; and no content-layer element uses `#ea580c` as a fill, so the active RABBIT tab stops borrowing the frame's colour.

**THE LIGHT-ORANGE PAGE CLASS (F36, palette-decision).** It cannot carry a Notion-calm interface and that is structural. `#f4a261` is a saturated mid-tone, so lightSurface's own measurements leave exactly one usable ink, white is 2.06:1, and there is nowhere for a raised surface to go. Nine of twelve pages are this class and they are the ones she calls atrocious. Option A, recommended: keep `#f4a261` for Home, Settings and Help, which are reading and form surfaces where one ink suffices, and move the data pages (Files, Team Members, Rate Card, Admin Terminal, Dashboard tables, Projects) onto the same `paper` the tools use, with the orange frame kept on every page. The split becomes reading pages versus working pages instead of an arbitrary nine versus three, and the ecosystem finally reads as one app. Option B: keep all nine light but change the working ground to a warm near-neutral `#f2ece4` (about L*93) and let `#f4a261` do only the bars and the transition overlay; black, a real secondary ink and a raised card all become available and it lands closest to Notion, at the cost of the orange page identity. Option C: change nothing, accept one-ink hierarchy permanently, and accept the ceiling on how modern the light pages can look. **Audrey's ruling required. Under every option, white-or-black-on-orange is enforced without exception, and the existing `authContrast.test.js` pattern is extended to assert the light tokens so a regression fails a test rather than shipping.**


#### spacing radius border

**Base unit 4px.** Spacing scale: 4, 8, 12, 16, 24, 32, 48. Nothing else, and nothing in vh (App.jsx's `3vh 0` content padding becomes 24px, so the gutter above the content stops changing with window height while the gutter beside it does not). One page gutter: 24px, used by the top bar, the nav strip's right edge and every page's content area, which is what finally makes the strip align with the hamburger that opens it. Two measures: 720px for reading and form pages, full width capped at 1240px for data pages. Pages stop setting their own padding.

**Radius: 2 values.** 4px for controls, inputs, buttons, chips, rows, panels and cards; 8px for floating surfaces only (Dialog, Menu, popover, Toast); `rounded-full` for dots and avatars. Delete 2px (1,364 uses), 3px, 5px, 6px and 10px. This departs from the documented `rounded-sm` convention and from the Swiss default's hard edges, and it is the one recommendation in this review I would call taste rather than error. The argument: at 96dpi a 2px radius on a 1px hairline reads as an aliasing artefact rather than as sharpness, and 4px is the smallest radius that reads as deliberate. Notion, Linear and Frame.io all sit at 4 to 6px. Flagged in the open questions because 'sharp over soft' is Audrey's own written rule.

**Border: one hairline at 1px, everywhere.** Delete `border-2` entirely (53 in D.O.G., 146 in O.T.T.E.R.). A 2px rule against 11px type is about one sixth of the cap height and it is the single measurable reason D.O.G. and O.T.T.E.R. read heavier and older than RABBIT, which already uses 1px in 912 places. Dark hairline is a screen of the ink, not `#44403c`, so panels stop looking like boxes drawn in grey.

**Elevation: one shadow, for floating surfaces only.** `0 8px 24px rgba(0,0,0,0.35)` on dark, `0 8px 24px rgba(60,30,10,0.25)` on light. Docked surfaces get a hairline and nothing else. Delete all 41 hard offset shadows, all 43 soft blur ones, and the status dot's glow.

**Density tokens.** Control heights: 28px (sm, toolbars and dense rows) and 36px (md, primary actions and form fields). Table row 36px, table header 32px, cell padding 8px 12px, toolbar 44px, page header 56px, panel header 32px, shortcut bar 28px. Icon sizes: 14px inside dense controls, 16px in rows and buttons, 24px in empty states. Three sizes, not the current eleven.


#### motion

**The page transition stays exactly as it is**: fade-out 250ms, bars compress 600ms to meet in the middle, title holds 400ms on the #f4a261 overlay, bars expand 600ms, fade-in 250ms, 2100ms total, one TRANSITION constant with its two consumers. Two changes inside it, neither structural. First, the title: 16.8px at 0.3em is a whisper at the app's loudest moment, and 0.3em is wide enough that R.A.B.B.I.T. reads as separated characters rather than a word. Raise it to the 34px Display step, weight 600, tracking 0.12em, keeping the #1c1917 ink on #f4a261 that is already correct at 8.49:1. Second, reduced motion: the transition currently has no fallback at all, and it is the largest-area movement in the app. Under `prefers-reduced-motion: reduce`, skip compress and expand, hold the title 400ms over a still frame, cross-fade the page in 120ms. Read the preference at call time inside navigateTo and playWelcome, the way AuthShell already does, never into a module-level const.

**Three duration tokens for everything else.** State change (hover, focus, toggle, selection) 120ms ease-out. Interactive response (menu, dropdown, tab switch, chip) 200ms cubic-bezier(0.2,0,0,1). Panel and column (nav strip height, resources column, settings slide-out) 240ms cubic-bezier(0.2,0,0,1). Decorative reveals stay above 400ms. Every interactive move sits under 240ms so the interface never feels like it is thinking (Doherty Threshold). This replaces the current spread of 200, 250, 300, 400 and 600ms used interchangeably, and retires `transition-all` in favour of named properties so a resizing column does not animate layout.

**Nav hover.** Keep the resolve-in-one-place model in App.jsx:1681, which correctly fixed a real specificity collision, but move from an opacity value to an explicit colour token. Opacity on white over orange is the thing the colour rule keeps having to carve an exception for; a named hover ink removes the exception.

**Pet animations are untouched** (constraint 5): every otter, egg, ghost, cloud and hunger keyframe in index.css stays exactly as written. Note for the record that none of them are guarded by reduced-motion either, but they are out of scope.


#### implementation mechanism

**Delivery, in the order the work should ship. Each step is independently shippable and each one leaves the app better than it found it.**

The mechanism is three things, not one. (1) An `@theme` block at the top of `src/index.css`. Tailwind v4 reads `@theme` and generates real utilities from it, so `--font-sans`, `--font-mono`, `--text-body`, `--text-label`, `--color-paper`, `--color-ink`, `--color-signal`, `--radius-md`, `--spacing` become `font-sans`, `text-body`, `bg-paper`, `text-ink`, `rounded-md` and so on. This is the only place a hex value is written. (2) `@font-face` declarations for Geist and Geist Mono woff2, self-hosted under `public/fonts/`, never a CDN, because Electron has no network guarantee at boot. `html { font-family: var(--font-sans) }` so the 1,917 `font-mono` classes can be deleted rather than replaced. (3) `src/ui/tokens.js` re-exporting the same values as JS, for the roughly 2,000 inline `style={{}}` sites that cannot take a class. That module is the risk: without a guard it becomes the 122nd source of colour. One test asserts the CSS custom properties and the JS exports agree, in the same spirit as `authContrast.test.js`, so they cannot drift. `src/components/lightSurface.js` is absorbed into `tokens.js` with its existing export names kept as aliases, so all 30 importers keep working through the migration and can be rewritten lazily.

Components live in `src/ui/`, one file plus one test per component, with `binUi.jsx` as the seed: it already contains Btn, IconBtn, Chip, Kbd, Menu, Modal, Field, TextInput, TextArea, Select, EmptyState, Spinner and Toggle, so step 3 below is largely a move and a rename rather than new work.

**Migration order.**
1. **Foundation.** `@theme` + `@font-face` + `html { font-family }` + delete `font-mono` everywhere it is not data. Nothing else changes. This one step alone is the answer to 'the fonts don't look contemporary'.
2. **Type roles.** Map all 26 sizes onto the 8 steps, drop 700 to 600, and convert everything except the Display and Label roles to sentence case. Mechanical, enormous blast radius, zero structural change. Steps 1 and 2 together are the overhaul most people would see.
3. **Primitives.** Lift Button, Input, TextArea, Select, Kbd, Chip, Badge, StatusBadge, StatusDot, EmptyState, Loading, Spinner, Toggle and Field out of binUi into `src/ui/`. Re-point binUi at them so RABBIT's bins keep working unchanged.
4. **Overlays.** Promote Modal to Dialog and Menu as-is; migrate the 66 overlays and 4 toasts. Start with Otter.jsx (9 overlays) and TimelineView / TaskTemplateManager (4 each).
5. **Data surfaces.** Table + Toolbar + PageHeader + SectionTitle. Rebuild in this order: Files first (it is the worst and the loudest complaint), then Team Members / Users / Logs / Companies (they already share LIGHT_TABLE_*, so they converge cheaply and the CompaniesSection grey-on-orange dies with them), then RABBIT's five, then Otter's two.
6. **Consistency layer.** ShortcutBar, HoverActions, Tabs, Panel. This is the step Audrey named explicitly, and it only works once 3 and 5 exist.
7. **Shell.** PAGES registry, PAGE_BARS fix for Files, PageHeader in the orange bar, nav strip grouping and gutter alignment, the SETTINGS / SYSTEM SETTINGS rename, transition title, reduced-motion path, scrollbar consolidation, focus-visible sweep.
8. **Palette ruling.** Execute whichever of F36 options A / B / C Audrey chooses. Last, because it is the only step that needs her decision and because by then every surface is reading its colours from one module, so the change is a token swap rather than a rewrite of nine pages.

**And rewrite `visual-language.md` Composition rule 3 in step 1.** While the doc says 'local tokens, not global', the drift regenerates itself, and the next feature will land with an 81st RABBIT hex and a sixth copy of ThLight.


#### component kit

- PageHeader: 56px, 24px gutter, title at the 20px step (sentence case, 600), optional 13px subtitle, right-hand actions slot. Driven by the PAGES registry so a new page cannot be registered in two of three lists again.

- SectionTitle: 16px sentence case 600, optional 13px description and optional 11px Label eyebrow, hairline above rather than a filled bar or a bordered box.

- Table (+ Th, Td, Row): one 36px row, 32px head, 8px 12px cells, hairline dividers, no zebra, one hover fill and one selected fill plus a 2px signal left border, align="right" with tabular-nums for numerics, fixed-width sort slot so the header label never shifts. Replaces 19 tables and 10 header-cell implementations.

- Toolbar: 44px, 24px gutter, hairline bottom, left and right slots, every child 28px so the row has one baseline, never wraps.

- ShortcutBar: 28px, hairline top, Kbd plus 12px label pairs, groups separated by 24px, mounted by every view that registers document-level keys. This is Audrey's named example, promoted from BinsView and made legible.

- Kbd: 11px mono, 1px hairline, 4px radius, min-width 18px, centred, ink at 72 percent.

- EmptyState: 24px icon, 14px sentence-case title, 13px body, action slot. Never used for a loading state.

- Loading: skeleton rows for tables, a spinner elsewhere, so 'Loading' and 'nothing here' stop looking identical.

- Dialog: promoted from binUi's Modal unchanged (modal stack, topmost-only Escape, busy lock, in-footer error, onBeforeClose guard). One backdrop rgba(12,10,9,0.6), one surface, 8px radius, one shadow, header / body / footer. Replaces 66 overlays.

- Menu: promoted from binUi. One floating surface, header / divider / item / danger-item / hint, viewport clamping already handled.

- Input, TextArea, Select: promoted from binUi, plus a light-surface variant. One well per page class, 1px hairline, 4px radius, sizes 28 and 36, Dense 13px, one focus-visible ring. Keeps binUi's Escape-reverts-the-edit behaviour.

- Button: variants primary / secondary / ghost / danger, sizes sm 28px and md 36px, one padding pair each, sentence case, 600, no tracking. Replaces a nine-cell padding grid and six orange fills.

- Tabs: 14px sentence case, 2px signal underline for active, no fill, optional hairline group separator for sets above nine.

- Chip (interactive filter) and Badge (inert label): 11px Label step, 4px radius, one active treatment.

- StatusBadge: takes a semantic token (active / draft / archived / wrapped / online / offline) and renders dot, fill and label from one source, so a status colour can never be written inline again.

- Toast: one anchor (bottom centre, 24px up), one stack manager, variants info / success / warning / danger. Replaces four systems in four positions.

- Panel / Sidebar: width tokens 200 / 240 / 300, one hairline, 32px header at the Label step, no fill.

- StatusDot: dot plus an accessible label, no glow, no unlabelled colour-only state.

- HoverActions: reserved fixed-width slot, revealed on row hover and focus-within, 120ms opacity. Applied to every table row and list item, not the current six files.

- Field: label plus control with a fixed 4px/16px proximity ratio, promoted from binUi, so a label can never drift away from its input.


### Open questions the reviewer raised

- THE PALETTE RULING (F36). The light-orange #f4a261 working surface allows exactly one ink, which is why every light page has invented a workaround and why Files is unreadable. Option A (recommended): keep #f4a261 for Home, Settings and Help, move the data pages (Files, Team Members, Rate Card, Admin Terminal, Dashboard tables, Projects) onto the same dark stone the tools use, orange frame kept everywhere. Option B: keep all nine light but change their working ground to a warm near-neutral #f2ece4 and let #f4a261 do only the bars and the transition. Option C: change nothing and accept the ceiling. Nothing downstream is blocked by this, but step 8 of the migration cannot start until you rule.

- SENTENCE CASE. Dropping UPPERCASE from section titles, buttons, tabs, chips, table headers, empty states and dialog titles (keeping it only for 11px labels and the transition title) is the single biggest change to how WILSON looks, and it is the change that makes it read like Notion and Apple. Is the all-caps voice part of the brand you want to keep, or is it a habit?

- RADIUS. I am recommending 2px go to 4px, which contradicts your own written rule 'sharp over soft, prefer rounded-sm over rounded-lg'. My argument is that at 96dpi a 2px radius on a 1px hairline reads as an aliasing artefact rather than as sharpness. This is the one recommendation in the review I would call taste rather than error. Your call.

- TYPEFACE. Geist plus Geist Mono (a designed pair, more character, the Vercel/Linear register) or Inter plus JetBrains Mono (safest Windows rendering at 13px, what Notion and Obsidian actually use)? Both are free for an Electron app. Related: are you content for the mono to become data-only (numbers, sizes, durations, paths, keys, code) and disappear from every label, button and heading?

- NAV LABELS. May 'SETTINGS' and 'SYSTEM SETTINGS' be renamed to 'Tool settings' and 'App settings'? It is a copy change, not an interaction change, but it changes words you chose.

- BAR HEIGHTS. May the resource pages drop from 200/150 to 120/80? It returns roughly 150px of vertical field to the densest pages, and it slightly weakens the 'card on a desk' framing you asked for in Phase 4. Separately: should the Files page take the resource geometry (200/150) or the tool geometry (95/8)? Its density argues for the tool bars.

- O.T.T.E.R. NODE COLOURS. The fifteen-value NODE_TYPE_COLORS map includes four blues and cyans, against your own warm-only rule. Do these mirror Blender's or Unreal's own socket colours (in which case they are load-bearing and stay, documented as an exempt data ramp), or were they picked freely (in which case they reduce to eight from one hue rotation plus an 'other' bucket)?

- SHORTCUT BAR SCOPE. Should the bar appear on every view for consistency even where a view has no shortcuts (showing only the global ones), or only where a view registers document-level keys? The first is more uniform, the second is more honest.

- ROW DENSITY. I am proposing one 36px table row app-wide. For the media tables you scan in bulk (Bins, Files, Assets) would you rather have 32px, or a density toggle? A toggle is a new control, so it needs your approval under the no-new-interactions constraint.

- PET POSITION. petBottomOffset derives from PAGE_BARS, so any bar-height change moves the pet. Adding the missing 'project-files' entry alone will move it roughly 150px on that page. Confirm that is wanted rather than a surprise, since the sprites themselves are untouchable.


## Part 3 — Critic (constraints, consistency, arithmetic)


### Ordering recommendation

FIVE DECISIONS BEFORE ANY CODE. None is a code question and each one blocks multiple sessions: (1) the F36 light-page class — Option A/B/C decides nine pages and settles the input well, semantic status on light, and the Dashboard's dark cards; (2) the typeface pair — Geist+Geist Mono or Inter+JetBrains Mono, because it sets the mono size-adjust token that R3's fixed pixel column widths are measured against; (3) the primary-button fill, #c2410c (test-pinned, 5.18:1) or #ea580c (3.56:1 with white), because Button is the first component written; (4) white-or-black on #ea580c below 19px, which corrects F16/D23/O37 before anyone executes them; (5) the standing app-wide permission for the two behaviour changes that ride in on the kit — Dialog bringing Escape/modal-stack to ~60 overlays and the five window.confirm replacements, and HoverActions bringing reveal-on-focus-within. Getting these as one batch costs her ten minutes and saves three sessions of rework.

WAVE 0 — FOUNDATION, one session, nothing visible changes. @theme + @font-face + html font-family + src/ui/tokens.js with the corrected ink ladder (100/72/52) and the F36-conditional light values; absorb lightSurface.js keeping its export names as aliases; build the kit by promoting binUi (Btn, IconBtn, Chip, Kbd, Menu, Modal, Field, Input, TextArea, Select, EmptyState, Spinner, Toggle) and adding Table, Toolbar, Tabs, PageHeader, SectionTitle, StatusBadge, Loading, ShortcutBar, HoverActions, Panel, Dialog, Drawer, Banner, Toast, Stat; decide the Table DOM strategy in its header comment; add the PAGES registry and the one-line 'project-files': bars(200,150) fix; move the scrollbar CSS out of D.O.G. into .wilson-dark-scroll/.wilson-light-scroll and apply it per surface IN THE SAME COMMIT (four O.T.T.E.R. surfaces depend on .settings-scrollbar, which is defined inside D.O.G. — deleting it alone un-styles them with no error); add the global :focus-visible rule; delete IntakePrepare's private Century Gothic stack and AuthShell's Apple-first stack BEFORE the global face lands, or the app ships three faces; extend the contrast test with the failing controls; rewrite visual-language.md Composition rule 3. Nothing else may start until this compiles.

WAVE 1 — THE MECHANICAL TYPE PASS, app-wide, one session per tool but all in the same window. Map 26 sizes onto 8 steps, delete font-mono where it is not data (classes AND the inline fontFamily spelling), sentence-case everything except Display and Label, 700→600, one hairline at 1px, two radii, one gutter. No component adoption, no structural change — a pure token diff, reviewable as one. This is the step Audrey will recognise as 'the overhaul'. Ship it before anything structural so that if the budget runs out, the visible win is already banked.

WAVE 2 — MUST RUN ALONE, in this order, because each is a prerequisite for the next: (a) the state-extraction pre-step per file (inline hover/selected/disabled → data attributes + CSS), which is what makes everything after it stick; (b) writeGate.test.js loosening BEFORE TimelineView's JSX is touched — it locates three components' closing tags by searching for the literal string '\\n      />' with six spaces of indent (verified), so any reformat of DetailZoomToolbar, DetailPane or OverviewPane fails a green test; prove the loosened test by breaking it; (c) the four source-text wiring tests (localDemoWiring, localMediaWiring, workspaceRootWiring, userStateWiring) read SettingsPage.jsx and StorageConnections.jsx as strings and assert exact copy, a data attribute, a GatedAction COUNT and a component ORDER — read them before the Settings extraction, update them in the same commit; (d) storage/thumbnails.test.js counts an exact substring in FileManager.jsx twice, so the Assets/Files wave must read it first.

WAVE 3 — CAN RUN IN TANDEM, four independent lanes once Wave 0 and 1 are in and Wave 2's guards are loosened: LANE A the dark tools (D.O.G. 3 sessions, O.T.T.E.R. 4) — these share only the scrollbar fix and the hover:bg-stone-750 dead class, which Wave 0 already handled across all 18 occurrences; LANE B R.A.B.B.I.T. (p1 4, Timeline 3, Budget/Scenes 4, Assets/Files 4, Bins 3) — internally sequential, and Timeline Session 2 is the highest-risk single session in the plan; LANE C the light pages (Resources 3, Dashboard 2, Settings 3, Admin Terminal 3) — blocked on F36 and interlocked through lightSurface and the five ThLights, so run them near each other; LANE D auth/onboarding/Help (3) — the most isolated work in the report and the best candidate to run first if a lane frees up.

CO-ORDINATION POINTS THAT WILL BITE IF IGNORED: ProjectFilesTable.jsx is rendered by IntakePrepare, Summary, ProjectFilesSection AND the Resources Files page — it belongs to two lanes and its warm variant is blocked on F36. ProjectFilesExplorer, FileManager, BinFileTable and ProjectFilesTable are four implementations of one file table across three lanes; convert them in one wave or Audrey will still be comparing three. ScenesView imports ShotTakeChips/ShotTakesPanel/TakePickerDialog from bins, so binUi's visual contract change lands on Scenes without Scenes being edited. App.jsx's three tool-header blocks are byte-identical, so the subtitle fix touches all three tools at once and belongs to the shell, not to a tool lane.

WAVE 4 — LAST, ALONE: execute the F36 option. Last because by then every surface reads colour from one module, so it is a token swap rather than a rewrite of nine pages — which is the whole argument for doing Wave 0 first.

INDEPENDENT OF EVERYTHING: the D.O.G. scrollbar extraction (must be Wave 0), the PAGE_BARS one-liner, AT-01's 1.00:1 menu hint, R4-26's empty nested panel, the dead hover on every Bins button, and the never-rendered RelationBadge. These are defects, not design; ship them as small commits whenever, and do not let them wait on a design ruling.


### Contradictions between reviews, resolved

- **System review colour table ('ink #f5f0ec at 100 / 72 / 48 percent') + O6, D9, R3-13, R4, AT-13 which all adopt '48 percent' verbatim — vs Bins B04**: I recomputed the proposed token. #f5f0ec at 48% flattened over #1c1917 = #84807d, which is 4.47:1 — three hundredths under AA. The Bins reviewer caught this independently and specified 52% (= #8d8986, 5.04:1). Every other review adopted 48% without measuring, so the system's own token ships a failing text value into six surfaces. O6 even states '48 (which measures around 4.3:1, a real improvement)' — it is an improvement over 3.65:1 but it is still a fail.
  → Adopt B04's number. The ink ladder is 100 / 72 / 52 percent (#f5f0ec, #b8b4b0, #8d8986 = 15.45 / 8.49 / 5.04 on #1c1917). Write the three flattened hexes into tokens.js so nobody re-derives them, and assert all three in the authContrast.test.js pattern. Change the system review's table before any surface session starts, or the wrong number is copied nine times.

- **F16, D23, O37 ('the tool subtitle becomes white and drops rank by size') vs constraint 6 read together with the actual arithmetic vs TL-12 (which independently chose black)**: Measured: pure white on #ea580c is 3.56:1; #fff7ed is 3.35:1; #1c1917 is 4.91:1. The current text-orange-200 subtitle is 2.63:1, so these three reviews are right that it is broken — but their fix, white at the 13px step, is 3.56:1 and still fails AA for body text. It satisfies the LETTER of 'white or black only' while failing the reason the rule exists. The 24px/20px bold TITLES are fine in white (large-text threshold is 3:1); the 13px subtitle is not. TL-12 reached the opposite conclusion for the Timeline primary button and is the only review that got it right.
  → One rule for #ea580c, written into the token module and tested: white is permitted only at ≥19px bold (the page titles and the tool wordmarks); everything smaller on orange is #1c1917. So the tool subtitle goes BLACK at 13px (4.91:1), not white. Same rule retires TL-12's 3.35:1 button label. Audrey needs to see this before the shell session, because black-on-orange subtitles look different from what those three reviews described to her.

- **System review functional-colour table ('success #15803d on light', 'danger #b91c1c on light', 'warning #b45309 on light') vs F-R19 and AT-06, which say colour-coded status cannot work on this ground at all**: Measured on #f4a261: #15803d = 2.43:1, #b91c1c = 3.14:1, #b45309 = 1.41:1 on the #ea580c frame. The system review's 'on light' column was written for a generic light surface, not for WILSON's actual light ground. R3-11, R4-15, R07, D3 and S9 all consume that column. F-R19 and AT-06 independently refused it and said one ink plus an icon. The two camps cannot both be built.
  → F-R19/AT-06 are correct for the CURRENT ground. Make the 'on light' column conditional on the F36 ruling: under Option A (data pages move to #1c1917) the dark values apply and the problem disappears; under B (#f2ece4, L*93) the proposed light values all pass; under C the light pages get ONE ink and status is carried by a dot plus the written word, never by text colour. Do not build StatusBadge's light variant until she rules.

- **AUTH-08 / authContrast.test.js (primary button = #c2410c, white at 5.18:1, test-pinned, with Audrey's words in the test) vs system F33 and B05 (primary = #ea580c)**: Two incompatible primary-button fills. White on #ea580c is 3.56:1 and fails; white on #c2410c is 5.18:1 and passes. B05 tries to rescue #ea580c by switching the label to black, which contradicts the auth kit that already works. Three reviews will write three different Button components.
  → Keep #c2410c as the single filled-primary token app-wide with white text, and keep #ea580c for the frame, the active state and the selection. Two orange values with two named jobs is a system; an exception carved for auth is not. This is the smallest change that satisfies the existing test, the contrast floor and the one-signal rule at once — but it is Audrey's call, so put it to her with both measured numbers.

- **TL-25 ('drop rounded-full from the toggle track — the documented composition rule is that WILSON avoids pill radii') vs R34 ('I would keep the pill and standardise it as the single Switch component') vs D26 ('one Toggle at 40x22 with a white knob')**: Three reviews, three switch shapes: no pill, pill, and a 40x22 pill. There are at least six hand-rolled toggles across D.O.G., O.T.T.E.R., Timeline, Summary and Settings, and they will not converge if the kit does not pick one.
  → R34's reasoning wins on Jakob's Law: a switch that does not read as a switch is a usability cost, not a taste win. One Switch, pill track, 36x20, knob #1c1917 on the signal track (per TL-25's correct contrast point — the current stone-500 knob on orange is 1.71:1) and paper-raised on the inert track. Record it as a deliberate exception to 'sharp over soft' in the rewritten visual-language doc, alongside the 4px radius decision the system review already flags as taste.

- **R3-06 ('Card title becomes the 16px H2 step') vs R4-14 and AT-14 ('One Card with one title slot at the 14px H3 step')**: Card titles land at 16 in one review and 14 in two others. Both cite the same eight-step scale. On surfaces where a card sits inside a section (Admin Terminal, Storage, Summary) a 16px card title collides with the 16px section title above it, which is precisely the hierarchy failure R3-06 is trying to fix.
  → 16 = SectionTitle (a region heading, hairline above). 14 = Card title (an object heading inside a region). R3-06 has conflated the two roles; its underlying complaint (labels physically smaller than their values) is fixed by the Label/Dense pairing, not by promoting card titles. Write both roles into the kit with their own component so the distinction cannot be re-argued per surface.

- **D5 (dialog widths 480 / 720 / 960) vs O27 (400 / 560 / 900) vs R11, TL-11, AT-16, B21, R4-12 (no widths named)**: Two reviews propose three-token width scales and the tokens disagree on all three values. Everything else defers. Whoever writes Dialog first sets it and the other tool's dialogs get resized by a session that thought it was only changing radius.
  → One scale, four tokens, in the kit: 400 confirm, 560 form, 720 reading, 960 workbench. That is a superset of both proposals and it covers D.O.G.'s duplicate resolver (needs the widest) and O.T.T.E.R.'s five confirms (need the narrowest). Nothing else may be written.

- **O25 ('drop the uppercase and tracking from the labels once the Label role is the only uppercase role, since these are field names, not eyebrows') vs the system review's Label role, which explicitly lists 'field labels' as an uppercase +0.06em role, and vs F-R17, S1, AT-08, R4-02, B03 which all put field labels in the uppercase Label step**: Direct disagreement on whether a form field label is a Label. One reviewer says field names should be sentence case; six say uppercase 11px. O.T.T.E.R. would end up the only tool with sentence-case field labels.
  → The system review's definition stands — field label IS the Label role, 11px/600/UPPER/+0.06em — because it is the only way the role stays countable and greppable. O25's real complaint (seven labels in two sizes with two different label-to-control gaps) is fully answered by the Field component and does not need a case change. Drop the case half of O25, keep the gap half.

- **R15 ('promote the Bins footer to a SHELL-level StatusBar mounted by Rabbit.jsx for all eleven views') vs TL-28, B14, O10, D6, R4-14, F-R24, AT-23, D34 (each view mounts its own ShortcutBar)**: Ownership conflict, not a size conflict — everyone agrees on 28px. If the shell owns it, per-view keys need a registration channel that nobody specified; if each view owns it, R15's adapter dot and presence pill have no home and the bar's left edge will differ per view. R15 also wants the Tasks metric tiles moved into it, which no other review anticipated.
  → Shell owns the BAR, views register their CONTENTS. One component mounted once per tool shell with three slots: left (shell-owned status: adapter dot, presence), centre (view-registered Kbd hints), right (view-registered count). A view pushes its hints through context on mount. That satisfies both and it is the only shape that lets Bins keep its twelve hints while Timeline shows six.

- **The mono-sizing rule: system review says a non-designed pair (Inter + JetBrains Mono) needs the mono set at 0.94em — vs R3-02, which hard-codes 'set at 0.94em of its sans step' as an unconditional instruction**: R3-02 bakes in a compensation that is only correct for the ALTERNATE font choice. If Audrey takes the recommended Geist + Geist Mono (a designed superfamily, metric-matched), 0.94em makes every numeric in the budget tables render a half-step small.
  → Make the compensation a single token (--mono-size-adjust) set once when the face is chosen: 1.0 for Geist Mono, 0.94 for JetBrains Mono. No surface session writes an em multiplier. This must be settled in the foundation session, before R3's money tables are touched, because R3's fixed pixel column widths are measured against whatever the numeric face turns out to be.

- **F05 ('project-files: bars(200, 150), or bars(95, 8) if Files is treated as a tool-class surface') vs F-R04 ('add bars(200,150) then move all six Resources rows to bars(120, 80)') vs F35 (resource bars 200/150 → 120/80) vs pageBars.js, where help is already bars(140, 100)**: Three different answers for the Files page's chrome, and none of the reviews noticed that Help already sits at 140/100 — so 'the resource-page class is 200/150' is false for one of its six members, and 'move all six to 120/80' would silently change Help too.
  → One line now: add 'project-files': bars(200, 150) so the page stops rendering in Home's 268/268 chrome (verified: it is in PAGE_TITLES at App.jsx:105, the nav list at 1729 and the OR chain at 1892, and absent from PAGE_BARS). The 120/80 question is a separate palette-decision for Audrey covering all SEVEN light pages including Help, taken once in the shell session, because it changes the card-on-a-desk framing she chose.

- **Table DOM strategy: F06/R13/R4-01/F-R07 all say 'one shared Table', while the surfaces they cover are split between real <table> with sticky thead (TeamMembers, Files, Logs, Users, Dashboard, RateCard, ClientView) and flex/grid fake tables (Tasks, Timeline, ProjectFilesTable, BinFileTable, Assets)**: Nobody named which DOM the shared component uses. The Dashboard review is the only one that raises it and it raises it as an open question. The choice is not cosmetic: sticky headers, column widths, and R06's transparent-sticky-thead bug behave differently in each, and Timeline's rows must span a label column and a virtualised chart half.
  → Real <table> with table-layout: fixed for every tabular surface, because it is the only one that gives header/cell alignment for free (F-R09, R05, AT-18, R4-42 are all the same bug in the flex variants) and it fixes R06's sticky header in one place. Timeline is the documented exception and keeps its flex geometry, consuming only the Table's TOKENS (36px row, 32px head, 8px/12px cells, one hairline). Decide this in the foundation session and write it into the component's header comment.


### Findings that touch a constraint

- System F22 — (2) the page transition stays → **keep-but-ask-audrey** — Adding a prefers-reduced-motion path means the transition she chose does NOT play for a user with that OS setting. It never fires for her unless she turns it on, and the review is right that 2100ms of full-screen movement with no fallback is the largest unguarded motion in the app. Ask as a yes/no with that framing. F23/AUTH-18 (title to the 34px Display step) is inside the constraint — type is visual and every duration is untouched — and should ship regardless.

- O.T.T.E.R., Admin Terminal, Bins, RABBIT p1, Dashboard O29, AT-25, B22, R39, D28 — (5) pets untouchable (pet keyframes in index.css) → **reframe-as-visual-only** — O29 asks for a blanket 'animation: none on spin and pulse, transition-duration 0.01ms on everything' in index.css. index.css is where the otter, egg, ghost, cloud and hunger keyframes live, so a universal rule changes pet animation under reduced motion — outside the constraint, and nobody flagged it. Reframe: the reduced-motion block targets named component classes and a .wilson-motion scope, and explicitly excludes the pet selectors. Add a failing control to a test: a pet keyframe class must NOT be matched by the reduced-motion rule.

- System F21 — (4) D.O.G. LayoutVisualizer.jsx / VideoThumbnail.jsx untouchable → **reframe-as-visual-only** — 'Delete border-2 entirely (53 in D.O.G.)' — measured: 41 in DeckOutlineGenerator.jsx, 12 in the two modals, and the remainder inside LayoutVisualizer.jsx, which is untouchable. Reframe the instruction as 'delete border-2 from every D.O.G. file EXCEPT LayoutVisualizer.jsx and VideoThumbnail.jsx', and accept that the slide preview keeps 2px edges. D.O.G.'s own review already knows this (its risk 3); the system-level instruction does not.

- Timeline TL-32 — (1) no interaction or view changes → **drop** — Replacing <input type="color" > with six fixed swatches removes the ability to pick an arbitrary milestone colour. That is a functional regression dressed as a visual fix, and existing milestones already hold arbitrary hexes. Keep the native picker; restyle only its 32px shell and label. The five window.confirm() replacements in the same finding are fine and should be split out.

- RABBIT p1 (TaskDetailPopup) R17 — (1) no interaction or view changes → **reframe-as-visual-only** — 'Delete the Title field from the properties grid and make the header instance the editable one' removes a control and moves an edit affordance. Reframe: keep both, and fix the actual complaint — the header title becomes the dialog's 16px H2 in full ink and read-only WEIGHT, while the grid field keeps 14px/400. The duplication stops reading as duplication because the two instances stop being the same typographic object.

- RABBIT p1 (TeamView) R12 — (1) tables stay tables, same views → **keep-but-ask-audrey** — This replaces the cloud-mode roster PANEL with a table. That is a view change, and it is the single riskiest item in the whole plan (permission-conditional rendering in both adapter branches). The review correctly isolates it in its own session. Put it to Audrey as an explicit exception request; if she says no, the visual-only version is: the roster panel keeps its shape and adopts the Row, StatusBadge, Button and Avatar tokens so the two branches stop looking like two products.

- RABBIT p1 (Tasks) R43 — (1) no view changes → **reframe-as-visual-only** — Moving the four metric tiles into the StatusBar removes them from the content area. Reframe: keep the tiles where they are, rebuild them on the shared Stat component at a uniform 64px with value-first orientation (R19), which already returns most of the vertical space the finding was chasing.

- Assets, Settings, Admin Storage, Budget, D.O.G., O.T.T.E.R. R4-37, R4-38, S14, AT-20, R3-16 (disclosure half), D24, O-quiz, O-settings, D.O.G. settings, TL-08 — (1) no interaction changes → **reframe-as-visual-only** — Every Hick's-law recommendation that says 'collapse behind a View popover', 'put it under a More details disclosure', 'default the subject lists collapsed', 'fold these into a New menu', or 'move it behind an overflow control' adds a click and changes what is reachable at a glance. The visual-only version of all of them is the SAME grouping expressed without hiding: an 11px Label eyebrow per group, a hairline above, 24px between groups against 8px within, and one filled primary per region. That is 80 percent of the measured decision-cost reduction at zero interaction risk. Bank the disclosure versions as a second, separately-authorised pass.

- O.T.T.E.R. sidebar chips, Bins context menu, Bins selection bar O19, B16, B25 — (1) no interaction changes → **reframe-as-visual-only** — O19 moves two of seven filter chips behind an overflow; B16 turns 'Move to'/'Copy to' into submenus; B25 collapses nine colour dots into a popover. All three hide currently-visible controls. Reframe: keep every chip and every item visible, raise the type to the 11px floor (O19's real defect is 9px, not the count), and do the grouping with eyebrows and 24px gaps. B16's colour-row-instead-of-nine-rows is the one exception worth keeping — it is a layout change, not a disclosure, and every colour stays visible.

- O.T.T.E.R. generation progress O16 — (1) no view changes → **keep-but-ask-audrey** — Dropping the fabricated percentage removes information the user currently sees, even though that information is a lie (a hard-coded ladder keyed off elapsed seconds). The honest reframe is the one the finding already gives — keep the phase string and the elapsed timer, make the bar indeterminate — but it is her call whether a fake number is better than no number.

- Budget Crew/Talent R3-05 — (1) same views → **keep-but-ask-audrey** — Reordering Variance and Actual is a change to a way of viewing a financial table, and reverting it later means touching four row types in two files. The review flags it correctly. Get the ruling BEFORE Session C opens; if it is a no, the visual-only half (right-alignment, tabular figures, one header ink) still fixes most of the readability complaint.

- Timeline minimap and rows TL-17, TL-39 — (1) no view changes → **keep-but-ask-audrey** — TL-17 changes what the minimap shows (it currently truncates silently after six phases — a real defect, but fixing it changes the picture). TL-39 fixes the row height across zooms, which changes what the zoom control does to the left column. Both are defensible as bug fixes rather than redesigns; both need her yes and a visual check at all four zoom levels.

- D.O.G. D12, D25 — (1) no interaction changes → **keep-but-ask-audrey** — D12 pins the textarea height, changing how much text is visible at rest. D25 halves a 500ms hover-intent delay and deletes its 'Hold...' label. Both are correctly self-flagged. The visual-only half of D12 ships now: move Generate out of the reflow path into a fixed 44px action row and change transition-all to transition-[height], so the button stops moving even if the grow stays.

- D.O.G. sidebar, Assets, app-wide HoverActions D17, R4-34, F40, O20, R3-24 — (1) no interaction changes → **reframe-as-visual-only** — HoverActions adds reveal-on-focus-within, which is new keyboard behaviour (purely additive, and it fixes a real keyboard dead end). D17 additionally moves a timestamp to a different line. Reframe: ship the reserved fixed-width slot and the 120ms opacity everywhere as pure layout; ship the focus-within reveal as one explicitly-named additive accessibility item Audrey approves once for the whole app rather than per surface; hold D17's timestamp relocation.

- every surface F07, O27, R11, TL-11, AT-16, B21, R4-12, D5, D30, S25, S42 — (1) no interaction changes → **keep-but-ask-audrey** — Promoting binUi's Modal to Dialog brings Escape-to-close, a modal stack and a busy lock to roughly sixty overlays that do not have them, and replaces four window.confirm() calls and five unguarded confirms. That is behaviour arriving as a side effect of a visual unification. It is almost certainly what she wants, but it must be asked once, app-wide, and named as such — not discovered mid-session. O27 is the only review that flags it; the other ten treat it as free.

- VideoPreview R4-36 — (1) no interaction changes → **drop** — Removing autoPlay changes what happens when a user opens a video. Out of scope for a visual pass; record it in docs/OUTSTANDING.md. The reduced-motion half of the finding stays.

- Bins toolbar B29 — (1) no interaction changes → **reframe-as-visual-only** — Turning the continuous tile-size range into three discrete buttons changes the control. The review is right that a native range cannot be made to match a 28px toolbar row. Reframe: wrap the existing range in a 28px shell and style track and thumb explicitly. Keep the discrete-steps version as a flagged proposal.

- Home HOME-02 — (3) Home: fonts only → **keep-but-ask-audrey** — This changes Home's hover COLOUR, not its fonts. It matters because HOME-01 makes it worse: white on the measured hover fill (#ba7a46) is 3.52:1, which fails for 14px bold today and still fails at 16px/600. So the fonts-only change lands on top of an existing contrast failure. Present both together: either the hover label goes to #1c1917 (4.96:1 on that fill, keeps the page to one ink) or HIGHLIGHT_BG darkens. Do not pick one silently.

- Home + nav strip F17 — (3) Home: fonts only → **keep-but-ask-audrey** — Extracting one NAV_DESTINATIONS array is a structural change to Home even though its visible effect is typographic. The fonts-only version is HOME-01 alone (16px, weight 600, sentence case, one ink) applied to Home's own strings. Take the shared-array refactor in the shell session, where the nav strip is being touched anyway, and leave Home consuming it without otherwise changing.

- System Settings pet card S6, S11, S34 — (5) pets untouchable → **keep-but-ask-audrey** — These are flagged touches-pets but they are SettingsPage chrome — the pet's name label, its two numeric readouts, its progress-bar duration and its status-word colour ladder. PetCompanion.jsx, sprites/ and the pet keyframes are not touched. The constraint almost certainly does not reach them (S6 fixes a 2.10:1 label), but the reviewer was right to ask rather than assume. Confirm the boundary once and it unblocks all three.

- System / RABBIT F06, F08, F29, F40, R4-24 — (1) no interaction changes → **reframe-as-visual-only** — These carry constraint_risk: touches-interaction but their described changes are purely visual — a fixed-width sort slot, an underline instead of a fill, an icon that appears only on the active tab, a reserved action slot. The mislabelling is not harmless: it will send genuinely-safe work into the ask-Audrey queue and dilute the items that really do need her. Re-classify them as none before the plan goes to her, so the ask list is short enough to be read.

- Bins shell / System motion B06, F41 — (3) Home: fonts only → **reframe-as-visual-only** — Both are tagged touches-home and neither touches Home — B06 is about ViewTabs and ProjectContextBar inside R.A.B.B.I.T., F41 is about transition-all in App.jsx and elsewhere. Same re-classification point as above.

- System F35 (condition two) — (2)/(owner's framing) → **keep-but-ask-audrey** — Dropping the resource bars from 200/150 to 120/80 changes the card-on-a-desk proportion Audrey deliberately chose, on seven pages at once, and Help is already at 140/100 so 'the resource class' is not uniform. The review flags it. Show her a before/after of one page at both heights rather than describing it.


### Missing coverage

- TitleBar.jsx — the Electron custom title bar. Nobody reviewed it, yet three reviews hand-compensate for its 32px inset (Otter settings panel paddingTop, TimelineView SettingsPanel, EditHistoryDrawer which omits it and slides UNDER the bar, TL-24). It is the only chrome above the orange bar, it is on every screen, and it is the one surface whose height every drawer in the app has to know about.

- src/admin/ — the whole operator console (OperatorApp, CompaniesSection, AuditSection, ModelsSection). Only OperatorLogin got a passing mention (AUTH-19). CompaniesSection carries the FIFTH copy of ThLight (verified) and the system review names its grey-on-orange defect by name, but no session owns the file. Either scope it or state explicitly that the operator console is out of scope for this overhaul.

- The agent surface — src/agent/AgentProvider.jsx has its own toast, and the agent skills/scope UI in Settings was reviewed only as a Hick's hotspot. The agent panel itself (wherever it renders) was never reviewed, and it is a fifth toast system that the 'four toast systems' count missed.

- MigrationPanel.jsx and OtterMigrationPanel.jsx — listed in the Settings scope as things to collapse behind a disclosure, never actually reviewed. Both contain tables.

- TaskTemplateManager.jsx — cited in F07 as a four-overlay file and it contains a <table>, but no surface review covers it. Same for RateCard's ImportPreviewModal.jsx (another table) and the RateCard importers generally.

- DISABLED STATE. Not one review defines a disabled token. Six reviews independently note the spread (opacity-30 / -40 / -50 / disabled:opacity-40 / cursor-not-allowed / ink-at-48) and TaskRow carries a comment saying an inline cursor beats Tailwind's disabled: variant. The kit needs one disabled contract (opacity or ink screen, never both; who owns the cursor) or every component will invent one.

- TOOLTIPS. Roughly a hundred title attributes carry real information (D.O.G.'s twelve icon-only buttons, Timeline's seven drag gestures, every IconBtn). D29 and AT-21 only ask for aria-label. No review proposes a tooltip component or a rule for when a title is sufficient, so the OS tooltip stays the app's only explanatory surface.

- PLACEHOLDER, CARET and SELECTION colours. binUi sets placeholder:text-stone-600 once; nothing else does, and AuthPasswordInput sets caretColor explicitly for alignment reasons. No ::selection rule exists anywhere. On the light-orange pages the browser default selection will fight whatever palette is chosen.

- The error boundary / crash screen, if one exists. Nothing in any review mentions what the app looks like when a render throws.

- Print and export surfaces beyond R3-27. ClientViewTab's Courier New print stylesheet was found; nobody checked whether any other export path (CSV headers, the D.O.G. markdown export, the workspace takeout) produces user-visible formatting.

- HELP's bar geometry. Help sits at bars(140, 100) — verified — while every other resource page is 200/150. F35's 'resource-page bars drop from 200/150 to 120/80' silently excludes or silently changes Help depending on how it is read, and no review noticed the outlier.

- The MINIMUM WINDOW at 700px. Only AUTH-16 tests a surface against it. Every density and type increase in this plan makes tall content taller, and at least four surfaces (Settings tabs, TaskDetailPopup, TaskEditor, the S3 bucket card) are already near their vertical budget.

- Window/page ZOOM and high-DPI. The radius argument ('2px at 96dpi reads as an aliasing artefact') is made at one DPI only, and WILSON ships on Windows laptops at 125 and 150 percent scaling.

- What the app looks like MID-MIGRATION. Every review assumes its surface converts in one go, but steps 1-2 (font + type scale) land app-wide while steps 3-7 land per surface. Nobody described the intermediate state — a 14px sans body next to an unconverted 11.5px mono table — or said whether that is acceptable to ship or must be held on a branch.

- SCROLLBARS on the light pages after D.O.G.'s injected sheet is deleted. F19/D2/O13 all say move it to .wilson-dark-scroll, and O.T.T.E.R. has four surfaces depending on .settings-scrollbar which is DEFINED INSIDE D.O.G. (verified). But nobody enumerated which of the ~40 scroll containers app-wide currently get styling only because that global sheet exists. Deleting it un-styles all of them at once.


### Unsupported or corrected claims (spot-checked in the source)

- O.T.T.E.R. O5: Title claims 'h3 is nearly twice as loud as h1'. I opened src/index.css:250-252: h1 is 1.5rem/700/#f97316, h2 1.25rem/700/#fb923c, h3 1.1rem/600/#fdba74. The SIZE hierarchy is correct and monotonic — h3 is 73 percent of h1, not double. What actually inverts is the INK: the ramp brightens as the size drops, so the smallest heading has the highest contrast on dark. The recommended fix (one ink for all headings, rank from size and weight) is right; the headline claim is not what the evidence shows and will be contradicted by the first person who opens the file.

- System, D.O.G., O.T.T.E.R. F16 / D23 / O37: All three assert the fix is 'subtitle becomes white and drops rank by size'. No review measured it. Recomputed: pure white on #ea580c is 3.56:1, #fff7ed is 3.35:1. At the proposed 13px step that is below the 4.5:1 body floor — the recommendation replaces a 2.63:1 failure with a 3.56:1 failure. It is also the recommendation most likely to be executed first, because it is a one-line change repeated in three byte-identical blocks in App.jsx.

- System System review, colour table rows 'success', 'danger', 'warning': The table gives '#15803d on light', '#b91c1c on light', '#b45309 on light' with no measurement. On WILSON's actual light ground (#f4a261): #15803d = 2.43:1, #b91c1c = 3.14:1. Both fail. The 'on dark' values are fine. Five surface reviews consume this table (R3-11, R4-15, R07, D3, S9) and will build a StatusBadge whose light variant is illegible.

- System System review, 'ink #f5f0ec at 100 / 72 / 48 percent': 48 percent flattens to #84807d on #1c1917 = 4.47:1, below AA. Presented as the replacement for 1,277 uses of four greys, so it is the single most-copied number in the plan. B04 measured it and corrected to 52 percent; no other review checked.

- System, Resources F09 / F-R03: F09 says the Files table's brown is '3:1'; F-R03 says 'MUTED #7c4f1f carries six of the seven columns at 2.6 to 3.4:1'. I opened ProjectFilesExplorer.jsx:35 and 241-246: there is exactly ONE muted value, #7c4f1f, measuring 3.40:1 on #f4a261, applied to six columns. Neither '3:1' nor the '2.6' end of the range corresponds to anything in the file. The defect is real and the fix is right; the numbers are invented.

- System F21: 'Delete border-2 entirely (53 in D.O.G., 146 in O.T.T.E.R.)'. O.T.T.E.R.'s 146 is exact (verified). D.O.G.'s 53 is the sum of DeckOutlineGenerator.jsx (41) and its two modals (12) — but the folder also contains border-2 inside LayoutVisualizer.jsx, which constraint 4 makes untouchable. The count is right for the files in scope and wrong for the instruction as written ('entirely'). D.O.G.'s own review uses 41 and is correct.

- RABBIT p1 RABBIT p1 uniformity gap, 'R.A.B.B.I.T. uses 1px in 912 places': Not reproducible. A literal count of '1px solid' under src/tools/rabbit_v0.1.0 returns 953. The comparative point (RABBIT reads lighter because it is 1px where the other two tools are 2px) is sound and is supported by the verified 146 border-2 in O.T.T.E.R.; the specific figure is not sourced and should not be quoted to Audrey.

- System System review, '1,917 font-mono classes': Measured 1,918 across .jsx/.js/.css. Trivially off, but worth noting that the count includes .css rules and comment text, and — more importantly — it MISSES the inline spelling. F-R18 is the only review that caught this: there are inline fontFamily monospace declarations (21 on the Resources surface alone, plus IntakePrepare's private DATA constant and the two help modules) that a class-based sweep will not see. A session that deletes 1,918 classes will report the mono work finished while several surfaces are still half mono.

- Assets/Levels R4-26: Understated rather than unsupported, and worth correcting because the severity changes. The finding says clicking a related asset 'does nothing'. I opened LevelsView.jsx: nestedAssetId is declared (687), set by onOpenAsset (792) and gates hasLeftSide (724) — but there is NO render branch for it; only nestedTaskId renders (752). So the click widens the dialog by a whole column and renders an empty panel. That is a visible layout jump into nothing, not a no-op, and it is duplicated verbatim in ExperiencesView.

- Timeline TL-12: The finding is correct and verified (#fff7ed on #ea580c = 3.35:1, #1c1917 = 4.91:1). The problem is that it draws a conclusion the review does not generalise: if white fails on #ea580c for a button label, it fails for every non-large element on the orange frame — including the subtitles F16/D23/O37 want to make white, and including any future content-layer use of the signal fill. Treat TL-12 as the app-wide rule, not a Timeline finding.

- multiple D.O.G. / Timeline / Bins 'the BinsView bar is 34px': Supported (verified: minHeight 34, twelve Kbd groups, 9px, paddingLeft 30). Flagging only because eight reviews then propose promoting it 'at 28px' — which is a 6px height reduction to a bar that already has a documented reason for its height (BinsView.jsx:840-843: the paddingLeft 30 and the height exist so Rabbit's adapter dot at bottom 18 reads as part of the bar). Shrinking it to 28px without moving that dot re-breaks a fix Audrey signed off on 2026-09-10.


### Cross-cutting themes, one fix each

- **There is no component layer, so every defect is N defects. The same six objects are hand-rolled on every surface: 64 overlays across 36 files (verified), five copies of ThLight (verified: CompaniesSection, LogsSection, UsersSection, DashboardTasksView, TeamMembersPage), 19-22 tables, four-plus toast systems, ~40 empty states, and a Button that exists nine times in Admin Terminal alone.** (System, D.O.G., O.T.T.E.R., RABBIT p1-p5, Resources, Dashboard, Settings, Admin Terminal, Auth/Help)
  → Build src/ui ONCE, by promoting binUi (it already has Btn, IconBtn, Chip, Kbd, Menu, Modal with a modal stack and topmost-only Escape, Field, Input, TextArea, Select, EmptyState, Spinner, Toggle) and adding Table, Toolbar, Tabs, PageHeader, SectionTitle, StatusBadge, Loading, ShortcutBar, HoverActions, Panel, Dialog, Drawer, Banner, Toast, Stat. Absorb lightSurface.js into it keeping the existing export names as aliases so its 30 importers keep working. No surface session opens until the kit compiles, or the kit gets written three times.

- **State is encoded in inline style objects and in className template literals, so a class-based restyle silently drops states. ProjectTasksView's own comment records that an inline cursor beats Tailwind's disabled: variant. ScenesView mutates e.target.style.borderColor in 32 places. Bins' Btn declares hover:bg-stone-700 and then suppresses it with an inline backgroundColor (verified — every primary and secondary button in Bins has a DEAD hover today). Seven RABBIT components drive hover from a useState.** (D.O.G., O.T.T.E.R., RABBIT p1-p5, Dashboard, Admin Terminal, Auth)
  → One mechanical pre-step, its own commit, before any visual work on a file: convert hover/selected/disabled/active from inline style ternaries and from className template literals to data attributes plus CSS, enumerating every branch into a named variant first. Where a finding says 'swap the class', read the ternary. This is the difference between a reviewable diff and a silent regression on a state only some users see.

- **Two type problems compound into the 'dated' verdict, and they are the same problem: everything is emphasised. 1,918 font-mono (verified), 1,167 uppercase (verified exactly), 26 sizes with half-pixel steps and ~300 uses below 10px.** (all)
  → Steps 1 and 2 of the system plan, done app-wide in one pass and nowhere else: load one variable sans + its designed mono, set font-family on html, delete font-mono everywhere it is not data (numerics in tables, ids, paths, timecode, keys, code, version), map 26 sizes onto 8 whole-pixel steps with 11px as the floor, drop 700 to 600, and reserve uppercase+tracking for exactly two roles (the transition Display and the 11px Label). Sweep the INLINE fontFamily spelling in the same commit — F-R18 found 21 on one surface that a class sweep misses.

- **'Local tokens, not global' is written into visual-language.md as Composition rule 3, and it is the mechanism of every drift in this report: 121 distinct hex values app-wide (verified exactly), five diverged ThLights, four private darkBtnClass pairs in Admin Terminal, four copies of fmtCurrency, four copies of statusColor, two copies of the same shot-status ramp, three help token objects. lightSurface.js is the counter-proof — one shared module, 30 importers, fixed grey-on-orange app-wide, and its own header calls itself 'a deliberate exception'.** (all)
  → Reverse the rule in the doc in the SAME commit as the @theme block, and make a local token object the thing that needs justifying. Then add the lint gate Admin Terminal's review asks for: an imported-but-unused token fails the build. UsersSection.jsx imports LIGHT_WELL and then writes rgba(120,70,30,0.18) inline seven times (verified) — the import is a badge, and only a build failure stops that.

- **Nothing on any surface shows a keyboard affordance except one 34px bar in Bins. Verified: Kbd exists in exactly two places in the app, both in BinsView. Meanwhile D.O.G. registers five document-level keys, O.T.T.E.R. two, Timeline three, ScenesView one, Expenses two, and twelve inline editors implement Enter/Escape silently. This is the inconsistency Audrey named by example.** (D.O.G., O.T.T.E.R., Timeline, Bins, Scenes, Budget, Assets, Resources, Dashboard, Admin Terminal, Settings, Home)
  → One ShortcutBar with three slots (shell status / view-registered hints / view-registered count), mounted once per shell, contents pushed by each view on mount. Kbd goes from 9px to the 11px floor. Register no new keys — display only — and keep BinsView's 34px height and paddingLeft 30 so the adapter dot it was tuned around still reads as part of the bar.

- **Contrast fails in the same shape on every surface, and the shape is 'a grey or a tint used where an ink belongs'. Verified samples: #78716c on #1c1917 = 3.65, #57534e = 2.29, #44403c-as-text = 1.70, #7c4f1f on #f4a261 = 3.40, text-orange-200 on #ea580c = 2.63, #b45309 on the orange root = 1.34, the ADD PEOPLE menu hint = 1.00 (LIGHT_INK on a #1c1917 menu), status chips on the Projects list = 1.15.** (all)
  → One ink per surface class at three measured screens, and a contrast TEST rather than a rule. Extend the existing authContrast.test.js pattern into a single tokens test that asserts every ink/ground pair in tokens.js clears 4.5:1 (3:1 for ≥19px bold), with the known-bad values pinned as FAILING CONTROLS: #78716c, #57534e, #44403c, #7c4f1f, #f5efe6, #fed7aa, #d6d3d1, #e7e5e4, #dc2626, #15803d, #b91c1c-on-light, white-on-#ea580c-below-19px. lightSurface.test.js already proves the pattern works; it is the only reason the light pages are as consistent as they are.

- **Every dense surface is starved of vertical field by chrome it did not choose. Admin Terminal: 350px of bars above and below its densest table (verified, bars(200,150)). Timeline: ~400px of stacked strips before the first task row. The Files page renders inside Home's 268/268 because 'project-files' was never added to PAGE_BARS (verified: present in PAGE_TITLES at App.jsx:105, the nav list at 1729 and the OR chain at 1892, absent from PAGE_BARS) — a one-line bug costing ~400px on the app's densest table.** (Resources, Admin Terminal, Timeline, Budget, Scenes, Assets, Dashboard, Settings)
  → One PAGES registry with { id, title, subtitle, bars, surface, chrome }, from which PAGE_TITLES, PAGE_BARS, the OR chain and the nav lists all derive, and a missing bars value is a build failure rather than a silent fallback to Home. That fixes the Files bug permanently and makes the 120/80 question a single edit when Audrey rules on it.

- **Loading and empty are the same picture everywhere. Verified in D.O.G. (a full-deck run still says 'No output yet'), Logs (EmptyState called with the string 'Loading...'), Files (three states, one component), Dashboard, Budget, Assets, Bins.** (all)
  → Two components, never one: EmptyState (24px icon, 14px sentence-case title, 13px body, action slot) and Loading (skeleton ROWS for anything tabular, a spinner elsewhere). Add one rule to the kit's header: EmptyState must never be passed a string containing 'Loading'.

- **The light-orange page class is a hard ceiling that eight reviews each worked around locally. #f4a261 is a saturated mid-tone, so the whole stone ramp fails on it, white is 2.06:1 and black is 8.48:1 — exactly one usable ink. Every light page has invented its own escape: a near-white cream header (#f5efe6), a brown well no token exports, a #1c1917 field dropped onto the orange, a pale pastel chip, a 0.55 well measured at 3.38:1 and recorded in OUTSTANDING as unresolved.** (Resources, Dashboard, Settings, Admin Terminal, Auth, Help, Home)
  → Audrey's F36 ruling, taken ONCE and taken before any light-page session opens, because the three options produce opposite code. It also settles F-R19/AT-06 (semantic status on light), S5/AT-24/F-R08 (the input well, 20+ inputs), R3's warm-variant ProjectFilesTable, and D33 (the Dashboard's dark cards). Nine of twelve pages are this class — verified: isDarkPage is isDog||isOtter||isRabbit, so everything else is light.


### Risks

- THE PLAN IS ROUGHLY 30 SESSIONS AND ~25,000 LINES OF TOUCHED CODE ACROSS FIFTEEN SURFACE REVIEWS, on a codebase with three paused track branches, an unmerged v1.0.0 PR, and a demo sprint that currently owns the working tree. Nothing in this report is schedulable until the branch story is settled. Confirm that before presenting any of it.

- NO TEST IN THIS REPO MOUNTS REACT. Every visual claim, in every review, is verifiable only by Audrey in the running app. That means ~30 sessions each ending with a hand-verification list, and it means a silently-dropped state (a stub course, a read-only cell, a disabled branch, a cloud-vs-local adapter branch) will not fail CI. The single biggest schedule risk is discovering at session 25 that session 6 dropped a state.

- SOURCE-TEXT TESTS ARE THE SHARPEST EDGE AND THEY ARE SCATTERED. Verified: writeGate.test.js locates JSX by the literal string '\n      />' at six spaces of indent; four wiring tests read SettingsPage.jsx and StorageConnections.jsx as strings and assert exact user-facing copy, a data attribute, a GatedAction count and a component order; thumbnails.test.js counts an exact substring twice in FileManager.jsx. These will go red on changes that are provably correct, and the failure message will say nothing about design. Enumerate every source-text test in the repo in Wave 0 and put the list in the hand-off, or each lane rediscovers them one panic at a time.

- INLINE STYLES BEAT CLASSES AND THE CODEBASE KNOWS IT. The verified dead hover on every Bins button is the same bug the rework is about to create at scale: a class-based treatment written next to a surviving inline style looks like a build problem, not a code problem, and people will spend hours on the wrong theory. The state-extraction pre-step is not optional and must be its own commit.

- TWO FILES CANNOT BE SAFELY EDITED AS THEY STAND. DeckOutlineGenerator.jsx is 5,411 lines with the whole render tree in one return and 98 of 101 className values as template literals, 89 with state ternaries. TimelineView.jsx is 7,073 lines with its render functions declared after the return and hoisted. SettingsPage.jsx is 1,216 lines holding all seven tabs. Each needs a structure-only session with zero styling in it before the visual pass, and that session is where a source-text test breaks.

- THE UNTOUCHABLES ARE ADJACENT, NOT DISTANT. LayoutVisualizer is mounted inside the D.O.G. panel being reworked and again inside DuplicateResolverModal at a pixel-exact 714x402 frame — changing the panel's border weight or padding changes the width the preview measures. PetCompanion renders over O.T.T.E.R. Pet keyframes live in index.css, where three reviews want to add a blanket reduced-motion rule. Take a before screenshot of the D.O.G. preview at a fixed window size and compare after every commit in that lane.

- %APPDATA% IS VIRTUALIZED FOR THIS SESSION AND HER REAL O.T.T.E.R. LIBRARY LIVES THERE. Any claim about how a surface looks with her six courses and 49 subjects cannot be checked from here. The O.T.T.E.R. reviews' density and Hick's findings (55 quiz checkboxes, seven filter chips wrapping to four rows) are derived from code, not from her data. Ask her to look, do not diagnose from a container copy.

- THE PLAN CHANGES THE FIRST SCREEN A USER EVER SEES AND THE GATE EVERY ADMIN PASSES. AuthShell's caret alignment is measured to 0.00px drift and depends on ch resolving identically on the wrapper and the input — which depends on BOTH font-family and font-size matching. Changing the face and the size re-opens it, nothing in the repo can test a caret position, and the failure mode is a locked-out admin, not a cosmetic regression. Re-measure in the running app. Same for SPLIT_BAR_HEIGHT, which was derived from a 330px measurement and already overflows at the 700px minimum window.

- SCOPE CREEP IS ALREADY PRESENT IN THE FINDINGS. At least twenty findings across the reviews change a behaviour while describing themselves as visual: disclosures, overflow menus, collapsed defaults, a removed colour picker, a removed autoplay, a removed field, a table replacing a panel, a reordered financial column. Several are tagged constraint_risk: none. If the ask-Audrey list is assembled by filtering on that tag, she will approve a visual pass and receive an interaction redesign. Build the list from the reframes in this report, not from the tags.

- THE CONTRAST ARITHMETIC WAS NOT DONE BY THE REVIEWS THAT DEPEND ON IT. Two of the system review's own proposed tokens fail AA (ink at 48 percent, the light success/danger values) and the most-repeated single recommendation in the whole report — white subtitles on the orange bar — lands at 3.56:1. If the kit is built from the system review as written, the overhaul ships new contrast failures with a test suite that says it fixed them. Every token goes through the measured test in Wave 0.

- THE INTERMEDIATE STATE IS UNDESCRIBED. Waves 0 and 1 land app-wide; Waves 2-4 land per surface. Between them the app runs a 14px sans body next to unconverted 11.5px mono tables. Nobody said whether that ships to the beta or waits on a branch. Decide before Wave 1, because 'we'll just finish it quickly' is how a half-migrated app becomes the permanent state.

- TEN FEATURES HAVE ALREADY SHIPPED IN THIS PROJECT WITH NO CALLER, and this plan creates ~20 new shared components at once. The verified RelationBadge — imported into ProjectAssetsView and never rendered — is that pattern already present in the code being reworked. Enumerate the kit's exports and grep each for callers before closing any lane.

- ONE REVIEW PROPOSES SHRINKING A BAR AUDREY PERSONALLY SIGNED OFF ON EIGHT DAYS AGO. The BinsView footer's 34px height and paddingLeft 30 exist so Rabbit's adapter dot reads as part of the bar (her note, 2026-09-10, in the source). Eight reviews propose promoting it 'at 28px'. Moving it without moving the dot re-breaks a fix she asked for and will read as the rework undoing her feedback — which is the specific failure this project cannot afford twice.
