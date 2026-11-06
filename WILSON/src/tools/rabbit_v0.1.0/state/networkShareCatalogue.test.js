// networkShareCatalogue.test.js — MO1 (MOTH_DESIGN §1.9): carrying a walk to the catalogue, and an operation's rename.
import { describe, it, expect, vi } from 'vitest'
import { createNetworkShareCatalogue, spaceFolderOf, splitDirs, ENTRIES_PER_CALL } from './networkShareCatalogue.js'
import { createNetworkShareStorageProvider, networkShareUrl, locatorOf } from '../storage/networkShareProvider.js'
import { createDesktopFileOps, DESKTOP_ACTION_SENTENCE, DESKTOP_PREVIEW_SENTENCE } from '../storage/desktopFileOps.js'
import { mothRefusal } from '../adapters/mothErrors.js'

const files = (n, p = 'f') => Array.from({ length: n }, (_, i) => ({ n: `${p}${i}.mov`, s: '1' }))
const dir = (d, n = 0, complete = true) => ({ d, complete, subdirs: [], files: files(n) })

function setup({ walks = [{ dirs: [dir('Salt')], bin: [], stopped_at: null }], applies = [] } = {}) {
  const apply = []
  const adapter = {
    getNetworkShareCheck: vi.fn(async () => null),
    refreshNetworkShare: vi.fn(async (call) => { apply.push(call); return applies.shift() ?? { added: call.dirs.length } }),
    settleNetworkShareOps: vi.fn(async () => {}),
    networkSharePending: vi.fn(async () => []),
  }
  const ops = {
    available: () => true,
    walkFolder: vi.fn(async () => walks.shift()),
    rename: vi.fn(async (pairs) => ({ results: pairs.map((p) => ({ ...p, ok: true })) })),
    purgeBin: vi.fn(async () => ({ results: [] })),
  }
  return { adapter, ops, apply, catalogue: createNetworkShareCatalogue({ adapter, ops, now: () => Date.parse('2026-11-06T12:00:00Z') }) }
}

describe('a space\'s folder', () => {
  it('a personal space, a placed folder, and one that is not under the drive', () => {
    expect(spaceFolderOf({ personal_owner_id: 'u1' }, '//s/d')).toBe('_WILSON_PERSONAL/u1')
    expect(spaceFolderOf({ folder_root: String.raw`\\s\d\Salt\In` }, String.raw`\\s\d`)).toBe('Salt/In')
    expect(spaceFolderOf({ folder_root: '//other/d/Salt' }, '//s/d')).toBeNull()
    expect(spaceFolderOf({ folder_root: '//s/d' }, '//s/d')).toBeNull()
    expect(spaceFolderOf({}, '//s/d')).toBeNull()
  })
})

describe('splitting a walk into calls', () => {
  it('fits small directories together', () => {
    expect(splitDirs([dir('a', 400), dir('b', 400), dir('c', 400)]).map((c) => c.map((d) => d.d))).toEqual([['a', 'b'], ['c']])
  })
  it('🚨 a directory over one call goes in parts not complete, then whole, so nothing in it reads missing early', () => {
    const big = dir('big', ENTRIES_PER_CALL * 2 + 1)
    const calls = splitDirs([big])
    expect(calls.length).toBe(4)
    expect(calls.slice(0, 3).every(([d]) => d.complete === false)).toBe(true)
    expect(calls[3][0]).toBe(big)
  })
})

