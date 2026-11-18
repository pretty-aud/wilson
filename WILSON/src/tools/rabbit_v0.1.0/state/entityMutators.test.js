// =============================================================================
// entityMutators (post-overhaul F10, rabbit A7): the four 0040 entities'
// twelve writers, eleven from one factory and deleteScene by hand, run here
// against a COUNTING fake adapter and a small stand-in for what RabbitProvider
// hands them. The provider's own suites (shotListsProvider, the table views
// over the real provider, mutationsRegistry, F4's render counts) are unedited.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ENTITY_SPECS, makeEntityMutators, makeDeleteScene } from './entityMutators'

/** A bundle in a ref, a setBundle that applies, optimistic as the provider's (revert on throw), and counting spies. */
function harness({ bundle = {}, adapter = {}, taskItemsOn = false } = {}) {
  const state = { current: { scenes: [], shots: [], levels: [], experiences: [], tasks: [], taskItems: [], shotListItems: [], shotTakes: [], itemGroupings: [], ...bundle } }
  const calls = []
  const counting = new Proxy(adapter, {
    get: (t, k) => (typeof t[k] === 'function' ? (...a) => { calls.push([k, ...a]); return t[k](...a) } : async (...a) => { calls.push([k, ...a]); return null }),
  })
  const history = []
  const registry = {}
  const env = {
    adapterRef: { current: counting },
    bundleRef: state,
    projectVisitRef: { current: 7 },
    taskItemsOnRef: { current: taskItemsOn },
    mutationsRef: { current: registry },
    activeProjectId: 'p1',
    setBundle: (fn) => { state.current = fn(state.current) },
    optimistic: async (mutator, call) => {
      const before = state.current
      state.current = mutator(before)
      try { return await call() } catch (err) { state.current = before; throw err }
    },
    pushHistory: vi.fn((entry, visit) => { history.push({ entry, visit }) }),
    ensureEntityFolderFor: vi.fn(),
    newId: () => 'new-id',
    findShotList: () => ({ id: 'list-1' }),
    refreshShotListsNow: async () => {},
    requireEditableShotList: vi.fn(),
    addNewEntityToList: vi.fn(async () => 'list-1'),
    restoreMemberships: vi.fn(async () => {}),
    restoreTaskLinks: vi.fn(async () => {}),
    restoreItemRows: vi.fn(async () => {}),
    restoreGroupingsAfterDelete: vi.fn(async () => {}),
  }
  for (const spec of Object.values(ENTITY_SPECS)) {
    const fns = makeEntityMutators(spec, env)
    registry[spec.names.add] = vi.fn(fns.add)
    registry[spec.names.update] = vi.fn(fns.update)
    registry[spec.names.remove] = vi.fn(fns.remove)
  }
  registry.deleteScene = vi.fn(makeDeleteScene(env))
  registry.replaceShotTakes = vi.fn(async () => {})
  return { env, state, calls, history, registry }
}

const KINDS = Object.values(ENTITY_SPECS)

