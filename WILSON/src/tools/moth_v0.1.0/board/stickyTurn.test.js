// stickyTurn.test.js — MO4: a sticky's turns against an adapter answering as 0133's functions do.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStickyTurns, TURN_WORDS } from './stickyTurn.js'

const BOARD = 'b0000000-0000-4000-8000-000000000001'
const SESSION = 'window-0001'
const STICKY = { id: 'st-1', kind: 'sticky', file: { id: 'file-1', name: 'note.md', project_id: 'p1' } }

function fakeAdapter() {
  let generation = 100
  return {
    claimSticky: vi.fn(async () => ({ granted: true, generation: ++generation, ends_in_ms: 30000 })),
    renewSticky: vi.fn(async () => ({ ok: true, ends_in_ms: 30000 })),
    releaseSticky: vi.fn(async () => true),
    stickyStatus: vi.fn(async () => []),
    saveStickyText: vi.fn(async () => ({ ok: true })),
  }
}

function turns(over = {}) {
  const adapter = over.adapter ?? fakeAdapter()
  const changes = []
  const target = new EventTarget()
  const t = createStickyTurns({ adapter, boardId: BOARD, sessionId: SESSION, onChange: (e) => changes.push(e), target, ...over })
  return { adapter, changes, target, t }
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('stickyTurn: this window\'s turn', () => {
  it('focus claims the turn, it is kept every ten seconds, and blur lets it go', async () => {
    const { adapter, t } = turns()
    expect(await t.begin('st-1')).toEqual({ granted: true, holderLabel: null })
    expect(adapter.claimSticky).toHaveBeenCalledWith('st-1', SESSION)
    expect(t.glow().get('st-1')).toMatchObject({ mine: true })
    await vi.advanceTimersByTimeAsync(10000)
    expect(adapter.renewSticky).toHaveBeenCalledWith('st-1', 101)
    await vi.advanceTimersByTimeAsync(10000)
    expect(adapter.renewSticky).toHaveBeenCalledTimes(2)
    await t.end('st-1')
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-1', 101)
    expect(t.glow().has('st-1')).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(adapter.renewSticky).toHaveBeenCalledTimes(2)
  })

  it('a turn someone else holds is refused with their name, for the glow, which fades when it ends', async () => {
    const adapter = fakeAdapter()
    adapter.claimSticky.mockResolvedValueOnce({ granted: false, holder_label: 'Theo Lindqvist', ends_in_ms: 12000 })
    const { t, changes } = turns({ adapter })
    expect(await t.begin('st-1')).toEqual({ granted: false, holderLabel: 'Theo Lindqvist' })
    expect(t.glow().get('st-1')).toMatchObject({ holderLabel: 'Theo Lindqvist', mine: false })
    expect(t.glow().get('st-1').endsAt).toBe(Date.now() + 12000)
    await vi.advanceTimersByTimeAsync(12000)
    expect(t.glow().has('st-1')).toBe(false)
    expect(changes.at(-1)).toEqual({ type: 'glow' })
    expect(adapter.renewSticky).not.toHaveBeenCalled()
  })

  it('a claim that fails says so, and holds nothing', async () => {
    const adapter = fakeAdapter()
    adapter.claimSticky.mockRejectedValueOnce(Object.assign(new Error('[supabase] sticky not found or not writable'), { code: '42501' }))
    const { t } = turns({ adapter })
    expect(await t.begin('st-1')).toEqual({ granted: false, holderLabel: null, words: 'sticky not found or not writable' })
    expect(t.glow().size).toBe(0)
  })

  it('a blur before the claim\'s answer gives the turn straight back', async () => {
    const adapter = fakeAdapter()
    const answer = deferred()
    adapter.claimSticky.mockReturnValueOnce(answer.promise)
    const { t } = turns({ adapter })
    const began = t.begin('st-1')
    const ended = t.end('st-1')
    answer.resolve({ granted: true, generation: 7, ends_in_ms: 30000 })
    expect(await began).toEqual({ granted: false, holderLabel: null })
    await ended
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-1', 7)
    expect(t.glow().size).toBe(0)
  })

  it('a session id the server would refuse is replaced by one it takes', () => {
    const { t } = turns({ sessionId: 'bad id!' })
    expect(t.sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(turns().t.sessionId).toBe(SESSION)
  })
})

describe('stickyTurn: saving words', () => {
  it('a save goes through saveStickyText with the turn\'s number', async () => {
    const { adapter, t } = turns()
    await t.begin('st-1')
    expect(await t.save(STICKY, '# Shot ideas')).toEqual({ ok: true, words: null })
    expect(adapter.saveStickyText).toHaveBeenCalledWith(STICKY, 101, '# Shot ideas')
  })

  it('a turn that ended keeps the words and says so', async () => {
    const adapter = fakeAdapter()
    const words = 'Someone else is writing in this sticky now, or your turn ended: your words were not saved.'
    adapter.saveStickyText.mockResolvedValueOnce({ ok: false, reason: 'turn_ended', words })
    const { t, changes } = turns({ adapter })
    await t.begin('st-1')
    expect(await t.save(STICKY, 'kept on screen')).toEqual({ ok: false, words, reason: 'turn_ended' })
    expect(changes).toContainEqual({ type: 'ended', elementId: 'st-1', words })
    expect(await t.save(STICKY, 'again')).toEqual({ ok: false, words: TURN_WORDS.ended, reason: 'turn_ended' })
    expect(adapter.saveStickyText).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20000)
    expect(adapter.renewSticky).not.toHaveBeenCalled()
  })

  it('words that moved under the save are not saved, and said', async () => {
    const adapter = fakeAdapter()
    adapter.saveStickyText.mockResolvedValueOnce({ ok: false, reason: 'moved', words: '' })
    const { t } = turns({ adapter })
    await t.begin('st-1')
    expect(await t.save(STICKY, 'x')).toEqual({ ok: false, words: TURN_WORDS.moved, reason: 'moved' })
    expect(t.glow().get('st-1').mine).toBe(true)
  })

  it('saves go one at a time, and only the latest waits', async () => {
    const adapter = fakeAdapter()
    const first = deferred()
    adapter.saveStickyText.mockReturnValueOnce(first.promise)
    const { t } = turns({ adapter })
    await t.begin('st-1')
    const a = t.save(STICKY, 'a')
    const b = t.save(STICKY, 'ab')
    const c = t.save(STICKY, 'abc')
    expect(b).toBe(c)
    first.resolve({ ok: true })
    expect(await a).toEqual({ ok: true, words: null })
    expect(await c).toEqual({ ok: true, words: null })
    expect(adapter.saveStickyText.mock.calls.map((call) => call[2])).toEqual(['a', 'abc'])
  })

  it('blur lets go only after the last words reached the file', async () => {
    const adapter = fakeAdapter()
    const saving = deferred()
    adapter.saveStickyText.mockReturnValueOnce(saving.promise)
    const { t } = turns({ adapter })
    await t.begin('st-1')
    t.save(STICKY, 'last words')
    const ended = t.end('st-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.releaseSticky).not.toHaveBeenCalled()
    saving.resolve({ ok: true })
    await ended
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-1', 101)
  })

  it('a renewal refused ends the turn and says so', async () => {
    const adapter = fakeAdapter()
    adapter.renewSticky.mockResolvedValueOnce({ ok: false, ends_in_ms: 0 })
    const { t, changes } = turns({ adapter })
    await t.begin('st-1')
    await vi.advanceTimersByTimeAsync(10000)
    expect(changes).toContainEqual({ type: 'ended', elementId: 'st-1', words: TURN_WORDS.ended })
    expect(t.glow().has('st-1')).toBe(false)
    expect((await t.save(STICKY, 'still here')).ok).toBe(false)
  })

  it('a renewal not heard keeps the turn until its end has passed', async () => {
    const adapter = fakeAdapter()
    adapter.renewSticky.mockRejectedValue(new TypeError('Failed to fetch'))
    const { t, changes } = turns({ adapter })
    await t.begin('st-1')
    await vi.advanceTimersByTimeAsync(20000)
    expect(changes.some((e) => e.type === 'ended')).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(changes.some((e) => e.type === 'ended')).toBe(true)
  })
})

describe('stickyTurn: the glow of every sticky', () => {
  it('lock, renew, unlock and body messages', async () => {
    const { t, changes } = turns()
    t.applyMessage({ board: BOARD, op: 'lock', element: 'st-2', holder_label: 'Priya Raman', ends_in_ms: 30000 })
    expect(t.glow().get('st-2')).toEqual({ holderLabel: 'Priya Raman', endsAt: Date.now() + 30000, mine: false })
    await vi.advanceTimersByTimeAsync(20000)
    t.applyMessage({ board: BOARD, op: 'renew', element: 'st-2', holder_label: 'Priya Raman', ends_in_ms: 30000 })
    await vi.advanceTimersByTimeAsync(20000)
    expect(t.glow().has('st-2')).toBe(true)
    t.applyMessage({ board: BOARD, op: 'unlock', element: 'st-2' })
    expect(t.glow().has('st-2')).toBe(false)
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-2' })
    expect(changes.at(-1)).toEqual({ type: 'body', elementId: 'st-2', mine: false })
    t.applyMessage({ board: 'another', op: 'lock', element: 'st-3', holder_label: 'Theo Lindqvist', ends_in_ms: 30000 })
    expect(t.glow().has('st-3')).toBe(false)
  })

  it('our own claim\'s message names us; an unlock heard while we hold it is an old one', async () => {
    const { t } = turns()
    await t.begin('st-1')
    t.applyMessage({ board: BOARD, op: 'lock', element: 'st-1', holder_label: 'Mara Okonkwo', ends_in_ms: 30000 })
    expect(t.glow().get('st-1')).toMatchObject({ holderLabel: 'Mara Okonkwo', mine: true })
    t.applyMessage({ board: BOARD, op: 'unlock', element: 'st-1' })
    expect(t.glow().get('st-1').mine).toBe(true)
  })

  it('a claim heard long after ours asks at once whether the turn is still ours', async () => {
    const adapter = fakeAdapter()
    const { t } = turns({ adapter })
    await t.begin('st-1')
    await vi.advanceTimersByTimeAsync(5000)
    adapter.renewSticky.mockResolvedValueOnce({ ok: false, ends_in_ms: 0 })
    t.applyMessage({ board: BOARD, op: 'lock', element: 'st-1', holder_label: 'Theo Lindqvist', ends_in_ms: 30000 })
    expect(adapter.renewSticky).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.glow().get('st-1')).toMatchObject({ holderLabel: 'Theo Lindqvist', mine: false })
  })

  it('refresh reads every live turn on the board', async () => {
    const adapter = fakeAdapter()
    adapter.stickyStatus.mockResolvedValueOnce([
      { element: 'st-2', holder_label: 'Theo Lindqvist', mine: false, ends_in_ms: 8000 },
      { element: 'st-4', holder_label: 'Mara Okonkwo', mine: true, ends_in_ms: 20000 },
    ])
    const { t } = turns({ adapter })
    await t.begin('st-1')
    await t.refresh()
    expect(adapter.stickyStatus).toHaveBeenCalledWith(BOARD)
    const g = t.glow()
    expect([...g.keys()].sort()).toEqual(['st-1', 'st-2', 'st-4'])
    expect(g.get('st-2')).toMatchObject({ holderLabel: 'Theo Lindqvist', mine: false })
    expect(g.get('st-4')).toMatchObject({ holderLabel: 'Mara Okonkwo', mine: false })
    expect(g.get('st-1').mine).toBe(true)
    await vi.advanceTimersByTimeAsync(8000)
    expect(t.glow().has('st-2')).toBe(false)
  })
})

describe('🚨 stickyTurn: subscribers hear what onChange hears', () => {
  it('another person\'s words saved is heard at once, so the canvas reads them again; our own is said as ours', async () => {
    const { t, changes } = turns()
    const heard = []
    const off = t.subscribe((e) => heard.push(e))
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-2' })
    expect(heard).toEqual([{ type: 'body', elementId: 'st-2', mine: false }])
    await t.begin('st-1')
    heard.length = 0
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-1' })
    expect(heard).toEqual([{ type: 'body', elementId: 'st-1', mine: true }])
    // The very same events onChange hears, in the same order.
    expect(changes.slice(-heard.length)).toEqual(heard)
    off()
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-2' })
    expect(heard).toHaveLength(1)
    // Another board's message is not this one's.
    const other = vi.fn()
    t.subscribe(other)
    t.applyMessage({ board: 'another', op: 'body', element: 'st-9' })
    expect(other).not.toHaveBeenCalled()
  })

  it('glow changes and a turn that ended reach every subscriber', async () => {
    const adapter = fakeAdapter()
    adapter.renewSticky.mockResolvedValueOnce({ ok: false, ends_in_ms: 0 })
    const { t } = turns({ adapter })
    const a = []
    const b = []
    t.subscribe((e) => a.push(e))
    t.subscribe((e) => b.push(e))
    t.applyMessage({ board: BOARD, op: 'lock', element: 'st-2', holder_label: 'Priya Raman', ends_in_ms: 5000 })
    expect(a).toContainEqual({ type: 'glow', elementId: 'st-2' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(a.at(-1)).toEqual({ type: 'glow' })
    await t.begin('st-1')
    await vi.advanceTimersByTimeAsync(10000)
    expect(a).toContainEqual({ type: 'ended', elementId: 'st-1', words: TURN_WORDS.ended })
    expect(b).toEqual(a)
  })

  it('a subscriber that fails or leaves while hearing does not stop the others', async () => {
    const { t } = turns()
    const later = vi.fn()
    let off = null
    t.subscribe(() => { throw new Error('the canvas\'s own fault') })
    off = t.subscribe(() => { off() })
    t.subscribe(later)
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-2' })
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-3' })
    expect(later).toHaveBeenCalledTimes(2)
  })

  it('after dispose nothing is heard, and a late subscribe is a no-op that can still be called', async () => {
    const { t } = turns()
    const fn = vi.fn()
    t.subscribe(fn)
    await t.dispose()
    t.applyMessage({ board: BOARD, op: 'body', element: 'st-2' })
    expect(fn).not.toHaveBeenCalled()
    const off = t.subscribe(fn)
    expect(typeof off).toBe('function')
    off()
    expect(t.subscribe('not a function')).toBeTypeOf('function')
  })
})

describe('stickyTurn: closing', () => {
  it('dispose lets go of every turn this window holds', async () => {
    const { adapter, t } = turns()
    await t.begin('st-1')
    await t.begin('st-2')
    await t.dispose()
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-1', 101)
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-2', 102)
    expect(await t.begin('st-3')).toEqual({ granted: false, holderLabel: null })
  })

  it('a page hidden lets go too', async () => {
    const { adapter, t, target } = turns()
    await t.begin('st-1')
    target.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.releaseSticky).toHaveBeenCalledWith('st-1', 101)
  })
})
