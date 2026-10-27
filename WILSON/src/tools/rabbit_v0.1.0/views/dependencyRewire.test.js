/** @vitest-environment jsdom */
// =============================================================================
// dependencyRewire.test.js — Track A bundle A2 (2026-09-06).
//
// Two halves. The pure drop decision, exhaustively — every branch of the
// gesture that Session 29 gated is a case here, so a "tidy" that changed what
// a release on empty space does would go red. And a source-level guard, in
// the shape validatorSave.test.js established, that the rewire branch of
// `beginDependencyRewire` no longer writes on mouseup: it parks the rewire for
// the confirm modal, and the write lives in `commitRewire` only.
//
// R1 (2026-10-27, night 2): a third part, on the REAL provider over the dev
// fixtures (mounted through state/mountRabbit.js): Replace link is ONE
// gesture, the provider's rewireDependency (docs/OUTSTANDING.md's "A
// dependency rewire deletes before it links"). A refused link — the cloud's
// unique (predecessor_id, successor_id), which the fixtures do not keep and
// `uniqueEdges` below adds — leaves the old edge in the database and on the
// chart and records nothing; a rewire that lands is one undo step; a refused
// put-back says the old edge is gone and the chart shows none. The CONTROL
// runs the two calls commitRewire made before, unawaited, and shows the loss.
// The file runs under jsdom for that part; the rest needs no DOM.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { cleanup, act, waitFor } from '@testing-library/react'
import { resolveRewireDrop, describeRewire } from './dependencyRewire'
import { mountRabbit } from '../state/mountRabbit'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

describe('resolveRewireDrop', () => {
  const edge = { kind: 'task', predId: 'A', origSuccId: 'B' }

  it('cancels when released back on the original successor', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:B' })).toEqual({ action: 'cancel', newSuccId: null })
  })

  it('rewires when released on another bar of the same kind', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:C' })).toEqual({ action: 'rewire', newSuccId: 'C' })
  })

  it('disconnects when released on the predecessor itself (no self-edges)', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:A' })).toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('disconnects when released on a bar of the other kind', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: 'phase:P' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ kind: 'phase', predId: 'P', origSuccId: 'Q', targetKey: 'task:C' }))
      .toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('disconnects when released on empty space or on a malformed key', () => {
    expect(resolveRewireDrop({ ...edge, targetKey: null })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: '' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: 'task:' })).toEqual({ action: 'disconnect', newSuccId: null })
    expect(resolveRewireDrop({ ...edge, targetKey: 'nonsense' })).toEqual({ action: 'disconnect', newSuccId: null })
  })

  it('rewires phase edges between phases', () => {
    expect(resolveRewireDrop({ kind: 'phase', predId: 'P', origSuccId: 'Q', targetKey: 'phase:R' }))
      .toEqual({ action: 'rewire', newSuccId: 'R' })
  })
})

describe('describeRewire', () => {
  const taskById = { A: { title: 'Model' }, B: { title: 'Rig' }, C: { assigned_position: 'Animator' } }
  const phaseById = { P: { name: 'Pre' }, Q: { name: 'Prod' }, R: { name: 'Post' } }

  it('names every end of a task rewire, using the role when a task has no title', () => {
    expect(describeRewire({ kind: 'task', predId: 'A', oldSuccId: 'B', newSuccId: 'C', taskById, phaseById }))
      .toEqual({ kindLabel: 'task', predName: 'Model', oldName: 'Rig', newName: 'Animator' })
  })

  it('names phases from the phase lookup', () => {
    expect(describeRewire({ kind: 'phase', predId: 'P', oldSuccId: 'Q', newSuccId: 'R', taskById, phaseById }))
      .toEqual({ kindLabel: 'phase', predName: 'Pre', oldName: 'Prod', newName: 'Post' })
  })

  it('never shows undefined for a row that is not in the lookup', () => {
    const d = describeRewire({ kind: 'task', predId: 'A', oldSuccId: 'zzzz-9999-unknown', newSuccId: undefined, taskById })
    expect(d.oldName).toBe('#zzzz-999')
    expect(d.newName).toBe('#')
    expect(d.predName).toBe('Model')
  })
})

