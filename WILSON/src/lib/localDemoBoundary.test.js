// =============================================================================
// localDemoBoundary.test.js — demo sprint, 2026-09-10, adversarial review
// round 2 on the local demo folder's boundary.
//
// Round two's verdict was "no": with a user-chosen root, three joins that had
// always landed in %APPDATA% now landed in the person's own folder or beside
// it, and round one's L9 ("keep a stored folder_root that still exists")
// honoured a copied bundle's root anywhere on the machine. Each fix here is
// pinned by BEHAVIOUR on the pure modules (electron/pathContainment.cjs,
// electron/localDemoRoot.cjs, real temp folders) and by a source scan of
// electron/main.cjs for the call sites — the way localDemoWiring.test.js does.
//
//   H1  rate-card / team-member / task-template ids joined raw → dataFilePath
//   H2  asset / entity thumbnail ids joined raw; thumbnail_image opened
//       from anywhere → dataFilePath + isUserAuthorizedRelinkDir
//   H3  an outside folder_root that EXISTS was followed → storedRootAllowed
//   M4  files-config.json travelled with a copied folder → per machine again
//   M5  reset() deleted a pre-existing .wilson/rabbit-data → provenance checked
//   M6  a folder that vanished while open was silently recreated → checkPresence
//   L7  a junction-picked foreign folder could never be confirmed → real path
//   N8  folderRootRefusal refused every project folder on macOS → demo shape
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { makeContainment } = require('../../electron/pathContainment.cjs')
const { makeLocalDemoRoot, storedRootAllowed, layoutFor, MANIFEST_NAME } = require('../../electron/localDemoRoot.cjs')
const win = makeContainment(path.win32)
const posix = makeContainment(path.posix)
const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.cjs', import.meta.url)), 'utf8')

describe('dataFilePath — an id is ONE plain segment inside its data directory (review 2, H1/H2)', () => {
  const cards = 'D:\\Demo\\.wilson\\rabbit-data\\rate-cards'
  const thumbs = 'D:\\Demo\\.wilson\\rabbit-data\\thumbnails'
  it('escapes and non-segments stay null (fail closed) — Express 5 decodes ..%2F to ../', () => {
    for (const bad of ['../x', '..\\x', 'a/../../b', '../../wilson-demo', '/etc/passwd', 'C:\\x', 'C:x', '', '.', '..', 'a:b', 'a\0b', null, undefined]) {
      expect(win.dataFilePath(cards, bad, '.json')).toBeNull()
    }
    // the cache-name shapes: the prefix absorbs nothing
    expect(win.dataFilePath(thumbs, 'asset-../../../../x', '.jpg')).toBeNull()
    expect(win.dataFilePath(thumbs, 'scene-..\\..\\x', '.jpg')).toBeNull()
    expect(posix.dataFilePath('/demo/.wilson/rabbit-data/thumbnails', 'asset-../../x', '.jpg')).toBeNull()
    expect(posix.dataFilePath('/demo/x', '../wilson-demo', '.json')).toBeNull()
  })
  it('a plain id resolves under the base, with the suffix', () => {
    expect(win.dataFilePath(cards, '4f1c2a3b-0000-4000-8000-000000000001', '.json'))
      .toBe(cards + '\\4f1c2a3b-0000-4000-8000-000000000001.json')
    expect(win.dataFilePath(thumbs, 'asset-4f1c2a3b', '.jpg')).toBe(thumbs + '\\asset-4f1c2a3b.jpg')
    expect(win.dataFilePath(cards, 'a..b', '.json')).toBe(cards + '\\a..b.json')
    expect(posix.dataFilePath('/demo/x', 'id-1', '.json')).toBe('/demo/x/id-1.json')
  })
})

