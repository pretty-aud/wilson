/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S5p (P1-32b) — the Timeline with "Show weekends" off, RENDERED.
//
// With weekends hidden at Day zoom only DetailPane knew which day columns are
// not drawn; TimelineView turned the gantt's scroll into days as
// `scrollLeft / DAY_PX` in six places. Measured in the running app (S1's
// review round 2 and S5p, fixtures, 1440x900): Week → Day moved the gantt
// from 14 Sep to 11 Dec 2026 (+88 days), the minimap's window sat on 15 Sep –
// 6 Oct while the gantt showed December, Today put 10 Dec at the left with
// today off screen, and the switch kept the scroll's pixels instead of its
// date. scripts/timeline-weekends-probe.mjs reads those in the browser; this
// mounts the real TimelineView and reads the same things where the component
// writes them: the gantt scroller's scrollLeft and the minimap window's box.
//
// jsdom has no layout, so the gantt's scroller is given one: 1430px wide (the
// 1440 window less its scrollbar), a scroll width from the chart's own
// min-width, a scrollLeft the "browser" clamps to it and rounds to a whole
// pixel (Chromium at 1x does both: the app read back 12483 for 12482.9), and a
// scroll event a tick after each change, as a browser sends it. Every expected
// day comes from this file's own copy of the rule (a Saturday or a Sunday
// takes no width at Day zoom with weekends hidden), never from the code under
// test. The clock is the Timeline scripts' own: Thursday 24 Sep 2026.
//
// The six conversions: the first-mount centring, the zoom's re-anchoring,
// changeZoom (the anchor at the click), the visible window (the minimap's
// box), scrollDetailToDay (the minimap's click) and Today — each at every
// zoom, weekends shown and hidden (weekends hide at Day zoom only; the other
// three zooms are tested in both settings to prove nothing moves there). The
// first-mount centring runs before any zoom can be chosen (the zoom tabs come
// with the project), so it is tested at Week, where every Timeline opens.
// Each block's CONTROL runs its own assertion on the numbers the code before
// this fix produced, and it throws.
// =============================================================================
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'

const rabbit = vi.hoisted(() => ({ current: {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

// TimelineView reads TODAY once, when it loads: the clock is set first.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 8, 24, 9, 0, 0))
const { default: TimelineView, loadRabbitSettings } = await import('./TimelineView.jsx')

// ── The layout jsdom does not have ──────────────────────────────────────────
const VIEW_W = 1430
const LABEL_W = 240
const W = VIEW_W - LABEL_W
const OVERVIEW_W = 1400
const scrolls = new WeakMap()
const isGantt = (el) => !!el.classList?.contains('rb-tl-gantt')
const maxScroll = (el) => Math.max(0, parseFloat(el.firstElementChild?.style.minWidth || '0') - VIEW_W)
const scrollSoon = (el) => setTimeout(() => el.dispatchEvent(new Event('scroll')), 0)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return isGantt(this) ? VIEW_W : this.classList?.contains('rb-tl-ov') ? OVERVIEW_W : 0 },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    get() {
      if (!isGantt(this)) return 0
      const v = scrolls.get(this) ?? 0
      const m = maxScroll(this)
      if (v > m) { scrolls.set(this, m); scrollSoon(this); return m } // a narrower chart clamps it
      return v
    },
    set(v) {
      if (!isGantt(this)) return
      const next = Math.min(maxScroll(this), Math.max(0, Math.round(v)))
      if (next !== (scrolls.get(this) ?? 0)) { scrolls.set(this, next); scrollSoon(this) }
    },
  })
})
afterAll(() => {
  delete HTMLElement.prototype.clientWidth
  delete HTMLElement.prototype.scrollLeft
  vi.useRealTimers()
})
afterEach(cleanup)

