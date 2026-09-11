// =============================================================================
// otterFixturesRoutes.test.js — otterFetch's fixtures handler answers every
// route the parser produces, in the wire shapes supabaseOtterAdapter.js
// documents, and refuses the workspace-only writes loudly.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { parseOtterRoute } from '../../tools/otter_v0.3.1/adapters/otterRoutes'
import { buildDevFixtures } from './install'
import { onDevWriteRefused } from '../devFixtures'
import { COURSE_ID } from './data/otter'

const call = (fx, path, method = 'GET', body) => fx.otter.handle(parseOtterRoute(path, method), body)

describe('reads', () => {
  it('course.list is one course on the Express wire, with subject_count and the cloud flags', () => {
    const fx = buildDevFixtures()
    const { status, body } = call(fx, '/api/software')
    expect(status).toBe(200)
    expect(body.length).toBe(1)
    expect(body[0]).toMatchObject({ slug: COURSE_ID, name: 'DaVinci Resolve 19', type: 'software', subject_count: 4, visibility: 'company_standard', can_read_content: true })
    expect(typeof body[0].owner_label).toBe('string')
  })

  it('subject.list is ordered and thin; subject.get carries sections and lessons; unknown is 404', () => {
    const fx = buildDevFixtures()
    const list = call(fx, `/api/software/${COURSE_ID}/subjects`).body
    expect(list.map((s) => s.subject_order)).toEqual([0, 1, 2, 3])
    expect(list[0]).not.toHaveProperty('sections')
    const full = call(fx, `/api/software/${COURSE_ID}/subjects/${list[0].slug}`).body
    expect(full.software_slug).toBe(COURSE_ID)
    expect(full.sections[0].lessons[0].content.length).toBeGreaterThan(40)
    expect(call(fx, `/api/software/${COURSE_ID}/subjects/nope`).status).toBe(404)
    expect(call(fx, '/api/software/nope').status).toBe(404)
  })

  it('the five per-course documents come back in their empty-safe shapes', () => {
    const fx = buildDevFixtures()
    expect(call(fx, `/api/software/${COURSE_ID}/hotkeys`).body.categories.length).toBeGreaterThan(0)
    expect(call(fx, `/api/software/${COURSE_ID}/functions`).body.categories.length).toBeGreaterThan(0)
    expect(call(fx, `/api/software/${COURSE_ID}/nodes`).body).toEqual({ systems: [] })
    expect(call(fx, `/api/software/${COURSE_ID}/references`).body.urls.length).toBe(2)
    expect(call(fx, `/api/software/${COURSE_ID}/corrections`).body).toEqual({ corrections: [] })
  })

  it('progress.get nests per subject; quiz.list wraps attempts newest first', () => {
    const fx = buildDevFixtures()
    const p = call(fx, `/api/software/${COURSE_ID}/progress`).body
    expect(p.completed_lessons).toEqual([])
    expect(p.subjects['project-setup-and-media'].completed_lessons.length).toBe(5)
    const q = call(fx, '/api/otter/quiz-history').body
    expect(q.attempts.length).toBe(2)
    expect(q.attempts[0].taken_at > q.attempts[1].taken_at).toBe(true)
  })

  it('the workspace-only lists are honest empties, not errors', () => {
    const fx = buildDevFixtures()
    for (const path of ['/api/otter/trash', '/api/otter/change-requests', '/api/otter/nominations', `/api/otter/courses/${COURSE_ID}/editors`]) {
      const { status, body } = call(fx, path)
      expect(status, path).toBe(200)
      expect(body, path).toEqual([])
    }
  })

  it('export.all bundles the course the way the cloud does', () => {
    const fx = buildDevFixtures()
    const { body } = call(fx, '/api/export-all')
    expect(body.version).toBe('2.0')
    expect(body.software.length).toBe(1)
    expect(body.software[0].subjects.length).toBe(4)
    expect(body.quiz_history.length).toBe(2)
  })

  it('an unparsed op is 501, and reads are clones', () => {
    const fx = buildDevFixtures()
    expect(fx.otter.handle({ op: 'nope' }).status).toBe(501)
    const a = call(fx, `/api/software/${COURSE_ID}/hotkeys`).body
    a.categories.push({ category: 'scribble' })
    expect(call(fx, `/api/software/${COURSE_ID}/hotkeys`).body.categories.some((c) => c.category === 'scribble')).toBe(false)
  })
})

