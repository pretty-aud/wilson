# Review — System Settings (SettingsPage + src/components/settings/*)


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\SettingsPage.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\StorageConnections.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\ProfileSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\UserModelsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\PasswordSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\AgentSkillsSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\ModelPicker.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\VersionPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\SessionSection.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\CurrencyPicker.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\agentSkillRegistry.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\lightSurface.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\permissions\GatedAction.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx (Kbd reference)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx (shortcut bar reference)`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\localDemoWiring.test.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\localMediaWiring.test.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\workspaceRootWiring.test.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\lib\userStateWiring.test.js`


## Job

Settings is the app's configuration surface: seven tabs, each a vertical stack of independent setting groups in a 672px centred column. It has no single conversion action, which is correct for a settings screen, so the test is one primary action per sub-view. Per tab: General has none, because it is six unrelated groups (workspace, updates, an AI-features paragraph with no control, the pet, the files root, the password) with no dominant element - that absence is finding S12 and S14, not an acceptable answer; Profile is Save profile; Models is change one function's model; Storage is switch the backend and open the demo folder (two co-equal primaries, so effectively none); Teams is add a department; Agent is toggle Agent Mode; Agent Skills is edit a system prompt. Three of seven tabs currently have no identifiable dominant action, and that is the root hierarchy failure on this surface.


## What works

- lightSurface.js is imported and used by eight of the ten files on this surface. LIGHT_INK and LIGHT_RULE are the only genuine design tokens Settings has, and the fact that they already crossed eight file boundaries without drifting is the working proof that the shared-module approach beats the documented 'local tokens, not global' rule.

- The new-pet status block (SettingsPage.jsx:555-570) is the best-built feedback element in the app: role="status", aria-live="polite", three distinct states on one component, and a header comment that records the measured contrast of every fill and explains why LIGHT_INK is used in all three. It is the pattern every other feedback line on this surface should be rewritten to.

- Monospace is used correctly in exactly the places the system review reserves for it: filesystem paths (StorageConnections.jsx:89-95 PathLine, 'A path is a fact: monospace, full, wraps anywhere'), the version string (SettingsPage.jsx:1111), and the pet's hunger/happiness numerics (SettingsPage.jsx:434). Those seventeen uses survive the mono purge; the other ~26 on this surface do not.

- CurrencyPicker already solves its own Hick's Law problem: nineteen currencies behind one trigger with a search filter that autofocuses (CurrencyPicker.jsx:74-82). It is the progressive-disclosure pattern the Storage and Models tabs need, and it already exists in the codebase.

- UserModelsSection's provenance line - 'using Sonnet 4 - from your company' (UserModelsSection.jsx:177-179) - is real information design rather than a bare control. It answers a question the user would otherwise have to ask a person. The typography fails it; the thinking does not.

- GatedAction is one treatment for one state, applied identically on both root-picking surfaces (SettingsPage.jsx:595, StorageConnections.jsx:341). It is the only component on this surface that behaves like a design system component.


## Findings (44)

**S1 · HIGH · System** — Eight type sizes and sixteen distinct type treatments on one settings screen, none of them derived  
law: Law of Similarity

- Problem: Settings uses text-xs (59), text-[11px] (46), text-[10px] (45), text-sm (20), text-[9px] (3), text-[12px] (1), text-xl (1) plus four inline fontSize values in the confirm modals. Cross those with weight, case and tracking and there are sixteen distinct typographic objects. The de-facto body is 12px and the de-facto label is 10-11px, so the majority of the screen sits at or below the perceptual floor for a Windows desktop app at 100% zoom.

- Why it matters: With sixteen treatments and no scale, size no longer signals rank. A section heading (14px bold upper widest) and a button label (11px bold upper wider) are three pixels and one tracking step apart, which the eye cannot resolve, so the reader has to parse the text to work out what kind of thing each object is. That parse-instead-of-scan is exactly what makes the surface feel like a control panel rather than a settings page.

- Change: Map every occurrence onto the eight-step shared scale. Concretely on this surface: section h2 -> H2 16px/600/sentence; the description paragraph under it -> Body 14px/400; field labels and table-ish group headers -> Label 11px/600/upper/+0.06em; card body, hints, paths, model rows, provenance -> Dense 13px or Caption 12px; toggle descriptions currently at text-[10px] -> Caption 12px; badges at text-[9px] -> Label 11px. Delete text-[9px] and text-[10px] from this surface entirely; nothing on a settings page needs to be smaller than 11px.

- Evidence: `src/components/SettingsPage.jsx:389` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">`<br>`src/components/SettingsPage.jsx:457` — `<p className="text-[10px] text-stone-950 mt-0.5">When off, companion is a helper-only chatbot with no hunger/sleep mechanics</p>`<br>`src/components/SettingsPage.jsx:732` — `className="ml-2 px-1.5 py-0.5 text-[9px] rounded-sm normal-case tracking-normal"`




**S2 · HIGH · Typography** — 77 uppercase runs, 72 tracking utilities and 83 bold declarations on a screen whose body is 12px  
law: Von Restorff Effect

- Problem: Uppercase plus letterspacing plus 700 weight is applied to the section heading, the tab label, the field label, every button, the group header, the status badge, the Danger Zone eyebrow and the adapter name. Every one of them is between 9px and 14px. Nothing on the surface is set at 400 except the descriptive paragraphs.

- Why it matters: When six different object classes wear the same emphasis, emphasis stops carrying information (Von Restorff: if everything is bold, nothing is). It also costs legibility twice over, because uppercase removes the ascender/descender silhouette the reader uses to shape-match words, and it is doing that at 10px on a saturated orange ground.

- Change: Uppercase survives in exactly one role on this surface: the 11px Label step (field labels, group headers such as 'Recent folders' and 'Project files root', and the two status badges), with +0.06em tracking. Section headings, tab labels, every button label and the Danger Zone eyebrow become sentence case at 600 with zero tracking. That single rule removes roughly 55 of the 77 uppercase runs here.

- Evidence: `src/components/SettingsPage.jsx:337` — `className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-t-sm transition-colors"`<br>`src/components/SettingsPage.jsx:498` — `<span className="text-[10px] font-bold uppercase tracking-wider text-red-700 block mb-3">Danger Zone</span>`<br>`src/components/settings/ProfileSection.jsx:275` — `const labelClass = 'block text-[11px] font-bold uppercase tracking-wider mb-1.5'`




**S3 · HIGH · System** — The input token block is copy-pasted four times and the label/input class strings twice; there is no component layer at all  
law: Law of Similarity

