// =============================================================================
// entityMutators.js — the four 0040 entities' writers, made once
// (post-overhaul F10, rabbit A7).
//
// RabbitProvider wrote twelve by hand, from addScene to deleteExperience:
// the Level and Experience three were twins, the four updates shared one body,
// addScene and addShot differed in the collection and the list-link field.
// Eleven are made here from a kind's spec (`ENTITY_SPECS`); deleteScene is
// written once by hand beside them (`makeDeleteScene`), because it is the one
// writer that takes another kind's rows with it: every shot of the scene in
// every list, each with its own undo.
//
// The provider keeps the twelve names, each in its own `useCallback` with the
// dependencies it always had (F4's render counts: a writer's identity changes
// exactly when it did), and hands this module what the bodies read (`env`,
// built in render): the refs, `setBundle`, `optimistic`, `pushHistory`,
// `ensureEntityFolderFor`, the open project's id, and the shot lists' and
// task links' helpers. Nothing here holds state.
//
// What every writer keeps, as it was:
//  · The gate: none in the client. The database's can_write_project (0040's
//    policies) refuses a write; a refused add throws from the adapter before
//    anything changes on screen (no state, no history, no folder); a refused
//    update or delete goes through `optimistic`, which takes back its own
//    change, sets ctx.error and throws before any history is pushed.
//  · The undo: one history entry a write. An add carries the project visit
//    it began on (R2-07 / R1-05); an update and a delete do not, as they did
//    not (OUTSTANDING F10).
//  · The folder: an add ensures the thing's own folder, unawaited (Session
//    26); a rename moves it; a delete does nothing to folders here — the
//    database deletes the thing's folder by key (0041) and, first, moves any
//    board inside it to the project's top (0138's rescue trigger).
//  · No live echo: these four kinds keep the reload limit (her ruling of
//    2026-09-07; realtimeMerge.js merges none of them). An add de-duplicates
//    by id, as addScene and addShot did for an undo replayed beside another;
//    addLevel and addExperience appended (F10: one rule for the four; nothing
//    shows differently, the lists are drawn by sort_order).
// =============================================================================

import { groupingsNaming, sweepGroupings } from './tableViewsState'

const names = (Kind) => Object.freeze({ add: `add${Kind}`, update: `update${Kind}`, remove: `delete${Kind}` })

/**
 * A kind's spec. `list`: the kind is placed in shot lists (S3a) and its tasks
 * link to it by `field` (also its membership rows' field); `takes`: a delete
 * takes the thing's takes with it (BC2).
 */
