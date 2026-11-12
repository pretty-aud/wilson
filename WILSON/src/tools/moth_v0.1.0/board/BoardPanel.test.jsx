// @vitest-environment jsdom
// BoardPanel.test.jsx — MO4: the board panel, mounted. The three sizes; the button and Escape straight back to the
// map; the Escape stack (the topmost picker, editor or drag first); pull-away on the framed size only; the corners
// resize. The canvas, the store, the live channels and the turns are stand-ins (their own tests are theirs), so this
// is the panel alone; the canvas is still reached through React.lazy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ stores: [], turns: [], lives: [], joins: [], canvas: [], makeStore: null, join: null }))
vi.mock('./BoardCanvas.jsx', async () => {
  const { createElement } = await import('react')
  return { default: (props) => { h.canvas.push(props); return createElement('div', { 'data-test-canvas': '' }, 'the canvas') } }
})
vi.mock('./boardStore.js', () => ({ createBoardStore: (opts) => h.makeStore(opts) }))
vi.mock('./boardLive.js', () => ({ joinBoard: (opts) => h.join(opts) }))
vi.mock('./stickyTurn.js', () => ({
  createStickyTurns: (opts) => {
    const t = { opts, refresh: vi.fn(async () => {}), dispose: vi.fn(), glow: () => new Map() }
    h.turns.push(t)
    return t
  },
}))

import { BoardPanel, BACK_WORDS, GONE_WORDS, LIVE_FAILED_WORDS, LIVE_DOWN_WORDS } from './BoardPanel.jsx'
import { defaultFrame, FALLBACK_BOUNDS, PULL_CLOSE_PX, MIN_FRAME, TRASH_WORDS } from './boardPanelState.js'

function fakeStore({ fail = null, board = { id: 'b1', title: 'Plans', can_write: true } } = {}) {
  const subs = new Set()
  const s = {
    board,
    load: vi.fn(async () => { if (fail) throw fail }),
    getBoard: () => s.board,
    getElements: () => new Map(),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
    emit: (m) => { for (const f of subs) f(m) },
    flush: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
  return s
}
function fakeLive() {
  return { leave: vi.fn(), sendPointer() {}, sendDrag() {}, cursors: () => new Map(), people: () => [], subscribe: () => () => {}, stats: () => ({ sent: 0, received: 0 }) }
}

// A live session whose listeners a test can speak to (the panel listens for the link, its people strip for who is here).
function liveThatTells(extra = {}) {
  const subs = new Set()
  h.join = async (opts) => {
    h.joins.push(opts)
    const l = { ...fakeLive(), ...extra, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) } }
    h.lives.push(l)
    return l
  }
  return { tell: (evt) => { for (const fn of [...subs]) fn(evt) }, heard: () => subs.size }
}

const BOARD = { id: 'b1', folder_id: 'f1', project_id: 'p1', title: 'Plans' }
const ME = { id: 'u1', label: 'Mara Okonkwo' }
const adapter = { name: 'fake' }
const F = defaultFrame(FALLBACK_BOUNDS)

beforeEach(() => {
  h.stores.length = 0
  h.turns.length = 0
  h.lives.length = 0
  h.joins.length = 0
  h.canvas.length = 0
  h.makeStore = (opts) => { const s = fakeStore(); s.opts = opts; h.stores.push(s); return s }
  h.join = async (opts) => { h.joins.push(opts); const l = fakeLive(); h.lives.push(l); return l }
})
afterEach(() => { cleanup() })

const open = async (props = {}) => {
  const onClose = vi.fn()
  const onSize = vi.fn()
  const view = render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={onClose} onSize={onSize} reducedMotion {...props} />)
  await screen.findByText('the canvas')
  await waitFor(() => expect(h.lives.length).toBe(1))
  return { onClose, onSize, view, panel: () => document.querySelector('[data-moth-board]'), layer: () => document.querySelector('[data-moth-board-layer]') }
}
const lastCanvas = () => h.canvas[h.canvas.length - 1]
const escape = (target = window) => fireEvent.keyDown(target, { key: 'Escape' })
const down = (el, x, y, extra = {}) => fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...extra })
const move = (x, y) => fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 })
const up = (x, y) => fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 })

