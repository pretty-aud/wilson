// =============================================================================
// timelineMinimap.test.js — the minimap's arithmetic (UI overhaul B3, Q22).
// The render half, which mounts the minimap and counts the phases it draws
// against the data, is timelineMinimapRender.test.jsx.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MINIMAP, minimapLayout, minimapTicks, spanLabel, snapLeft, offWindow,
  STRIDES, LABEL_GAP, LABEL_PAD, estimateWidth,
  buildAxisTicks, axisLabelWidth, isMonthStartShown, AXIS_GAP, AXIS_GLYPH_PX, dayIndexAtX,
} from './timelineMinimap.js'
// Post-overhaul S5p: the module's own weekendMask, beside this file's rebuild
// of it (`weekendMask` below), which the arithmetic is checked against.
import * as TM from './timelineMinimap.js'

describe('minimapLayout: every phase gets a row, at any count', () => {
  it('five phases keep the old picture: 22px rows in the 124px body', () => {
    expect(minimapLayout(5)).toEqual({ rowH: 22, bodyH: 124, named: true })
    expect(minimapLayout(1)).toEqual({ rowH: 22, bodyH: 124, named: true })
    expect(minimapLayout(0)).toEqual({ rowH: 22, bodyH: 124, named: true })
  })

  it('the sixth phase — the one the old minimap cut — is drawn, and the names stay', () => {
    const six = minimapLayout(6)
    expect(six.rowH * 6).toBeLessThanOrEqual(six.bodyH)
    expect(six.named).toBe(true)
    // The old geometry, for the record: 124 / 22 = 5.6 rows.
    expect(Math.floor(MINIMAP.BODY_H / MINIMAP.ROW_MAX)).toBe(5)
  })

  it('for every count from 0 to 200, all rows fit the body, no row is under the floor, and names need 18px', () => {
    for (let n = 0; n <= 200; n++) {
      const { rowH, bodyH, named } = minimapLayout(n)
      expect(rowH * n, `n=${n}`).toBeLessThanOrEqual(bodyH)
      expect(rowH, `n=${n}`).toBeGreaterThanOrEqual(MINIMAP.ROW_FLOOR)
      expect(rowH, `n=${n}`).toBeLessThanOrEqual(MINIMAP.ROW_MAX)
      expect(bodyH, `n=${n}`).toBeGreaterThanOrEqual(MINIMAP.BODY_H)
      expect(named, `n=${n}`).toBe(rowH >= MINIMAP.ROW_NAMED)
    }
  })

  it('grows only when it must, and never past the cap while a smaller row would do', () => {
    expect(minimapLayout(7)).toEqual({ rowH: 18, bodyH: 126, named: true })
    expect(minimapLayout(10)).toEqual({ rowH: 18, bodyH: 180, named: true })
    expect(minimapLayout(11)).toEqual({ rowH: 16, bodyH: 186, named: false })
    expect(minimapLayout(23)).toEqual({ rowH: 8, bodyH: 186, named: false })
    expect(minimapLayout(24)).toEqual({ rowH: 8, bodyH: 192, named: false })
    expect(minimapLayout(40).bodyH).toBe(320)
  })
})

