/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c, step 1 — the Timeline's three changes, and nothing else:
//   1. group by scene draws EVERY task (D10 made `ctx.scenes` / `ctx.shots`
//      the active list's, and a task linked outside them fell out of the
//      Timeline). Audrey's rule of 2026-10-02 narrowed step 1: such a task
//      reads as not assigned ("No Scene", or under its own scene when only
//      its shot is outside), never under a scene brought back from another
//      list, and its tooltip says what it points at; each scene and shot
//      row's tooltip names its list;
//   2. the read-only "Shot list: Title · vN" beside the group selector (D18);
//   3. the undo keys act only while R.A.B.B.I.T. is the page on screen
//      (S4a-07), and stand down under the settings drawer.
// The rule's end-to-end form (real list operations, the Budget too) is
// state/listRemovalKeepsTasks.test.jsx.
// =============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rabbit = vi.hoisted(() => ({ current: {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))
// jsdom has no ResizeObserver; the panes measure themselves with one.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}

const { default: TimelineView, buildRowsByGrouping, loadRabbitSettings } = await import('./TimelineView.jsx')

afterEach(() => { cleanup() })
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

// The active list holds scene A and shot a1; Pickups holds scene B and its
// shot b1. One task on each shot, one on scene B alone, one on a shot that
// no longer exists, and one on a shot with no scene.
const sceneA = { id: 'A', name: 'Harbour', scene_number: 1 }
const sceneB = { id: 'B', name: 'Lighthouse', scene_number: 2 }
const a1 = { id: 'a1', scene_id: 'A', name: 'SC001_SH010', shot_number: 10 }
const b1 = { id: 'b1', scene_id: 'B', name: 'SC002_SH010', shot_number: 10 }
const loose = { id: 'l1', scene_id: null, name: 'Loose', shot_number: 1 }
const every = { A: sceneA, B: sceneB, a1, b1, l1: loose }
const tasks = [
  { id: 't1', title: 'Comp a1', shot_id: 'a1', scene_id: 'A' },
  { id: 't2', title: 'Comp b1', shot_id: 'b1', scene_id: 'B' },
  { id: 't3', title: 'Light B', scene_id: 'B' },
  { id: 't4', title: 'Gone', shot_id: 'zz' },
  { id: 't5', title: 'Loose one', shot_id: 'l1' },
]
const schedule = { tasks: {}, phases: {} }
const pickups = { id: 'L2', title: 'Pickups', version: 1 }
const shoot = { id: 'L1', title: 'Shoot', version: 2 }
const homeOf = (id) => {
  const lists = ['B', 'b1'].includes(id) ? [pickups] : [shoot]
  return { lists, title: (name) => `${name}\nIn: ${['B', 'b1'].includes(id) ? 'Pickups · v1' : 'Shoot · v2 (active)'}` }
}
const build = (over = {}) => buildRowsByGrouping({
  groupBy: 'scene', phases: [], assets: [], tasks, schedule,
  scenes: [sceneA], shots: [a1, loose],
  sceneById: (id) => every[id] || null, shotById: (id) => every[id] || null, homeOf,
  ...over,
})
const taskKeys = (rows) => rows.filter(r => r.kind === 'task').map(r => r.task.id).sort()
const under = (rows, key) => {
  const at = rows.findIndex(r => r.key === key)
  const out = []
  for (let i = at + 1; i < rows.length && !(rows[i].kind === 'phase' && rows[i].depth <= rows[at].depth); i += 1) {
    if (rows[i].kind === 'task') out.push(rows[i].task.id)
  }
  return out.sort()
}

