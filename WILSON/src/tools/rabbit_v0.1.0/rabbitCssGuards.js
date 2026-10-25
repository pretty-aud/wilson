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

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative, posix } from 'node:path'

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
/** rulesOf, with where each rule sits: `at`, the at-rule preludes around it
    (outermost first); `layered`, whether one of them is an @layer; `layer`,
    the innermost layer's name ('' for an anonymous one, null outside every
    layer). The layer outranks specificity (`cascadeTier`). */
const contexts = new Map()
export const rulesWithContext = (css) => {
  // Read once per sheet text (a scan over every date field reads each sheet
  // for each field); the result is shared, so callers never change it.
  const known = contexts.get(css)
  if (known) return known
  const code = cssCode(css)
  const out = []
  const stack = []
  let start = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '{') { stack.push(code.slice(start, i).trim()); start = i + 1 }
    else if (c === '}') {
      const sel = stack.pop()
      if (sel != null && !sel.startsWith('@')) {
        const lay = stack.filter((p) => p.startsWith('@layer')).pop()
        out.push({ sel, body: code.slice(start, i), at: stack.slice(), layered: !!lay, layer: lay == null ? null : lay.replace(/^@layer\s*/, '').trim() })
      }
      start = i + 1
    } else if (c === ';' && !stack.length) start = i + 1
  }
  if (contexts.size > 256) contexts.clear()
  contexts.set(css, out)
  return out
}
/** Where a declaration stands before specificity (CSS Cascade 5): the
    layers in the order Tailwind declares them — `theme, base, components,
    utilities` — then any layer named later, then no layer; a normal
    declaration in a later layer outranks an earlier one at any specificity,
    and !important reverses the order and outranks every normal one. `layer`
    is a rule's `layer` (rulesWithContext), or a boolean for a layered or an
    unlayered rule of the sheets' one layer, `components`. Review round 2
    (R2-02): ranking every layer alike let `@layer utilities` take a date's
    room unseen. */
export const LAYER_ORDER = ['theme', 'base', 'components', 'utilities']
export const layerRank = (layer) => {
  if (layer == null || layer === false) return LAYER_ORDER.length + 1
  if (layer === true) return LAYER_ORDER.indexOf('components')
  const i = LAYER_ORDER.indexOf(layer)
  return i >= 0 ? i : LAYER_ORDER.length
}
export const cascadeTier = (important, layer) => (important ? 100 - layerRank(layer) : layerRank(layer))
/** A declared value and whether it is !important, the flag taken off. */
export const importance = (raw) => ({ value: raw.replace(/\s*!\s*important\s*$/i, ''), important: /!\s*important\s*$/i.test(raw) })
/** The compound selector that targets the element itself. */
export const lastCompound = (sel) => sel.trim().split(/[\s>+~]+/).pop()
/** lastCompound that never splits inside brackets or parentheses:
    `.a:is(.b, .c)` is one compound (FX10 review round 2, R2-02's M13 —
    lastCompound cut it at the space after the comma). */
export const topCompound = (sel) => {
  const s = sel.trim()
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '\t' || c === '\n' || c === '>' || c === '+' || c === '~')) start = i + 1
  }
  return s.slice(start)
}
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
/** Declarations on the kit tab beyond its spacing. `outline-offset` is the
    ring's PLACE, not its look (post-overhaul S2a: the tab list scrolls and
    clips a ring drawn outside, so it is drawn inside); its colour, width and
    style are still the kit's (`outline` is not in this list). */
export const TAB_SPACING = /^(padding|margin|gap|flex|flex-grow|flex-shrink|flex-basis|min-width|outline-offset)$/
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

/** An attribute value the scanner can read: a string literal or a ternary of
    literals (and null / undefined / false for "absent"). Anything else is
    dynamic — any value may arrive. (Lifted out of the function below,
    unchanged, by B4c's review round one: `variableAttributes` lists the
    setters it rejects, so the two share this one definition.) */
export const literalSetter = (s) => {
  const ABSENT = '(?:undefined|null|false)'
  const LIT = `(?:'[^']*'|"[^"]*")`
  return /^"[^"]*"$/.test(s)
    || new RegExp(`^\\{[^{}]*\\?\\s*(?:${LIT}|${ABSENT})\\s*:\\s*(?:${LIT}|${ABSENT}|[^{}]*\\?[^{}]*)\\s*\\}$`).test(s)
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
    // (Such a pair is `variableAttributes`' to declare, with its values.)
    if (!sets.every(literalSetter)) continue
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
  // Post-overhaul VW1b (2026-10-17): the Tasks table's item cells and their
  // picker, on this lane's sheet.
  cells: 'TaskItemCells.jsx',
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
/** A kit component's root class: the element its `className` lands on.
    B4c review round one: the first eight only, so a lane class alone on any
    other kit component met no kit rule here — `.rb-audit-event { color }`
    tied `.ui-badge`'s colour on the kit Badge and load order decided it.
    Every kit component lane B4's files write a class on is here now; a
    component whose root depends on a prop (Loading) is read off the tag. */
