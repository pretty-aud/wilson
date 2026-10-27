// =============================================================================
// subjectShares.test.js — B1 (2026-10-27): the adapter's seven subject-share
// operations (migration 0100, docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §5.1)
// against a recording fake of supabase-js. What has to be true and is not
// visible from the diff:
//
//   * the index wire is the function's rows AS RETURNED — the six columns her
//     ruling of 2026-10-27 added among them — and carries no derived key;
//   * every refusal a function raises is passed through VERBATIM (it is
//     written for a person), and a bare 23505 becomes the function's own
//     "already shared" sentence;
//   * a hidden subject is a 404 ON THE WIRE, never an empty 200: the client
//     acts on that status (§5.4), and otterFetch resolves for every status;
//   * the subject wires carry the row's `id` (until B1 neither did, so the
//     owner's client had nothing to share with);
//   * export.all carries each course's linked subjects, saying where each is
//     from, and a link that ended between the index read and the body read is
//     skipped, not invented.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
let rpcAnswers = {}     // fn -> { data, error }
let tables = {}         // table -> rows (read by from().select().eq()…)
let sessionToReturn = null

function signedInSession(workspaceId = 'ws-1') {
  const payload = btoa(JSON.stringify({ app_metadata: { workspace_id: workspaceId } }))
  return { access_token: 'header.' + payload + '.signature' }
}

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me' } } }),
      getSession: async () => ({ data: { session: sessionToReturn } }),
    },
    from(table) {
      const api = {
        __sel: null, __filters: {},
        select(cols) { api.__sel = cols; return api },
        eq(col, val) { api.__filters[col] = val; return api },
        order() { return api },
        limit() { return api },
        __rows() {
          return (tables[table] || []).filter(r =>
            Object.entries(api.__filters).every(([k, v]) => r[k] === v))
        },
        async maybeSingle() {
          calls.push({ kind: 'read', table, cols: api.__sel, filters: { ...api.__filters } })
          return { data: api.__rows()[0] ?? null, error: null }
        },
        // A list read is awaited directly: the builder is a thenable.
        then(resolve, reject) {
          calls.push({ kind: 'list', table, cols: api.__sel, filters: { ...api.__filters } })
          return Promise.resolve({ data: api.__rows(), error: null }).then(resolve, reject)
        },
      }
      return api
    },
    async rpc(fn, args) {
      calls.push({ kind: 'rpc', fn, args })
      return rpcAnswers[fn] ?? { data: null, error: null }
    },
  },
}))

vi.mock('../../../dev/devFixtures.js', () => ({ devFixtures: () => null }))

const { supabaseOtterAdapter, OtterCloudError } = await import('./supabaseOtterAdapter.js')
const { otterFetch } = await import('./index.js')

/** A row of otter_subject_shares_index() as the function returns it (0100 §11). */
function indexRow(over = {}) {
  return {
    id: 'sh-1', subject_id: 'sub-1', subject_title: 'Modifiers', subject_is_stub: false,
    course_id: null, course_name: 'Blender 5.0', course_slug: null, course_type: null, skill_level: null,
    shared_by: 'owner-1', sharer_label: 'User C', shared_with: 'me', receiver_label: 'User D',
    subject_owner_id: 'owner-1', owner_label: 'User C', batch_id: null, via_share_id: null, chain_depth: 1,
    status: 'pending', state: 'pending', message: null, host_course_id: null, host_live: false,
    created_at: '2026-10-27T00:00:00Z', responded_at: null, ended_by: null, is_mine: false, is_owner: false,
    ...over,
  }
}

const subjectRow = {
  id: 'sub-1', slug: 'modifiers', title: 'Modifiers', description: 'd', skill_level: 'beginner',
  is_stub: false, subject_order: 1, estimated_hours: 2, sections: [{ id: 's1', lessons: [] }],
  section_outlines: [], sources: [], prerequisites: [], created_at: 't0', updated_at: 't1',
  course_id: 'course-owner',
}

beforeEach(() => {
  calls.length = 0
  rpcAnswers = {}
  tables = {}
  sessionToReturn = signedInSession()
})

