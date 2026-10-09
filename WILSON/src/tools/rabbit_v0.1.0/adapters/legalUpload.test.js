// =============================================================================
// legalUpload.test.js — post-overhaul S4b: the cloud adapter adds a Legal file
// (migration 0088).
//
// Audrey, 2026-10-01: a Legal file is seen by "same as money files for now"
// (workspace admins and the project's managers), and Legal is chosen when the
// file is ADDED — "its just the folder that is locked". So `uploadFile(…,
// { legal: true }, …)` must:
//   * put the body under the LEGAL third segment (the blob gate) and write the
//     legal tag in the same INSERT (the CHECK ties them; the row gate reads
//     the folder);
//   * keep the body in Supabase in exactly the branches that pin money — a
//     private project's local disk, a NAS workspace, an s3 workspace (I4);
//   * refuse BEFORE any byte moves on a database without 0088 (where LEGAL is
//     an ordinary folder every member can read) and for someone outside the
//     gate — since post-overhaul S4d (0092) the LEGAL gate,
//     can_access_project_legal (the money audience plus workspace managers,
//     Audrey 2026-10-08), never the money gate: the RPC named is pinned.
// The fake client records what would have reached PostgREST, the fake
// providers which store each body went to; every Legal case sits beside an
// ordinary-upload CONTROL from the same branch.
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
const { LEGAL_UNAVAILABLE, LEGAL_GATE_REFUSAL, LEGAL_NOT_CORE_REASON, LEGAL_LOCKED_REASON } = await import('../fileTags')

const PID = 'aaaa1111-0000-0000-0000-000000000001'

/** Every body, by the provider it was put to. */
let puts
function fakeProvider(name) {
  return {
    put: async (path) => { puts.push({ provider: name, path }) },
    get: async () => new Blob(['x']),
    del: async () => {},
    exists: async () => true,
    describe: async () => ({ ok: true }),
  }
}

/**
 * A client: `legal` is what rabbit_money_segment('LEGAL') answers (0088 or
 * not), `gate` what can_access_project_legal answers (0092; the money RPC is
 * never asked — a question for it answers nothing), `isPrivate` the
 * project's flag. Records inserts, updates and RPCs.
 */
