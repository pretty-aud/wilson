// boardsFixtures.test.js — MO4 (0130 to 0133): the fake cloud keeps boards as the database does, refuses what it
// refuses in its words and with its codes, and carries a board's two channels on an in-process bus, so two fixture
// people on one store see each other's changes, cursors, presence and sticky turns.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDevFixtures } from './install'
import { createRabbitFixturesAdapter } from './rabbitFixturesAdapter'
import { BACKGROUND_WORDS, BOARD_WORDS, FIXTURE_FILE_GONE } from './boardsFixtures'
import { PROJECT_ID } from './data/project'
import { MEMBER_ID, WORKSPACE_ID } from './data/workspace'

const W = BOARD_WORDS
const flush = () => new Promise(r => setTimeout(r, 0))
const refusal = (code, message) => expect.objectContaining({ code, message })
const uuid = () => crypto.randomUUID()

// One store, two (or three) people on it: Mara (admin), Theo (manager) and Dev (a reviewer's seat: reads, never writes).
function company() {
  const fx = buildDevFixtures()
  const store = fx.store
  const as = (userId, appRole) => createRabbitFixturesAdapter(store, { userId, workspaceId: WORKSPACE_ID, appRole })
  return { fx, store, mara: fx.rabbitAdapter(), theo: as(MEMBER_ID.theo, 'manager'), dev: as(MEMBER_ID.dev, 'user') }
}
const rootOf = (store, projectId = PROJECT_ID) => store.folders.find(f => f.project_id === projectId && f.kind === 'root')
// A file Moth shows: no money, no Legal, no receipt, in a folder of its own.
const plainFile = (store) => store.files.find(f => f.project_id === PROJECT_ID && !f.deleted_at && !f.is_financial
  && !(f.tags || []).includes('legal') && f.folder_id && !store.expenses.some(e => (e.file_ids || []).includes(f.id)))