describe('share.list — the index wire', () => {
  it('returns the rows exactly as the function returns them, the six new columns among them', async () => {
    const row = indexRow({ batch_id: 'batch-1', via_share_id: 'sh-0', chain_depth: 2, is_owner: false })
    rpcAnswers.otter_subject_shares_index = { data: [row], error: null }
    const out = await supabaseOtterAdapter['share.list']()
    expect(calls).toEqual([{ kind: 'rpc', fn: 'otter_subject_shares_index', args: undefined }])
    expect(out).toEqual([row])
    for (const col of ['subject_owner_id', 'owner_label', 'batch_id', 'via_share_id', 'chain_depth', 'is_owner']) {
      expect(out[0], col).toHaveProperty(col)
    }
    // No derived key on the wire: the client makes it with linkKey(), the one definition.
    expect(Object.keys(out[0]).filter(k => /key/i.test(k))).toEqual([])
  })

  it('an empty index is an empty list, not null', async () => {
    rpcAnswers.otter_subject_shares_index = { data: null, error: null }
    expect(await supabaseOtterAdapter['share.list']()).toEqual([])
  })

  it("the function's own refusal (not a member) is passed through", async () => {
    rpcAnswers.otter_subject_shares_index = { data: null, error: { code: 'P0001', message: 'not_a_workspace_member' } }
    await expect(supabaseOtterAdapter['share.list']()).rejects.toMatchObject({ message: 'not_a_workspace_member' })
  })
})

describe('share.create — one subject to one person (and passing it on)', () => {
  it('calls otter_subject_share with the subject, the person and the note, and answers {id}', async () => {
    rpcAnswers.otter_subject_share = { data: 'sh-9', error: null }
    const out = await supabaseOtterAdapter['share.create']({ body: { subject_id: 'sub-1', shared_with: 'd', message: 'Have a look' } })
    expect(calls).toEqual([{ kind: 'rpc', fn: 'otter_subject_share',
      args: { p_subject_id: 'sub-1', p_shared_with: 'd', p_message: 'Have a look' } }])
    expect(out).toEqual({ id: 'sh-9' })
  })

  it('sends a null note when none was given', async () => {
    rpcAnswers.otter_subject_share = { data: 'sh-9', error: null }
    await supabaseOtterAdapter['share.create']({ body: { subject_id: 'sub-1', shared_with: 'd' } })
    expect(calls[0].args.p_message).toBeNull()
  })

  it("🚨 a bare 23505 (the live unique index, two offers racing) becomes the function's own sentence", async () => {
    rpcAnswers.otter_subject_share = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "otter_subject_share_live_uidx"' } }
    await expect(supabaseOtterAdapter['share.create']({ body: { subject_id: 'sub-1', shared_with: 'd' } }))
      .rejects.toMatchObject({ message: 'this subject is already shared with that person', status: 409 })
  })

  it('every refusal the function raises is passed through verbatim, as 409', async () => {
    for (const sentence of [
      'only the owner of a course, or someone who accepted a share of this subject, may share it',
      'that is their own subject',
      'this subject has been passed on as far as it can go',
      'this subject is no longer shared with you',
      'that person is not an active member of this workspace',
    ]) {
      rpcAnswers.otter_subject_share = { data: null, error: { code: 'P0001', message: sentence } }
      await expect(supabaseOtterAdapter['share.create']({ body: { subject_id: 'sub-1', shared_with: 'd' } }), sentence)
        .rejects.toMatchObject({ message: sentence, status: 409 })
    }
  })

  it('refuses a body without a subject or a person before calling anything', async () => {
    await expect(supabaseOtterAdapter['share.create']({ body: { shared_with: 'd' } })).rejects.toMatchObject({ status: 400 })
    await expect(supabaseOtterAdapter['share.create']({ body: { subject_id: 'sub-1' } })).rejects.toMatchObject({ status: 400 })
    expect(calls).toEqual([])
  })
})

describe('share.createCourse — a whole course as a batch', () => {
  it('calls otter_subject_share_course and answers {batch_id}', async () => {
    rpcAnswers.otter_subject_share_course = { data: 'batch-1', error: null }
    const out = await supabaseOtterAdapter['share.createCourse']({ body: { course_id: 'course-1', shared_with: 'e', message: null } })
    expect(calls).toEqual([{ kind: 'rpc', fn: 'otter_subject_share_course',
      args: { p_course_id: 'course-1', p_shared_with: 'e', p_message: null } }])
    expect(out).toEqual({ batch_id: 'batch-1' })
  })

  it('passes the batch refusals through verbatim', async () => {
    for (const sentence of [
      'only the owner of a course may share it whole',
      'this course has no subjects',
      'every subject of this course is already shared with that person',
    ]) {
      rpcAnswers.otter_subject_share_course = { data: null, error: { code: 'P0001', message: sentence } }
      await expect(supabaseOtterAdapter['share.createCourse']({ body: { course_id: 'course-1', shared_with: 'e' } }), sentence)
        .rejects.toMatchObject({ message: sentence, status: 409 })
    }
  })

  it('refuses a body without a course or a person', async () => {
    await expect(supabaseOtterAdapter['share.createCourse']({ body: { shared_with: 'e' } })).rejects.toMatchObject({ status: 400 })
    await expect(supabaseOtterAdapter['share.createCourse']({ body: { course_id: 'c' } })).rejects.toMatchObject({ status: 400 })
    expect(calls).toEqual([])
  })
})

