// =============================================================================
// timelineMinimap.js — the arithmetic behind the Timeline's minimap (the
// OverviewPane), kept out of TimelineView.jsx so it can be tested without a
// DOM. UI overhaul B3, 2026-09-24; Audrey's ruling Q22: the minimap is a
// PRIORITY — "every phase drawn, no silent truncation after six, legible
// labels".
//
// What was wrong, measured on the fixture and in the code:
//
//   1. Rows. The minimap's body is 124px (160 − a 24px axis − a 10px
//      scrollbar − 2px of border) with `overflow: hidden`, and every phase
//      row was 22px. 124 / 22 = 5.6: from the sixth phase down the navigator
//      stopped showing the project, and nothing said so (review TL-17).
//      `minimapLayout` gives every phase a row, at any count.
//
//   2. The axis. Every month was labelled "Mon YYYY" at 13px, one label per
//      month, whatever the zoom: at the default two-year span a month is
//      about 50px wide and the label about 60px, so the labels printed over
//      each other (V1-07, and the before shots). `minimapTicks` labels on a
//      stride of 1, 2, 3, 6 or 12 months, the smallest that leaves every
//      label its own room, and writes the year once, where it changes.
//
//   3. The zoom readout. It rounded: a 2.35-year span read "2 yr", and after
//      "Fit" on a 137-day project (below the slider's own 6-month minimum)
//      it read "5 mo". `spanLabel` says what is drawn, to one decimal.
//
//   4. The snap marks on the zoom slider sat at a guessed inset ("the typical
//      thumb half-width"); `snapLeft` places them from the thumb's real,
//      styled width, so a mark and the value it marks are the same pixel.
// =============================================================================

/** The minimap's vertical budget. Every number is a pixel. */
export const MINIMAP = Object.freeze({
  /** The body it has always had: 160 − 24 (axis) − 10 (scrollbar) − 2 (border). */
  BODY_H: 124,
  /** A phase row at rest (the old OVERVIEW_PHASE_ROW_PX): five phases look as they did. */
  ROW_MAX: 22,
  /** The shortest row that still carries its phase's name at the Caption step (12px). */
  ROW_NAMED: 18,
  /** The shortest row a bar is drawn in: its bar is then 4px, still a mark you can hit. */
  ROW_FLOOR: 8,
  /** How tall the body may grow to keep the names (1.5 × the old body). */
  BODY_CAP: 186,
})

/**
 * Every phase gets a row, whatever the count — the body never clips one.
 *
 *   ≤ 5 phases     22px rows in the old 124px body (unchanged picture)
 *   6              rows shrink toward 18px, names kept, body unchanged
 *   7 – 10         18px rows, the body grows to fit them (≤ 186px), names kept
 *   11 – 23        rows shrink toward 8px inside 186px; names move to the hover card
 *   24 +           8px rows, the body grows 8px per phase
 *
 * @param {number} count  phases (sub-phases included) the minimap draws
 * @returns {{ rowH: number, bodyH: number, named: boolean }}
 */
