// =============================================================================
// rabbitTasks.css — the guards for lane B2's stylesheet and its four files
// (UI overhaul B2, 2026-09-23). Pattern: rabbitShellCss.test.js, whose
// scanners this file imports from rabbitCssGuards.js rather than re-types
// (T2 hand-off §5 trap 8). The render half is rabbitTasksRender.test.jsx and
// rabbitTasksFilesRender.test.jsx.
//
// Pinned here:
//   1. the sheet's shape: the @layer statement first, every rule inside the
//      one `@layer components` block, every class `rb-task-` / `rb-tpl-` or a
//      kit class, every selector scoped by one of them (no bare kit override,
//      and a lane class inside `:not()` scopes nothing);
//   2. every file that wears a class imports THIS sheet (its path resolved);
//   3. every class declared is written in a className (any `*ClassName`
//      prop), and every one written is declared; every [data-x="v"] a rule
//      matches can be produced, with no attribute operator or flag the scanner
//      cannot read; data-tone agrees on both sides;
//   4. no rule loses a fight it cannot see: each rule that styles a kit
//      element — named by its kit class OR by a lane class the JSX puts on a
//      kit component — is measured against the kit's own rules for that
//      element in index.css, hover included; a kit rule keyed on a variant,
//      size, alignment or selection the element never has is left out; the
//      two deliberate losses (a hover under the selected fill, anything under
//      the kit's focus and disabled states) must lose strictly, not tie;
//   5. colour: no literal of any spelling (every CSS name, any case), every
//      custom property defined (the sheet's own set by the JSX, and read only
//      on the element that sets it), no signal / focus / selection ground;
//   6. the state extraction holds in all four files: B1's scanner, and a
//      stricter rule of B2's own — a style or className may carry no
//      expression beyond a short allowlist, no spread may smuggle one in, no
//      icon takes a colour or a stroke by state, and no colour is written.
// Round one's guard review ran 84 mutants and 45 survived; round two re-ran
// them (81 died) and 64 more (37 survived, and 11 legitimate edits turned the
// suite red). Every spelling either round used is a CONTROL below, written as
// a self-contained snippet (not an anchor on a shipped source line, which a
// harmless edit breaks) and run through the SAME predicate the assertion uses.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  cssCode, jsCode, rulesOf, lastCompound, propsOf, family, specificity, gt,
  unreachableAttributeValues, utilityConflicts, inlineStateTernaries,
  signalGrounds, indexCss, jsxTags,
} from '../rabbitCssGuards.js'
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitTasks.css')
const sheet = read('rabbitTasks.css')
const kitCode = cssCode(indexCss)

/** B2's four files, relative to this directory. */
const FILES = {
  tasks: 'ProjectTasksView.jsx',
  detail: '../components/TaskDetailPopup.jsx',
  create: '../components/NewTaskPopup.jsx',
  templates: '../../../components/TaskTemplates/TaskTemplateManager.jsx',
}
const source = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]))
/** B1's scanners read `className="…"` and template literals; a `{'…'}` literal
    is the same thing in a spelling they miss (round one, 16). Every
    `*ClassName` prop (the kit Table's `scrollClassName`) is one too. */
const normal = (src) => src
  .replace(/(\w*[cC]lassName)=\{'([^']*)'\}/g, '$1="$2"')
  .replace(/(\w*[cC]lassName)=\{"([^"]*)"\}/g, '$1="$2"')
const jsx = Object.values(source).map((s) => normal(jsCode(s))).join('\n')

/** A selector list split on its TOP-LEVEL commas: `:where(tr, li, .x) .y` is
    one selector (round two: the kit's were cut in the middle). */
export const selectorsOf = (sel) => {
  const out = []
  let d = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const stripNot = (s) => s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '')

/* ── the elements the JSX writes ─────────────────────────────────────────── */
/** A kit component's root class. */
const KIT_ROOT = { Td: 'ui-td', Th: 'ui-th', Row: 'ui-tr', Table: 'ui-table', Button: 'ui-btn', IconButton: 'ui-iconbtn', Input: 'ui-input', Select: 'ui-input' }
/** Every JSX element in a source: its tag, its opening tag's text, its own
    classes, and the kit classes it renders with — a literal `ui-*`, or its
    kit component's root (a lane class alone on a `<Td>` is a `.ui-td` too;
    round two: `.rb-task-check-cell { padding }` lost to the dense padding
    because the check only measured selectors that NAMED `.ui-td`). */
export const elementsOf = (src) => jsxTags(normal(jsCode(src))).map((t) => {
  const tag = t.match(/^<([A-Za-z][\w.]*)/)[1]
  const m = t.match(/\sclassName=(?:"([^"]*)"|\{`([^`]*)`\})/)
  const classes = m ? (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean) : []
  const kit = [...new Set([...classes.filter((c) => c.startsWith('ui-')), ...(KIT_ROOT[tag] ? [KIT_ROOT[tag]] : [])])]
  return { tag, attrs: t, classes, kit }
})
const ELEMENTS = Object.values(source).flatMap(elementsOf)
/** Can this element carry [attr="value"] (or the state)? Read from the props
    that set it, with the kit component's default; a prop given an expression
    can be anything. */
