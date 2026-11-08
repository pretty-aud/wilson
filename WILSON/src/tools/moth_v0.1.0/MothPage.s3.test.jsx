// @vitest-environment jsdom
// MothPage.s3.test.jsx — MO3 (0125 to 0127): the page's Session 3, mounted against a fake adapter. A link drawn by
// the drag gesture is saved, and a refusal is said in words; the link rules; a note's dot opens on the Dashboard
// after asking; the typed-tags drawer, and its words on a database without them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

const state = vi.hoisted(() => ({ rabbit: null, perms: null }))
vi.mock('../rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => state.rabbit }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => state.perms }))
vi.mock('../../components/TeamMembers/useWorkspaceMembers', () => ({ useWorkspaceMembers: () => ({ members: [] }) }))
vi.mock('../../cloud/workspaceStorage', () => ({ fetchWorkspaceStorage: async () => null, fetchStorageUsage: async () => null }))

import MothPage from './MothPage.jsx'
import { takePendingNote } from '../rabbit_v0.1.0/state/linkedThings.js'

const island = (id, extra = {}) => ({
  id, title: `Project ${id}`, is_personal: false, is_mine: false, is_private: false, my_project_role: 'member', is_staffed: true, can_write: true, ...extra,
})
const MINE = island('me', { title: 'Personal space', is_personal: true, is_mine: true, is_private: true })
const file = (id) => ({ id, name: `${id}.mov`, storage_path: `x/${id}.mov`, storage_provider: 'supabase', project_id: 'p1' })

const worlds = []
function fakeWorld() {
  const w = {
    graphs: [], handlers: {}, selection: [], flown: [],
    setGraph(g, o) { w.graphs.push({ g, o }) }, relayout() {}, positions: () => ({}), setAppearance() {},
    setReducedMotion() {}, setRules(r) { w.rules = r }, setActive() {}, resize() {}, setSelection(s) { w.selection = s },
    flyTo(id) { w.flown.push(id); return true }, on(event, fn) { w.handlers[event] = fn }, renderer: { hitTest: () => null }, destroy() {},
  }
  worlds.push(w)
  return w
}

let adapter
beforeEach(() => {
  adapter = {
    ensurePersonalSpace: vi.fn(async () => 'me'),
    listMothIslands: vi.fn(async () => [MINE, island('p1')]),
    listMothFolders: vi.fn(async () => []),
    listMothFiles: vi.fn(async (pid) => (pid === 'p1' ? [file('a'), file('b')] : [])),
    listTrashedFiles: vi.fn(async () => []),
    getMothPrefs: vi.fn(async () => ({ first_visit_done: true })),
    setMothPrefs: vi.fn(async (patch) => ({ first_visit_done: true, ...patch })),
    listMothViews: vi.fn(async () => []),
    listMothNotes: vi.fn(async () => [{ id: 'n1', title: 'Look of the film', tier: 'shared', is_mine: false, updated_at: '2026-11-01T00:00:00Z' }]),
    listMothRelationships: vi.fn(async () => ({ links: [], truncated: false })),
    createMothRelationship: vi.fn(async () => ({ id: 'r1' })),
  }
  state.rabbit = { getAdapter: () => adapter, adapterMode: 'supabase', noteFilesChangedElsewhere: vi.fn(), showUndoToast: vi.fn() }
  state.perms = { role: 'member', ready: true, userId: 'u1', workspaceId: 'w1' }
})
afterEach(() => { cleanup(); worlds.length = 0; takePendingNote() })

const world = async () => {
  await waitFor(() => expect(worlds.at(-1)?.handlers.drop).toBeTruthy())
  await waitFor(() => expect(worlds.at(-1).graphs.at(-1)?.g.nodes.some((n) => n.id === 'project:p1')).toBe(true))
  return worlds.at(-1)
}

describe('a link drawn in the world', () => {
  it('is saved, from what was dragged to what it was dropped on, and said', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await act(async () => { w.handlers.drop({ dragId: 'file:a', targetId: 'file:b', mode: 'link' }) })
    await waitFor(() => expect(adapter.createMothRelationship).toHaveBeenCalledWith({ sourceKind: 'file', sourceId: 'a', targetKind: 'file', targetId: 'b' }))
    expect(await screen.findByText('Linked “a.mov” to “b.mov”.')).toBeTruthy()
    await waitFor(() => expect(adapter.listMothRelationships.mock.calls.length).toBeGreaterThan(1))
  })

  it('a refusal is said in words, and nothing is linked', async () => {
    adapter.createMothRelationship = vi.fn(async () => { throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }) })
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    await act(async () => { w.handlers.drop({ dragId: 'file:a', targetId: 'file:b', mode: 'link' }) })
    expect(await screen.findByText('You may not change where this link starts, so nothing was linked.')).toBeTruthy()
  })

  it('joins the kinds a link joins, from a thing the person may change; never to itself or a file tag', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    const at = (id, kind, projectId) => ({ id, kind, rowId: id.split(':')[1], projectId })
    expect(w.rules.canLink(at('file:a', 'file', 'p1'), at('file:b', 'file', 'p1')).allowed).toBe(true)
    expect(w.rules.canLink(at('file:a', 'file', 'p1'), at('file:a', 'file', 'p1')).allowed).toBe(false)
    expect(w.rules.canLink(at('file:a', 'file', 'p1'), { id: 'tag:shots', kind: 'tag', rowId: 'shots', projectId: null }).allowed).toBe(false)
    const fromNote = w.rules.canLink({ id: 'note:n1', kind: 'note', rowId: 'n1', projectId: null }, at('file:a', 'file', 'p1'))
    expect(fromNote).toEqual({ allowed: false, reason: 'Only its owner and the company’s admins link from this note.' })
  })
})

