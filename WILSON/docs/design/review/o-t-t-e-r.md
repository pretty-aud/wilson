# Review — O.T.T.E.R. (learning platform tool) — nav bar, Sidebar 1 (courses/subjects), Sidebar 2 (lessons/hotkey groups/node groups), Library, Prompt/Generate, Study + lesson markdown, Sources, Quiz Center + question/results/code-writing, Hotkeys, Functions, Nodes, Search modal, Requests, Validator (setup + results), Settings slide-out, Trash, and the six dialogs


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\RequestsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ShareCourseDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ChangeRequestDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\TrashPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseRowMenu.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseBadges.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseFilterChips.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\SidebarCollapse.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\otterSharing.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\data\otterHelpContent.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\layout\pageBars.js`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ViewTabs.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\bins\binUi.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx`


## Job

O.T.T.E.R. is a reading tool wearing an authoring tool's clothes. The one action per sub-view: Library = open a course; Course detail = open or generate a subject; Prompt = generate; Study = READ THE LESSON and mark it complete; Quiz = start a quiz; Hotkeys / Functions / Nodes = find one entry in a reference; Search = jump to a hit; Requests = decide or respond to one request; Validator = pick lessons, then act on one audit; Trash = restore one thing. The tool's centre of gravity is Study, because everything else exists to produce or find a lesson to read. That is the finding hidden in plain sight: the reading surface is the only view with no toolbar, no header bar, no centring and no measure, and it is the only place in the tool set at 16px. Nine of ten views are styled as a control panel and the tenth, the one that matters most, was never designed at all.


## What works

- CourseRowMenu is the only control in the tool whose contrast and target size were actually measured. The PHASE 5 comment block at CourseRowMenu.jsx:157-167 records stone-600 at 1.35:1, the replacement at 4.08:1, and 24x24 / 30x30 hit boxes. It is the template the rest of the tool should copy, and the reason it stands out is that nothing else in O.T.T.E.R. was measured this way.

- SidebarCollapse is genuinely well built. The chevron stays at the same y whether open or collapsed (SidebarCollapse.jsx:138-152), the reopen target is a full-height 24px rail rather than a hover hotspot, the shortcut matches Notion and Claude, and the lazy useState initialiser means no open-then-collapse flash on first paint.

- The failure and empty copy is better than most shipping products. Otter.jsx:3683 'Read only — study it, or make your own copy.', Otter.jsx:4010 'Outline only — the owner hasn't written this yet.', Otter.jsx:4082 'You have N courses, but none match "X"'. Each names the cause and offers the next move instead of a dead end.

- The lesson sidebar carries completion as a SHAPE, not a colour: a filled CheckCircle2 versus an empty ring (Otter.jsx:3805-3807). It is the only state in the tool that survives being read in greyscale, and it is what the status chips and grade badges should be doing.

- CourseBadges.originOf collapses four provenance states into one badge shape used identically in the sidebar, on the card and in the dialogs (CourseBadges.jsx:52-110). It is the closest thing O.T.T.E.R. has to a real component and it proves the pattern works here.


## Findings (38)

**O1 · HIGH · System** — One tool, five tab treatments and three different active states  
law: Law of Similarity

- Problem: The same object, a strip that switches what the pane shows, is drawn five different ways inside O.T.T.E.R. The top nav is 14px sans font-medium sentence case with an orange text colour plus a 2px orange bottom border on a stone-900 fill. The quiz tabs are identical except font-bold. The node system tabs are identical except they carry a -mb-[2px] against a border-b-2 group. The settings tabs are font-bold and give the INACTIVE tab a bg-stone-700 fill, which no other tab bar does. The help modal sidebar uses 11px with a border-l-2 and a bg-stone-800 fill. Law of Similarity says things that look alike do the same job; here things that do the same job look different five times, so the user relearns 'which one is on' in every pane.

- Why it matters: Fixing the tab bar once resolves four downstream hierarchy complaints at no extra cost, and it is the single most visible strip in the tool because it is on screen in every view.

