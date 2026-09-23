// =============================================================================
// rabbitCssGuards.js — the source-text scanners lane B1 wrote for rabbitShell.css
// (UI overhaul B1, 2026-09-23), moved here VERBATIM by lane B2 so a second
// stylesheet's test can call them. They used to be exported from
// rabbitShellCss.test.js itself, and importing a test file registers its whole
// suite inside the importer: B1's tests would have run a second time under B2's
// file. rabbitShellCss.test.js imports them back from here and re-exports the
// ones it exported, so there is still exactly one copy of each predicate (T2
// hand-off §5 trap 8: a control that re-types its subject proves nothing).
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
/** The kit's stylesheet, read once: `weakAgainstKit`'s default opponent. */
export const indexCss = readFileSync(join(here, '../../index.css'), 'utf8').replace(/\r\n/g, '\n')
/** Strip CSS comments so a rule can never be satisfied by its own documentation. */
export const cssCode = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** JS comments out. A block comment only opens where code can put one — at a
    line start or after `{ ( , ; =` — so `accept="image/*"` never swallows code
    up to the next `*` + `/` (R1 finding 6a). Whole-line `//` comments too. */
export const jsCode = (src) => src.replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '')
/** Every rule's selector list and body, innermost blocks (so @layer / @media / @container wrappers drop out). */
export const rulesOf = (css) => [...cssCode(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim(), body }))
  .filter(({ sel }) => !sel.startsWith('@'))
/** The compound selector that targets the element itself. */
export const lastCompound = (sel) => sel.trim().split(/[\s>+~]+/).pop()
/** The properties a declaration block sets. */
export const propsOf = (body) => [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1])
/** padding-left → padding, border-bottom-color → border, … */
export const family = (prop) => prop.replace(/-(left|right|top|bottom|inline|block|start|end)(?=-|$)/g, '').replace(/-(color|width|style)$/, '')

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
export const gt = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/* ── colour ───────────────────────────────────────────────────────────────── */
/** Rules that paint a signal / signal-fill ground, in any spelling (fallback, color-mix, gradient). */
export const signalGrounds = (css) => rulesOf(css)
  .filter(({ body }) => /background(-color|-image)?\s*:[^;]*var\(\s*--color-signal(-fill)?(?![\w-])/.test(body))
  .map(({ sel }) => sel)
/** Declarations on the kit tab beyond its spacing. */
export const TAB_SPACING = /^(padding|margin|gap|flex|flex-grow|flex-shrink|flex-basis|min-width)$/
export const tabReach = (css) => rulesOf(css)
  .filter(({ sel }) => /\.ui-tab\b|\[role=["']?tab["']?\]/.test(sel))
  .flatMap(({ sel, body }) => propsOf(body).filter((p) => !TAB_SPACING.test(family(p))).map((p) => `${sel} { ${p} }`))

/** Every JSX opening tag in the source, walked to its closing `>` at brace depth 0. */
export function jsxTags(source) {
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

/* ── the cascade ──────────────────────────────────────────────────────────── */
export const classStrings = (source) =>
  [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => (m[1] ?? m[2]).split(/\s+/).filter(Boolean))

/** The kit's rules for `.ui-input` / `.ui-btn` that can meet a B1 element at rest:
    selector, specificity, property families. Two kinds are left out, on
    purpose: a rule for the LIGHT surface (every B1 element is data-surface
    "dark"), and a rule for a STATE (:disabled, :hover, :focus…, ::placeholder)
    — there the kit's treatment is meant to win, and a B1 rule that outranked
    it would hide a disabled or focused field's look. */
export function kitRules(kitCss) {
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

export const UTILITY_OWNS = [
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

/* ── the extraction holds ─────────────────────────────────────────────────── */
export const STATE_PROPS = 'color|background[A-Za-z]*|border[A-Za-z]*|opacity|boxShadow|outline[A-Za-z]*|fill|stroke|cursor|transform|fontWeight|textDecoration[A-Za-z]*|accentColor|caretColor|filter|visibility'
export const STATE_VALUE = new RegExp(`['"]?\\b(${STATE_PROPS})['"]?\\s*:\\s*([^,}]*)`, 'g')

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
