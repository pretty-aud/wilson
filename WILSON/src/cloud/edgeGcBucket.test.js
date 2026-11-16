// =============================================================================
// edgeGcBucket.test.js — F8, the second merger (wave 2, 2026-11-13): how
// storage-gc's queue drain loads a company's own bucket and signs its DELETEs,
// pinned as the merged code (F7's storage-gc at 14bca27e) answered BEFORE the
// drain moved onto the shared loader, the shared host rule and one presigner
// a run (OUTSTANDING F8-02).
//
// storage-gc RUNS here: src/cloud/edgeHarness.js stands in for Deno, GoTrue
// and the database, and the admin guard is the real one. This file adds the
// two things storage-gc asks of a client that the harness does not have: the
// storage API (list and remove, which answer nothing here) and
// `.filter(column, 'in', list)` (kept as the harness's own `in`). fetch is the
// network: DNS-over-HTTPS and the bucket's answers are scripted, and any other
// URL fails the test. The clock is frozen, so a signed DELETE compares byte for
// byte with presignS3Request called directly. Every key is random bytes made
// here for one test: nobody's secret.
//
// Pinned: what storage-gc answers and writes. The run's status and counts,
// each queue row's status and detail, the WIL-3003 / WIL-3004 certificate, the
// URLs it sends, and one resolution of the bucket a run. Statements are pinned
// only where the move keeps them. The last block is the move's own
// measurement (the HMACs and the reads on a refusal): it was run red against
// the code before the move, with the numbers its comments give.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { newWorld, seatCaller, loadFunction, post, answerOf } from './edgeHarness.js'
import { presignS3Request, s3HostAndPath } from '../../supabase/functions/_shared/s3Presign.ts'
import { encryptStorageSecret, decryptStorageSecret } from '../../supabase/functions/_shared/storageSecretCrypto.ts'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => {
  const harness = await import('./edgeHarness.js')
  const WORLD = Symbol.for('wilson.edgeHarness.world')
  return {
    createClient: (...args) => {
      const client = harness.createClient(...args)
      const from = client.from
      client.from = (table) => {
        const b = from(table)
        // storage-gc's `.filter(column, 'in', '("a","b")')`: the harness's `in`, its value the list as sent.
        b.filter = (column, op, value) => {
          if (op !== 'in') throw new Error(`stand-in: filter op ${op}`)
          return b.in(column, value)
        }
        return b
      }
      client.storage = {
        from: (bucket) => ({
          list: async (prefix) => {
            globalThis[WORLD].calls.push({ kind: 'storage', name: 'list', bucket, prefix })
            return { data: [], error: null }
          },
          remove: async (paths) => {
            globalThis[WORLD].calls.push({ kind: 'storage', name: 'remove', bucket, paths })
            return { data: [], error: null }
          },
        }),
      }
      return client
    },
  }
})

const ST = 'WILSON_STORAGE_KEY_SECRET'
const NOW = new Date('2026-11-13T03:00:00Z')
const PID = '11111111-2222-4333-8444-555555555555'
const BUCKET_SECRET = 'harness-bucket-secret-gc-4d1e'
const PUBLIC_IP = '93.184.216.34'
const PRIVATE_IP = '10.0.0.7'

// A custom endpoint, path style, with a prefix: the vetted host is the endpoint's own.
const CFG = {
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  bucket: 'petal-media',
  prefix: 'wilson',
  accessKeyId: 'AKIDHARNESS',
  forcePathStyle: true,
}
const HOST = 's3.us-west-004.backblazeb2.com'
// Bare AWS, virtual-host style, no prefix: the vetted host is the bucket's subdomain.
const CFG_AWS = { region: 'eu-central-1', bucket: 'petal-media', accessKeyId: 'AKIDHARNESS' }
const VH = 'petal-media.s3.eu-central-1.amazonaws.com'