export function meets(el, attr, value) {
  const a = el.attrs
  const prop = (name) => new RegExp(`\\s${name}(?=[\\s=/>])`).test(a)
  const lit = (name) => a.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
  const expr = (name) => new RegExp(`\\s${name}=\\{`).test(a)
  switch (attr) {
    case 'data-variant': {
      if (expr('variant') || expr('primary') || expr('danger') || expr('data-variant')) return true
      return (lit('variant') ?? lit('data-variant') ?? (prop('primary') ? 'primary' : prop('danger') ? 'danger' : 'secondary')) === value
    }
    case 'data-size': {
      if (expr('size') || expr('small') || expr('data-size')) return true
      return (lit('size') ?? lit('data-size') ?? (prop('small') ? 'sm' : 'md')) === value
    }
    case 'data-align': {
      if (expr('align')) return true
      return (prop('numeric') ? 'right' : (lit('align') ?? 'left')) === value
    }
    case 'data-numeric': return value === 'true' && prop('numeric')
    case ':disabled': return prop('disabled')
    default: return true
  }
}

/* ── the sheet's shape ───────────────────────────────────────────────────── */
/** The sheet's text outside its one `@layer components { … }` block, and the
    statement's place. A rule outside the block would sit in no layer and beat
    every utility (round one, 10). */
export function outsideLayer(css) {
  const c = cssCode(css)
  const statement = c.match(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  const open = c.search(/@layer\s+components\s*\{/)
  if (!statement || open < 0) return { statementFirst: false, rest: c }
  let depth = 0, end = -1
  for (let i = c.indexOf('{', open); i < c.length; i++) {
    if (c[i] === '{') depth++
    else if (c[i] === '}' && --depth === 0) { end = i; break }
  }
  const before = c.slice(0, statement.index).trim()
  const between = c.slice(statement.index + statement[0].length, open).trim()
  const after = end < 0 ? c.slice(open) : c.slice(end + 1).trim()
  return { statementFirst: before === '' && statement.index < open, rest: `${between}${after}` }
}

/** Every class a selector in the sheet names. */
const selectorClasses = (css) => [...cssCode(css).matchAll(/([^{}]+)\{/g)]
  .map((m) => m[1]).filter((s) => !s.trim().startsWith('@'))
  .flatMap((s) => [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1]))
const KIT_CLASSES = new Set([...kitCode.matchAll(/\.(ui-[a-z0-9-]+)/g)].map((m) => m[1]))
/** A class that is neither the lane's nor the kit's (a near miss such as
    `rb-tasks-ghost` used to go uncounted; round one, 10). */
export const strayClasses = (css) => [...new Set(selectorClasses(css))]
  .filter((c) => !/^rb-(task|tpl)-[a-z0-9-]+$/.test(c) && !KIT_CLASSES.has(c))
/** A selector with no lane class anywhere outside a `:not()`: a bare kit
    override that would restyle every Dialog, Table or Input in the app
    (round one, 4; round two: `.ui-dialog-body:not(.rb-task-detail-body)`
    passed and restyled every OTHER Dialog body). */
/** A selector with each `:is(…)` / `:where(…)` expanded into its
    alternatives: `:is(.rb-task-view, .ui-dialog) .ui-dialog-body` is two
    selectors, and the second restyles every Dialog body (round two:
    `sc-is-comma`, once the split learned to keep `:is()` whole). */
export const alternativesOf = (s) => {
  const m = s.match(/:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/)
  if (!m) return [s]
  return selectorsOf(m[1]).flatMap((alt) => alternativesOf(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)))
}
export const unscopedSelectors = (css) => rulesOf(css)
  .flatMap(({ sel }) => selectorsOf(sel))
  .filter((s) => alternativesOf(stripNot(s)).some((alt) => !/\.rb-(task|tpl)-/.test(alt)))

describe('the sheet: one layer, its own classes, every selector scoped', () => {
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is rb-task- / rb-tpl- or the kit\'s', () => {
    expect(strayClasses(sheet)).toEqual([])
  })
  it('every selector carries a lane class', () => {
    expect(unscopedSelectors(sheet)).toEqual([])
  })
  it('CONTROL: the shape guards fire on round one\'s and round two\'s mutants', () => {
    expect(outsideLayer(`${sheet}\n.rb-task-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-tasks-ghost { color: x }')).toEqual(['rb-tasks-ghost'])
    expect(unscopedSelectors('.ui-dialog-body { padding: 0 }')).toEqual(['.ui-dialog-body'])
    expect(unscopedSelectors('.ui-td { padding: 0 }')).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-task-detail .ui-dialog-body { padding: 0 }')).toEqual([])
    expect(unscopedSelectors('.ui-dialog-body:not(.rb-task-detail-body) { padding: 0 }')).toHaveLength(1)
    expect(unscopedSelectors(':is(.rb-task-a, .rb-task-b) .ui-td { padding: 0 }')).toEqual([])
    expect(unscopedSelectors(':is(.rb-task-view, .ui-dialog) .ui-dialog-body { padding: 0 }')).toHaveLength(1)
    expect(unscopedSelectors('.ui-dialog-body:where(.rb-task-a, .x) { padding: 0 }')).toHaveLength(1)
  })
})

/* ── imports ─────────────────────────────────────────────────────────────── */
/** The stylesheet a file imports, resolved against the file's own folder. */
export function importedSheet(file, src) {
  const m = jsCode(src).match(/import\s+['"]([^'"]*rabbitTasks\.css)['"]/)
  return m ? resolve(dirname(resolve(here, file)), m[1]) : null
}
describe('every B2 file imports THIS sheet', () => {
  for (const [key, file] of Object.entries(FILES)) {
    it(`${file} imports rabbitTasks.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key])).toBe(SHEET)
    })
  }
  it('CONTROL: a path that does not exist is caught (round one, 14)', () => {
    expect(importedSheet(FILES.detail, "import './rabbitTasks.css'")).not.toBe(SHEET)
    expect(importedSheet(FILES.detail, "import '../other/rabbitTasks.css'")).not.toBe(SHEET)
  })
})

