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
import { createRef, useState, useLayoutEffect } from 'react'
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

const { OverviewPane, DetailPane } = await import('./TimelineView.jsx')
// The zone to restore after a test switches it, read before any switch
// (deleting TZ does not restore it; review round 1 measured it).
const ORIGINAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const { minimapLayout, estimateWidth, LABEL_GAP, weekendMask } = await import('./timelineMinimap.js')

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

  it('a new zoom raises data-animate on both layers in the same render; it drops when the slide ends (the outline\'s transitionend), not on a timer', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    expect(animated(container)).toEqual(['false', 'false'])
    // Day zoom: the same left edge, a window a third as wide.
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'day', visibleEndDate: addDays(spanStart, 80) })} />)
    expect(animated(container)).toEqual(['true', 'true'])
    // Review round 1: a 200ms timer from the commit cut slides that began a
    // frame or two later (the window jumped 1–10px); one response duration
    // passing no longer drops it…
    act(() => { vi.advanceTimersByTime(DURATION.response) })
    expect(animated(container)).toEqual(['true', 'true'])
    // …the slide's end does.
    act(() => { container.querySelector('.rb-tl-ov-frame-edge').dispatchEvent(new Event('transitionend', { bubbles: true })) })
    expect(animated(container)).toEqual(['false', 'false'])
    expect(DURATION.response).toBe(200)
  })

  it('with no slide to end (reduced motion, or a box that did not change), a fallback of three response durations drops it', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'day' })} />)
    act(() => { vi.advanceTimersByTime(DURATION.response * 3 - 1) })
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(1) })
    expect(animated(container)).toEqual(['false', 'false'])
  })

  it('the flag is already up in the commit that carries the new zoom, not one commit later (review round 1)', () => {
    // A sibling's layout effect runs after the whole commit's DOM writes:
    // raised in an effect instead, the frame would still say "false" here,
    // and in the app the new box would be applied with no transition.
    const seen = []
    function Probe({ zoom }) {
      useLayoutEffect(() => {
        seen.push([zoom, document.querySelector('.rb-tl-ov-frame')?.getAttribute('data-animate')])
      }, [zoom])
      return null
    }
    const { rerender } = render(<><OverviewPane ref={createRef()} {...props()} /><Probe zoom="week" /></>)
    rerender(<><OverviewPane ref={createRef()} {...props({ detailZoom: 'day' })} /><Probe zoom="day" /></>)
    expect(seen).toEqual([['week', 'false'], ['day', 'true']])
  })

  it('the window is drawn even when it lies wholly off the minimap (the body clips it), so a zoom that moves it off or back on slides instead of popping (review round 1)', () => {
    const { container } = render(<OverviewPane ref={createRef()} {...props({ visibleStartDate: addDays(spanStart, 800), visibleEndDate: addDays(spanStart, 860) })} />)
    expect(animated(container)).toEqual(['false', 'false'])
    expect(container.querySelector('[data-minimap-body]').style.overflow).toBe('hidden')
  })

  it('a second zoom change while it slides restarts it', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OverviewPane ref={createRef()} {...props()} />)
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'day' })} />)
    act(() => { vi.advanceTimersByTime(150) })
    rerender(<OverviewPane ref={createRef()} {...props({ detailZoom: 'month' })} />)
    act(() => { vi.advanceTimersByTime(DURATION.response * 3 - 1) }) // past the first change's fallback
    expect(animated(container)).toEqual(['true', 'true'])
    act(() => { vi.advanceTimersByTime(1) })
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

  it('the zoom tabs, by click and by keyboard (the arrows move focus; Space presses the focused tab — Enter toggles the pet while P1-01 stands), are what raise it', () => {
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
    act(() => { vi.advanceTimersByTime(DURATION.response * 3) })
    expect(animated(container)).toEqual(['false', 'false'])
    // Arrow keys move focus only (the kit Tabs activate manually): no change, no animation…
    getByRole('tab', { name: 'day' }).focus()
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'week' }))
    expect(animated(container)).toEqual(['false', 'false'])
    // …and pressing the focused tab is the change: Space clicks a button
    // (fireEvent.click stands in for it; jsdom has no key activation). In the
    // app Enter would too, but App.jsx's pet handler cancels it (P1-01).
    fireEvent.click(document.activeElement)
    expect(animated(container)).toEqual(['true', 'true'])
  })
})

