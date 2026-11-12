/** @vitest-environment jsdom */
// MO3 (Session 3 review round): the Notes tab with the real useNotes over a stand-in adapter, so the order of loads
// is the hook's own. A note asked for from elsewhere opens once its list has arrived; New note from the trash goes
// to Mine; a note read, not changed, has no format bar and sends nothing; a save the note's own state refuses says
// why in words and stops; a typed link the server did not take is sent once more; a picked link keeps every
// character of its name. The `[[` / `#` picker is a stand-in, so a pick is in the test's hands.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import * as Y from 'yjs'
import { u8ToB64, b64ToU8 } from './noteSync'

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

// ── Review round 2 ──────────────────────────────────────────────────────────

describe('a note closed while its save is on the way', () => {
  it('still sends the merged body\'s links, read from the Y.Doc once the editor is gone', async () => {
    picker.current = inertPicker()
    let release = null
    const a = harness({
      lists: { mine: [row(), row({ id: 'n2', title: 'Second reel' })] },
      bodies: { n1: stateOf(`Keep [[the lantern|m:${KEY}]] in frame.`) },
      saveNoteDoc: vi.fn((id, { expectedVersion }) => new Promise(r => {
        release = () => r({ id, version: expectedVersion + 1, updated_at: 'now' })
      })),
    })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.insertContentAt(1, 'Now: ') })
    // Another note, inside the save delay: the pending edit is flushed as this one closes.
    fireEvent.click(screen.getByText('Second reel'))
    await waitFor(() => expect(a.saveNoteDoc).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(ed.isDestroyed).toBe(true))
    await act(async () => { release() })
    await waitFor(() => expect(a.syncNoteMentions).toHaveBeenCalledWith('n1', 3, [KEY]))
  }, 10000)

  it('sends a co-editor\'s link too when the closed note\'s save merged theirs first', async () => {
    picker.current = inertPicker()
    const KEY2 = 'f6e5d4c3b2a1'
    const body = stateOf(`Keep [[the lantern|m:${KEY}]] in frame.`)
    // Theo's save landed first: the same body plus a line with his link, at version 3.
    const theirs = new Y.Doc()
    Y.applyUpdate(theirs, b64ToU8(body))
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    theirs.getXmlFragment('default').push([p])
    p.push([t])
    t.insert(0, `See [[Mara|m:${KEY2}]]`)
    const remote = u8ToB64(Y.encodeStateAsUpdate(theirs))
    let release = null
    let reads = 0
    const a = harness({
      lists: { mine: [row(), row({ id: 'n2', title: 'Second reel' })] },
      getNote: vi.fn(async (id) => (id === 'n1' && reads++ > 0
        ? row({ version: 3, ydoc_state: remote })
        : row({ id, ydoc_state: id === 'n1' ? body : null }))),
      saveNoteDoc: vi.fn()
        .mockImplementationOnce(() => new Promise(r => { release = () => r(null) }))
        .mockImplementation(async (id, { expectedVersion }) => ({ id, version: expectedVersion + 1, updated_at: 'now' })),
    })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.insertContentAt(1, 'Now: ') })
    fireEvent.click(screen.getByText('Second reel'))
    await waitFor(() => expect(ed.isDestroyed).toBe(true))
    await act(async () => { release() })
    await waitFor(() => expect(a.syncNoteMentions).toHaveBeenCalledTimes(1))
    const [id, version, keys] = a.syncNoteMentions.mock.calls[0]
    expect([id, version]).toEqual(['n1', 4])
    expect([...keys].sort()).toEqual([KEY, KEY2].sort())
  }, 10000)
})

