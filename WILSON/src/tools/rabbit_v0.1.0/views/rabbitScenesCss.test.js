// =============================================================================
// rabbitScenes.css — lane B5b's sheet (R.A.B.B.I.T. Scenes), and the file it
// styles. The guards are B2's, B3's and B4's (rabbitCssGuards.js), pointed at
// this lane as rabbitBudgetCss.test.js points them at B5's: one layer, only
// lane classes, every selector scoped, every class declared AND written, no
// attribute value nobody sets, no fight with a utility or the kit that source
// order would decide, no colour that is not a token, and no state decided in
// a style or a className.
//
// ScenesView.jsx is one file of ~3,300 lines restyled in three surfaces
// (6a the tiles, the toolbar and both tables; 6b the galleries, the filter
// panel and saved views; 6c the two detail popups), so it is read through a
// `staged` list: the top-level functions whose restyle has not landed yet.
// The guards read the file with those functions taken out
// (`withoutFunctions`, below), and each surface shortens the list until it
// is empty.
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
  cssCode, selectorsOf, spreadAttributes, paletteLeaks, variableAttributes, unmatchedValues,
  arrayValues, scriptedLeaks, declaredValue, withDeclaration, kitRing, ringInset,
  specificity, gt,
} from '../rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitScenes.css')
const sheet = read('rabbitScenes.css')
/** Lane B5b's class prefix (the second word after `rb-`), as the guards' `prefix`. */
const LANE = 'scene'
const LANE_RE = new RegExp(`^rb-(${LANE})-`)
/** B5b's file on this sheet, relative to this directory, the prefix it
    writes, the least it can weigh, and the functions not restyled yet. */
const FILES = {
  // B5b surface 6a: the page, its tiles and toolbar (inside the default
  // ScenesView), BigTile, SceneTable (its nested shots), ShotTable, and the
  // helpers they call — InlineText, SceneBulkSelect, ConfirmDialog (W9) and
  // the pure formatters. Surface 6b: SceneGallery, ShotGallery,
  // SceneFilterPanel and SceneSavedViewsDropdown. Surface 6c: the two detail
  // popups, SceneDetailPopup and ShotDetailPopup, and the two helpers only
  // they call, PopupInlineText and FieldLabel; statusColor and fmt, which
  // only they still called, are deleted. Nothing is staged: the whole file
  // is guarded. (The list and `withoutFunctions` stay, with their CONTROLs,
  // for the next file restyled in parts.)
  scenes: {
    file: './ScenesView.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // Post-overhaul S3b: the shot-list bar, between the tiles and the toolbar.
  bar: {
    file: './scenes/ShotListBar.jsx',
    prefix: 'rb-scene-',
    min: 2000,
    staged: [],
  },
  // …and "Shot lists…", the picker.
  picker: {
    file: './scenes/ShotListPicker.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // …and New shot list / Save as… / Edit details.
  form: {
    file: './scenes/ShotListForm.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // …and Add from another list… (step 6).
  addFrom: {
    file: './scenes/AddFromListDialog.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // Post-overhaul S3c, step 1: a linked scene's or shot's shot list beside
  // its name, in the task popup, the asset relations, the Bins inspector
  // and the pickers (it carries this sheet into each).
  home: {
    file: './scenes/LinkHome.jsx',
    prefix: 'rb-scene-',
    min: 1500,
    staged: [],
  },
  // Post-overhaul S3c, step 3: an edit's cut.
  cut: {
    file: './scenes/EditTable.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // …step 4: "Add shot…" to an edit (Add from another list's picker classes).
  addShots: {
    file: './scenes/AddShotsDialog.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
  // …step 5: Save edit (the shot-list form's classes).
  saveEdit: {
    file: './scenes/SaveEditDialog.jsx',
    prefix: 'rb-scene-',
    min: 3000,
    staged: [],
  },
}
/** S3b's shot-list files that write NO lane class (each draws only kit
    components): the class checks above have nothing to read in them, so
    they get the leak checks alone (section 7e). S3c's three-answer question
    (step 4) is one. */
const PLAIN = ['./scenes/ShotLists.jsx', './scenes/ListConfirm.jsx', './scenes/MenuButton.jsx', './scenes/AnswerDialog.jsx']
/** The inline styles each file may write: a caller-given geometry or a
    measured quantity carried as a custom property, never a state. The file
    writes none: every size is the sheet's, keyed on `data-thumb` (the
    tables) and `data-card` (the galleries); the popups' 896px is the kit
    Dialog's `width`, a prop (the kit writes it). */
const STYLES = {}

/** A source with the named top-level functions taken out. A function starts
    at a column-0 `function NAME(` or `export default function NAME(` and runs
    to the line before the next column-0 `function `, `export `, `const ` or
    `// ─` line — so a constant or a section divider between two staged
    functions stays in, and is read. (rabbitBudgetCss.test.js's, verbatim.) */
function withoutFunctions(src, names) {
  const opens = (line) => names.some((n) => line.startsWith(`function ${n}(`) || line.startsWith(`export default function ${n}(`))
  const boundary = /^(function |export |const |\/\/ ─)/
  const kept = []
  let skipping = false
  for (const line of src.split('\n')) {
    if (skipping && boundary.test(line)) skipping = false
    if (!skipping && opens(line)) { skipping = true; continue }
    if (!skipping) kept.push(line)
  }
  return kept.join('\n')
}
/** One top-level function's own lines, bounded as withoutFunctions bounds it. */
function functionText(src, name) {
  const boundary = /^(function |export |const |\/\/ ─)/
  const out = []
  let inside = false
  for (const line of src.split('\n')) {
    if (inside && boundary.test(line)) break
    if (!inside && (line.startsWith(`function ${name}(`) || line.startsWith(`export default function ${name}(`))) inside = true
    if (inside) out.push(line)
  }
  return out.join('\n')
}
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file, staged }]) => [k, staged ? withoutFunctions(read(file), staged) : read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitScenes.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(0)
    for (const [key, { file, min }] of Object.entries(FILES)) expect(source[key].length, file).toBeGreaterThan(min)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is a B5b lane class or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries a lane class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a late statement, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-scene-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-scene-x {} .rb-scenes-ghost {} .rb-budget-y {}', LANE)).toEqual(['rb-scenes-ghost', 'rb-budget-y'])
    expect(unscopedSelectors('.ui-td { padding: 0 }', LANE)).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-scene-x .ui-td { padding: 0 }', LANE)).toEqual([])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('every B5b file on this sheet imports it', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports rabbitScenes.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitScenes.css')).toBe(SHEET)
    })
  }
})

