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

// The S3a contract's nine shot-list methods plus review round 1's two
// membership deltas (addendum A) and round 2's positions-only reorder (R2-2),
// by name. The cloud-surface test above already demands them once the
// Supabase adapter has them; this pins them on the fixtures side
// independently, so a rename on either side fails.
const SHOT_LIST_SURFACE = [
  'listShotLists', 'upsertShotList', 'listShotListItems', 'replaceShotListItems',
  'upsertShotListItems', 'repositionShotListItems', 'deleteShotListItems',
  'listEdits', 'upsertEdit', 'setActiveShotList', 'archiveShotList', 'archiveEdit',
  // Post-overhaul S3b: the patch path (Edit details), on every adapter.
  'patchShotList',
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

  it('the twelve shot-list methods (S3a contract + the round-1 deltas + the round-2 reorder) exist, by name', () => {
    const fx = buildDevFixtures().rabbitAdapter()
    expect(SHOT_LIST_SURFACE.filter((k) => typeof fx[k] !== 'function')).toEqual([])
  })

  it('the fake cloud refuses tags as 0085\'s CHECKs do (post-overhaul S4a; review round 1, mutant 31)', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const [first] = await fx.listFiles(PROJECT_ID)
    // Each refusal names the CHECK Postgres would (it tests them in
    // alphabetical order: flat, known, len), not one name for all (round 2,
    // R2-TST-14).
    const refusals = [
      [['notes'], /check constraint "files_tags_known_chk"/],
      [['Production'], /check constraint "files_tags_known_chk"/],
      [[null], /check constraint "files_tags_known_chk"/],
      [Array(10).fill('code'), /check constraint "files_tags_len_chk"/],
      [[...Array(9).fill('code'), 'notes'], /check constraint "files_tags_known_chk"/],
      [[['code', 'legal']], /check constraint "files_tags_flat_chk"/],
      [[['notes']], /check constraint "files_tags_flat_chk"/],
      ['shots', /malformed array literal: "shots"/],
    ]
    for (const [tags, says] of refusals) {
      await expect(fx.updateFile(first.id, { tags }), JSON.stringify(tags)).rejects.toThrow(says)
    }
    // CONTROL: the tags a file can be given after it is added are accepted,
    // and so is none. (Legal is not one of them since 0088: next test.)
    await expect(fx.updateFile(first.id, { tags: ['shots', 'reference'] })).resolves.toMatchObject({ tags: ['shots', 'reference'] })
    await expect(fx.updateFile(first.id, { tags: [] })).resolves.toMatchObject({ tags: [] })
  })

  it('the fake cloud refuses what 0088\'s Legal CHECKs refuse, in the cloud adapter\'s words (S4b; review round 1, R1-BEH-08)', async () => {
    const fx = buildDevFixtures().rabbitAdapter()
    const files = await fx.listFiles(PROJECT_ID)
    const plain = files.find((f) => !f.is_financial && !f.tags.includes('legal'))
    const legal = files.find((f) => f.tags.includes('legal'))
    expect(legal, 'the seeded Legal file').toBeTruthy()
    // The refusal is the CHECK's (files_legal_folder_chk sorts before
    // files_tags_known_chk, so a bad word beside it changes nothing), said as
    // supabaseAdapter.updateFile says it: ADDING Legal is "chosen when a file
    // is added"; REMOVING it is "added as Legal".
    const atAdd = 'Legal is chosen when a file is added.'
    const locked = 'Added as Legal. To change this, add the file again.'
    await expect(fx.updateFile(plain.id, { tags: ['legal'] })).rejects.toThrow(atAdd)
    await expect(fx.updateFile(plain.id, { tags: ['legal', 'notes'] })).rejects.toThrow(atAdd)
    // Un-tagging the Legal file, or dropping it from a list of others.
    await expect(fx.updateFile(legal.id, { tags: [] })).rejects.toThrow(locked)
    await expect(fx.updateFile(legal.id, { tags: ['shots'] })).rejects.toThrow(locked)
    // Core on a Legal file.
    await expect(fx.updateFile(legal.id, { is_core_definer: true }))
      .rejects.toThrow('A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads.')
    // CONTROLS: other tags beside legal, a note, and Core on an ordinary file.
    await expect(fx.updateFile(legal.id, { tags: ['legal', 'production'] })).resolves.toMatchObject({ tags: ['legal', 'production'] })
    await expect(fx.updateFile(legal.id, { description: 'countersigned' })).resolves.toMatchObject({ description: 'countersigned' })
    await expect(fx.updateFile(plain.id, { is_core_definer: true })).resolves.toMatchObject({ is_core_definer: true })
    expect(await fx.supportsLegalFiles()).toBe(true)
  })

  it('`?fixtures=member` reads as a plain member: no Legal file and no invoice, nor their events (S4b)', async () => {
    const reviewer = buildDevFixtures().rabbitAdapter()
    const all = await reviewer.listFiles(PROJECT_ID)
    const legal = all.find((f) => f.tags.includes('legal'))
    const invoice = all.find((f) => f.is_financial)
    // CONTROL: the default reviewer (admin, project manager) is given both.
    expect(legal).toBeTruthy()
    expect(invoice).toBeTruthy()
    const member = buildDevFixtures({ variant: 'member' })
    expect(member.permissions.role).toBe('user')
    // The Legal file's own history, so "none" below is a refusal, not an
    // empty stream (CONTROL: the reviewer's adapter over the same event).
    const event = { id: 'ev-legal', file_id: legal.id, project_id: PROJECT_ID, event: 'uploaded', actor_id: 'x', actor_name: 'Theo', detail: {}, created_at: '2026-09-20T10:00:00Z' }
    member.store.fileEvents.push(event)
    const fx = member.rabbitAdapter()
    const seen = await fx.listFiles(PROJECT_ID)
    expect(seen.find((f) => f.id === legal.id)).toBeUndefined()
    expect(seen.find((f) => f.id === invoice.id)).toBeUndefined()
    expect(seen.length).toBe(all.length - all.filter((f) => f.is_financial || f.tags.includes('legal')).length)
    const bundle = await fx.loadProject(PROJECT_ID)
    expect(bundle.files.some((f) => f.tags.includes('legal') || f.is_financial)).toBe(false)
    expect(await fx.listFileEvents(legal.id)).toEqual([])
    const cleared = buildDevFixtures()
    cleared.store.fileEvents.push(event)
    expect((await cleared.rabbitAdapter().listFileEvents(legal.id)).map((e) => e.id)).toEqual(['ev-legal'])
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
// Shot lists, items and edits — the S3a contract's rules 1–8 (migration 0084),
// its round-1 addendum (A: membership deltas, C: a scene delete takes its
// shots, D: titles stored trimmed, E: one linear chain of edits per list) and
// its round-2 addendum (R2-1: B's frozen membership of an archived list is
// REVERTED; R2-2: a reorder writes positions only and never inserts). Every
// refusal is checked for its exact text, HTTP status and code: the provider
// shows the text, and the Local Server and the database refuse the same
// inputs with the same words.
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

  // Post-overhaul S3c, step 2 (D18): a bid version based on a shot list keeps
  // the list's id and the label frozen into its snapshot, as the cloud does.
  it('S3c: a bid version keeps its shot_list_id and its snapshot\'s frozen shot_list, read back by loadProject', async () => {
    const fx = fresh()
    await fx.upsertBudgetVersion({ id: 'bv-s3c', project_id: PROJECT_ID, name: 'Bid on Shoot', type: 'bid', is_active: false,
      shot_list_id: LIST_1, snapshot: { grandTotal: 10, shot_list: { id: LIST_1, title: 'Shot list 1', version: 1 } } })
    const back = (await fx.loadProject(PROJECT_ID)).budgetVersions.find((v) => v.id === 'bv-s3c')
    expect(back.shot_list_id).toBe(LIST_1)
    expect(back.snapshot.shot_list).toEqual({ id: LIST_1, title: 'Shot list 1', version: 1 })
  })

  // ── Post-overhaul S5 (0089): bid versions as living documents ─────────────
  const BV1 = fid('budgetVersion', 1)
  const BV2 = fid('budgetVersion', 2)
  const OPEN_ONLY = 'the open bid version is changed only by someone who can see this project\'s budget (a project manager or a workspace admin)'
  const refusal = async (p) => { try { await p } catch (e) { return { status: e.status, code: e.code, message: e.message } } return null }

  it('S5 (F12.1, F12.2): the seeded bids carry real totals and the lock is stamped on the LOCKED one only', async () => {
    const b = await fresh().loadProject(PROJECT_ID)
    const v1 = b.budgetVersions.find(v => v.id === BV1)
    const v2 = b.budgetVersions.find(v => v.id === BV2)
    expect(v2.snapshot.totals.overall).toBeGreaterThan(0)
    expect(v2.snapshot.totals.overall).toBeGreaterThan(v2.snapshot.totals.beforeAgency) // the agency fee is on in the dataset
    expect(v1.snapshot.totals.overall).toBeGreaterThan(0)
    expect(Array.isArray(v2.snapshot.phases) && v2.snapshot.phases.length).toBeTruthy()
    expect(b.project.budget_active_version_id).toBe(BV2)
    expect(v2.locked_at).toBeTruthy()
    expect(v1.locked_at).toBeNull()
    expect(b.project.open_budget_version_id).toBeNull()
  })

  it('S5: the open pointer moves to one of the project\'s versions, and back to none', async () => {
    const fx = fresh()
    await fx.updateProject(PROJECT_ID, { open_budget_version_id: BV1 })
    expect((await fx.loadProject(PROJECT_ID)).project.open_budget_version_id).toBe(BV1)
    await fx.updateProject(PROJECT_ID, { open_budget_version_id: null })
    expect((await fx.loadProject(PROJECT_ID)).project.open_budget_version_id).toBeNull()
  })

  it('S5: a pointer to a version that is not this project\'s is refused (the same-project FK)', async () => {
    expect(await refusal(fresh().updateProject(PROJECT_ID, { open_budget_version_id: 'not-a-version' })))
      .toEqual(no(400, 'invalid', 'bid version not found in this project'))
  })

  it('S5: someone the money gate refuses cannot move the open pointer, read a version, or choose the selected bid', async () => {
    const fx = buildDevFixtures({ variant: 'member' }).rabbitAdapter()
    expect(await refusal(fx.updateProject(PROJECT_ID, { open_budget_version_id: BV1 }))).toEqual(no(403, 'forbidden', OPEN_ONLY))
    expect((await fx.loadProject(PROJECT_ID)).budgetVersions).toEqual([])
    expect((await refusal(fx.selectBudgetVersion(PROJECT_ID, BV1))).status).toBe(403)
    expect((await refusal(fx.patchBudgetVersion(PROJECT_ID, BV1, { summary: 'x' }))).status).toBe(403)
    // CONTROL: the same member still saves another project field.
    await fx.updateProject(PROJECT_ID, { description: 'member wrote this' })
    expect((await fx.loadProject(PROJECT_ID)).project.description).toBe('member wrote this')
  })

  it('S5: selectBudgetVersion leaves exactly one selected; null clears; an unknown id is 404', async () => {
    const fx = fresh()
    expect(await fx.selectBudgetVersion(PROJECT_ID, BV1)).toBe(BV1)
    let vs = (await fx.loadProject(PROJECT_ID)).budgetVersions
    expect(vs.filter(v => v.is_active).map(v => v.id)).toEqual([BV1])
    expect(await fx.selectBudgetVersion(PROJECT_ID, null)).toBeNull()
    vs = (await fx.loadProject(PROJECT_ID)).budgetVersions
    expect(vs.some(v => v.is_active)).toBe(false)
    expect((await refusal(fx.selectBudgetVersion(PROJECT_ID, 'nope'))).status).toBe(404)
  })

  it('S5: patchBudgetVersion writes only the named columns — a newer note written elsewhere survives', async () => {
    const fx = fresh()
    await fx.patchBudgetVersion(PROJECT_ID, BV1, { summary: 'newer note' })
    await fx.patchBudgetVersion(PROJECT_ID, BV1, { name: 'Renamed' })
    const v1 = (await fx.loadProject(PROJECT_ID)).budgetVersions.find(v => v.id === BV1)
    expect(v1).toMatchObject({ name: 'Renamed', summary: 'newer note' })
  })

  it('S5: deleting a version clears the project\'s locked and open pointers to it (the FKs\' SET NULL)', async () => {
    const fx = fresh()
    await fx.updateProject(PROJECT_ID, { open_budget_version_id: BV2 })
    await fx.deleteBudgetVersion(BV2)
    const p = (await fx.loadProject(PROJECT_ID)).project
    expect(p.budget_active_version_id).toBeNull()
    expect(p.open_budget_version_id).toBeNull()
  })

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

  it('patchShotList (S3b): changes only the named columns of a stored list — the upsert\'s rules, never a new list', async () => {
    const fx = fresh()
    const before = (await fx.listShotLists(PROJECT_ID)).find((l) => l.id === LIST_1)
    // Another client's newer summary is on the row; this patch names only the title.
    await fx.patchShotList(PROJECT_ID, LIST_1, { summary: 'Theirs, newer' })
    const renamed = await fx.patchShotList(PROJECT_ID, LIST_1, { title: '  Main shoot ' })
    expect(renamed).toMatchObject({ id: LIST_1, project_id: PROJECT_ID, title: 'Main shoot', version: before.version, summary: 'Theirs, newer' })
    expect(renamed.snapshot).toEqual(before.snapshot)
    // The row's identity comes from the arguments, not the patch.
    expect((await fx.patchShotList(PROJECT_ID, LIST_1, { id: 'other', project_id: 'other', version: 2 })).id).toBe(LIST_1)
    // The upsert's rules: a blank title, a taken pair, an archived row.
    await expect(fx.patchShotList(PROJECT_ID, LIST_1, { title: ' ' })).rejects.toMatchObject(no(400, 'invalid', 'A shot list needs a title.'))
    await fx.archiveShotList(PROJECT_ID, LIST_2, false)
    await expect(fx.patchShotList(PROJECT_ID, LIST_2, { title: 'Main shoot', version: 2 })).rejects.toMatchObject(
      no(409, 'conflict', 'There is already a shot list called "Main shoot · v2".'))
    await fx.archiveShotList(PROJECT_ID, LIST_2)
    await expect(fx.patchShotList(PROJECT_ID, LIST_2, { summary: 'x' })).rejects.toMatchObject(
      no(409, 'conflict', 'this shot list is archived — restore it before changing it'))
    // Not a list of this project: not found, and nothing made.
    const count = (await fx.listShotLists(PROJECT_ID)).length
    await expect(fx.patchShotList(PROJECT_ID, fid('shotList', 99), { title: 'Ghost' })).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(fx.patchShotList(fid('project', 99), LIST_1, { title: 'Ghost' })).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    expect((await fx.listShotLists(PROJECT_ID)).length).toBe(count)
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
    // The Local Server's words for one id twice (the database's "cannot affect row a second time").
    const twice = current[0].id
    await expect(fx.replaceShotListItems(PROJECT_ID, LIST_1, [{ id: twice, scene_id: SCENE(1) }, { id: twice, scene_id: SCENE(2) }]))
      .rejects.toMatchObject(no(400, 'invalid', 'an item id appears more than once'))

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
    // An ARCHIVED list's membership is writable again (review round 2, R2-1;
    // round 1 froze it): a bulk restore reaches list 2, and the list row
    // itself stays archived and untouched.
    const listRow = (await fx.listShotLists(PROJECT_ID)).find((l) => l.id === LIST_2)
    expect(typeof listRow.archived_at).toBe('string')
    const ids = (rows) => rows.map((i) => i.id).sort()
    expect(ids(await fx.replaceShotListItems(PROJECT_ID, LIST_2, two.slice(0, 2)))).toEqual(ids(two.slice(0, 2)))
    expect(ids((await fx.listShotListItems(PROJECT_ID)).filter((i) => i.shot_list_id === LIST_2))).toEqual(ids(two.slice(0, 2)))
    expect((await fx.listShotLists(PROJECT_ID)).find((l) => l.id === LIST_2)).toEqual(listRow)
  })

  it('deleting a scene takes its SHOTS too; each leaves every list and unlinks its tasks; asset arrays and edits keep them', async () => {
    const fx = fresh()
    const [t1, t2, t3] = await fx.listTasks(PROJECT_ID)
    await fx.patchTask(t1.id, { scene_id: SCENE(3), shot_id: SHOT(7) })
    await fx.patchTask(t2.id, { shot_id: SHOT(8) }) // linked to a shot of scene 3 only
    await fx.patchTask(t3.id, { scene_id: SCENE(4), shot_id: SHOT(10) }) // the control: another scene
    const [asset] = await fx.listAssets(PROJECT_ID)
    await fx.patchAsset(asset.id, { scene_ids: [SCENE(3)], shot_ids: [SHOT(7), SHOT(8)] })
    const edit = await fx.upsertEdit({
      project_id: PROJECT_ID, shot_list_id: LIST_1, title: 'Assembly',
      items: [{ id: 'e1', scene_id: SCENE(3), shot_id: SHOT(8), label: 'Her side', notes: '' }],
    })
    const before = await fx.listShotListItems(PROJECT_ID)
    const held = (id) => before.filter((i) => i.scene_id === id || i.shot_id === id).length
    expect([SCENE(3), SHOT(7), SHOT(8), SHOT(9)].map(held)).toEqual([2, 2, 2, 2]) // in both lists (Pickups is archived)
    const taskOf = async (id) => (await fx.listTasks(PROJECT_ID)).find((t) => t.id === id)

    await fx.deleteShot(SHOT(7), PROJECT_ID)
    let items = await fx.listShotListItems(PROJECT_ID)
    expect(items.some((i) => i.shot_id === SHOT(7))).toBe(false)
    expect(items.length).toBe(before.length - 2)
    expect(await taskOf(t1.id)).toMatchObject({ scene_id: SCENE(3), shot_id: null })

    // Review round 1, addendum C: 0040's shots.scene_id is ON DELETE CASCADE,
    // so the scene's two remaining shots (8, 9) go in the SAME write, and each
    // one's own rule-8 sweep runs. Before R1 the fixtures kept them.
    await fx.deleteScene(SCENE(3), PROJECT_ID)
    expect((await fx.listScenes(PROJECT_ID)).some((s) => s.id === SCENE(3))).toBe(false)
    const shots = await fx.listShots(PROJECT_ID)
    expect(shots.some((s) => s.scene_id === SCENE(3))).toBe(false)
    expect(shots.length).toBe(16 - 3)
    items = await fx.listShotListItems(PROJECT_ID)
    expect(items.some((i) => [SCENE(3), SHOT(8), SHOT(9)].includes(i.scene_id || i.shot_id))).toBe(false)
    expect(items.length).toBe(before.length - 8) // scene 3's 2 items, and 2 each for shots 7, 8, 9
    expect(await taskOf(t1.id)).toMatchObject({ scene_id: null, shot_id: null })
    expect(await taskOf(t2.id)).toMatchObject({ shot_id: null }) // swept by the CASCADED shot
    expect(await taskOf(t3.id)).toMatchObject({ scene_id: SCENE(4), shot_id: SHOT(10) }) // another scene: untouched
    expect(items.filter((i) => i.shot_id === SHOT(10)).length).toBe(1) // ...and so are its items

    // Not swept, as in the cloud: asset arrays (not FKs) and edits (D17: "Missing shot").
    expect((await fx.listAssets(PROJECT_ID)).find((a) => a.id === asset.id)).toMatchObject({ scene_ids: [SCENE(3)], shot_ids: [SHOT(7), SHOT(8)] })
    expect((await fx.listEdits(PROJECT_ID)).find((e) => e.id === edit.id).items[0].shot_id).toBe(SHOT(8))
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
    // A NEW edit naming itself (edits_not_own_parent_chk). A STORED edit
    // cannot change its parent at all since R1 (the chain test below: 403).
    await expect(fx.upsertEdit({ ...base, id: fid('edit', 50), version: 3, parent_edit_id: fid('edit', 50) })).rejects.toMatchObject(badParent)
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

  // ── Review round 1 (the S3a addendum) ─────────────────────────────────────

  it("A: upsertShotListItems writes ONLY the named rows — inserts, updates its own, skips another list's ids, deletes nothing", async () => {
    const fx = fresh()
    const all = await fx.listShotListItems(PROJECT_ID)
    const one = all.filter((i) => i.shot_list_id === LIST_1)
    const two = all.filter((i) => i.shot_list_id === LIST_2)
    const scene7 = await fx.upsertScene({ project_id: PROJECT_ID, name: 'Epilogue', scene_number: 7 })
    const shot17 = await fx.upsertShot({ project_id: PROJECT_ID, scene_id: scene7.id, name: 'Last light', shot_number: 10 })
    const keep = one.find((i) => i.scene_id === SCENE(1))
    const unknownId = fid('shotListItem', 900)
    const written = await fx.upsertShotListItems(PROJECT_ID, LIST_1, [
      { id: keep.id, scene_id: SCENE(1), position: 5 }, // its own row, moved
      { scene_id: scene7.id, position: 6 }, // no id: a new one
      { id: two[0].id, scene_id: SCENE(6) }, // list 2's id: skipped — so not a second SCENE(6) either
      { id: unknownId, shot_id: shot17.id }, // an unknown id is inserted with it; no position = its index, 3
    ])
    // The rows written, in the order given; the skipped one is absent.
    expect(written.map((i) => [i.scene_id || i.shot_id, i.position])).toEqual([[SCENE(1), 5], [scene7.id, 6], [shot17.id, 3]])
    expect(written[0]).toMatchObject({ id: keep.id, created_at: keep.created_at })
    expect(written[0].updated_at).not.toBe(keep.updated_at)
    expect(written[1].id).not.toBe(two[0].id)
    expect(written[2].id).toBe(unknownId)
    expect(written.every((i) => i.shot_list_id === LIST_1 && i.project_id === PROJECT_ID && i.workspace_id === WORKSPACE_ID)).toBe(true)

    const after = await fx.listShotListItems(PROJECT_ID)
    const oneAfter = after.filter((i) => i.shot_list_id === LIST_1)
    expect(oneAfter.length).toBe(one.length + 2) // nothing unnamed was deleted
    for (const i of one) if (i.id !== keep.id) expect(oneAfter.find((r) => r.id === i.id), i.id).toEqual(i)
    expect(after.filter((i) => i.shot_list_id === LIST_2)).toEqual(two)

    // A row re-sent with its OWN scene is not a duplicate of itself.
    expect((await fx.upsertShotListItems(PROJECT_ID, LIST_1, [{ id: keep.id, scene_id: SCENE(1), position: 0 }]))[0].position).toBe(0)
    expect(await fx.upsertShotListItems(PROJECT_ID, LIST_1, [])).toEqual([])
  })

  it('A: upsertShotListItems refuses every bad input, and a duplicate across the WHOLE list after the write, writing nothing', async () => {
    const fx = fresh()
    const other = await fx.createProject({ title: 'Another film' })
    const foreign = await fx.upsertScene({ project_id: other.id, name: 'Elsewhere', scene_number: 1 })
    const scene7 = await fx.upsertScene({ project_id: PROJECT_ID, name: 'Epilogue', scene_number: 7 })
    const before = await fx.listShotListItems(PROJECT_ID)
    const rowOf = (id) => before.find((i) => i.shot_list_id === LIST_1 && (i.scene_id === id || i.shot_id === id))
    const up = (items, listId = LIST_1, projectId = PROJECT_ID) => fx.upsertShotListItems(projectId, listId, items)
    const shape = no(400, 'invalid', 'each item names exactly one scene or one shot')
    const once = no(409, 'conflict', 'a shot list holds each scene and each shot once')

    await expect(up([], fid('shotList', 99))).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(up([], LIST_1, other.id)).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(up({ items: [] })).rejects.toMatchObject(no(400, 'invalid', 'items must be a JSON array'))
    await expect(up([{ scene_id: SCENE(1), shot_id: SHOT(1) }])).rejects.toMatchObject(shape)
    await expect(up([{ scene_id: '', position: 0 }])).rejects.toMatchObject(shape)
    await expect(up(['x'])).rejects.toMatchObject(shape)
    await expect(up([{ scene_id: foreign.id }])).rejects.toMatchObject(no(400, 'invalid', 'an item names a scene or shot that is not in this project'))
    await expect(up([{ id: rowOf(SHOT(1)).id, shot_id: SHOT(1), position: -1 }])).rejects.toMatchObject(
      no(400, 'invalid', "an item's position must be a whole number of at least 0"))
    await expect(up([{ id: rowOf(SHOT(1)).id, shot_id: SHOT(1) }, { id: rowOf(SHOT(1)).id, shot_id: SHOT(1) }])).rejects.toMatchObject(
      no(400, 'invalid', 'an item id appears more than once'))
    // Once in the list AFTER the write — the unnamed rows count, not only the payload:
    await expect(up([{ scene_id: SCENE(2) }])).rejects.toMatchObject(once) // SCENE(2) is already held by another row
    await expect(up([{ id: rowOf(SCENE(1)).id, scene_id: SCENE(2) }])).rejects.toMatchObject(once) // re-pointed onto a held scene
    await expect(up([{ scene_id: scene7.id }, { scene_id: scene7.id }])).rejects.toMatchObject(once) // twice in the payload
    // All-or-nothing: a valid move followed by one bad item wrote nothing.
    await expect(up([{ id: rowOf(SCENE(1)).id, scene_id: SCENE(1), position: 9 }, { scene_id: foreign.id }])).rejects.toMatchObject({ status: 400 })
    expect(await fx.listShotListItems(PROJECT_ID)).toEqual(before)
  })

  it('A: deleteShotListItems deletes exactly the named items of THIS list and reports them; anything else is ignored', async () => {
    const fx = fresh()
    const before = await fx.listShotListItems(PROJECT_ID)
    const one = before.filter((i) => i.shot_list_id === LIST_1)
    const two = before.filter((i) => i.shot_list_id === LIST_2)
    const [a, b] = [one[0].id, one[5].id]
    const answer = await fx.deleteShotListItems(PROJECT_ID, LIST_1, [b, a, fid('shotListItem', 900), two[0].id, a, '', null])
    expect(answer).toEqual({ deleted: [b, a] }) // the order given, each once; the unknown id and list 2's id are ignored
    const after = await fx.listShotListItems(PROJECT_ID)
    expect(after.filter((i) => i.shot_list_id === LIST_1).map((i) => i.id).sort())
      .toEqual(one.map((i) => i.id).filter((id) => id !== a && id !== b).sort())
    expect(after.filter((i) => i.shot_list_id === LIST_2)).toEqual(two)
    expect(await fx.deleteShotListItems(PROJECT_ID, LIST_1, [a])).toEqual({ deleted: [] }) // already gone: not an error
    await expect(fx.deleteShotListItems(PROJECT_ID, LIST_1, a)).rejects.toMatchObject(no(400, 'invalid', 'ids must be a JSON array'))
    await expect(fx.deleteShotListItems(PROJECT_ID, fid('shotList', 99), [])).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    expect((await fx.listShotListItems(PROJECT_ID)).length).toBe(before.length - 2)
  })

  // ── Review round 2 (the S3a R2 addendum) ──────────────────────────────────

  it("R2-1: an ARCHIVED list's membership takes every item write again, so the undo of a scene delete puts it back", async () => {
    const fx = fresh()
    const pickups = async () => (await fx.listShotListItems(PROJECT_ID)).filter((i) => i.shot_list_id === LIST_2)
    const listRowNow = async () => (await fx.listShotLists(PROJECT_ID)).find((l) => l.id === LIST_2)
    const seeded = await pickups()
    expect(seeded.length).toBe(7) // the seeded "Pickups · v1" IS archived
    const listRow = await listRowNow()
    expect(typeof listRow.archived_at).toBe('string')
    const kept = (...ids) => seeded.filter((i) => ids.includes(i.scene_id || i.shot_id))
    const shape = (rows) => rows.map((i) => `${i.id}:${i.scene_id || i.shot_id}@${i.position}`).sort()

    // The ROW stays frozen (rule 1); only its MEMBERSHIP was unfrozen.
    await expect(fx.upsertShotList({ ...listRow, summary: 'x' })).rejects.toMatchObject(
      no(409, 'conflict', 'this shot list is archived — restore it before changing it'))
    // Writes to the LIVE list that name list 2's ids never reach it.
    expect(await fx.upsertShotListItems(PROJECT_ID, LIST_1, [{ id: seeded[1].id, scene_id: SCENE(6) }])).toEqual([])
    expect(await fx.repositionShotListItems(PROJECT_ID, LIST_1, [{ id: seeded[1].id, position: 9 }])).toEqual([])
    expect(await fx.deleteShotListItems(PROJECT_ID, LIST_1, seeded.map((i) => i.id))).toEqual({ deleted: [] })
    expect(await pickups()).toEqual(seeded)

    // R2-1's scenario: scene 3 is deleted by mistake. The sweep (the cloud's
    // FK CASCADE) takes it — and, addendum C, its shots 7, 8, 9 — out of the
    // archived list; scene 5's rows stay exactly as they were...
    const scene3 = (await fx.listScenes(PROJECT_ID)).find((s) => s.id === SCENE(3))
    const shots3 = (await fx.listShots(PROJECT_ID)).filter((s) => s.scene_id === SCENE(3))
    expect(shots3.length).toBe(3)
    await fx.deleteScene(SCENE(3), PROJECT_ID)
    expect(await pickups()).toEqual(kept(SCENE(5), SHOT(13), SHOT(14)))
    // ...then Ctrl+Z: the rows come back with their ids, and the memberships
    // are written back to the ARCHIVED list too. Round 1's freeze refused
    // this write, so the archived list lost scene 3 for good.
    await fx.upsertScene(scene3)
    for (const s of shots3) await fx.upsertShot(s)
    const back = kept(SCENE(3), SHOT(7), SHOT(8), SHOT(9))
    const written = await fx.upsertShotListItems(PROJECT_ID, LIST_2,
      back.map(({ id, scene_id, shot_id, position }) => ({ id, scene_id, shot_id, position })))
    expect(written.map((i) => i.id)).toEqual(back.map((i) => i.id))
    expect(shape(await pickups())).toEqual(shape(seeded))

    // Reorder, add, delete and a whole replace each land on the archived list.
    const [sc5, sc3] = [kept(SCENE(5))[0], kept(SCENE(3))[0]]
    expect((await fx.repositionShotListItems(PROJECT_ID, LIST_2, [{ id: sc5.id, position: 0 }, { id: sc3.id, position: 1 }]))
      .map((i) => [i.id, i.position])).toEqual([[sc5.id, 0], [sc3.id, 1]])
    expect((await fx.upsertShotListItems(PROJECT_ID, LIST_2, [{ scene_id: SCENE(1), position: 2 }])).length).toBe(1)
    expect(await fx.deleteShotListItems(PROJECT_ID, LIST_2, [kept(SHOT(14))[0].id])).toEqual({ deleted: [kept(SHOT(14))[0].id] })
    expect((await pickups()).length).toBe(seeded.length) // one added, one deleted
    expect(await fx.replaceShotListItems(PROJECT_ID, LIST_2, [])).toEqual([])
    expect(await pickups()).toEqual([])
    // Not one of those writes touched the list row: still archived, as it was.
    expect(await listRowNow()).toEqual(listRow)
  })

  it('R2-2: repositionShotListItems moves only rows that EXIST in this list — a stale reorder never re-inserts a removed item', async () => {
    const fx = fresh()
    const before = await fx.listShotListItems(PROJECT_ID)
    const one = before.filter((i) => i.shot_list_id === LIST_1)
    const two = before.filter((i) => i.shot_list_id === LIST_2)
    const rowOf = (id) => one.find((i) => i.scene_id === id || i.shot_id === id)
    const [s1, s2, s3] = [rowOf(SCENE(1)), rowOf(SCENE(2)), rowOf(SCENE(3))]
    expect([s1, s2, s3].map((i) => i.position)).toEqual([0, 1, 2])
    const unknownId = fid('shotListItem', 900)

    // A collaborator removes scene 1 from list 1. This client has not
    // reloaded, and planReorderList re-numbers the whole scene group from its
    // cached rows — the removed item included. Whole rows, as the provider sends.
    await fx.deleteShotListItems(PROJECT_ID, LIST_1, [s1.id])
    const moved = await fx.repositionShotListItems(PROJECT_ID, LIST_1, [
      { ...s3, position: 0 },
      { ...s1, position: 1 }, // removed since: SKIPPED, not re-inserted (the upsert inserted it)
      { ...s2, scene_id: SCENE(6), position: 2 }, // a scene in the payload is ignored: positions only
      { id: two[0].id, position: 7 }, // list 2's item: skipped, list 2 untouched
      { id: unknownId, position: 3 }, // never existed: skipped
    ])
    // The rows updated, in the order given; each changed in position (and its stamp) only.
    expect(moved.map((i) => [i.id, i.position])).toEqual([[s3.id, 0], [s2.id, 2]])
    for (const [row, was] of [[moved[0], s3], [moved[1], s2]]) {
      expect({ ...row, position: was.position, updated_at: was.updated_at, updated_by: was.updated_by }).toEqual(was)
      expect(row.updated_at).not.toBe(was.updated_at) // fn_audit_touch stamps the UPDATE
      expect(row.updated_by).toBe(PERMISSIONS.userId)
    }

    const after = await fx.listShotListItems(PROJECT_ID)
    const oneAfter = after.filter((i) => i.shot_list_id === LIST_1)
    expect(oneAfter.some((i) => i.id === s1.id || i.scene_id === SCENE(1))).toBe(false) // the removal stands
    expect(after.some((i) => i.id === unknownId)).toBe(false)
    expect(oneAfter.length).toBe(one.length - 1)
    expect(oneAfter.find((i) => i.id === s2.id).scene_id).toBe(SCENE(2))
    for (const i of one) if (![s1.id, s2.id, s3.id].includes(i.id)) expect(oneAfter.find((r) => r.id === i.id), i.id).toEqual(i)
    expect(after.filter((i) => i.shot_list_id === LIST_2)).toEqual(two)

    // An unchanged position is still an UPDATE: the row comes back, stamped.
    const again = await fx.repositionShotListItems(PROJECT_ID, LIST_1, [{ id: s2.id, position: 2 }])
    expect(again.map((i) => [i.id, i.position])).toEqual([[s2.id, 2]])
    expect(await fx.repositionShotListItems(PROJECT_ID, LIST_1, [])).toEqual([])
  })

  it('R2-2: repositionShotListItems refuses a bad payload — an id, a position, one id twice — before writing anything', async () => {
    const fx = fresh()
    const before = await fx.listShotListItems(PROJECT_ID)
    const [a, b] = before.filter((i) => i.shot_list_id === LIST_1)
    const move = (items, listId = LIST_1, projectId = PROJECT_ID) => fx.repositionShotListItems(projectId, listId, items)
    // The Local Server's and the cloud adapter's words for the same refusals.
    const needsId = no(400, 'invalid', 'each item of a reorder needs an id')
    const badPosition = no(400, 'invalid', "an item's position must be a whole number of at least 0")
    const twice = no(400, 'invalid', 'an item id appears more than once')

    await expect(move([], fid('shotList', 99))).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(move([], LIST_1, fid('project', 99))).rejects.toMatchObject(no(404, 'not_found', 'shot list not found'))
    await expect(move({ items: [] })).rejects.toMatchObject(no(400, 'invalid', 'items must be a JSON array'))
    await expect(move([{ position: 0 }])).rejects.toMatchObject(needsId)
    await expect(move([{ id: '', position: 0 }])).rejects.toMatchObject(needsId)
    await expect(move(['x'])).rejects.toMatchObject(needsId)
    await expect(move([{ id: a.id, position: -1 }])).rejects.toMatchObject(badPosition)
    await expect(move([{ id: a.id, position: 1.5 }])).rejects.toMatchObject(badPosition)
    // REQUIRED, unlike the upsert's "missing = its index": a move with no destination is malformed.
    await expect(move([{ id: a.id }])).rejects.toMatchObject(badPosition)
    await expect(move([{ id: a.id, position: 3 }, { id: a.id, position: 4 }])).rejects.toMatchObject(twice)
    // ...even for an id that would only have been skipped (the other backends check before they filter).
    await expect(move([{ id: fid('shotListItem', 900), position: 3 }, { id: fid('shotListItem', 900), position: 4 }])).rejects.toMatchObject(twice)
    // All-or-nothing: two valid moves, then a bad position on an id that
    // would only have been skipped, wrote nothing.
    await expect(move([{ id: a.id, position: 9 }, { id: b.id, position: 8 }, { id: fid('shotListItem', 900), position: -1 }]))
      .rejects.toMatchObject(badPosition)
    expect(await fx.listShotListItems(PROJECT_ID)).toEqual(before)
  })

  it('D: titles are stored TRIMMED, for lists and edits, and the (title, version) key compares the stored title', async () => {
    const fx = fresh()
    const list = await fx.upsertShotList({ project_id: PROJECT_ID, title: "  Director's cut  ", version: 1 })
    expect(list.title).toBe("Director's cut")
    expect((await fx.listShotLists(PROJECT_ID)).find((l) => l.id === list.id).title).toBe("Director's cut")
    await expect(fx.upsertShotList({ project_id: PROJECT_ID, title: "Director's cut", version: 1 })).rejects.toMatchObject(
      no(409, 'conflict', 'There is already a shot list called "Director\'s cut · v1".'))
    expect((await fx.upsertShotList({ ...list, title: ' Final ' })).title).toBe('Final')

    const edit = await fx.upsertEdit({ project_id: PROJECT_ID, shot_list_id: LIST_1, title: ' Assembly ', items: [] })
    expect(edit.title).toBe('Assembly')
    expect((await fx.listEdits(PROJECT_ID)).find((e) => e.id === edit.id).title).toBe('Assembly')
    expect((await fx.upsertEdit({ ...edit, title: 'Assembly, tightened  ' })).title).toBe('Assembly, tightened')
  })

  it('E: edits form ONE linear chain per list — one root, one child each, and a place that never changes (D6)', async () => {
    const fx = fresh()
    const base = { project_id: PROJECT_ID, shot_list_id: LIST_1, title: 'Cut', items: [] }
    const oneRoot = no(409, 'conflict', "this shot list's edits form one chain — a new edit continues from the latest one")
    const oneChild = no(409, 'conflict', "an edit's parent must be the latest edit of its shot list")
    const fixed = no(403, 'forbidden', "an edit's place in its chain cannot change")

    const v1 = await fx.upsertEdit({ ...base, version: 1 })
    await expect(fx.upsertEdit({ ...base, title: 'Another start', version: 1 })).rejects.toMatchObject(oneRoot)
    await expect(fx.upsertEdit({ ...base, version: 2, parent_edit_id: null })).rejects.toMatchObject(oneRoot)
    const v2 = await fx.upsertEdit({ ...base, version: 2, parent_edit_id: v1.id })
    await expect(fx.upsertEdit({ ...base, title: 'Branch', version: 1, parent_edit_id: v1.id })).rejects.toMatchObject(oneChild) // v1 already continues as v2
    const v3 = await fx.upsertEdit({ ...base, version: 3, parent_edit_id: v2.id }) // from the latest: accepted
    expect(v3.parent_edit_id).toBe(v2.id)

    // A stored edit never changes its place: not to another parent, not to none, not into a cycle.
    await expect(fx.upsertEdit({ ...v1, parent_edit_id: v3.id })).rejects.toMatchObject(fixed) // would close a cycle
    await expect(fx.upsertEdit({ ...v2, parent_edit_id: null })).rejects.toMatchObject(fixed)
    await expect(fx.upsertEdit({ ...v3, parent_edit_id: v1.id })).rejects.toMatchObject(fixed)
    // Only a CHANGE is refused: the whole row back, or a patch without the key, passes.
    expect((await fx.upsertEdit({ ...v3, summary: 'Tightened' })).parent_edit_id).toBe(v2.id)
    expect((await fx.upsertEdit({ id: v2.id, project_id: PROJECT_ID, summary: 'Second pass' })).parent_edit_id).toBe(v1.id)

    // The indexes cover archived edits too: v2's child is still v3.
    await fx.archiveEdit(PROJECT_ID, v3.id)
    await expect(fx.upsertEdit({ ...base, version: 4, parent_edit_id: v2.id })).rejects.toMatchObject(oneChild)
    // One root per LIST: another list starts its own chain.
    const other = await fx.upsertShotList({ project_id: PROJECT_ID, title: 'Second unit', version: 1 })
    expect((await fx.upsertEdit({ ...base, shot_list_id: other.id, version: 1 })).parent_edit_id).toBeNull()
    expect((await fx.listEdits(PROJECT_ID)).length).toBe(4) // nothing refused was written
  })
})
