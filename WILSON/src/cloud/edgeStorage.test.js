// =============================================================================
// edgeStorage.test.js — F8 (wave 2, 2026-11-13): how three Edge Functions load
// a company's own S3 bucket, pinned exactly as they behave BEFORE F8.
//
// storage-presign, storage-read-urls and storage-secret each read the
// workspace's bucket configuration (workspace_storage) and its sealed secret
// (workspace_storage_secrets), open the secret, and sign or probe. F8 moves the
// three onto one shared loader. This file runs the REAL index.ts of each
// (src/cloud/edgeHarness.js stands in for Deno and the database) and holds
// every status, error code, sentence and signed URL they answer today, so the
// refactor can prove nothing a caller sees has moved.
//
// The code as it stood at a71cd144 is the oracle: every test here passed
// against it. Two numbers are the measurement of the review's C5 and are
// edited by the commit that lowers them: BATCH_HMAC_SIGNS (a batch of 100 read
// URLs) and PROBE_HMAC_SIGNS (storage-secret's bucket test).
//
// Rules kept here: no real network (global fetch is stubbed and any URL not
// scripted fails the test), the clock is frozen so signed URLs compare byte for
// byte with presignS3Request called directly, and every key is random bytes
// made in this file for one test — nobody's secret.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { newWorld, seatCaller, loadFunction, post, answerOf } from './edgeHarness.js'
import { presignS3Request } from '../../supabase/functions/_shared/s3Presign.ts'
import { encryptStorageSecret, decryptStorageSecret } from '../../supabase/functions/_shared/storageSecretCrypto.ts'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

// The HMAC work of signing, counted (the review's C5). Each presignS3Request
// does five HMACs: four to derive the signing key (date, region, service,
// aws4_request) and one to sign. Measured at a71cd144: a batch of 100 read URLs
// is 500 (the key derived 100 times), and the full-success probe, which signs
// six URLs (server PUT, GET, DELETE; client PUT, GET, DELETE), is 30. The
// commit that derives the key once per batch edits these two numbers.
const BATCH_HMAC_SIGNS = 500
const PROBE_HMAC_SIGNS = 30

const ST = 'WILSON_STORAGE_KEY_SECRET'
const ST_V2 = `${ST}_V2`
const ENV_NAMES = [ST, ST_V2]
const NOW = new Date('2026-11-13T03:00:00Z')
const PID = '11111111-2222-4333-8444-555555555555'
const PATH = `projects/${PID}/shots/shot-1/1700000000-frame.exr`
const BUCKET_SECRET = 'harness-bucket-secret-9f2c'
const PUBLIC_IP = '93.184.216.34'

// A custom endpoint, path style: the vetted host is the endpoint's own.
const CFG = {
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  bucket: 'petal-media',
  prefix: 'wilson',
  accessKeyId: 'AKIDHARNESS',
  forcePathStyle: true,
}
// Bare AWS, virtual-host style: the vetted host is the bucket's subdomain.
const CFG_AWS = { region: 'eu-central-1', bucket: 'petal-media', accessKeyId: 'AKIDHARNESS' }

const S = {
  noS3: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage',
  inactive: 'this workspace is on Petal cloud right now — its S3 configuration is retained but inactive, so new files do not go to the bucket',
  noCrypto: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment',
  noSecret: 'no bucket secret is stored for this workspace — an admin saves it in Admin Terminal → Storage',
  unusable: (m) => `the stored bucket secret cannot be decrypted (${m}) — re-enter it in Admin Terminal → Storage`,
  gcmFailed: 'The operation failed for an operation-specific reason',
}

let KEY
let OTHER_KEY
let currentNet = null

beforeEach(() => {
  KEY = randomBytes(32).toString('base64')
  OTHER_KEY = randomBytes(32).toString('base64')
  // Set in Node's environment as the brief asks — but see `deno wins` below:
  // once loadFunction has stood Deno in, readEnv (keyVersions.ts:44) asks
  // Deno.env.get and returns its answer `?? ''`, so process.env is NEVER the
  // fallback while Deno exists. The function sees only loadFunction's env.
  process.env[ST] = KEY
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  const leftover = currentNet ? currentNet.unexpected.slice() : []
  currentNet = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const n of ENV_NAMES) delete process.env[n]
  expect(leftover, 'a fetch to a URL no test scripted').toEqual([])
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run fn with Deno's environment set to exactly `env` (the crypto module reads Deno first). */
async function withDenoEnv(env, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'Deno')
  const prev = globalThis.Deno
  globalThis.Deno = { env: { get: (n) => env[n] } }
  try { return await fn() } finally { if (had) globalThis.Deno = prev; else delete globalThis.Deno }
}
/** Sealed by the REAL storageSecretCrypto.ts under the given master key(s). */
const seal = (plain, env = { [ST]: KEY }) => withDenoEnv(env, () => encryptStorageSecret(plain))
const unseal = (ct, env = { [ST]: KEY }) => withDenoEnv(env, () => decryptStorageSecret(ct))

const s3row = (cfg = CFG, mode = 'byos') => ({ mode, provider: 's3', provider_config: cfg })
const targetOf = (c) => ({ endpoint: c.endpoint, region: c.region, bucket: c.bucket, forcePathStyle: c.forcePathStyle })
/** presignS3Request as the function calls it, with the clock frozen at NOW. */
const direct = (cfg, method, key, expiresSeconds) => presignS3Request({
  target: targetOf(cfg), accessKeyId: cfg.accessKeyId, secretAccessKey: BUCKET_SECRET,
  method, key, expiresSeconds, now: new Date(),
})

/** The network, scripted: DNS-over-HTTPS answers per host, and the bucket's answers. Anything else fails. */
function net({ dns = {}, s3 = () => null } = {}) {
  const state = { seen: [], unexpected: [] }
  currentNet = state
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url)
    state.seen.push({ url: u, method: init.method ?? 'GET', body: init.body, redirect: init.redirect })
    const m = /^https:\/\/cloudflare-dns\.com\/dns-query\?name=([^&]+)&type=(A|AAAA)$/.exec(u)
    if (m) {
      const host = decodeURIComponent(m[1])
      if (host in dns) {
        const answers = m[2] === 'A' ? (dns[host].A ?? dns[host]) : (dns[host].AAAA ?? [])
        const code = m[2] === 'A' ? 1 : 28
        return new Response(JSON.stringify({ Answer: (Array.isArray(answers) ? answers : []).map((data) => ({ type: code, data })) }))
      }
    } else {
      const out = await s3(u, init)
      if (out) return out
    }
    state.unexpected.push(`${init.method ?? 'GET'} ${u}`)
    throw new Error(`unexpected fetch ${u}`)
  }))
  return state
}
const dnsAsked = (state) => state.seen.filter((s) => s.url.startsWith('https://cloudflare-dns.com/')).map((s) => s.url)
const doh = (host, type) => `https://cloudflare-dns.com/dns-query?name=${host}&type=${type}`

/** The table statements a test pins: who asked, what, filtered how. The guard's own read is left out. */
const reads = (w) => w.calls
  .filter((c) => c.kind === 'table' && c.name !== 'workspace_members' && c.name !== 'app_events')
  .map((c) => ({ name: c.name, op: c.op, columns: c.columns, filters: c.filters, terminal: c.terminal, by: c.by }))