describe('storedRootAllowed — a stored folder_root is followed only where the person could have chosen it (review 2, H3)', () => {
  it("no demo folder open: today's rule, any existing root is followed", () => {
    expect(storedRootAllowed(null, 'C:\\Users\\Public', path.win32)).toBe(true)
  })
  it('win32: outside the open folder is refused even though it EXISTS; inside is followed; the folder itself and its .wilson are refused', () => {
    const demo = 'C:\\Demos\\Friday'
    expect(storedRootAllowed(demo, 'C:\\Users\\Public', path.win32)).toBe(false)
    expect(storedRootAllowed(demo, 'C:\\Demos\\Friday-old\\projects\\X', path.win32)).toBe(false)
    expect(storedRootAllowed(demo, 'C:\\Demos\\Friday\\projects\\Sizzle-Reel', path.win32)).toBe(true)
    expect(storedRootAllowed(demo, 'c:\\demos\\friday\\PROJECTS\\x', path.win32)).toBe(true)
    expect(storedRootAllowed(demo, 'C:\\Demos\\Friday', path.win32)).toBe(false)
    expect(storedRootAllowed(demo, 'C:\\Demos\\Friday\\.wilson\\rabbit-data\\x', path.win32)).toBe(false)
    expect(storedRootAllowed(demo, null, path.win32)).toBe(false)
  })
  it('posix: the same rule', () => {
    const demo = '/Volumes/Drive/demo'
    expect(storedRootAllowed(demo, '/Users/audrey/Documents', path.posix)).toBe(false)
    expect(storedRootAllowed(demo, '/Volumes/Drive/demo/projects/X', path.posix)).toBe(true)
    expect(storedRootAllowed(demo, '/Volumes/Drive/demo/.wilson/x', path.posix)).toBe(false)
    expect(storedRootAllowed(demo, '/Volumes/Drive/demo', path.posix)).toBe(false)
  })
})

describe('the folder on disk — reset provenance and presence (review 2, M5 / M6)', () => {
  let base, userData, tick
  const now = () => `2026-09-10T00:00:${String(tick++).padStart(2, '0')}.000Z`
  const make = () => makeLocalDemoRoot({ userDataDir: userData, appVersion: '1.0.0', now })
  const folder = (name) => { const p = path.join(base, name); mkdirSync(p, { recursive: true }); return p }
  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'wilson-local-demo-r2-'))
    userData = path.join(base, 'userData')
    mkdirSync(userData)
    tick = 0
  })
  afterEach(() => { rmSync(base, { recursive: true, force: true }) })

  it('reset() REFUSES when .wilson/rabbit-data existed before WILSON opened the folder, and keeps its files (M5)', () => {
    const root = make()
    const dir = folder('their-wilson')
    mkdirSync(path.join(dir, '.wilson', 'rabbit-data'), { recursive: true })
    writeFileSync(path.join(dir, '.wilson', 'rabbit-data', 'theirs.json'), 'x')
    expect(root.open(dir, { allowForeign: true })).toMatchObject({ ok: true, status: 'initialised' })
    expect(JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')).created_layout)
      .toEqual({ projects: true, rabbit_data: false })
    const r = root.reset()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/existed before WILSON opened this folder/)
    expect(readFileSync(path.join(dir, '.wilson', 'rabbit-data', 'theirs.json'), 'utf8')).toBe('x')
    expect(existsSync(path.join(dir, 'projects'))).toBe(true)
  })

  it('a folder that vanishes WHILE open flips to missing on the next root question and is not recreated (M6)', () => {
    const root = make()
    const dir = folder('vanishing')
    const real = realpathSync.native(dir).toLowerCase()
    expect(root.open(dir)).toMatchObject({ ok: true })
    expect(root.dataDir().toLowerCase()).toBe(layoutFor(realpathSync.native(dir)).dataDir.toLowerCase())
    rmSync(dir, { recursive: true, force: true })
    expect(root.rootDir()).toBeNull()
    expect(root.dataDir()).toBeNull()
    expect(root.projectsDir()).toBeNull()
    expect(root.missingDir().toLowerCase()).toBe(real)
    const state = root.getState()
    expect(state.active).toBeNull()
    expect(state.missing.toLowerCase()).toBe(real)
    expect(root.reset()).toMatchObject({ ok: false })
    expect(existsSync(dir)).toBe(false)
    // still remembered, so Locate it… / Forget it on the card both work
    expect(root.isKnownFolder(dir)).toBe(true)
    expect(root.forget(dir)).toMatchObject({ ok: true, missing: null })
  })
})

