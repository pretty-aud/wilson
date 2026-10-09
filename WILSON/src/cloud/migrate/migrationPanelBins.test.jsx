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

const { default: MigrationPanel, MIGRATE_TITLE, USE_THIS_ADDRESS, MIGRATE_AGAIN_LEFT, MIGRATE_DONE } = await import('./MigrationPanel')
const { runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF } = await import('./runMigration')
const { pathKey, ADDRESS_NEEDED, LOCATION_QUESTION, LEAVE_FOR_NOW, NAME_IT_INSTEAD, MIGRATE_WAITS } = await import('./binsMigration')

const bucket = (total = 0) => ({ total, inserted: 0, skipped: 0, failed: 0 })
const report = (over = {}) => ({
  dryRun: true, workspaceId: 'ws1',
  projects: bucket(1), phases: bucket(), assets: bucket(), tasks: bucket(), taskLinks: bucket(), phaseLinks: bucket(), files: { ...bucket(), bytes: 0 },
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
