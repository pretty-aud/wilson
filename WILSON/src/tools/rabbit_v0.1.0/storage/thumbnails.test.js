// =============================================================================
// thumbnails.test.js — Session 39.
//
// Two halves, and the second is the one this repo keeps needing:
//
//   1. The pure logic (key derivation, the type gate, scaling, the
//      best-effort contract).
//   2. 🚨 WIRING. NINE features have shipped in this project complete and with
//      NO CALLER — folder tree S27, task templates S28, quiz history S30,
//      setOtterAdapterMode, workspaces.storage_mode, POST /api/pet/reset,
//      S31's settings half, and S37's storageSecretClear (caught in review).
//      A green unit test over generateThumbnail() proves nothing about whether
//      an upload ever reaches it. The second half reads the actual source and
//      asserts the call sites exist.
//
// ⚠️ NEGATIVE ASSERTIONS RUN OVER COMMENT-STRIPPED SOURCE. S37's own review
// reproduced the 0038 trap twice: a `not.toContain` matched the COMMENT
// explaining why that form is wrong, so the test passed while the defect stood.
// Assert the EXECUTABLE form, always.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  canThumbnail,
  thumbnailKeyFor,
  scaleToFit,
  generateThumbnail,
  removeThumbnail,
  putThumbnailTo,
  removeThumbnailFrom,
  THUMBNAIL_BUCKET,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_MAX_BYTES,
} from './thumbnails.js'
import {
  FILE_PROVIDERS,
  WORKSPACE_PROVIDERS,
  fileProviderFor,
} from './index.js'

const ROOT = join(process.cwd(), 'src', 'tools', 'rabbit_v0.1.0')

function read(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf-8')
}

// Strip comments so a negative assertion cannot match the prose that explains
// why a form is wrong.
//
// 🚨 ONE ALTERNATING PASS, BLOCK FIRST — and the order inside the alternation
// is the whole point. Stripping blocks in a separate earlier pass is the
// obvious implementation and it is WRONG here, measured: supabaseAdapter.js
// carries a line comment containing the path `rabbit-files/projects/*`, whose
// `/*` opens a block that then closes at the next genuine `*/` — silently
// deleting ~40 lines of real code, including the very call this file asserts.
// A single pass cannot do that: at the `//` the block alternative fails, the
// line alternative consumes to end-of-line, and the stray `/*` never opens
// anything. The mirror case (`/* see http://x */`) is handled by trying the
// block alternative first at each position.
function executable(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
}

// ── A fake canvas stack, so the pipeline is testable without a DOM ──────────
function fakeStack({ width = 1000, height = 500, blobSize = 12_000, fail = null } = {}) {
  const calls = { drawn: null, closed: false, canvas: null }
  const createBitmap = async () => {
    if (fail === 'decode') throw new Error('unsupported image type')
    return { width, height, close: () => { calls.closed = true } }
  }
  const makeCanvas = (w, h) => {
    calls.canvas = { w, h }
    return {
      getContext: () => (fail === 'context' ? null : {
        drawImage: (_b, _x, _y, dw, dh) => { calls.drawn = { dw, dh } },
      }),
      convertToBlob: async () => (fail === 'encode' ? null : { size: blobSize, type: 'image/jpeg' }),
    }
  }
  return { createBitmap, makeCanvas, calls }
}

// The stripper is load-bearing for every negative assertion below, and it
// already had one real bug. Pin it.
describe('executable() — the comment stripper the assertions depend on', () => {
  it('removes line and block comments', () => {
    expect(executable('a // gone\nb')).toBe('a \nb')
    expect(executable('a /* gone */ b')).toBe('a  b')
  })

  it('🚨 a line comment containing /* must not swallow the code after it', () => {
    const src = [
      '// walks rabbit-files/projects/*, not this bucket',
      'keepMe(client, path);',
      'try { x() } catch { /* fine */ }',
    ].join('\n')
    expect(executable(src)).toContain('keepMe(client, path);')
  })

  it('a block comment containing // still terminates at its own */', () => {
    const src = '/* see http://example.com */\nkeepMe();'
    expect(executable(src)).toContain('keepMe();')
  })
})

describe('canThumbnail — the type gate', () => {
  it('accepts the raster types a browser can actually decode', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']) {
      expect(canThumbnail(t)).toBe(true)
    }
  })

  it('refuses TIFF, which no browser decodes even though the DESKTOP list allows it', () => {
    // main.cjs's THUMB_EXTENSIONS includes .tiff/.tif because sharp handles
    // them. Copying that list to the cloud path would mean a failed decode on
    // every TIFF upload — the two tiers legitimately differ here.
    expect(canThumbnail('image/tiff')).toBe(false)
    expect(canThumbnail('image/x-tiff')).toBe(false)
  })

  it('refuses SVG — rasterising untrusted vector can pull external references', () => {
    expect(canThumbnail('image/svg+xml')).toBe(false)
  })

  it('refuses non-images and junk without throwing', () => {
    for (const t of ['video/quicktime', 'application/pdf', '', null, undefined, 42, {}]) {
      expect(canThumbnail(t)).toBe(false)
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(canThumbnail('  IMAGE/PNG  ')).toBe(true)
    expect(canThumbnail('IMAGE/SVG+XML')).toBe(false)
  })
})

