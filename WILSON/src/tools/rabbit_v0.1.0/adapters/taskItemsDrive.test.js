// =============================================================================
// taskItemsDrive.test.js — VW1m (2026-10-16): Google Drive reads a task's
// items from its exported bundle, read-only.
//
// Audrey's ruling (batch 12): a task's items are its items. On Drive that
// means the export's taskItems ARE the task's items (the single fields are
// only the older builds' copy), read and never written:
//   * an export carrying taskItems answers them, and taskItemsAvailable() is
//     true, so the provider reads items as on every other backend;
//   * an export from before FX2 carries none: taskItemsAvailable() answers
//     false, and the provider reads each task's stored single field as its
//     one item (as for a cloud without 0096) — nothing the export holds reads
//     empty;
//   * addTaskItem / deleteTaskItem throw readOnly() before any request, as
//     every Drive write does.
// The Drive API is a two-URL fetch; the OAuth config and tokens come from a
// stubbed window.electronAPI. Nothing here touches a network.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { googleDriveAdapter } = await import('./googleDriveAdapter')

const ITEMS = [
  { id: 'i1', task_id: 't1', project_id: 'pj', entity_type: 'asset', entity_id: 'a1', position: 0, created_at: '2026-10-11T00:00:00Z' },
  { id: 'i2', task_id: 't1', project_id: 'pj', entity_type: 'asset', entity_id: 'a2', position: 1, created_at: '2026-10-12T00:00:00Z' },
]
const BASE = {
  project: { id: 'pj', title: 'Exported' },
  assets: [{ id: 'a1', name: 'Lighthouse Interior' }, { id: 'a2', name: 'Storm Lantern' }],
  tasks: [{ id: 't1', project_id: 'pj', title: 'Rig', asset_id: 'a1' }],
}

let exported
let requests
beforeEach(() => {
  requests = []
  exported = { ...BASE, taskItems: ITEMS }
  globalThis.window = {
    electronAPI: {
      rabbit: {
        readGdriveConfig: async () => ({ clientId: 'c', clientSecret: 's', redirectUri: 'r', rootFolderId: 'root' }),
        readGdriveTokens: async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000 }),
        writeGdriveTokens: async () => {},
      },
    },
  }
  globalThis.fetch = vi.fn(async (url) => {
    requests.push(String(url))
    if (String(url).includes('/files?q=')) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'json1', name: 'project.json' }] }) }
    if (String(url).includes('/files/json1?alt=media')) return { ok: true, status: 200, json: async () => exported }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})
afterEach(() => {
  delete globalThis.window
  vi.restoreAllMocks()
})

describe('Google Drive: a task\'s items are read from the export, read-only (VW1m)', () => {
  it('an export with items answers them as the task\'s items, and says it keeps them', async () => {
    const drive = googleDriveAdapter()
    const bundle = await drive.loadProject('pj')
    expect(bundle.taskItems).toEqual(ITEMS)
    expect(drive.taskItemsAvailable()).toBe(true)
    expect(await drive.listTaskItems('pj')).toEqual(ITEMS)
    // The single field is the older builds' copy, carried as exported and
    // read for nothing: the second asset is an item all the same.
    expect(bundle.tasks[0].asset_id).toBe('a1')
  })

  it('an export from before FX2 has none: the provider is told to read the stored fields, and a later export with items is read again', async () => {
    const drive = googleDriveAdapter()
    exported = { ...BASE }
    const bundle = await drive.loadProject('pj')
    expect(bundle.taskItems).toEqual([])
    expect(drive.taskItemsAvailable()).toBe(false)
    expect(bundle.tasks[0].asset_id).toBe('a1')
    exported = { ...BASE, taskItems: [] }
    await drive.loadProject('pj')
    // An empty list is an export that keeps items and has none.
    expect(drive.taskItemsAvailable()).toBe(true)
  })

  it('the two item writes are loud read-only stubs, and send nothing', async () => {
    const drive = googleDriveAdapter()
    for (const [name, args] of [['addTaskItem', [ITEMS[0]]], ['deleteTaskItem', ['i1', 'pj']]]) {
      expect(typeof drive[name], name).toBe('function')
      await expect(drive[name](...args), name).rejects.toThrow(`[gdrive] ${name}() — Google Drive adapter is read-only`)
    }
    expect(requests).toEqual([])
    // No reorder, as on every backend this app talks to (her Q-N1).
    expect(drive.reorderTaskItems).toBeUndefined()
  })
})