/* ── classes and attributes ──────────────────────────────────────────────── */
/** Classes written in a className (any `*ClassName` prop) — the strings a
    className takes, not any string (`data-was="rb-task-x"` used to count as a
    use; round one, 10). */
export const classesWritten = (src) => {
  const out = new Set()
  for (const m of normal(src).matchAll(/\b\w*[cC]lassName=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
    for (const c of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^rb-(task|tpl)-/.test(c)) out.add(c)
  }
  return out
}
const declared = new Set(selectorClasses(sheet).filter((c) => /^rb-(task|tpl)-/.test(c)))
const written = new Set(Object.values(source).flatMap((s) => [...classesWritten(jsCode(s))]))

describe('every rb-task- / rb-tpl- class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('CONTROL: a class named only in some other attribute is not a use; a *ClassName prop is', () => {
    expect([...classesWritten('<span data-was="rb-task-new-note" />')]).toEqual([])
    expect([...classesWritten("<span className={'rb-task-x text-dense'} />")]).toEqual(['rb-task-x'])
    expect([...classesWritten('<Table scrollClassName="rb-task-scroll" />')]).toEqual(['rb-task-scroll'])
    expect([...classesWritten("<Table scrollClassName={'rb-task-scroll'} />")]).toEqual(['rb-task-scroll'])
  })
})

/** Attribute selectors this sheet may not use: an operator or a flag the
    reachability scanner cannot evaluate, or a non-data attribute. An ARIA
    state the JSX itself sets (`aria-expanded={…}`) is readable: its values
    are "true" / "false" (round two: `fp-aria-state`). */
const ARIA_STATE = /^aria-(expanded|pressed|selected|checked)="(true|false)"$/
export const unreadableAttributes = (css, src = '') => [...cssCode(css).matchAll(/\[([^\]]+)\]/g)]
  .map((m) => m[1].trim())
  .filter((a) => {
    if (/^data-[a-z-]+="[^"]*"$/.test(a)) return false
    const aria = a.match(ARIA_STATE)
    return !(aria && new RegExp(`\\saria-${aria[1]}=`).test(src))
  })
/** The tones a `[data-tone="…"]` rule may wait for: what priorityTone() can
    return (the source of every data-tone in these files), and the literal
    tones the JSX hands Stat's valueTone (round two: `fp-stat-tone`). */
const PRIORITY_TONES = new Set(['low', 'medium', 'high', 'urgent', undefined, ''].map((p) => priorityTone(p)))
/** The tone literals a `valueTone` prop can hand over: a literal, or the
    string literals inside an expression (`completed > 0 ? 'success' : undefined`). */
