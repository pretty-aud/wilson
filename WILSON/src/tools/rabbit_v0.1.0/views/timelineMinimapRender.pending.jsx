/** @vitest-environment jsdom */
// =============================================================================
// The Timeline minimap, RENDERED (UI overhaul B3, Audrey's Q22: "every phase
// drawn, no silent truncation after six, legible labels").
//
// ⏸ PENDING — B3's hand-off (docs/sessions/handoffs/ui-b3-2026-09-24.md §4).
// This file is NOT run: vitest includes `*.test.{js,jsx}` only. It is the DOM
// contract the minimap wiring must meet, written before the wiring. The
// session that exports OverviewPane and wires it to timelineMinimap.js
// renames it to timelineMinimapRender.test.jsx in the same commit, and it
// must pass there unedited except where the hand-off says it may change.
//
// Mounts the real OverviewPane with N phases and counts what it draws against
// the data. jsdom has no layout, so every position is read where the
// component writes it — the inline `top` / `height` / `left` of each row, the
// body's height — which is also exactly what decides whether the browser
// clips a row. The running-app count at every zoom is
// scripts/timeline-minimap-count.mjs; the arithmetic is timelineMinimap.test.js.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ({}) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))

const { OverviewPane } = await import('./TimelineView.jsx')
const { minimapLayout, estimateWidth, LABEL_GAP } = await import('./timelineMinimap.js')

afterEach(cleanup)

const day = (y, m, d) => new Date(y, m, d)
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** N phases, one after another, `len` days each, `gap` days apart, from `from`. */
function project(n, { from = day(2026, 7, 1), len = 20, gap = 5, children = 0 } = {}) {
  const phases = []
  const schedule = { phases: {}, tasks: {} }
  for (let i = 0; i < n; i++) {
    const start = addDays(from, i * (len + gap))
    const end = addDays(start, len)
    const id = `p${i}`
    phases.push({ id, name: `Phase ${i + 1}`, parent_phase_id: null, start_date: start.toISOString(), end_date: end.toISOString() })
    schedule.phases[id] = { start, end }
    for (let c = 0; c < children; c++) {
      const cid = `${id}c${c}`
      phases.push({ id: cid, name: `Phase ${i + 1}.${c + 1}`, parent_phase_id: id })
      schedule.phases[cid] = { start, end: addDays(start, Math.max(1, len >> 1)) }
    }
  }
  return { phases, schedule }
}

function mount({ phases, schedule }, { spanStart, spanDays, width = 1400 }) {
  const span = { start: spanStart, end: addDays(spanStart, spanDays), days: spanDays, center: addDays(spanStart, spanDays >> 1) }
  const noop = () => {}
  return render(
    <OverviewPane
      ref={createRef()}
      groupBy="phase" phases={phases} assets={[]} tasks={[]} schedule={schedule}
      criticalSet={new Set()} span={span} dayPx={width / spanDays} sortOrder="asc"
      visibleStartDate={spanStart} visibleEndDate={addDays(spanStart, 30)}
      zoomMinDays={183} zoomMaxDays={1825}
      scenes={[]} shots={[]} levels={[]} experiences={[]} teamAssignments={[]} teamMembers={[]}
      onScrollDetailToDate={noop} onPanMinimap={noop} onZoomMinimap={noop}
      onUpdateTask={noop} onUpdatePhase={noop} onEditTask={noop} onEditPhase={noop}
      canWrite writeReason={null} milestones={[]}
    />,
  )
}

const px = (el, prop) => parseFloat(el.style[prop])
const rowsOf = (c) => [...c.querySelectorAll('[data-minimap-row]')]

/** Every phase has a row that lies wholly inside the body, and shows either a bar or an edge marker. */
function drawnAgainstData(container, phases) {
  const body = container.querySelector('[data-minimap-body]')
  const bodyH = px(body, 'height')
  const rows = rowsOf(container)
  const ids = new Set(rows.map((r) => r.getAttribute('data-minimap-row')))
  const inside = rows.filter((r) => px(r, 'top') >= 0 && px(r, 'top') + px(r, 'height') <= bodyH + 0.001)
  const shown = rows.filter((r) => r.querySelector('[data-minimap-bar], [data-minimap-edge]'))
  return { data: phases.length, rows: rows.length, ids: ids.size, inside: inside.length, shown: shown.length, bodyH }
}

