/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c, step 1 — the Timeline's three changes, and nothing else:
//   1. group by scene draws EVERY task (D10 made `ctx.scenes` / `ctx.shots`
//      the active list's, and a task linked outside them fell out of the
//      Timeline). Audrey's rule of 2026-10-02 narrowed step 1: such a task
//      reads as not assigned ("No scene in the active list", or under its own scene when only
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
// Post-overhaul S5d: the bid version bar's rate hooks (only the room test
// below opens the money gate), stable.
const rateHooks = vi.hoisted(() => ({ card: { entries: [], rateCards: [], settled: true, loading: false }, overrides: { overrides: [], loading: false } }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => rateHooks.card }))
vi.mock('../../../components/Budget/useProjectRateOverrides', () => ({ useProjectRateOverrides: () => rateHooks.overrides }))
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
  it('each scene and shot row carries its name and its list as a tooltip; "No scene in the active list" and the drop zones carry none', () => {
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

// Post-overhaul S5d: a VIEWED bid version points at the assets, levels,
// experiences and people of its day, some gone since. Every grouping still
// draws every task (S3c's rule: never dropped) and says where a link is gone.
// Group by team had dropped one already, live: a task assigned to someone
// the roster knows but the project's team does not hold was bucketed under a
// member no group row is drawn for.
describe('S5d: every grouping draws every task, and a link to a row no longer in the project says so', () => {
  const sched = { tasks: {}, phases: {} }
  const keys = (rows) => rows.filter(r => r.kind === 'task').map(r => r.task.id).sort()
  it('group by team: a task whose assignee is not on the team reads under Unassigned, saying who — never dropped', () => {
    const rows = buildRowsByGrouping({
      groupBy: 'team', phases: [], assets: [], schedule: sched,
      tasks: [
        { id: 'tA', title: 'On the team', assignee_id: 'mA' },
        { id: 'tB', title: 'Left the team', assignee_id: 'mB' },
        { id: 'tC', title: 'Nobody knows', assignee_id: 'mZ' },
        { id: 'tD', title: 'Nobody', assignee_id: null },
      ],
      teamAssignments: [{ member_id: 'mA' }],
      teamMembers: [{ id: 'mA', name: 'Ana' }, { id: 'mB', name: 'Bo' }],
    })
    expect(keys(rows)).toEqual(['tA', 'tB', 'tC', 'tD'])
    expect(under(rows, 'grp-tm-mA')).toEqual(['tA'])
    expect(under(rows, 'grp-tm-unassigned')).toEqual(['tB', 'tC', 'tD'])
    const tip = (id) => rows.find(r => r.key === `tk-${id}`).tooltip
    expect([tip('tB'), tip('tC'), tip('tD'), tip('tA')]).toEqual([
      'Assignee “Bo”: not on this project\'s team', 'Assignee: no longer in the project', undefined, undefined,
    ])
  })
  it('group by asset, level and experience: a link to one the project no longer has reads under No …, saying so; no link says nothing', () => {
    const tasks = [
      { id: 't1', title: 'Gone', asset_id: 'aZ', level_id: 'lZ', experience_id: 'xZ' },
      { id: 't2', title: 'Here', asset_id: 'a1', level_id: 'l1', experience_id: 'x1' },
      { id: 't3', title: 'None' },
    ]
    const base = { phases: [], schedule: sched, tasks, assets: [{ id: 'a1', name: 'Boat' }], levels: [{ id: 'l1', name: 'Dock' }], experiences: [{ id: 'x1', name: 'Tour' }] }
    for (const [groupBy, none, word] of [['asset', 'grp-as-noasset', 'Asset'], ['level', 'grp-nolevel', 'Level'], ['experience', 'grp-noexp', 'Experience']]) {
      const rows = buildRowsByGrouping({ ...base, groupBy })
      expect(keys(rows), groupBy).toEqual(['t1', 't2', 't3'])
      expect(under(rows, none), groupBy).toEqual(['t1', 't3'])
      expect(rows.find(r => r.key === 'tk-t1').tooltip, groupBy).toBe(`${word}: no longer in the project`)
      expect(rows.find(r => r.key === 'tk-t3').tooltip, groupBy).toBeUndefined()
    }
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
  // S3c R1-08, and review round 2 (R2-04): the cap is the room the toolbar
  // leaves, which each Group-by tab past four (Levels, Experiences) takes
  // 38px of. MEASURED in Chromium at 1280x700: 198px with four tabs, 160
  // with five, 122 with six (where the fixture's own 124px label wrapped
  // the toolbar under round 1's flat 180px); 160px more at 1440.
  const ROOM = { 1280: { 4: 198, 5: 160, 6: 122 }, 1440: { 4: 358, 5: 320, 6: 282 } }
  const capRule = () => {
    const css = read('./rabbitTimeline.css')
    return css.slice(css.indexOf('.rb-tl-shotlist {'), css.indexOf('}', css.indexOf('.rb-tl-shotlist {')))
  }
  // The sheet's max-width, read as the browser would for a window width and a tab count.
  const capAt = (rule, vw, tabs) => {
    const m = rule.match(/max-width: max\((\d+)px, calc\(100vw - (\d+)px - \(var\(--rb-tl-group-tabs, 4\) - 4\) \* (\d+)px\)\);/)
    if (!m) return null
    const [, floor, less, perTab] = m.map(Number)
    return Math.max(floor, vw - less - (tabs - 4) * perTab)
  }
  it('S3c R1-08 / R2-04: a long list title stops at the sheet\'s cap with an ellipsis, under the room the toolbar leaves at 1280 and 1440 with four, five or six Group-by tabs', () => {
    const rule = capRule()
    for (const decl of ['flex: 0 1 auto;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;', 'min-width: 0;']) expect(rule, decl).toContain(decl)
    for (const vw of [1280, 1440]) {
      for (const tabs of [4, 5, 6]) {
        const cap = capAt(rule, vw, tabs)
        expect(cap, `${vw} / ${tabs} tabs`).not.toBeNull()
        expect(cap, `${vw} / ${tabs} tabs`).toBeLessThan(ROOM[vw][tabs])
        expect(cap, `${vw} / ${tabs} tabs`).toBeGreaterThanOrEqual(96)
      }
    }
    // Round 1's four-tab reading is kept: 180px at 1280.
    expect(capAt(rule, 1280, 4)).toBe(180)
  })
  // Post-overhaul S5d: the bid version control comes out of no one's room.
  // MEASURED in Chromium on the fixtures (S5d, before and after): this row
  // has 18px left at 1280 with six tabs and the label, 116 grouped by phase
  // with four, 158 at 1440 with six — and the smallest version control that
  // says "● Unsaved" and saves is about 290px. So it is the toolbar's SECOND
  // row (DetailZoomToolbar's `versionBar`), and this row keeps every control
  // S3c measured — re-measured after, each the same width to the pixel. The
  // 1100px above is unchanged; this holds that it stays true.
  it('S5d: the bid version bar is the toolbar\'s second row, never in the row the label\'s cap measures', () => {
    rabbit.current = ctxFor({ project: { id: 'p1', scenes_enabled: true, levels_enabled: true, experiences_enabled: true, budget_active: false }, budgetVersions: [] })
    render(<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive canSeeMoney />)
    fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
    const toolbar = document.querySelector('.ui-toolbar')
    const bar = document.querySelector('.rb-tl-ver-bar')
    expect(bar).not.toBeNull()
    expect(toolbar.contains(bar)).toBe(false)
    expect(toolbar.nextElementSibling).toBe(bar)
    expect(toolbar.querySelector('select, .rb-tl-shotlist + *:not(.rb-tl-tb-sep)')).toBeNull()
    // The source says it: the bar renders after the Toolbar closes.
    expect(read('./TimelineView.jsx')).toMatch(/<\/Toolbar>\n\s*\{versionBar\}/)
  })
  it('CONTROL: round 1\'s flat 180px cap fails the six-tab room (and five), and a cap that ignores the tabs fails six', () => {
    const flat = capRule().replace(/max-width: max\([^;]*\);/, 'max-width: max(180px, calc(100vw - 1100px - (var(--rb-tl-group-tabs, 4) - 4) * 0px));')
    expect(capAt(flat, 1280, 6)).not.toBeLessThan(ROOM[1280][6])
    expect(capAt(flat, 1280, 5)).not.toBeLessThan(ROOM[1280][5])
    const noTabs = capRule().replace('* 38px', '* 0px')
    expect(capAt(noTabs, 1280, 6)).not.toBeLessThan(ROOM[1280][6])
  })
  it('S3c R2-04: the label carries the number of Group-by tabs beside it — four, five with Levels, six with Experiences too', () => {
    for (const [over, n] of [[{}, '4'], [{ levels_enabled: true }, '5'], [{ levels_enabled: true, experiences_enabled: true }, '6']]) {
      rabbit.current = ctxFor({ project: { id: 'p1', scenes_enabled: true, ...over } })
      mount(true)
      fireEvent.click(screen.getByRole('tab', { name: 'Group by scene' }))
      expect(document.querySelectorAll('[role="tablist"][aria-label="Group by"] [role="tab"]')).toHaveLength(Number(n))
      expect(document.querySelector('.rb-tl-shotlist').style.getPropertyValue('--rb-tl-group-tabs'), n).toBe(n)
      cleanup()
    }
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
  it('grouped by scene, a task linked outside the active list sits under "No scene in the active list", and its row says first what it points at (the rule of 2026-10-02)', () => {
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
  // Review round 2 (R2-02): the task popup counted by its id kept the keys
  // live under Help once Ctrl+Z had taken its task back (the popup draws
  // nothing then). It counts only while its task is there.
  it('S3c R2-02: the task popup is the page\'s own only while its task is there; one whose task went no longer keeps the keys live under Help', () => {
    const phase = { id: 'ph1', name: 'Shoot', start_date: '2026-10-01', end_date: '2026-10-10' }
    const task = { id: 't9', title: 'Grade the doorway', phase_id: 'ph1', status: 'not_started', start_date: '2026-10-02', end_date: '2026-10-03' }
    const help = <div className="ui-dialog-backdrop"><div className="ui-dialog" data-width="reading"><button type="button">Help topic</button></div></div>
    const view = (extra = null) => <>{<TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive />}{extra}</>
    const openPopup = () => {
      const row = [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === 'Grade the doorway')?.parentElement
      expect(row, 'the task\'s row').toBeTruthy()
      fireEvent.click(row)
    }
    // CONTROL first: the task there, its popup open (mocked: it draws its
    // Dialog as the stand-in backdrop) — the page's own, so the keys act.
    rabbit.current = ctxFor({ phases: [phase], tasks: [task] })
    const first = render(view())
    openPopup()
    first.rerender(view(help))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).toHaveBeenCalledTimes(1)
    cleanup()
    // The task taken back while its popup was open: Help is not the page's own.
    rabbit.current = ctxFor({ phases: [phase], tasks: [task] })
    const { rerender } = render(view())
    openPopup()
    rabbit.current = ctxFor({ phases: [phase], tasks: [] })
    rerender(view(help))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Help topic' }), { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    // …and the stale id is let go: the task brought back does not re-open it.
    rabbit.current = ctxFor({ phases: [phase], tasks: [task] })
    rerender(view(help))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
  })
  // Review round 2 (R2-05): the window's close question (App's own, marked
  // data-app-question) is a dialog over the page to the keys too.
  it('S3c R2-05: under the window\'s close question the keys stand down (CONTROL: the same element without the mark does not)', () => {
    rabbit.current = ctxFor()
    mount(true, <div data-app-question="close"><div role="dialog" aria-modal="true"><button type="button">Keep editing</button></div></div>)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect(rabbit.current.undo).not.toHaveBeenCalled()
    expect(rabbit.current.redo).not.toHaveBeenCalled()
    cleanup()
    rabbit.current = ctxFor()
    mount(true, <div><div role="dialog" aria-modal="true"><button type="button">Keep editing</button></div></div>)
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
  it('Rabbit.jsx says it: the Timeline\'s pageActive is currentPage === \'rabbit\' (and, S5d, its canSeeMoney the gate the Budget tab is hidden by)', () => {
    const shell = read('../Rabbit.jsx')
    expect(shell).toContain("<TimelineView settings={settings} patchSettings={patchSettings} holidays={holidays} pageActive={currentPage === 'rabbit'} canSeeMoney={canSeeMoney} />")
    // Post-overhaul S5d (F10): the one predicate, canSeeMoneyHere, decides
    // both the Budget tab and the Timeline's bid version bar.
    expect(shell).toMatch(/const canSeeMoney = canSeeMoneyHere\(\{/)
    expect(shell).toContain("if (!canSeeMoney) hidden.add('budget')")
  })
})
