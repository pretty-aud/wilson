// =============================================================================
// rabbitFiles.css — lane B4's sheet (R.A.B.B.I.T. assets and files), and the
// files it styles. The guards are B2's and B3's (rabbitCssGuards.js), pointed
// at this lane: one layer, only lane classes, every selector scoped, every
// class declared AND written, no attribute value nobody sets, no fight with a
// utility or the kit that source order would decide, no colour that is not a
// token, and no state decided in a style or a className.
//
// FILES grows one surface per commit (B4 lands one commit per surface): a
// file joins here in the commit that moves it onto this sheet. A file moved
// on in steps waits in STAGED, guarded without the functions still to come.
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
  jsxTags,
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
  // B4c, surface 5: the player on the kit Dialog and the preview tile. Neither
  // writes a style: the tile's size is `data-size`, the player's is the sheet's.
  video: { file: '../components/VideoPreview.jsx', prefix: 'rb-vid-' },
  thumb: { file: '../components/FileThumbnail.jsx', prefix: 'rb-thumb-' },
  // B4c, surface 6: the Levels and Experiences pages, one component since the
  // fold (R4-11) and on the kit whole since step C, its detail popup with
  // them. It writes no style: the popup's width is the kit Dialog's `width`,
  // every other geometry the sheet's.
  entity: { file: '../views/EntityListView.jsx', prefix: 'rb-ent-' },
}
/** A file part-way onto this sheet: every guard below reads it WITHOUT the
    top-level functions a later step restyles, and it moves into FILES, whole,
    in that step. Empty since B4c surface 6's step C moved EntityListView
    into FILES with its detail popup on the kit; the CONTROL below still
    proves the cut on a source of its own. */
const STAGED = {}
/** A source without the named top-level functions: each runs from its
    `function Name(` line to the next top-level function. */