const KIT_ROOT = {
  Td: 'ui-td', Th: 'ui-th', Row: 'ui-tr', Table: 'ui-table', Button: 'ui-btn', IconButton: 'ui-iconbtn', Input: 'ui-input', Select: 'ui-input',
  Badge: 'ui-badge', Banner: 'ui-banner', Card: 'ui-card', CellSelect: 'ui-cell-select', Dialog: 'ui-dialog', Drawer: 'ui-drawer',
  EmptyState: 'ui-empty', Field: 'ui-field', HoverActions: 'ui-hover-actions', Panel: 'ui-panel', Spinner: 'ui-spinner',
  StatusBadge: 'ui-status', StatusDot: 'ui-status-dot', Tabs: 'ui-tabs', Toolbar: 'ui-toolbar',
  // Post-overhaul FX8: a lane's class on the kit RowTitle (`rb-asset-name`).
  RowTitle: 'ui-row-title',
  // Skeleton rows with a `rows` count above 0, else the inline spinner.
  Loading: (t, own) => {
    const at = own.search(/\srows=/)
    return at >= 0 && !/^\srows=\{\s*0\s*\}/.test(t.slice(at)) ? 'ui-skeleton-rows' : 'ui-loading-inline'
  },
}
/** The kit root a JSX tag renders with, if it is a kit component. */
const kitRootOf = (tag, t, own) => (typeof KIT_ROOT[tag] === 'function' ? KIT_ROOT[tag](t, own) : KIT_ROOT[tag])
/** An opening tag with the inside of every prop expression blanked, at the
    same length: its own attribute names and string values stay where they
    were, and nothing an element NESTED in a prop writes can be read as the
    tag's own. The kit roots above made this matter: a Dialog's first
    `className` was its `subtitle={<span className="rb-asset-new-note" …>}`'s,
    so the Dialog "wore" the span's class and met `.ui-dialog`'s rules. */
export const ownText = (t) => {
  let d = 0, out = ''
  for (const c of t) {
    if (c === '}') d--
    out += d > 0 && c !== '\n' ? ' ' : c
    if (c === '{') d++
  }
  return out
}
/** Every JSX element in a source: its tag, its opening tag's text (`attrs`,
    and `own` — the same with nested expressions blanked), its own classes,
    and the kit classes it renders with — a literal `ui-*`, or its kit
    component's root (a lane class alone on a `<Td>` is a `.ui-td` too;
    round two: `.rb-task-check-cell { padding }` lost to the dense padding
    because the check only measured selectors that NAMED `.ui-td`). */
export const elementsOf = (src) => jsxTags(normal(jsCode(src))).map((t) => {
  const tag = t.match(/^<([A-Za-z][\w.]*)/)[1]
  const own = ownText(t)
  // The tag's OWN className: found in the blanked text, read from the real one.
  const at = own.search(/\sclassName=/)
  const m = at < 0 ? null : t.slice(at).match(/^\sclassName=(?:"([^"]*)"|\{`([^`]*)`\})/)
  const classes = m ? (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean) : []
  const root = Object.hasOwn(KIT_ROOT, tag) ? kitRootOf(tag, t, own) : null
  const kit = [...new Set([...classes.filter((c) => c.startsWith('ui-')), ...(root ? [root] : [])])]
  return { tag, attrs: t, own, classes, kit }
})
let b2Els = null
/** B2's elements, read once on first use: kitFights' default premise. */
const b2Elements = () => (b2Els ??= Object.values(B2_FILES)
  .flatMap((f) => elementsOf(readFileSync(join(here, 'views', f), 'utf8').replace(/\r\n/g, '\n'))))
/** Can this element carry [attr="value"] (or the state)? Read from the props
    that set it, with the kit component's default; a prop given an expression
    can be anything. Read off the tag's own attributes: a nested element's
    `variant="primary"` in a Dialog's `footer` is not the Dialog's. */
