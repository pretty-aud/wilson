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
const { fid } = await import('./ids')

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
  // Post-overhaul S3a (0084): every adapter's loadProject returns these three.
  'shotLists', 'shotListItems', 'edits',
]

// The S3a contract's nine shot-list methods, by name. The cloud-surface test
// above already demands them once the Supabase adapter has them; this pins
// them on the fixtures side independently, so a rename on either side fails.
const SHOT_LIST_SURFACE = [
  'listShotLists', 'upsertShotList', 'listShotListItems', 'replaceShotListItems',
  'listEdits', 'upsertEdit', 'setActiveShotList', 'archiveShotList', 'archiveEdit',
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

  it('the nine shot-list methods (S3a contract) exist, by name', () => {
    const fx = buildDevFixtures().rabbitAdapter()
    expect(SHOT_LIST_SURFACE.filter((k) => typeof fx[k] !== 'function')).toEqual([])
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

// =============================================================================
// Shot lists, items and edits — the S3a contract's rules 1–8 (migration 0084).
// Every refusal is checked for its exact text, HTTP status and code: the
// provider shows the text, and the Local Server and the database refuse the
// same inputs with the same words.
// =============================================================================

describe('shot lists, items and edits (post-overhaul S3a, 0084)', () => {
  const LIST_1 = fid('shotList', 1) // "Shot list 1 · v1", active
  const LIST_2 = fid('shotList', 2) // "Pickups · v1", archived
  const SCENE = (n) => fid('scene', n)
  const SHOT = (n) => fid('shot', n)
  const fresh = () => buildDevFixtures().rabbitAdapter()
  const no = (status, code, message) => ({ status, code, message })
  const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const inCreatedOrder = (rows) => rows.every((r, i) => i === 0 || (cmpText(rows[i - 1].created_at, r.created_at) || cmpText(rows[i - 1].id, r.id)) <= 0)
  const inPositionOrder = (rows) => rows.every((r, i) => i === 0 || ((rows[i - 1].position - r.position) || cmpText(rows[i - 1].id, r.id)) <= 0)

  it('loadProject returns the seeded lists and items in the contract order, and no edits', async () => {
    const fx = fresh()
    const b = await fx.loadProject(PROJECT_ID)
    expect(b.project.active_shot_list_id).toBe(LIST_1)
    expect(b.shotLists.map((l) => l.id)).toEqual([LIST_1, LIST_2])
    expect(b.shotListItems.length).toBe(29)
    expect(inCreatedOrder(b.shotLists)).toBe(true)
    expect(inPositionOrder(b.shotListItems)).toBe(true)
    expect(inPositionOrder([...b.shotListItems].reverse())).toBe(false) // the control
    expect(b.edits).toEqual([])
    expect(await fx.listShotLists(PROJECT_ID)).toEqual(b.shotLists)
    expect(await fx.listShotListItems(PROJECT_ID)).toEqual(b.shotListItems)
    expect(await fx.listEdits(PROJECT_ID)).toEqual([])
  })

  it('the game variant keeps every list whole: each item names a scene or shot in its bundle', async () => {
    const fx = buildDevFixtures({ variant: 'game' }).rabbitAdapter()
    const b = await fx.loadProject(PROJECT_ID)
    const scenes = new Set(b.scenes.map((s) => s.id))
    const shots = new Set(b.shots.map((s) => s.id))
    expect(b.shotListItems.length).toBe(29)
    for (const i of b.shotListItems) expect(i.scene_id ? scenes.has(i.scene_id) : shots.has(i.shot_id), i.id).toBe(true)
    expect(b.shotLists.some((l) => l.id === b.project.active_shot_list_id)).toBe(true)
  })

  it('archive: the ACTIVE list is refused; a non-active list restores and archives, idempotently', async () => {
    const fx = fresh()
    await expect(fx.archiveShotList(PROJECT_ID, LIST_1)).rejects.toMatchObject(
      no(409, 'conflict', 'the active shot list cannot be archived — make another list active first'))
    expect((await fx.listShotLists(PROJECT_ID)).find((l) => l.id === LIST_1).archived_at).toBeNull()

    const restored = await fx.archiveShotList(PROJECT_ID, LIST_2, false)
    expect(restored).toMatchObject({ id: LIST_2, archived_at: null, archived_by: null })
    expect(await fx.archiveShotList(PROJECT_ID, LIST_2, false)).toEqual(restored) // a no-op hands the row back unchanged

    const archived = await fx.archiveShotList(PROJECT_ID, LIST_2)
    expect(typeof archived.archived_at).toBe('string')
    expect(archived.archived_by).toBe(PERMISSIONS.userId) // the caller
    expect((await fx.archiveShotList(PROJECT_ID, LIST_2, true)).archived_at).toBe(archived.archived_at)

    await expect(fx.archiveShotList(PROJECT_ID, fid('shotList', 99))).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(fx.archiveShotList(fid('project', 99), LIST_2)).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
  })

  it('set active: refuses an archived list and a list of no project; restore, activate, null clears', async () => {
    const fx = fresh()
    await expect(fx.setActiveShotList(PROJECT_ID, LIST_2)).rejects.toMatchObject(
      no(409, 'conflict', 'an archived shot list cannot be made active — restore it first'))
    await expect(fx.setActiveShotList(PROJECT_ID, fid('shotList', 99))).rejects.toMatchObject(
      no(404, 'not_found', 'shot list not found in this project'))
    expect((await fx.loadProject(PROJECT_ID)).project.active_shot_list_id).toBe(LIST_1)

    await fx.archiveShotList(PROJECT_ID, LIST_2, false)
    expect(await fx.setActiveShotList(PROJECT_ID, LIST_2)).toBe(LIST_2)
    expect((await fx.loadProject(PROJECT_ID)).project.active_shot_list_id).toBe(LIST_2)
    // List 1 is no longer the active one, so it may be archived now.
    expect(typeof (await fx.archiveShotList(PROJECT_ID, LIST_1)).archived_at).toBe('string')
    expect(await fx.setActiveShotList(PROJECT_ID, null)).toBeNull()
    expect((await fx.loadProject(PROJECT_ID)).project.active_shot_list_id).toBeNull()
  })

  it('the project row: a CHANGE to active_shot_list_id is refused; the unchanged value passes', async () => {
    const fx = fresh()
    await fx.archiveShotList(PROJECT_ID, LIST_2, false) // a legitimate target, so only the route is wrong
    const ruling = no(403, 'forbidden', 'the active shot list is changed only by a project manager or a workspace admin, through set_active_shot_list()')
    await expect(fx.updateProject(PROJECT_ID, { active_shot_list_id: LIST_2 })).rejects.toMatchObject(ruling)
    await expect(fx.updateProject(PROJECT_ID, { active_shot_list_id: null })).rejects.toMatchObject(ruling)
    expect((await fx.loadProject(PROJECT_ID)).project.active_shot_list_id).toBe(LIST_1)

    expect(await fx.updateProject(PROJECT_ID, { active_shot_list_id: LIST_1, status_tag: 'Shoot' }))
      .toMatchObject({ active_shot_list_id: LIST_1, status_tag: 'Shoot' })
    const { project } = await fx.loadProject(PROJECT_ID)
    expect((await fx.updateProject(PROJECT_ID, { ...project, title: 'Salt Hours II' })).title).toBe('Salt Hours II') // whole row back
    expect((await fx.updateProject(PROJECT_ID, { description: 'x' })).active_shot_list_id).toBe(LIST_1)
  })

  it('upsertShotList: title, version, snapshot, one (title, version) per project, and the archive guard', async () => {
    const fx = fresh()
    const base = { project_id: PROJECT_ID, title: 'Shot list 1', version: 1 }
    await expect(fx.upsertShotList({ ...base, title: '   ' })).rejects.toMatchObject(no(400, 'invalid', 'A shot list needs a title.'))
    await expect(fx.upsertShotList({ ...base, version: 0 })).rejects.toMatchObject(
      no(400, 'invalid', "A shot list's version must be a whole number of at least 1."))
    await expect(fx.upsertShotList({ ...base, version: 1.5 })).rejects.toMatchObject({ status: 400, code: 'invalid' })
    await expect(fx.upsertShotList({ ...base, title: 'New', snapshot: [] })).rejects.toMatchObject(
      no(400, 'invalid', "A shot list's snapshot must be an object."))
    await expect(fx.upsertShotList(base)).rejects.toMatchObject(
      no(409, 'conflict', 'There is already a shot list called "Shot list 1 · v1".'))
    await expect(fx.upsertShotList({ ...base, title: '  Shot list 1 ' })).rejects.toMatchObject({ status: 409, code: 'conflict' }) // trimmed
    await expect(fx.upsertShotList({ title: 'Orphan', version: 1 })).rejects.toMatchObject({ status: 400, code: 'invalid' })

    const v2 = await fx.upsertShotList({ ...base, version: 2, summary: 'Second pass' })
    expect(v2).toMatchObject({
      project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, title: 'Shot list 1', version: 2, summary: 'Second pass',
      snapshot: {}, archived_at: null, archived_by: null, created_by: PERMISSIONS.userId,
    })
    const lists = await fx.listShotLists(PROJECT_ID)
    expect(lists.map((l) => l.id).sort()).toEqual([LIST_1, LIST_2, v2.id].sort())
    expect(inCreatedOrder(lists)).toBe(true)
    await expect(fx.upsertShotList({ ...v2, version: 1 })).rejects.toMatchObject({ status: 409, code: 'conflict' }) // onto a taken pair
    expect((await fx.upsertShotList({ ...v2, summary: 'Edited' })).summary).toBe('Edited') // its own pair is no clash

    const stored2 = lists.find((l) => l.id === LIST_2) // archived
    await expect(fx.upsertShotList({ ...stored2, summary: 'x' })).rejects.toMatchObject(
      no(409, 'conflict', 'this shot list is archived — restore it before changing it'))
    const archiveOnly = no(403, 'forbidden', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()')
    await expect(fx.upsertShotList({ ...stored2, archived_at: null, archived_by: null })).rejects.toMatchObject(archiveOnly)
    await expect(fx.upsertShotList({ id: LIST_1, project_id: PROJECT_ID, archived_at: '2026-09-30T00:00:00.000Z' })).rejects.toMatchObject(archiveOnly)
    await expect(fx.upsertShotList({ ...base, title: 'Born archived', archived_at: '2026-09-30T00:00:00.000Z' })).rejects.toMatchObject(archiveOnly)

    // Nothing refused was written.
    const after = await fx.listShotLists(PROJECT_ID)
    expect(after.length).toBe(3)
    expect(after.find((l) => l.id === LIST_2)).toEqual(stored2)
  })

  it('replaceShotListItems refuses a foreign scene, and every other bad input, leaving the stored set unchanged', async () => {
    const fx = fresh()
    const other = await fx.createProject({ title: 'Another film' })
    const foreign = await fx.upsertScene({ project_id: other.id, name: 'Elsewhere', scene_number: 1 })
    const before = await fx.listShotListItems(PROJECT_ID)
    const current = before.filter((i) => i.shot_list_id === LIST_1)

    const notHere = no(400, 'invalid', 'an item names a scene or shot that is not in this project')
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [...current, { scene_id: foreign.id }])).rejects.toMatchObject(notHere)
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ shot_id: fid('shot', 99) }])).rejects.toMatchObject(notHere)
    await expect(fx.replaceShotListItems(PROJECT_ID, fid('shotList', 99), [])).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(fx.replaceShotListItems(other.id, LIST_1, [])).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, { items: [] })).rejects.toMatchObject(no(400, 'invalid', 'items must be a JSON array'))
    const exactlyOne = no(400, 'invalid', 'each item names exactly one scene or one shot')
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ scene_id: SCENE(1), shot_id: SHOT(1) }])).rejects.toMatchObject(exactlyOne)
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ position: 0 }])).rejects.toMatchObject(exactlyOne)
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ scene_id: SCENE(1) }, { scene_id: SCENE(1) }])).rejects.toMatchObject(
      no(409, 'conflict', 'a shot list holds each scene and each shot once'))
    const badPosition = no(400, 'invalid', "an item's position must be a whole number of at least 0")
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ shot_id: SHOT(1), position: -1 }])).rejects.toMatchObject(badPosition)
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ shot_id: SHOT(1), position: 1.5 }])).rejects.toMatchObject(badPosition)

    // All-or-nothing: a whole valid list with one bad item at the END wrote nothing.
    expect(await fx.listShotListItems(PROJECT_ID)).toEqual(before)
  })

  it("replaceShotListItems keeps its own ids, inserts unknown ids, mints missing ones, skips another list's ids, deletes the unnamed", async () => {
    const fx = fresh()
    const all = await fx.listShotListItems(PROJECT_ID)
    const one = all.filter((i) => i.shot_list_id === LIST_1)
    const two = all.filter((i) => i.shot_list_id === LIST_2)
    const keep = one.find((i) => i.scene_id === SCENE(1))
    const unknownId = fid('shotListItem', 900)
    const stolen = two[0]
    const after = await fx.replaceShotListItems(PROJECT_ID, LIST_1, [
      { id: keep.id, scene_id: SCENE(1), position: 3 },
      { id: unknownId, scene_id: SCENE(2) }, // no position: its index, 1
      { scene_id: SCENE(4), position: 0 }, // no id: a new one
      { id: stolen.id, scene_id: SCENE(6) }, // list 2's id: skipped, not written, not returned
      { shot_id: SHOT(1) }, // index 4
    ])
    expect(after.map((i) => [i.scene_id || i.shot_id, i.position])).toEqual([
      [SCENE(4), 0], [SCENE(2), 1], [SCENE(1), 3], [SHOT(1), 4],
    ])
    const kept = after.find((i) => i.id === keep.id)
    expect(kept.created_at).toBe(keep.created_at)
    expect(kept.updated_at).not.toBe(keep.updated_at)
    expect(after.find((i) => i.id === unknownId)).toMatchObject({ scene_id: SCENE(2), shot_id: null })
    const minted = after.find((i) => i.scene_id === SCENE(4))
    expect(minted.id).not.toBe(one.find((i) => i.scene_id === SCENE(4)).id) // the old row was not named: deleted
    expect(after.some((i) => i.id === stolen.id)).toBe(false)
    expect(after.every((i) => i.shot_list_id === LIST_1 && i.project_id === PROJECT_ID)).toBe(true)

    const reread = await fx.listShotListItems(PROJECT_ID)
    expect(reread.filter((i) => i.shot_list_id === LIST_2)).toEqual(two) // the other list is untouched
    expect(reread.filter((i) => i.shot_list_id === LIST_1).map((i) => i.id).sort()).toEqual(after.map((i) => i.id).sort())
    // An archived list is not frozen here (the database does not freeze it either).
    expect((await fx.replaceShotListItems(PROJECT_ID, LIST_2, two.slice(0, 2))).length).toBe(2)
  })

  it('deleting a scene or a shot takes it out of every list and unlinks tasks; asset arrays and edits keep it', async () => {
    const fx = fresh()
    const [task] = await fx.listTasks(PROJECT_ID)
    await fx.patchTask(task.id, { scene_id: SCENE(3), shot_id: SHOT(7) })
    const [asset] = await fx.listAssets(PROJECT_ID)
    await fx.patchAsset(asset.id, { scene_ids: [SCENE(3)], shot_ids: [SHOT(7)] })
    const edit = await fx.upsertEdit({
      project_id: PROJECT_ID, shot_list_id: LIST_1, title: 'Assembly',
      items: [{ id: 'e1', scene_id: SCENE(3), shot_id: SHOT(7), label: 'Two-shot', notes: '' }],
    })
    const before = await fx.listShotListItems(PROJECT_ID)
    expect(before.filter((i) => i.shot_id === SHOT(7)).length).toBe(2) // in both lists
    expect(before.filter((i) => i.scene_id === SCENE(3)).length).toBe(2)

    await fx.deleteShot(SHOT(7), PROJECT_ID)
    let items = await fx.listShotListItems(PROJECT_ID)
    expect(items.some((i) => i.shot_id === SHOT(7))).toBe(false)
    expect(items.length).toBe(before.length - 2)
    expect((await fx.listTasks(PROJECT_ID)).find((t) => t.id === task.id)).toMatchObject({ scene_id: SCENE(3), shot_id: null })

    await fx.deleteScene(SCENE(3), PROJECT_ID)
    items = await fx.listShotListItems(PROJECT_ID)
    expect(items.some((i) => i.scene_id === SCENE(3))).toBe(false)
    expect(items.length).toBe(before.length - 4)
    expect(items.filter((i) => i.shot_id === SHOT(8)).length).toBe(2) // only the scene's own item goes
    expect((await fx.listTasks(PROJECT_ID)).find((t) => t.id === task.id)).toMatchObject({ scene_id: null, shot_id: null })

    expect((await fx.listAssets(PROJECT_ID)).find((a) => a.id === asset.id)).toMatchObject({ scene_ids: [SCENE(3)], shot_ids: [SHOT(7)] })
    expect((await fx.listEdits(PROJECT_ID)).find((e) => e.id === edit.id).items[0].shot_id).toBe(SHOT(7)) // D17: "Missing shot"
  })

  it('upsertEdit: validation, one (title, version) per list, the parent chain, and the move and archive guards', async () => {
    const fx = fresh()
    const base = { project_id: PROJECT_ID, shot_list_id: LIST_1, title: 'Assembly', version: 1, items: [] }
    await expect(fx.upsertEdit({ ...base, title: '' })).rejects.toMatchObject(no(400, 'invalid', 'An edit needs a title.'))
    await expect(fx.upsertEdit({ ...base, version: '2' })).rejects.toMatchObject(
      no(400, 'invalid', "An edit's version must be a whole number of at least 1."))
    await expect(fx.upsertEdit({ ...base, shot_list_id: fid('shotList', 99) })).rejects.toMatchObject(
      no(400, 'invalid', 'an edit belongs to a shot list of this project'))
    await expect(fx.upsertEdit({ ...base, items: {} })).rejects.toMatchObject(no(400, 'invalid', "An edit's items must be a list."))
    await expect(fx.upsertEdit({ ...base, snapshot: 'x' })).rejects.toMatchObject(no(400, 'invalid', "An edit's snapshot must be an object."))

    const first = await fx.upsertEdit(base)
    expect(first).toMatchObject({ ...base, workspace_id: WORKSPACE_ID, parent_edit_id: null, snapshot: null, archived_at: null, created_by: PERMISSIONS.userId })
    await expect(fx.upsertEdit({ ...base, title: ' Assembly ' })).rejects.toMatchObject(
      no(409, 'conflict', 'This shot list already has an edit called "Assembly · v1".'))
    const onTwo = await fx.upsertEdit({ ...base, shot_list_id: LIST_2 }) // the same pair on ANOTHER list is no clash

    const badParent = no(400, 'invalid', "an edit's parent must be another edit of the same shot list")
    const second = await fx.upsertEdit({ ...base, version: 2, parent_edit_id: first.id, snapshot: { kind: 'edit' } })
    expect(second.parent_edit_id).toBe(first.id)
    await expect(fx.upsertEdit({ ...second, parent_edit_id: second.id })).rejects.toMatchObject(badParent)
    await expect(fx.upsertEdit({ ...base, version: 3, parent_edit_id: onTwo.id })).rejects.toMatchObject(badParent)
    await expect(fx.upsertEdit({ ...base, version: 3, parent_edit_id: fid('edit', 99) })).rejects.toMatchObject(badParent)
    await expect(fx.upsertEdit({ ...second, shot_list_id: LIST_2 })).rejects.toMatchObject(
      no(403, 'forbidden', 'an edit cannot move to another shot list'))
    await expect(fx.upsertEdit({ ...second, archived_at: '2026-09-30T00:00:00.000Z' })).rejects.toMatchObject(
      no(403, 'forbidden', 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()'))

    const archived = await fx.archiveEdit(PROJECT_ID, first.id)
    expect(archived.archived_by).toBe(PERMISSIONS.userId)
    await expect(fx.upsertEdit({ ...archived, summary: 'x' })).rejects.toMatchObject(
      no(409, 'conflict', 'this edit is archived — restore it before changing it'))
    expect((await fx.archiveEdit(PROJECT_ID, first.id, true)).archived_at).toBe(archived.archived_at)
    const restored = await fx.archiveEdit(PROJECT_ID, first.id, false)
    expect(restored).toMatchObject({ archived_at: null, archived_by: null })
    expect((await fx.upsertEdit({ ...restored, summary: 'Back' })).summary).toBe('Back')
    await expect(fx.archiveEdit(PROJECT_ID, fid('edit', 99))).rejects.toMatchObject(no(404, 'not_found', 'edit not found'))

    const edits = await fx.listEdits(PROJECT_ID)
    expect(edits.map((e) => e.id).sort()).toEqual([first.id, second.id, onTwo.id].sort())
    expect(inCreatedOrder(edits)).toBe(true)
    expect((await fx.loadProject(PROJECT_ID)).edits).toEqual(edits)
  })
})
