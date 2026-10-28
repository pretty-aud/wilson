/** @vitest-environment jsdom */
// =============================================================================
// linkedProgress.test.js — B2 (2026-10-27), docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §5.4, §5.5, §5.9.
//
// Otter.jsx mounted whole against a small in-memory backend, for the rules a
// source scan cannot hold:
//
//   1. THE KEY, NOT THE SLUG (§5.5). A linked subject's ticks sit on the HOST
//      course's progress row under `link:<subject_id>` (linkKey(), the one
//      definition), never under its slug: the host holds its OWN `modifiers`
//      here, with the same lesson ids, and a slug key would tick both. The
//      active row is matched by the same key, so the host's own `modifiers`
//      never lights up while the linked one is open.
//   2. NO LINKED BODY IN ANY SESSION CACHE (§5.4). The body is read by id on
//      each use and handed to one reader; it is never written to
//      subjectCacheRef or softwareCacheRef — the stores the Validator
//      (rendered hidden, never unmounted) enumerates — nor to
//      quizSelectionData. The REAL Validator is then drawn over the very
//      cache objects Otter.jsx wrote, and counts the own lesson only.
//   3. A 404 ON OPEN (§5.4): the share list is re-read FIRST, the index's
//      state chooses the words, the row leaves the course (or stays greyed),
//      and the pet's index is cleared.
//   4. THE REMINDER (§5.9) fires from a save path after its last save, in
//      cloud mode only, offers only what the course did not hold before, maps
//      it to the id subject.list returns AFTER the save, and Share makes an
//      ordinary single row. The undo path is driven here (in cloud mode an
//      undo is a NEW row with a new id); NewSubjectShareReminder.test.jsx
//      pins the other five paths by source.
//
// FAILING CONTROLS (each a mutation of Otter.jsx, run once and reverted; the
// hand-off records the reds): key the tick by the linked body's slug; write
// the linked body into subjectCacheRef on open; light the own row by the open
// subject's slug; word a 404 without the re-read; drop the cloud gate.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { linkKey, isLinkKey, activeSubjectKeyOf } from './components/otterSharing.js'

// ── the in-memory backend ────────────────────────────────────────────────────
const HOST = {
  slug: 'host-1', name: 'My Blender', type: 'software', skill_level: 'beginner',
  visibility: 'personal', is_own: true, can_write: true, can_read_content: true, owner_id: 'u-me',
}
const OWN_FULL = {
  id: 'own-1', slug: 'modifiers', title: 'Modifiers of mine', is_stub: false, subject_order: 1, skill_level: 'beginner',
  sections: [{ id: 's1', title: 'Own section', lessons: [{ id: 'lesson_1_1', title: 'Own lesson', content: 'OWN-BODY' }] }],
}
const LINKED_FULL = {
  id: 'sub-L', slug: 'modifiers', title: 'Modifiers', is_stub: false, linked: true, software_slug: 'src-1',
  sections: [{ id: 's1', title: 'Linked section', lessons: [{ id: 'lesson_1_1', title: 'Linked lesson', content: 'LINKED-BODY-MARKER' }] }],
}
const LINK = {
  id: 'sh-1', subject_id: 'sub-L', subject_title: 'Modifiers', subject_is_stub: false,
  course_id: 'src-1', course_name: 'Blender 5.0', course_slug: 'blender-5-0', course_type: 'software', skill_level: 'beginner',
  shared_by: 'u-audrey', sharer_label: 'Audrey', shared_with: 'u-me', receiver_label: 'Me',
  subject_owner_id: 'u-audrey', owner_label: 'Audrey', batch_id: null, via_share_id: null, chain_depth: 1,
  status: 'accepted', state: 'accepted', message: null, host_course_id: 'host-1', host_live: true,
  created_at: '2026-10-25T10:00:00Z', responded_at: '2026-10-25T11:00:00Z', ended_by: null, is_mine: false, is_owner: false,
}
// A course of mine shared WHOLE with Mara (the reminder's people).
const BATCH_ROW = {
  ...LINK, id: 'sh-b1', subject_id: 'own-0', subject_title: 'Basics', course_id: 'host-1', course_name: 'My Blender',
  shared_by: 'u-me', sharer_label: 'Me', shared_with: 'u-mara', receiver_label: 'Mara', subject_owner_id: 'u-me',
  owner_label: 'Me', batch_id: 'b1', status: 'pending', state: 'pending', host_course_id: null, host_live: null,
  is_mine: true, is_owner: true,
}

