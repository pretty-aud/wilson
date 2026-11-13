// =============================================================================
// edgeBucketLoader.test.js — F8 (wave 2, 2026-11-13): the shared bucket loader
// (_shared/workspaceBucket.ts) on its own.
//
// storage-presign, storage-read-urls and storage-secret load a company's own
// S3 bucket through loadWorkspaceBucket, and storage-secret's `set` reads the
// configuration half through readWorkspaceBucketConfig. edgeStorage.test.js
// holds what each FUNCTION answers; this file holds the loader's own contract:
// its seven coded refusals and their order, who reads what (the service
// client, the workspace it is handed, each caller's column list), the two
// reads at once, a throwing read met where it was met before, and a success
// that carries the configuration's six fields and nothing else of the row.
//
// The client is edgeHarness.js's fake (no network). Every key is random bytes
// made here for one test.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { newWorld, createClient, SUPABASE_URL, SERVICE_KEY } from './edgeHarness.js'
import { loadWorkspaceBucket, readWorkspaceBucketConfig, s3TargetOf } from '../../supabase/functions/_shared/workspaceBucket.ts'
import { encryptStorageSecret } from '../../supabase/functions/_shared/storageSecretCrypto.ts'

const ST = 'WILSON_STORAGE_KEY_SECRET'
const WS = 'ws-guard-verified'
const CFG = { endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: 'petal-media', prefix: 'wilson', accessKeyId: 'AKIDLOADER', forcePathStyle: true }
const row = (mode = 'byos', cfg = CFG) => ({ mode, provider: 's3', provider_config: cfg })

afterEach(() => { delete process.env[ST] })

/** A world whose two tables answer as told; `admin` is a service client over it. */
function scene({ ws = row(), wsError = null, sec = 'SEALED', secError = null } = {}) {
  const w = newWorld()
  w.table('workspace_storage', () => ({ data: ws, error: wsError }))
  w.table('workspace_storage_secrets', () => ({ data: sec, error: secError }))
  return { w, admin: createClient(SUPABASE_URL, SERVICE_KEY) }
}
const statements = (w) => w.calls.map((c) => ({ name: c.name, columns: c.columns, filters: c.filters, terminal: c.terminal, by: c.by }))
const stmt = (name, columns) => ({ name, columns, filters: [{ f: 'eq', column: 'workspace_id', value: WS }], terminal: 'maybeSingle', by: 'service' })

async function sealed(plain = 'bucket-secret-loader') {
  process.env[ST] = randomBytes(32).toString('base64')
  return { secret_ciphertext: await encryptStorageSecret(plain) }
}

