// boardsCloud.test.js — MO4 (0130 to 0133): the cloud adapter's board methods. Each sends the parameter names the SQL
// declares (a wrong name is PGRST202, which would read as "no boards here"), pages and chunks as the server's bounds
// ask, hands on the server's refusals in its words with its codes, saves a sticky's words to a fresh key and publishes
// them over the key they were read from, and joins a board's two private channels as 0132 names them. The Local
// Server adapter answers every one in words, with the code the page reads as "not here".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const {
  supabaseAdapter, resetSupabaseAdapter, boardElementsForSave, stickyFileName,
  BOARDS_ABSENT, BOARD_COLUMNS, STICKY_GONE, STICKY_MOVED, STICKY_S3_OFF, BOARD_FILE_GONE, BOARD_NEEDS_FILE,
} = await import('./supabaseAdapter')
const { localServerAdapter, BOARDS_LOCAL, FOLDERS_LOCAL } = await import('./localServerAdapter')
const { fixtureBoardElementsForSave, fixtureStickyFileName, FIXTURE_STICKY_GONE, FIXTURE_STICKY_MOVED, BOARD_WORDS } = await import('../../../dev/fixtures/boardsFixtures')

const ME = 'u-mara'
const BOARD = 'b0000000-0000-4000-8000-000000000001'
const flush = () => new Promise(r => setTimeout(r, 0))

// A client that records every call. `rpc[fn](args, n)` answers the nth call of fn; `tables[name](query)` a table read;
// the bucket keeps what is uploaded; channels record their bindings and can be driven from the test.
function makeClient({ rpc = {}, tables = {}, objects = {} } = {}) {
  const calls = []
  const bucket = { objects: new Map(Object.entries(objects)), uploads: [], removed: [], signed: [] }
  const channels = []
  const client = {
    calls, bucket, channels,
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: ME } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    realtime: { setAuth: async () => {} },
    rpc: async (fn, args) => {
      const n = calls.filter(c => c.fn === fn).length
      calls.push({ fn, args })
      const answer = rpc[fn]
      if (!answer) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }
      return typeof answer === 'function' ? answer(args, n) : answer
    },
    from: (name) => {
      const q = { name, filters: [], orders: [], cols: null, range: null }
      const b = {
        select: (cols) => { q.cols = cols; return b },
        eq: (c, v) => { q.filters.push([c, v]); return b },
        order: (c) => { q.orders.push(c); return b },
        range: (from, to) => { q.range = [from, to]; return b },
        maybeSingle: () => { q.single = true; return b },
        then: (resolve, reject) => {
          calls.push({ table: name, q })
          const answer = tables[name] ? tables[name](q) : { data: [], error: null }
          return Promise.resolve(answer).then(resolve, reject)
        },
      }
      return b
    },
    storage: {
      from: (name) => ({
        upload: async (key, body, opts) => {
          bucket.uploads.push({ name, key, type: opts?.contentType, text: await body.text() })
          bucket.objects.set(key, await body.text())
          return { data: { path: key }, error: null }
        },
        download: async (key) => (bucket.objects.has(key)
          ? { data: new Blob([bucket.objects.get(key)], { type: 'text/markdown' }), error: null }
          : { data: null, error: { message: 'Object not found' } }),
        remove: async (keys) => { bucket.removed.push(...keys); for (const k of keys) bucket.objects.delete(k); return { data: [], error: null } },
        createSignedUrl: async (key, expiresIn, opts) => {
          bucket.signed.push({ name, key, expiresIn, opts })
          return { data: { signedUrl: `https://signed.test/${name}/${key}` }, error: null }
        },
      }),
    },
    channel(name, config) {
      const ch = {
        name, config, handlers: [], sent: [], tracked: [], status: null, unsubscribed: false, state: {},
        on(kind, filter, fn) { ch.handlers.push({ kind, event: filter?.event, fn }); return ch },
        subscribe(cb) { ch.onStatus = cb; return ch },
        unsubscribe() { ch.unsubscribed = true },
        send(msg) { ch.sent.push(msg); return Promise.resolve('ok') },
        track: async (meta) => { ch.tracked.push(meta) },
        presenceState: () => ch.state,
        // The test's hands: a status, or a broadcast as the server delivers one.
        hear(event, payload) {
          for (const h of ch.handlers) if (h.kind === 'broadcast' && (h.event === '*' || h.event === event)) h.fn({ type: 'broadcast', event, payload })
        },
        sync() { for (const h of ch.handlers) if (h.kind === 'presence') h.fn() },
      }
      channels.push(ch)
      return ch
    },
    removeChannel(ch) { ch.removed = true },
  }
  return client
}
const rpcCalls = (client, fn) => client.calls.filter(c => c.fn === fn).map(c => c.args)
const pgError = (code, message, details) => ({ data: null, error: { code, message, details: details ?? null, hint: null } })

let adapter
beforeEach(() => {
  resetSupabaseAdapter()
  adapter = supabaseAdapter()
})
afterEach(() => { delete globalThis.__testSupabase })