// storage-gc's own sentences (storage-gc/index.ts, the drain's bucket load).
const S = {
  wsRead: (m) => `workspace storage read failed: ${m}`,
  noS3: 'this workspace no longer has S3-compatible storage configured — its queued bucket deletions cannot be drained',
  secRead: (m) => `secret read failed: ${m}`,
  noSecret: 'no bucket secret is stored for this workspace — save it in Admin Terminal → Storage, then run cleanup again',
  unusable: (m) => `the stored bucket secret cannot be decrypted (${m}) — re-enter it, then run cleanup again`,
  vetted: (d) => `${d} — nothing was deleted`,
  deleted: 'blob removed at the workspace bucket (signed DELETE; S3 does not distinguish already-gone)',
  noBucket: 'the bucket itself did not resolve (404) — check the bucket name, endpoint and path-style setting in Admin Terminal → Storage. Nothing was deleted.',
  redirect: (s) => `the bucket endpoint answered a redirect (HTTP ${s}), which WILSON does not follow — give the endpoint the bucket answers at directly. Nothing was deleted.`,
  refused: (s) => `the bucket refused the delete (HTTP ${s})`,
  unreachable: (m) => `could not reach the bucket endpoint: ${m}`,
}

let KEY
let currentNet = null

beforeEach(() => {
  KEY = randomBytes(32).toString('base64')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  const leftover = currentNet ? currentNet.unexpected.slice() : []
  currentNet = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  expect(leftover, 'a fetch to a URL no test scripted').toEqual([])
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function withDenoEnv(env, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'Deno')
  const prev = globalThis.Deno
  globalThis.Deno = { env: { get: (n) => env[n] } }
  try { return await fn() } finally { if (had) globalThis.Deno = prev; else delete globalThis.Deno }
}
const seal = (plain, env = { [ST]: KEY }) => withDenoEnv(env, () => encryptStorageSecret(plain))
/** The decrypt's own words for a ciphertext under an environment (what storage-gc quotes). */
const decryptWords = (ct, env) => withDenoEnv(env, () => decryptStorageSecret(ct)).then(() => null, (e) => e.message)

const s3row = (cfg = CFG) => ({ provider: 's3', provider_config: cfg })
const targetOf = (c) => ({ endpoint: c.endpoint, region: c.region, bucket: c.bucket, forcePathStyle: c.forcePathStyle })
/** presignS3Request as the drain calls it, with the clock frozen at NOW. */
const direct = (cfg, path) => presignS3Request({
  target: targetOf(cfg), accessKeyId: cfg.accessKeyId, secretAccessKey: BUCKET_SECRET,
  method: 'DELETE', key: cfg.prefix ? `${cfg.prefix}/${path}` : path, expiresSeconds: 60, now: new Date(),
})

/** The network: DNS-over-HTTPS per host, and the bucket's answers. Anything else fails. */
function net({ dns = {}, s3 = () => null } = {}) {
  const state = { seen: [], unexpected: [], deletes: [] }
  currentNet = state
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url)
    state.seen.push({ url: u, method: init.method ?? 'GET', redirect: init.redirect })
    const m = /^https:\/\/cloudflare-dns\.com\/dns-query\?name=([^&]+)&type=(A|AAAA)$/.exec(u)
    if (m) {
      const host = decodeURIComponent(m[1])
      if (host in dns) {
        const answers = m[2] === 'A' ? (dns[host].A ?? dns[host]) : (dns[host].AAAA ?? [])
        const code = m[2] === 'A' ? 1 : 28
        return new Response(JSON.stringify({ Answer: (Array.isArray(answers) ? answers : []).map((data) => ({ type: code, data })) }))
      }
    } else {
      if ((init.method ?? 'GET') === 'DELETE') state.deletes.push(u)
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
/** A bucket at `host` that answers every DELETE with `status`. */
const bucketAt = (host, status = 204) => net({
  dns: { [host]: [PUBLIC_IP] },
  s3: (u, init) => (init.method === 'DELETE' && u.startsWith(`https://${host}/`) ? new Response(null, { status }) : null),
})

const key = (leaf) => `projects/${PID}/assets/${leaf}`

/** The run's counts, as storage-gc answers them, with the given ones changed. */
const counts = (over = {}) => ({
  queue_deleted: 0, queue_missing: 0, queue_failed: 0,
  orphans_deleted: 0, avatar_orphans_deleted: 0,
  skipped_recent: 0, skipped_foreign_or_unknown: 0, skipped_reserved: 0, skipped_twin: 0, scan_failed: 0,
  queue_s3_drained: 0,
  reservations_abandoned: 0, reservations_completed: 0, reservation_sweep_failed: false,
  certify_failed: 0, truncated: false,
  ...over,
})

/**
 * A world for storage-gc: an admin seated, the queue's rows (s3 bodies unless
 * told otherwise), the bucket's configuration and secret. `wsRead` / `secRead`
 * replace a table's answer whole.
 */
async function gcWorld(opts = {}) {
  const env = 'env' in opts ? opts.env : { [ST]: KEY }
  const { handler } = await loadFunction(vi, 'storage-gc', env)
  const w = newWorld()
  const caller = seatCaller(w, { role: 'admin' })
  const sec = 'sec' in opts ? opts.sec : { secret_ciphertext: await seal(BUCKET_SECRET) }
  const ws = 'ws' in opts ? opts.ws : s3row()
  w.table('workspace_storage', opts.wsRead ?? (() => ({ data: ws, error: null })))
  w.table('workspace_storage_secrets', opts.secRead ?? (() => ({ data: sec, error: null })))
  const rows = (opts.queue ?? []).map((r, i) => ({ id: 100 + i, bucket_id: 'byo-s3', provider: 's3', kind: 'body', ...r }))
  const updates = []
  w.table('storage_gc_queue', (q) => {
    if (q.op === 'select') return { data: rows.map((r) => ({ ...r })), error: null }
    if (q.op === 'update') updates.push({ id: q.filters.find((f) => f.column === 'id').value, ...q.values })
    return { data: null, error: null }
  })
  const events = []
  w.table('app_events', (q) => {
    if (q.op === 'insert') events.push(q.values)
    return { data: null, error: null }
  })
  const run = async () => {
    const a = await answerOf(await handler(post({}, { token: caller.token })))
    return { status: a.status, json: a.json }
  }
  return { w, run, updates, events, caller }
}

/** Each queue row as the drain stamped it. */
const stamped = (updates) => updates.map((u) => ({ id: u.id, status: u.status, detail: u.detail, processed_at: u.processed_at }))
const failedWith = (detail, ids) => ids.map((id) => ({ id, status: 'failed', detail, processed_at: NOW.toISOString() }))
const deletedRows = (ids) => ids.map((id) => ({ id, status: 'deleted', detail: S.deleted, processed_at: NOW.toISOString() }))
/** The run's certificate as logAdminEvent writes it. */
const certificate = (code, c, message = 'Storage cleanup completed') => ({
  workspace_id: 'ws-1', actor_user_id: 'user-1', event_type: 'admin', code, severity: 'info', message, context: c,
})
const bucketReads = (w) => w.calls.filter((c) => c.kind === 'table' && (c.name === 'workspace_storage' || c.name === 'workspace_storage_secrets'))
  .map((c) => ({ name: c.name, op: c.op, columns: c.columns, filters: c.filters, terminal: c.terminal, by: c.by }))
const wsStatement = { name: 'workspace_storage', op: 'select', columns: 'provider, provider_config', filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }], terminal: 'maybeSingle', by: 'service' }
const secStatement = { name: 'workspace_storage_secrets', op: 'select', columns: 'secret_ciphertext', filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }], terminal: 'maybeSingle', by: 'service' }

