// =============================================================================
// loadProjectBundle.test.js — Session 17 (§6 #47).
//
// Milestones were silently dropped on every project load: both
// localServerAdapter.loadProject and googleDriveAdapter.loadProject return an
// EXPLICIT list of named keys, and neither named `milestones`. Because
// setActiveProject/reloadActiveProject do `setBundle({ ...EMPTY_BUNDLE,
// ...next })`, a key the adapter omits is not merely missing — it is RESET to
// the empty array. So every milestone a user created reverted to nothing on
// the next reload, project switch or realtime refetch.
//
// The single-key fix is one line per adapter. This file exists for the CLASS
// of bug rather than the instance: an explicit key list that must stay in
// step with a bundle shape defined in a different file is a standing trap,
// and nothing anywhere held the two together. The coverage probe below fails
// on the NEXT omission, not just this one.
//
// Honest limitation, in the projectAttachments.test.js tradition: the
// EXPECTED_KEYS list mirrors EMPTY_BUNDLE from state/RabbitProvider.jsx,
// which does not export it (importing the provider would pull React and a
// live Supabase client into a pure-module test). If EMPTY_BUNDLE gains a
// collection key and this list is not updated, these tests keep passing
// while the adapters regress. RabbitProvider carries a pointer back here.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { localServerAdapter } from './localServerAdapter'

// Mirror of EMPTY_BUNDLE's collection keys (RabbitProvider.jsx:76-97),
// minus `project` (an object, not a collection).
//
// `expenses` is deliberately ABSENT from this list even though EMPTY_BUNDLE
// has it: expenses are read through useExpenses -> adapter.listExpenses and
// never off bundle.expenses, so requiring it of loadProject would be dead
// weight. That exclusion is a decision, not an oversight.
const EXPECTED_KEYS = [
  'phases', 'assets', 'tasks', 'dependencies', 'taskLinks', 'files',
  'assetVersions', 'comments', 'ingestionRuns', 'teamAssignments',
  'managedFiles', 'budgetVersions', 'projectTeam',
  'scenes', 'shots', 'levels', 'experiences', 'milestones',
  // Session 26. `folders` is read straight off the bundle (ctx.folders), so
  // unlike `expenses` above it MUST survive loadProject — an omitted key
  // would be reset to [] by the EMPTY_BUNDLE spread and the whole tree would
  // vanish on every project switch.
  'folders',
  // The bin system (demo 2026-09-11): same trap, four more keys.
  'bins', 'binFiles', 'binRoots', 'shotTakes',
  // Post-overhaul S3a (0084): omitted, the EMPTY_BUNDLE spread would reset
  // them and every surface reading the ACTIVE list (D10) would silently fall
  // back to "every scene and shot".
  'shotLists', 'shotListItems', 'edits',
]

/** A server bundle with one identifiable row in every collection. */
function serverBundle() {
  const b = { project: { id: 'p1', title: 'Project One' } }
  for (const k of EXPECTED_KEYS) b[k] = [{ id: `${k}-1` }]
  return b
}

function stubFetch(payload) {
  const res = {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  }
  globalThis.fetch = vi.fn(async () => res)
}

afterEach(() => { vi.restoreAllMocks() })

describe('localServerAdapter.loadProject — bundle key coverage', () => {
  it('returns every collection the bundle shape declares', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    const missing = EXPECTED_KEYS.filter((k) => bundle[k] === undefined)
    expect(missing).toEqual([])
  })

  it('carries milestones through instead of dropping them (#47)', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    // The regression: this was `undefined`, which the EMPTY_BUNDLE spread
    // then turned into [] — indistinguishable from "the user has none".
    expect(bundle.milestones).toEqual([{ id: 'milestones-1' }])
  })

  it('defaults every collection to an array when the server omits it', async () => {
    // A bundle written before a collection existed has no such key. Every
    // slot must still arrive as [] so consumers can map over it unguarded.
    stubFetch({ project: { id: 'p1' } })
    const bundle = await localServerAdapter().loadProject('p1')
    for (const k of EXPECTED_KEYS) {
      expect(Array.isArray(bundle[k]), `${k} should default to []`).toBe(true)
      expect(bundle[k]).toEqual([])
    }
  })

  it('preserves the project row itself', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
  })
})


