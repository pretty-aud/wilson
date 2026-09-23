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

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const makeCtx = (n) => ({
  supportsBins: true, activeProjectId: 'p1', project: { fps: 24 },
  bins: [{ id: 'b1', name: 'Footage', parent_bin_id: null, color: null, sort_order: 0 }],
  binFiles: Array.from({ length: n }, (_, i) => ({
    id: 'f' + i, bin_id: 'b1', display_name: 'Clip ' + String(i).padStart(2, '0'), original_name: 'c' + i + '.mov',
    media_type: 'video', online: true, review_flag: 'unflagged', circled: false, color: null, sort_order: i,
  })),
  binRoots: [], scenes: [], shots: [], shotTakes: [], binsInfo: { ffmpeg: false },
  refreshBins: vi.fn(async () => null), undo: vi.fn(), redo: vi.fn(),
  bulkUpdateBinFiles: vi.fn(async () => {}), updateBinFile: vi.fn(async () => {}), removeBinFiles: vi.fn(async () => {}),
})
const mount = async (n) => { state.ctx = makeCtx(n); render(<BinsView />); await act(async () => {}) }
const selectedCount = () => document.querySelectorAll('[aria-selected="true"][role="gridcell"], [aria-selected="true"][role="row"]').length

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
