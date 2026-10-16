/** @vitest-environment jsdom */
// =============================================================================
// VW1m (2026-10-16) — the Timeline with no main item. Audrey: "lets not have
// main asset be a thing. thats not needed and i dont like. instead lets do the
// same as the grouping option. make the grouping a group in the timeline as
// well." The contract is item 2 of docs/sessions/handoffs/po-vw1m-2026-10-16.md
// ("The Timeline"):
//   * grouped by asset (level, experience) a task sits in ONE row, its
//     combination's: one item, that item's row (every item keeps its row, as
//     before, even empty); two or more, a row named for them all, after the
//     single rows, A to Z; none, No asset, last. Group by scene: scenes
//     outside, shots inside, each a combination of the task's own;
//   * a combination's header has no bar and opens nothing; scene, shot,
//     level, experience, team and No … headers stop opening Edit phase and
//     stop moving as a phase (the asset row keeps its asset editor);
//   * a task's phase is its own, else the phase its live assets share, else
//     Unphased — in the rows, the schedule, the minimap's count and a phase
//     bar's drag;
//   * a new task from a row starts with the row's items and, grouped by
//     phase, its phase — never the project's first asset or first phase;
//   * a drop on a row gives the task that row's items (setTaskItemsOfKind),
//     keeping the items the Timeline does not show.
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react'

