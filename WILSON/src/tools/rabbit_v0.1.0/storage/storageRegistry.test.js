// =============================================================================
// storageRegistry.test.js — Session 36.
//
// The registry's contract, and the two places it must agree with something
// outside itself: migration 0050's provider CHECK, and the money invariant's
// database twin. Both are read as TEXT (the folderParity.test.js idiom) —
// there is no way to run Postgres here, and an agreement maintained only by
// comment is how 0038 shipped its gate inverted.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORKSPACE_PROVIDERS,
  WORKSPACE_PROVIDER_VALUES,
  FILE_PROVIDERS,
  fileProviderFor,
  registerStorageProvider,
  getStorageProvider,
  hasStorageProvider,
  resolveFileProvider,
  __resetStorageRegistry,
} from './index'
import { createSupabaseStorageProvider } from './supabaseProvider'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const migration = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '0050_storage_provider_registry.sql'),
  'utf8',
)

const stub = () => ({
  put: async () => ({ key: 'k' }),
  get: async () => new Blob([]),
  del: async () => {},
  exists: async () => true,
  describe: async () => ({ provider: 'x' }),
})

beforeEach(() => { __resetStorageRegistry() })

describe('the money invariant (§4a2b invariant 2)', () => {
  // 🚨 Table-driven over EVERY workspace provider, present and future. A
  // provider added to WORKSPACE_PROVIDERS without thinking about money fails
  // here rather than in production, which is the whole point: this is the one
  // invariant whose failure is silent and expensive.
  it.each(WORKSPACE_PROVIDER_VALUES)(
    'a financial file is pinned to Supabase even when the workspace chose %s',
    (provider) => {
      expect(fileProviderFor(provider, { financial: true }))
        .toBe(FILE_PROVIDERS.SUPABASE)
    },
  )

  it('is enforced in the database too, not only here', () => {
    // Refusals in depth (the S34 rule). If the constraint is ever dropped the
    // client pin alone would still look correct.
    //
    // 🚨 Asserted against the CHECK BODY, not the whole file. The first draft
    // did `expect(migration).toContain('is_financial')`, which the migration's
    // own explanatory prose satisfies — so deleting the arm from the actual
    // constraint left this test green. Caught by S36's adversarial review.
    const body = migration.match(
      /ADD CONSTRAINT files_money_provider_chk\s+CHECK \(([\s\S]*?)\n      \);/,
    )
    expect(body, 'files_money_provider_chk not found in 0050').toBeTruthy()
    const check = body[1]
    // BOTH axes, each inside the predicate itself.
    expect(check).toContain('COALESCE(is_financial, false)')
    expect(check).toContain('public.rabbit_money_segment')
    expect(check).toContain("storage_provider = 'supabase'")
  })

  it('does not pin ordinary files, or BYO storage would be impossible', () => {
    expect(fileProviderFor(WORKSPACE_PROVIDERS.NETWORK, { financial: false }))
      .toBe(FILE_PROVIDERS.LOCAL_SERVER)
  })
})

describe('the provider vocabulary agrees with migration 0050', () => {
  // The client list and the CHECK constraint are two spellings of one
  // decision. This is the wiring test that stops them drifting — and it is
  // also what will fail, deliberately and usefully, when S37 adds 's3' to one
  // side and forgets the other.
  it('lists exactly the providers the CHECK allows', () => {
    const m = migration.match(/CHECK \(provider IN \(([^)]*)\)\)/)
    expect(m, 'workspace_storage_provider_chk not found in 0050').toBeTruthy()
    const sqlValues = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(sqlValues).toEqual([...WORKSPACE_PROVIDER_VALUES].sort())
  })

  it('ships no provider it cannot resolve', () => {
    // S36's promise: gdrive and s3 arrive WITH their adapters (S38 / S37),
    // never ahead of them. A value in the schema that no registry entry can
    // serve is the "looks configured, resolves nowhere" failure §4a2b names.
    expect(WORKSPACE_PROVIDER_VALUES).not.toContain('gdrive')
    expect(WORKSPACE_PROVIDER_VALUES).not.toContain('s3')
  })

  it('maps every workspace provider to a real file-provider value', () => {
    for (const p of WORKSPACE_PROVIDER_VALUES) {
      expect(Object.values(FILE_PROVIDERS)).toContain(fileProviderFor(p))
    }
  })

  it('refuses an unknown provider loudly rather than defaulting', () => {
    expect(() => fileProviderFor('dropbox')).toThrow(/unknown storage provider/)
  })
})

