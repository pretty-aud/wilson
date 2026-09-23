// =============================================================================
// rabbitShell.css — the guards for lane B1's stylesheet (UI overhaul B1,
// 2026-09-23). Pattern: dashboardCss.test.js, adminTerminalCss.test.js.
//
// Pinned here:
//   1. the @layer statement comes first (D1 hand-off §5 trap 1: a component-
//      imported stylesheet can be emitted before index.css, and then every
//      rule in it loses to Tailwind's preflight — silently, with every test
//      green, because no test here applies CSS);
//   2. the sheet writes no colour of its own, paints no signal ground (C6),
//      and never reaches into the kit's tab;
//   3. every `rb-` class is declared AND used, and every [data-x="v"] a rule
//      matches is a value the JSX can actually produce;
//   4. no rule loses a fight it cannot see: a rule on a class that shares its
//      element with `.ui-input` / `.ui-btn` outranks the kit rule whatever
//      order the sheets load in, and no rule sets a property a utility on the
//      same element also sets (the utilities layer always wins);
//   5. the state extraction holds: in B1's files, no inline `style` decides a
//      colour, fill, border, opacity, shadow, cursor or transform by state, in
//      any of the spellings a state has shipped in.
// Review round one (R1 finding 6) walked past the first version of 2–5 with
// real code; each spelling it used is now in a CONTROL below.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

/** Strip CSS comments so a rule can never be satisfied by its own documentation. */
const cssCode = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** JS comments out. A block comment only opens where code can put one — at a
    line start or after `{ ( , ; =` — so `accept="image/*"` never swallows code
    up to the next `*` + `/` (R1 finding 6a). Whole-line `//` comments too. */
export const jsCode = (src) => src.replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '')
/** Every rule's selector list and body, innermost blocks (so @layer / @media wrappers drop out). */
const rulesOf = (css) => [...cssCode(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }))
/** The compound selector that targets the element itself. */
const lastCompound = (sel) => sel.trim().split(/[\s>+~]+/).pop()

const shellCss = read('rabbitShell.css')

const OWNED = [
  'Rabbit.jsx', 'components/ViewTabs.jsx', 'components/ProjectContextBar.jsx',
  'views/IntakeWizardView.jsx', 'views/intake/IntakePrepare.jsx', 'views/intake/IntakeProgress.jsx',
  'views/intake/IntakeReview.jsx', 'views/ProjectSummaryView.jsx', 'views/TeamView.jsx',
]
const jsx = OWNED.map((f) => jsCode(read(f))).join('\n')

describe('rabbitShell.css declares the cascade layer order before it uses a layer', () => {
  const src = cssCode(shellCss)
  it('names all four layers, in Tailwind order, as a statement, before the first @layer block', () => {
    const statement = src.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = src.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThanOrEqual(0)
    expect(statement).toBeLessThan(firstBlock)
  })
})