const rabbit = vi.hoisted(() => ({ current: {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}

const { default: TimelineView, buildRowsByGrouping, versionTaskItems, loadRabbitSettings } = await import('./TimelineView.jsx')
const { buildItemLookup, NO_KIND_LABEL } = await import('../state/taskItemsModel')
const { NO_SCENE_GROUP } = await import('./scenes/linkHomes')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const schedule = { tasks: {}, phases: {} }
let n = 0
const item = (task, kind, id) => ({ id: `i${++n}`, task_id: task, project_id: 'p1', entity_type: kind, entity_id: id, position: n, created_at: '2026-10-16T09:00:00Z' })
const taskRows = (rows) => rows.filter(r => r.kind === 'task').map(r => r.task.id)
const groups = (rows) => rows.filter(r => r.kind === 'phase').map(r => r.label)
const under = (rows, key) => {
  const at = rows.findIndex(r => r.key === key)
  if (at < 0) return null
  const out = []
  for (let i = at + 1; i < rows.length && !(rows[i].kind === 'phase' && rows[i].depth <= rows[at].depth); i += 1) {
    if (rows[i].kind === 'task') out.push(rows[i].task.id)
  }
  return out.sort()
}
const row = (rows, key) => rows.find(r => r.key === key)

// Task 18's shape (the fixtures' Lighthouse Interior and Storm Lantern), with
// a task on one of them, one on none, one on the same two the other way
// round, one on another pair and one whose second asset is in the trash. No
// task carries a link field: the provider strips them where items are kept.
const P1 = { id: 'P1', name: 'Build', start_date: '2026-10-01', end_date: '2026-10-31' }
const P2 = { id: 'P2', name: 'Light', start_date: '2026-11-01', end_date: '2026-11-30' }
const A = { id: 'A', name: 'Lighthouse Interior', phase_id: 'P1' }
const B = { id: 'B', name: 'Storm Lantern', phase_id: 'P1' }
const C = { id: 'C', name: 'Dock', phase_id: 'P2' }
const assets = [A, B, C]
const assetTasks = [
  { id: 't18', title: 'Light the interior' },
  { id: 't2', title: 'Model the lantern' },
  { id: 't3', title: 'Boards' },
  { id: 't4', title: 'Prop pass' },
  { id: 't5', title: 'Dress the dock' },
  { id: 't6', title: 'Trashed partner' },
]
const assetItems = [
  item('t18', 'asset', 'A'), item('t18', 'asset', 'B'),
  item('t2', 'asset', 'B'),
  item('t4', 'asset', 'B'), item('t4', 'asset', 'A'),
  item('t5', 'asset', 'C'), item('t5', 'asset', 'B'),
  item('t6', 'asset', 'A'), item('t6', 'asset', 'Z'), // Z: in the trash
]
const lookupOf = (over = {}) => buildItemLookup({ items: assetItems, available: true, assets, scenes: [], shots: [], levels: [], experiences: [], ...over })

describe('grouped by asset: one row per combination (VW1m)', () => {
  const rows = buildRowsByGrouping({ groupBy: 'asset', phases: [], assets, tasks: assetTasks, schedule, itemLookup: lookupOf() })

  it('a task on two assets sits once, in "Lighthouse Interior, Storm Lantern" — not under either asset', () => {
    expect(under(rows, 'grp-as-A|B')).toEqual(['t18', 't4'])
    expect(under(rows, 'grp-as-A')).toEqual(['t6'])
    expect(under(rows, 'grp-as-B')).toEqual(['t2'])
    expect(row(rows, 'grp-as-A|B').label).toBe('Lighthouse Interior, Storm Lantern')
  })
  it('every single asset keeps its row in today\'s order, even empty; the combinations follow A to Z; No asset is last', () => {
    expect(groups(rows)).toEqual([
      'Dock', 'Lighthouse Interior', 'Storm Lantern',
      'Dock, Storm Lantern', 'Lighthouse Interior, Storm Lantern',
      NO_KIND_LABEL.asset,
    ])
    expect(under(rows, 'grp-as-C')).toEqual([])
    expect(under(rows, 'grp-as-B|C')).toEqual(['t5'])
    expect(under(rows, 'grp-as-noasset')).toEqual(['t3'])
    expect(NO_KIND_LABEL.asset).toBe('No asset')
  })
  it('one tk- row per task, and every key unique', () => {
    expect(taskRows(rows).sort()).toEqual(['t18', 't2', 't3', 't4', 't5', 't6'])
    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('a combination\'s header has no bar, opens nothing (groupOnly), names every asset on hover, and carries its items; the single row keeps its asset', () => {
    const combo = row(rows, 'grp-as-A|B')
    expect(combo.groupOnly).toBe(true)
    expect(combo.start).toBeUndefined()
    expect(combo.end).toBeUndefined()
    expect(combo.assetRef).toBeUndefined()
    expect(combo.tooltip).toBe('Lighthouse Interior, Storm Lantern')
    expect(combo.items).toEqual({ asset: ['A', 'B'] })
    expect(row(rows, 'dz-grp-as-A|B').phase.id).toBe('grp-as-A|B')
    const single = row(rows, 'grp-as-A')
    expect(single.assetRef).toBe(A)
    expect(single.groupOnly).toBeUndefined()
    expect(single.items).toEqual({ asset: ['A'] })
    expect(row(rows, 'grp-as-noasset')).toMatchObject({ groupOnly: true, items: { asset: [] } })
  })
  it('an asset in the trash is hidden from its task (her Q-N4): the task sits under its live asset, saying nothing', () => {
    expect(row(rows, 'tk-t6').tooltip).toBeUndefined()
  })
  it('CONTROL: read through the single field (the older apps\' copy, no lookup) a two-asset task sits under its first asset alone', () => {
    const copy = assetTasks.map(t => ({ ...t, asset_id: { t18: 'A', t2: 'B', t4: 'B', t5: 'C', t6: 'A' }[t.id] || null }))
    const old = buildRowsByGrouping({ groupBy: 'asset', phases: [], assets, tasks: copy, schedule })
    expect(under(old, 'grp-as-A')).toEqual(['t18', 't6'])
    expect(old.some(r => r.key === 'grp-as-A|B')).toBe(false)
  })
})

describe('grouped by level and by experience: the same rule (VW1m)', () => {
  const levels = [{ id: 'L1', name: 'Dock' }, { id: 'L2', name: 'Attic' }]
  const experiences = [{ id: 'E1', name: 'Tour' }, { id: 'E2', name: 'Arcade' }]
  const tasks = [{ id: 'x1', title: 'Both' }, { id: 'x2', title: 'One' }, { id: 'x3', title: 'None' }]
  const items = [
    item('x1', 'level', 'L1'), item('x1', 'level', 'L2'), item('x2', 'level', 'L2'),
    item('x1', 'experience', 'E1'), item('x1', 'experience', 'E2'), item('x2', 'experience', 'E1'),
  ]
  const itemLookup = buildItemLookup({ items, available: true, assets: [], scenes: [], shots: [], levels, experiences })
  // [grouping, key prefix, No row's key, the header labels in order, the
  // combination's key, its label, its ids in the display order (A to Z by
  // name), a single item that holds a task]
  for (const [groupBy, prefix, none, labels, combo, comboLabel, comboIds, single] of [
    ['level', 'lv', 'grp-nolevel', ['Attic', 'Dock', 'Attic, Dock', NO_KIND_LABEL.level], 'L1|L2', 'Attic, Dock', ['L2', 'L1'], 'L2'],
    ['experience', 'xp', 'grp-noexp', ['Arcade', 'Tour', 'Arcade, Tour', NO_KIND_LABEL.experience], 'E1|E2', 'Arcade, Tour', ['E2', 'E1'], 'E1'],
  ]) {
    it(`${groupBy}: single rows, then the combination, then ${NO_KIND_LABEL[groupBy]}; one row per task; the headers only group`, () => {
      const rows = buildRowsByGrouping({ groupBy, phases: [], assets: [], tasks, schedule, levels, experiences, itemLookup })
      expect(groups(rows)).toEqual(labels)
      expect(under(rows, `grp-${prefix}-${combo}`)).toEqual(['x1'])
      expect(under(rows, `grp-${prefix}-${single}`)).toEqual(['x2'])
      expect(under(rows, none)).toEqual(['x3'])
      expect(row(rows, `grp-${prefix}-${combo}`)).toMatchObject({ label: comboLabel, groupOnly: true, items: { [groupBy]: comboIds } })
      expect(row(rows, `grp-${prefix}-${single}`)).toMatchObject({ groupOnly: true, items: { [groupBy]: [single] } })
      expect(row(rows, none)).toMatchObject({ groupOnly: true, items: { [groupBy]: [] } })
      expect(taskRows(rows).sort()).toEqual(['x1', 'x2', 'x3'])
    })
  }
})

// Scenes S1 and S2 are in the active list; S3 is the project's, in no list.
const S1 = { id: 'S1', name: 'Harbour', scene_number: 1 }
const S2 = { id: 'S2', name: 'Lighthouse', scene_number: 2 }
const S3 = { id: 'S3', name: 'Cliff', scene_number: 3 }
const X1 = { id: 'X1', scene_id: 'S1', name: 'SH010', shot_number: 10 }
const X2 = { id: 'X2', scene_id: 'S1', name: 'SH020', shot_number: 20 }
const Y1 = { id: 'Y1', scene_id: 'S2', name: 'SH030', shot_number: 10 }
const everyRow = { S1, S2, S3, X1, X2, Y1 }
const sceneTasks = [
  { id: 'a', title: 'On X1' },
  { id: 'b', title: 'On X1 and X2' },
  { id: 'c', title: 'On X1 and Y1' },
  { id: 'd', title: 'On both scenes' },
  { id: 'e', title: 'On S2' },
  { id: 'f', title: 'On nothing' },
  { id: 'g', title: 'On S1 and Cliff' },
]
const sceneItems = [
  item('a', 'shot', 'X1'),
  item('b', 'shot', 'X2'), item('b', 'shot', 'X1'),
  item('c', 'shot', 'Y1'), item('c', 'shot', 'X1'),
  item('d', 'scene', 'S2'), item('d', 'scene', 'S1'),
  item('e', 'scene', 'S2'),
  item('g', 'scene', 'S1'), item('g', 'scene', 'S3'),
]
const sceneLookup = buildItemLookup({ items: sceneItems, available: true, assets: [], scenes: [S1, S2, S3], shots: [X1, X2, Y1], levels: [], experiences: [] })
const byScene = () => buildRowsByGrouping({
  groupBy: 'scene', phases: [], assets: [], tasks: sceneTasks, schedule,
  scenes: [S1, S2], shots: [X1, X2, Y1],
  sceneById: (id) => everyRow[id] || null, shotById: (id) => everyRow[id] || null,
  itemLookup: sceneLookup,
})

describe('grouped by scene: scenes outside, shots inside, each a combination (VW1m)', () => {
  it('single scenes and shots keep their rows; a scene\'s shot combinations follow its shots; scene combinations follow the scenes; No scene last', () => {
    expect(groups(byScene())).toEqual([
      'Harbour', 'SH010', 'SH020', 'SH010, SH020',
      'Lighthouse', 'SH030',
      'Harbour, Lighthouse', 'SH010, SH030',
      NO_SCENE_GROUP,
    ])
  })
  it('each task sits once: by its shots\' scenes when it has shots in the active list, else by its scenes', () => {
    const rows = byScene()
    expect(under(rows, 'grp-sh-X1')).toEqual(['a'])
    expect(under(rows, 'grp-sh-X1|X2')).toEqual(['b'])
    expect(under(rows, 'grp-sc-S1')).toEqual(['a', 'b', 'g'])
    expect(under(rows, 'grp-sc-S2')).toEqual(['e'])
    expect(under(rows, 'grp-sc-S1|S2')).toEqual(['c', 'd'])
    expect(under(rows, 'grp-sh-X1|Y1')).toEqual(['c'])
    expect(under(rows, 'grp-noscene')).toEqual(['f'])
    expect(taskRows(rows).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('the nesting depths, and the items each row gives a drop or a new task', () => {
    const rows = byScene()
    expect(row(rows, 'grp-sh-X1|X2')).toMatchObject({ depth: 1, groupOnly: true, items: { scene: ['S1'], shot: ['X1', 'X2'] } })
    expect(row(rows, 'tk-b').depth).toBe(2)
    expect(row(rows, 'grp-sc-S1|S2')).toMatchObject({ depth: 0, groupOnly: true, items: { scene: ['S1', 'S2'], shot: [] } })
    expect(row(rows, 'grp-sh-X1|Y1')).toMatchObject({ depth: 1, items: { scene: ['S1', 'S2'], shot: ['X1', 'Y1'] } })
    expect(row(rows, 'tk-d').depth).toBe(1)
    expect(row(rows, 'grp-sc-S1')).toMatchObject({ groupOnly: true, items: { scene: ['S1'], shot: [] } })
    expect(row(rows, 'grp-sh-X1')).toMatchObject({ groupOnly: true, items: { scene: ['S1'], shot: ['X1'] } })
    expect(row(rows, 'grp-noscene')).toMatchObject({ groupOnly: true, items: { scene: [], shot: [] } })
    // The drop zones follow what they close: a scene combination's after its shots.
    const at = (key) => rows.findIndex(r => r.key === key)
    expect(at('dz-grp-sc-S1|S2')).toBeGreaterThan(at('dz-grp-sh-X1|Y1'))
  })
  it('a scene outside the active list is still the task\'s: named in its tooltip, as before (the rule of 2026-10-02)', () => {
    expect(row(byScene(), 'tk-g').tooltip).toBe('Scene “Cliff”: in no shot list')
    expect(row(byScene(), 'tk-d').tooltip).toBeUndefined()
  })
})

describe('a task\'s phase: its own, else the phase its live assets share, else Unphased (VW1m)', () => {
  const tasks = [
    { id: 'own', title: 'Own phase', phase_id: 'P2' },
    { id: 'shared', title: 'Shared phase' },
    { id: 'split', title: 'Split phases' },
    { id: 'none', title: 'Nothing' },
    { id: 'trashedMix', title: 'One live asset' },
  ]
  const items = [
    item('own', 'asset', 'A'),
    item('shared', 'asset', 'A'), item('shared', 'asset', 'B'),
    item('split', 'asset', 'A'), item('split', 'asset', 'C'),
    item('trashedMix', 'asset', 'A'), item('trashedMix', 'asset', 'Z'),
  ]
  it('in the rows', () => {
    const rows = buildRowsByGrouping({ groupBy: 'phase', phases: [P1, P2], assets, tasks, schedule, itemLookup: lookupOf({ items }) })
    expect(under(rows, 'ph-P1')).toEqual(['shared', 'trashedMix'])
    expect(under(rows, 'ph-P2')).toEqual(['own'])
    expect(under(rows, 'ph-unphased')).toEqual(['none', 'split'])
    // The task rows carry no asset hint any more (it fed only the dropped prefill).
    expect(rows.filter(r => r.kind === 'task').some(r => 'assetHint' in r)).toBe(false)
  })
})

// ── The view: what a ctx double draws ──────────────────────────────────────
const ctxFor = (over = {}) => ({
  project: { id: 'p1', scenes_enabled: true, levels_enabled: true, experiences_enabled: true },
  activeProjectId: 'p1',
  phases: [P1, P2], assets, tasks: assetTasks, dependencies: [],
  scenes: [S1, S2], shots: [X1, X2, Y1], allScenes: [S1, S2, S3], allShots: [X1, X2, Y1],
  levels: [{ id: 'L1', name: 'Dock', start_date: '2026-10-05', end_date: '2026-10-09' }], experiences: [], milestones: [],
  teamAssignments: [], taskItems: assetItems, taskItemsAvailable: true,
  sceneById: (id) => everyRow[id] || null, shotById: (id) => everyRow[id] || null,
  shotLists: [], shotListItems: [], edits: [], activeShotList: null, formatShotListLabel: () => '',
  undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
  addTask: vi.fn(async (r) => ({ id: 'new', ...r })),
  updateTask: vi.fn(async () => ({})),
  updatePhase: vi.fn(async () => ({})),
  updateAsset: vi.fn(async () => ({})),
  setTaskItemsOfKind: vi.fn(async () => {}),
  runBatch: vi.fn(async (fn) => fn()),
  ...over,
})
const mount = () => render(<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive />)
const groupBy = (name) => fireEvent.click(screen.getByRole('tab', { name }))
const gutterRow = (target) => document.querySelector(`.rb-tl-row[data-phase-drop-target="${target}"]`)
const dropZone = (target) => document.querySelector(`.rb-tl-dz[data-phase-drop-target="${target}"]`)
const taskRowEl = (title) => [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === title)?.parentElement
const editorTitle = () => document.querySelector('.rb-tl-ed-title')?.textContent || null
const fieldOf = (label) => [...document.querySelectorAll('label')].find(l => l.textContent === label)?.nextElementSibling || null
const typeTitle = (text) => fireEvent.change(document.querySelector('input[placeholder="e.g. Storyboard pass 1"]'), { target: { value: text } })
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }) }
const ASSET_FIELD = 'Asset (optional — narrows the task to one deliverable)'

describe('a new task from a row starts with that row\'s items, and its phase only from a phase row (VW1m)', () => {
  it('a combination row: both assets carried, read only, and sent to addTask as items; no phase from the row, the assets\' shared phase on save', async () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by asset')
    fireEvent.click(dropZone('grp-as-A|B'))
    expect(editorTitle()).toBe('New task')
    expect(fieldOf(ASSET_FIELD)).toBeNull()
    expect(fieldOf('Assets').textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(fieldOf('Phase').value).toBe('')
    typeTitle('Glaze the lamp')
    await save()
    expect(rabbit.current.addTask).toHaveBeenCalledTimes(1)
    const sent = rabbit.current.addTask.mock.calls[0][0]
    expect(sent.items).toEqual({ asset: ['A', 'B'] })
    expect(sent.phase_id).toBe('P1')
    for (const f of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) expect(f in sent, f).toBe(false)
  })
  it('a single asset row: that asset in its picker; No asset: none; never the project\'s first asset or first phase', async () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by asset')
    fireEvent.click(dropZone('C'))
    expect(fieldOf(ASSET_FIELD).value).toBe('C')
    expect(fieldOf('Phase').value).toBe('')
    typeTitle('Dock pass')
    await save()
    expect(rabbit.current.addTask.mock.calls[0][0]).toMatchObject({ items: { asset: ['C'] }, phase_id: 'P2' })
    fireEvent.click(dropZone('__noasset__'))
    expect(fieldOf(ASSET_FIELD).value).toBe('')
    expect(fieldOf('Phase').value).toBe('')
  })
  it('the toolbar\'s + Task: no asset, no phase — and nothing carried to addTask', async () => {
    rabbit.current = ctxFor()
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    expect(fieldOf(ASSET_FIELD).value).toBe('')
    expect(fieldOf('Phase').value).toBe('')
    typeTitle('Loose end')
    await save()
    const sent = rabbit.current.addTask.mock.calls[0][0]
    expect('items' in sent).toBe(false)
    expect(sent.phase_id).toBeNull()
  })
  it('grouped by phase: the phase row\'s phase, and no asset', () => {
    rabbit.current = ctxFor()
    mount()
    fireEvent.click(dropZone('P2'))
    expect(fieldOf('Phase').value).toBe('P2')
    expect(fieldOf(ASSET_FIELD).value).toBe('')
  })
  it('grouped by scene: a shot row gives its scene and shot; a combination of shots carries them read only', () => {
    rabbit.current = ctxFor({ tasks: sceneTasks, taskItems: sceneItems })
    mount()
    groupBy('Group by scene')
    fireEvent.click(dropZone('X2'))
    expect(fieldOf('Scene').value).toBe('S1')
    expect(fieldOf('Shot').value).toBe('X2')
    expect(fieldOf('Phase').value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(dropZone('grp-sh-X1|Y1'))
    expect(fieldOf('Scenes').textContent).toBe('Harbour, Lighthouse')
    expect(fieldOf('Shots').textContent).toBe('SH010, SH030')
  })
})

describe('a drop on a row gives the task that row\'s items (VW1m)', () => {
  // The grip in the label column: mousedown, a move past 3px, mouseup over
  // the target row (jsdom has no layout, so the point resolves to it).
  const dropOn = async (title, target) => {
    const at = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
    fireEvent.mouseDown(taskRowEl(title), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(window, { clientX: 40, clientY: 40 })
    await act(async () => { fireEvent.mouseUp(window, { clientX: 40, clientY: 40 }) })
    at.mockRestore()
  }
  if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null

  it('by asset: onto a combination, the task takes both assets; onto No asset, none; onto its own row, nothing is written', async () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by asset')
    await dropOn('Model the lantern', gutterRow('grp-as-A|B'))
    expect(rabbit.current.setTaskItemsOfKind).toHaveBeenLastCalledWith('t2', 'asset', ['A', 'B'])
    await dropOn('Model the lantern', gutterRow('__noasset__'))
    expect(rabbit.current.setTaskItemsOfKind).toHaveBeenLastCalledWith('t2', 'asset', [])
    const calls = rabbit.current.setTaskItemsOfKind.mock.calls.length
    await dropOn('Light the interior', gutterRow('grp-as-A|B'))
    expect(rabbit.current.setTaskItemsOfKind.mock.calls.length).toBe(calls)
    // Never a phase write by an asset's id (the defect: phase_id = the row's id).
    expect(rabbit.current.updateTask).not.toHaveBeenCalled()
  })
  it('an item the Timeline does not show is kept: an asset in the trash stays the task\'s (her Q-N4)', async () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by asset')
    await dropOn('Trashed partner', gutterRow('B'))
    expect(rabbit.current.setTaskItemsOfKind).toHaveBeenLastCalledWith('t6', 'asset', ['B', 'Z'])
  })
  it('by scene: onto a scene, its scene and no shot of the active list, in one undo step; a scene outside the active list is kept', async () => {
    rabbit.current = ctxFor({ tasks: sceneTasks, taskItems: sceneItems })
    mount()
    groupBy('Group by scene')
    await dropOn('On X1', gutterRow('S2'))
    expect(rabbit.current.runBatch).toHaveBeenCalledTimes(1)
    expect(rabbit.current.setTaskItemsOfKind.mock.calls).toEqual([['a', 'scene', ['S2']], ['a', 'shot', []]])
    rabbit.current.setTaskItemsOfKind.mockClear()
    await dropOn('On S1 and Cliff', gutterRow('S2'))
    expect(rabbit.current.setTaskItemsOfKind.mock.calls).toEqual([['g', 'scene', ['S2', 'S3']]])
  })
  it('by phase: the phase, as before; by team: nothing to drag (only a bar\'s dates move)', async () => {
    rabbit.current = ctxFor({ tasks: [{ id: 't9', title: 'Phased', phase_id: 'P1', start_date: '2026-10-02', end_date: '2026-10-04' }], taskItems: [] })
    mount()
    await dropOn('Phased', gutterRow('P2'))
    expect(rabbit.current.updateTask).toHaveBeenLastCalledWith('t9', { phase_id: 'P2' })
    expect(rabbit.current.setTaskItemsOfKind).not.toHaveBeenCalled()
    groupBy('Group by team member')
    rabbit.current.updateTask.mockClear()
    const target = gutterRow('__unassigned__')
    expect(taskRowEl('Phased').getAttribute('data-grab')).toBe('false')
    expect(taskRowEl('Phased').getAttribute('title')).toBe('Click to edit')
    await dropOn('Phased', target)
    expect(rabbit.current.updateTask).not.toHaveBeenCalled()
    expect(rabbit.current.setTaskItemsOfKind).not.toHaveBeenCalled()
  })
})

describe('headers that only group open nothing and never move as a phase (VW1m)', () => {
  const clickLabel = (text) => fireEvent.click([...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === text).parentElement)
  it('a combination, No asset, a scene, a level and Unassigned open nothing; an asset row opens its asset; a phase row Edit phase', () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by asset')
    clickLabel('Lighthouse Interior, Storm Lantern')
    clickLabel(NO_KIND_LABEL.asset)
    expect(editorTitle()).toBeNull()
    clickLabel('Dock')
    expect(editorTitle()).toBe('Edit asset')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    groupBy('Group by scene')
    clickLabel('Harbour')
    groupBy('Group by level')
    clickLabel('Dock')
    groupBy('Group by team member')
    clickLabel('Unassigned')
    expect(editorTitle()).toBeNull()
    // CONTROL: a phase still opens.
    groupBy('Group by phase')
    clickLabel('Build')
    expect(editorTitle()).toBe('Edit phase')
  })
  it('a level\'s bar is drawn with its dates and neither moves nor opens, and never reaches updatePhase', () => {
    rabbit.current = ctxFor()
    mount()
    groupBy('Group by level')
    const bar = document.querySelector('[data-row-bar="phase:L1"]')
    expect(bar).not.toBeNull()
    expect(bar.getAttribute('data-writable')).toBe('false')
    expect(bar.getAttribute('title')).toBe('Dock · 4.0d')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20, x: 0, y: 0 })
    fireEvent.mouseDown(bar, { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 166 })
    fireEvent.mouseUp(window, { clientX: 166 })
    expect(rabbit.current.updatePhase).not.toHaveBeenCalled()
    expect(rabbit.current.runBatch).not.toHaveBeenCalled()
    expect(editorTitle()).toBeNull()
  })
})

describe('the phase rule reaches the schedule, the minimap and a phase bar\'s drag (VW1m)', () => {
  // Build has no dates of its own: its bar is drawn from its tasks.
  const build = { id: 'P1', name: 'Build' }
  const tasks = [
    { id: 'shared', title: 'Shared phase', start_date: '2026-10-05', end_date: '2026-10-08' },
    { id: 'split', title: 'Split phases', start_date: '2026-10-05', end_date: '2026-10-20' },
  ]
  const items = [
    item('shared', 'asset', 'A'), item('shared', 'asset', 'B'),
    item('split', 'asset', 'A'), item('split', 'asset', 'C'),
  ]
  it('Build\'s bar spans the task its assets share it through, not the split one; its minimap count is 1; its drag moves that task alone', async () => {
    rabbit.current = ctxFor({ phases: [build, P2], tasks, taskItems: items })
    mount()
    const bar = document.querySelector('[data-row-bar="phase:P1"]')
    expect(bar.getAttribute('title')).toMatch(/^Build · 3\.0d · /)
    const mini = document.querySelector('[data-minimap-row="P1"] [data-minimap-bar], [data-minimap-row="P1"] [data-minimap-edge]')
    fireEvent.mouseEnter(mini, { clientX: 5, clientY: 5 })
    expect(document.querySelector('.rb-tl-pop-text')?.textContent).toBe('1 task')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20, x: 0, y: 0 })
    fireEvent.mouseDown(bar, { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 144 })
    await act(async () => { fireEvent.mouseUp(window, { clientX: 144 }) })
    expect(rabbit.current.runBatch).toHaveBeenCalledTimes(1)
    expect(rabbit.current.updateTask.mock.calls).toEqual([['shared', { start_date: '2026-10-07', end_date: '2026-10-10' }]])
    expect(rabbit.current.updatePhase).toHaveBeenCalledTimes(1)
  })
})

