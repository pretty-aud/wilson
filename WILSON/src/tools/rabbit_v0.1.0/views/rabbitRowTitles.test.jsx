/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul FX8 (Audrey, 2026-10-12): the tables' row buttons.
//
//   "right now the tasks and asset table use a page icon for the button to
//    open the details page for the item. but the scenes has an eye icon. lets
//    have uniformity ... lets move them all closer to the title of the items
//    in the tables ... also for the titles in tasks and assets the
//    cell/ssection for the title is sooo wide."
//
// Three things, each with a control:
//   1. the Tasks table MOUNTED (nothing rendered it before; its delete was
//      pinned on source): the row's buttons in the title cell right after
//      the words, in the one order — Open, the edit history, Delete — named
//      for the task, in the row's Tab order, and doing what they did; a key
//      date's Delete after its words; no actions column;
//   2. no R.A.B.B.I.T. table opens an item's window with the eye any more:
//      the page icon, named "Open <name>";
//   3. the title columns' widths, worked out from the sheets at 1024, 1280,
//      1440 and 1920: the title takes what the others leave up to its
//      maximum, the others take the rest past it, and no table's minimum
//      width grew (nothing new scrolls sideways).
// The other tables' rows are mounted in their own files
// (rabbitAssetsRender, rabbitEntityViewsRender, rabbitScenesRender,
// scenesEdits); the kit's RowTitle in src/ui/RowTitle.test.jsx.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { rulesOf, cssCode } from '../rabbitCssGuards'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
// The two windows a row opens, as markers: which task each was opened for.
vi.mock('../components/TaskDetailPopup', () => ({
  default: ({ taskId }) => <div role="dialog" aria-label={`task window ${taskId}`} />,
}))
vi.mock('../components/EditHistoryDrawer', () => ({
  default: ({ entityId }) => <div role="dialog" aria-label={`history ${entityId}`} />,
}))
const rabbit = vi.hoisted(() => ({ current: null }))
const perms = vi.hoisted(() => ({ current: null }))

const { default: ProjectTasksView } = await import('./ProjectTasksView')

const here = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(join(here, f), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => { cleanup(); _resetOverlaysForTests(); localStorage.clear() })

const TASKS = () => [
  { id: 't1', title: 'Lock the shooting script', status: 'final', priority: 'high', sort_order: 0 },
  { id: 't2', title: 'Scene numbering pass', status: 'in_progress', priority: 'low', sort_order: 1 },
]

function page({ writer = true, history = true } = {}) {
  perms.current = { role: writer ? 'admin' : 'user', ready: true, can: (k) => (k === 'rabbit.history.view' ? history : writer) }
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', start_date: '2026-08-03', end_date: '2026-12-18' },
    tasks: TASKS(),
    assets: [], phases: [], teamAssignments: [],
    milestones: [{ id: 'm1', project_id: 'p1', title: 'Picture lock', date: '2026-11-06', color: '#22c55e' }],
    myProjectRole: writer ? 'manager' : 'reviewer',
    projectIsStaffed: !writer,
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    deleteMilestone: vi.fn(),
    updateMilestone: vi.fn(),
  }
  rabbit.current = ctx
  render(<ProjectTasksView />)
  return ctx
}
const table = () => document.querySelector('table.ui-table.rb-task-table')
const rowOf = (title) => within(table()).getByRole('button', { name: `Select "${title}"` }).closest('tr')
const titles = (el) => [...el.querySelectorAll('.ui-row-title-acts button')].map((b) => b.title)

