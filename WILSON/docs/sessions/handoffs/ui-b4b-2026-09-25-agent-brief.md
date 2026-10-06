# Appendix to ui-b4b-2026-09-25.md — the brief B4b's subagents worked from

B4b did surfaces 3 and 4 by delegating each file to a subagent (`model: "opus"`,
one at a time, never two on one file) with §A as the shared spec and a short
per-surface prompt, then walked, counted, fixed and committed itself. The
controller's context stayed near the protocol's trigger instead of past it:
ProjectAssetsView alone is 106 KB. §A is reusable as it stands; §B is the
prompt written for surface 5 and not yet run (B4c's first surface).

Two lessons from running it: say "sentence case" wherever a brief says "keep
the titles" (a subagent kept "Link Scenes" because §4's prompt said keep its
title strings); and read the files subagents edit — the sheet, the guard test,
the walk — through the shell, not the Read tool, or the harness re-sends
them to you whole after every change.

---

## §A — the shared spec


Repo app root (run every command from here): `<your worktree>/WILSON`
The controller names the branch; a Vite dev server for the worktree runs on its own port (do not start or stop servers). Do NOT commit, push, stash or switch branches: the controller commits. Do not touch `.env.local` or `.claude/launch.json`.

## What this is
A RESTYLE onto the shared component kit (`src/ui/`), not a redesign. Earlier sessions did the same to neighbours; copy them:
- B2 (lane classes `rb-task-`): `src/tools/rabbit_v0.1.0/views/ProjectTasksView.jsx` + `views/rabbitTasks.css` + `components/NewTaskPopup.jsx` + `components/TaskDetailPopup.jsx`. Toolbar at ProjectTasksView ~554-682; save-view and other kit Dialogs ~744-790 and ~1136-1180; empty states ~1000; group rows ~1250-1310 (StatusDot in the toggle); the status cell ~1504-1580 (StatusDot + select); the row ~1613+ (checkbox cell, hover actions). rabbitTasks.css ~60-230 holds the toolbar / filter strip / saved-views menu / table / bulk bar rules.
- B4 (lane classes `rb-files-`, `rb-fm-`): `components/ProjectFilesTable.jsx`, `components/FileManager.jsx`, and the sheet `views/rabbitFiles.css` (read its header comment and one section before writing any rule). FileManager shows the kit Tabs over a tabpanel, a kit Table `dense`, and a kit Dialog confirm portalled with `createPortal(…, document.body)`.
Open big files BY RANGE (`sed -n 'a,bp'` or Read with offset/limit), never whole: ProjectAssetsView.jsx is 2,357 lines, RelationsPanel.jsx 1,114. Use the Edit tool for edits (small, unique old_strings). Write any helper script with the Write tool (heredocs lose backslashes).