/* ── colour ───────────────────────────────────────────────────────────────── */
describe('rabbitShell.css writes no colour of its own, and paints no orange ground', () => {
  const src = cssCode(shellCss)
  const indexCss = cssCode(readFileSync(join(here, '../../index.css'), 'utf8'))

  it('no hex literal anywhere in the rules (@theme is the only place a hex is written)', () => {
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([])
  })
  it('no rgb()/rgba() literal either — the alpha tokens are in @theme too', () => {
    expect(src.match(/\brgba?\(/g) || []).toEqual([])
  })
  it('every custom property it reads is defined in index.css', () => {
    const readProps = [...new Set((src.match(/var\(\s*(--[a-z0-9-]+)/g) || []).map((v) => v.replace(/^var\(\s*/, '')))]
    expect(readProps.length).toBeGreaterThan(10)
    expect(readProps.filter((p) => !new RegExp(`${p}\\s*:`).test(indexCss))).toEqual([])
  })
  it('C6: no rule paints a signal or signal-fill ground (the tint is allowed; the kit Button owns the one fill)', () => {
    const fills = rulesOf(shellCss)
      .filter(({ body }) => /background(-color)?\s*:\s*var\(--color-signal(-fill)?\)/.test(body))
      .map(({ sel }) => sel)
    expect(fills).toEqual([])
  })
  it("no rule reaches into the kit's tab to paint its ink or ground (ViewTabs.test reads index.css; this is the other half)", () => {
    const hits = rulesOf(shellCss)
      .filter(({ sel, body }) => /\.ui-tab\b/.test(sel) && /(^|;)\s*(color|background(-color)?)\s*:/.test(body))
      .map(({ sel }) => sel)
    expect(hits).toEqual([])
  })
})

/* ── classes and attributes ───────────────────────────────────────────────── */
const declaredIn = (css) => new Set((cssCode(css).match(/\.rb-[a-z0-9-]+/g) || []).map((s) => s.slice(1)))
const usedIn = (sources) => new Set(sources.flatMap((s) => jsCode(s).match(/(?<![\w.-])rb-[a-z0-9-]+/g) || []))

describe('every rb- class is both declared and used', () => {
  const declared = declaredIn(shellCss)
  const used = usedIn(OWNED.map(read))

  it('no rule without a caller', () => {
    expect([...declared].filter((c) => !used.has(c))).toEqual([])
  })
  it('no class without a rule', () => {
    expect([...used].filter((c) => !declared.has(c))).toEqual([])
  })
  it('CONTROL: the scanners find a real pair and ignore comments', () => {
    expect(declared.has('rb-viewtabs')).toBe(true)
    expect(used.has('rb-viewtabs')).toBe(true)
    expect(declaredIn('/* .rb-ghost { } */ .rb-real { }')).toEqual(new Set(['rb-real']))
    expect(usedIn(['{/* className="rb-ghost" */}\n// rb-ghost2\nclassName="rb-real x"'])).toEqual(new Set(['rb-real']))
  })
})

/** For each [data-x="v"] a rule matches: is `data-x` ever set, and can it be `v`? */
export function unreachableAttributeValues(css, source) {
  const bad = []
  const pairs = [...new Set([...cssCode(css).matchAll(/\[(data-[a-z-]+)="([^"]+)"\]/g)].map((m) => `${m[1]}=${m[2]}`))]
  for (const pair of pairs) {
    const [name, value] = pair.split('=')
    const sets = [...source.matchAll(new RegExp(`${name}=(\\{[^}]*\\}|"[^"]*")`, 'g'))].map((m) => m[1])
    if (sets.length === 0) { bad.push(`${pair}: never set`); continue }
    // An assignment that is not a string literal or a ternary of literals is
    // dynamic (data-status={status}), and any value may arrive.
    const literalOnly = (s) => /^"[^"]*"$/.test(s) || /^\{[^{}]*\?\s*['"][^'"]*['"]\s*:\s*(undefined|['"][^'"]*['"]|[^{}]*\?[^{}]*)\s*\}$/.test(s)
    if (!sets.every(literalOnly)) continue
    const literals = sets.flatMap((s) => [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]))
    if (!literals.includes(value)) bad.push(`${pair}: the JSX only ever sets ${[...new Set(literals)].join(', ')}`)
  }
  return bad
}

describe('every attribute value a rule matches is one the JSX can produce (R1 finding 6c)', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(shellCss, jsx)).toEqual([])
  })
  it('CONTROL: catches a never-set attribute and a value outside a literal ternary; lets a dynamic one through', () => {
    const css = '.a[data-open="true"]{} .b[data-state="gone"]{} .c[data-status="x"]{} .d[data-ghost="1"]{}'
    const src = `<i data-open={o ? 'true' : undefined} /> <i data-state={a ? 'on' : b ? 'off' : 'disabled'} /> <i data-status={status} />`
    expect(unreachableAttributeValues(css, src)).toEqual([
      'data-state=gone: the JSX only ever sets on, off, disabled',
      'data-ghost=1: never set',
    ])
  })
})

/* ── the cascade ──────────────────────────────────────────────────────────── */
const classStrings = (source) =>
  [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => (m[1] ?? m[2]).split(/\s+/).filter(Boolean))

/** Rules whose element-compound targets an rb- class that shares its element with a kit class, below (0,2,0). */
export function weakAgainstKit(css, source) {
  const shared = new Set(classStrings(source)
    .filter((c) => c.includes('ui-input') || c.includes('ui-btn'))
    .flat().filter((c) => c.startsWith('rb-')))
  const weak = []
  for (const { sel } of rulesOf(css)) {
    for (const one of sel.split(',')) {
      const last = lastCompound(one)
      const cls = (last.match(/\.rb-[a-z0-9-]+/g) || []).map((s) => s.slice(1))
      if (!cls.some((c) => shared.has(c))) continue
      // A compound that excludes the kit element outright never meets it.
      if (/:not\([^)]*(\.ui-input|\.ui-btn|select|input|button)[^)]*\)/.test(last)) continue
      const parts = (last.match(/\.[a-z0-9-]+|\[[^\]]+\]|:(?!not\b)[a-z-]+/g) || []).length
      if (parts < 2) weak.push(one.trim())
    }
  }
  return weak
}

