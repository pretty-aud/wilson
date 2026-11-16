// @vitest-environment jsdom
// MothPage.s4.test.jsx — MO4 (0130 to 0133): the page's Session 4, mounted against a fake adapter. A board is a dot
// of its own colour and opens on a click; closing it brings back the graph's camera and selection; "New board" in a
// folder's menu; the trash lists folders and boards with Bring back; on this computer alone there is no board, and
// the menu says why. The panel is a stand-in here (board/BoardPanel.test.jsx mounts the real one).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'

const state = vi.hoisted(() => ({ rabbit: null, perms: null, panels: [] }))
vi.mock('../rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => state.rabbit }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => state.perms }))
vi.mock('../../components/TeamMembers/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({ members: [{ user_id: 'u1', display_name: 'Mara Okonkwo', username: 'mara.okonkwo' }] }),
}))
vi.mock('../../cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => null, fetchStorageUsage: async () => null }))
vi.mock('./board/BoardPanel.jsx', async () => {
  const { createElement: h } = await import('react')
  const BoardPanel = (props) => {
    state.panels.push(props)
    return h('div', { 'data-test-panel': props.board.id },
      h('span', null, `Board ${props.board.title}`),
      h('button', { type: 'button', onClick: () => props.onClose({ how: 'button' }) }, 'Close the test board'),
      h('button', { type: 'button', onClick: () => props.onClose({ how: 'gone', words: 'You cannot see this board any more, so it was closed.' }) }, 'Lose the test board'),
      h('button', { type: 'button', onClick: () => props.onClose({ how: 'trashed', words: 'The board is in the trash. You can bring it back from Moth\'s trash for 30 days.' }) }, 'Trash the test board'),
      h('button', { type: 'button', onClick: () => props.onSize('filled') }, 'Fill the test board'))
  }
  return { BoardPanel, default: BoardPanel }
})

import MothPage, { BOARD_DOT_COLOUR } from './MothPage.jsx'
import { keepLeaving, leavingOf, whoKey } from './board/boardPanelState.js'
import { MothHelp, GLIDE_WORDS } from './components/MothSettings.jsx'
import { BOARD_NEEDS_CLOUD } from './board/boardPanelState.js'
import { FOLDERS_FAILED_SENTENCE } from './components/MothTrashView.jsx'
import { boardPlaces, startPlace, TOP_WORDS, NO_PLACE_WORDS } from './components/MothNewBoard.jsx'
import { itemMenu, renameGate, RENAME_WORDS } from './components/MothItemMenu.jsx'

const island = (id, extra = {}) => ({
  id, title: `Project ${id}`, is_personal: false, is_mine: false, is_private: false, my_project_role: 'member', is_staffed: true, can_write: true, ...extra,
})
const MINE = island('me', { title: 'Personal space', is_personal: true, is_mine: true, is_private: true })
const file = (id) => ({ id, name: `${id}.mov`, storage_path: `x/${id}.mov`, storage_provider: 'supabase', project_id: 'p1' })
const DAY = 86400000
const trashed = (id, extra = {}) => ({
  id, project_id: 'p1', project_title: 'Project p1', name: id, is_board: false, files: 0,
  deleted_at: new Date(Date.now() - DAY).toISOString(), deleted_by_label: 'Theo Lindqvist',
  purges_at: new Date(Date.now() + 4.5 * DAY).toISOString(), can_restore: true, ...extra,
})

const worlds = []
function fakeWorld() {
  const w = {
    graphs: [], handlers: {}, selection: [], flown: [], active: null, colourOf: null, cam: { x: 5, y: 6, k: 2 },
    setGraph(g, o) { w.graphs.push({ g, o }) }, relayout() {}, positions: () => ({}),
    setAppearance(a) { if (a && 'colourOf' in a) w.colourOf = a.colourOf },
    setReducedMotion() {}, setRules(r) { w.rules = r }, setActive(v) { w.active = v }, resize() {}, setSelection(s) { w.selection = s },
    setCarry(v) { w.carry = v }, setGlide(v) { w.glide = v },
    flyTo(id) { w.flown.push(id); return true }, on(event, fn) { w.handlers[event] = fn },
    renderer: {
      hitTest: () => null,
      camera: () => w.cam,
      setCamera: vi.fn((c) => { w.cam = c }),
      screenOf: (id) => (id === 'folder:bf' ? { x: 120, y: 80, r: 6 } : null),
    },
    destroy() {},
  }
  worlds.push(w)
  return w
}

let adapter
let made
beforeEach(() => {
  state.panels.length = 0
  made = []
  adapter = {
    ensurePersonalSpace: vi.fn(async () => 'me'),
    listMothIslands: vi.fn(async () => [MINE, island('p1')]),
    listMothFolders: vi.fn(async (pid) => (pid === 'p1'
      ? [{ id: 'bf', label: 'Plans', slug: 'plans', path: 'plans', parent_id: null }, { id: 'f2', label: 'Refs', slug: 'refs', path: 'refs', parent_id: null }]
      : [])),
    listMothFiles: vi.fn(async (pid) => (pid === 'p1' ? [file('a'), file('b')] : [])),
    listTrashedFiles: vi.fn(async () => []),
    getMothPrefs: vi.fn(async () => ({ first_visit_done: true })),
    setMothPrefs: vi.fn(async (patch) => ({ first_visit_done: true, ...patch })),
    listMothViews: vi.fn(async () => []),
    listBoards: vi.fn(async (pid) => (pid === 'p1' ? [{ id: 'b1', folder_id: 'bf', project_id: 'p1', audience_gen: 1, revision: 0 }, ...made] : [])),
    createBoard: vi.fn(async (pid, parent, title) => {
      made.push({ id: 'b2', folder_id: 'nf', project_id: pid, audience_gen: 1, revision: 0 })
      return { board_id: 'b2', folder_id: 'nf', project_id: pid, title: title || 'Board', path: 'board' }
    }),
    listTrashedFolders: vi.fn(async () => []),
    restoreFolders: vi.fn(async () => ({ folders: 1, files: 0 })),
  }
  state.rabbit = { getAdapter: () => adapter, adapterMode: 'supabase', noteFilesChangedElsewhere: vi.fn(), showUndoToast: vi.fn() }
  state.perms = { role: 'member', ready: true, userId: 'u1', workspaceId: 'w1' }
})
afterEach(() => { cleanup(); worlds.length = 0 })

const world = async () => {
  await waitFor(() => expect(worlds.at(-1)?.handlers.pick).toBeTruthy())
  await waitFor(() => expect(worlds.at(-1).graphs.at(-1)?.g.nodes.some((n) => n.id === 'project:p1')).toBe(true))
  return worlds.at(-1)
}
const boardsRead = async (w) => {
  await waitFor(() => expect(w.colourOf?.({ kind: 'folder', rowId: 'bf' })).toBe(BOARD_DOT_COLOUR))
}
const intoProject = async (name = 'Project p1') => {
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByText('a.mov')
}
const panel = () => document.querySelector('[data-test-panel]')

describe('🚨 a board on the graph', () => {
  it('is a dot of its own colour, read per project', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    expect(adapter.listBoards).toHaveBeenCalledWith('p1')
    expect(adapter.listBoards).toHaveBeenCalledWith('me')
    expect(w.colourOf({ kind: 'folder', rowId: 'f2' })).not.toBe(BOARD_DOT_COLOUR)
    expect(w.colourOf({ kind: 'file', rowId: 'bf' })).not.toBe(BOARD_DOT_COLOUR)
  })
  it('a project whose boards could not be read changes nothing else', async () => {
    adapter.listBoards = vi.fn(async (pid) => { if (pid === 'me') throw new Error('x'); return pid === 'p1' ? [{ id: 'b1', folder_id: 'bf', project_id: 'p1' }] : [] })
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    expect(document.querySelector('[data-moth-error]')).toBeNull()
  })
  it('a click on its dot opens it; closing brings back the camera and the selection', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('project:p1', {}))
    await waitFor(() => expect(w.selection).toEqual(['project:p1']))
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(panel().dataset.testPanel).toBe('b1')
    const props = state.panels.at(-1)
    expect(props.board).toEqual({ id: 'b1', folder_id: 'bf', project_id: 'p1', title: 'Plans' })
    expect(props.origin).toEqual({ x: 120, y: 80 })
    expect(props.me).toEqual({ id: 'u1', label: 'Mara Okonkwo' })
    expect(props.companyId).toBe('w1')
    expect(props.adapter).toBe(adapter)
    // The camera moves while it is open; closing puts it back, and the selection with it.
    w.cam = { x: 400, y: 300, k: 0.5 }
    fireEvent.click(screen.getByRole('button', { name: 'Close the test board' }))
    await waitFor(() => expect(panel()).toBeNull())
    expect(w.renderer.setCamera).toHaveBeenCalledWith({ x: 5, y: 6, k: 2 })
    expect(w.selection).toEqual(['project:p1'])
  })
  it('a shift-click selects it as any dot, and opens nothing', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', { additive: true }))
    await waitFor(() => expect(w.selection).toEqual(['folder:bf']))
    expect(panel()).toBeNull()
  })
  it('a plain folder\'s dot does not open a board', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:f2', {}))
    await waitFor(() => expect(w.selection).toEqual(['folder:f2']))
    expect(panel()).toBeNull()
  })
  it('filling the view, the map stops drawing; closed, it draws again', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(w.active).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Fill the test board' }))
    await waitFor(() => expect(w.active).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Close the test board' }))
    await waitFor(() => expect(w.active).toBe(true))
  })
  it('🚨 a board closed because access went says why', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Lose the test board' }))
    expect(await screen.findByText('You cannot see this board any more, so it was closed.')).toBeTruthy()
    expect(panel()).toBeNull()
  })
  it('🚨 a board put in the trash leaves the graph, says so, and the trash lists it with Bring back', async () => {
    let gone = false
    adapter.listBoards = vi.fn(async (pid) => (pid === 'p1' && !gone ? [{ id: 'b1', folder_id: 'bf', project_id: 'p1' }] : []))
    adapter.listTrashedFolders = vi.fn(async () => (gone ? [trashed('Plans', { id: 'bf', is_board: true, files: 2 })] : []))
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    const boardsBefore = adapter.listBoards.mock.calls.length
    const foldersBefore = adapter.listMothFolders.mock.calls.length
    gone = true
    fireEvent.click(screen.getByRole('button', { name: 'Trash the test board' }))
    await waitFor(() => expect(panel()).toBeNull())
    expect(await screen.findByText('The board is in the trash. You can bring it back from Moth\'s trash for 30 days.')).toBeTruthy()
    // Its dot is no board's colour at once, its project is read again, and so are the boards.
    await waitFor(() => expect(w.colourOf?.({ kind: 'folder', rowId: 'bf' }) ?? null).not.toBe(BOARD_DOT_COLOUR))
    await waitFor(() => expect(adapter.listBoards.mock.calls.length).toBeGreaterThan(boardsBefore))
    await waitFor(() => expect(adapter.listMothFolders.mock.calls.length).toBeGreaterThan(foldersBefore))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['p1'])
    expect(w.renderer.setCamera).toHaveBeenCalledWith({ x: 5, y: 6, k: 2 })
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    const row = await waitFor(() => { const r = document.querySelector('[data-moth-trash-folder="board"]'); expect(r).toBeTruthy(); return r })
    expect(row.textContent).toMatch(/Board Plans/)
    expect(within(row).getByRole('button', { name: 'Bring back' })).toBeTruthy()
  })
  // A sticky or a dropped file is a real file in the board's folder, made while the board was open: the map and
  // R.A.B.B.I.T.'s Files hear of it when the board closes (seen in a running browser: without this the board's own
  // folder said "Nothing here" after a picture was dropped on the board).
  it('closed for any other reason, a board stays on the graph, and its project is read again', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    const before = adapter.listBoards.mock.calls.length
    const foldersBefore = adapter.listMothFolders.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Close the test board' }))
    await waitFor(() => expect(panel()).toBeNull())
    expect(w.colourOf({ kind: 'folder', rowId: 'bf' })).toBe(BOARD_DOT_COLOUR)
    expect(adapter.listBoards.mock.calls.length).toBe(before)
    await waitFor(() => expect(adapter.listMothFolders.mock.calls.length).toBeGreaterThan(foldersBefore))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['p1'])
  })
  it('🚨 another account or company closes the open board', async () => {
    const view = render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => w.handlers.pick('folder:bf', {}))
    await waitFor(() => expect(panel()).toBeTruthy())
    state.perms = { ...state.perms, workspaceId: 'w2' }
    view.rerender(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => expect(panel()).toBeNull())
  })
  it('🚨 another account with no board open drops a close that is still trying; the same account keeps it', async () => {
    // A board closed while its last changes could not reach the server: its store keeps trying after the close.
    // The same board closed twice, the first close still trying: both are held, and both go.
    const mine = { store: { dispose: vi.fn() }, who: whoKey({ id: 'u1' }, 'w1') }
    const again = { store: { dispose: vi.fn() }, who: whoKey({ id: 'u1' }, 'w1') }
    keepLeaving('board-still-saving', mine)
    keepLeaving('board-still-saving', again)
    const view = render(<MothPage worldFactory={fakeWorld} />)
    await world()
    expect(panel()).toBeNull()
    view.rerender(<MothPage worldFactory={fakeWorld} />)
    expect(mine.store.dispose).not.toHaveBeenCalled()
    expect(leavingOf('board-still-saving')).toEqual([mine, again])
    // Someone else signs in on this computer while no board is open: what was waiting must not go out as them.
    state.perms = { ...state.perms, userId: 'u2' }
    view.rerender(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => expect(mine.store.dispose).toHaveBeenCalledWith({ save: false }))
    expect(again.store.dispose).toHaveBeenCalledWith({ save: false })
    expect(leavingOf('board-still-saving')).toEqual([])
  })
  it('🚨 Ctrl+Z is the board\'s while it is open, and Moth\'s again after', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    try {
      act(() => w.handlers.pick('folder:bf', {}))
      await waitFor(() => expect(panel()).toBeTruthy())
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(heard).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Close the test board' }))
      await waitFor(() => expect(panel()).toBeNull())
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(heard).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', heard)
    }
  })
})