export function minimapLayout(count, m = MINIMAP) {
  const n = Math.max(0, Math.floor(count || 0))
  let rowH
  let bodyH
  if (n * m.ROW_MAX <= m.BODY_H) {
    rowH = m.ROW_MAX; bodyH = m.BODY_H
  } else if (n * m.ROW_NAMED <= m.BODY_H) {
    rowH = Math.floor(m.BODY_H / n); bodyH = m.BODY_H
  } else if (n * m.ROW_NAMED <= m.BODY_CAP) {
    rowH = m.ROW_NAMED; bodyH = Math.max(m.BODY_H, n * m.ROW_NAMED)
  } else if (n * m.ROW_FLOOR <= m.BODY_CAP) {
    rowH = Math.floor(m.BODY_CAP / n); bodyH = m.BODY_CAP
  } else {
    rowH = m.ROW_FLOOR; bodyH = n * m.ROW_FLOOR
  }
  return { rowH, bodyH, named: rowH >= m.ROW_NAMED }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The strides a month axis is labelled on; each divides 12, so January is always on one. */
export const STRIDES = [1, 2, 3, 6, 12]
/** The room a label needs beyond its own width. */
export const LABEL_GAP = 12

/** A label's width at the Caption step (12px Geist): measured, 7px a character is
    at or above every glyph the axis writes (digits and capitals are the widest). */
export const estimateWidth = (label) => String(label).length * 7

/**
 * The minimap axis: a line at every month (as before), a label on a stride.
 *
 * Label text: "Mar"; January is its year, "2027"; the FIRST labelled month
 * carries its year too ("Sep 2026") when there is room, so the axis always
 * says which year it starts in. The stride is the smallest of 1/2/3/6/12
 * months at which every label, the long ones included, has LABEL_GAP of
 * clear space before the next.
 *
 * @param {Date} start       the minimap window's first day (local midnight)
 * @param {number} totalDays the window's length in days
 * @param {number} dayPx     pixels per day
 * @param {(label: string) => number} [measure] width of a label in px
 * @returns {{ ticks: Array<{ key, offset, major, label: string|null }>, stride: number }}
 */
export function minimapTicks(start, totalDays, dayPx, measure = estimateWidth) {
  const ticks = []
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    if (d.getDate() !== 1) continue
    ticks.push({ key: i, offset: i, month: d.getMonth(), year: d.getFullYear(), major: d.getMonth() === 0 })
  }
  const monthPx = 30.44 * dayPx
  const widest = Math.max(measure('May'), measure('2026'))
  const stride = STRIDES.find((k) => k * monthPx >= widest + LABEL_GAP) || 12
  let labelled = 0
  const out = ticks.map((t, idx) => {
    if (t.month % stride !== 0) return { key: t.key, offset: t.offset, major: t.major, label: null }
    let label = t.major ? String(t.year) : MONTHS[t.month]
    if (labelled === 0 && !t.major) {
      const withYear = `${MONTHS[t.month]} ${t.year}`
      const next = ticks.slice(idx + 1).find((u) => u.month % stride === 0)
      const room = next ? (next.offset - t.offset) * dayPx : Infinity
      if (measure(withYear) + LABEL_GAP <= room) label = withYear
    }
    labelled++
    return { key: t.key, offset: t.offset, major: t.major, label }
  })
  return { ticks: out, stride }
}

/**
 * The minimap span as a reader would say it, to one decimal, never rounded
 * past what is drawn: 137 → "4.5 mo", 183 → "6 mo", 857 → "2.3 yr",
 * 1825 → "5 yr". Under two months it counts days.
 */
export function spanLabel(days) {
  const d = Math.max(0, Math.round(days || 0))
  const one = (x) => { const s = x.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s }
  if (d < 60) return `${d} d`
  if (d < 365) return `${one(d / 30.44)} mo`
  return `${one(d / 365.25)} yr`
}

/**
 * Where a value sits on a styled range input, in px from the input's left
 * edge: the thumb's centre travels from half a thumb in to half a thumb from
 * the end. The zoom slider's thumb is styled to `thumb` px wide, so this is
 * exact rather than "the typical thumb half-width".
 */
export function snapLeft(value, min, max, trackW, thumb) {
  const span = Math.max(1, max - min)
  const f = Math.min(1, Math.max(0, (value - min) / span))
  return thumb / 2 + f * (trackW - thumb)
}

/**
 * Which side of the minimap window a phase lies wholly outside of, or null
 * when any of it is inside. A phase off the window keeps its row and says
 * where it went, rather than leaving an empty row (no silent truncation
 * sideways either).
 */
export function offWindow(rowStart, rowEnd, winStart, winEnd) {
  if (!rowStart || !rowEnd) return null
  if (rowEnd < winStart) return 'before'
  if (rowStart > winEnd) return 'after'
  return null
}