- Change: Collapse all five onto one Tabs component: 14px sentence case, weight 400 inactive and 600 active, one 2px signal underline, no fill on either state, hairline group separator only. Apply it to the top nav (Otter.jsx:2857), quiz tabs (4682), node system tabs (5189), settings tabs (5299) and help sidebar (3169). The help sidebar keeps its vertical orientation and its left border, but at the same type step and the same active ink.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:2857` — `className={'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${   editMenuOpen ? 'text-orange-400 border-orange-500 bg-stone`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5299` — `className={'flex-1 px-4 py-2 text-sm font-bold transition-colors border-b-2 ${settingsTab === 'prompts' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'te`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3169` — `className={'w-full text-left px-3 py-1.5 text-[11px] transition-colors ${helpPage === item.id ? 'bg-stone-800 text-orange-400 font-bold border-l-2 border-orange`




**O2 · HIGH · System** — The same nav strip is drawn in two incompatible languages in two tools  
law: Jakob's Law

- Problem: O.T.T.E.R.'s view switcher is 14px sans, sentence case, no letterspacing, active = orange text plus underline, on a bg-stone-800 bar with a 2px stone-600 bottom rule. R.A.B.B.I.T.'s ViewTabs is 11px MONO, UPPERCASE, tracking-wider, active = a solid #ea580c fill with cream text, on #1c1917 with a 1px #44403c rule. These are the same control in the same ecosystem and they share nothing: not the size, not the family, not the case, not the tracking, not the active treatment, not the ground, not the border weight. A user moving between tools has to relearn the top of the window. This is precisely the uniformity complaint Audrey raised about the bins shortcut bar, one strip higher.

- Why it matters: Cross-tool consistency is the brief's headline ask and this is the highest-traffic instance of it. Two strips, one component.

- Change: One Tabs component across both tools, taking the O.T.T.E.R. underline model rather than R.A.B.B.I.T.'s fill (a content-layer element must not borrow the frame's #ea580c). 14px sentence case, 400/600, 2px signal underline, 1px hairline under the strip, 44px strip height in both. R.A.B.B.I.T.'s icon-plus-label arrangement is the better one and should be the shared shape; O.T.T.E.R. already does it too.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\components\ViewTabs.jsx:52` — `className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider ..." style={{ color: active ? '#fff7ed' : '#a8a29e', backgroundCol`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:2852` — `<nav className="bg-stone-800 border-b-2 border-stone-600 flex items-center shrink-0">`




**O3 · HIGH · Hierarchy** — Ten views, four page-title treatments, three of which disagree on colour and chrome  
law: Von Restorff Effect

- Problem: Seven views title themselves text-2xl font-bold text-orange-400 floating in the content padding with no header bar (Library, Prompt, Sources, Hotkeys, Functions, Nodes, Trash). Quiz Center uses text-lg font-bold text-orange-400 inside a bg-stone-800 px-6 py-3 header bar. Requests uses text-white font-bold text-lg with a leading icon, no bar. Validator uses text-base font-bold text-stone-200 inside a bg-stone-800 px-6 py-4 header bar, the only non-orange page title in the tool. So: three sizes, three inks, two chrome states, two bar heights. In a squint test the eye lands somewhere different in every view, and in Validator it does not land on the title at all because at 16px stone-200 it is quieter than the orange Validate tab above it.

- Why it matters: One dominant element per view is the third critique pass and this surface fails it in three of ten views by making the title quieter than its own tab.

- Change: One PageHeader at 56px with a 24px gutter and a hairline bottom, present in EVERY view including the seven that currently float. Title at the 20px step, weight 600, sentence case, one ink. Subtitle at 13px in the same ink. Right-hand actions slot. That one component also fixes O11's alignment problem because the header gives the right-hand controls a baseline to sit on.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4058` — `<h2 className="text-2xl font-bold text-orange-400">Course Library</h2>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4727` — `<h2 className="text-lg font-bold text-orange-400">Quiz Center</h2> <p className="text-stone-500 text-xs">Select software/languages and subjects to quiz yourself`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx:600` — `<h2 className="text-base font-bold text-stone-200">Lesson Validator</h2>`




**O4 · HIGH · Typography** — The lesson reading surface runs at about 112 characters per line  
law: Cognitive Load

- Problem: .lesson-content p sets no font-size, so it inherits the 16px browser default and is the only 16px body text in a tool whose de-facto body is 12px. Its container is max-w-4xl, which is 896px. At 16px that is roughly 112 characters per line against a 60 to 66 target and a 75 ceiling. Long measure is the specific failure mode where the eye loses its place on the return sweep, and this is the surface a user spends the most continuous time on. The leading of 1.7 is set correctly for a long measure, which tells you the measure was never checked: 1.7 is a compensation for a line that is already too long.

- Why it matters: This is the tool's primary job and the cheapest possible fix: two CSS declarations. Nothing else on this list improves reading as much per line changed.

- Change: Set .lesson-content to the 14px body step with a hard measure: max-width 62ch on p, li and blockquote, leading 1.5. The column stays left-aligned in a 720px reading container. Do not narrow the pane itself; constrain the text block inside it so tables and code blocks can still run full width.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:253` — `.lesson-content p { margin: 0.5rem 0; line-height: 1.7; color: #d6d3d1; }`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4581` — `<div className="p-6 max-w-4xl">`




**O5 · HIGH · Hierarchy** — Lesson heading hierarchy is inverted: h3 is nearly twice as loud as h1  
law: Von Restorff Effect

- Problem: The three heading levels are distinguished by HUE, descending in size but ASCENDING in luminance: h1 24px #f97316, h2 20px #fb923c, h3 17.6px #fdba74. Measured against the #1c1917 ground those are roughly 6.8:1, 8.5:1 and 12.1:1. The smallest heading has almost double the contrast of the largest, so on a page with several h3s under one h1 the eye lands on the subheadings first. Inline bold is a fourth colour, #fbbf24 amber, brighter still than every heading, so a bolded phrase mid-paragraph out-shouts the section it sits under. And em is #a8a29e, dimmer than the #d6d3d1 body, so italic emphasis DE-emphasises. Four colours are doing a job that size and weight should do, and three of the four are doing it backwards.

- Why it matters: Hierarchy driven by colour collapses the moment the palette moves, and here it is already collapsed in the wrong direction. Six CSS lines.

- Change: One ink for all headings and body. h1 at the 20px step weight 600, h2 at 16px weight 600, h3 at 14px weight 600, body 14px weight 400, all at the 100 percent ink. strong goes to weight 600 at the same ink, not a colour. em stays italic at the same ink, not a dimmer one. Colour leaves the reading surface entirely except for links and inline code.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:250` — `.lesson-content h1 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.75rem; color: #f97316; } .lesson-content h2 { ... color: #fb923c; } .lesson-conten`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:256` — `.lesson-content strong { color: #fbbf24; } .lesson-content em { color: #a8a29e; font-style: italic; }`




**O6 · HIGH · Colour** — Two of the four greys carrying this surface fail contrast, at 216 uses  
law: Cognitive Load

- Problem: The ink ladder is stone-300, stone-400, stone-500, stone-600. Measured on the two grounds this tool uses: stone-500 (#78716c) is 3.59:1 on stone-900 and 3.16:1 on stone-800; stone-600 (#57534e) is 2.29:1 and 2.01:1. Both are below the 4.5:1 body-text threshold and stone-600 is barely above Audrey's own stone-400-on-orange complaint of 1.4:1. They are used 142 and 74 times. And they carry real information, not decoration: the library subtitle, every subject card description, the '[outline]' marker, the 'Read only' explanation, 'Add subject', 'No matches found', 'or carry on below to generate your own'. Several of those are the only sentence explaining why a button is missing, rendered at 10px at 2.3:1.

- Why it matters: Audrey's first stated goal is 'how to make things easier to read'. This is the measurable half of that, it is a find-and-replace against a token, and it removes two of the four inks on the way.

- Change: Collapse four greys to one ink at three screens: 100 percent for body and headings, 72 percent for secondary, 48 percent for metadata. stone-300 becomes 100, stone-400 becomes 72, stone-500 becomes 48 (which measures around 4.3:1, a real improvement), and stone-600 stops being a text colour entirely. Where it currently means 'disabled' use opacity on the whole control instead.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3682` — `<p className="py-1.5 text-[10px] text-stone-600 italic" style={{ paddingLeft: '24px', paddingRight: '8px' }}>   Read only — study it, or make your own copy.`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4290` — `<span className="text-stone-600 text-[10px] self-center">   or carry on below to generate your own`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4002` — `className="text-stone-500 text-sm line-clamp-2 cursor-default"`




**O7 · HIGH · Colour** — text-orange-400 does nine unrelated jobs, 123 times  
law: Von Restorff Effect

- Problem: One value, #fb923c via text-orange-400, is simultaneously: the page title, every section heading, every field label, the active tab, the active sidebar row, link text, icon colour, badge text, and the version footer. When one colour marks nine things it marks nothing, and it is why a 10px field label reads as loud as a 24px page title in a squint test: they are the same colour, both bold, and the label additionally carries uppercase and tracking. Von Restorff only works when the isolated thing is rare.

- Why it matters: This is the single change that makes the tool read as modern rather than as a control panel, and it costs nothing but class edits.

- Change: Signal keeps three jobs on this surface: the one primary action, the one active state, and the current selection. Page titles, section headings, field labels, empty-state titles, icons and the version footer all move to the plain ink and take their rank from size and weight. Concretely: Otter.jsx:4058, 4165, 4175, 4206, 4482, 5018, 5041, 5076, 5098, 5163, 5214 and TrashPanel.jsx:138 lose the orange; the nav active state, the primary button fill and the selected sidebar row keep it.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4218` — `<label className="block text-xs font-bold text-orange-400 mb-2 uppercase tracking-wide">Mode</label>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3180` — `<span className="text-xs text-stone-500 font-mono">{typeof __OTTER_VERSION__ !== 'undefined' ? __OTTER_VERSION__ : 'v?'}</span>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5098` — `<h3 className="text-orange-400 font-bold uppercase tracking-wide text-sm mb-2">{cat.category}</h3>`




**O8 · HIGH · Typography** — Twelve type sizes, 91 uppercase runs and 110 tracked runs across one tool  
law: Miller's Law

- Problem: The surface uses 9, 10, 11, 12, 14, 16, 17.6, 18, 20, 24, 48 and 60px. text-[9px] and text-[10px] together account for 104 uses, both below the point where a fallback UI face holds its shape on a 96dpi Windows panel. font-bold appears 228 times against font-medium 16 and no font-semibold, so 'bold' is the default and emphasis has nowhere to go. 91 uppercase runs and 110 letterspaced runs mean a section heading, a field label, a table header, a chip, a status pill and a course NAME are all the same typographic object.

- Why it matters: System fix before surface fixes. Half the hierarchy findings below dissolve once the scale exists.

- Change: Adopt the eight-step scale. On this surface the mapping is: page title 20, section 16, card title and active tab 14, body 14, table cell and tree row 13, metadata 12, label 11. Delete 9, 10, 17.6, 18, 48 and 60. The quiz score at text-6xl (Otter.jsx:4893) and the Validator count at text-5xl (Validator.jsx:777) both become 34 display. Two weights only, 400 and 600. Uppercase survives in exactly one role, the 11px Label, and only there does tracking apply.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseFilterChips.jsx:55` — `className={'px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wide border transition-colors ${`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3307` — `{r.resultType && <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase shrink-0 bg-stone-600 text-stone-300">`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4893` — `<div className={'text-6xl font-bold mb-2 ${pct >= 70 ? 'text-green-400' : ...}'}>{pct}%</div>`




**O9 · HIGH · Typography** — Course names are uppercased in the sidebar and sentence case on the card  
law: Law of Similarity

- Problem: The same datum, a user-entered course name, is rendered text-[11px] font-bold uppercase tracking-wider in Sidebar 1 and text-lg font-bold sentence case on the library card. Uppercasing user data destroys its authored casing, so 'Blender' becomes 'BLENDER' and 'After Effects' loses its shape, and at 11px bold with tracking a proper noun reads as a system category rather than as a thing you can open. This is the most Notion-unlike moment in the tool: Notion never uppercases a document title. It is also why the sidebar is hard to scan, because every row has the same rectangular silhouette.

- Change: Sidebar course rows take the 13px Dense step, sentence case, weight 400, weight 600 when active. Drop the uppercase and the tracking. The name then matches the card, the search result and the dialog header, all of which already render it as written.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3598` — `<span className={'text-[11px] font-bold uppercase tracking-wider truncate ${   !openable ? 'text-stone-600' : isActive ? 'text-orange-400' : 'text-stone-400'}'}`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4143` — `<h3 className={'font-bold text-lg leading-tight pr-8 transition-colors mb-2 ${...}'}>{sw.name}</h3>`




**O10 · HIGH · System** — No shortcut bar anywhere, and the one global key is Space  
law: Paradox of the Active User

- Problem: This is Audrey's named example, and O.T.T.E.R. is the worst instance of it. The tool registers a document-level key that opens the search modal, and that key is Space. Space is the universal page-scroll key, so pressing it in a lesson does not scroll, it opens a modal. There is no hint of this anywhere in the interface. Ctrl+\ toggles Sidebar 1 and appears only in a title attribute. The help page that lists shortcuts predates the collapse feature and does not mention Ctrl+\ at all, so the one documented surface is already wrong. Meanwhile R.A.B.B.I.T.'s BinsView carries a permanent 34px bar listing twelve keys with Kbd chips.

- Why it matters: Audrey named this exact gap. It is additive, it changes no behaviour, and it is the clearest possible demonstration that the tools share one visual language.

- Change: Mount a ShortcutBar at 28px with a hairline top, on every O.T.T.E.R. view that registers a document-level key, using the same Kbd component as BinsView promoted to the shared kit. Minimum contents: Space open search, Ctrl+\ hide courses, Esc close. That is a visual addition, not an interaction change: the keys already work. Separately, add Ctrl+\ to otterHelpContent.jsx:364 so the documented list stops being stale.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:2352` — `if (e.key === ' ' && !showSearchModal && !isEditing) {   e.preventDefault();   setShowSearchModal(true);`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\data\otterHelpContent.jsx:364` — `<li>• <span className={T.listBold}>Space</span> — Open search modal (when not typing in an input)</li>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\rabbit_v0.1.0\views\BinsView.jsx:846` — `<span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span><span><Kbd>S</Kbd> select</span>`




**O11 · HIGH · Density** — 146 border-2 rules on a surface whose smallest type is 9px  
law: Law of Prägnanz

- Problem: O.T.T.E.R. uses border-2 in 146 places against 11px and 12px type. A 2px rule is roughly one sixth of the cap height at that size, so every card, table, input, button, panel edge and modal is drawn with a line as heavy as the letterforms inside it. This is the measurable reason the tool reads heavier and older than R.A.B.B.I.T., which uses 1px in 912 places. The tool then compounds it: 27 hard offset shadows at shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] plus four at 8px, an elevation language the project's own spec says does not exist.

- Why it matters: Weight is what 'not sleek' actually means here, and it is a two-token find-and-replace.

- Change: One hairline at 1px everywhere, as a screen of the ink rather than #44403c, so panels stop looking like boxes drawn in grey. Delete all 31 hard offset shadows; the only elevation is one soft shadow on floating surfaces (Dialog, Menu, Toast). The 4px offset shadow currently distinguishes a subject card from a stub card, so replace that distinction with the dashed-versus-solid border it already carries at Otter.jsx:3971.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3970` — `className={'bg-stone-800 border-2 rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] transition-colors group relative flex flex-col h-[200px] ${   sub.is_stub `<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5099` — `<div className="bg-stone-800 border-2 border-stone-600 rounded-sm overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">`




**O12 · HIGH · System** — Twelve button treatments, and the Validator's primary hovers the wrong way  
law: Law of Similarity

- Problem: Counting only what is on this surface: orange-600 with an orange-700 border and a hard shadow; the same without the shadow; orange-600 with NO border and hover:bg-orange-500; orange-700 with an orange-600 border (the fill and border swapped); stone-700 with a 2px border; the same with a 1px border; green-800 with a green-700 border; green-700 alone; red-700 with a red-800 border; red-900/30 with a red-800 border; a bare orange text link; a bare stone text link. Twelve. Worse, they disagree on direction: every orange primary in Otter.jsx darkens on hover to orange-700, while both Validator primaries LIGHTEN to orange-500. Inside one tool, the same button gets brighter or darker under the cursor depending on which pane you are in.

- Change: Four variants and two sizes. primary (signal fill, white, 600, no border, no shadow), secondary (transparent, hairline, ink), ghost (transparent, no rule), danger. sm 28px and md 36px, one padding pair each, sentence case, no tracking. One hover direction: darken. The green 'Approve'/'Accept Fix' buttons become primary, since green as a button fill appears only in these two files and carries no meaning the label does not already give.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx:625` — `: 'bg-orange-600 text-white hover:bg-orange-500'`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3941` — `className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-sm border-2 border-orange-700 hover:bg-orange-700 transition-colors font-bold shad`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\RequestsView.jsx:609` — `className="px-3 py-1.5 bg-orange-700 text-white border border-orange-600 rounded-sm hover:bg-orange-600 text-[10px] font-bold uppercase tracking-wider ..."`




**O13 · HIGH · Build** — O.T.T.E.R.'s scrollbars are styled by a stylesheet that lives inside D.O.G.

- Problem: Otter.jsx applies the class settings-scrollbar in four places: the help modal nav, the help modal body, the settings prompt textareas, and RequestsView's root. That class has no definition in index.css. Its only definition is inside a <style> tag injected by DeckOutlineGenerator.jsx. O.T.T.E.R.'s scrollbars therefore render styled only because App.jsx happens to mount every page at once and D.O.G. happens to be one of them. This is a hidden cross-tool dependency, and a rework session that cleans up D.O.G.'s injected style tag first will silently unstyle four O.T.T.E.R. surfaces with no error and no failing test.

- Why it matters: It is a sequencing trap for the rework itself, so it has to be known before either tool is touched.

- Change: Move both scrollbar definitions into index.css as .wilson-dark-scroll and .wilson-light-scroll, 8px, transparent track, signal-tinted thumb, applied by the shell per page surface. Delete the injected tag and repoint O.T.T.E.R.'s four uses. Do this in the shared-kit session, before either tool's own sweep.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3163` — `<nav className="w-52 flex-shrink-0 bg-stone-900 border-r border-stone-700 overflow-y-auto settings-scrollbar py-2 flex flex-col">`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\deck-outline-generator_v0.514\DeckOutlineGenerator.jsx:3724` — `.settings-scrollbar::-webkit-scrollbar-thumb {`




**O14 · MEDIUM · Flow** — Seven of eight nav labels disagree with the title of the page they open  
law: Mental Model

- Problem: Library opens 'Course Library'. Quiz opens 'Quiz Center'. Hotkeys opens 'Keyboard Shortcuts'. Functions opens 'Functions Reference'. Nodes opens 'Nodes Reference'. Requests opens 'Company library — requests' or 'My change requests' depending on role. Validate opens 'Lesson Validator'. Only Search matches. Every one of those is a small break in the mental model, and the Validate case is the worst because the destination also changes ink and chrome, so nothing on the page confirms you arrived where you clicked.

- Why it matters: Pure copy and type. An hour of work that removes eight small confusions.

- Change: Make the PageHeader title identical to the nav label in all eight cases and move the extra words into the 13px subtitle. 'Hotkeys' with the subtitle 'Keyboard shortcuts for the selected software'. 'Validate' with 'Check lesson content against live sources'. The nav is the name; the header confirms it; the subtitle explains it.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3041` — `<ShieldCheck className="w-4 h-4" /> Validate`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx:600` — `<h2 className="text-base font-bold text-stone-200">Lesson Validator</h2>`




**O15 · MEDIUM · Hierarchy** — The generation queue panel is pinned to a coordinate that stopped being true when the sidebar became collapsible  
law: Law of Common Region

- Problem: The floating queue indicator is positioned fixed bottom-12 left-[440px]. Sidebar 1 is 200px and Sidebar 2 is 220px, so the content edge is at 420px when both are open, 200px when Sidebar 2 is absent (Library, Quiz, Requests, Validator), and 244px when Sidebar 1 is collapsed to its 24px rail. The panel therefore floats 20px inside the content on one view, 240px inside it on another, and 196px inside it whenever the collapse feature is used. It also sits 48px off the bottom of a window whose bottom bar is 8px, so it hovers over content for no structural reason.

- Change: Anchor it to the content region rather than the viewport: position it relative to <main> at bottom 24px, right 24px, or dock it into the ShortcutBar from O10 as a status slot. Either removes the magic number and makes it track the sidebars automatically.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3107` — `<div className="fixed bottom-12 left-[440px] z-30 w-[280px] bg-stone-800 border-2 border-stone-600 rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] overflow-`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3507` — `<aside className="w-[200px] shrink-0 bg-stone-800 border-r-2 border-stone-600 overflow-hidden flex flex-col">`




**O16 · MEDIUM · Flow** — Three visual languages for one progress state  
**constraint: touches-interaction** · law: Doherty Threshold

- Problem: generateSubjectContent is one operation with three different progress presentations depending on where you started it. From the Library card you get the floating queue panel with a spinner, a phase string and a mm:ss timer. From the Study stub screen you get a bar sitting permanently at width 100 percent with animate-pulse, which reads as finished while it is still working. From the Prompt screen you get a bar filled to a hard-coded percentage derived from elapsed seconds, transitioning over 1000ms. Three idioms, one of which actively lies about completion.

- Change: One indeterminate progress treatment for all three, since none of the three actually knows the completion fraction. Keep the phase string and the elapsed timer, which are the only honest signals, and drop the fake percentage at Otter.jsx:4423-4431 and the 100 percent pulse at 4556. Doherty is already satisfied by the phase text updating every second.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4556` — `<div className="h-full bg-orange-500 animate-pulse" style={{ width: '100%', opacity: 0.6 }} />`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4423` — `let pct = 5; if (genElapsed >= 2) pct = 15; if (genElapsed >= 5) pct = 30;`




**O17 · MEDIUM · System** — Eighteen empty states, four icon sizes, three title treatments, three of them italic  
law: Law of Similarity

- Problem: Empty states run from a 28px Trash2 with an 12px line, through a 40px Search with a 14px line, a 48px Braces with a 14px line and no title, up to a 64px BookOpen with a 20px orange title and a button. Three of them are italic at 10 or 11px inside a bordered box (RequestsView) and three carry no icon at all. Loading states are just as varied: a 12px spinner, a 20px spinner, a 32px spinner, and one view with no spinner at all, just the sentence 'Loading hotkeys...'. Empty and loading also look alike in several panes, so 'nothing here' and 'still fetching' are indistinguishable.

- Change: One EmptyState: 24px icon, 14px sentence-case title, 13px body, optional action slot, never italic. One separate Loading with skeleton rows for the list and table panes and a single spinner elsewhere. Apply to Otter.jsx:3536, 3543, 3960, 4078, 4093, 4467, 4734, 5035, 5092, 5203, 4807; Validator.jsx:646, 865, 899; RequestsView.jsx:494, 705, 908; TrashPanel.jsx:88, 159.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5062` — `if (!softwareHotkeys) return <div className="flex items-center justify-center h-full text-stone-500">Loading hotkeys...</div>;`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\RequestsView.jsx:494` — `<p className="text-stone-600 text-[11px] italic bg-stone-900/60 border border-stone-700 rounded-sm p-3">`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4093` — `<BookOpen className="w-16 h-16 text-stone-600 mb-4" /> <h3 className="text-xl font-bold text-orange-400 mb-2">No courses yet</h3>`




**O18 · MEDIUM · System** — Three hand-built tables and two Kbd chips, one of which is a shrunken copy of the other  
law: Law of Similarity

- Problem: The hotkeys table uses a #44403c thead, 12px uppercase th, p-3 cells, a 2px header rule and a 12px kbd. The search modal reimplements the same table forty lines of JSX later at 10px th, p-2 cells, a 1px header rule and a 10px kbd. The lesson markdown table is a third implementation with a #292524 thead in orange text, 2px cell borders and 0.5rem padding. R.A.B.B.I.T.'s binUi.jsx has a fourth Kbd at 9px. So one product renders a keyboard key four ways and a data table three ways.

- Change: One Table with Th, Td and Row: 36px row, 32px head, 8px by 12px cells, hairline dividers, no zebra, one hover fill. One Kbd at the 11px Label step promoted from binUi.jsx:134. Point the hotkeys view, the search preview and the .lesson-content table rules at the same values.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5113` — `<td className="p-3"><kbd className="px-2 py-0.5 rounded-sm text-xs border font-mono" style={{ background: '#1c1917', color: '#fb923c', borderColor: '#57534e' }}`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3362` — `<td className="p-2"><kbd className="px-1.5 py-0.5 rounded-sm text-[10px] border font-mono" style={{ background: '#1c1917', color: '#fb923c', borderColor: '#5753`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:269` — `.lesson-content th { background: #292524; color: #f97316; padding: 0.5rem; border: 2px solid #57534e; text-align: left; }`




**O19 · MEDIUM · Density** — Six or seven filter chips at 9px wrap to four rows inside a 200px column  
**constraint: touches-interaction** · law: Hick's Law

- Problem: filtersFor returns six chips, seven for an admin, rendered at text-[9px] uppercase bold tracking-wide in a flex-wrap strip inside a 200px sidebar. 'Company standard', 'Recently deleted' and "Others' personal" each need most of the 184px usable width, so the strip resolves to four or five rows and eats roughly 100px before the first course appears. On a 900px viewport that is about a sixth of the list column. The source comment at otterSharing.js:45 claims 'five chips at most' as a Hick's Law budget; the array beneath it has six and admins get seven, so the stated budget is already broken.

- Change: Chips move to the 11px Label step, which is legible, and the set reduces to one row by grouping: All, Mine, Shared, Standard, plus an overflow control carrying 'Others personal' and 'Recently deleted'. Every chip stays reachable, nothing changes behaviour, and the sidebar gets about 70px of list back. If Audrey prefers all seven visible, keep them at 11px in a two-row strip and accept the height; that is a taste call, but 9px is not.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\otterSharing.js:45` — `// Hick's/Miller's Law: five chips at most, and the admin-only one is the fifth.`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseFilterChips.jsx:41` — `className="flex flex-wrap gap-1 px-2 py-1.5 border-b-2 border-stone-600 shrink-0"`




**O20 · MEDIUM · System** — PHASE 5 fixed contrast and target size on one control and left its two neighbours at 20px and 2.3:1  
law: Fitts's Law

- Problem: CourseRowMenu.jsx:157-167 documents exactly why text-stone-600 at a 16x16 hit box was wrong and raises it to stone-400 at 24x24 and 30x30. Two of the three hover-revealed controls in the same file tree were never touched. The subject delete button is opacity-0 until hover, then renders a 12px icon in stone-600 inside p-1, which is a 20x20 target at roughly 2.3:1. The card delete button is the same pattern at 22x22. Both are destructive. So the tool now has one measured control and two unmeasured ones doing the same class of job, which is worse than being uniformly wrong because it looks deliberate.

- Change: Apply the HoverActions pattern to both: a reserved fixed-width slot, revealed on hover AND focus-within with a 120ms opacity, icon at the 14px step, ink at 72 percent, minimum 24x24 hit box. Same treatment for every row and list item in the tool, not these two alone.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3663` — `className="opacity-0 group-hover/sub:opacity-100 p-1 mr-1 text-stone-600 hover:text-red-400 transition-all shrink-0"`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3989` — `className="p-1 text-stone-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-sm hover:bg-stone-700"`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseRowMenu.jsx:165` — `className={'shrink-0 rounded-sm text-stone-400 hover:text-orange-400 hover:bg-stone-700 transition-all ${compact ? 'p-1.5' : 'p-2'}'}`




**O21 · MEDIUM · Colour** — Sidebar 2 is painted a one-off hex that exists nowhere else in the app

- Problem: The lesson sidebar, the hotkey-group sidebar and the node-group sidebar all take an inline backgroundColor of #1f1c1a. It is used in exactly these three places and nowhere else in WILSON. It sits between stone-900 (#1c1917) and stone-800 (#292524) and is almost certainly an attempt at a raised panel that nobody could express with the stone ramp. Meanwhile Sidebar 1 next to it is bg-stone-800 and Validator's sidebar is also bg-stone-800, so two adjacent sidebars in the same view are two different colours for no reason the user can infer.

- Change: Both sidebars take the paper-raised token. Delete #1f1c1a. The panel then reads as one surface family and Sidebar 1's edge against Sidebar 2 becomes a hairline instead of a colour step.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3717` — `<aside className="w-[220px] shrink-0 border-r-2 border-stone-600 overflow-y-auto flex flex-col" style={{ backgroundColor: '#1f1c1a' }}>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3770` — `<aside className="w-[220px] shrink-0 border-r-2 border-stone-600 overflow-y-auto flex flex-col" style={{ backgroundColor: '#1f1c1a' }}>`




**O22 · MEDIUM · System** — Eight hairline values inside the two sidebars alone  
law: Law of Uniform Connectedness

- Problem: Within Sidebar 1 and Sidebar 2 the dividers are: border-b-2 border-stone-600, border-b-2 border-stone-700, border-b border-stone-700/60, inline 1px solid rgba(87,83,78,0.3), inline 1px solid rgba(87,83,78,0.2), border-stone-700/40, border-stone-700/50 and border-stone-700/70. Eight weights and opacities describing the same idea, 'these rows are separate'. The result is that some rows look grouped and others look separated with no rule behind which is which.

- Change: One rule token at 14 percent ink on dark, 1px, everywhere. Group separation comes from spacing, not from a heavier or lighter line. That deletes seven values and makes the sidebar read as one list.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3572` — `style={{ borderBottom: '1px solid rgba(87,83,78,0.3)' }}`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3726` — `style={{ borderBottom: '1px solid rgba(87,83,78,0.2)' }}`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\TrashPanel.jsx:105` — `className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-700/40"`




**O23 · MEDIUM · Colour** — NodeTypeBadge puts fifteen cool hues on a surface whose own spec bans cool hues  
**constraint: palette-decision**

- Problem: NODE_TYPE_COLORS defines fifteen values including #60a5fa, #818cf8, #c084fc, #2dd4bf, #22d3ee, #f472b6 and #a3e635. Composition rule 2 of the project's own visual language is 'Warm over cool. No blues, no cyans.' These fifteen are the largest single block of cool colour anywhere in WILSON and they appear in two places: the node cards and the search preview. They are also drawn as 10px uppercase bold tracked chips with a 20-percent fill and a 40-percent border, which is a fourth badge shape on a surface that already has VisibilityBadge, MetadataOnlyBadge and ReadOnlyBadge at a different size.

- Change: Two parts. The badge SHAPE adopts the shared Badge at the 11px Label step with one fill and one hairline, so it stops being a fourth chip. The PALETTE is a separate decision for Audrey: these colours appear to mirror the host application's own socket colours, which would make them data-categorical and legitimate. If they do not mirror anything, reduce to eight generated from one hue rotation plus an 'other' bucket. Do not silently warm them; ask.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:60` — `const NODE_TYPE_COLORS = {   'Float': '#60a5fa', 'Integer': '#818cf8', 'Vector': '#c084fc',   'Color': '#facc15', 'Shader': '#4ade80', 'Geometry': '#2dd4bf',`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:71` — `<span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0"   style={{ background: '${color}20', color, border: `




**O24 · MEDIUM · Colour** — Status is carried by five text colours and five unrelated dot hexes with no shared token

- Problem: RequestsView's STATUS_STYLE maps five statuses to five text classes and five raw hexes: #b45309, #9a3412, #166534, #991b1b, #57534e. None of those is a token used anywhere else in WILSON. Validator's gradeColor does the same job again with a sixth set, including bg-blue-600 for grade B, which is the only blue in O.T.T.E.R. outside the node badges. Two status vocabularies, eleven values, and neither can be changed without hunting the hex.

- Change: One StatusBadge taking a semantic token (open, changes_requested, approved, rejected, withdrawn) and one for grades, both rendering dot, fill and label from the success/danger/warning/neutral four. Grade B stops being blue; A through F is an ordinal scale, so run it success, success, warning, danger, danger with the letter doing the precise work.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\RequestsView.jsx:60` — `const STATUS_STYLE = {   open:              { color: 'text-amber-500',  dot: '#b45309', label: 'Open' },   changes_requested: { color: 'text-orange-400', dot: '`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx:88` — `case 'B': return { bg: 'bg-blue-600', text: 'text-blue-400', border: 'border-blue-500' };`




**O25 · MEDIUM · Typography** — The prompt form has seven labels in two sizes with two different label-to-control gaps  
law: Law of Proximity

- Problem: The generate form carries seven field labels. Six are text-xs, one is text-sm, for no reason visible in the content. Four use mb-1 (4px) and three use mb-2 (8px). The gaps BETWEEN groups are mb-4, mb-5 and mt-4. At the 8px label gap against a 16px group gap the proximity ratio is 2:1, which is too weak to read as a pairing; the app's own AuthShell tokens use 5px against 18px, a 3.6:1 ratio, and cite that ratio as the thing that makes the pairing work. So the form's own house has a measured answer that this screen does not use.

- Change: One Field component: label at the 11px Label step, 4px to its control, 16px between fields, 24px between groups. That is a 4:1 ratio and it matches AuthShell. All seven labels take the same step. Also drop the uppercase and tracking from the labels once the Label role is the only uppercase role, since these are field names, not eyebrows.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4357` — `<label className="block text-sm font-bold text-orange-400 mb-2 uppercase tracking-wide">`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4402` — `<label className="block text-xs font-bold text-orange-400 mb-1 uppercase tracking-wide">Skill Level</label>`




**O26 · MEDIUM · System** — A radio card is hand-built twice at two scales, with the selected state drawn as a text bullet  
law: Law of Similarity

- Problem: The Mode picker, the tier picker and ShareCourseDialog's visibility picker are the same control built three times. Otter.jsx uses font-bold text-sm with a text-xs blurb; ShareCourseDialog uses text-xs font-bold with a text-[10px] blurb. All three draw the selected state by prefixing the label with the character U+25CF or U+25CB inside the same span as the text. That glyph is not a control: it has no focus ring, the filled and hollow forms have different optical weight at the same nominal size so the selected row reads heavier before you read it, and its vertical centring against a 14px bold label is uncontrolled because it is just a character on the baseline.

- Change: One RadioCard: a real 16px indicator at the start of the row, vertically centred against the title's cap height, filled signal when selected, hairline ring when not. Title at 14px weight 600, blurb at 13px weight 400. One scale, used in all three places. Keep the card shape and the click behaviour exactly as they are.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4222` — `<div className="font-bold text-sm">{isCourseMode ? '● ' : '○ '}New Course</div>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ShareCourseDialog.jsx:371` — `<span className={'text-xs font-bold ${active ? 'text-white' : 'text-stone-300'}'}>   {active ? '●' : '○'} {meta.label}`




**O27 · MEDIUM · System** — Eleven hand-rolled overlays, three dialog contracts, nine dialog widths  
**constraint: touches-interaction** · law: Law of Common Region

- Problem: O.T.T.E.R. contains eleven fixed inset-0 overlays with three backdrop values (black/50, black/60, black/70) and three structural contracts. ChangeRequestDialog has a proper header, scrolling body and footer action bar. ShareCourseDialog has a header and a scrolling body but no footer; its actions are scattered inside three separate sections. The five confirm modals are a bare card with a two-button row and no header at all. Widths are 400, 400, 400, 440, 480, 520, 560, 850 and 900px. There is no Escape handling on any of the confirm modals and no focus trap anywhere.

- Change: Promote binUi's Modal as the one Dialog, unchanged in behaviour (modal stack, topmost-only Escape, busy lock, in-footer error, onBeforeClose guard). One backdrop, one surface, one 8px radius, one soft shadow, header/body/footer. Three widths only: 400 confirm, 560 form, 900 workbench. That collapses nine widths to three and gives the five confirm modals an Escape key they do not currently have.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5534` — `<div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">   <div className="bg-stone-800 border-2 border-stone-600 rounded-sm p-6 w-[400`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ShareCourseDialog.jsx:319` — `className="bg-stone-800 border-2 border-stone-600 rounded-sm w-[520px] max-h-[80vh] flex flex-col shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)]"`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3152` — `<div className="relative bg-stone-800 border-2 border-stone-600 rounded-sm shadow-2xl flex flex-col" style={{ width: '850px', height: '82vh' }}>`




**O28 · MEDIUM · Typography** — The search preview uses a <pre> with font-sans to undo itself  
law: Mental Model

- Problem: The lesson preview in the search modal renders as <pre className="text-stone-300 text-xs leading-relaxed whitespace-pre-wrap font-sans">. That is one of only two font-sans uses in the entire application, and it exists solely to cancel the monospace that <pre> brings. The result is 12px prose with no paragraph rhythm, no measure and no heading structure, previewing content that renders at 16px with headings and a 1.7 leading two clicks later. The preview does not look like the thing it previews.

- Change: Render the preview with the same .lesson-content rules, at the same 14px body step and the same 62ch measure, with the match highlight preserved. Replace the <pre> with a plain container; the highlight mapping already walks the string, so nothing about the matching logic changes.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3475` — `<pre className="text-stone-300 text-xs leading-relaxed whitespace-pre-wrap font-sans">`




**O29 · MEDIUM · Motion** — Nothing on this surface respects prefers-reduced-motion

- Problem: index.css guards exactly one animation, .auth-step. O.T.T.E.R. runs 36 animate-spin instances, one animate-pulse, one inline slideInRight at 0.3s on the settings panel, and a 1000ms width transition on the progress bar, none of them guarded. The spinners are the important case: a continuously rotating element is one of the moves that actually causes harm, and there are 36 of them, several of which can be on screen simultaneously during a queued generation run.

- Change: Extend the reduced-motion block in index.css to cover the whole app: animation none on spin and pulse (substitute a static indicator), transition-duration 0.01ms on everything, and deliver the settings panel at its end state instantly rather than sliding. Keep the page transition in App.jsx out of scope per the constraint, but give it a reduced-motion end state too if Audrey agrees separately.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:56` — `@media (prefers-reduced-motion: reduce) {   .auth-step { animation: none; } }`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5284` — `style={{ width: '40%', minWidth: '400px', paddingTop: window.electronAPI ? '32px' : '0px', animation: 'slideInRight 0.3s ease-out' }}`




**O30 · MEDIUM · Density** — Eighteen button padding pairs and eleven icon sizes on one surface

- Problem: The tool uses px-3 py-2, px-3 py-1.5, px-4 py-2, px-1.5 py-0.5, px-4 py-3, px-3 py-1, px-2 py-1, px-2 py-0.5, px-2 py-1.5, px-2.5 py-1.5, px-4 py-2.5, px-6 py-3, px-4 py-1.5, px-3 py-2.5, px-6 py-4, px-6 py-2, px-2.5 py-1 and px-4 py-8. Eighteen. Icons run w-2, w-2.5, w-3, w-3.5, w-4, w-5, w-6, w-7, w-8, w-10, w-12, w-16. Twelve. There is no height system, so no two controls in a row share a baseline unless by accident.

- Change: Two control heights, 28 and 36, with one padding pair each. Three icon sizes: 14 inside dense controls, 16 in rows and buttons, 24 in empty states. That deletes sixteen padding pairs and nine icon sizes and is what makes every toolbar in the tool line up without anyone measuring.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3924` — `className="flex items-center gap-2 bg-stone-700 text-stone-300 border-2 border-stone-600 px-3 py-1.5 rounded-sm hover:bg-stone-600 transition-colors text-sm dis`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4099` — `className="flex items-center gap-2 bg-orange-600 text-white px-6 py-3 rounded-sm border-2 border-orange-700 hover:bg-orange-700 transition-colors font-bold text`




**O38 · MEDIUM · Build** — State is encoded inside template-literal class strings, so a careless class swap silently drops a state

- Problem: This is a build-pass warning for the rework, not a visual defect. Many elements carry two or three states inside one interpolated className, for example the sidebar course label's three-way ternary across not-openable, active and default, and the subject row's three-way across active, stub and default. A rework that replaces the class string wholesale will compile, render and look right in the common case while quietly losing the metadata-only and stub treatments, which only appear for some users and some data.

- Change: Before touching any of these, extract the state to a variant prop on the new component, then map each existing branch to a named variant. Enumerate the branches first: Otter.jsx:3598, 3632, 3970, 3998, 4006, 4221, 4322, 4448, 4630, 4867, 5299 and Validator.jsx:622, 804, 999, 1015 are the multi-branch ones. Verify each variant renders against real data before deleting the ternary.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3632` — `className={'group/sub flex items-center transition-colors border-l-2 ${isSubActive ? 'text-orange-400 font-bold border-orange-500 bg-black/15' : isStub ? 'text-`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4867` — `let cls = 'bg-stone-800 text-stone-300 border-stone-600 hover:border-stone-500'; if (showExplanation) { if (isCorrect) cls = 'bg-green-900/30 ...'; }`




**O31 · LOW · Hierarchy** — Marking a lesson complete turns a button green, a colour used as a button fill nowhere else in the tool  
law: Law of Similarity

- Problem: The Study view's completion toggle is bg-stone-700 when incomplete and bg-green-800 with green-200 text and a green-700 border when complete. Green as a button fill appears in only two other places in the whole tool, both of them ACTIONS (RequestsView's Approve, Validator's Accept Fix), not states. So the same green means 'press this to approve' in one pane and 'this is already done' in another. Meanwhile the correct pattern already exists twenty pixels away in the sidebar, where completion is a filled CheckCircle2 versus an empty ring.

- Change: The toggle keeps one shape and swaps its indicator, not its fill: secondary button, the same CheckCircle2-versus-ring the sidebar uses, label 'Mark complete' / 'Completed'. Green leaves this control, and the only green left in the tool is the success token on toasts and banners.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4630` — `className={'flex items-center gap-2 px-4 py-2 rounded-sm border-2 font-bold text-sm transition-colors ${completedLessons.includes(selectedLesson.id) ? 'bg-green`




**O32 · LOW · Typography** — A lesson h1 and the lesson page title render at exactly the same size and colour

- Problem: The page title is text-2xl font-bold text-orange-400, which is 24px #fb923c. .lesson-content h1 is 1.5rem bold #f97316, also 24px in a near-identical orange. The renderer strips a leading h1 that duplicates the title, but any other h1 inside the markdown renders as a visual twin of the page title in the middle of the page, so the document appears to restart.

- Change: Once the scale lands, the page title is 20px and lesson h1 is also 20px, which is the same problem in a smaller size. Resolve it by demoting the markdown scale one step: h1 to 16px, h2 to 14px weight 600, h3 to 14px weight 600 with a Label eyebrow. The page title stays the only 20px thing on the screen.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4590` — `<h2 className="text-2xl font-bold text-orange-400 mb-1">{selectedLesson.title}</h2>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css:250` — `.lesson-content h1 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.75rem; color: #f97316; }`




**O33 · LOW · Typography** — Copy uses three different separators, including a bare ASCII double hyphen on screen

- Problem: The same separator is written three ways in user-visible strings: a literal ' -- ' (two hyphens) at four sites, a real em dash at others, and the escape — elsewhere. Ellipses are split between three ASCII periods (117 occurrences in Otter.jsx) and the U+2026 character (used throughout the newer components). A double hyphen on screen is the single clearest tell that nobody read the rendered text.

- Change: One separator, one ellipsis, applied across O.T.T.E.R.'s strings. Given Audrey's own no-em-dash preference in prose, use a middle dot or a plain sentence break rather than an em dash, and use U+2026 for every ellipsis. Fix Otter.jsx:3893, 4257, 5032, 5424 first.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4257` — `<p className="text-orange-400/70 text-xs mt-1">Existing course -- new subjects will be added, basics skipped.</p>`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5032` — `<span className="text-stone-500 text-sm">-- Built-in functions, methods &amp; constructs</span>`




**O34 · LOW · Job** — The course header's subtitle describes a hover affordance that PHASE 5 removed  
law: Paradox of the Active User

- Problem: The library header reads 'N subjects -- Click to study, hover to manage or remove'. The row menu is no longer hover-gated (that was the PHASE 5 fix), so 'hover to manage' is wrong for the menu, though still true for the card's delete button. The line is also doing three jobs at once: a count, an instruction and a separator, in a single 14px stone-500 run at 3.6:1.

- Change: Subtitle becomes the count alone at the 13px step, one ink. Drop the instruction; the visible menu and the visible action buttons are the instruction. That also removes one of the four ASCII double hyphens from O33.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3893` — `{activeCanWrite ? ' -- Click to study, hover to manage or remove' : ' -- Click to study'}`




**O35 · LOW · Density** — Five row heights inside a 200px sidebar

- Problem: Sidebar 1 stacks a 24px collapse strip, a roughly 38px New button, a wrapping chip strip of roughly 20px rows, roughly 36px course rows, roughly 26px subject rows, and a roughly 24px 'Add subject' row. Six vertical rhythms in one column, none a multiple of a common unit. The eye cannot establish a beat, which is what makes a long list feel harder to scan than it is.

- Change: Two row heights: 32px for a course row, 28px for a subject row, both on the 4px unit, with the collapse strip and the chip strip taking the 28px panel-header height. The New button becomes a 28px toolbar item rather than a full-width block.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3590` — `className="flex-1 min-w-0 text-left pl-3 pr-1 py-2.5 flex items-center gap-2 disabled:cursor-default"`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3646` — `className="flex-1 text-left py-1.5 pl-6 pr-1 text-[11px] min-w-0"`




**O36 · LOW · System** — The same datum, a subject's order number, is styled two different ways twelve pixels apart

- Problem: In the sidebar the order number is text-xs orange bold followed by a middle dot, inline with the title. On the card it is a text-sm font-bold font-mono chip with an orange-tinted fill and an orange-tinted border. Same number, two sizes, two weights, one of which is mono and one of which is not, one in a container and one not. There is no rule that says when a number gets a chip.

- Change: Numerics get the mono face and tabular figures in both places, because that is the one job mono keeps. The chip goes: in both places the number sits inline at the Caption step, mono, at 48 percent ink, before the title. That also frees the card header row, which currently carries three chips before you reach the subject name.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3649` — `{sub.subject_order != null && <span className="text-orange-500 font-bold text-xs mr-1">{String(sub.subject_order).padStart(2, '0')} ·</span>}`<br>`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3981` — `<span className="bg-orange-600/20 text-orange-400 text-sm font-bold font-mono px-2 py-0.5 rounded-sm border border-orange-600/30">{String(sub.subject_order).pad`




**O37 · LOW · Colour** — O.T.T.E.R.'s own orange bar puts a tinted orange on orange at roughly 2.7:1

- Problem: The tool's subtitle in the shell bar is text-orange-200 on the #ea580c frame. That is neither white nor black and it fails Audrey's own written rule, which exists because a tinted ink on a saturated mid-tone is unreadable. It reads as a mid-grey from a normal viewing distance, and it is the first thing on the page.

- Why it matters: The system review flags this app-wide; recording it here because it is O.T.T.E.R.'s own header and a surface session will otherwise walk past it.

- Change: Subtitle becomes white and drops rank by size instead of by colour: the 13px step at 100 percent white under the 20px title. The same change applies to D.O.G. and R.A.B.B.I.T. at App.jsx:1836 and 1878, so all three tool bars stay identical.

- Evidence: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx:1857` — `<p className="text-orange-200 text-xs tracking-wide">On-demand Training &amp; Technical Education Resource</p>`





## Uniformity gaps

- **Tool view switcher** — here: Otter.jsx:2852-3044 — bg-stone-800 bar, 2px stone-600 bottom rule, items 14px sans sentence case font-medium, active = orange text plus 2px orange underline plus stone-900 fill — elsewhere: Rabbit ViewTabs.jsx:34-66 — #1c1917 bar, 1px #44403c rule, items 11px MONO UPPERCASE tracking-wider, active = solid #ea580c fill with #fff7ed text — do: One Tabs component for both tools. Underline model, not fill, because a content-layer element must not use the frame's #ea580c. 14px sentence case, 400/600, 2px signal underline, 44px strip, 24px gutter.

- **Keyboard shortcut hints** — here: Nowhere. O.T.T.E.R. registers Space (Otter.jsx:2352) and Ctrl+\ (SidebarCollapse.jsx:95) and shows neither. Ctrl+\ is not even in the help page's shortcut list (otterHelpContent.jsx:356-385). — elsewhere: BinsView.jsx:843-847 — a permanent 34px footer bar with twelve Kbd-plus-label pairs and a right-aligned count — do: Promote BinsView's bar and binUi's Kbd to src/ui/ShortcutBar and src/ui/Kbd, mount it on every O.T.T.E.R. view that registers a document-level key, and add Ctrl+\ to the help page. This is Audrey's named example and it is purely additive.

- **Kbd chip** — here: Otter.jsx:5113 at 12px px-2 py-0.5 with #fb923c on #1c1917 inside a #57534e border, and Otter.jsx:3362 at 10px px-1.5 with the same colours — elsewhere: binUi.jsx:134-139 at 9px px-1 with C.muted on C.deep inside a C.line border — do: One Kbd at the 11px Label step, 1px hairline, 4px radius, min-width 18px, centred, ink at 72 percent. Three sizes collapse to one.

- **Scrollbar** — here: Otter.jsx:3163, 3183, 5375 and RequestsView.jsx:403 apply .settings-scrollbar, which has no definition in index.css — elsewhere: Defined inside a style tag injected by DeckOutlineGenerator.jsx:3724. index.css also carries .wilson-light-scroll for the light pages. — do: Two classes in index.css, .wilson-dark-scroll and .wilson-light-scroll, applied by the shell per page surface. Delete the injected tag. Sequence this BEFORE either tool's sweep or O.T.T.E.R. loses its scrollbar styling silently.

- **Page header** — here: Present in 2 of 10 views, at two heights (Quiz px-6 py-3, Validator px-6 py-4) and two title inks (orange-400, stone-200). The other eight views have no header bar and float a text-2xl orange title in the content padding. — elsewhere: Rabbit.jsx:200-203 uses a dedicated ProjectContextBar under the tabs on every view except Summary — do: One PageHeader at 56px with a 24px gutter and a hairline bottom, on every view in both tools, driven by the view registry so a view cannot be added without one.

- **Modal and dialog** — here: Eleven fixed inset-0 overlays in O.T.T.E.R., three backdrops (black/50, black/60, black/70), three structural contracts, nine widths, no Escape on the five confirm modals, no focus trap anywhere — elsewhere: binUi.jsx has a real Modal with a modal stack, topmost-only Escape, busy lock, in-footer error and an onBeforeClose guard, plus overlayOpen() so document-level key handlers stand down — do: Promote binUi's Modal unchanged as src/ui/Dialog and retarget all eleven. That also gives O.T.T.E.R.'s Space-to-search handler a way to stand down while a dialog is open, which it currently does not do.

- **Status colour** — here: RequestsView.jsx:60-66 (five text classes, five raw hexes) and Validator.jsx:85-94 (five more, including the tool's only bg-blue-600) — elsewhere: No shared status token exists anywhere in WILSON — do: One StatusBadge taking a semantic token, rendering dot, fill and label from the four functional values. Grade B stops being blue.

- **Border weight** — here: border-2 appears 146 times in O.T.T.E.R., against 11px and 12px type — elsewhere: R.A.B.B.I.T. uses 1px in 912 places and reads visibly lighter for it — do: One hairline at 1px everywhere, as a screen of the ink rather than a grey hex. Delete border-2 from this surface entirely.

- **Elevation** — here: 27 instances of shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] plus 4 at 8px, on cards, tables, buttons and modals — elsewhere: The project's own visual-language.md says 'WILSON does NOT use heavy drop shadows. Surfaces stack via solid borders, not elevation.' — do: One soft shadow, floating surfaces only. Docked surfaces get a hairline and nothing else. Delete all 31.

- **Uppercase and tracking** — here: 91 uppercase runs and 110 tracked runs, including course NAMES (Otter.jsx:3598), section headings, field labels, table headers, chips and status pills — elsewhere: R.A.B.B.I.T. does the same thing in ViewTabs; Notion and Obsidian reserve uppercase for a single label role and never apply it to user data — do: Uppercase survives in exactly two roles app-wide: the transition Display and the 11px Label. Both carry positive tracking. Everything else is sentence case at zero tracking. That alone removes about 170 of the 201 runs on this surface.


## Alignment issues

- Study view content block (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4581`): The lesson pane is `p-6 max-w-4xl` with NO mx-auto, so it is left-aligned. Its own stub state one branch above IS centred (4519, `max-w-4xl mx-auto`), and so is every other view in the tool. Generating a stub therefore makes the content JUMP from centred to left-aligned in the same pane. On a wide window the lesson column sits hard against the sidebar with several hundred pixels of empty space to its right. → Pick one and apply it to both branches. Left-aligned is the better answer for a reading column next to two sidebars, so make the stub branch left-aligned too, and give both a 720px reading container so the measure is fixed rather than viewport-dependent.

- Generation queue indicator (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3107`): `fixed bottom-12 left-[440px]` is a magic number. The content edge is 420px with both sidebars open, 200px when Sidebar 2 is absent, and 244px when Sidebar 1 is collapsed. The panel is therefore 20px, 240px or 196px inside the content depending on state, and 48px off a window whose bottom bar is 8px. → Anchor to the content region at bottom 24px right 24px, or dock it into the ShortcutBar as a status slot. Remove the literal.

- Library header action cluster (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3898`): Four controls sit in one `flex items-center gap-3` row at three different heights: CourseRowMenu at p-2 (30px), Generate All Outlines and Import at py-1.5 with 16px icons (about 30px), and Add Subject at py-2 with a 20px icon (about 38px). The primary is 8px taller than its neighbours, so the row has no shared baseline and the icons sit at three different y positions. → Toolbar contract: every child 28px except the one primary at 36px, vertically centred, 16px icons throughout. Or make all four 28px and let colour carry the primary.

- Sidebar 1 subject rows versus the Add subject row (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3676`): Subject rows are a `border-l-2` container with a `pl-6` button, so their text starts at 26px. The Add subject row and the Read only note use an inline paddingLeft of 24px with no left border, so their text starts at 24px. A 2px stair-step at the bottom of every expanded course. → Give the Add subject row and the note the same 2px transparent left border, or move the border to an inset box-shadow so it does not consume layout width. Then all three left edges land on 24px.

- Library card text block (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:4143`): The card title carries `pr-8` to clear the absolutely-positioned row menu, but the badge row at 4147 and the meta rows at 4154 and 4155 carry no right padding. The card's text block therefore has two right edges, 32px apart, and a long badge run can slide under the menu trigger. → Move the padding to the card's content wrapper so every child shares one right edge, or reserve the menu slot in flow with a header row instead of absolute positioning.

- The three reference views share a pattern with three different rhythms (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:5083`): Hotkeys, Functions and Nodes are the same view three times: title row, then a software select row, then content. Hotkeys and Functions use mb-6 on the select row; Nodes uses mb-4 and then inserts a system tab strip the other two do not have. Functions caps at max-w-5xl, Hotkeys at max-w-4xl, Nodes at max-w-5xl. Three measures and two rhythms for one pattern. → One Toolbar at 44px carrying the select and the search field, one measure for all three (the data-page 1240px cap), and the Nodes tab strip becomes the shared Tabs sitting directly under the PageHeader so its position is predictable.

- The two sidebars do not start their lists at the same y (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3508`): Sidebar 1 stacks a 24px collapse strip, a roughly 38px New button and a wrapping chip strip before its first row, so the list begins at roughly 90 to 130px. Sidebar 2 has a single `p-3 border-b-2` header, so its list begins at roughly 62px. Two adjacent columns of the same kind of content, two different starting lines. → One 32px panel header on both, at the Label step, with the collapse control and the count in it. The New button moves into that header as a 24px icon action or into the Library toolbar.

- Nav bar grouping is an empty spacer div (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3031`): Nine nav items are separated by exactly one 1px rule (after Edit, at 2907) and one empty `<div className="ml-auto" />` before Validate. There is no grouping device between Library, Quiz, Hotkeys, Nodes, Functions and Requests, so six unrelated destinations read as one undifferentiated run. → Use `ml-auto` on the Validate button itself and add hairline separators between the three groups: make (Edit, Search), browse (Library, Quiz), reference (Hotkeys, Nodes, Functions), review (Requests, Validate). No control moves and nothing changes behaviour.

- Table numerics and counts have no tabular figures (`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx:3729`): Sidebar category counts, subject counts, match counts, the `{days}d left` countdown, the accuracy percentage and the quiz score are all set in the proportional UI face with no font-variant-numeric. Right-aligned counts in the sidebar therefore shift by a pixel or two as the number changes, and the Validator's percentage column does not line up between rows. → All numerics take the mono face with tabular-nums, which is the one job the mono keeps under the proposed system. Right-align every numeric column.


## Hick's Law hotspots

- Top nav bar (Otter.jsx:2852-3043): 9 visible choices → Nine top-level destinations at the Miller ceiling, and three of them (Hotkeys, Nodes, Functions) are the same class of thing: reference material for the active course. Hotkeys and Functions are in fact two doors into one room, since both set currentView to 'hotkeys' and differ only by a type check on the active course. The safe fix that changes no behaviour: add hairline separators to group them into make (Edit, Search), browse (Library, Quiz), reference (Hotkeys, Nodes, Functions) and review (Requests, Validate). Four groups of two or three reads as four choices, not nine. Merging Hotkeys and Functions into a single 'Reference' item would be better still but it is a flow change, so record it and let Audrey decide.

- Sidebar 1 filter chips (CourseFilterChips.jsx:45-67): 7 visible choices → Six chips, seven for an admin, at 9px, wrapping to four or five rows and consuming roughly 100px of a 200px column. Keep four in one row at the 11px Label step (All, Mine, Shared, Standard) and move 'Others personal' and 'Recently deleted' behind one overflow control at the end of the row. Both stay one click away, the strip drops to a single 28px row, and the list gets about 70px back. If she wants all seven visible, 11px in two rows is the compromise; 9px is not a legitimate option either way.

- Prompt / Generate screen (Otter.jsx:4203-4456): 12 visible choices → Seven labelled groups and twelve controls on one screen, every label rendered at the identical 12px orange uppercase weight so nothing indicates what must be filled in versus what is optional. Four of the seven are already marked optional in their own copy. Group them visually: required (Mode, Name, Who is this for) above a hairline; optional (Description, Reference URLs, Skill level) below it under one 11px 'Optional' eyebrow. Nothing is hidden, nothing moves, and the required set drops to three visible decisions.

- Library header with a course selected (Otter.jsx:3898-3956): 8 visible choices → Up to four header controls plus a row menu carrying one to four items, plus two controls on every card. The three header buttons that are not the primary (row menu, Generate All Outlines, Import) are all management actions; fold Generate All Outlines and Import into the existing row menu, which already holds Share, Suggest, Copy and Trash. The header then reads as one primary plus one menu, which is the Notion shape, and every control stays reachable in one click.

- Quiz Center selection (Otter.jsx:4741-4811): 55 visible choices → One checkbox per course plus one per non-stub subject, all expanded by default (quizExpanded defaults to true). Against Audrey's real library of six courses and 49 subjects that is roughly 55 checkboxes plus six chevrons plus three type chips on one scroll. Default the subject lists COLLAPSED with the course-level checkbox and count visible, so the first screen is six choices. Expanding is already implemented at 4771 and the state already persists, so this is a default change, not a new mechanism.

- Settings slide-out, prompts tab (Otter.jsx:5349-5386): 16 visible choices → Seven accordions each carrying a Reset and a Save link, plus the lock toggle, plus two tabs. The Save and Reset links are 10px text links at the bottom of each textarea, so the same action exists seven times in seven places and none of them looks like a button. One Save in the panel footer, applying whichever section is open, plus a Reset inside each section. That drops fourteen controls to eight and gives Save a single, findable home.

- Requests view (RequestsView.jsx:489-1040): 5 visible choices → Up to five stacked sections (For your review, Open requests, Put forward as company standard, My requests, Decided) each with its own list, and an expanded row carries two to four further actions plus a textarea. The section headers are all the same 11px orange uppercase, so the page reads as one long undifferentiated stack. Give each section a real SectionTitle at the 16px step with a hairline above, and collapse Decided by default (it already has a toggle at 1013). The page then has three visible sections on first load instead of five.

- Validator setup, targeted mode (Validator.jsx:654-771): 4 visible choices → A four-level checkbox tree (software, subject, section, lesson) where every level has its own checkbox, its own chevron, its own indent (pl-8, pl-14, pl-20) and its own type size and weight. The indent steps are 8px, 24px, 24px and 24px, which is irregular, and the checkboxes are w-4, w-3.5, w-3.5, w-3.5, which is nearly but not quite uniform. Four levels is the right depth; make the indent a constant 16px per level and all four checkboxes 16px so the tree reads as one structure rather than four stacked lists.


## Type inventory

| px | Where it comes from | Roles it currently plays on this surface | Should become |
|---|---|---|---|
| 9 | `text-[9px]` x3 | filter chips (CourseFilterChips:55), search result type tag (Otter:3307) | deleted; both go to the 11px Label |
| 10 | `text-[10px]` x101 | field hints, all four badges, node input/output labels, tier blurbs, RequestsView action buttons, sidebar counts, trash countdown, settings footer, "Add subject", "Read only" note | split: Label 11 for badges and buttons, Caption 12 for hints and counts |
| 11 | `text-[11px]` x83 | sidebar course names, sidebar lesson rows, help modal nav, dialog body copy, menu items, RequestsView meta lines | Dense 13 for rows and body, Label 11 for menu items |
| 12 | `text-xs` + `text-[12px]` x137 | the de-facto body: breadcrumbs, card meta, table headers, field labels, blurbs, quiz meta, RequestsView summaries | Body 14 for prose, Dense 13 for rows, Caption 12 for metadata, Label 11 for headers |
| 14 | `text-sm` x142 | nav items, all buttons, card descriptions, quiz options, table cells, selects, section headings, Validator body | Body 14 (keeps its place) and Dense 13 for table cells |
| 16 | `text-base` x3 + inherited `.lesson-content p` | subject card titles; ALL lesson paragraphs and list items | H2 16 for card titles; Body 14 for lesson prose |
| 17.6 | `.lesson-content h3` | lesson subsection heading, and the brightest text on the page | H3 14 weight 600 |
| 18 | `text-lg` x16 | modal titles, Requests title, quiz question, Validator detail title, the Generate button label | H2 16 |
| 20 | `text-xl` x5 + `.lesson-content h2` | empty-state titles, lesson section heading | H2 16 |
| 24 | `text-2xl` x11 + `.lesson-content h1` | seven page titles, Validator grade badge, lesson top heading | H1 20 |
| 48 | `text-5xl` x1 | Validator full-scope lesson count | Display 34 |
| 60 | `text-6xl` x1 | quiz score percentage | Display 34 |

**Cases:** 91 `uppercase` runs. **Tracking:** 84 `tracking-wide` + 26 `tracking-wider` = 110 runs. **Weights:** `font-bold` x228, `font-medium` x16, `font-semibold` x0. So 700 is effectively the default weight and there is no 600 anywhere; "bold" has no contrast partner, which is why everything reads at one volume. Target: 12 sizes to 8, 201 uppercase-plus-tracked runs to the ~30 that are genuinely Label role, and 2 weights (400 and 600) with 700 deleted.


## Priority order

O8, O6, O7, O4, O5, O11, O1, O3, O12, O10, O2, O13, O14, O17, O18, O27, O30, O22, O21, O15, O20, O25, O26, O9, O16, O19, O24, O28, O29, O23, O35, O36, O32, O31, O33, O34, O37, O38


## Rework scope (reviewer's estimate)

Files: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Otter.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\Validator.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\RequestsView.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ShareCourseDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\ChangeRequestDialog.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\TrashPanel.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseRowMenu.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseBadges.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\CourseFilterChips.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\tools\otter_v0.3.1\components\SidebarCollapse.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\index.css`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\data\otterHelpContent.jsx`, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\ui-review\WILSON\src\App.jsx`  
Approx lines: 2600  
Suggested sessions: 4  
Split: S1 — SHELL AND REFERENCE VIEWS (~900 lines, Otter.jsx only). Adopt the shared kit for the nav bar (2852-3044), both sidebars (3499-3830), the Library (3862-4187), and the three reference views (4995-5273). Lands O1, O3, O6, O7, O8, O9, O11, O12, O14, O15, O18, O21, O22, O30, O35, O36 and the alignment items in the sidebars and the library header. Do it first because it is the most-seen chrome and because the nav bar is where the cross-tool Tabs component gets proved.\n\nS2 — THE READING SURFACE (~400 lines, plus the .lesson-content block in index.css:247-271). The study view (4512-4650), sources (4465-4507), the search modal preview (3254-3494), and the lesson markdown rules. Lands O4, O5, O28, O32 and the study-view centring bug. This is the smallest session and the highest user value per line; it could reasonably run first if she wants to feel the difference immediately.\n\nS3 — DIALOGS AND SHARING (~800 lines, the six component files plus the five confirm modals at Otter.jsx:5454-5566). Lands O17, O19, O20, O23, O24, O26, O27, O29, O37. Depends on S1 for the Dialog, Button, Badge and Input primitives.\n\nS4 — WORKBENCHES (~900 lines, Validator.jsx, RequestsView.jsx, the Quiz Center at 4655-4990 and the settings slide-out at 5278-5447). Lands O3's remaining two views, O12's Validator hover inversion, O16, O17's remaining states, O24's grade colours, and the Validator tree indent. Last because these three are the least-visited panes and they consume the most primitives.\n\nA prerequisite belongs to whoever runs first, not to O.T.T.E.R.: move the scrollbar CSS out of D.O.G. (O13). If D.O.G.'s session runs first and deletes the injected tag, four O.T.T.E.R. surfaces lose their scrollbar styling with no error.  
Risks: 1. Otter.jsx is 5,566 lines and its render functions are declared AFTER the component's return statement, hoisted (see the comment at 3249). A top-to-bottom edit therefore meets the JSX out of narrative order and the diffs are close to unreviewable. Work render function by render function, named, and commit per function.\n\n2. State is encoded inside interpolated className template literals, several of them three-way (Otter.jsx:3598, 3632, 3970, 4867, Validator.jsx:999, 1015). Swapping the string wholesale compiles, renders and looks correct for the common case while silently dropping the metadata-only, stub, read-only and unverifiable treatments, which only appear for some users and some data. Enumerate every branch into a named variant before deleting a ternary.\n\n3. Thirty raw hex values live in inline style props that Tailwind class sweeps cannot see (#1f1c1a, the fifteen NODE_TYPE_COLORS, the five RequestsView status dots, the kbd trio, the syntax-highlighter customStyle borders). Sweep classes and inline styles together or the tool will end up half-migrated with no visible signal.\n\n4. Three test files sit in this directory: courseBadges.test.js (77), otterSharing.test.js (190) and shareDiscoverability.test.js (504). The last one is a discoverability test and is the most likely to assert on rendered labels, roles and visibility. Read it before renaming any menu item, badge label or aria-label.\n\n5. `settings-scrollbar` is defined only inside D.O.G. (O13). Sequence matters between the two tool sessions.\n\n6. The sidebar widths are coupled to a hardcoded coordinate: w-[200px], w-[220px] and left-[440px]. Changing any panel width without fixing the floating queue's anchor moves the panel onto a random x.\n\n7. O.T.T.E.R. stays MOUNTED under display:none on every other page (App.jsx renders all pages at once). Both of its document-level key listeners are gated on `currentPage === 'otter'` for exactly that reason, and the comments at 2342 and SidebarCollapse.jsx:71 record the bugs that gating fixed. A ShortcutBar must not register a second, ungated listener.\n\n8. NODE_TYPE_COLORS may mirror the host application's own socket colours, which would make the palette data rather than decoration. It is flagged palette-decision; do not warm it without asking.\n\n9. PetCompanion renders over this surface and is untouchable, as is the page transition. The settings panel's `paddingTop: window.electronAPI ? '32px' : '0px'` clears the custom TitleBar and must survive any rewrite of that panel.\n\n10. Three of the findings carry constraint_risk: O16 (dropping the fake progress percentage), O19 (grouping filter chips behind an overflow) and O27 (promoting binUi's Modal, which brings Escape handling the five confirm modals do not currently have). Each is a behaviour change, each is recorded rather than assumed, and each needs Audrey's yes before the session that touches it.