// =============================================================================
// A. The bucket that answers: one resolution, one DELETE a row, the URLs signed
// =============================================================================

describe('storage-gc: the drain reaches a company bucket that answers', () => {
  it('path style with a prefix: one DELETE a row, each URL byte for byte presignS3Request, the rows certified', async () => {
    const n = bucketAt(HOST)
    const paths = [key('a.exr'), key('two words (final).mov'), key('é-ünïcode.png')]
    const { run, w, updates, events } = await gcWorld({ queue: paths.map((p) => ({ object_path: p })) })
    const out = await run()
    expect(out).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_deleted: 3, queue_s3_drained: 3 }) } })
    expect(n.deletes).toEqual(await Promise.all(paths.map((p) => direct(CFG, p))))
    expect(stamped(updates)).toEqual(deletedRows([100, 101, 102]))
    expect(events).toEqual([certificate('WIL-3003', counts({ queue_deleted: 3, queue_s3_drained: 3 }))])
    // One resolution a run: the configuration once, the secret once, the host vetted once.
    expect(bucketReads(w)).toEqual([wsStatement, secStatement])
    expect(dnsAsked(n)).toEqual([doh(HOST, 'A'), doh(HOST, 'AAAA')])
    // Never by redirect: the request is sent with redirect: 'manual'.
    expect(n.seen.filter((s) => s.method === 'DELETE').every((s) => s.redirect === 'manual')).toBe(true)
  })

  it('virtual-host style with no prefix: the URL names the bucket subdomain, byte for byte presignS3Request', async () => {
    const n = bucketAt(VH)
    const { run, updates } = await gcWorld({ ws: s3row(CFG_AWS), queue: [{ object_path: key('b.pdf') }] })
    expect(await run()).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_deleted: 1, queue_s3_drained: 1 }) } })
    expect(n.deletes).toEqual([await direct(CFG_AWS, key('b.pdf'))])
    expect(n.deletes[0].startsWith(`https://${VH}/${key('b.pdf')}?`)).toBe(true)
    expect(stamped(updates)).toEqual(deletedRows([100]))
    expect(dnsAsked(n)).toEqual([doh(VH, 'A'), doh(VH, 'AAAA')])
  })

  it('a thumbnail row of the company bucket goes the same way (the drain reads the provider, not the kind)', async () => {
    const n = bucketAt(HOST)
    const { run, updates } = await gcWorld({ queue: [{ object_path: key('pic.webp'), kind: 'thumbnail' }] })
    expect((await run()).json.counts).toEqual(counts({ queue_deleted: 1, queue_s3_drained: 1 }))
    expect(n.deletes).toEqual([await direct(CFG, key('pic.webp'))])
    expect(stamped(updates)).toEqual(deletedRows([100]))
  })

  it('no queue row of the company bucket: the bucket is never loaded', async () => {
    net()
    const { run, w } = await gcWorld({ queue: [{ object_path: key('p.pdf'), provider: 'supabase', bucket_id: 'rabbit-files' }] })
    expect((await run()).status).toBe(200)
    expect(bucketReads(w)).toEqual([])
  })

  it('SUPABASE_URL unset: the drain still runs (the own-host check has nothing to compare with)', async () => {
    const n = bucketAt(HOST)
    const { run } = await gcWorld({ env: { [ST]: KEY, SUPABASE_URL: undefined }, queue: [{ object_path: key('c.bin') }] })
    expect((await run()).json.counts).toEqual(counts({ queue_deleted: 1, queue_s3_drained: 1 }))
    expect(n.deletes).toEqual([await direct(CFG, key('c.bin'))])
  })
})