async function newBoard(a, title = 'Lookbook', parent = null) {
  const made = await a.createBoard(PROJECT_ID, parent, title)
  const { board } = await a.readBoard(made.board_id)
  return { made, board }
}
// A channel's ears: every message it is handed, by handler.
function ears() {
  const heard = { elements: [], sticky: [], board: [], audience: [], live: [], presence: [], status: [] }
  return {
    heard,
    handlers: {
      onElements: (p) => heard.elements.push(p),
      onSticky: (p) => heard.sticky.push(p),
      onBoard: (p) => heard.board.push(p),
      onAudience: (p) => heard.audience.push(p),
      onLive: (event, p) => heard.live.push({ event, p }),
      onPresence: (people) => heard.presence.push(people),
      onStatus: (s) => heard.status.push(s),
    },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('a board is made as board_create makes it', () => {
  it('a custom folder under the project\'s top folder, named and pathed; a second of that name is -2', async () => {
    const { store, mara } = company()
    const made = await mara.createBoard(PROJECT_ID, null, '  Look book  ')
    expect(made).toEqual({ board_id: expect.any(String), folder_id: expect.any(String), project_id: PROJECT_ID, title: 'Look book', path: 'look-book' })
    const folder = store.folders.find(f => f.id === made.folder_id)
    expect(folder).toMatchObject({ kind: 'custom', label: 'Look book', slug: 'look-book', parent_id: rootOf(store).id })
    expect((await mara.createBoard(PROJECT_ID, null, 'Look book')).path).toBe('look-book-2')
    expect((await mara.createBoard(PROJECT_ID, null, '')).title).toBe('Board')
    const listed = await mara.listBoards(PROJECT_ID)
    expect(listed).toHaveLength(3)
    expect(Object.keys(listed[0]).sort()).toEqual(['audience_gen', 'folder_id', 'id', 'project_id', 'revision'])
    const { board, elements } = await mara.readBoard(made.board_id)
    expect(board).toEqual({ id: made.board_id, folder_id: made.folder_id, project_id: PROJECT_ID, title: 'Look book', revision: 0, audience_gen: 0, can_write: true, background: 'dots', background_version: 0 })
    expect(elements).toEqual([])
  })

  it('refuses what board_create refuses, in its words', async () => {
    const { store, mara, dev } = company()
    await expect(mara.createBoard(PROJECT_ID, null, 'x'.repeat(121))).rejects.toEqual(refusal('22023', W.nameLength))
    const entity = store.folders.find(f => f.project_id === PROJECT_ID && f.kind === 'entity')
    await expect(mara.createBoard(PROJECT_ID, entity.id, 'Inside')).rejects.toEqual(refusal('22023', W.entityChain))
    await expect(mara.createBoard(PROJECT_ID, null, 'Invoices')).rejects.toEqual(refusal('22023', W.keptName))
    await expect(mara.createBoard(PROJECT_ID, 'f1c70000-000a-4000-8000-999999999999', 'Nowhere')).rejects.toEqual(refusal('42501', W.folderNotWritable))
    await expect(dev.createBoard(PROJECT_ID, null, 'Mine')).rejects.toEqual(refusal('42501', W.folderNotWritable))
    // CONTROL: Dev reads a board he may not change.
    const { made } = await newBoard(mara)
    expect((await dev.readBoard(made.board_id)).board.can_write).toBe(false)
  })
})

describe('elements are saved as board_put_elements saves them', () => {
  it('a new element is version 1, a change counts one more and keeps what it did not name; read in stacking order', async () => {
    const { mara } = company()
    const { board } = await newBoard(mara)
    const a = uuid()
    const b = uuid()
    const first = await mara.putBoardElements(board.id, [
      { id: a, kind: 'shape', shape: 'star', x: 10, y: 20, w: 100, h: 80, z: 2, style: { fill: '#ffcc00' } },
      { id: b, kind: 'text', body: 'Harbour light', x: 0, y: 0, w: 200, h: 40, z: 1 },
    ])
    expect(first).toEqual({ saved: [{ id: a, version: 1 }, { id: b, version: 1 }], conflicts: [] })
    const second = await mara.putBoardElements(board.id, [{ id: a, x: 50 }])
    expect(second.saved).toEqual([{ id: a, version: 2 }])
    const { board: after, elements } = await mara.readBoard(board.id)
    expect(after.revision).toBe(2)
    expect(elements.map(e => e.id)).toEqual([b, a])
    expect(elements[1]).toMatchObject({ x: 50, y: 20, shape: 'star', style: { fill: '#ffcc00' }, version: 2, file: null, missing: false, updated_by: MEMBER_ID.mara })
  })

  it('expect: an undo saves only over the version it names; a removal\'s undo only where nobody made one since', async () => {
    const { mara } = company()
    const { board } = await newBoard(mara)
    const a = uuid()
    await mara.putBoardElements(board.id, [{ id: a, kind: 'frame', w: 300, h: 200 }])
    await mara.putBoardElements(board.id, [{ id: a, x: 5 }])
    expect(await mara.putBoardElements(board.id, [{ id: a, x: 0, expect: 1 }])).toEqual({ saved: [], conflicts: [{ id: a, version: 2 }] })
    expect((await mara.putBoardElements(board.id, [{ id: a, x: 0, expect: 2 }])).saved).toEqual([{ id: a, version: 3 }])
    const gone = uuid()
    expect(await mara.putBoardElements(board.id, [{ id: gone, kind: 'frame', expect: 4 }])).toEqual({ saved: [], conflicts: [{ id: gone, version: null }] })
    expect((await mara.putBoardElements(board.id, [{ id: gone, kind: 'frame', expect: 0 }])).saved).toEqual([{ id: gone, version: 1 }])
  })

  it('an id another board holds is made under a new id, said beside the one asked for', async () => {
    const { mara } = company()
    const one = (await newBoard(mara, 'One')).board
    const two = (await newBoard(mara, 'Two')).board
    const id = uuid()
    await mara.putBoardElements(one.id, [{ id, kind: 'frame' }])
    const out = await mara.putBoardElements(two.id, [{ id, kind: 'frame' }])
    expect(out.saved).toEqual([{ id: expect.any(String), version: 1, asked: id }])
    expect(out.saved[0].id).not.toBe(id)
  })

  it('what a client sends of an element: a placed file by its id, connectors after their ends, nothing only the server writes', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    const embedded = plainFile(store)
    const shape = uuid()
    const pic = uuid()
    const line = uuid()
    const out = await mara.putBoardElements(board.id, [
      { id: line, kind: 'connector', from_id: shape, from_anchor: 'right', to_id: pic, to_anchor: 'auto', style: { route: 'elbow', end_head: 'arrow' } },
      { id: shape, kind: 'shape', shape: 'diamond', version: 9, updated_by: 'someone', missing: false },
      { id: pic, kind: 'embed', file: { id: embedded.id, name: embedded.name } },
    ])
    expect(out.saved.map(s => s.id)).toEqual([shape, pic, line])
    const { elements } = await mara.readBoard(board.id)
    const byId = new Map(elements.map(e => [e.id, e]))
    expect(byId.get(pic).file).toMatchObject({ id: embedded.id, name: embedded.name, project_id: PROJECT_ID })
    expect(byId.get(line)).toMatchObject({ from_id: shape, to_id: pic, version: 1 })
    expect(byId.get(shape).version).toBe(1)
  })

  it('refuses what the guard, the CHECKs and the keys refuse, in their words, and a refused save writes nothing', async () => {
    const { store, mara, dev } = company()
    const { board } = await newBoard(mara)
    const put = (els) => mara.putBoardElements(board.id, els)
    await expect(put([{ kind: 'shape', shape: 'star', style: { fill: 'red' } }])).rejects.toEqual(refusal('22023', W.style))
    await expect(put([{ kind: 'shape', shape: 'star', style: { route: 'elbow' } }])).rejects.toEqual(refusal('22023', W.style))
    await expect(put([{ kind: 'pen', points: [1, 2, 3] }])).rejects.toEqual(refusal('22023', W.points))
    await expect(put([{ kind: 'pen' }])).rejects.toEqual(refusal('22023', W.points))
    await expect(put([{ kind: 'media' }])).rejects.toEqual(refusal('22023', W.needsFile))
    await expect(put([{ kind: 'shape', shape: 'blob' }])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('board_elements_shape_chk') })
    await expect(put([{ kind: 'shape' }])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('board_elements_shape_chk') })
    await expect(put([{ kind: 'scribble' }])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('board_elements_kind_chk') })
    await expect(put([{ kind: 'frame', w: -1 }])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('board_elements_geometry_chk') })
    await expect(put([{ kind: 'frame', from_id: uuid() }])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('board_elements_ends_kind_chk') })
    await expect(put([{ kind: 'connector', to_id: uuid() }])).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('board_elements_to_fk') })
    await expect(put(['not an element'])).rejects.toEqual(refusal('22023', W.notObject))
    const money = store.files.find(f => f.project_id === PROJECT_ID && f.is_financial)
    await expect(put([{ kind: 'embed', file_id: money.id }])).rejects.toEqual(refusal('42501', W.fileNotFound))
    await expect(dev.putBoardElements(board.id, [{ kind: 'frame' }])).rejects.toEqual(refusal('42501', W.boardNotWritable))
    // The whole save is one statement: a good element before a refused one is not kept.
    const good = uuid()
    await expect(put([{ id: good, kind: 'frame' }, { kind: 'pen', points: [] }])).rejects.toEqual(refusal('22023', W.points))
    const { board: after, elements } = await mara.readBoard(board.id)
    expect(elements).toEqual([])
    expect(after.revision).toBe(0)
  })

  it('a sticky is a markdown note in the board\'s own folder, once, and its words are its file\'s', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    const elsewhere = plainFile(store)
    const note = { ...elsewhere, id: 'f1c70000-0009-4000-8000-000000000777', folder_id: board.folder_id, name: 'Plan.md', mime_type: 'text/markdown' }
    const picture = { ...elsewhere, id: 'f1c70000-0009-4000-8000-000000000778', folder_id: board.folder_id, name: 'Still.png', mime_type: 'image/png' }
    store.files.push(note, picture)
    const put = (els) => mara.putBoardElements(board.id, els)
    await expect(put([{ kind: 'sticky', file_id: elsewhere.id }])).rejects.toEqual(refusal('22023', W.ownFolder))
    await expect(put([{ kind: 'media', file_id: elsewhere.id }])).rejects.toEqual(refusal('22023', W.ownFolder))
    await expect(put([{ kind: 'sticky', file_id: picture.id }])).rejects.toEqual(refusal('22023', W.markdown))
    await expect(put([{ kind: 'sticky', file_id: note.id, body: 'words' }])).rejects.toEqual(refusal('22023', W.stickyWords))
    const id = uuid()
    expect((await put([{ id, kind: 'sticky', file_id: note.id }])).saved).toEqual([{ id, version: 1 }])
    await expect(put([{ kind: 'sticky', file_id: note.id }])).rejects.toEqual(refusal('23505', W.oneSticky))
    await expect(put([{ id, body: 'words' }])).rejects.toEqual(refusal('22023', W.stickyWords))
    // A placed file that goes is the stop-sign tile: no file, no name, only that it is missing.
    store.files.splice(store.files.indexOf(note), 1)
    const [tile] = await mara.readBoardElements(board.id, [id])
    expect(tile).toMatchObject({ id, kind: 'sticky', file: null, missing: true })
  })

  it('a board holds at most 5,000 elements, read back whole across the server\'s pages of 2,000', async () => {
    const { mara } = company()
    const { board } = await newBoard(mara)
    const els = Array.from({ length: 5000 }, (_, i) => ({ id: uuid(), kind: 'frame', z: i % 7 }))
    const out = await mara.putBoardElements(board.id, els)
    expect(out.saved).toHaveLength(5000)
    await expect(mara.putBoardElements(board.id, [{ kind: 'frame' }])).rejects.toEqual(refusal('54000', W.boardCount))
    const { elements } = await mara.readBoard(board.id)
    expect(elements).toHaveLength(5000)
    const keys = elements.map(e => `${e.z}|${e.id}`)
    expect(keys).toEqual([...keys].sort((a, b) => (Number(a.split('|')[0]) - Number(b.split('|')[0])) || (a < b ? -1 : a > b ? 1 : 0)))
    expect(new Set(elements.map(e => e.id)).size).toBe(5000)
  }, 30000)

  it('chosen elements are read 50 a call, as board_read_elements answers them', async () => {
    const { mara } = company()
    const { board } = await newBoard(mara)
    const ids = Array.from({ length: 120 }, () => uuid())
    await mara.putBoardElements(board.id, ids.map((id, i) => ({ id, kind: 'frame', z: 120 - i })))
    const got = await mara.readBoardElements(board.id, [...ids, ids[0], uuid()])
    expect(got).toHaveLength(120)
    expect(got[0].id).toBe(ids[119])
    expect(await mara.readBoardElements(board.id, [])).toEqual([])
    await expect(mara.readBoardElements(board.id, ['nope'])).rejects.toMatchObject({ code: '22P02' })
  })
})