describe('minimapTicks: a line every month, a label only where it has room', () => {
  const start = new Date(2026, 2, 15) // 15 Mar 2026, local
  const labelled = (r) => r.ticks.filter((t) => t.label)

  it('keeps a tick (a line) on every month start, whatever the stride', () => {
    for (const dayPx of [0.5, 1.6, 8]) {
      const r = minimapTicks(start, 857, dayPx)
      const firsts = r.ticks.map((t) => new Date(2026, 2, 15 + t.offset).getDate())
      expect(firsts.every((d) => d === 1)).toBe(true)
      expect(r.ticks.length).toBe(28) // Apr 2026 … Jul 2028
    }
  })

  it('no two labels overlap, at every zoom the slider offers, at 1024 and 1440 wide', () => {
    for (const width of [760, 1024, 1440]) {
      for (const days of [137, 183, 365, 730, 857, 1825]) {
        const dayPx = width / days
        const { ticks } = minimapTicks(start, days, dayPx)
        const shown = ticks.filter((t) => t.label)
        expect(shown.length, `${width}px, ${days}d`).toBeGreaterThan(0)
        for (let k = 1; k < shown.length; k++) {
          const prev = shown[k - 1]
          const room = (shown[k].offset - prev.offset) * dayPx
          expect(estimateWidth(prev.label) + LABEL_GAP, `${width}px ${days}d: "${prev.label}" then "${shown[k].label}"`)
            .toBeLessThanOrEqual(room + 0.001)
        }
      }
    }
  })

  it('no label runs past the right edge of the pane, at every zoom, width and start (B3d round 2: "Oc" at 1024, 2 yr)', () => {
    let dropped = 0
    for (const width of [760, 1024, 1280, 1440]) {
      for (const days of [137, 183, 365, 730, 857, 1825]) {
        const dayPx = width / days
        for (let k = 0; k < 365; k += 7) {
          const from = new Date(2026, 0, 1 + k)
          const { ticks, stride } = minimapTicks(from, days, dayPx)
          for (const t of ticks) {
            if (t.label) {
              expect(t.offset * dayPx + LABEL_PAD + estimateWidth(t.label), `${width}px ${days}d from day ${k}: "${t.label}"`)
                .toBeLessThanOrEqual(width + 0.001)
            } else if (new Date(2026, 0, 1 + k + t.offset).getMonth() % stride === 0) dropped++
          }
        }
      }
    }
    // CONTROL: the rule is not vacuous — somewhere a label due on its stride was dropped at the edge.
    expect(dropped).toBeGreaterThan(0)
  })

  it('labels January with its year and the first label with its year when it fits', () => {
    // At 6 months over 1440px a month is ~240px: every month labelled, the first with its year.
    const wide = labelled(minimapTicks(new Date(2026, 8, 20), 183, 1440 / 183))
    expect(wide[0].label).toBe('Oct 2026')
    expect(wide.map((t) => t.label)).toContain('2027')
    expect(wide.map((t) => t.label)).toContain('Nov')
  })

  it('steps to a coarser stride as the span widens, and every stride keeps January', () => {
    const at = (days, width) => minimapTicks(start, days, width / days).stride
    expect(at(183, 1440)).toBe(1)
    expect(at(1825, 1440)).toBeGreaterThan(1)
    expect(at(1825, 760)).toBeGreaterThanOrEqual(at(1825, 1440))
    for (const k of STRIDES) expect(12 % k).toBe(0)
  })

  it('CONTROL: the old labelling (every month, "Mon YYYY") overlaps at the default span — the defect this replaces', () => {
    const dayPx = 1400 / 857
    const old = minimapTicks(start, 857, dayPx, estimateWidth).ticks
    const monthPx = 30.44 * dayPx
    expect(estimateWidth('Mar 2026') + LABEL_GAP).toBeGreaterThan(monthPx) // the old label cannot fit a month
    expect(old.length).toBeGreaterThan(0)
  })
})

describe('spanLabel: the zoom readout says what is drawn', () => {
  it('reads the slider ends and its snaps exactly', () => {
    expect(spanLabel(183)).toBe('6 mo')
    expect(spanLabel(365)).toBe('1 yr')
    expect(spanLabel(730)).toBe('2 yr')
    expect(spanLabel(1825)).toBe('5 yr')
  })
  it('does not round a span past what is drawn (the old readout said "2 yr" and "5 mo")', () => {
    expect(spanLabel(857)).toBe('2.3 yr')
    expect(spanLabel(137)).toBe('4.5 mo')
    expect(spanLabel(45)).toBe('45 d')
  })
})

describe('snapLeft: a snap mark sits where the thumb stops for that value', () => {
  it('runs from half a thumb in to half a thumb from the end', () => {
    expect(snapLeft(183, 183, 1825, 195, 14)).toBe(7)
    expect(snapLeft(1825, 183, 1825, 195, 14)).toBe(188)
    expect(snapLeft(1004, 183, 1825, 195, 14)).toBeCloseTo(97.5, 5)
  })
  it('clamps a value outside the range to the ends (Fit can go under the minimum)', () => {
    expect(snapLeft(137, 183, 1825, 195, 14)).toBe(7)
  })
})

describe('offWindow: a phase outside the window says which side it went', () => {
  const d = (m, day) => new Date(2026, m, day)
  it('reports before, after, or null when any of it shows', () => {
    expect(offWindow(d(0, 1), d(0, 31), d(2, 1), d(5, 1))).toBe('before')
    expect(offWindow(d(7, 1), d(7, 31), d(2, 1), d(5, 1))).toBe('after')
    expect(offWindow(d(1, 1), d(2, 15), d(2, 1), d(5, 1))).toBe(null)
    expect(offWindow(null, d(2, 15), d(2, 1), d(5, 1))).toBe(null)
  })
})

