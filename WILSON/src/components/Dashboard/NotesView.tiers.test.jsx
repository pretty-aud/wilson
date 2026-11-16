/** @vitest-environment jsdom */
// MO3 (0125 to 0127): the Notes tab where the database keeps tiers and a trash. Its scopes, the trash with its way
// back, a note one may not change opened to read, the tier, the plain words a shared note says about two people's
// changes, and a note's typed links read as their words by D.O.G.'s reader.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import * as Y from 'yjs'
import { u8ToB64 } from './noteSync'
import { noteTextFromState } from './noteText'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
const nb = vi.hoisted(() => ({ current: null }))
vi.mock('./useNotes', () => ({ useNotes: () => nb.current }))
const { default: NotesView, noteMayChange, tierOptions } = await import('./NotesView')

afterEach(cleanup)

const ME = 'me-0000'
const THEO = 'theo-0000'
const note = (over = {}) => ({
  id: 'n1', title: 'Look of the film', subject: null, note_date: '2026-10-12', updated_at: '2026-10-12T16:00:00Z',
  version: 2, body_preview: 'Harbour light', owner_id: ME, tier: 'personal', deleted_at: null, ...over,
})
const hook = (over = {}) => ({
  cloudReady: true, loading: false, error: null, tiers: true, scope: 'mine', userId: ME, isAdmin: false,
  notes: [note()], subjects: [],
  setScope: vi.fn(), createNote: vi.fn(async () => ({ id: 'n2' })), deleteNote: vi.fn(async () => true),
  restoreNote: vi.fn(async () => true), setNoteTier: vi.fn(async () => ({})), syncNoteMentions: vi.fn(async () => true),
  openNote: vi.fn(async () => ({ ydoc_state: null, version: 2 })), saveNoteDoc: vi.fn(async () => ({ version: 3 })),
  patchNoteMeta: vi.fn(async () => {}), reflectSaved: vi.fn(), clearError: vi.fn(), getAdapter: () => null,
  ...over,
})
const mount = (over = {}) => { nb.current = hook(over); return render(<NotesView />) }

describe('who may change a note, and to which tier it may move', () => {
  it('its owner, unless it is the company standard; a live admin, any note that is not personal', () => {
    const who = { tiers: true, userId: ME, isAdmin: false }
    expect(noteMayChange(note(), who)).toBe(true)
    expect(noteMayChange(note({ tier: 'company_standard' }), who)).toBe(false)
    expect(noteMayChange(note({ owner_id: THEO, tier: 'shared' }), who)).toBe(false)
    expect(noteMayChange(note({ owner_id: THEO, tier: 'shared' }), { ...who, isAdmin: true })).toBe(true)
    expect(noteMayChange(note({ owner_id: THEO, tier: 'personal' }), { ...who, isAdmin: true })).toBe(false)
    expect(noteMayChange(note({ owner_id: THEO }), { tiers: false })).toBe(true)
  })

  it('an owner moves between only me and shared; a live admin to and from the standard; no admin makes another\'s note personal', () => {
    const tiers = (n, who) => tierOptions(n, who).map(o => o.value)
    expect(tiers(note(), { userId: ME, isAdmin: false })).toEqual(['personal', 'shared'])
    expect(tiers(note({ tier: 'company_standard' }), { userId: ME, isAdmin: false })).toEqual(['company_standard'])
    expect(tiers(note({ owner_id: THEO, tier: 'shared' }), { userId: ME, isAdmin: true })).toEqual(['shared', 'company_standard'])
    expect(tiers(note({ owner_id: THEO, tier: 'company_standard' }), { userId: ME, isAdmin: true })).toEqual(['shared', 'company_standard'])
  })
})

describe('the Notes tab with tiers and a trash', () => {
  it('lists mine, shared or the trash, as the person picks', () => {
    const r = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Shared' }))
    expect(nb.current.setScope).toHaveBeenCalledWith('shared')
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true')
    r.unmount()
  })

  it('deleting is the trash, said so before, with its way back said', async () => {
    mount()
    fireEvent.click(screen.getByText('Look of the film'))
    fireEvent.click(await screen.findByTitle('Move to trash'))
    expect(screen.getByText('Move this note to the trash?')).toBeTruthy()
    expect(screen.getByText('You can bring it back from the trash for 30 days.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(nb.current.deleteNote).toHaveBeenCalledWith('n1'))
  })

  it('a note in the trash is read and brought back, not edited', async () => {
    mount({ scope: 'trash', notes: [note({ deleted_at: '2026-11-01T00:00:00Z' })] })
    fireEvent.click(screen.getByText('Look of the film'))
    expect(screen.queryByLabelText('Note title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bring back/ }))
    await waitFor(() => expect(nb.current.restoreNote).toHaveBeenCalledWith('n1'))
  })

  it('someone else\'s shared note opens to read, saying who changes it, with no delete', async () => {
    mount({ scope: 'shared', notes: [note({ owner_id: THEO, tier: 'shared' })] })
    fireEvent.click(screen.getByText('Look of the film'))
    expect(await screen.findByText("You can read this note. Its owner and the company's admins change it.")).toBeTruthy()
    expect(screen.queryByTitle('Move to trash')).toBeNull()
    expect(screen.getByLabelText('Note title').disabled).toBe(true)
  })

  it('the company standard tells its owner, who is no admin, that its admins change it', async () => {
    mount({ notes: [note({ tier: 'company_standard' })] })
    fireEvent.click(screen.getByText('Look of the film'))
    expect(await screen.findByText("This is the company standard. You can read it; the company's admins change it.")).toBeTruthy()
  })

  it('a shared note says plainly how two people\'s changes come together, and promises no live typing', async () => {
    mount({ notes: [note({ tier: 'shared' })] })
    fireEvent.click(screen.getByText('Look of the film'))
    const words = (await screen.findByText(/both changes are kept/)).textContent
    expect(words).toContain('when each of you saves')
    expect(words).toContain('You will not see each other type.')
  })

  it('the owner shares a note from its tier', async () => {
    mount()
    fireEvent.click(screen.getByText('Look of the film'))
    const select = await screen.findByLabelText('Who reads this note')
    fireEvent.change(select, { target: { value: 'shared' } })
    expect(nb.current.setNoteTier).toHaveBeenCalledWith('n1', 'shared')
  })

  it('before 0125: no scopes, no tier, and the old words for a delete', async () => {
    mount({ tiers: false, notes: [note({ owner_id: undefined, tier: undefined })] })
    expect(screen.queryByRole('button', { name: 'Shared' })).toBeNull()
    fireEvent.click(screen.getByText('Look of the film'))
    expect(screen.queryByLabelText('Who reads this note')).toBeNull()
    fireEvent.click(await screen.findByTitle('Delete note'))
    expect(screen.getByText('Delete this note permanently?')).toBeTruthy()
  })
})

describe('a note\'s typed links, read for D.O.G.', () => {
  it('read as their words alone, with no key', () => {
    const doc = new Y.Doc()
    const frag = doc.getXmlFragment('default')
    doc.transact(() => {
      const el = new Y.XmlElement('paragraph')
      const text = new Y.XmlText()
      frag.push([el])
      el.push([text])
      text.insert(0, 'Keep [[the lantern|m:a1b2c3d4e5f6]] in frame.')
    })
    const b64 = u8ToB64(Y.encodeStateAsUpdate(doc))
    expect(noteTextFromState(b64)).toBe('Keep the lantern in frame.')
  })
})
