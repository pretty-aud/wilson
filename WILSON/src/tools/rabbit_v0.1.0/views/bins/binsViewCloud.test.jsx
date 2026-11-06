/** @vitest-environment jsdom */
// =============================================================================
// binsViewCloud.test.jsx — the Bins tab on the cloud (BC2 item 3), rendered,
// with the provider and the access hook mocked.
//
// What this pins:
//   * the tab is gated on `project.bins.write`, not `project.entity.write`:
//     a REVIEWER adds and logs clips (B6, "Reviewers same as members");
//   * where no computer can pick a file (the cloud in a browser) the add
//     verbs say why instead of failing; on the desktop signed in they work;
//   * an add from a location marks a clip already in the project (B8) from
//     the provider's rows, unticked, "already in …";
//   * "Which location is this? Name it." adds the location and reads the
//     same batch again; the add reports its reading progress.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const state = vi.hoisted(() => ({ ctx: null, access: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
vi.mock('../../state/useProjectAccess', () => ({ useProjectAccess: () => state.access }))
const { default: BinsView } = await import('../BinsView')
const { ADD_NEEDS_DESKTOP } = await import('../../bins/binLocations')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const DESKTOP = { backend: 'desktop_cloud', pickFiles: true, probe: true, stream: true, resolveFiles: true, relink: true, openInOs: true, posters: 'cloud', locations: true, remoteViewingSwitch: true }
const BROWSER = { backend: 'supabase', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false, posters: 'cloud', locations: true, remoteViewingSwitch: true }

// A reviewer: the entity gate refuses, the bins gate admits (B6).
const reviewer = () => ({
  canWrite: false, writeReason: 'Reviewers cannot change this project.',
  can: (a) => a === 'project.bins.write', reasonFor: (a) => (a === 'project.bins.write' ? null : 'Reviewers cannot change this project.'),
})

const item = (rel, over = {}) => ({
  kind: 'file', status: 'ok', location_id: 'L1', relative_path: rel, source_path: `\\\\nas\\footage\\${rel.replace(/\//g, '\\')}`,
  original_name: rel.split('/').pop(), extension: '.mov', media_type: 'video', size_bytes: 10, mtime: '2026-10-08T00:00:00.000Z',
  display_name: rel.split('/').pop().replace('.mov', ''), suggestions: null, sub_bin: null, ...over,
})

