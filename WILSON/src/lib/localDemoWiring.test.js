// =============================================================================
// localDemoWiring.test.js — demo sprint, 2026-09-10.
//
// Source-scan wiring guards for the local demo folder, in the
// workspaceRootWiring.test.js tradition: a green unit test proves the module
// is CORRECT, never that anything CALLS it. Ten features have shipped in
// this repo with no caller. Every seam the feature added is pinned here to
// its call site, and the root-aware helpers in main.cjs are pinned to the
// shared module rather than to a re-derived path.
//
// 🚨 And one NEGATIVE pin. Audrey, 2026-09-10: "remove the work locally
// button at login. user still needs to login no matter what." The folder is
// chosen from Settings → Storage after sign-in; the sign-in screen and the
// shell gate in App.jsx carry nothing of this feature.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describeLocalState, folderLeaf, resetConfirmText, planDemoProject, seedDemoProject } from '../components/local/localDemoClient'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const mainCjs = read('../../electron/main.cjs')
const preloadCjs = read('../../electron/preload.cjs')
const appJsx = read('../App.jsx')
const loginScreen = read('../cloud/auth/LoginScreen.jsx')
const storageConnections = read('../components/settings/StorageConnections.jsx')
const client = read('../components/local/localDemoClient.js')

describe('main.cjs — the data-root layer is root-aware through ONE module', () => {
  it('requires localDemoRoot.cjs and creates the root from userData', () => {
    expect(mainCjs).toMatch(/require\('\.\/localDemoRoot\.cjs'\)/)
    expect(mainCjs).toMatch(/makeLocalDemoRoot\(\{\s*userDataDir: app\.getPath\('userData'\)/)
  })
  it('getRabbitDataDir consults the demo data dir before userData', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function getRabbitDataDir('),
      mainCjs.indexOf('function localDemo('),
    )
    expect(fn).toContain("localDemoDataDir() || path.join(app.getPath('userData'), 'rabbit-data')")
  })
  it('getThumbCacheDir still hangs off getRabbitDataDir (so thumbnails follow the folder)', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function getThumbCacheDir('),
      mainCjs.indexOf('function getThumbCacheDir(') + 200,
    )
    expect(fn).toContain("path.join(getRabbitDataDir(), 'thumbnails')")
  })
  it('resolveConfiguredRootDir puts the demo projects/ folder first', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function resolveConfiguredRootDir('),
      mainCjs.indexOf('function folderRootRefusal('),
    )
    expect(fn.indexOf('localDemoProjectsDir()')).toBeGreaterThan(-1)
    expect(fn.indexOf('localDemoProjectsDir()')).toBeLessThan(fn.indexOf('workspaceRootDir'))
  })
  it('folderRootRefusal contains a project folder inside the open demo folder', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function folderRootRefusal('),
      mainCjs.indexOf('function getNextVersion('),
    )
    expect(fn).toContain('const demoRoot = localDemoRootDir()')
    expect(fn).toContain('isPathInside(demoRoot, resolved)')
    // and the demo arm sits BEFORE the workspace arm, like the resolver.
    expect(fn.indexOf('localDemoRootDir()')).toBeLessThan(fn.indexOf('if (workspaceRootDir) {'))
  })
  it('the relink authorisation counts the open demo folder as user-chosen', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function isUserAuthorizedRelinkDir'),
      mainCjs.indexOf('function rabbitLogFileEvent'),
    )
    expect(fn).toContain('localDemoRootDir(); if (d) roots.push(d)')
  })
  it('readRabbitBundle rebases a folder_root that points outside the open folder', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function readRabbitBundle('),
      mainCjs.indexOf('function writeRabbitBundle('),
    )
    expect(fn).toContain('!isPathInside(demoRoot, cur)')
    expect(fn).toContain('bundle.project.folder_root = path.join(localDemoProjectsDir(), slug)')
  })
  it('the folder is loaded in app.whenReady BEFORE the legacy cleanups derive a data dir', () => {
    const ready = mainCjs.slice(mainCjs.indexOf('app.whenReady().then('), mainCjs.indexOf('app.whenReady().then(') + 600)
    expect(ready.indexOf('localDemo().load()')).toBeGreaterThan(-1)
    expect(ready.indexOf('localDemo().load()')).toBeLessThan(ready.indexOf('cleanupLegacySupabaseConfig()'))
  })
  it('every IPC handler the bridge exposes is registered, and open is gated on a user pick', () => {
    for (const ch of ['get-state', 'pick', 'open', 'close', 'forget', 'reset', 'open-in-explorer']) {
      expect(mainCjs).toContain(`ipcMain.handle('local-demo:${ch}'`)
      expect(preloadCjs).toContain(`ipcRenderer.invoke('local-demo:${ch}'`)
    }
    const open = mainCjs.slice(
      mainCjs.indexOf("ipcMain.handle('local-demo:open'"),
      mainCjs.indexOf("ipcMain.handle('local-demo:close'"),
    )
    expect(open).toContain('!userAuthorizedDirs.has(key) && !localDemo().isKnownFolder(folder)')
    const pick = mainCjs.slice(
      mainCjs.indexOf("ipcMain.handle('local-demo:pick'"),
      mainCjs.indexOf("ipcMain.handle('local-demo:open'"),
    )
    expect(pick).toContain('userAuthorizedDirs.add(path.resolve(picked).toLowerCase())')
  })
  it('the DEV-ONLY knobs are gated on !app.isPackaged', () => {
    expect(mainCjs).toMatch(/!app\.isPackaged && process\.env\.WILSON_USER_DATA/)
    expect(mainCjs).toMatch(/!app\.isPackaged && process\.env\.WILSON_DEV_OFFLINE === '1'/)
  })
})