export const ENTITY_SPECS = Object.freeze({
  scene: Object.freeze({ kind: 'scene', collection: 'scenes', upsert: 'upsertScene', remove: 'deleteScene', names: names('Scene'), list: Object.freeze({ field: 'scene_id' }), takes: false }),
  shot: Object.freeze({ kind: 'shot', collection: 'shots', upsert: 'upsertShot', remove: 'deleteShot', names: names('Shot'), list: Object.freeze({ field: 'shot_id' }), takes: true }),
  level: Object.freeze({ kind: 'level', collection: 'levels', upsert: 'upsertLevel', remove: 'deleteLevel', names: names('Level'), list: null, takes: false }),
  experience: Object.freeze({ kind: 'experience', collection: 'experiences', upsert: 'upsertExperience', remove: 'deleteExperience', names: names('Experience'), list: null, takes: false }),
})

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** `{ add, update, remove }` for one kind; the provider wraps each in its useCallback. */
export function makeEntityMutators(spec, env) {
  const { kind, collection: col, list } = spec
  const mutation = (name) => env.mutationsRef.current[spec.names[name]]

  // S3a: a new scene or shot joins a list — opts.listId (the list the Scenes
  // tab is viewing, S3b), else the ACTIVE list. opts.restoreItems /
  // opts.restoreTaskItems / opts.restoreTaskLinks are the undo path of a
  // delete: the memberships and task links it removed.
  async function add(entity, opts = {}) {
    const { adapterRef, bundleRef, projectVisitRef, taskItemsOnRef, activeProjectId } = env
    if (!adapterRef.current) throw new Error('no adapter')
    if (!activeProjectId) throw new Error('no project')
    // R2-07, as addAsset: answering after a project switch, the row stays in
    // its own project, and is placed in no list then (the lists read now are
    // the other project's): there it shows under "Not in any list".
    const visit = projectVisitRef.current
    // Refuse an archived or unknown target list BEFORE the row is written, or
    // it would land outside the list the caller is showing. A list this
    // client has not loaded yet is read first (another window made it).
    if (list && opts && hasOwn(opts, 'listId') && opts.listId) {
      if (!env.findShotList(opts.listId)) await env.refreshShotListsNow().catch(() => null)
      env.requireEditableShotList(opts.listId)
    }
    const row = {
      id: entity.id || env.newId(),
      project_id: activeProjectId,
      sort_order: bundleRef.current[col].length,
      ...entity,
    }
    const created = await adapterRef.current[spec.upsert](row)
    const finalRow = created || row
    if (projectVisitRef.current !== visit) return finalRow
    // De-duplicated by id: an undo can re-add a row that a parallel undo
    // (ScenesView's un-awaited bulk delete) already brought back (round 2).
    env.setBundle(prev => ({ ...prev, [col]: [...prev[col].filter(x => x.id !== finalRow.id), finalRow] }))
    // Session 26: the thing's own folder. Deliberately NOT awaited: the row is
    // already saved and in state, and a folder that cannot be written must
    // not undo that. ensureEntityFolderFor warns and the next create or
    // reload reconciles.
    env.ensureEntityFolderFor(kind, finalRow)
    let listId = null
    if (list) {
      if (opts?.restoreItems) {
        // The undo of a delete: memberships and task links are restored
        // independently, so a failed membership never costs the task links.
        try { await env.restoreMemberships(opts.restoreItems) } catch (err) {
          console.warn(`[rabbit] ${kind} restored but a shot-list membership was not:`, err?.message || err)
        }
        // FX2 (0096): the task items the delete took come back first; where
        // the backend keeps items they ARE the tasks' links.
        if (opts.restoreTaskItems) await env.restoreItemRows(opts.restoreTaskItems)
        if (!taskItemsOnRef.current) await env.restoreTaskLinks(list.field, finalRow.id, opts.restoreTaskLinks)
      } else {
        try {
          listId = await env.addNewEntityToList(kind, finalRow, opts)
        } catch (err) {
          // D10 as ruled: a row in no list shows on no other tab. Rather than
          // leave one there by accident, take it back out and say why (round
          // 2) — the person sees the error and nothing half-made.
          try { await adapterRef.current[spec.remove](finalRow.id, activeProjectId) } catch { /* reported below */ }
          env.setBundle(prev => ({ ...prev, [col]: prev[col].filter(x => x.id !== finalRow.id) }))
          throw err
        }
      }
    }
    env.pushHistory({
      undoOps: [() => mutation('remove')(finalRow.id)],
      redoOps: [list ? () => mutation('add')(finalRow, { listId }) : () => mutation('add')(finalRow)],
    }, visit)
    return finalRow
  }

  async function update(id, patch) {
    const { adapterRef, bundleRef } = env
    const old = bundleRef.current[col].find(s => s.id === id)
    const oldValues = {}
    if (old) {
      for (const k of Object.keys(patch)) oldValues[k] = old[k]
    }
    const result = await env.optimistic(
      prev => ({ ...prev, [col]: prev[col].map(s => (s.id === id ? { ...s, ...patch } : s)) }),
      () => adapterRef.current[spec.upsert]({ ...bundleRef.current[col].find(s => s.id === id), ...patch, id }),
    )
    // Session 26: a rename MOVES the folder (folderPaths.js records why).
    // Only when the name rides in the patch; every other edit leaves the tree.
    if (patch?.name !== undefined) {
      env.ensureEntityFolderFor(kind, { ...old, ...patch, id })
    }
    if (old) {
      env.pushHistory({
        undoOps: [() => mutation('update')(id, oldValues)],
        redoOps: [() => mutation('update')(id, patch)],
      })
    }
    return result
  }

  // A shot (S3a): out of every list, its tasks un-linked (where the backend
  // keeps no items), its task items and its groupings swept, its takes taken
  // (BC2) — all put back by the undo. A level or an experience: its task
  // items and its groupings (FX2, VW1c).
  async function remove(id) {
    const { adapterRef, bundleRef, taskItemsOnRef, activeProjectId } = env
    const b = bundleRef.current
    const old = b[col].find(s => s.id === id)
    // FX2 (0096): the thing's task items go with it; the undo puts them back.
    const taskItemsGone = (b.taskItems || []).filter(i => i.entity_type === kind && i.entity_id === id).map(i => ({ ...i }))
    // VW1c (0098): it leaves every grouping that names it (the sweep).
    const groupingsGone = groupingsNaming(b.itemGroupings, kind, [id])
    const removedItems = list ? (b.shotListItems || []).filter(i => i[list.field] === id).map(i => ({ ...i })) : []
    const linkedTaskIds = list ? (b.tasks || []).filter(t => t[list.field] === id).map(t => t.id) : []
    // BC2 (BC1's Deferred): a shot's TAKES, before the delete. On the cloud
    // they go with it (0091's CASCADE); the Local Server keeps them as
    // orphans. The undo puts them back through replaceShotTakes, after it.
    const takesBefore = spec.takes ? (b.shotTakes || []).filter(t => t.shot_id === id).map(t => ({ ...t })) : []
    // VW1m: a task's raw link is nulled only where the backend keeps no items
    // (where it does, it is the older apps' copy).
    const itemsKept = taskItemsOnRef.current
    const result = await env.optimistic(
      prev => ({
        ...prev,
        [col]: prev[col].filter(s => s.id !== id),
        ...(list ? {
          shotListItems: (prev.shotListItems || []).filter(i => i[list.field] !== id),
          tasks: itemsKept ? prev.tasks : prev.tasks.map(t => (t[list.field] === id ? { ...t, [list.field]: null } : t)),
        } : null),
        taskItems: (prev.taskItems || []).filter(i => !(i.entity_type === kind && i.entity_id === id)),
        itemGroupings: sweepGroupings(prev.itemGroupings || [], kind, [id]),
      }),
      () => adapterRef.current[spec.remove](id, activeProjectId),
    )
    if (old) {
      env.pushHistory({
        undoOps: [async () => {
          if (list) {
            await mutation('add')(old, { restoreItems: removedItems, restoreTaskLinks: linkedTaskIds, restoreTaskItems: taskItemsGone })
            if (takesBefore.length) await env.mutationsRef.current.replaceShotTakes([id], takesBefore)
          } else {
            await mutation('add')(old)
            if (taskItemsOnRef.current) await env.restoreItemRows(taskItemsGone)
          }
          await env.restoreGroupingsAfterDelete(groupingsGone)
        }],
        redoOps: [() => mutation('remove')(id)],
      })
    }
    return result
  }

  return { add, update, remove }
}