describe('a board\'s reads', () => {
  it('readBoard follows board_read\'s pages until next is null, and keeps the first page\'s board', async () => {
    const page = (ids, next, revision) => ({ data: { board: { id: BOARD, revision }, elements: ids.map((id, i) => ({ id, z: i })), next, truncated: !!next }, error: null })
    const client = makeClient({ rpc: {
      board_read: (args, n) => [page(['a', 'b'], { z: 1, id: 'b' }, 4), page(['c'], { z: 0, id: 'c' }, 5), page(['d'], null, 6)][n],
    } })
    globalThis.__testSupabase = client
    const out = await adapter.readBoard(BOARD)
    expect(out).toEqual({ board: { id: BOARD, revision: 4 }, elements: ['a', 'b', 'c', 'd'].map((id, i) => expect.objectContaining({ id })) })
    expect(rpcCalls(client, 'board_read')).toEqual([
      { p_board: BOARD, p_after: null }, { p_board: BOARD, p_after: { z: 1, id: 'b' } }, { p_board: BOARD, p_after: { z: 0, id: 'c' } },
    ])
  })

  it('a page that does not move on ends the read, rather than asking forever', async () => {
    const client = makeClient({ rpc: { board_read: () => ({ data: { board: { id: BOARD }, elements: [{ id: 'a', z: 0 }], next: { z: 0, id: 'a' } }, error: null }) } })
    globalThis.__testSupabase = client
    expect((await adapter.readBoard(BOARD)).elements).toHaveLength(2)
    expect(rpcCalls(client, 'board_read')).toHaveLength(2)
  })

  it('readBoardElements asks 50 ids a call, once each, and answers in stacking order; nothing asked, nothing sent', async () => {
    const client = makeClient({ rpc: { board_read_elements: (args) => ({ data: args.p_ids.map(id => ({ id, z: -Number(id.slice(1)) })), error: null }) } })
    globalThis.__testSupabase = client
    const ids = Array.from({ length: 120 }, (_, i) => `e${i}`)
    const out = await adapter.readBoardElements(BOARD, [...ids, 'e3', null])
    expect(rpcCalls(client, 'board_read_elements').map(a => a.p_ids.length)).toEqual([50, 50, 20])
    expect(rpcCalls(client, 'board_read_elements')[0].p_board).toBe(BOARD)
    expect(out).toHaveLength(120)
    expect(out[0].id).toBe('e119')
    expect(await adapter.readBoardElements(BOARD, [])).toEqual([])
    expect(rpcCalls(client, 'board_read_elements')).toHaveLength(3)
  })

  it('listBoards reads the five columns a client may, a project\'s, ordered on the id', async () => {
    const client = makeClient({ tables: { boards: () => ({ data: [{ id: BOARD }], error: null }) } })
    globalThis.__testSupabase = client
    expect(await adapter.listBoards('p1')).toEqual([{ id: BOARD }])
    const { q } = client.calls.find(c => c.table === 'boards')
    expect(q.cols).toBe(BOARD_COLUMNS)
    expect(BOARD_COLUMNS).toBe('id, folder_id, project_id, audience_gen, revision')
    expect(q.filters).toEqual([['project_id', 'p1']])
    expect(q.orders).toEqual(['id'])
  })

  it('a database without boards says so in words, with the code the page reads as "not here"', async () => {
    globalThis.__testSupabase = makeClient({ tables: { boards: () => pgError('42P01', 'relation "public.boards" does not exist') } })
    await expect(adapter.listBoards('p1')).rejects.toMatchObject({ code: 'boards_absent', message: BOARDS_ABSENT })
    await expect(adapter.readBoard(BOARD)).rejects.toMatchObject({ code: 'boards_absent', message: BOARDS_ABSENT })
    await expect(adapter.trashFolders(['f1'])).rejects.toMatchObject({ code: 'boards_absent' })
  })
})

