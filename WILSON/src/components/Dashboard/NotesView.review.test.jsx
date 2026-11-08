/** @vitest-environment jsdom */
// MO3 (Session 3 review round): the Notes tab with the real useNotes over a stand-in adapter, so the order of loads
// is the hook's own. A note asked for from elsewhere opens once its list has arrived; New note from the trash goes
// to Mine; a note read, not changed, has no format bar and sends nothing; a save the note's own state refuses says
// why in words and stops; a typed link the server did not take is sent once more; a picked link keeps every
// character of its name. The `[[` / `#` picker is a stand-in, so a pick is in the test's hands.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import * as Y from 'yjs'
import { u8ToB64 } from './noteSync'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => ({ userId: 'me-0000', role: 'user', ready: true }) }))
const picker = vi.hoisted(() => ({ current: null }))
vi.mock('../../tools/rabbit_v0.1.0/components/mentions/useMentionPicker', () => ({ useMentionPicker: () => picker.current }))

const { default: NotesView } = await import('./NotesView')
const { openDashboardNote, takePendingNote } = await import('../../tools/rabbit_v0.1.0/state/linkedThings')
const { ToastProvider } = await import('../../ui')

const ME = 'me-0000'
const THEO = 'theo-0000'
const KEY = 'a1b2c3d4e5f6'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const inertPicker = () => ({
  open: false, mode: null, query: '', items: [], active: -1, message: null, busy: false,
  setActive: vi.fn(), update: vi.fn(), close: vi.fn(), keyDown: () => null, pick: vi.fn(async () => null),
})

function stateOf(text) {
  const doc = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  doc.getXmlFragment('default').push([p])
  p.push([t])
  t.insert(0, text)
  return u8ToB64(Y.encodeStateAsUpdate(doc))
}

const row = (over = {}) => ({
  id: 'n1', title: 'Look of the film', subject: null, note_date: '2026-10-12', updated_at: '2026-10-12T16:00:00Z',
  version: 2, body_preview: '', owner_id: ME, tier: 'personal', deleted_at: null, ...over,
})

// The adapter as useNotes sees it: every list arrives after a moment, as over a network.
function harness({ lists, bodies = {}, ...over }) {
  const adapter = {
    notesHaveTiers: async () => true,
    listNotes: vi.fn(async ({ scope }) => { await wait(15); return (lists[scope] || []).map(n => ({ ...n })) }),
    listNoteSubjects: async () => [],
    getNote: vi.fn(async (id) => {
      const n = [...(lists.mine || []), ...(lists.shared || [])].find(x => x.id === id)
      return n ? { ...n, ydoc_state: bodies[id] ?? null } : null
    }),
    saveNoteDoc: vi.fn(async (id, { expectedVersion }) => ({ id, version: expectedVersion + 1, updated_at: 'now' })),
    syncNoteMentions: vi.fn(async () => true),
    createNote: vi.fn(async () => null),
    restoreNote: vi.fn(async () => true),
    patchNote: vi.fn(async () => ({})),
    ...over,
  }
  rabbit.current = { adapterMode: 'supabase', getAdapter: () => adapter }
  return adapter
}

const mount = () => render(<ToastProvider><NotesView /></ToastProvider>)
const editorOf = async (container) => {
  let ed = null
  await waitFor(() => { ed = container.querySelector('.ProseMirror')?.editor; expect(ed).toBeTruthy() })
  return ed
}

afterEach(() => { cleanup(); takePendingNote(); picker.current = null })

