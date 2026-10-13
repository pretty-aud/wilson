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
//   4. every date field the JSX writes, against the rules of every sheet whose
//      selector can land on it as this file reads selectors (its classes, its
//      kit root, `input`, `[type]`, `[data-size]`; context selectors whose
//      ancestors its file or a file that renders it writes, or the kit's):
//      the padding and border that win are its inset, no context rule pads
//      it otherwise unless judged here, its own --date-inset is its inset,
//      its type is the Dense step, the min-width that wins is the floor, and
//      no rule moves or sizes its calendar glyph or its date's box; no
//      utility class or inline style undoes any of that. A date field of a
//      kind whose inset is not declared, spelled any way, fails. "Wins" is
//      the cascade's as this file models it: !important, then the layer
//      (theme, base, components, utilities, a later one, none), then
//      specificity, then order;
//   5. --date-room is declared once, in @theme, and every --date-inset sits
//      directly in the components layer, never inside a condition; no
//      inline style sets either.
// The controls run every check on mutants of the real sheets and JSX (review
// round 1, R1-02: the first version read rules by their exact selector;
// round 2, R2-02: thirteen ways still passed — another layer, a custom
// property, a condition, a pseudo-element, a parent component's class, a
// judged wrapper, `:not()` and `:is()` read wrong).
// It is a static reading, not a browser: what it cannot see — a style set
// from JavaScript, a selector this file does not parse — the layout cannot
// prove here. The layout itself is measured in three engines by
// scripts/fx10-date-fields-shots.mjs (walkthrough 71).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  indexCss, cssCode, jsCode, normal, rulesOf, selectorsOf, topCompound, specificity, gt, declaredValue, elementsOf,
  compoundMatches, horizontalInsets, withDeclaration, rulesWithContext, insetDeclarations, cascadeTier, importance,
  datePartRules, jsxNesting, classReach, classesOf,
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
/** The classes that can be around a field of each file: its own, and those
    around each place another file renders it (classReach; review round 2,
    R2-02's M1c: the field's own file alone missed `.rb-ent-detail-task`,
    around the level window's `<NewTaskSidePopup>` in EntityListView.jsx). A
    context selector whose ancestors name a lane class outside them cannot
    hold the field. */
const { own: OWN, written: WRITTEN } = classReach(SRC)

/** A sheet's rules, one entry per selector of each rule's list, read once
    per sheet text: the scan asks every sheet about every date field. */
const PARSED = new Map()
function parsed(sheet) {
  let rules = PARSED.get(sheet)
  if (!rules) {
    rules = rulesWithContext(sheet).flatMap(({ sel, body, layer, at }, r) => selectorsOf(sel).map((one) => {
      const last = topCompound(one)
      const context = one.trim() !== last.trim()
      return { one: one.trim(), last, context, spec: specificity(one), body, layer, at, r,
        ancestors: context ? one.slice(0, one.lastIndexOf(last)).match(/\.([\w-]+)/g) || [] : [] }
    }))
    PARSED.set(sheet, rules)
  }
  return rules
}
/** Every declaration, in every sheet, whose selector can land on the field. */
function declarationsOn(model, sheets = SHEETS) {
  const out = []
  const written = WRITTEN[model.file] || OWN[model.file] || new Set()
  sheets.forEach(({ file, css: sheet }, f) => {
    for (const x of parsed(sheet)) {
      if (!compoundMatches(x.last, model)) continue
      if (x.context && x.ancestors.some((a) => !a.startsWith('.ui-') && !written.has(a.slice(1)))) continue
      out.push({ file, selector: x.one, context: x.context, spec: x.spec, order: [f, x.r], body: x.body, layer: x.layer })
    }
  })
  return out
}
/** The controls below run the whole scan several times: on a loaded CI
    runner one pass has taken over a second (5s, vitest's default, was not
    enough for five). */