describe('loadWorkspaceBucket: the seven refusals, each by its code, in the old order', () => {
  it('1. storage_read_failed: the configuration read errors (its message carried)', async () => {
    const { admin } = scene({ wsError: { message: 'connection reset' } })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'storage_read_failed', message: 'connection reset' })
  })
  it('2. not_s3: no row, another provider, no provider_config', async () => {
    for (const ws of [null, { mode: 'byos', provider: 'supabase', provider_config: CFG }, { mode: 'byos', provider: 's3', provider_config: null }]) {
      const { admin } = scene({ ws, sec: await sealed() })
      expect(await loadWorkspaceBucket(admin, WS, { requireByos: true })).toEqual({ ok: false, code: 'not_s3' })
    }
  })
  it('3. not_active: requireByos and a mode that is not byos; without requireByos the same row loads', async () => {
    const sec = await sealed()
    for (const mode of ['cloud', null, 'BYOS']) {
      const { admin } = scene({ ws: row(mode), sec })
      expect(await loadWorkspaceBucket(admin, WS, { requireByos: true })).toEqual({ ok: false, code: 'not_active' })
      const again = scene({ ws: row(mode), sec })
      expect((await loadWorkspaceBucket(again.admin, WS, { requireByos: false })).ok).toBe(true)
    }
  })
  it('4. crypto_unavailable: no master key of any version (asked by default); preflightCrypto false never asks it', async () => {
    const sec = await sealed()
    delete process.env[ST]
    const { admin } = scene({ sec })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'crypto_unavailable' })
    // The probe's way: the unset key surfaces from the decrypt, naming the secret…
    const p = scene({ sec })
    expect(await loadWorkspaceBucket(p.admin, WS, { requireByos: false, preflightCrypto: false }))
      .toEqual({ ok: false, code: 'secret_unusable', message: `${ST} is not configured` })
    // …or not at all when no secret is stored.
    const q = scene({ sec: null })
    expect(await loadWorkspaceBucket(q.admin, WS, { requireByos: false, preflightCrypto: false })).toEqual({ ok: false, code: 'no_secret' })
  })
  it('5. secret_read_failed: the secret read errors (its message carried)', async () => {
    process.env[ST] = randomBytes(32).toString('base64')
    const { admin } = scene({ sec: null, secError: { message: 'permission denied' } })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'secret_read_failed', message: 'permission denied' })
  })
  it('6. no_secret: no row, an empty ciphertext, a null one (never "cannot be decrypted")', async () => {
    process.env[ST] = randomBytes(32).toString('base64')
    for (const sec of [null, { secret_ciphertext: '' }, { secret_ciphertext: null }, {}]) {
      const { admin } = scene({ sec })
      expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'no_secret' })
    }
  })
  it('7. secret_unusable: the decrypt\'s own words, whatever made it fail', async () => {
    const good = await sealed()
    process.env[ST] = randomBytes(32).toString('base64') // another key now
    for (const [sec, message] of [
      [good, 'The operation failed for an operation-specific reason'],
      [{ secret_ciphertext: Buffer.from('short').toString('base64') }, 'storage secret envelope is truncated'],
      [{ secret_ciphertext: 'not base64!' }, 'Invalid character'],
      [{ secret_ciphertext: 'v3.AAAA' }, `${ST}_V3 is not configured`],
    ]) {
      const { admin } = scene({ sec })
      expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'secret_unusable', message })
    }
    // A malformed master key is "present" (no 503) and fails here, as before (F8-10).
    process.env[ST] = 'tooshort'
    const { admin } = scene({ sec: good })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false }))
      .toEqual({ ok: false, code: 'secret_unusable', message: `${ST} must decode to exactly 32 bytes (got 6)` })
  })

  it('the order when several are wrong at once (DESIGN.md §13 item 12)', async () => {
    delete process.env[ST]
    const cases = [
      // the configuration read failing beats everything
      [{ wsError: { message: 'a' }, ws: null, secError: { message: 'b' } }, { requireByos: true }, { ok: false, code: 'storage_read_failed', message: 'a' }],
      // not S3 beats not active, no master key and a failing secret read
      [{ ws: null, secError: { message: 'b' } }, { requireByos: true }, { ok: false, code: 'not_s3' }],
      // a put on a retained configuration with no master key: not active, not 503
      [{ ws: row('cloud'), sec: null }, { requireByos: true }, { ok: false, code: 'not_active' }],
      // no master key beats the secret read failing and no secret
      [{ secError: { message: 'b' } }, { requireByos: false }, { ok: false, code: 'crypto_unavailable' }],
      [{ sec: null }, { requireByos: false }, { ok: false, code: 'crypto_unavailable' }],
    ]
    for (const [world, opts, expected] of cases) {
      const { admin } = scene(world)
      expect(await loadWorkspaceBucket(admin, WS, opts)).toEqual(expected)
    }
    process.env[ST] = randomBytes(32).toString('base64')
    // the secret read failing beats a row it may also have carried
    const { admin } = scene({ sec: { secret_ciphertext: 'x' }, secError: { message: 'b' } })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'secret_read_failed', message: 'b' })
  })
})