/* ── 2b. staged functions ─────────────────────────────────────────────────── */
describe('a staged function is read out of the guards, and only a staged one', () => {
  it('every staged name is a top-level function of its file, and each is taken out', () => {
    for (const [key, { file, staged = [] }] of Object.entries(FILES)) {
      const whole = read(file)
      for (const name of staged) {
        const head = new RegExp(`^(?:export default )?function ${name}\\(`, 'm')
        expect(whole, `${file}: ${name}`).toMatch(head)
        expect(source[key], `${file}: ${name} is still read`).not.toMatch(head)
      }
    }
  })
  it('every function surfaces 6a, 6b and 6c restyled is still read, and nothing is staged', () => {
    for (const name of [
      'ScenesView', 'BigTile', 'SceneTable', 'ShotTable', 'ConfirmDialog', 'SceneBulkSelect', 'InlineText',
      'SceneGallery', 'ShotGallery', 'SceneFilterPanel', 'SceneSavedViewsDropdown',
      'SceneDetailPopup', 'ShotDetailPopup', 'PopupInlineText', 'FieldLabel',
    ]) {
      expect(source.scenes, name).toMatch(new RegExp(`^(?:export default )?function ${name}\\(`, 'm'))
    }
    expect(FILES.scenes.staged).toEqual([])
    expect(source.scenes).toBe(read(FILES.scenes.file))
  })
  it('CONTROL: the mechanism, on a source of its own — a hex planted in a staged function is ignored; one planted in a function that is read is caught', () => {
    // Nothing is staged in ScenesView since surface 6c, so the mechanism is
    // proven on a synthetic source, as withoutFunctions' boundaries are below.
    const src = [
      "import './rabbitScenes.css'",
      'function Staged() {', "  const planted = '#abcdef'", '  return <b className="rb-scene-x" />', '}',
      'function Read() {', '  return <i className="rb-scene-y" />', '}',
    ].join('\n')
    const inRead = src.replace('  return <i className="rb-scene-y" />', "  const planted = '#fedcba'\n  return <i className=\"rb-scene-y\" />")
    expect(inRead).not.toBe(src)
    expect(stateLeaks(withoutFunctions(src, ['Staged']), [], [])).toEqual([])
    expect(stateLeaks(withoutFunctions(src, []), [], [])).toEqual(['#abcdef'])
    expect(stateLeaks(withoutFunctions(inRead, ['Staged']), [], [])).toEqual(['#fedcba'])
  })
  it('CONTROL: with nothing staged, a hex planted in any of 6c\'s functions — either popup, PopupInlineText, FieldLabel — is caught, as in 6a\'s', () => {
    const { file, staged } = FILES.scenes
    const whole = read(file)
    // Plant on the first line inside the function's body.
    const plant = (name) => whole.replace(new RegExp(`^((?:export default )?function ${name}\\([^\\n]*\\n)`, 'm'), "$1  const planted = '#abcdef'\n")
    for (const name of ['SceneDetailPopup', 'ShotDetailPopup', 'PopupInlineText', 'FieldLabel', 'SceneTable', 'ScenesView']) {
      const planted = plant(name)
      expect(planted, name).not.toBe(whole)
      expect(stateLeaks(withoutFunctions(planted, staged), STYLES.scenes || [], []), name).toEqual(['#abcdef'])
    }
  })
  it('statusColor and fmt are gone (6c): nothing in the file defines or calls either; the popups\' status reads the kit\'s one STATUS map', () => {
    const whole = read('./ScenesView.jsx')
    expect(jsCode(whole)).not.toMatch(/\bstatusColor\b/)
    expect(jsCode(whole)).not.toMatch(/\bfmt\(/)
    for (const name of ['SceneDetailPopup', 'ShotDetailPopup']) {
      const body = jsCode(functionText(whole, name))
      expect(body, name).toMatch(/subtitle=\{<StatusBadge status=\{status\} \/>\}/)
      expect(body, name).toMatch(/<StatusDot status=\{status\}/)
      expect(body, name).toMatch(/\{STATUS_OPTIONS\.map\(/)
    }
    // CONTROL: the scan would see a call that came back.
    expect(jsCode(`${whole}\nconst x = statusColor('final')`)).toMatch(/\bstatusColor\b/)
  })
  it('CONTROL: a function ends at the next column-0 function, export, const or section divider', () => {
    const src = [
      'function a() {', '  one', '}', 'const K = 1', 'function b() {', '  two', '}', '// ─── c', 'function c() {', '  three', '}',
      'export default function D() {', '  four', '}', 'export { c }',
    ].join('\n')
    expect(withoutFunctions(src, ['a', 'c'])).toBe(['const K = 1', 'function b() {', '  two', '}', '// ─── c', 'export default function D() {', '  four', '}', 'export { c }'].join('\n'))
    expect(withoutFunctions(src, ['D'])).not.toMatch(/four/)
    expect(withoutFunctions(src, ['D'])).toMatch(/export \{ c \}/)
  })
})

/* ── 3. classes ────────────────────────────────────────────────────────────── */
const declared = new Set(selectorClasses(sheet).filter((c) => LANE_RE.test(c)))
const writtenIn = (key) => new Set(classesWritten(jsCode(source[key]), LANE))
const written = new Set(Object.keys(FILES).flatMap((k) => [...writtenIn(k)]))

describe('every B5b class is both declared and written', () => {
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

/* ── 4b. values set from a variable ─────────────────────────────────────────
   unreachableAttributeValues reads a literal or a ternary of literals and
   skips a pair any other expression sets. Each such setter is declared here
   with the values it can take, read from the component's own list, as
   rabbitFilesCss.test.js does. */
const VARIABLE = [
  // A size triple's square: SIZE_KEYS, in order, for both triples.
  { cls: 'rb-scene-size-glyph', attr: 'data-thumb', set: '{key}', from: ['scenes', '{SIZE_KEYS.map(key =>'],
    domain: () => arrayValues(source.scenes, 'SIZE_KEYS') },
  // The tables' thumbnail size: state, one of SIZE_KEYS (a saved view saves
  // it from this state). The wrap's own custom properties are the small size.
  { cls: 'rb-scene-table-wrap', attr: 'data-thumb', set: '{thumbSize}', from: ['scenes', "const [thumbSize, setThumbSize] = useState('sm')"],
    domain: () => arrayValues(source.scenes, 'SIZE_KEYS'), base: ['sm'] },
  // The galleries' card size (surface 6b): state, one of SIZE_KEYS (the card
  // triple sets it; a saved view saves it from this state). The gallery's
  // own custom properties are the middle size, the old `|| sizeMap.md`.
  { cls: 'rb-scene-gallery', attr: 'data-card', set: '{gallerySize}', from: ['scenes', "const [gallerySize, setGallerySize] = useState('md')"],
    domain: () => arrayValues(source.scenes, 'SIZE_KEYS'), base: ['md'] },
]
const variableKey = ({ classes, cls, attr, set }) => `${classes ? classes.join(' ') : cls} ${attr}=${set}`

describe('a data-* set from a variable: every value it can take has a rule, and every rule a value it can take', () => {
  it('every one the file sets is declared above, and its premise holds', () => {
    expect(variableAttributes(jsx).map(variableKey).sort()).toEqual(VARIABLE.map(variableKey).sort())
    for (const { cls, from: [key, text] } of VARIABLE) expect(code[key], cls).toContain(text)
  })
  it('each value is read from the list, and the sheet keys on exactly those (less the ones the unkeyed rule serves)', () => {
    for (const { cls, attr, domain, base } of VARIABLE) {
      const values = domain()
      expect(values, `${cls}: the list could not be read`).not.toBeNull()
      expect(values.length, cls).toBeGreaterThan(1)
      expect(unmatchedValues(sheet, cls, attr, values, base), cls).toEqual([])
    }
  })
  it('CONTROL: a rule for a size nothing sets, a deleted size rule, and an undeclared variable-valued attribute are each caught', () => {
    const [glyph, wrap] = VARIABLE
    const md = '.rb-scene-size > .rb-scene-size-glyph[data-thumb="md"] {'
    expect(sheet).toContain(md)
    expect(unmatchedValues(sheet.replace(md, '.rb-scene-size > .rb-scene-size-glyph[data-thumb="xl"] {'), glyph.cls, glyph.attr, glyph.domain(), glyph.base))
      .toEqual(['.rb-scene-size-glyph[data-thumb="xl"]: nothing sets "xl"', '.rb-scene-size-glyph data-thumb="md": set, and no rule keys on it'])
    const lg = '.rb-scene-table-wrap[data-thumb="lg"] { --rb-scene-thumb-h: 72px; }'
    expect(sheet).toContain(lg)
    expect(unmatchedValues(sheet.replace(lg, ''), wrap.cls, wrap.attr, wrap.domain(), wrap.base))
      .toEqual(['.rb-scene-table-wrap data-thumb="lg": set, and no rule keys on it'])
    const mutant = `${jsx}\n<span className="rb-scene-count" data-tone={tone} />`
    const declaredKeys = VARIABLE.map(variableKey)
    expect(variableAttributes(mutant).map(variableKey).filter((k) => !declaredKeys.includes(k))).toEqual(['rb-scene-count data-tone={tone}'])
  })
  it('the sheet\'s three thumbnail heights are THUMB_SIZES\' — the numbers the Bins components are handed', () => {
    const js = read('./ScenesView.jsx')
    expect(js).toMatch(/const BASE_ROW_H = 36\n/)
    expect(js).toMatch(/md: \{ h: Math\.round\(BASE_ROW_H \* 1\.5\) \}/)
    expect(js).toMatch(/lg: \{ h: BASE_ROW_H \* 2 \}/)
    expect(sheet).toMatch(/\.rb-scene-table-wrap \{\n {4}--rb-scene-thumb-h: 36px;/)
    expect(sheet).toContain('.rb-scene-table-wrap[data-thumb="md"] { --rb-scene-thumb-h: 54px; }')
    expect(sheet).toContain('.rb-scene-table-wrap[data-thumb="lg"] { --rb-scene-thumb-h: 72px; }')
  })
  it('the sheet\'s three card widths and frame heights are ShotGallery\'s — the numbers BinPoster is handed', () => {
    const shots = functionText(read('./ScenesView.jsx'), 'ShotGallery')
    expect(shots).toMatch(/const sizeMap = \{ sm: 160, md: 220, lg: 300 \}\n/)
    expect(shots).toMatch(/const cardH = Math\.round\(cardW \* 9 \/ 16\)\n/)
    const frame = (w) => Math.round(w * 9 / 16)
    expect(sheet).toMatch(new RegExp(`\\.rb-scene-gallery \\{\\n {4}--rb-scene-card: 220px;\\n {4}--rb-scene-card-frame: ${frame(220)}px;`))
    expect(sheet).toContain(`.rb-scene-gallery[data-card="sm"] { --rb-scene-card: 160px; --rb-scene-card-frame: ${frame(160)}px; }`)
    expect(sheet).toContain(`.rb-scene-gallery[data-card="lg"] { --rb-scene-card: 300px; --rb-scene-card-frame: ${frame(300)}px; }`)
    // A scene's well is half its card's width, as `cardW * 0.5` was.
    expect(sheet).toContain('height: calc(var(--rb-scene-card) * 0.5);')
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
    for (const [tag, root, prop] of [['Dialog', 'ui-dialog', 'max-width: 100%'], ['EmptyState', 'ui-empty', 'padding: 0'], ['StatusBadge', 'ui-status', 'gap: 0']]) {
      expect(kitFights(`.rb-scene-x { ${prop} }`, indexCss, elementsOf(`<${tag} className="rb-scene-x" />`), LANE).join('\n'), tag)
        .toMatch(new RegExp(`ties or loses to \\.${root}(?![\\w-])`))
    }
  })
})

/* ── 6. colour: every value a token ──────────────────────────────────────── */
describe('rabbitScenes.css writes no colour that is not a token', () => {
  it('no hex, no rgb()/hsl()/oklch(), no named or system colour', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined, by the kit or by this sheet', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('CONTROL: a hex, a named colour and an undefined property are each caught', () => {
    const fake = (decl) => `@layer theme, base, components, utilities;\n@layer components { .rb-scene-x { ${decl} } }`
    expect(colourLiterals(fake('color: #78716c;'))).toHaveLength(1)
    expect(colourLiterals(fake('border-color: white;'))).toHaveLength(1)
    expect(undefinedProperties(fake('color: var(--rb-scene-nowhere);'), indexCss, [])).toHaveLength(1)
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
    it(`${file}: no Tailwind palette utility, and no colour prop given a literal colour`, () => {
      expect(paletteLeaks(source[key])).toEqual([])
    })
  }
  it('R3-26: no onMouseEnter / onMouseLeave anywhere in the file, staged functions included (a style written from script, in any spelling, is R1-09\'s, below)', () => {
    expect(jsCode(read('./ScenesView.jsx')).match(/\bonMouse(?:Enter|Leave)\b/g) || []).toEqual([])
  })
  it('CONTROL: a hover colour in a style and a state in a className template are caught', () => {
    expect(inlineStateTernaries("<b style={{ color: hovered ? '#fb923c' : '#78716c' }} />").length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
  it('CONTROL: in every file, a spread in any spacing, a palette utility and a literal colour prop are each caught', () => {
    for (const [key, { file }] of Object.entries(FILES)) {
      // The first lane class, written as a literal or as a template whose only
      // hole is the caller's `${className}`.
      const first = code[key].match(/className=(?:"|\{`)(rb-[a-z0-9-]+)/)
      expect(first, file).toBeTruthy()
      const at = first.index
      const after = (tail) => `${code[key].slice(0, at)}${tail} ${code[key].slice(at)}`
      const withClass = (utility) => `${code[key].slice(0, at)}${first[0].replace(first[1], `${first[1]} ${utility}`)}${code[key].slice(at + first[0].length)}`
      const styles = STYLES[key] || []
      expect(spreadAttributes(code[key]), file).toEqual([])
      expect(stateLeaks(after('{ ...rest }'), styles, []), file).toEqual(['{...rest}'])
      for (const u of ['text-stone-400', 'hover:bg-stone-700', 'text-white', 'bg-white']) {
        expect(paletteLeaks(withClass(u)), `${file}: ${u}`).toEqual([u])
      }
      for (const p of ['color="white"', "fill='#fff'"]) expect(paletteLeaks(after(p)), `${file}: ${p}`).toEqual([p])
      for (const p of ['fill="none"', 'stroke="currentColor"', 'color="inherit"']) expect(paletteLeaks(after(p)), `${file}: ${p}`).toEqual([])
    }
  })
  it('CONTROL: the R3-26 scan fires on the spellings it claims', () => {
    const mutant = "<select onMouseEnter={e => { e.target.style.borderColor = 'x' }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'y' }} />"
    expect(mutant.match(/\bonMouse(?:Enter|Leave)\b/g)).toHaveLength(2)
  })
})

/* ── 7b. no style written from script, no window.confirm (R3-26, W9) ───────
   Review round one, R1-09: the scans above knew one spelling each
   (`.target.style` / `.currentTarget.style`, `window.confirm`), and a write
   through an alias or a ref, or a bare `confirm(`, passed them. The one
   predicate is rabbitCssGuards.js's `scriptedLeaks`, which
   rabbitBudgetCss.test.js runs over its files too. */
/** The exact matches a file may keep — a measured geometry written from
    script — each with its reason. None: every size ScenesView sets is the
    sheet's (keyed on `data-thumb` and `data-card`) or the kit Dialog's
    `width`, a prop. */
const SCRIPTED = {}
/** Each spelling R1-09 and R2-02 name, and what the predicate reports for it
    (a list where one spelling is two catches). */
const PLANTED = [
  // R3-26's own hover writers, on an event's target and its current target.
  ["onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}", 'style write: .style.borderColor ='],
  ["onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#292524' }}", 'style write: .style.backgroundColor ='],
  // Through an alias, and through a ref.
  ["const el = e.target; el.style.color = '#fb923c'", 'style write: .style.color ='],
  ['rowRef.current.style.opacity = 0.5', 'style write: .style.opacity ='],
  // A writing method, the whole text, the attribute, the object handed on.
  ["el.style.setProperty('--rb-x', 1)", 'style write: .style.setProperty('],
  ["el.style.cssText = 'color: red'", 'style write: .style.cssText ='],
  ["el.setAttribute('style', 'color: red')", "style write: .setAttribute('style'"],
  ["Object.assign(el.style, { color: 'red' })", 'style handed on: .style'],
  // W9: window.confirm, and a bare confirm( call.
  ["if (!window.confirm('Delete?')) return", 'confirm: window.confirm'],
  ["if (!confirm('Delete?')) return", 'confirm: confirm('],
  // Review round two, R2-02: the spellings round one's claim of "any
  // spelling" let through. The style object destructured, and written
  // through; the bracket; the optional call; the Typed OM; the namespaced
  // attribute.
  ["const { style } = el; style.color = 'red'", ['style write: style.color =', 'style handed on: { style } =']],
  ['const { style: s } = e.target', 'style handed on: { style: s } ='],
  ["el['style'].color = 'red'", "style write: ['style'].color ="],
  ["el.style.setProperty?.('--rb-x', 1)", 'style write: .style.setProperty?.('],
  ["el.attributeStyleMap.set('color', 'red')", 'style write: .attributeStyleMap.set('],
  ["el.setAttributeNS(null, 'style', 'color: red')", "style write: .setAttributeNS(null, 'style'"],
  // …and confirm on another window's name, aliased, passed and destructured.
  ["window.top.confirm('Delete?')", 'confirm: top.confirm'],
  ["window.parent.confirm('Delete?')", 'confirm: parent.confirm'],
  ["document.defaultView.confirm('Delete?')", 'confirm: defaultView.confirm'],
  ['const ask = confirm', 'confirm: confirm'],
  ['[].map(confirm)', 'confirm: confirm'],
  ['const { confirm: ask } = window', 'confirm: confirm'],
]
/** Reads, which are not writes, and names that only contain the word: each
    planted, nothing is caught (R2-02: the lanes' own near misses). */
const READS = [
  "rule.style?.getPropertyValue('font-family')", 'const w = el.style.width', 'const m = el.attributeStyleMap.get(\'color\')',
  'for (const sheet of doc.styleSheets) {}', "new Intl.NumberFormat('en-US', { style: 'currency', currency })",
  '<Dialog width="confirm" onConfirm={onConfirm} />', 'const [confirmBulk, setConfirmBulk] = useState(null)',
  "setConfirmBulk('shots')", '<ConfirmDialog onConfirm={handleConfirm} />', 'function handleConfirm() { onConfirm() }',
  "document.querySelector('.ui-dialog[data-width=\"confirm\"]')", 'const { canWrite: canWriteProject } = useProjectAccess()',
]
/** The near misses each real file holds, in its code: a clean scan of the
    file (below) is a clean scan of these. */
const NEAR_MISSES = {
  // S3b: the gate's destructure gained the shot-list seats; it is still a
  // renaming destructure, the `{ style: s } =` spelling's near miss.
  scenes: ['width="confirm"', 'onConfirm={', 'setConfirmBulk(', '<ConfirmDialog', 'data-width="confirm"', 'const { canWrite: canWriteProject, writeReason, can: canOn, reasonFor } = useProjectAccess()'],
  bar: [],
  picker: [],
  form: [],
  addFrom: [],
  home: [],
  cut: [],
  addShots: [],
  saveEdit: ['onConfirm={'],
}

describe('R1-09 / R2-02: nothing writes a style from script and nothing reaches confirm, in the spellings scriptedLeaks names', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file}: none anywhere in the file, staged functions included — and the file's own near misses are in its code`, () => {
      expect(scriptedLeaks(read(file), SCRIPTED[key])).toEqual([])
      for (const near of NEAR_MISSES[key]) expect(jsCode(read(file)), `${file}: ${near}`).toContain(near)
    })
  }
  it('CONTROL: in every file, each spelling planted at its first lane class is caught, and is the one thing caught; a read or a near miss is not', () => {
    for (const [key, { file }] of Object.entries(FILES)) {
      // In code, so the first lane class is never one a comment names.
      const whole = jsCode(read(file))
      const at = whole.search(/className=(?:"|\{`)rb-/)
      expect(at, file).toBeGreaterThan(0)
      const plant = (text) => `${whole.slice(0, at)}${text} ${whole.slice(at)}`
      for (const [text, caught] of PLANTED) expect(scriptedLeaks(plant(text), SCRIPTED[key]), `${file}: ${text}`).toEqual([caught].flat())
      for (const text of READS) expect(scriptedLeaks(plant(text), SCRIPTED[key]), `${file}: ${text}`).toEqual([])
    }
  })
})

/* ── 7e. S3b's shot-list files that write no lane class ─────────────────────
   ShotLists.jsx (the container) and ListConfirm.jsx (its questions) draw
   only kit components. The class checks have nothing to read in them; the
   leak checks do: no style written inline or from script, no palette
   utility, no confirm(, no state in a className — and no lane class either,
   or the file belongs in FILES, where its classes are checked. */
describe('S3b: the shot-list files that draw only kit components leak nothing', () => {
  for (const file of PLAIN) {
    it(`${file}: no lane class, no style, no state in a className, no palette utility, no scripted style or confirm`, () => {
      const src = read(file)
      expect(src.length, file).toBeGreaterThan(1000)
      expect([...classesWritten(jsCode(src), LANE)], file).toEqual([])
      expect(inlineStateTernaries(src), file).toEqual([])
      expect(stateLeaks(src, [], []), file).toEqual([])
      expect(paletteLeaks(src), file).toEqual([])
      expect(scriptedLeaks(src), file).toEqual([])
    })
  }
  it('CONTROL: in each, a planted inline colour, a palette utility, a lane class and a confirm( are each caught', () => {
    for (const file of PLAIN) {
      const src = read(file)
      const at = src.indexOf('return ')
      expect(at, file).toBeGreaterThan(0)
      const plant = (text) => `${src.slice(0, at)}${text}\n${src.slice(at)}`
      expect(stateLeaks(plant("const x = <b style={{ color: '#fb923c' }} />"), [], []).length, file).toBeGreaterThan(0)
      expect(paletteLeaks(plant('const x = <b className="text-stone-400" />')), file).toEqual(['text-stone-400'])
      expect([...classesWritten(jsCode(plant('const x = <b className="rb-scene-x" />')), LANE)], file).toEqual(['rb-scene-x'])
      expect(scriptedLeaks(plant("if (!window.confirm('Sure?')) return")), file).toEqual(['confirm: window.confirm'])
    }
  })
})

/* ── 7c. the nested shots' widths ─────────────────────────────────────────
   Review round one, R1-03: a 128px description in the nest's min-width and
   columns wider than the old flex row's held the nest from x 52 to 1620 at
   1440 with Takes. Worked out from the sheet's own declarations. */
describe('R1-03: the nested shots end inside the window they did', () => {
  const wrap = rulesOf(sheet).find(({ sel }) => sel === '.rb-scene-table-wrap').body
  const own = Object.fromEntries([...wrap.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const kitToken = (p) => (cssCode(indexCss).match(new RegExp(`(?:^|[\\s;{])${p}\\s*:\\s*([^;]+);`)) || [])[1]
  /** A length at the small size (the wrap's defaults), in px: every var()
      resolved against the wrap's declarations, then the kit's tokens; its
      calc() and max() worked out. */
  const px = (expr) => {
    let e = expr
    for (let i = 0; i < 20 && /var\(/.test(e); i++) e = e.replace(/var\((--[\w-]+)\)/g, (_, p) => `(${own[p] ?? kitToken(p)})`)
    expect(e, expr).not.toMatch(/var\(|undefined/)
    return Function(`return ${e.replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/(\d+(?:\.\d+)?)px/g, '$1')}`)()
  }
  it('with Takes at the small size they end inside a 1440px window; their description takes what is left, out of their min-width, as the shot table\'s does', () => {
    expect(own['--rb-scene-nest-min']).not.toMatch(/--rb-scene-col-desc/)
    // One column in from the table's gutter: the nest cell's padding.
    expect(sheet).toMatch(/\.rb-scene-nest-row > \.ui-td\.rb-scene-nest-cell \{[^}]*padding: 2px 0 4px var\(--rb-scene-col-check\);/)
    const left = px('var(--spacing-gutter)') + px('var(--rb-scene-col-check)')
    expect(left).toBe(52)
    expect(left + px('var(--rb-scene-nest-min)') + px('var(--rb-scene-col-nest-takes)')).toBeLessThanOrEqual(1440)
  })
  it('CONTROL: the arithmetic reads the sheet — the 128px description back in its min-width puts the nest past 1440', () => {
    const was = own['--rb-scene-nest-min']
    own['--rb-scene-nest-min'] = was.replace(/\)$/, ' + var(--rb-scene-col-desc))')
    try {
      expect(52 + px('var(--rb-scene-nest-min)') + px('var(--rb-scene-col-nest-takes)')).toBeGreaterThan(1440)
    } finally { own['--rb-scene-nest-min'] = was }
  })

  // Post-overhaul S3b: the actions slot grew from two buttons to three (the
  // row's shot-list menu), 84 to 112px. The scene table's fixed columns and
  // its description's floor must still fit 1280 inside the gutters, or the
  // table scrolls sideways there; the nest above keeps its 1440 by giving
  // its name column the same 28px.
  const sceneTableMin = () => rulesOf(sheet).find(({ sel }) => sel === '.ui-table.rb-scene-table-scenes').body.match(/min-width:\s*([^;]+);/)[1]
  it('S3b: the scene table, its description at its floor, fits a 1280px window inside the two gutters', () => {
    expect(px('var(--rb-scene-col-acts)')).toBe(112)
    expect(px(sceneTableMin()) + 2 * px('var(--spacing-gutter)')).toBeLessThanOrEqual(1280)
  })
  it('CONTROL: with the description\'s floor back at 128px beside the 112px slot, the table passes 1280', () => {
    const was = own['--rb-scene-col-desc']
    own['--rb-scene-col-desc'] = '128px'
    try {
      expect(px(sceneTableMin()) + 2 * px('var(--spacing-gutter)')).toBeGreaterThan(1280)
    } finally { own['--rb-scene-col-desc'] = was }
  })
})

/* ── 7d. the rings, the lift and the scroll-padding, on the sheet ─────────
   Review round two, R2-07: round one's inset rings (R1-07: Add shot, a
   group band's toggle) and its "+ takes" lift (R1-12), and this round's
   scroll-padding (R2-03), are CSS the mounted tests cannot see — reverting
   any of them passed every test. Each is read off the sheet by
   rabbitCssGuards.js's `declaredValue`, with a CONTROL that the reading
   fails on the sheet without it (`withDeclaration`'s mutant). */
describe('R2-07: the inset rings, the "+ takes" lift and the table scroller\'s scroll-padding are on the sheet', () => {
  const ring = kitRing()
  it('the kit ring they are measured against: 2px, 1px out — it reaches 3px past a box', () => {
    expect(ring).toEqual({ width: 2, offset: 1, reach: 3 })
  })

  // R1-07: each fills a cell that clips it (the toggle its band's, Add shot
  // the nest's), so its ring is drawn inside the box.
  const INSET = ['.rb-scene-add', '.rb-scene-group-toggle']
  it('R1-07: Add shot\'s and a group band\'s toggle\'s rings are drawn inside the box, which its cell clips', () => {
    for (const sel of INSET) expect(ringInset(sheet, sel), sel).toBe(true)
  })
  it('CONTROL: with the offset taken out, or back at the kit\'s 1px, or only -1px in, neither ring is inset', () => {
    for (const sel of INSET) {
      expect(ringInset(withDeclaration(sheet, sel, 'outline-offset', null), sel), sel).toBe(false)
      expect(ringInset(withDeclaration(sheet, sel, 'outline-offset', '1px'), sel), sel).toBe(false)
      expect(ringInset(withDeclaration(sheet, sel, 'outline-offset', '-1px'), sel), sel).toBe(false)
    }
  })

  // R1-12: a hovered or ticked shot row lifts ShotTakeChips' quiet ink.
  const LIFT = ['.rb-scene-row:hover > .rb-scene-takes-cell', '.rb-scene-row[data-ticked="true"] > .rb-scene-takes-cell']
  it('R1-12: a hovered or ticked shot row lifts the takes cell\'s third ink to the second — the property B6 draws "+ takes" in', () => {
    for (const sel of LIFT) expect(declaredValue(sheet, sel, '--bn-ink-3'), sel).toBe('var(--color-ink-2)')
    // B6's "+ takes" is `C.dimmer`, binUi's `--bn-ink-3` over the third ink:
    // the property the rule sets is the one the chip reads.
    const binUi = read('./bins/binUi.jsx')
    expect(binUi).toMatch(/const INK_3_PROP = 'var\(--bn-ink-3, var\(--color-ink-3\)\)'/)
    expect(binUi).toMatch(/\bdimmer: INK_3_PROP\b/)
    expect(read('./bins/ShotTakeChips.jsx')).toMatch(/className="bn-take-add[^"]*"\s+style=\{\{[^}]*\bcolor: C\.dimmer\b/)
    // The chip sits in that cell.
    expect(code.scenes).toMatch(/<Td className="rb-scene-takes-cell"[^\n]*\n\s*<ShotTakeChips\b/)
  })
  it('CONTROL: with the rule taken out, or lifting to the third ink, neither row lifts', () => {
    for (const sel of LIFT) {
      expect(declaredValue(withDeclaration(sheet, sel, '--bn-ink-3', null), sel, '--bn-ink-3'), sel).toBe(null)
      expect(declaredValue(withDeclaration(sheet, sel, '--bn-ink-3', 'var(--color-ink-3)'), sel, '--bn-ink-3'), sel).toBe('var(--color-ink-3)')
    }
  })

  // R2-03: the table's scroller keeps its sticky head, and the ring, clear.
  const SCROLLER = '.rb-scene-table-wrap > .ui-table-scroll'
  /** A scroll-padding: does it keep the kit head's height, and how many px beyond it. */
  const padding = (v) => ({ head: /^calc\(var\(--table-head\) \+ \d+(?:\.\d+)?px\)$/.test(v || ''), px: Number(((v || '').match(/(\d+(?:\.\d+)?)px\)?$/) || [])[1] ?? NaN) })
  it('R2-03: the table scroller keeps the kit\'s sticky head, `--table-head` tall, and the ring\'s reach clear at its top, and the ring\'s reach at its bottom', () => {
    // The head is the kit's `.ui-th`: sticky at the scroller's top, `--table-head` tall.
    const th = rulesOf(indexCss).find(({ sel }) => sel === '.ui-th').body
    expect(th).toMatch(/(?:^|;)\s*position: sticky;/)
    expect(th).toMatch(/(?:^|;)\s*top: 0;/)
    expect(th).toMatch(/(?:^|;)\s*height: var\(--table-head\);/)
    const top = padding(declaredValue(sheet, SCROLLER, 'scroll-padding-top'))
    const bottom = padding(declaredValue(sheet, SCROLLER, 'scroll-padding-bottom'))
    expect(top.head).toBe(true)
    expect(top.px).toBeGreaterThanOrEqual(ring.reach)
    expect(bottom.px).toBeGreaterThanOrEqual(ring.reach)
  })
  it('CONTROL: taken out, the ring\'s 4px alone at the top (the head forgotten), or the head alone, each fails', () => {
    const top = (css) => padding(declaredValue(css, SCROLLER, 'scroll-padding-top'))
    const gone = withDeclaration(sheet, SCROLLER, 'scroll-padding-top', null)
    expect(top(gone).head && top(gone).px >= ring.reach).toBe(false)
    const ringOnly = withDeclaration(sheet, SCROLLER, 'scroll-padding-top', '4px')
    expect(top(ringOnly).head && top(ringOnly).px >= ring.reach).toBe(false)
    const headOnly = withDeclaration(sheet, SCROLLER, 'scroll-padding-top', 'var(--table-head)')
    expect(top(headOnly).head && top(headOnly).px >= ring.reach).toBe(false)
    const noBottom = withDeclaration(sheet, SCROLLER, 'scroll-padding-bottom', null)
    expect(padding(declaredValue(noBottom, SCROLLER, 'scroll-padding-bottom')).px >= ring.reach).toBe(false)
  })
})

/* ── 7f. S3b step 6: the card's shot-list menu, and Add from another list ──
   CSS the mounted tests cannot see: the card's new menu button must read
   over a picture as its delete does, and the Add-from rows must scroll in
   their own well, tick in the signal, and grey what the list holds. */
describe('S3b step 6: the card\'s shot-list menu over a picture; the Add-from rows', () => {
  const FRAME_BTN = '.rb-scene-card .rb-scene-card-frame .rb-scene-card-acts > .ui-iconbtn'
  it('every button over a frame — the delete and the shot-list menu — on the paper with the hairline, over the kit\'s hover, its own hover over that', () => {
    expect([declaredValue(sheet, FRAME_BTN, 'background-color'), declaredValue(sheet, FRAME_BTN, 'border-color')]).toEqual(['var(--color-paper)', 'var(--color-rule)'])
    expect(declaredValue(sheet, `${FRAME_BTN}:hover`, 'background-color')).toBe('var(--color-paper-raised)')
    expect(gt(specificity(FRAME_BTN), specificity('.ui-iconbtn:hover:not(:disabled)'))).toBeGreaterThan(0)
  })
  const ROWS = [
    ['.rb-scene-addfrom-list', 'overflow-y', 'auto'],
    ['.rb-scene-addfrom-list', 'max-height', '48vh'],
    ['.rb-scene-addfrom-row > input', 'accent-color', 'var(--color-signal)'],
    ['.rb-scene-addfrom-row[data-locked="true"] > .rb-scene-addfrom-name', 'color', 'var(--color-ink-3)'],
    ['.rb-scene-addfrom-row[data-locked="true"]:hover', 'background-image', 'none'],
  ]
  it('the rows scroll in their own well, so the footer stays in reach; a box ticks in the signal; a row the list holds is greyed and does not light on hover', () => {
    for (const [sel, prop, value] of ROWS) expect(declaredValue(sheet, sel, prop), sel).toBe(value)
  })
  it('CONTROL: each reading fails on the sheet without its declaration', () => {
    expect(declaredValue(withDeclaration(sheet, FRAME_BTN, 'background-color', null), FRAME_BTN, 'background-color')).toBe(null)
    for (const [sel, prop] of ROWS) expect(declaredValue(withDeclaration(sheet, sel, prop, null), sel, prop), sel).toBe(null)
  })
})

/* ── 7g. S3b step 7: what a reviewer reads ────────────────────────────────
   The read-only cells and thumbnails (`data-static`) promise nothing — no
   hover fill, no text cursor or pointer, the mark kept on hover — and the
   nest's greyed Delete keeps its place at the bar's end; the bulk bars'
   greyed edits keep the bar's gap between them (review round 1, R1-16). */
describe('S3b step 7: a read-only cell or thumbnail promises nothing; a greyed Delete keeps its place', () => {
  const STATIC = [
    ['.rb-scene-inline[data-static="true"]', 'cursor', 'default'],
    ['.rb-scene-inline[data-static="true"]:hover', 'background-color', 'transparent'],
    ['.rb-scene-thumb[data-static="true"]', 'cursor', 'default'],
    ['.rb-scene-thumb[data-static="true"]:hover > .rb-scene-thumb-mark', 'opacity', '1'],
    ['.rb-scene-nest-bulk > .rb-scene-nest-delete-gate', 'margin-left', 'auto'],
    ['.rb-scene-bulk-gate', 'gap', 'inherit'],
  ]
  it('each declared, and each over the rule it answers', () => {
    for (const [sel, prop, value] of STATIC) expect(declaredValue(sheet, sel, prop), sel).toBe(value)
    expect(gt(specificity('.rb-scene-inline[data-static="true"]:hover'), specificity('.rb-scene-inline:hover'))).toBeGreaterThan(0)
    expect(gt(specificity('.rb-scene-thumb[data-static="true"]:hover > .rb-scene-thumb-mark'), specificity('.rb-scene-thumb:hover > .rb-scene-thumb-mark'))).toBeGreaterThan(0)
  })
  it('CONTROL: each reading fails on the sheet without its declaration', () => {
    for (const [sel, prop] of STATIC) expect(declaredValue(withDeclaration(sheet, sel, prop, null), sel, prop), sel).toBe(null)
  })
})

/* ── 8. reduced motion (plan §3.4) ───────────────────────────────────────── */
const sameSel = (s) => s.replace(/\s+/g, ' ').trim()
function reducedMotionBlocks(css) {
  const c = cssCode(css)
  const out = []
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let m
  while ((m = re.exec(c))) {
    let depth = 1, i = re.lastIndex
    for (; i < c.length && depth > 0; i++) { if (c[i] === '{') depth++; else if (c[i] === '}') depth-- }
    out.push({ start: m.index, end: i, text: c.slice(re.lastIndex, i - 1) })
  }
  return out
}
function motionCoverage(css) {
  const c = cssCode(css)
  const blocks = reducedMotionBlocks(css)
  const inBlock = (i) => blocks.some((b) => i >= b.start && i < b.end)
  const moving = []
  for (const m of c.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    if (sel.startsWith('@') || inBlock(m.index)) continue
    if (!/(?:^|;)\s*transition(?:-[a-z]+)?\s*:\s*(?!none\s*(?:;|$))/.test(m[2])) continue
    for (const one of selectorsOf(sel)) moving.push({ sel: sameSel(one), at: m.index })
  }
  const quiet = new Map()
  const loud = []
  for (const b of blocks) {
    for (const r of rulesOf(b.text)) {
      if (!/^\s*transition\s*:\s*none\s*;?\s*$/.test(r.body)) loud.push(`${sameSel(r.sel)} { ${r.body.trim()} }`)
      for (const one of selectorsOf(r.sel)) quiet.set(sameSel(one), b.start)
    }
  }
  return {
    blocks: blocks.length,
    moving: moving.length,
    uncovered: moving.filter((x) => !quiet.has(x.sel)).map((x) => x.sel),
    late: moving.filter((x) => quiet.has(x.sel) && x.at > quiet.get(x.sel)).map((x) => x.sel),
    loud,
  }
}

describe('reduced motion (plan §3.4): every transition this sheet declares is stopped in its one block', () => {
  it('at most one block, and one as soon as anything moves; each rule in it only `transition: none`; every transition has its twin there, none after it', () => {
    const cov = motionCoverage(sheet)
    expect(cov.blocks).toBe(cov.moving > 0 ? 1 : 0)
    expect(cov.loud).toEqual([])
    expect(cov.uncovered).toEqual([])
    expect(cov.late).toEqual([])
    // C5: never a `*` — the pet's keyframes must keep playing.
    for (const b of reducedMotionBlocks(sheet)) expect(b.text).not.toMatch(/(^|[\s,])\*(\s|,|\{|$)/)
  })
  it('CONTROL: a transition with no twin, one declared after its twin, and a block rule that does more than stop one are each caught', () => {
    const end = sheet.lastIndexOf('}')
    const block = '  @media (prefers-reduced-motion: reduce) {\n    .rb-scene-y { transition: none; }\n  }\n'
    const withBlock = `${sheet.slice(0, end)}${block}${sheet.slice(end)}`
    const at = withBlock.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(motionCoverage(`${withBlock.slice(0, at)}.rb-scene-x { transition: opacity 1s; }\n  ${withBlock.slice(at)}`).uncovered).toEqual(['.rb-scene-x'])
    const late = withBlock.lastIndexOf('}')
    expect(motionCoverage(`${withBlock.slice(0, late)}  .rb-scene-y { transition: color 1s; }\n${withBlock.slice(late)}`).late).toEqual(['.rb-scene-y'])
    expect(motionCoverage(withBlock.replace('.rb-scene-y { transition: none; }', '.rb-scene-y { transition: none; opacity: 1; }')).loud).toHaveLength(1)
  })
})

/* ── 9. Post-overhaul S3c, step 6: the drop line and the grip's room ───────
   The mounted tests see a row's data-drop and a cell's data-grip; only the
   sheet draws them, and a rule taken out passed every other test (step 6's
   planted faults). Each is read off the sheet, with a CONTROL that the
   reading fails without it. */
describe('S3c step 6: the drop line and the grip cell are on the sheet', () => {
  const LINE = {
    '.rb-scene-table .ui-tr.rb-scene-row[data-drop="before"] > .ui-td': 'inset 0 2px 0 0 var(--color-signal)',
    '.rb-scene-table .ui-tr.rb-scene-group-row[data-drop="before"] > .ui-td': 'inset 0 2px 0 0 var(--color-signal)',
    '.rb-scene-table .ui-tr.rb-scene-row[data-drop="after"] > .ui-td': 'inset 0 -2px 0 0 var(--color-signal)',
    '.rb-scene-table .ui-tr.rb-scene-group-row[data-drop="after"] > .ui-td': 'inset 0 -2px 0 0 var(--color-signal)',
  }
  const ROOM = [
    '.rb-scene-table .ui-tr > .ui-td.rb-scene-num-cell[data-grip="true"]',
    '.rb-scene-table .ui-tr > .ui-td.rb-scene-cut-pos[data-grip="true"]',
  ]
  it('a 2px signal line along the edge the row will land on — its top before, its bottom after — on a row and on a band, over the kit\'s selected first cell', () => {
    for (const [sel, v] of Object.entries(LINE)) {
      expect(declaredValue(sheet, sel, 'box-shadow'), sel).toBe(v)
      expect(gt(specificity(sel), specificity('.ui-tr[data-selected="true"] > .ui-td:first-child')), sel).toBeGreaterThan(0)
    }
  })
  it('a number cell with a grip is the grip\'s box and keeps its figure clear of it (4px in, 20 wide, 28px of room)', () => {
    for (const sel of ROOM) {
      expect(declaredValue(sheet, sel, 'position'), sel).toBe('relative')
      expect(declaredValue(sheet, sel, 'padding-left'), sel).toBe('28px')
    }
    expect(declaredValue(sheet, '.rb-scene-grip', 'position')).toBe('absolute')
    expect(declaredValue(sheet, '.rb-scene-grip', 'left')).toBe('4px')
    expect(declaredValue(sheet, '.rb-scene-grip', 'width')).toBe('20px')
    expect(declaredValue(sheet, '.rb-scene-grip', 'cursor')).toBe('grab')
    expect(declaredValue(sheet, '.rb-scene-group-head > .rb-scene-grip', 'position')).toBe('static')
  })
  it('CONTROL: each taken out, it no longer reads', () => {
    for (const sel of Object.keys(LINE)) expect(declaredValue(withDeclaration(sheet, sel, 'box-shadow', null), sel, 'box-shadow'), sel).toBe(null)
    for (const sel of ROOM) expect(declaredValue(withDeclaration(sheet, sel, 'padding-left', null), sel, 'padding-left'), sel).toBe(null)
  })
})
