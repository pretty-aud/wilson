// @vitest-environment jsdom
// MothTagPanel.test.jsx — MO3 (0126): the typed-tag drawer against a fake adapter. A change the database made
// nowhere never says done; the type has its own tick; the selected thing's list follows a tag put on; a company tag
// is offered only company types, and a refusal is said in plain words; looking back, nothing here changes anything.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import MothTagPanel from './MothTagPanel.jsx'
import { FALLBACK_NOTICE } from '../../rabbit_v0.1.0/components/mentions/useMentionPicker'

const TYPES = [
  { id: 'tyc', tier: 'company', owner_id: null, name: 'Character', shape: 'star', colour: 'rose', retired_at: null },
  { id: 'tym', tier: 'personal', owner_id: 'u1', name: 'Drafts', shape: 'circle', colour: 'mist', retired_at: null },
]
const tag = (id, extra = {}) => ({ id, tier: 'company', owner_id: null, label: id, type_id: 'tyc', canonical_id: null, retired_at: null, ...extra })

let adapter
let workspace
let store
beforeEach(() => {
  workspace = { types: TYPES, mtags: [tag('Mira'), tag('Theo', { tier: 'personal', owner_id: 'u1' })], assignments: [] }
  adapter = {
    listMothTagNominations: vi.fn(async () => []),
    listMothTags: vi.fn(async () => workspace.mtags),
    listMothTagAssignments: vi.fn(async () => []),
    assignMothTag: vi.fn(async () => ({ id: 'as1' })),
    createMothTag: vi.fn(async (a) => ({ id: 'new', ...a })),
    createMothTagType: vi.fn(async (a) => ({ id: 'tynew', ...a })),
    updateMothTag: vi.fn(async (id) => ({ id })),
    deleteMothTag: vi.fn(async () => ({ removed: true })),
  }
  store = { readWorkspace: vi.fn(async () => {}) }
})
afterEach(cleanup)

const mount = (props = {}) => render(<MothTagPanel adapter={adapter} store={store} workspace={workspace} absent={false}
  isAdmin={false} userId="u1" selectedNode={null} {...props} />)