export function meets(el, attr, value) {
  const a = el.own ?? el.attrs
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
  const sel = (e) => /\s(?:data-)?selected(?=[\s=/>])/.test(e.own ?? e.attrs)
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
  // Post-overhaul VW1b (the kit request VW1-KR-2): the kit's sticky-column
  // rules key on the TABLE's `data-sticky` / `data-sticky-columns`, which only
  // a <Table stickyColumns={n}> carries. A lane none of whose tables passes
  // the prop cannot meet them; a lane that does must outrank them (or lose
  // them deliberately), as any other kit rule.
  const sticky = els.some((e) => /\sstickyColumns=/.test(e.own ?? e.attrs ?? ''))
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
        if (!sticky && /\[data-sticky(?:-columns)?="/.test(k.sel)) continue
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
          // VW1b: a sticky cell keeps the kit's paint (its opaque ground, its
          // place): a lane's row fill must LOSE to it, and reaches the cell as
          // an image (another property) instead.
          || /\[data-sticky(?:-columns)?="/.test(k.sel)
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
  // Post-overhaul VW1b: the Tasks table's widths from the columns on screen —
  // exactly two custom properties, from tasksTableWidths (tasksTableColumns.js;
  // the design's §4.10), never a state.
  "{{ '--rb-task-fixed': widths.fixed, '--rb-task-grow-n': widths.growN }}",
  // Post-overhaul VW1d: the Tasks count's least width, in characters from
  // the total's digits (a geometry, never a state; design §4.1).
  "{{ '--rb-task-count-ch': countChars }}",
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
  // `{...(c && { style: { opacity: 0.5 } })}` nests two deep), in any
  // spacing (B4c review round one: `{ ...rest }` passed the `\s\{\.\.\.` scan).
  for (const inner of spreadAttributes(code)) {
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

/* ══ lane B4's predicates (B4c review round one, 2026-09-26) ═════════════════
   A reviewer fed in-memory mutants of the files lane's twelve files through
   the tests' own predicates, and four kinds passed: a spread written with a
   space, a palette utility or a literal colour prop, a data-* value set from
   a variable, and a lane class alone on a kit component KIT_ROOT did not
   know. The spread is `spreadAttributes`, read by stateLeaks above; the kit
   roots are KIT_ROOT and `ownText`, above; the other two are here.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every spread attribute in a source's JSX opening tags, as the expression
    it spreads, in any spacing — `{...rest}`, `{ ...rest }`,
    `{ ...(on ? { style: … } : {}) }` (the old `\s\{\.\.\.` scan wanted no
    space, and `{ ...rest }` passed in every file). Read at the tag's own
    depth: a spread inside a prop's value (`style={{ ...x }}`) is that
    prop's, and the style checks read it. */
export function spreadAttributes(src) {
  const out = []
  for (const t of jsxTags(normal(jsCode(src)))) {
    const own = ownText(t)
    // In the blanked text each `{` left open is one of the tag's own: its
    // `}` is the next one, and the real text between them is the expression.
    for (let i = own.indexOf('{'); i >= 0; i = own.indexOf('{', i + 1)) {
      const inner = t.slice(i + 1, own.indexOf('}', i))
      if (/^\s*\.\.\./.test(inner)) out.push(inner.replace(/^\s*\.\.\./, '').trim())
    }
  }
  return out
}

/** A Tailwind palette colour in any utility, with any variant prefix and
    alpha — moved here from binsCss.test.js (it was b4-count.mjs's `pal`,
    the files lane's counter), so the files lane and the Bins list hold ONE
    check, and it reads a side (`border-l-stone-700`), a ring offset and a
    shadow as well. */
export const PALETTE = new RegExp('(?<![\\w-])(?:[a-z-]+:)*(?:text|bg|border(?:-[xytrblse])?|divide(?:-[xy])?|ring(?:-offset)?|shadow'
  + '|accent|outline|placeholder|fill|stroke|from|to|via|decoration|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow'
  + '|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])', 'g')
/** A colour prop given as a literal: `color="white"`, `fill='#fff'`,
    `stroke={'rgb(…)'}` (stateLeaks takes every one given an expression). */
const COLOUR_PROP = /\s(color|fill|stroke|stopColor|floodColor|lightingColor)=(?:"([^"]*)"|'([^']*)'|\{\s*(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)\s*\})/g
/** A value that names a colour: a CSS or system colour name, a hex, a colour function. */
const namesColour = (v) => new RegExp(NAMED_RE.source, 'i').test(v) || /#[0-9a-fA-F]{3,8}\b/.test(v) || new RegExp(COLOUR_FN.source, 'i').test(v)
/** Every palette utility in a source (in a className or any string: a class
    list kept in a const is the same leak), and every colour prop given a
    literal colour. `fill="none"` and `stroke="currentColor"` are not colours. */
export function paletteLeaks(src) {
  const code = jsCode(src)
  return [
    ...(code.match(PALETTE) || []),
    ...[...code.matchAll(COLOUR_PROP)].filter((m) => namesColour(m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? '')).map((m) => m[0].trim()),
  ]
}

/** The data attributes a source's JSX sets from a variable — `data-tone={meta.tone}`,
    `data-size={size}` — with the lane classes of the element that carries
    each: every one `unreachableAttributeValues` skips, since it cannot read
    a variable. Each needs its values declared, read from the component's
    own constant map (`unmatchedValues`). One entry per class, attribute and
    expression. */
export function variableAttributes(src) {
  const out = new Map()
  for (const e of elementsOf(src)) {
    for (const m of e.own.matchAll(/\s(data-[a-z-]+)=\{/g)) {
      const at = m.index + m[0].length - 1
      const set = e.attrs.slice(at, e.own.indexOf('}', at) + 1).replace(/\s+/g, ' ')
      if (literalSetter(set)) continue
      const classes = e.classes.filter((c) => c.startsWith('rb-'))
      out.set(`${classes.join(' ')}|${m[1]}|${set}`, { classes, attr: m[1], set })
    }
  }
  return [...out.values()]
}
/** Every value a sheet keys `[attr="v"]` on (any quoting) in a compound that
    names the class `cls` — inside a `:not()` too: a value it waits for is
    one it must be able to meet. */
export function keyedValues(css, cls, attr) {
  const named = new RegExp(`\\.${escapeRe(cls)}(?![\\w-])`)
  const value = new RegExp(`\\[${escapeRe(attr)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([\\w-]+))\\s*\\]`, 'g')
  return [...new Set(rulesOf(css)
    .flatMap(({ sel }) => sel.split(/[\s,>+~]+/))
    .filter((c) => named.test(c))
    .flatMap((c) => [...c.matchAll(value)].map((m) => m[1] ?? m[2] ?? m[3])))]
}
/** A variable-valued attribute against its sheet: `domain` is every value
    the component's own map can put there, `base` the ones its unkeyed rule
    serves on purpose (a default, a quiet tone). Returns a rule's value that
    nothing emits (`.rb-relink-group-head[data-tone="succes"]`), a value
    emitted with no rule and not listed as the base's (the deleted
    `[data-tone="create"]`), and a base value that is not emitted or has a
    rule after all (so the list cannot hide either mistake). */
export function unmatchedValues(css, cls, attr, domain, base = []) {
  const keyed = keyedValues(css, cls, attr)
  const can = new Set(domain)
  return [
    ...keyed.filter((v) => !can.has(v)).map((v) => `.${cls}[${attr}="${v}"]: nothing sets "${v}"`),
    ...domain.filter((v) => !keyed.includes(v) && !base.includes(v)).map((v) => `.${cls} ${attr}="${v}": set, and no rule keys on it`),
    ...base.filter((v) => !can.has(v)).map((v) => `.${cls} ${attr}="${v}": listed as the unkeyed rule's, and nothing sets it`),
    ...base.filter((v) => keyed.includes(v)).map((v) => `.${cls} ${attr}="${v}": listed as the unkeyed rule's, and a rule keys on it`),
  ]
}

/* ── the values a component's own map can emit, read from its source ──────── */
const LITERALS = /'([^']*)'|"([^"]*)"/g
/** A const array's string literals: `const THUMB_SIZES = ['sm', 'md', 'lg']`. */
export function arrayValues(src, name) {
  const m = jsCode(src).match(new RegExp(`\\bconst\\s+${escapeRe(name)}\\s*=\\s*\\[([^\\]]*)\\]`))
  return m ? [...m[1].matchAll(LITERALS)].map((x) => x[1] ?? x[2]) : []
}
/** One field's values across a constant map — `tone` in
    `const FILE_EVENT_META = { uploaded: { tone: 'create', … }, … }` — and in
    the fallback a lookup of it is written with (`FILE_EVENT_META[k] || { tone: 'other' }`).
    Null when one of them is not a string literal: then nothing can be read. */
export function mapFieldValues(src, name, field) {
  const code = jsCode(src)
  const at = code.search(new RegExp(`\\bconst\\s+${escapeRe(name)}\\s*=\\s*\\{`))
  if (at < 0) return null
  let end = code.indexOf('{', at)
  for (let d = 0; end < code.length; end++) { if (code[end] === '{') d++; else if (code[end] === '}' && --d === 0) break }
  const blocks = [code.slice(at, end + 1),
    ...[...code.matchAll(new RegExp(`\\b${escapeRe(name)}\\[[^\\]]*\\]\\s*(?:\\|\\||\\?\\?)\\s*(\\{[^{}]*\\})`, 'g'))].map((m) => m[1])]
  const fields = blocks.flatMap((b) => [...b.matchAll(new RegExp(`\\b${escapeRe(field)}\\s*:\\s*([^,}\\n]+)`, 'g'))].map((m) => m[1].trim()))
  if (!fields.length || !fields.every((v) => /^(['"])[^'"]*\1$/.test(v))) return null
  return [...new Set(fields.map((v) => v.slice(1, -1)))]
}
/** The values a prop reaches a component with: every literal its callers in
    `sources` hand it, and its default in the component's own signature
    (`function FileThumbnail({ size = 'small' })`). Null when a caller hands
    it an expression: then nothing can be read. */
export function propValues(sources, component, prop) {
  const out = new Set()
  for (const src of sources) {
    for (const e of elementsOf(src).filter((x) => x.tag === component)) {
      const at = e.own.search(new RegExp(`\\s${escapeRe(prop)}=`))
      if (at < 0) continue
      const m = e.attrs.slice(at).match(new RegExp(`^\\s${escapeRe(prop)}=(?:"([^"]*)"|\\{\\s*(?:'([^']*)'|"([^"]*)")\\s*\\})`))
      if (!m) return null
      out.add(m[1] ?? m[2] ?? m[3])
    }
    const sig = jsCode(src).match(new RegExp(`\\bfunction\\s+${escapeRe(component)}\\s*\\(\\s*\\{([^}]*)\\}`))
    const def = sig?.[1].match(new RegExp(`\\b${escapeRe(prop)}\\s*=\\s*(?:'([^']*)'|"([^"]*)")`))
    if (def) out.add(def[1] ?? def[2])
  }
  return [...out]
}

/* ══ lanes B5 and B5b, review round one (2026-09-27) ═════════════════════════
   R1-09. R3-26's thirty-two `e.target.style.borderColor = …` hover writers
   and W9's `window.confirm` calls were each held by a scan that knew ONE
   spelling, in one lane: Scenes looked for `.target.style` /
   `.currentTarget.style` and `window.confirm`, and the Budget for neither —
   a planted `onMouseEnter={e => { e.currentTarget.style.backgroundColor = … }}`
   and a `window.confirm(…)` in BudgetView.jsx and CrewTeamTab.jsx passed
   every Budget guard, and a write through an alias or a ref, or a bare
   `confirm(…)`, passed the Scenes one. This is the ONE predicate both lanes
   run over every file they guard, whole (a staged function included).
   ═══════════════════════════════════════════════════════════════════════════ */

/** A member named `name` on an expression — `x.name`, `x?.name`, `x['name']`,
    `x?.["name"]` — as a RegExp source; the match starts at the dot or the
    bracket, and the receiver is any expression that ends in a name, `)` or
    `]` (`e.target`, `el`, `ref.current`, `rows[0]`, `get()`). */
const memberOf = (name) => String.raw`(?<=[\w$\])])\s*(?:\??\.\s*${name}(?![\w$])|\??\.?\s*\[\s*(?:'${name}'|"${name}"|\`${name}\`)\s*\])`
/** An expression's `.style`, in either spelling (review round two, R2-02:
    `el['style'].color = …` passed). */
const STYLE_OF = memberOf('style')
/** The Typed OM's inline style (`el.attributeStyleMap`), which writes the
    same `style` attribute (R2-02). */
const STYLE_MAP_OF = memberOf('attributeStyleMap')
/** An assignment operator, plain or compound (`=`, `+=`, `??=`, …), never
    `==` / `===`. */
const ASSIGN = String.raw`(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?!=)`
/** A call, plain or optional: `(` or `?.(`. */
const CALL = String.raw`\s*(?:\?\.\s*)?\(`
/** Where a bare name is read as a value, not written as a word: after an
    operator or punctuator that takes an expression, or a keyword that does
    (`= confirm`, `(confirm`, `, confirm`, `{ confirm`, `? confirm`,
    `return confirm`, a line's start). A word in JSX text after a letter
    (`Please confirm`) is not in one. */
const VALUE_AT = String.raw`(?<=(?:^|[=(,[{:?!&|;]|=>|\b(?:return|await|typeof|void|yield))\s*)`
/** An object pattern, one level of nesting inside it, then `=` (not `==`,
    `===`, `=>`): a destructure (`const { a, b: c } = x`). */
const PATTERN_ASSIGNED = /\{(?:[^{}]|\{[^{}]*\})*\}\s*=(?![=>])/g
/** Every place a source writes an element's style from script, and every
    `confirm` it reaches, read on the code (comments out) and labelled by
    kind. Exactly these, no more (review round two, R2-02: round one's
    comment said "any spelling", and six style spellings and six confirm
    spellings passed it):
      · `style write`: on any receiver — an event's target, an alias, a ref,
        a call's result — and `.style` or `['style']` alike: a style
        property assigned (`x.style.color = …`, `x.style['color'] = …`,
        `x['style'].color = …`, `x.style.cssText = …`, a compound `+=`); a
        writing method, called or optionally called
        (`x.style.setProperty(…)`, `x.style.setProperty?.(…)`,
        `removeProperty`); the Typed OM's writers
        (`x.attributeStyleMap.set(…)`, `append`, `delete`, `clear`); the
        attribute (`x.setAttribute('style', …)`,
        `x.setAttributeNS(ns, 'style', …)`); and a bare `style.color = …`,
        the write through a destructured `style`;
      · `style handed on`: the style object (or the Typed OM's map) itself
        aliased (`const s = el.style`), replaced (`el.style = …`) or passed
        (`Object.assign(el.style, …)`), and a destructure that takes
        `style` out of anything (`const { style } = el`,
        `const { style: s } = e.target`, one level deep) — a write through
        it is out of sight;
      · `confirm`: any `.confirm` / `['confirm']` member, called or not, on
        any receiver (`window.confirm`, `window.top.confirm(…)`,
        `window.parent.confirm(…)`, `document.defaultView.confirm(…)`,
        `w.confirm` for `const w = window`); a bare `confirm(…)` call; and
        a bare `confirm` where a value starts (VALUE_AT: after
        `= ( , [ { : ? ! & | ;`, `=>`, `return`, `await`, `typeof`, `void`,
        `yield` or at a line's start — `const ask = confirm`,
        `[].map(confirm)`, `const { confirm: ask } = window`).
    Not caught, deliberately: a name built at run time (`el[key]`,
    `window[name]`, `setAttribute(attr, …)`, `Reflect.get(window,
    'confirm')`), a destructure nested two levels deep, a bare `confirm`
    after any other token (`export default confirm`), and a `confirm` in a
    string. A destructure of `style` from props (`({ style } = {})`) and a
    `confirm` object key ARE caught — neither is in either lane.
    A read is not a write: `rule.style?.getPropertyValue(…)` (ClientViewTab's
    font rules), `doc.styleSheets`, `el.style.width` in an expression,
    `el.attributeStyleMap.get(…)`, a JSX `style={{ … }}`, an options key
    (`{ style: 'currency' }`). Nor is a name that only contains the word:
    `width="confirm"`, `onConfirm`, `confirmBulk` / `setConfirmBulk`,
    `ConfirmDialog`, `handleConfirm`, `'.ui-dialog[data-width="confirm"]'`.
    `allowed` lists the exact matches (as reported, less the kind) a file
    may keep — a measured geometry written from script — each with its
    reason where the caller lists it. */
export function scriptedLeaks(src, allowed = []) {
  const code = jsCode(src)
  const out = []
  const add = (kind, text) => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!allowed.includes(t)) out.push(`${kind}: ${t}`)
  }
  const each = (re, kind) => { for (const m of code.matchAll(re)) add(kind, m[0]) }
  // ── style writes ──
  each(new RegExp(`${STYLE_OF}\\s*(?:\\??\\.\\s*[\\w$]+|\\[[^\\]]*\\])\\s*${ASSIGN}`, 'g'), 'style write')
  each(new RegExp(`${STYLE_OF}\\s*\\??\\.\\s*(?:setProperty|removeProperty)${CALL}`, 'g'), 'style write')
  each(new RegExp(`${STYLE_MAP_OF}\\s*\\??\\.\\s*(?:set|append|delete|clear)${CALL}`, 'g'), 'style write')
  each(new RegExp(`\\.\\s*setAttribute${CALL}\\s*(['"\`])style\\1`, 'g'), 'style write')
  each(new RegExp(`\\.\\s*setAttributeNS${CALL}[^,()]*,\\s*(['"\`])style\\1`, 'g'), 'style write')
  each(new RegExp(`(?<![\\w$.'"\`-])style\\s*(?:\\??\\.\\s*[\\w$]+|\\[[^\\]]*\\])\\s*${ASSIGN}`, 'g'), 'style write')
  // ── the style object handed on ──
  each(new RegExp(`${STYLE_OF}(?!\\s*(?:\\??\\.|\\[))`, 'g'), 'style handed on')
  each(new RegExp(`${STYLE_MAP_OF}(?!\\s*(?:\\??\\.|\\[))`, 'g'), 'style handed on')
  for (const m of code.matchAll(PATTERN_ASSIGNED)) {
    if (/(?<![\w$.'"`-])style\s*(?::\s*[\w$]+\s*)?[,}]/.test(m[0])) add('style handed on', m[0])
  }
  // ── confirm ──
  each(/(?:[\w$]+\s*)?\??\.\s*confirm(?![\w$-])|(?:[\w$]+\s*)?\??\.?\s*\[\s*(['"`])confirm\1\s*\]/g, 'confirm')
  each(/(?<![\w$.])confirm\s*\(/g, 'confirm')
  each(new RegExp(`${VALUE_AT}confirm(?![\\w$'"\`-])(?!\\s*\\()`, 'gm'), 'confirm')
  return out
}

/* ══ lanes B5 and B5b, review round two (2026-09-27) ════════════════════════
   R2-07. Round one's inset rings (R1-06, R1-07) and its "+ takes" lift
   (R1-12), and round two's scroll-padding (R2-03) and inset rings (R2-04),
   are CSS no mounted test can see: jsdom lays nothing out, and reverting
   any one of them passed every test. Both lanes read them off their sheets
   with these, each with a CONTROL that the reading fails without the rule.
   ═══════════════════════════════════════════════════════════════════════════ */

/** What a sheet gives `sel` — one selector of a rule's list, whitespace
    aside — for `prop`: the last declaration in source order (a lane sheet is
    one layer, so source order is the cascade among its own rules), or null. */
export function declaredValue(css, sel, prop) {
  const want = sel.replace(/\s+/g, ' ').trim()
  let value = null
  for (const { sel: s, body } of rulesOf(css)) {
    if (!selectorsOf(s).some((one) => one.replace(/\s+/g, ' ') === want)) continue
    for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${escapeRe(prop)}\\s*:\\s*([^;]*?)\\s*(?=;|$)`, 'g'))) value = m[1]
  }
  return value
}
/** A sheet (comments out) with `prop` set to `value` in every rule for `sel`,
    or taken out (`value` null): a CONTROL's mutant. */
export function withDeclaration(css, sel, prop, value) {
  const want = sel.replace(/\s+/g, ' ').trim()
  return cssCode(css).replace(/([^{}]+)\{([^{}]*)\}/g, (all, s, body) => {
    if (!selectorsOf(s.trim()).some((one) => one.replace(/\s+/g, ' ') === want)) return all
    const decl = new RegExp(`(^|;)(\\s*)${escapeRe(prop)}\\s*:[^;]*(;|$)`, 'g')
    return `${s}{${body.replace(decl, value == null ? '$1' : `$1$2${prop}: ${value}$3`)}}`
  })
}
/** The kit's one focus ring (index.css `:focus-visible`): its width and its
    offset in px, and how far past the box it reaches (their sum). */
export function kitRing(kit = indexCss) {
  const body = rulesOf(kit).find(({ sel }) => sel === ':focus-visible')?.body || ''
  const width = Number((body.match(/(?:^|;)\s*outline\s*:\s*(\d+(?:\.\d+)?)px/) || [])[1])
  const offset = Number((body.match(/(?:^|;)\s*outline-offset\s*:\s*(-?\d+(?:\.\d+)?)px/) || [])[1])
  return { width, offset, reach: width + offset }
}
/** Is `sel`'s ring drawn inside its box: an `outline-offset` that takes the
    kit ring's whole width in? */
export function ringInset(css, sel, kit = indexCss) {
  const v = declaredValue(css, sel, 'outline-offset')
  return v != null && /^-?\d+(?:\.\d+)?px$/.test(v) && parseFloat(v) + kitRing(kit).width <= 0
}
/** The kit rules that set `outline-offset` on a focused element of `cls`:
    the bare `:focus-visible`, and any whose last compound names `cls`. A
    lane rule that insets that element's ring is written heavier than all of
    them (the header's specificity rule). */
export function kitOffsetRules(cls, kit = indexCss) {
  const named = new RegExp(`\\.${escapeRe(cls)}(?![\\w-])`)
  return rulesOf(kit)
    .filter(({ body }) => /(?:^|;)\s*outline-offset\s*:/.test(body))
    .flatMap(({ sel }) => selectorsOf(sel))
    .filter((one) => lastCompound(one) === ':focus-visible' || named.test(lastCompound(one)))
}

/* ── which rules can land on an element (post-overhaul FX10) ─────────────── */
/** Can a compound selector land on `el` — { tag, classes, attrs: { name: value } }?
    A pseudo-element is not the element; `:where()` / `:is()` around the whole
    compound is read through; `:not(x)` excludes an element x describes; any
    other pseudo-class is a state the element may be in. An attribute the
    element does not list may be set or not (a state, `[data-empty]`), except
    the ones it is known by — `type`, `data-size`, `data-surface` — which
    must match. (FX10 review round 1, R1-02: a rule was read only by its exact
    selector, so a context rule that padded a date field passed.) Round 2
    (R2-02): `:is()` / `:where()` inside a compound need one argument that can
    land; `:not(x)` excludes only where x is decided by what the element is
    known by — `:not([data-empty="true"])` may hold or not, so it excludes
    nothing (it had read as excluding every field). */
// VW1b: `data-col` (the Tasks table keys its Bid and Title cells on it) is
// known: a cell that does not carry it is not met by a rule that needs it.
const KNOWN_ATTRS = ['type', 'data-size', 'data-surface', 'data-col']
const decidable = (one) => {
  const t = one.trim()
  if (!t || /[\s>+~:]/.test(t)) return false
  return [...t.matchAll(/\[([\w-]+)/g)].every((m) => KNOWN_ATTRS.includes(m[1]))
}
export function compoundMatches(compound, el) {
  let s = compound.trim()
  const whole = s.match(/^:(?:where|is)\(([^()]*)\)$/)
  if (whole) return selectorsOf(whole[1]).some((one) => compoundMatches(topCompound(one), el))
  if (s.includes('::')) return false
  // A state or a place the element is known never to be in (`el.never`:
  // a middle cell is never `:first-child` or `:last-child`).
  for (const p of el.never || []) if (s.replace(/:not\([^()]*\)/g, '').includes(p)) return false
  // :not() arguments: the element is excluded by one it is known to meet.
  for (const [, arg] of s.matchAll(/:not\(([^()]*)\)/g)) {
    if (selectorsOf(arg).some((one) => decidable(one) && compoundMatches(one.trim(), el))) return false
  }
  // :is() / :where() inside the compound: one argument must be able to land.
  for (const [, arg] of s.matchAll(/:(?:where|is)\(([^()]*)\)/g)) {
    if (!selectorsOf(arg).some((one) => compoundMatches(topCompound(one), el))) return false
  }
  s = s.replace(/:not\([^()]*\)/g, '').replace(/:(?:where|is)\([^()]*\)/g, '').replace(/:[\w-]+(\([^()]*\))?/g, '')
  const tag = (s.match(/^[a-zA-Z][\w-]*/) || [])[0]
  if (tag && tag !== '*' && tag.toLowerCase() !== el.tag) return false
  for (const [, c] of s.matchAll(/\.([\w-]+)/g)) if (!el.classes.includes(c)) return false
  const attrs = [...s.matchAll(/\[([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g)]
    .map((m) => ({ name: m[1], op: m[2], value: m[3] ?? m[4] ?? m[5] }))
  for (const { name, op, value } of attrs) {
    if (!KNOWN_ATTRS.includes(name)) continue
    const have = el.attrs[name]
    if (have == null) return false
    if (op === '=' && have !== value) return false
  }
  return true
}
/** A declaration block's horizontal insets, where it sets them, with their
    importance: `{ prop: { value, important } }` for padding-left, padding-right,
    border-left-width and border-right-width, from the longhands and the
    `padding`, `padding-inline`, `border`, `border-width`, `border-left` / `-right`
    shorthands. A plain length is a number of px; anything else its text.
    Within the block an !important declaration is not undone by a later
    normal one. */
export function insetDeclarations(body) {
  const out = {}
  const decl = (p) => {
    let v = null
    for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${escapeRe(p)}\\s*:\\s*([^;]*?)\\s*(?=;|$)`, 'g'))) {
      if (v == null || !importance(v).important || importance(m[1]).important) v = m[1]
    }
    return v
  }
  const len = (t) => (t == null ? undefined : /^0$/.test(t) ? 0 : /^-?\d+(?:\.\d+)?px$/.test(t) ? parseFloat(t) : t)
  const sides = (v) => { const p = v.trim().split(/\s+/); return { left: p[3] ?? p[1] ?? p[0], right: p[1] ?? p[0] } }
  const put = (prop, value, important) => { if (out[prop]?.important && !important) return; out[prop] = { value, important } }
  const order = []
  for (const m of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)) order.push(m[1])
  for (const p of order) {
    const raw = decl(p)
    if (raw == null) continue
    const { value: v, important: imp } = importance(raw)
    if (p === 'padding') { const s = sides(v); put('padding-left', len(s.left), imp); put('padding-right', len(s.right), imp) }
    else if (p === 'padding-inline') { const [a, b] = v.trim().split(/\s+/); put('padding-left', len(a), imp); put('padding-right', len(b ?? a), imp) }
    else if (p === 'padding-left' || p === 'padding-inline-start') put('padding-left', len(v), imp)
    else if (p === 'padding-right' || p === 'padding-inline-end') put('padding-right', len(v), imp)
    else if (p === 'border' || p === 'border-left' || p === 'border-right' || p === 'border-inline') {
      const w = v.trim() === '0' || /^none\b/.test(v.trim()) ? 0 : len((v.match(/(^|\s)(\d+(?:\.\d+)?px|0)(?=\s|$)/) || [])[2] ?? v)
      if (p !== 'border-right') put('border-left-width', w, imp)
      if (p !== 'border-left') put('border-right-width', w, imp)
    } else if (p === 'border-width') { const s = sides(v); put('border-left-width', len(s.left), imp); put('border-right-width', len(s.right), imp) }
    else if (p === 'border-left-width' || p === 'border-inline-start-width') put('border-left-width', len(v), imp)
    else if (p === 'border-right-width' || p === 'border-inline-end-width') put('border-right-width', len(v), imp)
  }
  return out
}
/** insetDeclarations' values alone. */
export function horizontalInsets(body) {
  return Object.fromEntries(Object.entries(insetDeclarations(body)).map(([p, d]) => [p, d.value]))
}
/** Across `sheets` (in load order), the horizontal insets that win on `el`:
    for each of padding-left / -right and border-left / -right-width, the
    declaration whose selector can land on it that the cascade puts first —
    its tier (`cascadeTier`: !important, then its layer), then its
    specificity, then the later one — and every other declaration at that
    tier and specificity with a different value (`ties`: load order
    decides). A context selector counts unless it names a class outside
    `el.reach` (the classes that can be around the element: `classReach`'s
    `written` for its file; the kit's `ui-` classes always count) — review
    round 2, R2-02's M11: a hand-listed set of the ancestors the element HAS
    missed its view's own wrappers, and the rules naming them. Without
    `el.reach`, every context counts. */
export function winningInsets(sheets, el) {
  const won = {}
  sheets.forEach((sheet, f) => rulesWithContext(sheet).forEach(({ sel, body, layer }, r) => {
    for (const one of selectorsOf(sel)) {
      const last = topCompound(one)
      if (!compoundMatches(last, el)) continue
      if (el.reach && one.trim() !== last.trim()) {
        const named = (one.slice(0, one.lastIndexOf(last)).match(/\.([\w-]+)/g) || []).map((c) => c.slice(1))
        if (named.some((c) => !c.startsWith('ui-') && !el.reach.has(c))) continue
      }
      for (const [p, { value, important }] of Object.entries(insetDeclarations(body))) {
        const d = { selector: one.trim(), value, spec: specificity(one), tier: cascadeTier(important, layer), order: [f, r] }
        const cur = won[p]
        if (!cur) { won[p] = { ...d, ties: [] }; continue }
        const cmp = d.tier - cur.tier || gt(d.spec, cur.spec)
        if (cmp > 0) won[p] = { ...d, ties: [] }
        else if (cmp === 0) {
          const ties = d.value === cur.value ? cur.ties : [...cur.ties, cur]
          won[p] = { ...d, ties: ties.filter((t) => t.value !== d.value) }
        }
      }
    }
  }))
  return won
}
/** The parts Blink draws a date field with (Gecko's cannot be styled). */
export const DATE_PARTS = /::-webkit-(?:calendar-picker-indicator|datetime-edit[\w-]*|inner-spin-button|clear-button)(?![\w-])/
/** The rules in `sheets` that style a part of the field `el` — their
    compound before the pseudo-element can land on it — with the properties
    each sets (review round 2, R2-02's M8: a margin on the calendar glyph
    took the date's room, and every check read the field alone). */
export function datePartRules(sheets, el) {
  const out = []
  sheets.forEach((sheet, f) => rulesWithContext(sheet).forEach(({ sel, body, layer }, r) => {
    for (const one of selectorsOf(sel)) {
      const last = topCompound(one)
      const m = last.match(DATE_PARTS)
      if (!m || !compoundMatches(last.slice(0, m.index) || '*', el)) continue
      out.push({ selector: one.trim(), part: m[0], props: propsOf(body), body, layer, order: [f, r] })
    }
  }))
  return out
}
/** Every JSX opening tag in the source with the opening tags it sits inside
    in that file, outermost first: `{ tag, text, ancestors }`. A tag is walked
    as jsxTags walks it; `</Tag>` closes the nearest open Tag, `<>` and `</>`
    a fragment; a `<` right after a name, `)` or `]` is a comparison. */
export function jsxNesting(source) {
  const out = []
  const stack = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || /[\w)\]]/.test(source[i - 1] || '')) continue
    const close = source.slice(i, i + 80).match(/^<\/([A-Za-z][\w.]*)?\s*>/)
    if (close) {
      const name = close[1] || ''
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].tag === name) { stack.length = k; break }
      i += close[0].length - 1
      continue
    }
    if (source[i + 1] === '>') { stack.push({ tag: '', text: '<>' }); i++; continue }
    if (!/[A-Za-z]/.test(source[i + 1] || '')) continue
    let depth = 0, j = i
    for (; j < source.length; j++) {
      const c = source[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    const text = source.slice(i, j + 1)
    const tag = text.match(/^<([A-Za-z][\w.]*)/)[1]
    out.push({ tag, text, ancestors: stack.map((s) => s.text) })
    if (!/\/\s*>$/.test(text)) stack.push({ tag, text })
    i = j
  }
  return out
}
/** The classes an opening tag's element carries: its own and its kit root's. */
export const classesOf = (tagText) => elementsOf(tagText).flatMap((e) => [...e.classes, ...e.kit])
const reaches = new Map()
/** For every .jsx under `root` (tests aside), keyed by its path from `root`:
    `own`, the classes the file writes, and `written`, those and the classes
    of the elements around each place another file renders it, at any remove
    — or all that file's own, where no such place is found (a component
    handed on as a value). Renders are read from relative imports, static or
    `lazy(() => import())`, by the names they bind. A context selector whose
    ancestors name a class outside `written` cannot hold an element of the
    file. (FX10 review round 2, R2-02: M1c, a parent's context the field's own
    file did not write; M11, a hand-listed set of a cell's ancestors that
    missed its view's own wrappers.) */
export function classReach(root) {
  if (reaches.has(root)) return reaches.get(root)
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p)
    return /\.jsx$/.test(n) && !/\.test\.jsx$/.test(n) ? [p] : []
  })
  const sources = walk(root).map((p) => ({ file: relative(root, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }))
  const files = new Set(sources.map((s) => s.file))
  const resolveFrom = (from, spec) => {
    const base = posix.normalize(posix.join(posix.dirname(from), spec))
    return [base, `${base}.jsx`, `${base}.js`, `${base}/index.jsx`].find((c) => files.has(c))
  }
  const renders = []
  for (const { file, src } of sources) {
    const code = jsCode(src)
    for (const m of code.matchAll(/\bimport\s+([\w$\s{},*]+?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const child = resolveFrom(file, m[2])
      if (!child || child === file) continue
      const names = m[1].replace(/[{}]/g, ',').split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.startsWith('* as ') ? s.slice(5) : s.split(/\s+as\s+/).pop()).trim())
      renders.push({ child, parent: file, names })
    }
    for (const m of code.matchAll(/\b(?:const|let)\s+([\w$]+)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const child = resolveFrom(file, m[2])
      if (child && child !== file) renders.push({ child, parent: file, names: [m[1]] })
    }
  }
  const own = Object.fromEntries(sources.map(({ file, src }) => [file, new Set(elementsOf(src).flatMap((e) => [...e.classes, ...e.kit]))]))
  const nesting = Object.fromEntries(sources.map(({ file, src }) => [file, jsxNesting(normal(jsCode(src)))]))
  const memo = new Map()
  const around = (file, seen) => {
    if (memo.has(file)) return memo.get(file)
    if (seen.has(file)) return new Set()
    seen.add(file)
    const out = new Set()
    for (const { child, parent, names } of renders) {
      if (child !== file) continue
      const uses = nesting[parent].filter((t) => names.some((n) => t.tag === n || t.tag.startsWith(`${n}.`)))
      const near = uses.length ? uses.flatMap((t) => t.ancestors.flatMap(classesOf)) : [...own[parent]]
      for (const c of [...near, ...around(parent, seen)]) out.add(c)
    }
    memo.set(file, out)
    return out
  }
  const written = Object.fromEntries(sources.map(({ file }) => [file, new Set([...own[file], ...around(file, new Set())])]))
  const out = { sources, own, written }
  reaches.set(root, out)
  return out
}
