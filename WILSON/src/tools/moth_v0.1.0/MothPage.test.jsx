// @vitest-environment jsdom
// MothPage.test.jsx — MO1 (MOTH_DESIGN §1.10): what the page shows and what it greys, mounted against a fake adapter,
// and the two source scans: it reads only through Moth's own methods, and it stays a lazy chunk.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const state = vi.hoisted(() => ({ rabbit: null, perms: null, storage: null }))
vi.mock('../rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => state.rabbit }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => state.perms }))
vi.mock('../../cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => state.storage }))

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
  }
  state.rabbit = { getAdapter: () => adapter, adapterMode: 'supabase', noteFilesChangedElsewhere: vi.fn(), showUndoToast: vi.fn() }
  state.perms = { role: 'member', ready: true, userId: 'u1', workspaceId: 'w1' }
  state.storage = null
})
afterEach(cleanup)

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
    render(<MothPage />)
    expect(await screen.findByRole('button', { name: 'My personal space' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
  })
  it('shows the projects even when the space cannot be made', async () => {
    adapter.ensurePersonalSpace = vi.fn(async () => { throw new Error('not yet') })
    render(<MothPage />)
    expect(await screen.findByRole('button', { name: 'Project p1' })).toBeTruthy()
  })
  it('says a failed read, and does not read it as nothing', async () => {
    adapter.listMothIslands = vi.fn(async () => { throw new Error('x') })
    render(<MothPage />)
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
    render(<MothPage />)
    await openProject()
    expect(screen.queryByText('inv.mov')).toBeNull()
    expect(screen.queryByText('l.mov')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search these files'), { target: { value: 'zzz' } })
    expect(screen.queryByText('a.mov')).toBeNull()
    expect(adapter.listMothFiles).toHaveBeenCalledTimes(1)
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
    render(<MothPage />)
    await openProject()
    for (const name of ['r.mov', 'd.mov', 'c.mov']) expect(screen.queryByText(name)).toBeNull()
  })
  it('🚨 facts that cannot be read show nothing, not everything', async () => {
    adapter.mothHiddenFacts = vi.fn(async () => { throw new Error('The bundle could not be read.') })
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    expect(await screen.findByText('The bundle could not be read.')).toBeTruthy()
    expect(screen.queryByText('a.mov')).toBeNull()
  })
  it('🚨 a file the last check did not find says so', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('a'), file('gone', { share_missing_since: '2026-11-01T00:00:00Z' })])
    render(<MothPage />)
    await openProject()
    expect(screen.getByText('gone.mov').closest('li').textContent).toMatch(/Not found on the server at the last check/)
    expect(screen.getByText('a.mov').closest('li').textContent).not.toMatch(/Not found/)
  })
  it('follows pages by the last id, with no total', async () => {
    const page = Array.from({ length: 500 }, (_, i) => file(`f${i}`))
    adapter.listMothFiles = vi.fn(async (_p, after) => (after ? [file('last')] : page))
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('last.mov')).toBeTruthy()
    expect(adapter.listMothFiles).toHaveBeenLastCalledWith('p1', 'f499', 500)
  })
})

