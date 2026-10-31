// =============================================================================
// aiFileCache.test.js — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03).
//
// What D.O.G. holds in the AI provider's file store, and when it lets go:
// the pure cache (./aiFileCache.js), the TTL against the sweep's age and the
// store's own expiry, the dead-reference retry, and — by SOURCE PIN, the only
// instrument for logic inside a 5,400-line component's hooks (the
// deckAttachmentSource.test.js arrangement, CRLF normalised) — that D.O.G.
// lets go when a file or reference leaves, never after a generation.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  AI_FILE_TTL_MS, ownerOf, liveOwners, createAIFileCache, deadFileIds, retryWithLiveFiles,
} from './aiFileCache'
import { SWEEP_AGE_HOURS } from '../../../supabase/functions/_shared/aiFileStore.ts'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
const { UPLOAD_EXPIRY_SECONDS } = await import('../../cloud/aiFiles.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'DeckOutlineGenerator.jsx'), 'utf8').replace(/\r\n/g, '\n')
const fid = (n) => `file_011Test${String(n).padStart(12, '0')}`
const T0 = Date.parse('2026-10-25T09:00:00Z')

describe('the TTL is shorter than everything that takes a file away', () => {
  it('shorter than the sweep\'s age and the store\'s expiry, with hours to spare for a long deck', () => {
    expect(AI_FILE_TTL_MS).toBeLessThan(SWEEP_AGE_HOURS * 3600 * 1000)
    expect(AI_FILE_TTL_MS).toBeLessThan(UPLOAD_EXPIRY_SECONDS * 1000)
    expect(SWEEP_AGE_HOURS * 3600 * 1000 - AI_FILE_TTL_MS).toBeGreaterThanOrEqual(2 * 3600 * 1000)
  })
})

describe('owners', () => {
  it('an upload, a chosen reference, the references\' own text', () => {
    expect(ownerOf({ id: 'u1', type: 'pdf' })).toBe('upload:u1')
    expect(ownerOf({ id: 'file-9', refKey: 'file:9', source: 'stored' })).toBe('ref:file:9')
    expect(ownerOf({ id: 'dog-references', source: 'references' })).toBe('generation')
  })
  it('the live set is the picker and the References set, nothing else', () => {
    expect([...liveOwners([{ id: 'u1' }, { id: 'u2' }], new Set(['file:9']))].sort()).toEqual(['ref:file:9', 'upload:u1', 'upload:u2'])
    expect(liveOwners([], new Set()).has('generation')).toBe(false)
  })
})

describe('the cache', () => {
  it('a fresh entry answers its id; the same content under a second owner joins it', () => {
    const c = createAIFileCache()
    c.set('k1', fid(1), 'upload:u1', T0)
    expect(c.get('k1', T0 + 1000)).toEqual({ id: fid(1) })
    c.addOwner('k1', 'ref:file:9')
    // The upload goes, the reference stays: the id stays.
    expect(c.release(new Set(['ref:file:9']))).toEqual([])
    expect(c.get('k1', T0 + 2000)).toEqual({ id: fid(1) })
  })
  it('CONTROL: when no owner is live the id is let go of, once', () => {
    const c = createAIFileCache()
    c.set('k1', fid(1), 'upload:u1', T0)
    c.addOwner('k1', 'ref:file:9')
    expect(c.release(new Set())).toEqual([fid(1)])
    expect(c.release(new Set())).toEqual([])
    expect(c.get('k1', T0)).toBe(null)
  })
  it('the references\' own text is let go of at the first release (its owner is never live)', () => {
    const c = createAIFileCache()
    c.set(`once:${fid(2)}`, fid(2), 'generation', T0)
    c.set('k1', fid(1), 'upload:u1', T0)
    expect(c.release(liveOwners([{ id: 'u1' }], []))).toEqual([fid(2)])
  })
  it(`past its TTL an entry is dropped and its id handed back to let go of`, () => {
    const c = createAIFileCache()
    c.set('k1', fid(1), 'upload:u1', T0)
    expect(c.get('k1', T0 + AI_FILE_TTL_MS - 1)).toEqual({ id: fid(1) })
    expect(c.get('k1', T0 + AI_FILE_TTL_MS)).toEqual({ expired: fid(1) })
    expect(c.get('k1', T0 + AI_FILE_TTL_MS)).toBe(null)
  })
  it('a second upload of the same content hands back the first id to let go of', () => {
    const c = createAIFileCache()
    expect(c.set('k1', fid(1), 'upload:u1', T0)).toBe(null)
    expect(c.set('k1', fid(2), 'upload:u1', T0)).toBe(fid(1))
    expect(c.set('k1', fid(2), 'upload:u1', T0)).toBe(null)
  })
  it('forgetId and takeAll', () => {
    const c = createAIFileCache()
    c.set('k1', fid(1), 'upload:u1', T0)
    c.set('k2', fid(2), 'upload:u2', T0)
    expect(c.forgetId(fid(1))).toBe(true)
    expect(c.forgetId(fid(1))).toBe(false)
    expect(c.takeAll()).toEqual([fid(2)])
    expect(c.size).toBe(0)
    expect(c.takeAll()).toEqual([])
  })
})

describe('deadFileIds: the store\'s answer to a gone file, as measured', () => {
  const ids = [fid(1), fid(2)]
  it('400 or 404 naming an id of this call: that id', () => {
    expect(deadFileIds({ status: 404, message: `File \`${fid(1)}\` not found.` }, ids)).toEqual([fid(1)])
    expect(deadFileIds({ status: 400, message: `file_id ${fid(2)} does not exist` }, ids)).toEqual([fid(2)])
  })
  it('CONTROL: a 400 about something else, or a 5xx/429 naming the id, is not a gone file', () => {
    expect(deadFileIds({ status: 400, message: 'max_tokens too large' }, ids)).toEqual([])
    expect(deadFileIds({ status: 500, message: `boom ${fid(1)}` }, ids)).toEqual([])
    expect(deadFileIds({ status: 429, message: `slow ${fid(1)}` }, ids)).toEqual([])
    expect(deadFileIds(null, ids)).toEqual([])
  })
})

describe('retryWithLiveFiles', () => {
  const parts = () => [
    { type: 'document', source: { type: 'file', file_id: fid(1) } },
    { type: 'image', source: { type: 'file', file_id: fid(2) } },
    { type: 'text', text: 'prompt' },
  ]
  const gone = (id) => Object.assign(new Error(`File \`${id}\` not found.`), { status: 404 })

  it('uploads the gone file again, points every part at the new id, and calls once more', async () => {
    const contentParts = parts()
    const live = { contentParts, fileSources: new Map([[fid(1), { id: 'u1' }], [fid(2), { id: 'u2' }]]), retried: false }
    const seen = []
    const call = vi.fn(async () => {
      seen.push(contentParts.map(p => p.source?.file_id))
      if (call.mock.calls.length === 1) throw gone(fid(1))
      return 'ok'
    })
    const reupload = vi.fn(async () => fid(7))
    const forget = vi.fn()
    expect(await retryWithLiveFiles(call, live, { reupload, forget })).toBe('ok')
    expect(reupload).toHaveBeenCalledWith({ id: 'u1' })
    expect(forget).toHaveBeenCalledWith(fid(1))
    expect(seen).toEqual([[fid(1), fid(2), undefined], [fid(7), fid(2), undefined]])
    expect([...live.fileSources.keys()].sort()).toEqual([fid(2), fid(7)])
    expect(live.retried).toBe(true)
  })
  it('CONTROL: once per generation — a second gone file in the same loop is the person\'s to see', async () => {
    const live = { contentParts: parts(), fileSources: new Map([[fid(1), {}], [fid(2), {}]]), retried: true }
    const call = vi.fn(async () => { throw gone(fid(2)) })
    const reupload = vi.fn()
    await expect(retryWithLiveFiles(call, live, { reupload, forget: () => {} })).rejects.toThrow('not found')
    expect(reupload).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('CONTROL: any other failure is thrown as it came, with no upload', async () => {
    const live = { contentParts: parts(), fileSources: new Map([[fid(1), {}]]), retried: false }
    const boom = Object.assign(new Error('Overloaded'), { status: 529 })
    const reupload = vi.fn()
    await expect(retryWithLiveFiles(async () => { throw boom }, live, { reupload, forget: () => {} })).rejects.toBe(boom)
    expect(reupload).not.toHaveBeenCalled()
    expect(live.retried).toBe(false)
  })
})

// ── D.O.G. itself, by source pin ─────────────────────────────────────────────

describe('D.O.G. lets go when a file or reference leaves, and never after a generation', () => {
  const at = (s) => SRC.indexOf(s)
  const firstGenerator = at('const generatePageOutline = useCallback')

  // DG4: the owners are what is LISTED (refs.listedKeys: the chosen set, or
  // the project's Core files while Core files only is ticked), so a Core file
  // a generation sent is kept for the next Regenerate. The rendered D.O.G.
  // pins the behaviour (enterKey.render.test.jsx, DG4's let-go case).
  it('one effect releases what no upload or listed reference owns, and stands down while a generation runs', () => {
    expect(SRC).toMatch(/const generationBusy = isGenerating \|\| isRegenerating;/)
    expect(SRC).toMatch(/useEffect\(\(\) => \{\n {4}if \(generationBusy\) return;\n {4}letGoOfAIFiles\(aiFileIdCache\.current\.release\(liveOwners\(uploadedFiles, refs\.listedKeys\)\)\);\n {2}\}, \[generationBusy, uploadedFiles, refs\.listedKeys, letGoOfAIFiles\]\);/)
  })
  it('the app\'s close and a sign-out reach the cache (holdAIFiles)', () => {
    expect(SRC).toMatch(/useEffect\(\(\) => holdAIFiles\(\(\) => aiFileIdCache\.current\.takeAll\(\)\), \[\]\);/)
  })
  it('nothing deletes an AI file after a generation: every let-go sits in the cache\'s own section', () => {
    expect(firstGenerator).toBeGreaterThan(-1)
    const after = SRC.slice(firstGenerator)
    expect(after).not.toMatch(/letGoOfAIFiles\(|deleteAIFiles\(|releaseAllAIFiles\(|\.takeAll\(\)|\.release\(/)
  })
  it('all three generators\' calls go through the dead-reference retry, and the full deck shares one', () => {
    expect(SRC.split('callWithLiveFiles(() => callAI({').length - 1).toBe(3)
    expect(SRC).toMatch(/const liveFiles = \{ contentParts, fileSources, retried: false \};/)
    expect(SRC).toMatch(/\}\), liveFiles\);/)
  })
  it('an expired entry is uploaded again rather than referenced, and its old id let go of', () => {
    const fn = SRC.slice(at('const ensureAIFileId = useCallback'), at('const callWithLiveFiles'))
    expect(fn).toMatch(/aiFileIdCache\.current\.get\(key, Date\.now\(\)\)/)
    expect(fn).toMatch(/if \(hit\?\.expired\) letGoOfAIFiles\(\[hit\.expired\]\);/)
    expect(fn).toMatch(/aiFileIdCache\.current\.set\(key \?\? `once:\$\{uploaded\.id\}`, uploaded\.id, owner, Date\.now\(\)\)/)
  })
})
