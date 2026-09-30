/** @vitest-environment jsdom */
// =============================================================================
// The Timeline minimap, RENDERED (UI overhaul B3, Audrey's Q22: "every phase
// drawn, no silent truncation after six, legible labels").
//
// Written by B3 as a PENDING contract (timelineMinimapRender.pending.jsx),
// before the wiring; B3b wired OverviewPane to timelineMinimap.js and renamed
// it here in the same commit. ONE edit, to an assumption about the
// environment rather than the DOM: jsdom has no ResizeObserver, which the
// minimap's scrollbar (MinimapScrollbar) creates on mount, so the stub
// below. Every assertion is B3's, unedited.
//
// Mounts the real OverviewPane with N phases and counts what it draws against
// the data. jsdom has no layout, so every position is read where the
// component writes it — the inline `top` / `height` / `left` of each row, the
// body's height — which is also exactly what decides whether the browser
// clips a row. The running-app count at every zoom is
// scripts/timeline-minimap-count.mjs; the arithmetic is timelineMinimap.test.js.
// =============================================================================

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { createRef, useState } from 'react'
import { DURATION } from '../../../ui/tokens.js'
import { Tabs } from '../../../ui/Tabs'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ({}) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))

// jsdom has no layout and so no ResizeObserver; MinimapScrollbar measures its
// track with one. Nothing here reads that width (the scrollbar's thumb is not
// part of the contract), so a no-op observer is the whole of it.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

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

function mount({ phases, schedule }, { spanStart, spanDays, width = 1400, milestones = [] }) {
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
      canWrite writeReason={null} milestones={milestones}
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

describe('the window animates after a zoom change, and only then — post-overhaul S1 (ruling B7)', () => {
  afterEach(() => { vi.useRealTimers() })
  const noop = () => {}
  const spanStart = day(2026, 6, 1)
  /** Everything OverviewPane takes; each test changes one thing at a time. */
  const props = (over = {}) => {
    const p = project(5)
    const spanDays = over.spanDays ?? 730
    const width = 1400
    return {
      groupBy: 'phase', phases: p.phases, assets: [], tasks: [], schedule: p.schedule, criticalSet: new Set(),
      span: { start: spanStart, end: addDays(spanStart, spanDays), days: spanDays, center: addDays(spanStart, spanDays >> 1) },
      dayPx: width / spanDays, sortOrder: 'asc',
      visibleStartDate: addDays(spanStart, 60), visibleEndDate: addDays(spanStart, 120),
      zoomMinDays: 183, zoomMaxDays: 1825,
      scenes: [], shots: [], levels: [], experiences: [], teamAssignments: [], teamMembers: [],
      onScrollDetailToDate: noop, onPanMinimap: noop, onZoomMinimap: noop,
      onUpdateTask: noop, onUpdatePhase: noop, onEditTask: noop, onEditPhase: noop,
      canWrite: true, writeReason: null, milestones: [], detailZoom: 'week',
      ...over,
    }
  }
  const animated = (c) => [...c.querySelectorAll('.rb-tl-ov-frame, .rb-tl-ov-frame-edge')].map((el) => el.getAttribute('data-animate'))

  it('a new zoom raises data-animate on both layers in the same render, for one --duration-response, then drops it', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    expect(animated(container)).toEqual(['false', 'false'])
    // Day zoom: the same left edge, a window a third as wide.
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'day', visibleEndDate: addDays(spanStart, 80) })} />)
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(DURATION.response - 1) })
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(1) })
    expect(animated(container)).toEqual(['false', 'false'])
    expect(DURATION.response).toBe(200)
  })

  it('a second zoom change inside the window restarts it', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'day' })} />)
    act(() => { vi.advanceTimersByTime(150) })
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'month' })} />)
    act(() => { vi.advanceTimersByTime(150) })
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(50) })
    expect(animated(container)).toEqual(['false', 'false'])
  })

  it('everything else that moves the window stays instant: scroll-follow, the zoom slider / Fit / Today / Ctrl+wheel (a new span), a resize (a new dayPx)', () => {
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    rerender(<OverviewPane ref={createRef()} {...props({ visibleStartDate: addDays(spanStart, 90), visibleEndDate: addDays(spanStart, 150) })} />)
    expect(animated(container)).toEqual(['false', 'false'])
    rerender(<OverviewPane ref={createRef()} {...props({ spanDays: 365 })} />)
    expect(animated(container)).toEqual(['false', 'false'])
    rerender(<OverviewPane ref={createRef()} {...props({ spanDays: 365, dayPx: 2 })} />)
    expect(animated(container)).toEqual(['false', 'false'])
  })

  it('the zoom tabs, by click and by keyboard (the arrows move focus, Space or Enter presses the tab), are what raise it', () => {
    vi.useFakeTimers()
    const ZOOMS = ['day', 'week', 'month', 'quarter']
    function Harness() {
      // TimelineView's wiring: the Tabs set zoomId, OverviewPane reads it.
      const [zoomId, setZoomId] = useState('week')
      return (
        <>
          <Tabs label="Detail zoom" panelId="rb-tl-detail" items={ZOOMS.map((id) => ({ id, label: id }))} value={zoomId} onChange={setZoomId} />
          <OverviewPane ref={createRef()} {...props({ detailZoom: zoomId })} />
        </>
      )
    }
    const { container, getByRole } = render(<Harness />)
    fireEvent.click(getByRole('tab', { name: 'day' }))
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(DURATION.response) })
    expect(animated(container)).toEqual(['false', 'false'])
    // Arrow keys move focus only (the kit Tabs activate manually): no change, no animation…
    getByRole('tab', { name: 'day' }).focus()
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'week' }))
    expect(animated(container)).toEqual(['false', 'false'])
    // …and pressing the focused tab (a button: Space and Enter click it) is the change.
    fireEvent.click(document.activeElement)
    expect(animated(container)).toEqual(['true', 'true'])
  })
})

describe('a stored date lands on the day it names — post-overhaul S1 (ruling B3)', () => {
  // The Timeline's one parse (parseDate, through dates.js), rendered: a key
  // date's marker sits at its day offset × dayPx. Run in Audrey's zone, where
  // `new Date('2026-12-05')` is the 4th.
  const ORIGINAL_TZ = process.env.TZ
  afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ })

  it('in New York, a key date stored 2026-12-05 sits four day-columns into a window that starts on 1 December', (ctx) => {
    process.env.TZ = 'America/New_York'
    if (new Date(2026, 11, 1).getTimezoneOffset() !== 300) ctx.skip('this runner could not switch to America/New_York')
    const spanStart = new Date(2026, 11, 1)
    const width = 1830
    const { container } = mount(project(1), {
      spanStart, spanDays: 183, width,
      milestones: [{ id: 'k1', title: 'Key', date: '2026-12-05', color: '#f59e0b' }],
    })
    const marker = container.querySelector('.rb-tl-ov-ms')?.parentElement
    expect(marker, 'the key date was not drawn').toBeTruthy()
    const dayPx = width / 183
    expect(px(marker, 'left')).toBeCloseTo(4 * dayPx, 5)
    // CONTROL: the parse this replaced put it a column early, on the 4th.
    const old = new Date('2026-12-05'); old.setHours(0, 0, 0, 0)
    expect(Math.round((old - spanStart) / 86400000) * dayPx).toBeCloseTo(3 * dayPx, 5)
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