// =============================================================================
// The GANTT's header — buildAxisTicks, post-overhaul S1 (ruling B2, option B).
// The day width is fixed per zoom, so a window's width (760, 1024 or 1440px
// of chart) does not enter the arithmetic: each run checks a two-year span
// from every weekday, and every window of every width is a slice of it.
// =============================================================================
const here = dirname(fileURLToPath(import.meta.url))
/** The four zooms, read from TimelineView.jsx's ZOOM_LEVELS so the two cannot drift. */
const ZOOMS = Object.fromEntries([...readFileSync(join(here, 'TimelineView.jsx'), 'utf8')
  .matchAll(/\{ id: '(day|week|month|quarter)',\s*label: '[A-Za-z]+',\s*dayPx: (\d+),\s*axisFormat: '(\w+)'\s*\}/g)]
  .map((m) => [m[1], { dayPx: Number(m[2]), axisFormat: m[3] }]))

/** DetailPane's weekend mask, rebuilt: a hidden day adds no width. */
function weekendMask(start, totalDays, dayPx) {
  const mask = []
  let x = 0
  for (let i = 0; i <= totalDays; i++) {
    const dow = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getDay()
    const hidden = dow === 0 || dow === 6
    mask.push({ offsetPx: x, hidden })
    if (!hidden) x += dayPx
  }
  return { hidden: (i) => mask[i].hidden, xOf: (i) => mask[i].offsetPx, end: x }
}
/** Every tick with its x, for one zoom, weekends shown or hidden. */
function header(start, totalDays, zoomId, { weekendsHidden = false } = {}) {
  const zoom = ZOOMS[zoomId]
  const opts = weekendsHidden ? weekendMask(start, totalDays, zoom.dayPx) : { end: totalDays * zoom.dayPx }
  const xOf = opts.xOf || ((i) => i * zoom.dayPx)
  return buildAxisTicks(start, totalDays, zoom, opts).map((t) => ({ ...t, x: xOf(t.offset) }))
}
const dayOf = (start, t) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + t.offset)
const RUNS = [
  ...['day', 'week', 'month', 'quarter'].map((z) => [z, false]),
  ['day', true], // weekends hide at Day zoom only (TimelineView: hideWeekends needs zoomId 'day')
]

describe('the gantt header\'s label width: measured once, never under what is drawn', () => {
  // Drawn widths in Chromium at 13px Geist 400 (the Dense step), 2026-09-30,
  // the widest of each kind among the 528 labels the header can print.
  const DRAWN = { 'May 20': 45.03, 'Nov 30': 43.47, 'Aug 31': 39.7, 'Sep 1': 31.66, 'Dec 1': 31.72,
    'Dec 2026': 59.14, 'May 2030': 61.61, 'Jan 2027': 56.81, 'Q4 2030': 54.03, May: 25.11 }
  it('axisLabelWidth is at or above every drawn width, and within 1px of it', () => {
    for (const [label, drawn] of Object.entries(DRAWN)) {
      expect(axisLabelWidth(label), label).toBeGreaterThanOrEqual(drawn)
      expect(axisLabelWidth(label) - drawn, label).toBeLessThan(1)
    }
  })
  it('CONTROL: the one-width estimates cannot do both jobs — 7.6px a character (the brief\'s) is under "May 2030", and 8.4 (high enough for "May") does not fit "May 20" in a Day column', () => {
    expect('May 2030'.length * 7.6).toBeLessThan(DRAWN['May 2030'])
    expect('May'.length * 7.6).toBeLessThan(DRAWN.May)
    expect(LABEL_PAD + 'May 20'.length * 8.4 + AXIS_GAP).toBeGreaterThan(ZOOMS.day.dayPx)
    // …and the table fits it, with its 4px either side.
    expect(LABEL_PAD + axisLabelWidth('May 20') + AXIS_GAP).toBeLessThanOrEqual(ZOOMS.day.dayPx)
    // A character the table does not know counts as the widest glyph.
    expect(axisLabelWidth('é')).toBe(AXIS_GLYPH_PX.M)
  })
})