const makeCtx = (caps, over = {}) => ({
  supportsBins: true, activeProjectId: 'p1', project: { fps: 24 },
  bins: [{ id: 'b1', name: 'Day 1', parent_bin_id: null, color: null, sort_order: 0 }],
  binFiles: [{ id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T1.mov', display_name: 'T1', original_name: 'T1.mov', media_type: 'video', online: true, review_flag: 'unflagged', sort_order: 0 }],
  binRoots: [], binLocations: [{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
  scenes: [], shots: [], shotTakes: [], binsInfo: { ffmpeg: true, capabilities: caps, locations: [] },
  refreshBins: vi.fn(async () => null), undo: vi.fn(), redo: vi.fn(),
  updateBinFile: vi.fn(async () => {}), bulkUpdateBinFiles: vi.fn(async () => {}),
  pickBinFiles: vi.fn(async () => ({ paths: ['\\\\nas\\footage\\A001\\T1.mov', '\\\\nas\\footage\\A001\\T2.mov', '\\\\nas\\sound\\a.wav'] })),
  prepareBinFiles: vi.fn(async () => ({ items: [item('A001/T1.mov'), item('A001/T2.mov'), { kind: 'file', status: 'outside', source_path: '\\\\nas\\sound\\a.wav', original_name: 'a.wav', reason: 'no_location', share_root: '\\\\nas\\sound' }] })),
  findDuplicateBinFiles: vi.fn((items) => items.map(it => (it?.relative_path === 'A001/T1.mov' ? { reason: 'same_path', existing_id: 'f1', existing_bin_id: 'b1', existing_bin_name: 'Day 1' } : null))),
  addBinFiles: vi.fn(async (_b, items, _s, _r, opts) => { opts?.onProgress?.({ done: items.length, total: items.length }); return { created: [], bins: [], results: items.map(() => ({ status: 'added' })) } }),
  addBinLocation: vi.fn(async (l) => ({ id: 'L2', ...l })),
  // No bin selected: the add creates the bin it asked for, then adds.
  addBin: vi.fn(async (b) => ({ id: 'b9', ...b })),
  ...over,
})

const mount = async (caps, access, over) => {
  state.ctx = makeCtx(caps, over); state.access = access
  render(<BinsView pageActive />)
  await act(async () => {})
}
const openAddMenu = () => fireEvent.click(screen.getByRole('button', { name: /Add/ }))

describe('B6: the tab is gated on project.bins.write — a reviewer adds and logs', () => {
  it('a reviewer sees Add enabled and the selection\'s logging controls', async () => {
    await mount(DESKTOP, reviewer())
    const add = screen.getByRole('button', { name: /Add/ })
    expect(add.disabled).toBe(false)
    expect(add.title).toBe('Add files or a folder')
    fireEvent.click(document.querySelector('[role="gridcell"]'))
    expect(screen.getAllByTitle('Select (S)').length).toBeGreaterThan(0)
  })

  it('CONTROL: someone the bins gate refuses reads its reason and cannot add', async () => {
    await mount(DESKTOP, { canWrite: false, writeReason: 'x', can: () => false, reasonFor: () => 'Only this project\'s managers, members and reviewers can change its bins, clips and takes.' })
    const add = screen.getByRole('button', { name: /Add/ })
    expect(add.disabled).toBe(true)
    expect(add.title).toContain('managers, members and reviewers')
  })
})

describe('where no computer can pick a file, the add verbs say why', () => {
  // BC3 (B5): a browser no longer gets an Add menu of two disabled picks
  // under the sentence — the one thing it can do, New bin, is the control,
  // and the sentence is the tab's notice, said once (binsViewBrowser.test.jsx
  // pins the rest). The pin here keeps what mattered: no pick is ever
  // called, a new bin still works, and the sentence is on screen.
  it('in a browser: New bin in place of Add, no pick offered, the sentence said once at the top', async () => {
    await mount(BROWSER, reviewer())
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Files…/ })).toBeNull()
    expect(document.querySelector('[data-testid="catalogue-notice"]').textContent).toContain('need the desktop app')
    // The toolbar's text button (the tree's + is an icon button titled the same).
    const newBin = screen.getAllByRole('button', { name: /^New bin/ }).find(b => /New bin/.test(b.textContent))
    await act(async () => { fireEvent.click(newBin) })
    expect(state.ctx.addBin).toHaveBeenCalled()
    expect(state.ctx.pickBinFiles).not.toHaveBeenCalled()
  })
  it('CONTROL: an empty bin in a browser still reads the add sentence where Add files… stood', async () => {
    await mount(BROWSER, reviewer(), { binFiles: [] })
    expect(document.body.textContent).toContain(ADD_NEEDS_DESKTOP)
    expect(screen.queryByRole('button', { name: /Add files…/ })).toBeNull()
  })
})

describe('item 5: play in place, and "not on this computer" (B3)', () => {
  const twoRows = [
    { id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T1.mp4', display_name: 'T1', original_name: 'T1.mp4', extension: '.mp4', media_type: 'video', online: true, review_flag: 'unflagged', sort_order: 0, added_by: 'u1' },
    { id: 'f9', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T9.mov', display_name: 'T9', original_name: 'T9.mov', extension: '.mov', media_type: 'video', online: false, review_flag: 'unflagged', sort_order: 1, added_by: 'u1' },
  ]
  const people = [{ id: 'u1', name: 'Sofia Aldana' }]
  const mountRows = async (caps) => {
    state.ctx = makeCtx(caps, {
      binFiles: twoRows,
      binFileStreamUrl: vi.fn((id) => (id === 'f1' ? '/api/rabbit/cloud-bins/stream?location_id=L1&relative_path=A001%2FT1.mp4' : null)),
      binFileThumbnailUrl: vi.fn(() => null),
    })
    state.access = reviewer()
    render(<BinsView pageActive people={people} />)
    await act(async () => {})
  }
  const pick = (name) => fireEvent.click([...document.querySelectorAll('[role="gridcell"]')].find(t => t.textContent.includes(name)))

  it('a reachable clip plays through the desktop by location + path', async () => {
    await mountRows(DESKTOP)
    pick('T1')
    const video = document.querySelector('video[controls]')
    expect(video.getAttribute('src')).toBe('/api/rabbit/cloud-bins/stream?location_id=L1&relative_path=A001%2FT1.mp4')
  })

  it('a clip this computer cannot reach: "Not on this computer", its location named, everything but playback', async () => {
    await mountRows(DESKTOP)
    pick('T9')
    const here = document.querySelector('[data-testid="not-here"]')
    expect(here.textContent).toContain('Not on this computer')
    expect(here.textContent).toContain('"Footage NAS" is not reachable from this computer')
    expect(here.textContent).toContain('can still be logged, flagged and assigned to a shot')
    expect(document.querySelector('video[controls]')).toBeNull()
    // The file section: its location, its path inside it, who added it (B11).
    const text = document.body.textContent
    expect(text).toContain('LocationFootage NAS')
    expect(text).toContain('PathA001/T9.mov')
    expect(text).toContain('Added bySofia Aldana')
    expect(screen.getByTitle('Open with the default app').disabled).toBe(true)
    // …and it can still be logged (B3): the marks are live.
    expect(screen.getAllByTitle('Select (S)').some(b => !b.disabled)).toBe(true)
  })

  it('the toolbar and the filter say "not on this computer" for a company\'s clips', async () => {
    await mountRows(DESKTOP)
    expect(document.body.textContent).toContain('1 not on this computer')
  })

  it('…and so do the bin tree\'s footer and every tooltip: no "offline" left on a company\'s clips', async () => {
    await mountRows(DESKTOP)
    // The tree's footer (found in the BC2 rehearsal: "16 files in 7 bins · 16 offline").
    expect(document.body.textContent).toContain('2 files in 1 bin · 1 not on this computer')
    expect(document.body.textContent).not.toMatch(/\boffline\b/i)
    const titles = [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join(' | ')
    expect(titles).not.toMatch(/\boffline\b/i)
    expect(titles).toContain('1 not on this computer')
  })

  it('Rabbit hands the Bins tab the roster it already reads (no second directory call), so B11 has names', () => {
    const rabbit = readFileSync(resolve(process.cwd(), 'src/tools/rabbit_v0.1.0/Rabbit.jsx'), 'utf8')
    expect(rabbit).toMatch(/<BinsView pageActive=\{currentPage === 'rabbit'\} people=\{rosterMembers\} \/>/)
    expect(rabbit).toMatch(/const \{ members: rosterMembers \} = useRosterMembers\(\)/)
  })

  it('B12: the signed-out desktop still says "offline"', async () => {
    const legacy = { ...DESKTOP, backend: 'local_server', locations: false, remoteViewingSwitch: false, posters: 'local' }
    state.ctx = makeCtx(legacy, { binFiles: [{ ...twoRows[1], location_id: undefined, relative_path: undefined, source_path: 'D:\\x\\T9.mov' }] })
    state.access = reviewer()
    render(<BinsView pageActive />)
    await act(async () => {})
    expect(document.body.textContent).toContain('1 offline')
    expect(document.body.textContent).not.toContain('not on this computer')
  })
})

describe('item 6: offline and relink against LOCATIONS', () => {
  const rows = [
    { id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T1.mov', display_name: 'T1', original_name: 'T1.mov', media_type: 'video', online: false, review_flag: 'unflagged', sort_order: 0 },
    { id: 'f2', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T2.mov', display_name: 'T2', original_name: 'T2.mov', media_type: 'video', online: false, review_flag: 'unflagged', sort_order: 1 },
    { id: 'f3', bin_id: 'b1', location_id: 'L2', relative_path: 'plates/p.exr', display_name: 'P', original_name: 'p.exr', media_type: 'vfx', online: false, review_flag: 'unflagged', sort_order: 2 },
  ]
  const locations = [{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }, { id: 'L2', name: 'VFX', unc_path: '\\\\nas\\vfx' }]
  const go = async (status, over = {}) => {
    state.ctx = makeCtx(DESKTOP, {
      binFiles: rows, binLocations: locations,
      binsInfo: { ffmpeg: true, capabilities: DESKTOP, locations: status },
      pickBinLocationLocalPath: vi.fn(async () => ({ local_path: 'Z:\\' })),
      forgetBinLocationLocalPath: vi.fn(async () => ({ local_path: null })),
      ...over,
    })
    state.access = reviewer()
    render(<BinsView pageActive />)
    await act(async () => {})
  }

  // Review round 1: consent before contact. A location this computer's
  // person has not agreed to connect to is never contacted: its own notice,
  // naming it and its address, with Connect (the desktop asks natively).
  it('a location not connected on this computer: its own notice with its address and Connect; not the "not reachable" one', async () => {
    const connectBinLocation = vi.fn(async () => ({ connected: true }))
    await go([{ id: 'L1', status: 'registered', connected: false, reachable: false }, { id: 'L2', status: 'registered', connected: true, reachable: true }], { connectBinLocation })
    const notice = document.querySelector('[data-testid="not-connected"]')
    expect(notice.textContent).toContain('"Footage NAS" (\\\\nas\\footage) is not connected on this computer yet, so its clips cannot be played here. Connect only to a share you recognise.')
    expect(document.body.textContent).not.toContain('is not reachable from this computer, so')
    await act(async () => { fireEvent.click(within(notice).getByText('Connect…')) })
    expect(connectBinLocation).toHaveBeenCalledWith('L1')
    expect(document.body.textContent).toContain('"Footage NAS" is connected on this computer.')
  })

  it('a clip of a location not connected here: the inspector says "not connected", and the relink offers Connect first', async () => {
    const connectBinLocation = vi.fn(async () => ({ canceled: true }))
    await go([{ id: 'L1', status: 'registered', connected: false, reachable: false }, { id: 'L2', status: 'registered', connected: true, reachable: false }], { connectBinLocation })
    fireEvent.click([...document.querySelectorAll('[role="gridcell"]')].find(t => t.textContent.includes('T1')))
    expect(document.querySelector('[data-testid="not-here"]').textContent).toContain('"Footage NAS" is not connected on this computer yet, so the clip cannot be played here.')
    fireEvent.click(screen.getByTitle(/^Find the footage locations of the clips not on this computer/))
    const cards = document.querySelectorAll('[data-testid="relink-location"]')
    expect(cards[0].textContent).toContain('Not connected on this computer')
    const first = cards[0].querySelector('button')
    expect(first.textContent).toBe('Connect…')
    await act(async () => { fireEvent.click(first) })
    expect(connectBinLocation).toHaveBeenCalledWith('L1')
    // A connected but unreachable location offers no Connect.
    expect(cards[1].textContent).not.toContain('Connect…')
  })

  it('one location out of reach: ONE notice naming it, and the per-computer question beside it', async () => {
    await go([{ id: 'L1', status: 'registered', reachable: false }, { id: 'L2', status: 'registered', reachable: true }])
    expect(document.body.textContent).toContain('"Footage NAS" is not reachable from this computer, so their clips cannot be played here.')
    expect(document.body.textContent).not.toContain('"VFX" is not reachable')
    await act(async () => { fireEvent.click(screen.getByText('Where is it on this computer?')) })
    expect(state.ctx.pickBinLocationLocalPath).toHaveBeenCalledWith('L1')
    expect(document.body.textContent).toContain('"Footage NAS" is set for this computer.')
  })

  it('two out of reach: one notice naming both; the relink lists each location with its count — and never rewrites a path', async () => {
    await go([{ id: 'L1', status: 'registered', reachable: false }, { id: 'L2', status: 'registered', reachable: false, local_path: 'Y:\\vfx' }])
    expect(document.body.textContent).toContain('"Footage NAS" and "VFX" are not reachable from this computer')
    fireEvent.click(screen.getByText('Choose where they are…'))
    const cards = document.querySelectorAll('[data-testid="relink-location"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Footage NAS')
    expect(cards[0].textContent).toContain('2 clips')
    expect(cards[1].textContent).toContain('Not reachable from this computer (looked in Y:\\vfx)')
    expect(cards[1].textContent).toContain('Forget this computer\'s folder')
    expect(state.ctx.binRelinkApply).toBeUndefined()
    await act(async () => { fireEvent.click(cards[1].querySelector('button')) })
    expect(state.ctx.pickBinLocationLocalPath).toHaveBeenCalledWith('L2')
  })

  it('a clip missing inside a location this computer DOES reach: said, with what to do — no relink of its path', async () => {
    await go([{ id: 'L1', status: 'registered', reachable: true }, { id: 'L2', status: 'registered', reachable: true }])
    expect(document.body.textContent).not.toContain('not reachable from this computer, so')
    // The toolbar's count (the tree's footer says it too, since the rehearsal).
    fireEvent.click(screen.getByTitle(/^Find the footage locations of the clips not on this computer \(3 in this bin/))
    const missing = document.querySelector('[data-testid="relink-missing"]')
    expect(missing.textContent).toContain('These 3 clips are not at their paths on a share this computer reaches')
    expect(missing.textContent).toContain('put the file back where it was on the share, or remove the clip from its bin')
  })

  it('B12: the signed-out desktop opens its own relink (re-pick a folder)', async () => {
    const legacy = { ...DESKTOP, backend: 'local_server', locations: false, remoteViewingSwitch: false, posters: 'local' }
    state.ctx = makeCtx(legacy, { binFiles: [{ ...rows[0], location_id: undefined, source_path: 'D:\\x\\T1.mov' }], binsInfo: { ffmpeg: true, capabilities: legacy } })
    state.access = reviewer()
    render(<BinsView pageActive />)
    await act(async () => {})
    fireEvent.click(screen.getByTitle(/^Relink the project's offline files/))
    expect(screen.getByRole('dialog', { name: /Relink offline files/ })).toBeTruthy()
  })
})

describe('B4: the catch-up when the switch is on', () => {
  it('on the desktop signed in, switch on: the count named, and one click uploads', async () => {
    await mount(DESKTOP, reviewer(), {
      binsInfo: { ffmpeg: true, capabilities: DESKTOP, locations: [], remoteViewing: true },
      uploadBinFilePosters: vi.fn(async () => ({ uploaded: 1, failed: 0, refused: false })),
    })
    expect(document.body.textContent).toContain('One clip this computer reaches has no picture in the cloud yet')
    await act(async () => { fireEvent.click(screen.getByText('Upload pictures for 1 clip')) })
    expect(state.ctx.uploadBinFilePosters).toHaveBeenCalledWith(null)
    expect(document.body.textContent).toContain('Uploaded 1 picture.')
  })

  it('review round 1: a clip whose picture cannot be made here is not offered again (the offer goes)', async () => {
    await mount(DESKTOP, reviewer(), {
      binsInfo: { ffmpeg: true, capabilities: DESKTOP, locations: [], remoteViewing: true },
      uploadBinFilePosters: vi.fn(async () => ({ uploaded: 0, failed: 1, failedIds: ['f1'], refused: false })),
    })
    await act(async () => { fireEvent.click(screen.getByText('Upload pictures for 1 clip')) })
    expect(document.body.textContent).toContain('1 could not be made on this computer')
    expect(document.body.textContent).not.toContain('Upload pictures for')
  })

  it('switch off, or a browser: no offer', async () => {
    await mount(DESKTOP, reviewer(), { binsInfo: { ffmpeg: true, capabilities: DESKTOP, locations: [], remoteViewing: false } })
    expect(document.body.textContent).not.toContain('no picture in the cloud yet')
    cleanup()
    await mount(BROWSER, reviewer(), { binsInfo: { ffmpeg: true, capabilities: BROWSER, locations: [], remoteViewing: true } })
    expect(document.body.textContent).not.toContain('no picture in the cloud yet')
  })
})

describe('adding from a location, on the desktop signed in', () => {
  it('B8: a clip already in the project arrives unticked, "already in …"', async () => {
    await mount(DESKTOP, reviewer())
    openAddMenu()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Files…/ })) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(state.ctx.findDuplicateBinFiles).toHaveBeenCalledWith([
      { location_id: 'L1', relative_path: 'A001/T1.mov' }, { location_id: 'L1', relative_path: 'A001/T2.mov' }, null,
    ])
    const line = [...document.querySelectorAll('.bn-add-row')].find(r => r.textContent.includes('T1.mov'))
    expect(line.textContent).toContain('already in "Day 1"')
    expect(line.querySelector('input[type="checkbox"]').checked).toBe(false)
  })

  it('"Which location is this? Name it.": the location is added and the same batch is read again', async () => {
    await mount(DESKTOP, reviewer())
    openAddMenu()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Files…/ })) })
    await waitFor(() => expect(document.querySelector('[data-testid="name-share"]')).toBeTruthy())
    const firstCall = state.ctx.prepareBinFiles.mock.calls[0]
    await act(async () => { fireEvent.click(screen.getByText('Add as a footage location')) })
    expect(state.ctx.addBinLocation).toHaveBeenCalledWith({ name: 'Sound', unc_path: '\\\\nas\\sound' })
    expect(state.ctx.prepareBinFiles).toHaveBeenCalledTimes(2)
    expect(state.ctx.prepareBinFiles.mock.calls[1]).toEqual(firstCall)
  })

  it('the add reports its reading progress (the desktop reads each clip before the add)', async () => {
    await mount(DESKTOP, reviewer())
    openAddMenu()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Files…/ })) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText(/^Add 1 item$/)) })
    const call = state.ctx.addBinFiles.mock.calls[0]
    expect(call[1].map(i => i.relative_path)).toEqual(['A001/T2.mov'])
    expect(typeof call[4]?.onProgress).toBe('function')
  })
})