## The kit (read the files for exact props; import from `'../../../ui'` or the individual files as neighbours do)
Table/Th/Td/Row (`Table.jsx`: real <table>, `table-layout: fixed`, `head`, `dense` 32px rows else 36, Th `width` / `numeric` / `sort`+`onSort`, Td `numeric` (right, tabular, mono), Row `selected` / `interactive` / `inactive`), Toolbar (`right` slot, `wrap`), Tabs (`items`, `value`, `onChange`, `label`, REQUIRED `panelId` naming the region with role="tabpanel"), Button (`variant` primary|secondary|ghost|danger…, `size` sm|md, `Icon`), IconButton (`Icon`, `title` = its name, `size`), Dialog (`title` string or node, `subtitle`, `footer`, `onClose`, `width` 'confirm' 400 | 'form' 560 | 'reading' 720 | 'workbench' 960 | a number, `dismissOnBackdrop`, `onBeforeClose`, `busy`, `error`, rest props onto the surface; it does NOT portal), CellSelect (`value`, `onChange(valueOrNull)`, `options` [{value,label}] or strings, `placeholder` — a borderless in-cell select), StatusDot / StatusBadge (`status` keyed on the one `STATUS` map in `StatusDot.jsx`; unknown statuses render neutral with a humanised label), EmptyState (`Icon`, `title`, `body`, children action, `compact`), Badge, Chip, Banner, HoverActions, Field, Menu. Native fields use `className="ui-input"` with `data-size="sm"` (the kit `Input`/`TextArea` carry Escape/Enter behaviour that breaks panels holding drafts — B3d trap 3; use native `<input className="ui-input">` / `<textarea>` / `<select className="ui-input">` where the neighbours do).
Tokens (index.css): type `--text-h2` 16, `--text-h3` 14, `--text-body` 14, `--text-dense` 13, `--text-caption` 12, `--text-label` 11 (Label = uppercase 600 +0.06em; the kit Th already draws it); inks `--color-ink`, `--color-ink-2`, `--color-ink-3`; grounds `--color-paper` #1c1917, `--color-paper-raised`; `--color-rule` (hairline), `--color-hover`, `--color-signal` (#ea580c: the ONE active treatment — an underline, an edge), `--color-success|warning|danger`; `--control-sm` 28, `--control-md` 36; `--radius-control` 3, `--radius-float` 6; `--icon-sm` 14; `--spacing-gutter` 24; `--font-mono`, `--mono-size-adjust`. Grep index.css for anything else before using it; every custom property you read must exist.

## Constraints that do not bend
- C1 NO INTERACTION OR VIEW CHANGES: tables stay tables, the same views, flows and controls, same order, same click behaviour, same keyboard behaviour except what the kit Dialog adds (Escape closes, focus trap — ruled Q17). Never remove, merge, hide or add a control. Keep every accessible name the walk and tests use: button text "New asset", titles "View asset details", "Tasks not yet done", "Link Scenes", "Link Shots", tabs "Table" / "Gallery", FileManager's "Add files" and "Play <name>". Keep `export const ASSET_STATUSES` / `ASSET_TYPES` exactly (dataset.test.js parses them), the template-apply call sites (taskPayloadKeys.test.js), and `canOnProject`/`useProjectAccess` gating (writeGate.test.js).
- C6 on an orange ground text is `#1c1917` (the kit primary Button does this); white only at 19px bold and up.
- C7 one type scale, only the tokens above, nothing under 11px, no arbitrary `text-[Npx]`.
- C8 nothing hand-rolled that the kit has (tables, tabs, dialogs, buttons, icon buttons, empty states, status dots/badges, in-cell selects).
- C9 no white or near-white surface anywhere.
- Q2 sentence case everywhere except the Label step (table headers, field labels, eyebrows, status badges): drop `uppercase` from titles, buttons, tabs, chips, empty states; sentence-case typed strings that were written in capitals ("CREATE NEW ASSET" -> "Create new asset"), keeping the words.
- W9 every `window.confirm` becomes a kit Dialog `width="confirm"` with Cancel + the action (see FileManager's delete confirm for the portalled pattern and its test).

## The guards your code must pass (`src/tools/rabbit_v0.1.0/views/rabbitFilesCss.test.js`, helpers in `rabbitCssGuards.js`)
- Rules go in `views/rabbitFiles.css`, INSIDE the single `@layer components { … }` block (before its final `}`), in a new section headed like the others (`/* ═══ <Component> ═══ … */`) with a short comment per non-obvious rule. Every value a token: no hex, rgb(), hsl(), named or system colour.
- Classes: this file writes ONLY its own lane prefix (ProjectAssetsView.jsx -> `rb-asset-`; RelationsPanel.jsx -> `rb-rel-`), plus kit `ui-` classes and plain Tailwind layout utilities. Every lane class in the sheet must be written in the JSX and every one written must have a rule.
- Every `className` is a string literal (or a template with no hole but `${className}`). NO state in a className and NO state in a style: state goes on `data-*` attributes (`data-active="true|false"`, `data-selected`, `data-size`, `data-thumb`, `data-empty`, `data-tone`…) and the sheet keys on them with PLAIN `[data-x="v"]` selectors only (no `^=`, no `aria-*`/non-data attribute selectors), and only on values the JSX can actually produce.
- No `style={…}` except a literal listed for this file in the test's `STYLES` map (add yours there, minimal: a caller's geometry or a measured quantity as a custom property, e.g. `{{ '--rb-asset-x': \`${n}px\` }}` — never a colour or a state). Prefer `data-*` + rules over any style.
- No JSX spread attributes (`{...x}`) at all. No `color=`/`fill=`/`stroke=`/`opacity=` props with an expression, no `size={expr}`/`strokeWidth={expr}` on icons. No Tailwind palette utility (`text-stone-400`, `bg-orange-600`, `border-…`, `hover:bg-…`) and no hex anywhere in the JSX. `inlineStateTernaries` must find nothing.
- No utility on an element that sets a property its lane rule also sets. A lane rule that overrides a KIT rule on the same element is written one class heavier than the kit's selector (e.g. `.rb-asset-toolbar .ui-input.rb-asset-tool` against `.ui-input:hover:not(:disabled)`). Write selectors out; never `:is()` (the guard splits inside it).
- Run: `npx vitest run src/tools/rabbit_v0.1.0/views/rabbitFilesCss.test.js` and the counter `node <your scratchpad>/b4-count.mjs (the script in ui-b4-2026-09-25.md §7)` (its row for your file must read `tl 0 pal 0 hex 0`, `ternaries 0`, `styles` only the allowed ones). Then the lane's tests: `npx vitest run src/tools/rabbit_v0.1.0 src/ui src/dev` — all green.

