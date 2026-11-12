// @vitest-environment jsdom
// MothPage.test.jsx — MO1 (MOTH_DESIGN §1.10): what the page shows and what it greys, mounted against a fake adapter,
// and the two source scans: it reads only through Moth's own methods, and it stays a lazy chunk.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const state = vi.hoisted(() => ({ rabbit: null, perms: null, storage: null, usage: null }))
vi.mock('../rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => state.rabbit }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => state.perms }))
vi.mock('../../components/TeamMembers/useWorkspaceMembers', () => ({ useWorkspaceMembers: () => ({ members: [] }) }))
vi.mock('../../cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => state.storage, fetchStorageUsage: async () => state.usage }))

import MothPage from './MothPage.jsx'
import { islandLabel } from './components/MothIslands.jsx'
import { daysLeft } from './components/MothTrashView.jsx'
import { OFFICE_SERVER_SENTENCE, FROM_THE_DESKTOP_SENTENCE, NOT_ON_THIS_STORAGE_SENTENCE } from './components/MothPersonalPanel.jsx'
import { desktopFileOps } from '../rabbit_v0.1.0/storage/desktopFileOps.js'

const island = (id, extra = {}) => ({
  id, title: `Project ${id}`, is_personal: false, is_mine: false, is_private: false, my_project_role: 'member', is_staffed: true, can_write: true, ...extra,
})
const MINE = island('me', { title: 'Personal space', is_personal: true, is_mine: true, is_private: true })
const file = (id, extra = {}) => ({ id, name: `${id}.mov`, storage_path: `x/${id}.mov`, storage_provider: 'supabase', ...extra })

// MO2: the world draws on a canvas jsdom does not have; the page takes a stand-in that records what it was given.
const worlds = []
function fakeWorld() {
  const w = {
    graphs: [], handlers: {}, selection: [], flown: [], active: null,
    setGraph(g, o) { w.graphs.push({ g, o }) },
    relayout() {},
    positions: () => ({}),
    setAppearance() {},
    setReducedMotion() {},
    setRules(r) { w.rules = r },
    setActive(v) { w.active = v },
    resize() {},
    setSelection(s) { w.selection = s },
    flyTo(id) { w.flown.push(id); return true },
    on(event, fn) { w.handlers[event] = fn },
    renderer: { hitTest: () => null },
    destroy() {},
  }
  worlds.push(w)
  return w
}

let adapter
beforeEach(() => {
  adapter = {
    ensurePersonalSpace: vi.fn(async () => 'me'),
    listMothIslands: vi.fn(async () => [MINE, island('p1'), island('p2')]),
    listMothFolders: vi.fn(async () => []),
    listMothFiles: vi.fn(async () => [file('a'), file('b')]),
    planFileMove: vi.fn(async () => ({ items: [] })),
    moveFiles: vi.fn(async () => ({ move_id: 'm1', ops: [] })),
    planUndoFileMove: vi.fn(async () => ({ items: [] })),
    undoFileMove: vi.fn(async () => ({ move_id: 'm2', ops: [] })),
    trashFiles: vi.fn(async () => ({ done: 1, ops: [] })),
    restoreFiles: vi.fn(async () => ({ done: 1, ops: [] })),
    listTrashedFiles: vi.fn(async () => []),
    uploadFile: vi.fn(async () => ({})),
    // MO2: settings say the first visit is done, so no question stands over the page; no saved views.
    getMothPrefs: vi.fn(async () => ({ first_visit_done: true })),
    setMothPrefs: vi.fn(async (patch) => ({ first_visit_done: true, ...patch })),
    listMothViews: vi.fn(async () => []),
  }
  // MO2: Moth reads every project at once, and an id is one file. The fakes answer the same rows for every project,
  // so each row is given the project it was asked for, and its id is kept apart per project (p1's stay as written,
  // so what a test asks of p1 reads as before). Whatever a test puts in adapter.listMothFiles is read at the call.
  const seen = new Proxy({}, {
    get: (_t, prop) => (prop === 'listMothFiles'
      ? async (pid, ...rest) => ((await adapter.listMothFiles(pid, ...rest)) || []).map((r) => (r.project_id
        ? r : { ...r, project_id: pid, ...(pid === 'p1' ? {} : { id: `${pid}.${r.id}` }) }))
      : adapter[prop]),
    has: (_t, prop) => prop in adapter,
  })
  state.rabbit = { getAdapter: () => seen, adapterMode: 'supabase', noteFilesChangedElsewhere: vi.fn(), showUndoToast: vi.fn() }
  state.perms = { role: 'member', ready: true, userId: 'u1', workspaceId: 'w1' }
  state.storage = null
  state.usage = null
})
afterEach(() => { cleanup(); worlds.length = 0 })

const deleteAndConfirm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}
const openProject = async (name = 'Project p1') => {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByText('a.mov')
}

describe('the islands', () => {
  it('🚨 makes the person\'s space on first entry, and calls it theirs', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    expect(await screen.findByRole('button', { name: 'My personal space' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
  })
  it('shows the projects even when the space cannot be made', async () => {
    adapter.ensurePersonalSpace = vi.fn(async () => { throw new Error('not yet') })
    render(<MothPage worldFactory={fakeWorld} />)
    expect(await screen.findByRole('button', { name: 'Project p1' })).toBeTruthy()
  })
  it('says a failed read, and does not read it as nothing', async () => {
    adapter.listMothIslands = vi.fn(async () => { throw new Error('x') })
    render(<MothPage worldFactory={fakeWorld} />)
    expect(await screen.findByText('Could not read your projects just now.')).toBeTruthy()
  })
  it('a desktop-only project says so', () => {
    expect(islandLabel(island('p'), { localOnly: true })).toBe('Project p · On this computer only')
    expect(islandLabel(MINE, { localOnly: true })).toBe('My personal space')
  })
})

describe('the files', () => {
  it('a row the second look hides is not drawn, and search reads only what is loaded', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('a'), file('inv', { is_financial: true }), file('l', { tags: ['legal'] })])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    expect(screen.queryByText('inv.mov')).toBeNull()
    expect(screen.queryByText('l.mov')).toBeNull()
    // MO2: every project is read once on the way in (three here); a search reads nothing more.
    const reads = adapter.listMothFiles.mock.calls.length
    fireEvent.change(screen.getByLabelText('Search these files'), { target: { value: 'zzz' } })
    expect(screen.queryByText('a.mov')).toBeNull()
    expect(adapter.listMothFiles).toHaveBeenCalledTimes(reads)
  })
  it('🚨 on the signed-out desktop, a receipt by its expense, a money folder and a folder\'s chain are hidden too', async () => {
    adapter.mothHiddenFacts = vi.fn(async () => ({
      expenseFileIds: ['r'],
      localMoneyDirs: ['salt_RECEIPTS&INVOICES'],
      folders: [{ id: 'm', slug: 'invoices', path: 'INVOICES' }, { id: 'k', parent_id: 'm', slug: 'x', path: 'INVOICES/x' }],
    }))
    adapter.listMothFiles = vi.fn(async () => [
      file('a'), file('r'), file('d', { storage_path: 'salt_RECEIPTS&INVOICES/d.pdf' }), file('c', { folder_id: 'k' }),
    ])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    for (const name of ['r.mov', 'd.mov', 'c.mov']) expect(screen.queryByText(name)).toBeNull()
  })
  it('🚨 facts that cannot be read show nothing, not everything', async () => {
    adapter.mothHiddenFacts = vi.fn(async () => { throw new Error('The bundle could not be read.') })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    expect(await screen.findByText('The bundle could not be read.')).toBeTruthy()
    expect(screen.queryByText('a.mov')).toBeNull()
  })
  it('🚨 a file the last check did not find says so', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('a'), file('gone', { share_missing_since: '2026-11-01T00:00:00Z' })])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    expect(screen.getByText('gone.mov').closest('li').textContent).toMatch(/Not found on the server at the last check/)
    expect(screen.getByText('a.mov').closest('li').textContent).not.toMatch(/Not found/)
  })
  it('follows pages by the last id, with no total', async () => {
    // MO2: the whole project is read, a page of 1,000 at a time keyed on the last id, and no total is asked.
    const page = Array.from({ length: 1000 }, (_, i) => file(`f${String(i).padStart(4, '0')}`))
    // Only p1 is large: a thousand rows is heavy for jsdom, and one project shows the paging.
    adapter.listMothFiles = vi.fn(async (pid, after) => (pid !== 'p1' ? [] : after ? [file('last')] : page))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    expect(await screen.findByText('last.mov', {}, { timeout: 10000 })).toBeTruthy()
    expect(adapter.listMothFiles).toHaveBeenCalledWith('p1', 'f0999', 1000)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  }, 30000)
})

