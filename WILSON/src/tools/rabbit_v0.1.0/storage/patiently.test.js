import { describe, it, expect, vi } from 'vitest'
import { patiently } from './patiently'

const fails = (status) => Object.assign(new Error('no'), { status })
const opts = (at = 0) => ({ wait: vi.fn(async () => {}), now: () => at })

describe('patiently: one more try, for what passes (MO1, 0120)', () => {
  it('an answer is returned, with no wait', async () => {
    const o = opts()
    expect(await patiently(async () => 'yes', o)).toBe('yes')
    expect(o.wait).not.toHaveBeenCalled()
  })
  it('🚨 a 429 waits out the window of a clock minute, then tries again', async () => {
    const o = opts(125_000)
    const fn = vi.fn().mockRejectedValueOnce(fails(429)).mockResolvedValueOnce('yes')
    expect(await patiently(fn, o)).toBe('yes')
    expect(o.wait).toHaveBeenCalledWith(55_500)
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it.each([0, 500, 502, 503])('a %i waits a moment, then tries again', async (status) => {
    const o = opts()
    const fn = vi.fn().mockRejectedValueOnce(fails(status)).mockResolvedValueOnce('yes')
    expect(await patiently(fn, o)).toBe('yes')
    expect(o.wait).toHaveBeenCalledWith(2_000)
  })
  it.each([400, 401, 403, 404, 409, undefined])('🚨 a %s is an answer: no wait, no second try', async (status) => {
    const o = opts()
    const fn = vi.fn().mockRejectedValue(fails(status))
    await expect(patiently(fn, o)).rejects.toThrow('no')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(o.wait).not.toHaveBeenCalled()
  })
  it('one more try means one: the second failure is the answer', async () => {
    const fn = vi.fn().mockRejectedValue(fails(429))
    await expect(patiently(fn, opts())).rejects.toThrow('no')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
