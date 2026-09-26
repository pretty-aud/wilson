/** @vitest-environment jsdom */
// =============================================================================
// binFileTableRender.test.jsx — B4c surface 8 (2026-09-25), mounted.
//
// The Bins list view on the kit Table, by what it DOES rather than how its
// source reads (binsCss.test.js holds the source, binsState.test.jsx the
// states' meeting with the sheet): a real kit <table>; the kit Th, with
// aria-sort on the sorted column and a click sorting by its field; a row's
// click, double-click and context menu; the drag data; rename's Enter,
// Escape and blur; the flag's cycle; the three row states on the <tr>; the
// current row scrolled into view; the two-line name cell; "Nothing matches"
// under a header that stays; and every ink met by the bins.css rule that
// reads the row's properties, so the lift and the dim still reach the cells.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import BinFileTable, { TABLE_COLUMNS } from './BinFileTable'
import { DND_FILES } from './BinTree'
import { rules, stripCss, liftRule } from './binsGuards'
import { specificity, gt } from '../../rabbitCssGuards.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const here = dirname(fileURLToPath(import.meta.url))
const css = stripCss(readFileSync(join(here, 'bins.css'), 'utf8'))
/** What bins.css declares for exactly this selector: the bodies of every rule
 *  that lists it (the lift, say, names a row state and sets only its inks). */
const ruleBody = (s) => rules(css).filter(r => r.selectors.includes(s)).map(r => r.body).join('\n')
const col = (id) => TABLE_COLUMNS.findIndex(c => c.id === id)

const file = (id, extra = {}) => ({
  id, bin_id: 'b1', display_name: `Clip ${id}`, original_name: `${id}.mov`, media_type: 'video',
  online: true, review_flag: 'unflagged', circled: false, color: null, ...extra,
})
const ROWS = [
  file('f1', { slate: '1A', take_number: 2, take_modifier: 'pu', camera: 'A', roll: 'A001', shoot_day: '2026-09-21', scene_id: 's1',
    duration_sec: 14, width: 3840, height: 2160, fps: 23.976, codec: 'prores', size_bytes: 1717986918, review_flag: 'select', circled: true, color: 'red' }),
  file('f2', { review_flag: 'reject', probe_status: 'unavailable' }),
  file('f3', { online: false }),
]
const BINS = new Map([['b1', { id: 'b1', name: 'Footage' }]])
const SCENES = new Map([['s1', { id: 's1', name: 'Lighthouse, dawn' }]])

function mount(overrides = {}) {
  const handlers = {
    onRowClick: vi.fn(), onRowDoubleClick: vi.fn(), onContextMenu: vi.fn(),
    onSort: vi.fn(), onInlinePatch: vi.fn(), onRenameEnd: vi.fn(),
  }
  const props = {
    rows: ROWS, selection: new Set(['f1']), currentId: 'f2', binsById: BINS, showBin: true,
    sort: { field: 'duration_sec', dir: 'desc' }, scenesById: SCENES, canWrite: true, renamingId: null,
    usageCount: new Map([['f1', 2]]), dragIdsFor: (id) => (id === 'f1' ? ['f1', 'f3'] : [id]), thumbUrlFor: () => null,
    ...handlers, ...overrides,
  }
  const utils = render(<BinFileTable {...props} />)
  const table = utils.container.querySelector('table')
  return {
    ...utils, ...handlers, table,
    heads: [...table.querySelectorAll('thead th')],
    th: (label) => [...table.querySelectorAll('thead th')].find(h => h.textContent === label),
    bodyRows: () => [...table.querySelectorAll('tbody tr')],
    again: (more) => utils.rerender(<BinFileTable {...props} {...more} />),
  }
}

