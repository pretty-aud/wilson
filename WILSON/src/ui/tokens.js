// =============================================================================
// tokens.js — the design system for inline `style={{}}` sites (plan §3).
//
// `@theme` in src/index.css is the specification and the only place a hex is
// written for a REASON; this module repeats the same values so the ~2,000
// inline style sites can read a name instead of a number. `tokens.test.js`
// parses the @theme block and asserts the two agree, entry for entry, and
// that every ink/ground pair below clears its ratio (4.5:1 for text, 3:1 at
// 19px bold and above and for focus rings). A value that fails does not ship.
//
// 🚨 Never add a hex here that is not in @theme; never add one to @theme
// without adding it here. The test fails either way. A surface that needs a
// colour that is not on this list has not found a colour, it has found a
// question for the design system.
//
// Light surfaces (Home, Settings, Help — and until lane C lands, the six
// data pages) keep ONE ink. Audrey, 2026-08-10, in capitals: "DO NOT USE GRAY
// TEXT AGAINST ORANGE AS IT IS HARD TO SEE ONLY WHITE OR BLACK." Hierarchy on
// a light surface comes from size and weight, and emptiness from italic.
//
// This module absorbed src/components/lightSurface.js (F04). Its export names
// are kept below as aliases so its 31 importers keep working; new code reads
// the plain names.
// =============================================================================

/** Every entry of `@theme` that carries a value a JS site may need. Keys are
 *  the custom-property names without the leading `--`. */
export const THEME = Object.freeze({
  // families (Q3, ruled: Geist + Geist Mono; the stacks are the plan's verbatim)
  'font-sans': "Geist, Inter, system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif",
  'font-mono': "'Geist Mono', 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace",
  'mono-size-adjust': '1.0',
  // type scale (px) — seven steps; the transition title is exempt (Q18)
  'text-h1': '20px',
  'text-h2': '16px',
  'text-h3': '14px',
  'text-body': '14px',
  'text-dense': '13px',
  'text-caption': '12px',
  'text-label': '11px',
  // colour
  'color-paper': '#1c1917',
  'color-paper-raised': '#232020',
  'color-paper-recessed': '#0c0a09',
  'color-ink': '#f5f0ec',
  'color-ink-2': '#b8b4b0',
  'color-ink-3': '#8d8986',
  'color-rule': 'rgba(245, 240, 236, 0.14)',
  'color-rule-light': 'rgba(28, 25, 23, 0.22)',
  'color-signal': '#ea580c',
  'color-signal-fill': '#c2410c',
  'color-signal-tint': 'rgba(234, 88, 12, 0.16)',
  'color-on-fill': '#ffffff',
  'color-ground-light': '#f4a261',
  'color-ink-light': '#1c1917',
  'color-well-light': 'rgba(120, 70, 30, 0.18)',
  'color-surface-light-solid': '#dd9155',
  'color-success': '#4ade80',
  'color-danger': '#fca5a5',
  'color-warning': '#f59e0b',
  'color-danger-light': '#7f1d1d',
  'color-focus': '#ea580c',
  'color-backdrop': 'rgba(12, 10, 9, 0.6)',
  'color-selection': 'rgba(234, 88, 12, 0.35)',
  'color-selection-light': 'rgba(28, 25, 23, 0.22)',
  'color-skeleton': 'rgba(245, 240, 236, 0.08)',
  'color-skeleton-light': 'rgba(28, 25, 23, 0.22)',
  'color-hover': 'rgba(245, 240, 236, 0.06)',
  'color-hover-light': 'rgba(28, 25, 23, 0.08)',
  'color-scroll-thumb': 'rgba(245, 240, 236, 0.25)',
  'color-scroll-thumb-hover': '#ea580c',
  'color-scroll-thumb-light': '#c2712c',
  'color-scroll-thumb-light-hover': '#a85d20',
  // radius, elevation (Q5, ruled: 3 / 6)
  'radius-control': '3px',
  'radius-float': '6px',
  'shadow-float': '0 8px 24px rgba(0, 0, 0, 0.35)',
  'shadow-float-light': '0 8px 24px rgba(60, 30, 10, 0.25)',
  // spacing, measure
  'spacing-gutter': '24px',
  'width-reading': '720px',
  'width-data-max': '1240px',
  'measure-reading': '66ch',
  'measure-prose-max': '72ch',
  // density
  'control-sm': '28px',
  'control-md': '36px',
  'row': '36px',
  'row-dense': '32px',
  'table-head': '32px',
  'cell-pad-y': '8px',
  'cell-pad-x': '12px',
  'toolbar': '44px',
  'page-header': '56px',
  'panel-header': '32px',
  'shortcut-bar': '34px',
  'titlebar': '32px',
  'icon-sm': '14px',
  'icon-md': '16px',
  'icon-lg': '24px',
  'panel-sm': '200px',
  'panel-md': '240px',
  'panel-lg': '300px',
  'dialog-confirm': '400px',
  'dialog-form': '560px',
  'dialog-reading': '720px',
  'dialog-workbench': '960px',
  // motion
  'duration-state': '120ms',
  'duration-response': '200ms',
  'duration-panel': '240ms',
  'ease-response': 'cubic-bezier(0.2, 0, 0, 1)',
})