// =============================================================================
// B. The bucket's answers, row by row
// =============================================================================

describe('storage-gc: what the bucket answers decides each row', () => {
  for (const [status, detail] of [[404, S.noBucket], [302, S.redirect(302)], [301, S.redirect(301)], [403, S.refused(403)], [500, S.refused(500)]]) {
    it(`HTTP ${status}: the row fails with its sentence, nothing is certified deleted`, async () => {
      bucketAt(HOST, status)
      const { run, updates, events } = await gcWorld({ queue: [{ object_path: key('d.bin') }, { object_path: key('e.bin') }] })
      expect(await run()).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_failed: 2 }) } })
      expect(stamped(updates)).toEqual(failedWith(detail, [100, 101]))
      expect(events).toEqual([certificate('WIL-3003', counts({ queue_failed: 2 }))])
    })
  }

  it('a bucket that stops answering is asked once in a run: the rest of its rows fail with the same words, the run goes on', async () => {
    // The DELETE is answered by a throw (a refused connection), so it is not "unexpected".
    const n = net({ dns: { [HOST]: [PUBLIC_IP] }, s3: (u, init) => { if (init.method === 'DELETE') throw new Error('connection refused'); return null } })
    const { run, updates, events } = await gcWorld({ queue: [{ object_path: key('f.bin') }, { object_path: key('g.bin') }, { object_path: key('h.bin') }] })
    expect(await run()).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_failed: 3 }) } })
    expect(n.deletes).toEqual([await direct(CFG, key('f.bin'))])
    expect(stamped(updates)).toEqual(failedWith(S.unreachable('connection refused'), [100, 101, 102]))
    expect(events).toEqual([certificate('WIL-3003', counts({ queue_failed: 3 }))])
  })
})