describe('a board\'s saves', () => {
  it('putBoardElements sends 500 a call and merges what each saved and each skipped', async () => {
    const client = makeClient({ rpc: {
      board_put_elements: (args, n) => ({ data: { saved: args.p_elements.map(e => ({ id: e.id, version: 1 })), conflicts: n === 1 ? [{ id: 'x', version: 3 }] : [] }, error: null }),
    } })
    globalThis.__testSupabase = client
    const els = Array.from({ length: 1201 }, (_, i) => ({ id: `e${i}`, kind: 'frame' }))
    const out = await adapter.putBoardElements(BOARD, els)
    expect(rpcCalls(client, 'board_put_elements').map(a => a.p_elements.length)).toEqual([500, 500, 201])
    expect(rpcCalls(client, 'board_put_elements')[0].p_board).toBe(BOARD)
    expect(out.saved).toHaveLength(1201)
    expect(out.conflicts).toEqual([{ id: 'x', version: 3 }])
    expect(await adapter.putBoardElements(BOARD, [])).toEqual({ saved: [], conflicts: [] })
    expect(rpcCalls(client, 'board_put_elements')).toHaveLength(3)
  })

  it('a save refused after another saved carries what that one saved', async () => {
    const client = makeClient({ rpc: {
      board_put_elements: (args, n) => (n === 0
        ? { data: { saved: [{ id: 'e0', version: 1 }], conflicts: [] }, error: null }
        : pgError('54000', 'A board holds at most 5,000 elements.')),
    } })
    globalThis.__testSupabase = client
    const err = await adapter.putBoardElements(BOARD, Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, kind: 'frame' }))).catch(e => e)
    expect(err).toMatchObject({ code: '54000', message: 'A board holds at most 5,000 elements.' })
    expect(err.partial.saved).toEqual([{ id: 'e0', version: 1 }])
  })

  it('what a save sends: the file by its id, no server columns, no left-out points as nothing, connectors last', () => {
    const rows = boardElementsForSave([
      { id: 'c', kind: 'connector', from_id: 'a', to_id: 'b' },
      { id: 'a', kind: 'sticky', file: { id: 'f1', name: 'Plan.md' }, missing: false, version: 4, updated_at: 't', updated_by: 'u', has_file: true },
      { id: 'p', kind: 'pen', points: null, body: null, points_omitted: true, x: 3 },
      { id: 'b', x: 9 },
    ])
    expect(rows).toEqual([
      { id: 'a', kind: 'sticky', file_id: 'f1' },
      { id: 'p', kind: 'pen', x: 3 },
      { id: 'b', x: 9 },
      { id: 'c', kind: 'connector', from_id: 'a', to_id: 'b' },
    ])
  })

  it('the fixtures restate the same rule and the same file names (boardsFixtures.js)', () => {
    const cases = [
      [{ id: 'c', kind: 'connector', to_id: 'a', version: 2 }, { id: 'a', kind: 'media', file: { id: 'f' } }, 'not an element', { id: 'k', file_id: null, file: { id: 'f' } }],
      [{ id: 'p', kind: 'pen', points_omitted: true, points: [1, 2], body: null }],
      [],
    ]
    for (const c of cases) expect(fixtureBoardElementsForSave(c)).toEqual(boardElementsForSave(c))
    for (const t of ['', '# Harbour light\nWarm', '  \n- a list: item\n', 'a/b\\c:d*e?f"g<h>i|j', 'x'.repeat(90)]) {
      expect(fixtureStickyFileName(t)).toBe(stickyFileName(t))
    }
    expect(stickyFileName('# Harbour light\nWarm')).toBe('Harbour light.md')
    expect(stickyFileName('')).toBe('Sticky note.md')
    expect(FIXTURE_STICKY_GONE).toBe(STICKY_GONE)
    expect(FIXTURE_STICKY_MOVED).toBe(STICKY_MOVED)
    expect(BOARD_WORDS.s3Off).toBe(STICKY_S3_OFF)
  })

  it('deleteBoardElements sends ids and versions 500 a call, aligned; versions of another length are refused in the server\'s words', async () => {
    const client = makeClient({ rpc: { board_delete_elements: (args) => ({ data: { removed: args.p_ids, conflicts: [] }, error: null }) } })
    globalThis.__testSupabase = client
    const ids = Array.from({ length: 700 }, (_, i) => `e${i}`)
    const out = await adapter.deleteBoardElements(BOARD, ids, ids.map((_, i) => i))
    const sent = rpcCalls(client, 'board_delete_elements')
    expect(sent.map(a => [a.p_ids.length, a.p_versions.length])).toEqual([[500, 500], [200, 200]])
    expect(sent[1].p_ids[0]).toBe('e500')
    expect(sent[1].p_versions[0]).toBe(500)
    expect(out.removed).toHaveLength(700)
    await adapter.deleteBoardElements(BOARD, ['e1'])
    expect(rpcCalls(client, 'board_delete_elements')[2]).toEqual({ p_board: BOARD, p_ids: ['e1'], p_versions: null })
    await expect(adapter.deleteBoardElements(BOARD, ['e1'], [])).rejects.toMatchObject({ code: '22023', message: BOARD_WORDS.removeShape })
  })

  it('every other call sends the SQL\'s own parameter names', async () => {
    const client = makeClient({ rpc: {
      board_create: { data: { board_id: BOARD }, error: null }, board_channels: { data: { topic: 't' }, error: null },
      sticky_claim: { data: { granted: true }, error: null }, sticky_renew: { data: { ok: true }, error: null },
      sticky_release: { data: true, error: null }, sticky_status: { data: null, error: null },
      moth_trash_folders: { data: {}, error: null }, moth_restore_folders: { data: {}, error: null },
      moth_trashed_folders: { data: null, error: null }, moth_move_folders: { data: {}, error: null },
    } })
    globalThis.__testSupabase = client
    await adapter.createBoard('p1', null, 'Look')
    await adapter.boardChannels(BOARD)
    await adapter.claimSticky('el', 'window-1234')
    await adapter.renewSticky('el', 7)
    expect(await adapter.releaseSticky('el', 7)).toBe(true)
    expect(await adapter.stickyStatus(BOARD)).toEqual([])
    await adapter.trashFolders(['f1'])
    await adapter.restoreFolders(['f1'])
    expect(await adapter.listTrashedFolders()).toEqual([])
    await adapter.moveFolders(['f1'], 'f2', true)
    await adapter.moveFolders(['f1'], 'f2', { planOnly: false })
    expect(client.calls.map(c => [c.fn, c.args])).toEqual([
      ['board_create', { p_project: 'p1', p_parent: null, p_title: 'Look' }],
      ['board_channels', { p_board: BOARD }],
      ['sticky_claim', { p_element: 'el', p_session: 'window-1234' }],
      ['sticky_renew', { p_element: 'el', p_generation: 7 }],
      ['sticky_release', { p_element: 'el', p_generation: 7 }],
      ['sticky_status', { p_board: BOARD }],
      ['moth_trash_folders', { p_ids: ['f1'] }],
      ['moth_restore_folders', { p_ids: ['f1'] }],
      ['moth_trashed_folders', { p_limit: 200, p_before: null, p_before_id: null }],
      ['moth_move_folders', { p_ids: ['f1'], p_dest_parent: 'f2', p_plan_only: true }],
      ['moth_move_folders', { p_ids: ['f1'], p_dest_parent: 'f2', p_plan_only: false }],
    ])
  })

  it('a refusal keeps the server\'s words and code; a P0001 with words is its code word and those words', async () => {
    globalThis.__testSupabase = makeClient({ rpc: {
      board_put_elements: pgError('22023', 'That style is not one a board knows.'),
      board_read: pgError('42501', 'board not found'),
      moth_move_folders: pgError('P0001', 'cross_project', 'A board or folder stays in its project for now: move its files with Move to.'),
      moth_trashed_folders: pgError('P0001', 'moth_trash:not_a_workspace_member'),
    } })
    await expect(adapter.putBoardElements(BOARD, [{ kind: 'shape' }])).rejects.toMatchObject({ code: '22023', message: 'That style is not one a board knows.' })
    await expect(adapter.readBoard(BOARD)).rejects.toMatchObject({ code: '42501', message: 'board not found' })
    await expect(adapter.moveFolders(['f'], 'g')).rejects.toMatchObject({ code: 'cross_project', message: 'A board or folder stays in its project for now: move its files with Move to.' })
    await expect(adapter.listTrashedFolders()).rejects.toMatchObject({ code: 'not_a_workspace_member', message: 'You are not a member of this company.' })
  })

  it('setBoardBackground calls board_set_background by its own parameter names and hands on its answer and refusals', async () => {
    const client = makeClient({ rpc: {
      board_set_background: (args, n) => (n < 1
        ? { data: { board_id: args.p_board, background: args.p_background, version: 1, changed: true }, error: null }
        : pgError('22023', 'A board\'s background is dotted, blank or lined.')),
    } })
    globalThis.__testSupabase = client
    expect(await adapter.setBoardBackground(BOARD, 'lines')).toEqual({ board_id: BOARD, background: 'lines', version: 1, changed: true })
    // Neither 0136 column is read from the table.
    expect(BOARD_COLUMNS).not.toContain('background_version')
    expect(rpcCalls(client, 'board_set_background')).toEqual([{ p_board: BOARD, p_background: 'lines' }])
    await expect(adapter.setBoardBackground(BOARD, 'stripes')).rejects.toMatchObject({ code: '22023', message: 'A board\'s background is dotted, blank or lined.' })
    // Never a direct write to the table, and never a read of the column there.
    expect(client.calls.filter(c => c.table)).toEqual([])
    expect(BOARD_COLUMNS).not.toContain('background')
    // A server without 0136 says so as any missing board function does.
    globalThis.__testSupabase = makeClient()
    resetSupabaseAdapter()
    await expect(adapter.setBoardBackground(BOARD, 'dots')).rejects.toMatchObject({ code: 'boards_absent', message: BOARDS_ABSENT })
  })
})

