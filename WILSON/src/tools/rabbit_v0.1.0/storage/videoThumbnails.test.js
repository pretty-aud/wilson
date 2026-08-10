// =============================================================================
// videoThumbnails.test.js — Session 40.
//
// Same two halves as thumbnails.test.js, for the same reason:
//
//   1. The pure logic (which frame, which types, the best-effort contract).
//   2. 🚨 WIRING. NINE features have shipped in this project complete and with
//      NO CALLER. A green test over generateVideoThumbnail() proves nothing
//      about whether an upload, a route or a player ever reaches it.
//
// ⚠️ NEGATIVE ASSERTIONS RUN OVER COMMENT-STRIPPED SOURCE. S37's review
// reproduced the 0038 trap twice: a `not.toContain` matched the COMMENT
// explaining why a form is wrong, so the test passed while the defect stood.
// Assert the EXECUTABLE form, always.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  SEEK_FRACTION, SEEK_MIN_SEC, SEEK_MAX_SEC,
  seekTimestampFor,
  canThumbnailVideo,
  isVideoExtension,
  isProbablyProfessionalCodec,
  looksLikeVideoFile,
  VIDEO_EXTENSIONS,
  VIDEO_DECODE_TIMEOUT_MS,
  generateVideoThumbnail,
  generateVideoThumbnailFromFile,
} from './videoThumbnails.js'
import { canThumbnail, generateThumbnail, THUMBNAIL_MAX_BYTES } from './thumbnails.js'
import {
  classifyUpload, noticeAfterUpload, summarizeBatch,
  uploadCapFor, PETAL_MAX_UPLOAD_BYTES, S3_MAX_SINGLE_PUT_BYTES,
  LARGE_FILE_WARN_BYTES,
} from './uploadNotices.js'
import { WORKSPACE_PROVIDERS } from './index.js'
import { ensureManagedVideoThumbnail, blobToBase64 } from './managedVideoThumbnail.js'

const REPO = process.cwd()
const ROOT = join(REPO, 'src', 'tools', 'rabbit_v0.1.0')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf-8')
const readRepo = (...p) => readFileSync(join(REPO, ...p), 'utf-8')

// One alternating pass, block alternative first — see thumbnails.test.js for
// the measured reason a separate block pass silently eats 40 lines of code.
const executable = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

// ── A fake <video> that records the ORDER properties are set in ─────────────
function fakeVideo({ width = 1920, height = 1080, duration = 100, fail = null } = {}) {
  const listeners = {}
  const order = []
  const emit = (name) => (listeners[name] || []).slice().forEach(fn => fn())
  const v = {
    videoWidth: width,
    videoHeight: height,
    duration,
    order,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn) },
    removeEventListener(name, fn) {
      listeners[name] = (listeners[name] || []).filter(f => f !== fn)
    },
    removeAttribute(n) { order.push(`removeAttribute:${n}`) },
    load() { order.push('load') },
  }
  Object.defineProperty(v, 'crossOrigin', {
    set(val) { order.push('crossOrigin'); v._co = val }, get() { return v._co },
  })
  Object.defineProperty(v, 'src', {
    set(val) {
      order.push('src')
      v._src = val
      queueMicrotask(() => emit(fail === 'load' ? 'error' : 'loadedmetadata'))
    },
    get() { return v._src },
  })
  Object.defineProperty(v, 'currentTime', {
    set(val) {
      v._t = val
      queueMicrotask(() => emit(fail === 'seek' ? 'error' : 'seeked'))
    },
    get() { return v._t ?? 0 },
  })
  return v
}

function fakeCanvasStack({ blobSize = 12_000, fail = null } = {}) {
  const calls = { drawn: null, size: null }
  const makeCanvas = (w, h) => {
    calls.size = { w, h }
    return {
      getContext: () => (fail === 'context' ? null : {
        drawImage: (_el, _x, _y, dw, dh) => { calls.drawn = { dw, dh } },
      }),
      // Records what it was ASKED for, so the encode request itself is
      // assertable — otherwise the "returns a jpeg" test only checks the
      // fake's own hardcoded literal and nothing pins that JPEG (not PNG) at
      // the configured quality was ever requested.
      convertToBlob: async (opts) => {
        calls.encodeRequest = opts
        if (fail === 'taint') throw new Error('SecurityError: tainted canvas')
        return fail === 'encode' ? null : { size: blobSize, type: 'image/jpeg' }
      },
    }
  }
  return { makeCanvas, calls }
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic
// ═══════════════════════════════════════════════════════════════════════════

describe('seekTimestampFor — not frame 0, and always inside [1, 10]', () => {
  it('a short clip takes the floor, not 10% of nothing', () => {
    // A wall of black thumbnails is worse than icons (§5d.1b): video routinely
    // opens on black, a fade-in or a slate.
    expect(seekTimestampFor(3)).toBe(SEEK_MIN_SEC)
    expect(seekTimestampFor(10)).toBe(SEEK_MIN_SEC)
  })

  it('a mid-length clip takes 10% of its duration', () => {
    expect(seekTimestampFor(50)).toBeCloseTo(5)
    expect(seekTimestampFor(80)).toBeCloseTo(8)
  })

  it('a long clip is capped, so a two-hour master still seeks 10s in', () => {
    expect(seekTimestampFor(100)).toBe(SEEK_MAX_SEC)
    expect(seekTimestampFor(7200)).toBe(SEEK_MAX_SEC)
  })

  it('unknown, zero, negative and Infinity all fall to the floor', () => {
    // A live stream reports Infinity; a probe that could not parse reports null.
    for (const d of [null, undefined, 0, -5, NaN, Infinity]) {
      expect(seekTimestampFor(d)).toBe(SEEK_MIN_SEC)
    }
  })

  it('🚨 the three constants are IDENTICAL to electron/ffmpeg.cjs', () => {
    // Unavoidable duplication: that file is CJS in the main process, this is
    // ESM in the renderer. Two decoders that disagree about which frame to take
    // means the same file gets a different thumbnail depending on which one ran
    // — and nobody would ever notice, because both look plausible.
    const cjs = executable(readRepo('electron', 'ffmpeg.cjs'))
    expect(cjs).toMatch(new RegExp(`const SEEK_FRACTION = ${SEEK_FRACTION}\\b`))
    expect(cjs).toMatch(new RegExp(`const SEEK_MIN_SEC = ${SEEK_MIN_SEC}\\b`))
    expect(cjs).toMatch(new RegExp(`const SEEK_MAX_SEC = ${SEEK_MAX_SEC}\\b`))
  })
})

describe('canThumbnailVideo — and the S39 gate it must NOT have replaced', () => {
  it('accepts video mime types, case- and whitespace-insensitively', () => {
    expect(canThumbnailVideo('video/mp4')).toBe(true)
    expect(canThumbnailVideo('  VIDEO/QUICKTIME ')).toBe(true)
  })

  it('refuses images, junk and non-strings without throwing', () => {
    for (const t of ['image/png', 'application/pdf', '', null, undefined, 42, {}]) {
      expect(canThumbnailVideo(t)).toBe(false)
    }
  })

  it('🚨 canThumbnail STILL REFUSES VIDEO — this module exists so it can', () => {
    // The whole reason for a separate entry point. If someone "helpfully"
    // widens canThumbnail, generateThumbnail starts handing a video File to
    // createImageBitmap, which cannot express seek-and-decode — and every
    // video silently gets no thumbnail again.
    expect(canThumbnail('video/quicktime')).toBe(false)
    expect(canThumbnail('video/mp4')).toBe(false)
  })

  it('🚨 generateThumbnail still returns null for video WITHOUT calling a decoder', async () => {
    const createBitmap = vi.fn()
    const out = await generateThumbnail({ type: 'video/quicktime' }, {
      createBitmap,
      makeCanvas: () => { throw new Error('must not be reached') },
    })
    expect(out).toBeNull()
    expect(createBitmap).not.toHaveBeenCalled()
  })
})

describe('the extension sets', () => {
  it('covers browser-native and professional containers alike', () => {
    for (const e of ['.mp4', '.mov', '.webm', '.mxf', '.r3d', '.braw']) {
      expect(isVideoExtension(e)).toBe(true)
    }
    expect(isVideoExtension('.JPG')).toBe(false)
    expect(isVideoExtension('')).toBe(false)
    expect(isVideoExtension(null)).toBe(false)
  })

  it('is case-insensitive — a camera writes .MOV', () => {
    expect(isVideoExtension('.MOV')).toBe(true)
    expect(isProbablyProfessionalCodec('.MXF')).toBe(true)
  })

  it('the professional heuristic flags containers, not every video', () => {
    // Wrong in the harmless direction on purpose: an H.264 .mov gets a notice
    // it did not need, and nothing is blocked either way.
    expect(isProbablyProfessionalCodec('.mov')).toBe(true)
    expect(isProbablyProfessionalCodec('.mp4')).toBe(false)
    expect(isProbablyProfessionalCodec('.webm')).toBe(false)
  })

  it('🚨 the set is IDENTICAL to electron/main.cjs VIDEO_EXTENSIONS', () => {
    // The stream route, the ffmpeg arm and the renderer's gate must agree about
    // what a video IS, or a file gets a play button and a 415, or a thumbnail
    // route that refuses something the UI offered.
    const cjs = executable(readRepo('electron', 'main.cjs'))
    const m = /const VIDEO_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/.exec(cjs)
    expect(m).toBeTruthy()
    const fromMain = new Set(
      [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]),
    )
    expect([...fromMain].sort()).toEqual([...VIDEO_EXTENSIONS].sort())
  })
})