## Traps already paid for
- The asset popup and the scene popup CENTRE WITH `transform`, so a `position: fixed` child lays out inside them. A kit Dialog nested in any such host must be rendered with `createPortal(<Dialog …/>, document.body)` (React events still bubble through the component tree). The kit has no `portal` option (kit request B4-KR-2; do not add one).
- A kit Dialog listens for Escape when it is the topmost modal. A hand-rolled fixed overlay inside it (FileManager's VideoPreview today) is not on the stack, so one Escape would close both: guard the host with `onBeforeClose={() => !layerOpen()}` where `layerOpen` walks a ref'd wrapper for any descendant whose computed `position` is `fixed` (TaskDetailPopup.jsx ~134-150 and ~187 is the pattern).
- The third ink fails on the legacy `#292524` (4.37:1) but passes on the kit Dialog's raised paper (4.66) and on paper (5.04). A column holds its header too (Label step: "CORE" 33px, "DESCRIPTION" 81px at 11px + tracking): size fixed columns for header and values. The kit's cells are 12px each side.
- `.ui-input` is width 100%: in a flex row give it `width: auto` via a lane class (B2's `.ui-input.rb-task-tool { width: auto; }`).

## Report back (under 350 words)
What you changed per component (one line each), every lane class family you added, each finding applied or RECORDED (with why), anything you could not do under C1, the exact test/count output lines, and any existing test you had to update and why.

---

## §B — the surface-5 prompt (not yet run)

You are lane B4b's surface 5 in the WILSON UI overhaul: `src/tools/rabbit_v0.1.0/components/VideoPreview.jsx` (207 lines) and `components/FileThumbnail.jsx` (155 lines) onto the shared kit. First read, in full, the shared spec: §A above — paths, kit, constraints (C1 above all), guards, traps. Lane classes: `rb-vid-` for VideoPreview, `rb-thumb-` for FileThumbnail (the sheet's header lists both). Read the sheet's FileManager section first: FileManager (already on the kit) is what hosts both files.

READ BEFORE EDITING: `src/tools/rabbit_v0.1.0/**/thumbnails.test.js` ~560-690 and `videoThumbnails.test.js` ~1000-1400 (find them with `rg -l`): they pin FileThumbnail's and VideoPreview's text and behaviour; they must stay green unchanged unless a pinned string is itself a Q2/C7 defect (say so if you change one). Then the review's findings on these two files: `rg -n "VideoPreview|FileThumbnail|R4-35|R4-12" docs/design/review/r-a-b-b-i-t-part-4.md` (read only those findings' Problem / Change lines).