describe('registration refuses the googleDriveAdapter shape', () => {
  it('accepts a complete four-function provider', () => {
    registerStorageProvider(FILE_PROVIDERS.SUPABASE, stub())
    expect(hasStorageProvider(FILE_PROVIDERS.SUPABASE)).toBe(true)
  })

  it.each(['put', 'get', 'del', 'exists', 'describe'])(
    'refuses a provider missing %s', (fn) => {
      const partial = stub()
      delete partial[fn]
      expect(() => registerStorageProvider(FILE_PROVIDERS.SUPABASE, partial))
        .toThrow(new RegExp(fn))
    },
  )

  it('refuses a provider name the files enum does not have', () => {
    expect(() => registerStorageProvider('dropbox', stub())).toThrow(/unknown storage provider/)
  })
})

describe('a body is resolved from the ROW, not from the session', () => {
  it('routes to the provider the file row names', () => {
    const sb = stub()
    registerStorageProvider(FILE_PROVIDERS.SUPABASE, sb)
    expect(resolveFileProvider({ storage_provider: 'supabase' })).toBe(sb)
  })

  it('refuses a row that names no provider instead of guessing', () => {
    // Guessing is exactly the pre-S36 behaviour: every adapter fetched from
    // its own backend unconditionally, which orphans anything written under a
    // previous provider.
    expect(() => resolveFileProvider({ storage_path: 'projects/a/x' }))
      .toThrow(/names no storage provider/)
  })

  it('refuses a provider that was never registered', () => {
    expect(() => resolveFileProvider({ storage_provider: 'google_drive' }))
      .toThrow(/no storage provider registered/)
  })
})

describe('the Supabase provider satisfies the contract', () => {
  const calls = []
  const fakeBucket = {
    upload: async (k) => { calls.push(['upload', k]); return { error: null } },
    download: async (k) => { calls.push(['download', k]); return { data: new Blob(['x']), error: null } },
    remove: async (k) => { calls.push(['remove', k]); return { error: null } },
    list: async (dir, opts) => { calls.push(['list', dir, opts.search]); return { data: [{ name: 'f.mov' }], error: null } },
  }
  const requireClient = async () => ({ storage: { from: () => fakeBucket } })

  it('exposes all four functions plus describe', () => {
    const p = createSupabaseStorageProvider(requireClient)
    for (const fn of ['put', 'get', 'del', 'exists', 'describe']) {
      expect(typeof p[fn]).toBe('function')
    }
  })

  it('splits a key into directory and leaf for exists()', async () => {
    calls.length = 0
    const p = createSupabaseStorageProvider(requireClient)
    await expect(p.exists('projects/p1/asset/a1/f.mov')).resolves.toBe(true)
    expect(calls).toEqual([['list', 'projects/p1/asset/a1', 'f.mov']])
  })

  it('reports a missing key as false rather than throwing', async () => {
    const empty = { ...fakeBucket, list: async () => ({ data: [], error: null }) }
    const p = createSupabaseStorageProvider(async () => ({ storage: { from: () => empty } }))
    await expect(p.exists('projects/p1/asset/a1/gone.mov')).resolves.toBe(false)
  })

  it('never silently overwrites — upsert stays false', async () => {
    let opts = null
    const capture = { ...fakeBucket, upload: async (k, b, o) => { opts = o; return { error: null } } }
    const p = createSupabaseStorageProvider(async () => ({ storage: { from: () => capture } }))
    await p.put('projects/p1/asset/a1/f.mov', new Blob(['x']))
    expect(opts.upsert).toBe(false)
  })

  it('throws on a storage error instead of resolving (the otterFetch trap)', async () => {
    const broken = { ...fakeBucket, download: async () => ({ data: null, error: { message: 'nope' } }) }
    const p = createSupabaseStorageProvider(async () => ({ storage: { from: () => broken } }))
    await expect(p.get('projects/p1/x')).rejects.toThrow(/download failed/)
  })
})

describe('the adapter actually calls the registry (no dead path)', () => {
  // Seven features have shipped in this repo with no caller. The registry
  // having a live one is the point of routing Supabase through it in S36
  // rather than waiting for S37, so pin the call sites as text.
  const adapter = readFileSync(
    join(__dirname, '..', 'adapters', 'supabaseAdapter.js'), 'utf8',
  )

  it('stamps storage_provider from fileProviderFor, not a literal', () => {
    expect(adapter).toContain('fileProviderFor(WORKSPACE_PROVIDERS.PETAL')
    expect(adapter).toContain('storage_provider: storageProvider')
    expect(adapter).not.toContain("storage_provider: 'supabase'")
  })

  it('passes the money flag from the same scope that picks the INVOICES segment', () => {
    expect(adapter).toContain('financial: !!scope.financial')
  })

  it('downloads through resolveFileProvider', () => {
    expect(adapter).toContain('resolveFileProvider(file).get(file.storage_path)')
  })
})