describe('dayIndexAtX: a click lands on the day cell under the pointer (S1, ruling B8a)', () => {
  it('no mask: the column that holds x, whichever half of it the pointer is in', () => {
    const P = ZOOMS.day.dayPx
    expect(dayIndexAtX(0, P)).toBe(0)
    expect(dayIndexAtX(P - 0.1, P)).toBe(0)
    expect(dayIndexAtX(P, P)).toBe(1)
    expect(dayIndexAtX(P * 1.5 + 1, P)).toBe(1) // past the middle of day 1: still day 1
    expect(dayIndexAtX(-3, P)).toBe(0)
    for (const zoomId of ['day', 'week', 'month', 'quarter']) {
      const q = ZOOMS[zoomId].dayPx
      for (let i = 0; i < 400; i++) {
        expect(dayIndexAtX(i * q + q * 0.25, q)).toBe(i)
        expect(dayIndexAtX(i * q + q * 0.75, q)).toBe(i)
      }
    }
  })

  it('weekends hidden: every point of a shown day\'s column is that day, however many weekends lie before it', () => {
    const start = new Date(2026, 7, 1) // a Saturday: the chart opens on a hidden weekend
    const P = ZOOMS.day.dayPx
    const m = weekendMask(start, 150, P)
    const mask = Array.from({ length: 151 }, (_, i) => ({ offsetPx: m.xOf(i), hidden: m.hidden(i) }))
    for (let i = 0; i <= 150; i++) {
      if (mask[i].hidden) continue
      for (const f of [0, 0.25, 0.5, 0.75, 0.999]) expect(dayIndexAtX(mask[i].offsetPx + f * P, P, mask), `day ${i} at ${f}`).toBe(i)
    }
    // Past the last column, the last shown day (never a hidden one).
    const last = dayIndexAtX(m.end + 500, P, mask)
    expect(mask[last].hidden).toBe(false)
  })

  it('weekends hidden, the two edges (review round 1): left of a chart that opens on a weekend is its first shown day; past a chart that ends on one, its last', () => {
    const P = ZOOMS.day.dayPx
    const toMask = (start, days) => {
      const m = weekendMask(start, days, P)
      return Array.from({ length: days + 1 }, (_, i) => ({ offsetPx: m.xOf(i), hidden: m.hidden(i) }))
    }
    const opens = toMask(new Date(2026, 7, 1), 20)  // Sat 1 Aug: indices 0 and 1 hidden
    expect(dayIndexAtX(-5, P, opens)).toBe(2)         // Mon 3 Aug
    expect(dayIndexAtX(0, P, opens)).toBe(2)
    const ends = toMask(new Date(2026, 7, 3), 6)      // Mon 3 … Sun 9 Aug: indices 5 and 6 hidden
    expect(ends[6].hidden).toBe(true)
    expect(dayIndexAtX(10000, P, ends)).toBe(4)       // Fri 7 Aug, never the hidden Sunday
    expect(dayIndexAtX(4 * P + 1, P, ends)).toBe(4)
  })

  it('CONTROL: the rounding it replaces put a click past a cell\'s middle on the NEXT day, and x / dayPx ignored the hidden weekends', () => {
    const P = ZOOMS.day.dayPx
    expect(Math.round((P * 1.5 + 1) / P)).toBe(2)
    const start = new Date(2026, 7, 1)
    const m = weekendMask(start, 30, P)
    const mask = Array.from({ length: 31 }, (_, i) => ({ offsetPx: m.xOf(i), hidden: m.hidden(i) }))
    const mon10 = 9 // Mon 10 Aug: two weekends (four hidden days) before it
    const x = mask[mon10].offsetPx + P / 4
    expect(Math.floor(x / P)).toBe(mon10 - 4) // Thu 6 Aug: four days early
    expect(dayIndexAtX(x, P, mask)).toBe(mon10)
  })
})

// =============================================================================
// Post-overhaul S5p (P1-32b): the gantt's one weekend mask and its one x ↔ day
// pair, which DetailPane draws with and TimelineView's six scroll conversions
// read with. Checked against this file's own rebuild of the mask
// (`weekendMask` above), never against the module. The conversions RENDERED
// — the first-mount centring, the re-anchoring, changeZoom, the visible
// window, scrollDetailToDay and Today, at every zoom with weekends shown and
// hidden — are timelineWeekends.test.jsx.
// =============================================================================
/** The rebuilt mask as the pane's array, and its chart width. */
const rebuilt = (start, totalDays, dayPx) => {
  const m = weekendMask(start, totalDays, dayPx)
  return { mask: Array.from({ length: totalDays + 1 }, (_, i) => ({ offsetPx: m.xOf(i), hidden: m.hidden(i) })), end: m.end }
}
/** Where a day comes back after day → x → day: itself when shown; a hidden
    day, the next shown day — or, past the chart's last shown day, the day
    after it (the chart's end). */
