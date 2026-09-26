// =============================================================================
// rabbitBudget.css — lane B5's sheet (R.A.B.B.I.T. Budget), and the files it
// styles. The guards are B2's, B3's and B4's (rabbitCssGuards.js), pointed at
// this lane: one layer, only lane classes, every selector scoped, every class
// declared AND written, no attribute value nobody sets, no fight with a
// utility or the kit that source order would decide, no colour that is not a
// token, and no state decided in a style or a className.
//
// FILES grows one surface per commit (B5 lands one commit per surface): a
// file joins here, whole, in the commit that moves it onto this sheet, with a
// mounted test in rabbitBudgetRender.test.jsx — or, for a file too big for
// one surface (BudgetView.jsx, ~2,900 lines, three surfaces), with a `staged`
// list: the top-level functions whose restyle has not landed yet. The guards
// read the file with those functions taken out (`withoutFunctions`, below),
// and each surface shortens the list until it is empty.
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
} from '../rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const SHEET = resolve(here, 'rabbitBudget.css')
const sheet = read('rabbitBudget.css')
/** Lane B5's class prefixes (the second word after `rb-`), as the guards' `prefix`. */
const LANE = 'money|budget|crew|talent|client|pop'
const LANE_RE = new RegExp(`^rb-(${LANE})-`)
/** B5's files on this sheet, relative to this directory, the prefix each
    writes, and the least it can weigh (a thin component is short; a read
    that came back empty is not). */
const FILES = {
  // B5 surface 1: the one money formatter and its figure (R3-01, R3-02,
  // R3-14, R3-34). It writes no style: the size and the ink are inherited.
  money: { file: '../components/CurrencyDisplay.jsx', prefix: 'rb-money-', min: 1500 },
  // B5 surface 2a: the Summary, the seven reports, Custom and their shared
  // helpers. B5 surface 2b: the Expenses tab, its filter strip, saved views,
  // create / edit dialog and relation pickers. B5 surface 3: the tab strip
  // and the shell — nothing is staged; the whole file is read.
  budget: { file: './BudgetView.jsx', prefix: 'rb-budget-', min: 3000 },
  // B5 surface 5: the client estimate — the preview on the paper (C9) and
  // the print document in the app's face (R3-27). It writes no style: the
  // Estimate column's width is the sheet's, read by the kit Th.
  client: { file: './budget/ClientViewTab.jsx', prefix: 'rb-client-', min: 3000 },
  // B5 surface 2b: the lane's one popover (R3-32) and the margin &
  // contingency editor on it, which Crew and Talent take next.
  pop: { file: './budget/BudgetPopover.jsx', prefix: 'rb-pop-', min: 1000 },
  marginCont: { file: './budget/MarginContPopover.jsx', prefix: 'rb-pop-', min: 1000 },
}
/** The inline styles each file may write: a caller-given geometry or a
    measured quantity carried as a custom property, never a state. */
const STYLES = {
  // The popover's caller-given width and its measured place, in px.
  pop: ["{{ '--rb-pop-w': width, '--rb-pop-x': place.x, '--rb-pop-y': place.y }}"],
}

/** A source with the named top-level functions taken out. A function starts
    at a column-0 `function NAME(` or `export default function NAME(` and runs
    to the line before the next column-0 `function `, `export `, `const ` or
    `// ─` line — so a constant or a section divider between two staged
    functions stays in, and is read. */
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
const source = Object.fromEntries(Object.entries(FILES).map(([k, { file, staged }]) => [k, staged ? withoutFunctions(read(file), staged) : read(file)]))
const code = Object.fromEntries(Object.entries(source).map(([k, s]) => [k, normal(jsCode(s))]))
const jsx = Object.values(code).join('\n')
const ELEMENTS = Object.values(source).flatMap(elementsOf)

/* ── 1. the sheet's shape ─────────────────────────────────────────────────── */
describe('rabbitBudget.css: one layer, its own classes, every selector scoped', () => {
  it('the sheet and every file were read (every assertion below is an empty list otherwise)', () => {
    expect(rulesOf(sheet).length).toBeGreaterThan(0)
    for (const [key, { file, min }] of Object.entries(FILES)) expect(source[key].length, file).toBeGreaterThan(min)
  })
  it('the @layer statement comes first and every rule sits inside the one components block', () => {
    const { statementFirst, rest } = outsideLayer(sheet)
    expect(statementFirst).toBe(true)
    expect(rest).toBe('')
  })
  it('every class is a B5 lane class or the kit\'s', () => {
    expect(strayClasses(sheet, LANE)).toEqual([])
  })
  it('every selector carries a lane class outside any :not()', () => {
    expect(unscopedSelectors(sheet, LANE)).toEqual([])
  })
  it('CONTROL: the shape guards fire on a rule outside the layer, a late statement, a near-miss class and a bare kit override', () => {
    expect(outsideLayer(`${sheet}\n.rb-budget-x { color: red; }`).rest).not.toBe('')
    expect(outsideLayer(`@layer utilities { .a{} }\n${sheet}`).statementFirst).toBe(false)
    expect(strayClasses('.rb-budget-x {} .rb-budgets-ghost {} .rb-task-y {}', LANE)).toEqual(['rb-budgets-ghost', 'rb-task-y'])
    expect(unscopedSelectors('.ui-td { padding: 0 }', LANE)).toEqual(['.ui-td'])
    expect(unscopedSelectors('.rb-budget-x .ui-td { padding: 0 }', LANE)).toEqual([])
  })
})