describe('share.accept / decline / revoke', () => {
  it('accept answers the host course id the function returns', async () => {
    rpcAnswers.otter_subject_share_accept = { data: 'host-1', error: null }
    const out = await supabaseOtterAdapter['share.accept']({ id: 'sh-1' })
    expect(calls).toEqual([{ kind: 'rpc', fn: 'otter_subject_share_accept', args: { p_share_id: 'sh-1' } }])
    expect(out).toEqual({ host_course_id: 'host-1' })
  })

  it('accept passes the refusals through verbatim, and the owner-slug 23505 as a sentence', async () => {
    const sentence = 'this share is accepted — only a pending share can be accepted'
    rpcAnswers.otter_subject_share_accept = { data: null, error: { code: 'P0001', message: sentence } }
    await expect(supabaseOtterAdapter['share.accept']({ id: 'sh-1' })).rejects.toMatchObject({ message: sentence, status: 409 })
    rpcAnswers.otter_subject_share_accept = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "otter_courses_owner_slug_uidx"' } }
    await expect(supabaseOtterAdapter['share.accept']({ id: 'sh-1' })).rejects.toMatchObject({
      message: 'You already have a course with this name. Open it, then accept again.', status: 409 })
  })

  it('decline and revoke answer {ok: true} and pass refusals through', async () => {
    rpcAnswers.otter_subject_share_decline = { data: null, error: null }
    rpcAnswers.otter_subject_share_revoke = { data: null, error: null }
    expect(await supabaseOtterAdapter['share.decline']({ id: 'sh-1' })).toEqual({ ok: true })
    expect(await supabaseOtterAdapter['share.revoke']({ id: 'sh-1' })).toEqual({ ok: true })
    expect(calls.map(c => [c.fn, c.args])).toEqual([
      ['otter_subject_share_decline', { p_share_id: 'sh-1' }],
      ['otter_subject_share_revoke', { p_share_id: 'sh-1' }],
    ])
    const sentence = 'only the owner of the subject, the person who shared it, or the person it was shared with may end this share'
    rpcAnswers.otter_subject_share_revoke = { data: null, error: { code: 'P0001', message: sentence } }
    await expect(supabaseOtterAdapter['share.revoke']({ id: 'sh-1' })).rejects.toMatchObject({ message: sentence, status: 409 })
    const declined = 'this share is still waiting for your answer — decline it instead'
    rpcAnswers.otter_subject_share_decline = { data: null, error: { code: 'P0001', message: declined } }
    await expect(supabaseOtterAdapter['share.decline']({ id: 'sh-1' })).rejects.toMatchObject({ message: declined, status: 409 })
  })
})

describe('subject.getById — a linked subject, read by its row id', () => {
  it('selects the full columns PLUS course_id, by id, and answers the subject wire with id and linked', async () => {
    tables.otter_subjects = [subjectRow]
    const out = await supabaseOtterAdapter['subject.getById']({ id: 'sub-1' })
    expect(calls).toEqual([{ kind: 'read', table: 'otter_subjects',
      cols: expect.stringMatching(/\bsections\b.*\bcourse_id\b/s), filters: { id: 'sub-1' } }])
    expect(out).toMatchObject({
      id: 'sub-1', linked: true, slug: 'modifiers', title: 'Modifiers',
      software_slug: 'course-owner', sections: [{ id: 's1', lessons: [] }],
    })
  })

  it('🚨 no row is a 404, never an empty 200: RLS hid it (the link ended, or the subject is in the trash)', async () => {
    tables.otter_subjects = []
    await expect(supabaseOtterAdapter['subject.getById']({ id: 'sub-gone' }))
      .rejects.toMatchObject({ message: 'Not found', status: 404 })
    await expect(supabaseOtterAdapter['subject.getById']({ id: 'sub-gone' })).rejects.toBeInstanceOf(OtterCloudError)
  })

  it('through otterFetch the 404 is on the wire with a body a caller can read before ok', async () => {
    tables.otter_subjects = []
    const res = await otterFetch('/api/otter/subjects/sub-gone')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    tables.otter_subjects = [subjectRow]
    const ok = await otterFetch('/api/otter/subjects/sub-1')
    expect(ok.status).toBe(200)
    expect((await ok.json()).linked).toBe(true)
  })

  it('signed out, the route is 501 with a reason, never Express', async () => {
    sessionToReturn = null
    globalThis.window = { electronAPI: {} }
    try {
      const res = await otterFetch('/api/otter/subjects/sub-1')
      expect(res.status).toBe(501)
      expect((await res.json()).error).toMatch(/signed-in workspace/)
    } finally {
      delete globalThis.window
    }
  })
})