// =============================================================================
// C. The bucket that cannot be loaded: each refusal, in its words, once a run
// =============================================================================

describe('storage-gc: the bucket that cannot be loaded, refusal by refusal', () => {
  const two = [{ object_path: key('r1.bin') }, { object_path: key('r2.bin') }]

  /** Run a world that refuses; every s3 row fails with `detail`, and the configuration is read once. */
  async function refuses(opts, detail, { dnsHost = null } = {}) {
    const n = net()
    const { run, w, updates, events } = await gcWorld({ queue: two, ...opts })
    expect(await run()).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_failed: 2 }) } })
    expect(stamped(updates)).toEqual(failedWith(detail, [100, 101]))
    expect(events).toEqual([certificate('WIL-3003', counts({ queue_failed: 2 }))])
    expect(w.calls.filter((c) => c.name === 'workspace_storage').length).toBe(1)
    expect(n.deletes).toEqual([])
    if (!dnsHost) expect(dnsAsked(n)).toEqual([])
    return { w, n }
  }

  it('the workspace_storage read fails', async () => {
    await refuses({ wsRead: () => ({ data: null, error: { message: 'connection reset by peer' } }) }, S.wsRead('connection reset by peer'))
  })
  for (const [name, ws] of [
    ['no configuration row', null],
    ['another provider', { provider: 'supabase', provider_config: CFG }],
    ['s3 with no provider_config', { provider: 's3', provider_config: null }],
  ]) {
    it(`not S3: ${name}`, async () => { await refuses({ ws }, S.noS3) })
  }
  it('the workspace_storage_secrets read fails', async () => {
    await refuses({ secRead: () => ({ data: null, error: { message: 'statement timeout' } }) }, S.secRead('statement timeout'))
  })
  it('no secret row', async () => { await refuses({ sec: null }, S.noSecret) })
  it('an empty ciphertext is "no secret", never "cannot be decrypted"', async () => {
    await refuses({ sec: { secret_ciphertext: '' } }, S.noSecret)
  })
  it('a ciphertext that will not open: the decrypt\'s own words', async () => {
    const words = await decryptWords('not base64!', { [ST]: KEY })
    expect(words).toBeTruthy()
    await refuses({ sec: { secret_ciphertext: 'not base64!' } }, S.unusable(words))
  })
  it('a secret sealed under another master key', async () => {
    const other = randomBytes(32).toString('base64')
    const sealed = await seal(BUCKET_SECRET, { [ST]: other })
    const words = await decryptWords(sealed, { [ST]: KEY })
    await refuses({ sec: { secret_ciphertext: sealed } }, S.unusable(words))
  })
  it('no master key on this environment: the decrypt says so (no crypto check is asked first)', async () => {
    const sealed = await seal(BUCKET_SECRET)
    const words = await decryptWords(sealed, {})
    expect(words).toContain(ST)
    await refuses({ env: {}, sec: { secret_ciphertext: sealed } }, S.unusable(words))
  })
  it('no master key AND no secret row: "no secret" (the decrypt is never reached)', async () => {
    await refuses({ env: {}, sec: null }, S.noSecret)
  })
  it('an endpoint the signer cannot use (http://): the signer\'s own words, no lookup', async () => {
    const cfg = { ...CFG, endpoint: 'http://s3.us-west-004.backblazeb2.com' }
    let words = null
    try { s3HostAndPath(targetOf(cfg), 'probe') } catch (e) { words = e.message }
    expect(words).toBeTruthy()
    await refuses({ ws: s3row(cfg) }, words)
  })
  it('the project\'s own host as the endpoint: refused, no lookup', async () => {
    const own = 'api.petal-own-project.com'
    await refuses({ env: { [ST]: KEY, SUPABASE_URL: `https://${own}` }, ws: s3row({ ...CFG, endpoint: `https://${own}` }) },
      S.vetted('the S3 endpoint cannot be a WILSON host'))
  })
  it('any *.supabase.co endpoint: refused, no lookup', async () => {
    await refuses({ ws: s3row({ ...CFG, endpoint: 'https://abcd.supabase.co' }) }, S.vetted('the S3 endpoint cannot be a WILSON host'))
  })
  it('a private address as the endpoint: refused, no lookup', async () => {
    await refuses({ ws: s3row({ ...CFG, endpoint: `https://${PRIVATE_IP}` }) },
      S.vetted(`the S3 endpoint is an address inside a private network (${PRIVATE_IP}); WILSON sends bucket requests to public endpoints only`))
  })
  it('a name that resolves to a private address: refused once, after one lookup', async () => {
    const n = net({ dns: { [HOST]: [PRIVATE_IP] } })
    const { run, updates } = await gcWorld({ queue: two })
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 2 }))
    expect(stamped(updates)).toEqual(failedWith(S.vetted(`the S3 endpoint's name (${HOST}) resolves to an address inside a private network (${PRIVATE_IP}); WILSON sends bucket requests to public endpoints only`), [100, 101]))
    expect(dnsAsked(n)).toEqual([doh(HOST, 'A'), doh(HOST, 'AAAA')])
    expect(n.deletes).toEqual([])
  })
  it('a name that does not resolve', async () => {
    const n = net({ dns: { [HOST]: [] } })
    const { run, updates } = await gcWorld({ queue: two })
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 2 }))
    expect(stamped(updates)).toEqual(failedWith(S.vetted(`the S3 endpoint's name (${HOST}) does not resolve; check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure`), [100, 101]))
    expect(n.deletes).toEqual([])
  })
})