function makeClient({ legal = true, gate = true, isPrivate = false, legalError = null, gateError = null, updateError = null, folderRow = 'folder-s1' } = {}) {
  const inserts = []
  const updates = []
  const rpcs = []
  const table = (name) => {
    let op = 'select'
    let payload = null
    let cols = '*'
    const b = {
      select: (c) => { if (op === 'select') cols = c ?? '*'; return b },
      limit: () => b,
      eq: () => b,
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
          updates.push({ table: name, row: payload })
          result = updateError ? { data: null, error: updateError } : { data: { id: 'f1', ...payload }, error: null }
        } else if (name === 'projects' && cols === 'is_private') {
          result = { data: { is_private: isPrivate }, error: null }
        } else if (name === 'folders') {
          // The entity folder EXISTS (review round 1, R1-BEH-11: with no row
          // here "filed in no folder" held with or without the guard).
          result = { data: folderRow ? { id: folderRow } : null, error: null }
        } else {
          result = { data: [], error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  return {
    inserts, updates, rpcs,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (name) => table(name),
    rpc: async (fn, args) => {
      rpcs.push([fn, args])
      if (fn === 'rabbit_money_segment') return legalError ? { data: null, error: legalError } : { data: args.seg === 'LEGAL' ? legal : false, error: null }
      if (fn === 'can_access_project_legal') return gateError ? { data: null, error: gateError } : { data: gate, error: null }
      return { data: null, error: null }
    },
  }
}

const pdf = () => new File(['%PDF-1.4 legal'], 'release form.pdf', { type: 'application/pdf' })
const thirdSegment = (p) => String(p).split('/')[2]

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

describe('uploadFile({ legal: true }) on a database with 0088', () => {
  it('CONTROL: an ordinary project upload goes under its container segment, with no tags sent', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    await supabaseAdapter().uploadFile(PID, { type: 'project' }, pdf())
    expect(thirdSegment(puts[0].path)).toBe('project')
    const row = client.inserts.find(i => i.table === 'files').row
    expect(row).not.toHaveProperty('tags')
    expect(row.is_financial).toBe(false)
  })

  it('puts the body under LEGAL and writes the legal tag in the same row, not is_financial', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    await supabaseAdapter().uploadFile(PID, { type: 'project', legal: true }, pdf())
    expect(puts).toHaveLength(1)
    expect(puts[0].provider).toBe(FILE_PROVIDERS.SUPABASE)
    expect(puts[0].path).toMatch(new RegExp(`^projects/${PID}/LEGAL/${PID}/\\d+-release_form\\.pdf$`))
    const row = client.inserts.find(i => i.table === 'files').row
    expect(row.storage_path).toBe(puts[0].path)
    expect(row.tags).toEqual(['legal'])
    expect(row.is_financial).toBe(false)
    expect(row.storage_provider).toBe(FILE_PROVIDERS.SUPABASE)
  })

  it('is filed in no entity folder, whatever container or folder the scope names', async () => {
    // CONTROL first: the same scene scope, not Legal, finds the scene's folder.
    const control = makeClient()
    globalThis.__testSupabase = control
    await supabaseAdapter().uploadFile(PID, { sceneId: 's1' }, pdf())
    expect(control.inserts.find(i => i.table === 'files').row.folder_id).toBe('folder-s1')
    resetSupabaseAdapter() // the adapter keeps the client it first saw
    const client = makeClient()
    globalThis.__testSupabase = client
    await supabaseAdapter().uploadFile(PID, { sceneId: 's1', legal: true }, pdf())
    const row = client.inserts.find(i => i.table === 'files').row
    expect(thirdSegment(row.storage_path)).toBe('LEGAL')
    expect(row.folder_id).toBeNull()
    // …nor a folder the caller passes.
    resetSupabaseAdapter()
    const passed = makeClient()
    globalThis.__testSupabase = passed
    await supabaseAdapter().uploadFile(PID, { folderId: 'folder-x', legal: true }, pdf())
    expect(passed.inserts.find(i => i.table === 'files').row.folder_id).toBeNull()
  })

  it('Legal AND core is refused before any byte moves (review round 1, R1-BEH-07)', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const before = puts.length
    await expect(supabaseAdapter().uploadFile(PID, { type: 'project', legal: true, isCoreDefiner: true }, pdf()))
      .rejects.toThrow('A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads.')
    expect(puts.length).toBe(before)
    expect(client.inserts).toEqual([])
  })

  it('I4: a private project keeps a Legal body in Supabase (CONTROL: an ordinary file goes to this computer)', async () => {
    const control = makeClient({ isPrivate: true })
    globalThis.__testSupabase = control
    await supabaseAdapter().uploadFile(PID, { type: 'project' }, pdf())
    expect(puts.at(-1).provider).toBe(FILE_PROVIDERS.LOCAL_SERVER)

    resetSupabaseAdapter()
    const client = makeClient({ isPrivate: true })
    globalThis.__testSupabase = client
    await supabaseAdapter().uploadFile(PID, { type: 'project', legal: true }, pdf())
    expect(puts.at(-1).provider).toBe(FILE_PROVIDERS.SUPABASE)
    expect(client.inserts.find(i => i.table === 'files').row.storage_provider).toBe(FILE_PROVIDERS.SUPABASE)
  })

  it('I4: a NAS workspace takes a Legal body into Supabase (CONTROL: an ordinary file is refused)', async () => {
    globalThis.__testStorageRow = { mode: 'byos', provider: 'network' }
    globalThis.__testSupabase = makeClient()
    await expect(supabaseAdapter().uploadFile(PID, { type: 'project' }, pdf()))
      .rejects.toThrow(/stores media on its own server or NAS/)
    expect(puts).toHaveLength(0)

    resetSupabaseAdapter()
    globalThis.__testSupabase = makeClient()
    await supabaseAdapter().uploadFile(PID, { type: 'project', legal: true }, pdf())
    expect(puts.at(-1).provider).toBe(FILE_PROVIDERS.SUPABASE)
  })

  it('I4: an s3 workspace keeps a Legal body in Supabase (CONTROL: an ordinary file goes to the bucket)', async () => {
    globalThis.__testStorageRow = { mode: 'byos', provider: 's3' }
    globalThis.__testSupabase = makeClient()
    await supabaseAdapter().uploadFile(PID, { type: 'project' }, pdf())
    expect(puts.at(-1).provider).toBe(FILE_PROVIDERS.S3)

    resetSupabaseAdapter()
    globalThis.__testSupabase = makeClient()
    await supabaseAdapter().uploadFile(PID, { type: 'project', legal: true }, pdf())
    expect(puts.at(-1).provider).toBe(FILE_PROVIDERS.SUPABASE)
  })
})

