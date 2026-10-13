// =============================================================================
// The date field — post-overhaul FX10 (2026-10-13), kit request FX10-KR-1.
//
// Audrey: "the calendar icon is covering the dates when it has all the space
// to space them out" — her Tasks table read `09 / 26 / 202`, the icon over the
// last figure, and `mm / dd / yy` in an empty one (Firefox's drawing). Every
// <input type="date"> in the app now keeps a floor (src/index.css, the kit's
// components layer): the date's room, `--date-room` in @theme, plus the
// field's own padding and border, `--date-inset`. These pin:
//   1. the token and the rule — at the top of the components layer, never
//      inside a condition;
//   2. the insets: the kit's wells declare theirs at no specificity, equal to
//      their padding and border as the kit writes them;
//   3. the numbers against what was measured (jsdom lays nothing out);
//   4. EVERY date field in src/, against EVERY rule in every sheet that can
//      land on it (its classes, its kit root, `input`, `[type]`, `[data-size]`,
//      context selectors included): the padding and border that win are its
//      inset, no context rule pads it otherwise unless judged here, its type
//      is the Dense step, and the min-width that wins is the floor; and no
//      utility class or inline style undoes any of that. A date field of a
//      kind whose inset is not declared, spelled any way, fails.
// The controls run every check on mutants of the real sheets and JSX (review
// round 1, R1-02: the first version read rules by their exact selector, so a
// context rule that padded a date field, a font-size, a utility or a field
// spelled `type={'date'}` all passed).
// The layout itself is measured in three engines by
// scripts/fx10-date-fields-shots.mjs (walkthrough 71).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  indexCss, cssCode, rulesOf, selectorsOf, lastCompound, specificity, gt, declaredValue, elementsOf,
  compoundMatches, horizontalInsets, withDeclaration,
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
    date's own box is 80.9px (84.3 empty) and the indicator's 17. Before FX10
    the Tasks and Assets rows gave the date and its icon 100px, the Shots
    table's wells 102. */
const GECKO = { empty: 116.1, set: 112.7, ownGap: 6 }
const BLINK = { set: 80.9, empty: 84.3, indicator: 17 }
const BEFORE = { tasks: 100, shots: 102 }

const px = (v) => Number((String(v).match(/^(\d+(?:\.\d+)?)px$/) || [])[1])
const theme = (name, sheet = css) => (cssCode(sheet).match(new RegExp(`@theme[^{]*\\{[\\s\\S]*?(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`)) || [])[1]

const FLOOR = 'input[type="date"]'
const FLOOR_VALUE = 'calc(var(--date-room) + var(--date-inset))'
const MD = ':where(input[type="date"])'
const SM = ':where(input[type="date"][data-size="sm"])'

/** The block headers around the first occurrence of `marker` (outermost first). */
function blocksAround(sheet, marker) {
  const c = cssCode(sheet)
  const at = c.indexOf(marker)
  if (at < 0) return null
  const stack = []
  let start = 0
  for (let i = 0; i < at; i++) {
    if (c[i] === '{') { stack.push(c.slice(start, i).trim().split(/[;}]/).pop().trim()); start = i + 1 }
    else if (c[i] === '}') { stack.pop(); start = i + 1 }
    else if (c[i] === ';') start = i + 1
  }
  return stack
}

