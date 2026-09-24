// =============================================================================
// rabbitTimeline.css — the guards for lane B3's stylesheet and its two files
// (UI overhaul B3, 2026-09-24): views/TimelineView.jsx and
// components/EditHistoryDrawer.jsx. Pattern: rabbitTasksCss.test.js, whose
// predicates live in rabbitCssGuards.js (moved there by B3 so this file can
// call them without re-running B2's suite, and without re-typing them: T2
// hand-off §5 trap 8), called here with B3's own lane.
//
// Pinned here:
//   1. the sheet's shape: the @layer statement first, every rule inside the
//      one `@layer components` block, every class `rb-tl-` / `rb-hist-` or a
//      kit class, every selector scoped by one of them (a lane class inside
//      `:not()` scopes nothing);
//   2. both files import THIS sheet (the path resolved);
//   3. every lane class declared is written in a className and every one
//      written is declared; TimelineView writes only `rb-tl-`, the drawer
//      only `rb-hist-`;
//   4. every [data-x="v"] a rule matches can be produced on that rule's own
//      element, in its own file, with no operator or flag the scanner cannot
//      read; the bars' tone table keys on exactly the shapes the JSX writes,
//      the states lifecycleState() returns and the statuses barTone() named;
//      the history badge's variant is the very table entry entryActionMeta()
//      returns (the drawer compares by identity), in that entry's colour;
//   5. no rule loses a fight it cannot see: no utility on the same element
//      sets a property a rule sets — a variant utility (`hover:`, `active:`)
//      included, which B1's check does not read and the Timeline shipped —
//      and no rule meets the kit (no element here wears a kit class);
//   6. the extraction holds: B1's scanner finds nothing in either file (the
//      allowlist is empty), no const picks a colour by a condition (the
//      spelling SummaryTile shipped, which B1's scanner can miss in a
//      semicolon-free file), barTone() is gone, and a key date's colour
//      reaches the sheet only as data.
// Every predicate has a CONTROL: a self-contained snippet it must fire on and
// one it must pass, run through the SAME function the assertion uses.
// Pixel identity is not provable here; scripts/timeline-state-shots.mjs is
// the proof (34 states, 1440x900 and 1280x700, before and after).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  cssCode, jsCode, rulesOf, lastCompound, propsOf, indexCss, classStrings, UTILITY_OWNS,
  unreachableAttributeValues, utilityConflicts, weakAgainstKit, inlineStateTernaries,
  normal, selectorsOf, elementsOf, outsideLayer, selectorClasses, strayClasses, unscopedSelectors,
  importedSheet, classesWritten, unreadableAttributes, kitFights, undefinedProperties, readAwayFromSetter,
} from '../rabbitCssGuards.js'
import { ACTION_META, RESTORE_META, entryActionMeta } from '../components/editHistoryFormat'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitTimeline.css')
const sheet = read('rabbitTimeline.css')
/** Lane B3's class prefixes, `rb-tl-` and `rb-hist-`, as the guards' `prefix`. */
const LANE = 'tl|hist'
/** B3's two files, relative to this directory, and the one prefix each writes. */
const FILES = {
  timeline: { file: 'TimelineView.jsx', prefix: 'rb-tl-' },
  history: { file: '../components/EditHistoryDrawer.jsx', prefix: 'rb-hist-' },
}
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file }]) => [k, read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitTimeline.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and both files were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(100)
    expect(source.timeline.length).toBeGreaterThan(100000)
    expect(source.history.length).toBeGreaterThan(5000)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is rb-tl- / rb-hist- or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries a lane class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a late statement, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-tl-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-tl-x {} .rb-tll-ghost {} .rb-task-y {}', LANE)).toEqual(['rb-tll-ghost', 'rb-task-y'])
    expect(strayClasses('.rb-tl-x {} .rb-hist-y {} .ui-btn {}', LANE)).toEqual([])
    expect(unscopedSelectors('.ui-btn { padding: 0 }', LANE)).toEqual(['.ui-btn'])
    expect(unscopedSelectors('.ui-td:not(.rb-tl-x) { padding: 0 }', LANE)).toHaveLength(1)
    expect(unscopedSelectors('.rb-task-x .ui-td { padding: 0 }', LANE)).toHaveLength(1)
    expect(unscopedSelectors('.rb-tl-x .ui-td, .rb-hist-y { padding: 0 }', LANE)).toEqual([])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('both B3 files import THIS sheet', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports rabbitTimeline.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitTimeline.css')).toBe(SHEET)
    })
  }
  it('CONTROL: a path that resolves elsewhere, or a commented-out import, is caught; the right one passes', () => {
    expect(importedSheet(FILES.history.file, "import './rabbitTimeline.css'", 'rabbitTimeline.css')).not.toBe(SHEET)
    expect(importedSheet(FILES.timeline.file, "import '../rabbitTimeline.css'", 'rabbitTimeline.css')).not.toBe(SHEET)
    expect(importedSheet(FILES.timeline.file, "// import './rabbitTimeline.css'", 'rabbitTimeline.css')).toBeNull()
    expect(importedSheet(FILES.history.file, "import '../views/rabbitTimeline.css'", 'rabbitTimeline.css')).toBe(SHEET)
  })
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => /^rb-(tl|hist)-/.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(FILES).flatMap((k) => [...writtenIn(k)]))

