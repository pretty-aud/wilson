/** @vitest-environment jsdom */
// =============================================================================
// NewSubjectShareReminder.test.jsx — B2 (2026-10-27), design §5.9.
//
// The dialog: its words verbatim, the people as checkboxes all ticked, and
// Share making ORDINARY single rows — share.create once per (subject, person),
// in order, no batch id, stopping at the first refusal with its sentence in
// the footer — and Not now writing nothing.
//
// The helper's six hooks, by source (the undo path is also driven end to end
// in linkedProgress.test.js): offerNewSubjectsToBatchReceivers is called once
// at the end of each of the six subject-saving paths of Otter.jsx (twice in
// the import: once per course in the export branch, once in the lesson
// branch), AFTER the path's last subject.save, NOT awaited (the paths end
// six ways and it waits on none of them), with what the course held BEFORE
// the run (the stub loops' existingSubs; one subject.list elsewhere).
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'

vi.mock('../adapters', () => ({ otterFetch: () => { throw new Error('the default otterFetch was reached') } }))
const { default: NewSubjectShareReminder } = await import('./NewSubjectShareReminder.jsx')

afterEach(cleanup)

const PLAN = {
  courseId: 'c-1',
  courseName: 'Blender 5.0',
  people: [{ userId: 'u-mara', label: 'Mara' }, { userId: 'u-ben', label: 'Ben' }],
  subjects: [{ id: 's-a', slug: 'a', title: 'Alpha' }, { id: 's-b', slug: 'b', title: 'Beta' }],
  held: new Set(['s-b|u-ben']),
}

function backend(refuse = {}) {
  const posts = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    posts.push({ url, body })
    const r = refuse[`${body.subject_id}|${body.shared_with}`]
    const reply = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) })
    return r ? reply(409, { error: r }) : reply(200, { id: 'x' })
  }
  return { posts, fetchImpl }
}

