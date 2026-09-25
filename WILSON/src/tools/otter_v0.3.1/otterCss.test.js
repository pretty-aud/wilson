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
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allRules, decls, splitTop, themeNames, specificity, compareSpecificity } from '../../../scripts/ui-css-rules.mjs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { cssCounts } from '../../../scripts/ui-audit.mjs'
import { contrast, hexToRgb, rgbToHex, luminance, over, parseRgba } from '../../ui/contrast.js'

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
    // Round 2: longhand to longhand, so `overflow-y` here meets the kit's
    // `overflow` (mutant N16).
    const kitProps = (root) => new Set(kit.filter((r) => splitTop(r.sel).includes(`.${root}`)).flatMap((r) => [...longhandsOf(r.body)]))
    const bad = []
    for (const r of allRules(RAW)) {
      for (const one of splitTop(r.sel)) {
        const m = one.match(/^\.(otter-[\w-]+)$/)
        if (!m || !onKit.has(m[1])) continue
        const props = kitProps(onKit.get(m[1]))
        const tie = [...longhandsOf(r.body)].filter((p) => props.has(p))
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
      for (const one of splitTop(r.sel)) for (const x of expand(one)) lifted.add(norm(x))
    }
    // Quotes as the sheet writes them: the kit's `[data-active="true"]` is the
    // same selector (round 2, FP1).
    const missing = LIFTS.map(([state, text]) => norm(`${state} ${text}`)).filter((s) => !lifted.has(s))
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
//
// A4 review round 2 (guards) re-ran them (91 died) and added 32; what lived
// showed where these readers still trusted too much. Each door is closed at
// its check below; the three that run through everything are:
//  - an attribute written from a variable, a field or a call read as "any
//    value", so a state keyed on a value nothing writes stayed green (F1, F3,
//    F4, F7 and 24 generated states). Values are now worked out (valuesOf):
//    a const through its initialiser, a useState value through its setter's
//    calls, a local function through its returns, a test as true / false;
//    what stays unread (a field of data) may only be a word the file names;
//  - the kit's own attributes came from a closed list of five "modes", so a
//    new kit mode failed this file (FP4) and a kit part went unread (S08,
//    FP3: the guard looked for a Row.jsx that does not exist). They are read
//    from the kit's JSX (KIT), with the props each O.T.T.E.R. use passes;
//  - properties were compared by family, so `overflow-y` never met the kit's
//    `overflow` (N16) and `border-top` met `border-bottom` (FP2). They are
//    compared longhand to longhand (longhands).
// =============================================================================

const OTTER_DIR = new URL('./', import.meta.url)
const JSX_NAMES = ['Otter.jsx', 'components/CourseBadges.jsx', 'components/CourseFilterChips.jsx',
  'components/CourseRowMenu.jsx', 'components/SidebarCollapse.jsx', 'Validator.jsx',
  'components/RequestsView.jsx', 'components/ChangeRequestDialog.jsx', 'components/ShareCourseDialog.jsx',
  'components/TrashPanel.jsx']
const traverse = traverseModule.default ?? traverseModule
const PARSE = (src) => parse(src, { sourceType: 'module', plugins: ['jsx'] })
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
/** A selector with its quotes as the sheet writes them (`[x="v"]` is `[x='v']`)
 *  and its spaces collapsed, so two spellings of one selector compare equal
 *  (round 2, FP1: the kit's double quotes failed a lift that was there). */
const norm = (s) => s.replace(/\[([\w-]+)\s*=\s*"([^"]*)"\s*\]/g, "[$1='$2']").replace(/\s+/g, ' ').trim()

// ── What an attribute can render ─────────────────────────────────────────────
/** The words a file names: its string literals and its object keys. A value
 *  read from data (`item.status`) can only be one the file names. */
const WORDS = new Map()
function collectWords(file, ast) {
  const w = new Set()
  traverse(ast, {
    StringLiteral(p) { w.add(p.node.value) },
    ObjectProperty(p) { if (!p.node.computed && p.node.key.type === 'Identifier') w.add(p.node.key.name) },
  })
  WORDS.set(file, w)
}
/** The values an expression can render as an attribute: the strings it can
 *  be (and which of them are false-y in JS: false, 0, ''), the files whose
 *  words it may be besides (a value read from data), and whether it can be
 *  absent. React writes true / false as "true" / "false" and null /
 *  undefined as no attribute. */
const known = (list, nullish = false, falsy = []) => ({ vals: new Set(list), falsy: new Set(falsy), open: new Set(), nullish })
const literal = (v) => known([String(v)], false, v ? [] : [String(v)])
const absent = () => known([], true)
const unread = (file) => ({ vals: new Set(), falsy: new Set(), open: new Set([file]), nullish: true })
const either = (...xs) => ({ vals: new Set(xs.flatMap((x) => [...x.vals])), falsy: new Set(xs.flatMap((x) => [...x.falsy])),
  open: new Set(xs.flatMap((x) => [...x.open])), nullish: xs.some((x) => x.nullish) })
const canBe = (x, v) => !!x && (x.vals.has(v) || [...x.open].some((f) => WORDS.get(f)?.has(v)))
const renders = (x) => !!x && (x.vals.size > 0 || x.open.size > 0)
/** As a test: can it be truthy, can it be false-y. */
const truthy = (x) => x.open.size > 0 || [...x.vals].some((v) => !x.falsy.has(v))
const falsey = (x) => x.nullish || x.falsy.size > 0 || x.open.size > 0
const onlyTruthy = (x) => ({ ...x, vals: new Set([...x.vals].filter((v) => !x.falsy.has(v))), falsy: new Set(), nullish: false })
const show = (x) => [...[...x.vals].map((v) => `'${v}'`), ...[...x.open].map((f) => `a word of ${f}`)].join(', ') || 'nothing'
const BOOLEAN = () => known(['true', 'false'], false, ['false'])
const TESTS = new Set(['has', 'includes', 'some', 'every', 'startsWith', 'endsWith', 'test', 'contains', 'hasOwnProperty', 'matches'])
const isUseState = (n) => n?.type === 'CallExpression'
  && ((n.callee.type === 'Identifier' && n.callee.name === 'useState') || (n.callee.type === 'MemberExpression' && n.callee.property?.name === 'useState'))
const context = (file, more = {}) => ({ file, seen: new Set(), ...more })
function functionOf(b) {
  const d = b?.path
  if (!d) return null
  if (d.isFunctionDeclaration()) return d
  if (d.isVariableDeclarator() && d.node.id.type === 'Identifier' && /^(ArrowFunctionExpression|FunctionExpression)$/.test(d.node.init?.type || '')) return d.get('init')
  return null
}
function returnsOf(fn, ctx, depth) {
  if (fn.isArrowFunctionExpression() && !fn.get('body').isBlockStatement()) return valuesOf(fn.get('body'), ctx, depth)
  const all = []
  fn.get('body').traverse({
    Function(q) { q.skip() },
    ReturnStatement(q) { all.push(q.node.argument ? valuesOf(q.get('argument'), ctx, depth) : absent()) },
  })
  return all.length ? either(...all) : absent()
}
function bindingValues(b, ctx, depth) {
  if (ctx.seen.has(b.identifier)) return absent()
  ctx.seen.add(b.identifier)
  try {
    if (b.kind === 'param') return ctx.param?.(b, depth) ?? unread(ctx.file)
    const d = b.path
    if (!d.isVariableDeclarator()) return unread(ctx.file)
    const id = d.node.id
    if (id.type === 'Identifier') {
      const all = [d.node.init ? valuesOf(d.get('init'), ctx, depth) : absent()]
      for (const v of b.constantViolations) {
        all.push(v.isAssignmentExpression() && v.node.operator === '=' ? valuesOf(v.get('right'), ctx, depth) : unread(ctx.file))
      }
      return either(...all)
    }
    if (id.type === 'ArrayPattern' && isUseState(d.node.init) && id.elements[0] === b.identifier) {
      // A state: what it starts as, and every value its setter is called with.
      const init = d.get('init.arguments.0')
      const all = [!init.node ? absent() : init.isFunction() ? returnsOf(init, ctx, depth) : valuesOf(init, ctx, depth)]
      const setter = id.elements[1]?.type === 'Identifier' ? d.scope.getBinding(id.elements[1].name) : null
      for (const ref of setter?.referencePaths || []) {
        const call = ref.parentPath
        if (!call.isCallExpression() || call.node.callee !== ref.node) { all.push(unread(ctx.file)); continue }
        const arg = call.get('arguments.0')
        all.push(!arg.node ? absent() : arg.isFunction() ? returnsOf(arg, ctx, depth) : valuesOf(arg, ctx, depth))
      }
      return either(...all)
    }
    return unread(ctx.file)
  } finally {
    ctx.seen.delete(b.identifier)
  }
}
function valuesOf(p, ctx, depth = 0) {
  const e = p?.node
  if (!e) return absent()
  if (depth > 24) return unread(ctx.file)
  const next = (q) => valuesOf(q, ctx, depth + 1)
  switch (e.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return literal(e.value)
    case 'NullLiteral': return absent()
    case 'TemplateLiteral': return e.expressions.length ? unread(ctx.file) : literal(e.quasis[0].value.cooked)
    case 'JSXExpressionContainer': case 'ParenthesizedExpression': return next(p.get('expression'))
    case 'UnaryExpression': return e.operator === '!' ? BOOLEAN() : e.operator === 'void' ? absent() : unread(ctx.file)
    case 'BinaryExpression': return /^(===|!==|==|!=|<|>|<=|>=|in|instanceof)$/.test(e.operator) ? BOOLEAN() : unread(ctx.file)
    case 'LogicalExpression': {
      const l = next(p.get('left'))
      if (e.operator === '??') return l.nullish ? either({ ...l, nullish: false }, next(p.get('right'))) : l
      if (e.operator === '&&') return !truthy(l) ? l : !falsey(l) ? next(p.get('right')) : either(l, next(p.get('right')))
      return !falsey(l) ? l : !truthy(l) ? next(p.get('right')) : either(onlyTruthy(l), next(p.get('right')))
    }
    case 'ConditionalExpression': {
      // A test that is never true (a prop no use passes, or passes false —
      // Toolbar's `wrap = false`) takes the other branch, and one never false
      // takes this one.
      const t = next(p.get('test'))
      if (!truthy(t)) return next(p.get('alternate'))
      if (!falsey(t)) return next(p.get('consequent'))
      return either(next(p.get('consequent')), next(p.get('alternate')))
    }
    case 'CallExpression': {
      const c = e.callee
      if (c.type === 'MemberExpression' && !c.computed && TESTS.has(c.property.name)) return BOOLEAN()
      if (c.type === 'Identifier' && c.name === 'Boolean') return BOOLEAN()
      if (c.type === 'Identifier') {
        const fn = functionOf(p.scope.getBinding(c.name))
        if (fn) return returnsOf(fn, ctx, depth + 1)
      }
      return unread(ctx.file)
    }
    case 'Identifier': {
      if (e.name === 'undefined') return absent()
      const b = p.scope.getBinding(e.name)
      return b ? bindingValues(b, ctx, depth + 1) : unread(ctx.file)
    }
    case 'MemberExpression': case 'OptionalMemberExpression': return ctx.member?.(p, depth + 1) ?? unread(ctx.file)
    default: return unread(ctx.file)
  }
}
/** The values a JSX attribute (a path) renders; a bare attribute is "true". */
function attrValues(a, ctx) {
  const v = a.get('value')
  return v.node ? valuesOf(v, ctx) : literal(true)
}

// ── The O.T.T.E.R. JSX ───────────────────────────────────────────────────────
const functionName = (f) => f.node.id?.name
  || (f.parentPath?.isVariableDeclarator() && f.parentPath.node.id.type === 'Identifier' ? f.parentPath.node.id.name : null)
/** The nearest enclosing function with a name: the render function a node is
 *  built in (an arrow in a .map() has none, so the one around it counts). */
function namedFunction(p) {
  for (let f = p.getFunctionParent(); f; f = f.parentPath?.getFunctionParent()) {
    const n = functionName(f)
    if (n) return n
  }
  return null
}
/** Every JSX element: its tag, its static classes, the values of its data-*
 *  and aria-* attributes, the props it passes (and their paths), the classes
 *  of every JSX element it sits inside (props included — a node passed as
 *  `title` sits inside the element that takes it), and its render function. */
function jsxElements(src, file) {
  const ast = PARSE(src)
  collectWords(file, ast)
  const out = []
  traverse(ast, {
    JSXElement(p) {
      const o = p.node.openingElement
      const attrs = {}
      const props = new Set()
      const propPaths = new Map()
      let classes = []
      for (const a of p.get('openingElement.attributes')) {
        if (!a.isJSXAttribute()) continue
        const name = typeof a.node.name.name === 'string' ? a.node.name.name : ''
        props.add(name)
        propPaths.set(name, a)
        if (name === 'className') classes = staticClasses(a.node)
        else if (/^(data|aria)-/.test(name)) attrs[name] = attrValues(a, context(file))
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
      out.push({ file, line: o.loc.start.line, tag: tagName(o.name), classes, attrs, props, propPaths, ancestors, hostKeys, fn: namedFunction(p) })
    },
  })
  return { out, ast }
}
const PARSED = JSX_NAMES.map((f) => ({ f, ...jsxElements(readFileSync(fileURLToPath(new URL(`./${f}`, OTTER_DIR)), 'utf8'), f) }))
const ELEMENTS = PARSED.flatMap((x) => x.out)
/** otter class → the kit class on the same element. */
const ON_KIT = new Map()
for (const el of ELEMENTS) {
  const root = KIT_ROOT[el.tag] || el.classes.find((c) => c.startsWith('ui-'))
  if (!root) continue
  for (const c of el.classes) if (c.startsWith('otter-')) ON_KIT.set(c, root)
}

// ── The kit's JSX ────────────────────────────────────────────────────────────
/** Each kit component, read from src/ui: the host elements it renders, with
 *  their tag, their ui- classes, the paths of their data-* / aria-* attributes,
 *  whether the caller's className lands there and whether props spread there. */
const KIT_DIR = new URL('../../ui/', import.meta.url)
const KIT = new Map()
const componentName = (f) => {
  const n = f.node.id?.name
    || (f.parentPath.isVariableDeclarator() ? f.parentPath.node.id.name : null)
    || (f.parentPath.isCallExpression() && f.parentPath.parentPath.isVariableDeclarator() ? f.parentPath.parentPath.node.id.name : null)
  return typeof n === 'string' && /^[A-Z]/.test(n) ? n : null
}
function uiClassesIn(a) {
  const out = []
  const take = (s) => out.push(...s.split(/\s+/).filter((c) => /^ui-[\w-]+$/.test(c)))
  const v = a.get('value')
  if (v.isStringLiteral()) take(v.node.value)
  else v.traverse({ StringLiteral(q) { take(q.node.value) }, TemplateElement(q) { take(q.node.value.cooked) } })
  return out
}
function mentions(a, name) {
  let hit = false
  const v = a.get('value')
  if (v.node) v.traverse({ Identifier(q) { if (q.node.name === name) hit = true } })
  return hit
}
for (const f of readdirSync(fileURLToPath(KIT_DIR)).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n))) {
  const file = `src/ui/${f}`
  const ast = PARSE(readFileSync(new URL(f, KIT_DIR), 'utf8'))
  collectWords(file, ast)
  traverse(ast, {
    Function(fp) {
      const name = componentName(fp)
      if (!name || KIT.has(name)) return
      const hosts = []
      fp.traverse({
        JSXElement(ep) {
          // Every element, a capitalised one too: SectionTitle's title is
          // `<As className="ui-section-title">`, a tag chosen by a prop.
          const o = ep.node.openingElement
          if (o.name.type !== 'JSXIdentifier') return
          const h = { tag: o.name.name, classes: [], attrs: new Map(), takesClassName: false, spreads: false }
          for (const a of ep.get('openingElement.attributes')) {
            if (a.isJSXSpreadAttribute()) { h.spreads = true; continue }
            const n = a.node.name.name
            if (n === 'className') { h.classes = uiClassesIn(a); h.takesClassName = mentions(a, 'className') }
            else if (typeof n === 'string' && /^(data|aria)-/.test(n)) h.attrs.set(n, a)
          }
          hosts.push(h)
        },
      })
      KIT.set(name, { file, fn: fp, hosts })
    },
  })
}
const REST = Symbol('the rest of the props')
/** Which prop a kit component's parameter binding reads: { key, fallback },
 *  REST for the props object itself, or null (a ref, a callback's own). */