const UTILITY_OWNS = [
  ['font-weight', /^(text-h[123]|text-label|font-(normal|medium|semibold|bold))$/],
  ['font-size', /^text-(h[123]|body|dense|caption|label)$/],
  ['border-radius', /^rounded(-|$)/],
]
/** A rule that sets a property a utility on the same element also sets — the utility always wins. */
export function utilityConflicts(css, source) {
  const rules = rulesOf(css)
  const out = new Set()
  for (const set of classStrings(source)) {
    for (const c of set.filter((x) => x.startsWith('rb-'))) {
      for (const { sel, body } of rules) {
        const targets = sel.split(',').some((one) => new RegExp(`\\.${c}(?![a-z0-9-])`).test(lastCompound(one)))
        if (!targets) continue
        for (const [prop, util] of UTILITY_OWNS) {
          const utils = set.filter((u) => util.test(u))
          if (utils.length && new RegExp(`(^|;)\\s*${prop}\\s*:`).test(body)) out.add(`${c}: ${prop} vs ${utils.join(' ')}`)
        }
      }
    }
  }
  return [...out]
}

describe('no rule loses a fight it cannot see (R1 findings 2, 7, 11)', () => {
  it('a rule for an rb- class on a .ui-input / .ui-btn element is (0,2,0) or more', () => {
    expect(weakAgainstKit(shellCss, jsx)).toEqual([])
  })
  it('no rule sets a property that a utility on the same element also sets', () => {
    expect(utilityConflicts(shellCss, jsx)).toEqual([])
  })
  it('CONTROL: both fire on the shapes review round one found, and stay quiet on the fixes', () => {
    expect(weakAgainstKit('.rb-t { color: x } .rb-t[data-a="1"] { color: y }', '<select className="ui-input rb-t" />'))
      .toEqual(['.rb-t'])
    expect(weakAgainstKit('.ui-input.rb-t { color: x }', '<select className="ui-input rb-t" />')).toEqual([])
    expect(utilityConflicts('.rb-t[data-e="true"] { font-weight: 400 }', '<span className="rb-t text-h3" />'))
      .toEqual(['rb-t: font-weight vs text-h3'])
    expect(utilityConflicts('.rb-s { border-radius: 0 }', '<div className="rb-s rounded-control" />'))
      .toEqual(['rb-s: border-radius vs rounded-control'])
    expect(utilityConflicts('.rb-s { color: x }', '<div className="rb-s rounded-control text-h3" />')).toEqual([])
  })
})

/* ── the extraction holds ─────────────────────────────────────────────────── */
const STATE_PROPS = 'color|background[A-Za-z]*|border[A-Za-z]*|opacity|boxShadow|outline[A-Za-z]*|fill|stroke|cursor|transform|fontWeight|textDecoration[A-Za-z]*|accentColor|caretColor|filter|visibility'
const STATE_VALUE = new RegExp(`['"]?\\b(${STATE_PROPS})['"]?\\s*:\\s*([^,\\n}]*)`, 'g')

