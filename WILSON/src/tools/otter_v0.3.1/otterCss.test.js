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
import { allRules, decls, splitTop, themeNames } from '../../../scripts/ui-css-rules.mjs'
import { cssCounts } from '../../../scripts/ui-audit.mjs'
import { contrast, hexToRgb, rgbToHex } from '../../ui/contrast.js'

const SHEET_PATH = 'src/tools/otter_v0.3.1/otter.css'
const RAW = readFileSync(fileURLToPath(new URL('./otter.css', import.meta.url)), 'utf8')
/** Comments blanked to spaces, so offsets and line numbers survive. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
const INDEX = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')
const THEME = themeNames(INDEX)
const JSX_FILES = ['./Otter.jsx', './components/CourseBadges.jsx', './components/CourseFilterChips.jsx',
  './components/CourseRowMenu.jsx', './components/SidebarCollapse.jsx']
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
          const first = t.trim().split(/\s+/)[0].toLowerCase()
          if (first === 'all' || /^[\d.]+m?s$|^var\(/.test(first)) bad.push(`${r.sel}  transition: ${t.trim()}  (no property, or all)`)
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
    const ROOT = { Td: 'ui-td', Th: 'ui-th', Row: 'ui-row', Button: 'ui-btn', Card: 'ui-card', Badge: 'ui-badge',
      Banner: 'ui-banner', SectionTitle: 'ui-section', Panel: 'ui-panel', Chip: 'ui-chip', Kbd: 'ui-kbd',
      IconButton: 'ui-iconbtn', Tabs: 'ui-tabs', Menu: 'ui-menu', EmptyState: 'ui-empty', Select: 'ui-input',
      Input: 'ui-input', TextArea: 'ui-input', Field: 'ui-field',
      // A4: a class on a Dialog is a class on the kit's surface.
      Dialog: 'ui-dialog' }
    const TAG = /<([A-Z][\w.]*|[a-z][\w-]*)(?=[\s/>])/g
    const onKit = new Map()
    for (const src of JSX_FILES) {
      for (const m of src.matchAll(/(?<![\w-])className="([^"]*)"/g)) {
        let tag = null
        for (const t of src.slice(Math.max(0, m.index - 600), m.index).matchAll(TAG)) tag = t[1]
        const cls = m[1].split(/\s+/)
        const root = ROOT[tag] || cls.find((c) => /^ui-/.test(c))
        if (root) for (const c of cls) if (c.startsWith('otter-')) onKit.set(c, root)
      }
    }
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
