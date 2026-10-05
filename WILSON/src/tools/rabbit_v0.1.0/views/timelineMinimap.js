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
// not drawn (the minimap's B3d rule) — except a month's start's, which always
// print, as they always did (a chart that ends on a 1st, 18 months past the
// project, prints it past the end). The claim this function's old header
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
 * The clear space a gantt label keeps before the next tick's line, in the
 * rule's arithmetic: the same 4px it keeps from its own (LABEL_PAD, the
 * tick's `px-1`). The tick's own 1px line sits before that padding, so the
 * drawn text starts 5px after its line and ends at least 3px before the
 * next (review round 1 measured no line touching text). Not the
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

/**
 * The day whose column holds `x` px — the inverse of DetailPane's dayToX,
 * honouring the weekend mask. Post-overhaul S1 (ruling B8a): a click that
 * creates a task lands on the day cell under the pointer. It rounded to the
 * nearest column EDGE, so a click past a cell's middle made the task on the
 * next day, and with weekends hidden `x / dayPx` counted the hidden days'
 * columns that are not drawn (two days out per weekend crossed).
 *
 * @param {number} x       px from the chart's left edge
 * @param {number} dayPx   a day column's width
 * @param {Array<{ offsetPx: number, hidden: boolean }>|null} [mask] the weekend mask, day by day
 * @returns {number} a day index from the chart's first day (a shown day's, with a mask)
 */
export function dayIndexAtX(x, dayPx, mask = null) {
  if (!mask || mask.length === 0) return Math.max(0, Math.floor(x / dayPx))
  // A hidden day shares its offset with the shown day after it, so the last
  // index whose column starts at or before x is a shown day — or, past the
  // chart's last shown day, a trailing weekend; step back to a shown one.
  let lo = 0
  let hi = mask.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (mask[mid].offsetPx <= x) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  while (found > 0 && mask[found].hidden) found--
  while (found < mask.length - 1 && mask[found].hidden) found++
  return found
}

// =============================================================================
// The gantt's x ↔ day — post-overhaul S5p, 2026-10-05 (P1-32b).
//
// With "Show weekends" off at Day zoom a Saturday or Sunday column is not
// drawn: it takes no width, and the shown day after it starts where it would
// have. Only DetailPane knew. TimelineView turned the gantt's scroll into days
// as `scrollLeft / DAY_PX` in six places — the zoom's re-anchoring,
// changeZoom, the visible window (which places the minimap's window),
// scrollDetailToDay (the minimap's click and drag), Today and the first-mount
// centring — so with weekends hidden each of them counted a shown column as a
// calendar day. Measured in the running app on the fixtures, 1440x900 (S1's
// review round 2, again by S5p): Week → Day moved the gantt from Mon 14 Sep
// to Fri 11 Dec 2026 (+88 days); at Day zoom the minimap's window read
// 15 Sep – 6 Oct while the gantt showed 11 Dec – 12 Jan; Today put 10 Dec at
// the left with today off screen; the switch kept the scroll's pixels, not
// its date (11 Dec → 14 Sep).
//
// One mask (weekendMask), one pair (dayAtX and its inverse xAtDay). The pane
// draws with them and the six conversions read with them; TimelineView
// records where the gantt is as a DAY, which needs neither the old scale nor
// the old mask to put it back.
// =============================================================================

/**
 * A Day-zoom chart's weekend mask: for each day 0 … totalDays from `start`,
 * the x its column starts at and whether it is hidden. A hidden day takes no
 * width, so it starts where the next shown day starts; past the last shown
 * day, at the chart's end. Lifted from DetailPane, unchanged.
 *
 * @param {Date} start       the chart's first day (local midnight)
 * @param {number} totalDays the chart's last day index
 * @param {number} dayPx     a shown column's width
 * @returns {{ mask: Array<{ offsetPx: number, hidden: boolean }>, totalPx: number }}
 */
