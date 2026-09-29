// =============================================================================
// timelineMinimap.test.js — the minimap's arithmetic (UI overhaul B3, Q22).
// The render half, which mounts the minimap and counts the phases it draws
// against the data, is timelineMinimapRender.test.jsx.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  MINIMAP, minimapLayout, minimapTicks, spanLabel, snapLeft, offWindow,
  STRIDES, LABEL_GAP, LABEL_PAD, estimateWidth,
} from './timelineMinimap.js'

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
