/** @vitest-environment jsdom */
// =============================================================================
// volatileState.rerender.test.jsx — who draws when R.A.B.B.I.T.'s own clocks
// tick (F4, 2026-11-13; the review's rabbit C1 and shared-client C4).
//
// The measurement and the pin are one test (the brief's list item 1c): the
// REAL provider on the dev fixtures with the REAL R.A.B.B.I.T. shell under it
// (its tab strip, the Assets tab, the project bar with the faces, the
// connection dot, the ingestion toast) and the app's undo toast, as App.jsx
// mounts them. Then, one at a time and with nothing in the project changed:
// a presence heartbeat (the same people, a new list, as the channel sends
// it), a status flip (the live channel errors), an ingestion tick (one more
// chunk done), an undo toast taken down, and the adapter going offline. After
// each, the render spy says which components ran and which of them read the
// provider's one value.
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; every
// pin below red). The shell on the Assets tab over the fixture project (15
// asset rows) holds seven readers of the value: the shell, the project bar,
// the Assets tab, the connection dot, the ingestion toast, the undo toast and
// the bystander. Each event was ONE commit in which all seven ran, and with
// them everything they draw:
//
//   a presence heartbeat      574 component renders (52 kinds)
//   a status flip             574
//   an ingestion tick         580 (54 kinds)
//   the undo toast taken down 539 (14 rows by then: the toast was a delete's)
//   the adapter going offline 539
//
// MEASURED AFTER (the commit that moved the eight out of the value; every pin
// green), the same mount and the same events:
//
//   a presence heartbeat      2: the provider and the faces
//   a status flip             4: the provider, the faces, the dot and its mark
//   an ingestion tick         8: the provider, the toast and its five icons
//   the undo toast taken down 2: the provider and the toast
//   the adapter going offline 3: the provider, the dot and its mark
//
// WHAT REMAINS, measured in the last describe below and recorded in
// docs/OUTSTANDING.md: the value is still one object, so a WRITE to the open
// project is a new value for every reader. That is rabbit C1's other half and
// not this session's.
// =============================================================================
import { renderSpy } from '../../../lib/renderSpy'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { cleanup, act, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null, auth: null, progress: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb) => { (holder.auth ||= []).push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => ({ data: { session: null } }),
    },
  },
  hydrateSupabase: async () => {},
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
// A run that reports through the test and never ends: one tick is one call of holder.progress.
vi.mock('../intake/pipeline', () => ({
  runIngestion: vi.fn(({ onProgress }) => { holder.progress = onProgress; return new Promise(() => {}) }),
}))
const PERMS = { role: 'admin', ready: true, can: () => true, userId: 'u-1', workspaceId: 'w-1', offline: false }
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => PERMS }))
vi.mock('../../../agent', () => ({ useAgent: () => null }))
const ROSTER = { members: [], loading: false, error: null }
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ROSTER }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => ROSTER }))
const TEMPLATES = { templates: [], loadProjectTemplates: async () => [] }
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => TEMPLATES }))
// The Dashboard's three tab bodies and its directory read are not this file's
// subject: the strip in its header is. (Nothing in the R.A.B.B.I.T. shell
// mounted above reads the directory: its roster hook is stood in for.)
vi.mock('../../../components/Dashboard/DashboardTasksView', () => ({ default: function DashboardTasksView() { return null } }))
vi.mock('../../../components/Dashboard/NotesView', () => ({ default: function NotesView() { return null } }))
vi.mock('../../../components/settings/ProfileSection', () => ({ default: function ProfileSection() { return null } }))
const DIRECTORY = { members: [], reload: () => {} }
vi.mock('../../../components/TeamMembers/useWorkspaceMembers', async (importOriginal) => ({ ...(await importOriginal()), useWorkspaceMembers: () => DIRECTORY }))

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { useRabbitProjects } = await import('./rabbitLive')
const { useExpenses } = await import('../../../components/Expenses/useExpenses')
const { default: Rabbit } = await import('../Rabbit.jsx')
const { default: DashboardPage } = await import('../../../components/Dashboard/DashboardPage')
const { default: UndoToast } = await import('../components/UndoToast')
const { ToastProvider } = await import('../../../ui')
const { _resetOverlaysForTests } = await import('../../../ui/overlay')

let ctx = null
// A reader of the one value that shows none of the volatile state: every page's consumer, in small.
function Bystander() { ctx = useRabbit(); return <i data-project={ctx?.project?.id || ''} /> }

const PEOPLE = [
  { user_id: 'u-2', label: 'Mara Lind' },
  { user_id: 'u-3', label: 'Ines Okoro' },
]
const live = { project: null, workspace: null }

