// =============================================================================
// tableViews.css — the custom views' shared sheet (post-overhaul VW1d,
// 2026-10-25), and the files it styles. The guards are the lanes'
// (rabbitCssGuards.js), pointed at this sheet as rabbitBudgetCss.test.js
// points them at B5's: one layer, only `rb-tv-` classes, every selector
// scoped, every class declared AND written, no attribute value nobody sets,
// no fight with a utility or the kit that source order would decide, no
// colour that is not a token, no state decided in a style or a className.
// VW1e's tables join FILES as they take the shared piece.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  jsCode, rulesOf, indexCss, normal, elementsOf, outsideLayer, selectorClasses,
  strayClasses, unscopedSelectors, importedSheet, classesWritten, unreadableAttributes,
  unreachableAttributeValues, utilityConflicts, weakAgainstKit, kitFights,
  undefinedProperties, readAwayFromSetter, colourLiterals, inlineStateTernaries, stateLeaks,
  paletteLeaks, variableAttributes, unmatchedValues, spreadAttributes,
} from '../../rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'tableViews.css')
const sheet = read('tableViews.css')
const LANE = 'tv'
const LANE_RE = new RegExp(`^rb-(${LANE})-`)
/** The shared piece's files on this sheet, and the least each can weigh. */
const FILES = {
  menu: { file: './TableViewsMenu.jsx', min: 8000 },
  filterRow: { file: './ViewFilterRow.jsx', min: 3000 },
  bar: { file: './ViewBar.jsx', min: 2000 },
  grouping: { file: './CreateGroupingDialog.jsx', min: 1500 },
  ask: { file: './useAsk.jsx', min: 800 },
}
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file }]) => [k, read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('tableViews.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(40)
    for (const [key, { file, min }] of Object.entries(FILES)) expect(source[key].length, file).toBeGreaterThan(min)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is an rb-tv- class or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries an rb-tv- class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-tv-x { color: red; }`).rest).not.toBe('')
    expect(strayClasses('.rb-tv-x {} .rb-tvs-ghost {} .rb-task-y {}', LANE)).toEqual(['rb-tvs-ghost', 'rb-task-y'])
    expect(unscopedSelectors('.ui-popover { padding: 0 }', LANE)).toEqual(['.ui-popover'])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('every file on this sheet imports it', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports tableViews.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'tableViews.css', here)).toBe(SHEET)
    })
  }
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => LANE_RE.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(FILES).flatMap((k) => [...writtenIn(k)]))

describe('every rb-tv- class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('each file writes some', () => {
    for (const [key, { file }] of Object.entries(FILES)) expect(writtenIn(key).size, file).toBeGreaterThan(0)
  })
})

/* ── 4. attributes ─────────────────────────────────────────────────────────── */
describe('the sheet keys on values the JSX can produce', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('only plain [data-x="v"] selectors: no operator, flag or non-data attribute', () => {
    expect(unreadableAttributes(sheet, jsx)).toEqual([])
  })
})

/* ── 4b. values set from a variable ─────────────────────────────────────────
   Each setter is declared with the values it can take. The Views button's
   `data-table` is its table's key, any of the six; since her Q-P1 (VW1e,
   2026-10-25: 136px on every table) it keys no rule. The grids' row and
   column marks and the parts' names key none either. */
const VARIABLE = [
  { classes: ['rb-tv-button'], attr: 'data-table', set: '{description.tableKey}', domain: () => ['tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences'], keyed: false },
  { classes: ['rb-tv-row'], attr: 'data-row', set: '{i}', keyed: false },
  { classes: ['rb-tv-handle'], attr: 'data-col', set: '{...}', keyed: false },
  { classes: ['rb-tv-part'], attr: 'data-part', set: '{p.part}', keyed: false },
]
describe('a data-* set from a variable: declared, and keyed only where a rule needs it', () => {
  it('every one the files set is declared above', () => {
    const found = variableAttributes(jsx).map(({ classes, attr }) => `${classes.join(' ')} ${attr}`).sort()
    const want = new Set(VARIABLE.map(({ classes, attr }) => `${classes.join(' ')} ${attr}`))
    expect(found.filter(k => !want.has(k))).toEqual([])
  })
  it('every keyed setter\'s values each meet a rule', () => {
    for (const { classes, attr, domain, keyed } of VARIABLE) {
      if (!keyed) continue
      expect(unmatchedValues(sheet, classes[0], attr, domain()), classes[0]).toEqual([])
    }
  })
  // Her Q-P1 (2026-10-25, "Narrower, 136px (Recommended)"): one width for
  // the button on every table, so no table's rule can drift from the rest.
  it('the Views button is 136px on every table: one rule, and no table keys a width of its own', () => {
    const widths = rulesOf(sheet).filter(r => /rb-tv-button(?![\w-])/.test(r.sel) && /(^|;)\s*width\s*:/.test(r.body))
    expect(widths.map(r => r.sel.trim())).toEqual(['.ui-btn.rb-tv-button'])
    expect(widths[0].body).toMatch(/(^|;)\s*width\s*:\s*136px/)
    expect(sheet).not.toMatch(/rb-tv-button\[data-table/)
  })
  it('CONTROL: a table\'s own width rule is caught', () => {
    const extra = `${sheet}\n@layer components { .ui-btn.rb-tv-button[data-table="assets"] { width: 180px; } }`
    expect(rulesOf(extra).filter(r => /rb-tv-button(?![\w-])/.test(r.sel) && /(^|;)\s*width\s*:/.test(r.body))).toHaveLength(2)
  })
})

/* ── 5. fights ─────────────────────────────────────────────────────────────── */
describe('no rule loses a fight it cannot see', () => {
  it('no utility on an element sets a property its lane rule sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('no rule meets the kit where source order would decide it', () => {
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
    expect(kitFights(sheet, indexCss, ELEMENTS, LANE)).toEqual([])
  })
  it('CONTROL: a lane class alone on a kit component meets the component\'s own rules', () => {
    expect(kitFights('.rb-tv-x { max-width: 100% }', indexCss, elementsOf('<Dialog className="rb-tv-x" />'), LANE).join('\n'))
      .toMatch(/ties or loses to \.ui-dialog(?![\w-])/)
  })
})

/* ── 6. colour: every value a token ──────────────────────────────────────── */
describe('tableViews.css writes no colour that is not a token', () => {
  it('no hex, no rgb()/hsl()/oklch(), no named or system colour', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined, by the kit or by this sheet', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('CONTROL: a hex and an undefined property are each caught', () => {
    const fake = (decl) => `@layer theme, base, components, utilities;\n@layer components { .rb-tv-x { ${decl} } }`
    expect(colourLiterals(fake('color: #78716c;'))).toHaveLength(1)
    expect(undefinedProperties(fake('color: var(--rb-tv-nowhere);'), indexCss, [])).toHaveLength(1)
  })
})

/* ── 7. the state extraction ─────────────────────────────────────────────── */
describe('no state is decided in a style or a className', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file}: B1's scanner finds nothing`, () => {
      expect(inlineStateTernaries(source[key])).toEqual([])
    })
    it(`${file}: no style, every className a literal`, () => {
      expect(stateLeaks(source[key], [], [])).toEqual([])
    })
    it(`${file}: no Tailwind palette utility, no spread attribute`, () => {
      expect(paletteLeaks(source[key])).toEqual([])
      expect(spreadAttributes(code[key])).toEqual([])
    })
  }
  it('CONTROL: a style and a state in a className template are caught', () => {
    expect(stateLeaks('<b style={{ width: w }} />', [], []).length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
})
