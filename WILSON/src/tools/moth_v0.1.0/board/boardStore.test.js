// boardStore.test.js — MO4: the board's store against a fake that answers as 0130's board functions do (versions,
// last writer wins, `expect` skipped into conflicts, a removal naming only what it found).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBoardStore, wordsOf, isRefusal, BOARD_WORDS } from './boardStore.js'

const BOARD = 'b0000000-0000-4000-8000-000000000001'
const BOARD_ROW = { id: BOARD, folder_id: 'f1', project_id: 'p1', title: 'Ideas', revision: 1, audience_gen: 0, can_write: true }
const KEYS = ['shape', 'x', 'y', 'w', 'h', 'rotation', 'z', 'style', 'body', 'points', 'from_id', 'from_anchor', 'to_id', 'to_anchor']
const clone = (o) => JSON.parse(JSON.stringify(o))

const el = (id, over = {}) => ({
  id, kind: 'shape', shape: 'rectangle', x: 0, y: 0, w: 100, h: 60, rotation: 0, z: 1, style: { fill: '#ffffff' },
  body: null, points: null, file: null, missing: false, from_id: null, from_anchor: null, to_id: null, to_anchor: null,
  version: 1, updated_at: '2026-11-11T10:00:00Z', updated_by: 'theo', ...over,
})

function fakeServer(initial = [], board = BOARD_ROW) {
  const rows = new Map(initial.map((e) => [e.id, clone(e)]))
  const adapter = {
    rows,
    readBoard: vi.fn(async () => ({ board: { ...board }, elements: [...rows.values()].map(clone) })),
    readBoardElements: vi.fn(async (_b, ids) => ids.filter((id) => rows.has(id)).map((id) => clone(rows.get(id)))),
    putBoardElements: vi.fn(async (_b, list) => {
      const saved = []
      const conflicts = []
      for (const sent of list) {
        const old = rows.get(sent.id)
        if (old) {
          if ('expect' in sent && sent.expect !== old.version) { conflicts.push({ id: sent.id, version: old.version }); continue }
          const next = { ...old }
          for (const k of KEYS) if (k in sent) next[k] = sent[k]
          next.version = old.version + 1
          rows.set(sent.id, next)
          saved.push({ id: sent.id, version: next.version })
        } else {
          if ('expect' in sent && sent.expect !== 0) { conflicts.push({ id: sent.id, version: null }); continue }
          const row = el(sent.id, { kind: sent.kind, shape: null, w: 0, h: 0, z: 0, style: {}, version: 1 })
          for (const k of KEYS) if (k in sent) row[k] = sent[k]
          row.file = sent.file_id ? { id: sent.file_id, name: 'note.md', mime_type: 'text/markdown', folder_id: 'f1', project_id: 'p1' } : null
          rows.set(sent.id, row)
          saved.push({ id: sent.id, version: 1 })
        }
      }
      return { saved, conflicts }
    }),
    deleteBoardElements: vi.fn(async (_b, ids, versions) => {
      const removed = []
      const conflicts = []
      ids.forEach((id, i) => {
        const row = rows.get(id)
        if (!row) return
        if (versions && versions[i] !== row.version) { conflicts.push({ id, version: row.version }); return }
        rows.delete(id)
        removed.push(id)
      })
      return { removed, conflicts }
    }),
  }
  return adapter
}

// Someone else's save, as the server makes it and the channel then says it.
function theirSave(adapter, id, fields) {
  const row = { ...adapter.rows.get(id), ...fields }
  row.version = adapter.rows.get(id).version + 1
  adapter.rows.set(id, row)
  const { file, missing, updated_at, ...wire } = row
  return { board: BOARD, op: 'put', elements: [{ ...wire, has_file: ['sticky', 'media', 'embed'].includes(row.kind), points_omitted: false }] }
}

const tick = () => Promise.resolve()

