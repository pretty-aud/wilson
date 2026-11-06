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
import { OFFICE_SERVER_SENTENCE, FROM_THE_DESKTOP_SENTENCE } from './components/MothPersonalPanel.jsx'

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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
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
    adapter.moveFiles = vi.fn(async () => { throw new Error('A file with this name is already there.') })
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

describe('the trash', () => {
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
  const STATIC = /(?:^|\n)\s*(?:import\b[^'"\n]*from\s*|import\s*|export\b[^'"\n]*from\s*)['"][^'"]*moth_v0\.1\.0[^'"]*['"]/
  it('nothing outside its folder imports from it statically', () => {
    const files = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f) && !f.startsWith(MOTH))
    expect(files.filter((f) => STATIC.test(read(f))).map((f) => path.relative(SRC, f))).toEqual([])
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
  })
})