describe('loadWorkspaceBucket: what it reads, and how', () => {
  it('both statements by the SERVICE client, on the workspace it is handed, the secret asked before the configuration answered', async () => {
    const sec = await sealed()
    const w = newWorld()
    let secretAskedFirst = null
    w.table('workspace_storage', async () => {
      await new Promise((r) => setTimeout(r, 5))
      secretAskedFirst = w.calls.some((c) => c.name === 'workspace_storage_secrets')
      return { data: row(), error: null }
    })
    w.table('workspace_storage_secrets', () => ({ data: sec, error: null }))
    const out = await loadWorkspaceBucket(createClient(SUPABASE_URL, SERVICE_KEY), WS, { requireByos: false, withMode: true })
    expect(out.ok).toBe(true)
    expect(secretAskedFirst).toBe(true)
    expect(statements(w)).toEqual([stmt('workspace_storage', 'mode, provider, provider_config'), stmt('workspace_storage_secrets', 'secret_ciphertext')])
  })
  it('each caller\'s column list: mode only when asked for (withMode, or implied by requireByos)', async () => {
    const sec = await sealed()
    for (const [opts, columns] of [
      [{ requireByos: false }, 'provider, provider_config'],
      [{ requireByos: false, preflightCrypto: false }, 'provider, provider_config'],
      [{ requireByos: false, withMode: true }, 'mode, provider, provider_config'],
      [{ requireByos: true }, 'mode, provider, provider_config'],
    ]) {
      const { w, admin } = scene({ sec })
      await loadWorkspaceBucket(admin, WS, opts)
      expect(statements(w)[0].columns).toBe(columns)
    }
  })
  it('both statements are made even when the configuration refuses (the secret read is not looked at)', async () => {
    const { w, admin } = scene({ ws: null, sec: { secret_ciphertext: 'never opened' } })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: false })).toEqual({ ok: false, code: 'not_s3' })
    expect(statements(w).map((s) => s.name)).toEqual(['workspace_storage', 'workspace_storage_secrets'])
  })
})

describe('loadWorkspaceBucket: a read that throws is met where it was met before (the configuration first, the secret\'s caught)', () => {
  it('the secret read throws beside no S3 configuration: not_s3, and no unhandled rejection', async () => {
    const unhandled = []
    const on = (e) => unhandled.push(e)
    process.on('unhandledRejection', on)
    try {
      const { w, admin } = scene({ ws: null })
      w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
      await expect(loadWorkspaceBucket(admin, WS, { requireByos: true })).resolves.toEqual({ ok: false, code: 'not_s3' })
      const b = scene({ ws: row('cloud') })
      b.w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
      await expect(loadWorkspaceBucket(b.admin, WS, { requireByos: true })).resolves.toEqual({ ok: false, code: 'not_active' })
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      process.off('unhandledRejection', on)
    }
    expect(unhandled).toEqual([])
  })
  it('the secret read throws once the configuration has passed: the throw is passed on', async () => {
    process.env[ST] = randomBytes(32).toString('base64')
    const { w, admin } = scene()
    w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
    await expect(loadWorkspaceBucket(admin, WS, { requireByos: false })).rejects.toThrow('the socket closed')
  })
  it('the configuration read throws: passed on, whatever the secret read did', async () => {
    const { w, admin } = scene()
    w.table('workspace_storage', () => { throw new Error('the pool is gone') })
    await expect(loadWorkspaceBucket(admin, WS, { requireByos: false })).rejects.toThrow('the pool is gone')
  })
})

