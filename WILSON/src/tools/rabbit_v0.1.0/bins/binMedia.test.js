// =============================================================================
// binMedia.test.js — the bin system's vocabulary (demo 2026-09-11).
//
// Three things are asserted here rather than claimed in a comment:
//   1. the renderer's extension tables equal the server's (two copies, ESM and
//      CJS, the S40 pattern for VIDEO_EXTENSIONS);
//   2. the filename parser produces the suggestions docs/BINS_DESIGN.md §3
//      says editors would expect, and nothing for names it should not touch;
//   3. a folder of numbered frames is detected as ONE item, and a folder that
//      merely contains images is not.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as renderer from './binMedia.js'

const require = createRequire(import.meta.url)
const server = require('../../../../electron/rabbitBins.cjs')

describe('renderer and server media tables agree', () => {
  for (const key of ['VIDEO_EXTS', 'STILL_EXTS', 'AUDIO_EXTS', 'GRAPHIC_EXTS', 'VFX_EXTS', 'DOC_EXTS', 'SEQUENCE_EXTS', 'BROWSER_VIDEO_EXTS']) {
    it(key, () => {
      expect([...renderer[key]].sort()).toEqual([...server[key]].sort())
    })
  }
  it('enumerations', () => {
    expect(renderer.MEDIA_TYPES).toEqual(server.MEDIA_TYPES)
    expect(renderer.REVIEW_FLAGS).toEqual(server.REVIEW_FLAGS)
    expect(renderer.COLORS).toEqual(server.COLORS)
    expect(renderer.BIN_KINDS).toEqual(server.BIN_KINDS)
  })
  it('guessMediaType agrees on every listed extension', () => {
    const all = new Set([...renderer.VIDEO_EXTS, ...renderer.STILL_EXTS, ...renderer.AUDIO_EXTS, ...renderer.GRAPHIC_EXTS, ...renderer.VFX_EXTS, ...renderer.DOC_EXTS, '.xyz', ''])
    for (const e of all) expect(renderer.guessMediaType(e), e).toBe(server.guessMediaType(e))
  })
})

describe('guessMediaType', () => {
  it('routes the common cases', () => {
    expect(renderer.guessMediaType('.MOV')).toBe('video')
    expect(renderer.guessMediaType('.braw')).toBe('video')
    expect(renderer.guessMediaType('.heic')).toBe('still')
    expect(renderer.guessMediaType('.wav')).toBe('audio')
    expect(renderer.guessMediaType('.exr')).toBe('vfx')
    expect(renderer.guessMediaType('.psd')).toBe('graphic')
    expect(renderer.guessMediaType('.pdf')).toBe('document')
    expect(renderer.guessMediaType('.blend')).toBe('other')
  })
})

describe('previewKindFor', () => {
  it('names what the panel can do', () => {
    expect(renderer.previewKindFor({ extension: '.mp4', media_type: 'video' })).toBe('video')
    expect(renderer.previewKindFor({ extension: '.mov', media_type: 'video' })).toBe('poster')
    expect(renderer.previewKindFor({ extension: '.mxf', media_type: 'video' })).toBe('poster')
    expect(renderer.previewKindFor({ extension: '.png', media_type: 'still' })).toBe('image')
    expect(renderer.previewKindFor({ extension: '.tif', media_type: 'still' })).toBe('poster')
    expect(renderer.previewKindFor({ extension: '.wav', media_type: 'audio' })).toBe('audio')
    expect(renderer.previewKindFor({ extension: '.aiff', media_type: 'audio' })).toBe('none')
    expect(renderer.previewKindFor({ extension: '.exr', media_type: 'sequence', is_sequence: true })).toBe('frame')
    expect(renderer.previewKindFor({ extension: '.pdf', media_type: 'document' })).toBe('none')
  })
})

