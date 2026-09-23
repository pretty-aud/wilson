// =============================================================================
// binsCss.test.js — UI overhaul B6, 2026-09-23. The Bins state and restyle guard.
//
// Bins' hover / selected / active / current / drag-over / offline / disabled /
// tone states live in `data-*` attributes resolved by `bins.css`, not in
// inline styles. An inline style beats every class written beside it, so a
// restyle next to a surviving inline state drops it silently (plan §1, risk
// 4) — the review's B01 was exactly that: every Bins button declared a hover
// class and set its fill inline, so none of them hovered.
//
// Cheap source-text checks. They cannot prove the tab LOOKS right — the
// screenshots and the two review rounds do that — but they prove no state was
// left inline, no rule is dead or merely named, the sheet keys on the value,
// and every painted row lifts its quiet inks. The render half (the selector
// and the node MEETING) is binsState.test.jsx.
//
// Round one's test reviewer ran seventy mutations against the first version
// of this file and thirty passed. The predicates now live in binsGuards.js,
// hardened against each of them; the last block runs mutants through the SAME
// predicates the assertions use (T2 hand-off §5 trap 8).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { C } from './binUi'
import { INK, INK_2, INK_3, SIGNAL, PAPER, THEME } from '../../../../ui/tokens'
import { contrast, screen } from '../../../../ui/contrast'
import {
  binsJsx, stripJs, stripCss, stateLeaks, utilityLeaks, rules, paintsSelector, paintedStates,
  liftRule, coveredBy, afterLayer,
} from './binsGuards'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const css = readFileSync(here('./bins.css'), 'utf8')
/** The stylesheet with its comments removed (a comment may quote a selector). */
const code = stripCss(css)
const JSX = binsJsx(here('./'))
const JSX_CODE = Object.fromEntries(Object.entries(JSX).map(([f, s]) => [f, stripJs(s)]))

