// =============================================================================
// dashboardCss.test.js — UI overhaul C2, 2026-09-11.
//
// `dashboard.css` is imported from a component, so the bundler can emit it
// BEFORE `src/index.css`. A cascade layer's position is fixed where it is
// FIRST named, not where its rules are written — so a stylesheet that opens
// `@layer components` without naming the order first can create `components`
// ahead of `base` and put every rule in it, this surface's AND all of
// `src/ui/`, behind Tailwind's preflight. D1 shipped exactly that and 2136
// tests stayed green, because nothing in this repo mounts React. Their
// `settingsCss.test.js` is this file's model; the assertions are the same
// three, because the failure mode is the same one.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const dashboardCss = read('./dashboard.css')
const indexCss = read('../../index.css')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const code = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('dashboard.css declares the cascade layer order before it uses a layer', () => {
  const src = code(dashboardCss)

  it('names all four layers, in Tailwind order, as a statement', () => {
    expect(src).toMatch(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
  })

  it('🚨 the statement comes BEFORE the first @layer block, which is the whole point', () => {
    const statement = src.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = src.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThanOrEqual(0)
    expect(statement).toBeLessThan(firstBlock)
  })

  it('the order matches the one Tailwind emits, so the statement is a no-op when index.css leads', () => {
    expect(code(indexCss)).toMatch(/@import\s+["']tailwindcss["']/)
    const ours = src.match(/@layer\s+([a-z,\s]+);/)[1].split(',').map((s) => s.trim())
    expect(ours).toEqual(['theme', 'base', 'components', 'utilities'])
  })
})

describe('the state extraction left no inline branch behind', () => {
  // The point of the extraction commit: a state that still lives in an inline
  // `style` ternary beats every class written next to it, so the restyle that
  // follows would silently drop it (plan §1, risk 4). These read the three
  // source files as text and assert the branches are gone.
  const files = {
    'DashboardPage.jsx': read('./DashboardPage.jsx'),
    'DashboardTasksView.jsx': read('./DashboardTasksView.jsx'),
    'NotesView.jsx': read('./NotesView.jsx'),
  }

  it('no `style={...? ... : ...}` two-branch ternary remains on any of the three files', () => {
    const offenders = []
    for (const [name, src] of Object.entries(files)) {
      // A style prop whose value opens a conditional: `style={x ? {` or
      // `style={{ ... cond ? ... : ... }}` carrying a COLOUR.
      const re = /style=\{\{?[^}]*\?[^}]*:[^}]*\}/g
      for (const m of src.match(re) || []) {
        if (/background|color|border|boxShadow|opacity/i.test(m)) offenders.push(`${name}: ${m.slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every state class the JSX names has a rule in dashboard.css', () => {
    const used = new Set()
    for (const src of Object.values(files)) {
      for (const m of src.match(/\bdash-[a-z-]+/g) || []) used.add(m)
    }
    const declared = new Set((code(dashboardCss).match(/\.dash-[a-z-]+/g) || []).map((s) => s.slice(1)))
    const missing = [...used].filter((c) => !declared.has(c))
    expect(missing).toEqual([])
  })

  it('every rule in dashboard.css has a caller in the JSX (no dead state)', () => {
    const declared = new Set((code(dashboardCss).match(/\.dash-[a-z-]+/g) || []).map((s) => s.slice(1)))
    const used = new Set()
    for (const src of Object.values(files)) {
      for (const m of src.match(/\bdash-[a-z-]+/g) || []) used.add(m)
    }
    const orphans = [...declared].filter((c) => !used.has(c))
    expect(orphans).toEqual([])
  })
})