export function weekendMask(start, totalDays, dayPx) {
  const mask = new Array(totalDays + 1)
  let x = 0
  for (let i = 0; i <= totalDays; i++) {
    const dow = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getDay()
    const hidden = dow === 0 || dow === 6
    mask[i] = { offsetPx: x, hidden }
    if (!hidden) x += dayPx
  }
  return { mask, totalPx: x }
}

/**
 * Where an x on the gantt falls, as a day position: the day whose column
 * holds x (dayIndexAtX) plus how far into that column x is — half a column
 * into a Thursday is that Thursday + 0.5, at any zoom, mask or not. Without a
 * mask it is x / dayPx, unclamped (as xAtDay's unmasked branch). With one,
 * an x left of the chart is its first shown day, and an x at or past the
 * chart's end is the day after its last shown day. For every x on the chart,
 * Math.floor(dayAtX(x)) is dayIndexAtX(x).
 *
 * @param {number} x       px from the chart's left edge
 * @param {number} dayPx   a shown column's width
 * @param {Array<{ offsetPx: number, hidden: boolean }>|null} [mask] the weekend mask, day by day
 * @returns {number} a day position from the chart's first day
 */
export function dayAtX(x, dayPx, mask = null) {
  if (!mask || mask.length === 0) return x / dayPx
  const i = dayIndexAtX(x, dayPx, mask)
  return i + Math.min(1, Math.max(0, (x - mask[i].offsetPx) / dayPx))
}

/**
 * dayAtX's inverse: the x a day position sits at. Without a mask,
 * day × dayPx. With one, a shown day's column start plus the fraction into
 * it — and a HIDDEN day, which has no column, maps to the start of the next
 * shown day; a hidden day after the chart's last shown day (a chart that
 * ends on a weekend) maps to the chart's end. So dayAtX(xAtDay(d)) is d for a
 * shown day, the next shown day for a hidden one, and the day after the last
 * shown day for a trailing one; and xAtDay(dayAtX(x)) is x for every x on
 * the chart.
 *
 * With a mask the result is kept to the chart, [0, totalPx]. Without one it
 * is NOT clamped — day × dayPx, negative before the chart — as the unmasked
 * gantt always computed it, so the re-anchoring's `newScrollLeft >= 0` guard
 * still skips (as it always did) an anchor that a span move left before the
 * chart's first day; with weekends hidden that anchor scrolls to the start.
 *
 * @param {number} day     a day position from the chart's first day
 * @param {number} dayPx   a shown column's width
 * @param {Array<{ offsetPx: number, hidden: boolean }>|null} [mask] the weekend mask, day by day
 * @returns {number} px from the chart's left edge
 */
export function xAtDay(day, dayPx, mask = null) {
  if (!mask || mask.length === 0) return day * dayPx
  if (Number.isNaN(day)) return NaN
  if (day <= 0) return 0
  const i = Math.min(mask.length - 1, Math.floor(day))
  if (mask[i].hidden) return mask[i].offsetPx
  return mask[i].offsetPx + Math.min(1, day - i) * dayPx
}

/**
 * The days a gantt viewport `viewW` px wide shows, from the day at its left
 * edge: { start, end } as day positions — what places the minimap's window.
 * Without a mask it is viewW / dayPx days, at least one, in the arithmetic it
 * always had (so the window rounds exactly as before). With one, the end is
 * the day at the viewport's right edge through the pair: a weekend hidden
 * inside the view is inside the window too, which then spans the calendar the
 * gantt shows.
 *
 * @param {number} startDay the day position at the viewport's left edge
 * @param {number} viewW    the viewport's chart width in px
 * @param {number} dayPx    a shown column's width
 * @param {Array<{ offsetPx: number, hidden: boolean }>|null} [mask] the weekend mask, day by day
 * @returns {{ start: number, end: number }}
 */
export function visibleDayRange(startDay, viewW, dayPx, mask = null) {
  const start = Math.max(0, startDay)
  if (!mask || mask.length === 0) return { start, end: start + Math.max(1, viewW / dayPx) }
  return { start, end: Math.max(start + 1, dayAtX(xAtDay(start, dayPx, mask) + viewW, dayPx, mask)) }
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