const withoutFunctions = (src, names) => src.split(/\n(?=function \w+\()/)
  .filter((chunk) => !names.some((n) => chunk.startsWith(`function ${n}(`)))
  .join('\n')
/** Every surface the guards read: FILES whole, STAGED without its functions. */
const SURFACES = { ...FILES, ...STAGED }
/** The inline styles each file may write: a caller-given geometry or a
    measured quantity carried as a custom property, never a state. */
const STYLES = {
  filesTable: ["{{ '--rb-files-max': maxHeight ? `${maxHeight}px` : undefined }}"],
  fileManager: ["{{ '--rb-fm-pct': `${copyProgress.percent}%` }}"],
}
const source = Object.fromEntries(Object.entries(SURFACES).map(([k, { file, without }]) =>
  [k, without ? withoutFunctions(read(file), without) : read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitFiles.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(15)
    for (const [key, { file }] of Object.entries(SURFACES)) expect(source[key].length, file).toBeGreaterThan(3000)
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
  for (const [key, { file }] of Object.entries(SURFACES)) {
    it(`${file} imports rabbitFiles.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitFiles.css')).toBe(SHEET)
    })
  }
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => LANE_RE.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(SURFACES).flatMap((k) => [...writtenIn(k)]))

describe('every B4 class is both declared and written', () => {
  it('no rule without a className that uses it', () => {
    expect([...declared].filter((c) => !written.has(c))).toEqual([])
  })
  it('no className class without a rule', () => {
    expect([...written].filter((c) => !declared.has(c))).toEqual([])
  })
  it('each file writes only its own prefix', () => {
    for (const [key, { file, prefix }] of Object.entries(SURFACES)) {
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
  for (const [key, { file, without }] of Object.entries(SURFACES)) {
    it(`${file}${without ? ` (without ${without.join(', ')})` : ''}: B1's scanner finds nothing`, () => {
      expect(inlineStateTernaries(source[key])).toEqual([])
    })
    it(`${file}${without ? ` (without ${without.join(', ')})` : ''}: every style is an allowed geometry, every className a literal`, () => {
      expect(stateLeaks(source[key], STYLES[key] || [], [])).toEqual([])
    })
  }
  it('CONTROL: a hover colour in a style and a state in a className template are caught', () => {
    expect(inlineStateTernaries("<b style={{ color: hovered ? '#fb923c' : '#78716c' }} />").length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
  it('CONTROL: a staged file is read without exactly the functions it names — each still in the file — and nothing else', () => {
    const fns = (s) => [...s.matchAll(/^function (\w+)\(/gm)].map((m) => m[1])
    // The cut itself, on a source of its own (STAGED may be empty): the named
    // function goes, from its line to the next one, and nothing else does.
    const fake = 'import x from "y"\nfunction A() {\n  return 1\n}\n\nfunction B() {\n  return <b className={`z ${on ? "p" : "q"}`} />\n}\n\nfunction C() {}\n'
    expect(fns(withoutFunctions(fake, ['B']))).toEqual(['A', 'C'])
    expect(withoutFunctions(fake, ['B'])).not.toMatch(/className/)
    expect(withoutFunctions(fake, [])).toBe(fake)
    for (const [key, { file, without }] of Object.entries(STAGED)) {
      const whole = read(file)
      // Each named function is really there (a rename would silently guard it)…
      for (const n of without) expect(fns(whole), `${file} has ${n}`).toContain(n)
      // …and only those are left out: every other function is guarded.
      expect(fns(source[key])).toEqual(fns(whole).filter((n) => !without.includes(n)))
      // The whole file, as read, still fails the scanners, which is why it is staged.
      expect(stateLeaks(whole, STYLES[key] || [], []).length).toBeGreaterThan(0)
    }
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

/* ── 8. the two pages are config ─────────────────────────────────────────── */
// LevelsView and ExperiencesView are EntityListView with their own `entity`
// (B4c's fold, review R4-11). They draw nothing of their own — no class, no
// style, no colour, no element but the one — so the two pages are restyled
// once, in EntityListView and this sheet, and a drift like R4-11's date ring
// (ring-2 in one, ring-1 in the other: a config field until step C) has
// nowhere to come back.
const WRAPPERS = { levels: '../views/LevelsView.jsx', experiences: '../views/ExperiencesView.jsx' }
/** What a page wrapper does beyond configuring EntityListView. */
const wrapperLeaks = (src) => {
  const code = jsCode(src)
  const out = []
  if (/className/.test(code)) out.push('a class')
  if (/\sstyle=/.test(code)) out.push('a style')
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) out.push(h)
  const tags = jsxTags(code)
  if (tags.length !== 1 || !/^<EntityListView entity=\{[A-Z]+\} \/>$/.test(tags[0])) out.push(`the JSX: ${tags.join(' ')}`)
  // A config value that is a class list: `focus:ring-2` is a style in
  // another spelling.
  for (const [, s] of code.matchAll(/'([^']*)'/g)) {
    if (/[\s:]|^(?:text|bg|border|ring|outline|focus|hover|p[xytrbl]?|m[xytrbl]?|w|h|gap|rounded|font|flex|grid)-/.test(s)) out.push(`'${s}'`)
  }
  return out
}
/** The config's fields, in order. */
const configKeys = (src) => [...jsCode(src).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])

describe('LevelsView and ExperiencesView are config only (B4c, R4-11)', () => {
  for (const file of Object.values(WRAPPERS)) {
    it(`${file}: no class, no style, no colour, and one element — <EntityListView entity={…} />`, () => {
      expect(read(file).length).toBeGreaterThan(300)
      expect(wrapperLeaks(read(file))).toEqual([])
    })
  }
  it('the two configs have the same fields, and the date ring R4-11 carried is not one of them', () => {
    const fields = ['type', 'noun', 'nouns', 'Noun', 'Icon', 'collection', 'linkKey', 'addMethod', 'updateMethod', 'deleteMethod', 'savedViewsKey']
    expect(configKeys(read(WRAPPERS.levels))).toEqual(fields)
    expect(configKeys(read(WRAPPERS.experiences))).toEqual(fields)
  })
  it('CONTROL: a class, a style, a colour, a second element and a utility in the config are each caught', () => {
    const src = read(WRAPPERS.levels)
    const one = '<EntityListView entity={LEVEL} />'
    expect(src).toContain(one)
    expect(wrapperLeaks(src.replace(one, `<div className="p-2">${one}</div>`)))
      .toEqual(expect.arrayContaining(['a class', expect.stringMatching(/^the JSX: <div/)]))
    expect(wrapperLeaks(src.replace(one, "<EntityListView entity={LEVEL} style={{ color: '#fb923c' }} />")))
      .toEqual(expect.arrayContaining(['a style', '#fb923c']))
    expect(wrapperLeaks(src.replace("  deleteMethod: 'deleteLevel',", "  deleteMethod: 'deleteLevel',\n  dateFocusRing: 'focus:ring-2',")))
      .toEqual(["'focus:ring-2'"])
  })
})