describe('every rb-tl- / rb-hist- class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('TimelineView writes only rb-tl- classes, EditHistoryDrawer only rb-hist-', () => {
    for (const [key, { file, prefix }] of Object.entries(FILES)) {
      expect(writtenIn(key).size, file).toBeGreaterThan(0)
      expect([...writtenIn(key)].filter((c) => !c.startsWith(prefix)), file).toEqual([])
    }
  })
  it('CONTROL: a class named in another attribute is not a use; a {\'…\'} className is; another lane\'s class is not B3\'s', () => {
    expect([...classesWritten('<span data-was="rb-tl-x" />', LANE)]).toEqual([])
    expect([...classesWritten("<span className={'rb-tl-x text-dense'} />", LANE)]).toEqual(['rb-tl-x'])
    expect([...classesWritten('<span className="rb-task-x rb-hist-y" />', LANE)]).toEqual(['rb-hist-y'])
  })
})

/* ── 4. attributes ─────────────────────────────────────────────────────────── */
/** The sheet's rules for one prefix, as CSS text: each file answers for its own. */
const rulesFor = (prefix) => rulesOf(sheet)
  .filter(({ sel }) => sel.includes(`.${prefix}`))
  .map(({ sel, body }) => `${sel} {${body}}`).join('\n')
/** The values a `[attr="v"]` takes in the tone table, for one shape or all. */
const toneValues = (attr, shape) => [...new Set(rulesOf(sheet)
  .flatMap(({ sel }) => selectorsOf(sel))
  .filter((s) => s.startsWith('.rb-tl-tone') && (!shape || s.includes(`[data-shape="${shape}"]`)))
  .flatMap((s) => [...s.matchAll(new RegExp(`\\[${attr}="([^"]*)"\\]`, 'g'))].map((m) => m[1])))].sort()
