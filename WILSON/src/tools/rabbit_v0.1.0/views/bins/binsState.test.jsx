/** @vitest-environment jsdom */
// =============================================================================
// binsState.test.jsx — UI overhaul B6, 2026-09-23.
//
// The MEETING of the two sides of the extracted state (src/ui/dataState.test.jsx
// is the model, and C3b's trap 2 the reason): for each state, the real selector
// is read out of bins.css and the real rendered node is asked
// `Element.matches(thatSelector)`. A test that asserted `toHaveAttribute` would
// keep passing through a stylesheet that keyed on presence, or a component
// that emitted "false".
//
// And the grid's keyboard contract (review part 5, risk 2): BinsView reads the
// frame view's REAL column count from `[data-bin-grid]`'s computed tracks, so
// the attribute and the auto-fill template must survive every restyle.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import BinTree from './BinTree'
import BinFileTable from './BinFileTable'
import BinFileGrid from './BinFileGrid'

afterEach(cleanup)

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = read('./bins.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** The selector exactly as bins.css spells it; fails if the sheet no longer does. */
function sel(cls, attr) {
  const s = `.${cls}[data-${attr}="true"]`
  expect(css.includes(s), `bins.css has no rule for ${s}`).toBe(true)
  return s
}

const bins = [
  { id: 'b1', name: 'Footage', parent_bin_id: null, color: null, sort_order: 0 },
  { id: 'b2', name: 'Audio', parent_bin_id: null, color: 'green', sort_order: 1 },
]
const file = (id, extra = {}) => ({
  id, bin_id: 'b1', display_name: `Clip ${id}`, original_name: `${id}.mov`, media_type: 'video',
  online: true, review_flag: 'unflagged', circled: false, color: null, ...extra,
})
const rows = [file('f1'), file('f2'), file('f3', { online: false })]
const binsById = new Map(bins.map(b => [b.id, b]))

describe('the tree: active and drag-over', () => {
  it('the current bin matches the active rule; the others do not', () => {
    render(
      <BinTree bins={bins} counts={new Map()} offlineCounts={new Map()} currentBinId="b2"
        expanded={new Set()} allCount={3} allOffline={0} canWrite />,
    )
    const active = sel('bn-tree-row', 'active')
    const items = screen.getAllByRole('treeitem')
    const byText = (t) => items.find(el => el.textContent.includes(t))
    expect(byText('Audio').matches(active)).toBe(true)
    expect(byText('Footage').matches(active)).toBe(false)
    expect(byText('All files').matches(active)).toBe(false)
    expect(byText('Footage').matches(sel('bn-tree-row', 'drag-over'))).toBe(false)
  })
})

describe('the list view: selected, current, offline, sorted', () => {
  it('each row matches exactly its own states', () => {
    const { container } = render(
      <BinFileTable rows={rows} selection={new Set(['f1'])} currentId="f2" binsById={binsById} showBin={false}
        sort={{ field: 'display_name', dir: 'asc' }} scenesById={new Map()} canWrite />,
    )
    const [r1, r2, r3] = container.querySelectorAll('[role="row"]')
    const selected = sel('bn-trow', 'selected')
    const current = sel('bn-trow', 'current')
    const offline = sel('bn-trow', 'offline')
    expect([r1.matches(selected), r1.matches(current), r1.matches(offline)]).toEqual([true, false, false])
    expect([r2.matches(selected), r2.matches(current), r2.matches(offline)]).toEqual([false, true, false])
    expect([r3.matches(selected), r3.matches(current), r3.matches(offline)]).toEqual([false, false, true])
    const sorted = sel('bn-th', 'sorted')
    const heads = [...container.querySelectorAll('.bn-th')]
    expect(heads.filter(h => h.matches(sorted)).map(h => h.textContent.trim())).toEqual(['Name'])
  })
})

describe('the frame view: selected, current, offline — and the grid contract', () => {
  it('each tile matches exactly its own states', () => {
    const { container } = render(
      <BinFileGrid rows={rows} selection={new Set(['f1'])} currentId="f2" tileWidth={200} binsById={binsById} showBin={false} canWrite />,
    )
    const [t1, t2, t3] = container.querySelectorAll('[role="gridcell"]')
    const selected = sel('bn-tile', 'selected')
    const current = sel('bn-tile', 'current')
    const offline = sel('bn-tile', 'offline')
    expect([t1.matches(selected), t1.matches(current), t1.matches(offline)]).toEqual([true, false, false])
    expect([t2.matches(selected), t2.matches(current), t2.matches(offline)]).toEqual([false, true, false])
    expect([t3.matches(selected), t3.matches(current), t3.matches(offline)]).toEqual([false, false, true])
  })

  it('🚨 [data-bin-grid] is the tiles\' parent and keeps the auto-fill template at the tile width', () => {
    const { container } = render(
      <BinFileGrid rows={rows} selection={new Set()} currentId={null} tileWidth={240} binsById={binsById} showBin={false} canWrite />,
    )
    const grid = container.querySelector('[data-bin-grid]')
    expect(grid).toBeTruthy()
    expect(grid.style.gridTemplateColumns.replace(/\s+/g, '')).toBe('repeat(auto-fill,minmax(240px,1fr))')
    expect(grid.querySelectorAll(':scope > [role="gridcell"]').length).toBe(3)
  })

  it('🚨 BinsView still reads the real column count from that element', () => {
    const src = read('../BinsView.jsx')
    expect(src).toMatch(/querySelector\('\[data-bin-grid\]'\)/)
    expect(src).toMatch(/getComputedStyle\(gridEl\)\.gridTemplateColumns/)
  })
})