describe('storage-gc: the order when two things are wrong at once, and reads that throw', () => {
  const one = [{ object_path: key('o.bin') }]

  it('no S3 configuration AND the secret read failing: the configuration answers first', async () => {
    net()
    const { run, updates } = await gcWorld({ queue: one, ws: null, secRead: () => ({ data: null, error: { message: 'x' } }) })
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 1 }))
    expect(stamped(updates)).toEqual(failedWith(S.noS3, [100]))
  })
  it('the configuration read failing AND no secret: the configuration answers first', async () => {
    net()
    const { run, updates } = await gcWorld({ queue: one, sec: null, wsRead: () => ({ data: null, error: { message: 'y' } }) })
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 1 }))
    expect(stamped(updates)).toEqual(failedWith(S.wsRead('y'), [100]))
  })
  it('no S3 configuration AND a secret read that THROWS: still the configuration\'s words, and no unhandled rejection', async () => {
    net()
    const unhandled = []
    const onUnhandled = (e) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      const { run, updates } = await gcWorld({ queue: one, ws: null, secRead: () => { throw new Error('the socket closed') } })
      expect(await run()).toEqual({ status: 200, json: { ok: true, counts: counts({ queue_failed: 1 }) } })
      expect(stamped(updates)).toEqual(failedWith(S.noS3, [100]))
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
  it('a configuration read that THROWS ends the run: 500 gc_failed with its message, and a WIL-3004 certificate', async () => {
    net()
    const { run, updates, events } = await gcWorld({ queue: one, wsRead: () => { throw new Error('the socket closed') } })
    const c = counts({ reservation_sweep_failed: true })
    expect(await run()).toEqual({ status: 500, json: { error: 'gc_failed', detail: 'the socket closed', counts: c } })
    expect(updates).toEqual([])
    expect(events).toEqual([certificate('WIL-3004', c, 'Storage cleanup failed: the socket closed')])
  })
  it('a secret read that THROWS once the configuration has passed ends the run the same way', async () => {
    net()
    const { run, events } = await gcWorld({ queue: one, secRead: () => { throw new Error('the pooler went away') } })
    const c = counts({ reservation_sweep_failed: true })
    expect(await run()).toEqual({ status: 500, json: { error: 'gc_failed', detail: 'the pooler went away', counts: c } })
    expect(events).toEqual([certificate('WIL-3004', c, 'Storage cleanup failed: the pooler went away')])
  })
  it('a bucket refusal is remembered for the run: a hundred rows, one configuration read, one secret read', async () => {
    net()
    const queue = Array.from({ length: 100 }, (_, i) => ({ object_path: key(`m${i}.bin`) }))
    const { run, w, updates } = await gcWorld({ queue, sec: null })
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 100 }))
    expect(new Set(updates.map((u) => u.detail))).toEqual(new Set([S.noSecret]))
    expect(bucketReads(w)).toEqual([wsStatement, secStatement])
  })
})