describe('removal, as board_delete_elements removes', () => {
  it('a version that moved is a conflict; a removed end frees the connector\'s end, counted a version, and both are said', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const a = uuid()
    const b = uuid()
    const line = uuid()
    await mara.putBoardElements(board.id, [{ id: a, kind: 'frame' }, { id: b, kind: 'frame' }, { id: line, kind: 'connector', from_id: a, to_id: b }])
    const names = await theo.boardChannels(board.id)
    const { heard, handlers } = ears()
    const ch = theo.openBoardChannels(names, handlers)
    await flush()
    expect(await mara.deleteBoardElements(board.id, [a], [7])).toEqual({ removed: [], conflicts: [{ id: a, version: 1 }] })
    expect(await mara.deleteBoardElements(board.id, [a, a], [1, 1])).toEqual({ removed: [a], conflicts: [] })
    await flush()
    const { elements } = await mara.readBoard(board.id)
    expect(elements.find(e => e.id === line)).toMatchObject({ from_id: null, to_id: b, version: 2 })
    expect(heard.elements).toEqual([
      { board: board.id, op: 'remove', ids: [a] },
      { board: board.id, op: 'put', elements: [expect.objectContaining({ id: line, from_id: null, version: 2 })] },
    ])
    await expect(mara.deleteBoardElements(board.id, [b], [])).rejects.toEqual(refusal('22023', W.removeShape))
    expect(await mara.deleteBoardElements(board.id, [])).toEqual({ removed: [], conflicts: [] })
    ch.leave()
  })
})