const roundTrips = (w) => w.calls.filter((c) => c.kind === 'table' && (c.name === 'workspace_storage' || c.name === 'workspace_storage_secrets')).map((c) => c.name)
const wsRead = (columns) => ({ name: 'workspace_storage', op: 'select', columns, filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }], terminal: 'maybeSingle', by: 'service' })
const secRead = { name: 'workspace_storage_secrets', op: 'select', columns: 'secret_ciphertext', filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }], terminal: 'maybeSingle', by: 'service' }

/** Load a function and make a fresh world for it (one harness copy: see the second vi.mock). */
async function loaded(fnName, env) {
  const { handler } = await loadFunction(vi, fnName, env)
  return { w: newWorld(), handler }
}

/**
 * A world for storage-presign or storage-read-urls. `sec` omitted = a row sealed
 * under KEY; `env` omitted = the master key set in Deno's environment.
 */
async function world(fnName, opts = {}) {
  const env = 'env' in opts ? opts.env : { [ST]: KEY }
  const { w, handler } = await loaded(fnName, env)
  const caller = seatCaller(w, { role: opts.role ?? 'member' })
  const sec = 'sec' in opts ? opts.sec : { secret_ciphertext: await seal(BUCKET_SECRET) }
  const ws = 'ws' in opts ? opts.ws : s3row()
  w.rpc('can_presign_object', () => ({ data: opts.allowed ?? true }))
  w.table('workspace_storage', () => ({ data: ws, error: opts.wsError ?? null }))
  w.table('workspace_storage_secrets', () => ({ data: sec, error: opts.secError ?? null }))
  if (opts.rows) {
    w.table('files', (q) => {
      if (q.filters.some((f) => f.f === 'gt')) return { data: [], error: null }
      const prefix = q.filters.find((f) => f.f === 'like').value.slice(0, -1)
      return { data: opts.rows.filter((r) => r.storage_path.startsWith(prefix) && !r.storage_path.slice(prefix.length).includes('/')), error: null }
    })
  }
  const call = async (body, o = {}) => {
    const a = await answerOf(await handler(post(body, { token: caller.token, ...o })))
    return { status: a.status, json: a.json }
  }
  return { w, call, caller }
}
const presignWorld = (opts) => world('storage-presign', opts)
const readWorld = (opts) => world('storage-read-urls', opts)

/** Count the HMAC signatures WebCrypto is asked for while `fn` runs. */
async function countHmac(fn) {
  const spy = vi.spyOn(globalThis.crypto.subtle, 'sign')
  const before = spy.mock.calls.length
  const out = await fn()
  const n = spy.mock.calls.slice(before).filter(([alg]) => alg === 'HMAC' || alg?.name === 'HMAC').length
  spy.mockRestore()
  return { out, n }
}

// =============================================================================
// A. storage-presign
// =============================================================================

describe('storage-presign: loading the bucket, refusal by refusal in order', () => {
  it('1. the workspace_storage read fails → 500 storage_read_failed with the message', async () => {
    const { call } = await presignWorld({ wsError: { message: 'connection reset by peer' } })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 500, json: { error: 'storage_read_failed', detail: 'connection reset by peer' } })
  })

  it('2. no row / provider not s3 / provider_config null → 409 refused', async () => {
    for (const ws of [null, { mode: 'byos', provider: 'supabase', provider_config: CFG }, { mode: 'byos', provider: 's3', provider_config: null }]) {
      const { call } = await presignWorld({ ws })
      expect(await call({ op: 'get', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: S.noS3 } })
    }
  })

  it('3. put and look on a workspace not in byos → 409 inactive; get, head and del with mode cloud pass', async () => {
    for (const op of ['put', 'look']) {
      const { call } = await presignWorld({ ws: s3row(CFG, 'cloud') })
      expect(await call({ op, path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: S.inactive } })
    }
    for (const [op, method, secs] of [['get', 'GET', 300], ['head', 'HEAD', 300], ['del', 'DELETE', 300]]) {
      const { call } = await presignWorld({ ws: s3row(CFG, 'cloud') })
      const url = await direct(CFG, method, `wilson/${PATH}`, secs)
      expect(await call({ op, path: PATH })).toEqual({ status: 200, json: { ok: true, url, method, expiresAt: '2026-11-13T03:05:00.000Z' } })
    }
  })

  it('4. the master secret not configured → 503 crypto_unavailable (deno wins: process.env holds a key and is not read)', async () => {
    expect(process.env[ST]).toBe(KEY)
    const { call } = await presignWorld({ env: {} })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 503, json: { error: 'crypto_unavailable', detail: S.noCrypto } })
  })

  it('5. the workspace_storage_secrets read fails → 500 secret_read_failed', async () => {
    const { call } = await presignWorld({ secError: { message: 'permission denied for table' } })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 500, json: { error: 'secret_read_failed', detail: 'permission denied for table' } })
  })

  it('6. no secret row / empty ciphertext → 409 refused', async () => {
    for (const sec of [null, { secret_ciphertext: '' }, { secret_ciphertext: null }]) {
      const { call } = await presignWorld({ sec })
      expect(await call({ op: 'get', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: S.noSecret } })
    }
  })

  it('7. a ciphertext that will not open → 500 secret_unusable, the crypto module\'s own message inside', async () => {
    const cases = [
      [await seal(BUCKET_SECRET, { [ST]: OTHER_KEY }), S.gcmFailed],                    // sealed under another key
      [Buffer.from('short').toString('base64'), 'storage secret envelope is truncated'], // ≤ 12 bytes
      [await seal(BUCKET_SECRET, { [ST]: OTHER_KEY, [ST_V2]: KEY }), `${ST_V2} is not configured`], // a v2. envelope, no V2 set
      ['not base64!', 'Invalid character'],                                               // atob's own
    ]
    expect(cases[2][0].startsWith('v2.')).toBe(true)
    for (const [secret_ciphertext, message] of cases) {
      const { call } = await presignWorld({ sec: { secret_ciphertext } })
      expect(await call({ op: 'get', path: PATH })).toEqual({ status: 500, json: { error: 'secret_unusable', detail: S.unusable(message) } })
    }
  })
})

describe('storage-presign: success, op by op', () => {
  const OPS = [['put', 'PUT', 900, '2026-11-13T03:15:00.000Z'], ['get', 'GET', 300, '2026-11-13T03:05:00.000Z'],
    ['head', 'HEAD', 300, '2026-11-13T03:05:00.000Z'], ['del', 'DELETE', 300, '2026-11-13T03:05:00.000Z']]

  it('path style, prefix applied: the URL byte-identical to a direct presignS3Request', async () => {
    for (const [op, method, secs, expiresAt] of OPS) {
      const { call } = await presignWorld()
      const url = await direct(CFG, method, `wilson/${PATH}`, secs)
      expect(url.startsWith(`https://s3.us-west-004.backblazeb2.com/petal-media/wilson/${PATH}?`)).toBe(true)
      expect(await call({ op, path: PATH })).toEqual({ status: 200, json: { ok: true, url, method, expiresAt } })
    }
  })

  it('virtual-host style (bare AWS), no prefix: the key is the path as sent', async () => {
    for (const [op, method, secs, expiresAt] of OPS) {
      const { call } = await presignWorld({ ws: s3row(CFG_AWS) })
      const url = await direct(CFG_AWS, method, PATH, secs)
      expect(url.startsWith(`https://petal-media.s3.eu-central-1.amazonaws.com/${PATH}?`)).toBe(true)
      expect(await call({ op, path: PATH })).toEqual({ status: 200, json: { ok: true, url, method, expiresAt } })
    }
  })

  it('a custom endpoint with forcePathStyle false signs the bucket subdomain of it', async () => {
    const cfg = { ...CFG, forcePathStyle: false }
    const { call } = await presignWorld({ ws: s3row(cfg) })
    const url = await direct(cfg, 'GET', `wilson/${PATH}`, 300)
    expect(url.startsWith(`https://petal-media.s3.us-west-004.backblazeb2.com/wilson/${PATH}?`)).toBe(true)
    expect((await call({ op: 'get', path: PATH })).json.url).toBe(url)
  })

  it('the signer throws (an http:// endpoint) → 500 presign_failed with its sentence', async () => {
    const { call } = await presignWorld({ ws: s3row({ ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }) })
    expect(await call({ op: 'put', path: PATH })).toEqual({ status: 500, json: { error: 'presign_failed', detail: 'the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear' } })
  })
})

