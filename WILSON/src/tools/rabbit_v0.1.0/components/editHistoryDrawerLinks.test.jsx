/** @vitest-environment jsdom */
// =============================================================================
// editHistoryDrawerLinks.test.jsx — VW1m (2026-10-16), Q-N8 (batch 16, not
// yet asked; interim: no history of a task's items, the old lines in words).
// A task's single link columns are the older apps' copy of its items, so the
// drawer reads their lines in words — the kind, and each item by the name
// the project shows — and offers no Revert for them; a mixed entry keeps the
// Revert of its other fields. Mounted with a stand-in provider.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }))

const { default: EditHistoryDrawer } = await import('./EditHistoryDrawer')

afterEach(() => { cleanup(); _resetOverlaysForTests(); rabbit.current = null })

const linkOnly = {
  id: 'h1', action: 'update', entity_type: 'tasks', entity_id: 't1', actor_label: 'Mara', created_at: '2026-10-16T09:00:00Z',
  diff: { asset_id: { old: 'a1', new: 'a2' } },
}
const mixed = {
  id: 'h2', action: 'update', entity_type: 'tasks', entity_id: 't1', actor_label: 'Mara', created_at: '2026-10-16T10:00:00Z',
  diff: { title: { old: 'Rig test', new: 'Glass and rain rig test' }, scene_id: { old: null, new: 's-gone' } },
}

function mount(entries) {
  rabbit.current = {
    adapterMode: 'supabase',
    getAdapter: () => ({ listEditHistory: async () => entries }),
    revertHistoryEntry: vi.fn(async () => {}),
    assets: [{ id: 'a1', name: 'Lighthouse Interior' }, { id: 'a2', name: 'Storm Lantern' }],
    allScenes: [], allShots: [], levels: [], experiences: [],
  }
  return render(<EditHistoryDrawer entityType="tasks" entityId="t1" entityLabel="Rig test" onClose={() => {}} />)
}

describe('EditHistoryDrawer — a task\'s link lines (VW1m)', () => {
  it('reads a link line in words with the items\' names, and offers it no Revert', async () => {
    mount([linkOnly])
    await waitFor(() => expect(screen.getByText('Asset:')).toBeTruthy())
    expect(screen.getByText('Lighthouse Interior')).toBeTruthy()
    expect(screen.getByText('Storm Lantern')).toBeTruthy()
    expect(screen.queryByText('asset_id:')).toBeNull()
    expect(screen.queryByRole('button', { name: /Revert/ })).toBeNull()
  })

  it('a mixed entry keeps the Revert of its other fields; a gone item reads as no longer in the project', async () => {
    mount([mixed])
    await waitFor(() => expect(screen.getByText('Scene:')).toBeTruthy())
    expect(screen.getByText('a scene no longer in the project')).toBeTruthy()
    expect(screen.getByText('title:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revert these field changes' })).toBeTruthy()
  })
})