describe('thumbnailKeyFor — the key is the source key plus .jpg', () => {
  it('appends .jpg and changes nothing else', () => {
    const src = 'projects/p1/assets/a1/123-plate.png'
    expect(thumbnailKeyFor(src)).toBe('projects/p1/assets/a1/123-plate.png.jpg')
  })

  it('🚨 PRESERVES THE FIRST THREE SEGMENTS EXACTLY — the money gate reads the third', () => {
    // rabbit_money_segment(text) is applied to (storage.foldername(name))[3].
    // Any rewrite that shifts a segment moves an invoice's thumbnail OUT of
    // the manager-only namespace it is supposed to inherit.
    const invoice = 'projects/p1/INVOICES/line1/9-invoice.pdf'
    const key = thumbnailKeyFor(invoice)
    expect(key.split('/').slice(0, 3)).toEqual(['projects', 'p1', 'INVOICES'])
    expect(key.split('/')).toHaveLength(invoice.split('/').length)
  })

  it('does not introduce a thumbs/ level, which would shift every segment', () => {
    const key = thumbnailKeyFor('projects/p1/FINANCE/l1/1-rates.png')
    expect(key.startsWith('projects/')).toBe(true)
    expect(key).not.toMatch(/(^|\/)thumbs?\//)
  })

  it('returns null for a missing or empty path rather than building ".jpg"', () => {
    for (const bad of [null, undefined, '', '   ', 7]) {
      expect(thumbnailKeyFor(bad)).toBeNull()
    }
  })
})

describe('scaleToFit', () => {
  it('fits the longest edge and preserves aspect ratio', () => {
    expect(scaleToFit(1000, 500, 256)).toEqual({ width: 256, height: 128 })
    expect(scaleToFit(500, 1000, 256)).toEqual({ width: 128, height: 256 })
  })

  it('never upscales a small source', () => {
    expect(scaleToFit(64, 32, 256)).toEqual({ width: 64, height: 32 })
  })

  it('never rounds an edge down to zero', () => {
    const s = scaleToFit(10000, 3, 256)
    expect(s.height).toBeGreaterThanOrEqual(1)
  })

  it('returns null on degenerate dimensions', () => {
    for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [NaN, 5]]) {
      expect(scaleToFit(w, h, 256)).toBeNull()
    }
  })
})

describe('generateThumbnail — best-effort by contract', () => {
  it('produces a blob and draws at the fitted size', async () => {
    const { createBitmap, makeCanvas, calls } = fakeStack({ width: 1024, height: 768 })
    const blob = await generateThumbnail(
      { type: 'image/png' }, { createBitmap, makeCanvas },
    )
    expect(blob).toEqual({ size: 12_000, type: 'image/jpeg' })
    expect(calls.canvas).toEqual({ w: 256, h: 192 })
    expect(calls.drawn).toEqual({ dw: 256, dh: 192 })
  })

  it('releases the bitmap even on the happy path (GPU memory, dozens per screen)', async () => {
    const { createBitmap, makeCanvas, calls } = fakeStack()
    await generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas })
    expect(calls.closed).toBe(true)
  })

  it('🚨 RETURNS null AND DOES NOT THROW when the decoder fails', async () => {
    // The source body has ALREADY landed when this runs. Anything thrown from
    // here would strand it — a failed preview must cost a preview.
    const { createBitmap, makeCanvas } = fakeStack({ fail: 'decode' })
    await expect(
      generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas }),
    ).resolves.toBeNull()
  })

  it('returns null when no 2d context is available', async () => {
    const { createBitmap, makeCanvas } = fakeStack({ fail: 'context' })
    expect(await generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas })).toBeNull()
  })

  it('returns null when encoding yields nothing', async () => {
    const { createBitmap, makeCanvas } = fakeStack({ fail: 'encode' })
    expect(await generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas })).toBeNull()
  })

  it('refuses a result over the bucket cap rather than letting Storage reject it', async () => {
    // 0053 caps the bucket at 256 KB. A refusal AFTER the source body has
    // landed is a confusing half-success; this turns it into "no preview".
    const { createBitmap, makeCanvas } = fakeStack({ blobSize: THUMBNAIL_MAX_BYTES + 1 })
    expect(await generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas })).toBeNull()
  })

  it('accepts a result exactly at the cap (boundary, not off-by-one)', async () => {
    const { createBitmap, makeCanvas } = fakeStack({ blobSize: THUMBNAIL_MAX_BYTES })
    expect(await generateThumbnail({ type: 'image/png' }, { createBitmap, makeCanvas })).not.toBeNull()
  })

  it('never calls the decoder for a type it cannot handle', async () => {
    let called = false
    const { makeCanvas } = fakeStack()
    const blob = await generateThumbnail(
      { type: 'video/quicktime' },
      { createBitmap: async () => { called = true }, makeCanvas },
    )
    expect(blob).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null when the environment has no createImageBitmap at all', async () => {
    const { makeCanvas } = fakeStack()
    expect(
      await generateThumbnail({ type: 'image/png' }, { createBitmap: null, makeCanvas }),
    ).toBeNull()
  })
})