/** Read a token by its @theme name, e.g. `token('color-ink')`. Throws on a
 *  name that does not exist, so a typo is a stack trace, not a black box. */
export function token(name) {
  const v = THEME[name]
  if (v === undefined) throw new Error(`unknown design token: --${name}`)
  return v
}

// ── Families ────────────────────────────────────────────────────────────────
export const FONT_SANS = THEME['font-sans']
export const FONT_MONO = THEME['font-mono']
export const MONO_SIZE_ADJUST = Number(THEME['mono-size-adjust'])

// ── Type scale, as numbers (px) ─────────────────────────────────────────────
const px = (name) => Number(THEME[name].replace('px', ''))
export const TYPE = Object.freeze({
  h1: px('text-h1'),
  h2: px('text-h2'),
  h3: px('text-h3'),
  body: px('text-body'),
  dense: px('text-dense'),
  caption: px('text-caption'),
  label: px('text-label'),
})
/** The floor. Nothing smaller ships (C7). */
export const TYPE_FLOOR = TYPE.label

// ── Dark surfaces: the three tools and, under Q1, the six data pages ────────
export const PAPER = THEME['color-paper']
export const PAPER_RAISED = THEME['color-paper-raised']
export const PAPER_RECESSED = THEME['color-paper-recessed']
export const INK = THEME['color-ink']
export const INK_2 = THEME['color-ink-2']
export const INK_3 = THEME['color-ink-3']
export const RULE = THEME['color-rule']
export const HOVER = THEME['color-hover']

// ── The two oranges, each with one job ──────────────────────────────────────
/** The frame, the one active state, the one selection. Never a fill under text smaller than 19px bold. */
export const SIGNAL = THEME['color-signal']
/** The filled primary button, white text (5.18:1). The only other orange. */
export const SIGNAL_FILL = THEME['color-signal-fill']
/** The signal as a 16% tint: active chips, active icon buttons, the selected row. */
export const SIGNAL_TINT = THEME['color-signal-tint']
export const ON_FILL = THEME['color-on-fill']

// ── Light surfaces ──────────────────────────────────────────────────────────
export const GROUND_LIGHT = THEME['color-ground-light']
export const INK_LIGHT = THEME['color-ink-light']
export const RULE_LIGHT = THEME['color-rule-light']
export const WELL_LIGHT = THEME['color-well-light']
export const SURFACE_LIGHT_SOLID = THEME['color-surface-light-solid']
export const HOVER_LIGHT = THEME['color-hover-light']