describe('generateVideoThumbnail — best-effort by contract', () => {
  it('seeks, draws at the fitted size, and returns a blob', async () => {
    const video = fakeVideo({ width: 1920, height: 1080, duration: 100 })
    const { makeCanvas, calls } = fakeCanvasStack()
    const blob = await generateVideoThumbnail('blob:x', {
      makeVideo: () => video, makeCanvas,
    })
    expect(blob).toEqual({ size: 12_000, type: 'image/jpeg' })
    expect(calls.drawn).toEqual({ dw: 256, dh: 144 }) // 16:9 fitted to 256
    expect(video.currentTime).toBe(10)                // 10% of 100s, capped
    // 🚨 And it ASKED for a JPEG at the shared quality. Without this the only
    // "it's a jpeg" evidence is the fake's own return literal, so switching the
    // encoder to PNG — which the 256 KB bucket cap would then start rejecting —
    // would not fail a single test.
    expect(calls.encodeRequest).toEqual({ type: 'image/jpeg', quality: 0.8 })
  })

  it('🚨 TIMES OUT rather than hanging when the stream never responds', async () => {
    // A <video> pointed at a stalled NAS emits neither 'loadedmetadata' nor
    // 'error'. Nothing else in this file exercises that bound — every other
    // fake resolves synchronously — so the one guard that stops a dead share
    // freezing a batch of thirty clips was entirely unasserted.
    const silent = {
      videoWidth: 1920, videoHeight: 1080, duration: 100,
      addEventListener() {}, removeEventListener() {},
      removeAttribute() {}, load() {},
    }
    Object.defineProperty(silent, 'crossOrigin', { set() {}, get() { return null } })
    Object.defineProperty(silent, 'src', { set() {}, get() { return null } })
    const { makeCanvas } = fakeCanvasStack()
    const started = Date.now()
    const out = await generateVideoThumbnail('http://stalled/x.mp4', {
      makeVideo: () => silent, makeCanvas, timeoutMs: 40,
    })
    expect(out).toBeNull()
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('the default timeout is a real number the module exports', () => {
    expect(VIDEO_DECODE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('🚨 SETS crossOrigin BEFORE src — after it, the attribute does not apply', async () => {
    // This is the whole tainted-canvas guard. Set afterwards it does not apply
    // to a load already in flight, toBlob throws SecurityError, and the
    // best-effort contract swallows it as null: EVERY video silently gets no
    // thumbnail, with nothing in any log.
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack()
    await generateVideoThumbnail('https://bucket.example/x.mp4', {
      makeVideo: () => video, makeCanvas,
    })
    expect(video.order.indexOf('crossOrigin')).toBeGreaterThanOrEqual(0)
    expect(video.order.indexOf('crossOrigin')).toBeLessThan(video.order.indexOf('src'))
    expect(video.crossOrigin).toBe('anonymous')
  })

  it('🚨 RETURNS null AND DOES NOT THROW when the codec cannot be decoded', async () => {
    // ProRes in Chromium. The source body has already landed when this runs, so
    // a failed preview must cost a preview and never the file.
    const video = fakeVideo({ fail: 'load' })
    const { makeCanvas } = fakeCanvasStack()
    await expect(generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('returns null when the seek fails rather than hanging', async () => {
    const video = fakeVideo({ fail: 'seek' })
    const { makeCanvas } = fakeCanvasStack()
    await expect(generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('🚨 a TAINTED canvas is caught, not propagated', async () => {
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack({ fail: 'taint' })
    await expect(generateVideoThumbnail('https://x/y.mp4', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('returns null for a 0x0 track — an audio file in a video container', async () => {
    const video = fakeVideo({ width: 0, height: 0 })
    const { makeCanvas } = fakeCanvasStack()
    await expect(generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('returns null when no 2d context is available', async () => {
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack({ fail: 'context' })
    await expect(generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('refuses a result over the bucket cap rather than letting Storage reject it', async () => {
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack({ blobSize: THUMBNAIL_MAX_BYTES + 1 })
    await expect(generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas }))
      .resolves.toBeNull()
  })

  it('accepts a result exactly at the cap (boundary, not off-by-one)', async () => {
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack({ blobSize: THUMBNAIL_MAX_BYTES })
    const blob = await generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas })
    expect(blob?.size).toBe(THUMBNAIL_MAX_BYTES)
  })

  it('releases the element even on the happy path', async () => {
    // An Electron renderer keeps the decode pipeline alive without the load();
    // a batch of thirty clips holds thirty of them.
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack()
    await generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas })
    expect(video.order).toContain('removeAttribute:src')
    expect(video.order).toContain('load')
  })

  it('a clip shorter than the seek floor is clamped inside its own duration', async () => {
    // Seeking past the end never fires 'seeked' on some engines, so a 0.4s clip
    // would hang for the whole timeout.
    const video = fakeVideo({ duration: 0.4 })
    const { makeCanvas } = fakeCanvasStack()
    await generateVideoThumbnail('blob:x', { makeVideo: () => video, makeCanvas })
    expect(video.currentTime).toBeLessThan(0.4)
    expect(video.currentTime).toBeGreaterThanOrEqual(0)
  })

  it('refuses a non-string source without constructing anything', async () => {
    const makeVideo = vi.fn()
    expect(await generateVideoThumbnail(null, { makeVideo })).toBeNull()
    expect(makeVideo).not.toHaveBeenCalled()
  })
})

describe('generateVideoThumbnailFromFile — the object URL is always released', () => {
  it('creates and revokes the URL around the decode', async () => {
    const revoked = []
    const video = fakeVideo()
    const { makeCanvas } = fakeCanvasStack()
    const blob = await generateVideoThumbnailFromFile({ type: 'video/mp4' }, {
      makeObjectUrl: () => 'blob:generated',
      revokeObjectUrl: (u) => revoked.push(u),
      makeVideo: () => video, makeCanvas,
    })
    expect(blob).toBeTruthy()
    expect(revoked).toEqual(['blob:generated'])
  })

  it('🚨 revokes even when the decode FAILS — the leak would be per upload', async () => {
    const revoked = []
    const video = fakeVideo({ fail: 'load' })
    const { makeCanvas } = fakeCanvasStack()
    await generateVideoThumbnailFromFile({ type: 'video/mp4' }, {
      makeObjectUrl: () => 'blob:generated',
      revokeObjectUrl: (u) => revoked.push(u),
      makeVideo: () => video, makeCanvas,
    })
    expect(revoked).toEqual(['blob:generated'])
  })

  it('refuses a non-video file without minting a URL at all', async () => {
    const makeObjectUrl = vi.fn()
    expect(await generateVideoThumbnailFromFile({ type: 'image/png' }, { makeObjectUrl })).toBeNull()
    expect(makeObjectUrl).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §5f — the notices. The cap is PROVIDER-DEPENDENT and video makes it bite.
// ═══════════════════════════════════════════════════════════════════════════

describe('uploadNotices — provider-keyed, and only one case blocks', () => {
  const big = (mb, name = 'clip.mp4') => ({ name, size: mb * 1024 * 1024 })

  it('the caps mirror the layers that actually enforce them', () => {
    expect(uploadCapFor(WORKSPACE_PROVIDERS.PETAL)).toBe(PETAL_MAX_UPLOAD_BYTES)
    expect(uploadCapFor(WORKSPACE_PROVIDERS.S3)).toBe(S3_MAX_SINGLE_PUT_BYTES)
    // A cloud-mode `network` workspace has NO browser upload path at all —
    // uploadFile refuses it with its own sentence — so a size-shaped message
    // would describe a problem that is not about size.
    expect(uploadCapFor(WORKSPACE_PROVIDERS.NETWORK)).toBeNull()
  })

  // 🚨 THIS TEST USED TO NAME 0027, AND SESSION 42 IS WHY THAT WAS WRONG.
  // 0027 set the cap to 50 MiB; 0057 raised it to 50 GiB. A guard pinned to a
  // migration BY NAME goes stale the moment a later migration re-sets the same
  // value — and the tempting repair (repoint it at 0057) buys exactly one
  // session before the next raise breaks it silently, this time passing
  // vacuously against a file nobody edits any more.
  //
  // So: find EVERY migration that assigns rabbit-files' file_size_limit, take
  // the LAST one in filename order — which is the one that wins on a fresh
  // database, because migrations replay in that order — and assert the constant
  // matches THAT. Comments are stripped first, because a migration that
  // documents the old number in prose (0057 does, twice) would otherwise satisfy
  // a naive `toContain` — the 0038 trap that has now caught this repo three
  // times.
  it('🚨 mirrors the LAST migration that sets rabbit-files file_size_limit', () => {
    const dir = join(REPO, 'supabase', 'migrations')
    const hits = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(f => ({ file: f, sql: executable(readFileSync(join(dir, f), 'utf-8')) }))
      .filter(({ sql }) => /rabbit-files/.test(sql) && /file_size_limit/.test(sql))

    expect(hits.length).toBeGreaterThan(0)

    const last = hits[hits.length - 1]
    // The assigned value, not merely a number appearing somewhere in the file.
    const assigned = [...last.sql.matchAll(/file_size_limit\s*=\s*(\d+)/g)].map(m => m[1])
      .concat([...last.sql.matchAll(/VALUES\s*\([^)]*?,\s*(\d{4,})\s*\)/g)].map(m => m[1]))
    expect(assigned.length).toBeGreaterThan(0)
    expect(assigned).toContain(String(PETAL_MAX_UPLOAD_BYTES))
  })

  // ...and the constant is the 50 GiB Audrey chose, stated once so a typo in the
  // migration and a matching typo here cannot agree with each other.
  it('🚨 the Petal cap is 50 GiB exactly', () => {
    expect(PETAL_MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024 * 1024)
  })

  // Session 42: 80 MB used to be the over-cap case. It is now an ordinary
  // upload, which is the entire point of the session — so the fixture moves to
  // 51 GiB rather than the assertion being softened.
  it('blocks an over-cap file on petal — the one real stop', () => {
    const v = classifyUpload(big(51 * 1024), { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(true)
    expect(v.code).toBe('too_large')
    expect(v.message).toMatch(/desktop app/)
  })

  it('🚨 an 80 MB file is now ORDINARY on petal — the S42 headline', () => {
    // The regression that would matter most: a cap silently reverting to 50 MiB
    // (a re-run of 0027 does exactly that) makes multi-GB cloud storage vanish
    // while every other test here stays green.
    const v = classifyUpload(big(80), { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(false)
    expect(v.code).toBeNull()
  })

  it('a multi-GB file is accepted on petal — Audrey’s actual requirement', () => {
    // "im going to have multiple GB files at times" (2026-08-05).
    const v = classifyUpload(big(8 * 1024), { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(false)
  })

  it('🚨 DOES NOT BLOCK THE SAME FILE ON s3 — a blanket cap is a FALSE REFUSAL', () => {
    // The exact defect the S37 correction names: telling a customer who is
    // already paying for their own storage to install software for an upload
    // their browser can complete.
    const v = classifyUpload(big(200), { workspaceProvider: WORKSPACE_PROVIDERS.S3 })
    expect(v.blocked).toBe(false)
  })

  // Session 42: the slow band is min(cap / 2, LARGE_FILE_WARN_BYTES). At a
  // 50 MiB cap that was 25 MB, so 30 MB tripped it. At 50 GiB the cap half is
  // 25 GiB and the fixed 100 MB now binds — so the fixture moves to 200 MB.
  it('a large-but-legal file gets a note and is NOT blocked', () => {
    const v = classifyUpload(big(200), { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(false)
    expect(v.notes.map(n => n.code)).toContain('slow')
  })

  // ── Session 41: the Petal-cloud plan arms ────────────────────────────────
  // These EXECUTE the predicate. The wiring pin in workspaceRootWiring.test.js
  // only greps for the string literals `over_quota` / `storage_suspended`,
  // which survive an INVERTED comparison untouched — so without these five the
  // arms had no behavioural coverage at all (found by this session's review).
  const GIB = 1024 ** 3
  const plan = (used, quota = GIB, status = 'active') =>
    ({ usedBytes: used, quotaBytes: quota, status })

  it('a suspended plan blocks, whatever the usage', () => {
    const v = classifyUpload(big(2), {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(0, GIB, 'suspended'),
    })
    expect(v.blocked).toBe(true)
    expect(v.code).toBe('storage_suspended')
  })

  // 🚨 THE BOUNDARY THE SOURCE COMMENT CLAIMS MIRRORS THE SERVER.
  // rabbit_petal_storage_ok is `used < quota`, so AT the ceiling the next
  // upload is already refused. Written as `used > quota` this case silently
  // passes and the client waves through an upload the server will reject.
  it('used === quota blocks — the server predicate is strict `<`', () => {
    const v = classifyUpload(big(1), {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB),
    })
    expect(v.blocked).toBe(true)
    expect(v.code).toBe('over_quota')
  })

  // 🚨 THIS TEST IS DELIBERATELY INVERTED FROM S41, NOT PATCHED.
  //
  // It used to read "just under the ceiling does NOT block, even for a file that
  // will cross it", and it was correct: S41's server predicate was `used <
  // quota`, so blocking here would have been a false refusal. Migration 0057
  // changed the server to `used + incoming <= quota`, so the false refusal now
  // runs the other way — waving this through would hand the user the raw RLS
  // error that classifyUpload exists to replace.
  //
  // The old assertion is kept in the name so a future reader can see the
  // reversal happened on purpose rather than wonder which session got it wrong.
  it('S42: a file that would CROSS the ceiling blocks — the server now weighs it', () => {
    const v = classifyUpload(big(30), {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB - 1024),
    })
    expect(v.blocked).toBe(true)
    expect(v.code).toBe('over_quota')
  })

  // ...and the boundary is `<=`, not `<`: landing EXACTLY on the ceiling is
  // legal, because used + incoming is the total after the write.
  it('S42: a file that lands exactly ON the ceiling is allowed', () => {
    const v = classifyUpload({ name: 'exact.mp4', size: 1024 }, {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB - 1024),
    })
    expect(v.blocked).toBe(false)
  })

  // 🚨 TWO FACTS, TWO SENTENCES. A full workspace and a file that will not fit
  // have different remedies, and only one of them is "add a smaller file".
  it('S42: the doesn’t-fit message NAMES its file; the full message does not', () => {
    const wontFit = classifyUpload({ name: 'dailies.mov', size: 900 * 1024 * 1024 }, {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB / 2),
    })
    expect(wontFit.blocked).toBe(true)
    expect(wontFit.message).toMatch(/dailies\.mov/)
    expect(wontFit.message).toMatch(/smaller file/)

    // Full: no filename, so FileManager's dedup collapses a 30-clip batch to one
    // line instead of repeating the same sentence thirty times.
    const full = classifyUpload({ name: 'dailies.mov', size: 1024 }, {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB),
    })
    expect(full.blocked).toBe(true)
    expect(full.message).not.toMatch(/dailies\.mov/)
  })

  it('🚨 an s3 workspace is never quota-blocked — its bodies never touch Petal', () => {
    const v = classifyUpload(big(2), {
      workspaceProvider: WORKSPACE_PROVIDERS.S3, storagePlan: plan(GIB, GIB, 'suspended'),
    })
    expect(v.blocked).toBe(false)
  })

  it('a null plan invents no refusal — a failed read must not block', () => {
    const v = classifyUpload(big(2), {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: null,
    })
    expect(v.blocked).toBe(false)
  })

  it('the over-quota sentence does NOT tell anyone to delete files', () => {
    // A cloud delete is soft and storage-gc holds a trashed row for 30 days, so
    // "remove some files" is a remedy that cannot work. Asserting the EXECUTABLE
    // message rather than a comment about it (the 0038 trap).
    const v = classifyUpload(big(1), {
      workspaceProvider: WORKSPACE_PROVIDERS.PETAL, storagePlan: plan(GIB),
    })
    expect(v.message).not.toMatch(/remove some files/i)
    expect(v.message).toMatch(/30 days/)
  })

  // ⚠️ SESSION 42 QUIETLY KILLED THIS TEST'S RATIONALE, AND IT STAYED GREEN.
  // The band is min(cap / 2, LARGE_FILE_WARN_BYTES). While Petal's cap was
  // 50 MiB the halves differed (25 MB vs 2.5 GB) and the band really was
  // provider-scaled. Now both caps exceed 200 MB, so BOTH collapse to the fixed
  // 100 MB and the scaling no longer distinguishes anything — a passing test
  // whose stated reason had become false, found by asking what the cap change
  // broke rather than what it fixed.
  //
  // Kept, renamed, and turned into an assertion of what is now true: the band is
  // the fixed figure on both providers, and cap/2 is what would take over again
  // if any provider's ceiling ever dropped below 200 MB.
  it('the slow band is the fixed 100 MB on both providers now (was provider-scaled)', () => {
    for (const p of [WORKSPACE_PROVIDERS.PETAL, WORKSPACE_PROVIDERS.S3]) {
      expect(classifyUpload(big(99), { workspaceProvider: p })
        .notes.map(n => n.code)).not.toContain('slow')
      expect(classifyUpload(big(400), { workspaceProvider: p })
        .notes.map(n => n.code)).toContain('slow')
    }
    // The cap/2 arm is still live — it just no longer binds at these ceilings.
    expect(LARGE_FILE_WARN_BYTES).toBeLessThan(PETAL_MAX_UPLOAD_BYTES / 2)
    expect(LARGE_FILE_WARN_BYTES).toBeLessThan(S3_MAX_SINGLE_PUT_BYTES / 2)
  })

  it('a professional container gets the pre-upload courtesy note, unblocked', () => {
    const v = classifyUpload({ name: 'A001_C003.mxf', size: 10 * 1024 * 1024 },
      { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(false)
    expect(v.notes.map(n => n.code)).toContain('maybe_no_preview')
  })

  it('an ordinary mp4 gets no notes at all', () => {
    const v = classifyUpload(big(2), { workspaceProvider: WORKSPACE_PROVIDERS.PETAL })
    expect(v.blocked).toBe(false)
    expect(v.notes).toEqual([])
  })
})

describe('noticeAfterUpload — accurate by construction', () => {
  it('says nothing when a video DID get a preview', () => {
    expect(noticeAfterUpload({
      name: 'a.mp4', mime_type: 'video/mp4', thumbnail_url: 'projects/p/a/1/x.mp4.jpg',
    })).toBeNull()
  })

  it('flags a video that came back with no preview — the decoder already answered', () => {
    const n = noticeAfterUpload({ name: 'a.mov', mime_type: 'video/quicktime', thumbnail_url: null })
    expect(n?.code).toBe('no_preview')
  })

  it('says nothing about a document, which was never going to have one', () => {
    expect(noticeAfterUpload({ name: 'a.pdf', mime_type: 'application/pdf', thumbnail_url: null }))
      .toBeNull()
  })

  it('falls back to the FILENAME when mime_type is missing', () => {
    expect(noticeAfterUpload({ name: 'a.mov', mime_type: null, thumbnail_url: null })?.code)
      .toBe('no_preview')
  })

  it('🚨 DROPS the "add it from the desktop app" pointer when that is measurably false', () => {
    // Sending someone to install an app whose decoder is absent is worse than
    // saying nothing. `null` means unknown (the web cannot ask) and keeps the
    // pointer, because shipping that decoder is the plan.
    const withDecoder = noticeAfterUpload({ name: 'a.mov', thumbnail_url: null }, { desktopDecoder: null })
    const without = noticeAfterUpload({ name: 'a.mov', thumbnail_url: null }, { desktopDecoder: false })
    expect(withDecoder.message).toMatch(/desktop app/)
    expect(without.message).not.toMatch(/desktop app/)
  })
})

describe('summarizeBatch — ONE line for thirty clips', () => {
  it('counts rather than lists', () => {
    const line = summarizeBatch([
      { code: 'no_preview' }, { code: 'no_preview' }, { code: 'no_preview' },
    ])
    expect(line).toMatch(/^3 files/)
  })

  it('is singular for one', () => {
    expect(summarizeBatch([{ code: 'no_preview' }])).toMatch(/^1 file /)
  })

  it('combines both kinds in one sentence', () => {
    const line = summarizeBatch([{ code: 'no_preview' }, { code: 'slow' }])
    expect(line).toMatch(/preview image/)
    expect(line).toMatch(/slow/)
  })

  it('returns null when there is nothing worth saying', () => {
    expect(summarizeBatch([])).toBeNull()
    expect(summarizeBatch(null)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// The desktop managed path
// ═══════════════════════════════════════════════════════════════════════════

describe('ensureManagedVideoThumbnail — server first, renderer as the fallback', () => {
  const args = { projectId: 'p1', fileId: 'f1', extension: '.mov' }

  it('🚨 asks the SERVER first and does not stream a 5 GB file to lose the race', async () => {
    const generate = vi.fn()
    const fetchImpl = vi.fn(async () => ({ ok: true }))
    const out = await ensureManagedVideoThumbnail({ ...args, fetchImpl, generate })
    expect(out).toEqual({ ok: true, via: 'ffmpeg', reason: null })
    expect(generate).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0][1].method).toBe('HEAD')
  })

  it('falls back to the renderer when ffmpeg is absent, and POSTs the frame', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push(init.method)
      return init.method === 'HEAD' ? { ok: false, status: 415 } : { ok: true }
    })
    const out = await ensureManagedVideoThumbnail({
      ...args, fetchImpl,
      generate: async () => ({ size: 100 }),
      toBase64: async () => 'AAAA',
    })
    expect(out).toEqual({ ok: true, via: 'renderer', reason: null })
    expect(calls).toEqual(['HEAD', 'POST'])
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ base64: 'AAAA' })
  })

  it('🚨 CHECKS res.ok ON THE POST — fetch resolves for every status', async () => {
    // The otterFetch trap in its S40 form. An unchecked await turns a refused
    // write into a reported success, which is what cost the Validator every fix
    // Audrey ever accepted.
    const fetchImpl = async (_u, init) =>
      (init.method === 'HEAD' ? { ok: false, status: 415 } : { ok: false, status: 413 })
    const out = await ensureManagedVideoThumbnail({
      ...args, fetchImpl,
      generate: async () => ({ size: 100 }),
      toBase64: async () => 'AAAA',
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('post_413')
  })

  it('reports undecodable without POSTing anything', async () => {
    const fetchImpl = vi.fn(async (_u, init) =>
      (init.method === 'HEAD' ? { ok: false, status: 415 } : { ok: true }))
    const out = await ensureManagedVideoThumbnail({
      ...args, fetchImpl, generate: async () => null,
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('undecodable')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a thrown HEAD (server down) still falls through instead of failing the whole thing', async () => {
    let n = 0
    const fetchImpl = async (_u, init) => {
      n += 1
      if (init.method === 'HEAD') throw new Error('ECONNREFUSED')
      return { ok: true }
    }
    const out = await ensureManagedVideoThumbnail({
      ...args, fetchImpl,
      generate: async () => ({ size: 10 }),
      toBase64: async () => 'AAAA',
    })
    expect(out.ok).toBe(true)
    expect(n).toBe(2)
  })

  it('refuses a non-video extension before touching the network', async () => {
    const fetchImpl = vi.fn()
    const out = await ensureManagedVideoThumbnail({ ...args, extension: '.png', fetchImpl })
    expect(out.reason).toBe('not_video')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('blobToBase64', () => {
  it('🚨 CHUNKS, and ROUND-TRIPS — identical bytes would hide the real bug', async () => {
    // Two failure shapes, and the obvious test catches neither:
    //   * String.fromCharCode(...bytes) puts a quarter of a million arguments
    //     on the stack and throws only at full size;
    //   * base64-encoding each chunk SEPARATELY and concatenating produces
    //     padding in the middle — corrupt output of exactly the right length.
    // A buffer of 262,144 identical bytes cannot distinguish either from a
    // correct result, so the payload varies and the assertion decodes it back.
    const bytes = new Uint8Array(262_144)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) & 0xff
    const blob = { arrayBuffer: async () => bytes.buffer }
    const out = await blobToBase64(blob)
    expect(typeof out).toBe('string')
    expect(out).not.toMatch(/=[A-Za-z0-9+/]/)   // no padding except at the end
    const round = Buffer.from(out, 'base64')
    expect(round.length).toBe(bytes.length)
    expect(Buffer.compare(round, Buffer.from(bytes))).toBe(0)
  })

  it('handles a chunk-boundary length exactly (0x8000 is the chunk size)', async () => {
    const bytes = new Uint8Array(0x8000 * 2)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i & 0xff
    const out = await blobToBase64({ arrayBuffer: async () => bytes.buffer })
    expect(Buffer.compare(Buffer.from(out, 'base64'), Buffer.from(bytes))).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WIRING — the half that catches a feature with no caller
// ═══════════════════════════════════════════════════════════════════════════

describe('wiring: the ffmpeg module obeys the two rules that cost a session', () => {
  const cjs = executable(readRepo('electron', 'ffmpeg.cjs'))

  it('🚨 -ss comes BEFORE -i, asserted on the ARGUMENT ARRAY not on a comment', async () => {
    // Input seeking jumps to the timestamp; output seeking decodes from frame
    // zero. On a 5 GB ProRes file over a NAS share that is the difference
    // between a second and several minutes.
    const { buildArgs } = await import('../../../../electron/ffmpeg.cjs')
    const args = buildArgs({ input: 'in.mov', output: 'out.jpg', maxEdge: 256, quality: 4, seconds: 3 })
    expect(args.indexOf('-ss')).toBeGreaterThanOrEqual(0)
    expect(args.indexOf('-i')).toBeGreaterThanOrEqual(0)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    // And the value rides in its own slot, never concatenated into one.
    expect(args[args.indexOf('-ss') + 1]).toBe('3')
    expect(args[args.indexOf('-i') + 1]).toBe('in.mov')
  })

  it('🚨 execFile with an ARGUMENT ARRAY and shell:false — never a command string', async () => {
    // Filenames from a NAS are outside WILSON's control and may contain shell
    // metacharacters. This is the repo's standing "never build a shell command
    // by interpolating content" rule, and ffmpeg is the case it exists for.
    // ⚠️ STRENGTHENED after the review pointed out that all five original
    // assertions survived a mutated file that shelled out with an interpolated
    // filename. The negatives matched forms no realistic regression takes, and
    // `shell: false` matched a const declaration nothing tied to the call.
    //
    // What is asserted now: exactly ONE process is spawned in this module, it
    // is execFile, its second argument is the args ARRAY, and the options
    // object it receives spreads NEVER_A_SHELL — so deleting `shell: false`,
    // switching to exec/spawn-with-a-string, or passing a built command all
    // fail.
    expect(cjs).toMatch(/execFile\(\s*\n?\s*bin,\s*\n?\s*args,\s*\n?\s*\{ \.\.\.NEVER_A_SHELL,/)
    expect(cjs).toMatch(/const NEVER_A_SHELL = \{ shell: false \};/)
    // Only child_process.execFile is imported at all.
    expect(cjs).toMatch(/const \{ execFile \} = require\('child_process'\);/)
    expect(cjs).not.toMatch(/\bexecSync\b/)
    expect(cjs).not.toMatch(/\bspawnSync\b/)
    expect(cjs).not.toMatch(/\bspawn\(/)
    // And child_process.exec is never called. The lookbehind excludes a
    // preceding letter so `execFile(` cannot satisfy it, AND a preceding dot
    // so `DURATION_RE.exec(stderr)` — RegExp's exec, nothing to do with a
    // shell — is not mistaken for one. That false positive is exactly the
    // shape this whole test file warns about: a negative assertion matching
    // something innocent and reading as a defect.
    expect(cjs).not.toMatch(/(?<![A-Za-z.])exec\(/)
    // No interpolation of the caller's input into anything command-shaped.
    expect(cjs).not.toMatch(/`[^`]*\$\{input\}[^`]*`/)
  })

  it('a timeout is set and kills hard — ffmpeg traps SIGTERM to finish its file', () => {
    expect(cjs).toMatch(/killSignal:\s*'SIGKILL'/)
    // ⚠️ NOT `toMatch(/timeout/)`. That could not fail: lowercase "timeout"
    // appears in a parameter name and two string literals even after comment
    // stripping, so DELETING the execFile timeout option left it green. Assert
    // the option actually reaching execFile.
    expect(cjs).toMatch(/\{ \.\.\.NEVER_A_SHELL, timeout, killSignal: 'SIGKILL', maxBuffer/)
  })

  it('🚨 the missing binary is a NAMED state, and resolution demands a real FILE', async () => {
    const mod = await import('../../../../electron/ffmpeg.cjs')
    // ⚠️ MACHINE-INDEPENDENT ON PURPOSE. This used to assert
    // `hasFfmpeg() === false`, i.e. the live state of whoever ran it — so
    // following resources/ffmpeg/README.md's documented install turned the
    // suite red AND made the unit run spawn real ffmpeg subprocesses. A test
    // that forbids the feature being installed is worse than no test.
    const prev = process.env.WILSON_FFMPEG_PATH
    try {
      // A DIRECTORY is not a binary — and the override is not exempt from
      // that rule, though it once was.
      const dir = join(REPO, 'resources', 'ffmpeg')
      process.env.WILSON_FFMPEG_PATH = dir
      expect(mod.resolveFfmpegPath()).not.toBe(dir)
      // A real file is accepted, whatever this machine has installed.
      const realFile = join(REPO, 'package.json')
      process.env.WILSON_FFMPEG_PATH = realFile
      expect(mod.resolveFfmpegPath()).toBe(realFile)
      expect(mod.hasFfmpeg()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.WILSON_FFMPEG_PATH
      else process.env.WILSON_FFMPEG_PATH = prev
    }
  })

  it('🚨 extractFrame short-circuits on a missing binary rather than spawning', () => {
    // Asserted on source rather than by calling it: calling it on a machine
    // that HAS ffmpeg would spawn a real process from a unit test.
    expect(cjs).toMatch(/if \(!hasFfmpeg\(\)\) return \{ ok: false, reason: 'ffmpeg_missing' \};/)
  })
})

describe('wiring: packaging goes to the packager that actually ships', () => {
  const pkg = JSON.parse(readRepo('package.json'))

  it('🚨 electron-BUILDER carries the binary — `npm run dist` is what users get', () => {
    // forge.config.cjs drives `npm run package`/`make` and does NOT ship. Its
    // packagerConfig.extraResource does nothing for the nsis installer, and the
    // two packagers have OPPOSITE asar defaults — so implementing this in the
    // wrong file "verifies" under forge while the shipped app has no binary.
    expect(pkg.scripts.dist).toContain('electron-builder')
    const extra = pkg.build?.extraResources || []
    expect(extra.some(e => e.from === 'resources/ffmpeg' && e.to === 'ffmpeg')).toBe(true)
  })

  it('forge is NOT where this was put', () => {
    const forge = executable(readRepo('forge.config.cjs'))
    expect(forge).not.toMatch(/extraResource/)
  })

  it('the staged folder exists and is committed, so the glob always resolves', () => {
    expect(readRepo('resources', 'ffmpeg', 'README.md')).toMatch(/LGPL/)
    // 🚨 And the binary itself is excluded — pretty-aud/wilson is PUBLIC and
    // `git add -A` sweeps untracked files into it.
    const ignore = readRepo('resources', 'ffmpeg', '.gitignore')
    expect(ignore).toMatch(/^ffmpeg\.exe$/m)
    expect(ignore).toMatch(/^ffmpeg$/m)
  })

  it('the runtime resolves through process.resourcesPath, not a dev-only path', () => {
    const cjs = executable(readRepo('electron', 'ffmpeg.cjs'))
    expect(cjs).toMatch(/process\.resourcesPath/)
    expect(cjs).toMatch(/WILSON_FFMPEG_PATH/)
  })
})

describe('wiring: the Express routes exist and stream correctly', () => {
  const main = executable(readRepo('electron', 'main.cjs'))

  it('there IS a stream route now — there was none before this session', () => {
    expect(main).toMatch(/managed-files\/:id\/stream/)
  })

  it('🚨 it uses res.sendFile, which gives Range for free', () => {
    // A hand-rolled createReadStream does NOT support Range unless it is
    // implemented explicitly, and without Range a <video> cannot seek and the
    // browser pulls the whole file first. On a 5 GB master that is a hang.
    const route = sliceRoute(main, 'managed-files/:id/stream')
    expect(route).toMatch(/res\.sendFile\(diskPath/)
    expect(route).not.toMatch(/createReadStream/)
  })

  it('🚨 AS-2.9: the read is logged, with touch:false, and THROTTLED', () => {
    const route = sliceRoute(main, 'managed-files/:id/stream')
    expect(route).toMatch(/event:\s*'downloaded'/)
    expect(route).toMatch(/touch: false/)
    // A <video> issues one request per seek and per buffer refill, and
    // rabbitLogFileEvent evicts the oldest non-purged entries at 2000 — so an
    // unthrottled log would DELETE a project's real upload history to make room
    // for noise about one clip.
    expect(route).toMatch(/shouldLogManagedRead\(mf\.id\)/)
    expect(main).toMatch(/MANAGED_READ_LOG_WINDOW_MS/)
  })

  it('🚨 it resolves through resolveContainedFilePath, not a second path builder', () => {
    expect(main).toMatch(/function resolveManagedFileDiskPath/)
    const resolver = sliceRoute(main, 'function resolveManagedFileDiskPath')
    expect(resolver).toMatch(/resolveContainedFilePath\(root,/)
  })

  it('the resolver reads the record OWN folder_path, so SCENES/ and SHOTS/ resolve', () => {
    // The thumbnail route used to recompute `ASSETS/{assetSlug}`
    // unconditionally, so a scene- or shot-attached managed file 410'd while
    // sitting perfectly well on disk. The video arm would have inherited it.
    const resolver = sliceRoute(main, 'function resolveManagedFileDiskPath')
    expect(resolver).toMatch(/mf\.folder_path/)
  })

  it('the thumbnail route grew a video arm that names ffmpeg_missing', () => {
    expect(main).toMatch(/code:\s*'ffmpeg_missing'/)
    expect(main).toMatch(/generateVideoThumbOnce\(srcPath, thumbPath\)/)
  })

  it('🚨 a FAILED ffmpeg run unlinks its partial output', () => {
    // Every caller serves thumbPath straight back when it EXISTS, so a
    // truncated JPEG left behind is served, cached and never regenerated.
    const fn = sliceRoute(main, 'function generateVideoThumbOnce')
    expect(fn).toMatch(/if \(!out\.ok\)/)
    expect(fn).toMatch(/unlinkSync\(thumbPath\)/)
  })

  it('🚨 the POST arm verifies JPEG magic bytes before writing to disk', () => {
    // Without it this is a "write arbitrary content to a path ending .jpg"
    // primitive on an unauthenticated loopback server, and the GET would then
    // serve it back with an image Content-Type.
    // ⚠️ SLICED AND ORDERED. Both assertions used to be whole-file matches
    // with no ordering, so the property in the title — "before writing to
    // disk" — was the one thing not tested.
    const post = sliceBetween(main,
      "expressApp.post('/api/rabbit/projects/:projectId/managed-files/:id/thumbnail'",
      "expressApp.get('/api/rabbit/video-support'")
    expect(post).toBeTruthy()
    const magic = post.indexOf('0xff && buf[1] === 0xd8 && buf[2] === 0xff')
    const cap = post.indexOf('buf.length > 262144')
    const write = post.indexOf('fs.writeFileSync(thumbPath, buf)')
    expect(magic).toBeGreaterThan(-1)
    expect(cap).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(-1)
    expect(magic).toBeLessThan(write)
    expect(cap).toBeLessThan(write)
  })

  it('the capability probe exists for the notice to be honest about', () => {
    expect(main).toMatch(/\/api\/rabbit\/video-support/)
  })
})

describe('wiring: generation and playback reach the screen', () => {
  const adapter = executable(read('adapters', 'supabaseAdapter.js'))
  const manager = executable(read('components', 'FileManager.jsx'))
  const thumb = executable(read('components', 'FileThumbnail.jsx'))
  const provider = executable(read('state', 'RabbitProvider.jsx'))

  it('the upload path branches to the VIDEO decoder', () => {
    // Repointed, not deleted: the gate is now looksLikeVideoFile rather than
    // canThumbnailVideo(file.type), because File.type is '' for .mov/.mkv/.avi
    // on a machine whose OS MIME registry lacks them. See the dedicated test.
    expect(adapter).toMatch(/looksLikeVideoFile\(file\)/)
    expect(adapter).not.toMatch(/canThumbnailVideo\(file\?\.type\)/)
    expect(adapter).toMatch(/generateVideoThumbnailFromFile\(file\)/)
  })

  it('🚨 S44 SURVIVES: still ONE put site, still the BODY\'S OWN provider variable', () => {
    // The defect a second generator invites is a second put — and a video still
    // that ignores the provider its body went to is exactly what 0054 exists to
    // prevent. Both arms must feed this one call.
    expect(adapter).toMatch(/putThumbnailTo\(storageProvider, key, thumb, \{ client \}\)/)
    const puts = adapter.match(/putThumbnailTo\(/g) || []
    expect(puts.length).toBe(1)
  })

  it('🚨 and the video arm has NO money branch either — the pin does that work', () => {
    // fileProviderFor pins `financial` to Supabase BEFORE the workspace's
    // choice is read, so an invoice's preview stays in rabbit-thumbnails by
    // FOLLOWING ITS BODY. If this block ever grows a money test, the pin has
    // been moved out of the one place that owns it.
    //
    // ⚠️ Bounded to the block, not a fixed character window: the `files` row
    // literal a few lines below legitimately carries `is_financial:
    // !!scope.financial`, and a wide slice matches THAT — a test that passes
    // for the wrong reason today and fails for the wrong reason tomorrow.
    const block = sliceBetween(adapter, 'let thumbnailPath = null;', 'const row = {')
    expect(block).toBeTruthy()
    expect(block).toMatch(/generateVideoThumbnailFromFile/)
    expect(block).not.toMatch(/scope\.financial/)
  })

  it('FileThumbnail lets VIDEO rows request the desktop route at all', () => {
    // The original cloud bug in its S40 form: if this gate does not admit
    // video, no request is ever made and every route added this session is
    // dead code.
    expect(thumb).toMatch(/VIDEO_THUMB_EXTS\.has\(ext\)/)
    // And it stays desktop-only — file.extension is the managed-store marker.
    expect(thumb).toMatch(/projectId && file\.extension/)
  })

  it('FileManager mounts the player and gates the size on the ACTIVE PROVIDER', () => {
    expect(manager).toMatch(/<VideoPreview/)
    expect(manager).toMatch(/activeWorkspaceProvider\(await getWorkspaceStorageCached\(\)\)/)
    // ⚠️ WHITESPACE-TOLERANT SINCE S41, and the claim is unchanged. This was
    // `/classifyUpload\(file, \{ workspaceProvider: provider/` — one line,
    // exactly — and S41 wrapped the call across three lines when it added the
    // storagePlan argument. The pin went red for a formatting change while the
    // property it exists to protect (the provider is the VARIABLE, never a
    // constant — the whole point of the S37 correction) was never in doubt.
    // A pin that breaks on reformatting trains people to relax it; the bounded
    // `{0,120}` keeps it from relaxing into "mentions the word somewhere".
    expect(manager).toMatch(/classifyUpload\(file, \{[\s\S]{0,120}?workspaceProvider: provider\b/)
  })

  it('🚨 only `blocked` skips an upload — the other notes ride along', () => {
    const block = sliceRoute(manager, 'const verdict = classifyUpload')
    expect(block).toMatch(/if \(verdict\.blocked\)/)
  })

  it('🚨 a failed provider read does NOT invent a refusal', () => {
    // getWorkspaceStorageCached throws rather than guessing, and uploadFile
    // makes the same call — so the right behaviour is to skip the size gate and
    // let the real attempt produce the real error. Defaulting to petal would
    // refuse a 200 MB file on an s3 workspace that would have taken it.
    expect(manager).toMatch(/if \(!provider\) \{ queued\.push\(file\); continue \}/)
  })

  it('the managed path generates a still AFTER the copy', () => {
    expect(manager).toMatch(/ensureManagedVideoThumbnail\(\{/)
  })

  it('RabbitProvider exposes fileUrl on the context value AND the memo deps', () => {
    expect(provider).toMatch(/const fileUrl = useCallback/)
    const hits = provider.match(/downloadFile, thumbnailUrls, fileUrl,/g) || []
    expect(hits.length).toBe(2)
  })

  it('🚨 playback uses a URL, never downloadFile\'s whole Blob', () => {
    const player = executable(read('components', 'VideoPreview.jsx'))
    // Repointed, not deleted: the call site is now the stable alias
    // `signFileUrl` rather than `ctx.fileUrl` directly — see the dependency
    // test above for why that rename was a fix and not a tidy-up.
    expect(player).toMatch(/signFileUrl\(file\)/)
    expect(player).not.toMatch(/downloadFile/)
  })

  it('🚨 the player depends on the stable METHOD, not on ctx — else playback restarts', () => {
    // Found by re-reading, not by a test. RabbitProvider's context value is a
    // useMemo over `bundle`, `presentUsers` and `realtimeStatus`, so `ctx` gets
    // a new identity on any state change at all — a collaborator's presence
    // ping. Depending on it re-mints the URL and hands <video> a new src,
    // restarting playback mid-view for a reason the viewer cannot see. Same
    // finding S39's review made about FileManager's signing effect.
    const player = executable(read('components', 'VideoPreview.jsx'))
    expect(player).toMatch(/const signFileUrl = ctx\?\.fileUrl/)
    expect(player).toMatch(/\}, \[managed, projectId, file, signFileUrl\]\)/)
  })

  it('🚨 the player is KEYED on the file — a useRef budget must not carry over', () => {
    // Also found by re-reading. `remints` is a useRef; without a key, opening a
    // clip that fails and then a different one reuses the instance, so the
    // second arrives with its re-mint budget already spent and gets no retry on
    // an expired URL.
    expect(manager).toMatch(/key=\{previewFile\.id\}/)
  })

  it('🚨 the player RE-MINTS on error rather than holding a sticky failure flag', () => {
    // S39's own review finding, one bucket over: a signed URL EXPIRES, so a
    // boolean pins the player to an error a fresh URL would have fixed.
    const player = executable(read('components', 'VideoPreview.jsx'))
    expect(player).toMatch(/remints\.current < MAX_REMINTS/)
  })

  it('getUrl is OPTIONAL in the registry — adding it to REQUIRED breaks s3', () => {
    const index = executable(read('storage', 'index.js'))
    expect(index).toMatch(/const REQUIRED = \['put', 'get', 'del', 'exists', 'describe'\]/)
    expect(index).not.toMatch(/'getUrl'/)
    // Supabase implements it; s3 deliberately does not (its presigned GET
    // expires in 300s, and no S3 workspace exists anywhere to verify a
    // longer-lived signer against — the same deferral S44 took for display).
    expect(executable(read('storage', 'supabaseProvider.js'))).toMatch(/async getUrl\(/)
    expect(executable(read('storage', 's3Provider.js'))).not.toMatch(/async getUrl\(/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// The pre-push adversarial review's confirmed findings, pinned so they cannot
// return. Every one was found in code already green on 1315 assertions and
// 16/16 deliberate breakers — the eighth session running where that has been
// true. Two of them (the ctx dependency, the re-mint budget) were caught by
// re-reading before the review returned and are pinned above.
// ═══════════════════════════════════════════════════════════════════════════

describe('review fixes — S40', () => {
  const main = executable(readRepo('electron', 'main.cjs'))
  const cjs = executable(readRepo('electron', 'ffmpeg.cjs'))
  const manager = executable(read('components', 'FileManager.jsx'))
  const player = executable(read('components', 'VideoPreview.jsx'))

  it('🚨 HIGH: the FileList is snapshotted BEFORE the first await', async () => {
    // MEASURED in Electron 33's own Chromium: `input.files` returns ONE
    // FileList object and `input.value = ''` empties it IN PLACE
    // ({sameObject: true, afterLength: 0}). The picker's onChange does
    // `handleAddCloudFiles(e.target.files); e.target.value = ''`, so any await
    // before `Array.from(fileList)` lets the reset win — and EVERY cloud
    // upload became a silent no-op: no rows, no error, just a spinner.
    const fn = sliceBetween(manager, 'const handleAddCloudFiles', 'const handleAddManagedFiles')
    expect(fn).toBeTruthy()
    const snapshot = fn.indexOf('const incoming = Array.from(fileList)')
    const firstAwait = fn.indexOf('await')
    expect(snapshot).toBeGreaterThan(-1)
    expect(firstAwait).toBeGreaterThan(-1)
    expect(snapshot).toBeLessThan(firstAwait)
  })

  it('🚨 HIGH: folder_slug is slugified at the RESOLVER, not only at the writers', () => {
    // The containment BASE was client-controlled: folder_slug reaches a bundle
    // verbatim from req.body, and resolveProjectFolderRoot joined it under the
    // configured root — so '../../../..' turned D:\WilsonRoot\Projects into
    // D:\ and every resolveContainedFilePath below it faithfully contained
    // against a directory the caller chose. Measured working.
    //
    // The resolver is the load-bearing half: a bundle ALREADY ON DISK may
    // carry a poisoned slug, so fixing only the writers leaves it live.
    const fn = sliceBetween(main, 'function resolveProjectFolderRoot', 'function ensureAssetFolder')
    expect(fn).toBeTruthy()
    expect(fn).toMatch(/fileSlugify\(String\(stored\)\)/)
    expect(fn).not.toMatch(/path\.join\(rootBase, bundle\.project\?\.folder_slug/)
  })

  it('🚨 HIGH: and at both writers — the create route and the PATCH spread', () => {
    expect(main).toMatch(/folder_slug:\s*fileSlugify\(String\(req\.body\.folder_slug/)
    expect(main).toMatch(/if \('folder_slug' in req\.body\)/)
  })

  it('🚨 HIGH: the file extension is sanitised before it becomes stored_name', () => {
    // The other half of the same traversal: `extension` is joined into
    // stored_name under the project root, so '/../../../Users/…/secret.docx'
    // walks out of the project folder.
    expect(main).toMatch(/const ext = safeExtension\(req\.body\.extension\)/)
    expect(main).toMatch(/function safeExtension/)
    expect(main).toMatch(/\/\^\\\.\[a-z0-9\]\{1,12\}\$\//)
  })

  it('🚨 HIGH: the stream route never echoes a client-settable Content-Type', () => {
    // The renderer is served from http://127.0.0.1:<port> by this same Express
    // app, so bytes returned as text/html execute as script on WILSON's own
    // origin — with the Supabase session in that origin's localStorage.
    const route = sliceRoute(main, "managed-files/:id/stream'")
    expect(route).toMatch(/safeMediaContentType\(mf\.mime_type\)/)
    expect(route).toMatch(/X-Content-Type-Options', 'nosniff'/)
    expect(route).not.toMatch(/setHeader\('Content-Type', mf\.mime_type/)
    // SVG matches the media shape and is scriptable, so it is excluded by name.
    expect(main).toMatch(/if \(m === 'image\/svg\+xml'\) return 'application\/octet-stream'/)
  })

  it('🚨 the stream route refuses a SOFT-DELETED row', () => {
    // FileManager's delete is the soft path, so without this a file the user
    // deleted kept streaming in full and kept minting audit events.
    const route = sliceRoute(main, "managed-files/:id/stream'")
    expect(route).toMatch(/f\.id === req\.params\.id && !f\.deleted_at/)
  })

  it('🚨 a thumbnail PROBE does not forge a "downloaded" audit event', () => {
    // The renderer fallback drives the audited stream route to decode a frame.
    // Unmarked, importing thirty clips wrote thirty 'downloaded' events for
    // footage nobody had opened — and evicted the project's real history to
    // make room, the exact churn the throttle exists to prevent.
    expect(main).toMatch(/const isThumbnailProbe = req\.query\.probe === '1'/)
    expect(main).toMatch(/if \(!isThumbnailProbe && shouldLogManagedRead\(mf\.id\)\)/)
    const mv = executable(read('storage', 'managedVideoThumbnail.js'))
    expect(mv).toMatch(/managedStreamUrl\(projectId, fileId, \{ probe: true \}\)/)
  })

  it('the probe marker is on the DECODE url and not on the player url', () => {
    // The player is a real human read and must still be audited.
    expect(player).toMatch(/managedStreamUrl\(projectId, file\.id\)/)
    expect(player).not.toMatch(/probe: true/)
  })

  it('🚨 the POST thumbnail arm requires a BARE UUID — one flat cache namespace', () => {
    // mf.id is client-chosen on create, and the cache is shared with
    // `asset-<id>.jpg` / `<entity>-<id>.jpg`, which are served from cache
    // without re-checking their source. Containment stops traversal, not
    // collision.
    expect(main).toMatch(/const UUID_RE =/)
    expect(main).toMatch(/if \(!UUID_RE\.test\(String\(mf\.id\)\)\)/)
  })

  it('🚨 HIGH: extractFrame has ONE deadline for the whole call', () => {
    // probe + attempt + retry ran serially for up to 140s inside one awaited
    // Express handler — and the renderer shares that origin, where Chromium
    // allows six concurrent connections. Six slow tiles froze the whole UI.
    expect(cjs).toMatch(/const TOTAL_DEADLINE_MS =/)
    expect(cjs).toMatch(/const remaining = \(\) => deadlineMs - \(Date\.now\(\) - startedAt\)/)
    expect(cjs).toMatch(/Math\.min\(EXTRACT_TIMEOUT_MS, budget\)/)
  })

  it('🚨 the retry fires ONLY on no_frame, not on a rejected codec', async () => {
    const mod = await import('../../../../electron/ffmpeg.cjs')
    expect(mod.TOTAL_DEADLINE_MS).toBeLessThan(
      mod.PROBE_TIMEOUT_MS + 2 * mod.EXTRACT_TIMEOUT_MS,
    )
    expect(cjs).toMatch(/if \(first\.reason !== 'no_frame'\) return first/)
  })

  it('🚨 ffmpeg writes to a temp path and renames — never in place', () => {
    // The GET route serves thumbPath whenever it EXISTS, and that check runs
    // BEFORE the in-flight dedupe — so an in-place write can hand a concurrent
    // request a truncated JPEG, which FileThumbnail then pins to a generic icon
    // for the life of the component.
    expect(cjs).toMatch(/const tmp = `\$\{output\}\.part`/)
    expect(cjs).toMatch(/fs\.renameSync\(tmp, output\)/)
  })

  it('🚨 a failed decode is negatively cached so a re-render does not respawn it', () => {
    // ⚠️ Strengthened after a breaker proved the first version vacuous: it
    // matched the CONSTANT's name, which survives deleting the code that
    // actually records a failure. Assert the write AND the read.
    expect(main).toMatch(/videoThumbFailedAt\.set\(thumbPath, Date\.now\(\)\)/)
    expect(main).toMatch(/if \(failedAt !== undefined && Date\.now\(\) - failedAt < VIDEO_THUMB_FAIL_TTL_MS\)/)
    // …but "no binary installed" is a MACHINE state the user can change by
    // dropping a file in, not a property of this video.
    expect(main).toMatch(/if \(out\.reason !== 'ffmpeg_missing'\)/)
  })

  it('🚨 resolveFfmpegPath demands a FILE, not merely something that exists', () => {
    // The documented install is "drop the executable in beside this file"; the
    // obvious mistakes are dropping the extracted FOLDER, or a half-downloaded
    // .part. existsSync says yes to both, so hasFfmpeg() would promise a
    // decoder that cannot be spawned.
    expect(cjs).toMatch(/st\.isFile\(\) && st\.size > 0/)
  })

  it('🚨 the video gate accepts an EXTENSION when the OS gives no MIME', () => {
    // Chromium's built-in MIME table has no entry for .mov/.mkv/.avi/.wmv, so
    // File.type is '' and a type-only gate ran NO decoder at all for an H.264
    // .mov — losing the preview through the one-way door.
    expect(looksLikeVideoFile({ type: '', name: 'shot_010.mov' })).toBe(true)
    expect(looksLikeVideoFile({ type: 'video/mp4', name: 'no-extension' })).toBe(true)
    expect(looksLikeVideoFile({ type: '', name: 'notes.pdf' })).toBe(false)
    expect(looksLikeVideoFile(null)).toBe(false)
  })

  it('🚨 .ts is NOT a video extension — it is TypeScript far more often', () => {
    expect(isVideoExtension('.ts')).toBe(false)
    expect(isVideoExtension('.mts')).toBe(true)   // cameras really write this
    expect(isVideoExtension('.m2ts')).toBe(true)
    expect(executable(readRepo('electron', 'main.cjs'))).not.toMatch(/'\.m2v', '\.ts',/)
  })

  it('🚨 the decoder probe is NOT gated on `managed` — every reader is !managed', () => {
    // Gating it measured the decoder exactly where nothing reads it and left
    // it permanently null everywhere it is used, making the
    // `desktopDecoder === false` arm unreachable. The case that matters is the
    // desktop app in CLOUD mode, which serves the route and takes the cloud
    // upload path.
    // ⚠️ The window runs from `managed` to the effect body, because the guard
    // that was wrong sat BETWEEN them. A comment cannot be a slice marker here
    // — executable() has already stripped them.
    const eff = sliceBetween(manager, 'const managed = ctx?.supportsManagedFiles', 'const parentType =')
    expect(eff).toBeTruthy()
    expect(eff).toMatch(/fetch\('\/api\/rabbit\/video-support'\)/)
    expect(eff).not.toMatch(/if \(!managed\) return/)
  })

  it('🚨 one file\'s failure does not abandon the rest of the batch', () => {
    const fn = sliceBetween(manager, 'const failed = []', 'if (failed.length)')
    expect(fn).toBeTruthy()
    expect(fn).toMatch(/failed\.push\(/)
  })

  it('🚨 the player closes on a backdrop CLICK, not on a scrub-drag release', () => {
    // Dragging the native <video> scrub bar and releasing outside the panel
    // dispatches the click on the backdrop, so a plain onClick={onClose} shut
    // the player every time someone scrubbed past the edge.
    expect(player).toMatch(/onMouseDown=\{\(e\) => \{ backdropPress\.current = e\.target === e\.currentTarget \}\}/)
    expect(player).toMatch(/e\.target === e\.currentTarget && backdropPress\.current/)
  })

  it('🚨 a successful load refills the re-mint budget', () => {
    expect(player).toMatch(/remints\.current = 0; setStatus\('playing'\)/)
  })

  it('the recovery sentence matches the control that is actually rendered', () => {
    // The button exists only for a managed file; telling a cloud user to open
    // it elsewhere was an instruction with no control behind it.
    expect(player).toMatch(/managed\s*\n?\s*\?\s*'Preview isn\\'t available for this format\. Open it from its folder/)
    expect(player).toMatch(/Download it to view it/)
    // And the label describes what the IPC does — showItemInFolder REVEALS.
    expect(player).toMatch(/Show in folder/)
    expect(player).not.toMatch(/Open in default app/)
  })
})

describe('review fixes — noticeAfterUpload only claims what it measured', () => {
  it('🚨 says NOTHING about an ordinary video row it did not watch', () => {
    // Every video uploaded before S40 has thumbnail_url = null, because
    // canThumbnail() refused video outright. FileManager derives the row note
    // at RENDER, so a 30 MB H.264 .mp4 from last week was being labelled "no
    // preview for this format" — false about a format Chromium decodes.
    expect(noticeAfterUpload({ name: 'old.mp4', thumbnail_url: null })).toBeNull()
  })

  it('still flags an unwatched PROFESSIONAL container — the heuristic is fair there', () => {
    expect(noticeAfterUpload({ name: 'A001.mxf', thumbnail_url: null })?.code).toBe('no_preview')
  })

  it('🚨 after a watched decode, an ordinary file is not blamed on its FORMAT', () => {
    // The frame may have exceeded THUMBNAIL_MAX_BYTES, or the preview upload
    // may have been refused and swallowed by uploadFile's console.warn.
    const n = noticeAfterUpload({ name: 'clip.mp4', thumbnail_url: null }, { attempted: true })
    expect(n?.message).toMatch(/No preview image could be generated/)
    expect(n?.message).not.toMatch(/this format/)
  })

  it('after a watched decode, a professional container keeps the format sentence', () => {
    const n = noticeAfterUpload({ name: 'A001.mov', thumbnail_url: null }, { attempted: true })
    expect(n?.message).toMatch(/aren't available for this format/)
  })

  it('the upload loop is the ONE caller entitled to `attempted`', () => {
    const manager = executable(read('components', 'FileManager.jsx'))
    expect(manager).toMatch(/noticeAfterUpload\(row, \{ desktopDecoder, attempted: true \}\)/)
    expect(manager).toMatch(/noticeAfterUpload\(f, \{ desktopDecoder \}\)/)
  })
})

// Take a window of source starting at a marker, so an assertion about ONE route
// cannot be satisfied by a different route further down the file.
function sliceRoute(src, marker) {
  const i = src.indexOf(marker)
  if (i === -1) return ''
  return src.slice(i, i + 3000)
}

// The precise version, for a block whose neighbours contain the very string
// being negated. Returns '' when either marker is missing, so a rename fails
// the test loudly instead of asserting over an empty window.
function sliceBetween(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker)
  if (i === -1) return ''
  const j = src.indexOf(endMarker, i + startMarker.length)
  if (j === -1) return ''
  return src.slice(i, j)
}
