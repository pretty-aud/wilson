// =============================================================================
// uploadReservation.test.js — Track C, bundle C1 (migration 0073).
//
// The client half of the quota reservation: reserve BEFORE tus.Upload.start(),
// refuse to start when the server refuses, release afterwards whatever
// happened, and degrade to the pre-0073 behaviour ONLY when the RPC does not
// exist yet. The server half (the meter, the policy, the sweep) is pgTAP suite
// 77, proven by breakers; nothing here re-tests SQL.
//
// The order test is the one that matters: the whole point of the reservation
// is that the refusal arrives before any byte moves, and a reservation written
// AFTER start would be a green test over the same hole.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('./resumableUpload.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, putResumable: vi.fn(async ({ key }) => ({ key })) }
})

import { putResumable, RESUMABLE_THRESHOLD_BYTES } from './resumableUpload.js'
import { createSupabaseStorageProvider } from './supabaseProvider.js'
import {
  reserveUpload, releaseUpload, isFunctionMissing, nameTheFile, RESERVATION_UNAVAILABLE,
  abandonUpload, releaseStaleUploads, inFlightKeys, ABANDON_REASON_MAX,
} from './uploadReservation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Above the 50 MiB threshold, so the provider takes the resumable branch.
const BIG = { size: RESUMABLE_THRESHOLD_BYTES + 1, type: 'video/quicktime' }
const KEY = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-master.mov'

const OK        = { data: 42,   error: null }
const EXEMPT    = { data: null, error: null }
const MISSING   = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reserve_upload_bytes(p_bytes, p_path) in the schema cache' } }
const REFUSED   = { data: null, error: { code: 'PT402', message: 'Not enough Petal cloud storage for "1-master.mov": it needs 6144 MB, but only 2048 MB of this company\'s 10 GB is left once uploads already in progress are counted. Add a smaller file, or contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.' } }
const RELEASED  = { data: true, error: null }
const ABANDONED = { data: true, error: null }
const STALE     = { data: 2,    error: null }
const NO_0074   = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.abandon_upload_reservation(p_path, p_reason) in the schema cache' } }

function fakeClient({ reserve = OK, release = RELEASED, abandon = ABANDONED, stale = STALE } = {}) {
  const calls = []
  const answer = (which, args) => (typeof which === 'function' ? which(args) : which)
  return {
    calls,
    rpc: vi.fn(async (name, args) => {
      calls.push([name, args])
      if (name === 'reserve_upload_bytes') return answer(reserve, args)
      if (name === 'release_upload_reservation') return answer(release, args)
      if (name === 'abandon_upload_reservation') return answer(abandon, args)
      if (name === 'release_stale_upload_reservations') return answer(stale, args)
      return { data: null, error: { message: `unknown rpc ${name}` } }
    }),
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }
}

