/** @vitest-environment jsdom */
// =============================================================================
// binsViewBrowser.test.jsx — the Bins tab in a BROWSER (BC3 items 1 and 2),
// rendered, with the provider and the access hook mocked.
//
// Audrey's B5: until the file gateway exists the browser shows the CATALOGUE
// — every bin and clip, pictures where they exist, logging, marks, takes,
// move, copy, remove — and says plainly that adding files and playing them
// need the desktop app. B3: every cloud row is "not on this computer" there.
// The branch is on BC1's capability object (binsModeOf), never on
// window.electronAPI or the user agent.
//
// What this pins:
//   * ONE notice at the top says it, once (dismissed for the session); on the
//     desktop signed in there is none;
//   * New bin stands where Add stood; no pick is offered; a reviewer may
//     (project.bins.write, B6); someone the gate refuses reads the reason;
//   * no control without its verb: Open, Reveal and Read columns again are
//     not offered (the menu, the inspector), nor "no decoder";
//   * every row keeps its "not on this computer" mark and loses the dim (the
//     whole catalogue in the disabled ink would read as a tab that does not
//     work), and no count of them is shown (they are all of them);
//   * the inspector's sentence is the browser's, naming the desktop app and
//     the location; marks and logging stay live; the Space hint is there;
//   * Space shows the picture large and again puts it away; Esc closes it
//     and keeps the selection; the arrows move under it and S marks;
//   * keyboard review (S / R / U) works with no preview;
//   * hover-scrub is off; a drop from the OS is answered with the sentence;
//   * the empty states say the browser's words;
//   * a shot's takes say "not on this computer" for a company's clip (B3),
//     "offline" for the signed-out desktop's (B12);
//   * the launch entry on 5286 and the module that proves it.
// Every claim has a CONTROL on the desktop signed in (DESKTOP caps).
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, createEvent, within } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const state = vi.hoisted(() => ({ ctx: null, access: null }))
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => state.ctx }))
vi.mock('../../state/useProjectAccess', () => ({ useProjectAccess: () => state.access }))
const { default: BinsView } = await import('../BinsView')
const { default: ShotTakesPanel } = await import('./ShotTakesPanel')
const { binsModeOf } = await import('../../bins/browserCatalogue')
const { ADD_NEEDS_DESKTOP, NOT_ON_THIS_COMPUTER, CATALOGUE_SENTENCE, CATALOGUE_EMPTY_BINS_SENTENCE, PLAY_NEEDS_DESKTOP, POSTER_LARGE_HINT, browserClipSentence } = await import('../../bins/binLocations')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const DESKTOP = { backend: 'desktop_cloud', pickFiles: true, probe: true, stream: true, resolveFiles: true, relink: true, openInOs: true, posters: 'cloud', locations: true, remoteViewingSwitch: true }
const BROWSER = { backend: 'supabase', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false, posters: 'cloud', locations: true, remoteViewingSwitch: true }
// The dev fixtures: a browser whose rows the backend answers for (every one
// reachable, there being no disk behind it).
const FIXTURES = { ...BROWSER, backend: 'fixtures', resolveFiles: true }

const reviewer = () => ({
  canWrite: false, writeReason: 'Reviewers cannot change this project.',
  can: (a) => a === 'project.bins.write', reasonFor: (a) => (a === 'project.bins.write' ? null : 'Reviewers cannot change this project.'),
})
const refused = () => ({ canWrite: false, writeReason: 'x', can: () => false, reasonFor: () => 'Only this project\'s managers, members and reviewers can change its bins, clips and takes.' })

// Names that no slate line echoes ("12A · T1" names take 1): Clip 0, Clip 1…
const rowsFor = (caps, n = 3) => Array.from({ length: n }, (_, i) => ({
  id: 'f' + i, bin_id: 'b1', location_id: 'L1', relative_path: `A001/C00${i}.mp4`, display_name: 'Clip ' + i, original_name: `C00${i}.mp4`, extension: '.mp4',
  media_type: 'video', online: caps.resolveFiles === false ? false : true, review_flag: 'unflagged', circled: false, color: null, sort_order: i, added_by: 'u1',
  slate: '12A', take_number: i + 1, poster_path: i === 0 ? 'projects/p1/bin_files/f0/1-poster.jpg' : null,
}))

