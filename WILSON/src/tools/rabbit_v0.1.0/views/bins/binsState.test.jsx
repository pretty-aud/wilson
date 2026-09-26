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
import { MediaTag, ColorDot, ColorPicker, FlagMark } from './binUi'
import AddFilesDialog from './AddFilesDialog'
import DeleteBinDialog from './DeleteBinDialog'
import { ShotTakesDialog } from './ShotTakesPanel'
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
    // A real <tr> since B4c (the kit Table): its row role is the element's
    // own, so the body's rows are read by structure, not by an attribute.
    const [r1, r2, r3] = container.querySelectorAll('tbody tr')
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

describe('every other state, rendered (round 2: thirteen were never rendered)', () => {
  const one = (selector) => document.querySelector(selector)

  it('the poster of an offline file matches offline', () => {
    // The state paints the poster's ICON (a descendant rule), not the box.
    expect(paintsSelector(css, '.bn-poster[data-offline="true"] .bn-poster-icon')).toBe(true)
    const { container } = render(<BinPoster row={file('f9', { online: false })} />)
    expect(container.firstChild.matches('.bn-poster[data-offline="true"]')).toBe(true)
    expect(container.querySelector('.bn-poster-icon')).toBeTruthy()
  })

  it('the colour picker marks the chosen swatch; a dot with no colour is empty; a hollow dot is hollow', () => {
    render(<><ColorPicker value="red" onChange={() => {}} /><ColorDot color={null} /><ColorDot color="blue" hollow /></>)
    const chosen = [...document.querySelectorAll('.bn-swatch')].filter(el => el.matches(sel('bn-swatch', 'selected')))
    expect(chosen.map(el => el.getAttribute('title'))).toEqual(['red'])
    const dots = [...document.querySelectorAll('.bn-dot')]
    expect(dots.filter(d => d.matches(sel('bn-dot', 'empty'))).length).toBeGreaterThanOrEqual(2) // the picker's "No colour" + the bare one
    expect(dots.filter(d => d.matches(sel('bn-dot', 'hollow'))).length).toBe(1)
  })

  it('muted marks match muted', () => {
    render(<FlagMark flag="select" circled muted />)
    expect(one('.bn-flags').matches('.bn-flags[data-muted="true"]')).toBe(true)
    expect(paintsSelector(css, '.bn-flags[data-muted="true"] svg')).toBe(true)
  })

  it('a shot\'s primary take row matches primary', () => {
    const f = file('f1')
    render(<ShotTakesDialog shot={{ id: 'sh1', name: 'Shot 1', shot_number: 1 }} scene={null} onClose={() => {}} fps={24} canWrite
      entries={[{ take: { id: 't1', role: 'primary', shot_id: 'sh1', bin_file_id: 'f1' }, file: f }]} thumbUrlFor={() => null} binPathFor={() => ''} />)
    expect(one('.bn-take-row').matches(sel('bn-take-row', 'primary'))).toBe(true)
  })

  it('add files: a missing row is disabled, a ticked row included, a duplicate and an applied suggestion marked', () => {
    // The dialog unticks a duplicate by default ("ticked unless duplicate or
    // missing"), so the duplicate is its own row.
    const items = [
      { source_path: 'C:/a.mov', original_name: 'a.mov', display_name: 'a', media_type: 'video', status: 'ok', include: true, size_bytes: 1, kind: 'file',
        suggestions: { slate: '1A', confidence: 'high' } }, // a high-confidence suggestion starts applied
      { source_path: 'C:/b.mov', original_name: 'b.mov', display_name: 'b', media_type: 'video', status: 'missing', include: false, size_bytes: 1, kind: 'file' },
      { source_path: 'C:/c.mov', original_name: 'c.mov', display_name: 'c', media_type: 'video', status: 'ok', include: false, size_bytes: 1, kind: 'file',
        duplicate: { existing_bin_name: 'Footage' } },
    ]
    render(<AddFilesDialog bin={bins[0]} plan={{ items }} scenes={[]} onConfirm={() => {}} onCancel={() => {}} busy={false} progress={null} />)
    const [a, b, c] = document.querySelectorAll('.bn-add-row')
    // "included" is read through :not() — an unticked row's fields take the disabled ink.
    expect(paintsSelector(css, '.bn-add-row:not([data-included="true"]) .ui-input')).toBe(true)
    expect([a.matches('.bn-add-row[data-included="true"]'), a.matches(sel('bn-add-row', 'disabled'))]).toEqual([true, false])
    expect(b.matches('.bn-add-row:not([data-included="true"])')).toBe(true)
    expect(b.matches(sel('bn-add-row', 'disabled'))).toBe(true)
    expect(c.querySelector('.bn-add-meta').matches(sel('bn-add-meta', 'duplicate'))).toBe(true)
    expect(a.querySelector('.bn-add-meta').matches(sel('bn-add-meta', 'duplicate'))).toBe(false)
    expect(a.querySelector('.bn-add-sug').matches(sel('bn-add-sug', 'apply'))).toBe(true)
  })

  it('delete a bin with nowhere to move its files: the move option is disabled', () => {
    render(<DeleteBinDialog bin={bins[0]} bins={[bins[0]]} files={[file('f1')]} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    expect(one('.bn-del-move').matches(sel('bn-del-move', 'disabled'))).toBe(true)
  })

  it('assign to shot: the logged scene\'s group is preferred, and a shot already holding this take shows it assigned', () => {
    const f = file('f1', { scene_id: 'sc1' })
    render(<AssignToShotDialog files={[f]} binFiles={[f]} scenes={[{ id: 'sc1', name: 'Scene 1', scene_number: 1 }]}
      shots={[{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: 'sc1' }]}
      shotTakes={[{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary' }]} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />)
    expect([...document.querySelectorAll('.bn-group-head')].some(h => h.matches(sel('bn-group-head', 'preferred')))).toBe(true)
    expect(one('.bn-take-count').matches(sel('bn-take-count', 'assigned'))).toBe(true)
    expect(one('.bn-pick-row').matches(sel('bn-pick-row', 'locked'))).toBe(true)
  })

  it('a shot ticked and THEN filled by a refresh under the open dialog is painted locked, not picked (round 2)', () => {
    const f = file('f1', { scene_id: 'sc1' })
    const props = { files: [f], binFiles: [f], scenes: [{ id: 'sc1', name: 'Scene 1', scene_number: 1 }],
      shots: [{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: 'sc1' }], thumbUrlFor: () => null, onConfirm: () => {}, onCancel: () => {}, busy: false }
    const { rerender } = render(<AssignToShotDialog {...props} shotTakes={[]} />)
    fireEvent.click(one('.bn-pick-row input'))
    expect(one('.bn-pick-row').matches(sel('bn-pick-row', 'picked'))).toBe(true)
    rerender(<AssignToShotDialog {...props} shotTakes={[{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary' }]} />)
    const row = one('.bn-pick-row')
    expect(row.matches(sel('bn-pick-row', 'locked'))).toBe(true)
    expect(row.matches('.bn-pick-row[data-picked="true"]')).toBe(false)
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