describe('the board\'s channels on the page\'s bus', () => {
  it('a save is heard by everyone on the board, as 0132 says it: wire elements, no file, nothing long past 4 KB', async () => {
    const { store, mara, theo } = company()
    const { board } = await newBoard(mara)
    const names = await mara.boardChannels(board.id)
    expect(names).toEqual({
      topic: `moth:board:${board.id}:0.0`, live_topic: `moth:board-live:${board.id}:0.0`, audience_gen: 0,
    })
    const m = ears()
    const t = ears()
    const mc = mara.openBoardChannels(names, m.handlers)
    const tc = theo.openBoardChannels(await theo.boardChannels(board.id), t.handlers)
    await flush()
    expect(t.heard.status).toEqual([{ channel: 'topic', status: 'SUBSCRIBED' }, { channel: 'live', status: 'SUBSCRIBED' }])
    const note = plainFile(store)
    store.files.push({ ...note, id: 'f1c70000-0009-4000-8000-000000000779', folder_id: board.folder_id, name: 'Idea.md', mime_type: 'text/markdown' })
    const long = Array.from({ length: 1200 }, (_, i) => i)
    const pen = uuid()
    const sticky = uuid()
    await mara.putBoardElements(board.id, [{ id: pen, kind: 'pen', points: long }, { id: sticky, kind: 'sticky', file_id: 'f1c70000-0009-4000-8000-000000000779' }])
    await flush()
    expect(t.heard.elements).toHaveLength(1)
    expect(m.heard.elements).toHaveLength(1)
    const sent = new Map(t.heard.elements[0].elements.map(e => [e.id, e]))
    expect(sent.get(pen)).toMatchObject({ kind: 'pen', points: null, body: null, points_omitted: true, has_file: false, version: 1 })
    expect(sent.get(sticky)).toMatchObject({ kind: 'sticky', has_file: true, points_omitted: false })
    expect('file' in sent.get(sticky)).toBe(false)
    expect('file_id' in sent.get(sticky)).toBe(false)
    // The long stroke is read whole when asked for.
    expect((await theo.readBoardElements(board.id, [pen]))[0].points).toHaveLength(1200)
    mc.leave()
    tc.leave()
  })

  it('the live channel: a broadcast reaches the others, never its sender; presence says who is here', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const names = await mara.boardChannels(board.id)
    const m = ears()
    const t = ears()
    const mc = mara.openBoardChannels(names, m.handlers)
    const tc = theo.openBoardChannels(names, t.handlers)
    expect(mc.sendLive('cursor', { x: 1, y: 2 })).toBe(false)
    await flush()
    expect(mc.sendLive('cursor', { x: 3, y: 4 })).toBe(true)
    await mc.track({ label: 'Mara', colour: '#ff8800' })
    await tc.track({ label: 'Theo', colour: '#0088ff' })
    await flush()
    expect(t.heard.live).toEqual([{ event: 'cursor', p: { x: 3, y: 4 } }])
    expect(m.heard.live).toEqual([])
    const last = (h) => h.presence[h.presence.length - 1]
    expect(last(m.heard)).toEqual([
      { key: MEMBER_ID.mara, label: 'Mara', colour: '#ff8800' },
      { key: MEMBER_ID.theo, label: 'Theo', colour: '#0088ff' },
    ])
    tc.leave()
    await flush()
    expect(last(m.heard)).toEqual([{ key: MEMBER_ID.mara, label: 'Mara', colour: '#ff8800' }])
    // A left channel hears nothing and sends nothing.
    expect(tc.sendLive('cursor', { x: 0, y: 0 })).toBe(false)
    mc.sendLive('drag', { id: 'x' })
    await flush()
    expect(t.heard.live).toHaveLength(1)
    mc.leave()
  })

  it('a board that goes to the trash says AUDIENCE once on its old names; after, the names are refused, and a new name comes back', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const names = await theo.boardChannels(board.id)
    const t = ears()
    const tc = theo.openBoardChannels(names, t.handlers)
    await flush()
    expect(await mara.trashFolders([board.folder_id])).toEqual({ batches: 1, folders: 1, files: 0 })
    await flush()
    expect(t.heard.audience).toEqual([{ board: board.id, op: 'audience' }])
    await expect(theo.boardChannels(board.id)).rejects.toEqual(refusal('42501', W.boardNotFound))
    await expect(theo.readBoard(board.id)).rejects.toEqual(refusal('42501', W.boardNotFound))
    tc.leave()
    await mara.restoreFolders([board.folder_id])
    const again = await theo.boardChannels(board.id)
    expect(again.topic).toBe(`moth:board:${board.id}:0.1`)
    const old = ears()
    const oc = theo.openBoardChannels(names, old.handlers)
    await flush()
    expect(old.heard.status).toEqual([{ channel: 'topic', status: 'CHANNEL_ERROR' }, { channel: 'live', status: 'CHANNEL_ERROR' }])
    expect(oc.sendLive('cursor', { x: 1, y: 1 })).toBe(false)
    oc.leave()
  })

  it('an AUDIENCE sent on the people\'s channel is dropped; the database\'s own is still heard once', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const names = await theo.boardChannels(board.id)
    const t = ears()
    const tc = theo.openBoardChannels(names, t.handlers)
    const mc = mara.openBoardChannels(await mara.boardChannels(board.id), ears().handlers)
    await flush()
    expect(mc.sendLive('AUDIENCE', { board: board.id, op: 'audience' })).toBe(true)
    mc.sendLive('audience', { board: board.id, op: 'audience' })
    await flush()
    expect(t.heard.audience).toEqual([])
    expect(t.heard.live).toEqual([])
    mc.leave()
    expect(await mara.trashFolders([board.folder_id])).toEqual({ batches: 1, folders: 1, files: 0 })
    await flush()
    expect(t.heard.audience).toEqual([{ board: board.id, op: 'audience' }])
    tc.leave()
  })

  it('someone who may not read the board joins nothing (a person\'s own space)', async () => {
    const { store, mara, theo } = company()
    const space = store.projects.find(p => p.personal_owner_id === MEMBER_ID.mara)
    store.folders.push({ id: 'f1c70000-000a-4000-8000-000000000900', project_id: space.id, workspace_id: WORKSPACE_ID, parent_id: null, kind: 'root', entity_type: null, slug: 'space', label: null, path: '' })
    const made = await mara.createBoard(space.id, null, 'Private thoughts')
    const names = await mara.boardChannels(made.board_id)
    await expect(theo.boardChannels(made.board_id)).rejects.toEqual(refusal('42501', W.boardNotFound))
    const t = ears()
    theo.openBoardChannels(names, t.handlers)
    await flush()
    expect(t.heard.status.map(s => s.status)).toEqual(['CHANNEL_ERROR', 'CHANNEL_ERROR'])
    expect(await theo.listBoards(space.id)).toEqual([])
  })
})

