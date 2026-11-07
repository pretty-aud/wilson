// mothAdapter.test.js — MO1 (0117, 0118, MOTH_DESIGN §1.9): the cloud adapter's calls send the names the functions
// have, a refusal reaches the person in words, a database without them says so, and the copy a move asks for is put
// where the server said.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

let mod
let adapter
let rpcs
const rpcAnswers = {}
let answer
// One more try with no wait, so a test need not sit out a window. Its own file tests the wait.
vi.mock('../storage/patiently', () => ({
  patiently: async (fn) => {
    try {
      return await fn()
    } catch (err) {
      if (err?.status === 429) return fn()
      throw err
    }
  },
}))

let copied
let pictureRefused

function fake() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (fn, args) => {
      rpcs.push({ fn, args })
      if (rpcAnswers[fn]) return rpcAnswers[fn]
      return answer
    },
    storage: {
      from: (bucket) => ({
        copy: async (from, to) => {
          copied.push({ bucket, from, to })
          return bucket === pictureRefused ? { data: null, error: { message: 'no' } } : { data: {}, error: null }
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { last_checked_at: 'then' }, error: null }) }),
      }),
    }),
  }
}

beforeEach(async () => {
  vi.resetModules()
  rpcs = []
  copied = []
  pictureRefused = null
  answer = { data: { ok: true }, error: null }
  mod = await import('./supabaseAdapter')
  mod.resetSupabaseAdapter()
  globalThis.__testSupabase = fake()
  adapter = mod.supabaseAdapter()
})
afterEach(() => { delete globalThis.__testSupabase })

