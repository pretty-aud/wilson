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

const ALIGNS = ['left', 'center', 'right']

export function Table({
  head,
  foot,
  children,
  dense = false,
  surface = 'dark',
  className = '',
  scrollClassName = '',
  ...rest
}) {
  return (
    <div
      className={`ui-table-scroll ${surface === 'light' ? 'wilson-light-scroll' : 'wilson-dark-scroll'} ${scrollClassName}`.trim()}
      data-surface={surface}
    >
      <table
        className={`ui-table ${className}`.trim()}
        data-dense={dense || undefined}
        data-surface={surface}
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
        {foot && <tfoot>{foot}</tfoot>}
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
      data-selected={selected || undefined}
      data-highlighted={highlighted || undefined}
      data-interactive={interactive || undefined}
      data-inactive={inactive || undefined}
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
      data-numeric={numeric || undefined}
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
      data-numeric={numeric || undefined}
      {...rest}
    >
      {children}
    </td>
  )
}

export default Table
