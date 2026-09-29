// =============================================================================
// mediaMetadata.test.js — kind by mime then extension; the duration probe
// over a fake element (loads, errors, times out, non-media); the two facts
// describeSourceFile returns; the labels the explorer prints.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  extensionOf, mediaKind, isMediaFile, fileTypeLabel, formatDuration,
  probeMediaDuration, describeSourceFile,
} from './mediaMetadata.js'

function fakeSeams({ duration, fail = false, hang = false } = {}) {
  const made = []
  const revoked = []
  return {
    made, revoked,
    createElement: (tag) => {
      const el = { tag, src: null, preload: null, muted: false, onloadedmetadata: null, onerror: null, load() {} }
      Object.defineProperty(el, 'src', {
        set(v) {
          el._src = v
          if (!v || hang) return
          queueMicrotask(() => {
            if (fail) el.onerror && el.onerror(new Error('cannot decode'))
            else { el.duration = duration; el.onloadedmetadata && el.onloadedmetadata() }
          })
        },
        get() { return el._src },
      })
      made.push(el)
      return el
    },
    createObjectURL: (f) => `blob:fake/${f.name}`,
    revokeObjectURL: (u) => revoked.push(u),
  }
}

describe('extensionOf / mediaKind / labels', () => {
  it('reads the extension case-insensitively and ignores dotfiles', () => {
    expect(extensionOf('Legend Road S01E01.MOV')).toBe('mov')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('trailing.')).toBe('')
  })
  it('mime wins, the extension backs it up', () => {
    expect(mediaKind({ type: 'video/quicktime', name: 'x.bin' })).toBe('video')
    expect(mediaKind({ type: '', name: 'clip.MXF' })).toBe('video')
    expect(mediaKind({ mime_type: 'audio/wav', name: 'a.wav' })).toBe('audio')
    expect(mediaKind({ mime_type: null, name: 'mix.aiff' })).toBe('audio')
    expect(mediaKind({ mime_type: 'image/png', name: 'a.png' })).toBe('image')
    expect(mediaKind({ name: 'plate.EXR' })).toBe('image')
    expect(mediaKind({ mime_type: 'application/pdf', name: 'call sheet.pdf' })).toBe('document')
    expect(mediaKind({ name: 'rig.fbx' })).toBe('other')
    expect(isMediaFile({ name: 'clip.mov' })).toBe(true)
    expect(isMediaFile({ name: 'still.png' })).toBe(false)
  })
  it('labels read "Kind · EXT"', () => {
    expect(fileTypeLabel({ name: 'clip.mov', mime_type: 'video/quicktime' })).toBe('Video · MOV')
    expect(fileTypeLabel({ name: 'noext' })).toBe('File')
    expect(fileTypeLabel({ file_name: 'take.wav' })).toBe('Audio · WAV')
  })
  it('formats durations the way a timecode reader expects', () => {
    expect(formatDuration(12.4)).toBe('0:12')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration('abc')).toBe('')
  })
})

describe('probeMediaDuration', () => {
  it('reads the duration from a media element and revokes the object URL', async () => {
    const seams = fakeSeams({ duration: 92.4567 })
    const d = await probeMediaDuration({ name: 'clip.mp4', type: 'video/mp4' }, seams)
    expect(d).toBe(92.457)
    expect(seams.made[0].tag).toBe('video')
    expect(seams.made[0].preload).toBe('metadata')
    expect(seams.revoked).toEqual(['blob:fake/clip.mp4'])
  })
  it('uses an audio element for audio', async () => {
    const seams = fakeSeams({ duration: 3 })
    expect(await probeMediaDuration({ name: 'vo.wav', type: 'audio/wav' }, seams)).toBe(3)
    expect(seams.made[0].tag).toBe('audio')
  })
  it('is null for a non-media file without touching the DOM', async () => {
    const seams = fakeSeams({ duration: 3 })
    expect(await probeMediaDuration({ name: 'still.png', type: 'image/png' }, seams)).toBe(null)
    expect(seams.made.length).toBe(0)
  })
  it('is null when the element cannot decode, and when it never answers (bounded)', async () => {
    expect(await probeMediaDuration({ name: 'x.mov', type: '' }, fakeSeams({ fail: true }))).toBe(null)
    const t0 = Date.now()
    expect(await probeMediaDuration({ name: 'x.mov', type: '' }, { ...fakeSeams({ hang: true }), timeoutMs: 30 })).toBe(null)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
  })
  it('is null for an infinite or zero duration (a live stream, an empty file)', async () => {
    expect(await probeMediaDuration({ name: 'x.mp4', type: 'video/mp4' }, fakeSeams({ duration: Infinity }))).toBe(null)
    expect(await probeMediaDuration({ name: 'x.mp4', type: 'video/mp4' }, fakeSeams({ duration: 0 }))).toBe(null)
  })
  it('is null in an environment with no document (node), never a throw', async () => {
    expect(await probeMediaDuration({ name: 'x.mp4', type: 'video/mp4' })).toBe(null)
  })
})

describe('describeSourceFile', () => {
  it('returns the duration and the source modified time', async () => {
    const r = await describeSourceFile({ name: 'clip.mp4', type: 'video/mp4', lastModified: Date.UTC(2026, 8, 10, 12, 0, 0) }, fakeSeams({ duration: 10 }))
    expect(r).toEqual({ durationSec: 10, sourceModifiedAt: '2026-09-10T12:00:00.000Z' })
  })
  it('nulls what it cannot know', async () => {
    const r = await describeSourceFile({ name: 'a.png', type: 'image/png' }, fakeSeams({ duration: 10 }))
    expect(r).toEqual({ durationSec: null, sourceModifiedAt: null })
    const bad = await describeSourceFile({ name: 'a.mp4', type: 'video/mp4', lastModified: 0 }, { createElement: () => { throw new Error('no dom') }, createObjectURL: () => 'x', revokeObjectURL: () => {} })
    expect(bad).toEqual({ durationSec: null, sourceModifiedAt: null })
  })
})
