// =============================================================================
// rabbitCssGuards.js — the source-text scanners lane B1 wrote for rabbitShell.css
// (UI overhaul B1, 2026-09-23), moved here VERBATIM by lane B2 so a second
// stylesheet's test can call them. They used to be exported from
// rabbitShellCss.test.js itself, and importing a test file registers its whole
// suite inside the importer: B1's tests would have run a second time under B2's
// file. rabbitShellCss.test.js imports them back from here and re-exports the
// ones it exported, so there is still exactly one copy of each predicate (T2
// hand-off §5 trap 8: a control that re-types its subject proves nothing).
// Lane B2's own predicates follow them, moved the same way by lane B3
// (2026-09-24) from views/rabbitTasksCss.test.js: see the banner below.
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

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

/* ══ lane B2's predicates ═══════════════════════════════════════════════════
   Moved here VERBATIM by lane B3 (2026-09-24) from views/rabbitTasksCss.test.js,
   for the reason B2 moved B1's scanners above: lane B3's test calls them, and
   importing a test file registers its whole suite inside the importer. Sliced
   by line by a script, never retyped (the Bash tool collapses their double
   backslashes). Parameterised only where they named lane B2 — its class
   prefixes (`prefix`, default `B2_LANE`), its sheet (importedSheet's `name`
   and `base`), its four files (kitFights' default elements, read from
   `B2_FILES`) and its style / spread allowlists (stateLeaks) — and every
   default IS B2's, so B2's calls read exactly as before.
   impossibleTones and toneSources take their tone set with NO default: B2's
   is priorityTone()'s range, which lives in app code (dashboardTaskModel ->
   ui/StatusDot.jsx), and this module is also imported by plain-node scripts
   with no JSX loader. B2's test binds its own set and re-exports them under
   their old signatures.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Lane B2's class prefixes, `rb-task-` and `rb-tpl-`, as a regex alternation:
    the default `prefix` of every predicate below that names a lane's classes. */
export const B2_LANE = 'task|tpl'
/** Lane B2's four files, relative to views/: kitFights' default elements
    (and the list rabbitTasksCss.test.js walks). */
export const B2_FILES = {
  tasks: 'ProjectTasksView.jsx',
  detail: '../components/TaskDetailPopup.jsx',
  create: '../components/NewTaskPopup.jsx',
  templates: '../../../components/TaskTemplates/TaskTemplateManager.jsx',
}
/** A literal string as a RegExp source. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** B1's scanners read `className="…"` and template literals; a `{'…'}` literal
    is the same thing in a spelling they miss (round one, 16). Every
    `*ClassName` prop (the kit Table's `scrollClassName`) is one too. */
export const normal = (src) => src
  .replace(/(\w*[cC]lassName)=\{'([^']*)'\}/g, '$1="$2"')
  .replace(/(\w*[cC]lassName)=\{"([^"]*)"\}/g, '$1="$2"')

/** A selector list split on its TOP-LEVEL commas: `:where(tr, li, .x) .y` is
    one selector (round two: the kit's were cut in the middle). */
export const selectorsOf = (sel) => {
  const out = []
  let d = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const stripNot = (s) => s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '')

/* ── the elements the JSX writes ─────────────────────────────────────────── */
/** A kit component's root class. */
const KIT_ROOT = { Td: 'ui-td', Th: 'ui-th', Row: 'ui-tr', Table: 'ui-table', Button: 'ui-btn', IconButton: 'ui-iconbtn', Input: 'ui-input', Select: 'ui-input' }
/** Every JSX element in a source: its tag, its opening tag's text, its own
    classes, and the kit classes it renders with — a literal `ui-*`, or its
    kit component's root (a lane class alone on a `<Td>` is a `.ui-td` too;
    round two: `.rb-task-check-cell { padding }` lost to the dense padding
    because the check only measured selectors that NAMED `.ui-td`). */
export const elementsOf = (src) => jsxTags(normal(jsCode(src))).map((t) => {
  const tag = t.match(/^<([A-Za-z][\w.]*)/)[1]
  const m = t.match(/\sclassName=(?:"([^"]*)"|\{`([^`]*)`\})/)
  const classes = m ? (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean) : []
  const kit = [...new Set([...classes.filter((c) => c.startsWith('ui-')), ...(KIT_ROOT[tag] ? [KIT_ROOT[tag]] : [])])]
  return { tag, attrs: t, classes, kit }
})
let b2Els = null
/** B2's elements, read once on first use: kitFights' default premise. */
const b2Elements = () => (b2Els ??= Object.values(B2_FILES)
  .flatMap((f) => elementsOf(readFileSync(join(here, 'views', f), 'utf8').replace(/\r\n/g, '\n'))))