const comesBackAs = (mask, i) => {
  if (!mask || !mask[i].hidden) return i
  let j = i
  while (j < mask.length && mask[j].hidden) j++
  if (j < mask.length) return j
  let k = mask.length - 1
  while (k >= 0 && mask[k].hidden) k--
  return k + 1
}
/** The pair's contract on one chart, every day: each day (and each fraction
    into a shown one) comes back as `comesBackAs` says; every x on the chart
    comes back as itself. Throws at the first that does not — the CONTROL runs
    it on the conversions this replaced. */
function assertPair(dayAt, xAt, { mask = null, days = 400, end, dayPx }) {
  for (let i = 0; i <= days; i++) {
    expect(dayAt(xAt(i)), `day ${i}`).toBe(comesBackAs(mask, i))
    if (mask && mask[i].hidden) continue
    for (const f of [0.25, 0.5, 0.75]) expect(dayAt(xAt(i + f)), `day ${i} + ${f}`).toBeCloseTo(i + f, 9)
  }
  for (let x = 0; x < (end ?? days * dayPx); x += 5) expect(xAt(dayAt(x)), `x ${x}`).toBeCloseTo(x, 9)
}
/** A chart opening on each day of the week (1 Aug 2026 is a Saturday). */
const OPENINGS = Array.from({ length: 7 }, (_, k) => new Date(2026, 7, 1 + k))

describe('S5p: weekendMask, dayAtX and xAtDay — one mask, one pair (P1-32b)', () => {
  const P = ZOOMS.day.dayPx
  it('weekendMask is the pane\'s mask, as rebuilt here: each day\'s x and hidden flag, and the chart\'s width, from every weekday', () => {
    for (const start of OPENINGS) {
      const ref = rebuilt(start, 120, P)
      const m = TM.weekendMask(start, 120, P)
      expect(m.mask).toEqual(ref.mask)
      expect(m.totalPx).toBe(ref.end)
    }
  })
  it('the pair is its own inverse on every day, mask on and off: a shown day (and any fraction into it) comes back, a hidden day comes back as the next shown one, and every x on the chart comes back', () => {
    for (const zoomId of ['day', 'week', 'month', 'quarter']) {
      const q = ZOOMS[zoomId].dayPx
      assertPair((x) => TM.dayAtX(x, q), (d) => TM.xAtDay(d, q), { dayPx: q })
    }
    for (const start of OPENINGS) {
      for (const days of [120, 121, 125, 126]) { // ending on every weekday, Saturday and Sunday among them
        const { mask, end } = rebuilt(start, days, P)
        assertPair((x) => TM.dayAtX(x, P, mask), (d) => TM.xAtDay(d, P, mask), { mask, days, end, dayPx: P })
      }
    }
  })
  it('a hidden day maps to the next shown day: Sat 8 and Sun 9 Aug 2026 sit at Mon 10 Aug\'s x and read back as Monday', () => {
    const { mask } = rebuilt(new Date(2026, 7, 3), 30, P) // Mon 3 Aug
    expect(mask[5].hidden && mask[6].hidden && !mask[7].hidden).toBe(true)
    expect(TM.xAtDay(5, P, mask)).toBe(mask[7].offsetPx)
    expect(TM.xAtDay(6.5, P, mask)).toBe(mask[7].offsetPx)
    expect(TM.dayAtX(TM.xAtDay(5.5, P, mask), P, mask)).toBe(7)
  })
  it('Math.floor(dayAtX(x)) is dayIndexAtX(x) at every pixel of the chart; left of it, its first shown day; at or past its end, the day after its last shown day', () => {
    for (const start of OPENINGS) {
      const { mask, end } = rebuilt(start, 60, P)
      for (let x = 0; x < end; x++) expect(Math.floor(TM.dayAtX(x, P, mask)), `x ${x}`).toBe(dayIndexAtX(x, P, mask))
      const first = mask.findIndex((m) => !m.hidden)
      expect(TM.dayAtX(-20, P, mask)).toBe(first)
      expect(TM.xAtDay(-3, P, mask)).toBe(0)
      let last = mask.length - 1
      while (mask[last].hidden) last--
      expect(TM.dayAtX(end, P, mask)).toBe(last + 1)
      expect(TM.dayAtX(end + 300, P, mask)).toBe(last + 1)
      expect(TM.xAtDay(10000, P, mask)).toBe(end)
    }
  })
  it('visibleDayRange: without a mask, the old arithmetic exactly; with one, the calendar days the shown columns cover, so a weekend inside the view is inside the window', () => {
    for (const [s, w, q] of [[4904 / 22, 1190, 22], [12483 / 56, 1190, 56], [0, 1030, 8], [-3, 100, 4], [17, 0, 56]]) {
      expect(TM.visibleDayRange(s, w, q)).toEqual({ start: Math.max(0, s), end: Math.max(0, s) + Math.max(1, w / q) })
    }
    // The fixtures' chart (Wed 4 Feb 2026 + 857 days), Fri 11 Dec half a column
    // in, 1190px of gantt: 21.25 columns on, three-quarters into the 21st
    // shown day after Friday — Mon 11 Jan 2027, 31 calendar days on.
    const { mask } = rebuilt(new Date(2026, 1, 4), 857, P)
    const fri = 310
    const r = TM.visibleDayRange(fri + 0.5, 1190, P, mask)
    expect(r.start).toBe(fri + 0.5)
    expect(r.end).toBeCloseTo(fri + 31 + 0.75, 9) // Mon 11 Jan 2027: the gantt's last column
    expect(r.end - r.start).toBeGreaterThan(1190 / P) // more days than columns: the weekends are in the window
    expect(TM.visibleDayRange(5, -500, P, mask)).toEqual({ start: 5, end: 6 }) // at least one day, as before
  })
  it('CONTROL: the conversions this replaced fail the same contract — x / dayPx and day × dayPx with the mask on, and the pane\'s rounding xAtDay', () => {
    const { mask, end } = rebuilt(new Date(2026, 1, 4), 120, P)
    const opts = { mask, days: 120, end, dayPx: P }
    expect(() => assertPair((x) => x / P, (d) => TM.xAtDay(d, P, mask), opts)).toThrow()
    expect(() => assertPair((x) => TM.dayAtX(x, P, mask), (d) => d * P, opts)).toThrow()
    const rounded = (d) => mask[Math.max(0, Math.min(mask.length - 1, Math.round(d)))].offsetPx // DetailPane's dayToX before S5p
    expect(() => assertPair((x) => TM.dayAtX(x, P, mask), rounded, opts)).toThrow()
    // The measured +88 days: Fri 11 Dec 2026 half a column in, read as x / 56.
    const big = rebuilt(new Date(2026, 1, 4), 857, P).mask
    const x = TM.xAtDay(310.5, P, big)
    expect(x).toBe(12460)
    expect(Math.floor(x / P)).toBe(222) // Mon 14 Sep 2026: the switch's −88 days
    expect(Math.floor(TM.dayAtX(x, P, big))).toBe(310)
    // …and the old window, start + 1190 / 56, ended on Fri 1 Jan: nine days
    // short of the gantt's last column (the four weekends in view).
    expect(Math.floor(310.5 + 1190 / P)).toBe(310 + 21)
    expect(310.5 + 1190 / P).toBeLessThan(310 + 31)
  })
})