// ── Status, on dark only (on light, status is text plus a dot in INK_LIGHT) ─
export const SUCCESS = THEME['color-success']
export const DANGER = THEME['color-danger']
export const WARNING = THEME['color-warning']
/** Error text on `ground-light` ONLY (4.86:1), or a fill under white
 *  (10.02:1). It fails on `well-light` and `surface-light-solid` — see the
 *  controls in tokens.test.js. The one status colour on the light pages. */
export const DANGER_LIGHT = THEME['color-danger-light']

// ── Focus, backdrop, selection ──────────────────────────────────────────────
export const FOCUS = THEME['color-focus']
export const BACKDROP = THEME['color-backdrop']
export const SELECTION = THEME['color-selection']
export const SELECTION_LIGHT = THEME['color-selection-light']

// ── Radius, elevation ───────────────────────────────────────────────────────
export const RADIUS_CONTROL = px('radius-control')
export const RADIUS_FLOAT = px('radius-float')
export const SHADOW_FLOAT = THEME['shadow-float']
export const SHADOW_FLOAT_LIGHT = THEME['shadow-float-light']

// ── Spacing, measure, density ───────────────────────────────────────────────
export const GUTTER = px('spacing-gutter')
export const WIDTH_READING = px('width-reading')
export const WIDTH_DATA_MAX = px('width-data-max')
export const CONTROL_SM = px('control-sm')
export const CONTROL_MD = px('control-md')
export const ROW = px('row')
export const ROW_DENSE = px('row-dense')
export const TABLE_HEAD = px('table-head')
export const TOOLBAR = px('toolbar')
export const PAGE_HEADER = px('page-header')
export const PANEL_HEADER = px('panel-header')
export const SHORTCUT_BAR = px('shortcut-bar')
export const TITLEBAR = px('titlebar')
export const ICON = Object.freeze({ sm: px('icon-sm'), md: px('icon-md'), lg: px('icon-lg') })
export const PANEL = Object.freeze({ sm: px('panel-sm'), md: px('panel-md'), lg: px('panel-lg') })
export const DIALOG = Object.freeze({
  confirm: px('dialog-confirm'),
  form: px('dialog-form'),
  reading: px('dialog-reading'),
  workbench: px('dialog-workbench'),
})

// ── Motion ──────────────────────────────────────────────────────────────────
export const DURATION = Object.freeze({
  state: Number(THEME['duration-state'].replace('ms', '')),
  response: Number(THEME['duration-response'].replace('ms', '')),
  panel: Number(THEME['duration-panel'].replace('ms', '')),
})
export const EASE_RESPONSE = THEME['ease-response']

// =============================================================================
// lightSurface.js aliases (Session 43 §B), kept so its importers keep working.
// The values are the tokens above; the table objects are one definition so
// Team Members, Users and Logs cannot drift apart again.
//
// ⚠️ LIGHT_TABLE_HEAD_CELL keeps `fontWeight: 700` for now. The type system
// has two weights (400, 600) and Wave 1's codemod (T0) takes every 700 to
// 600 app-wide in one reviewable diff; flipping this one alone would change
// five table headers ahead of the rest. Recorded in the F1 hand-off.
// =============================================================================
export const LIGHT_INK = INK_LIGHT
export const LIGHT_RULE = RULE_LIGHT
export const LIGHT_WELL = WELL_LIGHT
export const LIGHT_ACCENT = SIGNAL
export const LIGHT_SURFACE_SOLID = SURFACE_LIGHT_SOLID
export const LIGHT_TABLE_FRAME = Object.freeze({ border: `1px solid ${LIGHT_RULE}` })
export const LIGHT_TABLE_HEAD_ROW = Object.freeze({ backgroundColor: LIGHT_WELL })
export const LIGHT_TABLE_HEAD_CELL = Object.freeze({ color: LIGHT_INK, fontWeight: 700 })
export const LIGHT_TABLE_ROW_DIVIDER = Object.freeze({ borderBottom: `1px solid ${LIGHT_RULE}` })