describe('formatting', () => {
  it('formatDuration', () => {
    expect(renderer.formatDuration(0)).toBe('')
    expect(renderer.formatDuration(5.9)).toBe('00:05')
    expect(renderer.formatDuration(3725)).toBe('1:02:05')
  })
  it('formatBytes', () => {
    expect(renderer.formatBytes(512)).toBe('512 B')
    expect(renderer.formatBytes(1536)).toBe('1.5 KB')
    expect(renderer.formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB')
  })
  it('secondsToTimecode', () => {
    expect(renderer.secondsToTimecode(0, 24)).toBe('00:00:00:00')
    expect(renderer.secondsToTimecode(61.5, 24)).toBe('00:01:01:12')
  })
  it('techLine and slateLine only print what exists', () => {
    expect(renderer.techLine({ duration_sec: 5, width: 1920, height: 1080, fps: 23.976, codec: 'h264' })).toBe('00:05 · 1920×1080 · 23.98 fps · H264')
    expect(renderer.techLine({})).toBe('')
    expect(renderer.slateLine({ slate: '24A', take_number: 3, take_modifier: 'PU', camera: 'A' })).toBe('24A · T3 PU · A cam')
    expect(renderer.slateLine({ take_modifier: 'MOS' })).toBe('MOS')
  })
})

describe('parseNameSuggestions (server)', () => {
  const p = server.parseNameSuggestions
  it('12A_3_T4_A → slate 12A, shot 3, take 4, camera A', () => {
    expect(p('12A_3_T4_A.mov')).toMatchObject({ slate: '12A', scene_hint: '12A', shot_hint: '3', take_number: 4, camera: 'A' })
  })
  it('SC12A_SH03_TK04', () => {
    expect(p('SC12A_SH03_TK04.mp4')).toMatchObject({ slate: '12A', shot_hint: '3', take_number: 4 })
  })
  it('24A-3 → take 3 when no explicit take marker', () => {
    expect(p('24A-3.mov')).toMatchObject({ slate: '24A', take_number: 3, shot_hint: null })
  })
  it('Scene12_Shot3_Take4_PU', () => {
    expect(p('Scene12_Shot3_Take4_PU.mov')).toMatchObject({ slate: '12', shot_hint: '3', take_number: 4, take_modifier: 'PU' })
  })
  it('camera clip names give camera and roll, never a slate', () => {
    expect(p('A001C003_240612_R1AB.mov')).toMatchObject({ camera: 'A', roll: 'A001', slate: null, take_number: null })
    expect(p('B002_C0007_0612XY.R3D')).toMatchObject({ camera: 'B', roll: 'B002', slate: null })
  })
  it('dates become shoot_day and are not read as scenes', () => {
    expect(p('20260612_interview.mov')).toMatchObject({ shoot_day: '2026-06-12', slate: null })
    expect(p('2026-06-12_24A_T2.mov')).toMatchObject({ shoot_day: '2026-06-12', slate: '24A', take_number: 2 })
  })
  it('an ordinary name suggests nothing', () => {
    expect(p('Holiday video final.mp4')).toMatchObject({ slate: null, take_number: null, camera: null, roll: null, shoot_day: null })
    expect(p('')).toMatchObject({ slate: null })
  })
})

describe('detectSequence (server)', () => {
  let root
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-bins-seq-'))
    fs.mkdirSync(path.join(root, 'seq'))
    for (const n of [1, 2, 3, 5]) fs.writeFileSync(path.join(root, 'seq', `shot.${String(n).padStart(4, '0')}.exr`), Buffer.from('x'))
    fs.mkdirSync(path.join(root, 'mixed'))
    fs.writeFileSync(path.join(root, 'mixed', 'a.png'), Buffer.from('x'))
    fs.writeFileSync(path.join(root, 'mixed', 'b.png'), Buffer.from('x'))
    fs.mkdirSync(path.join(root, 'nested'))
    fs.mkdirSync(path.join(root, 'nested', 'inner'))
    fs.writeFileSync(path.join(root, 'nested', 'f_01.png'), Buffer.from('x'))
    fs.writeFileSync(path.join(root, 'nested', 'f_02.png'), Buffer.from('x'))
    fs.mkdirSync(path.join(root, 'one'))
    fs.writeFileSync(path.join(root, 'one', 'f_01.png'), Buffer.from('x'))
  })
  afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* temp */ } })

  it('a numbered folder is one sequence with a pattern, a count and its gaps', () => {
    const s = server.detectSequence(path.join(root, 'seq'))
    expect(s).toMatchObject({ pattern: 'shot.####.exr', ext: '.exr', frame_count: 4, first_frame: 1, last_frame: 5, missing_frames: 1, size_bytes: 4 })
    expect(path.basename(s.middle_frame_path)).toBe('shot.0003.exr')
  })
  it('unnumbered images are not a sequence', () => {
    expect(server.detectSequence(path.join(root, 'mixed'))).toBeNull()
  })
  it('a folder with a subfolder is not a sequence', () => {
    expect(server.detectSequence(path.join(root, 'nested'))).toBeNull()
  })
  it('one frame is not a sequence', () => {
    expect(server.detectSequence(path.join(root, 'one'))).toBeNull()
  })
  it('a missing folder is not a sequence', () => {
    expect(server.detectSequence(path.join(root, 'nope'))).toBeNull()
  })
})

