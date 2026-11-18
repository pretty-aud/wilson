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
    if (fns.remove) registry[spec.names.remove] = vi.fn(fns.remove)
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
    // The redo puts the patch back (review round 2, 2C-04).
    await h.history[0].entry.redoOps[0]()
    expect(h.registry[names.update]).toHaveBeenLastCalledWith('x1', { status: 'final' })
  })
  it('update refused: the screen is put back and no history is pushed', async () => {
    const h = harness({ bundle: { [col]: [{ id: 'x1', name: 'Old' }] }, adapter: { [upsert]: async () => { throw new Error('refused') } } })
    await expect(h.registry[names.update]('x1', { name: 'New' })).rejects.toThrow('refused')
    expect(h.state.current[col]).toEqual([{ id: 'x1', name: 'Old' }])
    expect(h.history).toHaveLength(0)
  })
})

// deleteScene is by hand: its own cases below (review round 1: this case
// returned at once for a scene and counted as a pass).
describe.each(KINDS.filter(s => !s.deleteByHand))('$kind: the factory\'s delete', (spec) => {
  const { kind, collection: col, names, remove } = spec
  it('delete: one adapter delete with the project, no folder call (the database\'s key and rescue do that), the task items and groupings swept; refused: nothing changes', async () => {
    const items = [{ id: 'i1', entity_type: kind, entity_id: 'x1' }, { id: 'i2', entity_type: kind, entity_id: 'x2' }]
    const groupings = [{ id: 'g1', kind, entity_ids: ['x1', 'x2', 'x3'] }, { id: 'g2', kind: 'asset', entity_ids: ['x1', 'a2'] }]
    const h = harness({ bundle: { [col]: [{ id: 'x1' }, { id: 'x2' }], taskItems: items, itemGroupings: groupings } })
    await h.registry[names.remove]('x1')
    expect(h.calls.filter(c => c[0] === remove)).toEqual([[remove, 'x1', 'p1']])
    expect(h.calls.filter(c => /older|Folder/i.test(c[0]))).toEqual([])
    // The folder helper is the provider's, not the adapter's (review round 1, 1D-01).
    expect(h.env.ensureEntityFolderFor).not.toHaveBeenCalled()
    expect(h.state.current[col]).toEqual([{ id: 'x2' }])
    expect(h.state.current.taskItems.map(i => i.id)).toEqual(['i2'])
    // Swept: no grouping of its kind names it; another kind's id 'x1' is not it (review round 2, 2C-01).
    expect(h.state.current.itemGroupings.filter(g => g.kind === kind).flatMap(g => g.entity_ids)).not.toContain('x1')
    expect(h.state.current.itemGroupings.find(g => g.id === 'g2')).toEqual(groupings[1])
    // The undo brings the row back, then hands back the groupings that named it; the redo deletes it again.
    await h.history[0].entry.undoOps[0]()
    expect(h.registry[names.add].mock.calls[0][0]).toEqual({ id: 'x1' })
    expect(h.env.restoreGroupingsAfterDelete).toHaveBeenCalledWith([groupings[0]])
    expect(h.registry[names.add].mock.invocationCallOrder[0]).toBeLessThan(h.env.restoreGroupingsAfterDelete.mock.invocationCallOrder[0])
    await h.history[0].entry.redoOps[0]()
    expect(h.registry[names.remove].mock.calls).toEqual([['x1'], ['x1']])
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
    // In that order: the shot, then its takes, then the groupings (review round 2, 2C-02).
    const order = [h.registry.addShot, h.registry.replaceShotTakes, h.env.restoreGroupingsAfterDelete].map(f => f.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
  it('where the backend keeps task items, a shot\'s delete leaves its tasks\' own links alone (the items are the links)', async () => {
    const h = harness({ bundle: { shots: [{ id: 'sh1', scene_id: 'sc1' }], tasks: [{ id: 't1', shot_id: 'sh1' }] }, taskItemsOn: true })
    await h.registry.deleteShot('sh1')
    expect(h.state.current.tasks).toEqual([{ id: 't1', shot_id: 'sh1' }])
  })
  it('a level\'s delete undo brings the level back, and its task items only where the backend keeps them', async () => {
    const items = [{ id: 'i1', entity_type: 'level', entity_id: 'l1' }]
    for (const on of [false, true]) {
      const h = harness({ bundle: { levels: [{ id: 'l1' }], taskItems: items }, taskItemsOn: on })
      await h.registry.deleteLevel('l1')
      await h.history[0].entry.undoOps[0]()
      expect(h.registry.addLevel.mock.calls[0], String(on)).toEqual([{ id: 'l1' }])
      expect(h.state.current.levels.map(l => l.id), String(on)).toEqual(['l1'])
      expect(h.env.restoreItemRows.mock.calls, String(on)).toEqual(on ? [[items]] : [])
    }
  })
  it('a scene or a shot asked into an archived list is refused BEFORE the write: nothing written, nothing on screen, no history (review round 2, 2C-03)', async () => {
    for (const spec of KINDS.filter(s => s.list)) {
      const h = harness()
      h.env.requireEditableShotList.mockImplementation((id) => { if (id === 'list-archived') throw new Error('This list is archived.') })
      await expect(h.registry[spec.names.add]({ name: 'No' }, { listId: 'list-archived' }), spec.kind).rejects.toThrow('This list is archived.')
      expect(h.calls.filter(c => c[0] === spec.upsert), spec.kind).toEqual([])
      expect(h.state.current[spec.collection], spec.kind).toEqual([])
      expect(h.history, spec.kind).toHaveLength(0)
    }
  })
  it('deleteScene (by hand): the scene and every shot of it, their memberships and task links; one undo of N+2 parts', async () => {
    const h = harness({
      bundle: {
        scenes: [{ id: 'sc1' }], shots: [{ id: 'sh1', scene_id: 'sc1' }, { id: 'sh2', scene_id: 'sc1' }, { id: 'sh3', scene_id: 'sc2' }],
        shotListItems: [{ id: 'm1', scene_id: 'sc1' }, { id: 'm2', shot_id: 'sh1' }, { id: 'm3', shot_id: 'sh3' }],
        tasks: [{ id: 't1', scene_id: 'sc1' }, { id: 't2', shot_id: 'sh2' }],
        taskItems: [{ id: 'i1', entity_type: 'scene', entity_id: 'sc1' }, { id: 'i2', entity_type: 'shot', entity_id: 'sh1' }, { id: 'i3', entity_type: 'shot', entity_id: 'sh3' }],
        itemGroupings: [{ id: 'g1', kind: 'scene', entity_ids: ['sc1', 'sc8', 'sc9'] }, { id: 'g2', kind: 'shot', entity_ids: ['sh1', 'sh3', 'sh4'] }],
      },
    })
    await h.registry.deleteScene('sc1')
    expect(h.calls.filter(c => c[0] === 'deleteScene')).toEqual([['deleteScene', 'sc1', 'p1']])
    expect(h.state.current.shots.map(s => s.id)).toEqual(['sh3'])
    expect(h.state.current.shotListItems.map(i => i.id)).toEqual(['m3'])
    expect(h.state.current.tasks).toEqual([{ id: 't1', scene_id: null }, { id: 't2', shot_id: null }])
    // The scene's and its shots' task items and groupings go with them (review round 2, 2C-01, 2C-04).
    expect(h.state.current.taskItems.map(i => i.id)).toEqual(['i3'])
    expect(h.state.current.itemGroupings.flatMap(g => g.entity_ids)).not.toContain('sc1')
    expect(h.state.current.itemGroupings.flatMap(g => g.entity_ids)).not.toContain('sh1')
    expect(h.state.current.itemGroupings.flatMap(g => g.entity_ids)).toContain('sh3')
    expect(h.env.ensureEntityFolderFor).not.toHaveBeenCalled()
    expect(h.history[0].entry.undoOps).toHaveLength(4)
  })
  it('deleteScene where the backend keeps task items: the tasks\' own links are left alone (the items are the links)', async () => {
    const tasks = [{ id: 't1', scene_id: 'sc1' }, { id: 't2', shot_id: 'sh1' }]
    const h = harness({ bundle: { scenes: [{ id: 'sc1' }], shots: [{ id: 'sh1', scene_id: 'sc1' }], tasks }, taskItemsOn: true })
    await h.registry.deleteScene('sc1')
    expect(h.state.current.tasks).toEqual(tasks)
  })

  // ── Review round 1 (1D-02, 1D-03): the paths no case ran ──
  it('a scene\'s spec makes no delete: deleteScene is by hand, and the generic one would leave its shots on screen and bring none back', () => {
    const { env } = harness()
    for (const spec of KINDS) {
      expect(Object.keys(makeEntityMutators(spec, env)), spec.kind).toEqual(spec.kind === 'scene' ? ['add', 'update'] : ['add', 'update', 'remove'])
    }
  })
  it('a scene or a shot whose list placement fails is taken back out (D10): the adapter delete with the project, out of state, the error thrown, no history', async () => {
    for (const spec of KINDS.filter(s => s.list)) {
      const h = harness()
      h.env.addNewEntityToList.mockRejectedValueOnce(new Error('That list is archived.'))
      await expect(h.registry[spec.names.add]({ name: 'Orphan' }, {}), spec.kind).rejects.toThrow('That list is archived.')
      expect(h.calls.filter(c => c[0] === spec.remove), spec.kind).toEqual([[spec.remove, 'new-id', 'p1']])
      expect(h.state.current[spec.collection], spec.kind).toEqual([])
      expect(h.history, spec.kind).toHaveLength(0)
    }
  })
  it('an add answered after a project switch (R2-07): the row comes back, and nothing is drawn, filed, placed or put on the undo here', async () => {
    for (const spec of KINDS) {
      let h = null
      h = harness({ adapter: { [spec.upsert]: async (row) => { h.env.projectVisitRef.current = 8; return row } } })
      const row = await h.registry[spec.names.add]({ name: 'Late' }, {})
      expect(row.id, spec.kind).toBe('new-id')
      expect(h.state.current[spec.collection], spec.kind).toEqual([])
      expect(h.env.ensureEntityFolderFor, spec.kind).not.toHaveBeenCalled()
      expect(h.env.addNewEntityToList, spec.kind).not.toHaveBeenCalled()
      expect(h.history, spec.kind).toHaveLength(0)
    }
  })
  it('an undo\'s add puts back a scene\'s or a shot\'s memberships and task items, and its task links by its own field only where the backend keeps no items', async () => {
    for (const spec of KINDS.filter(s => s.list)) {
      for (const on of [false, true]) {
        const h = harness({ taskItemsOn: on })
        await h.registry[spec.names.add]({ id: 'r1', name: 'Back' }, { restoreItems: [{ id: 'm1' }], restoreTaskLinks: ['t1'], restoreTaskItems: [{ id: 'i1' }] })
        const what = `${spec.kind}, items kept: ${on}`
        expect(h.env.restoreMemberships, what).toHaveBeenCalledWith([{ id: 'm1' }])
        expect(h.env.restoreItemRows, what).toHaveBeenCalledWith([{ id: 'i1' }])
        expect(h.env.restoreTaskLinks.mock.calls, what).toEqual(on ? [] : [[spec.list.field, 'r1', ['t1']]])
        expect(h.env.addNewEntityToList, what).not.toHaveBeenCalled()
      }
    }
  })
  it('deleteScene refused: the scene, its shots, their memberships and links are put back, and nothing to undo', async () => {
    const bundle = { scenes: [{ id: 'sc1' }], shots: [{ id: 'sh1', scene_id: 'sc1' }], shotListItems: [{ id: 'm1', scene_id: 'sc1' }], tasks: [{ id: 't1', scene_id: 'sc1' }] }
    const h = harness({ bundle, adapter: { deleteScene: async () => { throw new Error('refused') } } })
    await expect(h.registry.deleteScene('sc1')).rejects.toThrow('refused')
    expect([h.state.current.scenes, h.state.current.shots, h.state.current.shotListItems, h.state.current.tasks])
      .toEqual([bundle.scenes, bundle.shots, bundle.shotListItems, bundle.tasks])
    expect(h.history).toHaveLength(0)
  })
  it('deleteScene\'s undo, part by part: the scene with its memberships, links and items, then each shot with its own, then the groupings; its redo deletes the scene again', async () => {
    const h = harness({
      bundle: {
        scenes: [{ id: 'sc1' }], shots: [{ id: 'sh1', scene_id: 'sc1' }, { id: 'sh2', scene_id: 'sc1' }],
        shotListItems: [{ id: 'm1', scene_id: 'sc1' }, { id: 'm2', shot_id: 'sh1' }],
        tasks: [{ id: 't1', scene_id: 'sc1' }, { id: 't2', shot_id: 'sh2' }],
        taskItems: [{ id: 'i1', entity_type: 'scene', entity_id: 'sc1' }, { id: 'i2', entity_type: 'shot', entity_id: 'sh2' }],
        itemGroupings: [{ id: 'g1', kind: 'scene', entity_ids: ['sc1', 'sc8', 'sc9'] }, { id: 'g2', kind: 'shot', entity_ids: ['sh2', 'sh8'] }],
      },
    })
    await h.registry.deleteScene('sc1')
    const { undoOps, redoOps } = h.history[0].entry
    for (const op of undoOps) await op()
    // In that order: the scene before its shots (a shot points at it), the groupings last (review round 2, 2C-02).
    const order = [...h.registry.addScene.mock.invocationCallOrder, ...h.registry.addShot.mock.invocationCallOrder, ...h.env.restoreGroupingsAfterDelete.mock.invocationCallOrder]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(h.env.restoreGroupingsAfterDelete).toHaveBeenCalledWith([
      { id: 'g1', kind: 'scene', entity_ids: ['sc1', 'sc8', 'sc9'] }, { id: 'g2', kind: 'shot', entity_ids: ['sh2', 'sh8'] },
    ])
    expect(h.registry.addScene.mock.calls).toEqual([[{ id: 'sc1' }, {
      restoreItems: [{ id: 'm1', scene_id: 'sc1' }], restoreTaskLinks: ['t1'], restoreTaskItems: [{ id: 'i1', entity_type: 'scene', entity_id: 'sc1' }],
    }]])
    expect(h.registry.addShot.mock.calls).toEqual([
      [{ id: 'sh1', scene_id: 'sc1' }, { restoreItems: [{ id: 'm2', shot_id: 'sh1' }], restoreTaskLinks: [], restoreTaskItems: [] }],
      [{ id: 'sh2', scene_id: 'sc1' }, { restoreItems: [], restoreTaskLinks: ['t2'], restoreTaskItems: [{ id: 'i2', entity_type: 'shot', entity_id: 'sh2' }] }],
    ])
    expect(h.env.restoreGroupingsAfterDelete).toHaveBeenCalledTimes(1)
    await redoOps[0]()
    expect(h.registry.deleteScene).toHaveBeenLastCalledWith('sc1')
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
  it('CONTROL: the same check, over the same names and one misspelt, finds that one (review round 1, 1D-04)', () => {
    const wanted = new Set([...KINDS.flatMap(s => Object.values(s.names)), 'addScen'])
    expect([...wanted].filter(n => !registered.has(n))).toEqual(['addScen'])
  })
})