/** What lifecycleState() can return: the one source of data-life. */
const lifecycleReturns = (src) => {
  const body = jsCode(src).match(/function lifecycleState\([^)]*\)\s*\{([\s\S]*?)\n\}/)
  return body ? [...new Set([...body[1].matchAll(/return\s+'([^']+)'/g)].map((m) => m[1]))].sort() : []
}

describe('the sheet keys on values the JSX can produce', () => {
  it('no [data-x="v"] rule waits for a value its own element never gets, in its own file', () => {
    for (const [key, { file, prefix }] of Object.entries(FILES)) {
      expect(rulesFor(prefix).length, file).toBeGreaterThan(0)
      expect(unreachableAttributeValues(rulesFor(prefix), code[key]), file).toEqual([])
    }
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('only plain [data-x="v"] selectors: no operator, flag or non-data attribute', () => {
    expect(unreadableAttributes(sheet, jsx)).toEqual([])
  })
  it('the bars\' tone table: the shapes the JSX writes, every state lifecycleState() returns, the statuses barTone() named', () => {
    expect(toneValues('data-shape')).toEqual(['phase', 'subgroup', 'task'])
    expect(lifecycleReturns(source.timeline)).toEqual(['active', 'completed', 'upcoming'])
    expect(toneValues('data-life', 'subgroup')).toEqual(lifecycleReturns(source.timeline))
    expect(toneValues('data-life', 'task')).toEqual([])
    expect(toneValues('data-life', 'phase')).toEqual([])
    expect(toneValues('data-status', 'task')).toEqual(['approved', 'blocked', 'final', 'in_progress', 'needs_revisions',
      'omitted', 'on_hold', 'pending_review', 'waiting_to_start'])
    expect(toneValues('data-status', 'phase')).toEqual(['active', 'completed', 'delayed'])
    expect(toneValues('data-status', 'subgroup')).toEqual(['completed', 'in_progress', 'on_hold'])
    expect(toneValues('data-critical')).toEqual(['true'])
    // Every shape has its default (no status, no lifecycle): an unset or
    // unrecognised status is painted, never left bare.
    for (const shape of ['phase', 'subgroup', 'task']) {
      const base = rulesOf(sheet).find(({ sel }) => selectorsOf(sel).includes(`.rb-tl-tone[data-shape="${shape}"]`))
      expect(base && propsOf(base.body).sort(), shape).toEqual(['--rb-tl-bg', '--rb-tl-border', '--rb-tl-fg'])
    }
  })
  it('the history badge names its variant by the very table entry entryActionMeta returns, and paints that entry\'s colour', () => {
    // The drawer compares `meta` by identity with ACTION_META / RESTORE_META:
    // were entryActionMeta to return copies, every badge would fall to grey.
    expect(entryActionMeta({ action: 'create', diff: { new: { title: 'x' } } })).toBe(ACTION_META.create)
    expect(entryActionMeta({ action: 'update', diff: { title: { old: 'a', new: 'b' } } })).toBe(ACTION_META.update)
    expect(entryActionMeta({ action: 'delete', diff: { old: { title: 'x' } } })).toBe(ACTION_META.delete)
    expect(entryActionMeta({ action: 'update', diff: { deleted_at: { old: null, new: '2026-09-01' } } })).toBe(ACTION_META.delete)
    expect(entryActionMeta({ action: 'update', diff: { deleted_at: { old: '2026-09-01', new: null } } })).toBe(RESTORE_META)
    // Stage 1 transcribes the table's colours; stage 2 maps them to tokens
    // and rewrites this pin.
    const colourOf = (sel) => (rulesOf(sheet).find((r) => selectorsOf(r.sel).includes(sel))?.body.match(/(?:^|;)\s*color:\s*([^;]+)/) || [])[1]?.trim()
    expect(colourOf('.rb-hist-action[data-action="create"]')).toBe(ACTION_META.create.color)
    expect(colourOf('.rb-hist-action[data-action="update"]')).toBe(ACTION_META.update.color)
    expect(colourOf('.rb-hist-action[data-action="delete"]')).toBe(ACTION_META.delete.color)
    expect(colourOf('.rb-hist-action[data-action="restore"]')).toBe(RESTORE_META.color)
    expect(colourOf('.rb-hist-action')).toBe(entryActionMeta({ action: 'mystery' }).color)
  })
  it('CONTROL: each fires on a value nobody sets, a class nobody wears and an operator; each passes the real shape', () => {
    const src = "<div className=\"rb-tl-x\" data-on={on ? 'true' : 'false'} />"
    expect(unreachableAttributeValues('.rb-tl-x[data-on="yes"] { color: red }', src)).toHaveLength(1)
    expect(unreachableAttributeValues('.rb-tl-y[data-on="true"] { color: red }', src)).toHaveLength(1)
    expect(unreachableAttributeValues('.rb-tl-x[data-on="true"] { color: red }', src)).toEqual([])
    expect(unreadableAttributes('.rb-tl-x[data-on^="t"] {}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-tl-x[data-on] {}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-tl-x[data-on="true"] {}')).toEqual([])
    expect(lifecycleReturns("function lifecycleState(s, e) {\n  if (e) return 'completed'\n  return 'active'\n}")).toEqual(['active', 'completed'])
  })
})

/* ── 5. the cascade ────────────────────────────────────────────────────────── */
/** Which property a utility sets, read AFTER its variant prefixes (`hover:`,
    `active:`, `focus:`, `disabled:`, `group-hover:`, …) are stripped: a
    variant utility sets the same property as its base under its state, and
    under that state it beats any rule here (the utilities layer). B1's
    utilityConflicts reads bare utilities only; the Timeline's label row wore
    a `hover:` fill beside a rule-to-be for its fill (dead in the shipped
    code, where the inline fill beat both). Border colour and border width
    are told apart: a `border-b-2` beside a rule for the colour is no fight. */
const OWNS = [
  ...UTILITY_OWNS.filter(([prop]) => prop !== 'color'),
  ['color', /^text-(?!(?:h[123]|body|dense|caption|label|xs|sm|base|lg|[2-9]?xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$)/],
  ['border-color', /^border-(?!(?:\d+|[xytrbl]|[xytrbl]-\d+|solid|dashed|dotted|double|none|hidden|collapse|separate)$)/],
  ['border-width', /^border(?:-[xytrbl])?(?:-\d+)?$|^border-(?:solid|dashed|dotted|double|none|hidden)$/],
  ['cursor', /^cursor-/],
  ['opacity', /^opacity-/],
  ['rotate', /^-?rotate-/],
  ['left', /^-?(?:left|inset|inset-x)-/],
  ['pointer-events', /^pointer-events-/],
  ['animation', /^animate-/],
  ['outline', /^outline(?:-|$)/],
  ['box-shadow', /^(?:shadow|ring)(?:-|$)/],
  ['transition', /^transition(?:-|$)/],
]
/** The property groups one declaration of a rule touches. */
const touches = (prop) => {
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(prop)) return ['border-color', 'border-width']
  if (/^border(?:-(?:top|right|bottom|left))?-color$/.test(prop)) return ['border-color']
  if (/^border(?:-(?:top|right|bottom|left))?-(?:width|style)$/.test(prop)) return ['border-width']
  if (prop.startsWith('background')) return ['background']
  for (const g of ['outline', 'transition', 'animation', 'padding', 'margin', 'border-radius']) if (prop.startsWith(g)) return [g]
  return [prop]
}
/** Every (lane class, property) where a utility on the element — variant or
    not — sets what a rule for that class sets. */
function variantConflicts(css, src) {
  const rules = rulesOf(css)
  const out = new Set()
  for (const set of classStrings(src)) {
    const utils = set.filter((c) => !/^rb-/.test(c)).map((c) => c.replace(/^(?:[a-z0-9-]+:)+/, ''))
    for (const lane of set.filter((c) => /^rb-/.test(c))) {
      for (const { sel, body } of rules) {
        if (!selectorsOf(sel).some((one) => new RegExp(`\\.${lane}(?![\\w-])`).test(lastCompound(one)))) continue
        const groups = new Set(propsOf(body).filter((p) => !p.startsWith('--')).flatMap(touches))
        for (const [prop, re] of OWNS) {
          const owners = utils.filter((u) => re.test(u))
          if (owners.length && groups.has(prop)) out.add(`${lane}: ${prop} vs ${owners.join(' ')}`)
        }
      }
    }
  }
  return [...out]
}

describe('no rule loses a fight it cannot see', () => {
  it('no utility on an element sets a property its lane rule sets (B1\'s check)', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('…nor a variant utility (hover:, active:, focus:, disabled:), nor a colour, cursor, opacity, border, outline, shadow, transition or animation utility', () => {
    expect(variantConflicts(sheet, jsx)).toEqual([])
  })
  it('no rule meets the kit: no element here wears a kit class, and neither B1\'s check nor B2\'s stricter one finds a fight', () => {
    expect(ELEMENTS.filter((e) => e.kit.length && e.classes.some((c) => /^rb-(tl|hist)-/.test(c))).map((e) => e.attrs.slice(0, 60))).toEqual([])
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
    expect(kitFights(sheet, indexCss, ELEMENTS, LANE)).toEqual([])
  })
  it('the history icons turn on the kit\'s own `ui-spin`, which is the turn Tailwind\'s `spin` was', () => {
    expect(cssCode(sheet)).toMatch(/\.rb-hist-spin\[data-spinning="true"\]\s*\{\s*animation:\s*ui-spin 1s linear infinite;\s*\}/)
    expect(cssCode(indexCss)).toMatch(/@keyframes ui-spin\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}\s*\}/)
  })
  it('CONTROL: each fires on the fight it names, and passes a rule that sets another property', () => {
    // B1's: a bare utility for the same property.
    expect(utilityConflicts('.rb-tl-x { background-color: red }', '<div className="bg-stone-800 rb-tl-x" />')).toHaveLength(1)
    expect(utilityConflicts('.rb-tl-x { color: red }', '<div className="bg-stone-800 rb-tl-x" />')).toEqual([])
    // B3's: the label row's shipped shape, a variant cursor, a palette ink, a border colour.
    expect(variantConflicts('.rb-tl-x { background-color: transparent }', '<div className="relative hover:bg-stone-800/50 rb-tl-x" />')).toHaveLength(1)
    expect(variantConflicts('.rb-tl-x { cursor: grab }', '<div className="active:cursor-grabbing rb-tl-x" />')).toHaveLength(1)
    expect(variantConflicts('.rb-tl-x { color: red }', '<div className="text-stone-500 rb-tl-x" />')).toHaveLength(1)
    expect(variantConflicts('.rb-tl-x { border-color: red }', '<div className="focus:border-orange-500 rb-tl-x" />')).toHaveLength(1)
    expect(variantConflicts('.rb-tl-x { border: 1px solid red }', '<div className="border-b-2 rb-tl-x" />')).toHaveLength(1)
    expect(variantConflicts('.rb-tl-x { color: red }', '<div className="hover:bg-stone-800 text-dense text-left rb-tl-x" />')).toEqual([])
    expect(variantConflicts('.rb-tl-x { border-color: red }', '<div className="border-b-2 rb-tl-x" />')).toEqual([])
    expect(variantConflicts('.rb-tl-x[data-on="true"] > .rb-tl-y { left: 1px }', '<span className="top-1 bg-stone-500 rb-tl-y" />')).toEqual([])
    // The kit: a lane rule on a kit element at the kit's own weight.
    expect(weakAgainstKit('.rb-tl-x { padding: 0 }', '<button className="ui-btn rb-tl-x" />').join('\n')).toMatch(/ties or loses/)
    expect(kitFights('.rb-tl-x { padding: 0 }', indexCss, elementsOf('<Button className="rb-tl-x" />'), LANE).join('\n')).toMatch(/ties or loses to \.ui-btn/)
    expect(kitFights('.rb-tl-x { padding: 0 }', indexCss, elementsOf('<div className="rb-tl-x" />'), LANE)).toEqual([])
  })
})

/* ── 6. the extraction holds ───────────────────────────────────────────────── */
/** B1's scanner's hits each file may keep, one comment per entry. None: every
    remaining inline style is geometry (left / top / width / height from dates
    and pixels, a shape's offsets included) or static, and a key date's own
    colour travels as `--rb-tl-ms`, which the scanner does not read as state. */
const ALLOWED = { timeline: [], history: [] }
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|var\(--color-/
/** Every `const` whose value picks between colours by a ternary — on its
    line, or on the `?` / `:` lines that continue it. B1's scanner reads such
    a const as state only when its own lazy match starts at that const; in a
    semicolon-free file an earlier const's match can run past it, which is
    how SummaryTile's danger palette was never reported. (Not exported:
    importing a test file runs its suite in the importer.) */
function conditionalColourConsts(src) {
  const lines = jsCode(src).split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:const|let|var)\s+(\w+)\s*=\s*(.*)$/)
    if (!m) continue
    let text = m[2]
    for (let j = i + 1; j < lines.length && (/^\s*[?:]/.test(lines[j]) || /[?:]\s*$/.test(lines[j - 1])); j++) text += `\n${lines[j]}`
    if (/(?<!\?)\?(?![.?])/.test(text) && COLOUR.test(text)) out.push(m[1])
  }
  return out
}

