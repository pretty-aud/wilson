// networkShareCatalogue.test.js — MO1 (MOTH_DESIGN §1.9): carrying a walk to the catalogue, and an operation's rename.
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createNetworkShareCatalogue, spaceFolderOf, splitDirs, ENTRIES_PER_CALL } from './networkShareCatalogue.js'
import { createNetworkShareStorageProvider } from '../storage/networkShareProvider.js'
import { createDesktopFileOps, DESKTOP_ACTION_SENTENCE, DESKTOP_PREVIEW_SENTENCE } from '../storage/desktopFileOps.js'
import { mothRefusal } from '../adapters/mothErrors.js'

const require = createRequire(import.meta.url)
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
    const windows = (p) => p.replaceAll('/', String.fromCharCode(92))
    expect(spaceFolderOf({ folder_root: windows('//s/d/Salt/In') }, windows('//s/d'))).toBe('Salt/In')
    expect(spaceFolderOf({ folder_root: '//other/d/Salt' }, '//s/d')).toBeNull()
    expect(spaceFolderOf({ folder_root: '//s/d' }, '//s/d')).toBeNull()
    expect(spaceFolderOf({}, '//s/d')).toBeNull()
  })
})

describe('splitting a walk into calls', () => {
  it('fits small directories together', () => {
    const part = Math.floor(ENTRIES_PER_CALL * 0.4)
    expect(splitDirs([dir('a', part), dir('b', part), dir('c', part)]).map((c) => c.map((d) => d.d))).toEqual([['a', 'b'], ['c']])
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
    const { catalogue, apply } = setup({ walks: [{ dirs: [dir('Salt', ENTRIES_PER_CALL - 100), dir('Salt/a', ENTRIES_PER_CALL - 100)], bin: ['id1'], stopped_at: null }] })
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
  it('🚨 what is left of a call stops before the server\'s limit, and the last call records where to carry on', async () => {
    const many = Array.from({ length: 40 }, (_, i) => dir(`Salt/d${i}`, 400))
    const { catalogue, apply } = setup({ walks: [
      { dirs: many, bin: [], stopped_at: 'Salt/m' },
      { dirs: many, bin: [], stopped_at: 'Salt/n' },
      { dirs: many, bin: [], stopped_at: 'Salt/o' },
    ] })
    const out = await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(apply.length).toBeLessThanOrEqual(55)
    const last = apply[apply.length - 1]
    expect(last.final).toBe(true)
    expect(last.stoppedAt).not.toBeNull()
    expect(apply.filter((c) => c.final).length).toBe(1)
    expect(out.complete).toBe(false)
  })
  it('🚨 thirty walks is a stop too, not a run nobody records', async () => {
    const walks = Array.from({ length: 31 }, (_, i) => ({ dirs: [dir(`Salt/w${i}`)], bin: [], stopped_at: `Salt/w${i + 1}` }))
    const { catalogue, apply } = setup({ walks })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(apply[apply.length - 1].final).toBe(true)
    expect(apply[apply.length - 1].stoppedAt).toBe('Salt/w30')
  })
  it('🚨 a call the database runs out of time on is sent smaller', async () => {
    const { catalogue, adapter, apply } = setup({ walks: [{ dirs: [dir('Salt', 200), dir('Salt/a', 200)], bin: [], stopped_at: null }] })
    const real = adapter.refreshNetworkShare
    adapter.refreshNetworkShare = vi.fn(async (call) => {
      if (call.dirs.reduce((n, d) => n + d.files.length, 0) > 250) throw new Error('[supabase] canceling statement due to statement timeout')
      return real(call)
    })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(apply.map((c) => c.dirs.map((d) => d.d))).toEqual([['Salt'], ['Salt/a']])
    expect(apply[0].first).toBe(true)
    expect(apply[1].final).toBe(true)
  })
  it('🚨 a call that cannot fit however small says so, and stops', async () => {
    const { catalogue, adapter } = setup({ walks: [{ dirs: [dir('Salt', 100)], bin: [], stopped_at: null }] })
    adapter.refreshNetworkShare = vi.fn(async () => { throw new Error('[supabase] canceling statement due to statement timeout') })
    await expect(catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })).rejects.toThrow('changed too much')
    expect(adapter.refreshNetworkShare.mock.calls.length).toBeLessThan(20)
  })
  it('🚨 a stale operation and a bin file come once, however many calls repeated them', async () => {
    const stale = { op_id: 'o1', op: 'move', from: 'x', to: 'y' }
    const { catalogue, ops } = setup({
      walks: [{ dirs: [dir('Salt', 400), dir('Salt/a', 400), dir('Salt/b', 400)], bin: [], stopped_at: null }],
      applies: [
        { stale: [stale], purge_ok: ['i'], restore_back: [{ id: 'k', to: 'Salt/z.mov' }] },
        { stale: [stale], purge_ok: [], restore_back: [{ id: 'k', to: 'Salt/z.mov' }] },
        { stale: [stale], purge_ok: [], restore_back: [] },
      ],
    })
    await catalogue.refreshNow({ id: 'p1' }, { root: '//s/d', folder: 'Salt' })
    expect(ops.rename.mock.calls.flatMap(([pairs]) => pairs).filter((p) => p.from === 'x').length).toBe(1)
    expect(ops.rename.mock.calls.flatMap(([pairs]) => pairs).filter((p) => p.to === 'Salt/z.mov').length).toBe(1)
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
  it('🚨 a size goes with its pair, for a repeat to compare', async () => {
    const { catalogue, ops } = setup()
    await catalogue.runNasOp([op('1', { size: 7 })])
    expect(ops.rename).toHaveBeenCalledWith([{ from: 'a/1', to: 'b/1', size: 7 }])
  })
  it('🚨 a rename nobody can say happened stays pending: the file may be at either end', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.rename = vi.fn(async () => ({ results: [{ ok: false, code: 'failed' }, { ok: false, code: 'not_verified' }, { ok: false, code: 'in_use' }] }))
    const out = await catalogue.runNasOp([op('1'), op('2'), op('3')])
    expect(out.left.map((o) => o.op_id)).toEqual(['1', '2'])
    expect(out.notMoved.map((o) => o.op_id)).toEqual(['3'])
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledTimes(1)
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['3'], 'not_moved')
  })
  it('🚨 a server that stops answering leaves every operation pending, and does not throw', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.rename = vi.fn(async () => { throw Object.assign(new Error('Off.'), { code: 'unreachable' }) })
    const out = await catalogue.runNasOp([op('1')])
    expect(out.left.map((o) => o.op_id)).toEqual(['1'])
    expect(adapter.settleNetworkShareOps).not.toHaveBeenCalled()
  })
  it('🚨 one settle the server refuses does not hold the others', async () => {
    const { catalogue, adapter } = setup()
    adapter.settleNetworkShareOps = vi.fn(async (ids) => { if (ids.includes('2')) throw new Error('occupied') })
    const out = await catalogue.runNasOp([op('1'), op('2')])
    expect(out.done.map((o) => o.op_id)).toEqual(['1'])
    expect(out.left.map((o) => o.op_id)).toEqual(['2'])
  })
  it('🚨 more renames than the route takes go in batches', async () => {
    const { catalogue, ops } = setup()
    await catalogue.runNasOp(Array.from({ length: 1001 }, (_, i) => op(String(i))))
    expect(ops.rename.mock.calls.map(([pairs]) => pairs.length)).toEqual([500, 500, 1])
  })
  it('🚨 a copy-up settles done with what it read off the server: the real settle refuses it without', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.put = vi.fn(async () => ({ locator: 'Moon/a.mov', size_bytes: 3, modified_at: '2026-11-06T00:00:00.000Z' }))
    expect(await catalogue.runCopyUp({ op_id: 'o1', id: 'a', to: 'Moon/a.mov' }, 'k/a.mov')).toEqual({ ok: true })
    expect(ops.put).toHaveBeenCalledWith('Moon/a.mov', { media_key: 'k/a.mov' })
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['o1'], 'done', { o1: { s: '3', m: '2026-11-06T00:00:00.000Z' } })
  })
  it('🚨 a copy-up whose copy failed settles not_moved, and one whose settle failed stays pending', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.put = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'name_taken', status: 409 }) })
    expect(await catalogue.runCopyUp({ op_id: 'o1', to: 'y' }, 'k')).toEqual({ ok: false, code: 'name_taken' })
    expect(adapter.settleNetworkShareOps).toHaveBeenLastCalledWith(['o1'], 'not_moved')
    ops.put = vi.fn(async () => ({ size_bytes: 3, modified_at: 'then' }))
    adapter.settleNetworkShareOps = vi.fn(async () => { throw new Error('no answer') })
    expect(await catalogue.runCopyUp({ op_id: 'o2', to: 'y' }, 'k')).toEqual({ ok: false, code: 'left', left: true })
  })
  it('🚨 a copy-up left over is looked at: there, it settles done; not there, not_moved; and not while it is still copying', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.statFile = vi.fn(async (at) => (at === 'there' ? { size: 3, modified_at: 'then' } : null))
    adapter.networkSharePending = vi.fn(async () => [{ op_id: 'a', op: 'adopt', from: null, to: 'there' }, { op_id: 'b', op: 'adopt', from: null, to: 'gone' }])
    await catalogue.settlePending()
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['a'], 'done', { a: { s: '3', m: 'then' } })
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['b'], 'not_moved')

    const held = setup()
    let finish
    held.ops.put = vi.fn(() => new Promise((ok) => { finish = ok }))
    held.ops.statFile = vi.fn(async () => null)
    const copying = held.catalogue.runCopyUp({ op_id: 'c', to: 'there' }, 'k')
    held.adapter.networkSharePending = vi.fn(async () => [{ op_id: 'c', op: 'adopt', from: null, to: 'there' }])
    await held.catalogue.settlePending()
    expect(held.adapter.settleNetworkShareOps).not.toHaveBeenCalled()
    finish({ size_bytes: 1, modified_at: 'x' })
    await copying
  })
  it('an empty file at a copy-up\'s target is a reservation, not the copy', async () => {
    const { catalogue, ops, adapter } = setup()
    ops.statFile = vi.fn(async () => ({ size: 0 }))
    adapter.networkSharePending = vi.fn(async () => [{ op_id: 'a', op: 'adopt', from: null, to: 'there' }])
    await catalogue.settlePending()
    expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['a'], 'not_moved')
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
    expect(await p.getUrl('nas:Salt/a b.mov', 60, { download: true })).toBe('/api/rabbit/network-share/file/Salt/a%20b.mov?download=1')
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
  it('🚨 every code the two migrations can raise has a sentence of its own, not the fallback', () => {
    const fs = require('node:fs')
    const dir = new URL('../../../../supabase/migrations/', import.meta.url)
    const text = ['0117_network_share_catalogue.sql', '0118_moth_moves_and_trash.sql', '0121_moth_repairs.sql'].map((n) => fs.readFileSync(new URL(n, dir), 'utf8')).join('\n')
    const codes = new Set([...text.matchAll(/(?:moth_(?:move|trash):|network_share: )([a-z][a-z_0-9 ]*[a-z_0-9])/g)].map((m) => m[1]))
    expect(codes.size).toBeGreaterThan(20)
    for (const code of codes) {
      const said = mothRefusal({ message: `moth_move:${code.replace(/ /g, '_')}` })
      expect(said.message, code).not.toBe('WILSON could not do that. Try it again.')
    }
  })
  it('🚨 an office-server refusal reads as words too, and a restore whose name is held says what to do', () => {
    expect(mothRefusal({ message: 'network_share: folders_unplaced' }).code).toBe('folders_unplaced')
    expect(mothRefusal({ message: 'network_share: not allowed' }).code).toBe('not_allowed')
    expect(mothRefusal({ message: 'moth_trash:occupied' }).message).toMatch(/Rename/)
  })
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
