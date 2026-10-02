/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c, step 1 — the Timeline's three changes, and nothing else:
//   1. group by scene resolves a task's link to a scene or shot that only
//      ANOTHER shot list holds (D10 made `ctx.scenes` / `ctx.shots` the active
//      list's, and such a task fell out of the Timeline), and each scene and
//      shot row's tooltip names its list;
//   2. the read-only "Shot list: Title · vN" beside the group selector (D18);
//   3. the undo keys act only while R.A.B.B.I.T. is the page on screen
//      (S4a-07), and stand down under the settings drawer.
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
const homeOf = (id) => ({ title: (name) => `${name}\nIn: ${['B', 'b1'].includes(id) ? 'Pickups · v1' : 'Shoot · v2 (active)'}` })
const build = (over = {}) => buildRowsByGrouping({
  groupBy: 'scene', phases: [], assets: [], tasks, schedule,
  scenes: [sceneA], shots: [a1, loose],
  sceneById: (id) => every[id] || null, shotById: (id) => every[id] || null, homeOf,
  ...over,
})
const taskKeys = (rows) => rows.filter(r => r.kind === 'task').map(r => r.task.id).sort()

describe('group by scene finds a row only another shot list holds (S3c step 1)', () => {
  it('every task is on the Timeline: another list\'s scene and shot join the groups; an unresolvable link and a shot with no scene go under "No Scene"', () => {
    const rows = build()
    expect(taskKeys(rows)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    const groups = rows.filter(r => r.kind === 'phase').map(r => r.label)
    expect(groups).toEqual(['Harbour', 'SC001_SH010', 'Lighthouse', 'SC002_SH010', 'No Scene'])
    const noScene = rows.findIndex(r => r.key === 'grp-noscene')
    expect(rows.slice(noScene).filter(r => r.kind === 'task').map(r => r.task.id).sort()).toEqual(['t4', 't5'])
  })
  it('each scene and shot row carries its name and its list as a tooltip; tasks and drop zones carry none', () => {
    const rows = build()
    expect(rows.find(r => r.key === 'grp-sc-B').tooltip).toBe('Lighthouse\nIn: Pickups · v1')
    expect(rows.find(r => r.key === 'grp-sh-a1').tooltip).toBe('SC001_SH010\nIn: Shoot · v2 (active)')
    for (const r of rows.filter(x => x.kind !== 'phase' || x.key === 'grp-noscene')) expect(r.tooltip, r.key).toBeUndefined()
  })
  it('a task linked to another list\'s SCENE alone (no shot) finds that scene too', () => {
    const sceneC = { id: 'C', name: 'Quay', scene_number: 3 }
    const rows = build({
      tasks: [{ id: 't6', title: 'Plan C', scene_id: 'C' }],
      sceneById: (id) => ({ ...every, C: sceneC }[id] || null),
    })
    expect(rows.filter(r => r.kind === 'phase').map(r => r.label)).toEqual(['Harbour', 'SC001_SH010', 'Quay'])
    const at = rows.findIndex(r => r.key === 'grp-sc-C')
    expect(rows[at + 1]?.task?.id).toBe('t6')
  })
  it('another list\'s rows WITHOUT tasks stay off (D10: the Timeline reads the active list)', () => {
    const rows = build({ tasks: tasks.filter(t => t.id === 't1') })
    expect(rows.filter(r => r.kind === 'phase').map(r => r.label)).toEqual(['Harbour', 'SC001_SH010'])
  })
  it('CONTROL: without the lookups another list\'s scene and shot are never grouped — their tasks fall back to "No Scene", the lookups are what place them', () => {
    const rows = build({ sceneById: null, shotById: null, homeOf: null })
    expect(rows.filter(r => r.kind === 'phase').map(r => r.label)).toEqual(['Harbour', 'SC001_SH010', 'No Scene'])
    const noScene = rows.findIndex(r => r.key === 'grp-noscene')
    expect(rows.slice(noScene).filter(r => r.kind === 'task').map(r => r.task.id).sort()).toEqual(['t2', 't3', 't4', 't5'])
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
