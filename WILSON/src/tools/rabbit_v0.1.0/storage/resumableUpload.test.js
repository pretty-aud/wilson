// =============================================================================
// resumableUpload.test.js — Session 42
//
// 🚨 THIS FILE EXISTS BECAUSE THE SUITE WENT GREEN THE MOMENT THE RESUMABLE
// PATH WAS WIRED, WITHOUT ANY TEST HAVING EXECUTED IT. Nine features have
// shipped in this repo with no caller and a green suite over a dead path is the
// costliest pattern in it, so the branch is exercised here rather than assumed.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const read = (...p) => readFileSync(join(REPO, ...p), 'utf-8')
// One alternating pass, block alternative first — a separate block pass eats
// 40 lines of real code when a line comment opens a block (S39, measured).
const executable = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

// ── The tus double ───────────────────────────────────────────────────────────
// Captures the options the module hands the library, so the properties that
// carry correctness (chunk size, metadata, fingerprint, retry policy) are
// asserted as VALUES rather than grepped for in source text.
const started = []
vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(body, opts) {
      this.body = body
      this.opts = opts
      started.push(this)
    }
    start() { this.startedFlag = true }
  },
}))

const {
  putResumable, shouldUseResumable, shouldRetryTusError,
  RESUMABLE_THRESHOLD_BYTES, TUS_CHUNK_SIZE,
} = await import('./resumableUpload.js')

const MIB = 1024 * 1024
const blob = (bytes, type = 'video/mp4') => ({ size: bytes, type })

beforeEach(() => { started.length = 0 })