describe('🚨 a reviewer', () => {
  it('sees Move to and Delete greyed with the reason, and no write is made', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1', { my_project_role: 'reviewer', can_write: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(del.disabled).toBe(true)
    expect(del.closest('[title]')?.getAttribute('title')).toBeTruthy()
    fireEvent.click(del)
    expect(screen.getByRole('button', { name: 'Move to…' }).disabled).toBe(true)
    expect(adapter.trashFiles).not.toHaveBeenCalled()
    expect(adapter.planFileMove).not.toHaveBeenCalled()
  })
})

describe('doing things', () => {
  it('Delete, then Undo brings it back and Files is told', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(adapter.trashFiles).toHaveBeenCalledWith(['a'], 'p1'))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['p1'])
    expect(state.rabbit.showUndoToast.mock.calls[0][0]).toBe('Deleted "a.mov"')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalledWith(['a'], 'p1'))
  })
  it('Ctrl+Z undoes on this page, and not while it is hidden or while typing', async () => {
    const { rerender } = render(<MothPage worldFactory={fakeWorld} isActive />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(false))
    fireEvent.keyDown(screen.getByLabelText('Search these files'), { key: 'z', ctrlKey: true })
    rerender(<MothPage worldFactory={fakeWorld} isActive={false} />)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
    rerender(<MothPage worldFactory={fakeWorld} isActive />)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalled())
  })
  it('Move to offers only what the person may write, and a refusal stays in the dialog', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1'), island('p2'), island('p3', { can_write: false })])
    adapter.moveFiles = vi.fn(async () => { throw Object.assign(new Error('A file with this name is already there.'), { code: 'name_taken' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    const select = within(dialog).getByRole('combobox')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'p1', 'p2'])
    fireEvent.change(select, { target: { value: 'p2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await within(dialog).findByText('A file with this name is already there.')).toBeTruthy()
    expect(adapter.moveFiles).toHaveBeenCalledWith(['b'], 'p2', null, null)
  })
})

describe('🚨 Delete asks first', () => {
  it('nothing is written until the person says yes, and Cancel writes nothing', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/a\.mov/)
    expect(adapter.trashFiles).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(adapter.trashFiles).not.toHaveBeenCalled()
  })
  it('reads right for one file, even one the search has hidden', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.change(screen.getByLabelText('Search these files'), { target: { value: 'b.mov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const said = (await screen.findByRole('dialog')).textContent
    expect(said).toMatch(/It is not shown by your search\. It stays in the trash for 30 days\./)
    expect(said).not.toMatch(/of them|They/)
  })
  it('a double click on the answer deletes once', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const yes = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' })
    fireEvent.click(yes)
    fireEvent.click(yes)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(adapter.trashFiles).toHaveBeenCalledTimes(1)
  })
  it('it says what happens on the office server, where the real file moves', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('a', { storage_provider: 'network_share' })])
    vi.spyOn(desktopFileOps, 'available').mockReturnValue(true)
    vi.spyOn(desktopFileOps, 'reachable').mockResolvedValue({ ok: true })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/office server/)
    vi.restoreAllMocks()
  })
  it('a ticked row the search has hidden is counted, on the page and in the question', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    fireEvent.change(screen.getByLabelText('Search these files'), { target: { value: 'a.mov' } })
    expect(document.querySelector('[data-moth-ticked]').textContent).toMatch(/2 ticked, 1 not shown/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/2 files/)
  })
})