export function inlineStateTernaries(src) {
  const code = jsCode(src)
  const hits = []
  const at = (i) => code.slice(0, i).split('\n').length
  // A const whose value is decided by state and is a colour / token
  // (`const c = active ? '#fff' : '#000'`) — then used in a style.
  const stateConsts = new Set([...code.matchAll(/const\s+(\w+)\s*=\s*[^;\n]*\?[^;\n]*(#[0-9a-fA-F]{3,8}|var\(--color|rgba?\()/g)].map((m) => m[1]))

  for (const t of code.matchAll(/className=\{`[^`]*`\}/g)) {
    if (/\$\{[^}]*\?/.test(t[0])) hits.push(`${at(t.index)}: ${t[0].slice(0, 90)}`)
  }
  // className chosen by a ternary expression, not a template — when a branch
  // carries a VISUAL class (ink, ground, border, weight, step, radius, a kit or
  // rb- class). A layout variant (the Control Panel's one- or two-column grid,
  // chosen by permission) is not a state that a class could beat.
  const VISUAL = /['"\s](text-(?!left\b|right\b|center\b|start\b|end\b)|bg-|border\b|border-|opacity-|font-|shadow|ring-|rounded|underline|italic|uppercase|ui-|rb-)/
  for (const t of code.matchAll(/className=\{(?!`)([^{}]*)\}/g)) {
    if (/\?/.test(t[1]) && VISUAL.test(t[1])) hits.push(`${at(t.index)}: className={${t[1].slice(0, 80)}}`)
  }

  const re = /style=\{/g
  let m
  while ((m = re.exec(code))) {
    let depth = 0
    let i = m.index + 'style='.length
    const start = i
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) break
    }
    const body = code.slice(start, i + 1)
    const where = `${at(m.index)}: ${body.replace(/\s+/g, ' ').slice(0, 90)}`
    // The whole style chosen by a condition: style={on ? A : B}, style={x ? undefined : {…}}.
    if (!/^\{\s*\{/.test(body) && /\?/.test(body)) { hits.push(where); continue }
    // A spread whose object is chosen by a condition: {{ ...(on ? {…} : {}) }}
    if (/\.\.\.\s*\([^)]*\?/.test(body)) { hits.push(where); continue }
    for (const v of body.matchAll(STATE_VALUE)) {
      const value = v[2]
      if (/\?|&&|\|\|/.test(value)                             // ternary, `on && x`, `a || b`
        || /^\s*[A-Za-z_$][\w$.]*\s*\[/.test(value)              // a lookup table: COLORS[state]
        || [...stateConsts].some((c) => new RegExp(`^\\s*${c}\\b`).test(value))) {
        hits.push(where)
        break
      }
    }
  }
  return hits
}

describe('the state extraction holds in every B1 file', () => {
  for (const file of OWNED) {
    it(`${file}: no inline style or className decides a visual property by state`, () => {
      expect(inlineStateTernaries(read(file))).toEqual([])
    })
  }

  it('CONTROL: the scanner fires on every spelling a state has shipped in (R1 finding 6a), and not on a static style', () => {
    const fires = [
      `<b style={{ color: active ? '#fff' : '#000' }} />`,
      `<b style={{\n  backgroundColor: on ? 'a' : 'b',\n}} />`,
      `<b style={{ border: \`1px solid \${on ? 'a' : 'b'}\` }} />`,
      `<b style={{ opacity: disabled ? 0.3 : 1 }} />`,
      `<b style={{ boxShadow: isActive ? '0 0 0 1px x' : 'none' }} />`,
      `<b style={on ? { color: 'a' } : { color: 'b' }} />`,
      `<b style={tone === 'good' ? { borderColor: 'a' } : {}} />`,
      `<b style={isLong ? undefined : { width: 90 }} />`,
      `<b style={{ cursor: disabled ? 'not-allowed' : 'pointer' }} />`,
      `<b style={{ transform: checked ? 'translateX(16px)' : 'none' }} />`,
      '<b className={`text-dense ${on ? \'font-semibold\' : \'\'}`} />',
      // round one's walk-pasts:
      `<b style={on ? ON : OFF} />`,
      `<b style={{ ...(active ? { color: 'a' } : {}) }} />`,
      `<b style={{ color: active && '#fb923c' }} />`,
      `const c = active ? '#fb923c' : '#78716c'\n<b style={{ color: c }} />`,
      `<b style={{ color: COLORS[state] }} />`,
      `<b style={{ 'color': on ? 'a' : 'b' }} />`,
      `<b style={{ accentColor: on ? 'a' : 'b' }} />`,
      `<b style={{ caretColor: on ? 'a' : 'b' }} />`,
      `<b style={{ filter: on ? 'brightness(1.2)' : 'none' }} />`,
      `<b style={{ visibility: on ? 'visible' : 'hidden' }} />`,
      `<b className={on ? 'bg-hover' : 'bg-transparent'} />`,
      `<b className={on ? 'rb-x text-dense' : 'rb-x text-caption'} />`,
      `<input accept="image/*" />\n<b style={{ color: on ? 'a' : 'b' }} />\n{/* a real comment */}`,
    ]
    for (const f of fires) expect(inlineStateTernaries(f), f).not.toEqual([])
    const quiet = [
      `<b style={{ color: '#fff', width: 16 }} />`,
      `<b style={{ width: open ? 200 : 0 }} />`,
      `<b style={{ color: 'var(--color-ink)', border: '1px solid var(--color-rule)' }} />`,
      `{/* style={{ color: a ? 'x' : 'y' }} */}`,
      `// style={{ color: a ? 'x' : 'y' }}`,
      '<b className={`ui-x ${className}`} />',
      `<b className={className} />`,
      `<b className={canSeeMoney ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'grid grid-cols-1 gap-6'} />`,
    ]
    for (const q of quiet) expect(inlineStateTernaries(q), q).toEqual([])
  })
})