describe('🚨 a reviewer', () => {
  it('sees Move to and Delete greyed with the reason, and no write is made', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1', { my_project_role: 'reviewer', can_write: false })])
    render(<MothPage />)
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
    render(<MothPage />)
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
    const { rerender } = render(<MothPage isActive />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    await deleteAndConfirm()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(false))
    fireEvent.keyDown(screen.getByLabelText('Search these files'), { key: 'z', ctrlKey: true })
    rerender(<MothPage isActive={false} />)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(adapter.restoreFiles).not.toHaveBeenCalled()
    rerender(<MothPage isActive />)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalled())
  })
  it('Move to offers only what the person may write, and a refusal stays in the dialog', async () => {
    adapter.listMothIslands = vi.fn(async () => [island('p1'), island('p2'), island('p3', { can_write: false })])
    adapter.moveFiles = vi.fn(async () => { throw Object.assign(new Error('A file with this name is already there.'), { code: 'name_taken' }) })
    render(<MothPage />)
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
    render(<MothPage />)
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
    render(<MothPage />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.change(screen.getByLabelText('Search these files'), { target: { value: 'b.mov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const said = (await screen.findByRole('dialog')).textContent
    expect(said).toMatch(/It is not shown by your search\. It stays in the trash for 30 days\./)
    expect(said).not.toMatch(/of them|They/)
  })
  it('a double click on the answer deletes once', async () => {
    render(<MothPage />)
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
    render(<MothPage />)
    await openProject()
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.mov/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('dialog')).textContent).toMatch(/office server/)
    vi.restoreAllMocks()
  })
  it('a ticked row the search has hidden is counted, on the page and in the question', async () => {
    render(<MothPage />)
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
    let refuse = false
    adapter.listMothFiles = vi.fn(async (project) => {
      if (refuse) throw new Error('no answer')
      return [file(`${project}-row`)]
    })
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    await screen.findByText('p1-row.mov')
    refuse = true
    fireEvent.click(screen.getByRole('button', { name: 'Project p2' }))
    expect(await screen.findByText('no answer')).toBeTruthy()
    expect(screen.queryByText('p1-row.mov')).toBeNull()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
  it('a page that comes back after another project was opened is dropped, and Show more asks once', async () => {
    const page = Array.from({ length: 500 }, (_, i) => file(`f${i}`))
    let release
    adapter.listMothFiles = vi.fn(async (project, after) => {
      if (project === 'p2') return [file('other')]
      if (!after) return page
      await new Promise((ok) => { release = ok })
      return [file('late')]
    })
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Project p1' }))
    const more = await screen.findByRole('button', { name: 'Show more' })
    fireEvent.click(more)
    fireEvent.click(more)
    await waitFor(() => expect(adapter.listMothFiles.mock.calls.filter(([, after]) => after).length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Project p2' }))
    await screen.findByText('other.mov')
    release()
    await new Promise((ok) => setTimeout(ok, 20))
    expect(screen.queryByText('late.mov')).toBeNull()
  })
  it('a failed list of projects offers Try again, and asks for the space again', async () => {
    let answer = () => { throw new Error('x') }
    adapter.ensurePersonalSpace = vi.fn(async () => { throw new Error('not now') })
    adapter.listMothIslands = vi.fn(async () => answer())
    render(<MothPage />)
    await screen.findByText('Could not read your projects just now.')
    answer = () => [island('p1')]
    adapter.ensurePersonalSpace = vi.fn(async () => 'me')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Project p1' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Could not read your projects just now.')).toBeNull()
  })
  it('coming back to the page reads again: a project made elsewhere appears, and a seat changed there counts', async () => {
    const { rerender } = render(<MothPage isActive />)
    await screen.findByRole('button', { name: 'Project p1' })
    adapter.listMothIslands = vi.fn(async () => [MINE, island('p1'), island('new')])
    rerender(<MothPage isActive={false} />)
    expect(adapter.listMothIslands).not.toHaveBeenCalled()
    rerender(<MothPage isActive />)
    expect(await screen.findByRole('button', { name: 'Project new' })).toBeTruthy()
    expect(adapter.ensurePersonalSpace).toHaveBeenCalledTimes(1)
  })
})

describe('🚨 the keyboard', () => {
  const ready = async () => {
    render(<MothPage isActive />)
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
    render(<MothPage isActive />)
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
    render(<MothPage />)
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
    render(<MothPage />)
    expect(await screen.findByText(/did not finish/)).toBeTruthy()
  })
  it('an unfinished office-server operation is looked at on the way in', async () => {
    adapter.networkSharePending = vi.fn(async () => [])
    vi.spyOn(desktopFileOps, 'available').mockReturnValue(true)
    render(<MothPage />)
    await waitFor(() => expect(adapter.networkSharePending).toHaveBeenCalled())
    vi.restoreAllMocks()
  })
})

describe('the trash', () => {
  it('🚨 older trash can be reached: a full page offers more, by the last row\'s date', async () => {
    const row = (id, at) => ({ id, project_id: 'p1', name: `${id}.mov`, deleted_at: at, purges_at: new Date(Date.now() + 86400000).toISOString() })
    const first = Array.from({ length: 200 }, (_, i) => row(`n${i}`, '2026-11-06T00:00:00Z'))
    adapter.listTrashedFiles = vi.fn(async ({ before }) => (before ? [row('old', '2026-11-01T00:00:00Z')] : first))
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    expect(await screen.findByText('old.mov')).toBeTruthy()
    expect(adapter.listTrashedFiles.mock.calls.at(-1)[0].before).toBe('2026-11-06T00:00:00Z')
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })
  it('a short page is the end, and an adapter that ignores the date offers no more', async () => {
    const row = (id) => ({ id, project_id: 'p1', name: `${id}.mov`, deleted_at: '2026-11-06T00:00:00Z' })
    adapter.listTrashedFiles = vi.fn(async () => Array.from({ length: 200 }, (_, i) => row(`n${i}`)))
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull())
  })
  it('a countdown, and Restore', async () => {
    adapter.listTrashedFiles = vi.fn(async () => [{ id: 't', project_id: 'p1', name: 't.mov', project_title: 'Project p1', purges_at: new Date(Date.now() + 2.5 * 86400000).toISOString(), can_restore: true }])
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(/goes in 3 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(adapter.restoreFiles).toHaveBeenCalledWith(['t'], 'p1'))
  })
  it('🚨 could not look is not nothing here', async () => {
    adapter.listTrashedFiles = vi.fn(async () => { throw new Error('x') })
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    expect(await screen.findByText(/Could not look in the trash/)).toBeTruthy()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
  it('nothing here, when it looked', async () => {
    render(<MothPage />)
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
    render(<MothPage />)
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
    adapter.networkShareRecordAdded = vi.fn(async () => { throw new Error('A project\'s folder is outside this company\'s office server.') })
    render(<MothPage />)
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
    render(<MothPage />)
    await addTo()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add files' }).disabled).toBe(true))
    expect(screen.getByText(NOT_ON_THIS_STORAGE_SENTENCE)).toBeTruthy()
  })
  it('on an office server, a browser is told to use the desktop', async () => {
    state.storage = { mode: 'byos', provider: 'network', root_kind: 'unc', root_path: '//s/d' }
    render(<MothPage />)
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
    render(<MothPage />)
    await openProject()
    const box = screen.getByText('m.mov').closest('label').querySelector('input')
    expect(box.disabled).toBe(true)
    expect(box.title).toMatch(/asset/)
    expect(screen.getByText('a.mov').closest('label').querySelector('input').disabled).toBe(false)
  })
  it('🚨 opening the trash empties what is past its 30 days, where no server does', async () => {
    adapter.purgeExpiredTrash = vi.fn(async () => ({ purged: 1 }))
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    await waitFor(() => expect(adapter.listTrashedFiles).toHaveBeenCalled())
    expect(adapter.purgeExpiredTrash.mock.calls.map(([id]) => id).sort()).toEqual(['me', 'p1', 'p2'])
    expect(adapter.purgeExpiredTrash.mock.invocationCallOrder[0]).toBeLessThan(adapter.listTrashedFiles.mock.invocationCallOrder[0])
  })
  it('one that fails does not stop the trash being shown', async () => {
    adapter.purgeExpiredTrash = vi.fn(async () => { throw new Error('no such project') })
    render(<MothPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trash' }))
    await waitFor(() => expect(adapter.listTrashedFiles).toHaveBeenCalled())
  })
})