const makeCtx = (caps, over = {}) => ({
  supportsBins: true, activeProjectId: 'p1', project: { fps: 24 },
  bins: [{ id: 'b1', name: 'Day 1', parent_bin_id: null, color: null, sort_order: 0 }],
  binFiles: rowsFor(caps),
  binRoots: [], binLocations: [{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
  scenes: [], shots: [{ id: 'sh1', name: 'Shot 1', shot_number: 1, scene_id: null }], shotTakes: [],
  binsInfo: { ffmpeg: false, capabilities: caps, locations: [] },
  refreshBins: vi.fn(async () => null), undo: vi.fn(), redo: vi.fn(),
  updateBinFile: vi.fn(async () => {}), bulkUpdateBinFiles: vi.fn(async () => {}), removeBinFiles: vi.fn(async () => {}),
  pickBinFiles: vi.fn(async () => ({ paths: [] })), pickBinFolder: vi.fn(async () => ({ path: null })), prepareBinFiles: vi.fn(async () => ({ items: [] })),
  addBin: vi.fn(async (b) => ({ id: 'b9', ...b })), openBinFile: vi.fn(async () => {}), probeBinFile: vi.fn(async () => {}),
  binFileThumbnailUrl: vi.fn(() => null),
  binFileStreamUrl: vi.fn((id) => (caps.stream ? `/api/rabbit/cloud-bins/stream?id=${id}` : null)),
  ...over,
})
const people = [{ id: 'u1', name: 'Sofia Aldana' }]
const mount = async (caps, access = reviewer(), over = {}) => {
  state.ctx = makeCtx(caps, over); state.access = access
  render(<BinsView pageActive people={people} />)
  await act(async () => {})
}
const tiles = () => [...document.querySelectorAll('[role="gridcell"]')]
const pick = (name) => fireEvent.click(tiles().find(t => t.textContent.includes(name)))
const key = (init) => act(async () => { fireEvent.keyDown(document.body, init) })
const notice = () => document.querySelector('[data-testid="catalogue-notice"]')
const large = () => document.querySelector('[data-testid="poster-large"]')
// The toolbar's New bin is the text button; the tree's + is an icon button
// titled the same.
const newBinBtn = () => screen.getAllByRole('button', { name: /New bin/ }).find(b => /New bin/.test(b.textContent)) || null
const treeRow = (name) => [...document.querySelectorAll('[role="treeitem"]')].find(r => r.textContent.includes(name))

describe('binsModeOf: the capability object, read once', () => {
  it('a browser is the catalogue: no pick, no stream, nothing reachable; its word is "not on this computer"', () => {
    const m = binsModeOf(BROWSER)
    expect(m).toEqual({ catalogue: true, canPick: false, canStream: false, canProbe: false, canOpen: false, canRelink: false, nothingReachable: true, offlineWord: NOT_ON_THIS_COMPUTER })
    expect(Object.isFrozen(m)).toBe(true)
  })
  it('the fixtures are the catalogue too, with every row answered for', () => {
    expect(binsModeOf(FIXTURES)).toMatchObject({ catalogue: true, nothingReachable: false, canStream: false })
  })
  it('the desktop signed in is not; the signed-out desktop says "offline"; null reads as the signed-out desktop (B12)', () => {
    expect(binsModeOf(DESKTOP)).toMatchObject({ catalogue: false, canPick: true, canStream: true, canProbe: true, canOpen: true, canRelink: true, nothingReachable: false, offlineWord: NOT_ON_THIS_COMPUTER })
    expect(binsModeOf({ ...DESKTOP, backend: 'local_server', locations: false }).offlineWord).toBe('offline')
    expect(binsModeOf(null)).toMatchObject({ catalogue: false, canPick: true, canStream: true, canProbe: true, canOpen: true, canRelink: true, nothingReachable: false, offlineWord: 'offline' })
  })
  it('CONTROL: one capability alone does not make the catalogue — picking off with bytes on is the desktop composite mid-load, not a browser', () => {
    expect(binsModeOf({ ...DESKTOP, pickFiles: false }).catalogue).toBe(false)
    expect(binsModeOf({ ...DESKTOP, stream: false }).catalogue).toBe(false)
  })
})

describe('B5: one notice, once', () => {
  it('a browser reads the catalogue sentence, naming the desktop app, at the top; Got it puts it away', async () => {
    await mount(BROWSER)
    expect(notice().textContent).toContain(CATALOGUE_SENTENCE)
    expect(CATALOGUE_SENTENCE).toMatch(/desktop app/)
    expect(document.querySelectorAll('[data-testid="catalogue-notice"]')).toHaveLength(1)
    fireEvent.click(within(notice()).getByTitle('Got it'))
    expect(notice()).toBeNull()
  })
  it('CONTROL: the desktop signed in has no such notice', async () => {
    await mount(DESKTOP)
    expect(notice()).toBeNull()
    expect(document.body.textContent).not.toContain(CATALOGUE_SENTENCE)
  })
})

describe('New bin stands where Add stood', () => {
  it('a reviewer in a browser gets New bin, not Add, and it creates a bin (B6)', async () => {
    await mount(BROWSER)
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
    const btn = newBinBtn()
    expect(btn.disabled).toBe(false)
    expect(btn.title).toBe('New bin')
    await act(async () => { fireEvent.click(btn) })
    expect(state.ctx.addBin).toHaveBeenCalledWith(expect.objectContaining({ name: 'New bin' }))
    expect(state.ctx.pickBinFiles).not.toHaveBeenCalled()
  })
  it('someone the bins gate refuses reads its reason on it', async () => {
    await mount(BROWSER, refused())
    const btn = newBinBtn()
    expect(btn.disabled).toBe(true)
    expect(btn.title).toContain('managers, members and reviewers')
  })
  it('the bin\'s own menu offers no pick in a browser, and New bin inside still', async () => {
    await mount(BROWSER)
    fireEvent.contextMenu(treeRow('Day 1'))
    const menu = document.querySelector('.ui-menu')
    expect(menu.textContent).not.toContain('Add files…')
    expect(menu.textContent).not.toContain('Add a folder…')
    expect(menu.textContent).toContain('New bin inside')
  })
  it('CONTROL: the desktop signed in keeps Add, with Files… and Folder…, and its bin menu the picks', async () => {
    await mount(DESKTOP)
    expect(newBinBtn()).toBeNull()
    fireEvent.contextMenu(treeRow('Day 1'))
    expect(document.querySelector('.ui-menu').textContent).toContain('Add files…')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }))
    expect(screen.getByRole('button', { name: /^Files…/ })).toBeTruthy()
  })
})