let warn
beforeEach(() => {
  inFlightKeys.clear()
  putResumable.mockClear()
  putResumable.mockImplementation(async ({ key }) => ({ key }))
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { warn.mockRestore() })

describe('reserveUpload', () => {
  it('calls the RPC with the key and a whole-number byte count', async () => {
    const client = fakeClient()
    await expect(reserveUpload(client, KEY, 1234.7)).resolves.toEqual({ reserved: true, id: 42 })
    expect(client.calls).toEqual([['reserve_upload_bytes', { p_path: KEY, p_bytes: 1234 }]])
  })

  it('NULL from the server means the path is quota-exempt — nothing reserved, nothing to release', async () => {
    await expect(reserveUpload(fakeClient({ reserve: EXEMPT }), KEY, 5e9))
      .resolves.toEqual({ reserved: false, reason: 'exempt' })
  })

  it('PGRST202 means the migration is not there yet — proceed unreserved, and say so', async () => {
    await expect(reserveUpload(fakeClient({ reserve: MISSING }), KEY, BIG.size))
      .resolves.toEqual({ reserved: false, reason: RESERVATION_UNAVAILABLE })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/0073/)
  })

  it('🚨 a refusal THROWS with the server’s own sentence — the upload never starts', async () => {
    await expect(reserveUpload(fakeClient({ reserve: REFUSED }), KEY, BIG.size))
      .rejects.toThrow(/Not enough Petal cloud storage .* deleted files stay recoverable for 30 days/)
  })

  it('a body with no usable size reserves nothing and calls nothing', async () => {
    const client = fakeClient()
    await expect(reserveUpload(client, KEY, undefined)).resolves.toEqual({ reserved: false, reason: 'no-size' })
    await expect(reserveUpload(client, KEY, 0)).resolves.toEqual({ reserved: false, reason: 'no-size' })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('does not swallow a network failure — no reservation, no upload', async () => {
    const client = fakeClient()
    client.rpc = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(reserveUpload(client, KEY, BIG.size)).rejects.toThrow(/Failed to fetch/)
  })

  // Review round 1: the server names the minted key's leaf ("1-master.mov" here;
  // "1725664000000-My_Clip_1_.mov" in the product). The person dropped a file
  // with a name they know, and that is the name the sentence shows them.
  it('a refusal names the file the person dropped, not the minted key leaf', async () => {
    const client = fakeClient({ reserve: REFUSED })
    await expect(reserveUpload(client, KEY, BIG.size, { displayName: 'My Clip (1).mov' }))
      .rejects.toThrow(/Not enough Petal cloud storage for "My Clip \(1\)\.mov": it needs 6144 MB/)
    // ...and the name is presentation only: the RPC still receives the key.
    expect(client.calls).toEqual([['reserve_upload_bytes', { p_path: KEY, p_bytes: BIG.size }]])
  })

  it('without a display name the server sentence is shown verbatim', async () => {
    await expect(reserveUpload(fakeClient({ reserve: REFUSED }), KEY, BIG.size))
      .rejects.toThrow(/for "1-master.mov": it needs 6144 MB/)
    // ...and a null options argument is an absent one, not a TypeError.
    await expect(reserveUpload(fakeClient({ reserve: REFUSED }), KEY, BIG.size, null))
      .rejects.toThrow(/for "1-master.mov": it needs 6144 MB/)
  })
})

describe('nameTheFile', () => {
  it('replaces only the quoted key leaf', () => {
    expect(nameTheFile('storage for "1-master.mov": it needs 6144 MB', KEY, 'clip.mov'))
      .toBe('storage for "clip.mov": it needs 6144 MB')
  })
  it('leaves a sentence that does not quote the leaf alone (the "used all" form)', () => {
    const full = 'This company has used all 10 GB of its Petal cloud storage (uploads in progress count).'
    expect(nameTheFile(full, KEY, 'clip.mov')).toBe(full)
  })
  it('is a no-op without a usable name', () => {
    expect(nameTheFile('for "1-master.mov"', KEY, '')).toBe('for "1-master.mov"')
    expect(nameTheFile('for "1-master.mov"', KEY, undefined)).toBe('for "1-master.mov"')
    expect(nameTheFile(null, KEY, 'x')).toBe('')
  })
})

describe('releaseUpload', () => {
  it('closes the reservation and reports true', async () => {
    const client = fakeClient()
    await expect(releaseUpload(client, KEY)).resolves.toBe(true)
    expect(client.calls).toEqual([['release_upload_reservation', { p_path: KEY }]])
  })

  it('a server error is reported as false and warned, never thrown', async () => {
    const client = fakeClient({ release: { data: null, error: { message: 'boom' } } })
    await expect(releaseUpload(client, KEY)).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a thrown network error is reported as false and warned, never thrown', async () => {
    const client = fakeClient()
    client.rpc = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(releaseUpload(client, KEY)).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('"nothing to close" is false, not an error', async () => {
    await expect(releaseUpload(fakeClient({ release: { data: false, error: null } }), KEY)).resolves.toBe(false)
  })
})

describe('isFunctionMissing', () => {
  it('recognises PostgREST’s missing-function shape by code or by message', () => {
    expect(isFunctionMissing({ code: 'PGRST202', message: 'x' })).toBe(true)
    expect(isFunctionMissing({ message: 'Could not find the function public.reserve_upload_bytes' })).toBe(true)
  })
  it('does not mistake a refusal for an absence', () => {
    expect(isFunctionMissing(REFUSED.error)).toBe(false)
    expect(isFunctionMissing({ code: '42501', message: 'you cannot write to this project' })).toBe(false)
    expect(isFunctionMissing(null)).toBe(false)
  })
})

describe('the provider: reserve → start → release', () => {
  it('🚨 an over-quota reservation stops the upload BEFORE tus starts', async () => {
    const client = fakeClient({ reserve: REFUSED })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).rejects.toThrow(/upload refused: Not enough Petal cloud storage/)
    expect(putResumable).not.toHaveBeenCalled()
    expect(client.calls.map(c => c[0])).toEqual(['reserve_upload_bytes'])
  })

  it('the refusal names the File the person dropped (its .name), not the key leaf', async () => {
    const client = fakeClient({ reserve: REFUSED })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, { ...BIG, name: 'My Clip (1).mov' }))
      .rejects.toThrow(/for "My Clip \(1\)\.mov": it needs 6144 MB/)
    expect(client.calls[0]).toEqual(['reserve_upload_bytes', { p_path: KEY, p_bytes: BIG.size }])
  })

  it('reserves BEFORE starting and releases AFTER success, in that order', async () => {
    const seq = []
    const client = fakeClient({
      reserve: () => { seq.push('reserve'); return OK },
      release: () => { seq.push('release'); return RELEASED },
    })
    putResumable.mockImplementationOnce(async ({ key }) => { seq.push('start'); return { key } })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).resolves.toEqual({ key: KEY })
    expect(seq).toEqual(['reserve', 'start', 'release'])
    expect(client.calls[0]).toEqual(['reserve_upload_bytes', { p_path: KEY, p_bytes: BIG.size }])
    expect(client.calls[1]).toEqual(['release_upload_reservation', { p_path: KEY }])
    expect(client.calls.map(c => c[0])).not.toContain('abandon_upload_reservation')
    expect(inFlightKeys.has(KEY)).toBe(false)
  })

  it('🚨 ABANDONS on failure — the certificate carries the error — and the failure still propagates (ruling 1)', async () => {
    const client = fakeClient()
    putResumable.mockRejectedValueOnce(new Error('[supabase] resumable upload failed (500): storage-api'))
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).rejects.toThrow(/resumable upload failed \(500\)/)
    expect(client.calls.map(c => c[0])).toEqual(['reserve_upload_bytes', 'abandon_upload_reservation'])
    expect(client.calls[1]).toEqual(['abandon_upload_reservation', {
      p_path: KEY, p_reason: '[supabase] resumable upload failed (500): storage-api',
    }])
    expect(inFlightKeys.has(KEY)).toBe(false)
  })

  it('a thrown non-Error still abandons, with a reason that is never empty', async () => {
    const client = fakeClient()
    putResumable.mockRejectedValueOnce('tus gave up')
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).rejects.toBe('tus gave up')
    expect(client.calls[1]).toEqual(['abandon_upload_reservation', { p_path: KEY, p_reason: 'tus gave up' }])
  })

  it('a failure against a database without 0074 falls back to release (the pre-0074 behaviour)', async () => {
    const client = fakeClient({ abandon: NO_0074 })
    putResumable.mockRejectedValueOnce(new Error('[supabase] resumable upload failed (502): gateway'))
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).rejects.toThrow(/\(502\)/)
    expect(client.calls.map(c => c[0])).toEqual([
      'reserve_upload_bytes', 'abandon_upload_reservation', 'release_upload_reservation',
    ])
  })

  it('a database without 0073 uploads unreserved and never calls release', async () => {
    const client = fakeClient({ reserve: MISSING })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).resolves.toEqual({ key: KEY })
    expect(putResumable).toHaveBeenCalledTimes(1)
    expect(client.calls.map(c => c[0])).toEqual(['reserve_upload_bytes'])
  })

  it('a quota-exempt path (money, manifest) uploads and never calls release', async () => {
    const client = fakeClient({ reserve: EXEMPT })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).resolves.toEqual({ key: KEY })
    expect(client.calls.map(c => c[0])).toEqual(['reserve_upload_bytes'])
  })

  it('a failed release does not fail a successful upload', async () => {
    const client = fakeClient({ release: { data: null, error: { message: 'pooler reset' } } })
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, BIG)).resolves.toEqual({ key: KEY })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a body under the threshold takes the standard path and never touches the RPC', async () => {
    const client = fakeClient()
    const p = createSupabaseStorageProvider(async () => client)
    await expect(p.put(KEY, new Blob(['tiny']))).resolves.toEqual({ key: KEY })
    expect(client.rpc).not.toHaveBeenCalled()
    expect(putResumable).not.toHaveBeenCalled()
  })
})

