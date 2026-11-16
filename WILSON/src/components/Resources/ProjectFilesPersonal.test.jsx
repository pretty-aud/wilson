/** @vitest-environment jsdom */
// =============================================================================
// ProjectFilesPersonal.test.jsx — MO1 (0110, MOTH_DESIGN §2.2 PS-9, PSA-10, AU-1):
// personal spaces on the Files page. The picker's entries, by who is looking; an
// admin opening someone else's space is recorded once per selection and before
// anything of it is listed, and a record that fails lists nothing; the owner
// writes, the admin reads with the reason. The rows come from the fixtures
// adapter where it can answer (the same shape as the cloud's).
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const FILE = { id: 'f1', name: 'her-notes.pdf', folder_id: null, size_bytes: 10, mime_type: 'application/pdf', created_at: '2026-09-01T10:00:00Z' }
const MINE = { id: 'ps-mine', title: 'Personal space', personal_owner_id: 'u1', folder_slug: 'Personal_u1', updated_at: 'x' }
const HERS = { id: 'ps-hers', title: 'Personal space', personal_owner_id: 'u2', folder_slug: 'Personal_u2', updated_at: 'x' }
const GONE = { id: 'ps-gone', title: 'Personal space', personal_owner_id: 'u9', folder_slug: 'Personal_u9', updated_at: 'x' }

const log = []
const adapter = {
  spaces: [MINE, HERS, GONE],
  recordFails: false,
  listPersonalSpaces: async () => adapter.spaces,
  recordPersonalSpaceOpened: async (id) => {
    log.push(`record:${id}`)
    if (adapter.recordFails) throw new Error('42501')
  },
  listFolders: async (id) => { log.push(`list:${id}`); return [] },
  listFiles: async () => [FILE],
  listManagedFiles: async () => [],
}
const ctx = {
  adapterMode: 'supabase',
  projectsIndex: { p1: { id: 'p1', title: 'Salt Hours' }, p2: { id: 'p2', title: 'Private one', is_private: true } },
  activeProjectId: null,
  getAdapter: () => adapter,
}
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => ctx }))

const perms = { role: 'admin', ready: true, workspaceId: 'w1', userId: 'u1' }
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => perms }))

const members = {
  members: [
    { user_id: 'u1', display_name: 'Mara Okonkwo', is_active: true },
    { user_id: 'u2', display_name: 'Priya Raman', is_active: false },
  ],
  loading: false,
  error: null,
}
vi.mock('../TeamMembers/useWorkspaceMembers', () => ({ useWorkspaceMembers: () => members }))

const { default: ProjectFilesExplorer } = await import('./ProjectFilesExplorer')

afterEach(() => {
  cleanup()
  log.length = 0
  adapter.spaces = [MINE, HERS, GONE]
  adapter.recordFails = false
  perms.role = 'admin'
  perms.userId = 'u1'
  ctx.adapterMode = 'supabase'
})

const optionLabels = () => [...screen.getByLabelText('Project').querySelectorAll('option')].map(o => o.textContent).filter(t => t !== 'Choose a project…')
const pick = (value) => fireEvent.change(screen.getByLabelText('Project'), { target: { value } })
async function mounted() {
  render(<ProjectFilesExplorer />)
  await waitFor(() => expect(optionLabels().some(l => /personal space/i.test(l))).toBe(true))
}
const shows = (name) => waitFor(() => expect(document.querySelector('[data-files-explorer]').textContent).toContain(name))
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })

describe('the picker', () => {
  it('an admin: their own first, the projects, then other people\'s by name and what is known of them', async () => {
    await mounted()
    expect(optionLabels()).toEqual([
      'My personal space',
      'Private one · private',
      'Salt Hours',
      'Personal space · (former member)',
      'Personal space · Priya Raman (inactive)',
    ])
  })

  it('an ordinary person sees their own only: RLS answers for the rest', async () => {
    perms.role = 'user'
    adapter.spaces = [MINE]
    await mounted()
    expect(optionLabels()).toEqual(['My personal space', 'Private one · private', 'Salt Hours'])
  })

  it('CONTROL: no personal space, no entry; an adapter without the method lists as before', async () => {
    adapter.spaces = []
    render(<ProjectFilesExplorer />)
    await settle()
    expect(optionLabels()).toEqual(['Private one · private', 'Salt Hours'])
  })

  it('R.A.B.B.I.T.\'s tab has no picker and asks nothing about personal spaces', async () => {
    const seen = vi.spyOn(adapter, 'listPersonalSpaces')
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await settle()
    expect(seen).not.toHaveBeenCalled()
    seen.mockRestore()
  })
})

