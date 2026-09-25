// =============================================================================
// otterCss.test.js — A3 (2026-09-24). O.T.T.E.R.'s own stylesheet, pinned the
// way adminTerminalCss.test.js and dashboardCss.test.js pin theirs.
//
// otter.css has two halves: A3's restyle, and A4's to come below it. Its
// header states the rules both halves keep; these are the ones a source scan
// can hold without a browser. What it cannot hold — that a rule actually wins
// the cascade — is proved in the running app (the A3 hand-off, §2).
//
// A3 review round 2 hardened every check here: the sheet is read rule by rule
// through scripts/ui-css-rules.mjs (brace-walked, nested blocks included),
// colours are judged against an ALLOW-list (a blocklist of hex and functional
// notations let `orange`, `LinkText`, a Tailwind palette variable and a hex
// inside a url() through), and every ui-audit row is held at zero, as the
// audit's own comment on this sheet says.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allRules, decls, splitTop, themeNames, specificity, compareSpecificity } from '../../../scripts/ui-css-rules.mjs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { cssCounts } from '../../../scripts/ui-audit.mjs'
import { contrast, hexToRgb, rgbToHex } from '../../ui/contrast.js'

const SHEET_PATH = 'src/tools/otter_v0.3.1/otter.css'
const RAW = readFileSync(fileURLToPath(new URL('./otter.css', import.meta.url)), 'utf8')
/** Comments blanked to spaces, so offsets and line numbers survive. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
const INDEX = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')
const THEME = themeNames(INDEX)
const JSX_FILES = ['./Otter.jsx', './components/CourseBadges.jsx', './components/CourseFilterChips.jsx',
  './components/CourseRowMenu.jsx', './components/SidebarCollapse.jsx',
  // A4's surfaces
  './Validator.jsx', './components/RequestsView.jsx', './components/ChangeRequestDialog.jsx',
  './components/ShareCourseDialog.jsx', './components/TrashPanel.jsx']
  .map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'))

/** A colour written as a value rather than read from a token: hex (also
 *  caught app-wide by typeScale's page-sheet row), the functional spellings,
 *  and the two keywords that are colours. `white-space` is not `white`. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(|(?<![-\w])(?:white|black)(?![-\w])/gi

/** Properties that carry a colour. */
const COLOUR_PROPS = /(^|-)color$|^(background|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|outline|fill|stroke|background-image|box-shadow|text-decoration|text-shadow|column-rule)$/
/** A colour value is ALLOWED when, once its tokens (`@theme` names and the
 *  sheet's own `--node-color`), `color-mix(in …`, the keywords that are not
 *  colours, the edge styles and the numbers are taken out, nothing is left. */