describe('isMonthStartShown: where a month shows its start', () => {
  const d = (y, m, day) => new Date(y, m, day)
  it('the 1st, with weekends shown', () => {
    expect(isMonthStartShown(d(2026, 7, 1))).toBe(true)   // a Saturday
    expect(isMonthStartShown(d(2026, 10, 2))).toBe(false)
  })
  it('with weekends hidden: a weekday 1st; else Monday the 2nd (a Sunday 1st) or the 3rd (a Saturday 1st); never another Monday', () => {
    expect(isMonthStartShown(d(2026, 11, 1), true)).toBe(true)   // Tue 1 Dec
    expect(isMonthStartShown(d(2026, 7, 1), true)).toBe(false)   // Sat 1 Aug (not drawn)
    expect(isMonthStartShown(d(2026, 7, 3), true)).toBe(true)    // Mon 3 Aug
    expect(isMonthStartShown(d(2026, 10, 1), true)).toBe(false)  // Sun 1 Nov
    expect(isMonthStartShown(d(2026, 10, 2), true)).toBe(true)   // Mon 2 Nov
    expect(isMonthStartShown(d(2026, 10, 9), true)).toBe(false)  // Mon 9 Nov
    expect(isMonthStartShown(d(2026, 7, 3))).toBe(false)         // shown weekends: the 1st draws it
  })
})