describe('the minimap draws every phase (Q22)', () => {
  for (const n of [1, 5, 6, 9, 12, 30]) {
    it(`${n} phase${n === 1 ? '' : 's'}: ${n} rows, every one inside the body, every one drawn`, () => {
      const p = project(n)
      const { container } = mount(p, { spanStart: day(2026, 6, 1), spanDays: 1825 })
      const r = drawnAgainstData(container, p.phases)
      expect(r).toEqual({ data: n, rows: n, ids: n, inside: n, shown: n, bodyH: minimapLayout(n).bodyH })
    })
  }

  it('sub-phases count as phases: 4 parents with 2 children each is 12 rows', () => {
    const p = project(4, { children: 2 })
    const { container } = mount(p, { spanStart: day(2026, 6, 1), spanDays: 730 })
    const r = drawnAgainstData(container, p.phases)
    expect(r.data).toBe(12)
    expect(r).toMatchObject({ rows: 12, inside: 12, shown: 12 })
  })

  it('CONTROL: the old geometry would have cut the sixth phase — 22px rows in a 124px body', () => {
    // What this file replaced, as arithmetic: row k's bottom is 22(k+1).
    const bottoms = Array.from({ length: 9 }, (_, k) => 22 * (k + 1))
    expect(bottoms.filter((b) => b <= 124)).toHaveLength(5)
  })
})

describe('a phase outside the window keeps its row and says where it went', () => {
  it('at a six-month window, the phases before and after it carry an edge marker, never an empty row', () => {
    const p = project(12, { from: day(2026, 0, 1), len: 25, gap: 10 }) // Jan 2026 – mid 2027
    const { container } = mount(p, { spanStart: day(2026, 4, 1), spanDays: 183 })
    const rows = rowsOf(container)
    const edges = rows.map((r) => r.querySelector('[data-minimap-edge]')?.getAttribute('data-minimap-edge') ?? null)
    const bars = rows.filter((r) => r.querySelector('[data-minimap-bar]')).length
    expect(edges.filter((e) => e === 'before').length).toBeGreaterThan(0)
    expect(edges.filter((e) => e === 'after').length).toBeGreaterThan(0)
    expect(bars + edges.filter(Boolean).length).toBe(12)
  })
})

describe('the names, and the axis, are legible', () => {
  it('while rows are 18px or taller each drawn bar is named; below that no name is drawn under the floor', () => {
    const few = project(9)
    const { container: a } = mount(few, { spanStart: day(2026, 6, 1), spanDays: 730 })
    expect(minimapLayout(9).named).toBe(true)
    expect(a.querySelectorAll('[data-minimap-name]').length).toBe(9)
    cleanup()
    const many = project(30)
    const { container: b } = mount(many, { spanStart: day(2026, 6, 1), spanDays: 1825 })
    expect(minimapLayout(30).named).toBe(false)
    expect(b.querySelectorAll('[data-minimap-name]').length).toBe(0)
  })

  it('names and axis labels are set in a scale step at or above the 11px floor (Caption)', () => {
    const { container } = mount(project(5), { spanStart: day(2026, 6, 1), spanDays: 730 })
    const text = [...container.querySelectorAll('[data-minimap-name], [data-minimap-tick-label]')]
    expect(text.length).toBeGreaterThan(5)
    for (const el of text) expect(el.className).toMatch(/\btext-caption\b/)
  })

  it('no two axis labels overprint, at every span the slider offers (V1-07)', () => {
    for (const days of [183, 365, 730, 857, 1825]) {
      for (const width of [1024, 1400]) {
        const { container } = mount(project(5), { spanStart: day(2026, 6, 1), spanDays: days, width })
        const labels = [...container.querySelectorAll('[data-minimap-tick-label]')]
          .map((el) => ({ left: px(el.parentElement, 'left'), text: el.textContent }))
          .sort((a, b) => a.left - b.left)
        expect(labels.length, `${days}d at ${width}px`).toBeGreaterThan(1)
        for (let k = 1; k < labels.length; k++) {
          expect(labels[k - 1].left + estimateWidth(labels[k - 1].text) + LABEL_GAP, `${days}d at ${width}px: "${labels[k - 1].text}" / "${labels[k].text}"`)
            .toBeLessThanOrEqual(labels[k].left + 0.001)
        }
        cleanup()
      }
    }
  })
})