describe('🚨 New board, in a folder\'s menu', () => {
  it('in a project, named, makes the board, opens it and reads the project again', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    const reads = adapter.listMothFolders.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New board' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Storyboard  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the board' }))
    await waitFor(() => expect(adapter.createBoard).toHaveBeenCalledWith('p1', null, 'Storyboard'))
    await waitFor(() => expect(panel()).toBeTruthy())
    expect(state.panels.at(-1).board).toMatchObject({ id: 'b2', folder_id: 'nf', project_id: 'p1', title: 'Storyboard' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(adapter.listMothFolders.mock.calls.length).toBeGreaterThan(reads))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['p1'])
    // Its dot is a board's, and the boards are read again.
    expect(worlds.at(-1).colourOf({ kind: 'folder', rowId: 'nf' })).toBe(BOARD_DOT_COLOUR)
    await waitFor(() => expect(adapter.listBoards.mock.calls.filter(([pid]) => pid === 'p1').length).toBeGreaterThan(1))
    await waitFor(() => expect(worlds.at(-1).colourOf({ kind: 'folder', rowId: 'nf' })).toBe(BOARD_DOT_COLOUR))
  })
  it('in a folder, with no name, the server names it', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: /Refs/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'More for this folder' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New board' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Enter' })
    await waitFor(() => expect(adapter.createBoard).toHaveBeenCalledWith('p1', 'f2', null))
    await waitFor(() => expect(panel()).toBeTruthy())
  })
  it('a refusal is said in the question, which stays', async () => {
    adapter.createBoard = vi.fn(async () => { throw Object.assign(new Error('A project holds at most 500 boards.'), { code: '54000' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New board' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the board' }))
    expect(await within(dialog).findByText('A project holds at most 500 boards.')).toBeTruthy()
    expect(panel()).toBeNull()
  })
  it('the server\'s one refusal for missing and not allowed is said plainly', async () => {
    adapter.createBoard = vi.fn(async () => { throw Object.assign(new Error('folder not found or not writable'), { code: '42501' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New board' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the board' }))
    expect(await within(dialog).findByText(/^You cannot make a board here\./)).toBeTruthy()
  })
  it('a reviewer is not offered one, and is told why', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1', { my_project_role: 'reviewer', can_write: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    const item = await screen.findByRole('button', { name: 'New board' })
    expect(item.disabled).toBe(true)
    expect(adapter.createBoard).not.toHaveBeenCalled()
  })
  it('inside a board\'s folder: it is called a board, there is no New board, and Open board opens it', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    await intoProject()
    const row = screen.getByRole('button', { name: /Plans/ })
    expect(row.textContent).toMatch(/^Board/)
    fireEvent.click(row)
    const open = await screen.findByRole('button', { name: 'Open board' })
    expect(screen.queryByRole('button', { name: 'More for this folder' })).toBeNull()
    fireEvent.click(open)
    await waitFor(() => expect(panel()?.dataset.testPanel).toBe('b1'))
  })
})

