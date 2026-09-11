/** @vitest-environment jsdom */
// =============================================================================
// rabbitFixturesAdapter.contract.test.js — the fixtures adapter honours the
// RabbitAdapter contract, measured from the REAL Supabase adapter's surface.
//
// The cloud adapter is built by its own factory (the client is mocked the way
// supabaseLoadProject.test.js mocks it, and never called), its method names
// are enumerated, and each must exist on the fixtures adapter. A method added
// to the cloud adapter without a fixtures twin fails here, not in Audrey's
// review. The Local Server bins surface is pinned from the contract comment in
// adapters/index.js, since the cloud adapter does not carry it.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../cloud/auth/supabaseClient', () => ({
  // No `from`, no `rpc`, no `storage`: a fixtures method that reached the client
  // would throw "is not a function" and fail its test.
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  hydrateSupabase: async () => null,
}))

const { supabaseAdapter } = await import('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter')
const { selectAdapter, adapterSupportsWrites, ADAPTER_MODES } = await import('../../tools/rabbit_v0.1.0/adapters')
const { buildDevFixtures } = await import('./install')
const { onDevWriteRefused } = await import('../devFixtures')
const { PROJECT_ID } = await import('./data/project')
const { PERMISSIONS, WORKSPACE_ID } = await import('./data/workspace')

const BINS_SURFACE = [
  'listBins', 'createBin', 'updateBin', 'deleteBin', 'reorderBins',
  'pickBinFiles', 'pickBinFolder', 'prepareBinFiles', 'addBinFiles',
  'updateBinFile', 'bulkUpdateBinFiles', 'moveBinFiles', 'copyBinFiles', 'removeBinFiles', 'restoreBinFiles',
  'probeBinFile', 'binFileThumbnailUrl', 'binFileStreamUrl', 'postBinFileThumbnail',
  'binRelinkScan', 'binRelinkApply', 'removeBinRoot',
  'assignShotTakes', 'updateShotTake', 'removeShotTakes', 'reorderShotTakes', 'replaceShotTakes',
]

// Mirror of EMPTY_BUNDLE's collection keys (RabbitProvider.jsx) — the same list
// adapters/loadProjectBundle.test.js pins for the two real adapters.
const BUNDLE_KEYS = [
  'phases', 'assets', 'tasks', 'dependencies', 'taskLinks', 'files',
  'assetVersions', 'comments', 'ingestionRuns', 'teamAssignments',
  'managedFiles', 'budgetVersions', 'expenses', 'projectTeam',
  'scenes', 'shots', 'levels', 'experiences', 'milestones', 'folders',
  'bins', 'binFiles', 'binRoots', 'shotTakes',
]

describe('the fixtures adapter implements the Supabase adapter contract', () => {
  const cloud = supabaseAdapter()
  const cloudMethods = Object.keys(cloud).filter((k) => typeof cloud[k] === 'function').sort()

  it('the cloud surface is measured from the real factory, not a hand list', () => {
    expect(cloudMethods.length).toBeGreaterThan(100)
    expect(cloudMethods).toContain('loadProject')
    expect(cloudMethods).toContain('saveNoteDoc')
    expect(cloudMethods).toContain('subscribeWorkspaceChanges')
  })

  it('every cloud method exists on the fixtures adapter, by name', () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const missing = cloudMethods.filter((k) => typeof fx[k] !== 'function')
    expect(missing).toEqual([])
    expect(fx.mode).toBe('fixtures')
  })

  it('the Local Server bins and takes surface exists too', () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const missing = BINS_SURFACE.filter((k) => typeof fx[k] !== 'function')
    expect(missing).toEqual([])
  })

  it('"fixtures" is NOT a selectable mode — the adapter substitutes for the cloud slot', () => {
    expect(ADAPTER_MODES).not.toContain('fixtures')
    expect(() => selectAdapter('fixtures')).toThrow(/unknown adapter mode/)
    expect(adapterSupportsWrites('fixtures')).toBe(true)
  })

  it('the control: a method the cloud has and the fixtures lack is reported by name', () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const pretend = [...cloudMethods, 'listSomethingNew']
    expect(pretend.filter((k) => typeof fx[k] !== 'function')).toEqual(['listSomethingNew'])
  })
})