describe('opening', () => {
  it('makes the store, the turns and the live channels, and hands them to the lazy canvas', async () => {
    await open()
    expect(h.stores).toHaveLength(1)
    expect(h.stores[0].opts).toEqual({ adapter, boardId: 'b1' })
    expect(h.stores[0].load).toHaveBeenCalledTimes(1)
    expect(h.turns[0].opts).toMatchObject({ adapter, boardId: 'b1' })
    expect(typeof h.turns[0].opts.sessionId).toBe('string')
    expect(h.turns[0].refresh).toHaveBeenCalled()
    expect(h.joins[0]).toMatchObject({ adapter, boardId: 'b1', me: ME, store: h.stores[0], turns: h.turns[0] })
    await waitFor(() => expect(lastCanvas().live).toBe(h.lives[0]))
    const p = lastCanvas()
    expect(p.store).toBe(h.stores[0])
    expect(p.turns).toBe(h.turns[0])
    expect(p.adapter).toBe(adapter)
    expect(p.canWrite).toBe(true)
    expect(p.inputMode).toBe('mouse')
    expect(typeof p.escape.push).toBe('function')
    expect(screen.getByRole('region', { name: 'Board: Plans' })).toBeTruthy()
  })
  it('a board that may only be looked at: the canvas is told, and says so itself', async () => {
    h.makeStore = (opts) => { const s = fakeStore({ board: { id: 'b1', title: 'Plans', can_write: false } }); s.opts = opts; h.stores.push(s); return s }
    await open()
    expect(lastCanvas().canWrite).toBe(false)
  })
  it('🚨 a board that cannot be opened says so in words, and Try again reads it again', async () => {
    let fail = { code: '42501', message: 'board not found' }
    h.makeStore = (opts) => { const s = fakeStore({ fail }); s.opts = opts; h.stores.push(s); return s }
    const onClose = vi.fn()
    render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={onClose} />)
    expect(await screen.findByText(/This board is not there any more, or you may not open it\./)).toBeTruthy()
    expect(screen.queryByText('the canvas')).toBeNull()
    expect(h.joins).toHaveLength(0)
    fail = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('the canvas')).toBeTruthy()
    expect(h.stores).toHaveLength(2)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('live channels that cannot be joined still draw the board, and say so', async () => {
    h.join = async () => { throw new Error('no socket') }
    render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={() => {}} />)
    expect(await screen.findByText('the canvas')).toBeTruthy()
    expect(await screen.findByText(LIVE_FAILED_WORDS)).toBeTruthy()
    const live = lastCanvas().live
    expect(typeof live.sendPointer).toBe('function')
    expect(live.cursors().size).toBe(0)
  })
  it('who else is on the board is shown by name beside their colour; nobody else, nothing', async () => {
    let here = []
    const { tell, heard } = liveThatTells({ people: () => here })
    render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={() => {}} />)
    expect(await screen.findByText('the canvas')).toBeTruthy()
    await waitFor(() => expect(heard()).toBe(2))
    expect(document.querySelector('[data-moth-board-people]')).toBeNull()
    here = [{ id: 'u2', label: 'Theo Lindqvist', colour: '#2f9e44' }, { id: 'u3', label: 'Someone', colour: '#1c7ed6' }]
    act(() => { tell({ type: 'people' }) })
    const list = screen.getByRole('list', { name: 'Also on this board' })
    expect(list.textContent).toBe('Theo LindqvistSomeone')
    expect(list.querySelector('.moth-board-person-dot').style.backgroundColor).toBe('rgb(47, 158, 68)')
    // More than four: the rest are counted, and named on the count.
    here = ['Ada', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'].map((n, i) => ({ id: `p${i}`, label: n, colour: '#1c7ed6' }))
    act(() => { tell({ type: 'people' }) })
    expect(screen.getByRole('list', { name: 'Also on this board' }).textContent).toBe('AdaBenCyDee+2')
    expect(screen.getByText('+2').getAttribute('title')).toBe('Eli, Fay')
    here = []
    act(() => { tell({ type: 'people' }) })
    expect(document.querySelector('[data-moth-board-people]')).toBeNull()
  })
  it('a name that arrives after the board was joined is handed to the live session, and the board stays open', async () => {
    const setLabel = vi.fn()
    const { heard } = liveThatTells({ setLabel })
    const onClose = vi.fn()
    const view = render(<BoardPanel board={BOARD} adapter={adapter} me={{ id: 'u1', label: 'Someone' }} onClose={onClose} />)
    expect(await screen.findByText('the canvas')).toBeTruthy()
    await waitFor(() => expect(heard()).toBe(2))
    expect(setLabel).toHaveBeenLastCalledWith('Someone')
    view.rerender(<BoardPanel board={BOARD} adapter={adapter} me={{ id: 'u1', label: 'Mara Okonkwo' }} onClose={onClose} />)
    await waitFor(() => expect(setLabel).toHaveBeenLastCalledWith('Mara Okonkwo'))
    expect(h.stores).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('the others\' channel dropped: said once it has lasted a moment, unsaid when it is back, a blink says nothing', async () => {
    const { tell, heard } = liveThatTells()
    render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={() => {}} />)
    expect(await screen.findByText('the canvas')).toBeTruthy()
    await waitFor(() => expect(heard()).toBe(2))
    vi.useFakeTimers()
    try {
      // A blink (the channels renamed and joined again) says nothing.
      act(() => { tell({ type: 'link', up: false }) })
      act(() => { vi.advanceTimersByTime(1000) })
      act(() => { tell({ type: 'link', up: true }) })
      act(() => { vi.advanceTimersByTime(10000) })
      expect(screen.queryByText(LIVE_DOWN_WORDS)).toBeNull()
      // Down for a while: said. Back: unsaid.
      act(() => { tell({ type: 'link', up: false }) })
      act(() => { vi.advanceTimersByTime(4000) })
      expect(screen.getByText(LIVE_DOWN_WORDS)).toBeTruthy()
      act(() => { tell({ type: 'link', up: true }) })
      expect(screen.queryByText(LIVE_DOWN_WORDS)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
  it('🚨 access gone closes the board with words', async () => {
    const { onClose } = await open()
    act(() => h.joins[0].onClosed('You may not see this board now.'))
    expect(onClose).toHaveBeenCalledWith({ how: 'gone', words: 'You may not see this board now.' })
    act(() => h.joins[0].onClosed(''))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('access gone with no words of its own still says why', async () => {
    const { onClose } = await open()
    act(() => h.joins[0].onClosed())
    expect(onClose).toHaveBeenCalledWith({ how: 'gone', words: GONE_WORDS })
  })
  it('a board renamed or no longer writable is followed; the store\'s notices are the canvas\'s to say', async () => {
    await open()
    act(() => h.stores[0].emit({ type: 'notice', words: 'Someone changed that since: it was left as it is.' }))
    expect(screen.queryByText('Someone changed that since: it was left as it is.')).toBeNull()
    act(() => { h.stores[0].board = { id: 'b1', title: 'Plans, second pass', can_write: false }; h.stores[0].emit({ type: 'change', ids: [] }) })
    expect(await screen.findByRole('region', { name: 'Board: Plans, second pass' })).toBeTruthy()
    await waitFor(() => expect(lastCanvas().canWrite).toBe(false))
  })
  it('🚨 closing lets everything go, saving what is waiting first', async () => {
    const { view } = await open()
    view.unmount()
    expect(h.lives[0].leave).toHaveBeenCalledTimes(1)
    expect(h.turns[0].dispose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
    expect(h.stores[0].flush).toHaveBeenCalledTimes(1)
    expect(h.stores[0].flush.mock.invocationCallOrder[0]).toBeLessThan(h.stores[0].dispose.mock.invocationCallOrder[0])
  })
  it('closed before the channels answer, it leaves them the moment they do', async () => {
    let answer = null
    h.join = (opts) => { h.joins.push(opts); return new Promise((r) => { answer = r }) }
    const view = render(<BoardPanel board={BOARD} adapter={adapter} me={ME} onClose={() => {}} />)
    await waitFor(() => expect(h.joins).toHaveLength(1))
    view.unmount()
    const l = fakeLive()
    await act(async () => { answer(l) })
    expect(l.leave).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 the three sizes', () => {
  it('opens in a frame over the map, and each size is a button', async () => {
    const { panel, layer, onSize } = await open()
    expect(panel().dataset.size).toBe('framed')
    expect(layer().dataset.size).toBe('framed')
    expect(document.querySelector('[data-moth-board-scrim]')).toBeTruthy()
    expect(panel().style.width).toBe(`${F.w}px`)
    expect(onSize).toHaveBeenLastCalledWith('framed')
    expect(screen.getByRole('button', { name: 'Show in a frame' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Fill the view' }))
    expect(panel().dataset.size).toBe('filled')
    expect(layer().dataset.size).toBe('filled')
    expect(panel().style.width).toBe('')
    expect(document.querySelector('[data-moth-board-scrim]')).toBeNull()
    expect(onSize).toHaveBeenLastCalledWith('filled')
    expect(screen.getByRole('button', { name: 'Fill the view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show in a frame' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Maximise' }))
    expect(panel().dataset.size).toBe('maximised')
    expect(onSize).toHaveBeenLastCalledWith('maximised')

    fireEvent.click(screen.getByRole('button', { name: 'Show in a frame' }))
    expect(panel().dataset.size).toBe('framed')
    // The canvas is the same one throughout: a size is no new board.
    expect(h.stores).toHaveLength(1)
  })
  it('opens at the size it is asked for', async () => {
    const { panel } = await open({ initialSize: 'maximised' })
    expect(panel().dataset.size).toBe('maximised')
  })
})

describe('🚨 straight back to the map', () => {
  it('the button', async () => {
    const { onClose } = await open()
    fireEvent.click(screen.getByRole('button', { name: BACK_WORDS }))
    expect(onClose).toHaveBeenCalledWith({ how: 'button' })
  })
  it('Escape, at any size', async () => {
    for (const size of ['framed', 'filled', 'maximised']) {
      const { onClose, view } = await open({ initialSize: size })
      escape()
      expect(onClose).toHaveBeenCalledWith({ how: 'escape' })
      view.unmount()
      h.lives.length = 0
    }
  })
  it('Escape answered by a layer above (a kit menu or dialog marks it) is not the board\'s', async () => {
    const { onClose } = await open()
    const mark = (e) => e.preventDefault()
    document.addEventListener('keydown', mark, { once: true })
    escape(document.body)
    expect(onClose).not.toHaveBeenCalled()
    escape(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('a dialog outside the board takes Escape first', async () => {
    const { onClose } = await open()
    const dialog = document.createElement('div')
    dialog.className = 'ui-dialog'
    document.body.appendChild(dialog)
    escape()
    expect(onClose).not.toHaveBeenCalled()
    dialog.remove()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 the Escape stack', () => {
  it('the topmost picker, editor or drag takes Escape first', async () => {
    const { onClose } = await open()
    const { escape: stack } = lastCanvas()
    const picker = vi.fn(() => true)
    const pop = stack.push(picker)
    escape()
    expect(picker).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    pop()
    escape()
    expect(picker).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith({ how: 'escape' })
  })
  it('newest first, and one that does not take it hands it down', async () => {
    const { onClose } = await open()
    const { escape: stack } = lastCanvas()
    const editor = vi.fn(() => true)
    const passing = vi.fn(() => false)
    const popEditor = stack.push(editor)
    stack.push(passing)
    escape()
    expect(passing).toHaveBeenCalledTimes(1)
    expect(editor).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    popEditor()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 pull-away, on the framed size only', () => {
  const topX = F.x + F.w / 2
  const topY = F.y + 4
  it('the frame shrinks as an edge is pulled, and short of the distance it springs back', async () => {
    const { panel, onClose } = await open()
    down(panel(), topX, topY)
    expect(panel().dataset.pulling).toBe('true')
    move(topX, topY - 80)
    expect(panel().style.transform).toMatch(/^scale\(0\.8[0-9]*\)$/)
    // Pushed back inward is no pull.
    move(topX, topY + 40)
    expect(panel().style.transform).toBe('scale(1.0000)')
    move(topX, topY - 80)
    up(topX, topY - 80)
    expect(onClose).not.toHaveBeenCalled()
    expect(panel().dataset.pulling).toBeUndefined()
    expect(panel().style.transform).toBe('')
  })
  it('let go past the distance, it collapses back into its dot', async () => {
    const { panel, onClose } = await open({ reducedMotion: false, origin: { x: 40, y: 30 } })
    down(panel(), topX, topY)
    move(topX, topY - PULL_CLOSE_PX - 10)
    expect(panel().dataset.willClose).toBe('true')
    expect(screen.getByText('Let go to close')).toBeTruthy()
    up(topX, topY - PULL_CLOSE_PX - 10)
    expect(panel().dataset.collapsing).toBe('true')
    expect(panel().style.transform).toMatch(/^translate\(.*\) scale\(0\.04\)$/)
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ how: 'pull' }))
  })
  it('every edge pulls outward', async () => {
    const { panel, onClose } = await open()
    const edges = [
      ['w', F.x + 3, F.y + F.h / 2, -1, 0],
      ['e', F.x + F.w - 3, F.y + F.h / 2, 1, 0],
      ['s', F.x + F.w / 2, F.y + F.h - 3, 0, 1],
    ]
    for (const [, x, y, ux, uy] of edges) {
      down(panel(), x, y)
      move(x + ux * 60, y + uy * 60)
      expect(panel().style.transform).toMatch(/^scale\(0\.8/)
      up(x + ux * 60, y + uy * 60)
    }
    expect(onClose).not.toHaveBeenCalled()
  })
  it('Escape during a pull cancels it, and the next Escape goes back', async () => {
    const { panel, onClose } = await open()
    down(panel(), topX, topY)
    move(topX, topY - PULL_CLOSE_PX - 10)
    escape()
    expect(onClose).not.toHaveBeenCalled()
    expect(panel().dataset.pulling).toBeUndefined()
    up(topX, topY - PULL_CLOSE_PX - 10)
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledWith({ how: 'escape' })
  })
  it('🚨 filling the view or maximised, an edge does not pull', async () => {
    for (const size of ['filled', 'maximised']) {
      const { panel, onClose, view } = await open({ initialSize: size })
      down(panel(), topX, topY)
      move(topX, topY - PULL_CLOSE_PX - 50)
      expect(panel().dataset.pulling).toBeUndefined()
      up(topX, topY - PULL_CLOSE_PX - 50)
      expect(onClose).not.toHaveBeenCalled()
      view.unmount()
      h.lives.length = 0
    }
  })
  it('a press inside the board is the board\'s, even at the edge', async () => {
    const { panel, onClose } = await open()
    const inside = document.querySelector('[data-test-canvas]')
    down(inside, topX, topY)
    move(topX, topY - PULL_CLOSE_PX - 50)
    up(topX, topY - PULL_CLOSE_PX - 50)
    expect(panel().dataset.pulling).toBeUndefined()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// The panel mounted with props that can change later, as the Moth page's do when the account or company changes.
const mount = async (props = {}) => {
  const onClose = vi.fn()
  const base = { board: BOARD, adapter, me: ME, companyId: 'w1', onClose, reducedMotion: true, ...props }
  const view = render(<BoardPanel {...base} />)
  await screen.findByText('the canvas')
  await waitFor(() => expect(h.lives.length).toBe(1))
  await waitFor(() => expect(lastCanvas().live).toBe(h.lives[0]))
  const rerender = (next) => view.rerender(<BoardPanel {...base} {...next} />)
  return { onClose, view, rerender }
}

describe('🚨 leaving cleanly', () => {
  const lets = async () => {
    expect(h.lives[0].leave).toHaveBeenCalledTimes(1)
    expect(h.turns[0].dispose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
  }
  it('another person: the channels are left, the store and the turns let go, and it goes back to the map', async () => {
    const { onClose, rerender } = await mount()
    rerender({ me: { id: 'u2', label: 'Theo Lindqvist' } })
    await lets()
    // Let go at once, as the last person: nothing more is asked of the board as them.
    expect(h.stores[0].flush).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledWith({ how: 'left' })
    expect(onClose).toHaveBeenCalledTimes(1)
    // Nothing is made again for the new one, and the canvas of the last one is gone.
    expect(h.stores).toHaveLength(1)
    expect(h.joins).toHaveLength(1)
    expect(screen.queryByText('the canvas')).toBeNull()
  })
  it('another company', async () => {
    const { onClose, rerender } = await mount()
    rerender({ companyId: 'w2' })
    await lets()
    expect(onClose).toHaveBeenCalledWith({ how: 'left' })
    expect(h.stores).toHaveLength(1)
  })
  it('signed out', async () => {
    const { onClose, rerender } = await mount()
    rerender({ me: { id: null, label: 'Someone' } })
    await lets()
    expect(onClose).toHaveBeenCalledWith({ how: 'left' })
  })
  it('🚨 another person, another company or signed out: what was waiting is dropped, not saved as the last one', async () => {
    for (const next of [{ me: { id: 'u2', label: 'Theo Lindqvist' } }, { companyId: 'w2' }, { me: { id: null, label: 'Someone' } }]) {
      h.stores.length = 0
      h.lives.length = 0
      const { rerender } = await mount()
      rerender(next)
      await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
      expect(h.stores[0].dispose).toHaveBeenCalledWith({ save: false })
      expect(h.stores[0].flush).not.toHaveBeenCalled()
      cleanup()
    }
  })
  it('an ordinary close keeps saving what is waiting: dispose is asked nothing else', async () => {
    const { view } = await mount()
    view.unmount()
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
    expect(h.stores[0].flush).toHaveBeenCalledTimes(1)
    expect(h.stores[0].dispose.mock.calls[0]).toEqual([])
  })
  // A store whose close is still trying (its changes have not reached the server), until `done` is called.
  const stillTrying = () => {
    let done = () => {}
    const s0 = h.makeStore
    h.makeStore = (opts) => {
      const s = s0(opts)
      if (h.stores.length === 1) s.dispose = vi.fn((o) => (o?.save === false ? undefined : new Promise((r) => { done = r })))
      return s
    }
    return { done: () => act(async () => { done() }) }
  }
  it('the same board opened again while its last close is still trying: that is sent first, then the board is read', async () => {
    const trying = stillTrying()
    const first = await open()
    first.view.unmount()
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
    h.lives.length = 0
    await open()
    expect(h.stores).toHaveLength(2)
    expect(h.stores[0].flush).toHaveBeenCalledTimes(2)
    expect(h.stores[0].flush.mock.invocationCallOrder[1]).toBeLessThan(h.stores[1].load.mock.invocationCallOrder[0])
    expect(h.stores[0].dispose).toHaveBeenCalledTimes(1)
    await trying.done()
  })
  it('🚨 another person opening a board while a close is still trying: that close drops what was waiting', async () => {
    const trying = stillTrying()
    const first = await open()
    first.view.unmount()
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
    h.lives.length = 0
    await open({ me: { id: 'u2', label: 'Theo Lindqvist' } })
    expect(h.stores[0].dispose).toHaveBeenLastCalledWith({ save: false })
    expect(h.stores[0].flush).toHaveBeenCalledTimes(1)
    await trying.done()
  })
  it('the same person under a new name is no change: nothing is left', async () => {
    const { onClose, rerender } = await mount()
    rerender({ me: { id: 'u1', label: 'Mara O.' } })
    rerender({ me: { id: 'u1', label: 'Mara O.' }, companyId: 'w1' })
    expect(h.lives[0].leave).not.toHaveBeenCalled()
    expect(h.turns[0].dispose).not.toHaveBeenCalled()
    expect(h.stores[0].dispose).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('the canvas')).toBeTruthy()
  })
  it('signed out before the channels answer: they are left the moment they do', async () => {
    let answer = null
    h.join = (opts) => { h.joins.push(opts); return new Promise((r) => { answer = r }) }
    const onClose = vi.fn()
    const view = render(<BoardPanel board={BOARD} adapter={adapter} me={ME} companyId="w1" onClose={onClose} />)
    await waitFor(() => expect(h.joins).toHaveLength(1))
    view.rerender(<BoardPanel board={BOARD} adapter={adapter} me={{ id: null, label: 'Someone' }} companyId="w1" onClose={onClose} />)
    expect(h.turns[0].dispose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.stores[0].dispose).toHaveBeenCalledTimes(1))
    const l = fakeLive()
    await act(async () => { answer(l) })
    expect(l.leave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith({ how: 'left' })
  })
})

describe('🚨 a board to the trash', () => {
  const trashing = (impl = async () => ({ batches: 1, folders: 1, files: 2 })) => ({ name: 'fake', trashFolders: vi.fn(impl) })
  const ask = () => fireEvent.click(screen.getByRole('button', { name: TRASH_WORDS.action }))
  const question = () => document.querySelector('[data-moth-board-trash-ask]')

  it('asks first, in the panel itself, and Keep it keeps it', async () => {
    const a = trashing()
    const { onClose } = await mount({ adapter: a })
    ask()
    const box = question()
    expect(box).toBeTruthy()
    expect(document.querySelector('[data-moth-board]').contains(box)).toBe(true)
    expect(screen.getByRole('alertdialog', { name: TRASH_WORDS.question })).toBe(box)
    expect(screen.getByText('Put this board in the trash? Its notes and pictures go with it. You can bring it back from Moth\'s trash for 30 days.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Put it in the trash' })).toBeTruthy()
    // The safe answer has the focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }))
    expect(a.trashFolders).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(question()).toBeNull()
    expect(a.trashFolders).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('Escape while asking is Keep it; the next Escape goes back to the map', async () => {
    const a = trashing()
    const { onClose } = await mount({ adapter: a })
    ask()
    escape()
    expect(question()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledWith({ how: 'escape' })
    expect(a.trashFolders).not.toHaveBeenCalled()
  })
  it('🚨 Put it in the trash: its last changes saved, then its folder goes, and the panel closes to the map', async () => {
    const a = trashing()
    const { onClose } = await mount({ adapter: a })
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Put it in the trash' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ how: 'trashed', words: TRASH_WORDS.done }))
    expect(a.trashFolders).toHaveBeenCalledTimes(1)
    expect(a.trashFolders).toHaveBeenCalledWith(['f1'])
    expect(h.stores[0].flush.mock.invocationCallOrder[0]).toBeLessThan(a.trashFolders.mock.invocationCallOrder[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('the folder the store reads is the one that goes', async () => {
    h.makeStore = (opts) => { const s = fakeStore({ board: { id: 'b1', folder_id: 'f9', title: 'Plans', can_write: true } }); s.opts = opts; h.stores.push(s); return s }
    const a = trashing()
    await mount({ adapter: a })
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Put it in the trash' }))
    await waitFor(() => expect(a.trashFolders).toHaveBeenCalledWith(['f9']))
  })
  it('while it goes, it says so and cannot be asked twice', async () => {
    let answer = null
    const a = trashing(() => new Promise((r) => { answer = r }))
    const { onClose } = await mount({ adapter: a })
    ask()
    const yes = screen.getByRole('button', { name: 'Put it in the trash' })
    // Two presses in the same moment, before the panel is drawn again, are one.
    act(() => { yes.click(); yes.click() })
    expect(await screen.findByText(TRASH_WORDS.busy)).toBeTruthy()
    await waitFor(() => expect(a.trashFolders).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Keep it' }).disabled).toBe(true)
    escape()
    expect(question()).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { answer({ batches: 1, folders: 1, files: 0 }) })
    expect(onClose).toHaveBeenCalledWith({ how: 'trashed', words: TRASH_WORDS.done })
  })
  it('🚨 a refusal shows the server\'s words, and the board stays open', async () => {
    let fail = Object.assign(new Error('[supabase] Something in this folder is in the trash: bring it back or wait for it to go first.'), { code: '42501' })
    const a = trashing(async () => { if (fail) throw fail; return { batches: 1, folders: 1, files: 0 } })
    const { onClose } = await mount({ adapter: a })
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Put it in the trash' }))
    expect(await screen.findByText('Something in this folder is in the trash: bring it back or wait for it to go first.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('the canvas')).toBeTruthy()
    expect(question()).toBeTruthy()
    // Asked again, it goes.
    fail = null
    fireEvent.click(screen.getByRole('button', { name: 'Put it in the trash' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ how: 'trashed', words: TRASH_WORDS.done }))
  })
  it('the server\'s one refusal for missing and not allowed is said plainly', async () => {
    const a = trashing(async () => { throw Object.assign(new Error('folder not found or not writable'), { code: '42501' }) })
    await mount({ adapter: a })
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Put it in the trash' }))
    expect(await screen.findByText(TRASH_WORDS.gone)).toBeTruthy()
  })
  it('🚨 only someone who may change the board is offered it', async () => {
    h.makeStore = (opts) => { const s = fakeStore({ board: { id: 'b1', title: 'Plans', can_write: false } }); s.opts = opts; h.stores.push(s); return s }
    await mount({ adapter: trashing() })
    expect(screen.queryByRole('button', { name: TRASH_WORDS.action })).toBeNull()
  })
  it('a board that becomes look-only while asking takes the question away', async () => {
    await mount({ adapter: trashing() })
    ask()
    expect(question()).toBeTruthy()
    act(() => { h.stores[0].board = { id: 'b1', title: 'Plans', can_write: false }; h.stores[0].emit({ type: 'change', ids: [] }) })
    await waitFor(() => expect(question()).toBeNull())
    expect(screen.queryByRole('button', { name: TRASH_WORDS.action })).toBeNull()
  })
  it('an adapter with no trash for folders offers none', async () => {
    await mount()
    expect(screen.queryByRole('button', { name: TRASH_WORDS.action })).toBeNull()
  })
})

describe('🚨 the corners resize', () => {
  const seX = F.x + F.w - 3
  const seY = F.y + F.h - 3
  it('a corner dragged resizes the frame, and it does not close', async () => {
    const { panel, onClose } = await open()
    down(panel(), seX, seY)
    expect(panel().dataset.resizing).toBe('true')
    move(seX - 100, seY - 50)
    expect(panel().style.width).toBe(`${F.w - 100}px`)
    expect(panel().style.height).toBe(`${F.h - 50}px`)
    expect(panel().style.left).toBe(`${F.x}px`)
    up(seX - 100, seY - 50)
    expect(panel().dataset.resizing).toBeUndefined()
    expect(panel().style.width).toBe(`${F.w - 100}px`)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('the far corner moves its own two edges, and never smaller than the least', async () => {
    const { panel } = await open()
    down(panel(), F.x + 3, F.y + 3)
    move(F.x + 3 + 5000, F.y + 3 + 5000)
    up(F.x + 3 + 5000, F.y + 3 + 5000)
    expect(panel().style.width).toBe(`${MIN_FRAME.w}px`)
    expect(panel().style.height).toBe(`${MIN_FRAME.h}px`)
    expect(panel().style.left).toBe(`${F.x + F.w - MIN_FRAME.w}px`)
  })
  it('Escape during a resize puts the frame back as it was', async () => {
    const { panel, onClose } = await open()
    down(panel(), seX, seY)
    move(seX - 100, seY - 50)
    escape()
    expect(panel().style.width).toBe(`${F.w}px`)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('the size kept through another size and back', async () => {
    const { panel } = await open()
    down(panel(), seX, seY)
    move(seX - 100, seY - 50)
    up(seX - 100, seY - 50)
    fireEvent.click(screen.getByRole('button', { name: 'Fill the view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in a frame' }))
    expect(panel().style.width).toBe(`${F.w - 100}px`)
  })
  it('🚨 filling the view, a corner does not resize', async () => {
    const { panel } = await open({ initialSize: 'filled' })
    down(panel(), seX, seY)
    move(seX - 100, seY - 50)
    up(seX - 100, seY - 50)
    expect(panel().dataset.resizing).toBeUndefined()
    expect(panel().style.width).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Show in a frame' }))
    expect(panel().style.width).toBe(`${F.w}px`)
  })
})