// =============================================================================
// D. The move's own measurement (OUTSTANDING F8-02). Run red against the code
// before the move: the HMACs were 5 a URL (15 for three rows), and a refused
// configuration read only workspace_storage.
// =============================================================================

describe('F8-02: one presigner a run, and the shared loader\'s two reads', () => {
  /** Count the HMAC signatures WebCrypto is asked for while `fn` runs. */
  async function countHmac(fn) {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'sign')
    const out = await fn()
    const n = spy.mock.calls.filter(([alg]) => alg === 'HMAC' || alg?.name === 'HMAC').length
    spy.mockRestore()
    return { out, n }
  }

  it('three rows: the signing key derived once (four HMACs) and one more a URL, 7 in all where 15 were', async () => {
    const n = bucketAt(HOST)
    const paths = [key('x.bin'), key('y.bin'), key('z.bin')]
    const { run } = await gcWorld({ queue: paths.map((p) => ({ object_path: p })) })
    const { out, n: signs } = await countHmac(run)
    expect(out.json.counts).toEqual(counts({ queue_deleted: 3, queue_s3_drained: 3 }))
    expect(signs).toBe(4 + paths.length)
    // ...and still the same bytes.
    expect(n.deletes).toEqual(await Promise.all(paths.map((p) => direct(CFG, p))))
  })

  it('a refused configuration: the secret row is read too (the loader starts both at once), and never opened', async () => {
    net()
    const { run, w, updates } = await gcWorld({ queue: [{ object_path: key('q.bin') }], ws: null })
    const decrypt = vi.spyOn(globalThis.crypto.subtle, 'decrypt')
    expect((await run()).json.counts).toEqual(counts({ queue_failed: 1 }))
    expect(stamped(updates)).toEqual(failedWith(S.noS3, [100]))
    expect(bucketReads(w)).toEqual([wsStatement, secStatement])
    expect(decrypt).not.toHaveBeenCalled()
  })
})