describe('a real kit <table>', () => {
  it('the kit Table\'s scroller, table, header row and one body row per file, every column in order', () => {
    const { table, heads, bodyRows } = mount()
    expect(table.classList.contains('ui-table')).toBe(true)
    expect(table.classList.contains('bn-table')).toBe(true)
    expect(table.parentElement.classList.contains('ui-table-scroll')).toBe(true)
    expect(table.parentElement.parentElement.classList.contains('bn-list')).toBe(true)
    expect(heads.map(h => h.textContent)).toEqual(TABLE_COLUMNS.map(c => c.label))
    for (const h of heads) expect([h.tagName, h.classList.contains('ui-th'), h.classList.contains('bn-th'), h.getAttribute('scope')]).toEqual(['TH', true, true, 'col'])
    expect(bodyRows()).toHaveLength(3)
    for (const tr of bodyRows()) {
      expect([tr.classList.contains('ui-tr'), tr.classList.contains('bn-trow')]).toEqual([true, true])
      expect([...tr.children].map(td => td.tagName + (td.classList.contains('ui-td') ? '.ui-td' : ''))).toEqual(TABLE_COLUMNS.map(() => 'TD.ui-td'))
    }
  })

  it('every px width is its header\'s; Name, the minmax track, is the auto column that takes the rest', () => {
    const { heads } = mount()
    expect(heads.map(h => h.style.width)).toEqual(TABLE_COLUMNS.map(c => (c.id === 'display_name' ? '' : c.width)))
    expect(TABLE_COLUMNS[0].width).toBe('minmax(220px, 2fr)')
  })

  it('the table\'s min-width is the shown columns\' sum (the 220 floor + every px width), plus the gutter bins.css adds', () => {
    const { table } = mount()
    expect(table.style.getPropertyValue('--bn-list-cols')).toBe('1440px')
    cleanup()
    const noBin = mount({ showBin: false })
    expect(noBin.heads.map(h => h.textContent)).not.toContain('Bin')
    expect(noBin.bodyRows()[0].children).toHaveLength(TABLE_COLUMNS.length - 1)
    expect(noBin.table.style.getPropertyValue('--bn-list-cols')).toBe('1310px')
    expect(noBin.table.matches('.bn-list .ui-table.bn-table')).toBe(true)
    expect(ruleBody('.bn-list .ui-table.bn-table')).toMatch(/min-width:\s*calc\(var\(--bn-list-cols\) \+ 8px\)/)
    // The 8px is the grid's left gutter, drawn as the first cell's padding.
    expect(ruleBody('.bn-table .ui-td:first-child')).toMatch(/padding-left:\s*16px/)
    expect(ruleBody('.bn-table .ui-td')).toMatch(/padding:\s*4px 8px/)
    expect(ruleBody('.bn-table .ui-th')).toMatch(/padding:\s*0 8px/)
  })
})