function colourOk(v, theme = THEME) {
  if (/url\(/i.test(v)) return false
  const s = v.replace(/var\(--([\w-]+)\)/g, (x, n) => (theme.has(n) || n === 'node-color' ? ' TOKEN ' : ' UNKNOWN '))
  if (/UNKNOWN/.test(s)) return false
  return s.replace(/color-mix\(in (srgb|oklab|oklch)|\bTOKEN\b|\b(transparent|currentcolor|inherit|none|solid|dashed|dotted|inset)\b|(?<![\w-])-?\d+(\.\d+)?(px|%)?|[(),\s]/gi, '').trim() === ''
}
/** Every colour in the sheet off the allow-list, and every transition that
 *  names no property (a bare duration is `all`) or names `all`. */
function sheetViolations(source, theme = THEME) {
  const bad = []
  for (const r of allRules(source)) {
    for (const [p, v] of decls(r.body)) {
      if (COLOUR_PROPS.test(p) && !colourOk(v, theme)) bad.push(`${r.sel}  ${p}: ${v}`)
      if (p === 'transition') {
        for (const t of splitTop(v)) {
          // A4 review round 1 (mutants E3, E4): the timing may come FIRST —
          // 'ease-out var(--duration-state)' names no property and computes to
          // `all`. Take the timing words out; one property name must be left.
          const words = (t.trim().match(/[\w-]+\((?:[^()]|\([^()]*\))*\)|\S+/g) || [])
            .filter((w) => !/^[\d.]+m?s$|^var\(--(duration|ease)-[\w-]+\)$|^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$|^(cubic-bezier|steps)\(/i.test(w))
          if (words.length !== 1 || /^all$/i.test(words[0]) || !/^[a-z-]+$/i.test(words[0])) bad.push(`${r.sel}  transition: ${t.trim()}  (no property, or all)`)
        }
      }
      if (p === 'transition-property' && /\ball\b/i.test(v)) bad.push(`${r.sel}  transition-property: ${v}`)
    }
  }
  return bad
}

describe('otter.css', () => {
  it('names the cascade layers on its first line of code', () => {
    // It is imported from a component, so the bundler may emit it before
    // src/index.css, and a layer's place in the cascade is fixed where it is
    // FIRST named (D1 hand-off §5 trap 1). Deleting this line stayed green
    // before this file existed (A3 review round 1). An `@charset` may come
    // first: it is not a rule (A3 review round 2).
    const lines = CODE.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const first = /^@charset\s/i.test(lines[0]) ? lines[1] : lines[0]
    expect(first).toBe('@layer theme, base, components, utilities;')
  })

  it('writes no colour that is not a token (C8)', () => {
    // A3's half was extraction transcription (oklch, rgb, a keyword) until the
    // restyle replaced every one; this keeps the sheet that way.
    expect(CODE.match(COLOUR_LITERAL) || []).toEqual([])
    const bad = sheetViolations(RAW)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('has no `transition: all` and no `!important`', () => {
    expect(CODE).not.toMatch(/transition\s*:\s*all\b/i)
    expect(CODE).not.toMatch(/!\s*important/i)
  })

  it('scores zero on every ui-audit row, as the audit says it does (A3 review round 2)', () => {
    // ui-audit.mjs says of this sheet "it scores 0 on every row (otterCss.test.js
    // holds it there)"; until round two this file held two of the eight.
    const rows = cssCounts([SHEET_PATH])
    expect(rows.length, 'the audit returned its rows').toBeGreaterThanOrEqual(8)
    for (const row of rows) expect(row.hits, `${row.label}: ${JSON.stringify(row.inFiles)}`).toBe(0)
  })

  it('the node type badge clears AA on its own wash for all fifteen colours (Q9; A3 review round 1)', () => {
    // The word is the data colour mixed toward the ink; the wash is the colour
    // at a small share over the card (paper-raised). Worked out here, from the
    // map in Otter.jsx and the two percentages in this sheet, so reverting the
    // mix (Integer: 4.47:1) or thinning it fails without a browser.
    const map = Object.fromEntries([...JSX_FILES[0].match(/const NODE_TYPE_COLORS = \{([\s\S]*?)\};/)[1]
      .matchAll(/'(\w+)':\s*'(#[0-9a-f]{6})'/gi)].map((m) => [m[1], m[2]]))
    expect(Object.keys(map), 'the fifteen colours were read').toHaveLength(15)
    const rule = allRules(RAW).find((r) => r.sel === '.ui-badge.otter-node-type')
    const d = Object.fromEntries(decls(rule.body))
    const share = (v, re) => { const m = (v || '').match(re); return m ? parseFloat(m[1]) / 100 : null }
    const ink = share(d.color, /var\(--node-color\)\s+([\d.]+)%,\s*var\(--color-ink\)/) ?? (d.color === 'var(--node-color)' ? 1 : null)
    const wash = share(d['background-color'], /var\(--node-color\)\s+([\d.]+)%,\s*transparent/)
    expect(ink, `the badge's word is not readable as a mix: ${d.color}`).not.toBeNull()
    expect(wash, `the badge's wash is not readable: ${d['background-color']}`).not.toBeNull()
    const mix = (a, b, p) => rgbToHex(hexToRgb(a).map((x, i) => x * p + hexToRgb(b)[i] * (1 - p)))
    const low = Object.entries(map)
      .map(([k, c]) => [k, contrast(mix(c, THEME_HEX('color-ink'), ink), mix(c, THEME_HEX('color-paper-raised'), wash))])
      .filter(([, r]) => r < 4.5)
    expect(low, low.map(([k, r]) => `${k} ${r.toFixed(2)}:1`).join('\n')).toEqual([])
  })

  it('no one-class rule ties a kit element on a property the kit sets (the header\'s rule)', () => {
    // This sheet loads BEFORE index.css, and both write to `components`, so a
    // one-class rule here and a one-class kit rule on the same element, for
    // the same property, resolve to the KIT. Each otter class is mapped to
    // the kit element it sits on (the component's root class, or a `ui-`
    // class beside it), and any one-class rule on it may set only properties
    // the kit's one-class rule does not.
    // A4 review round 1: the map comes from a real parse of the JSX (ON_KIT,
    // below); the 600-character look-back it replaces read the Search dialog's
    // class as sitting on a <span>.
    const onKit = ON_KIT
    expect(onKit.size, 'the otter classes on kit elements were found').toBeGreaterThan(10)
    const kit = allRules(INDEX)
    const kitProps = (root) => new Set(kit.filter((r) => splitTop(r.sel).includes(`.${root}`)).flatMap((r) => decls(r.body).map(([p]) => p)))
    const bad = []
    for (const r of allRules(RAW)) {
      for (const one of splitTop(r.sel)) {
        const m = one.match(/^\.(otter-[\w-]+)$/)
        if (!m || !onKit.has(m[1])) continue
        const props = kitProps(onKit.get(m[1]))
        const tie = decls(r.body).map(([p]) => p).filter((p) => props.has(p))
        if (tie.length) bad.push(`${one} ties .${onKit.get(m[1])} on ${tie.join(', ')}`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('every third-ink text that sits under the hover wash or the signal tint is lifted there (A3 review rounds 1 and 2)', () => {
    // tokens.test.js pins why: the third ink is 4.33:1 on the wash over paper,
    // 3.99 over paper-raised and 4.18 on the tint. Each place A3 found is
    // listed, and must lift the text to the second ink (or the ink).
    const LIFTS = [
      ['.otter-subject-row:hover', '.otter-subject-order'],
      ['.otter-subject-row:hover', '.otter-subject-outline'],
      [".otter-subject-row[data-active='true']", '.otter-subject-order'],
      [".otter-subject-row[data-active='true']", '.otter-subject-outline'],
      ['.otter-group-row:hover', '.otter-group-count'],
      ['.otter-sw-option:hover', '.otter-sw-option-count'],
      [".otter-course-row[data-openable='false']:hover", '.otter-course-open'],
      ['.otter-fork-actions', '.otter-form-hint'],
      [".otter-subject-row[data-stub='true']:hover", ''],
      // A4: the settings slide-out's accordion headers.
      ['.otter-acc-head:hover', '.otter-acc-desc'],
      [".otter-settings-body[data-locked='true'] .otter-acc-head:hover", '.otter-acc-label'],
      // A4: the quiz centre's pickers.
      [".otter-quiz-course-head[data-selected='true']", '.otter-quiz-course-meta'],
      [".otter-quiz-sub[data-selected='true']", '.otter-quiz-sub-level'],
      ['.otter-quiz-sub:hover', '.otter-quiz-sub-level'],
      // A4: the Validator's audit list.
      [".otter-val-audit[data-active='true']", '.otter-val-audit-meta'],
      ['.otter-val-audit:hover', '.otter-val-audit-meta'],
      // A4: the search dialog's results.
      [".otter-search-result[data-active='true']", '.otter-search-result-path'],
      ['.otter-search-result:hover', '.otter-search-result-path'],
    ]
    const expand = (sel) => {
      const m = sel.match(/^(.*?)\s*:is\(([^()]*)\)$/)
      return m ? splitTop(m[2]).map((x) => `${m[1]} ${x}`.trim()) : [sel]
    }
    const lifted = new Set()
    for (const r of allRules(RAW)) {
      const c = decls(r.body).filter(([p]) => p === 'color').pop()
      if (!c || !/^var\(--color-ink(-2)?\)$/.test(c[1])) continue
      for (const one of splitTop(r.sel)) for (const x of expand(one)) lifted.add(x.replace(/\s+/g, ' '))
    }
    const missing = LIFTS.map(([state, text]) => `${state} ${text}`.trim()).filter((s) => !lifted.has(s))
    expect(missing, `not lifted to the second ink:\n${missing.join('\n')}`).toEqual([])
  })

  it('CONTROL: the scan reads the sheet, and each detector fires on what it forbids', () => {
    expect(CODE.length).toBeGreaterThan(10000)
    expect(CODE).toMatch(/\.otter-nav\s*\{/)
    for (const s of ['color: #fff;', 'color: rgb(1 2 3);', 'color: rgba(0,0,0,.5);', 'color: oklch(70% 0.1 50);',
      'color: hsl(20 50% 50%);', 'color: white;', 'background: black;', 'border-color: color(srgb 1 0 0);']) {
      expect(s.match(COLOUR_LITERAL), s).not.toBeNull()
    }
    for (const s of ['white-space: nowrap;', 'color: var(--color-ink);', 'background: color-mix(in srgb, var(--node-color) 12%, transparent);']) {
      expect(s.match(COLOUR_LITERAL), s).toBeNull()
    }
    // The allow-list and the transition parse, through sheetViolations:
    // round two's survivors, one apiece, and the sheet's own spellings clean.
    for (const s of ['color: orange;', 'color: LinkText;', 'color: color-mix(in srgb, darkorange 70%, var(--color-ink));',
      'color: var(--color-orange-500);', "background-image: url(\"data:image/svg+xml,%3Csvg fill='%23f97316'/%3E\");",
      'transition: var(--duration-state) ease-out;', 'TRANSITION-PROPERTY: ALL;', 'transition: color 1s, all 2s;']) {
      expect(sheetViolations(`.otter-x { ${s} }`), s).toHaveLength(1)
    }
    expect(sheetViolations(`.otter-x { color: var(--color-ink); border-bottom: 1px solid var(--color-rule);
      box-shadow: inset 2px 0 0 0 var(--color-signal); background-color: color-mix(in srgb, var(--node-color) 12.5%, transparent);
      transition: background-color var(--duration-state) ease-out, color var(--duration-state) ease-out; }`)).toEqual([])
  })
})

/** A hex from index.css's `@theme`, by name. */
function THEME_HEX(name) {
  const theme = allRules(INDEX).find((r) => /^@theme\b/.test(r.sel))
  const v = decls(theme.body).find(([p]) => p === `--${name}`)?.[1]
  if (!/^#[0-9a-f]{6}$/i.test(v || '')) throw new Error(`@theme --${name} is not a hex: ${v}`)
  return v
}

// =============================================================================
// A4 review round 1 (guards): the reviewer ran 132 mutants on A4's half and
// the suite caught 37. The checks below close the doors it found, reading the
// JSX through a real parse (@babel/parser) instead of a look-back over the
// text, and the kit's rules through the same brace walk as the sheet.
// =============================================================================

const JSX_NAMES = ['Otter.jsx', 'components/CourseBadges.jsx', 'components/CourseFilterChips.jsx',
  'components/CourseRowMenu.jsx', 'components/SidebarCollapse.jsx', 'Validator.jsx',
  'components/RequestsView.jsx', 'components/ChangeRequestDialog.jsx', 'components/ShareCourseDialog.jsx',
  'components/TrashPanel.jsx']
const traverse = traverseModule.default ?? traverseModule
/** The kit element each kit component renders its className onto. */
const KIT_ROOT = { Td: 'ui-td', Th: 'ui-th', Row: 'ui-tr', Button: 'ui-btn', Card: 'ui-card', Badge: 'ui-badge',
  Banner: 'ui-banner', SectionTitle: 'ui-section', Panel: 'ui-panel', Chip: 'ui-chip', Kbd: 'ui-kbd',
  IconButton: 'ui-iconbtn', Tabs: 'ui-tabs', Menu: 'ui-menu', EmptyState: 'ui-empty', Select: 'ui-input',
  Input: 'ui-input', TextArea: 'ui-input', Field: 'ui-field', Dialog: 'ui-dialog', Drawer: 'ui-drawer',
  Toolbar: 'ui-toolbar', Switch: 'ui-switch', Spinner: 'ui-spinner', Loading: 'ui-loading-inline',
  StatusBadge: 'ui-status', StatusDot: 'ui-status-dot', Table: 'ui-table' }
const tagName = (n) => (n.type === 'JSXIdentifier' ? n.name
  : n.type === 'JSXMemberExpression' ? `${tagName(n.object)}.${n.property.name}` : '?')
function staticClasses(attr) {
  const v = attr?.value
  if (!v) return []
  const e = v.type === 'JSXExpressionContainer' ? v.expression : v
  if (e.type === 'StringLiteral') return e.value.split(/\s+/).filter(Boolean)
  if (e.type === 'TemplateLiteral') return e.quasis.map((q) => q.value.cooked).join(' ').split(/\s+/).filter(Boolean)
  return []
}
/** The values a data-* attribute can render: a list, or 'any' when the
 *  expression is not one this can read (React writes a boolean as "true" /
 *  "false"; null, undefined and false-y absence render nothing). */
function exprValues(e) {
  switch (e.type) {
    case 'StringLiteral': return [e.value]
    case 'BooleanLiteral': return [String(e.value)]
    case 'NumericLiteral': return [String(e.value)]
    case 'NullLiteral': return []
    case 'Identifier': return e.name === 'undefined' ? [] : 'any'
    case 'UnaryExpression': return e.operator === '!' ? ['true', 'false'] : 'any'
    case 'BinaryExpression': return ['===', '!==', '==', '!=', '<', '>', '<=', '>='].includes(e.operator) ? ['true', 'false'] : 'any'
    case 'ConditionalExpression': {
      const a = exprValues(e.consequent); const b = exprValues(e.alternate)
      return a === 'any' || b === 'any' ? 'any' : [...a, ...b]
    }
    default: return 'any'
  }
}
function attrValues(attr) {
  const v = attr.value
  if (!v) return ['true']
  if (v.type === 'StringLiteral') return [v.value]
  return exprValues(v.expression)
}
/** Every JSX element: its tag, its static classes, its data-* attributes and
 *  the classes of every JSX element it sits inside (props included — a node
 *  passed as `title` sits inside the element that takes it). */
function jsxElements(src, file) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const out = []
  traverse(ast, {
    JSXElement(p) {
      const o = p.node.openingElement
      const attrs = {}
      const props = new Set()
      let classes = []
      for (const a of o.attributes) {
        if (a.type !== 'JSXAttribute') continue
        const name = typeof a.name.name === 'string' ? a.name.name : ''
        props.add(name)
        if (name === 'className') classes = staticClasses(a)
        else if (name.startsWith('data-') || name.startsWith('aria-')) attrs[name] = attrValues(a)
      }
      const ancestors = []
      const hostKeys = []
      for (let q = p.parentPath; q; q = q.parentPath) {
        if (q.node.type !== 'JSXElement') continue
        const c = q.node.openingElement.attributes.find((x) => x.type === 'JSXAttribute' && x.name.name === 'className')
        ancestors.push(...(c ? staticClasses(c) : []))
        const kitRoot = KIT_ROOT[tagName(q.node.openingElement.name)]
        if (kitRoot) ancestors.push(kitRoot)
        hostKeys.push(`${file}:${q.node.openingElement.loc.start.line}`)
      }
      out.push({ file, line: o.loc.start.line, tag: tagName(o.name), classes, attrs, props, ancestors, hostKeys })
    },
  })
  return out
}
const ELEMENTS = JSX_NAMES.flatMap((f) => jsxElements(readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8'), f))
/** otter class → the kit class on the same element. */
const ON_KIT = new Map()
for (const el of ELEMENTS) {
  const root = KIT_ROOT[el.tag] || el.classes.find((c) => c.startsWith('ui-'))
  if (!root) continue
  for (const c of el.classes) if (c.startsWith('otter-')) ON_KIT.set(c, root)
}
const lastCompound = (sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop()
const stripNot = (s) => s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '')
/** A selector with its first :is() / :where() group expanded into its alternatives. */
function alternatives(s) {
  const m = s.match(/:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/)
  if (!m) return [s]
  return splitTop(m[1]).flatMap((alt) => alternatives(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)))
}
const SHEET_RULES = allRules(RAW).filter((r) => !r.sel.startsWith('@') && !r.parents.some((p) => /^@keyframes/i.test(p)))
const STATES = /:(hover|focus|focus-visible|focus-within|active|disabled|checked|placeholder-shown)\b|::placeholder/
const family = (prop) => prop.replace(/-(left|right|top|bottom|inline|block|start|end)(?=-|$)/g, '').replace(/-(color|width|style)$/, '')
/** Whether any O.T.T.E.R. table passes the kit Table a footer. */
const OTTER_HAS_FOOT = JSX_NAMES.some((f) => /<Table[^>]*\sfoot=/.test(readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8')))
/** The kit's rules in the `components` layer (the one this sheet writes to),
 *  for the dark surface, as { sel, root, spec, fams, states }. */
const KIT_RULES = allRules(INDEX)
  .filter((r) => !r.sel.startsWith('@') && r.parents.some((p) => /^@layer\s+components/.test(p)))
  .flatMap((r) => splitTop(r.sel).flatMap((one) => alternatives(one).map((alt) => ({ one: alt, body: r.body }))))
  .filter(({ one }) => !/data-surface="light"|data-surface='light'/.test(one))
  .filter(({ one }) => !/\[data-(selected|inactive|highlighted|active|interactive|checked|open|over)=/.test(one))
  .filter(({ one }) => !/(^|[\s>+~])tfoot\b/.test(one) || OTTER_HAS_FOOT)
  .map(({ one, body }) => ({
    sel: one, spec: specificity(one), last: lastCompound(one),
    attrs: [...stripNot(lastCompound(one)).matchAll(/\[(data-[\w-]+)\s*=\s*"([^"]*)"\]/g)].map((m) => [m[1], m[2]]),
    needs: (stripNot(one).trim().split(/\s*[\s>+~]\s*/).slice(0, -1).join(' ').match(/\.[\w-]+/g) || []).map((c) => c.slice(1)),
    fams: new Set(decls(body).map(([p]) => family(p))), states: new Set((stripNot(lastCompound(one)).match(STATES) || [])),
  }))

describe('otter.css — the guards A4 review round 1 asked for', () => {
  it('scopes every selector to an O.T.T.E.R. class, so no rule here restyles the kit app-wide', () => {
    // `.ui-dialog-body { display: flex }` would reach every Dialog in the app
    // once O.T.T.E.R. has loaded (review round 1, mutant C1: Import's drop
    // zone went from 510 to 256px wide). Every alternative of every selector
    // names an otter- class (or the lesson's own .lesson-content) outside :not().
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(stripNot(one))) if (!/\.otter-|\.lesson-content/.test(alt)) bad.push(`${alt}   (in ${[...r.parents, r.sel].join(' > ')})`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('never ties or loses to a kit rule on an element it styles — measured by specificity, not by source order', () => {
    // This sheet loads before index.css and both write to `components`, so a
    // rule here must OUTRANK every kit rule that can style the same element
    // with the same property family (a tie goes to the kit). The one-class
    // check above only reads the kit's one-class rules; the Drawer's width is
    // `.ui-drawer[data-width="lg"]` — two parts (review round 1, mutants B1,
    // B2: the settings drawer fell from 576 to 400px). Kit rules for a state
    // this rule does not share (a :hover the kit owns) are left to the kit.
    const bad = []
    for (const r of SHEET_RULES) {
      const fams = new Set(decls(r.body).map(([p]) => family(p)).filter((f) => !f.startsWith('--')))
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          const last = lastCompound(alt)
          const mineStates = new Set((stripNot(last).match(STATES) || []))
          const roots = new Set([
            ...(stripNot(last).match(/\.ui-[\w-]+/g) || []).map((c) => c.slice(1)),
            ...(stripNot(last).match(/\.otter-[\w-]+/g) || []).map((c) => ON_KIT.get(c.slice(1))).filter(Boolean),
          ])
          if (!roots.size) continue
          const mine = specificity(alt)
          const ownOtter = (stripNot(last).match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
          const ancestorOtter = (stripNot(alt).trim().split(/\s*[\s>+~]\s*/).slice(0, -1).join(' ').match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
          const kitHere = (stripNot(last).match(/\.ui-[\w-]+/g) || []).map((c) => c.slice(1))
          const hosts = ownOtter.length
            ? ELEMENTS.filter((e) => ownOtter.some((c) => e.classes.includes(c)))
            : ELEMENTS.filter((e) => kitHere.some((k) => e.classes.includes(k) || KIT_ROOT[e.tag] === k) && ancestorOtter.every((a) => e.ancestors.includes(a)))
          for (const k of KIT_RULES) {
            if (![...roots].some((root) => new RegExp(`\\.${root}(?![\\w-])`).test(k.last))) continue
            if (k.needs.length && hosts.length && !hosts.some((h) => k.needs.every((n) => h.ancestors.includes(n)))) continue
            const MODE = { 'data-wrap': 'wrap', 'data-dense': 'dense', 'data-compact': 'compact', 'data-inline': 'inline', 'data-mixed': 'mixed' }
            const canCarry = (h) => k.attrs.every(([n, v]) => (KIT_ROOT[h.tag] && (!MODE[n] || h.props.has(MODE[n])))
              || (h.attrs[n] !== undefined && (h.attrs[n] === 'any' || h.attrs[n].includes(v))))
            if (k.attrs.length && hosts.length && !hosts.some(canCarry)) continue
            if ([...k.states].some((s) => !mineStates.has(s))) continue
            const shared = [...fams].filter((f) => k.fams.has(f))
            if (shared.length && compareSpecificity(k.spec, mine) >= 0) bad.push(`${alt} { ${shared.join(', ')} } ties or loses to ${k.sel}`)
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('leaves the kit overlays their place in the stack: no position, offset, z-index or transform on them here', () => {
    // The Drawer's top IS the title-bar token (review risk 9) and the layers
    // are the kit's contract (Drawer 59/60, Dialog 70, Menu 80): a `top: 0`
    // on the settings drawer, or a z-index under its backdrop, stayed green
    // (mutants H1, H2).
    const OVERLAYS = ['ui-drawer', 'ui-drawer-backdrop', 'ui-dialog', 'ui-dialog-backdrop', 'ui-menu', 'ui-toast']
    const LAYER = /^(position|top|right|bottom|left|inset(-[\w-]+)?|z-index|transform|translate|scale|rotate)$/
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        const last = stripNot(lastCompound(one))
        const hits = OVERLAYS.filter((o) => new RegExp(`\\.${o}(?![\\w-])`).test(last)
          || (last.match(/\.otter-[\w-]+/g) || []).some((c) => ON_KIT.get(c.slice(1)) === o))
        if (!hits.length) continue
        for (const [p] of decls(r.body)) if (LAYER.test(p)) bad.push(`${one} { ${p} }`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('gives every transition and every animation an instant end under reduced motion, by a rule that wins', () => {
    // A reduced-motion entry must reach the element AND outrank the rule it
    // quiets (the block sits later in the sheet, so a tie wins).
    // `.otter-val-row { transition: none }` lost to
    // `.otter-val-row[data-level='lesson']` and the lesson rows kept their
    // 120ms under reduced motion (review round 1, finding 3); the generation
    // bar's sweep had no entry at all.
    const moving = [], quiet = []
    for (const r of SHEET_RULES) {
      const reduced = r.parents.some((p) => /prefers-reduced-motion/.test(p))
      for (const [p, v] of decls(r.body)) {
        if (!/^(transition|animation)(-name|-duration|-property)?$/.test(p)) continue
        const kind = p.startsWith('transition') ? 'transition' : 'animation'
        for (const one of splitTop(r.sel)) (reduced ? quiet : moving).push({ sel: one, kind, value: v })
      }
    }
    const classesOf = (c) => new Set(c.match(/\.[\w-]+/g) || [])
    const bad = []
    for (const m of moving) {
      if (/^none$/i.test(m.value)) continue
      const mine = classesOf(lastCompound(m.sel))
      const reach = quiet.filter((q) => q.kind === m.kind && /^none$|^0m?s$/i.test(q.value.trim()) && [...classesOf(lastCompound(q.sel))].every((c) => mine.has(c))
        && q.sel.trim().split(/\s*[\s>+~]\s*/).slice(0, -1).every((a) => m.sel.includes(a)))
      if (!reach.length) bad.push(`${m.sel} { ${m.kind}: ${m.value} } — no reduced-motion entry`)
      else if (!reach.some((q) => compareSpecificity(specificity(q.sel), specificity(m.sel)) >= 0)) {
        bad.push(`${m.sel} { ${m.kind} } — its reduced-motion entry loses (${reach.map((q) => q.sel).join(', ')})`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('keys every state on an attribute value the JSX can actually write on that element', () => {
    // A selected search result keyed on `data-active` while the row writes
    // `data-selected` stays green and never shows (mutants F6, F8). For each
    // `.otter-x[data-y='v']`, the elements carrying otter-x must write data-y
    // (or be a kit component that writes it itself) and, where the value is
    // readable, be able to write v.
    const KIT_SRC = (tag) => { try { return readFileSync(fileURLToPath(new URL(`../../ui/${tag}.jsx`, import.meta.url)), 'utf8') } catch { return '' } }
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          for (const compound of alt.split(/\s*[\s>+~]\s*/)) {
            const cls = (stripNot(compound).match(/\.(otter-[\w-]+)/) || [])[1]
            if (!cls) continue
            for (const a of stripNot(compound).matchAll(/\[(data-[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*\]/g)) {
              const [name, value] = [a[1], a[2] ?? a[3] ?? a[4]]
              const els = ELEMENTS.filter((e) => e.classes.includes(cls))
              if (!els.length) continue
              const writes = els.filter((e) => e.attrs[name] !== undefined)
              if (!writes.length) {
                if (els.some((e) => KIT_ROOT[e.tag] && new RegExp(`${name}=`).test(KIT_SRC(e.tag)))) continue
                bad.push(`.${cls}[${name}='${value}'] — no element with otter class ${cls} writes ${name}`)
                continue
              }
              const values = writes.map((e) => e.attrs[name])
              if (values.some((v) => v === 'any')) continue
              if (!values.flat().includes(value)) bad.push(`.${cls}[${name}='${value}'] — the JSX only writes ${[...new Set(values.flat())].join(', ')}`)
            }
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('lifts the third ink wherever a state puts the hover wash or the signal tint behind it — derived from the JSX, not a list', () => {
    // The third ink measures 4.33:1 on the wash over paper, 3.99 over
    // paper-raised and 4.18 on the tint. For each rule that paints one of
    // those behind a state of .otter-x, every otter class nested inside an
    // otter-x element whose own rule sets the third ink needs a rule, in the
    // same state, lifting it to the second ink or the ink — outside any
    // @media but (hover: hover), so a print or touch-only lift does not count
    // (review round 1, mutants A4, A6, A7).
    const TINT = /^var\(--color-(hover|signal-tint)\)$/
    const isIcon = (body) => decls(body).some(([p]) => p === 'width') && decls(body).some(([p]) => p === 'height')
    const thirdInk = new Set(SHEET_RULES.filter((r) => /^\.otter-[\w-]+$/.test(r.sel.trim()) && !isIcon(r.body) && decls(r.body).some(([p, v]) => p === 'color' && v === 'var(--color-ink-3)'))
      .map((r) => r.sel.trim().slice(1)))
    const lifts = SHEET_RULES.filter((r) => r.parents.every((p) => !/^@media/.test(p) || /\(hover:\s*hover\)/.test(p))
      && decls(r.body).some(([p, v]) => p === 'color' && /^var\(--color-ink(-2)?\)$/.test(v)))
      .flatMap((r) => splitTop(r.sel).flatMap((s) => alternatives(s)))
    const stateOf = (compound) => (stripNot(compound).match(/:hover|\[data-[\w-]+=['"]?true['"]?\]/) || [])[0]
    const bad = []
    for (const r of SHEET_RULES) {
      if (!decls(r.body).some(([p, v]) => /^background(-color)?$/.test(p) && TINT.test(v))) continue
      for (const one of splitTop(r.sel)) {
        const last = lastCompound(one)
        const x = (stripNot(last).match(/\.(otter-[\w-]+)/) || [])[1]
        const state = x && stateOf(last)
        if (!state) continue
        const needs = [...stripNot(last).matchAll(/\[(data-[\w-]+)\s*=\s*['"]?([\w-]+)['"]?\]/g)].filter((m) => m[2] !== 'true')
        const hosts = ELEMENTS.filter((e) => e.classes.includes(x) && needs.every(([, n, v]) => { const w = e.attrs[n]; return w === undefined ? false : w === 'any' || w.includes(v) }))
        const hostLines = new Set(hosts.map((h) => `${h.file}:${h.line}`))
        const inside = new Set(ELEMENTS.filter((e) => e.ancestors.includes(x) && (needs.length === 0 || e.hostKeys?.some((k) => hostLines.has(k)))).flatMap((e) => e.classes).filter((c) => thirdInk.has(c)))
        for (const d of inside) {
          const ok = lifts.some((l) => l.includes(`.${x}`) && stripNot(l).includes(state) && lastCompound(l).includes(`.${d}`))
          if (!ok) bad.push(`${one} puts the wash or the tint behind .${d} (third ink) with no lift in that state`)
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('keeps the pet out of this sheet (C5): no selector names the companion\'s own classes', () => {
    // The pet's classes are otter- too (otter-bob, otter-blink…), so a rule
    // here — a reduced-motion block, say — could stop its animations and no
    // other guard reads this sheet for them (mutants H13, H14).
    const petSrc = ['../../components/PetCompanion.jsx', '../../components/sprites/index.jsx']
      .map((p) => { try { return readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8') } catch { return '' } }).join('\n')
    const pet = new Set(petSrc.match(/\botter-[a-z][\w-]*/g) || [])
    expect(pet.size, 'the pet\'s classes were read').toBeGreaterThan(0)
    const named = SHEET_RULES.flatMap((r) => splitTop(r.sel)).flatMap((s) => (s.match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1)))
    const bad = [...new Set(named.filter((c) => pet.has(c)))]
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('writes type, case, grounds and motion only in the system\'s own terms', () => {
    // Round one's nits, each a mutant that stayed green: a font size worked
    // out below the 11px floor, `capitalize`, the ink as a GROUND (C9), a
    // literal duration, a thick border keyword, a named colour in `filter`.
    const bad = []
    for (const r of SHEET_RULES) {
      for (const [p, v] of decls(r.body)) {
        if (p === 'font-size' && !/^(var\(--text-[\w-]+\)|inherit|calc\(var\(--text-[\w-]+\) \* var\(--mono-size-adjust\)\)|max\(var\(--text-label\), calc\(var\(--text-label\) \* var\(--mono-size-adjust\)\)\))$/.test(v)) bad.push(`${r.sel} { font-size: ${v} }`)
        if (p === 'text-transform' && !/^(uppercase|none)$/.test(v)) bad.push(`${r.sel} { text-transform: ${v} }`)
        if (/^background(-color)?$/.test(p) && /var\(--color-ink\)/.test(v)) bad.push(`${r.sel} { ${p}: ${v} } — the ink is not a ground (C9)`)
        if (/^transition(-duration)?$/.test(p) && /(^|[\s,(])[\d.]+m?s\b/.test(v)) bad.push(`${r.sel} { ${p}: ${v} } — a literal duration`)
        if (/^border(-[\w-]+)?-width$|^border(-(top|right|bottom|left))?$/.test(p) && /\b(thick|medium)\b/.test(v)) bad.push(`${r.sel} { ${p}: ${v} }`)
        if (/^(filter|backdrop-filter|border-image(-source)?|mask(-image)?)$/.test(p) && !/^none$/.test(v)) bad.push(`${r.sel} { ${p}: ${v} }`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('names the Search dialog: its title is the field, so the Dialog carries aria-label "Search" (A4-KR-1)', () => {
    const search = ELEMENTS.find((e) => e.tag === 'Dialog' && e.classes.includes('otter-search-dialog'))
    expect(search, 'the Search dialog was found').toBeTruthy()
    expect(search.attrs['aria-label']).toEqual(['Search'])
  })

  it('never puts two otter classes whose one-class rules set the same property on one element', () => {
    // The later rule wins by source order, which is an accident waiting: a
    // settled request was `otter-req otter-req-head` and the head's
    // `border: 0` erased the card's edge (review round 1, visual finding 3).
    const oneClass = new Map()
    for (const r of SHEET_RULES) {
      if (r.parents.some((p) => /^@media/.test(p))) continue
      for (const one of splitTop(r.sel)) {
        const m = one.trim().match(/^\.(otter-[\w-]+)$/)
        if (!m) continue
        const fams = oneClass.get(m[1]) || new Set()
        for (const [p] of decls(r.body)) fams.add(family(p))
        oneClass.set(m[1], fams)
      }
    }
    const bad = new Set()
    for (const e of ELEMENTS) {
      const mine = e.classes.filter((c) => oneClass.has(c))
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const shared = [...oneClass.get(mine[i])].filter((f) => oneClass.get(mine[j]).has(f))
          if (shared.length) bad.add(`.${mine[i]} and .${mine[j]} (${e.file}:${e.line}) both set ${shared.join(', ')}`)
        }
      }
    }
    expect([...bad], [...bad].join('\n')).toEqual([])
  })

  it('CONTROL: each new guard fires on what it forbids', () => {
    // A throwaway sheet run through the same readers.
    const probe = (css) => allRules(`@layer components { ${css} }`).filter((r) => !r.sel.startsWith('@'))
    const unscoped = probe('.ui-dialog-body { padding: 0 }').flatMap((r) => splitTop(r.sel)).filter((s) => !/\.otter-|\.lesson-content/.test(stripNot(s)))
    expect(unscoped).toEqual(['.ui-dialog-body'])
    expect(compareSpecificity(specificity('.ui-drawer[data-width="lg"]'), specificity('.ui-drawer.otter-x'))).toBe(0)
    expect(compareSpecificity(specificity('.ui-drawer.otter-x[data-width]'), specificity('.ui-drawer[data-width="lg"]'))).toBeGreaterThan(0)
    expect(ON_KIT.get('otter-search-dialog'), 'the parse maps the Search dialog\'s class to the kit Dialog').toBe('ui-dialog')
    expect(ON_KIT.get('otter-share-nominate')).toBe('ui-card')
    expect(ELEMENTS.find((e) => e.classes.includes('otter-search-result'))?.attrs['data-active']).toEqual(['true', 'false'])
  })
})