describe('storage-presign: look (the server\'s own signed HEAD)', () => {
  const HOST = 's3.us-west-004.backblazeb2.com'
  const headAt = (status, seen = []) => (u, init) => {
    if (init.method !== 'HEAD' || !u.startsWith(`https://${HOST}/`)) return null
    seen.push(u)
    return new Response(null, { status })
  }

  it('200 and the record rpc true → { ok, seen: true }; the rpc ran on the SERVICE client with its arguments', async () => {
    const heads = []
    const n = net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(200, heads) })
    const { call, w } = await presignWorld()
    w.rpc('s3_body_look_record', () => ({ data: true }))
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 200, json: { ok: true, seen: true } })
    expect(heads).toEqual([await direct(CFG, 'HEAD', `wilson/${PATH}`, 60)])
    expect(dnsAsked(n)).toEqual([doh(HOST, 'A'), doh(HOST, 'AAAA')])
    expect(n.seen.find((s) => s.method === 'HEAD').redirect).toBe('manual')
    const rpcs = w.calls.filter((c) => c.kind === 'rpc' && c.name !== 'fn_rate_limit_hit').map((c) => ({ name: c.name, args: c.args, by: c.by }))
    expect(rpcs).toEqual([
      // look asks the rights to WRITE the key, as the caller.
      { name: 'can_presign_object', args: { p_path: PATH, p_op: 'put' }, by: 'caller' },
      { name: 's3_body_look_record', args: { p_workspace: 'ws-1', p_path: PATH, p_user: 'user-1' }, by: 'service' },
    ])
  })

  it('the record rpc answering anything but true → 409; an error → 500 look_not_recorded', async () => {
    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(200) })
    let r = await presignWorld()
    r.w.rpc('s3_body_look_record', () => ({ data: false }))
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: 'this copy is not one this company can move a file to' } })
    r = await presignWorld()
    r.w.rpc('s3_body_look_record', () => ({ data: null, error: { message: 'boom' } }))
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 500, json: { error: 'look_not_recorded', detail: 'WILSON could not check the new copy in your company\'s bucket just now, so nothing moved' } })
  })

  it('404 → { seen: false } and nothing recorded; 403 → 409; other status → 502', async () => {
    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(404) })
    let r = await presignWorld()
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 200, json: { ok: true, seen: false } })
    expect(r.w.count((c) => c.name === 's3_body_look_record')).toBe(0)

    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(403) })
    r = await presignWorld()
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: 'your company\'s bucket refused WILSON\'s server a look at the new copy, so nothing moved. An admin can check the bucket\'s access rules' } })

    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(500) })
    r = await presignWorld()
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 502, json: { error: 'look_failed', detail: 'the bucket answered 500' } })
  })

  it('a redirect → 502 look_failed, nothing followed', async () => {
    const n = net({ dns: { [HOST]: [PUBLIC_IP] }, s3: headAt(301) })
    const { call } = await presignWorld()
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 502, json: { error: 'look_failed', detail: 'the bucket answered with a redirect, which is not followed' } })
    expect(n.seen.filter((s) => s.method === 'HEAD')).toHaveLength(1)
  })

  it('the bucket unreachable (fetch throws) → 502 look_failed with the message', async () => {
    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: (u, init) => { if (init.method === 'HEAD') throw new TypeError('fetch failed'); return null } })
    const { call } = await presignWorld()
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 502, json: { error: 'look_failed', detail: 'the bucket could not be reached (fetch failed)' } })
  })

  it('a name that does not resolve → 502 look_failed (a fault that may pass), nothing contacted', async () => {
    const n = net({ dns: { [HOST]: [] } })
    const { call } = await presignWorld()
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 502, json: { error: 'look_failed', detail: `the S3 endpoint's name (${HOST}) does not resolve; check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure` } })
    expect(n.seen.every((s) => s.url.startsWith('https://cloudflare-dns.com/'))).toBe(true)
  })

  it('a name resolving to a private address → 409 refused; a private literal → 409 with no lookup', async () => {
    let n = net({ dns: { [HOST]: ['10.0.0.5'] } })
    let r = await presignWorld()
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: `the S3 endpoint's name (${HOST}) resolves to an address inside a private network (10.0.0.5); WILSON sends bucket requests to public endpoints only` } })

    n = net()
    r = await presignWorld({ ws: s3row({ ...CFG, endpoint: 'https://10.0.0.5' }) })
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: 'the S3 endpoint is an address inside a private network (10.0.0.5); WILSON sends bucket requests to public endpoints only' } })
    expect(n.seen).toEqual([])
  })

  it('the host vetted is the bucket subdomain for a virtual-host config', async () => {
    const vh = 'petal-media.s3.eu-central-1.amazonaws.com'
    const n = net({ dns: { [vh]: [PUBLIC_IP] }, s3: (u, init) => (init.method === 'HEAD' && u.startsWith(`https://${vh}/`) ? new Response(null, { status: 404 }) : null) })
    const { call } = await presignWorld({ ws: s3row(CFG_AWS) })
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 200, json: { ok: true, seen: false } })
    expect(dnsAsked(n)).toEqual([doh(vh, 'A'), doh(vh, 'AAAA')])
  })

  it('the Supabase-host refusal: the project\'s own SUPABASE_URL host, and any *.supabase.co, with no lookup', async () => {
    const n = net()
    const own = 'api.petal-own-project.com'
    const { w, handler } = await loaded('storage-presign', { [ST]: KEY, SUPABASE_URL: `https://${own}` })
    const caller = seatCaller(w, { role: 'member' })
    w.rpc('can_presign_object', () => ({ data: true }))
    w.table('workspace_storage', () => ({ data: s3row({ ...CFG, endpoint: `https://${own}` }), error: null }))
    const sealed = await seal(BUCKET_SECRET)
    w.table('workspace_storage_secrets', () => ({ data: { secret_ciphertext: sealed }, error: null }))
    const a = await answerOf(await handler(post({ op: 'look', path: PATH }, { token: caller.token })))
    expect({ status: a.status, json: a.json }).toEqual({ status: 409, json: { error: 'refused', detail: 'the S3 endpoint cannot be a WILSON host' } })

    const r = await presignWorld({ ws: s3row({ ...CFG, endpoint: 'https://abcd.supabase.co' }) })
    expect(await r.call({ op: 'look', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: 'the S3 endpoint cannot be a WILSON host' } })
    expect(n.seen).toEqual([])
  })

  it('a config the signer cannot use (http://) → 502 look_failed: the host() step throws before any vet', async () => {
    const n = net()
    const { call } = await presignWorld({ ws: s3row({ ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }) })
    expect(await call({ op: 'look', path: PATH })).toEqual({ status: 502, json: { error: 'look_failed', detail: 'the bucket\'s address could not be checked (the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear)' } })
    expect(n.seen).toEqual([])
  })
})