describe('a sticky\'s words', () => {
  const FILE = { id: 'f-note', project_id: 'p1', folder_id: 'fold', name: 'Plan.md', mime_type: 'text/markdown', storage_provider: 'supabase', storage_path: 'projects/p1/project/p1/1-Plan.md' }
  const EL = { id: 'el-1', kind: 'sticky', file: { id: FILE.id, name: FILE.name } }
  const filesTable = (row) => () => ({ data: row, error: null })

  it('read from where the row says; saved to a fresh key under the file\'s own project, published over the key read', async () => {
    const client = makeClient({
      tables: { files: filesTable(FILE) },
      objects: { [FILE.storage_path]: 'First words' },
      rpc: { board_sticky_publish: { data: true, error: null } },
    })
    globalThis.__testSupabase = client
    expect(await adapter.readStickyText(EL.file)).toBe('First words')
    expect(await adapter.saveStickyText(EL, 41, 'Second words')).toEqual({ ok: true })
    const [up] = client.bucket.uploads
    expect(up.key).toMatch(/^projects\/p1\/files\/f-note\/\d+-[0-9a-f-]{8}\.md$/)
    expect(up).toMatchObject({ name: 'rabbit-files', type: 'text/markdown', text: 'Second words' })
    expect(rpcCalls(client, 'board_sticky_publish')).toEqual([{ p_element: 'el-1', p_generation: 41, p_from_path: FILE.storage_path, p_to_path: up.key }])
    expect(client.bucket.removed).toEqual([])
    // The next save is over the key this one wrote, though the row read is still the old one.
    await adapter.saveStickyText(EL, 41, 'Third words')
    expect(rpcCalls(client, 'board_sticky_publish')[1].p_from_path).toBe(up.key)
  })

  it('a key that moved since the read: "moved", the new copy taken back, and the next save says it again until a read', async () => {
    const client = makeClient({
      tables: { files: filesTable(FILE) },
      objects: { [FILE.storage_path]: 'Old' },
      rpc: { board_sticky_publish: { data: false, error: null } },
    })
    globalThis.__testSupabase = client
    await adapter.readStickyText(EL.file)
    expect(await adapter.saveStickyText(EL, 3, 'Mine')).toEqual({ ok: false, reason: 'moved', words: STICKY_MOVED })
    expect(client.bucket.removed).toEqual([client.bucket.uploads[0].key])
    await adapter.saveStickyText(EL, 3, 'Mine')
    expect(rpcCalls(client, 'board_sticky_publish')[1].p_from_path).toBe(FILE.storage_path)
  })

  it('a turn that ended: its words from the server, nothing kept; another refusal is thrown in its words', async () => {
    const ended = 'Someone else is writing in this sticky now, or your turn ended: your words were not saved.'
    const client = makeClient({
      tables: { files: filesTable(FILE) },
      rpc: { board_sticky_publish: (args, n) => (n === 0 ? pgError('P0001', 'sticky_turn_ended', ended) : pgError('22023', 'This note has left its board: it is edited where it is now.')) },
    })
    globalThis.__testSupabase = client
    expect(await adapter.saveStickyText(EL, 3, 'Late')).toEqual({ ok: false, reason: 'turn_ended', words: ended })
    await expect(adapter.saveStickyText(EL, 3, 'Late')).rejects.toMatchObject({ code: '22023', message: 'This note has left its board: it is edited where it is now.' })
    expect(client.bucket.removed).toHaveLength(2)
  })

  describe('a save whose answer is lost (an error with no code)', () => {
    const lost = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } }
    // The row as the database has it after the save: `moved` says whether the save took the new key.
    const savedClient = (row) => {
      let reads = 0
      const client = makeClient({
        tables: { files: () => { reads += 1; return reads === 1 ? { data: FILE, error: null } : row(client) } },
        rpc: { board_sticky_publish: lost },
      })
      return client
    }

    it('🚨 the row, read again, names the new key: the save landed, it is kept and answered as saved, and the next save goes over it', async () => {
      const client = savedClient((c) => ({ data: { ...FILE, storage_path: c.bucket.uploads[0].key }, error: null }))
      globalThis.__testSupabase = client
      expect(await adapter.saveStickyText(EL, 3, 'Words')).toEqual({ ok: true })
      expect(client.calls.filter(c => c.table === 'files')).toHaveLength(2)
      expect(client.bucket.removed).toEqual([])
      const landed = client.bucket.uploads[0].key
      expect(client.bucket.objects.get(landed)).toBe('Words')
      // (This one's answer is lost too, and its row names the first key: it is taken back and thrown.)
      await expect(adapter.saveStickyText(EL, 3, 'More words')).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
      expect(rpcCalls(client, 'board_sticky_publish')[1].p_from_path).toBe(landed)
    })

    it('🚨 the row cannot be read again: the key remembered is forgotten, and the next save goes over the row\'s own', async () => {
      let reads = 0
      let landed = null
      const client = makeClient({
        tables: {
          files: () => {
            reads += 1
            // 1: the first save's read; 2: the second save's; 3: its read again fails; 4: the third save's, the row
            // naming the second save's key (it landed).
            if (reads === 3) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
            return { data: reads === 4 ? { ...FILE, storage_path: landed } : FILE, error: null }
          },
        },
        rpc: { board_sticky_publish: (args, n) => { if (n === 1) { landed = args.p_to_path; return lost } return { data: true, error: null } } },
      })
      globalThis.__testSupabase = client
      expect(await adapter.saveStickyText(EL, 3, 'First')).toEqual({ ok: true })
      const first = rpcCalls(client, 'board_sticky_publish')[0].p_to_path
      await expect(adapter.saveStickyText(EL, 3, 'Second')).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
      expect(rpcCalls(client, 'board_sticky_publish')[1].p_from_path).toBe(first)
      expect(client.bucket.removed).toEqual([])
      expect(await adapter.saveStickyText(EL, 3, 'Third')).toEqual({ ok: true })
      expect(rpcCalls(client, 'board_sticky_publish')[2].p_from_path).toBe(landed)
    })

    it('the row, read again, names the old key: the new copy is taken back', async () => {
      const client = savedClient(() => ({ data: FILE, error: null }))
      globalThis.__testSupabase = client
      await expect(adapter.saveStickyText(EL, 3, 'Words')).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
      expect(client.bucket.removed).toEqual([client.bucket.uploads[0].key])
    })

    it('the row cannot be read again: nothing is taken back', async () => {
      const client = savedClient(() => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }))
      globalThis.__testSupabase = client
      await expect(adapter.saveStickyText(EL, 3, 'Words')).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
      expect(client.bucket.removed).toEqual([])
    })

    it('a coded refusal or the function\'s own false takes it back without reading the row again', async () => {
      const client = makeClient({
        tables: { files: filesTable(FILE) },
        rpc: { board_sticky_publish: (args, n) => (n === 0 ? pgError('42501', 'board not found') : { data: false, error: null }) },
      })
      globalThis.__testSupabase = client
      await expect(adapter.saveStickyText(EL, 3, 'a')).rejects.toMatchObject({ code: '42501' })
      expect(await adapter.saveStickyText(EL, 3, 'b')).toMatchObject({ ok: false, reason: 'moved' })
      expect(client.bucket.removed).toEqual(client.bucket.uploads.map(u => u.key))
      expect(client.calls.filter(c => c.table === 'files')).toHaveLength(2)
    })
  })

  it('a company\'s own bucket waits: refused in the server\'s words before anything is uploaded; a note gone says so', async () => {
    const client = makeClient({ tables: { files: filesTable({ ...FILE, storage_provider: 's3' }) } })
    globalThis.__testSupabase = client
    await expect(adapter.saveStickyText(EL, 3, 'x')).rejects.toMatchObject({ code: 's3_sticky_off', message: STICKY_S3_OFF })
    expect(client.bucket.uploads).toEqual([])
    expect(rpcCalls(client, 'board_sticky_publish')).toEqual([])
    globalThis.__testSupabase = makeClient({ tables: { files: filesTable(null) } })
    resetSupabaseAdapter()
    await expect(adapter.readStickyText({ id: 'gone' })).rejects.toMatchObject({ code: '42501', message: STICKY_GONE })
  })

  it('createSticky uploads the words into the board\'s folder through the ordinary upload, places it, and reads it back', async () => {
    const placed = { id: 'el-new', kind: 'sticky', file: { id: 'f-new' }, version: 1 }
    const client = makeClient({ rpc: {
      board_put_elements: (args) => ({ data: { saved: args.p_elements.map(e => ({ id: e.id, version: 1 })), conflicts: [] }, error: null }),
      board_read_elements: { data: [placed], error: null },
    } })
    globalThis.__testSupabase = client
    const uploads = []
    adapter.uploadFile = vi.fn(async (projectId, scope, file) => { uploads.push({ projectId, scope, name: file.name, type: file.type, text: await file.text() }); return { id: 'f-new', name: file.name, project_id: projectId, folder_id: scope.folderId } })
    const out = await adapter.createSticky({ id: BOARD, project_id: 'p1', folder_id: 'fold' }, 'Harbour light\nWarm', { id: 'el-new', x: 5, y: 6, z: 9 })
    expect(out).toEqual(placed)
    expect(uploads).toEqual([{ projectId: 'p1', scope: { folderId: 'fold' }, name: 'Harbour light.md', type: 'text/markdown', text: 'Harbour light\nWarm' }])
    expect(rpcCalls(client, 'board_put_elements')[0].p_elements).toEqual([{ id: 'el-new', kind: 'sticky', file_id: 'f-new', x: 5, y: 6, w: 200, h: 200, rotation: 0, z: 9 }])
  })

  it('a placement the board refuses takes the new note to the trash again, and says the board\'s words', async () => {
    const client = makeClient({ rpc: {
      board_put_elements: pgError('42501', 'board not found or not writable'),
      moth_trash_files: { data: { done: 1 }, error: null },
    } })
    globalThis.__testSupabase = client
    adapter.uploadFile = async () => ({ id: 'f-new' })
    await expect(adapter.createSticky({ id: BOARD, project_id: 'p1', folder_id: 'fold' }, 'x')).rejects.toMatchObject({ code: '42501', message: 'board not found or not writable' })
    expect(rpcCalls(client, 'moth_trash_files')).toEqual([{ p_ids: ['f-new'] }])
  })
})

