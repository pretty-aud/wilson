/** @vitest-environment jsdom */
// =============================================================================
// ShareSubjectDialog.test.jsx — B2 (2026-10-27), design §5.2.
//
// The dialog in its three modes: each mode's contract line verbatim; several
// people = one call per person, IN ORDER, each reported; a refusal is the
// function's own sentence in the footer; a 500 (an expired session, a lost
// connection) is not a refusal and never reads as one; the whole course's
// success counts the rows carrying the returned batch id and names what the
// function skipped; pass-on leaves out the owner and everyone the caller's
// own rows show holding the subject.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const MEMBERS = [
  { user_id: 'u-me', display_name: 'Audrey', is_active: true },
  { user_id: 'u-mara', display_name: 'Mara', is_active: true },
  { user_id: 'u-ben', display_name: 'Ben', is_active: true },
  { user_id: 'u-priya', display_name: 'Priya', is_active: true },
  { user_id: 'u-zed', display_name: 'Zed', is_active: false },
]
vi.mock('../../../components/TeamMembers/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({ members: MEMBERS, loading: false, error: null }),
}))
// The dialog is handed its fetch; the default (the adapter) must never be reached.
vi.mock('../adapters', () => ({ otterFetch: () => { throw new Error('the default otterFetch was reached') } }))

const { default: ShareSubjectDialog } = await import('./ShareSubjectDialog.jsx')
const { default: CourseRowMenu } = await import('./CourseRowMenu.jsx')

afterEach(cleanup)

const COURSE = { slug: 'c-1', name: 'Blender 5.0', owner_id: 'u-me', is_own: true }
const SUBJECTS = [
  { id: 's-1', slug: 'modifiers', title: 'Modifiers', is_stub: false },
  { id: 's-2', slug: 'rigging', title: 'Rigging', is_stub: false },
  { id: 's-3', slug: 'armatures', title: 'Armatures', is_stub: true },
]

/** A fake backend: who is refused, and how. */
function backend({ refuse = {} } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ method, url, body })
    const reply = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) })
    if (method === 'GET' && url === '/api/software/c-1/subjects') return reply(200, SUBJECTS)
    if (method === 'POST' && (url === '/api/otter/subject-shares' || url === '/api/otter/subject-shares/course')) {
      const r = refuse[body.shared_with]
      if (r) return reply(r.status, { error: r.error })
      return url.endsWith('/course') ? reply(200, { batch_id: `B-${body.shared_with}` }) : reply(200, { id: `sh-${body.shared_with}` })
    }
    return reply(404, { error: 'Not found' })
  }
  return { calls, fetchImpl, posts: () => calls.filter(c => c.method === 'POST') }
}

const pick = (name) => {
  const select = screen.getByLabelText('With')
  const option = [...select.options].find(o => o.textContent === name)
  if (!option) throw new Error(`${name} is not offered`)
  fireEvent.change(select, { target: { value: option.value } })
}
const offered = () => [...screen.getByLabelText('With').options].filter(o => o.value).map(o => o.textContent)
const shareButton = () => screen.getByRole('button', { name: 'Share' })

