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
//      and styles nothing on the kit's tab but its spacing;
//   3. every `rb-` class is declared AND used, and every [data-x="v"] a rule
//      matches is a value the JSX can produce on that rule's own element;
//   4. no rule loses a fight it cannot see: a rule on an element that also
//      wears `.ui-input` / `.ui-btn` outranks every kit rule for the same
//      property (index.css, read and measured), and no rule sets a property a
//      utility on the same element also sets (the utilities layer always wins);
//   5. the state extraction holds: in B1's files, no inline `style` or
//      className decides a visual property by state, in any spelling a state
//      has shipped in or a reviewer has written.
// Review rounds one and two walked past earlier versions of 2–5 with real
// code; every spelling they used is a CONTROL below (R1 finding 6, R2 finding 5).
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
/** Every rule's selector list and body, innermost blocks (so @layer / @media / @container wrappers drop out). */
const rulesOf = (css) => [...cssCode(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim(), body }))
  .filter(({ sel }) => !sel.startsWith('@'))
/** The compound selector that targets the element itself. */
const lastCompound = (sel) => sel.trim().split(/[\s>+~]+/).pop()
/** The properties a declaration block sets. */
const propsOf = (body) => [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1])
/** padding-left → padding, border-bottom-color → border, … */
const family = (prop) => prop.replace(/-(left|right|top|bottom|inline|block|start|end)(?=-|$)/g, '').replace(/-(color|width|style)$/, '')