describe('the constants agree with migration 0053', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '0053_thumbnails_bucket.sql'), 'utf-8',
  )

  it('the client cap is the bucket cap', () => {
    expect(THUMBNAIL_MAX_BYTES).toBe(262144)
    expect(migration).toContain('262144')
  })

  it('names the same bucket the migration creates', () => {
    expect(THUMBNAIL_BUCKET).toBe('rabbit-thumbnails')
    expect(migration).toContain("'rabbit-thumbnails'")
  })

  it('the bucket is created PRIVATE — a public one is TPN-CLOUD-004 repeated', () => {
    const sql = executable(migration)
    expect(sql).toMatch(/INSERT INTO storage\.buckets[\s\S]*?'rabbit-thumbnails',\s*\n\s*false,/)
  })

  it('the edge matches the desktop managed-file route (sharp .resize(256))', () => {
    expect(THUMBNAIL_MAX_EDGE).toBe(256)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 SESSION 44 — A THUMBNAIL LIVES WHERE ITS SOURCE LIVES
//
// Audrey, 2026-08-08: "the image should be kept in the company storage. if the
// thumbnail lived in the petal cloud it would break tpn inherently."
//
// A still frame IS the content, so a legible 256px frame of pre-release footage
// must not sit on Petal's infrastructure when its source does not. These are
// the BEHAVIOURAL half — the source-text guards further down prove the call
// site passes the body's own provider, and these prove what happens when it
// does.
// ═══════════════════════════════════════════════════════════════════════════

describe('putThumbnailTo — the destination follows the body', () => {
  // A Supabase double that records what bucket and options it was handed.
  function supabaseDouble() {
    const seen = { bucket: null, key: null, opts: null, removed: null }
    const client = {
      storage: {
        from: (bucket) => {
          seen.bucket = bucket
          return {
            upload: async (key, _blob, opts) => { seen.key = key; seen.opts = opts; return { error: null } },
            remove: async (keys) => { seen.removed = keys; return { error: null } },
          }
        },
      },
    }
    return { client, seen }
  }

  function providerDouble() {
    const seen = { put: null, del: null }
    const impl = {
      put: async (key, body, opts) => { seen.put = { key, body, opts }; return { key } },
      del: async (key) => { seen.del = key },
    }
    return { getProvider: () => impl, seen }
  }

  it('a supabase body puts its preview in rabbit-thumbnails, upsert:true', async () => {
    // upsert:true unlike the source: a thumbnail's key is a pure function of
    // its source's key, so regenerating must be able to replace a stale render.
    const { client, seen } = supabaseDouble()
    await putThumbnailTo(FILE_PROVIDERS.SUPABASE, 'projects/p/assets/a/1-x.png.jpg', {}, { client })
    expect(seen.bucket).toBe(THUMBNAIL_BUCKET)
    expect(seen.key).toBe('projects/p/assets/a/1-x.png.jpg')
    expect(seen.opts).toMatchObject({ upsert: true, contentType: 'image/jpeg' })
  })

  it('🚨 an s3 body puts its preview in the CUSTOMER\'S bucket, beside the source', async () => {
    // This is the compliance decision in one assertion. Before S44 this same
    // call wrote to Petal's bucket.
    const { getProvider, seen } = providerDouble()
    const blob = { size: 1 }
    await putThumbnailTo(FILE_PROVIDERS.S3, 'projects/p/assets/a/1-x.png.jpg', blob, { getProvider })
    expect(seen.put.key).toBe('projects/p/assets/a/1-x.png.jpg')
    expect(seen.put.body).toBe(blob)
    expect(seen.put.opts).toEqual({ contentType: 'image/jpeg' })
  })

  it('goes through the REGISTRY for s3, never a fork of the adapter', async () => {
    // §4a2b: a provider is five functions, never an adapter fork. S38's Drive
    // entry must need no thumbnail work of its own — which is only true if this
    // dispatches on the registry rather than branching per provider.
    let asked = null
    const impl = { put: async () => ({ key: 'k' }) }
    await putThumbnailTo('s3', 'projects/p/a/1/x.png.jpg', {}, {
      getProvider: (name) => { asked = name; return impl },
    })
    expect(asked).toBe('s3')
  })

  it('an unregistered provider FAILS CLOSED rather than guessing at Petal', async () => {
    // 'local_server' and 'google_drive' have no cloud implementation. A guess
    // of Supabase here would silently route a customer's frame to a store they
    // moved away from — the exact failure this session exists to close.
    await expect(
      putThumbnailTo('local_server', 'projects/p/a/1/x.png.jpg', {}, {
        getProvider: (n) => { throw new Error(`no storage provider registered for "${n}"`) },
      }),
    ).rejects.toThrow(/no storage provider registered/)
  })

  it('🚨 THE ROUTING INVARIANT: the preview\'s store is the body\'s store, per provider', async () => {
    // The property the whole session rests on, stated over every workspace
    // provider that has a cloud upload path. `network` is excluded because
    // uploadFile refuses it before either decision is made.
    for (const ws of [WORKSPACE_PROVIDERS.PETAL, WORKSPACE_PROVIDERS.S3]) {
      const bodyProvider = fileProviderFor(ws, { financial: false })
      let thumbProvider = null
      const { client } = supabaseDouble()
      await putThumbnailTo(bodyProvider, 'projects/p/a/1/x.png.jpg', {}, {
        client,
        getProvider: (n) => { thumbProvider = n; return { put: async () => ({}) } },
      })
      // Either it took the Supabase arm (because the body did) or it asked the
      // registry for exactly the provider the body used.
      expect(thumbProvider ?? FILE_PROVIDERS.SUPABASE).toBe(bodyProvider)
    }
  })

  it('🚨 THE MONEY PIN: an invoice on an s3 workspace keeps its preview on Petal', async () => {
    // Money-gated files are this rule APPLIED, not an exception. Only RLS
    // enforces the money gate and no S3 sharing model binds to a WILSON project
    // role, so an invoice's body never leaves Supabase — and its preview
    // follows it there without any money branch in the thumbnail path.
    const bodyProvider = fileProviderFor(WORKSPACE_PROVIDERS.S3, { financial: true })
    expect(bodyProvider).toBe(FILE_PROVIDERS.SUPABASE)

    const { client, seen } = supabaseDouble()
    let askedRegistry = false
    await putThumbnailTo(bodyProvider, 'projects/p/INVOICES/l1/9-inv.pdf.jpg', {}, {
      client,
      getProvider: () => { askedRegistry = true; return { put: async () => ({}) } },
    })
    expect(askedRegistry).toBe(false)
    expect(seen.bucket).toBe(THUMBNAIL_BUCKET)
    // And the money segment is still the THIRD one, so 0053's money policies
    // gate this object exactly as they gate the invoice itself.
    expect(seen.key.split('/')[2]).toBe('INVOICES')
  })
})

describe('removeThumbnailFrom — the compensating delete finds the right store', () => {
  it('deletes a Petal preview from rabbit-thumbnails', async () => {
    let bucket = null; let removed = null
    const client = {
      storage: {
        from: (b) => { bucket = b; return { remove: async (k) => { removed = k; return { error: null } } } },
      },
    }
    await removeThumbnailFrom(FILE_PROVIDERS.SUPABASE, 'projects/p/a/1/x.png.jpg', { client })
    expect(bucket).toBe(THUMBNAIL_BUCKET)
    expect(removed).toEqual(['projects/p/a/1/x.png.jpg'])
  })

  it('🚨 deletes an s3 preview from the customer\'s bucket, not from Petal\'s', async () => {
    // Deleting from Petal a thumbnail that went to a customer's bucket succeeds
    // at removing nothing, and strands a legible frame where WILSON can never
    // sweep it: no orphan scan walks a customer bucket, by design (§12.4).
    let deleted = null
    await removeThumbnailFrom(FILE_PROVIDERS.S3, 'projects/p/a/1/x.png.jpg', {
      getProvider: () => ({ del: async (k) => { deleted = k } }),
    })
    expect(deleted).toBe('projects/p/a/1/x.png.jpg')
  })

  it('is a no-op for a null key on EITHER arm and touches no store', async () => {
    let touched = false
    const client = { storage: { from: () => { touched = true; return {} } } }
    await removeThumbnailFrom(FILE_PROVIDERS.SUPABASE, null, { client })
    await removeThumbnailFrom(FILE_PROVIDERS.S3, null, {
      getProvider: () => { touched = true; return {} },
    })
    expect(touched).toBe(false)
  })

  it('THROWS on refusal from either arm — this is the only cleanup path there is', async () => {
    // With no files row there is no thumbnail_url, so the purge trigger never
    // sees the object and no orphan scan walks either bucket for it. An
    // unchecked resolve turns an expired token into a silent success.
    const client = {
      storage: { from: () => ({ remove: async () => ({ error: { message: 'jwt expired' } }) }) },
    }
    await expect(removeThumbnailFrom(FILE_PROVIDERS.SUPABASE, 'k', { client }))
      .rejects.toThrow(/delete failed: jwt expired/)
    await expect(removeThumbnailFrom(FILE_PROVIDERS.S3, 'k', {
      getProvider: () => ({ del: async () => { throw new Error('[s3] storage delete failed: HTTP 403') } }),
    })).rejects.toThrow(/storage delete failed/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WIRING — every new export has a real caller
// ═══════════════════════════════════════════════════════════════════════════

describe('wiring: the upload path actually generates and stores a thumbnail', () => {
  const adapter = executable(read('adapters', 'supabaseAdapter.js'))

  it('supabaseAdapter imports the generator, not just the helpers', () => {
    expect(adapter).toContain('generateThumbnail')
    expect(adapter).toContain("from '../storage/thumbnails'")
  })

  it('uploadFile CALLS generateThumbnail and putThumbnailTo', () => {
    expect(adapter).toMatch(/await generateThumbnail\(/)
    expect(adapter).toMatch(/await putThumbnailTo\(/)
  })

  it('🚨 S44: the thumbnail is written with the BODY\'S OWN provider variable', () => {
    // The whole design in one assertion. `storageProvider` is computed once,
    // four lines above, for the body — passing that same variable is what makes
    // it impossible for the derived preview to land at a different store than
    // its source. A re-derivation here (another activeWorkspaceProvider call,
    // another fileProviderFor) would be two decisions that can disagree.
    expect(adapter).toMatch(/putThumbnailTo\(storageProvider,\s*key,\s*thumb/)
    // And the Petal constant it replaced must be gone from the executable code.
    expect(adapter).not.toMatch(/putThumbnail\(client,/)
  })

  it('🚨 S44: the thumbnail write has NO money branch — the pin does that work', () => {
    // fileProviderFor pins `financial` to Supabase BEFORE the workspace's
    // choice is read, so an invoice's preview stays in rabbit-thumbnails by
    // following its body. A money test at the thumbnail call site would mean
    // the pin had been moved out of the one place that owns it.
    const upload = adapter.slice(adapter.indexOf('async uploadFile'))
    const gen = upload.indexOf('generateThumbnail')
    const rowWrite = upload.indexOf('thumbnail_url:')
    expect(gen).toBeGreaterThan(-1)
    expect(rowWrite).toBeGreaterThan(gen)
    expect(upload.slice(gen, rowWrite)).not.toMatch(/financial/)
  })

  it('🚨 the files row is written WITH thumbnail_url — the column gets its first writer', () => {
    expect(adapter).toMatch(/thumbnail_url:\s*thumbnailPath/)
  })

  it('the thumbnail key is derived, never hand-built from the storage path', () => {
    expect(adapter).toMatch(/thumbnailKeyFor\(storagePath\)/)
    // The executable form must not concatenate '.jpg' itself — one definition.
    expect(adapter).not.toMatch(/storagePath\s*\+\s*['"`]\.jpg/)
  })

  it('a refused files-row insert compensates the THUMBNAIL as well as the body', () => {
    // With no row there is no thumbnail_url, so the purge trigger will never
    // see this object and the queue drain cannot reach it. This is its ONLY
    // cleanup.
    // 🚨 S44: removed from THE STORE IT REACHED, via the same provider the put
    // used. Deleting from Petal's bucket a thumbnail that went to a customer's
    // succeeds at removing nothing and strands a legible frame in storage
    // WILSON can never sweep (§12.4 — no orphan scan walks a customer bucket).
    expect(adapter).toMatch(/removeThumbnailFrom\(storageProvider,\s*thumbnailPath/)
    expect(adapter).not.toMatch(/removeThumbnail\(client,/)
  })

  it('thumbnail failure cannot refuse the upload — the put is inside a try', () => {
    const upload = adapter.slice(adapter.indexOf('async uploadFile'))
    const gen = upload.indexOf('generateThumbnail')
    const tryBefore = upload.lastIndexOf('try {', gen)
    const catchAfter = upload.indexOf('catch', gen)
    expect(tryBefore).toBeGreaterThan(-1)
    expect(catchAfter).toBeGreaterThan(gen)
  })

  it('exposes a batched signing method rather than one call per tile', () => {
    expect(adapter).toMatch(/async thumbnailUrls\(/)
    expect(adapter).toMatch(/signedThumbnailUrls\(client/)
  })
})

describe('wiring: the display path reaches the screen', () => {
  const provider = executable(read('state', 'RabbitProvider.jsx'))
  const manager = executable(read('components', 'FileManager.jsx'))
  const thumb = executable(read('components', 'FileThumbnail.jsx'))

  it('RabbitProvider defines thumbnailUrls AND puts it on the context value', () => {
    expect(provider).toMatch(/const thumbnailUrls = useCallback/)
    // Twice: the value object and the memo dependency list. One without the
    // other is a method that never updates or never appears.
    const hits = provider.match(/downloadFile, thumbnailUrls,/g) || []
    expect(hits.length).toBe(2)
  })

  it('FileManager signs the batch and passes it down at BOTH render sites', () => {
    // Via the stable alias, not ctx directly — see the review-fix test below.
    expect(manager).toMatch(/signThumbnails\(thumbKeys\)/)
    const passes = manager.match(/thumbnailUrl=\{thumbUrls\.get\(f\.thumbnail_url\)/g) || []
    expect(passes.length).toBe(2) // the table row and the grid card
  })

  it('only rows that HAVE a thumbnail are signed', () => {
    expect(manager).toMatch(/\.map\(f => f\.thumbnail_url\)\s*\n?\s*\.filter\(Boolean\)/)
  })

  it('🚨 S44: only PETAL-HOSTED previews are asked for — s3 rows are excluded', () => {
    // Since S44 a thumbnail lives at its body's provider, so an s3 row's
    // preview is in the CUSTOMER's bucket and signedThumbnailUrls cannot reach
    // it. Filtering here rather than letting createSignedUrls miss them is the
    // difference between a stated behaviour and a lookup that quietly finds
    // nothing — and this is the exact line the deferred display session
    // extends. Display was scoped out by Audrey on 2026-08-08: it needs a batch
    // presign that does not exist, and no S3 workspace exists anywhere to
    // verify one against.
    expect(manager).toMatch(
      /\.filter\(f => \(f\.storage_provider \?\? 'supabase'\) === 'supabase'\)/,
    )
  })

  it('🚨 FileThumbnail no longer gates the cloud path on file.extension', () => {
    // The original bug: a cloud files row has NO extension column, so
    // `IMAGE_EXTS.has(file.extension)` was always false, the <img> was never
    // rendered and NO REQUEST WAS EVER MADE. The onError fallback is dead code
    // on the web — fixing that path would have changed nothing.
    expect(thumb).toMatch(/thumbnailUrl/)
    expect(thumb).not.toMatch(/const isImage = IMAGE_EXTS\.has\(\(file\.extension/)
  })

  it('the Express route stays desktop-only — it is gated on a managed row', () => {
    // file.extension is the managed-store marker; a cloud row must never be
    // pointed at a server that does not exist in a browser.
    expect(thumb).toMatch(/projectId && file\.extension/)
  })

  it('derives an extension from the name so cloud rows get real file-type icons', () => {
    expect(thumb).toMatch(/export function extensionOf/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// The pre-deploy adversarial review's confirmed findings, pinned so they
// cannot return. All four were found in code that was already green on 20/20
// pgTAP probes and 45 vitest assertions.
// ═══════════════════════════════════════════════════════════════════════════

describe('review fixes', () => {
  it('removeThumbnail THROWS on a Storage error instead of resolving silently', async () => {
    // supabase-js resolves for every status. Unchecked, an expired token turns
    // the thumbnail's ONLY cleanup path into a silent success and leaves a
    // legible frame in the bucket with nothing pointing at it.
    const client = {
      storage: { from: () => ({ remove: async () => ({ error: { message: 'jwt expired' } }) }) },
    }
    await expect(removeThumbnail(client, 'projects/p/a/1/x.png.jpg'))
      .rejects.toThrow(/delete failed: jwt expired/)
  })

  it('removeThumbnail is a no-op for a null key and never calls Storage', async () => {
    let called = false
    const client = { storage: { from: () => { called = true; return {} } } }
    await removeThumbnail(client, null)
    expect(called).toBe(false)
  })

  it('🚨 FileThumbnail recovers when a NEW url replaces one that failed', () => {
    // A boolean imgError is sticky for the component's life, and signed URLs
    // expire after an hour — a lazy tile scrolled into view past expiry would
    // be pinned to a generic icon forever, unrepairable by a fresh URL.
    const src = executable(read('components', 'FileThumbnail.jsx'))
    expect(src).toMatch(/const \[erroredSrc, setErroredSrc\]/)
    expect(src).toMatch(/if \(src && erroredSrc !== src\)/)
    expect(src).toMatch(/onError=\{\(\) => setErroredSrc\(src\)\}/)
    // The sticky boolean must be gone from the executable code.
    expect(src).not.toMatch(/const \[imgError, setImgError\]/)
  })

  it('🚨 the signing effect depends on the stable METHOD, not on the whole ctx', () => {
    // RabbitProvider's context useMemo lists `bundle` and `presentUsers` among
    // its deps, so `ctx` changes identity on any unrelated state change — and
    // a re-sign yields new URLs, so every visible tile reloads.
    const src = executable(read('components', 'FileManager.jsx'))
    expect(src).toMatch(/const signThumbnails = ctx\?\.thumbnailUrls/)
    expect(src).toMatch(/\}, \[signThumbnails, thumbKeys\]\)/)
  })

  it('🚨 the GC restorability check fails CLOSED on a read error', () => {
    // "A failed read pushes nothing" (S37). Unchecked, a statement timeout
    // reads as "nothing references this path" — a licence to delete, then
    // stamped 'deleted' in the disposal ledger.
    const gc = executable(readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'storage-gc', 'index.ts'), 'utf-8',
    ))
    expect(gc).toMatch(/error: refErr \} = await ctx\.admin/)
    expect(gc).toMatch(/if \(refErr\) \{/)
    expect(gc).toMatch(/restorability check failed, nothing deleted/)
  })

  it('🚨 teardown sweeps the thumbnails bucket and says so on the certificate', () => {
    // WIL-7005 affirmatively states a complete disposal. A bucket teardown
    // does not know about makes that statement false, permanently — after the
    // CASCADE nothing can attribute a project folder to a workspace again.
    const ops = executable(readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'operator-workspaces', 'index.ts'), 'utf-8',
    ))
    expect(ops).toMatch(/const THUMBNAIL_BUCKET = 'rabbit-thumbnails'/)
    expect(ops).toMatch(/storage\.from\(THUMBNAIL_BUCKET\)\.remove\(batch\)/)
    expect(ops).toMatch(/thumbnails_removed: thumbsRemoved/)

    // 🚨 S44 INVERTED THIS ASSERTION, DELIBERATELY. It used to require that the
    // thumbnail scan NOT inherit the body scan's provider filter, because every
    // preview was on Petal whatever held the body. Since S44 a thumbnail lives
    // at its body's provider, so the unfiltered scan would hand
    // rabbit-thumbnails a batch of keys that were never in it — removes that
    // succeed at removing nothing, and a teardown that reports disposing of
    // previews it never touched.
    //
    // Inverted rather than deleted: the assertion is the record of a decision,
    // and a deleted one leaves the next session free to "simplify" the filter
    // back out.
    //
    // 🚨 AND IT IS `neq('s3')`, NOT `eq('supabase')`. The sweep must mirror
    // 0054's THUMBNAIL arm (s3 -> customer bucket, everything else -> Petal),
    // not the BODY scan's pin. A `local_server` or `google_drive` row can carry
    // a Petal-hosted preview — 0053 widened the purge trigger for exactly that
    // case — so `eq('supabase')` would leave those frames in rabbit-thumbnails
    // while WIL-7005 certifies the tenant destroyed. That is the mistake this
    // session made and caught in its own review.
    const scan = ops.slice(ops.indexOf("select('thumbnail_url')"))
    expect(scan.slice(0, 220)).toMatch(/\.neq\('storage_provider', 's3'\)/)
    expect(scan.slice(0, 220)).not.toMatch(/\.eq\('storage_provider', 'supabase'\)/)
  })

  it('🚨 S44: teardown COUNTS the previews it deliberately leaves in a customer bucket', () => {
    // WIL-7005 affirmatively states a complete disposal. Since S44 an s3 row
    // leaves TWO objects in the customer's bucket — body and preview — so a
    // row count under-reports by one per preview, and a certificate that
    // under-reports is the failure S39's own review caught.
    const ops = executable(readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'operator-workspaces', 'index.ts'), 'utf-8',
    ))
    expect(ops).toMatch(/byo_thumbnails_left: byoThumbsLeft/)
    // Counted from BOTH sources, like byoLeft: a purged-but-undrained preview
    // has no files row and is still in the bucket.
    expect(ops).toMatch(/\.eq\('kind', 'thumbnail'\)/)
    // NULL on failure rather than 0 — after the CASCADE nothing can re-derive
    // it, so an unknown must read as unknown forever (S37's review).
    expect(ops).toMatch(/!liveThumbRes\.error/)
  })
})

describe('wiring: disposal and CI registration', () => {
  it('the GC drain checks the right column for a thumbnail queue row', () => {
    const gc = executable(readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'storage-gc', 'index.ts'), 'utf-8',
    ))
    // Asking `storage_path` for a thumbnail row always answers "unreferenced",
    // which is a licence to delete a still-restorable preview.
    //
    // 🚨 S44: THE DISCRIMINATOR READS `kind`, NOT THE BUCKET. S39's version
    // tested the bucket name, which was sound only while every thumbnail was in
    // Petal's thumbnail bucket. Since S44 an s3 workspace's preview sits in the
    // customer's bucket under the SAME 'byo-s3' marker as its body, so a bucket
    // test would classify every s3 thumbnail as a body, check storage_path,
    // find nothing, delete a restorable preview and stamp it 'deleted' in the
    // ledger — the exact failure the paragraph above exists to prevent,
    // re-entering through this session's own fix.
    expect(gc).toMatch(
      /\(row as \{ kind\?: string \}\)\.kind === 'thumbnail'/,
    )
    expect(gc).not.toMatch(/row\.bucket_id === THUMBNAIL_BUCKET/)
    expect(gc).toMatch(/\.eq\(refColumn, row\.object_path\)/)
  })

  it('🚨 S44: the drain SELECTS kind — omitting it silently deletes previews', () => {
    // `kind` picks the restorability column. Left out of the select, row.kind
    // is undefined, every thumbnail reads as a body, and the drain deletes
    // restorable previews while certifying them disposed. A missing column in
    // this list is a data-loss bug, not a missing field.
    const gc = executable(readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'storage-gc', 'index.ts'), 'utf-8',
    ))
    expect(gc).toMatch(/\.select\('id, bucket_id, object_path, provider, kind'\)/)
  })

  // 🚨 READ 0054, NOT 0053. 0053 wrote the first thumbnail arm and its text is
  // still true OF THAT FILE, but it is no longer the live rule — asserting
  // against it would be the "cite the file that no longer defines the live
  // rule" trap this repo has already paid for once.
  it('the purge trigger enqueues the thumbnail AT ITS BODY\'S STORE and keeps S37s s3 arm', () => {
    const sql = executable(readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0054_thumbnail_follows_its_source.sql'), 'utf-8',
    ))
    // The thumbnail arm can now name the customer bucket...
    expect(sql).toMatch(/CASE WHEN OLD\.storage_provider::text = 's3' THEN 'byo-s3' ELSE 'rabbit-thumbnails' END/)
    // ...and it tags what it is, so the drain never has to infer it.
    expect(sql).toMatch(/'thumbnail'\s*\n?\s*\)/)
    // S37's body arm survives the rewrite.
    expect(sql).toContain("'byo-s3'")
    expect(sql).toMatch(/OR OLD\.thumbnail_url IS NOT NULL/)
  })

  it('🚨 the thumbnail arm does NOT mirror the body arm\'s provider expression', () => {
    // The plausible-looking mirror — write OLD.storage_provider into the
    // provider column for the thumbnail too — enqueues a local_server row's
    // Petal-hosted preview as provider 'local_server', which
    // storage_gc_queue_provider_chk refuses outright (0051 admits only
    // 'supabase' and 's3'). Every such purge would become a caught WARNING and
    // dispose of nothing. 0053 widened the trigger for exactly that case, so
    // it is reachable by construction, not hypothetical.
    const sql = executable(readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0054_thumbnail_follows_its_source.sql'), 'utf-8',
    ))
    const writes = sql.match(/OLD\.storage_provider::text,/g) || []
    expect(writes.length).toBe(1) // the body arm, and only the body arm
  })

  it('🚨 the queue row carries `kind`, and 0054 backfills the pre-existing ones', () => {
    const sql = executable(readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0054_thumbnail_follows_its_source.sql'), 'utf-8',
    ))
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'body'/)
    // Explicit DROP + ADD, never a wrapped ADD — S36 measured that a wrapped
    // re-ADD against an existing constraint is a SILENT NO-OP.
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS storage_gc_queue_kind_chk/)
    expect(sql).toMatch(/ADD CONSTRAINT storage_gc_queue_kind_chk/)
    // Rows written before this migration must not be left mislabelled.
    expect(sql).toMatch(/UPDATE public\.storage_gc_queue[\s\S]*?SET kind = 'thumbnail'/)
  })

  it('🚨 suite 63 is in the rls.yml replay list — nothing fails if it is not', () => {
    // The list is hand-maintained and not derived. A suite missing from it
    // still RUNS, it simply never replays on failure, so the job says why
    // nothing failed while the real failure sits in a file it never touched
    // (S17: suites 33-38 failed INVISIBLY for exactly this reason).
    const yml = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'rls.yml'), 'utf-8',
    )
    expect(yml).toContain('supabase/tests/rls/63_thumbnails_bucket.sql')
  })

  it('🚨 suite 64 is in the rls.yml replay list too', () => {
    // Suite 63 had this pin and 64 would not have inherited it. The RLS_TABLES
    // coverage guard globs `*_<table>.sql` and cannot see a suite named for a
    // concept, so the replay list is the ONLY thing that registers this one.
    const yml = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'rls.yml'), 'utf-8',
    )
    expect(yml).toContain('supabase/tests/rls/64_thumbnail_provider.sql')
  })
})
