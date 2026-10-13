# Review — D.O.G. (Deck Outline Generator) tool chrome — sidebar outline, Section 1 Document & Context, Section 2 Page Generation, Output panel (tabs bar, view toggle, regenerate bar, formatting toolbar, read-only caption, empty state), rewrite popover, right-click context menu, Settings slide-out with prompt tabs, Help modal, History Import/Export modal, Duplicate Resolver modal, New Project modal. Slide preview (LayoutVisualizer / VideoThumbnail) excluded.


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\deck-outline-generator_v0.514\DeckOutlineGenerator.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\deck-outline-generator_v0.514\modals\HistoryModal.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\deck-outline-generator_v0.514\modals\DuplicateResolverModal.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\data\dogHelpContent.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\deck-outline-generator_v0.514\constants.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\components\settings\ModelPicker.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css`


## Job

Turn source documents into a structured slide outline, one page at a time or a whole deck at once, and get it out as markdown. The primary action per sub-view: on the input column it is Generate (Generate Page Outline at 4262, or Generate Full Deck Outline at 4143 when the Full Deck toggle is on); on the output panel it is read-and-refine (Regenerate Page at 4409, with Export .md / Copy at 4288 and 4295 as the exit); in the sidebar it is open a page from the outline (3801); in the Settings slide-out it is edit one prompt and close; in the History modal it is Download DECKOUTLINE.md (352). The screen currently has two co-equal Generate buttons visible in different modes, which is legitimate because the Full Deck toggle is a mode switch, not a second path — but the toggle that decides which one exists is a 44x24 pill at the far right of a 10px label row (4096-4113), so the control that selects the screen's primary action is the least prominent thing on the screen.


## What works

- The three-region layout maps the actual job. A persistent 224px outline column on the left (3736), numbered input sections in the middle, and the output panel below them reads as source, request, result. The numbered step circles are the right idea; only their execution is wrong.

- The `ctx-btn` hover treatment in the right-click menu (5182-5185: a 3px left accent plus a 12 percent orange wash, no fill) is the single most contemporary control on this surface and the only one that signals hover without repainting a block. It should be promoted to the shared Menu item pattern rather than replaced.

- The Core / Reference file-role toggle (3934-3950) solves a real modelling problem in one click and pins itself to a fixed 52px width so the filenames beside it stay in a true column. The column discipline is correct and rare in this file.

- The regenerate bar (4366-4451) puts the revision prompt, the layout override, the action and undo/redo on one row directly above the output they change, instead of sending the user back up to Section 2. That is the right adjacency (Law of Proximity), and it should survive the overhaul unchanged in behaviour.

- ModelPicker is mounted directly above the prompt textarea it governs (4792, 4827, 4867, 4970) rather than in a separate models screen, so the prompt and the model read as one decision.

- The theme-generation failure is amber and dismissable while a generation failure is red and persistent (3832 vs 3841), with the reasoning written into the comment at 3837. That is a correct severity distinction and almost nothing else in the app makes it.


## Findings (34)

**D1 · HIGH · Typography** — D.O.G. is the only surface in WILSON that declares font-sans, then overrides it to mono 30 times  
law: Law of Similarity

- Problem: Line 3699 sets `font-sans` on the tool root — one of only two `font-sans` occurrences in the entire app. Thirty descendants then override it back to mono, and most of them have no numeric or code job: the step numerals in the Section 1 and Section 2 circles (3861, 4170), the Core/Ref badges (3938, 3960), and all four plain form fields in the New Project modal (5265, 5278, 5291, 5301) where a project title and a description are ordinary prose. The result is a surface that is nominally sans but reads as mono wherever the eye actually lands.

- Why it matters: The system review's rule is that mono keeps numerics, ids, paths, timecode, keys, code and the version footer, and loses everything else. On this surface that rule is unusually easy to apply because the legitimate survivors are already isolated: the page-number chips (3806, 4332), the markdown editing textarea (4529), the prompt and schema textareas in Settings (4793 and 15 siblings), the rewrite preview panes that show raw markdown (4576, 4590), and the version stamp in the help sidebar (5159). Everything else is prose wearing a code costume.

- Change: Delete `font-mono` from 3861, 3938, 3960, 5265, 5278, 5291, 5301, and from HistoryModal 243, 247, 267, 336. Keep it on 3806, 4332, 4529, 5159, the sixteen Settings textareas, and the two rewrite preview paragraphs. Remove `font-sans` from 3699 once the app sets the sans family globally, so D.O.G. stops being the only page that declares its own family.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3699` — `<div className="h-full bg-stone-900 text-stone-300 font-sans flex flex-col overflow-hidden" style={{ flex: 1 }}>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3861` — `<span className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white font-mono text-xs">1</span>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5265` — `className="w-full px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`




**D2 · HIGH · System** — D.O.G. injects a stylesheet that restyles the scrollbars of every page in the app, always  
law: Law of Uniform Connectedness

- Problem: Lines 3701-3730 are a raw `<style>` block inside D.O.G.'s render tree with unscoped selectors: `::-webkit-scrollbar`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-thumb`, and `* { scrollbar-width: thin; scrollbar-color: #57534e #1c1917 }`. App.jsx mounts every page at once and toggles them with display:none (1763), so this block is in the document from first paint on Home, Settings, Files and every light page, not only on D.O.G. The `*` rule in particular sets a dark Firefox scrollbar on the orange pages.

- Why it matters: The system review named the injected style tag as a scrollbar problem. It is worse than that on this surface: it is a global stylesheet that a tool component owns and that no other page can see or override except by specificity accident, and it directly contradicts `.wilson-light-scroll` in index.css which App.jsx applies to the light pages. This is the cheapest fix in the whole review and it fixes pages nobody is looking at yet.