/** CSS specificity [ids, classes+attrs+pseudo-classes, types], for the selectors this file and the kit write. */
export function specificity(sel) {
  let s = sel.trim()
  const sum = [0, 0, 0]
  // :not(x) and :is(x) count their argument; :where(x) counts nothing.
  s = s.replace(/:(not|is|where)\(([^()]*)\)/g, (_, fn, arg) => {
    if (fn !== 'where') {
      const inner = arg.split(',').map(specificity).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0]
      sum[0] += inner[0]; sum[1] += inner[1]; sum[2] += inner[2]
    }
    return ' '
  })
  sum[0] += (s.match(/#[\w-]+/g) || []).length
  sum[1] += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length
  sum[2] += (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length + (s.match(/::[\w-]+/g) || []).length
  return sum
}
const gt = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const shellCss = read('rabbitShell.css')
const indexCss = read('../../index.css')

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
/** Rules that paint a signal / signal-fill ground, in any spelling (fallback, color-mix, gradient). */
export const signalGrounds = (css) => rulesOf(css)
  .filter(({ body }) => /background(-color|-image)?\s*:[^;]*var\(\s*--color-signal(-fill)?(?![\w-])/.test(body))
  .map(({ sel }) => sel)
/** Declarations on the kit tab beyond its spacing. */
const TAB_SPACING = /^(padding|margin|gap|flex|flex-grow|flex-shrink|flex-basis|min-width)$/
export const tabReach = (css) => rulesOf(css)
  .filter(({ sel }) => /\.ui-tab\b|\[role=["']?tab["']?\]/.test(sel))
  .flatMap(({ sel, body }) => propsOf(body).filter((p) => !TAB_SPACING.test(family(p))).map((p) => `${sel} { ${p} }`))

describe('rabbitShell.css writes no colour of its own, and paints no orange ground', () => {
  const src = cssCode(shellCss)

  it('no hex literal anywhere in the rules (@theme is the only place a hex is written)', () => {
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([])
  })
  it('no rgb()/rgba() literal either — the alpha tokens are in @theme too', () => {
    expect(src.match(/\brgba?\(/g) || []).toEqual([])
  })
  it('every custom property it reads is defined in index.css', () => {
    const readProps = [...new Set((src.match(/var\(\s*(--[a-z0-9-]+)/g) || []).map((v) => v.replace(/^var\(\s*/, '')))]
    expect(readProps.length).toBeGreaterThan(10)
    expect(readProps.filter((p) => !new RegExp(`${p}\\s*:`).test(cssCode(indexCss)))).toEqual([])
  })
  it('C6: no rule paints a signal or signal-fill ground (the tint is allowed; the kit Button owns the one fill)', () => {
    expect(signalGrounds(shellCss)).toEqual([])
  })
  it("the kit's tab is styled here for its spacing only (ViewTabs.test reads index.css; this is the other half)", () => {
    expect(tabReach(shellCss)).toEqual([])
  })
  it('CONTROL: both fire on every spelling round two used, and not on the tint or on spacing', () => {
    for (const c of [
      '.x { background-color: var(--color-signal); }',
      '.x { background: var(--color-signal-fill); }',
      '.x { background-color: var(--color-signal, var(--color-paper-raised)); }',
      '.x { background-color: color-mix(in srgb, var(--color-signal-fill) 100%, transparent); }',
    ]) expect(signalGrounds(c), c).toHaveLength(1)
    expect(signalGrounds('.x { background-color: var(--color-signal-tint); box-shadow: inset 2px 0 0 0 var(--color-signal); }')).toEqual([])
    for (const c of [
      '.a .ui-tab[data-active="true"] { color: var(--color-ink); }',
      '.a .ui-tab { border-bottom-color: var(--color-ink); }',
      '.a .ui-tab { font-weight: 400; }',
      '.a [role="tab"] { color: var(--color-ink); }',
    ]) expect(tabReach(c), c).toHaveLength(1)
    expect(tabReach('.a .ui-tab { padding: 0 8px; margin-left: 2px; }')).toEqual([])
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

/** Every JSX opening tag in the source, walked to its closing `>` at brace depth 0. */
function jsxTags(source) {
  const tags = []
  const re = /<[A-Za-z][\w.]*/g
  let m
  while ((m = re.exec(source))) {
    let depth = 0, i = m.index
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(source.slice(m.index, i + 1))
  }
  return tags
}

/** For each [data-x="v"] (any quoting) a rule matches: is `data-x` ever set on
    an element of that rule's own class, and can it be `v`? Scoped by class,
    because three unrelated elements share `data-state` here (B1 mutant G1). */
export function unreachableAttributeValues(css, source) {
  const bad = []
  const tags = jsxTags(source)
  const pairs = new Set()
  for (const { sel } of rulesOf(css)) {
    for (const compound of sel.split(/[\s,>+~]+/)) {
      const cls = (compound.match(/\.rb-[a-z0-9-]+/) || [null])[0]
      for (const a of compound.matchAll(/\[(data-[a-z-]+)\s*=\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*\]/g)) {
        pairs.add(`${cls || ''}|${a[1]}=${a[2] ?? a[3] ?? a[4]}`)
      }
    }
  }
  for (const key of pairs) {
    const [cls, pair] = key.split('|')
    const [name, value] = pair.split('=')
    const scope = cls
      ? tags.filter((t) => new RegExp(`className=["{\`][^>]*\\b${cls.slice(1)}(?![a-z0-9-])`).test(t)).join('\n')
      : source
    const sets = [...scope.matchAll(new RegExp(`${name}=(\\{[^}]*\\}|"[^"]*")`, 'g'))].map((m) => m[1])
    if (sets.length === 0) { bad.push(`${cls ? cls + ' ' : ''}${pair}: never set`); continue }
    // An assignment that is not a string literal or a ternary of literals (and
    // null / undefined / false for "absent") is dynamic: any value may arrive.
    const ABSENT = '(?:undefined|null|false)'
    const LIT = `(?:'[^']*'|"[^"]*")`
    const literalOnly = (s) => /^"[^"]*"$/.test(s)
      || new RegExp(`^\\{[^{}]*\\?\\s*(?:${LIT}|${ABSENT})\\s*:\\s*(?:${LIT}|${ABSENT}|[^{}]*\\?[^{}]*)\\s*\\}$`).test(s)
    if (!sets.every(literalOnly)) continue
    const literals = sets.flatMap((s) => [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]))
    if (!literals.includes(value)) bad.push(`${cls ? cls + ' ' : ''}${pair}: the JSX only ever sets ${[...new Set(literals)].join(', ')}`)
  }
  return bad
}

describe('every attribute value a rule matches is one the JSX can produce (R1 finding 6c)', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(shellCss, jsx)).toEqual([])
  })
  it('CONTROL: catches a never-set attribute and a value outside a literal ternary; lets a dynamic one through', () => {
    const css = '.rb-a[data-open="true"]{} .rb-b[data-state="gone"]{} .rb-c[data-status="x"]{} .rb-d[data-ghost="1"]{}'
    const src = `<i className="rb-a" data-open={o ? 'true' : undefined} /> <i className="rb-b" data-state={a ? 'on' : b ? 'off' : 'disabled'} /> <i className="rb-c" data-status={status} /> <i className="rb-d" />`
    expect(unreachableAttributeValues(css, src)).toEqual([
      '.rb-b data-state=gone: the JSX only ever sets on, off, disabled',
      '.rb-d data-ghost=1: never set',
    ])
  })
  it('CONTROL: scoped by class; single-quoted and unquoted selectors; `: null` is still a literal ternary (R2 M7, M8)', () => {
    const src = `<i className="rb-dot" data-state={state} /> <div className="rb-step x" data-state={active ? 'active' : done ? 'done' : 'future'} /> <b className="rb-n" data-on={on ? 'true' : null} />`
    expect(unreachableAttributeValues('.rb-step[data-state="finished"]{}', src)).toEqual(['.rb-step data-state=finished: the JSX only ever sets active, done, future'])
    expect(unreachableAttributeValues(".rb-step[data-state='finished']{}", src)).toEqual(['.rb-step data-state=finished: the JSX only ever sets active, done, future'])
    expect(unreachableAttributeValues('.rb-step[data-state=finished]{}', src)).toEqual(['.rb-step data-state=finished: the JSX only ever sets active, done, future'])
    expect(unreachableAttributeValues('.rb-n[data-on="yes"]{}', src)).toEqual(['.rb-n data-on=yes: the JSX only ever sets true'])
  })
})

/* ── the cascade ──────────────────────────────────────────────────────────── */
const classStrings = (source) =>
  [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => (m[1] ?? m[2]).split(/\s+/).filter(Boolean))

/** The kit's rules for `.ui-input` / `.ui-btn` that can meet a B1 element at rest:
    selector, specificity, property families. Two kinds are left out, on
    purpose: a rule for the LIGHT surface (every B1 element is data-surface
    "dark"), and a rule for a STATE (:disabled, :hover, :focus…, ::placeholder)
    — there the kit's treatment is meant to win, and a B1 rule that outranked
    it would hide a disabled or focused field's look. */
function kitRules(kitCss) {
  const out = []
  for (const { sel, body } of rulesOf(kitCss)) {
    for (const one of sel.split(',')) {
      const last = lastCompound(one)
      const kit = ['ui-input', 'ui-btn'].find((k) => new RegExp(`\\.${k}(?![\\w-])`).test(last))
      if (!kit) continue
      if (/\[data-surface="light"\]/.test(one)) continue
      if (/:(?!not\()[a-z-]+/.test(last.replace(/\[[^\]]*\]/g, ''))) continue
      out.push({ kit, sel: one.trim(), spec: specificity(one), fams: new Set(propsOf(body).map(family)) })
    }
  }
  return out
}

/** A rule on an rb- class that shares its element with a kit class, for a property the kit also sets, at a specificity the kit's rule ties or beats. */
export function weakAgainstKit(css, source, kitCss = indexCss) {
  const sharedWith = new Map()
  for (const set of classStrings(source)) {
    for (const kit of ['ui-input', 'ui-btn']) {
      if (!set.includes(kit)) continue
      for (const c of set.filter((x) => x.startsWith('rb-'))) sharedWith.set(c, kit)
    }
  }
  const kit = kitRules(kitCss)
  const weak = []
  for (const { sel, body } of rulesOf(css)) {
    for (const one of sel.split(',')) {
      const last = lastCompound(one)
      if (/:not\([^)]*(\.ui-input|\.ui-btn|select|input|button)[^)]*\)/.test(last)) continue
      const cls = (last.match(/\.rb-[a-z0-9-]+/g) || []).map((s) => s.slice(1)).find((c) => sharedWith.has(c))
      if (!cls) continue
      const mine = specificity(one)
      for (const fam of new Set(propsOf(body).map(family))) {
        const rivals = kit.filter((k) => k.kit === sharedWith.get(cls) && k.fams.has(fam) && gt(k.spec, mine) >= 0)
        if (rivals.length) weak.push(`${one.trim()} { ${fam} } ties or loses to ${rivals.map((r) => r.sel).join(', ')}`)
      }
    }
  }
  return weak
}

const UTILITY_OWNS = [
  ['font-weight', /^(text-h[123]|text-label|font-(normal|medium|semibold|bold))$/],
  ['font-size', /^text-(h[123]|body|dense|caption|label)$/],
  ['border-radius', /^rounded(-|$)/],
  ['padding', /^p[xytrbl]?-/],
  ['margin', /^-?m[xytrbl]?-/],
  ['width', /^(w-|min-w-|max-w-)/],
  ['height', /^(h-|min-h-|max-h-)/],
  ['gap', /^gap(-[xy])?-/],
  ['display', /^(flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents)$/],
  ['color', /^text-(ink|signal|danger|success|warning|on-fill|white|black)/],
  ['background', /^bg-/],
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
        const fams = new Set(propsOf(body).map(family))
        for (const [prop, util] of UTILITY_OWNS) {
          const utils = set.filter((u) => util.test(u))
          if (utils.length && fams.has(family(prop))) out.add(`${c}: ${prop} vs ${utils.join(' ')}`)
        }
      }
    }
  }
  return [...out]
}

describe('no rule loses a fight it cannot see (R1 findings 2, 7, 11; R2 M9, M10)', () => {
  it('a rule for an rb- class on a .ui-input / .ui-btn element outranks every kit rule for the same property', () => {
    expect(weakAgainstKit(shellCss, jsx)).toEqual([])
  })
  it('no rule sets a property that a utility on the same element also sets', () => {
    expect(utilityConflicts(shellCss, jsx)).toEqual([])
  })
  it('CONTROL: both fire on the shapes the reviews found, and stay quiet on the fixes', () => {
    const kit = '.ui-input { color: a; width: 100%; padding: 0 12px; } .ui-input[data-size="sm"] { padding: 0 8px; height: 28px; }'
    const el = '<select className="ui-input rb-t" />'
    expect(weakAgainstKit('.rb-t { color: x }', el, kit)).toHaveLength(1)
    // R2 M9: (0,2,0) ties the kit's own (0,2,0) size rule for padding.
    expect(weakAgainstKit('.ui-input.rb-t { padding-left: 26px }', el, kit)).toHaveLength(1)
    expect(weakAgainstKit('.w > .ui-input.rb-t { padding-left: 26px }', el, kit)).toEqual([])
    expect(weakAgainstKit('.ui-input.rb-t { color: x; width: auto }', el, kit)).toEqual([])
    expect(weakAgainstKit('.rb-t { outline: none }', el, kit)).toEqual([])
    expect(utilityConflicts('.rb-t[data-e="true"] { font-weight: 400 }', '<span className="rb-t text-h3" />'))
      .toEqual(['rb-t: font-weight vs text-h3'])
    expect(utilityConflicts('.rb-s { border-radius: 0 }', '<div className="rb-s rounded-control" />'))
      .toEqual(['rb-s: border-radius vs rounded-control'])
    expect(utilityConflicts('.rb-s { padding: 4px }', '<div className="rb-s px-2" />')).toEqual(['rb-s: padding vs px-2'])
    expect(utilityConflicts('.rb-s { display: grid }', '<div className="rb-s flex" />')).toEqual(['rb-s: display vs flex'])
    expect(utilityConflicts('.rb-s { color: x }', '<div className="rb-s rounded-control text-h3 hover:bg-hover" />')).toEqual([])
  })
  it('CONTROL: specificity counts what the cascade counts', () => {
    expect(specificity('.a')).toEqual([0, 1, 0])
    expect(specificity('.ui-input[data-size="sm"]')).toEqual([0, 2, 0])
    expect(specificity('.w > .ui-input.rb-t')).toEqual([0, 3, 0])
    expect(specificity('.rb-role:not(select)')).toEqual([0, 1, 1])
    expect(specificity('.a:where(.b)')).toEqual([0, 1, 0])
    expect(specificity('input:focus-visible')).toEqual([0, 1, 1])
  })
})

/* ── the extraction holds ─────────────────────────────────────────────────── */
const STATE_PROPS = 'color|background[A-Za-z]*|border[A-Za-z]*|opacity|boxShadow|outline[A-Za-z]*|fill|stroke|cursor|transform|fontWeight|textDecoration[A-Za-z]*|accentColor|caretColor|filter|visibility'
const STATE_VALUE = new RegExp(`['"]?\\b(${STATE_PROPS})['"]?\\s*:\\s*([^,}]*)`, 'g')

export function inlineStateTernaries(src) {
  const code = jsCode(src)
  const hits = []
  const at = (i) => code.slice(0, i).split('\n').length
  // A const whose value is decided by state and is a colour / token
  // (`const c = active ? '#fff' : '#000'`) — then used in a style.
  const stateConsts = new Set([...code.matchAll(/const\s+(\w+)\s*=\s*[^;]*?\?[^;]*?(#[0-9a-fA-F]{3,8}|var\(--color|rgba?\()/g)].map((m) => m[1]))

  // className template literals that pick a class by state: ?:, &&, ||
  for (const t of code.matchAll(/className=\{`[^`]*`\}/g)) {
    if (/\$\{[^}]*(\?|&&|\|\|)/.test(t[0])) hits.push(`${at(t.index)}: ${t[0].slice(0, 90)}`)
  }
  // className chosen by a ternary expression, not a template — when a branch
  // carries a VISUAL class. A layout variant (the Control Panel's one- or
  // two-column grid, chosen by permission) is not a state a class could beat.
  const VISUAL = /['"\s](text-(?!left\b|right\b|center\b|start\b|end\b)|bg-|border\b|border-|opacity-|font-|shadow|ring-|rounded|underline|italic|uppercase|ui-|rb-)/
  for (const t of code.matchAll(/className=\{(?!`)([^{}]*)\}/g)) {
    if (/\?|&&|\|\|/.test(t[1]) && VISUAL.test(t[1])) hits.push(`${at(t.index)}: className={${t[1].slice(0, 80)}}`)
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
    const flat = body.replace(/\s+/g, ' ')
    const where = `${at(m.index)}: ${flat.slice(0, 90)}`
    // The whole style decided by an expression: a condition, a lookup, a call.
    if (!/^\{\s*\{/.test(flat)) {
      if (/\?|&&|\|\||\[|\(/.test(flat)) hits.push(where)
      continue
    }
    // A spread whose object is chosen by a condition: {{ ...(on ? {…} : {}) }}
    if (/\.\.\.\s*\([^)]*(\?|&&|\|\|)/.test(flat)) { hits.push(where); continue }
    for (const v of flat.matchAll(STATE_VALUE)) {
      const value = v[2]
      if (/\?|&&|\|\|/.test(value)                               // ternary, `on && x`, `a || b` — on any line
        || /^\s*[A-Za-z_$][\w$.]*\s*\[/.test(value)                // a lookup table: COLORS[state]
        || /^\s*[A-Za-z_$][\w$.]*\s*\(/.test(value)                // a function that picks it: inkFor(state)
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

  it('CONTROL: the scanner fires on every spelling a state has shipped in, or a reviewer wrote, and not on a static style', () => {
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
      // round two's walk-pasts (R2 finding 5):
      `<b style={{\n  color: project\n    ? 'var(--color-ink)'\n    : 'var(--color-ink-3)',\n}} />`,
      `<b style={DOT_STYLE[state]} />`,
      `<b style={{ color: inkFor(state) }} />`,
      '<b className={`rb-x ${project && \'font-normal\'}`} />',
      `<b style={styleFor(state)} />`,
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
      `<b style={{ transform: 'translate(-50%,-50%)', backgroundColor: 'var(--color-paper)' }} />`,
      `<b style={style} />`,
    ]
    for (const q of quiet) expect(inlineStateTernaries(q), q).toEqual([])
  })
})