const SCANS = 60000
/** The cascade's order between two declarations of one property: tier
    (`cascadeTier`), then specificity, then load order. */
const cascade = (a, b) => a.tier - b.tier || gt(a.spec, b.spec) || a.order[0] - b.order[0] || a.order[1] - b.order[1]
/** A block's declaration of `prop` that holds: the last, but an !important
    one before any later normal one. */
const declOf = (body, prop) => {
  let v = null
  for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*?)\\s*(?=;|$)`, 'g'))) {
    if (v == null || !importance(v).important || importance(m[1]).important) v = m[1]
  }
  return v
}
/** Context rules that can reach a date field by its classes and that a
    reader has judged never to hold one, each with the reason and the wrapper
    the judgement rests on — which the JSX is checked never to put a date
    field in (review round 2, R2-02's M7). Anything else that pads a date
    field otherwise than its inset fails. */
const JUDGED = {
  '.rb-task-status-cell .rb-task-cell-select': { wrapper: 'rb-task-status-cell', why: 'the Status cell\'s select; the dates sit in their own cells' },
  '.rb-task-cell-editor > .rb-task-cell-select': { wrapper: 'rb-task-cell-editor', why: 'the selects\' caret wrapper; a date field is never inside it' },
  '.rb-budget-status-select[data-dot="true"] > .ui-input': { wrapper: 'rb-budget-status-select', why: 'the Expenses filter\'s status select and its dot; the purchase date is in the expense form' },
}
/** What may be set on a date field's own parts: their look, never their
    place or size — and never `display: none` or `visibility: hidden`, which
    take Tab's stop on the glyph out of the page with the focus on it
    (review round 2, R2-03). */
const PART_LOOK = /^(?:opacity|cursor|filter|color|background(?:-[a-z]+)*|transition(?:-[a-z]+)*|pointer-events|outline(?:-[a-z]+)*|border-radius|color-scheme)$/
const TEXT_SIZES = [...cssCode(css).matchAll(/--text-([a-z0-9]+)\s*:/g)].map((m) => m[1])
/** A class's utility with its variants (`md:`, `data-[x]:`, `[&>i]:`) and its
    important mark (`!` before or after) taken off. */
const bare = (c) => c.replace(/^(?:(?:[\w-]*\[[^\]]*\]|[\w-]+):)+/, '').replace(/^!|!$/g, '')
const PAD_UTILITY = /^(?:p|px|pl|pr|ps|pe)-|^\[padding(?:-left|-right|-inline(?:-start|-end)?)?:/
const MIN_UTILITY = /^min-w-|^\[min-width:/
const SIZE_UTILITY = new RegExp(`^text-(?:${TEXT_SIZES.join('|')})$|^text-\\[(?:\\d|length:|var\\()|^\\[font-size:`)

/** What undoes a date field's floor: the problems, as sentences. */
function problems(models = MODELS, sheets = SHEETS) {
  const out = []
  for (const m of models) {
    if (!m.kind) { out.push(`${m.where}: a date field of no kind the floor knows (declare its --date-inset)`); continue }
    const decls = declarationsOn(m, sheets)
    // 1. The insets: what wins is the inset; no context rule pads it otherwise.
    if (m.kind.kind === 'utility') {
      const pads = m.el.classes.map(bare).filter((c) => PAD_UTILITY.test(c))
      if (pads.join(' ') !== 'px-3') out.push(`${m.where}: padding utilities ${pads.join(' ')}, not the px-3 its inset reads`)
    } else {
      const utils = m.el.classes.filter((c) => PAD_UTILITY.test(bare(c)))
      if (utils.length) out.push(`${m.where}: a padding utility (${utils.join(' ')}) outranks every sheet`)
      for (const prop of Object.keys(m.expect)) {
        const set = decls.map((d) => { const x = insetDeclarations(d.body)[prop]; return x && { ...d, value: x.value, tier: cascadeTier(x.important, d.layer) } }).filter(Boolean)
        const free = set.filter((d) => !d.context).sort(cascade)
        const base = free[free.length - 1]
        const value = base ? base.value : 0
        if (value !== m.expect[prop]) out.push(`${m.where}: ${prop} ${value} by ${base ? `${base.file} \`${base.selector}\`` : 'the reset'}, its inset says ${m.expect[prop]}`)
        for (const d of set) {
          if (!d.context || d.value === m.expect[prop] || Object.hasOwn(JUDGED, d.selector)) continue
          if (base && (d.tier - base.tier || gt(d.spec, base.spec)) < 0) continue
          out.push(`${m.where}: ${d.file} \`${d.selector}\` sets ${prop} ${d.value}, its inset says ${m.expect[prop]}`)
        }
      }
    }
    // 2. The type: the Dense step the room was measured at.
    for (const c of m.el.classes) if (SIZE_UTILITY.test(bare(c)) && bare(c) !== 'text-dense') out.push(`${m.where}: ${c}, not the Dense step`)
    for (const d of decls) {
      for (const p of ['font-size', 'font']) {
        const raw = declOf(d.body, p)
        if (raw == null) continue
        const v = importance(raw).value
        if (p === 'font-size' ? !['var(--text-dense)', '13px'].includes(v) : !/\b(?:13px|var\(--text-dense\))/.test(v)) out.push(`${m.where}: ${d.file} \`${d.selector}\` sets ${p} ${v}, not the Dense step`)
      }
    }
    // 3. The min-width that wins is the floor; nothing inline or utility.
    if (m.el.classes.some((c) => MIN_UTILITY.test(bare(c)))) out.push(`${m.where}: a min-width utility outranks the floor`)
    // An inline style outranks every sheet: read as a literal object, or refused.
    if (/\bstyle=\{(?!\{)/.test(m.el.attrs)) out.push(`${m.where}: a style the scan cannot read (not a literal object)`)
    const style = (m.el.attrs.match(/\bstyle=\{\{([\s\S]*?)\}\}/) || [])[1] || ''
    if (/\bminWidth\s*:/.test(style)) out.push(`${m.where}: an inline minWidth outranks the floor`)
    if (/\bpadding\w*\s*:/.test(style)) out.push(`${m.where}: an inline padding outranks its inset`)
    for (const [, key, value] of style.matchAll(/\b(border(?:Width|Left|Right|LeftWidth|RightWidth|Inline\w*)?)\s*:\s*([^,}]*)/g)) {
      if (!/^['"`]?1px\b/.test(value.trim())) out.push(`${m.where}: an inline ${key} ${value.trim()} outranks its inset`)
    }
    // What wins `prop` on the field: the cascade's top, and the rules of
    // another sheet level with it (between sheets, load order decides).
    const winner = (prop) => {
      const all = decls.map((d) => { const raw = declOf(d.body, prop); if (raw == null) return null; const { value, important } = importance(raw); return { ...d, value, tier: cascadeTier(important, d.layer) } }).filter(Boolean)
      const top = all.reduce((best, d) => (best == null || cascade(d, best) > 0 ? d : best), null)
      return { top, rivals: all.filter((d) => top && d.file !== top.file && d.tier === top.tier && gt(d.spec, top.spec) === 0) }
    }
    const { top, rivals } = winner('min-width')
    if (!top || top.value !== FLOOR_VALUE) out.push(`${m.where}: the min-width that wins is ${top ? `${top.file} \`${top.selector}\` ${top.value}` : 'none'}, not the floor`)
    else if (rivals.some((d) => d.value !== FLOOR_VALUE)) out.push(`${m.where}: ${rivals.map((d) => `${d.file} \`${d.selector}\``).join(' and ')} tie with the floor (load order decides)`)
    // 4. Its own --date-inset, as the cascade picks it, is its inset (review
    //    round 2, R2-02's M3b: `--date-inset: 0` on the field took 18px).
    const inset = winner('--date-inset')
    if (!inset.top || inset.top.value !== `${m.kind.inset}px`) out.push(`${m.where}: --date-inset ${inset.top ? `${inset.top.value} by ${inset.top.file} \`${inset.top.selector}\`` : 'unset'}, its inset is ${m.kind.inset}px`)
    else if (inset.rivals.some((d) => d.value !== inset.top.value)) out.push(`${m.where}: ${inset.rivals.map((d) => `${d.file} \`${d.selector}\``).join(' and ')} tie on --date-inset (load order decides)`)
    // 5. Its parts: their look only (M8: a margin on the glyph hid the date).
    for (const r of datePartRules(sheets.map((s) => s.css), m)) {
      for (const p of r.props) {
        if (p === 'display' ? /(?:^|;)\s*display\s*:\s*none/.test(r.body) : p === 'visibility' ? /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)/.test(r.body) : !PART_LOOK.test(p)) {
          out.push(`${m.where}: \`${r.selector}\` sets ${p} on the date's ${r.part}`)
        }
      }
    }
  }
  return out
}