describe('refreshing', () => {
  it('says first once and final once, on the last call', async () => {
    const { catalogue, apply } = setup({ walks: [{ dirs: [dir('Salt', 800), dir('Salt/a', 800)], bin: ['id1'], stopped_at: null }] })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(apply.map((c) => [c.first, c.final])).toEqual([[true, false], [false, true]])
    expect(apply.map((c) => c.bin)).toEqual([['id1'], []])
  })
  it('sends the same call again while the server has more to mark', async () => {
    const { catalogue, apply } = setup({ applies: [{ more_missing: true }, { more_missing: true }, { more_missing: false }] })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(apply.length).toBe(3)
  })
  it('carries a capped walk on from where it stopped, and starts where the last check stopped', async () => {
    const { catalogue, ops, adapter, apply } = setup({
      walks: [{ dirs: [dir('Salt/b')], bin: [], stopped_at: 'Salt/c' }, { dirs: [dir('Salt/c')], bin: [], stopped_at: null }],
    })
    adapter.getNetworkShareCheck = vi.fn(async () => ({ next_start: 'Salt/b' }))
    const out = await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(ops.walkFolder.mock.calls).toEqual([['Salt', 'Salt/b'], ['Salt', 'Salt/c']])
    expect(apply.map((c) => [c.final, c.stoppedAt])).toEqual([[false, 'Salt/c'], [true, null]])
    expect(out.complete).toBe(false)
  })
  it('says plainly when a folder is too big to read whole', async () => {
    const { catalogue } = setup({ walks: [{ dirs: [dir('Salt', 5000, false)], bin: [], stopped_at: null }] })
    expect((await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })).tooBig).toBe(true)
  })
  it('does what the apply found: a purge, a file back from the bin, and a stale operation', async () => {
    const { catalogue, ops, adapter } = setup({
      applies: [{ purge_ok: ['i1'], restore_back: [{ id: 'i2', to: 'Salt/in/a.mov' }], stale: [{ op_id: 'o1', op: 'move', from: 'x', to: 'y' }] }],
    })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(ops.purgeBin).toHaveBeenCalledWith(['Salt/.wilson-bin/i1'])
    expect(ops.rename).toHaveBeenCalledWith([{ from: 'Salt/.wilson-bin/i2/a.mov', to: 'Salt/in/a.mov' }])
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['o1'], 'done')
  })
  it('a project with no folder is told so', async () => {
    const { catalogue } = setup()
    await expect(catalogue.refreshNow({ id: 'p1', folder_root: '//x/y' }, { root: '//s/d' })).rejects.toThrow('no folder')
  })
})

describe('on opening a project', () => {
  it('looks only every ten minutes, and quietly', async () => {
    const { catalogue, adapter, ops } = setup()
    adapter.getNetworkShareCheck = vi.fn(async () => ({ last_checked_at: '2026-11-06T11:55:00Z' }))
    expect(await catalogue.refreshOnOpen({ id: 'p1', personal_owner_id: 'u' }, { root: '//s/d' })).toEqual({ skipped: 'recent' })
    expect(ops.walkFolder).not.toHaveBeenCalled()
    adapter.getNetworkShareCheck = vi.fn(async () => ({ last_checked_at: '2026-11-06T11:00:00Z' }))
    ops.walkFolder = vi.fn(async () => { throw new Error('off') })
    expect((await catalogue.refreshOnOpen({ id: 'p1', personal_owner_id: 'u' }, { root: '//s/d' })).skipped).toBe('failed')
  })
  it('a browser does not look', async () => {
    const { catalogue, ops } = setup()
    ops.available = () => false
    expect(await catalogue.refreshOnOpen({ id: 'p1' }, { root: '//s/d' })).toEqual({ skipped: 'browser' })
  })
})

describe('an operation\'s rename', () => {
  const op = (id, extra = {}) => ({ op_id: id, from: `a/${id}`, to: `b/${id}`, ...extra })
  it('each settles for itself', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.rename = vi.fn(async () => ({ results: [{ ok: true }, { ok: false, code: 'name_taken' }] }))
    const out = await catalogue.runNasOp([op('1'), op('2')])
    expect(out.done.map((o) => o.op_id)).toEqual(['1'])
    expect(out.notMoved.map((o) => o.code)).toEqual(['name_taken'])
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['1'], 'done')
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['2'], 'not_moved')
  })
  it('🚨 a delete whose file has already gone settles done, or its row could never leave', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.rename = vi.fn(async () => ({ results: [{ ok: false, code: 'not_there' }] }))
    await catalogue.runNasOp([op('1')], { kind: 'trash' })
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['1'], 'done')
    await catalogue.runNasOp([op('2', { op: 'trash' })])
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['2'], 'done')
    await catalogue.runNasOp([op('3', { op: 'move' })])
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['3'], 'not_moved')
  })
  it('🚨 a returning laptop reads what is pending before renaming', async () => {
    const { catalogue, ops, adapter } = setup()
    adapter.networkSharePending = vi.fn(async () => [])
    await catalogue.settlePending()
    expect(adapter.networkSharePending).toHaveBeenCalled()
    expect(ops.rename).not.toHaveBeenCalled()
    adapter.networkSharePending = vi.fn(async () => [op('9', { op: 'move' })])
    await catalogue.settlePending()
    expect(ops.rename).toHaveBeenCalledWith([{ from: 'a/9', to: 'b/9' }])
  })
  it('a browser settles nothing', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.available = () => false
    await catalogue.settlePending()
    expect(adapter.networkSharePending).not.toHaveBeenCalled()
  })
})

