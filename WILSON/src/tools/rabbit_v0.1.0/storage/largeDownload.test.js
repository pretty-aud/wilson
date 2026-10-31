// =============================================================================
// largeDownload.test.js — Session 42
//
// 0057 raised the WRITE ceiling from 50 MiB to 50 GiB and left the READ side
// buffering the whole object into a Blob, so the product could accept files it
// could never give back. This file pins the repair.
//
// 🚨 THE TWO ASSERTIONS THAT CARRY IT are the ones about Content-Disposition
// and about the video player, and neither is obvious:
//   * `a.download` is IGNORED for a cross-origin URL, so the filename and the
//     attachment behaviour must come from createSignedUrl's `download` option.
//   * ...and that option must NOT be set for the S40 video player, or a <video>
//     downloads the clip instead of playing it.
// One flag, two callers, opposite requirements.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSupabaseStorageProvider } from './supabaseProvider.js'

const REPO = process.cwd()
const read = (...p) => readFileSync(join(REPO, ...p), 'utf-8')
// One alternating pass, block alternative first — a separate block pass eats
// real code when a line comment opens a block (S39, measured).
const executable = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

function fakeBucket({ signed = 'https://proj.supabase.co/signed?token=x', error = null } = {}) {
  const calls = []
  const bucket = {
    createSignedUrl: (...args) => {
      calls.push(args)
      return Promise.resolve({ data: error ? null : { signedUrl: signed }, error })
    },
  }
  const client = { storage: { from: () => bucket } }
  return { calls, requireClient: async () => client }
}

