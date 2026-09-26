# Appendix to ui-b5-2026-09-26.md — the delegation spec for B5b (Scenes)

B5 did the Budget by delegating each file (or each part of BudgetView) to ONE
subagent at a time (`model: "opus"`), with a shared spec and a short
per-surface prompt, then walked, counted, fixed and committed itself. §A is
that spec re-pointed at Scenes; §B is the prompt for B5b's first surface,
ready to run. B4b's appendix (`ui-b4b-2026-09-25-agent-brief.md`) is the
ancestor; B4c's correction stands (the kit primary Button draws WHITE on
`#c2410c` at 5.17:1).

Three lessons from running it on the Budget:
- Say "sentence case" in every brief that touches words.
- Read the files a subagent edits through the shell (`sed -n`, `grep`), never
  the Read tool; and once a file is in your context, edit it with the Edit
  tool, never a shell script — a shell edit makes the harness re-send the
  whole file (B4c trap 10, hit twice here on a 3,000-line file).
- A 3,000-line file does not fit one subagent. BudgetView went in three
  (2a Summary and reports, 2b Expenses, 3 the shell), with the guard reading
  the file through a `staged` list — the top-level functions not yet
  restyled, taken out by `withoutFunctions` in `rabbitBudgetCss.test.js`
  (with its CONTROLs). ScenesView needs the same.

---

## §A — the shared spec (Scenes)

Repo app root (run every command from here): `<your worktree>/WILSON`.
The controller names the branch; a Vite dev server for the worktree runs on
its own port (do not start or stop servers). Do NOT commit, push, stash or
switch branches: the controller commits. Do not touch `.env.local` or
`.claude/launch.json`.

### What this is
A RESTYLE onto the shared component kit (`src/ui/`), not a redesign. Copy the
lanes before you:
- B5 (lane classes `rb-budget-`, `rb-crew-`, `rb-talent-`, `rb-client-`,
  `rb-pop-`): `views/BudgetView.jsx`, `views/budget/*`, the sheet
  `views/rabbitBudget.css` (read its header and the Expenses section: a
  toolbar, a table with a bulk bar, hover actions, a checkbox with a 28px
  target, the lane popover), the guard `views/rabbitBudgetCss.test.js`, the
  mounted `views/rabbitBudgetRender.test.jsx`.
- B4c (`rb-ent-`): `views/EntityListView.jsx` — the Level / Experience popup
  on the kit Dialog with its task-form column: THE pattern for the scene
  popup (B4c-KR-1, a side-panel slot, does not exist yet).
- B2 (`rb-task-`): `views/ProjectTasksView.jsx` + `rabbitTasks.css` (the
  toolbar, the saved-views menu, StatusDot + CellSelect status cells).
- B6 (`bn-`): Scenes renders four Bins components — `ShotTakeChips`,
  `ShotTakesPanel` / `ShotTakesDialog`, `TakePickerDialog`, `BinPoster`.
  Read `ui-b6-2026-09-23.md` §3's binUi → kit mapping (every contract
  difference a caller notices) before touching a call site.
Open ScenesView BY RANGE (`sed -n 'a,bp'`), never whole: it is 3,356 lines.

### The kit
Table/Th/Td/Row (real `<table>`, `table-layout: fixed`, `head`, `foot`,
`dense` 32px rows else 36, Th `width` / `numeric` / `sort`+`onSort`, Td
`numeric`, Row `selected` / `highlighted` / `interactive` / `inactive`),
Toolbar, Tabs (`items`, `value`, `onChange`, `label`, REQUIRED `panelId`; no
icon slot — an icon rides in the label as ViewTabs' and the Budget strip's
do), Button (`variant`, `size`, `Icon`), IconButton (`Icon`, `title` = its
name), Dialog (`title`, `subtitle`, `footer`, `onClose`, `width` confirm 400
| form 560 | reading 720 | workbench 960 | a number, `dismissOnBackdrop`,
`onBeforeClose`, `busy`, `error`; it does NOT portal), CellSelect (a
borderless in-cell select; `aria-label`), Stat (`label`, `value`,
`valueTone`, `delta`), StatusDot / StatusBadge (the one `STATUS` map),
EmptyState, Loading, Badge, Chip, Banner, HoverActions, Field, Menu,
SectionTitle, Switch. Native fields: `className="ui-input"` +
`data-size="sm"` (the kit Input's Escape/Enter would break drafts, B3d trap
3). Tokens: `--text-h1` 20, `--text-h2` 16, `--text-h3` 14, `--text-body`
14, `--text-dense` 13, `--text-caption` 12, `--text-label` 11; inks
`--color-ink` / `-ink-2` / `-ink-3`; grounds `--color-paper`,
`-paper-raised`, `-paper-recessed`; `--color-rule`, `--color-hover`,
`--color-signal` (the one active treatment), `-signal-fill`,
`-signal-tint`, `--color-success|warning|danger`; `--control-sm` 28,
`--control-md` 36; `--radius-control`, `--radius-float`; `--icon-sm` 14;
`--spacing-gutter` 24; `--font-mono`. Every custom property you read must
exist (grep index.css).