describe('main.cjs — every round-two seam reaches its module (source scan)', () => {
  it('H1: the three per-id JSON helpers go through dataFileOrThrow, and nothing joins a per-id name raw any more', () => {
    for (const fn of ['rateCardPath', 'teamMemberPath', 'taskTemplatePath']) {
      expect(MAIN).toMatch(new RegExp(`function ${fn}\\(id\\) \\{ return dataFileOrThrow\\(get\\w+Dir\\(\\), id, '\\.json'`))
    }
    expect(MAIN).not.toMatch(/path\.join\(get(RateCards|TeamMembers|TaskTemplates)Dir\(\), `/)
    expect(MAIN).toContain('const p = dataFilePath(baseDir, id, ext);')
    expect(MAIN).toContain("err.code = 'WILSON_PATH_ESCAPE'")
  })
  it('H1: the escape is answered as not-found by an error handler registered AFTER the SPA fallback', () => {
    const handler = MAIN.indexOf("if (err && err.code === 'WILSON_PATH_ESCAPE') return rabbitNotFound(res, 'item');")
    expect(handler).toBeGreaterThan(MAIN.indexOf("expressApp.get('/{*splat}'"))
    expect(handler).toBeLessThan(MAIN.indexOf("const server = expressApp.listen(0, '127.0.0.1'"))
  })
  it('H2: the thumbnail cache paths are contained in the routes AND the IPC twins; the source image must be under a folder the person chose', () => {
    expect(MAIN).not.toMatch(/path\.join\(thumbDir, `/)
    expect(MAIN).not.toMatch(/path\.join\(getThumbCacheDir\(\), `/)
    expect(MAIN).toContain("dataFileOrThrow(getThumbCacheDir(), `asset-${asset.id}`, '.jpg', 'asset')")
    expect(MAIN).toContain("dataFileOrThrow(getThumbCacheDir(), `${singular}-${entity.id}`, '.jpg', singular)")
    expect((MAIN.match(/dataFileOrThrow\(getThumbCacheDir\(\), `asset-\$\{assetId\}`, '\.jpg', 'asset'\)/g) || []).length).toBe(2)
    expect((MAIN.match(/dataFileOrThrow\(getThumbCacheDir\(\), `\$\{entityThumbKind\(entityType\)\}-\$\{entityId\}`, '\.jpg', 'entity'\)/g) || []).length).toBe(2)
    expect((MAIN.match(/if \(!isUserAuthorizedRelinkDir\(bundle, req\.params\.projectId, srcPath\)\) return res\.status\(403\)/g) || []).length).toBe(2)
  })
  it('H3: both project-folder resolvers and the relink roots consult storedRootUsable (real path, inside the open folder)', () => {
    expect(MAIN).toContain('if (root && fs.existsSync(root) && storedRootUsable(root)) return root;')
    expect(MAIN).toContain('if (projectRoot && fs.existsSync(projectRoot) && storedRootUsable(projectRoot)) return projectRoot;')
    expect(MAIN).toContain('const fd = bundle.project?.files_dir; if (fd && storedRootUsable(fd)) roots.push(fd);')
    const fn = MAIN.slice(MAIN.indexOf('function storedRootUsable('), MAIN.indexOf('function storedRootUsable(') + 400)
    expect(fn).toContain('fs.realpathSync.native(root)')
    expect(fn).toContain('return storedRootAllowed(demoRoot, real)')
    expect(MAIN).not.toContain('if (root && fs.existsSync(root)) return root;')
  })
  it('M4: files-config.json is per machine again — never under the demo folder', () => {
    const fn = MAIN.slice(MAIN.indexOf('function getFilesConfigPath()'), MAIN.indexOf('function readFilesConfig()'))
    expect(fn).toContain("path.join(app.getPath('userData'), 'rabbit-data')")
    expect(fn).not.toContain('getRabbitDataDir()')
  })
  it('L7: a demo pick is recorded by its given path AND its real path', () => {
    const pick = MAIN.slice(MAIN.indexOf("ipcMain.handle('local-demo:pick'"), MAIN.indexOf("ipcMain.handle('local-demo:open'"))
    expect(pick).toContain('demoAuthorizedDirs.add(path.resolve(picked).toLowerCase())')
    expect(pick).toContain('demoAuthorizedDirs.add(fs.realpathSync.native(picked)')
  })
  it("N8: inside an open demo folder the project-folder shape check is the demo folder's own (posix-capable)", () => {
    const fn = MAIN.slice(MAIN.indexOf('function folderRootRefusal('), MAIN.indexOf('function getNextVersion('))
    expect(fn).toContain('const shape = demoRoot ? checkDemoFolderShape(candidate) : checkFolderRootShape(candidate);')
    expect(MAIN).toMatch(/const \{ makeLocalDemoRoot, checkDemoFolderShape, storedRootAllowed \} = require\('\.\/localDemoRoot\.cjs'\)/)
  })
})
