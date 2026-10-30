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
// The fake client answers each folder read by its filters and records them,
// so a lookup with the wrong project, kind or path finds nothing; every case
// sits beside its CONTROL.
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

const PID = 'aaaa1111-0000-0000-0000-000000000001'
const NIL = '00000000-0000-0000-0000-000000000000'

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
 * a read that answers an error (`foldersError`) or throws (`foldersThrow`).
 * Records the files inserted and every folder read's filters.
 */
function makeClient({ invoices = 'folder-invoices', scene = 'folder-s1', foldersError = null, foldersThrow = false } = {}) {
  const inserts = []
  const folderReads = []
  const table = (name) => {
    let op = 'select'
    let payload = null
    let cols = '*'
    const filters = {}
    const b = {
      select: (c) => { if (op === 'select') cols = c ?? '*'; return b },
      limit: () => b,
      eq: (k, v) => { filters[k] = v; return b },
      single: () => b,
      maybeSingle: () => b,
      insert: (row) => { op = 'insert'; payload = row; return b },
      update: (row) => { op = 'update'; payload = row; return b },
      then: (resolve, reject) => {
        let result
        if (op === 'insert') {
          inserts.push({ table: name, row: payload })
          result = { data: { id: 'new-file', ...payload }, error: null }
        } else if (op === 'update') {
          result = { data: { id: 'f1', ...payload }, error: null }
        } else if (name === 'projects' && cols === 'is_private') {
          result = { data: { is_private: false }, error: null }
        } else if (name === 'folders') {
          folderReads.push({ ...filters })
          if (foldersThrow) return Promise.reject(new Error('network down')).then(resolve, reject)
          if (foldersError) result = { data: null, error: foldersError }
          else if (filters.project_id === PID && filters.kind === 'category' && filters.path === 'INVOICES') result = { data: invoices ? { id: invoices, path: 'INVOICES' } : null, error: null }
          else if (filters.project_id === PID && filters.scene_id === 's1') result = { data: scene ? { id: scene, path: 'SCENES/sc01' } : null, error: null }
          else result = { data: null, error: null }
        } else {
          result = { data: [], error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  return {
    inserts, folderReads,
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
const invoicesReads = (client) => client.folderReads.filter(f => f.path === 'INVOICES')

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
    // This project's category folder, by its kind and path: one read.
    expect(invoicesReads(client)).toEqual([{ project_id: PID, kind: 'category', path: 'INVOICES' }])
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

  it('no INVOICES folder, a read that answers an error, or one that throws: the invoice sits at the top and the upload is not refused', async () => {
    for (const opts of [{ invoices: null }, { foldersError: { code: '42501', message: 'refused' } }, { foldersThrow: true }]) {
      const client = await upload({ financial: true, lineId: 'line-1' }, opts)
      const row = fileRow(client)
      expect(row, JSON.stringify(opts)).toBeTruthy()
      expect(row.folder_id, JSON.stringify(opts)).toBeNull()
      expect(row.is_financial, JSON.stringify(opts)).toBe(true)
      expect(thirdSegment(row.storage_path), JSON.stringify(opts)).toBe('INVOICES')
    }
  })
})