describe.each(KINDS)('$kind: the writers through the adapter, the undo and the folder', (spec) => {
  const { kind, collection: col, names, upsert, remove } = spec
  it('add: one upsert of the row (id, project, place at the end, the given fields), the folder ensured, one history step with its visit; undo deletes, redo adds again', async () => {
    const h = harness({ bundle: { [col]: [{ id: 'x0', name: 'First' }] } })
    const row = await h.registry[names.add]({ name: 'Second' }, {})
    expect(h.calls.filter(c => c[0] === upsert)).toEqual([[upsert, { id: 'new-id', project_id: 'p1', sort_order: 1, name: 'Second' }]])
    expect(h.state.current[col].map(r => r.id)).toEqual(['x0', 'new-id'])
    expect(h.env.ensureEntityFolderFor).toHaveBeenCalledWith(kind, row)
    expect(h.history).toHaveLength(1)
    expect(h.history[0].visit).toBe(7)
    await h.history[0].entry.undoOps[0]()
    expect(h.registry[names.remove]).toHaveBeenCalledWith('new-id')
    await h.history[0].entry.redoOps[0]()
    expect(h.registry[names.add]).toHaveBeenLastCalledWith(row, ...(spec.list ? [{ listId: 'list-1' }] : []))
  })
  it('add, the same row twice (an undo replayed beside another): one row with its id', async () => {
    const h = harness()
    await h.registry[names.add]({ id: 'r1', name: 'Again' }, {})
    await h.registry[names.add]({ id: 'r1', name: 'Again' }, {})
    expect(h.state.current[col].filter(r => r.id === 'r1')).toHaveLength(1)
  })
  it('add refused (the database\'s can_write_project): it throws, and nothing changed — no row, no history, no folder', async () => {
    const h = harness({ adapter: { [upsert]: async () => { throw new Error('new row violates row-level security policy') } } })
    await expect(h.registry[names.add]({ name: 'No' }, {})).rejects.toThrow(/row-level security/)
    expect(h.state.current[col]).toEqual([])
    expect(h.history).toHaveLength(0)
    expect(h.env.ensureEntityFolderFor).not.toHaveBeenCalled()
  })
  it('update: one upsert of the merged row; the folder only for a rename; one history step (no visit) whose undo puts the old values back', async () => {
    const h = harness({ bundle: { [col]: [{ id: 'x1', name: 'Old', status: 'not_started' }] } })
    await h.registry[names.update]('x1', { status: 'final' })
    expect(h.calls.filter(c => c[0] === upsert)).toEqual([[upsert, { id: 'x1', name: 'Old', status: 'final' }]])
    expect(h.env.ensureEntityFolderFor).not.toHaveBeenCalled()
    expect(h.history[0].visit).toBeUndefined()
    await h.registry[names.update]('x1', { name: 'New' })
    expect(h.env.ensureEntityFolderFor).toHaveBeenCalledWith(kind, { id: 'x1', name: 'New', status: 'final' })
    await h.history[0].entry.undoOps[0]()
    expect(h.registry[names.update]).toHaveBeenLastCalledWith('x1', { status: 'not_started' })
  })
  it('update refused: the screen is put back and no history is pushed', async () => {
    const h = harness({ bundle: { [col]: [{ id: 'x1', name: 'Old' }] }, adapter: { [upsert]: async () => { throw new Error('refused') } } })
    await expect(h.registry[names.update]('x1', { name: 'New' })).rejects.toThrow('refused')
    expect(h.state.current[col]).toEqual([{ id: 'x1', name: 'Old' }])
    expect(h.history).toHaveLength(0)
  })
  it('delete: one adapter delete with the project, no folder call (the database\'s key and rescue do that), the task items and groupings swept; refused: nothing changes', async () => {
    if (kind === 'scene') return // deleteScene is by hand: its own test below
    const items = [{ id: 'i1', entity_type: kind, entity_id: 'x1' }, { id: 'i2', entity_type: kind, entity_id: 'x2' }]
    const h = harness({ bundle: { [col]: [{ id: 'x1' }, { id: 'x2' }], taskItems: items } })
    await h.registry[names.remove]('x1')
    expect(h.calls.filter(c => c[0] === remove)).toEqual([[remove, 'x1', 'p1']])
    expect(h.calls.filter(c => /older|Folder/i.test(c[0]))).toEqual([])
    expect(h.state.current[col]).toEqual([{ id: 'x2' }])
    expect(h.state.current.taskItems.map(i => i.id)).toEqual(['i2'])
    const refused = harness({ bundle: { [col]: [{ id: 'x1' }] }, adapter: { [remove]: async () => { throw new Error('refused') } } })
    await expect(refused.registry[names.remove]('x1')).rejects.toThrow('refused')
    expect(refused.state.current[col]).toEqual([{ id: 'x1' }])
    expect(refused.history).toHaveLength(0)
  })
})