describe('moves', () => {
  it('a plan writes nothing, and the commit carries the copies', async () => {
    await adapter.planFileMove(['a'], 'p2', 'f1')
    expect(rpcs[0]).toEqual({ fn: 'moth_move_items', args: { p_file_ids: ['a'], p_dest_project: 'p2', p_dest_folder: 'f1', p_plan_only: true } })
    await adapter.moveFiles(['a'], 'p2', null, [{ file_id: 'a', path: 'k', thumbnail: null }])
    expect(rpcs[1].args).toEqual({ p_file_ids: ['a'], p_dest_project: 'p2', p_dest_folder: null, p_plan_only: false, p_bodies: [{ file_id: 'a', path: 'k', thumbnail: null }] })
  })
  it('an undo, its plan, and a redo by the undo\'s id', async () => {
    await adapter.planUndoFileMove('m1')
    await adapter.undoFileMove('m1')
    expect(rpcs.map((r) => [r.fn, r.args])).toEqual([
      ['moth_undo_move', { p_move_id: 'm1', p_plan_only: true }],
      ['moth_undo_move', { p_move_id: 'm1', p_plan_only: false }],
    ])
  })
  it('🚨 a refusal reaches the person in words, with its code', async () => {
    answer = { data: null, error: { code: 'P0001', message: 'moth_move:name_taken' } }
    await expect(adapter.moveFiles(['a'], 'p2')).rejects.toMatchObject({ code: 'name_taken', message: 'A file with this name is already there.' })
  })
  it('a database without them says so', async () => {
    answer = { data: null, error: { code: 'PGRST202', message: 'not found' } }
    await expect(adapter.planFileMove(['a'], 'p2')).rejects.toThrow('does not have M.O.T.H. yet')
  })
  it('a copy within Petal\'s storage is one call, at the key the server minted', async () => {
    const out = await adapter.copyBodyForMove(
      { id: 'a', storage_path: 'old/a.mov', storage_provider: 'supabase' },
      { id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov' },
    )
    expect(copied).toEqual([{ bucket: 'rabbit-files', from: 'old/a.mov', to: 'new/a.mov' }])
    expect(out).toEqual({ file_id: 'a', to_provider: 'supabase', path: 'new/a.mov', thumbnail: null })
  })
  const WITH_PICTURE = [
    { id: 'a', storage_path: 'old/a.mov', storage_provider: 'supabase', thumbnail_url: 'old/a.jpg' },
    { id: 'a', how: 'rehome', to_provider: 'supabase', to_path: 'new/a.mov', to_thumb: 'new/a.mov.jpg' },
  ]
  it('🚨 its picture goes with it, or the moved file would lose it', async () => {
    const out = await adapter.copyBodyForMove(...WITH_PICTURE)
    expect(copied[1]).toEqual({ bucket: 'rabbit-thumbnails', from: 'old/a.jpg', to: 'new/a.mov.jpg' })
    expect(out.thumbnail).toBe('new/a.mov.jpg')
  })
  describe('🚨 into a company\'s own bucket (0120)', () => {
    const FILE = { id: 'a', storage_path: 'old/a.mov', storage_provider: 'supabase', mime_type: 'video/quicktime' }
    const ITEM = { id: 'a', how: 'rehome', to_provider: 's3', to_path: 'new/a.mov' }
    let s3
    let order
    beforeEach(async () => {
      const { getStorageProvider } = await import('../storage/index.js')
      s3 = getStorageProvider('s3')
      order = []
      const supabase = getStorageProvider('supabase')
      vi.spyOn(supabase, 'get').mockImplementation(async () => { order.push('get'); return new Blob(['x']) })
      vi.spyOn(s3, 'put').mockImplementation(async () => { order.push('put'); return {} })
      vi.spyOn(s3, 'look').mockImplementation(async () => { order.push('look') })
      vi.spyOn(s3, 'del').mockImplementation(async () => { order.push('del') })
    })
    afterEach(() => vi.restoreAllMocks())
    it('the server looks after the copy lands, and the body says where it went', async () => {
      const out = await adapter.copyBodyForMove(FILE, ITEM)
      expect(order).toEqual(['get', 'put', 'look'])
      expect(s3.look).toHaveBeenCalledWith('new/a.mov')
      expect(out).toEqual({ file_id: 'a', to_provider: 's3', path: 'new/a.mov', thumbnail: null })
    })
    it('a look that refuses takes back the copy it just made, and says why', async () => {
      s3.look.mockImplementation(async () => { order.push('look'); throw new Error('not there') })
      await expect(adapter.copyBodyForMove(FILE, ITEM)).rejects.toThrow('not there')
      expect(order).toEqual(['get', 'put', 'look', 'del'])
      expect(s3.del).toHaveBeenCalledWith('new/a.mov')
    })
    it('and a clean-up that fails does not hide the reason', async () => {
      s3.look.mockImplementation(async () => { throw new Error('not there') })
      s3.del.mockImplementation(async () => { throw new Error('gone already') })
      await expect(adapter.copyBodyForMove(FILE, ITEM)).rejects.toThrow('not there')
    })
    it('🚨 a look that hit the budget tries the look again, and does not copy the file again', async () => {
      let tries = 0
      s3.look.mockImplementation(async () => {
        order.push('look')
        if (tries++ === 0) throw Object.assign(new Error('too many'), { status: 429 })
      })
      await adapter.copyBodyForMove(FILE, ITEM)
      expect(order).toEqual(['get', 'put', 'look', 'look'])
    })
    it('a copy that hit the budget tries the copy again', async () => {
      let tries = 0
      s3.put.mockImplementation(async () => {
        order.push('put')
        if (tries++ === 0) throw Object.assign(new Error('too many'), { status: 429 })
        return {}
      })
      await adapter.copyBodyForMove(FILE, ITEM)
      expect(order).toEqual(['get', 'put', 'get', 'put', 'look'])
    })
    it('🚨 so does a picture, or it would be lost without a word', () => {
      const src = readFileSync(join(__dirname, 'supabaseAdapter.js'), 'utf8')
      expect(src).toContain('await patiently(() => carryThumbnail(from, to, file.thumbnail_url, item.to_thumb, { client }));')
    })
    it('a copy that did not land is not looked at', async () => {
      s3.put.mockImplementation(async () => { throw new Error('no room') })
      await expect(adapter.copyBodyForMove(FILE, ITEM)).rejects.toThrow('no room')
      expect(s3.look).not.toHaveBeenCalled()
    })
    it('a copy within Petal\'s storage needs no look: the database sees it', async () => {
      await adapter.copyBodyForMove(FILE, { ...ITEM, to_provider: 'supabase' })
      expect(s3.look).not.toHaveBeenCalled()
    })
  })
  it('a picture that will not copy does not stop the move', async () => {
    pictureRefused = 'rabbit-thumbnails'
    const out = await adapter.copyBodyForMove(...WITH_PICTURE)
    expect(out).toEqual({ file_id: 'a', to_provider: 'supabase', path: 'new/a.mov', thumbnail: null })
  })
})

describe('the trash', () => {
  it('names its functions, and the index asks a page', async () => {
    await adapter.trashFiles(['a'])
    await adapter.restoreFiles(['a'])
    answer = { data: [{ id: 'a' }], error: null }
    expect(await adapter.listTrashedFiles({ limit: 50 })).toEqual([{ id: 'a' }])
    expect(rpcs.map((r) => r.fn)).toEqual(['moth_trash_files', 'moth_restore_files', 'moth_trash_index'])
    expect(rpcs[2].args).toEqual({ p_limit: 50, p_before: null })
  })
  it('🚨 a batch with one hidden file reads as not there', async () => {
    answer = { data: null, error: { code: 'P0001', message: 'moth_trash:not_found' } }
    await expect(adapter.trashFiles(['a', 'inv'])).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the office server', () => {
  it('the apply, each of its arguments', async () => {
    await adapter.refreshNetworkShare({ projectId: 'p', root: '//s/d', folder: 'Salt', dirs: [], bin: ['i'], final: false, stoppedAt: 'Salt/b', first: true })
    expect(rpcs[0]).toEqual({
      fn: 'network_share_catalogue_apply',
      args: { p_project_id: 'p', p_root: '//s/d', p_folder: 'Salt', p_dirs: [], p_bin: ['i'], p_final: false, p_stopped_at: 'Salt/b', p_first: true },
    })
  })
  it('settle, pending, stale moves and a record', async () => {
    await adapter.settleNetworkShareOps(['o'], 'not_moved')
    await adapter.networkSharePending()
    await adapter.networkShareStaleMoves()
    await adapter.networkShareRecordAdded({ projectId: 'p', root: 'r', entries: [{ n: 'a', s: '1' }] })
    expect(rpcs.map((r) => r.fn)).toEqual(['network_share_settle', 'network_share_pending_mine', 'network_share_stale_moves', 'network_share_record_added'])
    expect(rpcs[0].args).toEqual({ p_op_ids: ['o'], p_outcome: 'not_moved', p_facts: null })
    expect(rpcs[3].args).toEqual({ p_project: 'p', p_root: 'r', p_folder_id: null, p_entries: [{ n: 'a', s: '1' }] })
  })
  it('🚨 an office-server refusal reaches the page in words, not as a raw code', async () => {
    rpcAnswers.network_share_record_added = { data: null, error: { message: 'network_share: folders_unplaced' } }
    await expect(adapter.networkShareRecordAdded({ projectId: 'p', root: 'r', entries: [] })).rejects.toMatchObject({ code: 'folders_unplaced' })
    rpcAnswers.network_share_catalogue_apply = { data: null, error: { message: 'network_share: not allowed' } }
    await expect(adapter.refreshNetworkShare({ projectId: 'p', root: 'r', folder: 'f', dirs: [] })).rejects.toMatchObject({ code: 'not_allowed' })
    delete rpcAnswers.network_share_record_added
    delete rpcAnswers.network_share_catalogue_apply
  })
  it('🚨 a former member\'s files: each of its arguments, and a refusal in words', async () => {
    await adapter.listLeaverFiles('s')
    await adapter.planLeaverMove(['f'], 'p')
    await adapter.moveLeaverFiles(['f'], 'p', [{ file_id: 'f', path: 'x' }])
    expect(rpcs.slice(-3)).toEqual([
      { fn: 'moth_leaver_files', args: { p_project: 's' } },
      { fn: 'moth_move_leaver_files', args: { p_file_ids: ['f'], p_dest_project: 'p', p_dest_folder: null, p_plan_only: true } },
      { fn: 'moth_move_leaver_files', args: { p_file_ids: ['f'], p_dest_project: 'p', p_dest_folder: null, p_plan_only: false, p_bodies: [{ file_id: 'f', path: 'x' }] } },
    ])
    rpcAnswers.moth_move_leaver_files = { data: null, error: { message: 'moth_move:in_their_server_folder' } }
    await expect(adapter.moveLeaverFiles(['f'], 'p')).rejects.toMatchObject({ code: 'in_their_server_folder' })
    delete rpcAnswers.moth_move_leaver_files
  })
  it('the last check, and who is calling', async () => {
    expect(await adapter.getNetworkShareCheck('p')).toEqual({ last_checked_at: 'then' })
    expect(await adapter.getAccessToken()).toBe('tok')
  })
  it('a row names the provider, and it is registered on every surface', async () => {
    const { getStorageProvider, FILE_PROVIDERS } = await import('../storage/index.js')
    expect(FILE_PROVIDERS.NETWORK_SHARE).toBe('network_share')
    expect(typeof getStorageProvider('network_share').getUrl).toBe('function')
  })
})

describe('round 2: an answer that is a real one', () => {
  it('🚨 a database answer keeps its code, so a rollback is not read as a lost answer', async () => {
    answer = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    await expect(adapter.moveFiles(['a'], 'p2')).rejects.toMatchObject({ code: '57014' })
  })
  it('a fetch that failed has no code, and is still a lost answer', async () => {
    answer = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
    const err = await adapter.moveFiles(['a'], 'p2').catch((e) => e)
    expect(err.code ?? '').toBe('')
  })
})