### Constraints that do not bend
- C1 NO INTERACTION OR VIEW CHANGES: the same views, flows and controls, in
  the same order, the same clicks and keys, except what the kit Dialog adds
  (Escape, the focus trap — Q17) and the kit Tabs add (arrow keys). R3-25's
  sixteen-control toolbar is RESTYLED, NOT RESTRUCTURED: the two size
  triples stay two triples, the FPS badge stays where it is (recorded for
  Audrey). R3-15's twice-registered undo keys stay; Q10 forbids a shortcut
  bar. Keep every accessible name the walk and tests use (the walk's
  Scenes screens: "View details", "Gallery", "Shots", `[title="md
  cards"]`, "The door", "Lighthouse, dawn").
- `ShotTakeChips` keeps its `height` prop and every pixel height ScenesView
  passes (`Math.min(nestedThumbH, 22)`, `Math.min(rowH, 26)`, `20`) — no
  size token was added (B6 §4).
- C6 on orange: `#1c1917`, or white at 19px bold and up; a filled primary is
  the kit primary (white on `#c2410c`, 5.17:1). C7 one scale, 11px floor.
  C8 nothing hand-rolled the kit has. C9 no white surface. Q2 sentence case
  outside the Label step ("New Scene" -> "New scene", "Total Runtime" ->
  "Total runtime", "Time of Day" -> "Time of day"). W9 every
  `window.confirm` (three in ScenesView) and the hand-rolled `ConfirmDialog`
  become the kit Dialog `width="confirm"`, portalled.

### The guards
Rules go in `views/rabbitScenes.css` (create it on the Budget sheet's
pattern: the header, the `@layer` statement FIRST, one `@layer components`
block, the reduced-motion block LAST). It joins `CSS_FILES` in
`scripts/ui-audit.mjs` and `typeScale.test.js`'s count (13 -> 14) in the
commit that creates it, scoring 0 on every row. `views/rabbitScenesCss.test.js`
is a copy of `rabbitBudgetCss.test.js` pointed at it: LANE `scene`, the
file `../views/ScenesView.jsx` with prefix `rb-scene-` and a `staged` list
(every top-level function not yet restyled, shortened each surface). Every
className a literal (or a template whose only hole is `${className}`); state
on `data-*` keyed by plain `[data-x="v"]` selectors; no inline style except
a listed geometry (`STYLES`); no spread, no palette utility, no hex, no
colour prop with an expression; a rule over a kit rule written one class
heavier; every transition's twin in the reduced-motion block. Mounted tests
go in `views/rabbitScenesRender.test.jsx`. Run the guard and the counter
(`b4-count.mjs`, in ui-b4-2026-09-25.md §7, with ScenesView in `FILES`),
then `npx vitest run src/tools/rabbit_v0.1.0 src/ui src/dev src/components`.

### Traps already paid for
- 🚨 R3-26: THIRTY-TWO `e.target.style.borderColor = …` hover mutations. An
  inline style beats any CSS rule, so a CSS hover does NOTHING until every
  one is gone: remove them in ONE pass, not piecemeal, and let the kit
  CellSelect / `ui-input` rules draw rest, hover and focus.
- The scene popup CENTRES WITH FLEX (B4c round one measured it; not
  `transform`), hosts FileManager, RelationsPanel and NewTaskSidePopup, and
  its create question is already portalled. On the kit Dialog: portal every
  nested kit Dialog with `createPortal(…, document.body)`; RelationsPanel's
  `markOwnEscape` already covers its in-panel picker and task form; the
  third ink FAILS on the legacy `#292524` (4.37:1) and passes on the
  Dialog's raised paper (4.66).
- The task popup opened from a scene popup stacks over it (B2 §4): prove
  one Escape closes only the top one.
- StrictMode's double mount (B4c trap 6; B5 trap 1): a `mountedRef` set only
  by `useRef(true)` goes false for ever in dev. If a Scenes loader never
  finishes in the walk, look there first.
- A walk screen whose overlay has no `role="dialog"` measures the host
  (B4c trap 3): today the scene and shot popups are proven by the walk's
  fixed-backdrop detection; on the kit Dialog they have the role.

### Report back (under 350 words)
What changed per component (one line each), every lane class family added,
each finding applied or RECORDED (with the C1 reason), the exact test and
counter lines, any existing test you had to update and why.

---

## §B — the surface-6a prompt (ready to run)