describe('FX8: the Tasks table, mounted — a row\'s buttons right after its title', () => {
  it('there is no actions column: Bid is the last header, and a row has a cell per header', () => {
    page()
    const heads = [...table().querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', 'Title', 'Status', 'Priority', 'Asset', 'Phase', 'Assignee', 'Start', 'End', 'Bid'])
    expect(rowOf('Lock the shooting script').querySelectorAll(':scope > td')).toHaveLength(heads.length)
  })

  it('the title cell is the words, then Open (the page icon), the edit history and Delete, each named for the task, in that order', () => {
    page()
    const cell = rowOf('Lock the shooting script').querySelector('td .ui-row-title')
    expect([...cell.children].map((c) => c.className)).toEqual(['ui-row-title-words', 'ui-hover-actions ui-row-title-acts'])
    expect(cell.querySelector('.ui-row-title-words').textContent).toBe('Lock the shooting script')
    expect(titles(cell)).toEqual(['Open Lock the shooting script', 'View edit history for Lock the shooting script', 'Delete Lock the shooting script'])
    const icons = [...cell.querySelectorAll('.ui-row-title-acts button svg')].map((s) => [...s.classList].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon'))
    expect(icons).toEqual(['lucide-file-text', 'lucide-history', 'lucide-trash2'])
    // The same 28px kit buttons as before (`size="sm"`), the delete the kit's danger.
    for (const b of cell.querySelectorAll('.ui-row-title-acts button')) expect(b.getAttribute('data-size')).toBe('sm')
    expect(within(cell).getByRole('button', { name: 'Delete Lock the shooting script' }).getAttribute('data-danger')).toBe('true')
  })

  it('in the row\'s Tab order the buttons come straight after the words and before Status', () => {
    page()
    const tabbable = [...rowOf('Lock the shooting script').querySelectorAll('button, select, input')]
      .filter((e) => !e.disabled)
      .map((e) => e.getAttribute('aria-label') || e.textContent.trim())
    expect(tabbable.slice(0, 6)).toEqual([
      'Select "Lock the shooting script"', 'Lock the shooting script',
      'Open Lock the shooting script', 'View edit history for Lock the shooting script', 'Delete Lock the shooting script',
      'Status',
    ])
  })

  it('each does what it did: Open opens that task\'s window, the history that task\'s history, and Delete deletes it as before (no version open, so no question)', () => {
    const ctx = page()
    fireEvent.click(screen.getByRole('button', { name: 'Open Scene numbering pass' }))
    expect(screen.getByRole('dialog', { name: 'task window t2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View edit history for Lock the shooting script' }))
    expect(screen.getByRole('dialog', { name: 'history t1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Scene numbering pass' }))
    expect(ctx.deleteTask).toHaveBeenCalledTimes(1)
    expect(ctx.deleteTask).toHaveBeenCalledWith('t2')
  })

  it('a key date\'s one button, Delete, sits right after its words; the project\'s bound start and end have none', () => {
    const ctx = page()
    const ms = [...table().querySelectorAll('tr.rb-task-ms')]
    const pic = ms.find((r) => r.textContent.includes('Picture lock'))
    expect(titles(pic.querySelector('.ui-row-title'))).toEqual(['Delete Picture lock'])
    fireEvent.click(within(pic).getByRole('button', { name: 'Delete Picture lock' }))
    expect(ctx.deleteMilestone).toHaveBeenCalledWith('m1')
    const bound = ms.filter((r) => r.textContent.includes('Bound'))
    expect(bound).toHaveLength(2)
    for (const r of bound) expect(r.querySelector('.ui-row-title-acts')).toBeNull()
    // No key date row has a cell past Bid either.
    for (const r of ms) expect(r.querySelectorAll(':scope > td')).toHaveLength(10)
  })

  it('a seat that may not write keeps Open (and the history), and has no Delete', () => {
    page({ writer: false })
    expect(titles(rowOf('Lock the shooting script').querySelector('.ui-row-title'))).toEqual(['Open Lock the shooting script', 'View edit history for Lock the shooting script'])
    cleanup()
    page({ writer: false, history: false })
    expect(titles(rowOf('Lock the shooting script').querySelector('.ui-row-title'))).toEqual(['Open Lock the shooting script'])
  })

  it('the Board\'s card names its two buttons the same way', () => {
    page()
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    expect(screen.getByRole('button', { name: 'Open Lock the shooting script' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Lock the shooting script' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View task details' })).toBeNull()
  })
})

/* ── 2. one icon opens an item's window ───────────────────────────────────── */
const TABLE_VIEWS = ['ProjectTasksView.jsx', 'ProjectAssetsView.jsx', 'ScenesView.jsx', 'EntityListView.jsx', 'scenes/EditTable.jsx']
/** The names a file gives the buttons that open an item's window. */
const openers = (src) => [...src.matchAll(/<IconButton[^>]*Icon=\{(\w+)\}[^>]*title=\{?[`'"]([^`'"]*)/g)]
  .filter(([, , title]) => /^(Open |View details|View task details|View asset details|Scene details)/.test(title))
  .map(([, icon, title]) => `${icon} ${title}`)

describe('FX8: one icon opens an item\'s window — the page icon, named "Open <name>"', () => {
  it('no table view imports or draws the eye, and every opener is the page icon named "Open …"', () => {
    for (const f of TABLE_VIEWS) {
      const src = read(f)
      expect(src, f).not.toMatch(/\bEye\b/)
      const found = openers(src)
      expect(found.length, f).toBeGreaterThan(0)
      for (const o of found) expect(o, f).toMatch(/^FileText Open \$\{/)
    }
  })
  it('CONTROL: the reader finds an eye opener, and an old name', () => {
    const scenes = read('ScenesView.jsx')
    const one = '<IconButton size="sm" Icon={FileText} title={`Open ${g.label}`}'
    expect(scenes).toContain(one)
    expect(openers(scenes.replace(one, '<IconButton size="sm" Icon={Eye} title="Scene details"'))).toContain('Eye Scene details')
  })
})

/* ── 3. the title columns, worked out from the sheets ─────────────────────── */
/** A width expression in px for a table whose scroller's content box is
    `W` px (the window less the scroller's 12px a side): every var()
    resolved against the wrap's declarations (an attribute rule's over
    them), `100cqw` the content box, calc/min/max/clamp worked out. */
function widthAt(sheet, wrapSel, W, extra = null) {
  const decls = (sel) => {
    const r = rulesOf(sheet).find(({ sel: s }) => s === sel)
    return r ? Object.fromEntries([...r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])) : {}
  }
  const own = { ...decls(wrapSel), ...(extra ? decls(extra) : {}) }
  const kit = cssCode(readFileSync(join(here, '../../../index.css'), 'utf8'))
  const kitToken = (p) => (kit.match(new RegExp(`(?:^|[\\s;{])${p}\\s*:\\s*([^;]+);`)) || [])[1]
  return (expr) => {
    let e = expr
    for (let i = 0; i < 30 && /var\(/.test(e); i++) e = e.replace(/var\((--[\w-]+)\)/g, (_, p) => `(${own[p] ?? kitToken(p)})`)
    expect(e, expr).not.toMatch(/var\(|undefined/)
    const js = e.replace(/(\d+(?:\.\d+)?)cqw/g, (_, n) => `(${n}*${W}/100)`)
      .replace(/clamp\(/g, '__clamp(').replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/min\(/g, 'Math.min(')
      .replace(/(\d+(?:\.\d+)?)px/g, '$1')
    return Function('__clamp', `return ${js}`)((a, v, b) => Math.min(Math.max(a, v), b))
  }
}
/** The auto title column in a fixed-layout table: what the table's width
    (the container, or the table's own minimum if that is wider) leaves.
    `sb` is a vertical scrollbar's width: it comes off the table's room but
    NOT off `100cqw`, which Chromium measures without it (review round 1,
    R1-02, measured: 1270px of scroller at 1280 with the app's 10px
    scrollbar while `100cqw` read 1256 less nothing). */
const SB = 10
const layout = (px, others, minWidth, W, sb = 0) => {
  const sum = others.reduce((n, o) => n + px(o), 0)
  const room = W - sb
  const tableW = Math.max(room, px(minWidth))
  return { title: tableW - sum, tableW, sideways: tableW > room }
}
const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(0.01)

describe('FX8: the title columns — the title takes what the others leave up to its maximum; the others the rest', () => {
  const tasks = read('rabbitTasks.css')
  const files = read('rabbitFiles.css')
  const TASK_COLS = ['var(--rb-task-col-check)', 'var(--rb-task-col-status)', 'var(--rb-task-col-priority)', 'var(--rb-task-col-asset)',
    'var(--rb-task-col-phase)', 'var(--rb-task-col-assignee)', 'var(--rb-task-col-date)', 'var(--rb-task-col-date)', 'var(--rb-task-col-bid)']
  const TASK_MIN = (rulesOf(tasks).find(({ sel }) => sel === '.rb-task-table').body.match(/min-width:\s*([^;]+);/) || [])[1]

  it('the view hands the Tasks header these widths, and the title none (it takes the rest)', () => {
    const src = read('ProjectTasksView.jsx')
    for (const v of ['status', 'priority', 'asset', 'phase', 'assignee', 'date', 'bid']) expect(src).toContain(`width: 'var(--rb-task-col-${v})'`)
    expect(src).toContain("{ key: 'title',       label: 'Title' },")
    expect(src).toContain('<Th width="var(--rb-task-col-check)" className="rb-task-check-cell">')
    expect(src).not.toMatch(/key: '_actions'/)
    // The scroller is the query container `100cqw` measures.
    expect(tasks).toMatch(/\.rb-task-table-wrap > \.ui-table-scroll \{ padding: 0 12px; container-type: inline-size; \}/)
  })

  it('Tasks: 274px at 1280 (264 while the list scrolls, and still no sideways scroll), its 360px maximum at 1440 and 1920 (350 while the list scrolls) with Asset, Phase and Assignee taking the rest, 262px and the old sideways scroll at 1024', () => {
    const at = (W, sb = 0) => { const px = widthAt(tasks, '.rb-task-table-wrap', W); return { px, ...layout(px, TASK_COLS, TASK_MIN, W, sb) } }
    const w1280 = at(1256)
    close(w1280.title, 274); expect(w1280.sideways).toBe(false)
    close(w1280.px('var(--rb-task-col-asset)'), 150)
    // R1-02: the app shows a 10px scrollbar on a list that scrolls; the
    // table (1244px at its narrowest) still fits the 1246px left.
    const s1280 = at(1256, SB)
    close(s1280.title, 264); expect(s1280.sideways).toBe(false)
    const w1440 = at(1416)
    close(w1440.title, 360); expect(w1440.sideways).toBe(false)
    close(w1440.px('var(--rb-task-col-asset)'), 150 + (1416 - 1342) / 3)
    close(w1440.px('var(--rb-task-col-phase)'), 124 + (1416 - 1342) / 3)
    close(at(1416, SB).title, 350)
    const w1920 = at(1896)
    close(w1920.title, 360)
    close(w1920.px('var(--rb-task-col-assignee)'), 124 + (1896 - 1342) / 3)
    const w1024 = at(1000, SB)
    close(w1024.title, 256); expect(w1024.sideways).toBe(true)
    // The table's minimum: 982 + a 256px title, 16px under the 1254 it was
    // (982 + the 72px actions column + a 200px title), which scrolled
    // sideways at 1280 while the list's scrollbar showed. Round 2 (R2-08):
    // room for any scrollbar up to 18px — Windows' classic one is 17.
    close(w1024.tableW, 1238)
    expect(at(1256, 17).sideways).toBe(false)
    expect(at(1256, 18).sideways).toBe(false)
  })
  it('CONTROL: the title\'s old minimums scroll sideways at 1280 beside a scrollbar — 272 beside the 10px one, 262 beside a 17px one', () => {
    const withMin = (n) => widthAt(tasks.replace(/--rb-task-title-min: 256px;/, `--rb-task-title-min: ${n}px;`), '.rb-task-table-wrap', 1256)
    expect(layout(withMin(272), TASK_COLS, TASK_MIN, 1256, SB).sideways).toBe(true)
    expect(layout(withMin(262), TASK_COLS, TASK_MIN, 1256, 17).sideways).toBe(true)
  })
  it('CONTROL: the arithmetic reads the sheet — without the spare share the title runs on past its maximum', () => {
    const px = widthAt(tasks.replace(/--rb-task-spare: [^;]+;/, '--rb-task-spare: 0px;'), '.rb-task-table-wrap', 1896)
    expect(layout(px, TASK_COLS, TASK_MIN, 1896).title).toBeGreaterThan(800)
  })

  const ASSET_COLS = ['var(--rb-asset-check)', 'var(--rb-asset-thumb)', 'var(--rb-asset-type)', 'var(--rb-asset-phase)', 'var(--rb-asset-status)',
    'var(--rb-asset-date)', 'var(--rb-asset-date)', 'var(--rb-asset-col-desc)', 'var(--rb-asset-tasks)']
  const ASSET_MIN = (rulesOf(files).find(({ sel }) => sel === '.rb-asset-table-wrap .ui-table.rb-asset-table').body.match(/min-width:\s*([^;]+);/) || [])[1]
  it('Assets: 292px at 1280, its 360px maximum at 1440 and 1920 with Description taking the rest; the minimum width unchanged with and without the history button', () => {
    const src = read('ProjectAssetsView.jsx')
    expect(src).toContain("width: 'var(--rb-asset-col-desc)'")
    expect(src).not.toMatch(/key: '_actions'/)
    const at = (W, history = true, sb = 0) => {
      const px = widthAt(files, '.rb-asset-table-wrap', W, history ? '.rb-asset-table-wrap[data-history="true"]' : null)
      return { px, ...layout(px, ASSET_COLS, ASSET_MIN, W, sb) }
    }
    close(at(1256).title, 292); expect(at(1256).sideways).toBe(false)
    // While the list scrolls (R1-02): 10px less, and still no sideways scroll.
    close(at(1256, true, SB).title, 282); expect(at(1256, true, SB).sideways).toBe(false)
    close(at(1416, true, SB).title, 350)
    close(at(1416).title, 360); close(at(1416).px('var(--rb-asset-col-desc)'), 180 + 1416 - 964 - 360)
    close(at(1896).title, 360)
    // Before: 964 + the actions column (72 with the history, 44 without) + a 200px name.
    close(at(1000).tableW, 964 + 72 + 200)
    close(at(1000, false).tableW, 964 + 44 + 200)
  })

  const ENT_COLS = ['var(--rb-ent-check)', 'var(--rb-ent-status)', 'var(--rb-ent-assets)', 'var(--rb-ent-tasks)', 'var(--rb-ent-desc)']
  const ENT_MIN = (rulesOf(files).find(({ sel }) => sel === '.rb-ent-table-wrap .ui-table.rb-ent-table').body.match(/min-width:\s*([^;]+);/) || [])[1]
  it('Levels and Experiences: the name at its 360px maximum from 1024 up, Description the rest; the minimum width unchanged', () => {
    const src = read('EntityListView.jsx')
    expect(src).toContain('<Th width="var(--rb-ent-desc)">Description</Th>')
    const at = (W) => { const px = widthAt(files, '.rb-ent-table-wrap', W); return { px, ...layout(px, ENT_COLS, ENT_MIN, W) } }
    for (const W of [1000, 1256, 1416, 1896]) close(at(W).title, 360)
    close(at(1416).px('var(--rb-ent-desc)'), 1416 - 36 - 152 - 72 - 64 - 360)
    expect(at(1000).sideways).toBe(false)
    // Before: two 160px text columns and a 72px actions column beside the 324px of the others.
    close(widthAt(files, '.rb-ent-table-wrap', 1000)(ENT_MIN), 36 + 152 + 72 + 64 + 72 + 160 * 2)
    // While the list scrolls (R1-02): the name 10px under its maximum.
    close(layout(widthAt(files, '.rb-ent-table-wrap', 1416), ENT_COLS, ENT_MIN, 1416, SB).title, 350)
  })
})

/* ── 4. the words fill their box (review round 1, R1-01) ─────────────────────
   A <button> sizes to its words, not to its box: the Assets name's button
   lost the flex parent that sized it and a long name ran under the row's
   buttons with no "…" (measured: 452px of button in a 250px box). Each
   lane's words element must take the kit's words box; the browser's check
   is scripts/fx8-shots.mjs's long-name pass. */
const WORDS = [
  // [sheet, the rule that sizes the words in a row's title, the width it must set]
  ['rabbitTasks.css', '.rb-task-cell-text', 'width: 100%;'],
  ['rabbitFiles.css', '.ui-row-title .rb-asset-cell-text', 'width: 100%;'],
  ['rabbitFiles.css', '.ui-row-title .rb-ent-cell-text', 'width: calc(100% + 6px);'],
]
const fills = (sheet, text = read(sheet)) => WORDS.filter(([f]) => f === sheet).map(([, sel, decl]) => {
  const r = rulesOf(text).find(({ sel: s }) => s === sel)
  return r && r.body.includes(decl) ? null : `${sel} { ${decl} }`
}).filter(Boolean)

describe('FX8 review round 1: every row title\'s words fill the kit\'s words box', () => {
  it('Tasks\', Assets\' and Levels\' words buttons take the box (the spans are blocks and take it anyway)', () => {
    expect(fills('rabbitTasks.css')).toEqual([])
    expect(fills('rabbitFiles.css')).toEqual([])
    // The scenes' words and an edit's are block spans.
    const scenes = read('rabbitScenes.css')
    expect(rulesOf(scenes).find(({ sel }) => sel === '.rb-scene-inline').body).toMatch(/display: block;/)
    expect(rulesOf(scenes).find(({ sel }) => sel === '.rb-scene-cut-name').body).toMatch(/display: block;/)
  })
  it('CONTROL: the sheet before the correction is caught', () => {
    const now = read('rabbitFiles.css')
    const before = now.replace('  .ui-row-title .rb-asset-cell-text { width: 100%; }', '')
    expect(before).not.toBe(now)
    expect(fills('rabbitFiles.css', before)).toEqual(['.ui-row-title .rb-asset-cell-text { width: 100%; }'])
  })
  it('a words button is never under the kit\'s 28px however short the name (R1-05), nor the scenes\' words span (R2-06); the Tasks title cell draws its rings inside the dense row (R1-08)', () => {
    const kit = cssCode(readFileSync(join(here, '../../../index.css'), 'utf8'))
    expect(kit).toMatch(/\.ui-row-title-words > button \{ min-width: var\(--control-sm\); \}/)
    expect(rulesOf(read('rabbitScenes.css')).find(({ sel }) => sel === '.rb-scene-name-cell .ui-row-title .rb-scene-inline').body).toMatch(/min-width: var\(--control-sm\);/)
    expect(read('rabbitTasks.css')).toMatch(/\.rb-task-table-wrap \.ui-table\.rb-task-table \.ui-row-title :focus-visible \{ outline-offset: -2px; \}/)
  })
})

/* ── 5. the bands (review rounds 1 and 2, R1-06, R2-04, R2-05) ───────────────
   The render tests see the DOM order; these pin the layout that puts a
   band's button right after its words. */
describe('FX8: a band\'s button sits right after its words, its runtime last', () => {
  const sheet = () => read('rabbitScenes.css')
  const body = (css, sel) => rulesOf(css).find(({ sel: s }) => s === sel)?.body || ''
  const pins = (css) => [
    /flex: 0 1 auto;/.test(body(css, '.rb-scene-group-head > .rb-scene-group-toggle,\n  .rb-scene-group-head > .rb-scene-cut-band-name')) || 'the words take only what they need',
    /padding-right: 6px;/.test(body(css, '.rb-scene-group-head > .rb-scene-group-toggle:has(+ .rb-scene-band-acts),\n  .rb-scene-group-head > .rb-scene-cut-band-name:has(+ .rb-scene-band-acts)')) || '6px after the words, then the kit\'s 4px',
    /flex: none;/.test(body(css, '.rb-scene-group-head > .ui-hover-actions.rb-scene-band-acts')) || 'the button never shrinks',
    /flex: 1 0 auto;/.test(body(css, '.rb-scene-band-rest')) || 'the rest takes the band and never shrinks under its runtime',
  ].filter((x) => x !== true)
  it('the rules hold', () => {
    expect(pins(sheet())).toEqual([])
  })
  it('CONTROL: each rule taken away is caught', () => {
    const css = sheet()
    expect(pins(css.replace('flex: 1 0 auto;', 'flex: 1 1 auto;'))).toEqual(['the rest takes the band and never shrinks under its runtime'])
    expect(pins(css.replace(/(\.rb-scene-group-head > \.rb-scene-cut-band-name:has\(\+ \.rb-scene-band-acts\) \{ )padding-right: 6px;/, '$1padding-right: 12px;'))).toEqual(['6px after the words, then the kit\'s 4px'])
    expect(pins(css.replace('.rb-scene-group-head > .rb-scene-cut-band-name { flex: 0 1 auto; }', '.rb-scene-group-head > .rb-scene-cut-band-name { flex: 1 1 auto; }'))).toEqual(['the words take only what they need'])
  })
})

/* ── 6. a screen that cannot hover (FX8-KR-2; review round 2, R2-01, R2-02) ──
   The kit shows every HoverActions at rest where nothing hovers. A lane
   rule that hides one again must say it is for a hovering screen, and a
   slot laid over a picture gives the picture back there. */
/** The text inside every `@media <query> { … }` block, comments out. */
const mediaBlocks = (css, query) => {
  const code = cssCode(css)
  const out = []
  let at = code.indexOf(`@media ${query}`)
  while (at >= 0) {
    let i = code.indexOf('{', at) + 1
    let depth = 1
    const start = i
    for (; i < code.length && depth; i++) { if (code[i] === '{') depth++; else if (code[i] === '}') depth-- }
    out.push(code.slice(start, i - 1))
    at = code.indexOf(`@media ${query}`, i)
  }
  return out
}
/** Lane rules that set a HoverActions slot's opacity to 0 outside `(hover: hover)`. */
const hidesOnTouch = (css) => {
  let rest = cssCode(css)
  for (const b of mediaBlocks(css, '(hover: hover)')) rest = rest.replace(b, '')
  return rulesOf(rest).filter(({ sel, body }) => /\.ui-hover-actions/.test(sel) && /opacity:\s*0\s*;/.test(body)).map(({ sel }) => sel)
}
describe('FX8: where nothing can hover, every row\'s buttons stay shown', () => {
  it('no FX8 table\'s sheet hides a HoverActions slot outside a hovering screen (the nested shots\' isolation is inside `(hover: hover)`)', () => {
    for (const f of ['rabbitScenes.css', 'rabbitFiles.css', 'rabbitTasks.css']) expect(hidesOnTouch(read(f)), f).toEqual([])
    expect(mediaBlocks(read('rabbitScenes.css'), '(hover: hover)').join('\n')).toMatch(/\.rb-scene-nest-row:hover \.rb-scene-nest-table \.ui-hover-actions/)
  })
  it('CONTROL: the nest\'s rule outside the media block is caught', () => {
    const css = read('rabbitScenes.css').replace('@media (hover: hover) {\n    .rb-scene-nest-row:hover', '@media (min-width: 1px) {\n    .rb-scene-nest-row:hover')
    expect(hidesOnTouch(css).length).toBe(1)
  })
  it('the item windows\' picture slots drop their scrim and sit in the picture\'s corner where nothing hovers', () => {
    const scenes = mediaBlocks(read('rabbitScenes.css'), '(hover: none)').join('\n')
    expect(scenes).toMatch(/\.ui-hover-actions\.rb-scene-detail-thumb-acts \{ inset: auto 6px 6px auto; background-color: transparent; \}/)
    const files = mediaBlocks(read('rabbitFiles.css'), '(hover: none)').join('\n')
    expect(files).toMatch(/\.ui-hover-actions\.rb-ent-thumb-acts \{ inset: auto 6px 6px auto; background-color: transparent; \}/)
  })
})