async function mount() {
  const fx = buildDevFixtures()
  const adapter = fx.rabbitAdapter()
  // The two channels, held by the test: it sends what Realtime would.
  adapter.subscribeProjectChanges = (_projectId, _onEvent, opts = {}) => { live.project = opts; return () => {} }
  adapter.subscribeWorkspaceChanges = (_workspaceId, _onEvent, opts = {}) => { live.workspace = opts; return () => {} }
  holder.adapter = adapter
  const view = await mountRabbit(
    <RabbitProvider>
      <ToastProvider bar="0px" pinned={<UndoToast />}>
        <Bystander />
        <Rabbit currentPage="rabbit" />
      </ToastProvider>
    </RabbitProvider>,
    { adapter, ctx: () => ctx, until: () => expect(ctx?.project?.id).toBe(PROJECT_ID) },
  )
  // The channel joins and two people are here; the join's own refetch (400 ms) lands; then the Assets tab.
  await act(async () => { live.project.onStatus('SUBSCRIBED'); live.project.onPresence(PEOPLE) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Assets/ })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  return view
}

/** The provider on the fixtures with `children` under it and the two channels held by the test: no shell. */
async function mountUnder(children, prepare = () => {}) {
  const fx = buildDevFixtures()
  const adapter = fx.rabbitAdapter()
  adapter.subscribeProjectChanges = (_projectId, _onEvent, opts = {}) => { live.project = opts; return () => {} }
  adapter.subscribeWorkspaceChanges = (_workspaceId, _onEvent, opts = {}) => { live.workspace = opts; return () => {} }
  prepare(adapter)
  holder.adapter = adapter
  const view = await mountRabbit(
    <RabbitProvider><Bystander />{children}</RabbitProvider>,
    { adapter, ctx: () => ctx, until: () => expect(ctx?.project?.id).toBe(PROJECT_ID) },
  )
  return { view, adapter }
}