describe('a change the database made nowhere', () => {
  it('a rename or a retire that changed no row says so, never done', async () => {
    adapter.updateMothTag = vi.fn(async () => null)
    mount({ isAdmin: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('A new name for Mira'), { target: { value: 'Mirabel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Nothing changed: that tag is not one you can change.')).toBeTruthy()
    expect(screen.queryByText('Renamed everywhere it is used.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    await waitFor(() => expect(adapter.updateMothTag).toHaveBeenCalledWith('Mira', { retired: true }))
    expect(await screen.findByText('Nothing changed: that tag is not one you can change.')).toBeTruthy()
    expect(screen.queryByText(/Retired:/)).toBeNull()
  })

  it('a thrown refusal shows its words, and a delete that removed nothing says so', async () => {
    adapter.updateMothTag = vi.fn(async () => { throw new Error('Only the company’s admins rename its tags.') })
    adapter.deleteMothTag = vi.fn(async () => ({ removed: false }))
    mount({ isAdmin: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Retire' }))
    expect(await screen.findByText('Only the company’s admins rename its tags.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Nothing was deleted: that tag is gone already, or not yours to delete.')).toBeTruthy()
    expect(screen.queryByText('Deleted.')).toBeNull()
  })
})

describe('a new type', () => {
  it('has its own tick: the tag\'s tick never makes the type the company\'s, and the words say whose it is', async () => {
    mount({ isAdmin: true })
    fireEvent.click(within(await screen.findByRole('group', { name: 'A new tag' })).getByRole('checkbox', { name: 'For the company' }))
    fireEvent.change(screen.getByLabelText("The new type's name"), { target: { value: 'My drafts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make the type' }))
    await waitFor(() => expect(adapter.createMothTagType).toHaveBeenCalledWith({ tier: 'personal', name: 'My drafts', shape: 'circle', colour: 'mist' }))
    expect(await screen.findByText('You have a new type, yours alone.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('group', { name: 'A new type' })).getByRole('checkbox', { name: 'For the company' }))
    fireEvent.change(screen.getByLabelText("The new type's name"), { target: { value: 'Location' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make the type' }))
    await waitFor(() => expect(adapter.createMothTagType).toHaveBeenLastCalledWith({ tier: 'company', name: 'Location', shape: 'circle', colour: 'mist' }))
    expect(await screen.findByText('The company has a new type.')).toBeTruthy()
  })
})

describe('the selected thing', () => {
  it('its list of tags is read again after Tag it', async () => {
    mount({ selectedNode: { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' }, canChange: true })
    await waitFor(() => expect(adapter.listMothTagAssignments).toHaveBeenCalledWith({ targetKind: 'file', targetId: 'a' }))
    adapter.listMothTagAssignments = vi.fn(async () => [{ id: 'as1', tag_id: 'Mira', tier: 'company', target_type: 'file', target_id: 'a' }])
    fireEvent.change(screen.getByLabelText('A tag for the selected thing'), { target: { value: 'Mira' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tag it' }))
    expect(await screen.findByText('Tagged.')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take off Mira' })).toBeTruthy())
  })

  it('taking a tag off from its list reads the workspace again, so the map redraws its line', async () => {
    adapter.listMothTagAssignments = vi.fn(async () => [{ id: 'as1', tag_id: 'Mira', tier: 'company', target_type: 'file', target_id: 'a' }])
    adapter.unassignMothTag = vi.fn(async () => ({ removed: true }))
    const onChanged = vi.fn()
    mount({ selectedNode: { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' }, canChange: true, onChanged })
    const off = await screen.findByRole('button', { name: 'Take off Mira' })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const reads = store.readWorkspace.mock.calls.length
    fireEvent.click(off)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(adapter.unassignMothTag).toHaveBeenCalledWith('as1')
    expect(store.readWorkspace.mock.calls.length).toBe(reads + 1)
  })

  it('a company tag offers no take-off cross to a person who may not change the thing; their own always does', async () => {
    adapter.listMothTagAssignments = vi.fn(async () => [
      { id: 'as1', tag_id: 'Mira', tier: 'company', target_type: 'file', target_id: 'a' },
      { id: 'as2', tag_id: 'Theo', tier: 'personal', target_type: 'file', target_id: 'a' },
    ])
    const { rerender } = mount({ selectedNode: { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' }, canChange: false })
    expect(await screen.findByRole('button', { name: 'Take off Theo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Take off Mira' })).toBeNull()
    rerender(<MothTagPanel adapter={adapter} store={store} workspace={workspace} absent={false} isAdmin={false} userId="u1"
      selectedNode={{ id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' }} canChange />)
    expect(await screen.findByRole('button', { name: 'Take off Mira' })).toBeTruthy()
  })

  it('a company tag kept as the person\'s own, where they may not change the thing, says so', async () => {
    adapter.assignMothTag = vi.fn(async ({ tier }) => {
      if (tier === 'company') throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' })
      return { id: 'as1' }
    })
    mount({ selectedNode: { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' } })
    fireEvent.change(await screen.findByLabelText('A tag for the selected thing'), { target: { value: 'Mira' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tag it' }))
    expect(await screen.findByText(`Tagged. ${FALLBACK_NOTICE}`)).toBeTruthy()
    expect(adapter.assignMothTag).toHaveBeenLastCalledWith({ tagId: 'Mira', tier: 'personal', targetKind: 'file', targetId: 'a' })
    // The company's tag put on for the company says only that it is tagged.
    adapter.assignMothTag = vi.fn(async () => ({ id: 'as2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tag it' }))
    expect(await screen.findByText('Tagged.')).toBeTruthy()
  })

  it('a picked tag since retired is no longer offered: Tag it is shut', async () => {
    const node = { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' }
    const { rerender } = mount({ selectedNode: node })
    fireEvent.change(await screen.findByLabelText('A tag for the selected thing'), { target: { value: 'Mira' } })
    expect(screen.getByRole('button', { name: 'Tag it' }).disabled).toBe(false)
    const later = { ...workspace, mtags: [tag('Mira', { retired_at: '2026-11-01T00:00:00Z' }), workspace.mtags[1]] }
    rerender(<MothTagPanel adapter={adapter} store={store} workspace={later} absent={false} isAdmin={false} userId="u1" selectedNode={node} />)
    expect(screen.getByRole('button', { name: 'Tag it' }).disabled).toBe(true)
    expect(adapter.assignMothTag).not.toHaveBeenCalled()
  })
})

describe('words the database refuses', () => {
  it('a blank rename cannot be saved, and a length refusal is said in plain words', async () => {
    adapter.updateMothTag = vi.fn(async () => { throw Object.assign(new Error('new row for relation "moth_tags" violates check constraint "moth_tags_label_chk"'), { code: '23514' }) })
    mount({ isAdmin: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const field = screen.getByLabelText('A new name for Mira')
    expect(field.getAttribute('maxlength')).toBe('80')
    fireEvent.change(field, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'Mirabel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Those words cannot be kept: a tag takes 1 to 80 characters, a type 1 to 60, with no hidden characters.')).toBeTruthy()
    expect(screen.queryByText(/violates/)).toBeNull()
    expect(screen.getByLabelText("The new type's name").getAttribute('maxlength')).toBe('60')
  })
})

describe('what is put forward', () => {
  it('a failed read keeps what was shown, and says so; never an empty list', async () => {
    workspace.mtags = [tag('Mira'), tag('Theo', { tier: 'personal', owner_id: 'u1' })]
    adapter.listMothTagNominations = vi.fn(async () => [{ id: 'nm1', tag_id: 'Theo', status: 'open', proposer_id: 'u1', label: 'Theo', type_name: 'Character' }])
    adapter.withdrawMothTagNomination = vi.fn(async () => true)
    mount({ isAdmin: true })
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy()
    // The next read, after a change, fails.
    adapter.listMothTagNominations = vi.fn(async () => { throw new Error('timeout') })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Could not read what is put forward just now: what was shown before is kept.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('an admin whose first read failed is not told nothing waits', async () => {
    adapter.listMothTagNominations = vi.fn(async () => { throw new Error('timeout') })
    mount({ isAdmin: true })
    expect(await screen.findByText('Could not read what is put forward just now: what was shown before is kept.')).toBeTruthy()
    expect(screen.queryByText('Nothing waits.')).toBeNull()
  })
})

describe('an admin making a company tag', () => {
  it('is not stopped by their own tag of the same words; the company\'s of the same words and type does stop it', async () => {
    mount({ isAdmin: true })
    fireEvent.click(within(await screen.findByRole('group', { name: 'A new tag' })).getByRole('checkbox', { name: 'For the company' }))
    fireEvent.change(screen.getByLabelText("The new tag's type"), { target: { value: 'tyc' } })
    fireEvent.change(screen.getByLabelText("The new tag's words"), { target: { value: 'theo' } })
    expect(screen.queryByText(/already, of this type/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Make the tag' }).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText("The new tag's words"), { target: { value: 'MIRA' } })
    expect(screen.getByText(/The company has “Mira” already, of this type\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make the tag' }).disabled).toBe(true)
  })
})

describe('a company tag', () => {
  it('is offered only the company\'s types, and a refusal is said in plain words', async () => {
    mount({ isAdmin: true })
    const typeSelect = await screen.findByLabelText("The new tag's type")
    fireEvent.change(typeSelect, { target: { value: 'tym' } })
    expect(typeSelect.value).toBe('tym')
    fireEvent.click(within(screen.getByRole('group', { name: 'A new tag' })).getByRole('checkbox', { name: 'For the company' }))
    expect([...typeSelect.options].map((o) => o.value)).toEqual(['', 'tyc'])
    expect(typeSelect.value).toBe('')
    expect(screen.getByRole('button', { name: 'Make the tag' }).disabled).toBe(true)

    adapter.createMothTag = vi.fn(async () => { throw Object.assign(new Error('new row violates row-level security policy for table "moth_tags"'), { code: '42501' }) })
    fireEvent.change(typeSelect, { target: { value: 'tyc' } })
    fireEvent.change(screen.getByLabelText("The new tag's words"), { target: { value: 'Priya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make the tag' }))
    expect(await screen.findByText('You may not make that for the company.')).toBeTruthy()

    adapter.createMothTag = vi.fn(async () => { throw Object.assign(new Error('insert or update on table "moth_tags" violates foreign key constraint "moth_tags_type_fk"'), { code: '23503' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Make the tag' }))
    expect(await screen.findByText('That type cannot be used for this tag.')).toBeTruthy()
    expect(screen.queryByText(/violates/)).toBeNull()
  })
})

describe('looking back', () => {
  it('shuts every part of the drawer, and says why', async () => {
    mount({ isAdmin: true, readOnly: 'Looking back changes nothing. Come back to now to change things.',
      selectedNode: { id: 'file:a', kind: 'file', rowId: 'a', label: 'a.mov' } })
    expect(await screen.findByText('Looking back changes nothing. Come back to now to change things.')).toBeTruthy()
    for (const name of ['Tag it', 'Make the tag', 'Make the type', 'Rename', 'Retire', 'Delete']) {
      expect(screen.getByRole('button', { name }).closest('fieldset').disabled).toBe(true)
    }
  })

  it('opening the drawer reads no workspace again, so the page does not read its record again for the same time', async () => {
    mount({ readOnly: 'Looking back changes nothing. Come back to now to change things.' })
    await waitFor(() => expect(adapter.listMothTagNominations).toHaveBeenCalled())
    expect(store.readWorkspace).not.toHaveBeenCalled()
  })
})