async function loaded(initial, board) {
  const adapter = fakeServer(initial, board)
  const store = createBoardStore({ adapter, boardId: BOARD })
  const events = []
  store.subscribe((e) => events.push(e))
  await store.load()
  return { adapter, store, events, notices: () => events.filter((e) => e.type === 'notice').map((e) => e.words) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('boardStore: loading and drawing', () => {
  it('load draws the board and its elements, and says so', async () => {
    const { adapter, store, events } = await loaded([el('a'), el('b', { x: 200 })])
    expect(adapter.readBoard).toHaveBeenCalledWith(BOARD)
    expect(store.getBoard().title).toBe('Ideas')
    expect([...store.getElements().keys()]).toEqual(['a', 'b'])
    expect(store.getElements().get('b').x).toBe(200)
    expect(events.at(-1)).toMatchObject({ type: 'change', loaded: true })
  })

  it('getElements hands out a map that does not move under its reader', async () => {
    const { store } = await loaded([el('a')])
    const first = store.getElements()
    expect(store.getElements()).toBe(first)
    store.update('a', { x: 40 })
    const second = store.getElements()
    expect(second).not.toBe(first)
    expect(first.get('a').x).toBe(0)
    expect(second.get('a').x).toBe(40)
  })
})

describe('boardStore: saving', () => {
  it('a change is drawn at once and saved once, 150 ms after the last', async () => {
    const { adapter, store } = await loaded([el('a')])
    store.update('a', { x: 10 })
    expect(store.getElements().get('a').x).toBe(10)
    await vi.advanceTimersByTimeAsync(100)
    store.update('a', { x: 20 })
    await vi.advanceTimersByTimeAsync(149)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    expect(adapter.putBoardElements).toHaveBeenCalledWith(BOARD, [{ id: 'a', kind: 'shape', x: 20 }])
    expect(store.getElements().get('a').version).toBe(2)
  })

  it('a stream of changes is still saved within a second', async () => {
    const { adapter, store } = await loaded([el('a')])
    for (let i = 1; i <= 12; i += 1) {
      store.update('a', { x: i })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(adapter.putBoardElements).toHaveBeenCalled()
    expect(adapter.putBoardElements.mock.calls[0][1][0].x).toBeLessThanOrEqual(11)
  })

  it('a drag is drawn every frame and saved once, when it settles', async () => {
    const { adapter, store } = await loaded([el('a', { x: 5, y: 5 })])
    for (const x of [10, 20, 30]) store.update('a', { x, y: x }, { settled: false })
    expect(store.getElements().get('a')).toMatchObject({ x: 30, y: 30 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    store.update('a', { x: 35 })
    await vi.advanceTimersByTimeAsync(150)
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    expect(adapter.putBoardElements.mock.calls[0][1]).toEqual([{ id: 'a', kind: 'shape', x: 35, y: 30 }])
    await store.undo()
    expect(store.getElements().get('a')).toMatchObject({ x: 5, y: 5 })
  })

  it('at most one save is in flight; what changed meanwhile goes in the next', async () => {
    const { adapter, store } = await loaded([el('a'), el('b')])
    const real = adapter.putBoardElements.getMockImplementation()
    let release
    adapter.putBoardElements.mockImplementationOnce((b, list) => new Promise((r) => { release = () => r(real(b, list)) }))
    store.update('a', { x: 1 })
    await vi.advanceTimersByTimeAsync(150)
    store.update('b', { x: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(2)
    expect(adapter.putBoardElements.mock.calls[1][1]).toEqual([{ id: 'b', kind: 'shape', x: 2 }])
  })

  it('flush saves at once', async () => {
    const { adapter, store } = await loaded([el('a')])
    store.update('a', { w: 300 })
    await store.flush()
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    expect(adapter.rows.get('a').w).toBe(300)
  })

  it('a new element gets its own id, is drawn at once and sent whole; a line after its shapes', async () => {
    const { adapter, store } = await loaded([el('a', { z: 4 })])
    const line = store.add({ kind: 'connector', from_id: 'a', to_id: null, style: { route: 'elbow' } })
    const box = store.add({ kind: 'shape', shape: 'diamond', x: 10, y: 20, w: 50, h: 50 })
    expect(line).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.getElements().get(box)).toMatchObject({ shape: 'diamond', version: 0, z: 6 })
    await store.flush()
    const sent = adapter.putBoardElements.mock.calls[0][1]
    expect(sent.map((s) => s.id)).toEqual([box, line])
    expect(sent[0]).toEqual({ id: box, kind: 'shape', shape: 'diamond', x: 10, y: 20, w: 50, h: 50, rotation: 0, z: 6, style: {} })
    expect(store.getElements().get(box).version).toBe(1)
  })

  it('a sticky is placed with its file and never with words in body', async () => {
    const { adapter, store } = await loaded([])
    const id = store.add({ kind: 'sticky', body: 'not here', file: { id: 'file-1', name: 'note.md' }, w: 200, h: 200 })
    store.update(id, { body: 'nor here', x: 9 })
    await store.flush()
    const sent = adapter.putBoardElements.mock.calls[0][1][0]
    expect(sent).toMatchObject({ id, kind: 'sticky', file_id: 'file-1', x: 9 })
    expect('body' in sent).toBe(false)
  })

  it('style changes key by key; a key set to null goes', async () => {
    const { adapter, store } = await loaded([el('a', { style: { fill: '#ffffff', stroke: '#000000' } })])
    store.update('a', { style: { fill: '#ffd28a', stroke: null } })
    expect(store.getElements().get('a').style).toEqual({ fill: '#ffd28a' })
    await store.flush()
    expect(adapter.putBoardElements.mock.calls[0][1][0].style).toEqual({ fill: '#ffd28a' })
  })

  it('a change that changes nothing is not saved', async () => {
    const { adapter, store } = await loaded([el('a', { x: 5 })])
    store.update('a', { x: 9 }, { settled: false })
    store.update('a', { x: 5 })
    await vi.advanceTimersByTimeAsync(500)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    expect(store.canUndo()).toBe(false)
  })

  it('a board you cannot change is not changed, and says so once', async () => {
    const { adapter, store, notices } = await loaded([el('a')], { ...BOARD_ROW, can_write: false })
    expect(store.add({ kind: 'shape' })).toBeNull()
    expect(store.update('a', { x: 1 })).toBe(false)
    expect(notices()).toEqual([BOARD_WORDS.readOnly])
    await vi.advanceTimersByTimeAsync(500)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
  })
})

describe('boardStore: others\' changes', () => {
  it('takes the newer version, never an older one over it', async () => {
    const { store } = await loaded([el('a', { version: 3, x: 1 })])
    store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...el('a', { version: 2, x: 99 }), has_file: false }] })
    expect(store.getElements().get('a').x).toBe(1)
    store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...el('a', { version: 4, x: 50 }), has_file: false }] })
    expect(store.getElements().get('a')).toMatchObject({ x: 50, version: 4 })
  })

  it('this window\'s unsaved change stays on top of theirs, and is saved after', async () => {
    const { adapter, store } = await loaded([el('a')])
    store.update('a', { y: 70 })
    store.applyRemote(theirSave(adapter, 'a', { x: 40 }))
    expect(store.getElements().get('a')).toMatchObject({ x: 40, y: 70 })
    await store.flush()
    expect(adapter.rows.get('a')).toMatchObject({ x: 40, y: 70, version: 3 })
  })

  it('their removal takes the element away, with any change of ours waiting for it', async () => {
    const { adapter, store } = await loaded([el('a'), el('b')])
    store.update('a', { x: 3 })
    store.applyRemote({ board: BOARD, op: 'remove', ids: ['a'] })
    expect(store.getElements().has('a')).toBe(false)
    await store.flush()
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
  })

  it('a message for another board is not this one\'s', async () => {
    const { store } = await loaded([el('a')])
    store.applyRemote({ board: 'another', op: 'remove', ids: ['a'] })
    expect(store.getElements().has('a')).toBe(true)
  })

  it('a new placed file, or a long drawing the message left out, is read again', async () => {
    const pen = el('p', { kind: 'pen', shape: null, points: [0, 0, 5, 5] })
    const { adapter, store } = await loaded([pen])
    adapter.rows.set('s', el('s', { kind: 'sticky', shape: null, file: { id: 'file-9', name: 'note.md' } }))
    await store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...el('s', { kind: 'sticky', shape: null }), file: undefined, has_file: true }] })
    expect(adapter.readBoardElements).toHaveBeenCalledWith(BOARD, ['s'])
    expect(store.getElements().get('s').file).toMatchObject({ id: 'file-9' })

    const long = Array.from({ length: 2000 }, (_, i) => i)
    adapter.rows.set('p', { ...adapter.rows.get('p'), points: long, version: 2 })
    const msg = store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...el('p', { kind: 'pen', shape: null, x: 4, version: 2 }), points: null, points_omitted: true, has_file: false }] })
    expect(store.getElements().get('p')).toMatchObject({ x: 4, points: [0, 0, 5, 5] })
    await msg
    expect(store.getElements().get('p').points).toHaveLength(2000)
  })

  it('a placed file gone is read again, so its tile can say so', async () => {
    const media = el('m', { kind: 'media', shape: null, file: { id: 'file-2', name: 'plate.png' } })
    const { adapter, store } = await loaded([media])
    adapter.rows.set('m', { ...adapter.rows.get('m'), file: null, missing: true, version: 2 })
    const { file, missing, updated_at, ...wire } = adapter.rows.get('m')
    await store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...wire, has_file: true, points_omitted: false }] })
    expect(store.getElements().get('m')).toMatchObject({ missing: true, file: null })
  })

  it('another person\'s drag is drawn, never saved, and ends with their save', async () => {
    const { adapter, store } = await loaded([el('a')])
    store.preview('a', { x: 15, y: 25, fill: 'no' })
    expect(store.getElements().get('a')).toMatchObject({ x: 15, y: 25 })
    expect(store.getElements().get('a').fill).toBeUndefined()
    await vi.advanceTimersByTimeAsync(500)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    store.applyRemote(theirSave(adapter, 'a', { x: 18, y: 28 }))
    expect(store.getElements().get('a')).toMatchObject({ x: 18, y: 28 })
    store.preview('a', null)
    expect(store.getElements().get('a').x).toBe(18)
  })

  it('a second load keeps the changes not yet saved', async () => {
    const { adapter, store } = await loaded([el('a'), el('b')])
    store.update('a', { x: 33 })
    adapter.rows.delete('b')
    await store.load()
    expect(store.getElements().get('a').x).toBe(33)
    expect(store.getElements().has('b')).toBe(false)
  })
})