function propOf(fn, b) {
  const param = fn.get('params.0')
  if (!param.node) return null
  if (param.isIdentifier()) return param.node === b.identifier ? REST : null
  if (!param.isObjectPattern()) return null
  for (const q of param.get('properties')) {
    if (q.isRestElement()) { if (q.node.argument === b.identifier) return REST; continue }
    const key = q.node.key.name ?? q.node.key.value
    const v = q.get('value')
    if (v.node === b.identifier) return { key }
    if (v.isAssignmentPattern() && v.node.left === b.identifier) return { key, fallback: v.get('right') }
  }
  return null
}
/** The kit component's code, read with the props one O.T.T.E.R. use passes. */
function kitContext(comp, use) {
  const ctx = context(comp.file, {
    param(b, depth) {
      const prop = propOf(comp.fn, b)
      if (!prop || prop === REST) return undefined
      if (use.propPaths.has(prop.key)) return attrValues(use.propPaths.get(prop.key), context(use.file))
      return prop.fallback ? valuesOf(prop.fallback, ctx, depth) : absent()
    },
    member(mp) {
      const obj = mp.get('object')
      if (!obj.isIdentifier()) return null
      const b = mp.scope.getBinding(obj.node.name)
      if (!b || b.kind !== 'param' || propOf(comp.fn, b) !== REST) return null
      const key = mp.node.computed ? (mp.node.property.type === 'StringLiteral' ? mp.node.property.value : null) : mp.node.property.name
      if (key == null) return null
      return use.propPaths.has(key) ? attrValues(use.propPaths.get(key), context(use.file)) : absent()
    },
  })
  return ctx
}
/** What one O.T.T.E.R. element renders for an attribute: a host element's
 *  own; a kit component's, on its root (or on one of its parts), read from
 *  the kit's JSX with the props this use passes — and whatever it passes that
 *  the kit spreads there. Any other component (an icon) is taken to pass its
 *  data-* and aria-* props through, as lucide's do. null: nothing here can
 *  write it. */