You are lane B5b's surface 6a in the WILSON UI overhaul: the Scenes page's
tiles, toolbar and two TABLES in `src/tools/rabbit_v0.1.0/views/ScenesView.jsx`
— `BigTile` and the four tiles (~726-731), the toolbar (~734-936),
`SceneTable` (~1183-1642) and `ShotTable` (~1728-2123), with the helpers
they call (`statusColor`, `fmt`, `fmtNumber`, `InlineText`, `SceneBulkSelect`,
`FieldLabel` only where the tables use them) — onto the shared kit and the
new lane sheet `views/rabbitScenes.css`. First read §A of
`docs/sessions/handoffs/ui-b5-2026-09-26-agent-brief.md` in full. Lane
classes: `rb-scene-`. Say "sentence case" to yourself at every string.

READ FIRST: `docs/design/review/r-a-b-b-i-t-part-3.md` R3-07, R3-10, R3-11,
R3-13, R3-18, R3-19, R3-20, R3-22, R3-24, R3-25 (record), R3-26, R3-29,
R3-31, R3-38, R3-40 (Problem / Change only; line numbers have moved), the
"Shot row in ShotTable" Hick's entry (C1: record), and B6's §3 mapping for
`ShotTakeChips` and `BinPoster`.

DO:
1. CREATE `views/rabbitScenes.css`, `views/rabbitScenesCss.test.js` (a copy
   of `rabbitBudgetCss.test.js`: LANE `scene`, FILES `{ scenes: { file:
   './ScenesView.jsx', prefix: 'rb-scene-', min: 3000, staged: [...every
   top-level function outside your scope] } }`) and
   `views/rabbitScenesRender.test.jsx`; add the sheet to `CSS_FILES` and bump
   `typeScale.test.js` to 14. `import './rabbitScenes.css'` in ScenesView.
2. R3-26 FIRST: delete all thirty-two `e.target.style` mutations (the two
   popups' too — they sit outside your scope, so move ONLY those handlers,
   nothing else there, and say so). Each inline select or number field in a
   row is the kit `CellSelect` (a select) or a native `ui-input`
   `data-size="sm"` with a lane class (a number or text field), so rest,
   hover and focus come from CSS: legible as editable at rest, exactly the
   same clicks. Zero `onMouseEnter` / `onMouseLeave` style writers left in
   the file (a test greps for them).
3. The tiles: the kit `Stat` (as the Budget's `.ui-stat.rb-budget-stat`;
   copy its look into `rb-scene-` — the lanes cannot share a class across
   sheets), icons at 14px or dropped if Stat has no slot (say which).
4. The toolbar on the kit Toolbar, the same sixteen controls in the same
   order (C1): the content-mode and view-mode pairs as the kit Tabs (the one
   active treatment, R3-18 — they are two-choice segmented tabs; `panelId`
   the region they switch), the size triples as kit IconButtons in a
   bordered group with the kit's selected treatment (no orange fill), sort
   / group native `ui-input` selects, Filter / Views kit Buttons, search a
   native `ui-input`, "New scene" / "New shot" kit Buttons (primary), the
   FPS badge restyled where it is. Record R3-25.
5. Both tables onto the kit `Table` (R3-20) with the same columns in the
   same order; the scene table's nested shot rows stay nested (expand /
   collapse exactly as now); numerics (runtime, frames, counts) `numeric`;
   status through the kit `StatusDot` + `CellSelect` and the STATUS map
   (R3-11: the magenta `needs_revisions` goes to the kit's warning);
   selection the kit Row `selected` (R3-38); row actions in the kit
   `HoverActions` (hover and focus-within, Q17(b)) in one slot width
   (R3-24); every checkbox a 28px square target (R3-40); zero values and
   placeholders at the third ink at least (R3-13: `#44403c` as text goes);
   the empty states the kit `EmptyState` (R3-19). `ShotTakeChips` and
   `BinPoster` keep every size ScenesView passes them; a colour or border
   they take through `style` today moves to a lane class if their contract
   allows (else record it).
6. The three `window.confirm`s (bulk delete of shots and scenes) and
   `ConfirmDialog` become kit Dialogs `width="confirm"`, portalled (W9), the
   same words in sentence case; a mounted test proves Cancel keeps the rows
   and the action deletes through the mocked context.
7. Mounted tests (`describe('surface 6a')`): each table a real <table>
   whose header reads the same columns in the same order; a row's status is
   a kit StatusDot + CellSelect; no element in the mounted tables writes an
   inline colour or border; no `onMouseEnter` / `onMouseLeave` in the file;
   the toolbar's sixteen controls in their order.

End state: `npx vitest run src/tools/rabbit_v0.1.0 src/ui src/dev src/components`
green; the counter's ScenesView row has hex / palette / styles / ternaries
only inside the staged functions (prove it: counts inside vs outside);
`rabbitScenes.css` 0 on every `ui-audit.mjs --css` row. Report as §A says;
list what looks different enough for Audrey to see, and every finding
RECORDED rather than applied.
