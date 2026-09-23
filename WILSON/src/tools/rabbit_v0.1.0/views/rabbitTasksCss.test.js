// =============================================================================
// rabbitTasks.css — the guards for lane B2's stylesheet and its four files
// (UI overhaul B2, 2026-09-23). Pattern: rabbitShellCss.test.js, whose
// scanners this file imports from rabbitCssGuards.js rather than re-types
// (T2 hand-off §5 trap 8). The render half is rabbitTasksRender.test.jsx.
//
// Pinned here:
//   1. the sheet's shape: the @layer statement first, every rule inside the
//      one `@layer components` block, every class `rb-task-` / `rb-tpl-` or a
//      kit class, every selector scoped by one of them (no bare kit override);
//   2. every file that wears a class imports THIS sheet (its path resolved);
//   3. every class declared is written in a className, and every one written
//      is declared; every [data-x="v"] a rule matches can be produced, with no
//      attribute operator or flag the scanner cannot read;
//   4. no rule loses a fight it cannot see: each rule that styles a kit
//      element is measured against the kit's own rules for that element in
//      index.css, hover included (round one found Sort and Group losing their
//      active edge to the kit's hover), and no rule sets what a utility on the
//      same element sets;
//   5. colour: no literal of any spelling, every custom property defined (the
//      sheet's own set by the JSX), no signal / focus / selection ground;
//   6. the state extraction holds in all four files: B1's scanner, and a
//      stricter rule of B2's own — a style or className may carry no
//      expression beyond a short allowlist, and no icon takes a colour prop.
// Round one's guard review ran 84 mutants and 45 survived; every spelling it
// used against these guards is a CONTROL below, run through the SAME
// predicate the assertion uses.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  cssCode, jsCode, rulesOf, lastCompound, propsOf, family, specificity, gt,
  unreachableAttributeValues, weakAgainstKit, utilityConflicts, inlineStateTernaries,
  signalGrounds, indexCss,
} from '../rabbitCssGuards.js'
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitTasks.css')
const sheet = read('rabbitTasks.css')
const code = cssCode(sheet)
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
    is the same thing in a spelling they miss (round one, 16). */
const normal = (src) => src.replace(/className=\{'([^']*)'\}/g, 'className="$1"').replace(/className=\{"([^"]*)"\}/g, 'className="$1"')
const jsx = Object.values(source).map((s) => normal(jsCode(s))).join('\n')

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
/** A selector with no lane class anywhere: a bare kit override that would
    restyle every Dialog, Table or Input in the app (round one, 4). */