describe('the contract line, each mode, verbatim (design §5.2)', () => {
  it('a subject (from its study view, pre-filled)', () => {
    const b = backend()
    render(<ShareSubjectDialog mode="subject" course={COURSE} subject={SUBJECTS[0]} userId="u-me" fetchImpl={b.fetchImpl} />)
    expect(screen.getByRole('dialog', { name: 'Share a subject' })).toBeTruthy()
    expect(screen.getByText('They will read this one subject inside their own «Blender 5.0» course, live and read-only, once they accept. Nothing else in your course is shared, and their progress is their own.')).toBeTruthy()
    // No picker: the subject is the study view's.
    expect(screen.queryByLabelText('Subject')).toBeNull()
  })

  it('a subject from the course row menu: a picker of the course\'s subjects, outlines marked', async () => {
    const b = backend()
    render(<ShareSubjectDialog mode="subject" course={COURSE} userId="u-me" fetchImpl={b.fetchImpl} />)
    const select = await screen.findByLabelText('Subject')
    await waitFor(() => expect([...select.options].map(o => o.textContent)).toContain('Armatures (outline only)'))
    expect(shareButton().disabled).toBe(true)   // nobody and nothing chosen yet
  })

  it('the whole course: the live count in the subtitle and the line', async () => {
    const b = backend()
    render(<ShareSubjectDialog mode="course" course={COURSE} userId="u-me" fetchImpl={b.fetchImpl} />)
    expect(await screen.findByText('Blender 5.0 · 3 subjects, 1 of them outline')).toBeTruthy()
    expect(screen.getByText('They will read all 3 subjects inside their own «Blender 5.0» course, live and read-only, once they accept them. Subjects you add later are not included: O.T.T.E.R. will ask you. Nothing else in your course is shared, and their progress is their own.')).toBeTruthy()
  })

  it('passing it on: whose subject, and that the chain falls with its first link', () => {
    const b = backend()
    const mine = { id: 'sh-1', subject_id: 's-1', subject_title: 'Modifiers', course_name: 'Blender 5.0', owner_label: 'Audrey',
      subject_owner_id: 'u-audrey', shared_by: 'u-audrey', shared_with: 'u-me', status: 'accepted', state: 'accepted' }
    const shares = [mine, { id: 'sh-2', subject_id: 's-1', shared_by: 'u-me', shared_with: 'u-ben', status: 'pending', state: 'pending' }]
    render(<ShareSubjectDialog mode="passOn" share={mine} shares={shares} userId="u-me" fetchImpl={b.fetchImpl} />)
    expect(screen.getByText("Audrey's «Modifiers»")).toBeTruthy()
    expect(screen.getByText("They will read Audrey's «Modifiers» inside their own «Blender 5.0» course, live and read-only, once they accept. If Audrey withdraws it from you, they lose it too, and Audrey sees every link.")).toBeTruthy()
    // Not me, not the owner, not Ben (my own rows show him holding it), not a deactivated member.
    expect(offered()).toEqual(['Mara', 'Priya'])
  })
})

