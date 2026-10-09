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
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ ctx: null, access: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
vi.mock('../../state/useProjectAccess', () => ({ useProjectAccess: () => state.access }))
const { default: BinsView, ADD_NEEDS_DESKTOP } = await import('../BinsView')

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
  it('in a browser: the picks are disabled under the sentence; a new bin still works', async () => {
    await mount(BROWSER, reviewer())
    expect(screen.getByRole('button', { name: /Add/ }).title).toBe(ADD_NEEDS_DESKTOP)
    openAddMenu()
    expect(document.body.textContent).toContain(ADD_NEEDS_DESKTOP)
    const files = screen.getByRole('button', { name: /^Files…/ })
    expect(files.disabled || files.getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.click(files)
    expect(state.ctx.pickBinFiles).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /^New bin/ }).length).toBeGreaterThan(0)
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