// ── The project: one phase, 3 Aug – 18 Dec 2026, as the fixtures' Salt Hours
//    runs. The overview span is its first day less 180 days: Wed 4 Feb 2026. ─
const phase = { id: 'ph1', name: 'Development', parent_phase_id: null, start_date: '2026-08-03', end_date: '2026-12-18', sort_order: 0 }
const ctx = {
  project: { id: 'p1' }, activeProjectId: 'p1',
  phases: [phase], assets: [], tasks: [], dependencies: [], scenes: [], shots: [], levels: [], experiences: [],
  milestones: [], teamAssignments: [], undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
}
const SPAN_START = new Date(2026, 1, 4)
const dayIndex = (y, m, d) => Math.round((new Date(y, m, d) - SPAN_START) / 864e5)
const dateOf = (i) => new Date(2026, 1, 4 + i)
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const say = (i) => { const d = dateOf(i); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
const weekend = (i) => { const w = dateOf(i).getDay(); return w === 0 || w === 6 }
const TODAY = dayIndex(2026, 8, 24)
const ZOOM_PX = { day: 56, week: 22, month: 8, quarter: 4 }
const ZOOMS = ['day', 'week', 'month', 'quarter']

/** The gantt's geometry, from the rule alone: a column a day, or — weekends
    hidden at Day zoom — a column a weekday. `x(day)` and `day(x)` are day
    positions (half a column into Thursday is Thursday + 0.5). */
function geometry(zoom, weekendsHidden) {
  const px = ZOOM_PX[zoom]
  const masked = weekendsHidden && zoom === 'day'
  return {
    zoom, masked,
    x(day) {
      if (!masked) return day * px
      const whole = Math.floor(day)
      let x = 0
      for (let i = 0; i < whole; i++) if (!weekend(i)) x += px
      return weekend(whole) ? x : x + (day - whole) * px
    },
    day(x) {
      if (!masked) return x / px
      let left = 0
      for (let i = 0; ; i++) {
        if (weekend(i)) continue
        if (x < left + px) return i + Math.max(0, x - left) / px
        left += px
      }
    },
    /** The first day a date's column shows: the date itself, or the next shown day. */
    shown(i) { if (masked) while (weekend(i)) i++; return i },
  }
}

// ── Driving and reading the mounted Timeline ────────────────────────────────
const settle = async () => { for (let k = 0; k < 3; k++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const view = (showWeekends) => <TimelineView settings={{ ...loadRabbitSettings(), showWeekends }} patchSettings={() => {}} holidays={new Map()} pageActive />
async function mount(showWeekends) {
  rabbit.current = ctx
  const r = render(view(showWeekends))
  await settle()
  return r
}
const gantt = () => document.querySelector('.rb-tl-gantt')
async function zoomTo(z) {
  fireEvent.click(document.querySelector(`[title="Switch the detail gantt to ${z[0].toUpperCase()}${z.slice(1)} zoom"]`))
  await settle()
}
/** A user's scroll: put x at the gantt's left edge. */
async function scrollTo(x) { gantt().scrollLeft = x; await settle() }
/** The minimap window's first and last day, read off the minimap's own Today
    line and month lines (its scale is September's: 1 Sep → 1 Oct). */
function minimapWindow() {
  const tx = parseFloat(document.querySelector('.rb-tl-ov-today').style.left)
  const lines = [...document.querySelectorAll('.rb-tl-ov-grid')].map((e) => parseFloat(e.style.left)).sort((a, b) => a - b)
  const px = (lines.find((x) => x > tx) - lines.filter((x) => x <= tx).pop()) / 30
  const frame = document.querySelector('.rb-tl-ov-frame')
  const fl = parseFloat(frame.style.left)
  const fw = parseFloat(frame.style.width)
  return { start: TODAY + Math.round((fl - tx) / px), end: TODAY + Math.round((fl + fw - tx) / px), px, tx }
}

// ── The assertions, each also run by its block's CONTROL ────────────────────
/** The gantt's left day after a change is the day before it — or, when that
    day is hidden now, the next shown one. */
function expectKept(before, scrollAfter, g, what) {
  const after = Math.floor(g.day(scrollAfter))
  expect(say(after), `${what}: ${say(before)} at the left before`).toBe(say(g.shown(before)))
}
/** The minimap window brackets what the gantt shows: it starts on the gantt's
    left day or the next (rounding), and ends on its right day or as far as the
    first day after it that shows. */
function expectBracketed(scroll, win, g, what) {
  const left = Math.floor(g.day(scroll))
  const right = Math.floor(g.day(scroll + W - 1))
  const firstAfter = g.shown(right + 1)
  expect(win.start, `${what}: the window starts ${say(win.start)}, the gantt ${say(left)}`).toBeGreaterThanOrEqual(left)
  expect(win.start, `${what}: the window starts ${say(win.start)}, the gantt ${say(left)}`).toBeLessThanOrEqual(left + 1)
  expect(win.end, `${what}: the window ends ${say(win.end)}, the gantt ${say(right)}`).toBeGreaterThanOrEqual(right)
  expect(win.end, `${what}: the window ends ${say(win.end)}, the gantt ${say(right)}`).toBeLessThanOrEqual(firstAfter)
}
/** Today's column at the gantt's centre, and its line on screen. */
function expectTodayCentred(scroll, todayLineX, g, what) {
  expect(Math.abs(scroll + W / 2 - g.x(TODAY)), `${what}: centre at ${say(Math.floor(g.day(scroll + W / 2)))}`).toBeLessThanOrEqual(1)
  expect(todayLineX, `${what}: the Today line`).toBe(g.x(TODAY))
  expect(todayLineX >= scroll && todayLineX < scroll + W, `${what}: the Today line on screen`).toBe(true)
}

// =============================================================================
describe('the gantt the Timeline draws is the rule\'s, mask and all (the instrument)', () => {
  it('at Day zoom the chart is a column a day, or a column a weekday with weekends hidden, from Wed 4 Feb 2026', async () => {
    for (const shownSetting of [true, false]) {
      await mount(shownSetting)
      await zoomTo('day')
      const g = geometry('day', !shownSetting)
      const ticks = [...gantt().querySelectorAll('.rb-tl-axis-tick')].map((t) => ({ x: parseFloat(t.style.left), label: t.querySelector('.rb-tl-axis-label')?.textContent }))
      expect(ticks[0]).toEqual({ x: 0, label: 'Feb 4' })
      // Every drawn day's tick at the rule's x: the pane draws with this mask.
      const lastDay = Math.round((new Date(2028, 5, 10) - SPAN_START) / 864e5) // 18 Dec 2026 + 540 days
      for (const i of [0, 3, 4, 5, 6, 180, 232, 233, 234, 235, 310, lastDay - 1]) {
        const t = ticks.find((k) => k.label === `${MON[dateOf(i).getMonth()]} ${dateOf(i).getDate()}` && Math.abs(k.x - g.x(i)) < 0.001)
        if (g.masked && weekend(i)) expect(t, `${say(i)} is hidden`).toBeUndefined()
        else expect(t, `${say(i)} at ${g.x(i)}`).toBeTruthy()
      }
      expect(parseFloat(gantt().firstElementChild.style.minWidth)).toBe(LABEL_W + (g.masked ? g.x(lastDay + 1) : lastDay * 56))
      cleanup()
    }
  })
})

describe('the first-mount centring (every Timeline opens at Week)', () => {
  it('today sits 200px in from the gantt\'s left edge, with weekends shown and with them hidden, and the minimap window starts there', async () => {
    for (const shownSetting of [true, false]) {
      await mount(shownSetting)
      const g = geometry('week', !shownSetting)
      expect(gantt().scrollLeft).toBe(Math.round(g.x(TODAY) - 200)) // 232 × 22 − 200 = 4904: Mon 14 Sep at the left
      expect(say(Math.floor(g.day(gantt().scrollLeft)))).toBe('Mon 14 Sep 2026')
      expectBracketed(gantt().scrollLeft, minimapWindow(), g, 'as opened')
      cleanup()
    }
  })
})

// The 36 transitions: the 12 ordered zoom changes from three left dates
// (Mon 3 Aug, Thu 24 Sep, Fri 11 Dec 2026), each placed half a column in.
// S1 measured 36 of 36 kept with weekends shown and the 18 that touch Day
// zoom lost with weekends hidden; S5p's probe measured the same in the app.
const ANCHORS = [[2026, 7, 3], [2026, 8, 24], [2026, 11, 11]]
describe.each([['shown', true], ['hidden', false]])('the 36 zoom changes, weekends %s: the left date is kept, and the minimap window brackets the gantt after each', (mode, shownSetting) => {
  it.each(ANCHORS)('from %i-%i-%i at the left, every ordered pair of zooms', async (y, m, d) => {
    await mount(shownSetting)
    const anchor = dayIndex(y, m, d)
    for (const from of ZOOMS) {
      for (const to of ZOOMS) {
        if (from === to) continue
        await zoomTo(from)
        const gFrom = geometry(from, !shownSetting)
        await scrollTo(Math.round(gFrom.x(anchor + 0.5)))
        expect(say(Math.floor(gFrom.day(gantt().scrollLeft))), `placed at ${from}`).toBe(say(anchor))
        expectBracketed(gantt().scrollLeft, minimapWindow(), gFrom, `${from}, placed`)
        await zoomTo(to)
        const gTo = geometry(to, !shownSetting)
        expectKept(anchor, gantt().scrollLeft, gTo, `${from} → ${to}`)
        expectBracketed(gantt().scrollLeft, minimapWindow(), gTo, `${from} → ${to}`)
      }
    }
  }, 60000)
})

describe('a hidden day at the left edge lands on the next shown day, and the anchor follows what is shown', () => {
  it('Sat 10 Oct at Week → Day (weekends hidden) shows Mon 12 Oct; back at Week, Mon 12 Oct', async () => {
    await mount(false)
    const sat = dayIndex(2026, 9, 10)
    await scrollTo(Math.round(geometry('week', true).x(sat + 0.5)))
    await zoomTo('day')
    expect(say(Math.floor(geometry('day', true).day(gantt().scrollLeft)))).toBe('Mon 12 Oct 2026')
    await zoomTo('week')
    expect(say(Math.floor(geometry('week', true).day(gantt().scrollLeft)))).toBe('Mon 12 Oct 2026')
  }, 30000)
})

describe('"Show weekends" keeps the date under the eye (hideWeekends re-anchors)', () => {
  it('at Day zoom: hidden → shown → hidden keeps Fri 11 Dec at the left; a Saturday made hidden lands on Monday', async () => {
    const r = await mount(false)
    await zoomTo('day')
    const fri = dayIndex(2026, 11, 11)
    await scrollTo(Math.round(geometry('day', true).x(fri + 0.5)))
    const before = gantt().scrollLeft
    r.rerender(view(true))
    await settle()
    expectKept(fri, gantt().scrollLeft, geometry('day', false), 'hidden → shown')
    expectBracketed(gantt().scrollLeft, minimapWindow(), geometry('day', false), 'hidden → shown')
    r.rerender(view(false))
    await settle()
    expectKept(fri, gantt().scrollLeft, geometry('day', true), 'shown → hidden')
    expect(gantt().scrollLeft).toBe(before)
    // A Saturday at the left with weekends shown; hiding them shows Monday.
    r.rerender(view(true))
    await settle()
    const sat = dayIndex(2026, 11, 12)
    await scrollTo(Math.round(geometry('day', false).x(sat + 0.5)))
    r.rerender(view(false))
    await settle()
    expect(say(Math.floor(geometry('day', true).day(gantt().scrollLeft)))).toBe('Mon 14 Dec 2026')
  }, 30000)
  it('at the other zooms the switch changes nothing on the gantt: not a pixel', async () => {
    for (const z of ['week', 'month', 'quarter']) {
      const r = await mount(true)
      await zoomTo(z)
      await scrollTo(Math.round(geometry(z, false).x(dayIndex(2026, 9, 7) + 0.5)))
      const before = gantt().scrollLeft
      r.rerender(view(false))
      await settle()
      expect(gantt().scrollLeft, z).toBe(before)
      cleanup()
    }
  }, 30000)
})

describe.each([['shown', true], ['hidden', false]])('Today, at every zoom, weekends %s', (mode, shownSetting) => {
  it('puts today\'s column at the gantt\'s centre with its line on screen, from a scroll far from it', async () => {
    await mount(shownSetting)
    for (const z of ZOOMS) {
      await zoomTo(z)
      const g = geometry(z, !shownSetting)
      await scrollTo(Math.round(g.x(dayIndex(2027, 2, 1))))
      fireEvent.click(document.querySelector('[title="Center the detail timeline on today"]'))
      await settle()
      const line = gantt().querySelector('.rb-tl-today')
      expectTodayCentred(gantt().scrollLeft, parseFloat(line.style.left), g, `${z}, Today`)
      expectBracketed(gantt().scrollLeft, minimapWindow(), g, `${z}, Today`)
    }
  }, 30000)
})

describe.each([['shown', true], ['hidden', false]])('a click on empty minimap (scrollDetailToDay), at every zoom, weekends %s', (mode, shownSetting) => {
  it('the gantt starts where the click asks: the clicked day less half the window', async () => {
    await mount(shownSetting)
    for (const z of ZOOMS) {
      await zoomTo(z)
      const g = geometry(z, !shownSetting)
      const before = minimapWindow()
      const target = dayIndex(2027, 0, 20) // Wed 20 Jan 2027
      const clientX = Math.round(before.tx + (target - TODAY) * before.px)
      const clicked = TODAY + Math.round((clientX - before.tx) / before.px) // the click's own reading
      fireEvent.click(document.querySelector('[data-minimap-body]'), { clientX, clientY: 5 })
      await settle()
      const want = clicked - Math.floor((before.end - before.start) / 2)
      expectKept(want, gantt().scrollLeft, g, `${z}, a click on ${say(clicked)}`)
      expectBracketed(gantt().scrollLeft, minimapWindow(), g, `${z}, after the click`)
    }
  }, 30000)
})

describe('CONTROL: each assertion fails on what the code before this fix produced (P1-32b, measured)', () => {
  const hidden = geometry('day', true)
  const week = geometry('week', true)
  const opened = 232 * 22 - 200 // 4904: Mon 14 Sep 2026 at Week's left edge
  it('the re-anchoring: Week → Day carried 4904 / 22 × 56 = 12483px, Fri 11 Dec with weekends hidden (+88 days)', () => {
    expect(say(Math.floor(week.day(opened)))).toBe('Mon 14 Sep 2026')
    const old = Math.round((opened / 22) * 56)
    expect(old).toBe(12483)
    expect(say(Math.floor(hidden.day(old)))).toBe('Fri 11 Dec 2026')
    expect(() => expectKept(Math.floor(week.day(opened)), old, hidden, 'Week → Day')).toThrow()
  })
  it('the window: its start was scrollLeft / 56 days (Tue 15 Sep) while the gantt showed 11 Dec', () => {
    const old = { start: Math.round(12483 / 56), end: Math.round(12483 / 56 + W / 56) }
    expect(say(old.start)).toBe('Tue 15 Sep 2026')
    expect(() => expectBracketed(12483, old, hidden, 'Day zoom')).toThrow()
  })
  it('Today: its target was today × 56 − half the view, which with weekends hidden is 10 Dec at the left and today off screen', () => {
    const old = Math.max(0, TODAY * 56 - W / 2)
    expect(say(Math.floor(hidden.day(old)))).toBe('Thu 10 Dec 2026')
    expect(() => expectTodayCentred(old, hidden.x(TODAY), hidden, 'Today')).toThrow()
  })
  it('the switch: the scroll kept its pixels, so the date under them changed (11 Dec hidden → 14 Sep shown)', () => {
    const fri = dayIndex(2026, 11, 11)
    const px = Math.round(hidden.x(fri + 0.5))
    expect(say(Math.floor(geometry('day', false).day(px)))).toBe('Mon 14 Sep 2026')
    expect(() => expectKept(fri, px, geometry('day', false), 'hidden → shown')).toThrow()
  })
  it('the click: scrollDetailToDay kept the scale of the render that made it (Week\'s 22px), so at Day zoom it landed months early, weekends shown or not', () => {
    const want = dayIndex(2027, 0, 11)
    for (const g of [geometry('day', false), hidden]) {
      expect(() => expectKept(want, want * 22, g, 'a minimap click')).toThrow()
    }
  })
})