describe('the fixtures adapter behaves like a backend', () => {
  it('status is online and loadProject returns every bundle key the provider resets', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    expect((await fx.status()).online).toBe(true)
    const bundle = await fx.loadProject(PROJECT_ID)
    expect(bundle.project.id).toBe(PROJECT_ID)
    for (const k of BUNDLE_KEYS) expect(Array.isArray(bundle[k]), k).toBe(true)
    expect(bundle.tasks.length).toBe(42)
    expect(bundle.phases.length).toBe(5)
    expect(bundle.binFiles.every((f) => f.online === true && !('__poster' in f))).toBe(true)
  })

  it('reads are clones — mutating a returned row does not touch the store', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const a = await fx.listTasks(PROJECT_ID)
    a[0].title = 'scribbled'
    const b = await fx.listTasks(PROJECT_ID)
    expect(b[0].title).not.toBe('scribbled')
  })

  it('writes mutate for the session: patch, soft delete, restore', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const [task] = await fx.listTasks(PROJECT_ID)
    const patched = await fx.patchTask(task.id, { status: 'blocked' })
    expect(patched.status).toBe('blocked')
    expect((await fx.listTasks(PROJECT_ID)).find((t) => t.id === task.id).status).toBe('blocked')
    await fx.deleteTask(task.id)
    expect((await fx.listTasks(PROJECT_ID)).some((t) => t.id === task.id)).toBe(false)
    expect(await fx.restoreTask(task.id)).toBe(true)
    expect((await fx.listTasks(PROJECT_ID)).some((t) => t.id === task.id)).toBe(true)
  })

  it('listMyTasks is the reviewer\'s rows with the project and asset embeds', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const mine = await fx.listMyTasks()
    expect(mine.length).toBeGreaterThanOrEqual(10)
    for (const t of mine) {
      expect([t.assignee_id, t.reviewer_id]).toContain(PERMISSIONS.userId)
      expect(t.project.title).toBe('Salt Hours')
      expect(typeof t.asset.name).toBe('string')
    }
  })

  it('rate cards: the general and internal cards exist so useRateCard never has to create them', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const cards = await fx.listRateCards(WORKSPACE_ID)
    expect(cards.map((c) => c.type).sort()).toEqual(['general', 'internal'])
    const entries = await fx.listRateCardEntries(cards.find((c) => c.type === 'general').id)
    expect(entries.length).toBeGreaterThan(10)
  })

  it('saveNoteDoc enforces the version guard the way the cloud does', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const [note] = await fx.listNotes()
    expect(note.ydoc_state).toBeUndefined() // the list never carries the document
    const full = await fx.getNote(note.id)
    expect(typeof full.ydoc_state).toBe('string')
    expect(await fx.saveNoteDoc(note.id, { ydocState: 'x', bodyPreview: 'x', expectedVersion: full.version + 5 })).toBeNull()
    const saved = await fx.saveNoteDoc(note.id, { ydocState: 'x', bodyPreview: 'x', expectedVersion: full.version })
    expect(saved.version).toBe(full.version + 1)
  })

  it('takes keep exactly one primary per shot through assign, update and remove', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const { shotTakes, binFiles } = await fx.listBins(PROJECT_ID)
    const shotId = shotTakes[0].shot_id
    const primaries = (rows) => rows.filter((t) => t.shot_id === shotId && t.role === 'primary').length
    expect(primaries(shotTakes)).toBe(1)
    const spare = binFiles.find((f) => !shotTakes.some((t) => t.bin_file_id === f.id))
    const assigned = await fx.assignShotTakes(PROJECT_ID, [{ shot_id: shotId, bin_file_id: spare.id, role: 'primary' }])
    expect(primaries(assigned.shotTakes)).toBe(1)
    expect(assigned.shotTakes.find((t) => t.bin_file_id === spare.id).role).toBe('primary')
    const removed = await fx.removeShotTakes(PROJECT_ID, assigned.created.map((t) => t.id))
    expect(primaries(removed.shotTakes)).toBe(1)
    expect(removed.shotTakes.filter((t) => t.shot_id === shotId).map((t) => t.position)).toEqual([0, 1])
  })

  it('a write the fixtures cannot honour is refused loudly: an Error with a code AND an event for the toast', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const seen = []
    const off = onDevWriteRefused((m) => seen.push(m))
    await expect(fx.uploadFile(PROJECT_ID, {}, new Blob(['x']))).rejects.toMatchObject({ code: 'dev_fixtures_refused', status: 501 })
    await expect(fx.pickBinFiles(PROJECT_ID)).rejects.toMatchObject({ code: 'dev_fixtures_refused' })
    off()
    expect(seen.length).toBe(2)
    expect(seen[0]).toMatch(/^Dev fixtures: Uploading a file is not available/)
  })

  it('there are no file bodies: download is refused loudly, a preview URL is null (a capability gap, not a refusal)', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const seen = []
    const off = onDevWriteRefused((m) => seen.push(m))
    const [file] = (await fx.listFiles(PROJECT_ID)).filter((f) => f.thumbnail_url)
    await expect(fx.downloadUrl(file, file.name)).rejects.toMatchObject({ code: 'dev_fixtures_refused' })
    await expect(fx.downloadFile(file)).rejects.toMatchObject({ code: 'dev_fixtures_refused' })
    expect(await fx.fileUrl(file)).toBeNull()
    off()
    expect(seen.length).toBe(2) // the null is silent by design; the two refusals are not
  })

  it('a removed bin file comes back with its poster, and a move-delete with no target removes', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const { binFiles, bins } = await fx.listBins(PROJECT_ID)
    const file = binFiles[0]
    expect(fx.binFileThumbnailUrl(PROJECT_ID, file.id)).toMatch(/^data:image\/svg\+xml/)
    expect('__poster' in file).toBe(false)
    const { removed } = await fx.removeBinFiles(PROJECT_ID, [file.id])
    expect(removed.length).toBe(1)
    const { restored, skipped } = await fx.restoreBinFiles(PROJECT_ID, removed)
    expect(restored.length).toBe(1)
    expect(skipped).toEqual([])
    expect(fx.binFileThumbnailUrl(PROJECT_ID, file.id)).toMatch(/^data:image\/svg\+xml/)
    const again = await fx.restoreBinFiles(PROJECT_ID, removed)
    expect(again.skipped).toEqual([{ id: file.id, reason: 'invalid' }]) // the provider's own reason word
    const { created } = await fx.copyBinFiles(PROJECT_ID, [file.id], bins[0].id)
    expect(fx.binFileThumbnailUrl(PROJECT_ID, created[0].id)).toMatch(/^data:image\/svg\+xml/)
    const leaf = bins.find((b) => b.parent_bin_id)
    const before = (await fx.listBins(PROJECT_ID)).binFiles.filter((f) => f.bin_id === leaf.id).length
    expect(before).toBeGreaterThan(0)
    const answer = await fx.deleteBin(PROJECT_ID, leaf.id, { mode: 'move', target: null })
    expect(answer.removedFiles.length).toBe(before)
    expect((await fx.listBins(PROJECT_ID)).binFiles.some((f) => f.bin_id === leaf.id)).toBe(false)
  })

  it('thumbnails resolve by object path to generated SVG data URIs', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const files = await fx.listFiles(PROJECT_ID)
    const paths = files.map((f) => f.thumbnail_url).filter(Boolean)
    expect(paths.length).toBeGreaterThan(10)
    const map = await fx.thumbnailUrls(paths)
    expect(map.size).toBe(paths.length)
    for (const u of map.values()) expect(u.startsWith('data:image/svg+xml')).toBe(true)
    expect(await fx.thumbnailUrls(['nope'])).toEqual(new Map())
  })

  it('realtime subscriptions report a joined channel and hand back an unsubscribe', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const status = []
    const off = fx.subscribeProjectChanges(PROJECT_ID, () => {}, { onStatus: (s) => status.push(s) })
    await new Promise((r) => setTimeout(r, 5))
    expect(status).toEqual(['SUBSCRIBED']) // the Supabase channel word the provider maps to 'live'
    expect(typeof off).toBe('function')
    off()
  })
})