describe('🚨 what is on screen is the project named', () => {
  it('a project\'s rows go as soon as another is opened, and a failed read shows neither its rows nor "no files"', async () => {
    adapter.listMothFiles = vi.fn(async (project) => {
      if (project === 'p2') throw new Error('no answer')
      return [file(`${project}-row`, { project_id: project })]
    })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    await screen.findByText('p1-row.mov')
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Project p2' }))
    expect(await screen.findByText('no answer')).toBeTruthy()
    expect(screen.queryByText('p1-row.mov')).toBeNull()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
  it('a read that comes back after a newer read of the same project is dropped', async () => {
    // MO2: coming back to the page reads every project again; the first read of p1, still out, must not land.
    let release
    let first = true
    adapter.listMothFiles = vi.fn(async (project) => {
      if (project !== 'p1') return []
      if (first) { first = false; await new Promise((ok) => { release = ok }); return [file('late', { project_id: 'p1' })] }
      return [file('fresh', { project_id: 'p1' })]
    })
    const { rerender } = render(<MothPage worldFactory={fakeWorld} isActive />)
    await waitFor(() => expect(release).toBeTruthy())
    rerender(<MothPage worldFactory={fakeWorld} isActive={false} />)
    rerender(<MothPage worldFactory={fakeWorld} isActive />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    await screen.findByText('fresh.mov')
    release()
    await new Promise((ok) => setTimeout(ok, 20))
    expect(screen.queryByText('late.mov')).toBeNull()
    expect(screen.getByText('fresh.mov')).toBeTruthy()
  })
  it('a failed list of projects offers Try again, and asks for the space again', async () => {
    let answer = () => { throw new Error('x') }
    adapter.ensurePersonalSpace = vi.fn(async () => { throw new Error('not now') })
    adapter.listMothIslands = vi.fn(async () => answer())
    render(<MothPage worldFactory={fakeWorld} />)
    await screen.findByText('Could not read your projects just now.')
    answer = () => [island('p1')]
    adapter.ensurePersonalSpace = vi.fn(async () => 'me')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Project p1' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Could not read your projects just now.')).toBeNull()
  })
  it('coming back to the page reads again: a project made elsewhere appears, and a seat changed there counts', async () => {
    const { rerender } = render(<MothPage worldFactory={fakeWorld} isActive />)
    await screen.findByRole('button', { name: 'Project p1' })
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1'), island('new')])
    rerender(<MothPage worldFactory={fakeWorld} isActive={false} />)
    expect(adapter.listMothIslands).not.toHaveBeenCalled()
    rerender(<MothPage worldFactory={fakeWorld} isActive />)
    expect(await screen.findByRole('button', { name: 'Project new' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 the keyboard', () => {
  const ready = async () => {
    render(<MothPage worldFactory={fakeWorld} isActive />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(false))
  }
  it('does nothing behind an open dialog', async () => {
    await ready()
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'z', ctrlKey: true })
    await new Promise((ok) => setTimeout(ok, 10))
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
  })
  it('a held key is one undo', async () => {
    await ready()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, repeat: true })
    await new Promise((ok) => setTimeout(ok, 10))
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
  })
  it('works with focus on a ticked row', async () => {
    await ready()
    fireEvent.keyDown(screen.getByRole('checkbox', { name: /b\.mov/ }), { key: 'z', ctrlKey: true })
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalled())
  })
  it('stays on this page: a hidden page\'s own undo on the document does not also run', async () => {
    await ready()
    const hiddenPage = vi.fn()
    document.addEventListener('keydown', hiddenPage)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    document.removeEventListener('keydown', hiddenPage)
    expect(hiddenPage).not.toHaveBeenCalled()
  })
  it('other keys are not its own', async () => {
    await ready()
    const other = vi.fn()
    document.addEventListener('keydown', other)
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })
    document.removeEventListener('keydown', other)
    expect(other).toHaveBeenCalled()
  })
})

describe('🚨 the toast and the notes', () => {
  it('a toast\'s Undo is for its own step, not for whatever was done since', async () => {
    render(<MothPage worldFactory={fakeWorld} isActive />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    await deleteAndConfirm()
    const firstUndo = state.rabbit.showUndoToast.mock.calls[0][1]
    await firstUndo()
    await new Promise((ok) => setTimeout(ok, 10))
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
    await state.rabbit.showUndoToast.mock.calls[1][1]()
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalledTimes(1))
  })
  it('says what a move left behind', async () => {
    adapter.moveFiles = vi.fn(async () => ({ move_id: 'm1', moved: 1, links_cleared: 1, ops: [] }))
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'p2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await screen.findByText(/stayed behind/)).toBeTruthy()
  })
  it('a move on this computer that did not finish is told', async () => {
    adapter.listPendingMoves = vi.fn(async () => [{ op: 'x', files: 2 }])
    render(<MothPage worldFactory={fakeWorld} />)
    expect(await screen.findByText(/did not finish/)).toBeTruthy()
  })
  it('an unfinished office-server operation is looked at on the way in', async () => {
    adapter.networkSharePending = vi.fn(async () => [])
    vi.spyOn(desktopFileOps, 'available').mockReturnValue(true)
    render(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => expect(adapter.networkSharePending).toHaveBeenCalled())
    vi.restoreAllMocks()
  })
})

