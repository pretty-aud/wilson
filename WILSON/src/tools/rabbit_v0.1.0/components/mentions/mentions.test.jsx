/** @vitest-environment jsdom */
// MO3 (0126, 0127): `[[` and `#` in R.A.B.B.I.T.'s words, mounted over a fake adapter: a pick reserves a key and puts
// the token where the asking began; `#` tags the thing and leaves nothing; a seen link's words open its thing, and
// any other token reads as its words alone; "Mentioned in" names what links here.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import { useState } from 'react'
import MentionTextArea from './MentionTextArea'
import { FALLBACK_NOTICE } from './useMentionPicker'
import MentionText from './MentionText'
import MentionedIn from './MentionedIn'
import { linksByKey } from './useItemLinks'
import { mentionTrigger } from '../../state/mentionTokens'
import { linkedThingOpener, takePendingNote, OPEN_RABBIT_ITEM, OPEN_DASHBOARD_NOTE, OPEN_PROJECT_FILE } from '../../state/linkedThings'

afterEach(() => cleanup())

const KEY = 'a1b2c3d4e5f6'
const TASK = '11111111-1111-1111-1111-111111111111'

function fakeAdapter(over = {}) {
  return {
    listMothMentionCandidates: vi.fn(async () => [{ kind: 'asset', id: 'aaaa', name: 'Mira', project_id: 'pppp' }]),
    reserveMothMention: vi.fn(async () => KEY),
    listMothTags: vi.fn(async () => [
      { id: 't-company', tier: 'company', label: 'Mira', canonical_id: null, retired_at: null },
      { id: 't-mine', tier: 'personal', label: 'Mine', canonical_id: null, retired_at: null },
      { id: 't-gone', tier: 'company', label: 'Mira old', canonical_id: 't-company', retired_at: null },
    ]),
    assignMothTag: vi.fn(async (a) => ({ id: 'as1', ...a })),
    ...over,
  }
}

function Field({ adapter, onTagged, initial = '' }) {
  const [value, setValue] = useState(initial)
  return (
    <MentionTextArea aria-label="Description" value={value} onChange={setValue}
      getAdapter={() => adapter} target={{ kind: 'task', id: TASK }} onTagged={onTagged} />
  )
}

function typeInto(el, text) {
  fireEvent.change(el, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } })
  el.setSelectionRange(text.length, text.length)
}

describe('what is being typed before the caret', () => {
  it('[[ and words ask for a link; # and a word after a space ask for a tag; nothing else asks', () => {
    expect(mentionTrigger('See [[gra')).toEqual({ mode: 'link', query: 'gra', start: 4 })
    expect(mentionTrigger('#mi')).toEqual({ mode: 'tag', query: 'mi', start: 0 })
    expect(mentionTrigger('Shot #12')).toEqual({ mode: 'tag', query: '12', start: 5 })
    expect(mentionTrigger('shot#12')).toBeNull()
    expect(mentionTrigger('[[done|m:a1b2c3d4e5f6]] then')).toBeNull()
    expect(mentionTrigger('[[two\nlines')).toBeNull()
    expect(mentionTrigger('')).toBeNull()
  })
})

