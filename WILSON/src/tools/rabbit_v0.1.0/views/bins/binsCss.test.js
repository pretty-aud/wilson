// =============================================================================
// binsCss.test.js — UI overhaul B6, 2026-09-23. The state extraction's guard.
//
// Bins' hover / selected / active / current / drag-over / offline / disabled /
// tone states live in `data-*` attributes resolved by `bins.css`, not in
// inline `style` ternaries. An inline style beats every class written beside
// it, so a restyle next to a surviving ternary drops the state silently (plan
// §1, risk 4) — and the review's B01 was exactly that shape: every Bins button
// declared a hover class and set its fill inline, so none of them hovered.
//
// Cheap source-text checks. They cannot prove the tab LOOKS right — the
// screenshots and the two review rounds do that — but they prove no branch was
// left inline, no rule is dead, and the stylesheet keys on the value. The
// render half (the selector and the node MEETING) is binsState.test.jsx.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { C } from './binUi'
import { INK_2, INK_3, SIGNAL, THEME } from '../../../../ui/tokens'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(here(rel), 'utf8')

const css = read('./bins.css')
/** The stylesheet with its comments removed (a comment may quote a selector). */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

// Every file on the Bins tab that renders: views/bins/*.jsx (not tests) and BinsView.
const JSX = Object.fromEntries([
  ...readdirSync(here('./')).filter(f => f.endsWith('.jsx') && !f.includes('.test.')).map(f => [f, read(`./${f}`)]),
  ['BinsView.jsx', read('../BinsView.jsx')],
])

// ── The inline-style scanner ────────────────────────────────────────────────
// Every `style={{ … }}` object, split into its top-level properties. A visual
// property whose value holds a ternary is a state that escaped extraction.
// Exported so the mutant check below exercises the SAME predicate the
// assertion uses (T2 hand-off §5 trap 8: a control that re-types its subject
// proves nothing).
const VISUAL = /^(?:color|background(?:Color)?|border\w*|boxShadow|opacity|outline\w*|fill|stroke|textDecoration)$/

export function styleObjects(src) {
  const out = []
  let i = 0
  for (;;) {
    const at = src.indexOf('style={{', i)
    if (at < 0) break
    let depth = 0
    let j = at + 'style={'.length
    for (; j < src.length; j++) {
      const ch = src[j]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) break }
    }
    out.push({ at, body: src.slice(at + 'style={{'.length, j) })
    i = j
  }
  return out
}

function topLevelProps(body) {
  const props = []
  let depth = 0, start = 0, quote = null
  for (let k = 0; k < body.length; k++) {
    const ch = body[k]
    if (quote) { if (ch === quote && body[k - 1] !== '\\') quote = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) { props.push(body.slice(start, k)); start = k + 1 }
  }
  props.push(body.slice(start))
  return props.map(p => p.trim()).filter(Boolean)
}

/** A `?` that is a conditional — not optional chaining (`?.`) or nullish (`??`). */
const hasTernary = (v) => /\?/.test(v.replace(/\?\?|\?\./g, ''))

export function inlineStateTernaries(src) {
  const hits = []
  for (const { at, body } of styleObjects(src)) {
    for (const p of topLevelProps(body)) {
      const m = /^['"]?([A-Za-z-]+)['"]?\s*:\s*([\s\S]*)$/.exec(p)
      if (!m || m[1].startsWith('--')) continue // a custom property carries DATA, not state
      if (VISUAL.test(m[1]) && hasTernary(m[2])) hits.push(`${m[1]}: ${m[2].replace(/\s+/g, ' ').slice(0, 90)}  (@${at})`)
    }
  }
  return hits
}

// ── The two sides of the contract ───────────────────────────────────────────
const cssClasses = () => new Set((code.match(/\.bn-[a-z-]+/g) || []).map(s => s.slice(1)))
// Not preceded by a word character or a hyphen: `--bn-ink-3` is a custom
// property the lift sets, not a class.
const jsxClasses = () => {
  const s = new Set()
  for (const src of Object.values(JSX)) for (const m of src.matchAll(/(?<![\w-])bn-[a-z-]+/g)) s.add(m[0])
  return s
}

/** The rules inside `@layer components { … }`, as { selectors, body }. */
export function rules(cssCode) {
  const open = cssCode.search(/@layer\s+components\s*\{/)
  const inner = cssCode.slice(cssCode.indexOf('{', open) + 1, cssCode.lastIndexOf('}'))
  return [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim()).filter(Boolean),
    body: m[2],
  }))
}

/** Every STATE selector on a row that paints the row's ground — the hover
 *  fill, the selection tint, the drop mix. Each one must lift the quiet inks. */