describe('a note\'s dot', () => {
  it('opens on the Dashboard, after asking', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    const w = await world()
    const heard = []
    const onNote = (e) => heard.push(e.detail)
    window.addEventListener('wilson:open-dashboard-note', onNote)
    try {
      act(() => w.handlers.pick('note:n1', { additive: false }))
      fireEvent.click(await screen.findByRole('button', { name: 'Open in Notes' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Open Notes on the Dashboard' }))
      expect(heard).toEqual([{ noteId: 'n1' }])
    } finally {
      window.removeEventListener('wilson:open-dashboard-note', onNote)
    }
  })
})

describe('the typed tags drawer', () => {
  it('says so on a database without typed tags', async () => {
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    fireEvent.click(screen.getByRole('button', { name: 'Typed tags' }))
    expect(await screen.findByText('Typed tags are not on this database yet.')).toBeTruthy()
  })

  it('offers a new tag, says when the company has its words, and makes it the person\'s own', async () => {
    Object.assign(adapter, {
      listMothTagTypes: vi.fn(async () => [{ id: 'ty1', tier: 'company', owner_id: null, name: 'Character', shape: 'star', colour: 'rose' }]),
      listMothTags: vi.fn(async () => [{ id: 'c1', tier: 'company', owner_id: null, label: 'Mira', type_id: 'ty1', canonical_id: null, retired_at: null }]),
      listMothTagAssignments: vi.fn(async () => []),
      listMothTagNominations: vi.fn(async () => []),
      createMothTag: vi.fn(async (a) => ({ id: 'm1', ...a })),
    })
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    fireEvent.click(screen.getByRole('button', { name: 'Typed tags' }))
    fireEvent.change(await screen.findByLabelText("The new tag's words"), { target: { value: 'MIRA' } })
    expect(await screen.findByText(/The company has “Mira” \(Character\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("The new tag's type"), { target: { value: 'ty1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make the tag' }))
    await waitFor(() => expect(adapter.createMothTag).toHaveBeenCalledWith({ typeId: 'ty1', tier: 'personal', label: 'MIRA' }))
    expect(await screen.findByText('You have a new tag, yours alone.')).toBeTruthy()
  })

  it('looking back, the drawer changes nothing, and says why', async () => {
    Object.assign(adapter, {
      listMothTagTypes: vi.fn(async () => [{ id: 'ty1', tier: 'company', owner_id: null, name: 'Character', shape: 'star', colour: 'rose' }]),
      listMothTags: vi.fn(async () => []),
      listMothTagAssignments: vi.fn(async () => []),
      listMothTagNominations: vi.fn(async () => []),
      fetchMothHistoryWindow: vi.fn(async () => [{ recording_since: new Date(Date.now() - 30 * 86400000).toISOString() }]),
      fetchMothHistory: vi.fn(async () => []),
    })
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    fireEvent.change(await screen.findByLabelText('Look back'), { target: { value: String(Date.now() - 5 * 86400000) } })
    await waitFor(() => expect(screen.getByText(/^As it was /)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Typed tags' }))
    expect(await screen.findByText('Looking back changes nothing. Come back to now to change things.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make the type' }).closest('fieldset').disabled).toBe(true)
  })
})

describe('a failed read of the workspace\'s rows', () => {
  it('says so in a quiet line, and Try again reads them again', async () => {
    adapter.listMothRelationships = vi.fn(async () => { throw new Error('offline') })
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    const line = await waitFor(() => { const p = document.querySelector('[data-moth-workspace-failed]'); expect(p).toBeTruthy(); return p })
    expect(line.textContent).toMatch(/what was drawn before is kept/)
    adapter.listMothRelationships = vi.fn(async () => ({ links: [], truncated: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('[data-moth-workspace-failed]')).toBeNull())
    expect(document.querySelector('[data-moth-links-truncated]')).toBeTruthy()
  })
})

describe('a list of notes or typed tags cut at its bound', () => {
  it('says so in a quiet line of its own', async () => {
    adapter.listMothTagAssignments = vi.fn(async () => Object.defineProperty([], 'truncated', { value: true, enumerable: false }))
    render(<MothPage worldFactory={fakeWorld} />)
    await world()
    await waitFor(() => expect(document.querySelector('[data-moth-lists-cut]')?.textContent).toMatch(/some are not shown/))
    expect(document.querySelector('[data-moth-links-truncated]')).toBeNull()
  })
})