// ── Milestone trash (A2 session 2, ruling 38) ───────────────────────────────
//
// The desktop DELETE now stamps deleted_at instead of splicing the row out
// (electron/main.cjs, the softDelete opt), so the bundle CONTAINS trashed
// milestones and the adapter is what keeps them off the timeline. That filter
// is the local mirror of milestones_select's `deleted_at IS NULL` arm in 0067:
// if the two backends disagree, the same project looks different depending on
// where it is stored, which is the parity Audrey's Phase 3 exists to enforce.

describe('localServerAdapter — trashed milestones', () => {
  const LIVE    = { id: 'm-live',    title: 'Lock picture' }
  const TRASHED = { id: 'm-trashed', title: 'Wrap', deleted_at: '2026-09-07T10:00:00Z' }
  const OLDER   = { id: 'm-older',   title: 'Scout', deleted_at: '2026-09-01T10:00:00Z' }

  it('loadProject hides trashed milestones and keeps live ones', async () => {
    stubFetch({ project: { id: 'p1' }, milestones: [LIVE, TRASHED] })
    const bundle = await localServerAdapter().loadProject('p1')
    expect(bundle.milestones).toEqual([LIVE])
  })

  it('listMilestones hides them too — the timeline reads both paths', async () => {
    stubFetch({ project: { id: 'p1' }, milestones: [LIVE, TRASHED] })
    expect(await localServerAdapter().listMilestones('p1')).toEqual([LIVE])
  })

  it('listTrashedMilestones returns only the trashed ones, newest first', async () => {
    // Newest first matches milestones_trash_index's ORDER BY deleted_at DESC,
    // so the panel lists them the same way on both backends.
    stubFetch({ project: { id: 'p1' }, milestones: [OLDER, LIVE, TRASHED] })
    const rows = await localServerAdapter().listTrashedMilestones('p1')
    expect(rows.map(r => r.id)).toEqual(['m-trashed', 'm-older'])
  })

  it('restoreMilestone reports the server answer as a boolean', async () => {
    // The cloud RPC returns false when the row was already live (someone else
    // restored it first). The desktop route answers { restored: false } in the
    // same case, and callers must be able to read both the same way.
    stubFetch({ ok: true, restored: false })
    expect(await localServerAdapter().restoreMilestone('m1', 'p1')).toBe(false)
    stubFetch({ ok: true, restored: true })
    expect(await localServerAdapter().restoreMilestone('m1', 'p1')).toBe(true)
  })
})


// ── R1 corrections (A2 session 2) ───────────────────────────────────────────

describe('localServerAdapter — R1 corrections', () => {
  const MAR = { id: 'm-mar', title: 'March',    date: '2026-03-01' }
  const JAN = { id: 'm-jan', title: 'January',  date: '2026-01-01' }
  const FEB = { id: 'm-feb', title: 'February', date: '2026-02-01' }
  const NODATE = { id: 'm-none', title: 'Undated' }

  it('orders milestones by date, matching the cloud order(date) the adapter sends', async () => {
    // R1: the commit claimed "both adapters agree" on order while this one
    // returned bundle INSERTION order. Invisible on the Gantt, which draws by
    // date; visible in ProjectTasksView's milestone rows, which render array
    // order.
    stubFetch({ project: { id: 'p1' }, milestones: [MAR, JAN, FEB] })
    const bundle = await localServerAdapter().loadProject('p1')
    expect(bundle.milestones.map(m => m.id)).toEqual(['m-jan', 'm-feb', 'm-mar'])
  })

  it('sorts listMilestones the same way', async () => {
    stubFetch({ project: { id: 'p1' }, milestones: [MAR, JAN, FEB] })
    expect((await localServerAdapter().listMilestones('p1')).map(m => m.id))
      .toEqual(['m-jan', 'm-feb', 'm-mar'])
  })

  it('puts an undated milestone LAST, as Postgres puts NULLs last ascending', async () => {
    stubFetch({ project: { id: 'p1' }, milestones: [NODATE, FEB] })
    expect((await localServerAdapter().listMilestones('p1')).map(m => m.id))
      .toEqual(['m-feb', 'm-none'])
  })

  it('destroyMilestone asks for a HARD delete, not the trash', async () => {
    // Undoing a CREATE must leave no row and no trash entry: on Local Server
    // nothing purges, so an undone create would otherwise sit in "Recently
    // deleted" forever with no way to remove it.
    const calls = []
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init?.method })
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }
    })
    await localServerAdapter().destroyMilestone('m1', 'p1')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url).toContain('/milestones/m1?purge=1')
  })

  it('deleteMilestone does NOT ask for a purge', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init?.method })
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }
    })
    await localServerAdapter().deleteMilestone('m1', 'p1')
    expect(calls[0].url).not.toContain('purge')
  })
})


