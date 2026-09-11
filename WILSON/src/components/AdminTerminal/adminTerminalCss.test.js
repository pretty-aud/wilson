// =============================================================================
// adminTerminal.css — the guard.
//
// Modelled on `src/components/Dashboard/dashboardCss.test.js` and
// `src/components/settings/settingsCss.test.js`. It guards three different
// kinds of silent failure, all of which have actually shipped in this repo:
//
//   1. THE CASCADE LAYER. D1 wrote `@layer components { … }` in a stylesheet
//      imported from a component; the bundler emitted it before
//      `src/index.css`, so `components` was created ahead of `base`, every
//      rule in it fell behind Tailwind's preflight, and the ENTIRE kit
//      rendered unstyled — with all 2136 tests green, because no test in this
//      repo applies CSS. The layer order must be declared before any rule.
//
//   2. DEAD STATE. A rule whose class no caller names does nothing; a class a
//      caller names with no rule drops the state it was supposed to carry.
//      The state extraction is worthless if either can happen unnoticed.
//
//   3. THE TRANSCRIPTION. This sheet lands in commit one carrying literal
//      hex values on purpose, so the diff of commit two is the visual change
//      and nothing else. C8 says no hex outside `@theme`, so those literals
//      are a debt — and a debt nobody counts is a debt nobody repays. The
//      count below is the ledger: commit two drives it to zero, and the
//      assertion has to be edited to let that happen.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'adminTerminal.css'), 'utf8')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const jsxFiles = readdirSync(here).filter((f) => f.endsWith('.jsx'))
const jsx = jsxFiles
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

describe('adminTerminal.css declares the cascade layer before it uses one', () => {
  it('names the four layers as its first statement', () => {
    const first = code(css).trim()
    expect(first.startsWith('@layer theme, base, components, utilities;')).toBe(true)
  })

  it('the declaration precedes the first `@layer components {` block', () => {
    const body = code(css)
    expect(body.indexOf('@layer theme, base, components, utilities;'))
      .toBeLessThan(body.indexOf('@layer components {'))
  })

  it('the order matches the one Tailwind emits', () => {
    // theme → base → components → utilities. A page rule must lose to a
    // caller's utility and beat the kit's own defaults, which only holds if
    // `components` sits between `base` and `utilities`.
    expect(code(css)).toMatch(/@layer\s+theme,\s*base,\s*components,\s*utilities;/)
  })

  it('every rule lives inside `@layer components`', () => {
    // An UNLAYERED rule beats every Tailwind utility at any specificity, so
    // an unlayered page rule would stop a caller ever adding a layout class
    // on top of one of these elements.
    const body = code(css)
    const afterDeclaration = body.slice(body.indexOf('@layer components {'))
    // Nothing but whitespace between the layer statement and the block.
    const between = body.slice(
      body.indexOf(';', body.indexOf('@layer theme')) + 1,
      body.indexOf('@layer components {'),
    )
    expect(between.trim()).toBe('')
    expect(afterDeclaration.trim().endsWith('}')).toBe(true)
  })
})

describe('the state extraction has no dead ends', () => {
  const rules = new Set([...code(css).matchAll(/\.(at-[a-z0-9-]+)/g)].map((m) => m[1]))
  const used = new Set([...jsx.matchAll(/\b(at-[a-z0-9-]+)/g)].map((m) => m[1]))

  it('every class the JSX names has a rule', () => {
    expect([...used].filter((c) => !rules.has(c))).toEqual([])
  })

  it('every rule has a caller', () => {
    expect([...rules].filter((c) => !used.has(c))).toEqual([])
  })

  it('every data attribute the CSS selects on is written by the JSX', () => {
    const selected = new Set([...code(css).matchAll(/\[(data-[a-z-]+)/g)].map((m) => m[1]))
    const written = new Set([...jsx.matchAll(/(data-[a-z-]+)=/g)].map((m) => m[1]))
    expect([...selected].filter((a) => !written.has(a))).toEqual([])
  })

  it('🚨 no `hover:` utility survives on an element whose rest state is an inline style', () => {
    // The whole reason the extraction exists: an inline `style` object beats
    // a `hover:` class at any specificity, so the two cannot co-exist on one
    // element. Rather than try to pair them up, this asserts the simpler and
    // stronger thing — this directory has no Tailwind hover utility left at
    // all, because every hover it had was one of those pairs.
    expect(jsx).not.toMatch(/hover:bg-/)
  })

  it('🚨 opacity is no longer spelled as a disabled state in the JSX', () => {
    // Plan §3.1: disabled is one token (ink at 52 percent plus
    // `cursor: not-allowed`), never `opacity-30/40/50`. The two transcribed
    // classes below still carry the old values; the JSX must not.
    expect(jsx).not.toMatch(/disabled:opacity-/)
  })
})

describe('the transcription ledger (commit one only)', () => {
  // 🚨 WHEN COMMIT TWO LANDS, THIS NUMBER GOES TO 0 AND THE `toBe` BELOW
  // BECOMES THE C8 ASSERTION THE OTHER PAGE SHEETS CARRY:
  //     expect(hexes).toEqual([])
  // Until then it is a ledger, not a licence: it may only ever go DOWN.
  const TRANSCRIBED_HEXES = 35

  it('carries exactly the transcribed hex values, and no more', () => {
    const hexes = [...code(css).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    expect(hexes.length).toBe(TRANSCRIBED_HEXES)
  })

  it('reads no design token yet, because commit one changes nothing visually', () => {
    // A `var(--color-…)` in this file would mean a value moved, which is
    // exactly what commit one promises not to do.
    expect(code(css)).not.toMatch(/var\(--color-/)
  })
})