let world
function freshWorld() {
  return {
    cloud: true,
    subjects: [{ ...OWN_FULL }],
    nextId: 2,
    shares: [LINK],
    sharesAfter404: null,
    linked: LINKED_FULL,
    reads: [],
    writes: [],
  }
}

const listOf = (s) => ({ id: s.id, slug: s.slug, title: s.title, description: '', skill_level: s.skill_level, is_stub: s.is_stub, subject_order: s.subject_order })
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fakeOtterFetch(url, init) {
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(init.body) : null
  if (method === 'GET') world.reads.push(url)
  else world.writes.push({ method, url, body })
  if (method === 'POST' && url === '/api/software/host-1/subjects') {
    // subject.save: a slug it finds is updated; otherwise a NEW row, new id.
    const at = world.subjects.findIndex(s => s.slug === body.slug)
    if (at >= 0) world.subjects[at] = { ...world.subjects[at], ...body, id: world.subjects[at].id }
    else world.subjects.push({ ...body, id: `own-${world.nextId++}` })
    return json(listOf(world.subjects.find(s => s.slug === body.slug)))
  }
  if (method === 'DELETE' && url.startsWith('/api/software/host-1/subjects/')) {
    const slug = url.split('/').pop()
    world.subjects = world.subjects.filter(s => s.slug !== slug)   // RLS hides the trashed row
    return json({ ok: true })
  }
  if (method !== 'GET') return json({ ok: true })
  if (url === '/api/otter/subjects/sub-L') {
    if (world.linked) return json(world.linked)
    if (world.sharesAfter404) world.shares = world.sharesAfter404
    return json({ error: 'Not found' }, 404)
  }
  if (url.startsWith('/api/software/host-1/subjects/')) {
    const s = world.subjects.find(x => x.slug === url.split('/').pop())
    return s ? json(s) : json({ error: 'Not found' }, 404)
  }
  const routes = {
    '/api/software': [HOST],
    '/api/software/host-1': HOST,
    '/api/software/host-1/subjects': world.subjects.map(listOf),
    '/api/software/host-1/progress': { subjects: {} },
    '/api/software/host-1/hotkeys': { categories: [] },
    '/api/software/host-1/functions': { categories: [] },
    '/api/software/host-1/nodes': { categories: [] },
    '/api/software/host-1/references': { urls: [] },
    '/api/otter/subject-shares': world.shares,
    '/api/otter/change-requests': [],
    '/api/otter/nominations': [],
  }
  if (url in routes) return json(routes[url])
  return json({ error: 'Not found' }, 404)
}

// ── the seams Otter.jsx reaches through ──────────────────────────────────────
const validatorProps = { current: null }
const petClears = { count: 0 }
vi.mock('./adapters', () => ({
  otterFetch: (...a) => fakeOtterFetch(...a),
  otterCloudActive: () => Promise.resolve(world.cloud),
  getOtterAdapterMode: () => 'auto',
  setOtterAdapterMode: () => 'auto',
  subscribeOtterAdapterMode: () => () => {},
}))
vi.mock('./Validator', () => ({
  default: (props) => { validatorProps.current = props; return null },
}))
vi.mock('./petKnowledge.js', () => ({ clearPetKnowledgeCache: () => { petClears.count++ } }))
vi.mock('../../permissions', () => ({
  usePermissions: () => ({ ready: true, role: 'member', userId: 'u-me', workspaceId: 'w-1' }),
}))
vi.mock('../../agent', () => ({ useAgent: () => null }))
vi.mock('@monaco-editor/react', () => ({ default: () => null }))
vi.mock('../../cloud/aiProxy', () => ({ callAI: vi.fn(), isRetryableAIError: () => false }))
vi.mock('../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: () => Promise.resolve({}),
  saveOtterSettings: () => Promise.resolve({}),
}))
vi.mock('../../lib/userState', () => ({ pushSettingsToCloud: () => Promise.resolve() }))

const { default: Otter } = await import('./Otter.jsx')
const { default: RealValidator } = await vi.importActual('./Validator.jsx')

beforeEach(() => { world = freshWorld(); validatorProps.current = null; petClears.count = 0 })
afterEach(cleanup)

