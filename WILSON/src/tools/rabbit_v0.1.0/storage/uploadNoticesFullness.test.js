// uploadNoticesFullness.test.js — MO1 (her integration answer 3, verbatim "Full or nearly full"): a member's storage
// notice says only that, with no amounts. The total holds people's personal files, so the figures are an admin's.
import { describe, it, expect, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ answer: null }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: { rpc: async () => rpc.answer } }))

const { classifyUpload, summarizeBatch, NEARLY_FULL_NOTICE } = await import('./uploadNotices.js')
const { fetchStorageUsage } = await import('../../../cloud/workspaceStorage')

const file = (size = 10) => ({ name: 'clip.mov', size, type: 'video/quicktime' })
const judge = (storagePlan, size) => classifyUpload(file(size), { workspaceProvider: 'petal', storagePlan })
const member = (fullness) => ({ usedBytes: null, quotaBytes: null, status: 'active', hasPlan: true, fullness })

describe('what a member is told', () => {
  it('🚨 a full company refuses, with no amount in the sentence', () => {
    const out = judge(member('full'))
    expect(out.blocked).toBe(true)
    expect(out.code).toBe('over_quota')
    expect(out.message).toMatch(/full/)
    expect(out.message).not.toMatch(/[0-9] ?(B|KB|MB|GB|TB)\b/)
    expect(out.message).toMatch(/deleted files stay recoverable/)
  })
  it('🚨 no figures is not nothing used: nearly full and ok refuse nothing', () => {
    expect(judge(member('nearly_full'), 10 ** 6).blocked).toBe(false)
    expect(judge(member('ok'), 10 ** 6).blocked).toBe(false)
  })
  it('nearly full is said once for a batch, and names no amount', () => {
    expect(judge(member('nearly_full')).notes.filter((n) => n.code === 'nearly_full').length).toBe(1)
    expect(judge(member('ok')).notes.filter((n) => n.code === 'nearly_full').length).toBe(0)
    expect(NEARLY_FULL_NOTICE).not.toMatch(/[0-9]/)
    const said = summarizeBatch([{ code: 'nearly_full' }, { code: 'nearly_full' }, { code: 'slow' }])
    expect(said.split(NEARLY_FULL_NOTICE).length).toBe(2)
  })
})

describe('what an admin is told', () => {
  const admin = { usedBytes: 90, quotaBytes: 100, status: 'active', hasPlan: true, fullness: 'nearly_full' }
  it('the figures, as ever', () => {
    const out = judge(admin, 50)
    expect(out.blocked).toBe(true)
    expect(out.message).toMatch(/Not enough Petal cloud storage/)
    expect(judge(admin, 5).blocked).toBe(false)
  })
  it('no notice of its own: the Admin Terminal says it once', () => {
    expect(judge(admin, 5).notes.filter((n) => n.code === 'nearly_full').length).toBe(0)
  })
})

describe('reading it', () => {
  it('🚨 a figure the server did not give stays absent, and is not read as nothing used', async () => {
    rpc.answer = { data: [{ used_bytes: null, quota_bytes: null, status: 'active', has_plan: true, fullness: 'full' }], error: null }
    expect(await fetchStorageUsage()).toEqual({ usedBytes: null, quotaBytes: null, status: 'active', hasPlan: true, fullness: 'full' })
  })
  it('an admin\'s figures are numbers', async () => {
    rpc.answer = { data: [{ used_bytes: '5', quota_bytes: '10', status: 'active', has_plan: false, fullness: 'ok' }], error: null }
    expect(await fetchStorageUsage()).toEqual({ usedBytes: 5, quotaBytes: 10, status: 'active', hasPlan: false, fullness: 'ok' })
  })
  it('a database before this answers the old shape', async () => {
    rpc.answer = { data: [{ used_bytes: '5', quota_bytes: '10', status: 'active', has_plan: false }], error: null }
    expect((await fetchStorageUsage()).fullness).toBe('ok')
  })
})

describe('round 2: a member whose file does not fit', () => {
  const failing = (message) => async () => ({ storage: { from: () => ({ upload: async () => ({ error: { message } }) }) } })
  it('🚨 reads why, not row security, when the company has little room left', async () => {
    rpc.answer = { data: [{ fullness: 'nearly_full', status: 'active', has_plan: true }], error: null }
    const { createSupabaseStorageProvider } = await import('./supabaseProvider.js')
    const p = createSupabaseStorageProvider(failing('new row violates row-level security policy'))
    await expect(p.put('k', new Blob(['x']), { name: 'x.pdf' })).rejects.toThrow(/There is not enough Petal cloud storage left/)
  })
  it('a company with room keeps the real answer: this is some other refusal', async () => {
    rpc.answer = { data: [{ fullness: 'ok', status: 'active', has_plan: true }], error: null }
    const { createSupabaseStorageProvider } = await import('./supabaseProvider.js')
    const p = createSupabaseStorageProvider(failing('new row violates row-level security policy'))
    await expect(p.put('k', new Blob(['x']), {})).rejects.toThrow(/row-level security/)
  })
  it('another error is not asked about', async () => {
    rpc.answer = { data: [{ fullness: 'full' }], error: null }
    const { createSupabaseStorageProvider } = await import('./supabaseProvider.js')
    const p = createSupabaseStorageProvider(failing('the bucket is gone'))
    await expect(p.put('k', new Blob(['x']), {})).rejects.toThrow(/the bucket is gone/)
  })
})