describe('the gantt\'s header and grid, rendered — post-overhaul S1 (rulings B2, B8b; review round 1: the render twin)', () => {
  // DetailPane with no rows: its header ticks and the body's month lines,
  // read where it writes them (the inline `left`). buildAxisTicks' arithmetic
  // is timelineMinimap.test.js; this is the wiring — the weekend mask handed
  // to it, the grid's month start, the weekend 1st's line over its tint.
  const noop = () => {}
  const ZOOM = { day: { id: 'day', label: 'Day', dayPx: 56, axisFormat: 'day' }, week: { id: 'week', label: 'Week', dayPx: 22, axisFormat: 'week' } }
  // Post-overhaul S5p (P1-32b): DetailPane draws with the weekend mask
  // TimelineView hands it (timelineMinimap.js's weekendMask, the one the
  // scroll conversions read too); weekends hidden is a mask, shown is none.
  const mountDetail = ({ start, totalDays, zoomId, hideWeekends = false }) => {
    const zoom = ZOOM[zoomId]
    return render(
      <DetailPane
        scrollRef={createRef()} rows={[]} span={{ start, end: addDays(start, totalDays), days: totalDays }}
        totalDays={totalDays} chartW={totalDays * zoom.dayPx} dayPx={zoom.dayPx} rowPx={34} zoom={zoom} zoomId={zoomId}
        dayMask={hideWeekends ? weekendMask(start, totalDays, zoom.dayPx) : null} criticalSet={new Set()} todayDays={-1} dependencies={[]} phases={[]}
        onCreateTaskFromDates={noop} onUpdateTask={noop} onUpdatePhase={noop} onMovePhaseAndChildren={noop}
        onToggleCollapse={noop} onLinkTasks={noop} onLinkPhases={noop} onUnlinkDependency={noop} onMoveTaskToPhase={noop}
        onEditTask={noop} onEditPhase={noop} onEditAsset={noop} onUpdateAsset={noop} onNewTaskInPhase={noop}
        canWrite writeReason={null} milestones={[]} onEditMilestone={noop}
      />,
    )
  }
  const ticks = (c) => [...c.querySelectorAll('.rb-tl-axis-tick')].map((t) => ({
    left: px(t, 'left'),
    major: t.getAttribute('data-major') === 'true',
    top: t.querySelector('.rb-tl-axis-top')?.textContent ?? null,
    label: t.querySelector('.rb-tl-axis-label')?.textContent || null,
  }))
  const lefts = (c, sel) => [...c.querySelectorAll(sel)].map((el) => px(el, 'left'))

  it('weekends hidden: no tick on a hidden day; each month on its first shown day (Aug 3, Nov 2 2026) with its bold line in the body at the same x', () => {
    const start = day(2026, 7, 1) // Saturday 1 August
    const { container } = mountDetail({ start, totalDays: 140, zoomId: 'day', hideWeekends: true })
    const t = ticks(container)
    let shown = 0
    for (let i = 0; i <= 140; i++) { const w = addDays(start, i).getDay(); if (w !== 0 && w !== 6) shown++ }
    expect(t).toHaveLength(shown)
    const majors = t.filter((x) => x.major)
    expect(majors.map((x) => [x.top, x.label])).toEqual([
      ['Aug 2026', 'Aug 3'], ['Sep 2026', 'Sep 1'], ['Oct 2026', 'Oct 1'], ['Nov 2026', 'Nov 2'], ['Dec 2026', 'Dec 1'],
    ])
    expect(majors[0].left).toBe(0) // 1 and 2 August take no width
    expect(lefts(container, '.rb-tl-grid-major')).toEqual(majors.map((x) => x.left))
  })

  it('weekends shown: a 1st on a Saturday (Aug 1) or a Sunday (Nov 1) keeps its bold line over the weekend tint', () => {
    const start = day(2026, 7, 1)
    const { container } = mountDetail({ start, totalDays: 100, zoomId: 'day' })
    const P = ZOOM.day.dayPx
    expect(lefts(container, '.rb-tl-grid-major')).toEqual([0, 31 * P, 61 * P, 92 * P]) // Aug 1, Sep 1, Oct 1, Nov 1
    const tints = lefts(container, '.rb-tl-weekend')
    expect(tints).toContain(0)
    expect(tints).toContain(92 * P)
    // …the line AFTER the tint, so it paints over it (review round 2).
    const order = (x) => [...container.querySelectorAll('.rb-tl-weekend, .rb-tl-grid-major')]
      .filter((el) => px(el, 'left') === x).map((el) => (el.classList.contains('rb-tl-grid-major') ? 'line' : 'tint'))
    expect(order(0)).toEqual(['tint', 'line'])
    expect(order(92 * P)).toEqual(['tint', 'line'])
    // Every day keeps its label, the month's start its month.
    const t = ticks(container)
    expect(t.filter((x) => x.left < 100 * P && !x.label)).toEqual([])
    expect(t.find((x) => x.left === 92 * P)).toMatchObject({ major: true, top: 'Nov 2026', label: 'Nov 1' })
  })

  it('Week zoom, Nov 30 → Dec 1 2026: the Monday keeps its tick and gives way; "Dec 2026 / Dec 1" prints', () => {
    const start = day(2026, 7, 1)
    const { container } = mountDetail({ start, totalDays: 150, zoomId: 'week' })
    const at = (offset) => ticks(container).find((x) => x.left === offset * ZOOM.week.dayPx)
    expect(at(121)).toEqual({ left: 121 * ZOOM.week.dayPx, major: false, top: null, label: null }) // Mon 30 Nov
    expect(at(122)).toMatchObject({ major: true, top: 'Dec 2026', label: 'Dec 1' })               // Tue 1 Dec
  })
})

describe('a stored date lands on the day it names — post-overhaul S1 (ruling B3)', () => {
  // The Timeline's one parse (parseDate, through dates.js), rendered: a key
  // date's marker sits at its day offset × dayPx. Run in Audrey's zone, where
  // `new Date('2026-12-05')` is the 4th.
  afterAll(() => { process.env.TZ = ORIGINAL_ZONE })

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