describe('the header: the kit Th', () => {
  it('aria-sort and data-sorted on the sorted column only, in its direction', () => {
    const { table, th } = mount()
    expect([th('Duration').getAttribute('aria-sort'), th('Duration').getAttribute('data-sorted')]).toEqual(['descending', 'true'])
    expect([...table.querySelectorAll('thead th[aria-sort]')].map(h => h.textContent)).toEqual(['Duration'])
    expect([...table.querySelectorAll('thead th[data-sorted="true"]')].map(h => h.textContent)).toEqual(['Duration'])
    expect(th('Duration').querySelector('.ui-th-sort').getAttribute('data-dir')).toBe('desc')
    cleanup()
    const asc = mount({ sort: { field: 'display_name', dir: 'asc' } })
    expect(asc.th('Name').getAttribute('aria-sort')).toBe('ascending')
    cleanup()
    // The default order ("Added order") is no column: nothing is marked.
    const added = mount({ sort: { field: 'sort_order', dir: 'asc' } })
    expect(added.table.querySelectorAll('thead th[aria-sort], thead th[data-sorted]')).toHaveLength(0)
  })

  it('a click on a sortable header sorts by its field; a column that cannot sort is words, not a button', () => {
    const { heads, th, onSort } = mount()
    fireEvent.click(within(th('Slate')).getByRole('button'))
    expect(onSort).toHaveBeenLastCalledWith('slate')
    fireEvent.click(within(th('Duration')).getByRole('button'))
    expect(onSort).toHaveBeenLastCalledWith('duration_sec')
    fireEvent.click(within(th('Name')).getByRole('button'))
    expect(onSort).toHaveBeenLastCalledWith('display_name')
    expect(heads.filter(h => h.querySelector('button')).map(h => h.textContent))
      .toEqual(TABLE_COLUMNS.filter(c => c.sortable).map(c => c.label))
    fireEvent.click(th('Scene'))
    expect(onSort).toHaveBeenCalledTimes(3)
  })

  it('the four figures are the kit\'s numeric header, and the sheet\'s header rules meet the kit\'s own elements', () => {
    const { heads, th } = mount()
    expect(heads.filter(h => h.getAttribute('data-numeric') === 'true').map(h => h.textContent))
      .toEqual(TABLE_COLUMNS.filter(c => c.align === 'right').map(c => c.label))
    // Every sortable header's button is its whole cell, the first column's
    // with its 16px (B4c review round one; binsCss.test.js pins the geometry,
    // measured in the app): the rules meet the kit's own buttons.
    const sortable = heads.filter(h => h.querySelector('button'))
    expect(sortable).toHaveLength(TABLE_COLUMNS.filter(c => c.sortable).length)
    for (const h of sortable) expect(h.querySelector('button').matches('.bn-table .bn-th .ui-th-btn'), h.textContent).toBe(true)
    expect(heads.filter(h => h.querySelector('button')?.matches('.bn-table .bn-th:first-child .ui-th-btn')).map(h => h.textContent)).toEqual(['Name'])
    // The kit writes data-align; on a right-aligned sortable column bins.css
    // makes the sort slot the cell's right padding, after the label, so its
    // arrow stays in its own column (it was drawn in USED IN's, before the
    // label). binsCss.test.js reads the attribute's values from the kit.
    const slotRule = '.bn-table .bn-th[data-align="right"] .ui-th-btn > .ui-th-sort'
    expect(ruleBody(slotRule)).toMatch(/(?:^|;)\s*width:\s*8px/)
    expect(ruleBody('.bn-th[data-align="right"] .ui-th-sort')).toBe('')
    expect(['Duration', 'Bytes', 'Slate', 'fps'].map(l => th(l).querySelector('.ui-th-sort').matches(slotRule))).toEqual([true, true, false, false])
    // A label overruns its padding rather than being cut (C1 keeps the widths).
    expect(th('Cam').querySelector('.ui-th-label').matches('.bn-th .ui-th-label')).toBe(true)
    expect(ruleBody('.bn-th .ui-th-label')).toMatch(/overflow:\s*visible/)
    // The sorted column's ink, and the ring drawn inside the scroller.
    expect(th('Duration').matches('.bn-th[data-sorted="true"]')).toBe(true)
    expect(ruleBody('.bn-th[data-sorted="true"]')).toMatch(/color:\s*var\(--color-signal\)/)
    expect(rules(css).find(r => r.selectors.includes('.bn-th .ui-th-btn:focus-visible'))?.body).toMatch(/outline-offset:\s*-2px/)
  })
})

