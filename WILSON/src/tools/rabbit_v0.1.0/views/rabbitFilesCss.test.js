// =============================================================================
// rabbitFiles.css — lane B4's sheet (R.A.B.B.I.T. assets and files), and the
// files it styles. The guards are B2's and B3's (rabbitCssGuards.js), pointed
// at this lane: one layer, only lane classes, every selector scoped, every
// class declared AND written, no attribute value nobody sets, no fight with a
// utility or the kit that source order would decide, no colour that is not a
// token, and no state decided in a style or a className.
//
// FILES grows one surface per commit (B4 lands one commit per surface): a
// file joins here in the commit that moves it onto this sheet.
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
} from '../rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitFiles.css')
const sheet = read('rabbitFiles.css')
/** Lane B4's class prefixes (the second word after `rb-`), as the guards' `prefix`. */
const LANE = 'files|fm|asset|rel|ent|vid|thumb'
const LANE_RE = new RegExp(`^rb-(${LANE})-`)
/** B4's files on this sheet, relative to this directory, and the prefix each writes. */
const FILES = {
  filesTable: { file: '../components/ProjectFilesTable.jsx', prefix: 'rb-files-' },
  fileManager: { file: '../components/FileManager.jsx', prefix: 'rb-fm-' },
  assets: { file: '../views/ProjectAssetsView.jsx', prefix: 'rb-asset-' },
  relations: { file: '../components/RelationsPanel.jsx', prefix: 'rb-rel-' },
}
/** The inline styles each file may write: a caller-given geometry or a
    measured quantity carried as a custom property, never a state. */
const STYLES = {
  filesTable: ["{{ '--rb-files-max': maxHeight ? `${maxHeight}px` : undefined }}"],
  fileManager: ["{{ '--rb-fm-pct': `${copyProgress.percent}%` }}"],
}
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file }]) => [k, read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitFiles.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(15)
    for (const [key, { file }] of Object.entries(FILES)) expect(source[key].length, file).toBeGreaterThan(3000)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is a B4 lane class or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries a lane class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a late statement, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-files-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-files-x {} .rb-filez-ghost {} .rb-task-y {}', LANE)).toEqual(['rb-filez-ghost', 'rb-task-y'])
    expect(unscopedSelectors('.ui-td { padding: 0 }', LANE)).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-files-x .ui-td { padding: 0 }', LANE)).toEqual([])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('every B4 file on this sheet imports it', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports rabbitFiles.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitFiles.css')).toBe(SHEET)
    })
  }
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => LANE_RE.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(FILES).flatMap((k) => [...writtenIn(k)]))

describe('every B4 class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('each file writes only its own prefix', () => {
    for (const [key, { file, prefix }] of Object.entries(FILES)) {
      expect(writtenIn(key).size, file).toBeGreaterThan(0)
      expect([...writtenIn(key)].filter((c) => !c.startsWith(prefix)), file).toEqual([])
    }
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

/* ── 5. fights ─────────────────────────────────────────────────────────────── */
describe('no rule loses a fight it cannot see', () => {
  it('no utility on an element sets a property its lane rule sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
  it('no rule meets the kit where source order would decide it', () => {
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
    expect(kitFights(sheet, indexCss, ELEMENTS, LANE)).toEqual([])
  })
})

/* ── 6. colour: every value a token ──────────────────────────────────────── */
describe('rabbitFiles.css writes no colour that is not a token', () => {
  it('no hex, no rgb()/hsl()/oklch(), no named or system colour', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined, by the kit or by this sheet', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('CONTROL: a hex, a named colour and an undefined property are each caught', () => {
    const fake = (decl) => `@layer theme, base, components, utilities;\n@layer components { .rb-files-x { ${decl} } }`
    expect(colourLiterals(fake('color: #78716c;'))).toHaveLength(1)
    expect(colourLiterals(fake('border-color: white;'))).toHaveLength(1)
    expect(undefinedProperties(fake('color: var(--rb-files-nowhere);'), indexCss, [])).toHaveLength(1)
  })
})

/* ── 7. the state extraction ─────────────────────────────────────────────── */
describe('no state is decided in a style or a className', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file}: B1's scanner finds nothing`, () => {
      expect(inlineStateTernaries(source[key])).toEqual([])
    })
    it(`${file}: every style is an allowed geometry, every className a literal`, () => {
      expect(stateLeaks(source[key], STYLES[key] || [], [])).toEqual([])
    })
  }
  it('CONTROL: a hover colour in a style and a state in a className template are caught', () => {
    expect(inlineStateTernaries("<b style={{ color: hovered ? '#fb923c' : '#78716c' }} />").length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
})

/* ── 5. a geometry the fixtures cannot show ──────────────────────────────── */
describe('the asset thumbnail keeps its click (C1)', () => {
  // No fixture asset has a thumbnail, so no walk can hover one. The remove
  // control sits over the picture's corner, and the kit's 28px `sm` box
  // covered most of a 36px (1x) picture: a click meant to change the
  // thumbnail would mostly remove it (B4b; kit request B4b-KR-1).
  it('the remove control is the icon plus 2px a side, never the kit box', () => {
    const rule = rulesOf(sheet).find(({ sel }) => /\.rb-asset-thumb-remove$/.test(sel))
    expect(rule, 'the remove control has its own rule').toBeTruthy()
    expect(rule.body).toMatch(/(^|[\s;])width:\s*calc\(var\(--icon-sm\) \+ 4px\)/)
    expect(rule.body).toMatch(/(^|[\s;])height:\s*calc\(var\(--icon-sm\) \+ 4px\)/)
  })
})