/**
 * deleteScene, written by hand (S3a): deleting a scene deletes its SHOTS on
 * every backend (0040's CASCADE in the cloud; the Local Server and the
 * fixtures match it since review round 1), takes the scene and those shots
 * out of EVERY list (0084's CASCADE; the Local Server's sweep) and un-links
 * their tasks (SET NULL, where the backend keeps no task items). State
 * mirrors all of it, and the undo puts every piece back — the scene, each
 * shot, every membership and every task link — as one step of N+2 parts.
 * Without the membership half an undone delete would come back outside the
 * active list.
 */
export function makeDeleteScene(env) {
  return async function deleteScene(id) {
    const { bundleRef, taskItemsOnRef, mutationsRef, activeProjectId } = env
    const oldScene = bundleRef.current.scenes.find(s => s.id === id)
    const childShots = (bundleRef.current.shots || []).filter(s => s.scene_id === id).map(s => ({ ...s }))
    const childIds = new Set(childShots.map(s => s.id))
    const items = bundleRef.current.shotListItems || []
    const tasks = bundleRef.current.tasks || []
    // FX2 (0096): the scene's and its shots' task items go with them (the
    // CASCADE; the Local Server's sweep); the undo puts them back.
    const namesGone = (i) => (i.entity_type === 'scene' && i.entity_id === id)
      || (i.entity_type === 'shot' && childIds.has(i.entity_id))
    const taskItemsGone = (bundleRef.current.taskItems || []).filter(namesGone).map(i => ({ ...i }))
    const sceneItems = items.filter(i => i.scene_id === id).map(i => ({ ...i }))
    // VW1m (2026-10-16): where the backend keeps items the task rows' single
    // fields are the older apps' copy, which the backend writes and nothing
    // here reads, so the delete leaves them alone (the items' sweep above is
    // the whole change); where it keeps none, the fields ARE the links, nulled
    // as before (0040's SET NULL) and put back by the undo.
    const itemsKept = taskItemsOnRef.current
    const sceneTaskIds = tasks.filter(t => t.scene_id === id).map(t => t.id)
    const shotRestore = childShots.map(sh => ({
      shot: sh,
      items: items.filter(i => i.shot_id === sh.id).map(i => ({ ...i })),
      taskIds: tasks.filter(t => t.shot_id === sh.id).map(t => t.id),
    }))
    // VW1c (0098): the scene and its shots leave every grouping that names
    // them (the sweep, on every backend: scenes and shots have no trash).
    const groupingsGone = [
      ...groupingsNaming(bundleRef.current.itemGroupings, 'scene', [id]),
      ...groupingsNaming(bundleRef.current.itemGroupings, 'shot', [...childIds]),
    ]
    const result = await env.optimistic(
      prev => ({
        ...prev,
        scenes: prev.scenes.filter(s => s.id !== id),
        shots: prev.shots.filter(s => !childIds.has(s.id)),
        shotListItems: (prev.shotListItems || []).filter(i => i.scene_id !== id && !childIds.has(i.shot_id)),
        taskItems: (prev.taskItems || []).filter(i => !namesGone(i)),
        itemGroupings: sweepGroupings(sweepGroupings(prev.itemGroupings || [], 'scene', [id]), 'shot', [...childIds]),
        tasks: itemsKept ? prev.tasks : prev.tasks.map(t => {
          if (t.scene_id !== id && !childIds.has(t.shot_id)) return t
          return {
            ...t,
            ...(t.scene_id === id ? { scene_id: null } : {}),
            ...(childIds.has(t.shot_id) ? { shot_id: null } : {}),
          }
        }),
      }),
      () => env.adapterRef.current.deleteScene(id, activeProjectId),
    )
    if (oldScene) {
      env.pushHistory({
        undoOps: [
          () => mutationsRef.current.addScene(oldScene, {
            restoreItems: sceneItems, restoreTaskLinks: sceneTaskIds,
            restoreTaskItems: taskItemsGone.filter(i => i.entity_type === 'scene'),
          }),
          ...shotRestore.map(r => () => mutationsRef.current.addShot(r.shot, {
            restoreItems: r.items, restoreTaskLinks: r.taskIds,
            restoreTaskItems: taskItemsGone.filter(i => i.entity_type === 'shot' && i.entity_id === r.shot.id),
          })),
          () => env.restoreGroupingsAfterDelete(groupingsGone),
        ],
        redoOps: [() => mutationsRef.current.deleteScene(id)],
      })
    }
    return result
  }
}
