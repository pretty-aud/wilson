/** @vitest-environment jsdom */
// =============================================================================
// editHistoryDrawerLinks.test.jsx — VW1m (2026-10-16), Q-N8 (batch 16, not
// yet asked; interim: no history of a task's items). A task's single link
// columns are the older apps' copy of its items, which the cloud still writes
// whenever a kind's first item changes, and 0012's capture records as a task
// edit. VW1m review round 1 (R1-2): read in words, removing the first of two
// assets said "Asset: Lighthouse Interior → Storm Lantern", a swap that never
// happened. So the drawer shows no line for a task's link column, old or new,
// and no entry whose only changes were those columns; a mixed entry keeps its
// other fields and their Revert. Mounted with a stand-in provider.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }))

const { default: EditHistoryDrawer } = await import('./EditHistoryDrawer')

afterEach(() => { cleanup(); _resetOverlaysForTests(); rabbit.current = null })

// What the database records when the person removes Lighthouse Interior from
// a task that also holds Storm Lantern (measured on dev, rolled back).
const linkOnly = {
  id: 'h1', action: 'update', entity_type: 'tasks', entity_id: 't1', actor_label: 'Mara', created_at: '2026-10-16T09:00:00Z',
  diff: { asset_id: { old: 'a1', new: 'a2' } },
}
const mixed = {
  id: 'h2', action: 'update', entity_type: 'tasks', entity_id: 't1', actor_label: 'Mara', created_at: '2026-10-16T10:00:00Z',
  diff: { title: { old: 'Rig test', new: 'Glass and rain rig test' }, scene_id: { old: null, new: 's-gone' } },
}

function mount(entries, entityType = 'tasks') {
  rabbit.current = {
    adapterMode: 'supabase',
    getAdapter: () => ({ listEditHistory: async () => entries }),
    revertHistoryEntry: vi.fn(async () => {}),
    assets: [{ id: 'a1', name: 'Lighthouse Interior' }, { id: 'a2', name: 'Storm Lantern' }],
    allScenes: [], allShots: [], levels: [], experiences: [],
  }
  return render(<EditHistoryDrawer entityType={entityType} entityId="t1" entityLabel="Rig test" onClose={() => {}} />)
}
const entriesShown = () => document.querySelectorAll('.rb-hist-entry').length
const NOTHING_SHOWN = 'No changes to show.'
const ONLY_LINKS = 'The entries recorded here only changed the links that older versions of the app read.'

describe('EditHistoryDrawer — a task\'s link columns show nothing (VW1m review round 1, R1-2)', () => {
  it('R1-2: an entry whose only change was a link column is not shown: no line, no names, no Revert', async () => {
    mount([linkOnly])
    // Review round 2 (R2-6): said as what it is, not as no history at all.
    await waitFor(() => expect(screen.getByText(NOTHING_SHOWN)).toBeTruthy())
    expect(entriesShown()).toBe(0)
    expect(screen.queryByText('Asset:')).toBeNull()
    expect(screen.queryByText('asset_id:')).toBeNull()
    expect(screen.queryByText('Lighthouse Interior')).toBeNull()
    expect(screen.queryByText('Storm Lantern')).toBeNull()
    expect(screen.queryByRole('button', { name: /Revert/ })).toBeNull()
  })

  it('R1-2: a mixed entry shows its other fields alone, with their Revert; the link-only entry beside it is left out', async () => {
    mount([mixed, linkOnly])
    await waitFor(() => expect(screen.getByText('title:')).toBeTruthy())
    expect(entriesShown()).toBe(1)
    expect(screen.queryByText('Scene:')).toBeNull()
    expect(screen.queryByText('scene_id:')).toBeNull()
    expect(screen.queryByText(/no longer in the project/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Revert these field changes' })).toBeTruthy()
  })

  it('R1-2 CONTROL: another table\'s field of the same name keeps its line and its entry', async () => {
    mount([{ ...linkOnly, entity_type: 'files' }], 'files')
    await waitFor(() => expect(screen.getByText('asset_id:')).toBeTruthy())
    expect(entriesShown()).toBe(1)
    expect(screen.getByText('a1')).toBeTruthy()
    expect(screen.getByText('a2')).toBeTruthy()
  })
})

// VW1m review round 2 (R2-6): with entries that are all link-only, the drawer
// said "No recorded changes in the last 90 days." though entries exist, and
// its "latest 100" note showed only when something was shown — so a task
// whose latest 100 entries were all link-only never said older ones exist.
describe('EditHistoryDrawer — what it read, when it shows nothing (VW1m review round 2, R2-6)', () => {
  it('R2-6: entries that only changed the links say so, not "No recorded changes"', async () => {
    mount([linkOnly])
    await waitFor(() => expect(screen.getByText(NOTHING_SHOWN)).toBeTruthy())
    expect(screen.getByText(ONLY_LINKS)).toBeTruthy()
    expect(screen.queryByText('No recorded changes in the last 90 days.')).toBeNull()
  })

  it('R2-6: 100 link-only entries read: the latest-100 note shows', async () => {
    mount(Array.from({ length: 100 }, (_, i) => ({ ...linkOnly, id: `h${i}` })))
    await waitFor(() => expect(screen.getByText(/latest 100 changes/)).toBeTruthy())
    expect(screen.getByText(/Only the latest 100 changes are read/)).toBeTruthy()
    expect(screen.getByText(NOTHING_SHOWN)).toBeTruthy()
  })

  it('R2-6 CONTROL: no entries at all still read "No recorded changes", with no note', async () => {
    mount([])
    await waitFor(() => expect(screen.getByText('No recorded changes in the last 90 days.')).toBeTruthy())
    expect(screen.queryByText(ONLY_LINKS)).toBeNull()
    expect(screen.queryByText(/latest 100/)).toBeNull()
  })
})