describe('no control without its verb (the capability object says which)', () => {
  it('a browser\'s file menu offers neither Open, Reveal nor Read columns again; the desktop\'s offers all three', async () => {
    await mount(BROWSER)
    fireEvent.contextMenu(tiles()[0])
    const menu = document.querySelector('.ui-menu').textContent
    for (const w of ['Open in default app', 'Reveal in Explorer', 'Read columns again']) expect(menu).not.toContain(w)
    expect(menu).toContain('Assign to shot…')
    expect(menu).toContain('Remove from bin')
    cleanup()
    await mount(DESKTOP)
    fireEvent.contextMenu(tiles()[0])
    const desktop = document.querySelector('.ui-menu').textContent
    for (const w of ['Open in default app', 'Reveal in Explorer', 'Read columns again']) expect(desktop).toContain(w)
  })
  it('a browser\'s inspector has no Open, no Reveal and no re-read; no "no decoder" in the toolbar', async () => {
    await mount(BROWSER)
    pick('T1')
    expect(screen.queryByTitle('Open with the default app')).toBeNull()
    expect(screen.queryByTitle('Show the file in Explorer')).toBeNull()
    expect(screen.queryByTitle('Read the technical columns again')).toBeNull()
    expect(document.body.textContent).not.toContain('no decoder')
  })
  it('CONTROL: on the desktop signed in (ffmpeg absent) they are there, and so is "no decoder"', async () => {
    await mount(DESKTOP)
    pick('T1')
    expect(screen.getByTitle('Open with the default app')).toBeTruthy()
    expect(screen.getByTitle('Show the file in Explorer')).toBeTruthy()
    expect(screen.getByTitle('Read the technical columns again')).toBeTruthy()
    expect(document.body.textContent).toContain('no decoder')
  })
})

