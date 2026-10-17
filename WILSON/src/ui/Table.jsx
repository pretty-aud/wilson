// =============================================================================
// Table (+ Th, Td, Row) — the one table (plan §4; review F06 / R13 / R4-01 /
// F-R07, and the critic's "Table DOM strategy" resolution).
//
// ── THE DOM DECISION, recorded here as the critic asked ──────────────────────
//
// A REAL <table> with `table-layout: fixed`. The 19-to-22 hand-built tables in
// the app are split between real tables with a sticky thead (Team Members,
// Files, Logs, Users, Dashboard, Rate Card, ClientView) and flex/grid fakes
// (Tasks, Timeline, ProjectFilesTable, BinFileTable, Assets), and nobody had
// named which one the shared component would be. It is not a cosmetic choice:
//
//   · A real table gives header/cell alignment FOR FREE. F-R09, R05, AT-18 and
//     R4-42 are four separate findings that are all the same bug — a flex
//     header row whose widths drift from the flex body rows beneath it.
//   · `position: sticky` on <th> fixes R06's sticky-header bug in one place.
//   · `table-layout: fixed` makes the FIRST row's widths the column widths, so
//     one long cell can never re-flow the whole grid mid-scroll, and column
//     widths become a declaration instead of an emergent property.
//
// THE ONE DOCUMENTED EXCEPTION is R.A.B.B.I.T.'s Timeline: its rows span a
// label column and a virtualised chart half, which a table cannot express. It
// keeps its flex geometry and consumes only this component's TOKENS — 36px
// row, 32px head, 8px/12px cells, one hairline. Nothing else may opt out.
//
// ── The contract ────────────────────────────────────────────────────────────
//
//   <Table
//     head={<Row><Th>…</Th></Row>}
//     foot={<Row><Td colSpan={3}>Total</Td><Td numeric>…</Td></Row>}
//     dense surface="light"
//   >
//     <Row selected>…<Td numeric>…</Td></Row>
//   </Table>
//
// 36px row (`dense` 32 — set by the VIEW for the media tables, never by a user
// toggle, which would be a new control under C1), 32px sticky head, 8px 12px
// cells, hairline dividers, NO zebra, one hover fill, one selected fill plus a
// 2px signal left edge. `numeric` right-aligns and turns on tabular figures
// and the mono, which is what makes a money column line up at all (R3-02: zero
// tabular-nums in four money tables).
//
// The sort slot is ALWAYS rendered, at a fixed width, whether or not the
// column is sorted — otherwise the header label shifts sideways the moment you
// sort by it, which is the one moment you are looking straight at it.
// =============================================================================

import { useLayoutEffect, useRef } from 'react'

const ALIGNS = ['left', 'center', 'right']