/* ── 2. imports ────────────────────────────────────────────────────────────── */
describe('every B5 file on this sheet imports it', () => {
  for (const [key, { file }] of Object.entries(FILES)) {
    it(`${file} imports rabbitBudget.css by a path that resolves to it`, () => {
      expect(importedSheet(file, source[key], 'rabbitBudget.css')).toBe(SHEET)
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
  it('CONTROL: a hex planted in a staged function is ignored; one planted in a restyled function is caught', () => {
    // The mechanism, on a list of one: since surface 3 BudgetView.jsx is read
    // whole, so the control stages its shell itself.
    const { file } = FILES.budget
    const staged = ['BudgetView']
    const whole = read(file)
    // Plant on the first line inside the function's body.
    const plant = (name) => whole.replace(new RegExp(`^((?:export default )?function ${name}\\([^\\n]*\\n)`, 'm'), "$1  const planted = '#abcdef'\n")
    const inShell = plant('BudgetView')
    const inRestyled = plant('SummaryTab')
    const inExpenses = plant('ExpensesTab')
    for (const planted of [inShell, inRestyled, inExpenses]) expect(planted).not.toBe(whole)
    expect(stateLeaks(withoutFunctions(inShell, staged), STYLES.budget || [], [])).toEqual([])
    expect(stateLeaks(withoutFunctions(inRestyled, staged), STYLES.budget || [], [])).toEqual(['#abcdef'])
    expect(stateLeaks(withoutFunctions(inExpenses, staged), STYLES.budget || [], [])).toEqual(['#abcdef'])
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

describe('every B5 class is both declared and written', () => {
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
   skips a pair any other expression sets (B4c review round one). Each such
   setter is declared here with the values it can take, read from the
   component's own map, as rabbitFilesCss.test.js does. */
const VARIABLE = []
const variableKey = ({ classes, cls, attr, set }) => `${classes ? classes.join(' ') : cls} ${attr}=${set}`

describe('a data-* set from a variable: every value it can take has a rule, and every rule a value it can take', () => {
  it('every one the files set is declared above, and its premise holds', () => {
    expect(variableAttributes(jsx).map(variableKey).sort()).toEqual(VARIABLE.map(variableKey).sort())
    for (const { cls, from: [key, text] } of VARIABLE) expect(code[key], cls).toContain(text)
  })
  it('each value is read from the map, and the sheet keys on exactly those (less the ones the unkeyed rule serves)', () => {
    for (const { cls, attr, domain, base } of VARIABLE) {
      const values = domain()
      expect(values, `${cls}: the map could not be read`).not.toBeNull()
      expect(unmatchedValues(sheet, cls, attr, values, base), cls).toEqual([])
    }
  })
  it('CONTROL: an undeclared variable-valued attribute is caught', () => {
    const mutant = `${jsx}\n<span className="rb-money-figure" data-tone={tone} />`
    const declaredKeys = VARIABLE.map(variableKey)
    expect(variableAttributes(mutant).map(variableKey).filter((k) => !declaredKeys.includes(k))).toEqual(['rb-money-figure data-tone={tone}'])
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
      expect(kitFights(`.rb-budget-x { ${prop} }`, indexCss, elementsOf(`<${tag} className="rb-budget-x" />`), LANE).join('\n'), tag)
        .toMatch(new RegExp(`ties or loses to \\.${root}(?![\\w-])`))
    }
  })
})

/* ── 6. colour: every value a token ──────────────────────────────────────── */
describe('rabbitBudget.css writes no colour that is not a token', () => {
  it('no hex, no rgb()/hsl()/oklch(), no named or system colour', () => {
    expect(colourLiterals(sheet)).toEqual([])
  })
  it('every custom property it reads is defined, by the kit or by this sheet', () => {
    expect(undefinedProperties(sheet, indexCss, Object.values(source))).toEqual([])
    expect(readAwayFromSetter(sheet, Object.values(source))).toEqual([])
  })
  it('CONTROL: a hex, a named colour and an undefined property are each caught', () => {
    const fake = (decl) => `@layer theme, base, components, utilities;\n@layer components { .rb-budget-x { ${decl} } }`
    expect(colourLiterals(fake('color: #78716c;'))).toHaveLength(1)
    expect(colourLiterals(fake('border-color: white;'))).toHaveLength(1)
    expect(undefinedProperties(fake('color: var(--rb-budget-nowhere);'), indexCss, [])).toHaveLength(1)
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
  it('CONTROL: a hover colour in a style and a state in a className template are caught', () => {
    expect(inlineStateTernaries("<b style={{ color: hovered ? '#fb923c' : '#78716c' }} />").length).toBeGreaterThan(0)
    expect(stateLeaks("<b className={`x ${on ? 'a' : 'b'}`} />", [], []).length).toBeGreaterThan(0)
  })
  it('CONTROL: in every file, a spread in any spacing, a palette utility and a literal colour prop are each caught', () => {
    for (const [key, { file }] of Object.entries(FILES)) {
      // The first lane class, written as a literal or as a template whose only
      // hole is the caller's `${className}` (CurrencyDisplay's).
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
    const block = '  @media (prefers-reduced-motion: reduce) {\n    .rb-budget-y { transition: none; }\n  }\n'
    const withBlock = `${sheet.slice(0, end)}${block}${sheet.slice(end)}`
    const at = withBlock.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(motionCoverage(`${withBlock.slice(0, at)}.rb-budget-x { transition: opacity 1s; }\n  ${withBlock.slice(at)}`).uncovered).toEqual(['.rb-budget-x'])
    const late = withBlock.lastIndexOf('}')
    expect(motionCoverage(`${withBlock.slice(0, late)}  .rb-budget-y { transition: color 1s; }\n${withBlock.slice(late)}`).late).toEqual(['.rb-budget-y'])
    expect(motionCoverage(withBlock.replace('.rb-budget-y { transition: none; }', '.rb-budget-y { transition: none; opacity: 1; }')).loud).toHaveLength(1)
  })
})