const toneLiterals = (tag) => {
  const m = tag.match(/\svalueTone=(?:"([^"]*)"|\{([^}]*)\})/)
  if (!m) return []
  return m[1] !== undefined ? [m[1]] : [...m[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
}
const TONES = new Set([...PRIORITY_TONES, ...jsxTags(jsx).flatMap(toneLiterals)])
export const impossibleTones = (css) => [...cssCode(css).matchAll(/\[data-tone="([^"]*)"\]/g)]
  .map((m) => m[1]).filter((t) => !TONES.has(t))
/** The same premise on the JSX side: every data-tone is priorityTone(…) or a
    literal it can return (round two: `data-tone={priority}` survived, and
    then `[data-tone="danger"]` could never match). */
export const toneSources = (src) => [...jsCode(src).matchAll(/\sdata-tone=(\{[^}]*\}|"[^"]*")/g)]
  .map((m) => m[1])
  .filter((v) => !/^\{priorityTone\(/.test(v) && !(v.startsWith('"') && PRIORITY_TONES.has(v.slice(1, -1))))

describe('the sheet keys on values the JSX can produce', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('only plain [data-x="v"] selectors — no operator, flag or non-data attribute (an ARIA state the JSX sets is allowed)', () => {
    expect(unreadableAttributes(sheet, jsx)).toEqual([])
  })
  it('every data-tone value is one priorityTone() returns, on both sides', () => {
    expect(impossibleTones(sheet)).toEqual([])
    for (const [key, file] of Object.entries(FILES)) expect(toneSources(source[key]), file).toEqual([])
  })
  it('CONTROL: each fires on round one\'s and round two\'s mutants, and lets the legitimate shapes through', () => {
    expect(unreadableAttributes('.rb-task-check[data-checked^="parti"]{}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-task-check[data-checked="partial" i]{}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-task-row[aria-current="true"]{}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-tpl-deps[aria-expanded="true"]{}', '<button aria-expanded={!!at}>')).toEqual([])
    expect(unreadableAttributes('.rb-tpl-deps[aria-expanded="true"]{}', '')).toHaveLength(1)
    expect(unreadableAttributes('.rb-tpl-deps[aria-expanded="open"]{}', '<button aria-expanded={!!at}>')).toHaveLength(1)
    expect(impossibleTones('.rb-task-cell-select[data-tone="critical"]{}')).toEqual(['critical'])
    expect(impossibleTones('.rb-task-cell-select[data-tone="danger"]{}')).toEqual([])
    expect(impossibleTones('.rb-task-x .ui-stat-value[data-tone="success"]{}')).toEqual([])
    expect(toneSources('<span className="rb-task-card-priority" data-tone={priority}>')).toEqual(['{priority}'])
    expect(toneSources('<span className="rb-task-card-priority" data-tone="critical">')).toEqual(['"critical"'])
    expect(toneSources('<span className="rb-task-card-priority" data-tone={priorityTone(priority)}>')).toEqual([])
  })
})

/* ── the cascade ─────────────────────────────────────────────────────────── */
/** Kit rules a lane rule cannot meet on these screens: the light surface,
    another page's scope, and attribute states no B2 element carries.
    Variant, size, alignment and selection are NOT here any more: they are
    read per element from the JSX (round two: `[data-align=`, `[data-numeric=`
    and `.ui-field-stack` were dropped although B2's cells and NewTaskPopup
    carry them). The kit's focus and disabled states are not here either:
    they are fights the lane must LOSE. */
const NOT_HERE = /\[data-surface="light"\]|\[data-surface="chrome"\]|\[data-interactive="true"\]|\[data-highlighted="true"\]|\[data-inactive="true"\]|\[data-wrap="true"\]|\[data-inline="true"\]|\[data-mixed="true"\]|\.tm-|\.at-|\.rs-|\.pj-|\.dash-|\.ui-field-row|::|:active|tfoot/
/** Tested with every :not(…) taken out first: `:hover:not(:disabled)` is a
    hover rule, and the first cut threw it away as a disabled one. */
const notHere = (sel) => NOT_HERE.test(stripNot(sel))
/** The kit's own state in a selector (its treatment must win over a lane
    rule that does not carry the same state). */
const kitState = (sel) => (stripNot(sel).match(/:focus(?:-visible|-within)?|:disabled/) || [null])[0]
/** The compound a child combinator hangs the target from: `.a > .b + .c` → `.a`. */
const parentCompound = (s) => (stripNot(s).match(/([^\s>+~]+)\s*>\s*[^>]*$/) || [])[1]
/** Row classes the JSX never renders selected: the kit's selected fill can
    never reach them (round two: the exemption assumed every row but a task
    row was unselectable, and the template list's editing row is selected). */
const neverSelected = (els) => {
  const rows = els.filter((e) => e.kit.includes('ui-tr'))
  const sel = (e) => /\s(?:data-)?selected(?=[\s=/>])/.test(e.attrs)
  return new Set(rows.flatMap((e) => e.classes).filter((c) => c.startsWith('rb-') && !rows.some((r) => r.classes.includes(c) && sel(r))))
}
/** For each lane rule that styles a kit element, the kit rules for the same
    element and property family it does not strictly outrank. Deliberate
    losses — a hover under the kit's selected fill, anything under the kit's
    focus or disabled treatment — must strictly LOSE: a tie is a load-order
    coin toss (round two). */
export function kitFights(css, kit = indexCss, els = ELEMENTS) {
  const kitRules = rulesOf(kit).flatMap(({ sel, body }) => selectorsOf(sel).map((s) => ({ sel: s, fams: new Set(propsOf(body).map(family)) })))
  const never = neverSelected(els)
  const out = []
  for (const { sel, body } of rulesOf(css)) {
    for (const one of selectorsOf(sel)) {
      const target = lastCompound(stripNot(one))
      const named = (target.match(/\.ui-[a-z0-9-]+/g) || []).map((c) => c.slice(1))
      const lane = (target.match(/\.rb-(?:task|tpl)-[a-z0-9-]+/g) || []).map((c) => c.slice(1))
      // The elements this compound lands on, as the JSX writes them.
      const mine = els.filter((e) => lane.every((c) => e.classes.includes(c)) && named.every((c) => e.kit.includes(c)))
      const kitCls = [...new Set([...named, ...(lane.length ? mine.flatMap((e) => e.kit) : [])])]
      if (!kitCls.length) continue
      const fams = new Set(propsOf(body).map(family))
      for (const k of kitRules) {
        if (notHere(k.sel)) continue
        const kt = lastCompound(stripNot(k.sel))
        if (!kitCls.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(kt))) continue
        if (![...fams].some((f) => k.fams.has(f))) continue
        // A kit rule keyed on a variant, size or alignment none of these
        // elements has cannot meet them; nor a disabled rule on an element
        // that is never disabled.
        const keyed = [...kt.matchAll(/\[(data-(?:variant|size|align|numeric))="([^"]*)"\]/g)].map(([, a, v]) => [a, v])
        const state = kitState(k.sel)
        // A lane rule that excludes the kit's state (`:not(:disabled)`) never meets it.
        if (state && one.includes(`:not(${state})`)) continue
        if (state === ':disabled' && !stripNot(one).includes(':disabled')) keyed.push([':disabled', 'true'])
        // Two child combinators whose parents no element is both of never meet
        // (`.rb-task-prop-grid > .ui-field` and `.ui-field-stack > .ui-field`).
        const lp = parentCompound(one), kp = parentCompound(k.sel)
        if (lp && kp) {
          const need = [...`${lp} ${kp}`.matchAll(/\.([\w-]+)/g)].map((m) => m[1])
          if (!els.some((e) => need.every((c) => e.classes.includes(c) || e.kit.includes(c)))) continue
        }
        if (keyed.length && mine.length && !mine.some((e) => keyed.every(([a, v]) => meets(e, a, v)))) continue
        // The selected fill cannot reach a row that is never selected.
        if (/\[data-selected="true"\]/.test(k.sel) && [...never].some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(one))) continue
        const deliberate = (/:hover/.test(one) && /\[data-selected="true"\]/.test(k.sel))
          || (state !== null && !stripNot(one).includes(state))
        const cmp = gt(specificity(one), specificity(k.sel))
        if (deliberate ? cmp >= 0 : cmp <= 0) out.push(`${one} ${deliberate ? 'ties or beats' : 'ties or loses to'} ${k.sel}`)
      }
    }
  }
  return out
}

describe('no rule loses a fight it cannot see', () => {
  it('every rule on a kit element outranks the kit\'s rules for the same property, hover included', () => {
    expect(kitFights(sheet)).toEqual([])
  })
  // B1's `weakAgainstKit` is not asserted here: `kitFights` measures the same
  // elements (a lane class sharing its element with a kit class) against more
  // kit rules, and reads the element's size where B1's check assumes every
  // size (round two: `fp-size-blind`). The CONTROL below proves it catches
  // B1's shape.
  it('no rule sets a property that a utility on the same element also sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('CONTROL: kitFights fires on round one\'s and round two\'s shapes', () => {
    const on = (snippet) => elementsOf(snippet)
    // round one: the active edge at (0,3,0) ties the input hover and loses to the button hover.
    expect(kitFights('.ui-input.rb-task-tool[data-active="true"] { border-color: x }').join('\n')).toMatch(/:hover/)
    expect(kitFights('.ui-btn.rb-task-tool[data-active="true"] { border-color: x }', indexCss, on('<Button className="rb-task-tool" primary />')).join('\n')).toMatch(/primary.*:hover/)
    expect(kitFights('.rb-task-table .ui-td { padding-top: 2px }').join('\n')).toMatch(/data-dense/)
    expect(kitFights('.rb-task-wrap .rb-task-x .ui-tr.rb-task-row:hover > .ui-td { background-color: x }').join('\n')).toMatch(/ties or beats/)
    expect(kitFights('.rb-task-row:hover > .ui-td { background-color: x }')).toEqual([])
    // round two: a rule by its lane class alone, on a kit element.
    expect(kitFights('.rb-task-tool[data-active="true"] { border-color: x }', indexCss, on('<select className="ui-input rb-task-tool" data-size="sm" />')).join('\n')).toMatch(/\.ui-input:hover/)
    expect(kitFights('.rb-task-check-cell { padding: 0 }', indexCss, on('<Td className="rb-task-check-cell" />')).join('\n')).toMatch(/data-dense/)
    expect(kitFights('.rb-task-group-cell { padding-left: 0 }', indexCss, on('<Td className="rb-task-group-cell" />')).join('\n')).toMatch(/\.ui-td/)
    // round two: alignment is read per cell.
    expect(kitFights('.ui-td.rb-task-cell { text-align: left }', indexCss, on('<Td className="rb-task-cell" numeric />')).join('\n')).toMatch(/data-align="right"/)
    expect(kitFights('.ui-td.rb-task-cell { text-align: left }', indexCss, on('<Td className="rb-task-cell" />')).join('\n')).not.toMatch(/data-align="right"/)
    // round two: selection is read per row; a tie with the selected fill is a coin toss.
    expect(kitFights('.rb-tpl-body .ui-table.rb-tpl-table .ui-tr:hover > .ui-td { background-color: x }', indexCss, on('<Row selected={isEditing} />')).join('\n')).toMatch(/ties or beats .*data-selected/)
    expect(kitFights('.ui-tr.rb-task-row:hover > .ui-td { background-color: x }', indexCss, on('<Row className="rb-task-row" selected={s} />')).join('\n')).toMatch(/ties or beats .*data-selected/)
    expect(kitFights('.rb-task-a .rb-task-b .ui-tr.rb-task-group-row:hover > .ui-td { background-color: x }', indexCss, on('<Row className="rb-task-group-row" />')).join('\n')).not.toMatch(/data-selected/)
    // round two: the kit's disabled treatment wins over an element that can be disabled.
    expect(kitFights('.rb-task-a .rb-task-b .ui-btn.rb-task-tool { border-color: x }', indexCss, on('<Button className="rb-task-tool" disabled={x} />')).join('\n')).toMatch(/ties or beats \.ui-btn:disabled/)
    expect(kitFights('.rb-task-a .rb-task-b .ui-btn.rb-task-tool { border-color: x }', indexCss, on('<Button className="rb-task-tool" />')).join('\n')).not.toMatch(/:disabled/)
    // round two, too broad before: a variant or size the element never has.
    expect(kitFights('.ui-btn.rb-task-tool[data-active="true"] { border-color: x }', indexCss, on('<Button className="rb-task-tool" />')).join('\n')).not.toMatch(/primary/)
    expect(kitFights('.ui-input.rb-task-prop { padding: 0 16px }', indexCss, on('<select className="ui-input rb-task-prop" />')).join('\n')).not.toMatch(/data-size="sm"/)
    expect(kitFights('.ui-input.rb-task-prop { padding: 0 16px }', indexCss, on('<select className="ui-input rb-task-prop" data-size="sm" />')).join('\n')).toMatch(/data-size="sm"/)
    // round two: a state the lane excludes, and parents that are never one element.
    expect(kitFights('.ui-input.rb-task-date-input[data-empty="true"] { color: x }', indexCss, on('<input className="ui-input rb-task-date-input" disabled={ro} />')).join('\n')).toMatch(/:disabled/)
    expect(kitFights('.ui-input.rb-task-date-input[data-empty="true"]:not(:disabled) { color: x }', indexCss, on('<input className="ui-input rb-task-date-input" disabled={ro} />')).join('\n')).not.toMatch(/:disabled/)
    expect(kitFights('.rb-task-prop-grid > .ui-field + .ui-field { margin-top: 0 }', indexCss, on('<div className="ui-field-stack"><div className="rb-task-prop-grid"><Field /></div></div>')).join('\n')).not.toMatch(/ui-field-stack/)
    expect(kitFights('.rb-task-prop-grid > .ui-field + .ui-field { margin-top: 0 }', indexCss, on('<div className="ui-field-stack rb-task-prop-grid"><Field /></div>')).join('\n')).toMatch(/ui-field-stack/)
    // B1's shape, caught by kitFights: a lane rule on an element that wears a kit class, at the kit's own weight.
    expect(kitFights('.rb-task-x { padding: 0 }', indexCss, on('<Button className="rb-task-x" />')).join('\n')).toMatch(/ties or loses to \.ui-btn/)
    expect(kitFights('.rb-task-x { width: 1px }', indexCss, on('<input className="ui-input rb-task-x" />')).join('\n')).toMatch(/ties or loses to \.ui-input/)
    // round two: a kit selector with a comma inside :where() is one selector.
    expect(selectorsOf(':where(tr, li, .ui-hover-host):focus-within .ui-hover-actions, .ui-hover-actions:focus-within')).toHaveLength(2)
  })
})

/* ── colour ──────────────────────────────────────────────────────────────── */
/** Every CSS named colour (and the system colours), matched in any case:
    CSS names are case-insensitive (round two: `Gray`, `cyan` and
    `darkorange` — which the old lookbehind rejected after its `k` — all
    passed). `transparent` and `currentColor` are not colours of their own. */
const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
  + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
  + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
  + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
  + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
  + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta '
  + 'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
  + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen '
  + 'canvas canvastext buttonface buttontext highlight highlighttext graytext linktext accentcolor accentcolortext')
  .split(' ').sort((a, b) => b.length - a.length).join('|')
const NAMED_RE = new RegExp(`(?<![\\w-])(?:${NAMED})(?![\\w-])`, 'gi')
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi
/** Every colour written as a literal, in any spelling (round one, 6). */
export const colourLiterals = (css) => {
  const c = cssCode(css)
  const decls = [...c.matchAll(/:\s*([^;{}]+)/g)].map((m) => m[1])
  return [
    ...(c.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
    ...(c.match(COLOUR_FN) || []),
    ...decls.flatMap((v) => v.match(NAMED_RE) || []),
  ]
}
/** A px length (rem / em at 16px); anything else (calc, var) is not read. */
const px = (t) => {
  const m = t.match(/^(-?\d*\.?\d+)(px|rem|em)?$/)
  return m ? Math.abs(parseFloat(m[1])) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) : null
}
const layers = (v) => selectorsOf(v)
/** An inset shadow in a signal, focus or selection colour wide enough to be a
    fill: any blur, or a spread or offset of 3px or more, in any unit (round
    two: `1rem`, `64px 64px` of blur and spread, and `--color-selection` all
    passed the old `inset 0 0 0 Npx` pattern). An edge (1–2px, no blur) is
    allowed. */
export const fillShadows = (css) => rulesOf(css).filter(({ body }) =>
  [...body.matchAll(/box-shadow\s*:\s*([^;]+)/g)].some((m) => layers(m[1]).some((layer) => {
    if (!/\binset\b/.test(layer) || !/var\(\s*--color-(?:signal|focus|selection)(?![\w-])/.test(layer)) return false
    const lengths = layer.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/\binset\b/, ' ').trim().split(/\s+/).map(px)
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths.filter((n) => n !== null)
    return blur > 0 || spread >= 3 || x >= 3 || y >= 3
  }))).map(({ sel }) => sel)
/** Grounds in a signal colour under text, in the spellings rounds one and two
    found: the signal tokens, the focus and selection tokens (the same
    orange), and an inset shadow wide enough to be a fill. */
export const orangeGrounds = (css) => [
  ...signalGrounds(css),
  ...rulesOf(css).filter(({ body }) => /background(-color|-image)?\s*:[^;]*var\(\s*--color-(?:focus|selection)(?![\w-])/.test(body)).map(({ sel }) => sel),
  ...fillShadows(css),
]
/** A lane property's setters: the JSX elements whose style object sets it —
    in code (comments out), as a key (round two: a comment naming the
    property counted as setting it). */
const settersOf = (p, els) => els.filter((e) => new RegExp(`style=\\{\\{[^]*?['"]${p}['"]\\s*:`).test(e.attrs))
const setInSheet = (p, css) => new RegExp(`(?:^|[\\s;{])${p}\\s*:`).test(cssCode(css))
/** Custom properties read and defined nowhere: a kit token must be DEFINED in
    index.css (anchored — `--line-height` is not `--text-dense--line-height`),
    and the sheet's own `--rb-*` must be set by the JSX's style object or by
    the sheet itself (round two: `fp-sheet-custom-prop`). */
export const undefinedProperties = (css, kit, sources) => {
  const readProps = [...new Set([...cssCode(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))]
  const k = cssCode(kit)
  const els = sources.flatMap(elementsOf)
  return readProps.filter((p) => p.startsWith('--rb-')
    ? !(setInSheet(p, css) || settersOf(p, els).length)
    : !new RegExp(`(?:^|[\\s;{])${p}\\s*:`).test(k))
}
/** A `--rb-*` the JSX sets on one element, read by a rule that does not name
    that element's class: it lands where nothing sets it (round two:
    `var(--rb-ms)` read on the board card, where only key-date rows set it). */
export const readAwayFromSetter = (css, sources) => {
  const els = sources.flatMap(elementsOf)
  const out = []
  for (const { sel, body } of rulesOf(css)) {
    for (const [, p] of body.matchAll(/var\(\s*(--rb-[a-z0-9-]+)/g)) {
      if (setInSheet(p, css)) continue
      const classes = settersOf(p, els).flatMap((e) => e.classes)
      for (const one of selectorsOf(sel)) {
        if (!classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(one))) out.push(`${p} @ ${one}`)
      }
    }
  }
  return out
}

describe('rabbitTasks.css writes no colour of its own, and paints no orange ground', () => {
  it('no colour literal of any spelling (@theme is the only place a colour is written)', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined — the kit\'s in index.css, its own by the JSX — and read where it is set', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('C6: no rule paints a signal, focus or selection ground (the tint, and a 1–2px edge, are allowed)', () => {
    expect(orangeGrounds(sheet)).toEqual([])
  })
  it('CONTROL: each fires on the spellings the stage-1 sheet and rounds one and two used', () => {
    expect(colourLiterals('.rb-task-x { color: #fb923c; }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { color: #FFF; }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { color: #EA580C; }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { color: #ffffff80; }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { background-color: rgba(234, 88, 12, 0.08); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { background-color: rgb(234 88 12); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { color: oklch(0.7 0.1 50); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-none { color: hsl(20 3% 54%); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-none { color: gray; }')).toEqual(['gray'])
    expect(colourLiterals('.rb-task-none { color: Gray; }')).toEqual(['Gray'])
    expect(colourLiterals('.rb-task-none { color: darkorange; }')).toEqual(['darkorange'])
    expect(colourLiterals('.rb-task-none { color: cyan; }')).toEqual(['cyan'])
    expect(colourLiterals('.rb-task-none { color: var(--color-ink-3); white-space: nowrap; background-color: transparent; fill: currentColor; }')).toEqual([])
    expect(orangeGrounds('.rb-tpl-edit[data-active="true"] { background-color: var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { background-color: var(--color-focus); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 0 0 0 999px var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 0 0 0 2rem var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 0 0 64px 64px var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 0 0 0 999px var(--color-selection); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: 0 1px 2px var(--color-shadow), inset 0 0 0 4px var(--color-focus); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { background-color: var(--color-signal-tint); box-shadow: inset 0 0 0 1px var(--color-signal); }')).toEqual([])
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 2px 0 0 0 var(--color-signal); }')).toEqual([])
    const src = Object.values(source)
    expect(undefinedProperties('.rb-task-x { color: var(--rb-none-ink); }', indexCss, src)).toEqual(['--rb-none-ink'])
    expect(undefinedProperties('.rb-task-x { line-height: var(--line-height); }', indexCss, src)).toEqual(['--line-height'])
    expect(undefinedProperties('.rb-task-x { color: var(--rb-quiet-ink); }', indexCss, ["// the quiet ink, '--rb-quiet-ink'\n<span className=\"rb-task-x\" />"])).toEqual(['--rb-quiet-ink'])
    expect(undefinedProperties('.rb-task-x { --rb-none: 1px; padding: var(--rb-none); }', indexCss, src)).toEqual([])
    expect(readAwayFromSetter('.rb-task-card-priority { color: var(--rb-ms); }', src)).toEqual(['--rb-ms @ .rb-task-card-priority'])
    expect(readAwayFromSetter('.rb-task-ms .rb-task-ms-icon { color: var(--rb-ms); }', src)).toEqual([])
  })
})

/* ── the state extraction holds ──────────────────────────────────────────── */
/** Every `style={…}` these files may write: the key date's colour (data), the
    GatedAction's gap, and the dependency list's measured place. Nothing else — a
    style that is not here is a state in some spelling B1's scanner does not
    know (arithmetic, a template literal, a custom property; round one, 5). */
const STYLES_ALLOWED = [
  "{{ '--rb-ms': milestone.color }}",
  "{{ gap: 12, alignItems: 'center' }}",
  '{{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}',
]
/** The spread attributes these files may write: the row's props passed on,
    and the drop handlers. A spread is otherwise a way to hand an element a
    style or className chosen by state (round two). */
const SPREADS_ALLOWED = ['rowProps', 'drop.handlers', '(drop?.handlers || {})']
/** Two self-closing elements chosen by a ternary, as an element-swap that
    changes the lane classes: a state picking a class in another spelling
    (round two: `? <CheckSquare className="rb-task-hint-danger" /> : <Square />`). */
const laneClassesOf = (tag) => ((tag.match(/className="([^"]*)"/) || [])[1] || '').split(/\s+/).filter((c) => c.startsWith('rb-')).sort().join(' ')
export function stateLeaks(src) {
  const code = normal(jsCode(src))
  const leaks = [...inlineStateTernaries(code)]
  // A style is one of the allowed object literals — never an identifier or a call.
  for (const m of code.matchAll(/\sstyle=\{(?!\{)/g)) leaks.push(`style={${code.slice(m.index + 8, m.index + 40)}`)
  for (const m of code.matchAll(/style=(\{\{[^]*?\}\})/g)) {
    if (!STYLES_ALLOWED.includes(m[1].replace(/\s+/g, ' '))) leaks.push(`style=${m[1].slice(0, 60)}`)
  }
  // A className is a literal, or a template whose only hole passes the
  // caller's own className through.
  for (const m of code.matchAll(/className=\{([^]*?)\}(?=[\s/>])/g)) {
    const v = m[1].trim()
    const passThrough = /^`[^`$]*\$\{className\}[^`$]*`(\.trim\(\))?$/.test(v)
    const literal = /^(['"])[^'"]*\1$/.test(v) || /^`[^`$]*`$/.test(v)
    if (!passThrough && !literal) leaks.push(`className={${v.slice(0, 60)}}`)
  }
  // A spread attribute passes only what the allowlist names (brace-matched:
  // `{...(c && { style: { opacity: 0.5 } })}` nests two deep).
  for (const m of code.matchAll(/\s\{\.\.\./g)) {
    let d = 0, i = m.index + 1
    for (; i < code.length; i++) { if (code[i] === '{') d++; else if (code[i] === '}' && --d === 0) break }
    const inner = code.slice(m.index + 5, i).trim()
    if (!SPREADS_ALLOWED.includes(inner)) leaks.push(`{...${inner.slice(0, 50)}}`)
  }
  // An element swap that changes the lane classes.
  for (const m of code.matchAll(/\?\s*(<[A-Z]\w*[^<>]*\/>)\s*:\s*(<[A-Z]\w*[^<>]*\/>)/g)) {
    if (laneClassesOf(m[1]) !== laneClassesOf(m[2])) leaks.push(`? ${m[1].slice(0, 40)} : ${m[2].slice(0, 40)}`)
  }
  // An icon's colour and stroke props take no expression (a number is not one).
  for (const m of code.matchAll(/\s(color|fill|stroke|opacity)=\{/g)) leaks.push(`${m[1]}={…}`)
  for (const m of code.matchAll(/\s(strokeWidth|size)=\{([^}]*)\}/g)) {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(m[2])) leaks.push(`${m[1]}={${m[2].slice(0, 30)}}`)
  }
  // No colour literal at all in these files: hex, or a colour function.
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) leaks.push(h)
  for (const f of code.match(COLOUR_FN) || []) leaks.push(f)
  return leaks
}

describe('the state extraction holds in all four B2 files', () => {
  for (const [key, file] of Object.entries(FILES)) {
    it(`${file}: no state in a style, a className, a spread or an icon prop, and no colour literal`, () => {
      expect(stateLeaks(source[key])).toEqual([])
    })
  }
  it('CONTROL: every spelling rounds one and two slipped past, as a snippet', () => {
    const fires = [
      // round one, 5
      "<Row className=\"rb-task-ms\" style={{ '--rb-ms': isProjectBound ? 'var(--color-success)' : milestone.color }}>",
      "<Diamond className=\"rb-task-ms-icon\" color={isProjectBound ? 'var(--color-success)' : undefined} aria-hidden=\"true\" />",
      "{checked && <Check color={checked ? 'var(--color-signal)' : 'transparent'} />}",
      '<div className="rb-task-detail-body" style={{ opacity: 0.5 + 0.5 * (bidTotal != null) }}>',
      '<div className="ui-field-stack" style={{ opacity: 1 - 0.4 * !draft.assignee_id }}>',
      '<div className="rb-task-detail-body" style={{ color: `var(--color-${priorityTone(task.priority)})` }}>',
      '<div className="rb-task-table-wrap" style={{ boxShadow: `inset 0 0 0 ${+someSelected}px var(--color-signal)` }}>',
      '<td className={`rb-tpl-desc-cell ${EMPTY_CLASS[+!tmpl.description]}`}>',
      // the shapes the four files shipped
      '<span style={{ opacity: isSelected ? 1 : 0 }} />',
      "<tr className={`rb-task-row ${canWrite ? 'cursor-grab' : ''}`}>",
      "<span style={{ color: task.phase_id ? '#f4a261' : '#57534e' }} />",
      "<span style={{ backgroundColor: isProjectSpecific ? '#ea580c' : 'transparent' }} />",
      // round one, 15: a colour literal anywhere in the file
      '<div className="rb-task-detail-props" data-was="#fb923c">',
      // round two
      'const bidStyle = { opacity: 0.5 }\n<span className="rb-task-bid" style={bidStyle} />',
      '<span className="rb-task-bid" {...(bidTotal == null && { style: { opacity: 0.5 } })} />',
      "<span className=\"rb-task-bid\" {...(bidTotal == null && { className: 'rb-task-dim' })} />",
      '{isSelected ? <CheckSquare className="rb-task-hint-danger" aria-hidden="true" /> : <Square className="rb-task-check-icon" aria-hidden="true" />}',
      '<Diamond className="rb-task-ms-icon" strokeWidth={isProjectBound ? 3 : 2} aria-hidden="true" />',
      "const bound = { color: 'rgb(34 197 94)' }",
    ]
    for (const snippet of fires) expect(stateLeaks(snippet), snippet).not.toEqual([])
    // and the shapes that are fine
    const passes = [
      '{collapsed ? <ChevronRight className="rb-task-section-chevron" aria-hidden="true" /> : <ChevronDown className="rb-task-section-chevron" aria-hidden="true" />}',
      '<Row className="rb-task-group-row" {...drop.handlers}>',
      '<Diamond className="rb-task-ms-icon" strokeWidth={2} aria-hidden="true" />',
      "<Row className=\"rb-task-ms\" style={{ '--rb-ms': milestone.color }}>",
    ]
    for (const snippet of passes) expect(stateLeaks(snippet), snippet).toEqual([])
  })
})

/* ── the kit request K1 at its one caller ─────────────────────────────────── */
describe('Tasks completed keeps its tone through Stat\'s valueTone (K1)', () => {
  it('the tile passes valueTone="success" and the other three pass none', () => {
    // Whole opening tags, walked brace-aware (round two: a `>` inside a prop
    // expression cut the old regex's tag short).
    const stats = jsxTags(jsCode(source.tasks)).filter((t) => /^<Stat\b/.test(t))
    expect(stats).toHaveLength(4)
    const toned = stats.filter((s) => /\svalueTone=/.test(s))
    expect(toned.map((s) => s.match(/label="([^"]+)"/)[1])).toEqual(['Tasks completed'])
    // a literal "success", or an expression whose only tone is 'success'
    expect(toneLiterals(toned[0])).toEqual(['success'])
  })
})
