/** @vitest-environment jsdom */
// =============================================================================
// migrationPanelBins.test.jsx — BC3 (B9): the migration panel's question,
// "Which footage location is this?", rendered.
//
// What this pins:
//   * the panel takes the workspace from the permissions hook (the session's
//     claims; the dev fixtures' in a dev build), not a second session read;
//   * Migrate waits for a dry run, then for every root's answer, and its
//     title says why (no disabled control without its reason);
//   * each root the dry run found is one row: a network root starts from the
//     company's location that holds it or its share; a drive letter starts
//     empty and asks for the folder's network address;
//   * typing an address resolves it, in words, before anything is written —
//     an existing location by address, a new one (its name field appears),
//     the cloud's own refusal for an address it will not take;
//   * "Leave on this computer for now" answers a root without naming it;
//   * the real run is called with the answers, keyed by root;
//   * the report lists the clips left behind and says when pictures stayed.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'

const state = vi.hoisted(() => ({ perms: { workspaceId: 'ws1', ready: true, role: 'admin' }, reports: [], calls: [] }))
vi.mock('../../permissions', () => ({ usePermissions: () => state.perms }))
vi.mock('./runMigration', async (orig) => {
  const real = await orig()
  return { ...real, runMigration: vi.fn(async (opts) => { state.calls.push(opts); return state.reports.shift() }) }
})
vi.mock('../auth/supabaseClient', () => ({ supabase: {} }))

const { default: MigrationPanel, MIGRATE_TITLE, USE_THIS_ADDRESS, MIGRATE_AGAIN_LEFT, MIGRATE_DONE, NO_PATH_LEFT, ARCHIVE_KEEPS_NOT_CARRIED, MIGRATE_AGAIN_MONEY, MIGRATE_AGAIN_RECORD } = await import('./MigrationPanel')
const {
  runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF, ORPHAN_TAKES, NOT_CARRIED_SENTENCE,
  FILES_PLACED, ARCHIVED_IN_CLOUD, LIVE_IN_CLOUD, PROJECT_FOLDER_STAYS, KEY_DATES_TRASHED,
  COMMENTS_REMOVED, COMMENTS_ON_GONE_ROWS, ITEMS_ON_GONE_ROWS, FOLDERS_OF_GONE_ROWS, FOLDERS_TAKEN,
  STATUS_NOT_IN_CLOUD, KEY_DATES_PHASE_LET_GO, EDITS_CHAIN_TAKEN, FILE_LINKS_LET_GO, VALUES_NOT_IN_CLOUD,
  REMOVED_SINCE_LAST_RUN, MONEY_GATE_LEFT, ROW_LINKS_LET_GO, ACTUALS_ON_GONE_LINES, TASK_LINKS_ON_GONE_TASKS, RECEIPTS_GATED, SET_ASIDE_AGAIN, RECORD_NOT_KEPT,
  RECEIPTS_LEFT_OPEN, LINE_PCTS_LEFT_OUT, ACTUALS_TAKEN, RATES_TAKEN,
} = await import('./runMigration')
const { pathKey, ADDRESS_NEEDED, LOCATION_QUESTION, LEAVE_FOR_NOW, NAME_IT_INSTEAD, MIGRATE_WAITS } = await import('./binsMigration')