describe('a note asked for from elsewhere (a typed link, Moth\'s Open in Notes)', () => {
  it('opens when the Notes tab mounts for it, before any list has arrived, from the shared list', async () => {
    picker.current = inertPicker()
    harness({ lists: { mine: [row()], shared: [row({ id: 'n-theo', title: 'Theo shot list', owner_id: THEO, tier: 'shared' })] } })
    openDashboardNote('n-theo')
    mount()
    await waitFor(() => expect(screen.getByLabelText('Note title').value).toBe('Theo shot list'))
    expect(screen.getByRole('button', { name: 'Shared' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens when the tab is already showing Mine and the note is someone else\'s shared one', async () => {
    picker.current = inertPicker()
    harness({ lists: { mine: [row()], shared: [row({ id: 'n-theo', title: 'Theo shot list', owner_id: THEO, tier: 'shared' })] } })
    mount()
    await screen.findByText('Look of the film')
    act(() => { openDashboardNote('n-theo') })
    await waitFor(() => expect(screen.getByLabelText('Note title').value).toBe('Theo shot list'))
  })

  it('a note in no list this person sees opens nothing, and says nothing', async () => {
    picker.current = inertPicker()
    const a = harness({ lists: { mine: [row()], shared: [] } })
    openDashboardNote('n-hidden')
    mount()
    await waitFor(() => expect(a.listNotes).toHaveBeenCalledWith({ scope: 'shared' }))
    await wait(60)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.getByText('No note selected')).toBeTruthy()
  })
})

describe('New note and Bring back, from the trash', () => {
  it('New note from the trash goes to Mine and opens the note to write in, not as a trashed one', async () => {
    picker.current = inertPicker()
    const lists = { mine: [row()], trash: [row({ id: 'n-old', title: 'Old cut', deleted_at: '2026-11-01T00:00:00Z' })] }
    harness({
      lists,
      createNote: vi.fn(async (fields) => { const n = row({ id: 'n-new', version: 0, ...fields }); lists.mine.unshift(n); return n }),
    })
    mount()
    await screen.findByText('Look of the film')
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    await screen.findByText('Old cut')
    fireEvent.click(screen.getByRole('button', { name: /New note/ }))
    await waitFor(() => expect(screen.getByLabelText('Note title').value).toBe('Untitled note'))
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: /Bring back/ })).toBeNull()
  })

  it('Bring back says so when there was nothing to bring back, never a false "Brought back"', async () => {
    picker.current = inertPicker()
    harness({
      lists: { mine: [], trash: [row({ id: 'n-old', title: 'Old cut', deleted_at: '2026-11-01T00:00:00Z' })] },
      restoreNote: vi.fn(async () => false),
    })
    mount()
    await screen.findByText('No notes yet')
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    fireEvent.click(await screen.findByText('Old cut'))
    fireEvent.click(screen.getByRole('button', { name: /Bring back/ }))
    expect(await screen.findByText('Not in the trash')).toBeTruthy()
    expect(screen.queryByText('Brought back')).toBeNull()
  })
})

describe('a note read, not changed', () => {
  it('has no format bar, opens no `#` list, and sends nothing even when a command runs', async () => {
    picker.current = inertPicker()
    const a = harness({
      lists: { mine: [], shared: [row({ id: 'n-theo', title: 'Theo shot list', owner_id: THEO, tier: 'shared' })] },
      bodies: { 'n-theo': stateOf('Mood #lig') },
    })
    const { container } = mount()
    await screen.findByText('No notes yet')
    fireEvent.click(screen.getByRole('button', { name: 'Shared' }))
    fireEvent.click(await screen.findByText('Theo shot list'))
    const ed = await editorOf(container)
    expect(container.querySelector('.dash-format-bar')).toBeNull()
    expect(screen.queryByTitle('Add / edit link')).toBeNull()
    act(() => { ed.commands.setTextSelection(10) })
    expect(picker.current.update).not.toHaveBeenCalled()
    act(() => { ed.commands.selectAll(); ed.commands.toggleBold() })
    await wait(1500)
    expect(a.saveNoteDoc).not.toHaveBeenCalled()
  }, 10000)
})