// ── Source guard ─────────────────────────────────────────────────────────────

// A path, not `new URL(…)`: under jsdom the global URL is jsdom's, which
// readFileSync refuses ("The URL must be of scheme file").
const TIMELINE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'TimelineView.jsx'), 'utf8')

/** The body of `function <name>(` by brace matching, so the assertions are scoped. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return null
  // Skip the parameter list by paren matching FIRST: a destructured
  // parameter such as `({ dep, kind })` would otherwise be taken for the body.
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(open, j + 1)
    }
  }
  return null
}

describe('the rewire gesture confirms before it writes', () => {
  const begin = functionBody(TIMELINE, 'beginDependencyRewire')
  const commit = functionBody(TIMELINE, 'commitRewire')

  it('still defines both halves of the gesture', () => {
    expect(begin).toBeTruthy()
    expect(commit).toBeTruthy()
  })

  it('decides the drop through resolveRewireDrop and parks a rewire instead of writing it', () => {
    expect(begin).toContain('resolveRewireDrop(')
    expect(begin).toContain('setPendingRewire(')
    // The mouseup may still DISCONNECT (that branch is unchanged), but it
    // must not link: both link calls live in commitRewire only.
    expect(begin).not.toContain('onLinkTasks')
    expect(begin).not.toContain('onLinkPhases')
  })

  // R1 (2026-10-27): it was "unlink-then-link, both kinds" — two calls, side
  // by side and unawaited, which is the loss docs/OUTSTANDING.md recorded. A
  // confirmed rewire is ONE call now, the provider's rewireDependency (the
  // mounted tests below hold what it does), and the two halves are not called
  // from here at all.
  it('commits a confirmed rewire as ONE call, the provider\'s rewireDependency, and never the two halves', () => {
    expect(commit).toContain('onRewireDependency?.(p.depId, p.newSuccId, p.kind)')
    expect(commit).not.toContain('onUnlinkDependency')
    expect(commit).not.toContain('onLinkTasks')
    expect(commit).not.toContain('onLinkPhases')
    expect(TIMELINE).toMatch(/onRewireDependency=\{\(depId, succId, kind\) => ctx\.rewireDependency\(depId, succId\)/)
  })

  it('mounts the confirm modal from the parked rewire', () => {
    expect(TIMELINE).toContain('<DependencyRewireModal')
    expect(TIMELINE).toMatch(/pendingRewire && \(?\s*<DependencyRewireModal/)
  })
})

// ── R1: Replace link, on the real provider ───────────────────────────────────

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID, TASK_ID: T } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../state/RabbitProvider')

const DEP_7_8 = fid('dependency', 2)   // the fixtures' task edge 7 → 8
const DEP_8_9 = fid('dependency', 3)   // 8 → 9
const DEP_P1_P2 = fid('dependency', 12) // the phase edge 1 → 2
const PLANTED_7_9 = fid('dependency', 90) // planted below: 7 → 9 is there already
const UNIQUE = 'duplicate key value violates unique constraint "task_dependencies_predecessor_id_successor_id_key"'

/**
 * The cloud's unique (predecessor_id, successor_id), on the fixtures, which
 * keep no such key: an upsert of a NEW edge onto a pair a live edge holds is
 * refused with the database's words. `refuse(dep)` may refuse more (a reason
 * string, or null).
 */
function uniqueEdges(adapter, store, refuse = () => null) {
  const upsert = adapter.upsertDependency.bind(adapter)
  adapter.upsertDependency = async (dep) => {
    const why = refuse(dep)
    if (why) throw new Error(why)
    const clash = store.dependencies.some(d => !d.deleted_at && d.id !== dep.id
      && d.predecessor_id === dep.predecessor_id && d.successor_id === dep.successor_id)
    if (clash) throw new Error(UNIQUE)
    return upsert(dep)
  }
  return adapter
}