const cssClasses = () => new Set((code.match(/\.bn-[a-z-]+/g) || []).map(s => s.slice(1)))
// Not preceded by a word character or a hyphen: `--bn-ink-3` is a custom
// property, not a class. Comments stripped: a class named only in a comment
// is not written (round 1, D1).
const jsxClasses = () => {
  const s = new Set()
  for (const src of Object.values(JSX_CODE)) for (const m of src.matchAll(/(?<![\w-])bn-[a-z-]+/g)) s.add(m[0])
  return s
}
// `data-bin-grid` is behaviour (the keyboard reads the grid's real tracks from
// it). `data-size` is the KIT's (`.ui-input[data-size="sm"]`), written on the
// native search and rename fields that borrow the kit's input class.
// `data-testid` is a test hook.
const NOT_STATE = new Set(['bin-grid', 'size', 'testid'])
const cssAttrs = () => new Set([...code.matchAll(/\[data-([a-z-]+)/g)].map(m => m[1]))
const jsxAttrs = () => {
  const s = new Set()
  for (const src of Object.values(JSX_CODE)) for (const m of src.matchAll(/\bdata-([a-z-]+)=/g)) if (!NOT_STATE.has(m[1])) s.add(m[1])
  return s
}

// The painted row states, by name. A deleted fill fails here (round 1: the
// first version asked `>= 8` and let a deleted selection colour through).
const PAINTED = [
  '.bn-pick-row:hover', '.bn-pick-row[data-picked="true"]',
  '.bn-take-row[data-primary="true"]',
  '.bn-tile:hover', '.bn-tile[data-selected="true"]',
  '.bn-tree-row:hover', '.bn-tree-row[data-active="true"]', '.bn-tree-row[data-drag-over="true"]',
  '.bn-trow:hover', '.bn-trow[data-selected="true"]',
]
// A painted state that needs no lift, with the ground it paints over: the
// ratio is COMPUTED from the rule's own mix (round 2: a comment string let a
// 12% mix — ink-3 4.39, the signal 4.27 — pass).
const NO_LIFT_NEEDED = {
  '.bn-take-row[data-primary="true"]': { mixOf: 'signal', over: PAPER },
}
// A quiet ink written straight into a descendant of a liftable row — allowed
// only where it is an ICON (3:1 is its rule, and the signal clears it).
const ICON_BYPASS = ['.bn-tree-row[data-active="true"] .bn-tree-icon']

// The dim (round 1): offline, locked and missing rows take the disabled ink;
// the same rows on a hover or selection ground take ink-2. Never an opacity.
const DIMMED = [
  '.bn-trow[data-offline="true"]', '.bn-tile[data-offline="true"]',
  '.bn-pick-row[data-offline="true"]', '.bn-pick-row[data-locked="true"]',
  '.bn-add-row[data-disabled="true"]',
]
const DIMMED_PAINTED = [
  '.bn-trow[data-offline="true"]:hover', '.bn-trow[data-offline="true"][data-selected="true"]',
  '.bn-tile[data-offline="true"]:hover', '.bn-tile[data-offline="true"][data-selected="true"]',
  '.bn-pick-row[data-offline="true"]:hover', '.bn-pick-row[data-offline="true"][data-picked="true"]',
  '.bn-pick-row[data-locked="true"]:hover',
]
const INK_PROPS = ['--bn-ink', '--bn-ink-2', '--bn-ink-3', '--bn-signal-ink']
const ruleFor = (sels) => rules(code).find(r => sels.every(s => r.selectors.includes(s)) && INK_PROPS.every(p => new RegExp(`${p}\\s*:`).test(r.body)))

describe('bins.css is layered, and imported', () => {
  it('names all four layers, in Tailwind order, as a statement', () => {
    expect(code).toMatch(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  })

  it('🚨 the statement comes BEFORE the first @layer block', () => {
    const statement = code.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = code.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThan(statement)
  })

  it('nothing before the block but the statement, and NOTHING after it (an unlayered rule beats every utility)', () => {
    const before = code.slice(0, code.search(/@layer\s+components\s*\{/)).replace(/@layer\s+[a-z,\s]+;/, '')
    expect(before.trim()).toBe('')
    const after = afterLayer(code)
    expect(after).not.toBeNull()
    expect(after.trim()).toBe('')
  })

  it('is imported by binUi, which every Bins file imports', () => {
    expect(JSX['binUi.jsx']).toMatch(/import\s+'\.\/bins\.css'/)
  })
})

describe('the extracted state', () => {
  it('🚨 no Bins file chooses a visual property by a condition outside bins.css', () => {
    const found = {}
    for (const [f, src] of Object.entries(JSX)) {
      const hits = stateLeaks(src)
      if (hits.length) found[f] = hits
    }
    expect(found).toEqual({})
  })

  it('🚨 no colour or opacity reaches a Bins element by utility class, however it is spelled (round 2)', () => {
    const found = {}
    for (const [f, src] of Object.entries(JSX)) {
      const hits = utilityLeaks(src)
      if (hits.length) found[f] = hits
    }
    expect(found).toEqual({})
  })

  it('the scan read every rendering file, BinsView included (a control on the loop above)', () => {
    expect(Object.keys(JSX)).toEqual(expect.arrayContaining(['BinsView.jsx', 'binUi.jsx', 'BinTree.jsx', 'BinFileTable.jsx', 'BinFileGrid.jsx', 'BinInspector.jsx']))
    expect(Object.keys(JSX).length).toBeGreaterThanOrEqual(14)
  })

  it('every attribute selector keys on a VALUE, never on presence (C3b trap 2)', () => {
    expect([...code.matchAll(/\[data-[a-z-]+\]/g)].map(m => m[0])).toEqual([])
  })

  it('a boolean state is emitted as exactly \'true\' or not at all — `x ? \'true\' : undefined` and nothing else', () => {
    // Round 2: `disabled ? 'ture' : undefined` passed the first version, and the
    // missing add rows lost their dim. The ONLY accepted shapes are the two
    // orders of `'true'` / `undefined`.
    const bad = []
    let seen = 0
    for (const [f, src] of Object.entries(JSX_CODE)) {
      for (const m of src.matchAll(/\bdata-([a-z-]+)=\{([^}]*)\}/g)) {
        if (NOT_STATE.has(m[1])) continue
        seen++
        const v = m[2].replace(/\s+/g, ' ').trim()
        if (!/^[\s\S]+\? (?:'true' : undefined|undefined : 'true')$/.test(v)) bad.push(`${f}: data-${m[1]}={${v}}`)
      }
      for (const m of src.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) if (!NOT_STATE.has(m[1])) bad.push(`${f}: data-${m[1]}="${m[2]}" (a literal state)`)
    }
    expect(bad).toEqual([])
    expect(seen).toBeGreaterThan(20)
  })

  it('every bn- class the JSX writes is declared, and every declared class is written (no dead rule)', () => {
    const declared = cssClasses()
    const written = jsxClasses()
    expect([...written].filter(c => !declared.has(c)).sort()).toEqual([])
    expect([...declared].filter(c => !written.has(c)).sort()).toEqual([])
  })

  it('every data- state the JSX emits has a rule, and every rule\'s attribute is emitted', () => {
    const inCss = cssAttrs()
    const inJsx = jsxAttrs()
    expect([...inJsx].filter(a => !inCss.has(a)).sort()).toEqual([])
    expect([...inCss].filter(a => !inJsx.has(a)).sort()).toEqual([])
  })
})

describe('the restyle: tokens only (C8, B04)', () => {
  it('bins.css writes no raw colour of any spelling', () => {
    const NAMED = /(?<![\w-])(?:white|black|red|orange|green|blue|gray|grey|silver|gold|yellow|purple|pink)(?![\w-])/gi
    const raw = [
      ...(code.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi) || []),
      ...(code.match(NAMED) || []),
    ]
    expect(raw).toEqual([])
  })

  it('every var() bins.css reads is a token in @theme, or one of its own data / state properties', () => {
    const OWN = new Set(['dot-color', 'poster-icon', 'tag-hue'])
    const vars = [...code.matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1]).filter(v => !v.startsWith('bn-') && !OWN.has(v))
    expect(vars.filter(v => !(v in THEME))).toEqual([])
    expect(vars.length).toBeGreaterThan(20)
  })

  it('binUi\'s C is the kit ladder: every ink a liftable / dimmable property, everything else a token', () => {
    expect(C.bright).toBe('var(--bn-ink, var(--color-ink))')
    expect([C.text, C.muted]).toEqual(['var(--bn-ink-2, var(--color-ink-2))', 'var(--bn-ink-2, var(--color-ink-2))'])
    expect([C.dim, C.dimmer]).toEqual(['var(--bn-ink-3, var(--color-ink-3))', 'var(--bn-ink-3, var(--color-ink-3))'])
    expect(C.accentText).toBe('var(--bn-signal-ink, var(--color-signal))')
    expect(C.accent).toBe(SIGNAL)
    for (const [k, v] of Object.entries(C)) {
      const prop = /^var\(--bn-[a-z0-9-]+, var\(--([a-z0-9-]+)\)\)$/.exec(v)
      if (prop) { expect(prop[1] in THEME, `C.${k}'s fallback --${prop[1]} is not a token`).toBe(true); continue }
      expect(Object.values(THEME), `C.${k} = ${v} is not a token`).toContain(v)
    }
    expect([THEME['color-ink'], THEME['color-ink-2'], THEME['color-ink-3']]).toEqual([INK, INK_2, INK_3])
  })

  it('🚨 nothing appends an alpha to a C colour, however it is spelled (a var() cannot take one)', () => {
    // Hex-only sources: a data table's hex (TAKE_ROLE_META). (The Chip adapter
    // tints with color-mix since round 2, so it appends to nothing.)
    const HEX_SOURCES = new Set(['meta.color'])
    const bad = []
    for (const [f, src] of Object.entries(JSX_CODE)) {
      const aliases = new Set()
      for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*C\.\w+/g)) aliases.add(m[1])
      for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*C\b/g)) for (const n of m[1].split(',')) aliases.add(n.split(':').pop().trim())
      for (const m of src.matchAll(/\$\{([^}]+)\}[0-9a-fA-F]{2}\b/g)) if (!HEX_SOURCES.has(m[1].trim())) bad.push(`${f}: \${${m[1]}}…`)
      for (const m of src.matchAll(/\b(C\.\w+|\w+)\s*(?:\+\s*['"`]|\.concat\()/g)) if (m[1].startsWith('C.') || aliases.has(m[1])) bad.push(`${f}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
})

describe('the lift (B02 / B04): every painted row lifts its quiet inks', () => {
  it('the painted row states are exactly these — a deleted fill fails', () => {
    expect(paintedStates(code).sort()).toEqual([...PAINTED].sort())
  })

  it('each of them really PAINTS (named in the lift list is not enough)', () => {
    for (const s of PAINTED) expect(paintsSelector(code, s), `no rule paints ${s}`).toBe(true)
  })

  it('every painted state is lifted, or signed off', () => {
    const lift = liftRule(code).selectors
    expect(paintedStates(code).filter(s => !coveredBy(s, lift) && !(s in NO_LIFT_NEEDED))).toEqual([])
  })

  it('…and a sign-off holds: ink-3 and the signal clear 4.5:1 on the ground the rule actually mixes', () => {
    for (const [s, { mixOf, over }] of Object.entries(NO_LIFT_NEEDED)) {
      const r = rules(code).find(x => x.selectors.includes(s))
      const pct = Number(new RegExp(`color-mix\\(in srgb, var\\(--color-${mixOf}\\) (\\d+(?:\\.\\d+)?)%`).exec(r.body)?.[1])
      expect(pct, `${s} no longer mixes the ${mixOf}`).toBeGreaterThan(0)
      const ground = screen(THEME[`color-${mixOf}`], pct, over)
      expect(contrast(INK_3, ground), `ink-3 on ${s}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(SIGNAL, ground), `the signal on ${s}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the lift LIFTS: ink-3 → ink-2, the signal → ink', () => {
    const { body } = liftRule(code)
    expect(body).toMatch(/--bn-ink-3\s*:\s*var\(--color-ink-2\)/)
    expect(body).toMatch(/--bn-signal-ink\s*:\s*var\(--color-ink\)/)
  })

  it('no quiet ink is written straight into a liftable row\'s text (an icon excepted)', () => {
    const rows = [...new Set(liftRule(code).selectors.map(s => s.match(/^\.bn-[a-z-]+/)[0]))]
    const bad = rules(code)
      .filter(r => /(?:^|;)\s*color\s*:\s*var\(--color-(?:ink-3|signal)\)/.test(r.body))
      .flatMap(r => r.selectors.filter(s => rows.some(row => s.startsWith(row) && / /.test(s))))
    expect(bad.filter(s => !ICON_BYPASS.includes(s))).toEqual([])
  })
})

describe('the dim (round 1): never an opacity on a row', () => {
  it('offline, locked and missing rows set every ink property to ink-3', () => {
    const r = ruleFor(DIMMED)
    expect(r, 'the dim rule is missing or lost a selector').toBeTruthy()
    for (const p of INK_PROPS) expect(r.body).toMatch(new RegExp(`${p}\\s*:\\s*var\\(--color-ink-3\\)`))
  })

  it('the same rows on a hover or selection ground take ink-2 (ink-3 fails there)', () => {
    const r = ruleFor(DIMMED_PAINTED)
    expect(r, 'the painted-dim rule is missing or lost a selector').toBeTruthy()
    for (const p of INK_PROPS) expect(r.body).toMatch(new RegExp(`${p}\\s*:\\s*var\\(--color-ink-2\\)`))
  })

  it('only the two dim rules set --bn-ink, and no other rule sets a --bn- ink on a dimmed row (round 2)', () => {
    const isDim = (r) => [DIMMED, DIMMED_PAINTED].some(sels => sels.every(s => r.selectors.includes(s)) && INK_PROPS.every(p => new RegExp(`${p}\\s*:`).test(r.body)))
    const others = rules(code).filter(r => !isDim(r))
    expect(others.filter(r => /--bn-ink\s*:/.test(r.body)).flatMap(r => r.selectors)).toEqual([])
    const undo = others.filter(r => /--bn-[a-z0-9-]+\s*:/.test(r.body) && r.selectors.some(s => DIMMED.some(d => s.startsWith(d))))
    expect(undo.flatMap(r => r.selectors)).toEqual([])
  })

  it('the rules that colour row text READ the ink properties (drop the link and the dim cannot reach them)', () => {
    const body = (s) => rules(code).find(r => r.selectors.includes(s))?.body || ''
    expect(body('.bn-trow-name')).toMatch(/color\s*:\s*var\(--bn-ink, var\(--color-ink\)\)/)
    expect(body('.bn-take-count')).toMatch(/var\(--bn-ink-3, var\(--color-ink-3\)\)/)
    expect(body('.bn-take-count[data-assigned="true"]')).toMatch(/var\(--bn-signal-ink, var\(--color-signal\)\)/)
  })

  it('the files pane draws its ring as an overlay ABOVE its children (round 2: they painted over an outline)', () => {
    const r = rules(code).find(x => x.selectors.includes('.bn-pane:focus-visible::after'))
    expect(r, 'the pane ring overlay is missing').toBeTruthy()
    expect(r.body).toMatch(/position\s*:\s*absolute/)
    expect(r.body).toMatch(/outline\s*:\s*2px solid var\(--color-focus\)/)
    expect(r.body).toMatch(/pointer-events\s*:\s*none/)
    expect(Number(/z-index\s*:\s*(\d+)/.exec(r.body)?.[1])).toBeGreaterThan(30) // above the rename bar (30) and the drop target (20)
    expect(rules(code).find(x => x.selectors.includes('.bn-pane'))?.body).toMatch(/position\s*:\s*relative/)
  })

  it('no row state fades with opacity (it took the text to 2.35–3.47:1)', () => {
    const faded = rules(code)
      .filter(r => /(?:^|;)\s*opacity\s*:/.test(r.body))
      .flatMap(r => r.selectors.filter(s => /^\.bn-(?:trow|tile|pick-row|add-row|tree-row)\b/.test(s)))
    expect(faded).toEqual([])
  })
})

describe('the guards themselves (mutants run through the SAME predicates)', () => {
  it('the scanner catches each spelling round one got past the first version with', () => {
    const tile = (s) => `<div className="bn-tile" ${s} />`
    for (const s of [
      `style={{ backgroundColor: selected ? 'x' : 'y' }}`,
      `style={selected ? { color: C.bright } : { color: C.muted }}`,
      `style={{ width: 3, ...(selected && { backgroundColor: C.accent }) }}`,
      `style={{ ...(selected ? { color: 'a' } : { color: 'b' }) }}`,
      'className={`bn-tile ${selected ? "bg-orange-600/20 border-orange-600" : ""}`}',
      `style={{ color: (selected && C.bright) || C.muted }}`,
      `style={{ backgroundImage: hover ? 'linear-gradient(a, b)' : 'none' }}`,
      `style={{ fontWeight: selected ? 700 : 500 }}`,
      `style={{ filter: off ? 'grayscale(1)' : 'none' }}`,
      'style={{ border: `1px solid ${a ? C.x : C.y}`, width: 3 }}',
    ]) expect(stateLeaks(tile(s)), s).toHaveLength(1)
    expect(stateLeaks(`const s = { color: sel ? C.a : C.b }\n<div style={s} />`)).toHaveLength(1)
  })

  it('and passes data: a custom property, optional chaining, nullish, a layout ternary, a comment', () => {
    expect(stateLeaks(`<div style={{ '--chip-color': a ? b : c, color: meta?.color ?? C.x, minWidth: inline ? 88 : undefined }} />`)).toEqual([])
    expect(stateLeaks(`{/* style={{ color: a ? b : c }} */}<div />`)).toEqual([])
  })

  it('a selector merely NAMED (the lift list) does not count as painted', () => {
    const lifted = '.bn-trow[data-selected="true"]'
    const without = code.replace(/\.bn-trow\[data-selected="true"\] \{[^}]*\}/, '')
    expect(paintsSelector(code, lifted)).toBe(true)
    expect(paintsSelector(without, lifted)).toBe(false)
  })

  it('the lift check sees a new painted state that does not lift, and a no-op lift', () => {
    const extra = code.replace(/\}\s*$/, '  .bn-trow[data-flash="true"] { background: var(--color-hover); }\n}')
    expect(paintedStates(extra).filter(s => !coveredBy(s, liftRule(extra).selectors) && !(s in NO_LIFT_NEEDED))).toEqual(['.bn-trow[data-flash="true"]'])
    const noop = code.replace(/--bn-ink-3:\s*var\(--color-ink-2\);/, '--bn-ink-3: var(--color-ink-3);')
    expect(liftRule(noop).body).not.toMatch(/--bn-ink-3\s*:\s*var\(--color-ink-2\)/)
  })

  it('the utility scan catches the round-two spellings', () => {
    for (const s of [
      `<div className={['bn-trow', off && 'opacity-50'].filter(Boolean).join(' ')} />`,
      `const fade = off ? "opacity-50" : ""`,
      `<div className={'bn-tile ' + (selected ? ' bg-signal-tint border-signal' : '')} />`,
      `useEffect(() => { el.style.opacity = off ? '0.5' : '' })`,
      `<div className="truncate text-caption text-ink-3" />`,
      `<div className="hover:text-signal" />`,
    ]) expect(utilityLeaks(s).length, s).toBeGreaterThan(0)
    expect(utilityLeaks(`<div className="bn-trow text-caption hover:bg-hover accent-signal" /> const a = x ? 'text-right' : ''`)).toEqual([])
  })

  it('an inset spread shadow and a pseudo-element background count as painting a ground', () => {
    const shadow = code.replace(/\}\s*$/, '  .bn-trow[data-current="true"] { box-shadow: inset 0 0 0 100vmax var(--color-signal-tint); }\n}')
    const before = code.replace(/\}\s*$/, '  .bn-trow[data-current="true"]::before { background-color: var(--color-hover); }\n}')
    expect(paintedStates(shadow)).toContain('.bn-trow[data-current="true"]')
    expect(paintedStates(before)).toContain('.bn-trow[data-current="true"]::before')
    expect(paintedStates(code)).not.toContain('.bn-trow[data-current="true"]') // the 2px edge is not a ground
  })

  it('an unlayered rule appended after the block is seen', () => {
    expect(afterLayer(`${code}\n@media (prefers-reduced-motion: reduce) { .bn-trow { transition: none; } }`).trim()).not.toBe('')
  })
})