// ── Sticky columns (post-overhaul VW1b, the kit request VW1-KR-2) ───────────
//
//   <Table stickyColumns={2} …>   the first two columns stay in place while
//                                 the table scrolls sideways (1 to 3).
//
// The insets are MEASURED, never declared twice: the sticky head cells'
// widths (a ResizeObserver) become `--ui-sticky-<k>` on the table, the left
// inset of column k. A sticky cell holds at the scroller's PADDING edge
// (measured in Chromium 152, VW1b step 0: `left: 0` in a scroller padded 12px
// holds 12px in), so column 0's inset is 0 and the padding — the scroller's
// gutter, `--ui-sticky-gutter` — is covered by the first column's cells (the
// sheet), or the cells scrolling past would show through it. The scroller's
// `scroll-padding-left` is set to where the sticky columns end, so Tab and
// `focus()` never park a control under them. `--ui-sticky-room` is the
// scroller's content width: a spanning cell (`colSpan`, a group's band) is
// not sticky, its FIRST CHILD is, at most that wide (the sheet), so a band's
// words stay in view. Where nothing is measured (no layout, as under the test
// runner) every inset is 0 and the room unset. The paint (z-order, the
// grounds, the row tints as images) is the sheet's (src/index.css).
function useStickyColumns(n, tableRef, scrollRef) {
  useLayoutEffect(() => {
    const table = tableRef.current
    const scroller = scrollRef.current
    if (!n || !table) return undefined
    const measure = () => {
      const cells = table.tHead?.rows?.[0]?.cells
      const css = scroller ? getComputedStyle(scroller) : null
      const pad = css ? (parseFloat(css.paddingLeft) || 0) : 0
      const padRight = css ? (parseFloat(css.paddingRight) || 0) : 0
      let left = 0
      for (let k = 0; k < n; k++) {
        table.style.setProperty(`--ui-sticky-${k}`, `${left}px`)
        left += cells?.[k] ? cells[k].getBoundingClientRect().width : 0
      }
      table.style.setProperty('--ui-sticky-gutter', `${pad}px`)
      if (scroller) {
        const room = scroller.clientWidth - pad - padRight
        if (room > 0) table.style.setProperty('--ui-sticky-room', `${room}px`)
        scroller.style.scrollPaddingLeft = `${pad + left}px`
      }
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    const cells = table.tHead?.rows?.[0]?.cells
    for (let k = 0; k < n; k++) if (cells?.[k]) ro.observe(cells[k])
    if (scroller) ro.observe(scroller)
    return () => ro.disconnect()
  }, [n, tableRef, scrollRef])
}

export function Table({
  head,
  foot,
  children,
  dense = false,
  surface = 'dark',
  className = '',
  scrollClassName = '',
  stickyColumns = 0,
  ...rest
}) {
  const tableRef = useRef(null)
  const scrollRef = useRef(null)
  const sticky = Math.max(0, Math.min(3, Math.floor(Number(stickyColumns) || 0)))
  useStickyColumns(sticky, tableRef, scrollRef)
  return (
    <div
      ref={scrollRef}
      className={`ui-table-scroll ${surface === 'light' ? 'wilson-light-scroll' : 'wilson-dark-scroll'} ${scrollClassName}`.trim()}
      data-surface={surface}
    >
      <table
        ref={tableRef}
        className={`ui-table ${className}`.trim()}
        data-dense={dense ? 'true' : undefined}
        data-surface={surface}
        data-sticky={sticky ? 'true' : undefined}
        data-sticky-columns={sticky ? String(sticky) : undefined}
        {...rest}
      >
        {head && <thead>{head}</thead>}
        <tbody>{children}</tbody>
        {/* `foot` mirrors `head`: the same <Row>/<Td> children, in a real
            <tfoot>. A totals row is not the last item in the list — it is a
            summary OF the list — and only this element says so. It also
            sticks to the bottom of the scroller, so the figure stays on
            screen while the rows move under it (C1 kit request 3, where the
            rate card's per-currency averages were the last rows of the
            <tbody> for want of this slot). */}
        {/* An EMPTY array is truthy, and the rate card passes `summary.map(…)`
            — which is `[]` the moment nothing on the card has a rate. An
            empty <tfoot> is a row group a screen reader announces with
            nothing in it. */}
        {(Array.isArray(foot) ? foot.length > 0 : Boolean(foot)) && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}

/**
 * A row.
 *
 *   selected     the ONE selected treatment: a fill plus a 2px signal left
 *                edge. A real selection the user made.
 *   highlighted  a row carrying a standing role (a producer, a director) —
 *                a quiet wash and no edge. Deliberately NOT `selected`: a row
 *                that looks selected and is not is worse than no marking.
 *   interactive  the whole row is clickable, so the hover fill and the
 *                pointer appear only where a click does something.
 *   inactive     deactivated: the third ink, never an opacity (plan §3.1).
 *
 * 🚨 No `aria-selected`. It is not supported on `row` inside `role="table"`
 * (only grid and treegrid), and this renders a plain <table>. Announcing a
 * selection the table cannot own is worse than announcing none.
 */
export function Row({
  children,
  selected = false,
  highlighted = false,
  interactive = false,
  inactive = false,
  className = '',
  ...rest
}) {
  return (
    <tr
      className={`ui-tr ${className}`.trim()}
      data-selected={selected ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      data-interactive={interactive ? 'true' : undefined}
      data-inactive={inactive ? 'true' : undefined}
      {...rest}
    >
      {children}
    </tr>
  )
}

/**
 * A header cell. `sort` is 'asc' | 'desc' | null; pass `onSort` to make it a
 * button. `width` is a CSS width — with `table-layout: fixed` the header row
 * declares the grid.
 */
export function Th({
  children,
  align = 'left',
  numeric = false,
  width,
  sort = null,
  onSort,
  className = '',
  style,
  ...rest
}) {
  const a = numeric ? 'right' : align
  if (import.meta.env?.DEV && !ALIGNS.includes(a)) console.error(`Th: unknown align "${a}"`)
  const label = (
    <>
      <span className="ui-th-label">{children}</span>
      {/* Always present, always the same width: a sort arrow that appears on
          click would shove the label sideways under the pointer. */}
      <span className="ui-th-sort" aria-hidden="true" data-dir={sort || undefined} />
    </>
  )
  return (
    <th
      scope="col"
      className={`ui-th ${className}`.trim()}
      data-align={a}
      data-numeric={numeric ? 'true' : undefined}
      aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}
      style={width ? { width, ...style } : style}
      {...rest}
    >
      {onSort ? (
        <button type="button" className="ui-th-btn" onClick={onSort}>{label}</button>
      ) : label}
    </th>
  )
}

/** A body cell. `numeric` right-aligns it with tabular figures in the mono. */
export function Td({
  children,
  align = 'left',
  numeric = false,
  className = '',
  ...rest
}) {
  const a = numeric ? 'right' : align
  if (import.meta.env?.DEV && !ALIGNS.includes(a)) console.error(`Td: unknown align "${a}"`)
  return (
    <td
      className={`ui-td ${className}`.trim()}
      data-align={a}
      data-numeric={numeric ? 'true' : undefined}
      {...rest}
    >
      {children}
    </td>
  )
}

export default Table