/** Holds `method`'s FIRST call until released (budgetVersionsProvider.test's gate). */
function gate(adapter, method) {
  let release
  const gateP = new Promise(r => { release = r })
  let hit
  const hitP = new Promise(r => { hit = r })
  const real = adapter[method].bind(adapter)
  let first = true
  adapter[method] = async (...args) => {
    if (first) { first = false; hit(); await gateP }
    return real(...args)
  }
  return { hitP, release }
}

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null
const run = (fn) => act(async () => { await fn() })
const has = (list, pred, succ) => list.some(d => d.predecessor_id === pred && d.successor_id === succ)
async function mount(adapter) {
  holder.adapter = adapter
  await mountRabbit(h(RabbitProvider, null, h(Probe)), {
    adapter, ctx: () => ctx, until: () => expect(ctx?.project?.id).toBe(PROJECT_ID),
  })
}

describe('R1: Replace link is one gesture (the provider\'s rewireDependency)', () => {
  beforeEach(() => {
    fx = buildDevFixtures()
    fx.store.dependencies.push({
      id: PLANTED_7_9, predecessor_id: T(7), successor_id: T(9), type: 'FS', lag_days: 0, kind: 'task',
    })
  })
  afterEach(() => { cleanup(); ctx = null; fx = null; delete globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS })

  it('CONTROL — the two calls commitRewire made, unawaited: a refused link loses the old edge in the database and on the chart; a rewire that lands is two undo steps', async () => {
    await mount(uniqueEdges(fx.rabbitAdapter(), fx.store))
    expect(has(ctx.dependencies, T(7), T(8))).toBe(true)
    await run(async () => {
      ctx.unlinkDependency(DEP_7_8).then(undefined, () => {})
      ctx.linkTasks(T(7), T(9)).then(undefined, () => {})
    })
    await waitFor(() => expect(has(fx.store.dependencies, T(7), T(8))).toBe(false))
    // The chart agrees with the database: S5d's revertOwnChange takes back the
    // refused link's own row only, so the stale snapshot no longer redraws it.
    expect(has(ctx.dependencies, T(7), T(8))).toBe(false)
    await run(async () => {
      ctx.unlinkDependency(DEP_8_9).then(undefined, () => {})
      ctx.linkTasks(T(8), T(10)).then(undefined, () => {})
    })
    await waitFor(() => expect(has(fx.store.dependencies, T(8), T(10))).toBe(true))
    await run(() => ctx.undo())
    // One Ctrl+Z took back half the rewire: neither edge is there.
    expect(has(fx.store.dependencies, T(8), T(10))).toBe(false)
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(false)
  })

  it('a refused link (the unique edge) leaves the old edge, its own row, in the database and on the chart, rejects with the database\'s words, and records nothing to undo', async () => {
    await mount(uniqueEdges(fx.rabbitAdapter(), fx.store))
    let err = null
    await run(() => ctx.rewireDependency(DEP_7_8, T(9)).catch((e) => { err = e }))
    expect(err?.message).toBe(UNIQUE)
    expect(err?.oldLinkLost).toBeUndefined()
    expect(fx.store.dependencies.find(d => d.id === DEP_7_8)).toMatchObject({ predecessor_id: T(7), successor_id: T(8) })
    expect(ctx.dependencies.find(d => d.id === DEP_7_8)).toMatchObject({ predecessor_id: T(7), successor_id: T(8) })
    expect(ctx.dependencies.filter(d => d.predecessor_id === T(7)).map(d => d.id).sort()).toEqual([DEP_7_8, PLANTED_7_9].sort())
    expect(ctx.canUndo).toBe(false)
  })

  it('a rewire that lands is ONE step: one Ctrl+Z puts the old edge back and takes the new away; one redo makes it again, the same new edge', async () => {
    await mount(uniqueEdges(fx.rabbitAdapter(), fx.store))
    await run(() => ctx.rewireDependency(DEP_8_9, T(10)))
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(false)
    const made = fx.store.dependencies.find(d => d.predecessor_id === T(8) && d.successor_id === T(10))
    expect(made).toMatchObject({ kind: 'task', type: 'FS', lag_days: 0 })
    expect(has(ctx.dependencies, T(8), T(10))).toBe(true)
    await run(() => ctx.undo())
    expect(has(fx.store.dependencies, T(8), T(10))).toBe(false)
    expect(fx.store.dependencies.find(d => d.id === DEP_8_9)).toMatchObject({ successor_id: T(9) })
    expect(ctx.dependencies.find(d => d.id === DEP_8_9)).toMatchObject({ successor_id: T(9) })
    expect(ctx.canUndo).toBe(false)
    await run(() => ctx.redo())
    expect(fx.store.dependencies.find(d => d.id === made.id)).toMatchObject({ successor_id: T(10) })
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(false)
    expect(has(ctx.dependencies, T(8), T(10))).toBe(true)
  })

  it('a phase edge: the same one gesture, its kind kept', async () => {
    await mount(uniqueEdges(fx.rabbitAdapter(), fx.store))
    const P = (n) => fid('phase', n)
    await run(() => ctx.rewireDependency(DEP_P1_P2, P(3)))
    expect(fx.store.dependencies.find(d => d.predecessor_id === P(1) && d.successor_id === P(3))).toMatchObject({ kind: 'phase' })
    expect(has(fx.store.dependencies, P(1), P(2))).toBe(false)
    await run(() => ctx.undo())
    expect(fx.store.dependencies.find(d => d.id === DEP_P1_P2)).toMatchObject({ successor_id: P(2), kind: 'phase' })
    expect(has(fx.store.dependencies, P(1), P(3))).toBe(false)
  })

  it('a refused link whose put-back is refused too: the chart shows the edge the database has (none), and the error says the old link is gone', async () => {
    await mount(uniqueEdges(fx.rabbitAdapter(), fx.store, (dep) => (dep.id === DEP_7_8 ? 'the network dropped' : null)))
    let err = null
    await run(() => ctx.rewireDependency(DEP_7_8, T(9)).catch((e) => { err = e }))
    expect(err?.oldLinkLost).toBe(true)
    expect(err?.message).toContain(UNIQUE)
    expect(err?.message).toContain('the network dropped')
    expect(has(fx.store.dependencies, T(7), T(8))).toBe(false)
    expect(has(ctx.dependencies, T(7), T(8))).toBe(false)
    expect(ctx.canUndo).toBe(false)
  })

  // Review round 1 (R1-01): the rewire waits its turn in the undo queue, as
  // the item sets and the version steps do. It ran beside a Ctrl+Z pressed
  // meanwhile: the press took back the step BEFORE the rewire, and a link
  // that landed during that replay recorded no step at all.
  it('R1-01: a Ctrl+Z pressed while a rewire is in flight waits for it, then takes back the rewire; the step before stays', async () => {
    const a = uniqueEdges(fx.rabbitAdapter(), fx.store)
    await mount(a)
    await run(() => ctx.updateTask(T(9), { priority: 'high' })) // the step before (it was medium)
    const g = gate(a, 'upsertDependency')
    let rewiring
    let undoing
    await act(async () => { rewiring = ctx.rewireDependency(DEP_8_9, T(10)) })
    await act(async () => { await g.hitP }) // the unlink landed; the link waits
    await act(async () => { undoing = ctx.undo(); await new Promise(r => setTimeout(r, 20)) })
    // Not beside it: the step before is still there, in the database too.
    expect(fx.store.tasks.find(t => t.id === T(9)).priority).toBe('high')
    g.release()
    await act(async () => { await rewiring; await undoing })
    // The press took back the step it followed, the rewire, whole.
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(true)
    expect(has(fx.store.dependencies, T(8), T(10))).toBe(false)
    expect(fx.store.tasks.find(t => t.id === T(9)).priority).toBe('high')
    expect(ctx.canUndo).toBe(true) // the priority's step, still to take back
  })

  it('R1-01: a rewire asked for while an Undo still replays past the queue\'s wait is refused in words and writes nothing', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 5
    const a = uniqueEdges(fx.rabbitAdapter(), fx.store)
    await mount(a)
    await run(() => ctx.updateTask(T(9), { priority: 'high' }))
    const g = gate(a, 'patchTask')
    let undoing
    await act(async () => { undoing = ctx.undo() })
    await act(async () => { await g.hitP; await new Promise(r => setTimeout(r, 20)) }) // past the queue's wait
    let err = null
    await act(async () => { await ctx.rewireDependency(DEP_8_9, T(10)).catch((e) => { err = e }) })
    expect(err?.message).toMatch(/an Undo is still running/)
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(true)
    expect(has(fx.store.dependencies, T(8), T(10))).toBe(false)
    g.release()
    await act(async () => { await undoing })
  })

  // Review round 1 (R1-02): after a project switch the rewire's later writes
  // change the database only. The put-back (or the link) was appended to the
  // bundle open then, another project's: a stray row until its next load.
  it('R1-02: a project opened while a refused link is in flight: the old edge is put back in the database, and nothing of it lands in the project now open', async () => {
    const a = uniqueEdges(fx.rabbitAdapter(), fx.store)
    await mount(a)
    let other = null
    await run(async () => { other = await ctx.createProject({ title: 'Other project' }) })
    const g = gate(a, 'upsertDependency')
    let err = null
    let rewiring
    await act(async () => { rewiring = ctx.rewireDependency(DEP_7_8, T(9)).catch((e) => { err = e }) })
    await act(async () => { await g.hitP })
    await run(() => ctx.setActiveProject(other.id))
    await waitFor(() => expect(ctx.project?.id).toBe(other.id))
    const opened = ctx.dependencies.map(d => d.id).sort()
    g.release()
    await act(async () => { await rewiring })
    expect(err?.message).toBe(UNIQUE)
    expect(fx.store.dependencies.find(d => d.id === DEP_7_8)).toMatchObject({ predecessor_id: T(7), successor_id: T(8) })
    expect(ctx.dependencies.some(d => d.id === DEP_7_8)).toBe(false)
    expect(ctx.dependencies.map(d => d.id).sort()).toEqual(opened)
    expect(ctx.canUndo).toBe(false)
  })

  it('R1-02: a project opened while the unlink is in flight: the rewire lands in the database, and its new edge does not land in the project now open', async () => {
    const a = uniqueEdges(fx.rabbitAdapter(), fx.store)
    await mount(a)
    let other = null
    await run(async () => { other = await ctx.createProject({ title: 'Other project' }) })
    const g = gate(a, 'deleteDependency')
    let rewiring
    await act(async () => { rewiring = ctx.rewireDependency(DEP_8_9, T(10)) })
    await act(async () => { await g.hitP })
    await run(() => ctx.setActiveProject(other.id))
    await waitFor(() => expect(ctx.project?.id).toBe(other.id))
    const opened = ctx.dependencies.map(d => d.id).sort()
    g.release()
    await act(async () => { await rewiring })
    const made = fx.store.dependencies.find(d => d.predecessor_id === T(8) && d.successor_id === T(10))
    expect(made).toBeTruthy()
    expect(has(fx.store.dependencies, T(8), T(9))).toBe(false)
    expect(ctx.dependencies.some(d => d.id === made.id)).toBe(false)
    expect(ctx.dependencies.map(d => d.id).sort()).toEqual(opened)
    expect(ctx.canUndo).toBe(false)
  })
})