describe('a save the note itself refuses', () => {
  it('a note moved to the trash elsewhere: said in words, the editor locks, and no save is tried again', async () => {
    picker.current = inertPicker()
    const lists = { mine: [row()] }
    const a = harness({ lists, saveNoteDoc: vi.fn(async () => null) })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    lists.mine = []   // trashed on another device: the table shows it to no one now
    act(() => { ed.commands.insertContent('Harbour light') })
    expect(await screen.findByText(/This note was moved to the trash, or is no longer shared with you/, {}, { timeout: 4000 })).toBeTruthy()
    expect(container.querySelector('.dash-save-state').textContent).toBe('Not saved')
    expect(ed.isEditable).toBe(false)
    const saves = a.saveNoteDoc.mock.calls.length
    act(() => { ed.commands.insertContent(' more') })
    await wait(1500)
    expect(a.saveNoteDoc.mock.calls.length).toBe(saves)
    // Still open, so what was typed can be copied.
    expect(ed.getText()).toContain('Harbour light')
  }, 10000)

  it('a note made the company standard under its owner: said in words, and the list read again', async () => {
    picker.current = inertPicker()
    const lists = { mine: [row({ tier: 'shared' })] }
    const a = harness({
      lists,
      saveNoteDoc: vi.fn(async () => {
        lists.mine = [row({ tier: 'company_standard' })]
        throw new Error('[supabase] Only a workspace admin changes the company standard.')
      }),
    })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    const reads = a.listNotes.mock.calls.length
    act(() => { ed.commands.insertContent('Harbour light') })
    expect(await screen.findByText(/This note became the company standard/, {}, { timeout: 4000 })).toBeTruthy()
    await waitFor(() => expect(a.listNotes.mock.calls.length).toBeGreaterThan(reads))
    expect(a.saveNoteDoc).toHaveBeenCalledTimes(1)
    expect(ed.isEditable).toBe(false)
  }, 10000)
})

describe('a typed link the server did not take', () => {
  it('is sent once more, with a fresh save, when a co-editor saved first', async () => {
    picker.current = inertPicker()
    const a = harness({
      lists: { mine: [row()] },
      bodies: { n1: stateOf(`Keep [[the lantern|m:${KEY}]] in frame.`) },
      syncNoteMentions: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.insertContentAt(1, 'Now: ') })
    await waitFor(() => expect(a.syncNoteMentions).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(a.saveNoteDoc).toHaveBeenCalledTimes(2)
    expect(a.syncNoteMentions.mock.calls[1][2]).toEqual([KEY])
    await wait(100)
    expect(a.syncNoteMentions).toHaveBeenCalledTimes(2)
  }, 10000)

  it('is not sent again on a database that keeps no links', async () => {
    picker.current = inertPicker()
    const a = harness({
      lists: { mine: [row()] },
      bodies: { n1: stateOf(`Keep [[the lantern|m:${KEY}]] in frame.`) },
      syncNoteMentions: vi.fn(async () => { throw Object.assign(new Error(''), { code: 'moth_absent' }) }),
    })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.insertContentAt(1, 'Now: ') })
    await waitFor(() => expect(a.syncNoteMentions).toHaveBeenCalledTimes(1), { timeout: 4000 })
    await wait(150)
    expect(a.saveNoteDoc).toHaveBeenCalledTimes(1)
  }, 10000)
})

describe('a link picked with [[', () => {
  // TipTap reads a string as HTML; it keeps the raw string only when that reading is plain text, so the name here
  // has a tag the note's schema knows (<b> is bold), which a string insert would turn into a mark and drop.
  it('keeps every character of its name: < and & are words, not markup', async () => {
    const token = `[[Shot <b>12</b> & Q&amp;A|m:${KEY}]] `
    picker.current = {
      ...inertPicker(),
      open: true, mode: 'link', active: 0,
      items: [{ kind: 'task', id: 't1', name: 'Shot <b>12</b> & Q&amp;A' }],
      pick: vi.fn(async () => ({ start: 4, text: token })),
    }
    harness({ lists: { mine: [row()] }, bodies: { n1: stateOf('See [[Shot') } })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.setTextSelection(11) })
    await waitFor(() => expect(container.querySelector('.rb-mention-picker-row')).toBeTruthy())
    fireEvent.mouseDown(container.querySelector('.rb-mention-picker-row'))
    await waitFor(() => expect(ed.getText()).toBe(`See ${token}`))
  })
})

describe('a caret inside a saved link in a note', () => {
  it('tells the picker the words after the caret too, so it asks nothing there', async () => {
    picker.current = inertPicker()
    harness({ lists: { mine: [row()] }, bodies: { n1: stateOf(`See [[Mara|m:${KEY}]] now`) } })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.setTextSelection(9) })
    await waitFor(() => expect(picker.current.update).toHaveBeenLastCalledWith('See [[Ma', `ra|m:${KEY}]] now`))
  })
})
