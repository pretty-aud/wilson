// =============================================================================
// The date field — post-overhaul FX10 (2026-10-13), kit request FX10-KR-1.
//
// Audrey: "the calendar icon is covering the dates when it has all the space
// to space them out" — her Tasks table read `09 / 26 / 202`, the icon over the
// last figure, and `mm / dd / yy` in an empty one. Every <input type="date">
// in the app now keeps a floor (src/index.css, the kit's components layer):
// the date's room, `--date-room` in @theme, plus the field's own padding and
// border, `--date-inset`. These pin:
//   1. the token and the rule, and that the floor beats every `min-width` a
//      date field is given with one class;
//   2. the insets: the kit's wells declare theirs at no specificity, equal to
//      their padding and border as the kit writes them;
//   3. the numbers against what was measured (jsdom lays nothing out) — the
//      room holds Gecko's widest and Blink's date and indicator with space;
//   4. that EVERY date field in src/ is of a kind whose inset is declared,
//      and no sheet gives a kit date field padding or a border of its own:
//      a new date field cannot miss the rule without failing here.
// The layout itself is measured in three engines by
// scripts/fx10-date-fields-shots.mjs (walkthrough 71).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  indexCss, cssCode, rulesOf, selectorsOf, lastCompound, specificity, gt, declaredValue, elementsOf,
} from '../tools/rabbit_v0.1.0/rabbitCssGuards.js'
import { THEME } from './tokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..')
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const css = indexCss

/** Measured by scripts/fx10-date-fields-shots.mjs on the dev fixtures at the
    Dense step (13px Geist, tabular figures), en-US. Gecko (Firefox 157): a
    date field's content box must hold its date AND its calendar button —
    the empty pattern "mm / dd / yyyy" needs 116.1px, a set date 112.7, and
    at exactly that width Gecko leaves 6px of its own between the year's ink
    and the button's. Blink (Chromium 147, Electron 33 = Chromium 130): the
    date's own box is 80.9px (84.3 empty) and the indicator's 17. */
const GECKO = { empty: 116.1, set: 112.7, ownGap: 6 }
const BLINK = { set: 80.9, empty: 84.3, indicator: 17 }

const px = (v) => Number((String(v).match(/^(\d+(?:\.\d+)?)px$/) || [])[1])
const theme = (name) => (cssCode(css).match(new RegExp(`@theme[^{]*\\{[\\s\\S]*?(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`)) || [])[1]
/** The rules of a sheet whose selector, exactly, is `sel`. */
const rulesFor = (sheet, sel) => rulesOf(sheet).filter(({ sel: s }) => selectorsOf(s).some((one) => one.replace(/\s+/g, ' ') === sel))

const FLOOR = 'input[type="date"]'
const MD = ':where(input[type="date"])'
const SM = ':where(input[type="date"][data-size="sm"])'