describe('the sign-in gate stays (Audrey, 2026-09-10)', () => {
  it('the sign-in screen carries nothing of this feature', () => {
    expect(loginScreen).not.toMatch(/WorkLocally|localDemo|work locally/i)
  })
  it('App.jsx opens the shell on `authed` alone — no local door beside the session check', () => {
    expect(appJsx).not.toMatch(/localDemo|localMode|localDoor/)
    expect(appJsx).toContain('checkSessionValid().then(session => {')
    expect(appJsx).toMatch(/\{authed && \(\s*<div style=\{\{ height: '100vh'/)
  })
  it('the client exposes no "door" for a boot path to consult', () => {
    expect(client).not.toMatch(/DoorOpen/)
  })
})

describe('the Storage card — the one way in, and every seam has its caller', () => {
  it('rides the shared client, and reloads on success', () => {
    expect(storageConnections).toContain('pickLocalFolder(')
    expect(storageConnections).toContain('reopenLocalFolder(')
    expect(storageConnections).toContain('reloadApp()')
    // the client pins Local Server mode before the reload
    const pick = client.slice(client.indexOf('export async function pickLocalFolder'), client.indexOf('export async function reopenLocalFolder'))
    expect(pick.match(/await pinLocalServerMode\(\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(client).toContain("adapterMode: 'local_server', activeProjectId: null")
  })
  it('keeps the S34 gate on every machine-wide repoint', () => {
    expect(storageConnections).toMatch(/perms\.ready && \(!perms\.workspaceId \|\| perms\.role === 'admin'\)/)
    const gated = storageConnections.match(/GatedAction allowed=\{canEditMachineRoot\}/g) || []
    expect(gated.length).toBeGreaterThanOrEqual(6)
    const refusals = storageConnections.match(/if \(!canEditMachineRoot\) return/g) || []
    expect(refusals.length).toBeGreaterThanOrEqual(4)
  })
  it('shows the folder in full, opens it in Explorer, closes it, and never signs anyone out', () => {
    expect(storageConnections).toContain('demo.openInExplorer()')
    expect(storageConnections).toContain('await demo.close()')
    expect(storageConnections).toContain('Change folder…')
    expect(storageConnections).not.toContain('wilsonSignOut')
  })
})

describe('demo comfort (brief §3.4) — reset names what it deletes; the seed is the shape ScenesView writes', () => {
  it('the card confirms a reset with the folder and both subtrees named, then reloads', () => {
    expect(storageConnections).toContain('window.confirm(resetConfirmText(demoState.active))')
    expect(storageConnections).toContain('await demo.reset()')
    const text = resetConfirmText('D:\\Demos\\Friday')
    expect(text).toContain('"Friday"')
    expect(text).toContain('D:\\Demos\\Friday\\projects')
    expect(text).toContain('D:\\Demos\\Friday\\.wilson\\rabbit-data')
    expect(text).toMatch(/Nothing outside this folder is touched/)
    expect(resetConfirmText('/Volumes/Drive/demo')).toContain('/Volumes/Drive/demo/projects')
  })
  it('the card seeds through the provider and the adapter, gated on Local Server', () => {
    expect(storageConnections).toContain("rabbit?.adapterMode === 'local_server'")
    expect(storageConnections).toContain('seedDemoProject({ createProject: rabbit.createProject, adapter: rabbit.getAdapter?.() })')
  })
  it('planDemoProject: scenes on, two scenes, five shots, every shot on a scene, numbered per scene', () => {
    let n = 0
    const plan = planDemoProject({ newId: () => `id-${++n}` })
    expect(plan.project).toMatchObject({ id: 'id-1', scenes_enabled: true, status: 'active' })
    expect(plan.scenes).toHaveLength(2)
    expect(plan.shots).toHaveLength(5)
    for (const s of plan.scenes) expect(s).toMatchObject({ project_id: 'id-1', status: 'not_started', type: 'interior' })
    const sceneIds = new Set(plan.scenes.map(s => s.id))
    for (const s of plan.shots) {
      expect(sceneIds.has(s.scene_id)).toBe(true)
      expect(s).toMatchObject({ project_id: 'id-1', status: 'not_started', type: 'other', frame_count: 0 })
    }
    expect(plan.shots.filter(s => s.scene_id === plan.scenes[0].id).map(s => s.shot_number)).toEqual([1, 2, 3])
    expect(plan.shots.filter(s => s.scene_id === plan.scenes[1].id).map(s => s.shot_number)).toEqual([1, 2])
  })
  it('seedDemoProject writes the project first, then scenes, then shots, all under the created id', async () => {
    const writes = []
    const createProject = async (p) => { writes.push(['project', p.id]); return { ...p, id: 'created-id' } }
    const adapter = {
      upsertScene: async (s) => { writes.push(['scene', s.project_id]); return s },
      upsertShot: async (s) => { writes.push(['shot', s.project_id]); return s },
    }
    const r = await seedDemoProject({ createProject, adapter })
    expect(r).toMatchObject({ id: 'created-id', scenes: 2, shots: 5 })
    expect(writes[0][0]).toBe('project')
    expect(writes.slice(1, 3).every(w => w[0] === 'scene' && w[1] === 'created-id')).toBe(true)
    expect(writes.slice(3).every(w => w[0] === 'shot' && w[1] === 'created-id')).toBe(true)
    await expect(seedDemoProject({ createProject, adapter: {} })).rejects.toThrow(/cannot seed/)
  })
})

describe('describeLocalState — what the card says', () => {
  it('active / missing / none, with the leaf name', () => {
    expect(describeLocalState({ active: 'D:\\Demos\\Friday' })).toMatchObject({ mode: 'active', name: 'Friday' })
    expect(describeLocalState({ active: null, missing: '/Volumes/Drive/demo' })).toMatchObject({ mode: 'missing', name: 'demo' })
    expect(describeLocalState({ active: null, missing: null, recent: [{ path: 'x' }] })).toMatchObject({ mode: 'none', recent: [{ path: 'x' }] })
    expect(describeLocalState(null)).toEqual({ mode: 'none', recent: [] })
  })
  it('folderLeaf tolerates trailing separators and either slash', () => {
    expect(folderLeaf('D:\\Demos\\Friday\\')).toBe('Friday')
    expect(folderLeaf('/Volumes/Drive/demo/')).toBe('demo')
    expect(folderLeaf('')).toBe('')
  })
})
