/** @vitest-environment jsdom */
// binPosterCloud.test.jsx — a cloud clip's picture (BC2 item 4, B3/B4).
//
// What this pins:
//   * a clip of a company keeps its picture when this computer cannot reach
//     it (B3): the poster cached here first, else the cloud's, signed per
//     read by the provider — once per picture, not on every render;
//   * a clip of the signed-out desktop shows as it always has (B12: no
//     picture while its drive is out, and the cloud is never asked);
//   * a local poster that fails falls back to the cloud's, and a cloud one
//     that fails too leaves the icon — never a retry loop;
//   * needsCloudPoster: the clips the catch-up counts.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ ctx: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
const { default: BinPoster } = await import('./BinPoster')
const { needsCloudPoster } = await import('../../bins/cloudPosters')

beforeEach(() => { state.ctx = { binFilePosterUrl: vi.fn(async (row) => `https://signed.example/${row.poster_path}`) } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const cloudRow = (over = {}) => ({ id: 'f1', media_type: 'video', location_id: 'L1', relative_path: 'A001/T1.mov', online: false, poster_path: 'projects/p1/bin_files/f1/1-poster.jpg', ...over })
const img = () => document.querySelector('.bn-poster img')

describe('B3: a company\'s clip keeps its picture off this computer', () => {
  it('no picture here: the cloud\'s, signed by the provider', async () => {
    render(<BinPoster row={cloudRow()} src={null} width={120} />)
    await waitFor(() => expect(img()?.getAttribute('src')).toBe('https://signed.example/projects/p1/bin_files/f1/1-poster.jpg'))
    expect(state.ctx.binFilePosterUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), { expiresIn: 3600 })
  })

  it('a wide tile names it in the B3 words; the signed-out desktop\'s still says "offline" (B12)', () => {
    const { container, unmount } = render(<BinPoster row={cloudRow()} src={null} width={120} />)
    expect(container.querySelector('.bn-scrim').textContent).toBe('not on this computer')
    unmount()
    const legacy = render(<BinPoster row={{ id: 'f2', media_type: 'video', source_path: 'D:\\x\\T2.mov', online: false }} src={null} width={120} />)
    expect(legacy.container.querySelector('.bn-scrim').textContent).toBe('offline')
  })

  it('a poster cached here is shown first, even while the file is out; the cloud is not asked', () => {
    render(<BinPoster row={cloudRow()} src="/api/rabbit/cloud-bins/thumbnail?x=1" width={120} />)
    expect(img().getAttribute('src')).toBe('/api/rabbit/cloud-bins/thumbnail?x=1')
    expect(state.ctx.binFilePosterUrl).not.toHaveBeenCalled()
  })

  it('the local poster fails: the cloud\'s; that fails too: the icon — and no loop', async () => {
    render(<BinPoster row={cloudRow({ poster_path: 'projects/p1/bin_files/f1/2-poster.jpg' })} src="/local.jpg" width={120} />)
    fireEvent.error(img())
    await waitFor(() => expect(img()?.getAttribute('src')).toBe('https://signed.example/projects/p1/bin_files/f1/2-poster.jpg'))
    fireEvent.error(img())
    await waitFor(() => expect(img()).toBeNull())
    expect(document.querySelector('.bn-poster-icon')).toBeTruthy()
  })

  it('a picture is signed once for every tile that shows it (kept a while)', async () => {
    const row = cloudRow({ poster_path: 'projects/p1/bin_files/f1/3-poster.jpg' })
    render(<><BinPoster row={row} src={null} width={60} /><BinPoster row={row} src={null} width={60} /></>)
    await waitFor(() => expect(document.querySelectorAll('.bn-poster img')).toHaveLength(2))
    const signs = () => state.ctx.binFilePosterUrl.mock.calls.filter(c => c[0].poster_path.endsWith('3-poster.jpg')).length
    const afterFirst = signs()
    // A tile drawn later (a scroll, another tab) reads the kept URL at once.
    const later = render(<BinPoster row={row} src={null} width={60} />)
    expect(later.container.querySelector('img')?.getAttribute('src')).toBe('https://signed.example/projects/p1/bin_files/f1/3-poster.jpg')
    expect(signs()).toBe(afterFirst)
  })

  it('no picture anywhere: the icon, and nothing is signed', () => {
    render(<BinPoster row={cloudRow({ poster_path: null })} src={null} width={120} />)
    expect(img()).toBeNull()
    expect(state.ctx.binFilePosterUrl).not.toHaveBeenCalled()
  })
})

describe('B12: the signed-out desktop\'s clip shows as it always has', () => {
  it('offline: no picture, and the cloud is never asked', () => {
    render(<BinPoster row={{ id: 'f9', media_type: 'video', source_path: 'D:\\x.mov', online: false, poster_path: 'x' }} src="/api/rabbit/projects/p/bin-files/f9/thumbnail" width={120} />)
    expect(img()).toBeNull()
    expect(state.ctx.binFilePosterUrl).not.toHaveBeenCalled()
  })
  it('online: its poster', () => {
    render(<BinPoster row={{ id: 'f9', media_type: 'video', source_path: 'D:\\x.mov', online: true }} src="/thumb" width={120} />)
    expect(img().getAttribute('src')).toBe('/thumb')
  })
})

describe('needsCloudPoster: what the catch-up counts', () => {
  it('a company\'s clip this computer reaches, of a kind that has a picture, with none in the cloud', () => {
    expect(needsCloudPoster({ location_id: 'L1', online: true, media_type: 'video' })).toBe(true)
    expect(needsCloudPoster({ location_id: 'L1', online: true, media_type: 'sequence' })).toBe(true)
    expect(needsCloudPoster({ location_id: 'L1', online: false, media_type: 'video' })).toBe(false)
    expect(needsCloudPoster({ location_id: 'L1', online: true, media_type: 'video', poster_path: 'p' })).toBe(false)
    expect(needsCloudPoster({ location_id: 'L1', online: true, media_type: 'audio' })).toBe(false)
    expect(needsCloudPoster({ source_path: 'D:\\x', online: true, media_type: 'video' })).toBe(false)
    expect(needsCloudPoster(null)).toBe(false)
  })
})
