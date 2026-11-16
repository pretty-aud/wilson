// =============================================================================
// networkStorageVariant.test.js — `?storage=network` (MO1, MOTH_DESIGN §1.9): the dev fixtures as a company on its
// office server. In memory: no network, nothing stored, and nothing on it can be written.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { storageFixtureMode } from './store'
import { buildDevFixtures } from './install'

describe('?storage=network', () => {
  it('reads network; anything else is the default', () => {
    expect(storageFixtureMode('?storage=network')).toBe('network')
    expect(storageFixtureMode('?fixtures=member&storage=network')).toBe('network')
    expect(storageFixtureMode('?storage=s3')).toBeNull()
    expect(storageFixtureMode('')).toBeNull()
  })
  it('the default build is unchanged: no storage row, no folder, no listed file', async () => {
    const fx = buildDevFixtures()
    expect(fx.workspaceStorage).toBeNull()
    const a = fx.rabbitAdapter()
    const project = fx.store.projects.find((p) => !p.personal_owner_id)
    expect(project.folder_root ?? null).toBeNull()
    expect(fx.store.files.filter((f) => f.storage_provider === 'network_share')).toEqual([])
    expect(await a.getNetworkShareCheck(project.id)).toBeNull()
    expect(await a.networkShareStaleMoves()).toEqual([])
    expect(await a.listTrashedFiles({ projectIds: [project.id] })).toEqual([])
  })
  describe('on', () => {
    const fx = buildDevFixtures({ storage: 'network' })
    const a = fx.rabbitAdapter()
    const project = fx.store.projects.find((p) => !p.personal_owner_id)
    it('🚨 the storage row is the shape every office-server screen asks of it', () => {
      expect(fx.workspaceStorage).toMatchObject({ mode: 'byos', provider: 'network', root_kind: 'unc' })
      expect(project.folder_root.startsWith(`${fx.workspaceStorage.root_path}/`)).toBe(true)
    })
    it('a dozen listed files: one the check did not find, one in a working folder, one in the trash', async () => {
      const rows = fx.store.files.filter((f) => f.storage_provider === 'network_share')
      expect(rows).toHaveLength(12)
      expect(rows.every((f) => f.storage_path.startsWith('nas:Salt-Hours/'))).toBe(true)
      const listed = (await a.listMothFiles(project.id)).filter((f) => f.storage_provider === 'network_share')
      expect(listed).toHaveLength(11)
      expect(listed.filter((f) => f.share_missing_since).map((f) => f.name)).toEqual(['gone_from_server.mov'])
      expect(listed.filter((f) => f.folder_id)).toHaveLength(1)
      expect((await a.listTrashedFiles({ projectIds: [project.id] })).map((f) => f.name)).toEqual(['deleted_last_week.mov'])
    })
    it('the check row and a move left over a day ago', async () => {
      expect(await a.getNetworkShareCheck(project.id)).toMatchObject({ missing_count: 1 })
      expect((await a.networkShareStaleMoves()).map((m) => m.name)).toEqual(['B001_C001.mov'])
      expect(await a.mothIslandFolder(project.id)).toMatchObject({ folder_root: project.folder_root })
    })
    it('🚨 every write on it is refused, as the fixtures refuse a write', async () => {
      await expect(a.refreshNetworkShare({})).rejects.toThrow()
      await expect(a.settleNetworkShareOps(['x'], 'not_moved')).rejects.toThrow()
      await expect(a.trashFiles(['x'], project.id)).rejects.toThrow()
      await expect(a.restoreFiles(['x'], project.id)).rejects.toThrow()
      await expect(a.networkShareRecordAdded({})).rejects.toThrow()
    })
  })
})