// MO5 item 3: a New board button always in sight, a dialog asking the name and where it goes, starting on the folder
// selected; almost any folder may hold a board (0138), never another board's; where none may be made, it says why.
describe('🚨 MO5 3: New board… in the strip, and where the board goes', () => {
  const FOLDERS = [
    { id: 'root', kind: 'root', parent_id: null, path: '', slug: 'p', label: 'Project' },
    { id: 'assets', kind: 'category', parent_id: 'root', path: 'ASSETS', slug: 'ASSETS', label: 'ASSETS' },
    { id: 'mira', kind: 'entity', parent_id: 'assets', path: 'ASSETS/mira', slug: 'mira', label: 'Mira' },
    { id: 'bf', kind: 'custom', parent_id: 'root', path: 'plans', slug: 'plans', label: 'Plans' },
    { id: 'inbf', kind: 'custom', parent_id: 'bf', path: 'plans/old', slug: 'old', label: 'Old' },
  ]
  it('the picker lists the top first, every folder under its parent, a thing\'s own among them, and never a board\'s', () => {
    const places = boardPlaces(FOLDERS, (id) => id === 'bf')
    expect(places.map((p) => [p.id, p.depth, p.label])).toEqual([[null, 0, TOP_WORDS], ['assets', 1, 'ASSETS'], ['mira', 2, 'Mira']])
  })
  it('it starts on the folder selected; a board\'s own folder (or one below it) starts on the folder that holds the board', () => {
    const islands = [island('p1'), island('p2')]
    const foldersOf = () => FOLDERS
    const isBoard = (id) => id === 'bf'
    expect(startPlace({ start: { projectId: 'p1', folderId: 'mira' }, islands, foldersOf, isBoard })).toEqual({ projectId: 'p1', folderId: 'mira' })
    expect(startPlace({ start: { projectId: 'p1', folderId: 'inbf' }, islands, foldersOf, isBoard })).toEqual({ projectId: 'p1', folderId: null })
    expect(startPlace({ start: { projectId: 'p1', folderId: 'root' }, islands, foldersOf, isBoard })).toEqual({ projectId: 'p1', folderId: null })
    // Nothing selected: the first project a board may be made in.
    expect(startPlace({ start: null, islands, foldersOf, isBoard, gateOf: (pid) => ({ allowed: pid === 'p2' }) })).toEqual({ projectId: 'p2', folderId: null })
  })
  it('the strip\'s button opens the question on the folder the list is inside, and makes the board there', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: /Refs/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New board…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Project').value).toBe('p1')
    expect(within(dialog).getByLabelText('Where it goes').selectedOptions[0].textContent.trim()).toBe('Refs')
    // A board's own folder is no place for another board.
    expect([...within(dialog).getByLabelText('Where it goes').options].map((o) => o.textContent.trim())).toEqual([TOP_WORDS, 'Refs'])
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Moodboard' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the board' }))
    await waitFor(() => expect(adapter.createBoard).toHaveBeenCalledWith('p1', 'f2', 'Moodboard'))
    await waitFor(() => expect(panel()).toBeTruthy())
  })
  it('another place may be chosen; a project the person may not change is greyed with why, and nothing is made there', async () => {
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1'), island('p3', { title: 'Look only', my_project_role: 'reviewer', can_write: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    fireEvent.click(screen.getByRole('button', { name: 'New board…' }))
    const dialog = await screen.findByRole('dialog')
    const project = within(dialog).getByLabelText('Project')
    const looking = [...project.options].find((o) => o.value === 'p3')
    expect(looking.disabled).toBe(true)
    expect(looking.textContent).toMatch(/\(you may not change it\)$/)
    fireEvent.change(project, { target: { value: 'me' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the board' }))
    await waitFor(() => expect(adapter.createBoard).toHaveBeenCalledWith('me', null, null))
  })
  it('with no project to change, the button is greyed and says why', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1', { my_project_role: 'reviewer', can_write: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject()
    expect(document.querySelector('[data-moth-new-board]').disabled).toBe(true)
    expect(screen.getByTitle(NO_PLACE_WORDS).contains(document.querySelector('[data-moth-new-board]'))).toBe(true)
  })
})

