// =============================================================================
// ffmpegInfo.test.js — parseFfmpegInfo (electron/ffmpeg.cjs), demo 2026-09-11.
//
// The bin system's technical columns come from ONE `ffmpeg -i` run whose
// stderr is parsed here. These samples are the shapes ffmpeg actually prints;
// the traps each one guards are named in the test titles.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseFfmpegInfo } = require('../../../../electron/ffmpeg.cjs')

const H264 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Metadata:
    major_brand     : isom
    encoder         : Lavf60.3.100
  Duration: 00:00:05.00, start: 0.000000, bitrate: 812 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 680 kb/s, 23.98 fps, 23.98 tbr, 24k tbn (default)
    Metadata:
      handler_name    : VideoHandler
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
At least one output file must be specified`

const PRORES = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'A001C003_240612_R1AB.mov':
  Metadata:
    timecode        : 01:00:00:00
  Duration: 00:01:02.02, start: 0.000000, bitrate: 220000 kb/s
  Stream #0:0[0x1](eng): Video: prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt709, progressive), 3840x2160, 219000 kb/s, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 25k tbn (default)
  Stream #0:1[0x2](eng): Audio: pcm_s24le (in24 / 0x34326E69), 48000 Hz, 2 channels, s32 (24 bit), 2304 kb/s (default)
  Stream #0:2[0x3](eng): Data: none (tmcd / 0x64636D74), 0 kb/s (default)
    Metadata:
      timecode        : 01:00:00:00
At least one output file must be specified`

const PNG = `Input #0, png_pipe, from 'frame.png':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 640x360 [SAR 2835:2835 DAR 16:9], 25 fps, 25 tbr, 25 tbn
At least one output file must be specified`

const WAV = `Input #0, wav, from 'tone.wav':
  Duration: 00:00:03.00, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 2 channels, s16, 1536 kb/s
At least one output file must be specified`

const NOTHING = `clip.bin: Invalid data found when processing input`

describe('parseFfmpegInfo', () => {
  it('H.264 MP4: duration, codec, frame size, fps, audio', () => {
    expect(parseFfmpegInfo(H264)).toMatchObject({
      duration_sec: 5, codec: 'h264', width: 1920, height: 1080, fps: 23.98,
      audio_codec: 'aac', sample_rate: 48000, channels: 'stereo', container: 'mov,mp4,m4a,3gp,3g2,mj2', timecode_start: null,
    })
  })
  it('ProRes with a timecode track: the start timecode and 10-bit codec name', () => {
    expect(parseFfmpegInfo(PRORES)).toMatchObject({
      duration_sec: 62.02, codec: 'prores', width: 3840, height: 2160, fps: 25,
      audio_codec: 'pcm_s24le', sample_rate: 48000, channels: '2 channels', timecode_start: '01:00:00:00',
    })
  })
  it('a still has no Duration and no fps trap from "[0x1]" or the fourcc', () => {
    const i = parseFfmpegInfo(PNG)
    expect(i.duration_sec).toBeNull()
    expect(i.width).toBe(640)
    expect(i.height).toBe(360)
    expect(i.codec).toBe('png')
  })
  it('"[0x1]" and "(avc1 / 0x31637661)" never read as a frame size', () => {
    const i = parseFfmpegInfo(H264.replace('1920x1080 [SAR 1:1 DAR 16:9], ', ''))
    expect(i.width).toBeNull()
    expect(i.height).toBeNull()
  })
  it('audio-only: audio codec, sample rate, channels, no video', () => {
    expect(parseFfmpegInfo(WAV)).toMatchObject({ duration_sec: 3, codec: null, width: null, audio_codec: 'pcm_s16le', sample_rate: 48000, channels: '2 channels' })
  })
  it('unreadable input yields all nulls, never throws', () => {
    expect(parseFfmpegInfo(NOTHING)).toMatchObject({ duration_sec: null, codec: null, width: null, fps: null, audio_codec: null })
    expect(parseFfmpegInfo('')).toMatchObject({ duration_sec: null })
    expect(parseFfmpegInfo(undefined)).toMatchObject({ duration_sec: null })
  })
})