describe('the provider and the desktop calls', () => {
  const ok = (body = {}, status = 200) => vi.fn(async () => ({ status, ok: status < 300, json: async () => body, blob: async () => 'blob' }))
  it('its six functions, by locator, encoded per segment', async () => {
    const fetchImpl = ok()
    const p = createNetworkShareStorageProvider({ available: () => true, fetchImpl })
    expect(locatorOf('nas:Salt/a b.mov')).toBe('Salt/a b.mov')
    expect(networkShareUrl('nas:Salt/a b.mov', { download: true })).toBe('/api/rabbit/network-share/file/Salt/a%20b.mov?download=1')
    expect(await p.getUrl('nas:Salt/a b.mov')).toBe('/api/rabbit/network-share/file/Salt/a%20b.mov')
    expect(await p.get('nas:a')).toBe('blob')
    expect(await p.exists('nas:a')).toBe(true)
    expect(await createNetworkShareStorageProvider({ available: () => true, fetchImpl: ok({}, 404) }).exists('nas:a')).toBe(false)
    await expect(createNetworkShareStorageProvider({ available: () => true, fetchImpl: ok({}, 503) }).exists('nas:a')).rejects.toThrow('cannot be reached')
    expect(await p.describe()).toEqual({ provider: 'network_share', label: 'Company server', reachable: true })
    await expect(p.del('nas:Salt/a.mov')).rejects.toThrow('deleted through Files')
    await expect(p.put('nas:a', null)).rejects.toThrow('from Files')
  })
  it('off the desktop, a read and a write each say where to do it', async () => {
    const p = createNetworkShareStorageProvider({ available: () => false, fetchImpl: ok() })
    await expect(p.get('a')).rejects.toThrow(DESKTOP_PREVIEW_SENTENCE)
    await expect(p.exists('a')).rejects.toThrow(DESKTOP_PREVIEW_SENTENCE)
    await expect(p.getUrl('a')).rejects.toThrow(DESKTOP_PREVIEW_SENTENCE)
    await expect(p.put('a', null, { from: {} })).rejects.toThrow(DESKTOP_ACTION_SENTENCE)
    await expect(p.del('a')).rejects.toThrow(DESKTOP_ACTION_SENTENCE)
    expect((await p.describe()).reachable).toBe(false)
    await expect(createDesktopFileOps({ available: () => false, fetchImpl: ok() }).walkFolder('a')).rejects.toThrow(DESKTOP_ACTION_SENTENCE)
  })
  it('an answer that is no success throws its sentence and code', async () => {
    const o = createDesktopFileOps({ available: () => true, fetchImpl: ok({ code: 'unreachable', error: 'Off.' }, 503) })
    await expect(o.rename([])).rejects.toMatchObject({ message: 'Off.', code: 'unreachable', status: 503 })
  })
  it('the add route gets who is calling, as a bearer token', async () => {
    const fetchImpl = ok({ locator: 'x' }, 201)
    const o = createDesktopFileOps({ available: () => true, fetchImpl })
    await o.addToPersonalSpace({ root: '//s/d', folder: '_WILSON_PERSONAL/u', file: { name: 'a b.mov', size: 3 }, accessToken: 'tok' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('name=a+b.mov')
    expect(url).toContain('sizeBytes=3')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })
})

describe('a refusal in words', () => {
  it('each code, the fallback, and an error that is not one', () => {
    expect(mothRefusal({ message: 'moth_move:not_found' })).toMatchObject({ code: 'not_found', message: 'That file or folder is not there.' })
    expect(mothRefusal({ message: 'moth_trash:not_allowed' }).code).toBe('not_allowed')
    expect(mothRefusal({ message: 'moth_move:something_new' }).message).toBe('WILSON could not do that. Try it again.')
    expect(mothRefusal({ message: 'other' })).toBeNull()
    expect(mothRefusal(null)).toBeNull()
  })
  it('a hidden file and a missing one share a sentence', () => {
    expect(mothRefusal({ message: 'moth_move:not_found' }).message).not.toMatch(/money|invoice|legal|private/i)
  })
})