describe('refused before any byte moves', () => {
  it('on a database without 0088 (LEGAL is not locked there): the one sentence, nothing put, nothing inserted', async () => {
    const client = makeClient({ legal: false })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().uploadFile(PID, { legal: true }, pdf())).rejects.toThrow(LEGAL_UNAVAILABLE)
    expect(puts).toEqual([])
    expect(client.inserts).toEqual([])
  })

  it('when the probe errors (any doubt is "no")', async () => {
    const client = makeClient({ legalError: { code: 'PGRST202', message: 'no such function' } })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().uploadFile(PID, { legal: true }, pdf())).rejects.toThrow(LEGAL_UNAVAILABLE)
    expect(puts).toEqual([])
  })

  it('for someone outside the Legal gate: the gate\'s sentence, nothing put — and it is the LEGAL gate that was asked (0092)', async () => {
    const client = makeClient({ gate: false })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().uploadFile(PID, { legal: true }, pdf())).rejects.toThrow(LEGAL_GATE_REFUSAL)
    expect(puts).toEqual([])
    expect(client.inserts).toEqual([])
    expect(client.rpcs).toContainEqual(['can_access_project_legal', { p_project: PID }])
    // Never the money gate: a workspace manager without a seat passes the
    // Legal gate and not the money gate, so asking money would refuse the
    // very person 0092 admits.
    expect(client.rpcs.map(r => r[0])).not.toContain('can_access_project_money')
  })

  it('when the Legal gate cannot be asked (an error is a no — it fails CLOSED)', async () => {
    const client = makeClient({ gateError: { code: '42501', message: 'permission denied' } })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().uploadFile(PID, { legal: true }, pdf())).rejects.toThrow(LEGAL_GATE_REFUSAL)
    expect(puts).toEqual([])
    expect(client.inserts).toEqual([])
  })

  it('on a database with 0088 but not 0092 (no such function): refused with the gate\'s sentence, nothing put', async () => {
    const client = makeClient({ gateError: { code: 'PGRST202', message: 'Could not find the function public.can_access_project_legal' } })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().uploadFile(PID, { legal: true }, pdf())).rejects.toThrow(LEGAL_GATE_REFUSAL)
    expect(puts).toEqual([])
    expect(client.inserts).toEqual([])
  })

  it('a file is Legal or an invoice, never both', async () => {
    globalThis.__testSupabase = makeClient()
    await expect(supabaseAdapter().uploadFile(PID, { legal: true, financial: true }, pdf()))
      .rejects.toThrow(/Legal or as an invoice or receipt, not both/)
    expect(puts).toEqual([])
  })

  it('CONTROL: an ordinary upload never asks either question', async () => {
    const client = makeClient({ legal: false, gate: false })
    globalThis.__testSupabase = client
    await supabaseAdapter().uploadFile(PID, { type: 'project' }, pdf())
    expect(client.rpcs.map(r => r[0])).not.toContain('can_access_project_legal')
    expect(client.rpcs.map(r => r[0])).not.toContain('can_access_project_money')
    expect(client.rpcs.map(r => r[0])).not.toContain('rabbit_money_segment')
    expect(puts).toHaveLength(1)
  })
})