describe('a textarea that takes [[ and #', () => {
  it('[[ offers what the writer sees; Enter reserves a key and puts the token where [[ began', async () => {
    const adapter = fakeAdapter()
    const { getByLabelText, findByRole } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, 'See [[mi')
    const list = await findByRole('listbox')
    expect(list.textContent).toContain('Mira')
    expect(adapter.listMothMentionCandidates).toHaveBeenCalledWith('mi', 8)
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    await waitFor(() => expect(el.value).toBe(`See [[Mira|m:${KEY}]] `))
    expect(adapter.reserveMothMention).toHaveBeenCalledWith('asset', 'aaaa')
  })

  it('# offers live tags, lights none until an arrow does, and tags the thing leaving nothing in the words', async () => {
    const adapter = fakeAdapter()
    const onTagged = vi.fn()
    const { getByLabelText, findByRole } = render(<Field adapter={adapter} onTagged={onTagged} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, 'Look #mi')
    const list = await findByRole('listbox')
    expect(list.textContent).toContain('Mira')
    expect(list.textContent).not.toContain('Mira old')
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    expect(adapter.assignMothTag).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(el, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    await waitFor(() => expect(el.value).toBe('Look '))
    expect(adapter.assignMothTag).toHaveBeenCalledWith({ tagId: 't-company', tier: 'company', targetKind: 'task', targetId: TASK })
    expect(onTagged).toHaveBeenCalled()
  })

  it('a company tag on a thing the writer may not change is kept as theirs alone', async () => {
    const refused = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' })
    const assignMothTag = vi.fn(async (a) => { if (a.tier === 'company') throw refused; return { id: 'as2', ...a } })
    const adapter = fakeAdapter({ assignMothTag })
    const onTagged = vi.fn()
    const { getByLabelText, findByRole, queryByRole, getByText } = render(<Field adapter={adapter} onTagged={onTagged} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '#mira')
    await findByRole('listbox')
    await act(async () => { fireEvent.keyDown(el, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    await waitFor(() => expect(assignMothTag).toHaveBeenCalledTimes(2))
    expect(assignMothTag.mock.calls[1][0].tier).toBe('personal')
    expect(onTagged.mock.calls[0][2]).toEqual({ mine: true, fallback: true })
    // Said in words once the list has gone, not left to the chip's "yours".
    await waitFor(() => expect(queryByRole('listbox')).toBeNull())
    expect(getByText(FALLBACK_NOTICE).getAttribute('role')).toBe('status')
  })

  it('a caret inside a saved link\'s words opens no list, and Enter stays the field\'s', async () => {
    const adapter = fakeAdapter({ listMothMentionCandidates: vi.fn(async () => [{ kind: 'asset', id: 'aaaa', name: 'Alice', project_id: 'pppp' }]) })
    const text = `See [[Alice|m:${KEY}]] today`
    const { getByLabelText, queryByRole } = render(<Field adapter={adapter} initial={text} />)
    const el = getByLabelText('Description')
    el.focus()
    const at = text.indexOf('ce|')
    el.setSelectionRange(at, at)
    fireEvent.click(el)
    fireEvent.keyUp(el, { key: 'ArrowLeft' })
    await act(async () => { await new Promise(r => setTimeout(r, 250)) })
    expect(queryByRole('listbox')).toBeNull()
    expect(adapter.listMothMentionCandidates).not.toHaveBeenCalled()
    const enter = fireEvent.keyDown(el, { key: 'Enter' })
    expect(enter).toBe(true)
    expect(adapter.reserveMothMention).not.toHaveBeenCalled()
    expect(el.value).toBe(text)
  })

  it('a double-click on a row picks once: one key, one whole token', async () => {
    let answer
    const reserveMothMention = vi.fn(() => new Promise(r => { answer = r }))
    const adapter = fakeAdapter({ reserveMothMention })
    const { getByLabelText, findByRole } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '[[mi')
    const row = within(await findByRole('listbox')).getByText('Mira')
    fireEvent.mouseDown(row)
    fireEvent.mouseDown(row)
    const again = fireEvent.keyDown(el, { key: 'Enter' })
    expect(again).toBe(false)
    await act(async () => { answer(KEY) })
    await waitFor(() => expect(el.value).toBe(`[[Mira|m:${KEY}]] `))
    expect(reserveMothMention).toHaveBeenCalledTimes(1)
  })

  it('Escape while a link waits for its key closes the list, and nothing goes in when the key comes', async () => {
    let answer
    const reserveMothMention = vi.fn(() => new Promise(r => { answer = r }))
    const adapter = fakeAdapter({ reserveMothMention })
    const { getByLabelText, findByRole, queryByRole } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '[[mi')
    fireEvent.mouseDown(within(await findByRole('listbox')).getByText('Mira'))
    fireEvent.keyDown(el, { key: 'Escape' })
    await act(async () => { answer(KEY) })
    expect(queryByRole('listbox')).toBeNull()
    expect(el.value).toBe('[[mi')
  })

  it('Enter typed before a new search lands does not pick a row left over from the last one', async () => {
    const listMothMentionCandidates = vi.fn(async (q) => (q === 'al'
      ? [{ kind: 'asset', id: 'alan', name: 'Alan', project_id: 'pppp' }]
      : [{ kind: 'asset', id: 'alice', name: 'Alice', project_id: 'pppp' }]))
    const adapter = fakeAdapter({ listMothMentionCandidates })
    const { getByLabelText, findByText } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '[[al')
    await findByText('Alan')
    typeInto(el, '[[ali')
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    expect(adapter.reserveMothMention).not.toHaveBeenCalled()
    await findByText('Alice')
    await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }) })
    await waitFor(() => expect(adapter.reserveMothMention).toHaveBeenCalledWith('asset', 'alice'))
  })

  it('keys an input method is composing with are its own, not the list\'s', async () => {
    const adapter = fakeAdapter()
    const { getByLabelText, findByRole } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '[[mi')
    await findByRole('listbox')
    expect(fireEvent.keyDown(el, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(el, { key: 'Enter', keyCode: 229 })).toBe(true)
    expect(fireEvent.keyDown(el, { key: 'ArrowDown', isComposing: true })).toBe(true)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(adapter.reserveMothMention).not.toHaveBeenCalled()
  })

  it('on a database without links, the list says so in words', async () => {
    const absent = Object.assign(new Error('x'), { code: 'moth_absent' })
    const adapter = fakeAdapter({ listMothMentionCandidates: vi.fn(async () => { throw absent }) })
    const { getByLabelText, findByRole } = render(<Field adapter={adapter} />)
    const el = getByLabelText('Description')
    el.focus()
    typeInto(el, '[[x')
    expect((await findByRole('status')).textContent).toBe('Links are not on this database yet.')
  })
})