// MO5 item 8: a right-click (or Shift+F10 on a row) opens a menu with what the list's menus offer there and Rename;
// WILSON's own folders keep their names, greyed with why.
describe('🚨 MO5 8: an item\'s menu, and Rename', () => {
  const words = (items) => items.map((i) => (i.header ? `# ${i.header}` : `${i.disabled ? '[x] ' : ''}${i.label}`))
  const folders = {
    root: { id: 'root', kind: 'root', parent_id: null, path: '' },
    assets: { id: 'assets', kind: 'category', parent_id: 'root', label: 'ASSETS' },
    mira: { id: 'mira', kind: 'entity', entity_type: 'asset', parent_id: 'assets', label: 'Mira' },
    mine: { id: 'mine', kind: 'custom', parent_id: 'root', label: 'Mine' },
    bf: { id: 'bf', kind: 'custom', parent_id: 'root', label: 'Plans' },
  }
  const ctx = (extra = {}) => ({
    index: { rows: new Map(Object.values(folders).filter((f) => f.kind !== 'root').map((f) => [`folder:${f.id}`, { id: `folder:${f.id}`, kind: 'folder', rowId: f.id, projectId: 'p1', label: f.label }])
      .concat([['project:p1', { id: 'project:p1', kind: 'project', rowId: 'p1', projectId: 'p1', label: 'Salt Hours' }],
        ['file:a', { id: 'file:a', kind: 'file', rowId: 'a', projectId: 'p1', label: 'a.mov' }],
        ['asset:x', { id: 'asset:x', kind: 'asset', rowId: 'x', projectId: 'p1', label: 'Mira' }]])) },
    boardOf: (fid) => (fid === 'bf' ? { id: 'b1', folder_id: 'bf', project_id: 'p1' } : null),
    underBoard: () => false,
    folderOf: (_pid, fid) => folders[fid] ?? null,
    fileOf: () => ({ id: 'a', managed: false }),
    boardGate: () => ({ allowed: true }),
    writeGate: () => ({ allowed: true }),
    cloud: true,
    jumpFor: (id) => (id === 'asset:x' ? { label: 'Open in R.A.B.B.I.T.' } : null),
    open: vi.fn(), show: vi.fn(), openBoard: vi.fn(), newBoard: vi.fn(), moveFile: vi.fn(), deleteFile: vi.fn(), rename: vi.fn(), jump: vi.fn(),
    ...extra,
  })
  it('WILSON\'s own folders keep their names, greyed with why; a person\'s own folder and a board are renamed', () => {
    expect(words(itemMenu('folder:assets', ctx()))).toEqual(['# ASSETS', 'Open', 'New board here…', '[x] Rename…', `# ${RENAME_WORDS.kept}`])
    expect(words(itemMenu('folder:mira', ctx()))).toEqual(['# Mira', 'Open', 'New board here…', '[x] Rename…', `# ${RENAME_WORDS.thing('asset')}`])
    const c = ctx()
    const mine = itemMenu('folder:mine', c)
    expect(words(mine)).toEqual(['# Mine', 'Open', 'New board here…', 'Rename…'])
    mine.find((i) => i.label === 'Rename…').onClick()
    expect(c.rename).toHaveBeenCalledWith({ id: 'folder:mine', projectId: 'p1', folderId: 'mine', name: 'Mine' })
    expect(words(itemMenu('folder:bf', ctx()))).toEqual(['# Plans', 'Open board', 'Rename board…'])
  })
  it('a project, a file and a thing are renamed in R.A.B.B.I.T.; a file moves and goes as the view panel says; a thing opens in its tool', () => {
    expect(words(itemMenu('project:p1', ctx()))).toEqual(['# Salt Hours', 'Open', 'New board here…', '[x] Rename…', `# ${RENAME_WORDS.project}`])
    expect(words(itemMenu('file:a', ctx()))).toEqual(['# a.mov', 'Show in the list', 'Move to…', 'Delete…', '[x] Rename…', `# ${RENAME_WORDS.elsewhere}`])
    expect(words(itemMenu('asset:x', ctx()))).toEqual(['# Mira', 'Show in the list', '[x] Rename…', `# ${RENAME_WORDS.elsewhere}`, 'Open in R.A.B.B.I.T.'])
  })
  it('what the person may not do is greyed with its reason: looking back, a project not theirs, this computer alone', () => {
    const back = ctx({ boardGate: () => ({ allowed: false, reason: 'Looking back changes nothing.' }), writeGate: () => ({ allowed: false, reason: 'Looking back changes nothing.' }) })
    expect(words(itemMenu('folder:mine', back))).toEqual(['# Mine', 'Open', '[x] New board here…', '# Looking back changes nothing.', '[x] Rename…', '# Looking back changes nothing.'])
    expect(words(itemMenu('file:a', back))).toEqual(['# a.mov', 'Show in the list', '[x] Move to…', '[x] Delete…', '# Looking back changes nothing.', '[x] Rename…', `# ${RENAME_WORDS.elsewhere}`])
    expect(renameGate(folders.mine, { cloud: false })).toEqual({ allowed: false, reason: RENAME_WORDS.local })
  })
  it('right-click on a row opens its menu; Rename… asks the name and renames through the adapter, and says so', async () => {
    adapter.renameFolder = vi.fn(async (fid, name) => ({ folder_id: fid, label: name, changed: true }))
    adapter.listMothFolders = vi.fn(async (pid) => (pid === 'p1' ? [{ id: 'f2', kind: 'custom', label: 'Refs', slug: 'refs', path: 'refs', parent_id: null }] : []))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    const row = await screen.findByRole('button', { name: /Refs/ })
    fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })
    const menu = document.querySelector('[data-moth-item-menu]')
    expect(menu.dataset.for).toBe('folder:f2')
    fireEvent.click(within(menu).getByRole('button', { name: 'Rename…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Name').value).toBe('Refs')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'References' } })
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Enter' })
    await waitFor(() => expect(adapter.renameFolder).toHaveBeenCalledWith('f2', 'References'))
    expect(await screen.findByText(RENAME_WORDS.done('References'))).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('from the keyboard: Shift+F10 on a row opens it with its first entry focused; Escape gives the focus back to the row', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    const row = await screen.findByRole('button', { name: /Refs/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open'))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-moth-item-menu]')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })
  it('a refusal is said in the question, which stays', async () => {
    adapter.renameFolder = vi.fn(async () => { throw Object.assign(new Error('folder not found or not writable'), { code: '42501' }) })
    adapter.listMothFolders = vi.fn(async (pid) => (pid === 'p1' ? [{ id: 'f2', kind: 'custom', label: 'Refs', slug: 'refs', path: 'refs', parent_id: null }] : []))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Refs/ }), { clientX: 40, clientY: 50 })
    fireEvent.click(within(document.querySelector('[data-moth-item-menu]')).getByRole('button', { name: 'Rename…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Other' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(await within(dialog).findByText(/^You cannot rename this folder\./)).toBeTruthy()
  })
})

