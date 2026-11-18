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
    // The search is the tab's: applied over the view's filters, trimmed (the
    // default; the Scenes tab's as typed is below).
    rerender(<Probe ctx={{ project: { id: 'p1' } }} rows={ROWS()} search="  mark " />)
    expect(names()).toEqual(['Market'])
  })
  it('CONTROL: a screen that starts over when its rows change — a reset on reload — fails what the case above checks after its reload', () => {
    // The same provider value and the same reload as above; the screen is
    // made anew by its rows. (Review round 1, 1C-03: the first control
    // remounted by hand on another ctx. The redcheck log also runs the case
    // above against a useTableView that drops its change on a new provider
    // value: red.)
    function Resetting({ ctx, rows }) { return <Probe key={rows.length} ctx={ctx} rows={rows} /> }
    const { rerender } = render(<Resetting ctx={{ project: { id: 'p1' } }} rows={ROWS()} />)
    act(() => seen.current.setSortField('name'))
    act(() => seen.current.reverseSort())
    rerender(<Resetting ctx={{ project: { id: 'p1' } }} rows={[...ROWS(), { id: 'l4', name: 'Night', status: 'in_progress', sort_order: 3 }]} />)
    expect([seen.current.sortField, seen.current.sortDir]).not.toEqual(['name', 'desc'])
    expect(names()).not.toEqual(['Night', 'Market', 'Harbour'])
  })
  // Review round 1 (1C-01, 1C-02): what each caller hands the hook, honoured.
  it('the search as typed where the table asks (`searchTrim: false`, the Scenes tab), trimmed by default; with no base order the rows as they come', () => {
    function SearchProbe({ search = '', searchTrim, baseOrder = null }) {
      const tab = useTableTab()
      seen.current = useTableScreen({ tab, ctx: { project: { id: 'p1' } }, tableKey: 'levels', description: DESC, rows: ROWS(), canWrite: true, toolbarSelector: '.x', search, searchTrim, baseOrder })
      return null
    }
    const { rerender } = render(<SearchProbe search="Harbour " />)
    expect(names()).toEqual(['Harbour'])
    rerender(<SearchProbe search="Harbour " searchTrim={false} />)
    expect(names()).toEqual([])
    rerender(<SearchProbe />)
    expect(names()).toEqual(['Harbour', 'Cliff', 'Market'])
    rerender(<SearchProbe baseOrder="sort_order" />)
    expect(names()).toEqual(['Cliff', 'Market', 'Harbour'])
  })
  it('a teammate\'s delete of the view on screen is said only where `notifyOn` (the Scenes tab: only its table on screen says it)', () => {
    const viewsCtx = (views) => {
      const drafts = new Map([['levels', { viewId: 'v1', baseRevision: 1, baseConfig: null, config: null, name: 'Shoot week' }]])
      return {
        project: { id: 'p1' }, tableViewsAvailable: true, tableViewLast: { status: 'ready' },
        viewsOf: () => views, viewDraftOf: (k) => drafts.get(k) || null, setViewDraft: (k, d) => { drafts.set(k, d) }, lastViewOf: () => null,
      }
    }
    for (const notifyOn of [true, false]) {
      const said = vi.fn()
      function NotifyProbe({ ctx }) {
        const tab = useTableTab()
        useTableScreen({ tab: { ...tab, notify: said }, ctx, tableKey: 'levels', description: DESC, rows: ROWS(), canWrite: true, toolbarSelector: '.x', notifyOn })
        return null
      }
      const { rerender } = render(<NotifyProbe ctx={viewsCtx([{ id: 'v1', table_key: 'levels', name: 'Shoot week', config: {}, revision: 1, position: 0 }])} />)
      rerender(<NotifyProbe ctx={viewsCtx([])} />)
      expect(said.mock.calls, `notifyOn ${notifyOn}`).toEqual(notifyOn ? [['Shoot week was deleted. Showing All.']] : [])
      cleanup()
    }
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