/** Where the floor's two custom properties are declared, against where they
    may be: --date-room once, in index.css's @theme (a second anywhere —
    inherited by every field under it — changes the room unseen, R2-02's
    M3); --date-inset only directly in the components layer, never in a
    condition (M4, M5); neither in a style the JSX writes. */
function customPropertyProblems(sheets = SHEETS, sources = SOURCES) {
  const out = []
  for (const { file, css: sheet } of sheets) {
    const code = cssCode(sheet)
    const rooms = [...code.matchAll(/--date-room\s*:/g)].length
    if (file === 'index.css') {
      if (rooms !== 1 || !/@theme[^{]*\{[^}]*--date-room\s*:/.test(code)) out.push(`${file}: --date-room declared ${rooms} times, not once in @theme`)
    } else if (rooms) out.push(`${file}: declares --date-room`)
    for (const r of rulesWithContext(sheet)) {
      if (!/(?:^|;)\s*--date-inset\s*:/.test(r.body)) continue
      if (r.at.join(' > ') !== '@layer components') out.push(`${file}: \`${r.sel}\` declares --date-inset inside ${r.at.join(' > ') || 'no layer'}`)
    }
  }
  for (const { file, src } of sources) if (/--date-(?:room|inset)/.test(jsCode(src))) out.push(`${file}: a style sets --date-room or --date-inset`)
  return out
}
/** A date field the JSX puts inside a wrapper a JUDGED rule rests on. */
function judgedWrapperProblems(sources = SOURCES) {
  const wrappers = Object.values(JUDGED).map((j) => j.wrapper)
  const out = []
  for (const { file, src } of sources) {
    for (const t of jsxNesting(normal(jsCode(src)))) {
      if (!isDate({ attrs: t.text })) continue
      for (const a of t.ancestors) {
        const m = a.match(/\sclassName=(?:"([^"]*)"|\{`([^`]*)`\})/) || []
        const words = (m[1] ?? m[2] ?? '').split(/\s+/)
        for (const w of wrappers) if (words.includes(w)) out.push(`${file}: a date field inside .${w}`)
      }
    }
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
  }, SCANS)

  it('--date-room is declared once, in @theme; every --date-inset sits directly in the components layer; no style the JSX writes sets either', () => {
    expect(customPropertyProblems()).toEqual([])
  })

  it('what can be around a field is read from the JSX: its file, and the elements around each place a file renders it (R2-02\'s M1c, M11)', () => {
    // The level window renders RelationsPanel's form inside `.rb-ent-detail-task`.
    expect(WRITTEN['tools/rabbit_v0.1.0/components/RelationsPanel.jsx'].has('rb-ent-detail-task')).toBe(true)
    // The Tasks table's own wrappers, which a hand-listed set had missed.
    for (const c of ['rb-task-view', 'rb-task-body']) expect(WRITTEN['tools/rabbit_v0.1.0/views/ProjectTasksView.jsx'].has(c), c).toBe(true)
    // …and what is never around them: O.T.T.E.R.'s lesson tables, the Files tab's.
    for (const f of ['ProjectTasksView.jsx', 'ProjectAssetsView.jsx', 'ScenesView.jsx']) {
      for (const c of ['lesson-content', 'rb-fm-root', 'rb-files-frame']) expect(WRITTEN[`tools/rabbit_v0.1.0/views/${f}`].has(c), `${f} near .${c}`).toBe(false)
    }
    expect(classesOf('<Td className="rb-x">')).toEqual(['rb-x', 'ui-td'])
  })

  it('no date field sits inside a wrapper a judged rule rests on, and the JSX reader knows what holds what', () => {
    expect(judgedWrapperProblems()).toEqual([])
    const tree = jsxNesting('<div className="a">{x && <span><input type="date" /></span>}<p>a<b>b</b></p></div>')
    expect(tree.find((t) => t.tag === 'input').ancestors).toEqual(['<div className="a">', '<span>'])
    expect(tree.find((t) => t.tag === 'p').ancestors).toEqual(['<div className="a">'])
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
  }, SCANS)

  it('CONTROL: a context rule that pads or resizes a date field, in any lane, is caught (round 1\'s P01, P02b, P14)', () => {
    const add = (file, rule) => SHEETS.map((s) => (s.file.endsWith(file) ? { ...s, css: `${s.css}\n${rule}` } : s))
    expect(problems(MODELS, add('rabbitTasks.css', '.rb-task-row .rb-task-cell-date { padding-right: 20px; }')).some((p) => /padding-right 20/.test(p))).toBe(true)
    expect(problems(MODELS, add('rabbitScenes.css', '.rb-scene-table-wrap .rb-scene-table .ui-input[data-size="sm"] { padding: 0 16px; }')).some((p) => /ScenesView.*padding-left 16/.test(p))).toBe(true)
    expect(problems(MODELS, add('rabbitTasks.css', '.rb-task-row .rb-task-cell-date { font-size: var(--text-body); }')).some((p) => /font-size var\(--text-body\)/.test(p))).toBe(true)
    expect(problems(MODELS, add('index.css', '.ui-input[data-size="sm"] { padding: 0 10px; }')).some((p) => /padding-left 10/.test(p))).toBe(true)
    // …and a rule in another lane's sheet whose ancestor that lane alone writes is not.
    expect(problems(MODELS, add('dashboard.css', '.dash-note-meta > .ui-input.rb-task-date-input { padding: 0 2px; }'))).toEqual([])
  }, SCANS)

  it('CONTROL: an !important rule, or one outside every layer, outranks any specificity, and is caught', () => {
    const add = (file, rule) => SHEETS.map((s) => (s.file.endsWith(file) ? { ...s, css: `${s.css}\n${rule}` } : s))
    const layer = (rule) => `@layer components {\n  ${rule}\n}`
    // A class alone, (0,1,0) under the floor's (0,1,1): in the layer it loses…
    expect(problems(MODELS, add('rabbitTasks.css', layer('.rb-task-cell-date { min-width: 0; }'))).filter((p) => /not the floor/.test(p))).toEqual([])
    // …important, it wins; outside every layer, it wins.
    expect(problems(MODELS, add('rabbitTasks.css', layer('.rb-task-cell-date { min-width: 0 !important; }'))).some((p) => /rb-task-cell-date` 0, not the floor/.test(p))).toBe(true)
    expect(problems(MODELS, add('rabbitTasks.css', '.rb-task-cell-date { min-width: 0; }')).some((p) => /rb-task-cell-date` 0, not the floor/.test(p))).toBe(true)
    // A padding the same way.
    expect(problems(MODELS, add('rabbitTasks.css', layer('.rb-task-cell-date { padding-right: 6px; }')))).toEqual([])
    expect(problems(MODELS, add('rabbitTasks.css', layer('.rb-task-cell-date { padding-right: 2px !important; }'))).some((p) => /padding-right 2 by \S*rabbitTasks\.css `\.rb-task-cell-date`/.test(p))).toBe(true)
    // Within one block an important declaration holds against a later normal one.
    expect(insetDeclarations('padding: 0 8px !important; padding-left: 4px')['padding-left']).toEqual({ value: 8, important: true })
    expect(declOf('min-width: 0 !important; min-width: 140px', 'min-width')).toBe('0 !important')
    expect(importance('0 ! important')).toEqual({ value: '0', important: true })
    // Where each rule sits.
    expect(rulesWithContext('.a { x: 1 } @layer components { @media (min-width: 1px) { .b { y: 2 } } }').map((r) => [r.sel, r.layer, r.at.length])).toEqual([['.a', null, 0], ['.b', 'components', 2]])
  }, SCANS)

  it('CONTROL: round 2\'s ways through are caught — a parent\'s context, a later layer, a custom property, a condition, a part, `:not()`, `:is()`, a judged wrapper (R2-02)', () => {
    const add = (file, rule) => SHEETS.map((s) => (s.file.endsWith(file) ? { ...s, css: `${s.css}\n${rule}` } : s))
    const layer = (rule, name = 'components') => `@layer ${name} {\n  ${rule}\n}`
    const hit = (sheets, re) => problems(MODELS, sheets).some((p) => re.test(p))
    // M1c: a context written by the component that renders the field.
    expect(hit(add('rabbitFiles.css', layer('.rb-ent-detail-task .rb-rel-task-field.rb-rel-task-date { padding: 0 40px; }')), /RelationsPanel.*padding-left 40/)).toBe(true)
    // M2d, M2e: a later layer, at no specificity.
    expect(hit(add('index.css', layer(':where(.rb-task-cell-date) { padding-right: 20px; }', 'utilities')), /padding-right 20/)).toBe(true)
    expect(hit(add('dashboard.css', layer('.dash-date { min-width: 0; }', 'utilities')), /dash-date.*not the floor/)).toBe(true)
    // M3b: the field's own --date-inset.
    expect(hit(add('rabbitTasks.css', layer('.rb-task-table-wrap .ui-table.rb-task-table .ui-input.rb-task-date-input { --date-inset: 0; }')), /--date-inset 0 by/)).toBe(true)
    // M8: the glyph moved, or taken out of the page.
    expect(hit(add('rabbitScenes.css', layer('.ui-input.rb-scene-date::-webkit-calendar-picker-indicator { margin-inline-start: 40px; }')), /margin-inline-start on the date's ::-webkit-calendar-picker-indicator/)).toBe(true)
    expect(hit(add('rabbitTasks.css', layer('.rb-task-cell-date::-webkit-calendar-picker-indicator { display: none; }')), /sets display on the date's/)).toBe(true)
    // M12: `:not()` on an attribute the field is not known by excludes nothing.
    expect(hit(add('rabbitTasks.css', layer('.rb-task-cell-date.rb-task-cell-select:not([data-empty="true"]) { padding-right: 30px; }')), /padding-right 30/)).toBe(true)
    // M13: a compound with `:is(a, b)` in it is one compound.
    expect(hit(add('rabbitTasks.css', layer('.rb-task-cell-select:is(.rb-task-cell-date, .rb-task-cell-number) { padding-right: 30px; }')), /padding-right 30/)).toBe(true)
    expect(topCompound('.x > .rb-task-cell-select:is(.rb-task-cell-date, .rb-task-cell-number)')).toBe('.rb-task-cell-select:is(.rb-task-cell-date, .rb-task-cell-number)')
    // M3, M4, M5: the custom properties.
    expect(customPropertyProblems(add('rabbitTasks.css', layer('.rb-task-table-wrap .ui-table.rb-task-table { --date-room: 96px; }')))).toEqual(['tools/rabbit_v0.1.0/views/rabbitTasks.css: declares --date-room'])
    const smInMedia = css.replace(`  ${SM} {\n    --date-inset: 18px;\n  }`, `  @media (min-width: 9000px) {\n  ${SM} {\n    --date-inset: 18px;\n  }\n  }`)
    expect(smInMedia).not.toBe(css)
    expect(customPropertyProblems([{ file: 'index.css', css: smInMedia }, ...SHEETS.slice(1)]).some((p) => /inside @layer components > @media/.test(p))).toBe(true)
    expect(customPropertyProblems(add('rabbitFiles.css', layer('@media (min-width: 9000px) { .rb-asset-date { --date-inset: 12px; } }'))).some((p) => /rb-asset-date.*inside/.test(p))).toBe(true)
    expect(customPropertyProblems(SHEETS, [{ file: 'x/Probe.jsx', src: '<td style={{ \'--date-room\': \'96px\' }} />' }])).toHaveLength(1)
    // M7: a date field in a judged wrapper.
    expect(judgedWrapperProblems([{ file: 'x/Probe.jsx', src: '<span className="rb-task-cell-editor"><input type="date" className="rb-task-cell-select rb-task-cell-date" /></span>' }])).toEqual(['x/Probe.jsx: a date field inside .rb-task-cell-editor'])
  }, SCANS)

  it('CONTROL: a field of no known kind, spelled any way, or undone by a utility or an inline style, is caught (round 1\'s P06, P07)', () => {
    const one = (jsx) => modelOf({ file: 'x/Probe.jsx', el: elementsOf(jsx).filter(isDate)[0] })
    expect(problems([one('<input type={\'date\'} className="rb-x-when" />')])[0]).toMatch(/no kind/)
    expect(problems([one('<input type="date" className="w-full px-3 pr-8 text-dense" style={{ border: \'1px solid #44403c\' }} />')]).some((p) => /padding utilities/.test(p))).toBe(true)
    expect(problems([one('<Input type="date" className="min-w-0" />')]).some((p) => /min-width utility/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input text-body" data-size="sm" />')]).some((p) => /text-body/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={{ minWidth: 0 }} />')]).some((p) => /inline minWidth/.test(p))).toBe(true)
    // A utility behind a variant, marked important, or written as an arbitrary value.
    for (const cls of ['md:min-w-0', '!min-w-0', 'min-w-0!', 'min-w-[0]', '[min-width:0]', 'data-[open]:min-w-0']) {
      expect(problems([one(`<input type="date" className="ui-input ${cls}" data-size="sm" />`)]).some((p) => /min-width utility/.test(p)), cls).toBe(true)
    }
    expect(problems([one('<input type="date" className="ui-input md:pr-8" data-size="sm" />')]).some((p) => /padding utility/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input [padding-right:30px]" data-size="sm" />')]).some((p) => /padding utility/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input text-[15px]" data-size="sm" />')]).some((p) => /not the Dense step/.test(p))).toBe(true)
    // An inline style: one the scan cannot read, a padding, a border other than the 1px a well has.
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={dateStyle} />')]).some((p) => /cannot read/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={{ paddingRight: 30 }} />')]).some((p) => /inline padding/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={{ border: \'2px solid red\' }} />')]).some((p) => /inline border '2px/.test(p))).toBe(true)
    expect(problems([one('<input type="date" className="ui-input" data-size="sm" style={{ colorScheme: \'dark\', border: \'1px solid #44403c\' }} />')]).filter((p) => /inline|cannot read/.test(p))).toEqual([])
    // A component the scan does not know, handed type="date".
    expect(problems([one('<InlineCell type="date" value={d} />')])[0]).toMatch(/no kind/)
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