- Change: Delete 3701-3730 entirely. Move the dark rules to a `.wilson-dark-scroll` class in index.css alongside the existing `.wilson-light-scroll`, and have the shell apply the class per page surface. Keep the `.settings-scrollbar` override as a modifier on the same class rather than a second system.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3719` — `/* Firefox scrollbar */         * {           scrollbar-width: thin;`<br>`src/App.jsx:1763` — `<div style={{ display: currentPage === 'dog' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>`




**D3 · HIGH · Build** — Sixteen Settings accordion headers claim a hover state that does not exist: hover:bg-stone-750  
law: Doherty Threshold

- Problem: Every collapsible prompt editor in the Settings slide-out uses `bg-stone-800 hover:bg-stone-750`. Tailwind has no `stone-750`, and grep confirms nothing in index.css defines it. All sixteen headers (4783, 4801, 4818, 4836, 4858, 4876, 4893, 4910, 4927, 4944, 4961, 4986, 5018, 5035, 5052, 5068) are therefore inert on hover — the only feedback is the cursor. The same dead class appears in Otter.jsx:5364 and rabbit TimelineView.jsx:5372.

- Why it matters: The primary navigation mechanism of the densest panel in the tool gives no response to the pointer. It is also the clearest evidence that this surface has never had a component layer: the same wrong string was copy-pasted sixteen times in one file and twice more across two other tools.

- Change: Replace all sixteen with the shared accordion header from the component kit, whose hover is one token (`paper-raised` lifted to the hover fill). Fix Otter.jsx:5364 and TimelineView.jsx:5372 in the same commit so the pattern does not re-split.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4783` — `<button onClick={() => setSettingsCollapsed(p => ({...p, sp_sys: !p.sp_sys}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:`<br>`src/tools/otter_v0.3.1/Otter.jsx:5364` — `className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">`




**D4 · HIGH · System** — Six panel headers on one surface, at four type sizes and three constructions  
law: Law of Similarity

- Problem: The sidebar header is 12px bold uppercase with a 12px icon (3737-3740). Section 1 and Section 2 headers are 14px bold uppercase with a 24px numbered circle (3859-3861, 4168-4170). The Output header is 12px bold uppercase with no icon (4282-4283). The Settings panel header and the Help modal header have no size class at all so they inherit 16px, with a 20px icon (4677, 5129). HistoryModal's header is 14px (205) and DuplicateResolverModal's is a hard-coded 16px inline (93). Seven headers, four sizes, four icon sizes, three left gutters.

- Why it matters: These are the same object doing the same job in the same place on the same screen. Nothing about a settings panel makes its title a different rank from a section title. This is the single highest-leverage component fix on the surface because it resolves three hierarchy findings at once.

- Change: One PanelHeader component at 32px, left gutter 24px, title at the 16px H2 step, weight 600, sentence case, no tracking, optional 16px leading icon, right-hand actions slot. Apply to all seven. The numbered circles move out of the title and become an 11px Label-step eyebrow above it (see D8).

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3859` — `<h2 className="font-bold uppercase tracking-wide flex items-center justify-between text-sm">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4283` — `<span className="font-bold uppercase text-xs tracking-wide">Generated Output</span>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4677` — `<span className="font-bold text-orange-400 uppercase tracking-wide">Settings</span>`




**D5 · HIGH · System** — Five modal implementations, three backdrop values, seven widths, all on one surface  
law: Law of Common Region

- Problem: The Settings slide-out uses `bg-black/50` and a 40 percent / 400px min width (4657-4671). The Help modal uses `bg-black/70` at 850px x 82vh (5117, 5124). HistoryModal uses `bg-black/70` at 500px (202-203). DuplicateResolverModal uses `bg-black/70` at a hard-coded 894px x 349px (86-89). The New Project modal drops out of Tailwind entirely and hand-writes `position: fixed` with `rgba(0,0,0,0.6)` at 520px (5237-5252). The rewrite preview is a sixth floating surface at 420px (4569), and the duplicate preview popup a seventh at 740px (181-187).

- Why it matters: Three backdrop opacities means the same dimming gesture reads as three different depths depending on which button you pressed. Seven widths means nothing on the surface has a shared measure. This is the mechanism behind the 66 hand-rolled overlays the system review counted app-wide, reproduced in miniature in one tool.

- Change: Promote binUi's Modal as `Dialog` and adopt it for HistoryModal, DuplicateResolverModal, the Help modal and the New Project modal. One backdrop `rgba(12,10,9,0.6)`, one surface, 8px radius, one shadow, header / body / footer. Widths become three tokens: 480 (form), 720 (reading), 960 (comparison — the duplicate resolver). The Settings slide-out stays a slide-out but takes the same surface, header and footer contract. The rewrite popover and the duplicate preview become Popover, sharing the Dialog surface at a smaller radius.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5242` — `backgroundColor: 'rgba(0,0,0,0.6)',             zIndex: 50,`<br>`src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx:89` — `style={{ width: '894px', height: '349px' }}`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4660` — `className="absolute inset-0 bg-black/50 transition-opacity"`




**D6 · HIGH · Uniformity** — D.O.G. registers five document-level keyboard shortcuts and shows none of them — Audrey's named example, exactly  
law: Paradox of the Active User

- Problem: Four useEffect blocks attach document-level keydown/keyup handlers: Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y for text undo/redo across both views (2846-2869), ArrowLeft / ArrowRight to switch page tabs (2872-2902), Alt to toggle Full Deck mode (2905-2918), and bare Enter to fire a generation when the outline is empty (2921-2939). Plus Enter-to-submit inside both prompt textareas (4126, 4245). None of these appear anywhere in the interface. The context menu shows Ctrl+Z/X/C/V (5191-5208) but not the four that are unique to this tool.

- Why it matters: This is the gap Audrey named. BinsView renders a 34px shortcut bar at the bottom of the view listing twelve keys (BinsView.jsx:845-847) because that view registers them. D.O.G. registers five and shows zero. Alt-toggles-Full-Deck is the worst of them: it silently flips the mode that decides which Generate button exists, and a user who taps Alt to reach a menu will change the tool's mode without knowing why. Paradox of the Active User says nobody will find this in the Help modal.

- Change: Mount the shared ShortcutBar at the bottom of the D.O.G. content column, 28px, hairline top, recessed ground, Kbd plus 12px sentence-case label pairs grouped at 24px: `← →` pages, `Alt` full deck, `Ctrl Z` undo, `Enter` generate. Same keys, same behaviour, made visible. Do not change what any key does.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:2914` — `e.preventDefault();       setFullDeckMode(prev => !prev);`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:2895` — `} else if (e.key === 'ArrowRight' && currentIndex < openTabs.length - 1) {`<br>`src/tools/rabbit_v0.1.0/views/BinsView.jsx:846` — `<span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span><span><Kbd>S</Kbd> select</span>`




**D7 · HIGH · Typography** — Eight type sizes on one surface, six of them hard-coded in px inside one modal, and a 9px floor  
law: Von Restorff Effect

- Problem: The surface uses 9px (x6), 10px (x81), 11px (x4), 12px text-xs (x83), 13px, 14px text-sm (x25), 16px (inherited on two headers, inline on one), and 24px in the shell header. DuplicateResolverModal alone bypasses Tailwind and hard-codes six of them inline: 16, 14, 14, 13, 13, 13, 12, 11, 10 (93, 94, 117, 121, 127, 134, 142, 152, 163, 171). The 10px step carries 81 instances of real instruction text — every field hint (3879, 3989, 4116, 4190, 4219, 4236), every checkbox label (4071, 4081, 4091), every accordion description (4786 and 15 siblings) and both read-only captions (4515, 4549).

- Why it matters: Ten pixels is below the Apple desktop floor and below the 11px Label floor the system review sets, and it is carrying sentence-case body copy, not labels. The 9px eyebrows (3927, 4574, 4582, 5218) are below the rendering threshold on a 96dpi Windows display. Nine sizes with no ratio between them is not a scale, it is nine separate decisions, and it is why nothing on the screen reads as ranked.

- Change: Map to the eight-step scale: the two panel headers and the duplicate-resolver title go to H2 16px sentence case; Section 1/2 headers and modal titles go to H2 16px; tab labels, option labels and body go to Body 14px; table-like rows, tree rows and the sidebar go to Dense 13px; all 81 of the 10px hints go to Caption 12px sentence case; all 9px eyebrows and the Core/Ref badges go to Label 11px. Delete every inline `fontSize` in DuplicateResolverModal.

- Evidence: `src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx:93` — `<h3 className="font-bold text-orange-400 uppercase tracking-wide" style={{ fontSize: '16px' }}>Resolve Duplicate</h3>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3927` — `<p className="text-[9px] uppercase tracking-wider text-stone-500 mb-1">                           File roles · click to toggle`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4116` — `<p className="text-[10px] text-stone-500 mb-1.5">                   Set the overall tone, style, and objectives for the deck`




**D8 · HIGH · Hierarchy** — No dominant element: three peer panels with identical chrome, and 56 uppercase tracked labels competing at the same rank  
law: Von Restorff Effect

- Problem: Section 1, Section 2 and the Output panel all use the same construction — `bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]` (3854, 4163, 4281) with a `bg-stone-700` filled header bar. Nothing distinguishes the panel you are working in from the two you are not. Inside them, 56 elements are uppercase and 56 carry tracking, at 9, 10, 12 and 14px: section titles, field labels, checkbox labels, the Full Deck label, button text, badge text, the lock state, the Edit Output prefix and the context-menu group label are all the same typographic object.

- Why it matters: Squinted at, the screen is a uniform grey field with orange speckle and no first fixation point. When everything is emphasised nothing is. Dominance has to come from scale and position, and here it is being attempted with weight, case and colour only, all three of which are spent.

- Change: One filled header disappears: panels get a hairline above the title and no fill (Law of Common Region without a card). Uppercase survives in exactly two roles on this surface — the Label step for field labels, table headers, Kbd and badges, and the page-transition Display title in the shell. Every section title, button, tab, checkbox label and empty-state line becomes sentence case, weight 600 for titles and 400 for body. The dominant element per view becomes the primary action: Generate at 36px full-width (it already is, at 4143/4262), and in the output panel the active tab plus the preview, with the regenerate bar dropping to a 28px toolbar row.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3854` — `<section className="bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4071` — `<span className="text-[10px] text-stone-400 uppercase tracking-wide">Theme Generator</span>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4369` — `<span className="text-[10px] text-orange-400 uppercase tracking-wide font-bold flex-shrink-0">Edit Output:</span>`




**D9 · HIGH · Colour** — text-orange-400 is used 110 times and has become the body ink, so the accent no longer marks anything  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: `text-orange-400` appears 110 times against 19 uses of `text-stone-300`. It is the colour of section titles, every field label, the select's placeholder option, the New Project button, checkmarks, the entire markdown editing textarea (4529), all sixteen Settings prompt textareas, every Reset-to-default link, every context-menu item (5190-5228), the lock state, the tab label, the undo/redo icons and the version-panel accents. Meanwhile six stone greys are in play — stone-300 (19), stone-400 (34), stone-500 (96), stone-600 (31), plus stone-700/800/900/950 as grounds — and eleven raw hex values sit alongside them.

- Why it matters: An accent used 110 times is not an accent, it is the text colour, and the six greys behind it mean muted text is being set with four unrelated values. The tell is 4529: the user's own document, the most important content on the screen, is rendered entirely in the accent because there was no ink left to distinguish it with.

- Change: Collapse to one ink at three screens: `#f5f0ec` at 100 / 72 / 48 percent replaces stone-300, stone-400, stone-500 and stone-600 as text. The markdown textarea at 4529 becomes ink at 100 percent. `signal` `#ea580c` keeps four jobs on this surface: the Generate button fill, the active tab underline, the focus ring, and the selected/active state of a toggle. Retire `#f97316`, `#fb923c` and `text-orange-400` from chrome. The five `#f4a261` uses (New Project inputs 5266/5279/5292/5302 and HistoryModal's folder display 268) are the light-page ground used as an ink on dark — delete all five.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4529` — `className="w-full min-h-[780px] p-4 font-mono text-sm whitespace-pre-wrap text-orange-400 bg-stone-950 leading-relaxed border-none outline-none resize-y"`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5266` — `style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '2px solid #44403c' }}`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3876` — `<label className="block text-xs font-bold text-orange-400 mb-0.5 uppercase tracking-wide">`




**D10 · HIGH · Build** — Zero focus-visible styles: none of the sixty-plus buttons show keyboard focus  
law: Jakob's Law

- Problem: `focus:outline-none` appears 29 times and `focus-visible` zero times. Twenty-three inputs replace the outline with `focus:border-orange-500`; four more (the New Project modal, 5265/5278/5291/5301) use `focus:ring-2 focus:ring-orange-500` instead. No button, tab, toggle, accordion header, context-menu item, sidebar row or icon button on this surface has any focus treatment at all.

- Why it matters: The tool registers arrow-key tab navigation and Enter-to-generate, so it expects keyboard use, but a keyboard user cannot see where they are. It is also two focus idioms for inputs on the same screen.

- Change: One `focus-visible` ring token — 2px signal at 2px offset — applied by Button, IconButton, Tabs, Input, Select, TextArea, Menu item and the sidebar row. Delete the `focus:ring-2` pair in the New Project modal and the bare `focus:outline-none` on anything that gets no replacement.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5265` — `className="w-full px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3886` — `className={'w-full px-3 py-1.5 text-xs bg-stone-900 border-2 border-stone-600 rounded-sm focus:outline-none focus:border-orange-500 ...`




**D11 · HIGH · Hierarchy** — The empty state doubles as the loading state: during a full-deck run the output panel still reads "No output yet"  
law: Doherty Threshold

- Problem: The output container at 4519-4560 branches only on `activeTab` and `viewMode`. There is no `isGenerating` branch anywhere below line 4519 — the only feedback during a generation is the button's spinner and label at 4145-4149 / 4264-4268, which is 780px above the panel the user is watching. A full-deck generation is a multi-second call.

- Why it matters: Doherty Threshold: past 400ms the interface must communicate progress, and past two seconds it must explain what is happening. Instead the largest region on the screen actively asserts that nothing exists. Zeigarnik works against it too — the incomplete task has no visible marker.

- Change: Add a Loading state to the output panel: skeleton rows in text view, a skeleton slide frame in visualizer view, with a 13px caption naming what is being generated and, in Full Deck mode, the page count as it arrives. Separate `EmptyState` (24px icon, 14px sentence-case title, 13px body) from `Loading` so "nothing here" and "working" stop looking identical.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4553` — `<div className="p-8 text-center text-stone-500 flex flex-col items-center justify-center bg-stone-950 min-h-[780px]">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4557` — `<p className="font-medium text-sm text-stone-500">No output yet</p>                   <p className="text-xs mt-1 text-stone-600">Generated page outlines will ap`




**D12 · HIGH · Motion** — Focusing either prompt textarea grows it 80px and shoves the Generate button down the page  
**constraint: touches-interaction** · law: Fitts's Law

- Problem: Both prompt textareas animate from `h-20` to `h-40` (4134) and `h-24` to `h-40` (4254) on focus, with `transition-all duration-200`. Section 1's growth pushes the Full Deck Generate button down 80px; Section 2's pushes the Generate Page Outline button down 64px. The button you are about to click moves while you are typing into the field above it.

- Why it matters: Fitts's Law is not only about size, it is about the target being where the cursor expects it. A control that relocates on blur is the worst case: you finish typing, look down, and the button is in a different place than it was when you started. `transition-all` also animates every animatable property including colour and border, so the 200ms applies to the focus border too and the field's focus feedback arrives late.

- Change: Give both textareas a fixed height at the larger value (or make the grow a `field-sizing`/scroll-height grow that does not move siblings, by reserving the max height in the layout). If the grow stays, change `transition-all` to `transition-[height]` and keep 200ms, and move the Generate button out of the reflow path into a fixed 44px action row at the bottom of the section. Flagged because pinning the height changes how much text is visible at rest, which is a viewing change.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4134` — `resize-none text-sm transition-all duration-200 ${systemPromptFocused ? 'h-40' : 'h-20'}'}`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4254` — `focus:border-orange-500 ${pagePromptFocused ? 'h-40' : 'h-24'}'}'}`




**D13 · MEDIUM · Density** — Four left gutters inside the Output panel alone: 8, 12, 12, 16, 16px  
law: Law of Proximity

- Problem: The Output panel's header is `px-3` (4282), the tabs bar is `px-2` (4315), the regenerate bar is `px-3` (4366), the formatting toolbar is `px-3` (4457), the text-view descriptor is `px-4` (4514) and the read-only preview caption is `px-4` (4549). Six stacked rows in one bordered box, starting at three different x positions. The same fault runs through Section 1 and 2 (header `px-3` at 3856/4165, body `p-4` at 3873/4183) and the Settings panel (header/tabs/lock/footer `px-4`, accordions `px-3`).

- Why it matters: Nothing on this surface establishes a left edge, so the eye has no column to return to when scanning down. This is the most visible cause of the "doesn't look clean from placement and alignment" note, and it is free to fix.

- Change: One 24px content gutter for panel headers, toolbars, rows and captions, and one 24px body padding. Sub-rows inside a panel inherit it. Nothing at 8, 12 or 20.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4315` — `<div className="bg-stone-800 px-2 pt-1 flex items-end justify-between border-b-2 border-stone-600">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4514` — `<div className="bg-stone-800 border-l-2 border-r-2 border-stone-600 px-4 py-1.5">`




**D14 · MEDIUM · System** — Two shadow languages in a tool whose own spec says WILSON uses no shadows  
law: Law of Prägnanz

- Problem: Three panels carry a hard offset `shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]` (3854, 4163, 4281) and both Generate buttons carry a 2px offset that shrinks to 1px on hover and to none on active (4143, 4262). Six floating surfaces carry soft blur instead: `shadow-2xl` (4569, 4665, 5124, DuplicateResolver 181) and `shadow-xl` (5177, 5251, DuplicateResolver 88, HistoryModal 203). The documented spec says WILSON does not use drop shadows and stacks surfaces with borders.

- Why it matters: A hard 3px offset on a docked panel is a 1990s bevel, and it is the single detail that most dates this screen. A soft `shadow-2xl` on the settings panel next to it is a different physics. Two elevation models cannot both be true.

- Change: Delete all five hard offset shadows. Docked panels get a hairline and nothing else. Floating surfaces get one shadow, `0 8px 24px rgba(0,0,0,0.35)`, replacing every `shadow-xl` and `shadow-2xl`. The Generate button's press feedback becomes a background darkening, not a shadow collapse.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4143` — `transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)] active:shadow-none`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4569` — `className="absolute z-[80] bg-stone-800 border-2 border-orange-500/40 rounded-sm shadow-2xl w-[420px] max-h-[310px] flex flex-col"`




**D15 · MEDIUM · System** — Border weight changes mid-panel: border-2 x41 against 1px hairlines in the same bordered box  
law: Law of Prägnanz

- Problem: The Output panel's outer frame is `border-2 border-stone-600` (4519), the tabs bar below the header is `border-b-2` (4315), the regenerate bar is `border-b-2` (4366) — but the formatting toolbar between them mixes both in one class: `border-b border-stone-700 border-l-2 border-r-2 border-l-stone-600 border-r-stone-600` (4457). The Settings panel is 2px at the header, tabs and lock bar and 1px between every accordion (4782). The Help modal is 2px outside and 1px at the sidebar divider (5142).

- Why it matters: A 2px rule against 11px type is roughly one sixth of the cap height. It is the measurable reason D.O.G. reads heavier than RABBIT, which already uses 1px in 912 places, and switching weight inside a single box makes the box look assembled rather than drawn.

- Change: One hairline at 1px everywhere, using a screen of the ink rather than `#44403c`/`#57534e`. Delete all 41 `border-2` on this surface, including the dashed dropzones (5321, HistoryModal 374). Keep 2px only as the active-tab underline and the selected-row left marker, where it is a state signal and not a container edge.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4457` — `<div className="bg-stone-800 px-3 py-1 border-b border-stone-700 border-l-2 border-r-2 border-l-stone-600 border-r-stone-600 flex items-center gap-1">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4519` — `<div ref={textareaContainerRef} className={'bg-stone-950 border-l-2 border-r-2 border-b-2 border-stone-600 relative ...`




**D16 · MEDIUM · Alignment** — The regenerate bar is a toolbar whose five controls are three different heights  
law: Law of Similarity

- Problem: In the row at 4367-4450: the revision input is `px-2 py-1.5 text-xs` with a 1px border (about 30px), the layout select the same (30px), the Regenerate button is `px-3 py-1.5 text-xs` with no border (28px), and the undo and redo buttons are `p-1.5` around a 16px icon (28px). `items-center` hides the mismatch by centring, but no two controls share a top or bottom edge.

- Why it matters: A toolbar is the one place where a shared control height is doing structural work: it is what makes the row read as one object rather than five. Two-pixel discrepancies are exactly the kind of thing that reads as "off" without being nameable.

- Change: Every child of a Toolbar is 28px (sm) with one padding pair per variant, in a 44px row. Same controls, same order, same behaviour. Apply to the regenerate bar (4367), the formatting toolbar (4457, currently a 30px row of 22px buttons), the Output header action pair (4285-4308, currently 24px buttons in a 33px bar) and the tabs bar's view toggle (4345).

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4383` — `className="flex-1 px-2 py-1.5 bg-stone-950 border border-stone-600 rounded-sm text-stone-300 text-xs placeholder-stone-500 focus:outline-none focus:border-orang`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4409` — `className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:cursor-not-allowed rounded-sm font-bold text-w`




**D17 · MEDIUM · Flow** — The sidebar hides the timestamp on hover to make room for the delete button  
**constraint: touches-interaction** · law: Working Memory

- Problem: Each outline row shows `#pageNum` and a timestamp on one line (3806-3807), the title below, the layout below that. The timestamp carries `group-hover:opacity-0` so that the absolutely-positioned delete button at `top-2 right-2` (3815-3817) has somewhere to sit. Pointing at a row therefore removes information from it.

- Why it matters: This is hover-reveal run backwards. Every other list in the reference set reserves a fixed slot for row actions and reveals the action into it without displacing content. It also means the only place the page's timestamp is shown is the one moment you are not pointing at it.

- Change: Reserve a fixed 24px action slot at the row's right edge in the HoverActions component, revealed on hover and on focus-within with a 120ms opacity. The timestamp moves to the metadata line beside the layout name at the Caption step and stays visible. Same row, same actions, same click targets.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3807` — `<span className="text-[10px] text-stone-500 group-hover:opacity-0 transition-opacity">{item.timestamp}</span>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3817` — `className="absolute top-2 right-2 p-1 bg-stone-600 hover:bg-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"`




**D18 · MEDIUM · System** — Two disclosure idioms on one surface: chevron swap in the sections, chevron rotation in Settings  
law: Law of Similarity

- Problem: Section 1 and Section 2 swap the icon: `ChevronRight` when collapsed, `ChevronDown` when open, at 20px (3864-3868, 4174-4178). The sixteen Settings accordions keep a single `ChevronRight` at 16px and rotate it 90 degrees with `transition-transform` (4788 and siblings). The Help modal's sidebar uses neither and marks the active item with a 2px left border (5150).

- Why it matters: Three ways to say "this expands" in one tool. The swap version also has no transition, so the sections snap while the settings rotate.

- Change: One Disclosure: a 16px ChevronRight rotated 90 degrees at 160ms, everywhere. Keep the Help sidebar's left-border active marker, which is correct for a nav list and should become the shared selected-row treatment.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3864` — `{section1Collapsed ? (                   <ChevronRight className="w-5 h-5 text-orange-400" />                 ) : (`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4788` — `<ChevronRight className={'w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.sp_sys ? '' : 'rotate-90'}'} />`




**D19 · MEDIUM · System** — Six icon sizes in the chrome, plus two bespoke empty-state circles  
law: Law of Similarity

- Problem: 10px (w-2.5, the checkbox ticks at 4069/4079/4089), 12px (x22), 14px (x11), 16px (x50), 20px (x10), 24px (x3), 28px (the empty-state FileText at 4555), plus a 40px circle in the sidebar empty state (3789) and a 56px dashed circle in the output empty state (4554). The sidebar header's Layers icon is 12px next to 12px text with a 4px gap; the Settings header's icon is 20px next to 16px text with an 8px gap; the section headers pair a 24px filled circle with 14px text.

- Why it matters: Six sizes means no icon-to-text ratio is repeatable, which is why the icon/label pairs sit at different optical baselines from row to row.

- Change: Three sizes: 14px inside dense controls, 16px in rows and buttons, 24px in empty states. The two empty-state circles collapse to one EmptyState with a 24px icon and no circle at all. The checkbox tick becomes 12px inside a 16px box.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4554` — `<div className="w-14 h-14 mb-3 bg-stone-900 rounded-full flex items-center justify-center border-2 border-dashed border-stone-700">`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3789` — `<div className="w-10 h-10 mx-auto mb-2 bg-stone-700 rounded-full flex items-center justify-center">`




**D20 · MEDIUM · System** — The New Project modal shares nothing with the rest of D.O.G. — it is a fifth design language inside one tool  
law: Law of Similarity

- Problem: It is the only place on the surface that hand-writes the overlay in an inline style object (5239-5247), the only one using `tracking-widest` (5254, 5258, 5272, 5286, 5296, 5318, 5351), the only one using `focus:ring-2` instead of a focus border (5265), the only one setting text to `#f4a261` on dark (5266, 5279, 5292, 5302), the only one whose footer buttons take inline hex fills instead of Tailwind (5392, 5400), and the only one using a `✕` glyph instead of the lucide `X` used at every other close affordance on the surface (5342, 5378).

- Why it matters: It reads as a component pasted in from another product, and it is the modal a new user hits first. The visual-language doc's own rule 5 says icons come from lucide, which this breaks in the two places it matters least and is easiest to fix.

- Change: Rebuild on Dialog with Field, Input, TextArea and Button. `tracking-widest` goes; labels take the 11px Label step at +0.06em. Focus takes the one ring. `#f4a261` ink goes. The `✕` becomes `<X className="w-3.5 h-3.5" />` inside an IconButton. Same fields, same order, same validation.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5342` — `className="text-[10px] text-stone-600 hover:text-red-500 transition-colors flex-shrink-0"                         >✕</button>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5258` — `<label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Project Title</label>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5400` — `style={{ backgroundColor: '#ea580c', color: '#fff' }}`




**D21 · MEDIUM · System** — Four tab bars on one surface with four different active treatments  
law: Jakob's Law

- Problem: The output page tabs use a filled `bg-stone-950` body with a three-sided 2px border and a `-mb-[2px]` overlap trick (4328). The Settings tabs use a `bg-stone-900` fill plus a 2px orange bottom border, also with `-mb-[2px]` (4693). The HistoryModal Export/Import pair uses a solid orange fill on the active button (215, 221). The view toggle uses a solid orange fill on a 28px icon button (4348, 4355). Four ways to say "this one is active".

- Why it matters: Two of them (the output tabs and the view toggle) sit inside the same 33px strip, four pixels apart, using opposite mechanics. Jakob's Law governs the mechanism — a tab strip should look like a tab strip — and the filled-tab-with-overlap-border idiom is the dated half.

- Change: One Tabs: 14px sentence case, weight 400 inactive and 600 active, a 2px signal underline, no fill, no border overlap hack. HistoryModal's Export/Import becomes the same Tabs. The view toggle becomes a two-item segmented control with one active fill, since it is a mode switch rather than navigation, and both its buttons go to 28px.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4328` — `? 'bg-stone-950 text-orange-400 border-t-2 border-l-2 border-r-2 border-stone-600 border-b-2 border-b-stone-950 rounded-t-sm -mb-[2px] relative z-10'`<br>`src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx:215` — `className={'flex-1 py-2 px-3 rounded-sm text-sm font-medium transition-colors ${mode === 'export' ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400 ho`




**D22 · MEDIUM · Build** — Each page tab is a button containing a second button, which is invalid HTML  
**constraint: touches-interaction** · law: Jakob's Law

- Problem: The tab at 4323 is a `<button>` and its close affordance at 4334 is a nested `<button>` inside it. Browsers do not define nesting behaviour for interactive content inside a button; React renders it, and the close handler works only because of the `stopPropagation` inside `closeTab`.

- Why it matters: It is a latent interaction bug rather than a visual one, but the rework session will be rewriting this exact markup for D21 and should not carry the structure forward. It also means the close control cannot be reached by keyboard as its own target.

- Change: Make the tab a `<div role="tab">` with a `<button>` label and a sibling `<button>` close, or keep the tab a button and move the close out to a sibling inside a flex row. Behaviour, hit areas and appearance stay as they are.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4334` — `<button                         onClick={(e) => closeTab(tab.id, e)}                         className="ml-1 p-0.5 hover:bg-stone-600 rounded"`




**D23 · MEDIUM · Colour** — The D.O.G. subtitle on the orange bar is orange-200, which breaks Audrey's white-or-black rule at about 2.7:1  
**constraint: palette-decision** · law: Von Restorff Effect

- Problem: App.jsx:1836 sets the tool subtitle "Deck Outline Generator" to `text-orange-200` (#fed7aa) on the `#ea580c` bar, at 12px. The tool name above it is white at 24px. Otter (1855) and RABBIT (1875) carry the identical line.

- Why it matters: Audrey's rule admits no third ink on orange, and this is a tinted orange on orange. The system review flagged it as F35; recording it here because it is the D.O.G. page's own header and the rework session for this surface will be looking at 1828-1848.

- Change: Subtitle becomes white and drops rank by size, not colour: 13px weight 400 under a 20px weight 600 name. Fix all three tool headers in one edit since they are byte-identical blocks.

- Evidence: `src/App.jsx:1836` — `<p className="text-orange-200 text-xs tracking-wide">Deck Outline Generator</p>`<br>`src/App.jsx:1835` — `<h1 className="text-[24px] font-bold tracking-tight uppercase leading-tight text-white">D.O.G.</h1>`




**D24 · MEDIUM · Motion** — The settings slide-out declares its animation three times, one of which is a class that does not exist  
law: Law of Prägnanz

- Problem: Line 4665 applies `animate-slide-in-right`; index.css defines `.slide-in-right`, not `.animate-slide-in-right`, and Tailwind's `animate-` prefix requires a theme keyframe that is not configured — so the class is dead. Line 4670 then sets `animation: 'slideInRight 0.3s ease-out'` inline, which is what actually runs, and lines 5102-5111 inject a third copy of `@keyframes slideInRight` that duplicates index.css:110-113.

- Why it matters: Three declarations, one live, and a keyframe defined twice in two files. Anyone changing the panel's entrance will change the wrong one.

- Change: Delete the dead class at 4665 and the injected keyframes at 5102-5111. Keep one `.slide-in-right` in index.css and apply it. Duration stays 300ms, which is inside the view-transition band.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4665` — `className="absolute top-0 right-0 h-full bg-stone-800 border-l-2 border-stone-600 shadow-2xl flex flex-col animate-slide-in-right"`<br>`src/index.css:114` — `.slide-in-right {   animation: slideInRight 0.3s ease-out; }`




**D25 · MEDIUM · Motion** — No reduced-motion handling anywhere in D.O.G., and one 500ms hover-intent delay with an invented "Hold..." label  
**constraint: touches-preview** · law: Doherty Threshold

- Problem: `prefers-reduced-motion` appears zero times across the three D.O.G. files, while the surface runs a 300ms panel slide, two 200ms height animations, 18 transform transitions and three spinners. Separately, DuplicateResolverModal opens its slide preview after a 500ms hover timer (36-39) and, while the timer runs, prints a 12px grey "Hold..." in the corner of the option card (120-122).

- Why it matters: AuthShell already reads `prefersReducedMotion()` at call time and the pattern exists in the codebase; D.O.G. ignores it. And "Hold..." is an invented affordance: a countdown label for a hover timer appears nowhere else in WILSON and teaches the user a gesture the rest of the app does not have. 500ms is also above the Doherty threshold for a preview.

- Change: Wrap the panel slide and both textarea grows in a reduced-motion guard that delivers the end state instantly. Reduce the hover delay to 250ms and delete the "Hold..." label, or keep the preview on an explicit control. The delay itself is an interaction, so flagged.

- Evidence: `src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx:121` — `<span style={{ fontSize: '12px' }} className="text-stone-500">Hold...</span>`<br>`src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx:36` — `hoverTimerRef.current = setTimeout(() => {       setPreviewItem(item);       setShowPreview(true);     }, 500);`




**D26 · MEDIUM · System** — Three checkbox implementations and three toggle-switch instances, all hand-rolled, none label-associated  
law: Fitts's Law

- Problem: Section 1's three checkboxes are 14px boxes with a 10px tick and a `<span>` label that is not clickable (4065-4092). HistoryModal's three are 16px boxes with a 12px tick and a 12px label, also not clickable (295-325). The Full Deck switch (4107-4111) and the Settings lock switch (4752-4764) are both 44x24 pills whose knob is `bg-stone-500` in both states, so on the orange active track the knob is a grey dot. None of the six uses a real `<input>` or a `<label htmlFor>`.

- Why it matters: Two sizes of the same control on one screen, and the label text is dead to the pointer, which halves the target of every option in Section 1 (Fitts). The grey knob on an orange track is also the one place on this dark surface where the white-or-black question would arise if the track were the light orange.

- Change: One Checkbox at 16px with a 12px tick and a clickable 13px sentence-case label; one Toggle at 40x22 with a white knob in both states and the signal fill on the active track only. Replace all six. Same states, same handlers.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4110` — `className={'absolute top-1 w-4 h-4 bg-stone-500 rounded-full transition-transform ${fullDeckMode ? 'left-6' : 'left-1'}'}`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4067` — `className={'w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${enableThemeGen ? 'border-orange-500 bg-stone-700' : 'border-sto`<br>`src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx:297` — `className={'w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-colors ${includeVisExport ? 'border-orange-500 bg-stone-700' : 'border-stone`




**D27 · MEDIUM · Typography** — Both read-only captions and the help body run well past 75 characters, at 10 and 12px  
law: Cognitive Load

- Problem: The text-view descriptor (4515) and the preview caption (4549) are single 10px italic lines set to the full width of the output panel, which at a normal window is 1,000px or more — roughly 190 characters. The Help modal's body column is 850px minus a 208px sidebar minus 40px of padding, about 600px, carrying 12px paragraphs at roughly 100 characters (dogHelpContent.jsx:59, 92-101).

- Why it matters: The critique target is 60 to 66 characters and the hard ceiling is 75. Italic at 10px across 190 characters is the least readable text on the surface, and it is the text explaining that the preview cannot be edited, which is the question a new user will ask first.

- Change: Both captions go to the Caption step at 12px, roman not italic, in a 60ch measure set in `ch` and left-aligned to the panel gutter. The Help modal's prose column caps at 72ch and the modal width drops accordingly, or the content column gains a right margin.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4549` — `<p className="text-[10px] text-stone-500 italic px-4 py-1.5">Preview is read-only. Select text and right-click to rewrite with AI, or switch to markdown view to`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4515` — `<p className="text-[10px] text-stone-500 italic">Edits here are reflected in the visual preview. Right-click for AI rewrite options.</p>`




**D28 · LOW · System** — The Core / Ref badge is a StatusBadge lookalike with an inline colour table  
law: Law of Similarity

- Problem: Lines 3935-3948 and 3957-3970 are byte-identical apart from the collection they toggle, and both write their own colours inline: `#ea580c` / `#44403c` fill, `#fff7ed` / `#a8a29e` ink, `#c2410c` / `#57534e` border, at a hard 52px width and 9px mono uppercase with `tracking-wider`.

- Why it matters: A status value rendered from an inline colour table is exactly what the shared StatusBadge exists to prevent, and it has already been duplicated once inside this file. The 52px fixed width is the right instinct and should survive.

- Change: One StatusBadge taking a semantic token (`core` / `reference`), rendering fill, ink and label from one source at the 11px Label step, min-width 52px so the filename column still lines up. Delete both inline colour tables and the second copy of the JSX.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3940` — `width: '52px',                                     backgroundColor: isCore ? '#ea580c' : '#44403c',                                     color: isCore ? '#fff7ed`




**D29 · LOW · Build** — Twelve icon-only buttons are labelled by title attribute alone; one aria-label in three files  
law: Jakob's Law

- Problem: `title=` appears 22 times and `aria-label` once (3846). Undo, redo, Import/Export history, clear history, both view-toggle buttons, all five formatting-toolbar buttons, the rewrite cancel and regenerate buttons, and the help button in the settings footer are icons with a `title` and no accessible name.

- Why it matters: `title` is not an accessible name in every assistive context and it is invisible to touch and keyboard. It also means the tooltip text is the only place the button's meaning is written, which is why the formatting toolbar's five identical 22px orange icons need hovering one at a time to identify.

- Change: Give IconButton a required `title` that it also emits as `aria-label`. No visual change.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4462` — `className={'p-1 rounded transition-colors ${undoRedoCounts.undo === 0 ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:bg-orange-500/20 active:bg-`




**D30 · LOW · Density** — Three upload affordances on one surface, at two dash colours and one solid border  
law: Law of Similarity

- Problem: The main document upload is a solid-bordered button styled as a control (3992). The New Project modal's two dropzones are `border-2 border-dashed border-stone-600` at `px-3 py-3` (5321, 5354). HistoryModal's import is `border-2 border-dashed border-stone-500` as a full-width label (374). Three treatments for the same verb, two dash greys.

- Why it matters: Law of Similarity: identical function should look identical. A user who learns that a dashed box accepts files will not recognise the solid button at 3992 as the same thing.

- Change: One Dropzone: hairline dashed at the rule token, 4px radius, 13px sentence-case body, 24px icon, one hover state. Apply to all three, and let 3992 keep its compact inline form as the `small` variant of the same component.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:5321` — `className="border-2 border-dashed border-stone-600 rounded-sm px-3 py-3 text-center cursor-pointer hover:border-orange-500 transition-colors"`<br>`src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx:374` — `<label className="block w-full py-2 px-4 bg-stone-700 hover:bg-stone-600 rounded-sm font-medium text-stone-300 text-sm text-center cursor-pointer border-2 borde`




**D31 · LOW · Colour** — Five error and warning treatments on one surface, none of them a shared component  
law: Law of Similarity

- Problem: The generation error is `bg-red-900/50 border-2 border-red-600 text-red-300` at 14px (3832). The theme error is `bg-amber-900/50 border-2 border-amber-600 text-amber-200` at 14px with its own dismiss button (3841-3849). HistoryModal's image-prompt error is a bare `text-xs text-red-400` paragraph (348), its folder-expiry warning a bare `text-[10px] text-amber-600` (287). ModelPicker adds `text-amber-500/80` and `text-red-400/80` (150, 157).

- Why it matters: Six red and amber values doing two jobs. A warning at 10px with no container is indistinguishable from a hint at 10px with no container, which is the case at HistoryModal 284 versus 287 — two adjacent 10px lines, one informational and one a failure.

- Change: One Banner taking `warning` / `danger`, one fill, one ink, one hairline, 13px body, optional dismiss. Apply to 3832, 3841, HistoryModal 287 and 348, and ModelPicker 150/157. Inline error text inside a form uses the Field error slot rather than a loose paragraph.

- Evidence: `src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx:287` — `<p className="text-[10px] text-amber-600 mt-1">Folder access expired. Click Browse to re-select.</p>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3841` — `<div className="p-3 bg-amber-900/50 border-2 border-amber-600 rounded-sm text-amber-200 font-medium text-sm flex items-start justify-between gap-3">`




**D32 · LOW · Density** — The uploaded-file chips are pinned to a 288px x 32px hard grid that wraps into columns of five  
law: Law of Proximity

- Problem: Each file row is `w-72 h-8` (4016) and the list is chunked into columns of five by `Math.ceil(uploadedFiles.length / 5)` (4010), so twenty files render as four fixed 288px columns regardless of the panel's width. With the sidebar at 224px and a maximised window the row has space for five or six columns; on a 1280px window four columns of 288 plus gaps overflow the section.

- Why it matters: A hard column count against a fluid container is the one layout on this surface that can actually break, and the 32px row height with a 16px icon, a 12px name, a 10px size and two 12px icon buttons is over-packed for the height it was given.

- Change: Replace the manual chunking with a CSS grid using `repeat(auto-fill, minmax(288px, 1fr))` and a 36px row. Same chips, same order, same remove and add affordances, and the row now matches the 36px table-row token.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4010` — `{Array.from({ length: Math.ceil(uploadedFiles.length / 5) }, (_, colIdx) => (`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4016` — `<div key={fileData.id} className="flex items-center gap-2 px-2 py-1.5 bg-stone-700 rounded-sm border border-stone-600 w-72 h-8">`




**D33 · LOW · Density** — The Settings model dropdown is indented 24px further than everything else in its modal  
law: Law of Proximity

- Problem: HistoryModal wraps the conditional image-model select in `className="px-6"` (331), inside a body that is already `p-4`. The select therefore sits 40px from the modal edge while every other control in the same column sits at 16px. It is the only 24px indent in any of the three files.

- Why it matters: The indent was presumably meant to express that the select belongs to the checkbox above it, but the checkbox is at 16px, so the relationship reads as a drift rather than a nest.

- Change: Delete `px-6`. Express the dependency with proximity instead: 4px between the checkbox and its dependent control, 16px to the next group, which is the Field ratio already used in AuthShell.

- Evidence: `src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx:331` — `<div className="px-6">                   <label className="block text-[10px] text-stone-500 mb-1 uppercase tracking-wide">Image Generation Model</label>`




**D34 · LOW · Hierarchy** — The mode switch that decides the screen's primary action is the least prominent control on it  
law: Selective Attention

- Problem: The Full Deck toggle sits at the far right of the label row above the deck-context textarea (4095-4114), as a 44x24 pill with a 12px uppercase label, one of five controls in that band. Flipping it disables the whole of Section 2 (which then renders at `opacity-50` with a 10px "(Disabled in Full Deck mode)" parenthetical at 4172) and swaps which Generate button exists.

- Why it matters: Selective Attention: the control with the largest consequence on the screen is styled as a minor option and placed where the eye arrives last. The 50 percent opacity on Section 2 is also the only place opacity is used to express state on this surface, and at 50 percent the 10px hint text inside it falls below any usable contrast.

- Change: Keep the toggle and its position (no interaction change), but give it the Von Restorff treatment the other four controls lose: it is the only element in that band at the 14px step, in a bounded region with its own hairline, and the three checkboxes drop to a Caption-step group at the left. Section 2's disabled state stops using opacity and instead sets the ink to 48 percent and the controls to `disabled`, so the explanatory text stays legible.

- Evidence: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4163` — `<section className={'bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)] ${fullDeckMode ? 'opacity-50' : ''}'}>`<br>`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4172` — `{fullDeckMode && <span className="text-[10px] font-normal normal-case ml-2">(Disabled in Full Deck mode)</span>}`





## Uniformity gaps

- **Keyboard shortcut hints** — here: None. Four document-level handlers at DeckOutlineGenerator.jsx:2846, 2872, 2905, 2921 register Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, arrow keys, Alt and Enter, and nothing in the interface names any of them. — elsewhere: RABBIT's BinsView renders a 34px bottom bar listing twelve Kbd pairs at BinsView.jsx:845-847, built on binUi's Kbd at binUi.jsx:134. — do: Mount the shared ShortcutBar at the bottom of the D.O.G. content column with the four D.O.G.-specific keys. This is Audrey's named example and it should be the first visible proof that the tools are one system.

- **Shared component module** — here: None. D.O.G. has no local token object and no UI module; all styling is inline class strings, 101 of them template literals with state ternaries. — elsewhere: RABBIT ships binUi.jsx with C, Btn, IconBtn, Chip, Menu, Modal, Field, TextInput, TextArea, Select, EmptyState, Kbd, Spinner, Toggle. The light pages share lightSurface.js across 30 files. — do: D.O.G. should be the first consumer of the promoted src/ui kit rather than growing its own L object. Its lack of local tokens is an advantage here: there is nothing to unpick.

- **Scrollbar styling** — here: An unscoped <style> block at DeckOutlineGenerator.jsx:3701-3730 that is always in the document and restyles every page's scrollbars, plus a second class .settings-scrollbar in the same block. — elsewhere: .wilson-light-scroll is defined once in index.css and applied by App.jsx per page. — do: Delete the block, add .wilson-dark-scroll to index.css beside the light one, have the shell apply it per page surface. One scrollbar system, two classes.

- **Dead hover class** — here: hover:bg-stone-750 on all sixteen Settings accordion headers (4783 and siblings). Tailwind has no stone-750 and index.css does not define one. — elsewhere: Otter.jsx:5364 and rabbit/views/TimelineView.jsx:5372 carry the identical dead class. — do: Fix all eighteen occurrences in one commit via the shared accordion header, or the pattern re-splits.

- **Panel header** — here: Seven headers at four sizes and three constructions: 3737, 3859, 4168, 4282, 4677, 5129, plus HistoryModal 205 and DuplicateResolver 93. — elsewhere: binUi's Modal (binUi.jsx:198) already has a single header/body/footer contract with a title and optional subtitle. — do: One PanelHeader at 32px with the 16px H2 title, driven from the same source as Dialog's header so a panel and a dialog cannot diverge again.

- **Modal backdrop** — here: Three values on one surface: bg-black/50 (4660), bg-black/70 (5120, HistoryModal 202, DuplicateResolver 86), inline rgba(0,0,0,0.6) (5242). — elsewhere: The system review counted 22 backdrop values across 66 hand-rolled overlays app-wide. — do: One backdrop, rgba(12,10,9,0.6), owned by Dialog. No component writes a backdrop again.

- **Buttons** — here: Nine padding pairs in use (px-2 py-1, px-2 py-1.5, px-3 py-1, px-3 py-1.5, px-3 py-2, px-4 py-1.5, px-4 py-2, px-4 py-3, py-2.5 px-4) with six orange fills and two inline hex fills at 5392/5400. — elsewhere: binUi's Btn (binUi.jsx:20-39) already has exactly two sizes and three variants. — do: Promote Btn as Button with primary / secondary / ghost / danger and sizes sm 28px and md 36px, sentence case, weight 600, no tracking. Delete all nine padding pairs and both inline fills.

- **Tabs** — here: Four active treatments: filled body with three-sided 2px border (4328), fill plus orange underline (4693), solid orange fill (HistoryModal 215), solid orange icon fill (4348). — elsewhere: The system review counted four tab bars with three active treatments app-wide; D.O.G. alone has four. — do: One Tabs with a 2px signal underline and no fill; the view toggle becomes a Segmented control, which is a different component with a different job.

- **Status and role badges** — here: The Core/Ref toggle writes fill, ink and border inline in two duplicated blocks (3939-3944, 3961-3966). — elsewhere: binUi has MediaTag (binUi.jsx:62) driven by a MEDIA_TYPE_META table. — do: One StatusBadge taking a semantic token, so a status colour can never be written inline again.

- **Empty and loading states** — here: Two empty states with two circle constructions (3789 at 40px, 4554 at 56px dashed) and no loading state at all. — elsewhere: binUi has EmptyState (binUi.jsx:308) and Spinner (binUi.jsx:319) as separate components. — do: Adopt EmptyState for both, and add a separate Loading with skeleton rows so the two stop being the same picture.

- **Input focus treatment** — here: Two idioms: focus:border-orange-500 on 23 controls, focus:ring-2 focus:ring-orange-500 on the four New Project fields (5265, 5278, 5291, 5301). No focus treatment on any button. — elsewhere: The rest of the app has the same split; nothing uses focus-visible. — do: One focus-visible ring token applied by every interactive component in the kit.

- **Content gutter** — here: The tool's shell header uses px-4 (App.jsx:1830) while the non-tool page headers use px-6 (App.jsx:1893), and inside D.O.G. the gutters run 8, 12, 16 and 20. — elsewhere: App.jsx already applies a single px-6 to the eight non-tool pages. — do: One 24px page gutter for the top bar, the nav strip's right edge and every page's content area, tools included, so the D.O.G. logo, the sidebar rows and the main column finally share a left edge.


## Alignment issues

- Output panel, six stacked rows (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4315`): Header px-3 (4282), tabs bar px-2 (4315), regenerate bar px-3 (4366), formatting toolbar px-3 (4457), descriptor px-4 (4514), preview caption px-4 (4549). Six rows in one bordered box starting at three x positions. → One 24px gutter for every row inside a panel; sub-rows inherit rather than declaring their own.

- Section 1 and Section 2, header versus body (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3856`): Both section headers are px-3 (3856, 4165) while both bodies are p-4 (3873, 4183), so the section title sits 4px left of every field it introduces. → Header and body take the same 24px gutter.

- Settings slide-out, accordions versus chrome (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4783`): Header, tabs, lock bar and footer are px-4 (4674, 4691, 4713, 5087); all sixteen accordion headers and the three section titles are px-3 (4777, 4783 and siblings). The panel's entire body is 4px left of its own frame. → One gutter throughout the panel.

- Regenerate bar, control heights (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4367`): Input 30px (4383, py-1.5 plus a 1px border), select 30px (4392), Regenerate button 28px (4409, no border), undo 28px and redo 28px (4428, 4442). Five controls, three heights, centred so no two share an edge. → All Toolbar children at 28px inside a 44px row.

- Formatting toolbar versus regenerate bar (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4457`): The regenerate bar is py-2 around 30px controls (46px row); the formatting toolbar directly beneath is py-1 around 22px buttons (30px row). Two toolbars, two heights, adjacent. → One 44px toolbar height for both.

- Output header action pair (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4288`): Export .md and Copy are px-2 py-1 with 12px icons, about 24px tall, inside a py-2 header bar. They are the only 24px buttons on the surface. → Both become 28px sm Buttons in the PanelHeader actions slot.

- Icon-to-label baselines (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3739`): Sidebar header pairs a 12px icon with 12px text at gap-1; Settings and Help headers pair a 20px icon with 16px text at gap-2; the section headers pair a 24px filled circle with 14px text at gap-2; the file chips pair a 16px icon with 12px text at gap-2. Four ratios, four optical baselines. → One icon size per type step (14px with Dense and Caption, 16px with Body and H3, 24px in empty states) and one 8px gap.

- Sidebar versus main column left edges (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3736`): The sidebar is w-56 (224px) with its header at px-2 and its rows at p-2, so sidebar content starts at 8px; the main column starts at 224 + 16 = 240px; the shell logo above starts at 16px. Three unrelated left edges in the first 240px of the screen. → Sidebar rows take a 12px gutter as a Panel, the main column takes 24px, and the shell header takes the same 24px so the logo aligns with the main column rather than with nothing.

- Sidebar row internal columns (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:3805`): Row one is #pageNum left and timestamp right; row two is the title with pr-5 reserved for a button that is absolutely positioned over row one; row three is the layout name. The reserved space and the button that needs it are on different lines. → Two columns: a fixed-width page-number column with tabular numerals, and a content column carrying title then a Caption-step metadata line of layout plus timestamp. The action slot is a third fixed column at the right, full row height.

- Duplicate resolver, fixed box against fluid content (`src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx:89`): The dialog is hard-set to 894 x 349 and the preview popup to 740 wide with a 714 x 402 inner frame. None of these are on the 4px grid and the dialog cannot grow when three or more duplicates are offered side by side. → 960px Dialog width token, auto height with a max of 80vh, option cards on a flex row with a 240px min. The 714 x 402 preview frame stays pixel-exact because LayoutVisualizer's geometry depends on it.

- Settings panel width (`src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx:4667`): width: '40%' with minWidth 400px, so the prompt textareas re-measure on every window resize while their 24-line content does not, and at a wide window the 12px mono prompt runs past 140 characters. → Fixed 480px panel, prompt textareas at a 72ch measure.


## Hick's Law hotspots

- Settings slide-out, System Prompts tab (DeckOutlineGenerator.jsx:4774-5012): 22 visible choices → Two tabs, one lock toggle, three section titles and sixteen collapsible prompt editors scroll in one flat column, every editor wearing an identical 12px bold uppercase orange title and a 10px description. Keep all sixteen and their order. Turn the three existing section titles (4777, 4852, 4978) into sticky group headers at the 11px Label step with a count ("Page generation · 4", "Visual assets · 7", "AI rewrite · 5"), replace the full-width bordered bar with a hairline above, and collapse all groups but the first on open. Nothing is removed, moved or made unreachable; the scroll simply stops being sixteen identical objects.

- Slide Layout dropdown (DeckOutlineGenerator.jsx:4192-4204, constants.js:10-24): 15 visible choices → Fifteen layouts in one flat alphabetically-unordered list, and the description only appears after selection (4207-4211), so the row below the select resizes every time the choice changes. Add optgroups by structural family — Title, Columns, Text, Feature, Gradient — which changes nothing about how the select is operated, and move the description into a fixed-height 13px caption slot below the select so the layout row stops jumping.

- Section 1 control band (DeckOutlineGenerator.jsx:4058-4114): 5 visible choices → A field label, three checkboxes and a mode toggle share one horizontal band, four of them at 10px uppercase and one at 12px, with no grouping cue between them. Wrap the three "use X" checkboxes in one Field group under a single 11px Label eyebrow ("Include in generation") with 13px sentence-case option labels, placed under the textarea label rather than beside it, and let Full Deck have the right edge to itself at the 14px step as the band's only mode switch. Same five controls, same handlers.

- Right-click context menu (DeckOutlineGenerator.jsx:5175-5230): 10 visible choices → Five edit and clipboard items plus five AI rewrite modes, with a group label on the rewrite set only and two unlabelled hairline dividers doing the rest of the work. Give the Edit and Clipboard groups their own 11px Label headers so all three groups are named, and keep the dividers where they are. Ten items and one order, unchanged.

- History Import/Export modal, Export tab (modals/HistoryModal.jsx:227-367): 11 visible choices → Two mode buttons, a name field with a filename suffix chip, a folder field with Reset and Browse, three checkboxes, a conditional model select indented 24px further than everything else, a conditional error line and one primary button. Group the three checkboxes under a single "Also include" Label eyebrow with a hairline above, delete the px-6 indent at 331 and nest the model select under its own checkbox by proximity instead, and leave everything reachable exactly as now.

- Output panel control stack (DeckOutlineGenerator.jsx:4282-4510): 14 visible choices → Between the panel title and the first line of output the user passes Export .md, Copy, N page tabs each with its own close button, two view-toggle buttons, a revision input, a layout override select, Regenerate, undo, redo, and then five more formatting buttons. Fourteen controls in four stacked strips totalling 140px of chrome. Do not remove any of them; collapse the formatting toolbar's five buttons into the regenerate bar as a right-aligned group separated by 24px, which puts the whole control surface in two 44px rows instead of four, and returns about 60px of preview height.


## Type inventory

| px | How it is set | Weight | Case | Tracking | Count | Roles it currently plays |
|---|---|---|---|---|---|---|
| 9 | `text-[9px]` | 700 | UPPER | wide / wider | 6 | Core/Ref badge label (3938, 3960), "File roles" eyebrow (3927), "Replacing" / "Rewritten" eyebrows (4574, 4582), "AI Rewrite" menu group label (5218) |
| 10 | `text-[10px]` | 400 and 700 mixed | mixed | wide on 12 of them | 81 | Every field hint (3879, 3989, 4116, 4190, 4219, 4236), project meta (3906, 3915), file sizes (4023), checkbox labels (4071, 4081, 4091), layout description (4208), "Edit Output:" (4369), lock sub-label (4737), all 16 accordion descriptions (4786+), all 16 Reset-to-default links (4794+), both read-only captions (4515, 4549), panel footer note (5088), context-menu shortcut keys (5191), New Project labels and file rows (5258, 5324, 5338) |
| 11 | `text-[11px]` | 400 and 700 | sentence | none | 4 | Help modal sidebar items (5148), rewrite preview source and result (4576, 4590), Replace button (4606) |
| 12 | `text-xs` | 400, 500, 700 | mixed | wide on 9 | 83 | Body, section labels (3876, 4060, 4187, 4216, 4233), sidebar panel title (3740), Output panel title (4283), history row title (3809), all inputs and selects in the regenerate bar (4383, 4392), tab labels (4326), Export/Copy buttons (4288, 4295), Regenerate button (4409), all 16 Settings prompt textareas (4793+), lock state (4728), Settings section titles (4778), context-menu items (5190), version footer (5159), New Project footer buttons (5391, 5399), HistoryModal name field, folder field and Browse (243, 267, 276) |
| 13 | inline `fontSize: '13px'` | 400 and 700 | sentence | none | 4 | DuplicateResolver option label (117), "Selected" (152), Export All (163), Continue (171) |
| 14 | `text-sm` + 2 inline | 400 and 700 | UPPER on titles | wide on titles | 27 | Section 1 and Section 2 titles (3859, 4168), error and theme-error banners (3832, 3841), the deck-context and page-request textareas (4134, 4254), the layout select and page-number input (4196, 4226), both Generate buttons (4143, 4262), the markdown editing textarea (4529), Settings tab labels (4691, 4701), New Project title and inputs (5254, 5265, 5278), HistoryModal header, mode buttons, body copy and export button (205, 215, 229, 355), DuplicateResolver subtitle and slide title (94, 127), preview label (190) |
| 16 | inherited (no class) + 1 inline | 700 | UPPER | wide | 3 | Settings panel header (4677), Help modal header (5129), DuplicateResolver title (93) |
| 24 | `text-[24px]` in the shell | 700 | UPPER | tight | 1 | The D.O.G. wordmark in the orange bar (App.jsx:1835) |

Eight sizes with no ratio between any two of them. The de-facto body is 12px and there is a second body at 10px carrying 81 instances of real instruction text, which is the readability complaint in one line. Uppercase appears 56 times and tracking 56 times across four of the eight sizes, at three tracking values (`wide` x56, `wider` x3, `widest` x7, the last used only inside the New Project modal). Weight has three values in play (400, 500 via `font-medium` x14, 700 via `font-bold` x52) and `font-semibold` is never used, so the surface jumps from regular to bold with nothing between.

**Collapse to:** H2 16px for all seven panel and dialog titles; H3 14px for the two section titles and the active tab; Body 14px for prose, inputs, buttons and option labels; Dense 13px for sidebar rows, table-like lists and tree rows; Caption 12px for all 81 of the current 10px hints; Label 11px UPPER +0.06em for field labels, badges, eyebrows and Kbd. That is six of the eight scale steps, and it deletes the 9px, 10px and inline-13px/16px tiers entirely.


## Priority order

D1 — demote font-mono to numerics, ids and code; this is the largest single contributor to the dated look and it is a find-and-delete on eleven lines in this surface, D2 — delete the injected global <style> at 3701-3730 and move the dark scrollbar to index.css; one deletion, fixes every page in the app, D3 — fix hover:bg-stone-750 on all sixteen D.O.G. accordions plus the two other tools; one string, sixteen dead hover states restored, D7 — adopt the eight-step scale and delete the 9px, 10px and inline-px tiers, including all ten inline fontSize values in DuplicateResolverModal, D8 — one dominant element per view: unfilled panel headers, sentence case everywhere except the Label role, and the Generate button as the only 36px control in the input column, D9 — collapse 110 text-orange-400 and six stone greys to one ink at three screens plus one signal with four jobs, D4 — one PanelHeader for all seven panel and dialog titles, D15 — one 1px hairline; delete all 41 border-2, D14 — delete the five hard offset shadows and unify the six soft ones into one floating shadow, D13 — one 24px gutter for every row inside a panel; the cheapest visible improvement to alignment on the whole surface, D6 — mount the ShortcutBar for the four undocumented shortcuts; this is Audrey's named uniformity example and it is visible proof the ecosystem is one system, D11 — separate Loading from EmptyState so the output panel stops asserting nothing exists while it generates, D10 — one focus-visible ring on every interactive component, D5 — promote Dialog and adopt it for the four modals; one backdrop, three width tokens, D16 — one 28px control height inside a 44px Toolbar, applied to all four control strips, D21 — one Tabs with an underline; the view toggle becomes a Segmented control, D26 — one Checkbox and one Toggle, label-associated, white knob, D19 — three icon sizes, and both empty-state circles deleted, D18 — one Disclosure chevron, rotated not swapped, D20 — rebuild the New Project modal on Dialog, Field, Input and Button; delete tracking-widest, the #f4a261 ink and both ✕ glyphs, D27 — 60ch measure on both read-only captions, roman not italic, at the Caption step, D31 — one Banner for the five error and warning treatments, D28 — StatusBadge for the Core/Ref toggle, one implementation not two, D30 — one Dropzone for the three upload affordances, D12 — stop the prompt textareas moving the Generate button (flagged: changes how much text is visible at rest), D17 — reserve a fixed action slot in the sidebar row so the timestamp stops disappearing on hover (flagged: touches row interaction), D34 — give the Full Deck toggle the isolation its consequence deserves, and stop expressing Section 2's disabled state with 50 percent opacity, D23 — white, not orange-200, for the tool subtitle on the orange bar (palette decision; shared with Otter and RABBIT), D24 — delete the dead animate-slide-in-right class and the duplicate injected keyframes, D32 — replace the manual five-row chunking of the file chips with an auto-fill grid at 36px rows, D22 — unnest the close button from the tab button (flagged: touches tab interaction), D25 — reduced-motion guards, and cut the 500ms hover-intent delay and its "Hold..." label (flagged: touches the duplicate preview), D29 — emit title as aria-label from IconButton, D33 — delete the px-6 indent on the HistoryModal model select


## Rework scope (reviewer's estimate)

Files: `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx`, `src/tools/deck-outline-generator_v0.514/modals/HistoryModal.jsx`, `src/tools/deck-outline-generator_v0.514/modals/DuplicateResolverModal.jsx`, `src/data/dogHelpContent.jsx`, `src/components/settings/ModelPicker.jsx`, `src/App.jsx`, `src/index.css`  
Approx lines: 1050  
Suggested sessions: 3  
Split: SESSION A — system adoption, mechanical, about 500 lines, all in DeckOutlineGenerator.jsx plus index.css. Delete the injected <style> and add .wilson-dark-scroll; demote font-mono per D1; apply the eight-step scale to every text node on the surface; collapse the ink and signal per D9; one 1px hairline everywhere; one radius pair; one 24px gutter; delete the five hard offset shadows and unify the soft ones; fix hover:bg-stone-750 here and in the two other tools. No structural change, no component extraction, so it can be reviewed as a pure token diff. Verify the preview geometry before and after.

SESSION B — component adoption, about 400 lines across DeckOutlineGenerator.jsx, HistoryModal.jsx and DuplicateResolverModal.jsx. Introduce PageHeader/PanelHeader, Toolbar, Button, IconButton, Input, Select, TextArea, Checkbox, Toggle, Tabs, StatusBadge, EmptyState, Loading, HoverActions and Kbd/ShortcutBar from the promoted kit. Rebuild the four control strips on Toolbar, the seven panel headers on PanelHeader, the four modals on Dialog, the sidebar on Panel, and add the ShortcutBar. This is the session that carries the state-in-className risk, so it should go component by component with the ternaries transcribed into props rather than rewritten.

SESSION C — the dense sub-views, about 250 lines. The Settings slide-out (grouping and sticky group headers per the Hick's hotspot, prompt textarea measure, fixed 480px width), the Help modal and dogHelpContent's type classes plus its 72ch measure, the context menu's three group labels, the rewrite popover on Popover, the layout-select optgroups and fixed-height description slot, and the flagged interaction-adjacent items (D12, D17, D22, D25) which should be presented to Audrey as a short list before being applied, since each one changes a behaviour as well as a look.  
Risks: 1. A 5,411-line file with the entire render tree inside one return statement from 3698 to 5411, no sub-components, and no local token object. There is no seam to split an edit along, so a mis-scoped change is hard to review and impossible to diff cleanly. 2. Ninety-eight of the 101 className values in that file are template literals and 89 carry a state ternary, so disabled, active, locked and full-deck states are encoded inside class strings (examples: 3886, 4134, 4196, 4254, 4328, 4428, 4691, 4728, 4752, 4788, 4793). A naive class swap will silently drop a state; every ternary has to be read, not pattern-matched. 3. LayoutVisualizer and VideoThumbnail are out of scope but LayoutVisualizer is mounted inside the panel being reworked (4535) and again inside DuplicateResolverModal (195). Changing the panel's border weight or padding changes the width the preview measures, and the duplicate modal's 714 x 402 inner frame must stay pixel-exact. Take a before screenshot of the preview at a fixed window size and compare after every commit. 4. The injected <style> at 3701 is global and always mounted, so deleting it changes scrollbars on every page in the app at once. It must be replaced app-wide in the same commit or the whole app loses its scrollbar styling. 5. hover:bg-stone-750 also lives in Otter.jsx:5364 and rabbit TimelineView.jsx:5372; fixing it only here re-splits a pattern that is currently at least consistently wrong. 6. App.jsx:1828-1848 is byte-identical to the Otter and RABBIT header blocks at 1850-1870 and 1872-1892, so the subtitle fix touches all three tools. 7. LOW RISK, confirmed: no test file references DeckOutlineGenerator or pins any D.O.G. class name. The only tests near this surface are pageBars.test.js and the four model-registry tests, none of which assert markup. 8. The Settings panel's width is a percentage (4667), so any prompt-textarea measure change has to be verified at both the 400px minimum and a maximised window.