describe('FX10: the date field keeps room for the whole date and its calendar', () => {
  it('@theme holds the room, 120px, and tokens.js mirrors it', () => {
    expect(theme('--date-room')).toBe('120px')
    expect(THEME['date-room']).toBe('120px')
  })

  it('every date field: at least the room plus its own insets, in tabular figures', () => {
    expect(declaredValue(css, FLOOR, 'min-width')).toBe('calc(var(--date-room) + var(--date-inset))')
    expect(declaredValue(css, FLOOR, 'font-variant-numeric')).toBe('tabular-nums')
    // In the kit's components layer, where every lane sheet's rules are.
    const at = cssCode(css).indexOf(`${FLOOR} {`)
    const layer = cssCode(css).lastIndexOf('@layer components {', at)
    expect(at).toBeGreaterThan(0)
    expect(layer).toBeGreaterThan(cssCode(css).lastIndexOf('@layer base {', at))
  })

  it('the kit\'s wells declare their insets at no specificity, equal to their padding and border as the kit writes them', () => {
    expect(declaredValue(css, MD, '--date-inset')).toBe('26px')
    expect(declaredValue(css, SM, '--date-inset')).toBe('18px')
    expect(specificity(MD)).toEqual([0, 0, 0])
    expect(specificity(SM)).toEqual([0, 0, 0])
    // .ui-input: padding 0 12px, a 1px hairline; [data-size="sm"]: 0 8px.
    const pad = (sel) => px(declaredValue(css, sel, 'padding').split(/\s+/)[1])
    const hair = px(declaredValue(css, '.ui-input', 'border').split(/\s+/)[0])
    expect([pad('.ui-input'), pad('.ui-input[data-size="sm"]'), hair]).toEqual([12, 8, 1])
    expect(2 * pad('.ui-input') + 2 * hair).toBe(px(declaredValue(css, MD, '--date-inset')))
    expect(2 * pad('.ui-input[data-size="sm"]') + 2 * hair).toBe(px(declaredValue(css, SM, '--date-inset')))
  })

  it('the floor outweighs every min-width a date field is given with one class (the kit\'s `.ui-input { min-width: 0 }`, the tables\' borderless fields\')', () => {
    const floor = specificity(FLOOR)
    for (const sel of ['.ui-input', '.rb-task-cell-select', '.rb-asset-date', '.rb-ent-date']) expect(gt(floor, specificity(sel)), sel).toBeGreaterThan(0)
    expect(declaredValue(css, '.ui-input', 'min-width')).toBe('0')
  })

  it('the room holds Gecko\'s widest — the empty pattern and its button — with space to spare, and Blink\'s date, its indicator and a clear gap', () => {
    const room = px(theme('--date-room'))
    // Gecko puts its button at the field's right end: what the room has over
    // its need goes between the date and the button, on top of its own 6px.
    expect(room - GECKO.empty).toBeGreaterThanOrEqual(3)
    expect(GECKO.ownGap + room - GECKO.empty).toBeGreaterThanOrEqual(9)
    expect(GECKO.ownGap + room - GECKO.set).toBeGreaterThanOrEqual(12)
    // Blink puts its indicator at the right end too: the date's box is what
    // the indicator leaves, and the empty pattern is its widest.
    expect(room - BLINK.indicator - BLINK.empty).toBeGreaterThanOrEqual(12)
  })

  it('CONTROL: the room the fields had (100px in the Tasks table, 102 in the Shots table) fails Gecko — her `09 / 26 / 202`', () => {
    for (const room of [100, 102]) expect(room - GECKO.empty).toBeLessThan(0)
  })
})

/* ── every date field in src/ is of a kind whose inset is declared ───────── */
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p)
  return /\.jsx$/.test(n) && !/\.test\.jsx$/.test(n) ? [p] : []
})
const SOURCES = walk(SRC).map((p) => ({ file: relative(SRC, p).replace(/\\/g, '/'), src: read(p) }))
/** The tables' borderless date fields: 6px of padding a side, no border — an
    inset of 12, declared on their own class beside their padding. */
