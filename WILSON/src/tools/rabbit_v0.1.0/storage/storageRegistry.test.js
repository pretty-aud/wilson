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
  activeWorkspaceProvider,
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
// S37 widens the provider vocabulary by DROP + re-ADD in its own migration,
// so the EFFECTIVE constraint lives in 0051 — 0050's text deliberately keeps
// its original two values (a wrapped re-ADD there no-ops on replay).
const migration51 = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '0051_s3_storage_provider.sql'),
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

describe('the provider vocabulary agrees with the migrations', () => {
  // The client list and the CHECK constraint are two spellings of one
  // decision. This is the wiring test that stops them drifting — it failed,
  // deliberately and usefully, the moment S37 added 's3' to the client side,
  // and it now parses the EFFECTIVE constraint from 0051.
  it('lists exactly the providers the widened CHECK allows (0051)', () => {
    const m = migration51.match(/CHECK \(provider IN \(([^)]*)\)\)/)
    expect(m, 'workspace_storage_provider_chk not found in 0051').toBeTruthy()
    const sqlValues = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(sqlValues).toEqual([...WORKSPACE_PROVIDER_VALUES].sort())
  })

  it('widens by explicit DROP, never a wrapped re-ADD (the replay no-op trap)', () => {
    // S36 measured it: every wrapped ADD CONSTRAINT is a silent no-op against
    // a database that already carries the name, so a wrapped "widening" would
    // apply cleanly everywhere and change nothing anywhere.
    expect(migration51).toContain(
      'DROP CONSTRAINT IF EXISTS workspace_storage_provider_chk',
    )
  })

  it('0050 still shows its original two-value CHECK, untouched', () => {
    const m = migration.match(/CHECK \(provider IN \(([^)]*)\)\)/)
    expect(m).toBeTruthy()
    const sqlValues = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(sqlValues).toEqual(['network', 'petal'])
  })

  it('ships no provider it cannot resolve', () => {
    // S36's promise: a provider value arrives WITH its adapter, never ahead
    // of it. 's3' is in the vocabulary because S37 shipped its adapter in the
    // same commit; gdrive stays out until S38 does the same.
    expect(WORKSPACE_PROVIDER_VALUES).not.toContain('gdrive')
    expect(WORKSPACE_PROVIDER_VALUES).toContain('s3')
    expect(fileProviderFor(WORKSPACE_PROVIDERS.S3)).toBe(FILE_PROVIDERS.S3)
  })

  it('maps every workspace provider to a real file-provider value', () => {
    for (const p of WORKSPACE_PROVIDER_VALUES) {
      expect(Object.values(FILE_PROVIDERS)).toContain(fileProviderFor(p))
    }
  })

  it('refuses an unknown provider loudly rather than defaulting', () => {
    expect(() => fileProviderFor('dropbox')).toThrow(/unknown storage provider/)
  })

  it('0051 adds the s3 value to the files enum alongside the client entry', () => {
    expect(migration51).toContain(
      "ALTER TYPE public.storage_provider ADD VALUE IF NOT EXISTS 's3'",
    )
  })
})

describe('activeWorkspaceProvider — which provider accepts NEW bodies', () => {
  it('an unconfigured workspace is Petal cloud (today\'s behaviour exactly)', () => {
    expect(activeWorkspaceProvider(null)).toBe(WORKSPACE_PROVIDERS.PETAL)
    expect(activeWorkspaceProvider(undefined)).toBe(WORKSPACE_PROVIDERS.PETAL)
  })

  it('central means Petal cloud NOW, whatever provider is retained', () => {
    // The 0048/0050 retained states: remembered, inert. Forcing these back
    // to 'petal' in the DB was S36's first-draft biconditional bug; treating
    // them as ACTIVE here would be the same bug from the other side.
    expect(activeWorkspaceProvider({ mode: 'central', provider: 'network', root_path: '\\\\nas\\p\\w' }))
      .toBe(WORKSPACE_PROVIDERS.PETAL)
    expect(activeWorkspaceProvider({ mode: 'central', provider: 's3', provider_config: { bucket: 'b' } }))
      .toBe(WORKSPACE_PROVIDERS.PETAL)
  })

  it('byos returns the configured provider', () => {
    expect(activeWorkspaceProvider({ mode: 'byos', provider: 'network' }))
      .toBe(WORKSPACE_PROVIDERS.NETWORK)
    expect(activeWorkspaceProvider({ mode: 'byos', provider: 's3' }))
      .toBe(WORKSPACE_PROVIDERS.S3)
  })

  it('byos with no real provider fails CLOSED with a sentence, never "petal"', () => {
    // Defaulting would silently route media to a store the customer moved
    // away from — the exact failure §4a2b exists to prevent. The DB refuses
    // this shape (mode_provider_chk); seeing it means a malformed row.
    expect(() => activeWorkspaceProvider({ mode: 'byos' })).toThrow(/names no provider/)
    expect(() => activeWorkspaceProvider({ mode: 'byos', provider: 'petal' })).toThrow(/names no provider/)
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

  it('stamps storage_provider from fileProviderFor over the ACTIVE provider', () => {
    // S37: S36's constant became one argument, as its comment promised — the
    // workspace's cached storage choice, resolved through the one definition
    // of "active" (mode gates retained state).
    expect(adapter).toContain('const storageChoice = await getWorkspaceStorageCached()')
    expect(adapter).toContain('activeWorkspaceProvider(storageChoice)')
    expect(adapter).toContain('fileProviderFor(activeProvider')
    expect(adapter).toContain('storage_provider: storageProvider')
    expect(adapter).not.toContain("storage_provider: 'supabase'")
    // The constant must be GONE — a merge that resurrects it silently
    // re-pins every workspace to Petal cloud.
    expect(adapter).not.toContain('fileProviderFor(WORKSPACE_PROVIDERS.PETAL')
  })

  it('refuses a network workspace with a sentence, never routes it', () => {
    // The one workspace provider with no CLOUD-side implementation (S36's
    // review): 'network' maps to local_server. Since 2026-09-11 the desktop
    // registers that provider (localServerProvider.js) for PRIVATE projects,
    // but a whole workspace on 'network' still has no cloud upload path and
    // keeps this refusal — the sentence names what the user can do.
    expect(adapter).toContain("activeProvider === WORKSPACE_PROVIDERS.NETWORK")
    expect(adapter).toContain('Local Server mode')
  })

  it('registers the s3 provider beside supabase at module load', () => {
    expect(adapter).toContain('createS3StorageProvider(presignStorage)')
    expect(adapter).toContain('FILE_PROVIDERS.S3')
  })

  it('registers the local_server provider too (2026-09-11), so a private project\'s row resolves to a sentence off the desktop', () => {
    expect(adapter).toContain('createLocalServerStorageProvider()')
    expect(adapter).toContain('FILE_PROVIDERS.LOCAL_SERVER,')
  })

  it('passes the money flag from the same scope that picks the INVOICES segment', () => {
    expect(adapter).toContain('financial: !!scope.financial')
  })

  it('downloads through resolveFileProvider', () => {
    expect(adapter).toContain('resolveFileProvider(file).get(file.storage_path)')
  })
})