describe('storage-presign: the order when two things are wrong at once', () => {
  it('not s3 AND no master secret → 409 (the config refuses first)', async () => {
    const { call } = await presignWorld({ ws: null, env: {} })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: S.noS3 } })
  })
  it('put on cloud AND no master secret → 409 inactive', async () => {
    const { call } = await presignWorld({ ws: s3row(CFG, 'cloud'), env: {} })
    expect(await call({ op: 'put', path: PATH })).toEqual({ status: 409, json: { error: 'refused', detail: S.inactive } })
  })
  it('no master secret AND no secret row → 503', async () => {
    const { call } = await presignWorld({ sec: null, env: {} })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 503, json: { error: 'crypto_unavailable', detail: S.noCrypto } })
  })
  it('master secret set, the secret read failing, config fine → 500 secret_read_failed', async () => {
    const { call } = await presignWorld({ secError: { message: 'timeout' } })
    expect(await call({ op: 'get', path: PATH })).toEqual({ status: 500, json: { error: 'secret_read_failed', detail: 'timeout' } })
  })
})

describe('storage-presign: who read what', () => {
  it('both reads by the SERVICE client, on the guard\'s workspace; a body naming another workspace or a prefix changes nothing', async () => {
    const { call, w } = await presignWorld()
    const url = await direct(CFG, 'GET', `wilson/${PATH}`, 300)
    expect(await call({ op: 'get', path: PATH, workspace_id: 'someone-else', prefix: 'evil' }))
      .toEqual({ status: 200, json: { ok: true, url, method: 'GET', expiresAt: '2026-11-13T03:05:00.000Z' } })
    expect(reads(w)).toEqual([wsRead('mode, provider, provider_config'), secRead])
    expect(w.calls.find((c) => c.name === 'can_presign_object')).toMatchObject({ args: { p_path: PATH, p_op: 'get' }, by: 'caller' })
  })
})