/** The workspace channel opens once the session names a workspace; then two people are on it and its own refetch lands. */
async function joinWorkspace() {
  await act(async () => { for (const cb of holder.auth) cb('SIGNED_IN', { user: { id: 'u-1', app_metadata: { workspace_id: 'w-1' } } }) })
  await waitFor(() => expect(typeof live.workspace?.onStatus).toBe('function'))
  await act(async () => { live.workspace.onStatus('SUBSCRIBED'); live.workspace.onPresence(PEOPLE) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
}

/** What ran since `mark`: every component's name, and the readers of the one value among them. */
function ranSince(mark) {
  const value = renderSpy.contextReadBy('Bystander')
  const ran = renderSpy.ran(mark)
  return {
    all: [...new Set(ran.map((e) => e.name))].sort(),
    readers: [...new Set(renderSpy.readers(value, mark).map((e) => e.name))].sort(),
    readerRenders: renderSpy.readers(value, mark).length,
    total: ran.length,
    commits: renderSpy.since(mark).length,
  }
}

beforeEach(() => { localStorage.clear(); live.project = null; live.workspace = null; holder.progress = null })
afterEach(() => { cleanup(); _resetOverlaysForTests(); ctx = null; renderSpy.reset() })

describe('R.A.B.B.I.T.\'s own clocks, with nothing in the project changed', () => {
  it('the shell is the measured one: the Assets tab, the faces in the project bar, the bystander', async () => {
    const view = await mount()
    expect(view.container.querySelector('.rb-presence')).not.toBeNull()
    expect(view.container.querySelector('.rb-presence').getAttribute('aria-label')).toBe('Also on this project: Mara Lind, Ines Okoro')
    expect(ctx.realtimeStatus).toBe('live')
    expect(ctx.presentUsers).toHaveLength(2)
    expect(view.container.querySelector('table')).not.toBeNull()
  })

  // Each pin: the readers of the one value that ran are exactly the ones that
  // show what changed, the bystander and the open tab are not among what ran,
  // and what ran is a handful of components, not the shell.
  const SHELL = ['Bystander', 'Rabbit', 'ProjectContextBar', 'ProjectAssetsView', 'AssetTable', 'AssetRow', 'ViewTabs']
  const quiet = (ran) => SHELL.filter((name) => ran.all.includes(name))

  it('a presence heartbeat draws the faces and nothing else', async () => {
    await mount()
    const mark = renderSpy.mark()
    await act(async () => { live.project.onPresence(PEOPLE.map((p) => ({ ...p }))) })
    const ran = ranSince(mark)
    expect(ran.all).toEqual(['RabbitProvider', 'RealtimePresenceStrip'])
    expect(ran.readers).toEqual([])
    expect(ran.total).toBe(2)             // 574 before
  })

  it('the faces follow the heartbeat: a third person appears, and one leaving goes', async () => {
    const view = await mount()
    await act(async () => { live.project.onPresence([...PEOPLE, { user_id: 'u-4', label: 'Tomas Reyes' }]) })
    expect(view.container.querySelector('.rb-presence').getAttribute('aria-label')).toBe('Also on this project: Mara Lind, Ines Okoro, Tomas Reyes')
    await act(async () => { live.project.onPresence([PEOPLE[1]]) })
    expect(view.container.querySelector('.rb-presence').getAttribute('aria-label')).toBe('Also on this project: Ines Okoro')
    expect(ctx.presentUsers).toHaveLength(1)
  })

  it('a status flip draws the faces (gone: nothing is listening) and the connection dot, and no other reader', async () => {
    const view = await mount()
    const mark = renderSpy.mark()
    await act(async () => { live.project.onStatus('CHANNEL_ERROR') })
    const ran = ranSince(mark)
    expect(ran.readers).toEqual(['ConnectionDot'])
    expect(quiet(ran)).toEqual([])
    expect(ran.total).toBe(4)             // 574 before
    expect(view.container.querySelector('.rb-presence')).toBeNull()
    expect(ctx.realtimeStatus).toBe('error')
  })

  it('an ingestion tick draws the ingestion toast and no other reader', async () => {
    const view = await mount()
    await act(async () => { ctx.startBackgroundIngestion({ files: [], personas: [] }).catch(() => {}) })
    const mark = renderSpy.mark()
    await act(async () => { holder.progress({ chunksDone: 1, chunksTotal: 4, lastLabel: 'Scene 2' }) })
    const ran = ranSince(mark)
    expect(ran.readers).toEqual(['IngestionToast'])
    expect(quiet(ran)).toEqual([])
    expect(ran.total).toBe(8)             // 580 before
    expect(ctx.ingestionRun).toMatchObject({ phase: 'running', chunksDone: 1, chunksTotal: 4, lastLabel: 'Scene 2' })
    expect(view.container.textContent).toContain('1/4')
  })

  it('the undo toast taken down draws the toast and no other reader', async () => {
    const view = await mount()
    await act(async () => { await ctx.deleteAsset(ctx.assets[0].id) })
    expect(ctx.undoToast?.message).toBe('Deleted asset "Shooting Script v4". Its tasks stay.')
    expect(view.baseElement.textContent).toContain('Deleted asset "Shooting Script v4". Its tasks stay.')
    const mark = renderSpy.mark()
    await act(async () => { ctx.dismissUndoToast() })
    const ran = ranSince(mark)
    expect(ran.readers).toEqual(['UndoToast'])
    expect(quiet(ran)).toEqual([])
    expect(ran.total).toBe(2)             // 539 before
    expect(ctx.undoToast).toBeNull()
    expect(view.baseElement.textContent).not.toContain('Deleted asset "Shooting Script v4"')
  })

  it('the adapter going offline draws the connection dot and no other reader', async () => {
    await mount()
    holder.adapter.status = async () => { throw new Error('offline') }
    holder.adapter.mode = 'supabase'      // the auth handler re-asks only a cloud adapter
    const mark = renderSpy.mark()
    await act(async () => { for (const cb of holder.auth) cb('TOKEN_REFRESHED', null); await new Promise((resolve) => setTimeout(resolve, 20)) })
    const ran = ranSince(mark)
    expect(ran.readers).toEqual(['ConnectionDot'])
    expect(quiet(ran)).toEqual([])
    expect(ran.total).toBe(3)             // 539 before
    expect(ctx.adapterStatus).toEqual({ online: false, lastSyncAt: null, error: 'offline' })
  })
})

// ── The same state, read both ways ───────────────────────────────────────────
// The value still carries the eight, as getters over what the provider last
// rendered with. A reader that is NOT drawn again (the bystander) holds the
// value object it was handed before the change, and that very object answers
// with the state as it is now: nothing read through the value is stale.
describe('the eight, read through the value', () => {
  it('a value object taken BEFORE a change answers with the state after it, and is the same object', async () => {
    await mount()
    const before = ctx
    expect(before.presentUsers.map((u) => u.label)).toEqual(['Mara Lind', 'Ines Okoro'])
    await act(async () => { live.project.onPresence([PEOPLE[1]]) })
    await act(async () => { live.project.onStatus('CHANNEL_ERROR') })
    expect(ctx).toBe(before)              // no new value: the bystander was not drawn
    expect(before.presentUsers.map((u) => u.label)).toEqual(['Ines Okoro'])
    expect(before.realtimeStatus).toBe('error')
  })

  it('all eight are fields of the value still: named by `in`, listed by Object.keys, and not writable', async () => {
    await mount()
    const names = ['adapterStatus', 'undoToast', 'activeIngestion', 'ingestionRun', 'realtimeStatus', 'presentUsers', 'workspaceRealtimeStatus', 'workspacePresentUsers']
    for (const name of names) {
      expect(name in ctx, name).toBe(true)
      expect(Object.keys(ctx), name).toContain(name)
      expect(() => { ctx[name] = 'x' }, name).toThrow(TypeError)
    }
    expect(ctx.activeIngestion).toBeNull()
    expect(ctx.workspaceRealtimeStatus).toBe('off')
    expect(ctx.workspacePresentUsers).toEqual([])
    expect(ctx.adapterStatus.online).toBe(true)
  })

  it('the workspace channel: its status and its people are read through a value object taken before it joined', async () => {
    await mountUnder(null)
    const before = ctx
    expect(before.workspaceRealtimeStatus).toBe('off')
    await joinWorkspace()
    expect(before.workspaceRealtimeStatus).toBe('live')
    expect(before.workspacePresentUsers.map((u) => u.label)).toEqual(['Mara Lind', 'Ines Okoro'])
  })
})

// ── The Dashboard's faces ────────────────────────────────────────────────────
// The Dashboard page read the whole value for its strip's two props (the
// workspace channel's status and who is on it), so it was drawn at every
// change of the value. The strip reads its own two now and the page reads
// nothing of the provider. The page's other tests stand in for the provider
// (DashboardPresence.test.jsx); this is the strip under the REAL one.
describe('the Dashboard\'s faces, under the real provider', () => {
  it('shows who is on the workspace channel, and follows it', async () => {
    const { view } = await mountUnder(<DashboardPage />)
    expect(view.container.querySelector('.dash-presence')).toBeNull()        // no channel yet
    await joinWorkspace()
    const names = () => view.container.querySelector('.dash-presence [role="group"]')?.getAttribute('aria-label')
    expect(names()).toBe('Online now: Mara Lind, Ines Okoro')
    await act(async () => { live.workspace.onPresence([PEOPLE[0]]) })
    expect(names()).toBe('Online now: Mara Lind')
    await act(async () => { live.workspace.onStatus('CHANNEL_ERROR') })
    expect(view.container.querySelector('.dash-presence')).toBeNull()        // nothing is listening: nobody is shown
  })

  it('a heartbeat draws the strip and not the page; a write to the open project does not draw the page either', async () => {
    await mountUnder(<DashboardPage />)
    await joinWorkspace()
    let mark = renderSpy.mark()
    await act(async () => { live.workspace.onPresence(PEOPLE.map((p) => ({ ...p }))) })
    expect(renderSpy.renders('RabbitProvider', mark)).toBe(1)                // it did arrive
    expect(renderSpy.renders('WorkspacePresenceStrip', mark)).toBe(1)
    expect(renderSpy.which(['DashboardPage', 'DashboardTasksView', 'NotesView', 'ProfileSection', 'Bystander'], mark)).toEqual([])
    mark = renderSpy.mark()
    await act(async () => { await ctx.updateTask(ctx.tasks[0].id, { name: 'Renamed in the test' }) })
    expect(renderSpy.renders('Bystander', mark)).toBeGreaterThan(0)          // a new value: its readers are drawn
    expect(renderSpy.which(['DashboardPage', 'DashboardTasksView', 'NotesView', 'ProfileSection'], mark)).toEqual([])
  })
})

// ── D.O.G.'s six ─────────────────────────────────────────────────────────────
// D.O.G. read six fields off the whole value, so a write to the project open
// in R.A.B.B.I.T. ran D.O.G. The provider keeps the six as one object
// (useRabbitProjects); this is D.O.G.'s read, in small.
describe('the six fields D.O.G. reads (useRabbitProjects)', () => {
  const seen = { projects: null }
  function DogReads() { seen.projects = useRabbitProjects(useRabbit); return <i data-dog="" /> }
  const mountDog = () => mountUnder(<DogReads />)

  it('are the provider\'s own six, and nothing else', async () => {
    await mountDog()
    const names = ['adapterMode', 'createProject', 'getAdapter', 'projectsIndex', 'refreshProjectsIndex', 'updateProject']
    expect(Object.keys(seen.projects).sort()).toEqual(names)
    for (const name of names) expect(seen.projects[name], name).toBe(ctx[name])
  })

  it('a write to the open project draws the bystander and not D.O.G.\'s read; a heartbeat draws neither', async () => {
    await mountDog()
    let mark = renderSpy.mark()
    await act(async () => { await ctx.updateTask(ctx.tasks[0].id, { name: 'Renamed in the test' }) })
    expect(ctx.tasks[0].name).toBe('Renamed in the test')
    expect(renderSpy.renders('Bystander', mark)).toBeGreaterThan(0)
    expect(renderSpy.renders('DogReads', mark)).toBe(0)
    mark = renderSpy.mark()
    await act(async () => { live.project.onPresence(PEOPLE) })
    expect(renderSpy.renders('RabbitProvider', mark)).toBe(1)
    expect(renderSpy.renders('DogReads', mark)).toBe(0)
    expect(renderSpy.renders('Bystander', mark)).toBe(0)
  })

  it('a project renamed IS D.O.G.\'s news: its read is drawn again with the new list', async () => {
    await mountDog()
    const mark = renderSpy.mark()
    await act(async () => { await ctx.updateProject(PROJECT_ID, { title: 'Salt Hours, recut' }) })
    expect(renderSpy.renders('DogReads', mark)).toBeGreaterThan(0)
    expect(seen.projects.projectsIndex[PROJECT_ID].title).toBe('Salt Hours, recut')
    expect(seen.projects.projectsIndex).toBe(ctx.projectsIndex)
  })
})

// ── An effect that follows the adapter's status ──────────────────────────────
// Six data hooks load again when the adapter's `online` flips (the Budget's
// lines and rates, the expenses, the rate card, the templates, the team). They
// read the status from its own context now; the effect must still run. The
// expenses hook stands for the six: the same line in each.
describe('a data hook that loads again when the adapter comes back (useExpenses)', () => {
  const held = { hook: null }
  function ExpensesReads() { held.hook = useExpenses(); return <i data-expenses={held.hook.expenses.length} /> }

  it('loads once on mount, again each time `online` flips, and not for a refetch that leaves it as it was', async () => {
    let listExpenses = null
    const { adapter } = await mountUnder(<ExpensesReads />, (made) => { listExpenses = vi.spyOn(made, 'listExpenses') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(ctx.adapterStatus.online).toBe(true)
    const loaded = listExpenses.mock.calls.length
    expect(loaded).toBeGreaterThan(0)

    // The list is read again and nothing changed: a new status object, the same `online`.
    await act(async () => { await ctx.refreshProjectsIndex() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(listExpenses.mock.calls.length).toBe(loaded)

    // The adapter stops answering: `online` goes false, and the hook asks again.
    const listProjects = adapter.listProjects
    adapter.listProjects = async () => { throw new Error('offline') }
    await act(async () => { await ctx.refreshProjectsIndex() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(ctx.adapterStatus.online).toBe(false)
    expect(listExpenses.mock.calls.length).toBe(loaded + 1)

    // It answers again: `online` goes true, and the hook asks again.
    adapter.listProjects = listProjects
    await act(async () => { await ctx.refreshProjectsIndex() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(ctx.adapterStatus.online).toBe(true)
    expect(listExpenses.mock.calls.length).toBe(loaded + 2)
  })
})

// ── What remains of rabbit C1 ────────────────────────────────────────────────
// The value is one object. A write to the open project replaces the bundle,
// the bundle is a dep of the value, and every reader is handed a new one. This
// is a MEASUREMENT kept as a pin so the number in docs/OUTSTANDING.md has a
// test behind it: when a later session splits the value further, these
// numbers fall, this test goes red, and the entry is updated with it.
describe('what remains: a write to the open project is a new value for every reader', () => {
  // Measured 2026-11-13 with the eight out of the value: one commit, all seven
  // readers, 574 component renders (the number a heartbeat was before F4).
  const REMAINS = { commits: 1, readerRenders: 7, total: 574 }
  it('one task renamed on the Assets tab', async () => {
    await mount()
    const mark = renderSpy.mark()
    await act(async () => { await ctx.updateTask(ctx.tasks[0].id, { name: 'Renamed in the test' }) })
    const ran = ranSince(mark)
    expect(ran.readers).toEqual(['Bystander', 'ConnectionDot', 'IngestionToast', 'ProjectAssetsView', 'ProjectContextBar', 'Rabbit', 'UndoToast'])
    expect({ commits: ran.commits, readerRenders: ran.readerRenders, total: ran.total }).toEqual(REMAINS)
  })
})