describe('the reminder dialog (design §5.9)', () => {
  it('its words verbatim; the people ticked; the new subjects named', () => {
    render(<NewSubjectShareReminder plan={PLAN} fetchImpl={backend().fetchImpl} />)
    expect(screen.getByRole('dialog', { name: 'Share the 2 new subjects too?' })).toBeTruthy()
    expect(screen.getByText('You shared «Blender 5.0» whole with Mara and Ben. New subjects are not shared with them unless you say so.')).toBeTruthy()
    expect(screen.getByLabelText('Mara').checked).toBe(true)
    expect(screen.getByLabelText('Ben').checked).toBe(true)
    expect(screen.getByText('New in this course: «Alpha» and «Beta».')).toBeTruthy()
  })

  it('Share: one share.create per (subject, person), in order, single rows, a pair already held skipped', async () => {
    const b = backend()
    const onDone = vi.fn()
    const onShared = vi.fn()
    render(<NewSubjectShareReminder plan={PLAN} fetchImpl={b.fetchImpl} onDone={onDone} onShared={onShared} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(b.posts).toEqual([
      { url: '/api/otter/subject-shares', body: { subject_id: 's-a', shared_with: 'u-mara', message: null } },
      { url: '/api/otter/subject-shares', body: { subject_id: 's-a', shared_with: 'u-ben', message: null } },
      { url: '/api/otter/subject-shares', body: { subject_id: 's-b', shared_with: 'u-mara', message: null } },
    ])
    for (const p of b.posts) expect(p.body).not.toHaveProperty('batch_id')
    expect(onShared).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith('Shared with Mara and Ben. It is waiting for them to accept.')
  })

  it('stops at the first refusal with its sentence; a second press does not repeat what was made', async () => {
    const b = backend({ 's-a|u-ben': 'that person is not an active member of this workspace' })
    const onDone = vi.fn()
    render(<NewSubjectShareReminder plan={PLAN} fetchImpl={b.fetchImpl} onDone={onDone} onShared={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Ben, «Alpha»: that person is not an active member of this workspace.')).toBeTruthy()
    expect(b.posts.map(p => `${p.body.subject_id}>${p.body.shared_with}`)).toEqual(['s-a>u-mara', 's-a>u-ben'])
    expect(onDone).not.toHaveBeenCalled()
    // Untick Ben and press again: only what is left for Mara.
    fireEvent.click(screen.getByLabelText('Ben'))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(b.posts.map(p => `${p.body.subject_id}>${p.body.shared_with}`)).toEqual(['s-a>u-mara', 's-a>u-ben', 's-b>u-mara'])
  })

  it('Not now writes nothing', () => {
    const b = backend()
    const onClose = vi.fn()
    render(<NewSubjectShareReminder plan={PLAN} fetchImpl={b.fetchImpl} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalled()
    expect(b.posts).toEqual([])
  })
})

// ── the six hooks in Otter.jsx, by source ────────────────────────────────────
// Read from the app's root: under jsdom import.meta.url is not a file URL.
const OTTER = readFileSync('src/tools/otter_v0.3.1/Otter.jsx', 'utf8').replace(/\r\n/g, '\n')

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

const CALL = 'offerNewSubjectsToBatchReceivers('
/** Every subject.save in a body: a POST to `/api/software/<slug>/subjects` (not /renumber). */
const SAVE = /otterFetch\(`\/api\/software\/\$\{[^}]+\}\/subjects`, \{/g

/** The rule for one path, as findings (empty when it holds). */
function judge(body, { calls = 1, before }) {
  const found = []
  const at = [...body.matchAll(new RegExp(CALL.replace('(', '\\('), 'g'))].map(m => m.index)
  if (at.length !== calls) found.push(`called ${at.length} times, not ${calls}`)
  const saves = [...body.matchAll(SAVE)].map(m => m.index)
  if (!saves.length) found.push('no subject.save found')
  const lastCall = Math.max(...at)
  if (saves.length && lastCall < Math.max(...saves)) found.push('a subject.save follows the last call')
  for (const i of at) {
    if (/await\s+$/.test(body.slice(Math.max(0, i - 12), i))) found.push('the call is awaited')
  }
  if (before && !before.test(body)) found.push(`the slugs held before are not read (${before})`)
  return found
}

const PATHS = {
  generateCourse:             { before: /slugsBefore = existingSubs\.map\(s => s\.slug\)/ },
  agentGenerateCourse:        { before: /slugsBefore = existingSubs\.map\(s => s\.slug\)/ },
  generateSingleSubject:      { before: /const slugsBefore = await slugsHeldBy\(activeSoftwareSlug\)/ },
  agentGenerateSingleSubject: { before: /const slugsBefore = await slugsHeldBy\(swSlug\)/ },
  handleImportFile:           { calls: 2, before: /const slugsBefore = await slugsHeldBy\(slug\)/ },
  undoDeleteSubject:          { before: /const slugsBefore = await slugsHeldBy\(last\.softwareSlug\)/ },
}

describe('the helper hangs from all six subject-saving paths (design §5.9)', () => {
  for (const [name, rule] of Object.entries(PATHS)) {
    it(`${name}: once, after its last save, not awaited, with what the course held before`, () => {
      const body = callbackBody(OTTER, name)
      expect(body, `${name} was found`).toBeTruthy()
      expect(judge(body, rule)).toEqual([])
    })
  }

  it('the before-read comes BEFORE the first save in the paths that make one', () => {
    for (const name of ['generateSingleSubject', 'agentGenerateSingleSubject', 'undoDeleteSubject']) {
      const body = callbackBody(OTTER, name)
      expect(body.indexOf('await slugsHeldBy('), name).toBeLessThan(body.search(SAVE))
    }
  })

  it('the import calls it once per course INSIDE the export loop, with that course\'s slugs', () => {
    const body = callbackBody(OTTER, 'handleImportFile')
    const loop = body.indexOf('for (const sw of data.software)')
    const call = body.indexOf('offerNewSubjectsToBatchReceivers(slug, slugsBefore, savedSlugs)')
    const leave = body.indexOf('invalidateCache();')
    expect(loop).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(loop)
    expect(call).toBeLessThan(leave)
  })

  it('a stub loop passes null before a NEW course (no batch row can exist), and the helper stops on it', () => {
    const helper = callbackBody(OTTER, 'offerNewSubjectsToBatchReceivers')
    expect(helper).toMatch(/if \(!cloudModeRef\.current \|\| !courseSlug \|\| !Array\.isArray\(slugsBefore\)\) return;/)
    for (const name of ['generateCourse', 'agentGenerateCourse']) {
      expect(callbackBody(OTTER, name)).toMatch(/let slugsBefore = null;/)
    }
  })

  it('CONTROL: the judge fires on an awaited call, a call before the last save, a missing call and a missing before-read', () => {
    const body = callbackBody(OTTER, 'undoDeleteSubject')
    const rule = PATHS.undoDeleteSubject
    expect(judge(body.replace(CALL, `await ${CALL}`), rule)).toContain('the call is awaited')
    const moved = body.replace(/\n\s*offerNewSubjectsToBatchReceivers\([^\n]*\n/, '\n')
      .replace('const slugsBefore = await slugsHeldBy(last.softwareSlug);', 'const slugsBefore = await slugsHeldBy(last.softwareSlug); offerNewSubjectsToBatchReceivers(last.softwareSlug, slugsBefore, []);')
    expect(judge(moved, rule)).toContain('a subject.save follows the last call')
    expect(judge(body.replace(CALL, 'noop('), rule)).toContain('called 0 times, not 1')
    expect(judge(body.replace('const slugsBefore = await slugsHeldBy(last.softwareSlug)', 'const slugsBefore = []'), rule).join()).toMatch(/not read/)
  })
})