// ═════════════════════════════════════════════════════════════════════════════
describe('the threshold, and why it is the old cap', () => {
  // 🚨 THE SAFETY ARGUMENT OF THE WHOLE SESSION. Every upload that was possible
  // before 0057 is <= 50 MiB and must still take the standard path it has
  // always taken, so a bug in the resumable code cannot reach it. If this
  // number ever drops, that argument is gone and this test is how you find out.
  it('switches at exactly the pre-0057 ceiling, 50 MiB', () => {
    expect(RESUMABLE_THRESHOLD_BYTES).toBe(52_428_800)
  })

  it('is strictly ABOVE the threshold — 50 MiB itself still goes standard', () => {
    expect(shouldUseResumable(blob(RESUMABLE_THRESHOLD_BYTES))).toBe(false)
    expect(shouldUseResumable(blob(RESUMABLE_THRESHOLD_BYTES + 1))).toBe(true)
  })

  it('an unknown size falls back to the path that has always worked', () => {
    expect(shouldUseResumable(null)).toBe(false)
    expect(shouldUseResumable({})).toBe(false)
    expect(shouldUseResumable({ size: NaN })).toBe(false)
    expect(shouldUseResumable({ size: 'big' })).toBe(false)
  })

  it('Supabase fixes the chunk size at 6 MB — it is not a tuning knob', () => {
    expect(TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('🚨 a refusal must not be retried', () => {
  const errWith = (status) => ({ originalResponse: { getStatus: () => status } })

  // An RLS refusal (the quota gate, a suspended plan, an unwritable path) is
  // PERMANENT. tus's default policy would retry it five times over ~19s and
  // then report the same "no" — turning an instant, explainable refusal into a
  // long pause. This is the arm that keeps 0057's quota denial fast.
  it('does not retry 4xx — an over-quota upload fails immediately', () => {
    for (const s of [400, 403, 404, 409, 413]) {
      expect(shouldRetryTusError(errWith(s))).toBe(false)
    }
  })

  // 🚨 401 IS THE EXCEPTION, AND THIS TEST USED TO ASSERT THE OPPOSITE.
  // The first draft listed 401 among the permanent refusals, which — combined
  // with a bearer token frozen at upload start — meant no upload could outlive
  // its JWT. jwt_expiry is 3600 s and auth-js hands back a token with as little
  // as 91 s of life, so on a slow link the headline feature failed at a random
  // byte offset roughly `duration / 3600` of the time, and ALWAYS above an hour.
  // Found by this session's pre-deploy adversarial review, confirmed twice.
  it('🚨 DOES retry 401 — a token can expire mid-upload and be refreshed', () => {
    expect(shouldRetryTusError(errWith(401))).toBe(true)
  })

  it('DOES retry 423 — storage-api locks an object transiently', () => {
    expect(shouldRetryTusError(errWith(423))).toBe(true)
  })

  it('DOES retry 5xx and a bare network error — that is what resume is for', () => {
    expect(shouldRetryTusError(errWith(500))).toBe(true)
    expect(shouldRetryTusError(errWith(502))).toBe(true)
    expect(shouldRetryTusError({})).toBe(true)
    expect(shouldRetryTusError(new Error('network down'))).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('putResumable', () => {
  it('refuses to start without a session rather than 401ing mid-chunk', () => {
    expect(() => putResumable({
      bucket: 'rabbit-files', key: 'projects/p/ASSETS/a/1-x.mov',
      body: blob(80 * MIB), accessToken: null,
    })).toThrow(/signed-in session/)
    expect(started).toHaveLength(0)
  })

  it('targets the resumable endpoint and names the bucket in metadata', () => {
    putResumable({
      bucket: 'rabbit-files', key: 'projects/p/ASSETS/a/1-x.mov',
      body: blob(80 * MIB), accessToken: 'JWT', contentType: 'video/quicktime',
    })
    const { opts } = started[0]
    expect(opts.endpoint).toMatch(/\/storage\/v1\/upload\/resumable$/)
    expect(opts.metadata.bucketName).toBe('rabbit-files')
    expect(opts.metadata.objectName).toBe('projects/p/ASSETS/a/1-x.mov')
    expect(opts.metadata.contentType).toBe('video/quicktime')
    expect(opts.chunkSize).toBe(TUS_CHUNK_SIZE)
    expect(started[0].startedFlag).toBe(true)
  })

  it('carries the caller’s bearer token, not the anon key alone', () => {
    putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB), accessToken: 'JWT',
    })
    expect(started[0].opts.headers.authorization).toBe('Bearer JWT')
  })

  // ── 🚨 The token must not be frozen at upload start ───────────────────────
  // These four exist because the review found a HIGH defect here: tus re-reads
  // options.headers per request, but nothing mutated it, so an upload that
  // outlived its JWT died on a 401 with no resume. Asserting the HEADER alone
  // (the test above) could never have caught it — it is true both before and
  // after the fix.

  it('🚨 re-reads a FRESH token before every request', async () => {
    let n = 0
    putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB),
      accessToken: 'OLD', getAccessToken: async () => `NEW${++n}`,
    })
    const set = []
    const req = { setHeader: (h, v) => set.push([h, v]) }
    await started[0].opts.onBeforeRequest(req)
    await started[0].opts.onBeforeRequest(req)
    expect(set).toEqual([
      ['authorization', 'Bearer NEW1'],
      ['authorization', 'Bearer NEW2'],
    ])
  })

  it('fails SOFT — a failed refresh keeps the existing header rather than clearing it', async () => {
    putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB),
      accessToken: 'OLD', getAccessToken: async () => { throw new Error('session read failed') },
    })
    const set = []
    await expect(
      started[0].opts.onBeforeRequest({ setHeader: (h, v) => set.push([h, v]) }),
    ).resolves.toBeUndefined()
    // Nothing set: the stale token may still be valid, and stripping
    // authorization would guarantee the 401 it is meant to avoid.
    expect(set).toEqual([])
  })

  it('a null refresh does not blank the authorization header', async () => {
    putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB),
      accessToken: 'OLD', getAccessToken: async () => null,
    })
    const set = []
    await started[0].opts.onBeforeRequest({ setHeader: (h, v) => set.push([h, v]) })
    expect(set).toEqual([])
  })

  it('omits the hook entirely when no reader is supplied', () => {
    putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB), accessToken: 'JWT',
    })
    expect(started[0].opts.onBeforeRequest).toBeUndefined()
  })

  // 🚨 THE FINGERPRINT IS KEYED ON THE DESTINATION, NOT THE FILE.
  // tus's default fingerprint derives from the file, and our keys carry
  // Date.now() — so a second attempt at the same bytes targets a different
  // object. A file-keyed fingerprint could resume the earlier upload URL and
  // stream these bytes to the OLD key, producing an orphan object and a `files`
  // row pointing at nothing, at once.
  it('fingerprints by destination so two keys can never collide', async () => {
    putResumable({ bucket: 'rabbit-files', key: 'A', body: blob(80 * MIB), accessToken: 'J' })
    putResumable({ bucket: 'rabbit-files', key: 'B', body: blob(80 * MIB), accessToken: 'J' })
    const a = await started[0].opts.fingerprint()
    const b = await started[1].opts.fingerprint()
    expect(a).not.toBe(b)
    expect(a).toContain('A')
    expect(b).toContain('B')
  })

  it('rejects with the server’s own sentence, not a generic failure', async () => {
    const p = putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB), accessToken: 'J',
    })
    started[0].opts.onError({
      message: 'tus: failed',
      originalResponse: {
        getStatus: () => 403,
        getBody: () => JSON.stringify({ message: 'new row violates row-level security policy' }),
      },
    })
    await expect(p).rejects.toThrow(/403.*row-level security/s)
  })

  it('resolves with { key } so it satisfies the provider put() contract', async () => {
    const p = putResumable({
      bucket: 'rabbit-files', key: 'the/key', body: blob(80 * MIB), accessToken: 'J',
    })
    started[0].opts.onSuccess()
    await expect(p).resolves.toEqual({ key: 'the/key' })
  })

  it('a throwing progress callback cannot fail the upload', async () => {
    const p = putResumable({
      bucket: 'rabbit-files', key: 'k', body: blob(80 * MIB), accessToken: 'J',
      onProgress: () => { throw new Error('a progress bar blew up') },
    })
    expect(() => started[0].opts.onProgress(1, 2)).not.toThrow()
    started[0].opts.onSuccess()
    await expect(p).resolves.toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Source-level pins for properties that have no runtime surface here. Comments
// are stripped first: this file's own header explains why findPreviousUploads
// is absent, and a naive grep would match that explanation (the 0038 trap,
// which has now caught this repo three times).
describe('🚨 source pins', () => {
  const src = executable(read('src', 'tools', 'rabbit_v0.1.0', 'storage', 'resumableUpload.js'))

  it('never calls findPreviousUploads — it would resume onto a stale key', () => {
    expect(src).not.toContain('findPreviousUploads')
    expect(src).not.toContain('resumeFromPreviousUpload')
  })

  it('sends x-upsert false, so the INSERT branch (and the quota) stays in play', () => {
    expect(src).toMatch(/['"]x-upsert['"]\s*:\s*['"]false['"]/)
  })

  const provider = executable(read('src', 'tools', 'rabbit_v0.1.0', 'storage', 'supabaseProvider.js'))

  // 🚨 The provider must hand over a READER, not a reading. Passing
  // `accessToken` alone compiles, runs, and reproduces the HIGH defect exactly.
  it('the provider passes a token READER, not just a frozen string', () => {
    expect(provider).toMatch(/getAccessToken:\s*readToken/)
    expect(provider).toMatch(/const readToken = async \(\)/)
  })

  // ── 🚨 The progress chain must have a CALLER at every link ────────────────
  // Until S42's review, putResumable accepted onProgress, supabaseProvider.put
  // forwarded it, and the only upload call site passed nothing — a complete
  // feature with no caller, which is this repo's costliest pattern and had
  // already happened nine times. Each link is pinned separately, because any
  // one of them going missing restores the bare spinner silently.
  describe('the progress chain, link by link', () => {
    const adapter = executable(read('src', 'tools', 'rabbit_v0.1.0', 'adapters', 'supabaseAdapter.js'))
    const rabbit = executable(read('src', 'tools', 'rabbit_v0.1.0', 'state', 'RabbitProvider.jsx'))
    const manager = executable(read('src', 'tools', 'rabbit_v0.1.0', 'components', 'FileManager.jsx'))

    it('putResumable hands tus a progress callback', () => {
      expect(src).toMatch(/onProgress:\s*typeof onProgress === 'function'/)
    })

    it('the provider forwards opts.onProgress into putResumable', () => {
      expect(provider).toMatch(/onProgress:\s*opts\.onProgress/)
    })

    it('the adapter forwards opts.onProgress into put()', () => {
      expect(adapter).toMatch(/onProgress:\s*opts\.onProgress/)
    })

    // 🚨 NOT ON `scope`. scope describes the ROW and its keys reach the files
    // INSERT through the column allowlist; a callback there would be stripped
    // or land as a value. Progress is transport and travels beside it.
    it('the adapter takes progress as a FOURTH parameter, not a scope key', () => {
      expect(adapter).toMatch(/async uploadFile\(projectId, scope = \{\}, file, opts = \{\}\)/)
      expect(rabbit).toMatch(/uploadFile\(activeProjectId, scope, file, opts\)/)
    })

    // ⚠️ THE COLON IS LOAD-BEARING. Written as `...?onProgress` this also
    // matches `onProgressX`, so a renamed-and-therefore-dead callback would
    // satisfy it — a pin that accepts the defect it exists to catch.
    it('🚨 FileManager actually SUPPLIES one — the link that was missing', () => {
      expect(manager).toMatch(/ctx\.uploadFile\(file, uploadScope, \{[\s\S]{0,200}?onProgress:/)
    })

    it('it feeds the same copyProgress surface the managed path renders', () => {
      const block = manager.slice(manager.indexOf('ctx.uploadFile(file, uploadScope'))
        .slice(0, 500)
      expect(block).toContain('setCopyProgress')
      expect(block).toMatch(/percent/)
    })

    // A bar frozen at 73% after a failure reads as "still working".
    //
    // ⚠️ SCOPED TO THE CLOUD FUNCTION, NOT COUNTED OVER THE FILE. A whole-file
    // count was the first form and it is the wrong instrument twice over: it
    // sat exactly on its own threshold, and an unrelated clear added anywhere
    // else in the component would mask the removal of one of these three.
    it('clears the bar between files, on failure, and in the outer finally', () => {
      const start = manager.indexOf('const handleAddCloudFiles')
      const end = manager.indexOf('const handleAddManagedFiles')
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const cloud = manager.slice(start, end)
      const nulls = cloud.match(/setCopyProgress\(null\)/g) || []
      expect(nulls).toHaveLength(3)
    })
  })

  it('the provider branches on shouldUseResumable before the standard upload', () => {
    expect(provider).toContain('shouldUseResumable')
    expect(provider.indexOf('shouldUseResumable'))
      .toBeLessThan(provider.indexOf('b.upload('))
  })

  // ⚠️ S3 HAS NO TUS ENDPOINT. S37's provider uploads through a presigned PUT
  // and its 5 GB single-PUT ceiling is unchanged by this session — S3 multipart
  // is separate work that was not done. If this ever fails, someone has given
  // s3 a resumable path without giving it multipart, and the 5 GB limit will
  // start lying.
  //
  // ⚠️ AND THE FIRST FORM OF THIS ASSERTION WAS `not.toContain('tus')`, WHICH
  // FAILED — because `tus` is a substring of `status`, and s3Provider checks
  // `res.status` five times. The same collision cost a grep at the start of
  // this session. Assert the IMPORT and the CALL, which cannot be swallowed by
  // an unrelated identifier.
  it('s3Provider was NOT given a resumable path', () => {
    const s3 = executable(read('src', 'tools', 'rabbit_v0.1.0', 'storage', 's3Provider.js'))
    expect(s3).not.toContain('putResumable')
    expect(s3).not.toMatch(/from\s+['"]tus-js-client['"]/)
    expect(s3).not.toMatch(/\btus\./)
  })
})