describe('a board\'s background, as board_set_background keeps it (0136)', () => {
  it('a new board is on the dotted grid; a writer changes it, everyone on the board hears one board message', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    expect(board).toMatchObject({ background: 'dots', background_version: 0 })
    const m = ears()
    const t = ears()
    const mc = mara.openBoardChannels(await mara.boardChannels(board.id), m.handlers)
    const tc = theo.openBoardChannels(await theo.boardChannels(board.id), t.handlers)
    await flush()
    expect(await mara.setBoardBackground(board.id, 'lines')).toEqual({ board_id: board.id, background: 'lines', version: 1, changed: true })
    await flush()
    expect(t.heard.board).toEqual([{ board: board.id, op: 'background', background: 'lines', version: 1 }])
    expect(m.heard.board).toHaveLength(1)
    // Not an element's change: no elements message, and the board's revision and channels' names stay.
    expect(t.heard.elements).toEqual([])
    const read = (await theo.readBoard(board.id)).board
    expect(read).toMatchObject({ background: 'lines', background_version: 1, revision: 0, audience_gen: 0 })
    // The same value again changes nothing, says nothing, and answers the version as it is.
    expect(await theo.setBoardBackground(board.id, 'lines')).toEqual({ board_id: board.id, background: 'lines', version: 1, changed: false })
    await flush()
    expect(t.heard.board).toHaveLength(1)
    expect((await mara.readBoard(board.id)).board.background_version).toBe(1)
    // The next change counts one more, in the answer, the message and the read.
    expect(await theo.setBoardBackground(board.id, 'blank')).toEqual({ board_id: board.id, background: 'blank', version: 2, changed: true })
    await flush()
    expect(m.heard.board.at(-1)).toEqual({ board: board.id, op: 'background', background: 'blank', version: 2 })
    expect((await mara.readBoard(board.id)).board).toMatchObject({ background: 'blank', background_version: 2 })
    mc.leave()
    tc.leave()
  })

  it('refuses what board_set_background refuses, in its words and codes', async () => {
    const { mara, dev } = company()
    const { board } = await newBoard(mara)
    await expect(mara.setBoardBackground(board.id, 'stripes')).rejects.toEqual(refusal('22023', BACKGROUND_WORDS))
    await expect(mara.setBoardBackground(board.id, null)).rejects.toEqual(refusal('22023', BACKGROUND_WORDS))
    // A person who may read the board but not change it, and a board that is not there, are one refusal.
    await expect(dev.setBoardBackground(board.id, 'blank')).rejects.toEqual(refusal('42501', W.boardNotWritable))
    await expect(mara.setBoardBackground(uuid(), 'blank')).rejects.toEqual(refusal('42501', W.boardNotWritable))
    // Not writable is said before a bad value.
    await expect(dev.setBoardBackground(board.id, 'stripes')).rejects.toEqual(refusal('42501', W.boardNotWritable))
    expect((await dev.readBoard(board.id)).board.background).toBe('dots')
  })

  it('its words are the design\'s, and 0136\'s own once that file is here', () => {
    expect(BACKGROUND_WORDS).toBe('A board\'s background is dotted, blank or lined.')
    const file = join(__dirname, '../../../supabase/migrations', '0136_board_background.sql')
    if (existsSync(file)) expect(readFileSync(file, 'utf8')).toContain(`'${BACKGROUND_WORDS.replace(/'/g, "''")}'`)
  })
})

