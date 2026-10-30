// =============================================================================
// invoiceUploadFolder.test.js — OUTSTANDING M1-L6: an invoice added in the
// cloud is filed in the project's INVOICES folder.
//
// Audrey, 2026-10-29 (walkthrough 84, M1's Q1, "1. b"): the invoices and
// receipts the migration carries go into the INVOICES folder. Then, asked
// about the ones added later in the cloud, 2026-10-30: "Yes, M1 fixes it now
// (Recommended)" — "A small change in the upload: a financial file with no
// folder takes the project's Invoices folder." Before, the budget's own
// upload (InvoiceAttachment.jsx, BudgetView's receipts: `{ financial: true }`)
// had the project as its container, so no folder was looked up and the Files
// tree drew the invoice at the top. So `uploadFile(…, { financial: true }, …)`
// with no folder of its own must take the project's INVOICES category folder
// (0041's tree, folderPaths.js's FOLDER_CATEGORIES) — this project's, by its
// kind and path — and:
//   * keep a folder the caller names, or the one its container has;
//   * never file a Legal file there (LEGAL has no row);
//   * never refuse the upload for want of the folder (none, or a read that
//     fails, files it at the top, as before);
//   * change nothing for an ordinary file.
// Review round 1: a project whose tree lacks the INVOICES row has it made
// under its root (none at all: left to the planner); a read or a make that
// fails is said in the console; the path is the planner's own spelling.
// The fake client answers each folder read by its filters (one row) or by
// project (the tree, paged) and records them, so a lookup with the wrong
// project, kind or path finds nothing; every case sits beside its CONTROL.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))
vi.mock('../../../cloud/workspaceStorage', () => ({
  getWorkspaceStorageCached: async () => globalThis.__testStorageRow ?? null,
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')
const { registerStorageProvider, FILE_PROVIDERS } = await import('../storage')
const { planProjectFolders } = await import('../folderPaths')
// The planner's INVOICES category, as the adapter reads and makes it.
const INVOICES = planProjectFolders({}).find(f => f.kind === 'category' && f.entityType === 'invoice')

const PID = 'aaaa1111-0000-0000-0000-000000000001'
const NIL = '00000000-0000-0000-0000-000000000000'
const ROOT_ROW = { id: 'folder-root', project_id: PID, kind: 'root', path: '', parent_id: null }

/** Every body, by the provider it was put to. */
let puts
function fakeProvider(name) {
  return {
    put: async (path) => { puts.push({ provider: name, path }) },
    get: async () => new Blob(['x']),
    del: async () => {},
    exists: async () => true,
    describe: async () => ({ ok: true }),
    getUrl: async () => null,
  }
}

/**
 * A client whose `folders` answer by their filters: this project's INVOICES
 * category folder (`invoices`, null for none), the scene's folder (`scene`),
 * the project's tree for a paged list (`tree`: the root alone by default),
 * a read that answers an error (`foldersError`) or throws (`foldersThrow`),
 * a folder insert that is refused (`makeError`), the tree a list reads once
 * a folder insert has been tried (`treeAfterMake`: a teammate's row). As
 * supabase-js does, `.single()` with no row answers an error (PGRST116) and
 * `.maybeSingle()` answers null (review round 2). Records the files
 * inserted, the folders made and every one-row folder read's filters.
 */
function makeClient({ invoices = 'folder-invoices', scene = 'folder-s1', tree = [ROOT_ROW], treeAfterMake = null, foldersError = null, foldersThrow = false, makeError = null } = {}) {
  const inserts = []
  const folderReads = []
  const foldersMade = []
  let makeTried = false
  const table = (name) => {
    let op = 'select'
    let payload = null
    let cols = '*'
    let one = false
    let strict = false
    const filters = {}
    const b = {
      select: (c) => { if (op === 'select') cols = c ?? '*'; return b },
      limit: () => b,
      order: () => b,
      range: () => b,
      eq: (k, v) => { filters[k] = v; return b },
      single: () => { one = true; strict = true; return b },
      maybeSingle: () => { one = true; return b },
      insert: (row) => { op = 'insert'; payload = row; return b },
      update: (row) => { op = 'update'; payload = row; return b },
      then: (resolve, reject) => {
        let result
        if (op === 'insert' && name === 'folders') {
          foldersMade.push(payload)
          makeTried = true
          result = makeError ? { data: null, error: makeError } : { data: { id: 'folder-made', ...payload }, error: null }
        } else if (op === 'insert') {
          inserts.push({ table: name, row: payload })
          result = { data: { id: 'new-file', ...payload }, error: null }
        } else if (op === 'update') {
          result = { data: { id: 'f1', ...payload }, error: null }
        } else if (name === 'projects' && cols === 'is_private') {
          result = { data: { is_private: false }, error: null }
        } else if (name === 'folders' && !one) {
          // The tree, paged by path (listFoldersWith): this project's rows.
          const rows = makeTried && treeAfterMake ? treeAfterMake : tree
          result = { data: filters.project_id === PID ? rows.map(r => ({ ...r })) : [], error: null }
        } else if (name === 'folders') {
          folderReads.push({ ...filters })
          if (foldersThrow) return Promise.reject(new Error('network down')).then(resolve, reject)
          let row = null
          if (filters.project_id === PID && filters.kind === 'category' && filters.path === INVOICES.path) row = invoices ? { id: invoices, path: INVOICES.path } : null
          else if (filters.project_id === PID && filters.scene_id === 's1') row = scene ? { id: scene, path: 'SCENES/sc01' } : null
          if (foldersError) result = { data: null, error: foldersError }
          else if (!row && strict) result = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
          else result = { data: row, error: null }
        } else {
          result = { data: [], error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  return {
    inserts, folderReads, foldersMade,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (name) => table(name),
    rpc: async (fn, args) => {
      if (fn === 'rabbit_money_segment') return { data: args.seg === 'LEGAL', error: null }
      if (fn === 'can_access_project_legal') return { data: args.p_project !== NIL, error: null }
      return { data: null, error: null }
    },
  }
}

const pdf = () => new File(['%PDF-1.4 invoice'], 'invoice.pdf', { type: 'application/pdf' })
const thirdSegment = (p) => String(p).split('/')[2]
const fileRow = (client) => client.inserts.find(i => i.table === 'files')?.row
const invoicesReads = (client) => client.folderReads.filter(f => f.path === INVOICES.path)

async function upload(scope, opts) {
  resetSupabaseAdapter() // the adapter keeps the client it first saw
  puts = []
  const client = makeClient(opts)
  globalThis.__testSupabase = client
  await supabaseAdapter().uploadFile(PID, scope, pdf())
  return client
}

let warn
beforeEach(() => {
  puts = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetSupabaseAdapter()
  for (const p of [FILE_PROVIDERS.SUPABASE, FILE_PROVIDERS.S3, FILE_PROVIDERS.LOCAL_SERVER]) {
    registerStorageProvider(p, fakeProvider(p))
  }
  globalThis.__testStorageRow = { mode: 'central', provider: 'petal' }
})
afterEach(() => {
  resetSupabaseAdapter()
  delete globalThis.__testSupabase
  delete globalThis.__testStorageRow
  warn.mockRestore()
})

describe('M1-L6: a financial upload with no folder of its own takes the project\'s INVOICES folder', () => {
  it('an invoice attached to a budget line is filed in INVOICES, gated as before', async () => {
    const client = await upload({ financial: true, lineId: 'line-1' })
    const row = fileRow(client)
    expect(row.folder_id).toBe('folder-invoices')
    expect(row.is_financial).toBe(true)
    expect(thirdSegment(row.storage_path)).toBe('INVOICES')
    expect(puts).toEqual([{ provider: FILE_PROVIDERS.SUPABASE, path: row.storage_path }])
    // This project's category folder, by its kind and path (the planner's
    // spelling, INVOICES): one read, nothing made.
    expect(INVOICES.path).toBe('INVOICES')
    expect(invoicesReads(client)).toEqual([{ project_id: PID, kind: 'category', path: INVOICES.path }])
    expect(client.foldersMade).toEqual([])
  })

  it('a receipt (financial, no line) likewise', async () => {
    const client = await upload({ financial: true })
    expect(fileRow(client).folder_id).toBe('folder-invoices')
  })

  it('CONTROL: an ordinary project upload stays at the top, and no INVOICES folder is asked for', async () => {
    const client = await upload({ type: 'project' })
    const row = fileRow(client)
    expect(row.folder_id).toBeNull()
    expect(row.is_financial).toBe(false)
    expect(invoicesReads(client)).toEqual([])
  })

  it('a folder the caller names, or the one its container has, is kept, and INVOICES is not asked for', async () => {
    const named = await upload({ financial: true, folderId: 'folder-mine' })
    expect(fileRow(named).folder_id).toBe('folder-mine')
    expect(invoicesReads(named)).toEqual([])
    // Her words: a financial file "with no folder" takes INVOICES — one whose
    // container has a folder keeps it (no caller sends such a scope today:
    // the budget's uploads have the project as their container).
    const inScene = await upload({ financial: true, sceneId: 's1' })
    expect(fileRow(inScene).folder_id).toBe('folder-s1')
    expect(invoicesReads(inScene)).toEqual([])
    // CONTROL: the same scene scope whose scene has no folder falls back to INVOICES.
    const noSceneFolder = await upload({ financial: true, sceneId: 's1' }, { scene: null })
    expect(fileRow(noSceneFolder).folder_id).toBe('folder-invoices')
  })

  it('a Legal file is never filed in INVOICES (LEGAL has no row)', async () => {
    const client = await upload({ type: 'project', legal: true })
    const row = fileRow(client)
    expect(row.folder_id).toBeNull()
    expect(row.tags).toEqual(['legal'])
    expect(invoicesReads(client)).toEqual([])
  })

  it('a project whose tree lacks the INVOICES row has it made under its root, as the planner makes it, and the invoice filed in it (review round 1)', async () => {
    const client = await upload({ financial: true, lineId: 'line-1' }, { invoices: null })
    expect(client.foldersMade).toEqual([{ project_id: PID, parent_id: ROOT_ROW.id, kind: 'category', entity_type: 'invoice', slug: INVOICES.slug, label: null, path: INVOICES.path }])
    expect(fileRow(client).folder_id).toBe('folder-made')
    // CONTROL: a project with no tree at all is left to the planner (no row
    // is made without the root it would hang from); the invoice sits at the top.
    const bare = await upload({ financial: true, lineId: 'line-1' }, { invoices: null, tree: [] })
    expect(bare.foldersMade).toEqual([])
    expect(fileRow(bare).folder_id).toBeNull()
  })

  it('an INVOICES row the one-row read missed but the tree holds (made a moment before) is used, never made twice', async () => {
    const theirs = { id: 'folder-theirs', project_id: PID, kind: 'category', path: INVOICES.path, parent_id: ROOT_ROW.id }
    const client = await upload({ financial: true }, { invoices: null, tree: [ROOT_ROW, theirs] })
    expect(client.foldersMade).toEqual([])
    expect(fileRow(client).folder_id).toBe('folder-theirs')
  })

  it('an INVOICES row a teammate made between this upload\'s list and its make (the insert meets 23505) is read again and used, nothing said (review round 2)', async () => {
    const theirs = { id: 'folder-theirs', project_id: PID, kind: 'category', path: INVOICES.path, parent_id: ROOT_ROW.id }
    warn.mockClear()
    const client = await upload({ financial: true }, {
      invoices: null,
      makeError: { code: '23505', message: 'duplicate key value violates unique constraint "folders_project_path_uniq"' },
      treeAfterMake: [ROOT_ROW, theirs],
    })
    expect(client.foldersMade).toHaveLength(1)
    expect(fileRow(client).folder_id).toBe('folder-theirs')
    expect(warn.mock.calls.some(c => /INVOICES folder/.test(String(c[0])))).toBe(false)
  })

  it('a read that answers an error, one that throws, or a make that is refused: said in the console, the invoice at the top, the upload not refused (review round 1)', async () => {
    const cases = [
      [{ foldersError: { code: '42501', message: 'read refused' } }, /could not be read, so the file sits at the project's top: read refused/],
      [{ foldersThrow: true }, /could not be read or made, so the file sits at the project's top: network down/],
      [{ invoices: null, makeError: { code: '42501', message: 'make refused' } }, /could not be read or made, so the file sits at the project's top: \[supabase\] make refused/],
    ]
    for (const [opts, said] of cases) {
      warn.mockClear()
      const client = await upload({ financial: true, lineId: 'line-1' }, opts)
      const row = fileRow(client)
      expect(row, JSON.stringify(opts)).toBeTruthy()
      expect(row.folder_id, JSON.stringify(opts)).toBeNull()
      expect(row.is_financial, JSON.stringify(opts)).toBe(true)
      expect(thirdSegment(row.storage_path), JSON.stringify(opts)).toBe('INVOICES')
      expect(warn.mock.calls.some(c => said.test(String(c[0]))), JSON.stringify(opts)).toBe(true)
    }
    // CONTROL: a read that finds the folder says nothing.
    warn.mockClear()
    await upload({ financial: true, lineId: 'line-1' })
    expect(warn.mock.calls.some(c => /INVOICES folder/.test(String(c[0])))).toBe(false)
  })
})