describe('FX10: the date field keeps room for the whole date and its calendar', () => {
  it('@theme holds the room, 120px, and tokens.js mirrors it', () => {
    expect(theme('--date-room')).toBe('120px')
    expect(THEME['date-room']).toBe('120px')
  })

  it('every date field: at least the room plus its own insets, in tabular figures, at the top of the kit\'s components layer', () => {
    expect(declaredValue(css, FLOOR, 'min-width')).toBe(FLOOR_VALUE)
    expect(declaredValue(css, FLOOR, 'font-variant-numeric')).toBe('tabular-nums')
    // Inside `@layer components` and nothing else: no @media, @supports or
    // @container decides whether a date field keeps its floor.
    expect(blocksAround(css, `${FLOOR} {`)).toEqual(['@layer components'])
    expect(blocksAround(css, `${MD} {`)).toEqual(['@layer components'])
  })

  it('the kit\'s wells declare their insets at no specificity, equal to their padding and border as the kit writes them', () => {
    expect(declaredValue(css, MD, '--date-inset')).toBe('26px')
    expect(declaredValue(css, SM, '--date-inset')).toBe('18px')
    expect(specificity(MD)).toEqual([0, 0, 0])
    expect(specificity(SM)).toEqual([0, 0, 0])
    // .ui-input: padding 0 12px, a 1px hairline; [data-size="sm"]: 0 8px.
    const ins = (sel) => horizontalInsets((rulesOf(css).find(({ sel: s }) => s === sel) || {}).body || '')
    const md = { ...ins('.ui-input') }
    const sm = { ...md, ...ins('.ui-input[data-size="sm"]') }
    const sum = (i) => i['padding-left'] + i['padding-right'] + i['border-left-width'] + i['border-right-width']
    expect([sum(md), sum(sm)]).toEqual([26, 18])
    expect(px(declaredValue(css, MD, '--date-inset'))).toBe(sum(md))
    expect(px(declaredValue(css, SM, '--date-inset'))).toBe(sum(sm))
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

  it('CONTROL: the room the fields had fails Gecko — her `09 / 26 / 202` — and so does the room read from a sheet that sets it there', () => {
    for (const room of Object.values(BEFORE)) expect(room).toBeLessThan(GECKO.empty)
    const mutant = css.replace('--date-room: 120px;', `--date-room: ${BEFORE.tasks}px;`)
    expect(px(theme('--date-room', mutant)) - GECKO.empty).toBeLessThan(0)
  })
})

/* ── every date field in src/ ────────────────────────────────────────────── */
const walk = (dir, test) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p, test)
  return test(n, p) ? [p] : []
})
const SOURCES = walk(SRC, (n) => /\.jsx$/.test(n) && !/\.test\.jsx$/.test(n)).map((p) => ({ file: relative(SRC, p).replace(/\\/g, '/'), src: read(p) }))
/** Every sheet: the kit first, then every lane's. */
const SHEETS = [{ file: 'index.css', css }, ...walk(SRC, (n, p) => /\.css$/.test(n) && p !== join(SRC, 'index.css'))
  .map((p) => ({ file: relative(SRC, p).replace(/\\/g, '/'), css: read(p) }))]

/** The tables' borderless date fields: 6px of padding a side, no border — an
    inset of 12, declared on their own class beside their padding. */