describe('group by scene draws every task; one linked outside the active list reads as not assigned (S3c step 1, Audrey\'s rule of 2026-10-02)', () => {
  it('every task is on the Timeline, and the groups are the active list\'s alone: another list\'s scene and shot never join them', () => {
    const rows = build()
    expect(taskKeys(rows)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    const groups = rows.filter(r => r.kind === 'phase').map(r => r.label)
    expect(groups).toEqual(['Harbour', 'SC001_SH010', 'No scene in the active list'])
    expect(under(rows, 'grp-sh-a1')).toEqual(['t1'])
    // Pickups' scene and shot (t2, t3), a shot that is gone (t4) and a shot
    // with no scene (t5): not assigned, never dropped.
    expect(under(rows, 'grp-noscene')).toEqual(['t2', 't3', 't4', 't5'])
  })
  it('the link is kept: the task row still holds the task as stored, and says what it points at — its scene and shot, the lists that hold them', () => {
    const rows = build()
    const t2 = rows.find(r => r.key === 'tk-t2')
    expect(t2.task).toBe(tasks[1])
    expect(t2.task.scene_id).toBe('B')
    expect(t2.task.shot_id).toBe('b1')
    expect(t2.tooltip).toBe('Scene “Lighthouse”: in Pickups · v1, not in the active list\nShot “SC002_SH010”: in Pickups · v1, not in the active list')
    expect(rows.find(r => r.key === 'tk-t3').tooltip).toBe('Scene “Lighthouse”: in Pickups · v1, not in the active list')
    expect(rows.find(r => r.key === 'tk-t4').tooltip).toBe('Shot: no longer in the project')
    // In the active list, nothing to say: no tooltip of its own.
    expect(rows.find(r => r.key === 'tk-t1').tooltip).toBeUndefined()
    expect(rows.find(r => r.key === 'tk-t5').tooltip).toBeUndefined()
  })
  it('each scene and shot row carries its name and its list as a tooltip; "No Scene" and the drop zones carry none', () => {
    const rows = build()
    expect(rows.find(r => r.key === 'grp-sc-A').tooltip).toBe('Harbour\nIn: Shoot · v2 (active)')
    expect(rows.find(r => r.key === 'grp-sh-a1').tooltip).toBe('SC001_SH010\nIn: Shoot · v2 (active)')
    for (const r of rows.filter(x => x.kind === 'drop-zone' || x.key === 'grp-noscene')) expect(r.tooltip, r.key).toBeUndefined()
  })
  it('a task whose scene is in the active list but whose shot is not reads under its scene, saying where its shot is', () => {
    const rows = build({ tasks: [{ id: 't7', title: 'Comp b1 in A', scene_id: 'A', shot_id: 'b1' }] })
    expect(under(rows, 'grp-sc-A')).toEqual(['t7'])
    expect(under(rows, 'grp-sh-a1')).toEqual([])
    expect(rows.find(r => r.key === 'tk-t7').tooltip).toBe('Shot “SC002_SH010”: in Pickups · v1, not in the active list')
  })
  it('the scene back in the active list: the same task is under it again (nothing was written)', () => {
    const rows = build({ scenes: [sceneA, sceneB], shots: [a1, b1, loose] })
    expect(rows.filter(r => r.kind === 'phase').map(r => r.label)).toEqual(['Harbour', 'SC001_SH010', 'Lighthouse', 'SC002_SH010', 'No scene in the active list'])
    expect(under(rows, 'grp-sh-b1')).toEqual(['t2'])
    expect(rows.find(r => r.key === 'tk-t2').tooltip).toBeUndefined()
  })
  it('a row in no list says so; without the lookups a link reads as gone — still not assigned, still drawn', () => {
    const inNone = build({ homeOf: (id) => ({ lists: [], title: (n) => n }) })
    expect(inNone.find(r => r.key === 'tk-t3').tooltip).toBe('Scene “Lighthouse”: in no shot list')
    const bare = build({ sceneById: null, shotById: null, homeOf: null })
    expect(taskKeys(bare)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(bare.find(r => r.key === 'tk-t3').tooltip).toBe('Scene: no longer in the project')
  })
})

describe('the Timeline view: the shot-list label, and the undo keys\' page gate (S3c step 1)', () => {
  const ctxFor = (over = {}) => ({
    project: { id: 'p1', scenes_enabled: true },
    activeProjectId: 'p1',
    phases: [], assets: [], tasks: [], dependencies: [], scenes: [sceneA], shots: [a1], levels: [], experiences: [], milestones: [],
    teamAssignments: [],
    sceneById: (id) => every[id] || null, shotById: (id) => every[id] || null,
    shotLists: [{ id: 'L1', title: 'Shoot', version: 2 }], shotListItems: [], edits: [],
    activeShotList: { id: 'L1', title: 'Shoot', version: 2 },
    formatShotListLabel: (r) => `${r.title} · v${r.version}`,
    undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true,
    ...over,
  })
  const mount = (pageActive, extra = null) => render(<>{<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive={pageActive} />}{extra}</>)

  it('grouped by scene, the toolbar says which shot list the rows are; by phase it says nothing', () => {
    rabbit.current = ctxFor()
    mount(true)
    expect(document.querySelector('.rb-tl-shotlist')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
    const label = document.querySelector('.rb-tl-shotlist')
    expect(label?.textContent).toBe('Shot list: Shoot · v2')
    expect(label.tagName).toBe('SPAN') // words, not a control (S5 owns any picker)
    // S3c review round 1 (R1-08): the whole label leads its tooltip, since a
    // long one gives way to an ellipsis on the sheet.
    expect(label.getAttribute('title')).toMatch(/^Shot list: Shoot · v2\nThe scenes and shots grouped here are the active shot list's\./)
  })
  it('S3c R1-08: a long list title stops at the sheet\'s cap with an ellipsis, rather than wrapping the toolbar at 1280', () => {
    const css = read('./rabbitTimeline.css')
    const rule = css.slice(css.indexOf('.rb-tl-shotlist {'), css.indexOf('}', css.indexOf('.rb-tl-shotlist {')))
    for (const decl of ['max-width: 180px;', 'flex: 0 1 auto;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;', 'min-width: 0;']) expect(rule, decl).toContain(decl)
    // CONTROL: the reading fails without the cap.
    expect(rule.replace('max-width: 180px;', '')).not.toContain('max-width: 180px;')
  })
  it('grouped by scene, the gutter\'s scene and shot rows carry the tooltip that names the list (a task row keeps its own)', () => {
    rabbit.current = ctxFor({
      shotListItems: [{ id: 'i1', shot_list_id: 'L1', scene_id: 'A' }, { id: 'i2', shot_list_id: 'L1', shot_id: 'a1' }],
      project: { id: 'p1', scenes_enabled: true, active_shot_list_id: 'L1' },
      allShots: [a1, b1],
    })
    mount(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
    const row = [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === 'Harbour')?.parentElement
    expect(row?.getAttribute('title')).toBe('Harbour\nIn: Shoot · v2 (active)')
  })
  it('grouped by scene, a task linked outside the active list sits under "No Scene", and its row says first what it points at (the rule of 2026-10-02)', () => {
    rabbit.current = ctxFor({
      tasks: [{ id: 't3', title: 'Light B', scene_id: 'B', status: 'not_started' }],
      shotLists: [{ id: 'L1', title: 'Shoot', version: 2 }, { id: 'L2', title: 'Pickups', version: 1 }],
      shotListItems: [
        { id: 'i1', shot_list_id: 'L1', scene_id: 'A' }, { id: 'i2', shot_list_id: 'L1', shot_id: 'a1' },
        { id: 'i3', shot_list_id: 'L2', scene_id: 'B' }, { id: 'i4', shot_list_id: 'L2', shot_id: 'b1' },
      ],
      project: { id: 'p1', scenes_enabled: true, active_shot_list_id: 'L1' },
      allShots: [a1, b1],
    })
    mount(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
    const labels = [...document.querySelectorAll('.rb-tl-row-label')].map(n => n.textContent)
    expect(labels).toContain('No scene in the active list')
    expect(labels).not.toContain('Lighthouse')
    const row = [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === 'Light B')?.parentElement
    expect(row?.getAttribute('title')).toBe('Scene “Lighthouse”: in Pickups · v1, not in the active list\nClick to edit · drag to move to another phase')
  })
  it('no active list: no label', () => {
    rabbit.current = ctxFor({ activeShotList: null })
    mount(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
    expect(document.querySelector('.rb-tl-shotlist')).toBeNull()
  })
  it('S4a-07: on another page Ctrl+Z and Ctrl+Y do nothing and are not cancelled; on R.A.B.B.I.T. they undo and redo', () => {
    rabbit.current = ctxFor()
    const { rerender } = render(<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive={false} />)
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(true)
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    expect(rabbit.current.redo).not.toHaveBeenCalled()
    // CONTROL: the gate, not a broken handler.
    rerender(<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect(rabbit.current.undo).toHaveBeenCalledTimes(1)
    expect(rabbit.current.redo).toHaveBeenCalledTimes(1)
  })
  it('closed by default: a host that does not say R.A.B.B.I.T. is on screen gets no keys', () => {
    rabbit.current = ctxFor()
    render(<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} />)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
  })
  // S3c review round 1 (R1-05): R.A.B.B.I.T.'s Help (a reading-width kit
  // Dialog) over the Timeline, and a Ctrl+Z pressed in it undid a task's
  // priority underneath. A kit Dialog that is not the page's own stands the
  // keys down; the page's own window keeps them (C1).
  it('S3c R1-05: a kit Dialog over the page that is not its own stands the keys down; the page\'s own window keeps them', () => {
    rabbit.current = ctxFor()
    mount(true, <div className="ui-dialog-backdrop"><div className="ui-dialog" data-width="reading"><button type="button">Help topic</button></div></div>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Help topic' }), { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    expect(rabbit.current.redo).not.toHaveBeenCalled()
    cleanup()
    // The page's own window (the key dates' "Recently deleted") keeps them.
    rabbit.current = ctxFor({ listTrashedMilestones: async () => [] })
    mount(true)
    fireEvent.click(screen.getByTitle('Recently deleted key dates'))
    expect(document.querySelectorAll('.ui-dialog-backdrop')).toHaveLength(1)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).toHaveBeenCalledTimes(1)
  })
  it('S4a trap 10: the keys stand down under the settings drawer, focus in it or not', () => {
    rabbit.current = ctxFor()
    mount(true, <div className="ui-drawer-backdrop"><aside className="ui-drawer"><button type="button">Editable</button></aside></div>)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Editable' }), { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
  })
  it('Rabbit.jsx says it: the Timeline\'s pageActive is currentPage === \'rabbit\'', () => {
    expect(read('../Rabbit.jsx')).toContain("<TimelineView settings={settings} patchSettings={patchSettings} holidays={holidays} pageActive={currentPage === 'rabbit'} />")
  })
})