// ── R2 L5: the sort must agree with Postgres, not merely be a sort ─────────

describe('byMilestoneDate matches ORDER BY date, id', () => {
  it('breaks ties on id rather than on bundle order', async () => {
    // `ORDER BY date` alone leaves equal dates in an arbitrary heap order in
    // Postgres, while Array.prototype.sort is spec-stable and keeps insertion
    // order — so two key dates on the same day could render differently on the
    // two backends, which is the symptom ordering was added to remove. Both
    // sides now break ties on id.
    stubFetch({ project: { id: 'p1' }, milestones: [
      { id: 'm-z', date: '2026-05-01' },
      { id: 'm-a', date: '2026-05-01' },
      { id: 'm-m', date: '2026-05-01' },
    ] })
    expect((await localServerAdapter().listMilestones('p1')).map(m => m.id))
      .toEqual(['m-a', 'm-m', 'm-z'])
  })

  it('compares dates as dates, not as strings', async () => {
    // localeCompare put '2026-1-5' AFTER '2026-01-15'; Postgres orders them
    // Jan 5 then Jan 15. Only reachable from a hand-edited or imported bundle,
    // since the editor emits padded ISO — but a string compare on a date
    // column is wrong wherever it appears.
    stubFetch({ project: { id: 'p1' }, milestones: [
      { id: 'm-15', date: '2026-01-15' },
      { id: 'm-5',  date: '2026-1-5' },
    ] })
    expect((await localServerAdapter().listMilestones('p1')).map(m => m.id))
      .toEqual(['m-5', 'm-15'])
  })

  it('an unparseable date sorts with the nulls, at the end', async () => {
    stubFetch({ project: { id: 'p1' }, milestones: [
      { id: 'm-bad', date: 'not a date' },
      { id: 'm-ok',  date: '2026-01-15' },
    ] })
    expect((await localServerAdapter().listMilestones('p1')).map(m => m.id))
      .toEqual(['m-ok', 'm-bad'])
  })
})


// ── Shot lists, items and edits (post-overhaul S3a, 0084) ───────────────────
//
// The eleven adapter methods the S3a contract (and its round-1 addendum, A:
// the two membership DELTA writes) gives every backend, driven against a
// fetch spy: each must hit the route electron/rabbitShotLists.cjs registers,
// with the verb and body that route reads. A wrong URL here is a 404 on the
// desktop and nothing anywhere else — the routes' own test mounts the module
// on a fresh app and never sees the adapter.

