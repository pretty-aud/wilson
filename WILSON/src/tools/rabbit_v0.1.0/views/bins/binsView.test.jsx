/** @vitest-environment jsdom */
// =============================================================================
// binsView.test.jsx — UI overhaul B6, review round 1 (2026-09-23).
//
// BinsView itself, rendered, with the provider and the access hook mocked, so
// the claims round one found pinned only by source regexes are pinned by what
// the view DOES:
//   · the "remove more than five?" question (W9): the Bins keys stand down
//     behind it, Escape closes only it, its Remove button removes;
//   · every key Help documents (Q10) does something in the handler — it calls
//     preventDefault — and Undo / Redo reach the provider the right way round;
//   · ArrowDown in the frame view moves by the grid's REAL column count, read
//     from [data-bin-grid]'s computed tracks (review part 5, risk 2), not a
//     width formula.
// The three were written by the round-one test reviewer as probes, verified
// green here and red against the mutations they target (a dropped dependency,
// a Remove button that re-asks, Home / End / F2 / 1–8 unbound, redo calling
// undo, the width formula restored).
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'

const state = vi.hoisted(() => ({ ctx: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
vi.mock('../../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
const { default: BinsView } = await import('../BinsView')
const { BINS_SHORTCUTS } = await import('../../rabbitHelpContent')
const { COLORS } = await import('../../bins/binMedia')
const { Dialog } = await import('../../../../ui')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const makeCtx = (n) => ({
  supportsBins: true, activeProjectId: 'p1', project: { fps: 24 },
  bins: [{ id: 'b1', name: 'Footage', parent_bin_id: null, color: null, sort_order: 0 }],
  binFiles: Array.from({ length: n }, (_, i) => ({
    id: 'f' + i, bin_id: 'b1', display_name: 'Clip ' + String(i).padStart(2, '0'), original_name: 'c' + i + '.mov',
    media_type: 'video', online: true, review_flag: 'unflagged', circled: false, color: null, sort_order: i,
  })),
  binRoots: [], scenes: [], shots: [{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: null }], shotTakes: [], binsInfo: { ffmpeg: false },
  refreshBins: vi.fn(async () => null), undo: vi.fn(), redo: vi.fn(),
  bulkUpdateBinFiles: vi.fn(async () => {}), updateBinFile: vi.fn(async () => {}), removeBinFiles: vi.fn(async () => {}),
})
const mount = async (n) => { state.ctx = makeCtx(n); render(<BinsView />); await act(async () => {}) }
// The frame view's tiles carry aria-selected (a grid); the list view's rows
// are the kit Table's <tr>, whose selection is `data-selected` — the kit Row
// carries no aria-selected (B4c surface 8), so the old `[role="row"]` branch
// could no longer match and a list-view count read 0. Both views count.
const selectedCount = () => document.querySelectorAll('[aria-selected="true"][role="gridcell"], tbody tr[data-selected="true"]').length

describe('W9 — "remove more than five?": the Bins keys stand down behind it', () => {
  it('S does nothing, and Escape closes only the question and keeps the selection', async () => {
    await mount(7)
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    expect(selectedCount()).toBe(7)
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(screen.getByRole('dialog', { name: /Remove 7 files/ })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 's' })
    expect(state.ctx.bulkUpdateBinFiles).not.toHaveBeenCalled()
    expect(state.ctx.updateBinFile).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(selectedCount()).toBe(7)
    expect(state.ctx.removeBinFiles).not.toHaveBeenCalled()
  })

  it('its first focus is Cancel (Enter backs out), and its Remove button removes rather than re-asking', async () => {
    await mount(7)
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(document.activeElement.textContent).toBe('Cancel')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove 7 files/ })) })
    expect(state.ctx.removeBinFiles).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('five or fewer are removed without asking', async () => {
    await mount(5)
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Delete' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(state.ctx.removeBinFiles).toHaveBeenCalledTimes(1)
  })

  it('in the list view too: the count reads the <tr> rows, and Escape behind the question keeps them selected', async () => {
    await mount(7)
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    // The list is on screen and the frames are not: the count is the rows'.
    expect(document.querySelectorAll('tbody tr.bn-trow')).toHaveLength(7)
    expect(document.querySelectorAll('[role="gridcell"]')).toHaveLength(0)
    expect(selectedCount()).toBe(0)
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    expect(selectedCount()).toBe(7)
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(screen.getByRole('dialog', { name: /Remove 7 files/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(selectedCount()).toBe(7)
  })
})

describe('Q10 — every key Help documents does WHAT Help says (round 2)', () => {
  // Round two: "preventDefault was called" let S and R swapped, Esc bound to a
  // no-op and the colours shifted by one all pass. Each combo now has its
  // effect, and a Help combo with no row here fails — so a new Help row needs
  // one. The grid is one column wide here, so ↑ / ↓ move by one file.
  const names = () => [...document.querySelectorAll('[role="gridcell"]')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => /Clip [0-9][0-9]/.exec(t.textContent)?.[0])
  const patched = () => state.ctx.updateBinFile.mock.calls.map(c => c[1]).concat(state.ctx.bulkUpdateBinFiles.mock.calls.map(c => c[1]))
  const EFFECT = {
    '↓': { check: () => expect(names()).toEqual(['Clip 01']) },
    '↑': { before: ['ArrowDown'], check: () => expect(names()).toEqual(['Clip 00']) },
    'Home': { before: ['End'], check: () => expect(names()).toEqual(['Clip 00']) },
    'End': { check: () => expect(names()).toEqual(['Clip 02']) },
    'Shift+↓': { check: () => expect(names()).toEqual(['Clip 00', 'Clip 01']) },
    'Shift+↑': { before: ['ArrowDown'], check: () => expect(names()).toEqual(['Clip 00', 'Clip 01']) },
    'Ctrl+A': { check: () => expect(names()).toEqual(['Clip 00', 'Clip 01', 'Clip 02']) },
    'Esc': { check: () => expect(names()).toEqual([]) },
    'S': { check: () => expect(patched()).toEqual([{ review_flag: 'select' }]) },
    'R': { check: () => expect(patched()).toEqual([{ review_flag: 'reject' }]) },
    'U': { check: () => expect(patched()).toEqual([{ review_flag: 'unflagged' }]) },
    'C': { check: () => expect(patched()).toEqual([{ circled: true }]) },
    '1': { check: () => expect(patched()).toEqual([{ color: COLORS[0] }]) },
    '8': { check: () => expect(patched()).toEqual([{ color: COLORS[7] }]) },
    'A': { check: () => expect(screen.getByRole('dialog', { name: /Assign/ })).toBeTruthy() },
    'F2': { check: () => expect(screen.getByLabelText('New name')).toBeTruthy() },
    'Enter': { check: () => expect(screen.getByLabelText('New name')).toBeTruthy() },
    'Del': { check: () => expect(state.ctx.removeBinFiles).toHaveBeenCalledWith(['f0']) },
    'Backspace': { check: () => expect(state.ctx.removeBinFiles).toHaveBeenCalledWith(['f0']) },
    'Ctrl+Z': { check: () => { expect(state.ctx.undo).toHaveBeenCalledTimes(1); expect(state.ctx.redo).not.toHaveBeenCalled() } },
    'Ctrl+Shift+Z': { check: () => { expect(state.ctx.redo).toHaveBeenCalledTimes(1); expect(state.ctx.undo).not.toHaveBeenCalled() } },
    'Ctrl+Y': { check: () => { expect(state.ctx.redo).toHaveBeenCalledTimes(1); expect(state.ctx.undo).not.toHaveBeenCalled() } },
  }
  const KEYNAME = { '↑': 'ArrowUp', '↓': 'ArrowDown', Esc: 'Escape', Del: 'Delete' }
  const init = (combo) => {
    const o = { key: '' }
    for (const k of combo) {
      if (k === 'Ctrl') o.ctrlKey = true
      else if (k === 'Shift') o.shiftKey = true
      else o.key = KEYNAME[k] || (k.length === 1 ? k.toLowerCase() : k)
    }
    return o
  }
  // Space is the preview's (BinInspector; binsDialogs.test.jsx pins it). Only a
  // combo that IS plain Space is exempt — any other in a Space row must be here.
  const combos = BINS_SHORTCUTS.flatMap(s => s.keys).filter(c => !(c.length === 1 && c[0] === 'Space'))

  it('every Help combo has an effect here (a new Help row needs one)', () => {
    expect(combos.map(c => c.join('+')).filter(k => !(k in EFFECT))).toEqual([])
    expect(combos.length).toBeGreaterThan(15)
  })

  for (const combo of combos) {
    const k = combo.join('+')
    it(k, async () => {
      const real = window.getComputedStyle
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...rest) =>
        (el?.hasAttribute?.('data-bin-grid') ? { gridTemplateColumns: '10px' } : real(el, ...rest)))
      await mount(3)
      fireEvent.keyDown(document.body, { key: 'ArrowDown' }) // Clip 00 current and selected
      for (const b of EFFECT[k]?.before || []) fireEvent.keyDown(document.body, { key: b })
      state.ctx.updateBinFile.mockClear(); state.ctx.bulkUpdateBinFiles.mockClear()
      await act(async () => { fireEvent.keyDown(document.body, init(combo)) })
      EFFECT[k].check()
    })
  }
})

describe('the keys stand down for a kit dialog that is ON SCREEN, not one hidden on another page (round 2)', () => {
  function Wrap({ foreign, hidden = false }) {
    const d = foreign ? <Dialog title="Foreign" onClose={() => {}}><p>elsewhere</p></Dialog> : null
    return <><BinsView />{hidden ? <div hidden>{d}</div> : d}</>
  }
  const saved = Element.prototype.checkVisibility
  afterEach(() => { Element.prototype.checkVisibility = saved })

  it('a visible foreign dialog: S and Delete do nothing', async () => {
    state.ctx = makeCtx(3)
    const { rerender } = render(<Wrap foreign={false} />)
    await act(async () => {})
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    rerender(<Wrap foreign />)
    fireEvent.keyDown(document.body, { key: 's' })
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Delete' }) })
    expect(state.ctx.updateBinFile).not.toHaveBeenCalled()
    expect(state.ctx.removeBinFiles).not.toHaveBeenCalled()
  })

  it('a foreign dialog left open on a HIDDEN page: the Bins keys still work', async () => {
    Element.prototype.checkVisibility = function () { return !this.closest('[hidden]') }
    state.ctx = makeCtx(3)
    render(<Wrap foreign hidden />)
    await act(async () => {})
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(selectedCount()).toBe(1)
  })
})

describe('Q10 — every combo Help documents does something in BinsView', () => {
  const KEY = { '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', Esc: 'Escape', Del: 'Delete' }
  const toInit = (combo) => {
    const init = { key: '' }
    for (const k of combo) {
      if (k === 'Ctrl') init.ctrlKey = true
      else if (k === 'Shift') init.shiftKey = true
      else init.key = KEY[k] || (k.length === 1 ? k.toLowerCase() : k)
    }
    return init
  }
  // Space is the preview's (BinInspector), not this handler's; binsDialogs.test.jsx pins it.
  const combos = BINS_SHORTCUTS.filter(s => !s.keys.flat().includes('Space')).flatMap(s => s.keys.map(c => [s.does, c]))
  it('the list is not empty (a control on the loop below)', () => { expect(combos.length).toBeGreaterThan(15) })
  for (const [does, combo] of combos) {
    it(`${combo.join('+')} — ${does}`, async () => {
      await mount(3)
      fireEvent.keyDown(document.body, { key: 'ArrowDown' }) // a current file, selected
      let notPrevented
      await act(async () => { notPrevented = fireEvent.keyDown(document.body, toInit(combo)) })
      expect(notPrevented, `BinsView ignored ${combo.join('+')}`).toBe(false)
      if (does === 'Undo') { expect(state.ctx.undo).toHaveBeenCalled(); expect(state.ctx.redo).not.toHaveBeenCalled() }
      if (does === 'Redo') { expect(state.ctx.redo).toHaveBeenCalled(); expect(state.ctx.undo).not.toHaveBeenCalled() }
    })
  }
})

describe('the frame view moves by the grid\'s REAL column count (review part 5, risk 2)', () => {
  it('reads [data-bin-grid]\'s computed tracks — five here — not a width formula', async () => {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...rest) =>
      (el?.hasAttribute?.('data-bin-grid') ? { gridTemplateColumns: '10px 10px 10px 10px 10px' } : real(el, ...rest)))
    await mount(12)
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    const at = [...document.querySelectorAll('[role="gridcell"]')].findIndex(t => t.getAttribute('aria-selected') === 'true')
    expect(at).toBe(5)
  })
})