- Problem: The identical inline object { backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' } is declared independently in four files. labelClass and inputClass are declared as identical string literals in two. StorageConnections declares its own three-button token set (DARK_BTN / QUIET_BTN / DANGER_BTN) that no other file can see.

- Why it matters: This is the mechanism behind every other finding in this review. Four copies of one input means a fix to the well has to be made four times and will be made three times; three private button tokens in one file means the other nine files invented their own. The surface has 49 button elements and not one shared Button.

- Change: Promote Input, TextArea, Select, Field, Label and Button out of these files into the shared kit, with a light-surface variant. Delete all four inputStyle copies, both labelClass/inputClass copies, and StorageConnections' DARK_BTN/QUIET_BTN/DANGER_BTN, replacing them with Button variants primary/secondary/ghost/danger at sizes 28 and 36.

- Evidence: `src/components/SettingsPage.jsx:250` — `const inputStyle = {     backgroundColor: 'rgba(120, 70, 30, 0.55)',     color: '#fde8d0',`<br>`src/components/settings/ProfileSection.jsx:264` — `const inputStyle = {     backgroundColor: 'rgba(120, 70, 30, 0.55)',`<br>`src/components/settings/StorageConnections.jsx:71` — `const DARK_BTN = { backgroundColor: '#1c1917', color: '#f4a261' } const QUIET_BTN = { backgroundColor: 'rgba(28,25,23,0.08)', color: '#1c1917', border: '1px sol`




**S5 · HIGH · Colour** — Every text input on this surface is at 3.40:1 - the project's own token file measured it and refused to export the well  
**constraint: palette-decision** · law: Aesthetic-Usability Effect

- Problem: Eleven controls paint #fde8d0 text on rgba(120,70,30,0.55). Composited over the page's #f4a261 that well flattens to about #b06f3c, and #fde8d0 on it measures 3.40:1. lightSurface.js measured the same thing at 3.38:1 and explicitly declined to export the token for that reason.

- Why it matters: This is the largest readability defect on the surface and it is the same family as the complaint about the Files page. It affects the four profile fields, both password fields, the department input, the agent prompt textarea, the rate-card select, and both CurrencyPicker controls - that is, every place the user types or chooses. The comment in lightSurface.js calls it 'a REAL, pre-existing problem with every input on every light page' and files it to OUTSTANDING rather than fixing it.

- Change: Retire the 0.55 well from inputs. Use the measured LIGHT_WELL (rgba(120,70,30,0.18)) with LIGHT_INK text, which lightSurface.js already measures at 6.91:1 when flattened, plus a 1px LIGHT_RULE hairline and a single focus-visible ring. Extend authContrast.test.js to assert the input token so the regression fails a test instead of shipping.

- Evidence: `src/components/lightSurface.js:50` — `// ⚠️ NOT EXPORTED, deliberately. 'rgba(120, 70, 30, 0.55)' is WILSON's // existing input well on light pages ... the contrast test refused it`<br>`src/components/settings/PasswordSection.jsx:126` — `const inputStyle = { backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }`<br>`src/components/settings/CurrencyPicker.jsx:33` — `const inputStyle = {   backgroundColor: 'rgba(120, 70, 30, 0.55)',   color: '#fde8d0',`




**S10 · HIGH · Colour** — Every success and every error message on this surface is below AA, and the correct pattern is sixty lines away in the same file  
law: Selective Attention

- Problem: Measured on #f4a261: 'Saved.' in text-green-700 is 2.60:1; PasswordSection's 'Password changed.' at #15803d is 2.60:1; StorageConnections' seed success at #166534 is 3.70:1; #dc2626 error text is 2.51:1; #991b1b error text is 4.31:1; the auto-approve 'Warning: All agent edits will be applied immediately' in text-red-700 on its translucent red fill is 2.41:1. That warning is the most consequential sentence on the surface and the least readable text on it.

- Why it matters: Feedback is the one class of text that must be readable on first glance, because it is transient and unexpected. Colour-coded feedback that fails contrast is worse than no colour, because the colour is doing the semantic work and the ink is doing none.

- Change: Adopt the pattern already proven in this file: keep the tinted fill, set the ink to LIGHT_INK, and carry the semantic in the border colour plus an icon. SettingsPage.jsx:555-566 does exactly this and its comment records 7.68:1 and 7.56:1 for the success and danger fills. Apply it to ProfileSection:434 and :437, PasswordSection:199 and :206, VersionPanel:121, StorageConnections:370, :377 and :428, and SettingsPage:976. Where a coloured ink is genuinely wanted, use #7f1d1d, which visual-language.md already measures at 4.86:1.

- Evidence: `src/components/SettingsPage.jsx:976` — `<p className="text-[11px] text-red-700 font-bold leading-relaxed">   Warning: All agent edits will be applied immediately without review.`<br>`src/components/settings/ProfileSection.jsx:434` — `<span className="text-xs font-mono text-green-700">Saved.</span>`<br>`src/components/SettingsPage.jsx:562` — `? { borderColor: LIGHT_RULE, color: LIGHT_INK, backgroundColor: 'rgba(120, 70, 30, 0.08)' }`




**S7 · HIGH · Colour** — Four different treatments all claim to be the primary button, and they appear within one scroll of each other  
law: Law of Similarity

- Problem: (a) #ea580c fill, #fff7ed text, #c2410c border - Change, Select Root Directory, Manage Task Templates, Change Password, Download update. (b) #1c1917 fill, #f4a261 text - Add, Save profile, Upload avatar, Change folder, Check for updates. (c) #f97316 fill, white text - pet mode ON, difficulty active, Save on the agent prompt. (d) transparent with a 1px LIGHT_RULE border - Open in Explorer. Treatments (a) and (b) sit fourteen lines apart in the General tab.

- Why it matters: Law of Similarity says elements that look alike share a function. Here elements that share a function look completely different, so the user cannot learn the button language of the app, and the actual primary action on each sub-view is not distinguishable from the secondary ones by treatment.

- Change: One primary: #ea580c fill, white label, no border, 36px tall, sentence case 600. One secondary: transparent with a 1px rule and LIGHT_INK label, 28px or 36px. One ghost for tertiary. One danger. The #1c1917/#f4a261 pair is retired from buttons entirely - it is the page ground used as ink, which is why it reads as an inverted chip rather than a button.

- Evidence: `src/components/SettingsPage.jsx:600` — `style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}`<br>`src/components/settings/ProfileSection.jsx:429` — `style={{ backgroundColor: '#1c1917', color: '#f4a261' }}`<br>`src/components/SettingsPage.jsx:1053` — `style={{ backgroundColor: '#f97316', color: '#fff' }}`




**S12 · HIGH · Hierarchy** — Settings has no page header, so the first thing that resolves is a row of seven identical uppercase tabs  
law: Selective Attention

- Problem: The content area opens straight onto the tab bar at SettingsPage.jsx:332. The page name exists only in the nav strip and in the 400ms transition overlay. Below the tabs, every section is an h2 at the same 14px bold uppercase, so after the tabs there is no second-rank element either - just six to ten peers.

- Why it matters: Squint at any tab and nothing resolves first. Dominance has to come from scale and position, and here every candidate is within 2px of every other candidate. This is why the surface reads as a form dump rather than a settings page.

- Change: Add the shared PageHeader: 56px, 24px gutter, 'Settings' at the 20px step in sentence case 600, with the tab bar directly beneath it as a secondary rank at 14px. The title string comes from the same PAGES registry entry the transition overlay reads, so the held title and the page header are one value. This is additive - it changes no view and no control.

- Evidence: `src/components/SettingsPage.jsx:329` — `<div className="flex-1 flex justify-center py-8 px-8 overflow-auto">   <div className="w-full max-w-2xl">     {/* Tab bar */}`<br>`src/components/SettingsPage.jsx:332` — `<div className="flex gap-1 mb-8">`




**S6 · HIGH · Colour** — The pet card paints its name and its numbers in the page's own background colour, at 2.10:1  
**constraint: touches-pets** · law: Aesthetic-Usability Effect

- Problem: The pet name is #f4a261 on the rgba(120,70,30,0.55) well, which composites to about #b06f3c. That measures 2.10:1 - within rounding of the 2.06:1 white-on-orange defect Session 43 was created to fix. The hunger and happiness readouts use the same ink at 10px.

- Why it matters: The pet's name is the identity anchor of that card and it is the least readable string in it. The rule is white or black on orange, and #f4a261 is neither; it is the page ground being used as an ink, which is the definition of a value that cannot carry text.

- Change: Name goes to LIGHT_INK at the 14px H3 step. The numeric readouts go to LIGHT_INK at the 12px Caption step with tabular-nums, keeping mono. The orange stays where it belongs: the filled portion of the two progress bars, which is the only element in the card that should be signal-coloured.

- Evidence: `src/components/SettingsPage.jsx:413` — `<span className="text-sm font-bold" style={{ color: '#f4a261' }}>{petData.name || 'Ollie'}</span>`<br>`src/components/SettingsPage.jsx:434` — `<span className="text-[10px] font-mono" style={{ color: '#f4a261' }}>{Math.round(petData.hunger)}/100</span>`




**S32 · HIGH · Build** — 49 buttons on this surface, zero focus styles; only the inputs have a ring  
law: Jakob's Law

- Problem: Every focus utility on the surface is attached to an input, select or textarea class constant. Not one of the 49 button elements carries focus or focus-visible styling, so keyboard focus on a #ea580c or #1c1917 filled button falls back to the UA outline against an orange page.

- Why it matters: Settings is the surface most likely to be driven by keyboard (tab through fields, Enter to submit), and the app already ships a frameless Electron window where the UA focus ring is the only affordance. It is also the cheapest fix in this review.

- Change: One focus-visible treatment in the shared Button and Tabs components: a 2px #ea580c ring with a 2px offset in the page ground colour. Switch the existing input rings from focus: to focus-visible: at the same time so a mouse click stops painting a ring.

- Evidence: `src/components/settings/ProfileSection.jsx:274` — `const inputClass = 'w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500'`<br>`src/components/SettingsPage.jsx:459` — `onClick={() => onPetModeToggle(!petData.petMode)} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"`




**S25 · HIGH · System** — Four confirmation treatments coexist on one settings screen  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: (1) Two hand-rolled fixed overlays with fully inline styles, 6px radius, fontFamily 'monospace', 14px uppercase titles at 0.15em. (2) Four native window.confirm() calls. (3) A two-button inline confirm row that replaces the trigger (SessionSection). (4) An inline confirm block inside a card (StorageConnections' foreign-folder prompt).

- Why it matters: Destructive confirmation is the moment where the user most needs the interface to be predictable, and here the same intent produces four visually unrelated experiences - one of which is the OS chrome, which does not even follow the app's palette. Jakob's Law is about mechanism consistency, and this surface has four mechanisms for one mechanism.

- Change: Promote binUi's Modal as the shared Dialog and route all four hand-rolled and native confirmations through it: one backdrop rgba(12,10,9,0.6), one surface, 8px radius, one shadow, header/body/footer, topmost-only Escape. Keep the two inline-confirm patterns only where the confirmation is non-destructive and in-place; the department delete and the Drive disconnect are destructive and belong in the Dialog.

- Evidence: `src/components/SettingsPage.jsx:1117` — `<div style={{ backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '28px 32px', ...`<br>`src/components/SettingsPage.jsx:1206` — `if (window.confirm('Remove department "${name}"?')) onRemove()`<br>`src/components/settings/StorageConnections.jsx:212` — `if (!window.confirm('Close the demo folder "${name}"?\n\nNothing is deleted. ...`




**S18 · HIGH · Alignment** — Three content widths stack inside one tab, so the right edge steps three times down a single scroll  
law: Law of Prägnanz

- Problem: The General tab's paragraphs run the full 672px of max-w-2xl; PasswordSection wraps its form in max-w-md (448px); ProfileSection lays its fields into a 2-column grid across the full 672px. All three are left-aligned to the same edge, so the difference shows entirely on the right as a ragged three-step staircase.

- Why it matters: A settings page is read as a column, and a column with three right edges has no column. The eye cannot establish a measure, which is the structural reason the surface feels unresolved even before the type is judged.

- Change: One measure for the whole surface: 720px for every tab. Forms, paragraphs, cards and grids all terminate at the same right edge. Delete the max-w-md on the password form and let its fields sit in the same two-column grid ProfileSection uses.

- Evidence: `src/components/SettingsPage.jsx:330` — `<div className="w-full max-w-2xl">`<br>`src/components/settings/PasswordSection.jsx:156` — `<form onSubmit={handleSubmit} className="max-w-md space-y-3">`<br>`src/components/settings/ProfileSection.jsx:356` — `<div className="grid grid-cols-2 gap-4 mb-4">`




**S19 · HIGH · Alignment** — A 2-column grid sits directly above a 3-column grid, so the vertical rules between fields do not line up  
law: Law of Proximity

- Problem: ProfileSection renders Display name / Pronouns / Title / Department in grid-cols-2, then immediately renders Username / Role / Email in grid-cols-3. The gutter in the first block falls at 50% of the column; in the second it falls at 33% and 66%. Nothing aligns across the seam.

- Why it matters: This is the single most visible alignment defect on the surface, because the two blocks are separated by 16px and read as one field group. Six field edges that almost line up are worse than six that clearly do not.

- Change: One grid for both blocks: grid-cols-2 throughout, with the three locked fields filling four cells (Username, Role, Email, and an empty cell) or moving to a single full-width read-only row group. Field edges then agree down the whole panel.

- Evidence: `src/components/settings/ProfileSection.jsx:356` — `<div className="grid grid-cols-2 gap-4 mb-4">`<br>`src/components/settings/ProfileSection.jsx:408` — `<div className="grid grid-cols-3 gap-4 mb-5">`




**S20 · HIGH · Alignment** — The label-left / control-right rows have no row contract: no fixed height, four control heights, drifting vertical centres  
law: Law of Proximity

- Problem: Pet Mode, Difficulty, Agent Mode and Auto-Approve are all flex items-center justify-between with no height. The Pet Mode toggle is px-4 py-1.5 at text-xs (~30px); the difficulty buttons are px-3 py-1.5 at text-[10px] (~26px); the auto-approve buttons are the same 26px but three of them; the label side is a two-line block in every case. So the control and the label are vertically centred against each other but the rows themselves are different heights and the descriptions push the baselines apart.

- Why it matters: This is the exact pattern Notion and the Apple system settings get right by fixing the row: one height, one label column, one control right edge. Without it the four rows read as four bespoke arrangements rather than one list of settings.

- Change: One Row component: 36px minimum, 24px gutter, label at 14px/600 on the left with its 12px Caption description beneath, control right-aligned to a shared edge, all controls 28px tall, hairline divider between rows. Apply to all four toggle rows plus the Scope Restrictions block. No control changes and no view changes - only the geometry.

- Evidence: `src/components/SettingsPage.jsx:454` — `<div className="flex items-center justify-between">`<br>`src/components/SettingsPage.jsx:483` — `className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"`<br>`src/components/SettingsPage.jsx:461` — `className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"`




**S22 · HIGH · Typography** — Body copy runs to roughly 110 characters per line  
law: Cognitive Load

- Problem: The description paragraph under every section heading is 12px in a 672px column. At an average advance of about 6px per character that is 110 to 112 characters per line, against a target of 60 to 66 and a hard ceiling of 75. The Storage Backend paragraph is six lines of it.

- Why it matters: Measure is the one typographic variable a reader feels without being able to name. At 110ch the return sweep loses the line, which is felt as 'hard to read' rather than 'too wide' - and 'hard to read' is the complaint in the brief.

- Change: Body moves to 14px and every prose block is capped at 66ch (about 620px at 14px), set in ch rather than px so it holds if the face changes. The 720px column stays for rows, grids and tables; prose sits inside it at 66ch. On the Storage Backend paragraph that turns six lines of 110ch into eight lines of 66ch, which reads faster despite being taller.

- Evidence: `src/components/SettingsPage.jsx:673` — `<p className="text-xs text-stone-950 mb-4 leading-relaxed">   Where R.A.B.B.I.T. stores projects, phases, assets, tasks, files, and rate`<br>`src/components/SettingsPage.jsx:330` — `<div className="w-full max-w-2xl">`




**S13 · HIGH · Hierarchy** — The Models tab's own heading is an h3 at 12px, smaller than the 14px h2 every other section uses, and it is the only header with a right-hand action  
law: Law of Similarity

- Problem: UserModelsSection opens with h3 text-xs font-bold uppercase tracking-widest, while every peer section opens with h2 text-sm. It is also the only section that puts a control (Refresh) in the header row rather than the body, and the only one whose heading uses sentence case ('AI models') against everyone else's title case.

- Why it matters: Models is a whole tab; it should not rank below a subsection of General. Three deviations in one header - size, element, case - mean the header contract does not exist, which is why the rework will otherwise reproduce it.

- Change: One SectionTitle component: 16px sentence case 600, optional 13px description, optional right-hand actions slot. Every section on this surface uses it, including this one, and the Refresh button moves into that slot as the standard pattern rather than the exception.

- Evidence: `src/components/settings/UserModelsSection.jsx:103` — `<h3 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: LIGHT_INK }}>   AI models`<br>`src/components/settings/VersionPanel.jsx:68` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Version &amp; Updates</h2>`




**S4 · HIGH · Colour** — 49 raw colour values plus 29 Tailwind colour utilities on one surface  
**constraint: palette-decision** · law: Law of Prägnanz

- Problem: Counted across the ten files: 49 distinct hex and rgba literals and 29 distinct Tailwind colour utilities. Among them are four near-blacks used as body ink (#1c1917 x42, text-stone-950 x27, text-stone-900 x25, text-stone-800), four greens, five reds, four ambers and oranges used as chrome, plus two cool values that the palette bans outright.

- Why it matters: The system review counts 121 across the whole app; this one surface holds 49 of them. It is not a palette, it is an accumulation, and it is the reason no two panels on this screen look like the same product.

- Change: Collapse to the proposed set: ink-light for all text on this surface, LIGHT_RULE for every hairline, LIGHT_WELL for every grouping fill, LIGHT_SURFACE_SOLID for floating panels, #ea580c as the single signal, plus the three functional tokens. A new value has to justify itself against a screen of an existing one, and on this surface none of the 49 can.

- Evidence: `src/components/SettingsPage.jsx:419` — `color: petData.state === 'dead' ? '#ef4444' :        petData.state === 'starving' ? '#ef4444' :`<br>`src/components/SettingsPage.jsx:733` — `style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #166534' }}`<br>`src/components/settings/StorageConnections.jsx:73` — `const DANGER_BTN = { color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }`




**S8 · MEDIUM · Colour** — The body copy is darker than the heading above it, so colour inverts the hierarchy  
law: Law of Similarity

- Problem: Section headings are text-stone-900 (#1c1917) and the paragraph under them is text-stone-950 (#0c0a09). The description is literally the darker ink. Three near-blacks are in circulation - stone-900, stone-950 and the LIGHT_INK token, which is stone-900 again under another name.

- Why it matters: lightSurface.js:27 states the rule this breaks: 'Hierarchy on a light surface comes from SIZE and WEIGHT.' Once a second black appears it starts competing with size, and here it competes in the wrong direction.

- Change: One ink. Every piece of text on this surface becomes LIGHT_INK. Delete text-stone-950, text-stone-900 and text-stone-800 from all ten files. Rank comes from 16/14/13/12/11 and from 600 versus 400, nothing else.

- Evidence: `src/components/SettingsPage.jsx:389` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">`<br>`src/components/SettingsPage.jsx:392` — `<p className="text-xs text-stone-950 mb-4 leading-relaxed">`<br>`src/components/lightSurface.js:27` — `// Hierarchy on a light surface comes from SIZE and WEIGHT, and emptiness from // italic. Not from a second ink`




**S26 · MEDIUM · System** — Two system-prompt editors, two wells, two inks, two sizes, in two tabs, editing the same kind of thing  
law: Law of Similarity

- Problem: The Agent tab's prompt textarea is h-48, text-xs font-mono, on the brown 0.55 well with #fde8d0 text. The Agent Skills tab's prompt textarea is rows={10}, text-[11px] font-mono, on a #1c1917 well with #f4a261 text and an explicit lineHeight of 1.5. The read-only preview of the first is a third treatment again: text-[10px] on rgba(120,70,30,0.35), truncated with a literal '...'.

- Why it matters: These are the same object one tab apart. The dark well in Agent Skills is the 'drop a dark input onto the orange field' workaround the system review identifies as a symptom of the light-page ceiling, and here it sits beside a version that did not take that workaround, so the user sees two answers to one question.

- Change: One TextArea: the light-surface well, LIGHT_INK, 13px Dense, mono, leading 1.5, resize-y, one focus ring. The read-only preview becomes the same control with disabled styling rather than a third bespoke box, and the '...' truncation is replaced by a max-height with a fade or an explicit character count.

- Evidence: `src/components/SettingsPage.jsx:1079` — `className="w-full h-48 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y" style={inputStyle}`<br>`src/components/settings/AgentSkillsSection.jsx:161` — `className="w-full px-3 py-2 text-[11px] font-mono rounded-sm ... resize-y" style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', lineHeight: '1`<br>`src/components/SettingsPage.jsx:1083` — `<div className="px-3 py-2 rounded-sm text-[10px] text-stone-950 font-mono leading-relaxed max-h-24 overflow-hidden"`




**S28 · MEDIUM · System** — The Models tab's select is the only control on the surface with no background, so it renders in the OS grey on orange  
law: Law of Similarity

- Problem: UserModelsSection's select sets only a border and a colour. With no background-color it falls back to Chrome's UA ButtonFace, a near-white grey, on the #f4a261 page. Every other select on the surface (ProfileSection, CurrencyPicker, the rate-card picker) paints the brown well.

- Why it matters: This is the 'NO WHITE BACKGROUND' defect from the Rate Card, reappearing 28 times on one tab because it is inside a map. It is also a second inconsistency: the same control type has two appearances within one screen.

- Change: Route it through the shared Select: LIGHT_WELL fill, 1px LIGHT_RULE, LIGHT_INK text, 28px, 13px Dense. Replace the 190px minWidth with a fixed column so the 28 rows form a real column rather than 28 independently-sized controls.

- Evidence: `src/components/settings/UserModelsSection.jsx:193` — `className="px-2 py-1 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40" style={{ border: '1px solid ${LIGHT_RULE}`<br>`src/components/settings/ProfileSection.jsx:398` — `className={'${inputClass} cursor-pointer'} style={inputStyle}`




**S9 · MEDIUM · Colour** — Two pale pastel chips are dropped straight onto the orange page  
law: Law of Common Region

- Problem: The 'In use' badge is #dcfce7 on #166534 and the 'Read only' badge is #fee2e2 on #991b1b, both at text-[9px] with a 1px border in the same hue. They are the only near-white fills on the surface and they sit on a saturated orange ground.

- Why it matters: Audrey's Rate Card ruling was 'NO WHITE BACKGROUND', and lightSurface.js records the reason: a near-white card dropped on the orange page reads as a foreign object. At 9px these are also below the type floor.

- Change: Both become the shared StatusBadge at the 11px Label step: LIGHT_WELL fill, LIGHT_INK label, a 6px status dot carrying the semantic colour from the success/danger tokens. The fill stops being the semantic carrier, so the badge stops being a pastel patch.

- Evidence: `src/components/SettingsPage.jsx:733` — `style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #166534' }}`<br>`src/components/SettingsPage.jsx:741` — `style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #991b1b' }}`




**S11 · MEDIUM · Colour** — The pet status word is a six-value colour ladder including a violet and a cool grey, on a palette that bans cool hues  
**constraint: touches-pets** · law: Von Restorff Effect

- Problem: petData.state maps to #ef4444, #ef4444, #f59e0b, #8b5cf6, #6b7280 and #22c55e in a nested ternary. #8b5cf6 is violet and #6b7280 is a cool grey; visual-language.md Composition rule 2 says 'Warm over cool. No blues, no cyans.' The whole ladder is also colour-only, at 10px uppercase, with no text or icon differentiator.

- Why it matters: Six unlabelled colours is more categories than a status field needs and two of them are outside the palette. A user cannot tell 'lonely' from 'sleeping' without reading the word anyway, which means the colour is decoration rather than information.

- Change: Route it through StatusBadge with a semantic token per state: danger for dead and starving, warning for hungry, neutral (ink at 48%) for lonely and sleeping, success for the healthy default. That is four values instead of six, all from the shared set, and it retires #8b5cf6 and #6b7280 from the surface.

- Evidence: `src/components/SettingsPage.jsx:418` — `<span className="text-xs uppercase font-bold tracking-wider" style={{   color: petData.state === 'dead' ? '#ef4444' :`<br>`src/components/SettingsPage.jsx:422` — `petData.state === 'lonely' ? '#8b5cf6' : petData.state === 'sleeping' ? '#6b7280' :`




**S31 · MEDIUM · System** — The tab bar signals active three ways at once, one of which is a 4.05:1 white label  
law: Von Restorff Effect

- Problem: The active tab gets a filled 0.55 brown well, an ink flip from LIGHT_INK to #ffffff, and a 2px #f97316 bottom border, with a rounded-t-sm corner treatment used nowhere else in the app. The white active label on that composited well measures 4.05:1 at 12px bold, under AA.

- Why it matters: Three simultaneous active signals is two too many, and the one doing the most visual work is also the one failing contrast. The system review counts four tab bars with three active treatments app-wide; this is the fourth variant.

- Change: One Tabs component: 14px sentence case, 400 inactive and 600 active, LIGHT_INK in both states, a single 2px #ea580c underline for active, no fill, no corner radius. Contrast then becomes 8.49:1 in both states and the active signal is a single unambiguous mark.

- Evidence: `src/components/SettingsPage.jsx:338` — `backgroundColor: activeTab === tab.key ? 'rgba(120, 70, 30, 0.55)' : 'transparent', color: activeTab === tab.key ? '#ffffff' : LIGHT_INK, borderBottom: activeTa`




**S14 · MEDIUM · Flow** — The Storage tab presents about twenty controls under six equal-weight headings in one scroll  
law: Hick's Law

- Problem: Storage Backend (3 radio buttons), Storage Connections (3 cards, with up to 5 buttons in the local demo card plus 2 more per remembered folder), MigrationPanel, OtterMigrationPanel, Default Project Currency, Default Rate Card, and Task Templates - all at the same visual rank, all expanded, all at once. The local demo card alone stacks five same-sized buttons across two wrapping rows, one of which is destructive.

- Why it matters: Hick's Law is logarithmic in the number of options, and nothing here is chunked beyond a 32px gap. Three of these groups (both migration panels and Task Templates) are operations a user performs once, sitting at the same rank as settings they change routinely.

- Change: Keep every control and every view. Chunk with the shared SectionTitle plus a hairline above each group, and collapse the two migration panels behind one 'Data migration' disclosure that is closed by default - this is progressive disclosure, not removal, and both panels stay one click away. Inside the local demo card, split the five buttons into a primary row (Change folder, Open in Explorer) and a quiet row (Close folder, Create demo project, Reset demo folder) with Reset rendered as the danger variant so it stops looking like a peer of Create.

- Evidence: `src/components/SettingsPage.jsx:767` — `<StorageConnections />  <MigrationPanel />`<br>`src/components/settings/StorageConnections.jsx:357` — `<div className="flex items-center gap-2 flex-wrap" data-local-card="comfort">`




**S15 · MEDIUM · Flow** — The same setting is rendered twice, in two tabs, in two visual languages  
**constraint: touches-interaction** · law: Mental Model

- Problem: SettingsPage's 'Project Files Location' (General tab) and StorageConnections' 'Project files root' (Storage tab) both read and write defaultRootDir through readFilesConfig/writeFilesConfig. The first is a bordered panel with a mono path block and three chunky uppercase buttons; the second is a single hairline-topped row with a truncated 11px path and one 'Change folder' button.

- Why it matters: Mental Model: one value should have one home. Two homes with two appearances means a user who changes it in one place has no reason to believe the other agrees, and the two do not even present the same states (the General panel has a Clear action the Storage row does not).

- Change: Render both mount points from one component so they are byte-identical, or - better - keep only the Storage one and leave a one-line pointer in General. The single-component route is safe; removing the General panel is the stronger design but it changes what is reachable from that tab and it will break a test that counts GatedAction occurrences in SettingsPage.jsx.

- Evidence: `src/components/SettingsPage.jsx:577` — `{/* Project Files Root Directory */} <div>   <h2 ...>Project Files Location</h2>`<br>`src/components/settings/StorageConnections.jsx:437` — `<span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Project files root</span>`<br>`src/lib/workspaceRootWiring.test.js:282` — `const gated = settingsPage.match(/GatedAction allowed=\{canEditMachineRoot\}/g) || []`




**S27 · MEDIUM · System** — Five empty/loading treatments, three sizes, two alignments, and one off-palette ink  
law: Zeigarnik Effect

- Problem: 'Loading profile…' is py-8 text-xs font-mono italic; the no-profile state reuses that exact treatment and doubles as the error display with only an ink flip; 'Checking your account…' appears twice at text-xs font-mono italic in two files; the Models tab's loading line is a 11px non-italic sentence inside a paragraph; the departments empty state is text-xs font-mono italic py-4 text-center - the only centred text on the surface; and the rate-card empty state is text-[11px] font-mono italic in #7c2d12, an ink used nowhere else.

- Why it matters: Loading and empty are different states with different remedies, and here they are drawn identically - the Profile panel literally uses one block for 'loading', 'nothing here' and 'it failed'. A user cannot tell which one they are looking at.

- Change: Two components. Loading renders skeleton rows for the model and department lists and a spinner elsewhere. EmptyState renders a 24px icon, a 14px sentence-case title, 13px body and an action slot, always left-aligned. Errors get the Toast or the inline error treatment from S10, never the empty-state treatment. Delete the centred variant and the #7c2d12 ink.

- Evidence: `src/components/settings/ProfileSection.jsx:286` — `if (!row) {   return (     <div className="py-8 text-xs font-mono italic" style={{ color: error ? '#dc2626' : LIGHT_INK }}>`<br>`src/components/SettingsPage.jsx:896` — `<div className="text-xs font-mono italic py-4 text-center" style={{ color: LIGHT_INK }}>`<br>`src/components/SettingsPage.jsx:801` — `<div className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>`




**S24 · MEDIUM · Density** — Eleven distinct button padding pairs, no control-height token, so no two toolbars share a baseline  
law: Fitts's Law

- Problem: px-3 py-2 (15), px-3 py-1.5 (12), px-4 py-2 (10), px-3 py-1 (9), px-2 py-1 (9), px-4 py-3 (2), px-4 py-1.5 (2), px-1.5 py-0.5 (2), px-5 py-2, px-2 py-2, px-2 py-0.5. That resolves to roughly seven different rendered heights between 20px and 48px, and the buttons sitting in one flex row frequently come from different pairs.

- Why it matters: Fitts's Law bites here twice: the smallest targets on the surface are the destructive ones (Reset History and New Pet at px-3 py-1.5 text-[10px], about 26px tall), and a row of mixed-height buttons has no shared baseline, which is the mechanical cause of the 'placement looks off' note in the brief.

- Change: Two heights only: 28px for dense/toolbar controls and 36px for primary actions and form fields, with one padding pair each. The CurrencyPicker trigger drops from px-4 py-3 (48px) to 36px so it matches the rate-card select beneath it. Every button in a flex row shares the 28px height so the row has one baseline.

- Evidence: `src/components/settings/CurrencyPicker.jsx:59` — `className="w-full flex items-center justify-between px-4 py-3 text-sm font-mono rounded-sm ..."`<br>`src/components/SettingsPage.jsx:502` — `className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors border"`<br>`src/components/settings/StorageConnections.jsx:79` — `className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm disabled:cursor-default"`




**S30 · MEDIUM · System** — Five icon sizes on one surface, and most buttons have no icon at all  
law: Law of Similarity

- Problem: 16px (StorageConnections Card header), 14px (VersionPanel button icons), 13px (SessionSection LogOut), 12px (StorageConnections SmallButton), 11px (UserModelsSection RefreshCw and RotateCcw). Meanwhile every button in SettingsPage itself and every button in ProfileSection and PasswordSection has no icon, so icon presence is not carrying meaning either.

- Why it matters: Icon size is a rank signal. Five sizes with no rule means it signals nothing, and the mixture of iconed and icon-less buttons in adjacent groups makes two identical actions look like different classes of thing.

- Change: Three sizes: 14px inside dense controls, 16px in rows and buttons, 24px in empty states. Icons appear on a button only when the button is an object action (folder, explorer, refresh, sign out) and never on a plain form submit. Apply the rule across all ten files rather than per file.

- Evidence: `src/components/settings/UserModelsSection.jsx:118` — `<RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh`<br>`src/components/settings/VersionPanel.jsx:88` — `<Download className="w-3.5 h-3.5" /> Download update`<br>`src/components/settings/SessionSection.jsx:77` — `<LogOut size={13} />`




**S29 · MEDIUM · System** — Four text glyphs stand in for icons on a surface that documents lucide-react as the only icon source  
law: Law of Similarity

- Problem: A lock emoji marks a locked subject; the department remove control is an HTML &times; entity at text-sm; the currency dropdown caret is a literal up/down triangle in text-stone-400; the skill checkbox tick is a text check character. visual-language.md Composition rule 5 says 'No emojis in UI. Use lucide-react icons.'

- Why it matters: Text glyphs do not share the icon set's stroke weight, optical size or alignment, and they inherit the text baseline rather than centring in their box - the &times; in particular sits high in its 24px hit area. The emoji also renders in the OS colour-emoji font, which is the single most off-brand pixel on the surface.

- Change: Lock -> lucide Lock at 14px. &times; -> lucide X at 14px inside a 28px icon button. Triangle -> lucide ChevronDown with a rotate transform, LIGHT_INK not stone-400. Check character -> lucide Check at 12px inside the 16px checkbox.

- Evidence: `src/components/SettingsPage.jsx:1013` — `{isLocked && <span title="Locked">🔒</span>}`<br>`src/components/SettingsPage.jsx:1212` — `<span className="text-sm font-mono">&times;</span>`<br>`src/components/settings/CurrencyPicker.jsx:66` — `<span className="text-stone-400 text-xs">{open ? '▲' : '▼'}</span>`




**S38 · MEDIUM · Colour** — The CurrencyPicker trigger puts a 1.74:1 grey and a 2.40:1 orange on the brown well  
law: Aesthetic-Usability Effect

- Problem: The caret is text-stone-400 (#a8a29e) on the 0.55 well, which measures 1.74:1. The currency symbol beside it is text-orange-300 (#fdba74) at 2.40:1. Both are on a light-orange page inside a brown well, which is exactly the surface class Audrey's rule governs.

- Why it matters: This is literal grey-on-orange, the defect the rule was written for, surviving in a control that is one of the more prominent things on the Storage tab because it is 48px tall and full width.

- Change: Caret and symbol both become LIGHT_INK. The symbol keeps its distinction through the 12px Caption step and a fixed-width column rather than through colour. If a tint is wanted for the symbol, screen LIGHT_INK, do not introduce an orange.

- Evidence: `src/components/settings/CurrencyPicker.jsx:63` — `<span className="text-orange-300 mr-2">{current.symbol}</span>`<br>`src/components/settings/CurrencyPicker.jsx:66` — `<span className="text-stone-400 text-xs">{open ? '▲' : '▼'}</span>`




**S39 · MEDIUM · System** — ModelPicker lives in src/components/settings/ but renders only inside D.O.G., on a dark surface, duplicating UserModelsSection's job in a different language  
law: Mental Model

- Problem: ModelPicker has zero call sites in Settings; its only four callers are in DeckOutlineGenerator.jsx. It is styled dark (bg-stone-950, border-2 border-stone-600, text-orange-400, text-stone-500) and it labels the inherit option 'Default (X)' with a 'Reset to default' link, while UserModelsSection labels the same option 'Inherit (X)' with a 'Reset' button in a light 1px treatment.

- Why it matters: The rework session will open the settings folder and restyle everything in it to the light surface, which would paint a dark-page control light and break D.O.G. It also means one decision - which model runs this function - has two visual languages and two vocabularies depending on where the user meets it.

- Change: Move ModelPicker to src/tools/deck-outline-generator_v0.514/ or to a shared ui folder, and mark it explicitly dark-surface. Unify the vocabulary with UserModelsSection: one word for the inherit option and one word for the reset action across both. The system review did not anticipate this file, and it is the one landmine in this folder.

- Evidence: `src/components/settings/ModelPicker.jsx:95` — `className={'px-2 py-1 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400`<br>`src/components/settings/ModelPicker.jsx:102` — `<option value="">Default ({defaultLabel})</option>`<br>`src/components/settings/UserModelsSection.jsx:196` — `<option value="">Inherit ({labelFor(withoutMe.model)})</option>`




**S21 · MEDIUM · Alignment** — The version footer aligns to nothing  
law: Serial Position Effect

- Problem: The footer is px-6 pb-3 on the outer flex column, while the content above it is centred in a max-w-2xl inside a px-8 wrapper. So the version string starts 24px from the window edge while the content it belongs to starts wherever the centring puts it - typically 300px further right.

- Why it matters: It is the last thing on the page and the only element outside the column, which makes it read as a stray rather than a footer. Serial Position says the last item is disproportionately remembered.

- Change: Move it inside the 720px column, left-aligned to the same gutter as everything else, at the 11px Label step in mono with a hairline above. It then closes the column rather than floating beside it.

- Evidence: `src/components/SettingsPage.jsx:1110` — `<div className="flex justify-start px-6 pb-3">   <span className="text-xs text-stone-950 font-mono">{wilsonVersion}</span>`<br>`src/components/SettingsPage.jsx:329` — `<div className="flex-1 flex justify-center py-8 px-8 overflow-auto">`




**S23 · MEDIUM · Density** — Three stacked variable paddings sit above the app's longest scroll  
**constraint: touches-transition** · law: Cognitive Load

- Problem: The Settings bars are 200/150 from pageBars.js, App.jsx adds '3vh 0' to the content wrapper, and SettingsPage adds py-8 px-8 of its own. On a 900px viewport that is roughly 350px of orange chrome plus 54px of vh padding plus 64px of component padding before the tab bar appears - about half the window - on the surface that scrolls most.

- Why it matters: This is emptiness, not structural whitespace: the space is not gutter, it is bar. It also changes with window height because of the vh, so the gap above the tabs is not a constant and cannot be designed against.

- Change: Second the system review's 120/80 for the resource-page class, which returns about 150px of field here, and replace App.jsx's '3vh 0' with a flat 24px so the top gutter stops moving. SettingsPage's own py-8 px-8 then goes away entirely: the page gutter is owned by the shell, not by each page.

- Evidence: `src/layout/pageBars.js:93` — `settings:           bars(200, 150),`<br>`src/App.jsx:2100` — `padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',`<br>`src/components/SettingsPage.jsx:329` — `<div className="flex-1 flex justify-center py-8 px-8 overflow-auto">`




**S17 · MEDIUM · Flow** — Seven ungrouped tabs, three of which are AI configuration  
law: Hick's Law

- Problem: General, Profile, Models, Storage, Teams, Agent, Agent Skills. Models, Agent and Agent Skills are all 'how the AI behaves'; General and Profile are both 'this account'; Storage and Teams are both 'this workspace's data'. Nothing in the bar says so, so the user reads seven peers.

- Why it matters: Miller's Law tolerates seven, but Hick's Law counts undifferentiated choices, and three doors into AI configuration with no visual relationship is the classic case the law is quoted for.

- Change: Keep all seven tabs, all in the same order, all reachable. Add two hairline separators inside the bar so the reading becomes [General | Profile] [Models | Storage | Teams] [Agent | Agent Skills]. This is a purely visual grouping: no tab moves, nothing collapses, and the shared Tabs component already specifies an optional group separator.

- Evidence: `src/components/SettingsPage.jsx:314` — `const tabs = [     { key: 'general', label: 'General' },     { key: 'profile', label: 'Profile' },`<br>`src/components/SettingsPage.jsx:324` — `{ key: 'skills', label: 'Agent Skills' },`




**S37 · MEDIUM · Build** — A 1216-line component holds all seven tabs, and four source-text tests read these two files as strings  
law: Tesler's Law

- Problem: SettingsPage.jsx renders every tab inline with no sub-components except DepartmentRow. Separately, localDemoWiring, localMediaWiring, workspaceRootWiring and userStateWiring all readFileSync SettingsPage.jsx and StorageConnections.jsx and assert against the raw text - including exact button copy ('Change folder…'), exact prose ('for demos only: its projects stay on this computer and cannot be shared.'), a data attribute (data-local-card="demo-only"), a count of GatedAction occurrences, and the ORDER of two JSX tags within 400 characters.

- Why it matters: This is the dominant execution risk on this surface. A rework session that restructures the JSX, renames a button, or inserts markup between MfaSecuritySection and SessionSection will go red in tests that have nothing to do with design, and the failure message will not say why.

- Change: Before touching markup, extract the seven tab bodies into GeneralTab / ProfileTab / ModelsTab / StorageTab / TeamsTab / AgentTab / SkillsTab inside src/components/settings/, keeping every literal string and every data-local-card attribute byte-identical, and update the four test files' read targets in the same commit. Do the type and colour pass afterwards, on the smaller files.

- Evidence: `src/lib/userStateWiring.test.js:156` — `expect(settingsPage).toMatch(/<MfaSecuritySection\s*\/>[\s\S]{0,400}<SessionSection\s*\/>/)`<br>`src/lib/localMediaWiring.test.js:125` — `expect(settingsPage).toContain('for demos only: its projects stay on this computer and cannot be shared.')`<br>`src/lib/localDemoWiring.test.js:218` — `expect(storageConnections).toContain('Change folder…')`




**S16 · LOW · Job** — 'AI Features' is a section heading and a paragraph with no control, dressed identically to sections that have controls  
law: Law of Similarity

- Problem: The block is an h2 at the same rank as Companion and Project Files Location, followed by two lines of prose, and then it ends. There is nothing to set.

- Why it matters: Law of Similarity again: it looks like a settings group, so the user scans it for a control and finds none. It is a note wearing a section's clothes.

- Change: Demote it to a note: 13px body, LIGHT_INK, inside a LIGHT_WELL block with a 16px lucide Info glyph, and move it under the Models tab heading where it actually answers a question the user is about to ask. No section rank, no h2.

- Evidence: `src/components/SettingsPage.jsx:388` — `<div>   <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">     AI Features`




**S33 · LOW · System** — Settings has live keyboard affordances and shows no hint for any of them, while the Kbd component already exists in the codebase  
law: Paradox of the Active User

- Problem: Enter adds a department; Enter commits a rename; Escape reverts a rename. None of the three is hinted anywhere. Meanwhile BinsView mounts a 34px bottom bar with twelve Kbd hints and binUi exports a Kbd component built for exactly this.

- Why it matters: This is Audrey's own named example, and the diagnosis is the reverse of how she phrased it: the problem is not that bins has a shortcut bar, it is that the one component that could make keyboard affordances visible has exactly one consumer. Paradox of the Active User says nobody will discover Escape-to-revert from a manual.

- Change: Settings registers no document-level keys, so it does not warrant a full ShortcutBar. Use the shared Kbd inline instead: a 12px Caption hint reading 'Enter to add' beside the department input, and 'Enter to save, Esc to cancel' beneath the row while it is in edit state. Same Kbd component, same 11px Label step, same hairline box as bins. That is the shared visual language she is asking for, expressed at the density this surface needs.

- Evidence: `src/components/SettingsPage.jsx:869` — `onKeyDown={(e) => { if (e.key === 'Enter') handleAddDepartment() }}`<br>`src/components/SettingsPage.jsx:1187` — `if (e.key === 'Enter') commit() if (e.key === 'Escape') { setDraft(name); setEditing(false) }`<br>`src/tools/rabbit_v0.1.0/views/bins/binUi.jsx:134` — `export function Kbd({ children }) {   return (     <kbd className="inline-block px-1 rounded-sm text-[9px] font-mono leading-[14px]"`




**S34 · LOW · Motion** — A 500ms transition on a data bar, a save confirmation with no transition at all, and a spinner with no reduced-motion fallback  
**constraint: touches-pets** · law: Doherty Threshold

- Problem: The hunger and happiness bars animate width over 500ms, which is in the decorative band for what is a state readout. The 'Saved.' confirmation appears and vanishes instantly on a 2500ms setTimeout with no fade, in a position the user may not be looking at. The RefreshCw animate-spin in UserModelsSection and VersionPanel has no prefers-reduced-motion handling.

- Why it matters: Every move needs a reason: causality, attention, or covering a state change. The 500ms width is none of the three because the value changes only on a data refresh the user did not initiate. The save confirmation is the one moment that does need attention and gets no motion at all.

- Change: Bars drop to 160ms ease-out. The save confirmation moves into the shared Toast (bottom centre, 24px up) with a 160ms fade in and out, which also unifies it with the app's other three toast systems. Add a prefers-reduced-motion rule that stops the spinner and delivers end states instantly.

- Evidence: `src/components/SettingsPage.jsx:437` — `<div className="h-full transition-all duration-500" style={{ width: '${Math.round(petData.hunger)}%', backgroundColor: '#f97316' }} />`<br>`src/components/settings/ProfileSection.jsx:205` — `setTimeout(() => setSavedFlash(false), 2500)`




**S36 · LOW · Colour** — The connection dot uses a 45 percent black screen, which is a grey by another name, on an orange surface  
law: Law of Similarity

- Problem: Dot renders rgba(28,25,23,0.45) for the disconnected state, which flattens to a mid grey on #f4a261. lightSurface.js:29 warns against exactly this: 'the moment a lighter grey comes back to mean "less important", the rule above is broken again.'

- Why it matters: The letter of the rule covers text, so this is not a contrast failure, but it is the mechanism the rule exists to stop, and the dot is the only thing distinguishing connected from disconnected in three cards.

- Change: Off state becomes a ring: a 1px LIGHT_RULE circle with no fill. On state stays a solid success fill. The pair then differs in form as well as value, which also makes it legible without colour.

- Evidence: `src/components/settings/StorageConnections.jsx:51` — `style={{ backgroundColor: on ? '#22c55e' : 'rgba(28, 25, 23, 0.45)' }}`




**S35 · LOW · Build** — The tab bar is seven plain buttons with no tablist semantics  
law: Jakob's Law

- Problem: No role="tablist", no role="tab", no aria-selected, no arrow-key navigation. The visual active state is the only signal a tab is selected.

- Why it matters: Screen reader users get seven unrelated buttons and no indication which view is showing. It is cheap to fix while the Tabs component is being written and impossible to retrofit cheaply afterwards.

- Change: Bake role="tablist" / role="tab" / aria-selected / aria-controls into the shared Tabs component. Arrow-key navigation is optional and would change interaction, so leave it out unless Audrey asks.

- Evidence: `src/components/SettingsPage.jsx:334` — `<button   key={tab.key}   onClick={() => setActiveTab(tab.key)}`




**S40 · LOW · Density** — The Models tab renders 28 rows as a wrapping flex list rather than a table, so the select column does not exist  
law: Law of Proximity

- Problem: Each row is a flex with flex-wrap, a min-width 200px label block and a min-width 190px select. At the 672px column width the rows hold, but the select's left edge moves with the label's content, and adding the conditional Reset button pushes the row to wrap. There are 28 of these in three groups.

- Why it matters: Twenty-eight repeated rows with a control in each is a table by every definition except the markup. Without a fixed control column the eye cannot scan down the choices, which is the one thing a user comes to this tab to do.

- Change: Give the row three fixed tracks: function label and provenance (flex), select (fixed 220px), reset (fixed 72px, reserved whether or not it renders so the column never shifts). Hairline dividers between rows, 36px row height, the tool group header at the 11px Label step. No change to the controls or the data, only the geometry.

- Evidence: `src/components/settings/UserModelsSection.jsx:173` — `<div className="flex items-center gap-2 flex-wrap">   <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>`<br>`src/components/settings/UserModelsSection.jsx:148` — `<div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: LIGHT_INK }}>{tool}</div>`




**S41 · LOW · System** — The adapter radio list is the only 2px border on this light surface and wears four emphasis mechanisms on one 12px label  
law: Law of Prägnanz

- Problem: Each adapter button carries border: 2px solid, and its label is text-[12px] font-mono font-bold uppercase tracking-wider - mono plus bold plus uppercase plus tracking, simultaneously, at 12px. The hand-built radio dot is a 12px circle with a 2px #7c2d12 border.

- Why it matters: RABBIT already uses 1px in 912 places; a 2px rule against 12px type is roughly a sixth of the cap height and is the measurable reason this block reads heavier than everything above it. Four emphasis mechanisms on one label is the flat-field problem in miniature.

- Change: 1px hairline throughout, LIGHT_RULE when inactive and #ea580c when active. Label becomes 14px sentence case 600, no mono, no tracking. The hint beneath becomes 13px Dense. The radio dot keeps its shape but takes a 1px rule and the signal fill.

- Evidence: `src/components/SettingsPage.jsx:713` — `border: '2px solid ${active ? '#ea580c' : 'transparent'}',`<br>`src/components/SettingsPage.jsx:724` — `<span className="text-[12px] font-mono font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>`




**S42 · LOW · System** — The two confirm modals are the only 6px radius and the only hard-coded monospace font-family in the app's settings surface  
law: Peak-End Rule

- Problem: Both dialogs set borderRadius '6px', fontFamily 'monospace' as a literal, letterSpacing '0.15em' on a 14px uppercase title, and a 4px radius on their buttons - so one dialog contains two radii, neither of which is used anywhere else on the surface (which is otherwise 2px, 70 times).

- Why it matters: These are the highest-stakes moments on the page - resetting pet history and releasing a ghost - and they are rendered by the least systematic code on it, with every value inline and none of it shared.

- Change: Replace both with the shared Dialog: one 8px radius on the surface, 4px on the buttons, one backdrop, one shadow, the body at 14px Body and the title at 16px sentence case 600. Delete the inline fontFamily; the face comes from the app.

- Evidence: `src/components/SettingsPage.jsx:1118` — `<h2 style={{ color: '#ea580c', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'mono`<br>`src/components/SettingsPage.jsx:1125` — `style={{ flex: 1, padding: '8px 16px', fontSize: '11px', ... borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}`




**S43 · LOW · Typography** — Mono is doing label duty in 26 of its 43 uses on this surface  
law: Jakob's Law

- Problem: font-mono appears 43 times here. Seventeen are legitimate (paths, version, pet numerics, the JSON schema block, the prompt textareas). The other twenty-six are on labels, empty-state sentences, status lines, button text, the department name, 'Saved.', 'Checking your account…', the adapter label and the currency trigger - ordinary UI copy set in the browser's fallback mono.

- Why it matters: This is the local instance of the app-wide diagnosis. Mono in a settings label reads as a terminal readout, which is the specific dated quality the brief names, and it costs measure because mono is wider at the same nominal size.

- Change: Keep mono in exactly seven places on this surface: PathLine, the version string and chip, the hunger/happiness numerics, the tool-schema pre, both prompt textareas, and the Kbd hints from S33. Everything else moves to the sans. That is 26 deletions from one surface.

- Evidence: `src/components/settings/SessionSection.jsx:50` — `<p className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>   Checking your account…`<br>`src/components/SettingsPage.jsx:1197` — `className="flex-1 text-left text-xs font-mono px-2 py-1 rounded-sm hover:bg-stone-200 transition-colors"`<br>`src/components/settings/StorageConnections.jsx:79` — `className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm disabled:cursor-default"`




**S44 · LOW · System** — Hover states are invented per element, and three of them use a cool stone that does not exist on this page  
law: Law of Similarity

- Problem: DepartmentRow hovers to bg-stone-200/40 on the row and bg-stone-200 on the name button and bg-stone-300 on the remove button - three different hovers inside one 40px row. The skill checkbox rows hover to bg-stone-800/30, a dark fill on a light surface. Two buttons hover to bg-red-50. The pet danger buttons swap border and text colour through inline onMouseEnter/onMouseLeave handlers.

- Why it matters: Stone-200 and stone-300 are cool greys on a warm page, so the hover reads as a different material. The inline mouse handlers are also the only JS-driven hover on the surface, which means that state cannot be themed or tested with the others.

- Change: One hover token for the whole surface: rgba(28,25,23,0.06). One selected token: rgba(234,88,12,0.10) with a 2px signal left border. Delete every bg-stone-* hover and both inline onMouseEnter/onMouseLeave pairs, replacing the danger hover with the Button danger variant's own hover.

- Evidence: `src/components/SettingsPage.jsx:1177` — `className="flex items-center gap-2 px-3 py-2 rounded-sm transition-colors hover:bg-stone-200/40"`<br>`src/components/SettingsPage.jsx:508` — `onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}`<br>`src/components/settings/AgentSkillsSection.jsx:189` — `className="w-full flex items-start gap-3 px-2 py-2 text-left rounded-sm transition-colors hover:bg-stone-800/30"`





## Uniformity gaps

- **Page header / page title** — here: There is none. The content area opens directly onto the tab bar (src/components/SettingsPage.jsx:329-332), so the only place the word Settings appears is the nav strip and the 400ms transition overlay. — elsewhere: No page on the app has a real PageHeader; D.O.G. and O.T.T.E.R. carry their own top chrome inside the 95px bar, and the resource pages carry nothing. — do: Mount the shared PageHeader (56px, 24px gutter, 20px sentence-case title, optional subtitle, right-hand actions slot) driven by the PAGES registry, so the page title and the transition title are one value.

- **Section title** — here: h2 text-sm font-bold uppercase tracking-widest text-stone-900 mb-1, repeated twelve times across seven files, except UserModelsSection which uses h3 text-xs (src/components/settings/UserModelsSection.jsx:103) and AgentSkillsSection's per-tool header which uses h3 text-xs (AgentSkillsSection.jsx:106). — elsewhere: HelpPage's local L.sectionTitle is 'text-sm font-bold text-stone-900 uppercase tracking-wide' - the same idea with a different tracking step, which is how the drift started. — do: One SectionTitle: 16px sentence case 600, no tracking, optional 13px description, optional 11px Label eyebrow, hairline above instead of a filled bar.

- **Buttons** — here: Four competing treatments (S7) across 49 button elements, eleven padding pairs, five icon sizes, zero focus styles, and three private token objects in StorageConnections.jsx:71-73. — elsewhere: binUi.jsx exports Btn and IconBtn with one size contract, which is the best button implementation in the codebase and has one consumer. — do: Promote binUi's Btn as src/ui/Button with variants primary/secondary/ghost/danger and sizes sm 28px / md 36px, plus a light-surface palette. Every one of the 49 buttons here routes through it.

- **Inputs and selects** — here: Four copies of one inputStyle literal (SettingsPage.jsx:250, ProfileSection.jsx:264, PasswordSection.jsx:126, CurrencyPicker.jsx:33), two copies of inputClass and labelClass, plus one select with no background at all (UserModelsSection.jsx:193). — elsewhere: binUi's Input keeps the best input interaction in the app - Escape reverts the edit - and nothing on this surface has it except DepartmentRow, which reimplements it by hand at SettingsPage.jsx:1188. — do: One Input/TextArea/Select/Field with a light-surface variant, keeping binUi's Escape-reverts behaviour, on the LIGHT_WELL rather than the 0.55 well.

- **Dialogs and confirmations** — here: Four mechanisms: two hand-rolled inline-styled overlays (SettingsPage.jsx:1116, :1137), four window.confirm calls (SettingsPage.jsx:1206, StorageConnections.jsx:167, :212, :241), an inline confirm row (SessionSection.jsx:81), and an inline confirm block (StorageConnections.jsx:315). — elsewhere: binUi's Modal already handles the modal stack, topmost-only Escape, busy lock, in-footer error and an onBeforeClose guard. The app has 66 hand-rolled overlays across 36 files. — do: Promote binUi's Modal as src/ui/Dialog and route every destructive confirmation on this surface through it. Keep the inline confirm only for the non-destructive in-place case.

- **Tabs** — here: Fill plus ink flip plus 2px underline plus rounded-t-sm, with a 4.05:1 active label (SettingsPage.jsx:337-342). — elsewhere: The app has four tab bars with three active treatments; visual-language.md documents a fourth (text-orange-500 plus a 2px bottom border, no fill). — do: One Tabs component: 14px sentence case, 400/600, one 2px #ea580c underline, no fill, optional group separator - which S17 then uses to chunk the seven tabs.

- **Status badges and pills** — here: Two pastel chips at 9px (SettingsPage.jsx:733, :741), one six-value inline colour ladder for the pet state (:418-425), one connection dot (StorageConnections.jsx:47-54), one adapter online dot (SettingsPage.jsx:754-757). — elsewhere: Every other surface writes its status colours inline too, which is why the app carries four greens and nine reds. — do: One StatusBadge taking a semantic token (active/draft/online/offline/read-only/in-use) and rendering dot, fill and label from one source, so a status colour can never be written inline again.

- **Empty, loading and error states** — here: Five treatments (S27). The Profile panel uses one block for loading, empty and error with only an ink flip between them (ProfileSection.jsx:281-292). — elsewhere: binUi exports EmptyState and Spinner; neither is used here. — do: src/ui/EmptyState (24px icon, 14px title, 13px body, action slot) plus a separate src/ui/Loading with skeleton rows, so 'loading' and 'nothing here' stop looking identical.

- **Toasts and inline feedback** — here: savedFlash is a bare span with a 2500ms setTimeout and no transition (ProfileSection.jsx:205, :433); the same idea is a static span in PasswordSection.jsx:198 and StorageConnections.jsx:369; errors are six different inks in six positions. — elsewhere: The app runs four toast systems in four screen positions; Settings uses none of them. — do: One Toast anchored bottom centre 24px up with variants info/success/warning/danger. Save confirmations move into it; validation errors stay inline but take the S10 treatment.

- **Keyboard hints (Kbd)** — here: Nothing, despite three live key bindings (SettingsPage.jsx:869, :1187-1188). — elsewhere: BinsView mounts a 34px bar with twelve Kbd hints (BinsView.jsx:844-847); binUi exports Kbd (binUi.jsx:134). This is Audrey's named example of the uniformity problem. — do: Promote Kbd to the shared kit at the 11px Label step and use it inline on this surface ('Enter to add', 'Enter to save, Esc to cancel'). A full ShortcutBar is not warranted here because Settings registers no document-level keys - the uniformity is in the component and the type, not in the bar.

- **Hover-revealed row controls** — here: The department row shows its remove button permanently and hovers three different fills inside one row (SettingsPage.jsx:1177, :1197, :1208). — elsewhere: Hover-revealed controls exist in six files app-wide and nowhere on this surface. — do: src/ui/HoverActions with a reserved fixed-width slot revealed on hover and focus-within, 120ms opacity, applied to the department rows and the recent-folder rows so the row width never jumps.

- **Icons** — here: Five sizes (11/12/13/14/16) and four text glyphs standing in for icons (S29, S30). — elsewhere: visual-language.md documents lucide-react as the exclusive icon library at 16-20px. — do: Three sizes (14 dense, 16 rows and buttons, 24 empty states) and no text glyph ever standing in for an icon.

- **Surface / card treatment** — here: Six different fills do the grouping job on one page: rgba(120,70,30,0.55), 0.45, 0.35, 0.18, 0.15, 0.12, plus rgba(0,0,0,0.1) for the path block and #1c1917 for the two prompt wells. — elsewhere: lightSurface.js exports exactly one grouping fill (LIGHT_WELL, 0.18) and one opaque floating surface (#dd9155), and describes LIGHT_WELL as 'Law of Common Region satisfied WITHOUT a card'. — do: LIGHT_WELL for every docked grouping surface, LIGHT_SURFACE_SOLID for every floating one. Delete the other six fills from this surface.


## Alignment issues

- Profile tab, editable fields above locked fields (`src/components/settings/ProfileSection.jsx:408`): grid-cols-2 (four fields) sits 16px above grid-cols-3 (three fields). The gutter falls at 50% in the first block and at 33%/66% in the second, so six field edges nearly line up and none actually do. → One grid-cols-2 for both blocks; the three locked fields occupy four cells with one empty, or become a single full-width read-only group.

- General tab, password form versus the paragraphs above it (`src/components/settings/PasswordSection.jsx:156`): max-w-md (448px) inside a max-w-2xl (672px) column, under paragraphs that run the full 672px. Three right edges in one scroll. → One 720px measure for the surface; prose capped at 66ch inside it; the form fields use the same two-column grid as Profile.

- General and Agent tabs, the four label-left / control-right rows (`src/components/SettingsPage.jsx:454`): No row height. Pet Mode's toggle is about 30px, the difficulty buttons about 26px, and each label side is a two-line block, so the rows are different heights and the label/control vertical centres drift row to row. → One 36px Row component with a label column, a 12px description beneath, all controls 28px and right-aligned to a shared edge, hairline dividers between rows.

- Models tab, the 28 function rows (`src/components/settings/UserModelsSection.jsx:173`): flex-wrap with a min-width label and a min-width select means the select's left edge moves with the label text and the conditional Reset button can push the row to wrap. There is no control column down 28 rows. → Three fixed tracks: label (flex), select (220px), reset (72px reserved whether or not it renders).

- Version footer (`src/components/SettingsPage.jsx:1110`): px-6 on the outer column while the content is centred in max-w-2xl inside a px-8 wrapper, so the version string aligns to the window edge and not to the content it belongs to. → Move it inside the 720px column, left-aligned to the same gutter, with a hairline above.

- Storage tab, the local demo card's action rows (`src/components/settings/StorageConnections.jsx:340`): Two flex-wrap rows of equally sized SmallButtons with no primary, so on a narrow column the destructive 'Reset demo folder…' can wrap up next to 'Change folder…' and read as a peer. → A primary row and a quiet row with fixed order, the danger variant on Reset, and never-wrap behaviour at the 720px measure.

- Profile tab, avatar block versus field grid (`src/components/settings/ProfileSection.jsx:303`): The avatar is a 64px circle in a flex row with an 16px gap; the field grid beneath starts at the column's left edge. The avatar's action buttons therefore start 80px in and align to nothing below them. → Put the avatar block on the same two-column grid: image plus actions in column one, the upload hint in column two, so its left edges match the fields.

- Storage tab, adapter list versus the connection status line beneath it (`src/components/SettingsPage.jsx:753`): The adapter buttons carry px-3 of internal padding plus a 2px border, so their label starts about 14px in; the Connected/Offline dot beneath sits at the container's left edge with an 8px dot. The two label columns are about 20px apart. → Align the status dot to the same optical left edge as the radio dots above it, or move the status line inside the group as a footer row at the same padding.

- Agent tab, course selector chips (`src/components/SettingsPage.jsx:989`): flex-wrap with gap-2 and no fixed height; the chips are px-3 py-1 at text-[10px] (about 22px) while every other button on the surface is 26 to 30px, so the row sits visually above the baseline of the block. → 28px Chip height shared with the difficulty and auto-approve groups, so all three segmented controls on the surface share one baseline.

- Whole surface, the gutter above the content (`src/App.jsx:2100`): App adds '3vh 0' and SettingsPage adds py-8 px-8 on top of a 200px bar, so the distance from the orange bar to the tab bar changes with window height and is not a designable constant. → Flat 24px in App, delete SettingsPage's own py-8 px-8, one 24px page gutter owned by the shell.


## Hick's Law hotspots

- Tab bar, on arrival at every visit (SettingsPage.jsx:332-347): 7 visible choices → Keep all seven, in the same order, all reachable. Add two hairline separators inside the bar so the reading is [General | Profile] [Models | Storage | Teams] [Agent | Agent Skills]. Purely visual grouping; the shared Tabs component already specifies an optional group separator for sets above a threshold.

- Storage tab, one scroll (SettingsPage.jsx:666-841 plus StorageConnections, MigrationPanel, OtterMigrationPanel): 21 visible choices → Chunk with SectionTitle plus a hairline above each group, and collapse the two migration panels behind one closed-by-default 'Data migration' disclosure. Both panels stay one click away; nothing is removed. That drops the first-glance count from about 21 to about 14.

- General tab, one scroll (SettingsPage.jsx:376-660): 14 visible choices → Six unrelated groups with no rank. Give the tab one dominant element by promoting the section titles to 16px sentence case and putting a hairline above each group, and move the duplicated Project Files Location panel to Storage (S15) so General carries five groups rather than six.

- Models tab, all 28 registry functions at once (UserModelsSection.jsx:146-224): 29 visible choices → 28 selects plus Refresh, each select holding every approved model plus Inherit. The three tool groups are the right instinct; make them read as groups by giving each a 32px header at the Label step with a hairline, fixed control columns (S40), and a per-group count of overridden functions so a user can see at a glance which group needs attention. No control is hidden.

- Local demo folder card, active state (StorageConnections.jsx:334-373): 5 visible choices → Five same-sized buttons in two wrapping rows, one of them destructive. Split into a primary row (Change folder, Open in Explorer) and a quiet row (Close folder, Create demo project, Reset demo folder), render Reset as the danger variant, and fix the order so wrapping can never put Reset beside Change.

- Agent tab, Scope Restrictions course selector (SettingsPage.jsx:989-1003): 6 visible choices → One unbounded, unlabelled chip per course - six for Audrey's library, more for anyone else - with a single 10px line of explanation. Give the group an 11px Label eyebrow ('Course'), 28px chips, and a single-select active state so it reads as a filter rather than six actions. The subject list beneath then reads as the result of a choice.

- Agent Skills tab, per tool (AgentSkillsSection.jsx:103-207): 10 visible choices → Per tool: All on, All off, View schema, Reset, a textarea, and up to twelve skill checkboxes, repeated for every tool in the registry. Move All on / All off into the SectionTitle actions slot, and put the schema behind the existing disclosure with the 11px Label step as its trigger so the four header buttons stop competing with the tool title.

- Currency picker, once opened (CurrencyPicker.jsx:69-99): 19 visible choices → Already correct - nineteen options behind one trigger with an autofocused search filter. This is the pattern to copy elsewhere on the surface. The only change needed is geometric: drop the trigger from 48px to 36px so it matches the controls around it.


## Type inventory

| px | As written | Weight | Case | Tracking | Approx count | Role as used |
|---|---|---|---|---|---|---|
| 20 | `text-xl` | 700 | - | - | 1 | avatar initial (ProfileSection:313) |
| 14 | `text-sm` | 700 | UPPER | widest | 12 | every section heading (`h2`) |
| 14 | `text-sm` | 700 | - | - | 1 | pet name (SettingsPage:413) |
| 14 | `text-sm` | 400 | - | - | 7 | currency trigger, department input, rate-card select, DepartmentRow remove glyph |
| 14 | inline `fontSize: '14px'` | bold | UPPER | 0.15em | 2 | confirm-modal titles |
| 12 | `text-xs` | 700 | UPPER | widest / wider | 10 | tab labels, Pet Mode / Agent Mode / Difficulty / Auto-Approve / Scope labels, MFA enrol button |
| 12 | `text-xs` | 400 | - | - | 35 | body paragraphs, inputs, agent textarea, loading and empty states, feedback lines, version footer |
| 12 | `text-[12px]` | 700 mono | UPPER | wider | 1 | adapter name (SettingsPage:724) |
| 12 | inline `fontSize: '12px'` | 400 | - | - | 2 | confirm-modal body |
| 11 | `text-[11px]` | 700 | UPPER | wider | 18 | field labels, most buttons, Project files root eyebrow |
| 11 | `text-[11px]` | 400 mono | - | - | 16 | paths, hints, status lines, card copy |
| 11 | `text-[11px]` | 400 | - | - | 12 | model rows, card body copy, warning banner |
| 11 | inline `fontSize: '11px'` | bold | UPPER | 0.1em | 4 | confirm-modal buttons |
| 10 | `text-[10px]` | 700 | UPPER | wider / widest | 22 | difficulty, auto-approve, course, skill and prompt buttons; tool group headers; Danger Zone; Recent folders |
| 10 | `text-[10px]` | 400 | - | - | 20 | toggle descriptions, provenance line, schema block, row errors, avatar hint |
| 9 | `text-[9px]` | 400 | - | normal | 3 | In use / Read only badges, "(edited)" |

**Sixteen treatments across eight sizes.** Weights in use: 400 and 700 only (77 `font-bold` plus 6 inline `fontWeight: 'bold'`); nothing is set at 500 or 600. Tracking: `tracking-wider` x49, `tracking-widest` x20, `tracking-wide` x1, `tracking-normal` x2. Uppercase: 77 occurrences. Italic: 7, all of them on empty or loading states.

**Collapse to seven roles.** H2 16/600/sentence for section titles (absorbs both `text-sm` heading variants and both `h3` variants). H3 14/600/sentence for card and group titles (absorbs the pet name and the tool group headers). Body 14/400 for paragraphs and inputs (absorbs `text-xs` 400). Dense 13/400 for card copy, paths, model rows and hints (absorbs most `text-[11px]`). Caption 12/400 for descriptions, provenance and metadata (absorbs all `text-[10px]` 400). Label 11/600/UPPER/+0.06em for field labels, group eyebrows and badges (absorbs `text-[11px]` 700, `text-[10px]` 700 and all three `text-[9px]`). Display 34 is untouched and belongs only to the transition overlay. `text-xl`, `text-[12px]`, `text-[9px]` and all eight inline `fontSize` values are deleted from this surface.


## Priority order

S1, S3, S5, S10, S7, S2, S12, S6, S32, S25, S18, S19, S20, S22, S13, S4, S8, S26, S28, S31, S39, S14, S15, S27, S9, S11, S24, S30, S43, S29, S40, S41, S21, S23, S17, S44, S16, S33, S42, S34, S36, S35, S37


## Rework scope (reviewer's estimate)

Files: `src/components/SettingsPage.jsx`, `src/components/settings/StorageConnections.jsx`, `src/components/settings/ProfileSection.jsx`, `src/components/settings/UserModelsSection.jsx`, `src/components/settings/PasswordSection.jsx`, `src/components/settings/AgentSkillsSection.jsx`, `src/components/settings/VersionPanel.jsx`, `src/components/settings/SessionSection.jsx`, `src/components/settings/CurrencyPicker.jsx`, `src/components/settings/ModelPicker.jsx (MOVE OUT - dark surface, D.O.G. only)`, `src/components/lightSurface.js (extend with input, hover, selected and control-height tokens)`, `src/layout/pageBars.js (settings 200/150 -> 120/80)`, `src/App.jsx (content padding 3vh -> 24px)`, `src/lib/localDemoWiring.test.js`, `src/lib/localMediaWiring.test.js`, `src/lib/workspaceRootWiring.test.js`, `src/lib/userStateWiring.test.js`, `NEW: src/components/settings/GeneralTab.jsx, ProfileTab.jsx, ModelsTab.jsx, StorageTab.jsx, TeamsTab.jsx, AgentTab.jsx, SkillsTab.jsx`  
Approx lines: 1750  
Suggested sessions: 3  
Split: Session 1 - STRUCTURE AND TOKENS, no visual change intended. Extract the seven tab bodies into src/components/settings/*Tab.jsx keeping every literal string and data attribute byte-identical; move ModelPicker out of the settings folder; update the four wiring tests' read targets; extend lightSurface.js with input, hover, selected, control-height and radius tokens. Run the full suite and confirm green before anything else. About 500 lines, mostly moves.

Session 2 - TYPE AND COLOUR, the pass that does the visible work. Apply the eight-step scale (S1, S2, S13, S22, S43), the one-ink rule (S8), the feedback tokens (S10), the primary-button collapse (S7), the pet card inks (S6), the pastel chips (S9), the status ladder (S11), the CurrencyPicker inks (S38), the UA select (S28) and the tab bar (S31). This is where Audrey sees the change. About 700 lines across nine files, no structural edits, so the Session 1 tests stay green.

Session 3 - GEOMETRY AND COMPONENTS. The Row contract (S20), the single measure (S18, S19), the Models table tracks (S40), the adapter list hairlines (S41), the Dialog promotion (S25, S42), EmptyState and Loading (S27), focus states (S32), the icon and glyph pass (S29, S30), hover tokens (S44), the Kbd hints (S33), the version footer (S21), the tab grouping (S17), the AI Features demotion (S16), the bar heights and page gutter (S23), and the duplicated root panel (S15). About 550 lines. This session touches markup, so it is the one that has to re-run the four wiring tests after every file.

If only two sessions are available, merge 1 and 2 and accept that the visual pass runs against the 1216-line file, which roughly doubles the chance of a wiring-test failure that costs an hour to diagnose.  
Risks: 1. THE SOURCE-TEXT TESTS ARE THE DOMINANT RISK. Four test files readFileSync SettingsPage.jsx and StorageConnections.jsx and assert against the raw string: exact button copy ('Change folder…' with the ellipsis, localDemoWiring.test.js:218), exact prose ('for demos only: its projects stay on this computer and cannot be shared.', localMediaWiring.test.js:125), a data attribute (data-local-card="demo-only", localMediaWiring.test.js:121), a COUNT of GatedAction occurrences in SettingsPage (workspaceRootWiring.test.js:282), and the ORDER of <MfaSecuritySection /> and <SessionSection /> within 400 characters (userStateWiring.test.js:156). Any markup restructure, any button relabel and any section merge will go red in a test that says nothing about design. Read all four test files before the first edit.
2. A 1216-line component with all seven tabs inline and no sub-components. Extracting the tabs is prerequisite work, not part of the visual pass.
3. Inline styles hide state. The pet danger buttons drive their hover through onMouseEnter/onMouseLeave handlers that write style.borderColor and style.color directly (SettingsPage.jsx:508-509, :522-523), so a CSS-based hover will be silently overwritten by the handler unless both are removed together.
4. S15 (the duplicated defaultRootDir panel) cannot be removed without breaking the GatedAction count assertion. Render both mount points from one component instead, or update the test in the same commit with a comment explaining why the count changed.
5. ModelPicker sits in the settings folder but renders only on D.O.G.'s dark Prompts tab. A blanket light-surface restyle of src/components/settings/ will break it. Move it first.
6. S5 changes the input well on every light page, not just Settings. It is flagged palette-decision and needs Audrey's ruling alongside the F36 light-page question, because the two interact: under option A (data pages move to dark) several of these controls move surface entirely.
7. The pet card and pet-mode controls are re-stylable but read pet state; PetCompanion.jsx, src/components/sprites/ and the pet keyframes in index.css stay untouched.
8. The two confirm modals paint #1c1917 and their greys are CORRECT on that surface. Classify by the surface an element sits on, not by the file it lives in - lightSurface.js:21-25 records this trap explicitly.