describe('buildAxisTicks: a line on every tick, a label only where it fits, a month\'s start always wins', () => {
  it('the four zooms are TimelineView\'s', () => {
    expect(ZOOMS).toEqual({ day: { dayPx: 56, axisFormat: 'day' }, week: { dayPx: 22, axisFormat: 'week' },
      month: { dayPx: 8, axisFormat: 'month' }, quarter: { dayPx: 4, axisFormat: 'quarter' } })
  })

  it('no label reaches the next tick\'s line, and no two labels overlap — every zoom, from every weekday, weekends shown and hidden', () => {
    let suppressed = 0
    for (const [zoomId, weekendsHidden] of RUNS) {
      for (let k = 0; k < 7; k++) {
        const start = new Date(2026, 0, 5 + k) // Mon 5 Jan 2026 … Sun 11 Jan
        const ticks = header(start, 730, zoomId, { weekendsHidden })
        const shown = ticks.filter((t) => t.label)
        expect(shown.length, `${zoomId}${weekendsHidden ? ' hidden' : ''} from ${k}`).toBeGreaterThan(10)
        ticks.forEach((t, i) => {
          if (!t.label) { suppressed++; return }
          if (t.major) return // a month's start always prints; its neighbours give way (below)
          const next = ticks[i + 1]
          if (next) {
            expect(t.x + LABEL_PAD + axisLabelWidth(t.label) + AXIS_GAP, `${zoomId} "${t.label}" before "${next.label ?? '(no label)'}"`)
              .toBeLessThanOrEqual(next.x + 0.001)
          }
        })
        for (let i = 1; i < shown.length; i++) {
          const a = shown[i - 1]
          expect(a.x + LABEL_PAD + axisLabelWidth(a.label) + AXIS_GAP, `${zoomId} "${a.label}" then "${shown[i].label}"`)
            .toBeLessThanOrEqual(shown[i].x + LABEL_PAD + 0.001)
        }
      }
    }
    // Not vacuous: somewhere a label gave way and kept its line.
    expect(suppressed).toBeGreaterThan(0)
  })

  it('every tick keeps its line: a day at Day zoom, a Monday or a month\'s start at Week, a 1st at Month and Quarter', () => {
    const start = new Date(2026, 6, 1)
    const expectTicks = (zoomId, keep, weekendsHidden = false) => {
      const ticks = header(start, 400, zoomId, { weekendsHidden })
      const want = []
      for (let i = 0; i <= 400; i++) if (keep(new Date(2026, 6, 1 + i))) want.push(i)
      expect(ticks.map((t) => t.offset), zoomId).toEqual(want)
    }
    const weekday = (d) => d.getDay() !== 0 && d.getDay() !== 6
    expectTicks('day', () => true)
    expectTicks('day', weekday, true)
    expectTicks('week', (d) => d.getDay() === 1 || d.getDate() === 1)
    expectTicks('month', (d) => d.getDate() === 1)
    expectTicks('quarter', (d) => d.getDate() === 1)
  })

  it('every month\'s start prints its month and its day, at Day and Week zoom, with weekends shown and hidden', () => {
    const start = new Date(2026, 0, 1)
    for (const [zoomId, weekendsHidden] of [['day', false], ['day', true], ['week', false]]) {
      const majors = header(start, 729, zoomId, { weekendsHidden }).filter((t) => t.major) // to 31 Dec 2027
      expect(majors).toHaveLength(24) // Jan 2026 … Dec 2027, one each
      for (const t of majors) {
        const d = dayOf(start, t)
        expect(t.topLabel, `${zoomId} ${d.toDateString()}`).toBe(`${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`)
        expect(t.label).toBe(`${t.topLabel.slice(0, 3)} ${d.getDate()}`)
      }
    }
  })

  it('Week zoom, the fixtures\' Nov 30 → Dec 1 2026 (a Monday, then a Tuesday 1st): Nov 30 keeps its line and gives way; "Dec 2026 / Dec 1" prints', () => {
    const start = new Date(2026, 7, 1)
    const ticks = header(start, 200, 'week')
    const at = (m, day) => ticks.find((t) => dayOf(start, t).getTime() === new Date(2026, m, day).getTime())
    expect(at(10, 30)).toMatchObject({ label: null, major: false })
    expect(at(11, 1)).toMatchObject({ label: 'Dec 1', topLabel: 'Dec 2026', major: true })
    // A Wednesday 1st: the Monday two days before gives way too ("Jun 29" is 42px, the gap 44).
    const july = header(new Date(2026, 5, 1), 60, 'week')
    const jAt = (m, day) => july.find((t) => dayOf(new Date(2026, 5, 1), t).getTime() === new Date(2026, m, day).getTime())
    expect(jAt(5, 29)).toMatchObject({ label: null })
    expect(jAt(6, 1)).toMatchObject({ label: 'Jul 1', topLabel: 'Jul 2026' })
    // A Thursday 1st: three days (66px) is room enough, and "Sep 28" prints.
    expect(at(8, 28)).toMatchObject({ label: 'Sep 28' })
    expect(at(9, 1)).toMatchObject({ label: 'Oct 1', topLabel: 'Oct 2026' })
    // A Sunday 1st: the Monday after lies inside "Nov 1", so it gives way and keeps its line.
    expect(at(10, 1)).toMatchObject({ label: 'Nov 1', major: true })
    expect(at(10, 2)).toMatchObject({ label: null, major: false })
    // A Saturday 1st: two days (44px) clear "Aug 1", and "Aug 3" prints.
    expect(at(7, 3)).toMatchObject({ label: 'Aug 3' })
  })

  it('Day zoom keeps a label on every day — shown and hidden weekends — and hides no weekday', () => {
    for (const weekendsHidden of [false, true]) {
      // The chart's last day (1 Jan 2028, where the chart ends) is the
      // end-of-chart rule's, below.
      const ticks = header(new Date(2026, 0, 1), 730, 'day', { weekendsHidden }).filter((t) => t.offset < 730)
      expect(ticks.length).toBeGreaterThan(500)
      expect(ticks.filter((t) => !t.label).map((t) => dayOf(new Date(2026, 0, 1), t).toDateString())).toEqual([])
    }
  })

  it('weekends hidden: August and November 2026 (a Saturday and a Sunday 1st) show on Monday the 3rd and the 2nd; no tick on a hidden day', () => {
    const start = new Date(2026, 7, 1)
    const ticks = header(start, 150, 'day', { weekendsHidden: true })
    for (const t of ticks) expect([0, 6], dayOf(start, t).toDateString()).not.toContain(dayOf(start, t).getDay())
    const majors = ticks.filter((t) => t.major).map((t) => [dayOf(start, t).toDateString(), t.topLabel, t.label])
    expect(majors).toEqual([
      ['Mon Aug 03 2026', 'Aug 2026', 'Aug 3'],
      ['Tue Sep 01 2026', 'Sep 2026', 'Sep 1'],
      ['Thu Oct 01 2026', 'Oct 2026', 'Oct 1'],
      ['Mon Nov 02 2026', 'Nov 2026', 'Nov 2'],
      ['Tue Dec 01 2026', 'Dec 2026', 'Dec 1'],
    ])
  })

  it('a label the chart\'s end would cut is not drawn; its line stays', () => {
    const ticks = header(new Date(2026, 0, 1), 40, 'day')
    const last = ticks[ticks.length - 1]
    expect(last.offset).toBe(40)
    expect(last.label).toBe(null)
    for (const t of ticks.filter((x) => x.label && !x.major)) {
      expect(t.x + LABEL_PAD + axisLabelWidth(t.label)).toBeLessThanOrEqual(40 * ZOOMS.day.dayPx + 0.001)
    }
  })

  it('CONTROL: the rule it replaces (a Monday tick only when it lies far enough AFTER the last 1st) prints "Nov 30" into Dec 1\'s column, and LABEL_GAP would thin Day zoom', () => {
    // The old header, verbatim in its week branch.
    const oldWeek = (start, totalDays, dayPx) => {
      const out = []
      let lastMajor = -Infinity
      const MIN_GAP = Math.max(3, Math.ceil(60 / dayPx))
      for (let i = 0; i <= totalDays; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        if (d.getDate() === 1) { out.push({ offset: i, label: `${d.getMonth()}/1`, major: true }); lastMajor = i }
        else if (d.getDay() === 1 && i - lastMajor >= MIN_GAP) out.push({ offset: i, label: `${d.getMonth()}/${d.getDate()}`, major: false })
      }
      return out
    }
    const start = new Date(2026, 7, 1)
    const old = oldWeek(start, 200, ZOOMS.week.dayPx)
    const nov30 = old.findIndex((t) => dayOf(start, t).getTime() === new Date(2026, 10, 30).getTime())
    expect(nov30).toBeGreaterThan(-1)
    const room = (old[nov30 + 1].offset - old[nov30].offset) * ZOOMS.week.dayPx
    expect(LABEL_PAD + axisLabelWidth('Nov 30') + AXIS_GAP).toBeGreaterThan(room) // 22px: it cannot fit, and it printed
    // LABEL_GAP (the minimap's 12px) would not fit "May 20" in a 56px Day column: a label on every other day.
    expect(LABEL_PAD + 45.03 + LABEL_GAP).toBeGreaterThan(ZOOMS.day.dayPx)
  })
})