export const unscopedSelectors = (css) => rulesOf(css)
  .flatMap(({ sel }) => sel.split(','))
  .map((s) => s.trim())
  .filter((s) => !/\.rb-(task|tpl)-/.test(s))

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
  it('CONTROL: the shape guards fire on round one\'s mutants', () => {
    expect(outsideLayer(`${sheet}\n.rb-task-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-tasks-ghost { color: x }')).toEqual(['rb-tasks-ghost'])
    expect(unscopedSelectors('.ui-dialog-body { padding: 0 }')).toEqual(['.ui-dialog-body'])
    expect(unscopedSelectors('.ui-td { padding: 0 }')).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-task-detail .ui-dialog-body { padding: 0 }')).toEqual([])
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
/** Classes written in a className — the strings a className takes, not any
    string (`data-was="rb-task-x"` used to count as a use; round one, 10). */
export const classesWritten = (src) => {
  const out = new Set()
  for (const m of normal(src).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
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
  it('CONTROL: a class named only in some other attribute is not a use', () => {
    expect([...classesWritten('<span data-was="rb-task-new-note" />')]).toEqual([])
    expect([...classesWritten("<span className={'rb-task-x text-dense'} />")]).toEqual(['rb-task-x'])
  })
})

/** Attribute selectors this sheet may not use: an operator or a flag the
    reachability scanner cannot evaluate, or a non-data attribute. */
export const unreadableAttributes = (css) => [...cssCode(css).matchAll(/\[([^\]]+)\]/g)]
  .map((m) => m[1])
  .filter((a) => !/^data-[a-z-]+="[^"]*"$/.test(a.trim()))
/** Values a `[data-tone="…"]` rule waits for that priorityTone() can never
    return (it is the only source of data-tone in these files). */
const PRIORITY_TONES = new Set(['low', 'medium', 'high', 'urgent', undefined, ''].map((p) => priorityTone(p)))
export const impossibleTones = (css) => [...cssCode(css).matchAll(/\[data-tone="([^"]*)"\]/g)]
  .map((m) => m[1]).filter((t) => !PRIORITY_TONES.has(t))

describe('the sheet keys on values the JSX can produce', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('only plain [data-x="v"] selectors — no operator, flag or non-data attribute', () => {
    expect(unreadableAttributes(sheet)).toEqual([])
  })
  it('every data-tone value is one priorityTone() returns', () => {
    expect(impossibleTones(sheet)).toEqual([])
  })
  it('CONTROL: the three fire on round one\'s mutants', () => {
    expect(unreadableAttributes('.rb-task-check[data-checked^="parti"]{}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-task-check[data-checked="partial" i]{}')).toHaveLength(1)
    expect(unreadableAttributes('.rb-task-row[aria-current="true"]{}')).toHaveLength(1)
    expect(impossibleTones('.rb-task-cell-select[data-tone="critical"]{}')).toEqual(['critical'])
    expect(impossibleTones('.rb-task-cell-select[data-tone="danger"]{}')).toEqual([])
  })
})

/* ── the cascade ─────────────────────────────────────────────────────────── */
/** Kit rules a lane rule cannot meet on these screens: the light surface,
    another page's scope, and attribute states no B2 element carries. States
    that DO reach these elements — :hover above all — stay in. */
const NOT_HERE = /\[data-surface="light"\]|\[data-surface="chrome"\]|\[data-interactive="true"\]|\[data-highlighted="true"\]|\[data-inactive="true"\]|\[data-wrap="true"\]|\[data-inline="true"\]|\[data-mixed="true"\]|\[data-align=|\[data-numeric=|\.tm-|\.at-|\.rs-|\.pj-|\.dash-|\.ui-field-row|\.ui-field-stack|:focus|:disabled|::|:active|tfoot/
/** Tested with every :not(…) taken out first: `:hover:not(:disabled)` is a
    hover rule, and the first cut threw it away as a disabled one. */
const notHere = (sel) => NOT_HERE.test(sel.replace(/:not\([^)]*\)/g, ''))
/** For each lane rule that styles a kit element, the kit rules for the same
    element and property family it does not strictly outrank. Deliberate
    losses are listed (a hover must lose to the kit's selected row). */
export function kitFights(css, kit = indexCss) {
  const kitRules = rulesOf(kit).flatMap(({ sel, body }) => sel.split(',').map((s) => ({ sel: s.trim(), fams: new Set(propsOf(body).map(family)) })))
  const out = []
  for (const { sel, body } of rulesOf(css)) {
    for (const one of sel.split(',').map((s) => s.trim())) {
      const target = lastCompound(one)
      const kitCls = (target.match(/\.ui-[a-z0-9-]+/g) || [])
      if (!kitCls.length) continue
      const fams = new Set(propsOf(body).map(family))
      for (const k of kitRules) {
        if (notHere(k.sel)) continue
        // The kit's selected-row rules reach only a row that can be selected:
        // a task row. A group or key-date row never is.
        if (/\[data-selected="true"\]/.test(k.sel) && !/\.rb-task-row\b/.test(one)) continue
        const kt = lastCompound(k.sel)
        if (!kitCls.some((c) => new RegExp(`${c.replace('.', '\\.')}(?![\\w-])`).test(kt))) continue
        if (![...fams].some((f) => k.fams.has(f))) continue
        const deliberate = /:hover/.test(one) && /\[data-selected="true"\]/.test(k.sel)
        const wins = gt(specificity(one), specificity(k.sel)) > 0
        if (deliberate ? wins : !wins) out.push(`${one} ${deliberate ? 'beats' : 'ties or loses to'} ${k.sel}`)
      }
    }
  }
  return out
}

describe('no rule loses a fight it cannot see', () => {
  it('every rule on a kit element outranks the kit\'s rules for the same property, hover included', () => {
    expect(kitFights(sheet)).toEqual([])
  })
  it('B1\'s check: a rule on an element that also wears .ui-input / .ui-btn outranks the kit', () => {
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
  })
  it('no rule sets a property that a utility on the same element also sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('CONTROL: kitFights fires on round one\'s shapes, and on the deliberate loss when it stops losing', () => {
    // The active edge at (0,3,0) loses to the kit's input hover (0,3,0 tie) and button hover (0,4,0).
    expect(kitFights('.ui-input.rb-task-tool[data-active="true"] { border-color: x }').join('\n')).toMatch(/:hover/)
    expect(kitFights('.ui-btn.rb-task-tool[data-active="true"] { border-color: x }').join('\n')).toMatch(/:hover/)
    // The dense padding written one class lighter.
    expect(kitFights('.rb-task-table .ui-td { padding-top: 2px }').join('\n')).toMatch(/data-dense/)
    // A row hover that would out-rank the kit's selected fill.
    expect(kitFights('.rb-task-wrap .rb-task-x .ui-tr.rb-task-row:hover > .ui-td { background-color: x }').join('\n')).toMatch(/beats/)
    expect(kitFights('.rb-task-row:hover > .ui-td { background-color: x }')).toEqual([])
  })
})

/* ── colour ──────────────────────────────────────────────────────────────── */
const NAMED = 'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|beige|ivory|coral|salmon|tomato|crimson|indigo|violet|khaki|tan|wheat|linen|snow|azure|lavender|plum|orchid|chocolate|sienna|peru|firebrick|darkgray|lightgray|dimgray|slategray|whitesmoke|gainsboro'
/** Every colour written as a literal, in any spelling (round one, 6). */
export const colourLiterals = (css) => {
  const c = cssCode(css)
  const decls = [...c.matchAll(/:\s*([^;{}]+)/g)].map((m) => m[1])
  return [
    ...(c.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
    ...(c.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g) || []),
    ...decls.flatMap((v) => v.match(new RegExp(`(?<![\\w-])(?:${NAMED})(?![\\w-])`, 'g')) || []),
  ]
}
/** Grounds in a signal colour under text, in the spellings round one found:
    the signal tokens, the focus and selection tokens (the same orange), and
    an inset shadow wide enough to be a fill. */
export const orangeGrounds = (css) => [
  ...signalGrounds(css),
  ...rulesOf(css).filter(({ body }) => /background(-color|-image)?\s*:[^;]*var\(\s*--color-(?:focus|selection)(?![\w-])/.test(body)).map(({ sel }) => sel),
  ...rulesOf(css).filter(({ body }) => /box-shadow\s*:[^;]*inset\s+0\s+0\s+0\s+([3-9]|\d{2,})px\s+var\(\s*--color-(?:signal|focus)/.test(body)).map(({ sel }) => sel),
]
/** Custom properties read and defined nowhere: a kit token must be DEFINED in
    index.css (anchored — `--line-height` is not `--text-dense--line-height`),
    and the sheet's own `--rb-*` must be set by the JSX. */
export const undefinedProperties = (css, kit, sources) => {
  const readProps = [...new Set([...cssCode(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))]
  const k = cssCode(kit)
  return readProps.filter((p) => p.startsWith('--rb-')
    ? !sources.some((s) => s.includes(`'${p}'`))
    : !new RegExp(`(?:^|[\\s;{])${p}\\s*:`).test(k))
}

describe('rabbitTasks.css writes no colour of its own, and paints no orange ground', () => {
  it('no colour literal of any spelling (@theme is the only place a colour is written)', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined — the kit\'s in index.css, its own by the JSX', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
  })
  it('C6: no rule paints a signal, focus or selection ground (the tint is allowed)', () => {
    expect(orangeGrounds(sheet)).toEqual([])
  })
  it('CONTROL: each fires on the spellings the stage-1 sheet and round one used', () => {
    expect(colourLiterals('.rb-task-x { color: #fb923c; }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-x { background-color: rgba(234, 88, 12, 0.08); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-none { color: hsl(20 3% 54%); }')).toHaveLength(1)
    expect(colourLiterals('.rb-task-none { color: gray; }')).toEqual(['gray'])
    expect(colourLiterals('.rb-task-none { color: var(--color-ink-3); white-space: nowrap; }')).toEqual([])
    expect(orangeGrounds('.rb-tpl-edit[data-active="true"] { background-color: var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { background-color: var(--color-focus); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { box-shadow: inset 0 0 0 999px var(--color-signal); }')).toHaveLength(1)
    expect(orangeGrounds('.rb-task-x { background-color: var(--color-signal-tint); box-shadow: inset 0 0 0 1px var(--color-signal); }')).toEqual([])
    expect(undefinedProperties('.rb-task-x { color: var(--rb-none-ink); }', indexCss, Object.values(source))).toEqual(['--rb-none-ink'])
    expect(undefinedProperties('.rb-task-x { line-height: var(--line-height); }', indexCss, Object.values(source))).toEqual(['--line-height'])
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
export function stateLeaks(src) {
  const code = normal(jsCode(src))
  const leaks = [...inlineStateTernaries(code)]
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
  // An icon's colour props take no expression.
  for (const m of code.matchAll(/\s(color|fill|stroke|opacity)=\{/g)) leaks.push(`${m[1]}={…}`)
  // No colour literal at all in these files.
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) leaks.push(h)
  return leaks
}

describe('the state extraction holds in all four B2 files', () => {
  for (const [key, file] of Object.entries(FILES)) {
    it(`${file}: no state in a style, a className or an icon prop, and no colour literal`, () => {
      expect(stateLeaks(source[key])).toEqual([])
    })
  }
  it('CONTROL: every spelling round one slipped past B1\'s scanner is caught, and the shipped shapes too', () => {
    const put = (key, from, to) => {
      const m = source[key].replace(from, to)
      expect(m, `anchor missing: ${from}`).not.toBe(source[key])
      return m
    }
    const fires = [
      // round one, 5
      put('tasks', "style={{ '--rb-ms': milestone.color }}", "style={{ '--rb-ms': isProjectBound ? 'var(--color-success)' : milestone.color }}"),
      put('tasks', '<Diamond className="rb-task-ms-icon" aria-hidden="true" />', '<Diamond className="rb-task-ms-icon" color={isProjectBound ? \'var(--color-success)\' : undefined} aria-hidden="true" />'),
      put('templates', '{checked && <Check />}', "{checked && <Check color={checked ? 'var(--color-signal)' : 'transparent'} />}"),
      put('detail', '<div className="rb-task-detail-body">', '<div className="rb-task-detail-body" style={{ opacity: 0.5 + 0.5 * (bidTotal != null) }}>'),
      put('create', '<div className="ui-field-stack">', "<div className=\"ui-field-stack\" style={{ opacity: 1 - 0.4 * !draft.assignee_id }}>"),
      put('detail', '<div className="rb-task-detail-body">', '<div className="rb-task-detail-body" style={{ color: `var(--color-${priorityTone(task.priority)})` }}>'),
      put('tasks', '<div className="rb-task-table-wrap">', '<div className="rb-task-table-wrap" style={{ boxShadow: `inset 0 0 0 ${+someSelected}px var(--color-signal)` }}>'),
      put('templates', 'className="rb-tpl-desc-cell"', 'className={`rb-tpl-desc-cell ${EMPTY_CLASS[+!tmpl.description]}`}'),
      // the shapes the four files shipped
      put('tasks', "data-checked={isSelected ? 'all' : 'none'}", 'style={{ opacity: isSelected ? 1 : 0 }}'),
      put('tasks', 'className="rb-task-row"', "className={`rb-task-row ${canWrite ? 'cursor-grab' : ''}`}"),
      put('detail', "data-empty={task.phase_id ? 'false' : 'true'}", "style={{ color: task.phase_id ? '#f4a261' : '#57534e' }}"),
      put('templates', "data-checked={isProjectSpecific ? 'true' : 'false'}", "style={{ backgroundColor: isProjectSpecific ? '#ea580c' : 'transparent' }}"),
      // round one, 15: a colour literal anywhere in the file
      put('detail', '<div className="rb-task-detail-props">', "<div className=\"rb-task-detail-props\" data-was=\"#fb923c\">"),
    ]
    for (const m of fires) expect(stateLeaks(m)).not.toEqual([])
    for (const [key] of Object.entries(FILES)) expect(stateLeaks(source[key])).toEqual([])
  })
})

/* ── the kit request K1 at its one caller ─────────────────────────────────── */
describe('Tasks completed keeps its tone through Stat\'s valueTone (K1)', () => {
  it('the tile passes valueTone="success" and the other three pass none', () => {
    const stats = [...jsCode(source.tasks).matchAll(/<Stat\b[^>]*\/>/g)].map((m) => m[0])
    expect(stats).toHaveLength(4)
    expect(stats.filter((s) => /valueTone="success"/.test(s)).map((s) => s.match(/label="([^"]+)"/)[1])).toEqual(['Tasks completed'])
    expect(stats.filter((s) => /valueTone=/.test(s))).toHaveLength(1)
  })
})
