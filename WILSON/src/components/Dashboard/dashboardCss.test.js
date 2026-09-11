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
// `settingsCss.test.js` is this file's model; the first three assertions are
// the same three, because the failure mode is the same one.
//
// The rest pin the state extraction: a state that still lives in an inline
// `style` ternary beats every class written beside it, so a restyle would
// drop it silently (plan §1, risk 4). These are cheap source-text checks —
// they cannot prove the page LOOKS right, which is what the screenshots and
// the two review rounds are for — but they can prove that no branch was left
// behind and that no rule is dead.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TASK_COLUMNS } from './dashboardTaskModel'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const dashboardCss = read('./dashboard.css')
const indexCss = read('../../index.css')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const code = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const files = {
  'DashboardPage.jsx': read('./DashboardPage.jsx'),
  'DashboardTasksView.jsx': read('./DashboardTasksView.jsx'),
  'NotesView.jsx': read('./NotesView.jsx'),
}

// Only `className` values count. `dash-group-by` and `dash-sort-by` are
// element IDS — the two toolbar selects that their <label> points at — and a
// rule for them would be a rule that styles nothing.
// A className is either a literal or a braced expression — the refresh
// button's spin class is `className={mt.loading ? 'dash-spin' : ''}`, which a
// literal-only match would miss and then report as a dead rule.
const classesIn = (src) => {
  const out = new Set()
  for (const m of src.match(/className=(?:"[^"]*"|\{[^}]*\})/g) || []) {
    for (const c of m.match(/dash-[a-z-]+/g) || []) out.add(c)
  }
  return out
}

const usedClasses = () => {
  const used = new Set()
  for (const src of Object.values(files)) for (const c of classesIn(src)) used.add(c)
  return used
}

const declaredClasses = () =>
  new Set((code(dashboardCss).match(/\.dash-[a-z-]+/g) || []).map((s) => s.slice(1)))

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

describe('the surface writes no colour of its own', () => {
  it('🚨 no hex literal anywhere in the rules (C8: @theme is the only place a hex is written)', () => {
    expect(code(dashboardCss).match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([])
  })

  it('no rgb()/rgba() literal either — the alpha tokens are in @theme too', () => {
    expect(code(dashboardCss).match(/\brgba?\(/g) || []).toEqual([])
  })

  it('every custom property it reads is defined in index.css', () => {
    const used = new Set((code(dashboardCss).match(/var\(--[a-z0-9-]+/g) || []).map((v) => v.slice(4)))
    const defined = new Set((code(indexCss).match(/^\s*--[a-z0-9-]+(?=\s*:)/gm) || []).map((v) => v.trim()))
    // The profile bridge REDEFINES light tokens inside its own subtree; those
    // are reads of index.css's own names, so they are covered by `defined`.
    const missing = [...used].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
  })

  it('the three JSX files import no page-local palette any more', () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).not.toMatch(/from '\.\.\/lightSurface'/)
      expect(src, name).not.toMatch(/^const L = \{/m)
    }
  })
})

describe('the state extraction left no inline branch behind', () => {
  it('no `style={...? ... : ...}` colour ternary remains on any of the three files', () => {
    const offenders = []
    for (const [name, src] of Object.entries(files)) {
      const re = /style=\{\{?[^}]*\?[^}]*:[^}]*\}/g
      for (const m of src.match(re) || []) {
        if (/background|color|border|boxShadow|opacity/i.test(m)) offenders.push(`${name}: ${m.slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every state class the JSX names has a rule in dashboard.css', () => {
    const declared = declaredClasses()
    expect([...usedClasses()].filter((c) => !declared.has(c))).toEqual([])
  })

  it('every rule in dashboard.css has a caller in the JSX (no dead state)', () => {
    const used = usedClasses()
    expect([...declaredClasses()].filter((c) => !used.has(c))).toEqual([])
  })

  it('🚨 both drag-over branches survive — they are the one state with no test of their own', () => {
    const view = files['DashboardTasksView.jsx']
    // The group band and the kanban column. Drag feedback is driven by a
    // dragCountRef enter/leave counter, nothing renders it in a test, and a
    // restyle that drops a branch loses it silently (review rework risk 3).
    expect((view.match(/data-dragover=\{String\(dragOver\)\}/g) || []).length).toBe(2)
    // 🚨 The group band's fill MUST land on the CELL, not the row: the band's
    // own rule paints `.dash-group-row > .ui-td` transparent, so a fill on the
    // <tr> is painted straight over and the drag target goes silent. Dropping
    // "> .ui-td" from this selector kept the looser regex green (review round
    // 1, finding 13a). The interaction half is in DashboardTasksView.test.jsx.
    expect(code(dashboardCss)).toMatch(/\.dash-group-row\[data-dragover="true"\]\s*>\s*\.ui-td/)
    expect(code(dashboardCss)).toMatch(/\.dash-kanban-col\[data-dragover="true"\]/)
  })

  it('🚨 no page rule that targets a kit element merely TIES the kit', () => {
    // MEASURED in the running app: the sheet order is settings.css, then
    // dashboard.css, then index.css — so this file is emitted BEFORE the kit
    // and, both being in `@layer components`, it loses every specificity tie.
    // A page rule that only ties is a page rule that does nothing, and the
    // failure is silent (review round 1, finding 5).
    const weak = []
    for (const block of code(dashboardCss).split('}')) {
      const head = block.split('{')[0]
      if (!head.includes('.ui-')) continue
      for (const one of head.split(',')) {
        const sel = one.trim()
        if (!sel || !sel.includes('.ui-')) continue
        const units = (sel.match(/\.[a-zA-Z][\w-]*/g) || []).length
          + (sel.match(/\[[^\]]+\]/g) || []).length
          + (sel.match(/#[\w-]+/g) || []).length
        if (units < 2) weak.push(sel)
      }
    }
    expect(weak).toEqual([])
  })
})

describe('the task table declares its own grid', () => {
  it('🚨 the column widths sum to EXACTLY 100', () => {
    // `table-layout: fixed` hands any excess back to the browser to
    // reconcile, so a set that over-sums is not a declaration at all: every
    // column lands somewhere other than where it was written. F2 shipped
    // three cuts of the Team Members table that each claimed 100 in a comment
    // and twice did not, which is why this is computed and not asserted.
    const total = TASK_COLUMNS.reduce((n, c) => n + parseFloat(c.width), 0)
    expect(Math.round(total * 100) / 100).toBe(100)
  })

  it('every column is a percentage — a stray pixel value is a sum nobody can add up', () => {
    for (const c of TASK_COLUMNS) expect(c.width, c.key).toMatch(/^[\d.]+%$/)
  })

  it('the two date columns are the numeric ones, so they right-align with tabular figures', () => {
    expect(TASK_COLUMNS.filter((c) => c.numeric).map((c) => c.key)).toEqual(['start', 'end'])
  })
})