describe('localServerAdapter — shot lists, items and edits (S3a)', () => {
  function spyFetch(reply = { ok: true }) {
    const calls = []
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method || 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(init.body),
      })
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => reply }
    })
    return calls
  }

  // Rows deliberately out of order: insertion order is NOT the answer.
  const L_B = { id: 'l-b', created_at: '2026-09-30T10:00:00.000Z' }
  const L_A = { id: 'l-a', created_at: '2026-09-30T10:00:00.000Z' }
  const L_OLD = { id: 'l-z', created_at: '2026-09-01T09:00:00.000Z' }
  const I_2 = { id: 'i-2', position: 2 }
  const I_0B = { id: 'i-b', position: 0 }
  const I_0A = { id: 'i-a', position: 0 }
  const I_10 = { id: 'i-10', position: 10 }

  it('loadProject orders shotLists and edits by created_at then id, shotListItems by position then id', async () => {
    stubFetch({ project: { id: 'p1' }, shotLists: [L_B, L_OLD, L_A], shotListItems: [I_10, I_2, I_0B, I_0A], edits: [L_B, L_A, L_OLD] })
    const b = await localServerAdapter().loadProject('p1')
    expect(b.shotLists.map(r => r.id)).toEqual(['l-z', 'l-a', 'l-b'])
    expect(b.edits.map(r => r.id)).toEqual(['l-z', 'l-a', 'l-b'])
    // 10 after 2: a numeric sort, not a string one.
    expect(b.shotListItems.map(r => r.id)).toEqual(['i-a', 'i-b', 'i-2', 'i-10'])
  })

  it('FAILING CONTROL: the sort copies — the server bundle arrays keep their order', async () => {
    const payload = { project: { id: 'p1' }, shotLists: [L_B, L_A], shotListItems: [I_2, I_0A], edits: [] }
    stubFetch(payload)
    await localServerAdapter().loadProject('p1')
    expect(payload.shotLists.map(r => r.id)).toEqual(['l-b', 'l-a'])
    expect(payload.shotListItems.map(r => r.id)).toEqual(['i-2', 'i-a'])
  })

  it('the three list* methods read the bundle (GET /projects/:id) and sort the same way', async () => {
    const calls = spyFetch({ project: { id: 'p1' }, shotLists: [L_B, L_A], shotListItems: [I_2, I_0A], edits: [L_B, L_OLD] })
    const a = localServerAdapter()
    expect((await a.listShotLists('p1')).map(r => r.id)).toEqual(['l-a', 'l-b'])
    expect((await a.listShotListItems('p1')).map(r => r.id)).toEqual(['i-a', 'i-2'])
    expect((await a.listEdits('p1')).map(r => r.id)).toEqual(['l-z', 'l-b'])
    expect(calls.map(c => [c.method, c.url])).toEqual([
      ['GET', '/api/rabbit/projects/p1'],
      ['GET', '/api/rabbit/projects/p1'],
      ['GET', '/api/rabbit/projects/p1'],
    ])
  })

  it('the list* methods answer [] for a bundle without the keys', async () => {
    spyFetch({ project: { id: 'p1' } })
    const a = localServerAdapter()
    expect(await a.listShotLists('p1')).toEqual([])
    expect(await a.listShotListItems('p1')).toEqual([])
    expect(await a.listEdits('p1')).toEqual([])
  })

  it('upsertShotList POSTs the row to …/projects/:project_id/shot-lists', async () => {
    const calls = spyFetch({ id: 'l1' })
    const list = { id: 'l1', project_id: 'p1', title: 'Pickups', version: 2 }
    expect(await localServerAdapter().upsertShotList(list)).toEqual({ id: 'l1' })
    expect(calls).toEqual([{ method: 'POST', url: '/api/rabbit/projects/p1/shot-lists', body: list }])
  })

  it('upsertEdit POSTs the row to …/projects/:project_id/edits', async () => {
    const calls = spyFetch({ id: 'e1' })
    const edit = { id: 'e1', project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 1, items: [] }
    await localServerAdapter().upsertEdit(edit)
    expect(calls).toEqual([{ method: 'POST', url: '/api/rabbit/projects/p1/edits', body: edit }])
  })

  it('upsertShotList and upsertEdit refuse a row with no project_id, without a request', async () => {
    const calls = spyFetch()
    await expect(localServerAdapter().upsertShotList({ title: 'x' })).rejects.toThrow(/project_id/)
    await expect(localServerAdapter().upsertEdit({ title: 'x' })).rejects.toThrow(/project_id/)
    expect(calls).toEqual([])
  })

  it('replaceShotListItems PUTs { items } to …/shot-lists/:listId/items', async () => {
    const rows = [{ id: 'i1', shot_list_id: 'l1', scene_id: 's1', shot_id: null, position: 0 }]
    const calls = spyFetch(rows)
    const items = [{ id: 'i1', scene_id: 's1', position: 0 }, { shot_id: 'sh1' }]
    expect(await localServerAdapter().replaceShotListItems('p1', 'l1', items)).toEqual(rows)
    expect(calls).toEqual([{ method: 'PUT', url: '/api/rabbit/projects/p1/shot-lists/l1/items', body: { items } }])
  })

  it('upsertShotListItems POSTs { items } to …/shot-lists/:listId/items — the DELTA, not the whole-set PUT', async () => {
    // Same URL as replace; the verb is the whole difference, and a PUT here
    // would delete every row of the list this client did not name (R1
    // provider#0) — so the method is pinned, not just the URL.
    const rows = [{ id: 'i9', shot_list_id: 'l1', scene_id: 's2', shot_id: null, position: 4 }]
    const calls = spyFetch(rows)
    const items = [{ scene_id: 's2', position: 4 }]
    expect(await localServerAdapter().upsertShotListItems('p1', 'l1', items)).toEqual(rows)
    expect(calls).toEqual([{ method: 'POST', url: '/api/rabbit/projects/p1/shot-lists/l1/items', body: { items } }])
  })

  it('deleteShotListItems POSTs { ids } to …/shot-lists/:listId/items/delete and answers { deleted }', async () => {
    const calls = spyFetch({ deleted: ['i1'] })
    expect(await localServerAdapter().deleteShotListItems('p1', 'l1', ['i1', 'i2'])).toEqual({ deleted: ['i1'] })
    expect(calls).toEqual([{ method: 'POST', url: '/api/rabbit/projects/p1/shot-lists/l1/items/delete', body: { ids: ['i1', 'i2'] } }])
  })

  it('an archived list\'s refusal of a delta arrives with its status and code (addendum B)', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 409, headers: { get: () => 'application/json' },
      json: async () => ({ error: 'this shot list is archived — restore it before changing it', code: 'conflict' }),
    }))
    const err = await localServerAdapter().upsertShotListItems('p1', 'l1', [{ scene_id: 's1' }]).catch(e => e)
    expect(err.status).toBe(409)
    expect(err.code).toBe('conflict')
    expect(err.message).toBe('[localServer] this shot list is archived — restore it before changing it')
  })

  it('setActiveShotList POSTs { listId } and answers the new active id', async () => {
    const calls = spyFetch({ active_shot_list_id: 'l1' })
    expect(await localServerAdapter().setActiveShotList('p1', 'l1')).toBe('l1')
    expect(calls).toEqual([{ method: 'POST', url: '/api/rabbit/projects/p1/active-shot-list', body: { listId: 'l1' } }])
  })

  it('setActiveShotList(null) — and an undefined listId — send an EXPLICIT null, and answer null', async () => {
    // The route refuses a body without the key rather than guessing "clear";
    // JSON.stringify would drop an undefined value, so the adapter must not
    // pass one through.
    const calls = spyFetch({ active_shot_list_id: null })
    expect(await localServerAdapter().setActiveShotList('p1', null)).toBeNull()
    expect(await localServerAdapter().setActiveShotList('p1', undefined)).toBeNull()
    expect(calls.map(c => c.body)).toEqual([{ listId: null }, { listId: null }])
  })

  it('archiveShotList POSTs { archived } to …/shot-lists/:listId/archive, true by default', async () => {
    const calls = spyFetch({ id: 'l1', archived_at: 'x' })
    const a = localServerAdapter()
    await a.archiveShotList('p1', 'l1')
    await a.archiveShotList('p1', 'l1', false)
    expect(calls).toEqual([
      { method: 'POST', url: '/api/rabbit/projects/p1/shot-lists/l1/archive', body: { archived: true } },
      { method: 'POST', url: '/api/rabbit/projects/p1/shot-lists/l1/archive', body: { archived: false } },
    ])
  })

  it('archiveEdit POSTs { archived } to …/edits/:editId/archive, true by default', async () => {
    const calls = spyFetch({ id: 'e1' })
    const a = localServerAdapter()
    await a.archiveEdit('p1', 'e1')
    await a.archiveEdit('p1', 'e1', false)
    expect(calls).toEqual([
      { method: 'POST', url: '/api/rabbit/projects/p1/edits/e1/archive', body: { archived: true } },
      { method: 'POST', url: '/api/rabbit/projects/p1/edits/e1/archive', body: { archived: false } },
    ])
  })

  it('a route refusal arrives as an Error carrying the status and the code', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 409, headers: { get: () => 'application/json' },
      json: async () => ({ error: 'the active shot list cannot be archived — make another list active first', code: 'conflict' }),
    }))
    const err = await localServerAdapter().archiveShotList('p1', 'l1').catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('[localServer] the active shot list cannot be archived — make another list active first')
    expect(err.status).toBe(409)
    expect(err.code).toBe('conflict')
  })

  it('there is no delete method for lists or edits (D4/D18: archived, never deleted)', () => {
    const a = localServerAdapter()
    expect(a.deleteShotList).toBeUndefined()
    expect(a.deleteEdit).toBeUndefined()
  })
})