/** Can this element carry [attr="value"] (or the state)? Read from the props
    that set it, with the kit component's default; a prop given an expression
    can be anything. */
export function meets(el, attr, value) {
  const a = el.attrs
  const prop = (name) => new RegExp(`\\s${name}(?=[\\s=/>])`).test(a)
  const lit = (name) => a.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
  const expr = (name) => new RegExp(`\\s${name}=\\{`).test(a)
  switch (attr) {
    case 'data-variant': {
      if (expr('variant') || expr('primary') || expr('danger') || expr('data-variant')) return true
      return (lit('variant') ?? lit('data-variant') ?? (prop('primary') ? 'primary' : prop('danger') ? 'danger' : 'secondary')) === value
    }
    case 'data-size': {
      if (expr('size') || expr('small') || expr('data-size')) return true
      return (lit('size') ?? lit('data-size') ?? (prop('small') ? 'sm' : 'md')) === value
    }
    case 'data-align': {
      if (expr('align')) return true
      return (prop('numeric') ? 'right' : (lit('align') ?? 'left')) === value
    }
    case 'data-numeric': return value === 'true' && prop('numeric')
    case ':disabled': return prop('disabled')
    default: return true
  }
}

/* ── the sheet's shape ───────────────────────────────────────────────────── */
/** The sheet's text outside its one `@layer components { … }` block, and the
    statement's place. A rule outside the block would sit in no layer and beat
    every utility (round one, 10). */
