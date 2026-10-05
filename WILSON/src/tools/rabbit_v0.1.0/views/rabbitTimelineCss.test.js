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
//      and no rule meets the kit where source order would decide it (four
//      lane classes sit on kit roots, and kitFights measures each);
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
  colourLiterals,
} from '../rabbitCssGuards.js'
import { ACTION_META, RESTORE_META, entryActionMeta } from '../components/editHistoryFormat'
import { THEME } from '../../../ui/tokens.js'

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
    // Stage 1 transcribed the table's colours; stage 2 (B3c) maps each to a
    // token: created and restored the success ink (the same #4ade80 the
    // table names), deleted the danger ink (the same #fca5a5), edited — the
    // common case — ink-2 (it was the orange), anything else ink-3.
    const colourOf = (sel) => (rulesOf(sheet).find((r) => selectorsOf(r.sel).includes(sel))?.body.match(/(?:^|;)\s*color:\s*([^;]+)/) || [])[1]?.trim()
    expect(colourOf('.rb-hist-action[data-action="create"]')).toBe('var(--color-success)')
    expect(colourOf('.rb-hist-action[data-action="update"]')).toBe('var(--color-ink-2)')
    expect(colourOf('.rb-hist-action[data-action="delete"]')).toBe('var(--color-danger)')
    expect(colourOf('.rb-hist-action[data-action="restore"]')).toBe('var(--color-success)')
    expect(colourOf('.rb-hist-action')).toBe('var(--color-ink-3)')
    // The tokens are the hexes the table used to name (P1-66 deleted its
    // unread `color` fields; the values stay pinned here).
    expect(THEME['color-success']).toBe('#4ade80')
    expect(THEME['color-danger']).toBe('#fca5a5')
    expect(Object.values({ ...ACTION_META, restore: RESTORE_META }).some((m) => 'color' in m)).toBe(false)
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
  it('no rule meets the kit: a lane class sits on four kit roots only, and neither B1\'s check nor B2\'s stricter one finds a fight', () => {
    // "No element here wears a kit class" held only while the shared guard
    // knew eight kit roots: since B4c's review round one it knows every one
    // lane B4 uses, and these four are the Timeline's (the settings Drawer,
    // its Tabs, the lock bar's Toolbar, the Help Dialog). kitFights measures
    // each of them now, and finds nothing.
    expect(ELEMENTS.filter((e) => e.kit.length && e.classes.some((c) => /^rb-(tl|hist)-/.test(c))).map((e) => `${e.tag} ${e.classes.join(' ')}`))
      .toEqual(['Drawer rb-tl-settings', 'Tabs rb-tl-set-tabs', 'Toolbar rb-tl-lock-bar', 'Dialog rb-tl-help'])
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
  it('a key date\'s colour reaches the sheet only as data: set from the key date on the element that reads it, with the warning-amber fallback', () => {
    // Stage 1 had one setter, the hover card. B3b's minimap sets it on the key
    // date's line and on its diamond as well (they were inline hex before);
    // readAwayFromSetter below holds each read to a rule that names its
    // setter's own class.
    // B3c: the gantt's key-date line and diamond set it too (they were an
    // inline hex with a glow), after the minimap's and the hover card's.
    const setters = [...code.timeline.matchAll(/'--rb-tl-ms'\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
    expect(setters).toEqual(['ms.color', 'ms.color', 'hoverPopup.row.milestone?.color', 'ms.color', 'ms.color'])
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
    // The fallback is a token now, the warning ink — the same amber (#f59e0b)
    // a key date without a colour always had.
    const reads = [...cssCode(sheet).matchAll(/var\(\s*--rb-tl-ms\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g)].map((m) => (m[1] || '').trim())
    expect(reads.length).toBeGreaterThan(0)
    expect(new Set(reads)).toEqual(new Set(['var(--color-warning)']))
    expect(THEME['color-warning']).toBe('#f59e0b')
    // Stage 2 reads its own properties and the kit's tokens, nothing else: a
    // Tailwind palette variable disappears with the last utility that uses it.
    const vars = [...new Set([...cssCode(sheet).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))].sort()
    expect(vars.filter((v) => !/^--rb-(tl|hist)-/.test(v) && !(v.slice(2) in THEME))).toEqual([])
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

/* ── 7. stage 2, surface by surface (B3b) ──────────────────────────────────── */
/** The sheet cut at its `═══` section banners; each piece keeps its banner. */
const sectionsOf = (css) => css.split(/(?=\/\* ═══)/).slice(1).map((s) => ({ banner: s.split('\n')[0], body: s }))
describe('stage 2: a section on tokens writes no colour literal', () => {
  it('every section whose banner says "stage 2" has every colour as a token or a screen of one', () => {
    const staged = sectionsOf(sheet).filter((s) => /stage 2/i.test(s.banner))
    expect(staged.length).toBeGreaterThan(0)
    for (const s of staged) expect(colourLiterals(s.body), s.banner).toEqual([])
  })
  it('CONTROL: a stage-2 section with a hex, an rgba() or a named colour fires; tokens and a screen of the ink pass', () => {
    const fake = (decl) => sectionsOf(`/* the header */\n/* ═══ x — stage 2 ═══ */\n.rb-tl-x { ${decl} }\n`)[0].body
    expect(colourLiterals(fake('color: #fb923c;'))).toHaveLength(1)
    expect(colourLiterals(fake('color: rgba(0, 0, 0, 0.5);'))).toHaveLength(1)
    expect(colourLiterals(fake('color: white;'))).toHaveLength(1)
    expect(colourLiterals(fake('color: var(--color-ink); border-color: color-mix(in srgb, var(--color-ink) 6%, transparent);'))).toEqual([])
  })
})

/* ── 8. the minimap (B3b, Q22) ────────────────────────────────────────────── */
describe('the minimap zoom slider: the snap marks are placed from the thumb the sheet draws', () => {
  it('SPAN_THUMB_W is the thumb width the sheet gives both engines, and the marks are placed from it on a SPAN_TRACK_W track', () => {
    const w = Number(code.timeline.match(/const SPAN_THUMB_W = (\d+)/)?.[1])
    expect(w).toBeGreaterThan(0)
    for (const pseudo of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      const rule = rulesOf(sheet).find(({ sel }) => sel.trim() === `.rb-tl-span-range${pseudo}`)
      expect(rule?.body, pseudo).toMatch(new RegExp(`(?:^|;)\\s*width:\\s*${w}px`))
    }
    expect(code.timeline).toMatch(/snapLeft\(s, minimapMinDays, minimapMaxDays, SPAN_TRACK_W, SPAN_THUMB_W\)/)
    expect(code.timeline).toMatch(/style=\{\{ width: SPAN_TRACK_W, height: 22 \}\}/)
  })
})

/* ── 9. the legend and the links (B3c) ────────────────────────────────────── */
/** The legend's tone swatches, as TimelineLegend's table writes them. */
const legendTones = (src) => {
  const table = src.match(/const LEGEND_TONES = \[([\s\S]*?)\n\]/)
  return table
    ? [...table[1].matchAll(/shape: '(\w+)',\s*status: (?:'(\w+)'|undefined),\s*critical: '(true|false)'/g)]
        .map(([, shape, status, critical]) => ({ shape, status, critical }))
    : []
}
/** Rules that set a stroke: a CSS stroke beats an SVG attribute. */
const strokeRules = (css) => rulesOf(css).filter(({ body }) => /(?:^|;)\s*stroke(?:-dasharray)?\s*:/.test(body)).map((r) => r.sel.trim())

describe('the legend reads the bars\' own tone rules, and a link keeps its colour in the JSX', () => {
  it('every legend swatch names a shape, a status and a critical flag the tone table paints (no status: the shape\'s default)', () => {
    const tones = legendTones(source.timeline)
    expect(tones).toHaveLength(8)
    for (const { shape, status, critical } of tones) {
      expect(toneValues('data-shape'), shape).toContain(shape)
      if (status) expect(toneValues('data-status', shape), `${shape} ${status}`).toContain(status)
      if (critical === 'true') expect(toneValues('data-critical')).toContain('true')
    }
    // The swatch wears the tone class itself, so it reads the very rules a bar does.
    expect(code.timeline).toMatch(/className="rounded-control rb-tl-tone rb-tl-legend-swatch"/)
  })
  it('no rule sets a stroke: a link\'s colour and dash are keyed on its kind in DependencyOverlay', () => {
    expect(strokeRules(sheet)).toEqual([])
    expect(code.timeline).toMatch(/strokeDasharray=\{DASH_BY_KIND\[e\.kind\]\}/)
    expect(code.timeline).toMatch(/const DASH_BY_KIND = \{ phase: '5 3', task: undefined \}/)
  })
  it('CONTROL: a swatch naming a status nobody paints fails; a stroke rule is found', () => {
    const fake = "const LEGEND_TONES = [\n  { key: 'x', label: 'X', shape: 'task', status: 'mystery', critical: 'false', title: 'x' },\n]"
    const [t] = legendTones(fake)
    expect(t).toEqual({ shape: 'task', status: 'mystery', critical: 'false' })
    expect(toneValues('data-status', 'task')).not.toContain(t.status)
    expect(strokeRules('@layer components { .rb-tl-dep { stroke: var(--color-ink-2); } }')).toEqual(['.rb-tl-dep'])
    expect(strokeRules('@layer components { .rb-tl-dep { cursor: pointer; } }')).toEqual([])
  })
})

/* ── 10. W9: the five confirms on the kit Dialog (B3c) ────────────────────── */
/** A native confirm, called bare or on window, in comment-stripped code. */
const nativeConfirms = (src) => (normal(jsCode(src)).match(/(?:^|[^\w.])(?:window\.)?confirm\(/g) || []).length

describe('W9: no native confirm is left, and each question asks on the kit Dialog in its old words', () => {
  it('neither B3 file calls confirm()', () => {
    expect(nativeConfirms(source.timeline)).toBe(0)
    expect(nativeConfirms(source.history)).toBe(0)
  })
  it('"Remove this dependency?" is still asked only inside the write gate, and the answer is checked against it again', () => {
    expect(code.timeline).toMatch(/if \(!canWrite\) return\s*onAskUnlink\?\.\(e\.id\)/)
    expect(code.timeline).toMatch(/onAskUnlink=\{canWrite \? setAskUnlinkId : null\}/)
    expect(code.timeline).toMatch(/if \(canWrite\) onUnlinkDependency\?\.\(id\)/)
    expect(code.timeline).toMatch(/title="Remove this dependency\?"/)
  })
  it('the task editor\'s four delete questions keep the old confirms\' words (the question as the title, the second sentence as the body)', () => {
    for (const words of ['Delete this milestone?', 'Delete this asset?', 'Tasks linked to it will lose their asset reference.',
      'Delete this phase?', 'Tasks linked to it will become orphans.', 'Delete this task?']) {
      expect(source.timeline, words).toContain(`'${words}'`)
    }
    expect(code.timeline).toMatch(/<Dialog\s+width="confirm"\s+title=\{askDelete\.title\}/)
  })
  it('CONTROL: a bare or a window confirm is counted; a method named confirm on another object is not', () => {
    expect(nativeConfirms("if (confirm('x')) go()")).toBe(1)
    expect(nativeConfirms("if (window.confirm('x')) go()")).toBe(1)
    expect(nativeConfirms("dialog.confirm('x'); const confirmed = 1")).toBe(0)
  })
})

/* ── 11. SettingsPanel on the kit (B3d) ───────────────────────────────────── */
/** TimelineView's raw source from one marker to the next. */
const between = (src, from, to) => {
  const i = src.indexOf(from)
  const j = i < 0 ? -1 : src.indexOf(to, i + from.length)
  if (i < 0 || j < 0) throw new Error(`no slice from "${from}" to "${to}"`)
  return src.slice(i, j)
}
const PANEL = between(source.timeline, 'export function SettingsPanel(', 'export function HelpModal(')
const PANEL_CODE = normal(jsCode(PANEL))
const HOLIDAYS = between(source.timeline, 'function HolidaysEditor(', 'const SETTINGS_PANEL_ID')
const SETTINGS_TAB = between(PANEL, "settingsTab === 'settings' &&", "settingsTab === 'prompts' &&")
const PROMPTS_TAB = between(PANEL, "settingsTab === 'prompts' &&", '</Drawer>')
/** Every control of a slice — any button, input, select or textarea, native
    or the kit's. Two named exceptions: the hidden file input (the locked
    Import button opens it) and a prompt section's head, which opens and
    closes while locked, as it did. */
const KIT_CONTROLS = new Set(['Switch', 'Button', 'IconButton', 'Input', 'TextArea', 'Select'])
const NATIVE_CONTROLS = new Set(['button', 'input', 'select', 'textarea'])
const controlsOf = (src) => elementsOf(src)
  .filter((e) => KIT_CONTROLS.has(e.tag) || NATIVE_CONTROLS.has(e.tag))
  .filter((e) => !(e.tag === 'input' && /\stype="file"/.test(e.attrs)))
  .filter((e) => !e.classes.includes('rb-tl-prompt-head'))
/** …those that do not carry the lock as their one `disabled`. */
const unlocked = (src, lock) => controlsOf(src)
  .filter((e) => !new RegExp(`\\sdisabled=\\{${lock}\\}`).test(e.attrs) || (e.attrs.match(/\sdisabled=/g) || []).length > 1)
  .map((e) => e.attrs.slice(0, 60))
/** The component tags a slice renders, counted (round two: a control moved
    into a const, or behind a wrapper component, escaped `unlocked`). */
const componentsOf = (src) => elementsOf(src).filter((e) => /^[A-Z]/.test(e.tag))
  .reduce((m, e) => ({ ...m, [e.tag]: (m[e.tag] || 0) + 1 }), {})
/** The props of the one <Drawer> in a slice, read off its opening tag in any order. */
const drawerProps = (src) => {
  const d = elementsOf(src).filter((e) => e.tag === 'Drawer')
  if (d.length !== 1) throw new Error(`expected one <Drawer>, found ${d.length}`)
  const a = d[0].attrs
  const has = (p) => new RegExp(`\\s${p}(?=[\\s/>])`).test(a) || new RegExp(`\\s${p}=\\{true\\}`).test(a)
  return {
    open: has('open'),
    backdrop: has('backdrop'),
    onClose: /\sonClose=\{onClose\}/.test(a),
    // Nothing on the tag may move it: no style, no utility, the lane class alone.
    bare: /\sclassName="rb-tl-settings"/.test(a) && !/\sstyle=/.test(a),
  }
}
/** A title bar measured by hand, a scrim of its own, or a fixed box. */
const HAND_ROLLED_CHROME = /electronAPI|wilsonSession|electron-app|padding-?top|paddingTop|\bfixed\b|\binset-|\b(?:top|right|bottom|left)-0\b|slideInRight/i
/** Selectors that land on the drawer itself and set what would move it off
    the title bar's offset (`top: var(--titlebar-offset)` is the kit's), the
    token included (round two: `--titlebar-offset: 0px` moved it 32 -> 0). */
const OFFSET_PROP = /(?:^|[;{\s])(?:--titlebar-offset|top|inset|inset-block(?:-start)?|margin(?:-top|-block(?:-start)?)?|padding(?:-top|-block(?:-start)?)?|transform|translate)\s*:/
const offsetFights = (css) => rulesOf(css).flatMap(({ sel, body }) => (OFFSET_PROP.test(body)
  ? selectorsOf(sel).filter((s) => /\.rb-tl-settings(?![\w-])/.test(lastCompound(s)))
  : []))
/** Every rule keyed on a lock or on `:disabled` that dims by opacity, a
    filter, visibility or a mix into transparent (round two's spellings). */
const DIM = /(?:^|[;{\s])(?:opacity|filter|visibility)\s*:|color-mix\([^;]*\btransparent\b/
const opacityLocks = (css) => rulesOf(css)
  .filter(({ sel, body }) => /\[data-locked=|:disabled/.test(sel) && DIM.test(body))
  .map(({ sel }) => sel)

describe('SettingsPanel on the kit (B3d): the Drawer holds the title bar, the lock disables, the manager sits beside', () => {
  it('it is the kit Drawer, open, with its backdrop and onClose, and nothing on its tag moves it (TL-24)', () => {
    expect(drawerProps(PANEL)).toEqual({ open: true, backdrop: true, onClose: true, bare: true })
    // …and the Drawer reads the one token: 0 in a browser, 32px under Electron.
    expect(cssCode(indexCss)).toMatch(/\.ui-drawer\s*\{[^}]*top:\s*var\(--titlebar-offset\)/)
  })
  it('nothing in the panel measures the title bar, paints a scrim or fixes a box of its own; no rule moves the drawer off the offset', () => {
    expect(PANEL_CODE).not.toMatch(HAND_ROLLED_CHROME)
    expect(normal(jsCode(HOLIDAYS))).not.toMatch(HAND_ROLLED_CHROME)
    expect(offsetFights(sheet)).toEqual([])
  })
  it('TaskTemplateManager renders BESIDE the drawer, after it closes: the kit Dialog does not portal (B3c trap 4)', () => {
    expect(PANEL_CODE.indexOf('</Drawer>')).toBeGreaterThan(-1)
    expect(PANEL_CODE.indexOf('<TaskTemplateManager')).toBeGreaterThan(PANEL_CODE.indexOf('</Drawer>'))
  })
  it('every control on both tabs carries its lock as `disabled`; no rule dims a lock or a disabled control by opacity, filter, visibility or transparency', () => {
    // The Settings tab was opacity 60% with pointer-events off: 80 lines
    // under 4.5:1 in the walk, and a keyboard reached every control.
    expect(unlocked(SETTINGS_TAB, 'toolsLocked')).toEqual([])
    expect(unlocked(HOLIDAYS, 'locked')).toEqual([])
    expect(unlocked(PROMPTS_TAB, 'promptsLocked')).toEqual([])
    expect(normal(jsCode(SETTINGS_TAB))).toMatch(/<HolidaysEditor[^>]*\slocked=\{toolsLocked\}/)
    expect(opacityLocks(sheet)).toEqual([])
  })
  it('the panel renders the components it names, each as often as it did: every lockable control is counted, the sections are kit Cards', () => {
    expect(componentsOf(PANEL)).toEqual({
      Drawer: 1, SettingsIcon: 1, IconButton: 2, Tabs: 1, Toolbar: 1, Switch: 2, Lock: 1, Unlock: 1, Card: 4,
      Button: 4, Check: 1, HolidaysEditor: 1, ChevronRight: 1, TaskTemplateManager: 1,
    })
    expect(componentsOf(HOLIDAYS)).toEqual({ Card: 1, Button: 3, IconButton: 1 })
    expect([controlsOf(SETTINGS_TAB).length, controlsOf(HOLIDAYS).length, controlsOf(PROMPTS_TAB).length]).toEqual([4, 6, 3])
    expect(normal(jsCode(PANEL + HOLIDAYS))).not.toMatch(/<section\b/)
  })
  it('every section of the sheet is on tokens now: the whole sheet writes no colour literal', () => {
    expect(sectionsOf(sheet).every((s) => /stage 2/i.test(s.banner))).toBe(true)
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('the three fields keep Escape (the drawer must not close under an unsaved draft) and are native in the kit\'s ui-input', () => {
    const fields = [...elementsOf(HOLIDAYS), ...elementsOf(PROMPTS_TAB)]
      .filter((e) => ['input', 'textarea'].includes(e.tag) && !/\stype="file"/.test(e.attrs))
    expect(fields).toHaveLength(3)
    for (const f of fields) {
      expect(f.attrs, f.attrs.slice(0, 60)).toMatch(/\sonKeyDown=\{keepEscape\}/)
      expect(f.classes).toContain('ui-input')
    }
    expect(normal(jsCode(source.timeline))).toMatch(/const keepEscape = \(e\) => \{ if \(e\.key === 'Escape'\) e\.preventDefault\(\) \}/)
  })
  it('CONTROL: each helper fires on the shape it names and passes the real one', () => {
    // unlocked: a kit or a native control without its one lock is named; the file input and a prompt head are not.
    expect(unlocked('const A = () => <div><Button onClick={go}>Add</Button><Switch disabled={locked} /></div>', 'locked')).toHaveLength(1)
    expect(unlocked('const A = () => <button type="button" onClick={go} />', 'locked')).toHaveLength(1)
    expect(unlocked('const A = () => <button type="button" role={\'checkbox\'} onClick={go} />', 'locked')).toHaveLength(1)
    expect(unlocked('const A = () => <Button disabled={locked} disabled={false}>Add</Button>', 'locked')).toHaveLength(1)
    expect(unlocked('const A = () => <div><input type="file" className="hidden" /><button className="rb-tl-prompt-head" /></div>', 'locked')).toEqual([])
    // componentsOf: a wrapper component shows up by name.
    expect(componentsOf('const A = () => <div><LockedButton /><Card /></div>')).toEqual({ LockedButton: 1, Card: 1 })
    // drawerProps: any order; a false backdrop is no backdrop; a style or a utility is not bare; two drawers throw.
    expect(drawerProps('const A = () => <Drawer backdrop open onClose={onClose} className="rb-tl-settings">x</Drawer>'))
      .toEqual({ open: true, backdrop: true, onClose: true, bare: true })
    expect(drawerProps('const A = () => <Drawer open onClose={onClose} backdrop={false}>x</Drawer>').backdrop).toBe(false)
    expect(drawerProps("const A = () => <Drawer open onClose={onClose} backdrop className=\"rb-tl-settings\" style={{ '--titlebar-offset': '0px' }}>x</Drawer>").bare).toBe(false)
    expect(drawerProps('const A = () => <Drawer open onClose={onClose} backdrop className="rb-tl-settings top-[0px]">x</Drawer>').bare).toBe(false)
    expect(() => drawerProps('const A = () => <div><Drawer open /><Drawer open /></div>')).toThrow()
    // HAND_ROLLED_CHROME: the spellings round one found.
    for (const s of ['{window.wilsonSession && <div style={{ height: 32 }} />}', "style={{ 'padding-top': 32 }}",
      'className="fixed top-0 right-0 bottom-0 left-0"', 'className="inset-x-0 inset-y-0 bg-backdrop"']) {
      expect(s).toMatch(HAND_ROLLED_CHROME)
    }
    // offsetFights: on the drawer itself only, the token included.
    expect(offsetFights('.rb-tl-settings { top: 0 }')).toHaveLength(1)
    expect(offsetFights('aside.ui-drawer.rb-tl-settings { padding-top: 32px }')).toHaveLength(1)
    expect(offsetFights('aside.ui-drawer.rb-tl-settings { --titlebar-offset: 0px }')).toHaveLength(1)
    expect(offsetFights('.rb-tl-settings .ui-drawer-body { padding: 0 }')).toEqual([])
    // opacityLocks: an opacity, a filter, visibility or a transparent mix under a lock or :disabled.
    expect(opacityLocks('.rb-tl-x[data-locked="true"] { opacity: 60% }')).toHaveLength(1)
    expect(opacityLocks('.rb-tl-y[data-locked="true"] .z { filter: brightness(60%) }')).toHaveLength(1)
    expect(opacityLocks('.rb-tl-x[data-locked="true"] { visibility: hidden }')).toHaveLength(1)
    expect(opacityLocks('.rb-tl-x[data-locked="true"] .y { color: color-mix(in srgb, var(--color-ink) 45%, transparent) }')).toHaveLength(1)
    expect(opacityLocks('.rb-tl-type-check:disabled { opacity: .4 }')).toHaveLength(1)
    expect(opacityLocks('.rb-tl-x[data-locked="true"] { color: var(--color-ink-3) }')).toEqual([])
    expect(() => between('abc', 'x', 'c')).toThrow()
  })
})

// V2, the second visual QA pass (2026-09-27): the task editor is capped at the
// kit Dialog's 88vh and its body scrolls. Review round one found two things
// the cap broke: the save error was the scroll body's last child, so "Task
// title is required." landed below the fold and Save seemed to do nothing;
// and the scroll body was also the `inert` element, which a read-only viewer
// cannot scroll. The scroller wraps the inert fields now, and the error is a
// strip of its own between the body and the footer.
describe('V2: the task editor scrolls its fields and shows its error', () => {
  const code = jsCode(read('TimelineView.jsx'))
  const editorOf = (c) => c.slice(c.indexOf('function TaskEditor('), c.indexOf('\n}\n', c.indexOf('function TaskEditor(')))
  const SCROLLER = '<div className="min-h-0 overflow-y-auto scroll-py-1">'
  const FIELDS = '<div className="px-4 py-4 flex flex-col gap-3" inert={!canWrite ? true : undefined}>'
  const ERROR = '{error && (\n          <div role="alert" className="px-4 py-3 shrink-0"'
  const FOOTER = 'className="flex items-center gap-2 px-4 py-3 shrink-0"'
  /** What is wrong with an editor's structure: every marker present and in
      order; the scroller, and the fields in it, CLOSED before the error (as
      many `<div` as `</div>` between the scroller's opening and the error —
      review round two: order alone cannot tell inside from outside); and
      `inert` exactly once, on the fields, so nothing that scrolls is inert. */
  const problems = (editor) => {
    const at = [SCROLLER, FIELDS, ERROR, FOOTER].map((m) => editor.indexOf(m))
    if (at.some((i) => i < 0)) return [`missing marker: ${at.join(' ')}`]
    const out = []
    if (!(at[0] < at[1] && at[1] < at[2] && at[2] < at[3])) out.push('out of order')
    const span = editor.slice(at[0], at[2])
    const open = (span.match(/<div\b/g) || []).length
    const close = (span.match(/<\/div>/g) || []).length
    if (open !== close) out.push(`the error sits inside: ${open} <div, ${close} </div> before it`)
    const inert = editor.match(/\binert\b/g) || []
    if (inert.length !== 1) out.push(`inert ${inert.length}x`)
    if ((editor.match(/\{error && \(/g) || []).length !== 1) out.push('the error drawn twice')
    return out
  }

  it('an outer scroller wraps the inert fields, and the error is an alert strip between the body and the footer', () => {
    const editor = editorOf(code)
    expect(editor.length, 'TaskEditor moved').toBeGreaterThan(5000)
    expect(problems(editor)).toEqual([])
  })

  it('CONTROL: the error back inside the scroller or the fields, or inert on the panel, is caught', () => {
    const editor = editorOf(code)
    const start = editor.indexOf(ERROR)
    const end = editor.indexOf('\n        )}\n', start) + '\n        )}\n'.length
    const block = editor.slice(start, end)
    const without = editor.slice(0, start) + editor.slice(end)
    const scrollerClose = without.lastIndexOf('        </div>\n', without.indexOf(FOOTER))
    const fieldsClose = without.lastIndexOf('        </div>\n', scrollerClose - 1)
    // A: the strip as the scroller's last child — round one's R1-01.
    const inScroller = without.slice(0, scrollerClose) + block + without.slice(scrollerClose)
    // A2: the strip as the fields' last child.
    const inFields = without.slice(0, fieldsClose) + block + without.slice(fieldsClose)
    // B: inert on the capped panel, the scroller's ancestor — R1-04.
    const inertPanel = editor.replace('className="rounded-control flex flex-col w-full max-w-md"', 'className="rounded-control flex flex-col w-full max-w-md" inert')
    expect(inertPanel).not.toBe(editor)
    expect(problems(inScroller).join()).toMatch(/inside/)
    expect(problems(inFields).join()).toMatch(/inside/)
    expect(problems(inertPanel).join()).toMatch(/inert 2x/)
  })
})

// V2, the second visual QA pass (2026-09-27): the two primaries the Timeline
// still draws by hand — the task editor's Save and the phase-window dialog's
// Extend phase — were cream on the signal (#fff7ed on #ea580c, 3.35:1, a C6
// break). Both carry the kit primary's pair now. The walk's
// `rabbit-timeline-task-new` gates Save in the running app; Extend phase needs
// a drag no walk makes, so this gates both in the source (V2 review round one).
describe('V2: no cream on the signal among the Timeline\'s hand-drawn primaries (C6)', () => {
  const PAIR = "color: 'var(--color-on-fill)', backgroundColor: 'var(--color-signal-fill)'"
  const cream = (code) => (code.match(/color: '#fff7ed'|backgroundColor: '#ea580c'/g) || []).length
  const buttonOf = (code, label) => {
    const at = code.indexOf(label)
    return at < 0 ? null : code.slice(code.lastIndexOf('<button', at), at)
  }
  it('Save and Extend phase each carry the kit primary\'s pair, and no cream ink or signal ground is left in code', () => {
    const code = jsCode(read('TimelineView.jsx'))
    for (const label of ["{saving ? 'Saving…' : 'Save'}", 'Extend phase\n']) {
      const button = buttonOf(code, label)
      expect(button, `no button before ${label}`).toBeTruthy()
      expect(button, label).toContain(PAIR)
    }
    expect(cream(code)).toBe(0)
  })
  it('CONTROL: the old pair, planted back on either button, is caught', () => {
    const code = jsCode(read('TimelineView.jsx'))
    const first = code.replace(PAIR, "color: '#fff7ed', backgroundColor: '#ea580c'")
    expect(first).not.toBe(code)
    expect(cream(first)).toBe(2)
    // Each button's own check, on its own plant (review round two: the
    // conjunction held as soon as Save alone lost the pair).
    expect(buttonOf(first, 'Extend phase\n')).not.toContain(PAIR)
    expect(buttonOf(first, "{saving ? 'Saving…' : 'Save'}")).toContain(PAIR)
    const at = code.lastIndexOf(PAIR)
    const second = code.slice(0, at) + "color: '#fff7ed', backgroundColor: '#ea580c'" + code.slice(at + PAIR.length)
    expect(buttonOf(second, "{saving ? 'Saving…' : 'Save'}")).not.toContain(PAIR)
    expect(buttonOf(second, 'Extend phase\n')).toContain(PAIR)
  })
})

/* ── 12. post-overhaul S1, the Timeline pass (2026-09-30) ───────────────────── */
const sameSelector = (s) => s.replace(/\s+/g, ' ').trim()
/** The value `prop` takes on exactly `sel`: the last rule whose selector list
    holds it wins, as the cascade decides between equal selectors. */
const declOf = (css, sel, prop) => rulesOf(css)
  .filter((r) => selectorsOf(r.sel).map(sameSelector).includes(sel))
  .map((r) => r.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim())
  .filter(Boolean).pop()
/** Every (selector, property) that paints with the signal ink. */
const signalInkUses = (css) => rulesOf(css).flatMap((r) => r.body.split(';')
  .filter((d) => /var\(--color-signal-ink\)/.test(d))
  .flatMap((d) => selectorsOf(r.sel).map((s) => `${sameSelector(s)} { ${d.split(':')[0].trim()} }`)))
/** Every selector that recolours a gutter name under the pointer. */
const hoverNameInks = (css) => rulesOf(css)
  .filter((r) => /(?:^|;)\s*color\s*:/.test(r.body))
  .flatMap((r) => selectorsOf(r.sel).map(sameSelector))
  .filter((s) => /\[data-hover="true"\][^,]*\.rb-tl-row-label/.test(s))

describe('S1 item 1: the gutter\'s inks — task names the ink, phase names the signal ink (rulings B1, B9)', () => {
  const PHASE_NAMES = ['.rb-tl-row[data-shape="phase"] > .rb-tl-row-label', '.rb-tl-row[data-shape="subgroup"] > .rb-tl-row-label']
  it('a task\'s name is the ink at rest, and no rule lifts it under the pointer (the row\'s fill carries the hover)', () => {
    expect(declOf(sheet, '.rb-tl-row-label', 'color')).toBe('var(--color-ink)')
    expect(hoverNameInks(sheet)).toEqual([])
  })
  it('a phase\'s and a sub-phase\'s name are the signal ink, at 600', () => {
    for (const sel of PHASE_NAMES) {
      expect(declOf(sheet, sel, 'color'), sel).toBe('var(--color-signal-ink)')
      expect(declOf(sheet, sel, 'font-weight'), sel).toBe('600')
    }
  })
  it('the signal ink paints those two names and nothing else: the gutter column only, as text — never the bar\'s label, the minimap or a fill (B9)', () => {
    expect(signalInkUses(sheet).sort()).toEqual(PHASE_NAMES.map((s) => `${s} { color }`).sort())
  })
  it('the ink is the kit\'s token, one value in @theme and tokens.js (its pairs: tokens.test.js)', () => {
    expect(THEME['color-signal-ink']).toBe('#fb923c')
    expect(cssCode(indexCss)).toMatch(/--color-signal-ink:\s*#fb923c;/)
  })
  it('CONTROL: the old hover lift, the ink-2 rest, the signal ink on the bar\'s label and as a fill are each caught', () => {
    const lifted = sheet.replace('.rb-tl-row-label { color: var(--color-ink); }',
      '.rb-tl-row-label { color: var(--color-ink-2); }\n  .rb-tl-row[data-hover="true"] > .rb-tl-row-label { color: var(--color-ink); }')
    expect(lifted).not.toBe(sheet)
    expect(declOf(lifted, '.rb-tl-row-label', 'color')).toBe('var(--color-ink-2)')
    expect(hoverNameInks(lifted)).toEqual(['.rb-tl-row[data-hover="true"] > .rb-tl-row-label'])
    const onBar = sheet.replace('.rb-tl-bar-label { color: var(--rb-tl-fg); }', '.rb-tl-bar-label { color: var(--color-signal-ink); }')
    expect(onBar).not.toBe(sheet)
    expect(signalInkUses(onBar)).toContain('.rb-tl-bar-label { color }')
    const asFill = `${sheet}\n.rb-tl-row[data-shape="phase"] > .rb-tl-row-label { background-color: var(--color-signal-ink); }`
    expect(signalInkUses(asFill)).toContain('.rb-tl-row[data-shape="phase"] > .rb-tl-row-label { background-color }')
    expect(signalInkUses(asFill)).toHaveLength(3)
  })
})

/** Every rule on the element itself (no combinator) of one lane class that
    sets its bottom border, as `selector { declaration }`. */
const bottomRules = (css, cls) => rulesOf(css).flatMap((r) => {
  const decl = r.body.match(/(?:^|;)\s*(border-bottom(?:-[a-z]+)?\s*:\s*[^;]+)/)?.[1]?.trim()
  if (!decl) return []
  return selectorsOf(r.sel).map(sameSelector)
    .filter((s) => new RegExp(`^\\.${cls}(?![\\w-])`).test(s) && !/[\s>+~]/.test(s))
    .map((s) => `${s} { ${decl.replace(/\s*:\s*/, ': ')} }`)
})
describe('S1 item 4: no rule under a task row in the gantt half; the gutter and the phase rows keep theirs (ruling B6)', () => {
  const RULE = 'border-bottom: 1px solid var(--color-rule)'
  it('a chart row keeps the rule, a task\'s drops it, and "+ New task" in the chart has none', () => {
    expect(bottomRules(sheet, 'rb-tl-chart-row')).toEqual([`.rb-tl-chart-row { ${RULE} }`, '.rb-tl-chart-row[data-shape="task"] { border-bottom: none }'])
    expect(bottomRules(sheet, 'rb-tl-chart-dz')).toEqual(['.rb-tl-chart-dz { border-bottom: none }'])
  })
  it('the gutter keeps every row\'s rule: nothing overrides it on a task, a phase or a "+ New task" row', () => {
    expect(bottomRules(sheet, 'rb-tl-row')).toEqual([`.rb-tl-row { ${RULE} }`])
    expect(bottomRules(sheet, 'rb-tl-dz')).toEqual([`.rb-tl-dz { ${RULE} }`])
  })
  it('the chart\'s task rows are the JSX\'s: its chart row writes data-shape="task" for every row that is not a phase', () => {
    expect(code.timeline).toMatch(/className="absolute left-0 right-0 rb-tl-chart-row"\s+data-shape=\{r\.kind !== 'phase' \? 'task' : r\.isSubgroup \? 'subgroup' : 'phase'\}/)
  })
  it('CONTROL: the rule planted back under "+ New task", and a gutter task row losing its, are caught', () => {
    const back = sheet.replace('.rb-tl-chart-dz { background-color: transparent; border-bottom: none;', `.rb-tl-chart-dz { background-color: transparent; ${RULE};`)
    expect(back).not.toBe(sheet)
    expect(bottomRules(back, 'rb-tl-chart-dz')).toEqual([`.rb-tl-chart-dz { ${RULE} }`])
    const bare = `${sheet}\n.rb-tl-row[data-shape="task"] { border-bottom: none; }`
    expect(bottomRules(bare, 'rb-tl-row')).toHaveLength(2)
  })
})

/** Every (selector, transition declaration) the sheet gives the minimap's
    window: the shorthand or a longhand, on any selector whose last compound
    is one of its two layers (review round 1: a longhand or a descendant
    selector got past the first version). */
const frameTransitions = (css) => rulesOf(css).flatMap((r) => {
  const decls = r.body.split(';').map((d) => d.trim()).filter((d) => /^transition(?:-[a-z]+)?\s*:/.test(d)).map((d) => d.replace(/\s*:\s*/, ': '))
  if (!decls.length) return []
  return selectorsOf(r.sel).map(sameSelector)
    .filter((s) => /\.rb-tl-ov-frame(?:-edge)?(?![\w-])/.test(lastCompound(s)))
    .flatMap((s) => decls.map((d) => `${s} { ${d} }`))
})
/* Post-overhaul S5p (P1-32b): the gantt's scroll conversions, read where
   they are written. Each slice is found by its declaration, so a plant that
   changes a dependency list still yields the code it planted into. */
/** changeZoom, through the line that closes its useCallback. */
const changeZoomBody = (src) => {
  const at = src.indexOf('const changeZoom = useCallback((id) => {')
  if (at < 0) return ''
  const close = src.indexOf('\n  }, [', at)
  const eol = src.indexOf('\n', close + 1)
  return src.slice(at, eol < 0 ? undefined : eol)
}
/** The re-anchoring layout effect, up to (not including) its dependency list. */
const reanchorBody = (src) => {
  const at = src.indexOf('const prevDayPxRef')
  return at < 0 ? '' : src.slice(at, src.indexOf('\n  }, [', at))
}
/** DetailPane, up to the next top-level function. */
const detailPaneBody = (src) => {
  const at = src.indexOf('export function DetailPane(')
  if (at < 0) return ''
  const next = src.slice(at + 1).search(/\n(?:export )?function /)
  return src.slice(at, next < 0 ? undefined : at + 1 + next)
}
/** Every write of the gantt's scroll, and how many record the day it now shows through the pair. */
const scriptedScrolls = (src) => ({
  writes: (src.match(/\.scrollLeft = /g) || []).length,
  recorded: (src.match(/scrollLeft = [^\n]+\n\s+anchorDayRef\.current = dayAtX\(el\.scrollLeft, (?:DAY_PX|currPx), maskDays\)/g) || []).length,
})
/** Arithmetic on the gantt's scale: `x / DAY_PX`, `d * DAY_PX` (sorted). */
const scrollArithmetic = (src) => (src.match(/[*/]\s*DAY_PX\b|\bDAY_PX\s*[*/]/g) || []).map((s) => s.replace(/\s+/g, ' ')).sort()
/** Code that builds a weekend mask: the shared builder, or an array of the chart's days. */
const maskBuilders = (src) => src.match(/weekendMask\(|new Array\(totalDays \+ 1\)/g) || []
describe('S1 item 5: the minimap window animates after a zoom-tab change (ruling B7)', () => {
  const MOVE = 'left var(--duration-response) var(--ease-response), width var(--duration-response) var(--ease-response)'
  it('the sheet moves both layers under data-animate="true" only, and its one reduced-motion block stops them', () => {
    expect(frameTransitions(sheet)).toEqual([
      `.rb-tl-ov-frame[data-animate="true"] { transition: ${MOVE} }`,
      `.rb-tl-ov-frame-edge[data-animate="true"] { transition: ${MOVE} }`,
      '.rb-tl-ov-frame[data-animate="true"] { transition: none }',
      '.rb-tl-ov-frame-edge[data-animate="true"] { transition: none }',
    ])
    expect([...cssCode(sheet).matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g)]).toHaveLength(1)
  })
  it('the Timeline hands the minimap its zoom, and only the zoom tabs write that zoom', () => {
    expect(code.timeline).toMatch(/milestones=\{allMilestones\}\s+detailZoom=\{zoomId\}/)
    expect(code.timeline.match(/setZoomId/g)).toHaveLength(2) // the useState, and changeZoom
    expect(code.timeline).toMatch(/<DetailZoomToolbar\s+zoomId=\{zoomId\}\s+onChange=\{changeZoom\}/)
    // changeZoom fixes the left date in the same render as the new scale, so
    // no wrong box is ever committed (measured: without it Day → Quarter
    // unmounted the window and it jumped). Post-overhaul S5p: it reads the
    // anchor as a DAY through the pair, with the scale and mask the click
    // happened in, and that day is the state; it carried px through
    // px / DAY_PX × the new px, which ignored the mask (P1-32b).
    expect(changeZoomBody(code.timeline)).toMatch(/anchorDayRef\.current = dayAtX\(el\.scrollLeft, DAY_PX, maskDays\)\s+setDetailStartDay\(anchorDayRef\.current\)\s+\}\s+setZoomId\(id\)\s+\}, \[DAY_PX, maskDays\]\)$/)
    // Both layers carry the flag, as a literal the attribute guards can read.
    expect(code.timeline.match(/data-animate=\{frameAnimate \? 'true' : 'false'\}/g)).toHaveLength(2)
  })
  it('the zoom compensation is a layout effect that sets the scroll state itself, so the wrong first box is never painted', () => {
    const body = reanchorBody(code.timeline)
    expect(body).toMatch(/useLayoutEffect\(\(\) => \{/)
    expect(body).toMatch(/el\.scrollLeft = newScrollLeft\s+anchorDayRef\.current = dayAtX\(el\.scrollLeft, currPx, maskDays\)\s+setDetailStartDay\(anchorDayRef\.current\)/)
    expect(code.timeline).toMatch(/import \{ useEffect, useLayoutEffect, /)
  })
  it('it re-anchors on the anchor recorded BEFORE the change, never the DOM\'s scroll, which a narrower chart has already clamped (review round 1: zooming out moved the gantt\'s left date) — and the anchor is a day, put back through the new mask (S5p)', () => {
    const body = reanchorBody(code.timeline)
    expect(body).toMatch(/const newScrollLeft = xAtDay\(anchorDayRef\.current \+ startDeltaDays, currPx, maskDays\)/)
    // The DOM's scroll is written, then read back — never read before.
    expect(body.match(/el\.scrollLeft[^\n]*/g)).toEqual(['el.scrollLeft = newScrollLeft', 'el.scrollLeft, currPx, maskDays)'])
    expect(body).not.toMatch(/el\.scrollLeft \//)
    // Every scroll records the day at the left edge, in the scale and mask
    // the gantt is drawn with as that scroll lands.
    expect(code.timeline).toMatch(/function onScroll\(\) \{\s+const g = geometryRef\.current\s+anchorDayRef\.current = dayAtX\(el\.scrollLeft, g\.dayPx, g\.mask\)\s+setDetailStartDay\(anchorDayRef\.current\)\s+\}/)
    expect(code.timeline).toMatch(/geometryRef\.current = \{ dayPx: DAY_PX, mask: maskDays \}/)
  })
  it('the scroll listener attaches when the gantt exists and syncs at once, and every scripted scroll records itself (review round 2)', () => {
    // With `[]` it ran once, before a loading project's gantt existed, and
    // never listened; the re-anchoring then read a dead anchor.
    expect(code.timeline).toMatch(/const hasProject = !!project\s+useEffect\(\(\) => \{[\s\S]{0,600}?onResize\(\)\s+onScroll\(\)\s+el\.addEventListener\('scroll', onScroll\)[\s\S]{0,300}?\}, \[hasProject\]\)/)
    // The first-mount centring, scrollDetailToDay, the gantt's Today, and the
    // re-anchoring's own read-back: every write of the gantt's scroll, each
    // followed by the day it now shows, through the pair (S5p).
    expect(scriptedScrolls(code.timeline)).toEqual({ writes: 4, recorded: 4 })
  })
  it('CONTROL: a transition on the window at rest (it would animate scroll-follow and the drag), and a second reduced-motion block, are caught', () => {
    const atRest = sheet.replace('.rb-tl-ov-frame { background-color:', '.rb-tl-ov-frame { transition: left 200ms; background-color:')
    expect(atRest).not.toBe(sheet)
    expect(frameTransitions(atRest)).toContain('.rb-tl-ov-frame { transition: left 200ms }')
    const longhand = `${sheet}\n.rb-tl-ov-body .rb-tl-ov-frame { transition-duration: 1s; }`
    expect(frameTransitions(longhand)).toContain('.rb-tl-ov-body .rb-tl-ov-frame { transition-duration: 1s }')
    // S5p: the anchor read from the DOM's (clamped) scroll, planted back.
    const clamped = code.timeline.replace('xAtDay(anchorDayRef.current + startDeltaDays, currPx, maskDays)', 'xAtDay(el.scrollLeft / prevPx + startDeltaDays, currPx, maskDays)')
    expect(clamped).not.toBe(code.timeline)
    expect(reanchorBody(clamped)).toMatch(/el\.scrollLeft \//)
    const two = `${sheet}\n@layer components { @media (prefers-reduced-motion: reduce) { .rb-tl-x { transition: none; } } }`
    expect([...cssCode(two).matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g)]).toHaveLength(2)
    const passive = code.timeline.replace(/useLayoutEffect\(\(\) => \{(\s+const el = detailRef\.current\s+if \(!el\) return\s+const prevStart)/, 'useEffect(() => {$1')
    expect(passive).not.toBe(code.timeline)
    expect(reanchorBody(passive)).not.toMatch(/useLayoutEffect\(/)
  })
  it('CONTROL (S5p): changeZoom without its state, or reading px / DAY_PX; the listener ignoring the mask; a scripted scroll that records nothing — each is caught', () => {
    const PIN = /anchorDayRef\.current = dayAtX\(el\.scrollLeft, DAY_PX, maskDays\)\s+setDetailStartDay\(anchorDayRef\.current\)\s+\}\s+setZoomId\(id\)\s+\}, \[DAY_PX, maskDays\]\)$/
    const stateless = code.timeline.replace(/(anchorDayRef\.current = dayAtX\(el\.scrollLeft, DAY_PX, maskDays\))\n\s+setDetailStartDay\(anchorDayRef\.current\)(\n\s+\}\n\s+setZoomId\(id\))/, '$1$2')
    expect(stateless).not.toBe(code.timeline)
    expect(changeZoomBody(stateless)).not.toMatch(PIN)
    const divided = code.timeline.replace('const changeZoom = useCallback((id) => {', 'const changeZoom = useCallback((id) => {\n    void (detailRef.current?.scrollLeft / DAY_PX)')
    expect(divided).not.toBe(code.timeline)
    expect(scrollArithmetic(divided)).toEqual(['* DAY_PX', '/ DAY_PX'])
    const unmasked = code.timeline.replace('anchorDayRef.current = dayAtX(el.scrollLeft, g.dayPx, g.mask)', 'anchorDayRef.current = el.scrollLeft / g.dayPx')
    expect(unmasked).not.toBe(code.timeline)
    expect(unmasked).not.toMatch(/function onScroll\(\) \{\s+const g = geometryRef\.current\s+anchorDayRef\.current = dayAtX\(el\.scrollLeft, g\.dayPx, g\.mask\)/)
    const silent = code.timeline.replace(/(const targetPx = xAtDay\(todayDays, DAY_PX, maskDays\) - viewportContentW \/ 2\n\s+el\.scrollLeft = Math\.max\(0, targetPx\))\n\s+anchorDayRef\.current = dayAtX\(el\.scrollLeft, DAY_PX, maskDays\)/, '$1')
    expect(silent).not.toBe(code.timeline)
    expect(scriptedScrolls(silent)).toEqual({ writes: 4, recorded: 3 })
  })
})

/* ── S5p (P1-32b): the weekend mask lives in TimelineView, one pair reads it ─ */
describe('S5p: one weekend mask and one x ↔ day pair for the pane and the six conversions (P1-32b)', () => {
  it('TimelineView builds the mask from hideWeekends and hands it to DetailPane, which builds none of its own and draws through xAtDay', () => {
    expect(code.timeline).toMatch(/const dayMask = useMemo\(\s*\(\) => \(hideWeekends \? weekendMask\(overviewSpan\.start, overviewSpan\.days, DAY_PX\) : null\),\s*\[hideWeekends, overviewSpan\.start, overviewSpan\.days, DAY_PX\]\s*\)/)
    expect(code.timeline).toMatch(/<DetailPane[\s\S]{0,300}?\s+dayMask=\{dayMask\}/)
    const pane = detailPaneBody(code.timeline)
    expect(pane).toMatch(/^export function DetailPane\(\{[\s\S]{0,200}?\bdayMask = null,/)
    expect(pane).toMatch(/const hideWeekends = !!dayMask/)
    expect(pane).toMatch(/function dayToX\(dayOffset\) \{\s+return xAtDay\(dayOffset, dayPx, dayMask\?\.mask\)\s+\}/)
    expect(maskBuilders(pane)).toEqual([])
    expect(maskBuilders(code.timeline)).toEqual(['weekendMask('])
  })
  it('no conversion multiplies or divides by the scale: the one * DAY_PX left is the unmasked chart\'s width', () => {
    expect(scrollArithmetic(code.timeline)).toEqual(['* DAY_PX'])
    expect(code.timeline).toMatch(/const chartW = totalDays \* DAY_PX/)
    // The six: the first-mount centring, the re-anchoring, changeZoom, the
    // visible window, scrollDetailToDay and Today, each through the pair.
    expect(code.timeline).toMatch(/el\.scrollLeft = Math\.max\(0, xAtDay\(todayDays, DAY_PX, maskDays\) - 200\)/)
    expect(code.timeline).toMatch(/const newScrollLeft = xAtDay\(anchorDayRef\.current \+ startDeltaDays, currPx, maskDays\)/)
    expect(changeZoomBody(code.timeline)).toMatch(/anchorDayRef\.current = dayAtX\(el\.scrollLeft, DAY_PX, maskDays\)/)
    expect(code.timeline).toMatch(/const \{ start: visibleStartDays, end: visibleEndDays \} =\s+visibleDayRange\(detailStartDay, detailViewportW - LABEL_W, DAY_PX, maskDays\)/)
    expect(code.timeline).toMatch(/el\.scrollLeft = Math\.max\(0, xAtDay\(dayOffset, DAY_PX, maskDays\)\)/)
    expect(code.timeline).toMatch(/const targetPx = xAtDay\(todayDays, DAY_PX, maskDays\) - viewportContentW \/ 2/)
  })
  it('the re-anchoring watches the switch: hideWeekends is in its dependencies and a change of it re-anchors', () => {
    expect(code.timeline).toMatch(/\}, \[overviewSpan\.start, DAY_PX, hideWeekends, maskDays\]\)/)
    expect(reanchorBody(code.timeline)).toMatch(/const weekendsChanged = prevHideWeekendsRef\.current !== hideWeekends\s+if \(startMoved \|\| zoomChanged \|\| weekendsChanged\) \{/)
    expect(reanchorBody(code.timeline)).toMatch(/prevHideWeekendsRef\.current = hideWeekends$/)
  })
  it('scrollDetailToDay is a callback on the scale and the mask, and scrollDetailToDate follows it (it kept Week\'s 22px at every zoom)', () => {
    expect(code.timeline).toMatch(/const scrollDetailToDay = useCallback\(\(dayOffset\) => \{[\s\S]{0,300}?\}, \[DAY_PX, maskDays\]\)/)
    expect(code.timeline).toMatch(/const scrollDetailToDate = useCallback\(\(date\) => \{[\s\S]{0,200}?scrollDetailToDay\(days\)\s+\}, \[overviewSpan\.start, scrollDetailToDay\]\)/)
    expect(code.timeline).not.toMatch(/function scrollDetailToDay\(/)
  })
  it('CONTROL: the pane\'s own mask, the switch dropped from the deps, the stale callback and the old window, planted back, are caught', () => {
    const ownMask = code.timeline.replace('const hideWeekends = !!dayMask', 'const ownMask = useMemo(() => { const mask = new Array(totalDays + 1); return { mask, totalPx: 0 } }, [totalDays])\n  const hideWeekends = !!dayMask')
    expect(ownMask).not.toBe(code.timeline)
    expect(maskBuilders(detailPaneBody(ownMask))).toEqual(['new Array(totalDays + 1)'])
    const deaf = code.timeline.replace('}, [overviewSpan.start, DAY_PX, hideWeekends, maskDays])', '}, [overviewSpan.start, DAY_PX])')
    expect(deaf).not.toBe(code.timeline)
    expect(deaf).not.toMatch(/\}, \[overviewSpan\.start, DAY_PX, hideWeekends, maskDays\]\)/)
    const stale = code.timeline.replace('}, [overviewSpan.start, scrollDetailToDay])', '}, [overviewSpan.start])')
    expect(stale).not.toBe(code.timeline)
    expect(stale).not.toMatch(/\}, \[overviewSpan\.start, scrollDetailToDay\]\)/)
    const oldWindow = code.timeline.replace(/const \{ start: visibleStartDays, end: visibleEndDays \} =\s+visibleDayRange\(detailStartDay, detailViewportW - LABEL_W, DAY_PX, maskDays\)/, 'const visibleStartDays = Math.max(0, detailStartDay)\n  const visibleEndDays = visibleStartDays + Math.max(1, (detailViewportW - LABEL_W) / DAY_PX)')
    expect(oldWindow).not.toBe(code.timeline)
    expect(scrollArithmetic(oldWindow)).toEqual(['* DAY_PX', '/ DAY_PX'])
  })
})

/** How the gantt turns a pointer's x into a day where it CREATES a task: the
    "+ New task" click and drag-to-draw. */
const creationSnaps = (src) => ({
  helper: (src.match(/dayIndexAtX\((?:clickX|preview\.lo|preview\.hi - 1|mouseXInChart), dayPx, dayMask\?\.mask\)/g) || []).length,
  rounded: (src.match(/Math\.round\((?:clickX \/ dayPx|startDays|endDays)\)/g) || []).length,
})
describe('S1 item 3: a created task lands on the day cell under the pointer (ruling B8a)', () => {
  it('the "+ New task" click, its ghost and both ends of drag-to-draw read the day under the pointer through dayIndexAtX, weekend mask included; nothing rounds to a column edge', () => {
    expect(creationSnaps(code.timeline)).toEqual({ helper: 4, rounded: 0 })
    // Drag-to-draw covers every cell swept: the end is the day after the
    // cell under the other end (review round 1: floored, the release cell
    // was never drawn and a drag across two cells made a one-day task).
    expect(code.timeline).toMatch(/const endIdx\s+= Math\.max\(startIdx \+ 1, dayIndexAtX\(preview\.hi - 1, dayPx, dayMask\?\.mask\) \+ 1\)/)
    // The ghost starts on the click's day and spans exactly its seven days
    // (no minimum width; review round 2), clamped to the chart's end.
    expect(code.timeline).toMatch(/const ghostLeft = ghostDay != null\s+\? dayToX\(ghostDay\)/)
    expect(code.timeline).toMatch(/const ghostSpan = dayToX\(ghostFrom \+ 7\) - dayToX\(ghostFrom\)/)
    expect(code.timeline).toMatch(/const ghostWidth = Math\.max\(0, Math\.min\(ghostSpan, effectiveChartW - ghostLeft\)\)/)
    expect(code.timeline).not.toMatch(/Math\.max\(60,/)
  })
  it('CONTROL: the click\'s old rounding, and drag-to-draw\'s floored end, planted back, are caught', () => {
    const planted = code.timeline.replace('dayIndexAtX(clickX, dayPx, dayMask?.mask)', 'Math.max(0, Math.round(clickX / dayPx))')
    expect(planted).not.toBe(code.timeline)
    expect(creationSnaps(planted)).toEqual({ helper: 3, rounded: 1 })
    const floored = code.timeline.replace('dayIndexAtX(preview.hi - 1, dayPx, dayMask?.mask) + 1)', 'dayIndexAtX(preview.hi, dayPx, dayMask?.mask))')
    expect(floored).not.toBe(code.timeline)
    expect(floored).not.toMatch(/const endIdx\s+= Math\.max\(startIdx \+ 1, dayIndexAtX\(preview\.hi - 1, dayPx, dayMask\?\.mask\) \+ 1\)/)
  })
})

/** The properties that change how a name's ink reaches the eye (review round 2). */
const INK_PROPS = /^(?:color|-webkit-text-fill-color|opacity|filter|visibility|mix-blend-mode)$/
/** Every selector that can reach a gutter name — its last compound is the
    name's class, or a bare element (or `*`) under a gutter row — with the
    ink-changing properties it sets, as `selector { props }`. */
const rowLabelInks = (css) => rulesOf(css).flatMap((r) => {
  const props = propsOf(r.body).filter((p) => INK_PROPS.test(p))
  if (!props.length) return []
  return selectorsOf(r.sel).map(sameSelector)
    .filter((s) => /\.rb-tl-row-label(?![\w-])/.test(lastCompound(s))
      || (!/\./.test(lastCompound(s)) && /\.rb-tl-(?:row|gutter)(?![\w-])/.test(s)))
    .map((s) => `${s} { ${props.join(', ')} }`)
})
/** Every rule that reaches a header label and sets anything besides its
    colour: the backing's declarations, order-insensitive, per rule. */
const axisBacking = (css) => rulesOf(css)
  .filter((r) => selectorsOf(r.sel).some((s) => /\.rb-tl-axis-(?:top|label)(?![\w-])/.test(lastCompound(sameSelector(s)))))
  .map((r) => ({ sels: selectorsOf(r.sel).map(sameSelector), decls: r.body.split(';').map((d) => d.trim().replace(/\s*:\s*/, ': ')).filter(Boolean).filter((d) => !/^color:/.test(d)).sort() }))
  .filter((r) => r.decls.length)
describe('S1 review round 1: the header\'s backing and wiring, and the gutter\'s inks by any selector', () => {
  it('only the three known rules change a gutter name\'s ink — colour, text fill, opacity, filter or visibility — however a selector might be spelled', () => {
    expect(rowLabelInks(sheet).sort()).toEqual([
      '.rb-tl-row-label { color }',
      '.rb-tl-row[data-shape="phase"] > .rb-tl-row-label { color }',
      '.rb-tl-row[data-shape="subgroup"] > .rb-tl-row-label { color }',
    ].sort())
  })
  it('a month\'s labels sit on the paper, above the tick lines, hugging their own text: the six declarations on exactly the two selectors, and no other rule reaching a header label sets anything but its colour', () => {
    expect(axisBacking(sheet)).toEqual([{
      sels: ['.rb-tl-axis-top', '.rb-tl-axis-tick[data-major="true"] .rb-tl-axis-label'],
      decls: ['align-self: flex-start', 'background-color: var(--color-paper)', 'margin-inline-start: -4px', 'padding-inline: 4px', 'position: relative', 'z-index: 1'],
    }])
  })
  it('no transition reaches an element through a selector whose last compound has no class (a `div`, a `*`): every moving rule names its element', () => {
    const generic = rulesOf(sheet).flatMap((r) => (/(?:^|;)\s*transition(?:-[a-z]+)?\s*:/.test(r.body)
      ? selectorsOf(r.sel).map(sameSelector).filter((s) => !/\./.test(lastCompound(s))) : []))
    expect(generic).toEqual([])
  })
  it('DetailPane hands buildAxisTicks the weekend mask, draws no hidden day\'s tick, and puts the month\'s bold line where the header puts its label', () => {
    expect(code.timeline).toMatch(/buildAxisTicks\(span\.start, totalDays, zoom, \{\s*\.\.\.\(dayMask \? \{\s*hidden: \(i\) => !!dayMask\.mask\[i\]\?\.hidden,\s*xOf: \(i\) => dayMask\.mask\[i\]\?\.offsetPx \?\? i \* zoom\.dayPx,\s*\} : \{\}\),\s*end: effectiveChartW,\s*\}\)/)
    expect(code.timeline).toMatch(/if \(dayMask && dayMask\.mask\[tick\.offset\]\?\.hidden\) return null/)
    expect(code.timeline).toMatch(/const isMonthStart = isMonthStartShown\(d, hideWeekends\)/)
    expect(code.timeline).toMatch(/return \[\s*<div\s+key=\{`wk-\$\{i\}`\}[\s\S]{0,400}?\/>,\s*majorLine,\s*\]/)
  })
  it('CONTROL: a gutter name recoloured by another selector, the backing\'s z-index removed, and the mask dropped from the call are caught', () => {
    const recoloured = `${sheet}\n.rb-tl-gutter .rb-tl-row-label { color: var(--color-ink-2); }`
    expect(rowLabelInks(recoloured)).toContain('.rb-tl-gutter .rb-tl-row-label { color }')
    for (const plant of ['.rb-tl-row[data-shape="task"] > span { color: var(--color-ink-2); }', '.rb-tl-row-label { -webkit-text-fill-color: var(--color-ink-3); }', '.rb-tl-row > .rb-tl-row-label { opacity: 0.6; }']) {
      expect(rowLabelInks(`${sheet}\n${plant}`), plant).toHaveLength(4)
    }
    const flat = sheet.replace('    z-index: 1;\n    align-self: flex-start;', '    align-self: flex-start;')
    expect(flat).not.toBe(sheet)
    expect(axisBacking(flat)[0].decls).not.toContain('z-index: 1')
    for (const plant of ['.rb-tl-axis .rb-tl-axis-top { background-color: transparent; }', '.rb-tl-axis .rb-tl-axis-top { z-index: auto; }']) {
      expect(axisBacking(`${sheet}\n${plant}`), plant).toHaveLength(2)
    }
    const unmasked = code.timeline.replace('hidden: (i) => !!dayMask.mask[i]?.hidden,', '')
    expect(unmasked).not.toBe(code.timeline)
    expect(unmasked).not.toMatch(/hidden: \(i\) => !!dayMask\.mask\[i\]\?\.hidden/)
  })
})
