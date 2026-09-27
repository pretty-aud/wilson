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
  arrayValues,
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
}
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
  it('R3-26: no e.target.style write and no onMouseEnter / onMouseLeave anywhere in the file, staged functions included', () => {
    const whole = jsCode(read('./ScenesView.jsx'))
    expect(whole.match(/\.(?:target|currentTarget)\.style\b/g) || []).toEqual([])
    expect(whole.match(/\bonMouse(?:Enter|Leave)\b/g) || []).toEqual([])
  })
  it('W9: no window.confirm anywhere in the file', () => {
    expect(jsCode(read('./ScenesView.jsx'))).not.toMatch(/window\.confirm/)
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
  it('CONTROL: the R3-26 and W9 scans fire on the spellings they claim', () => {
    const mutant = "<select onMouseEnter={e => { e.target.style.borderColor = 'x' }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'y' }} />\nif (!window.confirm('Delete?')) return"
    expect(mutant.match(/\.(?:target|currentTarget)\.style\b/g)).toHaveLength(2)
    expect(mutant.match(/\bonMouse(?:Enter|Leave)\b/g)).toHaveLength(2)
    expect(mutant).toMatch(/window\.confirm/)
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
