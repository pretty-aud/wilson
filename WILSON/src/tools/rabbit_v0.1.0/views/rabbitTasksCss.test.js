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
// The predicates live in rabbitCssGuards.js since lane B3 (moved verbatim, so a
// third sheet's test can import them without re-running this suite); this file
// imports them back and re-exports the ones it exported.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  jsCode, unreachableAttributeValues, utilityConflicts, indexCss, jsxTags,
  // lane B2's predicates, in the module since lane B3 (moved verbatim)
  B2_FILES, normal, selectorsOf, elementsOf, meets, outsideLayer, selectorClasses,
  strayClasses, alternativesOf, unscopedSelectors, importedSheet, classesWritten,
  unreadableAttributes, toneLiterals, kitFights, colourLiterals, fillShadows,
  orangeGrounds, undefinedProperties, readAwayFromSetter, stateLeaks,
  impossibleTones as impossibleTonesOf, toneSources as toneSourcesOf,
} from '../rabbitCssGuards.js'
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'

// Re-exported so anything that imported them from here keeps working.
export {
  selectorsOf, elementsOf, meets, outsideLayer, strayClasses, alternativesOf,
  unscopedSelectors, importedSheet, classesWritten, unreadableAttributes, kitFights,
  colourLiterals, fillShadows, orangeGrounds, undefinedProperties, readAwayFromSetter,
  stateLeaks,
}

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitTasks.css')
const sheet = read('rabbitTasks.css')

/** B2's four files, relative to this directory. */
const FILES = B2_FILES
const source = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]))
const jsx = Object.values(source).map((s) => normal(jsCode(s))).join('\n')

/* ── the sheet's shape ───────────────────────────────────────────────────── */
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

/** The tones a `[data-tone="…"]` rule may wait for: what priorityTone() can
    return (the source of every data-tone in these files), and the literal
    tones the JSX hands Stat's valueTone (round two: `fp-stat-tone`). */
const PRIORITY_TONES = new Set(['low', 'medium', 'high', 'urgent', undefined, ''].map((p) => priorityTone(p)))
const TONES = new Set([...PRIORITY_TONES, ...jsxTags(jsx).flatMap(toneLiterals)])
/** The two tone predicates, bound to B2's premise (they take the set as an
    argument in rabbitCssGuards.js, which cannot import app code). */
export const impossibleTones = (css) => impossibleTonesOf(css, TONES)
export const toneSources = (src) => toneSourcesOf(src, PRIORITY_TONES)

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