const BORDERLESS = { 'rb-task-cell-date': 'tools/rabbit_v0.1.0/views/rabbitTasks.css', 'rb-asset-date': 'tools/rabbit_v0.1.0/views/rabbitFiles.css', 'rb-ent-date': 'tools/rabbit_v0.1.0/views/rabbitFiles.css' }
const isDate = (el) => /\stype=(?:"date"|'date'|\{\s*['"`]date['"`]\s*\})/.test(el.attrs)
/** A JSX spread attribute (`{...props}`) on the tag itself, not a spread
    inside a prop's expression. */
function spreadAttribute(tag) {
  let depth = 0
  for (let i = 0; i < tag.length; i++) {
    if (tag[i] === '{') {
      if (depth === 0 && tag.slice(0, i).trimEnd().slice(-1) !== '=' && /^\{\s*\.\.\./.test(tag.slice(i))) return true
      depth++
    } else if (tag[i] === '}') depth--
  }
  return false
}
const lit = (el, name) => (el.own.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1]
/** A date field's kind and the inset the floor reads for it. */
function kindOf(el) {
  const sized = lit(el, 'data-size') ?? lit(el, 'size')
  // Bins' TextInput is the kit Input at sm unless told otherwise (binUi.jsx).
  if (el.tag === 'TextInput') return { kind: 'kit', inset: (sized || 'sm') === 'sm' ? 18 : 26 }
  if (el.kit.includes('ui-input')) return { kind: 'kit', inset: sized === 'sm' ? 18 : 26 }
  const own = el.classes.find((c) => Object.hasOwn(BORDERLESS, c))
  if (own) return { kind: 'borderless', inset: 12, cls: own }
  // The Timeline's editors: Tailwind's px-3 (12px a side) and an inline 1px
  // border — the md well's 26, the floor's default.
  if (el.classes.includes('px-3')) return { kind: 'utility', inset: 26 }
  return null
}
/** A date field as the sheets see it: the element they land on, and what its
    inset is made of. */
function modelOf({ file, el }) {
  const kit = el.tag === 'Input' || el.tag === 'TextInput'
  const size = lit(el, 'data-size') ?? lit(el, 'size') ?? (el.tag === 'TextInput' ? 'sm' : el.tag === 'Input' ? 'md' : undefined)
  const surface = lit(el, 'data-surface') ?? lit(el, 'surface') ?? (kit ? 'dark' : undefined)
  const kind = kindOf(el)
  const parts = !kind ? null
    : kind.kind === 'borderless' ? { pad: 6, border: 0 }
    : kind.kind === 'utility' ? { pad: 4 * Number((el.classes.find((c) => /^px-\d+$/.test(c)) || 'px-0').slice(3)), border: /border:\s*'1px\b/.test(el.attrs) ? 1 : 0 }
    : { pad: size === 'sm' ? 8 : 12, border: 1 }
  return {
    file, el, kind, tag: 'input',
    classes: [...new Set([...el.classes, ...(kit ? ['ui-input'] : [])])],
    attrs: { type: 'date', 'data-size': size, 'data-surface': surface },
    expect: parts && { 'padding-left': parts.pad, 'padding-right': parts.pad, 'border-left-width': parts.border, 'border-right-width': parts.border },
    where: `${file}: <${el.tag} ${el.classes.join(' ')}>`,
  }
}
const DATE_FIELDS = SOURCES.flatMap(({ file, src }) => elementsOf(src).filter(isDate).map((el) => ({ file, el })))
const MODELS = DATE_FIELDS.map(modelOf)
/** The classes each source file writes: a context selector whose ancestors
    name a lane class its file never writes cannot hold the field. */
const WRITTEN = Object.fromEntries(SOURCES.map(({ file, src }) => [file, new Set(elementsOf(src).flatMap((e) => [...e.classes, ...e.kit]))]))

/** Every declaration, in every sheet, whose selector can land on the field. */
function declarationsOn(model, sheets = SHEETS) {
  const out = []
  sheets.forEach(({ file, css: sheet }, f) => {
    rulesOf(sheet).forEach(({ sel, body }, r) => {
      for (const one of selectorsOf(sel)) {
        const last = lastCompound(one)
        if (!compoundMatches(last, model)) continue
        const context = one.trim() !== last.trim()
        if (context) {
          const ancestors = one.slice(0, one.lastIndexOf(last)).match(/\.([\w-]+)/g) || []
          const written = WRITTEN[model.file] || new Set()
          if (ancestors.some((a) => !a.startsWith('.ui-') && !written.has(a.slice(1)))) continue
        }
        out.push({ file, selector: one.trim(), context, spec: specificity(one), order: [f, r], body })
      }
    })
  })
  return out
}
const cascade = (a, b) => gt(a.spec, b.spec) || a.order[0] - b.order[0] || a.order[1] - b.order[1]
/** Context rules that can reach a date field by its classes and that a
    reader has judged never to hold one, each with the reason. Anything else
    that pads a date field otherwise than its inset fails. */
const JUDGED = {
  '.rb-task-status-cell .rb-task-cell-select': 'the Status cell\'s select; the dates sit in their own cells',
  '.rb-task-cell-editor > .rb-task-cell-select': 'the selects\' caret wrapper; a date field is never inside it',
  '.rb-budget-status-select[data-dot="true"] > .ui-input': 'the Expenses filter\'s status select and its dot; the purchase date is in the expense form',
}
const TEXT_SIZES = [...cssCode(css).matchAll(/--text-([a-z0-9]+)\s*:/g)].map((m) => m[1])
const PAD_UTILITY = /^(?:p|px|pl|pr|ps|pe)-/
const SIZE_UTILITY = new RegExp(`^text-(?:${TEXT_SIZES.join('|')})$`)

/** What undoes a date field's floor: the problems, as sentences. */
function problems(models = MODELS, sheets = SHEETS) {
  const out = []
  for (const m of models) {
    if (!m.kind) { out.push(`${m.where}: a date field of no kind the floor knows (declare its --date-inset)`); continue }
    const decls = declarationsOn(m, sheets)
    // 1. The insets: what wins is the inset; no context rule pads it otherwise.
    if (m.kind.kind === 'utility') {
      const pads = m.el.classes.filter((c) => PAD_UTILITY.test(c) && !/^py-/.test(c))
      if (pads.join(' ') !== 'px-3') out.push(`${m.where}: padding utilities ${pads.join(' ')}, not the px-3 its inset reads`)
    } else {
      const utils = m.el.classes.filter((c) => PAD_UTILITY.test(c) && !/^py-/.test(c))
      if (utils.length) out.push(`${m.where}: a padding utility (${utils.join(' ')}) outranks every sheet`)
      for (const prop of Object.keys(m.expect)) {
        const set = decls.map((d) => ({ ...d, value: horizontalInsets(d.body)[prop] })).filter((d) => d.value !== undefined)
        const free = set.filter((d) => !d.context).sort(cascade)
        const base = free[free.length - 1]
        const value = base ? base.value : 0
        if (value !== m.expect[prop]) out.push(`${m.where}: ${prop} ${value} by ${base ? `${base.file} \`${base.selector}\`` : 'the reset'}, its inset says ${m.expect[prop]}`)
        for (const d of set) {
          if (!d.context || d.value === m.expect[prop] || Object.hasOwn(JUDGED, d.selector)) continue
          if (base && gt(d.spec, base.spec) < 0) continue
          out.push(`${m.where}: ${d.file} \`${d.selector}\` sets ${prop} ${d.value}, its inset says ${m.expect[prop]}`)
        }
      }
    }
    // 2. The type: the Dense step the room was measured at.
    for (const c of m.el.classes) if (SIZE_UTILITY.test(c) && c !== 'text-dense') out.push(`${m.where}: ${c}, not the Dense step`)
    for (const d of decls) {
      for (const p of ['font-size', 'font']) {
        const v = declaredValue(`${d.selector} {${d.body}}`, d.selector, p)
        if (v == null) continue
        if (p === 'font-size' ? !['var(--text-dense)', '13px'].includes(v) : !/\b(?:13px|var\(--text-dense\))/.test(v)) out.push(`${m.where}: ${d.file} \`${d.selector}\` sets ${p} ${v}, not the Dense step`)
      }
    }
    // 3. The min-width that wins is the floor; nothing inline or utility.
    if (m.el.classes.some((c) => /^min-w-/.test(c))) out.push(`${m.where}: a min-width utility outranks the floor`)
    if (/\bminWidth\s*:/.test(m.el.attrs)) out.push(`${m.where}: an inline minWidth outranks the floor`)
    const mins = decls.map((d) => ({ ...d, value: declaredValue(`${d.selector} {${d.body}}`, d.selector, 'min-width') })).filter((d) => d.value != null)
    const top = mins.reduce((best, d) => (best == null || gt(d.spec, best.spec) > 0 ? d : best), null)
    const rivals = mins.filter((d) => top && gt(d.spec, top.spec) === 0)
    if (!top || top.value !== FLOOR_VALUE) out.push(`${m.where}: the min-width that wins is ${top ? `${top.file} \`${top.selector}\` ${top.value}` : 'none'}, not the floor`)
    else if (rivals.some((d) => d.value !== FLOOR_VALUE)) out.push(`${m.where}: ${rivals.map((d) => `${d.file} \`${d.selector}\``).join(' and ')} tie with the floor (load order decides)`)
  }
  return out
}

describe('FX10: every date field in src/ keeps the floor, whatever lands on it', () => {
  it('the scan finds the app\'s date fields — more than forty, in every R.A.B.B.I.T. view that has one — however the type is spelled', () => {
    expect(DATE_FIELDS.length).toBeGreaterThan(40)
    const files = new Set(DATE_FIELDS.map((d) => d.file))
    for (const f of ['ProjectTasksView.jsx', 'ProjectAssetsView.jsx', 'ScenesView.jsx', 'EntityListView.jsx', 'TimelineView.jsx', 'BudgetView.jsx',
      'ProjectSummaryView.jsx', 'TeamView.jsx', 'IntakeWizardView.jsx', 'TaskDetailPopup.jsx', 'NewTaskPopup.jsx', 'RelationsPanel.jsx', 'BinInspector.jsx', 'AddFilesDialog.jsx']) {
      expect([...files].some((x) => x.endsWith(`/${f}`)), f).toBe(true)
    }
  })

  it('no input is built so that the scan cannot read its type (a spread attribute), but the kit\'s own Input and Bins\' TextInput, whose callers are read', () => {
    const KIT_SPREADS = ['ui/Input.jsx', 'tools/rabbit_v0.1.0/views/bins/binUi.jsx']
    const unread = SOURCES.flatMap(({ file, src }) => elementsOf(src)
      .filter((el) => ['input', 'Input', 'TextInput'].includes(el.tag) && spreadAttribute(el.attrs) && !/\stype=["'{]/.test(el.own))
      .map(() => file))
      .filter((f) => !KIT_SPREADS.includes(f))
    expect(unread).toEqual([])
    expect(spreadAttribute('<input {...rest} />')).toBe(true)
    expect(spreadAttribute('<input onChange={v => set(b => ({ ...b, d: v }))} />')).toBe(false)
  })

  it('every one keeps its floor: the padding and border that win are its inset, its type the Dense step, the min-width that wins the floor', () => {
    expect(problems()).toEqual([])
  })

  it('a borderless field declares its 12px inset on its own class', () => {
    for (const [cls, sheetFile] of Object.entries(BORDERLESS)) {
      const sheet = read(join(SRC, sheetFile))
      expect(declaredValue(sheet, `.${cls}`, '--date-inset'), cls).toBe('12px')
      expect(DATE_FIELDS.some((d) => kindOf(d.el)?.cls === cls), `${cls} is written on a date field`).toBe(true)
    }
  })

  it('CONTROL: the floor taken out, put in a condition, or tied by a later rule is caught', () => {
    const noFloor = [{ file: 'index.css', css: withDeclaration(css, FLOOR, 'min-width', '0') }, ...SHEETS.slice(1)]
    expect(problems(MODELS, noFloor).length).toBeGreaterThan(40)
    // The floor rule's own text, wrapped whole in a condition.
    const at = css.indexOf(`  ${FLOOR} {`)
    const end = css.indexOf('\n  }', at) + 4
    const inMedia = `${css.slice(0, at)}  @media (min-width: 9000px) {\n${css.slice(at, end)}\n  }${css.slice(end)}`
    expect(blocksAround(inMedia, `${FLOOR} {`)).toEqual(['@layer components', '@media (min-width: 9000px)'])
    const dash = SHEETS.map((s) => (s.file.endsWith('dashboard.css') ? { ...s, css: `${s.css}\n.dash-note-meta .ui-input.dash-date { min-width: 60px; }` } : s))
    expect(problems(MODELS, dash).some((p) => /dash-date/.test(p) && /tie|not the floor/.test(p))).toBe(true)
  })

  it('CONTROL: a context rule that pads or resizes a date field, in any lane, is caught (round 1\'s P01, P02b, P14)', () => {
    const add = (file, rule) => SHEETS.map((s) => (s.file.endsWith(file) ? { ...s, css: `${s.css}\n${rule}` } : s))
    expect(problems(MODELS, add('rabbitTasks.css', '.rb-task-row .rb-task-cell-date { padding-right: 20px; }')).some((p) => /padding-right 20/.test(p))).toBe(true)
    expect(problems(MODELS, add('rabbitScenes.css', '.rb-scene-table-wrap .rb-scene-table .ui-input[data-size="sm"] { padding: 0 16px; }')).some((p) => /ScenesView.*padding-left 16/.test(p))).toBe(true)
    expect(problems(MODELS, add('rabbitTasks.css', '.rb-task-row .rb-task-cell-date { font-size: var(--text-body); }')).some((p) => /font-size var\(--text-body\)/.test(p))).toBe(true)
    expect(problems(MODELS, add('index.css', '.ui-input[data-size="sm"] { padding: 0 10px; }')).some((p) => /padding-left 10/.test(p))).toBe(true)
    // …and a rule in another lane's sheet whose ancestor that lane alone writes is not.
    expect(problems(MODELS, add('dashboard.css', '.dash-note-meta > .ui-input.rb-task-date-input { padding: 0 2px; }'))).toEqual([])
  })

  it('CONTROL: a field of no known kind, spelled any way, or undone by a utility or an inline style, is caught (round 1\'s P06, P07)', () => {
    const one = (jsx) => modelOf({ file: 'x/Probe.jsx', el: elementsOf(jsx).filter(isDate)[0] })
    expect(problems([one('<input type={\'date\'} className="rb-x-when" />')])[0]).toMatch(/no kind/)
    expect(problems([one('<input type="date" className="w-full px-3 pr-8 text-dense" style={{ border: \'1px solid #44403c\' }} />')]).some((p) => /padding utilities/.test(p))).toBe(true)
    expect(problems([one('<Input type="date" className="min-w-0" />')]).some((p) => /min-width utility/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input text-body" data-size="sm" />')]).some((p) => /text-body/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={{ minWidth: 0 }} />')]).some((p) => /inline minWidth/.test(p))).toBe(true)
    // And the scan reads the expression spelling and a kit field's size.
    expect(one('<TextInput type="date" value={d} />').kind).toEqual({ kind: 'kit', inset: 18 })
    expect(one('<Input type="date" value={d} />').kind).toEqual({ kind: 'kit', inset: 26 })
    expect(isDate(elementsOf('<input type="text" className="ui-input" />')[0])).toBe(false)
  })
})

/* ── the containers the floor needed room in (review round 1, R1-03) ────── */
describe('FX10: a container too narrow for a date\'s floor lays out otherwise', () => {
  it('the Summary\'s Control panel puts six to a row from 1280, three below (at 1024 a sixth was 142px, under the md well\'s 146)', () => {
    const src = SOURCES.find((s) => s.file.endsWith('views/ProjectSummaryView.jsx')).src
    expect(src).toContain('<div className="grid grid-cols-3 xl:grid-cols-6 gap-3">')
    expect(src).not.toMatch(/lg:grid-cols-6/)
    // The two dates are in that grid.
    const grid = src.slice(src.indexOf('grid-cols-3 xl:grid-cols-6'), src.indexOf('</div>', src.indexOf('grid-cols-3 xl:grid-cols-6')))
    expect(grid.match(/<SettingsDateInput /g)).toHaveLength(2)
  })
})