describe('a placed file: its address, a dropped file, an embed', () => {
  const ROW = { id: 'f-pic', project_id: 'p1', folder_id: 'fold', name: 'Harbour.png', mime_type: 'image/png', storage_provider: 'supabase', storage_path: 'projects/p1/project/p1/9-Harbour.png' }
  const BOARD_ROW = { id: BOARD, project_id: 'p1', folder_id: 'fold' }
  const putAll = (args) => ({ data: { saved: args.p_elements.map(e => ({ id: e.id, version: 1 })), conflicts: [] }, error: null })

  it('boardFileUrl reads the row by its id as the caller may, then signs it as fileUrl does', async () => {
    const client = makeClient({ tables: { files: () => ({ data: ROW, error: null }) } })
    globalThis.__testSupabase = client
    const signs = vi.spyOn(adapter, 'fileUrl')
    // The element names its file only: no locator, nothing the client could point elsewhere.
    const url = await adapter.boardFileUrl({ id: ROW.id, name: ROW.name, mime_type: ROW.mime_type, folder_id: 'fold', project_id: 'p1' }, { stream: false })
    expect(url).toBe(`https://signed.test/rabbit-files/${ROW.storage_path}`)
    const read = client.calls.find(c => c.table === 'files')
    expect(read.q.filters).toEqual([['id', ROW.id]])
    expect(read.q.single).toBe(true)
    expect(read.q.cols).toContain('storage_path')
    expect(signs).toHaveBeenCalledWith(ROW, { stream: false })
    expect(client.bucket.signed).toEqual([{ name: 'rabbit-files', key: ROW.storage_path, expiresIn: 3600, opts: undefined }])
    // A video streams unless told not to; an id alone is enough.
    await adapter.boardFileUrl(ROW.id)
    expect(signs).toHaveBeenLastCalledWith(ROW, { stream: true })
  })

  it('a file the caller may not read, or one gone, is missing to them, and nothing is signed', async () => {
    const client = makeClient({ tables: { files: () => ({ data: null, error: null }) } })
    globalThis.__testSupabase = client
    await expect(adapter.boardFileUrl({ id: 'f-gone' })).rejects.toMatchObject({ code: '42501', message: BOARD_FILE_GONE })
    await expect(adapter.boardFileUrl(null)).rejects.toMatchObject({ code: '42501', message: BOARD_FILE_GONE })
    expect(client.bucket.signed).toEqual([])
    // A refusal of the read is handed on in its words.
    globalThis.__testSupabase = makeClient({ tables: { files: () => pgError('42501', 'permission denied for table files') } })
    resetSupabaseAdapter()
    await expect(adapter.boardFileUrl({ id: 'f-pic' })).rejects.toMatchObject({ code: '42501', message: 'permission denied for table files' })
  })

  it('createMedia uploads the file into the board\'s folder through the ordinary upload, places it as a medium, reads it back', async () => {
    const placed = { id: 'el-pic', kind: 'media', file: { id: 'f-new', name: 'Harbour.png' }, version: 1 }
    const client = makeClient({ rpc: { board_put_elements: putAll, board_read_elements: { data: [placed], error: null } } })
    globalThis.__testSupabase = client
    const uploads = []
    adapter.uploadFile = vi.fn(async (projectId, scope, file, opts) => { uploads.push({ projectId, scope, name: file.name, type: file.type, opts }); return { id: 'f-new', name: file.name, mime_type: file.type, project_id: projectId, folder_id: scope.folderId } })
    const file = new File(['png bytes'], 'Harbour.png', { type: 'image/png' })
    const out = await adapter.createMedia(BOARD_ROW, file, { id: 'el-pic', x: 10, y: 20, w: 300, h: 200, z: 7 })
    expect(out).toEqual(placed)
    expect(uploads).toEqual([{ projectId: 'p1', scope: { folderId: 'fold' }, name: 'Harbour.png', type: 'image/png', opts: {} }])
    expect(rpcCalls(client, 'board_put_elements')).toEqual([{ p_board: BOARD, p_elements: [{ id: 'el-pic', kind: 'media', file_id: 'f-new', x: 10, y: 20, w: 300, h: 200, rotation: 0, z: 7 }] }])
    expect(rpcCalls(client, 'board_read_elements')).toEqual([{ p_board: BOARD, p_ids: ['el-pic'] }])
    expect(rpcCalls(client, 'moth_trash_files')).toEqual([])
  })

  it('a medium placed with nothing said is 240 by 180; a read back that fails answers it as placed', async () => {
    const client = makeClient({ rpc: { board_put_elements: putAll, board_read_elements: pgError('42501', 'board not found') } })
    globalThis.__testSupabase = client
    adapter.uploadFile = async (projectId, scope, file) => ({ id: 'f-new', name: file.name, project_id: projectId, folder_id: scope.folderId })
    const out = await adapter.createMedia(BOARD_ROW, new File(['x'], 'clip.mp4', { type: 'video/mp4' }))
    const [sent] = rpcCalls(client, 'board_put_elements')[0].p_elements
    expect(sent).toMatchObject({ kind: 'media', file_id: 'f-new', x: 0, y: 0, w: 240, h: 180, rotation: 0, z: 0 })
    expect(out).toMatchObject({ id: sent.id, kind: 'media', missing: false, version: 1, file: { id: 'f-new', name: 'clip.mp4', mime_type: 'video/mp4', folder_id: 'fold', project_id: 'p1' } })
  })

  it('a placement the board refuses takes the new file to the trash again, in the board\'s words', async () => {
    const client = makeClient({ rpc: {
      board_put_elements: pgError('22023', 'A sticky or a dropped file lives in the board\'s own folder.'),
      moth_trash_files: { data: { done: 1 }, error: null },
    } })
    globalThis.__testSupabase = client
    adapter.uploadFile = async () => ({ id: 'f-new' })
    await expect(adapter.createMedia(BOARD_ROW, new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toMatchObject({ code: '22023', message: 'A sticky or a dropped file lives in the board\'s own folder.' })
    expect(rpcCalls(client, 'moth_trash_files')).toEqual([{ p_ids: ['f-new'] }])
  })

  it('a placement whose answer is lost but which was saved: read back by its own id, answered as placed, nothing trashed', async () => {
    const placed = { id: 'el-pic', kind: 'media', file: { id: 'f-new' }, version: 1 }
    const client = makeClient({ rpc: {
      board_put_elements: { data: null, error: { message: 'AbortError: signal is aborted without reason', code: '' } },
      board_read_elements: { data: [placed], error: null },
      moth_trash_files: { data: { done: 1 }, error: null },
    } })
    globalThis.__testSupabase = client
    adapter.uploadFile = async () => ({ id: 'f-new' })
    expect(await adapter.createMedia(BOARD_ROW, new File(['x'], 'a.png', { type: 'image/png' }), { id: 'el-pic' })).toEqual(placed)
    expect(rpcCalls(client, 'board_read_elements')).toEqual([{ p_board: BOARD, p_ids: ['el-pic'] }])
    expect(rpcCalls(client, 'moth_trash_files')).toEqual([])
  })

  it('a placement whose answer is lost and which is not there: the new note goes to the trash; a read that fails trashes nothing', async () => {
    const lost = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
    const client = makeClient({ rpc: {
      board_put_elements: lost, board_read_elements: { data: [], error: null }, moth_trash_files: { data: { done: 1 }, error: null },
    } })
    globalThis.__testSupabase = client
    adapter.uploadFile = async () => ({ id: 'f-new' })
    await expect(adapter.createSticky(BOARD_ROW, 'x', { id: 'el-new' })).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
    expect(rpcCalls(client, 'moth_trash_files')).toEqual([{ p_ids: ['f-new'] }])

    const unread = makeClient({ rpc: { board_put_elements: lost, board_read_elements: lost, moth_trash_files: { data: { done: 1 }, error: null } } })
    globalThis.__testSupabase = unread
    resetSupabaseAdapter()
    await expect(adapter.createSticky(BOARD_ROW, 'x', { id: 'el-new' })).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
    expect(rpcCalls(unread, 'board_read_elements')).toHaveLength(1)
    expect(rpcCalls(unread, 'moth_trash_files')).toEqual([])
  })

  it('nothing is uploaded without a board to put it on or a file to put', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    adapter.uploadFile = vi.fn()
    await expect(adapter.createMedia({ id: BOARD }, new File(['x'], 'a.png'))).rejects.toMatchObject({ code: '42501', message: 'board not found or not writable' })
    await expect(adapter.createMedia(BOARD_ROW, null)).rejects.toMatchObject({ code: '22023', message: BOARD_NEEDS_FILE })
    await expect(adapter.createMedia(BOARD_ROW, { name: 'not a file' })).rejects.toMatchObject({ code: '22023', message: BOARD_NEEDS_FILE })
    expect(adapter.uploadFile).not.toHaveBeenCalled()
    expect(client.calls).toEqual([])
  })

  it('embedFile places a reference: no upload, no copy, and a refused one touches nobody\'s file', async () => {
    const placed = { id: 'el-doc', kind: 'embed', file: { id: 'f-doc', name: 'Script.pdf' }, version: 1 }
    const client = makeClient({ rpc: { board_put_elements: putAll, board_read_elements: { data: [placed], error: null } } })
    globalThis.__testSupabase = client
    adapter.uploadFile = vi.fn()
    expect(await adapter.embedFile(BOARD_ROW, 'f-doc', { id: 'el-doc', x: 1, y: 2, z: 3 })).toEqual(placed)
    expect(rpcCalls(client, 'board_put_elements')[0].p_elements).toEqual([{ id: 'el-doc', kind: 'embed', file_id: 'f-doc', x: 1, y: 2, w: 240, h: 180, rotation: 0, z: 3 }])
    expect(adapter.uploadFile).not.toHaveBeenCalled()
    expect(client.bucket.uploads).toEqual([])

    const refused = makeClient({ rpc: { board_put_elements: pgError('42501', 'file not found'), moth_trash_files: { data: { done: 1 }, error: null } } })
    globalThis.__testSupabase = refused
    resetSupabaseAdapter()
    await expect(adapter.embedFile(BOARD_ROW, { id: 'f-secret' })).rejects.toMatchObject({ code: '42501', message: 'file not found' })
    expect(rpcCalls(refused, 'moth_trash_files')).toEqual([])
    await expect(adapter.embedFile(BOARD_ROW, null)).rejects.toMatchObject({ code: '22023', message: BOARD_NEEDS_FILE })
    await expect(adapter.embedFile(null, 'f-doc')).rejects.toMatchObject({ code: '42501', message: 'board not found or not writable' })
  })
})

describe('a board\'s two channels (0132)', () => {
  const NAMES = { topic: `moth:board:${BOARD}:0.0`, live_topic: `moth:board-live:${BOARD}:0.0`, audience_gen: 0 }

  it('both private; the database\'s carries elements, sticky and AUDIENCE and is never sent on; the live one is self-off and keyed by the person', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const heard = []
    const ch = adapter.openBoardChannels(NAMES, {
      onElements: (p) => heard.push(['elements', p]), onSticky: (p) => heard.push(['sticky', p]),
      onAudience: (p) => heard.push(['audience', p]), onLive: (e, p) => heard.push(['live', e, p]),
      onPresence: (people) => heard.push(['presence', people]), onStatus: (s) => heard.push(['status', s]),
    })
    await ch.ready
    const [db, live] = client.channels
    expect(db.name).toBe(NAMES.topic)
    expect(db.config).toEqual({ config: { private: true } })
    expect(db.handlers.map(h => `${h.kind}:${h.event}`).sort()).toEqual(['broadcast:AUDIENCE', 'broadcast:board', 'broadcast:elements', 'broadcast:sticky'])
    expect(live.name).toBe(NAMES.live_topic)
    expect(live.config).toEqual({ config: { private: true, broadcast: { self: false }, presence: { key: ME } } })
    // Nothing goes before the live channel is joined.
    expect(ch.sendLive('cursor', { x: 1 })).toBe(false)
    db.onStatus('SUBSCRIBED')
    await ch.track({ label: 'Mara', colour: '#ff8800' })
    expect(live.tracked).toEqual([])
    await live.onStatus('SUBSCRIBED')
    expect(live.tracked).toEqual([{ label: 'Mara', colour: '#ff8800' }])
    expect(ch.sendLive('cursor', { x: 2, y: 3 })).toBe(true)
    expect(live.sent).toEqual([{ type: 'broadcast', event: 'cursor', payload: { x: 2, y: 3 } }])
    expect(db.sent).toEqual([])
    db.hear('elements', { board: BOARD, op: 'remove', ids: ['a'] })
    db.hear('sticky', { board: BOARD, op: 'lock', element: 'a' })
    live.hear('cursor', { x: 9 })
    // A forged database message on the live channel is only a live one.
    live.hear('elements', { op: 'remove', ids: ['b'] })
    live.state = { [ME]: [{ label: 'Mara', presence_ref: 'r1' }], u2: [{ label: 'Theo', presence_ref: 'r2' }] }
    live.sync()
    // AUDIENCE comes on both: the database's is handed on, once, and the live channel's is dropped.
    db.hear('AUDIENCE', { board: BOARD, op: 'audience' })
    live.hear('AUDIENCE', { board: BOARD, op: 'audience' })
    expect(heard).toEqual([
      ['status', { channel: 'topic', status: 'SUBSCRIBED' }],
      ['status', { channel: 'live', status: 'SUBSCRIBED' }],
      ['elements', { board: BOARD, op: 'remove', ids: ['a'] }],
      ['sticky', { board: BOARD, op: 'lock', element: 'a' }],
      ['live', 'cursor', { x: 9 }],
      ['live', 'elements', { op: 'remove', ids: ['b'] }],
      ['presence', [{ key: ME, label: 'Mara' }, { key: 'u2', label: 'Theo' }]],
      ['audience', { board: BOARD, op: 'audience' }],
    ])
    ch.leave()
    expect(client.channels.every(c => c.unsubscribed && c.removed)).toBe(true)
    db.hear('elements', { op: 'put', elements: [] })
    expect(heard).toHaveLength(8)
    expect(ch.sendLive('cursor', {})).toBe(false)
  })

  it('an AUDIENCE forged on the live channel calls nothing, and the database\'s later one is still handed on', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const heard = []
    const ch = adapter.openBoardChannels(NAMES, {
      onAudience: (p) => heard.push(['audience', p]), onLive: (e, p) => heard.push(['live', e, p]),
    })
    await ch.ready
    const [db, live] = client.channels
    live.hear('AUDIENCE', { board: BOARD, op: 'audience' })
    live.hear('audience', { board: BOARD })
    expect(heard).toEqual([])
    db.hear('AUDIENCE', { board: BOARD, op: 'audience', real: true })
    expect(heard).toEqual([['audience', { board: BOARD, op: 'audience', real: true }]])
    ch.leave()
  })

  it('the database\'s `board` message (0136) reaches onBoard; the same event on the live channel is only a live one', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const heard = []
    const ch = adapter.openBoardChannels(NAMES, {
      onBoard: (p) => heard.push(['board', p]), onElements: (p) => heard.push(['elements', p]), onLive: (e, p) => heard.push(['live', e, p]),
    })
    await ch.ready
    const [db, live] = client.channels
    db.hear('board', { board: BOARD, op: 'background', background: 'lines', version: 3 })
    live.hear('board', { board: BOARD, op: 'background', background: 'blank', version: 4 })
    expect(heard).toEqual([
      ['board', { board: BOARD, op: 'background', background: 'lines', version: 3 }],
      ['live', 'board', { board: BOARD, op: 'background', background: 'blank', version: 4 }],
    ])
    ch.leave()
    db.hear('board', { board: BOARD, op: 'background', background: 'dots' })
    expect(heard).toHaveLength(2)
  })

  it('a channel the client still holds under the same name (one still leaving) goes before the new one is made', async () => {
    const client = makeClient()
    const leaving = { topic: `realtime:${NAMES.live_topic}` }
    const order = []
    client.getChannels = () => (leaving.removed ? [] : [leaving])
    client.removeChannel = async (ch) => { order.push(['removed', ch.topic]); ch.removed = true }
    const channel = client.channel.bind(client)
    client.channel = (name, config) => { order.push(['made', name]); return channel(name, config) }
    globalThis.__testSupabase = client
    await adapter.openBoardChannels(NAMES, {}).ready
    expect(order).toEqual([['removed', leaving.topic], ['made', NAMES.topic], ['made', NAMES.live_topic]])
  })

  it('a leave before the join finishes joins nothing', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const ch = adapter.openBoardChannels(NAMES, {})
    ch.leave()
    await ch.ready
    await flush()
    expect(client.channels).toEqual([])
  })
})

