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
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import BinTree from './BinTree'
import BinFileTable from './BinFileTable'
import BinFileGrid from './BinFileGrid'
import BinPoster from './BinPoster'
import TakePickerDialog from './TakePickerDialog'
import AssignToShotDialog from './AssignToShotDialog'
import { MediaTag } from './binUi'
import { INK_2, INK_3 } from '../../../../ui/tokens'
import { MEDIA_TYPE_META } from '../../bins/binMedia'
import { paintsSelector } from './binsGuards'

afterEach(cleanup)

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = read('./bins.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** The selector exactly as bins.css spells it — and a rule that PAINTS it, not
 *  one that merely names it (round 1: the lift lists every painted state and
 *  sets only two properties, so a deleted selection colour still "existed"). */
function sel(cls, attr) {
  const s = `.${cls}[data-${attr}="true"]`
  expect(paintsSelector(css, s), `no rule in bins.css paints ${s}`).toBe(true)
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

describe('the states round one found never rendered (S1, S4–S7)', () => {
  it('a bin under a drag matches drag-over', () => {
    render(<BinTree bins={[bins[0]]} counts={new Map()} offlineCounts={new Map()} currentBinId={null} expanded={new Set()} allCount={0} allOffline={0} canWrite />)
    const node = screen.getAllByRole('treeitem').find(el => el.textContent.includes('Footage'))
    fireEvent.dragOver(node, { dataTransfer: { types: ['Files'], dropEffect: '' } })
    expect(node.matches(sel('bn-tree-row', 'drag-over'))).toBe(true)
  })

  it('the poster of a primary take matches primary; an ordinary one does not', () => {
    const { container, rerender } = render(<BinPoster row={file('f1')} primary />)
    expect(container.firstChild.matches(sel('bn-poster', 'primary'))).toBe(true)
    rerender(<BinPoster row={file('f1')} />)
    expect(container.firstChild.matches(sel('bn-poster', 'primary'))).toBe(false)
  })

  it('the take picker: picked, locked (already assigned) and offline rows', () => {
    const files = [file('f1'), file('f2'), file('f3', { online: false })]
    render(<TakePickerDialog shot={{ id: 'sh1', name: 'Shot 1', scene_id: null }} scene={null} files={files} bins={[bins[0]]}
      assignedFileIds={['f2']} hasPrimary={false} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    const rowOf = (id) => screen.getByText(`Clip ${id}`).closest('label')
    fireEvent.click(rowOf('f1').querySelector('input'))
    expect(rowOf('f1').matches(sel('bn-pick-row', 'picked'))).toBe(true)
    expect(rowOf('f2').matches(sel('bn-pick-row', 'locked'))).toBe(true)
    expect(rowOf('f2').matches(sel('bn-pick-row', 'picked'))).toBe(false)
    expect(rowOf('f3').matches(sel('bn-pick-row', 'offline'))).toBe(true)
  })

  it('assign to shot: a ticked shot row matches picked, its neighbour does not', () => {
    render(<AssignToShotDialog files={[file('f1')]} binFiles={[file('f1')]} scenes={[{ id: 'sc1', name: 'Scene 1', scene_number: 1 }]}
      shots={[{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: 'sc1' }, { id: 'sh2', name: 'Shot 2', shot_number: 2, scene_id: 'sc1' }]}
      shotTakes={[]} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    const rows = [...document.querySelectorAll('label')].filter(l => l.querySelector('input[type=checkbox]'))
    fireEvent.click(rows[0].querySelector('input'))
    expect(rows[0].matches(sel('bn-pick-row', 'picked'))).toBe(true)
    expect(rows[1].matches(sel('bn-pick-row', 'picked'))).toBe(false)
  })

  it('the media-type tag carries its hue as data, and the two retired greys take the ladder', () => {
    const hue = (type) => { cleanup(); render(<MediaTag type={type} small />); return document.querySelector('.bn-tag').style.getPropertyValue('--tag-hue') }
    expect(hue('video')).toBe(MEDIA_TYPE_META.video.color)
    expect(hue('document')).toBe(INK_2)
    expect(hue('other')).toBe(INK_3)
    expect(hue('no-such-type')).toBe(INK_3)
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