describe('B3 in a browser: every row marked, none dimmed, no count', () => {
  it('each tile keeps the poster\'s "not on this computer" mark (BC2\'s scrim) and carries no dim; the list rows neither', async () => {
    await mount(BROWSER)
    // Every poster is marked (BinPoster's scrim, keyed on the row) — the mark
    // BC2 drew — and the inspector writes the words under it.
    expect(document.querySelectorAll('.bn-tile .bn-poster[data-offline="true"] .bn-scrim')).toHaveLength(3)
    pick('Clip 1')
    expect(document.querySelector('[data-testid="not-here"] .bn-poster[data-offline="true"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="not-here"]').textContent).toContain('Not on this computer')
    // …and no tile or row takes the dim.
    expect(document.querySelectorAll('.bn-tile[data-offline="true"]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(document.querySelectorAll('tbody tr.bn-trow')).toHaveLength(3)
    expect(document.querySelectorAll('tbody tr.bn-trow[data-offline="true"]')).toHaveLength(0)
  })
  it('CONTROL: on the desktop signed in a row this computer cannot reach IS dimmed, in the frame view and the list', async () => {
    await mount(DESKTOP, reviewer(), { binFiles: rowsFor(DESKTOP).map((r, i) => (i === 1 ? { ...r, online: false } : r)) })
    expect(document.querySelectorAll('.bn-tile[data-offline="true"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(document.querySelectorAll('tbody tr.bn-trow[data-offline="true"]')).toHaveLength(1)
  })
  it('no "N not on this computer" in the toolbar, the filters or the tree; the desktop counts its one', async () => {
    await mount(BROWSER)
    expect(screen.queryByTitle(/^Find the footage locations of the clips not on this computer/)).toBeNull()
    expect(screen.getByTestId('bins-project-count').textContent).toBe('3 files in 1 bin')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(document.body.textContent).not.toMatch(/\d+ not on this computer/)
    cleanup()
    await mount(DESKTOP, reviewer(), { binFiles: rowsFor(DESKTOP).map((r, i) => (i === 1 ? { ...r, online: false } : r)) })
    expect(screen.getByTestId('bins-project-count').textContent).toBe('3 files in 1 bin · 1 not on this computer')
    expect(screen.getByTitle(/^Find the footage locations of the clips not on this computer/)).toBeTruthy()
  })
})

describe('the inspector in a browser', () => {
  it('says the browser\'s sentence under the picture, names the desktop app and the location, keeps the marks and the logging live, and hints at Space', async () => {
    await mount(BROWSER)
    pick('Clip 1')
    const here = document.querySelector('[data-testid="not-here"]')
    expect(here.textContent).toContain('Not on this computer')
    expect(here.textContent).toContain(browserClipSentence('Footage NAS'))
    expect(browserClipSentence('Footage NAS')).toContain('desktop app')
    expect(here.textContent).toContain(POSTER_LARGE_HINT)
    expect(here.textContent).not.toContain('not reachable from this computer')
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getAllByTitle('Select (S)').some(b => !b.disabled)).toBe(true)
    expect(screen.getByPlaceholderText('24A').disabled).toBe(false)
    const text = document.body.textContent
    expect(text).toContain('LocationFootage NAS')
    expect(text).toContain('PathA001/C001.mp4')
    expect(text).toContain('Added bySofia Aldana')
  })
  it('the fixtures (rows answered for, nothing streams): the picture with the play sentence, no Open button', async () => {
    await mount(FIXTURES)
    pick('Clip 1')
    const panel = document.querySelector('[data-testid="no-stream"]')
    expect(panel.textContent).toContain(PLAY_NEEDS_DESKTOP)
    expect(panel.textContent).toContain(POSTER_LARGE_HINT)
    expect(screen.queryByRole('button', { name: /Open in default app/ })).toBeNull()
    expect(document.querySelector('video')).toBeNull()
  })
  it('CONTROL: on the desktop signed in the same clip plays through the desktop', async () => {
    await mount(DESKTOP)
    pick('Clip 1')
    expect(document.querySelector('video[controls]').getAttribute('src')).toBe('/api/rabbit/cloud-bins/stream?id=f1')
  })
})

describe('Space shows the picture large where nothing plays', () => {
  it('Space opens it on the current clip, Space puts it away; Esc closes it and keeps the selection', async () => {
    await mount(BROWSER)
    await key({ key: 'ArrowDown' })
    expect(large()).toBeNull()
    await key({ key: ' ', code: 'Space' })
    expect(large()).toBeTruthy()
    expect(within(large()).getByText('Clip 0')).toBeTruthy()
    expect(large().textContent).toContain(NOT_ON_THIS_COMPUTER)
    expect(large().textContent).toContain(browserClipSentence('Footage NAS'))
    await key({ key: ' ', code: 'Space' })
    expect(large()).toBeNull()
    await key({ key: ' ', code: 'Space' })
    await key({ key: 'Escape' })
    expect(large()).toBeNull()
    expect(tiles().filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    await key({ key: 'Escape' })
    expect(tiles().filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(0)
  })
  it('the arrows move under it and it follows; S marks the clip it shows; a held Space does not flicker it', async () => {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...rest) => (el?.hasAttribute?.('data-bin-grid') ? { gridTemplateColumns: '10px' } : real(el, ...rest)))
    await mount(BROWSER)
    await key({ key: 'ArrowDown' })
    await key({ key: ' ', code: 'Space' })
    await key({ key: 'ArrowDown' })
    expect(within(large()).getByText('Clip 1')).toBeTruthy()
    await key({ key: 's' })
    expect(state.ctx.updateBinFile).toHaveBeenCalledWith('f1', { review_flag: 'select' })
    await key({ key: ' ', code: 'Space', repeat: true })
    expect(large()).toBeTruthy()
    fireEvent.click(within(large()).getByTitle('Close (Space)'))
    expect(large()).toBeNull()
  })
  it('CONTROL: on the desktop signed in, Space is the preview\'s (it plays) and opens no picture', async () => {
    const play = vi.fn(() => Promise.resolve())
    const proto = window.HTMLMediaElement.prototype
    const saved = { play: proto.play, paused: Object.getOwnPropertyDescriptor(proto, 'paused') }
    proto.play = play
    Object.defineProperty(proto, 'paused', { configurable: true, get: () => true })
    try {
      await mount(DESKTOP)
      await key({ key: 'ArrowDown' })
      await act(async () => {})
      await key({ key: ' ', code: 'Space' })
      expect(large()).toBeNull()
      expect(play).toHaveBeenCalledTimes(1)
    } finally {
      proto.play = saved.play
      if (saved.paused) Object.defineProperty(proto, 'paused', saved.paused)
    }
  })
  it('the picture large is laid over the pane, not on the overlay stack: no dialog, no menu', async () => {
    await mount(BROWSER)
    await key({ key: 'ArrowDown' })
    await key({ key: ' ', code: 'Space' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(large().closest('.bn-pane')).toBeTruthy()
  })
})

describe('keyboard review works with no preview; hover-scrub is off; a drop from the OS is answered', () => {
  it('S, R and U mark the selection in a browser', async () => {
    await mount(BROWSER)
    await key({ key: 'ArrowDown' })
    await key({ key: 'r' })
    expect(state.ctx.updateBinFile).toHaveBeenLastCalledWith('f0', { review_flag: 'reject' })
    await key({ key: 'u' })
    expect(state.ctx.updateBinFile).toHaveBeenLastCalledWith('f0', { review_flag: 'unflagged' })
  })
  it('moving across a tile mounts no video in a browser — nor on the fixtures, whose rows are answered for but stream nothing; on the desktop it scrubs', async () => {
    await mount(BROWSER)
    const t = tiles()[0]
    fireEvent.mouseEnter(t); fireEvent.mouseMove(t, { clientX: 10 })
    expect(document.querySelector('video')).toBeNull()
    cleanup()
    // The capability object decides, not the row's reach: a stream URL the
    // backend would answer is never asked for where `stream` is false.
    await mount(FIXTURES, reviewer(), { binFileStreamUrl: vi.fn((id) => `/would-stream/${id}`) })
    const f = tiles()[0]
    fireEvent.mouseEnter(f); fireEvent.mouseMove(f, { clientX: 10 })
    expect(document.querySelector('video')).toBeNull()
    cleanup()
    await mount(DESKTOP)
    const d = tiles()[0]
    fireEvent.mouseEnter(d); fireEvent.mouseMove(d, { clientX: 10 })
    expect(document.querySelector('.bn-tile video')).toBeTruthy()
  })
  it('a drop of files on the pane says the sentence and reads nothing; the pane is no target for it', async () => {
    await mount(BROWSER)
    const pane = document.querySelector('.bn-pane')
    const over = createEvent.dragOver(pane, { dataTransfer: { types: ['Files'], files: [], dropEffect: 'copy' } })
    fireEvent(pane, over)
    expect(over.dataTransfer.dropEffect).toBe('none')
    expect(document.querySelector('.bn-drop')).toBeNull()
    await act(async () => { fireEvent.drop(pane, { dataTransfer: { types: ['Files'], files: [{ name: 'x.mov' }] } }) })
    expect(document.body.textContent).toContain(ADD_NEEDS_DESKTOP)
    expect(state.ctx.prepareBinFiles).not.toHaveBeenCalled()
    // …and a drop anywhere else on the page (the tree, the inspector) too.
    await act(async () => { fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [{ name: 'y.mov' }] } }) })
    expect(state.ctx.prepareBinFiles).not.toHaveBeenCalled()
  })
})

describe('the empty states in a browser', () => {
  it('no bins: the catalogue\'s words, the starters, no Import a folder', async () => {
    await mount(BROWSER, reviewer(), { bins: [], binFiles: [] })
    expect(document.body.textContent).toContain(CATALOGUE_EMPTY_BINS_SENTENCE)
    expect(document.body.textContent).not.toContain('drop a folder anywhere')
    expect(screen.getByRole('button', { name: /One bin per media type/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Import a folder/ })).toBeNull()
  })
  it('an empty bin: the add sentence, no Add buttons', async () => {
    await mount(BROWSER, reviewer(), { binFiles: [] })
    expect(document.body.textContent).toContain(ADD_NEEDS_DESKTOP)
    expect(screen.queryByRole('button', { name: /Add files…/ })).toBeNull()
  })
  it('CONTROL: the desktop\'s no-bins state keeps "drop a folder anywhere on this page"', async () => {
    await mount(DESKTOP, reviewer(), { bins: [], binFiles: [] })
    expect(document.body.textContent).toContain('drop a folder anywhere on this page')
  })
})

describe('a shot\'s takes: the word for a clip this computer cannot reach', () => {
  const shot = { id: 'sh1', name: 'Shot 1', shot_number: 1, frame_count: 0 }
  const entry = (file) => ({ take: { id: 't1', shot_id: 'sh1', bin_file_id: file.id, role: 'primary', position: 0, notes: '' }, file })
  it('a company\'s clip says "not on this computer" (B3); the signed-out desktop\'s says "offline" (B12)', () => {
    render(<ShotTakesPanel shot={shot} entries={[entry({ id: 'f1', display_name: 'T1', original_name: 'T1.mp4', media_type: 'video', location_id: 'L1', online: false })]} fps={24} canWrite />)
    expect(document.body.textContent).toContain(NOT_ON_THIS_COMPUTER)
    expect(document.body.textContent).not.toMatch(/\boffline\b/)
    cleanup()
    render(<ShotTakesPanel shot={shot} entries={[entry({ id: 'f2', display_name: 'T2', original_name: 'T2.mp4', media_type: 'video', source_path: 'D:\\x\\T2.mp4', online: false })]} fps={24} canWrite />)
    expect(document.body.textContent).toContain('offline')
    expect(document.body.textContent).not.toContain(NOT_ON_THIS_COMPUTER)
  })
})

describe('the dev server on 5286, proven by a BC3-only module', () => {
  it('.claude/launch.json has bc3-worktree on 5286, strict, and the module it names exists in this tree', () => {
    const launch = JSON.parse(readFileSync(resolve(process.cwd(), '..', '.claude', 'launch.json'), 'utf8'))
    const entry = launch.configurations.find(c => c.name === 'bc3-worktree')
    expect(entry).toBeTruthy()
    expect(entry.port).toBe(5286)
    expect(entry.runtimeArgs).toEqual(expect.arrayContaining(['vite', '--port', '5286', '--strictPort']))
    const named = /src\/tools\/rabbit_v0\.1\.0\/bins\/browserCatalogue\.js/.exec(entry._comment)?.[0]
    expect(named).toBeTruthy()
    expect(existsSync(resolve(process.cwd(), named))).toBe(true)
  })
})