export function outsideLayer(css) {
  const c = cssCode(css)
  const statement = c.match(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  const open = c.search(/@layer\s+components\s*\{/)
  if (!statement || open < 0) return { statementFirst: false, rest: c }
  let depth = 0, end = -1
  for (let i = c.indexOf('{', open); i < c.length; i++) {
    if (c[i] === '{') depth++
    else if (c[i] === '}' && --depth === 0) { end = i; break }
  }
  const before = c.slice(0, statement.index).trim()
  const between = c.slice(statement.index + statement[0].length, open).trim()
  const after = end < 0 ? c.slice(open) : c.slice(end + 1).trim()
  return { statementFirst: before === '' && statement.index < open, rest: `${between}${after}` }
}

/** Every class a selector in the sheet names. */
export const selectorClasses = (css) => [...cssCode(css).matchAll(/([^{}]+)\{/g)]
  .map((m) => m[1]).filter((s) => !s.trim().startsWith('@'))
  .flatMap((s) => [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1]))
const kitCode = cssCode(indexCss)
const KIT_CLASSES = new Set([...kitCode.matchAll(/\.(ui-[a-z0-9-]+)/g)].map((m) => m[1]))
/** A class that is neither the lane's nor the kit's (a near miss such as
    `rb-tasks-ghost` used to go uncounted; round one, 10). */
export const strayClasses = (css, prefix = B2_LANE) => [...new Set(selectorClasses(css))]
  .filter((c) => !new RegExp(`^rb-(${prefix})-[a-z0-9-]+$`).test(c) && !KIT_CLASSES.has(c))
/** A selector with no lane class anywhere outside a `:not()`: a bare kit
    override that would restyle every Dialog, Table or Input in the app
    (round one, 4; round two: `.ui-dialog-body:not(.rb-task-detail-body)`
    passed and restyled every OTHER Dialog body). */
/** A selector with each `:is(…)` / `:where(…)` expanded into its
    alternatives: `:is(.rb-task-view, .ui-dialog) .ui-dialog-body` is two
    selectors, and the second restyles every Dialog body (round two:
    `sc-is-comma`, once the split learned to keep `:is()` whole). */
export const alternativesOf = (s) => {
  const m = s.match(/:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/)
  if (!m) return [s]
  return selectorsOf(m[1]).flatMap((alt) => alternativesOf(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)))
}
export const unscopedSelectors = (css, prefix = B2_LANE) => rulesOf(css)
  .flatMap(({ sel }) => selectorsOf(sel))
  .filter((s) => alternativesOf(stripNot(s)).some((alt) => !new RegExp(`\\.rb-(${prefix})-`).test(alt)))

/* ── imports ─────────────────────────────────────────────────────────────── */
/** The stylesheet a file imports, resolved against the file's own folder
    (`file` is relative to `base`, B2's views/ by default). */
export function importedSheet(file, src, name = 'rabbitTasks.css', base = join(here, 'views')) {
  const m = jsCode(src).match(new RegExp(`import\\s+['"]([^'"]*${escapeRe(name)})['"]`))
  return m ? resolve(dirname(resolve(base, file)), m[1]) : null
}

/* ── classes and attributes ──────────────────────────────────────────────── */
/** Classes written in a className (any `*ClassName` prop) — the strings a
    className takes, not any string (`data-was="rb-task-x"` used to count as a
    use; round one, 10). */
export const classesWritten = (src, prefix = B2_LANE) => {
  const out = new Set()
  for (const m of normal(src).matchAll(/\b\w*[cC]lassName=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
    for (const c of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (new RegExp(`^rb-(${prefix})-`).test(c)) out.add(c)
  }
  return out
}

/** Attribute selectors this sheet may not use: an operator or a flag the
    reachability scanner cannot evaluate, or a non-data attribute. An ARIA
    state the JSX itself sets (`aria-expanded={…}`) is readable: its values
    are "true" / "false" (round two: `fp-aria-state`). */
const ARIA_STATE = /^aria-(expanded|pressed|selected|checked)="(true|false)"$/
export const unreadableAttributes = (css, src = '') => [...cssCode(css).matchAll(/\[([^\]]+)\]/g)]
  .map((m) => m[1].trim())
  .filter((a) => {
    if (/^data-[a-z-]+="[^"]*"$/.test(a)) return false
    const aria = a.match(ARIA_STATE)
    return !(aria && new RegExp(`\\saria-${aria[1]}=`).test(src))
  })
/** The tone literals a `valueTone` prop can hand over: a literal, or the
    string literals inside an expression (`completed > 0 ? 'success' : undefined`). */
export const toneLiterals = (tag) => {
  const m = tag.match(/\svalueTone=(?:"([^"]*)"|\{([^}]*)\})/)
  if (!m) return []
  return m[1] !== undefined ? [m[1]] : [...m[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
}
/** The `[data-tone="…"]` values a sheet waits for that `tones` cannot produce
    (B2 passes priorityTone()'s range and its valueTone literals). */
export const impossibleTones = (css, tones) => [...cssCode(css).matchAll(/\[data-tone="([^"]*)"\]/g)]
  .map((m) => m[1]).filter((t) => !tones.has(t))
/** The same premise on the JSX side: every data-tone is priorityTone(…) or a
    literal it can return (round two: `data-tone={priority}` survived, and
    then `[data-tone="danger"]` could never match). */
export const toneSources = (src, tones, fn = 'priorityTone') => [...jsCode(src).matchAll(/\sdata-tone=(\{[^}]*\}|"[^"]*")/g)]
  .map((m) => m[1])
  .filter((v) => !new RegExp(`^\\{${fn}\\(`).test(v) && !(v.startsWith('"') && tones.has(v.slice(1, -1))))

/* ── the cascade ─────────────────────────────────────────────────────────── */
/** Kit rules a lane rule cannot meet on these screens: the light surface,
    another page's scope, and attribute states no B2 element carries.
    Variant, size, alignment and selection are NOT here any more: they are
    read per element from the JSX (round two: `[data-align=`, `[data-numeric=`
    and `.ui-field-stack` were dropped although B2's cells and NewTaskPopup
    carry them). The kit's focus and disabled states are not here either:
    they are fights the lane must LOSE. */
const NOT_HERE = /\[data-surface="light"\]|\[data-surface="chrome"\]|\[data-interactive="true"\]|\[data-highlighted="true"\]|\[data-inactive="true"\]|\[data-wrap="true"\]|\[data-inline="true"\]|\[data-mixed="true"\]|\.tm-|\.at-|\.rs-|\.pj-|\.dash-|\.ui-field-row|::|:active|tfoot/
/** Tested with every :not(…) taken out first: `:hover:not(:disabled)` is a
    hover rule, and the first cut threw it away as a disabled one. */
const notHere = (sel) => NOT_HERE.test(stripNot(sel))
/** The kit's own state in a selector (its treatment must win over a lane
    rule that does not carry the same state). */
const kitState = (sel) => (stripNot(sel).match(/:focus(?:-visible|-within)?|:disabled/) || [null])[0]
/** The compound a child combinator hangs the target from: `.a > .b + .c` → `.a`. */
const parentCompound = (s) => (stripNot(s).match(/([^\s>+~]+)\s*>\s*[^>]*$/) || [])[1]
/** Row classes the JSX never renders selected: the kit's selected fill can
    never reach them (round two: the exemption assumed every row but a task
    row was unselectable, and the template list's editing row is selected). */
const neverSelected = (els) => {
  const rows = els.filter((e) => e.kit.includes('ui-tr'))
  const sel = (e) => /\s(?:data-)?selected(?=[\s=/>])/.test(e.attrs)
  return new Set(rows.flatMap((e) => e.classes).filter((c) => c.startsWith('rb-') && !rows.some((r) => r.classes.includes(c) && sel(r))))
}
/** For each lane rule that styles a kit element, the kit rules for the same
    element and property family it does not strictly outrank. Deliberate
    losses — a hover under the kit's selected fill, anything under the kit's
    focus or disabled treatment — must strictly LOSE: a tie is a load-order
    coin toss (round two). */
export function kitFights(css, kit = indexCss, els = b2Elements(), prefix = B2_LANE) {
  const kitRules = rulesOf(kit).flatMap(({ sel, body }) => selectorsOf(sel).map((s) => ({ sel: s, fams: new Set(propsOf(body).map(family)) })))
  const never = neverSelected(els)
  const out = []
  for (const { sel, body } of rulesOf(css)) {
    for (const one of selectorsOf(sel)) {
      const target = lastCompound(stripNot(one))
      const named = (target.match(/\.ui-[a-z0-9-]+/g) || []).map((c) => c.slice(1))
      const lane = (target.match(new RegExp(`\\.rb-(?:${prefix})-[a-z0-9-]+`, 'g')) || []).map((c) => c.slice(1))
      // The elements this compound lands on, as the JSX writes them.
      const mine = els.filter((e) => lane.every((c) => e.classes.includes(c)) && named.every((c) => e.kit.includes(c)))
      const kitCls = [...new Set([...named, ...(lane.length ? mine.flatMap((e) => e.kit) : [])])]
      if (!kitCls.length) continue
      const fams = new Set(propsOf(body).map(family))
      for (const k of kitRules) {
        if (notHere(k.sel)) continue
        const kt = lastCompound(stripNot(k.sel))
        if (!kitCls.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(kt))) continue
        if (![...fams].some((f) => k.fams.has(f))) continue
        // A kit rule keyed on a variant, size or alignment none of these
        // elements has cannot meet them; nor a disabled rule on an element
        // that is never disabled.
        const keyed = [...kt.matchAll(/\[(data-(?:variant|size|align|numeric))="([^"]*)"\]/g)].map(([, a, v]) => [a, v])
        const state = kitState(k.sel)
        // A lane rule that excludes the kit's state (`:not(:disabled)`) never meets it.
        if (state && one.includes(`:not(${state})`)) continue
        if (state === ':disabled' && !stripNot(one).includes(':disabled')) keyed.push([':disabled', 'true'])
        // Two child combinators whose parents no element is both of never meet
        // (`.rb-task-prop-grid > .ui-field` and `.ui-field-stack > .ui-field`).
        const lp = parentCompound(one), kp = parentCompound(k.sel)
        if (lp && kp) {
          const need = [...`${lp} ${kp}`.matchAll(/\.([\w-]+)/g)].map((m) => m[1])
          if (!els.some((e) => need.every((c) => e.classes.includes(c) || e.kit.includes(c)))) continue
        }
        if (keyed.length && mine.length && !mine.some((e) => keyed.every(([a, v]) => meets(e, a, v)))) continue
        // The selected fill cannot reach a row that is never selected.
        if (/\[data-selected="true"\]/.test(k.sel) && [...never].some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(one))) continue
        const deliberate = (/:hover/.test(one) && /\[data-selected="true"\]/.test(k.sel))
          || (state !== null && !stripNot(one).includes(state))
        const cmp = gt(specificity(one), specificity(k.sel))
        if (deliberate ? cmp >= 0 : cmp <= 0) out.push(`${one} ${deliberate ? 'ties or beats' : 'ties or loses to'} ${k.sel}`)
      }
    }
  }
  return out
}

/* ── colour ──────────────────────────────────────────────────────────────── */
/** Every CSS named colour (and the system colours), matched in any case:
    CSS names are case-insensitive (round two: `Gray`, `cyan` and
    `darkorange` — which the old lookbehind rejected after its `k` — all
    passed). `transparent` and `currentColor` are not colours of their own. */
const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
  + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
  + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
  + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
  + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
  + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta '
  + 'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
  + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen '
  + 'canvas canvastext buttonface buttontext highlight highlighttext graytext linktext accentcolor accentcolortext '
  // B3d round two: the rest of the system colours a value can name (`Field` and `Window` are white).
  + 'activetext visitedtext buttonborder field fieldtext mark marktext selecteditem selecteditemtext window windowtext windowframe')
  .split(' ').sort((a, b) => b.length - a.length).join('|')
const NAMED_RE = new RegExp(`(?<![\\w-])(?:${NAMED})(?![\\w-])`, 'gi')
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi
/** Every colour written as a literal, in any spelling (round one, 6). */
export const colourLiterals = (css) => {
  const c = cssCode(css)
  const decls = [...c.matchAll(/:\s*([^;{}]+)/g)].map((m) => m[1])
  return [
    ...(c.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
    ...(c.match(COLOUR_FN) || []),
    ...decls.flatMap((v) => v.match(NAMED_RE) || []),
  ]
}
/** A px length (rem / em at 16px); anything else (calc, var) is not read. */
const px = (t) => {
  const m = t.match(/^(-?\d*\.?\d+)(px|rem|em)?$/)
  return m ? Math.abs(parseFloat(m[1])) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) : null
}
const layers = (v) => selectorsOf(v)
/** An inset shadow in a signal, focus or selection colour wide enough to be a
    fill: any blur, or a spread or offset of 3px or more, in any unit (round
    two: `1rem`, `64px 64px` of blur and spread, and `--color-selection` all
    passed the old `inset 0 0 0 Npx` pattern). An edge (1–2px, no blur) is
    allowed. */
export const fillShadows = (css) => rulesOf(css).filter(({ body }) =>
  [...body.matchAll(/box-shadow\s*:\s*([^;]+)/g)].some((m) => layers(m[1]).some((layer) => {
    if (!/\binset\b/.test(layer) || !/var\(\s*--color-(?:signal|focus|selection)(?![\w-])/.test(layer)) return false
    const lengths = layer.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/\binset\b/, ' ').trim().split(/\s+/).map(px)
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths.filter((n) => n !== null)
    return blur > 0 || spread >= 3 || x >= 3 || y >= 3
  }))).map(({ sel }) => sel)
/** Grounds in a signal colour under text, in the spellings rounds one and two
    found: the signal tokens, the focus and selection tokens (the same
    orange), and an inset shadow wide enough to be a fill. */
export const orangeGrounds = (css) => [
  ...signalGrounds(css),
  ...rulesOf(css).filter(({ body }) => /background(-color|-image)?\s*:[^;]*var\(\s*--color-(?:focus|selection)(?![\w-])/.test(body)).map(({ sel }) => sel),
  ...fillShadows(css),
]
/** A lane property's setters: the JSX elements whose style object sets it —
    in code (comments out), as a key (round two: a comment naming the
    property counted as setting it). */
const settersOf = (p, els) => els.filter((e) => new RegExp(`style=\\{\\{[^]*?['"]${p}['"]\\s*:`).test(e.attrs))
const setInSheet = (p, css) => new RegExp(`(?:^|[\\s;{])${p}\\s*:`).test(cssCode(css))
/** Custom properties read and defined nowhere: a kit token must be DEFINED in
    index.css (anchored — `--line-height` is not `--text-dense--line-height`),
    and the sheet's own `--rb-*` must be set by the JSX's style object or by
    the sheet itself (round two: `fp-sheet-custom-prop`). */
export const undefinedProperties = (css, kit, sources) => {
  const readProps = [...new Set([...cssCode(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))]
  const k = cssCode(kit)
  const els = sources.flatMap(elementsOf)
  return readProps.filter((p) => p.startsWith('--rb-')
    ? !(setInSheet(p, css) || settersOf(p, els).length)
    : !new RegExp(`(?:^|[\\s;{])${p}\\s*:`).test(k))
}
/** A `--rb-*` the JSX sets on one element, read by a rule that does not name
    that element's class: it lands where nothing sets it (round two:
    `var(--rb-ms)` read on the board card, where only key-date rows set it). */
export const readAwayFromSetter = (css, sources) => {
  const els = sources.flatMap(elementsOf)
  const out = []
  for (const { sel, body } of rulesOf(css)) {
    for (const [, p] of body.matchAll(/var\(\s*(--rb-[a-z0-9-]+)/g)) {
      if (setInSheet(p, css)) continue
      const classes = settersOf(p, els).flatMap((e) => e.classes)
      for (const one of selectorsOf(sel)) {
        if (!classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(one))) out.push(`${p} @ ${one}`)
      }
    }
  }
  return out
}

/* ── the state extraction holds ──────────────────────────────────────────── */
/** Every `style={…}` these files may write: the key date's colour (data), the
    GatedAction's gap, and the dependency list's measured place. Nothing else — a
    style that is not here is a state in some spelling B1's scanner does not
    know (arithmetic, a template literal, a custom property; round one, 5). */
const STYLES_ALLOWED = [
  "{{ '--rb-ms': milestone.color }}",
  "{{ gap: 12, alignItems: 'center' }}",
  '{{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}',
]
/** The spread attributes these files may write: the row's props passed on,
    and the drop handlers. A spread is otherwise a way to hand an element a
    style or className chosen by state (round two). */
const SPREADS_ALLOWED = ['rowProps', 'drop.handlers', '(drop?.handlers || {})']
/** Two self-closing elements chosen by a ternary, as an element-swap that
    changes the lane classes: a state picking a class in another spelling
    (round two: `? <CheckSquare className="rb-task-hint-danger" /> : <Square />`). */
const laneClassesOf = (tag) => ((tag.match(/className="([^"]*)"/) || [])[1] || '').split(/\s+/).filter((c) => c.startsWith('rb-')).sort().join(' ')
export function stateLeaks(src, styles = STYLES_ALLOWED, spreads = SPREADS_ALLOWED) {
  const code = normal(jsCode(src))
  const leaks = [...inlineStateTernaries(code)]
  // A style is one of the allowed object literals — never an identifier or a call.
  for (const m of code.matchAll(/\sstyle=\{(?!\{)/g)) leaks.push(`style={${code.slice(m.index + 8, m.index + 40)}`)
  for (const m of code.matchAll(/style=(\{\{[^]*?\}\})/g)) {
    if (!styles.includes(m[1].replace(/\s+/g, ' '))) leaks.push(`style=${m[1].slice(0, 60)}`)
  }
  // A className is a literal, or a template whose only hole passes the
  // caller's own className through.
  for (const m of code.matchAll(/className=\{([^]*?)\}(?=[\s/>])/g)) {
    const v = m[1].trim()
    const passThrough = /^`[^`$]*\$\{className\}[^`$]*`(\.trim\(\))?$/.test(v)
    const literal = /^(['"])[^'"]*\1$/.test(v) || /^`[^`$]*`$/.test(v)
    if (!passThrough && !literal) leaks.push(`className={${v.slice(0, 60)}}`)
  }
  // A spread attribute passes only what the allowlist names (brace-matched:
  // `{...(c && { style: { opacity: 0.5 } })}` nests two deep).
  for (const m of code.matchAll(/\s\{\.\.\./g)) {
    let d = 0, i = m.index + 1
    for (; i < code.length; i++) { if (code[i] === '{') d++; else if (code[i] === '}' && --d === 0) break }
    const inner = code.slice(m.index + 5, i).trim()
    if (!spreads.includes(inner)) leaks.push(`{...${inner.slice(0, 50)}}`)
  }
  // An element swap that changes the lane classes.
  for (const m of code.matchAll(/\?\s*(<[A-Z]\w*[^<>]*\/>)\s*:\s*(<[A-Z]\w*[^<>]*\/>)/g)) {
    if (laneClassesOf(m[1]) !== laneClassesOf(m[2])) leaks.push(`? ${m[1].slice(0, 40)} : ${m[2].slice(0, 40)}`)
  }
  // An icon's colour and stroke props take no expression (a number is not one).
  for (const m of code.matchAll(/\s(color|fill|stroke|opacity)=\{/g)) leaks.push(`${m[1]}={…}`)
  for (const m of code.matchAll(/\s(strokeWidth|size)=\{([^}]*)\}/g)) {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(m[2])) leaks.push(`${m[1]}={${m[2].slice(0, 30)}}`)
  }
  // No colour literal at all in these files: hex, or a colour function.
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) leaks.push(h)
  for (const f of code.match(COLOUR_FN) || []) leaks.push(f)
  return leaks
}