describe('the trash', () => {
  it('🚨 older trash can be reached: a full page offers more, by the last row\'s date', async () => {
    const row = (id, at) => ({ id, project_id: 'p1', name: `${id}.mov`, deleted_at: at, purges_at: new Date(Date.now() + 86400000).toISOString() })
    const first = Array.from({ length: 200 }, (_, i) => row(`n${i}`, '2026-11-06T00:00:00Z'))
    adapter.listTrashedFiles = vi.fn(async ({ before }) => (before ? [row('old', '2026-11-01T00:00:00Z')] : first))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    expect(await screen.findByText('old.mov')).toBeTruthy()
    expect(adapter.listTrashedFiles.mock.calls.at(-1)[0].before).toBe('2026-11-06T00:00:00Z')
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })
  it('a short page is the end, and an adapter that ignores the date offers no more', async () => {
    const row = (id) => ({ id, project_id: 'p1', name: `${id}.mov`, deleted_at: '2026-11-06T00:00:00Z' })
    adapter.listTrashedFiles = vi.fn(async () => Array.from({ length: 200 }, (_, i) => row(`n${i}`)))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull())
  })
  it('a countdown, and Restore', async () => {
    adapter.listTrashedFiles = vi.fn(async () => [{ id: 't', project_id: 'p1', name: 't.mov', project_title: 'Project p1', purges_at: new Date(Date.now() + 2.5 * 86400000).toISOString(), can_restore: true }])
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(/goes in 3 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalledWith(['t'], 'p1'))
  })
  it('🚨 could not look is not nothing here', async () => {
    adapter.listTrashedFiles = vi.fn(async () => { throw new Error('x') })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(/Could not look in the trash/)).toBeTruthy()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
  it('nothing here, when it looked', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText('Nothing here')).toBeTruthy()
  })
  it('days left', () => {
    expect(daysLeft('2026-11-08T00:00:00Z', Date.parse('2026-11-06T12:00:00Z'))).toBe(2)
    expect(daysLeft('2026-11-01T00:00:00Z', Date.parse('2026-11-06T12:00:00Z'))).toBe(0)
    expect(daysLeft('nope')).toBeNull()
  })
})

describe('your personal space', () => {
  const addTo = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'My personal space' }))
    await screen.findByText('a.mov')
  }
  it('uploads as Files does', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await addTo()
    const input = document.querySelector('[data-moth-add-input]')
    const picked = new File(['x'], 'n.mov')
    fireEvent.change(input, { target: { files: [picked] } })
    await waitFor(() => expect(adapter.uploadFile).toHaveBeenCalledWith('me', {}, picked, {}))
  })
  it('🚨 a refused record takes its copy back out: no file is left on the server with no row', async () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'unc', root_path: '//s/d' }
    vi.spyOn(desktopFileOps, 'available').mockReturnValue(true)
    const added = { locator: '_WILSON_PERSONAL/u1/n.mov', name: 'n.mov', sizeBytes: 1, modifiedAt: 'then' }
    vi.spyOn(desktopFileOps, 'addToPersonalSpace').mockResolvedValue(added)
    const rename = vi.spyOn(desktopFileOps, 'rename').mockResolvedValue({ results: [{ ok: true }] })
    const purge = vi.spyOn(desktopFileOps, 'purgeBin').mockResolvedValue({ results: [{ ok: true }] })
    adapter.getAccessToken = vi.fn(async () => 'tok')
    adapter.networkShareRecordAdded = vi.fn(async () => { throw Object.assign(new Error('A project\'s folder is outside this company\'s office server.'), { code: 'folders_unplaced' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    await addTo()
    await screen.findByText(OFFICE_SERVER_SENTENCE)
    fireEvent.change(document.querySelector('[data-moth-add-input]'), { target: { files: [new File(['x'], 'n.mov')] } })
    expect(await screen.findByText(/outside this company/)).toBeTruthy()
    expect(rename.mock.calls[0][0][0].from).toBe('_WILSON_PERSONAL/u1/n.mov')
    expect(rename.mock.calls[0][0][0].to).toMatch(/^_WILSON_PERSONAL\/u1\/\.wilson-bin\/[0-9a-f-]{36}\/n\.mov$/)
    expect(purge.mock.calls[0][0][0]).toMatch(/^_WILSON_PERSONAL\/u1\/\.wilson-bin\/[0-9a-f-]{36}$/)
    vi.restoreAllMocks()
  })
  it('🚨 a company on a folder on one computer is told, and is not offered an add that can never work', async () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'local', root_path: 'D:/work' }
    render(<MothPage worldFactory={fakeWorld} />)
    await addTo()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add files' }).disabled).toBe(true))
    expect(screen.getByText(NOT_ON_THIS_STORAGE_SENTENCE)).toBeTruthy()
  })
  it('on an office server, a browser is told to use the desktop', async () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'unc', root_path: '//s/d' }
    render(<MothPage worldFactory={fakeWorld} />)
    await addTo()
    expect(await screen.findByText(FROM_THE_DESKTOP_SENTENCE)).toBeTruthy()
    expect(screen.queryByText(OFFICE_SERVER_SENTENCE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add files' }).disabled).toBe(true)
  })
})

const read = (p) => fs.readFileSync(p, 'utf8')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const SRC = path.join(process.cwd(), 'src')
const MOTH = path.join(SRC, 'tools', 'moth_v0.1.0')

describe('🚨 the Moth source scan', () => {
  const FORBIDDEN = /\.from\(\s*['"](?:projects|files|folders)['"]|\b(?:listPersonalSpaces|listFiles|listFolders|listManagedFiles|loadProject|listProjects|listProjectMembers|projectsIndex)\b/
  it('reads only through Moth\'s own methods', () => {
    const bad = walk(MOTH).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f)).filter((f) => FORBIDDEN.test(read(f)))
    expect(bad).toEqual([])
  })
  it('the scan bites', () => {
    expect(FORBIDDEN.test("x.from('files').select()")).toBe(true)
    expect(FORBIDDEN.test('adapter.listFiles(id)')).toBe(true)
    expect(FORBIDDEN.test('adapter.listMothFiles(id)')).toBe(false)
  })
})