const rows = () => [...document.querySelectorAll('.otter-subject-row')]

/** Mount, open the host course in Sidebar 1, and return its subject rows. */
async function openHost({ expectLinked = true } = {}) {
  render(createElement(Otter, { currentPage: 'otter', onNavigate: () => {}, onContextChange: () => {} }))
  // Sidebar 1's row (the library's card names the course too).
  const courseBtn = await waitFor(() => {
    const b = document.querySelector('.otter-course-open')
    if (!b) throw new Error('the course row has not loaded')
    return b
  })
  expect(courseBtn.textContent).toContain('My Blender')
  fireEvent.click(courseBtn)
  const ownRow = await waitFor(() => {
    const r = rows().find(x => x.textContent.includes('Modifiers of mine'))
    if (!r) throw new Error('the own row has not drawn')
    return r
  })
  if (!expectLinked) return { ownRow }
  // The linked row: the one subject row carrying the chain glyph (the course
  // view's card carries the same hint on its Linked badge).
  const linkedRow = await waitFor(() => {
    const r = rows().find(x => x.querySelector('.otter-subject-link'))
    if (!r) throw new Error('the linked row has not drawn')
    return r
  })
  const linkedBtn = linkedRow.querySelector('.otter-subject-open')
  expect(linkedBtn.getAttribute('title')).toBe("Linked from Audrey's Blender 5.0 · read only")
  expect(linkedRow.querySelector('.otter-subject-delete'), 'no delete control on a linked row').toBeNull()
  return { linkedRow, ownRow, linkedBtn }
}

const progressWrites = () => world.writes.filter(w => w.url === '/api/software/host-1/progress').map(w => w.body)