describe('the differences between the kinds, kept', () => {
  it('a scene or a shot joins the list on screen, refused before the write when it is archived; a level does not ask', async () => {
    const h = harness()
    await h.registry.addShot({ name: 'S' }, { listId: 'list-1' })
    expect(h.env.requireEditableShotList).toHaveBeenCalledWith('list-1')
    expect(h.env.addNewEntityToList).toHaveBeenCalledWith('shot', expect.objectContaining({ name: 'S' }), { listId: 'list-1' })
    h.env.requireEditableShotList.mockClear(); h.env.addNewEntityToList.mockClear()
    await h.registry.addLevel({ name: 'L' }, { listId: 'list-1' })
    expect(h.env.requireEditableShotList).not.toHaveBeenCalled()
    expect(h.env.addNewEntityToList).not.toHaveBeenCalled()
  })
  it('a shot\'s delete takes its memberships, its tasks\' links and its takes, and its undo puts each back, the takes after the shot', async () => {
    const h = harness({
      bundle: {
        shots: [{ id: 'sh1', scene_id: 'sc1' }],
        shotListItems: [{ id: 'm1', shot_id: 'sh1' }, { id: 'm2', shot_id: 'sh9' }],
        tasks: [{ id: 't1', shot_id: 'sh1' }],
        shotTakes: [{ id: 'k1', shot_id: 'sh1' }],
      },
    })
    await h.registry.deleteShot('sh1')
    expect(h.state.current.shotListItems.map(i => i.id)).toEqual(['m2'])
    expect(h.state.current.tasks).toEqual([{ id: 't1', shot_id: null }])
    await h.history[0].entry.undoOps[0]()
    expect(h.registry.addShot).toHaveBeenCalledWith({ id: 'sh1', scene_id: 'sc1' }, { restoreItems: [{ id: 'm1', shot_id: 'sh1' }], restoreTaskLinks: ['t1'], restoreTaskItems: [] })
    expect(h.registry.replaceShotTakes).toHaveBeenCalledWith(['sh1'], [{ id: 'k1', shot_id: 'sh1' }])
    expect(h.env.restoreGroupingsAfterDelete).toHaveBeenCalledTimes(1)
  })
  it('a level\'s delete undo restores its task items only where the backend keeps them', async () => {
    const items = [{ id: 'i1', entity_type: 'level', entity_id: 'l1' }]
    for (const on of [false, true]) {
      const h = harness({ bundle: { levels: [{ id: 'l1' }], taskItems: items }, taskItemsOn: on })
      await h.registry.deleteLevel('l1')
      await h.history[0].entry.undoOps[0]()
      expect(h.env.restoreItemRows.mock.calls.length, String(on)).toBe(on ? 1 : 0)
    }
  })
  it('deleteScene (by hand): the scene and every shot of it, their memberships and task links; one undo of N+2 parts', async () => {
    const h = harness({
      bundle: {
        scenes: [{ id: 'sc1' }], shots: [{ id: 'sh1', scene_id: 'sc1' }, { id: 'sh2', scene_id: 'sc1' }, { id: 'sh3', scene_id: 'sc2' }],
        shotListItems: [{ id: 'm1', scene_id: 'sc1' }, { id: 'm2', shot_id: 'sh1' }, { id: 'm3', shot_id: 'sh3' }],
        tasks: [{ id: 't1', scene_id: 'sc1' }, { id: 't2', shot_id: 'sh2' }],
      },
    })
    await h.registry.deleteScene('sc1')
    expect(h.calls.filter(c => c[0] === 'deleteScene')).toEqual([['deleteScene', 'sc1', 'p1']])
    expect(h.state.current.shots.map(s => s.id)).toEqual(['sh3'])
    expect(h.state.current.shotListItems.map(i => i.id)).toEqual(['m3'])
    expect(h.state.current.tasks).toEqual([{ id: 't1', scene_id: null }, { id: 't2', shot_id: null }])
    expect(h.history[0].entry.undoOps).toHaveLength(4)
  })
})

describe('the names the writers call are registered in the provider', () => {
  const provider = readFileSync(new URL('./RabbitProvider.jsx', import.meta.url), 'utf8')
  const factory = readFileSync(new URL('./entityMutators.js', import.meta.url), 'utf8')
  const registered = new Set([...provider.matchAll(/mutationsRef\.current\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)].filter(m => m[1] === m[2]).map(m => m[1]))
  it('every spec name and every literal call here is a registry slot of its own name (an undo that names a missing slot does nothing)', () => {
    const wanted = new Set([
      ...KINDS.flatMap(s => Object.values(s.names)),
      ...[...factory.matchAll(/mutationsRef\.current\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
    ])
    expect([...wanted].filter(n => !registered.has(n))).toEqual([])
    expect(wanted.size).toBeGreaterThanOrEqual(13)
  })
  it('CONTROL: a misspelt name is caught', () => {
    expect(registered.has('addScen')).toBe(false)
    expect(registered.has('addScene')).toBe(true)
  })
})