describe('supportsLegalFiles', () => {
  it('is true only when the database says the LEGAL folder is locked', async () => {
    globalThis.__testSupabase = makeClient({ legal: true })
    expect(await supabaseAdapter().supportsLegalFiles()).toBe(true)
    resetSupabaseAdapter()
    globalThis.__testSupabase = makeClient({ legal: false })
    expect(await supabaseAdapter().supportsLegalFiles()).toBe(false)
    resetSupabaseAdapter()
    globalThis.__testSupabase = makeClient({ legalError: { message: 'boom' } })
    expect(await supabaseAdapter().supportsLegalFiles()).toBe(false)
  })

  it('remembers a yes for the session (and only a yes)', async () => {
    const client = makeClient({ legal: true })
    globalThis.__testSupabase = client
    await supabaseAdapter().supportsLegalFiles()
    await supabaseAdapter().supportsLegalFiles()
    expect(client.rpcs.filter(r => r[0] === 'rabbit_money_segment')).toHaveLength(1)
    const no = makeClient({ legal: false })
    resetSupabaseAdapter()
    globalThis.__testSupabase = no
    await supabaseAdapter().supportsLegalFiles()
    await supabaseAdapter().supportsLegalFiles()
    expect(no.rpcs.filter(r => r[0] === 'rabbit_money_segment')).toHaveLength(2)
  })
})

describe('the Local Server always keeps Legal files (no database to wait for)', () => {
  // Review round 1, R1-BEH-13: nothing pinned this, and with it false the
  // desktop greyed Add as Legal with the cloud's "migration 0088" sentence.
  it('localServerAdapter().supportsLegalFiles() is true', async () => {
    const { localServerAdapter } = await import('./localServerAdapter')
    expect(await localServerAdapter().supportsLegalFiles()).toBe(true)
  })
})

describe('updateFile says what the Legal CHECKs mean', () => {
  it('files_legal_not_core_chk → the Core sentence', async () => {
    globalThis.__testSupabase = makeClient({
      updateError: { code: '23514', message: 'new row for relation "files" violates check constraint "files_legal_not_core_chk"' },
    })
    await expect(supabaseAdapter().updateFile('f1', { is_core_definer: true, project_id: PID }))
      .rejects.toThrow(LEGAL_NOT_CORE_REASON)
  })

  it('files_legal_folder_chk → "Added as Legal…"', async () => {
    globalThis.__testSupabase = makeClient({
      updateError: { code: '23514', message: 'new row for relation "files" violates check constraint "files_legal_folder_chk"' },
    })
    await expect(supabaseAdapter().updateFile('f1', { description: 'x', project_id: PID }))
      .rejects.toThrow(LEGAL_LOCKED_REASON)
  })

  it('files_legal_folder_chk on a write that ADDS legal → "chosen when a file is added" (R1-BEH-08)', async () => {
    globalThis.__testSupabase = makeClient({
      updateError: { code: '23514', message: 'new row for relation "files" violates check constraint "files_legal_folder_chk"' },
    })
    await expect(supabaseAdapter().updateFile('f2', { tags: ['legal', 'code'], project_id: PID }))
      .rejects.toThrow('Legal is chosen when a file is added.')
  })

  it('CONTROL: any other refusal keeps its own words', async () => {
    globalThis.__testSupabase = makeClient({ updateError: { code: '42501', message: 'permission denied' } })
    await expect(supabaseAdapter().updateFile('f1', { description: 'x', project_id: PID }))
      .rejects.toThrow('[supabase] permission denied')
  })
})
