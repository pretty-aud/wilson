/** @vitest-environment jsdom */
// FX3 review round 1, R1-14: the status banner follows a REAL change and a
// REAL undo — the provider's own write and its own history on the dev
// fixtures' Salt Hours — not a re-render with an older context, as the five
// popup render tests do (they prove the banner reads the row it is given;
// this proves what the row becomes).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act, waitFor, screen, within, fireEvent } from '@testing-library/react'

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
  hydrateSupabase: async () => {},
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [], settled: true, loading: false, error: null }) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('./FileManager', () => ({ default: () => null }))

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID, TASK_ID } = await import('../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../state/RabbitProvider')
const { default: TaskDetailPopup } = await import('./TaskDetailPopup')
const { statusMeta } = await import('../../../ui/StatusDot')

let ctx = null
function Harness() {
  ctx = useRabbit()
  if (!ctx?.project) return null
  return <TaskDetailPopup taskId={TASK_ID(1)} ctx={ctx} onClose={() => {}} />
}

afterEach(() => { cleanup(); ctx = null })

describe('FX3: the task popup\'s status banner through the real provider', () => {
  it('a status chosen in the popup recolours the banner; the provider\'s undo recolours it back', async () => {
    holder.adapter = buildDevFixtures().rabbitAdapter()
    render(<RabbitProvider><Harness /></RabbitProvider>)
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
    await waitFor(() => expect(document.querySelector('.ui-dialog-band > .ui-status-banner')).not.toBeNull())
    const banner = () => document.querySelector('.ui-dialog-band > .ui-status-banner')
    const was = ctx.tasks.find((t) => t.id === TASK_ID(1)).status
    expect([banner().dataset.status, banner().dataset.tone]).toEqual([was, statusMeta(was).tone])
    const next = statusMeta(was).tone === 'danger' ? 'final' : 'blocked'
    // The popup's own Status field: the provider writes, the row changes, the banner follows.
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.change(within(dialog).getByRole('combobox', { name: 'Status' }), { target: { value: next } }) })
    await waitFor(() => expect(ctx.tasks.find((t) => t.id === TASK_ID(1)).status).toBe(next))
    await waitFor(() => expect(banner().dataset.status).toBe(next))
    expect(banner().dataset.tone).toBe(statusMeta(next).tone)
    expect(banner().dataset.tone).not.toBe(statusMeta(was).tone) // CONTROL: a real recolour
    // The provider's undo (what Ctrl+Z on the Timeline, and its ↶, call).
    expect(ctx.canUndo).toBe(true)
    await act(async () => { await ctx.undo() })
    await waitFor(() => expect(ctx.tasks.find((t) => t.id === TASK_ID(1)).status).toBe(was))
    await waitFor(() => expect(banner().dataset.status).toBe(was))
    expect(banner().dataset.tone).toBe(statusMeta(was).tone)
  })
})