describe('a viewed bid version groups by its own snapshot\'s items (VW1m, Q-N7 interim)', () => {
  it('the items the view hands over; else each saved task\'s items; else, saved before, its single fields', () => {
    const handed = [item('v1', 'asset', 'A')]
    expect(versionTaskItems({ taskItems: handed, tasks: [] })).toBe(handed)
    const view = { tasks: [
      { id: 'v1', title: 'Saved with items', asset_id: 'A', items: { asset: ['A', 'B'], scene: [], shot: [], level: [], experience: [] } },
      { id: 'v2', title: 'Saved before', asset_id: 'C', scene_id: null },
    ] }
    const items = versionTaskItems(view)
    expect(items.map(i => [i.task_id, i.entity_type, i.entity_id])).toEqual([['v1', 'asset', 'A'], ['v1', 'asset', 'B'], ['v2', 'asset', 'C']])
    const rows = buildRowsByGrouping({
      groupBy: 'asset', phases: [], assets, tasks: view.tasks, schedule,
      itemLookup: buildItemLookup({ items, available: true, assets, scenes: [], shots: [], levels: [], experiences: [] }),
    })
    expect(under(rows, 'grp-as-A|B')).toEqual(['v1'])
    expect(under(rows, 'grp-as-C')).toEqual(['v2'])
  })
})