describe('parseNameSuggestions: ordinary names stay ordinary (adversarial review)', () => {
  const p = server.parseNameSuggestions
  it('render and delivery names get no slate, roll or camera', () => {
    expect(p('render_2160p_h264.mp4')).toMatchObject({ slate: null, roll: null, camera: null, confidence: 'low' })
    expect(p('4K_master.mov')).toMatchObject({ slate: null, confidence: 'low' })
    expect(p('2026_budget_v1.xlsx')).toMatchObject({ slate: null, shoot_day: null, confidence: 'low' })
    expect(p('interview_b_roll.mp4')).toMatchObject({ camera: null })
  })
  it('explicit markers are high confidence; a bare slate with a take is too', () => {
    expect(p('12A_3_T4_A.mov').confidence).toBe('high')
    expect(p('SC12A_SH03_TK04.mp4').confidence).toBe('high')
    expect(p('A001C003_240612_R1AB.mov').confidence).toBe('high')
    expect(p('24A-3.mov')).toMatchObject({ slate: '24A', take_number: 3, confidence: 'high' })
    expect(p('12A.mov')).toMatchObject({ slate: null, confidence: 'low' })
  })
})

describe('detectSequence tolerates a few sidecars (adversarial review)', () => {
  let root
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-bins-side-'))
    fs.mkdirSync(path.join(root, 'ok'))
    for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(root, 'ok', `shot.${String(i).padStart(4, '0')}.exr`), Buffer.from('x'))
    fs.writeFileSync(path.join(root, 'ok', 'Thumbs.db'), Buffer.from('x'))
    fs.writeFileSync(path.join(root, 'ok', 'render.log'), Buffer.from('x'))
    fs.mkdirSync(path.join(root, 'toomany'))
    for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(root, 'toomany', `shot.${i}.exr`), Buffer.from('x'))
    for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(root, 'toomany', `note${i}.txt`), Buffer.from('x'))
    fs.mkdirSync(path.join(root, 'onedigit'))
    fs.writeFileSync(path.join(root, 'onedigit', 's.9.exr'), Buffer.from('x'))
    fs.writeFileSync(path.join(root, 'onedigit', 's.10.exr'), Buffer.from('x'))
  })
  afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* temp */ } })
  it('two sidecars among twenty frames are set aside and reported', () => {
    const s = server.detectSequence(path.join(root, 'ok'))
    expect(s).toMatchObject({ frame_count: 20, sidecars: 2, pattern: 'shot.####.exr' })
  })
  it('three notes beside four frames is a folder, not a sequence', () => {
    expect(server.detectSequence(path.join(root, 'toomany'))).toBeNull()
  })
  it('single-digit frame numbers count', () => {
    expect(server.detectSequence(path.join(root, 'onedigit'))).toMatchObject({ frame_count: 2, first_frame: 9, last_frame: 10 })
  })
})