describe('a sticky\'s turn and its words (0133)', () => {
  const SESSION_M = 'mara-window-1'
  const SESSION_T = 'theo-window-1'

  it('a new sticky is a note in the board\'s folder, named from its first line, placed, and read back', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    const el = await mara.createSticky(board, '# Harbour light\nWarm after four.', { x: 40, y: 60, z: 3 })
    expect(el).toMatchObject({ kind: 'sticky', x: 40, y: 60, w: 200, h: 200, z: 3, body: null, missing: false, version: 1 })
    expect(el.file).toMatchObject({ name: 'Harbour light.md', mime_type: 'text/markdown', folder_id: board.folder_id })
    expect(store.files.find(f => f.id === el.file.id).folder_id).toBe(board.folder_id)
    expect(await mara.readStickyText(el.file)).toBe('# Harbour light\nWarm after four.')
    expect((await mara.createSticky(board, '')).file.name).toBe('Sticky note.md')
  })

  it('one holder at a time: the others see who, for how long; the holder renews, saves and lets go, and the board hears each', async () => {
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const el = await mara.createSticky(board, 'First words')
    const t = ears()
    const tc = theo.openBoardChannels(await theo.boardChannels(board.id), t.handlers)
    await flush()
    const claim = await mara.claimSticky(el.id, SESSION_M)
    expect(claim).toEqual({ granted: true, generation: expect.any(Number), ends_in_ms: 30000 })
    expect(await mara.claimSticky(el.id, SESSION_M)).toEqual({ granted: true, generation: claim.generation, ends_in_ms: 30000 })
    const denied = await theo.claimSticky(el.id, SESSION_T)
    expect(denied).toMatchObject({ granted: false, holder_label: 'Mara Okonkwo' })
    expect(denied.ends_in_ms).toBeGreaterThan(29000)
    expect(await theo.stickyStatus(board.id)).toEqual([{ element: el.id, holder_label: 'Mara Okonkwo', mine: false, ends_in_ms: expect.any(Number) }])
    expect((await mara.stickyStatus(board.id))[0].mine).toBe(true)
    expect(await mara.renewSticky(el.id, claim.generation)).toEqual({ ok: true, ends_in_ms: 30000 })
    expect(await theo.renewSticky(el.id, claim.generation)).toEqual({ ok: false, ends_in_ms: 0 })
    expect(await theo.readStickyText(el.file)).toBe('First words')
    await mara.readStickyText(el.file)
    expect(await mara.saveStickyText(el, claim.generation, 'Second words')).toEqual({ ok: true })
    expect(await theo.releaseSticky(el.id, claim.generation)).toBe(false)
    expect(await mara.releaseSticky(el.id, claim.generation)).toBe(true)
    await flush()
    expect(t.heard.sticky.map(s => s.op)).toEqual(['lock', 'renew', 'body', 'unlock'])
    expect(t.heard.sticky[0]).toEqual({ op: 'lock', element: el.id, holder_label: 'Mara Okonkwo', ends_in_ms: 30000, board: board.id })
    // Theo read the first words: his save over them is "moved", and nothing is lost; read again, it saves.
    const his = await theo.claimSticky(el.id, SESSION_T)
    expect(his.granted).toBe(true)
    expect(await theo.saveStickyText(el, his.generation, 'Theo\'s words')).toEqual({ ok: false, reason: 'moved', words: expect.any(String) })
    expect(await theo.readStickyText(el.file)).toBe('Second words')
    expect(await theo.saveStickyText(el, his.generation, 'Theo\'s words')).toEqual({ ok: true })
    expect(await mara.readStickyText(el.file)).toBe('Theo\'s words')
    tc.leave()
  })

  it('a turn runs out on its own after 30 seconds: the late save keeps nothing and says so; another may then claim', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'))
    const { mara, theo } = company()
    const { board } = await newBoard(mara)
    const el = await mara.createSticky(board, 'Words')
    const claim = await mara.claimSticky(el.id, SESSION_M)
    await mara.readStickyText(el.file)
    vi.setSystemTime(new Date('2026-11-11T10:00:31Z'))
    expect(await theo.stickyStatus(board.id)).toEqual([])
    expect(await mara.saveStickyText(el, claim.generation, 'Late')).toEqual({ ok: false, reason: 'turn_ended', words: W.turnEnded })
    expect(await mara.renewSticky(el.id, claim.generation)).toEqual({ ok: false, ends_in_ms: 0 })
    const his = await theo.claimSticky(el.id, SESSION_T)
    expect(his.granted).toBe(true)
    expect(his.generation).toBeGreaterThan(claim.generation)
    expect(await mara.readStickyText(el.file)).toBe('Words')
  })

  it('refuses a window name it does not know, a sticky the caller may not change, and a note that left its board', async () => {
    const { store, mara, dev } = company()
    const { board } = await newBoard(mara)
    const el = await mara.createSticky(board, 'Words')
    await expect(mara.claimSticky(el.id, 'short')).rejects.toEqual(refusal('22023', W.window))
    await expect(dev.claimSticky(el.id, 'dev-window-1')).rejects.toEqual(refusal('42501', W.stickyNotWritable))
    await expect(mara.claimSticky(uuid(), 'mara-window-1')).rejects.toEqual(refusal('42501', W.stickyNotWritable))
    const claim = await mara.claimSticky(el.id, 'mara-window-1')
    await mara.readStickyText(el.file)
    store.files.find(f => f.id === el.file.id).folder_id = rootOf(store).id
    await expect(mara.saveStickyText(el, claim.generation, 'x')).rejects.toEqual(refusal('22023', W.leftBoard))
    store.files.find(f => f.id === el.file.id).storage_provider = 's3'
    await expect(mara.saveStickyText(el, claim.generation, 'x')).rejects.toEqual(refusal('s3_sticky_off', W.s3Off))
  })
})

