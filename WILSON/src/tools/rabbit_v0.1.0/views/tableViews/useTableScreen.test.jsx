/** @vitest-environment jsdom */
// =============================================================================
// useTableScreen (post-overhaul F10, rabbit A3): the four table views' glue
// around useTableView, once. The views' own suites and the four table-view
// suites (entityViews, assetsViews, tasksViews, scenesViews: the real
// provider, saved views, teammates' saves, the bar) pin what each view does,
// unedited; this file pins (1) that the four no longer write the glue, and
// (2) that a change for now — a sort, a filter, the layout, a grouping — is
// kept across a reload of the rows and a new provider value.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildItemLookup } from '../../state/taskItemsModel'
import { entityDescription, assetsByEntity } from './entityTableView'

vi.mock('../../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => roster }))
const roster = vi.hoisted(() => ({ members: [{ id: 'u1', name: 'Mara' }], mode: 'supabase' }))

const { useTableTab, useTableScreen } = await import('./useTableScreen')

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const VIEWS = ['../EntityListView.jsx', '../ProjectAssetsView.jsx', '../ProjectTasksView.jsx', '../ScenesView.jsx']

describe('the four table views take their screen from the one hook', () => {
  it('none writes the glue again: no useTableView, no useAsk, no live region, no Group-menu focus of its own', () => {
    for (const file of VIEWS) {
      const src = read(file)
      expect(src, file).toMatch(/\buseTableTab\(\)/)
      expect(src, file).toMatch(/\buseTableScreen\(\{/)
      expect(src, file).not.toMatch(/\buseTableView\(/)
      expect(src, file).not.toMatch(/\buseAsk\(/)
      expect(src, file).not.toMatch(/role="status" aria-live="polite"/)
      expect(src, file).not.toMatch(/select\[aria-label="Group"\]/)
      expect(src, file).not.toMatch(/localStorage\.removeItem\(/)
    }
    // The roster for a view's name is the hook's; the Tasks table keeps its own
    // for its cells' names.
    for (const file of ['../EntityListView.jsx', '../ProjectAssetsView.jsx', '../ScenesView.jsx']) {
      expect(read(file), file).not.toMatch(/\buseRosterMembers\(/)
    }
  })
  it('the Scenes tab: one tab, two screens, each its own Views button', () => {
    const src = read('../ScenesView.jsx')
    expect(src.match(/\buseTableScreen\(\{/g)).toHaveLength(2)
    expect(src.match(/\buseTableTab\(\)/g)).toHaveLength(1)
    expect(src).toMatch(/notifyOn: contentMode === 'scenes'/)
    expect(src).toMatch(/notifyOn: contentMode === 'shots'/)
    expect(src).toMatch(/\.rb-tv-button\[data-table="\$\{SCENES_TABLE\}"\]/)
    expect(src).toMatch(/\.rb-tv-button\[data-table="\$\{SHOTS_TABLE\}"\]/)
  })
})

// ── The hook over a provider value with no views API (useTableView keeps the
// change for now itself): the Levels table's own description. ──
const lookup = buildItemLookup({ items: [], available: false, assets: [] })
const DESC = entityDescription({ tableKey: 'levels', assets: [], lookup, assetsOf: assetsByEntity([], 'level_ids'), taskCountOf: () => 0 })
const ROWS = () => [
  { id: 'l1', name: 'Harbour', status: 'in_progress', sort_order: 2 },
  { id: 'l2', name: 'Cliff', status: 'blocked', sort_order: 0 },
  { id: 'l3', name: 'Market', status: 'in_progress', sort_order: 1 },
]
const seen = { current: null }
function Probe({ ctx, rows, search = '' }) {
  const tab = useTableTab()
  seen.current = useTableScreen({ tab, ctx, tableKey: 'levels', description: DESC, rows, canWrite: true, toolbarSelector: '.x', search, baseOrder: 'sort_order' })
  return tab.liveRegion
}
const names = () => seen.current.processed.map((r) => r.name)

describe('useTableScreen: a change for now outlives a reload of the rows', () => {
  it('the rows in their own order; the search, a filter and a sort narrow and order them; a new rows array and a new provider value keep all of it', () => {
    const { rerender } = render(<Probe ctx={{ project: { id: 'p1' } }} rows={ROWS()} />)
    expect(names()).toEqual(['Cliff', 'Market', 'Harbour'])
    act(() => seen.current.setSortField('name'))
    expect(names()).toEqual(['Cliff', 'Harbour', 'Market'])
    act(() => seen.current.reverseSort())
    expect(seen.current.sortDir).toBe('desc')
    act(() => seen.current.addFilter())
    const row = seen.current.filters[0]
    act(() => seen.current.updateFilter(0, { ...row, field: 'status', op: row.op, values: ['in_progress'] }))
    act(() => seen.current.setGroupBy('status'))
    act(() => seen.current.setViewMode('gallery'))
    expect(names()).toEqual(['Market', 'Harbour'])
    expect(seen.current.activeFilters).toBe(1)
    // The reload: the provider hands new arrays and a new value (a refetch).
    rerender(<Probe ctx={{ project: { id: 'p1' } }} rows={[...ROWS(), { id: 'l4', name: 'Night', status: 'in_progress', sort_order: 3 }]} />)
    expect(names()).toEqual(['Night', 'Market', 'Harbour'])
    expect([seen.current.sortField, seen.current.sortDir, seen.current.activeFilters, seen.current.groupBy, seen.current.viewMode])
      .toEqual(['name', 'desc', 1, 'status', 'gallery'])
    // The search is the tab's: applied over the view's filters, as typed.
    rerender(<Probe ctx={{ project: { id: 'p1' } }} rows={ROWS()} search="  mark " />)
    expect(names()).toEqual(['Market'])
  })
  it('CONTROL: a screen made anew (what a reset on reload would be) loses the change, which the assertions above would catch', () => {
    const { rerender } = render(<Probe key="a" ctx={{}} rows={ROWS()} />)
    act(() => seen.current.setSortField('name'))
    expect(seen.current.sortField).toBe('name')
    rerender(<Probe key="b" ctx={{}} rows={ROWS()} />)
    expect(seen.current.sortField).toBe('')
  })
  it('the Remove grouping question names the table\'s rows; the old saved views go once', async () => {
    localStorage.setItem('old_levels_views', '[]')
    function Old() {
      const tab = useTableTab()
      seen.current = useTableScreen({ tab, ctx: {}, tableKey: 'levels', description: DESC, rows: [], canWrite: true, toolbarSelector: '.x', oldViewsKey: 'old_levels_views', groupingWords: { rows: 'levels', kept: 'assets' } })
      return tab.askDialog
    }
    const { getByRole } = render(<Old />)
    expect(localStorage.getItem('old_levels_views')).toBeNull()
    act(() => { seen.current.removeGrouping({ label: 'Lamp', groupingId: 'g1' }) })
    expect(getByRole('dialog', { name: 'Remove the grouping Lamp?' }).textContent).toMatch(/Its levels keep their assets\. The group stays while levels are in it\./)
  })
})