describe('supabaseProvider.getUrl — one flag, two opposite callers', () => {
  it('🚨 sets Content-Disposition via the download option when asked', async () => {
    const { calls, requireClient } = fakeBucket()
    const p = createSupabaseStorageProvider(requireClient)
    await p.getUrl('projects/p/ASSETS/a/1-master.mov', 300, { download: 'master.mov' })
    expect(calls[0][0]).toBe('projects/p/ASSETS/a/1-master.mov')
    expect(calls[0][1]).toBe(300)
    expect(calls[0][2]).toEqual({ download: 'master.mov' })
  })

  // 🚨 THE S40 VIDEO PLAYER MUST STAY INLINE. `Content-Disposition: attachment`
  // makes a <video> save the file instead of playing it, so passing the option
  // unconditionally would silently break playback — a regression in a feature
  // this session never touched.
  it('🚨 passes NO options for the inline player call — attachment would break <video>', async () => {
    const { calls, requireClient } = fakeBucket()
    const p = createSupabaseStorageProvider(requireClient)
    await p.getUrl('projects/p/ASSETS/a/1-master.mov', 3600)
    expect(calls[0][2]).toBeUndefined()
  })

  it('an empty download name does not smuggle the option in', async () => {
    const { calls, requireClient } = fakeBucket()
    const p = createSupabaseStorageProvider(requireClient)
    await p.getUrl('k', 300, { download: '' })
    expect(calls[0][2]).toBeUndefined()
  })

  it('a signing failure THROWS — an RLS refusal must not read as "no URL"', async () => {
    const { requireClient } = fakeBucket({ error: { message: 'row-level security' } })
    const p = createSupabaseStorageProvider(requireClient)
    await expect(p.getUrl('k', 300, { download: 'a.mov' })).rejects.toThrow(/row-level security/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Source pins. Comments are stripped first: this file's own subject is
// discussed in prose in every file it checks, and a naive grep would match the
// explanation rather than the code (the 0038 trap, three times over in this
// repo).
describe('🚨 wiring — the path exists AND is reached', () => {
  const manager = executable(read('src', 'tools', 'rabbit_v0.1.0', 'components', 'FileManager.jsx'))
  const provider = executable(read('src', 'tools', 'rabbit_v0.1.0', 'state', 'RabbitProvider.jsx'))
  const adapter = executable(read('src', 'tools', 'rabbit_v0.1.0', 'adapters', 'supabaseAdapter.js'))

  it('FileManager tries the signed URL BEFORE falling back to the Blob', () => {
    const iSigned = manager.indexOf('ctx.downloadUrl')
    const iBlob = manager.indexOf('ctx.downloadFile(file)')
    expect(iSigned).toBeGreaterThan(-1)
    expect(iBlob).toBeGreaterThan(-1)
    expect(iSigned).toBeLessThan(iBlob)
  })

  it('the Blob fallback survives — a provider that cannot sign still downloads', () => {
    expect(manager).toContain('URL.createObjectURL(blob)')
    expect(manager).toContain('URL.revokeObjectURL')
  })

  // 🚨 THE ALLOWLIST TRAP. RabbitProvider names its exports twice — once in the
  // context value and once in the memo dependency array. S31 shipped a whole
  // feature half that was never reachable because only one list was updated.
  //
  // ⚠️ THE FIRST FORM OF THIS TEST WAS A COUNT (`>= 3 occurrences`) AND WAS
  // WORTHLESS: the definition alone contributes three, so it passed with either
  // list missing — the precise defect it was written for. Anchor on the two
  // LIST ENTRIES instead, which are the only occurrences that make the method
  // reachable from a component.
  it('RabbitProvider exposes downloadUrl in BOTH lists, not just one', () => {
    const entries = provider.match(/fileUrl,\s*\n\s*downloadUrl,/g) || []
    expect(entries).toHaveLength(2)
  })

  // 🚨 A SECOND DOWNLOAD PATH THAT SKIPPED THE AUDIT WOULD MAKE THE TRAIL
  // SILENTLY INCOMPLETE FOR THE LARGEST, MOST SENSITIVE ASSETS — the ones that
  // most need it (S33/0047, TPN-CONT-008).
  it('the signed-URL path still writes the downloaded audit event', () => {
    const block = adapter.slice(adapter.indexOf('async downloadUrl'))
      .slice(0, 1600)
    expect(block).toContain('log_file_downloaded')
    // ...and checks the result, because rpc() resolves for every status.
    expect(block).toMatch(/logged\.error/)
  })

  it('downloadUrl returns null rather than throwing when the provider cannot sign', () => {
    // P1 moved this pin: getUrl is REQUIRED, so every provider has one, and
    // "cannot sign" is getUrl answering null (s3 for a download).
    const block = adapter.slice(adapter.indexOf('async downloadUrl')).slice(0, 900)
    expect(block).not.toMatch(/typeof provider\.getUrl/)
    expect(block).toMatch(/if \(!url\) return null/)
  })
})

// =============================================================================
// P1 review round 1, finding 3: the MIDDLE LINKS that carry the two flags.
// The real cloud adapter, driven against registered fake providers: the stage's
// `stream` reaches the row's provider through fileUrl, and FileManager's
// `{ provider: 's3' }` reaches the s3 provider's batch through thumbnailUrls.
// RabbitProvider's two pass-throughs are pinned by text below.
// =============================================================================
describe('the cloud adapter carries the flags to the provider (P1)', () => {
  const S3KEY = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-cut.mov'
  async function adapterWith() {
    vi.resetModules()
    vi.doMock('../../../cloud/auth/supabaseClient.js', () => ({
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
    }))
    const { supabaseAdapter, resetSupabaseAdapter } = await import('../adapters/supabaseAdapter')
    const { registerStorageProvider, FILE_PROVIDERS } = await import('./index.js')
    resetSupabaseAdapter()
    const seen = { getUrl: [], getUrls: [] }
    const fake = (name) => ({
      put: async () => {}, get: async () => new Blob(['x']), del: async () => {},
      exists: async () => true, describe: async () => ({}),
      getUrl: async (key, expiresIn, opts) => { seen.getUrl.push([name, key, expiresIn, opts]); return `https://${name}.example/${key}` },
      getUrls: async (keys) => { seen.getUrls.push([name, keys]); return new Map(keys.map((k) => [k, `https://${name}.example/${k}`])) },
    })
    registerStorageProvider(FILE_PROVIDERS.S3, fake('s3'))
    registerStorageProvider(FILE_PROVIDERS.SUPABASE, fake('supabase'))
    return { adapter: supabaseAdapter(), seen }
  }

  it('fileUrl hands the stage\'s stream flag to the row\'s provider: a player streams by default, a still asks to read once', async () => {
    const { adapter, seen } = await adapterWith()
    await adapter.fileUrl({ storage_provider: 's3', storage_path: S3KEY })
    await adapter.fileUrl({ storage_provider: 's3', storage_path: S3KEY }, { stream: false })
    expect(seen.getUrl).toEqual([
      ['s3', S3KEY, 3600, { stream: true }],
      ['s3', S3KEY, 3600, { stream: false }],
    ])
  })

  it('thumbnailUrls with { provider: \'s3\' } asks the s3 provider\'s batch, never Petal\'s bucket', async () => {
    const { adapter, seen } = await adapterWith()
    const map = await adapter.thumbnailUrls([`${S3KEY}.jpg`], { provider: 's3' })
    expect(seen.getUrls).toEqual([['s3', [`${S3KEY}.jpg`]]])
    expect(map.get(`${S3KEY}.jpg`)).toBe(`https://s3.example/${S3KEY}.jpg`)
  })

  it('RabbitProvider passes both options through, unchanged', () => {
    const provider = read('src', 'tools', 'rabbit_v0.1.0', 'state', 'RabbitProvider.jsx')
    expect(provider).toContain('const fileUrl = useCallback(async (file, opts) => {')
    expect(provider).toContain('return adapterRef.current.fileUrl(file, opts);')
    expect(provider).toContain('const thumbnailUrls = useCallback(async (paths, opts) => {')
    expect(provider).toContain('return await adapterRef.current.thumbnailUrls(paths, opts);')
  })
})