describe('the state extraction holds in both B3 files', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file}: B1's scanner finds no state decided in a style or a className`, () => {
      expect(inlineStateTernaries(source[key])).toEqual(ALLOWED[key])
    })
    it(`${file}: no const picks a colour by a condition`, () => {
      expect(conditionalColourConsts(source[key])).toEqual([])
    })
  }
  it('barTone() is gone: the bars\' palette is the sheet\'s alone', () => {
    expect(jsCode(source.timeline)).not.toMatch(/\bfunction\s+barTone\b|\bbarTone\s*\(/)
    expect(jsCode(source.timeline)).not.toMatch(/\btone\.(?:bg|border|fg)\b/)
  })
  it('a key date\'s colour reaches the sheet only as data: set once from the key date, read where it is set, with the amber fallback', () => {
    const setters = [...code.timeline.matchAll(/'--rb-tl-ms'\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
    expect(setters).toEqual(['hoverPopup.row.milestone?.color'])
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
    const reads = [...cssCode(sheet).matchAll(/var\(\s*--rb-tl-ms\s*(,[^)]*)?\)/g)].map((m) => (m[1] || '').replace(/^,\s*/, ''))
    expect(reads.length).toBeGreaterThan(0)
    expect(new Set(reads)).toEqual(new Set(['#f59e0b']))
    // Stage 1 reads no variable but its own: a Tailwind palette variable
    // disappears with the last utility that uses it.
    const vars = [...new Set([...cssCode(sheet).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))].sort()
    expect(vars).toEqual(['--rb-tl-bg', '--rb-tl-border', '--rb-tl-fg', '--rb-tl-ms'])
  })
  it('CONTROL: B1\'s scanner fires on the shapes these files shipped and passes the shapes they ship now', () => {
    const fires = [
      "<div style={{ left: tick.offset * dayPx, borderLeft: tick.major ? '1px solid #44403c' : '1px solid #292524' }} />",
      "<div style={{ backgroundColor: isReparentHoverDz ? '#7c2d12' : (isDzHover && canWrite ? 'rgba(234, 88, 12, 0.06)' : 'transparent') }} />",
      "<div className={`relative flex items-center transition-colors ${canWrite ? 'cursor-pointer' : 'cursor-not-allowed'}`} />",
      "<div style={{ backgroundColor: tone.bg, border: isPhase ? `2px solid ${tone.border}` : `1px solid ${tone.border}` }} />",
      "<Diamond style={{ color: hoverPopup.row.milestone?.color || '#f59e0b' }} />",
      "<RefreshCw className={`w-3.5 h-3.5${loading ? ' animate-spin' : ''}`} />",
      "<div className={toolsLocked ? 'opacity-60 pointer-events-none' : ''} />",
      "<div style={{ width: EDGE_GRAB_PX, cursor: canWrite ? 'ew-resize' : 'inherit' }} />",
    ]
    for (const snippet of fires) expect(inlineStateTernaries(snippet), snippet).not.toEqual([])
    const passes = [
      "<div className=\"rb-tl-ov-tick\" data-major={tick.major ? 'true' : 'false'} style={{ left: tick.offset * dayPx }} />",
      "<div className=\"rb-tl-pop\" data-kind={k === 'milestone' ? 'milestone' : 'phase'} style={{ left: x + 14, '--rb-tl-ms': hoverPopup.row.milestone?.color }} />",
      "<div className=\"rb-tl-bar\" style={{ left, width, top: subgroupStyle ? 4 : (phaseStyle ? 3 : 5) }} />",
      "<RefreshCw className=\"w-3.5 h-3.5 rb-hist-spin\" data-spinning={loading ? 'true' : 'false'} />",
    ]
    for (const snippet of passes) expect(inlineStateTernaries(snippet), snippet).toEqual([])
  })
  it('CONTROL: conditionalColourConsts fires on the palette SummaryTile shipped and on a one-line ternary, and passes a data default', () => {
    const tile = "function SummaryTile({ tone }) {\n  const colors = tone === 'danger'\n    ? { value: '#fca5a5', icon: '#ef4444' }\n    : { value: '#fb923c', icon: '#57534e' }\n  return null\n}"
    expect(conditionalColourConsts(tile)).toEqual(['colors'])
    expect(conditionalColourConsts("const ink = active ? 'var(--color-ink)' : 'var(--color-ink-3)'")).toEqual(['ink'])
    expect(conditionalColourConsts("const c = on ?\n  'rgba(0, 0, 0, 0.5)' :\n  'transparent'")).toEqual(['c'])
    expect(conditionalColourConsts("const msColor = ms.color || '#f59e0b'")).toEqual([])
    expect(conditionalColourConsts("const label = on ? 'On' : 'Off'")).toEqual([])
    expect(conditionalColourConsts("const d = draft.description?.trim() || '#none'")).toEqual([])
  })
})