// Review round 1, S1: the refusals the configuration alone decides were answered
// before the secret table was asked at a71cd144. Both reads are still STARTED at
// once (the statement order above), but those four refusals must not wait for the
// secret's answer, and a secret read that fails after one was given must not be
// left unhandled.
describe('loadWorkspaceBucket: what the configuration alone refuses is answered without waiting for the secret (S1)', () => {
  const CONFIG_ONLY = [
    ['storage_read_failed', { wsError: { message: 'connection reset' } }, { requireByos: false }, { ok: false, code: 'storage_read_failed', message: 'connection reset' }],
    ['not_s3', { ws: null }, { requireByos: true }, { ok: false, code: 'not_s3' }],
    ['not_active', { ws: row('cloud') }, { requireByos: true }, { ok: false, code: 'not_active' }],
    ['crypto_unavailable', {}, { requireByos: false }, { ok: false, code: 'crypto_unavailable' }],
  ]
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('still waiting'), ms))])

  it.each(CONFIG_ONLY)('%s, beside a secret read that never answers', async (_code, world, opts, expected) => {
    delete process.env[ST]
    const { w, admin } = scene(world)
    w.table('workspace_storage_secrets', () => new Promise(() => {}))
    expect(await within(loadWorkspaceBucket(admin, WS, opts), 200)).toEqual(expected)
    // The secret read was still started, after the configuration's.
    expect(statements(w).map((s) => s.name)).toEqual(['workspace_storage', 'workspace_storage_secrets'])
  })

  it.each(CONFIG_ONLY)('%s, beside a secret read that fails after the answer: nothing left unhandled', async (_code, world, opts, expected) => {
    delete process.env[ST]
    const unhandled = []
    const on = (e) => unhandled.push(e)
    process.on('unhandledRejection', on)
    try {
      const { w, admin } = scene(world)
      let failNow
      w.table('workspace_storage_secrets', () => new Promise((_, reject) => { failNow = () => reject(new Error('the socket closed late')) }))
      const out = loadWorkspaceBucket(admin, WS, opts)
      expect(await within(out, 200)).toEqual(expected)
      failNow()
      await new Promise((r) => setTimeout(r, 25))
    } finally {
      process.off('unhandledRejection', on)
    }
    expect(unhandled).toEqual([])
  })

  it('once the configuration has passed, the secret IS waited for (a slow secret read is still read)', async () => {
    const sec = await sealed('the-slow-secret')
    const { w, admin } = scene()
    w.table('workspace_storage_secrets', () => new Promise((r) => setTimeout(() => r({ data: sec, error: null }), 30)))
    const out = await loadWorkspaceBucket(admin, WS, { requireByos: false })
    expect(out).toMatchObject({ ok: true, secret: 'the-slow-secret' })
  })
})

describe('loadWorkspaceBucket: success', () => {
  it('the configuration\'s six fields at the top level, the signer\'s target, the opened secret, the mode; nothing else of the row', async () => {
    const sec = await sealed('the-opened-secret')
    const { admin } = scene({ ws: row('byos', { ...CFG, secretAccessKey: 'must-not-travel', extra: 1 }), sec })
    expect(await loadWorkspaceBucket(admin, WS, { requireByos: true })).toEqual({
      ok: true,
      endpoint: CFG.endpoint, region: CFG.region, bucket: CFG.bucket, prefix: CFG.prefix, accessKeyId: CFG.accessKeyId, forcePathStyle: true,
      target: { endpoint: CFG.endpoint, region: CFG.region, bucket: CFG.bucket, forcePathStyle: true },
      secret: 'the-opened-secret',
      mode: 'byos',
    })
  })
  it('mode is null when it was not read', async () => {
    const sec = await sealed()
    const { admin } = scene({ ws: { provider: 's3', provider_config: CFG }, sec })
    expect((await loadWorkspaceBucket(admin, WS, { requireByos: false })).mode).toBeNull()
  })
  it('s3TargetOf takes the four fields the signer reads', () => {
    expect(s3TargetOf({ ...CFG, prefix: 'p' })).toEqual({ endpoint: CFG.endpoint, region: CFG.region, bucket: CFG.bucket, forcePathStyle: true })
  })
})

describe('readWorkspaceBucketConfig (storage-secret\'s save)', () => {
  it('one statement, no mode, on the workspace handed in; not S3 is an answer, not a refusal', async () => {
    // The row as `provider, provider_config` returns it (the fake answers what it is given).
    let s = scene({ ws: { provider: 's3', provider_config: CFG } })
    expect(await readWorkspaceBucketConfig(s.admin, WS)).toEqual({
      ok: true, s3: true, mode: null, config: CFG, target: s3TargetOf(CFG),
    })
    expect(statements(s.w)).toEqual([stmt('workspace_storage', 'provider, provider_config')])
    for (const ws of [null, { provider: 'supabase', provider_config: null }, { provider: 's3', provider_config: null }]) {
      s = scene({ ws })
      expect(await readWorkspaceBucketConfig(s.admin, WS)).toEqual({ ok: true, s3: false, mode: null })
    }
    s = scene({ wsError: { message: 'gone' } })
    expect(await readWorkspaceBucketConfig(s.admin, WS)).toEqual({ ok: false, code: 'storage_read_failed', message: 'gone' })
    s = scene({ ws: row('cloud') })
    expect((await readWorkspaceBucketConfig(s.admin, WS, { withMode: true })).mode).toBe('cloud')
    expect(statements(s.w)[0].columns).toBe('mode, provider, provider_config')
  })
})