describe('an admin opening someone else\'s space (her answer 4)', () => {
  it('records first, once; then lists, read-only, with the reason', async () => {
    await mounted()
    pick('ps-hers')
    await shows('her-notes.pdf')
    expect(log.filter(l => l === 'record:ps-hers')).toHaveLength(1)
    expect(log.indexOf('record:ps-hers')).toBeLessThan(log.indexOf('list:ps-hers'))
    expect(document.querySelector('[data-personal-read-only]').textContent).toContain('Only the owner of a personal space can change it.')
  })

  it('Reload lists again and records nothing new', async () => {
    await mounted()
    pick('ps-hers')
    await shows('her-notes.pdf')
    fireEvent.click(screen.getByTitle("Reload this project's folders and files"))
    await waitFor(() => expect(log.filter(l => l === 'list:ps-hers').length).toBeGreaterThan(1))
    expect(log.filter(l => l === 'record:ps-hers')).toHaveLength(1)
  })

  it('leaving and coming back is a new selection: a new line', async () => {
    await mounted()
    pick('ps-hers')
    await shows('her-notes.pdf')
    pick('p1')
    await settle()
    pick('ps-hers')
    await waitFor(() => expect(log.filter(l => l === 'record:ps-hers')).toHaveLength(2))
  })

  it('a record that fails says so and lists NOTHING', async () => {
    adapter.recordFails = true
    await mounted()
    pick('ps-hers')
    await waitFor(() => expect(document.querySelector('[data-personal-record-error]')).toBeTruthy())
    await settle()
    expect(log).not.toContain('list:ps-hers')
    expect(document.querySelector('[data-files-explorer]').textContent).not.toContain('her-notes.pdf')
    // Reload tries again, and now it lists.
    adapter.recordFails = false
    fireEvent.click(screen.getByTitle("Reload this project's folders and files"))
    await shows('her-notes.pdf')
    expect(document.querySelector('[data-personal-record-error]')).toBe(null)
  })

  it('FAILING CONTROL: the owner opening their own writes no line, and has no read-only notice', async () => {
    await mounted()
    pick('ps-mine')
    await shows('her-notes.pdf')
    expect(log.some(l => l.startsWith('record:'))).toBe(false)
    expect(document.querySelector('[data-personal-read-only]')).toBe(null)
  })

  it('CONTROL: an ordinary project writes no line', async () => {
    await mounted()
    pick('p1')
    await shows('her-notes.pdf')
    expect(log.some(l => l.startsWith('record:'))).toBe(false)
  })
})

describe('who may change it (PSA-10)', () => {
  const notes = () => document.querySelector('[data-file-details] textarea[data-file-notes]')
  const openFile = async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    fireEvent.click(await screen.findByRole('button', { name: /her-notes\.pdf/ }))
  }
  it('the owner can; an admin of the same workspace cannot', async () => {
    await mounted()
    pick('ps-hers')
    await shows('her-notes.pdf')
    await openFile()
    await waitFor(() => expect(notes()).toBeTruthy())
    expect(notes().disabled).toBe(true)
    expect(document.querySelector('[data-write-reason]').textContent).toBe('Only the owner of a personal space can change it.')
  })
  it('FAILING CONTROL: the same control is open to the owner', async () => {
    await mounted()
    pick('ps-mine')
    await shows('her-notes.pdf')
    await openFile()
    await waitFor(() => expect(notes()).toBeTruthy())
    expect(notes().disabled).toBe(false)
    expect(document.querySelector('[data-write-reason]')).toBe(null)
  })
})

describe('the signed-out desktop', () => {
  it('says where it is, is open to its only person, and records nothing', async () => {
    ctx.adapterMode = 'local_server'
    perms.role = null
    perms.userId = null
    adapter.spaces = [{ id: 'ps-local', title: 'Personal space', personal: true }]
    await mounted()
    expect(optionLabels()[0]).toBe('Personal space on this computer')
    pick('ps-local')
    await shows('her-notes.pdf')
    expect(log.some(l => l.startsWith('record:'))).toBe(false)
    expect(document.querySelector('[data-personal-read-only]')).toBe(null)
  })
})