describe('the rows: what a click, a drag, a rename and the marks do', () => {
  it('a row\'s click (with its modifiers), double-click and context menu reach their handlers with its id', () => {
    const { bodyRows, onRowClick, onRowDoubleClick, onContextMenu } = mount()
    fireEvent.click(bodyRows()[1], { shiftKey: true })
    expect(onRowClick).toHaveBeenLastCalledWith('f2', expect.objectContaining({ shiftKey: true }))
    fireEvent.click(bodyRows()[2].children[col('slate')], { ctrlKey: true })
    expect(onRowClick).toHaveBeenLastCalledWith('f3', expect.objectContaining({ ctrlKey: true }))
    fireEvent.doubleClick(bodyRows()[0])
    expect(onRowDoubleClick).toHaveBeenCalledWith('f1')
    const notPrevented = fireEvent.contextMenu(bodyRows()[2])
    expect(notPrevented).toBe(false)
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), 'f3')
  })

  it('a drag carries DND_FILES with the ids dragIdsFor gives, copy or move; a read-only row and a row being renamed do not drag', () => {
    const { bodyRows } = mount()
    expect(bodyRows().map(tr => tr.getAttribute('draggable'))).toEqual(['true', 'true', 'true'])
    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: 'uninitialized' }
    fireEvent.dragStart(bodyRows()[0], { dataTransfer })
    expect(setData).toHaveBeenCalledWith(DND_FILES, JSON.stringify(['f1', 'f3']))
    expect(dataTransfer.effectAllowed).toBe('copyMove')
    fireEvent.dragStart(bodyRows()[1], { dataTransfer })
    expect(setData).toHaveBeenLastCalledWith(DND_FILES, JSON.stringify(['f2']))
    cleanup()
    expect(mount({ canWrite: false }).bodyRows().map(tr => tr.getAttribute('draggable'))).toEqual(['false', 'false', 'false'])
    cleanup()
    expect(mount({ renamingId: 'f2' }).bodyRows().map(tr => tr.getAttribute('draggable'))).toEqual(['true', 'false', 'true'])
  })

  it('rename: Enter commits the trimmed name and ends; a click in the field selects nothing', () => {
    const { onInlinePatch, onRenameEnd, onRowClick, onRowDoubleClick } = mount({ renamingId: 'f1' })
    const input = screen.getByLabelText('File name')
    expect([input.value, input.className, input.getAttribute('data-size')]).toEqual(['Clip f1', 'ui-input', 'sm'])
    fireEvent.click(input)
    fireEvent.doubleClick(input)
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onRowDoubleClick).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  Hero plate  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onInlinePatch).toHaveBeenCalledWith('f1', { display_name: 'Hero plate' })
    expect(onRenameEnd).toHaveBeenCalledTimes(1)
  })

  it('rename: Escape cancels (nothing written); blur commits; an unchanged or empty name writes nothing', () => {
    const esc = mount({ renamingId: 'f1' })
    const input = screen.getByLabelText('File name')
    fireEvent.change(input, { target: { value: 'Not this' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(esc.onRenameEnd).toHaveBeenCalledTimes(1)
    expect(esc.onInlinePatch).not.toHaveBeenCalled()
    cleanup()
    const blur = mount({ renamingId: 'f2' })
    const field = screen.getByLabelText('File name')
    fireEvent.change(field, { target: { value: 'Wide' } })
    fireEvent.blur(field)
    expect(blur.onInlinePatch).toHaveBeenCalledWith('f2', { display_name: 'Wide' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.blur(field)
    expect(blur.onInlinePatch).toHaveBeenCalledTimes(1)
    expect(blur.onRenameEnd).toHaveBeenCalledTimes(2)
  })

  it('the marks toggle cycles select → reject → unflagged → select, keeps its title, and does not select the row', () => {
    const { bodyRows, onInlinePatch, onRowClick } = mount()
    const marks = (tr) => within(tr).getByTitle('Click to cycle select → reject → unflagged')
    fireEvent.click(marks(bodyRows()[0]))
    expect(onInlinePatch).toHaveBeenLastCalledWith('f1', { review_flag: 'reject' })
    fireEvent.click(marks(bodyRows()[1]))
    expect(onInlinePatch).toHaveBeenLastCalledWith('f2', { review_flag: 'unflagged' })
    fireEvent.click(marks(bodyRows()[2]))
    expect(onInlinePatch).toHaveBeenLastCalledWith('f3', { review_flag: 'select' })
    expect(onRowClick).not.toHaveBeenCalled()
    expect(marks(bodyRows()[0]).matches('.bn-trow-marks')).toBe(true)
    expect(ruleBody('.bn-trow-marks')).toMatch(/min-height:\s*var\(--control-sm\)/)
    cleanup()
    const ro = mount({ canWrite: false })
    expect(within(ro.bodyRows()[0]).getByTitle('Click to cycle select → reject → unflagged').disabled).toBe(true)
  })
})

describe('the row states: on the <tr>, painted and lifted by bins.css', () => {
  it('data-selected, data-current and data-offline on the <tr>, "true" or absent; no aria-selected (the kit Row carries none)', () => {
    const { bodyRows } = mount()
    const states = (tr) => ['selected', 'current', 'offline'].map(s => tr.getAttribute(`data-${s}`))
    expect(bodyRows().map(states)).toEqual([['true', null, null], [null, 'true', null], [null, null, 'true']])
    for (const tr of bodyRows()) expect(tr.hasAttribute('aria-selected')).toBe(false)
    expect(bodyRows()[0].matches('.bn-trow[data-selected="true"]')).toBe(true)
    expect(bodyRows()[1].matches('.bn-trow[data-current="true"]')).toBe(true)
    expect(bodyRows()[2].matches('.bn-trow[data-offline="true"]')).toBe(true)
  })

  it('the lift and the dim key on the <tr>, and every cell\'s ink reads the property they set', () => {
    const { bodyRows } = mount()
    expect(liftRule(css).selectors).toEqual(expect.arrayContaining(['.bn-trow:hover', '.bn-trow[data-selected="true"]']))
    expect(bodyRows()[0].matches(liftRule(css).selectors.join(', '))).toBe(true)
    const dim = rules(css).find(r => r.selectors.includes('.bn-trow[data-offline="true"]') && /--bn-ink:/.test(r.body))
    expect(dim.body).toMatch(/--bn-ink-2:\s*var\(--color-ink-3\)/)
    // The cells: values ink-2, the name the ink, quiet words ink-3, accents the signal — each through its property.
    const cell = bodyRows()[0].children[col('slate')]
    expect(cell.matches('.bn-trow > .ui-td')).toBe(true)
    expect(ruleBody('.bn-trow > .ui-td')).toMatch(/color:\s*var\(--bn-ink-2, var\(--color-ink-2\)\)/)
    expect(ruleBody('.bn-trow-name')).toMatch(/color:\s*var\(--bn-ink, var\(--color-ink\)\)/)
    for (const s of ['.bn-trow-sub', '.bn-trow-none']) expect(ruleBody(s)).toMatch(/color:\s*var\(--bn-ink-3, var\(--color-ink-3\)\)/)
    expect(ruleBody('.bn-trow-accent')).toMatch(/color:\s*var\(--bn-signal-ink, var\(--color-signal\)\)/)
  })

  it('no cell, span or line in the body carries an inline style but the posters\' and data components\' own', () => {
    const { container } = mount()
    for (const el of container.querySelectorAll('tbody tr, tbody td, tbody td span, tbody td div')) {
      if (el.closest('.bn-poster, .bn-tag, .bn-dot, .bn-flags')) continue
      expect(el.getAttribute('style'), el.outerHTML.slice(0, 90)).toBeNull()
    }
  })

  it('the kit Row\'s selected look (a fill and an edge on EVERY selected row) is turned off: the tint is the row\'s, the edge the current row\'s', () => {
    const { bodyRows } = mount({ selection: new Set(['f1', 'f2']), currentId: 'f2' })
    const cancel = '.bn-list .bn-table .bn-trow[data-selected="true"] > .ui-td'
    const kitFill = '.ui-tr[data-selected="true"][data-selected="true"] > .ui-td'
    const kitEdge = '.ui-tr[data-selected="true"] > .ui-td:first-child'
    // The kit's rules would reach these cells (the premise)…
    expect(bodyRows()[0].children[0].matches(kitFill)).toBe(true)
    expect(bodyRows()[0].children[0].matches(kitEdge)).toBe(true)
    // …and the cancel reaches them too, and outranks both.
    expect(bodyRows()[0].children[0].matches(cancel)).toBe(true)
    expect(ruleBody(cancel)).toMatch(/background-color:\s*transparent/)
    expect(ruleBody(cancel)).toMatch(/box-shadow:\s*none/)
    expect(gt(specificity(cancel), specificity(kitFill))).toBeGreaterThan(0)
    expect(gt(specificity(cancel), specificity(kitEdge))).toBeGreaterThan(0)
    // The tint and the edge stay the row's own.
    expect(ruleBody('.bn-trow[data-selected="true"]')).toMatch(/background-color:\s*var\(--color-signal-tint\)/)
    expect(ruleBody('.bn-trow[data-current="true"]')).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--color-signal\)/)
    expect(bodyRows().map(tr => tr.matches('.bn-trow[data-current="true"]'))).toEqual([false, true, false])
  })

  it('the current row is scrolled into view, nearest, and again whenever it changes', () => {
    const calls = []
    const saved = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (opts) { calls.push([this, opts]) }
    try {
      const m = mount()
      expect(calls.map(([el, o]) => [el.tagName, el.getAttribute('data-current'), o])).toEqual([['TR', 'true', { block: 'nearest' }]])
      m.again({ currentId: 'f3' })
      expect(calls).toHaveLength(2)
      expect(calls[1][0]).toBe(m.bodyRows()[2])
    } finally {
      Element.prototype.scrollIntoView = saved
    }
  })
})

describe('the cells', () => {
  it('the two-line name cell: the 36x22 poster, the name, then the original name and a sequence\'s frames', () => {
    const { bodyRows } = mount({
      rows: [file('s1', { display_name: 'Plate', original_name: 'plate.%04d.exr', is_sequence: true, frame_count: 240, source_path: 'D:/x/plate' })],
      selection: new Set(), currentId: null,
    })
    const cell = bodyRows()[0].children[col('display_name')]
    const poster = cell.querySelector('.bn-poster')
    expect([poster.style.width, poster.style.height]).toEqual(['36px', '22px'])
    expect(cell.querySelector('.bn-trow-name').textContent).toBe('Plate')
    expect(cell.querySelector('.bn-trow-name').getAttribute('title')).toBe('Plate')
    expect(cell.querySelector('.bn-trow-sub').textContent).toBe('plate.%04d.exr · 240 frames')
    expect(cell.querySelector('.bn-trow-sub').getAttribute('title')).toBe('D:/x/plate')
  })

  it('every value, as the grid showed it', () => {
    const { bodyRows } = mount()
    const text = (r, id) => bodyRows()[r].children[col(id)].textContent
    expect(TABLE_COLUMNS.map(c => text(0, c.id))).toEqual([
      'Clip f1f1.mov', 'VID', '', '1A', 'T2 pu', 'A', 'A001', '2026-09-21', 'Lighthouse, dawn', '2 shots',
      '00:14', '3840×2160', '23.98', 'PRORES', '1.6 GB', 'Footage',
    ])
    // The accents and the quiet words sit in the spans the sheet colours.
    expect(bodyRows()[0].children[col('take_number')].querySelector('.bn-trow-accent').textContent).toBe(' pu')
    expect(bodyRows()[0].children[col('used')].querySelector('.bn-trow-accent').getAttribute('title')).toBe('Used in 2 shots')
    expect(bodyRows()[1].children[col('used')].querySelector('.bn-trow-none').textContent).toBe('—')
    expect(bodyRows()[1].children[col('codec')].querySelector('.bn-trow-none').getAttribute('title')).toBe('No decoder on this machine')
    expect(bodyRows()[2].children[col('review_flag')].querySelector('.bn-trow-none').textContent).toBe('—')
    expect(bodyRows()[0].children[col('scene')].querySelector('span').getAttribute('title')).toBe('Lighthouse, dawn')
  })

  it('the mono on data, the sans on names and words (data-sans), the four figures the kit\'s numeric cells', () => {
    const { bodyRows } = mount()
    const tds = [...bodyRows()[0].children]
    expect(tds.map(td => td.getAttribute('data-sans'))).toEqual(TABLE_COLUMNS.map(c => (c.mono === false ? 'true' : null)))
    expect(tds.map(td => td.getAttribute('data-numeric'))).toEqual(TABLE_COLUMNS.map(c => (c.align === 'right' ? 'true' : null)))
    expect(ruleBody('.bn-trow > .ui-td')).toMatch(/font-family:\s*var\(--font-mono\)/)
    expect(ruleBody('.bn-trow > .ui-td[data-sans="true"]')).toMatch(/font-family:\s*var\(--font-sans\)/)
    expect(tds[col('scene')].matches('.bn-trow > .ui-td[data-sans="true"]')).toBe(true)
  })
})

describe('"Nothing matches"', () => {
  it('the kit EmptyState, compact, under a header that stays; the sheet lays it over the empty body', () => {
    const { table, heads } = mount({ rows: [], selection: new Set(), currentId: null })
    expect(heads).toHaveLength(TABLE_COLUMNS.length)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(0)
    const empty = screen.getByRole('status')
    expect(empty.querySelector('.ui-empty-title').textContent).toBe('Nothing matches')
    expect(empty.querySelector('.ui-empty-body').textContent).toBe('Clear a filter or the search to see more.')
    expect([empty.classList.contains('ui-empty'), empty.getAttribute('data-compact')]).toEqual([true, 'true'])
    expect(empty.matches('.bn-list .ui-empty.bn-list-empty')).toBe(true)
    expect(ruleBody('.bn-list .ui-empty.bn-list-empty')).toMatch(/position:\s*absolute/)
    expect(ruleBody('.bn-list .ui-empty.bn-list-empty')).toMatch(/pointer-events:\s*none/)
    cleanup()
    expect(mount().container.querySelector('.ui-empty')).toBeNull()
  })
})