describe('🚨 the lazy chunk', () => {
  // Across lines: the usual form for several names has its `from` on a line of its own.
  const STATIC = /(?:^|\n)\s*(?:import\b[^'";]*?from\s*|import\s*|export\b[^'";]*?from\s*)['"][^'"]*moth_v0\.1\.0[^'"]*['"]/
  const DYNAMIC = /\bimport\(\s*['"][^'"]*moth_v0\.1\.0/
  it('nothing outside its folder imports from it statically', () => {
    const files = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f) && !f.startsWith(MOTH))
    expect(files.filter((f) => STATIC.test(read(f))).map((f) => path.relative(SRC, f))).toEqual([])
  })
  it('and nothing but App.jsx imports it at all', () => {
    const files = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f) && !f.startsWith(MOTH) && path.basename(f) !== 'App.jsx')
    expect(files.filter((f) => DYNAMIC.test(read(f))).map((f) => path.relative(SRC, f))).toEqual([])
  })
  it('App.jsx reaches it only through lazy(import())', () => {
    const app = read(path.join(SRC, 'App.jsx'))
    expect(app).toContain("lazy(() => import('./tools/moth_v0.1.0'))")
    expect(STATIC.test(app)).toBe(false)
  })
  it('a planted static import turns the scan red', () => {
    expect(STATIC.test("import MothPage from './tools/moth_v0.1.0'\n")).toBe(true)
    expect(STATIC.test("\nexport { x } from '../moth_v0.1.0/state/mothHistory.js'\n")).toBe(true)
    expect(STATIC.test("const M = lazy(() => import('./tools/moth_v0.1.0'))")).toBe(false)
    expect(STATIC.test("import {\n  a,\n  b,\n} from '../moth_v0.1.0/state/mothHistory.js'\n")).toBe(true)
    expect(DYNAMIC.test("const m = await import('../moth_v0.1.0/x.js')")).toBe(true)
  })
})

describe('round 2: this computer', () => {
  it('🚨 an asset\'s file cannot be ticked, so a batch is not refused over a row it cannot take', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('a'), file('m', { managed: true })])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    const box = screen.getByText('m.mov').closest('label').querySelector('input')
    expect(box.disabled).toBe(true)
    expect(box.title).toMatch(/asset/)
    expect(screen.getByText('a.mov').closest('label').querySelector('input').disabled).toBe(false)
  })
  it('🚨 opening the trash empties what is past its 30 days, where no server does', async () => {
    adapter.purgeExpiredTrash = vi.fn(async () => ({ purged: 1 }))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    await waitFor(() => expect(adapter.listTrashedFiles).toHaveBeenCalled())
    expect(adapter.purgeExpiredTrash.mock.calls.map(([id]) => id).sort()).toEqual(['me', 'p1', 'p2'])
    expect(adapter.purgeExpiredTrash.mock.invocationCallOrder[0]).toBeLessThan(adapter.listTrashedFiles.mock.invocationCallOrder[0])
  })
  it('one that fails does not stop the trash being shown', async () => {
    adapter.purgeExpiredTrash = vi.fn(async () => { throw new Error('no such project') })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    await waitFor(() => expect(adapter.listTrashedFiles).toHaveBeenCalled())
  })
})

describe('round 2: a move left over', () => {
  it('🚨 from a browser the person is asked to check, and shown both places', async () => {
    adapter.networkShareStaleMoves = vi.fn(async () => [{ op_id: 'o', from: 'Salt/a.mov', to: 'Pepper/a.mov', name: 'a.mov' }])
    adapter.settleNetworkShareOps = vi.fn(async () => {})
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(/Check the file is still in the first place/)).toBeTruthy()
    expect(screen.getByText('Salt/a.mov to Pepper/a.mov')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Call it off' }))
    await waitFor(() => expect(adapter.settleNetworkShareOps).toHaveBeenCalledWith(['o'], 'not_moved'))
  })
})

