// ============================================================
// RABBIT — the Tasks table's columns, and the widths they ask for
// (post-overhaul VW1b, 2026-10-17)
// ============================================================
//
// Audrey's Q11 (docs/design/CUSTOM_VIEWS_QUESTIONS.md, batch 3): "Yes, a
// column for each" — Scene, Shot, Level and Experience join the Tasks table,
// each working like the Asset column; Q-G2 (batch 9): "yes" — after
// Priority, 150px each; Q6a (batch 7): "Every column, name in view" — the
// whole table, scrolling sideways with the title kept in place.
//
// The design's §4.10 (Tasks half, step 0 review finding 6): the five item
// columns, Phase and Assignee GROW (each from its minimum; the item columns
// hold lists of names, which is why the Asset column grew); the checkbox,
// Status, Priority, the two dates and Bid are FIXED. The sheet
// (rabbitTasks.css) divides what the title leaves past its 360px between the
// growable columns on screen; this file says, from the columns on screen,
// how much is fixed and how many grow. Pure: the view sets the answer as two
// inline custom properties on `.rb-task-table-wrap` (the lane guard's one
// allowed style for it, its two properties written out).

import { KIND_LABEL } from '../state/taskItemsModel'

/**
 * The table's columns in order: the title, Status, Priority, an item column
 * for each kind in `kinds` (ITEM_KINDS order, as given), Phase, Assignee,
 * Start, End, Bid. `width` is the column's CSS width; `min` what it takes at
 * the least (the fixed sum); `grow` whether it shares the spare.
 */
export function tasksTableColumns(kinds = ['asset']) {
  return [
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status', width: 'var(--rb-task-col-status)', min: 'var(--rb-task-col-status)' },
    { key: 'priority', label: 'Priority', width: 'var(--rb-task-col-priority)', min: 'var(--rb-task-col-priority)' },
    ...kinds.map(kind => ({
      key: kind, kind, label: KIND_LABEL[kind],
      width: 'var(--rb-task-col-item)', min: 'var(--rb-task-item-min)', grow: true,
    })),
    { key: 'phase_id', label: 'Phase', width: 'var(--rb-task-col-phase)', min: 'var(--rb-task-phase-min)', grow: true },
    { key: 'assignee_id', label: 'Assignee', width: 'var(--rb-task-col-assignee)', min: 'var(--rb-task-assignee-min)', grow: true },
    { key: 'start_date', label: 'Start', width: 'var(--rb-task-col-date)', min: 'var(--rb-task-col-date)' },
    { key: 'end_date', label: 'End', width: 'var(--rb-task-col-date)', min: 'var(--rb-task-col-date)' },
    { key: 'bid_days', label: 'Bid', width: 'var(--rb-task-col-bid)', min: 'var(--rb-task-col-bid)', numeric: true, col: 'bid' },
  ]
}

/**
 * What the columns on screen ask of the sheet, the two custom properties the
 * view sets on `.rb-task-table-wrap`: `fixed` (`--rb-task-fixed`), the
 * checkbox and every column's minimum summed (the title's own minimum and
 * maximum are the sheet's), and `growN` (`--rb-task-grow-n`), how many
 * columns share the spare, at least 1 so the sheet never divides by 0; and
 * `grow`, the true count: 0 means no column grows, and the view says so with
 * `data-grow="none"` (the table is then never wider than the fixed columns
 * and a 360px title).
 */
export function tasksTableWidths(columns) {
  const list = Array.isArray(columns) ? columns : []
  const mins = ['var(--rb-task-col-check)', ...list.filter(c => c && c.min).map(c => c.min)]
  const grow = list.filter(c => c && c.grow).length
  return {
    fixed: `calc(${mins.join(' + ')})`,
    growN: String(Math.max(1, grow)),
    grow,
  }
}