describe('a placed file: a dropped file, an embed, and its address', () => {
  const picture = (name = 'Harbour light.png', type = 'image/png') => new File(['not really a picture'], name, { type })

  it('createMedia files the drop in the board\'s own folder, so Files and Moth show it, and places it as a medium', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    const el = await mara.createMedia(board, picture(), { x: 40, y: 60, w: 300, h: 200, z: 2 })
    expect(el).toMatchObject({ kind: 'media', x: 40, y: 60, w: 300, h: 200, z: 2, rotation: 0, missing: false, version: 1, body: null })
    expect(el.file).toEqual({ id: expect.any(String), name: 'Harbour light.png', mime_type: 'image/png', folder_id: board.folder_id, project_id: PROJECT_ID })
    const row = store.files.find(f => f.id === el.file.id)
    expect(row).toMatchObject({ folder_id: board.folder_id, size_bytes: 20, deleted_at: null, created_by: MEMBER_ID.mara })
    expect((await mara.listFiles(PROJECT_ID)).map(f => f.id)).toContain(row.id)
    expect((await mara.listMothFiles(PROJECT_ID, null, 1000)).map(f => f.id)).toContain(row.id)
    // Read back as board_read gives it, and nothing said is 240 by 180.
    const { elements } = await mara.readBoard(board.id)
    expect(elements.find(e => e.id === el.id)).toEqual(el)
    expect(await mara.createMedia(board, picture('clip.mp4', 'video/mp4'))).toMatchObject({ w: 240, h: 180, x: 0, y: 0 })
  })

  it('a placement the board refuses takes the new file to the trash; nothing is filed for a reader or without a file', async () => {
    const { store, mara, dev } = company()
    const { board } = await newBoard(mara)
    const before = store.files.length
    await expect(mara.createMedia(board, picture(), { style: { glitter: true } })).rejects.toEqual(refusal('22023', W.style))
    const made = store.files.slice(before)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ deleted_by: MEMBER_ID.mara, deleted_at: expect.any(String) })
    expect((await mara.listMothFiles(PROJECT_ID, null, 1000)).map(f => f.id)).not.toContain(made[0].id)
    expect((await mara.readBoard(board.id)).elements).toEqual([])
    await expect(dev.createMedia(board, picture())).rejects.toEqual(refusal('42501', W.boardNotWritable))
    await expect(mara.createMedia(board, null)).rejects.toEqual(refusal('22023', W.needsFile))
    await expect(mara.createMedia({ id: uuid() }, picture())).rejects.toEqual(refusal('42501', W.boardNotWritable))
    expect(store.files.length).toBe(before + 1)
  })

  it('embedFile places a reference to a file where it is: no new file, the file\'s own folder kept', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    const doc = plainFile(store)
    const before = store.files.length
    const el = await mara.embedFile(board, doc.id, { x: 5, y: 6, z: 1 })
    expect(el).toMatchObject({ kind: 'embed', x: 5, y: 6, w: 240, h: 180, missing: false })
    expect(el.file).toMatchObject({ id: doc.id, name: doc.name, folder_id: doc.folder_id, project_id: PROJECT_ID })
    expect(store.files.length).toBe(before)
    expect(store.files.find(f => f.id === doc.id).folder_id).toBe(doc.folder_id)
    // The same file twice is two embeds (unlike a sticky's note).
    expect((await mara.embedFile(board, { id: doc.id })).id).not.toBe(el.id)
  })

  it('an embed refuses what board_put_elements refuses: a file the writer may not read, no file, a reader', async () => {
    const { store, mara, dev } = company()
    const { board } = await newBoard(mara)
    const money = store.files.find(f => f.project_id === PROJECT_ID && f.is_financial)
    await expect(mara.embedFile(board, money.id)).rejects.toEqual(refusal('42501', W.fileNotFound))
    await expect(mara.embedFile(board, uuid())).rejects.toEqual(refusal('42501', W.fileNotFound))
    await expect(mara.embedFile(board, null)).rejects.toEqual(refusal('22023', W.needsFile))
    await expect(dev.embedFile(board, plainFile(store).id)).rejects.toEqual(refusal('42501', W.boardNotWritable))
    expect((await mara.readBoard(board.id)).elements).toEqual([])
  })

  it('boardFileUrl answers as fileUrl answers for the row; a file gone or not to be seen is missing', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara)
    // The fixtures' own files have no bodies: no address, so the canvas shows the file's tile.
    const el = await mara.createMedia(board, picture())
    expect(await mara.boardFileUrl(el.file, { stream: false })).toBeNull()
    expect(await mara.boardFileUrl(el.file)).toBe(await mara.fileUrl(store.files.find(f => f.id === el.file.id)))
    // The one kind of row a fake bucket answers (a company's own storage, with its generated picture, as the game
    // fixtures' blockout is): the same address fileUrl gives it.
    const row = store.files.find(f => f.id === el.file.id)
    Object.assign(row, { storage_provider: 's3', thumbnail_url: 'thumbs/harbour.png' })
    store.thumbnails.set('thumbs/harbour.png', 'data:image/png;base64,AAAA')
    expect(await mara.boardFileUrl({ id: row.id })).toBe('data:image/png;base64,AAAA')
    expect(await mara.fileUrl(row)).toBe('data:image/png;base64,AAAA')
    const money = store.files.find(f => f.project_id === PROJECT_ID && f.is_financial)
    await expect(mara.boardFileUrl({ id: money.id })).rejects.toEqual(refusal('42501', FIXTURE_FILE_GONE))
    await expect(mara.boardFileUrl({ id: uuid() })).rejects.toEqual(refusal('42501', FIXTURE_FILE_GONE))
    await expect(mara.boardFileUrl(null)).rejects.toEqual(refusal('42501', FIXTURE_FILE_GONE))
    store.files.find(f => f.id === el.file.id).deleted_at = new Date().toISOString()
    await expect(mara.boardFileUrl(el.file.id)).rejects.toEqual(refusal('42501', FIXTURE_FILE_GONE))
  })
})