describe('abandonUpload (0074, ruling 1)', () => {
  it('calls the RPC with the key and the reason, bounded to ABANDON_REASON_MAX', async () => {
    const client = fakeClient()
    const long = 'x'.repeat(ABANDON_REASON_MAX + 50)
    await expect(abandonUpload(client, KEY, long)).resolves.toBe(true)
    expect(client.calls[0][0]).toBe('abandon_upload_reservation')
    expect(client.calls[0][1].p_path).toBe(KEY)
    expect(client.calls[0][1].p_reason).toHaveLength(ABANDON_REASON_MAX)
  })

  it('an empty reason travels as null, never as ""', async () => {
    const client = fakeClient()
    await abandonUpload(client, KEY, '')
    expect(client.calls[0][1].p_reason).toBeNull()
  })

  it('PGRST202 (no 0074 here) falls back to release and says so', async () => {
    const client = fakeClient({ abandon: NO_0074 })
    await expect(abandonUpload(client, KEY, 'x')).resolves.toBe(true)
    expect(client.calls.map(c => c[0])).toEqual(['abandon_upload_reservation', 'release_upload_reservation'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a server error is reported as false and warned, never thrown', async () => {
    const client = fakeClient({ abandon: { data: null, error: { message: 'pooler reset' } } })
    await expect(abandonUpload(client, KEY, 'x')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a thrown network error is reported as false and warned, never thrown', async () => {
    const client = fakeClient({ abandon: () => { throw new TypeError('Failed to fetch') } })
    await expect(abandonUpload(client, KEY, 'x')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('"nothing to close" is false, not an error', async () => {
    const client = fakeClient({ abandon: { data: false, error: null } })
    await expect(abandonUpload(client, KEY, 'x')).resolves.toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('releaseStaleUploads (0074, ruling 2)', () => {
  it('tells the server to KEEP the keys this tab is still uploading, and reports the count', async () => {
    const client = fakeClient()
    await reserveUpload(client, KEY, 1000)
    await expect(releaseStaleUploads(client)).resolves.toBe(2)
    expect(client.calls[1]).toEqual(['release_stale_upload_reservations', { p_keep: [KEY] }])
  })

  it('with nothing in flight the keep list is empty', async () => {
    const client = fakeClient()
    await releaseStaleUploads(client)
    expect(client.calls[0]).toEqual(['release_stale_upload_reservations', { p_keep: [] }])
  })

  it('PGRST202 (no 0074 here) is 0 with NO warning — nothing is wrong', async () => {
    const client = fakeClient({ stale: NO_0074 })
    await expect(releaseStaleUploads(client)).resolves.toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a server error is 0 and warned, never thrown', async () => {
    const client = fakeClient({ stale: { data: null, error: { message: 'pooler reset' } } })
    await expect(releaseStaleUploads(client)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a thrown network error is 0 and warned, never thrown', async () => {
    const client = fakeClient({ stale: () => { throw new TypeError('Failed to fetch') } })
    await expect(releaseStaleUploads(client)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('inFlightKeys — what this tab is uploading', () => {
  it('a reservation adds the key; release and abandon remove it; exempt and unavailable add nothing', async () => {
    const client = fakeClient()
    await reserveUpload(client, KEY, 1000)
    expect(inFlightKeys.has(KEY)).toBe(true)
    await releaseUpload(client, KEY)
    expect(inFlightKeys.has(KEY)).toBe(false)
    await reserveUpload(client, KEY, 1000)
    await abandonUpload(client, KEY, 'x')
    expect(inFlightKeys.has(KEY)).toBe(false)
    await reserveUpload(fakeClient({ reserve: EXEMPT }), 'projects/p/INVOICES/1-a.pdf', 1000)
    await reserveUpload(fakeClient({ reserve: MISSING }), 'projects/p/ASSETS/1-b.mov', 1000)
    expect(inFlightKeys.size).toBe(0)
  })
})

describe('source pins — the call sites exist and sit in the right order', () => {
  // Normalised: the working tree is CRLF under core.autocrlf and CI's is LF;
  // a multi-line pin must read the same in both.
  const read = (...p) => readFileSync(join(__dirname, ...p), 'utf8').replace(/\r\n/g, '\n')
  const provider = read('supabaseProvider.js')
  const gc = read('..', '..', '..', '..', 'supabase', 'functions', 'storage-gc', 'index.ts')
  const teardown = read('..', '..', '..', '..', 'supabase', 'functions', 'operator-workspaces', 'index.ts')
  const fileManager = read('..', 'components', 'FileManager.jsx')
  const storageApi = read('..', '..', '..', 'cloud', 'storageApi.js')

  it('the provider reserves before it starts the resumable upload', () => {
    const reserveAt = provider.indexOf('await reserveUpload(client, key, body?.size, { displayName: body?.name })')
    const startAt   = provider.indexOf('const out = await putResumable({')
    expect(reserveAt).toBeGreaterThan(-1)
    expect(startAt).toBeGreaterThan(reserveAt)
  })

  it('the provider closes in a finally, gated on a reservation: release when landed, abandon otherwise', () => {
    expect(provider).toMatch(
      /finally \{\s*if \(reservation\.reserved\) \{\s*if \(landed\) await releaseUpload\(client, key\)\s*else await abandonUpload\(client, key, /,
    )
  })

  it('FileManager releases stale reservations when Files opens on the Supabase backend (ruling 2)', () => {
    const at = fileManager.indexOf("if (ctx?.adapterMode !== 'supabase') return\n    releaseStaleUploadReservations().catch(() => {})")
    expect(at).toBeGreaterThan(-1)
    expect(fileManager.slice(0, at)).toMatch(/useEffect\(\(\) => \{\s*$/)
    expect(fileManager).toContain("import { releaseStaleUploadReservations } from '../../../cloud/storageApi'")
    expect(storageApi).toContain('export function releaseStaleUploadReservations()')
    expect(storageApi).toContain('return releaseStaleUploads(supabase)')
  })

  it('teardown sweeps open reservations and lists avatars BEFORE the CASCADE, and certifies both', () => {
    const sweepAt   = teardown.indexOf(".rpc('sweep_open_uploads', { p_workspace_id: workspaceId })")
    const avatarsAt = teardown.indexOf('await collectAvatarPaths(ctx, workspaceId)')
    const removeAt  = teardown.indexOf('ctx.admin.storage.from(AVATAR_BUCKET).remove(batch)')
    const cascadeAt = teardown.indexOf(".from('workspaces')\n      .delete()")
    expect(sweepAt).toBeGreaterThan(-1)
    expect(avatarsAt).toBeGreaterThan(-1)
    expect(removeAt).toBeGreaterThan(avatarsAt)
    expect(cascadeAt).toBeGreaterThan(Math.max(sweepAt, removeAt))
    expect(teardown).toContain("const AVATAR_BUCKET = 'user-avatars'")
    // The flag starts true and only an answer clears it (storage-gc's lesson).
    expect(teardown).toContain('let reservationSweepFailed = true')
    for (const field of [
      'avatars_found', 'avatars_removed', 'avatars_failed', 'avatars_truncated',
      'reservations_abandoned', 'reservations_completed', 'reservation_sweep_failed', 'thumbnails_note',
    ]) expect(teardown).toContain(`${field}:`)
    expect(teardown).toContain("code: 'WIL-7009'")
  })

  it('storage-gc drives the sweep per workspace and reports a failed RPC rather than hiding it', () => {
    expect(gc).toContain(".rpc('sweep_abandoned_uploads', { p_workspace_id: ctx.workspaceId })")
    expect(gc).toContain('reservation_sweep_failed = true')
    expect(gc).toContain('reservations_abandoned')
  })
})