// F8 (b) rewrote this block, as its old title said it might ("today: the two
// reads one after the other (F8 may read them together)"). Before F8 a refusal
// of the configuration ended the load with ONE round trip. Since F8 the loader
// (_shared/workspaceBucket.ts) starts BOTH reads at once, by the service
// client, filtered on the guard's workspace id, and judges them in the old
// order: so every refusal below answers the status and the sentence it always
// did, and only the statements differ (two, where there was one).
describe('F8: the two reads at once, by the service client, judged in the old order', () => {
  /** Make the configuration's answer wait, and note whether the secret's read was already asked by then. */
  const holdTheConfiguration = (w, answer) => {
    const seen = { secretAskedFirst: null }
    w.table('workspace_storage', async () => {
      await new Promise((r) => setTimeout(r, 5))
      seen.secretAskedFirst = w.calls.some((c) => c.name === 'workspace_storage_secrets')
      return answer
    })
    return seen
  }
  const both = (columns) => [wsRead(columns), secRead]

  const presign = [
    ['storage read fails', { wsError: { message: 'x' } }, 'get', 500, { error: 'storage_read_failed', detail: 'x' }],
    ['not s3', { ws: null }, 'get', 409, { error: 'refused', detail: S.noS3 }],
    ['inactive put', { ws: s3row(CFG, 'cloud') }, 'put', 409, { error: 'refused', detail: S.inactive }],
    ['inactive look', { ws: s3row(CFG, 'cloud') }, 'look', 409, { error: 'refused', detail: S.inactive }],
    ['no master secret', { env: {} }, 'get', 503, { error: 'crypto_unavailable', detail: S.noCrypto }],
    ['secret read fails', { secError: { message: 'x' } }, 'get', 500, { error: 'secret_read_failed', detail: 'x' }],
    ['no secret row', { sec: null }, 'get', 409, { error: 'refused', detail: S.noSecret }],
    ['unusable secret', { sec: { secret_ciphertext: 'not base64!' } }, 'get', 500, { error: 'secret_unusable', detail: S.unusable('Invalid character') }],
    ['success', {}, 'get', 200, null],
  ]
  for (const [name, opts, op, status, json] of presign) {
    it(`storage-presign, ${name}: ${status}, both tables read by the service client on the guard's workspace`, async () => {
      const { call, w } = await presignWorld(opts)
      // A body naming another workspace changes no filter.
      const out = await call({ op, path: PATH, workspace_id: 'someone-else' })
      expect(out.status).toBe(status)
      if (json) expect(out.json).toEqual(json)
      expect(reads(w)).toEqual(both('mode, provider, provider_config'))
    })
  }
  it('storage-presign: the secret is asked for before the configuration has answered (at once, not one after the other)', async () => {
    const { call, w } = await presignWorld()
    const seen = holdTheConfiguration(w, { data: s3row(), error: null })
    expect((await call({ op: 'get', path: PATH })).status).toBe(200)
    expect(seen.secretAskedFirst).toBe(true)
  })

  const readUrls = [
    ['not s3', { ws: null }, 409, { error: 'refused', detail: S.noS3 }],
    ['no master secret', { env: {} }, 503, { error: 'crypto_unavailable', detail: S.noCrypto }],
    ['success', {}, 200, null],
  ]
  for (const [name, opts, status, json] of readUrls) {
    it(`storage-read-urls, ${name}: ${status}, both tables read by the service client on the guard's workspace`, async () => {
      const K = `projects/${PID}/shots/shot-1/1700000000-a.exr`
      const { call, w } = await readWorld({ ...opts, rows: [{ id: 'r1', project_id: PID, storage_path: K, thumbnail_url: null }] })
      const out = await call({ keys: [K], workspace_id: 'someone-else' })
      expect(out.status).toBe(status)
      if (json) expect(out.json).toEqual(json)
      expect(roundTrips(w)).toEqual(['workspace_storage', 'workspace_storage_secrets'])
      expect(reads(w).filter((r) => r.name !== 'files')).toEqual(both('provider, provider_config'))
    })
  }

  const probe = [
    ['storage read fails', { wsError: { message: 'gone' } }, 500, { error: 'storage_read_failed', detail: 'gone' }],
    ['not s3', { ws: null }, 409, { error: 'refused', detail: 'save the bucket configuration first — there is nothing to probe yet' }],
    ['no secret row', { sec: null }, 409, { error: 'refused', detail: 'no bucket secret is stored — save the secret, then probe' }],
  ]
  for (const [name, opts, status, json] of probe) {
    it(`storage-secret probe, ${name}: ${status}, both tables read by the service client`, async () => {
      net()
      const { call, w } = await secretWorld(opts)
      expect(await call({ action: 'probe' })).toEqual({ status, json })
      expect(reads(w)).toEqual(both('provider, provider_config'))
    })
  }

  it('a secret read that THROWS beside a company with no S3 configuration: still the 409, and no unhandled rejection', async () => {
    const unhandled = []
    const onUnhandled = (e) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      for (const [load, ask] of [[presignWorld, { op: 'put', path: PATH }], [readWorld, null]]) {
        const K = `projects/${PID}/shots/shot-1/1700000000-a.exr`
        const { call, w } = await load({ ws: null, rows: [{ id: 'r1', project_id: PID, storage_path: K, thumbnail_url: null }] })
        w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
        await expect(call(ask ?? { keys: [K] })).resolves.toEqual({ status: 409, json: { error: 'refused', detail: S.noS3 } })
      }
      net()
      const s = await secretWorld({ ws: null })
      s.w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
      await expect(s.call({ action: 'probe' })).resolves.toEqual({ status: 409, json: { error: 'refused', detail: 'save the bucket configuration first — there is nothing to probe yet' } })
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it('a secret read that throws once the configuration has passed is thrown, as it was (the handler rejects)', async () => {
    const { w, handler } = await loaded('storage-presign', { [ST]: KEY })
    const caller = seatCaller(w, { role: 'member' })
    w.rpc('can_presign_object', () => ({ data: true }))
    w.table('workspace_storage', () => ({ data: s3row(), error: null }))
    w.table('workspace_storage_secrets', () => { throw new Error('the socket closed') })
    await expect(handler(post({ op: 'get', path: PATH }, { token: caller.token }))).rejects.toThrow('the socket closed')
  })
})

// =============================================================================
// B. storage-read-urls
// =============================================================================

describe('storage-read-urls', () => {
  const FOLDER = `projects/${PID}/shots/shot-1`
  const K = (leaf) => `${FOLDER}/${leaf}`
  const row = (id, leaf, thumb = false) => ({ id, project_id: PID, storage_path: K(leaf), thumbnail_url: thumb ? `${K(leaf)}.jpg` : null })
  const ROWS = [row('r1', '1700000000-a.exr', true), row('r2', '1700000000-b.mov'), row('r3', '1700000000-c.pdf')]

  it('the loadSigner refusals, as they surface (no mode check: a cloud workspace still reads)', async () => {
    const body = { keys: [K('1700000000-a.exr')] }
    const cases = [
      [{ wsError: { message: 'db down' } }, 500, { error: 'storage_read_failed', detail: 'db down' }],
      [{ ws: null }, 409, { error: 'refused', detail: S.noS3 }],
      [{ ws: { mode: 'byos', provider: 'nas', provider_config: CFG } }, 409, { error: 'refused', detail: S.noS3 }],
      [{ env: {} }, 503, { error: 'crypto_unavailable', detail: S.noCrypto }],
      [{ secError: { message: 'denied' } }, 500, { error: 'secret_read_failed', detail: 'denied' }],
      [{ sec: null }, 409, { error: 'refused', detail: S.noSecret }],
      [{ sec: { secret_ciphertext: '' } }, 409, { error: 'refused', detail: S.noSecret }],
      [{ sec: { secret_ciphertext: Buffer.from('short').toString('base64') } }, 500, { error: 'secret_unusable', detail: S.unusable('storage secret envelope is truncated') }],
      [{ sec: 'OTHER' }, 500, { error: 'secret_unusable', detail: S.unusable(S.gcmFailed) }],
      [{ sec: 'V2' }, 500, { error: 'secret_unusable', detail: S.unusable(`${ST_V2} is not configured`) }],
    ]
    for (const [opts, status, json] of cases) {
      const o = { ...opts, rows: ROWS }
      if (o.sec === 'OTHER') o.sec = { secret_ciphertext: await seal(BUCKET_SECRET, { [ST]: OTHER_KEY }) }
      if (o.sec === 'V2') o.sec = { secret_ciphertext: await seal(BUCKET_SECRET, { [ST]: OTHER_KEY, [ST_V2]: KEY }) }
      const { call } = await readWorld(o)
      expect(await call(body)).toEqual({ status, json })
    }
    // A cloud-mode workspace with a retained config signs (the mode is not read).
    const { call, w } = await readWorld({ ws: s3row(CFG, 'cloud'), rows: ROWS })
    expect((await call(body)).status).toBe(200)
    expect(reads(w).find((r) => r.name === 'workspace_storage').columns).toBe('provider, provider_config')
  })

  it('loadSigner is never reached when no key is owned by a row: misconfigured storage still answers 200', async () => {
    const { call, w } = await readWorld({ ws: null, env: {}, rows: [] })
    expect(await call({ keys: [K('1700000000-z.exr')] })).toEqual({ status: 200, json: { ok: true, urls: {}, expires: {}, refused: { [K('1700000000-z.exr')]: 'row' } } })
    expect(roundTrips(w)).toEqual([])
  })

  it('a batch in one folder: rows read by the CALLER by folder, URLs byte-identical, expiries, refusals', async () => {
    const { call, w } = await readWorld({ rows: ROWS })
    const thumb = `${K('1700000000-a.exr')}.jpg`
    const keys = [thumb, K('1700000000-a.exr'), K('1700000000-b.mov'), K('1700000000-nobody.exr'),
      `projects/${PID}/INVOICES/x/1700000000-i.pdf`, `projects/${PID}/shots/1700000000-shallow.exr`, 'elsewhere/a/b/c/d']
    const out = await call({ keys })
    expect(out).toEqual({
      status: 200,
      json: {
        ok: true,
        urls: {
          [thumb]: await direct(CFG, 'GET', `wilson/${thumb}`, 3600),
          [K('1700000000-a.exr')]: await direct(CFG, 'GET', `wilson/${K('1700000000-a.exr')}`, 300),
          // a .mov in a batch is not a stream: `stream` is for one key
          [K('1700000000-b.mov')]: await direct(CFG, 'GET', `wilson/${K('1700000000-b.mov')}`, 300),
        },
        expires: { [thumb]: 3600, [K('1700000000-a.exr')]: 300, [K('1700000000-b.mov')]: 300 },
        refused: {
          [K('1700000000-nobody.exr')]: 'row',
          [`projects/${PID}/INVOICES/x/1700000000-i.pdf`]: 'money',
          [`projects/${PID}/shots/1700000000-shallow.exr`]: 'shape',
          'elsewhere/a/b/c/d': 'shape',
        },
      },
    })
    expect(reads(w)).toEqual([
      { name: 'files', op: 'select', columns: 'id, project_id, storage_path, thumbnail_url', by: 'caller', terminal: null,
        filters: [{ f: 'eq', column: 'storage_provider', value: 's3' }, { f: 'is', column: 'deleted_at', value: null },
          { f: 'like', column: 'storage_path', value: `${FOLDER}/%` }, { f: 'not.like', column: 'storage_path', value: `${FOLDER}/%/%` }] },
      { name: 'files', op: 'select', columns: 'id, project_id, storage_path, thumbnail_url', by: 'caller', terminal: null,
        filters: [{ f: 'eq', column: 'storage_provider', value: 's3' }, { f: 'is', column: 'deleted_at', value: null },
          { f: 'like', column: 'storage_path', value: `${FOLDER}/%` }, { f: 'not.like', column: 'storage_path', value: `${FOLDER}/%/%` },
          { f: 'gt', column: 'id', value: 'r3' }] },
      wsRead('provider, provider_config'),
      secRead,
    ])
    const page = w.calls.filter((c) => c.name === 'files').map((c) => ({ order: c.order, limit: c.limit }))
    expect(page).toEqual([{ order: [{ column: 'id', options: null }], limit: 1000 }, { order: [{ column: 'id', options: null }], limit: 1000 }])
    // No project predicate is asked (readUrls.ts header §5 describes one): only the limiter's rpc runs.
    expect(w.calls.filter((c) => c.kind === 'rpc').map((c) => c.name)).toEqual(['fn_rate_limit_hit'])
  })

  it('stream: true for one streamable key → 3600; for one non-streamable key → 300', async () => {
    let r = await readWorld({ rows: ROWS })
    expect(await r.call({ keys: [K('1700000000-b.mov')], stream: true })).toEqual({ status: 200, json: { ok: true,
      urls: { [K('1700000000-b.mov')]: await direct(CFG, 'GET', `wilson/${K('1700000000-b.mov')}`, 3600) },
      expires: { [K('1700000000-b.mov')]: 3600 }, refused: {} } })
    r = await readWorld({ rows: ROWS })
    expect((await r.call({ keys: [K('1700000000-c.pdf')], stream: true })).json.expires).toEqual({ [K('1700000000-c.pdf')]: 300 })
  })

  it('virtual-host config, no prefix: the key signed as it is', async () => {
    const { call } = await readWorld({ ws: s3row(CFG_AWS), rows: ROWS })
    expect((await call({ keys: [K('1700000000-a.exr')] })).json.urls).toEqual({ [K('1700000000-a.exr')]: await direct(CFG_AWS, 'GET', K('1700000000-a.exr'), 300) })
  })

  it('the signer throwing → 500 presign_failed with its sentence (one naming no key)', async () => {
    const { call } = await readWorld({ ws: s3row({ ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }), rows: ROWS })
    expect(await call({ keys: [K('1700000000-a.exr')] })).toEqual({ status: 500, json: { error: 'presign_failed', detail: 'the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear' } })
  })

  it('the 400s and the 413 it already has', async () => {
    const cases = [
      [{ raw: 'not json' }, undefined, 400, { error: 'bad_request', detail: 'the request body is not JSON' }],
      [{}, { keys: [] }, 400, { error: 'bad_request', detail: 'keys must be a list of 1 to 100 storage paths' }],
      [{}, { keys: 'a' }, 400, { error: 'bad_request', detail: 'keys must be a list of 1 to 100 storage paths' }],
      [{}, { keys: Array.from({ length: 101 }, (_, i) => K(`${i}.exr`)) }, 400, { error: 'bad_request', detail: 'keys must be a list of 1 to 100 storage paths' }],
      [{}, { keys: [K('a.mov'), K('b.mov')], stream: true }, 400, { error: 'bad_request', detail: 'a streaming address is signed for one file at a time' }],
      [{}, { keys: ['1', '2', '3'].map((d) => `projects/${d.repeat(8)}-2222-4333-8444-555555555555/shots/s/x.exr`) }, 400, { error: 'bad_request', detail: 'at most 2 projects per call' }],
      [{}, { keys: Array.from({ length: 11 }, (_, i) => `projects/${PID}/shots/s${i}/x.exr`) }, 400, { error: 'bad_request', detail: 'at most 10 folders per call' }],
      [{ raw: JSON.stringify({ keys: [K('a.exr')], pad: 'x'.repeat(140 * 1024) }) }, undefined, 413, { error: 'too_large', detail: 'the request is too large' }],
    ]
    for (const [o, body, status, json] of cases) {
      const { call } = await readWorld({ rows: ROWS })
      expect(await call(body, o)).toEqual({ status, json })
    }
  })

  it('a batch of 100: every URL byte for byte the direct signer\'s, and the HMAC work counted (C5)', async () => {
    const leaves = Array.from({ length: 100 }, (_, i) => `1700000000-f${String(i).padStart(3, '0')}.exr`)
    const { call } = await readWorld({ rows: leaves.map((l, i) => row(`r${String(i).padStart(3, '0')}`, l)) })
    const { out, n: hmacSigns } = await countHmac(() => call({ keys: leaves.map(K) }))
    const urls = {}
    for (const l of leaves) urls[K(l)] = await direct(CFG, 'GET', `wilson/${K(l)}`, 300)
    expect(out.status).toBe(200)
    expect(out.json.urls).toEqual(urls)
    expect(hmacSigns).toBe(BATCH_HMAC_SIGNS)
  })
})

// =============================================================================
// C. storage-secret
// =============================================================================

/** An admin caller and storage-secret's tables. */
async function secretWorld(opts = {}) {
  const env = 'env' in opts ? opts.env : { [ST]: KEY }
  const { w, handler } = await loaded('storage-secret', env)
  const caller = seatCaller(w, { role: 'admin' })
  const ws = 'ws' in opts ? opts.ws : s3row()
  const sec = 'sec' in opts ? opts.sec : { secret_ciphertext: await seal(BUCKET_SECRET), key_hint: '9f2c' }
  w.table('workspace_storage', () => ({ data: ws, error: opts.wsError ?? null }))
  w.table('workspace_storage_secrets', (q) => {
    if (q.op === 'upsert') return { data: null, error: opts.upsertError ?? null }
    if (q.op === 'delete') return { data: null, error: opts.deleteError ?? null }
    return { data: sec, error: opts.secError ?? null }
  })
  w.table('app_events', () => ({ data: null, error: null }))
  const call = async (body) => {
    const a = await answerOf(await handler(post(body, { token: caller.token })))
    return { status: a.status, json: a.json }
  }
  const events = () => w.calls.filter((c) => c.name === 'app_events').map((c) => ({ code: c.values.code, message: c.values.message, context: c.values.context }))
  const upserts = () => w.calls.filter((c) => c.name === 'workspace_storage_secrets' && c.op === 'upsert')
  return { w, call, events, upserts }
}

describe('storage-secret: set', () => {
  const HOST = 's3.us-west-004.backblazeb2.com'
  const NEW = '  new-bucket-secret-77aa  '

  it('the master secret unset → 503, before the length rule', async () => {
    const { call } = await secretWorld({ env: {} })
    expect(await call({ action: 'set', secret: 'short' })).toEqual({ status: 503, json: { error: 'crypto_unavailable', detail: S.noCrypto } })
  })

  it('the length rule (trimmed): < 8 or > 512 → 400', async () => {
    for (const secret of ['  1234567  ', 'x'.repeat(513), undefined, 42]) {
      const { call } = await secretWorld()
      expect(await call({ action: 'set', secret })).toEqual({ status: 400, json: { error: 'bad_request', detail: 'the secret must be between 8 and 512 characters' } })
    }
  })

  it('a master secret that is not 32 bytes → 500 encrypt_failed', async () => {
    const { call } = await secretWorld({ env: { [ST]: Buffer.alloc(16).toString('base64') } })
    expect(await call({ action: 'set', secret: NEW })).toEqual({ status: 500, json: { error: 'encrypt_failed', detail: `${ST} must decode to exactly 32 bytes (got 16)` } })
  })

  it('success with an s3 config: the endpoint vetted first, then the upsert\'s values', async () => {
    const n = net({ dns: { [HOST]: [PUBLIC_IP] } })
    const { call, upserts, events } = await secretWorld()
    expect(await call({ action: 'set', secret: NEW })).toEqual({ status: 200, json: { ok: true, keyHint: '77aa' } })
    expect(dnsAsked(n)).toEqual([doh(HOST, 'A'), doh(HOST, 'AAAA')])
    const [u] = upserts()
    expect(u.by).toBe('service')
    expect(u.options).toEqual({ onConflict: 'workspace_id' })
    const { secret_ciphertext, ...rest } = u.values
    expect(rest).toEqual({ workspace_id: 'ws-1', key_hint: '77aa', key_version: 1, updated_at: '2026-11-13T03:00:00.000Z', updated_by: 'user-1' })
    expect(await unseal(secret_ciphertext)).toBe('new-bucket-secret-77aa')
    expect(events()).toEqual([{ code: 'WIL-3005', message: 'Workspace bucket secret saved', context: { key_hint: '77aa' } }])
  })

  it('key_version follows the highest master secret present (V2 → a v2. envelope)', async () => {
    net({ dns: { [HOST]: [PUBLIC_IP] } })
    const OTHER_V2 = randomBytes(32).toString('base64')
    const { call, upserts } = await secretWorld({ env: { [ST]: KEY, [ST_V2]: OTHER_V2 } })
    expect((await call({ action: 'set', secret: NEW })).status).toBe(200)
    const v = upserts()[0].values
    expect(v.key_version).toBe(2)
    expect(v.secret_ciphertext.startsWith('v2.')).toBe(true)
    expect(await unseal(v.secret_ciphertext, { [ST_V2]: OTHER_V2 })).toBe('new-bucket-secret-77aa')
  })

  it('no s3 config → no vet at all, the secret saved', async () => {
    for (const ws of [null, { mode: 'cloud', provider: 'supabase', provider_config: null }, { mode: 'byos', provider: 's3', provider_config: null }]) {
      const n = net()
      const { call, upserts } = await secretWorld({ ws })
      expect(await call({ action: 'set', secret: NEW })).toEqual({ status: 200, json: { ok: true, keyHint: '77aa' } })
      expect(n.seen).toEqual([])
      expect(upserts()).toHaveLength(1)
    }
  })

  it('the endpoint refused → 409 "… — the secret was not saved", WIL-3007 stage endpoint, no upsert', async () => {
    const cases = [
      ['https://10.0.0.5', {}, 'not_public', 'the S3 endpoint is an address inside a private network (10.0.0.5); WILSON sends bucket requests to public endpoints only'],
      ['https://minio.local', {}, 'local_name', 'the S3 endpoint names a host inside a private network (minio.local); WILSON sends bucket requests to public endpoints only'],
      ['https://abcd.supabase.co', {}, 'supabase_host', 'the S3 endpoint cannot be a WILSON host'],
      [`https://${HOST}`, { [HOST]: [] }, 'dns', `the S3 endpoint's name (${HOST}) does not resolve; check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure`],
      [`https://${HOST}`, { [HOST]: ['192.168.1.4'] }, 'not_public', `the S3 endpoint's name (${HOST}) resolves to an address inside a private network (192.168.1.4); WILSON sends bucket requests to public endpoints only`],
    ]
    for (const [endpoint, dns, reason, detail] of cases) {
      net({ dns })
      const { call, upserts, events } = await secretWorld({ ws: s3row({ ...CFG, endpoint }) })
      expect(await call({ action: 'set', secret: NEW })).toEqual({ status: 409, json: { error: 'refused', detail: `${detail} — the secret was not saved` } })
      expect(events()).toEqual([{ code: 'WIL-3007', message: 'Bucket secret refused', context: { stage: 'endpoint', reason } }])
      expect(upserts()).toEqual([])
    }
  })

  it('an endpoint the signer cannot read (http://) → 409 with its bare sentence: no "not saved", no event', async () => {
    net()
    const { call, upserts, events } = await secretWorld({ ws: s3row({ ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }) })
    expect(await call({ action: 'set', secret: NEW })).toEqual({ status: 409, json: { error: 'refused', detail: 'the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear' } })
    expect(events()).toEqual([])
    expect(upserts()).toEqual([])
  })

  it('storage_read_failed 500; save_failed 500', async () => {
    let r = await secretWorld({ wsError: { message: 'gone' } })
    expect(await r.call({ action: 'set', secret: NEW })).toEqual({ status: 500, json: { error: 'storage_read_failed', detail: 'gone' } })
    net()
    r = await secretWorld({ ws: null, upsertError: { message: 'duplicate key' } })
    expect(await r.call({ action: 'set', secret: NEW })).toEqual({ status: 500, json: { error: 'save_failed', detail: 'duplicate key' } })
  })
})

describe('storage-secret: clear, status, an unknown action', () => {
  it('clear → { ok: true }, the row deleted on the workspace, WIL-3006; an error → 500 clear_failed', async () => {
    let r = await secretWorld()
    expect(await r.call({ action: 'clear' })).toEqual({ status: 200, json: { ok: true } })
    expect(reads(r.w)).toEqual([{ name: 'workspace_storage_secrets', op: 'delete', columns: null, filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }], terminal: null, by: 'service' }])
    expect(r.events()).toEqual([{ code: 'WIL-3006', message: 'Workspace bucket secret cleared', context: {} }])
    r = await secretWorld({ deleteError: { message: 'nope' } })
    expect(await r.call({ action: 'clear' })).toEqual({ status: 500, json: { error: 'clear_failed', detail: 'nope' } })
  })

  it('status: configured, hint and whether the master secret is set', async () => {
    let r = await secretWorld()
    expect(await r.call({ action: 'status' })).toEqual({ status: 200, json: { ok: true, configured: true, keyHint: '9f2c', cryptoConfigured: true } })
    r = await secretWorld({ sec: null, env: {} })
    expect(await r.call({ action: 'status' })).toEqual({ status: 200, json: { ok: true, configured: false, keyHint: null, cryptoConfigured: false } })
    r = await secretWorld({ secError: { message: 'eh' } })
    expect(await r.call({ action: 'status' })).toEqual({ status: 500, json: { error: 'status_failed', detail: 'eh' } })
  })

  it('an unknown action → 400', async () => {
    const { call } = await secretWorld()
    expect(await call({ action: 'rotate' })).toEqual({ status: 400, json: { error: 'bad_request', detail: 'action must be one of set, clear, status, probe' } })
  })
})