describe('🚨 on this computer alone', () => {
  beforeEach(() => { state.rabbit.adapterMode = 'local_server' })
  it('MO5: the strip\'s New board… is greyed, and says boards need the cloud', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject('Project p1 · On this computer only')
    expect(document.querySelector('[data-moth-new-board]').disabled).toBe(true)
    expect(screen.getByTitle(BOARD_NEEDS_CLOUD).contains(document.querySelector('[data-moth-new-board]'))).toBe(true)
  })
  it('no board is asked for or offered, and the menu says why', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await intoProject('Project p1 · On this computer only')
    fireEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    expect(await screen.findByText(BOARD_NEEDS_CLOUD)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New board' })).toBeNull()
    expect(adapter.listBoards).not.toHaveBeenCalled()
    expect(adapter.createBoard).not.toHaveBeenCalled()
  })
  it('the trash asks for no folders', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText('Nothing here')).toBeTruthy()
    expect(screen.getByText('Files you delete stay here for 30 days.')).toBeTruthy()
    expect(adapter.listTrashedFolders).not.toHaveBeenCalled()
  })
})

describe('🚨 the trash: folders and boards', () => {
  it('are listed with Bring back, and one brought back is back on the graph', async () => {
    adapter.listTrashedFolders = vi.fn(async () => [
      trashed('Old refs', { id: 'tf1', files: 3 }),
      trashed('Moodboard', { id: 'tb1', is_board: true, files: 1 }),
    ])
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    const list = await waitFor(() => { const s = document.querySelector('[data-moth-trash-folders]'); expect(s).toBeTruthy(); return s })
    const folder = list.querySelector('[data-moth-trash-folder="folder"]')
    const board = list.querySelector('[data-moth-trash-folder="board"]')
    expect(folder.textContent).toMatch(/Folder Old refs/)
    expect(folder.textContent).toMatch(/with 3 files/)
    expect(folder.textContent).toMatch(/deleted by Theo Lindqvist/)
    expect(folder.textContent).toMatch(/goes in 5 days/)
    expect(board.textContent).toMatch(/Board Moodboard/)
    expect(board.textContent).toMatch(/with 1 file\b/)
    const boardsBefore = adapter.listBoards.mock.calls.length
    const foldersBefore = adapter.listMothFolders.mock.calls.length
    fireEvent.click(within(board).getByRole('button', { name: 'Bring back' }))
    await waitFor(() => expect(adapter.restoreFolders).toHaveBeenCalledWith(['tb1']))
    await waitFor(() => expect(adapter.listTrashedFolders.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(adapter.listBoards.mock.calls.length).toBeGreaterThan(boardsBefore))
    await waitFor(() => expect(adapter.listMothFolders.mock.calls.length).toBeGreaterThan(foldersBefore))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['p1'])
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
  it('a refusal to bring one back is said', async () => {
    adapter.listTrashedFolders = vi.fn(async () => [trashed('Inner', { id: 'ti' })])
    adapter.restoreFolders = vi.fn(async () => { throw Object.assign(new Error('The folder this one was in is in the trash too: bring that back first.'), { code: '22023' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bring back' }))
    expect(await screen.findByText('The folder this one was in is in the trash too: bring that back first.')).toBeTruthy()
  })
  it('one the project does not let this person change cannot be brought back', async () => {
    adapter.listTrashedFolders = vi.fn(async () => [trashed('Locked', { id: 'tl', can_restore: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    const button = await screen.findByRole('button', { name: 'Bring back' })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(adapter.restoreFolders).not.toHaveBeenCalled()
  })
  it('🚨 folders that could not be read are said apart from the files, and are not nothing', async () => {
    let fail = true
    adapter.listTrashedFolders = vi.fn(async () => { if (fail) throw new Error('x'); return [] })
    adapter.listTrashedFiles = vi.fn(async () => [{ id: 't', project_id: 'p1', name: 't.mov', project_title: 'Project p1', purges_at: new Date(Date.now() + 2.5 * DAY).toISOString(), can_restore: true }])
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(FOLDERS_FAILED_SENTENCE)).toBeTruthy()
    expect(screen.getByText('t.mov')).toBeTruthy()
    fail = false
    fireEvent.click(within(document.querySelector('[data-moth-trash-folders-failed]')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('[data-moth-trash-folders-failed]')).toBeNull())
  })
  it('nothing in either is nothing here', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText('Nothing here')).toBeTruthy()
    expect(screen.getByText('Files, folders and boards you delete stay here for 30 days.')).toBeTruthy()
  })
})

describe('Help', () => {
  it('says how a board opens, closes and is made, in plain words', () => {
    render(<MothHelp />)
    expect(screen.getByText('Boards')).toBeTruthy()
    expect(screen.getByText(/Click it to open it in a frame over the map/)).toBeTruthy()
    expect(screen.getByText(/choose New board from a folder's menu\. Boards need the project in the cloud\./)).toBeTruthy()
  })
  it('says what MO5 added: New board at the top, renaming, the magnet, the glide, the right-click menu, lines from dots', () => {
    render(<MothHelp />)
    expect(screen.getByText(/choose New board at the top of the map, name it and choose where it goes/)).toBeTruthy()
    expect(screen.getByText(/Click a board's name at its top to rename it\./)).toBeTruthy()
    expect(screen.getByText(/Move what is joined along/)).toBeTruthy()
    expect(screen.getByText(/glides a little before it stops; Settings can turn that off/)).toBeTruthy()
    expect(screen.getByText(/Right-click a dot or a row of the list \(or press Shift\+F10\)/)).toBeTruthy()
    expect(screen.getByText(/drag from one to draw a line tied there/)).toBeTruthy()
    expect(screen.queryByText(/view panel/)).toBeNull()
  })
})

// MO5 item 4.5: "when the user makes the board window small they should be able to move around the file viewer/web".
describe('🚨 MO5 4.5: the map works round a board in its frame', () => {
  it('in its frame the board\'s layer takes no press: only the frame does, and the map is dimmed, never blurred', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(__dirname, 'moth.css'), 'utf8')
    expect(css).toContain('.moth-board-layer[data-size="framed"] { pointer-events: none; }')
    expect(css).toMatch(/\.moth-board-layer\[data-size="framed"\] > \.moth-board,\s*\.moth-board-layer\[data-size="framed"\] \.moth-board-wait \{ pointer-events: auto; \}/)
    const scrim = css.match(/\.moth-board-scrim \{[^}]*\}/)?.[0] ?? ''
    expect(scrim).toContain('pointer-events: none;')
    expect(scrim).not.toContain('backdrop-filter')
  })
  it('a dot picked on the map while the board is open is kept when it closes; the camera too', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => { w.handlers.pick('folder:bf', {}) })
    await waitFor(() => expect(panel()).toBeTruthy())
    act(() => { w.handlers.pick('folder:f2', {}) })
    w.cam = { x: 40, y: 60, k: 1 }
    fireEvent.click(screen.getByRole('button', { name: 'Close the test board' }))
    await waitFor(() => expect(panel()).toBeNull())
    expect(w.renderer.setCamera).not.toHaveBeenCalled()
    await waitFor(() => expect(w.selection).toEqual(['folder:f2']))
  })
  it('Ctrl+Z is the map\'s while the focus is outside a board in its frame, and the board\'s when it fills the view', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await boardsRead(w)
    act(() => { w.handlers.pick('folder:bf', {}) })
    await waitFor(() => expect(panel()).toBeTruthy())
    const press = () => { const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); act(() => { document.body.dispatchEvent(e) }); return e }
    // Not yet used the map: the key is still the board's (MO4's rule).
    expect(press().defaultPrevented).toBe(false)
    // Worked on the map round it: the map's.
    act(() => { w.handlers.pick('folder:f2', {}) })
    expect(press().defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Fill the test board' }))
    expect(press().defaultPrevented).toBe(false)
  })
})

describe('🚨 MO5 6: the bar\'s switch that carries what is joined', () => {
  it('is off at first, turns on with a press, tells the map, and is kept for this person', async () => {
    localStorage.removeItem('wilson.moth.local.v1')
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    const sw = await screen.findByRole('button', { name: 'Move what is joined along' })
    expect(sw.getAttribute('aria-pressed')).toBe('false')
    expect(w.carry).toBe(false)
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-pressed')).toBe('true')
    expect(w.carry).toBe(true)
    cleanup()
    render(<MothPage worldFactory={fakeWorld} />)
    const w2 = await world()
    expect((await screen.findByRole('button', { name: 'Move what is joined along' })).getAttribute('aria-pressed')).toBe('true')
    expect(w2.carry).toBe(true)
    // Someone else on this computer has their own.
    cleanup()
    state.perms = { ...state.perms, userId: 'u2' }
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    expect((await screen.findByRole('button', { name: 'Move what is joined along' })).getAttribute('aria-pressed')).toBe('false')
    localStorage.removeItem('wilson.moth.local.v1')
  })
})

describe('🚨 MO5 5: the glide\'s switch in Settings', () => {
  const settings = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'M.O.T.H. settings' }))
    return screen.findByRole('switch', { name: GLIDE_WORDS.label })
  }
  it('is on at first and tells the map; off, the map is told and it is kept for this person', async () => {
    localStorage.removeItem('wilson.moth.local.v1')
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    const sw = await settings()
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(w.glide).toBe(true)
    expect(screen.getByText(GLIDE_WORDS.kept)).toBeTruthy()
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(w.glide).toBe(false)
    cleanup()
    render(<MothPage worldFactory={fakeWorld} />)
    const w2 = await world()
    expect((await settings()).getAttribute('aria-checked')).toBe('false')
    expect(w2.glide).toBe(false)
    localStorage.removeItem('wilson.moth.local.v1')
  })
  it('while the computer asks for less motion it is off and cannot be turned on, and says why', async () => {
    localStorage.removeItem('wilson.moth.local.v1')
    const was = window.matchMedia
    window.matchMedia = (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      render(<MothPage worldFactory={fakeWorld} />)
      const w = await world()
      const sw = await settings()
      expect(sw.getAttribute('aria-checked')).toBe('false')
      expect(sw.disabled).toBe(true)
      expect(screen.getByText(GLIDE_WORDS.calm)).toBeTruthy()
      expect(w.glide).toBe(false)
    } finally {
      window.matchMedia = was
    }
  })
})