const bucket = (total = 0) => ({ total, inserted: 0, skipped: 0, failed: 0 })
const report = (over = {}) => ({
  dryRun: true, workspaceId: 'ws1',
  projects: bucket(1), phases: bucket(), assets: bucket(), tasks: bucket(), taskDependencies: bucket(), phaseLinks: bucket(), files: { ...bucket(), bytes: 0 },
  scenes: bucket(1), shots: bucket(2), bins: bucket(3), binLocations: bucket(), binFiles: { ...bucket(4), leftBehind: 0 }, shotTakes: { ...bucket(2), leftBehind: 0 },
  posters: { total: 3, uploaded: 0, skipped: 0, failed: 0, switchOff: 0 },
  footageRoots: [
    { root: '\\\\nas\\footage\\Day01', key: pathKey('\\\\nas\\footage\\Day01'), kind: 'unc', count: 3, projects: ['p1'], resolved: 'unanswered' },
    { root: 'D:\\Dailies', key: pathKey('D:\\Dailies'), kind: 'local', count: 1, projects: ['p1'], resolved: 'unanswered' },
  ],
  footageLocations: [{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
  clipsLeftBehind: [], remoteViewing: false, errors: [], startedAt: '', finishedAt: '',
  ...over,
})

beforeEach(() => { state.perms = { workspaceId: 'ws1', ready: true, role: 'admin' }; state.reports = []; state.calls = []; runMigration.mockClear() })
afterEach(cleanup)

const dryRun = async (r = report()) => {
  state.reports.push(r)
  render(<MigrationPanel />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dry-run' })) })
}
const rootRow = (root) => document.querySelector(`[data-footage-root="${root.replace(/\\/g, '\\\\')}"]`)
const migrate = () => screen.getByRole('button', { name: /^Migrat/ })

describe('the workspace and the gate on Migrate', () => {
  it('takes the workspace from the permissions hook; signed out, the panel says so', () => {
    state.perms = { workspaceId: null, ready: true }
    render(<MigrationPanel />)
    expect(document.body.textContent).toContain('Sign in to enable cloud migration')
    cleanup()
    state.perms = { workspaceId: 'ws1', ready: false }
    render(<MigrationPanel />)
    expect(document.body.textContent).toContain('Sign in to enable cloud migration')
    cleanup()
    state.perms = { workspaceId: 'ws1', ready: true, role: 'admin' }
    render(<MigrationPanel />)
    expect(screen.getByRole('button', { name: 'Dry-run' })).toBeTruthy()
    expect(document.body.textContent).toContain(MIGRATE_TITLE)
  })

  it('Migrate waits for a dry run, then for every root\'s answer, and says why', async () => {
    render(<MigrationPanel />)
    expect(migrate().disabled).toBe(true)
    expect(migrate().title).toMatch(/^Dry-run first/)
    cleanup()
    await dryRun()
    expect(migrate().disabled).toBe(true)
    expect(migrate().title).toBe(MIGRATE_WAITS)
    expect(screen.getByTestId('roots-progress').textContent).toBe('1 of 2 answered')
  })

  it('CONTROL: a dry run that found no root leaves Migrate open', async () => {
    await dryRun(report({ footageRoots: [] }))
    expect(migrate().disabled).toBe(false)
  })
})

describe('the question, once per root', () => {
  it('a network root starts from the company\'s location that holds it, said in words; a drive letter starts empty and asks for its network address', async () => {
    await dryRun()
    const nas = rootRow('\\\\nas\\footage\\Day01')
    expect(within(nas).getByText(LOCATION_QUESTION)).toBeTruthy()
    expect(nas.textContent).toContain('3 clips in 1 project · a share on the network')
    expect(within(nas).getByLabelText('Network address').value).toBe('\\\\nas\\footage')
    expect(within(nas).getByTestId('root-resolution').textContent).toBe('The company\'s "Footage NAS" (\\\\nas\\footage): 3 clips at Day01/….')
    expect(within(nas).queryByLabelText('Location name')).toBeNull()
    const d = rootRow('D:\\Dailies')
    expect(d.textContent).toContain('a folder on this computer: give its address as the network sees it')
    expect(within(d).getByLabelText('Network address').value).toBe('')
    expect(within(d).getByTestId('root-resolution').textContent).toMatch(/^Type the folder's network address/)
  })

  it('typing an address resolves it before anything is written: a new location shows its name field; the cloud\'s refusal is said in its words', async () => {
    await dryRun()
    const d = rootRow('D:\\Dailies')
    fireEvent.change(within(d).getByLabelText('Network address'), { target: { value: 'smb://nas/dailies/' } })
    fireEvent.blur(within(d).getByLabelText('Network address'))
    expect(within(d).getByLabelText('Network address').value).toBe('\\\\nas\\dailies')
    expect(within(d).getByTestId('root-resolution').textContent).toBe('A new location "Dailies" at \\\\nas\\dailies: 1 clip at its top.')
    fireEvent.change(within(d).getByLabelText('Location name'), { target: { value: 'Dailies on the NAS' } })
    expect(within(d).getByTestId('root-resolution').textContent).toContain('"Dailies on the NAS"')
    expect(screen.getByTestId('roots-progress').textContent).toBe('2 of 2 answered')
    expect(migrate().disabled).toBe(false)
    // Under the company's location: that location, the folder's path inside it.
    fireEvent.change(within(d).getByLabelText('Network address'), { target: { value: '\\\\nas\\footage\\dailies' } })
    expect(within(d).getByTestId('root-resolution').textContent).toBe('The company\'s "Footage NAS" (\\\\nas\\footage): 1 clip at dailies/….')
    // A drive letter is refused, in the cloud's words, and Migrate waits again.
    fireEvent.change(within(d).getByLabelText('Network address'), { target: { value: 'D:\\Dailies' } })
    expect(within(d).getByRole('alert').textContent).toBe(ADDRESS_NEEDED)
    expect(migrate().disabled).toBe(true)
  })

  it('"Leave on this computer for now" answers a root without naming it, and can be undone', async () => {
    await dryRun()
    const d = rootRow('D:\\Dailies')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: LEAVE_FOR_NOW })) })
    expect(within(d).queryByLabelText('Network address')).toBeNull()
    expect(within(d).getByTestId('root-resolution').textContent).toBe('Left on this computer: 1 clip stays, listed in the report; a later run brings it once this folder is named.')
    expect(migrate().disabled).toBe(false)
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: NAME_IT_INSTEAD })) })
    expect(within(d).getByLabelText('Network address')).toBeTruthy()
    expect(migrate().disabled).toBe(true)
  })

  it('the real run is called with the answers, keyed by root; a run that left clips here offers no archive, keeps the question and says to Migrate again', async () => {
    await dryRun()
    const d = rootRow('D:\\Dailies')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: LEAVE_FOR_NOW })) })
    const left = report({ dryRun: false, binFiles: { ...bucket(4), inserted: 3, leftBehind: 1 }, shotTakes: { ...bucket(2), inserted: 1, leftBehind: 1 }, clipsLeftBehind: [{ projectId: 'p1', id: 'e1', name: 'odd', root: 'D:\\Dailies' }], posters: { total: 3, uploaded: 0, skipped: 0, failed: 0, switchOff: 3 } })
    state.reports.push(left)
    await act(async () => { fireEvent.click(migrate()) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'ws1', dryRun: false,
      locations: {
        [pathKey('\\\\nas\\footage\\Day01')]: expect.objectContaining({ unc_path: '\\\\nas\\footage', skip: false }),
        [pathKey('D:\\Dailies')]: expect.objectContaining({ skip: true }),
      },
    }))
    // The report: the clips left behind, listed, with their takes; the pictures that stayed, said.
    expect(screen.getByTestId('clips-left-behind').textContent).toContain(`${BINS_LEFT_BEHIND(1)}, with 1 take of theirs.`)
    expect(screen.getByTestId('clips-left-behind').textContent).toContain('odd · D:\\Dailies')
    expect(screen.getByTestId('posters-switch-off').textContent).toContain(`3 pictures: ${POSTERS_SWITCH_OFF}`)
    expect(document.querySelector('.s-table').textContent).toContain('clips')
    expect(document.querySelector('.s-table').textContent).toContain('footage locations')
    expect(document.querySelector('.s-table').textContent).toContain('pictures')
    // Review round 1 (High): a clip left on this computer is the only copy —
    // no "Archive and clear local" while any is; the question stays, so the
    // root can be named and Migrate pressed again.
    expect(screen.queryByRole('button', { name: /Archive and clear local/ })).toBeNull()
    expect(migrate().disabled).toBe(false)
    expect(migrate().title).toBe(MIGRATE_AGAIN_LEFT(1))
    expect(rootRow('D:\\Dailies')).toBeTruthy()
    await act(async () => { fireEvent.click(within(rootRow('D:\\Dailies')).getByRole('button', { name: NAME_IT_INSTEAD })) })
    fireEvent.change(within(rootRow('D:\\Dailies')).getByLabelText('Network address'), { target: { value: '\\\\nas\\dailies' } })
    state.reports.push(report({ dryRun: false, binFiles: { ...bucket(4), inserted: 1, skipped: 3, leftBehind: 0 } }))
    await act(async () => { fireEvent.click(migrate()) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({ locations: expect.objectContaining({ [pathKey('D:\\Dailies')]: expect.objectContaining({ unc_path: '\\\\nas\\dailies', skip: false }) }) }))
    // CONTROL: a clean run with nothing left offers the archive, and says it is done.
    expect(screen.getByRole('button', { name: /Archive and clear local/ })).toBeTruthy()
    expect(migrate().disabled).toBe(true)
    expect(migrate().title).toBe(MIGRATE_DONE)
  })

  // Review round 1 (security): a new company location is made only from an
  // address the person confirmed — a share suggested from a project file is
  // not an answer until "Use this address" or a typed one.
  it('a share suggested as a NEW location waits for "Use this address"; the run never receives a suggestion nobody touched', async () => {
    await dryRun(report({
      footageRoots: [{ root: '\\\\other\\dailies\\Day01', key: pathKey('\\\\other\\dailies\\Day01'), kind: 'unc', count: 2, projects: ['p1'], resolved: 'unanswered' }],
      footageLocations: [],
    }))
    const row = rootRow('\\\\other\\dailies\\Day01')
    expect(row.getAttribute('data-resolved')).toBe('suggested')
    expect(within(row).getByLabelText('Network address').value).toBe('\\\\other\\dailies')
    expect(within(row).getByTestId('root-resolution').textContent).toBe(`Suggested: A new location "Dailies" at \\\\other\\dailies: 2 clips at Day01/…. ${USE_THIS_ADDRESS}, or type another.`)
    expect(screen.getByTestId('roots-progress').textContent).toBe('0 of 1 answered')
    expect(migrate().disabled).toBe(true)
    // Dry-run again: the suggestion is not sent.
    state.reports.push(report({ footageRoots: [], footageLocations: [] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dry-run' })) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({ locations: {} }))
  })

  it('"Use this address" confirms the suggestion; so does typing', async () => {
    await dryRun(report({
      footageRoots: [{ root: '\\\\other\\dailies\\Day01', key: pathKey('\\\\other\\dailies\\Day01'), kind: 'unc', count: 2, projects: ['p1'], resolved: 'unanswered' }],
      footageLocations: [],
    }))
    const row = rootRow('\\\\other\\dailies\\Day01')
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: USE_THIS_ADDRESS })) })
    expect(row.getAttribute('data-resolved')).toBe('new')
    expect(within(row).queryByRole('button', { name: USE_THIS_ADDRESS })).toBeNull()
    expect(screen.getByTestId('roots-progress').textContent).toBe('1 of 1 answered')
    expect(migrate().disabled).toBe(false)
    state.reports.push(report({ dryRun: false, footageRoots: [] }))
    await act(async () => { fireEvent.click(migrate()) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({ locations: { [pathKey('\\\\other\\dailies\\Day01')]: expect.objectContaining({ unc_path: '\\\\other\\dailies', confirmed: true }) } }))
  })

  // Review round 2: leaving the field, tabbing through the row, "Leave for
  // now" and "Name it" confirmed a suggestion as well — and the button sat
  // after the fields, so a keyboard never reached it before it vanished.
  it('leaving the field, "Leave for now", "Name it" and typing the NAME alone confirm nothing: the button stays, and the run receives no suggestion', async () => {
    await dryRun(report({
      footageRoots: [{ root: '\\\\other\\dailies\\Day01', key: pathKey('\\\\other\\dailies\\Day01'), kind: 'unc', count: 2, projects: ['p1'], resolved: 'unanswered' }],
      footageLocations: [],
    }))
    const row = rootRow('\\\\other\\dailies\\Day01')
    const address = within(row).getByLabelText('Network address')
    await act(async () => { address.focus(); address.blur() })
    fireEvent.blur(address)
    expect(row.getAttribute('data-resolved')).toBe('suggested')
    fireEvent.change(within(row).getByLabelText('Location name'), { target: { value: 'Our dailies' } })
    expect(row.getAttribute('data-resolved')).toBe('suggested')
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: LEAVE_FOR_NOW })) })
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: NAME_IT_INSTEAD })) })
    expect(row.getAttribute('data-resolved')).toBe('suggested')
    expect(within(row).getByTestId('root-resolution').textContent).toMatch(/^Suggested: A new location "Our dailies"/)
    expect(screen.getByTestId('roots-progress').textContent).toBe('0 of 1 answered')
    expect(migrate().disabled).toBe(true)
    // The button comes after the fields in the row, so Tab reaches it.
    const controls = [...row.querySelectorAll('input, button')]
    expect(controls.indexOf(within(row).getByRole('button', { name: USE_THIS_ADDRESS }))).toBeGreaterThan(controls.indexOf(within(row).getByLabelText('Network address')))
    state.reports.push(report({ footageRoots: [], footageLocations: [] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dry-run' })) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({ locations: {} }))
  })

  it('a suggestion nobody touched is replaced by the company\'s answer when a teammate names the share meanwhile; a typed answer is kept (review round 2)', async () => {
    const roots = [
      { root: '\\\\other\\dailies\\Day01', key: pathKey('\\\\other\\dailies\\Day01'), kind: 'unc', count: 2, projects: ['p1'], resolved: 'unanswered' },
      { root: 'D:\\Dailies', key: pathKey('D:\\Dailies'), kind: 'local', count: 1, projects: ['p1'], resolved: 'unanswered' },
    ]
    await dryRun(report({ footageRoots: roots, footageLocations: [] }))
    fireEvent.change(within(rootRow('D:\\Dailies')).getByLabelText('Network address'), { target: { value: '\\\\nas\\dailies' } })
    expect(screen.getByTestId('roots-progress').textContent).toBe('1 of 2 answered')
    // Dry-run again: the share is one of the company's now.
    state.reports.push(report({ footageRoots: roots, footageLocations: [{ id: 'L9', name: 'Their dailies', unc_path: '\\\\other\\dailies' }] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dry-run' })) })
    const row = rootRow('\\\\other\\dailies\\Day01')
    expect(row.getAttribute('data-resolved')).toBe('existing')
    expect(within(row).getByTestId('root-resolution').textContent).toBe('The company\'s "Their dailies" (\\\\other\\dailies): 2 clips at Day01/….')
    expect(within(rootRow('D:\\Dailies')).getByLabelText('Network address').value).toBe('\\\\nas\\dailies')
    expect(screen.getByTestId('roots-progress').textContent).toBe('2 of 2 answered')
    expect(migrate().disabled).toBe(false)
    state.reports.push(report({ dryRun: false, footageRoots: [] }))
    await act(async () => { fireEvent.click(migrate()) })
    expect(runMigration).toHaveBeenLastCalledWith(expect.objectContaining({ locations: {
      [pathKey('\\\\other\\dailies\\Day01')]: expect.objectContaining({ unc_path: '\\\\other\\dailies' }),
      [pathKey('D:\\Dailies')]: expect.objectContaining({ unc_path: '\\\\nas\\dailies', confirmed: true }),
    } }))
  })

  it('the last report and the question stay on screen while a run is on, and the pressed button says so (review round 2)', async () => {
    await dryRun()
    let resolve
    state.reports.push(new Promise((r) => { resolve = r }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dry-run' })) })
    expect(screen.getByRole('button', { name: 'Running…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Migrate' })).toBeTruthy()
    expect(rootRow('D:\\Dailies')).toBeTruthy()
    expect(document.querySelector('.s-table')).toBeTruthy()
    await act(async () => { resolve(report({ footageRoots: [] })) })
    expect(screen.getByRole('button', { name: 'Dry-run' })).toBeTruthy()
    expect(rootRow('D:\\Dailies')).toBeNull()
    state.reports.push(new Promise((r) => { resolve = r }))
    await act(async () => { fireEvent.click(migrate()) })
    expect(screen.getByRole('button', { name: 'Migrating…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dry-run' })).toBeTruthy()
    await act(async () => { resolve(report({ dryRun: false, footageRoots: [] })) })
    expect(migrate().title).toBe(MIGRATE_DONE)
  })

  it('what the migration does not carry is listed under the report before the archive is offered — a later run\'s apart from what no migration carries — and the archive button says so; an orphan take is one line, no error', async () => {
    await dryRun(report({ dryRun: false, footageRoots: [], notCarried: [{ key: 'teamAssignments', label: 'team assignments', count: 12, later: true }, { key: 'assetVersions', label: 'asset versions', count: 2, later: true }, { key: 'thumbnails', label: 'scene, shot, level and experience pictures', count: 3, later: false }], shotTakes: { ...bucket(2), inserted: 2, leftBehind: 0, orphans: 1 } }))
    expect(screen.getByTestId('not-carried').textContent).toBe('Stays on this computer for now (a later run of the migration carries it): 12 team assignments, 2 asset versions. Stays on this computer (the migration does not carry it): 3 scene, shot, level and experience pictures. Archive and clear local keeps a copy in the archive file only.')
    // CONTROL: one group only says one sentence.
    expect(NOT_CARRIED_SENTENCE([{ count: 1, label: 'asset version' }])).toBe('Stays on this computer (the migration does not carry it): 1 asset version. Archive and clear local keeps a copy in the archive file only.')
    expect(screen.getByTestId('orphan-takes').textContent).toBe(`${ORPHAN_TAKES(1)}.`)
    expect(screen.getByRole('button', { name: /Archive and clear local/ }).title).toBe(ARCHIVE_KEEPS_NOT_CARRIED)
    expect(migrate().title).toBe(MIGRATE_DONE)
  })

  it('M1, M2: the rows sit in the runner\'s order — key dates after phases, levels and experiences before the assets, the dependencies and links on tasks after the tasks, comments, lists with their items and edits after the shots, folders, files, then the budget', async () => {
    await dryRun(report({
      footageRoots: [],
      milestones: { ...bucket(3), trashed: 0 }, comments: { ...bucket(6), trashed: 0, orphans: 0, leftBehind: 0 },
      levels: bucket(4), experiences: bucket(3), taskLinks: { ...bucket(3), orphans: 0 },
      shotLists: { ...bucket(2), archived: 1 }, shotListItems: { ...bucket(29), orphans: 0 }, edits: { ...bucket(3), archived: 1 },
      folders: { ...bucket(40), orphans: 0, taken: 0 },
      budgetVersions: bucket(2), budgetLines: bucket(35), budgetActuals: { ...bucket(4), orphans: 0 }, expenses: bucket(3), rateOverrides: bucket(1),
    }))
    const labels = [...document.querySelectorAll('table.s-table tbody tr td:first-child')].map(td => td.textContent)
    expect(labels.slice(0, 23)).toEqual(['projects', 'phases', 'key dates', 'levels', 'experiences', 'assets', 'tasks', 'task dependencies', 'phase links', 'links on tasks', 'comments', 'scenes', 'shots', 'shot lists', 'items on shot lists', 'edits', 'folders', 'files', 'bid versions', 'budget lines', 'actuals', 'expenses', 'role rates'])
    const row = (label) => [...document.querySelectorAll('table.s-table tbody tr')].find(tr => tr.firstChild.textContent === label)
    expect([...row('items on shot lists').children].map(td => td.textContent)).toEqual(['items on shot lists', '29', '0', '0', '0'])
    expect([...row('budget lines').children].map(td => td.textContent)).toEqual(['budget lines', '35', '0', '0', '0'])
    // M2: a task's dependencies and its links are two rows, never one name.
    expect(labels).not.toContain('task links')
    // CONTROL: a report from before M1 (no such buckets) shows none of the rows.
    cleanup()
    await dryRun(report({ footageRoots: [] }))
    const before = [...document.querySelectorAll('table.s-table tbody tr td:first-child')].map(td => td.textContent)
    for (const l of ['key dates', 'comments', 'shot lists', 'items on shot lists', 'edits', 'folders', 'levels', 'links on tasks', 'bid versions', 'budget lines']) expect(before, l).not.toContain(l)
  })

  it('M2: the lines part 2 adds — the rows an earlier run carried that the cloud no longer shows, each named; a budget the money gate keeps here; receipts behind the gate; the open version\'s rows set aside; links let go; actuals and links on removed rows; the record not kept — only when it happened', async () => {
    await dryRun(report({
      dryRun: false, footageRoots: [],
      files: { ...bucket(35), bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 1 },
      removed: { byTable: { tasks: 2, bin_files: 1 }, rows: [{ projectId: 'p1', table: 'tasks', id: 't1', name: 'Grade' }, { projectId: 'p1', table: 'tasks', id: 't2', name: 'Mix' }, { projectId: 'p1', table: 'bin_files', id: 'c1', name: 'A001_C001' }] },
      moneyLeft: { projects: 1, rows: 12, receipts: 2 }, setAside: 3, rowLinksLetGo: 2, recordKept: false,
      budgetActuals: { ...bucket(4), orphans: 1 }, taskLinks: { ...bucket(3), orphans: 2 },
    }))
    const said = (id) => screen.getByTestId(id).textContent
    expect(said('removed-since-last-run')).toBe(`${REMOVED_SINCE_LAST_RUN('2 tasks, 1 clip')}.GradeMixA001_C001`)
    expect(REMOVED_SINCE_LAST_RUN('2 tasks, 1 clip')).toBe('Removed in the cloud since an earlier run, so not carried again: 2 tasks, 1 clip')
    expect(said('money-gate-left')).toBe(`${MONEY_GATE_LEFT(1, 12)}.`)
    expect(MONEY_GATE_LEFT(1, 12)).toBe("1 project's budget (12 rows, with its receipts) stays on this computer: in the cloud only a workspace admin or the project's manager sees its budget, and you are neither (a workspace admin can make you the project's manager; then run again)")
    expect(said('receipts-gated')).toBe(`${RECEIPTS_GATED(1)}.`)
    expect(said('set-aside-again')).toBe(`${SET_ASIDE_AGAIN(3)}.`)
    expect(said('row-links-let-go')).toBe(`${ROW_LINKS_LET_GO(2)}.`)
    expect(said('actuals-on-gone-lines')).toBe(`${ACTUALS_ON_GONE_LINES(1)}.`)
    expect(said('task-links-on-gone-tasks')).toBe(`${TASK_LINKS_ON_GONE_TASKS(2)}.`)
    expect(said('record-not-kept')).toBe(`${RECORD_NOT_KEPT('the desktop did not take it')}.`)
    // CONTROL: a run where none of it happened says none of it.
    cleanup()
    await dryRun(report({ dryRun: false, footageRoots: [], files: { ...bucket(3), bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 0 }, removed: { byTable: {}, rows: [] }, moneyLeft: { projects: 0, rows: 0, receipts: 0 }, setAside: 0, rowLinksLetGo: 0, recordKept: true }))
    for (const id of ['removed-since-last-run', 'money-gate-left', 'receipts-gated', 'set-aside-again', 'row-links-let-go', 'actuals-on-gone-lines', 'task-links-on-gone-tasks', 'record-not-kept']) expect(screen.queryByTestId(id), id).toBeNull()
  })

  it('M2 review round 1 (H1): a run that left a budget here, or could not keep its record, is not Done — no archive (it would clear the only copy), and Migrate says why', async () => {
    const clean = { dryRun: false, footageRoots: [], files: { ...bucket(3), bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 0 }, removed: { byTable: {}, rows: [] }, setAside: 0, rowLinksLetGo: 0 }
    const archive = () => screen.queryByRole('button', { name: /Archive and clear local/ })
    await dryRun(report({ ...clean, moneyLeft: { projects: 1, rows: 12, receipts: 2 }, recordKept: true }))
    expect(archive()).toBeNull()
    expect(migrate().title).toBe(MIGRATE_AGAIN_MONEY(1))
    expect(migrate().disabled).toBe(false)
    cleanup()
    await dryRun(report({ ...clean, moneyLeft: { projects: 0, rows: 0, receipts: 0 }, recordKept: false }))
    expect(archive()).toBeNull()
    expect(migrate().title).toBe(MIGRATE_AGAIN_RECORD)
    // CONTROL: neither — Done, and the archive is offered.
    cleanup()
    await dryRun(report({ ...clean, moneyLeft: { projects: 0, rows: 0, receipts: 0 }, recordKept: true }))
    expect(archive()).not.toBeNull()
    expect(migrate().title).toBe(MIGRATE_DONE)
    expect(MIGRATE_AGAIN_MONEY(2)).toBe("2 projects' budgets are still on this computer, so it keeps its copy: once a workspace admin makes you each project's manager, Migrate again.")
  })

  it('M2 review round 1: the lines it adds — receipts open in the cloud, a line\'s own percentage left out, actuals and role rates whose place is taken — only when it happened', async () => {
    await dryRun(report({
      dryRun: false, footageRoots: [],
      files: { ...bucket(3), bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 0, receiptsOpen: 1 },
      budgetLines: { ...bucket(4), pctsLeftOut: 2 }, budgetActuals: { ...bucket(4), orphans: 0, taken: 1 }, rateOverrides: { ...bucket(1), taken: 1 },
    }))
    const said = (id) => screen.getByTestId(id).textContent
    expect(said('receipts-left-open')).toBe(`${RECEIPTS_LEFT_OPEN(1)}.`)
    expect(RECEIPTS_LEFT_OPEN(1)).toBe('1 receipt an earlier run carried as an ordinary file is open to every member of the project in the cloud: the migration cannot put it behind the money gate yet (a workspace admin can remove it there, and no later run brings it back)')
    expect(said('line-pcts-left-out')).toBe(`${LINE_PCTS_LEFT_OUT(2)}.`)
    expect(said('actuals-taken')).toBe(`${ACTUALS_TAKEN(1)}.`)
    expect(said('rates-taken')).toBe(`${RATES_TAKEN(1)}.`)
    cleanup()
    await dryRun(report({ dryRun: false, footageRoots: [], files: { ...bucket(3), bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 0, receiptsOpen: 0 }, budgetLines: { ...bucket(4), pctsLeftOut: 0 }, budgetActuals: { ...bucket(4), orphans: 0, taken: 0 }, rateOverrides: { ...bucket(1), taken: 0 } }))
    for (const id of ['receipts-left-open', 'line-pcts-left-out', 'actuals-taken', 'rates-taken']) expect(screen.queryByTestId(id), id).toBeNull()
  })

  it('M1: one line each under the report for what the five kinds and the project rows did beside the counts, only when it happened', async () => {
    await dryRun(report({
      dryRun: false, footageRoots: [],
      files: { ...bucket(35), bytes: 0, placed: 31, linksLetGo: 2 },
      milestones: { ...bucket(3), trashed: 1, phaseLetGo: 1 }, comments: { ...bucket(6), trashed: 2, orphans: 3, leftBehind: 0 },
      shotLists: { ...bucket(2), archived: 1 }, shotListItems: { ...bucket(29), orphans: 4 }, edits: { ...bucket(3), archived: 1, taken: 2 },
      folders: { ...bucket(40), orphans: 5, taken: 1 },
      projectsLeftAtHome: { folders: 2, statuses: { wrapped: 2, draft: 1 }, withValues: 2, values: { 'targeted budget total': 1, director: 2 } }, liveInCloud: 1,
    }))
    const said = (id) => screen.getByTestId(id).textContent
    expect(said('files-placed')).toBe(`${FILES_PLACED(31)}.`)
    expect(said('archived-in-cloud')).toBe(`${ARCHIVED_IN_CLOUD(1, 1, false)}.`)
    expect(said('archived-in-cloud')).toBe('1 shot list and 1 edit archived in the cloud too, as on this computer.')
    expect(said('live-in-cloud')).toBe(`${LIVE_IN_CLOUD(1)}.`)
    expect(said('project-folders')).toBe(`${PROJECT_FOLDER_STAYS(2)}.`)
    expect(said('key-dates-trashed')).toBe(`${KEY_DATES_TRASHED(1)}.`)
    expect(said('comments-removed')).toBe(`${COMMENTS_REMOVED(2)}.`)
    expect(said('comments-on-gone-rows')).toBe(`${COMMENTS_ON_GONE_ROWS(3)}.`)
    expect(said('items-on-gone-rows')).toBe(`${ITEMS_ON_GONE_ROWS(4)}.`)
    expect(said('folders-of-gone-rows')).toBe(`${FOLDERS_OF_GONE_ROWS(5)}.`)
    expect(said('folders-taken')).toBe(`${FOLDERS_TAKEN(1)}.`)
    // Review round 1: the statuses summed over the projects, each named once;
    // the key dates without their phase; the edits whose place is taken; the
    // files' links let go.
    expect(said('project-statuses')).toBe(`${STATUS_NOT_IN_CLOUD(3, ['wrapped', 'draft'])}.`)
    expect(said('project-statuses')).toBe('3 projects have a status the cloud does not have (wrapped, draft): they arrive as active.')
    expect(said('key-dates-phase-let-go')).toBe(`${KEY_DATES_PHASE_LET_GO(1)}.`)
    expect(said('edits-chain-taken')).toBe(`${EDITS_CHAIN_TAKEN(2)}.`)
    expect(said('file-links-let-go')).toBe(`${FILE_LINKS_LET_GO(2)}.`)
    // Review round 2: the values the cloud cannot hold, each named once.
    expect(said('project-values')).toBe(`${VALUES_NOT_IN_CLOUD(2, ['targeted budget total', 'director'])}.`)
    expect(said('project-values')).toBe('2 projects have values the cloud cannot hold (targeted budget total, director): left out, so the field is empty or at the cloud\'s default.')
    // CONTROL: a run where none of it happened says none of it.
    cleanup()
    await dryRun(report({ dryRun: false, footageRoots: [], milestones: { ...bucket(3), trashed: 0, phaseLetGo: 0 }, edits: { ...bucket(3), archived: 0, taken: 0 }, files: { ...bucket(3), bytes: 0, placed: 0, linksLetGo: 0 }, folders: { ...bucket(4), orphans: 0, taken: 0 }, projectsLeftAtHome: { folders: 0, statuses: {}, withValues: 0, values: {} } }))
    for (const id of ['files-placed', 'archived-in-cloud', 'live-in-cloud', 'project-folders', 'project-statuses', 'project-values', 'key-dates-trashed', 'key-dates-phase-let-go', 'edits-chain-taken', 'file-links-let-go', 'comments-removed', 'comments-on-gone-rows', 'items-on-gone-rows', 'folders-of-gone-rows', 'folders-taken']) expect(screen.queryByTestId(id), id).toBeNull()
    // A report from before round 1 (no statuses) says no status either.
    cleanup()
    await dryRun(report({ dryRun: false, footageRoots: [], projectsLeftAtHome: { folders: 0 } }))
    expect(screen.queryByTestId('project-statuses')).toBeNull()
    expect(screen.queryByTestId('project-values')).toBeNull()
  })

  it('M1: the dry run says the archives are still to come; Done names what a later run carries and, since M2, that a second run brings nothing back', async () => {
    await dryRun(report({ footageRoots: [], shotLists: { ...bucket(2), archived: 1 }, edits: { ...bucket(3), archived: 1 } }))
    expect(screen.getByTestId('archived-in-cloud').textContent).toBe('1 shot list and 1 edit archived on this computer: archived in the cloud too, once carried.')
    // Only what there is: no "0 edits".
    expect(ARCHIVED_IN_CLOUD(2, 0, false)).toBe('2 shot lists archived in the cloud too, as on this computer')
    // M2: the record of what each run carried — nothing a teammate removed comes back.
    expect(MIGRATE_DONE).toBe('Done. Running it again writes nothing already in the cloud and brings back nothing a teammate removed there since: this computer keeps a record of every row the migration carried. The team, asset versions and the files kept with assets, scenes, shots, levels and experiences on this computer move in a later run of the migration.')
    expect(MIGRATE_DONE).not.toMatch(/comes back|part 2/)
    expect(ARCHIVE_KEEPS_NOT_CARRIED).toMatch(/a later run of the migration carries/)
    expect(ARCHIVE_KEEPS_NOT_CARRIED).toMatch(/records of its files and intake runs/)
    expect(ARCHIVE_KEEPS_NOT_CARRIED).toMatch(/its record of what each run carried/)
  })

  it('a clip with no path recorded gets its own sentence on Migrate: there is no question to send the person to (review round 2)', async () => {
    await dryRun(report({ dryRun: false, footageRoots: [], binFiles: { ...bucket(2), inserted: 1, leftBehind: 1 }, clipsLeftBehind: [{ projectId: 'p1', id: 'g', name: 'ghost', root: null }], errors: [{ scope: 'bin_file', id: 'g', message: 'ghost: no path recorded, so it was left on this computer' }] }))
    expect(migrate().title).toBe(NO_PATH_LEFT(1))
    expect(screen.queryByRole('button', { name: /Archive and clear local/ })).toBeNull()
    expect(screen.getByTestId('clips-left-behind').textContent).toContain('ghost')
  })

  it('every root\'s field has its own id, whatever its punctuation', async () => {
    await dryRun(report({
      footageRoots: [
        { root: 'D:\\a b', key: pathKey('D:\\a b'), kind: 'local', count: 1, projects: ['p1'], resolved: 'unanswered' },
        { root: 'D:\\a_b', key: pathKey('D:\\a_b'), kind: 'local', count: 1, projects: ['p1'], resolved: 'unanswered' },
      ],
    }))
    const ids = [...document.querySelectorAll('[data-footage-root] input[aria-label="Network address"]')].map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(document.querySelector(`label[for="${id}"]`)).toBeTruthy()
  })
})