describe('round 2: the page', () => {
  const onDesktopServer = () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'unc', root_path: '//s/d' }
    vi.spyOn(desktopFileOps, 'available').mockReturnValue(true)
    vi.spyOn(desktopFileOps, 'reachable').mockResolvedValue({ ok: true })
  }
  afterEach(() => vi.restoreAllMocks())

  it('🚨 a move that changes nothing says so, and offers no Undo of something else', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1'), island('p2')])
    adapter.moveFiles = vi.fn(async () => ({ move_id: null, moved: 0, links_cleared: 0, ops: [] }))
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'p1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(await screen.findByText('These files are already there, so nothing moved.')).toBeTruthy()
    expect(state.rabbit.showUndoToast).not.toHaveBeenCalled()
  })
  it('🚨 what a part-failed delete says stays on the page after the list reads again', async () => {
    onDesktopServer()
    adapter.listMothFiles = vi.fn(async () => [file('a', { storage_provider: 'network_share' }), file('b', { storage_provider: 'network_share' })])
    adapter.trashFiles = vi.fn(async () => ({ done: 2, ops: [{ id: 'a', op_id: 'o1', from: 'x/a', to: 'y/a' }, { id: 'b', op_id: 'o2', from: 'x/b', to: 'y/b' }] }))
    adapter.settleNetworkShareOps = vi.fn(async () => {})
    vi.spyOn(desktopFileOps, 'rename').mockResolvedValue({ results: [{ ok: true }, { ok: false, code: 'in_use' }] })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    const reads = adapter.listMothFiles.mock.calls.length
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(adapter.listMothFiles.mock.calls.length).toBeGreaterThan(reads))
    await new Promise((ok) => setTimeout(ok, 20))
    expect(document.querySelector('[data-moth-error]').textContent).toMatch(/Deleted 1 of 2/)
  })
  it('🚨 so does what a refused delete says: the old clearing read again and lost it', async () => {
    onDesktopServer()
    adapter.listMothFiles = vi.fn(async () => [file('a', { storage_provider: 'network_share' })])
    adapter.trashFiles = vi.fn(async () => ({ done: 1, ops: [{ id: 'a', op_id: 'o1', from: 'x/a', to: 'y/a' }] }))
    adapter.settleNetworkShareOps = vi.fn(async () => {})
    vi.spyOn(desktopFileOps, 'rename').mockResolvedValue({ results: [{ ok: false, code: 'in_use' }] })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    const reads = adapter.listMothFiles.mock.calls.length
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(adapter.listMothFiles.mock.calls.length).toBeGreaterThan(reads))
    await new Promise((ok) => setTimeout(ok, 20))
    expect(document.querySelector('[data-moth-error]')?.textContent).toMatch(/would not move this file/)
  })
  it('opening another project clears it', async () => {
    adapter.trashFiles = vi.fn(async () => { throw new Error('no') })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(document.querySelector('[data-moth-error]')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Project p2' }))
    await waitFor(() => expect(document.querySelector('[data-moth-error]')).toBeNull())
  })
  it('🚨 a toast\'s Undo that fails tells the toast, which stays up with Undo to try again', async () => {
    adapter.restoreFiles = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    const undo = state.rabbit.showUndoToast.mock.calls[0][1]
    await expect(undo()).rejects.toThrow('Failed to fetch')
    expect(await screen.findByText('Failed to fetch')).toBeTruthy()
  })
  it('🚨 a project on the office server says how old its list is, and how to look again', async () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'unc', root_path: '//s/d' }
    adapter.mothIslandFolder = vi.fn(async (id) => ({ id, folder_root: '//s/d/Salt', personal_owner_id: null }))
    adapter.getNetworkShareCheck = vi.fn(async () => ({ last_checked_at: '2026-11-01T10:00:00Z', missing_count: 2 }))
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    const banner = await waitFor(() => { const b = document.querySelector('[data-network-share-banner]'); expect(b).toBeTruthy(); return b })
    await waitFor(() => expect(banner.textContent).toMatch(/Last checked/))
    expect(banner.textContent).toMatch(/2 files were not found/)
    expect(banner.textContent).toMatch(/what the person checking can open/)
    expect(within(banner).getByRole('button', { name: 'Refresh from the desktop app' })).toBeTruthy()
  })
  it('a company not on an office server shows none', async () => {
    adapter.mothIslandFolder = vi.fn(async (id) => ({ id }))
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    expect(document.querySelector('[data-network-share-banner]')).toBeNull()
    expect(adapter.mothIslandFolder).not.toHaveBeenCalled()
  })
  it('🚨 a lost answer on an add keeps the file its row may name, and says nobody can tell', async () => {
    onDesktopServer()
    vi.spyOn(desktopFileOps, 'addToPersonalSpace').mockResolvedValue({ locator: '_WILSON_PERSONAL/u1/n.mov', name: 'n.mov', sizeBytes: 1, modifiedAt: 'then' })
    const rename = vi.spyOn(desktopFileOps, 'rename').mockResolvedValue({ results: [{ ok: true }] })
    adapter.getAccessToken = vi.fn(async () => 'tok')
    adapter.networkShareRecordAdded = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'My personal space' }))
    await screen.findByText(OFFICE_SERVER_SENTENCE)
    fireEvent.change(document.querySelector('[data-moth-add-input]'), { target: { files: [new File(['x'], 'n.mov')] } })
    expect(await screen.findByText(/could not tell whether "n\.mov" was added/)).toBeTruthy()
    expect(rename).not.toHaveBeenCalled()
  })
  it('🚨 an add that stops part way says how many went, and the list shows them', async () => {
    let n = 0
    adapter.uploadFile = vi.fn(async () => { n += 1; if (n === 2) throw new Error('the network went') })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'My personal space' }))
    await screen.findByText('a.mov')
    const reads = adapter.listMothFiles.mock.calls.length
    fireEvent.change(document.querySelector('[data-moth-add-input]'), { target: { files: [new File(['x'], '1.mov'), new File(['x'], '2.mov'), new File(['x'], '3.mov')] } })
    expect(await screen.findByText(/Added 1 of 3\. the network went/)).toBeTruthy()
    await waitFor(() => expect(adapter.listMothFiles.mock.calls.length).toBeGreaterThan(reads))
    expect(state.rabbit.noteFilesChangedElsewhere).toHaveBeenCalledWith(['me'])
  })
  it('🚨 an add is weighed as Files weighs one: a company that is full is told, before anything is sent', async () => {
    state.usage = { usedBytes: null, quotaBytes: null, status: 'active', hasPlan: true, fullness: 'full' }
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'My personal space' }))
    await screen.findByText('a.mov')
    fireEvent.change(document.querySelector('[data-moth-add-input]'), { target: { files: [new File(['x'], '1.mov')] } })
    expect(await screen.findByText(/Petal cloud storage is full/)).toBeTruthy()
    expect(adapter.uploadFile).not.toHaveBeenCalled()
  })
  it('🚨 Undo tells whichever project is open in R.A.B.B.I.T. now, not the one open when the step was made', async () => {
    const first = state.rabbit.noteFilesChangedElsewhere
    const { rerender } = render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    const now = vi.fn()
    state.rabbit = { ...state.rabbit, noteFilesChangedElsewhere: now }
    rerender(<MothPage worldFactory={fakeWorld} />)
    first.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(now).toHaveBeenCalled())
    expect(first).not.toHaveBeenCalled()
  })
  it('🚨 a list that could not be read offers Try again, which reads it again', async () => {
    let fail = true
    adapter.listMothFiles = vi.fn(async () => { if (fail) throw new Error('the network went'); return [file('a')] })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    const again = await screen.findByRole('button', { name: 'Try again' })
    fail = false
    fireEvent.click(again)
    expect(await screen.findByText('a.mov')).toBeTruthy()
    expect(document.querySelector('[data-moth-error]')).toBeNull()
  })
  it('🚨 so does a trash that could not be read', async () => {
    let fail = true
    adapter.listTrashedFiles = vi.fn(async () => { if (fail) throw new Error('x'); return [] })
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    const banner = await waitFor(() => { const b = document.querySelector('[data-moth-trash-failed]'); expect(b).toBeTruthy(); return b })
    fail = false
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('[data-moth-trash-failed]')).toBeNull())
  })
})