describe('boardStore: undo and redo', () => {
  it('undo puts the earlier fields back naming the version it expects; redo does the same', async () => {
    const { adapter, store } = await loaded([el('a', { x: 1 })])
    store.update('a', { x: 2 })
    await store.flush()
    expect(store.canUndo()).toBe(true)
    await store.undo()
    expect(store.getElements().get('a').x).toBe(1)
    expect(adapter.putBoardElements.mock.calls[1][1]).toEqual([{ id: 'a', kind: 'shape', x: 1, expect: 2 }])
    expect(store.canRedo()).toBe(true)
    await store.redo()
    expect(adapter.putBoardElements.mock.calls[2][1]).toEqual([{ id: 'a', kind: 'shape', x: 2, expect: 3 }])
    expect(adapter.rows.get('a')).toMatchObject({ x: 2, version: 4 })
  })

  it('an undo over someone else\'s change is skipped, said, and drawn as they left it', async () => {
    const { adapter, store, notices } = await loaded([el('a', { x: 1 })])
    store.update('a', { x: 2 })
    await store.flush()
    store.applyRemote(theirSave(adapter, 'a', { x: 77 }))
    await store.undo()
    expect(notices()).toEqual([BOARD_WORDS.conflictOne])
    expect(store.getElements().get('a')).toMatchObject({ x: 77, version: 3 })
    expect(store.canRedo()).toBe(false)
  })

  it('an undo before the save went out still expects the version it was made over', async () => {
    const { adapter, store } = await loaded([el('a', { x: 1, version: 5 })])
    store.update('a', { x: 2 })
    await tick()
    await store.undo()
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    expect(adapter.putBoardElements.mock.calls[0][1]).toEqual([{ id: 'a', kind: 'shape', x: 1, expect: 5 }])
  })

  it('a change made just after someone else\'s, undone at once, is not taken for a clash', async () => {
    const { adapter, store, notices } = await loaded([el('a', { x: 1 })])
    store.update('a', { x: 2 })
    await store.flush()
    store.applyRemote(theirSave(adapter, 'a', { y: 50 }))
    store.update('a', { x: 3 })
    await tick()
    await store.undo()
    expect(notices()).toEqual([])
    expect(adapter.putBoardElements.mock.calls[1][1]).toEqual([{ id: 'a', kind: 'shape', x: 2, expect: 3 }])
    expect(adapter.rows.get('a')).toMatchObject({ x: 2, y: 50 })
  })

  it('the changes of one moment are one step', async () => {
    const { store } = await loaded([el('a'), el('b')])
    store.update('a', { x: 10 })
    store.update('b', { x: 20 })
    await tick()
    store.update('a', { y: 5 })
    await store.flush()
    await store.undo()
    expect(store.getElements().get('a')).toMatchObject({ x: 10, y: 0 })
    await store.undo()
    expect(store.getElements().get('a').x).toBe(0)
    expect(store.getElements().get('b').x).toBe(0)
    expect(store.canUndo()).toBe(false)
  })

  it('undo of an add removes it with its version; redo brings it back', async () => {
    const { adapter, store } = await loaded([])
    const id = store.add({ kind: 'shape', shape: 'star', w: 40, h: 40 })
    await store.flush()
    await store.undo()
    expect(store.getElements().has(id)).toBe(false)
    expect(adapter.deleteBoardElements).toHaveBeenCalledWith(BOARD, [id], [1])
    await store.redo()
    expect(store.getElements().get(id)).toMatchObject({ shape: 'star', version: 1 })
    expect(adapter.putBoardElements.mock.calls[1][1][0]).toMatchObject({ id, kind: 'shape', shape: 'star', expect: 0 })
  })

  it('an add undone before it was saved never reaches the server', async () => {
    const { adapter, store } = await loaded([])
    store.add({ kind: 'shape', shape: 'oval' })
    await tick()
    await store.undo()
    await vi.advanceTimersByTimeAsync(500)
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    expect(adapter.deleteBoardElements).not.toHaveBeenCalled()
    expect(store.getElements().size).toBe(0)
  })

  it('a removal is sent without versions; its undo brings the element back as it was', async () => {
    const { adapter, store } = await loaded([el('a', { x: 12, style: { fill: '#9fd3ff' } })])
    store.remove(['a'])
    expect(store.getElements().has('a')).toBe(false)
    await store.flush()
    expect(adapter.deleteBoardElements).toHaveBeenCalledWith(BOARD, ['a'], null)
    await store.undo()
    const sent = adapter.putBoardElements.mock.calls[0][1][0]
    expect(sent).toMatchObject({ id: 'a', kind: 'shape', x: 12, style: { fill: '#9fd3ff' }, expect: 0 })
    expect(store.getElements().get('a')).toMatchObject({ x: 12, version: 1 })
  })

  it('a removal undone before it went out is never sent', async () => {
    const { adapter, store } = await loaded([el('a', { x: 12 })])
    store.remove('a')
    await tick()
    await store.undo()
    expect(adapter.deleteBoardElements).not.toHaveBeenCalled()
    expect(store.getElements().get('a').x).toBe(12)
  })

  it('a new change clears what could be redone', async () => {
    const { store } = await loaded([el('a')])
    store.update('a', { x: 1 })
    await store.flush()
    await store.undo()
    expect(store.canRedo()).toBe(true)
    store.update('a', { y: 1 })
    expect(store.canRedo()).toBe(false)
  })
})

