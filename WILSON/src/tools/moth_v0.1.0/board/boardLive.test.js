// boardLive.test.js — MO4: one window on a board's two channels, against an adapter whose openBoardChannels hands
// back the connection it made (so a test can play the server's and the other people's messages).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { joinBoard, personColour, plainLabel, LIVE_WORDS } from './boardLive.js'

const BOARD = 'b0000000-0000-4000-8000-000000000001'
const MARA = { id: 'u-mara', label: 'Mara Okonkwo' }

function fakeAdapter() {
  const opened = []
  const adapter = {
    opened,
    names: { topic: `moth:board:${BOARD}:0.0`, live_topic: `moth:board-live:${BOARD}:0.0`, audience_gen: 0 },
    boardChannels: vi.fn(async () => ({ ...adapter.names })),
    openBoardChannels: vi.fn(async (topics, handlers) => {
      const conn = {
        topics,
        handlers,
        sendLive: vi.fn(),
        track: vi.fn(async () => {}),
        leave: vi.fn(),
      }
      opened.push(conn)
      return conn
    }),
  }
  return adapter
}

async function joined(over = {}) {
  const adapter = over.adapter ?? fakeAdapter()
  const store = { applyRemote: vi.fn(async () => {}), preview: vi.fn(), load: vi.fn(async () => {}) }
  const turns = { applyMessage: vi.fn(), refresh: vi.fn(async () => {}) }
  const onClosed = vi.fn()
  const target = new EventTarget()
  const live = await joinBoard({ adapter, boardId: BOARD, me: MARA, store, turns, onClosed, target,
    frame: (fn) => setTimeout(fn, 16), ...over })
  return { adapter, store, turns, onClosed, target, live, conn: () => adapter.opened.at(-1) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('boardLive: joining', () => {
  it('asks the board\'s channel names, joins them, and says who is here without an email', async () => {
    const { adapter, conn } = await joined()
    expect(adapter.boardChannels).toHaveBeenCalledWith(BOARD)
    expect(conn().topics).toEqual({ topic: adapter.names.topic, live_topic: adapter.names.live_topic })
    expect(Object.keys(conn().handlers).sort()).toEqual(['onAudience', 'onElements', 'onLive', 'onPresence', 'onStatus', 'onSticky'])
    expect(conn().track).toHaveBeenCalledWith({ user_id: 'u-mara', label: 'Mara Okonkwo', colour: personColour('u-mara') })

    const other = fakeAdapter()
    await joinBoard({ adapter: other, boardId: BOARD, me: { id: 'u-x', label: 'mara@example.com' }, target: new EventTarget() })
    expect(other.opened[0].track.mock.calls[0][0].label).toBe(LIVE_WORDS.someone)
  })

  it('a board this person may not read closes with words', async () => {
    const adapter = fakeAdapter()
    adapter.boardChannels.mockRejectedValueOnce(Object.assign(new Error('[supabase] board not found'), { code: '42501' }))
    const { onClosed, live } = await joined({ adapter })
    expect(onClosed).toHaveBeenCalledWith(LIVE_WORDS.gone)
    expect(adapter.openBoardChannels).not.toHaveBeenCalled()
    live.sendPointer(1, 1)
    expect(live.stats().sent).toBe(0)
  })

  it('a join that could not reach the server is tried again', async () => {
    const adapter = fakeAdapter()
    adapter.boardChannels.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { onClosed } = await joined({ adapter })
    expect(adapter.openBoardChannels).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(1)
    expect(onClosed).not.toHaveBeenCalled()
  })
})

describe('boardLive: sending', () => {
  it('a moving pointer is sent at most ten times a second, its last place always', async () => {
    const { live, conn } = await joined()
    live.sendPointer(1, 1)
    expect(conn().sendLive).toHaveBeenCalledTimes(1)
    expect(conn().sendLive).toHaveBeenLastCalledWith('cursor', { board: BOARD, user: 'u-mara', label: 'Mara Okonkwo', x: 1, y: 1 })
    vi.advanceTimersByTime(10)
    live.sendPointer(2, 2)
    vi.advanceTimersByTime(10)
    live.sendPointer(3.333, 3)
    expect(conn().sendLive).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(80)
    expect(conn().sendLive).toHaveBeenCalledTimes(2)
    expect(conn().sendLive.mock.calls[1][1]).toMatchObject({ x: 3.3, y: 3 })

    conn().sendLive.mockClear()
    for (let i = 0; i < 60; i += 1) { live.sendPointer(100 + i, 100); vi.advanceTimersByTime(16) }
    vi.advanceTimersByTime(200)
    expect(conn().sendLive.mock.calls.length).toBeLessThanOrEqual(11)
    expect(conn().sendLive.mock.calls.at(-1)[1]).toMatchObject({ x: 159, y: 100 })
  })

  it('a still pointer sends nothing', async () => {
    const { live, conn } = await joined()
    live.sendPointer(5, 5)
    vi.advanceTimersByTime(200)
    for (let i = 0; i < 20; i += 1) { live.sendPointer(5, 5); vi.advanceTimersByTime(50) }
    expect(conn().sendLive).toHaveBeenCalledTimes(1)
    expect(live.stats()).toMatchObject({ sent: 1, sentByEvent: { cursor: 1 } })
  })

  it('a send the adapter could not make (live channel not joined yet) is not counted', async () => {
    const { live, conn } = await joined()
    conn().sendLive.mockReturnValueOnce(false)
    live.sendPointer(7, 7)
    expect(live.stats().sent).toBe(0)
    live.sendPointer(7, 7)
    expect(conn().sendLive).toHaveBeenCalledTimes(2)
    expect(live.stats().sent).toBe(1)
  })

  it('a drag is sent the same way, element by element', async () => {
    const { live, conn } = await joined()
    live.sendDrag('el-1', 10, 10)
    live.sendDrag('el-2', 50, 50)
    live.sendDrag('el-1', 11, 11)
    expect(conn().sendLive).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(100)
    expect(conn().sendLive).toHaveBeenCalledTimes(3)
    expect(conn().sendLive.mock.calls[2]).toEqual(['drag', { board: BOARD, user: 'u-mara', label: 'Mara Okonkwo', element: 'el-1', x: 11, y: 11 }])
  })
})

describe('boardLive: receiving', () => {
  it('saves go to the store and turns to stickyTurn, each counted', async () => {
    const { store, turns, live, conn } = await joined()
    const put = { board: BOARD, op: 'put', elements: [{ id: 'el-1', version: 2 }] }
    const lock = { board: BOARD, op: 'lock', element: 'st-1', holder_label: 'Theo Lindqvist', ends_in_ms: 30000 }
    conn().handlers.onElements(put)
    conn().handlers.onSticky(lock)
    conn().handlers.onElements({ board: 'another', op: 'remove', ids: ['el-1'] })
    expect(store.applyRemote).toHaveBeenCalledTimes(1)
    expect(store.applyRemote).toHaveBeenCalledWith(put)
    expect(turns.applyMessage).toHaveBeenCalledWith(lock)
    expect(live.stats()).toMatchObject({ received: 3, receivedByEvent: { elements: 2, sticky: 1 } })
  })

  it('another person\'s cursor glides to each new place; our own never comes back', async () => {
    const { live, conn } = await joined()
    const events = []
    live.subscribe((e) => events.push(e.type))
    conn().handlers.onLive('cursor', { board: BOARD, user: 'u-theo', label: 'Theo Lindqvist', x: 0, y: 0 })
    expect(live.cursors().get('u-theo')).toEqual({ x: 0, y: 0, label: 'Theo Lindqvist', colour: personColour('u-theo') })
    conn().handlers.onLive({ event: 'cursor', payload: { board: BOARD, user: 'u-theo', label: 'Theo Lindqvist', x: 100, y: 40 } })
    vi.advanceTimersByTime(50)
    expect(live.cursors().get('u-theo')).toMatchObject({ x: 50, y: 20 })
    vi.advanceTimersByTime(60)
    expect(live.cursors().get('u-theo')).toMatchObject({ x: 100, y: 40 })
    expect(events).toContain('cursors')

    conn().handlers.onLive('cursor', { board: BOARD, user: 'u-mara', label: 'Mara Okonkwo', x: 9, y: 9 })
    expect(live.cursors().has('u-mara')).toBe(false)
  })

  it('a cursor nobody has moved for five seconds goes', async () => {
    const { live, conn } = await joined()
    conn().handlers.onLive('cursor', { user: 'u-theo', label: 'Theo Lindqvist', x: 1, y: 1 })
    vi.advanceTimersByTime(4000)
    expect(live.cursors().size).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(live.cursors().size).toBe(0)
  })

  it('who is here: names and colours, never ourselves, never an email', async () => {
    const { live, conn } = await joined()
    conn().handlers.onPresence({
      a: [{ user_id: 'u-theo', label: 'Theo Lindqvist' }],
      b: [{ user_id: 'u-mara', label: 'Mara Okonkwo' }],
      c: [{ user_id: 'u-priya', label: 'priya@example.com' }, { user_id: 'u-priya', label: 'again' }],
    })
    expect(live.people()).toEqual([
      { id: 'u-theo', label: 'Theo Lindqvist', colour: personColour('u-theo') },
      { id: 'u-priya', label: LIVE_WORDS.someone, colour: personColour('u-priya') },
    ])
    conn().handlers.onLive('cursor', { user: 'u-theo', x: 1, y: 1 })
    expect(live.cursors().get('u-theo').label).toBe('Theo Lindqvist')
    conn().handlers.onPresence([[{ user_id: 'u-priya', label: 'Priya Raman' }]])
    expect(live.people().map((p) => p.id)).toEqual(['u-priya'])
    expect(live.cursors().has('u-theo')).toBe(false)
  })

  it('another person\'s drag is drawn through the store until their save arrives', async () => {
    const { store, conn } = await joined()
    conn().handlers.onLive('drag', { user: 'u-theo', element: 'el-1', x: 10, y: 10 })
    vi.advanceTimersByTime(20)
    expect(store.preview).toHaveBeenLastCalledWith('el-1', { x: 10, y: 10 })
    conn().handlers.onElements({ board: BOARD, op: 'put', elements: [{ id: 'el-1', version: 3, x: 12, y: 12 }] })
    expect(store.preview).toHaveBeenLastCalledWith('el-1', null)
    conn().handlers.onLive('drag', { user: 'u-theo', element: 'el-1', x: 11, y: 11 })
    vi.advanceTimersByTime(20)
    expect(store.preview).toHaveBeenLastCalledWith('el-1', null)
  })
})

describe('boardLive: renamed channels and leaving', () => {
  it('AUDIENCE: the names are asked again and joined, and what they carried is read again', async () => {
    const { adapter, store, turns, conn } = await joined()
    const first = conn()
    adapter.names = { topic: `moth:board:${BOARD}:0.1`, live_topic: `moth:board-live:${BOARD}:0.1`, audience_gen: 1 }
    first.handlers.onAudience({ board: BOARD, op: 'audience' })
    await vi.advanceTimersByTimeAsync(0)
    expect(first.leave).toHaveBeenCalled()
    expect(conn()).not.toBe(first)
    expect(conn().topics.topic).toMatch(/0\.1$/)
    expect(conn().track).toHaveBeenCalled()
    expect(store.load).toHaveBeenCalled()
    expect(turns.refresh).toHaveBeenCalled()
    first.handlers.onElements({ board: BOARD, op: 'remove', ids: ['x'] })
    expect(store.applyRemote).not.toHaveBeenCalled()
  })

  it('AUDIENCE with the same names changes nothing', async () => {
    const { adapter, conn } = await joined()
    conn().handlers.onAudience({ board: BOARD, op: 'audience' })
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(1)
  })

  it('AUDIENCE then a refusal: the board closes with words', async () => {
    const { adapter, onClosed, live, conn } = await joined()
    const first = conn()
    adapter.boardChannels.mockRejectedValueOnce(Object.assign(new Error('board not found'), { code: '42501' }))
    first.handlers.onAudience({ board: BOARD, op: 'audience' })
    await vi.advanceTimersByTimeAsync(0)
    expect(onClosed).toHaveBeenCalledWith(LIVE_WORDS.gone)
    expect(first.leave).toHaveBeenCalled()
    live.sendPointer(3, 3)
    expect(first.sendLive).not.toHaveBeenCalled()
  })

  it('leave goes, and nothing after it is sent or heard', async () => {
    const { store, live, conn, onClosed } = await joined()
    live.sendPointer(1, 1)
    live.sendPointer(2, 2)
    live.leave()
    expect(conn().leave).toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(conn().sendLive).toHaveBeenCalledTimes(1)
    conn().handlers.onElements({ board: BOARD, op: 'remove', ids: ['x'] })
    expect(store.applyRemote).not.toHaveBeenCalled()
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('a page hidden leaves; one brought back from the cache joins again', async () => {
    const { adapter, target, live, conn } = await joined()
    const first = conn()
    target.dispatchEvent(new Event('pagehide'))
    expect(first.leave).toHaveBeenCalled()
    live.sendPointer(4, 4)
    expect(first.sendLive).not.toHaveBeenCalled()
    target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(2)
    live.sendPointer(5, 5)
    expect(conn().sendLive).toHaveBeenCalledTimes(1)
  })
})

// The channels say when they join and when they fail. Nothing read these words before a board was seen running
// against a real server: a save made before the join, or while the network was away, was never told to the window.
describe('boardLive: the channels joining, dropping and joining again', () => {
  const topic = (status) => ({ channel: 'topic', status })
  const liveCh = (status) => ({ channel: 'live', status })

  it('the database\'s channel joined: the board and the turns are read again, the first time and after a drop', async () => {
    const { store, turns, conn } = await joined()
    expect(store.load).not.toHaveBeenCalled()
    conn().handlers.onStatus(topic('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).toHaveBeenCalledTimes(1)
    expect(turns.refresh).toHaveBeenCalledTimes(1)
    conn().handlers.onStatus(topic('CHANNEL_ERROR'))
    conn().handlers.onStatus(topic('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).toHaveBeenCalledTimes(2)
    expect(turns.refresh).toHaveBeenCalledTimes(2)
  })

  it('the people\'s channel joining reads nothing again', async () => {
    const { store, conn } = await joined()
    conn().handlers.onStatus(liveCh('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).not.toHaveBeenCalled()
  })

  it('asked again while a read is on its way, one more read follows it', async () => {
    const { store, conn } = await joined()
    let done
    store.load.mockImplementationOnce(() => new Promise((r) => { done = r }))
    conn().handlers.onStatus(topic('SUBSCRIBED'))
    conn().handlers.onStatus(topic('SUBSCRIBED'))
    conn().handlers.onStatus(topic('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).toHaveBeenCalledTimes(1)
    done()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).toHaveBeenCalledTimes(2)
  })

  it('a channel that cannot join: the names are asked again, and new ones are joined', async () => {
    const { adapter, conn } = await joined()
    const first = conn()
    adapter.names = { topic: `moth:board:${BOARD}:0.1`, live_topic: `moth:board-live:${BOARD}:0.1`, audience_gen: 1 }
    first.handlers.onStatus(topic('CHANNEL_ERROR'))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.boardChannels).toHaveBeenCalledTimes(2)
    expect(first.leave).toHaveBeenCalled()
    expect(conn().topics.topic).toMatch(/0\.1$/)
  })

  it('...and a board closed to this person meanwhile closes with words', async () => {
    const { adapter, onClosed, conn } = await joined()
    adapter.boardChannels.mockRejectedValueOnce(Object.assign(new Error('board not found'), { code: '42501' }))
    conn().handlers.onStatus(liveCh('TIMED_OUT'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onClosed).toHaveBeenCalledWith(LIVE_WORDS.gone)
  })

  it('under the same names it is left to join by itself, and the names are not asked on every failure', async () => {
    const { adapter, conn } = await joined()
    for (let i = 0; i < 4; i += 1) conn().handlers.onStatus(topic('CHANNEL_ERROR'))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.boardChannels).toHaveBeenCalledTimes(2)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    conn().handlers.onStatus(topic('CHANNEL_ERROR'))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.boardChannels).toHaveBeenCalledTimes(3)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(1)
  })

  it('a network gone and back: the names cannot be asked, it is tried again, and a channel back by itself is kept', async () => {
    const { adapter, store, conn } = await joined()
    const first = conn()
    adapter.boardChannels.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    first.handlers.onStatus(topic('CHANNEL_ERROR'))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.boardChannels).toHaveBeenCalledTimes(2)
    // The channel joins again by itself before the next try: what it missed is read, and the try leaves it joined.
    first.handlers.onStatus(topic('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.load).toHaveBeenCalledTimes(1)
    expect(adapter.boardChannels).toHaveBeenCalledTimes(3)
    expect(first.leave).not.toHaveBeenCalled()
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(1)
  })

  it('...and one still down at the next try is opened again', async () => {
    const { adapter, conn } = await joined()
    const first = conn()
    adapter.boardChannels.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    first.handlers.onStatus(topic('CHANNEL_ERROR'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(first.leave).toHaveBeenCalled()
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(2)
  })

  it('closed by the server, a channel is opened again under the names of now', async () => {
    const { adapter, conn } = await joined()
    const first = conn()
    first.handlers.onStatus(topic('CLOSED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(first.leave).toHaveBeenCalled()
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(2)
  })

  it('subscribers hear the link go and come, and a left connection\'s words are not heard', async () => {
    const { adapter, store, live, conn } = await joined()
    const heard = []
    live.subscribe((e) => { if (e.type === 'link') heard.push(e.up) })
    const first = conn()
    first.handlers.onStatus(topic('CHANNEL_ERROR'))
    first.handlers.onStatus(liveCh('CHANNEL_ERROR'))
    first.handlers.onStatus(topic('SUBSCRIBED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(heard).toEqual([false, true])
    adapter.names = { topic: `moth:board:${BOARD}:0.2`, live_topic: `moth:board-live:${BOARD}:0.2`, audience_gen: 2 }
    first.handlers.onAudience({ board: BOARD, op: 'audience' })
    await vi.advanceTimersByTimeAsync(0)
    const reads = store.load.mock.calls.length
    first.handlers.onStatus(topic('SUBSCRIBED'))
    first.handlers.onStatus(topic('CLOSED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.load).toHaveBeenCalledTimes(reads)
    expect(adapter.openBoardChannels).toHaveBeenCalledTimes(2)
  })
})

describe('boardLive: words', () => {
  it('a name as a board shows it', () => {
    expect(plainLabel('  Theo   Lindqvist ')).toBe('Theo Lindqvist')
    expect(plainLabel('theo@example.com')).toBe(LIVE_WORDS.someone)
    expect(plainLabel('')).toBe(LIVE_WORDS.someone)
    expect(personColour('u-theo')).toBe(personColour('u-theo'))
  })
})