describe('the subject wires carry the row id (0100)', () => {
  it('subject.list', async () => {
    tables.otter_subjects = [{ ...subjectRow, course_id: 'course-1' }]
    const out = await supabaseOtterAdapter['subject.list']({ slug: 'course-1' })
    expect(out).toEqual([{ id: 'sub-1', slug: 'modifiers', title: 'Modifiers', description: 'd',
      skill_level: 'beginner', is_stub: false, subject_order: 1 }])
  })

  it('subject.get', async () => {
    tables.otter_subjects = [{ ...subjectRow, course_id: 'course-1' }]
    const out = await supabaseOtterAdapter['subject.get']({ slug: 'course-1', sub: 'modifiers' })
    expect(out.id).toBe('sub-1')
    expect(out.software_slug).toBe('course-1')
    expect(out.linked).toBeUndefined()
  })
})

describe('export.all carries the linked subjects', () => {
  function cloudWith(links) {
    rpcAnswers.otter_course_index = { data: [
      { id: 'host-1', name: 'My Blender', course_type: 'software', visibility: 'personal', can_read_content: true, subject_count: 0 },
      { id: 'other-1', name: 'Other', course_type: 'software', visibility: 'personal', can_read_content: true, subject_count: 0 },
    ], error: null }
    rpcAnswers.otter_subject_shares_index = { data: links, error: null }
    tables.otter_courses = [
      { id: 'host-1', name: 'My Blender', course_type: 'software', hotkeys: { categories: [] }, functions: { categories: [] }, nodes: { systems: [] } },
      { id: 'other-1', name: 'Other', course_type: 'software', hotkeys: { categories: [] }, functions: { categories: [] }, nodes: { systems: [] } },
    ]
    tables.otter_progress = []
    tables.otter_quiz_attempts = []
  }

  it('an accepted link lands under its host course, with where it is from; a 404 is skipped, not invented', async () => {
    cloudWith([
      indexRow({ id: 'sh-1', subject_id: 'sub-1', state: 'accepted', status: 'accepted', host_course_id: 'host-1', course_name: 'Blender 5.0', owner_label: 'User C' }),
      indexRow({ id: 'sh-2', subject_id: 'sub-missing', state: 'accepted', status: 'accepted', host_course_id: 'host-1' }),
      indexRow({ id: 'sh-3', subject_id: 'sub-3', state: 'pending', status: 'pending', host_course_id: null }),
      indexRow({ id: 'sh-4', subject_id: 'sub-4', state: 'revoked', status: 'revoked', host_course_id: 'host-1' }),
      indexRow({ id: 'sh-5', subject_id: 'sub-5', state: 'gone', status: 'accepted', host_course_id: 'host-1' }),
    ])
    tables.otter_subjects = [subjectRow]
    const out = await supabaseOtterAdapter['export.all']()
    expect(out.software.map(s => s.meta.slug)).toEqual(['host-1', 'other-1'])
    expect(out.software[0].linked_subjects).toEqual([
      expect.objectContaining({ id: 'sub-1', linked: true, title: 'Modifiers', software_slug: 'course-owner',
        linked_from: { course_name: 'Blender 5.0', owner_label: 'User C' } }),
    ])
    expect(out.software[1].linked_subjects).toEqual([])
    // one index read, and one body read per link that was live
    expect(calls.filter(c => c.kind === 'rpc' && c.fn === 'otter_subject_shares_index')).toHaveLength(1)
    expect(calls.filter(c => c.kind === 'read' && c.table === 'otter_subjects').map(c => c.filters.id)).toEqual(['sub-1', 'sub-missing'])
  })

  it('a course with no link carries an empty list, and the shape is otherwise the one it was', async () => {
    cloudWith([])
    const out = await supabaseOtterAdapter['export.all']()
    expect(out.version).toBe('2.0')
    for (const sw of out.software) {
      expect(sw.linked_subjects).toEqual([])
      expect(sw).toHaveProperty('subjects')
      expect(sw).toHaveProperty('progress')
    }
  })
})