DO:
1. `VideoPreview` onto the kit `Dialog` (the nearest width token that holds the player at its current size, or a number if the current width is a real geometry), rendered with `createPortal(…, document.body)` (its hosts — the asset popup, the scene popup, the task popup — include ones that centre with `transform`). AUTOPLAY UNTOUCHED (C1): every video attribute, the source/URL logic, the "Playback isn't available yet for media stored in your own bucket." message and every other state message keep their words and behaviour (the walk proves the preview by "Playback isn't available yet"). Its title the file's name in sentence case (the name as stored — do not re-case a file name); its own Escape handling, if any, goes (the kit Dialog takes Escape as the topmost modal); any keyboard behaviour beyond Escape stays.
2. Then delete the stop-gaps the hand-rolled preview needed: in `components/TaskDetailPopup.jsx` the `filesLayerOpen()` function, its `filesRef` and the `onBeforeClose={() => !filesLayerOpen()}` (B2 §4 asks for exactly this once VideoPreview is on the kit's stack), with the comment above them; in `views/ProjectAssetsView.jsx` `AssetDetailPopup`'s `layerOpen` guard ONLY IF nothing hand-rolled and fixed can still be open inside it (surface 4 put the relation pickers on the kit Dialog, portalled; check `AssetRelationsSidebar` and the four relation fields' pickers in RelationsPanel.jsx and ProjectAssetsView.jsx before deleting, and say what you found). Update or delete the tests that pinned those guards accordingly (rg for `filesLayerOpen`, `layerOpen`, `onBeforeClose` in the tests), and prove in a mounted test that ONE Escape with the preview open closes the preview and leaves its host popup open.
3. `FileThumbnail`: its extension label is `#78716c` (3.65:1 in FileManager's gallery, the one contrast failure left there): onto the inks by token (the gallery card ground is paper; the Label step if it is a label). R4-35's five preview geometries: unify only what is purely visual and record the rest (C1: no preview changes size or shape in a way a user would read as a different view). Every control named: the walk's `rabbit-asset-files-gallery` screen counts 2 unnamed `no-icon` controls — find them and name them (a title from the file's name) wherever they are — in FileThumbnail, in VideoPreview, or in FileManager's gallery card (this lane's file, already on the kit: a one-line change there is fine).
4. Add `video: { file: '../components/VideoPreview.jsx', prefix: 'rb-vid-' }` and `thumb: { file: '../components/FileThumbnail.jsx', prefix: 'rb-thumb-' }` to `FILES` in `views/rabbitFilesCss.test.js` (STYLES only for a real geometry, e.g. a caller's size as a custom property; FileThumbnail probably takes a size prop — carry it as a custom property literal and list it) and create `views/rabbitVideoRender.test.jsx` (the shape of `views/rabbitFilesManagerRender.test.jsx`): the preview is a kit Dialog in `document.body`, named by the file; one Escape closes it and not the host (mount it inside a kit Dialog host); its own-bucket message is unchanged; FileThumbnail's label carries no inline colour and the lane class.

End state: `npx vitest run src/tools/rabbit_v0.1.0 src/ui src/dev src/components` all green; the counter's rows for VideoPreview.jsx and FileThumbnail.jsx `tl 0 pal 0 hex 0`, `ternaries 0`, styles only allowed ones; ProjectAssetsView, FileManager, ProjectFilesTable and RelationsPanel rows unchanged (0/0/0). Report as the spec says; list anything whose look changed enough that Audrey should see it.