describe('reading words with typed links', () => {
  it('a seen link opens its thing; an unseen token is its words alone, with nothing that points at it', () => {
    const links = linksByKey([{ id: 'r1', kind: 'asset', target_id: 'aaaa', project_id: 'pppp', name: 'Mira', key: KEY }])
    const hidden = 'ffffffffffff'
    const { container } = render(<MentionText text={`A [[Mira|m:${KEY}]] and [[Secret|m:${hidden}]].`} links={links} />)
    const anchors = container.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].textContent).toBe('Mira')
    expect(container.textContent).toBe('A Mira and Secret.')
    expect(container.innerHTML).not.toContain(hidden)
    const seen = []
    const onItem = (e) => seen.push(e.detail)
    window.addEventListener(OPEN_RABBIT_ITEM, onItem)
    fireEvent.click(anchors[0])
    window.removeEventListener(OPEN_RABBIT_ITEM, onItem)
    expect(seen).toEqual([{ projectId: 'pppp', kind: 'asset', id: 'aaaa' }])
  })

  it('inside a control, a seen link is drawn and not made a link', () => {
    const links = linksByKey([{ id: 'r1', kind: 'asset', target_id: 'aaaa', project_id: 'pppp', name: 'Mira', key: KEY }])
    const { container } = render(<button type="button"><MentionText text={`[[Mira|m:${KEY}]]`} links={links} interactive={false} /></button>)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelector('.rb-mention-link')?.textContent).toBe('Mira')
  })

  it('"Mentioned in" names what links here, by kind and name, and opens it', () => {
    const { getByRole, getByText } = render(<MentionedIn links={[{ id: 'r2', kind: 'note', target_id: 'nnnn', name: 'Look of the film', origin: 'inline' }]} />)
    expect(getByRole('region', { name: 'Mentioned in' })).toBeTruthy()
    const heard = []
    const onNote = (e) => heard.push(e.detail)
    window.addEventListener(OPEN_DASHBOARD_NOTE, onNote)
    fireEvent.click(getByText('Look of the film'))
    window.removeEventListener(OPEN_DASHBOARD_NOTE, onNote)
    expect(heard).toEqual([{ noteId: 'nnnn' }])
    expect(takePendingNote()).toBe('nnnn')
    expect(takePendingNote()).toBeNull()
  })
})

describe('where a linked thing opens', () => {
  it('a file in Files, a folder at its project, nothing without a project', () => {
    const events = []
    const target = { dispatchEvent: (e) => events.push([e.type, e.detail]) }
    linkedThingOpener({ kind: 'file', target_id: 'f1', project_id: 'p1' }, target)()
    linkedThingOpener({ kind: 'folder', target_id: 'd1', project_id: 'p1' }, target)()
    expect(events).toEqual([[OPEN_PROJECT_FILE, { projectId: 'p1', fileId: 'f1' }], [OPEN_RABBIT_ITEM, { projectId: 'p1', kind: 'project', id: 'p1' }]])
    expect(linkedThingOpener({ kind: 'asset', target_id: 'a1', project_id: null }, target)).toBeNull()
    expect(linkedThingOpener({ kind: 'bin', target_id: 'b1', project_id: 'p1' }, target)).toBeNull()
  })
})
