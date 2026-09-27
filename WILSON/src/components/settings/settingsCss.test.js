// =============================================================================
// settingsCss.test.js — UI overhaul D1, 2026-09-11.
//
// 🚨 THIS FILE EXISTS BECAUSE A ONE-LINE OMISSION UNSTYLED THE ENTIRE
// COMPONENT KIT AND 2136 TESTS STAYED GREEN.
//
// `settings.css` is imported from a component, so the bundler can emit it
// BEFORE `src/index.css`. A cascade layer's position is fixed where it is
// FIRST named, not where its rules are written — so the moment this file
// opened `@layer components` without naming the order first, `components` was
// created ahead of `base`, and every rule in it, this surface's AND all of
// `src/ui/`, lost to Tailwind's preflight. Buttons had no fill, tabs had no
// padding, inputs had no well, on every page in the app.
//
// The symptom was specific and easy to misread: `height` survived (preflight
// does not set it) while `padding`, `font-size`, `color` and
// `background-color` were silently reset. Nothing in this repo mounts React,
// so no test noticed. It was found by opening the running app.
//
// These assertions are cheap source-text checks in the tradition of
// `workspaceRootWiring.test.js`: they cannot prove the page LOOKS right, but
// they can prove the two things whose absence caused that failure, and they
// fail loudly if a later session deletes either.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const settingsCss = read('./settings.css')
const indexCss = read('../../index.css')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const code = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('settings.css declares the cascade layer order before it uses a layer', () => {
  const src = code(settingsCss)

  it('names all four layers, in Tailwind order, as a statement', () => {
    expect(src).toMatch(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  })

  it('🚨 the statement comes BEFORE the first @layer block, which is the whole point', () => {
    const statement = src.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = src.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThanOrEqual(0)
    // If this ever inverts, `components` is created after `base` only by luck
    // of bundle order, and the kit renders unstyled with every test green.
    expect(statement).toBeLessThan(firstBlock)
  })

  it('the order matches the one Tailwind itself emits, so the statement is a no-op when index.css leads', () => {
    // `@import "tailwindcss"` expands to this same set; if Tailwind ever
    // changes it, this test is where the mismatch surfaces rather than in a
    // screenshot nobody takes.
    expect(code(indexCss)).toMatch(/@import\s+["']tailwindcss["']/)
    const ours = src.match(/@layer\s+([a-z,\s]+);/)[1].split(',').map((s) => s.trim())
    expect(ours).toEqual(['theme', 'base', 'components', 'utilities'])
  })
})

describe('the surface writes no colour of its own', () => {
  it('🚨 no hex literal anywhere in the rules (C8: @theme is the only place a hex is written)', () => {
    const hexes = code(settingsCss).match(/#[0-9a-fA-F]{3,8}\b/g) || []
    expect(hexes).toEqual([])
  })

  it('no rgb()/rgba() literal either — the alpha tokens are in @theme too', () => {
    const fns = code(settingsCss).match(/\brgba?\(/g) || []
    expect(fns).toEqual([])
  })

  it('every custom property it reads is defined in index.css', () => {
    const used = new Set((code(settingsCss).match(/var\(--[a-z0-9-]+/g) || []).map((v) => v.slice(4)))
    const defined = new Set((code(indexCss).match(/^\s*--[a-z0-9-]+(?=\s*:)/gm) || []).map((v) => v.trim()))
    const missing = [...used].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
  })
})

describe('the scrollbar override can actually beat the one it overrides', () => {
  // index.css's `.wilson-light-scroll *::-webkit-scrollbar-thumb` is UNLAYERED,
  // and an unlayered declaration beats a layered one at any specificity. A
  // layered override of it is an inert rule that still measures orange — which
  // is what shipped in the first pass and what review round 2 caught.
  const src = code(settingsCss)

  it('🚨 the dark-island scrollbar rules sit OUTSIDE every @layer block', () => {
    const idx = src.indexOf(".s-log[data-surface='dark']::-webkit-scrollbar-thumb")
    expect(idx).toBeGreaterThan(-1)
    // Everything after the last closing brace of the layered section is
    // unlayered. Count braces up to the rule: inside a layer the depth is > 0.
    const before = src.slice(0, idx)
    const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length
    expect(depth).toBe(0)
  })

  it('carries a second class so it out-specifies .wilson-light-scroll', () => {
    expect(src).toMatch(/\.s-log\[data-surface='dark'\]::-webkit-scrollbar-thumb/)
    expect(src).toMatch(/\.s-currency-menu\[data-surface='dark'\]::-webkit-scrollbar-thumb/)
  })
})

// P1-46: the two ON/OFF toggles are the kit Switch on its light track (D1's
// kit request 4 landed), and the segments and lock button that shared their
// rule are set as the kit's small Button is: sentence case, never the
// capitalised Label step (Q2).
describe('Settings controls are sentence case, and the toggles are the kit Switch (P1-46)', () => {
  const page = read('../SettingsPage.jsx')
  const segRule = (css) => {
    const c = code(css)
    const at = c.search(/\n\s*\.s-seg,\s*\n\s*\.s-lock\s*\{/)
    return at < 0 ? null : c.slice(at, c.indexOf('}', at))
  }
  it('no .s-toggle rule is left, and .s-seg / .s-lock are Dense with no capitals or tracking', () => {
    expect(code(settingsCss)).not.toMatch(/\.s-toggle\b/)
    const rule = segRule(settingsCss)
    expect(rule).not.toBeNull()
    expect(rule).toMatch(/font-size:\s*var\(--text-dense\)/)
    expect(rule).not.toMatch(/text-transform|letter-spacing|--text-label/)
  })
  // `[\s\S]{0,200}?`, not `[^>]*`: the props hold an arrow (`(on) => …`).
  const switchNamed = (src, name) => new RegExp(`<Switch\\s+surface="light"[\\s\\S]{0,200}?aria-label="${name}"`).test(src)
  it('Pet mode and Agent mode are <Switch surface="light">, named by aria-label', () => {
    for (const name of ['Pet mode', 'Agent mode']) expect(switchNamed(page, name), name).toBe(true)
    expect(page).not.toMatch(/className="s-toggle"/)
    expect(page).toMatch(/d\.charAt\(0\)\.toUpperCase\(\) \+ d\.slice\(1\)/)
  })
  it('CONTROL: the rule and the button as they stood before P1 are caught', () => {
    const before = '\n  .s-toggle,\n  .s-seg,\n  .s-lock {\n    font-size: var(--text-label);\n    letter-spacing: 0.06em;\n    text-transform: uppercase;\n  }'
    expect(code(before)).toMatch(/\.s-toggle\b/)
    expect(segRule(before)).toMatch(/text-transform/)
    expect(switchNamed('<button type="button" className="s-toggle" data-on={!!agentEnabled}>', 'Agent mode')).toBe(false)
    expect(switchNamed('<Switch\n  surface="light"\n  checked={!!agentEnabled}\n  aria-label="Agent mode"', 'Agent mode')).toBe(true)
  })
})

// P1-81 (V1-16): the note's WELL fills the column, so its right edge meets
// the groups' rules; its TEXT keeps §3.1's 72ch cap through the right
// padding. And the pet card keeps no gap for a stats row it does not draw.
describe('Settings aligns its wells with its rules (P1-81)', () => {
  const noteRule = (css) => {
    const c = code(css)
    const at = c.indexOf('\n  .s-note {')
    return at < 0 ? null : c.slice(at, c.indexOf('}', at))
  }
  it('the note has no max-width of its own, and caps its text with the 72ch padding', () => {
    const rule = noteRule(settingsCss)
    expect(rule).not.toBeNull()
    expect(rule).not.toMatch(/max-width/)
    expect(rule).toMatch(/padding:\s*8px max\(12px, calc\(100% - var\(--measure-prose-max\)\)\) 8px 12px/)
  })
  it('the pet card\'s header row spaces itself only when the stats row follows', () => {
    const page = read('../SettingsPage.jsx')
    expect(page).toMatch(/gap-4\$\{\(form === 'baby' \|\| form === 'adult'\) \? ' mb-3' : ''\}/)
    expect(page).not.toMatch(/<div className="flex items-center justify-between gap-4 mb-3">\s*<div className="min-w-0">\s*<span className="s-card-title">/)
  })
  it('CONTROL: the note as it stood before P1 is caught', () => {
    expect(noteRule('\n  .s-note {\n    margin-top: 16px;\n    max-width: var(--measure-reading);\n    padding: 8px 12px;\n  }')).toMatch(/max-width/)
  })
})

// P1-47: a native select has no ellipsis; the model select must hold its
// longest value (335px measured in the app) rather than cut it mid-word.
describe('the model select holds its longest value (P1-47)', () => {
  const selectWidth = (css) => {
    const c = code(css)
    const at = c.indexOf('\n  .s-model-select {')
    if (at < 0) return null
    const m = c.slice(at, c.indexOf('}', at)).match(/width:\s*(\d+)px/)
    return m ? Number(m[1]) : null
  }
  it('is at least 335px wide', () => {
    expect(selectWidth(settingsCss)).toBeGreaterThanOrEqual(335)
  })
  it('CONTROL: the 220px it had is caught', () => {
    expect(selectWidth('\n  .s-model-select {\n    flex: none;\n    width: 220px;\n  }')).toBeLessThan(335)
  })
})
