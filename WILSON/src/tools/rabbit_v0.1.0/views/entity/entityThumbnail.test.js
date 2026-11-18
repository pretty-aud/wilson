/** @vitest-environment jsdom */
// entityThumbnail (post-overhaul F10, rabbit A1): the six callers' one pair
// of thumbnail writers, on the two desktop channels F9 keeps this week —
// the same channel, the same argument object, the same guard, the same order.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickEntityThumbnail, clearEntityThumbnail } from './entityThumbnail'

afterEach(() => { delete window.electronAPI; vi.restoreAllMocks() })

function desktop({ picked = 'C:/pics/dawn.png', generate = async () => {}, clear = async () => {} } = {}) {
  const order = []
  window.electronAPI = {
    rabbit: {
      pickImage: vi.fn(async () => { order.push('pick'); return picked }),
      generateEntityThumbnail: vi.fn(async (a) => { order.push('generate'); return generate(a) }),
      clearEntityThumbnail: vi.fn(async (a) => { order.push('clear'); return clear(a) }),
    },
  }
  return order
}

describe('pickEntityThumbnail', () => {
  it('the picker, the row\'s path written, the channel with { entityType, entityId, sourcePath }, then the caller told — in that order', async () => {
    const order = desktop()
    const update = vi.fn(() => order.push('update'))
    const onChanged = vi.fn(() => order.push('changed'))
    await pickEntityThumbnail({ canWrite: true, entityType: 'shot', entityId: 'sh1', update, onChanged, say: 'shot' })
    expect(order).toEqual(['pick', 'update', 'generate', 'changed'])
    expect(update).toHaveBeenCalledWith({ thumbnail_image: 'C:/pics/dawn.png' })
    expect(window.electronAPI.rabbit.generateEntityThumbnail).toHaveBeenCalledWith({ entityType: 'shot', entityId: 'sh1', sourcePath: 'C:/pics/dawn.png' })
  })
  it('a seat that may not write, a desktop without the picker, or a cancelled pick: nothing at all', async () => {
    const order = desktop({ picked: null })
    const update = vi.fn()
    await pickEntityThumbnail({ canWrite: false, entityType: 'scene', entityId: 'sc1', update })
    expect(order).toEqual([])
    await pickEntityThumbnail({ canWrite: true, entityType: 'scene', entityId: 'sc1', update })
    expect(order).toEqual(['pick'])
    expect(update).not.toHaveBeenCalled()
    delete window.electronAPI
    await expect(pickEntityThumbnail({ canWrite: true, entityType: 'scene', entityId: 'sc1', update })).resolves.toBeUndefined()
  })
  it('a channel that throws: the caller is still told; the windows say it in the console, the cells stay silent', async () => {
    desktop({ generate: async () => { throw new Error('no ffmpeg') } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onChanged = vi.fn()
    await pickEntityThumbnail({ canWrite: true, entityType: 'level', entityId: 'l1', update: () => {}, onChanged, say: 'level' })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0][0]).toBe('level thumbnail gen failed:')
    err.mockClear()
    await pickEntityThumbnail({ canWrite: true, entityType: 'scene', entityId: 'sc1', update: () => {}, onChanged })
    expect(err).not.toHaveBeenCalled()
  })
})

describe('clearEntityThumbnail', () => {
  it('the row\'s path cleared, the channel with { entityType, entityId }, the caller told even when it throws; nothing for a seat that may not write', async () => {
    const order = desktop({ clear: async () => { throw new Error('gone') } })
    const update = vi.fn(() => order.push('update'))
    const onChanged = vi.fn(() => order.push('changed'))
    await clearEntityThumbnail({ canWrite: true, entityType: 'experience', entityId: 'e1', update, onChanged })
    expect(order).toEqual(['update', 'clear', 'changed'])
    expect(update).toHaveBeenCalledWith({ thumbnail_image: null })
    expect(window.electronAPI.rabbit.clearEntityThumbnail).toHaveBeenCalledWith({ entityType: 'experience', entityId: 'e1' })
    order.length = 0
    await clearEntityThumbnail({ canWrite: false, entityType: 'experience', entityId: 'e1', update, onChanged })
    expect(order).toEqual([])
  })
})

describe('the six callers take these two and call no channel of their own', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  it('ScenesView and EntityListView name neither channel; the six call sites are the helpers', () => {
    const scenes = read('../ScenesView.jsx')
    const entity = read('../EntityListView.jsx')
    for (const [name, src] of [['ScenesView', scenes], ['EntityListView', entity]]) {
      expect(src, name).not.toMatch(/rabbit\.(generateEntityThumbnail|clearEntityThumbnail)\(/)
    }
    // Three table cells and the two windows set; the two windows clear.
    expect((scenes.match(/pickEntityThumbnail\(\{/g) || []).length).toBe(5)
    expect((scenes.match(/clearEntityThumbnail\(\{/g) || []).length).toBe(2)
    expect((entity.match(/pickEntityThumbnail\(\{/g) || []).length).toBe(1)
    expect((entity.match(/clearEntityThumbnail\(\{/g) || []).length).toBe(1)
  })
})