describe('the progression key (design §5.5)', () => {
  it('linkKey is the one definition, and no slug can collide with it', () => {
    expect(linkKey('sub-L')).toBe('link:sub-L')
    expect(isLinkKey('link:sub-L')).toBe(true)
    expect(isLinkKey('modifiers')).toBe(false)
    expect(isLinkKey('link:')).toBe(false)
    expect(activeSubjectKeyOf({ subjectId: 'sub-L' }, 'modifiers')).toBe('link:sub-L')
    expect(activeSubjectKeyOf(null, 'modifiers')).toBe('modifiers')
  })

  it('a linked subject\'s tick is written under link:<subject_id> on the HOST course\'s row, never under its slug', async () => {
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    fireEvent.click(screen.getByRole('button', { name: /Mark complete/ }))
    await waitFor(() => expect(progressWrites().length).toBe(1))
    const [written] = progressWrites()
    expect(written.subjects[linkKey('sub-L')].completed_lessons).toEqual(['lesson_1_1'])
    // The host's own `modifiers` has the same lesson id: a slug key would tick it.
    expect(written.subjects.modifiers).toBeUndefined()
    expect(Object.keys(written.subjects)).toEqual([linkKey('sub-L')])
  })

  it('the active row is matched by KEY: the host\'s own `modifiers` does not light up', async () => {
    const { linkedRow, ownRow, linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    await waitFor(() => expect(linkedRow.getAttribute('data-active')).toBe('true'))
    expect(ownRow.getAttribute('data-active')).toBeNull()
    // And the other way round: the own subject open, the link unlit.
    fireEvent.click(ownRow.querySelector('.otter-subject-open'))
    await screen.findByRole('heading', { name: 'Own lesson' })
    await waitFor(() => expect(ownRow.getAttribute('data-active')).toBe('true'))
    expect(linkedRow.getAttribute('data-active')).toBeNull()
  })
})

describe('no linked body in any session cache (design §5.4)', () => {
  it('opening a linked subject reads it BY ID and writes it to neither cache the Validator enumerates', async () => {
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    expect(world.reads).toContain('/api/otter/subjects/sub-L')
    const { softwareCacheRef, subjectCacheRef } = validatorProps.current
    // The own subject IS cached (the probe holds the same objects Otter writes).
    await waitFor(() => expect(JSON.stringify(subjectCacheRef.current)).toContain('OWN-BODY'))
    expect(JSON.stringify(subjectCacheRef.current)).not.toContain('LINKED-BODY-MARKER')
    expect(JSON.stringify(softwareCacheRef.current)).not.toContain('LINKED-BODY-MARKER')
    expect(JSON.stringify(softwareCacheRef.current)).not.toContain('sub-L')
    // The host course's own subject list in the cache is the own list only.
    expect(softwareCacheRef.current['host-1'].subjects.map(s => s.slug)).toEqual(['modifiers'])
  })

  it('the REAL Validator, drawn over those very caches, counts the own lesson and not the linked one', async () => {
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    const handed = validatorProps.current
    // Its props are the two caches and the list: the share index never reaches it.
    expect(Object.keys(handed).sort()).toEqual(['activeSoftwareSlug', 'softwareCacheRef', 'softwareList', 'subjectCacheRef'])
    await waitFor(() => expect(JSON.stringify(handed.subjectCacheRef.current)).toContain('OWN-BODY'))
    cleanup()
    render(createElement(RealValidator, {
      softwareList: handed.softwareList, activeSoftwareSlug: 'host-1',
      softwareCacheRef: handed.softwareCacheRef, subjectCacheRef: handed.subjectCacheRef,
    }))
    expect(await screen.findByRole('button', { name: /Validate all \(1\)/ })).toBeTruthy()
  })

  it('opening it twice reads it twice: live, as of each open', async () => {
    const { linkedBtn, ownRow } = await openHost()
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    fireEvent.click(ownRow.querySelector('.otter-subject-open'))
    await screen.findByRole('heading', { name: 'Own lesson' })
    fireEvent.click(linkedBtn)
    await screen.findByRole('heading', { name: 'Linked lesson' })
    expect(world.reads.filter(u => u === '/api/otter/subjects/sub-L').length).toBe(2)
  })
})

describe('a 404 on open (design §5.4)', () => {
  it('revoked: the list is re-read AFTER the 404, the words are the index\'s, the row leaves, the pet is cleared', async () => {
    world.linked = null
    world.sharesAfter404 = [{ ...LINK, status: 'revoked', state: 'revoked', ended_by: 'u-audrey', host_course_id: null, host_live: null }]
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    expect(await screen.findByText('«Modifiers» is no longer shared with you.')).toBeTruthy()
    const at404 = world.reads.indexOf('/api/otter/subjects/sub-L')
    expect(world.reads.slice(at404 + 1)).toContain('/api/otter/subject-shares')
    await waitFor(() => expect(rows().some(x => x.querySelector('.otter-subject-link'))).toBe(false))
    expect(petClears.count).toBeGreaterThan(0)
  })

  it('gone: the owner\'s words, and the row stays, greyed, with Remove; it does not open', async () => {
    world.linked = null
    world.sharesAfter404 = [{ ...LINK, state: 'gone' }]
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    expect(await screen.findByText('«Modifiers» is no longer available: the owner removed it. It comes back if they restore it.')).toBeTruthy()
    const row = await waitFor(() => {
      const r = rows().find(x => x.querySelector('.otter-subject-link'))
      if (r?.getAttribute('data-closed') !== 'true') throw new Error('not closed yet')
      return r
    })
    expect(row.querySelector('.otter-subject-open').disabled).toBe(true)
    expect(row.querySelector('.otter-subject-delete').getAttribute('title')).toBe('Remove from my course')
  })

  it('a state the functions could not have made reads as gone, and the row closes anyway', async () => {
    world.linked = null
    world.sharesAfter404 = [{ ...LINK }]   // still "accepted", yet the read is a 404
    const { linkedBtn } = await openHost()
    fireEvent.click(linkedBtn)
    expect(await screen.findByText(/is no longer available: the owner removed it/)).toBeTruthy()
    await waitFor(() => expect(rows().find(x => x.querySelector('.otter-subject-link')).getAttribute('data-closed')).toBe('true'))
  })
})

describe('the reminder fires from a save path (design §5.9)', () => {
  // The undo: delete the own subject, then Edit › Undo delete. In cloud mode
  // the undo is a NEW row with a new id, so Mara (who holds the course whole)
  // is asked about it.
  async function deleteThenUndo() {
    const { ownRow } = await openHost({ expectLinked: false })
    fireEvent.click(ownRow.querySelector('.otter-subject-delete'))
    // The confirm's own button (the row and the card carry a "Delete subject" glyph too).
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete subject' }))
    await waitFor(() => expect(world.writes.some(w => w.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(rows().some(x => x.textContent.includes('Modifiers of mine'))).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Undo delete/ }))
    await waitFor(() => expect(world.writes.filter(w => w.method === 'POST' && w.url === '/api/software/host-1/subjects').length).toBe(1))
  }

  it('in cloud mode: the new subject, mapped to its NEW id, offered to the batch receivers; Share makes a single row', async () => {
    world.shares = [BATCH_ROW]
    await deleteThenUndo()
    expect(await screen.findByRole('dialog', { name: 'Share the new subject too?' })).toBeTruthy()
    expect(screen.getByText('You shared «My Blender» whole with Mara. New subjects are not shared with them unless you say so.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(world.writes.some(w => w.url === '/api/otter/subject-shares')).toBe(true))
    const made = world.writes.filter(w => w.url === '/api/otter/subject-shares')
    expect(made).toEqual([{ method: 'POST', url: '/api/otter/subject-shares', body: { subject_id: 'own-2', shared_with: 'u-mara', message: null } }])
  })

  it('nothing when the course has no batch row: the index is read, no dialog', async () => {
    world.shares = []
    await deleteThenUndo()
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: /Share the new subject/ })).toBeNull()
  })

  it('never outside cloud mode: no share-list read, no dialog', async () => {
    world.cloud = false
    world.shares = [BATCH_ROW]
    await deleteThenUndo()
    await new Promise(r => setTimeout(r, 50))
    expect(world.reads).not.toContain('/api/otter/subject-shares')
    expect(screen.queryByRole('dialog', { name: /Share the new subject/ })).toBeNull()
  })
})