describe('a pick that waits on the server', () => {
  const TOKEN = `[[Shot 12|m:${KEY}]]`
  const pickerWaiting = () => {
    let answer = null
    const p = {
      ...inertPicker(),
      open: true, mode: 'link', active: 0,
      items: [{ kind: 'task', id: 't1', name: 'Shot 12' }],
      pick: vi.fn(() => new Promise(r => { answer = () => r({ start: 4, text: TOKEN }) })),
    }
    return { p, answer: () => answer() }
  }

  it('keeps the words typed after the caret while the server answers', async () => {
    const w = pickerWaiting()
    picker.current = w.p
    harness({ lists: { mine: [row()] }, bodies: { n1: stateOf('See [[Shot') } })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.setTextSelection(11) })
    await waitFor(() => expect(container.querySelector('.rb-mention-picker-row')).toBeTruthy())
    fireEvent.mouseDown(container.querySelector('.rb-mention-picker-row'))
    act(() => { ed.commands.insertContent(' and more') })
    await act(async () => { w.answer() })
    await waitFor(() => expect(ed.getText()).toBe(`See ${TOKEN} and more`))
    // The caret stays after what was typed.
    expect(ed.state.selection.from).toBe(ed.state.doc.content.size - 1)
  })

  it('splices nothing when the words before the caret changed meanwhile', async () => {
    const w = pickerWaiting()
    picker.current = w.p
    harness({ lists: { mine: [row()] }, bodies: { n1: stateOf('See [[Shot') } })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    act(() => { ed.commands.setTextSelection(11) })
    await waitFor(() => expect(container.querySelector('.rb-mention-picker-row')).toBeTruthy())
    fireEvent.mouseDown(container.querySelector('.rb-mention-picker-row'))
    act(() => { ed.commands.insertContentAt(1, 'Now: ') })
    await act(async () => { w.answer() })
    await wait(30)
    expect(ed.getText()).toBe('Now: See [[Shot')
  })
})

describe('a save row security leaves out (the note is still there, at the version sent)', () => {
  it('says why in words at once, locks the editor, and reads the list again', async () => {
    picker.current = inertPicker()
    const a = harness({ lists: { mine: [row()] }, saveNoteDoc: vi.fn(async () => null) })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    const reads = a.listNotes.mock.calls.length
    act(() => { ed.commands.insertContent('Harbour light') })
    expect(await screen.findByText(/This note can no longer be changed by you/, {}, { timeout: 4000 })).toBeTruthy()
    expect(container.querySelector('.dash-save-state').textContent).toBe('Not saved')
    expect(a.saveNoteDoc).toHaveBeenCalledTimes(1)
    expect(ed.isEditable).toBe(false)
    await waitFor(() => expect(a.listNotes.mock.calls.length).toBeGreaterThan(reads))
  }, 10000)
})

describe('a note locked as gone', () => {
  it('has its who-reads-this Select shut, so the note stays open to copy from', async () => {
    picker.current = inertPicker()
    const lists = { mine: [row()] }
    harness({ lists, saveNoteDoc: vi.fn(async () => null) })
    const { container } = mount()
    fireEvent.click(await screen.findByText('Look of the film'))
    const ed = await editorOf(container)
    expect(screen.getByLabelText('Who reads this note').disabled).toBe(false)
    lists.mine = []
    act(() => { ed.commands.insertContent('Harbour light') })
    await screen.findByText(/This note was moved to the trash/, {}, { timeout: 4000 })
    expect(screen.getByLabelText('Who reads this note').disabled).toBe(true)
  }, 10000)
})

describe('a list that fails to load', () => {
  it('shows no other scope\'s notes under its tab', async () => {
    picker.current = inertPicker()
    const a = harness({ lists: { mine: [row()] } })
    a.listNotes.mockImplementation(async ({ scope }) => {
      await wait(15)
      if (scope === 'trash') throw new Error('The trash could not be read.')
      return [row()]
    })
    mount()
    await screen.findByText('Look of the film')
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    expect(await screen.findByText('The trash could not be read.')).toBeTruthy()
    expect(screen.queryByText('Look of the film')).toBeNull()
    expect(screen.getByText('The trash is empty')).toBeTruthy()
  })
})

describe('a scope tab clicked while a note asked for from elsewhere is looked for', () => {
  it('stays on the tab clicked', async () => {
    picker.current = inertPicker()
    const lists = { mine: [row()], shared: [row({ id: 'n-theo', title: 'Theo shot list', owner_id: THEO, tier: 'shared' })], trash: [] }
    const a = harness({ lists })
    a.listNotes.mockImplementation(async ({ scope }) => {
      await wait(scope === 'shared' ? 150 : 15)
      return (lists[scope] || []).map(n => ({ ...n }))
    })
    openDashboardNote('n-theo')
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shared' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    await wait(300)
    expect(screen.getByRole('button', { name: 'Trash' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('Note title')).toBeNull()
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