describe('boardStore: the server\'s answers', () => {
  it('an id the server gave in place of ours is followed everywhere', async () => {
    const { adapter, store, events } = await loaded([])
    const real = adapter.putBoardElements.getMockImplementation()
    const box = store.add({ kind: 'shape', shape: 'hexagon' })
    const line = store.add({ kind: 'connector', from_id: box })
    adapter.putBoardElements.mockImplementationOnce(async (b, list) => {
      const answer = await real(b, list)
      const row = adapter.rows.get(box)
      adapter.rows.delete(box)
      adapter.rows.set('server-made', { ...row, id: 'server-made' })
      return { ...answer, saved: answer.saved.map((s) => (s.id === box ? { id: 'server-made', version: 1, asked: box } : s)) }
    })
    await store.flush()
    expect(events).toContainEqual({ type: 'renamed', from: box, to: 'server-made' })
    expect(store.getElements().has(box)).toBe(false)
    expect(store.getElements().get('server-made')).toMatchObject({ shape: 'hexagon', version: 1 })
    expect(store.getElements().get(line).from_id).toBe('server-made')
    expect(adapter.putBoardElements.mock.calls[1][1]).toEqual([{ id: line, kind: 'connector', from_id: 'server-made' }])
    await store.undo()
    expect(adapter.deleteBoardElements.mock.calls[0][1]).toEqual(expect.arrayContaining(['server-made', line]))
  })

  it('a refusal is said in the server\'s words, and the drawing matches the server again', async () => {
    const { adapter, store, notices } = await loaded([el('a', { x: 1 })])
    adapter.putBoardElements.mockRejectedValueOnce(Object.assign(new Error('[supabase] That style is not one a board knows.'), { code: '22023' }))
    store.update('a', { x: 2, style: { glitter: 'yes' } })
    const ghost = store.add({ kind: 'shape', shape: 'cloud' })
    await store.flush()
    expect(notices()).toEqual(['That style is not one a board knows.'])
    expect(adapter.readBoardElements).toHaveBeenCalled()
    expect(store.getElements().get('a').x).toBe(1)
    expect(store.getElements().has(ghost)).toBe(false)
  })

  it('a save that never reached the server is kept, said once, and tried again', async () => {
    const { adapter, store, notices } = await loaded([el('a')])
    adapter.putBoardElements.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    store.update('a', { x: 8 })
    await store.flush()
    expect(notices()).toEqual([BOARD_WORDS.notSaved])
    expect(store.getElements().get('a').x).toBe(8)
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(2)
    expect(adapter.rows.get('a').x).toBe(8)
  })

  it('a change to something removed meanwhile does not bring it back', async () => {
    const { adapter, store } = await loaded([el('a', { version: 4 })])
    adapter.rows.delete('a')
    store.update('a', { x: 5 })
    await store.flush()
    expect(adapter.deleteBoardElements).toHaveBeenCalledWith(BOARD, ['a'], [1])
    expect(adapter.rows.has('a')).toBe(false)
    expect(store.getElements().has('a')).toBe(false)
    store.applyRemote({ board: BOARD, op: 'put', elements: [{ ...el('a', { version: 1, x: 5 }), has_file: false }] })
    expect(store.getElements().has('a')).toBe(false)
  })

  it('a removal over someone else\'s change in an undo is skipped and said', async () => {
    const { adapter, store, notices } = await loaded([])
    const id = store.add({ kind: 'shape', shape: 'circle' })
    await store.flush()
    store.applyRemote(theirSave(adapter, id, { x: 60 }))
    await store.undo()
    expect(adapter.deleteBoardElements).toHaveBeenCalledWith(BOARD, [id], [1])
    expect(notices()).toEqual([BOARD_WORDS.conflictOne])
    expect(store.getElements().get(id)).toMatchObject({ x: 60, version: 2 })
  })

  it('dispose saves what is waiting and says nothing more', async () => {
    const { adapter, store, events } = await loaded([el('a')])
    store.update('a', { x: 4 })
    const count = events.length
    await store.dispose()
    expect(adapter.rows.get('a').x).toBe(4)
    expect(events.length).toBe(count)
    expect(store.add({ kind: 'shape' })).toBeNull()
  })

  it('🚨 dispose({ save: false }) drops what is waiting and its timer: the adapter is asked nothing', async () => {
    const { adapter, store, events } = await loaded([el('a'), el('b')])
    store.update('a', { x: 4 })
    store.remove(['b'])
    const count = events.length
    await store.dispose({ save: false })
    await vi.runAllTimersAsync()
    await store.flush()
    expect(adapter.putBoardElements).not.toHaveBeenCalled()
    expect(adapter.deleteBoardElements).not.toHaveBeenCalled()
    expect(adapter.rows.get('a').x).toBe(0)
    expect(adapter.rows.has('b')).toBe(true)
    expect(events.length).toBe(count)
    expect(store.add({ kind: 'shape' })).toBeNull()
  })

  it('🚨 dispose({ save: false }) with a save on its way: what that round would send next stays unsent', async () => {
    const { adapter, store } = await loaded([el('a'), el('b')])
    const answer = adapter.putBoardElements.getMockImplementation()
    let release = null
    adapter.putBoardElements.mockImplementationOnce((...args) => new Promise((r) => { release = () => r(answer(...args)) }))
    store.update('a', { x: 4 })
    store.remove(['b'])
    const saving = store.flush()
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    const closed = store.dispose({ save: false })
    release()
    await saving
    await closed
    await vi.runAllTimersAsync()
    expect(adapter.putBoardElements).toHaveBeenCalledTimes(1)
    expect(adapter.deleteBoardElements).not.toHaveBeenCalled()
    expect(adapter.readBoardElements).not.toHaveBeenCalled()
    expect(adapter.rows.has('b')).toBe(true)
  })
})

describe('boardStore: words', () => {
  it('a refusal\'s words, without the adapter\'s tag; a P0001\'s detail', () => {
    expect(wordsOf(new Error('[supabase] A board holds at most 5,000 elements.'))).toBe('A board holds at most 5,000 elements.')
    expect(wordsOf({ code: 'P0001', message: 'sticky_turn_ended', details: 'Your turn ended.' })).toBe('Your turn ended.')
    expect(wordsOf({}, 'fallback')).toBe('fallback')
  })

  it('a refusal has the server\'s code; a lost connection has none', () => {
    expect(isRefusal({ code: '42501' })).toBe(true)
    expect(isRefusal({ code: 'boards_absent' })).toBe(true)
    expect(isRefusal(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRefusal({ code: 'network' })).toBe(false)
  })
})