describe('the Local Server adapter: a board needs the cloud', () => {
  const BOARD_METHODS = ['listBoards', 'createBoard', 'readBoard', 'readBoardElements', 'putBoardElements', 'deleteBoardElements',
    'boardChannels', 'setBoardBackground', 'claimSticky', 'renewSticky', 'releaseSticky', 'stickyStatus', 'readStickyText', 'saveStickyText', 'createSticky',
    'createMedia', 'embedFile', 'boardFileUrl']
  const FOLDER_METHODS = ['trashFolders', 'restoreFolders', 'moveFolders']

  it('every board method is refused in words, with the code boards_absent; the folder trash is empty there', async () => {
    const local = localServerAdapter()
    for (const m of BOARD_METHODS) await expect(local[m](), m).rejects.toMatchObject({ code: 'boards_absent', message: BOARDS_LOCAL })
    for (const m of FOLDER_METHODS) await expect(local[m](), m).rejects.toMatchObject({ code: 'boards_absent', message: FOLDERS_LOCAL })
    expect(() => local.openBoardChannels({ topic: 't', live_topic: 'l' }, {})).toThrow(BOARDS_LOCAL)
    expect(await local.listTrashedFolders()).toEqual([])
    expect(BOARDS_LOCAL).toBe('Boards need this project in the cloud.')
  })

  it('the three adapters have the same board surface', async () => {
    const { buildDevFixtures } = await import('../../../dev/fixtures/install')
    const all = [...BOARD_METHODS, ...FOLDER_METHODS, 'listTrashedFolders', 'openBoardChannels']
    const fx = buildDevFixtures().rabbitAdapter()
    for (const a of [adapter, localServerAdapter(), fx]) expect(all.filter(m => typeof a[m] !== 'function')).toEqual([])
  })
})
