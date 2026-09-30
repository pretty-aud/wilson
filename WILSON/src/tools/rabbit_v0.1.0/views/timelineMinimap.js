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
/** A label's inset from its month's line: the tick's `px-1` in OverviewPane. */
export const LABEL_PAD = 4

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
    // B3d (review round 2): a label the pane's right edge would cut ("Oc" at
    // 1024 wide over 2 years) is not drawn; its month keeps its line. The pane
    // is `totalDays * dayPx` wide (OverviewPane's dayPx is its width / days).
    if (t.offset * dayPx + LABEL_PAD + measure(label) > totalDays * dayPx) {
      return { key: t.key, offset: t.offset, major: t.major, label: null }
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

// =============================================================================
// The GANTT's header (DetailPane) — post-overhaul S1, 2026-09-30. Audrey's
// ruling B2, option B: "a label prints only when it fits before the next
// tick, and the 1st always wins". Moved here from TimelineView.jsx so it is
// tested without a DOM, beside the minimap's axis, whose rule it now takes.
//
// What was wrong, measured on the fixtures (Aug–Dec 2026):
//
//   1. Week zoom. Every month's 1st is a major tick, two lines ("Dec 2026"
//      over "Dec 1"), and a Monday was a tick only when it lay far enough
//      AFTER the last 1st — a look-back only. A Monday the day BEFORE a 1st
//      was always drawn and its label printed under the 1st's line and
//      labels: "Nov 30" under "Dec 2026 / Dec 1".
//   2. Day zoom. The month label ("Dec 2026", 59px) is wider than a day's
//      56px column, so the next day's tick line crossed it.
//   3. Day zoom, weekends hidden. A 1st on a Saturday or Sunday is not drawn,
//      and with it went its month's label and bold line (August and November
//      2026 had neither).
//
// The rule: every tick keeps its LINE; a tick's label prints only when it
// fits before the next tick's line,
//
//     x + LABEL_PAD + width(label) + AXIS_GAP  <=  x of the next tick,
//
// and a month's first SHOWN day always prints its labels — a neighbour whose
// label would start inside them gives way instead. The 1st's labels sit on
// the paper (rabbitTimeline.css), so a line that crosses one is covered.
// With weekends hidden, a month whose 1st is a weekend takes its label and
// its bold line on its first shown day. A label the chart's end would cut is
// not drawn (the minimap's B3d rule). The claim this function's old header
// made — "the first tick always gets a full Mon YYYY label" — was never what
// it did, and it is not what it does.
// =============================================================================

/**
 * A glyph's advance at the Dense step (13px Geist 400, the header's face),
 * MEASURED once in Chromium (Electron's engine) on 2026-09-30 and rounded UP
 * to 0.1px, so a label's estimate is never under its drawn width: over every
 * label the header can print (372 day labels, 108 months, 36 quarters, the 12
 * abbreviations) the worst case is 0.08px over ("Jul"). One width a character
 * could not do it: "May" is 8.37px a character and "May 20" 7.5, so a figure
 * high enough for "May" (8.4) makes every two-digit day too wide for a 56px
 * Day column and one low enough for the days (7.6, the brief's estimate)
 * under-measures "May", "May 2030" and "Q4 2030". The space is measured
 * inside a label (a lone space collapses): "Sep 1" is 31.66px, its four
 * glyphs 28.38. A character not in the table counts as the widest, M.
 */
export const AXIS_GLYPH_PX = Object.freeze({
  '0': 8.7, '1': 5.0, '2': 8.1, '3': 8.0, '4': 8.0, '5': 8.2, '6': 7.8, '7': 6.9, '8': 7.9, '9': 7.8, ' ': 3.3,
  A: 8.7, D: 9.1, F: 7.7, J: 7.8, M: 11.5, N: 9.7, O: 9.7, Q: 9.6, S: 8.4,
  a: 7.2, b: 7.8, c: 7.2, e: 7.3, g: 7.8, l: 3.5, n: 7.6, o: 7.5, p: 7.8, r: 5.0, t: 5.2, u: 7.5, v: 7.0, y: 7.0,
})
const AXIS_GLYPH_WIDEST = AXIS_GLYPH_PX.M

/** A gantt header label's width in px at the Dense step: an upper bound. */
export const axisLabelWidth = (label) => [...String(label ?? '')]
  .reduce((w, ch) => w + (AXIS_GLYPH_PX[ch] ?? AXIS_GLYPH_WIDEST), 0)

/**
 * The clear space a gantt label keeps before the next tick's line: the same
 * 4px it keeps from its own (LABEL_PAD, the tick's `px-1`). Not the
 * minimap's LABEL_GAP: the minimap's labels float on a stride between month
 * lines, while every gantt tick is a line with a label in its own column,
 * and at Day zoom a column is 56px — "May 20" (45.03px drawn) + 4 + 12 would
 * need 61, so LABEL_GAP would print a label on every other day.
 */
export const AXIS_GAP = LABEL_PAD

/**
 * Is `d` the day that shows its month's start? The 1st, unless weekends are
 * hidden and the 1st is a Saturday or Sunday — then the first day SHOWN:
 * Monday the 2nd (the 1st was a Sunday) or Monday the 3rd (a Saturday).
 * DetailPane's grid draws the month's bold line where this says, and
 * buildAxisTicks puts the month's label there.
 */
export function isMonthStartShown(d, weekendsHidden = false) {
  const date = d.getDate()
  const dow = d.getDay()
  if (date === 1) return !weekendsHidden || (dow !== 0 && dow !== 6)
  return weekendsHidden && dow === 1 && (date === 2 || date === 3)
}

const dayLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
const monthLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
const quarterLabel = (d) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`

/**
 * The gantt's axis ticks at one zoom.
 *
 *   day      every shown day, "Dec 3"; a month's start is major, with its
 *            month ("Dec 2026") above
 *   week     every Monday, "Dec 7", and every month's start (major, with its
 *            month above)
 *   month    every 1st, "Dec 2026"; January is major
 *   quarter  every 1st: a quarter's is major, "Q1 2026" above "Jan 2026";
 *            the others "Feb"
 *
 * @param {Date} start       the chart's first day (local midnight)
 * @param {number} totalDays the chart runs from day 0 to day totalDays
 * @param {{ dayPx: number, axisFormat: string }} zoom
 * @param {object} [opts]
 * @param {(i: number) => boolean} [opts.hidden]  a day that is not drawn (weekends hidden at Day zoom)
 * @param {(i: number) => number} [opts.xOf]      a day's left edge in px (the weekend mask's); default i × dayPx
 * @param {number} [opts.end]                     the chart's right edge in px; default xOf(totalDays)
 * @param {(label: string) => number} [opts.measure] a label's width; default axisLabelWidth
 * @returns {Array<{ key: number, offset: number, label: string|null, topLabel: string|null, major: boolean }>}
 *          one per tick LINE; `label` null where it does not fit
 */
export function buildAxisTicks(start, totalDays, zoom, opts = {}) {
  const dayPx = zoom.dayPx
  const hidden = opts.hidden || null
  const xOf = opts.xOf || ((i) => i * dayPx)
  const measure = opts.measure || axisLabelWidth
  const end = opts.end ?? xOf(totalDays)
  const weekendsHidden = !!hidden
  const ticks = []
  for (let i = 0; i <= totalDays; i++) {
    if (hidden && hidden(i)) continue
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    let label = null
    let topLabel = null
    let major = false
    switch (zoom.axisFormat) {
      case 'day':
        label = dayLabel(d)
        major = isMonthStartShown(d, weekendsHidden)
        if (major) topLabel = monthLabel(d)
        break
      case 'week':
        if (isMonthStartShown(d, weekendsHidden)) {
          major = true
          topLabel = monthLabel(d)
          label = dayLabel(d)
        } else if (d.getDay() === 1) {
          label = dayLabel(d)
        }
        break
      case 'month':
        if (d.getDate() === 1) {
          label = monthLabel(d)
          major = d.getMonth() === 0
        }
        break
      case 'quarter':
        if (d.getDate() === 1) {
          if (d.getMonth() % 3 === 0) {
            major = true
            topLabel = quarterLabel(d)
            label = monthLabel(d)
          } else {
            label = MONTHS[d.getMonth()]
          }
        }
        break
      default:
        break
    }
    if (label !== null) ticks.push({ key: i, offset: i, x: xOf(i), label, topLabel, major })
  }

  // The measured rule. A major's labels always print and push `reach` past
  // them; any other label prints only when it starts clear of the last label
  // printed and ends AXIS_GAP before the next tick's line (or the chart's end).
  let reach = -Infinity
  return ticks.map((t, k) => {
    const width = measure(t.label)
    const labelEnd = t.x + LABEL_PAD + width + AXIS_GAP
    let shown
    if (t.major) {
      shown = true
    } else {
      const next = ticks[k + 1]
      const limit = next ? next.x : end + AXIS_GAP
      shown = t.x + LABEL_PAD >= reach && labelEnd <= limit
    }
    if (shown) reach = labelEnd
    return { key: t.key, offset: t.offset, label: shown ? t.label : null, topLabel: t.topLabel, major: t.major }
  })
}