describe('a folder\'s trash and moves (0131), a board\'s with it', () => {
  it('a board\'s folder goes to the trash with its notes, is listed to bring back, and comes back whole', async () => {
    const { store, mara } = company()
    const { board } = await newBoard(mara, 'Mood')
    const el = await mara.createSticky(board, 'A note')
    expect(await mara.trashFolders([board.folder_id])).toEqual({ batches: 1, folders: 1, files: 1 })
    expect((await mara.listMothFolders(PROJECT_ID)).some(f => f.id === board.folder_id)).toBe(false)
    expect((await mara.listMothFiles(PROJECT_ID)).some(f => f.id === el.file.id)).toBe(false)
    expect(await mara.listBoards(PROJECT_ID)).toEqual([])
    const [row] = await mara.listTrashedFolders()
    expect(row).toMatchObject({ id: board.folder_id, project_id: PROJECT_ID, name: 'Mood', is_board: true, files: 1, deleted_by_label: 'Mara Okonkwo', can_restore: true })
    expect(Date.parse(row.purges_at) - Date.parse(row.deleted_at)).toBe(30 * 86400000)
    await expect(mara.putBoardElements(board.id, [{ kind: 'frame' }])).rejects.toEqual(refusal('42501', W.boardNotWritable))
    expect(await mara.restoreFolders([board.folder_id])).toEqual({ folders: 1, files: 1 })
    expect(store.files.find(f => f.id === el.file.id).deleted_at).toBe(null)
    expect((await mara.readBoard(board.id)).elements.map(e => e.id)).toEqual([el.id])
    expect(await mara.listTrashedFolders()).toEqual([])
  })

  it('refuses what moth_trash_folders and moth_restore_folders refuse, in their words', async () => {
    const { store, mara, dev } = company()
    const category = store.folders.find(f => f.project_id === PROJECT_ID && f.kind === 'category')
    await expect(mara.trashFolders([category.id])).rejects.toEqual(refusal('22023', W.layout))
    await expect(mara.trashFolders([])).rejects.toEqual(refusal('22023', W.foldersCount))
    await expect(mara.trashFolders([uuid()])).rejects.toEqual(refusal('42501', W.folderNotWritable))
    const outer = (await newBoard(mara, 'Outer')).board
    const inner = (await mara.createBoard(PROJECT_ID, outer.folder_id, 'Inner'))
    await expect(dev.trashFolders([outer.folder_id])).rejects.toEqual(refusal('42501', W.folderNotWritable))
    await mara.trashFolders([inner.folder_id])
    await mara.trashFolders([outer.folder_id])
    await expect(mara.restoreFolders([inner.folder_id])).rejects.toEqual(refusal('22023', W.parentTrashed))
    expect((await mara.listTrashedFolders()).map(r => r.id).sort()).toEqual([inner.folder_id, outer.folder_id].sort())
    await mara.restoreFolders([outer.folder_id])
    await mara.restoreFolders([inner.folder_id])
    await expect(mara.restoreFolders([inner.folder_id])).rejects.toEqual(refusal('42501', W.folderNotWritable))
    // A board's folder is never deleted, only put in the trash.
    await expect(mara.deleteFolder(outer.folder_id)).rejects.toEqual(refusal('42501', W.boardDeleted))
  })

  it('a folder moves within its project with everything below it, its name made unique; a plan moves nothing', async () => {
    const { store, mara } = company()
    const a = await mara.createBoard(PROJECT_ID, null, 'Alpha')
    const b = await mara.createBoard(PROJECT_ID, null, 'Beta')
    const child = await mara.createBoard(PROJECT_ID, a.folder_id, 'Beta')
    const plan = await mara.moveFolders([b.folder_id], a.folder_id, true)
    expect(plan).toEqual({ moved: [{ id: b.folder_id, from: 'beta', to: 'alpha/beta-2', folders: 1 }], plan_only: true })
    expect(store.folders.find(f => f.id === b.folder_id).path).toBe('beta')
    const done = await mara.moveFolders([a.folder_id], b.folder_id)
    expect(done).toEqual({ moved: [{ id: a.folder_id, from: 'alpha', to: 'beta/alpha', folders: 2 }], plan_only: false })
    expect(store.folders.find(f => f.id === child.folder_id).path).toBe('beta/alpha/beta')
    expect((await mara.readBoard(child.board_id)).board.folder_id).toBe(child.folder_id)
    await expect(mara.moveFolders([b.folder_id], child.folder_id)).rejects.toEqual(refusal('22023', W.intoItself))
    const entity = store.folders.find(f => f.project_id === PROJECT_ID && f.kind === 'entity')
    await expect(mara.moveFolders([b.folder_id], entity.id)).rejects.toEqual(refusal('22023', W.boardEntity))
    const category = store.folders.find(f => f.project_id === PROJECT_ID && f.kind === 'category')
    await expect(mara.moveFolders([category.id], b.folder_id)).rejects.toEqual(refusal('22023', W.layout))
    const space = store.projects.find(p => p.personal_owner_id === MEMBER_ID.mara)
    store.folders.push({ id: 'f1c70000-000a-4000-8000-000000000901', project_id: space.id, workspace_id: WORKSPACE_ID, parent_id: null, kind: 'root', entity_type: null, slug: 'space', label: null, path: '' })
    await expect(mara.moveFolders([b.folder_id], 'f1c70000-000a-4000-8000-000000000901')).rejects.toEqual(refusal('cross_project', W.crossProject))
    // One statement: the folder that moves first is put back when the one after it is refused (it would go inside
    // itself: the destination is below it).
    const c = await mara.createBoard(PROJECT_ID, null, 'Gamma')
    const d = await mara.createBoard(PROJECT_ID, null, 'Delta')
    const [first, second] = [c.folder_id, d.folder_id].sort()
    const dest = await mara.createBoard(PROJECT_ID, second, 'Below')
    const before = store.folders.find(f => f.id === first).path
    await expect(mara.moveFolders([c.folder_id, d.folder_id], dest.folder_id)).rejects.toEqual(refusal('22023', W.intoItself))
    expect(store.folders.find(f => f.id === first)).toMatchObject({ path: before, parent_id: rootOf(store).id })
  })
})

describe('the fake says what the database says', () => {
  it('every word it refuses with is the SQL\'s own', () => {
    const sql = ['0130_boards.sql', '0131_folder_trash_and_moves.sql', '0132_board_channels.sql', '0133_sticky_locks.sql']
      .map(f => readFileSync(join(__dirname, '../../../supabase/migrations', f), 'utf8')).join('\n')
    for (const [key, words] of Object.entries(W)) {
      expect(sql, key).toContain(`'${words.replace(/'/g, "''")}'`)
    }
  })
})