describe('round 2: elsewhere in the app', () => {
  const source = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
  it('🚨 the banner starts again for each project, so one project\'s facts do not sit under another', () => {
    expect(source('src/components/Resources/ProjectFilesExplorer.jsx')).toMatch(/<NetworkShareBanner\s+key=\{project\.id\}/)
  })
  it('🚨 Projects does not offer a delete the server will refuse: an office-server file says where to delete it', () => {
    expect(source('src/components/Projects/ProjectsPage.jsx')).toMatch(/storedRow\.storage_provider === 'network_share'[\s\S]{0,200}setSaveError\(/)
  })
  it('🚨 Storage says whose eyes the list has before any check, not only after', () => {
    expect(source('src/components/AdminTerminal/StorageSection.jsx')).toMatch(/data-storage-checker/)
  })
})

describe('MO2: the HUD on the page', () => {
  const pick = () => document.querySelector('[data-moth-view-pick]')
  it('a first visit asks what to map, and the answer is remembered', async () => {
    adapter.getMothPrefs = vi.fn(async () => ({}))
    render(<MothPage worldFactory={fakeWorld} />)
    // The view list offers the same words as an option; the question's own button is in its dialog.
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Everything by tags'))
    await waitFor(() => expect(screen.queryByText('What do you want to map?')).toBeNull())
    await waitFor(() => expect(adapter.setMothPrefs).toHaveBeenCalledWith(expect.objectContaining({ first_visit_done: true, last_view: 'q:tags' })))
    expect(pick().value).toBe('q:tags')
  })
  it('a later visit reopens the last view and asks nothing', async () => {
    adapter.getMothPrefs = vi.fn(async () => ({ first_visit_done: true, last_view: 'v1' }))
    adapter.listMothViews = vi.fn(async () => [{ id: 'v1', name: 'Tagged', scope_kind: 'aggregate', project_id: null, revision: 1, position: 0, config: { nodeKinds: ['file', 'tag'], edgeKinds: ['tagged_with'] } }])
    adapter.listMothPositions = vi.fn(async () => [])
    render(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => expect(pick()?.value).toBe('v1'))
    expect(within(pick()).getByText('Tagged')).toBeTruthy()
    expect(screen.queryByText('What do you want to map?')).toBeNull()
  })
  it('Settings open in a drawer, and a colour for the light is kept', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'M.O.T.H. settings' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Moonlight' }))
    await waitFor(() => expect(adapter.setMothPrefs).toHaveBeenCalledWith({ appearance: { glow: '#9fd3ff' } }))
  })
  it('Help sits beside Settings and opens', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Help & documentation' }))
    expect(await screen.findByText('What Moth never shows')).toBeTruthy()
  })
  it('🚨 opening a file in another tool asks first, and Stay here sends nothing', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    const sent = []
    const heard = (e) => sent.push(e.detail)
    window.addEventListener('wilson:open-project-file', heard)
    try {
      await waitFor(() => expect(worlds.at(-1)?.handlers.pick).toBeTruthy())
      act(() => worlds.at(-1).handlers.pick('file:a', { additive: false }))
      fireEvent.click(await screen.findByRole('button', { name: 'Open in Files' }))
      expect(await screen.findByText(/about to leave M\.O\.T\.H\./)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Stay here' }))
      await waitFor(() => expect(screen.queryByText(/about to leave M\.O\.T\.H\./)).toBeNull())
      expect(sent).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Open in Files' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Open Files in R.A.B.B.I.T.' }))
      expect(sent).toEqual([{ projectId: 'p1', fileId: 'a' }])
    } finally {
      window.removeEventListener('wilson:open-project-file', heard)
    }
  })
  it('the graph calls the person\'s own space "My personal space", as the list does', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => {
      const g = worlds.at(-1)?.graphs.at(-1)?.g
      expect(g?.nodes.find((n) => n.id === 'project:me')?.label).toBe('My personal space')
    })
  })
  it('the frame readout shows only when asked for, and counts what it was given', async () => {
    const { unmount } = render(<MothPage worldFactory={fakeWorld} />)
    await waitFor(() => expect(worlds.at(-1)?.handlers.frame).toBeTruthy())
    act(() => { for (let i = 0; i < 30; i++) worlds.at(-1).handlers.frame({ workMs: 4, sampleMs: 9, dots: 12, edges: 20 }) })
    expect(document.querySelector('[data-moth-frames]')).toBeNull()
    unmount()
    window.history.pushState({}, '', '/?mothFrames=1')
    try {
      render(<MothPage worldFactory={fakeWorld} />)
      await waitFor(() => expect(worlds.at(-1)?.handlers.frame).toBeTruthy())
      act(() => { worlds.at(-1).handlers.frame({ dots: 1 }) })
      expect(document.querySelector('[data-moth-frames]')).toBeNull()
      act(() => { for (let i = 0; i < 30; i++) worlds.at(-1).handlers.frame({ workMs: 4, sampleMs: 9 + (i === 29 ? 30 : 0), dots: 12, edges: 20 }) })
      const line = document.querySelector('[data-moth-frames]').textContent
      expect(line).toContain('12 dots, 20 lines')
      expect(line).toContain('30 frames')
      expect(line).toContain('frame time p50 9.0 p95 9.0 max 39.0 ms')
      expect(line).toContain('drawing p95 4.0 ms')
      act(() => { for (let i = 0; i < 30; i++) worlds.at(-1).handlers.frame({ workMs: 4, sampleMs: 9, dots: 3, clusters: 7, edges: 20 }) })
      expect(document.querySelector('[data-moth-frames]').textContent).toContain('3 dots, 7 clusters, 20 lines')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })
  it('🚨 a reviewer is not offered a view shared with the project', async () => {
    state.perms = { role: 'reviewer', ready: true, userId: 'u1', workspaceId: 'w1' }
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1', { my_project_role: 'reviewer', can_write: false })])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    await waitFor(() => expect(worlds.at(-1)?.handlers.pick).toBeTruthy())
    act(() => worlds.at(-1).handlers.pick('file:a', { additive: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as…' }))
    const scope = await waitFor(() => { const s = document.querySelector('[data-moth-view-scope]'); expect(s).toBeTruthy(); return s })
    expect([...scope.options].map((o) => o.value)).toEqual(['aggregate'])
  })
})

describe('MO2 review round 1 on the page', () => {
  const ready = async () => { await waitFor(() => expect(worlds.at(-1)?.handlers.pick).toBeTruthy()) }
  const pick = (id, additive = false) => act(() => worlds.at(-1).handlers.pick(id, { additive }))
  it('🚨 files ticked in two projects grey Move to and Delete, with the reason', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    await ready()
    pick('file:a')
    pick('file:p2.a', true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to…' }).disabled).toBe(true))
    expect(document.querySelector('[data-moth-delete]').disabled).toBe(true)
    pick('file:a')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to…' }).disabled).toBe(false))
  })
  it('🚨 nothing in a person\'s own space opens in another tool', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    await ready()
    pick('file:me.a')
    await waitFor(() => expect(document.querySelector('[data-moth-view-widget]')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Open in / })).toBeNull()
    pick('file:a')
    expect(await screen.findByRole('button', { name: 'Open in Files' })).toBeTruthy()
  })
  it('Undo and Redo are off while looking back', async () => {
    adapter.fetchMothHistoryWindow = vi.fn(async () => [{ recording_since: new Date(Date.now() - 30 * 86400000).toISOString() }])
    adapter.fetchMothHistory = vi.fn(async () => [])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByText('a.mov').closest('li').querySelector('input[type=checkbox]'))
    await deleteAndConfirm()
    await waitFor(() => expect(document.querySelector('[data-moth-undo]').disabled).toBe(false))
    const range = await screen.findByLabelText('Look back')
    fireEvent.change(range, { target: { value: String(Date.now() - 5 * 86400000) } })
    await waitFor(() => expect(document.querySelector('[data-moth-undo]').disabled).toBe(true))
  })
  it('a saved view is deleted after a question, and Undo makes it again', async () => {
    adapter.getMothPrefs = vi.fn(async () => ({ first_visit_done: true, last_view: 'v1' }))
    adapter.listMothViews = vi.fn(async () => [{ id: 'v1', name: 'Mine', scope_kind: 'aggregate', project_id: null, revision: 1, position: 0, config: {} }])
    adapter.listMothPositions = vi.fn(async () => [])
    adapter.deleteMothView = vi.fn(async () => ({ removed: true }))
    adapter.createMothView = vi.fn(async (v) => ({ id: 'v2', name: v.name, scope_kind: v.scopeKind, project_id: v.projectId, revision: 1, position: 0, config: v.config }))
    render(<MothPage worldFactory={fakeWorld} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete view…' }))
    expect(await screen.findByText(/Where its dots were goes with it/)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-moth-view-delete-confirm]'))
    await waitFor(() => expect(adapter.deleteMothView).toHaveBeenCalledWith('v1'))
    const banner = await waitFor(() => { const b = document.querySelector('[data-moth-view-undo]'); expect(b).toBeTruthy(); return b })
    fireEvent.click(within(banner).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(adapter.createMothView).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mine', scopeKind: 'aggregate' })))
  })
  it('🚨 dragging a file onto a folder asks the same rules as Move to', async () => {
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1', { my_project_role: 'reviewer' }), island('p2')])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    await waitFor(() => expect(worlds.at(-1)?.rules?.canMove).toBeTruthy())
    const rules = worlds.at(-1).rules
    const reviewer = rules.canMove({ kind: 'file', rowId: 'a', projectId: 'p1' }, { kind: 'folder', rowId: 'd9', projectId: 'p1' })
    expect(reviewer.allowed).toBe(false)
    expect(reviewer.reason).toBeTruthy()
    const editor = rules.canMove({ kind: 'file', rowId: 'p2.a', projectId: 'p2' }, { kind: 'folder', rowId: 'd9', projectId: 'p2' })
    expect(rules.canMove({ kind: 'file', rowId: 'p2.a', projectId: 'p2' }, { kind: 'project', rowId: 'p2', projectId: 'p2' }).reason).toBe('It is already there.')
    expect(editor.allowed).toBe(true)
    expect(rules.canMove({ kind: 'folder', rowId: 'd9', projectId: 'p2' }, { kind: 'project', rowId: 'p2', projectId: 'p2' }).allowed).toBe(false)
  })
  it('🚨 permissions still being read are not a refusal: Move to stays offered (Session 23; the database decides)', async () => {
    state.perms = { role: null, ready: false, userId: 'u1', workspaceId: 'w1' }
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1', { my_project_role: null, is_staffed: true }), island('p2')])
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByText('a.mov').closest('li').querySelector('input[type=checkbox]'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to…' }).disabled).toBe(false))
    cleanup()
    state.perms = { role: null, ready: true, userId: 'u1', workspaceId: 'w1' }
    render(<MothPage worldFactory={fakeWorld} />)
    await openProject()
    fireEvent.click(screen.getByText('a.mov').closest('li').querySelector('input[type=checkbox]'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to…' }).disabled).toBe(true))
  })
})