function elementAttr(el, attr, part = null) {
  const comp = KIT.get(el.tag)
  if (!comp) return part ? null : el.attrs[attr] ?? null
  const found = []
  for (const h of comp.hosts.filter((x) => (part ? x.classes.includes(part) : x.takesClassName))) {
    const a = h.attrs.get(attr)
    if (a) found.push(attrValues(a, kitContext(comp, el)))
    if (h.spreads && !part && el.attrs[attr]) found.push(el.attrs[attr])
  }
  return found.length ? either(...found) : null
}
/** Every kit class an element renders: its own ui- classes, and every class
 *  of every host element in the kit component it is. */
const rendersKit = (el) => new Set([...el.classes.filter((c) => c.startsWith('ui-')), ...(KIT.get(el.tag)?.hosts.flatMap((h) => h.classes) || [])])

// ── Selectors and properties ─────────────────────────────────────────────────
const lastCompound = (sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop()
const compoundsOf = (sel) => sel.trim().split(/\s*[\s>+~]\s*/)
const stripNot = (s) => s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '')
/** A selector with its first :is() / :where() group expanded into its alternatives. */
function alternatives(s) {
  const m = s.match(/:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/)
  if (!m) return [s]
  return splitTop(m[1]).flatMap((alt) => alternatives(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)))
}
/** The simple selectors of a compound, quotes as the sheet writes them. */
const simples = (compound) => (norm(compound).match(/\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|^[a-z][\w-]*|\*/gi) || [])
/** The attribute conditions of a compound (outside :not()): name, and value or null. */
const attrConds = (compound) => [...stripNot(compound).matchAll(/\[((?:data|aria)-[\w-]+)(?:\s*(=|~=|\|=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\s*\]/g)]
  .map((m) => ({ name: m[1], value: m[2] === '=' ? (m[3] ?? m[4] ?? m[5]) : null }))
const SIDES = ['top', 'right', 'bottom', 'left']
const LOGICAL = { block: ['top', 'bottom'], inline: ['left', 'right'], 'block-start': ['top'], 'block-end': ['bottom'], 'inline-start': ['left'], 'inline-end': ['right'] }
const SHORTHANDS = {
  inset: SIDES, 'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => `border-${c}-radius`),
  outline: ['outline-width', 'outline-style', 'outline-color'], overflow: ['overflow-x', 'overflow-y'],
  gap: ['row-gap', 'column-gap'], 'grid-gap': ['row-gap', 'column-gap'], flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'], 'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'], 'place-self': ['align-self', 'justify-self'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'], columns: ['column-width', 'column-count'],
  'grid-row': ['grid-row-start', 'grid-row-end'], 'grid-column': ['grid-column-start', 'grid-column-end'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
}
/** The longhands a declaration sets (horizontal writing, left to right), so
 *  `overflow-y` meets `overflow` and `border-top` does not meet `border-bottom`. */
function longhands(prop) {
  const p = prop.toLowerCase()
  let m
  if (SHORTHANDS[p]) return SHORTHANDS[p]
  if ((m = p.match(/^(margin|padding|scroll-margin|scroll-padding)$/))) return SIDES.map((s) => `${m[1]}-${s}`)
  if ((m = p.match(/^(margin|padding|scroll-margin|scroll-padding|inset)-(block|inline)(-start|-end)?$/))) {
    return LOGICAL[m[2] + (m[3] || '')].map((s) => (m[1] === 'inset' ? s : `${m[1]}-${s}`))
  }
  if (p === 'border') return ['width', 'style', 'color'].flatMap((k) => SIDES.map((s) => `border-${s}-${k}`))
  if ((m = p.match(/^border-(top|right|bottom|left)$/))) return ['width', 'style', 'color'].map((k) => `border-${m[1]}-${k}`)
  if ((m = p.match(/^border-(width|style|color)$/))) return SIDES.map((s) => `border-${s}-${m[1]}`)
  if ((m = p.match(/^border-(block|inline)(-start|-end)?(-width|-style|-color)?$/))) {
    return LOGICAL[m[1] + (m[2] || '')].flatMap((s) => (m[3] ? [m[3].slice(1)] : ['width', 'style', 'color']).map((k) => `border-${s}-${k}`))
  }
  if ((m = p.match(/^(min-|max-)?(block|inline)-size$/))) return [`${m[1] || ''}${m[2] === 'block' ? 'height' : 'width'}`]
  return [p]
}
const longhandsOf = (body) => new Set(decls(body).filter(([p]) => !p.startsWith('--')).flatMap(([p]) => longhands(p)))

const SHEET_RULES = allRules(RAW).filter((r) => !r.sel.startsWith('@') && !r.parents.some((p) => /^@keyframes/i.test(p)))
/** A rule's place in the cascade: the sheet is one layer, so a later rule wins a tie. */
const ORDER = new Map(SHEET_RULES.map((r, i) => [r, i]))
const STATES = /:(hover|focus|focus-visible|focus-within|active|disabled|checked|placeholder-shown)\b|::placeholder/
/** Whether any O.T.T.E.R. table passes the kit Table a footer. */
const OTTER_HAS_FOOT = ELEMENTS.some((e) => e.tag === 'Table' && e.props.has('foot'))
/** The kit's rules in the `components` layer (the one this sheet writes to),
 *  for the dark surface. */
const KIT_RULES = allRules(INDEX)
  .filter((r) => !r.sel.startsWith('@') && r.parents.some((p) => /^@layer\s+components/.test(p)))
  .flatMap((r) => splitTop(r.sel).flatMap((one) => alternatives(one).map((alt) => ({ one: alt, body: r.body }))))
  .filter(({ one }) => !/data-surface="light"|data-surface='light'/.test(one))
  .filter(({ one }) => !/\[data-(selected|inactive|highlighted|active|interactive|checked|open|over)=/.test(one))
  .filter(({ one }) => !/(^|[\s>+~])tfoot\b/.test(one) || OTTER_HAS_FOOT)
  .map(({ one, body }) => ({
    sel: one, spec: specificity(one), last: lastCompound(one),
    attrs: attrConds(lastCompound(one)),
    type: (stripNot(lastCompound(one)).match(/^([a-z][\w-]*)/) || [])[1] || null,
    needs: (stripNot(one).trim().split(/\s*[\s>+~]\s*/).slice(0, -1).join(' ').match(/\.[\w-]+/g) || []).map((c) => c.slice(1)),
    props: longhandsOf(body), states: new Set((stripNot(lastCompound(one)).match(STATES) || [])),
  }))
const hasClass = (compound, c) => new RegExp(`\\.${c}(?![\\w-])`).test(compound)

describe('otter.css — the guards A4 review rounds 1 and 2 asked for', () => {
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

  it('styles a kit part only through the O.T.T.E.R. class on the component that renders it', () => {
    // Any otter- ancestor was enough: `.otter-root .ui-dialog-body` restyled
    // every O.T.T.E.R. dialog at once and Import's drop zone went from 510 to
    // 256px again (round 2, mutant N1 — round 1's C1, O.T.T.E.R.-wide). A kit
    // PART (a class inside a component that is not where its className
    // lands: a dialog's body, a card's title, a tab) must be rendered by an
    // element that carries one of the selector's own otter classes. A kit
    // component's ROOT may still be reached through a container of its own
    // (`.otter-course-list .ui-iconbtn`): that is how A3 scoped its buttons,
    // and the container is what the rule is about.
    const roots = new Set([...KIT.values()].flatMap((c) => c.hosts.filter((h) => h.takesClassName).flatMap((h) => h.classes)))
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(stripNot(one))) {
          const mine = (alt.match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
          const covered = new Set(ELEMENTS.filter((e) => mine.some((c) => e.classes.includes(c))).flatMap((e) => [...rendersKit(e)]))
          const loose = [...new Set((alt.match(/\.ui-[\w-]+/g) || []).map((c) => c.slice(1)))].filter((c) => !roots.has(c) && !covered.has(c))
          if (loose.length) bad.push(`${alt.trim()} — ${loose.map((c) => `.${c}`).join(', ')} is not rendered by an element with its otter class`)
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('never ties or loses to a kit rule on an element it styles — measured by specificity, not by source order', () => {
    // This sheet loads before index.css and both write to `components`, so a
    // rule here must OUTRANK every kit rule that can style the same element
    // with the same property (a tie goes to the kit). The one-class check
    // above only reads the kit's one-class rules; the Drawer's width is
    // `.ui-drawer[data-width="lg"]` — two parts (review round 1, mutants B1,
    // B2: the settings drawer fell from 576 to 400px). Kit rules for a state
    // this rule does not share (a :hover the kit owns) are left to the kit.
    // Round 2: properties meet longhand to longhand (N16: `overflow-y: auto`
    // lost to the card's `overflow: hidden`); whether an element can carry a
    // kit rule's attribute is read from the kit's JSX, not a list of five
    // modes (FP4: a new inset Banner failed nine rules no inset Banner meets);
    // and a type selector is resolved to the kit elements it can reach (N17:
    // `.otter-quiz-bar button` sized the tabs and lost).
    const bad = []
    for (const r of SHEET_RULES) {
      const props = longhandsOf(r.body)
      for (const one of splitTop(r.sel)) {
        const mine = specificity(one)
        for (const alt of alternatives(one)) {
          const last = lastCompound(alt)
          const bare = stripNot(last)
          const mineStates = new Set((bare.match(STATES) || []))
          const ownOtter = (bare.match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
          const kitHere = (bare.match(/\.ui-[\w-]+/g) || []).map((c) => c.slice(1))
          const ancestorOtter = (stripNot(alt).trim().split(/\s*[\s>+~]\s*/).slice(0, -1).join(' ').match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
          const under = (e) => ancestorOtter.every((a) => e.ancestors.includes(a))
          // What the last compound reaches: [kit class, the O.T.T.E.R. element, the kit part or null].
          const targets = []
          if (ownOtter.length) {
            for (const e of ELEMENTS.filter((x) => ownOtter.some((c) => x.classes.includes(c)))) {
              const root = KIT_ROOT[e.tag] || e.classes.find((c) => c.startsWith('ui-'))
              if (root) targets.push([root, e, null])
              for (const k of kitHere) if (k !== root && rendersKit(e).has(k)) targets.push([k, e, k])
            }
          } else if (kitHere.length) {
            for (const k of kitHere) {
              for (const e of ELEMENTS.filter(under)) {
                if (KIT_ROOT[e.tag] === k || e.classes.includes(k)) targets.push([k, e, null])
                else if (KIT.get(e.tag)?.hosts.some((h) => h.classes.includes(k))) targets.push([k, e, k])
              }
            }
          } else {
            const type = (bare.match(/^([a-z][\w-]*)/) || [])[1]
            if (!type) continue
            for (const e of ELEMENTS.filter((x) => KIT.has(x.tag) && (under(x) || ancestorOtter.every((a) => x.ancestors.includes(a) || x.classes.includes(a))))) {
              for (const h of KIT.get(e.tag).hosts) {
                if (h.tag !== type) continue
                for (const k of h.classes) targets.push([k, e, h.takesClassName ? null : k])
              }
            }
          }
          if (!targets.length) continue
          const seen = new Set()
          for (const k of KIT_RULES) {
            if ([...k.states].some((s) => !mineStates.has(s))) continue
            const shared = [...props].filter((p) => k.props.has(p))
            if (!shared.length || compareSpecificity(k.spec, mine) < 0) continue
            const reach = targets.filter(([cls, e, part]) => {
              if (!hasClass(k.last, cls) && !(k.type && !/\./.test(stripNot(k.last)) && k.type === (stripNot(last).match(/^([a-z][\w-]*)/) || [])[1])) return false
              const around = new Set([...e.ancestors, ...(part ? rendersKit(e) : [])])
              if (k.needs.some((n) => !around.has(n))) return false
              return k.attrs.every(({ name, value }) => { const x = elementAttr(e, name, part); return value === null ? renders(x) : canBe(x, value) })
            })
            if (!reach.length) continue
            const line = `${alt.trim()} { ${shared.join(', ')} } ties or loses to ${k.sel}`
            if (!seen.has(line)) { seen.add(line); bad.push(line) }
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('leaves the kit overlays their place, their frame and their size: nothing here moves them or anything they sit in', () => {
    // The Drawer's top IS the title-bar token (review risk 9) and the layers
    // are the kit's contract (Drawer 59/60, Dialog 70, Menu 80): a `top: 0`
    // on the settings drawer, or a z-index under its backdrop, stayed green
    // (mutants H1, H2). Round 2: the drawer's block axis is the window less
    // the title bar — a negative margin put its top under the title bar (N2)
    // and `height: 100vh` pushed its foot 32px off the window (N3).
    const OVERLAYS = ['ui-drawer', 'ui-drawer-backdrop', 'ui-dialog', 'ui-dialog-backdrop', 'ui-menu', 'ui-toast']
    const LAYER = /^(position|top|right|bottom|left|inset(-[\w-]+)?|z-index|transform|translate|scale|rotate)$/
    const BLOCK = /^(margin(-[\w-]+)?|height|min-height|max-height|block-size|min-block-size|max-block-size)$/
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          const last = stripNot(lastCompound(alt))
          const hits = OVERLAYS.filter((o) => hasClass(last, o) || (last.match(/\.otter-[\w-]+/g) || []).some((c) => ON_KIT.get(c.slice(1)) === o))
          for (const [p] of decls(r.body)) {
            if (hits.length && LAYER.test(p)) bad.push(`${alt.trim()} { ${p} }`)
            if (hits.some((o) => o.startsWith('ui-drawer')) && BLOCK.test(p)) bad.push(`${alt.trim()} { ${p} } — the drawer's block axis is the kit's`)
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('frames no overlay: nothing an overlay sits in takes a transform, a filter, a containment or a stacking context', () => {
    // None of the kit's overlays is portalled, so everything around one is
    // its frame: `.otter-root { will-change: transform }` moved the drawer
    // from 0–900 to 99–793 and its backdrop covered O.T.T.E.R. only (round 2,
    // N4b); `position: relative; z-index: 0` let the app header take clicks
    // while the modal drawer was open (N18). The wrappers are the classes of
    // every element around a Dialog, Drawer or Menu, around a render function
    // that returns one, or around an O.T.T.E.R. component that renders one.
    const OVERLAY_TAGS = new Set(['Dialog', 'Drawer', 'Menu'])
    for (const { f } of PARSED) {
      const name = f.replace(/^.*\//, '').replace(/\.jsx$/, '')
      if (ELEMENTS.some((e) => e.file === f && OVERLAY_TAGS.has(e.tag))) OVERLAY_TAGS.add(name)
    }
    const overlayFns = new Set(ELEMENTS.filter((e) => OVERLAY_TAGS.has(e.tag) && e.fn).map((e) => `${e.file}:${e.fn}`))
    const wrappers = new Set(ELEMENTS.filter((e) => OVERLAY_TAGS.has(e.tag)).flatMap((e) => e.ancestors))
    // Render functions that return an overlay, followed out to where they are called.
    for (let grew = true; grew;) {
      grew = false
      for (const { f, ast } of PARSED) {
        traverse(ast, {
          CallExpression(p) {
            const c = p.node.callee
            if (c.type !== 'Identifier' || !overlayFns.has(`${f}:${c.name}`)) return
            for (let q = p.parentPath; q; q = q.parentPath) {
              if (q.node.type !== 'JSXElement') continue
              for (const x of staticClasses(q.node.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'className'))) wrappers.add(x)
            }
            const outer = namedFunction(p)
            if (outer && !overlayFns.has(`${f}:${outer}`)) { overlayFns.add(`${f}:${outer}`); grew = true }
          },
        })
      }
    }
    expect(wrappers.has('otter-root'), 'the O.T.T.E.R. root is found around its overlays').toBe(true)
    const TRAP = /^(transform|translate|scale|rotate|perspective|filter|backdrop-filter|will-change|contain|isolation|z-index|opacity|mix-blend-mode|clip-path|mask(-[\w-]+)?|content-visibility)$/
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          const cls = (stripNot(lastCompound(alt)).match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1)).filter((c) => wrappers.has(c))
          if (!cls.length) continue
          for (const [p, v] of decls(r.body)) {
            if (TRAP.test(p) && !/^(none|auto|normal|visible|1)$/.test(v.trim())) bad.push(`${alt.trim()} { ${p}: ${v} } — .${cls[0]} holds an overlay`)
            if (p === 'position' && /^(fixed|sticky)$/.test(v.trim())) bad.push(`${alt.trim()} { position: ${v} } — .${cls[0]} holds an overlay`)
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('gives every transition and every animation an instant end under reduced motion, by a rule that wins', () => {
    // A reduced-motion entry must reach the element AND outrank the rule it
    // quiets. `.otter-val-row { transition: none }` lost to
    // `.otter-val-row[data-level='lesson']` and the lesson rows kept their
    // 120ms under reduced motion (review round 1, finding 3); the generation
    // bar's sweep had no entry at all.
    // Round 2: only `(prefers-reduced-motion: reduce)` quiets (N5: a
    // `no-preference` block counted); an entry reaches a rule only when every
    // class, attribute value and pseudo-class it names is the rule's too (N6:
    // `[data-level='course']` "reached" the lesson rows; N7: `:hover` reached
    // the resting row), both read through :is() (N20); and a tie goes to the
    // rule that comes LATER in the sheet (N8: a transition restated after the
    // block won).
    const REDUCE = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i
    const ALLOWED = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)$/i
    const moving = []
    const quiet = []
    for (const r of SHEET_RULES) {
      const media = r.parents.filter((p) => /^@media/i.test(p)).map((p) => p.trim())
      const reduced = media.some((p) => REDUCE.test(p))
      if (media.some((p) => ALLOWED.test(p))) continue
      for (const [p, v] of decls(r.body)) {
        if (!/^(transition|animation)(-name|-duration|-property)?$/.test(p)) continue
        const kind = p.startsWith('transition') ? 'transition' : 'animation'
        for (const one of splitTop(r.sel)) {
          const entry = { one, spec: specificity(one), order: ORDER.get(r), kind, value: v.trim(), alts: alternatives(one).map(norm) }
          if (reduced) { if (/^none$|^0m?s$/i.test(entry.value)) quiet.push(entry) } else if (!/^none$/i.test(entry.value)) moving.push(entry)
        }
      }
    }
    const parts = (alt) => { const cs = compoundsOf(alt); const last = new Set(simples(cs.pop())); return { last, before: new Set(cs.flatMap(simples)) } }
    const covers = (q, m) => { const a = parts(q); const b = parts(m); return [...a.last].every((s) => b.last.has(s)) && [...a.before].every((s) => b.before.has(s)) }
    const wins = (q, m) => { const c = compareSpecificity(q.spec, m.spec); return c > 0 || (c === 0 && q.order > m.order) }
    const bad = []
    for (const m of moving) {
      for (const alt of m.alts) {
        const reach = quiet.filter((q) => q.kind === m.kind && q.alts.some((qa) => covers(qa, alt)))
        if (!reach.length) bad.push(`${alt} { ${m.kind}: ${m.value} } — no reduced-motion entry`)
        else if (!reach.some((q) => wins(q, m))) bad.push(`${alt} { ${m.kind} } — its reduced-motion entry loses (${reach.map((q) => q.one.trim()).join(', ')})`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('keys every state on an attribute value the JSX can actually write on that element', () => {
    // A selected search result keyed on `data-active` while the row writes
    // `data-selected` stays green and never shows (mutants F6, F8). Round 2:
    // the values are worked out, not taken as "any" when written from a
    // variable (F1 `data-over='yes'`, F3 `'incorrect'`, F4 `'in_progress'`,
    // F7 a state written from the tri-state pick); a kit attribute is read
    // from the kit's JSX with the props passed (S08: a Row's `inactive`); and
    // a bare `[data-x]` must be one something writes (N9: `[data-size]` on
    // the drawer, which writes `data-width`, dropped it from 576 to 300px).
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          const cs = compoundsOf(alt)
          cs.forEach((compound, i) => {
            const conds = attrConds(compound)
            if (!conds.length) return
            const bare = stripNot(compound)
            const otter = (bare.match(/\.(otter-[\w-]+)/) || [])[1]
            const kitCls = (bare.match(/\.(ui-[\w-]+)/) || [])[1]
            const needs = (stripNot(cs.slice(0, i).join(' ')).match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
            const under = (e) => needs.every((n) => e.ancestors.includes(n))
            let targets = []
            if (otter) targets = ELEMENTS.filter((e) => e.classes.includes(otter)).map((e) => [e, null])
            else if (kitCls) {
              targets = ELEMENTS.filter((e) => under(e) && (KIT_ROOT[e.tag] === kitCls || e.classes.includes(kitCls))).map((e) => [e, null])
              if (!targets.length) targets = ELEMENTS.filter((e) => under(e) && KIT.get(e.tag)?.hosts.some((h) => h.classes.includes(kitCls))).map((e) => [e, kitCls])
            }
            if (!targets.length) return
            for (const { name, value } of conds) {
              const found = targets.map(([e, part]) => elementAttr(e, name, part)).filter(Boolean)
              const all = found.length ? either(...found) : null
              if (!renders(all)) bad.push(`${compound} (in ${alt.trim()}) — nothing here writes ${name}`)
              else if (value !== null && !canBe(all, value)) bad.push(`${compound} (in ${alt.trim()}) — ${name} is only ever ${show(all)}`)
            }
          })
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('writes no state that cannot hold: a pseudo-class beside its own :not(), or one attribute with two values', () => {
    // Ten of round 2's generated mutants made a state unreachable this way
    // (`:hover:not(:hover)`) and nothing noticed; a selector that can never
    // match is a rule that silently went dead.
    const bad = []
    for (const r of SHEET_RULES) {
      for (const one of splitTop(r.sel)) {
        for (const alt of alternatives(one)) {
          for (const compound of compoundsOf(alt)) {
            const pos = new Set(simples(stripNot(compound)))
            const neg = [...compound.matchAll(/:not\(((?:[^()]|\([^()]*\))*)\)/g)].flatMap((m) => splitTop(m[1]).map(norm))
            const values = {}
            for (const { name, value } of attrConds(compound)) if (value !== null) (values[name] ||= new Set()).add(value)
            if (neg.some((n) => pos.has(n)) || Object.values(values).some((s) => s.size > 1)) bad.push(`${compound} (in ${alt.trim()})`)
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('lifts the third ink wherever a state puts the hover wash or the signal tint behind it — derived from the JSX, and the lift wins', () => {
    // The third ink measures 4.33:1 on the wash over paper, 3.99 over
    // paper-raised and 4.18 on the tint. For each rule that paints one of
    // those behind a state of .otter-x, every otter class nested inside an
    // otter-x element that some rule sets in the third ink needs a rule, in
    // the same state, lifting it to the second ink or the ink — outside any
    // @media but (hover: hover), so a print or touch-only lift does not count
    // (review round 1, mutants A4, A6, A7). Round 2: the third ink is read
    // through selector lists (N11); the state must be on the element that
    // takes the wash, not on the text (N10: hovering the row left the count
    // at 4.33:1); and the lift must win over every rule that dims the text
    // (A5: a longer selector setting it back to the third ink, later in the
    // sheet).
    const TINT = /^var\(--color-(hover|signal-tint)\)$/
    const isIcon = (body) => decls(body).some(([p]) => p === 'width') && decls(body).some(([p]) => p === 'height')
    const plain = (r) => r.parents.every((p) => !/^@media/.test(p) || /\(hover:\s*hover\)/.test(p))
    const colourOf = (r) => decls(r.body).filter(([p]) => p === 'color').pop()?.[1]
    const inks = SHEET_RULES.filter((r) => plain(r) && colourOf(r)).flatMap((r) => splitTop(r.sel).flatMap((one) =>
      alternatives(one).map((alt) => ({ alt: norm(alt), spec: specificity(one), order: ORDER.get(r), value: colourOf(r), icon: isIcon(r.body) }))))
    const STATE = /:hover|\[data-[\w-]+='true'\]/
    const lastOtter = (alt) => (stripNot(lastCompound(alt)).match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))
    const dims = inks.filter((c) => c.value === 'var(--color-ink-3)' && !c.icon && !STATE.test(stripNot(lastCompound(c.alt))))
    const thirdInk = new Set(dims.flatMap((c) => lastOtter(c.alt)))
    const lifts = inks.filter((c) => /^var\(--color-ink(-2)?\)$/.test(c.value))
    const bad = []
    for (const r of SHEET_RULES) {
      if (!decls(r.body).some(([p, v]) => /^background(-color)?$/.test(p) && TINT.test(v))) continue
      for (const one of splitTop(r.sel)) {
        for (const alt0 of alternatives(one)) {
          const alt = norm(alt0)
          const last = lastCompound(alt)
          const x = (stripNot(last).match(/\.(otter-[\w-]+)/) || [])[1]
          const state = x && (stripNot(last).match(STATE) || [])[0]
          if (!state) continue
          const needs = [...stripNot(last).matchAll(/\[(data-[\w-]+)\s*=\s*'([\w-]+)'\]/g)].filter((m) => m[2] !== 'true')
          const hosts = ELEMENTS.filter((e) => e.classes.includes(x) && needs.every(([, n, v]) => canBe(e.attrs[n], v)))
          const hostLines = new Set(hosts.map((h) => `${h.file}:${h.line}`))
          const inside = new Set(ELEMENTS.filter((e) => e.ancestors.includes(x) && (needs.length === 0 || e.hostKeys?.some((k) => hostLines.has(k)))).flatMap((e) => e.classes).filter((c) => thirdInk.has(c)))
          for (const d of inside) {
            const mine = lifts.filter((l) => {
              const cs = compoundsOf(l.alt)
              const xc = cs.findIndex((c) => hasClass(c, x))
              return xc >= 0 && xc < cs.length - 1 && stripNot(cs[xc]).includes(state) && hasClass(cs[cs.length - 1], d)
            })
            if (!mine.length) { bad.push(`${alt} puts the wash or the tint behind .${d} (third ink) with no lift in that state`); continue }
            const loses = dims.filter((c) => lastOtter(c.alt).includes(d))
              .filter((c) => !mine.some((l) => { const k = compareSpecificity(l.spec, c.spec); return k > 0 || (k === 0 && l.order > c.order) }))
            if (loses.length) bad.push(`${alt}: the lift of .${d} loses to ${loses.map((c) => c.alt).join(', ')}`)
          }
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('names no class that no element carries', () => {
    // Renaming the audit row's class in the JSX left every rule for it —
    // layout, the selected tint, the hover, the lifts, the ring, its
    // reduced-motion entry — dead, and the suite green (round 2, J1). Every
    // otter class the sheet names is a word in the O.T.T.E.R. code.
    const carried = new Set()
    const files = [...JSX_NAMES, 'adapters/index.js']
    for (const f of files) {
      const ast = PARSE(readFileSync(fileURLToPath(new URL(`./${f}`, OTTER_DIR)), 'utf8'))
      traverse(ast, {
        StringLiteral(p) { for (const t of p.node.value.split(/\s+/)) carried.add(t) },
        TemplateElement(p) { for (const t of p.node.value.cooked.split(/\s+/)) carried.add(t) },
      })
    }
    const named = new Set(SHEET_RULES.flatMap((r) => splitTop(r.sel)).flatMap((s) => (stripNot(s).match(/\.otter-[\w-]+/g) || []).map((c) => c.slice(1))))
    const missing = [...named].filter((c) => !carried.has(c))
    expect(missing, missing.join('\n')).toEqual([])
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
    // Round 2: a size must be one of the seven steps by name (N12: Tailwind's
    // own `--text-lg` rendered 18px; N13: a misspelt step inherited 16px); a
    // ground is judged by its token's value (N14: `--color-on-fill` is
    // white); and text on the orange is the dark ink unless it is 19px bold,
    // with white kept for the fill (C6, Q16; N15: white 14px on the signal).
    const bad = []
    for (const r of SHEET_RULES) {
      const d = Object.fromEntries(decls(r.body))
      for (const [p, v] of decls(r.body)) {
        if (p === 'font-size' && !FONT_SIZE.test(v)) bad.push(`${r.sel} { font-size: ${v} }`)
        if (p === 'text-transform' && !/^(uppercase|none)$/.test(v)) bad.push(`${r.sel} { text-transform: ${v} }`)
        if (/^background(-color)?$/.test(p)) { const l = groundLuminance(v); if (l !== null && l >= NEAR_WHITE) bad.push(`${r.sel} { ${p}: ${v} } — a near-white ground (C9)`) }
        if (/^transition(-duration)?$/.test(p) && /(^|[\s,(])[\d.]+m?s\b/.test(v)) bad.push(`${r.sel} { ${p}: ${v} } — a literal duration`)
        if (/^border(-[\w-]+)?-width$|^border(-(top|right|bottom|left))?$/.test(p) && /\b(thick|medium)\b/.test(v)) bad.push(`${r.sel} { ${p}: ${v} }`)
        if (/^(filter|backdrop-filter|border-image(-source)?|mask(-image)?)$/.test(p) && !/^none$/.test(v)) bad.push(`${r.sel} { ${p}: ${v} }`)
      }
      const ground = d['background-color'] ?? d.background
      const orange = ground && /^var\(--color-(signal|signal-fill)\)$/.test(ground.trim()) ? ground.trim().slice(12, -1) : null
      if (d.color && orange) {
        const big = /^var\(--text-h1\)$/.test(d['font-size'] || '') && Number(d['font-weight']) >= 700
        const ok = d.color === 'var(--color-ink-light)' || (d.color === 'var(--color-on-fill)' && (orange === 'signal-fill' || big))
        if (!ok) bad.push(`${r.sel} { color: ${d.color} } on the ${orange} — the dark ink, or white only at 19px bold (C6)`)
      }
      if (d.color === 'var(--color-on-fill)' && !orange) bad.push(`${r.sel} { color: var(--color-on-fill) } — white is the text on a fill, and this rule paints none`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('names the Search dialog: its title is the field, so the Dialog carries aria-label "Search" (A4-KR-1)', () => {
    const search = ELEMENTS.find((e) => e.tag === 'Dialog' && e.classes.includes('otter-search-dialog'))
    expect(search, 'the Search dialog was found').toBeTruthy()
    expect([...search.attrs['aria-label'].vals]).toEqual(['Search'])
  })

  it('never puts two otter classes whose one-class rules set the same property on one element', () => {
    // The later rule wins by source order, which is an accident waiting: a
    // settled request was `otter-req otter-req-head` and the head's
    // `border: 0` erased the card's edge (review round 1, visual finding 3).
    // Round 2: compared longhand to longhand (FP2: a top rule beside a
    // bottom one was read as a fight).
    const oneClass = new Map()
    for (const r of SHEET_RULES) {
      if (r.parents.some((p) => /^@media/.test(p))) continue
      for (const one of splitTop(r.sel)) {
        const m = one.trim().match(/^\.(otter-[\w-]+)$/)
        if (!m) continue
        const set = oneClass.get(m[1]) || new Set()
        for (const p of longhandsOf(r.body)) set.add(p)
        oneClass.set(m[1], set)
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
    // The values: a comparison, a useState through its setter, a field read
    // from data (only a word the file names), and the kit's own attribute
    // read with the props passed.
    const val = (cls, attr) => ELEMENTS.find((e) => e.classes.includes(cls))?.attrs[attr]
    expect([...val('otter-search-result', 'data-active').vals].sort()).toEqual(['false', 'true'])
    expect(canBe(val('otter-dropzone', 'data-over'), 'true')).toBe(true)
    expect(canBe(val('otter-dropzone', 'data-over'), 'yes')).toBe(false)
    expect(canBe(val('otter-val-queue-row', 'data-status'), 'in-progress')).toBe(true)
    expect(canBe(val('otter-val-queue-row', 'data-status'), 'in_progress')).toBe(false)
    const drawer = ELEMENTS.find((e) => e.tag === 'Drawer' && e.classes.includes('otter-settings-drawer'))
    expect(renders(elementAttr(drawer, 'data-width')), 'the kit Drawer writes data-width').toBe(true)
    expect(elementAttr(drawer, 'data-size'), 'and no data-size').toBeNull()
    const banner = ELEMENTS.find((e) => e.tag === 'Banner')
    expect(elementAttr(banner, 'data-inset'), 'no O.T.T.E.R. Banner can be inset').toBeNull()
    // The kit's own JSX was read: the root of every component this file maps.
    for (const [name, root] of Object.entries(KIT_ROOT)) {
      expect(KIT.get(name)?.hosts.some((h) => h.takesClassName && h.classes.includes(root)), `${name} renders its className on .${root}`).toBe(true)
    }
    // Longhands meet where they overlap, and only there.
    expect(longhands('overflow')).toContain('overflow-y')
    expect(longhands('border-top').some((p) => longhands('border-bottom').includes(p))).toBe(false)
    expect(longhands('padding-inline')).toEqual(['padding-left', 'padding-right'])
    // The seven steps, and the ground and the orange.
    expect(STEPS).toHaveLength(7)
    expect(FONT_SIZE.test('var(--text-lg)')).toBe(false)
    expect(FONT_SIZE.test('var(--text-caption)')).toBe(true)
    expect(groundLuminance('var(--color-on-fill)')).toBeGreaterThanOrEqual(NEAR_WHITE)
    expect(groundLuminance('var(--color-ink-2)')).toBeLessThan(NEAR_WHITE)
    expect(groundLuminance('var(--color-hover)')).toBeLessThan(NEAR_WHITE)
  })
})

/** The seven steps of the one type scale (C7), by name, from @theme. */
const STEPS = [...THEME].filter((n) => /^text-[a-z0-9]+$/.test(n)).map((n) => n.slice(5))
const STEP = `(?:${STEPS.join('|')})`
const FONT_SIZE = new RegExp(`^(var\\(--text-${STEP}\\)|inherit|calc\\(var\\(--text-${STEP}\\) \\* var\\(--mono-size-adjust\\)\\)|max\\(var\\(--text-label\\), calc\\(var\\(--text-label\\) \\* var\\(--mono-size-adjust\\)\\)\\))$`)
/** A ground at or above this luminance is white or near it (C9): the ink is
 *  0.87 and white 1; the brightest fill the dark surface uses (a status
 *  colour) is 0.55. */
const NEAR_WHITE = 0.6
/** The luminance of a ground as it shows over the paper: a token's value
 *  (an rgba composited), or a token mixed toward transparent at its share.
 *  null when it names no colour token (none, transparent, the data colour). */
function groundLuminance(value) {
  const paper = THEME_HEX('color-paper')
  const raw = (name) => decls(allRules(INDEX).find((r) => /^@theme\b/.test(r.sel)).body).find(([p]) => p === `--${name}`)?.[1]
  const flat = (name, share = 1) => {
    const v = raw(name)
    if (!v) return null
    const rgba = /^#/.test(v) ? { ...Object.fromEntries(hexToRgb(v).map((c, i) => ['rgb'[i], c])), a: 1 } : parseRgba(v)
    return over(`rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a * share})`, paper)
  }
  const mix = value.match(/^color-mix\(in srgb, var\(--(color-[\w-]+)\) ([\d.]+)%, transparent\)$/)
  const one = value.match(/^var\(--(color-[\w-]+)\)$/)
  const hex = mix ? flat(mix[1], Number(mix[2]) / 100) : one ? flat(one[1]) : null
  return hex ? luminance(hex) : null
}