describe('several people: one call per person, in order, each reported', () => {
  it('every one shared: one call each, then the success sentence for the library', async () => {
    const b = backend()
    const onDone = vi.fn()
    const onShared = vi.fn(async () => [])
    render(<ShareSubjectDialog mode="subject" course={COURSE} subject={SUBJECTS[0]} userId="u-me" fetchImpl={b.fetchImpl} onDone={onDone} onShared={onShared} />)
    expect(offered()).toEqual(['Mara', 'Ben', 'Priya'])   // not the owner, not Zed
    pick('Mara'); pick('Ben')
    fireEvent.change(screen.getByLabelText(/^A note for them/), { target: { value: 'For Monday' } })
    fireEvent.click(shareButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(b.posts().map(c => c.body)).toEqual([
      { subject_id: 's-1', shared_with: 'u-mara', message: 'For Monday' },
      { subject_id: 's-1', shared_with: 'u-ben', message: 'For Monday' },
    ])
    expect(onDone).toHaveBeenCalledWith('Shared with Mara and Ben. It is waiting for them to accept.')
    expect(onShared).toHaveBeenCalledTimes(1)
  })

  it('a refusal is the function\'s sentence in the footer; the one shared is reported; only the refused stay picked', async () => {
    const b = backend({ refuse: { 'u-ben': { status: 409, error: 'this subject is already shared with that person' } } })
    const onDone = vi.fn()
    render(<ShareSubjectDialog mode="subject" course={COURSE} subject={SUBJECTS[0]} userId="u-me" fetchImpl={b.fetchImpl} onDone={onDone} onShared={async () => []} />)
    pick('Mara'); pick('Ben')
    fireEvent.click(shareButton())
    expect(await screen.findByText('Ben: this subject is already shared with that person.')).toBeTruthy()
    expect(screen.getByText('Shared with Mara. It is waiting for them to accept.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    const pickedList = screen.getByRole('list', { name: 'Sharing with' })
    expect(pickedList.textContent).toBe('Ben')
    // Share again offers Ben alone: Mara is not offered twice.
    fireEvent.click(shareButton())
    await waitFor(() => expect(b.posts().length).toBe(3))
    expect(b.posts()[2].body.shared_with).toBe('u-ben')
  })

  it('a 500 is NOT a refusal: it never reads as the server\'s word', async () => {
    const b = backend({ refuse: { 'u-priya': { status: 500, error: 'JWT expired' } } })
    render(<ShareSubjectDialog mode="subject" course={COURSE} subject={SUBJECTS[0]} userId="u-me" fetchImpl={b.fetchImpl} onShared={async () => []} />)
    pick('Priya')
    fireEvent.click(shareButton())
    expect(await screen.findByText(/^Priya: That did not reach the workspace \(HTTP 500\)\. Check your connection, or sign in again, then try again\.$/)).toBeTruthy()
    expect(screen.queryByText(/JWT expired/)).toBeNull()
  })

  it('the whole course: one createCourse per person; the count is the rows of the returned batch, and the skipped are named', async () => {
    const b = backend()
    const onDone = vi.fn()
    // The function skipped s-1 for Mara (already shared with her): her batch holds s-2 and s-3.
    const fresh = [
      { id: 'r2', batch_id: 'B-u-mara', subject_id: 's-2' },
      { id: 'r3', batch_id: 'B-u-mara', subject_id: 's-3' },
      { id: 'r9', batch_id: 'B-other', subject_id: 's-1' },
    ]
    render(<ShareSubjectDialog mode="course" course={COURSE} userId="u-me" fetchImpl={b.fetchImpl} onDone={onDone} onShared={async () => fresh} />)
    await screen.findByText('Blender 5.0 · 3 subjects, 1 of them outline')
    pick('Mara')
    fireEvent.click(shareButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(b.posts()).toEqual([{ method: 'POST', url: '/api/otter/subject-shares/course', body: { course_id: 'c-1', shared_with: 'u-mara', message: null } }])
    expect(onDone).toHaveBeenCalledWith('Shared your course with Mara: 2 subjects, waiting for them to accept. «Modifiers» was already shared with them.')
  })
})

describe('where it is opened from: the course row menu (design §5.2)', () => {
  const open = (props) => {
    render(<CourseRowMenu role="member" onShare={() => {}} onFork={() => {}} onTrash={() => {}} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^Actions for/ }))
    return [...document.querySelectorAll('[role="menuitem"]')].map(n => n.textContent)
  }

  it('the owner gets both items beside "Share or submit…", and the trigger names both verbs', () => {
    const onShareSubject = vi.fn()
    const items = open({ course: { name: 'Blender 5.0', is_own: true, visibility: 'personal' }, onShareSubject, onShareCourse: () => {} })
    expect(items.slice(0, 3)).toEqual(['Share or submit…', 'Share a subject…', 'Share this course with…'])
    expect(screen.getByRole('button', { name: /^Actions for/ }).getAttribute('aria-label'))
      .toBe('Actions for Blender 5.0 — share or submit, share a subject, share this course with someone, copy or move to trash')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share a subject…' }))
    expect(onShareSubject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Blender 5.0' }))
  })

  it('a colleague\'s shared course: neither item (only the owner shares, S1)', () => {
    const items = open({ course: { name: 'Theirs', is_own: false, visibility: 'shared', can_read_content: true },
      onShareSubject: () => {}, onShareCourse: () => {} })
    expect(items).not.toContain('Share a subject…')
    expect(items).not.toContain('Share this course with…')
  })

  it('no handlers (a site that is not cloud): neither item', () => {
    const items = open({ course: { name: 'Mine', is_own: true, visibility: 'personal' } })
    expect(items).not.toContain('Share a subject…')
    expect(items).not.toContain('Share this course with…')
  })
})