// ── the source half: every reader of a linked body, and what it writes ──────
// Read from the app's root, as FunctionCard.test.jsx does: under jsdom
// import.meta.url is not a file URL.
const OTTER_SRC = readFileSync('src/tools/otter_v0.3.1/Otter.jsx', 'utf8').replace(/\r\n/g, '\n')

/** Body of a `const <name> = useCallback(` declaration, by balanced parens. */
function callbackBody(source, name) {
  const start = source.indexOf(`const ${name} = useCallback(`)
  if (start === -1) return null
  let i = source.indexOf('(', start + `const ${name} = useCallback`.length)
  let depth = 1
  const from = ++i
  while (i < source.length && depth > 0) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') depth--
    i++
  }
  return source.slice(from, i - 1)
}

/** What a reader of a linked body may not do: write a session cache. */
const CACHE_WRITE = /(subjectCacheRef|softwareCacheRef)\.current(\[[^\]]+\])*(\.\w+)?\s*=(?!=)|setQuizSelectionData\(/

describe('the readers of a linked body, by source', () => {
  // The two readers the design names (§5.4): the study view's open and the
  // quiz's content string. Every place that reads `/api/otter/subjects/` is
  // one of them.
  const readers = ['openLinkedSubject', 'getQuizContent']

  it('every by-id read sits in a named reader', () => {
    const sites = OTTER_SRC.split('\n').filter(l => l.includes('/api/otter/subjects/'))
    expect(sites.length, 'the by-id reads were found').toBe(2)
    for (const name of readers) expect(callbackBody(OTTER_SRC, name), name).toContain('/api/otter/subjects/')
  })

  it('neither reader writes subjectCacheRef, softwareCacheRef or quizSelectionData', () => {
    expect(callbackBody(OTTER_SRC, 'openLinkedSubject')).not.toMatch(CACHE_WRITE)
    // getQuizContent caches OWN subjects (the pre-B2 path); the linked loop,
    // from its first line to the function's end, writes nothing.
    const quiz = callbackBody(OTTER_SRC, 'getQuizContent')
    const linkedPart = quiz.slice(quiz.indexOf('linkedRowsForHost('))
    expect(linkedPart.length).toBeGreaterThan(100)
    expect(linkedPart).not.toMatch(CACHE_WRITE)
  })

  it('CONTROL: the scan fires on each cache write it forbids', () => {
    for (const planted of [
      'subjectCacheRef.current[key] = body',
      'subjectCacheRef.current[`${a}/${b}`] = out.data',
      'softwareCacheRef.current[slug].subjects = list',
      'setQuizSelectionData({ ...data })',
    ]) expect(planted).toMatch(CACHE_WRITE)
    expect('if (subjectCacheRef.current[key] === body) {}').not.toMatch(CACHE_WRITE)
  })
})
