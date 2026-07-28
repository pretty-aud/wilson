// Vitest — noteSync helpers (Session 8).
// The saver loop is the load-bearing piece: a missed version guard must
// merge the remote snapshot BEFORE retrying, and the loop must be bounded.

import { describe, it, expect, vi } from 'vitest'
import { u8ToB64, b64ToU8, saveWithMerge, toPreview } from './noteSync'

describe('base64 codecs', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255, 42, 0])
    expect(b64ToU8(u8ToB64(bytes))).toEqual(bytes)
  })

  it('round-trips large buffers across the chunk boundary', () => {
    const big = new Uint8Array(0x8000 * 3 + 7)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    expect(b64ToU8(u8ToB64(big))).toEqual(big)
  })

  it('handles the empty buffer', () => {
    expect(b64ToU8(u8ToB64(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })
})

describe('saveWithMerge', () => {
  it('saves first try with no conflict', async () => {
    const save = vi.fn().mockResolvedValue({ version: 4 })
    const fetchRemote = vi.fn()
    const applyRemote = vi.fn()
    const res = await saveWithMerge({
      encode: () => 'AAA=', save, fetchRemote, applyRemote, expectedVersion: 3,
    })
    expect(res).toEqual({ version: 4, conflicts: 0 })
    expect(save).toHaveBeenCalledWith('AAA=', 3)
    expect(fetchRemote).not.toHaveBeenCalled()
    expect(applyRemote).not.toHaveBeenCalled()
  })

  it('merges the remote snapshot and retries with the fresh version on a miss', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce(null)                 // guard missed
      .mockResolvedValueOnce({ version: 8 })       // retry lands
    const fetchRemote = vi.fn().mockResolvedValue({ ydocState: 'UkVN', version: 7 })
    const applyRemote = vi.fn()
    const encoded = ['bG9jYWw=', 'bWVyZ2Vk']
    let call = 0
    const res = await saveWithMerge({
      encode: () => encoded[Math.min(call++, 1)],
      save, fetchRemote, applyRemote, expectedVersion: 3,
    })
    expect(res).toEqual({ version: 8, conflicts: 1 })
    // The merge MUST happen before the retry, and the retry must carry the
    // remote's version — that ordering is the whole no-clobber guarantee.
    expect(applyRemote).toHaveBeenCalledWith('UkVN')
    expect(save).toHaveBeenNthCalledWith(2, 'bWVyZ2Vk', 7)
  })

  it('tolerates a remote row with an empty snapshot', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 2 })
    const fetchRemote = vi.fn().mockResolvedValue({ ydocState: null, version: 1 })
    const applyRemote = vi.fn()
    const res = await saveWithMerge({
      encode: () => 'AA==', save, fetchRemote, applyRemote, expectedVersion: 0,
    })
    expect(res.version).toBe(2)
    expect(applyRemote).not.toHaveBeenCalled()
  })

  it('throws when the row vanished', async () => {
    const save = vi.fn().mockResolvedValue(null)
    const fetchRemote = vi.fn().mockResolvedValue(null)
    await expect(saveWithMerge({
      encode: () => 'AA==', save, fetchRemote, applyRemote: vi.fn(), expectedVersion: 0,
    })).rejects.toThrow('row no longer exists')
  })

  it('bounds the retry loop', async () => {
    const save = vi.fn().mockResolvedValue(null) // never lands
    const fetchRemote = vi.fn().mockResolvedValue({ ydocState: 'AA==', version: 9 })
    await expect(saveWithMerge({
      encode: () => 'AA==', save, fetchRemote, applyRemote: vi.fn(),
      expectedVersion: 0, maxAttempts: 3,
    })).rejects.toThrow('too many version conflicts')
    expect(save).toHaveBeenCalledTimes(3)
  })
})

describe('toPreview', () => {
  it('collapses whitespace and trims', () => {
    expect(toPreview('  a\n\nb\tc  ')).toBe('a b c')
  })
  it('bounds length with an ellipsis', () => {
    const out = toPreview('x'.repeat(500), 300)
    expect(out.length).toBe(300)
    expect(out.endsWith('…')).toBe(true)
  })
  it('handles null', () => {
    expect(toPreview(null)).toBe('')
  })
})