export function paintedRowStates(cssCode) {
  const out = []
  for (const { selectors, body } of rules(cssCode)) {
    if (!/background-(?:color|image)\s*:(?!\s*transparent)/.test(body)) continue
    for (const s of selectors) {
      if (/^\.bn-(?:tree-row|trow|tile|pick-row)(?::hover|\[data-[a-z-]+="true"\])$/.test(s)) out.push(s)
    }
  }
  return out
}
export function liftSelectors(cssCode) {
  const lift = rules(cssCode).find(r => /--bn-ink-3\s*:/.test(r.body) && /--bn-signal-ink\s*:/.test(r.body))
  return lift ? lift.selectors : []
}
// `data-bin-grid` is behaviour (the keyboard handler reads the grid's real
// tracks from it), not state; nothing in the stylesheet keys on it. And
// `data-size` is the KIT's (`.ui-input[data-size="sm"]` in index.css), written
// on the native search and rename fields that borrow the kit's input class.
// `data-testid` is a test hook.
const BEHAVIOUR_ATTRS = new Set(['bin-grid', 'size', 'testid'])
const cssAttrs = () => new Set([...code.matchAll(/\[data-([a-z-]+)/g)].map(m => m[1]))
const jsxAttrs = () => {
  const s = new Set()
  for (const src of Object.values(JSX)) for (const m of src.matchAll(/\bdata-([a-z-]+)=/g)) if (!BEHAVIOUR_ATTRS.has(m[1])) s.add(m[1])
  return s
}

describe('bins.css declares the cascade layer order before it uses a layer', () => {
  it('names all four layers, in Tailwind order, as a statement', () => {
    expect(code).toMatch(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  })

  it('🚨 the statement comes BEFORE the first @layer block', () => {
    const statement = code.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = code.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThan(statement)
  })

  it('every rule sits inside @layer components (an unlayered rule would beat every utility)', () => {
    const outside = code.replace(/@layer\s+[a-z,\s]+;/, '').replace(/@layer\s+components\s*\{[\s\S]*\}\s*$/, '')
    expect(outside.trim()).toBe('')
  })

  it('is imported by binUi, which every Bins file imports', () => {
    expect(JSX['binUi.jsx']).toMatch(/import\s+'\.\/bins\.css'/)
  })
})

describe('the extracted state', () => {
  it('🚨 no Bins file draws a state from an inline style ternary', () => {
    const found = {}
    for (const [f, src] of Object.entries(JSX)) {
      const hits = inlineStateTernaries(src)
      if (hits.length) found[f] = hits
    }
    expect(found).toEqual({})
  })

  it('every attribute selector keys on a VALUE, never on presence (C3b trap 2)', () => {
    const presence = [...code.matchAll(/\[data-[a-z-]+\]/g)].map(m => m[0])
    expect(presence).toEqual([])
  })

  it('a boolean state is emitted as \'true\' or not at all — never String(x) or a bare boolean', () => {
    const bad = []
    for (const [f, src] of Object.entries(JSX)) {
      for (const m of src.matchAll(/\bdata-([a-z-]+)=\{([^}]*)\}/g)) {
        if (BEHAVIOUR_ATTRS.has(m[1])) continue
        const v = m[2].trim()
        if (/^String\(/.test(v) || /^[\w.?!]+$/.test(v)) bad.push(`${f}: data-${m[1]}={${v}}`)
      }
    }
    expect(bad).toEqual([])
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

describe('the restyle: tokens only, and the lift (B04, B02)', () => {
  it('bins.css writes no raw colour — every value is a token from @theme (C8)', () => {
    expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || []).toEqual([])
  })

  it('every var(--color-*) bins.css reads exists in @theme', () => {
    const used = new Set([...code.matchAll(/var\(--color-([a-z0-9-]+)/g)].map(m => `color-${m[1]}`))
    expect([...used].filter(t => !(t in THEME))).toEqual([])
  })

  it('binUi\'s C is the kit ladder: the quiet inks lift, everything else is a token', () => {
    expect(C.dim).toBe('var(--bn-ink-3, var(--color-ink-3))')
    expect(C.dimmer).toBe(C.dim)
    expect(C.accentText).toBe('var(--bn-signal-ink, var(--color-signal))')
    expect([C.text, C.muted]).toEqual([INK_2, INK_2])
    expect(C.accent).toBe(SIGNAL)
    // The fallbacks are the real tokens, spelled as index.css spells them.
    expect(THEME['color-ink-3']).toBe(INK_3)
    for (const [k, v] of Object.entries(C)) {
      if (['dim', 'dimmer', 'accentText'].includes(k)) continue
      expect(Object.values(THEME), `C.${k} = ${v} is not a token`).toContain(v)
    }
  })

  it('🚨 nothing appends an alpha to a C colour (a var() cannot take one)', () => {
    const bad = []
    for (const [f, src] of Object.entries(JSX)) {
      for (const m of src.matchAll(/\$\{C\.\w+\}[0-9a-fA-F]{2}\b|C\.\w+\s*\+\s*['"`]/g)) bad.push(`${f}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })

  it('🚨 every state that paints a row\'s ground also lifts ink-3 and the signal', () => {
    const painted = paintedRowStates(code)
    const lifted = new Set(liftSelectors(code))
    // The four row kinds each have a hover and a selection state at least.
    expect(painted.length).toBeGreaterThanOrEqual(8)
    expect(painted.filter(s => !lifted.has(s))).toEqual([])
  })
})

describe('the guard itself (mutants run through the SAME predicate)', () => {
  it('the lift check sees a new painted state that does not lift', () => {
    const extra = code.replace(/\}\s*$/, '  .bn-trow[data-flash="true"] { background-color: var(--color-hover); }\n}')
    const painted = paintedRowStates(extra)
    const lifted = new Set(liftSelectors(extra))
    expect(painted.filter(s => !lifted.has(s))).toEqual(['.bn-trow[data-flash="true"]'])
  })

  it('catches a background ternary, a template-literal border ternary and a spread-free opacity ternary', () => {
    expect(inlineStateTernaries(`<div style={{ backgroundColor: selected ? 'x' : 'y' }} />`)).toHaveLength(1)
    expect(inlineStateTernaries('<div style={{ border: `1px solid ${a ? C.x : C.y}`, width: 3 }} />')).toHaveLength(1)
    expect(inlineStateTernaries(`<div style={{ width: 3,\n  opacity: off ? 0.5 : 1 }} />`)).toHaveLength(1)
  })

  it('passes data (a custom property, optional chaining, nullish, a layout ternary)', () => {
    expect(inlineStateTernaries(`<div style={{ '--chip-color': a ? b : c, color: meta?.color ?? C.x, minWidth: inline ? 88 : undefined }} />`)).toEqual([])
  })
})
