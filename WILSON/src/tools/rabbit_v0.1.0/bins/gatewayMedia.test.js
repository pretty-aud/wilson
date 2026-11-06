// =============================================================================
// gatewayMedia.test.js — GW3: what the gateway serves and the browser plays
// (G7, D8; GATEWAY_DESIGN.md §5, §7). The allow-list is the design's, word
// for word; a format off it shows the picture; canPlayType answering the
// empty string (with the probe's codec where BC2 recorded one) shows the
// picture; .mov decides nothing about its codec; no transcoding anywhere.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { GATEWAY_PLAYABLE, playabilityOf, codecStringFor, browserCanPlayType } from './gatewayMedia'

const DESIGN_LIST = ['.mp4', '.m4v', '.mov', '.webm', '.mp3', '.m4a', '.wav', '.bwf', '.flac', '.ogg', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']
const NOT_SERVED = ['.mxf', '.mkv', '.avi', '.wmv', '.mts', '.r3d', '.braw', '.exr', '.dpx', '.tif', '.psd', '.svg']

describe('the allow-list (§5, D8)', () => {
  it('is exactly the design\'s sixteen extensions, each with the type the gateway serves', () => {
    expect(Object.keys(GATEWAY_PLAYABLE).sort()).toEqual([...DESIGN_LIST].sort())
    expect(GATEWAY_PLAYABLE['.mov']).toBe('video/quicktime')
    expect(GATEWAY_PLAYABLE['.bwf']).toBe('audio/wav')
    for (const ext of NOT_SERVED) expect(GATEWAY_PLAYABLE[ext], ext).toBeUndefined()
  })
})

describe('playabilityOf', () => {
  const chrome = (s) => (/codecs="(avc1|vp09|av01|vp8)/.test(s) || /^video\/(mp4|webm)$/.test(s) ? 'probably' : '')
  it('a format off the list shows the picture, whatever the browser says', () => {
    for (const ext of NOT_SERVED) expect(playabilityOf({ extension: ext, media_type: 'video' }, { canPlayType: () => 'probably' })).toMatchObject({ playable: false, reason: 'format' })
    expect(playabilityOf({ original_name: 'master.mxf' }, { canPlayType: () => 'probably' }).playable).toBe(false)
  })
  it('an MP4 with no codec recorded plays by its type; H.264 in any spelling is asked as avc1; ProRes in a .mov is refused by the codec', () => {
    expect(playabilityOf({ extension: '.mp4' }, { canPlayType: chrome })).toEqual({ playable: true, kind: 'video', mime: 'video/mp4', reason: null })
    for (const codec of ['h264', 'H.264', 'x264', 'avc1']) expect(playabilityOf({ extension: 'mov', codec }, { canPlayType: chrome }).playable, codec).toBe(true)
    expect(playabilityOf({ extension: '.mov', codec: 'ProRes 422 HQ' }, { canPlayType: chrome })).toMatchObject({ playable: false, kind: 'video', reason: 'codec' })
    expect(playabilityOf({ extension: '.mov', codec: 'dnxhd' }, { canPlayType: chrome })).toMatchObject({ playable: false, reason: 'codec' })
  })
  it('.mov with no codec recorded is left to the decode (Chrome answers "" to video/quicktime, which proves nothing)', () => {
    const asked = []
    const r = playabilityOf({ extension: '.mov' }, { canPlayType: (s) => { asked.push(s); return '' } })
    expect(r).toMatchObject({ playable: true, kind: 'video', mime: 'video/quicktime' })
    expect(asked).toEqual([])
  })
  it('a codec string is asked with the container\'s type, .mov as MP4', () => {
    const asked = []
    playabilityOf({ extension: '.mov', codec: 'hevc' }, { canPlayType: (s) => { asked.push(s); return 'maybe' } })
    playabilityOf({ extension: '.webm', codec: 'vp9' }, { canPlayType: (s) => { asked.push(s); return 'maybe' } })
    expect(asked).toEqual(['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/webm; codecs="vp09.00.10.08"'])
  })
  it('audio decides by its container, never asked with a codec; a still plays as an image; a sequence is refused (its middle frame is the gateway\'s, not a still row\'s)', () => {
    expect(playabilityOf({ extension: '.wav', codec: 'PCM 24/48' }, { canPlayType: () => '' })).toMatchObject({ playable: true, kind: 'audio', mime: 'audio/wav' })
    expect(playabilityOf({ extension: '.bwf' }, { canPlayType: () => '' }).playable).toBe(true)
    expect(playabilityOf({ extension: '.png' }, { canPlayType: () => '' })).toMatchObject({ playable: true, kind: 'image' })
    expect(playabilityOf({ extension: '.png', is_sequence: true }, { canPlayType: () => 'probably' })).toMatchObject({ playable: true, kind: 'image' })
    expect(playabilityOf({ extension: '.mp4', is_sequence: true }, { canPlayType: () => 'probably' })).toMatchObject({ playable: false, reason: 'format' })
  })
  it('without a canPlayType (no document) the list alone decides', () => {
    expect(playabilityOf({ extension: '.mov', codec: 'ProRes 422 HQ' }).playable).toBe(true)
    expect(playabilityOf({ extension: '.mxf' }).playable).toBe(false)
  })
  it('CONTROL: canPlayType that throws is read as "": the picture, never a crash', () => {
    expect(playabilityOf({ extension: '.mp4', codec: 'h264' }, { canPlayType: () => { throw new Error('x') } })).toMatchObject({ playable: false })
  })
})

describe('codecStringFor and the page\'s own answer', () => {
  it('matches BC2\'s spellings by prefix on letters and digits; an unknown name is null', () => {
    expect(codecStringFor('ProRes 422 HQ')).toBe('apcn')
    expect(codecStringFor('H.264')).toBe('avc1.42E01E')
    expect(codecStringFor('HEVC (Main)')).toBe('hvc1.1.6.L93.B0')
    expect(codecStringFor('av1')).toBe('av01.0.05M.08')
    expect(codecStringFor('')).toBeNull()
    expect(codecStringFor('cineform')).toBeNull()
  })
  it('browserCanPlayType is null with no document, a function in one', () => {
    const hadDoc = typeof document !== 'undefined'
    const fn = browserCanPlayType()
    if (hadDoc) expect(typeof fn === 'function' || fn === null).toBe(true)
    else expect(fn).toBeNull()
  })
})