const BORDERLESS = { 'rb-task-cell-date': 'rabbit_v0.1.0/views/rabbitTasks.css', 'rb-asset-date': 'rabbit_v0.1.0/views/rabbitFiles.css', 'rb-ent-date': 'rabbit_v0.1.0/views/rabbitFiles.css' }
const isDate = (el) => /\stype=(?:"date"|\{\s*['"]date['"]\s*\})/.test(el.own)
/** A date field's kind and the inset the floor reads for it. */
function kindOf(el) {
  const sized = (el.own.match(/\s(?:data-size|size)="(sm|md)"/) || [])[1]
  // Bins' TextInput is the kit Input at sm unless told otherwise (binUi.jsx).
  if (el.tag === 'TextInput') return { kind: 'kit', inset: (sized || 'sm') === 'sm' ? 18 : 26 }
  if (el.kit.includes('ui-input')) return { kind: 'kit', inset: sized === 'sm' ? 18 : 26 }
  const own = el.classes.find((c) => Object.hasOwn(BORDERLESS, c))
  if (own) return { kind: 'borderless', inset: 12, cls: own }
  // The Timeline's editors: Tailwind's px-3 (12px a side) and a hairline —
  // the md well's 26, the floor's default.
  if (el.classes.includes('px-3')) return { kind: 'utility', inset: 26 }
  return null
}
const DATE_FIELDS = SOURCES.flatMap(({ file, src }) => elementsOf(src).filter(isDate).map((el) => ({ file, el, kind: kindOf(el) })))
/** Every lane sheet in src/: a rule there is how a field gets other insets. */
const SHEETS = (function sheets(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : sheets(p)
    return /\.css$/.test(n) && p !== join(SRC, 'index.css') ? [{ file: relative(SRC, p).replace(/\\/g, '/'), css: read(p) }] : []
  })
}(SRC))

describe('FX10: every date field in src/ is of a kind whose inset the floor knows', () => {
  it('the scan finds the app\'s date fields (more than forty, in every R.A.B.B.I.T. view that has one)', () => {
    expect(DATE_FIELDS.length).toBeGreaterThan(40)
    const files = new Set(DATE_FIELDS.map((d) => d.file))
    for (const f of ['ProjectTasksView.jsx', 'ProjectAssetsView.jsx', 'ScenesView.jsx', 'EntityListView.jsx', 'TimelineView.jsx', 'BudgetView.jsx',
      'ProjectSummaryView.jsx', 'TeamView.jsx', 'IntakeWizardView.jsx', 'TaskDetailPopup.jsx', 'NewTaskPopup.jsx', 'RelationsPanel.jsx', 'BinInspector.jsx', 'AddFilesDialog.jsx']) {
      expect([...files].some((x) => x.endsWith(`/${f}`)), f).toBe(true)
    }
  })

  it('each one is a kit well (its inset by its size), a table\'s borderless field or the Timeline editors\' px-3 field', () => {
    const unknown = DATE_FIELDS.filter((d) => !d.kind).map((d) => `${d.file}: ${d.el.attrs.slice(0, 120)}`)
    expect(unknown).toEqual([])
  })

  it('a borderless field declares its 12px inset on its own class, beside its 6px padding and no border', () => {
    for (const [cls, sheetFile] of Object.entries(BORDERLESS)) {
      const sheet = read(join(SRC, 'tools', sheetFile))
      expect(declaredValue(sheet, `.${cls}`, '--date-inset'), cls).toBe('12px')
      // Its padding and border: its own rule's, or (Tasks) the cell controls' it shares.
      const owner = declaredValue(sheet, `.${cls}`, 'padding') != null ? `.${cls}` : '.rb-task-cell-select'
      expect([declaredValue(sheet, owner, 'padding'), declaredValue(sheet, owner, 'border')], cls).toEqual(['0 6px', '0'])
      expect(DATE_FIELDS.some((d) => d.kind?.cls === cls), `${cls} is written on a date field`).toBe(true)
    }
  })

  it('no sheet gives a kit date field padding or a border of its own: its inset stays the kit\'s', () => {
    const laneClasses = new Set(DATE_FIELDS.filter((d) => d.kind?.kind === 'kit').flatMap((d) => d.el.classes.filter((c) => !c.startsWith('ui-'))))
    const found = []
    for (const { file, css: sheet } of SHEETS) {
      for (const { sel, body } of rulesOf(sheet)) {
        if (!/(?:^|;)\s*(?:padding|border)(?:-(?:left|right|inline)[\w-]*)?\s*:/.test(body)) continue
        for (const one of selectorsOf(sel)) {
          const last = lastCompound(one)
          const hit = [...laneClasses].find((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last))
          if (hit) found.push(`${file}: ${one}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('CONTROL: an unknown date field, and a sheet that pads a kit date field, are caught', () => {
    const [el] = elementsOf('<input type="date" className="rb-x-when" />')
    expect(kindOf(el)).toBeNull()
    const [kit] = elementsOf('<input type="date" className="ui-input rb-x-when" data-size="sm" />')
    expect(kindOf(kit)).toEqual({ kind: 'kit', inset: 18 })
    const [bins] = elementsOf('<TextInput type="date" value={d} />')
    expect(kindOf(bins)).toEqual({ kind: 'kit', inset: 18 })
    const [md] = elementsOf('<Input type="date" value={d} />')
    expect(kindOf(md)).toEqual({ kind: 'kit', inset: 26 })
    expect(isDate(elementsOf('<input type="text" className="ui-input" />')[0])).toBe(false)
  })
})
