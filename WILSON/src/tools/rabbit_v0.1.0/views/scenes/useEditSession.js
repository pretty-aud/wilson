// ============================================================
// RABBIT — the edit on screen, for the Scenes tab
// (post-overhaul S3c, step 3 onward)
// ============================================================
//
// What ScenesView needs to know about an edit, in one place: whether one is
// on screen (a saved edit, or the provider's draft for the list on screen),
// its cut resolved against every row (editModel.cutRows), its scene bands
// following the cut, and its four tiles' totals (D20: items in order,
// repeats counted, missing shots excluded).
// ============================================================

import { useMemo } from 'react'
import { cutRows, cutBands, cutTotals } from './editModel'

/**
 * ctx     useRabbit()
 * viewed  useViewedShotList(): its `edit` ({ mode, row, draft }) and `list`
 * → { mode: 'none' | 'edit' | 'draft', list, row, draft, items, rows, bands, totals, snapshot, readOnly }
 *   readOnly  the cut cannot change here: the edit or its list is archived
 */
export function useEditSession({ ctx, viewed }) {
  const edit = viewed?.edit || { mode: 'none' }
  const list = viewed?.list || null
  const mode = edit.mode || 'none'
  const items = mode === 'draft' ? (edit.draft?.items || []) : mode === 'edit' ? (edit.row?.items || []) : null
  const snapshot = mode === 'edit' ? (edit.row?.snapshot || null) : null
  const shotById = ctx?.shotById
  const sceneById = ctx?.sceneById
  const rows = useMemo(
    () => (items ? cutRows({ items, shotById, sceneById, snapshot }) : null),
    [items, shotById, sceneById, snapshot],
  )
  const bands = useMemo(() => (rows ? cutBands(rows, { snapshot }) : null), [rows, snapshot])
  const totals = useMemo(() => (rows ? cutTotals(rows) : null), [rows])
  const readOnly = !!(list?.archived_at || (mode === 'edit' && edit.row?.archived_at))
  return {
    mode,
    onScreen: mode !== 'none',
    list,
    row: mode === 'edit' ? edit.row : null,
    draft: mode === 'draft' ? edit.draft : null,
    items,
    rows,
    bands,
    totals,
    snapshot,
    readOnly,
  }
}