describe('writes', () => {
  it('course create / update / delete and subject save / delete mutate for the session', () => {
    const fx = buildDevFixtures()
    const created = call(fx, '/api/software', 'POST', { name: 'Nuke 15', type: 'node_software', skill_level: 'advanced' }).body
    expect(created.name).toBe('Nuke 15')
    expect(call(fx, '/api/software').body.length).toBe(2)
    expect(call(fx, `/api/software/${created.slug}`, 'PATCH', { name: 'Nuke 16' }).body.name).toBe('Nuke 16')
    const sub = call(fx, `/api/software/${created.slug}/subjects`, 'POST', { title: 'Roto basics', sections: [{ id: 's1', title: 'Roto', lessons: [{ id: 'l1', title: 'Shapes', content: 'Draw a shape.' }] }] }).body
    expect(sub.slug).toBe('roto-basics')
    expect(call(fx, `/api/software/${created.slug}/subjects`).body.length).toBe(1)
    expect(call(fx, `/api/software/${created.slug}/subjects/roto-basics`, 'PUT', { description: 'edited' }).body.description).toBe('edited')
    expect(call(fx, `/api/software/${created.slug}/subjects/roto-basics`, 'DELETE').status).toBe(200)
    expect(call(fx, `/api/software/${created.slug}/subjects`).body.length).toBe(0)
    expect(call(fx, `/api/software/${created.slug}`, 'DELETE').status).toBe(200)
    expect(call(fx, '/api/software').body.length).toBe(1)
  })

  it('doc.merge merges the way the Express server did; doc.put replaces', () => {
    const fx = buildDevFixtures()
    const before = call(fx, `/api/software/${COURSE_ID}/hotkeys`).body.categories.length
    const merged = call(fx, `/api/software/${COURSE_ID}/hotkeys/merge`, 'POST', [{ category: 'Fusion', shortcuts: [{ action: 'Add node', keys: 'Shift+Space' }] }]).body
    expect(merged.categories.length).toBe(before + 1)
    const put = call(fx, `/api/software/${COURSE_ID}/references`, 'POST', { urls: [] }).body
    expect(put).toEqual({ urls: [] })
  })

  it('progress.put and quiz.add land', () => {
    const fx = buildDevFixtures()
    const p = call(fx, `/api/software/${COURSE_ID}/progress`, 'POST', { subject_slug: 'colour-fundamentals', completed_lessons: ['lesson_1_1'] }).body
    expect(p.subjects['colour-fundamentals'].completed_lessons).toEqual(['lesson_1_1'])
    const q = call(fx, '/api/otter/quiz-history', 'POST', { score: 5, total: 5, courses: ['DaVinci Resolve 19'], question_types: ['hotkeys'] }).body
    expect(q.score).toBe(5)
    expect(call(fx, '/api/otter/quiz-history').body.attempts.length).toBe(3)
  })

  it('the workspace-only writes are refused: 501, a message, and the toast event', () => {
    const fx = buildDevFixtures()
    const seen = []
    const off = onDevWriteRefused((m) => seen.push(m))
    const refused = [
      [`/api/otter/courses/${COURSE_ID}/fork`, 'POST'],
      [`/api/otter/courses/${COURSE_ID}/editors`, 'POST'],
      ['/api/otter/change-requests', 'POST'],
      ['/api/otter/nominations', 'POST'],
      ['/api/otter/trash/restore', 'POST'],
    ]
    for (const [path, method] of refused) {
      const { status, body } = call(fx, path, method, {})
      expect(status, path).toBe(501)
      expect(body.error, path).toMatch(/^Dev fixtures: .* is not available on fixture data\.$/)
    }
    off()
    expect(seen.length).toBe(refused.length)
  })
})