describe('storage-secret: probe', () => {
  const HOST = 's3.us-west-004.backblazeb2.com'
  const RAND = 'ab'.repeat(8)
  const fixRandom = () => vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((a) => { a.fill(0xab); return a })
  /** The bucket answering PUT, GET, DELETE in turn; `seen` collects each signed URL with its body. */
  const bucket = ({ put = 200, get = [200, 'wilson-probe'], del = 204, throwOn = null } = {}, seen = []) => (u, init) => {
    if (!u.startsWith(`https://${HOST}/`)) return null
    seen.push({ method: init.method, url: u, body: init.body ? new TextDecoder().decode(init.body) : null })
    if (throwOn === init.method) throw new TypeError('fetch failed')
    if (init.method === 'PUT') return new Response(null, { status: put })
    if (init.method === 'GET') return new Response(get[0] === 204 ? null : get[1], { status: get[0] })
    if (init.method === 'DELETE') return new Response(null, { status: del })
    return null
  }

  it('full success: the server stages, the client probe\'s three URLs, and the HMAC count', async () => {
    const seen = []
    const n = net({ dns: { [HOST]: [PUBLIC_IP] }, s3: bucket({}, seen) })
    const { call, events } = await secretWorld()
    fixRandom()
    const { out, n: hmacSigns } = await countHmac(() => call({ action: 'probe' }))
    const serverKey = `wilson/.wilson-probe/server-${Date.now()}-${RAND}`
    const clientKey = `wilson/.wilson-probe/client-${Date.now()}-${RAND}`
    expect(seen).toEqual([
      { method: 'PUT', url: await direct(CFG, 'PUT', serverKey, 120), body: 'wilson-probe' },
      { method: 'GET', url: await direct(CFG, 'GET', serverKey, 120), body: null },
      { method: 'DELETE', url: await direct(CFG, 'DELETE', serverKey, 120), body: null },
    ])
    const server = { method: 'pinned_fetch', put_ms: 0, get_ms: 0, del_ms: 0 } // the clock is frozen
    expect(out).toEqual({ status: 200, json: { ok: true, server, clientProbe: {
      putUrl: await direct(CFG, 'PUT', clientKey, 120),
      getUrl: await direct(CFG, 'GET', clientKey, 120),
      delUrl: await direct(CFG, 'DELETE', clientKey, 120),
      expiresAt: '2026-11-13T03:02:00.000Z',
    } } })
    expect(dnsAsked(n)).toEqual([doh(HOST, 'A'), doh(HOST, 'AAAA')])
    expect(events()).toEqual([{ code: 'WIL-3007', message: 'Bucket probe succeeded (server half)', context: server }])
    expect(hmacSigns).toBe(PROBE_HMAC_SIGNS)
  })

  it('a DELETE answering 404 still counts as success', async () => {
    net({ dns: { [HOST]: [PUBLIC_IP] }, s3: bucket({ del: 404 }) })
    const { call } = await secretWorld()
    expect((await call({ action: 'probe' })).json.ok).toBe(true)
  })

  it('the loading refusals, in order', async () => {
    const cases = [
      [{ wsError: { message: 'gone' } }, 500, { error: 'storage_read_failed', detail: 'gone' }],
      [{ ws: null }, 409, { error: 'refused', detail: 'save the bucket configuration first — there is nothing to probe yet' }],
      [{ ws: { mode: 'byos', provider: 's3', provider_config: null } }, 409, { error: 'refused', detail: 'save the bucket configuration first — there is nothing to probe yet' }],
      [{ secError: { message: 'denied' } }, 500, { error: 'secret_read_failed', detail: 'denied' }],
      [{ sec: null }, 409, { error: 'refused', detail: 'no bucket secret is stored — save the secret, then probe' }],
      [{ sec: { secret_ciphertext: 'not base64!' } }, 500, { error: 'secret_unusable', detail: 'the stored secret cannot be decrypted (Invalid character) — re-enter it' }],
      // No crypto_unavailable check in probe: the unset master secret surfaces as the decrypt's own error…
      [{ env: {} }, 500, { error: 'secret_unusable', detail: `the stored secret cannot be decrypted (${ST} is not configured) — re-enter it` }],
      // …and with no secret row as the 409.
      [{ env: {}, sec: null }, 409, { error: 'refused', detail: 'no bucket secret is stored — save the secret, then probe' }],
    ]
    for (const [opts, status, json] of cases) {
      const n = net()
      const { call, w } = await secretWorld(opts)
      expect(await call({ action: 'probe' })).toEqual({ status, json })
      expect(n.seen).toEqual([])
      // probe reads provider and config only (no mode), then the secret: one after the other.
      expect(reads(w)[0]).toEqual(wsRead('provider, provider_config'))
    }
  })

  it('the endpoint refusals → 409 with stage endpoint, logged', async () => {
    const cases = [
      ['https://10.0.0.5', {}, 'not_public', 'the S3 endpoint is an address inside a private network (10.0.0.5); WILSON sends bucket requests to public endpoints only'],
      ['https://minio.internal', {}, 'local_name', 'the S3 endpoint names a host inside a private network (minio.internal); WILSON sends bucket requests to public endpoints only'],
      ['https://abcd.supabase.co', {}, 'supabase_host', 'the S3 endpoint cannot be a WILSON host'],
      [`https://${HOST}`, { [HOST]: [] }, 'dns', `the S3 endpoint's name (${HOST}) does not resolve; check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure`],
      [`https://${HOST}`, { [HOST]: ['127.0.0.1'] }, 'not_public', `the S3 endpoint's name (${HOST}) resolves to an address inside a private network (127.0.0.1); WILSON sends bucket requests to public endpoints only`],
    ]
    for (const [endpoint, dns, reason, detail] of cases) {
      net({ dns })
      const { call, events } = await secretWorld({ ws: s3row({ ...CFG, endpoint }) })
      expect(await call({ action: 'probe' })).toEqual({ status: 409, json: { error: 'refused', stage: 'endpoint', detail } })
      expect(events()).toEqual([{ code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'endpoint', reason } }])
    }
    // An endpoint the signer cannot read: 409 refused, no stage, no event.
    net()
    const { call, events } = await secretWorld({ ws: s3row({ ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }) })
    expect(await call({ action: 'probe' })).toEqual({ status: 409, json: { error: 'refused', detail: 'the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear' } })
    expect(events()).toEqual([])
  })

  it('the probe failures, stage by stage', async () => {
    const redirect = (stage, status) => ({ error: 'probe_failed', stage, status, detail: `the bucket endpoint answered a redirect (HTTP ${status}), which WILSON does not follow — give the endpoint the bucket answers at directly` })
    const cases = [
      [{ put: 403 }, { error: 'probe_failed', stage: 'put', status: 403, detail: 'the bucket refused the credentials (403) — check the access key id and the secret' }, { stage: 'put', status: 403 }],
      [{ put: 404 }, { error: 'probe_failed', stage: 'put', status: 404, detail: 'no such bucket "petal-media" at this endpoint (404) — check the bucket name and region' }, { stage: 'put', status: 404 }],
      [{ put: 500 }, { error: 'probe_failed', stage: 'put', status: 500, detail: 'the probe upload was refused (HTTP 500)' }, { stage: 'put', status: 500 }],
      [{ put: 301 }, redirect('put', 301), { stage: 'redirect', status: 301 }],
      [{ get: [307, ''] }, redirect('get', 307), { stage: 'redirect', status: 307 }],
      [{ del: 302 }, redirect('del', 302), { stage: 'redirect', status: 302 }],
      [{ get: [200, 'something else'] }, { error: 'probe_failed', stage: 'get', status: 200, detail: 'the probe object read back with different content — something between WILSON and the bucket is rewriting bodies' }, { stage: 'get', status: 200 }],
      [{ get: [403, 'denied'] }, { error: 'probe_failed', stage: 'get', status: 403, detail: 'the probe object could not be read back (HTTP 403)' }, { stage: 'get', status: 403 }],
      [{ del: 403 }, { error: 'probe_failed', stage: 'del', status: 403, detail: 'the probe object uploaded and read back but could not be deleted (HTTP 403) — the key needs DeleteObject too, or purge and GC cannot work' }, { stage: 'del', status: 403 }],
      [{ throwOn: 'PUT' }, { error: 'probe_failed', stage: 'connect', detail: 'could not reach the bucket endpoint (fetch failed) — check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure' }, { stage: 'connect' }],
    ]
    for (const [script, json, context] of cases) {
      net({ dns: { [HOST]: [PUBLIC_IP] }, s3: bucket(script) })
      const { call, events } = await secretWorld()
      expect(await call({ action: 'probe' })).toEqual({ status: 502, json })
      expect(events()).toEqual([{ code: 'WIL-3007', message: 'Bucket probe failed', context }])
    }
  })
})
